// `ccrc doctor`, part: codex-direct (D-6767): a direct codex lane's rows and its drift row, the backups checks and box-settings.
// They moved here unchanged from `ccrc-doctor-codex.test.ts`, itself a part of what was one 17,000-line file, which ran about 405 s
// on a CI runner and past the trace job's 1560 s budget under `strace -f`. The fixtures the doctor parts share are in
// `ccrc-doctorFixture.ts`, and those the codex parts share in `ccrc-doctor-codexFixture.ts`.
import { describe, it, expect } from 'vitest';
import { spawnSync } from 'node:child_process';
import { writeFileSync, readFileSync, mkdirSync, symlinkSync, rmSync, chmodSync, existsSync, readdirSync, renameSync } from 'node:fs';
import path, { join } from 'node:path';
import { mkTmp, removeTmpFixturesEachTest } from './tmpHelpers.js';
import { itLinux, itDarwin } from './platformFixtures.js';
import { GPT_LANE_BINS, spawnListener, ccrcFunction, ccrcLine, lockStub, isolationManagerStubs, assertIsolationWallFirst, strayManagerCalls } from './codexLaneFixture.js';
import { driverLines } from './codexAuthFixture.js';
import { plantDirectLane, plantRunningBridge, writeBridgeRecord } from './ccrc-doctorFixture.js';
import { runBridgeDriver } from './codexBridgeFixture.js';
import { BOX_SETTING_SPECS, BOX_SETTINGS_SHOWN } from '../../shared/api.js';
import { installDoctorHooks, REPO, CHECKS_SRC, BASH, realPath, Result, installCcrc, stubBin, stub, unstub, linkReal, shq, writeCcrcEnv, containedPath, doctorEnv, runDoctorBounded, runDoctor, healthy, describeCodex, renderLane, startedJson, lanePorts, editRosterRow, healthyCodexBox, tableNames, lineFor, anyVerdictFor, noRunnerBugLine, checksDecl } from './ccrc-doctorFixture.js';
import { checksFunction, reEsc, remedyAfter } from './ccrc-doctor-codexFixture.js';

// Each case's homes go when the case ends, not in a file-wide end sweep (R100, review 518's S1): that sweep overran vitest's 20 s
// hook timeout on the one file this family was split from. Registered before `installDoctorHooks()`'s root `afterEach` (the codex
// lanes' process kill) because vitest runs after-hooks in reverse order of registration: that kill still sees its home.
removeTmpFixturesEachTest();
installDoctorHooks();


// ── codex bridge Stage 2, Task 13: the doctor, mode by mode ──────────────────────────────────────────────────────
// Every row inside the existing `codex` check, each case with a lane in each mode (`codex-a` litellm and `codex-b`
// direct, or the other way round where a case was first written on `codex-a`). A `direct` lane runs the bridge tier
// alone, on the shim's port and unit; its LiteLLM and shim tiers are a RETIRED REFRESHER when either reads this
// lane's (Review Focus 5).
describeCodex('ccrc doctor: codex, a direct lane\'s rows (codex bridge Stage 2, Task 13)', () => {
  const laneDir = (home: string, id: string): string => join(home, '.ccrc', 'codex', id);
  const RETIRED = (id: string, tier: string): string =>
    `FAIL codex: ${id} runs a retired refresher: its ${tier} tier is running in direct mode, so two processes refresh one credential`;
  const RETIRED_FIX = (id: string): string =>
    `  remedy: stop every tier of the lane, in either mode: ccrc codex stop ${id}, then ccrc codex start ${id} (a direct lane starts its bridge alone); to run the lane through LiteLLM again instead: ccrc codex switch ${id} litellm`;
  /** `lane.json`'s `bridgeFiles`, read back: the names are `laneManifest`'s, never spelled here. */
  const bridgeFile = (home: string, id: string, k: 'stats' | 'store' | 'requests'): string =>
    join(laneDir(home, id), (JSON.parse(readFileSync(join(laneDir(home, id), 'lane.json'), 'utf8')) as
      { bridgeFiles: Record<string, string> }).bridgeFiles[k]);
  const liveSession = (home: string, sid: string, id: string): void => {
    const reg = join(home, '.cc-sessions');
    mkdirSync(reg, { recursive: true });
    writeFileSync(join(reg, `${sid}.wrapper`), `${id}\n`);
    writeFileSync(join(home, `fixture-unit-claude-session@${sid}.service`), 'active\n');
  };

  itLinux('a healthy direct lane has no retired-refresher FAIL (a running bridge alone), and a litellm lane beside it reads as before', async () => {
    const home = await healthyCodexBox('ccrc-doctor-codex-direct-healthy-', ['codex-a', 'codex-b']);
    plantDirectLane(home, 'codex-b');
    const b = await plantRunningBridge(home, 'codex-b');
    const r = runDoctor(home);
    expect(r.stdout).not.toMatch(/retired refresher/);
    const line = lineFor(r.stdout, 'codex') ?? '';
    expect(line, r.stdout).toMatch(/^PASS codex: /);
    expect(line).toMatch(/codex-b \(ports \d+\/\d+, direct mode, /);
    expect(line).toContain(`tiers: bridge running (nohup, pid ${b.pid})`);
    expect(line).toMatch(/codex-a \(ports \d+\/\d+, [^;]*LiteLLM config current; tiers: none running \(a lane is lazy\)/);
    noRunnerBugLine(r.stdout, 'codex');
  });

  itLinux('a direct lane whose LiteLLM tier runs FAILs as a retired refresher and is never half up; on a litellm lane the same tier is half up', async () => {
    const home = await healthyCodexBox('ccrc-doctor-codex-direct-retired-litellm-', ['codex-a', 'codex-b']);
    plantDirectLane(home, 'codex-b');
    for (const id of ['codex-a', 'codex-b']) {
      const l = await spawnListener(home, { answer: '404', port: lanePorts(home, id).litellmPort, argv: ['--config', join(laneDir(home, id), 'litellm.yaml')] });
      writeFileSync(join(laneDir(home, id), 'litellm.pid'), `${l.pid}\n`);
    }
    const r = runDoctor(home);
    const re = new RegExp(`^${reEsc(RETIRED('codex-b', 'litellm'))}$`, 'm');
    expect(r.stdout, r.stdout).toMatch(re);
    expect(remedyAfter(r.stdout, re)).toBe(RETIRED_FIX('codex-b'));
    expect(r.stdout).not.toMatch(/^FAIL codex: codex-b is half up/m);
    expect(r.stdout).toMatch(/^FAIL codex: codex-a is half up: its LiteLLM tier is running and its shim is not, /m);
    expect(r.stdout).not.toMatch(/codex-a runs a retired refresher/);
    noRunnerBugLine(r.stdout, 'codex');
  });

  it('a direct lane whose shim answers on the shared port FAILs as a retired refresher, once, and its bridge tier is not named foreign', async () => {
    const home = await healthyCodexBox('ccrc-doctor-codex-direct-retired-shim-', ['codex-a', 'codex-b']);
    plantDirectLane(home, 'codex-b');
    for (const id of ['codex-a', 'codex-b']) await spawnListener(home, { answer: 'json', lane: id, port: lanePorts(home, id).proxyPort });
    const r = runDoctor(home);
    expect(r.stdout.split('\n').filter((l) => l === RETIRED('codex-b', 'shim')), r.stdout).toHaveLength(1);
    expect(r.stdout).not.toMatch(/\(codex-b's bridge tier\)/);
    expect(r.stdout).not.toMatch(/codex-a runs a retired refresher/);
    expect(r.stdout).toMatch(/^FAIL codex: codex-a is half up: its shim is running and its LiteLLM tier is not, /m);
    noRunnerBugLine(r.stdout, 'codex');
  });

  // codex-b, a litellm lane beside it, runs a shim whose record is stale too: its WARN keeps the shim's own words.
  // The whole-wave fix round: the record's `code` hashes the placed shim and the auth library (L2), and its
  // `interpreter` is kept but not compared (L5), so a record that differs in its interpreter alone reads current.
  itLinux('a running bridge whose start record is not current WARNs "not proven to run the installed bytes", the shim-stale WARN\'s twin, for its code and its package; the current record, and one naming another interpreter alone, do not', async () => {
    const home = await healthyCodexBox('ccrc-doctor-codex-direct-stale-', ['codex-a', 'codex-b']);
    plantDirectLane(home, 'codex-a');
    await plantRunningBridge(home, 'codex-a');
    await spawnListener(home, { answer: 'json', lane: 'codex-b', port: lanePorts(home, 'codex-b').proxyPort });
    const shimNow = startedJson(home, 'shim');
    writeFileSync(join(laneDir(home, 'codex-b'), 'shim.started'), `${JSON.stringify({ ...JSON.parse(shimNow) as Record<string, string>, code: '0'.repeat(64) })}\n`);
    expect(runDoctor(home).stdout).not.toMatch(/^WARN codex: codex-a's bridge tier is running/m);
    const rec = join(laneDir(home, 'codex-a'), 'bridge.started');
    const re = new RegExp(`^WARN codex: codex-a's bridge tier is running, and is not proven to run the installed bytes: its start record \\(${reEsc(rec)}\\) is absent, unreadable or unparseable, or it names another placed shim, another auth library or another bridge package than a start would use now$`, 'm');
    writeBridgeRecord(home, 'codex-a', 'interpreter');
    expect(runDoctor(home).stdout).not.toMatch(/^WARN codex: codex-a's bridge tier is running/m);
    for (const field of ['code', 'bridge'] as const) {
      writeBridgeRecord(home, 'codex-a', field);
      const r = runDoctor(home);
      expect(r.stdout, `${field}\n${r.stdout}`).toMatch(re);
      expect(remedyAfter(r.stdout, re)).toMatch(/'ccrc update' restarts a running, proven, stale ccrc tier/);
      expect(r.stdout).toMatch(new RegExp(`^WARN codex: codex-b's shim tier is running, and is not proven to run the installed bytes: its start record \\(${reEsc(join(laneDir(home, 'codex-b'), 'shim.started'))}\\) is absent, unreadable or unparseable, or it names another runtime generation, or another placed shim, than a start would use now$`, 'm'));
      expect(r.stdout).not.toMatch(/codex-b's bridge/);
      noRunnerBugLine(r.stdout, 'codex');
    }
  }, 240_000);   // four doctor runs, each bounded but load-slow

  itLinux('a running bridge whose bytes cannot be told right now WARNs "unmeasured, not current" — never current, never stale', async () => {
    const home = await healthyCodexBox('ccrc-doctor-codex-direct-stale-unknown-', ['codex-a', 'codex-b']);
    plantDirectLane(home, 'codex-a');
    await plantRunningBridge(home, 'codex-a');
    // codex-b, a litellm lane, runs its front tier (the shim, record current) on its own port.
    await spawnListener(home, { answer: 'json', lane: 'codex-b', port: lanePorts(home, 'codex-b').proxyPort });
    writeFileSync(join(laneDir(home, 'codex-b'), 'shim.started'), `${startedJson(home, 'shim')}\n`);
    rmSync(join(home, 'ccrc', 'ccd', 'codexbridge'), { recursive: true, force: true });
    const r = runDoctor(home);
    const re = /^WARN codex: codex-a's bridge tier is running, and whether it runs the installed bytes cannot be told \(no python3 3\.9 or later on PATH, or the placed shim, the auth library or the bridge package cannot be hashed\) — unmeasured, not current$/m;
    expect(r.stdout, r.stdout).toMatch(re);
    expect(remedyAfter(r.stdout, re)).toMatch(/^ {2}remedy: \S/);
    expect(r.stdout).not.toMatch(/codex-a's bridge tier is running, and is not proven/);
    // codex-b, a litellm lane, is walked in its own mode: its shim reads running (so it is half up, its LiteLLM
    // tier not running), never a retired refresher, and a missing bridge package is no row of its.
    expect(r.stdout).toMatch(/^FAIL codex: codex-b is half up: its shim is running and its LiteLLM tier is not, /m);
    expect(r.stdout).not.toMatch(/codex-b runs a retired refresher/);
    expect(r.stdout).not.toMatch(/codex-b's (bridge|shim|litellm) tier/);
    noRunnerBugLine(r.stdout, 'codex');
  });

  it('a bridge-shaped answer with no proven bridge pid FAILs as unidentified on a direct lane; on a litellm lane its shim tier reads it unidentified too', async () => {
    const home = await healthyCodexBox('ccrc-doctor-codex-direct-foreign-', ['codex-a', 'codex-b']);
    plantDirectLane(home, 'codex-a');
    const pa = lanePorts(home, 'codex-a').proxyPort;
    const pb = lanePorts(home, 'codex-b').proxyPort;
    await spawnListener(home, { answer: 'direct', lane: 'codex-a', port: pa });
    await spawnListener(home, { answer: 'direct', lane: 'codex-b', port: pb });
    const r = runDoctor(home);
    expect(r.stdout, r.stdout).toMatch(new RegExp(`^FAIL codex: codex-a: port ${pa} \\(codex-a's bridge tier\\) is held by a listener that is not this lane's: its identity check failed — ccrc neither adopts nor stops what it cannot identify$`, 'm'));
    // The closing round, C1: no bridge proves itself behind codex-b's answer, so it is no retired tier either.
    expect(r.stdout).toMatch(new RegExp(`^FAIL codex: codex-b: port ${pb} \\(codex-b's shim tier\\) is held by a listener that is not this lane's: its identity check failed — ccrc neither adopts nor stops what it cannot identify$`, 'm'));
    expect(r.stdout).not.toMatch(/retired refresher|the tier of the lane's other mode/);
    noRunnerBugLine(r.stdout, 'codex');
  });

  // The closing round, C1: `_codex_foreign_what` measures the mate itself (`--mate-now`), so the doctor words the
  // state as start does. A litellm lane's shim port answered in the bridge's shape for this lane, by a process this
  // lane's bridge by its command line and named by `bridge.pid`, is the other mode's tier, `retired-tier-running`'s
  // sentence with its `ccrc codex stop` remedy. With `bridge.pid` moved aside the mate is unproven, and the port is a
  // listener ccrc cannot identify, `port-foreign`'s sentence with its "stop whatever holds port" remedy.
  itLinux('a litellm lane\'s shim port answered by its bridge FAILs as the other mode\'s tier only while that bridge proves itself; unproven, as a listener ccrc cannot identify', async () => {
    const home = await healthyCodexBox('ccrc-doctor-codex-litellm-mate-', ['codex-a']);
    const p = lanePorts(home, 'codex-a').proxyPort;
    const shim = join(home, '.local', 'bin', 'ccgpt-proxy.py');
    const b = await spawnListener(home, { answer: 'direct', lane: 'codex-a', port: p, argv: [shim, '--ccrc-bridge=direct', '--ccrc-lane=codex-a'] });
    const pf = join(laneDir(home, 'codex-a'), 'bridge.pid');
    writeFileSync(pf, `${b.pid}\n`);
    const mode = new RegExp(`^FAIL codex: codex-a: port ${p} \\(codex-a's shim tier\\) answers as codex-a's bridge, the tier of the lane's other mode, so codex-a's shim tier is not what holds it — ccrc neither adopts nor stops what it cannot identify$`, 'm');
    const proven = runDoctor(home);
    expect(proven.stdout, proven.stdout).toMatch(mode);
    expect(remedyAfter(proven.stdout, mode)).toBe("  remedy: 'ccrc codex stop codex-a' stops every tier of the lane, in either mode; then start it again.");
    renameSync(pf, `${pf}.aside`);
    const r = runDoctor(home);
    const foreign = new RegExp(`^FAIL codex: codex-a: port ${p} \\(codex-a's shim tier\\) is held by a listener that is not this lane's: its identity check failed — ccrc neither adopts nor stops what it cannot identify$`, 'm');
    expect(r.stdout, r.stdout).toMatch(foreign);
    expect(remedyAfter(r.stdout, foreign)).toBe(`  remedy: Stop whatever holds port ${p}, or give codex-a other ports in ~/.ccrc/accounts.json.`);
    expect(r.stdout).not.toMatch(/the tier of the lane's other mode|stops every tier of the lane/);
    noRunnerBugLine(r.stdout, 'codex');
  }, 120_000);

  itLinux('a bridge whose identity cannot be measured WARNs "unmeasured" — never read as running or as stopped', async () => {
    const home = await healthyCodexBox('ccrc-doctor-codex-direct-unmeasured-', ['codex-a', 'codex-b']);
    plantDirectLane(home, 'codex-a');
    const b = await plantRunningBridge(home, 'codex-a');
    // codex-b, a litellm lane, runs its front tier (the shim, record current): the shim is this lane's by its answer.
    await spawnListener(home, { answer: 'json', lane: 'codex-b', port: lanePorts(home, 'codex-b').proxyPort });
    writeFileSync(join(laneDir(home, 'codex-b'), 'shim.started'), `${startedJson(home, 'shim')}\n`);
    rmSync(join(stubBin(home), 'readlink'), { force: true });
    stub(home, 'readlink', `case "$1" in /proc/*/fd/*) exit 1 ;; esac\nexec ${shq(realPath('readlink'))} "$@"`);
    const r = runDoctor(home);
    const re = new RegExp(`^WARN codex: codex-a's bridge tier could not be measured \\(readlink read none of /proc/${b.pid}/fd's entries\\) — unmeasured, never read as running or as stopped$`, 'm');
    expect(r.stdout, r.stdout).toMatch(re);
    expect(r.stdout).not.toMatch(/retired refresher/);
    // codex-b, a litellm lane, is walked in its own mode: its shim reads running (so it is half up), it asks no
    // bridge, and its shim's identity needs no readlink.
    expect(r.stdout).toMatch(/^FAIL codex: codex-b is half up: its shim is running and its LiteLLM tier is not, /m);
    expect(r.stdout).not.toMatch(/codex-b's (bridge|shim|litellm) tier/);
    noRunnerBugLine(r.stdout, 'codex');
  });

  // `listener-other-process`: this lane's own LiteLLM by its command line, while another process holds its port
  // (`_codex_tier_is_our_handle`'s one 2). On a direct lane that is still a running refresher; on a litellm lane it is
  // the walk's foreign row, which names the pid.
  itLinux('a direct lane\'s own LiteLLM process while another process holds its port FAILs as a retired refresher; on a litellm lane it is the foreign row naming its pid', async () => {
    const home = await healthyCodexBox('ccrc-doctor-codex-direct-retired-other-proc-', ['codex-a', 'codex-b']);
    plantDirectLane(home, 'codex-b');
    const mine: Record<string, number> = {};
    for (const id of ['codex-a', 'codex-b']) {
      const l = await spawnListener(home, { answer: '404', argv: ['--config', join(laneDir(home, id), 'litellm.yaml')] });
      writeFileSync(join(laneDir(home, id), 'litellm.pid'), `${l.pid}\n`);
      mine[id] = l.pid;
      await spawnListener(home, { answer: '404', port: lanePorts(home, id).litellmPort });
    }
    const r = runDoctor(home);
    const re = new RegExp(`^${reEsc(RETIRED('codex-b', 'litellm'))}$`, 'm');
    expect(r.stdout, r.stdout).toMatch(re);
    expect(remedyAfter(r.stdout, re)).toBe(RETIRED_FIX('codex-b'));
    expect(r.stdout).not.toMatch(/codex-b's litellm tier\)/);
    const pa = lanePorts(home, 'codex-a').litellmPort;
    expect(r.stdout).toMatch(new RegExp(`^FAIL codex: codex-a: port ${pa} \\(codex-a's litellm tier\\) is held by a process that is not this lane's LiteLLM: pid ${mine['codex-a']} is this lane's by its command line, and another process holds the port's listening socket$`, 'm'));
    expect(r.stdout).not.toMatch(/codex-a runs a retired refresher/);
    noRunnerBugLine(r.stdout, 'codex');
  });

  // The retired check asks the other mode's tiers as start does, and start refuses on a 3: an other-mode tier that
  // cannot be measured is the walk's unmeasured row, never read as not running.
  itLinux('a direct lane\'s LiteLLM tier that cannot be measured WARNs "unmeasured", never retired and never not running; a litellm lane\'s walk says the same', async () => {
    const home = await healthyCodexBox('ccrc-doctor-codex-direct-retired-unmeasured-', ['codex-a', 'codex-b']);
    plantDirectLane(home, 'codex-b');
    const pid: Record<string, number> = {};
    for (const id of ['codex-a', 'codex-b']) {
      const l = await spawnListener(home, { answer: '404', port: lanePorts(home, id).litellmPort, argv: ['--config', join(laneDir(home, id), 'litellm.yaml')] });
      writeFileSync(join(laneDir(home, id), 'litellm.pid'), `${l.pid}\n`);
      pid[id] = l.pid;
    }
    rmSync(join(stubBin(home), 'readlink'), { force: true });
    stub(home, 'readlink', `case "$1" in /proc/*/fd/*) exit 1 ;; esac\nexec ${shq(realPath('readlink'))} "$@"`);
    const r = runDoctor(home);
    for (const id of ['codex-a', 'codex-b']) {
      expect(r.stdout, r.stdout).toMatch(new RegExp(`^WARN codex: ${id}'s litellm tier could not be measured \\(readlink read none of /proc/${pid[id]}/fd's entries\\) — unmeasured, never read as running or as stopped$`, 'm'));
    }
    expect(r.stdout).not.toMatch(/retired refresher/);
    expect(r.stdout).not.toMatch(/is half up/);
    noRunnerBugLine(r.stdout, 'codex');
  });

  it('the LiteLLM-down WARN is a litellm lane\'s only: a live session on an idle direct lane raises none', async () => {
    const home = await healthyCodexBox('ccrc-doctor-codex-direct-live-', ['codex-a', 'codex-b']);
    plantDirectLane(home, 'codex-b');
    liveSession(home, 'proj-a', 'codex-a');
    liveSession(home, 'proj-b', 'codex-b');
    const r = runDoctor(home);
    expect(r.stdout, r.stdout).toMatch(/^WARN codex: codex-a's LiteLLM tier is not running while 1 live session\(s\) run on this lane/m);
    expect(r.stdout).not.toMatch(/codex-b's LiteLLM tier is not running/);
    noRunnerBugLine(r.stdout, 'codex');
  });

  it('the litellm.yaml row is skipped on a direct lane: a missing LiteLLM config FAILs the litellm lane only', async () => {
    const home = await healthyCodexBox('ccrc-doctor-codex-direct-yaml-', ['codex-a', 'codex-b']);
    plantDirectLane(home, 'codex-b');
    for (const id of ['codex-a', 'codex-b']) rmSync(join(laneDir(home, id), 'litellm.yaml'), { force: true });
    const r = runDoctor(home);
    expect(r.stdout, r.stdout).toMatch(/^FAIL codex: codex-a has no rendered LiteLLM config \(/m);
    expect(r.stdout).not.toMatch(/codex-b has no rendered LiteLLM config|codex-b's LiteLLM config/);
    noRunnerBugLine(r.stdout, 'codex');
  });

  it('a bridge stats file or reasoning store that is not 0600, or not a regular file, FAILs, in either mode; an owner-only one does not', async () => {
    const home = await healthyCodexBox('ccrc-doctor-codex-direct-files-', ['codex-a', 'codex-b']);
    plantDirectLane(home, 'codex-b');
    const aStats = bridgeFile(home, 'codex-a', 'stats');
    const aStore = bridgeFile(home, 'codex-a', 'store');
    const bStats = bridgeFile(home, 'codex-b', 'stats');
    const bStore = bridgeFile(home, 'codex-b', 'store');
    writeFileSync(aStats, '{}\n', { mode: 0o644 });
    chmodSync(aStats, 0o644);
    writeFileSync(aStore, 'fixture\n', { mode: 0o640 });
    chmodSync(aStore, 0o640);
    writeFileSync(bStats, '{}\n', { mode: 0o600 });
    writeFileSync(join(home, 'elsewhere.sqlite'), 'fixture\n', { mode: 0o600 });
    symlinkSync(join(home, 'elsewhere.sqlite'), bStore);
    const r = runDoctor(home);
    const statsRe = new RegExp(`^FAIL codex: codex-a's bridge stats file ${reEsc(aStats)} has mode 644, and the bridge keeps it owner-only \\(0600\\): it names the lane's upstream request ids and its usage$`, 'm');
    expect(r.stdout, r.stdout).toMatch(statsRe);
    expect(remedyAfter(r.stdout, statsRe)).toBe(`  remedy: chmod 600 ${aStats}`);
    expect(r.stdout).toMatch(new RegExp(`^FAIL codex: codex-a's bridge reasoning store ${reEsc(aStore)} has mode 640, and the bridge keeps it owner-only \\(0600\\): it holds the lane's encrypted reasoning$`, 'm'));
    const linkRe = new RegExp(`^FAIL codex: codex-b's bridge reasoning store ${reEsc(bStore)} is not a regular file \\(a symlink, a directory or another kind of file\\), and the bridge keeps it owner-only \\(0600\\) only as a regular file it creates itself$`, 'm');
    expect(r.stdout).toMatch(linkRe);
    expect(remedyAfter(r.stdout, linkRe)).toBe(`  remedy: stop the lane (ccrc codex stop codex-b), move ${bStore} aside by hand, then start it again: the bridge creates a new one, mode 0600 — ccrc never removes it for you`);
    expect(r.stdout).not.toMatch(/codex-b's bridge stats file/);
    noRunnerBugLine(r.stdout, 'codex');
  });

  // D-8619: the per-request record and its one older generation are created 0600 by the bridge, as the stats file is,
  // and hold the lane's Claude Code session ids and each request's timings. Named by lane.json's `bridgeFiles.requests`;
  // a lane.json an older laneManifest wrote names none: no record file is looked for, and the lane.json itself reads
  // stale against its roster row (the update's codex-lanes step and `doctor --fix` re-render it).
  it('the request record and its older generation are checked like the stats file; a lane.json naming none is stale, never a record FAIL', async () => {
    const home = await healthyCodexBox('ccrc-doctor-codex-direct-requests-', ['codex-a', 'codex-b']);
    plantDirectLane(home, 'codex-b');
    const rec = bridgeFile(home, 'codex-a', 'requests');
    expect(path.basename(rec), 'CONTROL: the rendered lane.json names it').toBe('bridge.requests.jsonl');
    writeFileSync(rec, '{}\n', { mode: 0o644 });
    chmodSync(rec, 0o644);
    writeFileSync(join(home, 'elsewhere.jsonl'), '{}\n', { mode: 0o600 });
    symlinkSync(join(home, 'elsewhere.jsonl'), `${rec}.1`);
    const bRec = bridgeFile(home, 'codex-b', 'requests');
    writeFileSync(bRec, '{}\n', { mode: 0o600 });
    writeFileSync(`${bRec}.1`, '{}\n', { mode: 0o640 });
    chmodSync(`${bRec}.1`, 0o640);
    const r = runDoctor(home);
    const why = "it names the lane's Claude Code session ids and the time and size of each of its requests";
    const modeRe = new RegExp(`^FAIL codex: codex-a's bridge request record ${reEsc(rec)} has mode 644, and the bridge keeps it owner-only \\(0600\\): ${reEsc(why)}$`, 'm');
    expect(r.stdout, r.stdout).toMatch(modeRe);
    expect(remedyAfter(r.stdout, modeRe)).toBe(`  remedy: chmod 600 ${rec}`);
    expect(r.stdout).toMatch(new RegExp(`^FAIL codex: codex-a's bridge request record ${reEsc(`${rec}.1`)} is not a regular file \\(a symlink, a directory or another kind of file\\), `, 'm'));
    expect(r.stdout).toMatch(new RegExp(`^FAIL codex: codex-b's bridge request record ${reEsc(`${bRec}.1`)} has mode 640, `, 'm'));
    expect(r.stdout).not.toMatch(new RegExp(`${reEsc(bRec)} has mode`));
    noRunnerBugLine(r.stdout, 'codex');
    // a lane.json with no request record named: its files are not looked for, and nothing else changes
    for (const id of ['codex-a', 'codex-b']) {
      const lj = join(laneDir(home, id), 'lane.json');
      const doc = JSON.parse(readFileSync(lj, 'utf8')) as { bridgeFiles: Record<string, string> };
      delete doc.bridgeFiles['requests'];
      writeFileSync(lj, JSON.stringify(doc), { mode: 0o600 });
    }
    const r2 = runDoctor(home);
    expect(r2.stdout).not.toMatch(/bridge request record/);
    for (const id of ['codex-a', 'codex-b']) {
      expect(r2.stdout, r2.stdout).toMatch(new RegExp(`^FAIL codex: ${id}'s lane\\.json disagrees with its roster row \\(`, 'm'));
    }
    expect(r2.stdout).not.toMatch(/lane\.json disagrees with what its roster row and class registry render/);
    noRunnerBugLine(r2.stdout, 'codex');
  });

  // A mode `_plat_mode` cannot measure (here `stat` fails on the bridge files alone) is the FAIL's `unreadable`, never a
  // pass, and its remedy is not `chmod`, which cannot cure a mode nobody could read.
  it('a bridge stats file whose mode cannot be measured FAILs "mode unreadable", in either mode, with a remedy that is not chmod', async () => {
    const home = await healthyCodexBox('ccrc-doctor-codex-direct-files-unmeasured-', ['codex-a', 'codex-b']);
    plantDirectLane(home, 'codex-b');
    const stats = { 'codex-a': bridgeFile(home, 'codex-a', 'stats'), 'codex-b': bridgeFile(home, 'codex-b', 'stats') };
    for (const f of Object.values(stats)) writeFileSync(f, '{}\n', { mode: 0o600 });
    rmSync(join(stubBin(home), 'stat'), { force: true });
    stub(home, 'stat', `for a in "$@"; do case "$a" in ${shq(stats['codex-a'])}|${shq(stats['codex-b'])}) exit 1 ;; esac; done\nexec ${shq(realPath('stat'))} "$@"`);
    const r = runDoctor(home);
    for (const [id, f] of Object.entries(stats)) {
      const re = new RegExp(`^FAIL codex: ${id}'s bridge stats file ${reEsc(f)} has mode unreadable, and the bridge keeps it owner-only \\(0600\\): it names the lane's upstream request ids and its usage$`, 'm');
      expect(r.stdout, r.stdout).toMatch(re);
      expect(remedyAfter(r.stdout, re)).toBe(`  remedy: check that stat runs on PATH (coreutils on a GNU box, the base system on macOS) and can read ${f} (the file still in place, its directory searchable), then re-run doctor; the file must be a regular file of mode 0600`);
    }
    noRunnerBugLine(r.stdout, 'codex');
  });

  it('a direct lane on the siwc upstream FAILs upstream-unsupported; a litellm lane naming siwc does not', async () => {
    const home = await healthyCodexBox('ccrc-doctor-codex-direct-siwc-', ['codex-a', 'codex-b']);
    editRosterRow(home, 'codex-a', (row) => { row['exec'].upstream = 'siwc'; });
    renderLane(home, 'codex-a');
    plantDirectLane(home, 'codex-b', { upstream: 'siwc' });
    const r = runDoctor(home);
    const re = /^FAIL codex: codex-b is a direct lane whose upstream is "siwc", and the siwc route arrives in Stage 3: 'ccrc codex start codex-b' refuses it \(upstream-unsupported\), so the lane cannot serve$/m;
    expect(r.stdout, r.stdout).toMatch(re);
    expect(remedyAfter(r.stdout, re)).toBe('  remedy: set the lane\'s upstream back to "backend" (or remove it) in $HOME/.ccrc/accounts.json by hand, then run \'ccrc doctor --fix\' (it re-renders lane.json from the roster), then: ccrc codex start codex-b — ccrc never edits a roster row for you');
    expect(r.stdout).not.toMatch(/codex-a is a direct lane whose upstream/);
    noRunnerBugLine(r.stdout, 'codex');
  });

  // The whole-wave fix round (L1): the remedy cures the state. Start reads the upstream from lane.json, and a roster
  // edit alone does not move lane.json (`_codex_lane_json_state` checks the word's presence, not its value), so the
  // remedy names the one act that re-renders it from the roster: `ccrc doctor --fix`, which the siwc FAIL reaches.
  it('the upstream-unsupported remedy followed end to end: the roster set back, ccrc doctor --fix, and start passes the upstream check', async () => {
    const home = await healthyCodexBox('ccrc-doctor-codex-direct-siwc-cure-');
    plantDirectLane(home, 'codex-a', { upstream: 'siwc' });
    const upstreamOf = (): unknown => (JSON.parse(readFileSync(join(laneDir(home, 'codex-a'), 'lane.json'), 'utf8')) as Record<string, unknown>)['upstream'];
    const refused = runDoctor(home, ['codex', 'start', 'codex-a']);
    expect(refused.code).toBe(1);
    expect(refused.stderr).toMatch(/^ccrc codex: upstream-unsupported: codex-a is a direct lane whose upstream is "siwc", .*Set the lane's upstream back to "backend" \(or remove it\) in ~\/\.ccrc\/accounts\.json, then run 'ccrc doctor --fix' \(it re-renders lane\.json from the roster\), then re-run\. Nothing was started\.$/m);
    // The remedy's first step, by the operator's hand. lane.json still names siwc, so a start alone is refused again:
    // the state the remedy has to cure.
    editRosterRow(home, 'codex-a', (row) => { row['exec'].upstream = 'backend'; });
    expect(runDoctor(home, ['codex', 'start', 'codex-a']).stderr).toMatch(/^ccrc codex: upstream-unsupported: /m);
    expect(upstreamOf()).toBe('siwc');
    const fix = runDoctor(home, ['doctor', '--fix']);
    expect(fix.stdout, fix.stdout).toMatch(/^FIX codex: codex-a: lane\.json re-rendered from the roster and this lane's class registry$/m);
    expect(upstreamOf()).toBe('backend');
    // Start passes the upstream check: with the placed shim taken away, it refuses at a later check, the shim's, and
    // starts nothing. The gateway key it mints between the two needs these four on the contained PATH.
    for (const b of ['mktemp', 'chmod', 'mv', 'rm']) linkReal(home, b);
    rmSync(join(home, '.local', 'bin', 'ccgpt-proxy.py'));
    const started = runDoctor(home, ['codex', 'start', 'codex-a']);
    expect(started.code).toBe(1);
    expect(started.stderr).not.toMatch(/upstream-unsupported/);
    expect(started.stderr).toMatch(/^ccrc codex: shim-absent: /m);
  });

  // `--fix` runs only behind a FAIL and restarts tiers only through the install step (`_inst_codex_tiers`), the one
  // that restarts a running, proven, stale tier and never starts a stopped one. Composed here with that REAL step on
  // two direct lanes and a litellm one: a placed shim whose bytes drifted (a FAIL, and code a bridge runs) is
  // restored, and then codex-a's running stale bridge is stopped and started, codex-b's stopped bridge is left
  // stopped, and codex-c's running stale shim is restarted on its own tiers, never asked as a bridge.
  it('--fix restoring a drifted shim restarts a direct lane\'s stale running bridge through _inst_codex_tiers, and never starts a stopped one', () => {
    const home = mkTmp('ccrc-doctor-fix-codex-direct-');
    const tree = join(home, 'ccrc', 'ccd');
    const bin = join(home, '.local', 'bin');
    mkdirSync(tree, { recursive: true });
    mkdirSync(bin, { recursive: true });
    const RT = '#!/bin/sh\ncase "$1" in check) exit 0 ;; python) echo "$HOME/.ccrc/runtime/codex/gen-x/bin/python"; exit 0 ;; esac\nexit 64\n';
    for (const n of GPT_LANE_BINS) {
      const text = n === 'ccgpt-runtime' ? RT : `#!/bin/sh\n# fixture shipped ${n}\n`;
      writeFileSync(join(tree, n), text, { mode: 0o755 });
      writeFileSync(join(bin, n), n === 'ccgpt-proxy.py' ? '#!/bin/sh\n# drifted\n' : text, { mode: 0o755 });
    }
    mkdirSync(join(home, '.ccrc'), { recursive: true });
    const harness = [
      'set -uo pipefail',
      ccrcLine(/^PROG=.*$/m, 'PROG='),
      ccrcLine(/^_ccrc_die\(\) \{.*\}$/m, '_ccrc_die'),
      ccrcFunction('_inst_atomic'),
      ccrcFunction('_box_env_value'),
      'BOX_TREE_DIR="$HOME/ccrc"',
      'BOX_ENV_FILE="$HOME/.ccrc/ccrc.env"',
      'CCRC_CODEX_READY_S=1',
      'CX_LITELLM=45010', 'CX_PROXY=45011',
      checksFunction('_dr_join'),
      checksDecl('CODEX_LANE_BINS'),
      ccrcLine(/^CODEX_TIERS=.*$/m, 'CODEX_TIERS='),
      ccrcLine(/^_codex_shim_file\(\) .*$/m, '_codex_shim_file'),
      ccrcLine(/^_codex_auth_lib\(\) .*$/m, '_codex_auth_lib'),
      ccrcLine(/^_codex_runtime_cli\(\) \{.*\}$/m, '_codex_runtime_cli'),
      ccrcFunction('_codex_mode_tiers'),
      ccrcFunction('_codex_tier_is_other_mode'),
      ccrcFunction('_codex_ready_secs'),
      '_codex_lanes() { printf \'codex-a\\ncodex-b\\ncodex-c\\n\'; }',
      '_codex_row() { CX_ID="$1"; return 0; }',
      '_codex_lane_json_state() { echo current; }',
      '_codex_lane_mode() { case "$1" in codex-c) printf \'litellm\\n\' ;; *) printf \'direct\\n\' ;; esac; }',
      // Stage 4, Task 5: codex-c runs in litellm mode, so this box wants its runtime, whose check answers 0.
      '_codex_runtime_wanted() { return 0; }',
      '_codex_bus_defaults() { :; }',
      '_models_roster_path() { printf \'%s\' "$HOME/.ccrc/accounts.json"; }',
      '_models_node() { echo \'{"ok":true,"op":"materialise","check":true,"changed":{"lane":false,"classes":false,"effort":false}}\'; }',
      '_models_node_locked() { shift; _models_node "$@"; }',
      '_models_litellm_lane_held() { echo \'{"ok":true,"op":"litellm","changed":false}\'; }',
      lockStub(),
      // codex-a's bridge and codex-c's shim: running, stale, gone after the stop, back after the start; the rest:
      // not running.
      '_codex_tier_ours() {',
      '  local k="$1-$2" n; n=$(( $(cat "$HOME/n-$k" 2>/dev/null || echo 0) + 1 )); echo "$n" > "$HOME/n-$k"',
      '  printf \'_codex_tier_ours %s %s\\n\' "$1" "$2" >> "$HOME/calls"',
      '  CX_TIER_WHY=\'\'; CX_TIER_VIA=\'\'; CX_TIER_PID=\'\'',
      '  case "$1 $2 $n" in "codex-a bridge 1"|"codex-a bridge 3"|"codex-c shim 1"|"codex-c shim 3") return 0 ;; esac',
      '  return 1',
      '}',
      '_codex_tier_stale() { printf \'_codex_tier_stale %s %s\\n\' "$1" "$2" >> "$HOME/calls"; case "$1 $2" in "codex-a bridge"|"codex-c shim") return 0 ;; esac; return 1; }',
      '_codex_stop_tier() { printf \'_codex_stop_tier %s %s\\n\' "$1" "$2" >> "$HOME/calls"; echo stopped; }',
      '_codex_start_tier() { printf \'_codex_start_tier %s %s\\n\' "$1" "$2" >> "$HOME/calls"; return 0; }',
      ccrcFunction('_inst_codex_tiers'),
      checksFunction('_fix_codex'),
      '_fix_codex; exit $?',
    ].join('\n');
    const wall = isolationManagerStubs(home);
    const env = { PATH: `${wall}:${process.env['PATH'] ?? ''}`, HOME: home, LC_ALL: 'C' };
    assertIsolationWallFirst(env, home);
    const p = spawnSync(BASH, ['-c', harness], { env, encoding: 'utf8' });
    expect(strayManagerCalls(home)).toEqual([]);
    expect(p.status, `${p.stdout}${p.stderr}`).toBe(0);
    const calls = readFileSync(join(home, 'calls'), 'utf8').split('\n').filter(Boolean);
    expect(calls.filter((l) => /^_codex_(stop|start)_tier /.test(l))).toEqual([
      '_codex_stop_tier codex-a bridge', '_codex_start_tier codex-a bridge',
      '_codex_stop_tier codex-c shim', '_codex_start_tier codex-c shim',
    ]);
    expect(calls.filter((l) => /^_codex_tier_ours codex-[ab] /.test(l) && !l.endsWith(' bridge'))).toEqual([]);
    expect(calls.filter((l) => l === '_codex_tier_ours codex-c bridge')).toEqual([]);
    expect(p.stdout).toContain('FIX codex: restored $HOME/.local/bin/ccgpt-proxy.py from the shipped tree');
    expect(p.stdout).toContain('install: codex tiers: codex-a bridge: restarted — it was running code this install replaced');
    expect(p.stdout).toContain('install: codex tiers: codex-c shim: restarted — it was running code this install replaced');
    expect(p.stdout).toContain('install: codex tiers: 3 codex lane(s) — 2 restarted, 0 left as they were, 0 not restarted');
  });
});


// ── codex bridge Stage 2, Task 17: D3, the doctor warns on an unexplained name ──────────────────────────────────────
// A `direct` lane's bridge lists every name `known.py` does not explain in its stats file's `unexplained` (Task 5);
// the doctor reads that list, and only that list, from the file `lane.json`'s `bridgeFiles.stats` names, and prints
// each name bounded by stats.py's NAME_RE (else `unrecognised`), never a value. The stats files here are written by
// the real `Stats` through the bridge driver, except the one case that must hold what no `Stats` would write.
describeCodex('ccrc doctor: codex, the drift row on a direct lane (codex bridge Stage 2, Task 17)', () => {
  const laneDir = (home: string, id: string): string => join(home, '.ccrc', 'codex', id);
  /** `lane.json`'s `bridgeFiles.stats`, read back: the name is `laneManifest`'s, never spelled here. */
  const statsFile = (home: string, id: string): string =>
    join(laneDir(home, id), (JSON.parse(readFileSync(join(laneDir(home, id), 'lane.json'), 'utf8')) as
      { bridgeFiles: Record<string, string> }).bridgeFiles['stats']);
  const DRIFT = (id: string, n: number, list: string): string =>
    `WARN codex: ${id}: the bridge met ${n} name(s) it does not know: ${list} (names only, never content). Each is a protocol change to read; it is explained by adding it to ccd/codexbridge/known.py in a reviewed change.`;
  const DRIFT_FIX = '  remedy: read what each name is in the upstream Codex source (openai/codex), then explain it by adding it to ccd/codexbridge/known.py in a reviewed change; the rollout of that change restarts the bridge, whose start drops an explained name from the list, and this line clears — ccrc never explains a name for you';
  /** Lane `id`'s stats file as its bridge writes it: the real `Stats`, each name counted through `name()`, then a
   *  forced flush (tmp, fchmod 0600, fsync, rename). */
  const writeStats = async (home: string, id: string, names: ReadonlyArray<readonly [string, string]>): Promise<string> => {
    const file = statsFile(home, id);
    const ops = [
      { op: 'stats-open', path: file, lane: id },
      ...names.map(([family, name]) => ({ op: 'stats-call', method: 'name', args: [family, name] })),
      { op: 'stats-call', method: 'flush', kwargs: { force: true } },
    ];
    const r = await runBridgeDriver(home, { ops });   // its 10 s default, inside vitest's 20 s per-test bound
    expect(r.timedOut, r.stderr).toBe(false);
    const lines = driverLines(r.stdout);
    expect(lines.map((l) => l['op']), `${r.stdout}\n${r.stderr}`).toEqual(ops.map((o) => o.op));
    for (const l of lines) expect(l['raised'], JSON.stringify(l)).toBeUndefined();
    expect(lines[lines.length - 1]['result']).toBe(true);
    return file;
  };
  // Fix round 2, R6: a recording exists only while the operator's `record-streams` marker is in the lane directory.
  // The whole-wave fix round, Z2: each marker clause says, by family, what can show the name behind it, and that the
  // bridge's restart clears the marker (Z1). `classes` holds the kinds of family the marker was listed in: `s` an
  // event, item, error-code or incomplete-reason family (read from a 2xx stream), `h` responseHeader, `r` a
  // request-side family or any other.
  const MARKER_WHERE = (dir: string, classes: string, what: string, them: string): string =>
    (classes.includes('s') ? `; for an event, item, error-code or incomplete-reason name, put the operator's record-streams marker in ${dir} (the bridge records the lane's stream only while it is there) and read ${what} in the recording when the bridge meets ${them} again` : '')
    + (classes.includes('h') ? `; for a responseHeader name, put the operator's record-streams marker in ${dir} and read ${what} in the recording when the bridge meets ${them} again on a 2xx answer: only a 2xx answer's head is recorded` : '')
    + (classes.includes('r') ? `; for a requestField, unsupportedField, betaValue, contextEdit, modelSubstitution, foreignSubstitution or other name, no recording holds ${what}: those families' names come from the client's request (Claude Code's, or another caller's for foreignSubstitution), and the bridge records only the upstream's answers, so read ${what} from the client's request, for example from Claude Code's release notes or a reviewed diagnostic` : '');
  const UNREC_CLAUSE = (dir: string, classes: string): string => `; unrecognised is not a name: it stands for one outside the bound the bridge writes every name under (NAME_RE in ccd/codexbridge/stats.py)${MARKER_WHERE(dir, classes, 'that name', 'it')}; the bridge's restart clears unrecognised from the list, and it comes back when the bridge meets such a name again; never add unrecognised to known.py`;
  const OVER_CLAUSE = (dir: string, classes: string): string => `; overflow is not a name: it stands for more distinct names in that family than the bridge counts (NAMES_MAX in ccd/codexbridge/stats.py)${MARKER_WHERE(dir, classes, 'the names past it', 'them')}; the bridge's restart clears overflow from the list but keeps that family's counted names, so the next name in it that the bridge has not counted is overflow again, which is new drift; never add overflow to known.py`;
  // Fix round 2, M1: a stats file the row cannot read as the bridge's is the drift row's own unmeasured WARN, so it
  // is printed whatever else the codex check finds (a lane word reached output only on the PASS line).
  const UNMEASURED = (id: string, file: string, why: string): string =>
    `WARN codex: ${id}: whether the bridge met a name it does not know cannot be told: its stats file ${file} cannot be read as the bridge's (${why}) — unmeasured, never read as no unexplained name`;
  const MOVE_FIX = (id: string, file: string): string =>
    `  remedy: stop the lane (ccrc codex stop ${id}), move ${file} aside by hand, then start it again: the bridge starts a new stats file, which this line reads, and lists again any name it meets — ccrc never removes it for you`;
  const NOT_V1 = 'it is not one version-1 JSON document of this lane with an unexplained object';
  /** The line `UNMEASURED` names, exactly once, with its remedy next. */
  const expectUnmeasured = (stdout: string, id: string, file: string, why: string, fix: string): void => {
    const re = new RegExp(`^${reEsc(UNMEASURED(id, file, why))}$`, 'm');
    expect(stdout, stdout).toMatch(re);
    expect(remedyAfter(stdout, re)).toBe(fix);
    expect(stdout.split('\n').filter((l) => l.startsWith(`WARN codex: ${id}: whether the bridge met`))).toHaveLength(1);
  };
  /** A hand-planted stats file, owner-only, as `_dr_cx_bridge_files` passes it. */
  const plantStats = (file: string, body: string | Buffer): void => {
    writeFileSync(file, body, { mode: 0o600 });
    chmodSync(file, 0o600);
  };
  /** stats.py's NAMES_MAX and known.KNOWN's families, in its order, read from the shipped sources (the pin below and
   *  the bound's edge case both build on these, never on the doctor's own copies). */
  const bridgeBounds = (): { namesMax: number; families: string[] } => {
    const py = [...readFileSync(join(REPO, 'ccd', 'codexbridge', 'stats.py'), 'utf8').matchAll(/^NAMES_MAX = (\d+)\s+#/gm)];
    expect(py).toHaveLength(1);
    const block = /^KNOWN = \{\n([\s\S]*?)^\}/m.exec(readFileSync(join(REPO, 'ccd', 'codexbridge', 'known.py'), 'utf8'));
    expect(block, 'known.py holds KNOWN = { ... } in the shape this reader takes').not.toBeNull();
    const families = [...(block as RegExpExecArray)[1].matchAll(/^ {4}"([A-Za-z]+)": /gm)].map((m) => m[1]);
    return { namesMax: Number(py[0][1]), families };
  };
  const KNOWN_EVENT = 'response.metadata';   // in known.KNOWN's eventType family (codex-bridge-count-stats.test.ts)
  const NEW_EVENT = 'response.fx_new_event';

  it('a direct lane with an unexplained event type warns, naming it', async () => {
    const home = await healthyCodexBox('ccrc-doctor-codex-drift-warn-', ['codex-a']);
    plantDirectLane(home, 'codex-a');
    const file = await writeStats(home, 'codex-a', [['eventType', KNOWN_EVENT], ['eventType', NEW_EVENT], ['eventType', NEW_EVENT]]);
    expect((JSON.parse(readFileSync(file, 'utf8')) as { unexplained: unknown }).unexplained).toEqual({ eventType: [NEW_EVENT] });
    const r = runDoctor(home);
    const re = new RegExp(`^${reEsc(DRIFT('codex-a', 1, `eventType:${NEW_EVENT}`))}$`, 'm');
    expect(r.stdout, r.stdout).toMatch(re);
    expect(remedyAfter(r.stdout, re)).toBe(DRIFT_FIX);
    expect(r.stdout.split('\n').filter((l) => /the bridge met/.test(l))).toHaveLength(1);
    expect(r.stdout).not.toContain(KNOWN_EVENT);
    noRunnerBugLine(r.stdout, 'codex');
  });

  // A substitution from a request without Claude Code's claude-code beta is counted under foreignSubstitution
  // (ccd/codexbridge/known.py): the row prints it under that family, beside a Claude Code fallback's
  // modelSubstitution name for the same model id, never folded into it.
  it('a foreignSubstitution name warns under its own family, apart from a modelSubstitution of the same id', async () => {
    const home = await healthyCodexBox('ccrc-doctor-codex-drift-foreign-', ['codex-a']);
    plantDirectLane(home, 'codex-a');
    const file = await writeStats(home, 'codex-a', [['foreignSubstitution', 'claude-opus-5-5'], ['modelSubstitution', 'claude-opus-5-5']]);
    expect((JSON.parse(readFileSync(file, 'utf8')) as { unexplained: unknown }).unexplained)
      .toEqual({ foreignSubstitution: ['claude-opus-5-5'], modelSubstitution: ['claude-opus-5-5'] });
    const r = runDoctor(home);
    const line = r.stdout.split('\n').filter((l) => /the bridge met/.test(l));
    expect(line, r.stdout).toHaveLength(1);
    expect(line[0]).toMatch(/^WARN codex: codex-a: the bridge met 2 name\(s\) it does not know: /);
    expect(line[0]).toContain('foreignSubstitution:claude-opus-5-5');
    expect(line[0]).toContain('modelSubstitution:claude-opus-5-5');
    noRunnerBugLine(r.stdout, 'codex');
  });

  // Fix round 2, R2: lane b is direct with no stats file at all (no bridge has served yet), the absent arm; lane a's
  // readable file lists nothing, the empty arm. Neither is unmeasured, so the codex line is PASS for both.
  it('a known name never warns', async () => {
    const home = await healthyCodexBox('ccrc-doctor-codex-drift-known-', ['codex-a', 'codex-b']);
    for (const id of ['codex-a', 'codex-b']) plantDirectLane(home, id);
    const file = await writeStats(home, 'codex-a', [['eventType', KNOWN_EVENT], ['eventType', KNOWN_EVENT]]);
    const doc = JSON.parse(readFileSync(file, 'utf8')) as { names: Record<string, unknown>; unexplained: unknown };
    expect(doc.names['eventType']).toEqual({ [KNOWN_EVENT]: 2 });
    expect(doc.unexplained).toEqual({});
    expect(existsSync(statsFile(home, 'codex-b'))).toBe(false);
    const r = runDoctor(home);
    expect(r.stdout).not.toMatch(/the bridge met/);
    expect(r.stdout).not.toMatch(/cannot be read as the bridge's/);
    for (const id of ['codex-a', 'codex-b']) {
      expect(lineFor(r.stdout, 'codex') ?? '', r.stdout).toMatch(new RegExp(`^PASS codex: .*${reEsc(id)} \\(ports \\d+\\/\\d+, direct mode, `));
    }
    noRunnerBugLine(r.stdout, 'codex');
  });

  // A lane switched back to litellm keeps its bridge files (Task 13), and with them the unexplained list its bridge
  // left: no bridge runs there, so the list is no drift of that lane's.
  it('a litellm lane has no drift row', async () => {
    const home = await healthyCodexBox('ccrc-doctor-codex-drift-litellm-', ['codex-a', 'codex-b']);
    plantDirectLane(home, 'codex-b');
    for (const id of ['codex-a', 'codex-b']) await writeStats(home, id, [['eventType', NEW_EVENT]]);
    const r = runDoctor(home);
    expect(r.stdout, r.stdout).toMatch(new RegExp(`^${reEsc(DRIFT('codex-b', 1, `eventType:${NEW_EVENT}`))}$`, 'm'));
    expect(r.stdout).not.toMatch(/codex-a: the bridge met/);
    noRunnerBugLine(r.stdout, 'codex');
  });

  // No `Stats` writes a name outside NAME_RE, so this file is planted by hand: each name or family outside it prints
  // `unrecognised`, once, and no byte of any of them reaches the output.
  it('the WARN line holds names only', async () => {
    const home = await healthyCodexBox('ccrc-doctor-codex-drift-bounded-', ['codex-a']);
    plantDirectLane(home, 'codex-a');
    const file = statsFile(home, 'codex-a');
    const sentinels = [
      'fx-sentinel value with spaces',
      `fx-sentinel-${'x'.repeat(64)}`,
      'fx-sentinel\nWARN codex: forged line',
      'fx-s\u00ebntinel',   // U+00EB, outside ASCII
      'fx-sentinel\u0000nul',
    ];
    writeFileSync(file, `${JSON.stringify({
      version: 1, lane: 'codex-a',
      unexplained: { eventType: ['response.fx_ok', ...sentinels, 42], 'fx-sentinel family': ['response.fx_two'] },
    })}\n`, { mode: 0o600 });
    chmodSync(file, 0o600);
    const r = runDoctor(home);
    const list = 'eventType:response.fx_ok, eventType:unrecognised, unrecognised:response.fx_two';
    const re = new RegExp(`^${reEsc(DRIFT('codex-a', 3, list))}$`, 'm');
    expect(r.stdout, r.stdout).toMatch(re);
    expect(remedyAfter(r.stdout, re)).toBe(`${DRIFT_FIX}${UNREC_CLAUSE(laneDir(home, 'codex-a'), 'sr')}`);
    expect(r.stdout).not.toMatch(/sentinel|s\u00ebntinel|forged/);
    noRunnerBugLine(r.stdout, 'codex');
  });

  // Fix round 1, M2: the doctor's own `local LC_ALL=C` is what keeps NAME_RE's ranges ASCII. doctorEnv sets LC_ALL=C
  // for every other case, so this one runs with LC_ALL unset and LANG a UTF-8 locale this box has, under which bash's
  // `[A-Za-z]` accepts a letter outside ASCII (measured per sentinel below; skipped where no such locale exists).
  const utf8 = ((): string | null => {
    const have = (spawnSync('locale', ['-a'], { encoding: 'utf8' }).stdout ?? '').split('\n').map((l) => l.trim());
    return ['en_US.UTF-8', 'en_US.utf8', 'en_GB.UTF-8', 'en_GB.utf8', 'C.UTF-8', 'C.utf8'].find((l) => have.includes(l)) ?? null;
  })();
  // Fix round 2: spelled as escapes, so no editor or normaliser can fold either to ASCII unseen. U+212A KELVIN SIGN is
  // the one letter bash's `[A-Za-z]` accepts even under C.utf8 (measured); U+00EB only under a language locale.
  const LEAKY = utf8 === null ? [] : ['fx-s\u00ebntinel', 'fx-\u212aelvin'].filter((s) => spawnSync(BASH,
    ['-c', 're="$2"; [[ "$1" =~ $re ]]', 'probe', s, '^[A-Za-z0-9_.:/-]{1,64}$'],
    { env: { PATH: process.env['PATH'] ?? '', LANG: utf8 } }).status === 0);
  it.skipIf(LEAKY.length === 0)('the bound holds under a UTF-8 locale: a non-ASCII letter prints unrecognised', async () => {
    const home = await healthyCodexBox('ccrc-doctor-codex-drift-locale-', ['codex-a']);
    plantDirectLane(home, 'codex-a');
    plantStats(statsFile(home, 'codex-a'), `${JSON.stringify({ version: 1, lane: 'codex-a', unexplained: { eventType: ['response.fx_ok', ...LEAKY] } })}\n`);
    const r = runDoctor(home, ['doctor'], { LC_ALL: undefined, LANG: utf8 as string });
    const re = new RegExp(`^${reEsc(DRIFT('codex-a', 2, 'eventType:response.fx_ok, eventType:unrecognised'))}$`, 'm');
    expect(r.stdout, r.stdout).toMatch(re);
    expect(remedyAfter(r.stdout, re)).toBe(`${DRIFT_FIX}${UNREC_CLAUSE(laneDir(home, 'codex-a'), 's')}`);
    expect(r.stdout).not.toMatch(/fx-s.ntinel|elvin/);
  });

  // Fix round 1, T17-CQ1: only a regular file is opened. A FIFO at the stats path would block jq for good, and a
  // symlink would report names from whatever file it points at; each is `_dr_cx_bridge_files`' FAIL, and no drift row.
  it('a stats path that is a FIFO or a symlink is never read: its FAIL, and no drift row', async () => {
    const home = await healthyCodexBox('ccrc-doctor-codex-drift-kind-', ['codex-a', 'codex-b']);
    for (const id of ['codex-a', 'codex-b']) plantDirectLane(home, id);
    const fifo = statsFile(home, 'codex-a');
    expect(spawnSync('mkfifo', [fifo]).status).toBe(0);
    const link = statsFile(home, 'codex-b');
    const elsewhere = join(home, 'elsewhere.stats.json');
    plantStats(elsewhere, `${JSON.stringify({ version: 1, lane: 'codex-b', unexplained: { eventType: [NEW_EVENT] } })}\n`);
    symlinkSync(elsewhere, link);
    const r = runDoctorBounded(home, 30_000);
    for (const [id, f] of [['codex-a', fifo], ['codex-b', link]]) {
      expect(r.stdout, r.stdout).toMatch(new RegExp(`^FAIL codex: ${id}'s bridge stats file ${reEsc(f)} is not a regular file \\(`, 'm'));
    }
    expect(r.stdout).not.toMatch(/the bridge met/);
    noRunnerBugLine(r.stdout, 'codex');
  }, 45_000);   // above runDoctorBounded's 30 s deadline, so that deadline is what reds

  // Fix round 1, M1: a regular stats file this row cannot read as the bridge's is never "no unexplained name". Each
  // file below holds an unexplained name, so a reader that took it would print a drift row.
  it('a stats file that is not JSON, or has no unexplained object, is unmeasured, never no drift', async () => {
    const home = await healthyCodexBox('ccrc-doctor-codex-drift-unread-', ['codex-a', 'codex-b']);
    for (const id of ['codex-a', 'codex-b']) plantDirectLane(home, id);
    plantStats(statsFile(home, 'codex-a'), `{"version": 1, "lane": "codex-a", "unexplained": {"eventType": ["${NEW_EVENT}"]}\n`);
    plantStats(statsFile(home, 'codex-b'), `${JSON.stringify({ version: 1, lane: 'codex-b', names: { eventType: { [NEW_EVENT]: 1 } } })}\n`);
    const r = runDoctor(home);
    expect(r.stdout, r.stdout).not.toMatch(/the bridge met \d/);
    for (const id of ['codex-a', 'codex-b']) expectUnmeasured(r.stdout, id, statsFile(home, id), NOT_V1, MOVE_FIX(id, statsFile(home, id)));
    noRunnerBugLine(r.stdout, 'codex');
  });

  // Fix round 2, M1 and R1: the unmeasured state survives another finding. Lane a's file is unparseable while lane b
  // has a drift WARN of its own, so the codex line is not PASS, and lane a is still said.
  it('a stats file the row cannot read is said beside another lane\'s WARN', async () => {
    const home = await healthyCodexBox('ccrc-doctor-codex-drift-unread-beside-', ['codex-a', 'codex-b']);
    for (const id of ['codex-a', 'codex-b']) plantDirectLane(home, id);
    plantStats(statsFile(home, 'codex-a'), `{"version": 1, "lane": "codex-a", "unexplained": {"eventType": ["${NEW_EVENT}"]}\n`);
    await writeStats(home, 'codex-b', [['eventType', NEW_EVENT]]);
    const r = runDoctor(home);
    expect(r.stdout, r.stdout).toMatch(new RegExp(`^${reEsc(DRIFT('codex-b', 1, `eventType:${NEW_EVENT}`))}$`, 'm'));
    expect(lineFor(r.stdout, 'codex') ?? '', r.stdout).not.toMatch(/^PASS /);
    expectUnmeasured(r.stdout, 'codex-a', statsFile(home, 'codex-a'), NOT_V1, MOVE_FIX('codex-a', statsFile(home, 'codex-a')));
    expect(r.stdout).not.toMatch(/codex-a: the bridge met \d/);
    noRunnerBugLine(r.stdout, 'codex');
  });

  // Fix round 1, T17-CQ2: the bridge carries a file only when its version is 1 AND its lane is this lane, and resets
  // any other at its next start (stats.py `_load`); the doctor reads the same files as the bridge's.
  it('a stats file of another version or another lane gives no drift row, and is unmeasured', async () => {
    const home = await healthyCodexBox('ccrc-doctor-codex-drift-foreign-', ['codex-a', 'codex-b']);
    for (const id of ['codex-a', 'codex-b']) plantDirectLane(home, id);
    plantStats(statsFile(home, 'codex-a'), `${JSON.stringify({ version: 2, lane: 'codex-a', unexplained: { eventType: [NEW_EVENT] } })}\n`);
    plantStats(statsFile(home, 'codex-b'), `${JSON.stringify({ version: 1, lane: 'codex-a', unexplained: { eventType: [NEW_EVENT] } })}\n`);
    const r = runDoctor(home);
    expect(r.stdout, r.stdout).not.toMatch(/the bridge met \d/);
    for (const id of ['codex-a', 'codex-b']) expectUnmeasured(r.stdout, id, statsFile(home, id), NOT_V1, MOVE_FIX(id, statsFile(home, id)));
    noRunnerBugLine(r.stdout, 'codex');
  });

  // Fix round 1, T17-CQ4: a stats file over stats.py's READ_MAX is one the bridge reads as unreadable (and resets), so
  // the doctor never runs jq on it. This one is a well-formed v1 file padded with whitespace past the bound.
  it('a stats file larger than READ_MAX is unmeasured, and no drift row', async () => {
    const home = await healthyCodexBox('ccrc-doctor-codex-drift-large-', ['codex-a']);
    plantDirectLane(home, 'codex-a');
    const body = `${JSON.stringify({ version: 1, lane: 'codex-a', unexplained: { eventType: [NEW_EVENT] } })}\n`;
    plantStats(statsFile(home, 'codex-a'), Buffer.concat([Buffer.from(body), Buffer.alloc(16 * 2 ** 20, 0x20)]));
    const r = runDoctor(home);
    expect(r.stdout, r.stdout).not.toMatch(/the bridge met \d/);
    const file = statsFile(home, 'codex-a');
    expectUnmeasured(r.stdout, 'codex-a', file, 'it is larger than the bridge reads, READ_MAX in ccd/codexbridge/stats.py', MOVE_FIX('codex-a', file));
  });

  // Fix round 2, R4: a size `stat` cannot measure is unmeasured too, never size 0. The stub fails only the size
  // query of this one file (`%s`, or darwin's `%z`) and runs the real `stat` for everything else, its mode included.
  it('a stats file whose size cannot be measured is unmeasured, and no drift row', async () => {
    const home = await healthyCodexBox('ccrc-doctor-codex-drift-nosize-', ['codex-a']);
    plantDirectLane(home, 'codex-a');
    const file = await writeStats(home, 'codex-a', [['eventType', NEW_EVENT]]);
    const realStat = realPath('stat');
    unstub(home, 'stat');   // the fixture's `stat` is a symlink to the real binary: never write through it
    stub(home, 'stat', `for a in "$@"; do last="$a"; done\ncase "$*" in *%s*|*%z*) [ "$last" != ${shq(file)} ] || exit 1 ;; esac\nexec ${shq(realStat)} "$@"`);
    const r = runDoctor(home);
    expect(r.stdout, r.stdout).not.toMatch(/the bridge met \d/);
    expectUnmeasured(r.stdout, 'codex-a', file, 'its size could not be measured',
      `  remedy: check that stat runs on PATH (coreutils on a GNU box, the base system on macOS) and can read ${file}, then re-run doctor`);
    expect(r.stdout).not.toMatch(/bridge stats file .* has mode/);
  });

  // Fix round 2, R5: a bridge writes at most NAMES_MAX names and `overflow` in each of known.KNOWN's families, so a
  // file listing more is no bridge's, and the row never walks it name by name.
  it('a stats file listing more names than any bridge writes is unmeasured, and no drift row', async () => {
    const home = await healthyCodexBox('ccrc-doctor-codex-drift-many-', ['codex-a']);
    plantDirectLane(home, 'codex-a');
    // One past the most a bridge writes, from the shipped sources: known.KNOWN's families times NAMES_MAX + 1, plus one.
    const { namesMax, families } = bridgeBounds();
    const many = Array.from({ length: families.length * (namesMax + 1) + 1 }, (_, i) => `response.fx_m${i}`);
    const file = statsFile(home, 'codex-a');
    plantStats(file, `${JSON.stringify({ version: 1, lane: 'codex-a', unexplained: { eventType: many } })}\n`);
    const r = runDoctor(home);
    expect(r.stdout, r.stdout).not.toMatch(/the bridge met \d/);
    expectUnmeasured(r.stdout, 'codex-a', file,
      'it lists more names than the bridge writes, NAMES_MAX names and overflow in each of the families of ccd/codexbridge/known.py',
      MOVE_FIX('codex-a', file));
  });

  // Fix round 3, T17-R2-3: the bound's edge. A file at exactly known.KNOWN's family count times (NAMES_MAX + 1) names,
  // every family full as a bridge leaves it (`overflow` and NAMES_MAX names), is one a real bridge can write, so the
  // row walks it: a drift WARN that counts the rest, and no unmeasured WARN.
  it('a stats file at the most names a bridge writes is walked, never unmeasured', async () => {
    const home = await healthyCodexBox('ccrc-doctor-codex-drift-edge-', ['codex-a']);
    plantDirectLane(home, 'codex-a');
    const { namesMax, families } = bridgeBounds();
    const unexplained = Object.fromEntries(families.map((f, fi) => [f,
      ['overflow', ...Array.from({ length: namesMax }, (_, i) => `response.fx_e${fi}_${String(i).padStart(3, '0')}`)]]));
    const total = families.length * (namesMax + 1);
    const file = statsFile(home, 'codex-a');
    plantStats(file, `${JSON.stringify({ version: 1, lane: 'codex-a', unexplained })}\n`);
    const r = runDoctor(home);
    expect(r.stdout, r.stdout).not.toMatch(/cannot be read as the bridge's/);
    const first = unexplained[families[0]];
    const shown = first.slice(0, 32).map((n) => `${families[0]}:${n}`).join(', ');
    const re = new RegExp(`^${reEsc(DRIFT('codex-a', total, `${shown}, … and ${total - 32} more`))}$`, 'm');
    expect(r.stdout).toMatch(re);
    expect(remedyAfter(r.stdout, re)).toBe(`${DRIFT_FIX}${OVER_CLAUSE(laneDir(home, 'codex-a'), 'shr')}`);
    noRunnerBugLine(r.stdout, 'codex');
  });

  // Fix round 3, T17-R2-1: a stats file this user cannot open is said as that, never as "not version 1". The file is a
  // real `Stats` file of this lane, so only its mode keeps it from being read; its mode FAIL is said beside it.
  it.skipIf(process.getuid?.() === 0)('a stats file that cannot be opened is unmeasured as unreadable, and no drift row', async () => {
    const home = await healthyCodexBox('ccrc-doctor-codex-drift-noread-', ['codex-a']);
    plantDirectLane(home, 'codex-a');
    const file = await writeStats(home, 'codex-a', [['eventType', NEW_EVENT]]);
    chmodSync(file, 0o000);
    const r = runDoctor(home);
    expect(r.stdout, r.stdout).not.toMatch(/the bridge met \d/);
    expectUnmeasured(r.stdout, 'codex-a', file, 'it could not be opened for reading',
      `  remedy: make ${file} readable by the user the bridge and doctor run as: if another user owns it, chown it to that user; then chmod 600 ${file} (the mode the bridge keeps it at), and re-run doctor`);
    expect(r.stdout).toMatch(new RegExp(`^FAIL codex: codex-a's bridge stats file ${reEsc(file)} has mode `, 'm'));
  });

  // Fix round 1, T17-CQ3 and T17-CQ4, through the real `Stats`: a 65-character name is listed as `unrecognised`, and a
  // 257th distinct name as `overflow`; the remedy says each is a marker and never a name for known.py. The line prints
  // the first 32 names and counts the rest, while <n> stays the full distinct count.
  it('unrecognised and overflow are named as markers, and the line prints 32 names and counts the rest', async () => {
    const home = await healthyCodexBox('ccrc-doctor-codex-drift-markers-', ['codex-a', 'codex-b']);
    for (const id of ['codex-a', 'codex-b']) plantDirectLane(home, id);
    await writeStats(home, 'codex-a', [['eventType', `response.${'x'.repeat(56)}`]]);
    const many = Array.from({ length: 257 }, (_, i) => `response.fx_n${String(i).padStart(3, '0')}`);
    const fileB = await writeStats(home, 'codex-b', many.map((n) => ['eventType', n] as const));
    const heldB = (JSON.parse(readFileSync(fileB, 'utf8')) as { unexplained: { eventType: string[] } }).unexplained.eventType;
    expect(heldB).toHaveLength(257);
    expect(heldB[0]).toBe('overflow');
    const r = runDoctor(home);
    const reA = new RegExp(`^${reEsc(DRIFT('codex-a', 1, 'eventType:unrecognised'))}$`, 'm');
    expect(r.stdout, r.stdout).toMatch(reA);
    expect(remedyAfter(r.stdout, reA)).toBe(`${DRIFT_FIX}${UNREC_CLAUSE(laneDir(home, 'codex-a'), 's')}`);
    const shown = ['eventType:overflow', ...many.slice(0, 31).map((n) => `eventType:${n}`)].join(', ');
    const reB = new RegExp(`^${reEsc(DRIFT('codex-b', 257, `${shown}, … and 225 more`))}$`, 'm');
    expect(r.stdout).toMatch(reB);
    expect(remedyAfter(r.stdout, reB)).toBe(`${DRIFT_FIX}${OVER_CLAUSE(laneDir(home, 'codex-b'), 's')}`);
    noRunnerBugLine(r.stdout, 'codex');
  });

  // The whole-wave fix round, Z2: a request-side family's names come from Claude Code's request, which no recording
  // holds, so its marker's remedy never sends the operator to the record-streams marker. The name is a real `Stats`
  // one, 65 characters, so the bridge lists it as `requestField:unrecognised`.
  it('a request-side marker is never sent to record-streams, and its clause says a restart clears it', async () => {
    const home = await healthyCodexBox('ccrc-doctor-codex-drift-reqmarker-', ['codex-a']);
    plantDirectLane(home, 'codex-a');
    await writeStats(home, 'codex-a', [['requestField', `fx_${'x'.repeat(62)}`]]);
    const r = runDoctor(home);
    const re = new RegExp(`^${reEsc(DRIFT('codex-a', 1, 'requestField:unrecognised'))}$`, 'm');
    expect(r.stdout, r.stdout).toMatch(re);
    const fix = remedyAfter(r.stdout, re);
    expect(fix).toBe(`${DRIFT_FIX}${UNREC_CLAUSE(laneDir(home, 'codex-a'), 'r')}`);
    expect(fix).not.toContain('record-streams');
    noRunnerBugLine(r.stdout, 'codex');
  });

  // One bound, two spellings that cannot drift: the bridge bounds every name it writes by stats.py's NAME_RE, and the
  // doctor bounds every name it prints by the same pattern text.
  it('the doctor bounds a name by stats.py\'s NAME_RE, spelled the same', () => {
    const py = [...readFileSync(join(REPO, 'ccd', 'codexbridge', 'stats.py'), 'utf8').matchAll(/^NAME_RE = re\.compile\(r"([^"]+)"\)$/gm)];
    const sh = [...readFileSync(CHECKS_SRC, 'utf8').matchAll(/^\s*local name_re='([^']+)'$/gm)];
    expect(py).toHaveLength(1);
    expect(sh).toHaveLength(1);
    expect(sh[0][1]).toBe(py[0][1]);
  });

  it('the doctor reads no stats file larger than stats.py\'s READ_MAX, spelled the same', () => {
    const py = [...readFileSync(join(REPO, 'ccd', 'codexbridge', 'stats.py'), 'utf8').matchAll(/^READ_MAX = ([^#\n]+?)\s+#/gm)];
    const sh = [...readFileSync(CHECKS_SRC, 'utf8').matchAll(/^\s*local read_max=\$\(\( ([^)]+?) \)\)$/gm)];
    expect(py).toHaveLength(1);
    expect(sh).toHaveLength(1);
    expect(sh[0][1]).toBe(py[0][1]);
  });

  // Fix round 2, R5: the most names a bridge writes is known.KNOWN's family count times NAMES_MAX plus `overflow`.
  it('the doctor bounds a file\'s names by stats.py\'s NAMES_MAX and known.KNOWN\'s families, counted the same', () => {
    const { namesMax, families } = bridgeBounds();
    const sh = [...readFileSync(CHECKS_SRC, 'utf8').matchAll(/^\s*local names_max=(\d+) families=(\d+) /gm)];
    expect(sh).toHaveLength(1);
    expect(new Set(families).size).toBe(families.length);
    expect(Number(sh[0][1])).toBe(namesMax);
    expect(Number(sh[0][2])).toBe(families.length);
  });

  // D-7677: the store row, beside the drift row on a direct lane, reads the stats file's `store` entry through the
  // same reader (`_dr_cx_stats_read`). The fixture lanes run no tier, so every WARN below is read off a bridge that is
  // not running: the row names the LAST process, the one that wrote the file (it is asked before `_dr_cx_tiers`
  // measures the bridge), and the next start's entry clears it.
  describe('the store row (D-7677)', () => {
    const AT = 1767225600;   // 2026-01-01T00:00:00.000Z
    const AT_ISO = '2026-01-01T00:00:00.000Z';
    const COPY = 'reasoning.sqlite.damaged-20260101T000000Z';
    const STORE_LINE = /the bridge's reasoning store is switched off|found its reasoning store damaged|a set-aside copy of the lane's reasoning store/;
    const DISABLED = (id: string, reason: string, at: string, copy = ''): string =>
      `WARN codex: ${id}: the bridge's reasoning store is switched off for the rest of its last process (${reason}, since ${at}): every request that process answers is answered without the model's earlier reasoning replayed${copy} (names only, never content).`;
    const COPY_CLAUSE = (found: string, file: string): string => `; at its start it had set its damaged store (${found}) aside as ${file}`;
    const DISABLED_FIX = (id: string): string =>
      `  remedy: restart the lane's bridge so its start check runs again: ccrc codex stop ${id}, then ccrc codex start ${id} (a bridge that is not running needs the start alone, which every session launch runs too); the stop drains the bridge, so a request in flight gets DRAIN_S (ccd/codexbridge/server.py) to finish and one still open then is cut with an error that Claude Code sends again. At the start a damaged store is set aside and a fresh one made, and this line clears once the new process writes its stats file, before it serves`;
    const SET_ASIDE = (id: string, found: string, file: string): string =>
      `WARN codex: ${id}: at its start the bridge found its reasoning store damaged (${found}) and set it aside as ${file}, starting a fresh store; only the model's earlier reasoning was lost.`;
    const SET_ASIDE_FIX = (dir: string, file: string): string =>
      `  remedy: nothing to repair: the bridge serves from its fresh store. Read the copy, ${dir}/${file}, if the damage needs explaining, then delete it with its -wal and -shm (rm -f -- ${dir}/${file} ${dir}/${file}-wal ${dir}/${file}-shm), and this line clears; the bridge keeps only the newest copy, and ccrc never deletes one for you`;
    // Fix round 4, G1: a copy found on disk in every case but a `set-aside` entry naming it (an `ok` entry after a
    // restart, a `disabled` one, an entry naming another file) is NEUTRAL: it never says the bridge serves from a
    // fresh store. `found` is said only when the entry's copy is this one; a `disabled` entry adds its pointer.
    const NEUTRAL = (id: string, file: string, found = '', disabled = false): string =>
      `WARN codex: ${id}: a set-aside copy of the lane's reasoning store, ${file}, is in the lane directory${found === '' ? '' : ` (set aside at a start that found the store damaged: ${found})`}${disabled ? '; the line above names the store\'s own repair' : ''}.`;
    const NEUTRAL_FIX = (dir: string, file: string): string =>
      `  remedy: read the copy, ${dir}/${file}, if the damage needs explaining, then delete it with its -wal and -shm (rm -f -- ${dir}/${file} ${dir}/${file}-wal ${dir}/${file}-shm), and this line clears; the bridge keeps only the newest copy, and ccrc never deletes one for you`;
    // Fix round 3, F4: a newer build's store is never checked or touched, so a restart is not its remedy.
    const NEWER_FIX = (id: string, dir: string): string =>
      `  remedy: a newer build of the bridge wrote this reasoning store (its user_version is above USER_VERSION in ccd/codexbridge/store.py), and a restart does not change it: the start never checks or touches a newer store. Run that build again (ccrc update --to <its version>, or ccrc rollout --to <its version> across the fleet), or stop the lane (ccrc codex stop ${id}), move ${dir}/reasoning.sqlite and its -wal and -shm aside by hand, then start it again (ccrc codex start ${id}): the bridge makes a fresh store, without the model's earlier reasoning — ccrc never moves it for you`;
    /** Lane `id`'s stats file as its bridge writes it, with `events` passed to the real `Stats.store_event`. */
    const writeStore = async (home: string, id: string,
      events: ReadonlyArray<{ reason: string; found?: string; file?: string }>): Promise<string> => {
      const file = statsFile(home, id);
      const ops = [
        { op: 'stats-open', path: file, lane: id },
        ...events.map((e) => ({ op: 'stats-call', method: 'store_event', args: [e.reason],
          kwargs: { ...(e.found === undefined ? {} : { found: e.found }), ...(e.file === undefined ? {} : { file: e.file }), now: AT } })),
        { op: 'stats-call', method: 'flush', kwargs: { force: true } },
      ];
      const r = await runBridgeDriver(home, { ops });
      expect(r.timedOut, r.stderr).toBe(false);
      const lines = driverLines(r.stdout);
      expect(lines.map((l) => l['op']), `${r.stdout}\n${r.stderr}`).toEqual(ops.map((o) => o.op));
      for (const l of lines) expect(l['raised'], JSON.stringify(l)).toBeUndefined();
      return file;
    };
    const storeOf = (file: string): unknown => (JSON.parse(readFileSync(file, 'utf8')) as { store?: unknown }).store;
    /** The line `line` exactly once, with `fix` as its remedy. */
    const expectOnce = (stdout: string, line: string, fix: string): void => {
      const re = new RegExp(`^${reEsc(line)}$`, 'm');
      expect(stdout, stdout).toMatch(re);
      expect(remedyAfter(stdout, re)).toBe(fix);
      expect(stdout.split('\n').filter((l) => STORE_LINE.test(l))).toHaveLength(1);
    };
    /** Fix round 4, G1: a `disabled` entry with a copy on disk prints exactly two store lines, in this order: the
     *  entry's `disabled` WARN with the restart remedy, then the NEUTRAL copy line, which never says "fresh store". */
    const expectDisabledThenCopy = (stdout: string, disabled: string, disabledFix: string, copy: string, copyFix: string): void => {
      expect(stdout.split('\n').filter((l) => STORE_LINE.test(l)), stdout).toEqual([disabled, copy]);
      expect(remedyAfter(stdout, new RegExp(`^${reEsc(disabled)}$`, 'm'))).toBe(disabledFix);
      const copyRe = new RegExp(`^${reEsc(copy)}$`, 'm');
      expect(remedyAfter(stdout, copyRe)).toBe(copyFix);
      const ls = stdout.split('\n');
      const i = ls.findIndex((l) => copyRe.test(l));
      expect(`${ls[i]}\n${ls[i + 1]}`).not.toContain('fresh store');
    };

    // (a) A bridge from before the entry writes no `store` key: no row, never read as `ok` or as anything else.
    // (b) A fresh `Stats` writes `ok`: no row.
    it('a stats file with no store entry, or an ok one, has no store row', async () => {
      const home = await healthyCodexBox('ccrc-doctor-codex-store-none-', ['codex-a', 'codex-b']);
      for (const id of ['codex-a', 'codex-b']) plantDirectLane(home, id);
      const a = await writeStore(home, 'codex-a', [{ reason: 'store:DatabaseError' }]);
      const doc = JSON.parse(readFileSync(a, 'utf8')) as Record<string, unknown>;
      delete doc['store'];
      plantStats(a, JSON.stringify(doc));
      const b = await writeStore(home, 'codex-b', []);
      expect(storeOf(b)).toEqual({ state: 'ok', reason: null, at: null, setAside: null });
      const r = runDoctor(home);
      expect(r.stdout, r.stdout).not.toMatch(STORE_LINE);
      for (const id of ['codex-a', 'codex-b']) {
        expect(lineFor(r.stdout, 'codex') ?? '', r.stdout).toMatch(new RegExp(`^PASS codex: .*${reEsc(id)} \\(ports \\d+\\/\\d+, direct mode, `));
      }
      noRunnerBugLine(r.stdout, 'codex');
    });

    // (c) A store disabled by a request: the WARN with its reason and time, and the restart remedy.
    it('a disabled store warns with its reason, and the remedy restarts the bridge', async () => {
      const home = await healthyCodexBox('ccrc-doctor-codex-store-disabled-', ['codex-a']);
      plantDirectLane(home, 'codex-a');
      const file = await writeStore(home, 'codex-a', [{ reason: 'store:DatabaseError' }]);
      expect(storeOf(file)).toEqual({ state: 'disabled', reason: 'store:DatabaseError', at: AT_ISO, setAside: null });
      const r = runDoctor(home);
      expectOnce(r.stdout, DISABLED('codex-a', 'store:DatabaseError', AT_ISO), DISABLED_FIX('codex-a'));
      noRunnerBugLine(r.stdout, 'codex');
    });

    // (d) A set-aside that failed after its renames names its copy (D-7676): the WARN names it too. The copy is then
    // always on disk (store.py names it only once its rename succeeded), so it is planted here, and the real output is
    // pinned: the `disabled` WARN with the restart remedy, then the NEUTRAL copy line (fix round 4, G1).
    it('a failed set-aside that named its copy warns as disabled, naming the copy, and its copy line is neutral', async () => {
      const home = await healthyCodexBox('ccrc-doctor-codex-store-failed-', ['codex-a']);
      plantDirectLane(home, 'codex-a');
      const file = await writeStore(home, 'codex-a', [{ reason: 'store:set-aside-failed', found: 'integrity-check', file: COPY }]);
      expect(storeOf(file)).toMatchObject({ state: 'disabled', reason: 'store:set-aside-failed', setAside: { found: 'integrity-check', file: COPY } });
      const dir = laneDir(home, 'codex-a');
      writeFileSync(join(dir, COPY), 'fixture\n', { mode: 0o600 });
      const r = runDoctor(home);
      expectDisabledThenCopy(r.stdout,
        DISABLED('codex-a', 'store:set-aside-failed', AT_ISO, COPY_CLAUSE('integrity-check', COPY)), DISABLED_FIX('codex-a'),
        NEUTRAL('codex-a', COPY, 'integrity-check', true), NEUTRAL_FIX(dir, COPY));
      noRunnerBugLine(r.stdout, 'codex');
    });

    // Fix round 4, G1: a store disabled at runtime, with an older copy still on disk, prints the same two lines; the
    // entry names no copy, so the copy line says no `found`.
    it('a store disabled at runtime with an older copy on disk warns as disabled, and its copy line is neutral', async () => {
      const home = await healthyCodexBox('ccrc-doctor-codex-store-disabled-copy-', ['codex-a']);
      plantDirectLane(home, 'codex-a');
      const file = await writeStore(home, 'codex-a', [{ reason: 'store:OperationalError' }]);
      expect(storeOf(file)).toEqual({ state: 'disabled', reason: 'store:OperationalError', at: AT_ISO, setAside: null });
      const dir = laneDir(home, 'codex-a');
      writeFileSync(join(dir, COPY), 'fixture\n', { mode: 0o600 });
      const r = runDoctor(home);
      expectDisabledThenCopy(r.stdout,
        DISABLED('codex-a', 'store:OperationalError', AT_ISO), DISABLED_FIX('codex-a'),
        NEUTRAL('codex-a', COPY, '', true), NEUTRAL_FIX(dir, COPY));
      noRunnerBugLine(r.stdout, 'codex');
    });

    // (e) A set-aside whose copy is still in the lane directory: the WARN names it, and the remedy is to delete it.
    // (f) The same once the copy is deleted: no row.
    it('a set-aside warns while its copy is in the lane directory, and clears once the copy is deleted', async () => {
      const home = await healthyCodexBox('ccrc-doctor-codex-store-aside-', ['codex-a']);
      plantDirectLane(home, 'codex-a');
      const file = await writeStore(home, 'codex-a', [{ reason: 'store:set-aside', found: 'DatabaseError', file: COPY }]);
      expect(storeOf(file)).toMatchObject({ state: 'set-aside', reason: 'store:set-aside', setAside: { found: 'DatabaseError', file: COPY } });
      const copy = join(laneDir(home, 'codex-a'), COPY);
      writeFileSync(copy, 'fixture\n', { mode: 0o600 });
      const r = runDoctor(home);
      expectOnce(r.stdout, SET_ASIDE('codex-a', 'DatabaseError', COPY), SET_ASIDE_FIX(laneDir(home, 'codex-a'), COPY));
      noRunnerBugLine(r.stdout, 'codex');
      rmSync(copy);
      const again = runDoctor(home);
      expect(again.stdout, again.stdout).not.toMatch(STORE_LINE);
      expect(lineFor(again.stdout, 'codex') ?? '', again.stdout).toMatch(/^PASS codex: /);
      noRunnerBugLine(again.stdout, 'codex');
    });

    // (g) A lane switched back to litellm keeps its stats file and the entry its last bridge wrote: no bridge runs
    // there, so the entry is no row of that lane's. Lane b, direct, with the same entry, still warns.
    it('a litellm lane has no store row', async () => {
      const home = await healthyCodexBox('ccrc-doctor-codex-store-litellm-', ['codex-a', 'codex-b']);
      plantDirectLane(home, 'codex-b');
      for (const id of ['codex-a', 'codex-b']) await writeStore(home, id, [{ reason: 'store:DatabaseError' }]);
      const r = runDoctor(home);
      expectOnce(r.stdout, DISABLED('codex-b', 'store:DatabaseError', AT_ISO), DISABLED_FIX('codex-b'));
      expect(r.stdout).not.toMatch(/codex-a: the bridge's reasoning store/);
      noRunnerBugLine(r.stdout, 'codex');
    });

    // (h) No `Stats` writes a value outside NAME_RE, so these files are planted by hand: every value outside it, and a
    // copy name that is not a bare name of store.py's shape, prints `unrecognised`, and no byte of it reaches the
    // output. A set-aside whose copy name is not of that shape has nothing to check, so it has no row.
    it('every value the row prints is bounded, else unrecognised', async () => {
      const home = await healthyCodexBox('ccrc-doctor-codex-store-bounded-', ['codex-a', 'codex-b']);
      for (const id of ['codex-a', 'codex-b']) plantDirectLane(home, id);
      const sentinels = ['fx-sentinel value with spaces', 'fx-sentinel\nWARN codex: forged line', `fx-sentinel-${'x'.repeat(64)}`,
        '../fx-sentinel.damaged-20260101T000000Z'];
      const base = { version: 1, since: AT_ISO, startedAt: AT_ISO, updatedAt: AT_ISO, routes: {}, refusals: {}, outcomes: {},
        names: {}, unexplained: {}, usageHeaders: null, lastUpstreamRequestId: null };
      plantStats(statsFile(home, 'codex-a'), JSON.stringify({ ...base, lane: 'codex-a', store: {
        state: 'disabled', reason: sentinels[0], at: sentinels[1], setAside: { at: AT_ISO, found: sentinels[2], file: sentinels[3] } } }));
      // The copy the sentinel names, planted where `..` would reach it: the row never checks a path from the file.
      writeFileSync(join(laneDir(home, 'codex-b'), '..', 'fx-sentinel.damaged-20260101T000000Z'), 'fixture\n', { mode: 0o600 });
      plantStats(statsFile(home, 'codex-b'), JSON.stringify({ ...base, lane: 'codex-b', store: {
        state: 'set-aside', reason: 'store:set-aside', at: AT_ISO, setAside: { at: AT_ISO, found: 'integrity-check', file: sentinels[3] } } }));
      const r = runDoctor(home);
      expectOnce(r.stdout, DISABLED('codex-a', 'unrecognised', 'unrecognised', COPY_CLAUSE('unrecognised', 'unrecognised')), DISABLED_FIX('codex-a'));
      expect(r.stdout).not.toContain('fx-sentinel');
      expect(r.stdout).not.toMatch(/codex-b: at its start the bridge/);
      noRunnerBugLine(r.stdout, 'codex');
    });

    // Fix round 3, F4: `store:newer-version` names what wrote the store, and its remedy is that build, or a hand move.
    it('a store a newer build wrote warns as disabled, and its remedy is that build, never a restart', async () => {
      const home = await healthyCodexBox('ccrc-doctor-codex-store-newer-', ['codex-a']);
      plantDirectLane(home, 'codex-a');
      await writeStore(home, 'codex-a', [{ reason: 'store:newer-version' }]);
      const r = runDoctor(home);
      expectOnce(r.stdout, DISABLED('codex-a', 'store:newer-version', AT_ISO), NEWER_FIX('codex-a', laneDir(home, 'codex-a')));
      noRunnerBugLine(r.stdout, 'codex');
    });

    // Fix round 3, F2: the entry is per process, so a restart writes `ok` while the copy stays. The copy is found on
    // disk, so its WARN lasts until it is deleted; with no entry naming it, the line is NEUTRAL and says no `found`.
    it('a copy still in the lane directory after a restart warns, though the entry reads ok', async () => {
      const home = await healthyCodexBox('ccrc-doctor-codex-store-restarted-', ['codex-a']);
      plantDirectLane(home, 'codex-a');
      const file = await writeStore(home, 'codex-a', []);
      expect(storeOf(file)).toEqual({ state: 'ok', reason: null, at: null, setAside: null });
      const dir = laneDir(home, 'codex-a');
      const older = 'reasoning.sqlite.damaged-20251231T235959Z';
      for (const f of [older, COPY, `${COPY}-wal`, `${COPY}-shm`]) writeFileSync(join(dir, f), 'fixture\n', { mode: 0o600 });
      const r = runDoctor(home);
      // The newest copy by its stamp is the one named; its -wal and -shm are not copies of their own.
      expectOnce(r.stdout, NEUTRAL('codex-a', COPY), NEUTRAL_FIX(dir, COPY));
      noRunnerBugLine(r.stdout, 'codex');
      for (const f of [older, COPY, `${COPY}-wal`, `${COPY}-shm`]) rmSync(join(dir, f));
      const again = runDoctor(home);
      expect(again.stdout, again.stdout).not.toMatch(STORE_LINE);
      noRunnerBugLine(again.stdout, 'codex');
    });

    // Fix round 3, F2/F3: only the store's OWN copy shape counts — keyed on lane.json's `bridgeFiles.store`, a regular
    // file, never a symlink: another file's copy, a short stamp, a suffix and a symlink are no copy, so no row.
    it('a look-alike that is not the store\'s copy, or a symlink of its shape, has no store row', async () => {
      const home = await healthyCodexBox('ccrc-doctor-codex-store-lookalike-', ['codex-a']);
      plantDirectLane(home, 'codex-a');
      await writeStore(home, 'codex-a', []);
      const dir = laneDir(home, 'codex-a');
      for (const f of ['bridge.stats.json.damaged-20260101T000000Z', 'other.sqlite.damaged-20260101T000000Z',
        'reasoning.sqlite.damaged-2026010T000000Z', 'reasoning.sqlite.damaged-20260101T00000Z',
        `${COPY}-x`, `${COPY}-wal`, `x${COPY}`]) {
        writeFileSync(join(dir, f), 'fixture\n', { mode: 0o600 });
      }
      const target = join(home, 'elsewhere-copy');
      writeFileSync(target, 'fixture\n', { mode: 0o600 });
      symlinkSync(target, join(dir, COPY));
      const r = runDoctor(home);
      expect(r.stdout, r.stdout).not.toMatch(STORE_LINE);
      expect(lineFor(r.stdout, 'codex') ?? '', r.stdout).toMatch(/^PASS codex: /);
      noRunnerBugLine(r.stdout, 'codex');
    });

    // Fix round 3, F3: the copy's name shape, end to end. A REAL copy, made by the store's own set-aside at a start
    // (store.py's DAMAGED_STAMP), is named by the doctor's WARN and removed by the lane's reap, so a change of that
    // stamp that the doctor and `_codex_reap_files` do not follow reds this case.
    it('a copy the store itself set aside is named by the WARN and reaped with the lane', async () => {
      const home = await healthyCodexBox('ccrc-doctor-codex-store-real-', ['codex-a']);
      plantDirectLane(home, 'codex-a');
      const dir = laneDir(home, 'codex-a');
      const store = join(dir, (JSON.parse(readFileSync(join(dir, 'lane.json'), 'utf8')) as
        { bridgeFiles: Record<string, string> }).bridgeFiles['store']);
      const ops = [
        { op: 'store-damage', path: store, how: 'not-a-database' },
        { op: 'stats-open', path: statsFile(home, 'codex-a'), lane: 'codex-a' },
        { op: 'store-open', path: store, stats: true },
        { op: 'stats-call', method: 'flush', kwargs: { force: true } },
      ];
      const run = await runBridgeDriver(home, { ops });
      expect(run.timedOut, run.stderr).toBe(false);
      const lines = driverLines(run.stdout);
      expect(lines.map((l) => l['op']), `${run.stdout}\n${run.stderr}`).toEqual(ops.map((o) => o.op));
      expect(lines[2]['disabled'], JSON.stringify(lines[2])).toBeNull();
      const copies = readdirSync(dir).filter((n) => n.startsWith(`${store.slice(dir.length + 1)}.damaged-`));
      expect(copies).toHaveLength(1);
      const copy = copies[0]!;
      const found = (lines[0]['probe'] as { raised: string }).raised;
      const r = runDoctor(home);
      expectOnce(r.stdout, SET_ASIDE('codex-a', found, copy), SET_ASIDE_FIX(dir, copy));
      noRunnerBugLine(r.stdout, 'codex');
      // The reap removes with `rm` and `rmdir`, which the doctor's contained PATH holds only when linked in.
      for (const bin of ['rm', 'rmdir']) linkReal(home, bin);
      const reap = spawnSync(BASH, ['-c', `. ${JSON.stringify(join(home, 'ccrc', 'ccd', 'ccrc'))}; _codex_reap_files codex-a; echo "rc=$?"`],
        { env: doctorEnv(home), encoding: 'utf8' });
      expect(reap.stdout, reap.stderr).toBe('rc=0\n');
      expect(existsSync(join(dir, copy))).toBe(false);
      expect(existsSync(dir), existsSync(dir) ? readdirSync(dir).join(' ') : '').toBe(false);
    });
  });
});


// ── accounts plan Task A11b: the backups checks (D-5513's backups row; G33) ──────────────────────────────────────
// `secrets-backup-excluded` and `filevault` measure a darwin box, `snapshot-posture` states a Linux box's answer, and
// each SKIPs on the other platform. Driven sourced, with `CCD_OS` set AFTER sourcing (ccrc recomputes it, so the
// whole-run cases measure the host's own arm), and with `tmutil` and `fdesetup` as stubs on a PATH of stubs only, so
// both platforms' arms run on any host. `HEALTHY_SKIPS` counts the other platform's two SKIPs; `healthy()` states
// `none` in `~/.ccrc/snapshot-posture`, so a healthy Linux box PASSes `snapshot-posture`.
describe('A11b: the backups doctor checks (D-5513 backups row, G33)', () => {
  const BACKUP_CHECKS = ['secrets-backup-excluded', 'filevault', 'snapshot-posture'] as const;
  type BackupCheck = typeof BACKUP_CHECKS[number];

  /** A home with the given secret directories, and a stub bin holding only the named tools. */
  const box = (o: { secrets?: Array<'.cc-secrets' | '.ccrc/auth-scratch' | '.ccrc/linear' | '.ccrc/operator-secrets'>; stubs?: Record<string, string>; posture?: string | 'dir'; postureLinkTo?: string } = {}): string => {
    const home = mkTmp('ccrc-doctor-a11b-');
    mkdirSync(join(home, '.ccrc'), { recursive: true });
    for (const d of o.secrets ?? []) mkdirSync(join(home, d), { recursive: true, mode: 0o700 });
    const bin = join(home, 'stub-bin');
    mkdirSync(bin, { recursive: true });
    for (const [name, body] of Object.entries(o.stubs ?? {})) {
      writeFileSync(join(bin, name), `#!${BASH}\n${body}\n`, { mode: 0o755 });
    }
    if (o.posture === 'dir') mkdirSync(join(home, '.ccrc', 'snapshot-posture'));
    else if (o.posture !== undefined) writeFileSync(join(home, '.ccrc', 'snapshot-posture'), o.posture);
    if (o.postureLinkTo !== undefined) symlinkSync(join(home, o.postureLinkTo), join(home, '.ccrc', 'snapshot-posture'));
    return home;
  };
  const run = (home: string, check: BackupCheck, os: 'linux' | 'darwin'): Result => {
    const r = spawnSync(BASH, ['-c', `set -uo pipefail; . ${shq(CHECKS_SRC)}; CCD_OS=${os}; _check_${check}`],
      { env: { HOME: home, PATH: join(home, 'stub-bin'), LC_ALL: 'C' }, encoding: 'utf8' });
    return { code: r.status ?? -1, stdout: r.stdout ?? '', stderr: r.stderr ?? '' };
  };
  /** `tmutil isexcluded <path>` in the real tool's shape: `[Excluded]` or `[Included]`, padding, then the path. */
  const tmutil = (answer: (p: string) => string): string =>
    `[ "$1" = isexcluded ] || exit 64\ncase "$2" in\n${['.cc-secrets', '.ccrc/auth-scratch', '.ccrc/linear', '.ccrc/operator-secrets']
      .map((d) => `  */${d}) printf '%s    %s\\n' '${answer(d)}' "$2" ;;`).join('\n')}\n  *) exit 65 ;;\nesac`;
  const fdesetup = (out: string): string => `[ "$1" = status ] || exit 64\nprintf '%s\\n' ${shq(out)}`;
  const lines = (s: string): string[] => s.split('\n').filter(Boolean);

  it('the three are in the check table once each, before the pinned delegation-hooks, and each is declared', () => {
    const names = tableNames();
    for (const n of BACKUP_CHECKS) expect(names.filter((x) => x === n), n).toHaveLength(1);
    expect(names.slice(names.indexOf('secrets-backup-excluded'), names.indexOf('secrets-backup-excluded') + 4))
      .toEqual([...BACKUP_CHECKS, 'delegation-hooks']);
  });

  describe('each SKIPs where its platform does not apply', () => {
    it('filevault SKIPs on Linux, even with an fdesetup on PATH that would answer Off', () => {
      const home = box({ secrets: ['.cc-secrets'], stubs: { fdesetup: fdesetup('FileVault is Off.') } });
      const r = run(home, 'filevault', 'linux');
      expect(lines(r.stdout)).toEqual(['SKIP filevault: FileVault is macOS\'s disk encryption; this box is linux']);
      expect(r.code).toBe(3);
    });

    it('secrets-backup-excluded SKIPs on Linux, even with a tmutil on PATH that would answer [Included]', () => {
      const home = box({ secrets: ['.cc-secrets'], stubs: { tmutil: tmutil(() => '[Included]') } });
      const r = run(home, 'secrets-backup-excluded', 'linux');
      expect(lines(r.stdout)).toEqual([
        'SKIP secrets-backup-excluded: Time Machine is macOS\'s; this box is linux, whose provider-level backups snapshot-posture states']);
      expect(r.code).toBe(3);
    });

    it('snapshot-posture SKIPs on darwin, even with secrets and no stated answer', () => {
      const home = box({ secrets: ['.cc-secrets'] });
      const r = run(home, 'snapshot-posture', 'darwin');
      expect(lines(r.stdout)).toEqual([
        'SKIP snapshot-posture: provider-level snapshots are a Linux box\'s question; this box is darwin, whose backups secrets-backup-excluded measures']);
      expect(r.code).toBe(3);
    });
  });

  describe('secrets-backup-excluded (darwin)', () => {
    it('fails when tmutil isexcluded (stubbed) says no: FAIL naming the included directory, its remedy next, rc 1', () => {
      const home = box({ secrets: ['.cc-secrets', '.ccrc/auth-scratch'],
        stubs: { tmutil: tmutil((d) => (d === '.cc-secrets' ? '[Included]' : '[Excluded]')) } });
      const r = run(home, 'secrets-backup-excluded', 'darwin');
      expect(lines(r.stdout)).toEqual([
        'FAIL secrets-backup-excluded: ~/.cc-secrets included in Time Machine backups, so every backup taken holds the secrets stored in them',
        '  remedy: run \'tmutil addexclusion ~/.cc-secrets\' (an account verb that writes a secret does the same); a backup already taken still holds them, and the compromise steps apply to it',
      ]);
      expect(r.code).toBe(1);
      expect(r.stdout.includes(home), 'the verdict names ~/ paths, never the home').toBe(false);
    });

    it('both directories included: the remedy is one runnable addexclusion naming both, space-separated', () => {
      const home = box({ secrets: ['.cc-secrets', '.ccrc/auth-scratch'], stubs: { tmutil: tmutil(() => '[Included]') } });
      const r = run(home, 'secrets-backup-excluded', 'darwin');
      expect(lines(r.stdout)).toEqual([
        'FAIL secrets-backup-excluded: ~/.cc-secrets; ~/.ccrc/auth-scratch included in Time Machine backups, so every backup taken holds the secrets stored in them',
        '  remedy: run \'tmutil addexclusion ~/.cc-secrets ~/.ccrc/auth-scratch\' (an account verb that writes a secret does the same); a backup already taken still holds them, and the compromise steps apply to it',
      ]);
      expect(r.code).toBe(1);
    });

    it('PASSes when tmutil says every secret directory is excluded, naming each', () => {
      const home = box({ secrets: ['.cc-secrets', '.ccrc/auth-scratch'], stubs: { tmutil: tmutil(() => '[Excluded]') } });
      const r = run(home, 'secrets-backup-excluded', 'darwin');
      expect(lines(r.stdout)).toEqual([
        'PASS secrets-backup-excluded: ~/.cc-secrets; ~/.ccrc/auth-scratch excluded from Time Machine (tmutil isexcluded)']);
      expect(r.code).toBe(0);
    });

    it('measures only the directories that exist: ~/.cc-secrets alone, excluded, PASSes naming it alone', () => {
      const home = box({ secrets: ['.cc-secrets'], stubs: { tmutil: tmutil(() => '[Excluded]') } });
      const r = run(home, 'secrets-backup-excluded', 'darwin');
      expect(lines(r.stdout)).toEqual(['PASS secrets-backup-excluded: ~/.cc-secrets excluded from Time Machine (tmutil isexcluded)']);
    });

    it('SKIPs a darwin box with neither secret directory', () => {
      const home = box({ stubs: { tmutil: tmutil(() => '[Included]') } });
      const r = run(home, 'secrets-backup-excluded', 'darwin');
      expect(lines(r.stdout)).toEqual([
        'SKIP secrets-backup-excluded: no secret directory (~/.cc-secrets, ~/.ccrc/auth-scratch, ~/.ccrc/linear or ~/.ccrc/operator-secrets) exists on this box, so no secret is here to keep out of Time Machine']);
      expect(r.code).toBe(3);
    });

    it('measures a server box\'s two stores, the operator\'s pasted secrets and the Linear slot store, naming each (review 1416 A-F5)', () => {
      const both: ['.ccrc/linear', '.ccrc/operator-secrets'] = ['.ccrc/linear', '.ccrc/operator-secrets'];
      const included = run(box({ secrets: both, stubs: { tmutil: tmutil(() => '[Included]') } }), 'secrets-backup-excluded', 'darwin');
      expect(lines(included.stdout)[0]).toBe(
        'FAIL secrets-backup-excluded: ~/.ccrc/linear; ~/.ccrc/operator-secrets included in Time Machine backups, so every backup taken holds the secrets stored in them');
      expect(included.code).toBe(1);
      const excluded = run(box({ secrets: both, stubs: { tmutil: tmutil(() => '[Excluded]') } }), 'secrets-backup-excluded', 'darwin');
      expect(lines(excluded.stdout)).toEqual([
        'PASS secrets-backup-excluded: ~/.ccrc/linear; ~/.ccrc/operator-secrets excluded from Time Machine (tmutil isexcluded)']);
      expect(excluded.code).toBe(0);
    });

    it('WARNs not measured, never PASSes, when tmutil is not on PATH', () => {
      const home = box({ secrets: ['.cc-secrets'] });
      const r = run(home, 'secrets-backup-excluded', 'darwin');
      expect(lines(r.stdout)).toEqual([
        'WARN secrets-backup-excluded: tmutil is not on PATH, so whether ~/.cc-secrets are excluded from Time Machine was not measured',
        '  remedy: run \'tmutil isexcluded\' on each of them with /usr/bin on PATH',
      ]);
      expect(r.code).toBe(2);
    });

    it('WARNs not measured, never PASSes, when tmutil answers neither word', () => {
      const home = box({ secrets: ['.cc-secrets'], stubs: { tmutil: 'echo "tmutil: isexcluded requires Full Disk Access" >&2; exit 80' } });
      const r = run(home, 'secrets-backup-excluded', 'darwin');
      expect(r.stdout).toMatch(/^WARN secrets-backup-excluded: tmutil isexcluded gave no \[Excluded\] or \[Included\] answer for ~\/\.cc-secrets, so its backup posture was not measured$/m);
      expect(r.stdout).toMatch(/^ {2}remedy: /m);
      expect(r.code).toBe(2);
    });
  });

  describe('filevault (darwin)', () => {
    it('SKIPs a Mac with no lane secret, even with an fdesetup that would answer Off: a fresh install stays green', () => {
      const r = run(box({ stubs: { fdesetup: fdesetup('FileVault is Off.') } }), 'filevault', 'darwin');
      expect(lines(r.stdout)).toEqual([
        'SKIP filevault: no secret directory (~/.cc-secrets, ~/.ccrc/auth-scratch, ~/.ccrc/linear or ~/.ccrc/operator-secrets) exists on this box, so no secret sits on its disk']);
      expect(r.code).toBe(3);
    });

    it('PASSes FileVault is On.', () => {
      const r = run(box({ secrets: ['.cc-secrets'], stubs: { fdesetup: fdesetup('FileVault is On.') } }), 'filevault', 'darwin');
      expect(lines(r.stdout)).toEqual(['PASS filevault: FileVault is On (fdesetup status)']);
      expect(r.code).toBe(0);
    });

    it('WARNs FileVault is Off. with its remedy: the machine\'s policy, never a FAIL that fails an install', () => {
      const r = run(box({ secrets: ['.cc-secrets'], stubs: { fdesetup: fdesetup('FileVault is Off.') } }), 'filevault', 'darwin');
      expect(lines(r.stdout)).toEqual([
        'WARN filevault: FileVault is Off, so the secrets stored in ~/.cc-secrets sit unencrypted and any copy of this disk holds them',
        '  remedy: turn FileVault on in System Settings, Privacy & Security, FileVault (or \'sudo fdesetup enable\')',
      ]);
      expect(r.code).toBe(2);
    });

    it('WARNs a disk that is turning off, though its first line still says On', () => {
      const r = run(box({ secrets: ['.cc-secrets'], stubs: { fdesetup: fdesetup('FileVault is On.\nDecryption in progress: Percent completed = 12') } }), 'filevault', 'darwin');
      expect(lines(r.stdout)).toEqual([
        'WARN filevault: FileVault is turning off (fdesetup status: Decryption in progress), so the secrets stored in ~/.cc-secrets will sit unencrypted',
        '  remedy: turn FileVault back on in System Settings, Privacy & Security, FileVault (or \'sudo fdesetup enable\')',
      ]);
      expect(r.code).toBe(2);
    });

    it('WARNs not measured when fdesetup is not on PATH, and when it answers neither On nor Off', () => {
      const absent = run(box({ secrets: ['.cc-secrets'] }), 'filevault', 'darwin');
      expect(absent.stdout).toMatch(/^WARN filevault: fdesetup is not on PATH, so whether FileVault is on was not measured$/m);
      expect(absent.code).toBe(2);
      const odd = run(box({ secrets: ['.cc-secrets'], stubs: { fdesetup: fdesetup('Error: unexpected answer') } }), 'filevault', 'darwin');
      expect(odd.stdout).toMatch(/^WARN filevault: fdesetup status answered 'Error: unexpected answer', so whether FileVault is on was not measured$/m);
      expect(odd.code).toBe(2);
    });
  });

  describe('snapshot-posture (Linux): the operator\'s answer, stated, never guessed', () => {
    it('SKIPs a box with no secret directory', () => {
      const r = run(box(), 'snapshot-posture', 'linux');
      expect(lines(r.stdout)).toEqual([
        'SKIP snapshot-posture: no secret directory (~/.cc-secrets, ~/.ccrc/auth-scratch, ~/.ccrc/linear or ~/.ccrc/operator-secrets) exists on this box, so no secret is here for a provider image to hold']);
      expect(r.code).toBe(3);
    });

    it('measures a server box that holds the operator\'s pasted secrets or the Linear slot store (review 1389 A7, the PL6 follow-up)', () => {
      for (const dir of ['.ccrc/operator-secrets', '.ccrc/linear']) {
        // The fixture's `secrets` type names the two lane-secret directories; it makes any directory it is given.
        const r = run(box({ secrets: [dir] as never }), 'snapshot-posture', 'linux');
        expect(lines(r.stdout)[0], dir).toBe(`WARN snapshot-posture: not stated: whether the provider keeps backups or snapshots of this box, which would hold ~/${dir}, is the operator's answer, and doctor does not guess it`);
        expect(r.code, dir).toBe(2);
      }
      const mac = run(box({ secrets: ['.ccrc/operator-secrets'] as never, stubs: { fdesetup: fdesetup('FileVault is On.') } }), 'filevault', 'darwin');
      expect(lines(mac.stdout)).toEqual(['PASS filevault: FileVault is On (fdesetup status)']);
    });

    it('WARNs "not stated" when a box holding secrets has no answer, and says how to state it', () => {
      const r = run(box({ secrets: ['.cc-secrets'] }), 'snapshot-posture', 'linux');
      expect(lines(r.stdout)).toEqual([
        'WARN snapshot-posture: not stated: whether the provider keeps backups or snapshots of this box, which would hold ~/.cc-secrets, is the operator\'s answer, and doctor does not guess it',
        '  remedy: write one line to ~/.ccrc/snapshot-posture: none, or the ones that apply of server-backups server-snapshots volume-snapshots',
      ]);
      expect(r.code).toBe(2);
    });

    it('PASSes a stated none', () => {
      const r = run(box({ secrets: ['.cc-secrets'], posture: '# asked at install\n\nnone\n' }), 'snapshot-posture', 'linux');
      expect(lines(r.stdout)).toEqual(['PASS snapshot-posture: stated: the provider keeps no backups or snapshots of this box']);
      expect(r.code).toBe(0);
    });

    it('PASSes a stated provider image, naming it once each and that the image holds the secrets', () => {
      const r = run(box({ secrets: ['.ccrc/auth-scratch'], posture: 'volume-snapshots server-backups volume-snapshots' }), 'snapshot-posture', 'linux');
      expect(lines(r.stdout)).toEqual([
        'PASS snapshot-posture: stated: volume-snapshots, server-backups; every such image taken while a secret was stored in ~/.ccrc/auth-scratch holds it, and the compromise steps apply to a leaked or restored one']);
      expect(r.code).toBe(0);
    });

    for (const [why, posture] of [['an unknown word', 'nightly'], ['none beside a provider image', 'none server-backups'], ['only comments', '# not answered yet\n']] as const) {
      it(`FAILs ${why}: a mistyped answer never reads as stated`, () => {
        const r = run(box({ secrets: ['.cc-secrets'], posture }), 'snapshot-posture', 'linux');
        expect(r.stdout).toMatch(/^FAIL snapshot-posture: ~\/\.ccrc\/snapshot-posture states (nothing|\d+ words? doctor does not know), which is not none or a list of server-backups server-snapshots volume-snapshots; the line is never quoted$/m);
        expect(r.stdout).toMatch(/^ {2}remedy: write one line to ~\/\.ccrc\/snapshot-posture: /m);
        expect(r.code).toBe(1);
      });
    }

    it('never prints the stated line: a token-shaped or escape-laden line FAILs counting its words, and none of it reaches stdout', () => {
      const token = 'LANE_TOKEN=fixture-secret-value-0123456789';
      const r = run(box({ secrets: ['.cc-secrets'], posture: `${token} \u001b[2Jcleared\n` }), 'snapshot-posture', 'linux');
      expect(lines(r.stdout)[0]).toBe('FAIL snapshot-posture: ~/.ccrc/snapshot-posture states 2 words doctor does not know, which is not none or a list of server-backups server-snapshots volume-snapshots; the line is never quoted');
      expect(r.stdout.includes('fixture-secret-value'), 'the line is never echoed').toBe(false);
      expect(r.stdout.includes('\u001b'), 'no escape byte is echoed').toBe(false);
      expect(r.code).toBe(1);
    });

    it('refuses a symlinked answer file, even one pointing at a readable secret: FAIL, nothing of the target printed', () => {
      const home = box({ secrets: ['.cc-secrets'] });
      writeFileSync(join(home, '.cc-secrets', 'lane-a.env'), 'none\n');
      const linked = box({ secrets: ['.cc-secrets'], postureLinkTo: '.cc-secrets/lane-a.env' });
      writeFileSync(join(linked, '.cc-secrets', 'lane-a.env'), 'LANE_TOKEN=fixture-secret-value-0123456789\n');
      const r = run(linked, 'snapshot-posture', 'linux');
      expect(lines(r.stdout)[0]).toBe('FAIL snapshot-posture: ~/.ccrc/snapshot-posture is a symlink, not a plain file, so doctor does not read it');
      expect(r.stdout.includes('fixture-secret-value')).toBe(false);
      expect(r.code).toBe(1);
      // a symlink to a file that would PASS is refused all the same: the answer lives in the file itself
      symlinkSync(join(home, '.cc-secrets', 'lane-a.env'), join(home, '.ccrc', 'snapshot-posture'));
      expect(lines(run(home, 'snapshot-posture', 'linux').stdout)[0]).toMatch(/^FAIL snapshot-posture: ~\/\.ccrc\/snapshot-posture is a symlink/);
    });

    it('FAILs an answer path that is not a readable file', () => {
      const r = run(box({ secrets: ['.cc-secrets'], posture: 'dir' }), 'snapshot-posture', 'linux');
      expect(r.stdout).toMatch(/^FAIL snapshot-posture: ~\/\.ccrc\/snapshot-posture is not a readable file, so the stated answer cannot be read$/m);
      expect(r.code).toBe(1);
    });
  });

  itLinux('a healthy Linux box, through the whole run: the two darwin checks SKIP and the stated none PASSes', () => {
    const r = runDoctor(healthy('ccrc-doctor-a11b-whole-'));
    expect(anyVerdictFor(r.stdout, 'filevault')).toMatch(/^SKIP filevault: /);
    expect(anyVerdictFor(r.stdout, 'secrets-backup-excluded')).toMatch(/^SKIP secrets-backup-excluded: /);
    expect(anyVerdictFor(r.stdout, 'snapshot-posture')).toBe('PASS snapshot-posture: stated: the provider keeps no backups or snapshots of this box');
    expect(r.code, r.stdout).toBe(0);
  });

  itDarwin('a healthy macOS box, through the whole run: snapshot-posture SKIPs, and the two darwin checks PASS', () => {
    const r = runDoctor(healthy('ccrc-doctor-a11b-whole-mac-'));
    expect(anyVerdictFor(r.stdout, 'snapshot-posture')).toMatch(/^SKIP snapshot-posture: /);
    expect(lineFor(r.stdout, 'filevault')).toBe('PASS filevault: FileVault is On (fdesetup status)');
    expect(lineFor(r.stdout, 'secrets-backup-excluded')).toBe('PASS secrets-backup-excluded: ~/.cc-secrets excluded from Time Machine (tmutil isexcluded)');
    expect(r.code, r.stdout).toBe(0);
  });
});

// ── box-settings (wave 24, D-6599) ─────────────────────────────────────────

describe('ccrc doctor: box-settings reads the box\'s ccrc.env alone (wave 24, D-6599)', () => {
  /** ccrc's tree and a ccrc.env holding `lines` after a role line, on a contained PATH with the real `awk` linked in,
   *  since ccrc's one reader scans with it and, with no `awk` to scan with, WARNs that the file could not be scanned. */
  const settingsBox = (prefix: string, lines: string[]): string => {
    const home = mkTmp(prefix);
    installCcrc(home);
    containedPath(home);
    linkReal(home, 'awk');
    writeCcrcEnv(home, ['CCRC_ROLE=server', ...lines, ''].join('\n'));
    return home;
  };
  /** `_check_box-settings` alone, as `cmd_doctor` runs it (the update-sweep describe's `runUs` shape). */
  const runBs = (home: string, extraEnv: NodeJS.ProcessEnv = {}): Result => {
    const ccd = join(home, 'ccrc', 'ccd');
    const r = spawnSync(BASH, ['-c',
      `set -uo pipefail; . ${shq(join(ccd, 'ccrc'))}; . ${shq(join(ccd, 'ccrc-doctor-checks'))}; _check_box-settings`],
    { env: { ...doctorEnv(home), ...extraEnv }, encoding: 'utf8' });
    return { code: r.status ?? -1, stdout: r.stdout ?? '', stderr: r.stderr ?? '' };
  };
  const out = (r: Result): string[] => r.stdout.split('\n').filter((l) => l !== '');
  const verdict = (r: Result): string => out(r).find((l) => /^(PASS|WARN|FAIL|SKIP) box-settings: /.test(l)) ?? '';
  // On macOS `_ccrc_knob` reads ccrc.env by its own rule: the launchd job sources both env files with bash, so ONE line that
  // is not a plain NAME=value line makes every key that file names (and CCRC_BACKUP_DATA_KEEP, always) unmeasured, with the
  // launchd sentence. The rows below that plant a space, a `?` or the like therefore assert that sentence on macOS and
  // keep their leak checks on both platforms; the `plain` fixtures carry the Linux shape on macOS too.
  const MAC = process.platform === 'darwin';
  const LAUNCHD = /cannot be measured: ~\/\.ccrc\/ccrc\.env line \d+ is not a plain NAME=value line, and on macOS the launchd job sources both env files with bash, so that line can change what they set/;

  it('W24-S1: nothing set', () => {
    const r = runBs(settingsBox('ccrc-doctor-bs-none-', ['CCRC_FLEET=local']));
    expect(verdict(r), r.stdout + r.stderr).toMatch(/^PASS box-settings: the box's ccrc.env sets none of ccrc's settings\b/m);
    expect(verdict(r)).toMatch(/; not set there, so the default applies unless the environment sets it: CCRC_BACKUP_KEEP, /);
    expect(out(r)).toHaveLength(1);
    expect(r.stderr).toBe('');
    expect(r.code).toBe(0);
  });

  it('W24-S2: a set line, and the environment does not change it', () => {
    const home = settingsBox('ccrc-doctor-bs-set-', ['CCRC_BACKUP_KEEP=5', 'CCRC_AGENT_TOKEN=fixture-token-never-printed']);
    const r = runBs(home, { CCRC_BACKUP_KEEP: '7' });
    expect(verdict(r), r.stdout + r.stderr).toMatch(/^PASS box-settings: the box's ccrc.env sets CCRC_BACKUP_KEEP=5; not set there/);
    expect(verdict(r)).toMatch(/CCRC_BACKUP_KEEP=5/);
    expect(verdict(r)).not.toMatch(/=7/);
    expect(verdict(r), 'the unset list names the other six, never the one the file sets').not.toMatch(/environment sets it:.*CCRC_BACKUP_KEEP\b/);
    expect(r.stdout, 'no other line of ccrc.env prints (ruling 7)').not.toMatch(/fixture-token-never-printed|CCRC_AGENT_TOKEN|CCRC_ROLE/);
    expect(r.code).toBe(0);
  });

  it('W24-S3: a line the reader refuses WARNs, even beside a set environment', () => {
    const r = runBs(settingsBox('ccrc-doctor-bs-export-', ['export CCRC_BACKUP_KEEP=5']), { CCRC_BACKUP_KEEP: '7' });
    expect(r.stdout).toMatch(/^WARN box-settings: CCRC_BACKUP_KEEP cannot be measured: ~\/\.ccrc\/ccrc\.env names it on a line this reader does not take/m);
    expect(out(r)[1]).toMatch(/^ {2}remedy: rewrite each named line in the box's ccrc\.env as a plain KEY=value line/);
    expect(out(r)).toHaveLength(2);
    expect(r.stdout).not.toMatch(/^PASS box-settings/m);
    expect(r.code).toBe(2);
  });

  it('W24-S4: a mirror\'s credentials never print', () => {
    const r = runBs(settingsBox('ccrc-doctor-bs-url-', ['CCRC_RELEASE_BASE_URL=https://u:hunter2@mirror.example/releases']));
    expect(verdict(r), r.stdout + r.stderr).toMatch(/^PASS box-settings: the box's ccrc.env sets CCRC_RELEASE_BASE_URL=custom https:\/\/mirror\.example;/);
    expect(r.stdout, 'D-7918: the origin only, never the path').not.toContain('/releases');
    expect(r.stdout).not.toContain('hunter2');
    expect(r.code).toBe(0);
  });

  it('W24-S5: a named-empty line is reported as such', () => {
    const r = runBs(settingsBox('ccrc-doctor-bs-empty-', ['CCRC_UPDATE_DEADLINE_MS=']));
    expect(verdict(r), r.stdout + r.stderr).toMatch(/^PASS box-settings: /);
    expect(verdict(r)).toMatch(/CCRC_UPDATE_DEADLINE_MS= \(empty: the default\)/);
    expect(verdict(r), 'a named-empty line is not listed as unset').not.toMatch(/environment sets it:.*CCRC_UPDATE_DEADLINE_MS\b/);
    expect(r.code).toBe(0);
  });

  it('W24-S6: a scheme-less mirror base\'s credentials never print either (curl reads it as http)', () => {
    const r = runBs(settingsBox('ccrc-doctor-bs-url-bare-', ['CCRC_RELEASE_BASE_URL=u:hunter2@mirror.example/r']));
    expect(verdict(r), r.stdout + r.stderr).toMatch(/^PASS box-settings: the box's ccrc.env sets CCRC_RELEASE_BASE_URL=custom;/);   // D-7923: no scheme shows `custom` alone; it read `custom mirror.example` before
    expect(r.stdout).not.toContain('hunter2');
    expect(r.code).toBe(0);
  });

  it.skipIf(process.getuid?.() === 0)('W24-S7: a ccrc.env that is there but cannot be read WARNs, naming the file\'s own remedy', () => {
    const home = settingsBox('ccrc-doctor-bs-unreadable-', ['CCRC_BACKUP_KEEP=5']);
    chmodSync(join(home, '.ccrc', 'ccrc.env'), 0o000);
    const r = runBs(home);
    expect(r.stdout, r.stderr).toMatch(/^WARN box-settings: CCRC_BACKUP_KEEP cannot be measured: ~\/\.ccrc\/ccrc\.env is there but cannot be read/m);
    expect(out(r)[1]).toMatch(/^ {2}remedy: .*make the file itself readable when it cannot be read or scanned/);
    expect(out(r)).toHaveLength(2);
    expect(r.stdout).not.toMatch(/^PASS box-settings/m);
    expect(r.code).toBe(2);
  });

  // Fix round 1, F15: a cause on ANOTHER key's line that leaves the model of the file (`_box_unit_env`) unable to decide it
  // refuses every setting the file names, each on a plain line, so the remedy is the model's own (its BUE_FIX), given once.
  /** `_check_box-settings` with `CCD_OS` set AFTER sourcing (ccrc recomputes it from the host at source time), so the
   *  Darwin model runs on any host. */
  const runBsOs = (home: string, os: 'linux' | 'darwin'): Result => {
    const ccd = join(home, 'ccrc', 'ccd');
    const r = spawnSync(BASH, ['-c',
      `set -uo pipefail; . ${shq(join(ccd, 'ccrc'))}; . ${shq(join(ccd, 'ccrc-doctor-checks'))}; CCD_OS=${os}; _check_box-settings`],
    { env: doctorEnv(home), encoding: 'utf8' });
    return { code: r.status ?? -1, stdout: r.stdout ?? '', stderr: r.stderr ?? '' };
  };
  const PLAIN_REMEDY = "rewrite each named line in the box's ccrc.env as a plain KEY=value line (deploy/ccrc.env.example shows each), "
    + 'or make the file itself readable when it cannot be read or scanned';
  const remedyOf = (r: Result): string => out(r)[1] ?? '';
  const count = (hay: string, needle: string): number => hay.split(needle).length - 1;

  it.each(['linux', 'darwin'] as const)('W24-S8 (%s): an unrelated non-ASCII line gives the model\'s own remedy, once, not the plain-line one', (os) => {
    const home = settingsBox(`ccrc-doctor-bs-utf8-${os}-`, ['CCRC_BACKUP_KEEP=5', 'CCRC_VERSIONS_KEEP=3', 'NOTE=café']);
    const r = runBsOs(home, os);
    expect(r.stdout, r.stderr).toMatch(/^WARN box-settings: CCRC_BACKUP_KEEP cannot be measured: ~\/\.ccrc\/ccrc\.env line 4 .*; CCRC_VERSIONS_KEEP cannot be measured: /m);
    const fix = os === 'linux'
      ? 'keep every NAME=value line of ~/.ccrc/ccrc.env to ASCII (a non-ASCII host goes in as its punycode xn-- form;'
      : 'rewrite line 4 of ~/.ccrc/ccrc.env as NAME=value,';
    expect(remedyOf(r), 'the model\'s own fix').toMatch(new RegExp(`^ {2}remedy: ${fix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`));
    expect(count(remedyOf(r), fix), 'given once for the two settings it refused').toBe(1);
    expect(remedyOf(r), 'not only the plain-line rewrite: both lines are already plain').not.toContain(PLAIN_REMEDY);
    expect(remedyOf(r)).toMatch(/; until then the act that reads it refuses, or falls back as its line says$/);
    expect(r.stdout, 'never a value or another byte of the file').not.toMatch(/caf|NOTE|=5|=3/);
    expect(r.stdout, '$HOME prints as ~').not.toContain(home);
    expect(out(r)).toHaveLength(2);
    expect(r.code).toBe(2);
  });

  it.each(['linux', 'darwin'] as const)('W24-S9 (%s): an unrelated line with an inner CR gives the model\'s CR fix', (os) => {
    const home = settingsBox(`ccrc-doctor-bs-cr-${os}-`, ['CCRC_BACKUP_KEEP=5', 'NOTE=a\rb']);
    const r = runBsOs(home, os);
    expect(r.stdout, r.stderr).toMatch(/^WARN box-settings: CCRC_BACKUP_KEEP cannot be measured: ~\/\.ccrc\/ccrc\.env line 3 /m);
    expect(remedyOf(r)).toMatch(os === 'linux'
      ? /^ {2}remedy: save ~\/\.ccrc\/ccrc\.env with one line ending per line \(LF, or CRLF\) and no bare carriage return inside a line /
      : /^ {2}remedy: save ~\/\.ccrc\/ccrc\.env without carriage returns /);
    expect(remedyOf(r)).not.toContain(PLAIN_REMEDY);
    expect(r.stdout).not.toMatch(/NOTE|=5/);
    expect(r.code).toBe(2);
  });

  it.each(['linux', 'darwin'] as const)('W24-S10 (%s): a refusal for the setting\'s own line alone keeps the plain-line remedy', (os) => {
    const r = runBsOs(settingsBox(`ccrc-doctor-bs-shape-${os}-`, ['export CCRC_BACKUP_KEEP=5']), os);
    expect(r.stdout, r.stderr).toMatch(/^WARN box-settings: CCRC_BACKUP_KEEP cannot be measured: ~\/\.ccrc\/ccrc\.env names it on a line this reader does not take/m);
    expect(remedyOf(r)).toBe(`  remedy: ${PLAIN_REMEDY}; until then the act that reads it refuses, or falls back as its line says`);
    expect(r.code).toBe(2);
  });

  it.each(['linux', 'darwin'] as const)('W24-S12 (%s): a quote the setting\'s own line leaves open — the Linux model refuses that line alone, macOS the whole file', (os) => {
    // On Linux the model's per-line shape arm sets a BUE_FIX too, but its cause is the setting's own line, so the plain-line
    // remedy stands; on macOS the model refuses the whole file for any line, so its fix (naming the line) is carried.
    const r = runBsOs(settingsBox(`ccrc-doctor-bs-openq-${os}-`, ['CCRC_BACKUP_KEEP="5']), os);
    expect(r.stdout, r.stderr).toMatch(/^WARN box-settings: CCRC_BACKUP_KEEP cannot be measured: ~\/\.ccrc\/ccrc\.env /m);
    if (os === 'linux') expect(remedyOf(r)).toBe(`  remedy: ${PLAIN_REMEDY}; until then the act that reads it refuses, or falls back as its line says`);
    else expect(remedyOf(r)).toMatch(/^ {2}remedy: rewrite line 2 of ~\/\.ccrc\/ccrc\.env as NAME=value,.*; until then the act that reads it refuses, or falls back as its line says$/);
    expect(r.code).toBe(2);
  });

  it.each(['linux', 'darwin'] as const)('W24-S11 (%s): causes mixed — the model\'s fix, then the plain-line clause for the other refusal', (os) => {
    // The model-wide refusal comes FIRST in CCRC_SETTINGS' order, so a cause the check failed to clear per setting would
    // be pinned on the later, scan-refused one and drop the plain-line clause.
    const home = settingsBox(`ccrc-doctor-bs-mixed-${os}-`, ['CCRC_BACKUP_KEEP=5', 'export CCRC_VERSIONS_KEEP=3', 'NOTE=café']);
    const r = runBsOs(home, os);
    expect(r.stdout, r.stderr).toMatch(/; CCRC_VERSIONS_KEEP cannot be measured: ~\/\.ccrc\/ccrc\.env names it on a line this reader does not take/m);
    expect(remedyOf(r)).toMatch(os === 'linux' ? /^ {2}remedy: keep every NAME=value line of ~\/\.ccrc\/ccrc\.env to ASCII / : /^ {2}remedy: rewrite line 4 of ~\/\.ccrc\/ccrc\.env as NAME=value,/);
    expect(remedyOf(r)).toContain(`; for each other refusal, ${PLAIN_REMEDY}; until then the act that reads it refuses, or falls back as its line says`);
    expect(r.stdout).not.toMatch(/caf|NOTE/);
    expect(r.code).toBe(2);
  });

  // Fix round 4, F1: `http:/` and `https:///` (curl authenticates with both) lose their userinfo, the slashes kept as written.
  // Each row reads the check twice: as `cmd_doctor` runs it, and with `_upd_redact` made an identity after sourcing, so the
  // check's OWN mask (which runs first) is measured by itself and not hidden behind `_upd_redact`'s.
  const runBsOwnMask = (home: string): Result => {
    const ccd = join(home, 'ccrc', 'ccd');
    const r = spawnSync(BASH, ['-c',
      `set -uo pipefail; . ${shq(join(ccd, 'ccrc'))}; . ${shq(join(ccd, 'ccrc-doctor-checks'))}; _upd_redact() { printf '%s' "$1"; }; _check_box-settings`],
    { env: doctorEnv(home), encoding: 'utf8' });
    return { code: r.status ?? -1, stdout: r.stdout ?? '', stderr: r.stderr ?? '' };
  };

  it.each([['W24-S13', 'one slash', 'http:/'], ['W24-S14', 'three slashes', 'https:///']] as const)('%s: a mirror base whose scheme has %s (`%s`, which curl authenticates with) prints no credential and no origin (D-6748, D-7918)', (id, _what, scheme) => {
    const home = settingsBox(`ccrc-doctor-bs-url-${id === 'W24-S13' ? 1 : 3}slash-`, [`CCRC_RELEASE_BASE_URL=${scheme}u:hunter2@mirror.example/r`]);
    // `_upd_url_origin` answers rc 1 for a `/` before the last `@` (the userinfo is not decidable), so the line holds `custom` alone (D-7918).
    const want = `PASS box-settings: the box's ccrc.env sets CCRC_RELEASE_BASE_URL=custom; `;
    for (const [how, r] of [['as doctor runs it', runBs(home)], ['the check\'s own mask alone', runBsOwnMask(home)]] as const) {
      expect(verdict(r).startsWith(want), `${how}: ${r.stdout}${r.stderr}`).toBe(true);
      expect(r.stdout, how).not.toContain('hunter2');
      expect(r.code, how).toBe(0);
    }
  });

  // wave 29 (D-6981): the ccd-* sweeps read four settings through ccrc's reader too, so the check reports them like
  // ccrc's own; on a server-role box, where no sweep timer runs, a sweep setting the file sets says so (ruling 4).
  const roleBox = (prefix: string, role: string, lines: string[]): string => {
    const home = mkTmp(prefix);
    installCcrc(home);
    containedPath(home);
    linkReal(home, 'awk');
    writeCcrcEnv(home, [`CCRC_ROLE=${role}`, ...lines, ''].join('\n'));
    return home;
  };

  it('W29-D1: a sweep\'s setting is reported like ccrc\'s', () => {
    const r = runBs(roleBox('ccrc-doctor-bs-sweep-', 'fleet', ['CCRC_USAGE_SWEEP_DAYS=4']));
    expect(verdict(r), r.stdout + r.stderr).toMatch(/^PASS box-settings: the box's ccrc.env sets CCRC_USAGE_SWEEP_DAYS=4; not set there/);
    expect(verdict(r), 'a fleet box runs the sweeps').not.toMatch(/server-role/);
    expect(r.code).toBe(0);
    const w = runBs(roleBox('ccrc-doctor-bs-sweep-export-', 'fleet', ['export CCRC_USAGE_SWEEP_DAYS=4']));
    expect(w.stdout).toMatch(/^WARN box-settings: CCRC_USAGE_SWEEP_DAYS cannot be measured: ~\/\.ccrc\/ccrc\.env names it on a line this reader does not take/m);
    expect(w.code).toBe(2);
  });

  it('W29-D3: an empty sweep setting on a server-role box names its default and the inactive sweeps', () => {
    const r = runBs(settingsBox('ccrc-doctor-bs-sweep-empty-', ['CCRC_USAGE_SWEEP_DAYS=']));
    expect(verdict(r), r.stdout + r.stderr).toMatch(
      /^PASS box-settings: the box's ccrc.env sets CCRC_USAGE_SWEEP_DAYS= \(empty: the default\) \(read by the ccd-\* sweeps, which do not run on a server-role box\); not set there/);
    expect(r.code).toBe(0);
  });

  it('W29-D2: on a server-role box a sweep setting is still reported, and says the sweeps do not run there', () => {
    const r = runBs(settingsBox('ccrc-doctor-bs-sweep-server-', ['CCRC_USAGE_SWEEP_DAYS=4', 'CCRC_BACKUP_KEEP=5']));
    expect(verdict(r), r.stdout + r.stderr).toMatch(
      /^PASS box-settings: the box's ccrc.env sets CCRC_BACKUP_KEEP=5, CCRC_USAGE_SWEEP_DAYS=4 \(read by the ccd-\* sweeps, which do not run on a server-role box\); not set there/);
    expect(r.code).toBe(0);
  });

  // ── box settings wave 2, Task 7 (D18; D-7918, D-7919): doctor reads the class table ──────────────────────────────
  /** The closed-set words of `_set_says <KEY>`, read from bash in the box's own HOME (never a pasted copy). */
  const says = (home: string, key: string): string => {
    const ccd = join(home, 'ccrc', 'ccd');
    const r = spawnSync(BASH, ['-c', `set -uo pipefail; . ${shq(join(ccd, 'ccrc'))}; _set_libs; _set_says ${key}`], { env: doctorEnv(home), encoding: 'utf8' });
    return (r.stdout ?? '').replace(/\n$/, '');
  };
  const fleetBox = (prefix: string, lines: string[]): string => roleBox(prefix, 'fleet', lines);
  const OMIT_KEYS = (Object.keys(BOX_SETTING_SPECS) as (keyof typeof BOX_SETTING_SPECS)[]).filter((k) => BOX_SETTING_SPECS[k].cls === 'omit');

  it('W2-D1: a passing value prints its value', () => {
    const r = runBs(fleetBox('ccrc-doctor-bs-d1-', ['CCRC_GRAPH_BUDGET=4', 'CCRC_SESSION_SLICE_MEMORY_MAX=20G']));
    expect(verdict(r), r.stdout + r.stderr).toMatch(/^PASS box-settings: /);
    expect(verdict(r)).toContain('CCRC_GRAPH_BUDGET=4');
    expect(verdict(r)).toContain('CCRC_SESSION_SLICE_MEMORY_MAX=20G');
    expect(r.code).toBe(0);
  });

  it.each([['CCRC_BACKUP_KEEP'], ['CCRC_SESSION_SLICE_MEMORY_MAX'], ['CCRC_TEST_SLICE_CPU_WEIGHT'], ['CCRC_GRAPH_FETCH_SECS'],
    ['CCRC_TESTBOX_QUEUE_LIMIT'], ['CCRC_KEEPALIVE_FRESH'], ['CCRC_USAGE_SWEEP_DAYS'], ['CCRC_CARRY_COPY_WARN_BYTES']])(
    'W2-D2: a refused %s prints the words, never the value', (key) => {
    const home = fleetBox('ccrc-doctor-bs-d2-', [`${key}=zz-mark-${key.length}`]);
    const words = says(home, key);
    expect(words, 'the words come from bash').not.toBe('');
    const r = runBs(home);
    expect(verdict(r), r.stdout + r.stderr).toContain(`${key} (refused: ${words})`);
    expect(r.stdout + r.stderr).not.toContain('zz-mark');
    expect(verdict(r)).not.toContain(`${key}=`);
    expect(r.code).toBe(0);
  });

  it('W2-D3: an is-set setting (the spec\'s presence, D12) prints as set, never its value', () => {
    const shape = (prompt: string): Result => runBs(fleetBox('ccrc-doctor-bs-d3-', ['CCRC_TESTBOX_URL=https://tb.zz-mark.invalid:8443/zz-path', 'CCRC_GRAPH_STORE=/srv/zz-mark-store', `CCRC_KEEPALIVE_PROMPT=${prompt}`]));
    // The prompt's space is not a plain line: on macOS it is the one line the launchd rule refuses, so the shape is checked
    // on a plain prompt there, and the spaced one asserts the launchd sentence (the leak checks hold for both).
    const r = shape(MAC ? 'zz-mark-prompt' : 'zz-mark prompt');
    expect(verdict(r), r.stdout + r.stderr).toMatch(/^PASS box-settings: /);
    for (const k of ['CCRC_TESTBOX_URL', 'CCRC_GRAPH_STORE', 'CCRC_KEEPALIVE_PROMPT']) expect(verdict(r)).toContain(`${k} (set)`);
    expect(r.stdout + r.stderr).not.toContain('zz-');
    expect(r.code).toBe(0);
    if (MAC) {
      const w = shape('zz-mark prompt');
      expect(verdict(w), w.stdout + w.stderr).toMatch(/^WARN box-settings: /);
      for (const k of ['CCRC_BACKUP_DATA_KEEP', 'CCRC_TESTBOX_URL', 'CCRC_GRAPH_STORE', 'CCRC_KEEPALIVE_PROMPT']) expect(verdict(w)).toMatch(new RegExp(`${k} ${LAUNCHD.source}`));
      expect(w.stdout + w.stderr).not.toContain('zz-');
      expect(w.code).toBe(2);
    }
  });

  it('W2-D4: a refused is-set setting prints its words, not its value', () => {
    // `zz-mark not a url` holds spaces: on macOS the launchd rule makes that line unmeasured, so the words are checked on
    // the plain `zz-mark` there (also not a URL), and the spaced one asserts the launchd sentence.
    const home = fleetBox('ccrc-doctor-bs-d4-', [`CCRC_TESTBOX_URL=${MAC ? 'zz-mark' : 'zz-mark not a url'}`]);
    const words = says(home, 'CCRC_TESTBOX_URL');
    expect(words).not.toBe('');
    const r = runBs(home);
    expect(verdict(r), r.stdout + r.stderr).toContain(`CCRC_TESTBOX_URL (refused: ${words})`);
    expect(r.stdout + r.stderr).not.toContain('zz-mark');
    expect(r.code).toBe(0);
    if (MAC) {
      const w = runBs(fleetBox('ccrc-doctor-bs-d4w-', ['CCRC_TESTBOX_URL=zz-mark not a url']));
      expect(verdict(w), w.stdout + w.stderr).toMatch(new RegExp(`^WARN box-settings: .*CCRC_TESTBOX_URL ${LAUNCHD.source}`));
      expect(w.stdout + w.stderr).not.toContain('zz-mark');
      expect(w.code).toBe(2);
    }
  });

  it('W2-D5: an omit setting is read but not printed, and never listed as unset', () => {
    const r = runBs(fleetBox('ccrc-doctor-bs-d5-', ['CCRC_TESTBOX_RUNS=4', 'CCRC_TESTBOX_LISTEN=zz-mark:1']));
    expect(verdict(r), r.stdout + r.stderr).toMatch(/^PASS box-settings: /);
    expect(verdict(r)).not.toContain('CCRC_TESTBOX_RUNS');
    expect(verdict(r)).not.toContain('zz-mark');
    expect(r.code).toBe(0);
    expect(OMIT_KEYS, 'D-8290 adds the live probes\' three box keys: 28 -> 31').toHaveLength(31);
    const none = runBs(fleetBox('ccrc-doctor-bs-d5-none-', ['CCRC_FLEET=local']));
    for (const k of OMIT_KEYS) expect(verdict(none), k).not.toContain(k);
  });

  it('W2-D6: an omit key\'s reader refusal still WARNs, naming the key and never the value', () => {
    const r = runBs(fleetBox('ccrc-doctor-bs-d6-', ['export CCRC_TESTBOX_RUNS=4']));
    expect(r.stdout, r.stderr).toMatch(/^WARN box-settings: CCRC_TESTBOX_RUNS cannot be measured: ~\/\.ccrc\/ccrc\.env names it on a line this reader does not take/m);
    expect(r.stdout).not.toContain('=4');
    expect(r.code).toBe(2);
  });

  it.each(['zz-leak-tok-0123456789abcdef', 'mirror.example.invalid/r', 'user:pw@mirror.example.invalid/r'])('W2-D7923: a release base with no http(s) scheme (%s) prints custom alone', (v) => {
    const r = runBs(settingsBox('ccrc-doctor-bs-d7923-', [`CCRC_RELEASE_BASE_URL=${v}`]));
    expect(verdict(r), r.stdout + r.stderr).toContain('CCRC_RELEASE_BASE_URL=custom;');
    for (const t of ['zz-leak', 'mirror.example', 'user:pw']) expect(r.stdout + r.stderr).not.toContain(t);
  });

  // Review 1496 F1: userinfo BEFORE a scheme passes `_upd_url_origin` (it redacts, then tests the scheme again) and fits the envelope,
  // so only the doctor check's own gate on the raw value keeps these at `custom` alone.
  it.each(['tok@https://mirror.example.invalid', 'u:pw@https://mirror.example.invalid/r', 'u@HTTPS://mirror.example.invalid'])('W2-D7923: userinfo before a scheme (%s) prints custom alone', (v) => {
    const r = runBs(settingsBox('ccrc-doctor-bs-d7923u-', [`CCRC_RELEASE_BASE_URL=${v}`]));
    expect(verdict(r), r.stdout + r.stderr).toContain('CCRC_RELEASE_BASE_URL=custom;');
    for (const t of ['tok@', 'u:pw', 'u@HTTPS', 'mirror.example']) expect(r.stdout + r.stderr).not.toContain(t);
  });

  it('W2-D7: the release base shows its origin only', () => {
    const base = (v: string): Result => runBs(settingsBox('ccrc-doctor-bs-d7-', [`CCRC_RELEASE_BASE_URL=${v}`]));
    const a = base('https://u:hunter2@mirror.example/releases');
    expect(verdict(a), a.stdout + a.stderr).toContain('CCRC_RELEASE_BASE_URL=custom https://mirror.example;');
    const b = base('u:hunter2@mirror.example/r');
    expect(verdict(b), b.stdout + b.stderr).toContain('CCRC_RELEASE_BASE_URL=custom;');   // D-7923
    for (const bad of ['http:/u:hunter2@mirror.example/r', 'https:///u:hunter2@mirror.example/r']) {
      const c = base(bad);
      expect(verdict(c), c.stdout + c.stderr).toContain('CCRC_RELEASE_BASE_URL=custom;');
    }
    const own = runBsOwnMask(settingsBox('ccrc-doctor-bs-d7-own-', ['CCRC_RELEASE_BASE_URL=https://u:hunter2@mirror.example/releases']));
    expect(own.stdout + own.stderr, 'the check\'s own mask, `_upd_redact` an identity').not.toContain('hunter2');
    // Measured: with `_upd_redact` an identity, `_upd_url_origin`'s own `@` check answers rc 1, so the line holds `custom` alone.
    expect(verdict(own)).toContain('CCRC_RELEASE_BASE_URL=custom;');
    for (const r of [a, b]) expect(r.stdout + r.stderr).not.toContain('hunter2');
  });

  it('W2-D8: a refused value is still a PASS at rc 0', () => {
    const r = runBs(fleetBox('ccrc-doctor-bs-d8-', ['CCRC_GRAPH_BUDGET=zz']));
    expect(verdict(r), r.stdout + r.stderr).toMatch(/^PASS box-settings: /);
    expect(verdict(r)).toContain('CCRC_GRAPH_BUDGET (refused: ');
    expect(r.code).toBe(0);
  });

  it('W2-D9: a check that cannot load is unmeasured, never refused', () => {
    const home = fleetBox('ccrc-doctor-bs-d9-', ['CCRC_TESTBOX_QUEUE_LIMIT=5']);
    rmSync(join(home, 'ccrc', 'ccd', 'testbox-knobs'));
    const ccd = join(home, 'ccrc', 'ccd');
    const w = spawnSync(BASH, ['-c', `set -uo pipefail; . ${shq(join(ccd, 'ccrc'))}; _set_libs; printf %s "$SET_TB_WHY"`], { env: doctorEnv(home), encoding: 'utf8' });
    const why = w.stdout ?? '';
    expect(why, 'the sentence comes from bash').not.toBe('');
    const r = runBs(home);
    expect(r.stdout, r.stderr).toContain(`WARN box-settings: CCRC_TESTBOX_QUEUE_LIMIT cannot be measured: ${why}`);
    expect(r.stdout).not.toContain('CCRC_TESTBOX_QUEUE_LIMIT (refused:');
    expect(r.stdout).not.toContain('=5');
    expect(r.code).toBe(2);
  });

  it('W2-D10: the no-leak sweep: no value of any setting prints, but the release base\'s origin', () => {
    const keys = BOX_SETTINGS_SHOWN.filter((k) => BOX_SETTING_SPECS[k].cls !== 'origin');
    const lines = (url: string): string[] => [...keys.map((k, i) => `${k}=zz-leak-${i}`), `CCRC_RELEASE_BASE_URL=${url}`];
    // The `?` of the release base's query is not a plain line: on macOS it makes every key unmeasured, so the origin and the
    // PASS are checked on the plain URL there, and the query one asserts the launchd WARN. No leak on either, on any platform.
    const r = runBs(fleetBox('ccrc-doctor-bs-d10-', lines(MAC ? 'https://mirror.example.invalid/zz-leak-path' : 'https://mirror.example.invalid/zz-leak-path?zz-leak-q')));
    expect(verdict(r), r.stdout + r.stderr).toMatch(/^PASS box-settings: /);
    expect(verdict(r)).toContain('CCRC_RELEASE_BASE_URL=custom https://mirror.example.invalid');
    expect(r.stdout + r.stderr, 'no value of any setting leaks').not.toContain('zz-leak');
    expect(r.code).toBe(0);
    if (MAC) {
      const w = runBs(fleetBox('ccrc-doctor-bs-d10w-', lines('https://mirror.example.invalid/zz-leak-path?zz-leak-q')));
      expect(verdict(w), w.stdout + w.stderr).toMatch(new RegExp(`^WARN box-settings: .*CCRC_RELEASE_BASE_URL ${LAUNCHD.source}`));
      expect(w.stdout + w.stderr, 'no value of any setting leaks').not.toContain('zz-leak');
      expect(w.code).toBe(2);
    }
  });

  it('W2-D11: doctor holds the envelope: an origin or a value too wide for the view', () => {
    const o = runBs(fleetBox('ccrc-doctor-bs-d11-o-', ['CCRC_RELEASE_BASE_URL=https://h:zz-abc/r']));
    expect(verdict(o), o.stdout + o.stderr).toMatch(/^PASS box-settings: /);
    expect(verdict(o)).toMatch(/CCRC_RELEASE_BASE_URL=custom[,;]/);
    expect(o.stdout + o.stderr).not.toContain('zz-abc');
    expect(o.code).toBe(0);
    const wide = `1${'9'.repeat(39)}M`;
    const v = runBs(fleetBox('ccrc-doctor-bs-d11-v-', [`CCRC_TESTBOX_SNAPSHOT_MAX=${wide}`]));
    expect(verdict(v), v.stdout + v.stderr).toMatch(/^PASS box-settings: /);
    expect(verdict(v)).toContain('CCRC_TESTBOX_SNAPSHOT_MAX (wider than this view records)');
    expect(v.stdout + v.stderr).not.toContain('9'.repeat(39));
    expect(v.code).toBe(0);
  });
});

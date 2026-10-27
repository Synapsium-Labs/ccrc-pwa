// `ccrc install`, part 5 of the ccrc-install-*.test.ts family (D-6767): the fleet role, install.sh, the node's three
// files and the install-step names. Shared fixtures and the original file header live in ccrc-installFixture.ts.
import { describe, it, expect, beforeAll } from 'vitest';
import { spawn, spawnSync } from 'node:child_process';
import * as pty from 'node-pty';
import { copyFileSync, mkdirSync, readFileSync, writeFileSync, existsSync, statSync, chmodSync, readdirSync, symlinkSync, lstatSync, readlinkSync } from 'node:fs';
import path, { join } from 'node:path';
import { mkTmp, removeTmpFixturesEachTest } from './tmpHelpers.js';
import { ccrcContainedEnv } from './ccrcContainment.js';
import { assertNoRealTool } from './containedTools.js';
import { describeLinux, itLinux } from './platformFixtures.js';
import { installFixtureTree } from './installTreeFixture.js';
import { assertSpineFrontContained, SPINE_CONTAINMENT_PROBE, spineRunCalls, GPT_LANE_BINS } from './codexLaneFixture.js';
import { here, REPO, LANE_BINS_IN_LINE, BASH, treeRoot, placed, freshBox, ccrcEnv, runInstall, read, dotCcrc, mtime, gitInit, unitDir, UNIT_FILES, systemctlCalls, FLEET_URL, FLEET_TOKEN, runInstallTty, type Result } from './ccrc-installFixture.js';

removeTmpFixturesEachTest();

describe('ccrc install --role: the fleet lane (Stage 4, Task 5)', () => {
  /** One fleet install on a pty, shared by the read-only assertions. The
   *  re-run test at the bottom runs against the same box, LAST, so nothing
   *  here reads state it rewrote.
   *
   *  LAZY, not a module-scope IIFE, and the difference is the pty's own 19s
   *  guard: the earlier describes run whole installs through `spawnSync` AT
   *  MODULE SCOPE, which blocks the event loop for the better part of a
   *  minute — an eagerly-started pty child would sit unanswered (its onData
   *  never runs) until the guard fires the moment the loop unblocks. First
   *  `await` starts the run, inside a test, where the loop is free. */
  let fleetRun: Promise<{ home: string; r: Result }> | undefined;
  // Every case reads this one home, so it is made in a beforeAll, before the first case's mark:
  // removeTmpFixturesEachTest leaves it to the end-of-file sweep. The install itself still starts lazily, in a case.
  let fleetHome = '';
  beforeAll(() => { fleetHome = freshBox('ccrc-install-role-fleet-'); }, 60_000);
  const fleet = (): Promise<{ home: string; r: Result }> => (fleetRun ??= (async () => {
    const home = fleetHome;
    const r = await runInstallTty(home, ['install', '--role', 'fleet'], [FLEET_URL, FLEET_TOKEN]);
    return { home, r };
  })());

  it('the run this describe measures succeeded, ending with doctor at exit 0', async () => {
    const { r } = await fleet();
    expect(r.code, r.stdout).toBe(0);
  });

  it('writes ~/.ccrc/agent.env at 0600 with both keys SET', async () => {
    const { home } = await fleet();
    const p = dotCcrc(home, 'agent.env');
    expect(existsSync(p)).toBe(true);
    // 0600 under the ambient umask 022, where a plain redirect produces 0644 —
    // so the mode can only come from the step's own chmod, and this file holds
    // the bearer token the whole agent surface authenticates by.
    expect(statSync(p).mode & 0o777).toBe(0o600);
    const env = read(p);
    expect(env).toMatch(new RegExp(`^CCRC_AGENT_TOKEN=${FLEET_TOKEN}$`, 'm'));
    expect(env).toMatch(/^CCRC_SERVER_URL=ws:\/\/203\.0\.113\.7:7788$/m);
  });

  it('never echoes the token — its only destination is the 0600 file', async () => {
    // The pty transcript is everything a shoulder-surfer (or a pasted terminal
    // log) sees: the URL is typed at an echoing prompt and may appear, the
    // token was read with -s and must not — not as an echo, not in the step's
    // result line, not in doctor's tail.
    const { r } = await fleet();
    expect(r.stdout).not.toContain(FLEET_TOKEN);
    expect(r.stdout).toContain('install: agent.env: written');
  });

  it('records the role in ccrc.env\'s first write', async () => {
    const { home } = await fleet();
    expect(read(dotCcrc(home, 'ccrc.env'))).toMatch(/^CCRC_ROLE=fleet$/m);
  });

  it('places the five GPT-lane executables, and the closing line names them — the role a lane runs under', async () => {
    // Final review F-2 (spec §11): `_inst_bins` gates them `!= server`, on
    // both platform arms, so a fleet box gets all five. The server-role case
    // in the next describe pins the other side of that gate.
    const { home, r } = await fleet();
    for (const name of GPT_LANE_BINS) {
      const bin = join(home, '.local', 'bin', name);
      expect(existsSync(bin), `--role fleet did not place ${name}`).toBe(true);
      expect(readFileSync(bin), `${name} is not the placed tree's copy`).toEqual(readFileSync(placed(home, 'ccd', name)));
      expect(statSync(bin).mode & 0o777, `${name} mode`).toBe(0o755);
    }
    expect(r.stdout).toMatch(new RegExp(`^install: bins: .*${LANE_BINS_IN_LINE}`, 'm'));
  });

  itLinux('installs ccrc-agent.service — byte for byte — and NOT ccrc.service', async () => {
    const { home } = await fleet();
    const agent = unitDir(home, 'ccrc-agent.service');
    expect(existsSync(agent)).toBe(true);
    expect(readFileSync(agent)).toEqual(readFileSync(placed(home, 'deploy', 'ccrc-agent.service')));
    expect(statSync(agent).mode & 0o777).toBe(0o644);
    expect(existsSync(unitDir(home, 'ccrc.service'))).toBe(false);
    // …while the four role-independent units and drop-ins still land.
    for (const [dest] of UNIT_FILES) {
      // W4a Task 9: the watchdog pair is `!= fleet` — asserted ABSENT below.
      if (dest === 'ccrc.service' || dest.startsWith('ccrc-update-watchdog.')) continue;
      expect(existsSync(unitDir(home, ...dest.split('/'))), dest).toBe(true);
    }
    // Ruling T4-R1: the pool-sync pair lands HERE AND ONLY HERE. It is not in
    // `UNIT_FILES` — that list is what a role-`both` install places, and this
    // pair deliberately is not — so it takes its own two lines. This is the
    // role that gets `~/.ccrc/agent.env` (asserted three tests up), which is
    // the only precondition under which `ccd-pool-sync` can ever exit 0.
    expect(existsSync(unitDir(home, 'ccd-pool-sync.service'))).toBe(true);
    expect(existsSync(unitDir(home, 'ccd-pool-sync.timer'))).toBe(true);
    // programme wave 4 (design 2026-09-20 §9): the update-intent puller's
    // pair lands on this role and ONLY this one — the pool-sync pair's own
    // precondition (the agent.env this role's install wrote) and its own
    // gate. Byte for byte from the PLACED tree, at 644.
    for (const u of ['ccd-update-sync.service', 'ccd-update-sync.timer']) {
      const p = unitDir(home, u);
      expect(existsSync(p), `${u} never reached ~/.config/systemd/user on the fleet role`).toBe(true);
      expect(readFileSync(p), `${u} is not the shipped file`)
        .toEqual(readFileSync(placed(home, 'deploy', 'systemd', u)));
      expect(statSync(p).mode & 0o777, `${u} has the wrong mode`).toBe(0o644);
    }
    // W4a Task 9: the watchdog pair lands on every role BUT this one — a
    // fleet node runs no server, and the server's own deadline covers it.
    expect(existsSync(unitDir(home, 'ccrc-update-watchdog.service'))).toBe(false);
    expect(existsSync(unitDir(home, 'ccrc-update-watchdog.timer'))).toBe(false);
  });

  itLinux('enables and restarts the AGENT unit, and never asks systemd about ccrc.service', async () => {
    const { home, r } = await fleet();
    const argv = systemctlCalls(home).map((c) => c.argv);
    expect(argv).toContain('--user enable --now ccrc-agent.service');
    expect(argv).toContain('--user enable --now ccd-cap-scopes.timer');
    // graphify Task 10 (O3/O6b): fleet is not server, so the sweep timer
    // enables here too.
    expect(argv).toContain('--user enable --now ccd-graph-sweep.timer');
    // C5: fleet is not server, so the models timer enables here too.
    expect(argv).toContain('--user enable --now ccrc-models.timer');
    // Fleet is the role that runs sessions, so the temp-dir reaper arms here.
    expect(argv).toContain('--user enable --now ccd-tmp-sweep.timer');
    // and the pane-scope sweep, on the reaper's gate.
    expect(argv).toContain('--user enable --now ccd-scope-sweep.timer');
    // history spec §9.5: fleet is not server, so the history sweep's timer arms here.
    expect(argv).toContain('--user enable --now ccd-history-sweep.timer');
    // Ruling T4-R1: and the pool-sync timer, which enables on THIS ROLE ONLY
    // — the role whose install wrote the `~/.ccrc/agent.env` the binary
    // refuses without. `--role both` and `--role server` below assert the
    // matching absence, so the pair of claims cannot both be satisfied by a
    // gate that is simply always true or always false.
    expect(argv).toContain('--user enable --now ccd-pool-sync.timer');
    // programme wave 4: the update-intent puller's timer, on the same gate.
    expect(argv).toContain('--user enable --now ccd-update-sync.timer');
    expect(argv.indexOf('--user enable --now ccd-update-sync.timer'),
      'the puller timer was enabled before daemon-reload read its unit file')
      .toBeGreaterThan(argv.indexOf('--user daemon-reload'));
    expect(argv).toContain('--user restart ccrc-agent.service');
    // The blanket half of the old refusal, inverted: on a fleet box it is
    // ccrc.service that must never be touched — there is no server here.
    expect(argv.join('\n')).not.toMatch(/\bccrc\.service\b/);
    expect(argv.join('\n')).not.toContain('ccrc-update-watchdog');
    expect(r.stdout).toContain(
      'install: services: ccrc-agent.service and ccd-cap-scopes.timer enabled, and ccrc-agent.service restarted onto the tree this run placed');
  });

  itLinux('places the history sweep\'s shim, and the closing line names it — a fleet box hosts sessions (history spec §9.5)', async () => {
    const { home, r } = await fleet();
    const bin = join(home, '.local', 'bin', 'ccd-history-sweep');
    expect(existsSync(bin), '--role fleet did not place ccd-history-sweep').toBe(true);
    expect(readFileSync(bin)).toEqual(readFileSync(placed(home, 'ccd', 'ccd-history-sweep')));
    expect(statSync(bin).mode & 0o777).toBe(0o755);
    expect(r.stdout).toMatch(/^install: bins: .*(?<![\w-])ccd-history-sweep(?![\w-])/m);
  });

  it('skips the server-only landing lines — no PWA address, no passphrase gate', async () => {
    const { r } = await fleet();
    expect(r.stdout).not.toContain('install: PWA:');
    expect(r.stdout).not.toContain('install: gate:');
  });

  it('a re-run needs no terminal and keeps agent.env byte for byte (seed-once)', async () => {
    // LAST in this describe, because it re-runs the verb against the shared
    // box. Piped stdin on purpose: the file exists, so the tty gate must not
    // even be reached — which is what makes `ccrc update`'s non-interactive
    // re-run of this spine possible on a converged fleet box.
    const { home } = await fleet();
    const p = dotCcrc(home, 'agent.env');
    const before = read(p);
    const mtimeBefore = mtime(p);
    const r2 = runInstall(home, ['install', '--role', 'fleet']);
    expect(r2.code, r2.stderr).toBe(0);
    expect(r2.stdout).toMatch(/^install: agent\.env: kept \(user-owned, never overwritten\)$/m);
    expect(read(p)).toBe(before);
    expect(mtime(p)).toBe(mtimeBefore);
  });
});

describe('ccrc install --role: the refusals and the default', () => {
  it('with no terminal on a fresh box, --role fleet refuses before prompting and writes no agent.env', () => {
    // `cmd_passwd`'s refusal, for the same hazard: under `curl … | bash` stdin
    // is the INSTALLER SCRIPT, so a read here would take a line of shell as
    // the fleet's bearer token.
    const home = freshBox('ccrc-install-role-piped-');
    const r = runInstall(home, ['install', '--role', 'fleet']);
    expect(r.code).toBe(1);
    expect(r.stderr).toMatch(/stdin is not a terminal/);
    expect(existsSync(dotCcrc(home, 'agent.env'))).toBe(false);
    // …and the run stopped there: no unit landed, no systemd call was made.
    expect(r.stdout).not.toMatch(/^install: units:/m);
    expect(existsSync(join(home, 'systemctl-calls'))).toBe(false);
  });

  itLinux('--role both is byte-identical to a plain install — same units, same calls, no agent.env', () => {
    const home = freshBox('ccrc-install-role-both-');
    const r = runInstall(home, ['install', '--role', 'both']);
    expect(r.code, r.stderr).toBe(0);
    for (const [dest] of UNIT_FILES) {
      expect(existsSync(unitDir(home, ...dest.split('/'))), dest).toBe(true);
    }
    expect(existsSync(unitDir(home, 'ccrc-agent.service'))).toBe(false);
    expect(existsSync(dotCcrc(home, 'agent.env'))).toBe(false);
    // Ruling T4-R1, the unit-file half: `_inst_units` gates the pool-sync
    // pair on `fleet` too, so a `both` box is never given a unit file for the
    // timer it is not supposed to arm.
    expect(existsSync(unitDir(home, 'ccd-pool-sync.service'))).toBe(false);
    expect(existsSync(unitDir(home, 'ccd-pool-sync.timer'))).toBe(false);
    // programme wave 4: the update-intent puller's pair is gated on `fleet`
    // exactly as the pool-sync pair is — `both` gets no agent.env, and on
    // `both` the server process writes the projection itself.
    expect(existsSync(unitDir(home, 'ccd-update-sync.service'))).toBe(false);
    expect(existsSync(unitDir(home, 'ccd-update-sync.timer'))).toBe(false);
    expect(systemctlCalls(home).map((c) => c.argv).join('\n')).not.toContain('ccd-update-sync');
    expect(read(dotCcrc(home, 'ccrc.env'))).toMatch(/^CCRC_ROLE=both$/m);
    const calls = systemctlCalls(home)
      // Reads dropped, mutations kept — see the sibling assertion above for why
      // `list-units` is one of them.
      .filter((c) => !c.argv.includes('is-active') && !c.argv.includes('show')
        && !c.argv.includes('list-units'))
      .map((c) => c.argv);
    expect(calls).toEqual([
      // `_inst_node`'s reload (the manager re-reads the node PATH fragment, node-runtime-under-nvm), then
      // `_inst_units`' own.
      '--user daemon-reload',
      '--user daemon-reload',
      '--user enable --now ccrc.service',
      '--user enable --now ccd-cap-scopes.timer',
      // Ruling T4-R1: `ccd-pool-sync.timer` is absent from BOTH lists, which
      // is what keeps "byte-identical to a plain install" true — and `both`
      // is precisely the role the old unconditional enable got wrong, because
      // it is the DEFAULT and it is the role the `existsSync(agent.env)` line
      // above proves gets no agent.env.
      '--user enable --now ccd-graph-sweep.timer',
      '--user enable --now ccd-usage-sweep.timer',
      '--user enable --now ccd-tmp-sweep.timer',
      '--user enable --now ccd-scope-sweep.timer',
      '--user enable --now ccd-account-health.timer',
      '--user enable --now ccd-telemetry-keepalive.timer',
      '--user enable --now ccrc-models.timer',
      '--user enable --now ccd-history-sweep.timer',
      // W4a Task 9: the server-role watchdog's timer — `!= fleet`, so this
      // role enables it — degrading rather than dying like every timer in
      // this list, and taking no restart (a oneshot holds no code).
      '--user enable --now ccrc-update-watchdog.timer',
      '--user restart ccrc.service',
    ]);
    expect(r.stdout).toMatch(
      /^install: units: ccrc\.service, claude-session@\.service, ccd-cap-scopes\.\{service,timer\}, both drop-ins and the two OOMPolicy=continue scope drop-ins in \$HOME\/\.config\/systemd\/user$/m);
  });

  itLinux('--role server is today\'s spine minus nothing — the difference from both is reserved', () => {
    const home = freshBox('ccrc-install-role-server-');
    const r = runInstall(home, ['install', '--role', 'server']);
    expect(r.code, r.stderr).toBe(0);
    expect(existsSync(unitDir(home, 'ccrc.service'))).toBe(true);
    expect(existsSync(unitDir(home, 'ccrc-agent.service'))).toBe(false);
    expect(existsSync(dotCcrc(home, 'agent.env'))).toBe(false);
    // graphify Task 10 (O3/O6b): the sweep pair is role-gated OUT on server —
    // it runs no per-tree AST sweep — while every unit this verb shipped
    // before this task still lands unchanged. C5: the models pair joins the
    // same gate — a server box has no lanes to refresh. Another repository's
    // ccgpt-usage@ name is written on NO role (F-1), and ccrc's own usage pair
    // is `!= server` (Plan 3a): both absences are asserted here, for the third
    // role.
    for (const [dest] of UNIT_FILES) {
      if (dest.startsWith('ccd-graph-sweep.') || dest.startsWith('ccd-account-health.')
        || dest.startsWith('ccd-telemetry-keepalive.') || dest.startsWith('ccrc-models.')
        || dest.startsWith('ccd-tmp-sweep.') || dest.startsWith('ccd-scope-sweep.') || dest.startsWith('ccd-history-sweep.') || dest.startsWith('ccrc-codex-usage@')) continue;
      expect(existsSync(unitDir(home, ...dest.split('/'))), dest).toBe(true);
    }
    expect(existsSync(unitDir(home, 'ccd-graph-sweep.service'))).toBe(false);
    expect(existsSync(unitDir(home, 'ccd-graph-sweep.timer'))).toBe(false);
    expect(existsSync(unitDir(home, 'ccd-account-health.service'))).toBe(false);
    expect(existsSync(unitDir(home, 'ccd-account-health.timer'))).toBe(false);
    expect(existsSync(unitDir(home, 'ccd-telemetry-keepalive.service'))).toBe(false);
    expect(existsSync(unitDir(home, 'ccd-telemetry-keepalive.timer'))).toBe(false);
    expect(existsSync(unitDir(home, 'ccrc-models.service'))).toBe(false);
    expect(existsSync(unitDir(home, 'ccrc-models.timer'))).toBe(false);
    expect(existsSync(unitDir(home, 'ccgpt-usage@.service'))).toBe(false);
    expect(existsSync(unitDir(home, 'ccgpt-usage@.timer'))).toBe(false);
    expect(existsSync(unitDir(home, 'ccrc-codex-usage@.service'))).toBe(false);
    expect(existsSync(unitDir(home, 'ccrc-codex-usage@.timer'))).toBe(false);
    // The temp-dir reaper: a server box runs no sessions, so no temp dir to reap.
    expect(existsSync(unitDir(home, 'ccd-tmp-sweep.service'))).toBe(false);
    expect(existsSync(unitDir(home, 'ccd-tmp-sweep.timer'))).toBe(false);
    // The pane-scope sweep: a server box runs no pane scopes.
    expect(existsSync(unitDir(home, 'ccd-scope-sweep.service'))).toBe(false);
    expect(existsSync(unitDir(home, 'ccd-scope-sweep.timer'))).toBe(false);
    // history spec §9.5: no shim, no unit pair and no enable on a server box —
    // it hosts no sessions and must never hold a store D-4183.
    expect(existsSync(join(home, '.local', 'bin', 'ccd-history-sweep')), '--role server placed ccd-history-sweep').toBe(false);
    // wave 17 (D-5313): `ccrc-api` is gated on the same one-line role test.
    expect(existsSync(join(home, '.local', 'bin', 'ccrc-api')), '--role server placed ccrc-api').toBe(false);
    expect(existsSync(unitDir(home, 'ccd-history-sweep.service'))).toBe(false);
    expect(existsSync(unitDir(home, 'ccd-history-sweep.timer'))).toBe(false);
    expect(systemctlCalls(home).map((c) => c.argv).join('\n')).not.toContain('ccd-history-sweep');
    // Ruling T4-R1: the pool-sync pair is gated OUT here too — but on a
    // NARROWER gate than the four pairs above it. Those are `!= server`;
    // this one is `= fleet`, because `both` gets no agent.env either. A
    // server box failing this assertion under the sibling gate would look
    // identical, which is why `--role both` above asserts the same absence.
    expect(existsSync(unitDir(home, 'ccd-pool-sync.service'))).toBe(false);
    expect(existsSync(unitDir(home, 'ccd-pool-sync.timer'))).toBe(false);
    expect(systemctlCalls(home).map((c) => c.argv).join('\n')).not.toContain('ccd-pool-sync');
    // programme wave 4: and the update-intent puller's pair, on the pool-sync
    // pair's narrower `= fleet` gate — the server process is this box's
    // projection writer.
    expect(existsSync(unitDir(home, 'ccd-update-sync.service'))).toBe(false);
    expect(existsSync(unitDir(home, 'ccd-update-sync.timer'))).toBe(false);
    expect(systemctlCalls(home).map((c) => c.argv).join('\n')).not.toContain('ccd-update-sync');
    expect(systemctlCalls(home).map((c) => c.argv).join('\n')).not.toContain('ccd-graph-sweep');
    expect(systemctlCalls(home).map((c) => c.argv).join('\n')).not.toContain('ccd-account-health');
    expect(systemctlCalls(home).map((c) => c.argv).join('\n')).not.toContain('ccd-telemetry-keepalive');
    expect(systemctlCalls(home).map((c) => c.argv).join('\n')).not.toContain('ccrc-models');
    expect(systemctlCalls(home).map((c) => c.argv).join('\n')).not.toContain('ccgpt-usage');
    expect(systemctlCalls(home).map((c) => c.argv).join('\n')).not.toContain('ccrc-codex-usage');
    expect(systemctlCalls(home).map((c) => c.argv).join('\n')).not.toContain('ccd-tmp-sweep');
    expect(systemctlCalls(home).map((c) => c.argv).join('\n')).not.toContain('ccd-scope-sweep');
    // W4a Task 9: the watchdog is the SERVER's — its pair landed through the
    // UNIT_FILES loop above (not skipped there), and its timer is enabled.
    expect(systemctlCalls(home).map((c) => c.argv)).toContain('--user enable --now ccrc-update-watchdog.timer');
    // Final review F-2 (spec §11): the two GPT-lane executables are gated
    // `!= server` — the lane needs a converged per-account launcher, and a
    // server-role box converges nothing per account (D-3111) — and the
    // closing line must not claim what the gate skipped.
    for (const name of GPT_LANE_BINS) {
      expect(existsSync(join(home, '.local', 'bin', name)), `--role server placed ${name}`).toBe(false);
    }
    const bins = r.stdout.split('\n').find((l) => l.startsWith('install: bins:'));
    expect(bins, 'no `install: bins:` line in the transcript').toBeDefined();
    expect(bins!, 'the server-role closing line claims a GPT-lane executable').not.toMatch(/ccgpt|ccrc-codex/);
    expect(bins!, 'the server-role closing line names a history shim it never placed').not.toContain('ccd-history-sweep');
    expect(bins!, 'the server-role closing line names ccrc-api, which it never placed').not.toContain('ccrc-api');
    expect(read(dotCcrc(home, 'ccrc.env'))).toMatch(/^CCRC_ROLE=server$/m);
    expect(r.stdout).toMatch(/^install: gate: /m);
  });

  it('an unknown role is a usage error at exit 2, refused before the first step', () => {
    const home = freshBox('ccrc-install-role-bogus-');
    const r = runInstall(home, ['install', '--role', 'bogus']);
    expect(r.code).toBe(2);
    expect(r.stderr).toMatch(/--role/);
    expect(r.stderr).toMatch(/usage: ccrc/);
    expect(existsSync(join(home, '.ccrc'))).toBe(false);
  });

  it('--role with no value is the same usage error', () => {
    const home = freshBox('ccrc-install-role-empty-');
    const r = runInstall(home, ['install', '--role']);
    expect(r.code).toBe(2);
    expect(r.stderr).toMatch(/--role/);
    expect(existsSync(join(home, '.ccrc'))).toBe(false);
  });
});

describe('install.sh: the bootstrap that hands off to ccrc install', () => {
  // Task 9. `install-sh.test.ts` measures install.sh's OWN logic (the node
  // floor, `-h`/`--help`) against a thin fixture that has none of `ccd/` or
  // `pwa/` — those tests refuse before install.sh would ever look at either.
  // This is the other half: the fixture tree Tasks 6-8 already built here has
  // both, so this is where "install.sh really builds, in order, then really
  // hands off to THIS TREE's own verb" is provable — without paying for the
  // whole doctor-tail convergence a second time, which `ccrc-install` itself
  // already measures end to end.
  //
  // Two substitutions make this fast and hermetic: `npm` is `ccrcEnv`'s
  // existing recorder (records argv AND cwd, `mkdir -p node_modules`, exits
  // 0 instantly — the same stub every other test in this file already trusts
  // for "the npm argv sequence is X"), and `ccd/ccrc` — the verb install.sh
  // hands off to — is REPLACED with a recorder of its own, because this test
  // is about the HANDOFF, not a second run of the converger.
  it('builds server, pwa, server dist — in that order — then execs its OWN ccd/ccrc install', () => {
    const home = mkTmp('ccrc-installsh-e2e-');
    const root = installFixtureTree(home);
    copyFileSync(join(REPO, 'install.sh'), join(root, 'install.sh'));
    chmodSync(join(root, 'install.sh'), 0o755);
    // `TREE_FILES` carries nothing under `pwa/` or `ui/` — nothing `ccrc
    // install` itself reads resolves there. install.sh's `cd "$ROOT/pwa"` and
    // `cd "$ROOT/ui"` do, so the directories have to exist for the (stubbed)
    // `npm ci`/`npm run build` calls to run at all; their contents are never
    // read, since npm is a recorder.
    mkdirSync(join(root, 'pwa'), { recursive: true });
    mkdirSync(join(root, 'ui'), { recursive: true });
    // The recorder REPLACES the copy `installFixtureTree` already placed at
    // `<root>/ccd/ccrc` (from TREE_FILES) — proof that install.sh resolves
    // `ccd/ccrc` relative to ITSELF (`$ROOT`, from its own `BASH_SOURCE`)
    // rather than to the real repo this suite runs from: `$0` inside the
    // recorder can only equal the FIXTURE's path if that resolution held.
    writeFileSync(join(root, 'ccd', 'ccrc'), [
      '#!/bin/sh',
      'printf \'argv:%s\\n\' "$*" >> "$HOME/ccrc-exec-log"',
      'printf \'path:%s\\n\' "$0" >> "$HOME/ccrc-exec-log"',
      'exit 0',
    ].join('\n'), { mode: 0o755 });

    // `ccrcEnv` is `runInstall`'s environment builder, reused as-is: its `npm`
    // recorder (argv AND cwd, one line per call) is exactly the fixture this
    // test needs, and reusing it rather than re-declaring a second stub is
    // the same rule `single-definition.test.ts` enforces for everything else
    // in this tree. The rsync/systemctl/loginctl/gh/journalctl machinery it
    // also plants is unused here (the recorder below never reaches any of
    // them) and harmless.
    const env = ccrcEnv(home);
    // Fix round 2 (N5, defense-in-depth): the fake `ccd/ccrc` recorder above
    // means this spawn never reaches a manager either way, but the check is
    // cheap and this is still a runner that spawns install.sh with a planted spine.
    assertSpineFrontContained(env, home);
    assertNoRealTool(env, home);
    const r = spawnSync(BASH, [join(root, 'install.sh')], { env, encoding: 'utf8' });
    expect(r.status ?? -1, r.stderr ?? '').toBe(0);

    // The build order install.sh's pinned code spells: ci in server, then ci
    // in ui (installed, never built — pwa builds @ccrc/ui from SOURCE, whose
    // imports resolve from ui/node_modules alone, so a fresh checkout's PWA
    // build fails without it: PR #346's release-lane blocker), then ci+build
    // in pwa, then build in server, then ci+build in agent (D-1159 — the
    // agent joined because `ccrc install` refuses without its dist for every
    // role but `server`, and until it did, a fleet-role install from source
    // restarted a live fleet's agent onto a tree with no entry point).
    expect(read(join(home, 'npm-argv')).trim().split('\n')).toEqual([
      'ci --no-audit --no-fund',
      'ci --no-audit --no-fund',
      'ci --no-audit --no-fund',
      'run build',
      'run build',
      'ci --no-audit --no-fund',
      'run build',
    ]);
    expect(read(join(home, 'npm-cwd')).trim().split('\n')).toEqual([
      join(root, 'server'),
      join(root, 'ui'),
      join(root, 'pwa'),
      join(root, 'pwa'),
      join(root, 'server'),
      join(root, 'agent'),
      join(root, 'agent'),
    ]);

    // The handoff: `install install`'s argv, and — the hermetic proof — the
    // path it ran FROM is the fixture's own tree, never the repo this test
    // itself lives in.
    const execLog = read(join(home, 'ccrc-exec-log')).trim().split('\n');
    expect(execLog[0]).toBe('argv:install');
    expect(execLog[1]).toBe(`path:${join(root, 'ccd', 'ccrc')}`);
  });
});

describe('ccrc install: the node\'s three files (design 2026-09-20 §3, §9)', () => {
  const tagFixture = (home: string, tag: string): void => {
    const r = spawnSync('git', ['-C', treeRoot(home), 'tag', tag],
      { env: { ...process.env, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_SYSTEM: '/dev/null' }, encoding: 'utf8' });
    if (r.status !== 0) throw new Error(`fixture git tag failed: ${r.stderr}`);
  };
  const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\n$/;

  // Each wave's spine ADDS its own words (design 2026-09-20 §9): W1's three,
  // W4's four — `detach` on Linux only (decision 17: `--detach` refuses on
  // Darwin) — W6's `versions`, and the box-token lifecycle's `token-sync`
  // (design 2026-10-07 §4.5; every os, because the op runs the verb in the
  // foreground), so a Linux install writes nine words and a Darwin one eight.
  // LITERALS, not a read of ccd/ccrc's arrays: a pin
  // derived from the list it pins could never red on the list being wrong.
  const CAPS_ALL = ['verify', 'node-id', 'floor', 'update-json', 'update-gate', 'rollback', 'versions', 'token-sync'];
  const CAPS_LINUX = [...CAPS_ALL, 'detach'];
  const CAPS_HERE = process.platform === 'darwin' ? CAPS_ALL : CAPS_LINUX;

  it('node-id: minted once as a lowercase uuid, kept byte-identical by a second run', () => {
    const home = freshBox('ccrc-install-nodeid-');
    gitInit(treeRoot(home));
    const a = runInstall(home);
    expect(a.code, a.stderr).toBe(0);
    const id = readFileSync(join(home, '.ccrc', 'node-id'), 'utf8');
    expect(id).toMatch(UUID);
    expect(a.stdout).toMatch(/^install: node-id: minted [0-9a-f-]{36} /m);
    const b = runInstall(home);
    expect(b.code, b.stderr).toBe(0);
    expect(readFileSync(join(home, '.ccrc', 'node-id'), 'utf8')).toBe(id);
    expect(b.stdout).toMatch(/^install: node-id: kept /m);
  });

  it('node-id: a file that is not a uuid is refused, never overwritten — it identifies this node to the console', () => {
    const home = freshBox('ccrc-install-nodeid-bad-');
    gitInit(treeRoot(home));
    mkdirSync(join(home, '.ccrc'), { recursive: true });
    writeFileSync(join(home, '.ccrc', 'node-id'), 'not-a-uuid\n');
    const r = runInstall(home);
    expect(r.code).toBe(1);
    expect(r.stderr).toMatch(/node-id exists but is not a uuid/);
    expect(readFileSync(join(home, '.ccrc', 'node-id'), 'utf8')).toBe('not-a-uuid\n');
  });

  it('ccrc-caps: line 1 is the os, then each wave\'s words — W1\'s three, W4\'s four, W6\'s versions, token-sync, detach on Linux only (§18 "_inst_caps writes each wave\'s words")', () => {
    const home = freshBox('ccrc-install-caps-');
    gitInit(treeRoot(home));
    const r = runInstall(home);
    expect(r.code, r.stderr).toBe(0);
    const os = process.platform === 'darwin' ? 'darwin' : 'linux';
    expect(readFileSync(join(home, '.ccrc', 'ccrc-caps'), 'utf8')).toBe(`os ${os}\n${CAPS_HERE.join('\n')}\n`);
    expect(statSync(join(home, '.ccrc', 'ccrc-caps')).mode & 0o777).toBe(0o644);
    // The transcript names the same words, in the same order, as the file.
    expect(r.stdout).toMatch(new RegExp(`^install: caps: ${CAPS_HERE.join(' ')} \\(os ${os}; `, 'm'));
    // F6 (review 167): the line names the file as `~/.ccrc/ccrc-caps`, and the
    // fixture's absolute home appears nowhere in the line a rollout would relay.
    expect(r.stdout).toMatch(/^install: caps: .* \(os \w+; ~\/\.ccrc\/ccrc-caps — /m);
    expect(r.stdout.split('\n').filter((l) => l.startsWith('install: caps:')).join('\n')).not.toContain(home);
  });

  it('ccrc-caps: nine words on Linux, eight on Darwin, whichever box runs this suite — both arms of the real _inst_caps', () => {
    // A real install reaches only the host's own arm. The other is reached by
    // running the real `_inst_caps` and `_ccrc_cap_words` out of ccd/ccrc with
    // CCD_OS set — the extraction harness the `_inst_installed` cases below
    // use — so a word moved between the two arrays reds on either platform.
    const src = read(join(REPO, 'ccd', 'ccrc'));
    const pick = (re: RegExp, what: string): string => {
      const m = re.exec(src);
      expect(m, `ccd/ccrc has no ${what}`).not.toBeNull();
      return m![0];
    };
    const harness = [
      pick(/^PROG=.*$/m, 'PROG='),
      // Review fix round 1, N1: `_ccrc_die` now calls `_upd_redact` — this
      // harness does not trigger a die on its green path, but a regression
      // that DID would hit "_upd_redact: command not found" rather than
      // the real refusal, so it is picked up here too.
      pick(/^_upd_redact\(\) \{[\s\S]*?\n\}$/m, '_upd_redact'),
      pick(/^_ccrc_die\(\) \{.*\}$/m, '_ccrc_die'),
      pick(/^CCRC_CAP_WORDS=\(.*\)$/m, 'CCRC_CAP_WORDS=(…)'),
      pick(/^CCRC_CAP_WORDS_LINUX=\(.*\)$/m, 'CCRC_CAP_WORDS_LINUX=(…)'),
      pick(/^_ccrc_cap_words\(\) \{[\s\S]*?\n\}/m, '_ccrc_cap_words'),
      pick(/^_inst_caps\(\) \{[\s\S]*?\n\}/m, '_inst_caps'),
    ];
    for (const [os, words] of [['linux', CAPS_LINUX], ['darwin', CAPS_ALL]] as const) {
      const home = mkTmp(`ccrc-inst-caps-arm-${os}-`);
      const caps = join(home, '.ccrc', 'ccrc-caps');
      const p = spawnSync('bash', ['-c', [
        'set -uo pipefail', ...harness, `CCD_OS=${os}`, `BOX_CAPS_FILE=${JSON.stringify(caps)}`, '_inst_caps',
      ].join('\n')], {
        // Wave 9 R10d (D-3818): an extracted-function harness (`_inst_caps` and its helpers call builtins plus
        // mkdir/mv/rm/date), so it is exempt from assertNoRealTool — but it no longer inherits the real bus or tools.
        encoding: 'utf8', env: ccrcContainedEnv(home, process.env, { managers: true, curl: 'poison' }),
      });
      expect(p.status, `${os}: ${p.stderr}`).toBe(0);
      expect(readFileSync(caps, 'utf8'), os).toBe(`os ${os}\n${words.join('\n')}\n`);
      // W6 Task 8A, F6: the path is the box's own home, so it is spelled `~` —
      // never the absolute fixture home this run wrote under.
      expect(p.stdout, os).toBe(`install: caps: ${words.join(' ')} (os ${os}; ~/.ccrc/ccrc-caps — what this install's ccrc can do, read by the server)\n`);
      expect(p.stdout, os).not.toContain(home);
    }
  });

  it('every cap word names machinery THIS ccrc ships — a word is a capability, never an intention (design §9)', () => {
    // The server dispatches on these words (no `update-gate` → auto-apply
    // refused; no `detach` → a detached apply refused; no `rollback` → the
    // rollback control refused), so a word listed before its code lands is a
    // node that says yes and then fails. A PRESENCE pin, stated as one: each
    // word's own describe proves the behaviour; this proves the word and its
    // machinery ship in the same tree. The words are read from the arrays so
    // that a NEW word with no entry here reds too.
    const src = read(join(REPO, 'ccd', 'ccrc'));
    const BACKING: Record<string, RegExp[]> = {
      verify: [/^_upd_fetch\(\) \{/m, /\/deploy\/verify-provenance\.mjs"/],
      'node-id': [/^_inst_node_id\(\) \{/m],
      floor: [/^_upd_floor_check\(\) \{/m],
      'update-json': [/^_upd_phase\(\) \{/m],
      'update-gate': [/^_upd_gate\(\) \{/m, /^\s*--no-gate\) no_gate=1 ;;$/m],
      rollback: [/^cmd_rollback\(\) \{/m, /^\s*rollback\)\s+cmd_rollback "\$@" ;;$/m],
      // W6 Task 4: a kept version is a flip — restore arm 1 and rollback by flip.
      versions: [/^_upd_restore_arm1\(\) \{/m, /^_ver_flip_back\(\) \{/m],
      // Box-token lifecycle wave 1: the verb ccrc-agent's token-sync op spawns, dispatched to its sibling body.
      'token-sync': [/^cmd_token\(\) \{/m, /^\s*token\)\s+cmd_token "\$@" ;;$/m, /"\$CCRC_HERE\/ccrc-token-sync"/],
      detach: [/^_upd_detach\(\) \{/m, /^\s*--detach\) detach=1 ;;$/m],
    };
    const arr = (name: string): string[] => {
      const m = new RegExp(`^${name}=\\((.*)\\)$`, 'm').exec(src);
      expect(m, `ccd/ccrc has no ${name}=(…)`).not.toBeNull();
      return m![1]!.split(/\s+/).filter(Boolean);
    };
    const words = [...arr('CCRC_CAP_WORDS'), ...arr('CCRC_CAP_WORDS_LINUX')];
    expect(words).toEqual(CAPS_LINUX);
    for (const w of words) {
      expect(BACKING[w], `cap word '${w}' has no entry here — name the machinery it promises`).toBeDefined();
      for (const re of BACKING[w]!) expect(src, `cap word '${w}': ccd/ccrc has no ${re}`).toMatch(re);
    }
    // …and `detach` sits in the Linux-only array BECAUSE the verb refuses it
    // on Darwin (Task 3's `_upd_detach_os_check`): the two statements agree.
    expect(arr('CCRC_CAP_WORDS')).not.toContain('detach');
    expect(src).toMatch(/_ccrc_die "--detach is Linux-only \(decision 17\)"/);
    // …and `token-sync`'s body ships beside ccd/ccrc, where `cmd_token` looks for it.
    expect(statSync(join(REPO, 'ccd', 'ccrc-token-sync')).isFile(), 'ccd/ccrc-token-sync does not ship').toBe(true);
  });

  it('floor: written by the LAST step from the stamped tag; only ever raised (§18 "the floor never lowers")', () => {
    const home = freshBox('ccrc-install-floor-');
    gitInit(treeRoot(home));
    tagFixture(home, 'v1.0.0');
    const a = runInstall(home);
    expect(a.code, a.stderr).toBe(0);
    expect(readFileSync(join(home, '.ccrc', 'floor'), 'utf8')).toBe('v1.0.0\n');
    expect(a.stdout).toMatch(/^install: floor: v1\.0\.0 \(none before/m);
    // The floor line prints AFTER the installed line — it is part of the last step.
    const lines = a.stdout.split('\n');
    expect(lines.findIndex((l) => l.startsWith('install: floor:')))
      .toBeGreaterThan(lines.findIndex((l) => l.startsWith('install: installed:')));
    // A higher floor already on the box is KEPT by a lower install (a restore).
    writeFileSync(join(home, '.ccrc', 'floor'), 'v9.9.9\n');
    const b = runInstall(home);
    expect(b.code, b.stderr).toBe(0);
    expect(readFileSync(join(home, '.ccrc', 'floor'), 'utf8')).toBe('v9.9.9\n');
    expect(b.stdout).toMatch(/^install: floor: kept at v9\.9\.9 \(v1\.0\.0 is not above it/m);
    // A stamp with no version raises nothing.
    const untagged = freshBox('ccrc-install-floor-untagged-');
    gitInit(treeRoot(untagged));
    const c = runInstall(untagged);
    expect(c.code, c.stderr).toBe(0);
    expect(existsSync(join(untagged, '.ccrc', 'floor'))).toBe(false);
    expect(c.stdout).toMatch(/^install: floor: not raised — this stamp carries no version/m);
    // AN EXPLICIT BOUND (final review F4): three whole install spines. Measured alone (one file, `-t`):
    // 8.2 s at load average 12 (2026-09-28), 10.1 s at load 30 (the final review) — half the 20 s default.
  }, 60_000);

  it('_ver_newer agrees with sort -V on a fixture list, and the v is stripped nowhere else', () => {
    const src = read(join(REPO, 'ccd', 'ccrc'));
    const fn = /^_ver_newer\(\) \{[\s\S]*?\n\}/m.exec(src);
    expect(fn, 'ccd/ccrc has no _ver_newer').not.toBeNull();
    const list = ['v0.0.1', 'v0.0.10', 'v0.0.9', 'v0.1.0', 'v1.0.0', 'v1.9.9', 'v1.9.10', 'v2.0.0', 'v10.0.0'];
    const sorted = spawnSync('bash', ['-c', 'printf "%s\\n" "$@" | sort -V', '--', ...list], { encoding: 'utf8' }).stdout.trim().split('\n');
    // The `_ver_newer` slice runs contained (wave 17, D-5322); the `sort -V` reference above runs no slice.
    const verEnv = ccrcContainedEnv(mkTmp('ccrc-install-vernewer-'), process.env, { managers: true, curl: 'poison' });
    for (let i = 0; i < sorted.length; i += 1) {
      for (let j = 0; j < sorted.length; j += 1) {
        const r = spawnSync('bash', ['-c', `${fn![0]}\n_ver_newer "$1" "$2"`, '--', sorted[i]!, sorted[j]!], { encoding: 'utf8', env: verEnv });
        expect(r.status, `${sorted[i]} newer than ${sorted[j]}?`).toBe(i > j ? 0 : 1);
      }
    }
    // "the v is stripped nowhere else" (D-3136 minor 4) — MEASURED, not just
    // claimed by the title: exactly one line of ccd/ccrc performs `#v}`
    // stripping, and it is this function's own `local a=…/b=…` line.
    const stripLines = src.split('\n').filter((l) => l.includes('#v}'));
    expect(stripLines, 'a second `#v}` strip site appeared in ccd/ccrc').toEqual([
      '  local a="${1#v}" b="${2#v}" i',
    ]);
  });

  it('ccrc version says when the install was placed unsigned', () => {
    const home = freshBox('ccrc-install-version-unsigned-');
    gitInit(treeRoot(home));
    expect(runInstall(home).code).toBe(0);
    const r = runInstall(home, ['version']);
    expect(r.code, r.stderr).toBe(0);
    expect(r.stdout).toMatch(/^install: complete \(unsigned — placed without a verified provenance bundle/m);
    // Fix round 1 item 20 / review 155 C35: a direct `ccrc install` carries
    // no CCRC_UPDATE_SPINE marker (only `cmd_update`'s own staged-spine call
    // sets one), so CCRC_UPDATE_VERIFIED=1 hand-exported here is stripped —
    // `ccrc version` still reads unsigned, exactly as the unverified case
    // above. The genuine verified case (a real provenance bundle, verified
    // through `cmd_update`'s own spine) is ccrc-update-*.test.ts's happy path.
    const verified = freshBox('ccrc-install-version-verified-');
    gitInit(treeRoot(verified));
    expect(runInstall(verified, ['install'], { CCRC_UPDATE_VERIFIED: '1' }).code).toBe(0);
    expect(runInstall(verified, ['version']).stdout).toMatch(/^install: complete \(unsigned — placed without a verified provenance bundle/m);
  }, 60_000);

  it('ccrc version: the incomplete arm carries no provenance suffix — the record names a different, stale install (D-3136 minor 5)', () => {
    const home = freshBox('ccrc-install-version-incomplete-');
    gitInit(treeRoot(home));
    expect(runInstall(home).code).toBe(0);
    // The box moved on: the completed-install record still names an OLDER
    // sha, itself unsigned — but that label describes the stale install,
    // not the box's current (incomplete) state, so it must not be said.
    writeFileSync(join(home, '.ccrc', 'installed'), 'stalesha00000000000000000000000000000000\nunsigned\n');
    const r = runInstall(home, ['version']);
    expect(r.code, r.stderr).toBe(0);
    expect(r.stdout).toMatch(/^install: incomplete — stamp [0-9a-f]{40}, completed-install record names stalesha00000000000000000000000000000000$/m);
  });

  it('ccrc-caps: rewritten on every install — a stale file is replaced with current content, not merged (D-3136 minor 6)', () => {
    const home = freshBox('ccrc-install-caps-rewrite-');
    gitInit(treeRoot(home));
    mkdirSync(join(home, '.ccrc'), { recursive: true });
    writeFileSync(join(home, '.ccrc', 'ccrc-caps'), 'os plan9\nverify\n');
    expect(runInstall(home).code).toBe(0);
    const os = process.platform === 'darwin' ? 'darwin' : 'linux';
    expect(readFileSync(join(home, '.ccrc', 'ccrc-caps'), 'utf8')).toBe(`os ${os}\n${CAPS_HERE.join('\n')}\n`);
  });

  it('floor: a malformed ~/.ccrc/floor is left untouched, never treated as absent (D-3136)', () => {
    const home = freshBox('ccrc-install-floor-malformed-');
    gitInit(treeRoot(home));
    tagFixture(home, 'v1.0.0');
    mkdirSync(join(home, '.ccrc'), { recursive: true });
    writeFileSync(join(home, '.ccrc', 'floor'), 'three\n');
    const r = runInstall(home);
    expect(r.code, r.stderr).toBe(0);
    expect(readFileSync(join(home, '.ccrc', 'floor'), 'utf8')).toBe('three\n');
    expect(r.stdout).toMatch(/^install: floor: ~\/\.ccrc\/floor is malformed \(got: 'three'\) — left untouched; fix it by hand$/m);
  });

  // D-3146: `_inst_installed`'s floor block used to guard its read with `-f`
  // alone, so a PRESENT-but-UNREADABLE floor read as `cur=""`, fell through
  // every branch, and was silently REPLACED by the `mv -f` (which needs
  // write permission on ~/.ccrc, not read permission on the file) —
  // possibly with a LOWER version. Mirrors `_upd_floor_check`'s own `-r`
  // test (Task 11, D-3136) and the idiom of the update-side unreadable-floor
  // pin: root bypasses permission bits, so this is not measurable running
  // as root — skipped there, and said so.
  it.skipIf(process.getuid?.() === 0)('floor: an UNREADABLE ~/.ccrc/floor is left untouched and named by its own sentence, distinct from "malformed" (D-3146)', () => {
    const home = freshBox('ccrc-install-floor-unreadable-');
    gitInit(treeRoot(home));
    tagFixture(home, 'v1.0.0');
    mkdirSync(join(home, '.ccrc'), { recursive: true });
    const floorFile = join(home, '.ccrc', 'floor');
    writeFileSync(floorFile, 'v9.9.9\n');
    chmodSync(floorFile, 0o000);
    let r: Result;
    try {
      r = runInstall(home);
    } finally {
      chmodSync(floorFile, 0o644);   // restore so the assertion below can read it back
    }
    expect(r.code, r.stderr).toBe(0);
    expect(r.stdout).toMatch(/^install: floor: ~\/\.ccrc\/floor is unreadable — left untouched; fix its permissions by hand$/m);
    expect(r.stdout).not.toMatch(/malformed/);
    expect(readFileSync(floorFile, 'utf8')).toBe('v9.9.9\n');
  });

  it('_inst_installed: the marker write is ONE checked group — no printf sits before an unchecked chmod (D-3135, structural)', () => {
    // The two behavioural cases below prove exit 1 / one die line / no
    // leftover file under two REAL failure conditions (mv blocked, open()
    // denied) — but neither actually distinguishes the fixed code from the
    // bug D-3135 describes: a write that CREATES the temp file and then
    // fails partway through it (ENOSPC is the finding's own example).
    // Reproducing that deterministically needs a size-constrained
    // filesystem (a tiny tmpfs/loop mount), which needs a privileged mount
    // in this harness — skipped per the finding's own "skip a shape only if
    // root would be needed" allowance. What proves the fix instead is this
    // structural pin: the printf(s) now sit INSIDE the group the `> "$tmp"`
    // redirect opens, and that group is the FIRST link of the && chain —
    // never a printf whose own exit status is discarded before a later,
    // separately-checked `chmod`.
    const src = read(join(REPO, 'ccd', 'ccrc'));
    const fn = /^_inst_installed\(\) \{[\s\S]*?\n\}/m.exec(src);
    expect(fn, 'ccd/ccrc has no _inst_installed').not.toBeNull();
    expect(fn![0]).toMatch(/\}\s*>\s*"\$tmp"\s*&&\s*chmod 644 "\$tmp" && mv -f "\$tmp" "\$dest"/);
  });

  it('_inst_installed: a directory at ~/.ccrc/installed blocks the mv, dies loudly, and leaves no half-record (D-3135)', () => {
    const home = freshBox('ccrc-install-installed-mvfail-');
    gitInit(treeRoot(home));
    // A pre-existing DIRECTORY at the record's own path, made non-writable:
    // the redirect that creates installed.tmp.$$ (a SIBLING path, inside
    // ~/.ccrc itself) still succeeds, and chmod on that temp file succeeds —
    // only the final `mv -f "$tmp" "$dest"` fails, because mv cannot add an
    // entry to a directory it has no write permission on. This isolates the
    // PLACEMENT half of D-3135's fix (nothing else in the spine touches
    // BOX_INSTALLED_FILE, so no earlier step is affected).
    mkdirSync(join(home, '.ccrc', 'installed'), { recursive: true });
    chmodSync(join(home, '.ccrc', 'installed'), 0o555);
    let r: Result;
    try {
      r = runInstall(home);
    } finally {
      chmodSync(join(home, '.ccrc', 'installed'), 0o755);
    }
    expect(r.code).toBe(1);
    const dieLines = (r.stderr.match(/writing .*installed failed/g) ?? []).length;
    expect(dieLines, r.stderr).toBe(1);
    // The directory survives, empty: mv never replaced it, and the cleanup
    // removed the temp file mv left orphaned at its original location.
    expect(statSync(join(home, '.ccrc', 'installed')).isDirectory()).toBe(true);
    expect(readdirSync(join(home, '.ccrc', 'installed'))).toEqual([]);
    expect(readdirSync(join(home, '.ccrc')).filter((f) => f.startsWith('installed.tmp.'))).toEqual([]);
  });

  it('_inst_installed: a write that fails right after creating the temp file never places a record — one redirect, not two printfs each on its own (D-3135)', () => {
    // The "redirect denied outright" shape, measured in isolation from the
    // rest of the spine: this harness extracts `_inst_installed` (plus the
    // real `_ccrc_die`/`PROG` it calls) out of ccd/ccrc, exactly as the
    // `_ver_newer` case above extracts that function, and runs it directly
    // against a `~/.ccrc` this process cannot write into — so the failure
    // is scoped to the function under test, not to whichever earlier
    // `cmd_install` step would hit the same wall first in a full spine run
    // (`_inst_accounts_sh` regenerates its file on every install and would
    // fail before `_inst_installed` is ever reached). NOTE (measured): this
    // shape passes against the PRE-FIX code too — when open() itself is
    // denied, no temp file is ever created, so the OLD code's separately-
    // checked `chmod 644 "$tmp"` fails on its own and still dies correctly.
    // It is kept because it is the finding's own suggested shape and a real
    // regression guard on that path; the structural case above is what
    // actually pins the fix (D-3135's bug needs a write that CREATES the
    // temp file and fails partway through it, which needs a size-
    // constrained filesystem to reproduce and is skipped for that reason).
    const src = read(join(REPO, 'ccd', 'ccrc'));
    const progLine = /^PROG=.*$/m.exec(src);
    expect(progLine, 'ccd/ccrc has no PROG=').not.toBeNull();
    // Fix round 1 item 11 / review 155 C17: `_ccrc_die` now calls
    // `_upd_redact` — this harness DOES trigger a die (the assertion below
    // reads its stderr), so it must pick that definition up too.
    const redactBlock = /^_upd_redact\(\) \{[\s\S]*?\n\}$/m.exec(src);
    expect(redactBlock, 'ccd/ccrc has no _upd_redact').not.toBeNull();
    const dieLine = /^_ccrc_die\(\) \{.*\}$/m.exec(src);
    expect(dieLine, 'ccd/ccrc has no _ccrc_die').not.toBeNull();
    const fn = /^_inst_installed\(\) \{[\s\S]*?\n\}/m.exec(src);
    expect(fn, 'ccd/ccrc has no _inst_installed').not.toBeNull();

    const home = mkTmp('ccrc-inst-installed-redirect-');
    mkdirSync(join(home, '.ccrc'), { recursive: true });
    chmodSync(join(home, '.ccrc'), 0o555);
    const harness = [
      'set -uo pipefail',
      progLine![0],
      redactBlock![0],
      dieLine![0],
      '_box_build_fields() { BOX_BUILD=(deadbeefdeadbeefdeadbeefdeadbeefdeadbeef main 2026-01-01T00:00:00Z false ""); return 0; }',
      `BOX_INSTALLED_FILE="${join(home, '.ccrc', 'installed')}"`,
      fn![0],
      '_inst_installed',
    ].join('\n');
    // Contained (wave 17, D-5322). The function reads CCRC_UPDATE_VERIFIED and CCRC_UPDATE_SPINE from the env, and the
    // builder starts from `process.env`, so they ride through exactly as they did when the spawn inherited it.
    const env = ccrcContainedEnv(home, process.env, { managers: true, curl: 'poison' });
    let r: Result;
    try {
      const p = spawnSync('bash', ['-c', harness], { encoding: 'utf8', env });
      r = { code: p.status ?? -1, stdout: p.stdout ?? '', stderr: p.stderr ?? '' };
    } finally {
      chmodSync(join(home, '.ccrc'), 0o755);
    }
    expect(r.code).toBe(1);
    const dieLines = (r.stderr.match(/writing .*installed failed/g) ?? []).length;
    expect(dieLines, r.stderr).toBe(1);
    expect(existsSync(join(home, '.ccrc', 'installed'))).toBe(false);
    // No orphaned temp file either — the redirect itself never created one.
    expect(readdirSync(join(home, '.ccrc'))).toEqual([]);
  });
});

describe('ccrc install: install-step names the step the spine is entering (design §11; W4 Task 4)', () => {
  it('a completed install leaves NO install-step — _inst_installed removes it once the record is placed', () => {
    const home = freshBox('ccrc-install-step-done-');
    gitInit(treeRoot(home));
    const r = runInstall(home);
    expect(r.code, r.stderr).toBe(0);
    expect(existsSync(dotCcrc(home, 'installed')), 'no record was placed — the absence below would be vacuous').toBe(true);
    expect(existsSync(dotCcrc(home, 'install-step')), 'a completed spine left its step marker').toBe(false);
  });

  it('a spine that dies leaves install-step naming the step it died IN — not the one before it', () => {
    const home = freshBox('ccrc-install-step-died-');
    gitInit(treeRoot(home));
    mkdirSync(join(home, '.ccrc'), { recursive: true });
    writeFileSync(dotCcrc(home, 'node-id'), 'not-a-uuid\n');
    const r = runInstall(home);
    expect(r.code).toBe(1);
    expect(r.stderr).toMatch(/node-id exists but is not a uuid/);
    expect(read(dotCcrc(home, 'install-step'))).toBe('_inst_node_id\n');
  });

  it('a marker that cannot be written refuses BEFORE its step runs — nothing of that step happens', () => {
    const home = freshBox('ccrc-install-step-blocked-');
    // A directory at the marker's path: `_plat_mv_notdir` refuses to place a
    // file over it, where a bare `mv -f` would drop the temp INSIDE it and
    // answer 0.
    mkdirSync(join(dotCcrc(home, 'install-step'), 'in-the-way'), { recursive: true });
    const r = runInstall(home);
    expect(r.code).toBe(1);
    expect(r.stderr).toMatch(/^ccrc: could not record the install step marker ~\/\.ccrc\/install-step before _inst_banner — nothing of _inst_banner ran$/m);
    expect(r.stdout, 'a step ran after its marker failed').not.toMatch(/^install: /m);
    expect(existsSync(dotCcrc(home, 'accounts.json'))).toBe(false);
  });
});

describeLinux('ccrc install and uninstall leave another repository\'s GPT-lane files alone (D-3478)', () => {
  it('a foreign ccgpt, ccgpt-proxy and ccgpt-usage in ~/.local/bin, and an alias to the first, survive install --role fleet and uninstall, byte for byte', () => {
    // The fleet box's shape before the cutover (m-livebox): three dotless files
    // another repository owned — the launcher both live Codex lanes exec'd, its
    // shim, its publisher (retired by Plan 4) — and a lane alias symlinked to the
    // launcher. A box may still carry another repository's `ccgpt` (the fleet
    // box's copy was removed by Plan 4), and `_inst_atomic` has no ownership
    // check, so ONE placement at any of these names silently cuts over every
    // lane that execs it; that is why ccrc's launcher is `ccrc-codex`. This case
    // reads what the verbs DID, so it also sees a placement or removal from a
    // function `install-census.test.ts` does not read.
    const home = freshBox('ccrc-install-foreign-ccgpt-bins-');
    mkdirSync(join(home, '.ccrc'), { recursive: true });
    writeFileSync(join(home, '.ccrc', 'agent.env'),
      'CCRC_SERVER_URL=http://127.0.0.1:7788\nCCRC_AGENT_TOKEN=fixture-not-a-real-token\n');
    const bin = join(home, '.local', 'bin');
    // Invisible to every scan on purpose — no CLAUDE_CONFIG_DIR, no marker — so
    // this case is about placement and removal, never about a doctor verdict.
    const foreign: Record<string, string> = {
      'ccgpt': '#!/usr/bin/env bash\n# FOREIGN-FIXTURE-2b2: another repository owns this launcher\nexit 0\n',
      'ccgpt-proxy': '#!/usr/bin/env python3\n# FOREIGN-FIXTURE-2b2: another repository owns this shim\n',
      'ccgpt-usage': '#!/usr/bin/env bash\n# FOREIGN-FIXTURE-2b2: another repository owns this publisher\nexit 0\n',
    };
    for (const [name, text] of Object.entries(foreign)) writeFileSync(join(bin, name), text, { mode: 0o755 });
    symlinkSync('ccgpt', join(bin, 'ext-a'));
    const untouched = (stage: string): void => {
      for (const [name, text] of Object.entries(foreign)) {
        const p = join(bin, name);
        expect(existsSync(p), `${stage}: ${name} is gone`).toBe(true);
        expect(lstatSync(p).isFile(), `${stage}: ${name} is no longer a regular file`).toBe(true);
        expect(read(p), `${stage}: ${name} changed`).toBe(text);
        expect(statSync(p).mode & 0o777, `${stage}: ${name} mode`).toBe(0o755);
      }
      expect(lstatSync(join(bin, 'ext-a')).isSymbolicLink(), `${stage}: the alias is gone`).toBe(true);
      expect(readlinkSync(join(bin, 'ext-a')), `${stage}: the alias was repointed`).toBe('ccgpt');
    };
    const inst = runInstall(home, ['install', '--role', 'fleet']);
    expect(inst.code, inst.stderr).toBe(0);
    untouched('after install --role fleet');
    // Plan 2b-2 placed ccrc's own launcher, so it lands BESIDE them. That makes
    // this a statement about the NAME, rather than about an install that placed
    // nothing at all.
    expect(read(join(bin, 'ccrc-codex')), 'ccrc-codex is not the placed tree\'s copy').toBe(read(placed(home, 'ccd', 'ccrc-codex')));
    const un = runInstall(home, ['uninstall']);
    expect(un.code, `stderr: ${un.stderr}\nstdout: ${un.stdout}`).toBe(0);
    untouched('after uninstall');
    expect(existsSync(join(bin, 'ccrc-codex')), 'uninstall left ccrc\'s own launcher behind').toBe(false);
  });
});

describe('ccrc install: the harness contains the transient-unit launcher (Plan 2b-2 Task 10)', () => {
  it('systemd-run resolves inside the fixture HOME and refuses when no fake user manager is planted', () => {
    // The containment rule: every `systemd-run` a test can reach is a
    // fixture. Before this task `command -v systemd-run` answered the REAL
    // one here (m-platform §3.2). The probe resolves the name first and runs
    // it only when it resolves under $HOME, so a broken harness reports
    // UNCONTAINED instead of starting a unit on this box.
    const home = freshBox('ccrc-install-sdrun-contained-');
    const r = spawnSync(BASH, ['-c', SPINE_CONTAINMENT_PROBE], { env: ccrcEnv(home), encoding: 'utf8' });
    expect(r.stdout).toContain(`at=${join(home, '.local', 'bin', 'systemd-run')}\n`);
    expect(r.stdout).toMatch(/^run-rc=97$/m);
    expect(r.stdout).toMatch(/^env-rc=0$/m);
    expect(spineRunCalls(home).join('\n')).toContain('--unit=fixture-containment-probe.service');
  });
});

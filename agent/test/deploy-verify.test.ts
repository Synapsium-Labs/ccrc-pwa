// FINAL REVIEW ROUND 2, gates finding 5. `deploy.sh agent` ended at
// `systemctl --user restart ccrc-agent.service`, which returns success the
// moment systemd FORKS — so an agent that throws during ESM evaluation
// crash-looped at 3-second intervals behind a deploy that exited 0.
// (`deploy.sh server` had `sleep 1 && curl -fsS "$HEALTH_URL"` at the time —
// build7-core Task 1 replaced that `sleep 1` with the same verify-service.sh
// call this suite pins for the agent, kept the curl after it, and this file's
// second `describe` block below is what proves that wiring; see its
// comments, not this paragraph, for the server chain's current shape.)
//
// That is not a spare failure mode. It is where the agent's own security design
// puts its last line of defence: `auditExecWhitelist()` runs at module load and
// `refuseToBoot` THROWS on purpose. Everything a TYPE can see is caught by the
// `npm run build` earlier in the same chain, so the states that actually reach
// `refuseToBoot` on a host are the ones no type can see — and those were
// exactly the states the deploy did not notice.
//
// `deploy/verify-service.sh` closes it. This file is its gate.
//
// WHY IT LIVES IN THE AGENT PACKAGE: the script started out verifying only the
// agent unit, the agent suite already ran in the gate list, and this is the
// package whose structural PATH containment makes it safe to run a script
// that shells out to `systemctl` at all. `verify-service.sh` itself now backs
// BOTH deploy chains (build7-core Task 1), and this file grew to match — the
// second `describe` block below reads `deploy.sh` directly and pins the
// server chain's ordering and its `ccrc.service` RestartSec too. Nothing under
// `server/test/` gates any of that: this is the only suite anywhere that would
// go red if the server chain's `REMOTE_CMD` were reordered or `ccrc.service`'s
// RestartSec were raised past the observation window.
//
// NOTHING HERE TOUCHES REAL SYSTEMD. Every case runs with a stub `systemctl`
// earliest on PATH, and — following the discipline in `contain-path.test.ts` —
// the resolution is PROVEN to land inside the stub directory BEFORE the script
// is executed, so a broken stub refuses to run rather than querying the live
// fleet's units. `contain-path.setup.ts` keeps a refusing `systemctl` under
// that as a second net.
import { describe, it, expect } from 'vitest';
import { spawnSync } from 'node:child_process';
import { chmodSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkTmp } from './tmpHelpers.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const deployDir = path.resolve(here, '..', '..', 'deploy');
const VERIFY = path.join(deployDir, 'verify-service.sh');

/** Build a stub `systemctl`/`journalctl` pair whose answers are scripted.
 *
 *  `isActive` and `mainPid` are lists consumed one per call, so a crash loop is
 *  expressed the way the script has to detect it: the same query answered
 *  differently on either side of the observation window. */
function stubs(opts: { isActive: string[]; mainPid: string[] }): string {
  const dir = mkTmp('ccrc-agent-deployverify-');
  const seq = (name: string, values: string[]): string =>
    `c="$D/${name}.n"; n=$(cat "$c" 2>/dev/null || echo 0); n=$((n+1)); echo "$n" > "$c";\n`
    + values.map((v, i) => `  [ "$n" = "${i + 1}" ] && { printf '%s\\n' ${JSON.stringify(v)}; }\n`).join('')
    + `  [ "$n" -gt ${values.length} ] && { printf '%s\\n' ${JSON.stringify(values[values.length - 1] ?? '')}; }\n`;

  writeFileSync(path.join(dir, 'systemctl'),
    '#!/bin/sh\n'
    + `D=${JSON.stringify(dir)}\n`
    + 'echo "systemctl $*" >> "$D/calls"\n'
    // `status` is only ever called on the failure path; it must not be counted
    // as one of the scripted queries, and it must never be a real invocation.
    + 'case " $* " in *" status "*) echo "[stub status]"; exit 0;; esac\n'
    + 'case " $* " in\n'
    + '  *" is-active "*)\n'
    + `    ${seq('isactive', opts.isActive)}`
    + '    exit 0;;\n'
    + '  *" MainPID "*)\n'
    + `    ${seq('mainpid', opts.mainPid)}`
    + '    exit 0;;\n'
    + 'esac\n'
    + 'echo "stub systemctl: unexpected argv: $*" >&2\nexit 64\n');
  chmodSync(path.join(dir, 'systemctl'), 0o755);

  writeFileSync(path.join(dir, 'journalctl'),
    '#!/bin/sh\necho "journalctl $*" >> ' + JSON.stringify(path.join(dir, 'calls'))
    + '\necho "[stub journal] Error: refuseToBoot: EXEC_WHITELIST has a forbidden key"\n');
  chmodSync(path.join(dir, 'journalctl'), 0o755);
  return dir;
}

function runVerify(dir: string, unit = 'ccrc-agent.service'): {
  code: number; stdout: string; stderr: string; calls: string;
} {
  const PATH = `${dir}${path.delimiter}${process.env.PATH ?? ''}`;
  // PROVE the stub is what will be resolved, before executing anything. A test
  // whose safety depends on the thing it is testing is the loaded gun this
  // package has already fired four times.
  const resolved = spawnSync('sh', ['-c', 'command -v systemctl'], {
    encoding: 'utf8', env: { ...process.env, PATH },
  }).stdout.trim();
  expect(resolved.startsWith(`${dir}${path.sep}`),
    `systemctl must resolve inside the stub dir; got "${resolved}" — REFUSING to run the verifier`).toBe(true);

  const r = spawnSync('bash', [VERIFY, unit], {
    encoding: 'utf8',
    env: {
      ...process.env, PATH,
      CCRC_VERIFY_SETTLE: '0', CCRC_VERIFY_WINDOW: '0', CCRC_VERIFY_LOG_LINES: '5',
    },
  });
  let calls = '';
  try { calls = readFileSync(path.join(dir, 'calls'), 'utf8'); } catch { calls = ''; }
  return { code: r.status ?? -1, stdout: r.stdout ?? '', stderr: r.stderr ?? '', calls };
}

describe('deploy.sh agent verifies the restart it just performed', () => {
  it('passes when the unit is active with a MainPID that does not move', () => {
    const r = runVerify(stubs({ isActive: ['active', 'active'], mainPid: ['4242', '4242'] }));
    expect(r.code, `stderr:\n${r.stderr}`).toBe(0);
    expect(r.stdout).toContain('MainPID 4242 stable');
  });

  it('FAILS on the crash loop the whitelist throw produces — active twice, different PID', () => {
    // The whole finding in one case. `systemctl restart` succeeded, `is-active`
    // says `active` on both samples, and the service is dying every 3 seconds.
    // A single-sample check passes this; the deploy must not.
    const r = runVerify(stubs({ isActive: ['active', 'active'], mainPid: ['111', '222'] }));
    expect(r.code, 'a crash-looping agent must fail the deploy').toBe(1);
    expect(r.stderr).toContain('CRASH-LOOPING');
    expect(r.stderr).toContain('111');
    expect(r.stderr).toContain('222');
    // Loudly, and with the evidence: the finding's whole complaint was that the
    // failure was "discoverable only by someone thinking to run journalctl".
    expect(r.stderr).toContain('DEPLOY FAILED');
    expect(r.calls, 'the failure path did not dump the journal').toContain('journalctl');
    expect(r.stderr).toContain('refuseToBoot');
  });

  it('FAILS when the unit never reached active — the auto-restart window', () => {
    const r = runVerify(stubs({ isActive: ['activating', 'activating'], mainPid: ['0', '0'] }));
    expect(r.code).toBe(1);
    expect(r.stderr).toContain("unit is 'activating', not 'active'");
    expect(r.calls).toContain('journalctl');
  });

  it('FAILS when the unit dies during the observation window', () => {
    const r = runVerify(stubs({ isActive: ['active', 'failed'], mainPid: ['4242', '0'] }));
    expect(r.code).toBe(1);
    expect(r.stderr).toContain("became 'failed'");
  });

  it('FAILS when systemd reports active with no MainPID', () => {
    const r = runVerify(stubs({ isActive: ['active', 'active'], mainPid: ['0', '0'] }));
    expect(r.code).toBe(1);
    expect(r.stderr).toContain('no MainPID');
  });

  it('refuses to run without a unit name rather than verifying something else', () => {
    const dir = stubs({ isActive: ['active'], mainPid: ['1'] });
    const r = spawnSync('bash', [VERIFY], {
      encoding: 'utf8', env: { ...process.env, PATH: `${dir}${path.delimiter}${process.env.PATH ?? ''}` },
    });
    expect(r.status).toBe(2);
    expect(r.stderr).toContain('usage:');
  });
});

describe('the verification is actually wired into the deploy, and can observe a restart', () => {
  const deploySh = readFileSync(path.join(deployDir, 'deploy.sh'), 'utf8');

  it('the agent path calls verify-service.sh as the LAST link of its && chain', () => {
    // Position matters twice over: anywhere earlier and it would verify a
    // service that is about to be restarted again, and anywhere off the chain
    // its exit status would not become the ssh exit status that `set -e`
    // aborts on.
    const agentCmd = /AGENT_CMD='([\s\S]*?)'/.exec(deploySh);
    expect(agentCmd, 'the agent remote command is no longer a single quoted block').toBeTruthy();
    const links = agentCmd![1]!.split('&&').map((s) => s.replace(/\\\s*$/, '').trim());
    expect(links[links.length - 1],
      'verify-service.sh is not the last link of the agent chain')
      .toContain('verify-service.sh ccrc-agent.service');
    const restartAt = links.findIndex((l) => l.includes('restart ccrc-agent.service'));
    expect(restartAt, 'the agent path no longer restarts the unit').toBeGreaterThan(-1);
    expect(restartAt).toBeLessThan(links.length - 1);
  });

  it('the server path calls verify-service.sh after the restart and before the health curl', () => {
    // The server caller is not pinned by the agent-chain test above — it lives
    // in a different quoted block (REMOTE_CMD, not AGENT_CMD). Without this,
    // deleting `&& bash ~/ccrc/deploy/verify-service.sh ccrc.service` from
    // deploy.sh, or reordering the curl in front of it to shave a few seconds
    // off a deploy, left the whole server+agent+pwa suite green.
    const remoteCmd = /REMOTE_CMD='([\s\S]*?)'/.exec(deploySh);
    expect(remoteCmd, 'the server remote command is no longer a single quoted block').toBeTruthy();
    const links = remoteCmd![1]!.split('&&').map((s) => s.replace(/\\\s*$/, '').trim());
    const restartAt = links.findIndex((l) => l.includes('restart ccrc.service'));
    const verifyAt = links.findIndex((l) => l.includes('verify-service.sh ccrc.service'));
    const curlAt = links.findIndex((l) => l.startsWith('curl -fsS'));
    expect(restartAt, 'the server path no longer restarts the unit').toBeGreaterThan(-1);
    expect(verifyAt, 'verify-service.sh ccrc.service is missing from the server chain').toBeGreaterThan(-1);
    expect(curlAt, 'the health curl is missing from the server chain').toBeGreaterThan(-1);
    expect(verifyAt, 'verify-service.sh must run after the restart it is verifying')
      .toBeGreaterThan(restartAt);
    expect(curlAt, 'the health curl must run after verify-service.sh, not race it')
      .toBeGreaterThan(verifyAt);
  });

  it('the server path is the only one that also curls health — the agent has nothing to GET', () => {
    // Before this task the asymmetry ran the OTHER way: only the agent chain
    // called verify-service.sh and only the server chain curled. Now both
    // chains share verify-service.sh (asserted above and by the agent-chain
    // test), so a stale comment claiming "the server's health curl" is the
    // asymmetry would be describing a tree that no longer exists. The
    // surviving, correct asymmetry is narrower: only the server also curls,
    // because — per verify-service.sh's own header — the agent binds a
    // bearer-token WebSocket upgrade with nothing to GET.
    const agentCmd = /AGENT_CMD='([\s\S]*?)'/.exec(deploySh)![1]!;
    expect(deploySh).toContain('curl -fsS ');
    expect(agentCmd, 'the agent chain has no HTTP route to curl and must not carry one')
      .not.toContain('curl');
  });

  it('the observation window is longer than EVERY unit\'s RestartSec, or it cannot see a loop', () => {
    // A cross-file invariant, because the two numbers live in different files
    // and only one of them looks like it matters. If RestartSec were raised to
    // 10 on either unit and the window left at 5, every crash loop on that
    // unit would pass with a stable PID and this whole gate would go quietly
    // decorative. One verify-service.sh and one WINDOW default now guard BOTH
    // units, so the invariant has to hold against both RestartSec values, not
    // just the agent's — a `ccrc.service` RestartSec raised on its own, with
    // nothing agent-side to trip, used to pass this suite.
    //
    // Stage 0 widened the set: the supervisor sweep below runs verify-service.sh
    // against every claude-session@ unit, so ITS RestartSec joins the invariant
    // — it lives under ccd/, not deploy/, which is exactly how it would have
    // been missed.
    const verifySrc = readFileSync(VERIFY, 'utf8');
    const window = Number(/CCRC_VERIFY_WINDOW:-(\d+)/.exec(verifySrc)?.[1]);
    expect(Number.isFinite(window), 'CCRC_VERIFY_WINDOW default not found').toBe(true);

    const units = [
      path.join(deployDir, 'ccrc-agent.service'),
      path.join(deployDir, 'ccrc.service'),
      path.join(deployDir, '..', 'ccd', 'claude-session@.service'),
    ];
    for (const unitFile of units) {
      const unitSrc = readFileSync(unitFile, 'utf8');
      const restartSec = Number(/^RestartSec=(\d+)/m.exec(unitSrc)?.[1]);
      expect(Number.isFinite(restartSec), `RestartSec not found in ${unitFile}`).toBe(true);
      expect(window, `observation window ${window}s must exceed ${path.basename(unitFile)}'s RestartSec ${restartSec}s`)
        .toBeGreaterThan(restartSec);
    }
  });

  it('every hand-copied script lands via scp-to-temp + mv, never an in-place overwrite', () => {
    // Stage 0, finding 1 — a live correctness bug, not a hardening nicety.
    // `scp` writes the DESTINATION INODE in place, and bash executes scripts
    // lazily from a saved byte offset: a `ccd` invocation that is mid-flight
    // while the deploy overwrites it resumes inside the NEW bytes at the OLD
    // offset. Reproduced: a verb prints its correct result, then exits 2 on a
    // syntax error — which lifecycle.ts maps to ok:false and the routes turn
    // into a 409 for a destructive action that already completed. `mv -f`
    // replaces the directory entry instead (rename(2), atomic): running
    // readers keep the old inode to EOF, new invocations get the new file.
    const fn = /install_atomic\(\) \{([\s\S]*?)\n\}/.exec(deploySh);
    expect(fn, 'deploy.sh has no install_atomic() helper').toBeTruthy();
    const body = fn![1]!;
    const scpAt = body.indexOf('.incoming-$TS');
    const chmodAt = body.indexOf('chmod');
    const mvAt = body.indexOf('mv -f');
    expect(scpAt, 'install_atomic must scp to a .incoming-$TS temp name').toBeGreaterThan(-1);
    expect(chmodAt, 'install_atomic must chmod the temp file').toBeGreaterThan(-1);
    expect(mvAt, 'install_atomic must finish with mv -f').toBeGreaterThan(-1);
    // chmod BEFORE mv: the file must never be live at its final name without
    // its final mode — a session that execs ccd in that window gets EACCES,
    // which systemd Restart=always turns into a crash loop.
    expect(chmodAt, 'chmod must happen before the mv, not after the file is live')
      .toBeLessThan(mvAt);
    // Aborted-run strays (review finding): a deploy that dies between scp and
    // mv leaves an executable `<dest>.incoming-<ts>` beside the live binary —
    // on PATH, in ccd's case — forever. The successful path cleans prior
    // strays AFTER its own mv (by then the current temp has been renamed
    // away, so the glob can only match leftovers from dead runs).
    const strayRmAt = body.indexOf('rm -f $dest.incoming-');
    expect(strayRmAt, 'install_atomic must sweep strays from aborted runs').toBeGreaterThan(-1);
    expect(strayRmAt, 'the stray sweep must run after the mv, or it deletes the file it just shipped')
      .toBeGreaterThan(mvAt);

    // And the four artifacts all go THROUGH it. The direct-scp spellings are
    // asserted absent one by one: any of them coming back is this exact bug
    // coming back, whatever else the file looks like by then. BOTH scp dest
    // spellings are banned — `"$BOX":dest` (the old code's) and `"$BOX:dest"`
    // (install_atomic's own, which the first regex draft missed: a call site
    // "fixed" by switching quote style would have sailed through).
    // `.ccrc/accounts.sh` joins the set in stage 2a's Task 10. It is not a
    // script anyone execs, but it IS sourced by every single ccd invocation
    // on the box, which is the same hazard wearing a different hat: a torn
    // half-written roster is a `source` that fails, and ccd's own `|| die`
    // then turns every live supervisor into a failed unit at once.
    for (const dest of [
      '.local/bin/ccd', '.cc-sessions/notify.sh',
      '.cc-sessions/session-hook.sh', '.cc-sessions/install-session-hooks.sh',
      '.ccrc/accounts.sh',
    ]) {
      const escaped = dest.replace(/[./]/g, '\\$&');
      const direct = new RegExp(
        `"\\$\\{SCP\\[@\\]\\}"\\s+\\S+\\s+("\\$BOX":|"\\$BOX:)${escaped}"?(?!\\.incoming)(\\s|$)`, 'm');
      expect(direct.test(deploySh),
        `${dest} is scp'd directly to its final name — the in-place overwrite is back`).toBe(false);
    }
    for (const call of [
      'install_atomic ccd/ccd .local/bin/ccd',
      'install_atomic deploy/notify.sh .cc-sessions/notify.sh',
      'install_atomic ccd/session-hook.sh .cc-sessions/session-hook.sh',
      'install_atomic ccd/install-session-hooks.sh .cc-sessions/install-session-hooks.sh',
      'install_atomic "$ACCOUNTS_SH" .ccrc/accounts.sh',
    ]) {
      expect(deploySh, `missing atomic install call: ${call}`).toContain(call);
    }
  });

  it('the agent deploy installs every systemd artifact the fleet host actually runs', () => {
    // Stage 1 (OSS infra spec §"repo can rebuild a box"). These five artifacts
    // existed ONLY on the live host — the guardrail drop-ins whose own comments
    // call them "the guardrail that actually contains a runaway", the
    // cap-scopes enforcer pair, and two repo files nothing installed
    // (claude-session@.service, tmux.conf). A repo that cannot reproduce its
    // own box is the root defect the whole stage exists to close.
    for (const f of [
      'systemd/claude-session@.service.d/limits.conf',
      'systemd/app-claude-session.slice.d/limits.conf',
      'systemd/ccrc-agent.service.d/protect.conf',
      'systemd/ccd-cap-scopes.service',
      'systemd/ccd-cap-scopes.timer',
    ]) {
      expect(existsSync(path.join(deployDir, f)), `${f} is not in the repo`).toBe(true);
    }
    expect(existsSync(path.join(deployDir, '..', 'ccd', 'ccd-cap-scopes')),
      'the cap-scopes enforcer script is not in the repo').toBe(true);

    // I1, final review: the installs live in AGENT_BUILD_CMD (the build half —
    // npm ci/build plus every unit-file install) — NOT in AGENT_CMD, which is
    // now the restart-only half run in a SEPARATE ssh, after stamp_build.
    // "Before daemon-reload" is therefore no longer a same-chain text-position
    // check: it is guaranteed structurally, because AGENT_BUILD_CMD's ssh must
    // exit 0 (set -euo pipefail) before AGENT_CMD's ssh — where daemon-reload
    // lives — ever runs. Pin both halves plus that structural ordering.
    const buildCmd = /AGENT_BUILD_CMD='([\s\S]*?)'/.exec(deploySh);
    expect(buildCmd, 'the agent build command is no longer a single quoted block').toBeTruthy();
    const buildLinks = buildCmd![1]!.split('&&').map((s) => s.replace(/\\\s*$/, '').trim());
    for (const needle of [
      'cp ~/ccrc/ccd/claude-session@.service ~/.config/systemd/user/',
      'claude-session@.service.d',
      'app-claude\\x2dsession.slice.d',
      'ccrc-agent.service.d',
      'cp ~/ccrc/deploy/systemd/ccd-cap-scopes.service ~/ccrc/deploy/systemd/ccd-cap-scopes.timer ~/.config/systemd/user/',
    ]) {
      const at = buildLinks.findIndex((l) => l.includes(needle));
      expect(at, `AGENT_BUILD_CMD does not install: ${needle}`).toBeGreaterThan(-1);
    }
    expect(buildCmd![1], 'daemon-reload must not run in the build half — it belongs to the restart half')
      .not.toContain('daemon-reload');

    // The restart half: daemon-reload, then the cap-scopes timer enable (it
    // needs daemon-reload to have already picked up the unit AGENT_BUILD_CMD
    // just installed), then the agent restart, then verify-service.sh.
    const agentCmd = /AGENT_CMD='([\s\S]*?)'/.exec(deploySh)![1]!;
    const restartLinks = agentCmd.split('&&').map((s) => s.replace(/\\\s*$/, '').trim());
    const reloadAt = restartLinks.findIndex((l) => l.includes('daemon-reload'));
    const timerAt = restartLinks.findIndex((l) => l.includes('enable --now ccd-cap-scopes.timer'));
    expect(reloadAt, 'AGENT_CMD no longer reloads the daemon').toBeGreaterThan(-1);
    expect(timerAt, 'the cap-scopes timer is never enabled').toBeGreaterThan(reloadAt);

    // And structurally: the build ssh runs, THEN stamp_build, THEN the
    // restart ssh — three sequential top-level statements under
    // `set -euo pipefail`, which is what actually makes "installs precede
    // daemon-reload" true (a stronger guarantee than same-string ordering:
    // AGENT_CMD's ssh cannot even START until AGENT_BUILD_CMD's ssh exits 0).
    const agentBranchStart = deploySh.indexOf('if [ "$TARGET" = "agent" ]');
    const buildExecAt = deploySh.indexOf('"${SSH[@]}" "$BOX" "$AGENT_BUILD_CMD"');
    const stampAt = deploySh.indexOf('stamp_build', agentBranchStart);
    const restartExecAt = deploySh.indexOf('"${SSH[@]}" "$BOX" "$AGENT_CMD"');
    expect(buildExecAt, 'AGENT_BUILD_CMD is defined but never executed').toBeGreaterThan(-1);
    expect(stampAt, 'agent branch never stamps').toBeGreaterThan(buildExecAt);
    expect(restartExecAt, 'AGENT_CMD is defined but never executed').toBeGreaterThan(stampAt);

    expect(deploySh).toContain('install_atomic ccd/ccd-cap-scopes .local/bin/ccd-cap-scopes 755');
    expect(deploySh).toContain('install_atomic ccd/tmux.conf .tmux.conf 644');
    expect(deploySh).toContain('install_atomic ccd/statusline-command.sh .claude/statusline-command.sh 755');
  });

  it('after a new ccd lands, every claude-session@ supervisor is restarted onto it — and re-verified', () => {
    // Stage 0, finding 1's second half. `claude-session@.service` runs `ccd
    // supervise` as a LONG-LIVED bash process, so even an atomic install
    // leaves every live supervisor executing the pre-deploy ccd (the old
    // inode) for days — auto-swap, auto-compact and uuid-sync all keep
    // running yesterday's logic, and the agent's `ccd caps` cache stats the
    // file on disk, structurally blind to what the supervisors execute.
    // The unit is BUILT for this sweep: KillMode=process, with a comment that
    // the tmux substrate must survive a supervisor restart, and
    // `cmd_supervise` re-enters via `cmd_ensure`, which attaches to a live
    // session rather than spawning a second one.
    const agentBranch = deploySh.slice(deploySh.indexOf('if [ "$TARGET" = "agent" ]'), deploySh.indexOf('else'));
    expect(agentBranch, 'the agent branch no longer try-restarts claude-session@*')
      .toContain('try-restart "claude-session@*"');
    // After the agent chain, so a broken agent fails the deploy before any
    // supervisor is touched…
    const sweepAt = agentBranch.indexOf('try-restart "claude-session@*"');
    const agentCmdAt = agentBranch.indexOf('"$AGENT_CMD"');
    expect(agentCmdAt).toBeGreaterThan(-1);
    expect(sweepAt, 'the sweep must run after the agent chain, not before it')
      .toBeGreaterThan(agentCmdAt);
    // …and each restarted supervisor is then held to the same standard as the
    // agent itself: verify-service.sh, per unit, not a fire-and-forget signal.
    const verifyLoopAt = agentBranch.indexOf('verify-service.sh "$u"');
    expect(verifyLoopAt, 'each restarted supervisor must be re-verified via verify-service.sh')
      .toBeGreaterThan(sweepAt);
    // The sweep runs in a FRESH ssh session — AGENT_CMD's export does not
    // carry over, and `systemctl --user` without XDG_RUNTIME_DIR fails
    // 'Failed to connect to bus' on any box where pam_systemd doesn't
    // populate it (the exact contingency both sibling chains carry the
    // export for). Measured: today's boxes populate it; the export is for
    // the box that doesn't.
    const exportAt = agentBranch.indexOf('export XDG_RUNTIME_DIR', agentCmdAt);
    expect(exportAt, 'SWEEP_CMD must export XDG_RUNTIME_DIR like its sibling chains')
      .toBeGreaterThan(-1);
    expect(exportAt).toBeLessThan(sweepAt);
    // DEFINING the sweep is not RUNNING it (review finding: deleting the ssh
    // invocation left this whole suite green). The execution line itself is
    // the pin, after the agent chain's own execution.
    const sweepExecAt = agentBranch.indexOf('"${SSH[@]}" "$BOX" "$SWEEP_CMD"');
    expect(sweepExecAt, 'SWEEP_CMD is defined but never executed').toBeGreaterThan(-1);
    expect(sweepExecAt).toBeGreaterThan(agentBranch.indexOf('"${SSH[@]}" "$BOX" "$AGENT_CMD"'));
  });

  it('coord.db is snapshotted (WAL folded in) into the backup set before the server rsync', () => {
    // Stage 0, finding: coord.db is the one artifact whose loss is not free
    // and the one file the deploy never backed up. A bare `cp coord.db` would
    // be WORSE than nothing: the DB runs in WAL mode and the WAL has been
    // measured holding 10x the main file — a cp of the main file alone is a
    // plausible-looking backup missing nearly everything recent. VACUUM INTO
    // through node:sqlite (proven against the live box; no sqlite3 CLI there)
    // folds the WAL into one consistent snapshot, from a readOnly connection.
    const mjs = readFileSync(path.join(deployDir, 'backup-coord.mjs'), 'utf8');
    expect(mjs).toContain("'VACUUM INTO ?'");
    expect(mjs).toContain('readOnly: true');
    // Interrupted-snapshot discipline (review finding, reproduced with a
    // SIGKILL mid-VACUUM): writing straight to the final name leaves a
    // plausible-looking partial backup — the exact artifact this tool's own
    // header calls worse than nothing. VACUUM INTO a .tmp sibling, rename
    // into place only on success; pre-clean the tmp AND its -journal so a
    // prior abort can neither fail the fresh VACUUM (dest-exists) nor roll a
    // stale hot journal into it.
    expect(mjs, 'snapshot must build at a temp name').toContain(".tmp");
    expect(mjs, 'snapshot must be renamed into place only on success').toContain('renameSync(');
    expect(mjs, 'a stale tmp journal must be cleared before VACUUM').toContain("-journal");
    // The CALL site, not the import line the first draft of this probe hit.
    expect(mjs.lastIndexOf('renameSync('), 'rename must follow the VACUUM, not precede it')
      .toBeGreaterThan(mjs.indexOf("'VACUUM INTO ?'"));

    const serverBranch = deploySh.slice(deploySh.indexOf('else'));
    // The INVOCATION is pinned, not just the guard (review finding: replacing
    // the node call with `|| true` while a comment mentioned the tool's name
    // left the suite green).
    expect(serverBranch, 'the snapshot must actually be invoked via node')
      .toMatch(/node --no-warnings ~\/ccrc-backups\/backup-coord\.mjs ~\/\.ccrc\/coord\.db/);
    // Shipped fresh each run — the deploy cannot depend on a previous deploy
    // having landed it — and invoked under the same absent-source-skippable
    // guard the dist-pwa backup uses: only a MISSING coord.db is skippable,
    // a failed snapshot must abort before rsync --delete touches anything.
    expect(serverBranch).toContain('backup-coord.mjs');
    const guardAt = serverBranch.indexOf('[ ! -f ~/.ccrc/coord.db ]');
    expect(guardAt, 'the coord.db snapshot must be absent-source-skippable, never failure-skippable')
      .toBeGreaterThan(-1);
    const rsyncAt = serverBranch.indexOf('rsync -az');
    expect(rsyncAt).toBeGreaterThan(-1);
    expect(guardAt, 'the snapshot must be taken BEFORE rsync rewrites the tree')
      .toBeLessThan(rsyncAt);
    expect(/cp[^\n]*coord\.db/.test(deploySh),
      'coord.db must never be backed up with cp — a WAL database cp is a silent partial backup')
      .toBe(false);
  });

  it('both branches prune timestamped backups to a bounded set, without failing a completed deploy', () => {
    // Stage 0, finding: ~/ccrc-backups grows without bound on both boxes and
    // sits outside the only disk guard (which watches WORKTREES_ROOT alone).
    const fn = /prune_backups\(\) \{([\s\S]*?)\n\}/.exec(deploySh);
    expect(fn, 'deploy.sh has no prune_backups() helper').toBeTruthy();
    const body = fn![1]!;
    // Timestamped dirs ONLY: ~/ccrc-backups also holds hand-made dirs (a real
    // `pre-flip-agent-dist` exists on the fleet host today) that a bare
    // `ls | head` sweep would silently destroy.
    expect(body, 'prune must match only YYYYMMDD-HHMMSS dirs, never hand-made ones')
      .toContain('[0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9]-[0-9][0-9][0-9][0-9][0-9][0-9]');
    expect(body).toContain('head -n -');
    expect(body).toContain('xargs -r rm -rf');

    // Called on BOTH branches, after each branch's own verification — and a
    // prune failure WARNS rather than failing the run: by that point the
    // deploy has verifiably succeeded, and a nonzero exit would report
    // failure for services that are live and green (the same lie class,
    // pointing the other way, as the 409-after-completion this PR fixes).
    const pruneCalls = [...deploySh.matchAll(/prune_backups\s*\|\|\s*echo[^\n]*>&2/g)];
    expect(pruneCalls.length, 'both branches must prune, and a prune failure must warn, not abort')
      .toBe(2);
    // ONE PER BRANCH, not two anywhere (review finding: count+order alone
    // passed with both calls in the server branch). The `else` splits the
    // file; each branch's prune must live on its own side, after its own
    // chain's execution.
    const elseAt = deploySh.indexOf('\nelse');
    const agentCmdAt = deploySh.indexOf('"$AGENT_CMD"');
    const remoteCmdAt = deploySh.indexOf('"$REMOTE_CMD"');
    const firstPrune = deploySh.indexOf('prune_backups ||');
    const lastPrune = deploySh.lastIndexOf('prune_backups ||');
    expect(firstPrune, 'agent-branch prune must follow the verified chain').toBeGreaterThan(agentCmdAt);
    expect(firstPrune, 'the first prune call must be in the AGENT branch').toBeLessThan(elseAt);
    expect(lastPrune, 'server-branch prune must follow the verified chain').toBeGreaterThan(remoteCmdAt);
    expect(lastPrune, 'the second prune call must be in the SERVER branch').toBeGreaterThan(elseAt);
  });

  it('both rsync lines exclude the mail token, so `ship_secret`\'s hardening is not undone by a plain copy', () => {
    // Fix-round finding (deploy.sh rsyncs the secret to BOTH boxes at the
    // local file's mode, three lines before `ship_secret` hardens the other
    // copy). Both rsync lines push `deploy` as a source tree — `--exclude
    // '*.env'` is there so `ship_env`'s secrets never ride along unhardened;
    // `deploy/ccrc-mail.token` needs the identical treatment or it lands a
    // second, unmanaged copy at whatever mode the local file happens to have,
    // right next to the 0600-under-0700 copy `ship_secret` lands three lines
    // later. Without this assertion the exclude can be dropped from either
    // line — or from one but not the other — and every suite in this repo
    // stays green; nothing else reads `deploy.sh`'s rsync invocations at all.
    // Each invocation is a `\`-continued 3-line block (flags, this exclude,
    // then the source list and destination) — match the WHOLE block, not one
    // line, or the exclude living on its own continuation line would never
    // be seen by a single-line check.
    //
    // Fix-round finding: a bare `rsync -az[\s\S]*?ccrc\//` is lazy across
    // EVERY `rsync -az` in the file, not just these two — deploy.sh's
    // coordinator-skill lane (`rsync -az --delete -e "${SSH[*]}"
    // ccd/coordinator-skill/ "$BOX":.cc-sessions/coordinator-skill/`) is a
    // third invocation with neither `deploy/` in its source nor the token in
    // its tree (its source is `ccd/coordinator-skill/`, which cannot contain
    // a secret), and matched as a false third block. Anchoring the START on
    // the literal prefix unique to a `deploy/`-shipping invocation (`--exclude
    // node_modules`, present on both the agent and server rsyncs, absent from
    // the skill one) keeps the skill lane out of scope BY CONSTRUCTION — it
    // never begins a match — rather than by accident of how many `"$BOX":ccrc/`
    // strings happen to exist in the file.
    const rsyncBlocks = [...deploySh.matchAll(
      /rsync -az --delete -e "\$\{SSH\[\*\]\}" --exclude node_modules[\s\S]*?"\$BOX":ccrc\//g,
    )].map((m) => m[0]);
    expect(rsyncBlocks.length, 'expected exactly two rsync invocations (agent path, server path)').toBe(2);
    for (const block of rsyncBlocks) {
      expect(block, `rsync invocation is missing --exclude 'ccrc-mail.token':\n${block}`)
        .toContain("--exclude 'ccrc-mail.token'");
    }
  });

  it("every ~/ccrc/<dir>/... path a branch's remote commands reach into is actually shipped by that branch's rsync", () => {
    // The class of bug, not one instance of it: `AGENT_BUILD_CMD` (or any other
    // remote command in a branch) can `cp`/`cd` into `~/ccrc/<dir>/...` for a
    // <dir> the branch's OWN rsync never sends — rsync ships whole top-level
    // repo directories, not individual files, so referencing a file inside a
    // directory nobody shipped is a live "No such file or directory" on a
    // fresh box, invisible until the exact deploy that needs it runs. Caught
    // live: AGENT_BUILD_CMD's `cp ~/ccrc/ccd/claude-session@.service ...`
    // against an agent rsync source list of `agent shared deploy` — `ccd`
    // never reached the box. A hardcoded `expect(...).toContain('ccd')` would
    // only catch THIS directory going missing again; this test instead parses
    // every `~/ccrc/<dir>/` reference out of each branch's own text and checks
    // it against that branch's own rsync source list, so the next directory
    // this happens to is caught the same way.
    //
    // `~/ccrc/<dir>/` (note the trailing slash the regex requires) is what
    // this test looks for — it must NOT match `~/ccrc-backups/...` (no slash
    // between "ccrc" and what follows) or `~/.ccrc/...` (a different, dotted
    // directory the deploy uses for config/state, never rsynced as a tree).
    const agentBranch = deploySh.slice(
      deploySh.indexOf('if [ "$TARGET" = "agent" ]'), deploySh.indexOf('\nelse'));
    const serverBranch = deploySh.slice(deploySh.indexOf('\nelse'));

    const rsyncSources = (branch: string, label: string): string[] => {
      // Anchored the same way the mail-token exclude test anchors, and for the
      // identical reason: a bare `rsync -az[\s\S]*?ccrc\//` would also match
      // the coordinator-skill lane, which ships to `.cc-sessions/`, not
      // `~/ccrc/`, and carries no `--exclude node_modules`.
      const m = /rsync -az --delete -e "\$\{SSH\[\*\]\}" --exclude node_modules[\s\S]*?"\$BOX":ccrc\//.exec(branch);
      expect(m, `${label} branch has no rsync shipping a tree into ~/ccrc/`).toBeTruthy();
      const sourceLine = m![0].trim().split('\n').pop()!;
      return sourceLine.replace(/"\$BOX":ccrc\/\s*$/, '').trim().split(/\s+/);
    };

    const referencedDirs = (branch: string): Set<string> => {
      const dirs = new Set<string>();
      for (const ref of branch.matchAll(/~\/ccrc\/([A-Za-z0-9_.-]+)\//g)) dirs.add(ref[1]!);
      return dirs;
    };

    for (const [label, branch] of [['agent', agentBranch], ['server', serverBranch]] as const) {
      const sources = rsyncSources(branch, label);
      for (const dir of referencedDirs(branch)) {
        expect(sources,
          `${label} branch's remote commands reference ~/ccrc/${dir}/... but its rsync ships only [${sources.join(', ')}] — ~/ccrc/${dir} will not exist on a fresh box`)
          .toContain(dir);
      }
    }
  });

  it("ccrc.service reads ~/.ccrc/ccrc.env and bakes NOTHING — the env file deploy.sh ships is finally read", () => {
    // Survey blocker #1 by depth: deploy.sh faithfully shipped ccrc.env to
    // ~/.ccrc/ for weeks while the unit read nothing, and the live box's real
    // config accreted in a hand-made drop-in the repo cannot see. The `-`
    // prefix keeps a fresh box bootable with no env file at all (local mode,
    // loopback defaults from config.ts).
    const unit = readFileSync(path.join(deployDir, 'ccrc.service'), 'utf8');
    expect(unit).toContain('EnvironmentFile=-%h/.ccrc/ccrc.env');
    expect(/^Environment=/m.test(unit),
      'baked Environment= literals are back in ccrc.service').toBe(false);

    // And the example documents every variable the LIVE box actually needs —
    // the three VAPID vars were real config with no documentation anywhere.
    const example = readFileSync(path.join(deployDir, 'ccrc.env.example'), 'utf8');
    for (const v of ['CCRC_HOST', 'CCRC_PORT', 'CCRC_VAPID_PUBLIC',
      'CCRC_VAPID_PRIVATE', 'CCRC_VAPID_SUBJECT', 'CCRC_PROJECTS_ROOT']) {
      expect(example, `ccrc.env.example does not document ${v}`).toContain(v);
    }
  });

  it('every deploy stamps ~/.ccrc/build.json on the target — from the LOCAL git tree, AFTER the remote build succeeds and BEFORE the restart that makes it live', () => {
    // Stage 1's central artifact: the "from" and "to" that update/skew
    // detection needs. Computed locally (the rsynced ~/ccrc tree on the box
    // is NOT a git repo), shipped like every other file (install_atomic:
    // temp + rename, so a reader never sees a torn stamp).
    const fn = /stamp_build\(\) \{([\s\S]*?)\n\}/.exec(deploySh);
    expect(fn, 'deploy.sh has no stamp_build() helper').toBeTruthy();
    const body = fn![1]!;
    // The sha/ref/dirty facts are computed at top level (they serve BOTH
    // branches and Task 8's assertions); the helper's job is the shipping.
    expect(deploySh).toContain('BUILD_SHA="$(git rev-parse HEAD)"');
    expect(deploySh, 'the stamp must state dirtiness, not hide it').toContain('git diff --quiet');
    expect(body).toContain('"$BUILD_SHA"');
    expect(body).toContain('install_atomic');
    expect(body).toContain('.ccrc/build.json');

    // I1, final review: stamping BEFORE the remote build let a failed
    // `npm ci && npm run build` (a registry hiccup — the common case) abort
    // the deploy with build.json already claiming the NEW sha while the
    // box's dist/ was never rebuilt to match — `ccd version` lies
    // immediately, and /health lies the moment Restart=always next cycles
    // the unit onto that untouched dist/. Exactly the measurement-forgery
    // class this file's own stamp_build comment bans by name. The fix splits
    // each remote chain into a BUILD half (npm ci/build + unit-file
    // installs, which can fail harmlessly) and a RESTART half
    // (daemon-reload/enable/restart/verify[/curl]), with the stamp
    // sandwiched between them. Pin all three positions — build, stamp,
    // restart — not just "stamp precedes restart": that alone is satisfied
    // by the OLD, buggy ordering too (stamp before EVERYTHING), so it never
    // would have caught this regression.
    const agentBranchStart = deploySh.indexOf('if [ "$TARGET" = "agent" ]');
    const elseAt = deploySh.indexOf('\nelse');

    const agentBuildAt = deploySh.indexOf('"${SSH[@]}" "$BOX" "$AGENT_BUILD_CMD"');
    const agentStamp = deploySh.indexOf('stamp_build', agentBranchStart);
    const agentRestartAt = deploySh.indexOf('"${SSH[@]}" "$BOX" "$AGENT_CMD"');
    expect(agentBuildAt, 'agent branch never runs its build chain').toBeGreaterThan(agentBranchStart);
    expect(agentStamp, 'agent branch never stamps').toBeGreaterThan(agentBranchStart);
    expect(agentRestartAt, 'agent branch never runs its restart chain').toBeGreaterThan(-1);
    expect(agentStamp, 'the stamp must run AFTER the remote build — a build that never ran must never be stamped')
      .toBeGreaterThan(agentBuildAt);
    expect(agentStamp, 'the stamp must run BEFORE the restart that makes it live')
      .toBeLessThan(agentRestartAt);
    expect(agentStamp).toBeLessThan(elseAt);

    const serverBuildAt = deploySh.indexOf('"${SSH[@]}" "$BOX" "$REMOTE_BUILD_CMD"');
    const serverStamp = deploySh.indexOf('stamp_build', elseAt);
    const serverRestartAt = deploySh.indexOf('"${SSH[@]}" "$BOX" "$REMOTE_CMD"');
    expect(serverBuildAt, 'server branch never runs its build chain').toBeGreaterThan(elseAt);
    expect(serverStamp, 'server branch never stamps').toBeGreaterThan(elseAt);
    expect(serverRestartAt, 'server branch never runs its restart chain').toBeGreaterThan(-1);
    expect(serverStamp, 'the stamp must run AFTER the remote build — a build that never ran must never be stamped')
      .toBeGreaterThan(serverBuildAt);
    expect(serverStamp, 'the stamp must run BEFORE the restart that makes it live')
      .toBeLessThan(serverRestartAt);
  });

  it('~/.ccrc/accounts.sh lands BEFORE ccd — every ccd invocation in the gap would die', () => {
    // Stage 2a, Task 10. `ccd` no longer carries the account roster: it
    // SOURCES `~/.ccrc/accounts.sh` and `|| die`s when that file is absent
    // (deliberately — a ccd silently running a roster that is not the box's
    // is what cost one account six sessions of chat). Neither box has the
    // file yet, so the ordering below is not a tidiness preference: ship the
    // new ccd first and every ccd invocation between the two installs dies —
    // including the ones the supervisor sweep at the bottom of this branch
    // makes, which restarts every live claude-session@ supervisor on the box.
    //
    // ANCHORED ON THE `install_atomic` INVOCATIONS THEMSELVES, never on a
    // helper name: the measured trap right next door is that
    // `deploySh.indexOf('stamp_build', agentBranchStart)` resolves to a
    // COMMENT mentioning the helper rather than to the call, so a name-based
    // probe here would happily "prove" an ordering that the shell never runs.
    const agentBranch = deploySh.slice(
      deploySh.indexOf('if [ "$TARGET" = "agent" ]'), deploySh.indexOf('\nelse'));
    const shIdx = agentBranch.indexOf('install_atomic "$ACCOUNTS_SH" .ccrc/accounts.sh 644');
    const ccdIdx = agentBranch.indexOf('install_atomic ccd/ccd .local/bin/ccd 755');
    expect(shIdx, 'deploy.sh never installs ~/.ccrc/accounts.sh').toBeGreaterThan(-1);
    expect(ccdIdx, 'the agent branch no longer installs ccd').toBeGreaterThan(-1);
    expect(shIdx, 'accounts.sh must be installed before ccd').toBeLessThan(ccdIdx);

    // `install_atomic` does NOT create its destination directory, and the
    // only unconditional `mkdir -p ~/.ccrc` on the agent path lives inside
    // `stamp_build` — which runs AFTER ccd. Without an explicit one the very
    // first deploy to a box scp's into a directory that does not exist.
    const mkdirIdx = agentBranch.lastIndexOf("'mkdir -p ~/.ccrc'", shIdx);
    expect(mkdirIdx, 'nothing creates ~/.ccrc before the roster is installed into it')
      .toBeGreaterThan(-1);

    // And the roster is GENERATED, from the roster the box will boot with,
    // before anything is replaced — not read out of a file the repo assumes
    // the box already has.
    const genIdx = agentBranch.indexOf('node deploy/gen-accounts.mjs');
    expect(genIdx, 'the agent branch never generates accounts.sh').toBeGreaterThan(-1);
    expect(genIdx, 'generation must precede the install it produces the file for')
      .toBeLessThan(shIdx);
  });

  it('the server branch refuses a roster-less box BEFORE it touches anything — loadConfig will not boot without one', () => {
    // The server's half of the same task, and it has to be PRE-flight rather
    // than a post-restart health check. `loadConfig` (server/src/config.ts)
    // refuses to boot without `~/.ccrc/accounts.json`, and `ccrc.service` is
    // `Restart=always` with `RestartSec=3` and no StartLimit — so a deploy
    // that discovered the problem after the restart would already have
    // replaced dist/ and stamped build.json, with no rollback, leaving the
    // box mutated and crash-looping every three seconds. Modelled on (and
    // asserted the same way as) the ccrc.env guard above.
    const serverBranch = deploySh.slice(deploySh.indexOf('\nelse'));
    const guardAt = serverBranch.indexOf('[ -f "$ACCOUNTS_JSON" ]');
    expect(guardAt, 'the server branch never checks for a roster at all').toBeGreaterThan(-1);
    expect(serverBranch, 'the guard must fall back to checking the box for an already-provisioned roster')
      .toContain('[ -f ~/.ccrc/accounts.json ]');
    expect(serverBranch, 'a missing roster on both sides must abort the deploy with a clear message')
      .toMatch(/deploy: FAILED[^\n]*accounts\.json/);

    const buildAt = serverBranch.indexOf('(cd pwa && npm ci && npm run build)');
    const rsyncAt = serverBranch.indexOf('rsync -az');
    const backupMkdirAt = serverBranch.indexOf('mkdir -p ~/ccrc-backups/$TS');
    expect(buildAt, 'the PWA build line was not found').toBeGreaterThan(-1);
    expect(guardAt, 'the roster guard must run before the PWA build, not after').toBeLessThan(buildAt);
    expect(guardAt, 'the roster guard must run before rsync --delete touches the box').toBeLessThan(rsyncAt);
    expect(guardAt, 'the roster guard must run before the box is mutated at all')
      .toBeLessThan(backupMkdirAt);

    // BOTH boxes get the roster: in remote fleet mode the server serves the
    // fleet host's account labels and hues out of its OWN local copy.
    for (const [label, branch] of [
      ['agent', deploySh.slice(deploySh.indexOf('if [ "$TARGET" = "agent" ]'), deploySh.indexOf('\nelse'))],
      ['server', serverBranch],
    ] as const) {
      expect(branch, `the ${label} branch never ships ~/.ccrc/accounts.json`).toContain('ship_roster');
    }
    // …create-if-missing, NEVER overwritten: accounts.json is user-owned
    // config (design §5), so an operator's edit on the box has to survive
    // every later deploy. The seeding scp must therefore sit behind a
    // negated existence test rather than firing unconditionally.
    const fn = /ship_roster\(\) \{([\s\S]*?)\n\}/.exec(deploySh);
    expect(fn, 'deploy.sh has no ship_roster() helper').toBeTruthy();
    const body = fn![1]!;
    expect(body, 'the roster seed must be guarded by a not-already-present test')
      .toContain("if ! \"${SSH[@]}\" \"$BOX\" '[ -f ~/.ccrc/accounts.json ]'");
    const testAt = body.indexOf('[ -f ~/.ccrc/accounts.json ]');
    const scpAt = body.indexOf('"${SCP[@]}"');
    expect(scpAt, 'ship_roster never copies anything').toBeGreaterThan(-1);
    expect(scpAt, 'the seed copy must run only after the not-present test, never unconditionally')
      .toBeGreaterThan(testAt);
  });

  it('the deploy proves the box now RUNS what it shipped — sha equality, not just 200 OK', () => {
    // The 2026-08-10 failure class, closed at the mechanism level: a green
    // deploy that proves only "something answers" lets a stale binary hide
    // behind an {ok:true}. The server branch greps /health for the exact sha
    // it stamped; the agent branch asks the box's own ccd. Both AFTER their
    // chains, so they interrogate the restarted services.
    const serverBranch = deploySh.slice(deploySh.indexOf('\nelse'));
    // NB the deploy.sh line escapes its quotes for the shell — \"sha\":\"$BUILD_SHA\" —
    // so the needle here carries the backslashes too.
    const healthAssertAt = serverBranch.indexOf('\\"sha\\":\\"$BUILD_SHA\\"');
    expect(healthAssertAt, 'the server branch never checks /health against the shipped sha')
      .toBeGreaterThan(-1);
    expect(healthAssertAt).toBeGreaterThan(serverBranch.indexOf('"$REMOTE_CMD"'));

    const agentBranch = deploySh.slice(
      deploySh.indexOf('if [ "$TARGET" = "agent" ]'), deploySh.indexOf('\nelse'));
    const ccdAssertAt = agentBranch.indexOf('ccd version');
    expect(ccdAssertAt, 'the agent branch never checks ccd version against the shipped sha')
      .toBeGreaterThan(-1);
    expect(ccdAssertAt).toBeGreaterThan(agentBranch.indexOf('"$AGENT_CMD"'));
    expect(agentBranch.indexOf('grep -qF "$BUILD_SHA"', ccdAssertAt),
      'the ccd version output is not compared to the shipped sha')
      .toBeGreaterThan(-1);
  });

  it('the server branch refuses to deploy without a real ccrc.env on either end — I2', () => {
    // `ship_env` no-ops when deploy/ccrc.env is absent, and the unit's `-`
    // prefixed EnvironmentFile= tolerates a missing file too — so nothing
    // stopped a deploy with NEITHER from landing a unit config.ts binds to
    // 127.0.0.1 by default. The live tailscale serve proxies to the tailnet
    // IP LITERALLY, so a loopback bind takes the PWA dark on every device,
    // and verify-service.sh still passes (the process IS up) — only the
    // health curl at the very end would catch it, after the unit is already
    // replaced and restarted (I2, final review).
    const serverBranch = deploySh.slice(deploySh.indexOf('\nelse'));
    const guardAt = serverBranch.indexOf('[ ! -f deploy/ccrc.env ]');
    expect(guardAt, 'the server branch never checks for a local deploy/ccrc.env').toBeGreaterThan(-1);
    expect(serverBranch, 'the guard must fall back to checking the box for an already-provisioned ccrc.env')
      .toContain('~/.ccrc/ccrc.env');
    expect(serverBranch, 'a missing config on both sides must abort the deploy with a clear message')
      .toMatch(/deploy: FAILED[^\n]*ccrc\.env/);
    // Before touching anything: ahead of the PWA build and every mutation below.
    const buildAt = serverBranch.indexOf('(cd pwa && npm ci && npm run build)');
    const rsyncAt = serverBranch.indexOf('rsync -az');
    const backupMkdirAt = serverBranch.indexOf('mkdir -p ~/ccrc-backups/$TS');
    expect(buildAt, 'the PWA build line was not found').toBeGreaterThan(-1);
    expect(guardAt, 'the guard must run before the PWA build, not after').toBeLessThan(buildAt);
    expect(guardAt, 'the guard must run before rsync --delete touches the box').toBeLessThan(rsyncAt);
    expect(guardAt, 'the guard must run before the box is touched at all')
      .toBeLessThan(backupMkdirAt);
  });

  it('every unit file a deploy overwrites is backed up first, absent-source-skippable — I2', () => {
    // dist-pwa and coord.db were backed up already; the *.service files
    // AGENT_CMD/REMOTE_CMD `cp` straight over ~/.config/systemd/user/ never
    // were, so a bad unit (a broken EnvironmentFile= line, or anything else)
    // had no on-box restore path (I2, final review).
    const agentBranch = deploySh.slice(
      deploySh.indexOf('if [ "$TARGET" = "agent" ]'), deploySh.indexOf('\nelse'));
    const serverBranch = deploySh.slice(deploySh.indexOf('\nelse'));
    for (const [branch, label, unit] of [
      [agentBranch, 'agent', '~/.config/systemd/user/ccrc-agent.service'],
      [agentBranch, 'agent', '~/.config/systemd/user/claude-session@.service'],
      [serverBranch, 'server', '~/.config/systemd/user/ccrc.service'],
    ] as const) {
      const guardIdx = branch.indexOf(`[ ! -f ${unit} ]`);
      expect(guardIdx, `${label} branch never backs up ${unit} (absent-source-skippable guard missing)`)
        .toBeGreaterThan(-1);
      expect(branch.indexOf('cp -a', guardIdx), `${label} branch's ${unit} backup does not cp -a`)
        .toBeGreaterThan(guardIdx);
    }
  });

  it("HEALTH_URL is derived from the resolved \$BOX, not a hardcoded literal — I4", () => {
    // A `CCRC_BOX` override must also move HEALTH_URL, or a same-sha
    // re-deploy/rollback to a DIFFERENT box would pass the sha-assertion
    // WITHOUT EVER CONTACTING THE TARGET (final review). Extract the actual
    // variable-resolution header (BOX -> TARGET/agent-host override ->
    // HEALTH_URL) and EXECUTE it for real — this proves the runtime
    // expansion, not merely that some substring exists in the file.
    const start = deploySh.indexOf('BOX="${CCRC_BOX:-');
    const healthLine = /HEALTH_URL="\$\{CCRC_HEALTH_URL:-[^\n]*\n/.exec(deploySh);
    expect(start, 'BOX default assignment not found').toBeGreaterThan(-1);
    expect(healthLine, 'HEALTH_URL default assignment not found').toBeTruthy();
    const targetOverrideAt = deploySh.indexOf('[ "$TARGET" = "agent" ]');
    expect(healthLine!.index!,
      'HEALTH_URL must be resolved AFTER the agent-target BOX override, not before')
      .toBeGreaterThan(targetOverrideAt);
    const header = deploySh.slice(start, healthLine!.index! + healthLine![0].length);

    const run = (args: string[], env: Record<string, string> = {}): string => {
      const r = spawnSync('bash', ['-c', `${header}\nprintf '%s' "$HEALTH_URL"`, '_', ...args], {
        encoding: 'utf8',
        env: { ...process.env, CCRC_BOX: '', CCRC_HEALTH_URL: '', ...env },
      });
      expect(r.status, `header exited nonzero: ${r.stderr}`).toBe(0);
      return r.stdout;
    };

    expect(run([]), 'the no-override default must still hit the known server box')
      .toBe('http://203.0.113.7:7788/health');
    expect(run([], { CCRC_BOX: 'user@10.0.0.9' }),
      'CCRC_BOX must move HEALTH_URL, not leave it pointed at the old box')
      .toBe('http://10.0.0.9:7788/health');
    expect(run(['agent', 'user@10.0.0.5']),
      "the agent target's host argument must also drive HEALTH_URL")
      .toBe('http://10.0.0.5:7788/health');
    expect(run([], { CCRC_HEALTH_URL: 'http://example:9999/health' }),
      'CCRC_HEALTH_URL must still override everything')
      .toBe('http://example:9999/health');
  });

  it('the sha assertions capture-then-test — no pipe into grep -q, which races SIGPIPE under pipefail — I7', () => {
    // `producer | grep -qF pattern` under `set -o pipefail`: if grep -q finds
    // its match and exits before the producer finishes writing, the producer
    // can be killed by SIGPIPE, and ITS nonzero exit becomes the pipeline's
    // reported status — a FAILURE after grep already matched. Measured on
    // this exact shape (deploy.sh's own comment cites 553/1500 false
    // failures at 50 output lines). The fix captures into a variable first,
    // then tests the capture — no pipe left for grep to race.
    expect(deploySh, 'a tee/grep pipe into the sha assertion is back — capture-then-test was removed')
      .not.toMatch(/\|\s*tee\s+\/dev\/stderr\s*\|\s*grep/);
    expect(deploySh, 'a bare curl | grep -qF pipe is back on the health assertion')
      .not.toMatch(/curl -fsS "\$HEALTH_URL" \|\s*grep/);

    const agentBranch = deploySh.slice(
      deploySh.indexOf('if [ "$TARGET" = "agent" ]'), deploySh.indexOf('\nelse'));
    expect(agentBranch, 'ccd version must be captured into a variable before testing it')
      .toContain('ccd_version_out="$("${SSH[@]}" "$BOX" \'~/.local/bin/ccd version\')"');
    expect(agentBranch, 'the capture must be tested via printf | grep -qF, not re-piped from ssh')
      .toContain('printf \'%s\' "$ccd_version_out" | grep -qF "$BUILD_SHA"');

    const serverBranch = deploySh.slice(deploySh.indexOf('\nelse'));
    expect(serverBranch, 'the health response must be captured into a variable before testing it')
      .toContain('health_out="$(curl -fsS "$HEALTH_URL")"');
    expect(serverBranch, 'the capture must be tested via printf | grep -qF, not re-piped from curl')
      .toContain('printf \'%s\' "$health_out" | grep -qF "\\"sha\\":\\"$BUILD_SHA\\""');
  });
});

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
import { chmodSync, readFileSync, writeFileSync } from 'node:fs';
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

  it('the observation window is longer than EITHER unit\'s RestartSec, or it cannot see a loop', () => {
    // A cross-file invariant, because the two numbers live in different files
    // and only one of them looks like it matters. If RestartSec were raised to
    // 10 on either unit and the window left at 5, every crash loop on that
    // unit would pass with a stable PID and this whole gate would go quietly
    // decorative. One verify-service.sh and one WINDOW default now guard BOTH
    // units, so the invariant has to hold against both RestartSec values, not
    // just the agent's — a `ccrc.service` RestartSec raised on its own, with
    // nothing agent-side to trip, used to pass this suite.
    const verifySrc = readFileSync(VERIFY, 'utf8');
    const window = Number(/CCRC_VERIFY_WINDOW:-(\d+)/.exec(verifySrc)?.[1]);
    expect(Number.isFinite(window), 'CCRC_VERIFY_WINDOW default not found').toBe(true);

    for (const unitFile of ['ccrc-agent.service', 'ccrc.service']) {
      const unitSrc = readFileSync(path.join(deployDir, unitFile), 'utf8');
      const restartSec = Number(/^RestartSec=(\d+)/m.exec(unitSrc)?.[1]);
      expect(Number.isFinite(restartSec), `RestartSec not found in ${unitFile}`).toBe(true);
      expect(window, `observation window ${window}s must exceed ${unitFile}'s RestartSec ${restartSec}s`)
        .toBeGreaterThan(restartSec);
    }
  });
});

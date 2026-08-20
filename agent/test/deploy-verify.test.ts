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
import { chmodSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { bodyDigest, markGenerated } from '../../shared/mark.mjs';
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

/** A unit file's named section, anchored on a section header at the START OF A
 *  LINE — never `indexOf('[Service]')`. `claude-session@.service`'s [Unit]
 *  block carries a comment that spells `[Service]` and `[Unit]` in prose
 *  (explaining why the two StartLimit keys live where they do), so an
 *  unanchored search cuts the section inside that comment: measured, the
 *  [Unit] slice ended before `StartLimitIntervalSec=` and the [Service] slice
 *  began in the middle of a sentence — one assertion red for the wrong reason,
 *  its neighbour green for the wrong reason. */
const unitSection = (unit: string, name: string): string => {
  const at = new RegExp(`^\\[${name}\\]$`, 'm').exec(unit);
  if (!at) return '';
  const rest = unit.slice(at.index + at[0].length);
  const next = /^\[[A-Za-z]+\]$/m.exec(rest);
  return next ? rest.slice(0, next.index) : rest;
};

/** Plants `~/.config/systemd/user/claude-session@.service` in a fixture HOME,
 *  with or without the one line the sweep's pre-flight refuses without — and
 *  the DROP-IN beside it, because that is the half a base-file grep cannot
 *  see. `deploy.sh` copies `claude-session@.service.d/limits.conf` in the same
 *  run that sweeps, and it already carries a `[Service]` section, so one
 *  `KillMode=` line added there overrides the base unit on the live box while
 *  leaving the base unit's own line untouched. `dropInKillMode` plants exactly
 *  that. */
const plantUnit = (home: string, killModeProcess: boolean, dropInKillMode?: string): void => {
  const dir = path.join(home, '.config', 'systemd', 'user');
  mkdirSync(dir, { recursive: true });
  writeFileSync(path.join(dir, 'claude-session@.service'),
    '[Unit]\nStartLimitIntervalSec=120\nStartLimitBurst=5\n\n[Service]\n'
    + 'ExecStart=%h/.local/bin/ccd supervise %i\n'
    + (killModeProcess ? 'KillMode=process\n' : '')
    + '\n[Install]\nWantedBy=default.target\n');
  const dropInDir = path.join(dir, 'claude-session@.service.d');
  mkdirSync(dropInDir, { recursive: true });
  writeFileSync(path.join(dropInDir, 'limits.conf'),
    '[Service]\nMemoryMax=10G\nTasksMax=4096\n'
    + (dropInKillMode === undefined ? '' : `KillMode=${dropInKillMode}\n`));
};

/** A PER-INSTANCE drop-in: `claude-session@<instance>.service.d/override.conf`.
 *  systemd merges these ON TOP of the template's own `claude-session@.service.d/`,
 *  so `KillMode` is a property of EACH unit and not of the template — which is
 *  the whole reason the pre-flight loops over units at all instead of asking
 *  about the template once. Nothing in this repo writes one; a human at the box
 *  can, and `systemctl edit claude-session@foo` is exactly how. */
const plantInstanceDropIn = (home: string, instance: string, killMode: string): void => {
  const dir = path.join(home, '.config', 'systemd', 'user', `claude-session@${instance}.service.d`);
  mkdirSync(dir, { recursive: true });
  writeFileSync(path.join(dir, 'override.conf'), `[Service]\nKillMode=${killMode}\n`);
};

/** The `show -p KillMode` branch every stub `systemctl` in this file answers
 *  with. It stands in for SYSTEMD, so it resolves the property the way systemd
 *  documents: the base unit first, then the TEMPLATE's `claude-session@.service.d/*.conf`,
 *  then THIS INSTANCE's own `claude-session@<i>.service.d/*.conf`, each in
 *  lexical order, last assignment wins, and a unit it cannot load reports
 *  systemd's own default — `control-group`. Modelling the merge is the point: a
 *  stub that echoed the base file back could not tell a pre-flight that asks
 *  systemd for the EFFECTIVE value from one that greps the base unit, which is
 *  the distinction these tests exist to hold. The per-instance leg is the second
 *  half of that: a stub that resolved only the template would answer identically
 *  for every unit, so a pre-flight that asked about ONE unit and a pre-flight
 *  that asked about all of them would be indistinguishable here.
 *
 *  The unit id is the LAST argument, the way `systemctl show -p KillMode <unit>`
 *  is spelled — read off `"$@"` rather than sliced out of `"$*"`, so a stub
 *  invoked with different leading flags keeps working. */
const SHOW_KILLMODE = [
  'case "$*" in',
  '  *"show -p KillMode"*)',
  '    d="$HOME/.config/systemd/user"; v=control-group; u="";',
  '    for a in "$@"; do u="$a"; done;',
  '    for f in "$d/claude-session@.service" "$d/claude-session@.service.d/"*.conf "$d/$u.d/"*.conf; do',
  '      [ -f "$f" ] || continue;',
  '      while IFS= read -r l; do case "$l" in KillMode=*) v="${l#KillMode=}" ;; esac; done < "$f";',
  '    done;',
  '    echo "KillMode=$v"; exit 0 ;;',
  'esac',
  '',
].join('\n');

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

  it('a session that dies instantly becomes a FAILED unit — and the keys sit in [Unit], where systemd reads them', () => {
    // Spec §3.3. The section is not cosmetic, and the spec's own sentence ("the
    // unit's [Service] gains…") is wrong for the systemd this fleet runs.
    // Measured on systemd 255 with `systemd-analyze verify`:
    //   StartLimitIntervalSec= in [Service] -> "Unknown key name
    //     'StartLimitIntervalSec' in section 'Service', ignoring."
    //   StartLimitBurst=       in [Service] -> silently accepted (legacy compat)
    // Split across the two sections, the burst would be honored against
    // systemd's DEFAULT 10s interval: a rate limit nobody chose, arrived at
    // without a word. Both keys live in [Unit].
    const unit = readFileSync(path.join(deployDir, '..', 'ccd', 'claude-session@.service'), 'utf8');
    // BOTH sections come from `unitSection` (above), which anchors on a section
    // header at the START OF A LINE. This test used to carry its own pair — a
    // `/\[Unit\]([\s\S]*?)(?=\n\[)/` for one section and a
    // `.search(/^\[Service\]/m)` + `slice` for the other — two spellings of one
    // idea in one file, each with its own way of being subtly wrong. The helper
    // also STOPS at the next header, so the [Service] region no longer runs to
    // EOF and drags [Install] in with it.
    const unitBlock = unitSection(unit, 'Unit');
    expect(unitBlock).toMatch(/^StartLimitIntervalSec=\d+$/m);
    expect(unitBlock).toMatch(/^StartLimitBurst=\d+$/m);
    // Anchoring matters here specifically: the [Unit] section's own comment
    // explains the split by naming "[Service]" in prose ("belong to [Unit], not
    // [Service]"), and that mention precedes the real header — an
    // `indexOf('[Service]')` would find the comment instead and slice the
    // StartLimit lines themselves into the region under test.
    const serviceBlock = unitSection(unit, 'Service');
    // `unitSection` returns '' for a section that is not there, and
    // `/^StartLimit/m.test('')` is false — so the assertion below would pass
    // VACUOUSLY on a unit with no [Service] section at all, the same trap the
    // old `.search()`-returns-`-1` + `.slice(-1)` shape had. Guard it
    // explicitly; emptiness is not evidence.
    expect(serviceBlock, 'no [Service] section found in the unit file').not.toBe('');
    expect(/^StartLimit/m.test(serviceBlock),
      'a StartLimit key sits in [Service], where systemd 255 ignores it').toBe(false);
    // And the limit must be reachable at THIS unit's restart cadence or it is
    // decoration: RestartSec=3 means a crash loop spends ~3s per attempt, so
    // the whole burst has to fit inside the interval.
    const burst = Number(/^StartLimitBurst=(\d+)$/m.exec(unitBlock)![1]);
    const interval = Number(/^StartLimitIntervalSec=(\d+)$/m.exec(unitBlock)![1]);
    const restartSec = Number(/^RestartSec=(\d+)$/m.exec(unit)![1]);
    expect(burst * restartSec, 'the burst cannot be spent inside the interval — the unit never fails')
      .toBeLessThan(interval);
  });

  it('the supervisor sweep survives a FAILED session unit — the state the start limit made reachable', () => {
    // FINAL REVIEW, finding 6. The start limit above is what made `failed`
    // reachable at all (before it, every unit ran systemd's default 10s window
    // against RestartSec=3, so the burst could never be spent and a
    // crash-looping session looped invisibly for ever). `systemctl list-units`
    // INCLUDES failed units, and `try-restart` is a no-op on one — so the
    // unfiltered sweep handed verify-service.sh a unit that was never restarted
    // and could not be active. Reproduced with exactly the stubs below:
    // `DEPLOY FAILED — claude-session@boom.service did not come up clean after
    // restart`, exit 1, and `set -e` aborting the agent target AFTER ccd, the
    // units, the hooks and the agent are installed but BEFORE the `ccd version`
    // sha check — every subsequent deploy failing identically until somebody
    // cleared the unit by hand.
    //
    // The SWEEP_CMD is extracted from deploy.sh and RUN, not read: a structural
    // assertion about `--state=` would pass on a filter applied to the wrong
    // loop, which is precisely the mistake being fixed.
    const sweep = /SWEEP_CMD='([\s\S]*?)'\n/.exec(deploySh);
    expect(sweep, 'the supervisor sweep is no longer a single quoted block').toBeTruthy();

    const home = mkTmp('ccrc-agent-deploysweep-');
    const bin = path.join(home, 'stubbin');
    mkdirSync(path.join(home, 'ccrc', 'deploy'), { recursive: true });
    mkdirSync(bin, { recursive: true });
    // The unit file this run just copied — the sweep now pre-flights it for
    // KillMode=process and refuses without it, so a box modelled here without
    // one is not "a box", it is the abort case (pinned as its own test below).
    plantUnit(home, true);
    // A box with one healthy session and one failed one. The stub answers the
    // `--state=` filters the way systemd does, AND answers an unfiltered
    // `list-units` with both — so a sweep that drops the filter sees the failed
    // unit again and this test goes red.
    writeFileSync(path.join(bin, 'systemctl'),
      '#!/bin/sh\necho "systemctl $*" >> "$HOME/calls"\n'
      + SHOW_KILLMODE
      + 'case "$*" in\n'
      + '  *list-units*)\n'
      + '    case "$*" in\n'
      + '      *--state=failed*) echo "claude-session@boom.service loaded failed failed x" ;;\n'
      + '      *--state=active*) echo "claude-session@good.service loaded active running x" ;;\n'
      + '      *) echo "claude-session@good.service loaded active running x"\n'
      + '         echo "claude-session@boom.service loaded failed failed x" ;;\n'
      + '    esac ;;\n'
      + 'esac\nexit 0\n', { mode: 0o755 });
    // Stands in for verify-service.sh, failing for anything not active exactly
    // as the real script's first `is-active` check does.
    writeFileSync(path.join(home, 'ccrc', 'deploy', 'verify-service.sh'),
      '#!/bin/sh\necho "verify $1" >> "$HOME/calls"\n'
      + 'case "$1" in *boom*) echo "## DEPLOY FAILED — $1" >&2; exit 1 ;; esac\n'
      + 'echo "verified: $1"\n', { mode: 0o755 });

    const r = spawnSync('bash', ['-c', sweep![1]!], {
      encoding: 'utf8',
      env: { ...process.env, HOME: home, PATH: `${bin}${path.delimiter}${process.env.PATH ?? ''}` },
    });
    expect(r.status, 'a pre-existing failed session unit still aborts the deploy').toBe(0);
    const calls = readFileSync(path.join(home, 'calls'), 'utf8');
    expect(calls, 'verify-service.sh was handed a unit that was never restarted')
      .not.toContain('verify claude-session@boom.service');
    expect(calls, 'the healthy supervisor stopped being verified — the sweep is now decorative')
      .toContain('verify claude-session@good.service');
    // Named, with the remedy: a failed session is not this deploy's doing and
    // must not fail it, but silence would leave a dead session on the box with
    // nothing anywhere saying so.
    expect(r.stderr).toContain('claude-session@boom.service is FAILED');
    expect(r.stderr).toContain('reset-failed');
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
    // `.local/bin/ccrc` joins the set in stage 2b's Task 8. It is a two-line
    // launcher, not a script anyone edits, but it lands ON PATH next to `ccd`
    // and is exec'd by an operator at a terminal — the same in-place-overwrite
    // hazard, and the same one-line fix.
    for (const dest of [
      '.local/bin/ccd', '.cc-sessions/notify.sh',
      '.cc-sessions/session-hook.sh', '.cc-sessions/install-session-hooks.sh',
      '.ccrc/accounts.sh', '.local/bin/ccrc',
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
      'install_atomic "$shim" .local/bin/ccrc 755',
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

  it('the unit carries KillMode=process, in [Service] — without it the sweep is a fleet kill', () => {
    // THE CONSEQUENCE, named in the message because that is the whole value of
    // this assertion: the deploy sweeps `try-restart "claude-session@*"` across
    // every live supervisor, and systemd's DEFAULT KillMode is control-group.
    // All 21 live sessions are children of ONE tmux server that sits inside a
    // claude-session@ cgroup, so deleting this one line turns a routine deploy
    // into a fleet kill. Until now `grep -rn KillMode` over this repo returned
    // the unit file and two COMMENTS — a request, not a mechanism.
    const unit = readFileSync(path.join(deployDir, '..', 'ccd', 'claude-session@.service'), 'utf8');
    const service = unitSection(unit, 'Service');
    expect(service,
      'claude-session@.service lost KillMode=process — the deploy sweep would kill the tmux '
      + 'server and every session under it')
      .toMatch(/^KillMode=process$/m);
  });

  // The two [Unit] start-limit keys are NOT pinned a second time here. `a
  // session that dies instantly becomes a FAILED unit — and the keys sit in
  // [Unit], where systemd reads them` (above, in this file) already asserts
  // both sections, in both directions, plus burst*RestartSec < interval — and
  // its own comment already records the `indexOf('[Service]')` trap. A copy
  // here would be a second definition of the same rule, which is the thing this
  // repo fails builds over.

  it('the sweep REFUSES before try-restart when the unit about to be active lacks KillMode=process', () => {
    // The layer that matters more, because the sweep is the trigger: deploy.sh
    // copies the unit file and daemon-reloads in the SAME run that sweeps, so a
    // bad edit goes live and is exercised against 18 units with no window to
    // notice. Same ordering principle the sweep's own placement already
    // encodes ("after the agent chain, so a broken agent fails the deploy
    // before any supervisor is touched") — one step earlier.
    const sweep = /SWEEP_CMD='([\s\S]*?)'\n/.exec(deploySh);
    expect(sweep, 'SWEEP_CMD is no longer a single-quoted assignment').not.toBeNull();
    const body = sweep![1]!;
    const guardAt = body.indexOf('KillMode=process');
    const restartAt = body.indexOf('try-restart "claude-session@*"');
    expect(guardAt, 'the sweep does not check KillMode at all').toBeGreaterThan(-1);
    expect(guardAt, 'the KillMode guard must precede try-restart, not follow it')
      .toBeLessThan(restartAt);
    // And it must ABORT, not warn: deploy.sh runs under `set -e`, so a
    // non-zero here stops the run before any supervisor is touched.
    expect(body.slice(Math.max(0, guardAt - 200), restartAt)).toMatch(/exit 1/);
    // It also names WHICH unit currently hosts the tmux server, so the operator
    // reading the abort can see the blast radius rather than infer it. DOUBLE
    // quotes around the pgrep pattern, necessarily: SWEEP_CMD is a
    // single-quoted assignment and bash has no escape for a single quote inside
    // one, so a `'tmux: server'` here would terminate the assignment early —
    // and this very regex would then capture a truncated body.
    //
    // `-x` ALONE. This assertion used to read `pgrep -x -f`, and pinned a probe
    // that always returned empty: `-f` matches the full command line
    // (`tmux start-server`) while `-x` demands an exact match, so together they
    // ask for something nothing has. `-x` alone matches `comm`, which is
    // `tmux: server`. The test below measures that difference rather than
    // trusting this string, because a string assertion is exactly what let the
    // broken form ship.
    expect(body).toContain('/proc/$(pgrep -x "tmux: server")/cgroup');
    expect(body, 'the `-x -f` pairing returns empty — see the pgrep semantics test below')
      .not.toContain('pgrep -x -f');
  });

  it('and the probe it uses actually resolves a process — `-x` matches comm, `-x -f` matches nothing', () => {
    // THE MEASUREMENT THE ASSERTION ABOVE CANNOT MAKE. Pinning command text
    // proves the text; it does not prove the command answers. That gap is how
    // `-x -f` shipped and survived a review — the print is non-fatal, so an
    // empty answer is indistinguishable from a box with no tmux server, which
    // is the one case the line was written to tolerate.
    //
    // Demonstrated on `sleep`, whose comm is `sleep` and whose command line is
    // `sleep 47` — the same shape as the tmux server's `tmux: server` /
    // `tmux start-server`. No tmux server is needed, so this runs anywhere.
    const out = spawnSync('bash', ['-c',
      'sleep 47 & p=$!;'
      + ' comm=$(pgrep -x sleep | grep -c "^$p$" || true);'
      + ' full=$(pgrep -x -f sleep | grep -c "^$p$" || true);'
      + ' kill $p 2>/dev/null;'
      + ' echo "comm=$comm full=$full"'], { encoding: 'utf8' }).stdout.trim();
    expect(out, '`pgrep -x <comm>` must find a running process by its comm').toContain('comm=1');
    expect(out, '`pgrep -x -f <comm>` finds nothing, because -f compares the full command line')
      .toContain('full=0');
  });

  it('and RUNNING the sweep against a KillMode-less unit aborts it before one try-restart', () => {
    // The structural case above would pass on a guard that checks the right
    // text in the wrong place or never runs; this one EXECUTES SWEEP_CMD with
    // the same stubs the FAILED-unit case uses, against a box whose unit
    // resolves to something other than KillMode=process. Zero try-restarts is
    // the assertion that matters — the whole point is that no supervisor is
    // touched. (It used to assert zero systemctl calls of ANY kind. It cannot:
    // the pre-flight now ASKS systemd for the effective value, which is itself
    // a systemctl call — a read, and the reason the guard sees drop-ins at all.
    // `try-restart` is the mutation, and the mutation is what must not happen.)
    const home = mkTmp('ccrc-agent-sweepguard-');
    const bin = path.join(home, 'stubbin');
    mkdirSync(path.join(home, 'ccrc', 'deploy'), { recursive: true });
    mkdirSync(bin, { recursive: true });
    plantUnit(home, false);
    writeFileSync(path.join(bin, 'systemctl'),
      '#!/bin/sh\necho "systemctl $*" >> "$HOME/calls"\n' + SHOW_KILLMODE + 'exit 0\n',
      { mode: 0o755 });

    const body = /SWEEP_CMD='([\s\S]*?)'\n/.exec(deploySh)![1]!;
    const r = spawnSync('bash', ['-c', body], {
      encoding: 'utf8',
      env: { ...process.env, HOME: home, PATH: `${bin}${path.delimiter}${process.env.PATH ?? ''}` },
    });
    expect(r.status, 'the sweep ran against a unit without KillMode=process').toBe(1);
    expect(r.stderr).toContain('REFUSING to sweep');
    expect(readFileSync(path.join(home, 'calls'), 'utf8'),
      'the sweep restarted a supervisor despite the refusal').not.toContain('try-restart');

    // …and the same box with the line restored sweeps normally, so the guard is
    // a gate and not a wall.
    plantUnit(home, true);
    const ok = spawnSync('bash', ['-c', body], {
      encoding: 'utf8',
      env: { ...process.env, HOME: home, PATH: `${bin}${path.delimiter}${process.env.PATH ?? ''}` },
    });
    expect(ok.status).toBe(0);
    // The stub echoes `$*` unquoted, so the recorded line has no quotes.
    expect(readFileSync(path.join(home, 'calls'), 'utf8')).toContain('try-restart claude-session@*');
  });

  it('a DROP-IN that overrides KillMode refuses too — the pre-flight reads the EFFECTIVE value', () => {
    // THE CASE A BASE-FILE GREP CANNOT SEE, and it is not hypothetical: this
    // same deploy copies `claude-session@.service.d/limits.conf` into place a
    // few lines above the sweep, and that file already has a `[Service]`
    // section. systemd merges drop-ins ON TOP of the base unit, so one
    // `KillMode=control-group` line added to limits.conf leaves
    // `ccd/claude-session@.service` reading `KillMode=process` — the base unit
    // the old pre-flight grepped — while the units about to be restarted all
    // resolve to control-group. The sweep would have passed its own guard and
    // killed the tmux server anyway.
    //
    // The fixture models the merge, not the file: the stub `systemctl` answers
    // `show -p KillMode` with base-then-drop-ins, last-wins (see SHOW_KILLMODE),
    // which is what systemd does and what the live box would report.
    const home = mkTmp('ccrc-agent-sweepdropin-');
    const bin = path.join(home, 'stubbin');
    mkdirSync(path.join(home, 'ccrc', 'deploy'), { recursive: true });
    mkdirSync(bin, { recursive: true });
    plantUnit(home, true, 'control-group');
    writeFileSync(path.join(bin, 'systemctl'),
      '#!/bin/sh\necho "systemctl $*" >> "$HOME/calls"\n' + SHOW_KILLMODE
      + 'case "$*" in *list-units*) echo "claude-session@good.service loaded active running x" ;; esac\n'
      + 'exit 0\n', { mode: 0o755 });
    // A verify stub that SUCCEEDS, deliberately: without the fix the sweep runs
    // to completion and exits 0, so the failure this test reports is the
    // missing refusal and nothing else. (Measured against the base-file grep:
    // status 0, no "REFUSING", `try-restart claude-session@*` in the call log.)
    writeFileSync(path.join(home, 'ccrc', 'deploy', 'verify-service.sh'),
      '#!/bin/sh\necho "verify $1" >> "$HOME/calls"\necho "verified: $1"\n', { mode: 0o755 });

    const body = /SWEEP_CMD='([\s\S]*?)'\n/.exec(deploySh)![1]!;
    const r = spawnSync('bash', ['-c', body], {
      encoding: 'utf8',
      env: { ...process.env, HOME: home, PATH: `${bin}${path.delimiter}${process.env.PATH ?? ''}` },
    });
    expect(r.status, 'a drop-in overriding KillMode swept anyway').toBe(1);
    expect(r.stderr).toContain('REFUSING to sweep');
    const calls = readFileSync(path.join(home, 'calls'), 'utf8');
    expect(calls, 'the sweep restarted a supervisor despite the override').not.toContain('try-restart');
    expect(calls, 'the pre-flight never asked systemd for the effective KillMode')
      .toContain('show -p KillMode');

    // And the same box with the override removed sweeps normally — the guard
    // reads the merged value in BOTH directions, so a correct drop-in is not a
    // deploy-stopper.
    plantUnit(home, true);
    const ok = spawnSync('bash', ['-c', body], {
      encoding: 'utf8',
      env: { ...process.env, HOME: home, PATH: `${bin}${path.delimiter}${process.env.PATH ?? ''}` },
    });
    expect(ok.status).toBe(0);
    expect(readFileSync(path.join(home, 'calls'), 'utf8')).toContain('try-restart claude-session@*');
  });

  /** A box the sweep can run against: the unit file this deploy just copied, a
   *  stub `systemctl` that answers `show -p KillMode` like systemd and lists
   *  `units` for every `list-units` (filtered or not, unless `activeUnits` says
   *  otherwise), and a verify stub that always succeeds. Returns the call log
   *  reader, so an assertion can name what did and did not happen. */
  const sweepBox = (prefix: string, opts: {
    /** what `list-units` answers with NO `--state=` filter, and by default what
     *  `--state=active` answers too */
    units: string[];
    /** override for `--state=active` only — `[]` models a unit that is
     *  `activating` (or `deactivating`) at sweep time and therefore absent from
     *  the `active` listing while still being a unit `try-restart` acts on */
    activeUnits?: string[];
  }): { home: string; calls: () => string } => {
    const home = mkTmp(prefix);
    const bin = path.join(home, 'stubbin');
    mkdirSync(path.join(home, 'ccrc', 'deploy'), { recursive: true });
    mkdirSync(bin, { recursive: true });
    plantUnit(home, true);
    const line = (u: string): string => `echo "${u} loaded active running x";`;
    writeFileSync(path.join(bin, 'systemctl'),
      '#!/bin/sh\necho "systemctl $*" >> "$HOME/calls"\n'
      + SHOW_KILLMODE
      + 'case "$*" in\n'
      + '  *list-units*)\n'
      + '    case "$*" in\n'
      + `      *--state=active*) ${(opts.activeUnits ?? opts.units).map(line).join(' ')} ;;\n`
      + '      *--state=failed*) ;;\n'
      + `      *) ${opts.units.map(line).join(' ')} ;;\n`
      + '    esac ;;\n'
      + 'esac\nexit 0\n', { mode: 0o755 });
    writeFileSync(path.join(home, 'ccrc', 'deploy', 'verify-service.sh'),
      '#!/bin/sh\necho "verify $1" >> "$HOME/calls"\necho "verified: $1"\n', { mode: 0o755 });
    return { home, calls: () => readFileSync(path.join(home, 'calls'), 'utf8') };
  };

  const runSweep = (home: string): ReturnType<typeof spawnSync> => spawnSync('bash',
    ['-c', /SWEEP_CMD='([\s\S]*?)'\n/.exec(deploySh)![1]!], {
      encoding: 'utf8',
      env: {
        ...process.env, HOME: home,
        PATH: `${path.join(home, 'stubbin')}${path.delimiter}${process.env.PATH ?? ''}`,
      },
    });

  it('the pre-flight checks EVERY unit, not just the template — a per-instance drop-in refuses', () => {
    // The half of the pre-flight loop that iterates units was decorated, not
    // pinned: every existing case above puts the bad KillMode on the TEMPLATE
    // (base unit or `claude-session@.service.d/`), where the trailing
    // `claude-session@ccrc-deploy-preflight.service` probe sees it on its own.
    // Measured 2026-08-17 by replacing the loop's list with that probe alone —
    // 34/34 still green, so the iteration could be deleted without a red suite.
    //
    // A PER-INSTANCE drop-in is the case only the iteration can catch: systemd
    // merges `claude-session@<i>.service.d/*.conf` on top of the template, so
    // ONE unit out of eighteen can resolve to control-group while the template
    // and the probe both resolve to process. `systemctl edit claude-session@foo`
    // writes exactly that file, and killing that one unit's cgroup is enough —
    // the tmux server every session on the box is a child of lives in whichever
    // claude-session@ cgroup happened to create it.
    const box = sweepBox('ccrc-agent-sweepinstance-',
      { units: ['claude-session@good.service', 'claude-session@bad.service'] });
    plantInstanceDropIn(box.home, 'bad', 'control-group');

    const r = runSweep(box.home);
    expect(r.status, 'a per-instance KillMode override swept anyway').toBe(1);
    expect(r.stderr).toContain('claude-session@bad.service');
    expect(r.stderr).toContain('REFUSING to sweep');
    expect(box.calls(), 'the sweep restarted every supervisor despite the override')
      .not.toContain('try-restart');
    // The pre-flight ASKED about the bad unit by name — with the loop reduced to
    // the template probe this is the assertion that cannot be satisfied.
    expect(box.calls()).toContain('show -p KillMode claude-session@bad.service');

    // Positive control on the same box: with the per-instance override removed,
    // the identical fixture sweeps. So the refusal above came from the drop-in,
    // not from the two-unit listing.
    rmSync(path.join(box.home, '.config', 'systemd', 'user', 'claude-session@bad.service.d'),
      { recursive: true, force: true });
    const ok = runSweep(box.home);
    expect(ok.status).toBe(0);
    expect(box.calls()).toContain('try-restart claude-session@*');
  });

  it('a unit that is ACTIVATING at sweep time is pre-flighted too — `try-restart` acts on it', () => {
    // `--state=active` matches the ActiveState `active` EXACTLY; `activating`
    // and `deactivating` are their own values and are absent from that listing.
    // `try-restart` is not filtered that way — it acts on units that are not
    // inactive/failed, which includes a unit still starting up. So with the
    // pre-flight filtered to `--state=active`, a unit in the gap was checked by
    // neither the loop (it is not listed) nor the trailing template probe (which
    // resolves the TEMPLATE, and cannot see a per-instance drop-in) — and was
    // then try-restarted anyway. That gap is the whole fleet kill, one unit wide.
    //
    // The pre-flight's listing is therefore UNFILTERED. It is a config gate, not
    // a liveness check: the cost of checking one unit too many (a `failed` unit,
    // which `try-restart` skips) is a refusal on a box whose unit config is
    // already wrong, and the cost of checking one too few is the fleet. The
    // VERIFY loop at the end of the sweep keeps `--state=active` and must — see
    // the FAILED-unit test above, where a unit that was never restarted must not
    // be handed to verify-service.sh.
    const box = sweepBox('ccrc-agent-sweepactivating-',
      { units: ['claude-session@rising.service'], activeUnits: [] });
    plantInstanceDropIn(box.home, 'rising', 'control-group');

    const r = runSweep(box.home);
    expect(r.status, 'a unit that was activating at sweep time was never pre-flighted').toBe(1);
    expect(r.stderr).toContain('claude-session@rising.service');
    expect(r.stderr).toContain('REFUSING to sweep');
    expect(box.calls(), 'the sweep restarted a unit it had not checked').not.toContain('try-restart');

    // Positive control, same shape as the per-instance case: the fixture sweeps
    // once the override is gone, so the refusal is the drop-in and not the
    // empty `--state=active` listing.
    rmSync(path.join(box.home, '.config', 'systemd', 'user', 'claude-session@rising.service.d'),
      { recursive: true, force: true });
    const ok = runSweep(box.home);
    expect(ok.status).toBe(0);
    expect(box.calls()).toContain('try-restart claude-session@*');
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
    // `CCRC_ACCOUNTS` joins the list in stage 2a: `config.ts` justifies its
    // `||`-over-`??` by pointing at the bare `CCRC_ACCOUNTS=` line this file
    // ships, so an example that stopped shipping it would leave that reasoning
    // describing a file that no longer exists.
    const example = readFileSync(path.join(deployDir, 'ccrc.env.example'), 'utf8');
    for (const v of ['CCRC_HOST', 'CCRC_PORT', 'CCRC_VAPID_PUBLIC',
      'CCRC_VAPID_PRIVATE', 'CCRC_VAPID_SUBJECT', 'CCRC_PROJECTS_ROOT',
      'CCRC_ACCOUNTS']) {
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

  it('~/.ccrc/accounts.sh also lands BEFORE both installers the deploy then RUNS', () => {
    // ccd is not the only roster reader the agent branch starts. Task 8 made
    // `install-session-hooks.sh` and `install-coordinator-skill.sh` `source`
    // the same generated `~/.ccrc/accounts.sh` — that is how they learn which
    // config dirs exist at all, the literal `homes=(…)` arrays having been
    // deleted — and each `exit 1`s when it is absent. deploy.sh executes both
    // over ssh, so with the roster install moved after either of them a deploy
    // fails HALFWAY: rsync --delete has already run, the new ccd is already
    // installed, and neither the hooks nor the coordinator skill got
    // installed at all. The ordering is correct today and nothing pinned it —
    // the ccd test above pins only ccd.
    //
    // ANCHORED ON THE `ssh` INVOCATIONS THEMSELVES, verbatim, for the reason
    // the sibling test above records by measurement: a probe anchored on a
    // script's NAME matches the `install_atomic` line that SHIPS it (and the
    // comments around it) rather than the line that RUNS it, so it would
    // "prove" an ordering the shell never performs.
    const agentBranch = deploySh.slice(
      deploySh.indexOf('if [ "$TARGET" = "agent" ]'), deploySh.indexOf('\nelse'));
    const shIdx = agentBranch.indexOf('install_atomic "$ACCOUNTS_SH" .ccrc/accounts.sh 644');
    expect(shIdx, 'deploy.sh never installs ~/.ccrc/accounts.sh').toBeGreaterThan(-1);

    for (const [what, invocation] of [
      ['session hooks', "\"${SSH[@]}\" \"$BOX\" 'bash ~/.cc-sessions/install-session-hooks.sh'"],
      ['coordinator skill', "\"${SSH[@]}\" \"$BOX\" 'bash ~/.cc-sessions/install-coordinator-skill.sh'"],
    ] as const) {
      const runIdx = agentBranch.indexOf(invocation);
      expect(runIdx, `the agent branch no longer runs the ${what} installer (looked for: ${invocation})`)
        .toBeGreaterThan(-1);
      expect(shIdx, `accounts.sh must be installed before the ${what} installer runs — it sources the roster and exits 1 without it`)
        .toBeLessThan(runIdx);
    }
  });

  it('the remote-control flag is seeded ON, once, BEFORE the ccd that reads it lands', () => {
    // Stage 2e, Task 2, and the ordering here is the whole reason Task 1's ccd
    // was deploy-blocked until this block existed. From the moment the new ccd
    // is installed, every spawn asks `~/.ccrc/remote-control` whether this box
    // drives its sessions over the RC socket, and an ABSENT file means off.
    // The reference fleet host has been running every session WITH
    // `--remote-control` since before the flag existed — so shipping the ccd
    // onto an unseeded box strips the flag from all ~11 live sessions at their
    // next respawn (D-99). The seed is not a nicety that could sit anywhere in
    // this branch: it must precede the install, or the gap between them IS the
    // outage.
    //
    // SEED-ONCE, never overwrite, for the roster's reason twice over: the file
    // is the operator's switch, and here rewriting it changes what every live
    // pane on the box becomes at its next respawn.
    //
    // ANCHORED ON THE `ssh` INVOCATION ITSELF — located as the one line in
    // this branch that is BOTH an ssh and a mention of the flag file — for the
    // measured reason the two siblings above record: a probe that matched a
    // name, or matched the path alone, would resolve to the COMMENT above the
    // code and "prove" an ordering the shell never runs.
    const agentBranch = deploySh.slice(
      deploySh.indexOf('if [ "$TARGET" = "agent" ]'), deploySh.indexOf('\nelse'));
    const seed = agentBranch.split('\n')
      .find((l) => l.includes('"${SSH[@]}"') && l.includes('.ccrc/remote-control'));
    expect(seed, 'the agent branch never seeds ~/.ccrc/remote-control').toBeTruthy();

    const seedIdx = agentBranch.indexOf(seed!);
    const shIdx = agentBranch.indexOf('install_atomic "$ACCOUNTS_SH" .ccrc/accounts.sh 644');
    const ccdIdx = agentBranch.indexOf('install_atomic ccd/ccd .local/bin/ccd 755');
    expect(shIdx, 'deploy.sh never installs ~/.ccrc/accounts.sh').toBeGreaterThan(-1);
    expect(ccdIdx, 'the agent branch no longer installs ccd').toBeGreaterThan(-1);
    expect(seedIdx, 'the flag must be seeded before the accounts.sh install — and so before every install below it')
      .toBeLessThan(shIdx);
    expect(seedIdx, 'the flag must be seeded before the ccd that reads it, or a respawn in the gap sees new-ccd on an unseeded box')
      .toBeLessThan(ccdIdx);

    // It CREATES, and only creates.
    expect(seed, 'the seed is not guarded — it would rewrite an operator\'s switch on every deploy')
      .toContain('[ -e ~/.ccrc/remote-control ]');

    // THE BYTES, extracted from the block rather than assumed: `ccd`'s
    // `_rc_enabled` reads the first line with `IFS= read -r`, and bash's
    // `read` returns NON-ZERO at EOF-before-delimiter — so `printf 'on'`
    // WITHOUT the newline writes a file that reads as OFF, which on this box
    // is the very strip the seed exists to prevent, dressed as a successful
    // deploy. `server/test/ccd-rc-flag.test.ts` pins the reader's half of
    // that measurement; this pins the writer's.
    const printf = /printf\s+(["'])([^"']*)\1/.exec(seed!);
    expect(printf, 'the seed does not write its line with printf').toBeTruthy();
    expect(printf![2], 'the seeded flag must be a LINE — a newline-less "on" reads as OFF')
      .toBe('on\\n');
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

  it('both branches print a roster fingerprint, and the way it is extracted still works', () => {
    // The two boxes are deployed by two separate runs of this script, so this
    // line is how an operator sees that the run they just did agrees with the
    // run they did last time. (At runtime the server and agent compare the
    // same digest continuously over the WS link — `rosterAgreement`,
    // server/src/fleetstate.ts — but that needs both boxes up and a fleet in
    // remote mode, and the agent-only and single-box cases have neither.)
    for (const [label, branch] of [
      ['agent', deploySh.slice(deploySh.indexOf('if [ "$TARGET" = "agent" ]'), deploySh.indexOf('\nelse'))],
      ['server', deploySh.slice(deploySh.indexOf('\nelse'))],
    ] as const) {
      expect(branch, `the ${label} branch never prints a roster fingerprint`)
        .toContain('roster fingerprint on $BOX');
    }

    // `roster_fp` reads the digest straight out of the generated file's own
    // marker line rather than recomputing it, which is only correct while
    // `markGenerated` keeps writing that line in that place. Proven by running
    // the extraction against a real marked file — a comment claiming the two
    // agree would let a marker-layout change turn every deploy's fingerprint
    // line silently blank.
    const fn = /roster_fp\(\) \{([\s\S]*?)\n\}/.exec(deploySh);
    expect(fn, 'deploy.sh has no roster_fp() helper').toBeTruthy();
    const marked = path.join(mkTmp('ccrc-roster-fp-'), 'accounts.sh');
    const body = '#!/usr/bin/env bash\nCCRC_ACCOUNTS=(claude)\n';
    writeFileSync(marked, markGenerated(body));
    const r = spawnSync('bash', ['-c', `roster_fp() {${fn![1]!}\n}\nroster_fp "$1"`, 'bash', marked],
      { encoding: 'utf8' });
    expect(r.stdout.trim(), 'roster_fp does not extract the digest markGenerated wrote')
      .toBe(bodyDigest(body));
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

  // ── Stage 2b, Task 8: the lifecycle CLI finally reaches a box ────────────
  // `ccd/ccrc` (version/doctor/status/adopt) existed in the repo and on NO
  // box: no deploy installed it. Shipping it is not one `install_atomic` line
  // by imitation of `ccd`, and why not is the whole design decision:
  //
  //   - `ccrc` sources `ccrc-doctor-checks` (which sources
  //     `ccrc-wrapper-shape`) through `${BASH_SOURCE[0]}`, which bash does NOT
  //     resolve through a symlink. A lone `~/.local/bin/ccrc` — or a symlink
  //     to the shipped tree — leaves `ccrc doctor` dead on every box:
  //     "doctor's check table is missing".
  //   - `_dr_pkg_candidates` (ccd/ccrc-doctor-checks) reads the shipped node
  //     floor at `$CCRC_HERE/../{server,agent}/package.json`. So installing
  //     all four files into `~/.local/bin` — which fixes the sourcing — BREAKS
  //     the node check instead: its candidates become
  //     `~/.local/{server,agent}/package.json`, neither of which exists.
  //
  // Both constraints point at the same place: `ccrc` has to RUN from inside
  // the shipped tree, `~/ccrc/ccd/ccrc`, which is what its own siblings and
  // the node check already assume (that path is the remedy string
  // `_check_node` prints). So PATH gets a SHIM that execs it. The four files
  // then arrive from ONE rsync of ONE tree and can never be from two different
  // deploys — where four independent `install_atomic` calls plus one aborted
  // run would leave a new `ccrc` beside a stale `ccrc-doctor-checks` for good.
  const shimBody = (): string => {
    const fn = /install_ccrc_shim\(\) \{([\s\S]*?)\n\}/.exec(deploySh);
    expect(fn, 'deploy.sh has no install_ccrc_shim() helper — nothing puts ccrc on PATH').toBeTruthy();
    const heredoc = /<<'CCRC_SHIM'\n([\s\S]*?)\nCCRC_SHIM\n/.exec(fn![1]!);
    expect(heredoc, 'install_ccrc_shim does not generate the shim from a quoted heredoc').toBeTruthy();
    return heredoc![1]!;
  };

  it('`ccrc` reaches PATH as a shim that EXECS the shipped tree — argv and exit code pass straight through', () => {
    // The shim is EXTRACTED AND RUN, not read: a structural assertion that the
    // text contains `exec` would pass on a shim that drops "$@", swallows the
    // exit code, or points at a path that is spelled `~/…` inside double
    // quotes (where bash does not expand a tilde) — all three of which are how
    // a two-line launcher actually goes wrong.
    const home = mkTmp('ccrc-shim-exec-');
    mkdirSync(path.join(home, 'ccrc', 'ccd'), { recursive: true });
    writeFileSync(path.join(home, 'ccrc', 'ccd', 'ccrc'),
      '#!/bin/sh\necho "shipped ccrc got: $*"\nexit 7\n', { mode: 0o755 });
    const shim = path.join(mkTmp('ccrc-shim-file-'), 'ccrc');
    writeFileSync(shim, `${shimBody()}\n`, { mode: 0o755 });

    const r = spawnSync('bash', [shim, 'doctor', '--nope'], {
      encoding: 'utf8', env: { ...process.env, HOME: home },
    });
    expect(r.stdout, 'the shim did not forward argv to the shipped ccrc').toContain('shipped ccrc got: doctor --nope');
    expect(r.status, "the shipped ccrc's exit code must be the shim's exit code").toBe(7);
  });

  it('the shim refuses BY NAME when the shipped tree is gone, rather than "command not found"', () => {
    // A box whose `~/ccrc` was deleted (or never rsynced) must be told which
    // file is missing and what to do — the operator's mistake here is
    // indistinguishable from "ccrc was never installed" otherwise.
    const home = mkTmp('ccrc-shim-notree-');
    const shim = path.join(mkTmp('ccrc-shim-file2-'), 'ccrc');
    writeFileSync(shim, `${shimBody()}\n`, { mode: 0o755 });
    const r = spawnSync('bash', [shim, 'version'], {
      encoding: 'utf8', env: { ...process.env, HOME: home },
    });
    expect(r.status, 'a missing shipped tree is exit 1 — the tool ran and the answer was bad').toBe(1);
    expect(r.stderr).toContain(path.join(home, 'ccrc', 'ccd', 'ccrc'));
    expect(r.stderr, 'the refusal must name the self-install remedy, not deploy.sh alone')
      .toMatch(/install\.sh/);
    expect(r.stderr, 'the refusal must also name the fleet-deploy remedy, not install.sh alone')
      .toMatch(/deploy/);
  });

  it('BOTH lanes install the shim, in the same ordering class as ccd — after the roster, before the restart', () => {
    // `ccrc doctor` has to work on BOTH boxes (it is how a box reports its own
    // fitness), and the two lanes are not symmetric: only the agent lane
    // installs `ccd`, so a shim added by imitation would land on the fleet
    // host alone and the server would have no `ccrc` at all.
    //
    // ORDERING: the same class as `ccd` — after the roster lands, before the
    // restart. Ahead of it because `ccrc status`/`doctor` read the roster the
    // deploy is placing; behind the restart because a shim installed after the
    // chain that can abort is a shim a failed deploy never lands.
    const agentBranch = deploySh.slice(
      deploySh.indexOf('if [ "$TARGET" = "agent" ]'), deploySh.indexOf('\nelse'));
    const serverBranch = deploySh.slice(deploySh.indexOf('\nelse'));

    const agentAt = agentBranch.indexOf('install_ccrc_shim');
    expect(agentAt, 'the agent lane never installs ccrc').toBeGreaterThan(-1);
    expect(agentAt, 'the shim must land after the roster it lets ccrc read')
      .toBeGreaterThan(agentBranch.indexOf('install_atomic "$ACCOUNTS_SH" .ccrc/accounts.sh 644'));
    expect(agentAt, 'the shim must land after the rsync that places the tree it points into')
      .toBeGreaterThan(agentBranch.indexOf('rsync -az'));
    expect(agentAt, 'the shim must land before the restart chain that can abort the deploy')
      .toBeLessThan(agentBranch.indexOf('"${SSH[@]}" "$BOX" "$AGENT_CMD"'));

    const serverAt = serverBranch.indexOf('install_ccrc_shim');
    expect(serverAt, 'the server lane never installs ccrc — doctor must run on BOTH boxes')
      .toBeGreaterThan(-1);
    expect(serverAt, 'the shim must land after the roster it lets ccrc read')
      .toBeGreaterThan(serverBranch.indexOf('ship_roster'));
    expect(serverAt, 'the shim must land after the rsync that places the tree it points into')
      .toBeGreaterThan(serverBranch.indexOf('rsync -az'));
    expect(serverAt, 'the shim must land before the restart chain that can abort the deploy')
      .toBeLessThan(serverBranch.indexOf('"${SSH[@]}" "$BOX" "$REMOTE_CMD"'));

    // `install_atomic` does NOT create its destination directory, and the
    // SERVER lane never creates `~/.local/bin` at all (the agent lane happens
    // to, in its backup step) — so the very first server deploy would scp into
    // a directory that does not exist. The mkdir lives INSIDE the helper, the
    // way `stamp_build` carries its own `mkdir -p ~/.ccrc`, so neither lane
    // has to remember it.
    const fn = /install_ccrc_shim\(\) \{([\s\S]*?)\n\}/.exec(deploySh)![1]!;
    expect(fn, 'install_ccrc_shim must create ~/.local/bin itself — install_atomic does not')
      .toContain('mkdir -p ~/.local/bin');
    const mkdirAt = fn.indexOf('mkdir -p ~/.local/bin');
    expect(fn.indexOf('install_atomic "$shim" .local/bin/ccrc 755'),
      'the mkdir must precede the install it exists for').toBeGreaterThan(mkdirAt);
  });

  it('BOTH lanes rsync the `ccd` tree the shim points into — the four ccrc files ship and version together', () => {
    // The shim is inert without `~/ccrc/ccd/`, and `ccrc` is inert without the
    // three files beside it. The server lane shipped `server shared deploy`
    // and no `ccd` at all, so `ccrc doctor` on the server box would have been
    // a shim pointing at nothing.
    //
    // This is also the answer to "ship and version together": all four files
    // ride ONE rsync of ONE tree, so a box cannot end up holding a new `ccrc`
    // beside a stale `ccrc-doctor-checks` — the failure four independent
    // `install_atomic` calls would make permanent on any aborted run.
    for (const f of ['ccrc', 'ccrc-doctor-checks', 'ccrc-wrapper-shape', 'ccrc-adopt']) {
      expect(existsSync(path.join(deployDir, '..', 'ccd', f)), `ccd/${f} is not in the repo`).toBe(true);
    }
    // The generic "~/ccrc/<dir>/ is shipped by this branch's rsync" test next
    // door cannot see this one: the shim's path lives inside a heredoc in a
    // top-level helper, not in either branch's text, and it is spelled with
    // `$HOME` rather than `~` (a tilde inside the double quotes the shim needs
    // does not expand). So the dependency is asserted here, per lane.
    for (const [label, branch] of [
      ['agent', deploySh.slice(deploySh.indexOf('if [ "$TARGET" = "agent" ]'), deploySh.indexOf('\nelse'))],
      ['server', deploySh.slice(deploySh.indexOf('\nelse'))],
    ] as const) {
      const m = /rsync -az --delete -e "\$\{SSH\[\*\]\}" --exclude node_modules[\s\S]*?"\$BOX":ccrc\//.exec(branch);
      expect(m, `${label} branch has no rsync shipping a tree into ~/ccrc/`).toBeTruthy();
      const sources = m![0].trim().split('\n').pop()!.replace(/"\$BOX":ccrc\/\s*$/, '').trim().split(/\s+/);
      expect(sources,
        `the ${label} lane does not ship ccd/ — its ccrc shim would point at a directory that does not exist`)
        .toContain('ccd');
    }
    // And the shim points at that tree, not at a copy of its own.
    expect(shimBody()).toContain('$HOME/ccrc/ccd/ccrc');
  });
});

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
    for (const dest of [
      '.local/bin/ccd', '.cc-sessions/notify.sh',
      '.cc-sessions/session-hook.sh', '.cc-sessions/install-session-hooks.sh',
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
    ]) {
      expect(deploySh, `missing atomic install call: ${call}`).toContain(call);
    }
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
});

// `ccrc rollout` — spec §4. The verb runs on the deploying machine and drives
// `ccrc update` on each box over ssh. Fixture: a stub `ssh` that RECORDS every
// `<host> <command>` and answers from per-host fixture files, the update
// suite's combined curl (local:// release space), real jq, and a deploy.env
// the test writes. No real ssh, no network, no live HOME.
import { describe, it, expect } from 'vitest';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import path, { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkTmp } from './tmpHelpers.js';
import { ghContainedEnv } from './ccdWsHelpers.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(here, '..', '..');
const BASH = spawnSync('bash', ['-c', 'command -v bash'], { encoding: 'utf8' }).stdout.trim();
const JQ = spawnSync('bash', ['-c', 'command -v jq'], { encoding: 'utf8' }).stdout.trim();
if (JQ === '') throw new Error('this box has no jq — the fixture needs it');

const FLEET = 'user@fleet-host';
const SERVER = 'user@server-host';
const SHA_OLD = 'oldsha0000000000000000000000000000000000';
const SHA_NEW = 'newsha0000000000000000000000000000000000';

interface Result { code: number; stdout: string; stderr: string }

/** Per-host state the ssh stub reads: role, current version, update exit. */
function plantHost(home: string, host: string, o: { role?: string; version?: string; sha?: string; updateExit?: number; installed?: boolean } = {}): void {
  const d = join(home, 'hosts', host);
  mkdirSync(d, { recursive: true });
  // D-3020: a re-plant with no `role` must leave the role file ABSENT, not
  // whatever an earlier plantHost on this same host left there — otherwise
  // "role file absent" (this function's own comment, and the role-preflight
  // test's) is a lie for any host planted twice.
  const roleFile = join(d, 'role');
  if (o.role !== undefined) writeFileSync(roleFile, `${o.role}\n`);
  else if (existsSync(roleFile)) rmSync(roleFile);
  writeFileSync(join(d, 'version'), `${o.version ?? ''}\n`);
  writeFileSync(join(d, 'sha'), `${o.sha ?? SHA_OLD}\n`);
  writeFileSync(join(d, 'update-exit'), `${o.updateExit ?? 0}\n`);
  writeFileSync(join(d, 'installed'), o.installed === false ? 'no\n' : 'yes\n');
}

function plantBox(home: string): void {
  mkdirSync(join(home, '.local', 'bin'), { recursive: true });
  const plant = (name: string, body: string): void =>
    writeFileSync(join(home, '.local', 'bin', name), body, { mode: 0o755 });
  // THE SSH STUB. argv: -p PORT -i KEY -o BatchMode=yes HOST CMD. Records
  // "HOST CMD" and answers CMD from <home>/hosts/<HOST>/*:
  //   grep … CCRC_ROLE …      -> the role file's value (nothing if absent)
  //   ccrc update --check …   -> a `check:` line built from version/sha/installed
  //   ccrc update --to …      -> exit update-exit; on 0, version := target
  //   ccrc version            -> "ccrc <sha> (release, built …)" + "version <v>"
  //   curl … /health          -> {"ok":true,"version":"<health-version or version>"}
  // Two fixture switches beside those, both per-host files:
  //   banner          -> ssh prints its own chatter on STDERR before the
  //                      command's output, the way a real ssh prints
  //                      "Warning: Permanently added …" or a login banner.
  //   health-version  -> what `/health` reports, when that must DIFFER from
  //                      what `ccrc version` reports (a server whose unit
  //                      did not come back on the new build).
  plant('ssh', [
    '#!/bin/sh',
    'while [ $# -gt 0 ]; do case "$1" in -p|-i|-o) shift 2 ;; -*) shift ;; *) break ;; esac; done',
    'host="$1"; shift; cmd="$*"',
    'printf \'%s\\n\' "$host $cmd" >> "$HOME/ssh-argv"',
    'd="$HOME/hosts/$host"; [ -d "$d" ] || { echo "ssh: could not resolve hostname $host" >&2; exit 255; }',
    '[ -f "$d/banner" ] && cat "$d/banner" >&2',
    'IFS= read -r ver < "$d/version"; IFS= read -r sha < "$d/sha"; IFS= read -r inst < "$d/installed"',
    'case "$cmd" in',
    '  *CCRC_ROLE*) [ -f "$d/role" ] && cat "$d/role"; exit 0 ;;',
    '  "ccrc update --check --to "*)',
    '    [ -f "$d/garbage-check" ] && { echo nonsense; exit 0; }',
    '    tgt="${cmd##* }"',
    '    if [ -z "$ver" ]; then state=unversioned; box=unversioned',
    '    elif [ "$ver" != "$tgt" ]; then state=behind; box="$ver"',
    '    elif [ "$inst" = yes ]; then state=current; box="$ver"',
    '    else state=incomplete; box="$ver"; fi',
    '    echo "check: box=$box sha=$sha target=$tgt state=$state"',
    '    [ "$state" = current ] && exit 0; exit 1 ;;',
    '  "ccrc update --to "*)',
    '    IFS= read -r rc < "$d/update-exit"',
    '    echo "update: fixture ran on $host: $cmd"',
    `    if [ "$rc" -eq 0 ]; then set -- $cmd; echo "$4" > "$d/version"; echo "${SHA_NEW}" > "$d/sha"; fi`,
    '    exit "$rc" ;;',
    '  "ccrc version") echo "ccrc $sha (release, built 2026-09-18T00:00:00Z)"; [ -n "$ver" ] && echo "version $ver"; exit 0 ;;',
    '  *"/health"*)',
    '    hv="$ver"; [ -f "$d/health-version" ] && IFS= read -r hv < "$d/health-version"',
    '    printf \'{"ok":true,"build":{"sha":"%s"},"version":"%s"}\\n\' "$sha" "$hv"; exit 0 ;;',
    'esac',
    'echo "fixture ssh: unexpected command: $cmd" >&2; exit 90',
  ].join('\n'));
  // curl: local:// release space (SHA256SUMS only — the pin reads nothing else), recorded.
  plant('curl', [
    '#!/bin/sh',
    'dest=""; url=""',
    'while [ $# -gt 0 ]; do case "$1" in -o) dest="$2"; shift 2 ;; -*) shift ;; *) url="$1"; shift ;; esac; done',
    'printf \'%s\\n\' "$url" >> "$HOME/curl-argv"',
    'src="${url#local://}"; [ -f "$src" ] || { echo "curl: (22) 404 for $url" >&2; exit 22; }',
    'cp "$src" "$dest"',
  ].join('\n'));
  symlinkSync(JQ, join(home, '.local', 'bin', 'jq'));
}

function plantRelease(home: string, tag: string, latest = true): void {
  const dir = latest ? join(home, 'releases', 'latest', 'download') : join(home, 'releases', 'download', tag);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'SHA256SUMS'), `${'0'.repeat(64)}  ccrc-${tag}.tar.gz\n`);
}

function plantDeployEnv(home: string, lines: string[] = [
  `CCRC_BOX=${SERVER}`, `CCRC_AGENT_BOX=${FLEET}`, `CCRC_SSH_KEY=${join(home, 'id_fixture')}`, 'CCRC_SSH_PORT=2222',
]): void {
  writeFileSync(join(home, 'deploy.env'), `${lines.join('\n')}\n`);
}

/** A two-box fleet, both behind, roles recorded, latest v2.0.0 published. */
function twoBoxFleet(prefix: string): string {
  const home = mkTmp(prefix);
  plantBox(home);
  plantDeployEnv(home);
  plantHost(home, FLEET, { role: 'fleet', version: 'v1.0.0' });
  plantHost(home, SERVER, { role: 'server', version: 'v1.0.0' });
  plantRelease(home, 'v2.0.0');
  return home;
}

function run(home: string, args: string[] = [], extraEnv: NodeJS.ProcessEnv = {}): Result {
  const env = ghContainedEnv(home, { ...process.env, HOME: home, ...extraEnv });
  for (const k of ['CCRC_BOX', 'CCRC_AGENT_BOX', 'CCRC_SSH_KEY', 'CCRC_SSH_PORT', 'CCRC_RELEASE_BASE_URL', 'CCRC_DEPLOY_ENV']) delete env[k];
  env['CCRC_DEPLOY_ENV'] = join(home, 'deploy.env');
  env['CCRC_RELEASE_BASE_URL'] = `local://${home}/releases`;
  env['TMPDIR'] = join(home, 'tmp'); mkdirSync(env['TMPDIR'], { recursive: true });
  const r = spawnSync(BASH, [join(REPO, 'ccd', 'ccrc'), 'rollout', ...args], { env, encoding: 'utf8' });
  return { code: r.status ?? -1, stdout: r.stdout ?? '', stderr: r.stderr ?? '' };
}
const sshCalls = (home: string): string[] => (existsSync(join(home, 'ssh-argv'))
  ? readFileSync(join(home, 'ssh-argv'), 'utf8').split('\n').filter((l) => l !== '') : []);
const updates = (home: string): string[] => sshCalls(home).filter((l) => / ccrc update --to /.test(l));

/** PATH with the fixture's `.local/bin` (ssh/curl stubs, no jq — jq's own
 *  symlink is removed) followed by every real directory on this process's
 *  own PATH that does NOT itself carry a `jq` binary, so real coreutils
 *  (bash's external dependencies: grep, cut, tr, mktemp, awk, sed, …) stay
 *  reachable while `jq` is reachable NOWHERE — not the fixture's, not a
 *  system one three directories over. Ccrc-install.test.ts's `pathWithout`
 *  models the identical idea (one absence, real tools otherwise).
 */
function pathWithoutJq(home: string): string {
  rmSync(join(home, '.local', 'bin', 'jq'), { force: true });
  const real = (process.env['PATH'] ?? '').split(':').filter((d) => d !== '' && !existsSync(join(d, 'jq')));
  return [join(home, '.local', 'bin'), ...real].join(':');
}

describe('ccrc rollout: refusals before any box is touched (exit 2, no ssh)', () => {
  it('a missing coordinate names the key and the file', () => {
    const home = twoBoxFleet('ccrc-rollout-coord-');
    plantDeployEnv(home, [`CCRC_BOX=${SERVER}`, `CCRC_SSH_KEY=${join(home, 'k')}`]);   // no CCRC_AGENT_BOX
    const r = run(home);
    expect(r.code).toBe(2);
    expect(r.stderr).toMatch(/\$CCRC_AGENT_BOX is not set/);
    expect(r.stderr).toContain(join(home, 'deploy.env'));
    expect(sshCalls(home)).toEqual([]);
  });

  it('a box with no recorded role, or the wrong one, gets no update — an absent role installs "both"', () => {
    const home = twoBoxFleet('ccrc-rollout-role-');
    plantHost(home, SERVER, { version: 'v1.0.0' });   // role file absent
    let r = run(home);
    expect(r.code).toBe(2);
    expect(r.stderr).toMatch(/server box \(CCRC_BOX\) records CCRC_ROLE=nothing, not 'server'/);
    expect(updates(home)).toEqual([]);
    plantHost(home, SERVER, { role: 'fleet', version: 'v1.0.0' });
    r = run(home);
    expect(r.code).toBe(2);
    expect(updates(home)).toEqual([]);
  });

  // R7: no overloaded null at the role seam — an unreachable box (ssh's own
  // transport failure) must read differently from a reachable box recording
  // no role at all.
  it('an unreachable fleet box is distinguished from a role-less one', () => {
    const home = twoBoxFleet('ccrc-rollout-unreachable-');
    rmSync(join(home, 'hosts', FLEET), { recursive: true, force: true });   // no fixture dir -> ssh stub exits 255
    const r = run(home);
    expect(r.code).toBe(2);
    expect(r.stderr).toMatch(/unreachable over ssh \(exit 255\)/);
    expect(r.stderr).not.toMatch(/records CCRC_ROLE=/);
    expect(updates(home)).toEqual([]);
    // …and it says WHY. `_rollout_role` used to send ssh's stderr to
    // /dev/null, so the operator got an exit code and nothing else — the one
    // piece of evidence that separates a wrong key from a wrong port from a
    // host that is simply down. The refusal now quotes ssh's own last line.
    expect(r.stderr).toMatch(/ssh said: ssh: could not resolve hostname user@fleet-host/);
  });

  it('an unknown argument and a malformed --to are usage errors', () => {
    const home = twoBoxFleet('ccrc-rollout-usage-');
    expect(run(home, ['--bogus']).code).toBe(2);
    expect(run(home, ['--to', '2.0.0']).code).toBe(2);
    expect(sshCalls(home)).toEqual([]);
  });

  // R6: the exit-code contract wins over any literal code below it — every
  // refusal before the first `ccrc update --to` argv is exit 2, never 1.
  it('no jq on PATH refuses at exit 2, before any ssh call', () => {
    const home = twoBoxFleet('ccrc-rollout-nojq-');
    const r = run(home, [], { PATH: pathWithoutJq(home) });
    expect(r.code, `stderr: ${r.stderr}`).toBe(2);
    expect(r.stderr).toMatch(/jq is required/);
    expect(sshCalls(home)).toEqual([]);
  });

  it('a release space with no SHA256SUMS refuses at exit 2, nothing touched', () => {
    const home = mkTmp('ccrc-rollout-norelease-');
    plantBox(home);
    plantDeployEnv(home);
    plantHost(home, FLEET, { role: 'fleet', version: 'v1.0.0' });
    plantHost(home, SERVER, { role: 'server', version: 'v1.0.0' });
    // No plantRelease(home, ...): the release space stays empty.
    const r = run(home);
    expect(r.code, `stderr: ${r.stderr}`).toBe(2);
    expect(r.stderr).toMatch(/is there a release\?/);
    expect(updates(home)).toEqual([]);
  });

  it('a garbage --check answer from a box refuses at exit 2, before any update', () => {
    const home = twoBoxFleet('ccrc-rollout-garbage-');
    mkdirSync(join(home, 'hosts', FLEET), { recursive: true });
    writeFileSync(join(home, 'hosts', FLEET, 'garbage-check'), '');
    const r = run(home);
    expect(r.code, `stderr: ${r.stderr}`).toBe(2);
    expect(updates(home)).toEqual([]);
  });

  // R13. The check line is parsed out of STDOUT, and it is looked for
  // ANYWHERE in it rather than demanded as line one. Step 3 used to capture
  // `2>&1` and test the FIRST line, so ssh's own chatter — a host-key
  // warning, a login banner, neither of them the remote ccrc's doing —
  // refused the rollout and blamed the box for it.
  it("ssh's own stderr chatter is relayed, not parsed: the rollout still reads the check line and proceeds", () => {
    const home = twoBoxFleet('ccrc-rollout-banner-');
    writeFileSync(join(home, 'hosts', FLEET, 'banner'),
      "Warning: Permanently added 'user@fleet-host' (ED25519) to the list of known hosts.\n");
    const r = run(home);
    expect(r.code, `stderr: ${r.stderr}\nstdout: ${r.stdout}`).toBe(0);
    expect(updates(home)).toEqual([`${FLEET} ccrc update --to v2.0.0`, `${SERVER} ccrc update --to v2.0.0`]);
    expect(r.stdout).toMatch(/^rollout: fleet: v1\.0\.0 \(oldsha00\) → v2\.0\.0 \[behind\]$/m);
    // RELAYED, not swallowed: an operator has to SEE a host-key warning, and
    // it arrives on stderr carrying the box's own label.
    expect(r.stderr).toMatch(/^fleet: Warning: Permanently added 'user@fleet-host'/m);
  });

  // R13. `$ROLLOUT_VERSION` comes out of a DOWNLOADED SHA256SUMS and is
  // interpolated into a command a remote shell parses. `--to`'s own value is
  // shape-checked at parse time; the published name was not.
  it('a published release name that is not vX.Y.Z-shaped refuses at exit 2 — it never reaches a remote shell', () => {
    const home = twoBoxFleet('ccrc-rollout-badname-');
    writeFileSync(join(home, 'releases', 'latest', 'download', 'SHA256SUMS'),
      `${'0'.repeat(64)}  ccrc-v1.0.0;echo.tar.gz\n`);
    const r = run(home);
    expect(r.code, `stderr: ${r.stderr}\nstdout: ${r.stdout}`).toBe(2);
    expect(r.stderr).toMatch(/the published release name is not vX\.Y\.Z-shaped \(got: v1\.0\.0;echo\)/);
    expect(updates(home)).toEqual([]);
    // The name reached NO remote command at all — not the update, not the
    // check. (The role preflight's two ssh calls are step 1 and precede the
    // version pin by design, so "no ssh at all" is not what this verb can
    // promise; "no ssh carrying that name" is, and is the property that
    // matters. D-3050.)
    expect(sshCalls(home).filter((l) => l.includes(';echo'))).toEqual([]);
    expect(sshCalls(home).filter((l) => l.includes('--check'))).toEqual([]);
  });
});

describe('ccrc rollout: pin, measure, update in order, verify', () => {
  it('pins the version from SHA256SUMS before any update, passes the same --to to both boxes, fleet then server, and verifies by re-measurement', () => {
    const home = twoBoxFleet('ccrc-rollout-happy-');
    const r = run(home);
    expect(r.code, `stderr: ${r.stderr}\nstdout: ${r.stdout}`).toBe(0);
    // The pin: one SHA256SUMS read, before the first ssh update.
    expect(readFileSync(join(home, 'curl-argv'), 'utf8').trim()).toBe(`local://${home}/releases/latest/download/SHA256SUMS`);
    expect(updates(home)).toEqual([`${FLEET} ccrc update --to v2.0.0`, `${SERVER} ccrc update --to v2.0.0`]);
    // The plan was printed from the check line, per box.
    expect(r.stdout).toMatch(/^rollout: fleet: v1\.0\.0 \(oldsha00\) → v2\.0\.0 \[behind\]$/m);
    expect(r.stdout).toMatch(/^rollout: server: v1\.0\.0 \(oldsha00\) → v2\.0\.0 \[behind\]$/m);
    // Verification read `ccrc version` on both and /health on the server.
    const calls = sshCalls(home);
    expect(calls.filter((l) => l.endsWith(' ccrc version'))).toEqual([`${FLEET} ccrc version`, `${SERVER} ccrc version`]);
    expect(calls.some((l) => l.startsWith(`${SERVER} curl`) && l.includes('127.0.0.1:7788/health'))).toBe(true);
    expect(r.stdout).toMatch(/^rollout: fleet v2\.0\.0 \(newsha00\) · server v2\.0\.0 \(newsha00\) — agreed$/m);
    // The update ran AFTER the check on every box (the check pins the plan).
    const idxCheck = calls.findIndex((l) => l.includes('--check'));
    const idxUpdate = calls.findIndex((l) => / ccrc update --to /.test(l));
    expect(idxCheck).toBeLessThan(idxUpdate);
  });

  it('--to pins that tag and reads its own URL space', () => {
    const home = twoBoxFleet('ccrc-rollout-to-');
    plantRelease(home, 'v1.5.0', false);
    const r = run(home, ['--to', 'v1.5.0']);
    expect(r.code, r.stderr).toBe(0);
    expect(readFileSync(join(home, 'curl-argv'), 'utf8').trim()).toBe(`local://${home}/releases/download/v1.5.0/SHA256SUMS`);
    expect(updates(home)).toEqual([`${FLEET} ccrc update --to v1.5.0`, `${SERVER} ccrc update --to v1.5.0`]);
  });

  it('--server-first inverts the order', () => {
    const home = twoBoxFleet('ccrc-rollout-inverted-');
    const r = run(home, ['--server-first']);
    expect(r.code, r.stderr).toBe(0);
    expect(updates(home)).toEqual([`${SERVER} ccrc update --to v2.0.0`, `${FLEET} ccrc update --to v2.0.0`]);
  });

  it('box one fails → stop: box two is never touched, exit 1, the message says so', () => {
    const home = twoBoxFleet('ccrc-rollout-stop-');
    plantHost(home, FLEET, { role: 'fleet', version: 'v1.0.0', updateExit: 1 });
    const r = run(home);
    expect(r.code).toBe(1);
    expect(updates(home)).toEqual([`${FLEET} ccrc update --to v2.0.0`]);
    expect(r.stderr).toMatch(/the fleet box's update exited 1 — stopped here\. The server box was not touched/);
    expect(r.stdout).toMatch(/^fleet: update: fixture ran on user@fleet-host/m);   // streamed, prefixed
  });

  it('--check measures and stops: no update argv; exit 1 while any box is behind, 0 when all current', () => {
    const home = twoBoxFleet('ccrc-rollout-check-');
    let r = run(home, ['--check']);
    expect(r.code).toBe(1);
    expect(updates(home)).toEqual([]);
    expect(r.stdout).toMatch(/\[behind\]/);
    plantHost(home, FLEET, { role: 'fleet', version: 'v2.0.0' });
    plantHost(home, SERVER, { role: 'server', version: 'v2.0.0' });
    r = run(home, ['--check']);
    expect(r.code).toBe(0);
    expect(updates(home)).toEqual([]);
  });

  it('every box current and no --force → nothing to do, exit 0, no update; --force updates anyway', () => {
    const home = twoBoxFleet('ccrc-rollout-noop-');
    plantHost(home, FLEET, { role: 'fleet', version: 'v2.0.0' });
    plantHost(home, SERVER, { role: 'server', version: 'v2.0.0' });
    let r = run(home);
    expect(r.code, r.stderr).toBe(0);
    expect(r.stdout).toMatch(/^rollout: every box already runs v2\.0\.0 — nothing to do$/m);
    expect(updates(home)).toEqual([]);
    r = run(home, ['--force']);
    expect(r.code, r.stderr).toBe(0);
    expect(updates(home)).toEqual([`${FLEET} ccrc update --to v2.0.0 --force`, `${SERVER} ccrc update --to v2.0.0 --force`]);
  });

  it('a box whose install never completed is not "current" — it gets its update', () => {
    const home = twoBoxFleet('ccrc-rollout-incomplete-');
    plantHost(home, FLEET, { role: 'fleet', version: 'v2.0.0', installed: false });
    plantHost(home, SERVER, { role: 'server', version: 'v2.0.0' });
    const r = run(home);
    expect(r.code, r.stderr).toBe(0);
    expect(updates(home)).toEqual([`${FLEET} ccrc update --to v2.0.0`, `${SERVER} ccrc update --to v2.0.0`]);
  });

  it('a single-box fleet (same host in both coordinates) needs CCRC_ROLE=both and updates once', () => {
    const home = twoBoxFleet('ccrc-rollout-single-');
    plantDeployEnv(home, [`CCRC_BOX=${SERVER}`, `CCRC_AGENT_BOX=${SERVER}`, `CCRC_SSH_KEY=${join(home, 'k')}`]);
    plantHost(home, SERVER, { role: 'both', version: 'v1.0.0' });
    const r = run(home);
    expect(r.code, r.stderr).toBe(0);
    expect(updates(home)).toEqual([`${SERVER} ccrc update --to v2.0.0`]);
    // …and `/health` is still re-measured on it. EVERY shape includes the
    // server box — both two-box orders and this one — which is why step 6's
    // `/health` block carries no guard at all. The guard it replaced asked
    // two questions no input could answer `no` to.
    expect(sshCalls(home).some((l) => l.startsWith(`${SERVER} curl`) && l.includes('127.0.0.1:7788/health'))).toBe(true);
  });

  // F6/R13: `ccrc version` agreeing on BOTH boxes is not the whole
  // verification — the server's own `/health` is re-measured too, because
  // the file on disk being right and the RUNNING unit being right are two
  // facts, and a unit that failed to come back on the new build is exactly
  // the case this arm exists for.
  it('both boxes report the target but the server /health still answers the OLD version → exit 1, naming /health', () => {
    const home = twoBoxFleet('ccrc-rollout-health-');
    writeFileSync(join(home, 'hosts', SERVER, 'health-version'), 'v1.0.0\n');
    const r = run(home);
    expect(r.code, `stderr: ${r.stderr}\nstdout: ${r.stdout}`).toBe(1);
    // `ccrc version` agreed on both — the disagreement is /health's alone.
    expect(r.stderr).not.toMatch(/reports v1\.0\.0, not v2\.0\.0, after its update/);
    expect(r.stderr).toMatch(/on \/health after its restart/);
    expect(r.stderr).toMatch(/the server box reports v1\.0\.0, not v2\.0\.0/);
    expect(r.stdout).toMatch(/— NOT agreed$/m);
  });

  it('verification disagreeing with the target is exit 1 and names the box', () => {
    const home = twoBoxFleet('ccrc-rollout-verify-');
    // The server's "update" exits 0 but the fixture leaves its version alone.
    const d = join(home, 'hosts', SERVER);
    writeFileSync(join(d, 'update-exit'), '0\n');
    writeFileSync(join(home, '.local', 'bin', 'ssh'),
      readFileSync(join(home, '.local', 'bin', 'ssh'), 'utf8').replace('echo "$4" > "$d/version"', '[ "$host" = "user@fleet-host" ] && echo "$4" > "$d/version"'));
    const r = run(home);
    expect(r.code).toBe(1);
    expect(r.stderr).toMatch(/server box reports v1\.0\.0, not v2\.0\.0/);
  });
});

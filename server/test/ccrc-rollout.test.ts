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

/** Per-host state the ssh stub reads: role, current version, update exit —
 *  and, since W4 (Task 12), the check line's two new fields, the pre-W4 line
 *  shape, a state override and the `ccrc channel` answer. */
function plantHost(home: string, host: string, o: {
  role?: string; version?: string; sha?: string; updateExit?: number; installed?: boolean;
  caps?: string; floor?: string; checkState?: string; oldCheck?: boolean; channelLine?: string;
  /** Fix round 1 item 4 / review 155 C34: the RAW bytes `cat
   *  ~/.ccrc/update.json` answers on this host, read by rollout's own extra
   *  read-only ssh ONLY after an exit-3 update. Undefined (the default) is a
   *  pre-W4 box: no file, `cat` prints nothing, exactly `_rollout_exit3_detail`
   *  must tolerate. */
  updateJson?: string;
} = {}): void {
  const d = join(home, 'hosts', host);
  mkdirSync(d, { recursive: true });
  // D-3020: a re-plant with no `role` must leave the role file ABSENT, not
  // whatever an earlier plantHost on this same host left there — otherwise
  // "role file absent" (this function's own comment, and the role-preflight
  // test's) is a lie for any host planted twice. The W4 files below follow
  // the same rule, for the same reason.
  const optional = (name: string, v: string | undefined): void => {
    const f = join(d, name);
    if (v !== undefined) writeFileSync(f, `${v}\n`);
    else if (existsSync(f)) rmSync(f);
  };
  optional('role', o.role);
  writeFileSync(join(d, 'version'), `${o.version ?? ''}\n`);
  writeFileSync(join(d, 'sha'), `${o.sha ?? SHA_OLD}\n`);
  writeFileSync(join(d, 'update-exit'), `${o.updateExit ?? 0}\n`);
  writeFileSync(join(d, 'installed'), o.installed === false ? 'no\n' : 'yes\n');
  optional('caps', o.caps);
  optional('floor', o.floor);
  optional('check-state', o.checkState);
  optional('old-check', o.oldCheck === true ? 'yes' : undefined);
  optional('channel-line', o.channelLine);
  // No trailing newline forced — a real update.json ends in one `mv -f`'d
  // JSON line, and a test that wants to probe a malformed byte stream plants
  // it directly rather than through this helper.
  const ujf = join(d, 'update-json');
  if (o.updateJson !== undefined) writeFileSync(ujf, o.updateJson);
  else if (existsSync(ujf)) rmSync(ujf);
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
  // W4 (Task 12) — five more, each a per-host file plantHost removes when
  // not asked for. The stub computes `--check` ITSELF, never through the
  // real cmd_update (that is ccrc-update.test.ts's subject), so these are
  // rollout's PARSER's inputs:
  //   caps            -> the caps= words (default W1's three: no update-json,
  //                      so no --from rollout — every earlier case's argv)
  //   floor           -> the floor= word (default none)
  //   check-state     -> overrides the computed state (below-floor)
  //   old-check       -> a box one wave older: the pre-W4 check line (no
  //                      caps=, no floor=), and its update refuses --from
  //                      exactly as an older ccrc refuses an unknown argument
  //   channel-line    -> what `ccrc channel` prints; absent, the stub answers
  //                      as a ccrc that predates the verb (stderr, exit 2)
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
    '    caps=verify,node-id,floor; [ -f "$d/caps" ] && IFS= read -r caps < "$d/caps"',
    '    floor=none; [ -f "$d/floor" ] && IFS= read -r floor < "$d/floor"',
    '    [ -f "$d/check-state" ] && IFS= read -r state < "$d/check-state"',
    '    if [ -f "$d/old-check" ]; then echo "check: box=$box sha=$sha target=$tgt state=$state"',
    '    else echo "check: box=$box sha=$sha target=$tgt caps=$caps floor=$floor state=$state"; fi',
    '    [ "$state" = current ] && exit 0; exit 1 ;;',
    '  "ccrc update --to "*)',
    '    case " $cmd " in *" --from "*) [ -f "$d/old-check" ] && { echo "ccrc: unknown argument: --from" >&2; exit 2; } ;; esac',
    '    IFS= read -r rc < "$d/update-exit"',
    '    echo "update: fixture ran on $host: $cmd"',
    // 0 = moved; 3 = moved, but the box's trailing doctor failed (D-3114): the
    // box IS on the new build either way, so the fixture bumps it either way.
    `    if [ "$rc" -eq 0 ] || [ "$rc" -eq 3 ]; then set -- $cmd; echo "$4" > "$d/version"; echo "${SHA_NEW}" > "$d/sha"; fi`,
    '    exit "$rc" ;;',
    '  "ccrc channel")',
    '    [ -f "$d/channel-line" ] || { echo "ccrc: unknown argument: channel" >&2; exit 2; }',
    '    cat "$d/channel-line"; exit 0 ;;',
    // Fix round 1 item 4 / review 155 C34: `_rollout_exit3_detail`'s own
    // extra read-only ssh, sent ONLY after an exit-3 update. Absent file
    // (the default) means a pre-W4 box: `cat` prints nothing, exit 0 —
    // `_rollout_exit3_detail` must tolerate that, not die on it.
    '  "cat ~/.ccrc/update.json 2>/dev/null")',
    '    [ -f "$d/update-json" ] && cat "$d/update-json"',
    '    exit 0 ;;',
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
    // Fix round 1 item 12 / review 155 C22: the die sentence now also names
    // the connect/stall bound.
    expect(r.stderr).toMatch(/is there a release, or did the connection stall/);
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

  it('a box that MOVED but whose trailing doctor failed (update exit 3) does not stop the rollout: the next box runs, both are verified, exit 3 names it (D-3114)', () => {
    // Measured 2026-09-20 on the live fleet: the server box wrote its record
    // and was on the new build, its doctor FAILed on four pre-existing box
    // facts, `ccrc update` exited 1, and rollout said "stopped here … deploy.sh
    // remains the fallback" over a box that had moved. Exit 3 from update is
    // "moved, unhealthy"; rollout relays it and carries on.
    const home = twoBoxFleet('ccrc-rollout-doctor-failed-');
    plantHost(home, FLEET, { role: 'fleet', version: 'v1.0.0', updateExit: 3 });
    const r = run(home);
    expect(r.code, r.stderr).toBe(3);
    expect(updates(home)).toEqual([`${FLEET} ccrc update --to v2.0.0`, `${SERVER} ccrc update --to v2.0.0`]);
    expect(r.stdout).toMatch(/^rollout: fleet: moved to v2\.0\.0, but its doctor failed — read the fleet: FAIL lines above; that is the box's health, not the rollout's$/m);
    expect(r.stdout).toMatch(/^rollout: fleet v2\.0\.0 \(newsha00\) · server v2\.0\.0 \(newsha00\)/m);   // step 6 still ran
    expect(r.stderr).not.toMatch(/stopped here/);
    // A box that DIED (exit 1) still stops the rollout, as before.
    const home2 = twoBoxFleet('ccrc-rollout-died-');
    plantHost(home2, FLEET, { role: 'fleet', version: 'v1.0.0', updateExit: 1 });
    const r2 = run(home2);
    expect(r2.code).toBe(1);
    expect(updates(home2)).toEqual([`${FLEET} ccrc update --to v2.0.0`]);
  });

  // Fix round 1 item 4 / review 155 C34, beside the doctor case right above:
  // exit 3 carries TWO different deaths under one code (D-3114), and only
  // the first has doctor FAIL lines to read. This box's own measured detail
  // (read over rollout's extra read-only ssh) says the second.
  it('a box that MOVED but whose FLOOR WRITE died (update exit 3, no doctor FAIL lines at all) gets its own sentence, never "read the … FAIL lines above" — the real cause, measured from the box (C34)', () => {
    const home = twoBoxFleet('ccrc-rollout-floor-died-');
    plantHost(home, FLEET, {
      role: 'fleet', version: 'v1.0.0', updateExit: 3,
      updateJson: JSON.stringify({
        target: 'v2.0.0', phase: 'done', startedAt: 1, updatedAt: 2,
        detail: 'the floor write died inside _inst_installed - the box moved; its floor was not raised',
        from: 'rollout', pid: 12345,
      }),
    });
    const r = run(home);
    expect(r.code, r.stderr).toBe(3);
    expect(updates(home)).toEqual([`${FLEET} ccrc update --to v2.0.0`, `${SERVER} ccrc update --to v2.0.0`]);
    expect(r.stdout).toMatch(/^rollout: fleet: moved to v2\.0\.0, but its floor write died before ccrc doctor ever ran — its floor was not raised, not its health; its own report: .*floor was not raised$/m);
    expect(r.stdout).not.toContain('read the fleet: FAIL lines above');
    expect(r.stdout).toMatch(/^rollout: fleet v2\.0\.0 \(newsha00\) · server v2\.0\.0 \(newsha00\)/m);   // step 6 still ran
    expect(r.stderr).not.toMatch(/stopped here/);
    // The extra read-only ssh reached exactly the box that exited 3, exactly
    // once — never the server box, which moved clean (exit 0).
    const catCalls = sshCalls(home).filter((l) => l.includes('cat ~/.ccrc/update.json'));
    expect(catCalls).toEqual([`${FLEET} cat ~/.ccrc/update.json 2>/dev/null`]);
  });

  // The tolerate-a-pre-W4-box half of the same item: no update.json at all
  // (plantHost's default) still ends in the EXISTING doctor sentence, never
  // a crash or a hang on the extra ssh's empty answer.
  it('a pre-W4 box (no ~/.ccrc/update.json at all) on exit 3 falls back to the doctor sentence — tolerated, not a death', () => {
    const home = twoBoxFleet('ccrc-rollout-floor-prew4-');
    plantHost(home, FLEET, { role: 'fleet', version: 'v1.0.0', updateExit: 3 });   // no updateJson
    const r = run(home);
    expect(r.code, r.stderr).toBe(3);
    expect(r.stdout).toMatch(/^rollout: fleet: moved to v2\.0\.0, but its doctor failed — read the fleet: FAIL lines above; that is the box's health, not the rollout's$/m);
  });

  it('a box whose update failed its health gate (update exit 4) stops the rollout with its own sentence — the other box is never touched (design §11)', () => {
    // Exit 4 is "the gate failed and the box restored itself": NOT on the
    // target, so the rollout stops like any other non-zero — but the remedy
    // is that box's own report, not deploy.sh.
    const home = twoBoxFleet('ccrc-rollout-gate-failed-');
    plantHost(home, FLEET, { role: 'fleet', version: 'v1.0.0', updateExit: 4 });
    const r = run(home);
    expect(r.code).toBe(1);
    expect(updates(home)).toEqual([`${FLEET} ccrc update --to v2.0.0`]);
    expect(r.stderr).toMatch(/rollout: the fleet box's update failed its health gate and restored itself \(exit 4\) — stopped here\. The server box was not touched\. Its ~\/\.ccrc\/update\.json names the restore arm; 'ccrc update --check' there says where it now stands$/m);
    expect(r.stderr).not.toMatch(/deploy\.sh remains the fallback/);
    expect(sshCalls(home).some((l) => l.endsWith(' ccrc version')), 'step 6 ran after a gate failure').toBe(false);
    // Inverted: the server's 4 leaves the fleet box untouched, same sentence.
    const inv = twoBoxFleet('ccrc-rollout-gate-failed-inv-');
    plantHost(inv, SERVER, { role: 'server', version: 'v1.0.0', updateExit: 4 });
    const r2 = run(inv, ['--server-first']);
    expect(r2.code).toBe(1);
    expect(updates(inv)).toEqual([`${SERVER} ccrc update --to v2.0.0`]);
    expect(r2.stderr).toMatch(/the server box's update failed its health gate and restored itself \(exit 4\) — stopped here\. The fleet box was not touched\./);
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

  it('--check --force measures, then says what --force WOULD do — no update argv, the check\'s own exit code (R17)', () => {
    // The pair used to mean "measure, and silently drop the flag you also
    // typed". Ruled 2026-09-19: it means measure, and report the act --force
    // would take — which boxes would run `ccrc update --to <v> --force`.
    const home = twoBoxFleet('ccrc-rollout-check-force-');
    let r = run(home, ['--check', '--force']);
    expect(r.code).toBe(1);                       // one box behind → --check's own verdict
    expect(updates(home)).toEqual([]);
    expect(r.stdout).toMatch(/^rollout: with --force, 2 box\(es\) would run 'ccrc update --to v2\.0\.0 --force': fleet \[behind\], server \[behind\] — nothing was touched$/m);
    plantHost(home, FLEET, { role: 'fleet', version: 'v2.0.0' });
    plantHost(home, SERVER, { role: 'server', version: 'v2.0.0' });
    r = run(home, ['--check', '--force']);
    expect(r.code).toBe(0);                       // every box current → 0, and STILL no update
    expect(updates(home)).toEqual([]);
    expect(r.stdout).toMatch(/^rollout: with --force, 2 box\(es\) would run 'ccrc update --to v2\.0\.0 --force': fleet \[current\], server \[current\] — nothing was touched$/m);
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

describe('ccrc rollout: the W4 check line, a box one wave older, the floor and the passthrough flags (M3, M4; spec §14, D-3106\'s lesson)', () => {
  /** A W4 box's words: update-json is the one `--from rollout` rides on. */
  const CAPS_W4 = 'verify,node-id,floor,update-json';

  it('a pre-W4 box (no caps=, no floor=) parses with its state intact and gets no --from; a box whose caps name update-json gets --from rollout', () => {
    const home = twoBoxFleet('ccrc-rollout-prew4-');
    plantHost(home, FLEET, { role: 'fleet', version: 'v1.0.0', oldCheck: true });
    plantHost(home, SERVER, { role: 'server', version: 'v1.0.0', caps: CAPS_W4 });
    const r = run(home);
    expect(r.code, `stderr: ${r.stderr}\nstdout: ${r.stdout}`).toBe(0);
    // No stray field swallowed into either state word.
    expect(r.stdout).toMatch(/^rollout: fleet: v1\.0\.0 \(oldsha00\) → v2\.0\.0 \[behind\]$/m);
    expect(r.stdout).toMatch(/^rollout: server: v1\.0\.0 \(oldsha00\) → v2\.0\.0 \[behind\]$/m);
    expect(r.stdout).toMatch(/^rollout: fleet: its check line lists no capabilities \(a ccrc older than W4 prints no caps=\) — it gets no --from rollout$/m);
    expect(r.stdout).not.toMatch(/^rollout: server: its check line lists no capabilities/m);
    // Fix round 1 item 21 / review 155 C36: the SAME pre-W4 box's missing
    // floor= gets a NOTE too, same shape as the missing caps= note right
    // above — never a refusal (a refusal here would block the very first
    // rollout onto this wave). The server box's check line names floor=none
    // (a real, non-empty field), so it gets no such note.
    expect(r.stdout).toMatch(/^rollout: fleet: its check line lists no floor= \(a ccrc older than W4 prints none\) — its floor is checked at its own install$/m);
    expect(r.stdout).not.toMatch(/^rollout: server: its check line lists no floor=/m);
    expect(updates(home)).toEqual([`${FLEET} ccrc update --to v2.0.0`, `${SERVER} ccrc update --to v2.0.0 --from rollout`]);
  });

  it('a box below its floor refuses at exit 2 before EITHER box moves — --server-first too, so the server is never moved first (M3)', () => {
    const home = twoBoxFleet('ccrc-rollout-belowfloor-');
    plantHost(home, FLEET, { role: 'fleet', version: 'v3.0.0', floor: 'v3.0.0', checkState: 'below-floor' });
    let r = run(home);
    expect(r.code, `stderr: ${r.stderr}\nstdout: ${r.stdout}`).toBe(2);
    expect(r.stdout).toMatch(/^rollout: fleet: v3\.0\.0 \(oldsha00\) → v2\.0\.0 \[below-floor\]$/m);
    expect(r.stderr).toMatch(/rollout: the fleet box's floor is v3\.0\.0, above v2\.0\.0 — pass --downgrade to move it down; nothing was touched/);
    expect(updates(home)).toEqual([]);
    r = run(home, ['--server-first']);
    expect(r.code).toBe(2);
    expect(updates(home)).toEqual([]);
    // --force is not --downgrade (M7's rule, one layer up).
    r = run(home, ['--force']);
    expect(r.code).toBe(2);
    expect(updates(home)).toEqual([]);
  });

  it('--check reports a below-floor box and touches nothing (exit 1, no refusal — a measurement)', () => {
    const home = twoBoxFleet('ccrc-rollout-belowfloor-check-');
    plantHost(home, FLEET, { role: 'fleet', version: 'v3.0.0', floor: 'v3.0.0', checkState: 'below-floor' });
    const r = run(home, ['--check']);
    expect(r.code).toBe(1);
    expect(r.stdout).toMatch(/\[below-floor\]/);
    expect(r.stderr).not.toMatch(/pass --downgrade/);
    expect(updates(home)).toEqual([]);
  });

  it('--downgrade passes through to each box\'s update and lets a below-floor box move (M4)', () => {
    const home = twoBoxFleet('ccrc-rollout-downgrade-');
    plantHost(home, FLEET, { role: 'fleet', version: 'v3.0.0', floor: 'v3.0.0', checkState: 'below-floor' });
    const r = run(home, ['--downgrade']);
    expect(r.code, `stderr: ${r.stderr}\nstdout: ${r.stdout}`).toBe(0);
    expect(updates(home)).toEqual([`${FLEET} ccrc update --to v2.0.0 --downgrade`, `${SERVER} ccrc update --to v2.0.0 --downgrade`]);
  });

  // F1 (fix round 1, D-3281): a box CURRENT on the target with a floor
  // ABOVE it (a rolled-back box — W2's `rolledBack`, which `--check` reads
  // `current` for, never `below-floor`) must refuse BEFORE either box moves,
  // exactly like a `below-floor` box — `cmd_update` checks the floor before
  // its converged no-op, so this box's own update would die after the other
  // box had already moved.
  it('a box CURRENT on the target but whose floor is above it (rolled back) refuses at exit 2 before either box moves, --downgrade lets it proceed, --server-first too (D-3281)', () => {
    const home = twoBoxFleet('ccrc-rollout-rolledback-');
    plantHost(home, FLEET, { role: 'fleet', version: 'v2.0.0', floor: 'v3.0.0' });
    let r = run(home);
    expect(r.code, `stderr: ${r.stderr}\nstdout: ${r.stdout}`).toBe(2);
    expect(r.stdout).toMatch(/^rollout: fleet: v2\.0\.0 \(oldsha00\) → v2\.0\.0 \[current\]$/m);
    expect(r.stderr).toMatch(/rollout: the fleet box's floor is v3\.0\.0, above v2\.0\.0 — pass --downgrade to move it down; nothing was touched/);
    expect(updates(home)).toEqual([]);

    r = run(home, ['--downgrade']);
    expect(r.code, `stderr: ${r.stderr}\nstdout: ${r.stdout}`).toBe(0);
    expect(updates(home)).toEqual([`${FLEET} ccrc update --to v2.0.0 --downgrade`, `${SERVER} ccrc update --to v2.0.0 --downgrade`]);

    const home2 = twoBoxFleet('ccrc-rollout-rolledback-serverfirst-');
    plantHost(home2, FLEET, { role: 'fleet', version: 'v2.0.0', floor: 'v3.0.0' });
    r = run(home2, ['--server-first']);
    expect(r.code).toBe(2);
    expect(updates(home2)).toEqual([]);
  });

  it('--allow-unsigned passes through; typed together, the flags ride in one fixed order before --from rollout (M4)', () => {
    let home = twoBoxFleet('ccrc-rollout-unsigned-');
    let r = run(home, ['--allow-unsigned']);
    expect(r.code, r.stderr).toBe(0);
    expect(updates(home)).toEqual([`${FLEET} ccrc update --to v2.0.0 --allow-unsigned`, `${SERVER} ccrc update --to v2.0.0 --allow-unsigned`]);
    home = twoBoxFleet('ccrc-rollout-flag-order-');
    plantHost(home, SERVER, { role: 'server', version: 'v1.0.0', caps: CAPS_W4 });
    r = run(home, ['--allow-unsigned', '--downgrade', '--force']);
    expect(r.code, r.stderr).toBe(0);
    expect(updates(home)).toEqual([
      `${FLEET} ccrc update --to v2.0.0 --force --downgrade --allow-unsigned`,
      `${SERVER} ccrc update --to v2.0.0 --force --downgrade --allow-unsigned --from rollout`,
    ]);
  });

  it('a box whose ~/.ccrc/floor is unreadable or malformed refuses at exit 2 before either box moves — --downgrade does not cure it', () => {
    for (const word of ['malformed', 'unreadable']) {
      const home = twoBoxFleet(`ccrc-rollout-floor-${word}-`);
      plantHost(home, SERVER, { role: 'server', version: 'v1.0.0', floor: word });
      const r = run(home, ['--downgrade']);
      expect(r.code, word).toBe(2);
      expect(r.stderr).toMatch(new RegExp(`the server box's ~/\\.ccrc/floor is ${word} — its update would refuse`));
      expect(updates(home)).toEqual([]);
    }
  });

  it('--check with --downgrade or --allow-unsigned is refused at exit 2 before any ssh (the D-3139 shape)', () => {
    const home = twoBoxFleet('ccrc-rollout-check-flags-');
    let r = run(home, ['--check', '--downgrade']);
    expect(r.code).toBe(2);
    expect(r.stderr).toMatch(/--check and --downgrade are exclusive/);
    r = run(home, ['--check', '--allow-unsigned']);
    expect(r.code).toBe(2);
    expect(r.stderr).toMatch(/--check and --allow-unsigned are exclusive/);
    expect(sshCalls(home)).toEqual([]);
  });
});

describe('ccrc rollout --channel: each box\'s OWN projection names the tag', () => {
  // Plan D-3234: rollout runs from a machine
  // with ssh and no session, so it reads the resolution each box already
  // holds (`ccrc channel`, the box's own reader), never an HTTP route.
  const chan = (o: { state?: string; stable?: string; dev?: string } = {}): string =>
    `channel: state=${o.state ?? 'ok'} channel=stable desired=${o.stable ?? 'none'} desired-stable=${o.stable ?? 'none'} desired-dev=${o.dev ?? 'none'} auto=off`;
  const noDoc = (state: string): string =>
    `channel: state=${state} channel=- desired=- desired-stable=- desired-dev=- auto=-`;
  function chanFleet(prefix: string, fleet: string | undefined, server: string | undefined,
    at: { fleet?: string; server?: string; fleetFloor?: string } = {}): string {
    const home = twoBoxFleet(prefix);
    plantRelease(home, 'v2.1.0', false);
    plantHost(home, FLEET, { role: 'fleet', version: at.fleet ?? 'v1.0.0', floor: at.fleetFloor, channelLine: fleet });
    plantHost(home, SERVER, { role: 'server', version: at.server ?? 'v1.0.0', channelLine: server });
    return home;
  }

  it('both boxes name one stable tag → it is pinned from ITS SHA256SUMS and passed as --to; the projections are read before any --check', () => {
    const home = chanFleet('ccrc-rollout-chan-', chan({ stable: 'v2.1.0' }), chan({ stable: 'v2.1.0' }));
    const r = run(home, ['--channel', 'stable']);
    expect(r.code, `stderr: ${r.stderr}\nstdout: ${r.stdout}`).toBe(0);
    expect(r.stdout).toMatch(/^rollout: channel stable: the control plane resolves v2\.1\.0 \(read from each box's own projection\)$/m);
    expect(readFileSync(join(home, 'curl-argv'), 'utf8').trim()).toBe(`local://${home}/releases/download/v2.1.0/SHA256SUMS`);
    expect(updates(home)).toEqual([`${FLEET} ccrc update --to v2.1.0`, `${SERVER} ccrc update --to v2.1.0`]);
    const calls = sshCalls(home);
    expect(calls.filter((l) => l.endsWith(' ccrc channel'))).toEqual([`${FLEET} ccrc channel`, `${SERVER} ccrc channel`]);
    expect(calls.findIndex((l) => l.endsWith(' ccrc channel'))).toBeLessThan(calls.findIndex((l) => l.includes('--check')));
  });

  it('--channel=dev reads desired-dev; a box answering none is admitted only because its check line reads current on the other\'s tag', () => {
    // The fleet box already runs v2.1.0 (W2's notNewerThanFloor: nothing
    // above its floor), so `none` there is convergence, and its own update
    // leaves it alone.
    const home = chanFleet('ccrc-rollout-chan-dev-', chan({ stable: 'v2.0.0', dev: 'none' }), chan({ stable: 'v2.0.0', dev: 'v2.1.0' }), { fleet: 'v2.1.0' });
    const r = run(home, ['--channel=dev']);
    expect(r.code, `stderr: ${r.stderr}\nstdout: ${r.stdout}`).toBe(0);
    expect(r.stdout).toMatch(/^rollout: fleet: v2\.1\.0 \(oldsha00\) → v2\.1\.0 \[current\]$/m);
    expect(r.stderr).not.toMatch(/resolves no dev target/);
    expect(updates(home)).toEqual([`${FLEET} ccrc update --to v2.1.0`, `${SERVER} ccrc update --to v2.1.0`]);
  });

  it('a box answering none that is NOT already on the other\'s tag refuses at exit 2 before either box moves — rolled back, or the tag refused on provenance; --server-first, --force and --downgrade alike', () => {
    // The line cannot say WHY a box resolves nothing (W2's resolveOnChannel:
    // rolledBack, noEligible over refusedByThisNode, pinnedIneligible,
    // pinnedAtOrBelowFloor, noFloor — or converged). Only its check line on
    // the pinned tag tells convergence from a box the control plane declined
    // to move (D-3234).
    const cases: Array<[string, { fleet?: string; fleetFloor?: string }]> = [
      // rolledBack: the fleet box runs v1.0.0 below its own floor v2.0.0.
      ['rolled-back', { fleet: 'v1.0.0', fleetFloor: 'v2.0.0' }],
      // noEligible: the fleet box refused v2.1.0 on provenance, so it names
      // nothing, while the server box names that very tag.
      ['refused-tag', { fleet: 'v2.0.0' }],
    ];
    for (const [why, at] of cases) {
      for (const extra of [[], ['--server-first'], ['--force'], ['--downgrade']]) {
        const home = chanFleet(`ccrc-rollout-chan-${why}-`, chan({ stable: 'none' }), chan({ stable: 'v2.1.0' }), at);
        const r = run(home, ['--channel', 'stable', ...extra]);
        expect(r.code, `${why} ${extra.join(' ')}\nstderr: ${r.stderr}`).toBe(2);
        expect(r.stderr).toMatch(/rollout: the fleet box's projection resolves no stable target \(desired-stable none; its reason is on the console's update screen\) and it is not already on v2\.1\.0 — nothing was touched/);
        expect(updates(home), `${why} ${extra.join(' ')}`).toEqual([]);
      }
    }
  });

  it('a projection that is not ok|none refuses at exit 2, naming the box and the state — nothing measured, nothing touched', () => {
    for (const st of ['stale', 'unreadable', 'malformed', 'not-configured']) {
      const home = chanFleet(`ccrc-rollout-chan-${st}-`, chan({ stable: 'v2.1.0' }), noDoc(st));
      const r = run(home, ['--channel', 'stable']);
      expect(r.code, st).toBe(2);
      expect(r.stderr).toMatch(new RegExp(`the server box's projection is ${st} — 'ccrc channel' there says why`));
      expect(sshCalls(home).filter((l) => l.includes('--check'))).toEqual([]);
      expect(updates(home)).toEqual([]);
    }
  });

  it('a box whose ccrc predates `ccrc channel` prints no channel line → exit 2 naming it, its own stderr relayed', () => {
    const home = chanFleet('ccrc-rollout-chan-old-', undefined, chan({ stable: 'v2.1.0' }));
    const r = run(home, ['--channel', 'stable']);
    expect(r.code).toBe(2);
    expect(r.stderr).toMatch(/the fleet box printed no channel line \(got: nothing\) — is ccrc new enough to know 'ccrc channel'\? nothing was touched/);
    expect(r.stderr).toMatch(/^fleet: ccrc: unknown argument: channel$/m);
    expect(updates(home)).toEqual([]);
  });

  it('two different tags, no tag at all, or a desired value that is not a tag refuse at exit 2', () => {
    let home = chanFleet('ccrc-rollout-chan-split-', chan({ stable: 'v2.1.0' }), chan({ stable: 'v2.2.0' }));
    let r = run(home, ['--channel', 'stable']);
    expect(r.code).toBe(2);
    expect(r.stderr).toMatch(/the boxes' projections name two stable targets — fleet: v2\.1\.0, server: v2\.2\.0/);
    expect(updates(home)).toEqual([]);
    home = chanFleet('ccrc-rollout-chan-none-', chan(), chan());
    r = run(home, ['--channel', 'stable']);
    expect(r.code).toBe(2);
    expect(r.stderr).toMatch(/the control plane resolves no stable target for either box — nothing was touched/);
    // The value is interpolated into a remote command as --to: shape-checked
    // before it can reach one.
    home = chanFleet('ccrc-rollout-chan-shape-', chan({ stable: 'v2.1.0;echo' }), chan({ stable: 'v2.1.0' }));
    r = run(home, ['--channel', 'stable']);
    expect(r.code).toBe(2);
    expect(r.stderr).toMatch(/names desired-stable=v2\.1\.0;echo, not a release tag or none/);
    expect(sshCalls(home).filter((l) => l.includes(';echo'))).toEqual([]);
  });

  it('--channel with --to, a word that is not stable|dev, or no value is a usage error before any ssh', () => {
    const home = twoBoxFleet('ccrc-rollout-chan-usage-');
    let r = run(home, ['--channel', 'stable', '--to', 'v2.0.0']);
    expect(r.code).toBe(2);
    expect(r.stderr).toMatch(/--channel and --to are exclusive/);
    r = run(home, ['--channel', 'beta']);
    expect(r.code).toBe(2);
    expect(r.stderr).toMatch(/--channel expects stable or dev \(got: beta\)/);
    r = run(home, ['--channel=']);
    expect(r.code).toBe(2);
    expect(r.stderr).toMatch(/--channel expects stable or dev \(got: nothing\)/);
    r = run(home, ['--channel']);
    expect(r.code).toBe(2);
    expect(sshCalls(home)).toEqual([]);
  });
});

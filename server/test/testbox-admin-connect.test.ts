// D-8166 (plan docs/superpowers/plans/2026-11-10-test-box-connect.md, Task TC7; spec §2.2 steps 4 and 5, §2.4 steps 2 to 5,
// §2.5, §5.1, C12, T5, T6): `ccrc testbox-admin connect`, the long act.
//
// What is held here: that the act runs its six phases in order, with their milliseconds, and ends connected; that a
// provenance refusal ends at `verify` before any ssh ran; that a MANIFEST mismatch on the box ends at `copy`; that a box
// value the box file cannot hold, and a ccrc.env that already names a pairing key, are refused before the act starts and
// write nothing; that the token reaches the box on ssh stdin and never in argv, and the fleet host's file is 0600 by a temp
// and a rename; that the push key is create-only and only its public half leaves the fleet host; that the four pairing keys
// land in the overlay while ccrc.env stays byte-identical; that the installer's refused and failed lines end at `install`;
// that the act ends ok only when the status reads ok or degraded; that a read of the state mid-act gives the phase a
// reload would; that Try again re-runs from `verify`; that the act runs in a detached unit under the lock; and that no
// secret reaches the state file, the log, stdout or the fake ssh's argv.
//
// The act runs in this process as the unit would (the parent detaches into a stubbed `systemd-run`, then the unit half is
// called with the act id). The fake `ssh` answers from a rule file and keeps every call's stdin; `_upd_resolve` and
// `_upd_fetch` are replaced by two stand-ins here (the update lane's own tests hold their checks; this file holds that the
// act runs them in a subshell, that a die there ends at `verify`, and that nothing reaches the box before they pass).
// HOME is a fixture; ghContainedEnv poisons the user manager and tmux. Every row runs a fixed bash program; values are
// its arguments.
import { describe, it, expect } from 'vitest';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import path, { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkTmp, removeTmpFixturesEachTest } from './tmpHelpers.js';
import { ghContainedEnv } from './ccdWsHelpers.js';
import { readTestboxAdminStatus } from '../../shared/testbox-admin.js';

removeTmpFixturesEachTest();

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const VERB = join(REPO, 'ccd', 'ccrc-testbox-admin');
const BOXFAKE = join(REPO, 'server', 'test', 'fixtures', 'testbox-admin-connect-ssh.sh');
const BASH = spawnSync('bash', ['-c', 'command -v bash'], { encoding: 'utf8' }).stdout.trim();
const HAS_KEYGEN = spawnSync('bash', ['-c', 'command -v ssh-keygen'], { encoding: 'utf8' }).status === 0;
const HAS_FLOCK = spawnSync('bash', ['-c', 'command -v flock'], { encoding: 'utf8' }).status === 0;
const HAS_NODE = spawnSync('bash', ['-c', 'command -v node'], { encoding: 'utf8' }).status === 0;
const ADDR = '203.0.113.9';
const SRC_ADDR = '192.0.2.5';
const STG = '/tmp/ccrc-stg.AbC123';
// The OS is forced to linux for the verb's own gate; the two platform helpers the act reads (a file's mode, a digest) keep
// the userland's real answer, so the suite runs on both.
const SRC = '. "$1" || exit 90; shift; REAL_OS=$CCD_OS; CCD_OS=linux; '
  + 'for f in _plat_mode _plat_sha256; do eval "$(declare -f $f | sed "1s/^$f/${f}_real/")"; eval "$f() { local CCD_OS=\\$REAL_OS; ${f}_real \\"\\$@\\"; }"; done; ';
const b64url = (s: string): string => Buffer.from(s).toString('base64url');
const ROW = {
  name: 'project-a', fetchUrl: 'https://testbox.invalid/project-a.git', mirrorPath: '/srv/mirror/project-a.git',
  packages: [{ name: 'server', installInputs: ['server/package.json'], commands: ['./node_modules/.bin/vitest'] }],
  buildOutputs: [], systemTools: [],
};
const rowArg = (row: unknown): string => b64url(JSON.stringify(row));
const sha256 = (b: Buffer | string): string => createHash('sha256').update(b).digest('hex');

/** The words of a connect: a listen address (an IP literal), two paths, one row. */
const WORDS = (extra: string[] = []): string[] => [
  '--set=CCRC_TESTBOX_LISTEN=198.51.100.7:7443', '--set=CCRC_TESTBOX_ROOT=/srv/box', '--set=CCRC_TESTBOX_TOOLS_DIR=/opt/tools',
  `--repo=${rowArg(ROW)}`, ...extra,
];

/** Rules of a box on which every connect command succeeds, as the fake ssh reads them: regex, exit code, stdout. */
const PASSING_RULES: string[][] = [
  ['install\\.sh', '0', 'ccrc-testbox-install: installed\\n'],
  ['^(sudo -n -- )?mktemp -d$', '0', `${STG}\\n`],
  ['^(sudo -n -- )?tar -xzf', '0', ''],
  ['sha256sum.*-c.*MANIFEST', '0', ''],
  ['/etc/ccrc-testbox/ccrc\\.env', '0', ''],
  ['rows', '0', ''],
  ['push\\.pub', '0', ''],
  ['/dev/stdin', '0', ''],
  ['systemctl restart ccrc-testbox\\.service', '0', ''],
  ['rm -rf', '0', ''],
];

interface Home {
  home: string; env: NodeJS.ProcessEnv; log: string; state: string; key: string; pin: string; rules: string; stdin: string;
  overlay: string; ccrcEnv: string; token: string; push: string; lg: string; api: string;
}

function fixture(extra: NodeJS.ProcessEnv = {}, rules: string[][] = PASSING_RULES): Home {
  const home = mkTmp('tb-connect-');
  mkdirSync(join(home, '.ccrc'), { recursive: true });
  mkdirSync(join(home, 'tmp'), { recursive: true });
  const fakes = join(home, 'fakes');
  mkdirSync(fakes, { recursive: true });
  symlinkSync(BOXFAKE, join(fakes, 'ssh'));
  symlinkSync(BOXFAKE, join(fakes, 'ip'));
  const rulesFile = join(home, 'rules');
  writeFileSync(rulesFile, rules.map((r) => r.join('\t')).join('\n') + '\n');
  writeFileSync(join(home, 'os-release'), 'ID=debian\nVERSION_ID="12"\n');
  writeFileSync(join(home, '.ccrc', 'build.json'), JSON.stringify({ sha: 'a'.repeat(40), ref: 'main', builtAt: '2026-11-10T10:00:00Z', dirty: false, version: 'v1.2.3' }));
  const api = join(home, 'ccrc-api-fake');
  writeFileSync(api, '#!/bin/sh\nprintf \'%s\\n\' "${FAKE_API_OUT:-{\\"state\\":\\"ok\\",\\"reasons\\":[]}}"\n', { mode: 0o755 });
  const base: NodeJS.ProcessEnv = {};
  for (const [k, v] of Object.entries(process.env)) if (!k.startsWith('CCRC_') && !k.startsWith('TB_') && !k.startsWith('FAKE_') && !k.startsWith('TBA_')) base[k] = v;
  Object.assign(base, {
    HOME: home, TMPDIR: join(home, 'tmp'), LANG: 'C', PATH: `${fakes}:${process.env['PATH'] ?? '/usr/bin:/bin'}`,
    FAKE_LOG: join(home, 'fake-log'), FAKE_RULES: rulesFile, FAKE_STDIN_DIR: join(home, 'stdin'), FAKE_IP_OUT: `${ADDR} dev eth0 src ${SRC_ADDR} uid 0`,
    TBA_OS_RELEASE: join(home, 'os-release'), TBA_API: api, TBA_CHECK_DEADLINE: '0', SYSTEMD_RUN_RC: '0', ...extra,
  });
  return {
    home, env: ghContainedEnv(home, base, { systemd: true, tmux: true }), log: join(home, 'fake-log'), rules: rulesFile, stdin: join(home, 'stdin'), api,
    state: join(home, '.ccrc', 'testbox-admin.state'), key: join(home, '.ccrc', 'testbox-admin.key'), pin: join(home, '.ccrc', 'testbox-known-hosts'),
    overlay: join(home, '.ccrc', 'testbox.env'), ccrcEnv: join(home, '.ccrc', 'ccrc.env'), token: join(home, '.ccrc', 'testbox.token'),
    push: join(home, '.ccrc', 'testbox-push.key'), lg: join(home, '.ccrc', 'testbox-admin.log'),
  };
}

function sh(h: Home, program: string, args: string[] = []): { out: string; err: string; rc: number } {
  const r = spawnSync(BASH, ['-c', program, '_', ...args], { env: h.env, encoding: 'utf8', cwd: h.home });
  return { out: r.stdout ?? '', err: r.stderr ?? '', rc: r.status ?? -1 };
}
function verb(h: Home, ...args: string[]): { out: string; err: string; rc: number } {
  return sh(h, SRC + '_tba_main "$@"', [VERB, ...args]);
}
function json(r: { out: string }): Record<string, unknown> {
  expect(r.out.trim().split('\n')).toHaveLength(1);
  return JSON.parse(r.out) as Record<string, unknown>;
}
function setRules(h: Home, rules: string[][]): void { writeFileSync(h.rules, rules.map((r) => r.join('\t')).join('\n') + '\n'); }
/** The passing rules with one regex answering otherwise (put first, so it wins). */
const WITH = (rule: string[]): string[][] => [rule, ...PASSING_RULES];
function fakeCalls(h: Home): string[][] {
  if (!existsSync(h.log)) return [];
  const calls: string[][] = [];
  for (const l of readFileSync(h.log, 'utf8').split('\n')) {
    if (l.startsWith('-- ')) calls.push([l.slice(3)]);
    else if (l !== '' && calls.length > 0) calls[calls.length - 1]!.push(l);
  }
  return calls;
}
const sshCalls = (h: Home): string[][] => fakeCalls(h).filter((c) => c[0] === 'ssh');
/** The stdin of the ssh call whose command contains the text (the command is the call's last argument before its <stdin> line). */
function stdinOf(h: Home, needle: string): string | null {
  const calls = sshCalls(h);
  for (let i = 0; i < calls.length; i++) {
    const args = calls[i]!.filter((l) => !l.startsWith('<stdin'));
    if (args[args.length - 1]!.includes(needle)) {
      const f = join(h.stdin, String(i + 1));
      return existsSync(f) ? readFileSync(f, 'utf8') : null;
    }
  }
  return null;
}
/** The remote command as the box's shell reads it: the verb quotes each word with `printf %q`, so a backslash escapes the next byte. */
const cmdOf = (c: string[]): string => (c.filter((l) => !l.startsWith('<stdin')).slice(-1)[0] ?? '').replace(/\\(.)/g, '$1');

/** Make the access key and the pin the way an earlier step would have. */
function connectedTo(h: Home): void {
  const g = verb(h, 'key', `--address=${ADDR}`);
  expect(json(g)['ok'], g.out + g.err).toBe(true);
  writeFileSync(h.pin, `${ADDR} ssh-ed25519 AAAA\n`, { mode: 0o600 });
}

const STUBS = `_upd_resolve() { UPD_STAGE="$HOME/stage"; mkdir -p "$UPD_STAGE"; UPD_TARNAME=ccrc-v1.2.3.tar.gz; UPD_VERSION=v1.2.3; echo "$1" >"$HOME/resolved-tag"; return 0; }; `
  + `_upd_fetch() { printf 'TARBALL-BYTES' >"$UPD_STAGE/$UPD_TARNAME"; }; `;
const REFUSING_FETCH = `_upd_fetch() { echo 'connect: provenance verification FAILED' >&2; exit 1; }; `;

/** The parent detaches, then the unit half runs here with the act id, as the unit would. Returns the id and the unit's rc. */
function act(h: Home, words: string[], stubs = STUBS): { id: string; out: string; err: string; rc: number } {
  const r = sh(h, SRC + stubs
    + 'id="$(_tba_main connect "$@" --from pwa | sed -n \'s/.*"act":"\\([0-9a-f]*\\)".*/\\1/p\')"; echo "$id"; '
    + '[ -n "$id" ] || exit 91; CCRC_TBA_ACT="$id" _tba_main connect >"$HOME/unit-out" 2>"$HOME/unit-err"; echo "rc=$?"', [VERB, ...words]);
  const [id = '', rc = ''] = r.out.trim().split('\n');
  return { id, out: r.out, err: r.err, rc: rc === 'rc=0' ? 0 : -1 };
}
function status(h: Home): ReturnType<typeof readTestboxAdminStatus> {
  const r = spawnSync(BASH, [VERB, 'status'], { env: h.env, encoding: 'utf8', cwd: h.home });
  return readTestboxAdminStatus((r.stdout ?? '').trim());
}
function lastAct(h: Home): NonNullable<Extract<ReturnType<typeof status>, { ok: true }>['value']['act']> {
  const s = status(h);
  expect(s.ok, JSON.stringify(s)).toBe(true);
  if (!s.ok) throw new Error('unreachable');
  expect(s.value.act).not.toBeNull();
  return s.value.act!;
}

describe.skipIf(!HAS_KEYGEN || !HAS_FLOCK || !HAS_NODE)('ccrc testbox-admin connect (D-8166, TC7)', () => {
  it('connect writes the six phases in order with their ms and ends connected', () => {
    const h = fixture();
    connectedTo(h);
    const a = act(h, WORDS());
    expect(a.rc, a.out + a.err).toBe(0);
    const act1 = lastAct(h);
    expect(act1).toMatchObject({ sub: 'connect', outcome: 'ok', code: null, phase: 'check' });
    expect(act1.phases.map((p) => p.name)).toEqual(['verify', 'copy', 'settings', 'install', 'pair', 'check']);
    expect(act1.phases.every((p) => Number.isInteger(p.ms) && p.ms >= 0)).toBe(true);
    const s = status(h);
    expect(s.ok && s.value.connected).toBe(true);
    const box = stdinOf(h, '/etc/ccrc-testbox/ccrc.env')!;
    expect(box).toContain('CCRC_TESTBOX_LISTEN=198.51.100.7:7443\n');
    expect(s.ok && s.value.boxFileSha256).toBe(sha256(box));
    // the fleet host's own tag was resolved, and the installer ran from the staging tree with it
    expect(readFileSync(join(h.home, 'resolved-tag'), 'utf8').trim()).toBe('v1.2.3');
    const inst = sshCalls(h).map(cmdOf).find((c) => c.includes('install.sh'))!;
    expect(inst).toContain(`${STG}/deploy/testbox/install.sh`);
    expect(inst).toMatch(/--release v1\.2\.3 --node \d+\.\d+\.\d+ --repos /);
    expect(inst).toContain(`${STG}/rows/project-a.json`);
    expect(inst).toContain('--distro debian-12');
    expect(inst).toContain(`--push-key ${STG}/push.pub`);
    // the tarball went to the box on stdin, and the staging directory was removed at the end
    expect(stdinOf(h, 'tar -xzf')).toBe('TARBALL-BYTES');
    const seq = sshCalls(h).map(cmdOf);
    expect(seq.findIndex((c) => c.includes(`rm -rf -- ${STG}`))).toBeGreaterThan(seq.findIndex((c) => c.includes('install.sh')));
    // and only the check phase's read of the box's own settings (TC8) follows it
    expect(seq.slice(seq.findIndex((c) => c.includes(`rm -rf -- ${STG}`)) + 1).every((c) => c.includes('--testbox-knobs') || c.includes('sha256sum'))).toBe(true);
    expect(JSON.parse(stdinOf(h, 'rows')!).name).toBe('project-a');
  });

  it('a provenance refusal ends at verify with verify-failed and no ssh ran', () => {
    const h = fixture();
    connectedTo(h);
    const before = sshCalls(h).length;
    const a = act(h, WORDS(), STUBS + REFUSING_FETCH);
    expect(a.id).toMatch(/^[0-9a-f]{32}$/);
    expect(lastAct(h)).toMatchObject({ outcome: 'failed', code: 'verify-failed', phase: 'verify' });
    expect(sshCalls(h).length).toBe(before);
    expect(existsSync(join(h.home, 'stdin'))).toBe(false);
    const s = status(h);
    expect(s.ok && s.value.connected).toBe(false);
  });

  it('a MANIFEST mismatch on the box ends at copy with copy-failed', () => {
    const h = fixture({}, WITH(['sha256sum.*-c.*MANIFEST', '1', '']));
    connectedTo(h);
    act(h, WORDS());
    expect(lastAct(h)).toMatchObject({ outcome: 'failed', code: 'copy-failed', phase: 'copy' });
    expect(sshCalls(h).map(cmdOf).some((c) => c.includes('install.sh'))).toBe(false);
    // the staging directory is still removed
    expect(sshCalls(h).map(cmdOf).slice(-1)[0]).toContain('rm -rf');
  });

  it('a box value off its shape is refused before the act starts, and nothing is written', () => {
    const h = fixture();
    connectedTo(h);
    // no listen address: the box file cannot be loaded (the installer would refuse it too)
    const r = verb(h, 'connect', '--set=CCRC_TESTBOX_ROOT=/srv/box', `--repo=${rowArg(ROW)}`, '--from', 'pwa');
    expect(json(r)).toEqual({ ok: false, code: 'box-value-refused' });
    // a repeated row name
    const d = verb(h, 'connect', ...WORDS([`--repo=${rowArg(ROW)}`]), '--from', 'pwa');
    expect(json(d)).toEqual({ ok: false, code: 'box-value-refused' });
    expect(readFileSync(h.state, 'utf8')).not.toContain('act_id=');
    expect(readdirSync(join(h.home, '.ccrc')).filter((n) => n.startsWith('testbox-admin.args.'))).toEqual([]);
    expect(existsSync(join(h.home, 'systemd-run-calls'))).toBe(false);
    expect(sshCalls(h)).toEqual([]);
  });

  it('connect without a pin or a connection answers not-connected', () => {
    const h = fixture();
    expect(json(verb(h, 'connect', ...WORDS(), '--from', 'pwa'))).toEqual({ ok: false, code: 'not-connected' });
    const g = verb(h, 'key', `--address=${ADDR}`);
    expect(json(g)['ok']).toBe(true);
    expect(json(verb(h, 'connect', ...WORDS(), '--from', 'pwa'))).toEqual({ ok: false, code: 'not-connected' });
  });

  it('connect refuses pairing-keys-in-ccrc-env naming the keys and writes nothing', () => {
    const h = fixture();
    connectedTo(h);
    writeFileSync(h.ccrcEnv, 'CCRC_PORT=8800\nCCRC_TESTBOX_URL=http://x.invalid:1\nCCRC_TESTBOX_GIT_KEY=\n');
    const before = readFileSync(h.ccrcEnv);
    const r = verb(h, 'connect', ...WORDS(), '--from', 'pwa');
    expect(json(r)).toEqual({ ok: false, code: 'pairing-keys-in-ccrc-env', keys: ['CCRC_TESTBOX_URL', 'CCRC_TESTBOX_GIT_KEY'] });
    expect(readFileSync(h.ccrcEnv).equals(before)).toBe(true);
    expect(existsSync(h.overlay)).toBe(false);
    expect(readFileSync(h.state, 'utf8')).not.toContain('act_id=');
    expect(sshCalls(h)).toEqual([]);
    expect(existsSync(h.push)).toBe(false);
  });

  it('the token reaches the box on ssh stdin and never in argv', () => {
    const h = fixture();
    connectedTo(h);
    act(h, WORDS());
    expect(lastAct(h).outcome).toBe('ok');
    const tok = readFileSync(h.token, 'utf8');
    expect(tok).toMatch(/^[0-9a-f]{64}$/);
    expect(stdinOf(h, '/dev/stdin')).toBe(tok);
    expect(readFileSync(h.log, 'utf8')).not.toContain(tok);
    const cmd = sshCalls(h).map(cmdOf).find((c) => c.includes('/dev/stdin'))!;
    expect(cmd).toContain('install -m 0600 -o');
    expect(cmd).toContain('ccrc-tb-svc');
    expect(sshCalls(h).map(cmdOf).some((c) => c.includes('systemctl restart ccrc-testbox.service'))).toBe(true);
  });

  it('the token file is 0600 by a temp and a rename', () => {
    const h = fixture();
    connectedTo(h);
    act(h, WORDS());
    expect(statSync(h.token).mode & 0o777).toBe(0o600);
    expect(readdirSync(join(h.home, '.ccrc')).filter((n) => n.includes('.tmp.'))).toEqual([]);
    // a second run replaces it whole with a fresh token (each phase is idempotent)
    const first = readFileSync(h.token, 'utf8');
    act(h, WORDS());
    expect(readFileSync(h.token, 'utf8')).toMatch(/^[0-9a-f]{64}$/);
    expect(readFileSync(h.token, 'utf8')).not.toBe(first);
  });

  it('the push key is create-only and only its public half leaves the fleet host', () => {
    const h = fixture();
    connectedTo(h);
    const g = spawnSync('ssh-keygen', ['-q', '-t', 'ed25519', '-N', '', '-C', 'ccrc-testbox-push', '-f', h.push], { encoding: 'utf8' });
    expect(g.status, g.stderr).toBe(0);
    const before = readFileSync(h.push);
    const pub = spawnSync('ssh-keygen', ['-y', '-f', h.push], { encoding: 'utf8' }).stdout.trim().split(' ').slice(0, 2).join(' ');
    act(h, WORDS());
    expect(lastAct(h).outcome).toBe('ok');
    expect(readFileSync(h.push).equals(before)).toBe(true);
    expect(statSync(h.push).mode & 0o777).toBe(0o600);
    expect(stdinOf(h, 'push.pub')).toBe(`${pub} ccrc-testbox-push\n`);
    const private64 = readFileSync(h.push, 'utf8').split('\n').filter((l) => l !== '' && !l.startsWith('-----')).join('');
    for (const f of readdirSync(h.stdin)) expect(readFileSync(join(h.stdin, f), 'utf8')).not.toContain(private64.slice(0, 40));
    expect(readFileSync(h.log, 'utf8')).not.toContain(private64.slice(0, 40));
  });

  it('a push key that does not exist is made once at 0600 and then kept', () => {
    const h = fixture();
    connectedTo(h);
    act(h, WORDS());
    expect(statSync(h.push).mode & 0o777).toBe(0o600);
    expect(readFileSync(h.push, 'utf8')).toContain('OPENSSH PRIVATE KEY');
    const first = readFileSync(h.push);
    act(h, WORDS());
    expect(readFileSync(h.push).equals(first)).toBe(true);
    expect(readdirSync(join(h.home, '.ccrc')).filter((n) => n.startsWith('pushkey.'))).toEqual([]);
  });

  it('the four pairing keys land in testbox.env and ccrc.env is byte-identical', () => {
    const h = fixture();
    connectedTo(h);
    writeFileSync(h.ccrcEnv, '# the operator\'s\nCCRC_PORT=8800\nCCRC_TESTBOX_BUDGET=20m\n');
    const before = readFileSync(h.ccrcEnv);
    act(h, WORDS());
    expect(lastAct(h).outcome).toBe('ok');
    expect(readFileSync(h.ccrcEnv).equals(before)).toBe(true);
    const lines = readFileSync(h.overlay, 'utf8').trim().split('\n').sort();
    expect(lines).toEqual([
      'CCRC_TESTBOX_GIT_KEY=~/.ccrc/testbox-push.key',
      `CCRC_TESTBOX_GIT_URL_BASE=ssh://ccrc-tb-push@${ADDR}:22/`,
      'CCRC_TESTBOX_TOKEN_FILE=~/.ccrc/testbox.token',
      `CCRC_TESTBOX_URL=http://${ADDR}:7443`,
    ]);
    expect(statSync(h.overlay).mode & 0o777).toBe(0o600);
    // the reader sees them through the one reader
    const r = sh(h, SRC + '_ccrc_knob CCRC_TESTBOX_URL "" file; echo "$KNOB"', [VERB]);
    expect(r.out.trim()).toBe(`http://${ADDR}:7443`);
  });

  it('an IPv6 address is bracketed in the URL and the git base', () => {
    const h = fixture({ FAKE_IP_OUT: '2001:db8::9 dev eth0 src 2001:db8::5 uid 0' });
    const g = verb(h, 'key', '--address=2001:db8::9');
    expect(json(g)['ok'], g.out).toBe(true);
    writeFileSync(h.pin, '2001:db8::9 ssh-ed25519 AAAA\n', { mode: 0o600 });
    act(h, WORDS());
    expect(lastAct(h).outcome).toBe('ok');
    const o = readFileSync(h.overlay, 'utf8');
    expect(o).toContain('CCRC_TESTBOX_URL=http://[2001:db8::9]:7443\n');
    expect(o).toContain('CCRC_TESTBOX_GIT_URL_BASE=ssh://ccrc-tb-push@[2001:db8::9]:22/\n');
  });

  it('an installer refused line ends at install with install-refused, and the line stays in the fleet-side log', () => {
    const line = 'ccrc-testbox-install: refused: /srv is not on XFS with reflink=1; nothing was written';
    const h = fixture({}, WITH(['install\\.sh', '1', `${line}\\n`]));
    connectedTo(h);
    act(h, WORDS());
    expect(lastAct(h)).toMatchObject({ outcome: 'failed', code: 'install-refused', phase: 'install' });
    expect(readFileSync(h.lg, 'utf8')).toContain(line);
    expect(statSync(h.lg).mode & 0o777).toBe(0o600);
    // the answer carries the code, never the line
    expect(readFileSync(h.state, 'utf8')).not.toContain('XFS');
    expect(existsSync(h.token)).toBe(false);
    // and a failed line is install-failed
    setRules(h, WITH(['install\\.sh', '1', 'ccrc-testbox-install: failed: cannot start the test service\\n']));
    act(h, WORDS());
    expect(lastAct(h)).toMatchObject({ outcome: 'failed', code: 'install-failed', phase: 'install' });
  });

  it('a lost link in a phase ends with ssh\'s own code, not the phase\'s', () => {
    const h = fixture({ FAKE_SSH_RC_UNUSED: '1' }, WITH(['^(sudo -n -- )?mktemp -d$', '255', '']));
    connectedTo(h);
    act(h, WORDS());
    expect(lastAct(h)).toMatchObject({ outcome: 'failed', code: 'unreachable', phase: 'copy' });
  });

  it('the act ends ok only when the status reads ok or degraded', () => {
    const h = fixture({ FAKE_API_OUT: '{"state":"unreachable","reasons":["agent has no testbox op"]}' });
    connectedTo(h);
    act(h, WORDS());
    expect(lastAct(h)).toMatchObject({ outcome: 'failed', code: 'status-not-ok', phase: 'check' });
    const s = status(h);
    expect(s.ok && s.value.connected).toBe(false);
    const d = fixture({ FAKE_API_OUT: '{"state":"degraded","reasons":["tool sync in progress"]}' });
    connectedTo(d);
    act(d, WORDS());
    expect(lastAct(d)).toMatchObject({ outcome: 'ok', code: null });
    const down = fixture({ FAKE_API_OUT: '{"state":"down","reasons":["x"]}' });
    connectedTo(down);
    act(down, WORDS());
    expect(lastAct(down)).toMatchObject({ outcome: 'failed', code: 'status-not-ok' });
  });

  it('a read of the state file mid-act gives the same phase a reload would', () => {
    const h = fixture({ FAKE_HOOK_RE: 'install\\.sh', FAKE_HOOK: `bash "${VERB}" status >"$HOME/mid-status.json"` });
    connectedTo(h);
    act(h, WORDS());
    const mid = readTestboxAdminStatus(readFileSync(join(h.home, 'mid-status.json'), 'utf8').trim());
    expect(mid.ok, JSON.stringify(mid)).toBe(true);
    if (!mid.ok) return;
    expect(mid.value.act).toMatchObject({ sub: 'connect', outcome: 'running', phase: 'install', code: null, endedAt: null });
    expect(mid.value.act!.phases.map((p) => p.name)).toEqual(['verify', 'copy', 'settings']);
    expect(mid.value.connected).toBe(false);
  });

  it('try again after a failure re-runs from verify and ends connected', () => {
    const h = fixture({}, WITH(['install\\.sh', '1', 'ccrc-testbox-install: failed: cannot start the test service\\n']));
    connectedTo(h);
    act(h, WORDS());
    expect(lastAct(h)).toMatchObject({ outcome: 'failed', code: 'install-failed' });
    setRules(h, PASSING_RULES);
    act(h, WORDS());
    const second = lastAct(h);
    expect(second).toMatchObject({ outcome: 'ok', code: null });
    expect(second.phases.map((p) => p.name)).toEqual(['verify', 'copy', 'settings', 'install', 'pair', 'check']);
    const s = status(h);
    expect(s.ok && s.value.connected).toBe(true);
  });

  it('the act runs in a detached unit under the lock', () => {
    const h = fixture({ FAKE_HOOK_RE: 'install\\.sh', FAKE_HOOK: `flock -n "$HOME/.ccrc/testbox-admin.lock" true && echo free >"$HOME/lock-seen" || echo held >"$HOME/lock-seen"` });
    connectedTo(h);
    const r = sh(h, SRC + STUBS + '_tba_main connect "$@" --from pwa; echo "rc=$?"', [VERB, ...WORDS()]);
    const m = /^\{"ok":true,"act":"([0-9a-f]{32})"\}\nrc=0\n$/.exec(r.out);
    expect(m, r.out + r.err).not.toBeNull();
    const id = m![1]!;
    // the parent started one unit named for the act, and nothing has run on the box yet
    const calls = readFileSync(join(h.home, 'systemd-run-calls'), 'utf8').trim().split('\n');
    expect(calls).toEqual([`--user --collect --quiet --unit=ccrc-testbox-admin-connect-${id} /usr/bin/env CCRC_TBA_ACT=${id} ${h.home}/.local/bin/ccrc testbox-admin connect`]);
    expect(sshCalls(h)).toEqual([]);
    expect(lastAct(h)).toMatchObject({ id, outcome: 'running' });
    // the checked words reach the unit by file and are read once
    expect(readFileSync(join(h.home, '.ccrc', `testbox-admin.args.${id}`), 'utf8')).toContain('--set=CCRC_TESTBOX_LISTEN=198.51.100.7:7443\n');
    const u = sh(h, SRC + STUBS + `CCRC_TBA_ACT=${id} _tba_main connect >/dev/null; echo "rc=$?"`, [VERB]);
    expect(u.out.trim(), u.err).toBe('rc=0');
    expect(readFileSync(join(h.home, 'lock-seen'), 'utf8').trim()).toBe('held');
    expect(lastAct(h)).toMatchObject({ id, outcome: 'ok' });
    expect(existsSync(join(h.home, '.ccrc', `testbox-admin.args.${id}`))).toBe(false);
    // the lock is free again
    expect(spawnSync('flock', ['-n', join(h.home, '.ccrc', 'testbox-admin.lock'), 'true']).status).toBe(0);
  });

  it('no secret appears in the state file, the log or stdout', () => {
    const h = fixture();
    connectedTo(h);
    const a = act(h, WORDS());
    expect(lastAct(h).outcome).toBe('ok');
    const tok = readFileSync(h.token, 'utf8');
    const body = (f: string): string => readFileSync(f, 'utf8').split('\n').filter((l) => l !== '' && !l.startsWith('-----')).join('').slice(0, 40);
    const secrets = [tok, body(h.push), body(h.key)];
    const seen = [readFileSync(h.state, 'utf8'), a.out + a.err, readFileSync(join(h.home, 'unit-out'), 'utf8'), readFileSync(join(h.home, 'unit-err'), 'utf8'),
      readFileSync(h.log, 'utf8'), existsSync(h.lg) ? readFileSync(h.lg, 'utf8') : '', JSON.stringify(status(h))];
    for (const s of secrets) {
      expect(s.length).toBeGreaterThan(20);
      for (const text of seen) expect(text).not.toContain(s);
    }
  });
});

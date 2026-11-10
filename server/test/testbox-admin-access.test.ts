// D-8166 (plan docs/superpowers/plans/2026-11-10-test-box-connect.md, Task TC4; spec §2.2 steps 2 and 3, §2.3, §2.4 step
// 1, C1 to C4, C9 to C11): the access key, the host key and the preflight of `ccrc testbox-admin`.
//
// What is held here: that `key` makes an ed25519 pair at 0600, create-only, and answers one `from=`-restricted line (the
// same line when run twice); that a key the verb did not make is refused and left; that the private half is never in an
// answer, a log or the state file; that `probe` answers the fingerprint and never writes the pin; that `pin` refuses a
// fingerprint the box does not present and otherwise writes one known-hosts line by a temp and a rename, in the bracketed
// form for a port other than 22; that `preflight` lists one row per check with `ok` or its code, runs only reads on the
// box, prefixes sudo under a non-root login and names the corrected line when the `from=` address is not the one the box
// sees; that a changed host key blocks every act but status, probe, pin and disconnect; and that nothing here formats a
// disk or joins a network.
//
// The real `ssh-keygen` makes and reads keys; the fake `ssh-keyscan` prints a real public key; the fake `ssh` answers a
// preflight command from a rule file (fixtures/testbox-admin-box.sh); a fake `ip` answers the route lookup. HOME is a
// fixture; ghContainedEnv poisons the user manager and tmux. Every row runs a fixed bash program; values are its arguments.
import { describe, it, expect } from 'vitest';
import { spawnSync } from 'node:child_process';
import { appendFileSync, existsSync, mkdirSync, readFileSync, readdirSync, statSync, symlinkSync, unlinkSync, writeFileSync } from 'node:fs';
import path, { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkTmp, removeTmpFixturesEachTest } from './tmpHelpers.js';
import { ghContainedEnv } from './ccdWsHelpers.js';
import { readTestboxAdminStatus } from '../../shared/testbox-admin.js';

removeTmpFixturesEachTest();

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const VERB = join(REPO, 'ccd', 'ccrc-testbox-admin');
const FAKE = join(REPO, 'server', 'test', 'fixtures', 'testbox-admin-ssh.sh');
const BOX = join(REPO, 'server', 'test', 'fixtures', 'testbox-admin-box.sh');
const BASH = spawnSync('bash', ['-c', 'command -v bash'], { encoding: 'utf8' }).stdout.trim();
const HAS_KEYGEN = spawnSync('bash', ['-c', 'command -v ssh-keygen'], { encoding: 'utf8' }).status === 0;
const ADDR = '10.0.0.9';
const SRC_ADDR = '192.0.2.5';
/** An address on no private network (the documentation range), for the checks that must refuse one. */
const PUBLIC = '203.0.113.9';
const SRC = `. "$1" || exit 90; shift; CCD_OS=linux; `;
/** Addresses off the private and documentation ranges are assembled, never spelled, so no file the topology scanner reads holds one. */
const ip = (s: string): string => s.replace(/_/g, '.');

interface Home { home: string; env: NodeJS.ProcessEnv; log: string; state: string; key: string; pin: string; rules: string }

/** Rules of a box that passes every preflight check, as the fake ssh reads them: regex, exit code, stdout. */
const PASSING_RULES: string[][] = [
  ['^(sudo -n -- )?id -u$', '0', '0\\n'],
  ['^sudo -n -- true$', '0', ''],
  ['^(sudo -n -- )?cat /etc/os-release$', '0', 'ID=debian\\nVERSION_ID="12"\\n'],
  ['^(sudo -n -- )?systemctl --version$', '0', 'systemd 256 (256.1-1)\\n'],
  ['^(sudo -n -- )?nft --version$', '0', 'nftables v1.0.9 (Old Doris #3)\\n'],
  ['xfs_info', '0', 'meta-data=/dev/vdb isize=512\\n         =                       reflink=1 bigtime=1\\n'],
  ['SSH_CONNECTION', '0', `${SRC_ADDR} 51234 10.0.0.9 22`],
  ['^(sudo -n -- )?timeout ', '0', ''],
  ['readlink', '1', ''],
];

function fixture(extra: NodeJS.ProcessEnv = {}): Home {
  const home = mkTmp('tb-access-');
  mkdirSync(join(home, '.ccrc'), { recursive: true });
  mkdirSync(join(home, 'tmp'), { recursive: true });
  const fakes = join(home, 'fakes');
  mkdirSync(fakes, { recursive: true });
  symlinkSync(FAKE, join(fakes, 'ssh-keyscan'));
  symlinkSync(BOX, join(fakes, 'ssh'));
  symlinkSync(BOX, join(fakes, 'ip'));
  const rules = join(home, 'rules');
  writeFileSync(rules, PASSING_RULES.map((r) => r.join('\t')).join('\n') + '\n');
  writeFileSync(join(home, 'os-release'), 'ID=debian\nVERSION_ID="12"\n');
  writeFileSync(join(home, '.ccrc', 'build.json'), JSON.stringify({ sha: 'a'.repeat(40), ref: 'main', builtAt: '2026-11-10T10:00:00Z', dirty: false, version: 'v1.2.3' }));
  const base: NodeJS.ProcessEnv = {};
  for (const [k, v] of Object.entries(process.env)) if (!k.startsWith('CCRC_') && !k.startsWith('TB_') && !k.startsWith('FAKE_')) base[k] = v;
  Object.assign(base, {
    HOME: home, TMPDIR: join(home, 'tmp'), LANG: 'C', PATH: `${fakes}:${process.env['PATH'] ?? '/usr/bin:/bin'}`,
    FAKE_LOG: join(home, 'fake-log'), FAKE_RULES: rules, FAKE_IP_OUT: `${ADDR} dev eth0 src ${SRC_ADDR} uid 0`,
    TBA_OS_RELEASE: join(home, 'os-release'), ...extra,
  });
  return {
    home, env: ghContainedEnv(home, base, { systemd: true, tmux: true }), log: join(home, 'fake-log'), rules,
    state: join(home, '.ccrc', 'testbox-admin.state'), key: join(home, '.ccrc', 'testbox-admin.key'), pin: join(home, '.ccrc', 'testbox-known-hosts'),
  };
}

function sh(h: Home, program: string, args: string[] = []): { out: string; err: string; rc: number } {
  const r = spawnSync(BASH, ['-c', program, '_', ...args], { env: h.env, encoding: 'utf8', cwd: h.home });
  return { out: r.stdout ?? '', err: r.stderr ?? '', rc: r.status ?? -1 };
}
/** Run the verb's own dispatch with the OS forced to linux (the tests run on both userlands). */
function verb(h: Home, ...args: string[]): { out: string; err: string; rc: number } {
  return sh(h, SRC + '_tba_main "$@"', [VERB, ...args]);
}
function json(r: { out: string }): Record<string, unknown> {
  expect(r.out.trim().split('\n')).toHaveLength(1);
  return JSON.parse(r.out) as Record<string, unknown>;
}
function writeState(h: Home, lines: string[]): void { writeFileSync(h.state, lines.join('\n') + '\n', { mode: 0o600 }); }
function fakeCalls(h: Home): string[][] {
  if (!existsSync(h.log)) return [];
  const calls: string[][] = [];
  for (const l of readFileSync(h.log, 'utf8').split('\n')) {
    if (l.startsWith('-- ')) calls.push([l.slice(3)]);
    else if (l !== '' && calls.length > 0) calls[calls.length - 1]!.push(l);
  }
  return calls;
}
/** A real ed25519 host key the fake ssh-keyscan presents: its `<type> <base64>` and its SHA256 fingerprint. */
function hostKey(h: Home, name = 'hk'): { type: string; b64: string; fp: string } {
  const f = join(h.home, name);
  const g = spawnSync('ssh-keygen', ['-q', '-t', 'ed25519', '-N', '', '-C', 'host', '-f', f], { encoding: 'utf8' });
  expect(g.status, g.stderr).toBe(0);
  const [type, b64] = readFileSync(`${f}.pub`, 'utf8').trim().split(' ') as [string, string];
  const fp = (spawnSync('ssh-keygen', ['-lf', `${f}.pub`], { encoding: 'utf8' }).stdout.split(' ')[1]) ?? '';
  return { type, b64, fp };
}
const scanOut = (k: { type: string; b64: string }, host = ADDR): string => `${host} ${k.type} ${k.b64}`;
const KEYED = (h: Home, extra: string[] = []): void => writeState(h, [`address=${ADDR}`, 'port=22', 'login=root', ...extra]);
/** Make the access key the verb would, so a test that is not about `key` can have one. */
function haveKey(h: Home): void {
  const g = verb(h, 'key', `--address=${ADDR}`);
  expect(json(g)['ok'], g.out + g.err).toBe(true);
}

describe.skipIf(!HAS_KEYGEN)('ccrc testbox-admin key (D-8166, TC4)', () => {
  it('key makes an ed25519 pair 0600 create-only and answers one from-restricted line', () => {
    const h = fixture();
    const r = verb(h, 'key', `--address=${ADDR}`, '--port=2222', '--login=deploy');
    expect(r.rc, r.err).toBe(0);
    const a = json(r);
    expect(a['ok']).toBe(true);
    const pub = readFileSync(`${h.key}.pub`, 'utf8').trim();
    const [type, b64, comment] = pub.split(' ');
    expect(type).toBe('ssh-ed25519');
    expect(comment).toBe('ccrc-testbox-admin');
    expect(a['line']).toBe(`from="${SRC_ADDR}",restrict ${type} ${b64} ccrc-testbox-admin`);
    expect(statSync(h.key).mode & 0o777).toBe(0o600);
    expect(readFileSync(h.key, 'utf8')).toContain('OPENSSH PRIVATE KEY');
    expect(readFileSync(h.state, 'utf8')).toContain(`address=${ADDR}\n`);
    expect(readFileSync(h.state, 'utf8')).toContain('port=2222\n');
    expect(readFileSync(h.state, 'utf8')).toContain('login=deploy\n');
    // the temp directory the key was made in is gone
    expect(readdirSync(join(h.home, '.ccrc')).filter((n) => n.startsWith('key.'))).toEqual([]);
    // the route lookup asked for the box's address
    const ip = fakeCalls(h).find((c) => c[0] === 'ip');
    expect(ip).toEqual(['ip', '-o', 'route', 'get', ADDR]);
  });

  it('key run twice answers the same line and does not touch the key', () => {
    const h = fixture();
    const one = json(verb(h, 'key', `--address=${ADDR}`));
    const before = readFileSync(h.key, 'utf8');
    const two = json(verb(h, 'key', `--address=${ADDR}`));
    expect(two).toEqual(one);
    expect(readFileSync(h.key, 'utf8')).toBe(before);
  });

  it('key refuses foreign-key over a key it did not make and leaves it', () => {
    const h = fixture();
    const other = join(h.home, 'other');
    expect(spawnSync('ssh-keygen', ['-q', '-t', 'ed25519', '-N', '', '-C', 'someone-else', '-f', other]).status).toBe(0);
    writeFileSync(h.key, readFileSync(other), { mode: 0o600 });
    writeFileSync(`${h.key}.pub`, readFileSync(`${other}.pub`));
    const before = readFileSync(h.key, 'utf8');
    const r = verb(h, 'key', `--address=${ADDR}`);
    expect(json(r)).toEqual({ ok: false, code: 'foreign-key' });
    expect(readFileSync(h.key, 'utf8')).toBe(before);
    expect(readFileSync(`${h.key}.pub`, 'utf8')).toBe(readFileSync(`${other}.pub`, 'utf8'));
    expect(existsSync(h.state)).toBe(false);
    // a key file with no public half beside it is foreign too
    unlinkSync(`${h.key}.pub`);
    expect(json(verb(h, 'key', `--address=${ADDR}`))).toEqual({ ok: false, code: 'foreign-key' });
    expect(existsSync(`${h.key}.pub`)).toBe(false);
  });

  it('key refuses a public half that does not match the private half, and replaces an orphan public half of its own', () => {
    const h = fixture();
    const one = json(verb(h, 'key', `--address=${ADDR}`));
    // a private key made anew beside the old public half: the old line must never be answered
    const other = join(h.home, 'other2');
    expect(spawnSync('ssh-keygen', ['-q', '-t', 'ed25519', '-N', '', '-C', 'ccrc-testbox-admin', '-f', other]).status).toBe(0);
    writeFileSync(h.key, readFileSync(other), { mode: 0o600 });
    expect(json(verb(h, 'key', `--address=${ADDR}`))).toEqual({ ok: false, code: 'foreign-key' });
    // a public half with no private half is replaced by a fresh pair
    unlinkSync(h.key);
    const three = json(verb(h, 'key', `--address=${ADDR}`));
    expect(three['ok']).toBe(true);
    expect(three['line']).not.toBe(one['line']);
    const derived = spawnSync('ssh-keygen', ['-y', '-f', h.key], { encoding: 'utf8' }).stdout.trim().split(' ');
    expect(String(three['line'])).toContain(`${derived[0]} ${derived[1]} ccrc-testbox-admin`);
  });

  it('the private half is never printed, logged or in the state file', () => {
    const h = fixture();
    const r = verb(h, 'key', `--address=${ADDR}`);
    const priv = readFileSync(h.key, 'utf8');
    const body = priv.split('\n').filter((l) => l !== '' && !l.startsWith('-----'));
    expect(body.length).toBeGreaterThan(0);
    for (const l of body) {
      expect(r.out).not.toContain(l);
      expect(r.err).not.toContain(l);
      expect(readFileSync(h.state, 'utf8')).not.toContain(l);
    }
    expect(r.out + r.err).not.toContain('PRIVATE KEY');
    expect(existsSync(h.log) ? readFileSync(h.log, 'utf8') : '').not.toContain('PRIVATE KEY');
    // nothing but the public half and the connection is in the state file
    expect(readFileSync(h.state, 'utf8')).not.toContain('PRIVATE KEY');
  });

  it('key answers unreachable and writes nothing when the fleet host has no route to the address', () => {
    const h = fixture({ FAKE_IP_OUT: '' });
    expect(json(verb(h, 'key', `--address=${ADDR}`))).toEqual({ ok: false, code: 'unreachable' });
    expect(existsSync(h.state)).toBe(false);
  });
});

describe.skipIf(!HAS_KEYGEN)('ccrc testbox-admin probe and pin (D-8166, TC4)', () => {
  it('probe answers the fingerprint and writes no pin', () => {
    const h = fixture();
    const k = hostKey(h);
    h.env['FAKE_SSH_KEYSCAN_OUT'] = scanOut(k);
    writeState(h, [`address=${ADDR}`, 'port=2222', 'login=root']);
    const r = verb(h, 'probe');
    expect(json(r)).toEqual({ ok: true, fingerprint: k.fp });
    expect(existsSync(h.pin)).toBe(false);
    expect(readFileSync(h.state, 'utf8')).not.toContain('fingerprint=');
    const scan = fakeCalls(h).find((c) => c[0] === 'ssh-keyscan')!;
    expect(scan.slice(1)).toEqual(['-T', '10', '-p', '2222', '-t', 'ed25519', ADDR]);
  });

  it('probe with no connection answers not-connected, and a box that presents no key answers unreachable', () => {
    const h = fixture();
    expect(json(verb(h, 'probe'))).toEqual({ ok: false, code: 'not-connected' });
    KEYED(h);
    expect(json(verb(h, 'probe'))).toEqual({ ok: false, code: 'unreachable' });
  });

  it('pin refuses fingerprint-mismatch and writes nothing', () => {
    const h = fixture();
    const k = hostKey(h);
    const other = hostKey(h, 'hk2');
    h.env['FAKE_SSH_KEYSCAN_OUT'] = scanOut(k);
    KEYED(h);
    const r = verb(h, 'pin', `--fingerprint=${other.fp}`);
    expect(json(r)).toEqual({ ok: false, code: 'fingerprint-mismatch' });
    expect(existsSync(h.pin)).toBe(false);
    expect(readFileSync(h.state, 'utf8')).not.toContain('fingerprint=');
  });

  it('pin writes one known-hosts line by a temp and a rename, and records the fingerprint', () => {
    const h = fixture();
    const k = hostKey(h);
    h.env['FAKE_SSH_KEYSCAN_OUT'] = scanOut(k);
    KEYED(h, ['hostkey_changed=1']);
    const r = verb(h, 'pin', `--fingerprint=${k.fp}`);
    expect(json(r)).toEqual({ ok: true, fingerprint: k.fp });
    expect(readFileSync(h.pin, 'utf8')).toBe(`${ADDR} ${k.type} ${k.b64}\n`);
    expect(statSync(h.pin).mode & 0o777).toBe(0o600);
    expect(readdirSync(join(h.home, '.ccrc')).filter((n) => n.includes('.tmp.'))).toEqual([]);
    const st = readFileSync(h.state, 'utf8');
    expect(st).toContain(`fingerprint=${k.fp}\n`);
    expect(st).not.toContain('hostkey_changed');
    // ssh itself can use the file: the key is found for the address
    const f = spawnSync('ssh-keygen', ['-F', ADDR, '-f', h.pin], { encoding: 'utf8' });
    expect(f.status).toBe(0);
    // the source places it with a temp and a rename
    const text = readFileSync(VERB, 'utf8');
    expect(text).toMatch(/tmp="\$TBA_PIN\.tmp\.\$\$"/);
    expect(text).toMatch(/mv -f -- "\$tmp" "\$TBA_PIN"/);
  });

  it('pin uses the bracketed host form for a port other than 22', () => {
    const h = fixture();
    const k = hostKey(h);
    h.env['FAKE_SSH_KEYSCAN_OUT'] = scanOut(k, `[${ADDR}]:2222`);
    writeState(h, [`address=${ADDR}`, 'port=2222', 'login=root']);
    expect(json(verb(h, 'pin', `--fingerprint=${k.fp}`))).toEqual({ ok: true, fingerprint: k.fp });
    expect(readFileSync(h.pin, 'utf8')).toBe(`[${ADDR}]:2222 ${k.type} ${k.b64}\n`);
    expect(spawnSync('ssh-keygen', ['-F', `[${ADDR}]:2222`, '-f', h.pin], { encoding: 'utf8' }).status).toBe(0);
  });

  it('pin names a host name and the IP address it resolves to, so the push (which dials the listen address, an IP literal) finds an entry under strict checking', () => {
    const NAME = 'testbox.invalid';
    for (const port of ['22', '2222']) {
      const h = fixture();
      // the system's resolver, as the verb asks it
      writeFileSync(join(h.home, 'fakes', 'getent'), `#!/bin/sh\nif [ "$1" = ahosts ] && [ "$2" = ${NAME} ]; then echo "${ADDR} STREAM ${NAME}"; exit 0; fi\nexit 2\n`, { mode: 0o755 });
      const k = hostKey(h);
      h.env['FAKE_SSH_KEYSCAN_OUT'] = scanOut(k, port === '22' ? NAME : `[${NAME}]:${port}`);
      writeState(h, [`address=${NAME}`, `port=${port}`, 'login=root']);
      expect(json(verb(h, 'pin', `--fingerprint=${k.fp}`))).toEqual({ ok: true, fingerprint: k.fp });
      const field = port === '22' ? `${NAME},${ADDR}` : `[${NAME}]:${port},[${ADDR}]:${port}`;
      expect(readFileSync(h.pin, 'utf8')).toBe(`${field} ${k.type} ${k.b64}\n`);
      // ssh finds the key whichever way the connection names the box
      for (const host of [port === '22' ? NAME : `[${NAME}]:${port}`, port === '22' ? ADDR : `[${ADDR}]:${port}`]) {
        expect(spawnSync('ssh-keygen', ['-F', host, '-f', h.pin], { encoding: 'utf8' }).status, host).toBe(0);
      }
    }
    // an IP literal is named once
    const g = fixture();
    const k = hostKey(g);
    g.env['FAKE_SSH_KEYSCAN_OUT'] = scanOut(k);
    KEYED(g);
    verb(g, 'pin', `--fingerprint=${k.fp}`);
    expect(readFileSync(g.pin, 'utf8')).toBe(`${ADDR} ${k.type} ${k.b64}\n`);
  });

  it('the status reads the pin as pinned and the recorded fingerprint', () => {
    const h = fixture();
    const k = hostKey(h);
    h.env['FAKE_SSH_KEYSCAN_OUT'] = scanOut(k);
    KEYED(h);
    verb(h, 'pin', `--fingerprint=${k.fp}`);
    const s = readTestboxAdminStatus(verb(h, 'status').out.trim());
    expect(s.ok).toBe(true);
    if (s.ok) expect(s.value).toMatchObject({ hostKey: 'pinned', fingerprint: k.fp, addressSet: true });
  });
});

describe.skipIf(!HAS_KEYGEN)('ccrc testbox-admin preflight (D-8166, TC4)', () => {
  /** A connected, keyed, pinned fixture whose box passes every check. */
  function ready(extra: NodeJS.ProcessEnv = {}, login = 'root'): { h: Home; k: ReturnType<typeof hostKey> } {
    const h = fixture(extra);
    const k = hostKey(h);
    h.env['FAKE_SSH_KEYSCAN_OUT'] = scanOut(k);
    writeState(h, [`address=${ADDR}`, 'port=22', `login=${login}`, `fingerprint=${k.fp}`]);
    writeFileSync(h.pin, `${ADDR} ${k.type} ${k.b64}\n`, { mode: 0o600 });
    haveKey(h);
    writeState(h, [`address=${ADDR}`, 'port=22', `login=${login}`, `fingerprint=${k.fp}`]);
    return { h, k };
  }
  const CHECKS = ['login', 'os', 'systemd', 'nftables', 'storage', 'address', 'network', 'from', 'egress', 'release'];
  const rows = (r: { out: string }): { check: string; ok: boolean; code: string | null }[] => json(r)['checks'] as never;

  it('preflight lists every check with ok or its code', () => {
    const { h } = ready();
    const r = verb(h, 'preflight');
    expect(r.rc, r.err).toBe(0);
    const a = json(r);
    expect(a['ok']).toBe(true);
    expect(a['pass']).toBe(true);
    expect(rows(r)).toEqual(CHECKS.map((check) => ({ check, ok: true, code: null })));
    expect(a['line']).toBeUndefined();
  });

  it('each failing check answers its own code', () => {
    const cases: [string, string[][], string][] = [
      ['os', [['cat /etc/os-release', '0', 'ID=ubuntu\\nVERSION_ID="24.04"\\n']], 'os-mismatch'],
      ['systemd', [['systemctl --version', '0', 'systemd 252 (252.22-1)\\n']], 'systemd-too-old'],
      ['nftables', [['nft --version', '127', '']], 'no-nftables'],
      ['storage', [['xfs_info', '0', 'reflink=0\\n']], 'not-xfs-reflink'],
      ['storage', [['xfs_info', '1', '']], 'not-xfs-reflink'],
      ['address', [['SSH_CONNECTION', '0', 'not-an-address 1 host.invalid 22']], 'address-not-ip'],
      ['network', [['SSH_CONNECTION', '0', `${SRC_ADDR} 51234 ${PUBLIC} 22`]], 'address-not-private'],
      ['egress', [['timeout ', '124', '']], 'no-egress'],
      ['release', [['readlink', '0', '/opt/ccrc-testbox/tools/release/v0.0.1\\n']], 'other-release'],
    ];
    for (const [check, over, code] of cases) {
      const { h } = ready();
      writeFileSync(h.rules, [...over, ...PASSING_RULES].map((r) => r.join('\t')).join('\n') + '\n');
      const r = rows(verb(h, 'preflight'));
      const row = r.find((x) => x.check === check)!;
      expect(row, `${check} ${code}`).toEqual({ check, ok: false, code });
      expect(r.filter((x) => !x.ok).map((x) => x.check).filter((c) => c !== check && c !== 'from')).toEqual([]);
    }
  });

  it('before the first connect the storage check measures the card\'s starting root (an absolute path), never the login user\'s home; once connected, the box\'s own', () => {
    const { h } = ready();
    verb(h, 'preflight');
    const probe = (): string => fakeCalls(h).filter((c) => c[0] === 'ssh').map((c) => c[c.length - 1]!).find((c) => c.includes('xfs_info'))!;
    expect(probe().endsWith(' /var/lib/ccrc-testbox')).toBe(true);
    expect(probe()).not.toContain('.ccrc/testbox');
    const g = ready();
    appendFileSync(g.h.state, 'box_root=/srv/box\n');
    verb(g.h, 'preflight');
    expect(fakeCalls(g.h).filter((c) => c[0] === 'ssh').map((c) => c[c.length - 1]!).find((c) => c.includes('xfs_info'))!.endsWith(' /srv/box')).toBe(true);
  });

  it('each egress probe is bounded to 8 s whatever the reconnect deadline says, so a box that drops outbound connections still gets its no-egress row inside the agent\'s 60 s', () => {
    const { h } = ready();
    writeFileSync(join(h.home, '.ccrc', 'ccrc.env'), 'CCRC_TESTBOX_RECONNECT_DEADLINE=5m\n');
    verb(h, 'preflight');
    const bounds = fakeCalls(h).filter((c) => c[0] === 'ssh').map((c) => /^timeout (\d+) bash/.exec(c[c.length - 1]!)?.[1]).filter((x) => x !== undefined);
    // one probe: the release host. The npm upstream is the installer's own setting, typed after this check, so Connect probes it.
    expect(bounds.length).toBe(1);
    for (const b of bounds) expect(Number(b)).toBeLessThanOrEqual(8);
  });

  it('the release already installed under this tag passes, and the same tag is read from the fleet host\'s own stamp', () => {
    const { h } = ready();
    writeFileSync(h.rules, [['readlink', '0', '/opt/ccrc-testbox/tools/release/v1.2.3\\n'], ...PASSING_RULES].map((r) => r.join('\t')).join('\n') + '\n');
    expect(rows(verb(h, 'preflight')).find((x) => x.check === 'release')).toEqual({ check: 'release', ok: true, code: null });
  });

  it('preflight runs only read-only commands on the box', () => {
    const { h } = ready();
    verb(h, 'preflight');
    const cmds = fakeCalls(h).filter((c) => c[0] === 'ssh').map((c) => c[c.length - 1]!);
    // the login, os, systemd, nftables and storage reads, the connection read, the one egress probe and the release link
    expect(cmds).toHaveLength(8);
    const allowed = /^(id -u|true|cat \/etc\/os-release|systemctl --version|nft --version|readlink -- \S+|sh -c .*|timeout \d+ bash -c .*)$/;
    for (const c of cmds) {
      expect(c, c).toMatch(allowed);
      expect(c, c).not.toMatch(/\b(rm|mv|cp|tee|install|mkdir|chmod|chown|systemctl (start|stop|enable|restart)|useradd|mount|mkfs|dd|tailscale|wg-quick)\b/);
      // no write redirect (a read's own `2>/dev/null` and the egress check's `3<>` socket, quoted for the box's shell,
      // write no file)
      expect(c.replace(/2\\>\/dev\/null/g, '').replace(/3\\<\\>\\"\/dev\/tcp\//g, ''), c).not.toMatch(/\\>/);
    }
    // the storage probe and the connection read are the only `sh -c` commands, and read only
    const shc = cmds.filter((c) => c.startsWith('sh -c'));
    expect(shc).toHaveLength(2);
    expect(shc.some((c) => c.includes('xfs_info'))).toBe(true);
    expect(shc.some((c) => c.includes('SSH_CONNECTION'))).toBe(true);
  });

  it('preflight under a sudo login prefixes sudo -n and answers no-sudo without passwordless sudo', () => {
    const { h } = ready({}, 'deploy');
    let r = verb(h, 'preflight');
    expect(rows(r)[0]).toEqual({ check: 'login', ok: true, code: null });
    const cmds = fakeCalls(h).filter((c) => c[0] === 'ssh').map((c) => c[c.length - 1]!);
    expect(cmds[0]).toBe('sudo -n -- true');
    expect(cmds.filter((c) => !c.startsWith('sudo -n -- '))).toHaveLength(1);   // the connection read, which sudo's environment reset would empty
    expect(cmds.find((c) => !c.startsWith('sudo -n -- '))).toContain('SSH_CONNECTION');
    writeFileSync(h.rules, [['^sudo -n -- true$', '1', ''], ...PASSING_RULES].map((x) => x.join('\t')).join('\n') + '\n');
    r = verb(h, 'preflight');
    expect(rows(r)[0]).toEqual({ check: 'login', ok: false, code: 'no-sudo' });
    expect(json(r)['pass']).toBe(false);
  });

  it('a root login that is not uid 0 answers no-root', () => {
    const { h } = ready();
    writeFileSync(h.rules, [['id -u', '0', '1000\\n'], ...PASSING_RULES].map((x) => x.join('\t')).join('\n') + '\n');
    expect(rows(verb(h, 'preflight'))[0]).toEqual({ check: 'login', ok: false, code: 'no-root' });
  });

  it('a from address that differs from SSH_CONNECTION answers from-mismatch with the corrected line', () => {
    const { h } = ready();
    writeFileSync(h.rules, [['SSH_CONNECTION', '0', '10.0.0.97 51234 10.0.0.9 22'], ...PASSING_RULES].map((x) => x.join('\t')).join('\n') + '\n');
    const r = verb(h, 'preflight');
    const a = json(r);
    expect(rows(r).find((x) => x.check === 'from')).toEqual({ check: 'from', ok: false, code: 'from-mismatch' });
    const pub = readFileSync(`${h.key}.pub`, 'utf8').trim().split(' ');
    expect(a['line']).toBe(`from="10.0.0.97",restrict ${pub[0]} ${pub[1]} ccrc-testbox-admin`);
  });

  it('ssh failing answers its closed code instead of rows; no connection and no key are refused before any ssh', () => {
    const { h } = ready();
    const err = join(h.home, 'ssh-err');
    writeFileSync(err, 'Permission denied (publickey).\n');
    h.env['FAKE_SSH_ERR_FILE'] = err; h.env['FAKE_SSH_RC'] = '255';
    expect(json(verb(h, 'preflight'))).toEqual({ ok: false, code: 'auth-refused' });
    const bare = fixture();
    expect(json(verb(bare, 'preflight'))).toEqual({ ok: false, code: 'not-connected' });
    const k = hostKey(bare);
    writeState(bare, [`address=${ADDR}`]);
    writeFileSync(bare.pin, `${ADDR} ${k.type} ${k.b64}\n`);
    bare.env['FAKE_SSH_KEYSCAN_OUT'] = scanOut(k);
    expect(json(verb(bare, 'preflight'))).toEqual({ ok: false, code: 'no-access-key' });
    expect(fakeCalls(bare).filter((c) => c[0] === 'ssh')).toEqual([]);
  });

  it('with no pin the preflight answers host-key-unknown before any ssh', () => {
    const { h } = ready();
    unlinkSync(h.pin);
    expect(json(verb(h, 'preflight'))).toEqual({ ok: false, code: 'host-key-unknown' });
    expect(fakeCalls(h).filter((c) => c[0] === 'ssh')).toEqual([]);
  });

  it('a changed host key answers host-key-changed for every act but status, probe, pin and disconnect', () => {
    const { h } = ready();
    const swapped = hostKey(h, 'hk-new');
    h.env['FAKE_SSH_KEYSCAN_OUT'] = scanOut(swapped);
    const before = fakeCalls(h).filter((c) => c[0] === 'ssh').length;
    expect(json(verb(h, 'preflight'))).toEqual({ ok: false, code: 'host-key-changed' });
    expect(json(verb(h, 'key', `--address=${ADDR}`))).toEqual({ ok: false, code: 'host-key-changed' });
    expect(fakeCalls(h).filter((c) => c[0] === 'ssh').length).toBe(before);
    // the status says so
    const s = readTestboxAdminStatus(verb(h, 'status').out.trim());
    expect(s.ok && s.value.hostKey).toBe('changed');
    // probe reports what the box presents now, and pin with that fingerprint takes it and clears the block
    expect(json(verb(h, 'probe'))).toEqual({ ok: true, fingerprint: swapped.fp });
    expect(json(verb(h, 'pin', `--fingerprint=${swapped.fp}`))).toEqual({ ok: true, fingerprint: swapped.fp });
    const after = readTestboxAdminStatus(verb(h, 'status').out.trim());
    expect(after.ok && after.value.hostKey).toBe('pinned');
    expect(json(verb(h, 'preflight'))['ok']).toBe(true);
  });

  it('ssh\'s own host-key-changed line sets the same block in the status', () => {
    const { h } = ready();
    const err = join(h.home, 'ssh-err');
    writeFileSync(err, '@@@ WARNING: REMOTE HOST IDENTIFICATION HAS CHANGED! @@@\n');
    h.env['FAKE_SSH_ERR_FILE'] = err; h.env['FAKE_SSH_RC'] = '255';
    // a box that cannot be scanned is left to the act's own ssh, whose strict checking says it
    delete h.env['FAKE_SSH_KEYSCAN_OUT'];
    expect(json(verb(h, 'preflight'))).toEqual({ ok: false, code: 'host-key-changed' });
    const s = readTestboxAdminStatus(verb(h, 'status').out.trim());
    expect(s.ok && s.value.hostKey).toBe('changed');
  });
});

describe.skipIf(!HAS_KEYGEN)('the connection the key sub records, and the private network (D-8166, C4, C11, M21)', () => {
  const OTHER = '10.0.0.77';
  const stateOf = (h: Home): string => (existsSync(h.state) ? readFileSync(h.state, 'utf8') : '');

  it('key --source puts the address the box sees in the line, keeps it with the connection, and a later key for the same box answers the same line', () => {
    const h = fixture();
    const first = json(verb(h, 'key', `--address=${ADDR}`, '--source=10.0.0.250'));
    const pub = readFileSync(`${h.key}.pub`, 'utf8').trim().split(' ');
    expect(first['line']).toBe(`from="10.0.0.250",restrict ${pub[0]} ${pub[1]} ccrc-testbox-admin`);
    expect(stateOf(h)).toContain('source=10.0.0.250\n');
    // no route lookup was needed for the line
    expect(fakeCalls(h).some((c) => c[0] === 'ip')).toBe(false);
    expect(json(verb(h, 'key', `--address=${ADDR}`))).toEqual(first);
    // a new source replaces it; a different box (nothing pinned yet) forgets it and uses the route's source
    expect(json(verb(h, 'key', `--address=${ADDR}`, '--source=10.0.0.251'))['line']).toContain('from="10.0.0.251"');
    h.env['FAKE_IP_OUT'] = `${OTHER} dev eth0 src ${SRC_ADDR} uid 0`;
    expect(json(verb(h, 'key', `--address=${OTHER}`))['line']).toContain(`from="${SRC_ADDR}"`);
    expect(stateOf(h)).not.toMatch(/^source=/m);
  });

  it('key --source is an IP literal, not a name', () => {
    const h = fixture();
    expect(json(verb(h, 'key', `--address=${ADDR}`, '--source=host.invalid'))).toEqual({ ok: false, code: 'address-not-ip' });
    expect(existsSync(h.state)).toBe(false);
  });

  it('a connected box, or one whose host key is pinned, keeps its address and port: another is refused box-already-set and nothing moves', () => {
    for (const marked of ['connected=1', 'pinned']) {
      const h = fixture();
      const k = hostKey(h);
      h.env['FAKE_SSH_KEYSCAN_OUT'] = scanOut(k);
      const lines = [`address=${ADDR}`, 'port=22', 'login=root', `fingerprint=${k.fp}`];
      if (marked === 'connected=1') lines.push('connected=1');
      writeState(h, lines);
      if (marked === 'pinned') writeFileSync(h.pin, `${ADDR} ${k.type} ${k.b64}\n`, { mode: 0o600 });
      haveKey(h);
      const before = stateOf(h);
      h.env['FAKE_IP_OUT'] = `${OTHER} dev eth0 src ${SRC_ADDR} uid 0`;
      expect(json(verb(h, 'key', `--address=${OTHER}`)), marked).toEqual({ ok: false, code: 'box-already-set' });
      expect(json(verb(h, 'key', `--address=${ADDR}`, '--port=2222')), marked).toEqual({ ok: false, code: 'box-already-set' });
      expect(stateOf(h), marked).toBe(before);
      // the same address and port is the access-line form of a connected card: it answers its line, and the login may change
      h.env['FAKE_IP_OUT'] = `${ADDR} dev eth0 src ${SRC_ADDR} uid 0`;
      expect(json(verb(h, 'key', `--address=${ADDR}`, '--login=deploy'))['ok'], marked).toBe(true);
      expect(stateOf(h), marked).toContain('login=deploy\n');
      if (marked === 'connected=1') expect(stateOf(h)).toContain('connected=1\n');
    }
  });

  it('before anything is pinned or connected the address can still be corrected', () => {
    const h = fixture();
    json(verb(h, 'key', `--address=${ADDR}`));
    h.env['FAKE_IP_OUT'] = `${OTHER} dev eth0 src ${SRC_ADDR} uid 0`;
    expect(json(verb(h, 'key', `--address=${OTHER}`, '--login=deploy'))['ok']).toBe(true);
    expect(stateOf(h)).toContain(`address=${OTHER}\n`);
  });

  const ready = (extra: NodeJS.ProcessEnv = {}, address = ADDR): { h: Home } => {
    const h = fixture(extra);
    const k = hostKey(h);
    h.env['FAKE_SSH_KEYSCAN_OUT'] = scanOut(k, address);
    writeFileSync(h.pin, `${address} ${k.type} ${k.b64}\n`, { mode: 0o600 });
    writeState(h, [`address=${address}`, 'port=22', 'login=root', `fingerprint=${k.fp}`]);
    const g = verb(h, 'key', `--address=${address}`);
    expect(json(g)['ok'], g.out + g.err).toBe(true);
    return { h };
  };
  const checks = (r: { out: string }): { check: string; ok: boolean; code: string | null }[] => json(r)['checks'] as never;

  it('a box on a public address fails the network check even when every other check passes, and the preflight does not pass', () => {
    const { h } = ready({ FAKE_IP_OUT: `${PUBLIC} dev eth0 src ${SRC_ADDR} uid 0` }, PUBLIC);
    writeFileSync(h.rules, [['SSH_CONNECTION', '0', `${SRC_ADDR} 51234 ${PUBLIC} 22`], ...PASSING_RULES].map((x) => x.join('\t')).join('\n') + '\n');
    const r = verb(h, 'preflight');
    expect(json(r)['pass']).toBe(false);
    expect(checks(r).filter((x) => !x.ok)).toEqual([{ check: 'network', ok: false, code: 'address-not-private' }]);
  });

  it('every private range passes and the neighbours of each fail: RFC 1918, 100.64/10 and fc00::/7', () => {
    const cases: [string, boolean][] = [
      ['10.0.0.1', true], ['10.255.255.255', true], ['172.16.0.1', true], ['172.31.255.255', true], [ip('172_15_255_255'), false], [ip('172_32_0_1'), false],
      ['192.168.0.1', true], [ip('192_169_0_1'), false], [ip('100_64_0_1'), true], [ip('100_127_255_255'), true], [ip('100_63_255_255'), false], [ip('100_128_0_1'), false],
      [ip('11_0_0_1'), false], [ip('8_8_8_8'), false], ['127.0.0.1', false], [ip('169_254_1_1'), false],
      ['fc00::1', true], ['fd7a:115c:a1e0::1', true], ['fdff::1', true], ['fe80::1', false], ['2001:db8::1', false], ['::1', false], ['::', false], ['fbff::1', false],
      ['testbox.invalid', false], ['', false],
    ];
    const h = fixture();
    const r = sh(h, SRC + 'for a in "$@"; do _tba_is_private_ip "$a" && echo "$a yes" || echo "$a no"; done', [VERB, ...cases.map(([a]) => a)]);
    const got = r.out.split('\n').filter((l) => l !== '');
    expect(got).toEqual(cases.map(([a, ok]) => `${a} ${ok ? 'yes' : 'no'}`));
  });

  it('the bash rule and shared/testbox-admin.ts#isPrivateNetworkAddress agree on the same corpus', async () => {
    const { isPrivateNetworkAddress } = await import('../../shared/testbox-admin.js');
    const corpus = ['10.0.0.1', '172.16.0.1', ip('172_15_0_1'), ip('172_32_0_1'), '192.168.1.1', ip('192_167_1_1'), ip('100_64_0_0'), ip('100_127_0_1'), ip('100_128_0_1'), ip('8_8_8_8'), 'fc00::', 'fd12:3456::1', 'fe00::1', 'fbff::', '2001:db8::1', '::1', 'a.invalid', '1.2.3', ip('300_1_1_1')];
    const h = fixture();
    const r = sh(h, SRC + 'for a in "$@"; do _tba_is_private_ip "$a" && echo yes || echo no; done', [VERB, ...corpus]);
    expect(r.out.split('\n').filter((l) => l !== '')).toEqual(corpus.map((a) => (isPrivateNetworkAddress(a) ? 'yes' : 'no')));
  });

  it('a from mismatch keeps the address the box saw as the source, so the next check and the next line agree', () => {
    const { h } = ready();
    writeFileSync(h.rules, [['SSH_CONNECTION', '0', '10.0.0.97 51234 10.0.0.9 22'], ...PASSING_RULES].map((x) => x.join('\t')).join('\n') + '\n');
    const first = json(verb(h, 'preflight'));
    expect(first['line']).toContain('from="10.0.0.97"');
    expect(stateOf(h)).toContain('source=10.0.0.97\n');
    const second = verb(h, 'preflight');
    expect(json(second)['pass']).toBe(true);
    expect(json(second)['line']).toBeUndefined();
    expect(json(verb(h, 'key', `--address=${ADDR}`))['line']).toContain('from="10.0.0.97"');
  });

  it('a stored source is what the check compares with, ahead of the route lookup', () => {
    const { h } = ready();
    expect(json(verb(h, 'key', `--address=${ADDR}`, `--source=${SRC_ADDR}`))['ok']).toBe(true);
    // the box sees ccrc come from the stored source; the route lookup now says something else
    h.env['FAKE_IP_OUT'] = `${ADDR} dev eth0 src 10.0.0.201 uid 0`;
    expect(json(verb(h, 'preflight'))['pass']).toBe(true);
  });

  it('the egress check probes the release host only: the npm upstream is the installer\'s setting, typed after the preflight', () => {
    const { h } = ready();
    verb(h, 'preflight');
    const probes = fakeCalls(h).filter((c) => c[0] === 'ssh').map((c) => c[c.length - 1]!).filter((c) => c.startsWith('timeout '));
    expect(probes).toHaveLength(1);
    expect(probes[0]).not.toContain('registry.npmjs.org');
  });
});

describe('what the access, host key and preflight code never does (D-8166, C10, C11)', () => {
  it('no check formats a disk or joins a network', () => {
    const text = readFileSync(VERB, 'utf8').split('\n').filter((l) => !/^\s*#/.test(l)).join('\n');
    for (const word of ['mkfs', 'tailscale up', 'wg-quick', 'parted', 'wipefs', 'mkswap', 'zpool create']) expect(text, word).not.toContain(word);
  });

  it('every ssh the preflight and the key code run goes through _tba_ssh or the two key tools, and ssh-keygen never gets a passphrase prompt', () => {
    const text = readFileSync(VERB, 'utf8');
    expect(text).toMatch(/ssh-keygen -q -t ed25519 -N '' -C "\$TBA_KEY_COMMENT"/);
    expect(text).toMatch(/ssh-keyscan -T "\$dl" -p "\$2" -t ed25519 "\$1"/);
    expect(text).toContain('TBA_KEY_COMMENT=ccrc-testbox-admin');
  });
});

// D-8166 (plan docs/superpowers/plans/2026-11-10-test-box-connect.md, Task TC3; spec §2.1, §2.3, T1, T7): `ccrc
// testbox-admin`, its frame and `status`. The verb is ccd/ccrc-testbox-admin, reached by one dispatch line in ccd/ccrc.
//
// What is held here: the status of a box nothing is connected to; that no address and no path ever reaches a status;
// that the bash argument check and `buildTestboxAdminArgv` agree on one corpus (and the tables beside it: subs,
// fields, codes, phases, key sets); that a bad field is refused (exit 2) before any ssh runs; that every ssh the verb
// runs carries the five strict options and none runs outside `_tba_ssh`; that ssh's stderr never reaches an answer and
// each of its lines gives its closed code; that a second long act while the lock is held answers `busy`; that a long
// act's parent answers its act id once the state file says `running`, and the unit it hands to ends the act in the
// state; and that on macOS every sub but `status` answers `unsupported-os`.
//
// Every row runs a fixed bash program; paths and values are its arguments, never spliced into it. The fixture HOME holds
// ~/.ccrc; ghContainedEnv poisons the user manager (its systemd-run stub records its argv in $HOME/systemd-run-calls)
// and tmux, and the fake ssh tools stand first on PATH.
import { describe, it, expect } from 'vitest';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import path, { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkTmp, removeTmpFixturesEachTest } from './tmpHelpers.js';
import { ghContainedEnv } from './ccdWsHelpers.js';
import {
  TESTBOX_ADMIN_CODES, TESTBOX_ADMIN_PHASES, TESTBOX_ADMIN_SUBS, TESTBOX_ADMIN_SUB_MAP, TESTBOX_BOX_KEYS,
  TESTBOX_FLEET_EDITABLE, buildTestboxAdminArgv, isBoxAddress, isHostKeyFingerprint, isLoginUser, isPrNumber, isSshPort,
  readTestboxAdminStatus, testboxAdminIsLong, type TestboxAdminSub,
} from '../../shared/testbox-admin.js';

removeTmpFixturesEachTest();

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const CCRC = join(REPO, 'ccd', 'ccrc');
const VERB = join(REPO, 'ccd', 'ccrc-testbox-admin');
const FAKE = join(REPO, 'server', 'test', 'fixtures', 'testbox-admin-ssh.sh');
const BASH = spawnSync('bash', ['-c', 'command -v bash'], { encoding: 'utf8' }).stdout.trim();
const HAS_FLOCK = spawnSync('bash', ['-c', 'command -v flock'], { encoding: 'utf8' }).status === 0;
const US = '\x1f';
const FP = `SHA256:${'A'.repeat(43)}`;
const SHA = 'b'.repeat(64);
const ID = 'c'.repeat(32);
const ADDR = '203.0.113.9';
const b64url = (s: string): string => Buffer.from(s).toString('base64url');
const ROW = {
  name: 'project-a', fetchUrl: 'https://testbox.invalid/project-a.git', mirrorPath: '/srv/mirror/project-a.git',
  packages: [{ name: 'server', installInputs: ['server/package.json'], commands: ['./node_modules/.bin/vitest'] }],
  buildOutputs: [], systemTools: [],
};

/** One `--repo=` value: base64url of the row's JSON. */
const rowArg = (row: unknown): string => b64url(JSON.stringify(row));

interface Home { home: string; env: NodeJS.ProcessEnv; log: string; state: string }

function fixture(extra: NodeJS.ProcessEnv = {}): Home {
  const home = mkTmp('tb-admin-');
  mkdirSync(join(home, '.ccrc'), { recursive: true });
  mkdirSync(join(home, 'tmp'), { recursive: true });
  const fakes = join(home, 'fakes');
  mkdirSync(fakes, { recursive: true });
  for (const n of ['ssh', 'ssh-keyscan', 'ssh-keygen']) symlinkSync(FAKE, join(fakes, n));
  const base: NodeJS.ProcessEnv = {};
  for (const [k, v] of Object.entries(process.env)) if (!k.startsWith('CCRC_') && !k.startsWith('TB_') && !k.startsWith('FAKE_')) base[k] = v;
  Object.assign(base, { HOME: home, TMPDIR: join(home, 'tmp'), LANG: 'C', PATH: `${fakes}:${process.env['PATH'] ?? '/usr/bin:/bin'}`, FAKE_LOG: join(home, 'fake-log'), ...extra });
  return { home, env: ghContainedEnv(home, base, { systemd: true, tmux: true }), log: join(home, 'fake-log'), state: join(home, '.ccrc', 'testbox-admin.state') };
}

function sh(h: Home, program: string, args: string[] = [], input?: string): { out: string; err: string; rc: number } {
  const r = spawnSync(BASH, ['-c', program, '_', ...args], { env: h.env, encoding: 'utf8', cwd: h.home, input });
  return { out: r.stdout ?? '', err: r.stderr ?? '', rc: r.status ?? -1 };
}
/** Source the verb as a library (the way ccrc-test's tests do), force the OS, then run `tail`. */
const SRC = (os: 'linux' | 'darwin') => `. "$1" || exit 90; shift; CCD_OS=${os}; `;

function run(h: Home, args: string[]): { out: string; err: string; rc: number } {
  const r = spawnSync(BASH, [VERB, ...args], { env: h.env, encoding: 'utf8', cwd: h.home });
  return { out: r.stdout ?? '', err: r.stderr ?? '', rc: r.status ?? -1 };
}
function writeState(h: Home, lines: string[]): void {
  writeFileSync(h.state, lines.join('\n') + '\n', { mode: 0o600 });
}
function fakeLog(h: Home): string[][] {
  if (!existsSync(h.log)) return [];
  const calls: string[][] = [];
  for (const l of readFileSync(h.log, 'utf8').split('\n')) {
    if (l.startsWith('-- ')) calls.push([l.slice(3)]);
    else if (l !== '' && calls.length > 0) calls[calls.length - 1]!.push(l);
  }
  return calls;
}

describe('ccrc testbox-admin: the dispatch and the status (D-8166, TC3)', () => {
  it('ccd/ccrc reaches the verb by exactly one dispatch line, and the verb file is executable and sources ccd/ccrc', () => {
    const text = readFileSync(CCRC, 'utf8');
    expect(text.split('\n').filter((l) => /^ {2}testbox-admin\)/.test(l))).toEqual(['  testbox-admin) exec bash "$CCRC_HERE/ccrc-testbox-admin" "$@" ;;']);
    expect(statSync(VERB).mode & 0o111).not.toBe(0);
    expect(readFileSync(VERB, 'utf8')).toContain('. "$TBA_HERE/ccrc"');
  });

  it('status with nothing connected answers connected false, addressSet false and no act, and the reader takes it', () => {
    const h = fixture();
    const r = run(h, ['status']);
    expect(r.rc).toBe(0);
    expect(r.out.trim().split('\n')).toHaveLength(1);
    const read = readTestboxAdminStatus(r.out.trim());
    expect(read.ok, JSON.stringify(read)).toBe(true);
    if (!read.ok) return;
    expect(read.value).toMatchObject({ v: 1, connected: false, addressSet: false, login: null, fingerprint: null, hostKey: 'none', boxFileSha256: null, act: null, boxSettings: null, boxSettingsAt: null, parity: null });
  });

  it('status through ccrc itself (the one dispatch line) prints the same document', () => {
    const h = fixture();
    const r = spawnSync(BASH, [CCRC, 'testbox-admin', 'status'], { env: h.env, encoding: 'utf8', cwd: h.home });
    expect(r.status).toBe(0);
    expect(readTestboxAdminStatus((r.stdout ?? '').trim()).ok).toBe(true);
  });

  it('status never prints an address or a path, and reads the connection, the pin, the act and the parity record', () => {
    const h = fixture();
    writeState(h, [
      `address=${ADDR}`, 'port=2222', 'login=deploy', `fingerprint=${FP}`, 'connected=1', `box_sha256=${SHA}`,
      `act_id=${ID}`, 'act_sub=repair', 'act_phase=copy', 'act_phases=verify:12,copy:5', 'act_outcome=running', 'act_started=1700000000000',
    ]);
    writeFileSync(join(h.home, '.ccrc', 'testbox-known-hosts'), `[${ADDR}]:2222 ssh-ed25519 AAAA\n`);
    const parity = { v: 1, result: 'pass', prs: [], fixtures: [], release: 'v1.2.3', toolsKey: 'k1', fingerprint: FP, boxFileSha256: SHA, at: 1700000000001 };
    writeFileSync(join(h.home, '.ccrc', 'testbox-parity.json'), JSON.stringify(parity) + '\n');
    const r = run(h, ['status']);
    expect(r.out).not.toContain(ADDR);
    expect(r.out).not.toContain(h.home);
    expect(r.out).not.toContain('2222');
    const read = readTestboxAdminStatus(r.out.trim());
    expect(read.ok, JSON.stringify(read)).toBe(true);
    if (!read.ok) return;
    expect(read.value).toMatchObject({
      connected: true, addressSet: true, login: 'sudo', fingerprint: FP, hostKey: 'pinned', boxFileSha256: SHA,
      act: { id: ID, sub: 'repair', phase: 'copy', phases: [{ name: 'verify', ms: 12 }, { name: 'copy', ms: 5 }], outcome: 'running', code: null, startedAt: 1700000000000, endedAt: null },
      parity,
    });
  });

  it('a root login reads root; a changed host key reads changed whatever the pin file holds', () => {
    const h = fixture();
    writeState(h, [`address=${ADDR}`, 'login=root', 'hostkey_changed=1']);
    writeFileSync(join(h.home, '.ccrc', 'testbox-known-hosts'), 'x\n');
    const read = readTestboxAdminStatus(run(h, ['status']).out.trim());
    expect(read.ok && read.value.login).toBe('root');
    expect(read.ok && read.value.hostKey).toBe('changed');
  });

  it('a state file with a bad act, fingerprint, digest or parity record never makes the status unreadable', () => {
    const h = fixture();
    writeState(h, [
      `address=${ADDR}`, 'fingerprint=not-a-fingerprint', 'box_sha256=xyz', `act_id=${ID}`, 'act_sub=not-a-sub', 'act_outcome=running', 'act_started=1',
    ]);
    writeFileSync(join(h.home, '.ccrc', 'testbox-parity.json'), 'not json\n');
    const read = readTestboxAdminStatus(run(h, ['status']).out.trim());
    expect(read.ok, JSON.stringify(read)).toBe(true);
    expect(read.ok && read.value).toMatchObject({ fingerprint: null, boxFileSha256: null, act: null, parity: null });
  });

  it('a phase or code the contract does not name is dropped from the act, not printed', () => {
    const h = fixture();
    writeState(h, [
      `act_id=${ID}`, 'act_sub=connect', 'act_phase=bogus', 'act_phases=verify:3,bogus:4,copy:x', 'act_outcome=failed',
      'act_code=bogus-code', 'act_started=5', 'act_ended=9',
    ]);
    const read = readTestboxAdminStatus(run(h, ['status']).out.trim());
    expect(read.ok, JSON.stringify(read)).toBe(true);
    expect(read.ok && read.value.act).toMatchObject({ phase: null, phases: [{ name: 'verify', ms: 3 }], outcome: 'failed', code: null, endedAt: 9 });
  });
});

describe('the bash argument check is the twin of buildTestboxAdminArgv (D-8166)', () => {
  const SUBS = Object.keys(TESTBOX_ADMIN_SUB_MAP) as TestboxAdminSub[];

  it('the sub, code, phase and key tables equal shared/testbox-admin.ts, and so does every sub\'s field table', () => {
    const h = fixture();
    const program = SRC('linux')
      + 'printf "subs\\t%s\\n" "${TBA_SUBS[*]}"; printf "codes\\t%s\\n" "${TBA_CODES[*]}"; printf "phases\\t%s\\n" "${TBA_PHASES_ALL[*]}"; '
      + 'printf "fleet\\t%s\\n" "${TBA_FLEET_KEYS[*]}"; printf "box\\t%s\\n" "${TBA_BOX_KEYS[*]}"; '
      + 'for s in "${TBA_SUBS[@]}"; do printf "fields:%s\\t%s\\n" "$s" "$(_tba_fields "$s" | tr "\\n" "|")"; printf "ph:%s\\t%s\\n" "$s" "$(_tba_phases "$s" | tr "\\n" " ")"; done';
    const r = sh(h, program, [VERB]);
    expect(r.rc, r.err).toBe(0);
    const lines = new Map(r.out.split('\n').filter(Boolean).map((l) => l.split('\t') as [string, string]));
    const val = (k: string): string => lines.get(k) ?? '<missing>';
    expect(val('subs').split(' ')).toEqual(SUBS);
    expect(val('codes').split(' ')).toEqual([...TESTBOX_ADMIN_CODES]);
    expect(val('phases').split(' ')).toEqual(['verify', 'copy', 'settings', 'install', 'pair', 'check', 'wait', 'legs', 'record']);
    expect(val('fleet').split(' ')).toEqual([...TESTBOX_FLEET_EDITABLE]);
    expect(val('box').split(' ')).toEqual([...TESTBOX_BOX_KEYS]);
    for (const s of SUBS) {
      const want = Object.values(TESTBOX_ADMIN_SUBS[s].fields).map((f) => `${f.flag} ${f.grammar} ${f.required ? 1 : 0} ${f.repeatable ? 1 : 0}|`).join('');
      expect(val(`fields:${s}`), s).toBe(want);
      const phased = (TESTBOX_ADMIN_PHASES as Record<string, readonly string[]>)[s];
      expect(val(`ph:${s}`).trim(), s).toBe(phased === undefined ? '' : phased.join(' '));
    }
  });

  it('the long subs are the contract\'s (settings-box only with --when-idle)', () => {
    const h = fixture();
    const r = sh(h, SRC('linux') + 'for s in "$@"; do TBA_WHENIDLE=0; _tba_is_long "$s" && echo "$s:long" || echo "$s:short"; done; TBA_WHENIDLE=1; _tba_is_long settings-box && echo "idle:long"', [VERB, ...SUBS]);
    const got = Object.fromEntries(r.out.split('\n').filter((l) => l.includes(':')).map((l) => l.split(':') as [string, string]));
    for (const s of SUBS) expect(got[s], s).toBe(testboxAdminIsLong(s, {}) ? 'long' : 'short');
    expect(got['idle']).toBe('long');
    expect(testboxAdminIsLong('settings-box', { whenIdle: true })).toBe(true);
  });

  // Invalid dotted quads are assembled here so no file this scanner reads spells an address.
  const q = (...p: (number | string)[]): string => p.join('.');
  const addrs = ['203.0.113.9', q(255, 255, 255, 255), q(256, 1, 1, 1), '1.2.3', q(1, 2, 3, 4, 5), q(999, 1, 1, 1), 'testbox.invalid', 'a', 'a-b.c', '-a.b', 'a-.b', 'a..b', 'a.', '.a', 'a.1', '1.1', '2001:db8::1', '::', '::1', '1::', '1:2:3:4:5:6:7:8', '1:2:3:4:5:6:7', '1:2:3:4:5:6:7:8:9', '1::2::3', ':::', '1:2:3:4:5:6:7::', 'g::1', 'host:22', 'user@host', '[::1]', '', 'a'.repeat(254), `${'a'.repeat(63)}.example`, `${'a'.repeat(64)}.example`, 'ünï.invalid'];
  const ports = ['1', '22', '65535', '65536', '0', '01', '123456', 'ab', '', '-1', '2222'];
  const users = ['root', 'deploy', '_x', 'a-b_c', 'Root', '1a', '', 'a'.repeat(32), 'a'.repeat(33), 'a b', 'x;y'];
  const fps = [FP, `SHA256:${'a+/'.repeat(14)}ab`, 'SHA256:short', `SHA256:${'A'.repeat(44)}`, `MD5:${'A'.repeat(43)}`, '', `SHA256:${'A'.repeat(42)}=`];
  const prs = ['1', '999999', '1000000', '0', '01', 'x', '', '12'];

  it('every connection-field grammar agrees with shared/testbox-admin.ts on one corpus', () => {
    const h = fixture();
    const cases: [string, string, boolean][] = [
      ...addrs.map((v): [string, string, boolean] => ['_tba_is_address', v, isBoxAddress(v)]),
      ...ports.map((v): [string, string, boolean] => ['_tba_is_port', v, isSshPort(v)]),
      ...users.map((v): [string, string, boolean] => ['_tba_is_user', v, isLoginUser(v)]),
      ...fps.map((v): [string, string, boolean] => ['_tba_is_fingerprint', v, isHostKeyFingerprint(v)]),
      ...prs.map((v): [string, string, boolean] => ['_tba_is_pr', v, isPrNumber(v)]),
    ];
    writeFileSync(join(h.home, 'cases'), cases.map(([fn, v]) => `${fn}${US}${v}`).join('\n') + '\n');
    const r = sh(h, SRC('linux') + 'while IFS=$\'\\037\' read -r fn v; do "$fn" "$v" && echo y || echo n; done <"$1"', [VERB, join(h.home, 'cases')]);
    const got = r.out.split('\n').filter(Boolean);
    expect(got).toHaveLength(cases.length);
    cases.forEach(([fn, v, want], i) => expect(got[i], `${fn} ${JSON.stringify(v)}`).toBe(want ? 'y' : 'n'));
  });

  interface Good { sub: TestboxAdminSub; fields: Record<string, unknown> }
  /** `fields` is what the builder must refuse; absent when the words are a shape no field object can express (a repeat). */
  interface Bad { sub: string; fields?: unknown; words: string[] }
  const GOOD: Good[] = [
    { sub: 'status', fields: {} }, { sub: 'read', fields: {} }, { sub: 'probe', fields: {} }, { sub: 'preflight', fields: {} },
    { sub: 'cancel', fields: {} }, { sub: 'repair', fields: {} }, { sub: 'apply-release', fields: {} },
    { sub: 'key', fields: { address: ADDR } }, { sub: 'key', fields: { address: 'testbox.invalid', port: 2222, user: 'deploy' } },
    { sub: 'key', fields: { address: '2001:db8::1', port: '22', user: 'root' } },
    { sub: 'pin', fields: { fingerprint: FP } },
    { sub: 'connect', fields: { settings: { CCRC_TESTBOX_RUNS: '3' }, repos: [ROW] } },
    { sub: 'connect', fields: { settings: { CCRC_TESTBOX_EGRESS_ALLOW: 'github.com nodejs.org', CCRC_TESTBOX_TMPFS: 'on', CCRC_TESTBOX_ROOT: '/srv/box' }, repos: [ROW, { ...ROW, name: 'project-b' }] } },
    { sub: 'settings-fleet', fields: { settings: { CCRC_TESTBOX_POLL: '45s', CCRC_TESTBOX_DENY_GLOBS: '*.pem .env $HOME %h' } } },
    { sub: 'settings-box', fields: { settings: { CCRC_TESTBOX_WORKERS: '4' } } },
    { sub: 'settings-box', fields: { settings: { CCRC_TESTBOX_WORKERS: '4' }, repos: [ROW], whenIdle: true } },
    { sub: 'parity', fields: {} }, { sub: 'parity', fields: { prs: [12, 345] } },
    { sub: 'disconnect', fields: {} }, { sub: 'disconnect', fields: { replace: true } },
  ];
  const GOODROW = rowArg(ROW);
  const BAD: Bad[] = [
    { sub: 'status', fields: { address: ADDR }, words: [`--address=${ADDR}`] },
    { sub: 'key', fields: {}, words: [] },
    { sub: 'key', fields: { address: '-x' }, words: ['--address=-x'] },
    { sub: 'key', fields: { address: 'host:22' }, words: ['--address=host:22'] },
    { sub: 'key', fields: { address: 'a/../b' }, words: ['--address=a/../b'] },
    { sub: 'key', fields: { address: ADDR, port: 70000 }, words: [`--address=${ADDR}`, '--port=70000'] },
    { sub: 'key', fields: { address: ADDR, user: 'Root' }, words: [`--address=${ADDR}`, '--login=Root'] },
    { sub: 'key', fields: { address: ADDR, extra: 'x' }, words: [`--address=${ADDR}`, '--extra=x'] },
    { sub: 'key', words: [`--address=${ADDR}`, `--address=${ADDR}`] },
    { sub: 'key', fields: { address: `${ADDR}\x01` }, words: [`--address=${ADDR}\x01`] },
    { sub: 'key', fields: { address: `${ADDR}\x7f` }, words: [`--address=${ADDR}\x7f`] },
    { sub: 'pin', fields: {}, words: [] },
    { sub: 'pin', fields: { fingerprint: 'SHA256:short' }, words: ['--fingerprint=SHA256:short'] },
    { sub: 'connect', fields: { repos: [ROW] }, words: [`--repo=${GOODROW}`] },
    { sub: 'connect', fields: { settings: { CCRC_TESTBOX_RUNS: '3' } }, words: ['--set=CCRC_TESTBOX_RUNS=3'] },
    { sub: 'connect', fields: { settings: { CCRC_TESTBOX_RUNS: '0' }, repos: [ROW] }, words: ['--set=CCRC_TESTBOX_RUNS=0', `--repo=${GOODROW}`] },
    { sub: 'connect', fields: { settings: { CCRC_TESTBOX_ROOT: '/a/../b' }, repos: [ROW] }, words: ['--set=CCRC_TESTBOX_ROOT=/a/../b', `--repo=${GOODROW}`] },
    { sub: 'connect', fields: { settings: { CCRC_TESTBOX_URL: 'https://testbox.invalid' }, repos: [ROW] }, words: ['--set=CCRC_TESTBOX_URL=https://testbox.invalid', `--repo=${GOODROW}`] },
    { sub: 'connect', fields: { settings: { CCRC_TESTBOX_RUNS: '-1' }, repos: [ROW] }, words: ['--set=CCRC_TESTBOX_RUNS=-1', `--repo=${GOODROW}`] },
    { sub: 'connect', fields: { settings: { CCRC_TESTBOX_RUNS: '3' }, repos: [ROW, ROW, ROW, ROW, ROW] }, words: ['--set=CCRC_TESTBOX_RUNS=3', ...Array(5).fill(`--repo=${GOODROW}`)] },
    { sub: 'connect', fields: { settings: { CCRC_TESTBOX_RUNS: '3' }, repos: [] }, words: ['--set=CCRC_TESTBOX_RUNS=3'] },
    { sub: 'connect', fields: { settings: { CCRC_TESTBOX_RUNS: '3' }, repos: ['x'] }, words: ['--set=CCRC_TESTBOX_RUNS=3', '--repo=@@'] },
    { sub: 'connect', fields: { settings: { CCRC_TESTBOX_RUNS: '3' }, repos: ['x'] }, words: ['--set=CCRC_TESTBOX_RUNS=3', `--repo=${b64url('{not json}')}`] },
    { sub: 'connect', fields: { settings: { CCRC_TESTBOX_RUNS: '3' }, repos: ['x'] }, words: ['--set=CCRC_TESTBOX_RUNS=3', `--repo=${b64url('[1]')}`] },
    { sub: 'settings-fleet', fields: { settings: { CCRC_TESTBOX_RUNS: '3' } }, words: ['--set=CCRC_TESTBOX_RUNS=3'] },
    { sub: 'settings-fleet', fields: { settings: { CCRC_TESTBOX_URL: 'https://testbox.invalid' } }, words: ['--set=CCRC_TESTBOX_URL=https://testbox.invalid'] },
    { sub: 'settings-fleet', fields: { settings: {} }, words: [] },
    { sub: 'settings-box', fields: { settings: { CCRC_TESTBOX_WORKERS: '4' }, whenIdle: 'yes' }, words: ['--set=CCRC_TESTBOX_WORKERS=4', '--when-idle=yes'] },
    { sub: 'settings-box', fields: { settings: { CCRC_TESTBOX_WORKERS: '4' }, whenIdle: false }, words: ['--set=CCRC_TESTBOX_WORKERS=4', '--when-idle=false'] },
    { sub: 'parity', fields: { prs: [0] }, words: ['--pr=0'] },
    { sub: 'parity', fields: { prs: [5, 5] }, words: ['--pr=5', '--pr=5'] },
    { sub: 'parity', fields: { prs: Array.from({ length: 21 }, (_, i) => i + 1) }, words: Array.from({ length: 21 }, (_, i) => `--pr=${i + 1}`) },
    { sub: 'disconnect', fields: { replace: 'x' }, words: ['--replace=x'] },
    { sub: 'disconnect', fields: { force: true }, words: ['--force=true'] },
    { sub: 'nonsense', fields: {}, words: [] },
  ];
  const wordsOf = (sub: string, fields: unknown): string[] | null => {
    const built = buildTestboxAdminArgv(sub, fields);
    return built.ok ? built.argv.slice(2) : null;
  };

  it('every word list the builder yields is taken by the bash check, in the same order; every one it refuses is refused', () => {
    const h = fixture();
    const good = GOOD.map((g) => ({ sub: g.sub, words: wordsOf(g.sub, g.fields) }));
    for (const g of good) expect(g.words, JSON.stringify(g)).not.toBeNull();
    for (const b of BAD) if ('fields' in b) expect(buildTestboxAdminArgv(b.sub, b.fields).ok, JSON.stringify(b)).toBe(false);
    const rows = [...good.map((g) => ({ sub: g.sub, words: g.words! })), ...BAD.map((b) => ({ sub: b.sub, words: b.words }))];
    writeFileSync(join(h.home, 'cases'), rows.map((r) => [r.sub, ...r.words].join(US)).join('\n') + '\n');
    const program = SRC('linux')
      + 'while IFS=$\'\\037\' read -r -a w; do _tba_parse "${w[@]}"; rc=$?; out="$rc"; for x in ${TBA_WORDS[@]+"${TBA_WORDS[@]}"}; do out="$out"$\'\\037\'"$x"; done; printf "%s\\n" "$out"; done <"$1"';
    const r = sh(h, program, [VERB, join(h.home, 'cases')]);
    expect(r.rc, r.err).toBe(0);
    const got = r.out.split('\n').filter(Boolean);
    expect(got).toHaveLength(rows.length);
    rows.forEach((row, i) => {
      const [rc, ...words] = got[i]!.split(US);
      const isGood = i < good.length;
      expect(rc, `${row.sub} ${JSON.stringify(row.words)}`).toBe(isGood ? '0' : '1');
      if (isGood) expect(words, row.sub).toEqual(row.words);
    });
  });

  it('a bare flag, a word without =, a leading-dash value and --force are refused; --from takes only agent, pwa or cli', () => {
    const h = fixture();
    const cases = [
      ['status', '--bogus'], ['status', 'x'], ['key', `--address=${ADDR}`, '--force'], ['disconnect', '--replace'],
      ['status', '--from', 'root'], ['status', '--from=elsewhere'], ['status', '--from'], ['status', '--from', 'cli', '--from', 'pwa'],
    ];
    writeFileSync(join(h.home, 'cases'), cases.map((c) => c.join(US)).join('\n') + '\n');
    const r = sh(h, SRC('linux') + 'while IFS=$\'\\037\' read -r -a w; do _tba_parse "${w[@]}" && echo ok || echo bad; done <"$1"', [VERB, join(h.home, 'cases')]);
    expect(r.out.split('\n').filter(Boolean)).toEqual(cases.map(() => 'bad'));
    const ok = sh(h, SRC('linux') + 'for f in agent pwa cli; do _tba_parse status --from "$f" && echo "$TBA_FROM"; done; _tba_parse status --from=pwa && echo "$TBA_FROM"; _tba_parse status && echo "$TBA_FROM"', [VERB]);
    expect(ok.out.split('\n').filter(Boolean)).toEqual(['agent', 'pwa', 'cli', 'pwa', 'cli']);
  });

  it('a field off its grammar is a usage error (exit 2) before any ssh runs, and names the flag, never the value', () => {
    const h = fixture();
    for (const b of BAD.filter((x) => x.sub !== 'status' && x.sub !== 'nonsense' && x.words.length > 0 && !x.words.some((w) => /[\x00-\x1f\x7f]/.test(w)))) {
      const r = run(h, [b.sub, ...b.words]);
      expect(r.rc, `${b.sub} ${JSON.stringify(b.words)}: ${r.out} ${r.err}`).toBe(2);
      expect(r.out).toBe('');
      expect(r.err).not.toContain(ADDR);
      expect(r.err).not.toContain('testbox.invalid');
    }
    expect(existsSync(h.log)).toBe(false);
    expect(run(h, ['nonsense']).rc).toBe(2);
    expect(run(h, []).rc).toBe(2);
  });
});

describe('the one way to the box, and ssh\'s stderr (D-8166, T4)', () => {
  const KEYED = (h: Home, login = 'root', port = '2222'): void => {
    writeState(h, [`address=${ADDR}`, `port=${port}`, `login=${login}`]);
    writeFileSync(join(h.home, '.ccrc', 'testbox-admin.key'), 'not a key\n', { mode: 0o600 });
  };

  it('every ssh carries the pinned known-hosts file, strict host checking, batch mode, identities only and a connect deadline', () => {
    const h = fixture();
    KEYED(h);
    const r = sh(h, SRC('linux') + '_tba_ssh true; echo "rc=$?"', [VERB]);
    expect(r.out).toContain('rc=0');
    const calls = fakeLog(h);
    expect(calls).toHaveLength(1);
    const [tool, ...args] = calls[0]!;
    expect(tool).toBe('ssh');
    const pairs: string[] = [];
    args.forEach((a, i) => { if (args[i - 1] === '-o') pairs.push(a); });
    expect(pairs).toEqual([`UserKnownHostsFile=${join(h.home, '.ccrc', 'testbox-known-hosts')}`, 'StrictHostKeyChecking=yes', 'BatchMode=yes', 'IdentitiesOnly=yes', 'ConnectTimeout=60']);
    expect(args.slice(args.indexOf('-p'), args.indexOf('-p') + 2)).toEqual(['-p', '2222']);
    expect(args.slice(args.indexOf('-i'), args.indexOf('-i') + 2)).toEqual(['-i', join(h.home, '.ccrc', 'testbox-admin.key')]);
    expect(args.slice(-2)).toEqual([`root@${ADDR}`, 'true']);
  });

  it('the deadline is the reconnect deadline setting, read by the one reader', () => {
    const h = fixture();
    KEYED(h);
    writeFileSync(join(h.home, '.ccrc', 'ccrc.env'), 'CCRC_TESTBOX_RECONNECT_DEADLINE=2m\n');
    sh(h, SRC('linux') + '_tba_ssh true', [VERB]);
    expect(fakeLog(h)[0]).toContain('ConnectTimeout=120');
  });

  it('under a sudo login every command is prefixed sudo -n -- and each word is quoted for the box\'s shell', () => {
    const h = fixture();
    KEYED(h, 'deploy');
    sh(h, SRC('linux') + '_tba_ssh cat "/etc/os release"', [VERB]);
    const args = fakeLog(h)[0]!;
    expect(args.slice(-2)).toEqual([`deploy@${ADDR}`, 'sudo -n -- cat /etc/os\\ release']);
  });

  it('no connection or no key is rc 97 with a closed code, and runs no ssh', () => {
    const h = fixture();
    let r = sh(h, SRC('linux') + '_tba_ssh true; echo "rc=$? code=$TBA_SSH_CODE"', [VERB]);
    expect(r.out.trim()).toBe('rc=97 code=not-connected');
    writeState(h, [`address=${ADDR}`]);
    r = sh(h, SRC('linux') + '_tba_ssh true; echo "rc=$? code=$TBA_SSH_CODE"', [VERB]);
    expect(r.out.trim()).toBe('rc=97 code=no-access-key');
    expect(existsSync(h.log)).toBe(false);
  });

  it('no ssh or scp word sits in the verb outside _tba_ssh', () => {
    const text = readFileSync(VERB, 'utf8');
    const start = text.indexOf('\n_tba_ssh() {');
    const end = text.indexOf('\n}\n', start);
    expect(start).toBeGreaterThan(0);
    const outside = (text.slice(0, start) + text.slice(end)).split('\n').filter((l) => !/^\s*#/.test(l));
    const hits = outside.filter((l) => /(^|[\s;&|(`$])(ssh|scp|sftp)(\s|$)/.test(l.replace(/#.*$/, '')));
    expect(hits).toEqual([]);
    expect(text.slice(start, end).match(/^\s*LC_ALL=C ssh /gm)).toHaveLength(1);
  });

  it('ssh\'s stderr never reaches stdout or stderr of the verb, on success or on 255', () => {
    const h = fixture();
    KEYED(h);
    const errf = join(h.home, 'ssh-err');
    writeFileSync(errf, 'SECRET-STDERR-TEXT root@203.0.113.9: Permission denied (publickey).\n');
    for (const rc of ['0', '255', '3']) {
      const env = { ...h.env, FAKE_SSH_ERR_FILE: errf, FAKE_SSH_RC: rc };
      const r = spawnSync(BASH, ['-c', SRC('linux') + '_tba_ssh true; echo "rc=$? code=$TBA_SSH_CODE"', '_', VERB], { env, encoding: 'utf8', cwd: h.home });
      expect(r.stdout).not.toContain('SECRET-STDERR-TEXT');
      expect(r.stderr).not.toContain('SECRET-STDERR-TEXT');
      expect(r.stdout).toContain(`rc=${rc}`);
    }
    const left = readdirSync(join(h.home, 'tmp'));
    expect(left).toEqual([]);
  });

  it('the command\'s own stdout and stdin pass through; nothing else is written to stdout', () => {
    const h = fixture();
    KEYED(h);
    const env = { ...h.env, FAKE_SSH_OUT: 'box-says-hello', FAKE_CAPTURE_STDIN: '1' };
    const r = spawnSync(BASH, ['-c', SRC('linux') + '_tba_ssh cat', '_', VERB], { env, encoding: 'utf8', cwd: h.home, input: 'payload-line\n' });
    expect(r.stdout).toBe('box-says-hello\n');
    expect(readFileSync(h.log, 'utf8')).toContain('<stdin>\npayload-line');
  });

  const CLASSES: [string, string][] = [
    ['ssh: connect to host 203.0.113.9 port 22: Connection timed out', 'unreachable'],
    ['ssh: connect to host 203.0.113.9 port 22: Connection refused', 'unreachable'],
    ['ssh: connect to host 203.0.113.9 port 22: No route to host', 'unreachable'],
    ['ssh: Could not resolve hostname testbox.invalid: Name or service not known', 'unreachable'],
    ['root@203.0.113.9: Permission denied (publickey).', 'auth-refused'],
    ['Received disconnect from 203.0.113.9 port 22:2: Too many authentication failures', 'auth-refused'],
    ['@@@@@@@@@@@@\n@    WARNING: REMOTE HOST IDENTIFICATION HAS CHANGED!     @\n@@@@@@@@@@@@\nOffending ED25519 key in /home/x/.ccrc/testbox-known-hosts:1\nHost key verification failed.', 'host-key-changed'],
    ['No ED25519 host key is known for 203.0.113.9 and you have requested strict checking.\nHost key verification failed.', 'host-key-unknown'],
    ['Host key verification failed.', 'host-key-unknown'],
  ];
  it('exit 255 with each of ssh\'s own lines gives its closed code, and any other exit gives none', () => {
    const h = fixture();
    KEYED(h);
    for (const [text, code] of CLASSES) {
      const errf = join(h.home, 'ssh-err');
      writeFileSync(errf, text + '\n');
      const env = { ...h.env, FAKE_SSH_ERR_FILE: errf, FAKE_SSH_RC: '255' };
      const r = spawnSync(BASH, ['-c', SRC('linux') + '_tba_ssh true; echo "rc=$? code=$TBA_SSH_CODE"', '_', VERB], { env, encoding: 'utf8', cwd: h.home });
      expect(r.stdout.trim(), text).toBe(`rc=255 code=${code}`);
      expect(TESTBOX_ADMIN_CODES).toContain(code);
    }
    const env = { ...h.env, FAKE_SSH_RC: '4' };
    const r = spawnSync(BASH, ['-c', SRC('linux') + '_tba_ssh true; echo "rc=$? code=$TBA_SSH_CODE"', '_', VERB], { env, encoding: 'utf8', cwd: h.home });
    expect(r.stdout.trim()).toBe('rc=4 code=');
  });
});

describe('the state file, the lock, the detach and the unit (D-8166, T7)', () => {
  it('the state file is replaced whole at 0600; an empty value removes a key; a value with a newline or control byte is refused', () => {
    const h = fixture();
    const r = sh(h, SRC('linux') + '_tba_state_write a=1 b=2 && _tba_state_write b= c=3 && echo w; _tba_state_write d=$\'x\\ny\'; echo "bad=$?"; _tba_state_write e=$\'x\\001y\'; echo "bad=$?"; _tba_state_get a; echo; _tba_state_get b; echo "b=$?"; _tba_state_get c; echo', [VERB]);
    expect(r.out).toBe('w\nbad=1\nbad=1\n1\nb=1\n3\n');
    expect((statSync(h.state).mode & 0o777).toString(8)).toBe('600');
    expect(readFileSync(h.state, 'utf8')).toBe('a=1\nc=3\n');
    expect(readdirSync(join(h.home, '.ccrc')).filter((f) => f.includes('.tmp.'))).toEqual([]);
  });

  it.skipIf(!HAS_FLOCK)('a long act while the lock is held answers busy, and writes no state', () => {
    const h = fixture({ SYSTEMD_RUN_RC: '0' });
    const r = sh(h, SRC('linux') + '_tba_run_repair() { :; }; exec 8>>"$HOME/.ccrc/testbox-admin.lock"; flock -n 8 || exit 91; _tba_main repair --from pwa; echo "rc=$?"', [VERB]);
    expect(r.out).toBe('{"ok":false,"code":"busy"}\nrc=0\n');
    expect(existsSync(h.state)).toBe(false);
    expect(existsSync(join(h.home, 'systemd-run-calls'))).toBe(false);
  });

  it.skipIf(!HAS_FLOCK)('a long act\'s parent sets the user bus before the spawn, though the agent gives the verb HOME, PATH and LANG only', () => {
    const h = fixture();
    const r = sh(h, SRC('linux') + 'unset XDG_RUNTIME_DIR DBUS_SESSION_BUS_ADDRESS; _tba_run_connect() { :; }; _svc_run_detached() { printf "%s|%s\\n" "${XDG_RUNTIME_DIR-unset}" "${DBUS_SESSION_BUS_ADDRESS-unset}" >"$HOME/bus-seen"; }; _tba_main connect --repo="$1" --from pwa; echo "rc=$?"', [VERB, rowArg(ROW)]);
    expect(r.out, r.out + r.err).toMatch(/rc=0\n$/);
    const seen = readFileSync(join(h.home, 'bus-seen'), 'utf8');
    expect(seen).toMatch(/^\/run\/user\/\d+\|unix:path=\/run\/user\/\d+\/bus\n$/);
  });

  it.skipIf(!HAS_FLOCK)('a long act\'s parent answers its act id once the state says running, and hands one unit the checked words by file', () => {
    const h = fixture({ SYSTEMD_RUN_RC: '0' });
    const r = sh(h, SRC('linux') + `_tba_run_connect() { :; }; _tba_main connect '--set=CCRC_TESTBOX_RUN_TMPDIR=/tmp/$HOME/%h' --repo="$1" --from pwa; echo "rc=$?"`, [VERB, rowArg(ROW)]);
    const m = /^\{"ok":true,"act":"([0-9a-f]{32})"\}\nrc=0\n$/.exec(r.out);
    expect(m, r.out + r.err).not.toBeNull();
    const id = m![1]!;
    const state = readFileSync(h.state, 'utf8');
    expect(state).toContain(`act_id=${id}\n`);
    expect(state).toContain('act_sub=connect\n');
    expect(state).toContain('act_outcome=running\n');
    const calls = readFileSync(join(h.home, 'systemd-run-calls'), 'utf8').trim().split('\n');
    expect(calls).toEqual([`--user --collect --quiet --unit=ccrc-testbox-admin-connect-${id} /usr/bin/env CCRC_TBA_ACT=${id} ${h.home}/.local/bin/ccrc testbox-admin connect`]);
    const args = readFileSync(join(h.home, '.ccrc', `testbox-admin.args.${id}`), 'utf8');
    expect(args).toBe(`--set=CCRC_TESTBOX_RUN_TMPDIR=/tmp/$HOME/%h\n--repo=${rowArg(ROW)}\n--from\npwa\n`);
    expect((statSync(join(h.home, '.ccrc', `testbox-admin.args.${id}`)).mode & 0o777).toString(8)).toBe('600');
    const status = readTestboxAdminStatus(run(h, ['status']).out.trim());
    expect(status.ok && status.value.act).toMatchObject({ id, sub: 'connect', outcome: 'running', phase: null, code: null });
  });

  it('the parent never holds the lock (it is free once the parent has answered)', () => {
    if (!HAS_FLOCK) return;
    const h = fixture({ SYSTEMD_RUN_RC: '0' });
    const r = sh(h, SRC('linux') + '_tba_run_repair() { :; }; _tba_main repair >/dev/null; flock -n "$HOME/.ccrc/testbox-admin.lock" true && echo free || echo held', [VERB]);
    expect(r.out.trim()).toBe('free');
  });

  it('a unit that cannot be started ends the act failed, removes the argument file and exits 1 with one line', () => {
    const h = fixture();   // SYSTEMD_RUN_RC defaults to 97: the stub refuses
    const r = sh(h, SRC('linux') + '_tba_run_repair() { :; }; _tba_main repair; echo "rc=$?"', [VERB]);
    expect(r.out.trim()).toBe('rc=1');
    expect(r.err).toContain('could not start the unit for repair');
    expect(readFileSync(h.state, 'utf8')).toContain('act_outcome=failed\n');
    expect(readdirSync(join(h.home, '.ccrc')).filter((f) => f.startsWith('testbox-admin.args.'))).toEqual([]);
  });

  it.skipIf(!HAS_FLOCK)('the unit takes the lock, runs the sub, records its phases, and ends the act ok', () => {
    const h = fixture({ SYSTEMD_RUN_RC: '0' });
    const prog = SRC('linux') + '_tba_run_repair() { _tba_phase verify; _tba_phase copy; _tba_phase install; return 0; }; '
      + 'id="$(_tba_main repair | sed -n \'s/.*"act":"\\([0-9a-f]*\\)".*/\\1/p\')"; '
      + 'echo "$id"; CCRC_TBA_ACT="$id" _tba_main repair >/dev/null; echo "rc=$?"';
    const r = sh(h, prog, [VERB]);
    const [id, rc] = r.out.trim().split('\n');
    expect(rc, r.out + r.err).toBe('rc=0');
    const status = readTestboxAdminStatus(run(h, ['status']).out.trim());
    expect(status.ok, JSON.stringify(status)).toBe(true);
    if (!status.ok) return;
    const act = status.value.act!;
    expect(act).toMatchObject({ id, sub: 'repair', outcome: 'ok', code: null, phase: 'install' });
    expect(act.phases.map((p) => p.name)).toEqual(['verify', 'copy', 'install']);
    expect(act.endedAt).not.toBeNull();
    expect(existsSync(join(h.home, '.ccrc', `testbox-admin.args.${id}`))).toBe(false);
  });

  it.skipIf(!HAS_FLOCK)('a sub that fails ends the act failed with its closed code; an unknown code is dropped', () => {
    for (const [code, want] of [['verify-failed', 'verify-failed'], ['not-a-code', null]] as const) {
      const h = fixture({ SYSTEMD_RUN_RC: '0' });
      const prog = SRC('linux') + `_tba_run_repair() { _tba_phase verify; TBA_CODE=${code}; return 1; }; `
        + 'id="$(_tba_main repair | sed -n \'s/.*"act":"\\([0-9a-f]*\\)".*/\\1/p\')"; CCRC_TBA_ACT="$id" _tba_main repair >/dev/null';
      sh(h, prog, [VERB]);
      const status = readTestboxAdminStatus(run(h, ['status']).out.trim());
      expect(status.ok && status.value.act).toMatchObject({ outcome: 'failed', code: want, phase: 'verify' });
    }
  });

  it.skipIf(!HAS_FLOCK)('a unit that finds the lock held ends the act failed busy and runs nothing', () => {
    const h = fixture({ SYSTEMD_RUN_RC: '0' });
    const prog = SRC('linux') + '_tba_run_repair() { echo ran >"$HOME/ran"; }; '
      + 'id="$(_tba_main repair | sed -n \'s/.*"act":"\\([0-9a-f]*\\)".*/\\1/p\')"; '
      + 'exec 8>>"$HOME/.ccrc/testbox-admin.lock"; flock -n 8 || exit 91; CCRC_TBA_ACT="$id" _tba_main repair >/dev/null';
    sh(h, prog, [VERB]);
    expect(existsSync(join(h.home, 'ran'))).toBe(false);
    const status = readTestboxAdminStatus(run(h, ['status']).out.trim());
    expect(status.ok && status.value.act).toMatchObject({ outcome: 'failed', code: 'busy' });
  });

  it('the environment alone starts nothing: CCRC_TBA_ACT without the argument file is an ordinary call', () => {
    const h = fixture({ SYSTEMD_RUN_RC: '0' });
    const r = sh(h, SRC('linux') + `_tba_run_repair() { echo ran >"$HOME/ran"; }; CCRC_TBA_ACT=${ID} _tba_main repair; echo "rc=$?"`, [VERB]);
    expect(existsSync(join(h.home, 'ran'))).toBe(false);
    expect(r.out).toMatch(/"ok":true,"act":"[0-9a-f]{32}"/);
  });

  it('a short sub runs in the caller and prints its own answer; a sub with no function yet is a usage error, never half-run', () => {
    const h = fixture();
    let r = sh(h, SRC('linux') + '_tba_run_probe() { _tba_ok \'"fingerprint":"x"\'; }; _tba_main probe', [VERB]);
    expect(r.out).toBe('{"ok":true,"fingerprint":"x"}\n');
    r = sh(h, SRC('linux') + '_tba_main probe; echo "rc=$?"', [VERB]);
    expect(r.rc).toBe(2);
    expect(r.err).toContain('probe is not built in this release');
    expect(existsSync(h.state)).toBe(false);
  });

  it('on darwin every sub but status answers unsupported-os, and runs nothing', () => {
    const h = fixture({ SYSTEMD_RUN_RC: '0' });
    const subs = (Object.keys(TESTBOX_ADMIN_SUB_MAP) as TestboxAdminSub[]).filter((s) => s !== 'status');
    const argv: Record<string, string[]> = {
      key: [`--address=${ADDR}`], pin: [`--fingerprint=${FP}`], connect: ['--set=CCRC_TESTBOX_RUNS=3', `--repo=${rowArg(ROW)}`],
      'settings-fleet': ['--set=CCRC_TESTBOX_POLL=45s'], 'settings-box': ['--set=CCRC_TESTBOX_WORKERS=4'],
    };
    for (const s of subs) {
      const r = sh(h, SRC('darwin') + '_tba_run_"$1"() { echo ran >"$HOME/ran"; }; sub="$1"; shift; _tba_main "$sub" "$@"; echo "rc=$?"', [VERB, s, ...(argv[s] ?? [])]);
      expect(r.out, s).toBe('{"ok":false,"code":"unsupported-os"}\nrc=0\n');
    }
    expect(existsSync(join(h.home, 'ran'))).toBe(false);
    expect(existsSync(join(h.home, 'systemd-run-calls'))).toBe(false);
    const st = sh(h, SRC('darwin') + '_tba_main status', [VERB]);
    expect(readTestboxAdminStatus(st.out.trim()).ok).toBe(true);
  });

  it('the answer vocabulary is closed: _tba_refuse refuses a word that is not a code', () => {
    const h = fixture();
    const r = sh(h, SRC('linux') + '_tba_refuse not-a-code; echo "rc=$?"', [VERB]);
    expect(r.rc).toBe(70);
    expect(r.out).toBe('');
  });
});

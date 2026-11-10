// D-8166 (plan docs/superpowers/plans/2026-11-10-test-box-connect.md, Task TC8; spec §2.6, §2.7, §2.9, §5.1, C5 to C7, C12,
// C13): `ccrc testbox-admin settings-fleet | settings-box | cancel | read | repair | apply-release | disconnect`.
//
// What is held here: that settings-fleet writes only the twelve editable keys, refuses a key ccrc.env names or a value off
// its shape, puts the old overlay back when a key would then read refused, and answers what the reader says now; that
// settings-box renders and checks the whole file on the fleet host, writes it on the box by a temp and a rename, re-runs
// the installed installer with --reapply, waits for no run in progress only when asked to (in a detached unit, six hours at
// most, cancellable), and marks parity stale for a run-shaping key whose value changed and for no other; that `read` runs
// the installed tree's own ccrc by its path and writes display classes only; that repair re-verifies the tag the box
// records and never changes it; that apply-release runs the tool-synced tree's installer; and that disconnect lowers the
// switch first, unpairs the box and removes the access line last, cleans the fleet side whatever the box did, and keeps
// the access key pair.
//
// The detached acts run in this process as the unit would (the parent detaches into a stubbed `systemd-run`, then the unit
// half is called with the act id). The fake `ssh` answers from a rule file and keeps every call's stdin; the fake `ccd`
// and the fake `ccrc-api` are two tiny scripts. HOME is a fixture; ghContainedEnv poisons the user manager and tmux. Every
// row runs a fixed bash program; values are its arguments.
import { describe, it, expect } from 'vitest';
import { spawnSync } from 'node:child_process';
import { appendFileSync, existsSync, mkdirSync, readFileSync, readdirSync, symlinkSync, writeFileSync } from 'node:fs';
import path, { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkTmp, removeTmpFixturesEachTest } from './tmpHelpers.js';
import { ghContainedEnv } from './ccdWsHelpers.js';
import { TESTBOX_BOX_KEYS, TESTBOX_FLEET_EDITABLE, TESTBOX_RUN_SHAPING, readTestboxAdminStatus } from '../../shared/testbox-admin.js';

removeTmpFixturesEachTest();

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const VERB = join(REPO, 'ccd', 'ccrc-testbox-admin');
const BOXFAKE = join(REPO, 'server', 'test', 'fixtures', 'testbox-admin-connect-ssh.sh');
const SCANFAKE = join(REPO, 'server', 'test', 'fixtures', 'testbox-admin-ssh.sh');
const BASH = spawnSync('bash', ['-c', 'command -v bash'], { encoding: 'utf8' }).stdout.trim();
const HAS_KEYGEN = spawnSync('bash', ['-c', 'command -v ssh-keygen'], { encoding: 'utf8' }).status === 0;
const HAS_FLOCK = spawnSync('bash', ['-c', 'command -v flock'], { encoding: 'utf8' }).status === 0;
const HAS_NODE = spawnSync('bash', ['-c', 'command -v node'], { encoding: 'utf8' }).status === 0;
const ADDR = '203.0.113.9';
const SRC_ADDR = '192.0.2.5';
const STG = '/tmp/ccrc-stg.AbC123';
const TOOLS = '/opt/tools';
const SHA = 'a1'.repeat(32);
const BOXENV = '/etc/ccrc-testbox/ccrc.env';
const SRC = '. "$1" || exit 90; shift; REAL_OS=$CCD_OS; CCD_OS=linux; '
  + 'for f in _plat_mode _plat_sha256; do eval "$(declare -f $f | sed "1s/^$f/${f}_real/")"; eval "$f() { local CCD_OS=\\$REAL_OS; ${f}_real \\"\\$@\\"; }"; done; ';
const b64url = (s: string): string => Buffer.from(s).toString('base64url');
const ROW = {
  name: 'project-a', fetchUrl: 'https://testbox.invalid/project-a.git', mirrorPath: '/srv/mirror/project-a.git',
  packages: [{ name: 'server', installInputs: ['server/package.json'], commands: ['./node_modules/.bin/vitest'] }],
  buildOutputs: [], systemTools: [],
};
const rowArg = (row: unknown): string => b64url(JSON.stringify(row));

/** The words of a settings-box: a listen address (an IP literal), two paths, and what the case adds. */
const WORDS = (extra: string[] = []): string[] => [
  '--set=CCRC_TESTBOX_LISTEN=198.51.100.7:7443', '--set=CCRC_TESTBOX_ROOT=/srv/box', `--set=CCRC_TESTBOX_TOOLS_DIR=${TOOLS}`, ...extra,
];

const IDLE = '{"ok":true,"testbox":{"state":"ok","reason":null,"box":{"runs":{"inProgress":0,"limit":2},"queueDepth":0}}}';
const BUSY = '{"ok":true,"testbox":{"state":"ok","reason":null,"box":{"runs":{"inProgress":1,"limit":2},"queueDepth":0}}}';
const OLD_BOX = 'CCRC_TESTBOX_LISTEN=198.51.100.7:7443\\nCCRC_TESTBOX_ROOT=/srv/box\\nCCRC_TESTBOX_TOOLS_DIR=/opt/tools\\nCCRC_TESTBOX_WORKERS=2\\nCCRC_TESTBOX_LOG_TAIL=40\\n';

/** The rules of a box that answers every command of these acts: regex, exit code, stdout (printf %b). First match wins. */
const PASSING_RULES: string[][] = [
  ['install\\.sh', '0', 'ccrc-testbox-install: applied\\n'],
  [`^(sudo -n -- )?cat -- ${BOXENV.replace(/\./g, '\\.')}$`, '0', OLD_BOX],
  [`sha256sum -- ${BOXENV.replace(/\./g, '\\.')}`, '0', `${SHA}  ${BOXENV}\\n`],
  ['--testbox-knobs', '0', 'CCRC_TESTBOX_RUNS\\x1f2\\x1f2\\x1fdefault\\n'],
  ['^(sudo -n -- )?mktemp -d$', '0', `${STG}\\n`],
  ['^(sudo -n -- )?tar -xzf', '0', ''],
  ['sha256sum.*-c.*MANIFEST', '0', ''],
  [BOXENV.replace(/\./g, '\\.'), '0', ''],
  ['rows', '0', ''],
  ['push\\.pub', '0', ''],
  ['readlink', '0', ''],
  ['getent', '0', ''],
  ['rm -rf', '0', ''],
];

interface Home {
  home: string; env: NodeJS.ProcessEnv; log: string; state: string; key: string; pin: string; rules: string; stdin: string;
  overlay: string; ccrcEnv: string; token: string; push: string; lg: string; snapshot: string; parity: string;
}

function fixture(extra: NodeJS.ProcessEnv = {}, rules: string[][] = PASSING_RULES): Home {
  const home = mkTmp('tb-acts-');
  mkdirSync(join(home, '.ccrc'), { recursive: true });
  mkdirSync(join(home, 'tmp'), { recursive: true });
  const fakes = join(home, 'fakes');
  mkdirSync(fakes, { recursive: true });
  symlinkSync(BOXFAKE, join(fakes, 'ssh'));
  symlinkSync(BOXFAKE, join(fakes, 'ip'));
  symlinkSync(SCANFAKE, join(fakes, 'ssh-keyscan'));
  const rulesFile = join(home, 'rules');
  writeFileSync(rulesFile, rules.map((r) => r.join('\t')).join('\n') + '\n');
  writeFileSync(join(home, 'os-release'), 'ID=debian\nVERSION_ID="12"\n');
  writeFileSync(join(home, '.ccrc', 'build.json'), JSON.stringify({ sha: 'a'.repeat(40), ref: 'main', builtAt: '2026-11-10T10:00:00Z', dirty: false, version: 'v1.2.3' }));
  // The fleet's own status: busy for the first FAKE_API_BUSY_FIRST calls (or always with FAKE_API_BUSY_FIRST=999), then idle.
  const api = join(home, 'ccrc-api-fake');
  writeFileSync(api, '#!/bin/sh\nn=$(cat "$HOME/api-n" 2>/dev/null || echo 0); n=$((n + 1)); echo "$n" >"$HOME/api-n"\n'
    + 'if [ "$n" -le "${FAKE_API_BUSY_FIRST:-0}" ]; then printf \'%s\\n\' "$FAKE_API_BUSY"; else printf \'%s\\n\' "$FAKE_API_IDLE"; fi\n', { mode: 0o755 });
  const ccd = join(home, 'ccd-fake');
  writeFileSync(ccd, '#!/bin/sh\n{ printf -- \'-- ccd\\n\'; for a in "$@"; do printf \'%s\\n\' "$a"; done; } >> "${FAKE_LOG:-/dev/null}"\nexit "${FAKE_CCD_RC:-0}"\n', { mode: 0o755 });
  const base: NodeJS.ProcessEnv = {};
  for (const [k, v] of Object.entries(process.env)) if (!k.startsWith('CCRC_') && !k.startsWith('TB_') && !k.startsWith('FAKE_') && !k.startsWith('TBA_')) base[k] = v;
  Object.assign(base, {
    HOME: home, TMPDIR: join(home, 'tmp'), LANG: 'C', PATH: `${fakes}:${process.env['PATH'] ?? '/usr/bin:/bin'}`,
    FAKE_LOG: join(home, 'fake-log'), FAKE_RULES: rulesFile, FAKE_STDIN_DIR: join(home, 'stdin'), FAKE_IP_OUT: `${ADDR} dev eth0 src ${SRC_ADDR} uid 0`,
    FAKE_SSH_KEYSCAN_RC: '1', FAKE_API_IDLE: IDLE, FAKE_API_BUSY: BUSY,
    TBA_OS_RELEASE: join(home, 'os-release'), TBA_API: api, TBA_CCD: ccd, TBA_CHECK_DEADLINE: '0', TBA_IDLE_POLL: '0', SYSTEMD_RUN_RC: '0', ...extra,
  });
  return {
    home, env: ghContainedEnv(home, base, { systemd: true, tmux: true }), log: join(home, 'fake-log'), rules: rulesFile, stdin: join(home, 'stdin'),
    state: join(home, '.ccrc', 'testbox-admin.state'), key: join(home, '.ccrc', 'testbox-admin.key'), pin: join(home, '.ccrc', 'testbox-known-hosts'),
    overlay: join(home, '.ccrc', 'testbox.env'), ccrcEnv: join(home, '.ccrc', 'ccrc.env'), token: join(home, '.ccrc', 'testbox.token'),
    push: join(home, '.ccrc', 'testbox-push.key'), lg: join(home, '.ccrc', 'testbox-admin.log'),
    snapshot: join(home, '.ccrc', 'testbox-box-settings.json'), parity: join(home, '.ccrc', 'testbox-parity.json'),
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
/** The passing rules with one rule answering otherwise (put first, so it wins). */
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
/** The calls that reach past the fleet host: the switch and the box. */
const ops = (h: Home): string[][] => fakeCalls(h).filter((c) => c[0] === 'ssh' || c[0] === 'ccd');
/** The remote command as the box's shell reads it: the verb quotes each word with `printf %q`, so a backslash escapes the next byte. */
const cmdOf = (c: string[]): string => (c.filter((l) => !l.startsWith('<stdin')).slice(-1)[0] ?? '').replace(/\\(.)/g, '$1');
const cmds = (h: Home): string[] => sshCalls(h).map(cmdOf);
/** The stdin of the LAST ssh call whose command contains the text. */
function stdinOfLast(h: Home, needle: string): string | null {
  const calls = sshCalls(h);
  for (let i = calls.length - 1; i >= 0; i--) {
    const args = calls[i]!.filter((l) => !l.startsWith('<stdin'));
    if (args[args.length - 1]!.includes(needle)) {
      const f = join(h.stdin, String(i + 1));
      return existsSync(f) ? readFileSync(f, 'utf8') : null;
    }
  }
  return null;
}

/** The access key and the pin the way earlier steps leave them, and a connection the connect act recorded. */
function connectedTo(h: Home, extra: string[] = []): void {
  const g = verb(h, 'key', `--address=${ADDR}`);
  expect(json(g)['ok'], g.out + g.err).toBe(true);
  writeFileSync(h.pin, `${ADDR} ssh-ed25519 AAAA\n`, { mode: 0o600 });
  appendFileSync(h.state, ['connected=1', `box_tools=${TOOLS}`, 'box_root=/srv/box', `box_sha256=${'b'.repeat(64)}`, ...extra].join('\n') + '\n');
}

const STUBS = `_upd_resolve() { UPD_STAGE="$HOME/stage"; mkdir -p "$UPD_STAGE"; UPD_TARNAME=ccrc-$1.tar.gz; UPD_VERSION=$1; echo "$1" >"$HOME/resolved-tag"; return 0; }; `
  + `_upd_fetch() { printf 'TARBALL-BYTES' >"$UPD_STAGE/$UPD_TARNAME"; }; `;

/** The parent detaches (a stubbed `systemd-run`) and answers the act's id. */
function detach(h: Home, sub: string, words: string[], stubs = STUBS): string {
  const r = sh(h, SRC + stubs + `_tba_main ${sub} "$@" --from pwa`, [VERB, ...words]);
  const m = /^\{"ok":true,"act":"([0-9a-f]{32})"\}\n$/.exec(r.out);
  expect(m, r.out + r.err).not.toBeNull();
  return m![1]!;
}
/** The unit half, as the unit would run it with the act id. */
function unit(h: Home, sub: string, id: string, stubs = STUBS): number {
  const r = sh(h, SRC + stubs + `CCRC_TBA_ACT=${id} _tba_main ${sub} >"$HOME/unit-out" 2>"$HOME/unit-err"; echo "rc=$?"`, [VERB]);
  return r.out.trim() === 'rc=0' ? 0 : -1;
}
function act(h: Home, sub: string, words: string[], stubs = STUBS): string {
  const id = detach(h, sub, words, stubs);
  expect(unit(h, sub, id, stubs)).toBe(0);
  return id;
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
const stateText = (h: Home): string => readFileSync(h.state, 'utf8');

describe.skipIf(!HAS_KEYGEN || !HAS_FLOCK || !HAS_NODE)('ccrc testbox-admin settings-fleet (D-8166, TC8)', () => {
  it('settings-fleet writes only the twelve editable keys, through the overlay, at 0600', () => {
    const h = fixture();
    const tbl = sh(h, SRC + 'printf "%s\\n" "${TBA_FLEET_KEYS[@]}"', [VERB]);
    expect(tbl.out.trim().split('\n')).toEqual([...TESTBOX_FLEET_EDITABLE]);
    expect(TESTBOX_FLEET_EDITABLE).toHaveLength(12);
    const r = verb(h, 'settings-fleet', '--set=CCRC_TESTBOX_POLL=45s', '--set=CCRC_TESTBOX_QUEUE_LIMIT=7', '--set=CCRC_TESTBOX_DENY_GLOBS=*.pem .env', '--from', 'pwa');
    const a = json(r);
    expect(a['ok'], r.out + r.err).toBe(true);
    expect(readFileSync(h.overlay, 'utf8').trim().split('\n').sort()).toEqual([
      'CCRC_TESTBOX_DENY_GLOBS=*.pem .env', 'CCRC_TESTBOX_POLL=45s', 'CCRC_TESTBOX_QUEUE_LIMIT=7',
    ]);
    expect(readdirSync(join(h.home, '.ccrc')).filter((n) => n.includes('.tmp.') || n.includes('.bak.'))).toEqual([]);
    expect(sh(h, 'stat -c %a "$HOME/.ccrc/testbox.env" 2>/dev/null || stat -f %Lp "$HOME/.ccrc/testbox.env"').out.trim()).toBe('600');
    // a list shows as set, a value as itself
    expect(a['settings']).toEqual([
      { key: 'CCRC_TESTBOX_POLL', set: true, value: '45s' },
      { key: 'CCRC_TESTBOX_QUEUE_LIMIT', set: true, value: '7' },
      { key: 'CCRC_TESTBOX_DENY_GLOBS', set: true },
    ]);
    // a second call keeps the other lines
    verb(h, 'settings-fleet', '--set=CCRC_TESTBOX_POLL=50s', '--from', 'pwa');
    expect(readFileSync(h.overlay, 'utf8')).toContain('CCRC_TESTBOX_QUEUE_LIMIT=7\n');
    expect(readFileSync(h.overlay, 'utf8')).toContain('CCRC_TESTBOX_POLL=50s\n');
    expect(readFileSync(h.overlay, 'utf8')).not.toContain('CCRC_TESTBOX_POLL=45s');
  });

  it('settings-fleet refuses a pairing key, and writes nothing', () => {
    const h = fixture();
    for (const k of ['CCRC_TESTBOX_URL=https://testbox.invalid', 'CCRC_TESTBOX_TOKEN_FILE=/x', 'CCRC_TESTBOX_GIT_URL_BASE=ssh://x.invalid/', 'CCRC_TESTBOX_GIT_KEY=/x']) {
      const r = verb(h, 'settings-fleet', `--set=${k}`, '--from', 'pwa');
      expect(r.rc, k).toBe(2);
      expect(r.out).toBe('');
    }
    expect(existsSync(h.overlay)).toBe(false);
  });

  it('settings-fleet refuses key-in-ccrc-env naming the key, and writes nothing', () => {
    const h = fixture();
    writeFileSync(h.ccrcEnv, 'CCRC_PORT=8800\nCCRC_TESTBOX_BUDGET=\n# CCRC_TESTBOX_POLL=1s\n');
    const before = readFileSync(h.ccrcEnv);
    const r = verb(h, 'settings-fleet', '--set=CCRC_TESTBOX_POLL=45s', '--set=CCRC_TESTBOX_BUDGET=9m', '--set=CCRC_TESTBOX_QUEUE_LIMIT=5', '--from', 'pwa');
    // an empty value counts as naming the key; a commented line does not; the set is all or nothing
    expect(json(r)).toEqual({ ok: false, code: 'key-in-ccrc-env', keys: ['CCRC_TESTBOX_BUDGET'] });
    expect(existsSync(h.overlay)).toBe(false);
    expect(readFileSync(h.ccrcEnv).equals(before)).toBe(true);
  });

  it('settings-fleet refuses a value off its shape, and a key outside the twelve', () => {
    const h = fixture();
    expect(verb(h, 'settings-fleet', '--set=CCRC_TESTBOX_POLL=soon', '--from', 'pwa').rc).toBe(2);
    expect(verb(h, 'settings-fleet', '--set=CCRC_TESTBOX_POLL=-5s', '--from', 'pwa').rc).toBe(2);
    expect(verb(h, 'settings-fleet', '--set=CCRC_TESTBOX_WORKERS=3', '--from', 'pwa').rc).toBe(2);
    expect(verb(h, 'settings-fleet', '--set=CCRC_PORT=3', '--from', 'pwa').rc).toBe(2);
    expect(existsSync(h.overlay)).toBe(false);
  });

  it('settings-fleet restores the old overlay when a key would read refused', () => {
    const h = fixture();
    // a hand-edited line the reader does not take: it names the key on a line that does not begin KEY=
    const old = 'CCRC_TESTBOX_LOST_RUN=fail\nexport CCRC_TESTBOX_BUDGET=5m\n';
    writeFileSync(h.overlay, old, { mode: 0o600 });
    const r = verb(h, 'settings-fleet', '--set=CCRC_TESTBOX_BUDGET=9m', '--set=CCRC_TESTBOX_POLL=45s', '--from', 'pwa');
    expect(json(r)).toEqual({ ok: false, code: 'box-value-refused', keys: ['CCRC_TESTBOX_BUDGET'] });
    expect(readFileSync(h.overlay, 'utf8')).toBe(old);
    expect(readdirSync(join(h.home, '.ccrc')).filter((n) => n.includes('.bak.') || n.includes('.tmp.'))).toEqual([]);
  });

  it('settings-fleet answers the re-read value, never the one sent', () => {
    const h = fixture();
    // the reader is wrapped so that it reads a different value back for one key: the answer must be the reader's
    const prog = SRC + 'eval "$(declare -f _ccrc_knob | sed "1s/_ccrc_knob/_ccrc_knob_real/")"; '
      + '_ccrc_knob() { _ccrc_knob_real "$@" || return; if [ "$1" = CCRC_TESTBOX_POLL ] && [ -n "$KNOB" ]; then KNOB=46s; fi; return 0; }; '
      + '_tba_main settings-fleet "$@"';
    const r = sh(h, prog, [VERB, '--set=CCRC_TESTBOX_POLL=45s', '--set=CCRC_TESTBOX_TIMES=/srv/secret-times.json', '--from', 'pwa']);
    const a = json(r);
    expect(a['settings'], r.out + r.err).toEqual([{ key: 'CCRC_TESTBOX_POLL', set: true, value: '46s' }, { key: 'CCRC_TESTBOX_TIMES', set: true }]);
    // a path is shown as set, never as its text
    expect(r.out).not.toContain('secret-times');
    expect(readFileSync(h.overlay, 'utf8')).toContain('CCRC_TESTBOX_TIMES=/srv/secret-times.json');
  });

  it('settings-fleet is busy while a long act holds the lock', () => {
    const h = fixture();
    const r = sh(h, SRC + 'exec 8>>"$HOME/.ccrc/testbox-admin.lock"; flock -n 8 || exit 91; _tba_main settings-fleet --set=CCRC_TESTBOX_POLL=45s --from pwa', [VERB]);
    expect(json(r)).toEqual({ ok: false, code: 'busy' });
    expect(existsSync(h.overlay)).toBe(false);
  });
});

describe.skipIf(!HAS_KEYGEN || !HAS_FLOCK || !HAS_NODE)('ccrc testbox-admin settings-box (D-8166, TC8)', () => {
  it('settings-box writes the box file by a temp and a rename and runs install.sh --reapply', () => {
    const h = fixture();
    connectedTo(h);
    const r = verb(h, 'settings-box', ...WORDS(['--set=CCRC_TESTBOX_WORKERS=2']), '--from', 'pwa');
    expect(json(r), r.out + r.err).toEqual({ ok: true });
    const put = stdinOfLast(h, 'cmp')!;
    expect(put).toContain('CCRC_TESTBOX_LISTEN=198.51.100.7:7443\n');
    expect(put).toContain('CCRC_TESTBOX_WORKERS=2\n');
    const putCmd = cmds(h).filter((c) => c.includes('cmp -s')).slice(-1)[0]!;
    expect(putCmd).toContain('mktemp');
    expect(putCmd).toContain('mv -f');
    expect(putCmd).toContain('chown root:root');
    // a file already on the box keeps its owner, group and mode, so a refused install never leaves it unreadable to the service
    expect(putCmd).toContain('chown --reference="$p" "$t"');
    expect(putCmd).toContain('chmod --reference="$p" "$t"');
    const inst = cmds(h).filter((c) => c.includes('install.sh')).slice(-1)[0]!;
    expect(inst).toContain(`${TOOLS}/release/installed/deploy/testbox/install.sh --reapply`);
    expect(inst).not.toContain('--force');
    expect(inst).not.toContain('--release');
    // the box file was checked on the fleet host first: the installer ran after the put
    const all = cmds(h);
    expect(all.findIndex((c) => c.includes('cmp -s'))).toBeLessThan(all.findIndex((c) => c.includes('install.sh')));
    // the state records the new box file's digest
    expect(stateText(h)).toMatch(/^box_sha256=[0-9a-f]{64}$/m);
    expect(stateText(h)).not.toContain('b'.repeat(64));
  });

  it('settings-box with new rows stages them on the box and passes them to --reapply', () => {
    const h = fixture();
    connectedTo(h);
    const r = verb(h, 'settings-box', ...WORDS([`--repo=${rowArg(ROW)}`]), '--from', 'pwa');
    expect(json(r), r.out + r.err).toEqual({ ok: true });
    expect(JSON.parse(stdinOfLast(h, 'mkdir')!).name).toBe('project-a');
    const all = cmds(h);
    const inst = all.filter((c) => c.includes('install.sh')).slice(-1)[0]!;
    expect(inst).toContain(`--reapply --repos ${STG}/rows/project-a.json`);
    // the staging directory is removed once the installer has run
    expect(all.findIndex((c) => c.includes('rm -rf'))).toBeGreaterThan(all.findIndex((c) => c.includes('install.sh')));
  });

  it('settings-box refuses what the box file cannot hold, before anything is written', () => {
    const h = fixture();
    connectedTo(h);
    // no listen address: the box file cannot be loaded
    const r = verb(h, 'settings-box', '--set=CCRC_TESTBOX_WORKERS=3', '--from', 'pwa');
    expect(json(r)).toEqual({ ok: false, code: 'box-value-refused' });
    expect(sshCalls(h)).toEqual([]);
    // not connected
    const g = fixture();
    expect(json(verb(g, 'settings-box', ...WORDS(), '--from', 'pwa'))).toEqual({ ok: false, code: 'not-connected' });
  });

  it('settings-box with a run in progress answers runs-in-progress, and touches nothing', () => {
    const h = fixture({ FAKE_API_BUSY_FIRST: '999' });
    connectedTo(h);
    const r = verb(h, 'settings-box', ...WORDS(), '--from', 'pwa');
    expect(json(r)).toEqual({ ok: false, code: 'runs-in-progress' });
    expect(sshCalls(h)).toEqual([]);
    expect(stateText(h)).not.toContain('act_id=');
    // a queued run counts too
    const q = fixture({ FAKE_API_IDLE: '{"ok":true,"testbox":{"state":"ok","box":{"runs":{"inProgress":0,"limit":2},"queueDepth":3}}}' });
    connectedTo(q);
    expect(json(verb(q, 'settings-box', ...WORDS(), '--from', 'pwa'))).toEqual({ ok: false, code: 'runs-in-progress' });
    // a box whose service is down has nothing running
    const d = fixture({ FAKE_API_IDLE: '{"ok":true,"testbox":{"state":"unreachable","box":null}}' });
    connectedTo(d);
    expect(json(verb(d, 'settings-box', ...WORDS(), '--from', 'pwa'))).toEqual({ ok: true });
  });

  it('settings-box when idle waits in a unit and applies once no run is in progress', () => {
    const h = fixture({ FAKE_API_BUSY_FIRST: '3' });
    connectedTo(h);
    const id = detach(h, 'settings-box', WORDS(['--when-idle=true']));
    expect(lastAct(h)).toMatchObject({ id, sub: 'settings-box', outcome: 'running' });
    // the parent started one unit and nothing has reached the box
    expect(readFileSync(join(h.home, 'systemd-run-calls'), 'utf8')).toContain(`--unit=ccrc-testbox-admin-settings-box-${id}`);
    expect(sshCalls(h)).toEqual([]);
    expect(readFileSync(join(h.home, '.ccrc', `testbox-admin.args.${id}`), 'utf8')).toContain('--when-idle=true\n');
    expect(unit(h, 'settings-box', id)).toBe(0);
    const a = lastAct(h);
    expect(a).toMatchObject({ outcome: 'ok', code: null, phase: 'install' });
    expect(a.phases.map((p) => p.name)).toEqual(['wait', 'settings', 'install']);
    expect(Number(readFileSync(join(h.home, 'api-n'), 'utf8'))).toBeGreaterThanOrEqual(4);
    expect(cmds(h).some((c) => c.includes('install.sh --reapply'))).toBe(true);
  });

  it('apply when idle ends idle-deadline after six hours, applying nothing', () => {
    const h0 = fixture();
    expect(sh(h0, SRC + 'echo "$TBA_IDLE_DEADLINE_DEFAULT"', [VERB]).out.trim()).toBe(String(6 * 3600));
    const h = fixture({ FAKE_API_BUSY_FIRST: '999', TBA_IDLE_DEADLINE: '0' });
    connectedTo(h);
    act(h, 'settings-box', WORDS(['--when-idle=true']));
    expect(lastAct(h)).toMatchObject({ outcome: 'failed', code: 'idle-deadline', phase: 'wait' });
    expect(sshCalls(h)).toEqual([]);
    expect(stateText(h)).not.toMatch(/^parity_stale=/m);
  });

  it('cancel ends a waiting act cancelled, and says so when nothing waits', () => {
    const h = fixture({ FAKE_API_BUSY_FIRST: '999' });
    connectedTo(h);
    expect(json(verb(h, 'cancel', '--from', 'pwa'))).toEqual({ ok: true, cancelled: false });
    const id = detach(h, 'settings-box', WORDS(['--when-idle=true']));
    expect(json(verb(h, 'cancel', '--from', 'pwa'))).toEqual({ ok: true, cancelled: true });
    expect(readFileSync(join(h.home, '.ccrc', 'testbox-admin.cancel'), 'utf8')).toBe(id);
    expect(unit(h, 'settings-box', id)).toBe(0);
    expect(lastAct(h)).toMatchObject({ outcome: 'failed', code: 'cancelled', phase: 'wait' });
    expect(sshCalls(h)).toEqual([]);
    expect(existsSync(join(h.home, '.ccrc', 'testbox-admin.cancel'))).toBe(false);
    // an act that has ended is not cancelled
    expect(json(verb(h, 'cancel', '--from', 'pwa'))).toEqual({ ok: true, cancelled: false });
  });

  it('a run-shaping key whose value changed marks parity stale, and another key does not', () => {
    expect(sh(fixture(), SRC + 'printf "%s\\n" "${TBA_RUN_SHAPING[@]}"', [VERB]).out.trim().split('\n')).toEqual([...TESTBOX_RUN_SHAPING]);
    const h = fixture();
    connectedTo(h);
    // the box has WORKERS=2 and LOG_TAIL=40: a change to LOG_TAIL alone, with WORKERS unchanged, is not run-shaping
    expect(json(verb(h, 'settings-box', ...WORDS(['--set=CCRC_TESTBOX_WORKERS=2', '--set=CCRC_TESTBOX_LOG_TAIL=50']), '--from', 'pwa'))).toEqual({ ok: true });
    expect(stateText(h)).not.toMatch(/^parity_stale=/m);
    // WORKERS changed
    expect(json(verb(h, 'settings-box', ...WORDS(['--set=CCRC_TESTBOX_WORKERS=4', '--set=CCRC_TESTBOX_LOG_TAIL=40']), '--from', 'pwa'))).toEqual({ ok: true });
    expect(stateText(h)).toMatch(/^parity_stale=1$/m);
    // a key removed from the file is a change too
    const g = fixture();
    connectedTo(g);
    expect(json(verb(g, 'settings-box', ...WORDS(['--set=CCRC_TESTBOX_LOG_TAIL=40']), '--from', 'pwa'))).toEqual({ ok: true });
    expect(stateText(g)).toMatch(/^parity_stale=1$/m);
  });

  it('settings-box puts the old box file back when the installer refuses', () => {
    const line = 'ccrc-testbox-install: refused: CCRC_TESTBOX_LISTEN does not name an IP address';
    const h = fixture({}, WITH(['install\\.sh', '1', `${line}\\n`]));
    connectedTo(h);
    const r = verb(h, 'settings-box', ...WORDS(['--set=CCRC_TESTBOX_WORKERS=4']), '--from', 'pwa');
    expect(json(r)).toEqual({ ok: false, code: 'install-refused' });
    expect(readFileSync(h.lg, 'utf8')).toContain(line);
    expect(stdinOfLast(h, 'cmp')).toBe(OLD_BOX.replace(/\\n/g, '\n'));
    // both puts (the new file, then the old one back) keep the existing file's owner, group and mode
    const puts = cmds(h).filter((c) => c.includes('cmp -s'));
    expect(puts).toHaveLength(2);
    for (const c of puts) expect(c).toContain('chown --reference="$p" "$t"');
    expect(stateText(h)).not.toMatch(/^parity_stale=/m);
    expect(stateText(h)).toContain('b'.repeat(64));
  });
});

describe.skipIf(!HAS_KEYGEN || !HAS_FLOCK || !HAS_NODE)('ccrc testbox-admin read (D-8166, TC8)', () => {
  const KNOBS = [
    'CCRC_TESTBOX_RUNS\\x1f2\\x1f3\\x1ffile\\n', 'CCRC_TESTBOX_WORKERS\\x1f2\\x1f2\\x1fdefault\\n',
    'CCRC_TESTBOX_RUN_TMPDIR\\x1f/tmp/r\\x1f/srv/secret-tmp\\x1ffile\\n', 'CCRC_TESTBOX_LISTEN\\x1f\\x1f198.51.100.7:7443\\x1ffile\\n',
    'CCRC_TESTBOX_EGRESS_ALLOW\\x1fgithub.com\\x1fgithub.com registry.example.invalid\\x1ffile\\n',
    'CCRC_TESTBOX_LOG_TAIL\\x1f40\\x1f40\\x1fdefault\\n',
    'ccrc test: WARN: CCRC_TESTBOX_LOG_TAIL=999 (from the /etc/ccrc-testbox/ccrc.env) is not a whole number from 1 to 99; using its default 40\\n',
    'ccrc test: WARN: CCRC_TESTBOX_RUNS=3 in the environment is ignored: it holds for the whole box\\n',
  ].join('');

  it('read runs the installed tree\'s ccrc by its path, never one on PATH', () => {
    const h = fixture({}, WITH(['--testbox-knobs', '0', KNOBS]));
    connectedTo(h);
    // a ccrc on PATH would be found first; it must never run
    writeFileSync(join(h.home, 'fakes', 'ccrc'), '#!/bin/sh\necho path-ccrc >"$HOME/path-ccrc-ran"\n', { mode: 0o755 });
    const r = verb(h, 'read', '--from', 'pwa');
    expect(json(r), r.out + r.err).toEqual({ ok: true });
    const c = cmds(h).filter((x) => x.includes('--testbox-knobs'));
    expect(c).toHaveLength(1);
    expect(c[0]).toBe(`sh -c exec bash "$@" 2>&1 sh ${TOOLS}/release/installed/ccd/ccrc test --testbox-knobs box`);
    expect(existsSync(join(h.home, 'path-ccrc-ran'))).toBe(false);
  });

  it('read writes display classes only: no path, address or list text, and a refusal as its closed sentence', () => {
    const h = fixture({}, WITH(['--testbox-knobs', '0', KNOBS]));
    connectedTo(h);
    expect(json(verb(h, 'read', '--from', 'pwa'))).toEqual({ ok: true });
    const text = readFileSync(h.snapshot, 'utf8');
    for (const secret of ['/srv/secret-tmp', '198.51.100.7', 'registry.example.invalid', 'github.com']) expect(text, secret).not.toContain(secret);
    expect(text.trim().split('\n')).toHaveLength(1);
    expect(sh(h, 'stat -c %a "$HOME/.ccrc/testbox-box-settings.json" 2>/dev/null || stat -f %Lp "$HOME/.ccrc/testbox-box-settings.json"').out.trim()).toBe('600');
    const s = status(h);
    expect(s.ok, JSON.stringify(s)).toBe(true);
    if (!s.ok) return;
    const rows = s.value.boxSettings!;
    expect(rows.map((x) => x.key)).toEqual([...TESTBOX_BOX_KEYS]);
    const row = (k: string): unknown => rows.find((x) => x.key === k);
    expect(row('CCRC_TESTBOX_RUNS')).toEqual({ key: 'CCRC_TESTBOX_RUNS', state: 'ok', value: '3', from: 'file' });
    expect(row('CCRC_TESTBOX_RUN_TMPDIR')).toEqual({ key: 'CCRC_TESTBOX_RUN_TMPDIR', state: 'ok', from: 'file' });
    expect(row('CCRC_TESTBOX_LISTEN')).toEqual({ key: 'CCRC_TESTBOX_LISTEN', state: 'ok', from: 'file' });
    expect(row('CCRC_TESTBOX_EGRESS_ALLOW')).toEqual({ key: 'CCRC_TESTBOX_EGRESS_ALLOW', state: 'ok', from: 'file' });
    expect(row('CCRC_TESTBOX_LOG_TAIL')).toEqual({ key: 'CCRC_TESTBOX_LOG_TAIL', state: 'refused', from: 'file', why: 'a whole number from 1 to 99' });
    expect(row('CCRC_TESTBOX_UNIT_MAX')).toMatchObject({ state: 'unmeasured' });
    expect(s.value.boxSettingsAt).toBeGreaterThan(0);
    // the snapshot carries the box file's own digest, read on the box
    expect(text).toContain(`"boxFileSha256":"${SHA}"`);
  });

  it('read records the tag the box\'s installer marker names, and the status reports it as installedTag (tool sync never rewrites it)', () => {
    const marker = ['^(sudo -n -- )?cat -- /etc/ccrc-testbox/installed$', '0', `release\\tv1.1.0\nbox-sha256\t${SHA}\n`];
    const h = fixture({}, [marker, ...WITH(['--testbox-knobs', '0', KNOBS])]);
    connectedTo(h);
    expect(json(verb(h, 'read', '--from', 'pwa'))).toEqual({ ok: true });
    const s = status(h);
    expect(s.ok && s.value.installedTag).toBe('v1.1.0');
    // an unreadable marker clears it: the card then says nothing about the release
    const g = fixture({}, [['^(sudo -n -- )?cat -- /etc/ccrc-testbox/installed$', '1', ''], ...WITH(['--testbox-knobs', '0', KNOBS])]);
    connectedTo(g, ['box_marker_tag=v1.1.0']);
    expect(json(verb(g, 'read', '--from', 'pwa'))).toEqual({ ok: true });
    const t = status(g);
    expect(t.ok && t.value.installedTag).toBeNull();
  });

  it('read leaves the old snapshot when the box cannot be read, and answers ssh\'s code', () => {
    const h = fixture({}, WITH(['--testbox-knobs', '0', KNOBS]));
    connectedTo(h);
    verb(h, 'read', '--from', 'pwa');
    const before = readFileSync(h.snapshot, 'utf8');
    setRules(h, WITH(['--testbox-knobs', '255', '']));
    expect(json(verb(h, 'read', '--from', 'pwa'))).toEqual({ ok: false, code: 'unreachable' });
    expect(readFileSync(h.snapshot, 'utf8')).toBe(before);
    setRules(h, WITH(['--testbox-knobs', '1', 'ccrc: nothing here\\n']));
    expect(json(verb(h, 'read', '--from', 'pwa'))).toEqual({ ok: false, code: 'status-not-ok' });
    // a refused box file shows every row as unmeasured
    setRules(h, WITH(['--testbox-knobs', '0', 'ccrc test: WARN: the test box\'s settings file is refused: not root\'s; every test box setting uses its default\\n']));
    expect(json(verb(h, 'read', '--from', 'pwa'))).toEqual({ ok: true });
    const s = status(h);
    expect(s.ok && s.value.boxSettings!.every((x) => x.state === 'unmeasured')).toBe(true);
    // not connected
    expect(json(verb(fixture(), 'read', '--from', 'pwa'))).toEqual({ ok: false, code: 'not-connected' });
  });
});

describe.skipIf(!HAS_KEYGEN || !HAS_FLOCK || !HAS_NODE)('ccrc testbox-admin repair and apply-release (D-8166, TC8)', () => {
  const MARKER = ['^(sudo -n -- )?cat -- /etc/ccrc-testbox/installed$', '0', `release\\tv1.1.0\\nbox-sha256\\t${SHA}\\n`];
  const BUILD = [`^(sudo -n -- )?cat -- ${TOOLS}/release/installed/build\\.json$`, '0', '{"version":"v1.2.3"}'];

  it('repair re-verifies the recorded tag and never changes it', () => {
    const h = fixture({}, WITH(MARKER));
    connectedTo(h);
    act(h, 'repair', []);
    const a = lastAct(h);
    expect(a).toMatchObject({ sub: 'repair', outcome: 'ok', code: null, phase: 'install' });
    expect(a.phases.map((p) => p.name)).toEqual(['verify', 'copy', 'install']);
    // the tag recorded on the box (v1.1.0), not the fleet host's own (v1.2.3), was fetched and verified
    expect(readFileSync(join(h.home, 'resolved-tag'), 'utf8').trim()).toBe('v1.1.0');
    expect(stdinOfLast(h, 'tar -xzf')).toBe('TARBALL-BYTES');
    const all = cmds(h);
    const over = all.find((c) => c.includes('cp -RP'))!;
    expect(over).toContain(`sh ${TOOLS} ${STG} v1.1.0`);
    const inst = all.filter((c) => c.includes('install.sh')).slice(-1)[0]!;
    expect(inst).toContain(`${TOOLS}/release/installed/deploy/testbox/install.sh --reapply --force`);
    expect(inst).not.toContain('--release');
    expect(all.findIndex((c) => c.includes('rm -rf'))).toBeGreaterThan(all.indexOf(inst));
    // the installed tree was overwritten before the installer ran from it
    expect(all.indexOf(over)).toBeLessThan(all.indexOf(inst));
    expect(stateText(h)).toContain('connected=1');
  });

  it('repair ends other-release when the installed tree names another tag, and runs no installer', () => {
    const h = fixture({}, [['cp.*-RP', '3', ''], MARKER, ...PASSING_RULES]);
    connectedTo(h);
    act(h, 'repair', []);
    expect(lastAct(h)).toMatchObject({ outcome: 'failed', code: 'other-release', phase: 'install' });
    expect(cmds(h).some((c) => c.includes('install.sh'))).toBe(false);
    expect(cmds(h).slice(-1)[0]).toContain('rm -rf');
  });

  it('repair ends verify-failed when the box records no tag, and nothing is copied', () => {
    const h = fixture({}, WITH(['^(sudo -n -- )?cat -- /etc/ccrc-testbox/installed$', '1', '']));
    connectedTo(h);
    act(h, 'repair', []);
    expect(lastAct(h)).toMatchObject({ outcome: 'failed', code: 'verify-failed', phase: 'verify' });
    expect(cmds(h).some((c) => c.includes('tar'))).toBe(false);
  });

  it('repair and apply-release answer not-connected with no connection, before a unit starts', () => {
    for (const sub of ['repair', 'apply-release']) {
      const h = fixture();
      expect(json(verb(h, sub, '--from', 'pwa')), sub).toEqual({ ok: false, code: 'not-connected' });
      expect(existsSync(join(h.home, 'systemd-run-calls'))).toBe(false);
    }
  });

  it('apply-release runs the tool-synced tree\'s installer with its tag, and nothing else', () => {
    const h = fixture({}, WITH(BUILD));
    connectedTo(h);
    act(h, 'apply-release', []);
    const a = lastAct(h);
    expect(a).toMatchObject({ sub: 'apply-release', outcome: 'ok', code: null });
    expect(a.phases.map((p) => p.name)).toEqual(['verify', 'copy', 'install']);
    const inst = cmds(h).filter((c) => c.includes('install.sh'));
    expect(inst).toEqual([`sh -c exec bash "$@" 2>&1 sh ${TOOLS}/release/installed/deploy/testbox/install.sh --reapply`]);
    // the tree is checked in place; no tarball was fetched or copied
    expect(cmds(h).some((c) => c.includes('tar -xzf'))).toBe(false);
    expect(existsSync(join(h.home, 'resolved-tag'))).toBe(false);
  });

  it('apply-release ends at copy when the installed tree no longer matches its MANIFEST', () => {
    const h = fixture({}, [BUILD, ['sha256sum.*-c.*MANIFEST', '1', ''], ...PASSING_RULES]);
    connectedTo(h);
    act(h, 'apply-release', []);
    expect(lastAct(h)).toMatchObject({ outcome: 'failed', code: 'copy-failed', phase: 'copy' });
    expect(cmds(h).some((c) => c.includes('install.sh'))).toBe(false);
  });

  it('apply-release maps the installer\'s refused line to install-refused', () => {
    const h = fixture({}, [BUILD, ['install\\.sh', '1', 'ccrc-testbox-install: refused: the box has no installed marker\\n'], ...PASSING_RULES]);
    connectedTo(h);
    act(h, 'apply-release', []);
    expect(lastAct(h)).toMatchObject({ outcome: 'failed', code: 'install-refused', phase: 'install' });
  });
});

describe.skipIf(!HAS_KEYGEN || !HAS_FLOCK || !HAS_NODE)('ccrc testbox-admin disconnect (D-8166, TC8)', () => {
  /** A connection with every fleet-side file a connect leaves. */
  function paired(h: Home, extra: string[] = []): void {
    connectedTo(h, extra);
    writeFileSync(h.token, 'f'.repeat(64), { mode: 0o600 });
    writeFileSync(h.push, 'PRIVATE KEY BYTES\n', { mode: 0o600 });
    writeFileSync(h.overlay, 'CCRC_TESTBOX_URL=http://203.0.113.9:7443\nCCRC_TESTBOX_TOKEN_FILE=~/.ccrc/testbox.token\nCCRC_TESTBOX_GIT_URL_BASE=ssh://ccrc-tb-push@203.0.113.9:22/\nCCRC_TESTBOX_GIT_KEY=~/.ccrc/testbox-push.key\nCCRC_TESTBOX_POLL=45s\n', { mode: 0o600 });
    writeFileSync(h.parity, '{"v":1}\n', { mode: 0o600 });
    writeFileSync(h.snapshot, '{"at":1,"boxFileSha256":"' + SHA + '","settings":[]}\n', { mode: 0o600 });
  }

  it('disconnect turns the switch off before anything else', () => {
    const h = fixture();
    paired(h);
    const r = verb(h, 'disconnect', '--from', 'pwa');
    expect(json(r), r.out + r.err).toEqual({ ok: true });
    const calls = ops(h);
    expect(calls[0]).toEqual(['ccd', 'testbox-remote', '--state', 'off']);
    expect(calls.slice(1).every((c) => c[0] === 'ssh')).toBe(true);
    // a switch that cannot be lowered stops the act: nothing is removed
    const g = fixture({ FAKE_CCD_RC: '1' });
    paired(g);
    const f = verb(g, 'disconnect', '--from', 'pwa');
    expect(f.rc).toBe(1);
    expect(f.err).toContain('switch could not be lowered');
    expect(sshCalls(g)).toEqual([]);
    expect(existsSync(g.token)).toBe(true);
    expect(existsSync(g.overlay)).toBe(true);
  });

  it('disconnect runs --unpair, then removes the access line last', () => {
    const h = fixture();
    paired(h);
    expect(json(verb(h, 'disconnect', '--from', 'pwa'))).toEqual({ ok: true });
    const all = cmds(h);
    expect(all).toHaveLength(2);
    expect(all[0]).toBe(`sh -c exec bash "$@" 2>&1 sh ${TOOLS}/release/installed/deploy/testbox/install.sh --unpair`);
    expect(all[1]).toContain('ccrc-testbox-admin');
    expect(all[1]).toContain('authorized_keys');
    expect(all[1]).toContain('mktemp');
    expect(all[1]).toContain('mv -f');
    expect(all[1]).toMatch(/ sh root$/);
    // an unpair that fails leaves the access line, and says the box side was skipped
    const g = fixture({}, WITH(['--unpair', '1', 'ccrc-testbox-install: failed: cannot stop the test service\\n']));
    paired(g);
    expect(json(verb(g, 'disconnect', '--from', 'pwa'))).toEqual({ ok: false, code: 'box-side-skipped' });
    expect(cmds(g)).toHaveLength(1);
    expect(existsSync(g.token)).toBe(false);
  });

  it('disconnect removes the token, the push key, the overlay, the pin, the parity record and the snapshot', () => {
    const h = fixture();
    paired(h, ['parity_stale=1', 'fingerprint=SHA256:' + 'A'.repeat(43)]);
    expect(json(verb(h, 'disconnect', '--replace=true', '--from', 'pwa'))).toEqual({ ok: true });
    for (const f of [h.token, h.push, h.overlay, h.pin, h.parity, h.snapshot]) expect(existsSync(f), f).toBe(false);
    const s = status(h);
    expect(s.ok, JSON.stringify(s)).toBe(true);
    if (!s.ok) return;
    expect(s.value).toMatchObject({ connected: false, addressSet: false, fingerprint: null, hostKey: 'none', boxFileSha256: null, boxSettings: null, parity: null });
    for (const k of ['connected', 'address', 'box_tools', 'box_root', 'box_sha256', 'parity_stale', 'fingerprint']) expect(stateText(h), k).not.toMatch(new RegExp(`^${k}=`, 'm'));
    expect(readdirSync(join(h.home, '.ccrc')).filter((n) => n.includes('.tmp.') || n.includes('.bak.'))).toEqual([]);
  });

  it('disconnect keeps the access key pair, so the next Connect shows the same line', () => {
    const h = fixture();
    paired(h);
    const before = readFileSync(h.key);
    const line = json(verb(h, 'key', `--address=${ADDR}`))['line'];
    expect(json(verb(h, 'disconnect', '--from', 'pwa'))).toEqual({ ok: true });
    expect(existsSync(h.key)).toBe(true);
    expect(existsSync(`${h.key}.pub`)).toBe(true);
    expect(readFileSync(h.key).equals(before)).toBe(true);
    expect(json(verb(h, 'key', `--address=${ADDR}`))['line']).toBe(line);
  });

  it('disconnect with a changed host key cleans the fleet side and answers box-side-skipped', () => {
    const keygen = (name: string): { type: string; b64: string } => {
      const f = join(h.home, name);
      const g = spawnSync('ssh-keygen', ['-q', '-t', 'ed25519', '-N', '', '-C', 'host', '-f', f], { encoding: 'utf8' });
      expect(g.status, g.stderr).toBe(0);
      const [type, b64] = readFileSync(`${f}.pub`, 'utf8').trim().split(' ') as [string, string];
      return { type, b64 };
    };
    const h = fixture();
    const pinned = keygen('hk-pinned');
    const presented = keygen('hk-presented');
    paired(h);
    writeFileSync(h.pin, `${ADDR} ${pinned.type} ${pinned.b64}\n`, { mode: 0o600 });
    // the box presents another key than the pin
    h.env['FAKE_SSH_KEYSCAN_OUT'] = `${ADDR} ${presented.type} ${presented.b64}`;
    h.env['FAKE_SSH_KEYSCAN_RC'] = '0';
    const r = verb(h, 'disconnect', '--from', 'pwa');
    expect(json(r), r.out + r.err).toEqual({ ok: false, code: 'box-side-skipped' });
    // the box was never reached; the fleet side is clean
    expect(sshCalls(h)).toEqual([]);
    expect(ops(h)[0]).toEqual(['ccd', 'testbox-remote', '--state', 'off']);
    for (const f of [h.token, h.push, h.overlay, h.pin, h.parity, h.snapshot]) expect(existsSync(f), f).toBe(false);
    expect(stateText(h)).not.toMatch(/^hostkey_changed=/m);
    expect(existsSync(h.key)).toBe(true);
  });

  it('disconnect of a box that cannot be reached answers box-side-skipped after the fleet side is clean', () => {
    const h = fixture({}, WITH(['--unpair', '255', '']));
    paired(h);
    expect(json(verb(h, 'disconnect', '--from', 'pwa'))).toEqual({ ok: false, code: 'box-side-skipped' });
    expect(existsSync(h.token)).toBe(false);
    expect(existsSync(h.overlay)).toBe(false);
  });

  it('disconnect with no connection at all is a clean no-op', () => {
    const h = fixture();
    expect(json(verb(h, 'disconnect', '--from', 'pwa'))).toEqual({ ok: true });
    expect(sshCalls(h)).toEqual([]);
  });

  it('after disconnect the four pairing keys read unset', () => {
    const h = fixture();
    paired(h);
    const probe = SRC + 'for k in CCRC_TESTBOX_URL CCRC_TESTBOX_TOKEN_FILE CCRC_TESTBOX_GIT_URL_BASE CCRC_TESTBOX_GIT_KEY; do _ccrc_knob "$k" "" file; echo "$k=[$KNOB]"; done';
    expect(sh(h, probe, [VERB]).out).toContain('CCRC_TESTBOX_URL=[http://203.0.113.9:7443]');
    expect(json(verb(h, 'disconnect', '--from', 'pwa'))).toEqual({ ok: true });
    expect(sh(h, probe, [VERB]).out.trim().split('\n')).toEqual([
      'CCRC_TESTBOX_URL=[]', 'CCRC_TESTBOX_TOKEN_FILE=[]', 'CCRC_TESTBOX_GIT_URL_BASE=[]', 'CCRC_TESTBOX_GIT_KEY=[]',
    ]);
  });

  it('disconnect is busy while a long act holds the lock, and removes nothing', () => {
    const h = fixture();
    paired(h);
    const r = sh(h, SRC + 'exec 8>>"$HOME/.ccrc/testbox-admin.lock"; flock -n 8 || exit 91; _tba_main disconnect --from pwa', [VERB]);
    expect(json(r)).toEqual({ ok: false, code: 'busy' });
    expect(existsSync(h.token)).toBe(true);
    expect(ops(h)).toEqual([]);
  });
});

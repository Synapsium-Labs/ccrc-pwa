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
import { appendFileSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import path, { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkTmp, removeTmpFixturesEachTest } from './tmpHelpers.js';
import { ghContainedEnv } from './ccdWsHelpers.js';
import {
  TESTBOX_BOX_KEYS, TESTBOX_FLEET_EDITABLE, TESTBOX_PAIRED_BOX_KEYS, TESTBOX_RUN_SHAPING, parityArmable, parityCurrentOf, readTestboxAdminStatus,
} from '../../shared/testbox-admin.js';

removeTmpFixturesEachTest();

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const VERB = join(REPO, 'ccd', 'ccrc-testbox-admin');
const BOXFAKE = join(REPO, 'server', 'test', 'fixtures', 'testbox-admin-connect-ssh.sh');
const SCANFAKE = join(REPO, 'server', 'test', 'fixtures', 'testbox-admin-ssh.sh');
const BASH = spawnSync('bash', ['-c', 'command -v bash'], { encoding: 'utf8' }).stdout.trim();
const HAS_KEYGEN = spawnSync('bash', ['-c', 'command -v ssh-keygen'], { encoding: 'utf8' }).status === 0;
const HAS_FLOCK = spawnSync('bash', ['-c', 'command -v flock'], { encoding: 'utf8' }).status === 0;
const HAS_NODE = spawnSync('bash', ['-c', 'command -v node'], { encoding: 'utf8' }).status === 0;
const ADDR = '10.0.0.9';
const SRC_ADDR = '192.0.2.5';
const STG = '/tmp/ccrc-stg.AbC123';
const TOOLS = '/opt/tools';
const SHA = 'a1'.repeat(32);
const BOXENV = '/etc/ccrc-testbox/ccrc.env';
/** A regular expression matching `s` literally (every metacharacter, the backslash too, escaped). */
const escapeRe = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const SRC = '. "$1" || exit 90; shift; REAL_OS=$CCD_OS; CCD_OS=linux; '
  + 'for f in _plat_mode _plat_sha256; do eval "$(declare -f $f | sed "1s/^$f/${f}_real/")"; eval "$f() { local CCD_OS=\\$REAL_OS; ${f}_real \\"\\$@\\"; }"; done; ';
const b64url = (s: string): string => Buffer.from(s).toString('base64url');
const ROW = {
  name: 'project-a', fetchUrl: 'https://testbox.invalid/project-a.git', mirrorPath: '/srv/mirror/project-a.git',
  packages: [{ name: 'server', installInputs: ['server/package.json'], commands: ['./node_modules/.bin/vitest'] }],
  buildOutputs: [], systemTools: [],
};
const rowArg = (row: unknown): string => b64url(JSON.stringify(row));

/** The words of a settings-box: two paths, and what the case adds. The listen address is not sent: it is one of the four pairing
 *  settings the card keeps as Connected, and the box's own file (OLD_BOX) holds it. */
const WORDS = (extra: string[] = []): string[] => [
  '--set=CCRC_TESTBOX_ROOT=/srv/box', `--set=CCRC_TESTBOX_TOOLS_DIR=${TOOLS}`, ...extra,
];

const IDLE = '{"ok":true,"testbox":{"state":"ok","reason":null,"box":{"runs":{"inProgress":0,"limit":2},"queueDepth":0}}}';
const BUSY = '{"ok":true,"testbox":{"state":"ok","reason":null,"box":{"runs":{"inProgress":1,"limit":2},"queueDepth":0}}}';
const OLD_BOX = 'CCRC_TESTBOX_LISTEN=10.0.0.9:7443\\nCCRC_TESTBOX_ROOT=/srv/box\\nCCRC_TESTBOX_REPOS=/etc/ccrc-testbox/repos.d\\nCCRC_TESTBOX_TOOLS_DIR=/opt/tools\\nCCRC_TESTBOX_WORKERS=2\\nCCRC_TESTBOX_LOG_TAIL=40\\n';

/** The rules of a box that answers every command of these acts: regex, exit code, stdout (printf %b). First match wins. */
const PASSING_RULES: string[][] = [
  ['install\\.sh', '0', 'ccrc-testbox-install: applied\\n'],
  [`^(sudo -n -- )?cat -- ${escapeRe(BOXENV)}$`, '0', OLD_BOX],
  [`sha256sum -- ${escapeRe(BOXENV)}`, '0', `${SHA}  ${BOXENV}\\n`],
  ['--testbox-knobs', '0', 'CCRC_TESTBOX_RUNS\\x1f2\\x1f2\\x1fdefault\\n'],
  ['^(sudo -n -- )?mktemp -d$', '0', `${STG}\\n`],
  ['^(sudo -n -- )?tar -xzf', '0', ''],
  ['sha256sum.*-c.*MANIFEST', '0', ''],
  [escapeRe(BOXENV), '0', ''],
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

/** A real ed25519 private key at the path, with the comment (the push key ccrc makes carries `ccrc-testbox-push`; a person's does not). */
function keygen(file: string, comment: string): void {
  mkdirSync(path.dirname(file), { recursive: true });
  rmSync(file, { force: true });
  const r = spawnSync('ssh-keygen', ['-q', '-t', 'ed25519', '-N', '', '-C', comment, '-f', file], { encoding: 'utf8' });
  expect(r.status, r.stderr).toBe(0);
  rmSync(`${file}.pub`, { force: true });
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
/** A settings-box as the card runs it: the parent answers (a refusal, or the act's id), and the unit applies. Answers as a short one
 *  once did: `{ok: true}`, or the refusal, or `{ok: false, code}` from the act's end. */
function box(h: Home, words: string[], stubs = STUBS): Record<string, unknown> {
  const r = sh(h, SRC + stubs + '_tba_main settings-box "$@" --from pwa', [VERB, ...words]);
  const m = /^\{"ok":true,"act":"([0-9a-f]{32})"\}\n$/.exec(r.out);
  if (m === null) return json(r);
  expect(unit(h, 'settings-box', m[1]!, stubs), r.err).toBe(0);
  const a = lastAct(h);
  return a.outcome === 'ok' ? { ok: true } : { ok: false, code: a.code };
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

  it('settings-fleet answers each key as the reader read it before the write, in the shape of the answer (D-8399)', () => {
    const h = fixture();
    writeFileSync(h.overlay, 'CCRC_TESTBOX_BUDGET=30m\nCCRC_TESTBOX_TIMES=/srv/old-times.json\n', { mode: 0o600 });
    const r = verb(h, 'settings-fleet', '--set=CCRC_TESTBOX_BUDGET=45m', '--set=CCRC_TESTBOX_POLL=1m', '--set=CCRC_TESTBOX_TIMES=/srv/new-times.json',
      '--unset=CCRC_TESTBOX_LOST_RUN', '--from', 'pwa');
    const a = json(r);
    expect(a['ok'], r.out + r.err).toBe(true);
    // a value as itself, a key no file names as not set, a path as set only: the same reader and shape as `settings`
    expect(a['before']).toEqual([
      { key: 'CCRC_TESTBOX_BUDGET', set: true, value: '30m' }, { key: 'CCRC_TESTBOX_POLL', set: false },
      { key: 'CCRC_TESTBOX_TIMES', set: true }, { key: 'CCRC_TESTBOX_LOST_RUN', set: false },
    ]);
    expect(a['settings']).toEqual([
      { key: 'CCRC_TESTBOX_BUDGET', set: true, value: '45m' }, { key: 'CCRC_TESTBOX_POLL', set: true, value: '1m' },
      { key: 'CCRC_TESTBOX_TIMES', set: true }, { key: 'CCRC_TESTBOX_LOST_RUN', set: false },
    ]);
    expect(r.out).not.toContain('times.json');
    // a refused write answers no rows at all
    writeFileSync(h.ccrcEnv, 'CCRC_TESTBOX_BUDGET=5m\n');
    expect(json(verb(h, 'settings-fleet', '--set=CCRC_TESTBOX_BUDGET=9m', '--from', 'pwa'))).toEqual({ ok: false, code: 'key-in-ccrc-env', keys: ['CCRC_TESTBOX_BUDGET'] });
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
    expect(box(h, [...WORDS(['--set=CCRC_TESTBOX_WORKERS=2'])])).toEqual({ ok: true });
    const put = stdinOfLast(h, 'cmp')!;
    expect(put).toContain('CCRC_TESTBOX_LISTEN=10.0.0.9:7443\n');
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

  it('settings-box takes no repository row: a row sent to it is a usage error, nothing is recorded and the box is not asked', () => {
    // A row's command head runs on the fleet host in parity, and a box setting edit needs no step-up: only Connect names a row.
    const h = fixture();
    connectedTo(h);
    const before = stateText(h);
    for (const words of [[...WORDS([`--repo=${rowArg(ROW)}`])], [`--repo=${rowArg({ ...ROW, packages: [{ ...ROW.packages[0], commands: ['npx attacker-pkg'] }] })}`, '--set=CCRC_TESTBOX_WORKERS=2']]) {
      const r = verb(h, 'settings-box', ...words, '--from', 'pwa');
      expect(r.rc, r.out + r.err).toBe(2);
      expect(r.err).toContain('--repo');
    }
    expect(stateText(h)).toBe(before);
    expect(sshCalls(h)).toEqual([]);
    expect(existsSync(join(h.home, '.ccrc', 'testbox-rows'))).toBe(false);
  });

  it('settings-box takes only the keys the card changed: the box\'s current file is read and the keys put into it, every other line kept', () => {
    const catRule = ['^(sudo -n -- )?cat -- /etc/ccrc-testbox/ccrc\\.env$', '0', `# hand-made\\n${OLD_BOX}CCRC_RELEASE_BASE_URL=https://releases.testbox.invalid\\n`];
    const h = fixture({}, WITH(catRule));
    connectedTo(h);
    // what the card sends for a Workers edit: that key alone
    expect(box(h, ['--set=CCRC_TESTBOX_WORKERS=3', '--set=CCRC_TESTBOX_SESSION_RUNS=2'])).toEqual({ ok: true });
    // the key in place, the new key appended, the comment and the non-table key and every other value kept
    expect(stdinOfLast(h, 'cmp')).toBe('# hand-made\n' + OLD_BOX.replace(/\\n/g, '\n').replace('WORKERS=2', 'WORKERS=3')
      + 'CCRC_RELEASE_BASE_URL=https://releases.testbox.invalid\nCCRC_TESTBOX_SESSION_RUNS=2\n');
    // the box file was read first, and the installer ran after the put
    const all = cmds(h);
    expect(all.findIndex((c) => /cat -- \/etc\/ccrc-testbox\/ccrc\.env$/.test(c))).toBeLessThan(all.findIndex((c) => c.includes('cmp -s')));
    expect(all.findIndex((c) => c.includes('cmp -s'))).toBeLessThan(all.findIndex((c) => c.includes('install.sh --reapply')));
  });

  it('settings-box refuses what the merged file cannot hold before anything is written, and what a sent key names that the installer would make root\'s', () => {
    // a box file with no listen address: even the one key sent makes a file the installer would refuse
    const h = fixture({}, WITH(['^(sudo -n -- )?cat -- /etc/ccrc-testbox/ccrc\\.env$', '0', 'CCRC_TESTBOX_ROOT=/srv/box\\n']));
    connectedTo(h);
    expect(box(h, ['--set=CCRC_TESTBOX_WORKERS=3'])).toEqual({ ok: false, code: 'box-value-refused' });
    expect(cmds(h).filter((c) => c.includes('cmp -s') || c.includes('install.sh'))).toEqual([]);
    // a service token that is not in the service user's home, and a root that is a system directory: refused on the fleet host
    // by the sent key alone, with no call to the box at all
    for (const word of ['--set=CCRC_TESTBOX_SERVICE_TOKEN_FILE=/etc/passwd', '--set=CCRC_TESTBOX_ROOT=/root', '--set=CCRC_TESTBOX_REPOS=/etc',
      '--set=CCRC_TESTBOX_SERVICE_USER=root', '--set=CCRC_TESTBOX_PUSH_USER=root']) {
      const g = fixture();
      connectedTo(g);
      expect(box(g, [word]), word).toMatchObject({ ok: false, code: 'box-value-refused' });
      expect(cmds(g).filter((c) => c.includes('cmp -s') || c.includes('install.sh')), word).toEqual([]);
    }
    // not connected
    const n = fixture();
    expect(box(n, [...WORDS()])).toEqual({ ok: false, code: 'not-connected' });
  });

  it('settings-box with a run in progress answers runs-in-progress, and touches nothing', () => {
    const h = fixture({ FAKE_API_BUSY_FIRST: '999' });
    connectedTo(h);
    expect(box(h, [...WORDS()])).toEqual({ ok: false, code: 'runs-in-progress' });
    expect(sshCalls(h)).toEqual([]);
    expect(stateText(h)).not.toContain('act_id=');
    // a queued run counts too
    const q = fixture({ FAKE_API_IDLE: '{"ok":true,"testbox":{"state":"ok","box":{"runs":{"inProgress":0,"limit":2},"queueDepth":3}}}' });
    connectedTo(q);
    expect(box(q, [...WORDS()])).toEqual({ ok: false, code: 'runs-in-progress' });
    // a box whose service is down has nothing running
    const d = fixture({ FAKE_API_IDLE: '{"ok":true,"testbox":{"state":"unreachable","box":null}}' });
    connectedTo(d);
    expect(box(d, [...WORDS()])).toEqual({ ok: true });
  });

  it('on a single box (no agent.env) runs in progress are the box\'s own active run, prepare and install units, and a box that cannot be asked counts as busy', () => {
    const units = (n: string, rc = '0'): string[] => ['list-units', rc, `${n}\\n`];
    const busy = fixture({ TBA_API: '' }, WITH(units('2')));
    connectedTo(busy);
    expect(existsSync(join(busy.home, '.ccrc', 'agent.env'))).toBe(false);
    expect(box(busy, [...WORDS()])).toEqual({ ok: false, code: 'runs-in-progress' });
    const asked = cmds(busy).filter((c) => c.includes('list-units'));
    expect(asked).toHaveLength(1);
    expect(asked[0]).toContain('ccrc-testbox-run@*.service');
    expect(asked[0]).toContain('ccrc-testbox-prepare@*.service');
    expect(asked[0]).toContain('ccrc-testbox-install.service');
    // no unit active: idle, and the change is applied
    const idle = fixture({ TBA_API: '' }, WITH(units('0')));
    connectedTo(idle);
    expect(box(idle, [...WORDS()])).toEqual({ ok: true });
    // an answer that is not a number, and a box that does not answer, are busy: the service may be running
    for (const rule of [units('lots'), units('', '255')]) {
      const g = fixture({ TBA_API: '' }, WITH(rule));
      connectedTo(g);
      expect(box(g, [...WORDS()])).toEqual({ ok: false, code: 'runs-in-progress' });
    }
    // Apply when idle waits on the same measure and then applies
    const w = fixture({ TBA_API: '', TBA_IDLE_POLL: '0' }, WITH(units('1')));
    connectedTo(w);
    const id = detach(w, 'settings-box', WORDS(['--when-idle=true']));
    writeFileSync(w.rules, [units('0'), ...PASSING_RULES].map((r) => r.join('\t')).join('\n') + '\n');
    expect(unit(w, 'settings-box', id)).toBe(0);
    expect(lastAct(w)).toMatchObject({ outcome: 'ok', code: null });
  });

  it('a settings-box leaves the fleet host\'s record of the rows as it is', () => {
    const h = fixture();
    connectedTo(h);
    const rows = join(h.home, '.ccrc', 'testbox-rows');
    const text = 'other https://testbox.invalid/other.git server ./node_modules/.bin/vitest\nproject-a https://old.invalid/a.git server old\n';
    writeFileSync(rows, text);
    expect(box(h, [...WORDS()])).toEqual({ ok: true });
    expect(readFileSync(rows, 'utf8')).toBe(text);
    const g = fixture();
    connectedTo(g);
    expect(box(g, [...WORDS()])).toEqual({ ok: true });
    expect(existsSync(join(g.home, '.ccrc', 'testbox-rows'))).toBe(false);
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
    expect(box(h, [...WORDS(['--set=CCRC_TESTBOX_WORKERS=2', '--set=CCRC_TESTBOX_LOG_TAIL=50'])])).toEqual({ ok: true });
    expect(stateText(h)).not.toMatch(/^parity_stale=/m);
    // WORKERS changed
    expect(box(h, [...WORDS(['--set=CCRC_TESTBOX_WORKERS=4', '--set=CCRC_TESTBOX_LOG_TAIL=40'])])).toEqual({ ok: true });
    expect(stateText(h)).toMatch(/^parity_stale=1$/m);
    // a run-shaping key the box has and the card did not send is kept as it was: not a change
    const g = fixture();
    connectedTo(g);
    expect(box(g, [...WORDS(['--set=CCRC_TESTBOX_LOG_TAIL=40'])])).toEqual({ ok: true });
    expect(stateText(g)).not.toMatch(/^parity_stale=/m);
    // a run-shaping key the box did not have is a change
    const k = fixture();
    connectedTo(k);
    expect(box(k, ['--set=CCRC_TESTBOX_RUN_MEMORY_MAX=6G'])).toEqual({ ok: true });
    expect(stateText(k)).toMatch(/^parity_stale=1$/m);
  });

  it('settings-box puts the old box file back when the installer refuses', () => {
    const line = 'ccrc-testbox-install: refused: CCRC_TESTBOX_LISTEN does not name an IP address';
    const h = fixture({}, WITH(['install\\.sh', '1', `${line}\\n`]));
    connectedTo(h);
    expect(box(h, [...WORDS(['--set=CCRC_TESTBOX_WORKERS=4'])])).toEqual({ ok: false, code: 'install-refused' });
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

describe.skipIf(!HAS_KEYGEN || !HAS_FLOCK || !HAS_NODE)('Reset to default: --unset takes the key out of the file ccrc wrote, so its reader answers the default (D-8336)', () => {
  it('settings-fleet --unset removes the key\'s line from the overlay, keeps every other line, and answers the reader\'s read', () => {
    const h = fixture();
    writeFileSync(h.overlay, 'CCRC_TESTBOX_POLL=45s\nCCRC_TESTBOX_QUEUE_LIMIT=7\nCCRC_TESTBOX_DENY_GLOBS=*.pem\n', { mode: 0o600 });
    const r = verb(h, 'settings-fleet', '--unset=CCRC_TESTBOX_POLL', '--unset=CCRC_TESTBOX_DENY_GLOBS', '--from', 'pwa');
    const a = json(r);
    expect(a['ok'], r.out + r.err).toBe(true);
    expect(readFileSync(h.overlay, 'utf8')).toBe('CCRC_TESTBOX_QUEUE_LIMIT=7\n');
    expect(sh(h, 'stat -c %a "$HOME/.ccrc/testbox.env" 2>/dev/null || stat -f %Lp "$HOME/.ccrc/testbox.env"').out.trim()).toBe('600');
    expect(readdirSync(join(h.home, '.ccrc')).filter((n) => n.includes('.tmp.') || n.includes('.bak.'))).toEqual([]);
    // the reader no longer reads the key from the file: it answers its default
    expect(a['settings']).toEqual([{ key: 'CCRC_TESTBOX_POLL', set: false }, { key: 'CCRC_TESTBOX_DENY_GLOBS', set: false }]);
    const knob = sh(h, SRC + '_ccrc_knob CCRC_TESTBOX_POLL 30s file; printf "%s|%s" "$KNOB" "$KNOB_FROM"', [VERB]);
    expect(knob.out).toBe('30s|default');
  });

  it('settings-fleet sets and unsets in one write, and an unset of a key the overlay does not hold is a no-op that answers ok', () => {
    const h = fixture();
    writeFileSync(h.overlay, 'CCRC_TESTBOX_POLL=45s\n', { mode: 0o600 });
    expect(json(verb(h, 'settings-fleet', '--set=CCRC_TESTBOX_BUDGET=9m', '--unset=CCRC_TESTBOX_POLL', '--from', 'pwa'))['ok']).toBe(true);
    expect(readFileSync(h.overlay, 'utf8')).toBe('CCRC_TESTBOX_BUDGET=9m\n');
    expect(json(verb(h, 'settings-fleet', '--unset=CCRC_TESTBOX_LOST_RUN', '--from', 'pwa'))['ok']).toBe(true);
    expect(readFileSync(h.overlay, 'utf8')).toBe('CCRC_TESTBOX_BUDGET=9m\n');
  });

  it('a key ccrc.env sets has no reset: settings-fleet --unset refuses key-in-ccrc-env naming it, and writes nothing', () => {
    const h = fixture();
    writeFileSync(h.ccrcEnv, 'CCRC_TESTBOX_BUDGET=20m\n');
    writeFileSync(h.overlay, 'CCRC_TESTBOX_POLL=45s\n', { mode: 0o600 });
    const r = verb(h, 'settings-fleet', '--unset=CCRC_TESTBOX_BUDGET', '--unset=CCRC_TESTBOX_POLL', '--from', 'pwa');
    expect(json(r)).toEqual({ ok: false, code: 'key-in-ccrc-env', keys: ['CCRC_TESTBOX_BUDGET'] });
    expect(readFileSync(h.overlay, 'utf8')).toBe('CCRC_TESTBOX_POLL=45s\n');
    expect(readFileSync(h.ccrcEnv, 'utf8')).toBe('CCRC_TESTBOX_BUDGET=20m\n');
  });

  it('settings-fleet --unset of a pairing key, a box key or no key is a usage error, and the overlay is untouched', () => {
    const h = fixture();
    writeFileSync(h.overlay, 'CCRC_TESTBOX_POLL=45s\n', { mode: 0o600 });
    for (const w of ['--unset=CCRC_TESTBOX_URL', '--unset=CCRC_TESTBOX_TOKEN_FILE', '--unset=CCRC_TESTBOX_WORKERS', '--unset=', '--unset=CCRC_PORT']) {
      const r = verb(h, 'settings-fleet', w, '--from', 'pwa');
      expect(r.rc, w).toBe(2);
      expect(r.out, w).toBe('');
    }
    expect(readFileSync(h.overlay, 'utf8')).toBe('CCRC_TESTBOX_POLL=45s\n');
  });

  it('settings-box --unset takes the key\'s line out of the box\'s current file, every other line kept, and re-applies', () => {
    const catRule = ['^(sudo -n -- )?cat -- /etc/ccrc-testbox/ccrc\\.env$', '0', `# hand-made\\n${OLD_BOX}CCRC_TESTBOX_OS_MIRROR=https://mirror.testbox.invalid\\n`];
    const h = fixture({}, WITH(catRule));
    connectedTo(h);
    expect(box(h, ['--unset=CCRC_TESTBOX_LOG_TAIL', '--unset=CCRC_TESTBOX_OS_MIRROR'])).toEqual({ ok: true });
    expect(stdinOfLast(h, 'cmp')).toBe('# hand-made\n' + OLD_BOX.replace(/\\n/g, '\n').replace('CCRC_TESTBOX_LOG_TAIL=40\n', ''));
    const all = cmds(h);
    expect(all.findIndex((c) => c.includes('cmp -s'))).toBeLessThan(all.findIndex((c) => c.includes('install.sh --reapply')));
    // a key the box file does not hold is a no-op for the file; the apply still runs
    const g = fixture();
    connectedTo(g);
    expect(box(g, ['--set=CCRC_TESTBOX_WORKERS=3', '--unset=CCRC_TESTBOX_TMPFS'])).toEqual({ ok: true });
    expect(stdinOfLast(g, 'cmp')).toBe(OLD_BOX.replace(/\\n/g, '\n').replace('WORKERS=2', 'WORKERS=3'));
  });

  it('settings-box --unset of a pairing setting is refused naming it, and nothing is sent to the box', () => {
    for (const k of TESTBOX_PAIRED_BOX_KEYS) {
      const h = fixture();
      connectedTo(h);
      const r = verb(h, 'settings-box', `--unset=${k}`, '--from', 'pwa');
      expect(r.rc, k).toBe(2);
      expect(sshCalls(h), k).toEqual([]);
      expect(stateText(h), k).not.toContain('act_id=');
    }
  });

  it('a key whose declared default the installer refuses (the root and the repository directory, `~/` paths) has no reset: refused naming it, before the box is asked', () => {
    expect(sh(fixture(), SRC + 'for k in CCRC_TESTBOX_ROOT CCRC_TESTBOX_TOOLS_DIR CCRC_TESTBOX_OS_MIRROR; do printf "%s=%s\\n" "$k" "$(_tba_box_default "$k")"; done', [VERB]).out)
      .toBe('CCRC_TESTBOX_ROOT=~/.ccrc/testbox\nCCRC_TESTBOX_TOOLS_DIR=/opt/ccrc-testbox/tools\nCCRC_TESTBOX_OS_MIRROR=\n');
    for (const k of ['CCRC_TESTBOX_ROOT', 'CCRC_TESTBOX_REPOS']) {
      const h = fixture();
      connectedTo(h);
      expect(box(h, [`--unset=${k}`]), k).toEqual({ ok: false, code: 'box-value-refused', keys: [k] });
      expect(sshCalls(h), k).toEqual([]);
      expect(stateText(h), k).not.toContain('act_id=');
    }
  });

  it('resetting a run-shaping key the box file held marks parity stale; resetting one it did not hold does not', () => {
    const h = fixture();
    connectedTo(h);
    expect(box(h, ['--unset=CCRC_TESTBOX_RUN_MEMORY_MAX'])).toEqual({ ok: true });
    expect(stateText(h)).not.toMatch(/^parity_stale=/m);
    expect(box(h, ['--unset=CCRC_TESTBOX_WORKERS'])).toEqual({ ok: true });
    expect(stateText(h)).toMatch(/^parity_stale=1$/m);
  });
});

describe.skipIf(!HAS_KEYGEN || !HAS_FLOCK || !HAS_NODE)('ccrc testbox-admin settings-box is always a detached act, and keeps the pairing (D-8166, TC8 review)', () => {
  it('the parent only detaches (its one read of the fleet is the busy check): the apply, which outruns a short sub\'s bound, runs in the unit', () => {
    const h = fixture();
    connectedTo(h);
    const id = detach(h, 'settings-box', WORDS(['--set=CCRC_TESTBOX_WORKERS=2']));
    expect(lastAct(h)).toMatchObject({ id, sub: 'settings-box', outcome: 'running' });
    expect(readFileSync(join(h.home, 'systemd-run-calls'), 'utf8')).toContain(`--unit=ccrc-testbox-admin-settings-box-${id}`);
    expect(sshCalls(h)).toEqual([]);
    expect(unit(h, 'settings-box', id)).toBe(0);
    const a = lastAct(h);
    expect(a).toMatchObject({ outcome: 'ok', code: null, phase: 'install' });
    expect(a.phases.map((p) => p.name)).toEqual(['wait', 'settings', 'install']);
    expect(cmds(h).some((c) => c.includes('install.sh --reapply'))).toBe(true);
  });

  it('a run that starts between the parent\'s look and the unit\'s is still refused, and nothing is written', () => {
    const h = fixture();
    connectedTo(h);
    const id = detach(h, 'settings-box', WORDS(['--set=CCRC_TESTBOX_WORKERS=2']));
    h.env['FAKE_API_BUSY_FIRST'] = '999';
    expect(unit(h, 'settings-box', id)).toBe(0);
    expect(lastAct(h)).toMatchObject({ outcome: 'failed', code: 'runs-in-progress' });
    expect(sshCalls(h)).toEqual([]);
  });

  it('the four pairing settings are refused whatever the value, naming the key, and nothing is sent to the box', () => {
    const sent = ['CCRC_TESTBOX_LISTEN=10.0.0.9:7500', 'CCRC_TESTBOX_SERVICE_TOKEN_FILE=~/.ccrc/other.token', 'CCRC_TESTBOX_SERVICE_USER=ccrc-other', 'CCRC_TESTBOX_PUSH_USER=ccrc-push'];
    expect(sent.map((kv) => kv.split('=')[0])).toEqual([...TESTBOX_PAIRED_BOX_KEYS]);
    for (const kv of sent) {
      const h = fixture();
      connectedTo(h);
      expect(box(h, [...WORDS(), `--set=${kv}`]), kv).toEqual({ ok: false, code: 'box-value-refused', keys: [kv.split('=')[0]] });
      expect(sshCalls(h), kv).toEqual([]);
      expect(stateText(h), kv).not.toContain('act_id=');
    }
  });

  it('a non-shaping edit leaves a passed parity record armable: the record follows the box file\'s new digest, and the stale mark is not set', () => {
    const FP = `SHA256:${'A'.repeat(43)}`;
    const h = fixture();
    connectedTo(h, [`fingerprint=${FP}`]);
    const record = { v: 1, result: 'pass', prs: [], fixtures: [], release: 'v1.2.3', toolsKey: 'none', fingerprint: FP, boxFileSha256: 'b'.repeat(64), at: 1 };
    writeFileSync(h.parity, JSON.stringify(record) + '\n', { mode: 0o600 });
    const armable = (): boolean => {
      const st = status(h);
      expect(st.ok, JSON.stringify(st)).toBe(true);
      if (!st.ok) return false;
      return parityArmable(st.value.parity, parityCurrentOf(st.value));
    };
    expect(armable()).toBe(true);
    // CCRC_TESTBOX_RETENTION shapes no run
    expect(box(h, [...WORDS(['--set=CCRC_TESTBOX_RETENTION=48h'])])).toEqual({ ok: true });
    expect(stateText(h)).not.toMatch(/^parity_stale=/m);
    const stCheck = status(h);
    expect(stCheck.ok && stCheck.value.boxFileSha256).not.toBe('b'.repeat(64));
    expect(JSON.parse(readFileSync(h.parity, 'utf8')).boxFileSha256).toBe(stCheck.ok ? stCheck.value.boxFileSha256 : '');
    expect(armable()).toBe(true);
    expect(readFileSync(h.parity, 'utf8').trim().split('\n')).toHaveLength(1);
    expect((statSync(h.parity).mode & 0o777).toString(8)).toBe('600');
    // a run-shaping edit marks it stale and leaves the record alone: parity must run again
    const before = readFileSync(h.parity, 'utf8');
    expect(box(h, [...WORDS(['--set=CCRC_TESTBOX_WORKERS=4'])])).toEqual({ ok: true });
    expect(stateText(h)).toMatch(/^parity_stale=1$/m);
    expect(readFileSync(h.parity, 'utf8')).toBe(before);
    expect(armable()).toBe(false);
    expect(status(h).ok && (status(h) as { value: { parityStale?: boolean } }).value.parityStale).toBe(true);
    // the box file returns to the digest the record names (the fake box answers its one old file, so this edit rebuilds the first
    // edit's file) and the mark stands: the digest alone would read pass, the status carries the mark so no reader does
    expect(box(h, [...WORDS(['--set=CCRC_TESTBOX_RETENTION=48h'])])).toEqual({ ok: true });
    const back = status(h);
    expect(back.ok).toBe(true);
    if (back.ok) {
      expect(back.value.boxFileSha256).toBe(JSON.parse(before).boxFileSha256);
      expect(parityArmable(back.value.parity, { fingerprint: back.value.fingerprint, boxFileSha256: back.value.boxFileSha256, stale: false })).toBe(true);
      expect(back.value.parityStale).toBe(true);
    }
    expect(stateText(h)).toMatch(/^parity_stale=1$/m);
    expect(armable()).toBe(false);
    // a later non-shaping edit does not bring a stale record back
    expect(box(h, [...WORDS(['--set=CCRC_TESTBOX_RETENTION=72h'])])).toEqual({ ok: true });
    expect(readFileSync(h.parity, 'utf8')).toBe(before);
    expect(armable()).toBe(false);
  });

  it('a record that did not name the digest the state held (an old or foreign one) is left as it is', () => {
    const FP = `SHA256:${'A'.repeat(43)}`;
    const h = fixture();
    connectedTo(h, [`fingerprint=${FP}`]);
    const record = JSON.stringify({ v: 1, result: 'pass', prs: [], fixtures: [], release: 'v1.2.3', toolsKey: 'none', fingerprint: FP, boxFileSha256: 'c'.repeat(64), at: 1 }) + '\n';
    writeFileSync(h.parity, record, { mode: 0o600 });
    expect(box(h, [...WORDS(['--set=CCRC_TESTBOX_RETENTION=48h'])])).toEqual({ ok: true });
    expect(readFileSync(h.parity, 'utf8')).toBe(record);
  });
});

describe.skipIf(!HAS_KEYGEN || !HAS_FLOCK || !HAS_NODE)('the status carries the acts that ended before the current one (D-8166, spec §2.10)', () => {
  it('a second act that begins before anyone read the first leaves the first in endedActs, oldest first, at most six', () => {
    const h = fixture({}, WITH(['install\\.sh', '1', 'ccrc-testbox-install: failed: cannot start the test service\\n']));
    connectedTo(h);
    const ids: string[] = [];
    for (let i = 0; i < 8; i++) ids.push(act(h, 'repair', []));
    const st = status(h);
    expect(st.ok, JSON.stringify(st)).toBe(true);
    if (!st.ok) return;
    expect(st.value.act!.id).toBe(ids[7]);
    expect((st.value.endedActs ?? []).map((a) => a.id)).toEqual(ids.slice(1, 7));
    for (const a of st.value.endedActs ?? []) expect(a).toMatchObject({ sub: 'repair', outcome: 'failed' });
    // a running act is never in the list
    const id = detach(h, 'repair', []);
    const mid = status(h);
    expect(mid.ok && mid.value.act!.id).toBe(id);
    expect(mid.ok && (mid.value.endedActs ?? []).map((a) => a.id)).toEqual(ids.slice(2, 8));
  });

  it('an older verb\'s status, which has no endedActs, reads as none', () => {
    const h = fixture();
    const st = status(h);
    expect(st.ok && st.value.endedActs).toEqual([]);
  });
});

describe.skipIf(!HAS_KEYGEN || !HAS_FLOCK || !HAS_NODE)('ccrc testbox-admin read (D-8166, TC8)', () => {
  const KNOBS = [
    'CCRC_TESTBOX_RUNS\\x1f2\\x1f3\\x1ffile\\n', 'CCRC_TESTBOX_WORKERS\\x1f2\\x1f2\\x1fdefault\\n',
    'CCRC_TESTBOX_RUN_TMPDIR\\x1f/tmp/r\\x1f/srv/secret-tmp\\x1ffile\\n', 'CCRC_TESTBOX_LISTEN\\x1f\\x1f10.0.0.9:7443\\x1ffile\\n',
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
    for (const secret of ['/srv/secret-tmp', '10.0.0.9', 'registry.example.invalid', 'github.com']) expect(text, secret).not.toContain(secret);
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
    keygen(h.push, 'ccrc-testbox-push');
    writeFileSync(h.overlay, 'CCRC_TESTBOX_URL=http://10.0.0.9:7443\nCCRC_TESTBOX_TOKEN_FILE=~/.ccrc/testbox.token\nCCRC_TESTBOX_GIT_URL_BASE=ssh://ccrc-tb-push@10.0.0.9:22/\nCCRC_TESTBOX_GIT_KEY=~/.ccrc/testbox-push.key\nCCRC_TESTBOX_POLL=45s\n', { mode: 0o600 });
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
    // the login user, then the mode `all`: every line of ccrc's, and any line holding ccrc's own key (D-8337)
    expect(all[1]).toMatch(/ sh root all /);
    // an unpair that fails still takes the access line out (root-capable, and a box that cannot unpair is the very one that must not
    // keep it), and says the box side did not finish so the operator finishes it by hand
    const g = fixture({}, WITH(['--unpair', '1', 'ccrc-testbox-install: failed: cannot stop the test service\\n']));
    paired(g);
    expect(json(verb(g, 'disconnect', '--from', 'pwa'))).toEqual({ ok: false, code: 'unpair-failed' });
    const gc = cmds(g);
    expect(gc).toHaveLength(2);
    expect(gc[1]).toContain('authorized_keys');
    expect(existsSync(g.token)).toBe(false);
    expect(existsSync(g.pin)).toBe(false);
  });

  it('disconnect removes only the paths the overlay names, and a push key only when it carries ccrc\'s own comment', () => {
    // The overlay names the default paths (Connect wrote them). A hand-placed token and key elsewhere, and a key at the push key's
    // path that a person made (another comment), are not ccrc's to delete.
    const h = fixture();
    paired(h);
    keygen(h.push, 'someone@laptop');
    const other = join(h.home, 'hand', 'push.key');
    keygen(other, 'ccrc-testbox-push');
    expect(json(verb(h, 'disconnect', '--from', 'pwa'))).toEqual({ ok: true });
    expect(existsSync(h.token)).toBe(false);
    expect(existsSync(h.push), 'a key ccrc did not make is kept').toBe(true);
    expect(existsSync(other), 'a path the overlay does not name is never touched').toBe(true);
    expect(readFileSync(h.lg, 'utf8')).toContain('was not made by ccrc and is kept');
    // an overlay that names no path leaves both default files alone
    const g = fixture();
    paired(g);
    writeFileSync(g.overlay, 'CCRC_TESTBOX_POLL=45s\n', { mode: 0o600 });
    expect(json(verb(g, 'disconnect', '--from', 'pwa'))).toEqual({ ok: true });
    expect(existsSync(g.token)).toBe(true);
    expect(existsSync(g.push)).toBe(true);
  });

  it('a pairing made by hand (ccrc.env names a pairing key) is left alone: no switch, no unpair, no token, key or overlay removed; the access line and the connection go', () => {
    const h = fixture();
    paired(h);
    // the hand setup's own paths, outside ~/.ccrc, one of them a person's ssh key
    const handToken = join(h.home, 'hand', 'token');
    const handKey = join(h.home, 'hand', 'id_ed25519');
    mkdirSync(path.dirname(handToken), { recursive: true });
    writeFileSync(handToken, 'e'.repeat(64), { mode: 0o600 });
    keygen(handKey, 'person@laptop');
    writeFileSync(h.ccrcEnv, `CCRC_TESTBOX_URL=http://10.0.0.9:7443\nCCRC_TESTBOX_TOKEN_FILE=${handToken}\nCCRC_TESTBOX_GIT_URL_BASE=ssh://ccrc-tb-push@10.0.0.9:22/\nCCRC_TESTBOX_GIT_KEY=${handKey}\n`);
    const envBefore = readFileSync(h.ccrcEnv);
    const overlayBefore = readFileSync(h.overlay);
    const r = verb(h, 'disconnect', '--from', 'pwa');
    expect(json(r), r.out + r.err).toEqual({ ok: true });
    // the switch is not lowered and the box is not unpaired: the one box call is the removal of ccrc's own access line
    expect(ops(h).filter((c) => c[0] === 'ccd')).toEqual([]);
    const all = cmds(h);
    expect(all).toHaveLength(1);
    expect(all[0]).toContain('authorized_keys');
    expect(all.some((c) => c.includes('--unpair'))).toBe(false);
    // the operator's files, ccrc.env and ccrc's own overlay are as they were
    expect(readFileSync(handToken, 'utf8')).toBe('e'.repeat(64));
    expect(existsSync(handKey)).toBe(true);
    expect(existsSync(h.token) && existsSync(h.push), 'even the files at the default paths: the pairing is not ccrc\'s').toBe(true);
    expect(readFileSync(h.ccrcEnv).equals(envBefore)).toBe(true);
    expect(readFileSync(h.overlay).equals(overlayBefore)).toBe(true);
    // what is ccrc's own goes: the pin, the parity record, the snapshot and the connection
    for (const f of [h.pin, h.parity, h.snapshot]) expect(existsSync(f), f).toBe(false);
    expect(stateText(h)).not.toMatch(/^(address|connected)=/m);
    expect(existsSync(h.key)).toBe(true);
    expect(readFileSync(h.lg, 'utf8')).toContain('left alone');
    // one named key is enough, and a key ccrc.env sets empty counts (it is named)
    const g = fixture();
    paired(g);
    writeFileSync(g.ccrcEnv, 'CCRC_TESTBOX_GIT_KEY=\n');
    expect(json(verb(g, 'disconnect', '--from', 'pwa'))).toEqual({ ok: true });
    expect(ops(g).filter((c) => c[0] === 'ccd')).toEqual([]);
    expect(existsSync(g.token) && existsSync(g.push) && existsSync(g.overlay)).toBe(true);
  });

  it('a Connect refused in the installer\'s first phase left no installed tree: disconnect removes the access line, and the answer is ok', () => {
    // the installed tree's installer is missing, so `bash <it> --unpair` exits 127; the box WAS reached
    const h = fixture({}, WITH(['--unpair', '127', 'bash: /opt/tools/release/installed/deploy/testbox/install.sh: No such file or directory\\n']));
    paired(h);
    expect(json(verb(h, 'disconnect', '--from', 'pwa'))).toEqual({ ok: true });
    const all = cmds(h);
    expect(all).toHaveLength(2);
    expect(all[1]).toContain('authorized_keys');
    expect(all[1]).toContain('ccrc-testbox-admin');
    expect(existsSync(h.token)).toBe(false);
  });

  it('a connection that was set and never Connected (an address, a pin, a placed line) is undone the same way, and the access key is kept', () => {
    const h = fixture();
    // `key` and `pin` ran, nothing else: no connected=1, no installed tree
    const g = verb(h, 'key', `--address=${ADDR}`);
    expect(json(g)['ok'], g.out + g.err).toBe(true);
    writeFileSync(h.pin, `${ADDR} ssh-ed25519 AAAA\n`, { mode: 0o600 });
    const before = readFileSync(h.key);
    expect(json(verb(h, 'disconnect', '--from', 'pwa'))).toEqual({ ok: true });
    expect(cmds(h).some((c) => c.includes('authorized_keys'))).toBe(true);
    expect(existsSync(h.pin)).toBe(false);
    const s = status(h);
    expect(s.ok && s.value).toMatchObject({ addressSet: false, connected: false, hostKey: 'none' });
    expect(readFileSync(h.key).equals(before)).toBe(true);
    // a source the operator gave goes with the connection
    json(verb(h, 'key', `--address=${ADDR}`, '--source=10.0.0.250'));
    expect(stateText(h)).toContain('source=10.0.0.250\n');
    verb(h, 'disconnect', '--from', 'pwa');
    expect(stateText(h)).not.toMatch(/^source=/m);
  });

  it('a line that cannot be removed after a good unpair says unpair-failed too: the operator removes it by hand', () => {
    const h = fixture({}, WITH(['authorized_keys', '1', '']));
    paired(h);
    expect(json(verb(h, 'disconnect', '--from', 'pwa'))).toEqual({ ok: false, code: 'unpair-failed' });
    expect(existsSync(h.token)).toBe(false);
  });

  it('a box that does not answer the unpair is box-side-skipped and no line removal is tried', () => {
    const h = fixture({}, WITH(['--unpair', '255', '']));
    paired(h);
    expect(json(verb(h, 'disconnect', '--from', 'pwa'))).toEqual({ ok: false, code: 'box-side-skipped' });
    expect(cmds(h)).toHaveLength(1);
  });

  it('disconnect removes the token, the push key, the overlay, the pin, the parity record and the snapshot', () => {
    const h = fixture();
    paired(h, ['parity_stale=1', 'fingerprint=SHA256:' + 'A'.repeat(43)]);
    const rows = join(h.home, '.ccrc', 'testbox-rows');
    writeFileSync(rows, 'project-a https://testbox.invalid/project-a.git server ./node_modules/.bin/vitest\n');
    expect(json(verb(h, 'disconnect', '--replace=true', '--from', 'pwa'))).toEqual({ ok: true });
    for (const f of [h.token, h.push, h.overlay, h.pin, h.parity, h.snapshot, rows]) expect(existsSync(f), f).toBe(false);
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
    expect(sh(h, probe, [VERB]).out).toContain('CCRC_TESTBOX_URL=[http://10.0.0.9:7443]');
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

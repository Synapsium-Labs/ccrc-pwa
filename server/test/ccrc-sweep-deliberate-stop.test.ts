// The move INTO wave 10 (centralised update management, R12's script half):
// `main`'s CURRENT `_upd_sweep`, sourced WITHOUT an edit, run against the NEW
// `deploy/verify-service.sh`.
//
// WHY THIS FILE EXISTS. The live auto-update that carries wave 10 runs the OLD
// sweep with the NEW script, by construction:
//   - the detached update re-execs the launcher (`ccd/ccrc:18026`);
//   - the launcher execs `~/ccrc/ccd/ccrc` BEFORE the flip:
//     `exec "$CCRC_SHIPPED" "$@"` (`ccd/ccrc:13695`);
//   - the old sweep resolves the script at the moment it calls it:
//     `local verify="$BOX_TREE_DIR/deploy/verify-service.sh"` (`ccd/ccrc:20619`),
//     with `BOX_TREE_DIR="$HOME/ccrc"` (`ccd/ccrc:1588`) — and by then the link
//     names the NEW tree.
// The old caller dies on any non-zero exit (`|| _ccrc_die "$u was restarted and
// did not stay up …`), so only an exit 0 from the script protects that move.
// agent/test/deploy-verify.test.ts proves the script's exit; THIS file proves
// the old caller, unedited, honours it: a stamped stop returns 0, a purged one
// returns 0, an unstamped one dies exactly as it does today.
//
// THE TECHNIQUE is `ccrc-update.test.ts`'s `sourcedCcrc`, COPIED and not
// imported (importing a .test.ts module registers its cases a second time): a
// shell that SOURCES `ccd/ccrc` — its dispatch is guarded by `BASH_SOURCE[0] ==
// $0`, so sourcing defines functions and runs no verb — and then calls
// `_upd_sweep` directly, on a fixture HOME whose `systemctl` is a stub.
//
// THE PRECONDITION (X0). This proves the move INTO wave 10 only while the sweep
// is the serial shape that move runs. When wave 11 reshapes `_upd_sweep`, X0
// goes red on purpose: re-home the case on a frozen copy of the pre-wave-11
// sweep (coordinator ruling 2, Reading 2), or retire it.
//
// SAFETY. A fixture HOME only, and an env built from scratch (never
// `...process.env`). Every tool the sweep or the script could reach that is not
// a stub is a POISON that records to `$HOME/<name>-poison` and exits 97, and
// `assertContained` proves, before every spawn, that each one resolves inside
// the fixture's bin. Nothing here runs a real ccd, ccrc, systemctl, journalctl,
// tmux, gh or ssh, or reads a real registry.
import { describe, it, expect } from 'vitest';
import { spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkTmp } from './tmpHelpers.js';
import { ghContainedEnv, harnessBin } from './ccdWsHelpers.js';
import { itLinux } from './platformFixtures.js';

const here = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(here, '..', '..');

/** The one name for the sourced `ccd/ccrc`: X0 reads it and the spawn passes it as `$1`. */
const CCRC_SRC = join(REPO, 'ccd', 'ccrc');
/** The script the fixture's `~/ccrc/deploy/verify-service.sh` is a copy of. */
const VERIFY_SRC = join(REPO, 'deploy', 'verify-service.sh');

function realPath(name: string): string {
  const p = spawnSync('bash', ['-c', `command -v ${name}`], { encoding: 'utf8' }).stdout.trim();
  if (p === '') throw new Error(`this box has no ${name} — the fixture needs it`);
  return p;
}
const BASH = realPath('bash');

/** What gets a poison planted. `gh` is not here: `ghContainedEnv` plants it. */
const POISONS = ['tmux', 'ccd', 'launchctl', 'loginctl', 'systemd-run', 'ssh', 'scp', 'curl', 'npm'] as const;
/** Every tool that must resolve INSIDE the fixture bin, spelled out on its own so
 *  that dropping a poison above is a red case, not a quiet shrinking of this list. */
const CONTAINED = [
  'systemctl', 'journalctl', 'tmux', 'ccd', 'launchctl', 'loginctl', 'systemd-run', 'ssh', 'scp', 'curl', 'npm', 'gh',
] as const;

const DEMO_GOOD = 'claude-session@demo-good.service';
const DEMO_GONE = 'claude-session@demo-gone.service';
const STAMP = '1791151850 ccd';

interface Box { home: string; env: NodeJS.ProcessEnv }

interface Plant {
  /** `demo-gone`'s `is-active` answers, in call order; the last one repeats. */
  goneActive: string[];
  /** `demo-gone`'s `show -p MainPID --value` answers, in call order; the last one repeats. */
  goneMainPid: string[];
  /** Registry files to plant under `~/.cc-sessions/`. */
  registry: Record<string, string>;
}

/** The stub `systemctl`, after `ccrc-update.test.ts:391-392` and `:460`: it records
 *  `$*` before any shift, requires `--user`, shifts it off, and answers each verb
 *  the sweep and the script make. `is-active` and MainPID are answered per unit
 *  from lists the plant wrote, one answer per call, the last repeating. */
const SYSTEMCTL_STUB = [
  '#!/bin/sh',
  'printf \'%s\\n\' "$*" >> "$HOME/systemctl-calls"',
  '[ "$1" = "--user" ] || { echo "fixture systemctl: unexpected argv: $*" >&2; exit 90; }',
  'shift',
  'nth() {   # $1 = list file, $2 = counter file -> the answer for this call',
  '  n=0; [ -f "$2" ] && IFS= read -r n < "$2"',
  '  n=$((n + 1)); echo "$n" > "$2"',
  '  w=$(sed -n "${n}p" "$1")',
  '  [ -n "$w" ] || w=$(tail -n 1 "$1")',
  '  printf \'%s\\n\' "$w"',
  '}',
  'case "$1" in',
  '  list-units)',
  '    [ "$2" = "claude-session@*" ] || { echo "fixture systemctl: unexpected argv: $*" >&2; exit 90; }',
  '    state=""',
  '    for a in "$@"; do case "$a" in --state=*) state="${a#--state=}" ;; esac; done',
  '    case "$state" in',
  '      failed) exit 0 ;;',
  '      ""|active)',
  `        echo "${DEMO_GOOD} loaded active running x"`,
  `        echo "${DEMO_GONE} loaded active running x"`,
  '        exit 0 ;;',
  '    esac',
  '    echo "fixture systemctl: unexpected argv: $*" >&2; exit 90 ;;',
  '  show)',
  '    [ "$2" = "-p" ] || { echo "fixture systemctl: unexpected argv: $*" >&2; exit 90; }',
  '    case "$3" in',
  '      KillMode) echo "KillMode=process"; exit 0 ;;',
  '      MainPID)',
  '        [ "$4" = "--value" ] || { echo "fixture systemctl: unexpected argv: $*" >&2; exit 90; }',
  '        for u; do :; done',
  '        [ -f "$HOME/fx/$u.pid" ] || { echo "fixture systemctl: unexpected argv: $*" >&2; exit 90; }',
  '        nth "$HOME/fx/$u.pid" "$HOME/fx/$u.pid.n"; exit 0 ;;',
  '    esac',
  '    echo "fixture systemctl: unexpected argv: $*" >&2; exit 90 ;;',
  '  try-restart) exit 0 ;;',
  '  status) exit 0 ;;',
  '  is-active)',
  '    u="$2"',
  '    [ -f "$HOME/fx/$u.active" ] || { echo "fixture systemctl: unexpected argv: $*" >&2; exit 90; }',
  '    w=$(nth "$HOME/fx/$u.active" "$HOME/fx/$u.active.n")',
  '    echo "$w"; [ "$w" = active ] && exit 0; exit 3 ;;',
  'esac',
  'echo "fixture systemctl: unexpected argv: $*" >&2; exit 90',
  '',
].join('\n');

const JOURNALCTL_STUB = [
  '#!/bin/sh',
  'printf \'%s\\n\' "$*" >> "$HOME/journalctl-calls"',
  'echo "fixture journal line"',
  'exit 0',
  '',
].join('\n');

function poisonStub(name: string): string {
  return '#!/bin/sh\n'
    + `printf '%s\\n' "$*" >> "$HOME/${name}-poison"\n`
    + `echo "the ${name} poison: no case here may reach a real ${name}" >&2\nexit 97\n`;
}

/** Build the fixture box: HOME, the copied script, the stubs, the poisons, the env. */
function makeBox(plant: Plant, poisons: readonly string[] = POISONS): Box {
  const home = mkTmp('ccrc-sweep-stop-');
  mkdirSync(join(home, 'ccrc', 'deploy'), { recursive: true });
  cpSync(VERIFY_SRC, join(home, 'ccrc', 'deploy', 'verify-service.sh'));
  mkdirSync(join(home, 'run'), { recursive: true });
  const reg = join(home, '.cc-sessions');
  mkdirSync(reg, { recursive: true });
  for (const [name, body] of Object.entries(plant.registry)) writeFileSync(join(reg, name), body);

  const fx = join(home, 'fx');
  mkdirSync(fx, { recursive: true });
  const lists: Array<[string, string[]]> = [
    [`${DEMO_GOOD}.active`, ['active']],
    [`${DEMO_GOOD}.pid`, ['4242']],
    [`${DEMO_GONE}.active`, plant.goneActive],
    [`${DEMO_GONE}.pid`, plant.goneMainPid],
  ];
  for (const [name, answers] of lists) {
    if (answers.length > 0) writeFileSync(join(fx, name), answers.join('\n') + '\n');
  }

  const bin = harnessBin(home);
  writeFileSync(join(bin, 'systemctl'), SYSTEMCTL_STUB, { mode: 0o755 });
  writeFileSync(join(bin, 'journalctl'), JOURNALCTL_STUB, { mode: 0o755 });
  for (const name of poisons) writeFileSync(join(bin, name), poisonStub(name), { mode: 0o755 });

  const base: NodeJS.ProcessEnv = {
    HOME: home,
    PATH: process.env['PATH'] ?? '',
    LANG: 'C',
    XDG_RUNTIME_DIR: join(home, 'run'),
    DBUS_SESSION_BUS_ADDRESS: `unix:path=${join(home, 'run', 'bus')}`,
    CCRC_VERIFY_SETTLE: '0',
    CCRC_VERIFY_WINDOW: '0',
    CCRC_VERIFY_LOG_LINES: '5',
    CCRC_VERIFY_STOP_INTERVAL: '0',
  };
  return { home, env: ghContainedEnv(home, base) };
}

/** Refuse to spawn unless every tool resolves inside the fixture's bin. */
function assertContained(box: Box): void {
  const r = spawnSync(BASH, ['-c', `command -v ${CONTAINED.join(' ')}`],
    { env: box.env, encoding: 'utf8', timeout: 15_000 });
  const got = (r.stdout ?? '').split('\n').filter((l) => l !== '');
  const want = CONTAINED.map((n) => join(box.home, '.local', 'bin', n));
  if (JSON.stringify(got) !== JSON.stringify(want)) {
    throw new Error(`containment refused: expected every tool inside ${join(box.home, '.local', 'bin')}\n`
      + `want ${JSON.stringify(want)}\ngot  ${JSON.stringify(got)}`);
  }
}

interface Result { code: number; stdout: string; stderr: string }

/** `_upd_sweep` out of the sourced `ccd/ccrc`, on the Linux arm, contained. */
function sweep(box: Box): Result {
  assertContained(box);
  const r = spawnSync(BASH, ['-c',
    '. "$1"; CCD_OS=linux; UPD_BACKUP_DIR="$HOME/ccrc-backups/fixture"; _upd_sweep',
    'ccrc-under-test', CCRC_SRC],
  { env: box.env, encoding: 'utf8', timeout: 45_000 });
  return { code: r.status ?? -1, stdout: r.stdout ?? '', stderr: r.stderr ?? '' };
}

function calls(box: Box): string[] {
  const f = join(box.home, 'systemctl-calls');
  return existsSync(f) ? readFileSync(f, 'utf8').split('\n').filter((l) => l !== '') : [];
}

function poisonFiles(box: Box): string[] {
  return readdirSync(box.home).filter((n) => n.endsWith('-poison'));
}

/** The call log up to and including demo-good's second verification: the first 11 lines of every case. */
const FIRST_11 = [
  '--user list-units claude-session@* --plain --no-legend',
  `--user show -p KillMode ${DEMO_GOOD}`,
  `--user show -p KillMode ${DEMO_GONE}`,
  '--user show -p KillMode claude-session@ccrc-update-preflight.service',
  '--user try-restart claude-session@*',
  '--user list-units claude-session@* --state=failed --plain --no-legend',
  '--user list-units claude-session@* --state=active --plain --no-legend',
  `--user is-active ${DEMO_GOOD}`,
  `--user show -p MainPID --value ${DEMO_GOOD}`,
  `--user is-active ${DEMO_GOOD}`,
  `--user show -p MainPID --value ${DEMO_GOOD}`,
];

/** X2's exact log: demo-good verified, then demo-gone read active, MainPID, inactive, and re-read inactive by the classifier. */
const X2_LOG = [
  ...FIRST_11,
  `--user is-active ${DEMO_GONE}`,
  `--user show -p MainPID --value ${DEMO_GONE}`,
  `--user is-active ${DEMO_GONE}`,
  `--user is-active ${DEMO_GONE}`,
];

const STATUS_LINE = `--user status --no-pager --lines=0 ${DEMO_GONE}`;

const SWEEP_OK = 'update: sweep: every live claude-session@ supervisor now runs the ccd this update installed '
  + '(KillMode=process verified per unit before any restart; panes untouched)';
const GOOD_LINE = `verified: ${DEMO_GOOD} active, MainPID 4242 stable across 0s`;
const STAMPED_LINE = `stopped on purpose: ${DEMO_GONE} settled 'inactive', and ccd's stop stamp `
  + `~/.cc-sessions/demo-gone.stopped is present (reads '${STAMP}') — a deliberate stop, not a crash`;
const PURGED_LINE = `stopped on purpose: ${DEMO_GONE} settled 'inactive', and its registry row is purged `
  + '(no ~/.cc-sessions/demo-gone.uuid) — a deliberate stop, not a crash';

const stampedStop = (): Plant => ({
  goneActive: ['active', 'inactive', 'inactive'],
  goneMainPid: ['5151'],
  registry: { 'demo-good.uuid': 'u1\n', 'demo-gone.uuid': 'u2\n', 'demo-gone.stopped': `${STAMP}\n` },
});
const unstampedStop = (): Plant => ({
  goneActive: ['active', 'inactive', 'inactive'],
  goneMainPid: ['5151'],
  registry: { 'demo-good.uuid': 'u1\n', 'demo-gone.uuid': 'u2\n' },
});
const purgedBeforeLoop = (): Plant => ({
  goneActive: ['inactive', 'inactive'],
  goneMainPid: [],
  registry: { 'demo-good.uuid': 'u1\n', 'demo-gone.generation': '1\n' },
});

describe('the move INTO wave 10: main\'s _upd_sweep, sourced unedited, with the new verify-service.sh', () => {
  itLinux('X0 precondition: _upd_sweep is still the serial shape this case proves the move through', () => {
    const ccrc = readFileSync(CCRC_SRC, 'utf8');
    const m = /_upd_sweep\(\) \{([\s\S]*?)\n\}/.exec(ccrc);
    const hint = 'this case proves the move INTO wave 10 only while the sweep has this shape, '
      + 're-home it on a frozen copy of the pre-wave-11 sweep (Reading 2)';
    expect(m, `_upd_sweep() { … } not found: ${hint}`).not.toBeNull();
    const body = m![1]!;
    expect(body, hint).toContain('local verify="$BOX_TREE_DIR/deploy/verify-service.sh"');
    expect(body, hint).toContain('bash "$verify" "$u" \\');
    // The Linux arm's own quote, not the plan's shorter prefix (D-3950): the Darwin arm
    // carries that prefix too, so the short form could not go red when only this arm changes.
    expect(body, hint).toContain('|| _ccrc_die "$u was restarted and did not stay up — read: systemctl --user status $u.');
    expect(ccrc, hint).toContain('BOX_TREE_DIR="$HOME/ccrc"');
  }, 60_000);

  itLinux('X1 containment: every tool resolves inside the fixture bin, and the bus names sit under the fixture HOME', () => {
    const box = makeBox(stampedStop());
    assertContained(box);
    expect(box.env['XDG_RUNTIME_DIR']!.startsWith(box.home)).toBe(true);
    expect(box.env['DBUS_SESSION_BUS_ADDRESS']!.startsWith(`unix:path=${box.home}`)).toBe(true);
    expect(box.env['HOME']).toBe(box.home);
  }, 60_000);

  itLinux('X2 stamped stop caught in the window: the sweep returns 0', () => {
    const box = makeBox(stampedStop());
    const r = sweep(box);
    expect(r.code, `stdout:\n${r.stdout}\nstderr:\n${r.stderr}`).toBe(0);
    expect(r.stdout).toContain(GOOD_LINE);
    expect(r.stdout).toContain(STAMPED_LINE);
    expect(r.stdout).toContain(SWEEP_OK);
    expect(r.stderr).not.toContain('did not stay up');
    expect(r.stderr).not.toContain('DEPLOY FAILED');
    expect(calls(box)).toEqual(X2_LOG);
    expect(poisonFiles(box)).toEqual([]);
  }, 60_000);

  itLinux('X3 unstamped stop: dies as today (characterisation)', () => {
    const box = makeBox(unstampedStop());
    const r = sweep(box);
    expect(r.code, `stdout:\n${r.stdout}\nstderr:\n${r.stderr}`).toBe(1);
    expect(r.stderr).toContain(`ccrc: ${DEMO_GONE} was restarted and did not stay up — read: `
      + `systemctl --user status ${DEMO_GONE}. The pre-update backup is complete at ${box.home}/ccrc-backups/fixture`);
    expect(r.stderr).toContain(`DEPLOY FAILED — ${DEMO_GONE}`);
    expect(r.stdout).not.toContain('update: sweep: every live');
    expect(calls(box).at(-1)).toBe(STATUS_LINE);
    expect(poisonFiles(box)).toEqual([]);
  }, 60_000);

  itLinux('X3b unstamped stop under the new script: the exact call log, classifier re-read then status', () => {
    const box = makeBox(unstampedStop());
    sweep(box);
    expect(calls(box)).toEqual([...X2_LOG, STATUS_LINE]);
    expect(poisonFiles(box)).toEqual([]);
  }, 60_000);

  itLinux('X4 reclaimed and purged before the loop reaches it (v0.0.79\'s shape): returns 0', () => {
    const box = makeBox(purgedBeforeLoop());
    const r = sweep(box);
    expect(r.code, `stdout:\n${r.stdout}\nstderr:\n${r.stderr}`).toBe(0);
    expect(r.stdout).toContain(GOOD_LINE);
    expect(r.stdout).toContain(PURGED_LINE);
    expect(r.stdout).toContain(SWEEP_OK);
    expect(r.stderr).not.toContain('did not stay up');
    expect(calls(box)).toEqual([
      ...FIRST_11,
      `--user is-active ${DEMO_GONE}`,
      `--user is-active ${DEMO_GONE}`,
    ]);
    expect(poisonFiles(box)).toEqual([]);
  }, 60_000);
});

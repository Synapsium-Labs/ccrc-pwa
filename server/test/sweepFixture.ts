// sweepFixture.ts — the builders every `_upd_sweep` case runs on: a fixture HOME, a stub `systemctl` and
// `journalctl`, recording poisons for every other tool, and a spawn that sources `ccd/ccrc` (and, optionally, a
// frozen `_upd_sweep` over it) and calls the sweep (wave 11, R13 f, D-3982).
//
// Wave 10 wrote these builders inside `ccrc-sweep-deliberate-stop.test.ts`. Wave 11 moves them here, and extends
// them, because two files now run the sweep: the cross-version file (the FROZEN pre-wave-11 sweep, with this
// tree's script) and the window file (the tree's own sweep, shared verify window). A `.test.ts` cannot be imported
// by another one — importing it registers its cases a second time — so the shared half is a module of its own.
// Never a `.test.ts`.
//
// SAFETY, unchanged from wave 10 and wave 9. A fixture HOME only, and an env built from scratch (never
// `...process.env`). Every tool the sweep or the script could reach that is not a stub is a POISON that records to
// `$HOME/<name>-poison` and exits 97. `makeBox` plants the functional stubs and the poisons FIRST, then builds the
// env with `ccrcContainedEnv`, whose own poisons are create-if-absent, so the functional stubs win. `runSweep` calls
// `assertContained` before every spawn: the 12-name resolution AND wave 9's `assertNoRealTool` on the spawn's final
// env. Nothing here runs a real ccd, ccrc, systemctl, journalctl, tmux, gh or ssh, or reads a real registry.
import { spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkTmp } from './tmpHelpers.js';
import { harnessBin } from './ccdWsHelpers.js';
import { ccrcContainedEnv } from './ccrcContainment.js';
import { assertNoRealTool } from './containedTools.js';

const here = dirname(fileURLToPath(import.meta.url));
/** The repo root. */
export const REPO = resolve(here, '..', '..');

function realPath(name: string): string {
  const p = spawnSync('bash', ['-c', `command -v ${name}`], { encoding: 'utf8' }).stdout.trim();
  if (p === '') throw new Error(`this box has no ${name} — the fixture needs it`);
  return p;
}
/** bash, resolved ONCE from the parent's PATH (`ccrc-update.test.ts`'s idiom): never a bare `'bash'` under a narrowed PATH. */
export const BASH = realPath('bash');

/** The one name for the sourced `ccd/ccrc`: a case reads it and the spawn passes it as `$1`. */
export const CCRC_SRC = join(REPO, 'ccd', 'ccrc');
/** The script the fixture's `~/ccrc/deploy/verify-service.sh` is a copy of, unless a case names another. */
export const VERIFY_SRC = join(REPO, 'deploy', 'verify-service.sh');
/** The frozen pre-wave-11 `_upd_sweep` (v0.0.60 through v0.0.84), sourced after `ccd/ccrc` and redefining it. */
export const FROZEN_SWEEP = join(here, 'fixtures', 'upd-sweep-pre-wave11.bash');
/** S0, the verify script as wave 10 shipped it, byte for byte (its fixture file lands with the window file, Task 6). */
export const FROZEN_VERIFY_S0 = join(here, 'fixtures', 'verify-service-pre-wave10.sh');

/** What gets a poison planted by `makeBox`. `gh` is not here: `ghContainedEnv` plants it. */
export const POISONS: readonly string[] =
  ['tmux', 'ccd', 'launchctl', 'loginctl', 'systemd-run', 'ssh', 'scp', 'curl', 'npm'];
/** Every tool that must resolve INSIDE the fixture bin, spelled out on its own so that dropping a poison above is a
 *  red case, not a quiet shrinking of this list. */
export const CONTAINED: readonly string[] = [
  'systemctl', 'journalctl', 'tmux', 'ccd', 'launchctl', 'loginctl', 'systemd-run', 'ssh', 'scp', 'curl', 'npm', 'gh',
];

/** One planted unit. `active` and `mainPid` are answered one per call, the last repeating, across EVERY call of
 *  that unit (the first verify's and the re-check's alike). `loadState` answers `show -p LoadState --value`
 *  (default `loaded`; `''` prints nothing and exits 1). `listed`: `'active'` = in the pre-restart AND the
 *  `--state=active` listing (the default); `'crash:<word>'` = in the pre-restart listing as active, and in the
 *  `--state=activating,failed` listing as `<word>`; `'gone'` = in the pre-restart listing only. */
export interface UnitPlant {
  unit: string; active: string[]; mainPid: string[]; loadState?: string;
  listed?: 'active' | `crash:${string}` | 'gone';
}

/** A unit's Nth `is-active` call waits, polling every 0.1 s for at most `boundTenths`, until `until` holds; then it
 *  answers its planned word, or `failed` when `onTimeout` says so. `firstPids` counts units whose FIRST
 *  `show -p MainPID` has been made; `isActive` counts another unit's `is-active` calls. */
export interface Gate {
  unit: string; call: number;
  until: { firstPids: number } | { unit: string; isActive: number };
  boundTenths: number; onTimeout: 'answer' | 'failed';
}

export interface BoxOpts {
  units: UnitPlant[];
  /** Registry files to plant under `~/.cc-sessions/`. */
  registry?: Record<string, string>;
  /** The script copied to `~/ccrc/deploy/verify-service.sh` (default: this tree's). */
  verifySrc?: string;
  gates?: Gate[];
  /** The stub journalctl, for `unit`, waits (at most 50 tenths) until `systemctl-calls` holds `line`. */
  journalGate?: { unit: string; line: string };
  /** The `--state=activating,failed` listing exits this rc (and prints nothing) instead of answering. */
  crashListingRc?: number;
  /** `<home>/tmp` is a directory (default) or a regular file. */
  tmpdir?: 'dir' | 'file';
  /** Plants `<home>/.ccrc/update.json` as a report owned by `pid`. */
  report?: { pid: number; phase?: string };
}

export interface Box { home: string; env: NodeJS.ProcessEnv }

/** The stub `systemctl`, after `ccrc-update.test.ts`'s: it records `$*` before any shift, requires `--user`, shifts
 *  it off, and answers each verb the sweep and the script make from files the plant wrote under `$HOME/fx`. */
const SYSTEMCTL_STUB = [
  '#!/bin/sh',
  'printf \'%s\\n\' "$*" >> "$HOME/systemctl-calls"',
  'fx="$HOME/fx"',
  'orig="$*"',
  'bad() { echo "fixture systemctl: unexpected argv: $orig" >&2; exit 90; }',
  '[ "$1" = "--user" ] || bad',
  'shift',
  'bump() {   # $1 = counter file -> n = this call\'s number',
  '  n=0; [ -f "$1" ] && IFS= read -r n < "$1"',
  '  n=$((n + 1)); echo "$n" > "$1"',
  '}',
  'pick() {   # $1 = list file, $2 = call number -> that line, else the last',
  '  w=$(sed -n "${2}p" "$1")',
  '  [ -n "$w" ] || w=$(tail -n 1 "$1")',
  '  printf \'%s\\n\' "$w"',
  '}',
  'case "$1" in',
  '  list-units)',
  '    [ "$2" = "claude-session@*" ] || bad',
  '    state=""',
  '    for a in "$@"; do case "$a" in --state=*) state="${a#--state=}" ;; esac; done',
  '    case "$state" in',
  '      failed) exit 0 ;;',
  '      "") cat "$fx/list.all"; exit 0 ;;',
  '      active) cat "$fx/list.active"; exit 0 ;;',
  '      activating,failed)',
  '        if [ -f "$fx/crash.rc" ]; then IFS= read -r rc < "$fx/crash.rc"; exit "$rc"; fi',
  '        cat "$fx/list.crash"; exit 0 ;;',
  '    esac',
  '    bad ;;',
  '  show)',
  '    [ "$2" = "-p" ] || bad',
  '    case "$3" in',
  '      KillMode) echo "KillMode=process"; exit 0 ;;',
  '      MainPID)',
  '        [ "$4" = "--value" ] || bad',
  '        for u; do :; done',
  '        [ -f "$fx/$u.pid" ] || bad',
  '        if [ -f "$fx/p1.on" ] && ! grep -qxF "$u" "$fx/p1" 2>/dev/null; then printf \'%s\\n\' "$u" >> "$fx/p1"; fi',
  '        bump "$fx/$u.pid.n"; pick "$fx/$u.pid" "$n"; exit 0 ;;',
  '      LoadState)',
  '        [ "$4" = "--value" ] || bad',
  '        for u; do :; done',
  '        [ -f "$fx/$u.load" ] || bad',
  '        v=""; IFS= read -r v < "$fx/$u.load" || :',
  '        [ -n "$v" ] || exit 1',
  '        printf \'%s\\n\' "$v"; exit 0 ;;',
  '    esac',
  '    bad ;;',
  '  try-restart) exit 0 ;;',
  '  status) exit 0 ;;',
  '  is-active)',
  '    u="$2"',
  '    [ -f "$fx/$u.active" ] || bad',
  '    bump "$fx/$u.active.n"; call=$n',
  '    w=$(pick "$fx/$u.active" "$call")',
  '    if [ -f "$fx/$u.gates" ]; then',
  '      while read -r gcall kind ga gb bound ont; do',
  '        [ "$gcall" = "$call" ] || continue',
  '        i=0; held=0',
  '        while :; do',
  '          case "$kind" in',
  '            firstPids) c=0; [ -f "$fx/p1" ] && c=$(wc -l < "$fx/p1"); [ "$((c + 0))" -ge "$ga" ] && held=1 ;;',
  '            isActive) c=0; [ -f "$fx/$ga.active.n" ] && IFS= read -r c < "$fx/$ga.active.n"; [ "$((c + 0))" -ge "$gb" ] && held=1 ;;',
  '          esac',
  '          [ "$held" = 1 ] && break',
  '          [ "$i" -ge "$bound" ] && break',
  '          sleep 0.1; i=$((i + 1))',
  '        done',
  '        if [ "$held" != 1 ] && [ "$ont" = failed ]; then w=failed; fi',
  '      done < "$fx/$u.gates"',
  '    fi',
  '    echo "$w"; [ "$w" = active ] && exit 0; exit 3 ;;',
  'esac',
  'bad',
  '',
].join('\n');

/** The stub `journalctl`: records its argv, and for the unit a `journalGate` names waits (at most 50 tenths) until
 *  `systemctl-calls` holds the gate's line, then prints one line naming the unit. */
const JOURNALCTL_STUB = [
  '#!/bin/sh',
  'printf \'%s\\n\' "$*" >> "$HOME/journalctl-calls"',
  'u=""; prev=""',
  'for a in "$@"; do [ "$prev" = "-u" ] && u="$a"; prev="$a"; done',
  'if [ -f "$HOME/fx/journal-gate.unit" ]; then',
  '  IFS= read -r gu < "$HOME/fx/journal-gate.unit"',
  '  if [ "$gu" = "$u" ]; then',
  '    IFS= read -r gl < "$HOME/fx/journal-gate.line"',
  '    i=0',
  '    while [ "$i" -lt 50 ]; do',
  '      grep -qxF -- "$gl" "$HOME/systemctl-calls" 2>/dev/null && break',
  '      sleep 0.1; i=$((i + 1))',
  '    done',
  '  fi',
  'fi',
  'echo "fixture journal line for $u"',
  'exit 0',
  '',
].join('\n');

function poisonStub(name: string): string {
  return '#!/bin/sh\n'
    + `printf '%s\\n' "$*" >> "$HOME/${name}-poison"\n`
    + `echo "the ${name} poison: no case here may reach a real ${name}" >&2\nexit 97\n`;
}

/** Build the fixture box: HOME, the copied script, the stubs, the poisons, the env. */
export function makeBox(o: BoxOpts): Box {
  const home = mkTmp('ccrc-sweep-stop-');
  mkdirSync(join(home, 'ccrc', 'deploy'), { recursive: true });
  cpSync(o.verifySrc ?? VERIFY_SRC, join(home, 'ccrc', 'deploy', 'verify-service.sh'));
  const reg = join(home, '.cc-sessions');
  mkdirSync(reg, { recursive: true });
  for (const [name, body] of Object.entries(o.registry ?? {})) writeFileSync(join(reg, name), body);
  if ((o.tmpdir ?? 'dir') === 'file') writeFileSync(join(home, 'tmp'), 'not a directory\n');
  else mkdirSync(join(home, 'tmp'), { recursive: true });
  if (o.report !== undefined) {
    mkdirSync(join(home, '.ccrc'), { recursive: true });
    writeFileSync(join(home, '.ccrc', 'update.json'),
      JSON.stringify({
        target: 'v0.0.85', phase: o.report.phase ?? 'restarting', startedAt: 1, updatedAt: 1, detail: null,
        from: 'auto', pid: o.report.pid,
      }));
  }

  // What the stub answers, as files: per unit its answer lists and load state, and the three listings.
  const fx = join(home, 'fx');
  mkdirSync(fx, { recursive: true });
  const row = (u: string, word: string, sub: string): string => `${u} loaded ${word} ${sub} x`;
  const all: string[] = [];
  const active: string[] = [];
  const crash: string[] = [];
  for (const p of o.units) {
    all.push(row(p.unit, 'active', 'running'));
    const listed = p.listed ?? 'active';
    if (listed === 'active') active.push(row(p.unit, 'active', 'running'));
    else if (listed !== 'gone') {
      const word = listed.slice('crash:'.length);
      crash.push(row(p.unit, word, word === 'failed' ? 'failed' : 'auto-restart'));
    }
    if (p.active.length > 0) writeFileSync(join(fx, `${p.unit}.active`), p.active.join('\n') + '\n');
    if (p.mainPid.length > 0) writeFileSync(join(fx, `${p.unit}.pid`), p.mainPid.join('\n') + '\n');
    writeFileSync(join(fx, `${p.unit}.load`), `${p.loadState ?? 'loaded'}\n`);
  }
  const lines = (xs: string[]): string => (xs.length > 0 ? xs.join('\n') + '\n' : '');
  writeFileSync(join(fx, 'list.all'), lines(all));
  writeFileSync(join(fx, 'list.active'), lines(active));
  writeFileSync(join(fx, 'list.crash'), lines(crash));
  if (o.crashListingRc !== undefined) writeFileSync(join(fx, 'crash.rc'), `${o.crashListingRc}\n`);
  const byUnit = new Map<string, string[]>();
  for (const g of o.gates ?? []) {
    const cond = 'firstPids' in g.until
      ? `firstPids ${g.until.firstPids} -`
      : `isActive ${g.until.unit} ${g.until.isActive}`;
    if ('firstPids' in g.until) writeFileSync(join(fx, 'p1.on'), '');
    const l = byUnit.get(g.unit) ?? [];
    l.push(`${g.call} ${cond} ${g.boundTenths} ${g.onTimeout}`);
    byUnit.set(g.unit, l);
  }
  for (const [unit, l] of byUnit) writeFileSync(join(fx, `${unit}.gates`), l.join('\n') + '\n');
  if (o.journalGate !== undefined) {
    writeFileSync(join(fx, 'journal-gate.unit'), `${o.journalGate.unit}\n`);
    writeFileSync(join(fx, 'journal-gate.line'), `${o.journalGate.line}\n`);
  }

  // The stubs and the poisons go in FIRST: `ccrcContainedEnv`'s own poisons are create-if-absent, so these win.
  const bin = harnessBin(home);
  writeFileSync(join(bin, 'systemctl'), SYSTEMCTL_STUB, { mode: 0o755 });
  writeFileSync(join(bin, 'journalctl'), JOURNALCTL_STUB, { mode: 0o755 });
  for (const name of POISONS) writeFileSync(join(bin, name), poisonStub(name), { mode: 0o755 });

  const base: NodeJS.ProcessEnv = {
    HOME: home,
    PATH: process.env['PATH'] ?? '',
    LANG: 'C',
    TMPDIR: join(home, 'tmp'),
    CCRC_VERIFY_SETTLE: '0',
    CCRC_VERIFY_WINDOW: '0',
    CCRC_VERIFY_LOG_LINES: '5',
    CCRC_VERIFY_STOP_INTERVAL: '0',
  };
  return { home, env: ccrcContainedEnv(home, base, { managers: false, curl: 'poison' }) };
}

/** Refuse to spawn unless every tool resolves inside the fixture's bin, and the final env passes wave 9's checker
 *  (the user bus names set and under HOME; no contained tool resolving outside it). */
export function assertContained(box: Box): void {
  const r = spawnSync(BASH, ['-c', `command -v ${CONTAINED.join(' ')}`],
    { env: box.env, encoding: 'utf8', timeout: 15_000 });
  const got = (r.stdout ?? '').split('\n').filter((l) => l !== '');
  const want = CONTAINED.map((n) => join(box.home, '.local', 'bin', n));
  if (JSON.stringify(got) !== JSON.stringify(want)) {
    throw new Error(`containment refused: expected every tool inside ${join(box.home, '.local', 'bin')}\n`
      + `want ${JSON.stringify(want)}\ngot  ${JSON.stringify(got)}`);
  }
  assertNoRealTool(box.env, box.home);
}

export interface RunOpts {
  /** A file sourced after `ccd/ccrc`: the frozen `_upd_sweep`, which redefines the tree's. */
  frozen?: string;
  /** Shell text run after sourcing and before the sweep: shadows a function (W18). */
  pre?: string;
  env?: Record<string, string>;
  /** Run as the update's own sweep: `UPD_REPORTING=1` and the report variables for this pid. */
  reporting?: { pid: number };
  /** Shell text run after the sweep, before `exit $rc`. */
  tail?: string;
  timeout?: number;
  killSignal?: NodeJS.Signals;
}

/** `_upd_sweep` out of the sourced `ccd/ccrc` (and the frozen file over it, when named), on the Linux arm, contained. */
export function runSweep(box: Box, o: RunOpts = {}): { code: number; stdout: string; stderr: string } {
  assertContained(box);
  const reporting = o.reporting === undefined ? ''
    : `UPD_REPORTING=1; UPD_REPORT_PID=${o.reporting.pid}; UPD_REPORT_TARGET=v0.0.85; UPD_FROM=auto; UPD_REPORT_STARTED=1`;
  const script = [
    '. "$1"', '[ -z "$2" ] || . "$2"', o.pre ?? '', 'CCD_OS=linux',
    'UPD_BACKUP_DIR="$HOME/ccrc-backups/fixture"', reporting, '_upd_sweep', 'rc=$?', o.tail ?? '', 'exit $rc',
  ].filter((s) => s !== '').join('; ');
  const r = spawnSync(BASH, ['-c', script, 'ccrc-under-test', CCRC_SRC, o.frozen ?? ''], {
    env: { ...box.env, ...o.env }, encoding: 'utf8', timeout: o.timeout ?? 45_000,
    killSignal: o.killSignal ?? 'SIGTERM',
  });
  return { code: r.status ?? -1, stdout: r.stdout ?? '', stderr: r.stderr ?? '' };
}

/** Pids whose `/proc/<pid>/environ` holds `HOME=<box.home>` (Linux): the jobs a killed sweep left behind. */
export function survivors(box: Box): number[] {
  const want = `HOME=${box.home}`;
  const out: number[] = [];
  let names: string[];
  try { names = readdirSync('/proc'); } catch { return out; }
  for (const name of names) {
    if (!/^\d+$/.test(name)) continue;
    const pid = Number(name);
    if (pid === process.pid) continue;
    let env: string;
    try { env = readFileSync(`/proc/${pid}/environ`, 'latin1'); } catch { continue; }
    if (env.split('\0').includes(want)) out.push(pid);
  }
  return out;
}

function pause(ms: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

/** SIGKILL every survivor, then poll (bounded 5 s) until `survivors` is empty; throws if one is still there. */
export function reapSurvivors(box: Box): void {
  const deadline = Date.now() + 5_000;
  for (;;) {
    const left = survivors(box);
    if (left.length === 0) return;
    for (const pid of left) { try { process.kill(pid, 'SIGKILL'); } catch { /* already gone */ } }
    if (Date.now() >= deadline) throw new Error(`reapSurvivors: still alive after 5 s: ${left.join(' ')}`);
    pause(50);
  }
}

/** `<home>/systemctl-calls`, `$*` per line. */
export function calls(box: Box): string[] {
  const f = join(box.home, 'systemctl-calls');
  return existsSync(f) ? readFileSync(f, 'utf8').split('\n').filter((l) => l !== '') : [];
}

export function poisonFiles(box: Box): string[] {
  return readdirSync(box.home).filter((n) => n.endsWith('-poison'));
}

/** `<home>/.ccrc/update.json`, raw, or null when there is none. */
export function report(box: Box): string | null {
  const f = join(box.home, '.ccrc', 'update.json');
  return existsSync(f) ? readFileSync(f, 'utf8') : null;
}

/** The success line, byte for byte (`runbook-holds.test.ts` pins it too). */
export const SWEEP_OK = 'update: sweep: every live claude-session@ supervisor now runs the ccd this update installed '
  + '(KillMode=process verified per unit before any restart; panes untouched)';

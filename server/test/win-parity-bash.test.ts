// The Windows port's bash-layer parity (MSYS2, OSTYPE=cygwin, CCD_OS=linux). Claude Code, node and Windows git are
// native Win32 programs there: their pids are Windows pids MSYS `kill` does not know, an MSYS process they start reads
// PPid 1, MSYS2's `ps` has no `-o`, signals to them are TerminateProcess, and they read TEMP/TMP, never TMPDIR. Each
// block below is the Windows arm of one of those, red with the arm removed. The vitest process itself is a native
// node: its pid stands in for a live claude.exe. Fixture HOMEs only.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { spawnSyncGroup } from './spawnGroup.js';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { CCD, HARNESS_BASH, WIDE_PANE_IF_UP, boxed, makeCcdHarness, type CcdHarness } from './ccdWsHelpers.js';
import { CCRC_SRC, CHECKS_SRC, doctorEnv, healthy, installDoctorHooks, shq } from './ccrc-doctorFixture.js';
import { mkTmp, removeTmpFixturesEachTest } from './tmpHelpers.js';

removeTmpFixturesEachTest();
installDoctorHooks();

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const fwd = (p: string): string => p.split(path.sep).join('/');
const NOT_WIN = process.platform !== 'win32';
const MENU_CURSOR = String.fromCodePoint(0x276f);

let h: CcdHarness;
beforeEach(() => { h = makeCcdHarness('ccrc-win-parity-'); });
afterEach(() => { h.cleanup(); });

/** Runs `outer` in an MSYS bash, which then starts the native node, which starts an MSYS bash on `inner` with
 *  `innerArgs`: the inner bash's MSYS parent reads 1, as a shell under claude.exe does. */
function throughNative(outer: string, inner: string, innerArgs: string[], env: NodeJS.ProcessEnv = {}): string {
  const dir = mkTmp('ccrc-win-native-');
  const innerFile = fwd(path.join(dir, 'inner.sh'));
  fs.writeFileSync(innerFile, inner);
  const relay = 'const r = require("child_process").spawnSync(process.argv[1], process.argv.slice(2), { stdio: "inherit" }); process.exit(r.status ?? 1)';
  const outerFile = fwd(path.join(dir, 'outer.sh'));
  fs.writeFileSync(outerFile, `${outer}\n${shq(fwd(process.execPath))} -e ${shq(relay)} ${shq(HARNESS_BASH)} ${shq(innerFile)} ${innerArgs.map(shq).join(' ')}\n`);
  const r = spawnSyncGroup(HARNESS_BASH, [outerFile], { encoding: 'utf8', timeout: 60_000, env: { ...process.env, ...env } });
  return `${r.stdout ?? ''}${r.stderr ?? ''}`;
}

describe.skipIf(NOT_WIN)('A11: Claude Code\'s pid is a Windows pid (`_plat_alive`)', () => {
  const ask = (snippet: string): string => h.sh(`${snippet}; echo "rc=$?"`).trim().split('\n').at(-1)!;
  const record = (dir: string, pid: number, body: string): void => {
    fs.mkdirSync(path.join(dir, 'sessions'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'sessions', `${pid}.json`), body);
  };

  it('`_ci_rec_live` reads a live native pid with no procStart as live (`kill -0` alone, as Claude Code judges it)', () => {
    expect(ask(`_CI_REC='{"kind":"bg"}'; _ci_rec_live ${process.pid}`)).toBe('rc=0');
  });

  it('`_ci_rec_live` reads a pid no process holds as gone', () => {
    expect(ask('_CI_REC=""; _ci_rec_live 99999996')).toBe('rc=1');
  });

  it('`_ci_bg_scan` finds the background worker whose record names a live native pid', () => {
    const cfg = path.join(h.home, 'cfg');
    record(cfg, process.pid, '{"kind":"bg","sessionId":"sid-1","jobId":"job-1"}');
    expect(h.sh(`_ci_bg_scan '${fwd(cfg)}' sid-1 ""; echo "rc=$? p=$_CI_BGP j=$_CI_BGJ"`).trim()).toBe(`rc=0 p=${process.pid} j=job-1`);
  });

  it('`_ci_bg_follow` keeps following a live native worker (no miss counted)', () => {
    const cfg = path.join(h.home, 'cfg');
    record(cfg, process.pid, '{"kind":"bg","sessionId":"not-a-uuid","jobId":"job-1"}');
    expect(h.sh(`id=demo; _CI_BG[demo]="${process.pid} job-1"; _ci_bg_follow demo '${fwd(cfg)}'; echo "miss=\${_CI_BGMISS[demo]:-unset}"`).trim()).toBe('miss=0');
  });
});

describe.skipIf(NOT_WIN)('A12: an ancestry walk crosses a native parent (`_plat_lineage`)', () => {
  it('ccd `_am_ancestor`: the MSYS shell above node is an ancestor; a live sibling is not', () => {
    const out = throughNative('export OUTER=$$; sleep 30 & export NOTME=$!; trap \'kill $NOTME 2>/dev/null\' EXIT',
      'source "$1"; _am_ancestor "$OUTER"; echo "ancestor=$?"; _am_ancestor "$NOTME"; echo "sibling=$?"\n', [CCD]);
    expect(out).toContain('ancestor=0');
    expect(out).toContain('sibling=1');
  });

  it('ccrc-test `_tinside`: a run started under node inside a held slot knows it is inside', () => {
    const src = fs.readFileSync(path.join(REPO, 'ccd', 'ccrc-test'), 'utf8');
    const funcs = `${/^_tlocked\(\) \{.*$/m.exec(src)![0]}\n${/^_tinside\(\) \{[\s\S]*?\n\}\n/m.exec(src)![0]}`;
    const home = mkTmp('ccrc-win-tinside-');
    const slots = fwd(path.join(home, 'slots'));
    const out = throughNative(
      `mkdir -p '${slots}'; exec 9>'${slots}/slot-1'; flock 9; echo "pid $$ ccrc test" > '${slots}/slot-1.who'`,
      `source "$1"; eval "$TFUNCS"; SLOT_DIR='${slots}' PROC_ROOT=/nonexistent SLICE=ccrctests.slice; _tinside; echo "inside=$?"\n`,
      [fwd(CCRC_SRC)], { HOME: home, TFUNCS: funcs });
    expect(out).toContain('inside=0');
  });

  it('ccrc `_inst_legacy_verified_parent`: reads its parent\'s argv without ps -o', () => {
    const dir = mkTmp('ccrc-win-legacy-');
    fs.writeFileSync(path.join(dir, 'ccrc'), `bash -c 'source "$1"; _inst_legacy_verified_parent; echo "verified=$?"' _ ${shq(fwd(CCRC_SRC))}\n`);
    const r = spawnSyncGroup(HARNESS_BASH, ['-c', `bash ${shq(fwd(path.join(dir, 'ccrc')))} update`],
      { encoding: 'utf8', timeout: 60_000, env: { ...process.env, HOME: dir } });
    expect(`${r.stdout}${r.stderr}`).toContain('verified=0');
  });

  it('doctor\'s browser-mcp census SKIPs on Windows with a sentence, rather than passing on an empty table', () => {
    const home = healthy('ccrc-win-bmcp-');
    fs.mkdirSync(path.join(home, '.cc-sessions'), { recursive: true });
    const r = spawnSyncGroup(HARNESS_BASH, ['-c', `set -uo pipefail\n. ${shq(CCRC_SRC)}\n. ${shq(CHECKS_SRC)}\n_check_browser-mcp`],
      { env: doctorEnv(home), encoding: 'utf8', timeout: 60_000 });
    expect(r.stdout).toMatch(/^SKIP browser-mcp: this box cannot list its processes with their command lines \(Windows: /m);
    expect(r.status).toBe(3);
  });
});

describe.skipIf(NOT_WIN)('B12: a child\'s temp root reaches native programs as TEMP and TMP', () => {
  const TMUX = `sleep() { :; }; tmux() {
    echo "tmux $*" >> "$HOME/ccd-calls"
    ${WIDE_PANE_IF_UP}
    case "$1" in new-session) : > "$HOME/pane-up" ;; has-session) [[ -e "$HOME/pane-up" ]] ;; esac
  };`;
  it('`_spawn_start` exports the child root as TEMP and TMP, in Windows spelling, beside TMPDIR', () => {
    const id = 'demo-quiet-mesa';
    h.sh(`_reg_set ${id} wrapper claude; _reg_set ${id} workdir '${fwd(h.home)}'
          _reg_set ${id} uuid deadbeef-0000-4000-8000-000000000000; _reg_set ${id} child 7`);
    h.sh(`${TMUX} rm -f "$HOME/pane-up"; _spawn_start ${id} new 2>/dev/null; true`);
    const line = h.calls().find((c) => c.startsWith('tmux new-session'))!;
    const win = h.sh(`cygpath -m "$HOME/.cc-tmp/${id}"`).trim();
    expect(line).toMatch(/ TMPDIR='[^']*\/\.cc-tmp\/demo-quiet-mesa'/);
    expect(line.split(` TEMP='${win}'`).length - 1, line).toBe(1);
    expect(line.split(` TMP='${win}'`).length - 1, line).toBe(1);
  });
});

describe.skipIf(NOT_WIN)('B13: the live graceful stop types Claude Code\'s own quit first on Windows', () => {
  const TMUX = `tmux() { echo "tmux $*" >> "$HOME/ccd-calls";
    case "$1" in
      list-panes) case "$*" in *pane_active*) echo "1 200" ;; *) echo 4242 ;; esac ;;
      display-message) echo 0 ;;
      capture-pane) printf '%s\\n' "\${BOX-}" ;;
    esac; return 0; };`;
  const PANE = `mkdir -p "$HOME/fx"
    bash -c 'trap "echo TERM >> $HOME/fx/signals; exit 0" TERM; : > "$HOME/fx/ready"; while :; do sleep 0.05; done' >/dev/null 2>&1 </dev/null &
    p=$!; until [ -f "$HOME/fx/ready" ]; do sleep 0.02; done`;
  const stop = (site: string, box: string): { keys: string[]; signals: string[]; note: string } => {
    fs.writeFileSync(path.join(h.home, '.cc-sessions', 'graceful-stop-live'), '');
    h.sh(`${TMUX} ${PANE}; GRACEFUL_STOP_TERM_WAIT_S=1; PANE_SCOPE_WEDGED="" PANE_SCOPE_PID=$p; _graceful_stop_before demo ${site} read; wait $p 2>/dev/null; true`, { BOX: box });
    const read = (f: string): string[] => (fs.existsSync(f) ? fs.readFileSync(f, 'utf8').split('\n').filter(Boolean) : []);
    return {
      keys: read(path.join(h.home, 'ccd-calls')).filter((l) => l.includes('send-keys')),
      signals: read(path.join(h.home, 'fx', 'signals')),
      note: read(path.join(h.home, '.cc-sessions', 'swap.log')).filter((l) => l.includes('graceful-stop ')).at(-1) ?? '',
    };
  };

  it('an empty box gets /exit and Enter, and a process that stays is sent TERM after the grace', () => {
    const r = stop('swap', boxed(''));
    expect(r.keys.map((k) => k.replace(/-t \S+ /, ''))).toEqual(['tmux send-keys -l /exit', 'tmux send-keys Enter']);
    expect(r.signals).toEqual(['TERM']);
    expect(r.note).toMatch(/graceful-stop demo: site=swap mode=live alive=1000$/);
  });

  it('a dialog on screen (no box) is never typed into: TERM at once', () => {
    const r = stop('swap', `  What do you want to do?\n  ${MENU_CURSOR} 1. Stop and wait for limit to reset\n    2. Switch to usage credits`);
    expect(r.keys).toEqual([]);
    expect(r.signals).toEqual(['TERM']);
    expect(r.note).toMatch(/mode=live exited=\d+$/);
  });

  it('the limit rescue\'s site sends no key, even into an empty box (D-8123)', () => {
    const r = stop('limit-resume', boxed(''));
    expect(r.keys).toEqual([]);
    expect(r.signals).toEqual(['TERM']);
  });
});

describe.skipIf(NOT_WIN)('C1/C3: the OS word and the slice drop-in', () => {
  const ccrc = (home: string, snippet: string): { out: string; code: number } => {
    const r = spawnSyncGroup(HARNESS_BASH, ['-c', `set -uo pipefail\n. ${shq(CCRC_SRC)}\n. ${shq(CHECKS_SRC)}\n${snippet}`],
      { env: doctorEnv(home), encoding: 'utf8', timeout: 60_000 });
    return { out: `${r.stdout ?? ''}${r.stderr ?? ''}`, code: r.status ?? -1 };
  };

  it('doctor\'s macOS-only SKIPs say this box is windows, not linux', () => {
    const home = healthy('ccrc-win-osword-');
    expect(ccrc(home, '_check_filevault').out).toContain('SKIP filevault: FileVault is macOS\'s disk encryption; this box is windows\n');
    expect(ccrc(home, '_check_secrets-backup-excluded').out).toContain('this box is windows, whose provider-level backups');
  });

  it('the install\'s caps line and the caps file the server parses both say windows', () => {
    const home = healthy('ccrc-win-caps-');
    expect(ccrc(home, '_inst_caps').out).toMatch(/^install: caps: .* \(os windows; /m);
    expect(fs.readFileSync(path.join(home, '.ccrc', 'ccrc-caps'), 'utf8').split('\n')[0]).toBe('os windows');
  });

  it('`_inst_units` writes no slice drop-in on Windows (the backslash became a directory there)', () => {
    const home = healthy('ccrc-win-units-');
    const units = path.join(home, 'units');
    const r = ccrc(home, `BOX_TREE_DIR=${shq(fwd(REPO))} BOX_UNIT_DIR=${shq(fwd(units))} INST_ROLE=server; _inst_units`);
    expect(r.out).toMatch(/^install: units: /m);
    expect(fs.existsSync(path.join(units, 'ccrc.service'))).toBe(true);
    expect(fs.readdirSync(units).filter((n) => n.startsWith('app-claude'))).toEqual([]);
  });
});

describe.skipIf(NOT_WIN)('A13: a recycled Windows pid is another process (`_plat_pstart`, the record\'s `procStart`)', () => {
  // Claude Code on Windows records `procStart` as the process's creation FILETIME (100 ns ticks since 1601, UTC),
  // measured equal to `Process.StartTime.ToFileTimeUtc()`; read here independently of ccd.
  const started = (): string => {
    const ps = path.join(process.env.SystemRoot ?? 'C:\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
    const r = spawnSyncGroup(ps, ['-NoProfile', '-NonInteractive', '-Command',
      `[Diagnostics.Process]::GetProcessById(${process.pid}).StartTime.ToFileTimeUtc()`], { encoding: 'utf8', timeout: 30_000 });
    const t = (r.stdout ?? '').trim();
    expect(t).toMatch(/^[1-9][0-9]+$/);
    return t;
  };
  const ask = (snippet: string): string => h.sh(`${snippet}; echo "rc=$?"`).trim().split('\n').at(-1)!;
  const wrong = (t: string): string => (BigInt(t) - 10_000_000n).toString();   // a second earlier: another process

  it('`_ci_rec_live`: the right procStart reads live, a wrong one reads dead', () => {
    const t = started();
    expect(ask(`_CI_REC='{"procStart":"${t}"}'; _ci_rec_live ${process.pid}`)).toBe('rc=0');
    expect(ask(`_CI_REC='{"procStart":"${wrong(t)}"}'; _ci_rec_live ${process.pid}`)).toBe('rc=1');
  });

  it('`_ci_hold_live` (the held wait, no /proc start pinned): the right procStart reads live, a wrong one reads dead', () => {
    const t = started();
    expect(ask(`_ci_hold_live ${process.pid} "" ${t}`)).toBe('rc=0');
    expect(ask(`_ci_hold_live ${process.pid} "" ${wrong(t)}`)).toBe('rc=1');
  });

  it('`_ci_bg_scan` passes over a worker record whose pid now holds another process', () => {
    const cfg = path.join(h.home, 'cfg');
    fs.mkdirSync(path.join(cfg, 'sessions'), { recursive: true });
    fs.writeFileSync(path.join(cfg, 'sessions', `${process.pid}.json`),
      `{"kind":"bg","sessionId":"sid-1","jobId":"job-1","procStart":"${wrong(started())}"}`);
    expect(h.sh(`_ci_bg_scan '${fwd(cfg)}' sid-1 ""; echo "rc=$?"`).trim().split('\n').at(-1)).toBe('rc=1');
  });
});

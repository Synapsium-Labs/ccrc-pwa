// tickBudgetHarness.ts — the fixtures, the PATH shims and the parser behind the
// supervise tick's fork budget, `ccd-tick-budget.test.ts` (tick-diet spec §9 and
// goal 2, #387).
//
// IMPORTS ONLY `node:*` AND SPAWNS NOTHING, and both are load-bearing. Every
// process this measurement starts is started in `ccd-tick-budget.test.ts`, where
// `ccd-workspaces.test.ts`'s containment scan reads each bash spawn and asks
// that it name `ghContainedEnv(` with systemd and tmux containment. A helper
// named outside that scan's `ccd*.ts` pattern that spawned bash would be a ccd
// runner nothing checks. Nothing from `server/src` is imported either: the
// harness measures `ccd/ccd`, and nothing else.
//
// WHAT IS COUNTED, stated so a reader can check it (plan P8). The supervisor is
// one bash process. A tick costs what that process FORKS and what the forks
// EXEC:
//   forks   the distinct pids that took part in the tick, minus the
//           supervisor's own: every BASHPID on an xtrace line (a `$( )`, a
//           pipeline element, a subshell running a builtin), every shim's own
//           `$$`, and every shim's `$PPID`. xtrace alone undercounts twice
//           over. A simple external command run directly is traced by the
//           shell that forks it, so the child that execs it never prints a
//           line: the shim's `$$` closes that. And a `$( a | b )` forks a
//           subshell that runs nothing itself, so only its pipeline elements
//           trace: the shim's `$PPID` closes that whenever one element is an
//           external. RESIDUAL: a subshell that traces nothing and whose every
//           child is a builtin or a function stays invisible.
//   execs   the shim log's lines, one per external program the tick ran.
//   tmux    the tmux shim's lines. W4 asserts them; W1–W3 record them.
//   kprobe  the timeout shim's lines whose argv is `-k 1 1 printf …`:
//           `_plat_timeout`'s `-k` capability probe (D-4960).
//   date    the date shim's lines (D-4961).
// So the figure is a RATCHET, not a reproduction of the container replay's
// `strace -f` count (179 forks and 85 execs on an idle tick). `timeout`'s own
// child is outside it, because the shim execs its command instead of forking a
// watcher, and so is anything a real external forks for itself.
//
// WHERE A TICK BEGINS AND ENDS. The runner opens the xtrace O_APPEND, and every
// shim appends a one-line marker to the same file, so trace lines and execs land
// in one stream in the order they happened. The loop's own `local beat=0
// unknown_run=0 tick=…` line opens tick 1. Everything before it is the PRE-LOOP
// (the entry heartbeat, the pre-flight probe, `cmd_ensure`): it is window 0,
// printed and never held to the budget. Tick k ends where the loop's own `sleep`
// advanced the counter. The sleep shim advances `.tick-n` only when its parent
// is the supervisor itself, and says so with a `@tick` marker; a `sleep`
// anywhere else is an exec and advances nothing. The shim cannot see WHICH
// function of the supervisor forked it, so a helper's in-shell `sleep` (the
// route chain's keystroke pacing) would advance the counter too. `PS4` names
// the function on every traced line, and the parser refuses a `@tick` whose
// sleep was not traced in `cmd_supervise`, naming the function that ran it.
//
// THE HEARTBEAT IS CARVED OUT. The loop stamps `.supervised` when its beat, five
// seconds a tick plus the REAL seconds each tick spent, reaches 30. Four ticks
// give 20 of the 30, so the stamp lands inside the window only when the run's
// ticks spent 10 real seconds between them, which a loaded runner can do to the
// costlier fixtures (measured: 5 of the 10 in an unloaded macOS run of
// `hard-blocked`). The stamp is the amortised every-30-seconds cost that spec
// §6.7 lists on top of the per-tick figure, so a window holding one reports it as
// `heartbeat`, and what runs between the supervisor's `(( beat >= 30 ))` and its
// `beat=0` is kept out of that tick's count.
import fs from 'node:fs';
import path from 'node:path';

export type FixtureName =
  'idle-home' | 'busy' | 'narrow' | 'away-over-ceiling' | 'hard-blocked' | 'cooldown' | 'fable' | 'leaving'
  | 'fable-leaving';
export const FIXTURES: readonly FixtureName[] = [
  'idle-home', 'busy', 'narrow', 'away-over-ceiling', 'hard-blocked', 'cooldown', 'fable', 'leaving',
  'fable-leaving',
];

/** N: the tmux shim answers `has-session` live until the loop has slept N
 *  times, then `can't find session` — the loop's own `gone` exit. Ticks 2..N
 *  are asserted. Tick 1 carries every first-call cost, a memo's first miss
 *  among them, and is printed only. */
export const TICK_RUN_N = 4;

export interface TickCount {
  tick: number; forks: number; execs: number; tmux: number; kprobe: number; date: number;
  /** 1 when this window held the 30-second heartbeat stamp, which is counted
   *  apart from the tick (header). */
  heartbeat: number;
}

// ── the shims ───────────────────────────────────────────────────────────────

/** The externals the tick runs that are only COUNTED: each shim logs itself and
 *  execs the binary that PATH named before the shims went in front of it.
 *  Derived, not remembered: `unshimmedExternals` reds, naming the word, for any
 *  external the run traced that is in neither this list nor `ANSWERING_SHIMS`.
 *  `tr` and `wc` are the darwin pre-loop's (`cmd_supervise`'s start-limit
 *  block). */
export const PASSTHROUGH_SHIMS: readonly string[] = [
  'awk', 'cat', 'cut', 'grep', 'head', 'mv', 'python3', 'tail', 'tr', 'wc',
];
/** The shims that ANSWER instead of passing through (plan Task 1 Step 1).
 *  `date` passes through too: it supplies real time and only counts. */
export const ANSWERING_SHIMS: readonly string[] = ['tmux', 'timeout', 'date', 'sleep'];

const SHIM_DIR = '.tick-shims';
const SHIM_LOG = '.tick-shims.log';
const XTRACE = '.xtrace';
const TICK_N = '.tick-n';
const RUN_N = '.tick-run-n';
const MAIN_PID = '.tick-main';
const FX_DIR = '.tick-fx';

/** The runner's half of the protocol: the shell text that follows `source ccd`.
 *  It records the supervisor's pid for the sleep shim, opens the xtrace O_APPEND
 *  on a descriptor bash picks (`{xfd}`, at least 10: ccd itself uses 3, 4, 6, 7,
 *  8 and 9), and stubs only the pre-loop's `cmd_ensure` and `_svc_enable`, as
 *  `ccd-route-tick.test.ts`'s `runSupervise` does. `PS4` puts the pid and the
 *  running function (empty at top level) on every traced line, as `+<pid>:<fn>:
 *  `, and its `+` repeats once per subshell level; a function call adds none.
 *  Both expand in the shell, with no fork. */
export function supervisePrelude(): string {
  return `printf '%s' "$$" > "$HOME/${MAIN_PID}"; exec {xfd}>>"$HOME/${XTRACE}"; BASH_XTRACEFD=$xfd; `
    + `PS4='+\${BASHPID}:\${FUNCNAME[0]-}: '; set -x; cmd_ensure() { :; }; _svc_enable() { :; }; `;
}

/** `name` as `dirs` resolve it: the first executable regular file. What
 *  `command -v` answers for a file, without spawning a shell. */
function resolveOn(dirs: readonly string[], name: string): string | null {
  for (const d of dirs) {
    if (!d) continue;
    const p = path.join(d, name);
    try {
      if (!fs.statSync(p).isFile()) continue;
      fs.accessSync(p, fs.constants.X_OK);
      return p;
    } catch { /* not here */ }
  }
  return null;
}

/** What every shim starts with, in builtins only, so a shim adds no process of
 *  its own to what it counts: read the tick counter; log `<tick> <pid> <ppid>
 *  <name> <argv…>`, any newline in the argv written as `\n` so that one exec is
 *  one line; and append the marker to the xtrace stream. A marker begins with a
 *  newline: a long trace line can reach the file in more than one write, and a
 *  marker must still start a line of its own. */
const shimHead = (name: string): string => [
  '#!/bin/sh',
  `__t=; read -r __t < "$HOME/${TICK_N}" 2>/dev/null; [ -n "$__t" ] || __t=0`,
  '__a=$*; __o=; while :; do case $__a in *"',
  '"*) __o=$__o${__a%%"',
  '"*}\'\\n\'; __a=${__a#*"',
  '"};; *) __o=$__o$__a; break;; esac; done',
  `printf '%s %s %s ${name} %s\\n' "$__t" "$$" "$PPID" "$__o" >> "$HOME/${SHIM_LOG}"`,
  `printf '\\n+%s: @shim ${name}\\n' "$$" >> "$HOME/${XTRACE}"`,
].join('\n');

/** Print a fixture file with builtins only: a `cat` here would be a process the
 *  shim started and nothing counted. */
const shCat = (file: string): string =>
  `while IFS= read -r __l || [ -n "$__l" ]; do printf '%s\\n' "$__l"; done < "$HOME/${FX_DIR}/${file}"`;

const READ_RUN_N = `__n=; read -r __n < "$HOME/${RUN_N}" 2>/dev/null; [ -n "$__n" ] || __n=${TICK_RUN_N}`;
const TARGET = '__tgt=; __p=; for __x in "$@"; do [ "$__p" = -t ] && __tgt=$__x; __p=$__x; done';

/** The fake tmux. It answers from `$HOME/.tick-fx`: `list-panes` gives `1
 *  <width>` for a format holding `pane_active` and the pane pid for
 *  `#{pane_pid}`; `capture-pane` gives the pane, with or without `-e`;
 *  `display-message -p` gives the born epoch; anything else is rc 0 and no
 *  output. `has-session` is live until the loop has slept N times, then prints
 *  `can't find session: <name>` and returns 1: the documented `gone`. */
const FAKE_TMUX = `
${READ_RUN_N}
${TARGET}
__name=\${__tgt#=}; __name=\${__name%:}
case "$1" in
  has-session)
    if [ "$__t" -ge "$__n" ]; then echo "can't find session: $__name" >&2; exit 1; fi
    exit 0 ;;
  list-panes)
    case "$*" in
      *pane_active*) read -r __w < "$HOME/${FX_DIR}/width"; echo "1 $__w" ;;
      *pane_pid*) read -r __pid < "$HOME/${FX_DIR}/pid"; echo "$__pid" ;;
    esac
    exit 0 ;;
  capture-pane)
    case " $* " in *" -e "*) ${shCat('pane-e')} ;; *) ${shCat('pane')} ;; esac
    exit 0 ;;
  display-message)
    read -r __b < "$HOME/${FX_DIR}/born"; echo "$__b"; exit 0 ;;
esac
exit 0
`;

/** `timeout [-k N] [-s SIG] [--…] DURATION cmd…`: parsed, then the command is
 *  EXEC'd. No watcher and no deadline: a fixture cannot wedge. */
const TIMEOUT = `
while [ $# -gt 0 ]; do
  case "$1" in
    -k|-s) shift 2 ;;
    -k*|-s*|--kill-after=*|--signal=*|--foreground|--preserve-status|--verbose|-v) shift ;;
    --) shift; break ;;
    *) break ;;
  esac
done
[ $# -ge 2 ] || exit 125
shift
exec "$@"
`;

/** The loop's sleep advances the tick and costs no time; any other sleep is an
 *  exec and nothing more. "The loop's" means forked by the supervisor itself,
 *  which a helper's in-shell sleep also is: `windows` catches that one (header). */
const SLEEP = `
__m=; read -r __m < "$HOME/${MAIN_PID}" 2>/dev/null
if [ -n "$__m" ] && [ "$PPID" = "$__m" ]; then
  __t=$((__t + 1)); printf '%s\\n' "$__t" > "$HOME/${TICK_N}"
  printf '\\n+%s: @tick %s\\n' "$$" "$__t" >> "$HOME/${XTRACE}"
fi
exit 0
`;

export interface ShimOpts {
  /** Wrap the REAL tmux on a private socket instead of answering from the
   *  fixture files (plan Task 1 Step 6). `bin` is absolute. Once the loop has
   *  slept N times, the shim kills the session ON ITS OWN `-L` SOCKET before it
   *  passes `has-session` through, so the real server answers `can't find
   *  session`. The caller keeps a second session on that socket, or the
   *  server would exit with its last session and answer `no server running`,
   *  which is `unknown`, not `gone`. */
  realTmux?: { bin: string; sock: string };
}

/** Write every shim into `$HOME/.tick-shims` and return that directory, which
 *  the runner puts FIRST on PATH: ahead of `ghContainedEnv`'s bin, whose
 *  poisoned tmux the tmux shim must displace. A passthrough shim execs the
 *  binary that `<home>/.local/bin` (that same contained bin) and then the
 *  ambient PATH resolve, so a poisoned tool stays poisoned behind its shim. */
export function plantShims(home: string, opts: ShimOpts = {}): string {
  const dir = path.join(home, SHIM_DIR);
  fs.mkdirSync(dir, { recursive: true });
  const dirs = [path.join(home, '.local', 'bin'), ...(process.env['PATH'] ?? '').split(':')];
  const write = (name: string, body: string): void => {
    fs.writeFileSync(path.join(dir, name), `${shimHead(name)}\n${body}`, { mode: 0o755 });
  };
  for (const name of [...PASSTHROUGH_SHIMS, 'date']) {
    const real = resolveOn(dirs, name);
    if (real === null) throw new Error(`tick budget: no ${name} on PATH to shim`);
    write(name, `exec '${real}' "$@"\n`);
  }
  write('timeout', TIMEOUT);
  write('sleep', SLEEP);
  if (opts.realTmux) {
    const { bin, sock } = opts.realTmux;
    write('tmux', `
${READ_RUN_N}
unset TMUX TMUX_PANE TMUX_TMPDIR
if [ "$1" = has-session ] && [ "$__t" -ge "$__n" ]; then
  ${TARGET}
  '${bin}' -L '${sock}' -f /dev/null kill-session -t "$__tgt" 2>/dev/null
fi
exec '${bin}' -L '${sock}' -f /dev/null "$@"
`);
  } else {
    write('tmux', FAKE_TMUX);
  }
  fs.writeFileSync(path.join(home, TICK_N), '0\n');
  fs.writeFileSync(path.join(home, RUN_N), `${TICK_RUN_N}\n`);
  return dir;
}

// ── the fixtures ────────────────────────────────────────────────────────────

/** The harness roster's lanes (`DEFAULT_TEST_ROSTER`, read here as data, not
 *  imported: this module imports nothing but `node:*`). `HOME_LANE` is every
 *  fixture's home; the other three are what `_swap_target`'s candidate loop
 *  walks. `gpt` is not home-able and has no wrapper installed, so the loop never
 *  reaches it. */
const HOME_LANE = 'claude-a';
const OTHER_LANES = ['claude-b', 'claude-d', 'claude'] as const;
const CFG_SUFFIX: Readonly<Record<string, string>> = {
  claude: '.claude', 'claude-a': '.claude-a', 'claude-b': '.claude-b', 'claude-d': '.claude-d',
};

const RULE = '─'.repeat(60);
/** Claude Code's idle bottom: rule, the empty `❯` box, rule, then the
 *  statusline row at ctx 23%, under COMPACT_THRESHOLD, so the compactor
 *  declines on its own arithmetic every tick. */
const IDLE_BOTTOM = `${RULE}\n❯ \n${RULE}\n  👤 lane-a │ 🤖 Opus 5 · xhigh │ ▓ ctx ▁▁▁ 23% │ 💲 1.0\n`;
const SCREENS = {
  idle: `● Done.\n\n${IDLE_BOTTOM}`,
  busy: `✻ Working… (12s · esc to interrupt)\n\n${IDLE_BOTTOM}`,
  banner: `● Working on it.\n  ⎿  You've hit your limit · resets 11pm (UTC)\n\n${IDLE_BOTTOM}`,
} as const;

interface Shape {
  wrapper: string;
  screen: keyof typeof SCREENS;
  width: number;
  status: 'idle' | 'busy';
  cls: 'opus' | 'fable';
  /** Five-hour figures by lane; a lane not named here is at 10%. */
  five: Readonly<Partial<Record<string, number>>>;
  lastswapAgo?: number;
  sweep?: boolean;
  /** The sweep's Fable share by lane, as a fraction; a lane not named is at
   *  0.12, under FABLE_SHARE_CEILING_PCT. */
  share?: Readonly<Partial<Record<string, number>>>;
  /** `statusUpdatedAt`, seconds after the plant: a turn that has not been quiet
   *  for SWAP_CEIL_QUIET, however long the run takes. Default: ten minutes
   *  before the plant. */
  statusAt?: number;
}

const CEILING = 98;   // SWAP_CEILING
const SHAPES: Readonly<Record<FixtureName, Shape>> = {
  'idle-home': { wrapper: HOME_LANE, screen: 'idle', width: 200, status: 'idle', cls: 'opus', five: {} },
  busy: { wrapper: HOME_LANE, screen: 'busy', width: 200, status: 'busy', cls: 'opus', five: {} },
  narrow: { wrapper: HOME_LANE, screen: 'idle', width: 80, status: 'idle', cls: 'opus', five: {} },
  // Away, and home cannot take it back: `_swap_target` stays on the current lane.
  'away-over-ceiling': { wrapper: 'claude-b', screen: 'idle', width: 200, status: 'idle', cls: 'opus',
    five: { [HOME_LANE]: CEILING } },
  // A banner, and every lane at or over the ceiling: the rescue finds nowhere to
  // go. Tick 1 strands the row; ticks 2..N find it stranded.
  'hard-blocked': { wrapper: HOME_LANE, screen: 'banner', width: 200, status: 'idle', cls: 'opus',
    five: { [HOME_LANE]: 100, 'claude-b': CEILING, 'claude-d': CEILING, claude: CEILING } },
  cooldown: { wrapper: HOME_LANE, screen: 'idle', width: 200, status: 'idle', cls: 'opus', five: {},
    lastswapAgo: 60 },
  fable: { wrapper: HOME_LANE, screen: 'idle', width: 200, status: 'idle', cls: 'fable', five: {}, sweep: true },
  // Away, with the current lane AND home over the ceiling: `_swap_target`'s
  // candidate loop runs and names a lane with room. The session's last turn has
  // not been quiet for SWAP_CEIL_QUIET, so `_auto_swap_check` stands down before
  // it stamps `lastswap` — a dispatch would put tick 2 inside SWAP_COOLDOWN, and
  // the fixture would not be steady.
  leaving: { wrapper: 'claude-b', screen: 'idle', width: 200, status: 'idle', cls: 'opus',
    five: { [HOME_LANE]: CEILING, 'claude-b': CEILING }, statusAt: 3600 },
  // `fable` and `leaving` together, the shape that makes `_share_pct` repeat
  // inside ONE `_swap_target` call (tick-diet spec §7.2(b)). Away, every lane
  // under the five-hour ceiling, and home and the current lane over the Fable
  // share ceiling: home's stay gate reads home's share, the current lane's reads
  // its own, and the candidate loop reads home's AGAIN on its way to a lane with
  // room. Stood down by the same quiet turn as `leaving`.
  'fable-leaving': { wrapper: 'claude-b', screen: 'idle', width: 200, status: 'idle', cls: 'fable', five: {},
    sweep: true, share: { [HOME_LANE]: 0.5, 'claude-b': 0.5 }, statusAt: 3600 },
};

const PANE_PID = 4242;
const BORN = 1_700_000_000;
const UUID = '7e1c0a5e-0000-4000-8000-00000000d1e7';

export interface FixtureOpts {
  /** The pane's pid, when a REAL pane has one (the real-tmux variant). */
  panePid?: number;
}

/** Plant fixture `name` for session `id` under the harness HOME: registry rows,
 *  routes with nothing pending, every limits file fresh, the sessions JSON, the
 *  pane, and the sweep file. Every input the tick reads is fresh and decided,
 *  so ticks 2..N repeat exactly. */
export function plantFixture(home: string, id: string, name: FixtureName, opts: FixtureOpts = {}): void {
  const s = SHAPES[name];
  const now = Math.floor(Date.now() / 1000);
  const pid = opts.panePid ?? PANE_PID;
  const reg = path.join(home, '.cc-sessions');
  const limits = path.join(home, '.cc-limits');
  fs.mkdirSync(reg, { recursive: true });
  fs.mkdirSync(limits, { recursive: true });
  const put = (field: string, v: string): void => fs.writeFileSync(path.join(reg, `${id}.${field}`), v);
  put('wrapper', s.wrapper);
  put('home', HOME_LANE);
  put('uuid', UUID);
  put('project', 'tick');
  // Routes recorded AND applied: `_route_apply_check` walks the whole chain and
  // finds nothing pending.
  put('class', s.cls);
  put('effort', 'xhigh');
  put('routeapplied', `class=${s.cls} effort=xhigh`);
  // A NEGATIVE transcript verdict, stamped ahead of the plant so the arm's 30 s
  // cache (TRANSCRIPT_ARM_INTERVAL, D-2444) hits on every tick however slow the
  // run.
  put('tscan', `${now + 600} 0`);
  if (s.lastswapAgo !== undefined) put('lastswap', String(now - s.lastswapAgo));
  // Limits as the producers write them: the home lane's compact (`printf`), the
  // others `json.dump`-spaced. Resets in the future, so every figure counts.
  for (const lane of [HOME_LANE, ...OTHER_LANES]) {
    const five = s.five[lane] ?? 10;
    fs.writeFileSync(path.join(limits, `${lane}.json`), lane === HOME_LANE
      ? `{"five":${five},"seven":30,"ts":${now},"fiveResetAt":${now + 7200},"sevenResetAt":${now + 259200}}`
      : `{"five": ${five}, "seven": 30, "ts": ${now}, "fiveResetAt": ${now + 7200}, "sevenResetAt": ${now + 259200}}`);
  }
  // The live process's sessions JSON, under the CURRENT wrapper's config dir,
  // carrying the registry's uuid so `_sync_uuid` writes nothing.
  const sessions = path.join(home, CFG_SUFFIX[s.wrapper]!, 'sessions');
  fs.mkdirSync(sessions, { recursive: true });
  fs.writeFileSync(path.join(sessions, `${pid}.json`),
    `{"pid":${pid},"sessionId":"${UUID}","cwd":"/work/tick","startedAt":${BORN * 1000},`
    + `"status":"${s.status}","statusUpdatedAt":${(now + (s.statusAt ?? -600)) * 1000}}`);
  if (s.sweep) {
    const dir = path.join(reg, 'usage', 'sweep');
    fs.mkdirSync(dir, { recursive: true });
    const perAccount = Object.fromEntries([HOME_LANE, ...OTHER_LANES]
      .map((lane) => [lane, { fableShare: { estimate: s.share?.[lane] ?? 0.12 } }]));
    fs.writeFileSync(path.join(dir, 'latest.json'), JSON.stringify({
      finishedAt: new Date(now * 1000).toISOString().replace(/\.\d{3}Z$/, 'Z'), perAccount,
    }, null, 2));
  }
  const fx = path.join(home, FX_DIR);
  fs.mkdirSync(fx, { recursive: true });
  fs.writeFileSync(path.join(fx, 'width'), `${s.width}\n`);
  fs.writeFileSync(path.join(fx, 'pid'), `${pid}\n`);
  fs.writeFileSync(path.join(fx, 'born'), `${BORN}\n`);
  fs.writeFileSync(path.join(fx, 'pane'), SCREENS[s.screen]);
  fs.writeFileSync(path.join(fx, 'pane-e'), SCREENS[s.screen]);
}

/** The file a real pane `cat`s to show fixture `name`'s screen. */
export function fixtureScreenFile(home: string): string { return path.join(home, FX_DIR, 'pane'); }

// ── the parser ──────────────────────────────────────────────────────────────

type Ev =
  | { kind: 'trace'; pid: number; fn: string; text: string }
  | { kind: 'shim'; pid: number; name: string }
  | { kind: 'tick'; pid: number; n: number };
interface ShimRec { tick: number; pid: number; ppid: number; name: string; args: string }

function readEvents(home: string): Ev[] {
  const p = path.join(home, XTRACE);
  if (!fs.existsSync(p)) throw new Error('tick budget: the run wrote no xtrace');
  const out: Ev[] = [];
  for (const line of fs.readFileSync(p, 'utf8').split('\n')) {
    // A shim's marker is `+<pid>: @…`; a traced line is `+<pid>:<fn>: …`.
    const sm = /^\++(\d+): @shim (\S+)$/.exec(line);
    if (sm) { out.push({ kind: 'shim', pid: Number(sm[1]), name: sm[2]! }); continue; }
    const tm = /^\++(\d+): @tick (\d+)$/.exec(line);
    if (tm) { out.push({ kind: 'tick', pid: Number(tm[1]), n: Number(tm[2]) }); continue; }
    const m = /^\++(\d+):(\S*?): (.*)$/.exec(line);
    if (!m) continue;   // a continuation of a traced word that held a newline
    out.push({ kind: 'trace', pid: Number(m[1]), fn: m[2]!, text: m[3]! });
  }
  return out;
}

function readShimLog(home: string): ShimRec[] {
  const p = path.join(home, SHIM_LOG);
  if (!fs.existsSync(p)) return [];
  return fs.readFileSync(p, 'utf8').split('\n').filter(Boolean).map((l) => {
    const m = /^(\d+) (\d+) (\d+) (\S+) ?(.*)$/.exec(l);
    if (!m) throw new Error(`tick budget: a shim log line does not parse: ${JSON.stringify(l)}`);
    return { tick: Number(m[1]), pid: Number(m[2]), ppid: Number(m[3]), name: m[4]!, args: m[5]! };
  });
}

interface Window { evs: Ev[]; recs: ShimRec[]; beatEvs: Ev[]; beatRecs: ShimRec[] }

/** The function whose own `sleep` ends a tick: the loop. */
const LOOP_FN = 'cmd_supervise';
const LOOP_START = /^local beat=0 unknown_run=0 tick=/;
const BEAT_TEST = /^\(\(\s*beat >= [0-9A-Z_]+\s*\)\)$/;

/** The run, cut into windows: [0] the pre-loop, [k] tick k for k in 1..N, and
 *  a last one for what follows the last sleep (the final probe and the exit).
 *  Each shim marker is joined to its log line by pid, in order, and the log's
 *  tick field must agree with the window it landed in. */
function windows(home: string, mainPid: number): Window[] {
  const evs = readEvents(home);
  const isMain = (e: Ev, re: RegExp): boolean => e.kind === 'trace' && e.pid === mainPid && re.test(e.text);
  const start = evs.findIndex((e) => isMain(e, LOOP_START));
  if (start < 0) {
    throw new Error('tick budget: the supervisor never traced the loop\'s `local beat=0 unknown_run=0 tick=…` line: '
      + 'the run never reached the loop, or the loop changed shape and this anchor must follow it');
  }
  const cuts = [0, start];
  evs.forEach((e, i) => {
    if (e.kind !== 'tick' || i <= start) return;
    // The supervisor waits on the sleep it forked, so its last traced line
    // before the marker is that sleep.
    let j = i - 1;
    while (j >= 0 && !(evs[j]!.kind === 'trace' && evs[j]!.pid === mainPid)) j--;
    const s = evs[j];
    if (!s || s.kind !== 'trace' || s.fn !== LOOP_FN || !/^sleep( |$)/.test(s.text)) {
      const at = s?.kind === 'trace' ? `\`${s.text.slice(0, 80)}\`, in \`${s.fn || '(top level)'}\`` : 'missing';
      throw new Error(`tick budget: tick ${e.n} was ended by a sleep that is not the loop's own: the supervisor's `
        + `last traced line before it is ${at}. The sleep shim advances on any sleep the supervisor forks; a `
        + 'fixture reached a helper\'s in-shell sleep, so re-shape it or teach the shim that sleep');
    }
    cuts.push(i + 1);
  });
  cuts.push(evs.length);
  const byPid = new Map<number, ShimRec[]>();
  for (const r of readShimLog(home)) {
    const q = byPid.get(r.pid) ?? []; q.push(r); byPid.set(r.pid, q);
  }
  const out: Window[] = [];
  for (let w = 0; w + 1 < cuts.length; w++) {
    const slice = evs.slice(cuts[w]!, cuts[w + 1]!);
    // The heartbeat span: from the supervisor's `(( beat >= 30 ))` to its
    // `beat=0`, present only when the test was true.
    let b0 = -1; let b1 = -1;
    if (w > 0) {
      b0 = slice.findIndex((e) => isMain(e, BEAT_TEST));
      if (b0 >= 0) {
        const nextMain = slice.findIndex((e, i) => i > b0 && e.kind === 'trace' && e.pid === mainPid);
        b1 = nextMain >= 0 && !isMain(slice[nextMain]!, /^sleep /)
          ? slice.findIndex((e, i) => i > b0 && isMain(e, /^beat=0$/)) : -1;
      }
    }
    const win: Window = { evs: [], recs: [], beatEvs: [], beatRecs: [] };
    slice.forEach((e, i) => {
      const beat = b1 >= 0 && i > b0 && i <= b1;
      (beat ? win.beatEvs : win.evs).push(e);
      if (e.kind !== 'shim') return;
      const r = byPid.get(e.pid)?.shift();
      if (!r || r.name !== e.name) throw new Error(`tick budget: shim marker ${e.name}@${e.pid} has no log line`);
      // The pre-loop and tick 1 both run at counter 0; tick k at k-1.
      const want = w === 0 ? 0 : w - 1;
      if (r.tick !== want) {
        throw new Error(`tick budget: ${r.name}@${r.pid} logged counter ${r.tick} inside window ${w} (want ${want})`);
      }
      (beat ? win.beatRecs : win.recs).push(r);
    });
    out.push(win);
  }
  for (const [pid, q] of byPid) {
    if (q.length) throw new Error(`tick budget: ${q.length} shim log line(s) of pid ${pid} have no marker`);
  }
  return out;
}

const KPROBE = /^-k 1 1 printf( |$)/;

/** Per-window counts: [0] the pre-loop, then ticks 1..N. The tail after the
 *  last sleep is dropped. */
export function countTicks(home: string, mainPid: number): TickCount[] {
  const ws = windows(home, mainPid);
  return ws.slice(0, ws.length - 1).map(({ evs, recs, beatEvs }, tick) => {
    const pids = new Set<number>();
    for (const e of evs) pids.add(e.pid);
    for (const r of recs) { pids.add(r.pid); pids.add(r.ppid); }
    pids.delete(mainPid);
    return {
      tick,
      forks: pids.size,
      execs: recs.length,
      tmux: recs.filter((r) => r.name === 'tmux').length,
      kprobe: recs.filter((r) => r.name === 'timeout' && KPROBE.test(r.args)).length,
      date: recs.filter((r) => r.name === 'date').length,
      heartbeat: beatEvs.length > 0 ? 1 : 0,
    };
  });
}

/** How many times the LOOP slept: the `@tick` markers. */
export function loopSleeps(home: string): number {
  return readEvents(home).filter((e) => e.kind === 'tick').length;
}

/** Words xtrace prints at the head of a line that are syntax, not commands:
 *  `(( … ))`, a `for`/`select` header and a `case` head. */
const SYNTAX = new Set(['((', 'for', 'select', 'case']);
const ASSIGNMENT = /^[A-Za-z_][A-Za-z0-9_]*(\[[^\]]*\])?\+?=/;

/** The first `max` words of a traced line, quotes removed: xtrace single-quotes
 *  a word that needs it and writes an embedded quote as `'\''`. */
function traceWords(text: string, max: number): string[] {
  const out: string[] = [];
  let i = 0;
  while (out.length < max) {
    while (text[i] === ' ' || text[i] === '\t') i++;
    if (i >= text.length) break;
    let w = '';
    while (i < text.length && text[i] !== ' ' && text[i] !== '\t') {
      const c = text[i]!;
      if (c === "'") {
        const e = text.indexOf("'", i + 1);
        w += e < 0 ? text.slice(i + 1) : text.slice(i + 1, e);
        i = e < 0 ? text.length : e + 1;
      } else if (c === '\\' && i + 1 < text.length) {
        w += text[i + 1]; i += 2;
      } else {
        w += c; i++;
      }
    }
    out.push(w);
  }
  return out;
}

/** How a traced command word was reached. `command X` runs X skipping
 *  functions; `command -p X` runs X from a default PATH, past every shim, and
 *  bash hashes the path it found, so the name's later plain runs skip the shim
 *  too (measured, bash 5.3); `exec X` replaces the shell with the program X,
 *  whatever `type -t` says of the name. */
type Via = '' | 'command' | 'command -p' | 'exec';
interface Traced { word: string; via: Via }

/** A traced simple command's command word, or null for an assignment line
 *  (bash traces each prefix assignment on a line of its own, then the command)
 *  and for syntax. `command` and `exec` are builtins that run the NEXT word, so
 *  the word is that one. `command -v`/`-V` and a bare `exec` (redirections only)
 *  run nothing, and the word is the builtin's own. */
function traced(text: string): Traced | null {
  const ws = traceWords(text, 16);
  const first = ws[0];
  if (first === undefined || first === '' || ASSIGNMENT.test(first) || SYNTAX.has(first)) return null;
  let k = 0;
  let via = '' as Via;
  while (ws[k] === 'command' || ws[k] === 'exec') {
    const b = ws[k]!;
    let j = k + 1; let lookup = false; let dflt = false;
    for (; j < ws.length && /^-./.test(ws[j]!); j++) {
      const o = ws[j]!;
      if (o === '--') { j++; break; }
      if (b === 'command') { lookup ||= /[vV]/.test(o); dflt ||= o.includes('p'); continue; }
      if (o.includes('a')) j++;   // exec -a NAME
    }
    if (lookup || j >= ws.length) return { word: b, via };
    via = b === 'exec' || via === 'exec' ? 'exec' : dflt || via === 'command -p' ? 'command -p' : 'command';
    k = j;
  }
  return { word: ws[k]!, via };
}

/** Every distinct traced command, pre-loop and tail included. */
function tracedCommands(home: string): Traced[] {
  const out = new Map<string, Traced>();
  for (const e of readEvents(home)) {
    if (e.kind !== 'trace') continue;
    const t = traced(e.text);
    if (t !== null) out.set(`${t.via}\0${t.word}`, t);
  }
  return [...out.values()];
}

/** Every distinct command word the run traced, for the caller to classify in
 *  one shell. */
export function commandWords(home: string): string[] {
  return [...new Set(tracedCommands(home).map((t) => t.word))].sort();
}

/** Every traced command that ran an external program with no shim: the execs
 *  this count would miss. `typeOf` answers `type -t` from a shell that sourced
 *  ccd under the run's own PATH.
 *  - A word holding a slash ran by path, past every shim.
 *  - A word `command -p` ran came from a default PATH, past every shim too,
 *    unless it is a builtin.
 *  - A word `exec` ran is a program whatever its `type -t` says, so only a shim
 *    passes it.
 *  - A word `command` ran whose `type -t` is `function` is reported: `command`
 *    skips the function, and what ran in its place is unread.
 *  - A word `type -t` cannot classify is reported, with what it said. */
export function unshimmedExternals(home: string, typeOf: (word: string) => string): string[] {
  const shimmed = new Set([...PASSTHROUGH_SHIMS, ...ANSWERING_SHIMS]);
  const out: string[] = [];
  for (const { word: w, via } of tracedCommands(home)) {
    const label = via ? `${via} ${w}` : w;
    if (w.includes('/')) { out.push(label); continue; }
    const t = typeOf(w);
    if (via === 'command -p') {
      if (t !== 'builtin') out.push(`${label} (a default PATH, past every shim)`);
      continue;
    }
    if (via === 'exec') {
      if (shimmed.has(w)) continue;
      out.push(t === 'file' ? label : `${label} (type -t: ${t || 'nothing'}; \`exec\` runs a program)`);
      continue;
    }
    if (via === 'command' && t === 'function') {
      out.push(`${label} (type -t: function, which \`command\` skips)`);
      continue;
    }
    if (t === 'function' || t === 'builtin' || t === 'keyword') continue;
    if (t === 'file' && shimmed.has(w)) continue;
    out.push(t === 'file' ? label : `${label} (type -t: ${t || 'nothing'})`);
  }
  return out;
}

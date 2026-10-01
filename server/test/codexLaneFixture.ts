// codexLaneFixture.ts — the Codex-lane fixture (Plan 2b-2), shared by
// `ccrc-codex.test.ts` and the lifecycle and launcher suites after it. It
// imports nothing from vitest and registers no case, for `installTreeFixture.ts`'s
// reason: a module that registered cases would register them again in every
// file that imports it.
//
// CONTAINMENT, stated once for everything below:
//  - Every listener binds 127.0.0.1 on a port the KERNEL chose (`freePort`, or
//    a listener told port 0). No constant port appears in this file: the fleet
//    box's live Codex lanes hold fixed ports, and a fixture that bound one would
//    answer as a live lane.
//  - Direct children are tracked by the fixture HOME they serve, and
//    `killLaneProcesses` ends them through their current-run ChildProcess
//    handles — never by name or pattern. Node reaps a child only after it exits,
//    so a tracked child whose exit has not been seen still owns its pid.
//  - Product-started tiers are stopped through best-effort current-run cleanup
//    callbacks while their fixture state still exists. Reparented stand-ins use
//    a directly owned supervisor. Persisted PIDs are observations only. Normal
//    `afterEach` cleanup is best-effort in-run; a SIGKILLed Vitest can leave a
//    manual-cleanup orphan, never recovered by an ambient sweep in a later run.
//  - `plantSystemd` writes a functional fake `systemctl` and a recording
//    `systemd-run` into `<home>/.local/bin` — call it BEFORE
//    `ghContainedEnv(…, { systemd: true })`, whose poisons are
//    create-if-absent and would otherwise take those two names first.
//  - Listeners are PYTHON children, never a `node:http` server in this process:
//    the library under test runs under `spawnSync`, which blocks this process's
//    event loop, so an in-process server could never answer it
//    (`ccgptHarness.ts`'s `runPy` docstring measured that deadlock).
import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { createHash } from 'node:crypto';
import { connect, createServer } from 'node:net';
import fs from 'node:fs';
import path from 'node:path';
import { existsSync, readFileSync, renameSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { harnessBin, seedAccountsSh } from './ccdWsHelpers.js';
import { pythonOrSkip } from './ccgptHarness.js';
import { psArgs } from './laneReaper.js';
import { rosterFromJson } from '../../shared/roster-json.mjs';
import { renderLitellmConfig } from '../../shared/litellm.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(here, '..', '..');

// ── ports ────────────────────────────────────────────────────────────────

/** A port nothing was listening on a moment ago: listen on 0, read, close. A
 *  window remains between the close and whoever binds it next; a caller that
 *  needs the port HELD passes 0 to {@link spawnListener} instead. */
export function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = createServer();
    srv.once('error', reject);
    srv.listen(0, '127.0.0.1', () => {
      const addr = srv.address();
      if (addr === null || typeof addr === 'string') {
        srv.close();
        reject(new Error('freePort: the listener reported no port'));
        return;
      }
      srv.close(() => resolve(addr.port));
    });
  });
}

/** `n` DISTINCT free ports — the roster refuses two lanes sharing one, and two
 *  sequential `freePort()` calls may legitimately return the same number. */
export async function freePorts(n: number): Promise<number[]> {
  const out = new Set<number>();
  while (out.size < n) out.add(await freePort());
  return [...out];
}

// ── the roster ───────────────────────────────────────────────────────────

/** The fixture authDir for a lane — the path the roster's own remedy
 *  suggests (`shared/roster.ts`'s `parseAuthDir`), outside `~/.ccrc`. */
export const codexAuthDir = (id: string): string => `.local/share/ccrc/codex/${id}`;

export interface CodexLaneRow {
  id: string;
  proxyPort: number;
  litellmPort: number;
  /** Default `codex`. `none` exists so a suite can build a roster on which the
   *  telemetry-keyed `CCRC_CODEX_BACKEND` and `exec.kind` disagree. */
  telemetry?: 'codex' | 'none';
}

/** Writes `~/.ccrc/accounts.json` — the upstream `claude` row, one
 *  `exec.kind: "codex"` row per lane, then `extra` verbatim — and generates
 *  `~/.ccrc/accounts.sh` from it through the real generator. `rosterFromJson`
 *  (the validator `deploy/models-op.mjs` reads the roster through) runs
 *  before either file is written; `parseRoster` (inside `seedAccountsSh`)
 *  runs before `accounts.sh` is written. So a fixture either production
 *  reader would refuse throws here instead of testing nothing. Returns the
 *  roster object. */
export function codexRoster(
  home: string,
  lanes: readonly CodexLaneRow[],
  extra: readonly Record<string, unknown>[] = [],
): { version: 1; accounts: Record<string, unknown>[] } {
  const roster = {
    version: 1 as const,
    accounts: [
      {
        id: 'claude', label: 'claude', configDirSuffix: '.claude',
        exec: { kind: 'upstream' }, homeAble: true, telemetry: 'anthropic',
      },
      ...lanes.map((l) => ({
        id: l.id, label: l.id, configDirSuffix: `.claude-${l.id}`,
        exec: {
          kind: 'codex', provider: 'openai',
          proxyPort: l.proxyPort, litellmPort: l.litellmPort, authDir: codexAuthDir(l.id),
        },
        homeAble: false, telemetry: l.telemetry ?? 'codex',
      })),
      ...extra,
    ],
  };
  rosterFromJson(roster);
  fs.mkdirSync(path.join(home, '.ccrc'), { recursive: true });
  fs.writeFileSync(path.join(home, '.ccrc', 'accounts.json'), `${JSON.stringify(roster, null, 2)}\n`);
  seedAccountsSh(home, roster);
  return roster;
}

// ── what `_inst_bins` would have placed ──────────────────────────────────

/** The GPT lane's four executables, in the order `_inst_bins`' GPT-lane gate
 *  places them and its closing line names them (its `lane_bins=` literal in
 *  `ccd/ccrc`). ONE test-side spelling for the install and uninstall suites,
 *  which typed this list about ten times (final review F4); the product's own
 *  census is `install-census.test.ts`, which reads the gate itself.
 *  `ccrc-install.test.ts` pins this constant against that literal, so a
 *  fifth name, or a new order, reds there before any copy can drift. */
export const GPT_LANE_BINS = ['ccgpt-proxy.py', 'ccgpt-usage.py', 'ccgpt-runtime', 'ccrc-codex'] as const;

/** COPIES of `ccd/ccgpt-runtime` and `ccd/ccgpt-proxy.py` at
 *  `<home>/.local/bin`, 0755 — copies, not links, because a staleness case
 *  edits the placed shim and must never edit the repository's. */
export function plantCodexBins(home: string): { runtimeCli: string; shimFile: string } {
  const bin = harnessBin(home);
  const runtimeCli = path.join(bin, 'ccgpt-runtime');
  const shimFile = path.join(bin, 'ccgpt-proxy.py');
  for (const [src, dst] of [
    [path.join(REPO, 'ccd', 'ccgpt-runtime'), runtimeCli],
    [path.join(REPO, 'ccd', 'ccgpt-proxy.py'), shimFile],
  ] as const) {
    if (!fs.existsSync(src)) throw new Error(`plantCodexBins: ${src} does not exist`);
    fs.copyFileSync(src, dst);
    fs.chmodSync(dst, 0o755);
  }
  return { runtimeCli, shimFile };
}

// ── the runtime ──────────────────────────────────────────────────────────

export interface FakeRuntime {
  /** `~/.ccrc/runtime/codex` */
  root: string;
  /** the generation directory, absolute and resolved */
  gen: string;
  python: string;
  /** the generation's `.ccrc-runtime.json` */
  stamp: string;
}

/** A generation planted with `stamp: false`: the same layout with no stamp,
 *  so `stamp` is `null` — never a path to a file that is not there. */
export type UnstampedRuntime = Omit<FakeRuntime, 'stamp'> & { stamp: null };

export interface FakeRuntimeOptions {
  /** The litellm version the stamp records and the default interpreter's
   *  `importlib.metadata` arm prints. Default `1.101.0`. */
  version?: string;
  /** A custom interpreter BODY: the whole `bin/python` file, written verbatim
   *  in place of {@link fakePython}'s. The caller then owns every arm, and the
   *  real `check` accepts the runtime only if the body answers check's three
   *  `-I -c` reads the way the default one does. */
  python?: string;
  /** `false` plants no `.ccrc-runtime.json`: a generation that
   *  `ccgpt-runtime python` and `check` both answer `mutated` for. */
  stamp?: false;
  /** The generation directory's name. Default: a counter-built
   *  `gen-20260923T00MMSSZ-<pid>`, so a later call's generation sorts after an
   *  earlier one's. A name off the builder's shape throws. */
  generationName?: string;
}

let genSeq = 0;

/** The builder's generation-name shape (`GEN_RE` in `ccd/ccgpt-runtime`). It
 *  reads `current` as `absent` for any other name, so a fixture that planted
 *  one would test a runtime nobody can see. */
const GEN_NAME = /^gen-[0-9]{8}T[0-9]{6}Z-[0-9]+$/;

/** The stamp's `python` field: the SHAPE the builder's
 *  `"%d.%d.%d" % sys.version_info[:3]` writes. No reader compares the value —
 *  `check` reads `requirement`, `probeSha256` and `litellm` only. */
const STAMP_PYTHON = '3.12.3';

/** `json.dump(doc, f)` with Python's DEFAULT separators (`", "` and `": "`),
 *  then the one newline the builder writes after it: the stamp's exact bytes,
 *  for a document of printable-ASCII strings, where `JSON.stringify` and
 *  `json.dump`'s `ensure_ascii` escape alike. */
function pyJsonDump(doc: Record<string, string>): string {
  for (const [k, v] of Object.entries(doc)) {
    if (!/^[\x20-\x7e]*$/.test(v)) throw new Error(`pyJsonDump: ${k} is not printable ASCII`);
  }
  return `{${Object.entries(doc).map(([k, v]) => `${JSON.stringify(k)}: ${JSON.stringify(v)}`).join(', ')}}\n`;
}

const shq = (s: string): string => `'${s.replace(/'/g, `'\\''`)}'`;
const fakeProcs = (home: string): string => path.join(home, 'fake-procs');
const fakeLitellmPath = (home: string): string => path.join(fakeProcs(home), 'fake-litellm.py');

/** Task 5's two arms of the fake runtime interpreter. Both `exec` the REAL
 *  python3 with every argument ccrc passed, so the tier's command line is the
 *  one `_codex_pid_is_tier` reads:
 *  - `-I -m litellm.proxy.proxy_cli …` runs the stand-in LiteLLM below, and its
 *    command line keeps `--config <path>` as two words. ONLY the isolated form
 *    (ruling R45): a `-m` without `-I`, or a `-I -m` naming another module,
 *    falls through to Task 4's exit-96 refusal, a path this fixture does not
 *    model. The stand-in resolves no module, so ccrc-codex.test.ts' L23 asks
 *    the real python3 what `-I` buys;
 *  - `-I <…/ccgpt-proxy.py> …` runs the REAL shim, `--ccrc-lane=<id>` included,
 *    which is how a case proves that word is inert to it (ruling R6).
 *  `-B` because `-I` ignores PYTHONDONTWRITEBYTECODE (m-runtime-probe HR7). On a
 *  box with no python3 the arms refuse by name instead: Task 4's cases plant a
 *  runtime on any box, so this must never throw. */
function tierArms(home: string): string[] {
  const py = pythonOrSkip();
  if (py === null) {
    return [
      'case "${1:-}:${2:-}" in',
      '  -I:-m|-I:*/ccgpt-proxy.py)',
      '    echo "codexLaneFixture: no python3 on this box, so the fake runtime runs no tier" >&2; exit 96 ;;',
      'esac',
    ];
  }
  const fake = fakeLitellmPath(home);
  return [
    'case "${1:-}:${2:-}" in',
    '  -I:-m)',
    '    if [ "${3:-}" = litellm.proxy.proxy_cli ]; then',
    '      shift 3',
    `      exec ${shq(py)} -B ${shq(fake)} -m litellm.proxy.proxy_cli "$@"`,
    '    fi ;;',
    '  -I:*/ccgpt-proxy.py)',
    `    exec ${shq(py)} -B "$@" ;;`,
    'esac',
  ];
}

/** A stand-in for `python -m litellm.proxy.proxy_cli`. NOT litellm. It
 *  refuses a missing config the way the real one does, records ONCE, as facts,
 *  what reached its environment (the gateway key by SHAPE, never by value),
 *  and can be told to refuse at once or to wait before it binds — the second
 *  is a LiteLLM still importing, ruling R7's "ours, starting".
 *
 *  EXPORTED (ruling R29), with `spawnFakeLitellm` below, so every suite that
 *  needs a LiteLLM-shaped tier runs this one stand-in and never a second fake.
 *  `dir` is where it reads its two knobs and writes `litellm-<port>.json`.
 *  `<home>/fake-procs`, which `plantFakeRuntime` and `spawnFakeLitellm` pass,
 *  is the one directory `refuseLitellmStart`, `slowLitellmListen`,
 *  `litellmEvidence` and `killLaneProcesses` read. */
export const fakeLitellmSource = (dir: string): string => [
  '# fake LiteLLM proxy: codexLaneFixture.ts, Plan 2b-2 Task 5. NOT litellm.',
  'import http.server, json, os, re, sys, time',
  `DIR = ${JSON.stringify(dir)}`,
  'args = sys.argv[1:]',
  'def opt(name):',
  '    i = args.index(name) if name in args else -1',
  '    return args[i + 1] if 0 <= i < len(args) - 1 else None',
  'if os.path.exists(os.path.join(DIR, "refuse-litellm-start")):',
  '    sys.stderr.write("fixture litellm: refusing to start (the refuse-start knob)\\n")',
  '    sys.exit(1)',
  'config = opt("--config")',
  'if not config or not os.path.isfile(config):',
  '    sys.stderr.write("fixture litellm: --config names no file: %r\\n" % (config,))',
  '    sys.exit(1)',
  'port = int(opt("--port"))',
  'key = os.environ.get("LITELLM_MASTER_KEY", "")',
  'out = os.path.join(DIR, "litellm-%d.json" % port)',
  'with open(out + ".tmp", "w") as f:',
  '    json.dump({"argv": args, "pid": os.getpid(),',
  '               "masterKeyShaped": re.fullmatch(r"sk-[0-9a-f]{48}", key) is not None,',
  '               "tokenDir": os.environ.get("CHATGPT_TOKEN_DIR"),',
  '               "costMapLocal": os.environ.get("LITELLM_LOCAL_MODEL_COST_MAP"),',
  '               "home": os.environ.get("HOME")}, f)',
  'os.replace(out + ".tmp", out)',
  'delay = os.path.join(DIR, "litellm-listen-delay")',
  'if os.path.exists(delay):',
  '    with open(delay) as f:',
  '        time.sleep(float(f.read().strip() or "0"))',
  'class Handler(http.server.BaseHTTPRequestHandler):',
  '    def do_GET(self):',
  '        body = (json.dumps({"fake": "litellm", "port": port}) + "\\n").encode()',
  '        self.send_response(200)',
  '        self.send_header("Content-Type", "application/json")',
  '        self.send_header("Content-Length", str(len(body)))',
  '        self.end_headers()',
  '        self.wfile.write(body)',
  '    def log_message(self, *a):',
  '        pass',
  // TERM resistance is armed BEFORE the bind: callers treat an accepting port
  // as ready, so a TERM landing between bind and arming would end a tier that
  // is meant to resist it (L0c2's load flake).
  'resist = os.path.join(DIR, "litellm-resist-term")',
  'if os.path.exists(resist):',
  '    import signal',
  '    signal.signal(signal.SIGTERM, lambda *_: None)',
  'server = http.server.ThreadingHTTPServer((opt("--host") or "127.0.0.1", port), Handler)',
  'expire = os.path.join(DIR, "litellm-self-expiry")',
  'if os.path.exists(expire):',
  '    with open(expire) as f:',
  '        seconds = float(f.read().strip() or "0")',
  '    def stop_later():',
  '        time.sleep(seconds)',
  '        server.shutdown()',
  '    import threading',
  '    threading.Thread(target=stop_later, daemon=True).start()',
  'sys.stderr.write("fixture litellm: listening on %d\\n" % port)',
  'sys.stderr.flush()',
  'server.serve_forever()',
].join('\n') + '\n';

/** Writes the stand-in to `<home>/fake-procs/fake-litellm.py` and returns that
 *  path. The ONE writer of the file, for the runtime's tier arm and for
 *  `spawnFakeLitellm` alike. */
function writeFakeLitellm(home: string): string {
  fs.mkdirSync(fakeProcs(home), { recursive: true });
  const p = fakeLitellmPath(home);
  fs.writeFileSync(p, fakeLitellmSource(fakeProcs(home)));
  return p;
}

/** A FAKE runtime interpreter — bash, not python. It records every argv to
 *  `<gen>/python-calls`, answers the arms below, and refuses everything else
 *  with exit 96, so a code path this fixture never modelled reds instead of
 *  passing against a stub that said yes.
 *
 *  ARMS (Task 4): `ccgpt-runtime check`'s three questions, each `-I -c`.
 *  - `…importlib.metadata…` prints the version (the re-measure).
 *  - The stamp read (`json.load`) and the probe hash (`hashlib`, the probe on
 *    stdin) are EXECED on the box's real `python3`, because they are the
 *    builder's own behaviour, not fixture. With no `python3` they refuse by
 *    name (exit 96), and `check` then answers `mutated`. Nothing here throws
 *    for that, because a case that never runs `check` plants a runtime on any
 *    box.
 *  Every other `-I -c` program still exits 96. Task 5's two tier arms
 *  (`tierArms`, above) run before every arm here. */
function fakePython(version: string, home: string): string {
  if (!/^[0-9A-Za-z.+-]+$/.test(version)) throw new Error(`fakePython: unsafe version ${JSON.stringify(version)}`);
  const real = pythonOrSkip();
  if (real !== null && real.includes("'")) {
    throw new Error(`fakePython: the real python3 path cannot be single-quoted: ${JSON.stringify(real)}`);
  }
  return [
    '#!/usr/bin/env bash',
    '# codexLaneFixture: a FAKE runtime interpreter (see fakePython in codexLaneFixture.ts).',
    'printf \'%s\\n\' "$*" >> "${0%/bin/python}/python-calls"',
    ...tierArms(home),
    'if [ "${1:-}" = -I ] && [ "${2:-}" = -c ]; then',
    '  case "${3:-}" in',
    `    *importlib.metadata*) printf '%s\\n' '${version}'; exit 0 ;;`,
    real === null
      ? '    *json.load*|*hashlib*) echo "codexLaneFixture: the fake runtime python hands the stamp read and the probe hash to a real python3, and this box has none" >&2; exit 96 ;;'
      : `    *json.load*|*hashlib*) exec '${real}' "$@" ;;`,
    '  esac',
    'fi',
    'echo "codexLaneFixture: the fake runtime python has no arm for: $*" >&2',
    'exit 96',
    '',
  ].join('\n');
}

/** A built-looking generation at `~/.ccrc/runtime/codex/<name>/`:
 *  `bin/python` (the fake above, or `opts.python`), a stamp, and `current`
 *  swapped to it as a RELATIVE symlink, the shape the builder writes. It is the
 *  test tree's ONE writer of that layout: a suite that needs a runtime plants
 *  it here, and no suite hand-writes a generation.
 *
 *  The stamp's `requirement` and `probeSha256` are DERIVED from the shipped
 *  `ccd/ccgpt-runtime` (its `LITELLM_REQUIREMENT=` line, and the sha256 of what
 *  its `probe-source` prints), never typed here, and the stamp is written in
 *  the builder's own bytes (`pyJsonDump`, its key order, its `python` and
 *  `canary` shapes). So a builder change cannot leave this fixture planting a
 *  runtime the real `check` refuses while every lane case goes on passing. A
 *  second call with the default name plants a NEWER generation and swaps
 *  `current`. */
export function plantFakeRuntime(home: string, opts: FakeRuntimeOptions & { stamp: false }): UnstampedRuntime;
export function plantFakeRuntime(home: string, opts?: FakeRuntimeOptions): FakeRuntime;
export function plantFakeRuntime(home: string, opts: FakeRuntimeOptions = {}): FakeRuntime | UnstampedRuntime {
  const version = opts.version ?? '1.101.0';
  const cli = path.join(REPO, 'ccd', 'ccgpt-runtime');
  if (!fs.existsSync(cli)) {
    throw new Error(`plantFakeRuntime: ${cli} does not exist — the stamp is derived from it`);
  }
  let name: string;
  if (opts.generationName !== undefined) {
    if (!GEN_NAME.test(opts.generationName)) {
      throw new Error(`plantFakeRuntime: generationName ${JSON.stringify(opts.generationName)} is not the builder's `
        + 'gen-<YYYYmmddTHHMMSSZ>-<pid> shape, so ccgpt-runtime would read current as absent');
    }
    name = opts.generationName;
  } else {
    // HHMMSS counts the calls, so a later generation always sorts after an
    // earlier one, as the builder's own UTC names do.
    const mm = String(Math.floor(genSeq / 60) % 60).padStart(2, '0');
    const ss = String(genSeq % 60).padStart(2, '0');
    name = `gen-20260923T00${mm}${ss}Z-${process.pid}`;
    genSeq += 1;
  }

  const root = path.join(home, '.ccrc', 'runtime', 'codex');
  const gen = path.join(root, name);
  const python = path.join(gen, 'bin', 'python');
  fs.mkdirSync(path.dirname(python), { recursive: true });
  fs.writeFileSync(python, opts.python ?? fakePython(version, home), { mode: 0o755 });
  writeFakeLitellm(home);
  const stamp = path.join(gen, '.ccrc-runtime.json');
  if (opts.stamp === false) {
    fs.rmSync(stamp, { force: true });
  } else {
    const requirement = /^LITELLM_REQUIREMENT='([^']+)'$/m.exec(fs.readFileSync(cli, 'utf8'))?.[1];
    if (requirement === undefined) throw new Error('plantFakeRuntime: ccd/ccgpt-runtime declares no LITELLM_REQUIREMENT line');
    const probe = spawnSync('bash', [cli, 'probe-source'], {
      env: { PATH: process.env['PATH'] ?? '/usr/bin:/bin', HOME: home }, cwd: home,
    });
    if (probe.status !== 0) throw new Error(`plantFakeRuntime: ccgpt-runtime probe-source exited ${probe.status}`);
    const probeSha256 = createHash('sha256').update(probe.stdout).digest('hex');
    // The builder's key order, and its canary word for a raw shape that does
    // not leak a system role.
    fs.writeFileSync(stamp, pyJsonDump({
      requirement, probeSha256, litellm: version, python: STAMP_PYTHON,
      canary: 'raw-shape-leaks-system-role=no', builtAt: '2026-09-23T00:00:00Z',
    }));
  }
  const current = path.join(root, 'current');
  fs.rmSync(current, { force: true });
  fs.symlinkSync(name, current);
  return opts.stamp === false ? { root, gen, python, stamp: null } : { root, gen, python, stamp };
}

// ── the user manager ─────────────────────────────────────────────────────

// ── Plan 2b-2 Task 5: a manager that RUNS things ──────────────────────────
// Task 4's fakes answer questions. These also run processes, because Task 5's
// claim is "two lanes start, run and stop independently", which is about
// processes and ports. A systemd-run that only logs its argv would let a start
// that spawned nothing, or spawned the wrong lane's shim, report green.
//
//   systemd-run  records its argv (one line to $HOME/systemd-run-calls, and one
//                NUL-separated file per call under fake-systemd/run-argv/), then
//                RUNS the command after `--` as a detached child with a SERVICE
//                MANAGER'S environment: `env -i`, plus PATH, the --setenv pairs,
//                then the EnvironmentFile's lines, never the caller's
//                environment. The file comes AFTER the pairs, so a name in both
//                takes the file's value, as systemd's EnvironmentFile= overrides
//                Environment= (ruling PF-41; `_svc_run_supervised`'s nohup arm
//                sources its file after its pairs for the same reason).
//                The launcher writes `starting`, pid 0 and `spawned` BEFORE it
//                backgrounds a detached per-unit Python supervisor; from then
//                on only that supervisor writes the unit's state and pid. It
//                retains the tier as its exact `subprocess.Popen` child and owns
//                its TERM/wait/KILL/wait protocol: it writes `active` and the pid
//                once the child exists, and `inactive`, pid 0 and completion only
//                after the exact wait. Its evidence writes are best-effort; its
//                control of the child never depends on them. A stop request, a
//                vanished unit directory (a fixture HOME deleted under a live
//                unit), a TERM/HUP/INT to the supervisor, or its expiry all take
//                the same stop path. It honours no Restart=, no slice and no
//                start limit: those are asserted on the argv, the only honest
//                instrument (m-platform §3.4).
//   systemctl    requests a named live unit stop through its validated unit
//                directory and awaits the supervisor completion file. It has no
//                numeric-PID signal authority. A `fakeUnit` seeded without a
//                supervisor is simply made inactive, never signalled.
/** The marker line every user-manager STAND-IN a codex suite plants carries:
 *  Task 4's fake `systemctl` and `systemd-run` below, and a suite's own
 *  poison or pass-through probe of those two names. {@link
 *  assertManagerStandIns} reads it (final review E1). Exported, unlike the
 *  spine's and the isolation wall's marks, because those suites write their
 *  poisons in their own files; a symlink to the box's real binary, or a copy
 *  of it, can never carry it. */
export const MANAGER_STANDIN_MARK = '# ccrc-manager-standin (Plan 2b-2 final review F4)';

const FAKE_SYSTEMCTL = `#!/usr/bin/env bash
${MANAGER_STANDIN_MARK}
# codexLaneFixture: a FAKE user manager. Records every argv to
# $HOME/systemctl-calls and answers ONLY from $HOME/fake-systemd; every verb it
# does not model is refused (exit 90), so a new call reds instead of passing.
printf '%s\\n' "$*" >> "$HOME/systemctl-calls"
d="$HOME/fake-systemd"
up() { [ -f "$d/user-manager" ] && [ "$(<"$d/user-manager")" = up ]; }
# A spawned unit's state is written by its retained Python supervisor. This
# reader has no PID-liveness or signal path: pid files are observations only.
valid_unit() {
  [[ "\${1:-}" =~ ^[A-Za-z0-9@._:-]+$ ]] && [ "$1" != . ] && [ "$1" != .. ]
}
state() {
  local name="\${1:-}" u st=''
  valid_unit "$name" || { printf inactive; return; }
  u="$d/units/$name"
  [ -f "$u/state" ] && st="$(<"$u/state")"
  printf '%s' "\${st:-inactive}"
}
[ "\${1:-}" = --user ] || { echo "fake systemctl: only --user is modelled: $*" >&2; exit 90; }
shift
case "\${1:-}" in
  show-environment)
    up || { echo "Failed to connect to bus: No medium found" >&2; exit 1; }
    printf 'HOME=%s\\n' "$HOME"; exit 0 ;;
  is-active)
    up || exit 1
    st="$(state "\${2:-}")"
    printf '%s\\n' "$st"
    [ "$st" = active ]; exit $? ;;
  show)
    up || exit 1
    if [ "\${2:-}" = -p ] && [ "\${3:-}" = MainPID ] && [ "\${4:-}" = --value ] && [ -n "\${5:-}" ]; then
      p=''; [ -f "$d/units/$5/pid" ] && p="$(<"$d/units/$5/pid")"
      [ -f "$d/units/$5/spawned" ] && [ "$(state "$5")" != active ] && p=0
      printf '%s\\n' "\${p:-0}"; exit 0
    fi ;;
  stop)
    up || exit 1
    shift
    [ $# -gt 0 ] || { echo "fake systemctl: stop needs a unit" >&2; exit 90; }
    rc=0
    for u in "$@"; do
      valid_unit "$u" || { echo "fake systemctl: unsafe unit name: $u" >&2; rc=90; continue; }
      unit="$d/units/$u"
      if [ -f "$unit/stop-fail" ]; then echo "Job for $u failed: this fixture refuses the stop" >&2; rc=1; continue; fi
      if [ ! -d "$unit" ]; then echo "Failed to stop $u: Unit $u not loaded." >&2; rc=5; continue; fi
      # Once systemd-run has marked the unit spawned, it is manager-owned even
      # while its detached supervisor is still starting. Request through that
      # channel now; never reclassify a slow-starting manager unit as a seed.
      if [ -f "$unit/spawned" ]; then
        if [ "$(state "$u")" != inactive ]; then
          rm -f "$unit/stop-complete"
          : > "$unit/stop-request"
          n=0
          while [ ! -f "$unit/stop-complete" ] && [ "$n" -lt 100 ]; do sleep 0.1; n=$((n + 1)); done
          if [ ! -f "$unit/stop-complete" ]; then
            echo "Job for $u failed: this fixture supervisor did not complete the stop" >&2
            rc=1
          fi
        fi
      else
        # A seeded fakeUnit has no exact-child supervisor. It becomes inactive
        # without treating its observed PID as signal authority.
        printf 'inactive\\n' > "$unit/state"
        printf '0\\n' > "$unit/pid"
      fi
    done
    exit "$rc" ;;
  reset-failed)
    up || exit 1; exit 0 ;;
esac
echo "fake systemctl: no fixture arm for: --user $*" >&2
exit 90
`;

/** Task 5's `systemd-run`: RECORD AND RUN, into this file's one state layout
 *  (`fake-systemd/units/<unit>/{state,pid,spawned}`, which `FAKE_SYSTEMCTL`
 *  reads), never the real manager. ONE live unit per name: a second start of
 *  a live name is refused, as the real manager refuses it, and that is what
 *  a start that adopts nothing trips over.
 *
 *  Task 4's `refuse-spawn` arm (`plantSystemd`'s `refuseSpawn` knob) stays
 *  FIRST after the record, exactly as Task 4 wrote it: a manager that is up
 *  and refuses every start, and runs nothing. */
const FAKE_SYSTEMD_RUN = `#!/usr/bin/env bash
${MANAGER_STANDIN_MARK}
# codexLaneFixture: systemd-run, RECORD AND RUN (Plan 2b-2 Task 5).
printf '%s\\n' "$*" >> "$HOME/systemd-run-calls"
d="$HOME/fake-systemd"
n=0; [ -f "$d/run-count" ] && n="$(<"$d/run-count")"
n=$((n + 1)); printf '%s\\n' "$n" > "$d/run-count"
mkdir -p "$d/run-argv"; printf '%s\\0' "$@" > "$d/run-argv/$n"
if [ -f "$HOME/fake-systemd/refuse-spawn" ]; then
  echo "Failed to start transient service unit: this fixture's manager refuses every start (plantSystemd's refuseSpawn)" >&2
  exit 1
fi
{ [ -f "$d/user-manager" ] && [ "$(<"$d/user-manager")" = up ]; } \\
  || { echo "Failed to connect to bus: No medium found" >&2; exit 1; }
unit=''; out=''; err=''; envfile=''; wd="$HOME"; envs=()
while [ $# -gt 0 ]; do
  case "$1" in
    --user|--collect|--quiet) ;;
    --unit=*) unit="\${1#--unit=}" ;;
    --slice=*) ;;
    --working-directory=*) wd="\${1#--working-directory=}" ;;
    --setenv=*) envs+=("\${1#--setenv=}") ;;
    --setenv) shift; [ -n "\${1:-}" ] || { echo "fake systemd-run: --setenv needs NAME=value" >&2; exit 90; }; envs+=("$1") ;;
    -p)
      shift
      case "\${1:-}" in
        StandardOutput=append:*) out="\${1#StandardOutput=append:}" ;;
        StandardError=append:*) err="\${1#StandardError=append:}" ;;
        EnvironmentFile=*) envfile="\${1#EnvironmentFile=}"; envfile="\${envfile#-}" ;;
        Restart=*|RestartSec=*|StartLimitIntervalSec=*|StartLimitBurst=*) ;;
        *) echo "fake systemd-run: no fixture arm for property: \${1:-}" >&2; exit 90 ;;
      esac ;;
    --) shift; break ;;
    *) echo "fake systemd-run: no fixture arm for: $1" >&2; exit 90 ;;
  esac
  shift
done
[ -n "$unit" ] && [ $# -gt 0 ] || { echo "fake systemd-run: needs --unit= and a command" >&2; exit 90; }
[[ "$unit" =~ ^[A-Za-z0-9@._:-]+$ ]] || { echo "fake systemd-run: unsafe unit name: $unit" >&2; exit 90; }
u="$d/units/$unit"
st=''; [ -f "$u/state" ] && st="$(<"$u/state")"
if [ "$st" = active ] || [ "$st" = starting ]; then
  echo "Failed to start transient service unit: Unit $unit already exists." >&2; exit 1
fi
fenv=()
if [ -n "$envfile" ]; then
  [ -r "$envfile" ] || { echo "Job for $unit failed: EnvironmentFile $envfile is unreadable" >&2; exit 1; }
  while IFS= read -r l || [ -n "$l" ]; do
    case "$l" in ''|'#'*) ;; *=*) fenv+=("$l") ;; esac
  done < "$envfile"
fi
py="$(command -v python3 2>/dev/null || true)"
[ -n "$py" ] || { echo "fake systemd-run: python3 is required for fixture supervision" >&2; exit 1; }
if ! "$py" -I -c 'import sys' >/dev/null 2>&1; then
  for candidate in /usr/bin/python3 /usr/local/bin/python3; do
    [ -x "$candidate" ] || continue
    "$candidate" -I -c 'import sys' >/dev/null 2>&1 || continue
    py="$candidate"
    break
  done
fi
"$py" -I -c 'import sys' >/dev/null 2>&1 || { echo "fake systemd-run: no usable Python interpreter is available for fixture supervision" >&2; exit 1; }
mkdir -p "$u"
rm -f "$u/stop-request" "$u/stop-complete" "$u/events" "$u/supervisor-ready"
printf '%s\\n' "$$" > "$u/launcher-pid"
# The supervisor owns the ONE direct tier process. The manager only speaks the
# request/completion protocol below; no observed PID becomes signal authority.
cat > "$u/supervisor.py" <<'PY'
import os
import signal
import subprocess
import sys
import time

unit, wd, out, err = sys.argv[1:5]
argv = sys.argv[5:]
ttl_raw = os.environ.get("CCRC_FAKE_SUPERVISOR_TTL")
# Every detached fixture supervisor cleans up even if the test process dies.
# It exceeds ccrc's default 90-second readiness bound; focused tests override it.
ttl = float(ttl_raw) if ttl_raw is not None else 120
if ttl <= 0:
    raise SystemExit("fixture supervisor TTL must be positive")
deadline = time.monotonic() + ttl
# After completion the supervisor stays alive this long and reaps nothing, so a
# child it had failed to wait for would still be its visible zombie.
linger = 3.0
events = os.path.join(unit, "events")
request = os.path.join(unit, "stop-request")
complete = os.path.join(unit, "stop-complete")
pid_path = os.path.join(unit, "pid")
state_path = os.path.join(unit, "state")
ready = os.path.join(unit, "supervisor-ready")

# Evidence is best-effort. Control of the exact child never depends on it: a
# unit directory, or the whole fixture HOME, deleted under a live unit must
# never stop the supervisor signalling or reaping its one child.
def write(path, text):
    try:
        with open(path, "w") as stream:
            stream.write(text)
    except OSError:
        pass

def record(event):
    try:
        with open(events, "a") as stream:
            stream.write(event + "\\n")
    except OSError:
        pass

def complete_inactive():
    write(state_path, "inactive\\n")
    write(pid_path, "0\\n")
    try:
        with open(events, "a") as stream:
            stream.flush()
            os.fsync(stream.fileno())
    except OSError:
        pass
    write(complete, "complete\\n")

def stop_exact_child(proc):
    # poll() is itself the exact wait for a child that already exited.
    status = proc.poll()
    if status is None:
        record("TERM")
        proc.terminate()
        try:
            status = proc.wait(timeout=6)
        except subprocess.TimeoutExpired:
            record("TIMEOUT")
            proc.kill()
            record("KILL")
            status = proc.wait()
    record("WAIT:%d" % status)
    return status

signalled = False

def request_stop(signum, frame):
    global signalled
    signalled = True

for sig in (signal.SIGTERM, signal.SIGHUP, signal.SIGINT):
    signal.signal(sig, request_stop)

def stop_asked():
    return (signalled or not os.path.isdir(unit) or os.path.exists(request)
            or time.monotonic() >= deadline)

proc = None
status = 0
exited = False
try:
    with open(out, "ab", buffering=0) as stdout, open(err, "ab", buffering=0) as stderr:
        proc = subprocess.Popen(argv, cwd=wd, env=os.environ.copy(), stdin=subprocess.DEVNULL, stdout=stdout, stderr=stderr)
    write(pid_path, str(proc.pid) + "\\n")
    write(state_path, "active\\n")
    write(ready, "ready\\n")
    while proc.poll() is None:
        if stop_asked():
            break
        time.sleep(0.05)
    else:
        exited = True
finally:
    # Every exit path of this block, an exception included, stops and reaps
    # the exact child before completion is written.
    if proc is not None:
        status = stop_exact_child(proc)
    complete_inactive()
time.sleep(linger)
if not exited:
    raise SystemExit(0)
raise SystemExit(status if status >= 0 else 128 - status)
PY
# Every state write the launcher makes lands BEFORE the fork. From the fork on,
# only the supervisor writes this unit's state and pid, so a launcher that is
# descheduled after it can never overwrite the supervisor's \`active\` and pid.
printf '0\\n' > "$u/pid"
printf 'starting\\n' > "$u/state"
: > "$u/spawned"
( cd "$wd" || exit 1; exec env -i "PATH=$PATH" "PYTHONPATH=\${PYTHONPATH:-}" "PYTHONNOUSERSITE=\${PYTHONNOUSERSITE:-}" "PYTHONDONTWRITEBYTECODE=\${PYTHONDONTWRITEBYTECODE:-}" "\${envs[@]}" "\${fenv[@]}" "$py" -B "$u/supervisor.py" "$u" "$wd" "\${out:-/dev/null}" "\${err:-/dev/null}" "$@" ) \\
  </dev/null >/dev/null 2>&1 &
supervisor="$!"
printf '%s\\n' "$supervisor" > "$u/supervisor-pid"
printf '%s\\n' "$supervisor" >> "$d/spawned"
exit 0
`;

/** Plants the fake manager. `userManager` is what `systemctl --user
 *  show-environment` answers — the probe `_svc_have_user_manager` asks.
 *  `refuseSpawn` (default false) makes `systemd-run` refuse every start, in
 *  the words and exit code of a real manager's refusal, whatever body the
 *  constant above carries; planting again without it clears it. */
export function plantSystemd(home: string, opts: { userManager: boolean; refuseSpawn?: boolean }): void {
  const d = path.join(home, 'fake-systemd');
  fs.mkdirSync(path.join(d, 'units'), { recursive: true });
  fs.writeFileSync(path.join(d, 'user-manager'), opts.userManager ? 'up\n' : 'down\n');
  if (opts.refuseSpawn === true) fs.writeFileSync(path.join(d, 'refuse-spawn'), 'refuse\n');
  else fs.rmSync(path.join(d, 'refuse-spawn'), { force: true });
  const bin = harnessBin(home);
  fs.writeFileSync(path.join(bin, 'systemctl'), FAKE_SYSTEMCTL, { mode: 0o755 });
  fs.writeFileSync(path.join(bin, 'systemd-run'), FAKE_SYSTEMD_RUN, { mode: 0o755 });
}

/** One unit's state as the fake manager reports it: `is-active` prints
 *  `state`; `show -p MainPID --value` prints `pid` (0 when omitted). */
export function fakeUnit(home: string, unit: string, u: { state: string; pid?: number }): void {
  if (!/^[A-Za-z0-9@._:-]+$/.test(unit)) throw new Error(`fakeUnit: unsafe unit name ${JSON.stringify(unit)}`);
  const dir = path.join(home, 'fake-systemd', 'units', unit);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'state'), `${u.state}\n`);
  fs.writeFileSync(path.join(dir, 'pid'), `${u.pid ?? 0}\n`);
}

const lines = (p: string): string[] =>
  fs.existsSync(p) ? fs.readFileSync(p, 'utf8').split('\n').filter(Boolean) : [];
export const systemctlCalls = (home: string): string[] => lines(path.join(home, 'systemctl-calls'));
export const systemdRunCalls = (home: string): string[] => lines(path.join(home, 'systemd-run-calls'));

// ── Plan 2b-2 Task 5: reading and steering the fakes that RUN things ─────

/** Every `systemd-run` argv, in call order, one string per argument — the
 *  honest instrument for a unit's properties (m-platform §3.4). */
export function systemdRunArgv(home: string): string[][] {
  const dir = path.join(home, 'fake-systemd', 'run-argv');
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir).map(Number).filter(Number.isInteger).sort((a, b) => a - b)
    .map((n) => fs.readFileSync(path.join(dir, String(n)), 'utf8').split('\0').slice(0, -1));
}

/** The pid the fake manager records for `unit`, or null (none, or 0). */
export function unitPid(home: string, unit: string): number | null {
  const p = path.join(home, 'fake-systemd', 'units', unit, 'pid');
  if (!fs.existsSync(p)) return null;
  const n = Number(fs.readFileSync(p, 'utf8').trim());
  return Number.isInteger(n) && n > 1 ? n : null;
}

/** While `fail` holds, `systemctl --user stop <unit>` answers rc 1 and
 *  signals nothing — a unit the manager will not stop. */
export function failUnitStop(home: string, unit: string, fail: boolean): void {
  if (!/^[A-Za-z0-9@._:-]+$/.test(unit)) throw new Error(`failUnitStop: unsafe unit name ${JSON.stringify(unit)}`);
  const dir = path.join(home, 'fake-systemd', 'units', unit);
  if (fail) {
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'stop-fail'), '');
  } else {
    fs.rmSync(path.join(dir, 'stop-fail'), { force: true });
  }
}

/** Every later fake LiteLLM start exits 1 at once, with one line on its
 *  stderr — which is its log. */
export function refuseLitellmStart(home: string): void {
  fs.mkdirSync(fakeProcs(home), { recursive: true });
  fs.writeFileSync(path.join(fakeProcs(home), 'refuse-litellm-start'), '');
}

/** Every later fake LiteLLM start waits `seconds` before it binds: a tier
 *  still importing, whose command line is already the lane's. */
export function slowLitellmListen(home: string, seconds: number): void {
  fs.mkdirSync(fakeProcs(home), { recursive: true });
  fs.writeFileSync(path.join(fakeProcs(home), 'litellm-listen-delay'), `${seconds}\n`);
}

/** Makes later fake tiers ignore TERM. A finite `selfExpiry` must accompany
 * this test-only knob so a broken ownership path cannot outlive its test run. */
export function resistLitellmTerm(home: string, selfExpiry: number): void {
  fs.mkdirSync(fakeProcs(home), { recursive: true });
  fs.writeFileSync(path.join(fakeProcs(home), 'litellm-resist-term'), '');
  fs.writeFileSync(path.join(fakeProcs(home), 'litellm-self-expiry'), `${selfExpiry}\n`);
}

/** What the fake LiteLLM on `port` recorded about itself, or null. */
export function litellmEvidence(home: string, port: number): Record<string, unknown> | null {
  const p = path.join(fakeProcs(home), `litellm-${port}.json`);
  if (!fs.existsSync(p)) return null;
  return JSON.parse(fs.readFileSync(p, 'utf8')) as Record<string, unknown>;
}

/** Teardown actions the directly owned supervisor actually completed. This
 * evidence is for assertions only; it never grants authority over its pid. */
export function litellmTeardownEvents(home: string, port: number): string[] {
  return lines(path.join(fakeProcs(home), `litellm-${port}.supervisor-events`));
}

/** The stand-in LiteLLM, started DIRECTLY and not through ccrc (ruling R29),
 *  for a case that needs a LiteLLM-shaped tier ccrc did not start: this
 *  lane's own (`config` is `plantLaneConfig`'s path) or another tool's (any
 *  other config file). Its command line is the one the fake runtime's tier arm
 *  execs, `<python3> -B <fake-litellm.py> -m litellm.proxy.proxy_cli --config
 *  <config> --host 127.0.0.1 --port <port>`, so `_codex_pid_is_tier` reads it
 *  exactly as it reads a tier ccrc started. It logs to
 *  `fake-procs/litellm-<port>.log`, and resolves with its pid once `port`
 *  accepts (10 s, or it throws with that log).
 *
 *  `config` must be an existing file. The stand-in refuses a missing one, as
 *  LiteLLM does, so this throws first and names it.
 *
 *  `reparent: true` starts it beneath a directly owned Python supervisor. Use
 *  it whenever ccrc may kill the tier: a killed direct child of THIS process
 *  stays a zombie until Node reaps it, while `spawnSync` blocks that event
 *  loop. The supervisor owns exactly its direct Python child: on teardown it
 *  waits six seconds after TERM, escalates to KILL only after `TimeoutExpired`,
 *  then waits/reaps before exiting. It does not claim descendant-tree ownership. Without `reparent`
 *  the tier itself is the tracked child. */
export async function spawnFakeLitellm(
  home: string,
  o: { port: number; config: string; reparent?: boolean },
): Promise<number> {
  const py = pythonOrSkip();
  if (py === null) throw new Error('spawnFakeLitellm needs python3 — gate the describe with pythonOrSkip()');
  if (!(fs.statSync(o.config, { throwIfNoEntry: false })?.isFile() ?? false)) {
    throw new Error(`spawnFakeLitellm: ${o.config} is not a file; the stand-in refuses a missing config, as LiteLLM `
      + 'does (plantLaneConfig plants a lane\'s own)');
  }
  const script = writeFakeLitellm(home);
  const log = path.join(fakeProcs(home), `litellm-${o.port}.log`);
  const argv = ['-B', script, '-m', 'litellm.proxy.proxy_cli', '--config', o.config,
    '--host', '127.0.0.1', '--port', String(o.port)];
  const env = { PATH: process.env['PATH'] ?? '/usr/bin:/bin', HOME: home, PYTHONDONTWRITEBYTECODE: '1' };
  let pid: number;
  let owner: ChildProcess;
  if (o.reparent === true) {
    const pidfile = path.join(fakeProcs(home), `litellm-${o.port}.supervisor-pid`);
    const events = path.join(fakeProcs(home), `litellm-${o.port}.supervisor-events`);
    fs.rmSync(pidfile, { force: true });
    fs.rmSync(events, { force: true });
    const fd = fs.openSync(log, 'a');
    const supervisor = [
      'import os, signal, subprocess, sys, time',
      'pidfile, log, events = sys.argv[1:4]',
      'argv = sys.argv[4:]',
      'finishing = False',
      'proc = None',
      'def record(event):',
      '    with open(events, "a") as stream:',
      '        stream.write(event + "\\n")',
      'def wait_and_record(timeout=None):',
      '    status = proc.wait(timeout=timeout)',
      '    record("WAIT:%d" % status)',
      '    return status',
      'def finish(*_):',
      '    global finishing',
      '    if finishing:',
      '        return',
      '    finishing = True',
      '    if proc is not None and proc.poll() is None:',
      '        record("TERM")',
      '        proc.terminate()',
      '        try:',
      '            wait_and_record(timeout=6)',
      '        except subprocess.TimeoutExpired:',
      '            record("TIMEOUT")',
      '            proc.kill()',
      '            record("KILL")',
      '            wait_and_record()',
      '    os._exit(0)',
      'for sig in (signal.SIGTERM, signal.SIGINT, signal.SIGHUP):',
      '    signal.signal(sig, finish)',
      'with open(log, "ab", buffering=0) as stream:',
      '    proc = subprocess.Popen(argv, cwd=os.getcwd(), env=os.environ.copy(), stdin=subprocess.DEVNULL, stdout=stream, stderr=stream)',
      '    with open(pidfile, "w") as out:',
      '        out.write(str(proc.pid) + "\\n")',
      '    while proc.poll() is None:',
      '        time.sleep(0.05)',
      '    if not finishing:',
      '        status = wait_and_record()',
      '        raise SystemExit(status if status >= 0 else 128 - status)',
      'raise SystemExit(0)',
    ].join('\n');
    owner = spawn(py, ['-B', '-c', supervisor, pidfile, log, events, py, ...argv], {
      cwd: home, env, stdio: ['ignore', fd, fd],
    });
    fs.closeSync(fd);
    // The held supervisor handle, not this observed child PID, authorizes
    // current-run teardown; it reaps the tier if a product stop wins first.
    trackSupervisor(home, owner);
    const t0 = Date.now();
    while (!fs.existsSync(pidfile)) {
      if (owner.exitCode !== null || owner.signalCode !== null || Date.now() - t0 > 10_000) {
        const said = fs.existsSync(log) ? fs.readFileSync(log, 'utf8') : '';
        throw new Error(`spawnFakeLitellm: the supervisor started nothing: ${said}`);
      }
      await new Promise((r) => setTimeout(r, 25));
    }
    pid = Number(fs.readFileSync(pidfile, 'utf8').trim());
    if (!(Number.isInteger(pid) && pid > 1)) throw new Error('spawnFakeLitellm: the supervisor recorded no tier pid');
  } else {
    const fd = fs.openSync(log, 'a');
    owner = spawn(py, argv, { cwd: home, env, stdio: ['ignore', fd, fd] });
    fs.closeSync(fd);
    trackChild(home, owner);
    if (owner.pid === undefined) throw new Error('spawnFakeLitellm: the child has no pid');
    pid = owner.pid;
  }
  const t0 = Date.now();
  while (!(await portAccepts(o.port))) {
    if (!alive(pid) || owner.exitCode !== null || owner.signalCode !== null || Date.now() - t0 > 10_000) {
      const said = fs.existsSync(log) ? fs.readFileSync(log, 'utf8') : '';
      throw new Error(`spawnFakeLitellm: nothing accepted on port ${o.port}: ${said}`);
    }
    await new Promise((r) => setTimeout(r, 50));
  }
  return pid;
}

// ── a lane's rendered LiteLLM config (Plan 2b-2 Task 5, ruling R20) ───────

/** Writes `~/.ccrc/codex/<id>/litellm.yaml`, mode 0600 in a 0700 lane
 *  directory, as `shared/litellm.mjs`' own renderer renders the SHIPPED
 *  template for a one-model catalogue, and returns its path. It is the
 *  renderer's output, never hand-typed YAML, so a template or renderer change
 *  reaches every fixture that plants a config. A spine or lifecycle fixture
 *  calls it before `ccrc codex start`, which refuses `litellm-unrendered`
 *  without one (ruling R4), and before `spawnFakeLitellm` on a lane's own
 *  config. */
export function plantLaneConfig(home: string, id: string): string {
  if (!/^[a-z][a-z0-9-]{0,31}$/.test(id)) throw new Error(`plantLaneConfig: unsafe id ${JSON.stringify(id)}`);
  const dir = path.join(home, '.ccrc', 'codex', id);
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  const text = renderLitellmConfig(
    fs.readFileSync(path.join(REPO, 'deploy', 'litellm-config.template.yaml'), 'utf8'),
    {
      probe: 'codex', fetchedAt: 1789000000, stale: false,
      models: [{
        id: 'gpt-x', label: 'gpt-x', context: null, maxContext: null, efforts: [],
        hidden: false, priceIn: null, priceOut: null,
      }],
    },
  );
  const out = path.join(dir, 'litellm.yaml');
  fs.writeFileSync(out, text, { mode: 0o600 });
  fs.chmodSync(out, 0o600);
  return out;
}

// ── processes ────────────────────────────────────────────────────────────

type TrackedChild = { child: ChildProcess; supervisor: boolean };
const tracked = new Map<string, Set<TrackedChild>>();
const cleanupCallbacks = new Map<string, Map<string, () => void | Promise<void>>>();

function track(home: string, child: ChildProcess, supervisor: boolean): void {
  let set = tracked.get(home);
  if (set === undefined) { set = new Set(); tracked.set(home, set); }
  set.add({ child, supervisor });
}

/** Hands a direct child this suite spawned by other means (e.g.
 * `ccgptHarness.ts`'s `spawnPy` running the real shim) to
 * {@link killLaneProcesses}. */
export function trackChild(home: string, child: ChildProcess): void {
  track(home, child, false);
}

/** Tracks a directly owned supervisor. It alone owns the fake's one direct
 * Python tier and must complete its own TERM/KILL/wait protocol before exiting. */
function trackSupervisor(home: string, child: ChildProcess): void {
  track(home, child, true);
}

/** Registers one current-run product cleanup callback for a stable lane/key.
 *  A later registration for the same key replaces it, so explicit cleanup and
 *  file-level afterEach remain harmlessly idempotent. */
export function registerLaneCleanup(
  home: string, key: string, cleanup: () => void | Promise<void>,
): void {
  let callbacks = cleanupCallbacks.get(home);
  if (callbacks === undefined) { callbacks = new Map(); cleanupCallbacks.set(home, callbacks); }
  callbacks.set(key, cleanup);
}

/** What the listener answers on `GET /ccgpt/lane`: `json` is ccrc's shim's
 *  shape (200, application/json, `{"lane": <lane>}`); `json-extra` adds a key;
 *  `json-as-text` is the right body under `text/plain`; `json-500` is the right
 *  body at status 500; `text` is the OTHER repository's shim (`text/plain`, the
 *  bare id); `404` answers every path with a JSON 404, as a LiteLLM proxy
 *  would. One mode per clause of `_codex_lane_answer`'s shape, so deleting any
 *  one clause reds exactly one case. */
export type ListenerAnswer = 'json' | 'json-extra' | 'json-as-text' | 'json-500' | 'text' | '404';

const LISTENER_PY = `import json, sys
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
ARGS = sys.argv[1:]
def opt(name, default):
    return ARGS[ARGS.index(name) + 1] if name in ARGS and ARGS.index(name) + 1 < len(ARGS) else default
ANSWER = opt("--answer", "404")
LANE = opt("--lane", "")
class Handler(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"
    def log_message(self, *args):
        pass
    def _send(self, code, ctype, body):
        self.send_response(code)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Connection", "close")
        self.end_headers()
        self.wfile.write(body)
    def do_GET(self):
        if self.path == "/ccgpt/lane":
            if ANSWER == "json":
                return self._send(200, "application/json", json.dumps({"lane": LANE}).encode())
            if ANSWER == "json-extra":
                return self._send(200, "application/json", json.dumps({"lane": LANE, "v": 1}).encode())
            if ANSWER == "json-as-text":
                return self._send(200, "text/plain", json.dumps({"lane": LANE}).encode())
            if ANSWER == "json-500":
                return self._send(500, "application/json", json.dumps({"lane": LANE}).encode())
            if ANSWER == "text":
                return self._send(200, "text/plain", LANE.encode())
        return self._send(404, "application/json", b'{"error": "not found"}')
server = ThreadingHTTPServer(("127.0.0.1", int(opt("--listen-port", "0"))), Handler)
print("READY %d" % server.server_address[1], flush=True)
server.serve_forever()
`;

export interface Listener { port: number; pid: number; child: ChildProcess }

/** A stdlib HTTP listener, a python child of this process, bound to `port`
 *  (default 0: the kernel chooses, and the port is HELD from the moment this
 *  resolves). `argv` is appended to its command line verbatim and otherwise
 *  ignored, which is how a case gives a listener the command line of a tier —
 *  `['--config', <litellm.yaml>]`, or `[<shim file>, '--ccrc-lane=<id>']`.
 *  Resolves once it has bound; rejects with its stderr if it dies first. */
export async function spawnListener(
  home: string,
  o: { answer: ListenerAnswer; lane?: string; port?: number; argv?: readonly string[] },
): Promise<Listener> {
  const py = pythonOrSkip();
  if (py === null) throw new Error('spawnListener needs python3 — gate the describe with pythonOrSkip()');
  const dir = path.join(home, 'fake-procs');
  fs.mkdirSync(dir, { recursive: true });
  const script = path.join(dir, 'listener.py');
  if (!fs.existsSync(script)) fs.writeFileSync(script, LISTENER_PY);
  const child = spawn(py, [
    script, '--answer', o.answer, '--lane', o.lane ?? '', '--listen-port', String(o.port ?? 0), ...(o.argv ?? []),
  ], {
    cwd: home,
    env: { PATH: process.env['PATH'] ?? '/usr/bin:/bin', HOME: home, PYTHONDONTWRITEBYTECODE: '1' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  trackChild(home, child);
  const port = await new Promise<number>((resolve, reject) => {
    let out = '';
    let err = '';
    const timer = setTimeout(() => reject(new Error(`listener reported no READY within 10s: ${err}`)), 10_000);
    child.stdout?.on('data', (c: Buffer) => {
      out += c.toString();
      const m = /^READY (\d+)$/m.exec(out);
      if (m) { clearTimeout(timer); resolve(Number(m[1])); }
    });
    child.stderr?.on('data', (c: Buffer) => { err += c.toString(); });
    child.once('exit', (code, sig) => {
      clearTimeout(timer);
      reject(new Error(`listener exited (${code ?? sig}) before READY: ${err}`));
    });
  });
  if (child.pid === undefined) throw new Error('spawnListener: the child has no pid');
  return { port, pid: child.pid, child };
}

// ── waiting on, reading and ending what the fakes run (Task 5, ruling R30) ─

/** `kill -0`. A tier ccrc started is init's child by the time a case reads
 *  it, so this goes false once the tier has exited. A killed child of THIS
 *  process (a `spawnListener`, or a `spawnFakeLitellm` without `reparent`)
 *  stays a zombie, alive to `kill -0`, until the event loop reaps it, so a
 *  case that must see one of those die reads its port instead. */
export function alive(pid: number): boolean {
  try { process.kill(pid, 0); return true; } catch { return false; }
}

// `psArgs` is an observation helper only. Fixture teardown owns direct
// ChildProcess handles and current-run product cleanup callbacks, never PIDs.
export { psArgs };

/** True when something on 127.0.0.1:`port` completes a TCP connect inside
 *  2 s. */
export function portAccepts(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const s = connect({ port, host: '127.0.0.1' });
    s.once('connect', () => { s.destroy(); resolve(true); });
    s.once('error', () => resolve(false));
    s.setTimeout(2000, () => { s.destroy(); resolve(false); });
  });
}

/** `GET /ccgpt/lane` on `port`: its status, its `Content-Type` and its body
 *  text, or null when nothing answers inside 3 s. The shape is the whole
 *  answer, because the other repository's shim answers the same path as
 *  `text/plain` and a case must be able to tell the two apart. */
export async function laneAnswer(port: number): Promise<{ status: number; type: string; body: string } | null> {
  try {
    const r = await fetch(`http://127.0.0.1:${port}/ccgpt/lane`, { signal: AbortSignal.timeout(3000) });
    return { status: r.status, type: r.headers.get('content-type') ?? '', body: await r.text() };
  } catch { return null; }
}

/** Polls `pred` every 50 ms until it holds, and THROWS
 *  `timed out after <ms>ms waiting for <what>` when it has not within `ms`.
 *  It never resolves false, so a wait cannot be silently ignored. */
export async function eventually(
  pred: () => boolean | Promise<boolean>, what: string, ms = 10_000,
): Promise<void> {
  const t0 = Date.now();
  while (!(await pred())) {
    if (Date.now() - t0 > ms) throw new Error(`timed out after ${ms}ms waiting for ${what}`);
    await new Promise((r) => setTimeout(r, 50));
  }
}

/** afterEach: takes and clears current-run product cleanup callbacks while
 *  fixture state still exists, then ends direct current-run children and waits
 *  for each exit. Persisted fake-manager, fake-process and lane PID files are
 *  observations/product inputs only; they never grant fixture signal authority.
 *  A whole interrupted run may therefore leave an orphan rather than grant a
 *  later run permission to signal a reused PID. */
export async function killLaneProcesses(home: string): Promise<void> {
  const callbacks = [...(cleanupCallbacks.get(home) ?? new Map()).values()];
  cleanupCallbacks.delete(home);
  for (const cleanup of callbacks) {
    try { await cleanup(); } catch { /* cleanup must not replace a test failure */ }
  }

  const kids = [...(tracked.get(home) ?? [])];
  tracked.delete(home);
  await Promise.all(kids.map(({ child, supervisor }) => new Promise<void>((resolve) => {
    if (child.exitCode !== null || child.signalCode !== null) { resolve(); return; }
    // A supervisor owns exactly one direct tier and must reap it before exiting.
    // Only direct children get this generic force timer; killing a supervisor
    // mid-protocol could reparent the tier and discard our only safe authority.
    const force = supervisor ? undefined : setTimeout(() => { try { child.kill('SIGKILL'); } catch { /* gone */ } }, 5_000);
    child.once('exit', () => { if (force !== undefined) clearTimeout(force); resolve(); });
    try { child.kill('SIGTERM'); } catch { if (force !== undefined) clearTimeout(force); resolve(); }
  })));
}

// ════════════════════════════════════════════════════════════════════════
// Plan 2b-2 Task 10 — the SPINE harnesses' join to the fake user manager,
// and the helpers the spine suites (install, update, uninstall) share.
//
// WHY A JOIN AND NOT `plantSystemd` ITSELF. `plantSystemd` above plants
// `systemctl` and `systemd-run` into `<home>/.local/bin` for the codex suites.
// The three spine harnesses — `ccrcEnv` (ccrc-install.test.ts), `updateEnv`
// (ccrc-update.test.ts), `verbEnv` (ccrc-uninstall.test.ts) — write their
// OWN `systemctl` over that path on EVERY run, because theirs answer the
// spine's verbs and plantSystemd's answers the codex tiers'. And none of them
// planted any `systemd-run`, so on a Linux box the name resolved to the REAL
// one (m-platform §3.2). So each harness now:
//   1. calls `adoptPlantedSystemd` BEFORE writing its own `systemctl`, which
//      moves a planted pair aside to become the DELEGATE;
//   2. splices `spineSystemctlArms()` into its `systemctl` stub right after
//      the `--user` shift, forwarding the codex-tier verbs to the delegate;
//   3. writes `spineSystemdRun()` as `systemd-run`: a recorder that forwards
//      to the delegate, or refuses.
// With no `plantSystemd` in a test, every codex-tier verb is answered the way
// a real user manager answers a unit it has never loaded, and `systemd-run`
// refuses with 97 after recording — a spine path that reached it is loud and
// contained, never a real transient unit.
//
// ONE ASSUMPTION ABOUT `plantSystemd`, checked rather than trusted: it writes
// into `<home>/.local/bin`. Every spine test that plants it asserts the
// delegate exists after the first run.
// ════════════════════════════════════════════════════════════════════════

/** The marker line in every FRONT a spine harness plants. `adoptPlantedSystemd`
 *  reads it to tell the harness's own front from a pair it must adopt.
 *  Module-internal (ruling R30): only this block reads it. */
const SPINE_FRONT_MARK = '# ccrc-spine-front (Plan 2b-2 Task 10)';

/** The two user-manager names a test may never let resolve to the box's
 *  real binaries — what {@link assertSpineFrontContained} and
 *  {@link assertIsolationWallFirst} CHECK. Deliberately NOT derived from any
 *  builder's own list ({@link SPINE_DELEGATES}, the loop in
 *  {@link isolationManagerStubs}): a check that read the builder's list
 *  would lose a name in the same edit that lost it from the builder, and
 *  catching exactly that edit is what the check is for. Module-internal. */
const MANAGER_NAMES = ['systemd-run', 'systemctl'] as const;

const SPINE_DELEGATES: ReadonlyArray<readonly [string, string]> = [
  ['systemctl', '.codex-systemctl'],
  ['systemd-run', '.codex-systemd-run'],
];

/** Moves a `systemctl`/`systemd-run` that is not a spine front aside, as the
 *  delegate the fronts forward to, and WRITES A FRONT BACK IN THE SAME ACT —
 *  the rename and its replacement can never be separated again (Task 11
 *  review fix round 1, spec-1/mut-1 CRITICAL: a harness whose own subsequent
 *  `plant('systemd-run', spineSystemdRun())` line was lost left
 *  `~/.local/bin/systemd-run` resolving to the box's real binary once this
 *  function had moved the planted fake aside — measured on the live box,
 *  2026-09-28, as a real `ccgpt-codex-a-shim.service` transient unit). The
 *  front this writes is fully functional, not a placeholder: `systemd-run`
 *  gets {@link spineSystemdRun} verbatim (which itself forwards to the
 *  delegate this call just created), and `systemctl` gets
 *  {@link spineSystemctlBaseline}, a self-contained front covering the
 *  codex-tier verbs `spineSystemctlArms()` answers. A harness's own
 *  subsequent `plant(...)` call (its COMBINED body, with its own spine verbs
 *  too) overwrites this the instant it runs; what this function writes is
 *  what a test measures only when that later call is ever lost. Idempotent;
 *  a no-op when nothing is planted (nothing to move, nothing to front). */
export function adoptPlantedSystemd(home: string): void {
  const bin = join(home, '.local', 'bin');
  for (const [name, aside] of SPINE_DELEGATES) {
    const p = join(bin, name);
    if (!existsSync(p)) continue;
    if (readFileSync(p, 'utf8').includes(SPINE_FRONT_MARK)) continue;
    renameSync(p, join(bin, aside));
    writeFileSync(p, name === 'systemd-run' ? spineSystemdRun() : spineSystemctlBaseline(), { mode: 0o755 });
  }
}

/** A self-contained baseline `systemctl` front: the `--user` check every
 *  harness's own combined body also does, then {@link spineSystemctlArms}
 *  verbatim, then a closing refusal — everything `spineSystemctlArms()`
 *  needs to run standalone. Written by {@link adoptPlantedSystemd} the
 *  instant it moves a planted `systemctl` aside (Task 11 review fix round
 *  1), so the codex-tier verbs it answers (`stop`, `show-environment`,
 *  `reset-failed`, forwarded to the delegate) are never left unfronted. A
 *  harness's own `plant('systemctl', […, ...spineSystemctlArms(), …])` call,
 *  which adds its OWN spine verbs (daemon-reload, disable --now, …),
 *  overwrites this baseline immediately in the normal flow. */
function spineSystemctlBaseline(): string {
  return [
    '#!/bin/sh',
    '[ "${1:-}" = --user ] || { echo "fixture systemctl: unexpected argv: $*" >&2; exit 90; }',
    'shift',
    ...spineSystemctlArms(),
    'echo "fixture systemctl: no fixture systemctl front is fully planted in this HOME yet (spine harness setup incomplete)" >&2',
    'exit 97',
  ].join('\n') + '\n';
}

/** THROWS unless `systemd-run` AND `systemctl` (Task 11 review fix round 2,
 *  N1: round 1 checked `systemd-run` alone, and `verbEnv`'s own docstring
 *  claimed more than the code did) each resolve, under `env`, to a file
 *  inside `<home>/.local/bin` that carries {@link SPINE_FRONT_MARK} — a
 *  spine RUNNER's own final check, called on the FINAL MERGED env
 *  (`extraEnv`, stubs and PATH overrides all applied), immediately before
 *  the spawn (round 2, N5: a builder-level call only ever saw the env
 *  BEFORE those later merges). {@link adoptPlantedSystemd}'s own
 *  belt-and-braces write (above) is the reason this is expected to pass in
 *  the ordinary case — this is an INDEPENDENT layer, catching anything that
 *  still left a front missing or unmarked, for whatever reason, before a
 *  single command runs under that env.
 *
 *  `opts.expectAbsent` names any of `systemd-run`/`systemctl` a SPECIFIC
 *  runner call legitimately runs with no spine for at all (round 2, item 1's
 *  "must reach no manager" case — e.g. `ccrc-install.test.ts`'s "a box with
 *  no systemd" refusal test, whose PATH is built to exclude `systemctl`
 *  everywhere, fixture bin included). For a named tool this REQUIRES
 *  resolution to be EMPTY — nothing on PATH at all — and still THROWS if it
 *  resolves to anything, home-fronted or not: the promise is "never a real
 *  one", and an unexpectedly-present resolution (even an oddly-placed fake)
 *  is not what that specific env was built to prove. */
export function assertSpineFrontContained(
  env: NodeJS.ProcessEnv, home: string, opts: { expectAbsent?: readonly string[] } = {},
): void {
  const expectAbsent = new Set(opts.expectAbsent ?? []);
  for (const name of MANAGER_NAMES) {
    const r = spawnSync('/bin/sh', ['-c', `command -v ${name}`], { env, encoding: 'utf8' });
    const resolved = (r.stdout ?? '').trim();
    if (expectAbsent.has(name)) {
      if (resolved !== '') {
        throw new Error(`assertSpineFrontContained: ${name} was expected absent (a runner that legitimately reaches `
          + `no manager for it) but resolved to ${resolved} — refusing to hand out an env under which a real `
          + `${name} could run`);
      }
      continue;
    }
    const expect = join(home, '.local', 'bin', name);
    if (resolved !== expect) {
      throw new Error(`assertSpineFrontContained: ${name} resolved to ${resolved === '' ? '(nothing)' : resolved}, `
        + `not ${expect} — refusing to hand out an env under which a real ${name} could run`);
    }
    if (!readFileSync(expect, 'utf8').includes(SPINE_FRONT_MARK)) {
      throw new Error(`assertSpineFrontContained: ${expect} does not carry the spine front mark — refusing to hand `
        + `out an env under which an unfronted ${name} could run`);
    }
  }
}

/** THE CODEX SUITES' FINAL-ENV CHECK (final review E1). THROWS unless each
 *  of `systemd-run` and `systemctl` resolves, under `env`, to a file inside
 *  `<home>/` that carries {@link MANAGER_STANDIN_MARK} — and unless
 *  `<home>/.local/bin/<name>`, which a pass-through probe placed first on
 *  PATH execs, carries it too. A codex suite's runner calls it on the FINAL
 *  env (its `extraEnv` merged) immediately before the spawn, so a plant line
 *  that was lost — `plantSystemd`'s own write, or a poison's — can no longer
 *  let either name fall through `PATH` to the box's real manager: measured
 *  at review, one lost line resolved `systemd-run` to `/usr/bin`. It asks
 *  only `command -v` (one `/bin/sh`, both names) and reads the files, so the
 *  resolved binary is never executed. The spine runners use {@link
 *  assertSpineFrontContained} instead: their fronts carry the spine's mark. */
export function assertManagerStandIns(env: NodeJS.ProcessEnv, home: string): void {
  const r = spawnSync('/bin/sh', ['-c', MANAGER_NAMES.map((n) => `printf '%s\\n' "$(command -v ${n})"`).join('; ')],
    { env, encoding: 'utf8' });
  const resolved = (r.stdout ?? '').split('\n');
  MANAGER_NAMES.forEach((name, i) => {
    const at = resolved[i] ?? '';
    if (!at.startsWith(`${home}/`)) {
      throw new Error(`assertManagerStandIns: ${name} resolved to ${at === '' ? '(nothing)' : at}, not a stand-in `
        + `inside ${home} — refusing to hand out an env under which a real ${name} could run`);
    }
    for (const f of new Set([at, join(home, '.local', 'bin', name)])) {
      let body = '';
      try { body = readFileSync(f, 'utf8'); } catch { /* absent or unreadable: no mark */ }
      if (!body.includes(MANAGER_STANDIN_MARK)) {
        throw new Error(`assertManagerStandIns: ${f} does not carry the manager stand-in mark — refusing to hand `
          + `out an env under which an unmarked ${name} could run`);
      }
    }
  });
}

/** Shell lines a spine harness splices into its `systemctl` stub right after
 *  `shift` (the `--user` check) — `$1` is then the verb — and before its own
 *  `case "$1" in`. */
export function spineSystemctlArms(): string[] {
  return [
    SPINE_FRONT_MARK,
    // ONE ordered log of every manager call, systemctl and systemd-run alike,
    // so "stopped BEFORE it was started again" is a measurement.
    'printf \'systemctl --user %s\\n\' "$*" >> "$HOME/manager-calls"',
    'cx="$HOME/.local/bin/.codex-systemctl"',
    'case "$1" in',
    '  show-environment|stop|reset-failed) [ -x "$cx" ] && exec "$cx" --user "$@" ;;',
    'esac',
    'case " $* " in',
    '  *" ccgpt-"*) [ -x "$cx" ] && exec "$cx" --user "$@" ;;',
    'esac',
    // No fake user manager planted: a manager that IS up (the spine's own
    // units are enabled through this same stub) and has never loaded a codex
    // unit — so a stray start reaches the refusing `systemd-run`, never nohup.
    'if [ "$1" = show-environment ]; then echo "HOME=$HOME"; exit 0; fi',
    'case " $* " in',
    '  *" ccgpt-"*)',
    '    u=""; for a in "$@"; do case "$a" in ccgpt-*) u="$a" ;; esac; done',
    '    case "$1" in',
    '      is-active) echo inactive; exit 3 ;;',
    '      show) case " $* " in *" --value "*) echo 0 ;; *) echo "MainPID=0" ;; esac; exit 0 ;;',
    '      stop) echo "Failed to stop $u: Unit $u not loaded." >&2; exit 5 ;;',
    '      reset-failed) echo "Failed to reset failed state of unit $u: Unit $u not loaded." >&2; exit 1 ;;',
    '    esac',
    '    echo "fixture systemctl: unexpected codex-tier argv: $*" >&2; exit 90 ;;',
    'esac',
  ];
}

/** The spine harnesses' `systemd-run`: records, honours a per-unit refusal
 *  knob, forwards to an adopted `plantSystemd`, else refuses with 97. */
export function spineSystemdRun(): string {
  return [
    '#!/bin/sh',
    SPINE_FRONT_MARK,
    'printf \'%s\\n\' "$*" >> "$HOME/spine-systemd-run-calls"',
    'printf \'systemd-run %s\\n\' "$*" >> "$HOME/manager-calls"',
    'if [ -f "$HOME/fixture-systemd-run-fail" ]; then',
    '  IFS= read -r bad < "$HOME/fixture-systemd-run-fail"',
    '  case " $* " in',
    '    *" --unit=$bad "*) echo "Failed to start transient service unit: fixture refusal for $bad" >&2; exit 1 ;;',
    '  esac',
    'fi',
    'cx="$HOME/.local/bin/.codex-systemd-run"',
    '[ -x "$cx" ] && exec "$cx" "$@"',
    'echo "fixture systemd-run: no fake user manager is planted in this HOME — a spine harness never starts a real transient unit" >&2',
    'exit 97',
  ].join('\n') + '\n';
}

/** Run under a harness env: proves `systemd-run` resolves INSIDE the fixture
 *  HOME before ever invoking it (the real one is never executed, even when
 *  the harness is broken), and that `show-environment` is answered. */
export const SPINE_CONTAINMENT_PROBE = [
  'p="$(command -v systemd-run)"',
  'echo "at=$p"',
  'case "$p" in',
  '  "$HOME"/*) "$p" --user --unit=fixture-containment-probe.service -- true; echo "run-rc=$?" ;;',
  '  *) echo "UNCONTAINED" ;;',
  'esac',
  'systemctl --user show-environment >/dev/null 2>&1; echo "env-rc=$?"',
].join('\n');

const recordedLines = (p: string): string[] =>
  (existsSync(p) ? readFileSync(p, 'utf8').split('\n').filter(Boolean) : []);
/** Every manager call the spine fronts saw, in order (`systemctl --user …` / `systemd-run …`). */
export const managerCalls = (home: string): string[] => recordedLines(join(home, 'manager-calls'));
/** Every `systemd-run` argv the front saw. */
export const spineRunCalls = (home: string): string[] => recordedLines(join(home, 'spine-systemd-run-calls'));

/** The marker line in each stub {@link isolationManagerStubs} writes, which
 *  {@link assertIsolationWallFirst} reads. Module-internal, as
 *  {@link SPINE_FRONT_MARK} is: only this block writes or reads it. */
const ISOLATION_WALL_MARK = '# ccrc-isolation-wall (Plan 2b-2 final review F4)';

/** The ISOLATION harnesses' wall (Tasks 10 and 11: `runStepHarness`,
 *  `runUninstCodex`). Those harnesses run one extracted step under `bash -c`
 *  with the caller's PATH, and they plant none of the spine fronts above. The
 *  step reaches the user manager only through the lane-library seams the
 *  harness stubs, so a direct `systemctl` or `systemd-run` from the step body
 *  is a defect or a mutation, and without this wall it would resolve to the
 *  REAL binary. The harness puts the returned directory FIRST on PATH. Each
 *  stub records its argv to `$HOME/stray-manager-calls`, says so on stderr and
 *  refuses with 97, and the harness throws when that record is not empty. */
export function isolationManagerStubs(home: string): string {
  const dir = join(home, 'isolation-bin');
  mkdirSync(dir, { recursive: true });
  for (const name of ['systemctl', 'systemd-run']) {
    writeFileSync(join(dir, name), [
      '#!/bin/sh',
      ISOLATION_WALL_MARK,
      `printf '%s %s\\n' ${name} "$*" >> "$HOME/stray-manager-calls"`,
      `echo "fixture ${name}: a step measured in isolation reached the user manager directly: $*" >&2`,
      'exit 97',
    ].join('\n') + '\n', { mode: 0o755 });
  }
  return dir;
}
/** THROWS unless BOTH `systemd-run` and `systemctl` resolve, under `env`, to
 *  `<home>/isolation-bin/<name>` — the wall {@link isolationManagerStubs}
 *  builds — AND that file carries {@link ISOLATION_WALL_MARK} (final review
 *  F4: a check of where a name resolves passed a symlink planted at the
 *  wall's own path to the box's real `/usr/bin/systemctl`, measured; reading
 *  the file for the mark, as {@link assertSpineFrontContained} does for its
 *  front, closes that). The isolation harnesses (`runStepHarness`, `runUninstCodex`) call
 *  it on the env they spawn with, on the line before the spawn (Task 11 review
 *  fix round 3, C2). {@link strayManagerCalls} only reads the WALL's own log,
 *  so a name the wall stopped writing, or a directory ahead of the wall on
 *  PATH, would send a stray call to the box's real binary with nothing
 *  recorded; this refuses that env before anything runs under it. It only
 *  asks `command -v`, so the real binary is never executed. */
export function assertIsolationWallFirst(env: NodeJS.ProcessEnv, home: string): void {
  for (const name of MANAGER_NAMES) {
    const r = spawnSync('/bin/sh', ['-c', `command -v ${name}`], { env, encoding: 'utf8' });
    const resolved = (r.stdout ?? '').trim();
    const expect = join(home, 'isolation-bin', name);
    if (resolved !== expect) {
      throw new Error(`assertIsolationWallFirst: ${name} resolved to ${resolved === '' ? '(nothing)' : resolved}, `
        + `not ${expect} — refusing to run an isolated step under which a real ${name} could run`);
    }
    if (!readFileSync(expect, 'utf8').includes(ISOLATION_WALL_MARK)) {
      throw new Error(`assertIsolationWallFirst: ${expect} does not carry the isolation wall mark — refusing to run `
        + `an isolated step under which an unwalled ${name} could run`);
    }
  }
}
/** Every call that reached {@link isolationManagerStubs}' stubs, in order. */
export const strayManagerCalls = (home: string): string[] => recordedLines(join(home, 'stray-manager-calls'));

// ── extraction: one ccd/ccrc function, its seams stubbed ──────────────────
const CCRC_SRC = fileURLToPath(new URL('../../ccd/ccrc', import.meta.url));

/** One function out of ccd/ccrc, column-0 signature to column-0 `}` — the
 *  `_inst_installed` extraction idiom in ccrc-install.test.ts. */
export function ccrcFunction(name: string): string {
  const m = new RegExp(`^${name}\\(\\) \\{[\\s\\S]*?\\n\\}`, 'm').exec(readFileSync(CCRC_SRC, 'utf8'));
  if (m === null) throw new Error(`ccd/ccrc has no ${name}() { … } at column 0`);
  return m[0];
}
/** One line of ccd/ccrc (a one-line function or an assignment). */
export function ccrcLine(re: RegExp, what: string): string {
  const m = re.exec(readFileSync(CCRC_SRC, 'utf8'));
  if (m === null) throw new Error(`ccd/ccrc has no ${what}`);
  return m[0];
}

export type StubRc = number | readonly number[];

/** A bash function `<name> <id> <tier>` that appends `<name> <id> <tier>` to
 *  `$HOME/calls` and returns, for the Nth call per `"<id> <tier>"` key, the
 *  Nth value of `table[key]` (a sequence repeats its last value), else `dflt`.
 *  `words`, ruling PF-21's own addition: a fixed key -> stdout WORD, printed
 *  before the return, for the one consumer (`_codex_stop_tier`'s stub) that
 *  must answer a caller which now CAPTURES its stdout rather than discarding
 *  it — `_codex_stop_tier` itself returns rc 0 for BOTH "stopped" and
 *  "foreign", so only the printed word (never the rc) tells them apart. Every
 *  other caller of `recordingStub` passes no `words`, and gets none printed:
 *  this is additive, not a second shape. */
export function recordingStub(
  name: string, table: Readonly<Record<string, StubRc>> = {}, dflt = 0,
  words: Readonly<Record<string, string>> = {},
  // Review round 2, N2: a fake `_codex_tier_ours` that answers 2 (foreign)
  // must be able to set CX_TIER_WHY, the real function's own contract right
  // before it returns 2 — a stub that only returns the rc leaves every
  // `${CX_TIER_WHY:+…}`/`_codex_foreign_what` site unpinned (removing the
  // interpolation stays green, because nothing ever set the variable). Set
  // unconditionally per matching key: harmless on a call whose rc is not 2,
  // since nothing reads CX_TIER_WHY then.
  whys: Readonly<Record<string, string>> = {},
): string {
  const arms: string[] = [];
  for (const [key, v] of Object.entries(table)) {
    const k = key.replace(' ', '-');
    const seq: readonly number[] = typeof v === 'number' ? [v] : v;
    seq.forEach((rc, i) => { if (i < seq.length - 1) arms.push(`    ${k}:${i + 1}) return ${rc} ;;`); });
    arms.push(`    ${k}:*) return ${seq[seq.length - 1]} ;;`);
  }
  const wordArms: string[] = Object.entries(words)
    .map(([key, word]) => `    ${key.replace(' ', '-')}) printf '%s\\n' '${word}' ;;`);
  const whyArms: string[] = Object.entries(whys)
    .map(([key, why]) => `    ${key.replace(' ', '-')}) CX_TIER_WHY='${why}' ;;`);
  return [
    `${name}() {`,
    `  printf '%s %s %s\\n' ${name} "$1" "$2" >> "$HOME/calls"`,
    '  local k="$1-$2" n=0',
    ...(wordArms.length > 0 ? ['  case "$k" in', ...wordArms, '  esac'] : []),
    ...(whyArms.length > 0 ? ['  case "$k" in', ...whyArms, '  esac'] : []),
    `  [ -f "$HOME/n.${name}.$k" ] && n="$(cat "$HOME/n.${name}.$k")"`,
    `  n=$((n + 1)); printf '%s' "$n" > "$HOME/n.${name}.$k"`,
    '  case "$k:$n" in',
    ...arms,
    '  esac',
    `  return ${dflt}`,
    '}',
  ].join('\n');
}

/** Stand-ins for Task 5's `_codex_lock <id>` and `_codex_unlock`, the one
 *  per-lane lock and its ONLY release (ruling R19), for the spine steps measured
 *  in isolation. Both append to `$HOME/calls`, the log `recordingStub` writes,
 *  so the ORDER of a lane's lock, its questions and its release is one
 *  measurement.
 *  - `_codex_lock <id>` appends `_codex_lock <id>`, and `LOCK-STILL-HELD <fd>`
 *    when it is entered while `CX_LOCK_FD` still names a lock: a caller that
 *    never released the previous lane's. For an id in `refuse` it answers rc 1
 *    with one stderr line and `CX_LOCK_FD` empty. For an id in `noFlock` it
 *    answers rc 0 with `CX_LOCK_FD` and `CX_LOCK_ID` EMPTY, which is Task 5's
 *    answer on a box with no `flock`: nothing is held, and the caller runs
 *    unserialised. Otherwise it opens a REAL descriptor on `$HOME/lock.<id>`
 *    into `CX_LOCK_FD`, sets `CX_LOCK_ID`, and answers rc 0.
 *  - `_codex_unlock` appends `_codex_unlock <CX_LOCK_ID>` (`_codex_unlock -`
 *    when nothing is held), closes `CX_LOCK_FD` when it is set, clears both
 *    variables, and answers 0, as Task 5's does.
 *  A caller that closed the descriptor inline, rather than through
 *  `_codex_unlock`, leaves no `_codex_unlock` line and leaves `CX_LOCK_ID` set. */
export function lockStub(refuse: readonly string[] = [], noFlock: readonly string[] = []): string {
  return [
    '_codex_lock() {',
    '  printf \'%s %s\\n\' _codex_lock "$1" >> "$HOME/calls"',
    '  [ -z "${CX_LOCK_FD:-}" ] || printf \'LOCK-STILL-HELD %s\\n\' "$CX_LOCK_FD" >> "$HOME/calls"',
    `  case " ${refuse.join(' ')} " in *" $1 "*) echo "fixture _codex_lock: $1's lane lock is refused" >&2; return 1 ;; esac`,
    `  case " ${noFlock.join(' ')} " in *" $1 "*) return 0 ;; esac`,
    '  exec {CX_LOCK_FD}>>"$HOME/lock.$1"',
    '  CX_LOCK_ID="$1"',
    '}',
    '_codex_unlock() {',
    '  printf \'%s %s\\n\' _codex_unlock "${CX_LOCK_ID:--}" >> "$HOME/calls"',
    '  if [ -n "${CX_LOCK_FD:-}" ]; then exec {CX_LOCK_FD}>&-; fi',
    '  CX_LOCK_FD=\'\'; CX_LOCK_ID=\'\'',
    '  return 0',
    '}',
  ].join('\n');
}

// ── real-lane helpers (dynamic ports only; loopback only) ─────────────────
export interface LanePorts { id: string; proxyPort: number; litellmPort: number }

/** Two distinct free ports per id — the roster refuses a port used twice.
 *  Distinctness is Task 4's `freePorts`, never a second loop here. */
export async function freeLanes(ids: readonly string[]): Promise<LanePorts[]> {
  const ports = await freePorts(ids.length * 2);
  return ids.map((id, i) => ({ id, proxyPort: ports[2 * i]!, litellmPort: ports[2 * i + 1]! }));
}

// The port, wait and process helpers — `portAccepts`, `laneAnswer`,
// `eventually`, `alive`, `psArgs` — are Task 5's, above in this module: one
// definition each (ruling R30), never a second here.

/** The lane's authDir, absolute: a wrapper over Task 4's `codexAuthDir`
 *  (ruling R39), read back from the roster `codexRoster` wrote with it — never re-typed. */
export function authDirOf(home: string, id: string): string {
  const roster = JSON.parse(readFileSync(join(home, '.ccrc', 'accounts.json'), 'utf8')) as
    { accounts?: Array<{ id?: string; exec?: { authDir?: string } }> };
  const dir = roster.accounts?.find((a) => a.id === id)?.exec?.authDir;
  if (dir === undefined) throw new Error(`~/.ccrc/accounts.json names no authDir for ${id}`);
  return join(home, dir);
}

/** A synthetic credential at `authDirOf`'s path, so it too wraps Task 4's
 *  `codexAuthDir` (ruling R39): `ccrc codex start` checks EXISTENCE only. */
export function plantLaneAuth(home: string, id: string): void {
  const dir = authDirOf(home, id);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'auth.json'), '{"fixture": "test-token-not-a-secret"}\n', { mode: 0o600 });
}

/** The unit names the lane manifest carries — never re-derived from a pattern. */
export function laneUnits(home: string, id: string): { litellm: string; shim: string } {
  const lane = JSON.parse(readFileSync(join(home, '.ccrc', 'codex', id, 'lane.json'), 'utf8')) as
    { units?: { litellm?: string; shim?: string } };
  const { litellm, shim } = lane.units ?? {};
  if (litellm === undefined || shim === undefined) throw new Error(`lane.json for ${id} names no units`);
  return { litellm, shim };
}

// A loopback listener that is NOT a lane is Task 4's `spawnListener` — one
// definition, never a second here. `{ answer: 'text', lane: <id>, port: <the lane's shim
// port> }` is the OTHER repository's shim (`text/plain`, the bare id,
// m-tiers §1), a tracked child that `killLaneProcesses` ends.

// ════════════════════════════════════════════════════════════════════════
// Plan 3a Task 1 — the MODEL PROBE's runtime interpreter, and a stand-in
// Authenticator.
//
// `ccd/ccrc-models-probe`'s codex arm runs `<runtime python> -I -` with its
// program on stdin, importing `litellm.llms.chatgpt.authenticator`. The
// interpreter below is what a fake generation carries for it: plant it with
// `plantFakeRuntime(home, { python })`, or hand its path to the probe as
// CCRC_CODEX_PYTHON.
//   - Any argv but exactly `-I -` exits 90, so a probe that dropped `-I` reds.
//   - It runs THIS box's python3 on the program with the stand-in on
//     sys.path. `-I` ignores PYTHONPATH, so a wrapper program inserts it.
//   - An audit hook denies every socket connect and name lookup.
//   - The probe's one `urllib.request.urlopen` is answered from a recorded
//     catalogue file.
//   - Per run it records one JSON line: the CHATGPT_/LITELLM_/OPENAI_
//     environment plus CODEX_CLIENT_VERSION, every request's url and headers,
//     and every open() of a file named auth.json.
//
// The stand-in (`writeAuthStub`) follows litellm 1.101.0's get_access_token,
// read from that version's source: a usable token, a refresh, the cooldown
// wait (`_wait_for_access_token`), then the device flow (`_login_device_code`,
// which WRITES device_code_requested_at into auth.json before it prints a code
// and polls). Each device-side step here records a mark in `<rec>/device-flow`,
// makes that same auth.json write, and returns AT ONCE, so a guard that fails
// reds on the mark instead of hanging a suite. Its mode is `<rec>/mode`,
// default `token`, read at import.
//
// Two more modes, from fix round 1 of Plan 3a Task 1:
//   - `refresh-fails` is litellm's dead-refresh-token path: it LOGS a warning
//     carrying the token endpoint's answer through the `LiteLLM` logger, whose
//     handler here is a plain StreamHandler that bound sys.stderr at import
//     (an older litellm `_logging`'s shape, which contextlib.redirect_stderr
//     cannot reach), then falls through to the device flow;
//   - `no-get-account-id` is a litellm whose Authenticator has no
//     get_account_id.
// Every get_access_token call is recorded in `<rec>/asked` (`authAsks`).
// ════════════════════════════════════════════════════════════════════════

export type AuthStubMode =
  'token' | 'no-account-id' | 'device' | 'cooldown' | 'renamed' | 'refresh-fails' | 'no-get-account-id';

export interface ProbeRuntimeCall {
  env: Record<string, string>;
  requests: { url: string; headers: Record<string, string> }[];
  authOpens: string[];
}

export interface ProbeRuntime {
  /** The interpreter BODY: `plantFakeRuntime`'s `python` option, or a file to hand the probe. */
  python: string;
  /** Where each run is recorded, and where the stand-in reads its mode. */
  rec: string;
  /** The stand-in `litellm` package root. */
  stub: string;
}

const authStubSource = (rec: string): string => [
  '# A stand-in for litellm.llms.chatgpt.authenticator (codexLaneFixture.ts,',
  '# Plan 3a Task 1). NOT litellm: it models the one control flow the',
  '# unattended guard exists for, and nothing else.',
  'import json, logging, os, sys, time',
  `_REC = ${JSON.stringify(rec)}`,
  'try:',
  '    with open(os.path.join(_REC, "mode")) as _f:',
  '        MODE = _f.read().strip() or "token"',
  'except OSError:',
  '    MODE = "token"',
  'TOKEN = "test-token-not-a-secret"',
  '# litellm\'s own logger name, with a handler that binds sys.stderr NOW, at import.',
  '_LOG = logging.getLogger("LiteLLM")',
  '_LOG.addHandler(logging.StreamHandler(sys.stderr))',
  '',
  '',
  'class Authenticator:',
  '    def __init__(self):',
  '        self.token_dir = os.getenv("CHATGPT_TOKEN_DIR", os.path.expanduser("~/.config/litellm/chatgpt"))',
  '        self.auth_file = os.path.join(self.token_dir, os.getenv("CHATGPT_AUTH_FILE", "auth.json"))',
  '',
  '    def get_access_token(self):',
  '        # litellm 1.101.0 order: a usable token, a refresh, the cooldown wait, the device flow.',
  '        with open(os.path.join(_REC, "asked"), "a") as f:',
  '            f.write("get_access_token\\n")',
  '        if MODE in ("token", "no-account-id", "no-get-account-id"):',
  '            return TOKEN',
  '        if MODE == "refresh-fails":',
  '            # litellm logs the refresh failure, the endpoint\'s answer in it, and falls through.',
  '            _LOG.warning("ChatGPT refresh token failed, re-login required: %s",',
  '                         "Refresh response missing fields: {\'detail\': \'stand-in-token-endpoint-body\'}")',
  '        if MODE == "cooldown":',
  '            token = self._wait_for_access_token(300.0)',
  '            if token:',
  '                return token',
  '        login = self._login_device_code_v2 if MODE == "renamed" else self._login_device_code',
  '        return login()["access_token"]',
  '',
  '    def get_account_id(self):',
  '        if MODE == "no-account-id":',
  '            return None',
  '        return "acct-" + os.path.basename(self.token_dir)',
  '',
  '    def _login_device_code(self):',
  '        self._device_step("device-code")',
  '        print("Sign in with ChatGPT using device code:\\n2) Enter code: WXYZ-4321", flush=True)',
  '        return {"access_token": "device-token-not-a-secret"}',
  '',
  '    def _wait_for_access_token(self, timeout_seconds):',
  '        self._device_step("cooldown-wait")',
  '        return None',
  '',
  '    def _device_step(self, what):',
  '        with open(os.path.join(_REC, "device-flow"), "a") as f:',
  '            f.write(what + "\\n")',
  '        with open(self.auth_file, "w") as f:',
  '            json.dump({"device_code_requested_at": time.time()}, f)',
  '',
  '',
  'if MODE == "renamed":',
  '    # A litellm whose device flow moved to another name: a guard that only',
  '    # overrides the old name guards nothing.',
  '    Authenticator._login_device_code_v2 = Authenticator._login_device_code',
  '    del Authenticator._login_device_code',
  'if MODE == "no-get-account-id":',
  '    del Authenticator.get_account_id',
].join('\n') + '\n';

/** The stand-in package under `dir`, reading its mode from `<rec>/mode`. */
export function writeAuthStub(dir: string, rec: string): void {
  const pkg = path.join(dir, 'litellm', 'llms', 'chatgpt');
  mkdirSync(pkg, { recursive: true });
  mkdirSync(rec, { recursive: true });
  writeFileSync(path.join(dir, 'litellm', '__init__.py'), '# codexLaneFixture.ts stand-in (Plan 3a Task 1): NOT litellm\n');
  writeFileSync(path.join(dir, 'litellm', 'llms', '__init__.py'), '');
  writeFileSync(path.join(pkg, '__init__.py'), '');
  writeFileSync(path.join(pkg, 'authenticator.py'), authStubSource(rec));
}

export function setAuthStubMode(rec: string, mode: AuthStubMode): void {
  writeFileSync(path.join(rec, 'mode'), `${mode}\n`);
}

/** Every get_access_token call the stand-in answered. Empty: no token was asked. */
export const authAsks = (rec: string): string[] => lines(path.join(rec, 'asked'));
/** Each device-side step the stand-in took, in order. Empty is the guard holding. */
export const deviceFlowMarks = (rec: string): string[] => lines(path.join(rec, 'device-flow'));
/** The `$0` of every run of the probe-runtime interpreter. Empty: it never ran. */
export const probeArgv0 = (rec: string): string[] => lines(path.join(rec, 'argv0'));
export const probeRuntimeCalls = (rec: string): ProbeRuntimeCall[] =>
  lines(path.join(rec, 'calls.jsonl')).map((l) => JSON.parse(l) as ProbeRuntimeCall);

const PROBE_RUNTIME_WRAPPER = [
  'import atexit, json, os, sys, urllib.request',
  'sys.dont_write_bytecode = True',
  'stub, rec, answer = sys.argv[1], sys.argv[2], sys.argv[3]',
  'sys.argv = ["-"]',
  'sys.path.insert(0, stub)',
  'call = {"env": {k: v for k, v in os.environ.items()',
  '                if k.startswith(("CHATGPT_", "LITELLM_", "OPENAI_")) or k == "CODEX_CLIENT_VERSION"},',
  '        "requests": [], "authOpens": []}',
  'recording = [True]',
  '',
  '',
  'def _audit(event, args):',
  '    if not recording[0]:',
  '        return',
  '    if event in ("socket.connect", "socket.getaddrinfo"):',
  '        raise PermissionError("fixture probe runtime: no network under test")',
  '    if event == "open" and args and isinstance(args[0], str) and os.path.basename(args[0]) == "auth.json":',
  '        call["authOpens"].append(args[0])',
  '',
  '',
  'sys.addaudithook(_audit)',
  '',
  '',
  'def _dump():',
  '    recording[0] = False',
  '    with open(os.path.join(rec, "calls.jsonl"), "a") as f:',
  '        f.write(json.dumps(call) + "\\n")',
  '',
  '',
  'atexit.register(_dump)',
  '',
  '',
  'class _Answer:',
  '    def __init__(self, data):',
  '        self._data = data',
  '',
  '    def read(self):',
  '        return self._data',
  '',
  '',
  'def _urlopen(req, timeout=None):',
  '    call["requests"].append({"url": req.full_url,',
  '                             "headers": {k.lower(): v for k, v in req.header_items()}})',
  '    recording[0] = False',
  '    try:',
  '        with open(answer, "rb") as f:',
  '            return _Answer(f.read())',
  '    finally:',
  '        recording[0] = True',
  '',
  '',
  'urllib.request.urlopen = _urlopen',
  'exec(compile(sys.stdin.read(), "<stdin>", "exec"), {"__name__": "__main__"})',
].join('\n');

/** The model probe's fake runtime interpreter, recording under `<home>/probe-rec`,
 *  its stand-in Authenticator under `<home>/probe-stub`, answering the one
 *  catalogue request from `catalogueFile`. Throws on a box with no python3:
 *  guard the describe with `pythonOrSkip()`. */
export function probeRuntime(home: string, catalogueFile: string): ProbeRuntime {
  const py = pythonOrSkip();
  if (py === null) throw new Error('probeRuntime: no python3 on this box — guard the case with pythonOrSkip()');
  if (!fs.existsSync(catalogueFile)) throw new Error(`probeRuntime: ${catalogueFile} does not exist`);
  const rec = path.join(home, 'probe-rec');
  const stub = path.join(home, 'probe-stub');
  writeAuthStub(stub, rec);
  const python = [
    '#!/bin/sh',
    "# The model probe's fake runtime interpreter (codexLaneFixture.ts, Plan 3a Task 1). NOT a runtime.",
    'if [ "$#" -ne 2 ] || [ "$1" != -I ] || [ "$2" != - ]; then',
    '  echo "fixture probe runtime: unexpected argv: $*" >&2',
    '  exit 90',
    'fi',
    `printf '%s\\n' "$0" >> ${shq(path.join(rec, 'argv0'))}`,
    `exec ${shq(py)} -I -c ${shq(PROBE_RUNTIME_WRAPPER)} ${shq(stub)} ${shq(rec)} ${shq(catalogueFile)}`,
  ].join('\n') + '\n';
  return { python, rec, stub };
}

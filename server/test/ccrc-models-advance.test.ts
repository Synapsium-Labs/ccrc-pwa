// `ccrc models refresh`'s advance step (auto-advance spec §2.3; plan W2 Task 11), through `ccd/ccrc` SOURCED, the real
// `deploy/models-op.mjs` and `deploy/models-canary.mjs`, the fake lane proxy (a python child on 127.0.0.1 and a
// kernel-chosen port) and a recording `notify.sh` stub. Every case runs in a `mkTmp` HOME: nothing here reaches the live
// HOME, tmux, the session registry or a session unit. Neutral ids only: this repository is public.
//
// THE TIER QUESTION IS REDEFINED BY NAME, in a COPY of `ccd/ccrc`. The LANE_FAKES idiom of `ccrc-models.test.ts` appends
// its fakes to the shell that sources the file, and that no longer reaches the step's reads: each one is a fresh `bash`
// child that sources `ccd/ccrc` itself (`MODELS_ADVANCE_CHILD`), so a function defined only in the test's shell is not
// there. The fixture tree's `ccd/ccrc` is therefore the real file's bytes with the fakes appended AFTER its source
// guard (they define functions and nothing else), which every sourcing shell, the children included, then carries. The
// source pins below read the REAL file, never the copy. The bounded tier entry is exercised for real, against real
// listeners and stand-in tools, in its own describe.
import { describe, it, expect, afterEach } from 'vitest';
import { spawn, spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import fs from 'node:fs';
import path, { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkTmp } from './tmpHelpers.js';
import { ghContainedEnv } from './ccdWsHelpers.js';
import {
  MANAGER_STANDIN_MARK, assertManagerStandIns, ccrcFunction, codexAuthDir, eventually, freePort, killLaneProcesses,
  laneProxyAnswersAs, laneProxyGets, laneProxyMode, laneProxyParked, laneProxyProbeMode, laneProxyRelease,
  laneProxyRequests, spawnFakeLaneProxy, trackChild, type FakeLaneProxy,
} from './codexLaneFixture.js';
import { pythonOrSkip } from './ccgptHarness.js';
import { STEP_CATALOGUE, STEP_REGISTRY, stepAdvance, stepRaw, stepRoster } from './fixtures/advanceCases.js';
import { REASON_MAX } from '../../shared/model-advance.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(here, '..', '..');
const BASH = spawnSync('bash', ['-c', 'command -v bash'], { encoding: 'utf8' }).stdout.trim();
const PY = pythonOrSkip();
const HAS_FLOCK = spawnSync('bash', ['-c', 'command -v flock'], { encoding: 'utf8' }).status === 0;
const SYS_PATH = process.env['PATH'] ?? '/usr/bin:/bin';
const KEY = `sk-${randomBytes(24).toString('hex')}`;
const T = 90_000;

let home = '';
let proxy: FakeLaneProxy;

/** The lane library's tier question, redefined: it RETURNS (the real one never exits) the code in
 *  `<home>/fake/tier-<id>-<tier>`, else `<home>/fake/tier-<id>`, default 1 (not running), and logs each ask to
 *  `$HOME/lane-calls`. The bounded mode is the REAL wrapper's (`_codex_tier_read`: the fixed child, the strict
 *  deadline, the marker), whose child then asks THIS function the ordinary question. The stop and start are never
 *  reached on these paths (the first hour finds the tier down; every later hour finds its list unchanged); each logs,
 *  so a case that reached one shows it there. */
const FAKES = [
  '_codex_tier_ours() { case "${1:-}" in --bounded-read) _codex_tier_read "${2:-}" "${3:-}" "${4:-}"; return $?;; esac; '
    + 'printf \'ours %s %s\\n\' "$1" "$2" >> "$HOME/lane-calls"; '
    // A question that prints a verdict-shaped line and then never ends: what a reader that trusts the partial output of an
    // expired child would take for "ours, running".
    + '[ -f "$HOME/fake/hang-$1-$2" ] && { printf \'CX-VERDICT rc=0\' >&2; trap "" TERM; sleep 60; }; '
    + 'local k="$HOME/fake/tier-$1-$2" rc=1; '
    + '[ -f "$k" ] || k="$HOME/fake/tier-$1"; [ -f "$k" ] && rc="$(cat "$k")"; return "$rc"; }',
  // The check read, replaced by one that prints a WHOLE, valid answer and then never ends: what a reader that trusts the
  // partial output of an expired child would take for "the rendering is current".
  'eval "$(declare -f _models_adv_body_check | sed \'1s/^_models_adv_body_check /__real_adv_body_check /\')"',
  '_models_adv_body_check() { [ -f "$HOME/fake/check-hang" ] && { printf \'CHECK\\tunchanged\\nEND\\n\'; trap "" TERM; sleep 120; }; __real_adv_body_check "$@"; }',
  '_codex_stop_tier() { printf \'stop %s %s\\n\' "$1" "$2" >> "$HOME/lane-calls"; printf \'stopped\\n\'; }',
  '_codex_start_tier() { printf \'start %s %s\\n\' "$1" "$2" >> "$HOME/lane-calls"; return 0; }',
].join('\n');

/** A models-op stand-in: logs each call's op and flags (paths dropped) to `$HOME/op-calls`, hangs (ignoring TERM) for
 *  any op named in `OP_HANG`, then runs the REAL program in this very process. */
const OP_STUB = `#!/usr/bin/env node
import { appendFileSync } from 'node:fs';
const a = process.argv.slice(2);
appendFileSync(\`\${process.env.HOME}/op-calls\`, a.filter((x) => !x.includes('/')).join(' ') + '\\n');
if ((process.env.OP_HANG ?? '').split(',').includes(a[0])) {
  process.on('SIGTERM', () => {});
  await new Promise((r) => setTimeout(r, 150_000));
  process.exit(1);
}
if ((process.env.OP_GARBAGE ?? '') === a[0]) { process.stdout.write('not one object\\n'); process.exit(0); }
await import(${JSON.stringify(path.join(REPO, 'deploy', 'models-op.mjs'))});
`;

interface TreeOpts { canaryStub?: string; opStub?: string; realCcrc?: boolean }

/** `ccrc-models.test.ts`'s box: the tree `ccrc` resolves against, `deploy` and `shared` linked whole, with
 *  `deploy` a real directory of links when a stub replaces one of its files. A recording `notify.sh` stands in the
 *  session registry, where `_models_push` finds the hook. */
function installTree(h: string, roster: unknown, o: TreeOpts = {}): void {
  const ccd = join(h, 'ccrc', 'ccd');
  fs.mkdirSync(ccd, { recursive: true });
  for (const f of ['ccrc-wrapper-shape', 'ccrc-doctor-checks', 'ccrc-models-probe']) {
    fs.symlinkSync(join(REPO, 'ccd', f), join(ccd, f));
  }
  if (o.realCcrc === true) fs.symlinkSync(join(REPO, 'ccd', 'ccrc'), join(ccd, 'ccrc'));
  else fs.writeFileSync(join(ccd, 'ccrc'), `${fs.readFileSync(join(REPO, 'ccd', 'ccrc'), 'utf8')}\n# fixture fakes\n${FAKES}\n`);
  if (o.canaryStub === undefined && o.opStub === undefined) {
    fs.symlinkSync(join(REPO, 'deploy'), join(h, 'ccrc', 'deploy'));
  } else {
    const deploy = join(h, 'ccrc', 'deploy');
    fs.mkdirSync(deploy, { recursive: true });
    for (const f of fs.readdirSync(join(REPO, 'deploy'))) {
      if (f === 'models-canary.mjs' && o.canaryStub !== undefined) continue;
      if (f === 'models-op.mjs' && o.opStub !== undefined) continue;
      fs.symlinkSync(join(REPO, 'deploy', f), join(deploy, f));
    }
    if (o.canaryStub !== undefined) fs.writeFileSync(join(deploy, 'models-canary.mjs'), o.canaryStub, { mode: 0o755 });
    if (o.opStub !== undefined) fs.writeFileSync(join(deploy, 'models-op.mjs'), o.opStub, { mode: 0o755 });
  }
  fs.symlinkSync(join(REPO, 'shared'), join(h, 'ccrc', 'shared'));
  fs.mkdirSync(join(h, '.ccrc'), { recursive: true });
  fs.writeFileSync(join(h, '.ccrc', 'accounts.json'), `${JSON.stringify(roster, null, 2)}\n`);
  fs.mkdirSync(join(h, '.cc-sessions'), { recursive: true });
  fs.writeFileSync(join(h, '.cc-sessions', 'notify.sh'),
    '#!/bin/sh\nprintf \'%s\\t%s\\n\' "$1" "$2" >> "$HOME/notify-calls"\n', { mode: 0o755 });
}

/** `ccrc-models.test.ts`'s `env()`: nothing ambient steers a case, and the manager tools are stand-ins that refuse. */
function env(h: string, extra: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv {
  const inherited: NodeJS.ProcessEnv = { ...process.env };
  for (const k of ['CCRC_CODEX_PROBE_S', 'CCRC_CODEX_READY_S', 'CCGPT_CONFIG', 'CCRC_MODELS_CANARY_S',
    'CCRC_MODELS_ADVANCE_BUDGET_S', 'CCRC_MODELS_LOCK_S', 'CCRC_MODELS_NOW', 'CCRC_MODELS_PROBE_FIXTURE',
    'CCD_TIMEOUT_KILL_AFTER', 'MODELS_AUTO_DEADLINE', 'MODELS_AUTO_TAIL_S', 'CCD_TIMEOUT_CAPABILITY',
    '_CCD_TIMEOUT_PROVED_PATH', 'OP_HANG', 'OP_GARBAGE', 'BASH_ENV', 'ENV',
    'HTTP_PROXY', 'HTTPS_PROXY', 'ALL_PROXY', 'http_proxy', 'https_proxy', 'all_proxy', 'NODE_USE_ENV_PROXY']) {
    delete inherited[k];
  }
  const e = ghContainedEnv(h, { ...inherited, HOME: h, ...extra }, { systemd: true });
  const poison = (name: string, says: string): void =>
    fs.writeFileSync(join(h, '.local', 'bin', name),
      `#!/bin/sh\n${MANAGER_STANDIN_MARK}\nprintf '%s\\n' "$*" >> "$HOME/${name}-poison"\necho "${says}" >&2\nexit 97\n`,
      { mode: 0o755 });
  poison('curl', 'ccrc tests must never reach a real server');
  poison('systemctl', "ccrc tests must never query this box's real systemd");
  poison('systemd-run', "ccrc tests must never start a real transient unit on this box's systemd");
  poison('launchctl', "ccrc tests must never query this box's real launchd");
  poison('pgrep', 'ccrc tests must never reach a real pgrep');
  poison('ccgpt', 'ccrc tests must never reach a real ccgpt');
  assertManagerStandIns(e, h);
  return e;
}

/** A function called DIRECTLY, outside `cmd_models`, gets what `cmd_models` loads first: the shape contract, whose
 *  WRAPPER_ID_RE the lock and id helpers read. */
const SHAPE = '. "$CCRC_HERE/ccrc-wrapper-shape"';

interface Result { code: number; stdout: string; stderr: string }
const treeCcrc = (): string => join(home, 'ccrc', 'ccd', 'ccrc');
const script = (call: string, pre = ''): string =>
  ['umask 022', `. "${treeCcrc()}"`, pre, call].filter(Boolean).join('\n');
function sourced(call: string, extra: NodeJS.ProcessEnv = {}, pre = ''): Result {
  // A call that outlives 85 s is a red case, not a hung one: spawnSync blocks this worker, so vitest's own timeout could
  // not end it (the stalled-stage cases stall ~120 s on purpose, and only a missing deadline lets one run that long).
  const r = spawnSync(BASH, ['-c', script(call, pre)], { env: env(home, extra), encoding: 'utf8', input: '', timeout: 85_000 });
  return { code: r.status ?? -1, stdout: r.stdout ?? '', stderr: r.stderr ?? '' };
}
/** `sourced`, but asynchronous: the case acts while the refresh runs. Tracked, so `killLaneProcesses` ends it through
 *  its handle if the case fails. */
function sourcedAsync(call: string, extra: NodeJS.ProcessEnv = {}, pre = ''): Promise<Result> {
  const child = spawn(BASH, ['-c', script(call, pre)], { env: env(home, extra), stdio: ['ignore', 'pipe', 'pipe'] });
  trackChild(home, child);
  return new Promise((resolve) => {
    let stdout = '';
    let stderr = '';
    child.stdout!.on('data', (d: Buffer) => { stdout += d.toString(); });
    child.stderr!.on('data', (d: Buffer) => { stderr += d.toString(); });
    child.on('close', (code) => resolve({ code: code ?? -1, stdout, stderr }));
  });
}
const rawPath = (): string => join(home, 'raw-catalogue.json');
const refresh = (extra: NodeJS.ProcessEnv = {}, pre = ''): Result =>
  sourced('cmd_models refresh lane-a', { CCRC_MODELS_PROBE_FIXTURE: rawPath(), ...extra }, pre);
const refreshAsync = (extra: NodeJS.ProcessEnv = {}): Promise<Result> =>
  sourcedAsync('cmd_models refresh lane-a', { CCRC_MODELS_PROBE_FIXTURE: rawPath(), ...extra });

function oneObject(r: Result): Record<string, unknown> {
  const lines = r.stdout.split('\n');
  expect(lines[lines.length - 1], `stdout is not newline-terminated: ${JSON.stringify(r.stdout)}`).toBe('');
  expect(lines.length, `stdout carried ${lines.length - 1} lines, not one: ${r.stdout}${r.stderr}`).toBe(2);
  return JSON.parse(lines[0]!) as Record<string, unknown>;
}
const rowOf = (r: Result): Record<string, unknown> =>
  (oneObject(r)['refreshed'] as Record<string, unknown>[])[0]!;
/** The tier answer `rc`: for both tiers of `id`, or for `which` only. */
const tier = (rc: number, id = 'lane-a', which?: 'litellm' | 'shim'): void => {
  fs.mkdirSync(join(home, 'fake'), { recursive: true });
  fs.writeFileSync(join(home, 'fake', which === undefined ? `tier-${id}` : `tier-${id}-${which}`), `${rc}\n`);
};
const lines = (f: string): string[] =>
  fs.existsSync(join(home, f)) ? fs.readFileSync(join(home, f), 'utf8').split('\n').filter(Boolean) : [];
const laneCalls = (): string[] => lines('lane-calls');
const notifyCalls = (): string[] => lines('notify-calls');
const opCalls = (): string[] => lines('op-calls');
const models = (f: string): string => join(home, '.ccrc', 'models', f);
const classes = (): Record<string, string | null> =>
  (JSON.parse(fs.readFileSync(models('lane-a.classes.json'), 'utf8')) as { classes: Record<string, string | null> }).classes;
const advanceFile = (): { classes: Record<string, { history: Record<string, unknown>[] }>; pending: unknown } =>
  JSON.parse(fs.readFileSync(models('lane-a.advance.json'), 'utf8'));
const historyOf = (cls: string): Record<string, unknown>[] => advanceFile().classes[cls]!.history;
const settingsEnv = (): Record<string, string> =>
  (JSON.parse(fs.readFileSync(join(home, '.claude-lane-a', 'settings.json'), 'utf8')) as { env: Record<string, string> }).env;
/** The bytes of every file an advance writes. */
const snapshot = (): string[] => ['lane-a.classes.json', 'lane-a.advance.json', 'lane-a.classes.tsv', 'lane-a.effort.json']
  .map((f) => `${f} ${fs.readFileSync(models(f), 'utf8')}`)
  .concat(fs.readFileSync(join(home, '.claude-lane-a', 'settings.json'), 'utf8'));
const lockPathOf = (id = 'lane-a'): string => join(home, '.ccrc', 'locks', `models-${id}.lock`);
/** True when nothing holds the lane-files lock (a real `flock -n` on the lock file, taken and let go at once). */
const lockFree = (id = 'lane-a'): boolean =>
  spawnSync('flock', ['-n', lockPathOf(id), 'true'], { env: env(home) }).status === 0;
const bashStub = (dir: string, name: string, body: string): void => {
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(join(dir, name), `#!/bin/bash\n${body}\n`, { mode: 0o755 });
};
/** `fn` renamed to `__orig_<fn>` and redefined to run `before` ahead of it and `after` once it has returned. */
const wrap = (fn: string, o: { before?: string; after?: string }): string =>
  `eval "$(declare -f ${fn} | sed '1s/^${fn} /__orig_${fn} /')"\n`
  + `${fn}() { ${o.before ?? ':'}; __orig_${fn} "$@"; local __wrc=$?; ${o.after ?? ':'}; return $__wrc; }`;
/** Appends each call of `fn` (its arguments) to `$HOME/<file>`. */
const spy = (fn: string, file: string, fields = '"$*"'): string => wrap(fn, { before: `printf '%s\\n' ${fields} >> "$HOME/${file}"` });

/** A fixture HOME with lane-a on the fake proxy's port, its registry, its advance file and its key, then THE FIRST
 *  HOUR: a refresh that probes the neutral catalogue, materialises, renders the LiteLLM list (the tier answers 1, so
 *  nothing is stopped or started) and, its tier down, waits. With `laneB`, lane-b is a second codex-kind lane on ports
 *  of its own (and no registry yet). The first hour runs with the step off, so it never needs the second pass. */
async function setup(o: { registry?: unknown; advance?: unknown; laneB?: boolean } & TreeOpts = {}): Promise<void> {
  home = mkTmp('ccrc-models-advance-');
  proxy = await spawnFakeLaneProxy(home);
  const laneB = o.laneB === true
    ? { proxyPort: await freePort(), litellmPort: await freePort(), authDir: codexAuthDir('lane-b') } : undefined;
  installTree(home, stepRoster({ proxyPort: proxy.port, litellmPort: await freePort(), authDir: codexAuthDir('lane-a') },
    laneB), o);
  env(home);
  fs.mkdirSync(join(home, '.ccrc', 'models'), { recursive: true });
  fs.writeFileSync(models('lane-a.classes.json'), `${JSON.stringify(o.registry ?? STEP_REGISTRY, null, 2)}\n`, { mode: 0o600 });
  if (o.advance !== null) {
    fs.writeFileSync(models('lane-a.advance.json'), `${JSON.stringify(o.advance ?? stepAdvance(), null, 2)}\n`, { mode: 0o600 });
  }
  fs.writeFileSync(rawPath(), JSON.stringify(stepRaw(STEP_CATALOGUE)));
  const lane = join(home, '.ccrc', 'codex', 'lane-a');
  fs.mkdirSync(lane, { recursive: true, mode: 0o700 });
  fs.writeFileSync(join(lane, 'runtime.env'), `LITELLM_MASTER_KEY=${KEY}\n`, { mode: 0o600 });
  const first = refresh({ CCRC_MODELS_ADVANCE_BUDGET_S: '0' });
  expect(first.code, first.stdout + first.stderr).toBe(0);
  expect(rowOf(first)).not.toHaveProperty('advance');
  fs.rmSync(join(home, 'lane-calls'), { force: true });
  fs.rmSync(join(home, 'op-calls'), { force: true });
}

/** The registry of a lane whose automatic move of `cls` was cut short after the rename, and the intent on disk: the
 *  crash gap, which the lane's next locked writer settles. `classesOver` is spread over the registry's classes first. */
function plantLandedIntent(o: { cls?: string; from?: string; to?: string; effortFrom?: string; effortTo?: string;
  classesOver?: Record<string, string | null> } = {}): void {
  const cls = o.cls ?? 'opus';
  const to = o.to ?? 'model-6.1-gamma';
  fs.writeFileSync(models('lane-a.classes.json'), `${JSON.stringify({ ...STEP_REGISTRY,
    classes: { ...STEP_REGISTRY.classes, ...(o.classesOver ?? {}), [cls]: to },
    effort: { ...STEP_REGISTRY.effort, [cls]: o.effortTo ?? 'xhigh' } }, null, 2)}\n`);
  fs.writeFileSync(models('lane-a.advance.json'), `${JSON.stringify(stepAdvance({}, { class: cls,
    from: o.from ?? 'model-5.6-gamma', to, effortFrom: o.effortFrom ?? 'max', effortTo: o.effortTo ?? 'xhigh',
    at: '2026-10-22T09:05:11Z' }), null, 2)}\n`);
}

const MOVED = { class: 'opus', from: 'model-5.6-gamma', to: 'model-6.1-gamma', outcome: 'moved' };
const QUIET_ROW = { id: 'lane-a', probe: 'codex', ok: true, count: STEP_CATALOGUE.models.length, litellm: 'unchanged' };
const BOTH_TIERS = ['ours lane-a litellm', 'ours lane-a shim'];
/** A canary stand-in that logs its call to `lane-calls` and answers not-ready. */
const LOGGING_CANARY = '#!/usr/bin/env node\n'
  + "import { appendFileSync } from 'node:fs';\n"
  + 'const a = process.argv.slice(2);\n'
  + "appendFileSync(`${process.env.HOME}/lane-calls`, `canary ${a[a.indexOf('--id') + 1]} ${a[a.indexOf('--model') + 1]}\\n`);\n"
  + "process.stdout.write(JSON.stringify({ ok: true, op: 'canary', result: 'not-ready', status: null, reason: null }) + '\\n');\n";
/** The step's own entry points, called directly with a deadline `n` seconds from now. */
const lane = (n: number | string, id = 'lane-a'): string => `${SHAPE}\n_models_advance_lane ${id} "$(( SECONDS + ${n} ))"`;

afterEach(async () => {
  if (home === '') return;
  await killLaneProcesses(home);
  fs.rmSync(home, { recursive: true, force: true });
  home = '';
});

// Every case here needs the step to run, so a box with no `flock` (where it does nothing, D-5201) reports them skipped,
// not red.
describe.skipIf(PY === null || !HAS_FLOCK)('the advance step in the hourly refresh (auto-advance spec §2.3; plan W2 Task 11)', () => {
  it('a running tier and a 200: the class moves, the row carries one moved event, and one push goes out', async () => {
    await setup();
    tier(0);
    const r = refresh();
    expect(r.code, r.stdout + r.stderr).toBe(0);
    expect(rowOf(r)).toEqual({ ...QUIET_ROW, advance: [MOVED] });
    expect(classes()['opus']).toBe('model-6.1-gamma');
    expect(laneProxyRequests(proxy).map((q) => q.model)).toEqual(['model-6.1-gamma']);
    expect(notifyCalls()).toEqual(['--push\tlane-a: opus model-5.6-gamma → model-6.1-gamma']);
    expect(laneCalls()).toEqual(BOTH_TIERS);
    // The next hour moves nothing, and its row is exactly the row of a refresh with no event.
    const again = refresh();
    expect(rowOf(again)).toEqual(QUIET_ROW);
    expect(laneProxyRequests(proxy)).toHaveLength(1);
  }, T);

  it.each([[4, 'ours and starting'], [1, 'down'], [2, 'foreign'], [3, 'cannot be asked']] as [number, string][])(
    'a LiteLLM tier that answers %i (%s) waits silently: no canary, no history, no push, no advance key', async (rc) => {
      await setup();
      tier(0);
      tier(rc, 'lane-a', 'litellm');
      const r = refresh();
      expect(r.code, r.stdout + r.stderr).toBe(0);
      expect(rowOf(r)).toEqual(QUIET_ROW);
      expect(laneProxyGets(proxy)).toEqual([]);
      expect(laneProxyRequests(proxy)).toEqual([]);
      expect(historyOf('opus')).toEqual([]);
      expect(notifyCalls()).toEqual([]);
      expect(laneCalls()).toEqual(['ours lane-a litellm']);
    }, T);

  it.each([[2, 'foreign, or another lane'], [1, 'down'], [4, 'starting']] as [number, string][])(
    'a shim that answers %i (%s) while LiteLLM runs waits silently, and nothing reaches the proxy port', async (rc) => {
      // Review Focus: the canary hands the lane key to whatever listens on the shim's port, so the shim must prove it is
      // this lane's first (D-5210).
      await setup();
      tier(0, 'lane-a', 'litellm');
      tier(rc, 'lane-a', 'shim');
      const r = refresh();
      expect(r.code, r.stdout + r.stderr).toBe(0);
      expect(rowOf(r)).toEqual(QUIET_ROW);
      expect(laneProxyGets(proxy)).toEqual([]);
      expect(laneProxyRequests(proxy)).toEqual([]);
      expect(notifyCalls()).toEqual([]);
      expect(laneCalls()).toEqual(BOTH_TIERS);
    }, T);

  it('a 500 records one failed entry and one push; the next hour adds an event but no push, and tries 2', async () => {
    await setup();
    tier(0);
    laneProxyMode(proxy, '500');
    const failed = { class: 'opus', from: 'model-5.6-gamma', to: 'model-6.1-gamma', outcome: 'failed',
      reason: 'http 500: upstream error' };
    const r1 = refresh();
    expect(r1.code, 'a failed canary keeps the unit green').toBe(0);
    expect(rowOf(r1)).toEqual({ ...QUIET_ROW, advance: [failed] });
    expect(notifyCalls()).toEqual(
      ['--push\tlane-a: opus stays on model-5.6-gamma: model-6.1-gamma failed its canary (http 500: upstream error)']);
    const r2 = refresh();
    expect(r2.code).toBe(0);
    expect(rowOf(r2)).toEqual({ ...QUIET_ROW, advance: [failed] });
    expect(notifyCalls()).toHaveLength(1);
    expect(historyOf('opus')).toEqual([expect.objectContaining({ ok: false, tries: 2 })]);
    expect(classes()['opus']).toBe('model-5.6-gamma');
  }, T);

  it.each([
    ['a D-4933 refused-connect 502', '502-refused', {}],
    ['a canary past its own deadline', 'hang', { CCRC_MODELS_CANARY_S: '2' }],
  ] as [string, '502-refused' | 'hang', NodeJS.ProcessEnv][])('%s waits silently', async (_w, mode, extra) => {
    await setup();
    tier(0);
    laneProxyMode(proxy, mode);
    const r = refresh(extra);
    expect(r.code, r.stdout + r.stderr).toBe(0);
    expect(rowOf(r)).toEqual(QUIET_ROW);
    expect(laneProxyRequests(proxy)).toHaveLength(1);
    expect(historyOf('opus')).toEqual([]);
    expect(notifyCalls()).toEqual([]);
  }, T);

  it('a canary that refuses its own arguments is unavailable: no failed entry and no push', async () => {
    // D-5218: a value the canary cannot carry is a lane state, never a fact about the model.
    const refuses = '#!/usr/bin/env node\n'
      + "process.stdout.write(JSON.stringify({ ok: false, error: 'bad-argv', detail: 'x' }) + '\\n',\n"
      + '  () => process.exit(2));\n';
    await setup({ canaryStub: refuses });
    tier(0);
    const r = refresh();
    expect(r.code, r.stdout + r.stderr).toBe(0);
    expect(rowOf(r)).toEqual(QUIET_ROW);
    expect(historyOf('opus')).toEqual([]);
    expect(notifyCalls()).toEqual([]);
  }, T);

  it('a Hold tapped while the canary is parked leaves the class unmoved', async () => {
    // Review Focus (races and locks): the canary runs outside the lane-files lock, so the hold verb takes the lock at
    // once; the commit's re-check then finds it.
    await setup();
    tier(0);
    laneProxyMode(proxy, 'park');
    const run = refreshAsync();
    await eventually(() => laneProxyParked(proxy) >= 1, 'the parked canary', 30_000);
    const held = sourced('cmd_models lane-a hold opus');
    expect(held.code, held.stdout + held.stderr).toBe(0);
    laneProxyRelease(proxy);
    const r = await run;
    expect(r.code, r.stdout + r.stderr).toBe(0);
    expect(rowOf(r)).toEqual({ ...QUIET_ROW,
      advance: [{ class: 'opus', from: 'model-5.6-gamma', to: 'model-6.1-gamma', outcome: 'abandoned', why: 'held' }] });
    expect(classes()['opus']).toBe('model-5.6-gamma');
    expect(notifyCalls()).toEqual([]);
  }, T);

  it('a manual refresh overlapping the timer: the second commit abandons, and one push goes out', async () => {
    // Review Focus (races and locks): both canary the same candidate; the lane-files lock serialises the two commits, and
    // the second finds the pin moved and writes nothing.
    await setup();
    tier(0);
    laneProxyMode(proxy, 'park');
    const timer = refreshAsync();
    const manual = refreshAsync();
    await eventually(() => laneProxyParked(proxy) >= 2, 'both canaries parked', 30_000);
    laneProxyRelease(proxy);
    const rows = [rowOf(await timer), rowOf(await manual)];
    expect(rows.map((row) => row['advance'])).toEqual(expect.arrayContaining([
      [MOVED],
      [{ class: 'opus', from: 'model-5.6-gamma', to: 'model-6.1-gamma', outcome: 'abandoned', why: 'pin-moved' }],
    ]));
    expect(classes()['opus']).toBe('model-6.1-gamma');
    expect(historyOf('opus')).toEqual([expect.objectContaining({ ok: true, to: 'model-6.1-gamma' })]);
    expect(notifyCalls()).toHaveLength(1);
  }, T);

  it('a class held before the run gets no canary; released, the next hour advances it, canary first', async () => {
    // Spec §2.7: turning Hold off lets the next hour advance, canary first.
    await setup();
    tier(0);
    expect(sourced('cmd_models lane-a hold opus').code).toBe(0);
    expect(rowOf(refresh())).toEqual(QUIET_ROW);
    expect(laneProxyRequests(proxy)).toEqual([]);
    expect(laneCalls(), 'no unheld candidate, so the tier is never asked').toEqual([]);
    expect(sourced('cmd_models lane-a release opus').code).toBe(0);
    expect(rowOf(refresh())).toEqual({ ...QUIET_ROW, advance: [MOVED] });
    expect(laneProxyRequests(proxy).map((q) => q.model)).toEqual(['model-6.1-gamma']);
  }, T);

  it('an unreadable windows file sends no canary: the plan blocks its candidate', async () => {
    await setup();
    tier(0);
    fs.writeFileSync(models('lane-a.windows.json'), '{ not json');
    const r = refresh();
    expect(r.code, r.stdout + r.stderr).toBe(0);
    expect(rowOf(r)).toEqual(QUIET_ROW);
    expect(laneProxyRequests(proxy)).toEqual([]);
    expect(laneCalls()).toEqual([]);
  }, T);

  it('a class emptied by hand stays empty through every later hour', async () => {
    // Review Focus (a class the operator emptied by hand).
    await setup({
      registry: { ...STEP_REGISTRY, classes: { ...STEP_REGISTRY.classes, opus: 'model-6.1-gamma' },
        effort: { haiku: 'high', sonnet: 'high', opus: 'xhigh' } },
      advance: stepAdvance({ fable: { family: 'delta' } }),
    });
    tier(0);
    // The control: an empty class whose family is stored fills, canary first.
    expect(rowOf(refresh())['advance']).toEqual([{ class: 'fable', from: null, to: 'model-6-delta', outcome: 'moved' }]);
    const emptied = sourced('cmd_models lane-a set-class fable none');
    expect(emptied.code, emptied.stdout + emptied.stderr).toBe(0);
    for (const hour of [1, 2, 3]) {
      expect(rowOf(refresh()), `hour ${hour}`).toEqual(QUIET_ROW);
      expect(classes()['fable'], `hour ${hour}`).toBeNull();
    }
    expect(laneProxyRequests(proxy).map((q) => q.model)).toEqual(['model-6-delta']);
  }, T);

  it('a move cut short between the registry rename and materialise is settled by the next refresh, recorded and pushed once', async () => {
    // Review Focus (the crash gap): a SIGTERM at the unit's 300 s bound after the rename left the registry on the new
    // model, the intent on disk and the lane's files old. The moved class has no candidate now, and neither has any
    // other: the backfill, the hourly step's first locked writer, settles it. The tier is never asked.
    await setup();
    fs.writeFileSync(models('lane-a.classes.json'), `${JSON.stringify({ ...STEP_REGISTRY,
      classes: { ...STEP_REGISTRY.classes, opus: 'model-6.1-gamma' },
      effort: { ...STEP_REGISTRY.effort, opus: 'xhigh' } }, null, 2)}\n`);
    fs.writeFileSync(models('lane-a.advance.json'), `${JSON.stringify(stepAdvance({}, { class: 'opus',
      from: 'model-5.6-gamma', to: 'model-6.1-gamma', effortFrom: 'max', effortTo: 'xhigh',
      at: '2026-10-22T09:05:11Z' }), null, 2)}\n`);
    expect(settingsEnv()['ANTHROPIC_DEFAULT_OPUS_MODEL']).toBe('model-5.6-gamma');
    const r = refresh();
    expect(r.code, r.stdout + r.stderr).toBe(0);
    expect(rowOf(r)).toEqual({ ...QUIET_ROW, advance: [{ ...MOVED, recovered: true }] });
    expect(advanceFile().pending).toBeNull();
    expect(historyOf('opus')).toEqual([expect.objectContaining({ ok: true, recovered: true, to: 'model-6.1-gamma' })]);
    expect(notifyCalls()).toEqual(['--push\tlane-a: opus model-5.6-gamma → model-6.1-gamma']);
    // The refresh's own materialise healed the lane's files; no canary went out.
    expect(settingsEnv()['ANTHROPIC_DEFAULT_OPUS_MODEL']).toBe('model-6.1-gamma');
    expect(laneProxyRequests(proxy)).toEqual([]);
    expect(laneCalls()).toEqual([]);
    // Settled once: the next hour is quiet, and pushes nothing.
    expect(rowOf(refresh())).toEqual(QUIET_ROW);
    expect(notifyCalls()).toHaveLength(1);
  }, T);

  it.each([
    ['set to a model', null, 'model-6-delta', null, 'delta'],
    ['emptied', 'model-6-delta', null, 'delta', null],
  ] as [string, string | null, string | null, string | null, string | null][])(
    'a hand set-class cut short after its registry rename (%s) is settled by the next refresh as hand: no event, no push, the class as the operator left it', async (_w, from, to, familyBefore, familyAfter) => {
      // Review Focus (the crash gap, a hand set-class cut short; a class the operator emptied by hand stays empty). W1's
      // set-class writes its intent before the rename (D-5188); the hourly backfill, the step's first locked writer,
      // settles it. A hand move is the operator's own act: never a `moved` event, never a push (D-5216).
      const HAND_AT = '2026-10-22T09:05:11Z';
      // Every other class on its family's newest model, so the only class a refresh could move is fable.
      const current = { ...STEP_REGISTRY, classes: { ...STEP_REGISTRY.classes, opus: 'model-6.1-gamma' },
        effort: { haiku: 'high', sonnet: 'high', opus: 'xhigh' } };
      await setup({ registry: { ...current, classes: { ...current.classes, fable: from } },
        advance: stepAdvance({ fable: { family: familyBefore } }) });
      tier(0);
      // `ccrc models lane-a set-class fable …`, stopped after its registry rename.
      fs.writeFileSync(models('lane-a.classes.json'),
        `${JSON.stringify({ ...current, classes: { ...current.classes, fable: to } }, null, 2)}\n`);
      fs.writeFileSync(models('lane-a.advance.json'), `${JSON.stringify(stepAdvance({ fable: { family: familyBefore } },
        { how: 'hand', class: 'fable', from, to, emptied: [], at: HAND_AT }), null, 2)}\n`);
      for (const hour of [1, 2]) {
        expect(rowOf(refresh()), `hour ${hour}`).toEqual(QUIET_ROW);
        expect(classes()['fable'], `hour ${hour}`).toBe(to);
      }
      expect(advanceFile().pending).toBeNull();
      expect(historyOf('fable')).toEqual([{ at: HAND_AT, how: 'hand', from, to, ok: true, canary: 'not-run' }]);
      expect(advanceFile().classes.fable).toMatchObject({ family: familyAfter, previous: null });
      expect(notifyCalls()).toEqual([]);
      expect(laneProxyRequests(proxy)).toEqual([]);
    }, T);

  it('a budget of 0 turns the step off: no backfill, no plan, no tier question', async () => {
    await setup();
    tier(0);
    fs.rmSync(models('lane-a.advance.json'));
    const r = refresh({ CCRC_MODELS_ADVANCE_BUDGET_S: '0' }, spy('_models_advance_lane', 'adv-calls', '"$2"'));
    expect(r.code, r.stdout + r.stderr).toBe(0);
    expect(rowOf(r)).toEqual(QUIET_ROW);
    expect(lines('adv-calls'), 'a lane was entered with a budget of 0').toEqual([]);
    expect(fs.existsSync(models('lane-a.advance.json'))).toBe(false);
    expect(laneCalls()).toEqual([]);
    expect(laneProxyRequests(proxy)).toEqual([]);
  }, T);

  it("the advance step runs after every lane's refresh, so a canary never delays another lane's LiteLLM render", async () => {
    // D-5213: lane-b's render (its first, so its list changes and its tier is asked) comes before lane-a's canary.
    await setup({ canaryStub: LOGGING_CANARY, laneB: true });
    fs.writeFileSync(models('lane-b.classes.json'), `${JSON.stringify(STEP_REGISTRY, null, 2)}\n`, { mode: 0o600 });
    fs.mkdirSync(join(home, '.ccrc', 'codex', 'lane-b'), { recursive: true, mode: 0o700 });
    tier(0);
    const r = sourced('cmd_models refresh --all', { CCRC_MODELS_PROBE_FIXTURE: rawPath() });
    expect(r.code, r.stdout + r.stderr).toBe(0);
    const calls = laneCalls();
    const render = calls.indexOf('ours lane-b litellm');
    const canaryAt = calls.indexOf('canary lane-a model-6.1-gamma');
    expect(render, calls.join(' | ')).toBeGreaterThanOrEqual(0);
    expect(canaryAt, calls.join(' | ')).toBeGreaterThan(render);
  }, T);

  it('a lane-files lock held past its bound at commit abandons lock-busy, and writes nothing', async () => {
    await setup();
    tier(0);
    laneProxyMode(proxy, 'park');
    const run = refreshAsync({ CCRC_MODELS_LOCK_S: '1' });
    await eventually(() => laneProxyParked(proxy) >= 1, 'the parked canary', 30_000);
    const lockPath = sourced(`${SHAPE}\n_models_lock_path lane-a`).stdout.trim();
    expect(lockPath, 'W1 spells the lane-files lock path once, in _models_lock_path').toMatch(/models-lane-a\.lock$/);
    const heldFile = join(home, 'lock-held');
    const holder = spawn(BASH, ['-c', 'exec 9>>"$1" && flock -x 9 && : > "$2" && exec sleep 30', '_', lockPath, heldFile],
      { stdio: 'ignore', env: { PATH: SYS_PATH, HOME: home } });
    trackChild(home, holder);
    await eventually(() => fs.existsSync(heldFile), 'the outside holder took the lane-files lock');
    const before = snapshot();
    laneProxyRelease(proxy);
    const r = await run;
    expect(r.code, r.stdout + r.stderr).toBe(0);
    expect(rowOf(r)['advance']).toEqual(
      [{ class: 'opus', from: 'model-5.6-gamma', to: 'model-6.1-gamma', outcome: 'abandoned', why: 'lock-busy' }]);
    expect(snapshot()).toEqual(before);
    expect(notifyCalls()).toEqual([]);
  }, T);

  it('a stale LiteLLM list waits silently: both tiers are asked once and no canary goes out', async () => {
    await setup();
    tier(0);
    fs.writeFileSync(join(home, '.ccrc', 'codex', 'lane-a', 'litellm.yaml'), 'model_list: []\n');
    const r = sourced(lane(250));
    expect(r.code, r.stderr).toBe(0);
    expect(JSON.parse(r.stdout)).toEqual([]);
    expect(laneProxyRequests(proxy)).toEqual([]);
    expect(laneCalls()).toEqual(BOTH_TIERS);
  }, T);

  it('an advance-plan answer that is not one object ends the lane with no event, and stdout stays one object', async () => {
    await setup({ opStub: OP_STUB });
    tier(0);
    const r = refresh({ OP_GARBAGE: 'advance-plan' });
    expect(r.code, r.stdout + r.stderr).toBe(0);
    expect(rowOf(r)).toEqual(QUIET_ROW);
    expect(laneProxyRequests(proxy)).toEqual([]);
    expect(opCalls().some((l) => l.startsWith('advance-backfill'))).toBe(false);
  }, T);

  it('a materialise that fails after a passed canary, and whose restore fails too, makes the row ok:false', async () => {
    await setup();
    tier(0);
    laneProxyMode(proxy, 'park');
    const run = refreshAsync();
    await eventually(() => laneProxyParked(proxy) >= 1, 'the parked canary', 30_000);
    fs.rmSync(models('lane-a.classes.tsv'));
    fs.mkdirSync(models('lane-a.classes.tsv'));
    laneProxyRelease(proxy);
    const r = await run;
    expect(r.code).toBe(1);
    const row = rowOf(r);
    expect(row).toMatchObject({ id: 'lane-a', ok: false,
      advance: [expect.objectContaining({ class: 'opus', outcome: 'failed', restored: false })] });
    expect(String(row['reason'])).toMatch(/re-materialising the previous registry failed too/);
    expect(classes()['opus']).toBe('model-5.6-gamma');
    expect(notifyCalls()).toEqual([expect.stringMatching(
      /^--push\tlane-a: opus stays on model-5\.6-gamma: moving to model-6\.1-gamma failed \(materialise failed/)]);
  }, T);

  it('bash hands the canary no key: not in its argv, not in its environment', async () => {
    const sees = '#!/usr/bin/env node\n'
      + "import { readFileSync, writeFileSync } from 'node:fs';\n"
      + 'const home = process.env.HOME;\n'
      + "const key = /LITELLM_MASTER_KEY=(\\S+)/.exec(readFileSync(`${home}/.ccrc/codex/lane-a/runtime.env`, 'utf8'))[1];\n"
      + 'writeFileSync(`${home}/canary-seen.json`, JSON.stringify({ argv: process.argv.slice(2),\n'
      + '  argvHasKey: process.argv.some((a) => a.includes(key)),\n'
      + "  envHasKey: Object.values(process.env).some((v) => typeof v === 'string' && v.includes(key)) }));\n"
      + "process.stdout.write(JSON.stringify({ ok: true, op: 'canary', result: 'not-ready', status: null, reason: null }) + '\\n');\n";
    await setup({ canaryStub: sees });
    tier(0);
    expect(rowOf(refresh())).toEqual(QUIET_ROW);
    expect(JSON.parse(fs.readFileSync(join(home, 'canary-seen.json'), 'utf8'))).toEqual({
      argv: ['--id', 'lane-a', '--model', 'model-6.1-gamma', '--effort', 'low', '--timeout-s', '90'],
      argvHasKey: false, envHasKey: false,
    });
  }, T);

  it('a reason that starts with dashes reaches the commit without them, at most REASON_MAX characters', async () => {
    const dashes = '#!/usr/bin/env node\n'
      + "process.stdout.write(JSON.stringify({ ok: true, op: 'canary', result: 'failed', status: 500, "
      + `reason: '--' + 'y'.repeat(${REASON_MAX + 100}) }) + '\\n');\n`;
    await setup({ canaryStub: dashes });
    tier(0);
    const ev = (rowOf(refresh())['advance'] as Record<string, unknown>[])[0]!;
    expect(ev).toMatchObject({ class: 'opus', outcome: 'failed', reason: 'y'.repeat(REASON_MAX) });
  }, T);
});

// These need no `flock`: one simulates its absence, the others never reach the lock.
describe.skipIf(PY === null)('the advance step where it must do nothing (plan W2 Task 11)', () => {
  it('with no flock the step does nothing: no canary, no move', async () => {
    await setup();
    tier(0);
    const noFlock = 'command() { if [ "${1:-}" = -v ] && [ "${2:-}" = flock ]; then return 1; fi; builtin command "$@"; }';
    const r = refresh({}, noFlock);
    expect(r.code, r.stdout + r.stderr).toBe(0);
    expect(rowOf(r)).toEqual(QUIET_ROW);
    expect(laneProxyRequests(proxy)).toEqual([]);
    expect(classes()['opus']).toBe('model-5.6-gamma');
    expect(laneCalls()).toEqual([]);
  }, T);

  it('an external-kind lane is never asked the tier question and gets no event (RB6: the step invoked directly)', async () => {
    // A WHOLE refresh on an external-kind lane is refused (`not-codex-kind`), so the step's own gate is what this
    // measures, called directly: it ends at the plan read, before any locked call, any tier question or any canary.
    await setup({ opStub: OP_STUB });
    fs.writeFileSync(models('lane-b.classes.json'), `${JSON.stringify(STEP_REGISTRY, null, 2)}\n`, { mode: 0o600 });
    fs.writeFileSync(models('lane-b.json'), JSON.stringify(STEP_CATALOGUE));
    tier(0, 'lane-b');
    const r = sourced(lane(250, 'lane-b'));
    expect(r.code, r.stderr).toBe(0);
    expect(JSON.parse(r.stdout)).toEqual([]);
    expect(laneCalls()).not.toContain('ours lane-b litellm');
    expect(laneProxyRequests(proxy)).toEqual([]);
    expect(opCalls().map((l) => l.split(' ')[0])).toEqual(['advance-plan']);
    expect(fs.existsSync(models('lane-b.advance.json')), 'the backfill ran for a lane the step does not act on').toBe(false);
    expect(fs.existsSync(lockPathOf('lane-b'))).toBe(false);
  }, T);

  it('RB6: a whole refresh of an external-kind lane exits not-codex-kind and never reaches the step', async () => {
    await setup({ opStub: OP_STUB });
    fs.writeFileSync(models('lane-b.classes.json'), `${JSON.stringify(STEP_REGISTRY, null, 2)}\n`, { mode: 0o600 });
    tier(0, 'lane-b');
    const r = sourced('cmd_models refresh lane-b', { CCRC_MODELS_PROBE_FIXTURE: rawPath() });
    expect(r.code, r.stdout + r.stderr).toBe(1);
    expect(rowOf(r)).toMatchObject({ id: 'lane-b', ok: false });
    expect(rowOf(r)).not.toHaveProperty('advance');
    expect(String(rowOf(r)['reason'])).toMatch(/not exec\.kind "codex"|not-codex-kind/);
    expect(opCalls().some((l) => l.startsWith('advance-'))).toBe(false);
  }, T);

  it('RB5: where ~/.ccrc/locks is absent and mkdir is unavailable, the step skips the lane before any locked call', async () => {
    await setup({ opStub: OP_STUB });
    tier(0);
    expect(fs.existsSync(join(home, '.ccrc', 'locks')), 'the first hour already made the lock directory').toBe(true);
    fs.rmSync(join(home, '.ccrc', 'locks'), { recursive: true, force: true });
    const noMkdir = 'command() { if [ "${1:-}" = -v ] && [ "${2:-}" = mkdir ]; then return 1; fi; builtin command "$@"; }';
    const r = sourced(lane(250), {}, noMkdir);
    expect(r.code, r.stderr).toBe(0);
    expect(JSON.parse(r.stdout)).toEqual([]);
    expect(opCalls(), 'a call reached models-op for a lane the lock cannot serve').toEqual([]);
    expect(fs.existsSync(join(home, '.ccrc', 'locks'))).toBe(false);
    expect(laneCalls()).toEqual([]);
    // The control: with mkdir, the same call proceeds (and makes the directory).
    const control = sourced(lane(250));
    expect(JSON.parse(control.stdout)).toEqual([MOVED]);
    expect(fs.existsSync(lockPathOf())).toBe(true);
  }, T);
});

describe('_models_canary reads what the program printed (plan W2 Task 11)', () => {
  const quiet = (stub: string): Result => {
    home = mkTmp('ccrc-models-canary-shell-');
    installTree(home, stepRoster({ proxyPort: 45020, litellmPort: 45021, authDir: codexAuthDir('lane-a') }), { canaryStub: stub });
    return sourced(`${SHAPE}\n_models_canary lane-a model-6.1-gamma low`);
  };

  it('no answer is failed, "canary gave no answer"', () => {
    const r = quiet('#!/usr/bin/env node\nprocess.exit(0);\n');
    expect(JSON.parse(r.stdout)).toEqual({ ok: true, op: 'canary', result: 'failed', status: null,
      reason: 'canary gave no answer' });
  });

  it('an expired bound (rc 124) is not-ready', () => {
    const r = quiet('#!/usr/bin/env node\nprocess.exit(124);\n');
    expect(JSON.parse(r.stdout)).toMatchObject({ ok: true, op: 'canary', result: 'not-ready' });
  });

  it("the canary's own bad-argv is unavailable, never failed", () => {
    const r = quiet('#!/usr/bin/env node\n'
      + "process.stdout.write(JSON.stringify({ ok: false, error: 'bad-argv', detail: 'x' }) + '\\n', () => process.exit(2));\n");
    expect(JSON.parse(r.stdout)).toEqual({ ok: true, op: 'canary', result: 'unavailable', status: null,
      reason: 'the canary refused its arguments (bad-argv)' });
  });
});

describe("the advance step's shape, pinned in source (plan W2 Task 11)", () => {
  const src = fs.readFileSync(join(REPO, 'ccd', 'ccrc'), 'utf8');
  const code = (fn: string): string => ccrcFunction(fn).split('\n').filter((l) => !/^\s*#/.test(l)).join('\n');

  it('takes the advance deadline once per run, AFTER the lane loop and from the clock then (RB8)', () => {
    const box = ccrcFunction('_models_box_sub');
    expect(box.match(/adv_deadline=\$\(\( SECONDS \+ adv_budget \)\)/g), 'one assignment of the deadline').toHaveLength(1);
    expect(box.match(/adv_budget="\$\(_models_advance_budget_secs\)"/g), 'the budget is read once').toHaveLength(1);
    const loopEnd = box.indexOf('i=$((i + 1))');
    expect(loopEnd).toBeGreaterThan(0);
    expect(box.indexOf('adv_deadline=$(( SECONDS')).toBeGreaterThan(loopEnd);
    expect(box.indexOf('adv_budget="$(')).toBeGreaterThan(loopEnd);
    // Clipped to what is left of the invocation: the entry time plus the unit's ceiling, less the final output's process.
    expect(box).toMatch(/adv_end=\$\(\( MODELS_INVOKE_T0 \+ MODELS_INVOKE_CEILING_S \)\)/);
    expect(box).toMatch(/adv_end - MODELS_NODE_BOUND_S - MODELS_KILL_GRACE_MAX_S/);
  });

  it("runs the advance step after the lane loop, never inside it (D-5213)", () => {
    const box = ccrcFunction('_models_box_sub');
    const loopEnd = box.indexOf('i=$((i + 1))');
    expect(loopEnd).toBeGreaterThan(0);
    const calls = [...box.matchAll(/_models_advance_lane "/g)].map((m) => m.index!);
    expect(calls).toHaveLength(1);
    expect(calls[0]).toBeGreaterThan(loopEnd);
  });

  it('takes the invocation entry time once, as the first statement after the shell options, and never resets SECONDS', () => {
    expect(src.match(/^MODELS_INVOKE_T0=\$SECONDS$/gm)).toHaveLength(1);
    const at = src.indexOf('MODELS_INVOKE_T0=$SECONDS');
    expect(at, 'before the platform layer forks its first subprocess').toBeLessThan(src.indexOf('# ── THE PLATFORM LAYER'));
    expect(src.slice(src.indexOf('\nset -uo pipefail\n') + 1, at).split('\n').filter((l) => l !== '' && !l.startsWith('#')))
      .toEqual(['set -uo pipefail']);
    const codeLines = src.split('\n').filter((l) => !/^\s*#/.test(l));
    expect(codeLines.filter((l) => /^\s*SECONDS=/.test(l)), 'a production assignment to SECONDS').toEqual([]);
  });

  it("the ceiling is the unit's TimeoutStartSec, and the grace ceiling is _plat_timeout's clamp", () => {
    const unit = fs.readFileSync(join(REPO, 'deploy', 'systemd', 'ccrc-models.service'), 'utf8');
    const m = /^TimeoutStartSec=(\d+)$/m.exec(unit);
    const c = /^MODELS_INVOKE_CEILING_S=(\d+)$/m.exec(src);
    expect(m, 'the unit has no TimeoutStartSec').not.toBeNull();
    expect(c, 'ccd/ccrc has no MODELS_INVOKE_CEILING_S').not.toBeNull();
    expect(Number(c![1])).toBe(Number(m![1]));
    const grace = /^MODELS_KILL_GRACE_MAX_S=(\d+)$/m.exec(src);
    const clamp = /\[ "\$grace" -gt (\d+) \] && grace=\1/.exec(ccrcFunction('_plat_timeout'));
    expect(Number(grace![1])).toBe(Number(clamp![1]));
  });

  it('never takes the tier lock, and sends each canary outside the lane-files lock', () => {
    const step = code('_models_advance_steps');
    expect(step).not.toContain('_codex_lock');
    expect(step).not.toMatch(/\b_models_lock\b/);
    const canaryLine = step.split('\n').find((l) => l.includes('_models_advance_canary "$id"'));
    expect(canaryLine, 'the step sends no canary').toBeDefined();
    expect(canaryLine).not.toContain('_models_node_locked');
    // Between a candidate's canary and its commit nothing locks: the canary line comes before the one locked call.
    expect(step.indexOf('_models_advance_canary "$id"')).toBeLessThan(step.indexOf('advance-commit'));
    // One lane's lock is never held over a locked call for another: the step names no lane but its own.
    const locked = step.split('\n').filter((l) => l.includes('_models_node_locked'));
    expect(locked.length).toBe(2);
    for (const l of locked) expect(l).toContain('_models_node_locked "$id"');
  });

  it("the canary's default deadline is one number in bash and node", () => {
    const bash = /CCRC_MODELS_CANARY_S:-(\d+)/.exec(ccrcFunction('_models_canary_secs'));
    const node = /^const CANARY_TIMEOUT_S = (\d+);$/m.exec(fs.readFileSync(join(REPO, 'deploy', 'models-canary.mjs'), 'utf8'));
    expect(bash![1]).toBe(node![1]);
  });

  it('the lock wait is read once, by _models_lock_secs, for the lock and for the reserve', () => {
    expect(src.match(/CCRC_MODELS_LOCK_S/g)!.length, 'a second reading of CCRC_MODELS_LOCK_S')
      .toBe(ccrcFunction('_models_lock_secs').match(/CCRC_MODELS_LOCK_S/g)!.length
        + (src.match(/^#.*CCRC_MODELS_LOCK_S.*$/gm) ?? []).length);
    expect(code('_models_lock')).toContain('bound="$(_models_lock_secs)"');
    expect(code('_models_tx_reserve_secs')).toContain('$(_models_lock_secs)');
  });

  it("the bash cap on a canary's reason is REASON_MAX, the advance file's one cap, which bash cannot import", () => {
    // REASON_MAX is defined once, in shared/model-advance.mjs. The canary read body spells it as a literal in its jq
    // frame, so the literal is held equal to it here.
    const m = /\| \.\[0:(\d+)\]\) \| if \. == ""/.exec(ccrcFunction('_models_adv_body_canary'));
    expect(m, '_models_adv_body_canary no longer cuts the reason it passes to the commit').not.toBeNull();
    expect(Number(m![1])).toBe(REASON_MAX);
  });
});

// ── THE BUDGET (plan W2 Task 11, RB8 and the budget addendum) ─────────────────────────────────────────────────────
// The advance clock starts AFTER every lane's first pass and spends only what is LEFT of the unit's 300 s; the
// reserves are derived component sums; admission is a logical test; and every NEW external stage is a process under a
// strict deadline. Time is simulated by assigning `SECONDS` in the sourced shell (the first pass's elapsed time by a
// render that "takes" a hundred seconds), never by waiting; the processes the stalled cases stall are real.
describe.skipIf(PY === null)('the advance deadline: one clipped clock, taken after the first pass (RB8)', () => {
  /** The first pass taking `n` seconds: its probe is the one step the refresh arm runs in its own shell (the render and
   *  the materialise run in `$( )`, whose clock the arm never sees). */
  const slowRender = (n: number): string => wrap('_models_refresh_one', { after: `SECONDS=$(( SECONDS + ${n} ))` });
  /** Entry time pinned to 0 and the clock to 0, so a clipped deadline is an exact number. */
  const PIN = 'MODELS_INVOKE_T0=0; SECONDS=0';
  const logLane = spy('_models_advance_lane', 'adv-calls', '"$2"');
  const deadlines = (): number[] => lines('adv-calls').map(Number);
  const refreshWith = (pre: string, extra: NodeJS.ProcessEnv = {}): Result =>
    refresh({ CCRC_CODEX_READY_S: '1', ...extra }, [PIN, pre, logLane].join('\n'));

  it('is taken after the lane loop from the clock then: a first pass of 100 s moves it by 100', async () => {
    await setup();
    tier(1);
    const r = refreshWith(slowRender(100), { CCRC_MODELS_ADVANCE_BUDGET_S: '100' });
    expect(r.code, r.stdout + r.stderr).toBe(0);
    const [d] = deadlines();
    expect(deadlines()).toHaveLength(1);
    expect(d, 'a deadline taken before the loop would be about 100').toBeGreaterThanOrEqual(200);
    expect(d, 'a first pass this slow is not what this case measures').toBeLessThanOrEqual(230);
  }, T);

  it('never exceeds the unit: even a budget of 3600 ends at the entry time plus 300 less the final output (282)', async () => {
    await setup();
    tier(1);
    const r = refreshWith('', { CCRC_MODELS_ADVANCE_BUDGET_S: '3600' });
    expect(r.code, r.stdout + r.stderr).toBe(0);
    expect(deadlines()).toEqual([282]);
  }, T);

  it('clips the budget of 250 to 282 after a first pass of 100 s, so a 221-second candidate is not admitted', async () => {
    await setup();
    tier(0);
    const r = refreshWith(slowRender(100));
    expect(r.code, r.stdout + r.stderr).toBe(0);
    expect(deadlines()).toEqual([282]);
    expect(rowOf(r), 'a candidate needing 221 s was admitted with 182 left').toEqual(QUIET_ROW);
    expect(laneProxyRequests(proxy)).toEqual([]);
  }, T);

  it('a first pass of 200 s leaves 82: not even the 95-second backfill is admitted, so nothing is created or settled', async () => {
    await setup({ opStub: OP_STUB });
    tier(0);
    plantLandedIntent();
    const r = refreshWith(slowRender(200));
    expect(r.code, r.stdout + r.stderr).toBe(0);
    expect(deadlines()).toEqual([282]);
    expect(rowOf(r)).toEqual(QUIET_ROW);
    expect(opCalls().some((l) => l.startsWith('advance-backfill') || l.startsWith('advance-commit'))).toBe(false);
    expect((advanceFile().pending as { class: string }).class, 'the pending intent was settled with no room').toBe('opus');
    expect(notifyCalls()).toEqual([]);
  }, T);

  it('a first pass that leaves nothing runs no step at all, and the output is the inherited one', async () => {
    await setup({ opStub: OP_STUB });
    tier(0);
    const r = refreshWith(slowRender(285));
    expect(r.code, r.stdout + r.stderr).toBe(0);
    expect(deadlines(), 'the step ran past the invocation').toEqual([]);
    expect(rowOf(r)).toEqual(QUIET_ROW);
    expect(opCalls().some((l) => l.startsWith('advance-'))).toBe(false);
  }, T);
});

describe.skipIf(PY === null)('the reserves are derived sums, and admission is exact (plan W2 Task 11)', () => {
  const quietTree = (): void => {
    home = mkTmp('ccrc-models-reserve-');
    installTree(home, stepRoster({ proxyPort: 45020, litellmPort: 45021, authDir: codexAuthDir('lane-a') }));
  };

  it('the default reserves are 221 (a candidate) and 95 (a backfill), over a locked transaction of 64', () => {
    // T = P + K + W = 18 + 28 + 18; backfill = T + J + H = 64 + 18 + 13; candidate = (90 + 15 + 8) + T + J + 2H.
    quietTree();
    expect(sourced('echo "$MODELS_NODE_BOUND_S $MODELS_KILL_GRACE_MAX_S"').stdout).toBe('10 8\n');
    expect(sourced('_models_tx_reserve_secs').stdout).toBe('64');
    expect(sourced('_models_backfill_reserve_secs').stdout).toBe('95');
    expect(sourced('_models_canary_reserve_secs').stdout).toBe('221');
  });

  it('a canary of 20 s and a lock wait of 1 s reserve 132 and 76 over 45', () => {
    quietTree();
    const k = { CCRC_MODELS_CANARY_S: '20', CCRC_MODELS_LOCK_S: '1' };
    expect(sourced('_models_tx_reserve_secs', k).stdout).toBe('45');
    expect(sourced('_models_backfill_reserve_secs', k).stdout).toBe('76');
    expect(sourced('_models_canary_reserve_secs', k).stdout).toBe('132');
  });

  it('every component is read from its owner: the node bound moves the reserves by its share', () => {
    // NB = 2: P = 10, K = 28, W = 10 -> T = 48; J = 10 -> backfill 48 + 10 + 13 = 71; candidate 113 + 48 + 10 + 26 = 197.
    quietTree();
    expect(sourced('MODELS_NODE_BOUND_S=2; _models_tx_reserve_secs').stdout).toBe('48');
    expect(sourced('MODELS_NODE_BOUND_S=2; _models_backfill_reserve_secs').stdout).toBe('71');
    expect(sourced('MODELS_NODE_BOUND_S=2; _models_canary_reserve_secs').stdout).toBe('197');
  });

  it('oversized knobs make an operation cost what it costs: L = 300 backfills for 375, C = 600 with L = 300 costs 1011', () => {
    quietTree();
    expect(sourced('_models_backfill_reserve_secs', { CCRC_MODELS_LOCK_S: '300' }).stdout).toBe('375');
    expect(sourced('_models_canary_reserve_secs', { CCRC_MODELS_LOCK_S: '300', CCRC_MODELS_CANARY_S: '600' }).stdout).toBe('1011');
    expect(sourced('_codex_ready_secs', { CCRC_CODEX_READY_S: '9999' }).stdout).toBe('9999');
  });

  it('admits only SECONDS + cost + 1 <= deadline, at the exact integer boundary, and refuses what is not a number', () => {
    quietTree();
    const probe = (d: string, c: string): string =>
      sourced(`SECONDS=10; _models_advance_admit ${d} ${c}; printf %s "$?"`).stdout;
    expect(probe('20', '9'), '10 + 9 + 1 = 20 fits 20').toBe('0');
    expect(probe('20', '10'), '10 + 10 + 1 = 21 does not fit 20').toBe('1');
    expect(probe('11', '0'), 'a zero cost fits when the clock is a second short of the deadline').toBe('0');
    expect(probe('10', '0')).toBe('1');
    expect(probe("''", '5')).toBe('1');
    expect(probe('20', 'x')).toBe('1');
    expect(probe('20', "''")).toBe('1');
    expect(probe('-5', '1')).toBe('1');
  });
});

describe.skipIf(PY === null || !HAS_FLOCK)('admission before every locked or bounded phase (plan W2 Task 11)', () => {
  const landedIntent = plantLandedIntent;
  const pending = (): unknown => advanceFile().pending;
  const READY1 = { CCRC_CODEX_READY_S: '1' };

  it('the capability probe is itself a bounded call and is admitted: with no room for it, it is not made', async () => {
    await setup({ opStub: OP_STUB });
    tier(0);
    const probe = spy('_plat_timeout_capability', 'cap-calls', '"probe"');
    const none = sourced(`${SHAPE}\nSECONDS=0\n_models_advance_lane lane-a 1`, {}, probe);
    expect(JSON.parse(none.stdout)).toEqual([]);
    expect(lines('cap-calls'), 'the probe was made with one second left').toEqual([]);
    expect(opCalls()).toEqual([]);
    const some = sourced(`${SHAPE}\nSECONDS=0\n_models_advance_lane lane-a 250`, {}, probe);
    expect(JSON.parse(some.stdout)).toEqual([MOVED]);
    expect(lines('cap-calls').length, 'the control never probed').toBeGreaterThanOrEqual(1);
  }, T);

  it('a backfill allowance one second short never calls the lock, creates nothing and settles nothing', async () => {
    await setup({ opStub: OP_STUB });
    tier(0);
    landedIntent();
    fs.rmSync(join(home, '.ccrc', 'locks'), { recursive: true, force: true });
    const r = sourced(`${SHAPE}\nSECONDS=0\n_models_advance_lane lane-a 95`, READY1, spy('_models_node_locked', 'locked-calls', '"$2"'));
    expect(r.code, r.stderr).toBe(0);
    expect(JSON.parse(r.stdout)).toEqual([]);
    expect(lines('locked-calls'), 'the lock was asked for with the allowance one second short').toEqual([]);
    expect(opCalls().map((l) => l.split(' ')[0]), 'only the gate read ran').toEqual(['advance-plan']);
    expect(fs.existsSync(join(home, '.ccrc', 'locks')), 'the lock directory was made').toBe(false);
    expect(pending()).not.toBeNull();
    expect(notifyCalls()).toEqual([]);
  }, T);

  it('with the allowance the same call settles the landed intent: one recovered event, one push', async () => {
    await setup({ opStub: OP_STUB });
    tier(0);
    landedIntent();
    const r = sourced(`${SHAPE}\nSECONDS=0\n_models_advance_lane lane-a 130`, READY1);
    expect(r.code, r.stderr).toBe(0);
    expect(JSON.parse(r.stdout)).toEqual([{ ...MOVED, recovered: true }]);
    expect(pending()).toBeNull();
    expect(notifyCalls()).toEqual(['--push\tlane-a: opus model-5.6-gamma → model-6.1-gamma']);
  }, T);

  it('a lock wait of 300 s makes the backfill cost 375: it is deferred before the lock', async () => {
    await setup({ opStub: OP_STUB });
    tier(0);
    landedIntent();
    fs.rmSync(join(home, '.ccrc', 'locks'), { recursive: true, force: true });
    const r = sourced(`${SHAPE}\nSECONDS=0\n_models_advance_lane lane-a 300`, { ...READY1, CCRC_MODELS_LOCK_S: '300' },
      spy('_models_node_locked', 'locked-calls', '"$2"'));
    expect(JSON.parse(r.stdout)).toEqual([]);
    expect(lines('locked-calls'), 'the lock was asked for with a 375-second backfill and 300 seconds left').toEqual([]);
    expect(fs.existsSync(join(home, '.ccrc', 'locks'))).toBe(false);
    expect(pending()).not.toBeNull();
  }, T);

  it('a readiness allowance that cannot fit at all (CCRC_CODEX_READY_S=9999) defers the lane BEFORE the backfill', async () => {
    await setup({ opStub: OP_STUB });
    tier(0);
    landedIntent();
    fs.rmSync(join(home, '.ccrc', 'locks'), { recursive: true, force: true });
    const r = sourced(lane(250), { CCRC_CODEX_READY_S: '9999' });
    expect(JSON.parse(r.stdout)).toEqual([]);
    expect(opCalls().map((l) => l.split(' ')[0])).toEqual(['advance-plan']);
    expect(fs.existsSync(join(home, '.ccrc', 'locks'))).toBe(false);
    expect(pending()).not.toBeNull();
    expect(laneCalls()).toEqual([]);
  }, T);

  it('time spent after the lock is held cannot authorise the writer: the backfill is deferred and NO node writer runs', async () => {
    // The flock stage is admitted with its whole follow-up; the clock then jumps 60 s while the lock is being taken.
    await setup({ opStub: OP_STUB });
    tier(0);
    landedIntent();
    const bump = wrap('_plat_timeout_strict', { after: 'case "$2" in flock) SECONDS=$((SECONDS + 70));; esac' });
    const r = sourced(`${SHAPE}\nSECONDS=0\n_models_advance_lane lane-a 110`, READY1, bump);
    expect(r.code, r.stderr).toBe(0);
    expect(JSON.parse(r.stdout)).toEqual([]);
    expect(opCalls().map((l) => l.split(' ')[0]), 'a writer ran after its allowance was gone').toEqual(['advance-plan']);
    expect(pending()).not.toBeNull();
    expect(lockFree(), 'the lock was kept').toBe(true);
  }, T);

  it('the same jump before a COMMIT is an abandoned budget-deferred event, not a failed canary, and writes nothing', async () => {
    await setup({ opStub: OP_STUB });
    tier(0);
    const bump = wrap('_plat_timeout_strict', { after: 'case "$2" in flock) [ -f "$HOME/bump" ] && SECONDS=$((SECONDS + 210));; esac' });
    // The jump only on the commit's lock (the backfill ran first, and must not trip it).
    const arm = wrap('_models_advance_canary', { after: ': > "$HOME/bump"' });
    const before = snapshot();
    const r = sourced(`${SHAPE}\nSECONDS=0\n_models_advance_lane lane-a 260`, {}, `${bump}\n${arm}`);
    expect(r.code, r.stderr).toBe(0);
    expect(JSON.parse(r.stdout)).toEqual([{ class: 'opus', from: 'model-5.6-gamma', to: 'model-6.1-gamma',
      outcome: 'abandoned', why: 'budget-deferred' }]);
    expect(opCalls().some((l) => l.startsWith('advance-commit')), 'a commit ran with its allowance gone').toBe(false);
    expect(snapshot()).toEqual(before);
    expect(historyOf('opus')).toEqual([]);
    expect(notifyCalls()).toEqual([]);
    expect(lockFree()).toBe(true);
  }, T);
});

describe.skipIf(PY === null || !HAS_FLOCK)('every new external stage is a process under a strict deadline (plan W2 Task 11)', () => {
  const REAL = (n: string): string => spawnSync('bash', ['-c', `type -P ${n}`], { encoding: 'utf8' }).stdout.trim();
  /** Short bounds so a stalled stage costs seconds: the node bound 4, the kill grace 2. */
  const FAST: NodeJS.ProcessEnv = { CCD_TIMEOUT_KILL_AFTER: '2' };
  const NB = 'MODELS_NODE_BOUND_S=4';
  const withTools = (dir: string): NodeJS.ProcessEnv => ({ PATH: `${dir}:${SYS_PATH}` });
  /** A `jq` that, for a program mentioning `pat`, records that it started, ignores TERM and stalls; else is jq. */
  const jqStall = (pat: string): string => {
    const dir = mkTmp('ccrc-jq-stall-');
    bashStub(dir, 'jq', `case "$*" in *${pat}*) trap '' TERM; : >> "$HOME/jq-hung"; sleep 120;; esac\nexec ${REAL('jq')} "$@"`);
    return dir;
  };
  const timed = (call: string, extra: NodeJS.ProcessEnv, pre = ''): Result & { ms: number } => {
    const t0 = Date.now();
    const r = sourced(call, { ...FAST, ...extra }, `${NB}\n${pre}`);
    return { ...r, ms: Date.now() - t0 };
  };

  it('a planner that stalls ignoring TERM is ended at its bound: no tier question, no canary, no writer', async () => {
    await setup({ opStub: OP_STUB });
    tier(0);
    const r = timed(lane(250), { OP_HANG: 'advance-plan' });
    expect(JSON.parse(r.stdout)).toEqual([]);
    expect(r.ms, 'the planner was not ended at its bound').toBeLessThan(25_000);
    expect(opCalls().map((l) => l.split(' ')[0])).toEqual(['advance-plan']);
    expect(laneCalls()).toEqual([]);
    expect(laneProxyRequests(proxy)).toEqual([]);
  }, T);

  it('a plan parser that stalls is ended with the read child, and the lane defers', async () => {
    await setup({ opStub: OP_STUB });
    tier(0);
    const r = timed(lane(250), withTools(jqStall('PLAN')));
    expect(JSON.parse(r.stdout)).toEqual([]);
    expect(fs.existsSync(join(home, 'jq-hung')), 'the stall never started').toBe(true);
    expect(r.ms).toBeLessThan(25_000);
    expect(opCalls().some((l) => l.startsWith('advance-backfill'))).toBe(false);
    expect(laneProxyRequests(proxy)).toEqual([]);
  }, T);

  it('a check-only render that stalls is ended: read-only (no --commit), no tier lock, no stop or start, no canary', async () => {
    await setup({ opStub: OP_STUB });
    tier(0);
    const r = timed(lane(250), { OP_HANG: 'litellm' });
    expect(JSON.parse(r.stdout)).toEqual([]);
    expect(r.ms).toBeLessThan(40_000);
    const litellm = opCalls().filter((l) => l.startsWith('litellm'));
    expect(litellm, 'the check never ran').toHaveLength(1);
    expect(litellm[0]).not.toMatch(/--commit/);
    expect(laneCalls().filter((l) => /^(stop|start) /.test(l))).toEqual([]);
    expect(laneProxyRequests(proxy)).toEqual([]);
    expect(opCalls().some((l) => l.startsWith('advance-commit'))).toBe(false);
  }, T);

  it('an identity question that prints a verdict-shaped line and never ends is unmeasured: the partial output is discarded', async () => {
    await setup();
    tier(0);
    fs.mkdirSync(join(home, 'fake'), { recursive: true });
    fs.writeFileSync(join(home, 'fake', 'hang-lane-a-litellm'), '');
    const r = timed(lane(250), { CCRC_CODEX_READY_S: '3' });
    expect(JSON.parse(r.stdout), 'a partial "ours, running" marker was believed').toEqual([]);
    expect(laneProxyRequests(proxy)).toEqual([]);
    expect(r.ms).toBeLessThan(40_000);
  }, T);

  it('a chmod that stalls ignoring TERM is ended at its bound: no writer, the lock released, the class unmoved', async () => {
    await setup({ opStub: OP_STUB });
    tier(0);
    const dir = mkTmp('ccrc-chmod-stall-');
    bashStub(dir, 'chmod', `case "$*" in *700*) trap '' TERM; sleep 120;; esac\nexec ${REAL('chmod')} "$@"`);
    const before = snapshot();
    const r = timed(lane(250), withTools(dir));
    expect(JSON.parse(r.stdout)).toEqual([{ class: 'opus', from: 'model-5.6-gamma', to: 'model-6.1-gamma',
      outcome: 'abandoned', why: 'lock-unwritable' }]);
    expect(r.ms, 'the chmod was not ended at its bound').toBeLessThan(60_000);
    expect(opCalls().map((l) => l.split(' ')[0]).filter((o) => o === 'advance-backfill' || o === 'advance-commit')).toEqual([]);
    expect(snapshot()).toEqual(before);
    expect(lockFree()).toBe(true);
    expect(notifyCalls()).toEqual([]);
  }, T);

  it('a mkdir that stalls (no lock directory yet) is ended at its bound the same way', async () => {
    await setup({ opStub: OP_STUB });
    tier(0);
    fs.rmSync(join(home, '.ccrc', 'locks'), { recursive: true, force: true });
    const dir = mkTmp('ccrc-mkdir-stall-');
    bashStub(dir, 'mkdir', `case "$*" in *locks*) trap '' TERM; sleep 120;; esac\nexec ${REAL('mkdir')} "$@"`);
    const r = timed(lane(250), withTools(dir));
    expect(JSON.parse(r.stdout)).toEqual([{ class: 'opus', from: 'model-5.6-gamma', to: 'model-6.1-gamma',
      outcome: 'abandoned', why: 'lock-unwritable' }]);
    expect(r.ms).toBeLessThan(60_000);
    expect(opCalls().map((l) => l.split(' ')[0]).filter((o) => o === 'advance-backfill' || o === 'advance-commit')).toEqual([]);
    expect(fs.existsSync(lockPathOf())).toBe(false);
  }, T);

  it('a flock that ignores its own wait and TERM is ended by its strict deadline: lock-busy, nothing written', async () => {
    await setup({ opStub: OP_STUB });
    tier(0);
    const dir = mkTmp('ccrc-flock-stall-');
    bashStub(dir, 'flock', `trap '' TERM; sleep 120`);
    const before = snapshot();
    const r = timed(lane(250), { ...withTools(dir), CCRC_MODELS_LOCK_S: '2' });
    expect(JSON.parse(r.stdout)).toEqual([{ class: 'opus', from: 'model-5.6-gamma', to: 'model-6.1-gamma',
      outcome: 'abandoned', why: 'lock-busy' }]);
    expect(r.ms, 'a flock that ignores -w outlived its deadline').toBeLessThan(60_000);
    expect(snapshot()).toEqual(before);
    expect(opCalls().map((l) => l.split(' ')[0]).filter((o) => o === 'advance-backfill' || o === 'advance-commit')).toEqual([]);
    expect(lockFree(), 'the descriptor stayed open and held the lock').toBe(true);
  }, T);

  it('a writer that outlives its bound is ended with no answer, the lock is released and nothing is reported as restored', async () => {
    await setup({ opStub: OP_STUB });
    tier(0);
    const r = timed(lane(250), { OP_HANG: 'advance-commit' });
    expect(JSON.parse(r.stdout)).toEqual([{ class: 'opus', from: 'model-5.6-gamma', to: 'model-6.1-gamma',
      outcome: 'abandoned', why: 'no-answer' }]);
    expect(r.ms).toBeLessThan(60_000);
    expect(lockFree()).toBe(true);
  }, T);

  it('a notify hook that stalls before anything is ended at its own deadline, and the move still stands', async () => {
    await setup({ opStub: OP_STUB });
    tier(0);
    fs.writeFileSync(join(home, '.cc-sessions', 'notify.sh'), '#!/bin/bash\ntrap "" TERM\n: > "$HOME/hook-started"\nsleep 120\n', { mode: 0o755 });
    const r = timed(lane(250), {});
    expect(JSON.parse(r.stdout)).toEqual([MOVED]);
    expect(fs.existsSync(join(home, 'hook-started'))).toBe(true);
    expect(r.ms, 'the hook was run bare').toBeLessThan(40_000);
    expect(classes()['opus']).toBe('model-6.1-gamma');
  }, T);

  it('a receipt that stalls reports nothing and ends the lane: no event, no push, no further canary or commit', async () => {
    await setup({ opStub: OP_STUB });
    tier(0);
    // opus's intent landed; haiku has a candidate too, which only a lane that carried on would canary.
    plantLandedIntent({ classesOver: { haiku: 'model-5.6-alpha' } });
    const r = timed(lane(250), withTools(jqStall('EVENT')));
    expect(JSON.parse(r.stdout)).toEqual([]);
    expect(fs.existsSync(join(home, 'jq-hung'))).toBe(true);
    expect(notifyCalls()).toEqual([]);
    expect(laneProxyRequests(proxy), 'a canary went out after an expired read').toEqual([]);
    expect(opCalls().filter((l) => l.startsWith('advance-commit'))).toEqual([]);
  }, T);
});

// ── THE BOUNDED IDENTITY QUESTION, for real (plan W2 Task 11) ─────────────────────────────────────────────────────
// `_codex_tier_ours --bounded-read <seconds> <id> <tier>`: the REAL library (the tree's `ccd/ccrc` is a link to the
// real file, no fakes), the fake lane proxy for the shim, real processes for a handle, and stand-in tools on PATH for
// the stalls. The whole question - row lookup, manager inspection, `ps`, network identity - is one outer deadline.
describe.skipIf(PY === null)('the bounded identity question against real listeners and stand-in tools (plan W2 Task 11)', () => {
  const REAL = (n: string): string => spawnSync('bash', ['-c', `type -P ${n}`], { encoding: 'utf8' }).stdout.trim();
  const CAP = '_plat_timeout_capability >/dev/null';
  const ask = (secs: number, tierWord: string, extra: NodeJS.ProcessEnv = {}, id = 'lane-a'): Result & { ms: number } => {
    const t0 = Date.now();
    const r = sourced(`${SHAPE}\nout="$(_codex_tier_ours --bounded-read ${secs} ${id} ${tierWord})"; rc=$?\nprintf '%s\\nRC=%s' "$out" "$rc"`,
      { CCD_TIMEOUT_KILL_AFTER: '2', ...extra }, CAP);
    return { ...r, ms: Date.now() - t0 };
  };
  const verdictOf = (r: Result): { rc: string; marker: string | null } => {
    const m = /RC=(\d+)$/.exec(r.stdout);
    const v = /CX-VERDICT rc=(\d+)\s*\n?RC=/.exec(r.stdout);
    return { rc: m === null ? 'none' : m[1]!, marker: v === null ? null : v[1]! };
  };
  const laneDir = (): string => join(home, '.ccrc', 'codex', 'lane-a');
  async function realBox(): Promise<void> {
    home = mkTmp('ccrc-models-tier-');
    proxy = await spawnFakeLaneProxy(home);
    installTree(home, stepRoster({ proxyPort: proxy.port, litellmPort: await freePort(), authDir: codexAuthDir('lane-a') }),
      { realCcrc: true });
    env(home);
    fs.mkdirSync(laneDir(), { recursive: true, mode: 0o700 });
  }

  it('answers the five ordinary verdicts through its marker: ours 0, down 1, foreign 2, cannot ask 3, starting 4', async () => {
    await realBox();
    // 0: the shim answers as this lane. 2: it answers as another lane.
    expect(verdictOf(ask(20, 'shim'))).toEqual({ rc: '0', marker: '0' });
    laneProxyAnswersAs(proxy, 'lane-x');
    expect(verdictOf(ask(20, 'shim'))).toEqual({ rc: '0', marker: '2' });
    laneProxyAnswersAs(proxy, 'lane-a');
    // 1: nothing listens on the LiteLLM port.
    expect(verdictOf(ask(20, 'litellm'))).toEqual({ rc: '0', marker: '1' });
    // 3: a tier word this build does not know, and a lane the roster does not have.
    expect(verdictOf(ask(20, 'bogus'))).toEqual({ rc: '0', marker: '3' });
    expect(verdictOf(ask(20, 'shim', {}, 'lane-zzz'))).toEqual({ rc: '0', marker: '3' });
    // 4: a live process whose command line proves this lane's LiteLLM, while the port does not answer.
    const yaml = join(laneDir(), 'litellm.yaml');
    const handle = spawn(BASH, ['-c', 'exec -a "x --config $1" sleep 60', '_', yaml], { stdio: 'ignore' });
    trackChild(home, handle);
    fs.writeFileSync(join(laneDir(), 'litellm.pid'), `${handle.pid}\n`);
    expect(verdictOf(ask(20, 'litellm'))).toEqual({ rc: '0', marker: '4' });
  }, T);

  it('a read that stalls is ended at the OUTER deadline and unmeasured: no marker, and no inner deadline group is made', async () => {
    // The shim's identity read hangs. The ordinary question would end it at its own probe bound (30 s here, 2 by default
    // and 2 in the ordinary caller); the bounded one must not wait for that, and must not make a deadline group of its
    // own for it (a stand-in `timeout` logs every call it is asked to make).
    await realBox();
    laneProxyProbeMode(proxy, 'hang');
    const dir = mkTmp('ccrc-timeout-log-');
    bashStub(dir, 'timeout', `printf '%s\\n' "$*" >> "$HOME/timeout-calls"\nexec ${REAL('timeout')} "$@"`);
    const r = ask(2, 'shim', { PATH: `${dir}:${SYS_PATH}`, CCRC_CODEX_PROBE_S: '30' });
    expect(verdictOf(r)).toEqual({ rc: '124', marker: null });
    expect(r.ms, 'the question waited for the inner probe bound').toBeLessThan(20_000);
    const calls = lines('timeout-calls');
    expect(calls.filter((l) => l.includes('/dev/tcp')), 'an inner deadline group was made for the read').toEqual([]);
    expect(calls.some((l) => /^-k \d+ 2 \S*bash -c/.test(l)), `the outer deadline was not the question's: ${calls.join(' | ')}`).toBe(true);
  }, T);

  it('a descendant that ignores TERM neither outlives the question nor holds its capture open', async () => {
    await realBox();
    // `ps` is the library's own: it asks it about the pid in the pidfile, and the stand-in never answers.
    const dir = mkTmp('ccrc-ps-stall-');
    bashStub(dir, 'ps', `trap '' TERM\necho $$ > "$HOME/ps-pid"\nsleep 120`);
    fs.writeFileSync(join(laneDir(), 'shim.pid'), '4242\n');
    const r = ask(2, 'shim', { PATH: `${dir}:${SYS_PATH}` });
    expect(verdictOf(r)).toEqual({ rc: '124', marker: null });
    expect(r.ms, 'the capture was held open by the stalled descendant').toBeLessThan(20_000);
    const pid = Number(fs.readFileSync(join(home, 'ps-pid'), 'utf8').trim());
    await eventually(() => { try { process.kill(pid, 0); return false; } catch { return true; } },
      'the stalled descendant to be gone', 15_000);
  }, T);

  it('where no strong deadline exists the question is not asked: rc 125, no marker, no tool run', async () => {
    await realBox();
    const dir = mkTmp('ccrc-weak-timeout-');
    bashStub(dir, 'timeout', `case "$1" in -*) exit 1;; esac\nexec ${REAL('timeout')} "$@"`);
    bashStub(dir, 'ps', `: > "$HOME/ps-ran"; exit 1`);
    fs.writeFileSync(join(laneDir(), 'shim.pid'), '4242\n');
    const r = ask(2, 'shim', { PATH: `${dir}:${SYS_PATH}` });
    expect(verdictOf(r)).toEqual({ rc: '125', marker: null });
    expect(fs.existsSync(join(home, 'ps-ran'))).toBe(false);
  }, T);
});

// ── No escalating deadline, no step; a bounded final answer (plan W2 Task 11) ─────────────────────────────────────
describe.skipIf(PY === null || !HAS_FLOCK)('the step needs a strong deadline, and its final answer is bounded (plan W2 Task 11)', () => {
  const REAL = (n: string): string => spawnSync('bash', ['-c', `type -P ${n}`], { encoding: 'utf8' }).stdout.trim();
  const weakTimeout = (): NodeJS.ProcessEnv => {
    const dir = mkTmp('ccrc-weak-');
    bashStub(dir, 'timeout', `case "$1" in -*) exit 1;; esac\nexec ${REAL('timeout')} "$@"`);
    return { PATH: `${dir}:${SYS_PATH}` };
  };
  const noTimeout = 'command() { if [ "${1:-}" = -v ]; then case "${2:-}" in timeout|gtimeout) return 1;; esac; fi; builtin command "$@"; }';
  const ranNothing = (): void => {
    expect(fs.existsSync(models('lane-a.advance.json')), 'a backfill created the advance file').toBe(false);
    expect(opCalls().some((l) => l.startsWith('advance-'))).toBe(false);
    expect(laneCalls()).toEqual([]);
    expect(laneProxyRequests(proxy)).toEqual([]);
    expect(notifyCalls()).toEqual([]);
  };

  it.each([
    ['a selected timeout that cannot prove -k (weak)', (): { extra: NodeJS.ProcessEnv; pre: string } => ({ extra: weakTimeout(), pre: '' })],
    ['no timeout utility at all (none)', (): { extra: NodeJS.ProcessEnv; pre: string } => ({ extra: {}, pre: noTimeout })],
  ] as [string, () => { extra: NodeJS.ProcessEnv; pre: string }][])(
    'with %s the step does not run, not even the backfill, and the output is the inherited one', async (_w, mk) => {
      await setup({ opStub: OP_STUB });
      tier(0);
      fs.rmSync(models('lane-a.advance.json'));
      const { extra, pre } = mk();
      const r = refresh(extra, pre);
      expect(r.code, r.stdout + r.stderr).toBe(0);
      expect(rowOf(r)).toEqual(QUIET_ROW);
      ranNothing();
    }, T);

  it('the same two substrates leave a pending intent unsettled, with the budget at its default', async () => {
    await setup({ opStub: OP_STUB });
    tier(0);
    plantLandedIntent();
    const r = refresh(weakTimeout());
    expect(rowOf(r)).toEqual(QUIET_ROW);
    expect(advanceFile().pending).not.toBeNull();
    expect(notifyCalls()).toEqual([]);
  }, T);

  it('an entered pass writes its answer through ONE strict jq: an expired one is a failure with no partial answer', async () => {
    await setup();
    tier(1);
    const dir = mkTmp('ccrc-final-jq-');
    bashStub(dir, 'jq', `case "$*" in *'$adv'*) trap '' TERM; : >> "$HOME/final-hung"; sleep 120;; esac\nexec ${REAL('jq')} "$@"`);
    const t0 = Date.now();
    const r = refresh({ PATH: `${dir}:${SYS_PATH}`, CCD_TIMEOUT_KILL_AFTER: '2' }, 'MODELS_NODE_BOUND_S=4');
    expect(fs.existsSync(join(home, 'final-hung')), 'the final output never reached the strict jq').toBe(true);
    expect(r.code).toBe(1);
    expect(r.stdout, 'a partial or fallback answer was printed').toBe('');
    expect(r.stderr).toContain('could not be written inside its allowance');
    expect(Date.now() - t0, 'the final jq was not ended at its bound').toBeLessThan(40_000);
  }, T);

  it('when no time is left for the final jq, none is started and none is claimed', async () => {
    await setup();
    tier(1);
    const dir = mkTmp('ccrc-final-jq-');
    bashStub(dir, 'jq', `case "$*" in *'$adv'*) : >> "$HOME/final-ran";; esac\nexec ${REAL('jq')} "$@"`);
    const pre = ['MODELS_INVOKE_T0=0; SECONDS=0', wrap('_models_final_allowance', { before: 'SECONDS=$(( SECONDS + 295 ))' })].join('\n');
    const r = refresh({ PATH: `${dir}:${SYS_PATH}` }, pre);
    expect(r.code).toBe(1);
    expect(r.stdout).toBe('');
    expect(r.stderr).toContain('no time was left to write its answer');
    expect(fs.existsSync(join(home, 'final-ran')), 'jq was started with no allowance').toBe(false);
  }, T);

  it('an entered pass keeps the one-object shape and the exit semantics of the inherited one', async () => {
    await setup();
    tier(1);
    const r = refresh();
    expect(r.code, r.stderr).toBe(0);
    expect(oneObject(r)).toEqual({ ok: true, op: 'refresh', refreshed: [QUIET_ROW] });
  }, T);
});

// ── Recovery and the pushes it owes (D-6067), refresh and hand verbs alike ────────────────────────────────────────
describe.skipIf(PY === null || !HAS_FLOCK)('a recovered automatic move is reported once, by whoever settles it (D-6067; plan W2 Task 11)', () => {
  it('a commit that settles an intent another writer left during the canary reports BOTH moves, the recovered one first, with a push each', async () => {
    // The reserve names two hooks on every commit for this: a clean backfill is no proof that the second is not owed.
    await setup({ registry: { ...STEP_REGISTRY, classes: { ...STEP_REGISTRY.classes, haiku: 'model-5.6-alpha' } } });
    tier(0);
    laneProxyMode(proxy, 'park', 'model-6-alpha');
    const run = refreshAsync();
    await eventually(() => laneProxyParked(proxy) >= 1, 'the parked canary', 30_000);
    // Another writer's move of sonnet, cut short after its rename (the registry already holds the new pin).
    fs.writeFileSync(models('lane-a.advance.json'), `${JSON.stringify(stepAdvance({}, { class: 'sonnet',
      from: 'model-5.6-beta', to: 'model-6-beta', effortFrom: 'high', effortTo: 'high', at: '2026-10-22T09:05:11Z' }), null, 2)}\n`);
    laneProxyRelease(proxy);
    const r = await run;
    expect(r.code, r.stdout + r.stderr).toBe(0);
    expect(rowOf(r)['advance']).toEqual([
      { class: 'sonnet', from: 'model-5.6-beta', to: 'model-6-beta', outcome: 'moved', recovered: true },
      { class: 'haiku', from: 'model-5.6-alpha', to: 'model-6-alpha', outcome: 'moved' },
      MOVED,
    ]);
    expect(notifyCalls()).toEqual([
      '--push\tlane-a: sonnet model-5.6-beta → model-6-beta',
      '--push\tlane-a: haiku model-5.6-alpha → model-6-alpha',
      '--push\tlane-a: opus model-5.6-gamma → model-6.1-gamma',
    ]);
    expect(advanceFile().pending).toBeNull();
  }, T);

  describe('the hand verbs (set-class, hold, release, revert)', () => {
    const hand = (call: string): Result => sourced(`cmd_models lane-a ${call}`);
    const pushes = ['--push\tlane-a: opus model-5.6-gamma → model-6.1-gamma'];

    it('a hold settles a landed automatic advance first, and the one push it owes is sent by that verb', async () => {
      await setup();
      plantLandedIntent();
      const h = hand('hold sonnet');
      expect(h.code, h.stdout + h.stderr).toBe(0);
      expect(JSON.parse(h.stdout)).toMatchObject({ ok: true, recoveredMove: { class: 'opus', how: 'advance' } });
      expect(notifyCalls()).toEqual(pushes);
      expect(advanceFile().pending).toBeNull();
      // Settled once: nothing repeats it, whichever verb comes next.
      expect(hand('release sonnet').code).toBe(0);
      expect(hand('hold sonnet').code).toBe(0);
      expect(notifyCalls()).toEqual(pushes);
    }, T);

    it('a set-class settles it too; and a landed HAND move is no advance: no push', async () => {
      await setup();
      plantLandedIntent();
      const s = hand('set-class haiku model-5.6-alpha');
      expect(s.code, s.stdout + s.stderr).toBe(0);
      expect(notifyCalls()).toEqual(pushes);
      // A hand set-class cut short after its rename (W1's hand intent), settled by the next hand verb: the operator's act.
      fs.writeFileSync(models('lane-a.advance.json'), `${JSON.stringify(stepAdvance({}, { how: 'hand', class: 'haiku',
        from: 'model-5.6-alpha', to: 'model-6-alpha', emptied: [], at: '2026-10-22T09:05:11Z' }), null, 2)}\n`);
      fs.writeFileSync(models('lane-a.classes.json'), `${JSON.stringify({ ...STEP_REGISTRY,
        classes: { ...STEP_REGISTRY.classes, opus: 'model-6.1-gamma' }, effort: { ...STEP_REGISTRY.effort, opus: 'xhigh' } }, null, 2)}\n`);
      expect(hand('hold sonnet').code).toBe(0);
      expect(notifyCalls(), 'a hand move was reported as an advance').toEqual(pushes);
    }, T);

    it('a refusal BEFORE anything was persisted carries no recovery and pushes nothing; the intent stays for a writer that persists', async () => {
      await setup();
      plantLandedIntent();
      const r = hand('revert sonnet');
      expect(r.code, r.stdout + r.stderr).toBe(1);
      expect(JSON.parse(r.stdout)).toMatchObject({ ok: false, error: 'no-previous' });
      expect(JSON.parse(r.stdout)).not.toHaveProperty('recoveredMove');
      expect(notifyCalls()).toEqual([]);
      expect(advanceFile().pending).not.toBeNull();
      expect(hand('hold sonnet').code).toBe(0);
      expect(notifyCalls()).toEqual(pushes);
    }, T);

    it('a refusal AFTER the writer persisted the recovery still carries it, and the push is sent once', async () => {
      // The revert settles the opus intent, persists it (its brake), then fails to materialise: the answer is a refusal
      // that names the recovered move, which the hourly step would never see again.
      await setup();
      plantLandedIntent();
      fs.rmSync(models('lane-a.classes.tsv'));
      fs.mkdirSync(models('lane-a.classes.tsv'));
      const r = hand('revert opus');
      expect(r.code, r.stdout + r.stderr).toBe(1);
      expect(JSON.parse(r.stdout)).toMatchObject({ ok: false, recoveredMove: { class: 'opus', how: 'advance' } });
      expect(advanceFile().pending, 'the recovery was not persisted').toBeNull();
      expect(notifyCalls()).toEqual(pushes);
      expect(hand('release opus').code).toBe(0);
      expect(notifyCalls(), 'a settled recovery was sent twice').toEqual(pushes);
    }, T);

    it('a hand verb that is not in the automatic context runs as ever when the environment forges one', async () => {
      await setup();
      tier(0);
      const forged = { MODELS_AUTO_DEADLINE: '1', MODELS_AUTO_TAIL_S: '1', CCD_TIMEOUT_CAPABILITY: 'strong',
        _CCD_TIMEOUT_K: 'yes', _CCD_TIMEOUT_PROVED_PATH: env(home)['PATH'] ?? '' };
      const h = sourced('cmd_models lane-a hold opus', forged);
      expect(h.code, h.stdout + h.stderr).toBe(0);
      expect(JSON.parse(h.stdout)).toMatchObject({ ok: true, changed: true });
      // …and a strict call refuses on the forged capability: the proof is this shell's own or nothing.
      const s = sourced('_plat_timeout_strict 5 bash -c ": > $HOME/ran"; echo "rc=$?"', forged);
      expect(s.stdout.trim()).toBe('rc=125');
      expect(fs.existsSync(join(home, 'ran')), 'a forged capability ran the strict target').toBe(false);
    }, T);
  });
});

// ── The automatic context, called directly (plan W2 Task 11) ──────────────────────────────────────────────────────
// Every automatic stage runs under `_plat_timeout_strict`, which runs nothing without a capability this shell proved
// `strong`. So, called directly with the step's non-exported locals set and NO proof, each refuses and runs nothing:
// the bare call, the legacy `_plat_timeout` (which would fall back, and on this very box would run the program) and
// the missing deadline all go red here. A hand caller, with neither local set, runs the very same calls as ever.
describe.skipIf(PY === null || !HAS_FLOCK)('each automatic stage refuses to run without a proved strong deadline (plan W2 Task 11)', () => {
  const AUTO = 'MODELS_AUTO_DEADLINE=$(( SECONDS + 600 )); MODELS_AUTO_TAIL_S=44';
  const called = (call: string, extra: NodeJS.ProcessEnv = {}): Result =>
    sourced(`${SHAPE}\n${AUTO}\n${call}\necho "rc=$?"`, extra);
  const rcOf = (r: Result): number => Number(/rc=(\d+)\s*$/.exec(r.stdout)?.[1] ?? -1);

  it.each([
    ['plan', '_models_advance_read plan lane-a'],
    ['check', '_models_advance_read check lane-a'],
    ['receipt', "_models_advance_read receipt backfill lane-a - - - - <<<'{}'"],
    ['canary', '_models_advance_read canary lane-a model-6.1-gamma low'],
  ])('a %s read runs no child', async (_p, call) => {
    await setup({ opStub: OP_STUB, canaryStub: LOGGING_CANARY });
    tier(0);
    const r = called(call);
    expect(rcOf(r), r.stdout + r.stderr).toBeGreaterThan(0);
    expect(opCalls()).toEqual([]);
    expect(laneCalls()).toEqual([]);
  }, T);

  it('an identity question runs no child', async () => {
    await setup();
    tier(0);
    const q = called('_codex_tier_ours --bounded-read 5 lane-a shim');
    expect(rcOf(q), q.stdout + q.stderr).toBe(125);
    expect(laneCalls()).toEqual([]);
  }, T);

  it('a notify hook is not run', async () => {
    await setup();
    const r = called('_models_push "lane-a: opus none → model-6.1-gamma"');
    expect(rcOf(r)).toBe(0);
    expect(notifyCalls()).toEqual([]);
    // The hand caller's own push, with neither local set, is sent as ever.
    const hand = sourced('_models_push "lane-a: opus none → model-6.1-gamma"');
    expect(hand.code, hand.stderr).toBe(0);
    expect(notifyCalls()).toEqual(['--push\tlane-a: opus none → model-6.1-gamma']);
  }, T);

  it('a locked writer is not run, and a hand caller runs the same call as ever', async () => {
    await setup({ opStub: OP_STUB });
    const call = '_models_node_locked lane-a advance-backfill --file "$(_models_roster_path)" --id lane-a';
    const r = called(call);
    expect(opCalls(), `the writer ran: ${r.stdout}`).toEqual([]);
    expect(rcOf(r)).not.toBe(0);
    const hand = sourced(`${SHAPE}\n${call}`);
    expect(JSON.parse(hand.stdout.trim())).toMatchObject({ ok: true, op: 'advance-backfill' });
    expect(opCalls().map((l) => l.split(' ')[0])).toEqual(['advance-backfill']);
  }, T);

  it('the lock directory is not prepared (chmod, or mkdir where it is absent) and the answer is lock-unwritable', async () => {
    await setup();
    const chmodDir = called('_models_lock lane-a; echo "err=$MODELS_LOCK_ERR"');
    expect(chmodDir.stdout).toContain('err=lock-unwritable');
    expect(lockFree()).toBe(true);
    fs.rmSync(join(home, '.ccrc', 'locks'), { recursive: true, force: true });
    const mkdir = called('_models_lock lane-a; echo "err=$MODELS_LOCK_ERR"');
    expect(mkdir.stdout).toContain('err=lock-unwritable');
    expect(fs.existsSync(join(home, '.ccrc', 'locks')), 'a bare mkdir made the lock directory').toBe(false);
  }, T);

  it('a missing flock or a lock directory it cannot make refuses lock-unwritable instead of degrading to nothing held', async () => {
    await setup();
    const noFlock = 'command() { if [ "${1:-}" = -v ] && [ "${2:-}" = flock ]; then return 1; fi; builtin command "$@"; }';
    const r = sourced(`${SHAPE}\n${noFlock}\n${AUTO}\n_models_lock lane-a; echo "rc=$? err=$MODELS_LOCK_ERR fd=[$MODELS_LOCK_FD]"`);
    expect(r.stdout.trim()).toBe('rc=1 err=lock-unwritable fd=[]');
    const hand = sourced(`${SHAPE}\n${noFlock}\n_models_lock lane-a; echo "rc=$? err=[$MODELS_LOCK_ERR] fd=[$MODELS_LOCK_FD]"`);
    expect(hand.stdout.trim(), 'the hand caller degrades as ever').toBe('rc=0 err=[] fd=[]');
  }, T);
});

// ── The stages are re-admitted one at a time, and a refused commit ends the lane (plan W2 Task 11) ───────────────────
describe.skipIf(PY === null || !HAS_FLOCK)('every lock stage is admitted again, and a refusal ends the lane', () => {
  const REAL = (n: string): string => spawnSync('bash', ['-c', `type -P ${n}`], { encoding: 'utf8' }).stdout.trim();
  const READY1 = { CCRC_CODEX_READY_S: '1' };
  const marker = (name: string): { dir: string; extra: NodeJS.ProcessEnv } => {
    const dir = mkTmp(`ccrc-${name}-marker-`);
    bashStub(dir, name, `: > "$HOME/${name}-ran"\nexec ${REAL(name)} "$@"`);
    return { dir, extra: { PATH: `${dir}:${SYS_PATH}` } };
  };

  it('a delay between the lane\'s admission and the lock\'s first stage defers before the directory is touched', async () => {
    await setup({ opStub: OP_STUB });
    tier(0);
    plantLandedIntent();
    const { extra } = marker('chmod');
    // `_codex_shape` is the lock's first act; the clock jumps 60 s there.
    const jump = wrap('_codex_shape', { after: 'SECONDS=$((SECONDS + 60))' });
    const r = sourced(`${SHAPE}\nSECONDS=0\n_models_advance_lane lane-a 110`, { ...READY1, ...extra }, jump);
    expect(JSON.parse(r.stdout)).toEqual([]);
    expect(fs.existsSync(join(home, 'chmod-ran')), 'the lock directory was prepared with the budget gone').toBe(false);
    expect(opCalls().map((l) => l.split(' ')[0])).toEqual(['advance-plan']);
  }, T);

  it('a delay after the directory stage defers before flock is asked', async () => {
    await setup({ opStub: OP_STUB });
    tier(0);
    plantLandedIntent();
    const { extra } = marker('flock');
    const jump = wrap('_plat_timeout_strict', { after: 'case "$2" in chmod) SECONDS=$((SECONDS + 65));; esac' });
    const r = sourced(`${SHAPE}\nSECONDS=0\n_models_advance_lane lane-a 110`, { ...READY1, ...extra }, jump);
    expect(JSON.parse(r.stdout)).toEqual([]);
    expect(fs.existsSync(join(home, 'flock-ran')), 'flock was asked with the budget gone').toBe(false);
    expect(opCalls().map((l) => l.split(' ')[0])).toEqual(['advance-plan']);
    expect(lockFree()).toBe(true);
  }, T);

  it('a refused commit ends the lane: the next candidate gets no canary and no event', async () => {
    await setup({ registry: { ...STEP_REGISTRY, classes: { ...STEP_REGISTRY.classes, haiku: 'model-5.6-alpha' } } });
    tier(0);
    laneProxyMode(proxy, 'park');
    const run = refreshAsync({ CCRC_MODELS_LOCK_S: '1' });
    await eventually(() => laneProxyParked(proxy) >= 1, 'the parked canary', 30_000);
    const holder = spawn(BASH, ['-c', 'exec 9>>"$1" && flock -x 9 && : > "$2" && exec sleep 30', '_', lockPathOf(), join(home, 'lock-held')],
      { stdio: 'ignore', env: { PATH: SYS_PATH, HOME: home } });
    trackChild(home, holder);
    await eventually(() => fs.existsSync(join(home, 'lock-held')), 'the outside holder took the lock');
    laneProxyRelease(proxy);
    const r = await run;
    expect(rowOf(r)['advance']).toEqual([
      { class: 'haiku', from: 'model-5.6-alpha', to: 'model-6-alpha', outcome: 'abandoned', why: 'lock-busy' }]);
    expect(laneProxyRequests(proxy), 'a second canary went out after a refused commit').toHaveLength(1);
  }, T);

  it('a read that prints a whole, valid answer and then never ends is not read: the lane defers', async () => {
    await setup();
    tier(0);
    fs.mkdirSync(join(home, 'fake'), { recursive: true });
    fs.writeFileSync(join(home, 'fake', 'check-hang'), '');
    const t0 = Date.now();
    const r = sourced(`${SHAPE}\nMODELS_NODE_BOUND_S=4\n_models_advance_lane lane-a "$(( SECONDS + 250 ))"`, { CCD_TIMEOUT_KILL_AFTER: '2' });
    expect(JSON.parse(r.stdout), 'the partial output of an expired read was believed').toEqual([]);
    expect(laneProxyRequests(proxy)).toEqual([]);
    expect(Date.now() - t0).toBeLessThan(40_000);
  }, T);
});

// ── Every automatic stage is spelled as a strict deadline (the source half of the table above) ────────────────────────
describe("the automatic stages' spelling, pinned in source (plan W2 Task 11)", () => {
  const code = (fn: string): string => ccrcFunction(fn).split('\n').filter((l) => !/^\s*#/.test(l)).join('\n');
  const legacy = (text: string): string[] => text.split('\n').filter((l) => /\b_plat_timeout\s/.test(l));

  it('the child runner, the identity read, the lock stages, the writer and the hook name _plat_timeout_strict', () => {
    expect(code('_models_advance_child')).toContain('_plat_timeout_strict "$1" "$BASH" -c "$MODELS_ADVANCE_CHILD"');
    expect(code('_codex_tier_read')).toContain('_plat_timeout_strict "${1:-0}" "$BASH" -c "$MODELS_ADVANCE_CHILD"');
    const lock = code('_models_lock');
    for (const stage of ['chmod -- 700 "$d"', 'mkdir -p -- "$d"', 'flock -w "$bound" "$fd"']) {
      expect(lock, `the automatic ${stage} is not a strict deadline`).toContain(`_plat_timeout_strict`);
      expect(lock.split('\n').some((l) => l.includes('_plat_timeout_strict') && l.includes(stage.split(' ')[0]!)), stage).toBe(true);
    }
    expect(code('_models_node_locked')).toContain('_plat_timeout_strict "$MODELS_NODE_BOUND_S" node');
    expect(code('_models_push')).toContain('_plat_timeout_strict "$MODELS_HOOK_S" "$hook"');
    expect(ccrcFunction('_models_box_sub')).toContain('_plat_timeout_strict "$adv_left" jq');
  });

  it('and nothing of the step names the legacy form, whose fallback would run the program without a deadline', () => {
    for (const fn of ['_models_advance_child', '_codex_tier_read', '_models_advance_read', '_models_advance_steps', '_models_advance_capable']) {
      expect(legacy(code(fn)), `${fn} names the legacy deadline`).toEqual([]);
    }
    // The three legacy spellings that remain are the hand callers': the lock's and the writer's hand branches, and the hand push.
    expect(legacy(code('_models_lock')), 'the lock\'s hand branch has none: a hand chmod and mkdir are bare, as ever').toEqual([]);
    expect(legacy(code('_models_node_locked'))).toHaveLength(1);
    expect(legacy(code('_models_push'))).toHaveLength(1);
  });

  it('the automatic locals are the step\'s own: declared local in the step, unset where they are first named, never exported', () => {
    const src = fs.readFileSync(join(REPO, 'ccd', 'ccrc'), 'utf8');
    expect(src).toMatch(/^unset MODELS_AUTO_DEADLINE MODELS_AUTO_TAIL_S$/m);
    expect(code('_models_advance_steps')).toContain('local MODELS_AUTO_DEADLINE="$2" MODELS_AUTO_TAIL_S=0');
    expect(src.split('\n').filter((l) => /^\s*(export|declare -x)\b.*MODELS_AUTO_/.test(l))).toEqual([]);
    expect(src.split('\n').filter((l) => !/^\s*#/.test(l)).filter((l) => /^MODELS_AUTO_/.test(l))).toEqual([]);
  });
});

// ccd/ccrc-codex — the per-session launcher of a ccrc-owned Codex lane
// (GPT-lane Plan 2b-2, Task 7). Runs the SHIPPED file over a fixture HOME.
//
// Nothing here starts a tier, binds a port or reaches a real binary:
//   - `ccrc` and the roster's upstream `claude` are RECORDER STUBS at the
//     absolute paths the launcher execs ($HOME/.local/bin/<name>);
//   - a POISON directory sits FIRST on PATH, holding every name the launcher
//     must never resolve through PATH or never run at all. In production the
//     pane's PATH is the tmux server's and need not hold ~/.local/bin (the
//     session unit sets none: `grep -n PATH ccd/claude-session@.service` is
//     empty), so a launcher that found `ccrc` or `claude` through PATH would
//     pass here only by accident; the poison turns that into a red;
//   - the environment is BUILT, never spread from `process.env`. This suite
//     runs inside Claude Code sessions whose own CLAUDE_CONFIG_DIR, model keys
//     and credentials would otherwise falsify every "not exported" assertion.
// `ghContainedEnv()` is deliberately NOT used: it prepends $HOME/.local/bin to
// PATH, which is exactly the directory whose ABSOLUTE use this suite pins. The
// poison `gh` is that containment, first on PATH.
//
// The gateway key is generated per case and never asserted by value: the stub
// `claude` compares ANTHROPIC_AUTH_TOKEN with each lane's runtime.env ITSELF
// and records only which lane matched, and every "the key is not in X" check
// is a boolean, so no failure message can print it.
import { describe, it, expect } from 'vitest';
import { spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import {
  chmodSync, copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, statSync, symlinkSync, writeFileSync,
} from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkTmp } from './tmpHelpers.js';
import { ccgptFile } from './ccgptHarness.js';
import { codexRoster, freePorts } from './codexLaneFixture.js';
import { seedAccountsSh } from './ccdWsHelpers.js';
import { MODEL_ENV_KEYS } from '../../shared/modelenv.mjs';
import { generateWrapperBody } from '../../shared/wrapper.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(here, '..', '..');
const MODELS_OP = path.join(REPO, 'deploy', 'models-op.mjs');
const WRAPPER_SHAPE = path.join(REPO, 'ccd', 'ccrc-wrapper-shape');

/** Resolved per CALL, not at module load: before the file exists (the red
 *  step) every case then fails naming the missing path, instead of the whole
 *  file failing to collect. */
const launcher = (): string => ccgptFile('ccrc-codex');

/** The six names design contract step 6 exports. Spelled here once because they ARE
 *  the contract under test, not a list derived from anywhere. */
const EXPORTED: readonly string[] = [
  'ANTHROPIC_BASE_URL', 'ANTHROPIC_AUTH_TOKEN', 'CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC',
  'DISABLE_TELEMETRY', 'API_TIMEOUT_MS', 'CLAUDE_CODE_MAX_RETRIES',
];

// ── the stubs ─────────────────────────────────────────────────────────────

/** Anything that reaches one of these was resolved through PATH, or run at
 *  all, and must not have been. */
const POISON = [
  '#!/bin/sh',
  'mkdir -p "$HOME/rec"',
  'printf \'%s %s\\n\' "${0##*/}" "$*" >> "$HOME/rec/poison"',
  'exit 97',
  '',
].join('\n');
const POISONED_NAMES = ['ccrc', 'claude', 'ccgpt', 'gh', 'ccd', 'tmux', 'systemctl', 'systemd-run'];

/** Stands in for `ccrc`: records each call, the NAMES in its environment and
 *  whatever it could read on stdin; answers per `$HOME/rec/ccrc.rc`; starts
 *  nothing. A `$HOME/rec/ccrc.materialise` file is copied over the lane's
 *  settings.json, standing in for the materialiser `ccrc codex start` may run. */
const STUB_CCRC = `#!/usr/bin/env bash
rec="$HOME/rec"; mkdir -p "$rec"
{ printf '%s' "$#"; for a in "$@"; do printf '\\t%s' "$a"; done; printf '\\n'; } >> "$rec/ccrc.calls"
compgen -e | LC_ALL=C sort > "$rec/ccrc.envnames"
cat > "$rec/ccrc.stdin"
[ -f "$rec/ccrc.materialise" ] && cp "$rec/ccrc.materialise" "$CLAUDE_CONFIG_DIR/settings.json"
rc=0; [ -f "$rec/ccrc.rc" ] && rc="$(cat "$rec/ccrc.rc")"
if [ "$rc" = 0 ]; then
  printf 'ccrc codex: %s: litellm started (nohup 11), shim started (nohup 12)\\n' "\${3-}"
else
  printf 'ccrc codex: not-logged-in: fixture refusal, run ccrc codex login %s\\n' "\${3-}" >&2
fi
exit "$rc"
`;

/** Stands in for the upstream Claude Code binary: records its pid, argv,
 *  environment NAMES, the VALUES of the non-secret variables this suite
 *  asserts, and which lane's runtime.env the gateway token equals (compared
 *  HERE, never written); then reads stdin, prints one stdout line, and exits
 *  per `$HOME/rec/claude.rc`. */
const STUB_CLAUDE = `#!/usr/bin/env bash
rec="$HOME/rec"; mkdir -p "$rec"
printf '%s\\n' "$$" > "$rec/claude.pid"
printf '%s\\n' "$#" > "$rec/claude.argc"
printf '%s\\0' "$@" > "$rec/claude.argv"
compgen -e | LC_ALL=C sort > "$rec/claude.envnames"
for v in ANTHROPIC_BASE_URL CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC DISABLE_TELEMETRY API_TIMEOUT_MS CLAUDE_CODE_MAX_RETRIES CLAUDE_CONFIG_DIR; do
  printf '%s=%s\\n' "$v" "\${!v-<unset>}"
done > "$rec/claude.env"
lane=none
for f in "$HOME"/.ccrc/codex/*/runtime.env; do
  [ -f "$f" ] || continue
  if [ "LITELLM_MASTER_KEY=\${ANTHROPIC_AUTH_TOKEN-}" = "$(cat "$f")" ]; then lane="\${f%/runtime.env}"; lane="\${lane##*/}"; fi
done
printf '%s\\n' "$lane" > "$rec/claude.token-lane"
cat > "$rec/claude.stdin"
printf 'claude-stub-stdout\\n'
rc=0; [ -f "$rec/claude.rc" ] && rc="$(cat "$rec/claude.rc")"
exit "$rc"
`;

// ── the fixture box ───────────────────────────────────────────────────────

type Lane = { id: string; proxyPort: number; litellmPort: number };
type Row = {
  id: string;
  configDirSuffix: string;
  exec: { kind: string; proxyPort?: number; litellmPort?: number; authDir?: string };
};
interface Box {
  home: string;
  rec: string;
  bin: string;
  lanes: Lane[];
  /** Per lane id, its generated key — for ABSENCE checks only. */
  keys: Record<string, string>;
}

function rows(home: string): Row[] {
  return (JSON.parse(readFileSync(path.join(home, '.ccrc', 'accounts.json'), 'utf8')) as { accounts: Row[] })
    .accounts;
}
function row(home: string, id: string): Row {
  const r = rows(home).find((a) => a.id === id);
  if (r === undefined) throw new Error(`codexRoster wrote no row for ${id}`);
  return r;
}
function upstreamId(home: string): string {
  const up = rows(home).filter((a) => a.exec.kind === 'upstream');
  if (up.length !== 1) throw new Error(`expected exactly one upstream row, got ${up.length}`);
  return up[0]!.id;
}
const cfgDir = (b: Box, id: string): string => path.join(b.home, row(b.home, id).configDirSuffix);
const laneDir = (b: Box, id: string): string => path.join(b.home, '.ccrc', 'codex', id);

/** `laneManifest`'s shape (`grep -n "^function laneManifest" deploy/models-op.mjs`),
 *  copied from the roster row. The end-to-end case reads the REAL writer's. */
function plantLaneJson(b: Box, id: string, patch: Record<string, unknown> = {}): void {
  const r = row(b.home, id);
  mkdirSync(laneDir(b, id), { recursive: true, mode: 0o700 });
  const manifest = {
    id,
    configDir: r.configDirSuffix,
    authDir: r.exec.authDir,
    proxyPort: r.exec.proxyPort,
    litellmPort: r.exec.litellmPort,
    probeModel: 'gpt-x-mini',
    units: { litellm: `ccgpt-${id}-litellm.service`, shim: `ccgpt-${id}-shim.service` },
    ...patch,
  };
  writeFileSync(path.join(laneDir(b, id), 'lane.json'), `${JSON.stringify(manifest, null, 2)}\n`, { mode: 0o600 });
}

/** A generated `^sk-[0-9a-f]{48}$` key in the one-line shape
 *  `_codex_runtime_env_ensure` writes, 0600. */
function plantKey(b: Box, id: string): string {
  const key = `sk-${randomBytes(24).toString('hex')}`;
  mkdirSync(laneDir(b, id), { recursive: true, mode: 0o700 });
  writeFileSync(path.join(laneDir(b, id), 'runtime.env'), `LITELLM_MASTER_KEY=${key}\n`, { mode: 0o600 });
  return key;
}

function plantSettings(b: Box, id: string, body: unknown): void {
  mkdirSync(cfgDir(b, id), { recursive: true });
  writeFileSync(path.join(cfgDir(b, id), 'settings.json'),
    typeof body === 'string' ? body : `${JSON.stringify(body, null, 2)}\n`);
}

/** A fixture HOME with a real roster projection (`codexRoster`, the real
 *  generator), the two recorder stubs, the poison directory, and per lane a
 *  key, a lane.json and a classified settings.json (`plant: false` skips the
 *  last two, for the case whose materialiser writes them). */
async function box(ids: readonly string[] = ['codex-a'], o: { plant?: boolean } = {}): Promise<Box> {
  const home = mkTmp('ccrc-codex-launcher-');
  // `freePorts` (Task 4's fixture: DISTINCT, because the roster refuses two
  // lanes sharing one) only because this suite family never hard-codes a port
  // (design contract global constraints). Nothing in this file binds one: the stub
  // `ccrc` starts nothing and the stub `claude` connects to nothing.
  const ports = await freePorts(ids.length * 2);
  const lanes = ids.map((id, i) => ({ id, proxyPort: ports[2 * i]!, litellmPort: ports[2 * i + 1]! }));
  codexRoster(home, lanes);
  const bin = path.join(home, '.local', 'bin');
  mkdirSync(bin, { recursive: true });
  writeFileSync(path.join(bin, 'ccrc'), STUB_CCRC, { mode: 0o755 });
  writeFileSync(path.join(bin, upstreamId(home)), STUB_CLAUDE, { mode: 0o755 });
  const poison = path.join(home, 'poison-bin');
  mkdirSync(poison);
  for (const n of new Set([...POISONED_NAMES, upstreamId(home)])) {
    writeFileSync(path.join(poison, n), POISON, { mode: 0o755 });
  }
  const rec = path.join(home, 'rec');
  mkdirSync(rec);
  const b: Box = { home, rec, bin, lanes, keys: {} };
  for (const l of lanes) {
    b.keys[l.id] = plantKey(b, l.id);
    if (o.plant !== false) {
      plantLaneJson(b, l.id);
      plantSettings(b, l.id, { env: { ANTHROPIC_MODEL: 'gpt-x' } });
    }
  }
  return b;
}

// ── running it ────────────────────────────────────────────────────────────

interface RunOpts {
  args?: string[];
  /** CLAUDE_CONFIG_DIR: a path, or null for UNSET. Defaults to codex-a's. */
  cfg?: string | null;
  /** HOME: the box's by default; null for UNSET, or any other value verbatim. */
  home?: string | null;
  env?: Record<string, string>;
  stdin?: string;
  path?: string;
  /** What to exec — the shipped launcher unless a case runs a wrapper. */
  file?: string;
  timeoutMs?: number;
}
interface Run { code: number | null; out: string; err: string; pid: number; timedOut: boolean }

function run(b: Box, o: RunOpts = {}): Run {
  const env: Record<string, string> = {
    PATH: o.path ?? `${path.join(b.home, 'poison-bin')}:${process.env['PATH'] ?? '/usr/bin:/bin'}`,
  };
  const home = o.home === undefined ? b.home : o.home;
  if (home !== null) env['HOME'] = home;
  const cfg = o.cfg === undefined ? cfgDir(b, 'codex-a') : o.cfg;
  if (cfg !== null) env['CLAUDE_CONFIG_DIR'] = cfg;
  Object.assign(env, o.env ?? {});
  const r = spawnSync(o.file ?? launcher(), o.args ?? [], {
    cwd: b.home, env, input: o.stdin ?? '', encoding: 'utf8', timeout: o.timeoutMs ?? 10_000,
  });
  const err = r.error as NodeJS.ErrnoException | undefined;
  if (err !== undefined && err.code !== 'ETIMEDOUT') throw new Error(`spawn failed: ${err.code ?? err.message}`);
  return { code: r.status, out: r.stdout ?? '', err: r.stderr ?? '', pid: r.pid, timedOut: err?.code === 'ETIMEDOUT' };
}

const recPath = (b: Box, name: string): string => path.join(b.rec, name);
const recText = (b: Box, name: string): string =>
  (existsSync(recPath(b, name)) ? readFileSync(recPath(b, name), 'utf8') : '');
/** Every `ccrc` call's argv; the recorded leading count is checked, then dropped. */
function ccrcCalls(b: Box): string[][] {
  return recText(b, 'ccrc.calls').split('\n').filter(Boolean).map((l) => {
    const [n, ...argv] = l.split('\t');
    expect(Number(n), `ccrc.calls line ${JSON.stringify(l)}`).toBe(argv.length);
    return argv;
  });
}
const claudeRan = (b: Box): boolean => existsSync(recPath(b, 'claude.argc'));
function claudeArgv(b: Box): string[] {
  const n = Number(recText(b, 'claude.argc').trim());
  return recText(b, 'claude.argv').split('\0').slice(0, n);
}
function claudeEnv(b: Box): Record<string, string> {
  const out: Record<string, string> = {};
  for (const l of recText(b, 'claude.env').split('\n').filter(Boolean)) {
    const i = l.indexOf('=');
    out[l.slice(0, i)] = l.slice(i + 1);
  }
  return out;
}
const names = (b: Box, who: 'claude' | 'ccrc'): string[] =>
  recText(b, `${who}.envnames`).split('\n').filter(Boolean);
const tokenLane = (b: Box): string => recText(b, 'claude.token-lane').trim();
const poisoned = (b: Box): string[] => recText(b, 'poison').split('\n').filter(Boolean);
const refusal = (r: Run): string[] => r.err.split('\n').filter((l) => l.startsWith('ccrc-codex: '));

// ── the file ──────────────────────────────────────────────────────────────

describe('ccd/ccrc-codex — the shipped file', () => {
  it('is an executable bash script that carries no generated-wrapper marker', () => {
    const p = launcher();
    expect(statSync(p).mode & 0o111, 'a codex wrapper execs this file directly').toBe(0o111);
    const src = readFileSync(p, 'utf8');
    expect(src.split('\n')[0]).toBe('#!/usr/bin/env bash');
    // Spec §5.3: the common executables are bin-arm artifacts, NEVER
    // marker-stamped — a marker would make this file an orphan account-wrapper
    // report and a `_uninst_wrappers` deletion candidate.
    expect(src.split('\n').some((l) => l.startsWith('# ccrc:generated')),
      'ccrc-codex must never carry a provenance marker').toBe(false);
  });

  it("is never an account-wrapper candidate: doctor's own config-dir test says no, and yes on a generated wrapper", () => {
    // Task 9's hazard 1. Once placed, `~/.local/bin/ccrc-codex` is an
    // id-shaped script, and doctor's `_check_wrappers` (and the witness index)
    // count one as an account wrapper when ANY line matches
    // `_wrap_declares_config_dir`'s pattern. One such line here would make
    // the launcher a wrapper no roster row claims, on every installed box. It
    // READS CLAUDE_CONFIG_DIR; it never exports it. The REAL predicate is
    // asked, sourced from `ccd/ccrc-wrapper-shape`, so the pattern is not
    // typed a second time here to drift from the one doctor applies.
    const home = mkTmp('ccrc-codex-launcher-shape-');
    const ask = (f: string): number | null => spawnSync('bash',
      ['-c', '. "$1" && _wrap_declares_config_dir "$2"', 'ask', WRAPPER_SHAPE, f],
      { cwd: home, env: { PATH: process.env['PATH'] ?? '/usr/bin:/bin', HOME: home }, encoding: 'utf8' }).status;
    // Vacuity control: the same predicate says YES on what a codex row's
    // wrapper is, whichever target D-3478 has left it execing.
    const wrapper = path.join(home, 'codex-a');
    writeFileSync(wrapper, generateWrapperBody(
      { id: 'codex-a', configDirSuffix: '.claude-codex-a', execKind: 'codex' }, 'claude'), { mode: 0o755 });
    expect(ask(wrapper), 'control: a generated codex wrapper IS a wrapper candidate').toBe(0);
    expect(ask(launcher()), 'ccrc-codex carries an `export CLAUDE_CONFIG_DIR=` line — doctor would count it as a wrapper')
      .toBe(1);
  });
});

// ── the launch ────────────────────────────────────────────────────────────

describe('ccrc-codex — the launch', () => {
  it('execs the upstream binary IN PLACE with every argument untouched, lifecycle-looking words included', async () => {
    const argvs: string[][] = [
      ['login'],
      ['stop'],
      ['status', 'codex-a'],
      ['--resume', 'fixture-uuid', '--model', 'opus', '--dangerously-skip-permissions'],
      ['-p', 'two words', '', 'a line\nbreak', '--', '--help'],
      [],
    ];
    for (const args of argvs) {
      const b = await box();
      const r = run(b, { args });
      expect(r.code, `${JSON.stringify(args)}: ${r.err}`).toBe(0);
      expect(claudeArgv(b), JSON.stringify(args)).toEqual(args);
      // The launcher never interprets argv: whatever the first word, ccrc is
      // asked exactly one thing.
      expect(ccrcCalls(b), JSON.stringify(args)).toEqual([['codex', 'start', 'codex-a']]);
      // IN PLACE: the process ccd's pane runs IS Claude Code, not a bash parent.
      expect(recText(b, 'claude.pid').trim(), JSON.stringify(args)).toBe(String(r.pid));
      expect(poisoned(b), 'a name was resolved through PATH').toEqual([]);
    }
  });

  it("relays Claude Code's own exit status, because it is Claude Code that exits", async () => {
    const b = await box();
    writeFileSync(recPath(b, 'claude.rc'), '42');
    expect(run(b).code).toBe(42);
  });

  it("starts the lane its config directory maps to, and hands Claude Code THAT lane's endpoint and key", async () => {
    const b = await box(['codex-a', 'codex-b']);
    for (const lane of b.lanes) {
      rmSync(b.rec, { recursive: true, force: true });
      mkdirSync(b.rec);
      const r = run(b, { cfg: cfgDir(b, lane.id) });
      expect(r.code, `${lane.id}: ${r.err}`).toBe(0);
      expect(ccrcCalls(b)).toEqual([['codex', 'start', lane.id]]);
      // The SHIM's port — never litellmPort.
      expect(claudeEnv(b)['ANTHROPIC_BASE_URL']).toBe(`http://127.0.0.1:${lane.proxyPort}`);
      expect(tokenLane(b), "ANTHROPIC_AUTH_TOKEN must equal THIS lane's runtime.env key").toBe(lane.id);
      expect(claudeEnv(b)['CLAUDE_CONFIG_DIR'], "the wrapper's export reaches Claude Code unchanged")
        .toBe(cfgDir(b, lane.id));
    }
  });

  it('reads the port from lane.json and never re-derives it from the roster', async () => {
    const b = await box();
    const other = (await freePorts(4))
      .find((p) => p !== b.lanes[0]!.proxyPort && p !== b.lanes[0]!.litellmPort)!;
    plantLaneJson(b, 'codex-a', { proxyPort: other });
    const r = run(b);
    expect(r.code, r.err).toBe(0);
    expect(claudeEnv(b)['ANTHROPIC_BASE_URL']).toBe(`http://127.0.0.1:${other}`);
  });

  it('a trailing slash on CLAUDE_CONFIG_DIR still names the lane', async () => {
    for (const tail of ['/', '//']) {
      const b = await box();
      const r = run(b, { cfg: `${cfgDir(b, 'codex-a')}${tail}` });
      expect(r.code, `${tail}: ${r.err}`).toBe(0);
      expect(ccrcCalls(b), tail).toEqual([['codex', 'start', 'codex-a']]);
    }
  });

  it('exports the four behaviour variables: two forced to 1, two defaulted to the measured values', async () => {
    const b = await box();
    expect(run(b).code).toBe(0);
    expect(claudeEnv(b)).toMatchObject({
      CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '1', DISABLE_TELEMETRY: '1',
      API_TIMEOUT_MS: '870000', CLAUDE_CODE_MAX_RETRIES: '2',
    });
  });

  it('a caller wins the two defaults and loses the two forced values, the endpoint and the token', async () => {
    const b = await box();
    const r = run(b, { env: {
      CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '0', DISABLE_TELEMETRY: '0',
      API_TIMEOUT_MS: '1234', CLAUDE_CODE_MAX_RETRIES: '7',
      ANTHROPIC_BASE_URL: 'http://example.invalid', ANTHROPIC_AUTH_TOKEN: 'test-token-not-a-secret',
    } });
    expect(r.code, r.err).toBe(0);
    expect(claudeEnv(b)).toMatchObject({
      CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '1', DISABLE_TELEMETRY: '1',
      API_TIMEOUT_MS: '1234', CLAUDE_CODE_MAX_RETRIES: '7',
      ANTHROPIC_BASE_URL: `http://127.0.0.1:${b.lanes[0]!.proxyPort}`,
    });
    expect(tokenLane(b)).toBe('codex-a');
  });

  it('an EMPTY caller value takes the default, as the launcher this replaces did (`:-`, not `-`)', async () => {
    const b = await box();
    expect(run(b, { env: { API_TIMEOUT_MS: '', CLAUDE_CODE_MAX_RETRIES: '' } }).code).toBe(0);
    expect(claudeEnv(b)).toMatchObject({ API_TIMEOUT_MS: '870000', CLAUDE_CODE_MAX_RETRIES: '2' });
  });

  it('exports no model key, and none of the names the launcher it replaces put in the session', async () => {
    const b = await box();
    expect(run(b).code).toBe(0);
    const seen = names(b, 'claude');
    // Vacuity controls: the recorder saw this file's own exports, and the
    // derived list is not empty.
    expect(seen).toEqual(expect.arrayContaining([...EXPORTED, 'CLAUDE_CONFIG_DIR']));
    expect(MODEL_ENV_KEYS.length).toBeGreaterThan(0);
    expect(seen.filter((n) => MODEL_ENV_KEYS.includes(n)),
      "the lane's settings.json env block owns every model key").toEqual([]);
    expect(seen.filter((n) => n === 'LITELLM_MASTER_KEY' || n === 'CHATGPT_TOKEN_DIR' || n.startsWith('CCGPT_')),
      "the key reaches Claude Code as ANTHROPIC_AUTH_TOKEN only, and the tiers' own variables not at all")
      .toEqual([]);
  });

  it('the gateway key appears in no argv and on neither output stream', async () => {
    const b = await box();
    const key = b.keys['codex-a']!;
    const r = run(b, { args: ['-p', 'hello'] });
    expect(r.code, r.err).toBe(0);
    // Booleans, so a failure never prints the key.
    expect(recText(b, 'claude.argv').includes(key), 'key in Claude Code argv').toBe(false);
    expect(recText(b, 'ccrc.calls').includes(key), 'key in ccrc argv').toBe(false);
    expect(r.out.includes(key), 'key on stdout').toBe(false);
    expect(r.err.includes(key), 'key on stderr').toBe(false);
    expect(tokenLane(b), 'control: the key DID reach Claude Code, as ANTHROPIC_AUTH_TOKEN').toBe('codex-a');
  });

  it('runs ccrc codex start with stdin from /dev/null and its stdout on stderr', async () => {
    const b = await box();
    const prompt = 'a prompt piped to claude -p\nsecond line\n';
    const r = run(b, { args: ['-p'], stdin: prompt });
    expect(r.code, r.err).toBe(0);
    expect(recText(b, 'ccrc.stdin'), 'ccrc read the piped prompt').toBe('');
    expect(recText(b, 'claude.stdin'), 'Claude Code must get the whole prompt').toBe(prompt);
    expect(r.out, "stdout is Claude Code's alone").toBe('claude-stub-stdout\n');
    expect(r.err, "ccrc's progress line goes to stderr").toContain('ccrc codex: codex-a: litellm started');
  });

  it('exports nothing before ccrc codex start, so neither the key nor the endpoint reaches ccrc or a tier', async () => {
    const b = await box();
    expect(run(b).code).toBe(0);
    const early = names(b, 'ccrc');
    expect(early, 'control: the stub recorded its environment').toContain('CLAUDE_CONFIG_DIR');
    expect(early.filter((n) => EXPORTED.includes(n))).toEqual([]);
  });

  it('gates on the model class AFTER start, because start may re-materialise settings.json', async () => {
    const b = await box();
    plantSettings(b, 'codex-a', { env: {} });
    writeFileSync(recPath(b, 'ccrc.materialise'), `${JSON.stringify({ env: { ANTHROPIC_MODEL: 'gpt-x' } })}\n`);
    const r = run(b);
    expect(r.code, r.err).toBe(0);
    expect(claudeRan(b)).toBe(true);
  });

  it('composes with the REAL wrapper, the REAL materialiser and the REAL reverse map (needs D-3478)', async () => {
    const b = await box(['codex-a'], { plant: false });
    const r0 = row(b.home, 'codex-a');
    const m = spawnSync(process.execPath,
      [MODELS_OP, 'init', '--file', path.join(b.home, '.ccrc', 'accounts.json'), '--id', 'codex-a', '--probe', 'codex'],
      { cwd: b.home, env: { PATH: process.env['PATH'] ?? '/usr/bin:/bin', HOME: b.home }, encoding: 'utf8' });
    expect(m.status, `models-op init: ${m.stdout}${m.stderr}`).toBe(0);
    const body = generateWrapperBody(
      { id: 'codex-a', configDirSuffix: r0.configDirSuffix, execKind: 'codex' }, upstreamId(b.home));
    expect(body, "D-3478: a codex lane's wrapper execs ccrc-codex — this case needs that task landed first")
      .toContain('exec "$HOME/.local/bin/ccrc-codex" "$@"');
    writeFileSync(path.join(b.bin, 'codex-a'), body, { mode: 0o755 });
    copyFileSync(launcher(), path.join(b.bin, 'ccrc-codex'));
    chmodSync(path.join(b.bin, 'ccrc-codex'), 0o755);
    const r = run(b, { file: path.join(b.bin, 'codex-a'), cfg: null, args: ['--session-id', 'fixture-uuid'] });
    expect(r.code, r.err).toBe(0);
    expect(ccrcCalls(b)).toEqual([['codex', 'start', 'codex-a']]);
    expect(claudeEnv(b)['CLAUDE_CONFIG_DIR']).toBe(path.join(b.home, r0.configDirSuffix));
    expect(claudeEnv(b)['ANTHROPIC_BASE_URL']).toBe(`http://127.0.0.1:${r0.exec.proxyPort}`);
    expect(tokenLane(b)).toBe('codex-a');
    expect(claudeArgv(b)).toEqual(['--session-id', 'fixture-uuid']);
  });
});

// ── refusals ──────────────────────────────────────────────────────────────

describe("ccrc-codex — refusals: exit 1, one named line, Claude Code never exec'd", () => {
  /** Exit 1 without hanging, exactly one `ccrc-codex: <code>:` line, no
   *  Claude Code, nothing resolved through PATH. Returns the line. */
  function refused(b: Box, r: Run, code: string): string {
    expect(r.timedOut, `${code}: the launcher hung`).toBe(false);
    expect(r.code, `${code}: ${r.err}`).toBe(1);
    const lines = refusal(r);
    expect(lines, r.err).toHaveLength(1);
    expect(lines[0]!.startsWith(`ccrc-codex: ${code}: `), lines[0]).toBe(true);
    expect(claudeRan(b), `${code}: Claude Code was exec'd`).toBe(false);
    expect(poisoned(b)).toEqual([]);
    return lines[0]!;
  }

  it('no CLAUDE_CONFIG_DIR — unset or empty — refuses before asking ccrc anything', async () => {
    for (const cfg of [null, '']) {
      const b = await box();
      const line = refused(b, run(b, { cfg }), 'no-config-dir');
      expect(line).toContain('ccrc wrappers');
      expect(ccrcCalls(b)).toEqual([]);
    }
  });

  it('a config directory no account claims refuses naming ccrc install, and asks ccrc nothing', async () => {
    const b = await box();
    const line = refused(b, run(b, { cfg: path.join(b.home, '.claude-nobody') }), 'unmapped');
    // B3 (final review): `ccrc wrappers` never regenerates the projection this
    // map comes from, so naming it alone sent the operator round a loop.
    expect(line).toContain("run 'ccrc install': it regenerates that projection from the roster and rewrites every lane's wrapper");
    expect(line).not.toContain("'ccrc wrappers'");
    expect(ccrcCalls(b)).toEqual([]);
  });

  it("unmapped's commonest cause — a lane added to the roster by hand, the projection not regenerated — is cleared by regenerating it", async () => {
    // The state B3 measured: accounts.json names codex-b, accounts.sh (the
    // projection the reverse map lives in) was generated before it did.
    const b = await box(['codex-a', 'codex-b']);
    const roster = JSON.parse(readFileSync(path.join(b.home, '.ccrc', 'accounts.json'), 'utf8')) as { accounts: Row[] };
    seedAccountsSh(b.home, { ...roster, accounts: roster.accounts.filter((a) => a.id !== 'codex-b') });
    const line = refused(b, run(b, { cfg: cfgDir(b, 'codex-b') }), 'unmapped');
    expect(line).toContain("'ccrc install'");
    expect(ccrcCalls(b)).toEqual([]);
    // What `ccrc install`'s accounts.sh step does: regenerate it from the roster.
    seedAccountsSh(b.home, roster);
    const r = run(b, { cfg: cfgDir(b, 'codex-b') });
    expect(r.code, r.err).toBe(0);
    expect(ccrcCalls(b)).toEqual([['codex', 'start', 'codex-b']]);
  });

  it('no HOME — unset, or not a directory — refuses in its own words, never bash\'s unbound-variable line', async () => {
    for (const home of [null, '']) {
      const b = await box();
      const r = run(b, { home });
      const line = refused(b, r, 'no-home');
      expect(line).toContain('HOME is not set to a directory');
      expect(r.err, `${String(home)}: bash's own line`).not.toMatch(/unbound variable/);
      expect(ccrcCalls(b)).toEqual([]);
    }
    const b = await box();
    const file = path.join(b.home, 'not-a-directory');
    writeFileSync(file, 'x\n');
    refused(b, run(b, { home: file }), 'no-home');
    expect(ccrcCalls(b)).toEqual([]);
  });

  it('a failed ccrc codex start exits 1 whatever ccrc answered, and adds no line of its own', async () => {
    const b = await box();
    writeFileSync(recPath(b, 'ccrc.rc'), '7');
    const r = run(b);
    expect(r.code).toBe(1);
    expect(ccrcCalls(b)).toEqual([['codex', 'start', 'codex-a']]);
    expect(claudeRan(b)).toBe(false);
    expect(r.err).toContain('ccrc codex: not-logged-in: fixture refusal, run ccrc codex login codex-a');
    expect(refusal(r), "ccrc's refusal already names the remedy").toEqual([]);
  });

  it('a lane with no model class refuses AFTER start, naming ccrc models <id> init codex', async () => {
    const shapes: Array<[string, unknown]> = [
      ['absent', null],
      ['empty object', {}],
      ['env without the key', { env: {} }],
      ['empty string', { env: { ANTHROPIC_MODEL: '' } }],
      ['not a string', { env: { ANTHROPIC_MODEL: 7 } }],
      ['env not an object', { env: 'gpt-x' }],
      ['not JSON', 'not json at all\n'],
    ];
    for (const [label, body] of shapes) {
      const b = await box();
      rmSync(path.join(cfgDir(b, 'codex-a'), 'settings.json'), { force: true });
      if (body !== null) plantSettings(b, 'codex-a', body);
      const line = refused(b, run(b), 'no-lane-model');
      expect(line, label).toContain("'ccrc models codex-a init codex'");
      expect(ccrcCalls(b), label).toEqual([['codex', 'start', 'codex-a']]);
    }
    // F2 (review round 1): the `-f` guard on settings.json in step 4 is a
    // FIFO guard exactly like lane.json's and runtime.env's own — jq blocks
    // forever on a writerless FIFO, and this shape had no case of its own.
    {
      const b = await box();
      const p = path.join(cfgDir(b, 'codex-a'), 'settings.json');
      rmSync(p, { force: true });
      expect(spawnSync('mkfifo', [p]).status).toBe(0);
      const line = refused(b, run(b, { timeoutMs: 5_000 }), 'no-lane-model');
      expect(line, 'a FIFO').toContain("'ccrc models codex-a init codex'");
      expect(ccrcCalls(b), 'a FIFO').toEqual([['codex', 'start', 'codex-a']]);
    }
  });

  it('the roster projection — absent, not a regular file, half-loaded, stale — each its own code, none hangs', async () => {
    const cases: Array<[string, string, (p: string, b: Box) => void]> = [
      ['absent', 'no-roster', (p) => rmSync(p)],
      ['a FIFO', 'roster-unreadable', (p) => { rmSync(p); expect(spawnSync('mkfifo', [p]).status).toBe(0); }],
      ['a directory', 'roster-unreadable', (p) => { rmSync(p); mkdirSync(p); }],
      // Defines the map, then fails to parse: bash leaves the function
      // defined and `.` returns 2 — only the `.` rung stops it being trusted.
      ['a syntax error after the reverse map', 'roster-stale', (p, b) => writeFileSync(p,
        `CCRC_UPSTREAM=${upstreamId(b.home)}\n_ccrc_dir_id() { echo codex-a; }\nif then\n`)],
      ['no reverse map', 'roster-stale', (p, b) => writeFileSync(p, `CCRC_UPSTREAM=${upstreamId(b.home)}\n`)],
    ];
    for (const [label, code, make] of cases) {
      const b = await box();
      make(path.join(b.home, '.ccrc', 'accounts.sh'), b);
      const line = refused(b, run(b, { timeoutMs: 5_000 }), code);
      expect(ccrcCalls(b), label).toEqual([]);
      if (code !== 'roster-unreadable') expect(line, label).toContain("'ccrc install'");
    }
  });

  it.skipIf(process.getuid?.() === 0)('an unreadable roster projection is roster-unreadable, not no-roster', async () => {
    const b = await box();
    chmodSync(path.join(b.home, '.ccrc', 'accounts.sh'), 0o000);
    refused(b, run(b), 'roster-unreadable');
    expect(ccrcCalls(b)).toEqual([]);
  });

  it('no jq on PATH refuses before anything runs', async () => {
    const b = await box();
    const bashOnly = path.join(b.home, 'bash-only-bin');
    mkdirSync(bashOnly);
    const bash = spawnSync('bash', ['-c', 'command -v bash'], { encoding: 'utf8' }).stdout.trim();
    expect(path.isAbsolute(bash), `no bash to link: ${JSON.stringify(bash)}`).toBe(true);
    symlinkSync(bash, path.join(bashOnly, 'bash'));
    refused(b, run(b, { path: `${path.join(b.home, 'poison-bin')}:${bashOnly}` }), 'no-jq');
    expect(ccrcCalls(b)).toEqual([]);
  });

  it('no node on PATH refuses BEFORE start, naming the PATH that lacks it — the one ccrc codex start would look on', async () => {
    const b = await box();
    const bashJq = path.join(b.home, 'bash-jq-bin');
    mkdirSync(bashJq);
    for (const tool of ['bash', 'jq']) {
      const at = spawnSync('bash', ['-c', `command -v ${tool}`], { encoding: 'utf8' }).stdout.trim();
      expect(path.isAbsolute(at), `no ${tool} to link: ${JSON.stringify(at)}`).toBe(true);
      symlinkSync(at, path.join(bashJq, tool));
    }
    const pathValue = `${path.join(b.home, 'poison-bin')}:${bashJq}`;
    const line = refused(b, run(b, { path: pathValue }), 'no-node');
    expect(line).toContain(`node is not on this session's PATH (${pathValue}), and 'ccrc codex start' needs it`);
    expect(ccrcCalls(b), 'ccrc was asked to start a lane it would refuse').toEqual([]);
  });

  it("the no-node check stands in front of a real requirement: ccrc's `_codex_deps` still needs node for start, and not for login", () => {
    // If `ccrc codex start` ever stops needing node, THIS reds, and the
    // launcher's `no-node` refusal must go with it rather than refuse a
    // launch ccrc would have served. Drives ccd/ccrc's own function.
    const home = mkTmp('ccrc-codex-launcher-deps-');
    const src = readFileSync(path.join(REPO, 'ccd', 'ccrc'), 'utf8');
    const m = /^_codex_deps\(\) \{[^\n]*\n[\s\S]*?\n\}\n/m.exec(src);
    expect(m, '_codex_deps not found in ccd/ccrc').not.toBeNull();
    const jqOnly = path.join(home, 'jq-only-bin');
    mkdirSync(jqOnly);
    const jq = spawnSync('bash', ['-c', 'command -v jq'], { encoding: 'utf8' }).stdout.trim();
    expect(path.isAbsolute(jq), `no jq to link: ${JSON.stringify(jq)}`).toBe(true);
    symlinkSync(jq, path.join(jqOnly, 'jq'));
    const ask = (sub: string): { status: number | null; err: string } => {
      const r = spawnSync('bash', ['-c', [
        'set -u', `CCRC_HERE=${JSON.stringify(path.join(REPO, 'ccd'))}`,
        "_codex_say() { printf '%s: %s\\n' \"$1\" \"$2\" >&2; }", m![0], `PATH=${JSON.stringify(jqOnly)}`,
        `_codex_deps ${sub}`,
      ].join('\n')], { encoding: 'utf8', env: { HOME: home, PATH: process.env['PATH'] ?? '/usr/bin:/bin' } });
      return { status: r.status, err: r.stderr ?? '' };
    };
    const start = ask('start');
    expect(start.status, start.err).toBe(1);
    expect(start.err).toMatch(/^missing-dependency: node is not on PATH/m);
    expect(ask('login').status, 'control: login needs jq alone (PF-31)').toBe(0);
  });

  it('no executable upstream binary refuses BEFORE start, so nothing is started for a launch that cannot happen', async () => {
    const cases: Array<[string, (b: Box) => void]> = [
      ['absent', (b) => rmSync(path.join(b.bin, upstreamId(b.home)))],
      ['a directory', (b) => {
        rmSync(path.join(b.bin, upstreamId(b.home)));
        mkdirSync(path.join(b.bin, upstreamId(b.home)));
      }],
      ['not executable', (b) => chmodSync(path.join(b.bin, upstreamId(b.home)), 0o644)],
      ['no CCRC_UPSTREAM in the projection', (b) => {
        const suffix = row(b.home, 'codex-a').configDirSuffix;
        writeFileSync(path.join(b.home, '.ccrc', 'accounts.sh'),
          `_ccrc_dir_id() { case "$1" in "$HOME/${suffix}") echo codex-a ;; esac; }\n`);
      }],
    ];
    for (const [label, make] of cases) {
      const b = await box();
      make(b);
      refused(b, run(b), 'no-upstream');
      expect(ccrcCalls(b), label).toEqual([]);
    }
  });

  it('a lane.json with no usable proxyPort refuses after start — the port is never guessed', async () => {
    const cases: Array<[string, (b: Box) => void]> = [
      ['absent', (b) => rmSync(path.join(laneDir(b, 'codex-a'), 'lane.json'))],
      ['not JSON', (b) => writeFileSync(path.join(laneDir(b, 'codex-a'), 'lane.json'), 'not json\n')],
      ['no proxyPort', (b) => plantLaneJson(b, 'codex-a', { proxyPort: undefined })],
      ['a string', (b) => plantLaneJson(b, 'codex-a', { proxyPort: 'not-a-port' })],
      ['zero', (b) => plantLaneJson(b, 'codex-a', { proxyPort: 0 })],
      ['above 65535', (b) => plantLaneJson(b, 'codex-a', { proxyPort: 70000 })],
      ['fractional', (b) => plantLaneJson(b, 'codex-a', { proxyPort: 1.5 })],
      // F1 (review round 1): the `-f` guard on lane.json is a FIFO guard like
      // the roster's and runtime.env's own — jq blocks forever on a
      // writerless FIFO. Without the guard a pane hangs inside the launcher
      // AFTER `ccrc codex start` has already brought the tiers up.
      ['a FIFO', (b) => {
        const p = path.join(laneDir(b, 'codex-a'), 'lane.json');
        rmSync(p);
        expect(spawnSync('mkfifo', [p]).status).toBe(0);
      }],
    ];
    for (const [label, make] of cases) {
      const b = await box();
      make(b);
      refused(b, run(b, { timeoutMs: 5_000 }), 'lane-unreadable');
      expect(ccrcCalls(b), label).toEqual([['codex', 'start', 'codex-a']]);
    }
  });

  // F3 (review round 1): `cx_kv="$(<"$cx_envfile")"` strips trailing
  // newlines before the anchored ERE, so a key line followed by blank lines
  // is ACCEPTED. The refusal text and this title say so now ("trailing
  // newlines ignored"), matching the launcher's actual shape rather than
  // the earlier, stricter-sounding "exactly one" wording. No parsing logic
  // changed.
  it('a runtime.env that does not hold one well-formed key line (trailing newlines ignored) refuses, and never echoes what it read', async () => {
    const hex = (n: number): string => randomBytes(n).toString('hex').slice(0, n);
    const cases: Array<[string, (p: string) => void]> = [
      ['absent', (p) => rmSync(p)],
      ['47 hex', (p) => writeFileSync(p, `LITELLM_MASTER_KEY=sk-${hex(47)}\n`)],
      ['upper-case hex', (p) => writeFileSync(p, `LITELLM_MASTER_KEY=sk-A${hex(47).toUpperCase()}\n`)],
      ['an export prefix', (p) => writeFileSync(p, `export LITELLM_MASTER_KEY=sk-${hex(48)}\n`)],
      ['a second line', (p) => writeFileSync(p, `LITELLM_MASTER_KEY=sk-${hex(48)}\nOTHER=1\n`)],
      ['a FIFO', (p) => { rmSync(p); expect(spawnSync('mkfifo', [p]).status).toBe(0); }],
    ];
    for (const [label, make] of cases) {
      const b = await box();
      const p = path.join(laneDir(b, 'codex-a'), 'runtime.env');
      make(p);
      const planted = label === 'absent' || label === 'a FIFO' ? '' : readFileSync(p, 'utf8');
      const r = run(b, { timeoutMs: 5_000 });
      refused(b, r, 'no-key');
      expect(ccrcCalls(b), label).toEqual([['codex', 'start', 'codex-a']]);
      const secret = /sk-([0-9A-Fa-f]+)/.exec(planted)?.[1];
      if (secret !== undefined) expect(r.err.includes(secret), `${label}: the planted bytes reached stderr`).toBe(false);
    }
  });
});

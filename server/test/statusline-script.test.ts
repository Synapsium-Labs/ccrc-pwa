// `ccd/statusline-command.sh` — the Claude Code status-bar hook, run for real
// against a fixture HOME.
//
// This file exists because of a defect that was invisible to every other test
// in the repo. Stage 2a made the account roster data, and every consumer moved
// onto it — except this one. A statusline hook is handed a `CLAUDE_CONFIG_DIR`
// and nothing else, so its account map stayed four hand-written `case` arms,
// and an account those arms did not name got NO `~/.cc-limits/<id>.json`
// written for it. Ever. `projectHome` (server/src/limits.ts) then ranks an
// unmeasured account below every measured one — deliberately, so an unknown
// can never win a placement at a fake score of zero — which meant a free-form
// account was silently never placed and never rescued. Free-form ids, the
// whole point of stage 2a, were half delivered for exactly as long as that map
// was hand-kept.
//
// So the load-bearing test here is `writes a limits row for a FREE-FORM
// account`: put back the four hand-written arms and it goes red, because
// `zeta` was never one of them. Everything else in this file guards a way that
// fix could regress into a different silence.
import { describe, it, expect } from 'vitest';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync, symlinkSync } from 'node:fs';
import path from 'node:path';
import { parseRoster } from '../../shared/roster.js';
import { generateAccountsSh } from '../../shared/generate.mjs';
import { mkTmp } from './tmpHelpers.js';

const SCRIPT = path.resolve(__dirname, '../../ccd/statusline-command.sh');

// Production-shaped: one upstream account, one `telemetry: 'none'` external
// (the `gpt` case), and `zeta` — a free-form account with an id and a config
// dir that no hand-written map in this repo's history ever named.
//
// The upstream account's `configDirSuffix` is `.upstream-cfg`, NOT `.claude`,
// and that is load-bearing rather than arbitrary. `.claude` is also the
// hardcoded no-roster fallback in the script (`cfg="$HOME/.claude"`), so a
// fixture using it makes the roster-driven line and the fallback line produce
// the same answer — and the test below claiming to cover "unset
// CLAUDE_CONFIG_DIR resolves through the roster" would pass with that line
// deleted. A box whose upstream account does not live in `~/.claude` is
// exactly what free-form ids and `ccrc-adopt` make possible.
const ROSTER = {
  version: 1,
  accounts: [
    { id: 'claude', label: 'team·max', configDirSuffix: '.upstream-cfg', exec: { kind: 'upstream' }, homeAble: true, hue: 'cyan', telemetry: 'anthropic' },
    { id: 'zeta', label: 'zeta·one', configDirSuffix: '.zeta', exec: { kind: 'generated' }, homeAble: true, hue: 'amber', telemetry: 'anthropic' },
    { id: 'gpt', label: 'gpt', configDirSuffix: '.gpt-cfg', exec: { kind: 'external' }, homeAble: false, hue: 'magenta', telemetry: 'none' },
  ],
};

/** The statusline's stdin: the subset of Claude Code's payload this script
 *  reads. Rate limits are always present here — whether a row gets WRITTEN is
 *  the roster's decision, never the payload's, and that is what these tests
 *  are separating. */
const PAYLOAD = JSON.stringify({
  model: { display_name: 'Opus 5' },
  effort: { level: 'high' },
  workspace: { current_dir: '/nonexistent-for-this-test' },
  context_window: { used_percentage: 12 },
  rate_limits: {
    five_hour: { used_percentage: 41, resets_at: 1_800_000_000 },
    seven_day: { used_percentage: 63, resets_at: 1_800_600_000 },
  },
});

interface Run { out: string; code: number }

/** Runs the real script with `HOME` relocated — the single isolation boundary
 *  the whole ccd suite relies on. `cfgDir` becomes `CLAUDE_CONFIG_DIR`;
 *  `undefined` leaves it unset, which is how the upstream account runs. */
function run(home: string, cfgDir?: string): Run {
  const env: NodeJS.ProcessEnv = { ...process.env, HOME: home };
  delete env['CLAUDE_CONFIG_DIR'];
  if (cfgDir !== undefined) env['CLAUDE_CONFIG_DIR'] = cfgDir;
  const r = spawnSync('bash', [SCRIPT], { input: PAYLOAD, encoding: 'utf8', env });
  return { out: r.stdout ?? '', code: r.status ?? -1 };
}

/** ANSI stripped: these tests assert on the TEXT the operator reads, and the
 *  colour is asserted separately where it is the point. */
function plain(s: string): string {
  // eslint-disable-next-line no-control-regex
  return s.replace(/\[[0-9;]*m/g, '');
}

function seed(prefix: string, roster: unknown = ROSTER): string {
  const home = mkTmp(prefix);
  mkdirSync(path.join(home, '.ccrc'), { recursive: true });
  writeFileSync(path.join(home, '.ccrc', 'accounts.sh'), generateAccountsSh(parseRoster(roster)));
  return home;
}

function limitsRow(home: string, id: string): unknown {
  const p = path.join(home, '.cc-limits', `${id}.json`);
  return existsSync(p) ? JSON.parse(readFileSync(p, 'utf8')) : null;
}

describe('statusline-command.sh reads the roster instead of a hand-written map', () => {
  it('writes a limits row for a FREE-FORM account the old hand-written map never named', () => {
    const home = seed('ccrc-statusline-freeform-');
    const r = run(home, path.join(home, '.zeta'));
    expect(r.code).toBe(0);
    expect(limitsRow(home, 'zeta')).toEqual({
      five: 41, seven: 63, ts: expect.any(Number), fiveResetAt: 1_800_000_000, sevenResetAt: 1_800_600_000,
    });
  });

  it("names the account by its roster LABEL, not its config directory", () => {
    const home = seed('ccrc-statusline-label-');
    const out = plain(run(home, path.join(home, '.zeta')).out);
    expect(out).toContain('👤 zeta·one');
    expect(out).not.toContain('.zeta');
  });

  // All six of `HUES`, because the script's hue→ANSI `case` is a hand-written
  // restatement of `shared/roster.ts`'s list and nothing else ties the two
  // together. A hue whose arm is missing falls through to `hue_color=""` — the
  // account still renders, just uncoloured, which no text assertion can see.
  // `violet` and `amber` come from the 256-colour cube (35 is magenta and 33 is
  // the yellow the limit bars already use), which is the pair most likely to be
  // "simplified" into a 16-colour approximation that no longer matches
  // `pwa/src/styles/tokens.css`.
  it.each([
    ['cyan', '[36m'],
    ['violet', '[38;5;141m'],
    ['blue', '[34m'],
    ['magenta', '[35m'],
    ['amber', '[38;5;214m'],
    ['green', '[32m'],
  ])('colours an account with its roster hue: %s', (hue, ansi) => {
    const home = seed(`ccrc-statusline-hue-${hue}-`, {
      version: 1,
      accounts: [
        { id: 'claude', label: 'up', configDirSuffix: '.upstream-cfg', exec: { kind: 'upstream' }, homeAble: true, hue: 'cyan', telemetry: 'anthropic' },
        { id: 'hued', label: 'hued·acct', configDirSuffix: '.hued', exec: { kind: 'generated' }, homeAble: true, hue, telemetry: 'anthropic' },
      ],
    });
    expect(run(home, path.join(home, '.hued')).out).toContain(`${ansi}hued·acct`);
  });

  it('renders a label that bash `echo` would have swallowed as an option', () => {
    // `parseRoster` accepts `-n` — a label is display text, validated only as a
    // non-empty string with no control characters. `echo "-n"` prints NOTHING,
    // so an `_ccrc_label` built on `echo` gives that account a nameless chip.
    const home = seed('ccrc-statusline-dashn-', {
      version: 1,
      accounts: [
        { id: 'claude', label: 'up', configDirSuffix: '.upstream-cfg', exec: { kind: 'upstream' }, homeAble: true, hue: 'cyan', telemetry: 'anthropic' },
        { id: 'dashn', label: '-n', configDirSuffix: '.dashn', exec: { kind: 'generated' }, homeAble: true, hue: 'green', telemetry: 'anthropic' },
      ],
    });
    expect(plain(run(home, path.join(home, '.dashn')).out)).toContain('👤 -n');
  });

  it('writes NO limits row for an account the roster says has no telemetry', () => {
    const home = seed('ccrc-statusline-none-');
    // The payload carries rate limits regardless; `gpt` is `telemetry:'none'`,
    // and a `gpt.json` would be indistinguishable from a measured zero — the
    // exact fake `projectHome` refuses to rank above a real measurement.
    const r = run(home, path.join(home, '.gpt-cfg'));
    expect(r.code).toBe(0);
    expect(plain(r.out)).toContain('👤 gpt');
    expect(limitsRow(home, 'gpt')).toBeNull();
  });

  it('resolves an unset CLAUDE_CONFIG_DIR through the ROSTER, not the hardcoded default', () => {
    // The fixture's upstream lives in `.upstream-cfg`, so `$HOME/.claude` — the
    // no-roster fallback one line below in the script — is a directory NO
    // account claims here. Deleting the roster-driven line therefore falls
    // through to a config dir `_ccrc_dir_id` answers empty for: the chip would
    // read `.claude` and no `~/.cc-limits/claude.json` would be written, which
    // is the never-measured-never-placed failure this whole file exists for.
    const home = seed('ccrc-statusline-upstream-');
    const r = run(home);
    expect(plain(r.out)).toContain('👤 team·max');
    expect(limitsRow(home, 'claude')).not.toBeNull();
  });

  it('tolerates a trailing slash on CLAUDE_CONFIG_DIR', () => {
    const home = seed('ccrc-statusline-slash-');
    // Claude Code passes the variable through verbatim, so a trailing slash is
    // an operator typo away — and it would miss every literal `case` pattern
    // in the projection, costing the account its telemetry with no error.
    const r = run(home, `${path.join(home, '.zeta')}/`);
    expect(plain(r.out)).toContain('👤 zeta·one');
    expect(limitsRow(home, 'zeta')).not.toBeNull();
  });

  it('still renders a status bar on a box with no ccrc roster at all', () => {
    // The same dotfiles land on machines that are not fleet hosts. A missing
    // projection must cost the account segment its label, not the whole bar —
    // this hook runs on every render of every session.
    const home = mkTmp('ccrc-statusline-noroster-');
    const r = run(home, path.join(home, '.zeta'));
    expect(r.code).toBe(0);
    expect(plain(r.out)).toContain('🤖 Opus 5 · high');
    expect(plain(r.out)).toContain('👤 .zeta');
    expect(limitsRow(home, 'zeta')).toBeNull();
  });

  it('leaves a config dir no account claims unmeasured, without erroring', () => {
    const home = seed('ccrc-statusline-unknown-');
    const r = run(home, path.join(home, '.unclaimed'));
    expect(r.code).toBe(0);
    expect(plain(r.out)).toContain('👤 .unclaimed');
    expect(limitsRow(home, 'unclaimed')).toBeNull();
  });
});

/** The payload with the fields the usage sidecar reads. `model.id` beside
 *  `display_name`: the id is what `familyClassOf` classifies (routing spec §6). */
function usagePayload(extra: Record<string, unknown> = {}): string {
  return JSON.stringify({
    session_id: '11111111-2222-3333-4444-555555555555',
    model: { id: 'claude-opus-5', display_name: 'Opus 5' },
    effort: { level: 'high' },
    workspace: { current_dir: '/nonexistent-for-this-test' },
    context_window: { used_percentage: 12 },
    cost: { total_cost_usd: 1.25 },
    rate_limits: {
      five_hour: { used_percentage: 41, resets_at: 1_800_000_000 },
      seven_day: { used_percentage: 63, resets_at: 1_800_600_000 },
    },
    ...extra,
  });
}

/** A fake tmux on PATH whose `display-message -p '#S'` answers `sessionName`.
 *  The real hook derives the ccd id from exactly that call, gated on
 *  `TMUX_PANE` being set. */
function tmuxSaying(home: string, sessionName: string): string {
  const bin = path.join(home, '.local', 'bin');
  mkdirSync(bin, { recursive: true });
  writeFileSync(path.join(bin, 'tmux'),
    `#!/bin/sh\n[ "$1" = display-message ] && printf '%s\\n' '${sessionName}'\nexit 0\n`, { mode: 0o755 });
  return bin;
}

/** A fake tmux that NEVER ANSWERS — the measured failure class this fleet has a
 *  name for (`_substrate_mark`, `FleetSession.substrate`): a client blocked on a
 *  tmux server it cannot reach. `exec` so the bound's SIGTERM lands on the sleep
 *  itself rather than orphaning it behind a shell. */
function tmuxHanging(home: string): string {
  const bin = path.join(home, '.local', 'bin');
  mkdirSync(bin, { recursive: true });
  writeFileSync(path.join(bin, 'tmux'), '#!/bin/sh\nexec sleep 30\n', { mode: 0o755 });
  return bin;
}

/** A PATH with NO `timeout` on it, the macOS shape. Symlinks only the binaries
 *  this hook actually runs (`jq`, `date`, `mkdir`, `mv`, `rm`, `cat` — the rest
 *  of its calls are bash builtins) out of the real PATH, so nothing else leaks
 *  in; `gtimeout` is planted only when asked, which is how a macOS box with
 *  coreutils differs from one without. Returns the PATH string to use WHOLE —
 *  appending the ambient PATH would put /usr/bin's `timeout` back and measure
 *  nothing. */
function pathWithoutTimeout(home: string, opts: { gtimeout: boolean }): string {
  const bin = path.join(home, '.fakepath');
  mkdirSync(bin, { recursive: true });
  // `bash` and `sleep` are here for the HARNESS, not the hook: vitest spawns
  // the script as `bash <path>` and resolves that name on this PATH, and the
  // hanging-tmux fixture is a `sleep` — with either missing the run dies for a
  // reason that has nothing to do with the bound.
  for (const cmd of ['bash', 'sleep', 'jq', 'date', 'mkdir', 'mv', 'rm', 'cat']) {
    const real = spawnSync('bash', ['-c', `command -v ${cmd}`], { encoding: 'utf8' }).stdout.trim();
    if (real) symlinkSync(real, path.join(bin, cmd));
  }
  expect(spawnSync('bash', ['-c', 'command -v timeout'], { encoding: 'utf8', env: { ...process.env, PATH: bin } }).status,
    'the fixture PATH must not resolve `timeout` — otherwise this test measures the GNU arm again').not.toBe(0);
  if (opts.gtimeout) {
    const real = spawnSync('bash', ['-c', 'command -v timeout'], { encoding: 'utf8' }).stdout.trim();
    writeFileSync(path.join(bin, 'gtimeout'), `#!/bin/sh\nexec ${real} "$@"\n`, { mode: 0o755 });
  }
  return bin;
}

interface UsageRun { out: string; code: number }
function runUsage(home: string, payload: string, opts: { tmux?: string; tmuxHangs?: boolean; pane?: boolean; cfgDir?: string; basePath?: string } = {}): UsageRun {
  const env: NodeJS.ProcessEnv = { ...process.env, HOME: home };
  delete env['CLAUDE_CONFIG_DIR']; delete env['TMUX_PANE'];
  env['CLAUDE_CONFIG_DIR'] = opts.cfgDir ?? path.join(home, '.zeta');
  if (opts.pane !== false) env['TMUX_PANE'] = '%3';
  const rest = opts.basePath ?? env['PATH'] ?? '';
  if (opts.tmuxHangs === true) env['PATH'] = `${tmuxHanging(home)}:${rest}`;
  else if (opts.tmux !== undefined) env['PATH'] = `${tmuxSaying(home, opts.tmux)}:${rest}`;
  else if (opts.basePath !== undefined) env['PATH'] = rest;
  const r = spawnSync('bash', [SCRIPT], { input: payload, encoding: 'utf8', env });
  return { out: r.stdout ?? '', code: r.status ?? -1 };
}

const usageFile = (home: string, rel: string): unknown => {
  const p = path.join(home, '.cc-sessions', 'usage', rel);
  return existsSync(p) ? JSON.parse(readFileSync(p, 'utf8')) : null;
};

describe('statusline-command.sh writes the per-session usage sidecar (routing spec 2026-09-14 §6)', () => {
  const seedReg = (home: string): void => { mkdirSync(path.join(home, '.cc-sessions'), { recursive: true }); };

  // The sidecar block's own comment promises "must never cost the status bar",
  // and this hook's tmux call is the first thing in it that CAN: a tmux client
  // blocks waiting on a server this fleet has measurably lost before, and the
  // status line is itself a surface the server reads back (`parseStatusline`).
  // Bounded by `timeout 2`; drop the bound and this render waits out the whole
  // sleep, which is what the elapsed assertion measures.
  it('a tmux that never answers costs the render the bound, not the wait — the status line still prints', () => {
    const home = seed('ccrc-statusline-usage-hang-'); seedReg(home);
    const t0 = Date.now();
    const r = runUsage(home, usagePayload(), { tmuxHangs: true });
    const elapsed = Date.now() - t0;
    expect(r.code).toBe(0);
    expect(plain(r.out)).toContain('👤 zeta·one');
    expect(elapsed).toBeLessThan(15_000);
    // No ccd id could be derived, so the sidecar is simply not written — the
    // same silence as a pane outside tmux, never a stall.
    expect(existsSync(path.join(home, '.cc-sessions', 'usage'))).toBe(false);
  }, 60_000);

  // `timeout` is GNU. macOS ships it only as `gtimeout` (coreutils), and this
  // file is installed ALONE into ~/.claude with no ccd to source, so it carries
  // the SELECTION arm of `_plat_timeout` rather than the shim. Bare, the bound
  // was also a macOS-only outage of the whole sidecar: no `timeout` on PATH
  // means the substitution never runs tmux at all, so every macOS session went
  // sidecar-less and silently — the shape `macos-platform.test.ts` refuses in
  // the source and these two cases measure in the behaviour.
  it('bounds the tmux call with gtimeout where that is the only spelling on the box, and still writes the sidecar', () => {
    const home = seed('ccrc-statusline-gtimeout-'); seedReg(home);
    const base = pathWithoutTimeout(home, { gtimeout: true });
    const r = runUsage(home, usagePayload(), { tmux: 'cc-demo-bsd-box', basePath: base });
    expect(r.code).toBe(0);
    expect(usageFile(home, 'demo-bsd-box.json')).toMatchObject({ model: 'claude-opus-5', account: 'zeta' });
  }, 60_000);

  it('with neither spelling on the box the render still prints and the call is SKIPPED, never run unbounded', () => {
    const home = seed('ccrc-statusline-nogtimeout-'); seedReg(home);
    const base = pathWithoutTimeout(home, { gtimeout: false });
    // the tmux here HANGS: with no bound available the only safe act is not to
    // call it, so the render must come back fast and sidecar-less rather than
    // wait the hang out.
    const t0 = Date.now();
    const r = runUsage(home, usagePayload(), { tmuxHangs: true, basePath: base });
    const elapsed = Date.now() - t0;
    expect(r.code).toBe(0);
    expect(plain(r.out)).toContain('👤 zeta·one');
    expect(elapsed).toBeLessThan(15_000);
    expect(existsSync(path.join(home, '.cc-sessions', 'usage'))).toBe(false);
  }, 60_000);

  it('writes ~/.cc-sessions/usage/<ccd-id>.json keyed by the tmux name with cc- stripped, carrying ts', () => {
    const home = seed('ccrc-statusline-usage-'); seedReg(home);
    const before = Math.floor(Date.now() / 1000);
    const r = runUsage(home, usagePayload(), { tmux: 'cc-demo-quiet-basin' });
    expect(r.code).toBe(0);
    const row = usageFile(home, 'demo-quiet-basin.json') as Record<string, unknown>;
    expect(row).toEqual({
      ts: expect.any(Number), uuid: '11111111-2222-3333-4444-555555555555', account: 'zeta',
      model: 'claude-opus-5', effort: 'high', ctxPct: 12, cost: 1.25, agent: null,
    });
    expect(row['ts'] as number).toBeGreaterThanOrEqual(before);
    expect(row['ts'] as number).toBeLessThanOrEqual(Math.floor(Date.now() / 1000) + 1);
    // keyed by the ccd id, NEVER the uuid
    expect(usageFile(home, '11111111-2222-3333-4444-555555555555.json')).toBeNull();
    // the limits row still lands — the second side-effect did not displace the first
    expect(limitsRow(home, 'zeta')).toMatchObject({ five: 41, seven: 63 });
  });

  it('an agent render writes <ccd-id>.agents/<name>.json and leaves the main-loop row untouched', () => {
    const home = seed('ccrc-statusline-usage-agent-'); seedReg(home);
    mkdirSync(path.join(home, '.cc-sessions', 'usage'), { recursive: true });
    writeFileSync(path.join(home, '.cc-sessions', 'usage', 'demo-a.json'), '{"ts":1,"marker":true}\n');
    const r = runUsage(home, usagePayload({ agent: { name: 'refute-1' }, model: { id: 'claude-sonnet-5', display_name: 'Sonnet 5' } }),
      { tmux: 'cc-demo-a' });
    expect(r.code).toBe(0);
    expect(usageFile(home, 'demo-a.agents/refute-1.json')).toMatchObject({ agent: 'refute-1', model: 'claude-sonnet-5' });
    expect(usageFile(home, 'demo-a.json')).toEqual({ ts: 1, marker: true });
  });

  it('an agent name outside [A-Za-z0-9._-] writes NOTHING — not the agents file and not the main row', () => {
    const home = seed('ccrc-statusline-usage-badagent-'); seedReg(home);
    mkdirSync(path.join(home, '.cc-sessions', 'usage'), { recursive: true });
    writeFileSync(path.join(home, '.cc-sessions', 'usage', 'demo-a.json'), '{"ts":1,"marker":true}\n');
    runUsage(home, usagePayload({ agent: { name: '../escape' } }), { tmux: 'cc-demo-a' });
    expect(usageFile(home, 'demo-a.json')).toEqual({ ts: 1, marker: true });
    expect(existsSync(path.join(home, '.cc-sessions', 'usage', 'demo-a.agents'))).toBe(false);
  });

  it.each([
    ['no TMUX_PANE', { tmux: 'cc-demo-a', pane: false }],
    ['a tmux session not named cc-*', { tmux: 'scratch' }],
    ['a tmux name with a character outside the id alphabet', { tmux: 'cc-demo a' }],
  ] as const)('%s: no sidecar, and the status line still renders', (_label, opts) => {
    const home = seed('ccrc-statusline-usage-none-'); seedReg(home);
    const r = runUsage(home, usagePayload(), opts);
    expect(r.code).toBe(0);
    expect(plain(r.out)).toContain('Opus 5');
    expect(existsSync(path.join(home, '.cc-sessions', 'usage'))).toBe(false);
  });

  it('no ~/.cc-sessions at all (a box without ccd): no sidecar, no error', () => {
    const home = seed('ccrc-statusline-usage-noreg-');
    const r = runUsage(home, usagePayload(), { tmux: 'cc-demo-a' });
    expect(r.code).toBe(0);
    expect(existsSync(path.join(home, '.cc-sessions'))).toBe(false);
  });

  it('a payload with no effort block and no cost writes nulls, not empty strings', () => {
    const home = seed('ccrc-statusline-usage-nulls-'); seedReg(home);
    const p = JSON.parse(usagePayload()) as Record<string, unknown>;
    delete p['effort']; delete p['cost'];
    runUsage(home, JSON.stringify(p), { tmux: 'cc-demo-a' });
    expect(usageFile(home, 'demo-a.json')).toMatchObject({ effort: null, cost: null, model: 'claude-opus-5' });
  });
});

/** A limits-only payload. `resets_at` is not decoration here: it is what
 *  IDENTIFIES the window a reading belongs to, and the guard under test reads
 *  nothing else to tell an older reading from a newer one. */
function limitsPayload(five: number, seven: number, fiveReset: number | null = 1_800_000_000,
  sevenReset: number | null = 1_800_600_000): string {
  return JSON.stringify({
    model: { display_name: 'Opus 5' },
    workspace: { current_dir: '/nonexistent-for-this-test' },
    rate_limits: {
      five_hour: { used_percentage: five, resets_at: fiveReset },
      seven_day: { used_percentage: seven, resets_at: sevenReset },
    },
  });
}

/** Plants the row a previous session would have left. Written by hand rather
 *  than by a first run so `ts` is a value a test can assert stayed put — the
 *  point of the guard is that a dropped reading re-stamps nothing. */
function seedRow(home: string, row: Record<string, unknown>): void {
  mkdirSync(path.join(home, '.cc-limits'), { recursive: true });
  writeFileSync(path.join(home, '.cc-limits', 'zeta.json'), `${JSON.stringify(row)}\n`);
}

const FRESH_ROW = { five: 41, seven: 63, ts: 1, fiveResetAt: 1_800_000_000, sevenResetAt: 1_800_600_000 };

// `runUsage` is just `run` with a payload argument (its own describe block
// names it for the sidecar because that is what it was added for); the limits
// row is written on the same path, and with no `~/.cc-sessions` in these
// fixtures no sidecar is written at all.
describe('statusline-command.sh keeps the account row monotonic within a window (many writers, one row)', () => {
  // THE DEFECT THIS FILE'S SECOND REASON FOR EXISTING. `rate_limits` is this
  // SESSION's last API response, so an idle session republishes a snapshot of
  // whenever it last ran — with a fresh `ts`, because `ts` is the writer's
  // clock. Twenty sessions on one account are twenty writers of one row.
  // Measured on the live box, one account, one window: 0, 22, 0, 30, 27 within
  // eight seconds, every one of them stamped fresh. Delete the guard and this
  // case goes red, because 9 lands on top of 41.
  it('a session republishing an OLDER reading for the same window neither lowers the row nor re-stamps ts', () => {
    const home = seed('ccrc-statusline-stale-'); seedRow(home, FRESH_ROW);
    const r = runUsage(home, limitsPayload(9, 60));
    expect(r.code).toBe(0);
    // The status BAR still renders the session's own numbers — the guard is
    // about the shared row, not about what this pane prints.
    expect(plain(r.out)).toContain('5h');
    expect(limitsRow(home, 'zeta')).toEqual(FRESH_ROW);
  });

  it('a reading BEHIND on the 7d window alone is dropped, even with the 5h window level', () => {
    const home = seed('ccrc-statusline-stale7d-'); seedRow(home, FRESH_ROW);
    expect(runUsage(home, limitsPayload(41, 60)).code).toBe(0);
    expect(limitsRow(home, 'zeta')).toEqual(FRESH_ROW);
  });

  it('a HIGHER reading lands, carrying a fresh ts', () => {
    const home = seed('ccrc-statusline-higher-');
    seedRow(home, { ...FRESH_ROW, five: 10, seven: 20 });
    const before = Math.floor(Date.now() / 1000);
    expect(runUsage(home, limitsPayload(41, 63)).code).toBe(0);
    const row = limitsRow(home, 'zeta') as Record<string, number>;
    expect(row).toMatchObject({ five: 41, seven: 63, fiveResetAt: 1_800_000_000, sevenResetAt: 1_800_600_000 });
    expect(row['ts']).toBeGreaterThanOrEqual(before);
  });

  // The account whose usage has not moved since the last render is the COMMON
  // case, and `ccd-telemetry-keepalive` exists precisely to keep its `ts`
  // advancing. A guard that dropped an equal reading would age every idle
  // account out on purpose.
  it('an EQUAL reading still lands, so an idle account keeps reading fresh', () => {
    const home = seed('ccrc-statusline-equal-'); seedRow(home, FRESH_ROW);
    const before = Math.floor(Date.now() / 1000);
    expect(runUsage(home, limitsPayload(41, 63)).code).toBe(0);
    expect((limitsRow(home, 'zeta') as Record<string, number>)['ts']).toBeGreaterThanOrEqual(before);
  });

  // The one case a bare "never let it fall" rule would wedge: at a rollover the
  // true reading IS lower than the row, and its `resets_at` is what says so.
  it('a 5h window that has ROLLED OVER lets the row fall to the new window', () => {
    const home = seed('ccrc-statusline-rollover-');
    seedRow(home, { ...FRESH_ROW, five: 90 });
    expect(runUsage(home, limitsPayload(2, 63, 1_800_018_000)).code).toBe(0);
    expect(limitsRow(home, 'zeta')).toMatchObject({ five: 2, fiveResetAt: 1_800_018_000 });
  });

  // The MIRROR of the case above, and the one a same-window rule alone cannot
  // see: after a rollover the row holds the new window's low reading, and a
  // session that has not noticed the rollover republishes the old window's
  // high one. The two are incomparable by value — what says which is older is
  // that the payload's `resets_at` has gone backwards. Its 7d numbers are
  // deliberately LEVEL with the row, so nothing but the rewound 5h window can
  // carry this case.
  it('a session that has not noticed the ROLLOVER cannot drag the row back into the window that ended', () => {
    const home = seed('ccrc-statusline-rewound-');
    seedRow(home, { five: 2, seven: 64, ts: 1, fiveResetAt: 1_800_018_000, sevenResetAt: 1_800_600_000 });
    expect(runUsage(home, limitsPayload(90, 64, 1_800_000_000)).code).toBe(0);
    expect(limitsRow(home, 'zeta')).toEqual({
      five: 2, seven: 64, ts: 1, fiveResetAt: 1_800_018_000, sevenResetAt: 1_800_600_000,
    });
  });

  it.each([
    ['a row written before resets_at existed', { five: 90, seven: 90, ts: 1 }],
    ['a row nothing can parse', null],
  ] as const)('publishes when the comparison is undecidable: %s', (_label, row) => {
    const home = seed('ccrc-statusline-undecidable-');
    if (row === null) {
      mkdirSync(path.join(home, '.cc-limits'), { recursive: true });
      writeFileSync(path.join(home, '.cc-limits', 'zeta.json'), 'not json at all\n');
    } else seedRow(home, row);
    // Fail-OPEN, deliberately: the guard replaces an unconditional write, and a
    // row it cannot reason about must not cost the account its telemetry
    // forever — `projectHome` ranks an unmeasured account below every measured
    // one, so a wedged row is the more expensive silence.
    expect(runUsage(home, limitsPayload(41, 63)).code).toBe(0);
    expect(limitsRow(home, 'zeta')).toMatchObject({ five: 41, seven: 63 });
  });

  // The other half of "many writers, one row": the staging path used to be one
  // fixed `.{acct}.tmp` shared by every session on the account, so two renders
  // landing together truncated and wrote the same file. A directory parked at
  // that exact path is how a test can see which name the script reaches for —
  // with the shared name the redirection fails and no row is ever written.
  it('stages through a per-process temp file, not one path every session shares', () => {
    const home = seed('ccrc-statusline-tmp-');
    mkdirSync(path.join(home, '.cc-limits', '.zeta.tmp'), { recursive: true });
    expect(runUsage(home, limitsPayload(41, 63)).code).toBe(0);
    expect(limitsRow(home, 'zeta')).toMatchObject({ five: 41, seven: 63 });
  });
});

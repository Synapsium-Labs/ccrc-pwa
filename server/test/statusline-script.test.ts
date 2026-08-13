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
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { parseRoster } from '../../shared/roster.js';
import { generateAccountsSh } from '../../shared/generate.mjs';
import { mkTmp } from './tmpHelpers.js';

const SCRIPT = path.resolve(__dirname, '../../ccd/statusline-command.sh');

// Production-shaped: one upstream account, one `telemetry: 'none'` external
// (the `gpt` case), and `zeta` — a free-form account with an id and a config
// dir that no hand-written map in this repo's history ever named.
const ROSTER = {
  version: 1,
  accounts: [
    { id: 'claude', label: 'team·max', configDirSuffix: '.claude', exec: { kind: 'upstream' }, homeAble: true, hue: 'cyan', telemetry: 'anthropic' },
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

  it('colours the account with its roster hue', () => {
    const home = seed('ccrc-statusline-hue-');
    // `amber` has no 16-colour equivalent left (33 is the yellow the limit
    // bars already use), so it comes from the 256-colour cube — asserted here
    // because a hue silently falling through to no colour is invisible to
    // every text assertion in this file.
    expect(run(home, path.join(home, '.zeta')).out).toContain('[38;5;214mzeta·one');
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

  it('resolves an unset CLAUDE_CONFIG_DIR to the roster\'s upstream account', () => {
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

// ccd and the ccrc server both read ~/.cc-limits and both decide something from
// it — routing and the accounts strip respectively. They cannot share code
// across the language boundary, so they share FIXTURES instead: if either
// implementation of the rollover rule drifts, this file goes red.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import fs from 'node:fs';
import { rolloverCases } from './fixtures/rollover.js';
import { CCD, ghContainedEnv, seedAccountsSh } from './ccdWsHelpers.js';
import { mkTmp } from './tmpHelpers.js';

let home: string;

/** ccd reads the clock itself, so fixtures are written relative to real now. */
const now = (): number => Math.floor(Date.now() / 1000);

const sh = (snippet: string): string =>
  execFileSync('bash', ['-c', `source "${CCD}"; ${snippet}`],
    // `ghContainedEnv` is the harness's gh boundary, applied here too: this
    // file predates `makeCcdHarness` and builds its own HOME, and containment
    // that holds in one harness and not the one beside it is not containment.
    { encoding: 'utf8', env: ghContainedEnv(home, { ...process.env, HOME: home }, { systemd: true, tmux: true }) }).trim();

beforeEach(() => {
  home = mkTmp('ccrc-ccd-limits-');
  // ccd refuses to run without `~/.ccrc/accounts.sh`. Same reason as
  // `ghContainedEnv` above: this file predates `makeCcdHarness` and builds its
  // own HOME, and a fixture home that ccd will not source is not a fixture.
  seedAccountsSh(home);
  fs.mkdirSync(path.join(home, '.cc-limits'), { recursive: true });
  // _avail requires the wrapper binary to exist and be executable.
  const bin = path.join(home, '.local', 'bin');
  fs.mkdirSync(bin, { recursive: true });
  for (const w of ['claude', 'claude2', 'claude-corp']) {
    fs.writeFileSync(path.join(bin, w), '#!/bin/sh\n', { mode: 0o755 });
  }
});

afterEach(() => { fs.rmSync(home, { recursive: true, force: true }); });

const writeLimits = (file: string, content: string): void =>
  fs.writeFileSync(path.join(home, '.cc-limits', file), content);

const json = (o: Record<string, number>): string => JSON.stringify(o);

/** readLimits says "unknown" with null; _limit_field says it with an empty
 *  string. Same state, two vocabularies — translate, don't compare literally,
 *  or `String(null)` quietly demands that bash print the word "null". */
const asShell = (v: number | null): string => (v === null ? '' : String(v));

describe('_limit_field rollover', () => {
  it('agrees with readLimits on every shared fixture', () => {
    for (const c of rolloverCases(now())) {
      const wrapper = c.file.slice(0, -'.json'.length);
      writeLimits(c.file, c.content);
      expect(sh(`_limit_field ${wrapper} five`), `${c.file} five: ${c.why}`)
        .toBe(asShell(c.expect.five));
      expect(sh(`_limit_field ${wrapper} seven`), `${c.file} seven: ${c.why}`)
        .toBe(asShell(c.expect.seven));
    }
  });

  it('still answers "unknown" when the caller demanded fresh telemetry', () => {
    // The maxage gate must win: a caller asking for fresh data gets nothing,
    // not an inferred 0 it did not ask for.
    const t = now();
    writeLimits('claude.json', json({ five: 50, seven: 50, ts: t - 9000, fiveResetAt: t - 100, sevenResetAt: t - 100 }));
    expect(sh('_limit_field claude five 1800')).toBe('');
  });
});

describe('_gpt_status on a python-written gpt.json', () => {
  // ~/.cc-limits/gpt.json is written by infra/handoff/ccgpt-usage (python
  // json.dump), whose default separators put a space after every colon. Every
  // other reader in ccd tolerates that; _gpt_status must too, or `ccd ls`
  // silently drops the cooldown countdown it exists to print.
  const excludeGpt = (spacing: string): void => {
    fs.writeFileSync(path.join(home, '.local', 'bin', 'gpt'), '#!/bin/sh\n', { mode: 0o755 });
    // 30m30s into the 5h cooldown: the remaining minutes floor to 269 for a
    // full half-minute, so ccd reading its own clock a beat later can't flake.
    const t = now() - 1830;
    writeLimits('gpt.json', `{"five":${spacing}100,"seven":${spacing}0,"ts":${spacing}${t}}`);
  };

  it('reports the remaining cooldown when json.dump spaced the colons', () => {
    excludeGpt(' ');
    expect(sh('_gpt_status')).toBe('429-excluded (~269m of 5h cooldown left)');
  });

  it('still reports it for compact printf-written json', () => {
    excludeGpt('');
    expect(sh('_gpt_status')).toBe('429-excluded (~269m of 5h cooldown left)');
  });
});

describe('_gpt_status must not call a Codex weekly cap a 5h cooldown', () => {
  // The 429 exclusion ccd writes itself survives at most 20 minutes: the
  // ccgpt-usage timer overwrites gpt.json with a usage sample on every poll.
  // That sample is the shape on disk essentially always, and every word of the
  // "429-excluded (~Nm of 5h cooldown left)" line is wrong about it — no 429
  // happened, Codex Pro has no 5h window ("five": null), and `ts` is the poll
  // time, so the countdown would hover near 300m forever while the real
  // sevenResetAt sits days out.
  const usageSample = (o: Record<string, number | null>): void => {
    fs.writeFileSync(path.join(home, '.local', 'bin', 'gpt'), '#!/bin/sh\n', { mode: 0o755 });
    // Spaced colons: json.dump's default separators, i.e. what is really on disk.
    writeLimits('gpt.json',
      `{${Object.entries(o).map(([k, v]) => `"${k}": ${v}`).join(', ')}}`);
  };

  it('reports the weekly figure and its reset, not a cooldown', () => {
    const t = now();
    usageSample({ five: null, seven: 99, ts: t - 300, fiveResetAt: null, sevenResetAt: t + 397440 });
    expect(sh('_gpt_status')).toBe('Codex weekly cap reached (99%, resets in 5d)');
  });

  it('never counts down past zero when the usage timer has stalled', () => {
    // 6h-old poll: the old arithmetic printed "~-60m of 5h cooldown left".
    const t = now();
    usageSample({ five: null, seven: 99, ts: t - 21600, fiveResetAt: null, sevenResetAt: t + 7200 });
    expect(sh('_gpt_status')).toBe('Codex weekly cap reached (99%, resets in 2h)');
  });

  it('names the 5h window when the backend really reported one', () => {
    const t = now();
    usageSample({ five: 100, seven: 40, ts: t - 120, fiveResetAt: t + 5400, sevenResetAt: t + 200000 });
    expect(sh('_gpt_status')).toBe('Codex 5h cap reached (100%, resets in 90m)');
  });

  it('omits the reset when the API gave none for the binding window', () => {
    const t = now();
    usageSample({ five: null, seven: 100, ts: t - 120, fiveResetAt: null, sevenResetAt: null });
    expect(sh('_gpt_status')).toBe('Codex weekly cap reached (100%)');
  });

  it('still says available when the usage sample is under the ceiling', () => {
    const t = now();
    usageSample({ five: null, seven: 12, ts: t - 120, fiveResetAt: null, sevenResetAt: t + 200000 });
    expect(sh('_gpt_status')).toBe('enabled, available');
  });
});

describe('_gpt_status disabled branch goes through _lane_enabled, not a second read of the marker path', () => {
  // Before this fix, _gpt_status checked `[[ -f "$GPT_DISABLE_FILE" ]]`
  // directly while _gpt_enabled/_account_ok went through _lane_enabled — two
  // readers of one boolean, spelled two different ways, free to drift. These
  // tests override _lane_enabled itself (a plain shell function redefinition,
  // resolved at call time) and check that _gpt_status follows THAT, not the
  // marker file on disk — a direct `-f` check would ignore the override
  // entirely and fail both assertions below.
  const installGpt = (): void => {
    fs.writeFileSync(path.join(home, '.local', 'bin', 'gpt'), '#!/bin/sh\n', { mode: 0o755 });
    fs.mkdirSync(path.join(home, '.cc-sessions'), { recursive: true });
  };

  it('reports DISABLED when _lane_enabled says so, even with no marker file on disk', () => {
    installGpt();
    expect(sh('_lane_enabled() { return 1; }; _gpt_status')).toContain('DISABLED');
  });

  it('does not report DISABLED when _lane_enabled says enabled, even with the marker file present', () => {
    installGpt();
    fs.writeFileSync(path.join(home, '.cc-sessions', 'gpt-disabled'), '');
    expect(sh('_lane_enabled() { return 0; }; _gpt_status')).not.toContain('DISABLED');
  });

  it('names the real marker path in the message (GPT_DISABLE_FILE survives as the display path)', () => {
    installGpt();
    fs.writeFileSync(path.join(home, '.cc-sessions', 'gpt-disabled'), '');
    expect(sh('_gpt_status')).toBe(`DISABLED (kill-switch; rm ${home}/.cc-sessions/gpt-disabled to re-enable)`);
  });
});

describe('_fmt_eta unit boundaries', () => {
  // The unit used to be chosen from raw seconds and the figure rounded afterwards,
  // so 7199s rounded to 120 minutes but stayed in the minutes branch and printed
  // "in 120m" — while 7200s printed "in 2h". Any test landing on that boundary was
  // a coin flip on whether bash read the clock in the same second the fixture was
  // built. Every offset here must give the SAME answer either side of the seam, so
  // a one-second slip cannot change the result.
  it.each([
    [7199, 'in 2h'], [7200, 'in 2h'], [7201, 'in 2h'],
    [172799, 'in 2d'], [172800, 'in 2d'], [172801, 'in 2d'],
  ])('%ds ahead reads %s', (offset, want) => {
    expect(sh(`_fmt_eta $(( $(date +%s) + ${offset} ))`)).toBe(want);
  });

  it('never prints a figure that has reached its own next unit', () => {
    // 120m and 48h are the strings this guards against; both are reachable only
    // through the rounding seam.
    for (const offset of [7100, 7150, 7199, 7200, 171000, 172700, 172799]) {
      const out = sh(`_fmt_eta $(( $(date +%s) + ${offset} ))`);
      expect(out, `${offset}s produced ${out}`).not.toBe('in 120m');
      expect(out, `${offset}s produced ${out}`).not.toBe('in 48h');
    }
  });
});

describe('the account that was stranded on 2026-07-27', () => {
  const strand = (): void => {
    const t = now();
    // claude: 20h-old sample, 7d window reset 14h ago -> read as 98 before the fix.
    writeLimits('claude.json', json({ five: 10, seven: 98, ts: t - 72000, fiveResetAt: t - 72000, sevenResetAt: t - 50000 }));
    writeLimits('claude2.json', json({ five: 0, seven: 93, ts: t - 60, fiveResetAt: t + 17000, sevenResetAt: t + 105000 }));
    writeLimits('claude-corp.json', json({ five: 9, seven: 57, ts: t - 60, fiveResetAt: t + 17000, sevenResetAt: t + 260000 }));
    // Registry for a session whose HOME is claude but which sits on gpt.
    const reg = path.join(home, '.cc-sessions');
    fs.mkdirSync(reg, { recursive: true });
    fs.writeFileSync(path.join(reg, 'claude-synapsium-platform.home'), 'claude');
    fs.writeFileSync(path.join(reg, 'claude-synapsium-platform.wrapper'), 'gpt');
  };

  it('makes the home account available again', () => {
    strand();
    expect(sh('_avail claude && echo AVAIL || echo NO')).toBe('AVAIL');
  });

  it('sends the exiled session home instead of leaving it on gpt', () => {
    strand();
    expect(sh('_swap_target claude-synapsium-platform gpt claude')).toBe('claude');
  });
});

describe('_swap_target force arg: gates the two "stay" shortcuts only', () => {
  // Verifier reproduction: a 429-while-away session (wrapper=claude2, home=claude) with home
  // recovered (five=50, under SWAP_CEILING) must rescue straight home under force, not fall
  // through to the must-leave candidate loop and land on some third lane (claude-corp, five=0,
  // would otherwise look like the least-loaded pick).
  it('forced away-from-home call still returns home when home has recovered', () => {
    writeLimits('claude.json', json({ five: 50, seven: 0, ts: now() }));
    writeLimits('claude-corp.json', json({ five: 0, seven: 0, ts: now() }));
    expect(sh('_swap_target claude-demo claude2 claude 1')).toBe('claude');
  });

  it('leaves the unforced away-from-home call unchanged (same fixture, no force arg)', () => {
    writeLimits('claude.json', json({ five: 50, seven: 0, ts: now() }));
    writeLimits('claude-corp.json', json({ five: 0, seven: 0, ts: now() }));
    expect(sh('_swap_target claude-demo claude2 claude')).toBe('claude');
  });

  // The Critical force exists for: a hard-blocked session must not read "cur/home is fine: stay"
  // off telemetry that a rate limit never touched (auth loss writes no cc-limits file at all).
  it('bypasses the cur==home "stay" shortcut: forced call leaves a fine home for the pool', () => {
    writeLimits('claude.json', json({ five: 10, seven: 0, ts: now() }));
    expect(sh('_swap_target claude-demo claude claude')).toBe('');       // unforced: stays (sanity)
    expect(sh('_swap_target claude-demo claude claude 1')).not.toBe(''); // forced: leaves anyway
  });

  it('bypasses the "cur still works" shortcut: forced call leaves a fine cur for the pool', () => {
    writeLimits('claude.json', json({ five: 99, seven: 0, ts: now() }));   // home: at the ceiling
    writeLimits('claude2.json', json({ five: 5, seven: 0, ts: now() }));   // cur: fine
    expect(sh('_swap_target claude-demo claude2 claude')).toBe('');        // unforced: stays on cur
    expect(sh('_swap_target claude-demo claude2 claude 1')).not.toBe(''); // forced: leaves anyway
  });
});

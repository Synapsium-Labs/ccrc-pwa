// The spec requires the `+` to show "the account it is about to assign and its
// current headroom" BEFORE the tap, because "a workspace that silently lands on
// an exhausted account presents as a stalled session with no explanation".
//
// The routing rule itself is `_ws_least_loaded` (ccd:2451) — bash, and the
// authority: it is what actually writes `home`. `projectHome` only PREDICTS it
// for the display. Two implementations of one rule drift, so this file drives
// BOTH over identical fixtures and demands they agree on the wrapper AND the
// score, the way ccd-limits.test.ts does for the rollover rule.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import fs from 'node:fs';
import { loadConfig } from '../src/config.js';
import { localIO } from '../src/io.js';
import { readLimits, projectHome, type AccountLimits } from '../src/limits.js';
import { parseRoster } from '../../shared/roster.js';
import { leastLoadedCases } from './fixtures/leastLoaded.js';
import { mkTmp } from './tmpHelpers.js';
import { seedRoster } from './helpers.js';
import { CCD, seedAccountsSh } from './ccdWsHelpers.js';

let home: string;

/** ccd reads the clock itself, so fixtures live against real now. */
const now = (): number => Math.floor(Date.now() / 1000);

const sh = (snippet: string): string =>
  execFileSync('bash', ['-c', `source "${CCD}"; ${snippet}`],
    { encoding: 'utf8', env: { ...process.env, HOME: home } }).trim();

beforeEach(() => {
  home = mkTmp('ccrc-projected-');
  // BOTH projections of the one roster, into the one fixture home: `accounts.json`
  // for `loadConfig` and `accounts.sh` for ccd. That they are generated from the
  // same `DEFAULT_TEST_ROSTER` is what makes the pairing below a comparison of two
  // RULES rather than of two rosters — this file's whole point.
  seedRoster(home);
  seedAccountsSh(home);
  fs.mkdirSync(path.join(home, '.cc-limits'), { recursive: true });
  const bin = path.join(home, '.local', 'bin');
  fs.mkdirSync(bin, { recursive: true });
  for (const w of ['claude', 'claude-a', 'claude-b', 'gpt', 'claude-d']) {
    fs.writeFileSync(path.join(bin, w), '#!/bin/sh\n', { mode: 0o755 });
  }
});

afterEach(() => { fs.rmSync(home, { recursive: true, force: true }); });

const seed = (files: Record<string, string>): void => {
  for (const name of fs.readdirSync(path.join(home, '.cc-limits'))) {
    fs.rmSync(path.join(home, '.cc-limits', name));
  }
  for (const [wrapper, content] of Object.entries(files)) {
    fs.writeFileSync(path.join(home, '.cc-limits', `${wrapper}.json`), content);
  }
};

/** `<w>-disabled` in `.cc-sessions` — the one file both `_lane_enabled` (ccd's
 *  `$REG`) and `readLimits` (the server's registryDir) read, same directory,
 *  same filename. */
const seedDisabled = (wrappers: string[]): void => {
  const dir = path.join(home, '.cc-sessions');
  fs.mkdirSync(dir, { recursive: true });
  for (const name of fs.readdirSync(dir)) {
    if (name.endsWith('-disabled')) fs.rmSync(path.join(dir, name));
  }
  for (const w of wrappers) {
    fs.writeFileSync(path.join(dir, `${w}-disabled`), '');
  }
};

/** `_limit_score` says "wholly unknown" with an empty string, and `|| '0'` is
 *  only reached for a wrapper no fixture expects to WIN — every `c.expect`
 *  names a measured account now, since neither side lets an unmeasured one win
 *  while a measured one exists (Task 6). Kept as a total function anyway: it
 *  reads a score for whichever wrapper the fixture names, and a bare `Number('')`
 *  would be `NaN` rather than a legible failure. */
const shellScore = (wrapper: string): number => Number(sh(`_limit_score ${wrapper}`) || '0');

describe('projectHome agrees with ccd _ws_least_loaded', () => {
  it.each(leastLoadedCases(now()).map((c) => [c.name, c] as const))(
    '%s',
    async (_name, c) => {
      seed(c.files);
      seedDisabled(c.disabled ?? []);
      const cfg = loadConfig({ CCRC_HOME: home });
      const projected = projectHome(cfg.roster, await readLimits(localIO, cfg));

      if (c.expect === null) {
        // Nothing is placeable. The fixture can't express one shared "empty"
        // value across languages (TS has `null`, bash has empty stdout), so
        // this is the split expectation the runner promises: two assertions,
        // one per side, neither weakened.
        expect(projected, c.why).toBeNull();
        expect(sh('_ws_least_loaded'), `ccd disagrees: ${c.why}`).toBe('');
        return;
      }

      // 1. The prediction is right in its own terms.
      expect(projected, c.why).toEqual(c.expect);
      // 2. …and bash, the authority, picks the same account.
      expect(sh('_ws_least_loaded'), `ccd disagrees: ${c.why}`).toBe(c.expect.wrapper);
      // 3. …and scores it the same, so the headroom the user reads is the
      //    headroom the account really has.
      expect(shellScore(c.expect.wrapper), `score drift: ${c.why}`).toBe(c.expect.score);
    },
  );
});

describe('projectHome edge cases', () => {
  it('projects claude at full headroom when there is no telemetry at all', () => {
    // First boot, or a limits dir nothing has written yet. NOTHING is measured,
    // so the rule cannot rank at all — and "cannot rank" must not become
    // "cannot place", or a fresh install would be told no account can take a
    // workspace. Both sides fall back to the first home-able account at score
    // 0, which is exactly what ccd does with the same empty directory.
    expect(projectHome(loadConfig({ CCRC_HOME: home }).roster, {})).toEqual({ wrapper: 'claude', score: 0 });
    expect(sh('_ws_least_loaded')).toBe('claude');
  });
});

// The scoring rule in isolation, against a synthetic roster — no filesystem, no
// bash. The pairing suite above proves the two implementations agree; this one
// pins WHAT they agree on, over shapes the production roster cannot express
// (an account that will never report, and one whose real on-disk telemetry is
// half-null).
describe('projectHome ranks unmeasured below measured', () => {
  const r = parseRoster({ version: 1, accounts: [
    { id: 'a', label: 'A', configDirSuffix: '.a', exec: { kind: 'upstream' }, homeAble: true, hue: 'cyan', telemetry: 'anthropic' },
    { id: 'b', label: 'B', configDirSuffix: '.b', exec: { kind: 'generated' }, homeAble: true, hue: 'violet', telemetry: 'anthropic' },
    { id: 'g', label: 'G', configDirSuffix: '.g', exec: { kind: 'external' }, homeAble: true, hue: 'blue', telemetry: 'none' },
  ] });
  const L = (five: number | null, seven: number | null): AccountLimits =>
    ({ five, seven, ts: 1, fiveResetAt: null, sevenResetAt: null,
       fiveRolledOver: false, sevenRolledOver: false, disabled: false });

  it('an unmeasured account never beats a measured one', () => {
    // The bug, in one line: before Task 6 this returned `{ wrapper: 'b',
    // score: 0 }` — b has no telemetry row at all, and `?? 0` made "nobody has
    // ever looked" indistinguishable from "measured empty". Confirmed against
    // the live tree, where {claude:5, 'claude-a':6, claude-b:7} projected onto
    // claude-d at 0.
    expect(projectHome(r, { a: L(5, 5) })).toEqual({ wrapper: 'a', score: 5 });
  });

  it('a telemetry:none account is never scored, even reporting a real measured zero', () => {
    // `L(0, 0)` — a REAL measured zero — is the ONLY shape that tests this
    // filter, and getting that wrong is how the filter shipped with no
    // coverage at all: written first with gpt's real on-disk `L(null, 0)`,
    // this case stayed green with `const scorable = live` (the filter deleted
    // outright), because `measured()` rejects a half-null row anyway and was
    // silently doing the work. Three things could exclude `g` here and only one
    // of them is under test, so the other two are deliberately switched off:
    // `g` is home-able (not held out by `homeAble`, which is what hides this in
    // production — gpt is the only telemetry:'none' account and is excluded
    // that way regardless) and fully measured (not held out by `measured()`).
    // With the filter present the answer is `b`; delete the filter and `g` wins
    // at 0.
    expect(projectHome(r, { a: L(90, 90), b: L(80, 80), g: L(0, 0) })).toEqual({ wrapper: 'b', score: 80 });
  });

  it("a telemetry:none account is never scored on gpt's real half-null shape either", () => {
    // The production shape, kept as its own case: `~/.cc-limits/gpt.json` is
    // `{"five": null, "seven": 0}`. Both exclusions apply here and this case
    // cannot tell them apart — which is exactly why the case above exists. It
    // pins the ANSWER for the shape that actually reaches disk today.
    expect(projectHome(r, { a: L(90, 90), b: L(80, 80), g: L(null, 0) })).toEqual({ wrapper: 'b', score: 80 });
  });

  it("a five:null account is unmeasured, not zero — gpt's real on-disk shape", () => {
    // `~/.cc-limits/gpt.json` really is `{"five": null, "seven": 0}`: gpt has no
    // 5h window at all. A row half-full of nulls scores nothing, exactly as an
    // absent row does.
    expect(projectHome(r, { a: L(5, 5), b: L(null, 0) })).toEqual({ wrapper: 'a', score: 5 });
  });

  it('falls back to the first home-able account when NOTHING is measured — a fresh install must still place work', () => {
    expect(projectHome(r, {})).toEqual({ wrapper: 'a', score: 0 });
  });

  it('still returns null when every home-able lane is disabled', () => {
    // Unplaceable is still a real answer, and it is this one — not "unmeasured".
    expect(projectHome(r, {
      a: { ...L(1, 1), disabled: true },
      b: { ...L(1, 1), disabled: true },
      g: { ...L(1, 1), disabled: true },
    })).toBeNull();
  });

  it('ties go to the earlier account in roster order', () => {
    // `<`, not `<=` — the same strictly-less-than bash compares with. ccd's own
    // `_ws_least_loaded` fixture (`tie`) pins the other side of this.
    expect(projectHome(r, { a: L(50, 50), b: L(50, 50) })).toEqual({ wrapper: 'a', score: 50 });
  });
});

// ── §4.6: the two placement implementations agree about TELEMETRY, not only
//    about the presence of a file ────────────────────────────────────────────
// Before this task (at `4c834bb3`), `_ws_least_loaded`'s docstring's "Parity
// holds today" paragraph stated the standing position: parity held "because
// both gaps are reachable only through the SAME account — gpt is the only
// telemetry:'none' account and gpt is not home-able", and called that "an
// agreement of circumstance, not of rule", naming THIS file as the suite that
// would say so the day the circumstance changed. Decision 22 creates a
// provider class that is telemetry:'none' by construction and may be declared
// homeAble, so the circumstance is over. Every roster below is one
// DEFAULT_TEST_ROSTER cannot express, which is why these cases live in their
// own home rather than in the shared fixture table above.
describe('ccd and projectHome agree about telemetry, not only about limits files', () => {
  let h: string;

  /** One roster into both projections of the same home — `accounts.json` for
   *  `loadConfig` and `accounts.sh` for ccd — so what follows compares two
   *  RULES and not two rosters. Wrapper stubs for every id, because
   *  `_account_ok` tests `-x "$WRAPPER_DIR/$1"` and an account with no stub is
   *  held out by a check that is not the one under test. */
  const seedBoth = (roster: unknown, limits: Record<string, string> = {}): void => {
    h = mkTmp('ccrc-measured-parity-');
    seedRoster(h, roster);
    seedAccountsSh(h, roster);
    fs.mkdirSync(path.join(h, '.cc-limits'), { recursive: true });
    fs.mkdirSync(path.join(h, '.cc-sessions'), { recursive: true });
    const bin = path.join(h, '.local', 'bin');
    fs.mkdirSync(bin, { recursive: true });
    for (const a of (roster as { accounts: { id: string }[] }).accounts) {
      fs.writeFileSync(path.join(bin, a.id), '#!/bin/sh\n', { mode: 0o755 });
    }
    for (const [id, body] of Object.entries(limits)) {
      fs.writeFileSync(path.join(h, '.cc-limits', `${id}.json`), body);
    }
  };

  const shH = (snippet: string): string =>
    execFileSync('bash', ['-c', `source "${CCD}"; ${snippet}`],
      { encoding: 'utf8', env: { ...process.env, HOME: h } }).trim();

  afterEach(() => { if (h !== undefined) fs.rmSync(h, { recursive: true, force: true }); });

  const acct = (id: string, label: string, telemetry: 'anthropic' | 'none', homeAble = true) => ({
    id, label, configDirSuffix: `.claude-${id}`,
    exec: id === 'a' ? { kind: 'upstream' } : { kind: 'external' },
    homeAble, hue: id === 'a' ? 'cyan' : id === 'b' ? 'violet' : 'blue', telemetry,
  });
  const L = (five: number, seven: number): string =>
    JSON.stringify({ five, seven, ts: Math.floor(Date.now() / 1000), fiveResetAt: null, sevenResetAt: null });

  it('a home-able telemetry:none lane with a limits file is scored by NEITHER side', () => {
    // The first half of the gap. `g` reports a real measured zero — the only
    // shape that tests this, and the reason `projected-home.test.ts:147-161`
    // already makes the same argument for the TypeScript half: written with
    // gpt's real half-null row, the case would stay green with the filter
    // deleted outright, because `measured()` rejects a half-null row anyway.
    const roster = { version: 1, accounts: [
      acct('a', 'team·max', 'anthropic'),
      acct('b', 'alt·max', 'anthropic'),
      acct('g', 'team·shared', 'none'),
    ] };
    seedBoth(roster, { a: L(90, 90), b: L(80, 80), g: L(0, 0) });
    expect(shH('_ws_least_loaded')).toBe('b');
  });

  it('…and both sides agree on it, over the same home', async () => {
    const roster = { version: 1, accounts: [
      acct('a', 'team·max', 'anthropic'),
      acct('b', 'alt·max', 'anthropic'),
      acct('g', 'team·shared', 'none'),
    ] };
    seedBoth(roster, { a: L(90, 90), b: L(80, 80), g: L(0, 0) });
    const cfg = loadConfig({ CCRC_HOME: h });
    const projected = projectHome(cfg.roster, await readLimits(localIO, cfg));
    expect(projected).toEqual({ wrapper: 'b', score: 80 });
    expect(shH('_ws_least_loaded'), 'ccd disagrees with projectHome').toBe(projected!.wrapper);
  });

  it('with NOTHING measured, both fall back to the first account that COULD report', async () => {
    // The second half of the gap, and it is not in §4.6 at all. `projectHome`
    // falls back to `scorable[0] ?? live[0]` (limits.ts:106) — the first lane
    // whose roster entry says it reports — while bash fell back to `first`, the
    // first `_account_ok` account in CCRC_HOME_ABLE order regardless of
    // telemetry. With `g` declared FIRST and no limits file anywhere, the two
    // named different accounts.
    const roster = { version: 1, accounts: [
      acct('g', 'team·shared', 'none'),
      acct('a', 'team·max', 'anthropic'),
    ] };
    // The helper keys `kind` off the id (`a` is the upstream), so declaring `g`
    // first puts a telemetry:'none' lane at the head of CCRC_HOME_ABLE while
    // keeping parseRoster's exactly-one-upstream rule satisfied. That ordering
    // IS the test: it is the only shape in which the two fallbacks differ.
    seedBoth(roster);
    const cfg = loadConfig({ CCRC_HOME: h });
    const projected = projectHome(cfg.roster, await readLimits(localIO, cfg));
    expect(projected).toEqual({ wrapper: 'a', score: 0 });
    expect(shH('_ws_least_loaded'), 'ccd disagrees with projectHome').toBe('a');
  });

  it('with NOTHING measured and NO lane that could report, both still place work', async () => {
    // `scorable[0] ?? live[0]` — the second half of that fallback. A roster
    // whose every home-able lane opts out of telemetry must still be placeable,
    // or a box of api-key lanes could not take a workspace at all.
    const roster = { version: 1, accounts: [
      { ...acct('a', 'team·max', 'none'), exec: { kind: 'upstream' } },
      { ...acct('b', 'alt·max', 'none'), exec: { kind: 'external' } },
    ] };
    seedBoth(roster);
    const cfg = loadConfig({ CCRC_HOME: h });
    const projected = projectHome(cfg.roster, await readLimits(localIO, cfg));
    expect(projected).toEqual({ wrapper: 'a', score: 0 });
    expect(shH('_ws_least_loaded')).toBe('a');
  });

  it('an accounts.sh that predates CCRC_MEASURED means "the roster did not say", not "nothing reports"', () => {
    // AGENT-FIRST deploys put a new `ccd` on a box beside whatever
    // `accounts.sh` is already there, and a file written before Stage 2a has no
    // CCRC_MEASURED line at all. UNSET and SET-AND-EMPTY must not collapse: the
    // first is silence and the second is an answer. Measured: `declare -p`
    // returns 1 for an unset array and 0 for `CCRC_MEASURED=()`.
    const roster = { version: 1, accounts: [
      { ...acct('a', 'team·max', 'anthropic'), exec: { kind: 'upstream' } },
      { ...acct('b', 'alt·max', 'anthropic'), exec: { kind: 'external' } },
    ] };
    seedBoth(roster, { a: L(90, 90), b: L(10, 10) });
    const sh = path.join(h, '.ccrc', 'accounts.sh');
    fs.writeFileSync(sh, fs.readFileSync(sh, 'utf8').split('\n')
      .filter((l) => !l.startsWith('CCRC_MEASURED=')).join('\n'));
    // Both accounts still rank, so the cheaper one still wins — the old
    // behaviour, unchanged, on a box the new ccd has outrun.
    expect(shH('_ws_least_loaded')).toBe('b');
    expect(shH('_account_measured a && echo yes || echo no')).toBe('yes');
  });

  it('a roster where the file SAYS none is a different answer from a file that never said', () => {
    const roster = { version: 1, accounts: [
      { ...acct('a', 'team·max', 'none'), exec: { kind: 'upstream' } },
    ] };
    seedBoth(roster);
    expect(fs.readFileSync(path.join(h, '.ccrc', 'accounts.sh'), 'utf8')).toContain('CCRC_MEASURED=()');
    // THE POSITIVE CONTROL, and it is not decoration. `_account_measured a &&
    // echo yes || echo no` answers "no" when the function does not exist at
    // all: bash prints `command not found` on stderr, returns 127, `&&` is
    // skipped and `||` runs — so the shell pipeline still exits 0 and this
    // assertion would PASS against a tree with no predicate in it. Asserting
    // the function is DEFINED is what makes the row red before Step 3a and
    // green after.
    expect(shH('declare -F _account_measured >/dev/null && echo defined || echo missing'))
      .toBe('defined');
    expect(shH('_account_measured a && echo yes || echo no')).toBe('no');
  });
});

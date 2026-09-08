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

/** `<w>-authdead` in `.cc-sessions` — the account-health probe's marker, in the
 *  same directory `<w>-disabled` lives in, so both implementations read it off
 *  the one `readdir`/glob they already do. */
const seedAuthDead = (wrappers: string[]): void => {
  const dir = path.join(home, '.cc-sessions');
  fs.mkdirSync(dir, { recursive: true });
  for (const name of fs.readdirSync(dir)) {
    if (name.endsWith('-authdead')) fs.rmSync(path.join(dir, name));
  }
  for (const w of wrappers) {
    fs.writeFileSync(path.join(dir, `${w}-authdead`), '1757203200 auth-401');
  }
};

/** A present-but-malformed `<w>-authdead` — arbitrary raw content, not the
 *  well-formed `"<epoch> <reason>"` `seedAuthDead` writes. Called AFTER
 *  `seedAuthDead` in the runner below, deliberately: `seedAuthDead` sweeps
 *  every `-authdead` file before writing its own, so a malformed marker
 *  written first would be wiped by a later `seedAuthDead([])` call. */
const seedAuthDeadMalformed = (byWrapper: Record<string, string>): void => {
  const dir = path.join(home, '.cc-sessions');
  fs.mkdirSync(dir, { recursive: true });
  for (const [w, content] of Object.entries(byWrapper)) {
    fs.writeFileSync(path.join(dir, `${w}-authdead`), content);
  }
};

/** `_limit_score` says "wholly unknown" with an empty string, and `|| '0'` IS
 *  reached — by `all-rolled-over`, whose expected winner is unmeasured on both
 *  sides the moment the provenance fix lands (until then it is an inferred 0 on
 *  both sides, which is the same 0 by a dishonest route). That case is the
 *  documented fallback ("if NOTHING is measured, the first home-able account in
 *  roster order, at score 0"), so bash answers "" for the very wrapper the
 *  fixture names, and `|| '0'` is what turns that into the 0 the fixture
 *  asserts. It is therefore LOAD-BEARING, not a courtesy: a bare `Number('')`
 *  would be `NaN` and red that case for a reason that has nothing to do with
 *  placement. */
const shellScore = (wrapper: string): number => Number(sh(`_limit_score ${wrapper}`) || '0');

describe('projectHome agrees with ccd _ws_least_loaded', () => {
  it.each(leastLoadedCases(now()).map((c) => [c.name, c] as const))(
    '%s',
    async (_name, c) => {
      seed(c.files);
      seedDisabled(c.disabled ?? []);
      seedAuthDead(c.authDead ?? []);
      seedAuthDeadMalformed(c.authDeadMalformed ?? {});
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
       fiveRolledOver: false, sevenRolledOver: false, disabled: false, authDead: false });

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

  it('an INFERRED zero never beats a measured account — the placement magnet, third site', () => {
    // `L(0, 0)` with both flags set is the shape readLimits produces for an
    // account whose windows have turned over: the zeroes are real fields on the
    // wire (the accounts screen renders them as "reset") and they are not
    // measurements. Before this fix `measured()` read only `five`/`seven`, so
    // `b` scored 0, beat `a` at 5, and — since nothing runs on an account
    // nothing was placed on — went on beating it forever.
    //
    // Same magnet, same shape, as the two already recorded in this function's
    // docstring; this is the site that fires on a HEALTHY fleet every time a
    // window turns over, rather than only on an account nobody ever measured.
    expect(projectHome(r, {
      a: L(5, 5),
      b: { ...L(0, 0), fiveRolledOver: true, sevenRolledOver: true },
    })).toEqual({ wrapper: 'a', score: 5 });
  });

  it('ONE rolled window is enough to make the row unmeasured — the score is a maximum', () => {
    // `measured()` already refuses a HALF-NULL row for this reason, in its own
    // words: "the score is a MAXIMUM, so `{five: 3, seven: null}` bounds the
    // truth only from below and could really be 99". A half-INFERRED row is the
    // same bound reached by a different route — the new 5h window has been
    // running for an unknown time and nobody has read it — so it gets the same
    // answer. `b` is not scored at 40 here; `a` at 50 wins by being the only
    // account anyone has actually measured.
    //
    // BASH AGREES, and that was not free. `_limit_score` used to substitute 0
    // for a missing half and answer "" only when BOTH were empty, so it scored
    // this row 40 while `measured()` called it unknown — a divergence this
    // change INTRODUCED (before it, both sides said 40) and then closed in the
    // same commit, on the coordinator's ruling. `half-rolled-window` in the
    // shared leastLoaded fixtures now asserts the agreement over one seeded
    // HOME; this case stays because it pins the RULE in isolation, over a
    // synthetic roster, the way its neighbours do.
    expect(projectHome(r, {
      a: L(50, 50),
      b: { ...L(0, 40), fiveRolledOver: true },
    })).toEqual({ wrapper: 'a', score: 50 });
  });
});

// PINNED HERE AND NOT IN `leastLoaded.ts`, and the reason is the parity
// runner's THIRD assertion rather than a preference. That runner demands
// `shellScore(c.expect.wrapper) === c.expect.score`, and this is the one shape
// where the two languages agree on the ACCOUNT and cannot agree on the NUMBER:
// `projectHome` drops every condemned lane from `scored`, empties it, and takes
// the pre-existing `scored.length === 0` fallback — which reports score 0 —
// while `_limit_score claude` still reads the 80 that is really on disk.
//
// The ACCOUNT is what this case is about, and both sides answer `claude`. The
// score divergence is recorded as a deviation rather than smuggled through a
// fixture field that would let any FUTURE case disagree quietly — which is the
// one thing a parity harness may not allow.
describe('every home-able lane condemned — both sides still place', () => {
  it('falls back to the first home-able account in roster declaration order', async () => {
    const n = now();
    const fresh = (five: number, seven: number): string => JSON.stringify(
      { five, seven, ts: n - 60, fiveResetAt: n + 9000, sevenResetAt: n + 400000 });
    seed({ claude: fresh(80, 40), 'claude-a': fresh(5, 3), 'claude-b': fresh(40, 20), 'claude-d': fresh(85, 45) });
    seedDisabled([]);
    seedAuthDead(['claude', 'claude-a', 'claude-b', 'claude-d']);
    const cfg = loadConfig({ CCRC_HOME: home });
    const projected = projectHome(cfg.roster, await readLimits(localIO, cfg));
    // NOT null, and not the cheapest lane: ccd assigns `first` BEFORE its own
    // skip, so a fleet whose every lane is merely UNVERIFIED still places work.
    expect(projected?.wrapper, 'the server refuses to place on an all-condemned fleet').toBe('claude');
    expect(sh('_ws_least_loaded'), 'ccd disagrees').toBe('claude');
  });
});

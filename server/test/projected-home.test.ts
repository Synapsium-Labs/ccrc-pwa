// The spec requires the `+` to show "the account it is about to assign and its
// current headroom" BEFORE the tap, because "a workspace that silently lands on
// an exhausted account presents as a stalled session with no explanation".
//
// The routing rule itself is `_ws_least_loaded` (ccd:3355) — bash, and the
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
import { readLimits, projectHome, projectPlacement, type AccountLimits } from '../src/limits.js';
import { poolFor, readProjectPools, POOLS_DIR_NAME } from '../src/pools.js';
import type { ProjectPoolWire } from '../../shared/api.js';
import { parseRoster } from '../../shared/roster.js';
import { leastLoadedCases } from './fixtures/leastLoaded.js';
import { mkTmp } from './tmpHelpers.js';
import { seedRoster, DEFAULT_TEST_ROSTER } from './helpers.js';
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

/** DEFAULT_TEST_ROSTER with the case's pool tags applied. Built HERE and not in
 *  the fixture file: the fixture is the cross-language contract and imports
 *  nothing, exactly as it expresses `now` as a parameter for the same reason. */
const rosterWithPools = (pools: Record<string, string> | undefined): unknown => ({
  ...DEFAULT_TEST_ROSTER,
  accounts: DEFAULT_TEST_ROSTER.accounts.map((a) =>
    pools?.[a.id] !== undefined ? { ...a, pool: pools[a.id] } : a),
});

/** The case's project tag, on disk where BOTH readers look. */
const seedPoolTag = (project: string, tag: string): void => {
  const dir = path.join(home, '.cc-sessions', POOLS_DIR_NAME);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, project), tag);
};

describe('projectHome agrees with ccd _ws_least_loaded', () => {
  it.each(leastLoadedCases(now()).map((c) => [c.name, c] as const))(
    '%s',
    async (_name, c) => {
      // BOTH projections of the case's roster into the one fixture home, so the
      // comparison below is of two RULES and not of two rosters. Re-seeded per
      // case rather than only in `beforeEach`, because the pool dimension is
      // the first thing in this fixture that changes the ROSTER itself.
      const roster = rosterWithPools(c.pools);
      seedRoster(home, roster);
      seedAccountsSh(home, roster);
      seed(c.files);
      seedDisabled(c.disabled ?? []);
      seedAuthDead(c.authDead ?? []);
      seedAuthDeadMalformed(c.authDeadMalformed ?? {});
      if (c.project?.tag != null) seedPoolTag(c.project.name, c.project.tag);
      const cfg = loadConfig({ CCRC_HOME: home });
      // The tag reaches the TS side through the real reader, not a literal —
      // so this case exercises `readProjectPools` against the same bytes ccd's
      // `_project_pool_state` is about to read.
      const read = await readProjectPools(localIO, cfg, await localIO.readdir(cfg.registryDir), 1_000);
      const pool: ProjectPoolWire = c.project === undefined
        ? { state: 'untagged' }
        : poolFor(read, c.project.name);
      const projected = projectHome(cfg.roster, await readLimits(localIO, cfg), pool);
      // The bash positional stays OPTIONAL: a case with no `project` calls
      // `_ws_least_loaded` with no argument, exactly as every pre-pool case
      // always has.
      const bashPick = (): string => sh(`_ws_least_loaded ${c.project?.name ?? ''}`);

      if (c.expect === null) {
        // Nothing is placeable. The fixture can't express one shared "empty"
        // value across languages (TS has `null`, bash has empty stdout), so
        // this is the split expectation the runner promises: two assertions,
        // one per side, neither weakened.
        expect(projected, c.why).toBeNull();
        expect(bashPick(), `ccd disagrees: ${c.why}`).toBe('');
        return;
      }

      // 1. The prediction is right in its own terms.
      expect(projected, c.why).toEqual(c.expect);
      // 2. …and bash, the authority, picks the same account.
      expect(bashPick(), `ccd disagrees: ${c.why}`).toBe(c.expect.wrapper);
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
    expect(projectHome(loadConfig({ CCRC_HOME: home }).roster, {}, { state: 'untagged' })).toEqual({ wrapper: 'claude', score: 0 });
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
    expect(projectHome(r, { a: L(5, 5) }, { state: 'untagged' })).toEqual({ wrapper: 'a', score: 5 });
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
    expect(projectHome(r, { a: L(90, 90), b: L(80, 80), g: L(0, 0) }, { state: 'untagged' })).toEqual({ wrapper: 'b', score: 80 });
  });

  it("a telemetry:none account is never scored on gpt's real half-null shape either", () => {
    // The production shape, kept as its own case: `~/.cc-limits/gpt.json` is
    // `{"five": null, "seven": 0}`. Both exclusions apply here and this case
    // cannot tell them apart — which is exactly why the case above exists. It
    // pins the ANSWER for the shape that actually reaches disk today.
    expect(projectHome(r, { a: L(90, 90), b: L(80, 80), g: L(null, 0) }, { state: 'untagged' })).toEqual({ wrapper: 'b', score: 80 });
  });

  it("a five:null account is unmeasured, not zero — gpt's real on-disk shape", () => {
    // `~/.cc-limits/gpt.json` really is `{"five": null, "seven": 0}`: gpt has no
    // 5h window at all. A row half-full of nulls scores nothing, exactly as an
    // absent row does.
    expect(projectHome(r, { a: L(5, 5), b: L(null, 0) }, { state: 'untagged' })).toEqual({ wrapper: 'a', score: 5 });
  });

  it('falls back to the first home-able account when NOTHING is measured — a fresh install must still place work', () => {
    expect(projectHome(r, {}, { state: 'untagged' })).toEqual({ wrapper: 'a', score: 0 });
  });

  it('the fallback steps over a condemned lane when a healthy one is behind it', () => {
    // NOTHING is measured, so the fallback alone decides — and `a`, first in
    // declaration order, is condemned. The shipped defect answered `a` here:
    // one fallback variable cannot say both "not preferred" and "still
    // eligible", so it said neither and placement landed on a credential the
    // probe had already measured dead.
    expect(projectHome(r, { a: { ...L(null, null), authDead: true } }, { state: 'untagged' })).toEqual({ wrapper: 'b', score: 0 });
  });

  it('…and falls back to a condemned lane only when EVERY home-able lane is condemned', () => {
    // The second tier, and the deliberate half of the decision: `null` is
    // reserved for what a human declared (every lane disabled, the case below).
    // A probe verdict is a measurement, it can be wrong, and one bad run must
    // not leave the box with no destination at all — so the answer here is the
    // least-bad lane, in the same roster order every other answer uses. `g`
    // being telemetry:'none' is deliberate too: the chain widens through
    // `scorable` before `live`, and both are all-condemned here.
    expect(projectHome(r, {
      a: { ...L(null, null), authDead: true },
      b: { ...L(null, null), authDead: true },
      g: { ...L(null, null), authDead: true },
    }, { state: 'untagged' })).toEqual({ wrapper: 'a', score: 0 });
  });

  it('the fallback widens into `live` before dropping to a condemned `scorable` lane — the tier no fixture here could reach before', () => {
    // The ONLY input in this file that can tell `scorable.find(notCondemned) ??
    // live.find(notCondemned)` apart from `scorable.find(notCondemned) ??
    // scorable[0]`: every OTHER case in this describe (and every case in the
    // shared `leastLoaded.ts` fixtures, via `DEFAULT_TEST_ROSTER`) has
    // `scorable === live`, because the one `telemetry:'none'` account either
    // side's roster carries (`g` here, `gpt` there) is either absent from this
    // assertion or, in production, `homeAble:false` and so never enters `live`
    // at all (helpers.ts). Here `g` is home-able, telemetry:'none', and
    // untouched — not condemned, not measured, not disabled — while `a` and
    // `b`, the only `scorable` members, are BOTH condemned. `scorable.find
    // (notCondemned)` is therefore `undefined` for BOTH of them, and the
    // SECOND link is the only thing standing between `g` (healthy, merely
    // unmeasured) and `a` (measured dead, first in roster declaration order):
    // delete it and this answers `a`, which is exactly the shipped defect
    // (D-1954) the whole two-tier chain exists to fix, on a lane it never
    // should have reached.
    //
    // NOT added to the shared `leastLoaded.ts` fixtures that drive ccd's bash
    // in parity, for two independent reasons. First, `DEFAULT_TEST_ROSTER`'s
    // only `telemetry:'none'` account (`gpt`) is deliberately `homeAble:
    // false` — `gpt-is-cheapest` in that same fixture file pins exactly the
    // opposite shape, that a cheap-looking non-home-able lane must NEVER be
    // picked — so this case cannot be expressed there without a roster
    // redesign well past a coverage fix. Second, and more fundamentally,
    // `_ws_least_loaded` (ccd/ccd) has no isolable second link to pin against:
    // its single loop walks every CCRC_HOME_ABLE candidate without a
    // scorable/live split at all (bash has no telemetry field to split on —
    // this function's own header names that gap), so its `first`/`condemned`
    // fallback already behaves like this TS chain's WIDENED tier for every
    // candidate, with no narrower statement to delete the way `best=
    // "$condemned"` isolates the condemned tier. There is nothing on the bash
    // side this case could catch going missing.
    expect(projectHome(r, {
      a: { ...L(null, null), authDead: true },
      b: { ...L(null, null), authDead: true },
    }, { state: 'untagged' })).toEqual({ wrapper: 'g', score: 0 });
  });

  it('a condemned lane never re-enters the PREFERRED tier by being measured', () => {
    // `a` is the only account anyone has measured, and it is condemned: the
    // scored set empties, and the fallback must still step over it rather than
    // read "the scored set is empty" as "nothing is measured, take the first".
    expect(projectHome(r, { a: { ...L(5, 5), authDead: true } }, { state: 'untagged' })).toEqual({ wrapper: 'b', score: 0 });
  });

  it('still returns null when every home-able lane is disabled', () => {
    // Unplaceable is still a real answer, and it is this one — not "unmeasured".
    expect(projectHome(r, {
      a: { ...L(1, 1), disabled: true },
      b: { ...L(1, 1), disabled: true },
      g: { ...L(1, 1), disabled: true },
    }, { state: 'untagged' })).toBeNull();
  });

  it('ties go to the earlier account in roster order', () => {
    // `<`, not `<=` — the same strictly-less-than bash compares with. ccd's own
    // `_ws_least_loaded` fixture (`tie`) pins the other side of this.
    expect(projectHome(r, { a: L(50, 50), b: L(50, 50) }, { state: 'untagged' })).toEqual({ wrapper: 'a', score: 50 });
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
    }, { state: 'untagged' })).toEqual({ wrapper: 'a', score: 5 });
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
    }, { state: 'untagged' })).toEqual({ wrapper: 'a', score: 50 });
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
describe('every home-able lane condemned AND measured — both sides still place', () => {
  it('falls back to the first home-able account in roster declaration order', async () => {
    const n = now();
    const fresh = (five: number, seven: number): string => JSON.stringify(
      { five, seven, ts: n - 60, fiveResetAt: n + 9000, sevenResetAt: n + 400000 });
    seed({ claude: fresh(80, 40), 'claude-a': fresh(5, 3), 'claude-b': fresh(40, 20), 'claude-d': fresh(85, 45) });
    seedDisabled([]);
    seedAuthDead(['claude', 'claude-a', 'claude-b', 'claude-d']);
    const cfg = loadConfig({ CCRC_HOME: home });
    const projected = projectHome(cfg.roster, await readLimits(localIO, cfg), { state: 'untagged' });
    // NOT null, and not the cheapest lane: both sides widen to their CONDEMNED
    // fallback tier here — reached only because no lane escaped it — so a fleet
    // whose every lane is merely UNVERIFIED still places work, in roster
    // declaration order. `all-condemned-unmeasured-still-places` in the shared
    // fixtures pins the same rule over bytes whose score both sides agree on;
    // this case exists for the measured shape those cannot express.
    expect(projected?.wrapper, 'the server refuses to place on an all-condemned fleet').toBe('claude');
    expect(sh('_ws_least_loaded'), 'ccd disagrees').toBe('claude');
    // …and un-condemning `claude-b` puts it back into ORDINARY SCORING, not
    // into some rival fallback tier: `scored` now holds exactly one candidate
    // (`claude-a`, cheapest at 5, and `claude-d` both stay condemned and stay
    // dead), so `scored.length` is 1 here, never 0 — the very branch this
    // describe's first half exists for is not entered again. What this
    // reconfirms is the same fact `authdead-loses-scoring` already pins in the
    // shared fixtures (a condemned lane loses SCORING even when it would have
    // won on price), just over a fleet where three of four lanes are condemned
    // rather than one. It is NOT a second demonstration of tier-priority — the
    // fallback chain (`scorable.find(notCondemned) ?? …`) and ccd's own
    // `first`/`condemned` bookkeeping are never read for this half of the test;
    // `authdead-loses-the-fallback-too` and `condemned-lane-is-the-only-
    // measured-one` are what actually pin the fallback WIDENING this comment
    // used to claim.
    seedAuthDead(['claude', 'claude-a', 'claude-d']);
    const cfg2 = loadConfig({ CCRC_HOME: home });
    expect((projectHome(cfg2.roster, await readLimits(localIO, cfg2), { state: 'untagged' }))?.wrapper).toBe('claude-b');
    expect(sh('_ws_least_loaded'), 'ccd disagrees').toBe('claude-b');
  });
});

describe('projectPlacement — unmeasurable is a VALUE, not a null', () => {
  const L = (five: number | null, seven: number | null): AccountLimits =>
    // `authDead` joined `AccountLimits` in #66, AFTER this plan's block was
    // written — a required member, so the plan's literal no longer typechecks.
    // `false` is the right value here: this describe is about the POOL
    // dimension and a condemned lane would change which account wins for a
    // reason that has nothing to do with it.
    ({ five, seven, ts: 1, fiveResetAt: null, sevenResetAt: null,
       fiveRolledOver: false, sevenRolledOver: false, disabled: false, authDead: false });

  it('forecasts the in-pool account for a tagged project', () => {
    const cfg = loadConfig({ CCRC_HOME: home });
    expect(projectPlacement(cfg.roster, { claude: L(5, 5), 'claude-a': L(9, 9) }, { state: 'untagged' }))
      .toEqual({ kind: 'projected', wrapper: 'claude', score: 5 });
  });

  it('answers unmeasurable — never `none` — when the tag could not be read', () => {
    // `none` would claim a measurement: "nothing can take this project". An
    // unreadable tag means nobody looked, and the chip has to say so (spec
    // §5.6, §7's "Unreadable tag" walkthrough).
    const cfg = loadConfig({ CCRC_HOME: home });
    for (const state of ['unreadable', 'malformed'] as const) {
      expect(projectPlacement(cfg.roster, { claude: L(5, 5) }, { state }), state)
        .toEqual({ kind: 'unmeasurable' });
    }
  });

  it('answers none WITH the pool it was looking in, so a renderer need not re-derive it', () => {
    seedRoster(home, rosterWithPools({ claude: 'pool-a', 'claude-a': 'pool-a', 'claude-b': 'pool-a', 'claude-d': 'pool-a' }));
    const cfg = loadConfig({ CCRC_HOME: home });
    const off = { ...L(1, 1), disabled: true };
    expect(projectPlacement(cfg.roster, { claude: off, 'claude-a': off, 'claude-b': off, 'claude-d': off },
      { state: 'tagged', name: 'pool-b' })).toEqual({ kind: 'none', pool: 'pool-b' });
    expect(projectPlacement(cfg.roster, { claude: off, 'claude-a': off, 'claude-b': off, 'claude-d': off },
      { state: 'untagged' })).toEqual({ kind: 'none', pool: null });
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
    const projected = projectHome(cfg.roster, await readLimits(localIO, cfg),
      // UNTAGGED (D-2604), because the bash side of this pair is `_ws_least_loaded`
      // with no project argument — the two must be asked the same question.
      { state: 'untagged' });
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
    const projected = projectHome(cfg.roster, await readLimits(localIO, cfg),
      // UNTAGGED (D-2604), because the bash side of this pair is `_ws_least_loaded`
      // with no project argument — the two must be asked the same question.
      { state: 'untagged' });
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
    const projected = projectHome(cfg.roster, await readLimits(localIO, cfg),
      // UNTAGGED (D-2604), because the bash side of this pair is `_ws_least_loaded`
      // with no project argument — the two must be asked the same question.
      { state: 'untagged' });
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

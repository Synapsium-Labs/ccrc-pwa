import { describe, it, expect } from 'vitest';
import { mkdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { loadConfig } from '../src/config.js';
import { localIO } from '../src/io.js';
import { readLimits, measured } from '../src/limits.js';
import { rolloverCases } from './fixtures/rollover.js';
import { mkTmp } from './tmpHelpers.js';
import { seedRoster } from './helpers.js';

describe('readLimits', () => {
  it('reads fresh values and decays stale ones per ccd rules', async () => {
    const home = mkTmp('ccrc-');
    seedRoster(home);
    const dir = path.join(home, '.cc-limits');
    mkdirSync(dir, { recursive: true });
    const now = 1784600000;
    writeFileSync(path.join(dir, 'claude.json'), JSON.stringify({ five: 42, seven: 61, ts: now - 60, fiveResetAt: now + 3600, sevenResetAt: now + 86400 }));
    writeFileSync(path.join(dir, 'claude-a.json'), JSON.stringify({ five: 99, seven: 80, ts: now - 20000 }));  // 5h window rolled
    writeFileSync(path.join(dir, 'claude-b.json'), JSON.stringify({ five: 94, seven: 94, ts: now - 700000 })); // both rolled
    writeFileSync(path.join(dir, 'gpt.json'), 'not json');

    const l = await readLimits(localIO, loadConfig({ CCRC_HOME: home }), now);
    expect(l['claude']).toEqual({ five: 42, seven: 61, ts: now - 60, fiveResetAt: now + 3600, sevenResetAt: now + 86400, fiveRolledOver: false, sevenRolledOver: false, disabled: false, authDead: false });
    expect(l['claude-a'].five).toBe(0);
    expect(l['claude-a'].seven).toBe(80);
    expect(l['claude-b']).toMatchObject({ five: 0, seven: 0 });
    expect(l['gpt']).toEqual({ five: null, seven: null, ts: null, fiveResetAt: null, sevenResetAt: null, fiveRolledOver: false, sevenRolledOver: false, disabled: false, authDead: false });
  });
});

describe('readLimits — a window that has rolled over', () => {
  it('reports every rollover case exactly', async () => {
    const home = mkTmp('ccrc-');
    seedRoster(home);
    const dir = path.join(home, '.cc-limits');
    mkdirSync(dir, { recursive: true });
    const now = 1785231736;
    const cases = rolloverCases(now);
    for (const c of cases) writeFileSync(path.join(dir, c.file), c.content);

    const l = await readLimits(localIO, loadConfig({ CCRC_HOME: home }), now);
    for (const c of cases) {
      const wrapper = c.file.slice(0, -'.json'.length);
      expect(l[wrapper], `${c.file}: ${c.why}`).toMatchObject(c.expect);
    }
  });

  it('a rolled-over zero is distinguishable from a measured zero', async () => {
    const home = mkTmp('ccrc-');
    seedRoster(home);
    const dir = path.join(home, '.cc-limits');
    mkdirSync(dir, { recursive: true });
    const now = 1785231736;
    writeFileSync(path.join(dir, 'measured.json'),
      JSON.stringify({ five: 0, seven: 0, ts: now - 60, fiveResetAt: now + 3600, sevenResetAt: now + 86400 }));
    writeFileSync(path.join(dir, 'inferred.json'),
      JSON.stringify({ five: 55, seven: 55, ts: now - 60, fiveResetAt: now - 1, sevenResetAt: now - 1 }));

    const l = await readLimits(localIO, loadConfig({ CCRC_HOME: home }), now);
    expect(l['measured']).toMatchObject({ five: 0, fiveRolledOver: false });
    expect(l['inferred']).toMatchObject({ five: 0, fiveRolledOver: true });
  });

  it('an age-inferred zero carries the same flag a resetAt-inferred one does', async () => {
    // The flags' whole contract is "the 0 above is inferred rather than
    // observed" (the AccountLimits docstring). TWO rules can reach that state:
    // a lapsed resetAt, which is fact straight from the API, and a sample older
    // than its own window, which is inference. Both write the same inferred 0,
    // so both have to set the same flag — the flag names the PROVENANCE of the
    // number, not which rule derived it.
    //
    // Left false, the age path told AccountsScreen's `Bar` (rolledOver ? 'reset'
    // : `${pct}%`) that an account nobody had measured in six hours was measured
    // empty — the exact collapse that component's own comment says it never
    // makes.
    const home = mkTmp('ccrc-');
    seedRoster(home);
    const dir = path.join(home, '.cc-limits');
    mkdirSync(dir, { recursive: true });
    const now = 1785231736;
    // No resetAt fields at all — the gpt 429-exclusion shape, and anything
    // written before those fields existed. 20000s is past the 5h window and
    // nowhere near the 7d one, so exactly one half is inferred and the other
    // stays a real measurement. A fixture that rolled BOTH could not tell a
    // per-field flag from a per-row one.
    writeFileSync(path.join(dir, 'aged.json'),
      JSON.stringify({ five: 99, seven: 80, ts: now - 20000 }));

    const l = await readLimits(localIO, loadConfig({ CCRC_HOME: home }), now);
    expect(l['aged'], 'the 5h half is inferred and must say so').toMatchObject({
      five: 0, fiveRolledOver: true,
    });
    expect(l['aged'], 'the 7d half is a real measurement and must NOT say otherwise').toMatchObject({
      seven: 80, sevenRolledOver: false,
    });
  });
});

describe('disabled lanes', () => {
  it('marks an account whose ccd kill-switch file is present', async () => {
    const home = mkTmp('ccrc-');
    seedRoster(home);
    mkdirSync(path.join(home, '.cc-limits'), { recursive: true });
    mkdirSync(path.join(home, '.cc-sessions'), { recursive: true });
    writeFileSync(path.join(home, '.cc-limits', 'gpt.json'), JSON.stringify({ five: 10, seven: 20 }));
    writeFileSync(path.join(home, '.cc-limits', 'claude.json'), JSON.stringify({ five: 10, seven: 20 }));
    writeFileSync(path.join(home, '.cc-sessions', 'gpt-disabled'), '');
    const l = await readLimits(localIO, loadConfig({ CCRC_HOME: home }));
    expect(l.gpt.disabled).toBe(true);
    expect(l.claude.disabled).toBe(false);
  });

  it('treats an absent kill-switch as enabled', async () => {
    const home = mkTmp('ccrc-');
    seedRoster(home);
    mkdirSync(path.join(home, '.cc-limits'), { recursive: true });
    writeFileSync(path.join(home, '.cc-limits', 'gpt.json'), JSON.stringify({ five: 10, seven: 20 }));
    const l = await readLimits(localIO, loadConfig({ CCRC_HOME: home }));
    // An account wrongly HIDDEN is worse than one wrongly shown: hidden looks
    // like the account does not exist at all.
    expect(l.gpt.disabled).toBe(false);
  });

  it('leaves a malformed limits file enabled', async () => {
    const home = mkTmp('ccrc-');
    seedRoster(home);
    mkdirSync(path.join(home, '.cc-limits'), { recursive: true });
    writeFileSync(path.join(home, '.cc-limits', 'gpt.json'), 'not json');
    const l = await readLimits(localIO, loadConfig({ CCRC_HOME: home }));
    expect(l.gpt.disabled).toBe(false);
  });
});

describe('disabled-marker backfill is bounded to known wrappers', () => {
  it('surfaces a known wrapper disabled before it ever wrote telemetry', async () => {
    // No claude-a.json at all — the loop over `.cc-limits/*.json` would never
    // visit claude-a, so this row exists only because the backfill added it.
    const home = mkTmp('ccrc-');
    seedRoster(home);
    mkdirSync(path.join(home, '.cc-limits'), { recursive: true });
    mkdirSync(path.join(home, '.cc-sessions'), { recursive: true });
    writeFileSync(path.join(home, '.cc-sessions', 'claude-a-disabled'), '');
    const l = await readLimits(localIO, loadConfig({ CCRC_HOME: home }));
    expect(l['claude-a']).toEqual({
      five: null, seven: null, ts: null, fiveResetAt: null, sevenResetAt: null,
      fiveRolledOver: false, sevenRolledOver: false, disabled: true, authDead: false,
    });
  });

  // The wire-contract defect: the registry dir is shared with markers that are
  // NOT accounts. ccd ships `autocompact-disabled` there (a fleet-wide
  // proactive-/compact kill switch, ccd:41) — before this fix, the backfill
  // iterated every `*-disabled` filename with no filter, so this file alone
  // fabricated a `{"wrapper":"autocompact",...,disabled:true}` row that GET
  // /api/accounts served and the accounts screen would render as a phantom
  // account. `bogus-lane-disabled` pins the general case, not just this one name.
  it('never fabricates an account row for a non-wrapper marker (autocompact-disabled, and any other)', async () => {
    const home = mkTmp('ccrc-');
    seedRoster(home);
    mkdirSync(path.join(home, '.cc-limits'), { recursive: true });
    mkdirSync(path.join(home, '.cc-sessions'), { recursive: true });
    writeFileSync(path.join(home, '.cc-sessions', 'autocompact-disabled'), '');
    writeFileSync(path.join(home, '.cc-sessions', 'bogus-lane-disabled'), '');
    const l = await readLimits(localIO, loadConfig({ CCRC_HOME: home }));
    expect(l['autocompact']).toBeUndefined();
    expect(l['bogus-lane']).toBeUndefined();
    expect(Object.keys(l)).toEqual([]);
  });

  it('surfaces an auth-dead lane the same way a disabled one is surfaced', () => {
    // A lane can be condemned before it has ever written telemetry, and a lane
    // absent from `out` is indistinguishable from one nobody measured — which
    // scores as the emptiest account on the fleet. Same hole, same closure.
    const home = mkTmp('ccrc-limits-authdead-');
    seedRoster(home);
    mkdirSync(path.join(home, '.cc-limits'), { recursive: true });
    mkdirSync(path.join(home, '.cc-sessions'), { recursive: true });
    writeFileSync(path.join(home, '.cc-sessions', 'claude-a-authdead'), '1757203200 auth-401');
    const cfg = loadConfig({ CCRC_HOME: home });
    return readLimits(localIO, cfg).then((l) => {
      expect(l['claude-a']).toMatchObject({ authDead: true, disabled: false, five: null });
    });
  });

  it('never fabricates a row for an -authdead marker that names no account', () => {
    // `inRoster`'s job, and the reason the `-disabled` loop already has it: the
    // registry holds dotless fleet-wide switches too, and a marker for an
    // account the roster does not have must not become a phantom row on
    // GET /api/accounts.
    const home = mkTmp('ccrc-limits-authdead-phantom-');
    seedRoster(home);
    mkdirSync(path.join(home, '.cc-limits'), { recursive: true });
    mkdirSync(path.join(home, '.cc-sessions'), { recursive: true });
    writeFileSync(path.join(home, '.cc-sessions', 'not-an-account-authdead'), '1757203200 auth-401');
    const cfg = loadConfig({ CCRC_HOME: home });
    return readLimits(localIO, cfg).then((l) => {
      expect(Object.keys(l)).not.toContain('not-an-account');
    });
  });
});

describe('measured() — the rank ccd derives too', () => {
  it('scores every shared fixture exactly as _limit_score does', async () => {
    // Same rows, same expectations, other language. ccd-limits.test.ts asserts
    // the shell half; together they are the anti-drift harness for the
    // single-window rule as well as the rollover rule.
    const now = Math.floor(Date.now() / 1000);
    const home = mkTmp('ccrc-measured-');
    seedRoster(home);
    const dir = path.join(home, '.cc-limits');
    mkdirSync(dir, { recursive: true });
    const cases = rolloverCases(now);
    for (const c of cases) writeFileSync(path.join(dir, c.file), c.content);
    const l = await readLimits(localIO, loadConfig({ CCRC_HOME: home }), now);
    for (const c of cases) {
      const wrapper = c.file.slice(0, -'.json'.length);
      expect(measured(l[wrapper]), `${c.file}: ${c.why}`).toBe(c.score);
    }
  });
});

/** THE THIRD BODY OF THE `_authdead` CONTRACT (review 78, F2).
 *
 *  `ccd/ccd`'s `_authdead` and `ccd/ccd-telemetry-keepalive`'s both refuse a
 *  SYMLINKED marker (`[[ -f "$f" && ! -L "$f" ]]`); before this wave all three
 *  bodies followed the link and were consistently wrong, and closing the two
 *  bash ones alone would have left this one condemning an account the fleet's
 *  own gate calls healthy — `limits.ts`'s own docstring forbids exactly that,
 *  in exactly that direction.
 *
 *  EVERY CASE HERE HAS A CONTROL, because a guard is only pinned by a pair: the
 *  refusal, and a case proving the SAME path with the SAME bytes still condemns
 *  when the type gate is satisfied. Delete `if (!kind.ok || kind.kind !==
 *  'regular') return null;` and the refusals red while the controls stay green,
 *  which is the only shape that says the guard is what decided it. */
describe('readLimits — the marker\'s TYPE, not just its content (the third `_authdead` body)', () => {
  const MARKER = '1757203200 auth-401';

  /** A registry holding one well-formed marker for `claude-a`, at
   *  `<home>/.cc-sessions/claude-a-authdead`, plus the target the symlink cases
   *  point at. Returns the home and the marker path. */
  const seedHome = (prefix: string) => {
    const home = mkTmp(prefix);
    seedRoster(home);
    mkdirSync(path.join(home, '.cc-limits'), { recursive: true });
    mkdirSync(path.join(home, '.cc-sessions'), { recursive: true });
    // TELEMETRY SEEDED ON PURPOSE, so the lane has a row whatever the verdict.
    // Without it a healthy lane is simply ABSENT from the map — the backfill
    // mints a row for a condemned lane precisely because it may have none —
    // and then `authDead: false` and `authDead: true` would differ in the
    // presence of the whole object, not in the field under test. The control
    // has to differ in ONE thing.
    writeFileSync(path.join(home, '.cc-limits', 'claude-a.json'),
      JSON.stringify({ five: 10, seven: 20, ts: Math.floor(Date.now() / 1000) }));
    return { home, marker: path.join(home, '.cc-sessions', 'claude-a-authdead') };
  };

  it('a LIVE symlink to a well-formed marker does NOT condemn the account', async () => {
    const { home, marker } = seedHome('ccrc-limits-authdead-symlink-');
    const target = path.join(home, '.cc-sessions', 'real-marker');
    writeFileSync(target, MARKER);
    symlinkSync(target, marker);
    const l = await readLimits(localIO, loadConfig({ CCRC_HOME: home }));
    // Not "absent from the map" — the lane is still a roster account and still
    // gets a row; what it must not get is the verdict.
    expect(l['claude-a']).toMatchObject({ authDead: false });
  });

  it('CONTROL: a REAL file with those exact bytes at that exact path DOES condemn', async () => {
    const { home, marker } = seedHome('ccrc-limits-authdead-control-');
    writeFileSync(marker, MARKER);
    const l = await readLimits(localIO, loadConfig({ CCRC_HOME: home }));
    expect(l['claude-a']).toMatchObject({ authDead: true });
  });

  it('a DANGLING symlink does not condemn either — and here the TYPE gate is what refuses it', async () => {
    // Worth its own case because the two bash bodies get this one for free:
    // `-f` already refuses a broken link, so their `-L` rung never decides it.
    // On this side `readFile` would throw ENOENT and fold to null, so the
    // content gate would also refuse it — the case is recorded as a CONTROL on
    // the type gate's reach, not as a defect it closes.
    const { home, marker } = seedHome('ccrc-limits-authdead-dangling-');
    symlinkSync(path.join(home, '.cc-sessions', 'no-such-target'), marker);
    const l = await readLimits(localIO, loadConfig({ CCRC_HOME: home }));
    expect(l['claude-a']).toMatchObject({ authDead: false });
  });

  it('a symlink REPLACED BY a regular file at the same path condemns — the gate reads the tree, not a memory of it', async () => {
    const { home, marker } = seedHome('ccrc-limits-authdead-replaced-');
    const target = path.join(home, '.cc-sessions', 'real-marker');
    writeFileSync(target, MARKER);
    symlinkSync(target, marker);
    rmSync(marker, { force: true });
    writeFileSync(marker, MARKER);
    const l = await readLimits(localIO, loadConfig({ CCRC_HOME: home }));
    expect(l['claude-a']).toMatchObject({ authDead: true });
  });

  /** THE OLDER-AGENT ARM. A remote fleet whose agent predates the `lstat` op
   *  rejects the request, and `remote/io.ts` reports `unmeasured` — not
   *  `unreadable`, and above all not a kind. This box then knows nothing about
   *  the path's type, and the only safe fold is healthy: a wrong `true` costs
   *  an account its place in the preferred fallback tier, a wrong `false` costs
   *  only the scoring penalty. */
  it('an io that cannot measure the path type does not condemn, and its CONTROL does', async () => {
    const { home, marker } = seedHome('ccrc-limits-authdead-unmeasured-');
    writeFileSync(marker, MARKER);
    const cfg = loadConfig({ CCRC_HOME: home });

    const unmeasured = { ...localIO, lstatMeasured: async () => ({ ok: false as const, reason: 'unmeasured' as const }) };
    expect((await readLimits(unmeasured, cfg))['claude-a']).toMatchObject({ authDead: false });

    // CONTROL on the same fixture and the same io shape: the ONLY difference is
    // the answer the port gives, so nothing but the port's answer can explain
    // the two verdicts.
    const measuredRegular = { ...localIO, lstatMeasured: async () => ({ ok: true as const, kind: 'regular' as const }) };
    expect((await readLimits(measuredRegular, cfg))['claude-a']).toMatchObject({ authDead: true });
  });

  it('`other` — a DIRECTORY named like a marker — does not condemn', async () => {
    // A CONTROL ON REACH, like the dangling case and for the same reason: with
    // the type gate deleted this stays GREEN, because `readFile` on a directory
    // is EISDIR and folds to null, so the CONTENT gate refuses it anyway.
    // Recorded as a row the type-gate mutants do not move, rather than left to
    // read as a pin it is not. The two rows that ARE pins are the live symlink
    // and the unmeasured io, and each dies to its own rung:
    //   whole gate deleted            -> both RED
    //   `kind === 'symlink'` only     -> unmeasured RED, symlink green
    //   `!kind.ok` only               -> symlink RED, unmeasured green
    // Controls green under all three.
    const { home, marker } = seedHome('ccrc-limits-authdead-dir-');
    mkdirSync(marker, { recursive: true });
    const l = await readLimits(localIO, loadConfig({ CCRC_HOME: home }));
    expect(l['claude-a']).toMatchObject({ authDead: false });
  });
});

import { describe, it, expect } from 'vitest';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { loadConfig } from '../src/config.js';
import { localIO } from '../src/io.js';
import { readLimits } from '../src/limits.js';
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
    expect(l['claude']).toEqual({ five: 42, seven: 61, ts: now - 60, fiveResetAt: now + 3600, sevenResetAt: now + 86400, fiveRolledOver: false, sevenRolledOver: false, disabled: false });
    expect(l['claude-a'].five).toBe(0);
    expect(l['claude-a'].seven).toBe(80);
    expect(l['claude-b']).toMatchObject({ five: 0, seven: 0 });
    expect(l['gpt']).toEqual({ five: null, seven: null, ts: null, fiveResetAt: null, sevenResetAt: null, fiveRolledOver: false, sevenRolledOver: false, disabled: false });
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
      fiveRolledOver: false, sevenRolledOver: false, disabled: true,
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
});

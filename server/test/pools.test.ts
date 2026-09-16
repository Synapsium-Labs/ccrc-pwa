// The server's half of "the rule, spelled once per language" (spec §5.2). L0's
// `poolRule` is the rule; this file proves the SERVER's relabelling of it —
// against a roster, with the not-in-roster pass-through — still answers the
// shared fixture table exactly, and that the module holding it stays L1-pure.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseRoster } from '../../shared/roster.js';
import { poolEligible, poolRostered, poolUndecidable, poolVerdict } from '../src/poolrule.js';
import { POOL_RULE_CASES, POOLED_TEST_ROSTER, type PoolRuleCase } from './fixtures/poolRule.js';

/** A one-account roster carrying exactly the case's account pool. The key is
 *  OMITTED for `null`: `parseAccount` refuses a literal `null` in JSON and
 *  reads an absent key as untagged, so this is the only spelling that round
 *  trips (wave 1, spec §5.3). */
const rosterWith = (pool: string | null) => parseRoster({
  version: 1,
  accounts: [{
    id: 'a', label: 'A', configDirSuffix: '.a', exec: { kind: 'upstream' },
    homeAble: true, hue: 'cyan', telemetry: 'anthropic',
    ...(pool === null ? {} : { pool }),
  }],
});

/** The fixture's three-word answer space, read off a `RosterVerdict`. */
const word = (v: ReturnType<typeof poolVerdict>): PoolRuleCase['expect'] =>
  v.ok ? 'serve' : v.reason === 'pool-mismatch' ? 'mismatch' : 'undecidable';

describe('poolVerdict answers the shared fixture table', () => {
  it('the table is not vacuous — a floor, and every class represented', () => {
    // ANTI-VACUITY FIRST: `it.each([])` reports green, which is the one failure
    // mode that makes a table-driven suite worse than none.
    expect(POOL_RULE_CASES.length).toBeGreaterThanOrEqual(10);
    for (const cls of ['serve', 'mismatch', 'undecidable'] as const) {
      expect(POOL_RULE_CASES.filter((c) => c.expect === cls).length, cls).toBeGreaterThan(0);
    }
    for (const state of ['tagged', 'untagged', 'malformed', 'unreadable'] as const) {
      expect(POOL_RULE_CASES.filter((c) => c.project.state === state).length, state).toBeGreaterThan(0);
    }
  });

  it.each(POOL_RULE_CASES.map((c) => [c.name, c] as const))('%s', (_name, c) => {
    expect(word(poolVerdict(rosterWith(c.accountPool), 'a', c.project))).toBe(c.expect);
  });
});

describe('poolVerdict and the roster', () => {
  const r = parseRoster(POOLED_TEST_ROSTER);

  it('passes a wrapper this roster does not have through as account-not-in-roster', () => {
    // ccd's `_is_valid_wrapper` is the authority, and the PWA already offers
    // live non-roster wrappers (spec §5.6). Refusing here would 409 a swap ccd
    // would have carried out.
    expect(poolVerdict(r, 'nobody', { state: 'tagged', name: 'pool-a' }))
      .toEqual({ ok: true, why: 'account-not-in-roster' });
  });

  it('still refuses to decide an unreadable tag for a wrapper it does not have', () => {
    // PRECEDENCE. "If pool(p) cannot be read, NOBODY decides" (spec §5.2) —
    // the relabel above must touch the ok arm only, or an unreadable tag plus
    // an unknown wrapper would permit the very placement 503 exists to stop.
    expect(poolVerdict(r, 'nobody', { state: 'unreadable' }))
      .toEqual({ ok: false, reason: 'pool-undecidable', state: 'unreadable' });
    expect(poolVerdict(r, 'nobody', { state: 'malformed' }))
      .toEqual({ ok: false, reason: 'pool-undecidable', state: 'malformed' });
  });

  it('names the two pools on a mismatch, so the 409 can render both sides', () => {
    expect(poolVerdict(r, 'claude-b', { state: 'tagged', name: 'pool-a' }))
      .toEqual({ ok: false, reason: 'pool-mismatch', accountPool: 'pool-b', projectPool: 'pool-a' });
  });
});

describe('poolEligible', () => {
  const r = parseRoster(POOLED_TEST_ROSTER);
  const ids = (pool: Parameters<typeof poolEligible>[1]): string[] =>
    poolEligible(r, pool).map((a) => a.id);

  it('keeps in-pool AND untagged home-able accounts for a tagged project', () => {
    // An untagged account is unconstrained — tagging only tightens (ruling 3).
    expect(ids({ state: 'tagged', name: 'pool-a' })).toEqual(['claude', 'claude-a', 'claude-d']);
    expect(ids({ state: 'tagged', name: 'pool-b' })).toEqual(['claude-b', 'claude-d']);
  });

  it('keeps every home-able account for an untagged project, and gpt is never home-able', () => {
    expect(ids({ state: 'untagged' })).toEqual(['claude', 'claude-a', 'claude-b', 'claude-d']);
  });

  it('is EMPTY when nobody can decide — an undecidable tag places nothing', () => {
    expect(ids({ state: 'unreadable' })).toEqual([]);
    expect(ids({ state: 'malformed' })).toEqual([]);
  });
});

describe('poolUndecidable and poolRostered', () => {
  const r = parseRoster(POOLED_TEST_ROSTER);

  it('undecidable is the two states in which nobody decides, derived from the rule', () => {
    expect(poolUndecidable({ state: 'unreadable' })).toBe(true);
    expect(poolUndecidable({ state: 'malformed' })).toBe(true);
    expect(poolUndecidable({ state: 'untagged' })).toBe(false);
    expect(poolUndecidable({ state: 'tagged', name: 'pool-a' })).toBe(false);
  });

  it('poolRostered walks EVERY account, not just the home-able ones', () => {
    // ccd's own warning walks `CCRC_ACCOUNTS` (spec §5.4.2), which includes the
    // non-home-able lane; a home-able-only test would warn `unknown-pool` for a
    // pool whose only member is that lane.
    expect(poolRostered(r, 'pool-a')).toBe(true);
    expect(poolRostered(r, 'pool-b')).toBe(true);
    expect(poolRostered(r, 'pool-c')).toBe(false);

    // AND THE CASE THAT ACTUALLY PINS "every account". The three assertions
    // above all pass over `roster.homeAble` too, because both fixture pools
    // have home-able members — measured, and that is exactly mutation 3 in this
    // task's table. This roster's ONLY `pool-b` member is the non-home-able
    // lane, so it is the one input that can tell the two walks apart.
    const overflowOnly = parseRoster({
      version: 1,
      accounts: [
        {
          id: 'gpt', label: 'gpt', configDirSuffix: '.claude-gpt',
          exec: { kind: 'external' }, homeAble: false, hue: 'magenta',
          telemetry: 'none', pool: 'pool-b',
        },
        {
          id: 'claude', label: 'claude', configDirSuffix: '.claude',
          exec: { kind: 'upstream' }, homeAble: true, hue: 'cyan',
          telemetry: 'anthropic',
        },
      ],
    });
    expect(poolRostered(overflowOnly, 'pool-b'),
      'a pool whose only member is the non-home-able lane is still a real pool').toBe(true);
  });
});

// The purity scan, copied from `coord-caps-policy.test.ts`'s scan with ONE
// deliberate difference, stated rather than smuggled: that file demands EVERY
// import line be `import type`, and this module has exactly one value import —
// `poolRule` from `shared/poolrule.js`, itself L0 and importing nothing. That
// import is the whole point (the rule is spelled once), so the assertion below
// pins it EXACTLY: one value import, and it must be that one.
describe('poolrule.ts is the pure L1 module its own docstring says it is', () => {
  const SRC = readFileSync(
    path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'src', 'poolrule.ts'),
    'utf8');

  /** Comments blanked, positions preserved — without it this module's own
   *  docstring, which NAMES `reply` while promising not to use it, reds every
   *  assertion below. */
  const code = (): string => SRC
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))
    .replace(/\/\/[^\n]*/g, (m) => m.replace(/[^\n]/g, ' '));

  it('the scan is over real code, not an empty string', () => {
    expect(code()).toContain('export function poolVerdict');
    expect(code().replace(/\s/g, '').length).toBeGreaterThan(400);
  });

  it('has no clock', () => {
    expect(code(), 'poolrule.ts reads the clock — the decision is no longer pure')
      .not.toMatch(/\bDate\s*\.\s*now\s*\(|\bnew\s+Date\s*\(|performance\s*\.\s*now/);
  });

  it('has no fs and no other node builtin', () => {
    expect(code(), 'poolrule.ts imports a node builtin').not.toMatch(/from\s+'node:/);
    expect(code(), 'poolrule.ts reaches for a filesystem').not.toMatch(/\bfs\s*\.|require\s*\(/);
  });

  it('has no fastify, no reply, no store, no io', () => {
    expect(code(), 'poolrule.ts names a reply — an L1 decision does not answer HTTP')
      .not.toMatch(/\breply\b|\bFastify|\bapp\s*\./);
    expect(code(), 'poolrule.ts reaches a store or the fs facade')
      .not.toMatch(/CoordStore|\bstore\s*\.|FleetIO/);
  });

  it('takes exactly ONE value import, and it is L0 poolRule', () => {
    const imports = [...code().matchAll(/^\s*import\b[^\n]*/gm)].map((m) => m[0]!.trim());
    expect(imports.length, 'no imports found — the scan is over nothing').toBeGreaterThan(0);
    const values = imports.filter((l) => !/^import\s+type\b/.test(l));
    expect(values, 'poolrule.ts takes a value import that is not the L0 rule')
      .toEqual(["import { poolRule } from '../../shared/poolrule.js';"]);
  });
});

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

/**
 * THE ROWS THIS DRIVER DOES NOT WALK, AND WHY THAT IS A DESIGN BOUNDARY RATHER
 * THAN AN UNIMPLEMENTED FEATURE (ruling T2-R1).
 *
 * Spec §5.7, verbatim: "The server's own forecast does **not** consult the
 * projection — it reads coord.db directly, so every 409/503 it issues is
 * immediate and exact." `unreadable` / `stale` / `malformed` on the ACCOUNT
 * side are states of ONE fleet-side file, `$HOME/.cc-sessions/pool-epoch`,
 * which only a box that syncs it can be in and which the server never reads.
 * So these are not verdicts the server gets wrong — they are conditions it is
 * structurally blind to, and the blindness is the design.
 *
 * The type says the same thing: `poolVerdict` (`server/src/poolrule.ts:48`)
 * builds its account side through `declaredAccountPool`, whose whole codomain
 * is `tagged` | `untagged`. There is no roster this driver could hand it that
 * makes it answer `undecidable` for an ACCOUNT, so walking these rows here
 * would not be testing the server against the table — it would be asserting
 * that the server implements a read it is specified not to perform.
 *
 * WHERE THEY ARE DRIVEN INSTEAD: `ccd-pool-ok.test.ts`, against `_pool_ok`,
 * the side that reads `_acct_pool_state`; and `pool-rule-core.test.ts`,
 * against L0's `poolRule`, whose `wireFor` builds the bare `{ state }` these
 * rows need. Both walk the WHOLE table. So no row here is unpinned — each is
 * pinned by the implementations that can observe its input.
 */
const SERVER_BLIND = (c: PoolRuleCase): boolean => c.accountState !== undefined;

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

  it('the skip is bounded — non-empty, account-state-only, and it leaves a table behind', () => {
    // A SKIPPED CASE IS NOT A PIN, so the skip itself gets pinned. Three
    // claims, each closing a different way for this predicate to rot:
    const skipped = POOL_RULE_CASES.filter(SERVER_BLIND);
    const walked = POOL_RULE_CASES.filter((c) => !SERVER_BLIND(c));

    // (1) A skip that matches nothing is a vacuous zero — it would report as a
    // live boundary while the rows it claims to except had been renamed away.
    expect(skipped.length,
      'SERVER_BLIND matches no row: either the account-state rows are gone from the table, or the '
      + 'predicate stopped naming them, and either way this boundary is now a comment about nothing')
      .toBeGreaterThan(0);

    // (2) EVERY skipped row carries `accountState`. True by construction TODAY
    // — the predicate IS that test — and that is the point: it is a ratchet on
    // the PREDICATE, not a measurement of the table. The day someone widens
    // `SERVER_BLIND` to except a row for any other reason (a project state, a
    // name, a verdict it finds inconvenient), this reds, and the widening has
    // to be argued rather than absorbed into a skip the server's §5.7
    // blindness does not cover.
    // `expect.soft`, so claim (3) below is still MEASURED on a mutation that
    // reds this one — a hard throw here would shadow it and leave (3) a row
    // of the mutation table nothing ever exercised.
    for (const c of skipped) {
      expect.soft(c.accountState,
        `${c.name} is skipped but carries no accountState — the skip has widened past §5.7's boundary`)
        .toBeDefined();
    }

    // (3) And the skip must leave a table behind: `it.each([])` reports green,
    // so a predicate that swallowed every row would turn the driver below into
    // a suite that asserts nothing and says so nowhere.
    expect(walked.length, 'SERVER_BLIND skipped the whole table — the driver below walks nothing')
      .toBeGreaterThanOrEqual(10);
  });

  // `new Map()` at every fixture-table call: NO central edges is exactly what
  // this table's cases assert against — the DECLARED-roster behaviour the
  // table has always driven. See `describe('poolVerdict and central edges')`
  // below for the precedence the `edges` argument itself adds.
  const NO_EDGES = new Map<string, readonly string[]>();

  it.each(POOL_RULE_CASES.filter((c) => !SERVER_BLIND(c)).map((c) => [c.name, c] as const))(
    '%s', (_name, c) => {
      expect(word(poolVerdict(rosterWith(c.accountPool), 'a', c.project, NO_EDGES))).toBe(c.expect);
    });
});

describe('poolVerdict and the roster', () => {
  const r = parseRoster(POOLED_TEST_ROSTER);
  const NO_EDGES = new Map<string, readonly string[]>();

  it('passes a wrapper this roster does not have through as account-not-in-roster', () => {
    // ccd's `_is_valid_wrapper` is the authority, and the PWA already offers
    // live non-roster wrappers (spec §5.6). Refusing here would 409 a swap ccd
    // would have carried out.
    expect(poolVerdict(r, 'nobody', { state: 'tagged', name: 'pool-a' }, NO_EDGES))
      .toEqual({ ok: true, why: 'account-not-in-roster' });
  });

  it('still refuses to decide an unreadable tag for a wrapper it does not have', () => {
    // PRECEDENCE. "If pool(p) cannot be read, NOBODY decides" (spec §5.2) —
    // the relabel above must touch the ok arm only, or an unreadable tag plus
    // an unknown wrapper would permit the very placement 503 exists to stop.
    expect(poolVerdict(r, 'nobody', { state: 'unreadable' }, NO_EDGES))
      .toEqual({ ok: false, reason: 'pool-undecidable', state: 'unreadable' });
    expect(poolVerdict(r, 'nobody', { state: 'malformed' }, NO_EDGES))
      .toEqual({ ok: false, reason: 'pool-undecidable', state: 'malformed' });
  });

  it('names the two pools on a mismatch, so the 409 can render both sides — the DECLARED fallback still enforced with no central edges', () => {
    // Mutation table row: "drop the `declared` fallback" must RED here — with
    // `NO_EDGES`, `claude-b`'s only pool signal is its roster-declared
    // `pool-b`, so a `poolVerdict` that stopped consulting the roster once the
    // central lookup missed would wrongly answer `account-not-in-roster` (an
    // `ok` verdict) instead of this mismatch.
    expect(poolVerdict(r, 'claude-b', { state: 'tagged', name: 'pool-a' }, NO_EDGES))
      .toEqual({ ok: false, reason: 'pool-mismatch', accountPool: 'pool-b', projectPool: 'pool-a' });
  });
});

describe('poolVerdict and central edges — precedence (design §5.6)', () => {
  const r = parseRoster(POOLED_TEST_ROSTER);

  it('a central edge outranks the declared roster pool', () => {
    // `claude-b` is declared `pool-b` in the roster; a central edge says
    // `pool-a` instead, and central must win.
    const edges = new Map([['claude-b', ['pool-a']]]);
    expect(poolVerdict(r, 'claude-b', { state: 'tagged', name: 'pool-a' }, edges))
      .toEqual({ ok: true, why: 'same-pool' });
  });

  it('a central edge can also produce a mismatch the declared pool would not have', () => {
    // `claude-d` is UNTAGGED in the roster (POOL_BY_ID names no pool for it,
    // so it is unconstrained by the declared default) but centrally tagged
    // `pool-b` — the central tag must still refuse a project tagged `pool-a`,
    // which the permissive declared default alone would have let through.
    const edges = new Map([['claude-d', ['pool-b']]]);
    expect(poolVerdict(r, 'claude-d', { state: 'tagged', name: 'pool-a' }, edges))
      .toEqual({ ok: false, reason: 'pool-mismatch', accountPool: 'pool-b', projectPool: 'pool-a' });
  });

  it('an edges entry for another account never leaks onto this one', () => {
    const edges = new Map([['claude-a', ['pool-a']]]);
    // `claude-b` is not in `edges` at all, so its DECLARED `pool-b` still
    // decides — same answer as the no-edges case above.
    expect(poolVerdict(r, 'claude-b', { state: 'tagged', name: 'pool-a' }, edges))
      .toEqual({ ok: false, reason: 'pool-mismatch', accountPool: 'pool-b', projectPool: 'pool-a' });
  });
});

describe('poolEligible', () => {
  const r = parseRoster(POOLED_TEST_ROSTER);
  const NO_EDGES = new Map<string, readonly string[]>();
  const ids = (
    pool: Parameters<typeof poolEligible>[1], edges: ReadonlyMap<string, readonly string[]> = NO_EDGES,
  ): string[] => poolEligible(r, pool, edges).map((a) => a.id);

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

  it('a central edge outranks the declared pool here too (T7-R1)', () => {
    // `claude-b` is declared `pool-b`; a central edge says `pool-a` instead,
    // and the eligibility filter must follow the central tag, not the
    // declared one — `claude` is dropped from `pool-a`'s list and `claude-b`
    // joins it.
    const edges = new Map([['claude-b', ['pool-a']], ['claude', ['pool-b']]]);
    expect(ids({ state: 'tagged', name: 'pool-a' }, edges)).toEqual(['claude-a', 'claude-b', 'claude-d']);
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
// import line be `import type`, and this module has exactly one value IMPORT
// STATEMENT — `poolRule` and `declaredAccountPool` (wave 1 Task 5 fix round 1,
// T5-R1), both from `shared/poolrule.js`, itself L0 and importing nothing.
// That import is the whole point (the rule and its one adapter are spelled
// once), so the assertion below pins it EXACTLY: one value import statement,
// and it must be that one, naming only symbols from the L0 module.
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

  it('takes exactly ONE value import statement, and it is L0 poolrule.js', () => {
    const imports = [...code().matchAll(/^\s*import\b[^\n]*/gm)].map((m) => m[0]!.trim());
    expect(imports.length, 'no imports found — the scan is over nothing').toBeGreaterThan(0);
    const values = imports.filter((l) => !/^import\s+type\b/.test(l));
    expect(values, 'poolrule.ts takes a value import that is not the L0 module')
      .toEqual(["import { poolRule, declaredAccountPool } from '../../shared/poolrule.js';"]);
  });
});

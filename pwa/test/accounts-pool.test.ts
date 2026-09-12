// The PWA's two pool projections: the single reader of `RosterWire.pool`, and
// the split that composes it with L0's `poolRule`. There is no second copy of
// the rule here — every verdict below comes out of `shared/poolrule.ts`, and
// these cases exist to prove the COMPOSITION (which side a wrapper lands on,
// and what an undecidable tag does to the whole list) rather than the rule.
//
// The full `POOL_RULE_CASES` table has two consumers, bash and the L1 module;
// this package cannot import `server/test/fixtures`, so it pins the six shapes
// that reach a phone.
import { describe, it, expect } from 'vitest';
import type { ProjectPoolWire, RosterWire } from '../../shared/api';
import { accountPool, homeAbleLabelList } from '../src/lib/accounts';
import { poolLabelList, poolOptions, poolSide, projectPoolOf, splitByPool } from '../src/lib/pools';
import { TEST_ROSTER } from './rosterFixture';

/** `TEST_ROSTER` with pools hung on it by id — never a second hand-typed
 *  roster, so labels/hues/homeAble stay the fixture every other suite reads. */
const pooled = (byId: Record<string, string>): RosterWire[] =>
  TEST_ROSTER.map((a) => ({ ...a, pool: byId[a.id] ?? null }));

/** The wire an OLDER server sends: no `pool` key at all. Built by picking the
 *  fields off, the same idiom `accounts-screen.test.tsx` uses for its
 *  before-`hidden` payload. */
const olderWire: RosterWire[] =
  TEST_ROSTER.map(({ id, label, hue, homeAble, hidden }) => ({ id, label, hue, homeAble, hidden })) as RosterWire[];

const tagged = (name: string): ProjectPoolWire => ({ state: 'tagged', name });

describe('accountPool — the ONE reader of RosterWire.pool', () => {
  it('answers the string a tagged account carries', () => {
    expect(accountPool(pooled({ claude: 'pool-a' }), 'claude')).toBe('pool-a');
  });

  it('answers null for an account the roster carries with no pool', () => {
    expect(accountPool(pooled({ claude: 'pool-a' }), 'claude2')).toBeNull();
  });

  it('answers null when the key is absent altogether — an older server is untagged, not unknown', () => {
    // Absence-permits. A server built before wave 1 omits the field; reading
    // it as anything but "untagged" would let a build refuse a swap on
    // evidence it never received.
    expect(accountPool(olderWire, 'claude')).toBeNull();
  });

  it('answers null for a wrapper this roster does not have at all', () => {
    // A live session can report a wrapper the roster dropped (`rosterWrapperIds`'s
    // own docstring). Not being able to name its pool is not a mismatch.
    expect(accountPool(pooled({ claude: 'pool-a' }), 'claude-unrostered')).toBeNull();
  });

  it('normalizes an empty pool from a malformed trusted wire to untagged', () => {
    const malformed = TEST_ROSTER.map((a) => ({ ...a, pool: a.id === 'claude' ? '' : null }));
    expect(accountPool(malformed, 'claude')).toBeNull();
  });

  it('normalizes an off-grammar pool from a malformed trusted wire to untagged', () => {
    const malformed = TEST_ROSTER.map((a) => ({ ...a, pool: a.id === 'claude' ? 'Pool A' : null }));
    expect(accountPool(malformed, 'claude')).toBeNull();
  });
});

describe('poolSide — the rule, composed and never restated', () => {
  it('serves when the project is untagged', () => {
    expect(poolSide('pool-a', { state: 'untagged' })).toBe('eligible');
  });

  it('serves when the account is untagged', () => {
    expect(poolSide(null, tagged('pool-a'))).toBe('eligible');
  });

  it('serves when the two names agree', () => {
    expect(poolSide('pool-a', tagged('pool-a'))).toBe('eligible');
  });

  it('crosses when the two names differ', () => {
    expect(poolSide('pool-b', tagged('pool-a'))).toBe('crossing');
  });

  it('is unknown on an unreadable or malformed tag, for a TAGGED account too', () => {
    // Undecidable is decided FIRST — nobody decides, not even for an account
    // whose own pool is known. Folding either state into `crossing` would hide
    // a row on a tag nobody could read; folding it into `eligible` would claim
    // a rule the fleet never stated.
    expect(poolSide('pool-b', { state: 'unreadable' })).toBe('unknown');
    expect(poolSide('pool-b', { state: 'malformed' })).toBe('unknown');
  });

  it('is unknown when there is no project pool at all', () => {
    expect(poolSide('pool-b', null)).toBe('unknown');
  });
});

describe('splitByPool', () => {
  const roster = pooled({ claude: 'pool-a', claude2: 'pool-b', 'claude-corp': 'pool-a' });
  const all = ['claude', 'claude2', 'claude-corp', 'claude-dev0'];

  it('puts in-pool and untagged accounts on the eligible side and the rest on the crossing side', () => {
    // `claude-dev0` carries no pool: an untagged ACCOUNT serves a tagged
    // project, so it is eligible, not crossing.
    const split = splitByPool(roster, all, tagged('pool-a'));
    expect(split.eligible).toEqual(['claude', 'claude-corp', 'claude-dev0']);
    expect(split.crossing).toEqual(['claude2']);
    expect(split.unknown).toBe(false);
  });

  it('offers everything, with nothing crossing, when the project is untagged', () => {
    const split = splitByPool(roster, all, { state: 'untagged' });
    expect(split.eligible).toEqual(all);
    expect(split.crossing).toEqual([]);
    expect(split.unknown).toBe(false);
  });

  it('offers EVERYTHING and flags unknown when the project pool is null — hiding on unknown would be inventing a rule', () => {
    const split = splitByPool(roster, all, null);
    expect(split.eligible).toEqual(all);
    expect(split.crossing).toEqual([]);
    expect(split.unknown).toBe(true);
  });

  it('does the same on an unreadable and on a malformed tag', () => {
    for (const p of [{ state: 'unreadable' } as const, { state: 'malformed' } as const]) {
      const split = splitByPool(roster, all, p);
      expect(split.eligible, p.state).toEqual(all);
      expect(split.crossing, p.state).toEqual([]);
      expect(split.unknown, p.state).toBe(true);
    }
  });

  it('preserves the caller order it was handed and returns fresh arrays', () => {
    const wrappers = ['claude2', 'claude'];
    const split = splitByPool(roster, wrappers, tagged('pool-a'));
    expect(split.eligible).toEqual(['claude']);
    expect(split.crossing).toEqual(['claude2']);
    expect(split.eligible).not.toBe(wrappers);
  });
});

describe('projectPoolOf — the frame, read by project name', () => {
  it('is null when no frame has arrived', () => {
    expect(projectPoolOf(null, 'demo')).toBeNull();
  });

  it('reads a listed project out of the map', () => {
    expect(projectPoolOf(
      { listed: true, byProject: { demo: tagged('pool-a') }, enforcement: 'enforced' }, 'demo',
    )).toEqual(tagged('pool-a'));
  });

  it('reads a project the listing does not name as UNTAGGED — the directory was measured', () => {
    expect(projectPoolOf(
      { listed: true, byProject: { demo: tagged('pool-a') }, enforcement: 'enforced' }, 'quiet-basin',
    )).toEqual({ state: 'untagged' });
  });

  it.each(['constructor', '__proto__', 'toString', 'valueOf', 'hasOwnProperty', 'isPrototypeOf'])(
    'reads an absent prototype-named project as UNTAGGED',
    (project) => {
      expect(projectPoolOf({ listed: true, byProject: {}, enforcement: 'enforced' }, project))
        .toEqual({ state: 'untagged' });
    },
  );

  it('reads an own tagged prototype-named project rather than its inherited property', () => {
    expect(projectPoolOf(
      { listed: true, byProject: { constructor: tagged('pool-a') }, enforcement: 'enforced' }, 'constructor',
    )).toEqual(tagged('pool-a'));
  });

  it('reads every project as UNREADABLE when the listing itself failed', () => {
    // `listed:false` is "present at the root and unlistable", never "nothing
    // is tagged" — the polarity §6 disclosed. Untagged here would silently
    // lift every constraint on the box.
    expect(projectPoolOf({ listed: false, enforcement: 'enforced' }, 'demo'))
      .toEqual({ state: 'unreadable' });
  });
});

describe('poolOptions — derived, never enumerated', () => {
  it('lists each distinct pool name once, in roster order', () => {
    expect(poolOptions(pooled({ claude: 'pool-a', claude2: 'pool-b', 'claude-corp': 'pool-a' })))
      .toEqual(['pool-a', 'pool-b']);
  });

  it('is empty for a roster with no pools at all', () => {
    expect(poolOptions(olderWire)).toEqual([]);
  });
});

describe('poolLabelList', () => {
  const roster = pooled({ claude: 'pool-a', claude2: 'pool-b', 'claude-corp': 'pool-a' });

  it('names only the HOME-ABLE accounts that can serve this pool, by label', () => {
    // `gpt` is homeAble:false and is never consulted for a placement fact —
    // the reason this list names accounts individually instead of saying
    // "all accounts" (homeAbleLabelList's own docstring).
    expect(poolLabelList(roster, tagged('pool-b'))).toBe('team·alt and team·d');
  });

  it('is byte-identical to homeAbleLabelList when nothing is known — so the untagged copy never moved', () => {
    expect(poolLabelList(roster, null)).toBe(homeAbleLabelList(roster));
    expect(poolLabelList(roster, { state: 'untagged' })).toBe(homeAbleLabelList(roster));
    expect(poolLabelList(roster, { state: 'unreadable' })).toBe(homeAbleLabelList(roster));
  });

  it('is empty when no home-able account is in the pool — the empty-pool strand, before it bites', () => {
    // This LABEL LIST can be empty only when every home-able account is
    // tagged. Placement additionally needs `_account_ok` and `_avail`, so this
    // pure projection does not decide whether a session strands.
    const emptyPoolRoster = pooled({
      claude: 'pool-a', claude2: 'pool-b', 'claude-corp': 'pool-a', 'claude-dev0': 'pool-a',
    });
    expect(poolLabelList(emptyPoolRoster, tagged('pool-c'))).toBe('');
  });
});

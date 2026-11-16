// The organization relation, in TypeScript and in bash (plan 2026-11-16-account-organization.md Task A2, issue
// #2909): `shared/accountOrg.ts#orgRelation` and `ccd/ccd#_org_rel`, both driven over ORG_RELATION_CASES (slug
// `org-relation-has-two-twins`), and `orgSpread` over every row of Table 4. Unknown is never "same", except for one
// account against itself (`same-account-is-same-org`, `unknown-org-is-no-preference`).
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { makeCcdHarness, seedAccountsSh, type CcdHarness } from './ccdWsHelpers.js';
import { orgRelation, orgSpread, ORG_RELATIONS } from '../../shared/accountOrg.js';
import { parseRoster } from '../../shared/roster.js';
import { ORG_BY_ID, ORG_RELATION_CASES, ORG_SPREAD_CASES, ORG_TEST_ROSTER } from './fixtures/orgRelation.js';

describe('the shared cases', () => {
  it('cover every relation word, and agree with the roster they name', () => {
    for (const w of ORG_RELATIONS) expect(ORG_RELATION_CASES.some((c) => c.expect === w), w).toBe(true);
    const r = parseRoster(ORG_TEST_ROSTER);
    for (const [id, org] of Object.entries(ORG_BY_ID)) expect(r.byId.get(id)?.org, id).toBe(org);
  });
});

describe('orgRelation, the TypeScript twin, over ORG_RELATION_CASES', () => {
  it.each(ORG_RELATION_CASES)('$name: $a and $b are $expect', ({ a, b, expect: want }) => {
    expect(orgRelation({ id: a, org: ORG_BY_ID[a]! }, { id: b, org: ORG_BY_ID[b]! })).toBe(want);
  });
});

describe('_org_rel, the bash twin, over ORG_RELATION_CASES and the real generated accounts.sh', () => {
  let h: CcdHarness;
  beforeEach(() => {
    h = makeCcdHarness('ccrc-org-rel-');
    seedAccountsSh(h.home, ORG_TEST_ROSTER);
  });
  afterEach(() => { h.cleanup(); });

  it('answers every case with one word and rc 0', () => {
    const script = ORG_RELATION_CASES.map((c) => `printf '%s|%s\\n' "$(_org_rel ${c.a} ${c.b})" "$?"`).join('; ');
    expect(h.sh(script).split('\n')).toEqual(ORG_RELATION_CASES.map((c) => `${c.expect}|0`));
  });

  it('_acct_org reads the label, and silence for an unlabelled or unknown account', () => {
    expect(h.sh('_acct_org lane-a')).toBe('org-a');
    expect(h.sh('_acct_org lane-c')).toBe('org-b');
    expect(h.sh('printf "[%s|%s]" "$(_acct_org lane-d)" "$?"')).toBe('[|0]');
    expect(h.sh('printf "[%s|%s]" "$(_acct_org nosuch)" "$?"')).toBe('[|0]');
  });

  it('over an older accounts.sh with no _ccrc_org, two distinct accounts are unknown and one account is same', () => {
    const out = h.sh('unset -f _ccrc_org; printf "%s %s %s" "$(_org_rel lane-a lane-b 2>&1)" "$(_org_rel lane-a lane-c 2>&1)" '
      + '"$(_org_rel lane-a lane-a 2>&1)"');
    expect(out).toBe('unknown unknown same');
  });
});

describe('orgSpread over every row of Table 4', () => {
  it.each(ORG_SPREAD_CASES)('$name', ({ set, expect: want }) => {
    expect(orgSpread(set)).toEqual(want);
  });
});

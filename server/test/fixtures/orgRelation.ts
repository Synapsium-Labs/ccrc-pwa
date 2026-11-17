// The organization relation's shared cases (plan 2026-11-16-account-organization.md Table 1 and Table 4, slug
// `org-relation-has-two-twins`): `shared/accountOrg.ts#orgRelation` and `ccd/ccd#_org_rel` are each driven over
// ORG_RELATION_CASES, so the two spellings of one rule cannot drift apart without a red suite.
import type { OrgRelation, OrgSpread } from '../../../shared/accountOrg.js';

const acct = (id: string, kind: 'upstream' | 'generated', org?: string): Record<string, unknown> => ({
  id, label: id, configDirSuffix: `.${id}`, exec: { kind }, homeAble: true, hue: 'cyan', telemetry: 'anthropic',
  ...(org !== undefined ? { org } : {}),
});

/** Two accounts in `org-a`, one in `org-b`, two with no label. */
export const ORG_TEST_ROSTER = {
  version: 1,
  accounts: [
    acct('lane-a', 'upstream', 'org-a'), acct('lane-b', 'generated', 'org-a'), acct('lane-c', 'generated', 'org-b'),
    acct('lane-d', 'generated'), acct('lane-e', 'generated'),
  ],
} as const;

export const ORG_BY_ID: Readonly<Record<string, string | null>> = {
  'lane-a': 'org-a', 'lane-b': 'org-a', 'lane-c': 'org-b', 'lane-d': null, 'lane-e': null,
};

export interface OrgRelationCase { readonly name: string; readonly a: string; readonly b: string; readonly expect: OrgRelation }

/** Every row of Table 1, each direction where the answer could differ. */
export const ORG_RELATION_CASES: readonly OrgRelationCase[] = [
  { name: 'one labelled account against itself', a: 'lane-a', b: 'lane-a', expect: 'same' },
  { name: 'one unlabelled account against itself (same-account-is-same-org)', a: 'lane-d', b: 'lane-d', expect: 'same' },
  { name: 'two accounts with one label', a: 'lane-a', b: 'lane-b', expect: 'same' },
  { name: 'two accounts with different labels', a: 'lane-a', b: 'lane-c', expect: 'other' },
  { name: 'two accounts with different labels, the other way round', a: 'lane-c', b: 'lane-b', expect: 'other' },
  { name: 'a labelled account against an unlabelled one', a: 'lane-a', b: 'lane-d', expect: 'unknown' },
  { name: 'an unlabelled account against a labelled one', a: 'lane-d', b: 'lane-c', expect: 'unknown' },
  { name: 'two unlabelled accounts (unknown is never same)', a: 'lane-d', b: 'lane-e', expect: 'unknown' },
];

export interface OrgSpreadCase {
  readonly name: string;
  readonly set: readonly (string | null)[] | 'unmeasured';
  readonly expect: OrgSpread;
}

/** Every row of Table 4: the labels of the accounts C56 counts, or its unmeasured figure. */
export const ORG_SPREAD_CASES: readonly OrgSpreadCase[] = [
  { name: 'all labelled, one label', set: ['org-a', 'org-a'], expect: { kind: 'one', orgs: 1, unlabelled: 0 } },
  { name: 'two labels', set: ['org-a', 'org-b'], expect: { kind: 'many', orgs: 2, unlabelled: 0 } },
  { name: 'two labels and an unlabelled account', set: ['org-a', 'org-b', null], expect: { kind: 'many', orgs: 2, unlabelled: 1 } },
  { name: 'one label among the labelled, some unlabelled', set: ['org-a', null, null], expect: { kind: 'partly', orgs: 1, unlabelled: 2 } },
  { name: 'none labelled', set: [null, null], expect: { kind: 'none', orgs: 0, unlabelled: 2 } },
  { name: 'no accounts', set: [], expect: { kind: 'none', orgs: 0, unlabelled: 0 } },
  { name: "C56's count unmeasured", set: 'unmeasured', expect: { kind: 'unmeasured', orgs: 0, unlabelled: 0 } },
];

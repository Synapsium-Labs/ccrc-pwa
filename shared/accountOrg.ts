// The organization relation between two accounts, and the spread of an account set across organizations (plan
// 2026-11-16-account-organization.md §2 and §5, issue #2909). L0, C1: imports nothing, because the PWA bundles it.
//
// An account's organization is the operator's label (`AccountDef.org`, slug `org-is-an-operator-label`), never the
// organization's id. A missing label is an unknown organization, and unknown is never "same", except for one account
// against itself: one account is one organization (`same-account-is-same-org`). `ccd/ccd#_org_rel` is the bash twin of
// `orgRelation`; `server/test/org-relation.test.ts` drives both over one fixture (`org-relation-has-two-twins`).

/** How two accounts' organizations relate (Table 1). */
export type OrgRelation = 'same' | 'other' | 'unknown';
const ORG_RELATION_MAP: Record<OrgRelation, true> = { same: true, other: true, unknown: true };
export const ORG_RELATIONS = Object.keys(ORG_RELATION_MAP) as OrgRelation[];

/** The two facts the relation reads from an account. */
export interface OrgSide {
  readonly id: string;
  readonly org: string | null;
}

/** `same` for one account or two with one label, `other` for two labels, `unknown` when either label is missing. */
export function orgRelation(a: OrgSide, b: OrgSide): OrgRelation {
  if (a.id === b.id) return 'same';
  if (a.org === null || b.org === null) return 'unknown';
  return a.org === b.org ? 'same' : 'other';
}

/** What Settings says about an account set (Table 4). `none` means nobody labelled any account in it, so there is
 *  nothing to compare; `unmeasured` is a C56 count that could not be measured, which says nothing either. */
export type OrgSpreadKind = 'one' | 'many' | 'partly' | 'none' | 'unmeasured';
const ORG_SPREAD_KIND_MAP: Record<OrgSpreadKind, true> = { one: true, many: true, partly: true, none: true, unmeasured: true };
export const ORG_SPREAD_KINDS = Object.keys(ORG_SPREAD_KIND_MAP) as OrgSpreadKind[];

export interface OrgSpread {
  readonly kind: OrgSpreadKind;
  /** How many distinct labels the set's labelled accounts carry. */
  readonly orgs: number;
  /** How many of the set's accounts carry no label. */
  readonly unlabelled: number;
}

/** The spread of the labels of the accounts C56 counts, or of its unmeasured figure. It warns, never refuses
 *  (`org-spread-warns-never-refuses`): the caller words it beside the count. */
export function orgSpread(labels: readonly (string | null)[] | 'unmeasured'): OrgSpread {
  if (labels === 'unmeasured') return { kind: 'unmeasured', orgs: 0, unlabelled: 0 };
  const orgs = new Set(labels.filter((l): l is string => l !== null)).size;
  const unlabelled = labels.filter((l) => l === null).length;
  const kind: OrgSpreadKind = orgs >= 2 ? 'many' : orgs === 0 ? 'none' : unlabelled > 0 ? 'partly' : 'one';
  return { kind, orgs, unlabelled };
}

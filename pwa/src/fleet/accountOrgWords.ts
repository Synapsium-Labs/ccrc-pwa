// The organization label's words on the Accounts card (plan 2026-11-16-account-organization.md Task B1, #2909). L1:
// pure words, no I/O. The label is the operator's name for an account's Claude organization, never the organization's
// id (`org-is-an-operator-label`, `org-label-refuses-id-shapes`); an unset label reads "not set", an unknown
// organization, which nothing reads as "same" (`unknown-org-is-no-preference`). A refusal is worded from its CODE only,
// as `laneActRefusal` words the lane acts', and every code this file has no words for is handed to it.
import type { RouteRefusal } from '../../../shared/refusal';
import { laneActRefusal, refusalWordOf } from './accountWords';

export const ORG_LABEL = 'Organization';
/** The card's act, and the sheet's two. */
export const ORG_SET = 'Set';
export const ORG_SAVE = 'Save';
export const ORG_CLEAR = 'Clear';
export const ORG_FIELD = 'Organization name';
export const ORG_HINT = "A name you choose, the same for accounts in one Claude organization. Never paste the organization's id.";

/** The card's line: "Organization: org-a", or "Organization: not set". */
export const orgRow = (org: string | null): string => `${ORG_LABEL}: ${org ?? 'not set'}`;
/** Set's accessible name, by the lane's label. */
export const orgSetName = (label: string): string => `${ORG_SET} ${label}'s organization`;
export const orgSheetTitle = (label: string): string => `Which organization is ${label} in?`;

type OrgRefusalWord = Extract<RouteRefusal, 'org-looks-like-an-id' | 'bad-request'>;
const ORG_REFUSAL_TEXT: Readonly<Record<OrgRefusalWord, (id: string) => string>> = {
  'org-looks-like-an-id': (id) => `That looks like an organization's id, so ${id}'s organization was not changed. `
    + 'Use a name you choose, such as org-a: ccrc never stores the id.',
  // The door's answer to a label off the name shape. The sheet holds Save back for one, so this is an older page's.
  'bad-request': (id) => `${id}'s organization was not changed: a name is lowercase letters, digits and hyphens, `
    + 'starting with a letter, at most 32 characters.',
};

/** A refused save's words: this row's codes first, read by `Object.hasOwn`, then the lane acts' words. */
export function orgSaveRefusal(id: string, failure: unknown): string {
  const word = refusalWordOf(failure);
  return word !== undefined && Object.hasOwn(ORG_REFUSAL_TEXT, word)
    ? ORG_REFUSAL_TEXT[word as OrgRefusalWord](id)
    : laneActRefusal('org', id, failure);
}

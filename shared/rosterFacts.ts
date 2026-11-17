// The two account facts the Overlord's serviceability reads (Overlord spec §3.4, H16 and "H16, continued"), with
// one home for their vocabulary. L0, C1: imports nothing, because the PWA bundles `shared/roster.ts`, which
// imports this file.
//
// The billing fact says whether Fable on an account bills usage credits. The continuity record says the operator
// recorded that a lane keeps the Overlord's guards, hooks and reader types. Both are written by one writer,
// `deploy/account-op.mjs`'s `set-facts` op, reached through `ccrc account set` and the account set door
// (`POST /api/accounts/:id/set`). Both are optional in `~/.ccrc/accounts.json`: absence means nobody set the fact,
// and a written `null` is refused, as `pool`'s is.
//
// The organization label rides the same writer, door and wire (plan 2026-11-16-account-organization.md): a name the
// operator chooses, never the organization's id. It is a preference, not a fact the serviceability gate reads, so it
// never widens (`factsChangeWidens`). Its vocabulary is `shared/roster.ts`'s (`orgLabelVerdict`, `ORG_CLEAR_WORD`).

/** H16: does Fable on this account bill usage credits. Absent in the file means nobody set it. */
export const FABLE_BILLINGS = ['included', 'credits'] as const;
export type FableBilling = (typeof FABLE_BILLINGS)[number];

/** H16, continued: the operator recorded that this lane keeps the Overlord's guards, hooks and reader types. */
export interface ContinuityRecord {
  /** Epoch seconds, from the verb's clock when the operator set it. */
  readonly recordedAt: number;
}

/** What `RosterWire` carries, both optional: an older server omits them, and absence reads as "not set". */
export interface RosterFactsWire {
  readonly fableBilling?: FableBilling;
  readonly continuity?: ContinuityRecord;
  /** The organization label (plan 2026-11-16-account-organization.md), absent when unset. */
  readonly org?: string;
}

/** The door's body: a change to either fact, or to the organization label. */
export interface RosterFactsChange {
  readonly fableBilling?: FableBilling;
  readonly continuity?: 'on' | 'off';
  /** A label, or `none` to clear it. A preference only: it widens nothing, so it never counts below. */
  readonly org?: string;
}

/**
 * True when the change names a widening value, whatever is stored (the serviceability plan's question 8): the door
 * then takes the step-up. It never compares with a stored value, because the server's roster mirror may lag the
 * fleet box's file. A narrowing (`credits`, `off`) never needs one.
 */
export function factsChangeWidens(c: RosterFactsChange): boolean {
  return c.fableBilling === 'included' || c.continuity === 'on';
}

/** The wire half of the two facts and the label: one that is set is carried, an unset one is absent, never `null`. */
export function rosterFactsWireOf(a: {
  readonly fableBilling: FableBilling | null;
  readonly continuity: ContinuityRecord | null;
  readonly org: string | null;
}): RosterFactsWire {
  return {
    ...(a.org !== null ? { org: a.org } : {}),
    ...(a.fableBilling !== null ? { fableBilling: a.fableBilling } : {}),
    ...(a.continuity !== null ? { continuity: { recordedAt: a.continuity.recordedAt } } : {}),
  };
}

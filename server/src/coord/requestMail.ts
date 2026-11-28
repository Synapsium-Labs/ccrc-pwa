/**
 * The request ids' one rule at the three doors that take a `requestId` (spec §5.5, H22, H23; plan
 * `docs/superpowers/plans/2026-11-16-overlord-w2/w2-request-ids.md` §4; Overlord W2, request ids A). C5, L1: pure. The doors
 * gather the facts and act; every decision is here.
 *
 * - `requestOwnerReadOf`: a request as the rule reads it, from the store's row.
 * - `programmeRequestVerdict`: the run door's and the goals door's rule, the request's owner is the programme.
 * - `requestMailVerdict`: the mail door's rule, the sender owns the request, and mail to the Overlord's role (check 7's lift,
 *   ruling F3 as the coordinator ruled it, call 1938).
 *
 * No oracle (F12, call 1938): an unknown, unowned or foreign request answers one word with one detail, which names no other
 * programme and does not say whether the id exists. At the Overlord's recipient that word is today's `unknown-recipient`,
 * and a caller that names no request at all reads the same detail. A fact that could not be read is its own retryable
 * answer, never a refusal and never recorded.
 */
import { TERMINAL_REQUEST_STATES, type RequestState } from '../../../shared/overlordRequests.js';
import type { DesignationRead } from '../../../shared/overlord-designation.js';
import type { OverlordRefusal } from '../../../shared/refusal.js';

/** The doors' one word for a request that is not the caller's: the Overlord's refusal table's (`OVERLORD_REFUSALS`), its one
 *  home; the mail door records it as a rejection through this alias. */
export type RequestRefusal = Extract<OverlordRefusal, 'request-not-yours'>;

/** A request as the owner rule reads it: owned (routed at least once) with whether it is open, not yet owned, or absent. */
export type RequestOwnerRead =
  | { readonly kind: 'owned'; readonly owner: string; readonly open: boolean }
  | { readonly kind: 'unowned' }
  | { readonly kind: 'absent' };

/** The store's row (`requestById`) as the rule reads it. A stored state word this build cannot name counts as open, as the
 *  store's `openRequests` counts it (the request record's `a-word-this-build-lacks`). */
export function requestOwnerReadOf(row: { readonly owner: string | null; readonly state: string } | 'absent'): RequestOwnerRead {
  if (row === 'absent') return { kind: 'absent' };
  if (row.owner === null) return { kind: 'unowned' };
  return { kind: 'owned', owner: row.owner, open: !TERMINAL_REQUEST_STATES.includes(row.state as RequestState) };
}

/** The one detail of `request-not-yours` (H23): the id the caller gave, no other programme, nothing on whether it exists. */
export const requestNotYoursDetail = (requestId: number): string => `request ${requestId} is not this programme's`;

export type ProgrammeRequestVerdict =
  | { readonly ok: true }
  | { readonly ok: false; readonly refuse: RequestRefusal; readonly detail: string };

/** The run door's and the goals door's rule (RI4, RI9): the request's owner is the programme. Its state is not read: a run or a
 *  goals change made for a request that has just closed is harmless, and the done test reads what came after. */
export function programmeRequestVerdict(read: RequestOwnerRead, requestId: number, programme: string): ProgrammeRequestVerdict {
  return read.kind === 'owned' && read.owner === programme ? { ok: true }
    : { ok: false, refuse: 'request-not-yours', detail: requestNotYoursDetail(requestId) };
}

/** The Overlord's designation as the mail door reads it (`CoordStore.designationRead`): a bound session, a designation with no
 *  session bound, none, or unreadable. */
export type MailDesignation =
  | { readonly kind: 'bound'; readonly sessionId: string }
  | { readonly kind: 'unbound' }
  | { readonly kind: 'none' }
  | { readonly kind: 'unmeasured' };

/** The designation's read (`CoordStore.designationRead`, three arms, never throws) as the mail door takes it: a row with no
 *  session bound (between a retire and a start, or a restart in flight) is its own word, neither "none" nor unreadable. */
export function mailDesignationOf(d: DesignationRead): MailDesignation {
  if (d.kind === 'unmeasured') return { kind: 'unmeasured' };
  if (d.kind === 'designated') return { kind: 'bound', sessionId: d.sessionId };
  return d.row === null ? { kind: 'none' } : { kind: 'unbound' };
}

/** What the mail door reads for one mail, each read made only when the rule reaches it (call 1938's order: the sender's
 *  identity, already proven by checks 5 to 6, then ownership, and only for the owner the request's state and the designation).
 *  A read that throws is caught by the door's adapter and answered `unmeasured`. */
export interface RequestMailFacts {
  /** The body's `toId` is the Overlord's role. */
  readonly toOverlord: boolean;
  /** The body's `requestId`, or null when it names none. */
  readonly requestId: number | null;
  readonly request: () => RequestOwnerRead | 'unmeasured';
  /** The owner test on main (`CoordStore.claimsProgramme`, with the sender's measured uuid) for the request's owner. */
  readonly senderOwns: (owner: string) => boolean | 'unmeasured';
  readonly designation: () => MailDesignation;
}

export type RequestMailVerdict =
  /** Admitted. `deliverTo`: the session the delivery names in place of the role (a report), else null; `stampNews`: the
   *  request's news is stamped in the mail's transaction; `report`: mail to the Overlord, which meets the reports quota. */
  | { readonly ok: true; readonly deliverTo: string | null; readonly stampNews: boolean; readonly report: boolean;
      readonly requestId: number | null }
  /** Refused and recorded through the door's `refuse()`. */
  | { readonly ok: false; readonly refuse: 'unknown-recipient' | RequestRefusal; readonly detail: string }
  /** A fact could not be read: a plain reply, recorded nowhere (D-2545), retryable. */
  | { readonly ok: false; readonly reply: 'run-unreadable' | 'unmeasured'; readonly detail: string };

/** The one detail every caller who may not report to the Overlord reads (call 1938, sharpening 1): no request named, an
 *  unknown, unowned or foreign one alike. It is today's detail byte for byte, so the whole answer a non-owner reads is the one
 *  main sent before this piece (the walk of item 3). */
export const OVERLORD_TAKES_ONLY_ITS_OWNERS = "the Overlord's role takes no mail in W1";

/**
 * The mail door's rule, first match:
 *
 * | Case | Answer |
 * |---|---|
 * | Not to the Overlord, no `requestId` | admitted: today's mail |
 * | To the Overlord, no `requestId` | `unknown-recipient`, recorded, the one detail |
 * | The request could not be read | `run-unreadable`, unrecorded |
 * | Absent or unowned request | to the Overlord: `unknown-recipient`, the one detail; else `request-not-yours` |
 * | The owner test could not be read | `run-unreadable`, unrecorded |
 * | The sender does not own it | as absent |
 * | Not to the Overlord | admitted, news stamped while the request is open |
 * | The request is closed | `unknown-recipient`, recorded, "request N is closed" (told to its owner only) |
 * | The designation could not be read | `unmeasured`, unrecorded |
 * | No Overlord is designated | `unknown-recipient`, recorded, "no Overlord is designated" |
 * | Designated, no session bound | admitted to the role's own identity, held (call 1938, sharpening 2) |
 * | Otherwise | admitted to the bound session, a report, news stamped |
 */
export function requestMailVerdict(f: RequestMailFacts): RequestMailVerdict {
  if (f.requestId === null) {
    return f.toOverlord ? { ok: false, refuse: 'unknown-recipient', detail: OVERLORD_TAKES_ONLY_ITS_OWNERS }
      : { ok: true, deliverTo: null, stampNews: false, report: false, requestId: null };
  }
  const id = f.requestId;
  const notYours: RequestMailVerdict = f.toOverlord ? { ok: false, refuse: 'unknown-recipient', detail: OVERLORD_TAKES_ONLY_ITS_OWNERS }
    : { ok: false, refuse: 'request-not-yours', detail: requestNotYoursDetail(id) };
  const read = f.request();
  if (read === 'unmeasured') return { ok: false, reply: 'run-unreadable', detail: 'the request record could not be read' };
  if (read.kind !== 'owned') return notYours;
  const owns = f.senderOwns(read.owner);
  if (owns === 'unmeasured') return { ok: false, reply: 'run-unreadable', detail: "the sender's programme could not be read" };
  if (!owns) return notYours;
  if (!f.toOverlord) return { ok: true, deliverTo: null, stampNews: read.open, report: false, requestId: id };
  if (!read.open) return { ok: false, refuse: 'unknown-recipient', detail: `request ${id} is closed` };
  const d = f.designation();
  if (d.kind === 'unmeasured') return { ok: false, reply: 'unmeasured', detail: "the Overlord's designation could not be read" };
  if (d.kind === 'none') return { ok: false, refuse: 'unknown-recipient', detail: 'no Overlord is designated' };
  return { ok: true, deliverTo: d.kind === 'bound' ? d.sessionId : null, stampNews: true, report: true, requestId: id };
}

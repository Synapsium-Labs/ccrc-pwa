// THE PARK'S DECIDERS (approvals plan 2026-11-18, §3.3 and Tasks 3.1 to 3.3; approvals PR 3). Ring L1, context C6 (operator
// questions): pure, no fs, no store, no clock, no crypto. The questions owner (`coord/questions.ts`) reads the facts, asks
// here and acts; the store (`approvalParkStore.ts`) writes. `decideApprovalLapse`'s `park` answer stays beside today's lapse
// in `questionPolicy.ts` (the plan's one decider); this file holds the park's other decisions:
//  - `parkWordAt`: the word a mint stores (`live`, `shadow`, `capped`), decided ONCE at mint (F1, review 2565);
//  - `parkKeyOf`: the key a retry repeats (the child's registry id, the run id, the request's own input digest);
//  - `classMeets`: whether a retry's fresh class may meet a ruling taken against an earlier row's class;
//  - `parkRecordRefusal`: whether a principal's ruling may be recorded on a parked row's park (the doors);
//  - `signingRefusal`: the ONE SIGNING SITE's guard (§3.4, F11), run before every signature;
//  - `fetchedAtRecordable`: whether the ruling read may record `fetchedAt` (F8-c, F2-a);
//  - `parkedApprovalViewOf`: a parked row as Waiting on you lists it (§3.3.2).
import { type ApprovalRefusal } from '../../../shared/api.js';
import { APPROVAL_PARK_HORIZON_MS, APPROVAL_PARK_SLOTS, type ApprovalParkWord, type ApprovalRulingAuthority, type ParkedApprovalView } from '../../../shared/approval-park.js';

/** The park's word at mint (§3.3.1): `shadow` while the park lane is not live or sign-in is dark (a parked `escalate`
 *  prompt would have no door, F12); otherwise `capped` when the key's `APPROVAL_PARK_SLOTS` are all taken, else `live`.
 *  The store asks this INSIDE the mint's transaction with the slots it read there, so two requests of one key can never
 *  both be told `live` past the cap (the cap race, F1). */
export function parkWordAt(laneLive: boolean, signedIn: boolean, slotsTaken: number): ApprovalParkWord {
  if (!laneLive || !signedIn) return 'shadow';
  return slotsTaken >= APPROVAL_PARK_SLOTS ? 'capped' : 'live';
}

/** The park key (§3.3.1): the child's REGISTRY id (it survives a roll), the run id (registry ids are recycled, F8-d) and
 *  the sha256 hex of the canonical `[tool_name, cwd, tool_input]` (exactly what a retry repeats). Claude Code's
 *  `session_id` and the agent id are left out, so the main thread, or a new subagent of the same child, meets a ruling
 *  for the same command in the same `cwd`. The digest is the caller's: this file does no hashing. */
export function parkKeyOf(childId: string, runId: number, inputSha256: string): string {
  return `${childId}:${runId}:${inputSha256}`;
}

/** The classifier's classes, lowest first. A word outside them ranks above `forbidden`, so it never meets. */
const CLASS_RANK: Readonly<Record<string, number>> = { ordinary: 0, escalate: 1, forbidden: 2 };
const rankOf = (c: string): number => (Object.hasOwn(CLASS_RANK, c) ? CLASS_RANK[c] as number : 3);

/** A retry is classified again (§3.3.1): its fresh class meets a ruling taken against the earlier row's class only when it
 *  is the same or lower. A `forbidden` retry never meets a ruling, and neither does a class this build does not know. */
export function classMeets(freshClass: string, rulingClass: string): boolean {
  const fresh = rankOf(freshClass);
  return fresh <= 1 && fresh <= rankOf(rulingClass);
}

/** A park's ruling as the decisions read it: present (and whether it is spent), or none. */
export interface ParkRulingFacts {
  readonly verdict: 'allow' | 'deny';
  readonly authority: ApprovalRulingAuthority;
  readonly spent: boolean;
}

/** A park as the decisions read it. `void` is the park's run closed, or a pane answer voided it (F4, F16). */
export interface ParkFacts {
  readonly horizon: number | null;
  readonly void: boolean;
  readonly ruling: ParkRulingFacts | null;
  readonly coordDenied: boolean;
  readonly coordDeclined: boolean;
}

/** A stored park as the deciders read it (`approvalParkStore.ts#ParkRow`'s fields), with the run's closure folded into
 *  `void`: the caller read the run, and a run it could not read is passed as closed where doubt must refuse. */
export function parkFactsOf(
  p: { readonly horizon: number | null; readonly voided: boolean; readonly coordDenied: boolean; readonly coordDeclined: boolean;
    readonly ruling: { readonly verdict: 'allow' | 'deny'; readonly authority: ApprovalRulingAuthority; readonly spent: boolean } | null },
  runClosed: boolean,
): ParkFacts {
  return {
    horizon: p.horizon, void: p.voided || runClosed, coordDenied: p.coordDenied, coordDeclined: p.coordDeclined,
    ruling: p.ruling === null ? null : { verdict: p.ruling.verdict, authority: p.ruling.authority, spent: p.ruling.spent },
  };
}

/** Whether a park can still take or serve a ruling at `now`: it is not void, and its horizon has not passed. A park with
 *  no horizon yet (nothing parked on it) is open until a row parks. */
export function parkOpen(park: ParkFacts, now: number): boolean {
  return !park.void && (park.horizon === null || now < park.horizon);
}

/** Whether the park holds a ruling no retry has spent: the first unspent ruling wins (T8-4, F5). */
export const parkHasUnspentRuling = (park: ParkFacts): boolean => park.ruling !== null && !park.ruling.spent;

/** The row facts a door's ruling on a parked row reads. */
export interface ParkedRowFacts {
  readonly state: string;
  readonly class: string;
  readonly denyCurrent: boolean;
}

/** May a principal's ruling be recorded on a parked row's park (§3.3.1, the rule door; §3.3.2, the operator's door)? Null
 *  when it may; otherwise the refusal word, cheapest first:
 *  - the row is not `parked`, or its park is gone, void or past its horizon: `hook-gone` (nothing will meet a ruling);
 *  - the park holds an unspent ruling: `park-ruled` (the first unspent ruling wins);
 *  - an allow on a key whose park records the coordinator's deny: `coordinator-denied` (a deny is final for every authority);
 *  - an allow of a `forbidden` row: `guard-forbidden`;
 *  - a coordinator's allow of a row whose deny rules were not current: `deny-not-current`, then of a row the classifier
 *    did not class `ordinary`: `guard-escalate` (the verifier's v1 rule, applied at the door);
 *  - the operator's allow of an `ordinary` or `escalate` row is recorded, whatever the row's deny currency (Table 3b).
 *  A deny is recorded by either principal. */
export function parkRecordRefusal(
  row: ParkedRowFacts, park: ParkFacts | null, authority: Exclude<ApprovalRulingAuthority, 'overlord'>, verdict: 'allow' | 'deny', now: number,
): ApprovalRefusal | null {
  if (row.state !== 'parked' || park === null || !parkOpen(park, now)) return 'hook-gone';
  if (parkHasUnspentRuling(park)) return 'park-ruled';
  if (verdict === 'deny') return null;
  if (park.coordDenied) return 'coordinator-denied';
  if (row.class === 'forbidden') return 'guard-forbidden';
  if (authority === 'coordinator') {
    if (!row.denyCurrent) return 'deny-not-current';
    if (row.class !== 'ordinary') return 'guard-escalate';
    return null;
  }
  return row.class === 'ordinary' || row.class === 'escalate' ? null : 'guard-escalate';
}

/** What the one signing site's guard reads (§3.4, F11). `freshClass` is the class the row being signed for was given (the
 *  retry's own, classified again, or the in-window row's class run again over its held input); `denyStandingNow` is the
 *  child's deny standing read AT SIGNING, or `unread` when the caller passed no read (exactly the
 *  behaviour before PR 3's H4, PR 0's recorded residual; the claimant's door passes one since H4); `claimantNow` is the run's claimant as `heldFor` read it at
 *  signing, for a `coordinator` ruling; `parkDenied` is the park's record of a coordinator's deny on the key. */
export interface SigningFacts {
  readonly authority: Exclude<ApprovalRulingAuthority, 'overlord'>;
  readonly verdict: 'allow' | 'deny';
  readonly ruler: string;
  readonly rowClass: string;
  readonly freshClass: string;
  readonly rowDenyCurrent: boolean;
  readonly denyStandingNow: 'current' | 'history' | 'none' | 'unread';
  readonly claimantNow: string | null;
  readonly parkDenied: boolean;
}

/** THE ONE SIGNING SITE'S GUARD (§3.4, F11, F8-b; F2's carry from PR 0's review): null when the ruling may be signed,
 *  else the refusal word. Every signed ruling, the claimant's in-window ruling and a park's ruling at retry alike, asks
 *  this first.
 *  - A `coordinator` ruler that is no longer the run's claimant: `parent-changed` (a reclaim heir's child never meets the
 *    earlier claimant's ruling), for a deny too: the ruling is the claimant's act.
 *  - A deny is otherwise always signed.
 *  - An allow on a key whose park records the coordinator's deny: `coordinator-denied`.
 *  - An allow of a `forbidden` row, by its stored class or its fresh one: `guard-forbidden`.
 *  - A `coordinator` allow: `deny-not-current` when the row was minted with older deny rules, or when the standing read
 *    at signing is no longer `current` (an `unread` standing skips this second check only); then `guard-escalate` unless
 *    both classes are `ordinary`.
 *  - An `operator` allow: the classes `ordinary` or `escalate`, any deny currency (Table 3b's operator row). */
export function signingRefusal(f: SigningFacts): ApprovalRefusal | null {
  if (f.authority === 'coordinator' && f.claimantNow !== f.ruler) return 'parent-changed';
  if (f.verdict === 'deny') return null;
  if (f.parkDenied) return 'coordinator-denied';
  if (f.rowClass === 'forbidden' || f.freshClass === 'forbidden') return 'guard-forbidden';
  if (f.authority === 'coordinator') {
    if (!f.rowDenyCurrent) return 'deny-not-current';
    if (f.denyStandingNow !== 'unread' && f.denyStandingNow !== 'current') return 'deny-not-current';
    return f.rowClass === 'ordinary' && f.freshClass === 'ordinary' ? null : 'guard-escalate';
  }
  const known = (c: string): boolean => c === 'ordinary' || c === 'escalate';
  return known(f.rowClass) && known(f.freshClass) ? null : 'guard-escalate';
}

/** May the ruling read record `fetchedAt` now (F8-c, F2-a)? Only when it serves the ruling at least `graceMs` before the
 *  record's `expiresAt`: a ruling served later may expire on the fleet clock before the verifier reads it, so it counts as
 *  unfetched and the last-poll move may still carry it onto the park. */
export function fetchedAtRecordable(now: number, expiresAt: number, graceMs: number): boolean {
  return now <= expiresAt - graceMs;
}

/** A park's horizon from its first park (open question 5). */
export const parkHorizonFrom = (parkedAt: number): number => parkedAt + APPROVAL_PARK_HORIZON_MS;

/** The parked rows Waiting on you lists, oldest first: each `parked` row whose park is open at `now` (a void park's rows
 *  are staled by the sweep, F16, so they leave the list). A row whose park cannot be read is listed with no horizon. */
export function parkedApprovalViewOf(
  rows: readonly {
    readonly id: number; readonly childId: string; readonly parentId: string; readonly runId: number | null;
    readonly agentId: string; readonly tool: string; readonly inputRedacted: string | null; readonly class: string;
    readonly denyCurrent: boolean; readonly askAt: number; readonly state: string; readonly park: ParkFacts | null;
  }[],
  now: number,
): ParkedApprovalView[] {
  return rows
    .filter((r) => r.state === 'parked' && (r.park === null || parkOpen(r.park, now)))
    .map((r) => ({
      id: r.id, childId: r.childId, parentId: r.parentId, runId: r.runId, agentId: r.agentId, tool: r.tool,
      input: r.inputRedacted, class: r.class, denyCurrent: r.denyCurrent, askAt: r.askAt,
      horizon: r.park?.horizon ?? null, holder: 'coordinator' as const,
      ruled: r.park !== null && parkHasUnspentRuling(r.park) && r.park.ruling !== null
        ? { verdict: r.park.ruling.verdict, authority: r.park.ruling.authority } : null,
    }))
    .sort((a, b) => a.id - b.id);
}

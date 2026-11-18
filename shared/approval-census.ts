// THE APPROVAL CENSUS'S VOCABULARY (approvals plan 2026-11-18, §3.1, Tasks 1.2 to 1.5). L0: it imports nothing, because
// the PWA bundles it (the M38 card reads the census read's wire through it).
//
// Three vocabularies, each spelled once:
//  - the ROUTE word the session hook stamps into a permission prompt's envelope (`ask.approval.route`): where the hook
//    sent the prompt, or the first gate that stopped it. The hook is its one writer, `server/src/hookstate.ts` its one
//    reader (`parseApprovalRoute` below), and `session-hook-approval-route.test.ts` holds the hook's spellings equal to
//    `APPROVAL_ROUTE_SKIP_WORDS`;
//  - the census PATH, Table 2a of the plan: the one decision of where a prompt went, made for a minted approvals row
//    from its state, and for a census row from its route word or the menu it was seen on;
//  - the census READ's wire (`GET` of the census, session-gated), which counts and never answers an unredacted input.

/** The hook's skip words: the first pre-send gate that stopped a prompt (Table 2a, path 1; `not-a-child` is path 7). */
export const APPROVAL_ROUTE_SKIP_WORDS = [
  'kill-switch', 'not-a-child', 'deny-unknown', 'deny-unreadable', 'no-node', 'no-verifier', 'no-key', 'no-client',
  'no-uuid', 'forbidden', 'canonical-failed', 'nonce-failed',
] as const;
export type ApprovalRouteSkipWord = typeof APPROVAL_ROUTE_SKIP_WORDS[number];

/** A route word as the server reads it: `sent` (the request went; a minted row, or a refusal, follows), a skip word, a
 *  refusal the request route answered (`request-refused:<word>`, the word kept as the hook cut it), or no answer at
 *  all (`request-failed`). */
export type ApprovalRoute =
  | { readonly kind: 'sent' }
  | { readonly kind: 'skip'; readonly word: ApprovalRouteSkipWord }
  | { readonly kind: 'refused'; readonly word: string }
  | { readonly kind: 'failed' };

const REFUSED_PREFIX = 'request-refused:';
const REFUSAL_WORD = /^[a-z][a-z0-9-]{0,47}$/;

/** The one parse of a route word: `null` for anything else (an older hook's envelope has none; a word this build does
 *  not know is no route). */
export function parseApprovalRoute(raw: unknown): ApprovalRoute | null {
  if (typeof raw !== 'string') return null;
  if (raw === 'sent') return { kind: 'sent' };
  if (raw === 'request-failed') return { kind: 'failed' };
  if (raw.startsWith(REFUSED_PREFIX)) {
    const word = raw.slice(REFUSED_PREFIX.length);
    return REFUSAL_WORD.test(word) ? { kind: 'refused', word } : null;
  }
  return (APPROVAL_ROUTE_SKIP_WORDS as readonly string[]).includes(raw) ? { kind: 'skip', word: raw as ApprovalRouteSkipWord } : null;
}

/** A route back to its one spelling (the census row's `route` column). */
export function approvalRouteWord(r: ApprovalRoute): string {
  switch (r.kind) {
    case 'sent': return 'sent';
    case 'failed': return 'request-failed';
    case 'refused': return `${REFUSED_PREFIX}${r.word}`;
    case 'skip': return r.word;
    default: return r satisfies never;
  }
}

/**
 * WHERE A PROMPT WENT (Table 2a). One word per path, with the table's number beside it:
 *  `ruled`            0  held, and ruled by the claimant inside the window (allowed or denied)
 *  `hook-skipped`     1  never sent: a pre-send gate of the hook stopped it
 *  `refused-at-mint`  2  sent, and refused by the request route, or no answer came back
 *  `released-at-mint` 3  minted `released` with its reason (no claimant, forbidden, truncated, unparseable)
 *  `lapsed`           4  held for the claimant (an `ordinary` row), and reached the operator unruled
 *  `escalate`         5  held, class `escalate` (the claimant may deny or hand over, never allow), reached the operator
 *  `envelope-erased`  6  an approval-shaped menu with no approval envelope in the hook state
 *  `not-a-child`      7  a root session's prompt, or a child the request route did not recognise
 *  `held`             -  minted held and still inside its window: not yet decided
 */
export const APPROVAL_CENSUS_PATH_MAP = {
  ruled: 0, 'hook-skipped': 1, 'refused-at-mint': 2, 'released-at-mint': 3, lapsed: 4, escalate: 5,
  'envelope-erased': 6, 'not-a-child': 7, held: -1,
} as const satisfies Record<string, number>;
export type ApprovalCensusPath = keyof typeof APPROVAL_CENSUS_PATH_MAP;
export const APPROVAL_CENSUS_PATHS = Object.keys(APPROVAL_CENSUS_PATH_MAP) as ApprovalCensusPath[];

export function isApprovalCensusPath(v: unknown): v is ApprovalCensusPath {
  return typeof v === 'string' && Object.prototype.hasOwnProperty.call(APPROVAL_CENSUS_PATH_MAP, v);
}

/** The paths a census row (not a minted row) can carry: the ones that leave no approvals row (§3.1). */
export type ApprovalCensusRowPath = Extract<ApprovalCensusPath, 'hook-skipped' | 'refused-at-mint' | 'envelope-erased' | 'not-a-child'>;
export const APPROVAL_CENSUS_ROW_PATHS: readonly ApprovalCensusRowPath[] = ['hook-skipped', 'refused-at-mint', 'envelope-erased', 'not-a-child'];

/** Whose answer settled a prompt (N3): the claimant `coordinator` (every ruled row in PR 1), the `operator` (every prompt
 *  that reached them), or `none` while a row is still held. The Overlord's word joins in PR 5. */
export type ApprovalCensusAuthority = 'coordinator' | 'operator' | 'none';
export const APPROVAL_CENSUS_AUTHORITY_MAP: Readonly<Record<ApprovalCensusAuthority, true>> = { coordinator: true, operator: true, none: true };
export const APPROVAL_CENSUS_AUTHORITIES = Object.keys(APPROVAL_CENSUS_AUTHORITY_MAP) as ApprovalCensusAuthority[];

/** A minted row's deny currency as the read counts it (`byDenyCurrent`): PR 0's fact, `unmeasured` until it is read. */
export type ApprovalCensusDenyCurrency = 'current' | 'not-current' | 'unmeasured';
export const APPROVAL_CENSUS_DENY_CURRENCY_MAP: Readonly<Record<ApprovalCensusDenyCurrency, true>> = { current: true, 'not-current': true, unmeasured: true };

/** A word the census's coordination files quote: a path or a deny currency. These ride the read's counts and a census
 *  row's `path`, never a mail rejection or a run refusal (the mail-routes token census admits them through this guard). */
export function isApprovalCensusWord(tok: string): boolean {
  return isApprovalCensusPath(tok) || Object.prototype.hasOwnProperty.call(APPROVAL_CENSUS_DENY_CURRENCY_MAP, tok);
}

/** The six read commands PR 6's gate counts (§3.6): each argument a path, no write. */
export const READ_PROMPT_COMMANDS = ['cat', 'head', 'tail', 'wc', 'ls', 'stat'] as const;

/** The days a census read may span: the default and the cap. */
export const APPROVAL_CENSUS_DEFAULT_DAYS = 14;
export const APPROVAL_CENSUS_MAX_DAYS = 90;

/** One prompt as the read answers it: the redacted summary only, never an input. `summary` is the hook's envelope
 *  summary for a census row, and the masked `inputRedacted` cut to the same 200 characters for a minted row (null once
 *  pruned, `APPROVAL_INPUT_RETENTION_DAYS`). */
export interface ApprovalCensusRowWire {
  readonly source: 'approval' | 'census';
  readonly id: number;
  readonly at: number;
  readonly day: string;
  readonly sessionId: string;
  readonly programme: string | null;
  /** `null` for a menu seen with no envelope: whose thread painted it cannot be read. */
  readonly thread: 'main' | 'subagent' | null;
  readonly tool: string | null;
  readonly summary: string | null;
  readonly path: ApprovalCensusPath;
  readonly route: string | null;
  readonly state: string | null;
  readonly releaseReason: string | null;
  readonly class: string | null;
  /** The deny file the child was spawned with was the current one; `null` when the row does not say (a census row, or
   *  a store from before the fact was kept). */
  readonly denyCurrent: boolean | null;
  readonly authority: ApprovalCensusAuthority;
  readonly reachedOperator: boolean;
  /** PR 6's gate (§3.1, F7): this row is a read prompt the gate counts. */
  readonly readPrompt: boolean;
}

/** A count, keyed by its word (a path, a state, a reason, ...). */
export type ApprovalCensusCounts = Readonly<Record<string, number>>;

/** The census read's answer. `m38` is the counter: prompts that reached the operator, per programme-day, by path. */
export interface ApprovalCensusWire {
  readonly ok: true;
  readonly days: number;
  readonly fromMs: number;
  readonly toMs: number;
  readonly total: number;
  readonly reachedOperator: number;
  readonly byPath: ApprovalCensusCounts;
  readonly byState: ApprovalCensusCounts;
  readonly byReleaseReason: ApprovalCensusCounts;
  readonly byClass: ApprovalCensusCounts;
  readonly byThread: ApprovalCensusCounts;
  readonly byDenyCurrent: ApprovalCensusCounts;
  readonly byProgramme: ApprovalCensusCounts;
  readonly byAuthority: ApprovalCensusCounts;
  readonly byRoute: ApprovalCensusCounts;
  readonly readPrompts: number;
  readonly m38: {
    /** Distinct (programme, day) pairs with any prompt in the window; a root session's prompt counts under no programme. */
    readonly programmeDays: number;
    /** Prompts that reached the operator, divided by `programmeDays`; `null` when there were none. */
    readonly perProgrammeDay: number | null;
    /** Per UTC day, oldest first: the prompts that reached the operator, by path. */
    readonly byDay: readonly { readonly day: string; readonly reachedOperator: number; readonly byPath: ApprovalCensusCounts }[];
  };
  /** The pushes the outbox sent for approval prompts in the window, by their source kind (`approval` or `census`). */
  readonly pushesBySource: ApprovalCensusCounts;
  readonly rows: readonly ApprovalCensusRowWire[];
}

// The Overlord's designation (Overlord spec §3.1, §3.2 C2, §3.4 C45, C46, C56; plan
// `docs/superpowers/plans/2026-11-14-overlord-w1/w1-designation.md` Tasks 1, 2 and 5): L0, one concern (the index's
// large-file question 1, slug `wire-types-in-sibling-modules`). The view of the one row, the model class words, the
// attempt outcomes, the capability words Start the Overlord requires, the set-side placement answer and the designate
// door's body parser. The account set is `poolset.ts#PoolSet`, reused. It imports types only, and nothing from
// `node:*`, because the PWA bundles this file.
import type { PoolSet } from './poolset.js';

/** The model classes the operator may choose for the Overlord (C45). */
export const OVERLORD_MODEL_CLASSES = ['fable', 'opus'] as const;
export type OverlordModelClass = (typeof OVERLORD_MODEL_CLASSES)[number];

/** What a pending attempt is: a first body (`designate`) or a replacement for a lost one (`rebind`, PR B). */
export const PENDING_KINDS = ['designate', 'rebind'] as const;
export type PendingKind = (typeof PENDING_KINDS)[number];

/** How an attempt ended without going live; written on the row, read by the console and the board. */
export const ATTEMPT_OUTCOME_MAP = {
  'overlord-sandbox-unmet': 'a property of the sandbox check failed at the first start',
  'create-failed': 'ccd could not create the session or write its route record',
  'deadline-passed': 'the first start never reported before its deadline',
  'authority-unrecorded': 'the check held, but the authority journal refused the go-live record until the deadline',
  retired: 'the operator retired the Overlord while this attempt was pending',
} as const;
export type AttemptOutcome = keyof typeof ATTEMPT_OUTCOME_MAP;
export const ATTEMPT_OUTCOMES: readonly AttemptOutcome[] = Object.keys(ATTEMPT_OUTCOME_MAP) as AttemptOutcome[];

/** ccd's words designate and rebind require (Q33, ruled; `project-add`, review M10; the keep-awake token is ccd arms A's
 *  `keep-awake-v1`, X8), then the create's own two (slug `designate-asks-the-create-words`). */
export const DESIGNATE_CCD_WORDS =
  ['pool-set', 'keep-awake-v1', 'hibernate-fresh', 'launch-surface-v1', 'project-add', 'ws-title-v1', 'ws-wrapper-v1'] as const;
/** The server's own words designate and rebind require (Q33: `continuity-v1`, W1a's last piece). */
export const DESIGNATE_SERVER_WORDS = ['continuity-v1'] as const;

/** The project every Overlord body lives in, and the title its workspace is created with. */
export const OVERLORD_PROJECT = 'overlord';
export const OVERLORD_TITLE = 'Overlord';

/** The one row, narrowed. `bound: null` and `pending: null` each say one thing, "no such binding"; `pending.generation`
 *  null says only that the create has not answered yet. */
export interface DesignationView {
  readonly bound: { readonly sessionId: string; readonly generation: string } | null;
  readonly pending: {
    readonly sessionId: string; readonly kind: PendingKind; readonly deadlineAt: number; readonly since: number;
    readonly actor: string; readonly generation: string | null;
  } | null;
  readonly term: number; readonly designatedTerm: number;
  readonly model: OverlordModelClass; readonly accountPools: PoolSet;
  readonly pastIds: readonly string[]; readonly actor: string;
  readonly lastAttempt: { readonly sessionId: string; readonly outcome: AttemptOutcome; readonly at: number } | null;
  readonly stopsOwed: readonly string[];
}

/** X7: exactly three arms. `designated` is a live binding; `not-designated` is no row, or a row with no live binding
 *  (a pending-only row among them); `unmeasured` is a row or a database this reader cannot narrow. */
export type DesignationRead =
  | { readonly kind: 'designated'; readonly sessionId: string; readonly term: number; readonly row: DesignationView }
  | { readonly kind: 'not-designated'; readonly row: DesignationView | null }
  | { readonly kind: 'unmeasured'; readonly why: string };

/** `projectPlacement` with a set side (the index's Q5): the set's own answer, so no field of the project-side wire
 *  `ProjectPlacement` takes a new meaning (review M11). */
export type SetPlacement =
  | { readonly kind: 'projected'; readonly wrapper: string; readonly score: number }
  | { readonly kind: 'none'; readonly set: PoolSet }
  | { readonly kind: 'unmeasurable' };

/** Start the Overlord's body. */
export interface DesignateBody { readonly model: OverlordModelClass; readonly accountPools: PoolSet }

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

/** One reader of an account set from JSON: `{pools: string[], untagged: boolean}`, nothing else. The names are not
 *  checked against the pool-name pattern here: `poolSetSpelling` answers `unspellable` for a bad one, which the decider
 *  refuses as input. */
export function parseAccountPools(v: unknown): PoolSet | null {
  if (!isRecord(v)) return null;
  const keys = Object.keys(v);
  if (keys.length !== 2 || !keys.includes('pools') || !keys.includes('untagged')) return null;
  const pools = v['pools'];
  const untagged = v['untagged'];
  if (!Array.isArray(pools) || !pools.every((p) => typeof p === 'string') || typeof untagged !== 'boolean') return null;
  return { pools: pools as string[], untagged };
}

/** One reader of a model class word. */
export function parseOverlordModel(v: unknown): OverlordModelClass | null {
  return typeof v === 'string' && (OVERLORD_MODEL_CLASSES as readonly string[]).includes(v) ? (v as OverlordModelClass) : null;
}

/** The designate door's body: `{model, accountPools}` and no other key; anything else is `null` (400 `bad-request`). */
export function parseDesignateBody(v: unknown): DesignateBody | null {
  if (!isRecord(v)) return null;
  const keys = Object.keys(v);
  if (keys.length !== 2 || !keys.includes('model') || !keys.includes('accountPools')) return null;
  const model = parseOverlordModel(v['model']);
  const accountPools = parseAccountPools(v['accountPools']);
  return model === null || accountPools === null ? null : { model, accountPools };
}

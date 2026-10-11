// Answer builders for the temp-root collector's L1 suites (child-reclamation spec §5.10). Each is a literal of what
// the readers (`parseCollectAudit`, `parseCollectResult`) hand the lane: no ccd runs, and no HOME is touched. ONE
// helper for every collector suite: a later suite adds only names that are not already exported here.
import type { CollectToken } from '../../shared/api.js';
import type { CollectAudit, CollectResult, CollectStep } from '../src/collectLane.js';

/** The lane's pass interval and its observation interval, ARGUMENTS to every L1 function (the L1 file imports no L4
 *  constant): `CHILD_RECLAIM_SWEEP_MS`'s 60 s, from which `COLLECT_OBSERVE_INTERVAL_MS` derives. */
export const PASS = 60_000;
export const OBSERVE = 60_000;
export const MIN = 60_000;
export const DAY = 24 * 3_600_000;
/** The wall clock's epoch at monotonic 0: the two clocks differ, as they do in the lane. */
export const WALL0 = 1_790_000_000_000;

/** A collect token of 64 copies of one hex digit. Only a test casts a string to `CollectToken`: the lane's own
 *  tokens come from the audit reader alone. */
export const tok = (c: string): CollectToken => c.repeat(64) as CollectToken;
export const T1 = tok('a');
export const T2 = tok('b');

type Collectable = Extract<CollectAudit, { kind: 'collectable' }>;
/** Every document's evidence (R88): its witness's run and its leaf, ccd's path. The verdict and unmeasured documents
 *  carry them too (H3). */
const LEAF = '/home/u/.cc-tmp/demo-a';
export const collectable = (token: CollectToken, over: Partial<Omit<Collectable, 'kind' | 'token'>> = {}): CollectAudit =>
  ({ kind: 'collectable', token, resume: null, witnessRun: 7, witnessAt: WALL0, leaf: LEAF, detail: '', ...over });
export const verdict = (word: string, idleAt: number | null = null): CollectAudit =>
  ({ kind: 'verdict', verdict: word, idleAt, witnessRun: 7, leaf: LEAF, detail: `${word}: d` });
export const unmeasured = (probe: string): CollectAudit =>
  ({ kind: 'unmeasured', probe, witnessRun: 7, leaf: LEAF, detail: `${probe}: d` });
export const NO_DOCUMENT: CollectAudit = { kind: 'no-document', stderr: 'killed' };
export const UNREADABLE: CollectAudit = { kind: 'unreadable', detail: 'not a collect document' };

export const COLLECTED: CollectResult = { kind: 'collected', record: 'demo-a.1.2', resumed: false, witness: 'dropped' };
export const refusedAct = (word: string): CollectResult => ({ kind: 'refused', word, detail: `${word}: d`, paths: [] });
export const failedAct = (word = 'probe-unmeasured'): CollectResult => ({ kind: 'failed', token: word, detail: `${word}: d` });
export const DIE: CollectResult = { kind: 'die', word: 'lock-unopenable' };
export const ACT_NO_DOCUMENT: CollectResult = { kind: 'no-document', stderr: '' };

/** A step at monotonic `mono` (the wall clock `WALL0` ahead unless given), stamping clear generation `gen`. */
export const step = (mono: number, gen: number, wall = WALL0 + mono): CollectStep =>
  ({ now: { monoMs: mono, wallMs: wall }, gen, passIntervalMs: PASS });

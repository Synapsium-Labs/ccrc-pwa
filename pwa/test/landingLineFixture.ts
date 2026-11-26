// Landing order wave 5k: one project's landing line as the component and hook tests draw it. Section 5's first sketch:
// #101 next to land (fixes main), #104 in line, #107 waiting on the withdrawn #103 and declared after #104 too, #102 sent
// back (its head moved), #109 set aside. Entry ids are the PR plus 900, so a test that confuses an id with a PR goes red.
import type { LandingEntry, LandingLineView, LandingOrder, LandingWithdrawAnswer } from '../../shared/landingLine';
import { landingCardStateOf, type LandingCardState } from '../src/fleet/landingLineView';

export const P = 'project-a';
export const e = (pr: number, over: Partial<LandingEntry> = {}): LandingEntry => ({
  id: pr + 900, project: P, pr, pinnedSha: 'a'.repeat(40), handoffCommit: 'c'.repeat(40), runId: pr, state: 'pinned', baseSha: null,
  ejectionKind: null, ejections: 0, afterIds: [], fixesMain: false, setBy: 'lane-a', pinnedAt: 1000 + pr, ...over });
export const E101 = e(101, { fixesMain: true });
export const E104 = e(104, { afterIds: [1001] });
export const E107 = e(107, { afterIds: [1003, 1004] });
export const E102 = e(102, { state: 'ejected', ejectionKind: 'new-head', ejections: 1 });
export const E109 = e(109, { state: 'unknown' });

/** The five-entry line, with `over` and `order` laid over it. */
export const lineView = (over: Partial<LandingLineView> = {}, order: Partial<LandingOrder> = {}): LandingLineView => ({
  project: P, operatorPaused: false, mainRedHold: false, entriesScope: 'open',
  entries: [E101, E102, E104, E107, E109],
  order: { paused: false, order: [E101, E104, E107], head: E101, waits: [{ entryId: 1007, reason: 'withdrawn', on: [{ entryId: 1003, pr: 103 }] }], ...order } as LandingOrder,
  ...over });
/** A line of exactly `entries`, all pinned in that order, the first the head. */
export const onlyView = (entries: LandingEntry[], over: Partial<LandingLineView> = {}): LandingLineView => ({
  project: P, operatorPaused: false, mainRedHold: false, entries, order: { paused: false, order: entries, head: entries[0] ?? null }, ...over });
/** The line paused by the operator with no entries. */
export const pausedEmpty = (): LandingLineView =>
  ({ project: P, operatorPaused: true, mainRedHold: false, entries: [], order: { paused: true, by: ['operator'], order: [] } });

/** The state one good read of `view` leaves. */
export const stateOf = (view: LandingLineView, prev?: LandingCardState): LandingCardState =>
  landingCardStateOf(prev, { ok: true, raw: { ok: true, ...view } });
export const NONE: LandingCardState = { kind: 'none' };

/** The withdraw door's 200 for `entry`, with `notices`. */
export const withdrawn = (entry: LandingEntry, notices: LandingWithdrawAnswer['notices'] = []): { ok: true } & LandingWithdrawAnswer =>
  ({ ok: true, entry: { ...entry, state: 'withdrawn' }, previous: entry, changed: true, seq: 9, notices });

export interface Deferred<T> { promise: Promise<T>; resolve: (v: T) => void; reject: (e: unknown) => void }
export const deferred = <T,>(): Deferred<T> => {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
};

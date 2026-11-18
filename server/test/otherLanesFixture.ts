// Overlord W1 other lanes (plan `docs/superpowers/plans/2026-11-14-overlord-w1/w1-other-lanes.md` Tasks 3 and 4): the
// reads doubles a rig hands the lanes. `NOT_DESIGNATED_READS` answers `not-designated` with no row, so every lane passes
// as it does on a box nobody has designated; the builders below answer one designation state each.
import type { DesignationRead, DesignationView } from '../../shared/overlord-designation.js';
import type { CallerProfileRead, OtherLaneReads } from '../src/coord/otherLanes.js';

type Profile = Exclude<CallerProfileRead, 'not-read'>;

export const NOT_DESIGNATED_READS: OtherLaneReads = {
  designation: () => ({ kind: 'not-designated', row: null }),
  profile: async () => ({ kind: 'absent' }),
};

export const designationView = (over: Partial<DesignationView> = {}): DesignationView => ({
  bound: null, pending: null, term: 1, designatedTerm: 1, model: 'opus', accountPools: { pools: [], untagged: true },
  pastIds: [], actor: 'operator', lastAttempt: null, stopsOwed: [], ...over,
});

export const readsOf = (designation: DesignationRead, profile: (id: string) => Profile = () => ({ kind: 'absent' })): OtherLaneReads =>
  ({ designation: () => designation, profile: async (id) => profile(id) });

/** `id` is the live binding. */
export const boundReads = (id: string): OtherLaneReads => readsOf({ kind: 'designated', sessionId: id, term: 1,
  row: designationView({ bound: { sessionId: id, generation: 'g1' } }) });
/** `id` is a pending attempt's body, of either kind, with no live binding. */
export const pendingReads = (id: string, kind: 'designate' | 'rebind' = 'designate'): OtherLaneReads => readsOf({
  kind: 'not-designated',
  row: designationView({ pending: { sessionId: id, kind, deadlineAt: 2, since: 1, actor: 'operator', generation: null } }) });
/** `id` is on the row's `stopsOwed`, with no binding and no attempt. */
export const owedReads = (id: string): OtherLaneReads =>
  readsOf({ kind: 'not-designated', row: designationView({ stopsOwed: [id] }) });
/** The designation cannot be read; every caller's profile reads `profile`. */
export const unmeasuredReads = (profile: Profile): OtherLaneReads =>
  readsOf({ kind: 'unmeasured', why: 'bad pending kind' }, () => profile);

/** The detail the decider writes for a refused caller on a route (`otherLaneVerdict`). */
export const overlordDetail = (who: string, route: string): string =>
  `${who} is the Overlord's body, which acts only through its own doors (spec §3.5, H10); ${route} is not one of them`;

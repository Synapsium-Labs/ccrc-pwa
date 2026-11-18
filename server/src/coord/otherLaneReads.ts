// The other write lanes' two reads (Overlord W1, plan `docs/superpowers/plans/2026-11-14-overlord-w1/w1-other-lanes.md`
// Task 2). Ring L3, context C5: it composes the designation's one reader (`CoordStore.designationRead()`) and the
// registry's field reader (`registry.ts#fieldMeasured`, the caller's `profile` route field), keeps every distinction
// they give (absent apart from unreadable), and writes the one log line per unmeasured episode. It decides nothing:
// `otherLanes.ts#otherLaneVerdict` does.
import type { CcrcConfig } from '../config.js';
import type { FleetIO } from '../io.js';
import { fieldMeasured } from '../registry.js';
import type { CoordStore } from './store.js';
import { OTHER_LANE_KEYS, OVERLORD_PROFILE, type OtherLaneReads } from './otherLanes.js';

/** One episode for the whole process: every reads instance shares it, so an unmeasured episode logs one line in all.
 *  Counted by reads, not by time: the first unmeasured answer after a measured one (or since start) opens it, and a
 *  measured answer closes it. */
let unmeasuredEpisode = false;

/** The one builder of the reads (the plan's "one owner each"). */
export function otherLaneReadsOf(deps: {
  readonly coord: Pick<CoordStore, 'designationRead'>; readonly io: FleetIO;
  readonly cfg: Pick<CcrcConfig, 'registryDir'>;
}): OtherLaneReads {
  return {
    designation: () => {
      const read = deps.coord.designationRead();
      if (read.kind !== 'unmeasured') unmeasuredEpisode = false;
      else if (!unmeasuredEpisode) {
        unmeasuredEpisode = true;
        console.warn(`ccrc-server: the Overlord designation is unreadable (${read.why}); until it reads again, these lanes `
          + `decide by the caller's launch profile and refuse only one that reads ${OVERLORD_PROFILE} or cannot be read: `
          + OTHER_LANE_KEYS.join(', '));
      }
      return read;
    },
    profile: async (sessionId) => {
      const r = await fieldMeasured(deps.io, deps.cfg.registryDir, sessionId, 'profile');
      if (r.ok) return { kind: 'measured', word: r.content };
      return r.reason === 'absent' ? { kind: 'absent' } : { kind: 'unreadable', why: `profile ${r.reason}` };
    },
  };
}

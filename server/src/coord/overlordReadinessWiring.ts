// The Overlord's readiness lane, built once in the composition root (Overlord spec §6.4, C23, H20; plan
// `docs/superpowers/plans/2026-11-14-overlord-w1/w1-readiness.md` Task 3, "The facts, one producer each"). Ring L4, context C5:
// it fills each member of `ReadinessLanePort` (declared by the lane, its consumer) from the ONE existing reader of that fact
// and decides nothing. Every rule it needs is a producer's own: the operator's rung is `overlordLadder.ts#effectiveRung`'s, the
// candidates are `renewalReadings.ts#overlordCandidatesOf` over the ladder's own account facts (`accountLoad.ts#loadFactsOf`),
// the reset is `poolRunway.ts#earliestReset`, a generation's state is `continuityStore.ts#effectiveGeneration`'s, and the
// body, the word and the notices are the lane's and its deciders'. Nothing here is a second copy of a composition.
//
// WHY THE LADDER'S READ IS NOT COPIED WHOLE. The composed ladder read (`ladderRead`) is built inside `server.ts`, because its
// conditions need the watcher's state. The lane needs only the operator's rung, and a condition never moves it
// (`effectiveRung`'s `operatorRung` is the set rung or `LADDER_DEFAULT_RUNG`), so this asks the same decider over the stored row
// with no latches and no conditions. An unreadable row is `unmeasured`, with the store's own reason.
//
// THE PUSH rides `notify`, the one sender behind the push outbox. Its kind is `coord` with an empty session id, as
// `diskAlarmLane.ts`'s one-shot push uses it, so the payload's `url`, not a session deep link, decides where a tap goes.
//
// ABSENT PRODUCERS answer unmeasured, never a default: no private store (a test, a script) makes the inbox and the served reads
// `unmeasured`; no limits read yet makes every candidate's serviceability `unmeasured`. The holds are the store's
// (`accountHolds`, renewal readings PR H): an unread table answers `unmeasured`, never an empty list.
import type { Candidates } from '../accountLoad.js';
import { loadFactsOf } from '../accountLoad.js';
import type { Deps } from '../deps.js';
import { CONTINUITY_LANE } from '../../../shared/lane-arm.js';
import { LADDER_CAUSE_MAP } from '../../../shared/overlord-ladder.js';
import type { EarliestReset } from '../../../shared/loadLines.js';
import { effectiveGeneration } from '../continuity/continuityStore.js';
import { overlordCandidatesOf } from '../continuity/renewalReadings.js';
import { readHookStateMeasured } from '../hookstate.js';
import { notify, type NoticeDeps } from '../notice.js';
import type { OperatorModelStore } from '../operatorModel/store.js';
import { RUNWAY_READ_S, accountSamplesOf, earliestReset, type LimitSample } from '../poolRunway.js';
import { STRANDED_UNREADABLE } from '../registry.js';
import { designationFactFrom, identityOf } from '../roleOf.js';
import { turnMarkFor, turnReadDeps } from '../turnverdict.js';
import { MAIL_DISABLED_MARKER, readSwitches } from '../../../shared/switches.js';
import { laneArmRowViewOf } from './laneArm.js';
import { effectiveRung } from './overlordLadder.js';
import { ReadinessLane, type ReadinessLanePort } from './overlordReadinessLane.js';
import type { ReadinessPush } from './overlordReadiness.js';
import type { CoordStore } from './store.js';
import type { AccountLimits } from '../limits.js';

/** The store's members the wiring reads. */
export type ReadinessWiringCoord = Pick<CoordStore,
  'designationRead' | 'ladderRows' | 'liveGenerationOfIdentity' | 'restartsSince' | 'laneArmSetting' | 'accountPoolEdges'
  | 'limitSamplesSince' | 'lastContinuityRead' | 'accountHolds'>;

/** What the root hands the builder. `deps` is read at call time, so a sink set after this call (the response stamp) is seen. */
export interface ReadinessWiringInputs {
  /** The coordination database the readiness store writes (the root's one handle, as the invariant monitor's builder takes it). */
  readonly db: ReadinessLanePort['db'];
  readonly coord: ReadinessWiringCoord;
  readonly deps: Pick<Deps, 'io' | 'cfg' | 'tmux' | 'time'> & NoticeDeps;
  /** The Overlord's private store, for the inbox and the served reads; absent (a test, a script): both read unmeasured. */
  readonly operatorModel: Pick<OperatorModelStore, 'unsettledFacts' | 'lastServedReadAt'> | undefined;
  /** The watcher's newest limits read (`FleetWatcher.currentLimits`), or null before its first tick. */
  readonly limits: () => { readonly limits: Readonly<Record<string, AccountLimits>> } | null;
}

const NO_STORE = 'no private store';

/** The dead push through the notice funnel (`notice.ts#notify`), the push outbox's one sender: a `coord` notice with an empty
 *  session id (as `diskAlarmLane.ts` raises its one-shot push), the lane's tag, the payload's `url` and actions, and its
 *  per-episode key archived beside the row. `deps` is read at call time. */
export function readinessPushVia(deps: NoticeDeps): (p: ReadinessPush) => void {
  return (p) => {
    notify(deps, { kind: 'coord', sessionId: '', runId: null, title: p.title, body: p.body }, 'push',
      { tag: p.tag, url: p.url, actions: p.actions, dedupeKey: p.dedupeKey });
  };
}

export function readinessLaneOver(i: ReadinessWiringInputs): ReadinessLane {
  const { coord, deps } = i;
  const clock = deps.time.clock;
  const continuityLive = (): boolean => laneArmRowViewOf(CONTINUITY_LANE, coord.laneArmSetting(CONTINUITY_LANE)).live;
  const port: ReadinessLanePort = {
    db: i.db,
    clock,
    designation: () => coord.designationRead(),
    ladder: () => {
      const rows = coord.ladderRows();
      if (rows.kind === 'unmeasured') return { kind: 'unmeasured', why: rows.why };
      const e = effectiveRung({
        operatorRung: rows.rung === null ? { kind: 'default' } : { kind: 'set', rung: rows.rung.operatorRung },
        latches: [], conditions: [], causeTable: LADDER_CAUSE_MAP, serverCaps: [],
      });
      return { kind: 'read', operatorRung: e.operatorRung };
    },
    mailDisabled: (names) => readSwitches(names)[MAIL_DISABLED_MARKER],
    identityOf: (sessionId, d) => {
      const fact = designationFactFrom(d);
      if (fact === 'unmeasured') throw new Error('designation unreadable');   // the lane reads the generation and restarts unmeasured
      return identityOf(sessionId, fact);
    },
    liveGeneration: (identity) => coord.liveGenerationOfIdentity(identity),
    effective: (row) => effectiveGeneration(row, continuityLive()),
    restartsSince: (identity, sinceMs) => coord.restartsSince(identity, sinceMs),
    candidates: (d, held): Candidates => {
      const nowS = Math.floor(clock.wall() / 1000);
      // No limits read yet: an empty read, so each candidate's serviceability is unmeasured (`laneFactsOf`), never a default.
      return overlordCandidatesOf(d, loadFactsOf(deps.cfg.roster, i.limits()?.limits ?? {}, coord.accountPoolEdges(), nowS, held));
    },
    resets: (accounts) => {
      const nowS = Math.floor(clock.wall() / 1000);
      const rows = coord.limitSamplesSince(accounts, nowS - RUNWAY_READ_S);
      const byAccount = new Map<string, LimitSample[]>();
      for (const r of rows) byAccount.set(r.account, [...(byAccount.get(r.account) ?? []), r]);
      const value: Record<string, EarliestReset> = {};
      for (const id of accounts) value[id] = earliestReset([accountSamplesOf(byAccount.get(id) ?? [])], nowS);
      return { ok: true, value };
    },
    turnMark: (record) => turnMarkFor(turnReadDeps(deps, undefined), record),
    hookState: (record) => readHookStateMeasured(deps.io, deps.cfg.registryDir, record.id, record.uuid, clock.wall()),
    strandUnreadable: (record) => record.stranded?.reason === STRANDED_UNREADABLE,
    unsettled: () => i.operatorModel?.unsettledFacts() ?? { kind: 'unmeasured', why: NO_STORE },
    lastServedReadAt: (generation, sinceMs) => i.operatorModel?.lastServedReadAt(generation, sinceMs) ?? { kind: 'unmeasured', why: NO_STORE },
    lastContinuityRead: (sessionId) => coord.lastContinuityRead(sessionId),
    holds: () => { const h = coord.accountHolds(); return h.ok ? { kind: 'read', lanes: h.lanes } : { kind: 'unmeasured' }; },
    push: readinessPushVia(deps),
    log: (line) => console.warn(line),
  };
  return new ReadinessLane(port);
}

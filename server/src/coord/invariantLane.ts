// The invariant monitor's runner (Overlord spec §10.4 "One invariant monitor", Table 11.1c "one latch and one item per violation";
// plan `docs/superpowers/plans/2026-11-14-overlord-w1/w1-sequence-monitor.md` Task 6, questions 12, 13 and 18). Ring L4, context
// C5. It decides nothing: it reads the arming and the head, asks `invariantPassDue`, gathers in one span (`invariantFacts.ts`),
// asks `invariantVerdict` for every row and `findingMoves` for what to record and resolve, and acts on the answers. Its
// `LANE_SCHEDULE` row, `invariants`, runs it once a minute, one pass at a time; `FleetWatcher.sweepInvariants` calls `pass`.
//
// SHADOW RAISES NOTHING. Until the Shadow lanes card's `invariants` row is Live (an unreadable row reads shadow), each new finding
// is recorded with mode `shadow` and nothing else happens. Live, each new finding first raises the ladder's
// `invariant-violation` latch (in its own transaction: `tx` does not nest), then records the row and its blocking item together.
// A refused latch records no live finding; a crash or a failed record between the two leaves a standing latch and no finding,
// which the next pass records against the standing latch: never a live finding with no latch. A pass is remembered only when
// every step of it succeeded (review 3843 F8): after a failed open read, resolve, raise or record, the next pass, a minute
// later, gathers again and retries, rather than waiting for the head to move or the table cadence to pass.
import { INVARIANT_NAMES, findingMoves, invariantPassDue, invariantVerdict, latchedOf, verdictWordChanges,
  type Finding, type InvariantInput, type InvariantName, type InvariantVerdict, type LastPass } from './invariants.js';
import type { FindingLatched, FindingMode, OpenFindingRow } from './invariantFindingsStore.js';
import type { BoundOf, ItemReachOf } from './pushOutboxStore.js';
import { designationBaseline, type SequenceRead } from './overlordSequenceStore.js';
import type { Clock, Entropy } from '../time/ports.js';
import type { DatabaseSync } from 'node:sqlite';
import { INVARIANTS_LANE } from '../../../shared/lane-arm.js';
import { serverActorOf } from '../auth/attributionIdentity.js';
import { INVARIANT_TABLE_SWEEP_MS } from '../laneSchedule.js';
import { gatherInvariantInput, sequenceHead, type InvariantFactsDeps } from './invariantFacts.js';
import { openFindings, recordFinding, resolveFindings } from './invariantFindingsStore.js';
import { laneArmRowViewOf } from './laneArm.js';
import { raiseLatch } from './overlordLadderRead.js';
import type { AuthorityAppender } from './overlordLadderStore.js';
import type { CoordStore } from './store.js';

/** What the runner needs, declared here by its consumer; `index.ts` builds it once over `coord.db`, the authority journal and the
 *  ladder. */
export interface InvariantMonitorDeps {
  /** Whether the `invariants` row of the Shadow lanes card is Live (`laneArmRowViewOf`; an unreadable row is not). */
  readonly armed: () => boolean;
  /** The sequence's head, a cheap read before the gather. */
  readonly head: () => SequenceRead<number>;
  readonly gather: () => InvariantInput;
  readonly open: (mode: FindingMode) => SequenceRead<readonly OpenFindingRow[]>;
  readonly record: (f: Finding, mode: FindingMode, live: { readonly latched: FindingLatched; readonly reach?: BoundOf } | null, at: number) =>
    { ok: true; id: number; itemId: number | null } | { ok: false; error: string };
  readonly resolve: (ids: readonly number[], at: number) => { resolved: number } | { error: string };
  /** The ladder's raise of `invariant-violation` as the server's `invariants` lane (`overlordLadderRead.ts#raiseLatch`). */
  readonly raiseLatch: (detail: string) => { readonly ok: false } | { readonly ok: true; readonly changed: false } | { readonly ok: true; readonly changed: true; readonly journalled: boolean };
  readonly clock: Pick<Clock, 'wall' | 'mono'>;
  readonly tableSweepMs: number;
  readonly log: (line: string) => void;
}

/** The runner's last pass, kept in memory for the operator's read (PR C serves it). */
export interface InvariantPass {
  readonly at: number; readonly mode: FindingMode;
  readonly verdicts: ReadonlyMap<InvariantName, InvariantVerdict>;
}

export class InvariantMonitor {
  private lastPass: LastPass | null = null;
  private lastVerdicts: InvariantPass | null = null;
  constructor(private readonly deps: InvariantMonitorDeps) {}

  /** The last pass's verdicts, or null before the first. */
  last(): InvariantPass | null { return this.lastVerdicts; }

  /** One pass. `itemReach` is the watcher's bound-row writer for an item shown at its raise (the other `ccrc` raisers' seam).
   *  Never throws past a log line: a failed step logs and the next pass retries. */
  pass(itemReach?: ItemReachOf): void {
    const d = this.deps;
    const mode: FindingMode = d.armed() ? 'live' : 'shadow';
    const head = d.head();
    const now = { head: head.kind === 'measured' ? head.value : 'unmeasured' as const, mode, atMono: d.clock.mono() };
    if (!invariantPassDue(now, this.lastPass, d.tableSweepMs)) return;
    const input = d.gather();
    const verdicts = new Map<InvariantName, InvariantVerdict>(INVARIANT_NAMES.map((n) => [n, invariantVerdict(n, input)]));
    const at = d.clock.wall();
    for (const c of verdictWordChanges(this.lastVerdicts?.verdicts ?? null, verdicts)) {
      d.log(`ccrc-server: invariant ${c.name} reads ${c.to} (was ${c.from ?? 'nothing'}), ${mode}`);
    }
    this.lastVerdicts = { at, mode, verdicts };
    const open = d.open(mode);
    if (open.kind === 'unmeasured') { d.log(`ccrc-server: the invariant monitor read no open findings: ${open.why}`); return; }
    const moves = findingMoves(verdicts, open.value);
    const resolved = d.resolve(moves.resolve, at);
    let done = true;
    if ('error' in resolved) { done = false; d.log(`ccrc-server: the invariant monitor resolved nothing: ${resolved.error}`); }
    for (const f of moves.record) if (!this.recordOne(f, mode, at, itemReach)) done = false;
    if (done) this.lastPass = now;
  }

  /** Whether the finding was recorded. */
  private recordOne(f: Finding, mode: FindingMode, at: number, itemReach: ItemReachOf | undefined): boolean {
    const d = this.deps;
    let live: { latched: FindingLatched; reach?: BoundOf } | null = null;
    if (mode === 'live') {
      const latched = latchedOf(d.raiseLatch(`${f.invariant} ${f.subject}: ${f.message}`));
      if (latched === null) { d.log(`ccrc-server: the invariant monitor's latch was refused for ${f.invariant} ${f.subject}; the next pass retries`); return false; }
      live = itemReach === undefined ? { latched } : { latched, reach: itemReach({ title: `Invariant ${f.invariant} violated: ${f.subject}`, neededBy: 'blocking' }) };
    }
    const r = d.record(f, mode, live, at);
    if (!r.ok) d.log(`ccrc-server: the invariant monitor recorded nothing for ${f.invariant} ${f.subject}: ${r.error}; the next pass retries`);
    return r.ok;
  }
}

/** The monitor over one `coord.db`, built once in `index.ts` (L5): its reads and writes bound to the handle, its arming read from
 *  the Shadow lanes card's `invariants` row, and its latch raised through the ladder as the server's `invariants` lane. I5's
 *  kept designation line is bound here too, to the sequence store's one reader (`designationBaseline`, call 1240), like the head,
 *  the open findings, the record and the resolve: the composition root passes no read of it, so no stand-in can reach the gather
 *  (slug `i5-baseline-bound-in-the-factory`). */
export function invariantMonitorOver(o: {
  readonly db: DatabaseSync; readonly coord: Pick<CoordStore, 'raiseLatch' | 'laneArmSetting'>; readonly journal: AuthorityAppender;
  readonly readJournal: InvariantFactsDeps['readJournal']; readonly guardState: InvariantFactsDeps['guardState'];
  readonly clock: Pick<Clock, 'wall' | 'mono'>; readonly entropy: Pick<Entropy, 'hex'>; readonly log: (line: string) => void;
}): InvariantMonitor {
  const { db } = o;
  return new InvariantMonitor({
    armed: () => laneArmRowViewOf(INVARIANTS_LANE, o.coord.laneArmSetting(INVARIANTS_LANE)).live,
    head: () => sequenceHead(db),
    gather: () => gatherInvariantInput({ db, readJournal: o.readJournal, guardState: o.guardState, designationBaseline }),
    open: (mode) => openFindings(db, mode),
    record: (f, mode, live, at) => recordFinding(db, f, mode, live, at),
    resolve: (ids, at) => resolveFindings(db, ids, at),
    raiseLatch: (detail) => raiseLatch({ coord: o.coord, journal: o.journal, clock: o.clock, entropy: o.entropy }, 'invariant-violation', detail,
      serverActorOf('invariants')),
    clock: o.clock, tableSweepMs: INVARIANT_TABLE_SWEEP_MS, log: o.log,
  });
}

// L4 delivery, context C3 (Session Conversation): the generations lane (Overlord spec §3.3.11, H12, Table 11.1c "The renewal
// lane"; W1a, the generations piece), in shadow. Its rules are decided elsewhere: `startVerdict` (generationStart.ts) decides
// what a start does, `planStartBatch` which starts a pass judges and where the cursor moves, `firstMintOf` a coordinator's
// first generation, `roleOf` the role, `renewalDue` whether a generation is due and `observeTime` the observed clock. Three
// small policies of its own bookkeeping stay here, each said where it sits (review 2014 F7): which identities a first mint
// is tried for (an open coordinator with no generation), that the cursor rides the last judged start's mint, and the
// memo of held starts (THE MEMO'S POLICY, below). It reads the
// starts after its cursor, mints and ends generations, advances each live generation's accumulator and records the
// `renewalDue` answer, all through the store's compare-and-set writes, and it is the only writer of
// `continuity_generations` and `continuity_cursor`.
//
// SHADOW IS STRUCTURAL. The lane imports nothing that sends: no `ccdargv`, no mail store method, no push (an import pin in
// `continuity-generations-lane.test.ts` holds that, as the case lane's does). It takes no act on any session; `continuity`
// live changes only which column a new walk moves, and in this piece no walk moves past a mint. Nothing waits on it, and
// Live is refused at the card's door until the renewal act ships (review 2003 F3, `LANE_ARM_GATE`).
//
// THE DUE RECORD DOES NOT DEPEND ON THE WALK (review 2003 F1). A generation is judged, and gathered for, when its `state`
// column is `active` or `degraded`, whatever a shadow walk holds in `shadowState`: a shadow mint leaves `state` `active`,
// so every generation minted in shadow carries the `renewalDue` answer of its last pass and the triggers it could not
// read. The walk's own column still records the would-be states.
//
// TWO HALVES. `gatherGenerationReadings` (async) makes the fleet reads for the generations a pass will judge; then
// `generationsPass` (synchronous, one transaction per write, nothing awaited) reads `coord.db`, decides and writes. So a
// pass after a restart resumes from the cursor and the stored columns, never from memory, and the simulator drives the
// pass itself on its fake clock.
import { CONTINUITY_LANE, laneArmGate } from '../../../shared/lane-arm.js';
import { RENEWAL_LANE_PERIOD_MS } from '../../../shared/continuity.js';
import { familyClassOf } from '../../../shared/models.js';
import type { ChildMark, RunKind } from '../../../shared/api.js';
import type { CoordStore } from '../coord/store.js';
import type { TurnMarkRead } from '../coord/stall.js';
import { laneArmRowViewOf } from '../coord/laneArm.js';
import { newestClaimedWorkRuns } from '../coord/bindingReads.js';
import { roleFactsOf, roleOf, type RoleReading } from '../roleOf.js';
import { startedBeforeRelease } from '../coord/rollTarget.js';
import type { ReleaseRead } from '../rollLane.js';
import type { Clock } from '../time/ports.js';
import { observeTime, observedStepCapMs, type ObservedGap } from '../time/observed.js';
import type { MeasuredStat } from '../io.js';
import type { UsageRead } from '../usage.js';
import { compactionsSince, type CompactionsRead } from './compactions.js';
import { effectiveGeneration, genExpectOf, type GenRow, type MintInput } from './continuityStore.js';
import type { StartRow } from '../../../shared/continuity.js';
import {
  START_SKIPS, firstMintOf, judgedForDue, planStartBatch, startVerdict, waveBoundaryOf, type HoldClock, type StartFacts, type StartSkip,
  type StartVerdict,
} from './generationStart.js';
import { renewalDue, type Reading, type RenewalInputs } from './renewalDue.js';

/** The lane's key in `continuity_cursor`, and its `LANE_SCHEDULE` row's name. */
export const GENERATIONS_LANE = 'generations';
/** At most this many starts a pass (the plan's 200): a backlog drains over several passes. */
export const GENERATIONS_START_BATCH = 200;
/** A generation's term in W1a: the designation's term arrives with W1. */
export const GENERATIONS_TERM = 1;
/** How many of a coordinator's newest starts the first mint looks through for one that mints (review 2003 F2). */
export const FIRST_MINT_LOOKBACK = 20;

/** The store members the pass reaches, declared by this consumer, so a test can hand a small fake. */
export type GenerationsCoord = Pick<CoordStore, 'startsSince' | 'startsOf' | 'liveGenerations' | 'mintGeneration' | 'advanceObserved'
  | 'setGenerationDue' | 'clearShadowWalk' | 'generationsCursor' | 'advanceCursor' | 'laneArmSetting' | 'openCoordinatorIds'
  | 'run' | 'bindingRunsOf'>;

/** What the registry says of one row at the pass: its current conversation (null: unreadable), its account and its child
 *  mark. */
export interface RegistryFacts { readonly id: string; readonly uuid: string | null; readonly lane: string | null; readonly child: ChildMark }

/** The fleet reads of one generation, made by `gatherGenerationReadings`. */
export interface GenReadings {
  readonly usage: UsageRead;
  readonly compactions: CompactionsRead;
  readonly turn: TurnMarkRead;
  /** The roll's "behind" test: the session's process started before the node's current ccrc install completed. */
  readonly behind: Reading<boolean>;
}

export interface GenerationsDeps {
  readonly coord: GenerationsCoord;
  readonly clock: Clock;
  /** This server process's id: an observed stamp from another process is a `process` gap (`observeTime`). */
  readonly proc: string;
  readonly log: (line: string) => void;
  /** The observed-time decider; `observeTime` unless a simulator hands a mutant of it to the same pass. */
  readonly observe?: typeof observeTime;
  /** The continuity row's gate (`laneArmGate`), unless a test or the simulator opens it to drive the live walk the renewal
   *  act will arm (review 2006 N1). Nothing in the server passes one, so a gated row is never live here. */
  readonly gate?: (lane: typeof CONTINUITY_LANE) => string | null;
  /** The starts this process held for a failed read on an earlier pass (`HoldClock.retried`), kept by the caller across
   *  passes and rewritten by each pass that judges a batch: a memo, never a decision's durable state (review 2006 R3). */
  readonly retried: Set<number>;
}

export interface GenerationsInput {
  /** The registry at this pass, or null when it could not be listed: then no start is judged and the cursor stays. */
  readonly registry: readonly RegistryFacts[] | null;
  /** When that registry was listed (the server's wall clock): a start received at or after it is held a pass, since the
   *  listing may not know of it (review 2006 R1). */
  readonly listedAt: number;
  /** The fleet reads, by generation id; a generation without one reads every fleet input as unmeasured. */
  readonly readings: ReadonlyMap<number, GenReadings>;
}

export interface GenerationsResult {
  readonly live: boolean;
  readonly read: number;
  readonly minted: number;
  /** Of `minted`, the coordinators' first generations minted from their newest start (review 2003 F2). */
  readonly firstMinted: number;
  readonly skipped: Readonly<Record<StartSkip, number>>;
  /** Starts that wait for a later pass (review 2003 F2, review 2006 R1 and R8), and coordinators whose first mint waits
   *  on a held start (review 2006 R2). */
  readonly held: number;
  readonly superseded: number;
  /** The observed-time gaps the pass measured, one per identity that had one. */
  readonly gaps: readonly (ObservedGap & { readonly identity: string })[];
  readonly due: number;
  /** Generations whose due write named at least one trigger it could not read. */
  readonly blind: number;
  readonly cleared: number;
  /** A read that failed and stopped part of the pass, or null. */
  readonly unread: 'cursor' | 'starts' | 'generations' | 'registry' | null;
  /** A mint that could not be written stopped the batch. */
  readonly stopped: boolean;
}

const zeroSkips = (): Record<StartSkip, number> => Object.fromEntries(START_SKIPS.map((k) => [k, 0])) as Record<StartSkip, number>;

/** One pass. Synchronous: it awaits nothing, so its writes are never interleaved with another caller's. */
export function generationsPass(deps: GenerationsDeps, input: GenerationsInput): GenerationsResult {
  const { coord, clock } = deps;
  const now = clock.wall();
  const live = laneArmRowViewOf(CONTINUITY_LANE, coord.laneArmSetting(CONTINUITY_LANE), (deps.gate ?? laneArmGate)(CONTINUITY_LANE)).live;
  const skipped = zeroSkips();
  const gaps: (ObservedGap & { identity: string })[] = [];
  let read = 0; let minted = 0; let firstMinted = 0; let held = 0; let superseded = 0; let due = 0; let blind = 0; let cleared = 0;
  let stopped = false;
  // Every read that failed, each with what it stopped at the point it failed (review 2006 N3); `unread` is the first.
  const failures: Failure[] = [];
  const fail = (what: NonNullable<GenerationsResult['unread']>, detail: string, stops: string): void => {
    failures.push({ what, detail, stops });
  };
  const result = (): GenerationsResult => {
    logPass(deps.log, { skipped, held, superseded, stopped, failures, gaps });
    return { live, read, minted, firstMinted, skipped, held, superseded, gaps, due, blind, cleared, unread: failures[0]?.what ?? null, stopped };
  };

  // ---- ONE: every live generation's accumulator advances by the lane's step cap (review 1896 R4.1), before any mint, so a
  // mint carries the identity's accumulator to this pass; a walk begun in shadow is cleared once the row is live.
  const cap = observedStepCapMs(RENEWAL_LANE_PERIOD_MS);
  const before = coord.liveGenerations();
  if (!before.ok) fail('generations', before.detail, 'no observed time advances');
  else {
    for (const g0 of before.rows) {
      let g = g0;
      if (effectiveGeneration(g, live).shadowResidue) {
        if (!coord.clearShadowWalk(g.id, genExpectOf(g), now).changed) continue;
        cleared += 1;
        g = { ...g, shadowState: null, shadowDeadlineAt: null, walk: null };
      }
      const step = (deps.observe ?? observeTime)(g.observed, clock.mono(), deps.proc, cap);
      if (step.gap !== null) gaps.push({ identity: g.identity, ...step.gap });
      coord.advanceObserved(g.id, genExpectOf(g), step.at);
    }
  }

  // ---- TWO: the starts after the cursor mint and end generations; then a coordinator with no generation mints its first.
  const notJudged = 'no start is judged and the cursor stays';
  if (input.registry === null) fail('registry', 'the registry could not be listed', notJudged);
  else {
    const cursor = coord.generationsCursor(GENERATIONS_LANE);
    const starts = cursor.ok ? coord.startsSince(cursor.lastStartId, GENERATIONS_START_BATCH) : null;
    let gens = coord.liveGenerations();
    if (!cursor.ok) fail('cursor', cursor.detail, notJudged);
    else if (starts === null || !starts.ok) fail('starts', starts === null ? 'no read' : starts.detail, notJudged);
    else if (!gens.ok) fail('generations', gens.detail, notJudged);
    else {
      const registry = new Map(input.registry.map((r) => [r.id, r]));
      const hold: HoldClock = { now, listedAt: input.listedAt, retried: new Set(deps.retried) };
      const heldNow = new Set<number>();
      let openCoordinators: ReadonlySet<string> | 'unmeasured';
      try { openCoordinators = new Set(coord.openCoordinatorIds()); } catch { openCoordinators = 'unmeasured'; }
      // A child's run kind; a run row that cannot be read, or whose read throws (a malformed row), is unmeasured for this one
      // reading (review 2014 F1, as R4 for the wave read), so it never stalls the cursor or step THREE.
      const runKind = (child: ChildMark): RunKind | 'unmeasured' => {
        if (child.kind !== 'child') return 'unmeasured';
        try {
          const r = coord.run(child.runId);
          return r.ok && r.run !== null ? r.run.kind : 'unmeasured';
        } catch { return 'unmeasured'; }
      };
      const roleFor = (sessionId: string): RoleReading => {
        const child: ChildMark = registry.get(sessionId)?.child ?? { kind: 'unreadable' };
        return roleOf(roleFactsOf(sessionId, { child, childRunKind: runKind(child), openCoordinators, intentDeclared: 'unmeasured' }));
      };
      const registryOf = (sessionId: string): StartFacts['registry'] => {
        const reg = registry.get(sessionId);
        return reg === undefined ? { kind: 'absent' } : { kind: 'row', uuid: reg.uuid, lane: reg.lane };
      };
      const liveOf = (g: GenRow | null): StartFacts['live'] => g === null ? null
        : { state: g.state, reportedAt: g.startReportedAt, rowIncarnation: g.rowIncarnation, lane: g.lane };
      const mintInput = (s: StartRow, v: Extract<StartVerdict, { mint: true }>): MintInput => ({
        identity: s.sessionId, sessionId: s.sessionId, role: v.role, term: GENERATIONS_TERM, rowIncarnation: s.rowIncarnation,
        startId: s.id, startReportedAt: s.reportedAt, resumed: v.resumed, model: s.model, lane: v.lane, host: null,
        outcome: v.outcome, mono: clock.mono(), proc: deps.proc, now,
      });

      if (starts.rows.length > 0) {
        read = starts.rows.length;
        const plan = planStartBatch(starts.rows, cursor.lastStartId, registryOf, hold);
        held = plan.waiting.length;
        for (const id of plan.heldForRead) heldNow.add(id);
        const advance = plan.advanceTo === null ? null : { lane: GENERATIONS_LANE, from: cursor.lastStartId, to: plan.advanceTo };
        let cursorDone = false;
        for (const [i, { start: s, newest }] of plan.judged.entries()) {
          const last = i === plan.judged.length - 1;
          const liveGen = gens.rows.find((g) => g.identity === s.sessionId) ?? null;
          const verdict = startVerdict({
            source: s.source, uuid: s.uuid, reportedAt: s.reportedAt, rowIncarnation: s.rowIncarnation,
            registry: registryOf(s.sessionId), role: roleFor(s.sessionId), newest, live: liveOf(liveGen),
          });
          if (!verdict.mint) { skipped[verdict.skip] += 1; continue; }
          // The cursor rides the last judged start's mint, so a crash between two mints re-judges the batch.
          const w = coord.mintGeneration(mintInput(s, verdict), liveGen === null ? null : genExpectOf(liveGen), live,
            last ? advance : null);
          if (w.ok) { minted += 1; cursorDone = last && advance !== null; } else if (w.kind === 'superseded') superseded += 1;
          else { stopped = true; break; }
          const again = coord.liveGenerations();
          if (!again.ok) { fail('generations', again.detail, 'the batch stopped after a mint and the cursor stays'); stopped = true; break; }
          gens = again;
        }
        // The cursor moves past what was judged only when every start in it was judged; a mint that could not be written
        // leaves it, so the next pass judges the batch again (a start already minted answers superseded).
        if (!stopped && !cursorDone && advance !== null) coord.advanceCursor(advance);
      }

      // A coordinator's own `startup` lands before it opens its first run, when its role still reads undecided (slug
      // intent-unread), so it would never mint (review 2003 F2): an identity that reads as a coordinator and has no
      // generation mints n=1 (`firstMintOf`) from the starts the cursor has passed. No cursor rides it.
      const passed = coord.generationsCursor(GENERATIONS_LANE);
      if (!passed.ok) fail('cursor', passed.detail, 'the batch ran, and no coordinator\'s first generation is minted');
      else if (!stopped && gens.ok && openCoordinators !== 'unmeasured') {
        for (const id of openCoordinators) {
          if (gens.rows.some((g) => g.identity === id)) continue;
          const role = roleFor(id);
          if (role.kind !== 'role' || role.role !== 'coordinator') continue;
          const mine = coord.startsOf(id, FIRST_MINT_LOOKBACK);
          if (!mine.ok) { fail('starts', mine.detail, `the batch ran, and ${id}'s first generation is not minted`); continue; }
          const first = firstMintOf(mine.rows, passed.lastStartId, registryOf(id), role, hold);
          for (const sid of first.readHolds) heldNow.add(sid);
          if (first.kind === 'held') { held += 1; continue; }
          if (first.kind === 'none') continue;
          const w = coord.mintGeneration(mintInput(first.start, first.verdict), null, live, null);
          if (w.ok) { minted += 1; firstMinted += 1; } else if (w.kind === 'superseded') superseded += 1;
          else { stopped = true; break; }
        }
      }
      // THE MEMO'S POLICY (review 2006 R3; review 2014 F2 and F7), in L4 because it is the lane's own bookkeeping across
      // passes: after a pass whose batch and first mints ran, the memo is exactly the starts that pass held for a failed
      // read, in the batch (`heldForRead`) or in a first-mint walk, plus every start a first-mint walk passed because the
      // memo already held it (`readHolds`), since those stay below the cursor and are walked again. A start the batch
      // released is past the cursor and is forgotten; a pass whose reads failed before the batch leaves the memo as it was.
      deps.retried.clear();
      for (const id of heldNow) deps.retried.add(id);
    }
  }

  // ---- THREE: the `renewalDue` answer is recorded for every generation whose `state` is at rest (`active` or `degraded`),
  // whatever a shadow walk holds (review 2003 F1).
  const gens = coord.liveGenerations();
  if (!gens.ok) { fail('generations', gens.detail, 'no due is recorded'); return result(); }
  for (const g of gens.rows) {
    if (!judgedForDue(g)) continue;
    const wave: Reading<boolean> = g.role !== 'coordinator' ? { kind: 'unmeasured', why: 'not a coordinator' } : (() => {
      const runs = newestClaimedWorkRuns(coord, g.identity);
      return runs.ok ? { kind: 'measured', value: waveBoundaryOf(runs.runs) } : { kind: 'unmeasured', why: runs.detail };
    })();
    const d = renewalDue(renewalInputsOf(g, input.readings.get(g.id), wave, now));
    if (d.due) due += 1;
    if (d.blind.length > 0) blind += 1;
    coord.setGenerationDue(g.id, genExpectOf(g), d.due
      ? { due: true, why: d.why, cls: d.cls, at: now, observedMs: g.observed.ms } : { due: false }, d.blind);
  }
  return result();
}

/** A read that failed, and what it stopped where it failed. */
interface Failure { readonly what: NonNullable<GenerationsResult['unread']>; readonly detail: string; readonly stops: string }

/** The pass's one log line set (review 2003 F5): every non-zero skip count, the held and superseded starts and a stop,
 *  in one line; each read that failed in a line of its own, naming what it stopped (review 2006 N3); the observed-time
 *  gaps in another. */
function logPass(log: (line: string) => void, p: {
  skipped: Readonly<Record<StartSkip, number>>; held: number; superseded: number; stopped: boolean;
  failures: readonly Failure[]; gaps: readonly ObservedGap[];
}): void {
  const parts = START_SKIPS.filter((k) => p.skipped[k] > 0).map((k) => `${p.skipped[k]} ${k}`);
  if (p.held > 0) parts.push(`${p.held} held for a later pass`);
  if (p.superseded > 0) parts.push(`${p.superseded} superseded`);
  if (p.stopped) parts.push('a mint could not be written, so the batch stopped and the cursor stays');
  if (parts.length > 0) log(`ccrc-server: generations: starts this pass: ${parts.join(', ')}`);
  for (const f of p.failures) log(`ccrc-server: generations: the ${f.what} could not be read, so ${f.stops} this pass: ${f.detail}`);
  if (p.gaps.length > 0) {
    const of = (k: ObservedGap['kind']): number => p.gaps.filter((x) => x.kind === k).length;
    log(`ccrc-server: generations: observed time gaps this pass: ${of('process')} process, ${of('backwards')} backwards, ${of('step')} step`);
  }
}

/** A fleet input this piece cannot read yet, with the reason it is unmeasured: `W1` for the Overlord's own readers, else
 *  the W1a piece that brings the reader. Such a row never fires and is named in `blind`. */
const later = (why: string): Reading<never> => ({ kind: 'unmeasured', why });
const W1 = later('W1');

/** The gather's readings, as `renewalDue`'s inputs. Every reading that is not a fresh measurement reaches the decider as
 *  unmeasured with its reason: a stale sidecar is unmeasured, never a reading below the cap. */
export function renewalInputsOf(g: GenRow, r: GenReadings | undefined, wave: Reading<boolean>, nowMs: number): RenewalInputs {
  const unread = later('unread this pass');
  const usage = (pick: 'ctxTokens' | 'ctxWindow'): Reading<number> => {
    if (r === undefined) return unread;
    if (r.usage.kind !== 'reading') return later(`usage ${r.usage.kind}`);
    if (r.usage.usage.stale) return later('usage stale');
    const v = r.usage.usage[pick];
    return v === null || v === undefined ? later(`usage has no ${pick}`) : { kind: 'measured', value: v };
  };
  const compactions = ((): Reading<number> => {
    if (r === undefined) return unread;
    if (r.compactions.kind === 'unreadable') return later('compactions unreadable');
    if (r.compactions.kind === 'absent') return { kind: 'measured', value: 0 };
    // COMPACTION_PAIR_MS, which pairs a pre line with its post, has no W0 figure behind it (review 1927 M7).
    return { kind: 'measured', value: compactionsSince(r.compactions.lines, g.startReportedAt) };
  })();
  const idleMs = ((): Reading<number> => {
    if (r === undefined) return unread;
    if (!r.turn.ok) return later(`turn marker ${r.turn.reason}`);
    if (r.turn.state === 'working') return { kind: 'measured', value: 0 };
    return r.turn.stopAt === null ? later('turn marker has no stop') : { kind: 'measured', value: Math.max(0, nowMs - r.turn.stopAt) };
  })();
  const startResumed = ((): RenewalInputs['startResumed'] => {
    if (!g.resumed) return { kind: 'measured', value: { resumed: false, otherClass: false } };
    if (g.model === null || g.prevModel === null) return later('model unknown');
    return { kind: 'measured', value: { resumed: true, otherClass: familyClassOf(g.model) !== familyClassOf(g.prevModel) } };
  })();
  return {
    role: g.role, contextTokens: usage('ctxTokens'), windowTokens: usage('ctxWindow'), fittedCeilingTokens: W1, turns: W1,
    compactions, idleMs, backstopDue: W1, installBehind: r === undefined ? unread : r.behind,
    probeFailedUnfixed: later('probes'), modelDrift: W1, startResumed, entryRetired: W1, termRaised: W1, accountOutsideSet: W1,
    classUnservable: W1, accountLoadMove: W1, compactionRefused: later('compaction'), classChanged: W1, evaluationDue: W1,
    notLocal: W1, waveBoundary: wave, renewNow: false,
  };
}

/** The soft renewal's observed times for a generation (`softRenewalMay`'s inputs; review 1902 F4): its age since its mint,
 *  the hold-off on that same frame (stored absolute on the accumulator, so `mintedObservedMs` is subtracted here), and how
 *  long its trigger has been due. */
export function softTimesOf(g: GenRow): { generationAgeObservedMs: number; holdOffUntilObservedMs: number | null; dueSinceObservedMs: number } {
  return {
    generationAgeObservedMs: g.observed.ms - g.mintedObservedMs,
    holdOffUntilObservedMs: g.holdOffUntilObservedMs === null ? null : g.holdOffUntilObservedMs - g.mintedObservedMs,
    dueSinceObservedMs: g.dueSinceObservedMs === null ? 0 : g.observed.ms - g.dueSinceObservedMs,
  };
}

/** The fleet reads the gather makes, declared by this consumer. */
export interface GatherPorts {
  usage(id: string): Promise<UsageRead>;
  /** `$REG/<id>.compactevents`'s size and time, the key the compactions are re-read on (review 1927 N2). */
  eventsStamp(id: string): Promise<MeasuredStat>;
  compactions(id: string): Promise<CompactionsRead>;
  turnMark(id: string): Promise<TurnMarkRead>;
  processStartedAt(id: string): Promise<number | null>;
  release(): Promise<ReleaseRead>;
}

/** The compactions last read per session and the stamp they were read at: a read cache, never a decision's memory. */
export type CompactionsMemo = Map<string, { stamp: string; read: CompactionsRead }>;

/** The fleet reads for every live generation the pass will judge (`judgedForDue`). The
 *  compactions are re-read only when the PreCompact events file changed (every compaction writes it, the pre line or the
 *  rotation; review 1927 N2), and every time when it is absent (an older hook) or its stamp could not be read. */
export async function gatherGenerationReadings(coord: Pick<GenerationsCoord, 'liveGenerations'>,
  ports: GatherPorts, memo: CompactionsMemo): Promise<Map<number, GenReadings>> {
  const out = new Map<number, GenReadings>();
  const gens = coord.liveGenerations();
  if (!gens.ok) return out;
  const targets = gens.rows.filter(judgedForDue);
  if (targets.length === 0) return out;
  const release = await ports.release();
  for (const g of targets) {
    const id = g.sessionId;
    const usage = await ports.usage(id);
    const stamp = await ports.eventsStamp(id);
    const key = stamp.ok ? `${stamp.mtimeMs}:${stamp.size}` : null;
    const held = memo.get(id);
    let compactions: CompactionsRead;
    if (key !== null && held !== undefined && held.stamp === key) compactions = held.read;
    else {
      compactions = await ports.compactions(id);
      // Only a read that worked is kept (review 2003 F14): a failed one is read again next pass, not until the file moves.
      if (key !== null && compactions.kind !== 'unreadable') memo.set(id, { stamp: key, read: compactions }); else memo.delete(id);
    }
    const turn = await ports.turnMark(id);
    const started = await ports.processStartedAt(id);
    const behind: Reading<boolean> = release.kind === 'none' ? { kind: 'measured', value: false }
      : release.kind === 'unreadable' ? later('install record unreadable')
      : started === null ? later('process start unmeasured') : { kind: 'measured', value: startedBeforeRelease(started, release.at) };
    out.set(g.id, { usage, compactions, turn, behind });
  }
  for (const id of [...memo.keys()]) if (!targets.some((g) => g.sessionId === id)) memo.delete(id);
  return out;
}

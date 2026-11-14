// L4 delivery, context C3 (Session Conversation): the generations lane (Overlord spec §3.3.11, H12, Table 11.1c "The renewal
// lane"; W1a, the generations piece), in shadow. It decides nothing: `startVerdict` (generationStart.ts) decides what a start
// does, `roleOf` the role, `renewalDue` whether a generation is due and `observeTime` the observed clock. It reads the
// starts after its cursor, mints and ends generations, advances each live generation's accumulator and records the
// `renewalDue` answer, all through the store's compare-and-set writes, and it is the only writer of
// `continuity_generations` and `continuity_cursor`.
//
// SHADOW IS STRUCTURAL. The lane imports nothing that sends: no `ccdargv`, no mail store method, no push (an import pin in
// `continuity-generations-lane.test.ts` holds that, as the case lane's does). It takes no act on any session; `continuity`
// live changes only which column a new walk moves, and in this piece no walk moves past a mint. Nothing waits on it.
//
// TWO HALVES. `gatherGenerationReadings` (async) makes the fleet reads for the generations a pass will judge; then
// `generationsPass` (synchronous, one transaction per write, nothing awaited) reads `coord.db`, decides and writes. So a
// pass after a restart resumes from the cursor and the stored columns, never from memory, and the simulator drives the
// pass itself on its fake clock.
import { CONTINUITY_LANE } from '../../../shared/lane-arm.js';
import { RENEWAL_LANE_PERIOD_MS } from '../../../shared/continuity.js';
import { familyClassOf } from '../../../shared/models.js';
import type { ChildMark, RunKind } from '../../../shared/api.js';
import type { CoordStore } from '../coord/store.js';
import type { TurnMarkRead } from '../coord/stall.js';
import { laneArmRowViewOf } from '../coord/laneArm.js';
import { roleFactsOf, roleOf } from '../roleOf.js';
import type { ReleaseRead } from '../rollLane.js';
import type { Clock } from '../time/ports.js';
import { observeTime, observedStepCapMs, type ObservedGap } from '../time/observed.js';
import type { MeasuredStat } from '../io.js';
import type { UsageRead } from '../usage.js';
import { compactionsSince, type CompactionsRead } from './compactions.js';
import { effectiveGeneration, genExpectOf, type GenRow, type MintInput } from './continuityStore.js';
import { START_SKIPS, startVerdict, waveBoundaryOf, type StartSkip } from './generationStart.js';
import { renewalDue, type Reading, type RenewalInputs } from './renewalDue.js';

/** The lane's key in `continuity_cursor`, and its `LANE_SCHEDULE` row's name. */
export const GENERATIONS_LANE = 'generations';
/** At most this many starts a pass (the plan's 200): a backlog drains over several passes. */
export const GENERATIONS_START_BATCH = 200;
/** A generation's term in W1a: the designation's term arrives with W1. */
export const GENERATIONS_TERM = 1;

/** The store members the pass reaches, declared by this consumer, so a test can hand a small fake. */
export type GenerationsCoord = Pick<CoordStore, 'startsSince' | 'liveGenerations' | 'mintGeneration' | 'advanceObserved'
  | 'setGenerationDue' | 'clearShadowWalk' | 'generationsCursor' | 'advanceCursor' | 'laneArmSetting' | 'openCoordinatorIds'
  | 'run' | 'newestClaimedWorkRuns'>;

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
}

export interface GenerationsInput {
  /** The registry at this pass, or null when it could not be listed: then no start is judged and the cursor stays. */
  readonly registry: readonly RegistryFacts[] | null;
  /** The fleet reads, by generation id; a generation without one reads every fleet input as unmeasured. */
  readonly readings: ReadonlyMap<number, GenReadings>;
}

export interface GenerationsResult {
  readonly live: boolean;
  readonly read: number;
  readonly minted: number;
  readonly skipped: Readonly<Record<StartSkip, number>>;
  readonly superseded: number;
  /** The observed-time gaps the pass measured, one per identity that had one. */
  readonly gaps: readonly (ObservedGap & { readonly identity: string })[];
  readonly due: number;
  /** Generations whose due write named at least one trigger it could not read. */
  readonly blind: number;
  readonly cleared: number;
  /** A read that failed and stopped part of the pass, or null. */
  readonly unread: 'cursor' | 'starts' | 'generations' | 'registry' | null;
}

const zeroSkips = (): Record<StartSkip, number> => Object.fromEntries(START_SKIPS.map((k) => [k, 0])) as Record<StartSkip, number>;

/** One pass. Synchronous: it awaits nothing, so its writes are never interleaved with another caller's. */
export function generationsPass(deps: GenerationsDeps, input: GenerationsInput): GenerationsResult {
  const { coord, clock } = deps;
  const now = clock.wall();
  const live = laneArmRowViewOf(CONTINUITY_LANE, coord.laneArmSetting(CONTINUITY_LANE)).live;
  const skipped = zeroSkips();
  const gaps: (ObservedGap & { identity: string })[] = [];
  let read = 0; let minted = 0; let superseded = 0; let due = 0; let blind = 0; let cleared = 0;
  let unread: GenerationsResult['unread'] = null;
  const result = (): GenerationsResult => ({ live, read, minted, skipped, superseded, gaps, due, blind, cleared, unread });

  // ---- ONE: every live generation's accumulator advances by the lane's step cap (review 1896 R4.1), before any mint, so a
  // mint carries the identity's accumulator to this pass; a walk begun in shadow is cleared once the row is live.
  const cap = observedStepCapMs(RENEWAL_LANE_PERIOD_MS);
  const before = coord.liveGenerations();
  if (before.ok) {
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

  // ---- TWO: the starts after the cursor mint and end generations.
  if (input.registry === null) unread = 'registry';
  else {
    const cursor = coord.generationsCursor(GENERATIONS_LANE);
    const starts = cursor.ok ? coord.startsSince(cursor.lastStartId, GENERATIONS_START_BATCH) : null;
    let gens = coord.liveGenerations();
    if (!cursor.ok) unread = 'cursor';
    else if (starts === null || !starts.ok) unread = 'starts';
    else if (!gens.ok) unread = 'generations';
    else if (starts.rows.length > 0) {
      read = starts.rows.length;
      const from = cursor.lastStartId;
      const to = Math.max(...starts.rows.map((s) => s.id));
      const registry = new Map(input.registry.map((r) => [r.id, r]));
      let openCoordinators: ReadonlySet<string> | 'unmeasured';
      try { openCoordinators = new Set(coord.openCoordinatorIds()); } catch { openCoordinators = 'unmeasured'; }
      // A session's starts in their own order (`reportedAt`), never in receipt order (review 1949 G3).
      const ordered = [...starts.rows].sort((a, b) => a.reportedAt - b.reportedAt || a.id - b.id);
      let cursorDone = false;
      let stopped = false;
      for (const [i, s] of ordered.entries()) {
        const last = i === ordered.length - 1;
        const reg = registry.get(s.sessionId);
        const held = gens.ok ? gens.rows.find((g) => g.identity === s.sessionId) ?? null : null;
        const runKind = (child: ChildMark): RunKind | 'unmeasured' => {
          if (child.kind !== 'child') return 'unmeasured';
          const r = coord.run(child.runId);
          return r.ok && r.run !== null ? r.run.kind : 'unmeasured';
        };
        const child: ChildMark = reg?.child ?? { kind: 'unreadable' };
        const role = roleOf(roleFactsOf(s.sessionId, { child, childRunKind: runKind(child), openCoordinators, intentDeclared: 'unmeasured' }));
        const verdict = startVerdict({
          source: s.source, uuid: s.uuid, reportedAt: s.reportedAt, rowIncarnation: s.rowIncarnation,
          registry: reg === undefined ? { kind: 'absent' } : { kind: 'row', uuid: reg.uuid, lane: reg.lane },
          role,
          live: held === null ? null : {
            state: effectiveGeneration(held, live).state, reportedAt: held.startReportedAt,
            rowIncarnation: held.rowIncarnation, lane: held.lane,
          },
        });
        if (!verdict.mint) { skipped[verdict.skip] += 1; continue; }
        const mint: MintInput = {
          identity: s.sessionId, sessionId: s.sessionId, role: verdict.role, term: GENERATIONS_TERM, rowIncarnation: s.rowIncarnation,
          startId: s.id, startReportedAt: s.reportedAt, resumed: verdict.resumed, model: s.model, lane: reg?.lane ?? null, host: null,
          outcome: verdict.outcome, mono: clock.mono(), proc: deps.proc, now,
        };
        const w = coord.mintGeneration(mint, held === null ? null : genExpectOf(held), live,
          last ? { lane: GENERATIONS_LANE, from, to } : null);
        if (w.ok) { minted += 1; cursorDone = last; } else if (w.kind === 'superseded') superseded += 1;
        else { stopped = true; break; }
        gens = coord.liveGenerations();
        if (!gens.ok) { unread = 'generations'; stopped = true; break; }
      }
      // The cursor moves past the batch only when every start in it was judged; a mint that could not be written leaves
      // it, so the next pass judges the batch again (a start already minted answers superseded).
      if (!stopped && !cursorDone) coord.advanceCursor({ lane: GENERATIONS_LANE, from, to });
      if (skipped.undecided > 0) deps.log(`ccrc-server: generations: ${skipped.undecided} start(s) of an undecided role minted nothing`);
    }
  }

  // ---- THREE: the `renewalDue` answer is recorded for every generation at rest (`active` or `degraded`).
  const gens = coord.liveGenerations();
  if (!gens.ok) { unread ??= 'generations'; return result(); }
  for (const g of gens.rows) {
    const state = effectiveGeneration(g, live).state;
    if (state !== 'active' && state !== 'degraded') continue;
    const wave: Reading<boolean> = g.role !== 'coordinator' ? { kind: 'unmeasured', why: 'not a coordinator' } : (() => {
      const runs = coord.newestClaimedWorkRuns(g.identity);
      return runs.ok ? { kind: 'measured', value: waveBoundaryOf(runs.runs) } : { kind: 'unmeasured', why: runs.detail };
    })();
    const d = renewalDue(renewalInputsOf(g, input.readings.get(g.id), wave, now));
    if (d.due) due += 1;
    if (d.blind.length > 0) blind += 1;
    coord.setGenerationDue(g.id, genExpectOf(g), d.due
      ? { due: true, why: d.why, cls: d.cls, at: now, observedMs: g.observed.ms } : { due: false }, d.blind);
  }
  if (gaps.length > 0) {
    const of = (k: ObservedGap['kind']): number => gaps.filter((x) => x.kind === k).length;
    deps.log(`ccrc-server: generations: observed time gaps this pass: ${of('process')} process, ${of('backwards')} backwards, ${of('step')} step`);
  }
  return result();
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

/** The fleet reads for every live generation the pass will judge (effective state `active` or `degraded`). The
 *  compactions are re-read only when the PreCompact events file changed (every compaction writes it, the pre line or the
 *  rotation; review 1927 N2), and every time when it is absent (an older hook) or its stamp could not be read. */
export async function gatherGenerationReadings(coord: Pick<GenerationsCoord, 'liveGenerations' | 'laneArmSetting'>,
  ports: GatherPorts, memo: CompactionsMemo): Promise<Map<number, GenReadings>> {
  const out = new Map<number, GenReadings>();
  const gens = coord.liveGenerations();
  if (!gens.ok) return out;
  const live = laneArmRowViewOf(CONTINUITY_LANE, coord.laneArmSetting(CONTINUITY_LANE)).live;
  const targets = gens.rows.filter((g) => { const s = effectiveGeneration(g, live).state; return s === 'active' || s === 'degraded'; });
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
      if (key !== null) memo.set(id, { stamp: key, read: compactions }); else memo.delete(id);
    }
    const turn = await ports.turnMark(id);
    const started = await ports.processStartedAt(id);
    const behind: Reading<boolean> = release.kind === 'none' ? { kind: 'measured', value: false }
      : release.kind === 'unreadable' ? later('install record unreadable')
      : started === null ? later('process start unmeasured') : { kind: 'measured', value: started < release.at };
    out.set(g.id, { usage, compactions, turn, behind });
  }
  for (const id of [...memo.keys()]) if (!targets.some((g) => g.sessionId === id)) memo.delete(id);
  return out;
}

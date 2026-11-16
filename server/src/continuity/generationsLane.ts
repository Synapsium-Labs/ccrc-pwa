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
// `continuity-generations-lane.test.ts` holds that, as the case lane's does). It takes no act on any session itself: it
// PLANS the acts of a live walk and its caller takes them (`renewalActs.ts`), and in shadow it plans none. `continuity` live
// changes which column a walk moves and whether its acts are planned; the renewal act lifted the card's gate (review 2003
// F3), so the row can be set Live.
//
// THE DUE RECORD DOES NOT DEPEND ON THE WALK (review 2003 F1). A generation is judged, and gathered for, when its `state`
// column is `active` or `degraded`, whatever a shadow walk holds in `shadowState`: a shadow mint leaves `state` `active`,
// so every generation minted in shadow carries the `renewalDue` answer of its last pass and the triggers it could not
// read. The walk's own column still records the would-be states.
//
// THE CARD READ (the card piece, PR B, plan `w1a-card.md` Task 5). A generation whose effective state is `carded` (read only
// through `effectiveGeneration`, review 1902 F6: in shadow a mint leaves `state` at `active` and `shadowState` at `carded`)
// is fed `card-read` from the card door's rows (`cardReadOfStart`: the newest full read by the conversation its start
// reported, made since the start was received, and whether it was the session's current card). The feed (`cardReadFeed`)
// is one source of stamped events and the apply loop is separate: the loop writes every step the machine reports
// `changed` (a whole-view comparison, decided in L1), state or not, with the card the event carried, and skips the rest.
// So only a matching read moves `carded` to `probing` and writes its card hash and snapshot, and the renewal act's ordered
// feed (nudges, the receipt, probe rounds) replaces the feed and keeps the loop (review 1902 F6, review 2023 F5). In
// shadow this is a record on the shadow column, and the probes piece takes it on from `probing`.
//
// THE PROBES (the probes piece, PR B, plan `w1a-probes.md` Tasks 5 and 6). Each live generation's rounds are read
// (`probeRows`), and `probeSchedule` (L1) says which graded round to feed the machine and which round to open: the feed goes
// through the same apply loop as the card read (`applyFedEvents`), so only a step the machine reports `changed` is written,
// and the round is composed by `probeRound` (L1) over a snapshot (`roundSnapshotOf`: the carded one for a start round, the
// newest the conversation read for a compaction round; read back by `snapshotFactsOf`), or, for a spot round,
// over the notes it wrote and the mail it was sent since it entered its state (`spotFactsOf`), and opened through the store
// (`openRound`, one open round per generation, compared and set there). A spot round is RECORDED ONLY: no mail announces it
// in this piece (the coordinator's ruling, slug spot-mail-waits-on-the-renewal-act), so the lane still sends nothing. The
// graded compaction rounds give `renewalDue` its `probe-failed` input (`probeFailedUnfixedOf`). A composition with no question
// opens nothing, and is remembered by its key (`emptyTryKey`, in `emptyTries`, one per round kind) so it is neither drawn
// nor logged again until the key changes (review 2063 F4); a compaction round remembered so does not hold the spot branch
// (`compactionStalled`, review 2068 F4). The compactions that open a round are those that BEGAN in its window
// (`compactionsBegunSince`, review 2068 F7), and a usage reading counts after a compaction only when it is newer than the
// compaction's newest line (`newestCompactionAt`, review 2068 F1).
//
// THE RENEWAL WALK (the renewal act, plan `w1a-renewal-act.md` Task 4). After the due record, each live generation is fed
// the events `renewalFeed` (L1) orders for it: a due the permit lets start (`renewalPermit`: the host can renew, the Overlord
// first for a coordinator, `softRenewalMay` for a soft trigger), `drained` from the hold table (`drainVerdict`), `handover`
// when this generation's note arrived, `nudge-due` at `carded`'s nudge point, and `deadline` last; a fact stamped at or after
// the deadline is not fed (m6), and the card read and the probe rounds above are held to the same rule. Each step the machine
// reports `changed` is written, and its acts (`actsOfStep`) are PLANNED, never taken here: while `continuity` is live the
// caller hands them to `runRenewalActs` (`renewalActs.ts`), and in shadow each step is recorded in the log instead, its
// actions named, so shadow sends nothing and holds nothing (`state` stays `active`; the walk moves `shadowState`). A
// `clearing` generation's `renew` is owed by `renewOwed` from the calls the acts claimed, so a retry waits for the next pass
// and its receipt read. After a renewal's start mints the next generation, its first prompt is planned; a spot round opened
// while live plans its mail.
//
// TWO HALVES. `gatherGenerationReadings` (async) makes the fleet reads for the generations a pass will judge; then
// `generationsPass` (synchronous, one transaction per write, nothing awaited) reads `coord.db`, decides and writes. So a
// pass after a restart resumes from the cursor and the stored columns, never from memory, and the simulator drives the
// pass itself on its fake clock.
import { CONTINUITY_LANE, laneArmGate } from '../../../shared/lane-arm.js';
import { RENEWAL_LANE_PERIOD_MS, RENEWAL_MODE_DEFAULT, SOFT_BUDGET, noteKeyText, type ProbeRoundKind } from '../../../shared/continuity.js';
import { CARD_MAIL_MAX, type CardFacts, type CardMail, type CardNote } from '../../../shared/continuity-card.js';
import { familyClassOf } from '../../../shared/models.js';
import type { ChildMark, RunKind } from '../../../shared/api.js';
import type { CoordStore } from '../coord/store.js';
import type { TurnMarkRead } from '../coord/stall.js';
import { laneArmRowViewOf } from '../coord/laneArm.js';
import { newestClaimedWorkRuns } from '../coord/bindingReads.js';
import { roleFactsOf, roleOf, type RoleReading } from '../roleOf.js';
import { startedBeforeRelease } from '../coord/rollTarget.js';
import type { ReleaseRead } from '../rollLane.js';
import type { Clock, Entropy } from '../time/ports.js';
import { observeTime, observedStepCapMs, type ObservedGap } from '../time/observed.js';
import type { MeasuredStat } from '../io.js';
import type { UsageRead } from '../usage.js';
import { compactionInFlight, compactionsBegunSince, compactionsSince, newestCompactionAt, type CompactionsRead } from './compactions.js';
import { RENEW_REQUESTS_CURSOR, effectiveGeneration, genExpectOf, genViewOf, type GenRow, type MintInput } from './continuityStore.js';
import { renewNowStands, renewalModeOf } from './renewNow.js';
import { precompactField, precompactRetractions } from './precompact.js';
import { markAges, markProgrammesOf, operatorQuietOf, type MarkReading } from './operatorMark.js';
import { generationStep, type GenEvent } from './generationMachine.js';
import { snapshotFactsOf } from './card.js';
import { probeRound } from './probes.js';
import {
  compactionWindowStart, emptyTryKey, probeSchedule, roundSnapshotOf, roundsOf, spotFactsOf, type CtxReading, type ProbeScheduleInput,
} from './probeSchedule.js';
import type { StartRow } from '../../../shared/continuity.js';
import {
  START_SKIPS, firstMintOf, judgedForDue, planStartBatch, startVerdict, waveBoundaryOf, type HoldClock, type StartFacts, type StartSkip,
  type StartVerdict,
} from './generationStart.js';
import { renewalDue, type Reading, type RenewalInputs } from './renewalDue.js';
import type { FleetRole } from '../../../shared/fleetRoles.js';
import type { GenAction, GenStep } from './generationMachine.js';
import { softRenewalMay, type SoftInputs, type SoftReading } from './softRenewal.js';
import { overlordFirst, type OverlordGenerationReading } from './renewalOrder.js';
import type { DrainRead } from './renewalDrain.js';
import {
  actsOfStep, beforeDeadline, handoverSince, holdOffStands, itemAboutOf, renewalFeed, renewalItemPrefix, renewalPermit, renewOwed,
  standingActs, type ItemAbout, type ItemStanding, type PermitWait, type RenewalAct,
} from './renewalFeed.js';

/** The lane's key in `continuity_cursor`, and its `LANE_SCHEDULE` row's name. */
export const GENERATIONS_LANE = 'generations';
/** At most this many starts a pass (the plan's 200): a backlog drains over several passes. */
export const GENERATIONS_START_BATCH = 200;
/** A generation's term in W1a: the designation's term arrives with W1. */
export const GENERATIONS_TERM = 1;
/** How many of a coordinator's newest starts the first mint looks through for one that mints (review 2003 F2). */
export const FIRST_MINT_LOOKBACK = 20;
/** At most this many Renew now requests a pass: a backlog drains over several passes. */
export const RENEW_REQUEST_BATCH = 200;

/** The store members the pass reaches, declared by this consumer, so a test can hand a small fake. */
export type GenerationsCoord = Pick<CoordStore, 'startsSince' | 'startsOf' | 'liveGenerations' | 'mintGeneration' | 'advanceObserved'
  | 'setGenerationDue' | 'clearShadowWalk' | 'generationsCursor' | 'advanceCursor' | 'laneArmSetting' | 'openCoordinatorIds'
  | 'run' | 'bindingRunsOf' | 'cardReadOfStart' | 'stepGeneration' | 'probeRows' | 'openRound' | 'snapshotFacts' | 'liveNotes'
  | 'mailForRecipient' | 'handoverOf' | 'softRenewalsOf' | 'recordSoftRenewal' | 'renewCallsOf' | 'itemsFor' | 'renewRequestsAfter'
  | 'operatorMarks' | 'advanceMarkQuiet' | 'bindingsOf' | 'renewalModeSetting'>;

/** What the registry says of one row at the pass: its current conversation (null: unreadable), its account and its child
 *  mark. */
export interface RegistryFacts {
  readonly id: string; readonly uuid: string | null; readonly lane: string | null; readonly child: ChildMark;
  /** The route's `precompact` field as the registry read it (null: not set), or `unread` when it could not be read. Absent
   *  reads `unread`, so the PreCompact field is never written over a value nobody read (the hand-offs piece, Task 6). */
  readonly precompact?: string | null | 'unread';
}

/** The fleet reads of one generation, made by `gatherGenerationReadings`. */
export interface GenReadings {
  readonly usage: UsageRead;
  readonly compactions: CompactionsRead;
  readonly turn: TurnMarkRead;
  /** The roll's "behind" test: the session's process started before the node's current ccrc install completed. */
  readonly behind: Reading<boolean>;
  /** The hold table's drain (`drainVerdict`), read for a generation that drains or waits on a soft due; absent when not
   *  read, which holds as unmeasured. */
  readonly drain?: DrainRead;
  /** The soft preconditions' fleet reads, which the hand-offs piece's gather and W1 will fill (the operator mark, the
   *  readers and the Overlord's place); absent, each reads unmeasured as before. The simulator's world hands them. */
  readonly soft?: Partial<Pick<SoftInputs, 'readersRunning' | 'operatorQuietObservedMs' | 'placeHiddenObservedMs'>>;
}

/** The deciders the pass asks, named so that a simulator can hand a mutant of one to the same pass (as `observe` is). */
export interface GenerationsDeciders {
  readonly renewalDue: typeof renewalDue;
  readonly softRenewalMay: typeof softRenewalMay;
  readonly generationStep: typeof generationStep;
  readonly renewalFeed: typeof renewalFeed;
  readonly renewalPermit: typeof renewalPermit;
}

export interface GenerationsDeps {
  readonly coord: GenerationsCoord;
  readonly clock: Clock;
  /** The one source of chance: a probe round's questions are drawn from it (`probeRound`), and its id. */
  readonly entropy: Entropy;
  /** This server process's id: an observed stamp from another process is a `process` gap (`observeTime`). */
  readonly proc: string;
  readonly log: (line: string) => void;
  /** The observed-time decider; `observeTime` unless a simulator hands a mutant of it to the same pass. */
  readonly observe?: typeof observeTime;
  /** The deciders `renewalDue`, `softRenewalMay`, `generationStep`, `renewalFeed` and `renewalPermit`, unless a simulator hands a
   *  mutant of one. */
  readonly decide?: Partial<GenerationsDeciders>;
  /** The continuity row's gate (`laneArmGate`), unless a test or the simulator opens it to drive the live walk the renewal
   *  act will arm (review 2006 N1). Nothing in the server passes one, so a gated row is never live here. */
  readonly gate?: (lane: typeof CONTINUITY_LANE) => string | null;
  /** The starts this process held for a failed read on an earlier pass (`HoldClock.retried`), kept by the caller across
   *  passes and rewritten by each pass that judges a batch: a memo, never a decision's durable state (review 2006 R3). */
  readonly retried: Set<number>;
  /** Each generation's newest probe composition that had no question, per round kind, by its `emptyTryKey`: a memo kept by
   *  the caller across passes, never a decision's durable state (review 2063 F4). One key per kind, so a stalled compaction
   *  try and a spot try never overwrite each other (review 2068 F4). */
  readonly emptyTries: EmptyTries;
}

/** The empty-try memo: by generation id, then by round kind, the `emptyTryKey` of the newest try that had no question. */
export type EmptyTries = Map<number, Map<ProbeRoundKind, string>>;

export interface GenerationsInput {
  /** The registry at this pass, or null when it could not be listed: then no start is judged and the cursor stays. */
  readonly registry: readonly RegistryFacts[] | null;
  /** When that registry was listed (the server's wall clock): a start received at or after it is held a pass, since the
   *  listing may not know of it (review 2006 R1). */
  readonly listedAt: number;
  /** The fleet reads, by generation id; a generation without one reads every fleet input as unmeasured. */
  readonly readings: ReadonlyMap<number, GenReadings>;
  /** The box's `hibernate-fresh` (`capSupported`): without it no renewal starts, live or shadow (Table 11.1d). Absent: false. */
  readonly canRenew?: boolean;
  /** The soft renewal Setting (R19); renew when the operator is away unless set on schedule. Absent: the stored Setting
   *  (`renewal_mode_settings`, the hand-offs piece), whose lost row or unreadable word is `when-away`. */
  readonly softMode?: SoftInputs['mode'];
}

/** The generation an act is for, as the pass read it. */
export interface ActTarget {
  readonly genId: number; readonly identity: string; readonly sessionId: string; readonly role: FleetRole;
  readonly n: number; readonly startId: number; readonly cls: GenRow['walkClass'];
  /** The renewal a `renew` belongs to: the wall time the generation entered its state (`clearing` for a renew). */
  readonly episode: number;
}
/** One act the pass planned: the caller takes it while `continuity` is live (`runRenewalActs`). */
export interface PlannedAct { readonly target: ActTarget; readonly act: RenewalAct }

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
  /** Generations in `carded` that a card read of the current hash moved to `probing` (in shadow, on the shadow column). */
  readonly cardRead: number;
  /** Graded probe rounds fed to the machine as a written step, and rounds opened (the probes piece). */
  readonly probesFed: number;
  readonly roundsOpened: number;
  /** The acts this pass planned (live only; the caller takes them), the steps it recorded in shadow (log lines, each naming
   *  the would-be acts), and the due generations whose renewal waited, by why. */
  readonly planned: readonly PlannedAct[];
  /** The sessions whose `precompact=refuse` outlived its reason (`precompactRetractions`): the caller writes `allow` for each,
   *  live or shadow, so the operator's lowering of the row switches the arm off too (ruling F2 on review 2312). */
  readonly retract: readonly string[];
  readonly recorded: readonly string[];
  readonly waits: Readonly<Partial<Record<PermitWait, number>>>;
  /** Generations whose due write named at least one trigger it could not read. */
  readonly blind: number;
  readonly cleared: number;
  /** A read that failed and stopped part of the pass, or null. */
  readonly unread: 'cursor' | 'starts' | 'generations' | 'registry' | 'card-reads' | 'probes' | 'marks' | 'renew-requests' | null;
  /** A mint that could not be written stopped the batch. */
  readonly stopped: boolean;
}

const zeroSkips = (): Record<StartSkip, number> => Object.fromEntries(START_SKIPS.map((k) => [k, 0])) as Record<StartSkip, number>;

/** One pass. Synchronous: it awaits nothing, so its writes are never interleaved with another caller's. */
export function generationsPass(deps: GenerationsDeps, input: GenerationsInput): GenerationsResult {
  const { coord, clock } = deps;
  const D: GenerationsDeciders = { renewalDue, softRenewalMay, generationStep, renewalFeed, renewalPermit, ...deps.decide };
  const now = clock.wall();
  const live = laneArmRowViewOf(CONTINUITY_LANE, coord.laneArmSetting(CONTINUITY_LANE), (deps.gate ?? laneArmGate)(CONTINUITY_LANE)).live;
  const skipped = zeroSkips();
  const gaps: (ObservedGap & { identity: string })[] = [];
  let read = 0; let minted = 0; let firstMinted = 0; let held = 0; let superseded = 0; let due = 0; let blind = 0; let cleared = 0;
  let cardRead = 0; let probesFed = 0; let roundsOpened = 0; let emptyRounds = 0;
  let stopped = false;
  const planned: PlannedAct[] = [];
  const retract: string[] = [];
  const recorded: string[] = [];
  const waits: Partial<Record<PermitWait, number>> = {};
  // A written step's acts: planned while live, recorded (and logged) in shadow, naming every machine action.
  const onStep = (gen: GenRow, from: GenerationStateOf, step: GenStep, event: GenEvent, about?: ItemAbout): void => {
    if (live) { for (const act of actsOfStep(step.actions, from, event, about)) planned.push({ target: targetOf(gen), act }); return; }
    const line = shadowLine(gen, from, step, event);
    recorded.push(line);
    deps.log(line);
  };
  // Every read that failed, each with what it stopped at the point it failed (review 2006 N3); `unread` is the first.
  const failures: Failure[] = [];
  const fail = (what: NonNullable<GenerationsResult['unread']>, detail: string, stops: string): void => {
    failures.push({ what, detail, stops });
  };
  const result = (): GenerationsResult => {
    logPass(deps.log, { skipped, held, superseded, stopped, failures, gaps, emptyRounds, waits });
    return { live, read, minted, firstMinted, skipped, held, superseded, gaps, due, cardRead, probesFed, roundsOpened, planned,
      retract, recorded, waits, blind, cleared, unread: failures[0]?.what ?? null, stopped };
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
  // Each operator mark's `quiet` advances by the same cap (ruling R4, slug operator-mark-observed): a compare-and-set on the
  // `at` it read, so a prompt that lands meanwhile is never overwritten, and a mark that reads as no activity stops aging.
  const marksRead = coord.operatorMarks();
  if (!marksRead.ok) fail('marks', marksRead.detail, 'no operator mark ages');
  else {
    for (const m of marksRead.rows) {
      if (!markAges(m)) continue;
      coord.advanceMarkQuiet(m.programme, m.at, (deps.observe ?? observeTime)(m.quiet, clock.mono(), deps.proc, cap).at);
    }
  }

  // The role as this pass reads it, for the mints below and for the renewal permit (review 2149 F12: a generation's role is
  // fixed at its mint, so a coordinator whose programme closed is re-read before its renewal starts).
  const registry = new Map((input.registry ?? []).map((r) => [r.id, r]));
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
      const hold: HoldClock = { now, listedAt: input.listedAt, retried: new Set(deps.retried) };
      const heldNow = new Set<number>();
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
          if (w.ok) {
            minted += 1; cursorDone = last && advance !== null;
            // A renewal's start minted the next generation: its first turn is the one line that sends it to its card
            // (slug first-prompt-by-deliver). A start nobody renewed gets the nudge at `carded`'s nudge point instead.
            if (live && verdict.outcome === 'renewed') {
              planned.push({ target: { genId: w.id, identity: s.sessionId, sessionId: s.sessionId, role: verdict.role, n: w.n,
                startId: s.id, cls: null, episode: now }, act: { kind: 'first-prompt' } });
            }
          } else if (w.kind === 'superseded') superseded += 1;
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

  // ---- THE CARD READ: a `carded` generation's read of its card, fed to the machine and written with what it read.
  const carded = coord.liveGenerations();
  if (!carded.ok) fail('generations', carded.detail, 'no card read is recorded');
  else {
    const feed = cardReadFeed(coord, carded.rows, live);
    for (const f of feed.failed) fail('card-reads', f, 'that generation\'s card read waits for the next pass');
    cardRead += applyFedEvents(coord, feed.events, live, now, onStep, D.generationStep);
  }

  // ---- THE PROBES: each generation's graded round fed, its next round opened, its `probe-failed` input kept for THREE.
  const probeFailed = new Map<number, Reading<boolean>>();
  const forProbes = coord.liveGenerations();
  if (!forProbes.ok) fail('generations', forProbes.detail, 'no probe round is fed or opened');
  else {
    const events: FedEvent[] = [];
    for (const g of forProbes.rows) {
      const rows = coord.probeRows(g.id);
      if (!rows.ok) { fail('probes', rows.detail, `generation ${g.id}'s probes wait for the next pass, and`); continue; }
      const rounds = roundsOf(rows.rows);
      const card = coord.cardReadOfStart(g.startId);
      const newestRead: Reading<string | null> = card.ok ? { kind: 'measured', value: card.read?.snapshotId ?? null } : later(card.detail);
      const tried = deps.emptyTries.get(g.id);
      const compSnap = roundSnapshotOf('compaction', g.snapshotId, newestRead);
      const s = probeSchedule({
        state: effectiveGeneration(g, live).state, probeRounds: g.probeRounds, rounds,
        cardReadAt: card.ok ? { kind: 'measured', value: card.read?.at ?? null } : later(card.detail),
        ...probeReadings(input.readings.get(g.id), compactionWindowStart(g.enteredAt, rounds), now),
        compactionStalled: compSnap.kind === 'measured' && tried?.get('compaction') === emptyTryKey('compaction', compSnap.value, null, null),
      });
      probeFailed.set(g.id, s.probeFailedUnfixed);
      // A graded round answered at or after the state's deadline is not fed: the deadline wins (m6).
      const fedAt = rounds.filter((r) => r.kind === 'start')[g.probeRounds]?.answeredAt ?? now;
      if (s.feed !== null && beforeDeadline(fedAt, effectiveGeneration(g, live).deadlineAt)) {
        events.push({ gen: g, event: { kind: 'probes', passed: s.feed.passed }, card: null });
      }
      if (s.open === null) continue;
      const waits = `generation ${g.id}'s ${s.open.kind} round waits for the next pass, and`;
      const snap = roundSnapshotOf(s.open.kind, g.snapshotId, newestRead);
      if (snap.kind !== 'measured') { fail('card-reads', snap.why, waits); continue; }
      const spot = s.open.kind === 'spot';
      // A start or compaction try is keyed by its snapshot before its facts are read; a spot try by the rows it is drawn from.
      if (!spot && tried?.get(s.open.kind) === emptyTryKey(s.open.kind, snap.value, null, null)) continue;
      const facts = probeFactsOf(coord, g, s.open.kind, snap.value, now);
      if (typeof facts === 'string') { fail('probes', facts, waits); continue; }
      const key = emptyTryKey(s.open.kind, snap.value, s.open.depthTokens, spot ? facts : null);
      if (tried?.get(s.open.kind) === key) continue;
      const composed = probeRound(g.role, facts, deps.entropy, s.open.kind);
      const w = coord.openRound({
        roundId: `r-${deps.entropy.uuid()}`, sessionId: g.sessionId, generationId: g.id, kind: s.open.kind,
        questions: composed.questions.map((q) => ({ qid: q.id, cls: q.cls, question: q.text, choices: q.choices, expected: q.expected })),
        snapshotId: snap.value, depthTokens: s.open.depthTokens, modelClass: spot && g.model !== null ? familyClassOf(g.model) : null,
        roundUnmeasured: composed.unmeasured, askedAt: now, supersedes: s.open.supersedes,
      });
      // Only this kind's memo is forgotten: a remembered empty compaction try outlives a spot round (review 2103 F4).
      if (w.ok) {
        roundsOpened += 1; if (tried !== undefined) deps.emptyTries.set(g.id, new Map([...tried].filter(([k]) => k !== s.open!.kind)));
        // A spot round opened while live is announced by system mail (subject `probe`); in shadow it is recorded only.
        if (spot && live) planned.push({ target: targetOf(g), act: { kind: 'spot-probe' } });
      }
      else if (w.kind === 'empty') { emptyRounds += 1; deps.emptyTries.set(g.id, new Map(tried).set(s.open.kind, key)); }
      else if (w.kind === 'write-failed') fail('probes', 'continuity_probes could not be written', `generation ${g.id}'s round waits for the next pass, and`);
    }
    probesFed += applyFedEvents(coord, events, live, now, onStep, D.generationStep);
    for (const id of [...deps.emptyTries.keys()]) if (!forProbes.rows.some((g) => g.id === id)) deps.emptyTries.delete(id);
  }

  // ---- THREE: the `renewalDue` answer is recorded for every generation whose `state` is at rest (`active` or `degraded`),
  // whatever a shadow walk holds (review 2003 F1).
  const gens = coord.liveGenerations();
  // The PreCompact field's retraction (ruling F2 on review 2312): it walks the registry rows that carry the field, not only
  // the live generations, and a shadow pass plans it too, so the field never outlives the row's setting or its generation.
  retract.push(...precompactRetractions(input.registry ?? [], live, gens.ok ? new Set(gens.rows.map((g) => g.sessionId)) : null));
  if (!gens.ok) { fail('generations', gens.detail, 'no due is recorded'); return result(); }
  // The operator's Renew now requests after the lane's own cursor (slug renew-request-read-by-cursor): a request sets
  // `renewNow` for its session's generation, and the cursor rides the last due write that reads one, so a request is read
  // once. Requests no judged generation reads (one already walking, or ended) are passed over with the cursor. Only a request
  // pressed while the row was live is read as one, and only on a live pass (ruling F1 on review 2312): a shadow press, or a
  // live press read once the row is lowered, is passed over with the cursor and logged, so it never renews, then or later.
  const reqCursor = coord.generationsCursor(RENEW_REQUESTS_CURSOR);
  const reqs = reqCursor.ok ? coord.renewRequestsAfter(reqCursor.lastStartId, RENEW_REQUEST_BATCH) : null;
  if (!reqCursor.ok) fail('cursor', reqCursor.detail, 'no Renew now request is read');
  else if (reqs !== null && !reqs.ok) fail('renew-requests', reqs.detail, 'no Renew now request is read');
  const requested = new Set(live && reqs !== null && reqs.ok ? reqs.rows.filter((r) => r.live).map((r) => r.sessionId) : []);
  for (const r of reqs !== null && reqs.ok ? reqs.rows : []) {
    if (!live || !r.live) deps.log(`ccrc-server: generations: shadow: ${r.sessionId} Renew now ${r.id} read; pressed or read in shadow, so nothing renews`);
  }
  const lastReq = reqs !== null && reqs.ok ? reqs.rows.at(-1) : undefined;
  const reqAdvance = reqCursor.ok && lastReq !== undefined ? { lane: RENEW_REQUESTS_CURSOR, from: reqCursor.lastStartId, to: lastReq.id } : null;
  const readers = gens.rows.filter((g) => judgedForDue(g) && requested.has(g.sessionId));
  for (const g of gens.rows) {
    if (!judgedForDue(g)) continue;
    const wave: Reading<boolean> = g.role !== 'coordinator' ? { kind: 'unmeasured', why: 'not a coordinator' } : (() => {
      const runs = newestClaimedWorkRuns(coord, g.identity);
      return runs.ok ? { kind: 'measured', value: waveBoundaryOf(runs.runs) } : { kind: 'unmeasured', why: runs.detail };
    })();
    const renewNow = renewNowStands(requested.has(g.sessionId), g.dueWhy, live);
    const d = D.renewalDue(renewalInputsOf(g, input.readings.get(g.id), wave, now, probeFailed.get(g.id) ?? later('probes unread this pass'), renewNow));
    if (d.due) due += 1;
    if (d.blind.length > 0) blind += 1;
    coord.setGenerationDue(g.id, genExpectOf(g), d.due
      ? { due: true, why: d.why, cls: d.cls, at: now, observedMs: g.observed.ms } : { due: false }, d.blind,
      g === readers.at(-1) ? reqAdvance : null);
  }
  if (reqAdvance !== null && readers.length === 0) coord.advanceCursor(reqAdvance);

  // ---- FOUR: the renewal walk (the header): each live generation's ordered events, then a `clearing` one's owed `renew`.
  const walk = coord.liveGenerations();
  if (!walk.ok) { fail('generations', walk.detail, 'no renewal step is fed'); return result(); }
  const overlord = overlordReadingOf(walk.rows, live);
  const softMode = input.softMode ?? renewalModeOf(coord.renewalModeSetting()) ?? RENEWAL_MODE_DEFAULT;
  // The marks as they stand after step ONE aged them, read once and only for a pass with a soft due to permit.
  let marksNow: readonly MarkReading[] | 'unmeasured' | null = null;
  const marks = (): readonly MarkReading[] | 'unmeasured' => (marksNow ??= marksOf(coord.operatorMarks()));
  for (const g0 of walk.rows) {
    let g = g0;
    const eff = effectiveGeneration(g, live);
    const r = input.readings.get(g.id);
    let due: { cls: NonNullable<GenRow['dueClass']> } | null = null;
    if ((eff.state === 'active' || eff.state === 'degraded') && g.dueClass !== null && g.dueSince !== null) {
      const roleNow = roleFor(g.sessionId);
      const permit = D.renewalPermit({
        isCoordinator: g.role === 'coordinator', cls: g.dueClass, canRenew: input.canRenew === true, overlord,
        roleChanged: g.role === 'coordinator' && !(roleNow.kind === 'role' && roleNow.role === 'coordinator'),
        holdOff: holdOffStands(softTimesOf(g)),
        soft: g.dueClass === 'soft' ? D.softRenewalMay(softInputsOf(coord, g, r, overlord, softMode, marks())) : { start: true },
      });
      if (permit.feed) due = { cls: permit.cls }; else waits[permit.waitFor] = (waits[permit.waitFor] ?? 0) + 1;
    }
    const handover = eff.state === 'checkpointed' ? coord.handoverOf(g.id) : null;
    if (handover !== null && !handover.ok) fail('generations', handover.detail, `generation ${g.id}'s handover waits for the next pass, and`);
    // A live `clearing` renewal's calls: the current try claimed and never answered (review 2149 F6), and the newest answer,
    // which the item's words follow (F5).
    const clearingCalls = live && eff.state === 'clearing' ? coord.renewCallsOf(g.id, g.enteredAt) : null;
    if (clearingCalls !== null && !clearingCalls.ok) { fail('generations', clearingCalls.detail, `generation ${g.id}'s renewal step waits for the next pass, and`); continue; }
    const tries = clearingCalls === null ? [] : clearingCalls.calls;
    const unanswered = tries.find((c) => c.try === g.attempts && c.answer === null);
    const about = itemAboutOf([...tries].reverse().find((c) => c.answer !== null)?.answer ?? null);
    const events = D.renewalFeed({
      state: eff.state, deadlineAt: eff.deadlineAt, now, due, drained: r?.drain?.held === false,
      handoverAt: handover !== null && handover.ok ? handoverSince(handover.handover?.at ?? null, g.enteredAt) : null, renudged: g.renudged,
      unansweredClaimAt: unanswered?.at ?? null, disarmed: !live && g.walk === 'live',
    });
    // The events were ordered for the state the pass read; once one moves the state, the rest (`deadline` above all) belong
    // to a state the generation has left, so the walk stops and the next pass reads the new state's facts.
    for (const e of events) {
      const from = effectiveGeneration(g, live).state;
      const step = D.generationStep(genViewOf(g, live), e);
      if (!step.changed) continue;
      if (!coord.stepGeneration(g.id, genExpectOf(g), step.next, live, now).changed) break;
      const again = coord.liveGenerations();
      const next = again.ok ? again.rows.find((x) => x.id === g.id) : undefined;
      // Feeding a soft due spends one of the soft budget's renewals, stamped on the accumulator (ruling R4): live only, since
      // the live budget counts every row and a shadow walk renews nothing (review 2149 F14).
      if (live && e.kind === 'due' && e.cls === 'soft' && next !== undefined && !coord.recordSoftRenewal(next, next.observed.ms).ok) {
        fail('generations', 'continuity_soft_renewals could not be written', `generation ${g.id}'s soft renewal is not counted, and nothing else is lost`);
      }
      onStep(g, from, step, e, about);
      if (next === undefined) break;
      g = next;
      if (step.next.state !== from) break;
    }
    if (!live) continue;
    // A degraded generation's item is re-planned on every pass while it stays degraded and none stands open on its programme
    // (review 2149 F3), so a raise that failed or threw is tried again; the acts check again before they raise.
    if (effectiveGeneration(g, live).state === 'degraded') {
      for (const act of standingActs('degraded', itemStandingOf(coord, g, now))) planned.push({ target: targetOf(g), act });
    }
    // A renewal's calls are its episode's: the time this generation entered `clearing` (slug renew-calls-keyed-by-episode).
    const calls = effectiveGeneration(g, live).state === 'clearing' ? coord.renewCallsOf(g.id, g.enteredAt) : null;
    if (calls !== null && !calls.ok) { fail('generations', calls.detail, `generation ${g.id}'s renew waits for the next pass, and`); continue; }
    const owed = calls === null ? null : renewOwed('clearing', g.attempts, calls.calls.map((c) => c.try));
    if (owed !== null) planned.push({ target: targetOf(g), act: { kind: 'renew', try: owed } });
    // The PreCompact arm's field (the hand-offs piece, Task 6; slug precompact-field-from-the-budget): `precompactField` of the
    // soft budget's count, planned only when it differs from what the registry read, and never over a field it could not
    // read or from a count it could not read. Live only (this loop's `live` check above); a field that outlives the row's
    // setting or its generation is retracted by step THREE's `precompactRetractions`.
    const reg = registry.get(g.sessionId);
    const have = reg === undefined || reg.precompact === undefined ? 'unread' : reg.precompact;
    const used = softRenewalsInWindowOf(coord, g);
    if (have !== 'unread' && Number.isInteger(used)) {
      const want = precompactField(used);
      if (have !== want) planned.push({ target: targetOf(g), act: { kind: 'precompact-field', value: want } });
    }
  }
  return result();
}

/** The soft renewals of the identity's line within the budget's window of observed time (the accumulator carries across
 *  mints); NaN when they could not be read, which is not a count. `softRenewalMay`'s count and `precompactField`'s. */
function softRenewalsInWindowOf(coord: Pick<GenerationsCoord, 'softRenewalsOf'>, g: GenRow): number {
  const stamps = coord.softRenewalsOf(g.identity, g.term);
  return stamps.ok ? stamps.observedMs.filter((at) => g.observed.ms - at < SOFT_BUDGET.windowMs).length : Number.NaN;
}

/** Where a degraded generation's item stands (`ItemStanding`): only a coordinator has a programme to raise it on. */
function itemStandingOf(coord: Pick<GenerationsCoord, 'itemsFor' | 'bindingRunsOf' | 'run'>, g: GenRow, now: number): ItemStanding {
  if (g.role !== 'coordinator') return 'no-programme';
  const runs = newestClaimedWorkRuns(coord, g.identity);
  const program = runs.ok ? runs.runs[0]?.program : undefined;
  if (program === undefined) return 'no-programme';
  return coord.itemsFor(program, now).open.some((i) => i.title.startsWith(renewalItemPrefix(g.sessionId, g.n))) ? 'open' : 'none';
}

/** A generation's state, as `onStep` names the state a step left. */
type GenerationStateOf = GenRow['state'];

/** The act target of a generation row. */
const targetOf = (g: GenRow): ActTarget => ({
  genId: g.id, identity: g.identity, sessionId: g.sessionId, role: g.role, n: g.n, startId: g.startId, cls: g.walkClass,
  episode: g.enteredAt,
});

/** One shadow record: the step and the machine's actions it would have taken. */
function shadowLine(g: GenRow, from: GenerationStateOf, step: GenStep, event: GenEvent): string {
  const acts: readonly GenAction[] = step.actions;
  return `ccrc-server: generations: shadow: ${g.sessionId} n=${g.n} ${from} -> ${step.next.state} on ${event.kind}`
    + (acts.length > 0 ? `, would ${acts.join(', ')}` : '');
}

/** The Overlord's live generation, for `overlordFirst`: none until W1 mints one. */
function overlordReadingOf(rows: readonly GenRow[], live: boolean): OverlordGenerationReading {
  const o = rows.find((x) => x.role === 'overlord');
  return o === undefined ? 'none' : effectiveGeneration(o, live).state;
}

/** The marks as step ONE read them, for `operatorQuietOf`: `unmeasured` when that read failed. */
const marksOf = (read: ReturnType<GenerationsCoord['operatorMarks']>): readonly MarkReading[] | 'unmeasured' => read.ok ? read.rows : 'unmeasured';

/** A coordinator's programmes, the open runs it claims (`markProgrammesOf`, the prompt route's own rule, with no worker side). */
function coordinatorProgrammes(coord: Pick<GenerationsCoord, 'bindingsOf'>, identity: string): readonly string[] | 'unmeasured' {
  try { return markProgrammesOf(coord.bindingsOf(identity).claimant(), { ok: true, siblings: [] }); } catch { return 'unmeasured'; }
}

/** `softRenewalMay`'s inputs from stored columns and measured readings (ruling R4, slug gather-in-the-act-lane): the observed
 *  times (`softTimesOf`), the soft renewals of the identity's line within the budget's window of observed time (the
 *  accumulator carries across mints), the hold table's drain, and, for a coordinator, the `operator-at-programme` mark of
 *  its programmes (`operatorQuietOf`; the hand-offs piece). A count that could not be read is not a count, so the decider
 *  waits `unmeasured`. */
function softInputsOf(coord: Pick<GenerationsCoord, 'softRenewalsOf' | 'bindingsOf'>, g: GenRow, r: GenReadings | undefined,
  overlord: OverlordGenerationReading, mode: SoftInputs['mode'], marks: readonly MarkReading[] | 'unmeasured'): SoftInputs {
  const inWindow = softRenewalsInWindowOf(coord, g);
  const na: SoftReading<number> = { kind: 'not-applicable' };
  return {
    role: g.role,
    hibernateHold: r?.drain ?? { held: true, reason: 'unmeasured' },
    readersRunning: g.role === 'coordinator' ? na : later('W1'),
    operatorQuietObservedMs: g.role === 'coordinator' ? operatorQuietOf(coordinatorProgrammes(coord, g.identity), marks)
      : g.role === 'overlord' ? later('W1') : na,
    placeHiddenObservedMs: g.role === 'overlord' ? later('W1') : na,
    ...r?.soft,
    mode, ...softTimesOf(g), softRenewalsInWindow: inWindow, overlordOutsideActive: !overlordFirst(overlord),
  };
}

/** One event for one generation, and the card it read when the event is a card read. */
export interface FedEvent {
  readonly gen: GenRow;
  readonly event: GenEvent;
  readonly card: { readonly hash: string; readonly snapshotId: string } | null;
}

/** THE APPLY LOOP, apart from any feed: each event is stepped through the machine on the generation's effective view, and
 *  every step the machine reports `changed` is written (compare-and-set, with the card the event carried); a step that
 *  changes nothing is not written. Answers how many rows it wrote. The renewal act's ordered feed hands its events here. */
export function applyFedEvents(coord: Pick<GenerationsCoord, 'stepGeneration'>, events: readonly FedEvent[], live: boolean, now: number,
  onStep?: (gen: GenRow, from: GenRow['state'], step: GenStep, event: GenEvent) => void, stepOf: typeof generationStep = generationStep): number {
  let wrote = 0;
  for (const { gen, event, card } of events) {
    const step = stepOf(genViewOf(gen, live), event);
    if (!step.changed) continue;
    if (!coord.stepGeneration(gen.id, genExpectOf(gen), step.next, live, now, card).changed) continue;
    wrote += 1;
    onStep?.(gen, effectiveGeneration(gen, live).state, step, event);
  }
  return wrote;
}

/** The card reads, as events: for each generation whose effective state is `carded` (`effectiveGeneration`, never `state` or
 *  `shadowState` directly), its newest full read by the conversation its start reported, with `hashMatches` true only when
 *  that read was of the session's current card. A generation that has read nothing yet gets no event. One read that fails
 *  is named and that generation waits; the others are fed. */
export function cardReadFeed(coord: Pick<GenerationsCoord, 'cardReadOfStart'>, gens: readonly GenRow[], live: boolean):
  { readonly events: readonly FedEvent[]; readonly failed: readonly string[] } {
  const events: FedEvent[] = [];
  const failed: string[] = [];
  for (const gen of gens) {
    if (effectiveGeneration(gen, live).state !== 'carded') continue;
    const r = coord.cardReadOfStart(gen.startId);
    if (!r.ok) { failed.push(r.detail); continue; }
    if (r.read === null) continue;
    // A read made at or after `carded`'s deadline is not fed: the deadline wins (m6).
    if (!beforeDeadline(r.read.at, effectiveGeneration(gen, live).deadlineAt)) continue;
    events.push({ gen, event: { kind: 'card-read', hashMatches: r.read.current }, card: { hash: r.read.hash, snapshotId: r.read.snapshotId } });
  }
  return { events, failed };
}

/** A read that failed, and what it stopped where it failed. */
interface Failure { readonly what: NonNullable<GenerationsResult['unread']>; readonly detail: string; readonly stops: string }

/** The pass's one log line set (review 2003 F5): every non-zero skip count, the held and superseded starts and a stop,
 *  in one line; each read that failed in a line of its own, naming what it stopped (review 2006 N3); the observed-time
 *  gaps in another. */
function logPass(log: (line: string) => void, p: {
  skipped: Readonly<Record<StartSkip, number>>; held: number; superseded: number; stopped: boolean;
  failures: readonly Failure[]; gaps: readonly ObservedGap[]; emptyRounds: number; waits: Readonly<Partial<Record<PermitWait, number>>>;
}): void {
  const parts = START_SKIPS.filter((k) => p.skipped[k] > 0).map((k) => `${p.skipped[k]} ${k}`);
  if (p.held > 0) parts.push(`${p.held} held for a later pass`);
  if (p.superseded > 0) parts.push(`${p.superseded} superseded`);
  if (p.stopped) parts.push('a mint could not be written, so the batch stopped and the cursor stays');
  if (parts.length > 0) log(`ccrc-server: generations: starts this pass: ${parts.join(', ')}`);
  for (const f of p.failures) log(`ccrc-server: generations: the ${f.what} could not be read, so ${f.stops} this pass: ${f.detail}`);
  // The due renewals that waited, by why (review 2149 F7): the shadow week's evidence, `capability-missing` above all.
  const waited = Object.entries(p.waits).filter(([, n]) => n !== undefined && n > 0).map(([why, n]) => `${n} ${why}`);
  if (waited.length > 0) log(`ccrc-server: generations: due renewals that waited this pass: ${waited.join(', ')}`);
  if (p.emptyRounds > 0) log(`ccrc-server: generations: ${p.emptyRounds} probe round(s) had no question to ask, so none was opened (slug an-empty-round-is-not-opened)`);
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
export function renewalInputsOf(g: GenRow, r: GenReadings | undefined, wave: Reading<boolean>, nowMs: number,
  probeFailedUnfixed: Reading<boolean>, renewNow = false): RenewalInputs {
  const unread = later('unread this pass');
  const usage = (pick: 'ctxTokens' | 'ctxWindow'): Reading<number> => usageReading(r, pick);
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
    probeFailedUnfixed, modelDrift: W1, startResumed, entryRetired: W1, termRaised: W1, accountOutsideSet: W1,
    classUnservable: W1, accountLoadMove: W1, compactionRefused: later('compaction'), classChanged: W1, evaluationDue: W1,
    notLocal: W1, waveBoundary: wave, renewNow,
  };
}

/** One usage figure from a fresh sidecar, or why it is unmeasured: a stale sidecar is unmeasured, never a reading. */
function usageReading(r: GenReadings | undefined, pick: 'ctxTokens' | 'ctxWindow'): Reading<number> {
  if (r === undefined) return later('unread this pass');
  if (r.usage.kind !== 'reading') return later(`usage ${r.usage.kind}`);
  if (r.usage.usage.stale) return later('usage stale');
  const v = r.usage.usage[pick];
  return v === null || v === undefined ? later(`usage has no ${pick}`) : { kind: 'measured', value: v };
}

/** The fleet readings `probeSchedule` takes: the compactions that began since `since` (`compactionsBegunSince`, review 2068
 *  F7), when the newest compaction line was written, whether the turn marker reads idle, and the fresh context with the time
 *  the statusline wrote it (the sidecar's `ts`, in seconds). A generation with no readings this pass reads every one
 *  unmeasured. */
function probeReadings(r: GenReadings | undefined, since: number, now: number): Pick<ProbeScheduleInput, 'compactionsSince' | 'compactedAt' | 'compactionInFlight' | 'idle' | 'ctx'> {
  const lines = r === undefined ? later('unread this pass') : r.compactions.kind === 'unreadable' ? later('compactions unreadable')
    : { kind: 'measured' as const, value: r.compactions.kind === 'absent' ? [] : r.compactions.lines };
  const idle: Reading<boolean> = r === undefined ? later('unread this pass') : !r.turn.ok ? later(`turn marker ${r.turn.reason}`)
    : { kind: 'measured', value: r.turn.state !== 'working' };
  const ctx = ctxReading(r);
  return lines.kind !== 'measured' ? { compactionsSince: lines, compactedAt: lines, compactionInFlight: lines, idle, ctx } : {
    compactionsSince: { kind: 'measured', value: compactionsBegunSince(lines.value, since) },
    compactedAt: { kind: 'measured', value: newestCompactionAt(lines.value) },
    compactionInFlight: { kind: 'measured', value: compactionInFlight(lines.value, now) }, idle, ctx,
  };
}

/** The fresh context and when the statusline wrote it, epoch ms (the sidecar's `ts` is in seconds), or why it is unmeasured. */
function ctxReading(r: GenReadings | undefined): Reading<CtxReading> {
  const tokens = usageReading(r, 'ctxTokens');
  if (tokens.kind !== 'measured' || r?.usage.kind !== 'reading') return tokens.kind === 'measured' ? later('usage unread') : tokens;
  return { kind: 'measured', value: { tokens: tokens.value, at: r.usage.usage.ts * 1000 } };
}

/** The facts a round of `kind` is drawn from (the snapshot `roundSnapshotOf` chose, or this generation's own rows for a spot
 *  round), or what kept them from being read. */
function probeFactsOf(coord: Pick<GenerationsCoord, 'snapshotFacts' | 'liveNotes' | 'mailForRecipient'>, g: GenRow, kind: ProbeRoundKind,
  snapshotId: string | null, now: number): CardFacts | string {
  if (kind === 'spot') {
    const notes = coord.liveNotes(g.identity);
    if (!notes.ok) return notes.detail;
    let mail: CardMail[];
    try {
      mail = coord.mailForRecipient(g.sessionId, CARD_MAIL_MAX)
        .map((m) => ({ deliveryId: m.deliveryId, fromId: m.fromId, at: m.at, subject: m.subject, parked: false }));
    } catch (e) { return `the mail could not be read: ${e instanceof Error ? e.message : String(e)}`; }
    const mine: CardNote[] = notes.notes.filter((n) => n.generationId === g.id).map((n) => ({
      id: n.id, at: n.at, kind: n.kind, key: noteKeyText(n.key), keyFact: 'unmeasured', waitsOn: n.waitsOn, next: n.next,
    }));
    return spotFactsOf(g.sessionId, g.role, now, mine, mail, g.enteredAt);
  }
  if (snapshotId === null) return `generation ${g.id} names no snapshot`;
  const s = coord.snapshotFacts(snapshotId);
  if (!s.ok) return s.detail;
  if (s.facts === null) return `snapshot ${snapshotId} is not stored`;
  return snapshotFactsOf(s.facts, now) ?? `snapshot ${snapshotId} does not read`;
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
  /** `$REG/<id>.compactions`'s size and time, the journal's half of that key: a `post` line lands there (review 2103 F2). */
  journalStamp(id: string): Promise<MeasuredStat>;
  compactions(id: string): Promise<CompactionsRead>;
  turnMark(id: string): Promise<TurnMarkRead>;
  processStartedAt(id: string): Promise<number | null>;
  release(): Promise<ReleaseRead>;
  /** The hold table's drain for a session (`drainVerdict` over its row and live reads). Absent: no drain is read, which
   *  holds as unmeasured. */
  drainOf?(id: string): Promise<DrainRead>;
}

/** The compactions last read per session and the stamp they were read at: a read cache, never a decision's memory. */
export type CompactionsMemo = Map<string, { stamp: string; read: CompactionsRead }>;

/** A generation the gather reads: one judged for due, or one whose walk drains (either column). */
const gathered = (g: GenRow): boolean => judgedForDue(g) || g.state === 'draining' || g.shadowState === 'draining';
/** A generation whose drain is read: one draining, or one at rest whose soft trigger waits on the hold table. */
const drainRead = (g: GenRow): boolean => g.state === 'draining' || g.shadowState === 'draining' || (judgedForDue(g) && g.dueClass === 'soft');

/** The fleet reads for every live generation the pass will judge (`judgedForDue`) or drain. The
 *  compactions are re-read only when the PreCompact events file changed (every compaction writes it, the pre line or the
 *  rotation; review 1927 N2) or the journal did (a settled compaction's `post` line, review 2103 F2), and every time when
 *  the events file is absent (an older hook) or either stamp could not be read. An absent journal is part of the key. */
export async function gatherGenerationReadings(coord: Pick<GenerationsCoord, 'liveGenerations'>,
  ports: GatherPorts, memo: CompactionsMemo): Promise<Map<number, GenReadings>> {
  const out = new Map<number, GenReadings>();
  const gens = coord.liveGenerations();
  if (!gens.ok) return out;
  const targets = gens.rows.filter(gathered);
  if (targets.length === 0) return out;
  const release = await ports.release();
  for (const g of targets) {
    const id = g.sessionId;
    const usage = await ports.usage(id);
    const stamp = await ports.eventsStamp(id);
    const journal = await ports.journalStamp(id);
    const jkey = journal.ok ? `${journal.mtimeMs}:${journal.size}` : journal.reason === 'absent' ? 'absent' : null;
    const key = stamp.ok && jkey !== null ? `${stamp.mtimeMs}:${stamp.size}|${jkey}` : null;
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
    const drain = ports.drainOf !== undefined && drainRead(g) ? await ports.drainOf(id) : undefined;
    out.set(g.id, drain === undefined ? { usage, compactions, turn, behind } : { usage, compactions, turn, behind, drain });
  }
  for (const id of [...memo.keys()]) if (!targets.some((g) => g.sessionId === id)) memo.delete(id);
  return out;
}

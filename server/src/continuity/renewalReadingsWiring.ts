// L4 delivery, context C3 (Session Conversation): the renewal readings' wiring for the generations pass (Overlord W1, plan
// `w1-renewal-readings.md`). It builds the gather's one optional port, `GatherPorts.w1`, which reads each wired producer
// for one generation and hands the mappers' answers (`renewalReadings.ts`, L1) to the lane, which spreads them over its
// `W1` defaults (`renewalInputsOf`). It decides nothing and writes nothing: every reading is its producer's, and every
// mapping is the L1 module's.
//
// ONE PRODUCER NEVER REJECTS THE PASS (review 2183 F17). Each producer's read and its mapper run inside their own `try`: a
// throw sets that one field to unmeasured `<reading> read failed`, logged once per pass, and the other fields and the other
// generations read as their ports answer.
//
// PR A wires two readings, both the Overlord's only: the fitted ceiling (`closedSpotProbes`, read once per model class per
// pass) and the daily backstop (`backstopRead`, read once per pass). PR C wires the designation's two, the Overlord's only too
// (`designationRead`, read once per pass): `termRaised` and `classChanged`. PR F wires `turns`, the Overlord's only: the private
// store's count of the messages recorded since the generation's start (`messagesSince`), passed through, and kept as the lane's
// `W1` on a box whose private store is not in the deps. PR B wires `notLocal` for every generation the gather reads, Overlord
// and coordinator: the generation's own start by its id (`startById`), then the watcher's one memoized transcript resolver
// (`deps.transcript`, the same instance its name sweep and idle nudge ask) for that start's uuid under the generation's own
// account (`notLocalAskOf` decides what to ask, and refuses a registry row that has moved), never with `foreign`. A complete
// absence from that resolver may be its memory (review 3696 F1), and its `complete` folds an unreadable read into absence
// (review 3718 F3), so it is checked by one measured search of every place the resolver's own-account search looks
// (`uuidGlobPlaces`, over the watcher's io, with the reads that tell absent from unreadable); `notLocalOf` believes an absence
// only from that search. The isolation word's carrier (`deps.isolation`) is read before the first read and after the last. A
// field it does not answer keeps the lane's `W1`.
//
// PR D wires the account readings, the Overlord's only: `accountOutsideSet`, `classUnservable` and `accountLoadMove`. Once a pass:
// the account facts (the roster, `readLimits` and `readSharesMeasured` over the watcher's io, the store's central pool edges, each
// roster account's `laneFactsOf`) and the candidates `overlordCandidatesOf` builds from them and the designation. Once a pass per
// Overlord session: ccd's `pool-answer`, through the body adapter's one composer (`ccdPoolAnswer`, behind `ccdCan`). The mappers
// (`renewalReadings.ts`) decide; this file only reads. A coordinator gets none of the three.
// The designation is read first: when it is not this session's live binding, or is unreadable (`unboundCandidates`), the three
// answer from it alone, and neither the facts nor the pool answer is read (fix round 1, I).
//
// A SECOND LIMITS READER, LEGITIMATELY DIFFERENT (fix round 1, A): the tick reads the limits once and publishes them
// (`FleetWatcher.currentLimits`), but `sweepGenerations` runs before that read in the same tick, so the tick's own reading would be
// the previous tick's or none. So the wiring calls the producer's own reader (`readLimits`), as the request-time callers in
// `server.ts` do, and the shares read, which has no tick owner, the same way. From the merge these reads, the edges read and the
// pool answer run on every tick, in shadow too, for a generation of the Overlord's role that the designation binds; their cost on
// the fleet box is not measured (the plan's question 8 stays open).
//
// PR H wires the launch profile, the Overlord's only. The standing account holds (`accountHolds`), read once a pass, go into the
// account facts (designation A's list leaves a held account out) and into `accountOutsideSetOf` in place of `'not-wired'`; a store
// without the read keeps `'not-wired'` and the list unfiltered. The Overlord's `installBehind` is `overlordInstallBehindOf` over
// the gather's `behind`, the newest start's digest against the server's (`startLoadsOfNewestStart`, `launchDigestOf`) and the
// fleet's build agreement (`inventoryBuildAgreement`, the profile lane's read); a store without those reads leaves the base
// `behind`. The hold itself is written by the generations pass, never here: this file writes nothing.
//
// THE LATCH (PR C, Task 6). `latch` is the pass's `GenerationsDeps.latch`: the ladder's one delivery-facing raise
// (`overlordLadderRead.ts#raiseLatch`), which takes the cap from the cause row, raised by the renewal lane (`laneRaiser`). The
// lane decides when (`probesFailedTwiceOf`) and logs a refusal; this file only binds the raise and names the refusal's word.
import type { CcrcConfig } from '../config.js';
import type { FleetState } from '../fleetstate.js';
import { laneFactsOf, readLimits, type AccountLimits } from '../limits.js';
import { readSharesMeasured, type SharesRead } from '../shares.js';
import type { PoolAnswerRead } from '../poolrule.js';
import type { LaneFacts } from '../../../shared/serviceability.js';
import type { Candidates } from '../accountLoad.js';
import type { AccountFacts } from '../coord/overlordDesignation.js';
import { bodyRunner, ccdPoolAnswer } from '../coord/overlordBody.js';
import type { RunCcd } from '../coord/ports.js';
import { configDirFor } from '../configDir.js';
import type { IsolationReader } from '../isolationFacts.js';
import { measuredIdentity, type SessionRecord } from '../registry.js';
import { limiter } from '../bounded.js';
import type { FleetIO } from '../io.js';
import { GLOB_STAT_CONCURRENCY, uuidGlobPlaces, type ResolveOpts, type TranscriptResolution } from '../transcript/resolve.js';
import type { WatcherCoordPort } from '../coord/ports.js';
import type { Clock, Entropy } from '../time/ports.js';
import { familyClassOf } from '../../../shared/models.js';
import type { DesignationRead } from '../../../shared/overlord-designation.js';
import type { LadderLatchCause } from '../../../shared/overlord-ladder.js';
import type { BackstopRead } from '../../../shared/renewal-readings.js';
import type { OperatorModelStore } from '../operatorModel/store.js';
import { NO_LADDER_AUTHORITY } from '../coord/overlordAuthorityJournal.js';
import { raiseLatch } from '../coord/overlordLadderRead.js';
import { laneRaiser, type AuthorityAppender } from '../coord/overlordLadderStore.js';
import type { GenRow } from './continuityStore.js';
import { usageReading, type GenReadings } from './generationsLane.js';
import {
  backstopDueOf, classChangedOf, fittedCeilingOf, notLocalAskOf, notLocalOf, termRaisedOf, type AbsenceProbe, type Carrier, type SpotsRead, type TranscriptAsk,
  type W1Inputs,
} from './renewalReadings.js';
import { accountLoadMoveOf, accountLoadOf, accountOutsideSetOf, classUnservableOf, overlordCandidatesOf, unboundCandidates } from './renewalReadings.js';
import { modelDriftReadingOf, readersRunningReadingOf } from './renewalReadings.js';
import type { Reading } from './renewalDue.js';
import { buildsAgreeOf, overlordInstallBehindOf, startDigestDiffersOf } from './renewalReadings.js';
import { launchDigestOf } from './launchProfile.js';
import { inventoryBuildAgreement } from '../fleetstate.js';
import type { AccountHoldsRead } from '../../../shared/renewal-readings.js';

/** The store reads and the one write (the ladder's latch raise) the wiring makes, declared by this consumer. */
export interface ReadingsCoord extends Pick<WatcherCoordPort, 'closedSpotProbes' | 'backstopRead' | 'designationRead' | 'raiseLatch' | 'startById'> {
  /** PR E: door process B1's two reads, optional so that a store without them (a test, the simulator, an older wiring)
   *  leaves `modelDrift` and `readersRunning` at the lane's `W1`. */
  readonly modelSwitchesOf?: WatcherCoordPort['modelSwitchesOf'];
  readonly readerEventsOf?: WatcherCoordPort['readerEventsOf'];
  /** PR D: the central pool edges (designation A's ordered list reads them), optional so that a store without them leaves the
   *  account readings at the lane's `W1`. */
  readonly accountPoolEdges?: WatcherCoordPort['accountPoolEdges'];
  /** PR H: the standing account holds; absent, the account readings take `'not-wired'` and the list is unfiltered. */
  readonly accountHolds?: WatcherCoordPort['accountHolds'];
  /** PR H: the Overlord's newest start with its loads report, and the fleet's nodes for the build agreement; absent (either),
   *  the Overlord's `installBehind` is the gather's `behind`, as before. */
  readonly startLoadsOfNewestStart?: WatcherCoordPort['startLoadsOfNewestStart'];
  readonly nodes?: WatcherCoordPort['nodes'];
}

/** PR D: the account readings' three reads, each its producer's own reader. A test hands fakes; absent, the wiring builds them from
 *  `runCcd`, `io` and `cfg` (`accountReadsOf`), and with any of those absent the account readings keep the lane's `W1`. */
export interface AccountReads {
  /** `ccd pool-answer --session <id>`, parsed (`ccdPoolAnswer`). Never throws. */
  poolAnswer(sessionId: string): Promise<PoolAnswerRead>;
  limits(nowS: number): Promise<Record<string, AccountLimits>>;
  shares(): Promise<SharesRead>;
}

export interface ReadingsDeps {
  readonly time: { readonly clock: Pick<Clock, 'wall'>; readonly entropy: Pick<Entropy, 'hex'> };
  /** The authority journal the ladder's writers append to (`NO_LADDER_AUTHORITY` when none is configured, as the ladder's own
   *  doors take it). */
  readonly overlordAuthority?: AuthorityAppender;
  /** The Overlord's private store, for `turns` (`messagesSince`). Absent (no store open, a test): `turns` keeps its `W1`. */
  readonly operatorModel?: Pick<OperatorModelStore, 'messagesSince'>;
  /** Where a failed read is logged, once per reading per pass. Absent: `console.warn`. */
  readonly log?: (line: string) => void;
  /** The roster, for the session's own account's config dir (`configDirFor`). */
  readonly cfg?: CcrcConfig;
  /** The watcher's one memoized transcript resolver (`TranscriptResolver.resolve`), reading the host that runs the session.
   *  Absent, or `cfg` absent, `notLocal` is not answered and keeps the lane's `W1` (a producer not wired, never a default). */
  readonly transcript?: (o: ResolveOpts) => Promise<TranscriptResolution>;
  /** The fleet's IO, the watcher's own, for the measured search that confirms an absence (review 3718 F1, F3). Absent: an
   *  absence is never believed. */
  readonly io?: FleetIO;
  /** The isolation word's one reader; absent, the carrier reads unmeasured and so does `notLocal`. */
  readonly isolation?: Pick<IsolationReader, 'wakingHostKey'>;
  /** PR D: the account readings' reads; absent, built from the three below (`accountReadsOf`). */
  readonly accountReads?: AccountReads;
  /** The server's ccd runner and the fleet state whose caps `ccdCan` reads (the watcher's own), for the pool answer. */
  readonly runCcd?: RunCcd;
  readonly fleetState?: Pick<FleetState, 'ccdVerbs'>;
}

/** The account readings' reads from the watcher's own deps, or none when one is missing. */
function accountReadsOf(deps: ReadingsDeps): AccountReads | undefined {
  if (deps.accountReads !== undefined) return deps.accountReads;
  const { runCcd, io, cfg } = deps;
  if (runCcd === undefined || io === undefined || cfg === undefined) return undefined;
  const ran = bodyRunner(runCcd);
  return {
    poolAnswer: (id) => ccdPoolAnswer(ran, deps.fleetState, id),
    limits: (nowS) => readLimits(io, cfg, nowS),
    shares: () => readSharesMeasured(io, cfg.registryDir),
  };
}

/** The gather's port for one pass (`GatherPorts.w1`), and the pass's latch raise (`GenerationsDeps.latch`). */
export interface RenewalReadingsWiring {
  w1(g: GenRow, base: GenReadings): Promise<Pick<GenReadings, 'w1' | 'soft'>>;
  latch(cause: LadderLatchCause, detail: string): { readonly ok: true } | { readonly ok: false; readonly why: string };
}

/** The renewal lane, as the latch rows it raises record it. */
const RENEWAL_LANE = laneRaiser('renewal-lane');

/** The pass's readings port. `records` is the pass's registry listing, the array `sweepGenerations` hands the renewal act;
 *  `notLocal` reads the session's identity from it. One wiring per pass: its memo is the pass's. */
export function renewalReadingsOf(deps: ReadingsDeps, coord: ReadingsCoord, records: readonly SessionRecord[]): RenewalReadingsWiring {
  const log = deps.log ?? ((line: string) => console.warn(line));
  const logged = new Set<keyof W1Inputs>();
  const spotsByClass = new Map<string, SpotsRead>();
  let backstop: BackstopRead | undefined;
  let designation: DesignationRead | undefined;
  // PR H: the standing holds, once a pass; absent read: `'not-wired'`, and the facts' `held` names it unread (no filter).
  let holdsRead: AccountHoldsRead | 'not-wired' | undefined;
  const holdsOf = (): AccountHoldsRead | 'not-wired' => holdsRead ??= coord.accountHolds === undefined ? 'not-wired' : coord.accountHolds();

  /** A field whose read threw: unmeasured `<name> read failed`, logged once per pass (F17). */
  const failed = <K extends keyof W1Inputs>(out: Partial<W1Inputs>, key: K, name: string, e: unknown): void => {
    out[key] = { kind: 'unmeasured', why: `${name} read failed` } as W1Inputs[K];
    if (!logged.has(key)) {
      logged.add(key);
      log(`ccrc-server: generations: the ${name} read failed, so ${key} reads unmeasured this pass: ${e instanceof Error ? e.message : String(e)}`);
    }
  };
  /** One field, read and mapped inside its own catch (F17). */
  const field = <K extends keyof W1Inputs>(out: Partial<W1Inputs>, key: K, name: string, read: () => W1Inputs[K]): void => {
    try { out[key] = read(); } catch (e) { failed(out, key, name, e); }
  };
  const fieldAsync = async <K extends keyof W1Inputs>(out: Partial<W1Inputs>, key: K, name: string, read: () => Promise<W1Inputs[K]>): Promise<void> => {
    try { out[key] = await read(); } catch (e) { failed(out, key, name, e); }
  };

  const carrier = (): Carrier => deps.isolation?.wakingHostKey() ?? 'unmeasured';
  /** Every place the resolver's own-account search looks, each read with a measured read; `notLocalOf` decides what they mean. */
  const probe = async (io: FleetIO, configDir: string, uuid: string): Promise<AbsenceProbe> => {
    const { root, placesIn } = uuidGlobPlaces(configDir, uuid);
    const listing = await io.readdirMeasured(root);
    if (!listing.ok) return { listing: listing.reason, places: [] };
    const limit = limiter(GLOB_STAT_CONCURRENCY);
    const places = await Promise.all(placesIn(listing.entries).map((p) => limit(async () => {
      const st = await io.statMeasured(p);
      return st.ok ? 'present' as const : st.reason;
    })));
    return { listing: 'listed', places };
  };
  /** `notLocal` for one generation (PR B, Task 4): its start by id, then the resolver, bracketed by the carrier. Every input
   *  goes to `notLocalOf`, which decides; a start or identity this cannot read is an ask not made, with its reason. */
  const notLocal = async (g: GenRow, base: GenReadings, cfg: CcrcConfig, transcript: NonNullable<ReadingsDeps['transcript']>): Promise<W1Inputs['notLocal']> => {
    const start = coord.startById(g.startId);
    const decide = (ask: TranscriptAsk, before: Carrier = 'unmeasured', after: Carrier = 'unmeasured') =>
      notLocalOf({ ask, start, before, after, turn: base.turn, startReportedAt: g.startReportedAt });
    if (!start.ok || start.row === null) return decide({ kind: 'unread', why: 'no start to ask about' });
    const rec = records.find((r) => r.id === g.sessionId);
    const who = rec === undefined ? null : measuredIdentity(rec);
    const ask = notLocalAskOf({ startUuid: start.row.uuid, lane: g.lane,
      who: rec === undefined ? 'no-row' : who === null ? 'unmeasured' : { uuid: who.uuid, account: who.wrapper } });
    if (ask.kind === 'unread') return decide(ask);
    if (who === null) return decide({ kind: 'unread', why: 'identity unmeasured' });   // never: an unmeasured identity is not asked
    const configDir = configDirFor(cfg, ask.account);
    if (configDir === undefined) return decide({ kind: 'unread', why: 'no config dir' });
    const o: ResolveOpts = { configDir, dir: who.workdir, registryWorkdir: who.workdir, uuid: ask.uuid };
    const before = carrier();
    const answer = await transcript(o);
    const io = deps.io;
    const measured = answer.kind === 'fallback' && answer.complete && io !== undefined ? await probe(io, configDir, ask.uuid) : null;
    return decide({ kind: 'asked', answer, measured, observedAt: deps.time.clock.wall() }, before, carrier());
  };

  // PR D: the account facts and the candidates, once a pass; the pool answer, once a pass per session. Each a promise, so the
  // generations of one pass share one read, and a read that fails fails each field that awaits it, in that field's own catch.
  const reads = accountReadsOf(deps);
  let facts: Promise<AccountFacts> | undefined;
  let candidates: Promise<Candidates> | undefined;
  const poolAnswers = new Map<string, Promise<PoolAnswerRead>>();
  const factsOf = (r: AccountReads, edges: NonNullable<ReadingsCoord['accountPoolEdges']>): Promise<AccountFacts> => facts ??= (async () => {
    const nowS = Math.floor(deps.time.clock.wall() / 1000);
    const [limits, shares] = await Promise.all([r.limits(nowS), r.shares()]);
    const roster = deps.cfg?.roster;
    if (roster === undefined) throw new Error('no roster');
    const lanes: Record<string, LaneFacts> = {};
    for (const a of roster.accounts) lanes[a.id] = laneFactsOf(a, limits, shares);
    const h = holdsOf();
    return { roster, limits, edges: edges(), lanes, nowS, held: h === 'not-wired' ? { ok: false, detail: 'the holds are not wired' } : h };
  })();
  const candidatesOf = (f: AccountFacts): Promise<Candidates> => candidates ??= Promise.resolve(overlordCandidatesOf(designation ??= coord.designationRead(), f));
  const poolAnswerOf = (r: AccountReads, id: string): Promise<PoolAnswerRead> => {
    let p = poolAnswers.get(id);
    if (p === undefined) { p = r.poolAnswer(id); poolAnswers.set(id, p); }
    return p;
  };
  /** The three account readings of one Overlord generation (PR D, Task 7), each in its own catch. The designation first: when it
   *  answers alone (`unboundCandidates`), each mapper is handed that answer and nothing else is read. The pool answer is then
   *  `not-run`, as it was, and the facts unread; each mapper answers from the designation before it consults either. */
  const accountReadings = async (w1: Partial<W1Inputs>, g: GenRow, base: GenReadings, r: AccountReads,
    edges: NonNullable<ReadingsCoord['accountPoolEdges']>): Promise<void> => {
    const early = (): Candidates | null => unboundCandidates(designation ??= coord.designationRead(), g.sessionId);
    const live = async (): Promise<{ f: AccountFacts; c: Candidates }> => {
      const f = await factsOf(r, edges);
      return { f, c: await candidatesOf(f) };
    };
    const nowS = (): number => Math.floor(deps.time.clock.wall() / 1000);
    await fieldAsync(w1, 'accountOutsideSet', 'account set', async () => {
      const e = early();
      if (e !== null) return accountOutsideSetOf({ kind: 'not-run' }, e, 'not-wired');
      const [{ c }, answer] = await Promise.all([live(), poolAnswerOf(r, g.sessionId)]);
      return accountOutsideSetOf(answer, c, holdsOf());
    });
    await fieldAsync(w1, 'classUnservable', 'class serviceability', async () => {
      const e = early();
      if (e !== null) return classUnservableOf({ account: g.lane, model: g.model, own: undefined }, e, nowS());
      const { f, c } = await live();
      return classUnservableOf({ account: g.lane, model: g.model, own: g.lane === null ? undefined : f.lanes[g.lane] }, c, f.nowS);
    });
    await fieldAsync(w1, 'accountLoadMove', 'account load', async () => {
      const e = early();
      if (e !== null) return accountLoadMoveOf(accountLoadOf(g.lane, e, nowS()), base.turn);
      const { f, c } = await live();
      return accountLoadMoveOf(accountLoadOf(g.lane, c, f.nowS), base.turn);
    });
  };

  /** The soft `readersRunning` (PR E), read and mapped inside its own catch, as `field` reads a W1 field (F17). */
  let readersLogged = false;
  const readers = (read: () => Reading<number>): Reading<number> => {
    try { return read(); } catch (e) {
      if (!readersLogged) {
        readersLogged = true;
        log(`ccrc-server: generations: the readers read failed, so readersRunning reads unmeasured this pass: ${e instanceof Error ? e.message : String(e)}`);
      }
      return { kind: 'unmeasured', why: 'readers read failed' };
    }
  };

  return {
    w1: async (g, base) => {
      const w1: Partial<W1Inputs> = {};
      let soft: GenReadings['soft'];
      if (g.role === 'overlord') {
        field(w1, 'fittedCeilingTokens', 'fitted ceiling', () => {
          const cls = g.model === null ? null : familyClassOf(g.model);
          let spots: SpotsRead = { ok: true, spots: [] };
          if (cls !== null) {
            const held = spotsByClass.get(cls);
            spots = held ?? coord.closedSpotProbes(cls);
            if (held === undefined) spotsByClass.set(cls, spots);
          }
          return fittedCeilingOf(cls, usageReading(base, 'ctxWindow'), spots);
        });
        field(w1, 'backstopDue', 'backstop', () => {
          backstop ??= coord.backstopRead();
          return backstopDueOf(backstop, g.startReportedAt, deps.time.clock.wall());
        });
        field(w1, 'termRaised', 'designation', () => termRaisedOf(designation ??= coord.designationRead(), g));
        field(w1, 'classChanged', 'designation', () => classChangedOf(designation ??= coord.designationRead(), g));
        const store = deps.operatorModel;
        if (store !== undefined) field(w1, 'turns', 'turns', () => store.messagesSince(g.startReportedAt));
        // PR E: door process B1's two readings, each only where the store hands its read (absent: the lane's `W1`).
        // Bound to the store: on the composition `coord` is the coordination store, whose reads are methods (review 3710 F1).
        const modelSwitchesOf = coord.modelSwitchesOf?.bind(coord);
        const readerEventsOf = coord.readerEventsOf?.bind(coord);
        if (modelSwitchesOf !== undefined) field(w1, 'modelDrift', 'model drift', () => modelDriftReadingOf({
          startModel: g.model, startReportedAt: g.startReportedAt, switches: modelSwitchesOf(g.sessionId, g.startId), usage: base.usage }));
        if (readerEventsOf !== undefined) soft = { readersRunning: readers(() => readersRunningReadingOf(readerEventsOf(g.sessionId, g.startId), deps.time.clock.wall())) };
        // PR D: the account readings, only where the reads and the store's edges are wired (absent: the lane's `W1`).
        const edges = coord.accountPoolEdges?.bind(coord);
        if (reads !== undefined && edges !== undefined) await accountReadings(w1, g, base, reads, edges);
        // PR H: the digest reading folded into the Overlord's `installBehind` (question 5), where the store hands both reads.
        const newest = coord.startLoadsOfNewestStart?.bind(coord);
        const nodes = coord.nodes?.bind(coord);
        if (newest !== undefined && nodes !== undefined) field(w1, 'installBehind', 'install', () => overlordInstallBehindOf(base.behind,
          startDigestDiffersOf(newest(g.sessionId), launchDigestOf('overlord')), buildsAgreeOf(inventoryBuildAgreement({ nodes }))));
      }
      const { cfg, transcript } = deps;
      if (cfg !== undefined && transcript !== undefined) await fieldAsync(w1, 'notLocal', 'not-local', () => notLocal(g, base, cfg, transcript));
      return soft === undefined ? { w1 } : { w1, soft };
    },
    latch: (cause, detail) => {
      const r = raiseLatch({ coord, journal: deps.overlordAuthority ?? NO_LADDER_AUTHORITY, clock: deps.time.clock, entropy: deps.time.entropy },
        cause, detail, RENEWAL_LANE);
      return r.ok ? { ok: true } : { ok: false, why: 'error' in r ? r.error : r.reason };
    },
  };
}

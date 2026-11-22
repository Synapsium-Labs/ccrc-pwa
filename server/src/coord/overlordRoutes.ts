// The Overlord's designation doors (Overlord W1, designation A, plan Task 5, and designation C, Tasks 8 and 9; spec §3.1, §3.2
// C2, §3.4 C45, C46, C56). Ring L4, context C5: five routes, `GET /api/overlord/designation`, `POST /api/overlord/designate`,
// `DELETE /api/overlord/designate`, and the Settings doors `POST /api/overlord/model` and `POST /api/overlord/account-set`. Each is the operator's door, session-gated with NO box token (`OVERLORD_OPERATOR_DOORS`): it asks
// the account gate first (the two writes with a step-up), then runs its body on the coordination serialiser, reads its facts,
// asks its decider (`overlordDesignation.ts`, L1) and acts. The door decides nothing: every refusal word is a decider's, and the
// only tables here are the authority-error map and the order of the create's steps.
//
// THE CREATE'S ORDER (plan Task 5 with the 2026-11-16 rulings): `designatePending`, `body.ensureProject()`, `body.create(…)`
// (its route carries `class`, `profile` and `profiledigest`, never `poolset` or `acctorder`), `bindPendingGeneration`,
// `body.writeSet({poolset, acctorder})`, `body.keepAwake(id, 'on')`, then the first prompt. `acctorder` is written in the same
// act as keep-awake on, and a retire clears both (`drainOwedStops`). Any failure from `designatePending` on, a failed keep-awake
// included (slug `keep-awake-failure-fails-the-create`), records `create-failed`, owes the stop of whatever may exist, drains it
// (an `unknown` create answer is recorded owed and left undrained, review 2366 N2) and answers 502. A keep-awake that reports
// a FOREIGN marker (`kept-foreign`, rc 0) succeeds and raises one operator item that names it. A failed first prompt does not fail the door: the answer says `prompted: false` and the attempt stays pending.
//
// THE PORT. `OverlordBody` is declared here by its consumer; its adapter over ccd is a later task (`overlordBody.ts`), so a test
// hands a fake. No method throws: every failure is an answer.
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { BuildAgreement, RouteFields } from '../../../shared/api.js';
import { STATE_DEADLINE_S } from '../../../shared/continuity.js';
import {
  OVERLORD_PROJECT, parseAccountSetBody, parseDesignateBody, parseModelBody,
  type DesignateBody, type OverlordModelClass,
} from '../../../shared/overlord-designation.js';
import type { Roster } from '../../../shared/roster.js';
import { workspaceId } from '../../../shared/slug.js';
import type { AccountGate } from '../accounts/gate.js';
import type { CallerIdentity, ConsoleCaller, RecordedActor } from '../auth/callerIdentity.js';
import type { ActorFlags } from '../ccdargv.js';
import { launchDigestOf } from '../continuity/launchProfile.js';
import type { SessionHost } from '../continuity/sessionHost.js';
import { laneFactsOf, projectHome, type AccountLimits } from '../limits.js';
import { poolRostered, type parsePoolAnswer } from '../poolrule.js';
import { refuseRoute } from '../refuse.js';
import { shareFor, type SharesRead } from '../shares.js';
import type { Clock, Entropy } from '../time/ports.js';
import type { LaneFacts } from '../../../shared/serviceability.js';
import type { CoordStore } from './store.js';
import type { CoordRoutesHandle } from './routes.js';
import type { AuthorityAppendError } from './overlordAuthorityJournal.js';
import type { AuthorityState } from './overlordAuthorityCoherence.js';
import {
  accountSetStepUp, accountSetVerdict, designateVerdict, modelClassVerdict, modelStepUp, overlordAccounts, retireVerdict, routeOf,
  type AccountFacts,
} from './overlordDesignation.js';
import type { ActorRefused, AuthorityAppender, AuthorityRefused, RowUnreadable } from './overlordDesignationStore.js';
import { ladderRead, ladderWire, NO_WITNESS_YET, type LadderConditionInputs, type NarrowingWitness } from './overlordLadderRead.js';
import { isRung, isLadderCauseKey, type Rung } from '../../../shared/overlord-ladder.js';
import { rungMoveVerdict, narrowingState, type LadderWriterRefusal } from './overlordLadder.js';
import type { LadderWrite } from './overlordLadderStore.js';
import type { OverlordAuthorityExchange } from './overlordAuthorityExchange.js';

// ── the port ──────────────────────────────────────────────────────────────────────────────────────────────────────────

export type BodyAnswer = { ok: true } | { ok: false; detail: string };

/** What a stop answers: `absent` is no registry row for the id, which the drain reads as stopped. */
export type StopAnswer = { ok: true; absent: boolean } | { ok: false; detail: string };

/** `ccd keep-awake` answers `kept-foreign <marker>` with rc 0 when a marker someone else wrote stands: `ok` with each `foreign` marker named. A
 *  marker it cannot read, or a lost answer, is `ok: false`. */
export type KeepAwakeAnswer = { ok: true; foreign: readonly string[] } | { ok: false; detail: string };

/** What the create learned: the incarnation, or why not and whether ccd may have made the session. `unknown` is read as `yes`. */
export type CreateAnswer =
  | { ok: true; generation: string }
  | { ok: false; detail: string; created: 'yes' | 'no' | 'unknown' };

/** The Overlord's body, as the doors need it: every ccd call, behind one port (declared by its consumer; ring L2). */
export interface OverlordBody {
  /** `project-add --empty overlord` when the project is absent (a listing that fails is not "absent": it refuses). */
  ensureProject(): Promise<BodyAnswer>;
  /** `ws-add --title Overlord --wrapper <w> --route class=…,profile=overlord,profiledigest=… overlord <slug>`. */
  create(slug: string, id: string, wrapper: string, route: RouteFields, dec: ActorFlags | null): Promise<CreateAnswer>;
  /** `ccd route --session <id> --set poolset=… --set acctorder=…`; the empty values clear. */
  writeSet(id: string, set: { poolset: string; acctorder: string }): Promise<BodyAnswer>;
  /** `ccd route --session <id> --set class=…`: the model class Settings door's write (C45). */
  writeClass(id: string, cls: OverlordModelClass): Promise<BodyAnswer>;
  /** `profiledigest=` (an empty value clears it). */
  clearProfile(id: string): Promise<BodyAnswer>;
  /** `ccd pool-answer --session <id>`, parsed. */
  poolAnswer(id: string): Promise<ReturnType<typeof parsePoolAnswer>>;
  /** `ccd keep-awake --session <id> --state on|off`. */
  keepAwake(id: string, state: 'on' | 'off'): Promise<KeepAwakeAnswer>;
  /** The stop route's own path (`stopCreated`); never throws. */
  stop(id: string): Promise<StopAnswer>;
}

// ── the dependencies ──────────────────────────────────────────────────────────────────────────────────────────────────

/** The coordination store's members the doors call (one `Pick`, so a test hands the real store over an in-memory database). */
export type OverlordCoord = Pick<CoordStore,
  'designationRead' | 'designatePending' | 'bindPendingGeneration' | 'failPending' | 'retire' | 'stopDone'
  | 'raiseItem' | 'accountPoolEdges'
  | 'setModelClass' | 'setAccountSet'>;

export interface OverlordRouteDeps {
  /** The account gate (D-5511): its `actor` is the row's, recorded through `identity` (gates A). */
  readonly gate: AccountGate;
  /** The caller identity port (gates A, Q17): the gate's actor minted at `operator` strength, the one actor a writer takes. */
  readonly identity: Pick<CallerIdentity, 'operator' | 'console'>;
  /** The coordination serialiser: every write door's body runs inside it, so a designate and a retire never interleave. */
  readonly serial: CoordRoutesHandle['serial'];
  readonly coord: OverlordCoord;
  readonly ladder?: { readonly coord: Pick<CoordStore, 'ladderRows' | 'ladderRungRead' | 'setRung' | 'clearLatch'>; readonly inputs: LadderConditionInputs; readonly witness?: NarrowingWitness; readonly serverCaps: readonly string[]; readonly journal?: AuthorityAppender };
  /** The authority witness exchange's console arm (Overlord W1 authority journal, Task 6). Absent (a test, a script): the witness door answers 503. */
  readonly exchange?: Pick<OverlordAuthorityExchange, 'exchangeConsole'>;
  readonly consoleFacts?: (req: FastifyRequest) => { readonly armed: boolean; readonly device: string | null };
  /** The authority journal (`AuthorityAppender`), handed to the writers that append. */
  readonly journal: AuthorityAppender;
  readonly body: OverlordBody;
  /** The first prompt goes through the renewal lane's port (X4). */
  readonly host: Pick<SessionHost, 'deliver'>;
  readonly clock: Pick<Clock, 'wall'>;
  readonly entropy: Pick<Entropy, 'uuid' | 'hex'>;
  /** The actor flags `ws-add` declares, or null for a ccd that does not know them (`pwaDec(req)`). */
  readonly dec: (req: FastifyRequest) => ActorFlags | null;
  /** The facts the decider reads, each read at request time. */
  readonly facts: {
    /** The fleet state's `ccdVerbs`; null is no evidence. */
    readonly ccdWords: () => readonly string[] | null;
    /** `SERVER_CAPS`. */
    readonly serverWords: readonly string[];
    /** `fleetstate.ts#inventoryBuildAgreement`. */
    readonly builds: () => BuildAgreement;
    readonly roster: () => Roster;
    readonly limits: () => Promise<Record<string, AccountLimits>>;
    readonly shares: () => Promise<SharesRead>;
    /** The authority guard's state (review 2349 F9). `index.ts` wires the guard with the journal, so only a test server omits it. */
    readonly authority?: () => AuthorityState;
  };
}

/** What a server with no coordination store or no authority journal registers the doors over (a test server, a script): the doors
 *  still exist and still ask the gate first, and every read answers `unmeasured`, which each door refuses as `unavailable` before
 *  any writer is reached. A writer here is unreachable and throws if a later change reaches it; the journal refuses every append. */
const unreachable = (): never => { throw new Error('the Overlord designation store is absent: no door reaches a writer'); };
export const NO_OVERLORD_STORE: { readonly coord: OverlordCoord; readonly journal: AuthorityAppender } = {
  coord: {
    designationRead: () => ({ kind: 'unmeasured', why: 'this server has no coordination store or authority journal' }),
    accountPoolEdges: () => new Map(),
    designatePending: unreachable, bindPendingGeneration: unreachable, failPending: unreachable, retire: unreachable,
    stopDone: unreachable, raiseItem: unreachable,
    setModelClass: unreachable, setAccountSet: unreachable,
  },
  journal: { appendInTx: () => ({ ok: false, error: 'authority-unmeasured', detail: 'this server has no authority journal' }) },
};

// ── tables ────────────────────────────────────────────────────────────────────────────────────────────────────────────

/** The pending attempt's deadline, set once at the create (plan question 5, slug `pending-deadline-covers-the-first-turn`):
 *  derived from the continuity states a healthy first start passes through, never a new literal. */
const PENDING_DEADLINE_MS = (STATE_DEADLINE_S.clearing + STATE_DEADLINE_S.carded + STATE_DEADLINE_S.probing) * 1000;

/** How a refused authority append reaches the wire (X2): the rolled-back word as itself, every other error, `bad-entry` and
 *  `authority-unmeasured` included, as `journal-unreadable`. A table, so a new error word is a compile error here. */
const AUTHORITY_REFUSAL: Readonly<Record<AuthorityAppendError, 'authority-rolled-back' | 'journal-unreadable'>> = {
  'authority-rolled-back': 'authority-rolled-back',
  'authority-unmeasured': 'journal-unreadable',
  'bad-entry': 'journal-unreadable',
  'not-in-transaction': 'journal-unreadable',
  'journal-append': 'journal-unreadable',
};

const LADDER_AUTHORITY_REFUSAL: Readonly<Record<AuthorityAppendError | LadderWriterRefusal, 'authority-rolled-back' | 'journal-unreadable' | 'unavailable'>> = {
  'row-changed': 'unavailable',
  'authority-rolled-back': 'authority-rolled-back', 'authority-unmeasured': 'authority-rolled-back',
  'bad-entry': 'journal-unreadable', 'not-in-transaction': 'journal-unreadable', 'journal-append': 'journal-unreadable',
};
const RUNG_REFUSAL_DETAIL = {
  'capability-missing': (v: Extract<ReturnType<typeof rungMoveVerdict>, { kind: 'refuse' }>) => ({ detail: `the rung needs ${'needs' in v ? v.needs : ''}`, ...('needs' in v ? { needs: v.needs } : {}) }),
  unavailable: () => ({ detail: "the operator's rung could not be read: only off lands" }),
};
const UNREADABLE = 'the designation row could not be read';

/** What a row writer refuses with: the journal's refusal, a row it cannot narrow, or a row that already holds an attempt. */
type Failure = AuthorityRefused | RowUnreadable | ActorRefused | { readonly ok: false; readonly reason: 'exists' | 'not-found' };

// ── the drain ─────────────────────────────────────────────────────────────────────────────────────────────────────────

/** What a drain did: the ids stopped (an absent one included) and the ids that stay owed. */
export interface DrainResult { readonly stopped: readonly string[]; readonly owed: readonly string[] }

/** The one drain (review 2349 F5, F6; review 2366 N1): for each id, put the markers off FIRST, clear the set and the profile
 *  digest only when that succeeded, then ALWAYS stop. An `ok` stop, or `absent`, after an `off` that succeeded ends with
 *  `stopDone(id)`. A failed `off` leaves the id owed with its `poolset` and `acctorder` in place, so a later drain retries `off`,
 *  but the body is still stopped; a failed stop leaves the id owed too. `stopped` is the ids this call stopped and cleared. The
 *  route clears are best effort: a stopped body's route record is inert, and an owed id is stopped again by the next drain.
 *  `unrecorded` (review 2366 N4) names ids no row owes: a failure on one is logged as the residual it is, never as owed. */
export async function drainOwedStops(
  deps: Pick<OverlordRouteDeps, 'body' | 'coord'>, ids: readonly string[], unrecorded: ReadonlySet<string> = new Set(),
): Promise<DrainResult> {
  const stopped: string[] = [];
  const owed: string[] = [];
  for (const id of [...new Set(ids)]) {
    const off = await deps.body.keepAwake(id, 'off');
    if (off.ok) {
      await deps.body.writeSet(id, { poolset: '', acctorder: '' });
      await deps.body.clearProfile(id);
    }
    const s = await deps.body.stop(id);
    if (s.ok && off.ok) { deps.coord.stopDone(id); stopped.push(id); continue; }
    const why = off.ok ? `could not be stopped: ${s.ok ? '' : s.detail}` : `kept its keep-awake markers${s.ok ? ' (stopped)' : ''}: ${off.detail}`;
    if (unrecorded.has(id)) {
      console.warn(`ccrc-server: the Overlord's body ${id} ${why}; no row owes it, the pending row still names it and the next retire stops it`);
      continue;
    }
    owed.push(id);
    console.warn(`ccrc-server: the Overlord's body ${id} ${why}; it stays owed`);
  }
  return { stopped, owed };
}

// ── the routes ────────────────────────────────────────────────────────────────────────────────────────────────────────

export function registerOverlordRoutes(app: FastifyInstance, deps: OverlordRouteDeps): void {
  const { coord, body, facts } = deps;
  /** Eight lowercase hex characters from the entropy port: the workspace slug. */
  const shortId = (): string => deps.entropy.uuid().slice(0, 8);
  /** An authority record's operation key, minted by the door (X2). */
  const opKeyOf = (door: 'designate' | 'retire' | 'model' | 'account-set'): string => `${door}-${deps.entropy.hex(16)}`;

  /** Everything `overlordAccounts` and the placement read, once per request. A read that throws is the caller's 503, never an
   *  empty list. */
  async function accountFactsOf(): Promise<AccountFacts & { shares: SharesRead }> {
    const roster = facts.roster();
    const [limits, shares] = await Promise.all([facts.limits(), facts.shares()]);
    const edges = coord.accountPoolEdges();
    const lanes: Record<string, LaneFacts> = {};
    for (const a of roster.accounts) lanes[a.id] = laneFactsOf(a, limits, shares);
    return { roster, limits, edges, lanes, nowS: Math.floor(deps.clock.wall() / 1000), shares };
  }

  const authorityRefusal = (reply: FastifyReply, f: { authority: AuthorityAppendError; detail: string }): FastifyReply =>
    refuseRoute(reply, AUTHORITY_REFUSAL[f.authority], { detail: f.detail });

  /** A writer's refusal as the wire answers it: the authority map, the row it cannot narrow, or the attempt it did not find. */
  const writerRefusal = (reply: FastifyReply, r: Failure): FastifyReply => {
    if ('authority' in r) return authorityRefusal(reply, r);
    if (r.reason === 'exists') return refuseRoute(reply, 'overlord-exists', { detail: 'an Overlord is already designated or being started' });
    if (r.reason === 'actor') return refuseRoute(reply, 'internal', { detail: 'the door handed the writer an actor the identity port did not mint' });
    if (r.reason === 'not-found') return refuseRoute(reply, 'not-found', { detail: 'no Overlord designation row' });
    return refuseRoute(reply, 'unavailable', { detail: UNREADABLE });
  };

  const warnFail = (id: string, err: unknown): void =>
    console.warn(`ccrc-server: the failed Overlord attempt ${id} could not be written: ${err instanceof Error ? err.message : String(err)}`);

  // GET: the row's view, the C56 list and the counted accounts under the row's set and class, and `unknown-pool` warnings.
  app.get('/api/overlord/designation', async (req, reply) => {
    if (!deps.gate(req, reply, { cap: null }).pass) return reply;
    const read = coord.designationRead();
    if (read.kind === 'unmeasured') return refuseRoute(reply, 'unavailable', { detail: UNREADABLE });
    const row = read.row;
    if (row === null) return { ok: true, designation: null };
    try {
      const f = await accountFactsOf();
      const accounts = overlordAccounts(row.accountPools, row.model, f);
      const warnings = row.accountPools.pools.filter((p) => !poolRostered(f.roster, p)).map((pool) => ({ warning: 'unknown-pool' as const, pool }));
      return { ok: true, designation: row, accounts, warnings };
    } catch (err) {
      return refuseRoute(reply, 'unavailable', { detail: err instanceof Error ? err.message : String(err) });
    }
  });

  // POST: Start the Overlord.
  app.post('/api/overlord/designate', async (req, reply) => {
    const g = deps.gate(req, reply, { cap: null, stepUp: true });
    if (!g.pass) return reply;
    const parsed = parseDesignateBody(req.body);
    if (parsed === null) return refuseRoute(reply, 'bad-request', { detail: 'body' });
    const actor = deps.identity.operator(g.actor);
    const dec = deps.dec(req);
    return deps.serial(() => designate(reply, parsed, actor, dec));
  });

  async function designate(reply: FastifyReply, parsed: DesignateBody, actor: RecordedActor, dec: ActorFlags | null): Promise<FastifyReply | Record<string, unknown>> {
    // A re-designate over a retired row journals both records as narrowings while the journal is not coherent, and builds a body
    // that cannot go live: refuse before any row write or ccd call (review 2349 F9).
    const auth = facts.authority?.() ?? { kind: 'coherent' };
    if (auth.kind === 'rolled-back') return refuseRoute(reply, 'authority-rolled-back', { detail: `the authority journal reads rolled-back: ${auth.cause}` });
    if (auth.kind === 'unmeasured') return refuseRoute(reply, 'journal-unreadable', { detail: `the authority journal reads unmeasured: ${auth.why}` });
    const slug = shortId();
    const id = workspaceId(OVERLORD_PROJECT, slug);
    // The probe asks about the id the door will create (plan question 2): no session exists yet, and the agent's answer to the
    // verb, `no such session` included, is what says the word is present.
    const probe = await body.poolAnswer(id);
    let verdict: ReturnType<typeof designateVerdict>;
    try {
      const f = await accountFactsOf();
      const set = { state: 'set', set: parsed.accountPools } as const;
      verdict = designateVerdict({
        read: coord.designationRead(), ccdWords: facts.ccdWords(), serverWords: facts.serverWords, builds: facts.builds(), probe,
        model: parsed.model, accountPools: parsed.accountPools, accounts: f,
        home: projectHome(f.roster, f.limits, set, f.edges, parsed.model, f.shares, f.nowS),
      });
    } catch (err) {
      return refuseRoute(reply, 'unavailable', { detail: err instanceof Error ? err.message : String(err) });
    }
    if (verdict.act === 'unmeasured') return refuseRoute(reply, 'unavailable', { detail: UNREADABLE });
    if (verdict.act === 'refuse-input') return refuseRoute(reply, 'bad-request', { detail: 'accountPools' });
    if (verdict.act === 'refuse') {
      return refuseRoute(reply, verdict.word, {
        detail: verdict.detail, ...(verdict.needs === undefined ? {} : { needs: verdict.needs }),
        ...(verdict.count === undefined ? {} : { count: verdict.count }),
      });
    }

    const at = deps.clock.wall();
    const deadlineAt = at + PENDING_DEADLINE_MS;
    const pending = coord.designatePending(deps.journal, {
      sessionId: id, deadlineAt, model: parsed.model, accountPools: parsed.accountPools, actor, at, opKey: opKeyOf('designate'),
    });
    if (!pending.ok) return writerRefusal(reply, pending);

    /** Any failure after the row is written ends the attempt: record it, owe the stop of what may exist, drain, answer 502. The
     *  id is stopped even when the row no longer names it (a retire that ran between the steps), so nothing runs with no row.
     *  `owes` is whether ccd may have made the body: `yes`, `no`, or `unknown` (a lost `ws-add` answer re-measured absent). */
    const fail = async (detail: string, owes: 'yes' | 'no' | 'unknown'): Promise<FastifyReply> => {
      // A `failPending` that throws (a busy database) must not skip the drain: the pending row then stands and the id is drained
      // from here, and a stop that fails retries the write once so the id lands on `stopsOwed` (review 2349 F7).
      // An `unknown` id is recorded owed and NEVER drained in this call (review 2366 N2, the Global Constraint): ccd may still be
      // making it, so a stop answering `absent` now would clear a debt that is still real. A later drain (a DELETE, the next
      // designate, or designation B's deadline sweep, which re-drains `stopsOwed`) finds it absent or stops it.
      // A `failPending` that answers `unmeasured` recorded nothing (review 2366 N4, a residual): the pending row still names the
      // id and the next retire stops it, so a failure here is not logged as owed.
      let written = true;
      let recorded = true;
      try { recorded = coord.failPending(id, 'create-failed', deps.clock.wall(), owes !== 'no').ok; } catch (err) { written = false; warnFail(id, err); }
      if (owes === 'unknown' && !written) {
        try { coord.failPending(id, 'create-failed', deps.clock.wall(), true); } catch (err) { warnFail(id, err); }
      }
      const standing = coord.designationRead();
      const owed = standing.kind === 'unmeasured' || standing.row === null ? [] : standing.row.stopsOwed;
      const mine = owes === 'yes' || (owes === 'no' && !written) ? [id] : [];
      const ids = [...mine, ...owed].filter((x) => owes !== 'unknown' || x !== id);
      const drained = await drainOwedStops(deps, ids, recorded ? new Set() : new Set([id]));
      if (!written && owes !== 'unknown' && drained.owed.includes(id)) {
        try { coord.failPending(id, 'create-failed', deps.clock.wall(), true); } catch (err) { warnFail(id, err); }
      }
      return refuseRoute(reply, 'fleetFailed', { detail, sessionId: id });
    };

    const project = await body.ensureProject();
    if (!project.ok) return fail(project.detail, 'no');
    const route: RouteFields = { class: parsed.model, profile: 'overlord', profiledigest: launchDigestOf('overlord') };
    const made = await body.create(slug, id, verdict.wrapper, route, dec);
    if (!made.ok) return fail(made.detail, made.created);
    const bound = coord.bindPendingGeneration(id, made.generation, deps.clock.wall());
    if (!bound.ok) return fail(bound.reason === 'unmeasured' ? bound.detail : `the attempt is no longer pending (${bound.reason})`, 'yes');
    const set = await body.writeSet(id, { poolset: verdict.poolset, acctorder: verdict.acctorder });
    if (!set.ok) return fail(set.detail, 'yes');
    const awake = await body.keepAwake(id, 'on');
    if (!awake.ok) return fail(awake.detail, 'yes');
    if (awake.foreign.length > 0) raiseForeignMarker(id, awake.foreign);
    const sent = await deps.host.deliver(id, 'overlord-first-prompt');

    const f = await accountFactsOf().catch(() => null);
    const warnings = f === null ? [] : parsed.accountPools.pools.filter((p) => !poolRostered(f.roster, p)).map((pool) => ({ warning: 'unknown-pool' as const, pool }));
    return { ok: true, state: 'pending', sessionId: id, deadlineAt, warnings, awake: true, prompted: sent.kind === 'sent' };
  }

  /** A marker someone else wrote (`.no-hibernate`, `.no-roll` or both) stands on the new body: it keeps working, and ONE item names
   *  each foreign marker (review 2349 F8). */
  function raiseForeignMarker(id: string, markers: readonly string[]): void {
    try {
      coord.raiseItem({
        program: OVERLORD_PROJECT, runId: null, raisedBy: 'ccrc', kind: 'do',
        title: `The new Overlord body ${id} carries a keep-awake marker ccrc did not write`,
        why: `Starting the Overlord asked for its keep-awake marker, and ccd found one it did not write (${markers.join(', ')}). The Overlord is running; `
          + 'the marker is left where it is.',
        how: ['Look at who put the marker there.', 'Remove it if it is not wanted: the Overlord is kept awake by its own marker.'],
        options: null, neededBy: 'soon', soonLabel: 'keep awake', secretSlot: null,
      }, deps.clock.wall(), 'ccrc');
    } catch (err) {
      console.warn(`ccrc-server: the foreign keep-awake marker on ${id} could not be raised as an item: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  // DELETE: retire. Question 8's three cases, then the drain of everything owed (a row that binds nothing drains too).
  app.delete('/api/overlord/designate', async (req, reply) => {
    const g = deps.gate(req, reply, { cap: null, stepUp: true });
    if (!g.pass) return reply;
    const actor = deps.identity.operator(g.actor);
    return deps.serial(async () => {
      const verdict = retireVerdict(coord.designationRead());
      if (verdict.act === 'unmeasured') return refuseRoute(reply, 'unavailable', { detail: UNREADABLE });
      if (verdict.act === 'none') {
        // Nothing to retire writes nothing, but a stop an earlier attempt still owes is drained here (review F5).
        const standing = coord.designationRead();
        const owedIds = standing.kind === 'unmeasured' || standing.row === null ? [] : standing.row.stopsOwed;
        if (owedIds.length === 0) return { ok: true, changed: false };
        return { ok: true, changed: false, ...(await drainOwedStops(deps, owedIds)) };
      }
      const at = deps.clock.wall();
      const r = coord.retire(deps.journal, { actor, at, opKey: opKeyOf('retire') });
      if (!r.ok) return writerRefusal(reply, r);
      if (!r.changed) return { ok: true, changed: false };
      const standing = coord.designationRead();
      const owedIds = standing.kind === 'unmeasured' || standing.row === null ? r.owed : standing.row.stopsOwed;
      const drained = await drainOwedStops(deps, owedIds);
      return { ok: true, changed: true, term: r.term, stopped: drained.stopped, owed: drained.owed };
    });
  });

  app.get('/api/overlord/ladder', async (_req, reply) => {
    const ladder = deps.ladder;
    if (ladder === undefined) return refuseRoute(reply, 'unavailable', { detail: 'the ladder could not be read' });
    const read = ladderRead(ladder.coord, ladder.inputs, ladder.witness ?? NO_WITNESS_YET, ladder.serverCaps);
    if (read.kind === 'unmeasured') return refuseRoute(reply, 'unavailable', { detail: 'the ladder could not be read' });
    return ladderWire(read, ladder.serverCaps);
  });

  // The ladder's operator doors share the serialiser and the store used by its read.
  const ladderUnavailable = (reply: FastifyReply): FastifyReply => refuseRoute(reply, 'unavailable', { detail: 'the ladder could not be read' });
  const ladderRefusal = (reply: FastifyReply, result: Extract<LadderWrite, { ok: false }>): FastifyReply => {
    if ('reason' in result) return refuseRoute(reply, 'internal', { detail: 'the door handed the writer an actor the identity port did not mint' });
    const state = facts.authority?.();
    const detail = state?.kind === 'rolled-back' ? state.cause : state?.kind === 'unmeasured' ? state.why : result.error;
    return refuseRoute(reply, LADDER_AUTHORITY_REFUSAL[result.error], { detail });
  };
  const measuredLadder = (ladder: NonNullable<OverlordRouteDeps['ladder']>): boolean =>
    ladderRead(ladder.coord, ladder.inputs, ladder.witness ?? NO_WITNESS_YET, ladder.serverCaps).kind === 'measured';
  const moveRung = (req: FastifyRequest, reply: FastifyReply, ask: { kind: 'set'; to: Rung } | { kind: 'pause' }) => deps.serial(async () => {
    const ladder = deps.ladder;
    if (ladder === undefined) return ladderUnavailable(reply);
    const current = ladder.coord.ladderRungRead();
    if (current.kind === 'unmeasured') return ladderUnavailable(reply);
    const verdict = rungMoveVerdict(current.current, ask, ladder.serverCaps);
    if (verdict.kind === 'same') return { ok: true, changed: false, rung: verdict.rung };
    if (verdict.kind === 'refuse') return refuseRoute(reply, verdict.word, RUNG_REFUSAL_DETAIL[verdict.word](verdict));
    let actor: RecordedActor | ConsoleCaller;
    if (verdict.kind === 'raise') {
      const g = deps.gate(req, reply, { cap: null, stepUp: true });
      if (!g.pass) return reply;
      actor = deps.identity.operator(g.actor);
      if (!measuredLadder(ladder)) return ladderUnavailable(reply);
    } else {
      if (deps.consoleFacts === undefined) return ladderUnavailable(reply);
      const facts = deps.consoleFacts(req);
      actor = deps.identity.console(facts.armed, facts.device);
    }
    // W1 Pause and off change only the rung. W2 cancels undelivered mail/kickoffs and nudges,
    // moves requests to needs-you and settles pending acts; W3 releases holds with one push.
    const result = ladder.coord.setRung(ladder.journal ?? deps.journal, { from: verdict.from, to: verdict.to, actor, at: deps.clock.wall(), opKey: `rung-${deps.entropy.hex(16)}` });
    if (!result.ok) return ladderRefusal(reply, result);
    if (!result.changed) return { ok: true, changed: false, rung: verdict.to };
    let held: 'held' | 'not-yet' | 'unmeasured' = 'not-yet';
    if (verdict.kind === 'lower' && result.recordSequence !== null) {
      try { held = (ladder.witness ?? NO_WITNESS_YET).heldFor(result.recordSequence); } catch { held = 'unmeasured'; }
    }
    return { ...result, rung: verdict.to, narrowing: verdict.kind === 'lower' ? narrowingState(result.recordSequence, held) : null };
  });
  // POST: the console's witness exchange (Overlord W1 authority journal, Task 6, §7.6). Session-gated through the account gate with no
  // step-up and no box token, so it refuses `auth-off` while sign-in is dark (no Overlord without sign-in). The body is `{ held }`: the
  // tuple the console keeps, or null. It answers the current tuple to keep; the exchange judges what the console held. A narrowing-free
  // read of the server's facts: nothing here decides, and a tuple that does not parse is the exchange's `malformed`, never a 400.
  app.post('/api/overlord/witness', async (req, reply) => {
    const g = deps.gate(req, reply, { cap: null });
    if (!g.pass) return reply;
    const b = req.body;
    const shaped = typeof b === 'object' && b !== null && !Array.isArray(b) && Object.keys(b).length === 1 && 'held' in b
      && ((b as { held: unknown }).held === null || (typeof (b as { held: unknown }).held === 'object' && !Array.isArray((b as { held: unknown }).held)));
    if (!shaped) return refuseRoute(reply, 'bad-request', { detail: 'body' });
    const answer = deps.exchange?.exchangeConsole(g.actor.toString(), (b as { held: unknown }).held);
    if (answer === undefined) return refuseRoute(reply, 'authority-rolled-back', { cause: 'unmeasured: exchange' });
    if (answer.kind === 'unmeasured') return refuseRoute(reply, 'authority-rolled-back', { cause: `unmeasured: ${answer.why}` });
    return { offer: answer.tuple };
  });

  app.post('/api/overlord/rung', async (req, reply) => {
    const body = req.body as { rung?: unknown } | null;
    if (body === null || typeof body !== 'object' || !isRung(body.rung)) return refuseRoute(reply, 'bad-request', { detail: 'rung' });
    return moveRung(req, reply, { kind: 'set', to: body.rung });
  });
  app.post('/api/overlord/pause', async (req, reply) => moveRung(req, reply, { kind: 'pause' }));
  app.post('/api/overlord/latches/:cause/clear', async (req, reply) => {
    const { cause } = req.params as { cause: string };
    if (!isLadderCauseKey(cause)) return refuseRoute(reply, 'bad-request', { detail: 'cause' });
    const g = deps.gate(req, reply, { cap: null, stepUp: true });
    if (!g.pass) return reply;
    return deps.serial(async () => {
      const ladder = deps.ladder;
      if (ladder === undefined || !measuredLadder(ladder)) return ladderUnavailable(reply);
      const result = ladder.coord.clearLatch(ladder.journal ?? deps.journal, { cause, actor: deps.identity.operator(g.actor), at: deps.clock.wall(), opKey: `latch-clear-${deps.entropy.hex(16)}` });
      if (!result.ok) return ladderRefusal(reply, result);
      return result;
    });
  });

  // ── the Settings doors (designation C, plan Tasks 8 and 9) ──────────────────────────────────────────────────────────

  /** Each body the row names takes the write; one that fails is reported (`route: 'failed'`), never fatal: the row is the fact.
   *  Nothing on this tip rewrites the route record after a failed write. Designation B's write-set step (plan Task 10) is to
   *  rewrite `class`, `poolset` and `acctorder` from the row before every renewal (C44: the change lands at the next renewal);
   *  the Overlord cannot go Live before B lands, so the gap has no live window (review 2410 F1, carried to designation B). */
  async function writeEach(ids: readonly string[], write: (id: string) => Promise<{ ok: true } | { ok: false; detail: string }>) {
    const written: ({ sessionId: string; ok: true } | { sessionId: string; ok: false; detail: string })[] = [];
    for (const sessionId of ids) {
      const w = await write(sessionId);
      written.push(w.ok ? { sessionId, ok: true } : { sessionId, ok: false, detail: w.detail });
    }
    return written;
  }

  // POST: the model class (C45). `fable` asks the step-up, `opus` none (§11.2); the class rides one route write per body.
  app.post('/api/overlord/model', async (req, reply) => {
    const model = parseModelBody(req.body);
    const g = deps.gate(req, reply, { cap: null, stepUp: model === null || modelStepUp(model) });
    if (!g.pass) return reply;
    if (model === null) return refuseRoute(reply, 'bad-request', { detail: 'body' });
    const actor = deps.identity.operator(g.actor);
    return deps.serial(async () => {
      let f: AccountFacts;
      try { f = await accountFactsOf(); } catch (err) {
        return refuseRoute(reply, 'unavailable', { detail: err instanceof Error ? err.message : String(err) });
      }
      const v = modelClassVerdict(coord.designationRead(), model, f);
      if (v.act === 'unmeasured') return refuseRoute(reply, 'unavailable', { detail: UNREADABLE });
      if (v.act === 'not-found') return refuseRoute(reply, 'not-found', { detail: 'no Overlord designation row' });
      if (v.act === 'refuse') return refuseRoute(reply, v.word, { detail: v.detail, count: v.count });
      if (v.act === 'none') return { ok: true, changed: false, model };
      const r = coord.setModelClass(deps.journal, { model, actor, at: deps.clock.wall(), opKey: opKeyOf('model') });
      if (!r.ok) return writerRefusal(reply, r);
      if (!r.changed) return { ok: true, changed: false, model };
      const written = await writeEach(v.bodies, (id) => body.writeClass(id, model));
      return { ok: true, changed: true, model, journalled: r.journalled, warnings: v.warnings, route: routeOf(written), written };
    });
  });

  // POST: the account set (C46, C56). A widening asks the step-up, a narrowing or a reorder none; the decider re-checks it on the
  // serialiser against the row it reads there.
  app.post('/api/overlord/account-set', async (req, reply) => {
    const next = parseAccountSetBody(req.body);
    // The row is read before the gate only to choose the step-up; `stepped` is what the gate was asked, and nothing else.
    const stepped = next === null || accountSetStepUp(coord.designationRead(), next);
    const g = deps.gate(req, reply, { cap: null, stepUp: stepped });
    if (!g.pass) return reply;
    if (next === null) return refuseRoute(reply, 'bad-request', { detail: 'body' });
    const actor = deps.identity.operator(g.actor);
    return deps.serial(async () => {
      let f: AccountFacts;
      try { f = await accountFactsOf(); } catch (err) {
        return refuseRoute(reply, 'unavailable', { detail: err instanceof Error ? err.message : String(err) });
      }
      const v = accountSetVerdict(coord.designationRead(), next, f, stepped);
      if (v.act === 'unmeasured') return refuseRoute(reply, 'unavailable', { detail: UNREADABLE });
      if (v.act === 'not-found') return refuseRoute(reply, 'not-found', { detail: 'no Overlord designation row' });
      if (v.act === 'refuse-input') return refuseRoute(reply, 'bad-request', { detail: 'accountPools' });
      if (v.act === 'refuse') return refuseRoute(reply, v.word, { detail: v.detail, ...(v.count === undefined ? {} : { count: v.count }) });
      const answer = { accountPools: next, accounts: v.accounts, warnings: v.warnings, orgSpread: v.orgSpread };
      if (v.act === 'none') return { ok: true, changed: false, ...answer };
      const r = coord.setAccountSet(deps.journal, { accountPools: next, actor, at: deps.clock.wall(), opKey: opKeyOf('account-set') });
      if (!r.ok) return writerRefusal(reply, r);
      if (!r.changed) return { ok: true, changed: false, ...answer };
      const written = await writeEach(v.bodies, (id) => body.writeSet(id, { poolset: v.poolset, acctorder: v.acctorder }));
      return { ok: true, changed: true, journalled: r.journalled, ...answer, route: routeOf(written), written };
    });
  });
}

// The act rows' store (Overlord spec §10.1, C25, H24, H27; plan `docs/superpowers/plans/2026-11-16-overlord-w2/w2-act-rows.md`
// Tasks A2, A3 and A6's count reader). Ring L3, context C5: the one owner of the SQL of `overlord_acts`. It decides nothing:
// `./overlordActs.ts` (L1) and `./overlordActCeiling.ts` (L1) answer every rule, and this file reads the facts they ask for and
// writes what they answered.
//
// DECIDE, APPEND, APPLY (§4.3; the coordinator's item 2). Each writer reads every fact inside the caller's `BEGIN IMMEDIATE` and
// asks its decider: a refusal writes nothing and reserves no id. On a pass it hands the act journal its records and, as the
// journal's apply, the row and the `act` line. The apply re-reads the facts, re-asks the decider and THROWS if the answer
// differs: inside the journal's call that is a failure after the append (the journal tells its guard `trailing`), and inside
// the caller's transaction it rolls everything back. It is a programming error, never a refusal word: `DatabaseSync` is
// synchronous, so what the plan read is still true when the apply runs.
//
// NO PRODUCTION CALLER YET (the coordinator's item 3). `ActJournalPort` is declared here by its consumer and implemented by the
// act journal (act journal A), which wires the writer. Until then the writers have no caller outside this file and the tests
// (`overlord-act-writers.test.ts` pins it), and the tests bind the port to a double. The count reader IS wired: gate step 10
// reads it (`overlordCeilingWiring.ts`).
//
// NO OPERATOR WORDS. The row keeps ids, kinds and states, and the Overlord's own `summary` and `why`, masked by the egress
// profile and cut whole. The journal's records carry ids, kinds and states only.
import type { DatabaseSync } from 'node:sqlite';
import { ACT_CEILING_WINDOW_MS, OVERLORD_ACT_KINDS, type CeilingGroup, type OverlordActKind, type RungCellWord } from '../../../shared/overlord.js';
import {
  ACT_LANE_STATES, ACT_SUMMARY_MAX, ACT_WHY_MAX, isActTargetRefKind,
  type ActAnswer, type ActMover, type ActTarget, type ActTargetRef,
} from '../../../shared/overlordActs.js';
import type { CallerStrength } from '../../../shared/overlord-identity.js';
import { isRecordedActor } from '../auth/attributionIdentity.js';
import type { RecordedActor } from '../auth/callerIdentity.js';
import { actCeilingStep, type GroupCount } from './overlordActCeiling.js';
import type { ActCountReader } from './overlordGateRun.js';
import {
  actNaturalKey, actSettleVerdict, actWriteVerdict, groupKinds, nextActId, recordNatural, sortedTargets, writeCountGroups,
  writeRecords, type ActJournalRecord, type ActNaturalKey, type ActRecordBody, type ActSettleRefusal, type ActWriteRefusal,
} from './overlordActs.js';
import { redactCommand } from './redact.js';
import { cutWhole } from './reviewcap.js';
import { stampSequenceInTx } from './overlordSequenceStore.js';

// ---------------------------------------------------------------------------------------------------------------------- the port

/** L2, declared here by its consumer (§4.3, F12). The act journal implements it. It appends the records inside the caller's
 *  `tx()`, then runs `apply` (the row and the act line), as `journalKernel.ts#appendThenApply` does. A throw from `apply` after the
 *  append is told to the journal's guard as `trailing` at once and answered `journal-append`. Never throws. */
export interface ActJournalPort {
  appendInTx(db: DatabaseSync, records: readonly ActJournalRecord[], apply: () => void): ActJournalAppend;
}
export type ActJournalAppend =
  | { readonly ok: true }
  | { readonly ok: false; readonly error: 'not-in-transaction' | 'authority-rolled-back' | 'authority-unmeasured' | 'journal-append'; readonly detail: string };

// --------------------------------------------------------------------------------------------------------------------- the input

/** The facts the write's allow carries (the coordinator's item 1): the act, its effect, the target programme and its
 *  incarnation, the natural key, the rung cell and the generation the allow was minted for. A local structural type, consumed by
 *  nothing in this part: the may-act decider's part replaces it with its own allow type and adds the checks (slug
 *  `allow-is-a-structural-type-until-the-decider`). The row stores `effect` and `programme` from it. */
export interface ActAllowFacts {
  readonly act: OverlordActKind; readonly effect: string | null; readonly programme: string | null;
  readonly incarnation: string | null; readonly naturalKey: string; readonly cell: RungCellWord; readonly generationId: number;
}

/** One act to write (the plan's `ActWrite`). */
export interface ActWrite {
  readonly allow: ActAllowFacts;
  readonly kind: OverlordActKind; readonly state: 'pending' | 'done'; readonly target: ActTarget;
  readonly targets: readonly ActTargetRef[]; readonly requestId: number | null;
  /** Set exactly when the allow's effect is `widen-scope`, naming its target (F1); the may-act decider's part checks that. */
  readonly widens: { readonly programme: string } | null;
  /** The open door's new request id: an `act-open-request` record follows the first. */
  readonly opens: number | null;
  readonly summary: string; readonly why: string; readonly authority: string;
  readonly actor: RecordedActor; readonly identityStrength: CallerStrength; readonly isolation: string;
  readonly fence: { readonly term: number; readonly generationId: number; readonly model: string | null; readonly lane: string | null };
  readonly op: { readonly key: string; readonly door: string; readonly callSha256: string; readonly sessionId: string };
  /** The decision-model answers, canonical JSON text in a later piece; opaque here. */
  readonly checks: readonly unknown[];
  /** The act journal's highest act id, or null until act journal B supplies it. */
  readonly journalHighest: number | null;
}

export type ActWritten =
  | { readonly ok: true; readonly act: ActAnswer; readonly seq: number }
  | { readonly ok: false; readonly error: 'natural-key-taken' | 'op-key-taken'; readonly detail: string; readonly holder: ActAnswer }
  | { readonly ok: false; readonly error: 'act-ceiling'; readonly detail: string; readonly group: CeilingGroup }
  | { readonly ok: false; readonly error: Exclude<ActWriteRefusal, 'natural-key-taken' | 'op-key-taken' | 'act-ceiling'>; readonly detail: string };
type JournalFailure = Extract<ActJournalAppend, { ok: false }>['error'];
export type ActSettled =
  | { readonly ok: true; readonly act: ActAnswer; readonly seq: number }
  | { readonly ok: false; readonly error: ActSettleRefusal | 'unmeasured' | JournalFailure; readonly detail: string };

// -------------------------------------------------------------------------------------------------------------------- the reads

/** A read that could not be made answers why, never an empty value (the plan's "no overloaded null"). */
export type ActRead<T> = { readonly kind: 'measured'; readonly value: T } | { readonly kind: 'unmeasured'; readonly why: string };

const errText = (e: unknown): string => (e instanceof Error ? e.message : String(e));
const inTx = (db: DatabaseSync): boolean => { try { return db.isTransaction; } catch { return false; } };
const num = (v: unknown): number | null => (typeof v === 'number' && Number.isSafeInteger(v) ? v : typeof v === 'bigint' ? Number(v) : null);
const str = (v: unknown): string | null => (typeof v === 'string' ? v : null);
const read = <T>(f: () => T): ActRead<T> => { try { return { kind: 'measured', value: f() }; } catch (e) { return { kind: 'unmeasured', why: errText(e) }; } };

/** A stored targets text, read back; an unreadable entry is dropped from the projection, never invented. */
function targetsOf(v: unknown): readonly ActTargetRef[] {
  try {
    const raw: unknown = typeof v === 'string' ? JSON.parse(v) : [];
    return Array.isArray(raw) ? raw.filter((t): t is ActTargetRef => typeof t === 'object' && t !== null && isActTargetRefKind((t as ActTargetRef).kind)
      && typeof (t as ActTargetRef).id === 'string' && Number.isSafeInteger((t as ActTargetRef).revision)) : [];
  } catch { return []; }
}
const ANSWER_COLS = 'id, kind, state, outcome, naturalKey, targets, requestId';
function answerOf(r: Record<string, unknown>): ActAnswer {
  return { id: num(r.id) ?? 0, kind: str(r.kind) ?? '', state: str(r.state) ?? '', outcome: str(r.outcome), naturalKey: str(r.naturalKey) ?? '',
    targets: targetsOf(r.targets), requestId: num(r.requestId) };
}

/** One act by its id: `absent` when no row has it. */
export function actById(db: DatabaseSync, id: number): ActRead<ActAnswer | 'absent'> {
  return read(() => { const r = db.prepare(`SELECT ${ANSWER_COLS} FROM overlord_acts WHERE id = ?`).get(id) as Record<string, unknown> | undefined;
    return r === undefined ? 'absent' : answerOf(r); });
}
/** The act an operation key names in one session's generation, or `null` (question 1). */
export function actByOpKey(db: DatabaseSync, sessionId: string, generationId: number, key: string): ActRead<ActAnswer | null> {
  return read(() => { const r = db.prepare(`SELECT ${ANSWER_COLS} FROM overlord_acts WHERE opSessionId = ? AND opGenerationId = ? AND opKey = ?`)
    .get(sessionId, generationId, key) as Record<string, unknown> | undefined; return r === undefined ? null : answerOf(r); });
}
/** The live act holding a natural key (not settled `refused`), or `null`. */
export function actByNaturalKey(db: DatabaseSync, key: string): ActRead<ActAnswer | null> {
  return read(() => { const r = db.prepare(`SELECT ${ANSWER_COLS} FROM overlord_acts WHERE naturalKey = ? AND state <> 'refused'`)
    .get(key) as Record<string, unknown> | undefined; return r === undefined ? null : answerOf(r); });
}
/** Every row the settling lane re-measures (`pending` and `unknown`), oldest first. */
export function openActs(db: DatabaseSync): ActRead<readonly ActAnswer[]> {
  const marks = ACT_LANE_STATES.map(() => '?').join(', ');
  return read(() => (db.prepare(`SELECT ${ANSWER_COLS} FROM overlord_acts WHERE state IN (${marks}) ORDER BY id`).all(...ACT_LANE_STATES) as Record<string, unknown>[]).map(answerOf));
}
/** The table's highest id, `null` for an empty table. */
export function highestActId(db: DatabaseSync): ActRead<number | null> {
  return read(() => num((db.prepare('SELECT max(id) AS m FROM overlord_acts').get() as { m: unknown }).m));
}

/** Act catalogue A's `ActCountReader` over `overlord_acts` (F6): rows at or after `since`, not settled `refused`, whose kind OR
 *  effect counts in the group, in all and, when a programme is named, for that programme. An overturned row counts (§10.3). It
 *  reads in whatever transaction its caller holds, or in none (gate step 10 reads it outside one), and a failed read answers
 *  `unmeasured`, never a zero. */
export function actCountReader(db: DatabaseSync): ActCountReader {
  return {
    count(group: CeilingGroup, programme: string | null, since: number): GroupCount {
      try {
        const kinds = groupKinds(group);
        if (kinds.length === 0) return { kind: 'counted', programme: programme === null ? null : 0, all: 0 };
        const marks = kinds.map(() => '?').join(', ');
        const where = `state <> 'refused' AND at >= ? AND (kind IN (${marks}) OR effect IN (${marks}))`;
        const all = num((db.prepare(`SELECT count(*) AS n FROM overlord_acts WHERE ${where}`).get(since, ...kinds, ...kinds) as { n: unknown }).n);
        const mine = programme === null ? null
          : num((db.prepare(`SELECT count(*) AS n FROM overlord_acts WHERE ${where} AND programme = ?`).get(since, ...kinds, ...kinds, programme) as { n: unknown }).n);
        if (all === null || (programme !== null && mine === null)) return { kind: 'unmeasured', why: 'a count read back no integer' };
        return { kind: 'counted', programme: mine, all };
      } catch (e) {
        return { kind: 'unmeasured', why: errText(e) };
      }
    },
  };
}

// -------------------------------------------------------------------------------------------------------------------- the write

const OP_KEY = /^[0-9a-f]{32}$/;
const isCount = (n: unknown): boolean => typeof n === 'number' && Number.isSafeInteger(n) && n >= 0;
const isText = (s: unknown): boolean => typeof s === 'string' && s !== '';

/** The input's shape: the first field out of shape, or `null`. */
function writeFault(w: ActWrite): string | null {
  if (!isRecordedActor(w.actor)) return 'actor';
  if (w.allow === null || typeof w.allow !== 'object' || w.allow.act !== w.kind) return 'allow';
  if (!OP_KEY.test(w.op.key)) return 'op.key';
  if (!isText(w.op.door) || !isText(w.op.callSha256) || !isText(w.op.sessionId)) return 'op';
  if (!isCount(w.fence.term) || !isCount(w.fence.generationId)) return 'fence';
  if (w.requestId !== null && !isCount(w.requestId)) return 'requestId';
  if (w.opens !== null && !isCount(w.opens)) return 'opens';
  if (!Array.isArray(w.targets) || !w.targets.every((t) => isActTargetRefKind(t.kind) && isText(t.id) && isCount(t.revision))) return 'targets';
  if (typeof w.summary !== 'string' || typeof w.why !== 'string' || !isText(w.authority) || !isText(w.isolation)) return 'text';
  if (w.widens !== null && !isText(w.widens.programme)) return 'widens';
  if (!Array.isArray(w.checks)) return 'checks';
  return null;
}

interface WritePlan {
  readonly w: ActWrite; readonly at: number; readonly id: number; readonly natural: ActNaturalKey;
  readonly summary: string; readonly why: string; readonly records: readonly ActJournalRecord[];
}
type WritePlanAnswer = { readonly ok: true; readonly plan: WritePlan } | Exclude<ActWritten, { ok: true }>;

const holderOf = (r: ActRead<ActAnswer | null>): ActAnswer | null | { readonly unmeasured: string } =>
  r.kind === 'unmeasured' ? { unmeasured: r.why } : r.value;

/** Read-only, inside the caller's `tx()`: every fact the write decides from, and the decider's answer (§4.3). */
function planWrite(db: DatabaseSync, w: ActWrite, at: number): WritePlanAnswer {
  const inTransaction = inTx(db);
  const natural = actNaturalKey(w.kind, w.target);
  const fault = writeFault(w);
  const shapeOk = inTransaction && natural !== null && fault === null;
  const opKeyHolder = shapeOk ? holderOf(actByOpKey(db, w.op.sessionId, w.fence.generationId, w.op.key)) : null;
  const naturalKeyHolder = shapeOk && natural !== null ? holderOf(actByNaturalKey(db, natural.key)) : null;
  const groups = writeCountGroups(w.kind, w.allow?.effect ?? null);
  const reader = actCountReader(db);
  const since = at - ACT_CEILING_WINDOW_MS;
  const programme = w.allow?.programme ?? null;
  const ceiling = shapeOk ? actCeilingStep(w.kind, w.allow.effect, {
    act: groups.act === null ? 'not-asked' : reader.count(groups.act, programme, since),
    effect: groups.effect === null ? 'not-asked' : reader.count(groups.effect, programme, since),
  }) : { pass: true as const };
  const v = actWriteVerdict({ inTransaction, state: w.state, natural, fault, opKeyHolder, naturalKeyHolder, ceiling });
  if (!v.ok) return v;
  const highest = highestActId(db);
  if (highest.kind === 'unmeasured') return { ok: false, error: 'unmeasured', detail: `highest act id: ${highest.why}` };
  const id = nextActId(highest.value, w.journalHighest);
  const body: ActRecordBody = {
    opKey: w.op.key, actId: id, act: w.kind, effect: w.allow.effect, natural: recordNatural(natural!), targets: sortedTargets(w.targets),
    requestId: w.requestId, authority: w.authority, term: w.fence.term, generationId: w.fence.generationId,
    actor: { kind: w.actor.kind, subject: w.actor.subject }, identityStrength: w.identityStrength, isolation: w.isolation,
  };
  return { ok: true, plan: { w, at, id, natural: natural!, summary: cutWhole(redactCommand(w.summary), ACT_SUMMARY_MAX),
    why: cutWhole(redactCommand(w.why), ACT_WHY_MAX), records: writeRecords(body, w.state, w.opens) } };
}

const ROW_COLS = 'id, at, sequence, kind, effect, requestId, targets, programme, naturalKey, naturalKind, naturalId, naturalRevision, '
  + 'widens, widenedProgramme, summary, why, authority, reversibility, state, term, generationId, model, lane, actorKind, '
  + 'actorSubject, actorIssuer, identityStrength, isolation, opKey, opDoor, opCallSha256, opSessionId, opGenerationId, checks';

/** The journal's apply: the plan re-made and compared, then the act line and the row with the reserved id. Throws when the plan
 *  no longer holds, or when the line is refused. */
function applyWrite(db: DatabaseSync, plan: WritePlan): number {
  const again = planWrite(db, plan.w, plan.at);
  if (!again.ok || again.plan.id !== plan.id || again.plan.natural.key !== plan.natural.key) {
    throw new Error(`act write apply disagrees with its plan (${again.ok ? 'id or key' : again.error})`);
  }
  const { w, at, id, natural } = plan;
  const seq = stampActLine(db, id, w.state, w.actor.subject, w.actor.kind, at);
  db.prepare(`INSERT INTO overlord_acts (${ROW_COLS}) VALUES (${ROW_COLS.split(', ').map(() => '?').join(', ')})`).run(
    id, at, seq, w.kind, w.allow.effect, w.requestId, JSON.stringify(sortedTargets(w.targets)), w.allow.programme, natural.key, natural.kind,
    natural.id, natural.revision, w.widens === null ? 0 : 1, w.widens?.programme ?? null, plan.summary, plan.why, w.authority,
    OVERLORD_ACT_KINDS[w.kind].reversibility, w.state, w.fence.term, w.fence.generationId, w.fence.model, w.fence.lane, w.actor.kind,
    w.actor.subject, w.actor.issuer, w.identityStrength, w.isolation, w.op.key, w.op.door, w.op.callSha256, w.op.sessionId,
    w.fence.generationId, JSON.stringify(w.checks));
  return seq;
}

/** THE one writer of an act row's insert (§4.3): decide, then the journal's records, then, as the journal's apply, the act line
 *  and the row. A refusal before the append writes nothing and reserves no id. Never throws. */
export function writeActInTx(db: DatabaseSync, journal: ActJournalPort, w: ActWrite, at: number): ActWritten {
  let p: WritePlanAnswer;
  try { p = planWrite(db, w, at); } catch (e) { return { ok: false, error: 'bad-row', detail: errText(e) }; }
  if (!p.ok) return p;
  const plan = p.plan;
  let seq = 0;
  let appended: ActJournalAppend;
  try { appended = journal.appendInTx(db, plan.records, () => { seq = undoable(db, () => applyWrite(db, plan)); }); } catch (e) {
    appended = { ok: false, error: 'journal-append', detail: errText(e) };
  }
  if (!appended.ok) return { ok: false, error: appended.error, detail: appended.detail };
  const act = actById(db, plan.id);
  if (act.kind === 'unmeasured' || act.value === 'absent') return { ok: false, error: 'journal-append', detail: `act ${plan.id} not read back` };
  return { ok: true, act: act.value, seq };
}

// -------------------------------------------------------------------------------------------------------------------- the settle

interface SettlePlan { readonly id: number; readonly to: 'done' | 'refused' | 'unknown'; readonly by: ActMover; readonly at: number; readonly record: ActJournalRecord }
type SettlePlanAnswer = { readonly ok: true; readonly plan: SettlePlan } | { readonly ok: false; readonly error: ActSettleRefusal | 'unmeasured'; readonly detail: string };

function planSettle(db: DatabaseSync, id: number, to: 'done' | 'refused' | 'unknown', by: ActMover, at: number): SettlePlanAnswer {
  const inTransaction = inTx(db);
  let r: Record<string, unknown> | undefined;
  if (inTransaction) {
    try { r = db.prepare(`SELECT ${ROW_COLS} FROM overlord_acts WHERE id = ?`).get(id) as Record<string, unknown> | undefined; } catch (e) {
      return { ok: false, error: 'unmeasured', detail: errText(e) };
    }
  }
  const v = actSettleVerdict({ inTransaction, stored: r === undefined ? 'absent' : str(r.state) ?? '', to, by });
  if (!v.ok) return v;
  const row = r!;
  const natural = actNaturalKey(str(row.kind) ?? '', str(row.naturalKind) === 'start'
    ? { kind: 'start', requestId: num(row.naturalId) ?? -1 }
    : { kind: (str(row.naturalKind) ?? '') as Exclude<ActTarget['kind'], 'start'>, id: num(row.naturalId) ?? -1, revision: num(row.naturalRevision) ?? -1 });
  if (natural === null) return { ok: false, error: 'bad-row', detail: 'the stored natural key reads back no target' };
  const body: ActRecordBody = {
    opKey: str(row.opKey) ?? '', actId: id, act: str(row.kind) ?? '', effect: str(row.effect), natural: recordNatural(natural),
    targets: sortedTargets(targetsOf(row.targets)), requestId: num(row.requestId), authority: str(row.authority) ?? '',
    term: num(row.term) ?? 0, generationId: num(row.generationId) ?? 0,
    actor: { kind: str(row.actorKind) ?? '', subject: str(row.actorSubject) ?? '' }, identityStrength: str(row.identityStrength) ?? '',
    isolation: str(row.isolation) ?? '',
  };
  return { ok: true, plan: { id, to, by, at, record: { kind: 'act-settle', from: v.from, to, ...body } } };
}

/** The journal's apply of a settle: the plan re-made and compared, then the act line and the state. Throws when the plan no longer
 *  holds, or when the line is refused. The door's second step is the act's own actor's move; the lane and the boot pass are the
 *  server's. */
function applySettle(db: DatabaseSync, plan: SettlePlan): number {
  const again = planSettle(db, plan.id, plan.to, plan.by, plan.at);
  if (!again.ok || again.plan.record.kind !== 'act-settle' || plan.record.kind !== 'act-settle' || again.plan.record.from !== plan.record.from) {
    throw new Error(`act settle apply disagrees with its plan (${again.ok ? 'from' : again.error})`);
  }
  const a = plan.record.actor;
  const own = plan.by === 'door' && (a.kind === 'session' || a.kind === 'operator');
  const seq = stampActLine(db, plan.id, plan.to, own ? a.subject : 'server', own ? a.kind as 'session' | 'operator' : 'server', plan.at);
  db.prepare('UPDATE overlord_acts SET state = ? WHERE id = ?').run(plan.to, plan.id);
  return seq;
}

/** THE one writer of an act row's state after its insert (§4.3): the door's second step, the lane and the boot pass.
 *  `ACT_TRANSITIONS` checked against the row read in this transaction, then the journal's `act-settle` carrying that `from`, then,
 *  as the apply, the state and the act line. Never throws. */
export function settleActInTx(db: DatabaseSync, journal: ActJournalPort, id: number, to: 'done' | 'refused' | 'unknown',
  by: 'door' | 'lane' | 'boot', at: number): ActSettled {
  let p: SettlePlanAnswer;
  try { p = planSettle(db, id, to, by, at); } catch (e) { return { ok: false, error: 'bad-row', detail: errText(e) }; }
  if (!p.ok) return p;
  const plan = p.plan;
  let seq = 0;
  let appended: ActJournalAppend;
  try {
    appended = journal.appendInTx(db, [plan.record], () => { seq = undoable(db, () => applySettle(db, plan)); });
  } catch (e) {
    appended = { ok: false, error: 'journal-append', detail: errText(e) };
  }
  if (!appended.ok) return { ok: false, error: appended.error, detail: appended.detail };
  const act = actById(db, id);
  if (act.kind === 'unmeasured' || act.value === 'absent') return { ok: false, error: 'journal-append', detail: `act ${id} not read back` };
  return { ok: true, act: act.value, seq };
}

/** An apply that leaves nothing behind when it throws: a savepoint inside the caller's transaction, rolled back to on the throw,
 *  which is then rethrown to the journal (so the act line of a row whose insert failed never commits without its row). */
function undoable<T>(db: DatabaseSync, fn: () => T): T {
  db.exec('SAVEPOINT overlord_act_apply');
  try {
    const r = fn();
    db.exec('RELEASE overlord_act_apply');
    return r;
  } catch (e) {
    db.exec('ROLLBACK TO overlord_act_apply');
    db.exec('RELEASE overlord_act_apply');
    throw e;
  }
}

// ---------------------------------------------------------------------------------------------------------------------- the line

/** The `act` kind's stamp: the writer's answer checked, and a refusal thrown so the row rolls back with the line. */
function stampActLine(db: DatabaseSync, id: number, state: string, actor: string, actorKind: 'operator' | 'session' | 'server', at: number): number {
  const s = stampSequenceInTx(db, { kind: 'act', id: String(id), state, actor, actorKind, at });
  if (!s.ok) throw new Error(`act line refused: ${s.error}: ${s.detail}`);
  return s.seq;
}

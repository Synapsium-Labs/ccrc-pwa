// The act row's deciders' cases (Overlord W2, act rows A, Tasks A2 and A3). Written ONCE here, as suite cases over a module:
// `overlord-acts.test.ts` runs them against the real module, and `sim/overlordActsSets.ts` runs them against each textual mutant
// (the every-run floors of D-8217). The expectations are spelled out here, independently of the module's own lists. Review 4205
// added two more modules' cases at the end, over fixture databases in temp dirs (never the live HOME): the store's two applies,
// run by `overlord-acts-store.test.ts`, and the ceiling latch's standing read, run by `overlord-ceiling-wiring.test.ts`.
import { expect } from 'vitest';
import path from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
import type { ActAnswer } from '../../shared/overlordActs.js';
import type { LadderLatchCause } from '../../shared/overlord-ladder.js';
import { openCoordDb } from '../src/coord/db.js';
import { CoordStore } from '../src/coord/store.js';
import { tx } from '../src/coord/tx.js';
import { attributionIdentity, serverActorOf } from '../src/auth/attributionIdentity.js';
import type { RecordedActor } from '../src/auth/callerIdentity.js';
import { gateActorOf } from '../src/accounts/audit.js';
import { NO_LADDER_AUTHORITY } from '../src/coord/overlordAuthorityJournal.js';
import { raiseLatch } from '../src/coord/overlordLadderRead.js';
import { ACT_CEILING_LATCH } from '../src/coord/overlordActCeiling.js';
import type { ActJournalPort, ActWrite } from '../src/coord/overlordActsStore.js';
import type { SuiteCase } from './sim/mutate.js';
import { mkTmp } from './tmpHelpers.js';

export type ActsModule = typeof import('../src/coord/overlordActs.js');
type M = ActsModule;
type Facts = Parameters<M['actWriteVerdict']>[0];

const holder = (id: number): ActAnswer => ({ id, kind: 'relay', state: 'done', outcome: null, naturalKey: 'k', targets: [], requestId: null });
const PASS = { pass: true } as const;
const facts = (m: M, over: Partial<Facts> = {}): Facts => ({
  inTransaction: true, state: 'done', natural: m.actNaturalKey('relay', { kind: 'request', id: 7, revision: 2 }), fault: null,
  opKeyHolder: null, naturalKeyHolder: null, ceiling: PASS, ...over,
});
const errorOf = (v: ReturnType<M['actWriteVerdict']>): string => (v.ok ? 'ok' : v.error);

export function actNaturalKeyCases(m: M): Record<string, SuiteCase> {
  const key = (act: string, kind: 'message' | 'delivery' | 'request' | 'note', id: number, revision: number) => m.actNaturalKey(act, { kind, id, revision })?.key;
  return {
    'the act kind, the target kind, its id and its revision each change the key': () => {
      const base = key('relay', 'request', 7, 2);
      expect(base).toBe('["relay","request",7,2]');
      expect(key('escalate-request', 'request', 7, 2)).not.toBe(base);
      expect(key('relay', 'message', 7, 2)).not.toBe(base);
      expect(key('relay', 'request', 8, 2)).not.toBe(base);
      expect(key('relay', 'request', 7, 3)).not.toBe(base);
    },
    'the three parts are kept beside the text': () => {
      expect(m.actNaturalKey('acknowledge', { kind: 'delivery', id: 41, revision: 0 }))
        .toEqual({ key: '["acknowledge","delivery",41,0]', kind: 'delivery', id: 41, revision: 0 });
    },
    'a start is keyed by its request alone, so two starts on one request share it': () => {
      const a = m.actNaturalKey('start-programme', { kind: 'start', requestId: 12 });
      expect(a).toEqual({ key: '["start",12]', kind: 'start', id: 12, revision: 0 });
      expect(m.actNaturalKey('rekick-coordinator', { kind: 'start', requestId: 12 })?.key).toBe(a?.key);
      expect(m.actNaturalKey('start-programme', { kind: 'start', requestId: 13 })?.key).not.toBe(a?.key);
      expect(key('start-programme', 'request', 12, 0)).not.toBe(a?.key);
    },
    'the text is canonical: the order of the target\'s keys cannot change it': () => {
      const a = m.actNaturalKey('relay', { kind: 'request', id: 7, revision: 2 });
      const b = m.actNaturalKey('relay', JSON.parse('{"revision":2,"id":7,"kind":"request"}'));
      expect(b?.key).toBe(a?.key);
    },
    'a target with no key answers null: a bad id, a bad revision, a kind no list has': () => {
      expect(key('relay', 'request', -1, 0)).toBeUndefined();
      expect(key('relay', 'request', 1.5, 0)).toBeUndefined();
      expect(key('relay', 'request', 7, -1)).toBeUndefined();
      expect(key('relay', 'request', 7, Number.NaN)).toBeUndefined();
      expect(m.actNaturalKey('relay', JSON.parse('{"kind":"programme","id":1,"revision":0}'))).toBeNull();
      expect(m.actNaturalKey('start-programme', { kind: 'start', requestId: -3 })).toBeNull();
      expect(key('acknowledge', 'message', 0, 0)).toBe('["acknowledge","message",0,0]');
    },
  };
}

export function nextActIdCases(m: M): Record<string, SuiteCase> {
  return {
    'one past the larger of the store\'s highest and the journal\'s': () => {
      expect(m.nextActId(null, null)).toBe(1);
      expect(m.nextActId(4, null)).toBe(5);
      expect(m.nextActId(null, 9)).toBe(10);
      expect(m.nextActId(4, 9)).toBe(10);
      expect(m.nextActId(12, 9)).toBe(13);
      expect(m.nextActId(3, 3)).toBe(4);
    },
  };
}

export function actWriteVerdictCases(m: M): Record<string, SuiteCase> {
  return {
    'outside a transaction: not-in-transaction, whatever else is wrong': () => {
      expect(errorOf(m.actWriteVerdict(facts(m, { inTransaction: false, state: 'x', natural: null, fault: 'f', opKeyHolder: holder(1) })))).toBe('not-in-transaction');
    },
    'the door enters pending and done only': () => {
      for (const s of ['pending', 'done']) expect(m.actWriteVerdict(facts(m, { state: s })), s).toEqual({ ok: true });
      for (const s of ['refused', 'unknown', 'staged', 'shadow', 'effective', 'settled', '']) {
        expect(m.actWriteVerdict(facts(m, { state: s })), s).toEqual({ ok: false, error: 'bad-row', detail: `state ${s}` });
      }
    },
    'a target with no key, then a field out of shape, is bad-row, before any key is read': () => {
      expect(m.actWriteVerdict(facts(m, { natural: null, fault: 'op.key', opKeyHolder: holder(1) }))).toEqual({ ok: false, error: 'bad-row', detail: 'target' });
      expect(m.actWriteVerdict(facts(m, { fault: 'op.key', opKeyHolder: holder(1) }))).toEqual({ ok: false, error: 'bad-row', detail: 'op.key' });
    },
    'the operation key is read before the natural key: its holder is the replay': () => {
      expect(m.actWriteVerdict(facts(m, { opKeyHolder: holder(3), naturalKeyHolder: holder(4) })))
        .toEqual({ ok: false, error: 'op-key-taken', detail: 'act 3', holder: holder(3) });
      expect(m.actWriteVerdict(facts(m, { opKeyHolder: { unmeasured: 'disk' }, naturalKeyHolder: holder(4) })))
        .toEqual({ ok: false, error: 'unmeasured', detail: 'operation key: disk' });
    },
    'the natural key\'s holder refuses natural-key-taken, and an unread key is unmeasured': () => {
      expect(m.actWriteVerdict(facts(m, { naturalKeyHolder: holder(4) }))).toEqual({ ok: false, error: 'natural-key-taken', detail: 'act 4', holder: holder(4) });
      expect(m.actWriteVerdict(facts(m, { naturalKeyHolder: { unmeasured: 'locked' } }))).toEqual({ ok: false, error: 'unmeasured', detail: 'natural key: locked' });
    },
    'the keys are read before the ceilings': () => {
      const over = { pass: false, word: 'act-ceiling', group: 'relay', scope: 'all', limit: 30, latch: 'act-ceiling-hit' } as const;
      expect(errorOf(m.actWriteVerdict(facts(m, { naturalKeyHolder: holder(4), ceiling: over })))).toBe('natural-key-taken');
      expect(errorOf(m.actWriteVerdict(facts(m, { opKeyHolder: holder(4), ceiling: over })))).toBe('op-key-taken');
    },
    'a ceiling refusal is act-ceiling naming its group, and an unavailable count is unmeasured, never a pass': () => {
      expect(m.actWriteVerdict(facts(m, { ceiling: { pass: false, word: 'act-ceiling', group: 'o3-effect', scope: 'programme', limit: 1, latch: 'act-ceiling-hit' } })))
        .toEqual({ ok: false, error: 'act-ceiling', detail: 'o3-effect programme 1', group: 'o3-effect' });
      expect(m.actWriteVerdict(facts(m, { ceiling: { pass: false, word: 'unavailable', group: 'relay', why: 'not-wired', latch: null } })))
        .toEqual({ ok: false, error: 'unmeasured', detail: 'count relay: not-wired' });
    },
    'every fact clear: a pass': () => {
      expect(m.actWriteVerdict(facts(m))).toEqual({ ok: true });
    },
  };
}

export function actSettleVerdictCases(m: M): Record<string, SuiteCase> {
  const v = (stored: string, to: string, by: 'door' | 'lane' | 'boot', inTransaction = true) => m.actSettleVerdict({ inTransaction, stored, to, by });
  return {
    'outside a transaction: not-in-transaction; no row: not-found': () => {
      expect(v('pending', 'done', 'door', false)).toEqual({ ok: false, error: 'not-in-transaction', detail: 'an act is settled only inside the transaction that holds its row' });
      expect(m.actSettleVerdict({ inTransaction: true, stored: 'absent', to: 'done', by: 'lane' })).toEqual({ ok: false, error: 'not-found', detail: 'no row' });
    },
    'pending settles to done, refused and unknown by the door, the lane and the boot pass, from pending': () => {
      for (const by of ['door', 'lane', 'boot'] as const) for (const to of ['done', 'refused', 'unknown']) {
        expect(v('pending', to, by), `${to} by ${by}`).toEqual({ ok: true, from: 'pending' });
      }
    },
    'unknown leaves by a measurement only: the lane and the boot pass, never the door': () => {
      for (const to of ['done', 'refused']) {
        expect(v('unknown', to, 'lane')).toEqual({ ok: true, from: 'unknown' });
        expect(v('unknown', to, 'boot')).toEqual({ ok: true, from: 'unknown' });
        expect(v('unknown', to, 'door')).toEqual({ ok: false, error: 'bad-row', detail: `unknown -> ${to} by door` });
      }
      expect(v('unknown', 'unknown', 'lane').ok).toBe(false);
    },
    'a terminal row, a stored word this build lacks and a target state outside the table move nowhere': () => {
      for (const [s, t] of [['done', 'refused'], ['refused', 'done'], ['shadow', 'done'], ['settled', 'done'], ['pending', 'shadow'],
        ['pending', 'staged'], ['pending', 'pending'], ['staged', 'done']]) {
        expect(v(s!, t!, 'lane'), `${s} -> ${t}`).toEqual({ ok: false, error: 'bad-row', detail: `${s} -> ${t} by lane` });
      }
    },
  };
}

export type CeilingModule = typeof import('../src/coord/overlordActCeiling.js');

/** The wired count's guard (A6; the coordinator's item 6b): a count is a non-negative safe integer, else it could not be
 *  measured, at every count the step reads. */
export function countReadableCases(c: CeilingModule): Record<string, SuiteCase> {
  const counted = (all: number, programme: number | null = null) => ({ kind: 'counted', programme, all }) as const;
  const refusedAs = (group: string) => ({ pass: false, word: 'unavailable', group, why: c.UNREADABLE_COUNT, latch: null });
  return {
    'a count is a non-negative safe integer, and a programme count is one or null (the guard accepts a null always)': () => {
      for (const ok of [counted(0), counted(5), counted(7, 0), counted(30, 6)]) expect(c.countReadable(ok), JSON.stringify(ok)).toBe(true);
      for (const bad of [-1, 0.5, Number.NaN, Number.POSITIVE_INFINITY, Number.MAX_SAFE_INTEGER + 2]) {
        expect(c.countReadable(counted(bad)), `all ${bad}`).toBe(false);
        expect(c.countReadable(counted(0, bad)), `programme ${bad}`).toBe(false);
      }
    },
    'the step refuses unavailable on an unreadable count of the act\'s group or the effect\'s, never a pass': () => {
      expect(c.actCeilingStep('relay', null, { act: counted(-1), effect: 'not-asked' })).toEqual(refusedAs('relay'));
      expect(c.actCeilingStep('relay', null, { act: counted(0, 1.5), effect: 'not-asked' })).toEqual(refusedAs('relay'));
      expect(c.actCeilingStep('relay', 'widen-scope', { act: counted(0), effect: counted(Number.NaN) })).toEqual(refusedAs('o3-effect'));
      expect(c.actCeilingStep('relay', 'widen-scope', { act: counted(0, 0), effect: counted(0, 0) })).toEqual({ pass: true });
    },
  };
}

export function writeCountGroupsCases(m: M): Record<string, SuiteCase> {
  return {
    'a group counts every catalogue kind counted in it': () => {
      expect([...m.groupKinds('relay')].sort()).toEqual(['nudge-owner', 'relay']);
      expect([...m.groupKinds('o3-effect')].sort()).toEqual(['approve-dod', 'approve-spec', 'widen-scope']);
      expect([...m.groupKinds('own-record')].sort()).toEqual(['model-write', 'open-request', 'seal-prediction']);
    },
    'the write reads the act\'s group and, for a counted effect, the effect\'s': () => {
      expect(m.writeCountGroups('relay', 'widen-scope')).toEqual({ act: 'relay', effect: 'o3-effect' });
      expect(m.writeCountGroups('relay', null)).toEqual({ act: 'relay', effect: null });
      expect(m.writeCountGroups('acknowledge', 'relay')).toEqual({ act: null, effect: 'relay' });
      expect(m.writeCountGroups('answer-item', 'acknowledge')).toEqual({ act: 'answer', effect: null });
      expect(m.writeCountGroups('read', 'a-kind-this-build-lacks')).toEqual({ act: null, effect: null });
    },
  };
}

// ------------------------------------------------------------------------------------------- the store's two applies (review 4205)

export type ActsStoreModule = typeof import('../src/coord/overlordActsStore.js');

const STORE_AT = 1_800_000_000_000;
const storeDb = (): DatabaseSync => openCoordDb(path.join(mkTmp('ccrc-acts-apply-'), 'coord.db'));
const actLines = (db: DatabaseSync): { state: string; actor: string; actorKind: string }[] =>
  db.prepare("SELECT state, actor, actorKind FROM overlord_sequence WHERE kind = 'act' ORDER BY seq").all() as never;
let applySeed = 0;
const applyInput = (actor: RecordedActor, id: number, state: 'pending' | 'done'): ActWrite => ({
  allow: { act: 'relay', effect: null, programme: 'prog-a', incarnation: null, naturalKey: '', cell: 'allow', generationId: 2 },
  kind: 'relay', state, target: { kind: 'request', id, revision: 0 }, targets: [{ kind: 'request', id: String(id), revision: 0 }],
  requestId: id, widens: null, opens: null, summary: 'route it', why: 'its owner', authority: 'own', actor,
  identityStrength: 'attributed', isolation: 'shared-user', fence: { term: 1, generationId: 2, model: null, lane: null },
  op: { key: (++applySeed).toString(16).padStart(32, 'a'), door: 'relay', callSha256: 'c'.repeat(64), sessionId: 'overlord-a' },
  checks: [], journalHighest: null,
});
/** A journal double that runs `between` after its append and before the apply (a fact changed under the plan), then the apply,
 *  answering a throw from it as `journal-append`, as the act journal will. Its ok answer's `sequence` is the last record's
 *  that this append wrote, counting every record from 1, as the port says (the writers do not read it). */
const doubleWith = (between: () => void = () => undefined): ActJournalPort => {
  let sequence = 0;
  return {
    appendInTx(_db, records, apply) {
      sequence += records.length;
      between();
      try { apply(); } catch (e) { return { ok: false, error: 'journal-append', detail: e instanceof Error ? e.message : String(e) }; }
      return { ok: true, sequence };
    },
  };
};
const IDENTITY = attributionIdentity({ attribute: async () => ({ ok: true }), incarnation: async () => ({ kind: 'unmeasured', reason: 'absent' }) });
const sessionActor = async (): Promise<RecordedActor> => {
  const s = await IDENTITY.session('overlord-a', '11111111-2222-3333-4444-555555555555', 'byUuid');
  if (!s.ok) throw new Error('the fixture session was not attributed');
  return s.actor;
};
const operatorActor = (): RecordedActor => IDENTITY.operator(gateActorOf('Fixture browser', 'abcdef0123456789'));

/** The apply re-makes its plan and throws when a fact changed under it (F3), and a door settle's act line is its act's own
 *  actor's (F1): one case per actor kind the door can carry. A lane's or the boot pass's settle of such a row writes the server's
 *  line (review 4218 F1): one case per actor kind and mover. */
export function actApplyCases(m: ActsStoreModule): Record<string, SuiteCase> {
  const doorSettleLine = async (actor: RecordedActor): Promise<void> => {
    const db = storeDb();
    try {
      const j = doubleWith();
      expect(tx(db, () => m.writeActInTx(db, j, applyInput(actor, 7, 'pending'), STORE_AT))).toMatchObject({ ok: true, act: { id: 1 } });
      expect(tx(db, () => m.settleActInTx(db, j, 1, 'done', 'door', STORE_AT + 1))).toMatchObject({ ok: true, act: { state: 'done' } });
      expect(actLines(db)).toEqual([
        { state: 'pending', actor: actor.subject, actorKind: actor.kind }, { state: 'done', actor: actor.subject, actorKind: actor.kind }]);
    } finally { db.close(); }
  };
  /** Review 4218 F1, the other side of the same line: a row a session or the operator wrote, settled by the lane or the boot pass
   *  (`ACT_TRANSITIONS` lets both move `pending`), keeps its first line and writes the server's on the settle's. */
  const serverSettleLine = async (actor: RecordedActor, by: 'lane' | 'boot'): Promise<void> => {
    const db = storeDb();
    try {
      const j = doubleWith();
      expect(tx(db, () => m.writeActInTx(db, j, applyInput(actor, 7, 'pending'), STORE_AT))).toMatchObject({ ok: true, act: { id: 1 } });
      expect(tx(db, () => m.settleActInTx(db, j, 1, 'done', by, STORE_AT + 1))).toMatchObject({ ok: true, act: { state: 'done' } });
      expect(actLines(db)).toEqual([
        { state: 'pending', actor: actor.subject, actorKind: actor.kind }, { state: 'done', actor: 'server', actorKind: 'server' }]);
    } finally { db.close(); }
  };
  return {
    'a door settle\'s line carries a session actor\'s own subject and kind': async () => { await doorSettleLine(await sessionActor()); },
    'a door settle\'s line carries an operator actor\'s own subject and kind': async () => { await doorSettleLine(operatorActor()); },
    'a lane settle of a session\'s row writes the server\'s line': async () => { await serverSettleLine(await sessionActor(), 'lane'); },
    'a boot settle of a session\'s row writes the server\'s line': async () => { await serverSettleLine(await sessionActor(), 'boot'); },
    'a lane settle of an operator\'s row writes the server\'s line': async () => { await serverSettleLine(operatorActor(), 'lane'); },
    'a boot settle of an operator\'s row writes the server\'s line': async () => { await serverSettleLine(operatorActor(), 'boot'); },
    'the write\'s apply throws when the highest id moved between the append and the apply: journal-append, no row, no line': () => {
      const db = storeDb();
      try {
        const plain = doubleWith();
        for (const id of [7, 8]) expect(tx(db, () => m.writeActInTx(db, plain, applyInput(serverActorOf('lane-a'), id, 'done'), STORE_AT)).ok).toBe(true);
        // The plan reserves id 3; the double then drops row 2, so the re-made plan reserves 2 and the apply must not insert 3.
        // This disagreement rests on the next id being the table's highest plus one (`nextActId`, the departure
        // act-id-from-one-decider): were ids ever drawn from a counter that a delete does not lower, this case would need
        // another way to move the plan, and would go red for that reason, not for the comparison it pins.
        const moved = doubleWith(() => { db.prepare('DELETE FROM overlord_acts WHERE id = 2').run(); });
        expect(tx(db, () => m.writeActInTx(db, moved, applyInput(serverActorOf('lane-a'), 9, 'done'), STORE_AT)))
          .toMatchObject({ ok: false, error: 'journal-append' });
        expect(m.actById(db, 3)).toEqual({ kind: 'measured', value: 'absent' });
        expect(actLines(db)).toHaveLength(2);
      } finally { db.close(); }
    },
    'the write\'s apply throws when its natural key was taken between the append and the apply: journal-append, no row, no line': () => {
      const db = storeDb();
      try {
        const plain = doubleWith();
        // Row 1 holds request 9's key, then is settled refused, which frees the key for a second write of the same target.
        expect(tx(db, () => m.writeActInTx(db, plain, applyInput(serverActorOf('lane-a'), 9, 'pending'), STORE_AT)).ok).toBe(true);
        expect(tx(db, () => m.settleActInTx(db, plain, 1, 'refused', 'lane', STORE_AT)).ok).toBe(true);
        // The plan reserves id 2 with the key free; the double then makes row 1 hold the key again, the highest id unmoved, so the
        // re-made plan refuses natural-key-taken and the apply must not insert row 2.
        const taken = doubleWith(() => { db.prepare("UPDATE overlord_acts SET state = 'done' WHERE id = 1").run(); });
        expect(tx(db, () => m.writeActInTx(db, taken, applyInput(serverActorOf('lane-a'), 9, 'done'), STORE_AT)))
          .toMatchObject({ ok: false, error: 'journal-append' });
        expect(m.actById(db, 2)).toEqual({ kind: 'measured', value: 'absent' });
        expect(actLines(db)).toHaveLength(2);
      } finally { db.close(); }
    },
    'the settle\'s apply throws when the row\'s state moved between the append and the apply: journal-append, the state left': () => {
      const db = storeDb();
      try {
        const plain = doubleWith();
        expect(tx(db, () => m.writeActInTx(db, plain, applyInput(serverActorOf('lane-a'), 7, 'pending'), STORE_AT)).ok).toBe(true);
        // The plan reads from = pending; the double moves the row to unknown, from which the lane may also settle done, so the
        // re-made plan passes with another from, and the apply must refuse it rather than write done over unknown.
        const moved = doubleWith(() => { db.prepare("UPDATE overlord_acts SET state = 'unknown' WHERE id = 1").run(); });
        expect(tx(db, () => m.settleActInTx(db, moved, 1, 'done', 'lane', STORE_AT + 1))).toMatchObject({ ok: false, error: 'journal-append' });
        expect(m.actById(db, 1)).toMatchObject({ kind: 'measured', value: { state: 'unknown' } });
        expect(actLines(db)).toHaveLength(1);
      } finally { db.close(); }
    },
  };
}

// ------------------------------------------------------------------------------------- the ceiling latch's standing read (F2)

export type CeilingWiringModule = typeof import('../src/coord/overlordCeilingWiring.js');

/** The standing read over a fixture store, with latches raised through the ladder's real one writer by an actor it accepts. */
export function ceilingStandingCases(w: CeilingWiringModule): Record<string, SuiteCase> {
  const withStore = (fn: (coord: CoordStore, raise: (cause: LadderLatchCause) => void) => void): void => {
    const coord = new CoordStore(storeDb());
    const deps = { coord, journal: NO_LADDER_AUTHORITY, clock: { wall: () => 1_000 }, entropy: { hex: (n: number) => 'c'.repeat(2 * n) } };
    try {
      fn(coord, (cause) => { expect(raiseLatch(deps, cause, 'a fixture cause', serverActorOf('lane-a'))).toMatchObject({ ok: true, changed: true }); });
    } finally { coord.db.close(); }
  };
  const ports = (coord: CoordStore) => w.ceilingLatchPorts({ rows: () => coord.ladderRows(), raise: undefined, warn: () => undefined });
  return {
    'a standing act-ceiling-hit latch reads yes': () => withStore((coord, raise) => {
      expect(ports(coord).standing()).toBe(false);
      raise(ACT_CEILING_LATCH);
      expect(ports(coord).standing()).toBe(true);
    }),
    'a standing latch of another cause alone reads no': () => withStore((coord, raise) => {
      raise('probes-failed-twice');
      expect(coord.ladderRows()).toMatchObject({ kind: 'measured', standing: [{ cause: 'probes-failed-twice' }] });
      expect(ports(coord).standing()).toBe(false);
    }),
  };
}

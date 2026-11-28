// Overlord W2, act rows A (plan `docs/superpowers/plans/2026-11-16-overlord-w2/w2-act-rows.md` Tasks A2, A3 and A6's count reader):
// the act store, the one owner of the SQL of `overlord_acts`. Decide, append, apply: a refusal writes nothing and reserves no id;
// the apply runs inside the journal's call. The journal port is a double that records what it was handed and runs the apply as the
// act journal will. Fixture databases in temp dirs only, neutral names, never the live HOME.
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import type { DatabaseSync } from 'node:sqlite';
import path from 'node:path';
import { copyFileSync, mkdirSync } from 'node:fs';
import { openCoordDb } from '../src/coord/db.js';
import { tx } from '../src/coord/tx.js';
import { serverActorOf } from '../src/auth/attributionIdentity.js';
import {
  actById, actByNaturalKey, actByOpKey, actCountReader, highestActId, openActs, settleActInTx, writeActInTx,
  type ActJournalAppend, type ActJournalPort, type ActWrite,
} from '../src/coord/overlordActsStore.js';
import type { ActJournalRecord } from '../src/coord/overlordActs.js';
import { ACT_CEILING_WINDOW_MS, type OverlordActKind } from '../../shared/overlord.js';
import { mkTmp, removeTmpFixtures } from './tmpHelpers.js';
import { actApplyCases } from './actCases.js';
import * as store from '../src/coord/overlordActsStore.js';

let template = '';
const opened: DatabaseSync[] = [];
beforeAll(() => {
  template = path.join(mkTmp('ccrc-acts-template-'), 'coord.db');
  openCoordDb(template).close();
});
afterEach(() => { for (const d of opened.splice(0)) { try { d.close(); } catch { /* already closed */ } } });
afterAll(() => removeTmpFixtures());

const openDb = (): DatabaseSync => {
  const dir = path.join(mkTmp('ccrc-acts-'), '.ccrc');
  mkdirSync(dir, { recursive: true });
  copyFileSync(template, path.join(dir, 'coord.db'));
  const db = openCoordDb(path.join(dir, 'coord.db'));
  opened.push(db);
  return db;
};

const AT = 1_800_000_000_000;
const ACTOR = serverActorOf('lane-a');

/** The journal double: it records every call, runs the apply as the act journal will, and answers a throw from the apply as
 *  `journal-append` (the real journal also tells its guard `trailing`; its own suite proves that). */
interface Double extends ActJournalPort { readonly calls: (readonly ActJournalRecord[])[]; readonly events: string[]; refuse: ActJournalAppend | null }
const journal = (db: DatabaseSync): Double => {
  const d: Double = {
    calls: [], events: [], refuse: null,
    appendInTx(_db, records, apply) {
      if (d.refuse !== null) return d.refuse;
      d.calls.push(records);
      d.events.push(`append rows=${count(db)}`);
      try { apply(); } catch (e) { d.events.push('apply threw'); return { ok: false, error: 'journal-append', detail: e instanceof Error ? e.message : String(e) }; }
      d.events.push(`applied rows=${count(db)}`);
      return { ok: true, sequence: d.calls.length };
    },
  };
  return d;
};
const count = (db: DatabaseSync): number => (db.prepare('SELECT count(*) AS n FROM overlord_acts').get() as { n: number }).n;
const lines = (db: DatabaseSync): { kind: string; id: string; state: string; actor: string; actorKind: string }[] =>
  db.prepare("SELECT kind, id, state, actor, actorKind FROM overlord_sequence WHERE kind = 'act' ORDER BY seq").all() as never;

let opSeed = 0;
const opKey = (): string => (++opSeed).toString(16).padStart(32, '0');
const input = (over: Partial<ActWrite> = {}, kind: OverlordActKind = 'relay'): ActWrite => ({
  allow: { act: kind, effect: null, programme: 'prog-a', incarnation: null, naturalKey: '', cell: 'allow', generationId: 2 },
  kind, state: 'done', target: { kind: 'request', id: 7, revision: 0 }, targets: [{ kind: 'request', id: '7', revision: 0 }],
  requestId: 7, widens: null, opens: null, summary: 'route it', why: 'its owner', authority: 'own', actor: ACTOR,
  identityStrength: 'attributed', isolation: 'shared-user', fence: { term: 1, generationId: 2, model: null, lane: null },
  op: { key: opKey(), door: 'relay', callSha256: 'c'.repeat(64), sessionId: 'overlord-a' }, checks: [], journalHighest: null, ...over,
});
const write = (db: DatabaseSync, j: ActJournalPort, over: Partial<ActWrite> = {}, at = AT, kind: OverlordActKind = 'relay') =>
  tx(db, () => writeActInTx(db, j, input(over, kind), at));

describe('the write, outside and inside a transaction', () => {
  it('outside tx(), both writers refuse not-in-transaction, write nothing and never call the journal', () => {
    const db = openDb(); const j = journal(db);
    expect(writeActInTx(db, j, input(), AT)).toMatchObject({ ok: false, error: 'not-in-transaction' });
    expect(settleActInTx(db, j, 1, 'done', 'lane', AT)).toMatchObject({ ok: false, error: 'not-in-transaction' });
    expect(j.calls).toEqual([]);
    expect(count(db)).toBe(0);
  });

  it('a done write appends one act-settle from null, then writes the row and stamps one act line inside the apply', () => {
    const db = openDb(); const j = journal(db);
    const r = write(db, j);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(j.calls).toHaveLength(1);
    expect(j.calls[0]!.map((c) => c.kind)).toEqual(['act-settle']);
    expect(j.calls[0]![0]).toMatchObject({ kind: 'act-settle', from: null, to: 'done', actId: r.act.id, act: 'relay',
      natural: { kind: 'row', target: 'request', id: 7, revision: 0 }, requestId: 7, term: 1, generationId: 2 });
    expect(j.events).toEqual(['append rows=0', 'applied rows=1']);
    expect(lines(db)).toEqual([{ kind: 'act', id: String(r.act.id), state: 'done', actor: ACTOR.subject, actorKind: 'server' }]);
    expect(r.act).toEqual({ id: 1, kind: 'relay', state: 'done', outcome: null, naturalKey: '["relay","request",7,0]',
      targets: [{ kind: 'request', id: '7', revision: 0 }], requestId: 7 });
    const row = db.prepare('SELECT sequence, programme, reversibility, effect, widens, opKey, opGenerationId FROM overlord_acts').get() as Record<string, unknown>;
    expect(row).toMatchObject({ programme: 'prog-a', reversibility: 'compensable', effect: null, widens: 0, opGenerationId: 2 });
    expect(row.sequence).toBe(r.seq);
  });

  it('a pending write appends one act-intent; opens adds act-open-request after it', () => {
    const db = openDb(); const j = journal(db);
    expect(write(db, j, { state: 'pending' }).ok).toBe(true);
    expect(j.calls[0]!.map((c) => c.kind)).toEqual(['act-intent']);
    expect(write(db, j, { target: { kind: 'request', id: 8, revision: 0 }, opens: 8 }, AT, 'open-request').ok).toBe(true);
    expect(j.calls[1]!.map((c) => c.kind)).toEqual(['act-settle', 'act-open-request']);
    expect(j.calls[1]![1]).toEqual({ kind: 'act-open-request', opKey: j.calls[1]![0]!.opKey, requestId: 8, actId: 2 });
  });

  it('a journal that refuses: nothing is written, the writer answers the journal\'s word, and the apply never ran', () => {
    const db = openDb(); const j = journal(db);
    j.refuse = { ok: false, error: 'authority-rolled-back', detail: 'the epoch fell' };
    expect(write(db, j)).toEqual({ ok: false, error: 'authority-rolled-back', detail: 'the epoch fell' });
    expect(count(db)).toBe(0);
    expect(lines(db)).toEqual([]);
  });

  it('an apply that throws after the append answers journal-append, never throws, and leaves no row and no line', () => {
    const db = openDb(); const j = journal(db);
    db.exec("CREATE TRIGGER acts_fail BEFORE INSERT ON overlord_acts BEGIN SELECT RAISE(ABORT, 'disk full'); END;");
    const r = write(db, j);
    expect(r).toMatchObject({ ok: false, error: 'journal-append' });
    expect(j.events).toEqual(['append rows=0', 'apply threw']);
    expect(count(db)).toBe(0);
    expect(lines(db)).toEqual([]);
  });

  it('a refused write leaves no row and uses no id; two writes in one transaction take consecutive ids', () => {
    const db = openDb(); const j = journal(db);
    expect(write(db, j).ok).toBe(true);
    expect(write(db, j)).toMatchObject({ ok: false, error: 'natural-key-taken' });
    const both = tx(db, () => [writeActInTx(db, j, input({ target: { kind: 'request', id: 8, revision: 0 } }), AT),
      writeActInTx(db, j, input({ target: { kind: 'request', id: 9, revision: 0 } }), AT)]);
    expect(both.map((b) => (b.ok ? b.act.id : b.error))).toEqual([2, 3]);
    expect(lines(db).map((l) => l.id)).toEqual(['1', '2', '3']);
    expect(j.calls.flat().map((c) => (c.kind === 'act-open-request' ? 0 : c.actId))).toEqual([1, 2, 3]);
  });

  it('a rolled-back transaction reserves no id: the next write takes the same one', () => {
    const db = openDb(); const j = journal(db);
    expect(() => tx(db, () => { writeActInTx(db, j, input(), AT); throw new Error('the door failed after'); })).toThrow('the door failed after');
    expect(count(db)).toBe(0);
    const r = write(db, j);
    expect(r.ok && r.act.id).toBe(1);
  });

  it("the id is above the act journal's highest when that is above the table's (a restored floor)", () => {
    const db = openDb(); const j = journal(db);
    expect(write(db, j).ok).toBe(true);
    const r = write(db, j, { target: { kind: 'request', id: 8, revision: 0 }, journalHighest: 40 });
    expect(r.ok && r.act.id).toBe(41);
    expect(j.calls[1]![0]!.kind !== 'act-open-request' && j.calls[1]![0]!.actId).toBe(41);
    expect(highestActId(db)).toEqual({ kind: 'measured', value: 41 });
  });

  it('a state the door does not enter, a target with no key and a field out of shape are bad-row, with nothing written', () => {
    const db = openDb(); const j = journal(db);
    expect(write(db, j, { state: 'refused' as never })).toMatchObject({ ok: false, error: 'bad-row' });
    expect(write(db, j, { target: { kind: 'request', id: -1, revision: 0 } })).toMatchObject({ ok: false, error: 'bad-row', detail: 'target' });
    expect(write(db, j, { op: { key: 'NOT-HEX', door: 'relay', callSha256: 'c', sessionId: 's' } })).toMatchObject({ ok: false, error: 'bad-row', detail: 'op.key' });
    expect(write(db, j, { actor: { ...ACTOR } })).toMatchObject({ ok: false, error: 'bad-row', detail: 'actor' });
    expect(j.calls).toEqual([]);
    expect(count(db)).toBe(0);
  });

  it('the summary and the why are masked, then cut whole at 200 and 600 characters', () => {
    const db = openDb(); const j = journal(db);
    const word = 'abcd ';
    const r = write(db, j, { summary: word.repeat(41), why: `ghp_${'a'.repeat(36)} ${word.repeat(121)}` });
    expect(r.ok).toBe(true);
    const row = db.prepare('SELECT summary, why FROM overlord_acts').get() as { summary: string; why: string };
    expect(row.summary.length).toBeLessThanOrEqual(200);
    expect(row.summary.trimEnd().endsWith('abcd')).toBe(true);
    expect(row.summary.trimEnd().length).toBe(199);
    expect(row.why.length).toBeLessThanOrEqual(600);
    expect(row.why).not.toContain('ghp_');
  });
});

describe('the natural key and the operation key', () => {
  it('two done writes under one key: the second answers natural-key-taken with the holder, before any append', () => {
    const db = openDb(); const j = journal(db);
    const first = write(db, j);
    const second = write(db, j);
    expect(second).toMatchObject({ ok: false, error: 'natural-key-taken', holder: first.ok ? first.act : null });
    expect(j.calls).toHaveLength(1);
  });

  it('a row settled refused frees its key; one settled done keeps it', () => {
    const db = openDb(); const j = journal(db);
    const p = write(db, j, { state: 'pending' });
    expect(p.ok).toBe(true);
    expect(tx(db, () => settleActInTx(db, j, 1, 'refused', 'door', AT + 1))).toMatchObject({ ok: true, act: { state: 'refused' } });
    expect(write(db, j).ok).toBe(true);
    expect(write(db, j)).toMatchObject({ ok: false, error: 'natural-key-taken' });
  });

  it('a row the restore pass wrote (divergedAt) holds its key as any row does: taken in done, free in refused', () => {
    const db = openDb(); const j = journal(db);
    expect(write(db, j).ok).toBe(true);
    db.prepare('UPDATE overlord_acts SET divergedAt = ? WHERE id = 1').run(AT);
    expect(write(db, j)).toMatchObject({ ok: false, error: 'natural-key-taken' });
    db.prepare("UPDATE overlord_acts SET state = 'refused' WHERE id = 1").run();
    expect(write(db, j).ok).toBe(true);
  });

  it('the unique index backs the writer: a second live row under one key fails in SQL, a refused one does not', () => {
    const db = openDb(); const j = journal(db);
    expect(write(db, j).ok).toBe(true);
    const copy = "INSERT INTO overlord_acts SELECT 2, at, sequence, kind, effect, class, effectiveClass, evidenceClass, requestId, targets, programme, naturalKey, naturalKind, naturalId, naturalRevision, widens, widenedProgramme, summary, why, reason, authority, dissent, reversibility, outcome, outcomeAt, ?, overturnedAt, overturnNote, seenAt, dependsSince, divergedAt, pushedAt, term, generationId, model, lane, actorKind, actorSubject, actorIssuer, identityStrength, isolation, ?, opDoor, opCallSha256, opSessionId, opGenerationId, options, chosen, recommended, citedIds, probability, checks, stagedUntil, stagedOutcome, performerSession, performedAt FROM overlord_acts WHERE id = 1";
    expect(() => db.prepare(copy).run('done', 'e'.repeat(32))).toThrow(/UNIQUE/);
    expect(() => db.prepare(copy).run('refused', 'f'.repeat(32))).not.toThrow();
    expect(() => db.prepare(copy.replace('SELECT 2', 'SELECT 3')).run('refused', 'f'.repeat(32))).toThrow(/UNIQUE/);
    expect(() => db.prepare(copy.replace('SELECT 2', 'SELECT 4')).run('settled', 'd'.repeat(32))).toThrow(/CHECK/);
  });

  it('one operation key in one session\'s generation names one act: a second write under it answers op-key-taken with the holder', () => {
    const db = openDb(); const j = journal(db);
    const op = { key: 'a'.repeat(32), door: 'relay', callSha256: 'c'.repeat(64), sessionId: 'overlord-a' };
    const first = write(db, j, { op });
    expect(write(db, j, { op, target: { kind: 'request', id: 8, revision: 0 } }))
      .toMatchObject({ ok: false, error: 'op-key-taken', holder: first.ok ? first.act : null });
    expect(write(db, j, { op: { ...op, sessionId: 'overlord-b' }, target: { kind: 'request', id: 8, revision: 0 } }).ok).toBe(true);
    expect(write(db, j, { op, fence: { term: 1, generationId: 3, model: null, lane: null }, target: { kind: 'request', id: 9, revision: 0 } }).ok).toBe(true);
    expect(actByOpKey(db, 'overlord-a', 2, 'a'.repeat(32))).toMatchObject({ kind: 'measured', value: { id: 1 } });
    expect(actByOpKey(db, 'overlord-a', 4, 'a'.repeat(32))).toEqual({ kind: 'measured', value: null });
  });
});

describe('the settle', () => {
  it('reads the row\'s state in the transaction and passes it as from; the lane\'s and the boot pass\'s lines are the server\'s', () => {
    const db = openDb(); const j = journal(db);
    expect(write(db, j, { state: 'pending' }).ok).toBe(true);
    expect(tx(db, () => settleActInTx(db, j, 1, 'unknown', 'lane', AT + 1))).toMatchObject({ ok: true, act: { state: 'unknown' } });
    expect(j.calls[1]).toEqual([expect.objectContaining({ kind: 'act-settle', from: 'pending', to: 'unknown', actId: 1 })]);
    expect(tx(db, () => settleActInTx(db, j, 1, 'done', 'boot', AT + 2))).toMatchObject({ ok: true, act: { state: 'done' } });
    expect(j.calls[2]).toEqual([expect.objectContaining({ kind: 'act-settle', from: 'unknown', to: 'done' })]);
    expect(lines(db).map((l) => [l.state, l.actor, l.actorKind])).toEqual([['pending', ACTOR.subject, 'server'], ['unknown', 'server', 'server'], ['done', 'server', 'server']]);
  });

  it('a move outside ACT_TRANSITIONS is bad-row, with nothing appended: unknown by the door, a terminal row, a missing row', () => {
    const db = openDb(); const j = journal(db);
    expect(write(db, j, { state: 'pending' }).ok).toBe(true);
    expect(tx(db, () => settleActInTx(db, j, 1, 'unknown', 'door', AT))).toMatchObject({ ok: true });
    expect(tx(db, () => settleActInTx(db, j, 1, 'done', 'door', AT))).toMatchObject({ ok: false, error: 'bad-row' });
    expect(tx(db, () => settleActInTx(db, j, 1, 'refused', 'lane', AT))).toMatchObject({ ok: true });
    expect(tx(db, () => settleActInTx(db, j, 1, 'done', 'lane', AT))).toMatchObject({ ok: false, error: 'bad-row' });
    expect(tx(db, () => settleActInTx(db, j, 99, 'done', 'lane', AT))).toMatchObject({ ok: false, error: 'not-found' });
    expect(j.calls).toHaveLength(3);
  });
});

// Review 4205 F1 and F3: a door settle's line under a session and an operator actor, and the two applies' disagreement checks,
// each red without its check. The cases are `actCases.ts`'s, shared with `sim/overlordActsSets.ts`.
describe('the applies (review 4205)', () => {
  for (const [name, run] of Object.entries(actApplyCases(store))) it(name, run);
});

describe('the readers', () => {
  it('openActs lists pending and unknown rows only, oldest first', () => {
    const db = openDb(); const j = journal(db);
    for (const [id, state] of [[7, 'pending'], [8, 'done'], [9, 'pending']] as const) {
      expect(write(db, j, { state, target: { kind: 'request', id, revision: 0 } }).ok).toBe(true);
    }
    expect(tx(db, () => settleActInTx(db, j, 3, 'unknown', 'lane', AT)).ok).toBe(true);
    const r = openActs(db);
    expect(r.kind === 'measured' && r.value.map((a) => [a.id, a.state])).toEqual([[1, 'pending'], [3, 'unknown']]);
    expect(actById(db, 2)).toMatchObject({ kind: 'measured', value: { id: 2, state: 'done' } });
    expect(actById(db, 5)).toEqual({ kind: 'measured', value: 'absent' });
    expect(actByNaturalKey(db, '["relay","request",8,0]')).toMatchObject({ kind: 'measured', value: { id: 2 } });
  });

  it('each reader answers unmeasured on a dropped table, never an empty list', () => {
    const db = openDb();
    db.exec('DROP TABLE overlord_acts');
    for (const r of [openActs(db), actById(db, 1), actByOpKey(db, 's', 1, 'k'), actByNaturalKey(db, 'k'), highestActId(db)]) {
      expect(r.kind).toBe('unmeasured');
    }
    expect(actCountReader(db).count('relay', null, 0).kind).toBe('unmeasured');
  });
});

describe('the count reader (A6)', () => {
  const since = AT - ACT_CEILING_WINDOW_MS;
  it('a named programme whose count reads back no integer is unmeasured, while the same read with no programme is counted (F4)', () => {
    // A database stand-in whose first count is an integer and whose second is not: only the programme's count is unreadable.
    const stub = (): DatabaseSync => {
      let n = 0;
      return { prepare: () => ({ get: () => ({ n: ++n === 1 ? 3 : null }) }) } as unknown as DatabaseSync;
    };
    expect(actCountReader(stub()).count('relay', 'prog-a', since)).toEqual({ kind: 'unmeasured', why: 'a count read back no integer' });
    expect(actCountReader(stub()).count('relay', null, since)).toEqual({ kind: 'counted', programme: null, all: 3 });
  });
  it('counts rows not refused whose kind or effect is in the group, in all and for one programme, inside the window', () => {
    const db = openDb(); const j = journal(db);
    let n = 0;
    const add = (kind: OverlordActKind, over: Partial<ActWrite> = {}, at = AT) => {
      const r = write(db, j, { target: { kind: 'request', id: ++n, revision: 0 }, ...over }, at, kind);
      expect(r.ok, JSON.stringify(r)).toBe(true);
    };
    add('relay');
    add('relay', { allow: { act: 'relay', effect: null, programme: 'prog-b', incarnation: null, naturalKey: '', cell: 'allow', generationId: 2 } });
    add('nudge-owner');
    add('relay', {}, since - 1);
    add('relay', { state: 'pending' });
    expect(tx(db, () => settleActInTx(db, j, 5, 'refused', 'door', AT)).ok).toBe(true);
    // A carrier whose effect is in a second group counts in both; a kind that is not itself counted counts by its effect.
    add('relay', { allow: { act: 'relay', effect: 'widen-scope', programme: 'prog-a', incarnation: null, naturalKey: '', cell: 'allow', generationId: 2 },
      widens: { programme: 'prog-a' } });
    add('acknowledge', { allow: { act: 'acknowledge', effect: 'relay', programme: 'prog-a', incarnation: null, naturalKey: '', cell: 'allow', generationId: 2 },
      target: { kind: 'message', id: 99, revision: 0 } });
    db.prepare('UPDATE overlord_acts SET overturnedAt = ? WHERE id = 1').run(AT + 5);
    const c = actCountReader(db);
    expect(c.count('relay', null, since)).toEqual({ kind: 'counted', programme: null, all: 5 });
    expect(c.count('relay', 'prog-a', since)).toEqual({ kind: 'counted', programme: 4, all: 5 });
    expect(c.count('relay', 'prog-b', since)).toEqual({ kind: 'counted', programme: 1, all: 5 });
    expect(c.count('o3-effect', 'prog-a', since)).toEqual({ kind: 'counted', programme: 1, all: 1 });
    expect(c.count('relay', null, since - 1)).toEqual({ kind: 'counted', programme: null, all: 6 });
    expect(c.count('answer', 'prog-a', since)).toEqual({ kind: 'counted', programme: 0, all: 0 });
  });

  it('the writer re-runs the ceilings inside its write: the seventh relay to one programme in an hour refuses act-ceiling, nothing appended', () => {
    const db = openDb(); const j = journal(db);
    for (let id = 1; id <= 6; id++) expect(write(db, j, { target: { kind: 'request', id, revision: 0 } }).ok).toBe(true);
    expect(write(db, j, { target: { kind: 'request', id: 7, revision: 0 } })).toEqual({ ok: false, error: 'act-ceiling', detail: 'relay programme 6', group: 'relay' });
    expect(j.calls).toHaveLength(6);
    expect(write(db, j, { target: { kind: 'request', id: 7, revision: 0 } }, AT + ACT_CEILING_WINDOW_MS + 1).ok).toBe(true);
  });

  it("a carried widening counts in the effect's group: a second one past the cap refuses act-ceiling naming o3-effect", () => {
    const db = openDb(); const j = journal(db);
    const widen = (id: number) => write(db, j, { target: { kind: 'request', id, revision: 0 }, widens: { programme: 'prog-a' },
      allow: { act: 'relay', effect: 'widen-scope', programme: 'prog-a', incarnation: null, naturalKey: '', cell: 'allow', generationId: 2 } });
    expect(widen(1).ok).toBe(true);
    expect(widen(2)).toMatchObject({ ok: false, error: 'act-ceiling', group: 'o3-effect' });
    expect(db.prepare('SELECT effect, widens, widenedProgramme FROM overlord_acts').all()).toEqual([{ effect: 'widen-scope', widens: 1, widenedProgramme: 'prog-a' }]);
  });
});

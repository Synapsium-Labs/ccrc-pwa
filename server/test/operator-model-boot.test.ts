// Overlord W1, the private store B (plan w1-private-store.md, Task 6): the boot pass (I8). The deciders are pure cases; the pass
// runs on fixture files only (a migrated coord.db copy, a temp operator-model.db, a privacy-issuer double), neutral names.
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { copyFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { gateActorOf } from '../src/accounts/audit.js';
import { attributionIdentity } from '../src/auth/attributionIdentity.js';
import { openCoordDb } from '../src/coord/db.js';
import { CoordStore } from '../src/coord/store.js';
import * as deciders from '../src/operatorModel/messages.js';
import type { CitationRead } from '../src/operatorModel/messages.js';
import { bootSettlementCases, nudgeRecoveryCases } from './sim/operatorModelSets.js';
import { defaultOperatorModelDbPath, openOperatorModelDb } from '../src/operatorModel/db.js';
import { OperatorModelStore, type PrivacyIssuer } from '../src/operatorModel/store.js';
import { settleOperatorNudge } from '../src/operatorModel/nudgeLane.js';
import { bootPassSummary, runOperatorModelBootPass, w1Citations } from '../src/operatorModel/bootPass.js';
import { OVERLORD_OPERATOR_MARK, operatorMessageSubject } from '../../shared/operatorMessages.js';
import type { DesignationRead, DesignationView } from '../../shared/overlord-designation.js';
import { mkTmp, removeTmpFixtures } from './tmpHelpers.js';

const ACTOR = attributionIdentity({ attribute: async () => ({ ok: true }), incarnation: async () => ({ kind: 'unmeasured', reason: 'absent' }) })
  .operator(gateActorOf('Fixture browser', 'abcdef0123456789'));
const NOW = 5_000;
const S = 'lane-a-project-a';
const VIEW = {} as DesignationView;
const designated = (sessionId: string): DesignationRead => ({ kind: 'designated', sessionId, term: 1, row: VIEW });
const NONE: DesignationRead = { kind: 'not-designated', row: null };
const UNMEASURED: DesignationRead = { kind: 'unmeasured', why: 'fixture' };
const run = (cases: Record<string, () => unknown>): void => { for (const [name, fn] of Object.entries(cases)) it(name, fn as () => void); };

describe('bootSettlement (I8, open question 9)', () => run(bootSettlementCases(deciders)));
describe('nudgeRecovery', () => run(nudgeRecoveryCases(deciders)));

// ---------- the pass, on fixtures ----------
let template = '';
const open: DatabaseSync[] = [];
beforeAll(() => { template = path.join(mkTmp('ccrc-boot-template-'), 'coord.db'); openCoordDb(template).close(); });
afterEach(() => { for (const d of open.splice(0)) if (d.isOpen) d.close(); });
afterAll(() => removeTmpFixtures());

function issuer(): PrivacyIssuer {
  let last = 0;
  return { kind: 'ready', issue(hi) { last = Math.max(hi ?? 0, last) + 1; return { ok: true, id: last }; } };
}
interface World { coord: CoordStore; db: DatabaseSync; store: OperatorModelStore; designation: DesignationRead }
function world(): World {
  const dir = path.join(mkTmp('ccrc-boot-'), '.ccrc');
  mkdirSync(dir, { recursive: true });
  copyFileSync(template, path.join(dir, 'coord.db'));
  const coordDb = openCoordDb(path.join(dir, 'coord.db'));
  open.push(coordDb);
  const db = openOperatorModelDb(defaultOperatorModelDbPath(mkTmp('ccrc-boot-om-')));
  open.push(db);
  const w: World = { coord: new CoordStore(coordDb), db, store: new OperatorModelStore(db, issuer()), designation: designated(S) };
  w.coord.designationRead = () => w.designation;
  return w;
}
const rec = (w: World, over: Partial<Parameters<OperatorModelStore['recordMessage']>[0]> = {}): number => {
  const r = w.store.recordMessage({ at: 1_000, sessionId: S, term: 1, actor: ACTOR, text: 'hello', mark: false, composedKey: null, offRecord: false, ...over });
  if (!r.ok) throw new Error(`${r.error}: ${r.detail}`);
  return r.value.id;
};
const pass = (w: World, citations: () => CitationRead = w1Citations) =>
  runOperatorModelBootPass({ operatorModel: w.store, coord: w.coord, citations, now: () => NOW });
const stateOf = (w: World, id: number): string => (w.db.prepare('SELECT state FROM operator_messages WHERE id = ?').get(id) as { state: string }).state;
const rowOf = (w: World, id: number) => w.db.prepare('SELECT * FROM operator_messages WHERE id = ?').get(id) as Record<string, unknown>;
const mails = (w: World): { subject: string; toId: string; body: string }[] =>
  w.coord.db.prepare('SELECT subject, toId, body FROM mail ORDER BY id').all() as { subject: string; toId: string; body: string }[];
const nudgeMail = (w: World, id: number, state: string): void => {
  const q = w.coord.hasMailWithSubject('operator', null, S, operatorMessageSubject(id));
  expect(q).toBe(false);
  w.coord.db.prepare("INSERT INTO mail (at, fromId, fromUuid, toId, runId, kind, subject, body, artifacts) VALUES (1, 'operator', '', ?, NULL, 'status', ?, 'b', '[]')")
    .run(S, operatorMessageSubject(id));
  void state;
};

describe('runOperatorModelBootPass', () => {
  it('a crash after the record and before the mail queues one nudge at boot, and a second boot queues none', () => {
    const w = world();
    const id = rec(w);
    expect(stateOf(w, id)).toBe('recorded');
    const first = pass(w);
    expect(first.counts).toMatchObject({ queued: 1, linked: 0, waiting: 0 });
    expect(stateOf(w, id)).toBe('queued');
    expect(mails(w)).toHaveLength(1);
    expect(mails(w)[0]).toMatchObject({ subject: operatorMessageSubject(id), toId: S });
    expect(mails(w)[0]!.body).not.toContain('hello');
    expect(mails(w)[0]!.body).toContain(String(id));
    const second = pass(w);
    expect(second.counts).toMatchObject({ queued: 0, linked: 0 });
    expect(mails(w)).toHaveLength(1);
  });
  it('the same for a mark-settled row, which stays settled and gains its queuedAt', () => {
    const w = world();
    const id = rec(w, { mark: true });
    expect(stateOf(w, id)).toBe('settled');
    expect(pass(w).counts).toMatchObject({ queued: 1 });
    expect(stateOf(w, id)).toBe('settled');
    expect(rowOf(w, id).queuedAt).toBe(NOW);
    expect(pass(w).counts).toMatchObject({ queued: 0 });
    expect(mails(w)).toHaveLength(1);
  });
  it('a crash after the mail and before the queue move links the row', () => {
    const w = world();
    const id = rec(w);
    nudgeMail(w, id, 'outstanding');
    const r = pass(w);
    expect(r.counts).toMatchObject({ linked: 1, queued: 0 });
    expect(stateOf(w, id)).toBe('queued');
    expect(mails(w)).toHaveLength(1);
  });
  it('a nudge already delivered and acked (its row left recorded by a crash) is linked, not queued again', () => {
    const w = world();
    const id = rec(w);
    nudgeMail(w, id, 'acked');
    const mailId = (w.coord.db.prepare('SELECT id FROM mail').get() as { id: number }).id;
    w.coord.db.prepare("INSERT INTO mail_deliveries (mailId, toId, state, envelope) VALUES (?, ?, 'acked', 'e')").run(mailId, S);
    const r = pass(w);
    expect(r.counts).toMatchObject({ linked: 1, queued: 0 });
    expect(mails(w)).toHaveLength(1);
  });
  it('a row of a session no longer designated waits; so does one when nobody is designated', () => {
    const w = world();
    const id = rec(w);
    w.designation = designated('lane-b-project-a');
    expect(pass(w).counts).toMatchObject({ waiting: 1, queued: 0 });
    w.designation = NONE;
    expect(pass(w).counts).toMatchObject({ waiting: 1, queued: 0 });
    expect(stateOf(w, id)).toBe('recorded');
    expect(mails(w)).toHaveLength(0);
  });
  it('an unmeasured designation changes nothing and counts the row', () => {
    const w = world();
    const id = rec(w);
    w.designation = UNMEASURED;
    expect(pass(w).counts).toMatchObject({ unjudged: 1, queued: 0, waiting: 0 });
    expect(stateOf(w, id)).toBe('recorded');
  });
  it('a cite-settled row stays settled and counts as unjudged; acknowledge and mark rows stay settled', () => {
    const w = world();
    const cite = rec(w);
    const ack = rec(w);
    const mark = rec(w, { mark: true });
    // A later build wrote the cite row, and a nudge went out for each (so the unnudged scan sees none of them).
    w.db.prepare("UPDATE operator_messages SET state = 'settled', settledAt = 2, settledBy = 'cite', queuedAt = 1 WHERE id = ?").run(cite);
    w.db.prepare("UPDATE operator_messages SET state = 'settled', settledAt = 2, settledBy = 'acknowledge', queuedAt = 1 WHERE id = ?").run(ack);
    w.db.prepare('UPDATE operator_messages SET queuedAt = 1 WHERE id = ?').run(mark);
    const r = pass(w);
    expect(r.counts).toMatchObject({ kept: 2, unjudged: 1, unsettled: 0 });
    for (const id of [cite, ack, mark]) expect(stateOf(w, id)).toBe('settled');
  });
  it('an unmeasured citation read changes nothing and counts the rows', () => {
    const w = world();
    const cite = rec(w);
    w.db.prepare("UPDATE operator_messages SET state = 'settled', settledAt = 2, settledBy = 'cite', queuedAt = 1 WHERE id = ?").run(cite);
    const r = pass(w, () => ({ kind: 'unmeasured', why: 'fixture' }));
    expect(r.counts).toMatchObject({ unjudged: 1, unsettled: 0, kept: 0 });
    expect(stateOf(w, cite)).toBe('settled');
  });
  it('a measured read that does not cite a cite-settled row unsettles it to its delivery stage', () => {
    const w = world();
    const cite = rec(w);
    w.db.prepare("UPDATE operator_messages SET state = 'settled', settledAt = 2, settledBy = 'cite', queuedAt = 1 WHERE id = ?").run(cite);
    expect(pass(w, () => ({ kind: 'measured', cited: new Set() })).counts).toMatchObject({ unsettled: 1 });
    expect(stateOf(w, cite)).toBe('queued');
  });
  it('a mail operator-message:9 beside a store whose highest is 7 warns, naming 9 and 7', () => {
    const w = world();
    for (let i = 0; i < 7; i++) rec(w, { mark: true });
    w.db.prepare('UPDATE operator_messages SET queuedAt = 1').run();
    w.coord.db.prepare("INSERT INTO mail (at, fromId, fromUuid, toId, runId, kind, subject, body, artifacts) VALUES (1, 'operator', '', ?, NULL, 'status', 'operator-message:9', 'b', '[]')").run(S);
    const r = pass(w);
    expect(r.lines.filter((l) => l.includes('9') && l.includes('7'))).toHaveLength(1);
    const quiet = world();
    rec(quiet, { mark: true });
    quiet.db.prepare('UPDATE operator_messages SET queuedAt = 1').run();
    expect(pass(quiet).lines).toEqual([]);
  });
  it('highestOperatorMessageMail reads every state and only operator mail with a well-formed subject', () => {
    const w = world();
    expect(w.coord.highestOperatorMessageMail()).toBe('none');
    const ins = (from: string, subject: string): void => { w.coord.db.prepare("INSERT INTO mail (at, fromId, fromUuid, toId, runId, kind, subject, body, artifacts) VALUES (1, ?, '', ?, NULL, 'status', ?, 'b', '[]')").run(from, S, subject); };
    ins('operator', 'operator-message:3'); ins('operator', 'operator-message:12'); ins('operator', 'operator-message:07'); ins('lane-b-project-a', 'operator-message:99');
    expect(w.coord.highestOperatorMessageMail()).toBe(12);
  });
  // ---- review 2550, fix round 1 ----
  /** A nudge mail with one delivery in `state`, as the mail lane leaves it; returns the delivery id. */
  const delivery = (w: World, id: number, state: string): number => {
    nudgeMail(w, id, state);
    const mailId = (w.coord.db.prepare('SELECT id FROM mail WHERE subject = ?').get(operatorMessageSubject(id)) as { id: number }).id;
    return Number(w.coord.db.prepare('INSERT INTO mail_deliveries (mailId, toId, state, envelope) VALUES (?, ?, ?, ?)').run(mailId, S, state, 'e').lastInsertRowid);
  };
  const queueMove = (w: World, id: number): void => { expect(w.store.moveMessage(id, 'queue', 'route', 2_000).ok).toBe(true); };
  const ackStub = (w: World) => ({ db: w.coord.db, markAcked: (deliveryId: number) => { w.coord.db.prepare("UPDATE mail_deliveries SET state = 'acked' WHERE id = ?").run(deliveryId); return { ok: true as const, state: 'acked' as const }; } });

  it('F3: a queued row whose nudge delivery is ACKED is moved to delivered; an unacked one stays queued', () => {
    const w = world();
    const acked = rec(w); const waiting = rec(w);
    queueMove(w, acked); queueMove(w, waiting);
    delivery(w, acked, 'acked'); delivery(w, waiting, 'delivered');
    const r = pass(w);
    expect(r.counts).toMatchObject({ delivered: 1, errors: 0 });
    expect([stateOf(w, acked), stateOf(w, waiting)]).toEqual(['delivered', 'queued']);
    expect(rowOf(w, acked).deliveredAt).toBe(NOW);
    expect(pass(w).counts).toMatchObject({ delivered: 0 });
  });
  it('F3: a recorded row linked to an acked nudge is queued and delivered in the same pass', () => {
    const w = world();
    const id = rec(w);
    delivery(w, id, 'acked');
    expect(pass(w).counts).toMatchObject({ linked: 1, delivered: 1 });
    expect(stateOf(w, id)).toBe('delivered');
  });
  it('F3: the ack at the mail lane moves a refused deliver nowhere, and the next boot delivers it', () => {
    const w = world();
    const id = rec(w);
    queueMove(w, id);
    const d = delivery(w, id, 'delivered');
    const warn: string[] = [];
    const refuse = { moveMessage: () => ({ ok: false as const, error: 'write-failed' as const, detail: 'fixture' }), messageStateOf: w.store.messageStateOf.bind(w.store) };
    settleOperatorNudge({ coord: ackStub(w), operatorModel: refuse, now: 3_000, warn: (l) => warn.push(l) }, { id: d, deliveredAt: null }, id);
    expect(warn.join('\n')).toContain('deliver refused');
    expect(stateOf(w, id)).toBe('queued');
    expect((w.coord.db.prepare('SELECT state FROM mail_deliveries WHERE id = ?').get(d) as { state: string }).state).toBe('acked');
    expect(pass(w).counts).toMatchObject({ delivered: 1 });
    expect(stateOf(w, id)).toBe('delivered');
  });
  it('F3: a replayed delivery (deliveredAt set, the process died before the settle) moves a still-queued row; a delivered one is left alone', () => {
    const w = world();
    const id = rec(w);
    queueMove(w, id);
    const d = delivery(w, id, 'delivered');
    const spy = vi.spyOn(w.store, 'moveMessage');
    settleOperatorNudge({ coord: ackStub(w), operatorModel: w.store, now: 3_000, warn: () => {} }, { id: d, deliveredAt: 2_500 }, id);
    expect(stateOf(w, id)).toBe('delivered');
    expect(spy).toHaveBeenCalledWith(id, 'deliver', 'mail-lane', 3_000);
    spy.mockClear();
    settleOperatorNudge({ coord: ackStub(w), operatorModel: w.store, now: 4_000, warn: () => {} }, { id: d, deliveredAt: 2_500 }, id);
    expect(spy).not.toHaveBeenCalled();
  });
  it('N3: a nudge the boot pass queues writes the @overlord mark in the same transaction as the mail', () => {
    const w = world();
    rec(w);
    expect(w.coord.operatorMarks()).toEqual({ ok: true, rows: [] });
    expect(pass(w).counts).toMatchObject({ queued: 1 });
    expect(w.coord.operatorMarks()).toEqual({ ok: true, rows: [{ programme: OVERLORD_OPERATOR_MARK, at: NOW, quiet: null }] });
    // The mark and the mail commit together: a mark that throws rolls the mail back.
    const x = world();
    rec(x);
    x.coord.putOperatorMark = () => { throw new Error('mark boom'); };
    const r = pass(x);
    expect(r.counts).toMatchObject({ queued: 0, errors: 1 });
    expect(mails(x)).toHaveLength(0);
  });
  it('F8: a coordination call that throws is logged and counted, and the other rows are still handled', () => {
    const w = world();
    const bad = rec(w); const good = rec(w);
    const real = w.coord.hasMailWithSubject.bind(w.coord);
    w.coord.hasMailWithSubject = (from, run, to, subject) => { if (subject === operatorMessageSubject(bad)) throw new Error('db busy'); return real(from, run, to, subject); };
    w.coord.highestOperatorMessageMail = () => { throw new Error('mail read boom'); };
    const r = pass(w);
    expect(r.counts).toMatchObject({ queued: 1, errors: 2 });
    expect(stateOf(w, bad)).toBe('recorded');
    expect(stateOf(w, good)).toBe('queued');
    expect(r.lines.join('\n')).toContain(`message ${bad} not re-nudged (db busy)`);
    expect(r.lines.join('\n')).toContain('mail read boom');
  });
  it('a move whose sequence line is refused leaves one boot line, which the server prints with its prefix once (review 3852 F4)', () => {
    const w = world();
    const id = rec(w);
    w.coord.db.exec('DROP TABLE overlord_sequence');
    const r = pass(w);
    expect(stateOf(w, id)).toBe('queued');
    const missing = r.lines.filter((l) => l.includes(`operator message ${id}:`));
    expect(missing).toHaveLength(1);
    // `index.ts` prints each boot line as `ccrc-server: ${line}`.
    expect(`ccrc-server: ${missing[0]!}`).toMatch(new RegExp(`^ccrc-server: operator message ${id}: its sequence line \\(queued\\) was not written \\(`));
  });
  it('the summary line carries counts and never a text', () => {
    const w = world();
    rec(w, { text: 'a secret sentence' });
    const r = pass(w);
    const line = bootPassSummary(r.counts);
    expect(line).toBe('operator model boot pass: kept 0, unsettled 0, unjudged 0, linked 0, queued 1, waiting 0, delivered 0, errors 0');
    expect(line + r.lines.join('\n')).not.toContain('secret');
  });
});

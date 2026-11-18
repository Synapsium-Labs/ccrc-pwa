// Overlord W1, the private store B (plan w1-private-store.md, Task 6): the boot pass (I8). The deciders are pure cases; the pass
// runs on fixture files only (a migrated coord.db copy, a temp operator-model.db, a privacy-issuer double), neutral names.
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { copyFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { actorOf } from '../src/accounts/audit.js';
import { attributionIdentity } from '../src/auth/attributionIdentity.js';
import { openCoordDb } from '../src/coord/db.js';
import { CoordStore } from '../src/coord/store.js';
import * as deciders from '../src/operatorModel/messages.js';
import type { CitationRead } from '../src/operatorModel/messages.js';
import { bootSettlementCases, nudgeRecoveryCases } from './sim/operatorModelSets.js';
import { defaultOperatorModelDbPath, openOperatorModelDb } from '../src/operatorModel/db.js';
import { OperatorModelStore, type PrivacyIssuer } from '../src/operatorModel/store.js';
import { bootPassSummary, runOperatorModelBootPass, w1Citations } from '../src/operatorModel/bootPass.js';
import { operatorMessageSubject } from '../../shared/operatorMessages.js';
import type { DesignationRead, DesignationView } from '../../shared/overlord-designation.js';
import { mkTmp, removeTmpFixtures } from './tmpHelpers.js';

const ACTOR = attributionIdentity({ attribute: async () => ({ ok: true }), incarnation: async () => ({ kind: 'unmeasured', reason: 'absent' }) })
  .operator(actorOf('Fixture browser', 'abcdef0123456789'));
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
  const r = w.store.recordMessage({ at: 1_000, sessionId: S, term: 1, actor: ACTOR, text: 'hello', mark: false, composedKey: null, ...over });
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
  it('the summary line carries counts and never a text', () => {
    const w = world();
    rec(w, { text: 'a secret sentence' });
    const r = pass(w);
    const line = bootPassSummary(r.counts);
    expect(line).toBe('operator model boot pass: kept 0, unsettled 0, unjudged 0, linked 0, queued 1, waiting 0');
    expect(line + r.lines.join('\n')).not.toContain('secret');
  });
});

// Sequence PR B1, piece 1 (Overlord §10.4; call 1218, slug `message-lines-stamp-after-the-move`): every move of an operator message
// that changes its state word writes one `message` line, in a coordination transaction of its own, right after the private store's
// move commits and in the same synchronous segment; a refused or failed stamp changes nothing the mover answers or does, rolls back
// only its own line, and writes one server log line naming the message id. Every line carries the move's actor word and the server's
// actor kind. Fixtures only: an in-tree migrated coord.db copy and a private store in a temp directory.
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import type { DatabaseSync } from 'node:sqlite';
import { copyFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { gateActorOf } from '../src/accounts/audit.js';
import { attributionIdentity } from '../src/auth/attributionIdentity.js';
import { openCoordDb } from '../src/coord/db.js';
import { CoordStore } from '../src/coord/store.js';
import { defaultOperatorModelDbPath, openOperatorModelDb } from '../src/operatorModel/db.js';
import { OperatorModelStore, type PrivacyIssuer } from '../src/operatorModel/store.js';
import { moveOperatorMessage, stampOperatorMessageLine } from '../src/operatorModel/messageLine.js';
import { settleAckedOperatorNudge, settleOperatorNudge } from '../src/operatorModel/nudgeLane.js';
import { runOperatorModelBootPass, w1Citations } from '../src/operatorModel/bootPass.js';
import { recordOperatorPrompt } from '../src/operatorModel/promptRecord.js';
import { operatorMessageSubject } from '../../shared/operatorMessages.js';
import type { DesignationRead, DesignationView } from '../../shared/overlord-designation.js';
import { mkTmp, removeTmpFixtures } from './tmpHelpers.js';

const IDENTITY = attributionIdentity({ attribute: async () => ({ ok: true }), incarnation: async () => ({ kind: 'unmeasured', reason: 'absent' }) });
const GATE_ACTOR = gateActorOf('Fixture browser', 'abcdef0123456789');
const ACTOR = IDENTITY.operator(GATE_ACTOR);
const S = 'lane-a-project-a';
const NOW = 5_000;
const designated: DesignationRead = { kind: 'designated', sessionId: S, term: 1, row: {} as DesignationView };

let template = '';
const open: DatabaseSync[] = [];
beforeAll(() => { template = path.join(mkTmp('ccrc-msgline-template-'), 'coord.db'); openCoordDb(template).close(); });
afterEach(() => { for (const d of open.splice(0)) if (d.isOpen) d.close(); });
afterAll(() => removeTmpFixtures());

function issuer(): PrivacyIssuer {
  let last = 0;
  return { kind: 'ready', issue(hi) { last = Math.max(hi ?? 0, last) + 1; return { ok: true, id: last }; } };
}
interface World { coord: CoordStore; store: OperatorModelStore; warned: string[]; warn: (l: string) => void }
function world(): World {
  const dir = path.join(mkTmp('ccrc-msgline-'), '.ccrc');
  mkdirSync(dir, { recursive: true });
  copyFileSync(template, path.join(dir, 'coord.db'));
  const coordDb = openCoordDb(path.join(dir, 'coord.db')); open.push(coordDb);
  const db = openOperatorModelDb(defaultOperatorModelDbPath(mkTmp('ccrc-msgline-om-'))); open.push(db);
  const warned: string[] = [];
  const w: World = { coord: new CoordStore(coordDb), store: new OperatorModelStore(db, issuer()), warned, warn: (l) => { warned.push(l); } };
  w.coord.designationRead = () => designated;
  return w;
}
const rec = (w: World, mark = false): number => {
  const r = w.store.recordMessage({ at: 1_000, sessionId: S, term: 1, actor: ACTOR, text: 'hello', mark, composedKey: null, offRecord: false });
  if (!r.ok) throw new Error(`${r.error}: ${r.detail}`);
  return r.value.id;
};
const lines = (w: World): { id: string; state: string; actor: string; actorKind: string; at: number }[] =>
  w.coord.db.prepare("SELECT id, state, actor, actorKind, at FROM overlord_sequence WHERE kind = 'message' ORDER BY seq").all() as never;
const refuseLines = (w: World): void => {
  w.coord.db.exec("CREATE TEMP TRIGGER refuse_lines BEFORE INSERT ON overlord_sequence BEGIN SELECT RAISE(ABORT, 'refused for the test'); END");
};
const line = (id: number, state: string, actor: string, at = NOW) => ({ id: String(id), state, actor, actorKind: 'server', at });

describe('moveOperatorMessage: the move, then its line, in one synchronous segment', () => {
  it('a move that changes the state word writes one line with the move\'s actor and the server\'s kind', () => {
    const w = world(); const id = rec(w);
    const moved = moveOperatorMessage({ store: w.store, coordDb: w.coord.db, warn: w.warn }, id, 'queue', 'route', NOW);
    expect(moved).toMatchObject({ ok: true, value: { changed: true, state: 'queued', from: 'recorded' } });
    expect(lines(w)).toEqual([line(id, 'queued', 'route')]);
    expect(w.warned).toEqual([]);
  });
  it('a move that changes only a stamp (queue on a marked, settled row; a late deliver after the pick-up) writes no line', () => {
    const w = world(); const id = rec(w, true);
    expect(moveOperatorMessage({ store: w.store, coordDb: w.coord.db, warn: w.warn }, id, 'queue', 'boot-pass', NOW))
      .toMatchObject({ ok: true, value: { changed: true, state: 'settled' } });
    const id2 = rec(w);
    moveOperatorMessage({ store: w.store, coordDb: w.coord.db, warn: w.warn }, id2, 'pick-up', 'hook', NOW);
    expect(moveOperatorMessage({ store: w.store, coordDb: w.coord.db, warn: w.warn }, id2, 'deliver', 'mail-lane', NOW + 1))
      .toMatchObject({ ok: true, value: { changed: true, state: 'picked-up', from: 'picked-up' } });
    expect(lines(w)).toEqual([line(id2, 'picked-up', 'hook')]);
  });
  it('no microtask between the move and its line: the answer is no promise, and the line stands the moment it returns', () => {
    const w = world(); const id = rec(w);
    const deps = { store: w.store, coordDb: w.coord.db, warn: w.warn };
    const moves = [['queue', 'route'], ['deliver', 'mail-lane'], ['pick-up', 'hook'], ['settle', 'route']] as const;
    for (const [event, actor] of moves) {
      const r: unknown = moveOperatorMessage(deps, id, event, actor, NOW);
      expect(r instanceof Promise).toBe(false);
      expect(lines(w).at(-1)).toMatchObject({ actor });
    }
    expect(lines(w).map((l) => l.state)).toEqual(['queued', 'delivered', 'picked-up', 'settled']);
  });
  it('a refused move writes no line and answers the refusal', () => {
    const w = world();
    expect(moveOperatorMessage({ store: w.store, coordDb: w.coord.db, warn: w.warn }, 999, 'queue', 'route', NOW)).toMatchObject({ ok: false, error: 'refused' });
    expect(lines(w)).toEqual([]);
  });
  it('a refused stamp changes nothing the mover answers or does, rolls back only its line, and logs the id once', () => {
    const w = world(); const id = rec(w); refuseLines(w);
    const before = w.coord.db.prepare('SELECT count(*) AS n FROM mail').get();
    expect(moveOperatorMessage({ store: w.store, coordDb: w.coord.db, warn: w.warn }, id, 'queue', 'route', NOW))
      .toMatchObject({ ok: true, value: { changed: true, state: 'queued' } });
    expect(w.store.messageStateOf(id)).toEqual({ kind: 'measured', value: 'queued' });
    expect(lines(w)).toEqual([]);
    expect(w.coord.db.prepare('SELECT count(*) AS n FROM mail').get()).toEqual(before);
    expect(w.warned).toEqual([`ccrc-server: operator message ${id}: its sequence line (queued) was not written (write-failed)`]);
    expect(w.warned[0]).not.toContain('hello');
  });
  it('with no coordination store the move still lands, and the missing line is logged', () => {
    const w = world(); const id = rec(w);
    expect(moveOperatorMessage({ store: w.store, coordDb: undefined, warn: w.warn }, id, 'queue', 'route', NOW)).toMatchObject({ ok: true });
    expect(w.warned).toEqual([`ccrc-server: operator message ${id}: its sequence line (queued) was not written (no coordination store)`]);
  });
  it('stampOperatorMessageLine writes the marked message\'s settled line as the route\'s', () => {
    const w = world(); const id = rec(w, true);
    stampOperatorMessageLine({ coordDb: w.coord.db, warn: w.warn }, id, 'settled', 'route', NOW);
    expect(lines(w)).toEqual([line(id, 'settled', 'route')]);
  });
});

describe('every mover stamps through it', () => {
  const prompt = (w: World, text: string) => recordOperatorPrompt({
    gate: () => ({ pass: true, actor: GATE_ACTOR }) as never, identity: IDENTITY, store: w.store, coord: w.coord, wall: () => NOW, warn: w.warn,
  }, S, 1, { text, sendKey: `send-key-${text.length}`.padEnd(24, 'x') } as never);
  it('the prompt route: an unmarked message\'s queued line, and a marked one\'s settled line right after its record', async () => {
    const w = world();
    const a = await prompt(w, 'hello');
    expect(a).toMatchObject({ kind: 'answer', status: 200, body: { ok: true, state: 'queued' } });
    const b = await prompt(w, '/icommand');
    expect(b).toMatchObject({ kind: 'answer', status: 200, body: { ok: true, state: 'settled' } });
    const idOf = (r: typeof a): number => {
      if (r.kind !== 'answer') throw new Error('the gate replied');
      return r.body['messageId'] as number;
    };
    const [ida, idb] = [idOf(a), idOf(b)];
    expect(lines(w)).toEqual([line(ida, 'queued', 'route'), line(idb, 'settled', 'route')]);
  });
  it('the mail lane\'s delivery, and a session\'s own ack of its nudge, stamp delivered as the mail lane\'s', () => {
    const w = world(); const a = rec(w); const b = rec(w);
    settleOperatorNudge({ coord: w.coord, operatorModel: w.store, now: NOW, warn: w.warn }, { id: 0, deliveredAt: null }, a);
    w.coord.db.prepare("INSERT INTO mail (at, fromId, fromUuid, toId, runId, kind, subject, body, artifacts) VALUES (1, 'operator', '', ?, NULL, 'status', ?, 'b', '[]')")
      .run(S, operatorMessageSubject(b));
    const mailId = Number((w.coord.db.prepare('SELECT max(id) AS m FROM mail').get() as { m: number }).m);
    settleAckedOperatorNudge({ coord: w.coord, operatorModel: w.store, now: NOW, warn: w.warn }, mailId);
    expect(lines(w)).toEqual([line(a, 'delivered', 'mail-lane'), line(b, 'delivered', 'mail-lane')]);
  });
  it('the boot pass: the queue arm and the deliver arm stamp as the boot pass\'s', () => {
    const w = world(); const id = rec(w);
    runOperatorModelBootPass({ operatorModel: w.store, coord: w.coord, citations: w1Citations, now: () => NOW });
    expect(lines(w)).toEqual([line(id, 'queued', 'boot-pass')]);
    const mailId = Number((w.coord.db.prepare('SELECT max(id) AS m FROM mail').get() as { m: number }).m);
    w.coord.db.prepare("UPDATE mail_deliveries SET state = 'acked', ackedAt = 1 WHERE mailId = ?").run(mailId);
    runOperatorModelBootPass({ operatorModel: w.store, coord: w.coord, citations: w1Citations, now: () => NOW + 1 });
    expect(lines(w)).toEqual([line(id, 'queued', 'boot-pass'), line(id, 'delivered', 'boot-pass', NOW + 1)]);
  });
  it('the boot pass\'s unsettle stamps the delivery stage it moved the row back to', () => {
    const w = world(); const id = rec(w);
    const deps = { store: w.store, coordDb: w.coord.db, warn: w.warn };
    moveOperatorMessage(deps, id, 'deliver', 'mail-lane', NOW);
    moveOperatorMessage(deps, id, 'settle', 'citing-door', NOW);
    runOperatorModelBootPass({ operatorModel: w.store, coord: w.coord, citations: () => ({ kind: 'measured', cited: new Set<number>() }), now: () => NOW + 2 });
    expect(lines(w)).toContainEqual(line(id, 'delivered', 'boot-pass', NOW + 2));
  });
});

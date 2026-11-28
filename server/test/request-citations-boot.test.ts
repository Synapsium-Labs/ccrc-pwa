// Overlord W2, request record A (plan `w2-requests.md` Task A4, section 6 "The boot pass's three inputs"; RQ11, F14): the boot pass's
// `spent` arm and the measured citation adapter over the request record's cited messages. The pass runs on fixture files only (a
// migrated coord.db copy, a temp operator-model.db, a privacy-issuer double), neutral names.
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { copyFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { gateActorOf } from '../src/accounts/audit.js';
import { attributionIdentity } from '../src/auth/attributionIdentity.js';
import { openCoordDb } from '../src/coord/db.js';
import { tx } from '../src/coord/tx.js';
import { CoordStore } from '../src/coord/store.js';
import { applyRequestInsertInTx, citedMessagesForBoot, planRequestInsertInTx } from '../src/coord/overlordRequestStore.js';
import { bootSpend, type CitationRead, type RestoreFloorRead } from '../src/operatorModel/messages.js';
import { defaultOperatorModelDbPath, openOperatorModelDb } from '../src/operatorModel/db.js';
import { OperatorModelStore, type PrivacyIssuer } from '../src/operatorModel/store.js';
import { bootPassSummary, requestCitations, runOperatorModelBootPass } from '../src/operatorModel/bootPass.js';
import type { DesignationRead, DesignationView } from '../../shared/overlord-designation.js';
import { mkTmp, removeTmpFixtures } from './tmpHelpers.js';

const ACTOR = attributionIdentity({ attribute: async () => ({ ok: true }), incarnation: async () => ({ kind: 'unmeasured', reason: 'absent' }) })
  .operator(gateActorOf('Fixture browser', 'abcdef0123456789'));
const NOW = 5_000;
const S = 'lane-a-project-a';
const SECRET = 'a sentence only the operator wrote';

let template = '';
const open: DatabaseSync[] = [];
beforeAll(() => { template = path.join(mkTmp('ccrc-citations-template-'), 'coord.db'); openCoordDb(template).close(); });
afterEach(() => { for (const d of open.splice(0)) if (d.isOpen) d.close(); });
afterAll(() => removeTmpFixtures());

function issuer(): PrivacyIssuer {
  let last = 0;
  return { kind: 'ready', issue(hi) { last = Math.max(hi ?? 0, last) + 1; return { ok: true, id: last }; } };
}
interface World { coord: CoordStore; db: DatabaseSync; store: OperatorModelStore }
function world(): World {
  const dir = path.join(mkTmp('ccrc-citations-'), '.ccrc');
  mkdirSync(dir, { recursive: true });
  copyFileSync(template, path.join(dir, 'coord.db'));
  const coordDb = openCoordDb(path.join(dir, 'coord.db'));
  open.push(coordDb);
  const db = openOperatorModelDb(defaultOperatorModelDbPath(mkTmp('ccrc-citations-om-')));
  open.push(db);
  const w: World = { coord: new CoordStore(coordDb), db, store: new OperatorModelStore(db, issuer()) };
  w.coord.designationRead = (): DesignationRead => ({ kind: 'designated', sessionId: S, term: 1, row: {} as DesignationView });
  return w;
}
/** One message, settled by the mark and already nudged, so the pass's re-nudge arms leave it alone. */
const rec = (w: World, over: Partial<Parameters<OperatorModelStore['recordMessage']>[0]> = {}): number => {
  const r = w.store.recordMessage({ at: 1_000, sessionId: S, term: 1, actor: ACTOR, text: SECRET, mark: true, composedKey: null, ...over });
  if (!r.ok) throw new Error(`${r.error}: ${r.detail}`);
  w.db.prepare('UPDATE operator_messages SET queuedAt = 1 WHERE id = ?').run(r.value.id);
  return r.value.id;
};
/** A message left in `delivered` (queued, then delivered), also already nudged. */
const recDelivered = (w: World): number => {
  const id = rec(w, { mark: false });
  expect(w.store.moveMessage(id, 'deliver', 'mail-lane', 2_000).ok).toBe(true);
  return id;
};
const stateOf = (w: World, id: number): string => (w.db.prepare('SELECT state FROM operator_messages WHERE id = ?').get(id) as { state: string }).state;
const lines = (w: World, kind = 'message') => w.coord.db.prepare('SELECT seq, kind, id, state, actor, actorKind, at FROM overlord_sequence WHERE kind = ? ORDER BY seq').all(kind) as
  { seq: number; kind: string; id: string; state: string; actor: string; actorKind: string; at: number }[];

/** A root request citing `ids` (origin operator), or a child of `parent` citing them as non-root, through the real store. */
const cite = (w: World, ids: readonly number[], parent: number | null = null): number => tx(w.coord.db, () => {
  const p = planRequestInsertInTx(w.coord.db, { origin: 'operator', summary: 's', parentRequestId: parent, consulted: [], expectedPaths: [],
    cites: ids.map((messageId) => ({ messageId, sha256: 'a'.repeat(64), root: parent === null })), journalHighest: null, actor: 'overlord',
    actorId: 'overlord-a', at: 1_500 });
  if (!p.ok) throw new Error(`insert refused: ${p.why}`);
  return applyRequestInsertInTx(w.coord.db, p.plan).row.id;
});
const citations = (w: World, floor: RestoreFloorRead = { kind: 'none' }) => (): CitationRead => requestCitations(citedMessagesForBoot(w.coord.db), floor);
const pass = (w: World, port: () => CitationRead) => runOperatorModelBootPass({ operatorModel: w.store, coord: w.coord, citations: port, now: () => NOW });

// ------------------------------------------------------------------------------------------------------------ the decider

describe('bootSpend', () => {
  const row = (id: number, state: 'settled' | 'spent' | 'delivered' | 'unknown') => ({ id, state });
  const measured = (over: Partial<Extract<CitationRead, { kind: 'measured' }>> = {}): CitationRead => ({ kind: 'measured', cited: new Set(), ...over });
  it('a spent row keeps its mark whatever the citations say', () => {
    expect(bootSpend(row(1, 'spent'), measured({ rootCited: new Set([1]), restoreFloor: { kind: 'floor', id: 9 } }))).toBe('keep');
    expect(bootSpend(row(1, 'spent'), { kind: 'unmeasured', why: 'x' })).toBe('keep');
  });
  it('citations not measured leave an unspent row unjudged', () => {
    expect(bootSpend(row(1, 'settled'), { kind: 'unmeasured', why: 'x' })).toBe('unjudged');
    expect(bootSpend(row(1, 'settled'), { kind: 'not-applicable' })).toBe('unjudged');
  });
  it('a root-cited row spends; a merely cited one, and a row above the floor, keep; a floor of none or unreadable spends nothing', () => {
    expect(bootSpend(row(1, 'settled'), measured({ rootCited: new Set([1]) }))).toBe('spend');
    expect(bootSpend(row(1, 'delivered'), measured({ cited: new Set([1]), rootCited: new Set() }))).toBe('keep');
    expect(bootSpend(row(40, 'settled'), measured({ restoreFloor: { kind: 'floor', id: 40 } }))).toBe('spend');
    expect(bootSpend(row(41, 'settled'), measured({ restoreFloor: { kind: 'floor', id: 40 } }))).toBe('keep');
    expect(bootSpend(row(1, 'settled'), measured({ restoreFloor: { kind: 'none' } }))).toBe('keep');
    expect(bootSpend(row(1, 'settled'), measured({ restoreFloor: { kind: 'unreadable', why: 'x' } }))).toBe('keep');
    expect(bootSpend(row(1, 'settled'), measured())).toBe('keep');
  });
});

// ---------------------------------------------------------------------------------------------------------- the adapter

describe('requestCitations maps the store\'s three answers apart', () => {
  it('absent is not-applicable, unmeasured is unmeasured with its reason, measured carries both sets and the floor', () => {
    expect(requestCitations({ kind: 'absent' }, { kind: 'none' })).toEqual({ kind: 'not-applicable' });
    expect(requestCitations({ kind: 'unmeasured', why: 'boom' }, { kind: 'floor', id: 3 })).toEqual({ kind: 'unmeasured', why: 'boom' });
    const cited = new Set([1, 2]);
    const rootCited = new Set([1]);
    expect(requestCitations({ kind: 'measured', cited, rootCited }, { kind: 'floor', id: 40 }))
      .toEqual({ kind: 'measured', cited, rootCited, restoreFloor: { kind: 'floor', id: 40 } });
    expect(requestCitations({ kind: 'measured', cited, rootCited }, { kind: 'unreadable', why: 'x' }))
      .toMatchObject({ kind: 'measured', restoreFloor: { kind: 'unreadable', why: 'x' } });
  });
});

describe('citedMessagesForBoot', () => {
  it('reads every cited id and the root-cited ones apart', () => {
    const w = world();
    const a = rec(w); const b = rec(w); const c = rec(w);
    const parent = cite(w, [a, b]);
    cite(w, [b], parent);                                       // a child cites b again, as a non-root
    expect(citedMessagesForBoot(w.coord.db)).toEqual({ kind: 'measured', cited: new Set([a, b]), rootCited: new Set([a, b]) });
    const second = cite(w, [c]);
    cite(w, [c], second);
    expect(citedMessagesForBoot(w.coord.db)).toEqual({ kind: 'measured', cited: new Set([a, b, c]), rootCited: new Set([a, b, c]) });
  });

  it('a non-root citation alone is cited and not root-cited', () => {
    const w = world();
    const a = rec(w); const b = rec(w);
    const parent = cite(w, [a]);
    // A child may cite only what its root cites, so plant the extra non-root row by hand to read the two sets apart.
    w.coord.db.prepare("INSERT INTO overlord_request_messages (requestId, messageId, sha256, root, at) VALUES (?, ?, 'h', 0, 1)").run(parent, b);
    expect(citedMessagesForBoot(w.coord.db)).toEqual({ kind: 'measured', cited: new Set([a, b]), rootCited: new Set([a]) });
  });

  it('a database with none of the migration\'s tables answers absent, and a closed handle answers unmeasured', () => {
    const bare = new DatabaseSync(':memory:');
    open.push(bare);
    expect(citedMessagesForBoot(bare)).toEqual({ kind: 'absent' });
    const w = world();
    w.coord.db.exec('DROP TABLE overlord_request_messages');
    expect(citedMessagesForBoot(w.coord.db)).toEqual({ kind: 'absent' });
    const closed = world();
    closed.coord.db.close();
    expect(citedMessagesForBoot(closed.coord.db)).toMatchObject({ kind: 'unmeasured' });
  });

  it('a citation row with no integer message id is unmeasured, never skipped', () => {
    const w = world();
    w.coord.db.exec('DROP TABLE overlord_request_messages');
    w.coord.db.exec('CREATE TABLE overlord_request_messages (requestId INTEGER, messageId, sha256 TEXT, root INTEGER, at INTEGER)');
    w.coord.db.exec("INSERT INTO overlord_request_messages VALUES (1, 'not-a-number', 'h', 1, 1)");
    expect(citedMessagesForBoot(w.coord.db)).toMatchObject({ kind: 'unmeasured' });
  });
});

// ------------------------------------------------------------------------------------------------------------ the pass

describe('the spend arm of runOperatorModelBootPass', () => {
  it('a root-cited row in settled is spent, with a message sequence line `spent` stamped by the boot pass; a second boot spends nothing', () => {
    const w = world();
    const id = rec(w);
    expect(stateOf(w, id)).toBe('settled');
    cite(w, [id]);
    const r = pass(w, citations(w));
    expect(stateOf(w, id)).toBe('spent');
    expect(r.counts.spent).toBe(1);
    expect(w.db.prepare('SELECT spentAt FROM operator_messages WHERE id = ?').get(id)).toEqual({ spentAt: NOW });
    expect(lines(w)).toEqual([{ seq: expect.any(Number), kind: 'message', id: String(id), state: 'spent', actor: 'boot-pass', actorKind: 'server', at: NOW }]);
    const again = pass(w, citations(w));
    expect(again.counts.spent).toBe(0);
    expect(lines(w)).toHaveLength(1);
  });

  it('a root-cited row in delivered is spent too', () => {
    const w = world();
    const id = recDelivered(w);
    expect(stateOf(w, id)).toBe('delivered');
    cite(w, [id]);
    expect(pass(w, citations(w)).counts.spent).toBe(1);
    expect(stateOf(w, id)).toBe('spent');
    expect(lines(w).map((l) => l.state)).toEqual(['spent']);
  });

  it('a spent row with no root citation stays spent, and the arm stamps nothing for it', () => {
    const w = world();
    const id = rec(w);
    expect(w.store.moveMessage(id, 'spend', 'boot-pass', 2_000).ok).toBe(true);
    const r = pass(w, citations(w));
    expect(stateOf(w, id)).toBe('spent');
    expect(r.counts.spent).toBe(0);
    expect(lines(w)).toEqual([]);
    expect(w.db.prepare('SELECT spentAt FROM operator_messages WHERE id = ?').get(id)).toEqual({ spentAt: 2_000 });
  });

  it('a cited message the private store has no row for is left alone, and the pass goes on', () => {
    const w = world();
    const id = rec(w);
    cite(w, [id + 50]);
    const r = pass(w, citations(w));
    expect(r.counts.spent).toBe(0);
    expect(stateOf(w, id)).toBe('settled');
    expect(r.lines).toEqual([]);
  });

  it('a cited (non-root) row in delivered is NOT settled by the boot pass: W1\'s actor map lets only the citing door settle (known limit)', () => {
    const w = world();
    const a = rec(w);
    const id = recDelivered(w);
    const parent = cite(w, [a, id]);
    // Demote the citation to a non-root one, as a child's would be: cited and not root-cited.
    w.coord.db.prepare('UPDATE overlord_request_messages SET root = 0 WHERE requestId = ? AND messageId = ?').run(parent, id);
    const r = pass(w, citations(w));
    expect(stateOf(w, id)).toBe('delivered');
    expect(stateOf(w, a)).toBe('spent');
    expect(r.counts).toMatchObject({ spent: 1, unsettled: 0 });
    expect(lines(w).map((l) => l.id)).toEqual([String(a)]);
  });

  describe('the restore floor', () => {
    const many = (w: World, n: number): number[] => Array.from({ length: n }, () => rec(w));

    it('with a floor of 40, rows up to 40 are spent and row 41 is not', () => {
      const w = world();
      const ids = many(w, 41);
      const r = pass(w, citations(w, { kind: 'floor', id: 40 }));
      expect(r.counts.spent).toBe(40);
      for (const id of ids.slice(0, 40)) expect(stateOf(w, id), `row ${id}`).toBe('spent');
      expect(stateOf(w, ids[40]!)).toBe('settled');
      expect(lines(w)).toHaveLength(40);
      expect(lines(w).every((l) => l.state === 'spent' && l.actor === 'boot-pass')).toBe(true);
      expect(pass(w, citations(w, { kind: 'floor', id: 40 })).counts.spent).toBe(0);
    });

    it('a row both root-cited and under the floor is spent once', () => {
      const w = world();
      const [a, b] = many(w, 2) as [number, number];
      cite(w, [a]);
      const r = pass(w, citations(w, { kind: 'floor', id: 2 }));
      expect(r.counts.spent).toBe(2);
      expect(lines(w).map((l) => l.id)).toEqual([String(a), String(b)]);
    });

    it('with a floor of none, nothing is spent by the floor', () => {
      const w = world();
      const ids = many(w, 3);
      const r = pass(w, citations(w, { kind: 'none' }));
      expect(r.counts.spent).toBe(0);
      for (const id of ids) expect(stateOf(w, id)).toBe('settled');
      expect(lines(w)).toEqual([]);
      expect(r.lines).toEqual([]);
    });

    it('with an unreadable floor, nothing is spent by the floor, a root-cited row still is, and the line it logs holds no message text', () => {
      const w = world();
      const [a, b, c] = many(w, 3) as [number, number, number];
      cite(w, [c]);
      const r = pass(w, citations(w, { kind: 'unreadable', why: 'the journal could not be read' }));
      expect(r.counts.spent).toBe(1);
      expect([stateOf(w, a), stateOf(w, b), stateOf(w, c)]).toEqual(['settled', 'settled', 'spent']);
      const logged = r.lines.filter((l) => l.includes('restore floor'));
      expect(logged).toHaveLength(1);
      expect(logged[0]).toContain('nothing spent by the floor');
      expect(r.lines.join('\n')).not.toContain(SECRET);
      expect(r.lines.join('\n')).not.toContain('operator wrote');
    });
  });

  describe('a failed read changes nothing', () => {
    it('an unmeasured citation read (a citation row with no integer id) spends nothing and leaves every row as it was', () => {
      const w = world();
      const id = rec(w);
      const delivered = recDelivered(w);
      cite(w, [id]);
      const port = citations(w);
      w.coord.db.exec('DROP TABLE overlord_request_messages');
      w.coord.db.exec('CREATE TABLE overlord_request_messages (requestId INTEGER, messageId, sha256 TEXT, root INTEGER, at INTEGER)');
      w.coord.db.exec("INSERT INTO overlord_request_messages VALUES (1, 'x', 'h', 1, 1)");
      expect(port()).toMatchObject({ kind: 'unmeasured' });
      const r = pass(w, port);
      expect(r.counts.spent).toBe(0);
      expect([stateOf(w, id), stateOf(w, delivered)]).toEqual(['settled', 'delivered']);
      expect(lines(w)).toEqual([]);
    });

    it('a read over a closed handle is unmeasured through the adapter, and the pass over it spends nothing', () => {
      const w = world();
      const id = rec(w);
      cite(w, [id]);
      const closed = world();
      closed.coord.db.close();
      const port = (): CitationRead => requestCitations(citedMessagesForBoot(closed.coord.db), { kind: 'floor', id: 99 });
      expect(port()).toMatchObject({ kind: 'unmeasured' });
      const r = pass(w, port);
      expect(r.counts.spent).toBe(0);
      expect(stateOf(w, id)).toBe('settled');
      expect(lines(w)).toEqual([]);
    });

    it('a table not yet migrated answers not-applicable, and the pass behaves as W1\'s did', () => {
      const w = world();
      const id = rec(w);
      w.coord.db.exec('DROP TABLE overlord_request_messages');
      expect(citations(w)()).toEqual({ kind: 'not-applicable' });
      const r = pass(w, citations(w));
      expect(r.counts.spent).toBe(0);
      expect(stateOf(w, id)).toBe('settled');
    });

    it('a private-store read that fails defers the spends of that read, logs without a text, and the rest of the pass runs', () => {
      const w = world();
      const id = rec(w);
      cite(w, [id]);
      const spy = vi.spyOn(w.store, 'unspentAmong').mockReturnValue({ kind: 'unmeasured', why: 'fixture' });
      const r = pass(w, citations(w, { kind: 'floor', id: 1 }));
      spy.mockRestore();
      // The floor read still ran: row 1 is both root-cited and under the floor, so the floor spends it.
      expect(stateOf(w, id)).toBe('spent');
      expect(r.lines.filter((l) => l.includes('unspent rows unmeasured'))).toHaveLength(1);
      expect(r.lines.join('\n')).not.toContain(SECRET);
      const w2 = world();
      const id2 = rec(w2);
      cite(w2, [id2]);
      const spy2 = vi.spyOn(w2.store, 'unspentAmong').mockReturnValue({ kind: 'unmeasured', why: 'fixture' });
      const r2 = pass(w2, citations(w2));
      spy2.mockRestore();
      expect(stateOf(w2, id2)).toBe('settled');
      expect(r2.counts.spent).toBe(0);
    });
  });

  it('a move whose sequence line is refused still spends the row and leaves one boot line naming the id, never the words', () => {
    const w = world();
    const id = rec(w);
    cite(w, [id]);
    w.coord.db.exec('DROP TABLE overlord_sequence');
    const r = pass(w, citations(w));
    expect(stateOf(w, id)).toBe('spent');
    expect(r.counts.spent).toBe(1);
    const missing = r.lines.filter((l) => l.includes(`operator message ${id}:`));
    expect(missing).toHaveLength(1);
    expect(missing[0]).toContain('(spent)');
    expect(r.lines.join('\n')).not.toContain('operator wrote');
  });

  it('the counts carry `spent`, and the summary line says so and holds no text', () => {
    const w = world();
    const a = rec(w); rec(w);
    cite(w, [a]);
    const r = pass(w, citations(w));
    expect(r.counts.spent).toBe(1);
    const line = bootPassSummary(r.counts);
    expect(line).toBe('operator model boot pass: kept 1, unsettled 0, unjudged 0, linked 0, queued 0, waiting 0, delivered 0, errors 0, spent 1');
    expect(line + r.lines.join('\n')).not.toContain('operator wrote');
  });
});

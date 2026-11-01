/**
 * The Linear write journal (#1444, spec §7, D-7671; plan task LK7): the `linear_events` table and its one writer,
 * `LinearJournal`. Spec §14 row 9's clauses that need no route:
 *  - a row is inserted `pending`, and its outcome replaces `pending` once, later;
 *  - denial and refusal rows carry their word;
 *  - no column takes free text: every value is checked against its grammar, and a canary in any field is refused and
 *    lands in no table;
 *  - `result` holds a created issue's identifier or a created comment's id, and nothing else;
 *  - `viaFleet` marks what an `ok` row's `result` holds, by one indexed query;
 *  - rows older than 365 days are swept.
 * The route clauses (a journal failure refuses the write with no Linear call; each key act's row with the gate's
 * actor) land with the routes (LK9, LK11).
 */
import { describe, expect, it, vi } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { actorOf } from '../src/accounts/audit.js';
import { COORD_SCHEMA_VERSION, openCoordDb, tx } from '../src/coord/db.js';
import { MIGRATIONS } from '../src/coord/schema.js';
import {
  LINEAR_JOURNAL_FIELDS, LINEAR_JOURNAL_RETENTION_DAYS, LinearJournal, type LinearPendingInput,
} from '../src/linear/journal.js';
import { linearServicesFake, memCoordDb } from './linearServicesFake.js';
import { mkTmp } from './tmpHelpers.js';

const DAY_MS = 86_400_000;
const NOW = Date.UTC(2026, 10, 1, 12);
const WS = '11111111-2222-4333-8444-555555555555';
const COMMENT_ID = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';

const write = (over: Partial<LinearPendingInput> = {}): LinearPendingInput => ({
  op: 'update', sessionId: 'session-a', sessionUuid: 'uuid-a', actor: null, workspaceId: WS, teamKey: 'AAA',
  target: 'AAA-12', fields: ['title'], ...over,
});
const keyAct = (over: Partial<LinearPendingInput> = {}): LinearPendingInput => ({
  op: 'key-check', sessionId: null, sessionUuid: null, actor: actorOf('a test phone', 'ab'.repeat(32)),
  workspaceId: WS, teamKey: null, target: null, fields: [], ...over,
});

const rowsOf = (db: DatabaseSync): Record<string, unknown>[] =>
  db.prepare('SELECT * FROM linear_events ORDER BY id').all() as Record<string, unknown>[];
/** Every value in every row of every table, as one string: what "no table holds it" is measured on. */
const everyTable = (db: DatabaseSync): string => {
  const tables = (db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as { name: string }[]).map((t) => t.name);
  expect(tables).toContain('linear_events');
  return tables.map((t) => JSON.stringify(db.prepare(`SELECT * FROM "${t}"`).all())).join('\n');
};
const quiet = () => vi.spyOn(console, 'warn').mockImplementation(() => {});

describe('linear_events: one new migration that seeds nothing (#1444, D-7671)', () => {
  const CREATE = /CREATE TABLE linear_events(?![A-Za-z0-9_])/;
  const SLOT = MIGRATIONS.findIndex((m) => CREATE.test(m)) + 1;

  it('the slot is found by its DDL, created once, never amended into a frozen entry', () => {
    expect(SLOT, 'no MIGRATIONS entry creates linear_events').toBeGreaterThanOrEqual(36);
    expect(MIGRATIONS.filter((m) => CREATE.test(m))).toHaveLength(1);
    expect(MIGRATIONS.slice(0, SLOT - 1).some((m) => /linear_events/.test(m))).toBe(false);
  });

  it('the entry alone adds the table and its index on result; openCoordDb reaches a database one version before it', () => {
    expect(SLOT, 'no MIGRATIONS entry creates linear_events').toBeGreaterThanOrEqual(36);
    const p = path.join(mkTmp('ccrc-mig-linear-events-'), '.ccrc', 'coord.db');
    mkdirSync(path.dirname(p), { recursive: true });
    const raw = new DatabaseSync(p);
    tx(raw, () => {
      for (let v = 0; v < SLOT - 1; v++) raw.exec(MIGRATIONS[v]!);
      raw.exec(`PRAGMA user_version = ${SLOT - 1}`);
    });
    const names = (): string[] => (raw.prepare("SELECT name FROM sqlite_master WHERE type IN ('table', 'index') AND name NOT LIKE 'sqlite_%'")
      .all() as { name: string }[]).map((r) => r.name);
    const had = names();
    raw.close();
    const db = openCoordDb(p);
    expect(db.prepare('PRAGMA user_version').get()).toMatchObject({ user_version: COORD_SCHEMA_VERSION });
    const now = (db.prepare("SELECT name FROM sqlite_master WHERE type IN ('table', 'index') AND name NOT LIKE 'sqlite_%'")
      .all() as { name: string }[]).map((r) => r.name);
    expect(now.filter((n) => !had.includes(n)).sort()).toEqual(['linear_events', 'linear_events_by_result']);
    expect(db.prepare('SELECT COUNT(*) AS n FROM linear_events').get()).toEqual({ n: 0 });
    db.close();
  });

  it('no free-text column: the columns are exactly spec §7’s, and none is for a title, a body, a name, the key, its tail or its digest', () => {
    const db = memCoordDb();
    const cols = (db.prepare("SELECT name FROM pragma_table_info('linear_events')").all() as { name: string }[]).map((r) => r.name);
    expect(cols).toEqual([
      'id', 'at', 'sessionId', 'sessionUuid', 'actor', 'workspaceId', 'teamKey', 'op', 'target', 'result', 'fields',
      'outcome', 'code', 'masked', 'decisionId',
    ]);
    expect(cols.filter((c) => /title|body|name|desc|key(?!$)|tail|digest|text/i.test(c) && c !== 'teamKey')).toEqual([]);
    expect(() => db.prepare("INSERT INTO linear_events (at, op, outcome) VALUES (1, 'update', 'maybe')").run()).toThrow(/CHECK/);
  });
});

describe('LinearJournal: pending, then the outcome (#1444, spec §7)', () => {
  it('a write is inserted pending at the clock, and its outcome replaces pending once', () => {
    const { db, journal } = linearServicesFake({ clock: () => NOW });
    const w = journal.pending(write({ op: 'create', target: null, fields: ['title', 'description', 'team'] }));
    expect(w).toEqual({ ok: true, id: expect.any(Number) });
    if (!w.ok) return;
    expect(rowsOf(db)).toEqual([{
      id: w.id, at: NOW, sessionId: 'session-a', sessionUuid: 'uuid-a', actor: null, workspaceId: WS, teamKey: 'AAA',
      op: 'create', target: null, result: null, fields: 'team,title,description', outcome: 'pending', code: null,
      masked: null, decisionId: null,
    }]);
    expect(journal.settle(w.id, 'ok', undefined, 'AAA-13', 2)).toEqual({ ok: true });
    expect(rowsOf(db)[0]).toMatchObject({ at: NOW, outcome: 'ok', result: 'AAA-13', masked: 2, code: null });
    const warn = quiet();
    expect(journal.settle(w.id, 'failed', 'unavailable'), 'a settled row is never settled again').toEqual({ ok: false, why: 'row' });
    expect(journal.settle(w.id + 99, 'ok'), 'an unknown row').toEqual({ ok: false, why: 'row' });
    expect(journal.settle(w.id, 'pending' as never), 'pending is not an outcome').toEqual({ ok: false, why: 'outcome' });
    warn.mockRestore();
    expect(rowsOf(db)[0]).toMatchObject({ outcome: 'ok', result: 'AAA-13' });
  });

  it('a row left pending stays pending, which reads as outcome unknown', () => {
    const { db, journal } = linearServicesFake({ clock: () => NOW });
    expect(journal.pending(write())).toMatchObject({ ok: true });
    expect(rowsOf(db).map((r) => r['outcome'])).toEqual(['pending']);
  });

  it('denial and refusal rows carry their word, and a decision id when one came back', () => {
    const { db, journal } = linearServicesFake({ clock: () => NOW });
    const a = journal.pending(write());
    const b = journal.pending(write({ op: 'comment', fields: ['body'] }));
    const c = journal.pending(write());
    if (!a.ok || !b.ok || !c.ok) throw new Error('pending refused');
    expect(journal.settle(a.id, 'refused', 'not-found')).toEqual({ ok: true });
    expect(journal.settle(b.id, 'failed', 'unavailable', null, null, 'decision-1')).toEqual({ ok: true });
    expect(journal.settle(c.id, 'unknown', 'timeout')).toEqual({ ok: true });
    expect(rowsOf(db).map((r) => [r['outcome'], r['code'], r['decisionId']])).toEqual([
      ['refused', 'not-found', null], ['failed', 'unavailable', 'decision-1'], ['unknown', 'timeout', null],
    ]);
  });

  it('a code rides only a row that did not end ok, and only a known word', () => {
    const { journal } = linearServicesFake({ clock: () => NOW });
    const warn = quiet();
    const a = journal.pending(write());
    if (!a.ok) throw new Error('pending refused');
    expect(journal.settle(a.id, 'ok', 'not-found')).toEqual({ ok: false, why: 'code' });
    expect(journal.settle(a.id, 'refused', 'a word nobody defined' as never)).toEqual({ ok: false, why: 'code' });
    expect(journal.settle(a.id, 'refused', 'not-found')).toEqual({ ok: true });
    warn.mockRestore();
  });

  it('a key act carries the gate’s actor and no session; a session write carries the pair and no actor', () => {
    const { db, journal } = linearServicesFake({ clock: () => NOW });
    const warn = quiet();
    expect(journal.pending(keyAct())).toMatchObject({ ok: true });
    expect(journal.pending(keyAct({ op: 'key-add', workspaceId: null }))).toMatchObject({ ok: true });
    expect(rowsOf(db).map((r) => [r['op'], r['actor'], r['sessionId'], r['workspaceId']])).toEqual([
      ['key-check', `a test phone ${'ab'.repeat(4)}`, null, WS], ['key-add', `a test phone ${'ab'.repeat(4)}`, null, null],
    ]);
    expect(journal.pending(keyAct({ actor: null }))).toEqual({ ok: false, why: 'actor' });
    // A look-alike object is not an actor: only `actorOf` mints one.
    expect(journal.pending(keyAct({ actor: { label: 'x', idHash8: 'abababab', toString: () => 'x abababab' } }))).toEqual({ ok: false, why: 'actor' });
    expect(journal.pending(keyAct({ sessionId: 'session-a', sessionUuid: 'uuid-a' }))).toEqual({ ok: false, why: 'session' });
    expect(journal.pending(keyAct({ fields: ['title'] }))).toEqual({ ok: false, why: 'fields' });
    expect(journal.pending(keyAct({ target: 'AAA-12' }))).toEqual({ ok: false, why: 'target' });
    expect(journal.pending(keyAct({ teamKey: 'AAA' }))).toEqual({ ok: false, why: 'team' });
    expect(journal.pending(write({ actor: actorOf('a test phone', 'ab'.repeat(32)) }))).toEqual({ ok: false, why: 'actor' });
    expect(journal.pending(write({ sessionId: null }))).toEqual({ ok: false, why: 'session' });
    expect(journal.pending(write({ sessionUuid: null }))).toEqual({ ok: false, why: 'session' });
    warn.mockRestore();
    expect(rowsOf(db)).toHaveLength(2);
  });

  it('an update and a comment name their target; a create names its parent or none', () => {
    const { journal } = linearServicesFake({ clock: () => NOW });
    const warn = quiet();
    expect(journal.pending(write({ target: null }))).toEqual({ ok: false, why: 'target' });
    expect(journal.pending(write({ op: 'comment', target: null, fields: ['body'] }))).toEqual({ ok: false, why: 'target' });
    expect(journal.pending(write({ op: 'create', target: null, fields: ['team', 'title'] }))).toMatchObject({ ok: true });
    expect(journal.pending(write({ op: 'create', target: 'BBB-3', fields: ['team', 'title', 'parent'] }))).toMatchObject({ ok: true });
    warn.mockRestore();
  });
});

describe('LinearJournal: no free text reaches a row (#1444, spec §7)', () => {
  it('a canary in every field that could carry text is refused, and no table of coord.db holds it', () => {
    const { db, journal } = linearServicesFake({ clock: () => NOW });
    const canary = `CANARY-${process.pid}-${NOW} lin_api_fixture${'x'.repeat(32)}`;
    const warn = quiet();
    try {
      expect(journal.pending(write({ op: canary as never }))).toEqual({ ok: false, why: 'op' });
      expect(journal.pending(write({ sessionId: canary }))).toEqual({ ok: false, why: 'session' });
      expect(journal.pending(write({ sessionUuid: canary }))).toEqual({ ok: false, why: 'session' });
      expect(journal.pending(write({ workspaceId: canary }))).toEqual({ ok: false, why: 'workspace' });
      expect(journal.pending(write({ teamKey: canary }))).toEqual({ ok: false, why: 'team' });
      expect(journal.pending(write({ target: canary }))).toEqual({ ok: false, why: 'target' });
      expect(journal.pending(write({ fields: [canary] }))).toEqual({ ok: false, why: 'fields' });
      expect(journal.pending(keyAct({ actor: canary as never }))).toEqual({ ok: false, why: 'actor' });
      const w = journal.pending(write({ op: 'create', target: null, fields: ['team', 'title'] }));
      if (!w.ok) throw new Error('pending refused');
      expect(journal.settle(w.id, canary as never)).toEqual({ ok: false, why: 'outcome' });
      expect(journal.settle(w.id, 'refused', canary as never)).toEqual({ ok: false, why: 'code' });
      expect(journal.settle(w.id, 'ok', undefined, canary)).toEqual({ ok: false, why: 'result' });
      expect(journal.settle(w.id, 'ok', undefined, 'AAA-13', canary as never)).toEqual({ ok: false, why: 'masked' });
      expect(journal.settle(w.id, 'refused', 'not-found', null, null, canary)).toEqual({ ok: false, why: 'decision' });
      // The warn lines name the refusal word, never the value.
      expect(warn.mock.calls.flat().join('\n')).not.toContain('CANARY');
    } finally {
      warn.mockRestore();
    }
    expect(everyTable(db)).not.toContain('CANARY');
    expect(everyTable(db)).not.toContain('lin_api_');
  });

  it('fields come from the operation’s closed list only: a free-text value, a name another op owns or a repeat is refused', () => {
    const { db, journal } = linearServicesFake({ clock: () => NOW });
    const warn = quiet();
    expect(journal.pending(write({ fields: ['Fix the login page'] }))).toEqual({ ok: false, why: 'fields' });
    expect(journal.pending(write({ fields: ['title,description'] }))).toEqual({ ok: false, why: 'fields' });
    expect(journal.pending(write({ fields: ['body'] })), 'body is the comment’s, not the update’s').toEqual({ ok: false, why: 'fields' });
    expect(journal.pending(write({ op: 'comment', fields: ['title'] }))).toEqual({ ok: false, why: 'fields' });
    expect(journal.pending(write({ fields: ['title', 'title'] }))).toEqual({ ok: false, why: 'fields' });
    expect(journal.pending(write({ fields: 'title' as never }))).toEqual({ ok: false, why: 'fields' });
    warn.mockRestore();
    // Each op's list, and the stored text is the list's own order, whatever order the caller gave.
    expect(LINEAR_JOURNAL_FIELDS).toEqual({
      create: ['team', 'title', 'description', 'state', 'priority', 'assignee', 'labels', 'project', 'parent'],
      update: ['title', 'description', 'state', 'priority', 'assignee', 'labels', 'addLabels', 'removeLabels', 'project', 'parent'],
      comment: ['body'],
    });
    expect(journal.pending(write({ fields: ['project', 'title', 'state'] }))).toMatchObject({ ok: true });
    expect(rowsOf(db).map((r) => r['fields'])).toEqual(['title,state,project']);
  });

  it('the ids keep their grammars: SAFE_RE for the pair, a UUID for the slot, a team key, an issue identifier', () => {
    const { journal } = linearServicesFake({ clock: () => NOW });
    const warn = quiet();
    expect(journal.pending(write({ sessionId: 'a b' }))).toEqual({ ok: false, why: 'session' });
    expect(journal.pending(write({ sessionId: 'x'.repeat(129) }))).toEqual({ ok: false, why: 'session' });
    expect(journal.pending(write({ workspaceId: COMMENT_ID.toUpperCase() }))).toEqual({ ok: false, why: 'workspace' });
    expect(journal.pending(write({ workspaceId: 'ws-a' }))).toEqual({ ok: false, why: 'workspace' });
    expect(journal.pending(write({ teamKey: 'AAA-12' }))).toEqual({ ok: false, why: 'team' });
    expect(journal.pending(write({ teamKey: '1AA' }))).toEqual({ ok: false, why: 'team' });
    expect(journal.pending(write({ target: 'AAA12' }))).toEqual({ ok: false, why: 'target' });
    expect(journal.pending(write({ target: COMMENT_ID }))).toEqual({ ok: false, why: 'target' });
    expect(journal.pending(write({ workspaceId: null }))).toMatchObject({ ok: true });
    expect(journal.pending(write({ teamKey: null }))).toMatchObject({ ok: true });
    warn.mockRestore();
  });

  it('masked is a count of spans, and a decision id keeps SAFE_RE', () => {
    const { journal } = linearServicesFake({ clock: () => NOW });
    const warn = quiet();
    const w = journal.pending(write());
    if (!w.ok) throw new Error('pending refused');
    expect(journal.settle(w.id, 'ok', undefined, null, -1)).toEqual({ ok: false, why: 'masked' });
    expect(journal.settle(w.id, 'ok', undefined, null, 1.5)).toEqual({ ok: false, why: 'masked' });
    expect(journal.settle(w.id, 'ok', undefined, null, 0, 'a decision')).toEqual({ ok: false, why: 'decision' });
    expect(journal.settle(w.id, 'ok', undefined, null, 0, 'decision-7')).toEqual({ ok: true });
    warn.mockRestore();
  });
});

describe('LinearJournal: result holds a created issue’s identifier or a created comment’s id, and nothing else (#1444, spec §7)', () => {
  const settled = (op: 'create' | 'update' | 'comment', outcome: 'ok' | 'failed', result: string | null) => {
    const { db, journal } = linearServicesFake({ clock: () => NOW });
    const fields = op === 'comment' ? ['body'] : op === 'create' ? ['team', 'title'] : ['title'];
    const w = journal.pending(write({ op, target: op === 'create' ? null : 'AAA-12', fields }));
    if (!w.ok) throw new Error('pending refused');
    const warn = quiet();
    const ans = journal.settle(w.id, outcome, outcome === 'ok' ? undefined : 'unavailable', result);
    warn.mockRestore();
    return { ans, row: rowsOf(db)[0]! };
  };

  it('an ok create takes the created identifier, in either case; a title or a UUID is refused', () => {
    expect(settled('create', 'ok', 'AAA-13')).toMatchObject({ ans: { ok: true }, row: { result: 'AAA-13' } });
    expect(settled('create', 'ok', 'Fix the login page').ans).toEqual({ ok: false, why: 'result' });
    expect(settled('create', 'ok', 'AAA-13 Fix the login page').ans).toEqual({ ok: false, why: 'result' });
    expect(settled('create', 'ok', COMMENT_ID).ans).toEqual({ ok: false, why: 'result' });
    expect(settled('create', 'ok', 'aaa-13').ans).toMatchObject({ ok: true });
  });

  it('an ok comment takes the created comment’s UUID; an identifier or a body is refused', () => {
    expect(settled('comment', 'ok', COMMENT_ID)).toMatchObject({ ans: { ok: true }, row: { result: COMMENT_ID } });
    expect(settled('comment', 'ok', 'AAA-13').ans).toEqual({ ok: false, why: 'result' });
    expect(settled('comment', 'ok', 'looks good to me').ans).toEqual({ ok: false, why: 'result' });
  });

  it('an update, and any row that did not end ok, takes no result', () => {
    expect(settled('update', 'ok', 'AAA-12').ans).toEqual({ ok: false, why: 'result' });
    expect(settled('update', 'ok', null)).toMatchObject({ ans: { ok: true }, row: { result: null } });
    expect(settled('create', 'failed', 'AAA-13').ans).toEqual({ ok: false, why: 'result' });
    expect(settled('comment', 'failed', COMMENT_ID).ans).toEqual({ ok: false, why: 'result' });
    expect(settled('create', 'failed', null)).toMatchObject({ ans: { ok: true }, row: { result: null, outcome: 'failed' } });
  });
});

describe('LinearJournal.viaFleet: what an ok row’s result holds, by one indexed query (#1444, spec §5.4)', () => {
  const journalWith = () => {
    const fx = linearServicesFake({ clock: () => NOW });
    const made = (op: 'create' | 'comment', result: string, outcome: 'ok' | 'pending' = 'ok') => {
      const w = fx.journal.pending(write({ op, target: op === 'create' ? null : 'AAA-12', fields: op === 'comment' ? ['body'] : ['team', 'title'] }));
      if (!w.ok) throw new Error('pending refused');
      if (outcome === 'ok') expect(fx.journal.settle(w.id, 'ok', undefined, result)).toEqual({ ok: true });
    };
    made('create', 'AAA-13');
    made('comment', COMMENT_ID);
    made('create', 'AAA-99', 'pending');
    return fx;
  };

  it('a journaled issue and comment read true, others false', () => {
    const { journal } = journalWith();
    const other = 'ffffffff-bbbb-4ccc-8ddd-eeeeeeeeeeee';
    const hit = journal.viaFleet(['AAA-13', 'AAA-14', COMMENT_ID, other, 'AAA-99', 'not an id']);
    expect([...hit].sort()).toEqual(['AAA-13', COMMENT_ID].sort());
    expect(journal.viaFleet([]).size).toBe(0);
  });

  it('the read is one query on the result index', () => {
    const { db, journal } = journalWith();
    const prepare = vi.spyOn(db, 'prepare');
    journal.viaFleet(['AAA-13', COMMENT_ID, 'AAA-14']);
    const sql = prepare.mock.calls.map((c) => String(c[0]));
    prepare.mockRestore();
    expect(sql).toHaveLength(1);
    const plan = db.prepare(`EXPLAIN QUERY PLAN ${sql[0]!}`).all('AAA-13', COMMENT_ID, 'AAA-14') as { detail: string }[];
    expect(plan.map((p) => p.detail).join('\n')).toMatch(/linear_events_by_result/);
  });

  it('a read that fails answers false for every item, and says so in one line', () => {
    const { db, journal } = journalWith();
    db.close();
    const warn = quiet();
    expect(journal.viaFleet(['AAA-13']).size).toBe(0);
    expect(warn.mock.calls.map((c) => String(c[0]))).toEqual([expect.stringMatching(/^ccrc-server: linear journal read failed \(\w+\)$/)]);
    warn.mockRestore();
  });
});

describe('LinearJournal: kept 365 days, and a failed write is an answer (#1444, spec §7)', () => {
  it('the sweep deletes a row of 366 days and keeps rows of 365 and 364', () => {
    let at = NOW - 366 * DAY_MS;
    const { db, journal } = linearServicesFake({ clock: () => at });
    expect(LINEAR_JOURNAL_RETENTION_DAYS).toBe(365);
    journal.pending(write());
    at = NOW - 365 * DAY_MS;
    journal.pending(write());
    at = NOW - 364 * DAY_MS;
    journal.pending(write());
    expect(journal.sweep(NOW)).toBe(1);
    expect(rowsOf(db).map((r) => (NOW - Number(r['at'])) / DAY_MS)).toEqual([365, 364]);
  });

  it('a write to a closed database answers unwritable, never throws, and names no value', () => {
    const db = memCoordDb();
    const journal = new LinearJournal(db, () => NOW);
    const w = journal.pending(write());
    db.close();
    const warn = quiet();
    expect(journal.pending(write())).toEqual({ ok: false, why: 'unwritable' });
    expect(journal.settle(w.ok ? w.id : 0, 'ok')).toEqual({ ok: false, why: 'unwritable' });
    expect(journal.sweep(NOW)).toBe(0);
    expect(warn.mock.calls.map((c) => String(c[0])).join('\n')).not.toMatch(/session-a|AAA-12|11111111/);
    warn.mockRestore();
  });
});

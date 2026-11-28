// Overlord W2, request ids A, Task A2 (store layer): the three nullable `requestId` columns, the writers that carry them
// and the two small readers beside them. NULL means "names no request" (an older row, or one written by an older build).
import { describe, it, expect } from 'vitest';
import path from 'node:path';
import { PEER_MAIL_WINDOW_MS } from '../../shared/api.js';
import { openCoordDb } from '../src/coord/db.js';
import { CoordStore } from '../src/coord/store.js';
import { insertSystemMailTx } from '../src/coord/rundefsTx.js';
import { tx } from '../src/coord/tx.js';
import { mkTmp } from './tmpHelpers.js';

const build = (): CoordStore => new CoordStore(openCoordDb(path.join(mkTmp('ccrc-reqid-'), 'coord.db')));

/** A real `overlord_requests` row: foreign keys are ON, so a stored requestId must name one. */
const request = (coord: CoordStore, id: number): number => {
  coord.db.prepare("INSERT INTO overlord_requests (id, origin, summary, state, openedAt) VALUES (?, 'overlord', 'a request', 'received', 1)").run(id);
  return id;
};

const MAIL = { fromId: 'lane-a', fromUuid: 'u', toId: 'lane-b', runId: null, kind: 'note' as const, subject: 's', body: 'b', artifacts: [] };
const col = (coord: CoordStore, sql: string, ...args: number[]): unknown => (coord.db.prepare(sql).get(...args) as Record<string, unknown>).requestId;
const openRunFor = (coord: CoordStore, program: string, claimedBy: string, requestId?: number | null): number =>
  (coord.openRun({ program, title: program, project: 'project-a', wave: 1, waveOf: null, claimedBy, ...(requestId === undefined ? {} : { requestId }) }) as { id: number }).id;

describe('the request id columns', () => {
  it('each of the three columns exists, is nullable, and reads NULL on a row written without it', () => {
    const coord = build();
    for (const table of ['runs', 'mail', 'programme_modifications']) {
      const info = (coord.db.prepare(`PRAGMA table_info(${table})`).all() as { name: string; notnull: number }[]).find((c) => c.name === 'requestId');
      expect(info, table).toBeDefined();
      expect(info!.notnull, table).toBe(0);
    }
    const runId = openRunFor(coord, 'prog-a', 'lane-a');
    const mailId = coord.insertMail(MAIL).id;
    const modId = coord.addModification('prog-a', { text: 't', ruling: null, itemId: null, pr: null }, 5);
    expect(col(coord, 'SELECT requestId FROM runs WHERE id = ?', runId)).toBeNull();
    expect(col(coord, 'SELECT requestId FROM mail WHERE id = ?', mailId)).toBeNull();
    expect(col(coord, 'SELECT requestId FROM programme_modifications WHERE id = ?', modId)).toBeNull();
  });

  it('insertMail, openRun and addModification store the id they are given', () => {
    const coord = build();
    const r = request(coord, 7);
    const mailId = coord.insertMail({ ...MAIL, requestId: r }).id;
    const runId = openRunFor(coord, 'prog-a', 'lane-a', r);
    const modId = coord.addModification('prog-a', { text: 't', ruling: null, itemId: null, pr: null, requestId: r }, 5);
    expect(col(coord, 'SELECT requestId FROM mail WHERE id = ?', mailId)).toBe(r);
    expect(col(coord, 'SELECT requestId FROM runs WHERE id = ?', runId)).toBe(r);
    expect(col(coord, 'SELECT requestId FROM programme_modifications WHERE id = ?', modId)).toBe(r);
  });

  it('an explicit null stores NULL', () => {
    const coord = build();
    const mailId = coord.insertMail({ ...MAIL, requestId: null }).id;
    const runId = openRunFor(coord, 'prog-a', 'lane-a', null);
    expect(col(coord, 'SELECT requestId FROM mail WHERE id = ?', mailId)).toBeNull();
    expect(col(coord, 'SELECT requestId FROM runs WHERE id = ?', runId)).toBeNull();
  });

  it('insertSystemMailTx stores NULL with no requestId and the id when given one', () => {
    const coord = build();
    const r = request(coord, 3);
    const base = { fromId: 'ccrc' as never, toId: 'lane-b', runId: null, kind: 'note' as const, subject: 's', body: 'b' };
    const plain = tx(coord.db, () => insertSystemMailTx(coord, null, base));
    const tagged = tx(coord.db, () => insertSystemMailTx(coord, null, { ...base, requestId: r }));
    expect(col(coord, 'SELECT requestId FROM mail WHERE id = ?', plain.mailId)).toBeNull();
    expect(col(coord, 'SELECT requestId FROM mail WHERE id = ?', tagged.mailId)).toBe(r);
  });

  it("an older build's shape, a SELECT naming no new column, still works on the migrated file", () => {
    const coord = build();
    coord.insertMail({ ...MAIL, requestId: request(coord, 1) });
    const row = coord.db.prepare('SELECT id, fromId, toId, runId, kind, subject, urgentAs FROM mail').get() as Record<string, unknown>;
    expect(row.fromId).toBe('lane-a');
    expect('urgentAs' in row).toBe(true);
  });
});

describe('reportAtsInLastHour', () => {
  it("counts only mail to 'overlord' from that sender inside the hour, boundary exclusive like peerMailAtsInLastHour", () => {
    const coord = build();
    const now = 10_000_000_000;
    const put = (fromId: string, toId: string, at: number): void => {
      const id = coord.insertMail({ ...MAIL, fromId, toId }).id;
      coord.db.prepare('UPDATE mail SET at = ? WHERE id = ?').run(at, id);
    };
    put('lane-a', 'overlord', now - 10);
    put('lane-a', 'overlord', now - PEER_MAIL_WINDOW_MS);      // exactly one hour old: out (`at > now - window`)
    put('lane-a', 'overlord', now - PEER_MAIL_WINDOW_MS + 1);  // one ms inside: in
    put('lane-a', 'lane-b', now - 5);                          // not to the Overlord
    put('lane-c', 'overlord', now - 5);                        // another sender
    expect(coord.reportAtsInLastHour('lane-a', now)).toEqual([now - PEER_MAIL_WINDOW_MS + 1, now - 10]);
    expect(coord.reportAtsInLastHour('lane-d', now)).toEqual([]);
  });
});

describe('mailQueuedSince', () => {
  it("carries the mail row's own toId beside the delivery's, for a role-addressed mail delivered to a session", () => {
    const coord = build();
    const mailId = coord.insertMail({ ...MAIL, toId: 'overlord' }).id;
    coord.queueDelivery(mailId, 'session-x', '', null, null);
    const rows = coord.mailQueuedSince(0);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.toId).toBe('session-x');
    expect(rows[0]!.mailToId).toBe('overlord');
  });
});

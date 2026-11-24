// Overlord W1, inbox piece, Task 2 (plan `docs/superpowers/plans/2026-11-14-overlord-w1/w1-inbox.md`; spec §3.8, H10): the one read
// runner (`coord/overlordRead.ts`) in a real Fastify route, with fake ports for the turn state and the clock and a real
// `OperatorModelStore` on a fixture file, so the ledger's `CHECK`s and the counter are the real ones. The order is the contract:
// the turn state, then the counter, then the ceiling, then compose, then the line, then the send, and a read whose line did not
// land is never sent.
import { afterEach, describe, expect, it, vi } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import type { DatabaseSync } from 'node:sqlite';
import { defaultOperatorModelDbPath, openOperatorModelDb } from '../src/operatorModel/db.js';
import { OperatorModelStore, type PrivacyIssuer } from '../src/operatorModel/store.js';
import { runOverlordRead, type OverlordReadDeps, type ReadComposed } from '../src/coord/overlordRead.js';
import { doorRow, type OverlordDoorRow } from '../src/coord/overlordDoors.js';
import type { GateRun } from '../src/coord/overlordGateRun.js';
import { READ_TURN_STATES, type ReadDoor, type ReadLine, type ReadTurnState } from '../../shared/operatorMessages.js';
import { READ_CEILINGS, READ_CEILING_WINDOW_MS } from '../../shared/overlordInbox.js';
import { REFUSAL_STATUS } from '../../shared/refusal.js';
import { mkTmp } from './tmpHelpers.js';

const NOW = 1_800_000_000_000;
const MARKER = 'the-composed-bodys-marker-string';
const ISSUER: PrivacyIssuer = { kind: 'ready', issue: () => ({ ok: true, id: 1 }) };
const PASS: Extract<GateRun, { kind: 'pass' }> = {
  kind: 'pass', caller: { ok: true, sessionId: 'lane-a-overlord', uuid: 'u-1', actor: { kind: 'session', subject: 'lane-a-overlord' } as never },
  generation: { id: 41, n: 3, term: 1 },
};
const FENCED = doorRow('card-record') as OverlordDoorRow;   // `write: true`
const UNFENCED = doorRow('card') as OverlordDoorRow;         // `write: false`

const opened: DatabaseSync[] = [];
const apps: FastifyInstance[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  for (const db of opened.splice(0)) if (db.isOpen) db.close();
  await Promise.all(apps.splice(0).map((a) => a.close()));
});

function storeOnFile(): { store: OperatorModelStore; db: DatabaseSync } {
  const db = openOperatorModelDb(defaultOperatorModelDbPath(mkTmp('ccrc-readrun-')));
  opened.push(db);
  return { store: new OperatorModelStore(db, ISSUER), db };
}
const lines = (db: DatabaseSync): Record<string, unknown>[] =>
  db.prepare('SELECT at, door, caller, scope, count, outcome, generation, generationRead, turnState FROM read_ledger ORDER BY id').all() as never;
const SERVED: ReadLine = {
  at: NOW - 1_000, door: 'history', caller: 'overlord', scope: 'history', count: 1, outcome: 'rows', generation: 3, generationRead: 'measured', turnState: 'done',
};
/** `n` served lines of a door inside the window, the oldest `agoMs` before now. */
function fill(store: OperatorModelStore, door: ReadDoor, n: number, agoMs = 600_000): void {
  for (let i = 0; i < n; i += 1) store.recordRead({ ...SERVED, door, scope: door, at: NOW - agoMs + i });
}

interface Rig { app: FastifyInstance; log: string[]; composes: () => number }
interface RigOpts {
  door?: ReadDoor; ledger?: OverlordReadDeps['ledger']; turn?: OverlordReadDeps['turn']; row?: OverlordDoorRow; unfenced?: true;
  pass?: Extract<GateRun, { kind: 'pass' }>; compose?: () => ReadComposed | Promise<ReadComposed>;
}
async function rig(o: RigOpts): Promise<Rig> {
  const log: string[] = [];
  let composes = 0;
  const base = o.ledger;
  const ledger: OverlordReadDeps['ledger'] = base === undefined ? undefined : {
    servedReadsSince: (d, s) => { log.push('count'); return base.servedReadsSince(d, s); },
    recordRead: (l) => { log.push(`record:${l.outcome}`); return base.recordRead(l); },
  };
  const run = runOverlordRead({
    ledger,
    turn: async (id, uuid) => { log.push('turn'); return o.turn === undefined ? 'done' : o.turn(id, uuid); },
    now: () => NOW,
  });
  const app = Fastify({ logger: false });
  apps.push(app);
  app.get('/r', async (req, reply) => {
    const r = await run(req, reply, {
      door: o.door ?? 'history', pass: o.pass ?? PASS, row: o.row ?? FENCED, ...(o.unfenced ? { unfenced: true as const } : {}),
      compose: () => { composes += 1; log.push('compose'); return o.compose === undefined ? { kind: 'rows', body: { ok: true, marker: MARKER }, scope: 'history', count: 2 } : o.compose(); },
    });
    log.push('sent');
    return r;
  });
  await app.ready();
  return { app, log, composes: () => composes };
}
const get = (r: Rig) => r.app.inject({ method: 'GET', url: '/r' });
const json = (res: { body: string }): Record<string, unknown> => JSON.parse(res.body) as Record<string, unknown>;

describe('the runner\'s order', () => {
  it('a pass reads the turn state before the counter, then composes, then records its line, then sends', async () => {
    const { store, db } = storeOnFile();
    const r = await rig({ ledger: store });
    const res = await get(r);
    expect(res.statusCode).toBe(200);
    expect(json(res)).toEqual({ ok: true, marker: MARKER });
    expect(r.log).toEqual(['turn', 'count', 'compose', 'record:rows', 'sent']);
    expect(lines(db)).toEqual([{ at: NOW, door: 'history', caller: 'overlord', scope: 'history', count: 2, outcome: 'rows', generation: 3, generationRead: 'measured', turnState: 'done' }]);
  });

  it('an unmeasured counter refuses 502 unmeasured before anything is read, and records nothing', async () => {
    const { store, db } = storeOnFile();
    const r = await rig({ ledger: { servedReadsSince: () => ({ kind: 'unmeasured', why: 'the store is gone' }), recordRead: store.recordRead.bind(store) } });
    const res = await get(r);
    expect(res.statusCode).toBe(REFUSAL_STATUS.unmeasured);
    expect(json(res)).toMatchObject({ ok: false, error: 'unmeasured' });
    expect(res.body).not.toContain('the store is gone');
    expect(r.composes()).toBe(0);
    expect(r.log).toEqual(['turn', 'count', 'sent']);
    expect(lines(db)).toEqual([]);
  });

  it('a ceiling refusal records one read-ceiling line carrying a turn state, which lands, and calls no compose; a second one in the window records none', async () => {
    const { store, db } = storeOnFile();
    fill(store, 'history', READ_CEILINGS.history.perHour);
    const before = lines(db).length;
    const r = await rig({ ledger: store, turn: async () => 'working' });
    const res = await get(r);
    expect(res.statusCode).toBe(REFUSAL_STATUS['read-ceiling']);
    expect(json(res)).toMatchObject({ ok: false, error: 'read-ceiling', retryAfterS: 3000 });   // the oldest line leaves in (3600 - 600) s
    expect(r.composes()).toBe(0);
    expect(r.log).toEqual(['turn', 'count', 'record:read-ceiling', 'sent']);
    const after = lines(db);
    expect(after.length).toBe(before + 1);
    expect(after.at(-1)).toEqual({ at: NOW, door: 'history', caller: 'overlord', scope: 'history', count: 0, outcome: 'read-ceiling', generation: 3, generationRead: 'measured', turnState: 'working' });
    const again = await rig({ ledger: store });
    const res2 = await get(again);
    expect(res2.statusCode).toBe(REFUSAL_STATUS['read-ceiling']);
    expect(again.log).toEqual(['turn', 'count', 'sent']);
    expect(lines(db).length).toBe(before + 1);
  });

  it('a ceiling refusal is still answered when its line could not be written, and the warning names the door and never the scope', async () => {
    const { store } = storeOnFile();
    fill(store, 'history', READ_CEILINGS.history.perHour);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const r = await rig({ ledger: { servedReadsSince: store.servedReadsSince.bind(store), recordRead: () => ({ ok: false, error: 'write-failed', detail: 'disk' }) } });
    const res = await get(r);
    expect(res.statusCode).toBe(REFUSAL_STATUS['read-ceiling']);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0]![0])).toMatch(/^ccrc-server: .*history/);
  });

  it('the ceiling counts the door\'s own lines only, the console\'s lines not at all, and a line at the window\'s edge not at all', async () => {
    const { store } = storeOnFile();
    fill(store, 'messages', READ_CEILINGS.history.perHour);      // another door
    for (let i = 0; i < READ_CEILINGS.history.perHour; i += 1) {
      store.recordRead({ ...SERVED, caller: 'operator', generation: null, generationRead: 'not-a-session', turnState: null, at: NOW - 10_000 + i });
    }
    store.recordRead({ ...SERVED, at: NOW - READ_CEILING_WINDOW_MS });
    const r = await rig({ ledger: store });
    expect((await get(r)).statusCode).toBe(200);
  });
});

describe('no line, no read', () => {
  it('a line that did not land answers 503 write-failed and the composed body is dropped', async () => {
    const { store } = storeOnFile();
    const r = await rig({ ledger: { servedReadsSince: store.servedReadsSince.bind(store), recordRead: () => ({ ok: false, error: 'write-failed', detail: 'disk' }) } });
    const res = await get(r);
    expect(res.statusCode).toBe(REFUSAL_STATUS['write-failed']);
    expect(json(res)).toMatchObject({ ok: false, error: 'write-failed' });
    expect(res.body).not.toContain(MARKER);
    expect(r.composes()).toBe(1);
  });

  it('a server with no private store refuses 503 unavailable and reads nothing', async () => {
    const r = await rig({ ledger: undefined });
    const res = await get(r);
    expect(res.statusCode).toBe(REFUSAL_STATUS.unavailable);
    expect(json(res)).toMatchObject({ ok: false, error: 'unavailable' });
    expect(r.composes()).toBe(0);
    expect(r.log).toEqual(['sent']);
  });
});

describe('the line the runner writes', () => {
  it('carries each turn word unchanged, and a turn read that threw as unmeasured', async () => {
    for (const word of READ_TURN_STATES) {
      const { store, db } = storeOnFile();
      const r = await rig({ ledger: store, turn: async () => word as ReadTurnState });
      expect((await get(r)).statusCode, word).toBe(200);
      expect(lines(db).map((l) => l.turnState), word).toEqual([word]);
    }
    const { store, db } = storeOnFile();
    const r = await rig({ ledger: store, turn: async () => { throw new Error('boom'); } });
    expect((await get(r)).statusCode).toBe(200);
    expect(lines(db).map((l) => l.turnState)).toEqual(['unmeasured']);
  });

  it('carries the pass\'s generation number as measured, and a pass with none as unmeasured and no number', async () => {
    const { store, db } = storeOnFile();
    await get(await rig({ ledger: store }));
    await get(await rig({ ledger: store, pass: { ...PASS, generation: null } }));
    expect(lines(db).map((l) => [l.generation, l.generationRead])).toEqual([[3, 'measured'], [null, 'unmeasured']]);
  });

  it('a refuse compose writes its line with its outcome and count 0, and answers its word at the word\'s own status', async () => {
    for (const [word, outcome] of [['unmeasured', 'unmeasured'], ['said-not-operator', 'absent']] as const) {
      const { store, db } = storeOnFile();
      const r = await rig({ ledger: store, compose: () => ({ kind: 'refuse', word, detail: 'a source', scope: 'id:7', outcome }) });
      const res = await get(r);
      expect(res.statusCode, word).toBe(REFUSAL_STATUS[word]);
      expect(json(res)).toMatchObject({ ok: false, error: word, detail: 'a source' });
      expect(lines(db)).toEqual([{ at: NOW, door: 'history', caller: 'overlord', scope: 'id:7', count: 0, outcome, generation: 3, generationRead: 'measured', turnState: 'done' }]);
    }
    expect(REFUSAL_STATUS.unmeasured).toBe(502);
  });

  it('a refuse compose whose line did not land answers write-failed, never its own word', async () => {
    const { store } = storeOnFile();
    const r = await rig({
      ledger: { servedReadsSince: store.servedReadsSince.bind(store), recordRead: () => ({ ok: false, error: 'not-open', detail: 'closed' }) },
      compose: () => ({ kind: 'refuse', word: 'said-not-operator', detail: 'x', scope: 'id:7', outcome: 'absent' }),
    });
    expect((await get(r)).statusCode).toBe(REFUSAL_STATUS['write-failed']);
  });

  it('a compose that throws answers 502 unmeasured with a fixed detail and writes no line', async () => {
    const { store, db } = storeOnFile();
    const r = await rig({ ledger: store, compose: () => { throw new Error('the composer broke'); } });
    const res = await get(r);
    expect(res.statusCode).toBe(REFUSAL_STATUS.unmeasured);
    expect(res.body).not.toContain('the composer broke');
    expect(lines(db)).toEqual([]);
  });
});

describe('the fence is said', () => {
  it('a row with write: false throws without unfenced, and runs with it', async () => {
    const { store } = storeOnFile();
    const bare = await rig({ ledger: store, row: UNFENCED });
    expect((await get(bare)).statusCode).toBe(500);
    expect(bare.composes()).toBe(0);
    const said = await rig({ ledger: store, row: UNFENCED, unfenced: true });
    expect((await get(said)).statusCode).toBe(200);
  });
});

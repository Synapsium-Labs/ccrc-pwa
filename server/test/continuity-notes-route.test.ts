// Overlord W1a, the notes piece (plan `w1a-notes.md` Task 2; spec §3.3.2 C37): the note door. `POST /api/sessions/:id/notes`
// appends one note keyed to a live row of the caller's, append-only with revisions, capped; `GET` answers the live notes
// newest first, each with its key's fact; `POST …/handover` stores one handover note per generation, only while the
// caller's generation is `checkpointed` as `effectiveGeneration` reads it. Fixture HOMEs only.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { CoordStore } from '../src/coord/store.js';
import { MASKED_GET_ROUTES } from '../src/server.js';
import { genExpectOf, type GenRow, type MintInput } from '../src/continuity/continuityStore.js';
import { GEN_ACTIVE } from '../src/continuity/generationMachine.js';
import { NOTES_CAP } from '../../shared/continuity.js';
import { fakeTime, type FakeTime } from './fakeTime.js';
import { ID_GATE_TOKEN, appFor, recorder, seedRow } from './idGateFixture.js';
import { mkTmp, removeTmpFixtures } from './tmpHelpers.js';

const ID = 'lane-a-project-a';
const OTHER = 'lane-b-project-a';
const UUID = '11111111-2222-3333-4444-555555555555';
const OTHER_UUID = '66666666-7777-8888-9999-000000000000';
const NOW = 1_800_000_000_000;

let home: string;
let app: FastifyInstance | undefined;
let coord: CoordStore | undefined;
let time: FakeTime;

beforeEach(() => {
  home = mkTmp('ccrc-notes-route-');
  seedRow(home, ID, { uuid: UUID, project: 'project-a' });
  seedRow(home, OTHER, { uuid: OTHER_UUID, project: 'project-a' });
  time = fakeTime();
});

afterEach(async () => {
  if (app) await app.close();
  app = undefined;
  coord?.db.close();
  coord = undefined;
  removeTmpFixtures();
});

const open = async (): Promise<FastifyInstance> => {
  const r = await appFor(home, recorder().run, { time: time.ports });
  coord = r.coord;
  await r.app.ready();
  return r.app;
};
const c = (): CoordStore => coord!;
const runOf = (program: string, claimedBy: string): number =>
  (c().openRun({ program, title: program.toUpperCase(), project: 'project-a', wave: 1, waveOf: 2, claimedBy }) as { id: number }).id;
const itemOf = (program: string, raisedBy: string): number =>
  c().raiseItem({ program, runId: null, raisedBy, kind: 'do', title: 't', why: 'w', how: [], options: null, neededBy: 'soon', soonLabel: null, secretSlot: null }, NOW);

const headers = (token: string | null = ID_GATE_TOKEN) => (token === null ? {} : { 'x-ccrc-mail-token': token });
const post = (a: FastifyInstance, body: Record<string, unknown>, id = ID, token: string | null = ID_GATE_TOKEN) =>
  a.inject({ method: 'POST', url: `/api/sessions/${id}/notes`, headers: headers(token), payload: { byId: ID, byUuid: UUID, ...body } });
const get = (a: FastifyInstance, q: Record<string, string> = {}, id = ID, token: string | null = ID_GATE_TOKEN) =>
  a.inject({ method: 'GET', url: `/api/sessions/${id}/notes?${new URLSearchParams({ byId: ID, byUuid: UUID, ...q })}`, headers: headers(token) });
const handover = (a: FastifyInstance, body: Record<string, unknown>, id = ID, token: string | null = ID_GATE_TOKEN) =>
  a.inject({ method: 'POST', url: `/api/sessions/${id}/handover`, headers: headers(token), payload: { byId: ID, byUuid: UUID, ...body } });
const note = (key: Record<string, unknown>, over: Record<string, unknown> = {}) => ({ key, kind: 'thread', waitsOn: 'the review', next: 'rule on it', ...over });
const rows = (): Record<string, unknown>[] =>
  c().db.prepare('SELECT id, identity, keyKind, keyRef, revises, closes FROM continuity_notes ORDER BY id').all() as Record<string, unknown>[];
const liveIds = (): number[] => { const r = c().liveNotes(ID); if (!r.ok) throw new Error(r.detail); return r.notes.map((n) => n.id); };

describe('the note door: who may write and read', () => {
  it('refuses without the box token (401) on all three doors, and writes nothing', async () => {
    app = await open();
    for (const res of [await post(app, note({ kind: 'run', id: 1 }), ID, null), await get(app, {}, ID, null), await handover(app, {}, ID, null)]) {
      expect([res.statusCode, res.json().error]).toEqual([401, 'unauthenticated']);
    }
    expect(rows()).toEqual([]);
  });

  it("refuses another session's notes (403 not-owner) and a stale uuid (403 stale-uuid)", async () => {
    app = await open();
    for (const res of [await post(app, note({ kind: 'run', id: 1 }), OTHER), await get(app, {}, OTHER), await handover(app, {}, OTHER)]) {
      expect([res.statusCode, res.json().error]).toEqual([403, 'not-owner']);
    }
    const stale = await post(app, note({ kind: 'run', id: 1 }, { byUuid: OTHER_UUID }));
    expect([stale.statusCode, stale.json().error]).toEqual([403, 'stale-uuid']);
    expect(rows()).toEqual([]);
  });

  it('refuses a malformed body 400', async () => {
    app = await open();
    const bad: Record<string, unknown>[] = [
      note({ kind: 'request', id: 1 }), note({ kind: 'run', id: 0 }), note({ kind: 'run', id: '1' }), note({ kind: 'programme', slug: '' }),
      note({ kind: 'programme', slug: 'a\nb' }), note({ kind: 'run', id: 1 }, { kind: 'miss' }), note({ kind: 'run', id: 1 }, { next: 3 }),
      note({ kind: 'run', id: 1 }, { revises: -1 }), note({ kind: 'run', id: 1 }, { closes: 'yes' }), { closes: true },
    ];
    for (const b of bad) {
      const res = await post(app, b);
      expect([res.statusCode, res.json().error], JSON.stringify(b)).toEqual([400, 'bad-request']);
    }
    expect(rows()).toEqual([]);
  });

  it('the notes GET is masked by the one answer hook', () => {
    expect(MASKED_GET_ROUTES.has('/api/sessions/:id/notes')).toBe(true);
  });
});

describe('POST /api/sessions/:id/notes: a note keys to a live row of the caller\'s', () => {
  it("a note on the caller's programme, run and item is 202; on another coordinator's programme 403 note-key-unknown", async () => {
    app = await open();
    const mine = runOf('prog-a', ID);
    runOf('prog-b', OTHER);
    const item = itemOf('prog-a', OTHER);
    for (const key of [{ kind: 'programme', slug: 'prog-a' }, { kind: 'run', id: mine }, { kind: 'item', id: item }]) {
      const res = await post(app, note(key));
      expect([res.statusCode, res.json().ok], JSON.stringify(key)).toEqual([202, true]);
    }
    for (const key of [{ kind: 'programme', slug: 'prog-b' }, { kind: 'programme', slug: 'prog-none' }, { kind: 'run', id: 999 }, { kind: 'item', id: 999 }]) {
      const res = await post(app, note(key));
      expect([res.statusCode, res.json().error], JSON.stringify(key)).toEqual([403, 'note-key-unknown']);
    }
    expect(rows().map((r) => [r.identity, r.keyKind, r.keyRef])).toEqual([[ID, 'programme', 'prog-a'], [ID, 'run', String(mine)], [ID, 'item', String(item)]]);
  });

  it('a key that could not be read is 502 unmeasured, never note-key-unknown', async () => {
    app = await open();
    const mine = runOf('prog-a', ID);
    c().run = () => ({ ok: false, kind: 'run-unreadable', detail: 'x' });
    const res = await post(app, note({ kind: 'run', id: mine }));
    expect([res.statusCode, res.json().error]).toEqual([502, 'unmeasured']);
    expect(res.json().detail).toMatch(/^could not check/);
    c().claimsProgramme = () => { throw new Error('series unreadable'); };
    const p = await post(app, note({ kind: 'programme', slug: 'prog-a' }));
    expect([p.statusCode, p.json().error]).toEqual([502, 'unmeasured']);
    expect(rows()).toEqual([]);
  });

  it('the 201st live note is 409 note-cap; a revision at the cap is 202; a close makes room', async () => {
    app = await open();
    const run = runOf('prog-a', ID);
    for (let i = 0; i < NOTES_CAP.count; i += 1) {
      const r = c().appendNote({ identity: ID, sessionId: ID, generationId: null, key: { kind: 'run', id: run }, kind: 'thread', waitsOn: `w${i}`, next: 'n', revises: null, closes: false, at: NOW });
      expect(r.ok).toBe(true);
    }
    const over = await post(app, note({ kind: 'run', id: run }));
    expect([over.statusCode, over.json().error]).toEqual([409, 'note-cap']);
    const revised = await post(app, note({ kind: 'run', id: run }, { revises: 1 }));
    expect(revised.statusCode).toBe(202);
    const closed = await post(app, { closes: true, revises: 2 });
    expect(closed.statusCode).toBe(202);
    expect(liveIds()).toHaveLength(NOTES_CAP.count - 1);
    expect((await post(app, note({ kind: 'run', id: run }))).statusCode).toBe(202);
  });

  it('a field over 500 characters is 400 note-too-long', async () => {
    app = await open();
    const run = runOf('prog-a', ID);
    const res = await post(app, note({ kind: 'run', id: run }, { next: 'x'.repeat(NOTES_CAP.chars + 1) }));
    expect([res.statusCode, res.json().error]).toEqual([400, 'note-too-long']);
    expect((await post(app, note({ kind: 'run', id: run }, { next: 'x'.repeat(NOTES_CAP.chars) }))).statusCode).toBe(202);
  });

  it('a revision supersedes: the old note leaves the live notes, and the GET answers the newest first', async () => {
    app = await open();
    const run = runOf('prog-a', ID);
    const first = (await post(app, note({ kind: 'run', id: run }, { next: 'one' }))).json().id as number;
    const second = (await post(app, note({ kind: 'programme', slug: 'prog-a' }, { next: 'two' }))).json().id as number;
    const third = (await post(app, note({ kind: 'run', id: run }, { next: 'three', revises: first }))).json().id as number;
    expect(liveIds()).toEqual([third, second]);
    const res = await get(app);
    expect(res.statusCode).toBe(200);
    expect(res.json().notes.map((n: { id: number; next: string; revises: number | null; keyFact: string }) => [n.id, n.next, n.revises, n.keyFact]))
      .toEqual([[third, 'three', first, 'live'], [second, 'two', null, 'live']]);
    // The superseded note's text is still on its row: append-only, nothing updated.
    expect(rows().map((r) => r.id)).toEqual([first, second, third]);
  });

  it('two revisions of one note: one wins, and the other is refused note-key-unknown (store and door)', async () => {
    app = await open();
    const run = runOf('prog-a', ID);
    const first = (await post(app, note({ kind: 'run', id: run }))).json().id as number;
    const rev = { identity: ID, sessionId: ID, generationId: null, key: { kind: 'run' as const, id: run }, kind: 'thread' as const,
      waitsOn: 'w', next: 'n', revises: first, closes: false, at: NOW };
    // At the store: the partial unique index lets one revision of a note stand.
    expect(c().appendNote(rev).ok).toBe(true);
    expect(c().appendNote(rev)).toEqual({ ok: false, kind: 'superseded' });
    // At the door: the note it revises is no longer live.
    const res = await post(app, note({ kind: 'run', id: run }, { revises: first }));
    expect([res.statusCode, res.json().error]).toEqual([403, 'note-key-unknown']);
  });

  it("a revision of another identity's note, or of a closed one, is 403 note-key-unknown", async () => {
    app = await open();
    runOf('prog-b', OTHER);
    const theirs = c().appendNote({ identity: OTHER, sessionId: OTHER, generationId: null, key: { kind: 'programme', slug: 'prog-b' }, kind: 'thread', waitsOn: 'w', next: 'n', revises: null, closes: false, at: NOW });
    if (!theirs.ok) throw new Error('fixture');
    const run = runOf('prog-a', ID);
    for (const revises of [theirs.id, 999]) {
      const res = await post(app, note({ kind: 'run', id: run }, { revises }));
      expect([res.statusCode, res.json().error]).toEqual([403, 'note-key-unknown']);
    }
    const mine = (await post(app, note({ kind: 'run', id: run }))).json().id as number;
    expect((await post(app, { closes: true, revises: mine })).statusCode).toBe(202);
    const again = await post(app, { closes: true, revises: mine });
    expect([again.statusCode, again.json().error]).toEqual([403, 'note-key-unknown']);
  });

  it('a note whose run closed stays live, is reported gone, and can be closed (close-needs-no-live-key)', async () => {
    app = await open();
    const run = runOf('prog-a', ID);
    const id = (await post(app, note({ kind: 'run', id: run }))).json().id as number;
    c().db.prepare("UPDATE runs SET state = 'done' WHERE id = ?").run(run);
    const res = await get(app);
    expect(res.json().notes.map((n: { id: number; keyFact: string }) => [n.id, n.keyFact])).toEqual([[id, 'gone']]);
    expect((await post(app, { closes: true, revises: id })).statusCode).toBe(202);
    expect(liveIds()).toEqual([]);
    const closeRow = rows().at(-1)!;
    expect([closeRow.keyKind, closeRow.keyRef, closeRow.revises, closeRow.closes]).toEqual(['run', String(run), id, 1]);
  });

  it('records the identity\'s live generation on the note', async () => {
    app = await open();
    const run = runOf('prog-a', ID);
    const gen = mint();
    const id = (await post(app, note({ kind: 'run', id: run }))).json().id as number;
    expect(c().db.prepare('SELECT generationId FROM continuity_notes WHERE id = ?').get(id)).toEqual({ generationId: gen.id });
  });
});

// ── the handover ─────────────────────────────────────────────────────────────────────────────────────────────────────
let reports = 0;
/** A generation of the caller's identity, minted `live` (a walk on `state`) or in shadow (a walk on `shadowState`). */
function mint(live = true): GenRow {
  reports += 1;
  const start = c().insertStart({ sessionId: ID, reportId: `report-${reports}`, uuid: UUID, source: 'clear', model: null, rowIncarnation: null, reportedAt: NOW, receivedAt: NOW });
  if (!start.ok) throw new Error('start');
  const held = c().liveGenerations();
  if (!held.ok) throw new Error(held.detail);
  const prev = held.rows.find((g) => g.identity === ID) ?? null;
  const input: MintInput = { identity: ID, sessionId: ID, role: 'coordinator', term: 1, rowIncarnation: null, startId: start.id, startReportedAt: NOW,
    resumed: false, model: null, lane: 'lane-a', host: null, outcome: 'renewed', mono: 1, proc: 'p', now: NOW };
  const m = c().mintGeneration(input, prev === null ? null : genExpectOf(prev), live);
  if (!m.ok) throw new Error(m.kind);
  return genOf();
}
function genOf(): GenRow {
  const r = c().liveGenerations();
  if (!r.ok) throw new Error(r.detail);
  return r.rows.find((g) => g.identity === ID)!;
}
/** Walk the caller's generation to `state` on its walk's column. */
function walkTo(state: 'checkpointed' | 'active' | 'draining', live: boolean): void {
  const g = genOf();
  const r = c().stepGeneration(g.id, genExpectOf(g), { ...GEN_ACTIVE, state }, live, NOW);
  if (!r.changed) throw new Error('step');
}
const goodHandover = (run: number) => ({
  threads: [{ ref: { kind: 'run', id: run }, waitsOn: 'PR is merged and approved', next: 'close the run' }],
  cautions: ['the radar is slow'], tone: 'calm',
});

describe('POST /api/sessions/:id/handover: only when asked, every reference a live row', () => {
  it('with no generation, or outside checkpointed, is 409 note-not-asked', async () => {
    app = await open();
    const run = runOf('prog-a', ID);
    const none = await handover(app, goodHandover(run));
    expect([none.statusCode, none.json().error]).toEqual([409, 'note-not-asked']);
    mint();
    for (const state of ['draining', 'active'] as const) {
      walkTo(state, true);
      const res = await handover(app, goodHandover(run));
      expect([res.statusCode, res.json().error], state).toEqual([409, 'note-not-asked']);
    }
    expect(c().db.prepare('SELECT count(*) AS n FROM continuity_handovers').get()).toEqual({ n: 0 });
  });

  it('SHADOW COLUMN: a shadow walk at checkpointed is asked though `state` reads active; a live walk reads `state`', async () => {
    app = await open();
    const run = runOf('prog-a', ID);
    mint(false);
    walkTo('checkpointed', false);
    const g = genOf();
    expect([g.state, g.shadowState, g.walk]).toEqual(['active', 'checkpointed', 'shadow']);
    expect((await handover(app, goodHandover(run))).statusCode).toBe(202);
    // A live walk at `checkpointed` with a shadow column that says otherwise: the walk's own column decides.
    mint(true);
    walkTo('checkpointed', true);
    c().db.prepare("UPDATE continuity_generations SET shadowState = 'draining' WHERE id = ?").run(genOf().id);
    expect((await handover(app, goodHandover(run))).statusCode).toBe(202);
  });

  it('a thread whose reference names no live row of the caller\'s is 400 reference-unknown; an unreadable one 502 unmeasured', async () => {
    app = await open();
    const run = runOf('prog-a', ID);
    mint();
    walkTo('checkpointed', true);
    const bad = await handover(app, { ...goodHandover(run), threads: [{ ref: { kind: 'run', id: 999 }, waitsOn: 'w', next: 'n' }] });
    expect([bad.statusCode, bad.json().error]).toEqual([400, 'reference-unknown']);
    c().run = () => ({ ok: false, kind: 'run-unreadable', detail: 'x' });
    const unread = await handover(app, goodHandover(run));
    expect([unread.statusCode, unread.json().error]).toEqual([502, 'unmeasured']);
    expect(c().db.prepare('SELECT count(*) AS n FROM continuity_handovers').get()).toEqual({ n: 0 });
  });

  it('a good one is stored once per generation, its status words dropped and counted', async () => {
    app = await open();
    const run = runOf('prog-a', ID);
    const gen = mint();
    walkTo('checkpointed', true);
    const res = await handover(app, goodHandover(run));
    expect([res.statusCode, res.json()]).toEqual([202, { ok: true, generationId: gen.id, dropped: 2, fresh: true }]);
    const again = await handover(app, { ...goodHandover(run), tone: 'second' });
    expect(again.json()).toEqual({ ok: true, generationId: gen.id, dropped: 2, fresh: false });
    const row = c().db.prepare('SELECT note, dropped FROM continuity_handovers WHERE generationId = ?').get(gen.id) as { note: string; dropped: number };
    expect([JSON.parse(row.note), row.dropped]).toEqual([{
      threads: [{ ref: { kind: 'run', id: run }, waitsOn: 'PR is and', next: 'close the run' }], cautions: ['the radar is slow'], tone: 'calm',
    }, 2]);
    // The next generation reads it as the one before it.
    const next = mint();
    expect(c().handoverBefore(ID, next.id)).toMatchObject({ ok: true, handover: { generationId: gen.id, dropped: 2 } });
  });

  it('a tone over 300 characters is 400 note-too-long; a malformed body 400 bad-request', async () => {
    app = await open();
    const run = runOf('prog-a', ID);
    mint();
    walkTo('checkpointed', true);
    const long = await handover(app, { ...goodHandover(run), tone: 'x'.repeat(301) });
    expect([long.statusCode, long.json().error]).toEqual([400, 'note-too-long']);
    for (const b of [{ threads: 'x', cautions: [], tone: '' }, { threads: [], cautions: [1], tone: '' }, { threads: [{ ref: { kind: 'run' } }], cautions: [], tone: '' }]) {
      const res = await handover(app, b);
      expect([res.statusCode, res.json().error], JSON.stringify(b)).toEqual([400, 'bad-request']);
    }
  });
});

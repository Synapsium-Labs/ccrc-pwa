// Overlord W1 gates B, plan docs/superpowers/plans/2026-11-14-overlord-w1/w1-gates.md Task 6 Step 1: a characterization of
// the six "start door" registrations of `server/src/continuity/routes.ts` as an ORDINARY session (a coordinator, never the
// Overlord) calls them: `GET /api/sessions/:id/card` (the card page and its `part=anchor` form), `POST` and `GET
// /api/sessions/:id/notes`, `POST /api/sessions/:id/handover`, and `GET` and `POST /api/sessions/:id/probe`.
//
// It pins today's status code AND whole JSON body of each door's refusals (no box token, a wrong-session path, a stale
// uuid, an unknown sender, the first shape refusal) and of its ordinary successes, and that no refusal writes a row. A later
// change puts a gate in front of these doors; this file is green before it and must stay green, unedited, after it: that
// is the proof a non-Overlord caller's answers are byte for byte what they were. Fixture HOMEs only, neutral names only.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance, LightMyRequestResponse } from 'fastify';
import { CoordStore } from '../src/coord/store.js';
import { NOTE_LIST_LIMIT } from '../src/continuity/notes.js';
import { fakeTime, type FakeTime } from './fakeTime.js';
import { ID_GATE_TOKEN, appFor, recorder, seedRow } from './idGateFixture.js';
import { mkTmp, removeTmpFixtures } from './tmpHelpers.js';

const ID = 'lane-a-project-a';
const OTHER = 'lane-b-project-a';
const GHOST = 'lane-z-project-a';
const UUID = '11111111-2222-3333-4444-555555555555';
const OTHER_UUID = '66666666-7777-8888-9999-000000000000';

let home: string;
let app: FastifyInstance | undefined;
let coord: CoordStore | undefined;
let time: FakeTime;

beforeEach(() => {
  home = mkTmp('ccrc-start-doors-');
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

const TABLES = ['continuity_notes', 'continuity_handovers', 'continuity_probes', 'continuity_card_reads', 'continuity_snapshots'] as const;
const counts = (): Record<string, number> =>
  Object.fromEntries(TABLES.map((t) => [t, (coord!.db.prepare(`SELECT COUNT(*) AS n FROM ${t}`).get() as { n: number }).n]));

const TOKEN_DETAIL = 'no box token presented: this lane takes the box token (x-ccrc-mail-token) and nothing else';
const STALE_DETAIL = 'byUuid does not match the registry — stale sender; re-read your own .uuid';
const refusal = (error: string, detail: string) => ({ ok: false, error, detail });
const HEX64 = expect.stringMatching(/^[0-9a-f]{64}$/);

const H = { 'x-ccrc-mail-token': ID_GATE_TOKEN };
const by = (id: string, uuid: string) => ({ byId: id, byUuid: uuid });
const getOf = (a: FastifyInstance, door: string, q: Record<string, string>, id = ID, token = true) =>
  a.inject({ method: 'GET', url: `/api/sessions/${id}/${door}?${new URLSearchParams(q)}`, headers: token ? H : {} });
const postOf = (a: FastifyInstance, door: string, body: Record<string, unknown>, id = ID, token = true) =>
  a.inject({ method: 'POST', url: `/api/sessions/${id}/${door}`, headers: token ? H : {}, payload: body });
const said = (res: LightMyRequestResponse, status: number, body: unknown): void => {
  expect(res.statusCode).toBe(status);
  expect(res.json()).toEqual(body);
};

const GOOD_NOTE = { key: { kind: 'programme', slug: 'prog-a' }, kind: 'thread', waitsOn: 'the review', next: 'rule on it' };
const GOOD_HANDOVER = { threads: [], cautions: [], tone: 'steady' };
const GOOD_PROBE = { roundId: 'r-1', answers: [] };

/** One door as a caller sees it: how to call it with a given path id, identity and token, and its good body. */
interface Door {
  name: string;
  call: (a: FastifyInstance, id: string, ident: Record<string, string>, token: boolean) => Promise<LightMyRequestResponse>;
  /** The wording of the wrong-session refusal's detail. */
  ownerDetail: string;
}
const DOORS: Door[] = [
  { name: 'GET card', call: (a, id, i, t) => getOf(a, 'card', i, id, t), ownerDetail: 'byId must be the session the path names: a session reads its own card' },
  { name: 'GET notes', call: (a, id, i, t) => getOf(a, 'notes', i, id, t), ownerDetail: 'byId must be the session the path names: a session keeps its own notes' },
  { name: 'POST notes', call: (a, id, i, t) => postOf(a, 'notes', { ...i, ...GOOD_NOTE }, id, t), ownerDetail: 'byId must be the session the path names: a session keeps its own notes' },
  { name: 'POST handover', call: (a, id, i, t) => postOf(a, 'handover', { ...i, ...GOOD_HANDOVER }, id, t), ownerDetail: 'byId must be the session the path names: a session keeps its own notes' },
  { name: 'GET probe', call: (a, id, i, t) => getOf(a, 'probe', i, id, t), ownerDetail: 'byId must be the session the path names: a session answers its own probes' },
  { name: 'POST probe', call: (a, id, i, t) => postOf(a, 'probe', { ...i, ...GOOD_PROBE }, id, t), ownerDetail: 'byId must be the session the path names: a session answers its own probes' },
];

describe.each(DOORS)('$name: who may call it', (door) => {
  it('no box token is 401 unauthenticated, and writes nothing', async () => {
    app = await open();
    const before = counts();
    said(await door.call(app, ID, by(ID, UUID), false), 401, refusal('unauthenticated', TOKEN_DETAIL));
    expect(counts()).toEqual(before);
  });

  it('a path that is not the caller is 403 not-owner, and writes nothing', async () => {
    app = await open();
    const before = counts();
    said(await door.call(app, ID, by(OTHER, UUID), true), 403, refusal('not-owner', door.ownerDetail));
    expect(counts()).toEqual(before);
  });

  it("a uuid the registry has not followed is 403 stale-uuid, and writes nothing", async () => {
    app = await open();
    const before = counts();
    said(await door.call(app, ID, by(ID, OTHER_UUID), true), 403, refusal('stale-uuid', STALE_DETAIL));
    expect(counts()).toEqual(before);
  });

  it('a sender with no registry row is 403 unknown-sender, and writes nothing', async () => {
    app = await open();
    const before = counts();
    said(await door.call(app, GHOST, by(GHOST, UUID), true), 403, refusal('unknown-sender', `no registry row for ${GHOST}`));
    expect(counts()).toEqual(before);
  });
});

describe('the first shape refusal of each door, and nothing written', () => {
  it('card: page 0 is 400 bad-request', async () => {
    app = await open();
    said(await getOf(app, 'card', { ...by(ID, UUID), page: '0' }), 400, refusal('bad-request', 'page is a positive integer'));
    expect(counts()).toEqual({ continuity_notes: 0, continuity_handovers: 0, continuity_probes: 0, continuity_card_reads: 0, continuity_snapshots: 0 });
  });

  it('card: a form without part=anchor is 400 bad-request', async () => {
    app = await open();
    said(await getOf(app, 'card', { ...by(ID, UUID), form: 'start' }), 400, refusal('bad-request', "form is part=anchor's"));
    expect(counts().continuity_snapshots).toBe(0);
  });

  it('notes POST: a key of no kind is 400 bad-request', async () => {
    app = await open();
    said(await postOf(app, 'notes', { ...by(ID, UUID), ...GOOD_NOTE, key: { kind: 'request', id: 1 } }), 400,
      refusal('bad-request', 'key is { kind: programme, slug } or { kind: item | run, id }'));
    expect(counts().continuity_notes).toBe(0);
  });

  it('notes GET: a before that is not a note id is 400 bad-request', async () => {
    app = await open();
    said(await getOf(app, 'notes', { ...by(ID, UUID), before: 'abc' }), 400,
      refusal('bad-request', `before is a note id, and limit a whole number from 1 to ${NOTE_LIST_LIMIT.max}`));
  });

  it('handover: threads that are not a list is 400 bad-request', async () => {
    app = await open();
    said(await postOf(app, 'handover', { ...by(ID, UUID), threads: 'x', cautions: [], tone: 'steady' }), 400,
      refusal('bad-request', 'threads and cautions are lists, tone a string'));
    expect(counts().continuity_handovers).toBe(0);
  });

  it('probe GET: page 0 is 400 bad-request', async () => {
    app = await open();
    said(await getOf(app, 'probe', { ...by(ID, UUID), page: '0' }), 400, refusal('bad-request', 'page is a positive integer'));
  });

  it('probe POST: a roundId of the wrong shape is 400 bad-request', async () => {
    app = await open();
    said(await postOf(app, 'probe', { ...by(ID, UUID), roundId: 'no good', answers: [] }), 400,
      refusal('bad-request', 'roundId is the id the round was served with'));
    expect(counts().continuity_probes).toBe(0);
  });
});

describe('the ordinary answers of a coordinator', () => {
  it('card page 1 is 200 with the paged card, stores one snapshot, and records the full read', async () => {
    app = await open();
    const res = await getOf(app, 'card', by(ID, UUID));
    // The hash and the snapshot id are sha256 digests of the rendered card and its facts: their shape is pinned, not their value.
    said(res, 200, { ok: true, hash: HEX64, snapshotId: HEX64, page: 1, pages: expect.any(Number), text: expect.any(String), recorded: expect.any(Boolean) });
    expect(res.json().page).toBe(1);
    expect(res.json().pages).toBeGreaterThanOrEqual(1);
    expect(counts().continuity_snapshots).toBe(1);
  });

  it('the anchor form (page=0, form=start) answers and stores no snapshot and records no read', async () => {
    app = await open();
    const res = await getOf(app, 'card', { ...by(ID, UUID), part: 'anchor', page: '0', form: 'start' });
    said(res, 200, ANCHOR_START);
    expect(counts()).toEqual({ continuity_notes: 0, continuity_handovers: 0, continuity_probes: 0, continuity_card_reads: 0, continuity_snapshots: 0 });
  });

  it('a note write is 202 { ok, id }, and the notes list answers it with its key fact', async () => {
    app = await open();
    // A note keys to a live row of the caller's: the caller's own open run.
    const run = coord!.openRun({ program: 'prog-a', title: 'PROG-A', project: 'project-a', wave: 1, waveOf: 2, claimedBy: ID }) as { id: number };
    const key = { kind: 'run', id: run.id };
    said(await postOf(app, 'notes', { ...by(ID, UUID), ...GOOD_NOTE, key }), 202, { ok: true, id: expect.any(Number) });
    expect(counts().continuity_notes).toBe(1);
    const list = await getOf(app, 'notes', by(ID, UUID));
    said(list, 200, {
      ok: true, more: false,
      notes: [{
        id: expect.any(Number), key, kind: 'thread', waitsOn: 'the review', next: 'rule on it', revises: null,
        // `at` is the fake clock's wall time; its value is not what this file pins.
        at: expect.any(Number), keyFact: expect.anything(),
      }],
    });
  });

  it('the notes list with nothing written is 200 with no notes', async () => {
    app = await open();
    said(await getOf(app, 'notes', by(ID, UUID)), 200, { ok: true, notes: [], more: false });
  });

  it('a handover with no checkpointed generation is 409 note-not-asked, and writes nothing', async () => {
    app = await open();
    const res = await postOf(app, 'handover', { ...by(ID, UUID), ...GOOD_HANDOVER });
    said(res, 409, NOT_ASKED);
    expect(counts().continuity_handovers).toBe(0);
  });

  it('probe GET with no round open is 409 probe-none-open', async () => {
    app = await open();
    said(await getOf(app, 'probe', by(ID, UUID)), 409, refusal('probe-none-open', 'no probe round of yours is open'));
  });

  it('probe POST for an unknown round is 409 probe-none-open, and writes nothing', async () => {
    app = await open();
    said(await postOf(app, 'probe', { ...by(ID, UUID), ...GOOD_PROBE }), 409, refusal('probe-none-open', 'no probe round of yours is r-1'));
    expect(counts().continuity_probes).toBe(0);
  });
});

// The Shadow lanes row `anchor-slot` is shadow by default: the door still renders, and answers `dark` with no text.
const ANCHOR_START = { ok: true, part: 'anchor', form: 'start', dark: true };
const NOT_ASKED = refusal('note-not-asked', 'no handover was asked: your generation is not checkpointed');

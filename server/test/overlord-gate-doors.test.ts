// Overlord W1, gates B (plan w1-gates.md Task 6, Review Focus 1 and 5; spec §11.2): the six start doors (`GET /api/sessions/:id/card`,
// `POST` and `GET .../notes`, `POST .../handover`, `GET` and `POST .../probe`, every `overlord` row of `coord/overlordDoors.ts`)
// through the FULL server (`buildServer`, a real `CoordStore`, a fixture HOME's registry), with a designation row written by its
// real writers (`designatePending`, `bindPendingGeneration`, `goLive`), the Overlord's id bound with an incarnation string and
// the registry's `$REG/<id>.generation` file set to the caller's incarnation. Fixture HOMEs only; neutral names only.
//
//   - a session that is not the Overlord is served as before (`hook`): the same answers `start-doors-characterization.test.ts` pins;
//   - the bound id with another incarnation (or none) is refused 403 `not-the-overlord` at each of the six, read and write;
//   - with the designation unmeasured, every caller, a coordinator included, is refused 503 `unavailable` at each of the six;
//   - the bound Overlord with its own incarnation, on a server without `continuity-v1` (taken out of the server's words here; the
//     real `SERVER_CAPS` holds it since door process B1, which `server-caps.test.ts` pins): 501 `capability-missing` at step 2,
//     at each of the six;
//   - with `continuity-v1` among the server's words (this file mocks `shared/api.ts`'s `SERVER_CAPS` for the one array the
//     server reads per call, and puts the word back; no source changes): a live generation of an older term at a write row is 409 `stale-designation`, a
//     read row passes, and an attributed card read with no act key records no `continuity_card_reads` row;
//   - on every refusal, at `hook` rows too, the five continuity tables keep their row counts.
//
// One server per describe; the cases move the designation row and the registry file between them.
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import Fastify, { type FastifyInstance, type LightMyRequestResponse } from 'fastify';
import { openCoordDb } from '../src/coord/db.js';
import { registerContinuityRoutes } from '../src/continuity/routes.js';
import { refuseRoute } from '../src/refuse.js';
import { CoordStore } from '../src/coord/store.js';
import { OVERLORD_DOORS } from '../src/coord/overlordDoors.js';
import type { AuthorityAppender } from '../src/coord/overlordDesignationStore.js';
import { attributionIdentity } from '../src/auth/attributionIdentity.js';
import { gateActorOf } from '../src/accounts/audit.js';
import { genExpectOf, type GenRow, type MintInput } from '../src/continuity/continuityStore.js';
import { REFUSAL_STATUS } from '../../shared/refusal.js';
import { fakeTime } from './fakeTime.js';
import { ID_GATE_TOKEN, appFor, recorder, seedRow } from './idGateFixture.js';
import { mkTmp, removeTmpFixtures } from './tmpHelpers.js';

// The server reads `SERVER_CAPS` per call through one imported binding. This mock hands it ONE array this file edits (the real
// words, copied), so a case can add `continuity-v1` and remove it again; nothing under `server/src` changes.
const { CAPS } = vi.hoisted(() => ({ CAPS: [] as string[] }));
vi.mock('../../shared/api.js', async (importOriginal) => {
  const m = await importOriginal<typeof import('../../shared/api.js')>();
  CAPS.push(...m.SERVER_CAPS);
  return { ...m, SERVER_CAPS: CAPS };
});
const WORD = 'continuity-v1';
const withWord = (on: boolean): void => {
  const at = CAPS.indexOf(WORD);
  if (on && at < 0) CAPS.push(WORD);
  if (!on && at >= 0) CAPS.splice(at, 1);
};

vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 });

const ID = 'lane-a-project-a';        // the Overlord's id
const OTHER = 'lane-b-project-a';     // a coordinator
const UUID = '11111111-2222-3333-4444-555555555555';
const OTHER_UUID = '66666666-7777-8888-9999-000000000000';
const GEN_A = 'aaaaaaaa-1111-2222-3333-444444444444';    // the incarnation the designation recorded
const GEN_B = 'bbbbbbbb-1111-2222-3333-444444444444';    // another incarnation of the same id
const NOW = 1_800_000_000_000;
const TABLES = ['continuity_notes', 'continuity_handovers', 'continuity_probes', 'continuity_card_reads', 'continuity_snapshots'] as const;

interface Rig { home: string; app: FastifyInstance; coord: CoordStore }

/** One server over a fixture HOME, the Overlord's id bound live through the real writers. */
async function rig(prefix: string): Promise<Rig> {
  const home = mkTmp(prefix);
  seedRow(home, ID, { uuid: UUID, project: 'project-a' });
  seedRow(home, OTHER, { uuid: OTHER_UUID, project: 'project-a' });
  writeFileSync(path.join(home, '.cc-sessions', `${ID}.generation`), GEN_A);
  const r = await appFor(home, recorder().run, { time: fakeTime().ports });
  await r.app.ready();
  const journal = { appendInTx: () => ({ ok: true, kind: 'appended', record: {} }) } as unknown as AuthorityAppender;
  const actor = attributionIdentity({ attribute: async () => ({ ok: true }), incarnation: async () => ({ kind: 'unmeasured', reason: 'absent' }) })
    .operator(gateActorOf('device-a', 'abcdef0123456789'));
  const des = r.coord.designatePending(journal, { sessionId: ID, deadlineAt: NOW + 60_000, model: 'opus', accountPools: { pools: ['pool-a'], untagged: false }, actor, at: NOW, opKey: 'op-designate-1' });
  if (!des.ok) throw new Error(`designatePending: ${JSON.stringify(des)}`);
  const bound = r.coord.bindPendingGeneration(ID, GEN_A, NOW);
  if (!bound.ok) throw new Error(`bindPendingGeneration: ${JSON.stringify(bound)}`);
  const live = r.coord.goLive(journal, ID, GEN_A, NOW);
  if (!live.ok || !live.changed) throw new Error(`goLive: ${JSON.stringify(live)}`);
  expect(r.coord.designationRead()).toMatchObject({ kind: 'designated', sessionId: ID, term: 1 });
  return { home, app: r.app, coord: r.coord };
}
const close = async (r: Rig | undefined): Promise<void> => { if (r) { await r.app.close(); r.coord.db.close(); } };

const counts = (c: CoordStore): Record<string, number> =>
  Object.fromEntries(TABLES.map((t) => [t, (c.db.prepare(`SELECT COUNT(*) AS n FROM ${t}`).get() as { n: number }).n]));
/** Every row of every table the doors write, in full (F3-a): a count would miss a row REWRITTEN in place, as the card's
 *  snapshot is when a page is served again (`insertSnapshot` bumps `served` on a held id). */
const rowsOf = (c: CoordStore): Record<string, unknown[]> =>
  Object.fromEntries(TABLES.map((t) => [t, c.db.prepare(`SELECT * FROM ${t} ORDER BY rowid`).all()]));
const GOOD_POOLS = JSON.stringify({ pools: ['pool-a'], untagged: false });
const corruptDesignation = (c: CoordStore): void => { c.db.prepare("UPDATE overlord_designation SET accountPools = 'not json' WHERE id = 1").run(); };
const repairDesignation = (c: CoordStore): void => { c.db.prepare('UPDATE overlord_designation SET accountPools = ? WHERE id = 1').run(GOOD_POOLS); };
const setIncarnation = (home: string, id: string, v: string | null): void => {
  const f = path.join(home, '.cc-sessions', `${id}.generation`);
  if (v === null) rmSync(f, { force: true }); else writeFileSync(f, v);
};

const H = { 'x-ccrc-mail-token': ID_GATE_TOKEN };
const by = (id: string, uuid: string) => ({ byId: id, byUuid: uuid });
const getOf = (a: FastifyInstance, door: string, q: Record<string, string>, id: string) =>
  a.inject({ method: 'GET', url: `/api/sessions/${id}/${door}?${new URLSearchParams(q)}`, headers: H });
const postOf = (a: FastifyInstance, door: string, body: Record<string, unknown>, id: string) =>
  a.inject({ method: 'POST', url: `/api/sessions/${id}/${door}`, headers: H, payload: body });
const refusal = (error: string, detail: string) => ({ ok: false, error, detail });
const said = (res: LightMyRequestResponse, status: number, body: unknown): void => {
  expect(res.statusCode).toBe(status);
  expect(res.json()).toEqual(body);
};

const GOOD_NOTE = { key: { kind: 'programme', slug: 'prog-a' }, kind: 'thread', waitsOn: 'the review', next: 'rule on it' };
const GOOD_HANDOVER = { threads: [], cautions: [], tone: 'steady' };
const GOOD_PROBE = { roundId: 'r-1', answers: [] };

/** One start door as a caller sees it, keyed by its row of the table. */
interface Door { key: string; name: string; write: boolean; call: (a: FastifyInstance, id: string, uuid: string) => Promise<LightMyRequestResponse> }
const DOORS: Door[] = [
  { key: 'card', name: 'GET card', write: false, call: (a, id, u) => getOf(a, 'card', by(id, u), id) },
  { key: 'notes-read', name: 'GET notes', write: false, call: (a, id, u) => getOf(a, 'notes', by(id, u), id) },
  { key: 'notes-write', name: 'POST notes', write: true, call: (a, id, u) => postOf(a, 'notes', { ...by(id, u), ...GOOD_NOTE }, id) },
  { key: 'handover', name: 'POST handover', write: true, call: (a, id, u) => postOf(a, 'handover', { ...by(id, u), ...GOOD_HANDOVER }, id) },
  { key: 'probe-read', name: 'GET probe', write: false, call: (a, id, u) => getOf(a, 'probe', by(id, u), id) },
  { key: 'probe-answer', name: 'POST probe', write: true, call: (a, id, u) => postOf(a, 'probe', { ...by(id, u), ...GOOD_PROBE }, id) },
];

describe('the six doors and the table agree (a door this file does not drive would be a gap)', () => {
  it('every overlord row is one of the six doors driven here, card-record being the card door\'s second page', () => {
    const rows = Object.entries(OVERLORD_DOORS).filter(([, r]) => r.group === 'overlord').map(([k]) => k);
    // D-8809: `link-team` (POST /api/linking/confirm) is driven through the real gate in `linking-overlord-confirm.test.ts`.
    expect(rows.sort()).toEqual([...DOORS.map((d) => d.key), 'card-record', 'link-team'].sort());
  });
});

// ── a session that is not the Overlord is served as before ─────────────────────────────────────────────────────────────

describe('a session that is not the Overlord is served as it was (hook)', () => {
  let r: Rig;
  beforeAll(async () => { r = await rig('ccrc-gate-doors-hook-'); });
  afterAll(async () => { await close(r); removeTmpFixtures(); });

  it('GET notes: 200 with no notes', async () => {
    said(await DOORS[1]!.call(r.app, OTHER, OTHER_UUID), 200, { ok: true, notes: [], more: false });
  });
  it('POST notes: 202 { ok, id }, on a key the coordinator owns', async () => {
    const run = r.coord.openRun({ program: 'prog-a', title: 'PROG-A', project: 'project-a', wave: 1, waveOf: 2, claimedBy: OTHER }) as { id: number };
    said(await postOf(r.app, 'notes', { ...by(OTHER, OTHER_UUID), ...GOOD_NOTE, key: { kind: 'run', id: run.id } }, OTHER), 202, { ok: true, id: expect.any(Number) });
    expect(counts(r.coord).continuity_notes).toBe(1);
  });
  it('GET card page 1: 200 with the paged card, one snapshot stored', async () => {
    const res = await DOORS[0]!.call(r.app, OTHER, OTHER_UUID);
    said(res, 200, { ok: true, hash: expect.stringMatching(/^[0-9a-f]{64}$/), snapshotId: expect.stringMatching(/^[0-9a-f]{64}$/), page: 1, pages: expect.any(Number), text: expect.any(String), recorded: expect.any(Boolean) });
    expect(counts(r.coord).continuity_snapshots).toBe(1);
  });
  it('POST handover with no checkpointed generation: 409 note-not-asked', async () => {
    said(await DOORS[3]!.call(r.app, OTHER, OTHER_UUID), 409, refusal('note-not-asked', 'no handover was asked: your generation is not checkpointed'));
  });
  it('GET probe with no round open: 409 probe-none-open', async () => {
    said(await DOORS[4]!.call(r.app, OTHER, OTHER_UUID), 409, refusal('probe-none-open', 'no probe round of yours is open'));
  });
  it('POST probe for an unknown round: 409 probe-none-open', async () => {
    said(await DOORS[5]!.call(r.app, OTHER, OTHER_UUID), 409, refusal('probe-none-open', 'no probe round of yours is r-1'));
  });
  it('a refusal at a hook row (a stale uuid) is the registry\'s own answer, and writes nothing', async () => {
    for (const d of DOORS) {
      const before = counts(r.coord);
      said(await d.call(r.app, OTHER, OTHER_UUID.replace(/0$/, '1')), 403, refusal('stale-uuid', 'byUuid does not match the registry — stale sender; re-read your own .uuid'));
      expect(counts(r.coord), d.name).toEqual(before);
    }
  });
});

// ── the bound id with another incarnation ──────────────────────────────────────────────────────────────────────────────

describe('the bound id with another incarnation is refused not-the-overlord at each door, and writes nothing', () => {
  let r: Rig;
  beforeAll(async () => { r = await rig('ccrc-gate-doors-inc-'); });
  afterAll(async () => { await close(r); removeTmpFixtures(); });

  for (const d of DOORS) {
    it(`${d.name} (${d.key}): a different incarnation is 403 not-the-overlord`, async () => {
      setIncarnation(r.home, ID, GEN_B);
      const before = counts(r.coord);
      const res = await d.call(r.app, ID, UUID);
      expect([res.statusCode, res.json().error, res.json().step]).toEqual([403, 'not-the-overlord', '1']);
      expect(counts(r.coord)).toEqual(before);
    });
    it(`${d.name} (${d.key}): an absent incarnation is 403 not-the-overlord too`, async () => {
      setIncarnation(r.home, ID, null);
      const before = counts(r.coord);
      const res = await d.call(r.app, ID, UUID);
      expect([res.statusCode, res.json().error]).toEqual([403, 'not-the-overlord']);
      expect(counts(r.coord)).toEqual(before);
    });
  }
  it('an unreadable incarnation is not a pass: the registry-unmeasurable word, at each door', async () => {
    setIncarnation(r.home, ID, 'not an incarnation');
    for (const d of DOORS) {
      const before = counts(r.coord);
      const res = await d.call(r.app, ID, UUID);
      expect([res.statusCode, res.json().error], d.name).toEqual([REFUSAL_STATUS['registry-unmeasurable'], 'registry-unmeasurable']);
      expect(counts(r.coord)).toEqual(before);
    }
  });
});

// ── an unmeasured designation ──────────────────────────────────────────────────────────────────────────────────────────

describe('with the designation unmeasured every caller is refused unavailable at each door, a coordinator included', () => {
  let r: Rig;
  beforeAll(async () => { r = await rig('ccrc-gate-doors-unmeasured-'); });
  afterAll(async () => { await close(r); removeTmpFixtures(); });

  it('the corrupted row reads as unmeasured', () => {
    corruptDesignation(r.coord);
    expect(r.coord.designationRead().kind).toBe('unmeasured');
    repairDesignation(r.coord);
    expect(r.coord.designationRead().kind).toBe('designated');
  });
  for (const d of DOORS) {
    it(`${d.name} (${d.key}): the Overlord's id and a coordinator both get 503 unavailable`, async () => {
      corruptDesignation(r.coord);
      try {
        const before = counts(r.coord);
        for (const [id, uuid] of [[ID, UUID], [OTHER, OTHER_UUID]] as const) {
          const res = await d.call(r.app, id, uuid);
          expect([res.statusCode, res.json().error, res.json().step], id).toEqual([503, 'unavailable', '1']);
        }
        expect(counts(r.coord)).toEqual(before);
      } finally { repairDesignation(r.coord); }
    });
  }
});

// ── the Overlord itself ────────────────────────────────────────────────────────────────────────────────────────────────

describe('the bound Overlord with its own incarnation, on a server without continuity-v1', () => {
  let r: Rig;
  beforeAll(async () => { withWord(false); r = await rig('ccrc-gate-doors-caps-'); });
  afterAll(async () => { await close(r); removeTmpFixtures(); });

  it('the server\'s words lack continuity-v1 here (this describe takes it out of the mocked array; the real SERVER_CAPS holds it since door process B1)', () => {
    expect(CAPS).not.toContain(WORD);
  });
  for (const d of DOORS) {
    it(`${d.name} (${d.key}): 501 capability-missing at step 2, and writes nothing`, async () => {
      const before = counts(r.coord);
      const res = await d.call(r.app, ID, UUID);
      expect([res.statusCode, res.json().error, res.json().step]).toEqual([501, 'capability-missing', '2']);
      expect(counts(r.coord)).toEqual(before);
    });
  }
});

describe('with continuity-v1 among the server\'s words (as the real SERVER_CAPS holds it since door process B1)', () => {
  let r: Rig;
  let reports = 0;
  beforeAll(async () => { withWord(true); r = await rig('ccrc-gate-doors-live-'); });
  afterAll(async () => { withWord(false); await close(r); removeTmpFixtures(); });

  /** The Overlord's live generation at a `term`, ending the one before it. */
  function mintOverlord(term: number): GenRow {
    reports += 1;
    const start = r.coord.insertStart({ sessionId: ID, reportId: `report-${reports}`, uuid: UUID, source: 'clear', model: null, rowIncarnation: null, reportedAt: NOW, receivedAt: NOW });
    if (!start.ok) throw new Error('insertStart');
    const held = r.coord.liveGenerations();
    if (!held.ok) throw new Error(held.detail);
    const prev = held.rows.find((g) => g.identity === 'overlord') ?? null;
    const input: MintInput = { identity: 'overlord', sessionId: ID, role: 'overlord', term, rowIncarnation: GEN_A, startId: start.id, startReportedAt: NOW,
      resumed: false, model: null, lane: 'lane-a', host: null, outcome: 'renewed', mono: 1, proc: 'p', now: NOW };
    const m = r.coord.mintGeneration(input, prev === null ? null : genExpectOf(prev), true);
    if (!m.ok) throw new Error(m.kind);
    const after = r.coord.liveGenerations();
    if (!after.ok) throw new Error(after.detail);
    return after.rows.find((g) => g.identity === 'overlord')!;
  }

  it('the word is held, and a read door passes the Overlord (notes list: 200)', async () => {
    expect(CAPS).toContain(WORD);
    const res = await DOORS[1]!.call(r.app, ID, UUID);
    expect([res.statusCode, res.json().ok]).toEqual([200, true]);
  });

  for (const d of DOORS.filter((x) => x.write)) {
    it(`${d.name} (${d.key}): a live generation of an older term is 409 stale-designation at step 5, and writes nothing`, async () => {
      mintOverlord(0);
      const before = counts(r.coord);
      const res = await d.call(r.app, ID, UUID);
      expect([res.statusCode, res.json().error, res.json().step]).toEqual([REFUSAL_STATUS['stale-designation'], 'stale-designation', '5']);
      expect(counts(r.coord)).toEqual(before);
    });
  }

  const fenceRows = (): number => (r.coord.db.prepare('SELECT COUNT(*) AS n FROM overlord_fence_refusals').get() as { n: number }).n;

  it('a forged card read on a one-page card (attributed, no act key) is refused 409 stale-generation at step 7 on page 1, writing nothing at all', async () => {
    mintOverlord(1);
    const before = counts(r.coord);
    const fenced = fenceRows();
    const res = await DOORS[0]!.call(r.app, ID, UUID);
    const body = res.json();
    // The fixture's card is ONE page, so the page that is served is also the recording one: the read door passed (`card`), the
    // recording page (`card-record`) was asked BEFORE anything was written, and its fence refused for want of an act key
    // (review 2803 F3). No page is served, and the refusal is counted as a fact.
    expect([res.statusCode, body.error, body.step, body.detail]).toEqual([REFUSAL_STATUS['stale-generation'], 'stale-generation', '7', 'no act key presented']);
    expect(body.text).toBeUndefined();
    expect(fenceRows()).toBe(fenced + 1);
    expect(counts(r.coord)).toEqual(before);
    expect(counts(r.coord).continuity_card_reads).toBe(0);
  });

  it('the card\'s recording page at an older term is 409 stale-designation at step 5, and records no read', async () => {
    mintOverlord(0);
    const res = await DOORS[0]!.call(r.app, ID, UUID);
    expect([res.statusCode, res.json().error, res.json().step]).toEqual([REFUSAL_STATUS['stale-designation'], 'stale-designation', '5']);
    expect(counts(r.coord).continuity_card_reads).toBe(0);
  });
});

// The Overlord's own card is one fixed line today (`CARD_OVERLORD_LINE`), so no full-server fixture can make it more than one
// page. The page arithmetic of the recording fence is the door's, whoever's card it pages, so this case builds the continuity
// routes by hand over a session whose card is three pages, behind a scripted gate: the read door passes it as the Overlord
// (`kind: 'pass'`) and the recording row's fence refuses it, as the real runner does for a read with no act key.
describe('a multi-page card read behind a gate whose card-record fence refuses (review 2803 F3)', () => {
  it('the pages before the last answer 200 recorded:false; the last is refused 409 and nothing at all is written by that call', async () => {
    const home = mkTmp('ccrc-gate-doors-pages-');
    const coord = new CoordStore(openCoordDb(path.join(home, '.ccrc', 'coord.db')));
    const asked: string[] = [];
    const app = Fastify({ logger: false });
    registerContinuityRoutes(app, {
      coord, mailToken: () => ID_GATE_TOKEN, attribute: async () => ({ ok: true }), wall: () => NOW,
      attributeReader: async () => ({ ok: true }),
      gate: async (_req, reply, key) => {
        asked.push(key);
        if (key !== 'card-record') return { kind: 'pass', caller: {} as never, generation: null };
        void refuseRoute(reply, 'stale-generation', { detail: 'no act key presented', step: '7' });
        return { kind: 'refused' };
      },
      cardRegistry: { childMark: async () => ({ kind: 'none' }), incarnation: async () => ({ kind: 'absent' }), declaredIntent: () => false },
      setterStamp: async () => ({ kind: 'unmeasured', reason: 'absent' }),
    });
    await app.ready();
    try {
      for (let i = 0; i < 15; i += 1) {
        const m = coord.insertMail({ fromId: OTHER, fromUuid: 'u', toId: ID, runId: null, kind: 'status', subject: `s${i} ${'x'.repeat(1000)}`, body: 'b', artifacts: [] });
        coord.queueDelivery(m.id, ID, '<mail/>');
      }
      const p1 = await getOf(app, 'card', by(ID, UUID), ID);
      const first = p1.json();
      expect([p1.statusCode, first.ok, first.recorded]).toEqual([200, true, false]);
      expect(first.pages).toBeGreaterThan(1);
      for (let p = 2; p < first.pages; p += 1) {
        const mid = await getOf(app, 'card', { ...by(ID, UUID), page: String(p), hash: first.hash }, ID);
        expect([mid.statusCode, mid.json().recorded], `page ${p}`).toEqual([200, false]);
      }
      expect(asked.every((k) => k === 'card')).toBe(true);   // no page before the last asked the recording row
      const before = rowsOf(coord);
      expect(before['continuity_snapshots']).toHaveLength(1);   // page 1 stored the snapshot; the last page must not rewrite it
      const last = await getOf(app, 'card', { ...by(ID, UUID), page: String(first.pages), hash: first.hash }, ID);
      expect([last.statusCode, last.json().error, last.json().step]).toEqual([REFUSAL_STATUS['stale-generation'], 'stale-generation', '7']);
      expect(last.json().text).toBeUndefined();
      expect(asked.at(-1)).toBe('card-record');
      expect(rowsOf(coord)).toEqual(before);   // content, not counts: a snapshot rewritten before the fence reds this
      expect(counts(coord).continuity_card_reads).toBe(0);
    } finally { await app.close(); coord.db.close(); removeTmpFixtures(); }
  });
});

// Ticket titles through the Linear slots (#1444, D-7668; spec 2026-10-31 §6.10, §14 row 21; plan task LK3).
//
// The first block is the CHARACTERIZATION, written green on the code before titles moved to the slots: a box with
// only the legacy `linear.key` gets real titles through all three callers of `resolveTitle` (the preview, the
// workspace create and the rename), a Linear 401 marks the legacy pair rejected and a success clears that verdict,
// and a box with no key at all asks Linear nothing. It never changes after it lands.
//
// Every caller is driven through `buildServer`, with the one rate service handed in `Deps` as `index.ts` hands it.
// Nothing here reaches the network: `deps.linear.fetch` is the seam, and every Linear answer is a stub.
import { afterEach, describe, expect, it } from 'vitest';
import type { FastifyInstance, LightMyRequestResponse } from 'fastify';
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { LinearStoreRecord, LinearTeam } from '../../shared/linear.js';
import { buildServer } from '../src/server.js';
import { WS_TITLE_CAP, WS_TITLE_VERB, WS_WRAPPER_CAP } from '../src/ccdargv.js';
import { LINEAR_DETAILS_FILE, LINEAR_KEY_FILE, keyTailOf, parseLinearDetails } from '../src/linear/connection.js';
import type { FetchLike } from '../src/linear/client.js';
import {
  LINEAR_STORE_DIR, putLinearSlot, readLinearStore, removeLinearSlot, writeLegacyTeams, type LinearSlotRef,
} from '../src/linear/store.js';
import { ticketTitle } from '../src/linear/title.js';
import { valueDigestHex } from '../src/token/files.js';
import { testDeps } from './helpers.js';
import { linearAnswer, type LinearAnswer } from './linearFetchFake.js';
import { linearDeps, linearServicesFake } from './linearServicesFake.js';
import { removeTmpFixturesEachTest } from './tmpHelpers.js';

removeTmpFixturesEachTest();

const ID = 'project-a-quiet-basin';
const LEGACY_KEY = 'lin_api_fixture_titles_legacy_01';
const T0 = 1_800_000_000_000;

const issueOk = (identifier = 'AAA-12', title = 'Fix the login flow'): LinearAnswer =>
  linearAnswer({ ok: true, status: 200, json: async () => ({ data: { issue: { identifier, title } } }) });
const refused = (status: number): LinearAnswer => linearAnswer({ ok: false, status, json: async () => ({}) });

interface Rig {
  app: FastifyInstance;
  dir: string;
  /** The authorization header of every call Linear was sent, in order. */
  auth: string[];
  answer: (a: LinearAnswer) => void;
}

let open: FastifyInstance | null = null;
afterEach(async () => { await open?.close(); open = null; });

async function boot(o: { legacyKey?: string | null } = {}): Promise<Rig> {
  const deps = testDeps(undefined, async () => ({ ran: true, code: 0, stdout: '', stderr: '' }));
  const dir = deps.cfg.ccrcDir;
  mkdirSync(dir, { recursive: true });
  const legacy = o.legacyKey === undefined ? LEGACY_KEY : o.legacyKey;
  if (legacy !== null) writeFileSync(path.join(dir, LINEAR_KEY_FILE), `${legacy}\n`, { mode: 0o600 });
  mkdirSync(deps.cfg.registryDir, { recursive: true });
  writeFileSync(path.join(deps.cfg.registryDir, `${ID}.uuid`), 'a'.repeat(36));
  const auth: string[] = [];
  let next: LinearAnswer = issueOk();
  const f: FetchLike = async (_u, init) => { auth.push(init.headers['authorization'] ?? ''); return next; };
  const app = await buildServer({
    ...deps,
    fleetState: { connected: true, downSince: null, ccdVerbs: ['ws-add', WS_TITLE_CAP, WS_WRAPPER_CAP, WS_TITLE_VERB], rosterFp: null, build: null },
    linear: { fetch: f },
    ...linearDeps(linearServicesFake({ clock: () => T0 })),
  });
  open = app;
  return { app, dir, auth, answer: (a) => { next = a; } };
}

const body = (res: LightMyRequestResponse): Record<string, unknown> => JSON.parse(res.body) as Record<string, unknown>;
const preview = (r: Rig, ref = 'AAA-12'): Promise<LightMyRequestResponse> =>
  r.app.inject({ method: 'GET', url: `/api/linear/resolve?ref=${encodeURIComponent(ref)}` });
const create = (r: Rig, name = 'AAA-12'): Promise<LightMyRequestResponse> =>
  r.app.inject({ method: 'POST', url: '/api/projects/project-a/workspaces', payload: { name } });
const rename = (r: Rig, title = 'AAA-12'): Promise<LightMyRequestResponse> =>
  r.app.inject({ method: 'POST', url: `/api/sessions/${ID}/title`, payload: { title } });

/** The title each of the three callers gives for `ref`, in order: the preview, the create, the rename. */
const titlesOf = async (r: Rig, ref = 'AAA-12'): Promise<unknown[]> => [
  body(await preview(r, ref))['title'], body(await create(r, ref))['title'], body(await rename(r, ref))['title'],
];

const detailsOf = (dir: string): ReturnType<typeof parseLinearDetails> =>
  parseLinearDetails(readFileSync(path.join(dir, LINEAR_DETAILS_FILE), 'utf8'));
const writeDetails = (dir: string, key: string, outcome: 'ok' | 'rejected'): void => writeFileSync(
  path.join(dir, LINEAR_DETAILS_FILE),
  `${JSON.stringify({ v: 1, org: 'Workspace A', user: 'user-a', keyTail: keyTailOf(key), keyDigest: valueDigestHex(key), checkedAt: T0, outcome })}\n`,
);

describe('characterization: a box with only linear.key (green before titles moved to the slots)', () => {
  it('the preview, the create and the rename all give Linear\'s title, asked with the legacy key', async () => {
    const r = await boot();
    const want = ticketTitle('AAA-12', 'Fix the login flow');
    expect(body(await preview(r))).toMatchObject({ kind: 'named', title: want, source: 'linear' });
    expect(await titlesOf(r)).toEqual([want, want, want]);
    expect(r.auth).toEqual(Array(4).fill(LEGACY_KEY));
  });

  it('a Linear 401 gives the offline title and marks the legacy pair rejected; a success clears that verdict', async () => {
    const r = await boot();
    writeDetails(r.dir, LEGACY_KEY, 'ok');
    r.answer(refused(401));
    expect(body(await preview(r))).toMatchObject({ title: 'AAA-12', source: 'offline', reason: 'unauthorised' });
    expect(detailsOf(r.dir)).toMatchObject({ keyDigest: valueDigestHex(LEGACY_KEY), outcome: 'rejected' });
    r.answer(issueOk());
    expect(body(await preview(r))).toMatchObject({ source: 'linear' });
    expect(detailsOf(r.dir)).toMatchObject({ keyDigest: valueDigestHex(LEGACY_KEY), outcome: 'ok' });
  });

  it('a 403 gives the offline title and leaves the pair\'s verdict alone', async () => {
    const r = await boot();
    writeDetails(r.dir, LEGACY_KEY, 'ok');
    const before = readFileSync(path.join(r.dir, LINEAR_DETAILS_FILE), 'utf8');
    r.answer(refused(403));
    expect(body(await preview(r))).toMatchObject({ title: 'AAA-12', source: 'offline', reason: 'forbidden' });
    expect(readFileSync(path.join(r.dir, LINEAR_DETAILS_FILE), 'utf8')).toBe(before);
  });

  it('a box with no key gives every caller the offline title, not-configured, and asks Linear nothing', async () => {
    const r = await boot({ legacyKey: null });
    expect(body(await preview(r))).toMatchObject({ title: 'AAA-12', source: 'offline', reason: 'not-configured' });
    expect(await titlesOf(r)).toEqual(['AAA-12', 'AAA-12', 'AAA-12']);
    expect(r.auth).toEqual([]);
  });

  it('a plain name is never looked up', async () => {
    const r = await boot();
    expect(body(await preview(r, 'login-cleanup'))).toMatchObject({ source: 'offline' });
    expect(r.auth).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Row 21 (spec §6.10): titles route through the slots. The store is read, the ticket's prefix routed against the
// recorded teams (no refresh on a miss), the routed slot's key read and its verdicts aimed at it; the legacy key is
// the fallback only while its workspace is not yet learned.
// ---------------------------------------------------------------------------

const WS_A = 'aaaaaaaa-0000-4000-8000-000000000001';
const WS_B = 'bbbbbbbb-0000-4000-8000-000000000002';
const SLOT_KEY_A = 'lin_api_fixture_titles_slot_a_01';
const SLOT_KEY_A2 = 'lin_api_fixture_titles_slot_a_02';
const SLOT_KEY_B = 'lin_api_fixture_titles_slot_b_01';
const TEAM_AAA: LinearTeam = { id: 'aaaaaaaa-1111-4000-8000-000000000001', key: 'AAA', name: 'Team A' };
const TEAM_BBB: LinearTeam = { id: 'bbbbbbbb-1111-4000-8000-000000000002', key: 'BBB', name: 'Team B' };

interface SlotRig extends Rig { fx: ReturnType<typeof linearServicesFake> }
async function bootSlots(o: { legacyKey?: string | null } = {}): Promise<SlotRig> {
  const deps = testDeps(undefined, async () => ({ ran: true, code: 0, stdout: '', stderr: '' }));
  const dir = deps.cfg.ccrcDir;
  mkdirSync(dir, { recursive: true });
  const legacy = o.legacyKey === undefined ? null : o.legacyKey;
  if (legacy !== null) writeFileSync(path.join(dir, LINEAR_KEY_FILE), `${legacy}\n`, { mode: 0o600 });
  mkdirSync(deps.cfg.registryDir, { recursive: true });
  writeFileSync(path.join(deps.cfg.registryDir, `${ID}.uuid`), 'a'.repeat(36));
  const auth: string[] = [];
  let next: LinearAnswer = issueOk();
  const f: FetchLike = async (_u, init) => { auth.push(init.headers['authorization'] ?? ''); return next; };
  const fx = linearServicesFake({ clock: () => T0, ccrcDir: dir });
  const app = await buildServer({
    ...deps,
    fleetState: { connected: true, downSince: null, ccdVerbs: ['ws-add', WS_TITLE_CAP, WS_WRAPPER_CAP, WS_TITLE_VERB], rosterFp: null, build: null },
    linear: { fetch: f },
    ...linearDeps(fx),
  });
  open = app;
  return { app, dir, auth, fx, answer: (a) => { next = a; } };
}
const slotRec = (id: string, key: string, teams: LinearTeam[], over: Partial<LinearStoreRecord> = {}): LinearStoreRecord => ({
  workspaceId: id, name: 'Workspace', urlKey: id === WS_A ? 'ws-a' : 'ws-b', user: 'user-a', teams, teamsAt: T0,
  keyTail: keyTailOf(key), keyDigest: valueDigestHex(key), checkedAt: T0, outcome: 'ok', ...over,
});
const putSlot = (r: Rig, id: string, key: string, teams: LinearTeam[], over: Partial<LinearStoreRecord> = {}): Promise<unknown> =>
  putLinearSlot(r.dir, key, slotRec(id, key, teams, over), { replace: true });
const slotRecordOf = async (r: Rig, id: string): Promise<LinearStoreRecord | null> => {
  const s = await readLinearStore(r.dir);
  const slot = s.kind === 'listed' ? s.slots.find((x) => x.id === id) : undefined;
  return slot?.record.kind === 'details' ? slot.record.details : null;
};
/** The legacy pair's bytes and mtimes. */
const pairState = (dir: string): string[] => [LINEAR_KEY_FILE, LINEAR_DETAILS_FILE].flatMap((f) => {
  const p = path.join(dir, f);
  return existsSync(p) ? [f, readFileSync(p, 'utf8'), String(statSync(p).mtimeMs)] : [f, 'absent'];
});
const want = ticketTitle('AAA-12', 'Fix the login flow');

describe('titles route through the slots (row 21)', () => {
  it('a box with only slots and no linear.key: every caller gives Linear\'s title, asked with the routed slot\'s key', async () => {
    const r = await bootSlots();
    await putSlot(r, WS_A, SLOT_KEY_A, [TEAM_AAA]);
    await putSlot(r, WS_B, SLOT_KEY_B, [TEAM_BBB]);
    expect(await titlesOf(r)).toEqual([want, want, want]);
    expect(r.auth).toEqual([SLOT_KEY_A, SLOT_KEY_A, SLOT_KEY_A]);
    r.answer(issueOk('BBB-7', 'Tidy the docs'));
    expect(body(await preview(r, 'bbb-7'))).toMatchObject({ title: ticketTitle('BBB-7', 'Tidy the docs'), source: 'linear' });
    expect(r.auth.at(-1)).toBe(SLOT_KEY_B);
  });

  it('a replaced slot key is used by the next title; a removed slot gives the offline title, not-configured', async () => {
    const r = await bootSlots();
    await putSlot(r, WS_A, SLOT_KEY_A, [TEAM_AAA]);
    await preview(r);
    await putSlot(r, WS_A, SLOT_KEY_A2, [TEAM_AAA]);
    expect(body(await preview(r))).toMatchObject({ source: 'linear' });
    expect(r.auth).toEqual([SLOT_KEY_A, SLOT_KEY_A2]);
    await removeLinearSlot(r.dir, WS_A);
    expect(body(await preview(r))).toMatchObject({ title: 'AAA-12', source: 'offline', reason: 'not-configured' });
    expect(r.auth).toHaveLength(2);
  });

  it('a 401 marks the routed slot rejected and a success clears that slot\'s verdict; the legacy pair is never touched', async () => {
    const r = await bootSlots({ legacyKey: LEGACY_KEY });
    writeDetails(r.dir, LEGACY_KEY, 'ok');
    await putSlot(r, WS_A, SLOT_KEY_A, [TEAM_AAA]);
    await putSlot(r, WS_B, SLOT_KEY_B, [TEAM_BBB]);
    const before = pairState(r.dir);
    r.answer(refused(401));
    expect(body(await preview(r))).toMatchObject({ source: 'offline', reason: 'unauthorised' });
    expect(await slotRecordOf(r, WS_A)).toMatchObject({ outcome: 'rejected', keyDigest: valueDigestHex(SLOT_KEY_A) });
    expect(await slotRecordOf(r, WS_B)).toMatchObject({ outcome: 'ok' });
    r.answer(issueOk());
    expect(body(await preview(r))).toMatchObject({ source: 'linear' });
    expect(await slotRecordOf(r, WS_A)).toMatchObject({ outcome: 'ok', teams: [TEAM_AAA] });
    expect(pairState(r.dir)).toEqual(before);
    expect(r.auth).toEqual([SLOT_KEY_A, SLOT_KEY_A]);
  });

  it('a legacy key whose workspace is not yet learned still gives titles, as on main, for a prefix no slot holds', async () => {
    const r = await bootSlots({ legacyKey: LEGACY_KEY });
    await putSlot(r, WS_B, SLOT_KEY_B, [TEAM_BBB]);
    expect(body(await preview(r))).toMatchObject({ title: want, source: 'linear' });
    expect(r.auth).toEqual([LEGACY_KEY]);
  });

  it('once the legacy key\'s workspace is learned it routes by its teams, and is no fallback for a team it lacks', async () => {
    const r = await bootSlots({ legacyKey: LEGACY_KEY });
    await writeLegacyTeams(r.dir, valueDigestHex(LEGACY_KEY), { workspaceId: WS_B, name: 'Workspace B', urlKey: 'ws-b', teams: [TEAM_BBB], teamsAt: T0 });
    r.answer(issueOk('BBB-7', 'Tidy the docs'));
    expect(body(await preview(r, 'BBB-7'))).toMatchObject({ source: 'linear' });
    expect(r.auth).toEqual([LEGACY_KEY]);
    expect(body(await preview(r, 'AAA-12'))).toMatchObject({ title: 'AAA-12', source: 'offline', reason: 'not-configured' });
    expect(r.auth).toHaveLength(1);
  });

  it('a file slot for the legacy key\'s workspace wins: its key is used, never the legacy one', async () => {
    const r = await bootSlots({ legacyKey: LEGACY_KEY });
    await writeLegacyTeams(r.dir, valueDigestHex(LEGACY_KEY), { workspaceId: WS_A, name: 'Workspace A', urlKey: 'ws-a', teams: [TEAM_AAA], teamsAt: T0 });
    await putSlot(r, WS_A, SLOT_KEY_A, [TEAM_AAA]);
    expect(body(await preview(r))).toMatchObject({ source: 'linear' });
    expect(r.auth).toEqual([SLOT_KEY_A]);
  });

  it('a team two slots hold is no title to guess: the offline title, not-configured, and no call', async () => {
    const r = await bootSlots({ legacyKey: LEGACY_KEY });
    await putSlot(r, WS_A, SLOT_KEY_A, [TEAM_AAA]);
    await putSlot(r, WS_B, SLOT_KEY_B, [TEAM_AAA]);
    await writeLegacyTeams(r.dir, valueDigestHex(LEGACY_KEY), { workspaceId: 'cccccccc-0000-4000-8000-000000000003', name: 'Workspace C', urlKey: 'ws-c', teams: [TEAM_BBB], teamsAt: T0 });
    expect(body(await preview(r))).toMatchObject({ title: 'AAA-12', source: 'offline', reason: 'not-configured' });
    expect(r.auth).toEqual([]);
  });

  it('a miss never refreshes: the lookup makes no call for teams and queues nothing', async () => {
    const r = await bootSlots();
    await putSlot(r, WS_B, SLOT_KEY_B, [TEAM_BBB], { teamsAt: null, teams: [] });
    expect(body(await preview(r))).toMatchObject({ source: 'offline', reason: 'not-configured' });
    await r.fx.refresher.idle();
    expect(r.auth).toEqual([]);
  });

  it('a refused rate-service ask gives the offline title, through all three callers, with no call', async () => {
    const r = await bootSlots();
    await putSlot(r, WS_A, SLOT_KEY_A, [TEAM_AAA]);
    const SLOT_A: LinearSlotRef = { source: 'file', id: WS_A };
    while (r.fx.rate.take({ lane: 'request', slot: SLOT_A, calls: 1 }).ok) { /* spend the slot's request lane */ }
    expect(body(await preview(r))).toMatchObject({ title: 'AAA-12', source: 'offline', reason: 'rate-limited' });
    expect(await titlesOf(r)).toEqual(['AAA-12', 'AAA-12', 'AAA-12']);
    expect(r.auth).toEqual([]);
    // The legacy slot's lane is its own: a slot's spent lane does not reach it.
    expect(r.fx.rate.take({ lane: 'request', slot: { source: 'legacy' }, calls: 1 }).ok).toBe(true);
  });

  it('a routed slot whose key cannot be used asks nothing and spends nothing', async () => {
    const r = await bootSlots();
    await putSlot(r, WS_A, SLOT_KEY_A, [TEAM_AAA]);
    writeFileSync(path.join(r.dir, LINEAR_STORE_DIR, `${WS_A}.key`), '# nothing\n');
    expect(body(await preview(r))).toMatchObject({ title: 'AAA-12', source: 'offline', reason: 'not-configured' });
    expect(r.auth).toEqual([]);
    const SLOT_A: LinearSlotRef = { source: 'file', id: WS_A };
    expect(r.fx.rate.take({ lane: 'request', slot: SLOT_A, calls: 25 }).ok).toBe(true);
  });
});

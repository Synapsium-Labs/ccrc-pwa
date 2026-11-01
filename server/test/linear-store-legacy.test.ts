// The legacy Linear pair as the slot store reads it (#1444, spec 2026-10-31 §3.4; the store-level half of its row 2).
// There is no migration: `linear.key` and its v1 `linear.json` stay exactly as on `main`, read-only to the store,
// which answers them as one more slot. What the legacy key's Check again learns beyond the v1 record lives in
// `linear/legacy-teams.json`, honoured only while its digest is the present `linear.key`'s. Row 2's halves over the
// refresher, titles, the proxy and the Settings routes join this file with the stages that build them.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { chmodSync, existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { promises as fsp } from 'node:fs';
import path from 'node:path';
import type { LinearDetails, LinearStoreRecord, LinearTeam } from '../../shared/linear.js';
import { valueDigestHex } from '../src/token/files.js';
import {
  LINEAR_DETAILS_FILE, LINEAR_KEY_FILE, keyTailOf, parseLinearDetails, readLinearDetails, readLinearKey,
  withConnectionLock, writeLinearConnection,
} from '../src/linear/connection.js';
import { linearConnectionView } from '../src/linear/view.js';
import {
  LEGACY_SLOT, LEGACY_TEAMS_FILE, LINEAR_STORE_DIR, clearLinearSlotVerdict, markLinearSlotRejected, parseLegacyTeams,
  putLinearSlot, readLinearSlotKey, readLinearStore, recordLinearSlotCheck, removeLinearSlot, writeLegacyTeams,
  type LegacyTeams, type LinearLegacySlot, type LinearStoreRead,
} from '../src/linear/store.js';
import { mkTmp, removeTmpFixturesEachTest } from './tmpHelpers.js';
import type { FastifyInstance } from 'fastify';
import type { FetchLike } from '../src/linear/client.js';
import { buildServer } from '../src/server.js';
import { testDeps } from './helpers.js';
import { linearAnswer, type LinearAnswer } from './linearFetchFake.js';
import { linearDeps, linearServicesFake } from './linearServicesFake.js';

removeTmpFixturesEachTest();
afterEach(() => { vi.restoreAllMocks(); });

const LEGACY_KEY = 'lin_api_fixture_legacy_0001';
const LEGACY_KEY2 = 'lin_api_fixture_legacy_0002';
const SLOT_KEY = 'lin_api_fixture_slot_a_0003';
const WS_A = 'aaaaaaaa-0000-4000-8000-000000000001';
const WS_B = 'bbbbbbbb-0000-4000-8000-000000000002';
const TEAM_A: LinearTeam = { id: 'aaaaaaaa-1111-4000-8000-000000000001', key: 'AAA', name: 'Team A' };
const NOW = 1_800_000_000_000;

const ccrc = (): string => {
  const dir = path.join(mkTmp('ccrc-linear-legacy-'), '.ccrc');
  mkdirSync(dir, { recursive: true });
  return dir;
};
const details = (key: string, over: Partial<LinearDetails> = {}): LinearDetails => ({
  org: 'Workspace A', user: 'user-a', keyTail: keyTailOf(key), keyDigest: valueDigestHex(key), checkedAt: NOW, outcome: 'ok', ...over,
});
const connect = (dir: string, key = LEGACY_KEY): Promise<void> =>
  withConnectionLock(dir, () => writeLinearConnection(dir, key, details(key)));
const learned = (over: Partial<Omit<LegacyTeams, 'keyDigest'>> = {}): Omit<LegacyTeams, 'keyDigest'> => ({
  workspaceId: WS_A, name: 'Workspace A', urlKey: 'ws-a', teams: [TEAM_A], teamsAt: NOW, ...over,
});
const slotRec = (id: string, key: string): LinearStoreRecord => ({
  workspaceId: id, name: 'Workspace A', urlKey: 'ws-a', user: 'user-a', teams: [TEAM_A], teamsAt: NOW,
  keyTail: keyTailOf(key), keyDigest: valueDigestHex(key), checkedAt: NOW, outcome: 'ok',
});
const teamsPath = (dir: string): string => path.join(dir, LINEAR_STORE_DIR, LEGACY_TEAMS_FILE);
const legacyOf = (r: LinearStoreRead): LinearLegacySlot | null => {
  if (r.kind !== 'listed') throw new Error(`not listed: ${JSON.stringify(r)}`);
  return r.legacy;
};

/** The pair's bytes and mtimes, which nothing in the store may change. */
const pairState = (dir: string): string[] => [LINEAR_KEY_FILE, LINEAR_DETAILS_FILE].flatMap((f) => {
  const p = path.join(dir, f);
  return existsSync(p) ? [f, readFileSync(p, 'utf8'), String(statSync(p).mtimeMs)] : [f, 'absent'];
});

describe('the adapter reads the pair as one more slot', () => {
  it('a box with only the pair lists no file slot and the legacy slot with today\'s view', async () => {
    const dir = ccrc();
    await connect(dir);
    const r = await readLinearStore(dir);
    const view = linearConnectionView({ kind: 'key', digest: valueDigestHex(LEGACY_KEY) }, await readLinearDetails(dir));
    expect(r).toEqual({
      kind: 'listed', slots: [],
      legacy: {
        source: 'legacy', key: { kind: 'key', digest: valueDigestHex(LEGACY_KEY) },
        details: { kind: 'details', details: details(LEGACY_KEY) }, view,
        teamsFile: 'absent', workspace: null, superseded: false,
      },
    });
    expect(view.state).toBe('connected');
    expect(JSON.stringify(r)).not.toContain(LEGACY_KEY);
  });

  it('the legacy slot is there for every key condition but absent; with no linear.key it is null', async () => {
    const dir = ccrc();
    expect(legacyOf(await readLinearStore(dir))).toBeNull();
    // A half-finished Disconnect: the record with no key describes nothing that is stored.
    writeFileSync(path.join(dir, LINEAR_DETAILS_FILE), `${JSON.stringify({ v: 1, ...details(LEGACY_KEY) })}\n`);
    expect(legacyOf(await readLinearStore(dir))).toBeNull();
    writeFileSync(path.join(dir, LINEAR_KEY_FILE), '# nothing\n');
    expect(legacyOf(await readLinearStore(dir))).toMatchObject({ key: { kind: 'unusable' }, view: { state: 'unusable' } });
  });

  it('readLinearSlotKey on the legacy slot is readLinearKey, read on every use', async () => {
    const dir = ccrc();
    expect(await readLinearSlotKey(dir, LEGACY_SLOT)).toEqual({ kind: 'absent' });
    await connect(dir);
    expect(await readLinearSlotKey(dir, LEGACY_SLOT)).toEqual(await readLinearKey(dir));
    expect(await readLinearSlotKey(dir, LEGACY_SLOT)).toEqual({ kind: 'key', key: LEGACY_KEY });
    await connect(dir, LEGACY_KEY2);
    expect(await readLinearSlotKey(dir, LEGACY_SLOT)).toEqual({ kind: 'key', key: LEGACY_KEY2 });
  });
});

describe('the pair is read-only to the store', () => {
  it('no store act writes, removes or copies linear.key or linear.json', async () => {
    const dir = ccrc();
    await connect(dir);
    const before = pairState(dir);
    const d = valueDigestHex(LEGACY_KEY);
    await writeLegacyTeams(dir, d, learned());
    expect(await putLinearSlot(dir, SLOT_KEY, slotRec(WS_A, SLOT_KEY), { replace: false })).toBe('added');
    expect(await putLinearSlot(dir, SLOT_KEY, slotRec(WS_A, SLOT_KEY), { replace: true })).toBe('replaced');
    await recordLinearSlotCheck(dir, WS_A, valueDigestHex(SLOT_KEY), 'unreachable', null, NOW + 1);
    // The legacy key's own digest offered to a slot act: still never the pair's file.
    await markLinearSlotRejected(dir, WS_A, d, NOW + 2);
    await markLinearSlotRejected(dir, WS_A, valueDigestHex(SLOT_KEY), NOW + 2);
    await clearLinearSlotVerdict(dir, WS_A, valueDigestHex(SLOT_KEY), NOW + 3);
    await readLinearStore(dir);
    await readLinearSlotKey(dir, LEGACY_SLOT);
    await removeLinearSlot(dir, WS_A);
    await removeLinearSlot(dir, WS_B);
    expect(pairState(dir)).toEqual(before);
    // Nothing under linear/ holds the legacy key.
    for (const f of readdirSync(path.join(dir, LINEAR_STORE_DIR))) {
      expect(readFileSync(path.join(dir, LINEAR_STORE_DIR, f), 'utf8'), f).not.toContain(LEGACY_KEY);
    }
    // An older build's reader still reads the pair this build leaves, as it did.
    expect(parseLinearDetails(readFileSync(path.join(dir, LINEAR_DETAILS_FILE), 'utf8'))).toEqual(details(LEGACY_KEY));
    expect(await readLinearKey(dir)).toEqual({ kind: 'key', key: LEGACY_KEY });
  });

  it('a file slot holding the legacy key\'s digest leaves linear.key where it is', async () => {
    const dir = ccrc();
    await connect(dir);
    const before = pairState(dir);
    await putLinearSlot(dir, LEGACY_KEY, slotRec(WS_A, LEGACY_KEY), { replace: false });
    await removeLinearSlot(dir, WS_A);
    expect(pairState(dir)).toEqual(before);
  });
});

describe('legacy-teams.json: what the legacy key\'s Check again learned', () => {
  it('is written under linear/ at 0600 in a 0700 directory, only while linear.key has the checked digest', async () => {
    const dir = ccrc();
    await connect(dir);
    expect(await writeLegacyTeams(dir, valueDigestHex(LEGACY_KEY2), learned())).toBe(false);
    expect(existsSync(teamsPath(dir))).toBe(false);
    expect(await writeLegacyTeams(dir, valueDigestHex(LEGACY_KEY), learned())).toBe(true);
    expect(statSync(path.join(dir, LINEAR_STORE_DIR)).mode & 0o777).toBe(0o700);
    expect(statSync(teamsPath(dir)).mode & 0o777).toBe(0o600);
    expect(readFileSync(teamsPath(dir), 'utf8')).toBe(
      `{"v":1,"keyDigest":"${valueDigestHex(LEGACY_KEY)}","workspaceId":"${WS_A}","name":"Workspace A","urlKey":"ws-a",`
      + `"teams":[{"id":"${TEAM_A.id}","key":"AAA","name":"Team A"}],"teamsAt":${NOW}}\n`,
    );
    expect(readFileSync(teamsPath(dir), 'utf8')).not.toContain(LEGACY_KEY);
  });

  it('with no linear.key nothing is written', async () => {
    const dir = ccrc();
    expect(await writeLegacyTeams(dir, valueDigestHex(LEGACY_KEY), learned())).toBe(false);
    expect(existsSync(teamsPath(dir))).toBe(false);
  });

  it('is honoured only while its digest matches linear.key\'s: a replace through the pair\'s route leaves it ignored', async () => {
    const dir = ccrc();
    await connect(dir);
    await writeLegacyTeams(dir, valueDigestHex(LEGACY_KEY), learned());
    expect(legacyOf(await readLinearStore(dir))).toMatchObject({
      teamsFile: 'matched', workspace: { keyDigest: valueDigestHex(LEGACY_KEY), ...learned() }, superseded: false,
    });
    // `PUT /api/linear/connection` replaces the pair; the file now describes the old key.
    await connect(dir, LEGACY_KEY2);
    expect(legacyOf(await readLinearStore(dir))).toMatchObject({ teamsFile: 'stale', workspace: null, superseded: false });
    // The next Check again overwrites it.
    expect(await writeLegacyTeams(dir, valueDigestHex(LEGACY_KEY2), learned({ name: 'Workspace A2' }))).toBe(true);
    expect(legacyOf(await readLinearStore(dir))).toMatchObject({ teamsFile: 'matched', workspace: { name: 'Workspace A2' } });
  });

  it('a malformed or unreadable file is ignored as if absent, and says which', async () => {
    const dir = ccrc();
    await connect(dir);
    await writeLegacyTeams(dir, valueDigestHex(LEGACY_KEY), learned());
    writeFileSync(teamsPath(dir), '{"v":1}\n');
    expect(legacyOf(await readLinearStore(dir))).toMatchObject({ teamsFile: 'malformed', workspace: null });
    if (process.getuid?.() !== 0) {
      chmodSync(teamsPath(dir), 0o000);
      expect(legacyOf(await readLinearStore(dir))).toMatchObject({ teamsFile: 'unreadable', workspace: null });
      chmodSync(teamsPath(dir), 0o600);
    }
  });

  it('is never listed as a slot, and no sweep deletes it', async () => {
    const dir = ccrc();
    await connect(dir);
    await writeLegacyTeams(dir, valueDigestHex(LEGACY_KEY), learned());
    await putLinearSlot(dir, SLOT_KEY, slotRec(WS_B, SLOT_KEY), { replace: false });
    await removeLinearSlot(dir, WS_B);
    const r = await readLinearStore(dir);
    expect(r).toMatchObject({ kind: 'listed', slots: [] });
    expect(existsSync(teamsPath(dir))).toBe(true);
  });

  it('parseLegacyTeams reads exactly its shape', () => {
    const good = { v: 1, keyDigest: valueDigestHex(LEGACY_KEY), ...learned() };
    expect(parseLegacyTeams(JSON.stringify(good))).toEqual({ keyDigest: good.keyDigest, ...learned() });
    const bad: Array<Record<string, unknown>> = [
      { ...good, v: 2 }, { ...good, extra: 1 }, { ...good, name: null }, { ...good, urlKey: 'WS' },
      { ...good, workspaceId: 'x' }, { ...good, teamsAt: null }, { ...good, keyDigest: 'x' },
      { ...good, teams: [{ ...TEAM_A, key: '1' }] }, { ...good, teams: [{ ...TEAM_A, extra: 1 }] },
    ];
    for (const o of bad) expect(parseLegacyTeams(JSON.stringify(o)), JSON.stringify(o)).toBeNull();
    for (const field of Object.keys(good)) {
      const o: Record<string, unknown> = { ...good };
      delete o[field];
      expect(parseLegacyTeams(JSON.stringify(o)), field).toBeNull();
    }
    expect(parseLegacyTeams('nope')).toBeNull();
  });
});

describe('a file slot for the legacy key\'s workspace wins', () => {
  it('the legacy slot is listed superseded while a file slot holds its workspace, and not after it is removed', async () => {
    const dir = ccrc();
    await connect(dir);
    await writeLegacyTeams(dir, valueDigestHex(LEGACY_KEY), learned());
    await putLinearSlot(dir, SLOT_KEY, slotRec(WS_A, SLOT_KEY), { replace: false });
    const r = await readLinearStore(dir);
    expect(r).toMatchObject({ kind: 'listed', slots: [{ id: WS_A }] });
    expect(legacyOf(r)).toMatchObject({ teamsFile: 'matched', workspace: { workspaceId: WS_A }, superseded: true });
    await removeLinearSlot(dir, WS_A);
    expect(legacyOf(await readLinearStore(dir))).toMatchObject({ workspace: { workspaceId: WS_A }, superseded: false });
  });

  it('a file slot for another workspace does not supersede it, and an unlearned legacy slot is never superseded', async () => {
    const dir = ccrc();
    await connect(dir);
    await putLinearSlot(dir, SLOT_KEY, slotRec(WS_A, SLOT_KEY), { replace: false });
    expect(legacyOf(await readLinearStore(dir))).toMatchObject({ workspace: null, superseded: false });
    await writeLegacyTeams(dir, valueDigestHex(LEGACY_KEY), learned({ workspaceId: WS_B, urlKey: 'ws-b' }));
    expect(legacyOf(await readLinearStore(dir))).toMatchObject({ workspace: { workspaceId: WS_B }, superseded: false });
  });
});

describe('legacy-teams.json is written under the one lock', () => {
  it('waits for a held connection lock', async () => {
    const dir = ccrc();
    await connect(dir);
    let release!: () => void;
    const held = withConnectionLock(dir, () => new Promise<void>((r) => { release = r; }));
    const write = writeLegacyTeams(dir, valueDigestHex(LEGACY_KEY), learned());
    await new Promise((r) => setTimeout(r, 20));
    expect(existsSync(teamsPath(dir))).toBe(false);
    release();
    await held;
    expect(await write).toBe(true);
  });

  it('a crash in its write leaves no temp file and the pair untouched', async () => {
    const dir = ccrc();
    await connect(dir);
    const before = pairState(dir);
    const rename = fsp.rename.bind(fsp);
    vi.spyOn(fsp, 'rename').mockImplementation(async (from, to) => {
      if (path.basename(String(to)) === LEGACY_TEAMS_FILE) throw Object.assign(new Error('EIO'), { code: 'EIO' });
      return rename(from, to);
    });
    await expect(writeLegacyTeams(dir, valueDigestHex(LEGACY_KEY), learned())).rejects.toThrow();
    vi.restoreAllMocks();
    expect(readdirSync(path.join(dir, LINEAR_STORE_DIR))).toEqual([]);
    expect(pairState(dir)).toEqual(before);
  });
});

// ---------------------------------------------------------------------------
// CHARACTERIZATION of the legacy Check again (`POST /api/linear/connection/check`), green on the code before its query
// became the §4.1 key check (plan task LK3): its answer is today's view of the pair, it writes the v1 record by the
// digest rule, and nothing else. It never changes after it lands. Driven through `buildServer` with the services
// handed in `Deps`, as `index.ts` hands them; the route stamps the wall clock, so `checkedAt` is any number.
// ---------------------------------------------------------------------------

interface CheckRig {
  app: FastifyInstance;
  dir: string;
  calls: number;
  answer: (a: LinearAnswer | (() => Promise<LinearAnswer>)) => void;
}
let openApp: FastifyInstance | null = null;
afterEach(async () => { await openApp?.close(); openApp = null; });

async function checkRig(): Promise<CheckRig> {
  const deps = testDeps();
  const dir = deps.cfg.ccrcDir;
  mkdirSync(dir, { recursive: true });
  let next: LinearAnswer | (() => Promise<LinearAnswer>) = viewerOk();
  const rig = { calls: 0 } as CheckRig;
  const f: FetchLike = async () => { rig.calls += 1; return typeof next === 'function' ? next() : next; };
  const app = await buildServer({ ...deps, linear: { fetch: f }, ...linearDeps(linearServicesFake({ clock: () => NOW })) });
  openApp = app;
  return Object.assign(rig, { app, dir, answer: (a: typeof next) => { next = a; } });
}
const viewerOk = (org = 'Workspace A', user = 'user-a'): LinearAnswer =>
  linearAnswer({ ok: true, status: 200, json: async () => ({ data: { viewer: { name: user }, organization: { name: org } } }) });
const checkAgain = async (r: CheckRig): Promise<{ status: number; body: unknown }> => {
  const res = await r.app.inject({ method: 'POST', url: '/api/linear/connection/check' });
  return { status: res.statusCode, body: JSON.parse(res.body) as unknown };
};
const v1Of = (dir: string): LinearDetails | null => parseLinearDetails(readFileSync(path.join(dir, LINEAR_DETAILS_FILE), 'utf8'));

describe('characterization: the legacy Check again', () => {
  it('answers today\'s view and writes the v1 record of the key it checked', async () => {
    const r = await checkRig();
    await connect(r.dir);
    r.answer(viewerOk('Workspace A2', 'user-a2'));
    const got = await checkAgain(r);
    expect(got.status).toBe(200);
    expect(got.body).toEqual({
      ok: true, connection: { state: 'connected', outcome: 'ok', org: 'Workspace A2', user: 'user-a2', keyTail: keyTailOf(LEGACY_KEY), checkedAt: expect.any(Number) },
    });
    expect(v1Of(r.dir)).toEqual(details(LEGACY_KEY, { org: 'Workspace A2', user: 'user-a2', checkedAt: expect.any(Number) as number }));
    expect(r.calls).toBe(1);
  });

  it('a 401 records rejected and keeps the names the record had for this key', async () => {
    const r = await checkRig();
    await connect(r.dir);
    r.answer(linearAnswer({ ok: false, status: 401, json: async () => ({}) }));
    expect((await checkAgain(r)).body).toMatchObject({ ok: true, connection: { state: 'key-rejected', org: 'Workspace A' } });
    expect(v1Of(r.dir)).toEqual(details(LEGACY_KEY, { outcome: 'rejected', checkedAt: expect.any(Number) as number }));
  });

  it('a key replaced while Linear is asked wins: the check records nothing over it', async () => {
    const r = await checkRig();
    await connect(r.dir);
    r.answer(async () => { await connect(r.dir, LEGACY_KEY2); return viewerOk('Workspace X', 'user-x'); });
    expect((await checkAgain(r)).body).toMatchObject({ ok: true, connection: { state: 'connected', org: 'Workspace A', keyTail: keyTailOf(LEGACY_KEY2) } });
    expect(v1Of(r.dir)).toEqual(details(LEGACY_KEY2));
  });

  it('with no key it answers not-connected and asks Linear nothing', async () => {
    const r = await checkRig();
    const got = await checkAgain(r);
    expect(got).toEqual({ status: 409, body: { ok: false, error: 'not-connected', connection: { state: 'not-connected' } } });
    expect(r.calls).toBe(0);
  });
});

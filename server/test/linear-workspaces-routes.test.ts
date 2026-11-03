// The Settings routes for workspace keys (#1444, spec §10.1, §7, §14 row 14; plan task LK11, D-7741): the four
// `/api/linear/workspaces` routes on a bare Fastify instance with the REAL account gate and the real step-up store
// (`linearSettingsRig.ts`), so the credential posture is measured here and not assumed. Add, replace, check and
// remove each take the account gate with `cap: null`, refused while auth is unarmed; add, replace and remove also
// take the step-up, and check does not. Each key act writes its `linear_events` row with the gate's actor. The four
// legacy `/api/linear/connection` routes keep `main`'s posture and answers, which `linear-connection-routes.test.ts`
// holds unchanged; the rows here that name them only prove the new routes did not move them. Nothing reaches the
// network: `fetch` is the injected seam, and every Linear answer is the stand-in's.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { LightMyRequestResponse } from 'fastify';
import { DatabaseSync } from 'node:sqlite';
import { parseLinearStoreRecord } from '../../shared/linear.js';
import { LinearJournal } from '../src/linear/journal.js';
import { readLinearStore } from '../src/linear/store.js';
import { valueDigestHex } from '../src/token/files.js';
import { WS, seedLegacy, seedSlot, statusAnswer, type Responder } from './linearProxyRig.js';
import { RATELIMITED_ERRORS } from './linearFetchFake.js';
import { linearRecord, recordedAnswer, recordedHeader } from './linearRecorded.js';
import { WORKSPACES, bodyOf, settingsRig, type SettingsRig, type SettingsRigOpts } from './linearSettingsRig.js';
import { removeTmpFixturesEachTest } from './tmpHelpers.js';

removeTmpFixturesEachTest();

const NOW = 1_800_000_000_000;
/** A second key for workspace A: the stand-in answers any key it does not know as workspace A's. */
const KEY_A2 = 'lin_api_fixtureAlphaSecondH2j4k6l8z0x2c4v6b8n0m2q4w6e';
const LEAK = 'LINEAR-RESPONSE-TEXT-THAT-MUST-NOT-ECHO';

let open: SettingsRig | null = null;
afterEach(async () => { await open?.fx.refresher.idle(); vi.restoreAllMocks(); await open?.close(); open = null; });

async function rig(o: SettingsRigOpts = {}): Promise<SettingsRig> {
  open = await settingsRig({ clock: () => NOW, timeoutMs: 50, ...o });
  return open;
}

const list = (r: SettingsRig): Promise<LightMyRequestResponse> => r.req('GET', WORKSPACES);
const add = (r: SettingsRig, key: unknown, replace?: unknown): Promise<LightMyRequestResponse> =>
  r.req('POST', WORKSPACES, replace === undefined ? { key } : { key, replace });
const check = (r: SettingsRig, id: string = WS.a.id): Promise<LightMyRequestResponse> => r.req('POST', `${WORKSPACES}/${id}/check`);
const remove = (r: SettingsRig, id: string = WS.a.id): Promise<LightMyRequestResponse> => r.req('DELETE', `${WORKSPACES}/${id}`);
const slotDir = (r: SettingsRig): string => path.join(r.ccrcDir, 'linear');
const keyFile = (r: SettingsRig, id: string = WS.a.id): string => path.join(slotDir(r), `${id}.key`);
const recordFile = (r: SettingsRig, id: string = WS.a.id): string => path.join(slotDir(r), `${id}.json`);
const slotFiles = (r: SettingsRig): string[] => (existsSync(slotDir(r)) ? readdirSync(slotDir(r)).sort() : []);
const errorOf = (res: LightMyRequestResponse): [number, unknown] => [res.statusCode, bodyOf(res)['error']];
const keyChecks = (r: SettingsRig): number => r.calls.filter((c) => c.op === 'KeyCheck').length;
const quiet = (): void => { vi.spyOn(console, 'warn').mockImplementation(() => {}); };

/** What a connected slot for workspace A, added with `key` at NOW, lists as. */
const connectedA = (key: string = WS.a.key): Record<string, unknown> => ({
  id: WS.a.id, name: WS.a.name, urlKey: WS.a.urlKey, user: 'User A', teams: [{ key: 'AAA', name: 'Team A' }],
  keyTail: key.slice(-4), checkedAt: NOW, state: 'connected', outcome: 'ok', org: WS.a.name,
});

describe('GET /api/linear/workspaces: the list (spec §10.1, §10.2)', () => {
  it('a box with nothing stored lists no workspace and no legacy row', async () => {
    const r = await rig();
    const res = await list(r);
    expect(res.statusCode).toBe(200);
    expect(bodyOf(res)).toEqual({ ok: true, store: 'ok', workspaces: [], legacy: null });
  });

  it('a slot lists its workspace, user, teams, key tail and check time with its view state, and never the key or its digest', async () => {
    const r = await rig();
    await seedSlot(r.ccrcDir, 'a');
    const res = await list(r);
    const ws = bodyOf(res)['workspaces'] as Record<string, unknown>[];
    expect(ws).toHaveLength(1);
    expect(ws[0]).toMatchObject({
      id: WS.a.id, name: WS.a.name, urlKey: WS.a.urlKey, user: 'User A', teams: [{ key: 'AAA', name: 'Team A' }],
      keyTail: WS.a.key.slice(-4), state: 'connected', outcome: 'ok',
    });
    expect(Object.keys(ws[0]!).sort()).toEqual(['checkedAt', 'id', 'keyTail', 'name', 'org', 'outcome', 'state', 'teams', 'urlKey', 'user']);
    expect(res.body).not.toContain(WS.a.key.slice(0, 12));
    expect(res.body).not.toContain(valueDigestHex(WS.a.key));
  });

  it('a slot whose record is gone or describes another key lists details unknown, with nothing of the record', async () => {
    const r = await rig();
    await seedSlot(r.ccrcDir, 'a');
    rmSync(recordFile(r));
    expect((bodyOf(await list(r))['workspaces'] as unknown[])[0]).toEqual({
      id: WS.a.id, name: null, urlKey: null, user: null, teams: [], keyTail: null, checkedAt: null, state: 'details-unknown', why: 'absent',
    });
    await seedSlot(r.ccrcDir, 'a');
    writeFileSync(keyFile(r), `${KEY_A2}\n`);
    expect((bodyOf(await list(r))['workspaces'] as unknown[])[0]).toMatchObject({ state: 'details-unknown', why: 'stale', name: null, teams: [] });
  });

  it('the legacy pair is its own row: today\'s view, what its Check again learned, and whether a file slot supersedes it', async () => {
    const r = await rig();
    await seedLegacy(r.ccrcDir, 'a', { learned: false });
    expect(bodyOf(await list(r))['legacy']).toMatchObject({ view: { state: 'connected' }, workspace: null, superseded: false });
    await seedLegacy(r.ccrcDir, 'a', { learned: true });
    expect(bodyOf(await list(r))['legacy']).toMatchObject({
      workspace: { name: WS.a.name, urlKey: WS.a.urlKey, teams: [{ key: 'AAA', name: 'Team A' }] }, superseded: false,
    });
    await seedSlot(r.ccrcDir, 'a');
    expect(bodyOf(await list(r))['legacy']).toMatchObject({ superseded: true });
  });

  it('a store directory that cannot be listed answers store unreadable, and the legacy row still shows', async () => {
    const r = await rig();
    await seedLegacy(r.ccrcDir, 'a', { learned: false });
    writeFileSync(slotDir(r), 'not a directory\n');
    const res = await list(r);
    expect(res.statusCode).toBe(200);
    expect(bodyOf(res)).toMatchObject({ ok: true, store: 'unreadable', workspaces: [], legacy: { view: { state: 'connected' }, workspace: null, superseded: false } });
  });

  it('is a session read: no account gate and no step-up, no service needed, no Linear call, no journal row, no-store', async () => {
    const r = await rig({ enabled: false, absent: ['rate', 'refresher', 'journal'] });
    await seedSlot(r.ccrcDir, 'a');
    const res = await list(r);
    expect(res.statusCode).toBe(200);
    expect(res.headers['cache-control']).toBe('no-store');
    expect(r.calls).toEqual([]);
  });
});

describe('the credential posture: the account gate, cap null, and the step-up where a key is written or removed (row 14)', () => {
  const acts: [string, (r: SettingsRig) => Promise<LightMyRequestResponse>, boolean][] = [
    ['add', (r) => add(r, WS.a.key), true],
    ['replace', (r) => add(r, WS.a.key, true), true],
    ['check', (r) => check(r), false],
    ['remove', (r) => remove(r), true],
  ];

  for (const [name, act, stepUp] of acts) {
    it(`${name} is refused while auth is unarmed, and nothing is asked, written or journaled`, async () => {
      const r = await rig({ enabled: false });
      await seedSlot(r.ccrcDir, 'a');
      const before = slotFiles(r).map((f) => readFileSync(path.join(slotDir(r), f), 'utf8'));
      expect(errorOf(await act(r))).toEqual([501, 'auth-off']);
      expect(r.calls).toEqual([]);
      expect(r.rows()).toEqual([]);
      expect(slotFiles(r).map((f) => readFileSync(path.join(slotDir(r), f), 'utf8'))).toEqual(before);
    });

    it(`${name} is refused from an insecure origin and with no session`, async () => {
      const r = await rig({ origin: 'http://box.example.invalid:7788' });
      await r.stamp();
      expect(errorOf(await act(r))).toEqual([403, 'insecure-origin']);
      const s = await rig();
      const res = await s.req(name === 'remove' ? 'DELETE' : 'POST',
        name === 'check' ? `${WORKSPACES}/${WS.a.id}/check` : name === 'remove' ? `${WORKSPACES}/${WS.a.id}` : WORKSPACES,
        name === 'add' || name === 'replace' ? { key: WS.a.key } : undefined, { cookie: null });
      expect(res.statusCode).toBe(401);
      expect(s.calls).toEqual([]);
      expect(s.rows()).toEqual([]);
      await r.close();
    });

    it(`${name} ${stepUp ? 'is refused without a recent step-up' : 'asks for no step-up'}`, async () => {
      const r = await rig();
      await seedSlot(r.ccrcDir, 'a');
      const res = await act(r);
      if (stepUp) {
        expect(errorOf(res)).toEqual([403, 'step-up-required']);
        expect(r.calls).toEqual([]);
        expect(r.rows()).toEqual([]);
      } else {
        expect(res.statusCode, res.body).toBe(200);
        expect(keyChecks(r)).toBe(1);
      }
    });

    it(`${name} needs no ccd cap: an unmeasured fleet does not refuse it`, async () => {
      const r = await rig();
      await r.stamp();
      if (name !== 'add') await seedSlot(r.ccrcDir, 'a');
      const res = await act(r);
      expect(res.statusCode, res.body).toBe(200);
    });
  }

  it('the gate runs before the body is read: a bad key does not outrank the missing step-up', async () => {
    const r = await rig();
    expect(errorOf(await add(r, 'x'))).toEqual([403, 'step-up-required']);
    expect(errorOf(await r.req('POST', WORKSPACES, '{"key": '))).toEqual([400, 'bad-request']);
  });

  it('a refusal for want of a step-up leaves a stored slot exactly as it was', async () => {
    const r = await rig();
    await seedSlot(r.ccrcDir, 'a');
    const before = [readFileSync(keyFile(r), 'utf8'), readFileSync(recordFile(r), 'utf8')];
    for (const res of [await remove(r), await add(r, KEY_A2, true)]) expect(errorOf(res)).toEqual([403, 'step-up-required']);
    expect([readFileSync(keyFile(r), 'utf8'), readFileSync(recordFile(r), 'utf8')]).toEqual(before);
    expect(r.calls).toEqual([]);
  });

  it('every answer of the four routes is no-store, refusals and body errors included', async () => {
    const r = await rig();
    const all: LightMyRequestResponse[] = [await list(r), await add(r, WS.a.key), await check(r, 'not-a-uuid'), await remove(r)];
    await r.stamp();
    all.push(await add(r, 'x'), await add(r, WS.a.key), await add(r, WS.a.key), await check(r), await remove(r), await remove(r, 'nope'));
    for (const [method, url] of [['POST', WORKSPACES], ['POST', `${WORKSPACES}/${WS.a.id}/check`], ['DELETE', `${WORKSPACES}/${WS.a.id}`]] as const) {
      const bad = await r.req(method, url, '{"key": ');
      expect(errorOf(bad), `${method} ${url} malformed`).toEqual([400, 'bad-request']);
      expect(bodyOf(bad)).toEqual({ ok: false, error: 'bad-request' });
      const big = await r.req(method, url, { key: WS.a.key, pad: 'x'.repeat(4096) });
      expect(errorOf(big), `${method} ${url} oversize`).toEqual([413, 'oversize']);
      all.push(bad, big);
    }
    for (const res of all) expect(res.headers['cache-control'], `${res.statusCode} ${res.body.slice(0, 60)}`).toBe('no-store');
  });

  it('the legacy routes keep main\'s posture beside them: Check again takes no step-up, Connect and Disconnect do', async () => {
    const r = await rig();
    await seedLegacy(r.ccrcDir, 'a', { learned: false });
    expect((await r.req('POST', '/api/linear/connection/check')).statusCode).toBe(200);
    expect(errorOf(await r.req('PUT', '/api/linear/connection', { key: WS.b.key }))).toEqual([403, 'step-up-required']);
    expect(errorOf(await r.req('DELETE', '/api/linear/connection'))).toEqual([403, 'step-up-required']);
    expect((await r.req('GET', '/api/linear/connection')).statusCode).toBe(200);
    expect(r.rows(), 'a legacy route wrote a journal row').toEqual([]);
  });
});

describe('POST /api/linear/workspaces: add verifies before it stores (spec §10.1, §4.1)', () => {
  it('a key failing the shape rule is 400 bad-key and Linear is never asked; a body not {key, replace?} is bad-request', async () => {
    const r = await rig();
    await r.stamp();
    for (const k of ['short', 'has space in it 12345', `lin_api_${'x'.repeat(300)}`]) expect(errorOf(await add(r, k))).toEqual([400, 'bad-key']);
    for (const b of [{}, { key: 7 }, { key: WS.a.key, replace: 'yes' }, [WS.a.key], 'null']) {
      const res = await r.req('POST', WORKSPACES, b);
      expect(errorOf(res), JSON.stringify(b)).toEqual([400, 'bad-request']);
      expect(res.body).not.toContain(WS.a.key);
    }
    expect(r.calls).toEqual([]);
    expect(slotFiles(r)).toEqual([]);
    expect(r.rows(), 'a refused body was journaled').toEqual([]);
  });

  it('a good key asks Linear once with the bare key and the key check, then writes the slot at 0600 and answers added', async () => {
    const r = await rig();
    await r.stamp();
    const res = await add(r, WS.a.key);
    expect(res.statusCode, res.body).toBe(200);
    expect(bodyOf(res)).toEqual({ ok: true, store: 'ok', workspaces: [connectedA()], legacy: null, added: WS.a.id });
    expect(r.calls.filter((c) => c.op === 'KeyCheck').map((c) => c.authorization)).toEqual([WS.a.key]);
    expect(readFileSync(keyFile(r), 'utf8')).toBe(`${WS.a.key}\n`);
    expect(statSync(keyFile(r)).mode & 0o777).toBe(0o600);
    expect(statSync(recordFile(r)).mode & 0o777).toBe(0o600);
    expect(statSync(slotDir(r)).mode & 0o777).toBe(0o700);
    expect(parseLinearStoreRecord(readFileSync(recordFile(r), 'utf8'))).toEqual({
      workspaceId: WS.a.id, name: WS.a.name, urlKey: WS.a.urlKey, user: 'User A',
      teams: WS.a.teams.map((t) => ({ ...t })), teamsAt: NOW, keyTail: WS.a.key.slice(-4), keyDigest: valueDigestHex(WS.a.key),
      checkedAt: NOW, outcome: 'ok',
    });
    expect(res.body).not.toContain(WS.a.key.slice(0, 12));
  });

  it('a second page of teams is asked with the first page\'s cursor, and the slot keeps both pages', async () => {
    const page = (n: number, next: string | null) => ({ body: { data: {
      viewer: { name: 'User A' }, organization: { id: WS.a.id, name: WS.a.name, urlKey: WS.a.urlKey },
      teams: { nodes: [{ id: `aaaaaaaa-1111-4000-8000-00000000000${n}`, key: `AA${n}`, name: `Team ${n}` }], pageInfo: { hasNextPage: next !== null, endCursor: next } },
    } } });
    const r = await rig({ respond: (c) => (c.variables['after'] === null ? page(1, 'cursor-1') : page(2, null)) });
    await r.stamp();
    expect((await add(r, WS.a.key)).statusCode).toBe(200);
    expect(r.calls.filter((c) => c.op === 'KeyCheck').map((c) => c.variables['after'])).toEqual([null, 'cursor-1']);
    expect(parseLinearStoreRecord(readFileSync(recordFile(r), 'utf8'))?.teams.map((t) => t.key)).toEqual(['AA1', 'AA2']);
  });

  it('the workspace already has a slot: 409 workspace-exists naming it, and the stored key is untouched', async () => {
    const r = await rig();
    await r.stamp();
    await seedSlot(r.ccrcDir, 'a');
    const before = [readFileSync(keyFile(r), 'utf8'), readFileSync(recordFile(r), 'utf8')];
    const res = await add(r, KEY_A2);
    expect(errorOf(res)).toEqual([409, 'workspace-exists']);
    expect(bodyOf(res)['workspace']).toEqual({ id: WS.a.id, name: WS.a.name, urlKey: WS.a.urlKey });
    expect([readFileSync(keyFile(r), 'utf8'), readFileSync(recordFile(r), 'utf8')]).toEqual(before);
    expect(res.body).not.toContain(KEY_A2.slice(0, 12));
  });

  it('replace: true stores the new key over the slot and answers replaced; the next list shows the new tail', async () => {
    const r = await rig();
    await r.stamp();
    await seedSlot(r.ccrcDir, 'a');
    const res = await add(r, KEY_A2, true);
    expect(res.statusCode, res.body).toBe(200);
    expect(bodyOf(res)).toMatchObject({ replaced: WS.a.id, workspaces: [connectedA(KEY_A2)] });
    expect(bodyOf(res)['added']).toBeUndefined();
    expect(readFileSync(keyFile(r), 'utf8')).toBe(`${KEY_A2}\n`);
    // replace: true on a workspace with no slot adds it.
    expect(bodyOf(await add(r, WS.b.key, true))).toMatchObject({ added: WS.b.id });
  });

  it('two adds of one workspace at once: one is added, the other answers workspace-exists (the test and the write are one locked act)', async () => {
    const r = await rig();
    await r.stamp();
    const [x, y] = await Promise.all([add(r, WS.a.key), add(r, KEY_A2)]);
    expect([x.statusCode, y.statusCode].sort()).toEqual([200, 409]);
    const stored = readFileSync(keyFile(r), 'utf8').trim();
    expect([WS.a.key, KEY_A2]).toContain(stored);
    expect(parseLinearStoreRecord(readFileSync(recordFile(r), 'utf8'))?.keyDigest).toBe(valueDigestHex(stored));
  });

  it('a key Linear rejects or forbids is 400, its own word, and NOTHING is written', async () => {
    for (const [status, word] of [[401, 'key-rejected'], [403, 'key-forbidden']] as const) {
      const r = await rig({ respond: () => statusAnswer(status, {}, { errors: [{ message: LEAK }] }) });
      await r.stamp();
      const res = await add(r, WS.a.key);
      expect(errorOf(res)).toEqual([400, word]);
      expect(res.body).not.toContain(LEAK);
      expect(slotFiles(r)).toEqual([]);
      await r.close();
    }
  });

  it('a Linear that does not answer is 503, one word per arm, and NOTHING is written', async () => {
    const arms: [string, Responder][] = [
      ['unreachable', () => statusAnswer(502)],
      ['malformed', () => ({ body: { data: { nothing: true } } })],
      ['timeout', () => new Promise(() => {})],
    ];
    for (const [word, respond] of arms) {
      const r = await rig({ respond });
      await r.stamp();
      expect(errorOf(await add(r, WS.a.key)), word).toEqual([503, word]);
      expect(slotFiles(r)).toEqual([]);
      await r.close();
    }
  });

  it('Linear\'s own rate limit is rate-limited linear with Retry-After, and NOTHING is written', async () => {
    for (const respond of [() => statusAnswer(429, { 'retry-after': '30' }), () => ({ body: RATELIMITED_ERRORS })] as Responder[]) {
      const r = await rig({ respond });
      await r.stamp();
      const res = await add(r, WS.a.key);
      expect(errorOf(res)).toEqual([429, 'rate-limited']);
      expect(bodyOf(res)['detail']).toBe('linear');
      expect(res.headers['retry-after']).toBe(String(bodyOf(res)['retryAfterS']));
      expect(slotFiles(r)).toEqual([]);
      await r.close();
    }
  });

  it('an answer that does not name its workspace whole stores nothing: a slot needs its id, and a partial team list could misroute', async () => {
    const noOrgId = () => ({ body: { data: {
      viewer: { name: 'User A' }, organization: { name: WS.a.name, urlKey: WS.a.urlKey },
      teams: { nodes: [], pageInfo: { hasNextPage: false, endCursor: null } },
    } } });
    const r = await rig({ respond: noOrgId });
    await r.stamp();
    expect(errorOf(await add(r, WS.a.key))).toEqual([503, 'malformed']);
    expect(slotFiles(r)).toEqual([]);
  });

  it('a stored add queues the slot\'s directory refresh, in the background, after the answer', async () => {
    const r = await rig();
    await r.stamp();
    expect((await add(r, WS.a.key)).statusCode).toBe(200);
    await r.fx.refresher.idle();
    expect(r.calls.map((c) => c.op)).toEqual(['KeyCheck', 'DirectoryStates', 'DirectoryLabels', 'DirectoryProjects', 'DirectoryUsers']);
  });

  it('never carries Linear\'s text, the key or its digest, in any answer', async () => {
    const r = await rig({ respond: (c) => (c.authorization === KEY_A2 ? statusAnswer(401, {}, { errors: [{ message: LEAK }], key: LEAK }) : null) });
    await r.stamp();
    const bodies = [(await add(r, WS.a.key)).body, (await add(r, KEY_A2)).body, (await add(r, KEY_A2, true)).body, (await list(r)).body];
    for (const b of bodies) {
      for (const k of [WS.a.key, KEY_A2]) {
        expect(b).not.toContain(k.slice(0, 12));
        expect(b).not.toContain(valueDigestHex(k));
      }
      expect(b).not.toContain(LEAK);
    }
  });
});

describe('POST /api/linear/workspaces/:id/check (spec §10.1, §4.1)', () => {
  it('an id that is not a workspace id is 400 bad-request, before the disk is read: no Linear call, no journal row', async () => {
    const r = await rig();
    for (const id of ['not-a-uuid', '../linear', 'AAAAAAAA-0000-4000-8000-00000000000A', `${WS.a.id}x`]) {
      expect(errorOf(await check(r, encodeURIComponent(id))), id).toEqual([400, 'bad-request']);
    }
    expect(r.calls).toEqual([]);
    expect(r.rows()).toEqual([]);
  });

  it('a slot that is not there answers 409 not-connected, with the list, and asks Linear nothing', async () => {
    const r = await rig();
    const res = await check(r);
    expect(errorOf(res)).toEqual([409, 'not-connected']);
    expect(bodyOf(res)).toMatchObject({ workspaces: [], store: 'ok' });
    expect(r.calls).toEqual([]);
  });

  it('re-checks the stored key: the time, the outcome and the teams are recorded, the key file left alone', async () => {
    const r = await rig();
    await seedSlot(r.ccrcDir, 'a', { teams: [], teamsAt: 1 });
    const keyBefore = readFileSync(keyFile(r), 'utf8');
    const res = await check(r);
    expect(res.statusCode, res.body).toBe(200);
    expect(bodyOf(res)['workspaces']).toEqual([connectedA()]);
    expect(r.calls.filter((c) => c.op === 'KeyCheck').map((c) => c.authorization)).toEqual([WS.a.key]);
    expect(readFileSync(keyFile(r), 'utf8')).toBe(keyBefore);
    expect(parseLinearStoreRecord(readFileSync(recordFile(r), 'utf8'))).toMatchObject({ teamsAt: NOW, checkedAt: NOW, outcome: 'ok' });
    await r.fx.refresher.idle();
    expect(r.calls.map((c) => c.op), 'a check queues the directory refresh').toContain('DirectoryStates');
  });

  it('a check Linear rejects, forbids or cannot answer records that outcome, keeps what the record knew, and answers 200', async () => {
    for (const [respond, state] of [
      [() => statusAnswer(401), 'key-rejected'], [() => statusAnswer(403), 'key-forbidden'], [() => statusAnswer(502), 'unreachable'],
    ] as [Responder, string][]) {
      const r = await rig({ respond });
      await seedSlot(r.ccrcDir, 'a');
      const res = await check(r);
      expect(res.statusCode, state).toBe(200);
      expect((bodyOf(res)['workspaces'] as Record<string, unknown>[])[0]).toMatchObject({ state, name: WS.a.name, teams: [{ key: 'AAA', name: 'Team A' }] });
      await r.close();
    }
  });

  it('a result for a key replaced while Linear was being asked is dropped: the old key\'s 401 never condemns the new one', async () => {
    let r: SettingsRig;
    r = await rig({ respond: async () => { await seedSlot(r.ccrcDir, 'a', { key: KEY_A2 }); return statusAnswer(401); } });
    await seedSlot(r.ccrcDir, 'a');
    const res = await check(r);
    expect(res.statusCode).toBe(200);
    expect((bodyOf(res)['workspaces'] as Record<string, unknown>[])[0]).toMatchObject({ state: 'connected', keyTail: KEY_A2.slice(-4) });
  });

  it('a slot removed during its check stops at the next page and records nothing', async () => {
    let r: SettingsRig;
    r = await rig({ respond: () => {
      rmSync(keyFile(r));
      return { body: { data: { viewer: { name: 'User A' }, organization: { id: WS.a.id, name: WS.a.name, urlKey: WS.a.urlKey },
        teams: { nodes: WS.a.teams.map((t) => ({ ...t })), pageInfo: { hasNextPage: true, endCursor: 'cursor-1' } } } } };
    } });
    await seedSlot(r.ccrcDir, 'a', { teamsAt: 1 });
    const recordBefore = readFileSync(recordFile(r), 'utf8');
    await check(r);
    expect(keyChecks(r)).toBe(1);
    expect(readFileSync(recordFile(r), 'utf8')).toBe(recordBefore);
  });

  it('a check refused by the rate service answers rate-limited with Retry-After and asks Linear nothing', async () => {
    const r = await rig();
    await seedSlot(r.ccrcDir, 'a');
    for (;;) if (!r.fx.rate.take({ lane: 'floor', slot: { source: 'file', id: WS.a.id }, calls: 1 }).ok) break;
    const res = await check(r);
    expect(errorOf(res)).toEqual([429, 'rate-limited']);
    expect(bodyOf(res)['detail']).toBe('workspace');
    expect(res.headers['retry-after']).toBe(String(bodyOf(res)['retryAfterS']));
    expect(r.calls).toEqual([]);
  });
});

describe('DELETE /api/linear/workspaces/:id (spec §10.1, §9)', () => {
  it('removes the key FIRST, then the record, and answers the list without the slot', async () => {
    const r = await rig();
    await r.stamp();
    await seedSlot(r.ccrcDir, 'a');
    await seedSlot(r.ccrcDir, 'b');
    const res = await remove(r);
    expect(res.statusCode, res.body).toBe(200);
    expect((bodyOf(res)['workspaces'] as Record<string, unknown>[]).map((w) => w['id'])).toEqual([WS.b.id]);
    expect(slotFiles(r)).toEqual([`${WS.b.id}.json`, `${WS.b.id}.key`]);
    expect(r.calls).toEqual([]);
  });

  it('removing a slot that is not there is a success; an id that is not a workspace id is 400 bad-request', async () => {
    const r = await rig();
    await r.stamp();
    expect((await remove(r)).statusCode).toBe(200);
    expect(errorOf(await remove(r, 'not-a-uuid'))).toEqual([400, 'bad-request']);
    expect(r.rows().map((x) => x['op'])).toEqual(['key-remove']);
  });

  it('leaves the legacy pair, and the other slots, exactly as they were', async () => {
    const r = await rig();
    await r.stamp();
    await seedLegacy(r.ccrcDir, 'a', { learned: true });
    await seedSlot(r.ccrcDir, 'a');
    const pair = ['linear.key', 'linear.json'].map((f) => readFileSync(path.join(r.ccrcDir, f), 'utf8'));
    expect((await remove(r)).statusCode).toBe(200);
    expect(['linear.key', 'linear.json'].map((f) => readFileSync(path.join(r.ccrcDir, f), 'utf8'))).toEqual(pair);
    expect(bodyOf(await list(r))['legacy']).toMatchObject({ superseded: false });
  });
});

describe('every key act is journaled with the gate\'s actor, pending before any file or Linear call (spec §7, §10.1)', () => {
  it('add, replace, check and remove each write their row: the op, the actor, the slot where it is known, then the outcome', async () => {
    const r = await rig();
    await r.stamp();
    await add(r, WS.a.key);
    await add(r, KEY_A2, true);
    await check(r);
    await remove(r);
    expect(r.rows().map((x) => [x['op'], x['workspaceId'], x['outcome'], x['code'], x['sessionId'], x['teamKey'], x['target'], x['fields']])).toEqual([
      ['key-add', null, 'ok', null, null, null, null, null],
      ['key-replace', null, 'ok', null, null, null, null, null],
      ['key-check', WS.a.id, 'ok', null, null, null, null, null],
      ['key-remove', WS.a.id, 'ok', null, null, null, null, null],
    ]);
    for (const row of r.rows()) expect(String(row['actor'])).toMatch(/^a test phone [0-9a-f]{8}$/);
  });

  it('a refused act gets its row with its word', async () => {
    const r = await rig({ respond: (c) => (c.authorization === KEY_A2 ? statusAnswer(401) : null) });
    await r.stamp();
    await seedSlot(r.ccrcDir, 'b');
    await add(r, WS.b.key);
    await add(r, KEY_A2);
    await check(r);
    expect(r.rows().map((x) => [x['op'], x['outcome'], x['code']])).toEqual([
      ['key-add', 'refused', 'workspace-exists'],
      ['key-add', 'refused', 'key-rejected'],
      ['key-check', 'refused', 'not-connected'],
    ]);
  });

  it('the row is pending while Linear is asked, and no key is written before it', async () => {
    let r: SettingsRig;
    const seen: [unknown, boolean][] = [];
    r = await rig({ respond: (c) => { if (c.op === 'KeyCheck') seen.push([r.rows().at(-1)?.['outcome'], existsSync(keyFile(r))]); return null; } });
    await r.stamp();
    expect((await add(r, WS.a.key)).statusCode).toBe(200);
    expect(seen).toEqual([['pending', false]]);
  });

  for (const [name, act, seed] of [
    ['add', (r: SettingsRig) => add(r, WS.a.key), false],
    ['replace', (r: SettingsRig) => add(r, KEY_A2, true), true],
    ['check', (r: SettingsRig) => check(r), true],
    ['remove', (r: SettingsRig) => remove(r), true],
  ] as const) {
    it(`a journal that cannot take the row refuses ${name} with journal-unavailable: no file touched, no Linear call`, async () => {
      quiet();
      const r = await rig({ journal: new LinearJournal(new DatabaseSync(':memory:')) });
      await r.stamp();
      if (seed) await seedSlot(r.ccrcDir, 'a');
      const before = slotFiles(r).map((f) => [f, readFileSync(path.join(slotDir(r), f), 'utf8')]);
      expect(errorOf(await act(r))).toEqual([503, 'journal-unavailable']);
      expect(r.calls).toEqual([]);
      expect(slotFiles(r).map((f) => [f, readFileSync(path.join(slotDir(r), f), 'utf8')])).toEqual(before);
    });

    it(`an absent journal refuses ${name} with linear-unavailable after the gate: no file touched, no Linear call`, async () => {
      const r = await rig({ absent: ['journal'] });
      await r.stamp();
      if (seed) await seedSlot(r.ccrcDir, 'a');
      const before = slotFiles(r).map((f) => [f, readFileSync(path.join(slotDir(r), f), 'utf8')]);
      expect(errorOf(await act(r))).toEqual([503, 'linear-unavailable']);
      expect(r.calls).toEqual([]);
      expect(slotFiles(r).map((f) => [f, readFileSync(path.join(slotDir(r), f), 'utf8')])).toEqual(before);
    });
  }

  it('an absent rate service or refresher refuses add, replace and check with linear-unavailable; remove, which calls no Linear, still runs', async () => {
    for (const gone of ['rate', 'refresher'] as const) {
      const r = await rig({ absent: [gone] });
      await r.stamp();
      await seedSlot(r.ccrcDir, 'b');
      for (const res of [await add(r, WS.a.key), await add(r, WS.a.key, true), await check(r, WS.b.id)]) {
        expect(errorOf(res), gone).toEqual([503, 'linear-unavailable']);
      }
      expect(r.calls).toEqual([]);
      expect(r.rows(), 'an act refused for a missing service was journaled').toEqual([]);
      expect((await remove(r, WS.b.id)).statusCode).toBe(200);
      await r.close();
    }
  });
});

describe('the store\'s own rules, through the routes', () => {
  it('a remove that leaves a record with no key (a crash between its two deletions) lists nothing, and the next write sweeps it', async () => {
    const r = await rig();
    await r.stamp();
    await seedSlot(r.ccrcDir, 'a');
    rmSync(keyFile(r));
    expect(bodyOf(await list(r))['workspaces']).toEqual([]);
    expect(existsSync(recordFile(r))).toBe(true);
    expect((await add(r, WS.b.key)).statusCode).toBe(200);
    expect(existsSync(recordFile(r))).toBe(false);
  });

  it('a key with no record beside it lists details unknown, and its Check again writes the full record', async () => {
    const r = await rig();
    mkdirSync(slotDir(r), { recursive: true, mode: 0o700 });
    writeFileSync(keyFile(r), `${WS.a.key}\n`, { mode: 0o600 });
    expect((bodyOf(await list(r))['workspaces'] as Record<string, unknown>[])[0]).toMatchObject({ state: 'details-unknown', why: 'absent' });
    expect((bodyOf(await check(r))['workspaces'] as unknown[])[0]).toEqual(connectedA());
    const store = await readLinearStore(r.ccrcDir);
    expect(store.kind === 'listed' && store.slots[0]?.record.kind).toBe('details');
  });
});

describe('the recorded fixtures (FX, D-7684, D-7743)', () => {
  /** The recorded key check's workspace (`fixtures/linear/key-check-page-1.json`): one team, so one page. */
  const FX_WS = '00000000-0000-4000-8000-000000000001';
  const FX_KEY = 'lin_api_fixtureRecordedK3y5m7n9p1q3r5s7t9u1v3w5x7y9z1';
  const FX_KEY_2 = 'lin_api_fixtureRecordedSecond2b4d6f8h0j2l4n6p8r0t2v4';
  const recorded: Responder = (c) => (c.op === 'KeyCheck' ? recordedAnswer('key-check-page-1') : null);
  const connectedFx = (key: string): Record<string, unknown> => ({
    id: FX_WS, name: 'Workspace A', urlKey: 'ws-a', user: 'User A', teams: [{ key: 'AAA', name: 'Team A' }],
    keyTail: key.slice(-4), checkedAt: NOW, state: 'connected', outcome: 'ok', org: 'Workspace A',
  });

  it('add, replace and check against the recorded key-check answer: its real headers, one page, the workspace learned', async () => {
    // The page's recorded X-Complexity is under the cap (628, linear-route.test.ts holds it), and the second page is
    // never asked: the recorded first page says there is none, and the second page's recording is an empty page.
    expect(recordedHeader(linearRecord('key-check-page-1'), 'x-ratelimit-requests-reset')).not.toBeNull();
    const r = await rig({ respond: recorded });
    await r.stamp();
    const added = await add(r, FX_KEY);
    expect(added.statusCode, added.body).toBe(200);
    expect(bodyOf(added)).toMatchObject({ added: FX_WS, workspaces: [connectedFx(FX_KEY)] });
    const replaced = await add(r, FX_KEY_2, true);
    expect(bodyOf(replaced)).toMatchObject({ replaced: FX_WS, workspaces: [connectedFx(FX_KEY_2)] });
    const checked = await check(r, FX_WS);
    expect(checked.statusCode, checked.body).toBe(200);
    expect(bodyOf(checked)['workspaces']).toEqual([connectedFx(FX_KEY_2)]);
    expect(keyChecks(r)).toBe(3);
    expect(r.calls.filter((c) => c.op === 'KeyCheck').map((c) => c.variables)).toEqual([{ after: null }, { after: null }, { after: null }]);
    expect(parseLinearStoreRecord(readFileSync(recordFile(r, FX_WS), 'utf8'))).toMatchObject({
      teams: [{ id: '00000000-0001-4000-8000-000000000001', key: 'AAA', name: 'Team A' }], outcome: 'ok',
    });
  });

  it('a revoked key\'s recorded 401 answer: add is key-rejected and writes nothing; check records key-rejected', async () => {
    const r = await rig({ respond: (c) => (c.op === 'KeyCheck' ? recordedAnswer(c.authorization === FX_KEY ? 'key-check-page-1' : 'error-401-revoked-key') : null) });
    await r.stamp();
    const refused = await add(r, FX_KEY_2);
    expect(errorOf(refused)).toEqual([400, 'key-rejected']);
    expect(refused.body).not.toContain('Authentication required');
    expect(slotFiles(r)).toEqual([]);
    expect((await add(r, FX_KEY)).statusCode).toBe(200);
    // The operator revokes the stored key in Linear: its next check gets the recorded 401, and records it.
    writeFileSync(keyFile(r, FX_WS), `${FX_KEY_2}\n`, { mode: 0o600 });
    const checked = await check(r, FX_WS);
    expect(checked.statusCode, checked.body).toBe(200);
    expect((bodyOf(checked)['workspaces'] as Record<string, unknown>[])[0]).toMatchObject({ id: FX_WS, state: 'key-rejected' });
    expect(r.rows().map((x) => [x['op'], x['outcome'], x['code']])).toEqual([
      ['key-add', 'refused', 'key-rejected'], ['key-add', 'ok', null], ['key-check', 'refused', 'key-rejected'],
    ]);
  });

  it('a made-up key and a revoked key get the same recorded answer', () => {
    const a = linearRecord('error-401-invalid-key');
    const b = linearRecord('error-401-revoked-key');
    expect([a.status, b.status]).toEqual([401, 401]);
    expect(a.body).toEqual(b.body);
  });
});

// Removing a key stops access at once (#1444, spec §9, §14 row 11; plan task LK9: the proxy's clauses, with the remove
// as a store call, `removeLinearSlot`; LK11: the same clauses through the Settings routes, at the end of this file). Nothing caches a key: the proxy reads it
// from its file before each Linear call, so a remove or a replace is seen by the very next call, and a key check or a
// background refresh reads it again before each page.
import { describe, it, expect, afterEach } from 'vitest';
import { existsSync, rmSync } from 'node:fs';
import path from 'node:path';
import { putLinearSlot, readLinearStore, removeLinearSlot } from '../src/linear/store.js';
import { keyTailOf } from '../src/linear/connection.js';
import { valueDigestHex } from '../src/token/files.js';
import { WS, bodyOf, proxyRig, seedLegacy, seedSlot, type ProxyRig } from './linearProxyRig.js';
import { WORKSPACES, settingsRig, type SettingsRig } from './linearSettingsRig.js';

let rig: ProxyRig | null = null;
afterEach(async () => { await rig?.close(); rig = null; });

const REPLACED = 'lin_api_fixtureAlphaReplacedK3j5h7g9f1d3s5a7p9o1i3u5y';

/** Workspace A's slot with another key, its record describing that key. */
const replaceA = (ccrcDir: string, key: string = REPLACED) => putLinearSlot(ccrcDir, key, {
  workspaceId: WS.a.id, name: WS.a.name, urlKey: WS.a.urlKey, user: 'User A', teams: WS.a.teams.map((t) => ({ ...t })),
  teamsAt: Date.now(), keyTail: keyTailOf(key), keyDigest: valueDigestHex(key), checkedAt: Date.now(), outcome: 'ok',
}, { replace: true });

describe('a remove stops the next call (spec §9)', () => {
  it('after a delete the next call answers not-configured, and no other slot is chosen for its team', async () => {
    rig = await proxyRig();
    await seedSlot(rig.ccrcDir, 'a');
    expect((await rig.call('issue', { ref: 'AAA-1' })).statusCode).toBe(200);
    await removeLinearSlot(rig.ccrcDir, WS.a.id);
    const gone = await rig.call('issue', { ref: 'AAA-1' });
    expect([gone.statusCode, bodyOf(gone)['error']]).toEqual([501, 'not-configured']);
    // With another workspace's slot on the box, a team only A held is not guessed onto it.
    await seedSlot(rig.ccrcDir, 'b');
    const calls = rig.calls.length;
    const other = await rig.call('issue', { ref: 'AAA-1' });
    expect([other.statusCode, bodyOf(other)['error']]).toEqual([404, 'team-unknown']);
    expect(rig.calls.slice(calls).filter((c) => c.authorization === WS.b.key && c.op === 'Issue')).toEqual([]);
  });

  it('a delete between the resolve and the operation: the operation is not sent, and the row says not-configured', async () => {
    rig = await proxyRig({ respond: async (c) => { if (c.op === 'ResolveIssue') await removeLinearSlot(rig!.ccrcDir, WS.a.id); return null; } });
    await seedSlot(rig.ccrcDir, 'a');
    const res = await rig.call('comment', { ref: 'AAA-12' });
    expect([res.statusCode, bodyOf(res)['error']]).toEqual([501, 'not-configured']);
    expect(rig.calls.map((c) => c.op)).toEqual(['ResolveIssue']);
    expect(rig.rows()).toMatchObject([{ op: 'comment', outcome: 'refused', code: 'not-configured' }]);
  });

  it('a key file removed alone (a remove between its two deletions) answers not-configured, never another slot', async () => {
    rig = await proxyRig();
    await seedSlot(rig.ccrcDir, 'a');
    await seedSlot(rig.ccrcDir, 'b', { teams: [{ id: WS.b.teams[0].id, key: 'BBB', name: 'Team B' }] });
    rmSync(path.join(rig.ccrcDir, 'linear', `${WS.a.id}.key`));
    const res = await rig.call('issue', { ref: 'AAA-1' });
    expect(res.statusCode).not.toBe(200);
    expect(rig.calls.filter((c) => c.op === 'Issue')).toEqual([]);
  });
});

describe('a replace takes effect on the next call (spec §9)', () => {
  it('the next call is made with the new key', async () => {
    rig = await proxyRig();
    await seedSlot(rig.ccrcDir, 'a');
    await rig.call('issue');
    await replaceA(rig.ccrcDir);
    await rig.call('issue');
    expect(rig.calls.map((c) => c.authorization)).toEqual([WS.a.key, REPLACED]);
  });

  it('a replace between the resolve and the operation: the operation is sent with the new key, read for that call', async () => {
    rig = await proxyRig({ respond: async (c) => { if (c.op === 'ResolveIssue') await replaceA(rig!.ccrcDir); return null; } });
    await seedSlot(rig.ccrcDir, 'a');
    const res = await rig.call('comment', { ref: 'AAA-12' });
    expect(res.statusCode, res.body).toBe(200);
    expect(rig.calls.map((c) => [c.op, c.authorization])).toEqual([['ResolveIssue', WS.a.key], ['CommentCreate', REPLACED]]);
  });
});

describe('a remove during a key check or a refresh stops it at its next page and records nothing (spec §9)', () => {
  it('a slot removed after the first page of a refresh a miss queued: no second page, no record written back', async () => {
    rig = await proxyRig({ respond: async (c) => {
      if (c.op !== 'KeyCheck') return null;
      await removeLinearSlot(rig!.ccrcDir, WS.a.id);
      return { body: { data: { viewer: { name: 'User A' }, organization: { id: WS.a.id, name: WS.a.name, urlKey: WS.a.urlKey },
        teams: { nodes: WS.a.teams.map((t) => ({ ...t })), pageInfo: { hasNextPage: true, endCursor: 'cursor-1' } } } } };
    } });
    await seedSlot(rig.ccrcDir, 'a', { teamsAt: 0 });
    expect(bodyOf(await rig.call('issue', { ref: 'ZZZ-1' }))['detail']).toBe('refreshing');
    await rig.fx.refresher.idle();
    expect(rig.calls.filter((c) => c.op === 'KeyCheck')).toHaveLength(1);
    expect(existsSync(path.join(rig.ccrcDir, 'linear', `${WS.a.id}.json`)), 'the refresh recorded over a removed slot').toBe(false);
    const store = await readLinearStore(rig.ccrcDir);
    expect(store.kind === 'listed' && store.slots).toEqual([]);
  });

  it('a slot replaced during a refresh: the old key\'s answer is not recorded over the new key', async () => {
    rig = await proxyRig({ respond: async (c) => {
      if (c.op !== 'KeyCheck' || c.authorization !== WS.a.key) return null;
      await replaceA(rig!.ccrcDir);
      return { body: { data: { viewer: { name: 'User A' }, organization: { id: WS.a.id, name: WS.a.name, urlKey: WS.a.urlKey },
        teams: { nodes: [{ id: 'aaaaaaaa-1111-4000-8000-0000000000ff', key: 'ZZZ', name: 'Team Z' }], pageInfo: { hasNextPage: false, endCursor: null } } } } };
    } });
    await seedSlot(rig.ccrcDir, 'a', { teamsAt: 0 });
    await rig.call('issue', { ref: 'ZZZ-1' });
    await rig.fx.refresher.idle();
    const store = await readLinearStore(rig.ccrcDir);
    const rec = store.kind === 'listed' && store.slots[0]!.record.kind === 'details' ? store.slots[0]!.record.details : null;
    expect(rec?.keyDigest).toBe(valueDigestHex(REPLACED));
    expect(rec?.teams.map((t) => t.key), 'the old key\'s teams were recorded for the new one').toEqual(['AAA']);
  });
});

describe('the legacy key and a file slot for the same workspace (spec §3.4, §9)', () => {
  it('the file slot is used; after it is removed the legacy slot serves the workspace again; after Disconnect, not-configured', async () => {
    rig = await proxyRig();
    const legacyKey = await seedLegacy(rig.ccrcDir, 'a', { learned: true });
    await seedSlot(rig.ccrcDir, 'a');
    await rig.call('issue', { ref: 'AAA-1' });
    expect(rig.calls.at(-1)!.authorization, 'the file slot wins').toBe(WS.a.key);
    await removeLinearSlot(rig.ccrcDir, WS.a.id);
    expect((await rig.call('issue', { ref: 'AAA-1' })).statusCode).toBe(200);
    expect(rig.calls.at(-1)!.authorization, 'the legacy slot serves W again').toBe(legacyKey);
    // Disconnect (`DELETE /api/linear/connection`) removes the key first, then its record.
    rmSync(path.join(rig.ccrcDir, 'linear.key'));
    rmSync(path.join(rig.ccrcDir, 'linear.json'));
    const calls = rig.calls.length;
    const res = await rig.call('issue', { ref: 'AAA-1' });
    expect([res.statusCode, bodyOf(res)['error']]).toEqual([501, 'not-configured']);
    expect(rig.calls.length).toBe(calls);
  });
});

// ── the Settings routes (plan task LK11): the remove and the replace an operator makes, through their routes ──

describe('the Settings remove and replace stop or switch the next call (spec §9, §10.1; LK11)', () => {
  let settings: SettingsRig | null = null;
  afterEach(async () => { await settings?.fx.refresher.idle(); await settings?.close(); settings = null; });
  /** The Settings routes over the proxy rig's own slots, services and Linear stand-in. */
  const both = async (): Promise<{ proxy: ProxyRig; s: SettingsRig }> => {
    rig = await proxyRig();
    settings = await settingsRig({ ccrcDir: rig.ccrcDir, fx: rig.fx, standIn: { fetch: rig.fetch, calls: rig.calls } });
    await settings.stamp();
    return { proxy: rig, s: settings };
  };

  it('after DELETE /api/linear/workspaces/:id the next call answers not-configured, and no other slot is chosen', async () => {
    const { proxy, s } = await both();
    expect((await s.req('POST', WORKSPACES, { key: WS.a.key })).statusCode).toBe(200);
    expect((await proxy.call('issue', { ref: 'AAA-1' })).statusCode).toBe(200);
    expect((await s.req('DELETE', `${WORKSPACES}/${WS.a.id}`)).statusCode).toBe(200);
    const gone = await proxy.call('issue', { ref: 'AAA-1' });
    expect([gone.statusCode, bodyOf(gone)['error']]).toEqual([501, 'not-configured']);
    expect((await s.req('POST', WORKSPACES, { key: WS.b.key })).statusCode).toBe(200);
    await s.fx.refresher.idle();
    const calls = proxy.calls.length;
    const other = await proxy.call('issue', { ref: 'AAA-1' });
    expect([other.statusCode, bodyOf(other)['error']]).toEqual([404, 'team-unknown']);
    expect(proxy.calls.slice(calls).filter((c) => c.authorization === WS.b.key && c.op === 'Issue')).toEqual([]);
  });

  it('a replace through the add route takes effect on the next call', async () => {
    const { proxy, s } = await both();
    expect((await s.req('POST', WORKSPACES, { key: WS.a.key })).statusCode).toBe(200);
    await proxy.call('issue');
    expect((await s.req('POST', WORKSPACES, { key: REPLACED, replace: true })).statusCode).toBe(200);
    await proxy.call('issue');
    expect(proxy.calls.filter((c) => c.op === 'Issue').map((c) => c.authorization)).toEqual([WS.a.key, REPLACED]);
  });

  it('the legacy key serving W and a file slot for W: the file slot is used; after its Settings remove the legacy slot serves W; after the legacy Disconnect, not-configured', async () => {
    const { proxy, s } = await both();
    const legacyKey = await seedLegacy(proxy.ccrcDir, 'a', { learned: true });
    expect((await s.req('POST', WORKSPACES, { key: WS.a.key })).statusCode).toBe(200);
    expect((await s.req('GET', WORKSPACES)).body).toContain('"superseded":true');
    await proxy.call('issue', { ref: 'AAA-1' });
    expect(proxy.calls.at(-1)!.authorization, 'the file slot wins').toBe(WS.a.key);
    expect((await s.req('DELETE', `${WORKSPACES}/${WS.a.id}`)).statusCode).toBe(200);
    expect((await s.req('GET', WORKSPACES)).body).toContain('"superseded":false');
    expect((await proxy.call('issue', { ref: 'AAA-1' })).statusCode).toBe(200);
    expect(proxy.calls.at(-1)!.authorization, 'the legacy slot serves W again').toBe(legacyKey);
    // The legacy row's Disconnect is `main`'s route, behind its account gate and step-up.
    expect((await s.req('DELETE', '/api/linear/connection')).statusCode).toBe(200);
    const calls = proxy.calls.length;
    const res = await proxy.call('issue', { ref: 'AAA-1' });
    expect([res.statusCode, bodyOf(res)['error']]).toEqual([501, 'not-configured']);
    expect(proxy.calls.length).toBe(calls);
  });
});

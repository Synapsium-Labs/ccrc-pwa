// The Linear proxy's deadlines (#1444, spec §6.6, §14 row 7; plan task LK9): eight seconds a call, twenty a route, no
// second call with fewer than eight left, and nothing a request waits on that the design moved to the background (a
// team refresh, a directory fill). The route's budget is measured on the injected clock; the stand-in moves that clock
// as a slow Linear would, so no row here sleeps.
import { describe, it, expect, afterEach } from 'vitest';
import { LINEAR_TIMEOUT_MS } from '../src/linear/client.js';
import { LINEAR_CALL_BUDGET_MS, LINEAR_ROUTE_BUDGET_MS } from '../src/linear/proxyRoutes.js';
import { putLinearSlot } from '../src/linear/store.js';
import { keyTailOf } from '../src/linear/connection.js';
import { valueDigestHex } from '../src/token/files.js';
import { IDS, WS, bodyOf, defaultBody, proxyRig, seedSlot, type ProxyRig, type Responder } from './linearProxyRig.js';

let rig: ProxyRig | null = null;
afterEach(async () => { await rig?.close(); rig = null; });

/** A clock the stand-in moves. */
const clock = (): { now: () => number; advance: (ms: number) => void } => {
  let t = 1_800_000_000_000;
  return { now: () => t, advance: (ms) => { t += ms; } };
};

/** `ccrc-api`'s own deadline: `curl -m 30`. */
const CLIENT_DEADLINE_MS = 30_000;

describe('the budgets (spec §6.6)', () => {
  it('eight seconds a call, twenty a route, and both inside the client\'s thirty', () => {
    expect(LINEAR_CALL_BUDGET_MS).toBe(8_000);
    expect(LINEAR_CALL_BUDGET_MS).toBe(LINEAR_TIMEOUT_MS);
    expect(LINEAR_ROUTE_BUDGET_MS).toBe(20_000);
    // The second call starts only with a whole call's deadline left, so the route ends inside its own budget…
    expect(LINEAR_ROUTE_BUDGET_MS).toBeGreaterThanOrEqual(2 * LINEAR_CALL_BUDGET_MS);
    // …and inside the client's, with room for the policy point's two seconds.
    expect(LINEAR_ROUTE_BUDGET_MS + 2_000).toBeLessThan(CLIENT_DEADLINE_MS);
  });
});

describe('no second call with fewer than eight seconds left (spec §6.6)', () => {
  const slowResolve = (c: ReturnType<typeof clock>, ms: number): Responder => (call) => {
    if (call.op === 'ResolveIssue') c.advance(ms);
    return null;
  };

  it('a resolve that took past twelve of the twenty seconds: timeout not-sent, the mutation never sent, the row refused', async () => {
    const c = clock();
    rig = await proxyRig({ via: 'direct', clock: c.now, respond: slowResolve(c, LINEAR_ROUTE_BUDGET_MS - LINEAR_CALL_BUDGET_MS + 1) });
    await seedSlot(rig.ccrcDir, 'a');
    const res = await rig.call('comment', { ref: 'AAA-12' });
    expect([res.statusCode, bodyOf(res)['error'], bodyOf(res)['detail']]).toEqual([503, 'timeout', 'not-sent']);
    expect(rig.calls.map((x) => x.op)).toEqual(['ResolveIssue']);
    expect(rig.rows()).toMatchObject([{ op: 'comment', outcome: 'refused', code: 'timeout' }]);
  });

  it('with exactly eight seconds left the second call is still sent', async () => {
    const c = clock();
    rig = await proxyRig({ via: 'direct', clock: c.now, respond: slowResolve(c, LINEAR_ROUTE_BUDGET_MS - LINEAR_CALL_BUDGET_MS) });
    await seedSlot(rig.ccrcDir, 'a');
    const res = await rig.call('comment', { ref: 'AAA-12' });
    expect(res.statusCode, res.body).toBe(200);
    expect(rig.calls.map((x) => x.op)).toEqual(['ResolveIssue', 'CommentCreate']);
  });

  it('a read makes one call, so it has no second call to stop', async () => {
    const c = clock();
    rig = await proxyRig({ via: 'direct', clock: c.now, respond: (call) => { if (call.op === 'Issue') c.advance(19_000); return null; } });
    await seedSlot(rig.ccrcDir, 'a');
    expect((await rig.call('issue')).statusCode).toBe(200);
  });
});

describe('a write that times out after it was sent (spec §6.6)', () => {
  it('answers timeout with a detail saying it may have happened, and its row says unknown', async () => {
    rig = await proxyRig({ via: 'direct', timeoutMs: 30, respond: (call) => (call.op === 'CommentCreate' ? new Promise(() => {}) : null) });
    await seedSlot(rig.ccrcDir, 'a');
    const res = await rig.call('comment', { ref: 'AAA-12' });
    expect([res.statusCode, bodyOf(res)['error']]).toEqual([503, 'timeout']);
    expect(String(bodyOf(res)['detail'])).toContain('may have happened');
    expect(rig.rows()).toMatchObject([{ op: 'comment', outcome: 'unknown', code: 'timeout' }]);
  });

  it('a resolve that times out sent nothing: timeout with no such detail, the row refused', async () => {
    rig = await proxyRig({ via: 'direct', timeoutMs: 30, respond: (call) => (call.op === 'ResolveIssue' ? new Promise(() => {}) : null) });
    await seedSlot(rig.ccrcDir, 'a');
    const res = await rig.call('comment', { ref: 'AAA-12' });
    expect([res.statusCode, bodyOf(res)['error']]).toEqual([503, 'timeout']);
    expect(bodyOf(res)).not.toHaveProperty('detail');
    expect(rig.rows()).toMatchObject([{ op: 'comment', outcome: 'refused', code: 'timeout' }]);
  });
});

/** A third fixture workspace, whose key's check learns team `CCC` once its refresh lands. */
const WS_C = { id: 'cccccccc-0000-4000-8000-0000000000c3', urlKey: 'ws-c', name: 'Workspace C',
  key: 'lin_api_fixtureCharlieM2nB4vC6xZ8aS1dF3gH5jK7lQ9wE', team: { id: 'cccccccc-1111-4000-8000-0000000000c3', key: 'CCC', name: 'Team C' } };

/** A gate the slow stand-in's refresh pages wait on, released by the test. */
const gate = (): { wait: Promise<void>; open: () => void } => {
  let open = (): void => {};
  const wait = new Promise<void>((r) => { open = r; });
  return { wait, open };
};

describe('refresh, then write: no refresh inside a call (spec §4.3, §4.4, §6.6)', () => {
  it('a prefix miss on three stale slots answers team-unknown refreshing at once, with no call in the request and no row; the retry routes in two calls inside twenty seconds', async () => {
    const c = clock();
    const g = gate();
    rig = await proxyRig({ via: 'direct', clock: c.now, respond: async (call) => {
      if (call.op === 'ResolveIssue') {
        return { body: { data: { issue: { id: IDS.issue, identifier: call.variables['id'], team: { id: WS_C.team.id, key: WS_C.team.key } } } } };
      }
      if (call.op !== 'KeyCheck') return null;
      await g.wait;
      c.advance(8_000);                 // eight seconds a page
      if (call.authorization !== WS_C.key) return null;
      return { body: { data: { viewer: { name: 'User A' }, organization: { id: WS_C.id, name: WS_C.name, urlKey: WS_C.urlKey },
        teams: { nodes: [WS_C.team], pageInfo: { hasNextPage: false, endCursor: null } } } } };
    } });
    await seedSlot(rig.ccrcDir, 'a', { teamsAt: 0 });
    await seedSlot(rig.ccrcDir, 'b', { teamsAt: 0 });
    await putLinearSlot(rig.ccrcDir, WS_C.key, {
      workspaceId: WS_C.id, name: WS_C.name, urlKey: WS_C.urlKey, user: 'User A', teams: [], teamsAt: 0,
      keyTail: keyTailOf(WS_C.key), keyDigest: valueDigestHex(WS_C.key), checkedAt: 0, outcome: 'ok',
    }, { replace: false });

    const t0 = Date.now();
    const miss = await rig.call('update', { ref: 'CCC-5', body: { title: 'T' } });
    expect(Date.now() - t0, 'the miss waited on something').toBeLessThan(1_000);
    expect([miss.statusCode, bodyOf(miss)['error'], bodyOf(miss)['detail']]).toEqual([404, 'team-unknown', 'refreshing']);
    expect(miss.headers['retry-after']).toBe('10');
    expect(rig.calls.filter((x) => x.op !== 'KeyCheck'), 'the request called Linear').toEqual([]);
    expect(rig.rows(), 'a refusal at routing gets no row').toEqual([]);

    g.open();
    await rig.fx.refresher.idle();
    const before = rig.calls.length;
    const started = c.now();
    const retry = await rig.call('update', { ref: 'CCC-5', body: { title: 'T' } });
    expect(retry.statusCode, retry.body).toBe(200);
    expect(rig.calls.slice(before).map((x) => x.op)).toEqual(['ResolveIssue', 'IssueUpdate']);
    expect(rig.calls.slice(before).every((x) => x.authorization === WS_C.key)).toBe(true);
    expect(c.now() - started).toBeLessThan(LINEAR_ROUTE_BUDGET_MS);
  });

  it('a name miss on a cold directory answers name-unknown refreshing at once; the retry after the fill makes one call', async () => {
    const c = clock();
    const g = gate();
    rig = await proxyRig({ via: 'direct', clock: c.now, respond: async (call) => {
      if (!call.op.startsWith('Directory')) return null;
      await g.wait;
      c.advance(8_000);
      return null;
    } });
    await seedSlot(rig.ccrcDir, 'a');
    const t0 = Date.now();
    const miss = await rig.call('create', { body: { team: 'AAA', title: 'T', labels: ['Bug'] } });
    expect(Date.now() - t0).toBeLessThan(1_000);
    expect([miss.statusCode, bodyOf(miss)['error'], bodyOf(miss)['detail']]).toEqual([404, 'name-unknown', 'refreshing']);
    expect(rig.calls.filter((x) => !x.op.startsWith('Directory'))).toEqual([]);
    g.open();
    await rig.fx.refresher.idle();
    const before = rig.calls.length;
    const started = c.now();
    const retry = await rig.call('create', { body: { team: 'AAA', title: 'T', labels: ['Bug'] } });
    expect(retry.statusCode, retry.body).toBe(200);
    expect(rig.calls.slice(before).map((x) => x.op)).toEqual(['IssueCreate']);
    expect((rig.calls.at(-1)!.variables['input'] as Record<string, unknown>)['labelIds']).toEqual([IDS.label]);
    expect(c.now() - started).toBeLessThan(LINEAR_ROUTE_BUDGET_MS);
  });

  it('the default stand-in answers every directory page, so the fill above is the refresher\'s and not the rig\'s', () => {
    expect(defaultBody('DirectoryLabels', {}, WS.a.key)).toMatchObject({ data: { issueLabels: { nodes: [{ id: IDS.label }] } } });
  });
});

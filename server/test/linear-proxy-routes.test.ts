// The Linear proxy's twelve routes (#1444, spec §6, §14 row 6; plan task LK9): each verb's happy path, and each
// failure word at its status (§6.8). Linear is the rig's stand-in (`linearProxyRig.ts`), answering every fixed
// document in the spec's shape: no answer here is a recorded one. The rows that need the coordinator's FX capture
// (D-7684), which has not run, are `it.todo` naming FX.
import { describe, it, expect, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { REFUSAL_STATUS } from '../../shared/refusal.js';
import { LINEAR_OPS, LINEAR_VERBS, LINEAR_PROVENANCE_LINE, linearIssueUrl, type LinearVerb } from '../src/linear/ops.js';
import { LINEAR_PROXY_ROUTES } from '../src/linear/proxyRoutes.js';
import { readLinearStore } from '../src/linear/store.js';
import {
  BODIES, IDS, WS, bodyOf, issueNode, proxyRig, proxyUrl, seedLegacy, seedSlot, statusAnswer, type ProxyRig,
} from './linearProxyRig.js';
import { RATELIMITED_ERRORS } from './linearFetchFake.js';
import { memCoordDb } from './linearServicesFake.js';
import { callsIn, symbolOf } from './scan/symbols.js';


let rig: ProxyRig | null = null;
afterEach(async () => { await rig?.close(); rig = null; });

const open = async (o: Parameters<typeof proxyRig>[0] = {}): Promise<ProxyRig> => {
  rig = await proxyRig(o);
  await seedSlot(rig.ccrcDir, 'a');
  return rig;
};

/** The verbs that call Linear, and the ones answered from the store. */
const CALLING = LINEAR_VERBS.filter((v) => LINEAR_OPS[v].source === 'linear');
const WRITES = LINEAR_VERBS.filter((v) => LINEAR_OPS[v].class === 'write');

describe('the twelve routes are the table\'s, at the paths spec §5.1 names', () => {
  it('each verb has its route, and proxyRoutes.ts registers exactly those twelve, each path spelled once', () => {
    const registered = callsIn(symbolOf('server/src/linear/proxyRoutes.ts', 'registerLinearProxyRoutes'))
      .filter((c) => c.callee === 'app.get' || c.callee === 'app.post').map((c) => `${c.name!.toUpperCase()} ${c.args[0]!.text}`);
    expect([...registered].sort()).toEqual(Object.values(LINEAR_PROXY_ROUTES).sort());
    expect(Object.keys(LINEAR_PROXY_ROUTES).sort()).toEqual([...LINEAR_VERBS].sort());
    for (const v of LINEAR_VERBS) {
      expect(LINEAR_PROXY_ROUTES[v].startsWith(`${LINEAR_OPS[v].method} /api/linear/proxy/`), v).toBe(true);
    }
    // `search` has a path of its own, so no issue route's `{id}` can match it.
    expect(LINEAR_PROXY_ROUTES.search).toBe('POST /api/linear/proxy/search');
  });

  it('every answer is no-store', async () => {
    const r = await open();
    for (const v of LINEAR_VERBS) {
      const res = await r.call(v);
      expect(res.headers['cache-control'], v).toBe('no-store');
    }
  });
});

describe('each verb\'s happy path (spec §5.4)', () => {
  it('workspaces lists every slot from the store, with no Linear call', async () => {
    const r = await open();
    await seedSlot(r.ccrcDir, 'b');
    const res = await r.call('workspaces');
    expect(res.statusCode, res.body).toBe(200);
    expect(bodyOf(res)).toEqual({ ok: true, items: [
      { workspace: 'ws-a', name: 'Workspace A', teams: ['AAA'], state: 'connected' },
      { workspace: 'ws-b', name: 'Workspace B', teams: ['BBB'], state: 'connected' },
    ], next: null });
    expect(r.calls).toEqual([]);
  });

  it('workspaces lists an unlearned legacy key with no workspace, and leaves out one a file slot supersedes', async () => {
    const r = await open();
    await seedLegacy(r.ccrcDir, 'b', { learned: false });
    expect(bodyOf(await r.call('workspaces'))['items']).toEqual([
      { workspace: 'ws-a', name: 'Workspace A', teams: ['AAA'], state: 'connected' },
      { workspace: null, name: null, teams: [], state: 'connected' },
    ]);
    await seedLegacy(r.ccrcDir, 'a', { learned: true });
    expect(bodyOf(await r.call('workspaces'))['items']).toEqual([
      { workspace: 'ws-a', name: 'Workspace A', teams: ['AAA'], state: 'connected' },
    ]);
  });

  it('teams lists the routed workspace\'s teams from its record, with no Linear call', async () => {
    const r = await open();
    const res = await r.call('teams');
    expect(bodyOf(res)).toEqual({ ok: true, items: [{ workspace: 'ws-a', key: 'AAA', name: 'Team A' }], next: null });
    expect(r.calls).toEqual([]);
  });

  it('issue: one call with the slot\'s key, the issue shaped with its text under untrusted and url built here', async () => {
    const r = await open();
    const res = await r.call('issue', { ref: 'AAA-12' });
    expect(res.statusCode, res.body).toBe(200);
    expect(r.calls.map((c) => c.op)).toEqual(['Issue']);
    expect(r.calls[0]!.authorization).toBe(WS.a.key);
    expect(bodyOf(res)).toEqual({ ok: true, issue: {
      identifier: 'AAA-12', url: linearIssueUrl('ws-a', 'AAA-12'), workspace: 'ws-a', team: 'AAA',
      state: { name: 'Todo', type: 'unstarted' }, priority: 2, assignee: 'User A', labels: ['Bug'], project: 'Project A',
      parent: null, createdAt: '2026-10-01T00:00:00.000Z', updatedAt: '2026-10-02T00:00:00.000Z', viaFleet: false,
      untrusted: { title: 'A fixture title', description: 'A fixture description', descriptionTruncated: false },
    } });
  });

  it('search, comments, statuses, projects, labels and users: one call each, a list with next', async () => {
    const r = await open();
    for (const v of ['search', 'comments', 'statuses', 'projects', 'labels', 'users'] as const) {
      const before = r.calls.length;
      const res = await r.call(v);
      expect(res.statusCode, `${v} ${res.body}`).toBe(200);
      expect(r.calls.length - before, v).toBe(1);
      const b = bodyOf(res);
      expect(Array.isArray(b['items']), v).toBe(true);
      expect((b['items'] as unknown[]).length, v).toBe(1);
      expect(b['next'], v).toBeNull();
    }
    expect(r.rows(), 'a read is not journaled').toEqual([]);
  });

  it('create: one mutation, the issue answered, the provenance line on its description, the row ok with the identifier', async () => {
    const r = await open();
    const res = await r.call('create', { body: { team: 'AAA', title: 'A fixture title', description: 'Some text.' } });
    expect(res.statusCode, res.body).toBe(200);
    expect(r.calls.map((c) => c.op)).toEqual(['IssueCreate']);
    const input = r.calls[0]!.variables['input'] as Record<string, unknown>;
    expect(input['teamId']).toBe(WS.a.teams[0].id);
    expect(input['description']).toBe(`Some text.\n\n${LINEAR_PROVENANCE_LINE}`);
    expect((bodyOf(res)['issue'] as Record<string, unknown>)['identifier']).toBe('AAA-100');
    expect(r.rows()).toMatchObject([{ op: 'create', outcome: 'ok', result: 'AAA-100', teamKey: 'AAA', sessionId: 'project-a-calm-mesa',
      workspaceId: WS.a.id, fields: 'team,title,description', target: null }]);
  });

  it('update: the resolve, then the mutation on the resolved UUID; the row names the resolved team and identifier', async () => {
    const r = await open();
    const res = await r.call('update', { ref: 'AAA-12', body: { title: 'A new title' } });
    expect(res.statusCode, res.body).toBe(200);
    expect(r.calls.map((c) => c.op)).toEqual(['ResolveIssue', 'IssueUpdate']);
    expect(r.calls[1]!.variables['id']).toBe(IDS.issue);
    expect(r.rows()).toMatchObject([{ op: 'update', outcome: 'ok', teamKey: 'AAA', target: 'AAA-12', fields: 'title', result: null }]);
  });

  it('comment: the resolve, then commentCreate on the resolved id, the provenance line appended; the row holds the comment id', async () => {
    const r = await open();
    const res = await r.call('comment', { ref: 'AAA-12', body: { body: 'A note.' } });
    expect(res.statusCode, res.body).toBe(200);
    expect(bodyOf(res)).toEqual({ ok: true, comment: { createdAt: '2026-10-02T00:00:00.000Z' } });
    expect(r.calls.map((c) => c.op)).toEqual(['ResolveIssue', 'CommentCreate']);
    const input = r.calls[1]!.variables['input'] as Record<string, unknown>;
    expect(input).toEqual({ issueId: IDS.issue, body: `A note.\n\n${LINEAR_PROVENANCE_LINE}` });
    expect(r.rows()).toMatchObject([{ op: 'comment', outcome: 'ok', result: IDS.comment, target: 'AAA-12' }]);
  });

  it('a write and a search answer masked when linear-egress changed the text sent, and the row counts it', async () => {
    const r = await open();
    const secret = `GH_TOKEN=${'x1'.repeat(20)}`;
    const res = await r.call('comment', { ref: 'AAA-12', body: { body: `See ${secret}` } });
    expect(bodyOf(res)['masked']).toBe(1);
    expect(r.calls[1]!.body).not.toContain('x1x1x1x1');
    expect(r.rows()[0]).toMatchObject({ masked: 1 });
    const s = await r.call('search', { body: { team: 'AAA', text: `find ${secret}` } });
    expect(bodyOf(s)['masked']).toBe(1);
    const plain = await r.call('comment', { ref: 'AAA-12', body: { body: 'nothing to mask' } });
    expect(bodyOf(plain)).not.toHaveProperty('masked');
  });

  it('a route\'s class is its row\'s: search is a POST and a read, so it asks no policy and writes no row', async () => {
    let asked = 0;
    const r = await open({ policy: async () => { asked += 1; return { allow: true, decisionId: null }; } });
    expect((await r.call('search')).statusCode).toBe(200);
    expect(asked).toBe(0);
    expect(r.rows()).toEqual([]);
  });

  it.todo('FX (D-7684): each verb\'s happy path against the coordinator\'s recorded fixtures, byte for byte (`slug linear-fx-proxy-happy-paths`)');
});

describe('failure words and their statuses (spec §6.8)', () => {
  /** One read and one write, through the arm that `respond` produces on the operation's call. */
  const opCall = (op: string, answer: Parameters<typeof statusAnswer>): Parameters<typeof proxyRig>[0] =>
    ({ respond: (c) => (c.op === op ? statusAnswer(...answer) : null) });

  it('Linear\'s 401 is linear-unauthorised (502), and the file slot is marked rejected by the digest it used', async () => {
    const r = await open(opCall('Issue', [401]));
    const res = await r.call('issue');
    expect(res.statusCode).toBe(502);
    expect(bodyOf(res)['error']).toBe('linear-unauthorised');
    const store = await readLinearStore(r.ccrcDir);
    expect(store.kind === 'listed' && store.slots[0]!.record.kind === 'details' && store.slots[0]!.record.details.outcome).toBe('rejected');
  });

  it('a success with the same key clears that slot\'s stale verdict', async () => {
    let refuse = true;
    const r = await open({ respond: (c) => (c.op === 'Issue' && refuse ? statusAnswer(401) : null) });
    await r.call('issue');
    const outcome = async (): Promise<unknown> => {
      const store = await readLinearStore(r.ccrcDir);
      return store.kind === 'listed' && store.slots[0]!.record.kind === 'details' ? store.slots[0]!.record.details.outcome : null;
    };
    expect(await outcome()).toBe('rejected');
    refuse = false;
    expect((await r.call('issue')).statusCode).toBe(200);
    expect(await outcome()).toBe('ok');
  });

  it('Linear\'s 403 is linear-forbidden (403), and nothing is marked', async () => {
    const r = await open(opCall('Issue', [403]));
    const res = await r.call('issue');
    expect([res.statusCode, bodyOf(res)['error']]).toEqual([403, 'linear-forbidden']);
    const store = await readLinearStore(r.ccrcDir);
    expect(store.kind === 'listed' && store.slots[0]!.record.kind === 'details' && store.slots[0]!.record.details.outcome).toBe('ok');
  });

  it('Linear\'s 429, and RATELIMITED on a 200, are rate-limited (429) linear, with Retry-After', async () => {
    const r = await open(opCall('Issue', [429, { 'retry-after': '30' }]));
    const res = await r.call('issue');
    expect([res.statusCode, bodyOf(res)['error'], bodyOf(res)['detail']]).toEqual([429, 'rate-limited', 'linear']);
    expect(res.headers['retry-after']).toBe('30');
    const again = await r.call('issue');
    expect(bodyOf(again)['detail'], 'the slot is closed after Linear\'s own refusal').toBe('linear');
    expect(r.calls.length, 'no call reaches Linear while the slot is closed').toBe(1);
    await r.close();
    rig = null;
    const r2 = await open({ respond: (c) => (c.op === 'Issue' ? { body: RATELIMITED_ERRORS } : null) });
    const res2 = await r2.call('issue');
    expect([res2.statusCode, bodyOf(res2)['detail']]).toEqual([429, 'linear']);
    expect(res2.headers['retry-after']).toBe('60');
  });

  it('a 500 is unreachable, an answer out of its grammar malformed, and a deadline timeout: each 503', async () => {
    for (const [respond, word] of [
      [() => statusAnswer(500), 'unreachable'],
      [() => ({ body: { data: { issue: { identifier: 12 } } } }), 'malformed'],
      [(c: { op: string }) => (c.op === 'Issue' ? new Promise<never>(() => {}) : null), 'timeout'],
    ] as const) {
      const r = await open({ respond: respond as never, timeoutMs: 30 });
      const res = await r.call('issue');
      expect([res.statusCode, bodyOf(res)['error']], word).toEqual([503, word]);
      await r.close();
      rig = null;
    }
  });

  it('an issue Linear does not find is not-found (404); a parent it does not find is not-found with the detail parent', async () => {
    const r = await open({ respond: (c) => (c.op === 'Issue' ? { body: { data: { issue: null } } }
      : c.op === 'ResolveParent' ? { body: { data: { parent: null } } } : null) });
    const res = await r.call('issue');
    expect([res.statusCode, bodyOf(res)['error']]).toEqual([404, 'not-found']);
    const c = await r.call('create', { body: { team: 'AAA', title: 'T', parent: 'AAA-9' } });
    expect([c.statusCode, bodyOf(c)['error'], bodyOf(c)['detail']]).toEqual([404, 'not-found', 'parent']);
    expect(r.calls.map((x) => x.op), 'no mutation after a missing parent').toEqual(['Issue', 'ResolveParent']);
    expect(r.rows()).toMatchObject([{ op: 'create', outcome: 'refused', code: 'not-found', target: 'AAA-9' }]);
  });

  it('routing: team-unknown refreshing with Retry-After 10, then unknown inside the window; no call, no row', async () => {
    rig = await proxyRig();
    const r = rig;
    await seedSlot(r.ccrcDir, 'a', { teamsAt: 0 });
    const res = await r.call('update', { ref: 'ZZZ-1' });
    expect([res.statusCode, bodyOf(res)['error'], bodyOf(res)['detail']]).toEqual([404, 'team-unknown', 'refreshing']);
    expect(res.headers['retry-after']).toBe('10');
    await r.fx.refresher.idle();
    const again = await r.call('update', { ref: 'ZZZ-1' });
    expect([again.statusCode, bodyOf(again)['detail']]).toEqual([404, 'unknown']);
    expect(r.calls.map((c) => c.op), 'only the background refresh asked Linear').toEqual(['KeyCheck']);
    expect(r.rows(), 'a refusal at routing gets no row').toEqual([]);
  });

  it('routing: team-ambiguous (409) lists the candidates\' URL keys; workspace-required (409); workspace-unknown (404)', async () => {
    const r = await open();
    await seedSlot(r.ccrcDir, 'b', { teams: [{ id: WS.b.teams[0].id, key: 'AAA', name: 'Team A in B' }] });
    const amb = await r.call('issue', { ref: 'AAA-1' });
    expect([amb.statusCode, bodyOf(amb)['error'], bodyOf(amb)['detail']]).toEqual([409, 'team-ambiguous', 'ws-a, ws-b']);
    const req = await r.call('users');
    expect([req.statusCode, bodyOf(req)['error']]).toEqual([409, 'workspace-required']);
    const unk = await r.call('users', { query: { workspace: 'ws-c' } });
    expect([unk.statusCode, bodyOf(unk)['error']]).toEqual([404, 'workspace-unknown']);
    const pinned = await r.call('issue', { ref: 'AAA-1', query: { workspace: 'ws-b' } });
    expect(pinned.statusCode, 'the remedy: --workspace').toBe(200);
    expect(r.calls.at(-1)!.authorization).toBe(WS.b.key);
    expect(r.rows()).toEqual([]);
  });

  it('not-configured (501): no slot at all; a legacy key not yet learned says to press Check again', async () => {
    rig = await proxyRig();
    const none = await rig.call('issue');
    expect([none.statusCode, bodyOf(none)['error']]).toEqual([501, 'not-configured']);
    await seedLegacy(rig.ccrcDir, 'a', { learned: false });
    const legacy = await rig.call('issue');
    expect([legacy.statusCode, bodyOf(legacy)['error']]).toEqual([501, 'not-configured']);
    expect(String(bodyOf(legacy)['detail'])).toContain('Check again');
    expect(rig.calls).toEqual([]);
  });

  it('a learned legacy key routes, and its 401 marks nothing: the pair is the legacy routes\' alone', async () => {
    rig = await proxyRig({ respond: (c) => (c.op === 'Issue' ? statusAnswer(401) : null) });
    const key = await seedLegacy(rig.ccrcDir, 'a', { learned: true });
    const before = readFileSync(path.join(rig.ccrcDir, 'linear.json'), 'utf8');
    const res = await rig.call('issue');
    expect(bodyOf(res)['error']).toBe('linear-unauthorised');
    expect(rig.calls[0]!.authorization).toBe(key);
    expect(readFileSync(path.join(rig.ccrcDir, 'linear.json'), 'utf8')).toBe(before);
  });

  it('names: name-unknown refreshing with Retry-After when the directory lacks it; name-ambiguous lists the matches', async () => {
    const r = await open({ respond: (c) => (c.op === 'DirectoryLabels' ? { body: { data: { issueLabels: { nodes: [
      { id: 'eeeeeeee-0000-4000-8000-0000000000f1', name: 'Dup', team: null },
      { id: 'eeeeeeee-0000-4000-8000-0000000000f2', name: 'dup', team: { key: 'AAA' } },
    ], pageInfo: { hasNextPage: false, endCursor: null } } } } } : null) });
    const miss = await r.call('create', { body: { team: 'AAA', title: 'T', labels: ['Dup'] } });
    expect([miss.statusCode, bodyOf(miss)['error'], bodyOf(miss)['detail'], bodyOf(miss)['field']]).toEqual([404, 'name-unknown', 'refreshing', 'labels']);
    expect(miss.headers['retry-after']).toBe('10');
    await r.fx.refresher.idle();
    const amb = await r.call('create', { body: { team: 'AAA', title: 'T', labels: ['Dup'] } });
    expect([amb.statusCode, bodyOf(amb)['error']]).toEqual([409, 'name-ambiguous']);
    expect(bodyOf(amb)['detail']).toBe('labels: Dup, dup (AAA)');
    expect(r.calls.some((c) => c.op === 'IssueCreate'), 'no mutation was sent').toBe(false);
    expect(r.rows().map((x) => [x['outcome'], x['code']])).toEqual([['refused', 'name-unknown'], ['refused', 'name-ambiguous']]);
  });

  it('bad-field (400) names the field: an unknown one, byId in a body, workspace in a body', async () => {
    const r = await open();
    for (const [body, field] of [[{ body: 'x', extra: 1 }, 'extra'], [{ body: 'x', byId: 'project-a-calm-mesa' }, 'byId'],
      [{ body: 'x', workspace: 'ws-a' }, 'workspace']] as const) {
      const res = await r.call('comment', { body });
      expect([res.statusCode, bodyOf(res)['error'], bodyOf(res)['detail']]).toEqual([400, 'bad-field', field]);
    }
    expect(r.calls).toEqual([]);
  });

  it('issue-moved (409): a write whose identifier now lives in another team gives the current one, and sends no mutation', async () => {
    const r = await open({ respond: (c) => (c.op === 'ResolveIssue'
      ? { body: { data: { issue: { id: IDS.issue, identifier: 'BBB-7', team: { id: WS.a.teams[0].id, key: 'BBB' } } } } } : null) });
    const res = await r.call('comment', { ref: 'AAA-12' });
    expect([res.statusCode, bodyOf(res)['error'], bodyOf(res)['detail']]).toEqual([409, 'issue-moved', 'BBB-7']);
    expect(r.calls.map((c) => c.op)).toEqual(['ResolveIssue']);
    expect(r.rows()).toMatchObject([{ outcome: 'refused', code: 'issue-moved', teamKey: 'BBB', target: 'BBB-7' }]);
  });

  it('a read of a moved issue answers it with its current identifier and team', async () => {
    const r = await open({ respond: (c) => (c.op === 'Issue' ? { body: { data: { issue: issueNode('BBB-7') } } } : null) });
    const res = await r.call('issue', { ref: 'AAA-12' });
    expect(res.statusCode).toBe(200);
    expect(bodyOf(res)['issue']).toMatchObject({ identifier: 'BBB-7', team: 'BBB' });
  });

  it('policy-denied (403) and policy-unavailable (503): each journaled, no mutation sent', async () => {
    for (const [policy, status, word, outcome] of [
      [async () => ({ allow: false, why: 'denied', decisionId: 'd-1' }), 403, 'policy-denied', 'denied'],
      [async () => { throw new Error('down'); }, 503, 'policy-unavailable', 'refused'],
    ] as const) {
      const r = await open({ policy: policy as never });
      const res = await r.call('create');
      expect([res.statusCode, bodyOf(res)['error']]).toEqual([status, word]);
      expect(r.calls).toEqual([]);
      expect(r.rows()).toMatchObject([{ outcome, code: word }]);
      await r.close();
      rig = null;
    }
  });

  it('journal-unavailable (503): a journal that cannot write refuses the write before the mutation', async () => {
    const db = memCoordDb();
    const r = await open({ db });
    db.exec('DROP TABLE linear_events');
    const res = await r.call('comment', { ref: 'AAA-12' });
    expect([res.statusCode, bodyOf(res)['error']]).toEqual([503, 'journal-unavailable']);
    expect(r.calls.map((c) => c.op), 'only the read-only resolve ran').toEqual(['ResolveIssue']);
  });

  it.each(['rate', 'refresher', 'journal', 'policy'] as const)('an absent %s: every route that needs it answers linear-unavailable, no call', async (svc) => {
    const r = await open({ absent: [svc] });
    for (const v of CALLING) {
      const needs = svc !== 'policy' || LINEAR_OPS[v].class === 'write';
      const res = await r.call(v);
      if (needs) expect([res.statusCode, bodyOf(res)['error']], v).toEqual([503, 'linear-unavailable']);
      else expect(res.statusCode, v).toBe(200);
    }
    for (const v of ['workspaces', 'teams'] as const) expect((await r.call(v)).statusCode, v).toBe(200);
    if (svc !== 'policy') expect(r.calls).toEqual([]);
    else expect(r.calls.every((c) => !/^(IssueCreate|IssueUpdate|CommentCreate)$/.test(c.op))).toBe(true);
    expect(r.rows()).toEqual([]);
  });

  it('every word the proxy answers has the status spec §6.8 gives it', () => {
    expect({
      'bad-field': REFUSAL_STATUS['bad-field'], 'team-unknown': REFUSAL_STATUS['team-unknown'],
      'workspace-unknown': REFUSAL_STATUS['workspace-unknown'], 'name-unknown': REFUSAL_STATUS['name-unknown'],
      'team-ambiguous': REFUSAL_STATUS['team-ambiguous'], 'workspace-required': REFUSAL_STATUS['workspace-required'],
      'name-ambiguous': REFUSAL_STATUS['name-ambiguous'], 'not-found': REFUSAL_STATUS['not-found'],
      'issue-moved': REFUSAL_STATUS['issue-moved'], 'not-configured': REFUSAL_STATUS['not-configured'],
      'policy-denied': REFUSAL_STATUS['policy-denied'], 'policy-unavailable': REFUSAL_STATUS['policy-unavailable'],
      'journal-unavailable': REFUSAL_STATUS['journal-unavailable'], 'linear-unauthorised': REFUSAL_STATUS['linear-unauthorised'],
      'linear-forbidden': REFUSAL_STATUS['linear-forbidden'], 'linear-invalid': REFUSAL_STATUS['linear-invalid'],
      'rate-limited': REFUSAL_STATUS['rate-limited'], timeout: REFUSAL_STATUS.timeout, unreachable: REFUSAL_STATUS.unreachable,
      malformed: REFUSAL_STATUS.malformed, unauthenticated: REFUSAL_STATUS.unauthenticated,
      'unknown-sender': REFUSAL_STATUS['unknown-sender'], 'stale-uuid': REFUSAL_STATUS['stale-uuid'],
      'registry-unmeasurable': REFUSAL_STATUS['registry-unmeasurable'], 'bad-request': REFUSAL_STATUS['bad-request'],
    }).toEqual({
      'bad-field': 400, 'team-unknown': 404, 'workspace-unknown': 404, 'name-unknown': 404, 'team-ambiguous': 409,
      'workspace-required': 409, 'name-ambiguous': 409, 'not-found': 404, 'issue-moved': 409, 'not-configured': 501,
      'policy-denied': 403, 'policy-unavailable': 503, 'journal-unavailable': 503, 'linear-unauthorised': 502,
      'linear-forbidden': 403, 'linear-invalid': 422, 'rate-limited': 429, timeout: 503, unreachable: 503, malformed: 503,
      unauthenticated: 401, 'unknown-sender': 403, 'stale-uuid': 403, 'registry-unmeasurable': 502, 'bad-request': 400,
    });
  });

  it.todo('FX (D-7684): Linear\'s recorded error codes for an invalid input, a forbidden team and a missing entity answer linear-invalid (422), linear-forbidden (403) and not-found (404) (`slug linear-fx-error-codes`)');
});

describe('a refusal never forwards Linear\'s text', () => {
  it('an errors answer with a message is unreachable, and the message is in no answer', async () => {
    const r = await open({ respond: () => ({ body: { errors: [{ message: 'canary-message-from-linear', extensions: { code: 'SOMETHING' } }] } }) });
    for (const v of CALLING) {
      const res = await r.call(v);
      expect(res.body, v).not.toContain('canary-message-from-linear');
    }
  });
});

describe('the routes the PWA never calls take no body they do not declare', () => {
  it.each(WRITES)('%s refuses a body that is not a JSON object as bad-request', async (v: LinearVerb) => {
    const r = await open();
    const res = await r.app.inject({ method: 'POST', url: `${proxyUrl(v)}?byId=project-a-calm-mesa&byUuid=u-project-a-calm-mesa`,
      headers: { 'x-ccrc-mail-token': 'e'.repeat(64), 'content-type': 'application/json' }, payload: '[1]' });
    expect([res.statusCode, bodyOf(res)['error']]).toEqual([400, 'bad-request']);
    expect(BODIES[v]).toBeDefined();
  });
});

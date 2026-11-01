// Workspace routing (#1444, D-7668; spec 2026-10-31 §4.1 to §4.3, §14 row 3; plan task LK3).
//
// The router (`linear/route.ts`, L1, pure): every row of spec §4.2's table, team keys compared uppercased, and never
// the first of two matches. Its input is what the store read (`readLinearStore`) makes routable: every file slot, and
// the legacy slot only once its Check again has learned its workspace and no file slot holds that workspace (§3.4).
// Below it, the key check (§4.1): one document, at most two pages, the key read again before each page. Nothing here
// reaches the network: every Linear answer is a stub in the shape the §4.1 document asks for.
import { describe, expect, it } from 'vitest';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import type { LinearStoreRecord } from '../../shared/linear.js';
import { LINEAR_TEAM_PAGE_SIZE, checkLinearKey, verifyLinearKey, type FetchLike } from '../src/linear/client.js';
import { keyTailOf, type LinearKeyRead } from '../src/linear/connection.js';
import type { LinearRateService } from '../src/linear/rate.js';
import { LINEAR_MISS_RETRY_AFTER_S, checkLinearSlot } from '../src/linear/refresher.js';
import { routableSlots, routeLinear, type LinearRoute, type LinearRouteAsk, type LinearRouteSlot } from '../src/linear/route.js';
import { putLinearSlot, readLinearStore, type LinearFileSlot, type LinearLegacySlot, type LinearSlotRef, type LinearStoreRead } from '../src/linear/store.js';
import { valueDigestHex } from '../src/token/files.js';
import { linearAnswer, type LinearAnswer } from './linearFetchFake.js';
import { linearServicesFake } from './linearServicesFake.js';
import { mkTmp, removeTmpFixturesEachTest } from './tmpHelpers.js';

removeTmpFixturesEachTest();

const WS_A = 'aaaaaaaa-0000-4000-8000-000000000001';
const WS_B = 'bbbbbbbb-0000-4000-8000-000000000002';
const WS_L = 'cccccccc-0000-4000-8000-000000000003';
const DIGEST_A = 'a'.repeat(64);
const DIGEST_B = 'b'.repeat(64);
const team = (key: string, n: number): { id: string; key: string; name: string } =>
  ({ id: `dddddddd-0000-4000-8000-00000000000${n}`, key, name: `Team ${key}` });

/** A routable slot as the router reads it. */
const slot = (id: string, urlKey: string | null, teamKeys: string[]): LinearRouteSlot =>
  ({ ref: { source: 'file', id }, workspaceId: id, urlKey, teamKeys });
const A = slot(WS_A, 'ws-a', ['AAA']);
const B = slot(WS_B, 'ws-b', ['BBB']);

const issue = (prefix: string, workspace: string | null = null): LinearRouteAsk => ({ kind: 'issue', prefix, workspace });
const byTeam = (t: string, workspace: string | null = null): LinearRouteAsk => ({ kind: 'team', team: t, workspace });
const byWorkspace = (workspace: string | null): LinearRouteAsk => ({ kind: 'workspace', workspace });
const routedTo = (r: LinearRoute): string => (r.kind === 'slot' ? r.slot.workspaceId ?? 'legacy' : `refused:${r.word}`);

describe('the routing rule (spec §4.2), row by row', () => {
  it('an issue reference and a workspace: that workspace\'s slot, whatever the prefix', () => {
    expect(routedTo(routeLinear([A, B], issue('BBB', 'ws-a')))).toBe(WS_A);
    expect(routedTo(routeLinear([A, B], issue('ZZZ', 'ws-b')))).toBe(WS_B);
    // A prefix two workspaces share is reached through the workspace.
    expect(routedTo(routeLinear([A, slot(WS_B, 'ws-b', ['AAA'])], issue('AAA', 'ws-b')))).toBe(WS_B);
    expect(routedTo(routeLinear([A, B], issue('AAA', 'ws-zz')))).toBe('refused:workspace-unknown');
  });

  it('a team, or an issue prefix, held by exactly one slot: that slot, compared uppercased', () => {
    expect(routedTo(routeLinear([A, B], byTeam('BBB')))).toBe(WS_B);
    expect(routedTo(routeLinear([A, B], byTeam('bbb')))).toBe(WS_B);
    expect(routedTo(routeLinear([A, B], issue('aaa')))).toBe(WS_A);
    expect(routedTo(routeLinear([slot(WS_A, 'ws-a', ['Aaa'])], byTeam('aAA')))).toBe(WS_A);
  });

  it('a team and a workspace: the slot when it holds the team, team-unknown when it lacks it', () => {
    expect(routedTo(routeLinear([A, B], byTeam('aaa', 'ws-a')))).toBe(WS_A);
    expect(routedTo(routeLinear([A, B], byTeam('BBB', 'ws-a')))).toBe('refused:team-unknown');
    expect(routedTo(routeLinear([A, B], byTeam('AAA', 'ws-zz')))).toBe('refused:workspace-unknown');
  });

  it('a team two slots hold: team-ambiguous with both URL keys, never the first match, in any order', () => {
    const B2 = slot(WS_B, 'ws-b', ['BBB', 'AAA']);
    for (const slots of [[A, B2], [B2, A]]) {
      for (const ask of [byTeam('AAA'), issue('aaa')]) {
        expect(routeLinear(slots, ask)).toEqual({ kind: 'refused', word: 'team-ambiguous', candidates: ['ws-a', 'ws-b'] });
      }
      // `--workspace` is the remedy, for a team and for an issue reference alike.
      expect(routedTo(routeLinear(slots, byTeam('AAA', 'ws-b')))).toBe(WS_B);
      expect(routedTo(routeLinear(slots, issue('AAA', 'ws-a')))).toBe(WS_A);
    }
  });

  it('a team no slot holds: team-unknown at once', () => {
    expect(routeLinear([A, B], byTeam('ZZZ'))).toEqual({ kind: 'refused', word: 'team-unknown' });
    expect(routeLinear([A, B], issue('ZZZ'))).toEqual({ kind: 'refused', word: 'team-unknown' });
  });

  it('a workspace only: its slot, or workspace-unknown', () => {
    expect(routedTo(routeLinear([A, B], byWorkspace('ws-b')))).toBe(WS_B);
    expect(routedTo(routeLinear([A, B], byWorkspace('ws-zz')))).toBe('refused:workspace-unknown');
    // A slot whose URL key is not known is reached by no workspace name.
    expect(routedTo(routeLinear([slot(WS_A, null, [])], byWorkspace('ws-a')))).toBe('refused:workspace-unknown');
  });

  it('two slots claiming one URL key are never chosen between', () => {
    const twin = slot(WS_B, 'ws-a', ['BBB']);
    expect(routedTo(routeLinear([A, twin], byWorkspace('ws-a')))).toBe('refused:workspace-required');
    expect(routedTo(routeLinear([twin, A], issue('AAA', 'ws-a')))).toBe('refused:workspace-required');
  });

  it('neither a team nor a workspace: the one slot, or workspace-required when there are several', () => {
    expect(routedTo(routeLinear([B], byWorkspace(null)))).toBe(WS_B);
    expect(routedTo(routeLinear([A, B], byWorkspace(null)))).toBe('refused:workspace-required');
  });

  it('a store with nothing routable: not-configured, whatever the call names', () => {
    for (const ask of [issue('AAA'), issue('AAA', 'ws-a'), byTeam('AAA'), byTeam('AAA', 'ws-a'), byWorkspace('ws-a'), byWorkspace(null)]) {
      expect(routeLinear([], ask), JSON.stringify(ask)).toEqual({ kind: 'refused', word: 'not-configured' });
    }
  });
});

// What the store read makes routable (§3.4: no migration, and the legacy slot only once it is learned).

const record = (id: string, digest: string, over: Partial<LinearStoreRecord> = {}): LinearStoreRecord => ({
  workspaceId: id, name: 'Workspace', urlKey: id === WS_A ? 'ws-a' : 'ws-b', user: 'user-a', teams: [team('aaa', 1)],
  teamsAt: 1, keyTail: 'tail', keyDigest: digest, checkedAt: 1, outcome: 'ok', ...over,
});
const fileSlot = (id: string, keyDigest: string | null, rec: LinearFileSlot['record']): LinearFileSlot => ({
  source: 'file', id, key: keyDigest === null ? { kind: 'unreadable', code: 'EACCES' } : { kind: 'key', digest: keyDigest }, record: rec,
});
const legacy = (over: Partial<LinearLegacySlot> = {}): LinearLegacySlot => ({
  source: 'legacy', key: { kind: 'key', digest: DIGEST_B }, details: { kind: 'absent' },
  view: { state: 'details-unknown', why: 'absent' }, teamsFile: 'matched',
  workspace: { keyDigest: DIGEST_B, workspaceId: WS_L, name: 'Legacy', urlKey: 'ws-l', teams: [team('BBB', 2)], teamsAt: 1 },
  superseded: false, ...over,
});
const listed = (slots: LinearFileSlot[], leg: LinearLegacySlot | null): Extract<LinearStoreRead, { kind: 'listed' }> =>
  ({ kind: 'listed', slots, legacy: leg });

describe('routableSlots: what the store read can route', () => {
  it('a file slot routes by the URL key and the teams of a record that describes its present key, team keys uppercased', () => {
    expect(routableSlots(listed([fileSlot(WS_A, DIGEST_A, { kind: 'details', details: record(WS_A, DIGEST_A) })], null)))
      .toEqual([{ ref: { source: 'file', id: WS_A }, workspaceId: WS_A, urlKey: 'ws-a', teamKeys: ['AAA'] }]);
  });

  it('a file slot whose record is absent, malformed, unreadable or of another key, or whose key cannot be read, is a slot with nothing learned', () => {
    const recs: LinearFileSlot['record'][] = [
      { kind: 'absent' }, { kind: 'malformed' }, { kind: 'unreadable', code: 'EACCES' }, { kind: 'details', details: record(WS_A, DIGEST_B) },
    ];
    for (const rec of recs) {
      expect(routableSlots(listed([fileSlot(WS_A, DIGEST_A, rec)], null)), rec.kind)
        .toEqual([{ ref: { source: 'file', id: WS_A }, workspaceId: WS_A, urlKey: null, teamKeys: [] }]);
    }
    expect(routableSlots(listed([fileSlot(WS_A, null, { kind: 'details', details: record(WS_A, DIGEST_A) })], null)))
      .toEqual([{ ref: { source: 'file', id: WS_A }, workspaceId: WS_A, urlKey: null, teamKeys: [] }]);
  });

  it('the legacy slot routes only once learned, and never while a file slot holds its workspace', () => {
    expect(routableSlots(listed([], legacy())))
      .toEqual([{ ref: { source: 'legacy' }, workspaceId: WS_L, urlKey: 'ws-l', teamKeys: ['BBB'] }]);
    expect(routableSlots(listed([], legacy({ teamsFile: 'stale', workspace: null })))).toEqual([]);
    expect(routableSlots(listed([], legacy({ teamsFile: 'absent', workspace: null })))).toEqual([]);
    expect(routableSlots(listed([], legacy({ superseded: true })))).toEqual([]);
    expect(routableSlots(listed([], null))).toEqual([]);
  });

  it('a store with only an unlearned legacy key routes nothing: not-configured', () => {
    const slots = routableSlots(listed([], legacy({ teamsFile: 'absent', workspace: null })));
    expect(routeLinear(slots, issue('BBB'))).toEqual({ kind: 'refused', word: 'not-configured' });
  });

  it('a learned legacy slot and a file slot route side by side, each by its own teams', () => {
    const slots = routableSlots(listed([fileSlot(WS_A, DIGEST_A, { kind: 'details', details: record(WS_A, DIGEST_A) })], legacy()));
    expect(routeLinear(slots, issue('BBB'))).toMatchObject({ kind: 'slot', slot: { ref: { source: 'legacy' } } });
    expect(routeLinear(slots, issue('AAA'))).toMatchObject({ kind: 'slot', slot: { ref: { source: 'file', id: WS_A } } });
    expect(routeLinear(slots, byWorkspace(null))).toEqual({ kind: 'refused', word: 'workspace-required' });
  });
});

// ---------------------------------------------------------------------------
// The key check (spec §4.1): one query, at most two pages, the key read again from its file before each page.
// ---------------------------------------------------------------------------

const KEY_1 = 'lin_api_fixture_route_key_0001';
const KEY_2 = 'lin_api_fixture_route_key_0002';
interface Sent { auth: string; query: string; variables: Record<string, unknown> }
type PageTeam = { id: string; key: string; name: string };
const ORG_A = { id: WS_A, name: 'Workspace A', urlKey: 'ws-a' };

/** A key-check answer in the shape the §4.1 document asks for: the viewer, the organization and one page of teams. */
const keyPage = (teams: PageTeam[], next: string | null = null, org: Record<string, unknown> = ORG_A): LinearAnswer =>
  linearAnswer({
    ok: true, status: 200,
    json: async () => ({ data: { viewer: { name: 'user-a' }, organization: org, teams: { nodes: teams, pageInfo: { hasNextPage: next !== null, endCursor: next } } } }),
  });
const teamsOf = (from: number, n: number): PageTeam[] => Array.from({ length: n }, (_v, i) => {
  const k = from + i;
  return { id: `eeeeeeee-0000-4000-8000-${String(k).padStart(12, '0')}`, key: `T${k}`, name: `Team ${k}` };
});

/** A Linear stand-in answering `answers` in order, recording what each call sent. */
const scripted = (answers: Array<LinearAnswer | (() => Promise<LinearAnswer>)>): { f: FetchLike; sent: Sent[] } => {
  const sent: Sent[] = [];
  const f: FetchLike = async (_u, init) => {
    const b = JSON.parse(init.body) as { query: string; variables: Record<string, unknown> };
    sent.push({ auth: init.headers['authorization'] ?? '', query: b.query, variables: b.variables });
    const a = answers[sent.length - 1];
    if (a === undefined) throw new Error('scripted: no answer left');
    return typeof a === 'function' ? a() : a;
  };
  return { f, sent };
};
/** A key "file" the test can change between pages, and how often the check read it. */
const keyHolder = (k: LinearKeyRead = { kind: 'key', key: KEY_1 }): { read: () => Promise<LinearKeyRead>; set: (k: LinearKeyRead) => void; reads: () => number } => {
  let cur = k;
  let n = 0;
  return { read: async () => { n += 1; return cur; }, set: (next) => { cur = next; }, reads: () => n };
};

describe('the key check (spec §4.1)', () => {
  it('is one document: the viewer, the organization\'s id, name and URL key, and one page of teams', async () => {
    expect(LINEAR_TEAM_PAGE_SIZE).toBe(250);
    const { f, sent } = scripted([keyPage(teamsOf(1, 2))]);
    const k = keyHolder();
    const r = await checkLinearKey(k.read, { fetch: f, mayAskMore: () => true });
    expect(sent).toHaveLength(1);
    const q = sent[0]!.query.replace(/\s+/g, ' ');
    expect(q).toContain('viewer { name }');
    expect(q).toContain('organization { id name urlKey }');
    expect(q).toContain(`teams(first: ${LINEAR_TEAM_PAGE_SIZE}, after: $after) { nodes { id key name } pageInfo { hasNextPage endCursor } }`);
    expect(sent[0]!.variables).toEqual({ after: null });
    expect(sent[0]!.auth).toBe(KEY_1);
    expect(r).toEqual({
      ok: true, org: 'Workspace A', user: 'user-a', keyDigest: valueDigestHex(KEY_1), pagesSent: 1,
      workspace: { id: WS_A, name: 'Workspace A', urlKey: 'ws-a', teams: teamsOf(1, 2), more: false },
    });
  });

  it('asks one more page, with the cursor, when Linear says there is one, and keeps both pages\' teams', async () => {
    const { f, sent } = scripted([keyPage(teamsOf(1, 250), 'cursor-1'), keyPage(teamsOf(251, 3))]);
    const r = await checkLinearKey(keyHolder().read, { fetch: f, mayAskMore: () => true });
    expect(sent.map((s) => s.variables)).toEqual([{ after: null }, { after: 'cursor-1' }]);
    expect(r).toMatchObject({ ok: true, pagesSent: 2, workspace: { teams: teamsOf(1, 253), more: false } });
  });

  it('never asks a third page: past two pages the first 500 are kept and more is said', async () => {
    const { f, sent } = scripted([keyPage(teamsOf(1, 250), 'cursor-1'), keyPage(teamsOf(251, 250), 'cursor-2')]);
    const r = await checkLinearKey(keyHolder().read, { fetch: f, mayAskMore: () => true });
    expect(sent).toHaveLength(2);
    expect(r).toMatchObject({ ok: true, pagesSent: 2, workspace: { more: true } });
    expect(r.ok && r.workspace?.teams.length).toBe(500);
  });

  it('reads the key again before each page, and stops when it is gone or its digest changed', async () => {
    for (const after of [{ kind: 'absent' } as const, { kind: 'key', key: KEY_2 } as const]) {
      const k = keyHolder();
      const { f, sent } = scripted([async () => { k.set(after); return keyPage(teamsOf(1, 250), 'cursor-1'); }, keyPage(teamsOf(251, 1))]);
      const r = await checkLinearKey(k.read, { fetch: f, mayAskMore: () => true });
      expect(sent, after.kind).toHaveLength(1);
      expect(k.reads()).toBe(2);
      expect(r).toEqual({ ok: false, reason: 'key-changed', keyDigest: valueDigestHex(KEY_1), pagesSent: 1 });
    }
    const gone = keyHolder({ kind: 'absent' });
    const none = scripted([]);
    expect(await checkLinearKey(gone.read, { fetch: none.f })).toEqual({ ok: false, reason: 'key-changed', keyDigest: null, pagesSent: 0 });
    expect(none.sent).toHaveLength(0);
  });

  it('learns nothing it cannot have whole: a second page not granted, or a team out of its grammar, keeps the names only', async () => {
    const one = scripted([keyPage(teamsOf(1, 250), 'cursor-1')]);
    expect(await checkLinearKey(keyHolder().read, { fetch: one.f, mayAskMore: () => false }))
      .toMatchObject({ ok: true, org: 'Workspace A', workspace: null, pagesSent: 1 });
    expect(one.sent).toHaveLength(1);
    // With no way to ask for more (a pasted key's verify), the first page alone is never taken for the whole.
    const solo = scripted([keyPage(teamsOf(1, 250), 'cursor-1')]);
    expect(await checkLinearKey(keyHolder().read, { fetch: solo.f })).toMatchObject({ ok: true, workspace: null, pagesSent: 1 });
    const bad: PageTeam[][] = [
      [{ id: 'not-a-uuid', key: 'AAA', name: 'Team A' }], [{ ...teamsOf(1, 1)[0]!, key: '1A' }], [{ ...teamsOf(1, 1)[0]!, name: '\u0001' }],
      [teamsOf(1, 1)[0]!, { ...teamsOf(2, 1)[0]!, key: 'T1' }],
    ];
    for (const teams of bad) {
      const s = scripted([keyPage(teams)]);
      expect(await checkLinearKey(keyHolder().read, { fetch: s.f }), JSON.stringify(teams)).toMatchObject({ ok: true, workspace: null });
    }
    for (const org of [{ ...ORG_A, id: 'x' }, { ...ORG_A, urlKey: 'WS A' }, { name: 'Workspace A' }]) {
      const s = scripted([keyPage(teamsOf(1, 1), null, org)]);
      expect(await checkLinearKey(keyHolder().read, { fetch: s.f }), JSON.stringify(org)).toMatchObject({ ok: true, org: 'Workspace A', workspace: null });
    }
    // A second page that names another organization is not this workspace's.
    const moved = scripted([keyPage(teamsOf(1, 250), 'cursor-1'), keyPage(teamsOf(251, 1), null, { ...ORG_A, id: WS_B })]);
    expect(await checkLinearKey(keyHolder().read, { fetch: moved.f, mayAskMore: () => true })).toMatchObject({ ok: true, workspace: null, pagesSent: 2 });
  });

  it('a failed page is the check\'s failure, with the key\'s digest and the pages it sent', async () => {
    const first = scripted([linearAnswer({ ok: false, status: 401, json: async () => ({}) })]);
    expect(await checkLinearKey(keyHolder().read, { fetch: first.f }))
      .toEqual({ ok: false, reason: 'unauthorised', keyDigest: valueDigestHex(KEY_1), pagesSent: 1 });
    const second = scripted([keyPage(teamsOf(1, 250), 'cursor-1'), linearAnswer({ ok: false, status: 429, headers: { 'retry-after': '30' }, json: async () => ({}) })]);
    expect(await checkLinearKey(keyHolder().read, { fetch: second.f, mayAskMore: () => true }))
      .toEqual({ ok: false, reason: 'rate-limited', retryAfterS: 30, keyDigest: valueDigestHex(KEY_1), pagesSent: 2 });
  });

  it('verifyLinearKey, the pasted key\'s check, keeps its answer and asks one page', async () => {
    const { f, sent } = scripted([keyPage(teamsOf(1, 250), 'cursor-1')]);
    expect(await verifyLinearKey(KEY_1, { fetch: f })).toEqual({ ok: true, org: 'Workspace A', user: 'user-a', keyDigest: valueDigestHex(KEY_1) });
    expect(sent).toHaveLength(1);
  });

  it.todo('the key check page\'s recorded X-Complexity is under LINEAR_QUOTA.maxQueryComplexity (the FX capture records it; slug linear-fx-key-check-fixture)');
});

describe('checkLinearSlot: the key check through the one rate service', () => {
  const dir = (): string => {
    const d = path.join(mkTmp('ccrc-linear-route-'), '.ccrc');
    mkdirSync(d, { recursive: true });
    return d;
  };
  const putSlot = async (d: string, key: string): Promise<void> => {
    await putLinearSlot(d, key, {
      workspaceId: WS_A, name: 'Workspace A', urlKey: 'ws-a', user: 'user-a', teams: [], teamsAt: null,
      keyTail: keyTailOf(key), keyDigest: valueDigestHex(key), checkedAt: 1, outcome: 'ok',
    }, { replace: true });
  };
  const SLOT_A: LinearSlotRef = { source: 'file', id: WS_A };
  const lane = (rate: LinearRateService): number => {
    let n = 0;
    while (rate.take({ lane: 'floor', slot: SLOT_A, calls: 1 }).ok) n += 1;
    return n;
  };

  it('takes one call a page from the caller\'s lane, and gives back the page it did not need', async () => {
    const d = dir();
    await putSlot(d, KEY_1);
    const rate = linearServicesFake({ clock: () => 1 }).rate;
    const { f, sent } = scripted([keyPage(teamsOf(1, 2))]);
    const r = await checkLinearSlot({ ccrcDir: d, slot: SLOT_A, lane: 'floor', rate, fetch: f });
    expect(r).toMatchObject({ kind: 'checked', check: { ok: true, pagesSent: 1, workspace: { id: WS_A } } });
    expect(sent.map((s) => s.auth)).toEqual([KEY_1]);
    expect(lane(rate)).toBe(49);
  });

  it('reads the slot\'s key before each page: a replace between the pages stops the check', async () => {
    const d = dir();
    await putSlot(d, KEY_1);
    const rate = linearServicesFake({ clock: () => 1 }).rate;
    const { f, sent } = scripted([async () => { await putSlot(d, KEY_2); return keyPage(teamsOf(1, 250), 'cursor-1'); }]);
    const r = await checkLinearSlot({ ccrcDir: d, slot: SLOT_A, lane: 'floor', rate, fetch: f });
    expect(r).toEqual({ kind: 'checked', check: { ok: false, reason: 'key-changed', keyDigest: valueDigestHex(KEY_1), pagesSent: 1 } });
    expect(sent).toHaveLength(1);
    expect(lane(rate)).toBe(49);
  });

  it('a spent lane is refused before any call, and Linear\'s own rate limit closes the slot', async () => {
    const d = dir();
    await putSlot(d, KEY_1);
    const rate = linearServicesFake({ clock: () => 1 }).rate;
    lane(rate);
    const none = scripted([]);
    expect(await checkLinearSlot({ ccrcDir: d, slot: SLOT_A, lane: 'floor', rate, fetch: none.f }))
      .toMatchObject({ kind: 'refused', detail: 'workspace' });
    expect(none.sent).toHaveLength(0);
    const fresh = linearServicesFake({ clock: () => 1 }).rate;
    const limited = scripted([linearAnswer({ ok: false, status: 429, headers: { 'retry-after': '120' }, json: async () => ({}) })]);
    expect(await checkLinearSlot({ ccrcDir: d, slot: SLOT_A, lane: 'floor', rate: fresh, fetch: limited.f }))
      .toMatchObject({ kind: 'checked', check: { ok: false, reason: 'rate-limited', retryAfterS: 120 } });
    expect(fresh.take({ lane: 'proxy', slot: SLOT_A, calls: 1 })).toMatchObject({ ok: false, detail: 'linear' });
  });
});

// ---------------------------------------------------------------------------
// The background refresher (spec §4.3): a miss answers at once and queues; the queue runs after, a slot at a time,
// each slot at most once in five minutes, on the slot's floor.
// ---------------------------------------------------------------------------

describe('the background refresher (spec §4.3)', () => {
  const T = 1_800_000_000_000;
  const MIN = 60_000;
  const TEAM_AAA: PageTeam = { id: 'aaaaaaaa-1111-4000-8000-000000000001', key: 'AAA', name: 'Team A' };
  const TEAM_BBB: PageTeam = { id: 'bbbbbbbb-1111-4000-8000-000000000002', key: 'BBB', name: 'Team B' };
  const ORG_B = { id: WS_B, name: 'Workspace B', urlKey: 'ws-b' };

  interface Box {
    dir: string;
    clock: { now: number };
    fx: ReturnType<typeof linearServicesFake>;
    sent: Sent[];
    /** What Linear answers next, by the key it was asked with. */
    answers: Map<string, () => Promise<LinearAnswer>>;
  }
  const box = (): Box => {
    const dir = path.join(mkTmp('ccrc-linear-refresh-'), '.ccrc');
    mkdirSync(dir, { recursive: true });
    const clock = { now: T };
    const sent: Sent[] = [];
    const answers = new Map<string, () => Promise<LinearAnswer>>();
    const f: FetchLike = async (_u, init) => {
      const b = JSON.parse(init.body) as { query: string; variables: Record<string, unknown> };
      const auth = init.headers['authorization'] ?? '';
      sent.push({ auth, query: b.query, variables: b.variables });
      const a = answers.get(auth);
      if (a === undefined) throw new Error('box: no answer for that key');
      return a();
    };
    return { dir, clock, sent, answers, fx: linearServicesFake({ clock: () => clock.now, ccrcDir: dir, fetch: f }) };
  };
  const slotRecord = (id: string, key: string, over: Partial<LinearStoreRecord> = {}): LinearStoreRecord => ({
    workspaceId: id, name: 'Workspace', urlKey: id === WS_A ? 'ws-a' : 'ws-b', user: 'user-a', teams: [], teamsAt: null,
    keyTail: keyTailOf(key), keyDigest: valueDigestHex(key), checkedAt: T, outcome: 'ok', ...over,
  });
  const put = (b: Box, id: string, key: string, over: Partial<LinearStoreRecord> = {}): Promise<unknown> =>
    putLinearSlot(b.dir, key, slotRecord(id, key, over), { replace: true });
  const store = async (b: Box): Promise<Extract<LinearStoreRead, { kind: 'listed' }>> => {
    const r = await readLinearStore(b.dir);
    if (r.kind !== 'listed') throw new Error('store not listed');
    return r;
  };
  const routes = async (b: Box, ask: LinearRouteAsk): Promise<string> => routedTo(routeLinear(routableSlots(await store(b)), ask));
  const recordOf = async (b: Box, id: string): Promise<LinearStoreRecord | null> => {
    const s = (await store(b)).slots.find((x) => x.id === id);
    return s?.record.kind === 'details' ? s.record.details : null;
  };

  it('a miss answers at once with no Linear call, queues the stale slot, and the retry after the refresh routes', async () => {
    const b = box();
    await put(b, WS_A, KEY_1);
    b.answers.set(KEY_1, async () => keyPage([TEAM_AAA]));
    expect(await routes(b, issue('AAA'))).toBe('refused:team-unknown');
    const d = b.fx.refresher.miss(await store(b));
    expect(d).toBe('refreshing');
    expect(LINEAR_MISS_RETRY_AFTER_S).toBe(10);
    expect(b.sent).toHaveLength(0);
    await b.fx.refresher.idle();
    expect(b.sent.map((s) => s.auth)).toEqual([KEY_1]);
    expect(await recordOf(b, WS_A)).toMatchObject({ teams: [TEAM_AAA], teamsAt: T, outcome: 'ok', urlKey: 'ws-a' });
    expect(await routes(b, issue('AAA'))).toBe(WS_A);
  });

  it('answers before the refresh it queued has finished: a hung Linear never holds the miss', async () => {
    const b = box();
    await put(b, WS_A, KEY_1);
    b.answers.set(KEY_1, () => new Promise<LinearAnswer>(() => {}));
    expect(b.fx.refresher.miss(await store(b))).toBe('refreshing');
    expect(b.fx.refresher.miss(await store(b))).toBe('refreshing');
  });

  it('one refresh per slot whatever the number of misses; inside the window a miss is unknown', async () => {
    const b = box();
    await put(b, WS_A, KEY_1);
    b.answers.set(KEY_1, async () => keyPage([TEAM_AAA]));
    for (let i = 0; i < 5; i += 1) expect(b.fx.refresher.miss(await store(b))).toBe('refreshing');
    await b.fx.refresher.idle();
    expect(b.sent).toHaveLength(1);
    // Refreshed, and still no team ZZZ: a retry will not help until the window passes or a key is added.
    b.clock.now = T + 4 * MIN;
    expect(await routes(b, issue('ZZZ'))).toBe('refused:team-unknown');
    expect(b.fx.refresher.miss(await store(b))).toBe('unknown');
    await b.fx.refresher.idle();
    expect(b.sent).toHaveLength(1);
  });

  it('a slot whose teams are under five minutes old is not refreshed', async () => {
    const b = box();
    await put(b, WS_A, KEY_1, { teams: [TEAM_AAA], teamsAt: T - 4 * MIN });
    expect(b.fx.refresher.miss(await store(b))).toBe('unknown');
    b.clock.now = T + MIN + 1;
    b.answers.set(KEY_1, async () => keyPage([TEAM_AAA]));
    expect(b.fx.refresher.miss(await store(b))).toBe('refreshing');
    await b.fx.refresher.idle();
    expect(b.sent).toHaveLength(1);
  });

  it('a refresh that failed is not tried again inside five minutes, and is after', async () => {
    const b = box();
    await put(b, WS_A, KEY_1);
    b.answers.set(KEY_1, async () => linearAnswer({ ok: false, status: 500, json: async () => ({}) }));
    expect(b.fx.refresher.miss(await store(b))).toBe('refreshing');
    await b.fx.refresher.idle();
    expect(await recordOf(b, WS_A)).toMatchObject({ outcome: 'unreachable', teamsAt: null });
    b.clock.now = T + 5 * MIN - 1;
    expect(b.fx.refresher.miss(await store(b))).toBe('unknown');
    b.clock.now = T + 5 * MIN;
    b.answers.set(KEY_1, async () => keyPage([TEAM_AAA]));
    expect(b.fx.refresher.miss(await store(b))).toBe('refreshing');
    await b.fx.refresher.idle();
    expect(b.sent).toHaveLength(2);
    expect(await routes(b, issue('AAA'))).toBe(WS_A);
  });

  it('runs one slot at a time', async () => {
    const b = box();
    await put(b, WS_A, KEY_1);
    await put(b, WS_B, KEY_2);
    let release!: () => void;
    b.answers.set(KEY_1, () => new Promise<LinearAnswer>((r) => { release = () => r(keyPage([TEAM_AAA])); }));
    b.answers.set(KEY_2, async () => keyPage([TEAM_BBB], null, ORG_B));
    expect(b.fx.refresher.miss(await store(b))).toBe('refreshing');
    for (let i = 0; i < 20 && b.sent.length === 0; i += 1) await new Promise((r) => setTimeout(r, 5));
    await new Promise((r) => setTimeout(r, 20));
    expect(b.sent.map((s) => s.auth)).toEqual([KEY_1]);
    // A miss while the first runs: both are already queued or running, so it queues nothing new.
    expect(b.fx.refresher.miss(await store(b))).toBe('refreshing');
    release();
    await b.fx.refresher.idle();
    expect(b.sent.map((s) => s.auth)).toEqual([KEY_1, KEY_2]);
    expect(await routes(b, byTeam('BBB'))).toBe(WS_B);
  });

  it('is charged to the slot\'s floor: a spent floor refuses it with no call, and leaves the other lanes whole', async () => {
    const b = box();
    await put(b, WS_A, KEY_1);
    const SLOT: LinearSlotRef = { source: 'file', id: WS_A };
    while (b.fx.rate.take({ lane: 'floor', slot: SLOT, calls: 1 }).ok) { /* spend the floor */ }
    expect(b.fx.refresher.miss(await store(b))).toBe('refreshing');
    await b.fx.refresher.idle();
    expect(b.sent).toHaveLength(0);
    expect(b.fx.rate.take({ lane: 'request', slot: SLOT, calls: 25 }).ok).toBe(true);
    expect(b.fx.rate.take({ lane: 'proxy', slot: SLOT, calls: 425 }).ok).toBe(true);
  });

  it('reads the slot\'s key before each of its two pages, and stops when it changed, recording nothing', async () => {
    const b = box();
    await put(b, WS_A, KEY_1);
    b.answers.set(KEY_1, async () => { await put(b, WS_A, KEY_2, { name: 'Replaced' }); return keyPage([TEAM_AAA], 'cursor-1'); });
    b.fx.refresher.miss(await store(b));
    await b.fx.refresher.idle();
    expect(b.sent.map((s) => s.auth)).toEqual([KEY_1]);
    expect(await recordOf(b, WS_A)).toEqual(slotRecord(WS_A, KEY_2, { name: 'Replaced' }));
  });

  it('a 401 marks that slot rejected and no other; an answer naming another workspace records nothing', async () => {
    const b = box();
    await put(b, WS_A, KEY_1);
    await put(b, WS_B, KEY_2);
    b.answers.set(KEY_1, async () => linearAnswer({ ok: false, status: 401, json: async () => ({}) }));
    b.answers.set(KEY_2, async () => keyPage([TEAM_BBB]));
    b.fx.refresher.miss(await store(b));
    await b.fx.refresher.idle();
    expect(await recordOf(b, WS_A)).toMatchObject({ outcome: 'rejected', keyDigest: valueDigestHex(KEY_1) });
    // KEY_2's answer named workspace A, not B: B's record is as it was.
    expect(await recordOf(b, WS_B)).toEqual(slotRecord(WS_B, KEY_2));
  });
});

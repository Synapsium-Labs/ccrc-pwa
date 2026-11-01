// The operation table and the directory (#1444, D-7669, D-7670, D-7682 R5, R7, R9; spec 2026-10-31 §4.4, §4.5, §5.3,
// §5.4, §6.4, §6.5, §6.8, §14 row 4; plan task LK8).
//
// `linear/ops.ts` (L1, pure): the closed allow-list of documents the key can run, each verb's closed body validator,
// its variables (names through the directory, the mutations on resolved UUIDs) and its shaper (Linear's text fenced
// under `untrusted`, the two strips, `cleanName`, `url` built here, the provenance line). `linear/directory.ts` and the
// refresher's directory pass (L3): names filled in the background only. Nothing here reaches the network: every Linear
// answer is a stub in the shape the table's own document asks for, and every Linear call goes through a fetch seam
// that records it.
//
// FX PENDING (D-7684; the coordinator's ruling of 2026-11-01). No Linear answer is recorded on `main`, so the rows that
// need one stay `it.todo`, naming FX: each document's recorded `X-Complexity`, each document against the text its
// fixture records, the error codes of a forbidden, an invalid and a missing entity, and the create input's `id`.
import { describe, expect, it } from 'vitest';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import type { LinearStoreRecord } from '../../shared/linear.js';
import { stripLine, stripMultiline } from '../../shared/unprintable.js';
import type { FetchLike } from '../src/linear/client.js';
import { keyTailOf } from '../src/linear/connection.js';
import { LinearDirectory } from '../src/linear/directory.js';
import {
  LINEAR_DESCRIPTION_MAX_BYTES, LINEAR_DIRECTORY_COLLECTIONS, LINEAR_DIRECTORY_DOCUMENTS, LINEAR_DIRECTORY_MAX_PAGES,
  LINEAR_DIRECTORY_PAGE_SIZE, LINEAR_DOCUMENTS, LINEAR_ERROR_CODES, LINEAR_OPS, LINEAR_PROVENANCE_LINE, LINEAR_STRIPS,
  LINEAR_VERBS, decodeLinearCursor, encodeLinearCursor, linearMoved, linearOutbound, linearResolvePlan, linearRouteAsk,
  lookupLinearName, readLinearDirectoryPage, shapeLinearResolve, shapeLinearTeams, shapeLinearWorkspaces,
  validateLinearCall, withLinearProvenance, type LinearCallRow, type LinearDirectoryEntries, type LinearOpContext,
  type LinearOpInput, type LinearResolved, type LinearShapeContext, type LinearVerb,
} from '../src/linear/ops.js';
import { LINEAR_DIRECTORY_REFRESH_MS, LINEAR_MISS_RETRY_AFTER_S } from '../src/linear/refresher.js';
import { putLinearSlot, readLinearStore, type LinearSlotRef } from '../src/linear/store.js';
import { valueDigestHex } from '../src/token/files.js';
import { RATELIMITED_ERRORS, linearAnswer, type LinearAnswer } from './linearFetchFake.js';
import { linearServicesFake } from './linearServicesFake.js';
import { mkTmp, removeTmpFixturesEachTest } from './tmpHelpers.js';

removeTmpFixturesEachTest();

// ── the fixture vocabulary (public repository: team keys AAA and BBB, ws-a, fixed UUIDs, lin_api_fixture keys) ──

const WS_A = 'aaaaaaaa-0000-4000-8000-000000000001';
const TEAM_A = { id: 'aaaaaaaa-1111-4000-8000-000000000001', key: 'AAA' };
const TEAM_B = { id: 'bbbbbbbb-1111-4000-8000-000000000002', key: 'BBB' };
const ISSUE_ID = '11111111-2222-4000-8000-000000000001';
const PARENT_ID = '11111111-2222-4000-8000-000000000002';
const COMMENT_ID = '33333333-4444-4000-8000-000000000001';
const STATE_TODO_A = '55555555-0000-4000-8000-00000000000a';
const STATE_TODO_B = '55555555-0000-4000-8000-00000000000b';
const STATE_DONE_A = '55555555-0000-4000-8000-00000000000c';
const LABEL_BUG = '66666666-0000-4000-8000-000000000001';
const LABEL_UI_A = '66666666-0000-4000-8000-000000000002';
const PROJECT_X = '77777777-0000-4000-8000-000000000001';
const USER_A = '88888888-0000-4000-8000-000000000001';
const USER_B = '88888888-0000-4000-8000-000000000002';
const VIEWER = USER_A;
const KEY_1 = 'lin_api_fixture1aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
const KEY_2 = 'lin_api_fixture2bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';
const T = 1_800_000_000_000;
const MIN = 60_000;

/** An issue URL as Linear writes it, joined here so no line of this file holds the web origin and a path together. */
const issueUrl = (urlKey: string, id: string): string => ['https:', '', 'linear.app', urlKey, 'issue', id].join('/');

const DIR: LinearDirectoryEntries = {
  viewerId: VIEWER,
  states: [
    { id: STATE_TODO_A, name: 'Todo', type: 'unstarted', teamKey: 'AAA' },
    { id: STATE_TODO_B, name: 'Todo', type: 'unstarted', teamKey: 'BBB' },
    { id: STATE_DONE_A, name: 'Done', type: 'completed', teamKey: 'AAA' },
  ],
  labels: [
    { id: LABEL_BUG, name: 'Bug', teamKey: null },
    { id: LABEL_UI_A, name: 'UI', teamKey: 'AAA' },
  ],
  projects: [{ id: PROJECT_X, name: 'Project X' }],
  users: [
    { id: USER_A, name: 'user-a', displayName: 'User A' },
    { id: USER_B, name: 'user-b', displayName: null },
  ],
};

const RESOLVED: LinearResolved = {
  issue: { id: ISSUE_ID, identifier: 'AAA-12', teamId: TEAM_A.id, teamKey: 'AAA' },
  parent: null,
};
const ctxOf = (over: Partial<LinearOpContext> = {}): LinearOpContext =>
  ({ teams: [TEAM_A, TEAM_B], resolved: RESOLVED, directory: DIR, ...over });
const SHAPE: LinearShapeContext = { urlKey: 'ws-a', fleet: new Set() };

const callRow = (op: LinearVerb): LinearCallRow => {
  const row = LINEAR_OPS[op];
  if (row.source !== 'linear') throw new Error(`${op} is answered from the store`);
  return row;
};
const valid = (op: LinearVerb, call: { ref?: unknown; query?: unknown; body?: unknown }): LinearOpInput => {
  const v = validateLinearCall(op, call);
  if (!v.ok) throw new Error(`refused: ${v.word} ${String(v.field)}`);
  return v.input;
};
const varsOf = (op: LinearVerb, input: LinearOpInput, ctx: LinearOpContext = ctxOf()): Record<string, unknown> => {
  const r = callRow(op).variables(input, ctx);
  if (!r.ok) throw new Error(`variables refused: ${r.word}`);
  return r.vars;
};

/** An issue node in the shape `LINEAR_DOCUMENTS.issue` asks for. */
const issueNode = (over: Record<string, unknown> = {}): Record<string, unknown> => ({
  id: ISSUE_ID, identifier: 'AAA-12', title: 'Fix the thing', description: 'Some text', priority: 2,
  createdAt: '2026-10-31T10:00:00.000Z', updatedAt: '2026-10-31T11:00:00.000Z',
  team: { key: 'AAA' }, state: { name: 'Todo', type: 'unstarted' }, assignee: { name: 'user-a' },
  labels: { nodes: [{ name: 'Bug' }] }, project: { name: 'Project X' }, parent: null, ...over,
});
const shaped = (op: LinearVerb, body: unknown, ctx: LinearShapeContext = SHAPE): Record<string, unknown> => {
  const r = callRow(op).shape(body, ctx);
  if (!r.ok) throw new Error(`shape refused: ${r.word}`);
  return r.answer;
};
const issueOf = (node: Record<string, unknown>, ctx: LinearShapeContext = SHAPE): Record<string, unknown> =>
  shaped('issue', { data: { issue: node } }, ctx)['issue'] as Record<string, unknown>;

// ── the table ──

describe('LINEAR_OPS: one row per verb, the allow-list of what the key can run (spec §6.4)', () => {
  it('has exactly one row per verb, keyed by it, in the verb list', () => {
    expect(Object.keys(LINEAR_OPS)).toEqual([...LINEAR_VERBS]);
    for (const v of LINEAR_VERBS) expect(LINEAR_OPS[v].op).toBe(v);
    expect(LINEAR_VERBS).toHaveLength(12);
  });

  it('a row\'s class is its own, never its method\'s: the three writes are write, search is a read although it POSTs', () => {
    const classes = Object.fromEntries(LINEAR_VERBS.map((v) => [v, LINEAR_OPS[v].class]));
    expect(classes).toEqual({
      workspaces: 'read', teams: 'read', issue: 'read', search: 'read', comments: 'read', statuses: 'read', projects: 'read',
      labels: 'read', users: 'read', create: 'write', update: 'write', comment: 'write',
    });
    expect(LINEAR_OPS.search.method).toBe('POST');
  });

  it('the declared query keys and paths are spec §5.1\'s: workspace on every verb but workspaces', () => {
    const q = Object.fromEntries(LINEAR_VERBS.map((v) => [v, LINEAR_OPS[v].query]));
    expect(q).toEqual({
      workspaces: [], teams: ['workspace'], issue: ['workspace'], search: ['workspace'], comments: ['workspace', 'limit', 'after'],
      statuses: ['team', 'workspace'], projects: ['team', 'workspace', 'limit', 'after'], labels: ['team', 'workspace'],
      users: ['workspace', 'limit', 'after'], create: ['workspace'], update: ['workspace'], comment: ['workspace'],
    });
    expect(LINEAR_VERBS.filter((v) => LINEAR_OPS[v].ref)).toEqual(['issue', 'comments', 'update', 'comment']);
  });

  it('only workspaces and teams are answered from the store, with no document and no Linear call', () => {
    expect(LINEAR_VERBS.filter((v) => LINEAR_OPS[v].source === 'store')).toEqual(['workspaces', 'teams']);
    for (const v of ['workspaces', 'teams'] as const) expect(LINEAR_OPS[v].document).toBeNull();
  });

  it('every document a row or the directory runs is one of the table\'s own constants', () => {
    const own = new Set<string>(Object.values(LINEAR_DOCUMENTS));
    for (const v of LINEAR_VERBS) {
      const row = LINEAR_OPS[v];
      if (row.source === 'store') continue;
      expect(own.has(row.document), v).toBe(true);
      for (const d of row.resolves) expect(own.has(d), `${v} resolve`).toBe(true);
    }
    for (const c of LINEAR_DIRECTORY_COLLECTIONS) expect(own.has(LINEAR_DIRECTORY_DOCUMENTS[c]), c).toBe(true);
    // A constant, never a template a value could be put into.
    for (const d of own) expect(d).not.toMatch(/\$\{|\+|\\/);
  });

  it('a mutation appears only as a write row\'s operation document, one per row, and never in a resolve or a read', () => {
    const MUTATIONS = ['issueCreate', 'issueUpdate', 'commentCreate'];
    const mutationsIn = (d: string): string[] => MUTATIONS.filter((m) => new RegExp(`\\b${m}\\(`).test(d));
    for (const v of LINEAR_VERBS) {
      const row = LINEAR_OPS[v];
      if (row.source === 'store') continue;
      if (row.class === 'write') {
        expect(row.document.startsWith('mutation '), v).toBe(true);
        expect(mutationsIn(row.document), v).toHaveLength(1);
        expect(row.document.match(/\bmutation\b/g), v).toHaveLength(1);
      } else {
        expect(row.document.startsWith('query '), v).toBe(true);
        expect(mutationsIn(row.document), v).toEqual([]);
      }
      for (const d of row.resolves) {
        expect(d.startsWith('query '), `${v} resolve`).toBe(true);
        expect(mutationsIn(d), `${v} resolve`).toEqual([]);
      }
    }
    for (const c of LINEAR_DIRECTORY_COLLECTIONS) expect(LINEAR_DIRECTORY_DOCUMENTS[c].startsWith('query '), c).toBe(true);
    expect([callRow('create'), callRow('update'), callRow('comment')].map((r) => mutationsIn(r.document)[0]))
      .toEqual(['issueCreate', 'issueUpdate', 'commentCreate']);
  });

  it('the resolve selects the issue\'s id, its current identifier and its current team, and the parent\'s in the same document', () => {
    const SELECTS = /\{ id identifier team \{ id key \} \}/g;
    expect(LINEAR_DOCUMENTS.resolveIssue.match(SELECTS)).toHaveLength(1);
    expect(LINEAR_DOCUMENTS.resolveIssueAndParent.match(SELECTS)).toHaveLength(2);
    expect(LINEAR_DOCUMENTS.resolveParent.match(SELECTS)).toHaveLength(1);
    expect(callRow('update').resolves).toEqual([LINEAR_DOCUMENTS.resolveIssue, LINEAR_DOCUMENTS.resolveIssueAndParent]);
    expect(callRow('comment').resolves).toEqual([LINEAR_DOCUMENTS.resolveIssue]);
    expect(callRow('create').resolves).toEqual([LINEAR_DOCUMENTS.resolveParent]);
    for (const v of LINEAR_VERBS) if (LINEAR_OPS[v].class === 'read' && LINEAR_OPS[v].source === 'linear') expect(callRow(v).resolves, v).toEqual([]);
  });

  it('the resolve plan: update and comment resolve the issue, a parent rides the same document, a create with no parent resolves nothing', () => {
    expect(linearResolvePlan(valid('comment', { ref: 'AAA-12', body: { body: 'x' } })))
      .toEqual({ document: LINEAR_DOCUMENTS.resolveIssue, variables: { id: 'AAA-12' }, issue: true, parent: false });
    expect(linearResolvePlan(valid('update', { ref: 'AAA-12', body: { title: 'x' } })))
      .toEqual({ document: LINEAR_DOCUMENTS.resolveIssue, variables: { id: 'AAA-12' }, issue: true, parent: false });
    expect(linearResolvePlan(valid('update', { ref: 'AAA-12', body: { parent: 'AAA-1' } })))
      .toEqual({ document: LINEAR_DOCUMENTS.resolveIssueAndParent, variables: { id: 'AAA-12', parent: 'AAA-1' }, issue: true, parent: true });
    expect(linearResolvePlan(valid('create', { body: { team: 'AAA', title: 't', parent: 'AAA-1' } })))
      .toEqual({ document: LINEAR_DOCUMENTS.resolveParent, variables: { parent: 'AAA-1' }, issue: false, parent: true });
    expect(linearResolvePlan(valid('create', { body: { team: 'AAA', title: 't' } }))).toBeNull();
    expect(linearResolvePlan(valid('issue', { ref: 'AAA-12' }))).toBeNull();
  });

  it('the directory pages are 250 entries, up to 4 pages a collection (spec §4.4)', () => {
    expect(LINEAR_DIRECTORY_PAGE_SIZE).toBe(250);
    expect(LINEAR_DIRECTORY_MAX_PAGES).toBe(4);
    for (const c of LINEAR_DIRECTORY_COLLECTIONS) expect(LINEAR_DIRECTORY_DOCUMENTS[c]).toContain('(first: 250, after: $after)');
  });

  it.todo('every document\'s recorded X-Complexity is under LINEAR_QUOTA.maxQueryComplexity, the directory pages included (FX records it; slug linear-fx-ops-complexity)');
  it.todo('every document constant equals, byte for byte, the document text its FX fixture records (FX; slug linear-fx-ops-documents)');
  it.todo('the error-code table maps the codes FX records for a forbidden team, an invalid input and a missing issue to linear-forbidden, linear-invalid and not-found (FX; slug linear-fx-error-codes)');
  it.todo('the create input takes a caller-chosen id, so requestId is passed as the new issue\'s id (FX\'s introspection; slug linear-create-request-id)');
});

// ── the validators ──

describe('the closed body validators (spec §5.2, §5.3)', () => {
  const BODIES: Record<'search' | 'create' | 'update' | 'comment', { ref?: string; body: Record<string, unknown> }> = {
    search: { body: { team: 'AAA', text: 'login' } },
    create: { body: { team: 'AAA', title: 'A title' } },
    update: { ref: 'AAA-12', body: { title: 'A title' } },
    comment: { ref: 'AAA-12', body: { body: 'A comment' } },
  };

  it('each POST verb takes the fields §5.3 names', () => {
    expect(valid('search', { body: {
      team: 'aaa', text: 't', state: 'Todo', assignee: 'me', label: 'Bug', project: 'Project X', includeArchived: true,
      limit: 10, after: encodeLinearCursor('c1'),
    } })).toMatchObject({ team: 'AAA', limit: 10, after: 'c1', fields: { text: 't', state: 'Todo', includeArchived: true } });
    expect(valid('create', { body: {
      team: 'AAA', title: 't', description: 'd', state: 'Todo', priority: 4, assignee: 'user-a', labels: ['Bug'],
      project: 'Project X', parent: 'AAA-1',
    } })).toMatchObject({ team: 'AAA', fields: { title: 't', priority: 4, labels: ['Bug'], parent: 'AAA-1' } });
    expect(valid('update', { ref: 'AAA-12', body: { addLabels: ['Bug'], removeLabels: ['UI'], assignee: null } }))
      .toMatchObject({ ref: 'AAA-12', fields: { addLabels: ['Bug'], removeLabels: ['UI'], assignee: null } });
    expect(valid('comment', { ref: 'AAA-12', body: { body: 'hello' } })).toMatchObject({ fields: { body: 'hello' } });
  });

  it('an unknown field is bad-field, named, on every body: a typo is never dropped', () => {
    for (const [op, c] of Object.entries(BODIES)) {
      expect(validateLinearCall(op as LinearVerb, { ref: c.ref, body: { ...c.body, titel: 'x' } }), op)
        .toEqual({ ok: false, word: 'bad-field', field: 'titel' });
    }
  });

  it('no body carries a document, a field list, an operation name or variables', () => {
    for (const [op, c] of Object.entries(BODIES)) {
      for (const f of ['query', 'document', 'operationName', 'variables', 'fields']) {
        expect(validateLinearCall(op as LinearVerb, { ref: c.ref, body: { ...c.body, [f]: 'mutation { x }' } }), `${op} ${f}`)
          .toEqual({ ok: false, word: 'bad-field', field: f });
      }
    }
  });

  it('byId, byUuid and workspace are refused by name in every body, an escaped spelling included', () => {
    for (const [op, c] of Object.entries(BODIES)) {
      for (const f of ['byId', 'byUuid', 'workspace']) {
        expect(validateLinearCall(op as LinearVerb, { ref: c.ref, body: { ...c.body, [f]: 'x' } }), `${op} ${f}`)
          .toEqual({ ok: false, word: 'bad-field', field: f });
      }
      // `JSON.parse` has decoded the escape before the validator looks, so `byId` is `byId`.
      const escaped = JSON.parse(`{"\\u0062yId":"x",${JSON.stringify(c.body).slice(1)}`) as Record<string, unknown>;
      expect(validateLinearCall(op as LinearVerb, { ref: c.ref, body: escaped }), op).toEqual({ ok: false, word: 'bad-field', field: 'byId' });
    }
  });

  it('a GET takes no body, and a POST takes only an object', () => {
    expect(validateLinearCall('issue', { ref: 'AAA-12', body: {} })).toEqual({ ok: false, word: 'bad-request', field: 'body' });
    for (const body of [null, [], 'text', 3]) {
      expect(validateLinearCall('comment', { ref: 'AAA-12', body })).toEqual({ ok: false, word: 'bad-request', field: 'body' });
    }
  });

  it('the bounds of §5.3', () => {
    const refused = (op: LinearVerb, body: Record<string, unknown>, ref?: string): unknown =>
      validateLinearCall(op, { ref, body });
    const bad = (field: string): unknown => ({ ok: false, word: 'bad-field', field });
    expect(refused('create', { team: 'AAA', title: '' })).toEqual(bad('title'));
    expect(refused('create', { team: 'AAA', title: 'x'.repeat(256) })).toEqual(bad('title'));
    expect(valid('create', { body: { team: 'AAA', title: '\u{1F600}'.repeat(255) } }).fields.title).toHaveLength(510);
    expect(refused('create', { team: 'AAA', title: 't', description: 'x'.repeat(LINEAR_DESCRIPTION_MAX_BYTES + 1) })).toEqual(bad('description'));
    expect(refused('comment', { body: '' }, 'AAA-12')).toEqual(bad('body'));
    expect(refused('comment', { body: 'x'.repeat(16 * 1024 + 1) }, 'AAA-12')).toEqual(bad('body'));
    expect(valid('comment', { ref: 'AAA-12', body: { body: 'x'.repeat(16 * 1024) } }).fields.body).toHaveLength(16 * 1024);
    expect(refused('search', { text: 'x'.repeat(257) })).toEqual(bad('text'));
    for (const p of [-1, 5, 1.5, '2']) expect(refused('create', { team: 'AAA', title: 't', priority: p })).toEqual(bad('priority'));
    expect(refused('create', { team: 'AAA', title: 't', labels: Array.from({ length: 21 }, (_, i) => `l${i}`) })).toEqual(bad('labels'));
    for (const l of [0, 51, 2.5]) expect(refused('search', { limit: l })).toEqual(bad('limit'));
    expect(valid('search', { body: {} }).limit).toBe(25);
    expect(refused('create', { team: 'AAA', title: 't', parent: 'AAA12' })).toEqual(bad('parent'));
    expect(refused('create', { team: 'a-b', title: 't' })).toEqual(bad('team'));
    expect(refused('create', { title: 't' })).toEqual(bad('team'));
    expect(refused('create', { team: 'AAA' })).toEqual(bad('title'));
    expect(refused('create', { team: 'AAA', title: 't', assignee: null })).toEqual(bad('assignee'));
  });

  it('an update changes at least one field, and labels never rides with addLabels or removeLabels', () => {
    expect(validateLinearCall('update', { ref: 'AAA-12', body: {} })).toEqual({ ok: false, word: 'bad-request', field: 'body' });
    expect(validateLinearCall('update', { ref: 'AAA-12', body: { labels: ['Bug'], addLabels: ['UI'] } }))
      .toEqual({ ok: false, word: 'bad-field', field: 'labels' });
  });

  it('create takes no requestId until FX confirms the create input takes a caller-chosen id (slug linear-create-request-id)', () => {
    expect(validateLinearCall('create', { body: { team: 'AAA', title: 't', requestId: ISSUE_ID } }))
      .toEqual({ ok: false, word: 'bad-field', field: 'requestId' });
  });

  it('the path reference passes the identifier grammar, on the server too', () => {
    for (const ref of ['AAA12', 'AAA-', 'search', '-12', 'AAA-1234567890', 'A A-1', undefined]) {
      expect(validateLinearCall('issue', { ref }), String(ref)).toEqual({ ok: false, word: 'bad-field', field: 'ref' });
    }
    expect(validateLinearCall('search', { ref: 'AAA-1', body: {} })).toEqual({ ok: false, word: 'bad-field', field: 'ref' });
    expect(valid('issue', { ref: 'aaa-12' }).ref).toBe('aaa-12');
  });

  it('the query: declared keys only, each one string in its grammar; the identity pair is left to onRequest', () => {
    expect(valid('statuses', { query: { team: 'aaa', workspace: 'ws-a', byId: 'x', byUuid: 'y' } }))
      .toMatchObject({ team: 'AAA', workspace: 'ws-a' });
    expect(validateLinearCall('issue', { ref: 'AAA-1', query: { team: 'AAA' } })).toEqual({ ok: false, word: 'bad-field', field: 'team' });
    expect(validateLinearCall('issue', { ref: 'AAA-1', query: { text: 'free text' } })).toEqual({ ok: false, word: 'bad-field', field: 'text' });
    expect(validateLinearCall('issue', { ref: 'AAA-1', query: { workspace: ['ws-a', 'ws-b'] } })).toEqual({ ok: false, word: 'bad-field', field: 'workspace' });
    expect(validateLinearCall('issue', { ref: 'AAA-1', query: { workspace: 'WS A' } })).toEqual({ ok: false, word: 'bad-field', field: 'workspace' });
    expect(validateLinearCall('users', { query: { limit: '51' } })).toEqual({ ok: false, word: 'bad-field', field: 'limit' });
    expect(validateLinearCall('users', { query: { after: 'not=base64' } })).toEqual({ ok: false, word: 'bad-field', field: 'after' });
    expect(valid('users', { query: {} }).limit).toBe(25);
    expect(valid('users', { query: { limit: '7', after: encodeLinearCursor('cursor-2') } })).toMatchObject({ limit: 7, after: 'cursor-2' });
    expect(valid('workspaces', {}).workspace).toBeNull();
    expect(validateLinearCall('workspaces', { query: { workspace: 'ws-a' } })).toEqual({ ok: false, word: 'bad-field', field: 'workspace' });
  });

  it('a field name a refusal cannot echo is named by nothing', () => {
    expect(validateLinearCall('comment', { ref: 'AAA-12', body: { body: 'x', 'a\u202Eb': 1 } })).toEqual({ ok: false, word: 'bad-field', field: null });
  });

  it('the route\'s ask: an issue reference\'s prefix as a hint, else a team, else the workspace', () => {
    expect(linearRouteAsk(valid('update', { ref: 'aaa-12', query: { workspace: 'ws-a' }, body: { title: 't' } })))
      .toEqual({ kind: 'issue', prefix: 'AAA', workspace: 'ws-a' });
    expect(linearRouteAsk(valid('create', { body: { team: 'bbb', title: 't' } }))).toEqual({ kind: 'team', team: 'BBB', workspace: null });
    expect(linearRouteAsk(valid('users', {}))).toEqual({ kind: 'workspace', workspace: null });
  });
});

// ── the cursor ──

describe('next: an opaque cursor, base64url without padding (spec §5.4)', () => {
  it('passes the client\'s SAFE_RE and comes back as after', () => {
    for (const c of ['YXJyYXljb25uZWN0aW9uOjE=', 'a', 'c/+?=&x', '\u00e9\u4e2d']) {
      const wire = encodeLinearCursor(c);
      expect(wire).toMatch(/^[A-Za-z0-9_-]+$/);
      expect(decodeLinearCursor(wire)).toBe(c);
    }
    expect(decodeLinearCursor('')).toBeNull();
    expect(decodeLinearCursor('YQ==')).toBeNull();
    expect(decodeLinearCursor('YR')).toBeNull();
    expect(decodeLinearCursor(encodeLinearCursor('x'.repeat(513)))).toBeNull();
  });
});

// ── the variables ──

describe('the variables: resolved UUIDs, names through the directory (spec §4.4, §4.5)', () => {
  it('update sends the resolve\'s UUID, never the identifier the caller wrote', () => {
    const input = valid('update', { ref: 'AAA-12', body: { title: 'New title' } });
    const vars = varsOf('update', input);
    expect(vars).toEqual({ id: ISSUE_ID, input: { title: 'New title' } });
    expect(JSON.stringify(vars)).not.toContain('AAA-12');
  });

  it('comment sends the resolved issue id; a parent is the resolve\'s UUID on create and on update', () => {
    expect(varsOf('comment', valid('comment', { ref: 'AAA-12', body: { body: 'hi' } }))).toEqual({ input: { issueId: ISSUE_ID, body: 'hi' } });
    const withParent = ctxOf({ resolved: { ...RESOLVED, parent: { id: PARENT_ID, identifier: 'AAA-1', teamId: TEAM_A.id, teamKey: 'AAA' } } });
    expect(varsOf('create', valid('create', { body: { team: 'AAA', title: 't', parent: 'AAA-1' } }), withParent))
      .toEqual({ input: { teamId: TEAM_A.id, title: 't', parentId: PARENT_ID } });
    const upd = varsOf('update', valid('update', { ref: 'AAA-12', body: { parent: 'AAA-1' } }), withParent);
    expect(upd).toEqual({ id: ISSUE_ID, input: { parentId: PARENT_ID } });
    expect(JSON.stringify(upd)).not.toMatch(/AAA-1\b/);
  });

  it('a write built before its resolve is the route\'s fault, never a call', () => {
    const none = ctxOf({ resolved: null });
    expect(callRow('update').variables(valid('update', { ref: 'AAA-12', body: { title: 't' } }), none)).toEqual({ ok: false, word: 'unresolved' });
    expect(callRow('comment').variables(valid('comment', { ref: 'AAA-12', body: { body: 'x' } }), none)).toEqual({ ok: false, word: 'unresolved' });
    expect(callRow('create').variables(valid('create', { body: { team: 'AAA', title: 't', parent: 'AAA-1' } }), none))
      .toEqual({ ok: false, word: 'unresolved' });
  });

  it('create: the team\'s id from the routed slot\'s record, every name an id, and the changed fields for the journal', () => {
    const r = callRow('create').variables(valid('create', { body: {
      team: 'aaa', title: 't', description: 'd', state: 'todo', priority: 1, assignee: 'User A', labels: ['bug', 'UI'], project: 'project x',
    } }), ctxOf());
    expect(r).toEqual({ ok: true, fields: ['team', 'title', 'description', 'state', 'priority', 'assignee', 'labels', 'project'], vars: { input: {
      teamId: TEAM_A.id, title: 't', description: 'd', stateId: STATE_TODO_A, priority: 1, assigneeId: USER_A,
      labelIds: [LABEL_BUG, LABEL_UI_A], projectId: PROJECT_X,
    } } });
  });

  it('update scopes state and label names by the resolved team, not by the reference\'s prefix', () => {
    const moved = ctxOf({ resolved: { issue: { id: ISSUE_ID, identifier: 'BBB-3', teamId: TEAM_B.id, teamKey: 'BBB' }, parent: null } });
    expect(varsOf('update', valid('update', { ref: 'BBB-3', body: { state: 'Todo' } }), moved)).toEqual({ id: ISSUE_ID, input: { stateId: STATE_TODO_B } });
    // A team label of AAA is not BBB's.
    expect(callRow('update').variables(valid('update', { ref: 'BBB-3', body: { addLabels: ['UI'] } }), moved))
      .toEqual({ ok: false, word: 'name-unknown', field: 'addLabels' });
    expect(varsOf('update', valid('update', { ref: 'AAA-12', body: { assignee: null, addLabels: ['Bug'], removeLabels: ['UI'] } })))
      .toEqual({ id: ISSUE_ID, input: { assigneeId: null, addedLabelIds: [LABEL_BUG], removedLabelIds: [LABEL_UI_A] } });
  });

  it('assignee "me" is the key\'s own user', () => {
    expect(varsOf('update', valid('update', { ref: 'AAA-12', body: { assignee: 'me' } }))).toEqual({ id: ISSUE_ID, input: { assigneeId: VIEWER } });
  });

  it('a UUID in a name field skips the directory and goes as given, even with no directory', () => {
    const cold = ctxOf({ directory: null });
    const other = '99999999-0000-4000-8000-000000000009';
    expect(varsOf('update', valid('update', { ref: 'AAA-12', body: { state: other, labels: [other], project: other, assignee: other } }), cold))
      .toEqual({ id: ISSUE_ID, input: { stateId: other, assigneeId: other, labelIds: [other], projectId: other } });
    expect(lookupLinearName(null, 'state', other, 'AAA')).toEqual({ kind: 'id', id: other });
  });

  it('a name the directory lacks, or a directory not yet filled, is name-unknown with the field named', () => {
    expect(callRow('update').variables(valid('update', { ref: 'AAA-12', body: { state: 'Nope' } }), ctxOf()))
      .toEqual({ ok: false, word: 'name-unknown', field: 'state' });
    expect(callRow('update').variables(valid('update', { ref: 'AAA-12', body: { project: 'Project X' } }), ctxOf({ directory: null })))
      .toEqual({ ok: false, word: 'name-unknown', field: 'project' });
    expect(callRow('search').variables(valid('search', { body: { assignee: 'me' } }), ctxOf({ directory: null })))
      .toEqual({ ok: false, word: 'name-unknown', field: 'assignee' });
  });

  it('a name that matches two entries is name-ambiguous, and its candidates pass cleanName', () => {
    const dirty: LinearDirectoryEntries = {
      ...DIR,
      projects: [{ id: PROJECT_X, name: 'Dup\u202E' }, { id: '77777777-0000-4000-8000-000000000002', name: 'dup\u200B' }],
    };
    const r = callRow('update').variables(valid('update', { ref: 'AAA-12', body: { project: 'Dup' } }), ctxOf({ directory: dirty }));
    expect(r).toEqual({ ok: false, word: 'name-ambiguous', field: 'project', candidates: ['Dup', 'dup'] });
    expect(lookupLinearName(dirty, 'project', 'x', null)).toEqual({ kind: 'miss' });
    const users = lookupLinearName({ ...DIR, users: [
      { id: USER_A, name: 'pat\u202E\u0007', displayName: null }, { id: USER_B, name: 'Pat', displayName: 'P\u200Bat' },
    ] }, 'user', 'pat', null);
    expect(users).toEqual({ kind: 'ambiguous', candidates: ['Pat (P at)', 'pat'] });
    for (const c of (users as { candidates: string[] }).candidates) expect(c).toBe(stripLine(c));
    // A state name without a team matches every team's state of that name.
    expect(callRow('search').variables(valid('search', { body: { state: 'Todo' } }), ctxOf()))
      .toEqual({ ok: false, word: 'name-ambiguous', field: 'state', candidates: ['Todo (AAA)', 'Todo (BBB)'] });
  });

  it('search: a filter of ids, the text in Linear\'s own comparator, the page and archived flag', () => {
    expect(varsOf('search', valid('search', { body: { team: 'AAA', text: 'login', state: 'Todo', label: 'Bug', limit: 5 } }))).toEqual({
      filter: {
        team: { id: { eq: TEAM_A.id } }, state: { id: { eq: STATE_TODO_A } }, labels: { some: { id: { eq: LABEL_BUG } } },
        or: [{ title: { containsIgnoreCase: 'login' } }, { description: { containsIgnoreCase: 'login' } }],
      },
      first: 5, after: null, includeArchived: false,
    });
  });

  it('the list verbs: their page, and a team scope by the routed slot\'s team id', () => {
    expect(varsOf('comments', valid('comments', { ref: 'AAA-12', query: { limit: '3', after: encodeLinearCursor('c') } })))
      .toEqual({ id: 'AAA-12', first: 3, after: 'c' });
    expect(varsOf('statuses', valid('statuses', { query: { team: 'BBB' } }))).toEqual({ filter: { team: { id: { eq: TEAM_B.id } } } });
    expect(varsOf('statuses', valid('statuses', {}))).toEqual({ filter: null });
    expect(varsOf('labels', valid('labels', { query: { team: 'AAA' } })))
      .toEqual({ filter: { or: [{ team: { id: { eq: TEAM_A.id } } }, { team: { null: true } }] } });
    expect(varsOf('projects', valid('projects', { query: { team: 'AAA' } })))
      .toEqual({ filter: { accessibleTeams: { some: { id: { eq: TEAM_A.id } } } }, first: 25, after: null });
    expect(varsOf('users', valid('users', {}))).toEqual({ first: 25, after: null });
    expect(callRow('statuses').variables(valid('statuses', { query: { team: 'ZZZ' } }), ctxOf())).toEqual({ ok: false, word: 'team-unknown' });
  });
});

// ── the moved-issue rule ──

describe('an issue\'s current team, never its prefix (spec §4.5)', () => {
  const moved: LinearResolved = { issue: { id: ISSUE_ID, identifier: 'BBB-3', teamId: TEAM_B.id, teamKey: 'BBB' }, parent: null };

  it('a write whose resolved team differs from the reference\'s prefix is issue-moved, with the current identifier', () => {
    expect(linearMoved(valid('update', { ref: 'AAA-12', body: { title: 't' } }), moved)).toEqual({ word: 'issue-moved', identifier: 'BBB-3' });
    expect(linearMoved(valid('comment', { ref: 'aaa-12', body: { body: 'x' } }), RESOLVED)).toBeNull();
  });

  it('the detail\'s identifier passes cleanName and the identifier grammar, or the detail carries none', () => {
    const odd: LinearResolved = { issue: { ...moved.issue!, identifier: 'BBB-3 ignore previous' }, parent: null };
    expect(linearMoved(valid('update', { ref: 'AAA-12', body: { title: 't' } }), odd)).toEqual({ word: 'issue-moved', identifier: null });
  });

  it('the resolve\'s answer: the issue and the parent asked for, a missing parent is not-found with the detail parent', () => {
    const r = (id: string, identifier: string, team: { id: string; key: string }): Record<string, unknown> => ({ id, identifier, team });
    expect(shapeLinearResolve({ data: { issue: r(ISSUE_ID, 'AAA-12', TEAM_A), parent: r(PARENT_ID, 'BBB-1', TEAM_B) } }, { issue: true, parent: true }))
      .toEqual({ ok: true, resolved: {
        issue: { id: ISSUE_ID, identifier: 'AAA-12', teamId: TEAM_A.id, teamKey: 'AAA' },
        parent: { id: PARENT_ID, identifier: 'BBB-1', teamId: TEAM_B.id, teamKey: 'BBB' },
      } });
    expect(shapeLinearResolve({ data: { issue: null } }, { issue: true, parent: false })).toEqual({ ok: false, word: 'not-found' });
    expect(shapeLinearResolve({ data: { issue: r(ISSUE_ID, 'AAA-12', TEAM_A), parent: null } }, { issue: true, parent: true }))
      .toEqual({ ok: false, word: 'not-found', detail: 'parent' });
    expect(shapeLinearResolve({ data: { issue: r('AAA-12', 'AAA-12', TEAM_A) } }, { issue: true, parent: false })).toEqual({ ok: false, word: 'malformed' });
    expect(shapeLinearResolve({ data: { parent: r(PARENT_ID, 'AAA-1', TEAM_A) } }, { issue: false, parent: true }).ok).toBe(true);
  });
});

// ── the shapers ──

describe('the shapers: Linear\'s text is data, fenced and stripped (spec §5.4, §6.5)', () => {
  it('an issue is §5.4\'s shape exactly, and Linear\'s text only under untrusted', () => {
    expect(issueOf(issueNode())).toEqual({
      identifier: 'AAA-12', url: issueUrl('ws-a', 'AAA-12'), workspace: 'ws-a', team: 'AAA', state: { name: 'Todo', type: 'unstarted' },
      priority: 2, assignee: 'user-a', labels: ['Bug'], project: 'Project X', parent: null,
      createdAt: '2026-10-31T10:00:00.000Z', updatedAt: '2026-10-31T11:00:00.000Z', viaFleet: false,
      untrusted: { title: 'Fix the thing', description: 'Some text', descriptionTruncated: false },
    });
  });

  it('no title, description or body sits at the top level of any item', () => {
    const top = (o: Record<string, unknown>): string[] => Object.keys(o);
    for (const k of ['title', 'description', 'body']) expect(top(issueOf(issueNode())), k).not.toContain(k);
    const s = shaped('search', { data: { issues: { nodes: [issueNode()], pageInfo: { hasNextPage: false, endCursor: null } } } });
    const item = (s['items'] as Record<string, unknown>[])[0]!;
    for (const k of ['title', 'description', 'body']) expect(top(item), k).not.toContain(k);
    expect(item['untrusted']).toEqual({ title: 'Fix the thing' });
    const c = shaped('comments', { data: { issue: { comments: { nodes: [
      { id: COMMENT_ID, body: 'hi', createdAt: '2026-10-31T10:00:00Z', user: { name: 'user-a' } },
    ], pageInfo: { hasNextPage: false, endCursor: null } } } } });
    const ci = (c['items'] as Record<string, unknown>[])[0]!;
    expect(ci).toEqual({ author: 'user-a', createdAt: '2026-10-31T10:00:00Z', viaFleet: false, untrusted: { body: 'hi' } });
  });

  it('url is built from the slot\'s URL key and the shaped identifier, whatever Linear\'s answer says', () => {
    const elsewhere = ['https:', '', 'elsewhere.example', 'phish'].join('/');
    const i = issueOf(issueNode({ url: elsewhere, identifier: 'AAA-12' }), { urlKey: 'ws-b', fleet: new Set() });
    expect(i['url']).toBe(issueUrl('ws-b', 'AAA-12'));
    expect(i['workspace']).toBe('ws-b');
  });

  it('the strip column: line for one-line strings, multiline for the two markdown fields only', () => {
    expect(LINEAR_STRIPS).toEqual({
      identifier: 'line', title: 'line', name: 'line', urlKey: 'line', team: 'line', type: 'line',
      description: 'multiline', body: 'multiline',
    });
  });

  it('stripLine takes C0/C1, bidi controls and zero-width characters out of names and titles, and a title\'s newline becomes a space', () => {
    const i = issueOf(issueNode({
      title: 'Fix\u202E the\u200B\nthing\u0007\u009B', state: { name: 'To\u2066do', type: 'unstarted' },
      assignee: { name: 'user\u200F-a' }, labels: { nodes: [{ name: 'B\u0000ug' }] }, project: { name: 'Pro\u2028ject' },
    }));
    expect((i['untrusted'] as Record<string, unknown>)['title']).toBe('Fix the thing');
    expect(i['state']).toEqual({ name: 'To do', type: 'unstarted' });
    expect(i['assignee']).toBe('user -a');
    expect(i['labels']).toEqual(['B ug']);
    expect(i['project']).toBe('Pro ject');
  });

  const DESCRIPTION = [
    '# Steps', '', '1. first', '2. second', '\t- nested with a tab', '', '```ts', 'function f() {', '\treturn 1;', '}', '```', '',
    'last line',
  ].join('\n');

  it('stripMultiline keeps a description\'s fenced code block, tab indentation, list and blank lines byte for byte', () => {
    expect((issueOf(issueNode({ description: DESCRIPTION }))['untrusted'] as Record<string, unknown>)['description']).toBe(DESCRIPTION);
  });

  it('stripMultiline turns \\r\\n into \\n and still removes U+202E, U+200B, U+2028 and a lone U+0007', () => {
    const sent = DESCRIPTION.split('\n').join('\r\n').replace('first', 'fi\u202Erst\u200B').replace('last', 'la\u2028st\u0007');
    expect((issueOf(issueNode({ description: sent }))['untrusted'] as Record<string, unknown>)['description']).toBe(DESCRIPTION);
  });

  it('a comment body takes the same strip', () => {
    const sent = DESCRIPTION.split('\n').join('\r\n').replace('first', 'fi\u202Erst');
    const c = shaped('comments', { data: { issue: { comments: { nodes: [
      { id: COMMENT_ID, body: sent, createdAt: '2026-10-31T10:00:00Z', user: null },
    ], pageInfo: { hasNextPage: false, endCursor: null } } } } });
    expect(((c['items'] as Record<string, unknown>[])[0]!['untrusted'] as Record<string, unknown>)['body']).toBe(DESCRIPTION);
    expect(stripMultiline(sent)).toBe(DESCRIPTION);
  });

  it('a description over 64 KiB is cut at a character boundary and flagged', () => {
    const long = `${'x'.repeat(LINEAR_DESCRIPTION_MAX_BYTES - 1)}\u{1F600}tail`;
    const u = issueOf(issueNode({ description: long }))['untrusted'] as Record<string, unknown>;
    expect(u['descriptionTruncated']).toBe(true);
    expect(u['description']).toBe('x'.repeat(LINEAR_DESCRIPTION_MAX_BYTES - 1));
    const none = issueOf(issueNode({ description: null }))['untrusted'] as Record<string, unknown>;
    expect(none).toEqual({ title: 'Fix the thing', description: null, descriptionTruncated: false });
  });

  it('viaFleet reads the journal\'s set: an issue by its identifier, a comment by its id', () => {
    const fleet = new Set(['AAA-12', COMMENT_ID]);
    expect(issueOf(issueNode(), { urlKey: 'ws-a', fleet })['viaFleet']).toBe(true);
    expect(issueOf(issueNode({ identifier: 'AAA-13' }), { urlKey: 'ws-a', fleet })['viaFleet']).toBe(false);
    const body = { data: { issue: { comments: { nodes: [
      { id: COMMENT_ID, body: 'a', createdAt: '2026-10-31T10:00:00Z', user: null },
      { id: '33333333-4444-4000-8000-000000000002', body: 'b', createdAt: '2026-10-31T10:00:00Z', user: null },
    ], pageInfo: { hasNextPage: false, endCursor: null } } } } };
    expect((shaped('comments', body, { urlKey: 'ws-a', fleet })['items'] as Record<string, unknown>[]).map((i) => i['viaFleet'])).toEqual([true, false]);
    expect(callRow('comments').fleetKeys(body)).toEqual([COMMENT_ID, '33333333-4444-4000-8000-000000000002']);
    expect(callRow('issue').fleetKeys({ data: { issue: issueNode() } })).toEqual(['AAA-12']);
    expect(callRow('search').fleetKeys({ data: { issues: { nodes: [issueNode(), issueNode({ identifier: 'AAA-9' })] } } })).toEqual(['AAA-12', 'AAA-9']);
  });

  it('a list\'s next is the cursor, encoded; null on the last page', () => {
    const page = (hasNextPage: boolean, endCursor: string | null): unknown =>
      ({ data: { users: { nodes: [{ id: USER_A, name: 'user-a', displayName: 'User A', active: true, email: 'x@example.invalid' }], pageInfo: { hasNextPage, endCursor } } } });
    const more = shaped('users', page(true, 'opaque/cursor='));
    expect(more['next']).toBe(encodeLinearCursor('opaque/cursor='));
    expect(decodeLinearCursor(more['next'])).toBe('opaque/cursor=');
    expect(shaped('users', page(false, null))['next']).toBeNull();
    // An email address is never shaped in.
    expect((more['items'] as unknown[])[0]).toEqual({ id: USER_A, name: 'user-a', displayName: 'User A', active: true });
  });

  it('statuses, labels and projects carry the id beside the name', () => {
    expect(shaped('statuses', { data: { workflowStates: { nodes: [{ id: STATE_TODO_A, name: 'Todo', type: 'unstarted', team: { key: 'AAA' } }] } } }))
      .toEqual({ items: [{ id: STATE_TODO_A, name: 'Todo', type: 'unstarted', team: 'AAA' }], next: null });
    expect(shaped('labels', { data: { issueLabels: { nodes: [{ id: LABEL_BUG, name: 'Bug', team: null }, { id: LABEL_UI_A, name: 'UI', team: { key: 'AAA' } }] } } }))
      .toEqual({ items: [{ id: LABEL_BUG, name: 'Bug', team: null }, { id: LABEL_UI_A, name: 'UI', team: 'AAA' }], next: null });
    expect(shaped('projects', { data: { projects: { nodes: [{ id: PROJECT_X, name: 'Project X', lead: { email: 'x' } }], pageInfo: { hasNextPage: false } } } }))
      .toEqual({ items: [{ id: PROJECT_X, name: 'Project X' }], next: null });
  });

  it('anything out of the shape asked for is malformed, never passed through', () => {
    const word = (op: LinearVerb, body: unknown): unknown => callRow(op).shape(body, SHAPE);
    expect(word('issue', { data: { issue: issueNode({ identifier: 'not an id' }) } })).toEqual({ ok: false, word: 'malformed' });
    expect(word('issue', { data: { issue: issueNode({ priority: 9 }) } })).toEqual({ ok: false, word: 'malformed' });
    expect(word('issue', { data: { issue: issueNode({ createdAt: 'yesterday' }) } })).toEqual({ ok: false, word: 'malformed' });
    expect(word('issue', { data: { issue: issueNode({ title: 3 }) } })).toEqual({ ok: false, word: 'malformed' });
    expect(word('issue', { data: {} })).toEqual({ ok: false, word: 'malformed' });
    expect(word('issue', 'text')).toEqual({ ok: false, word: 'malformed' });
    expect(word('issue', { data: { issue: null } })).toEqual({ ok: false, word: 'not-found' });
    expect(word('users', { data: { users: { nodes: [{ id: 'x', name: 'n', displayName: null, active: true }], pageInfo: { hasNextPage: false } } } }))
      .toEqual({ ok: false, word: 'malformed' });
    expect(word('users', { data: { users: { nodes: [], pageInfo: { hasNextPage: true } } } })).toEqual({ ok: false, word: 'malformed' });
  });

  it('a GraphQL errors array: RATELIMITED is rate-limited, any other code unreachable, and the message is never kept', () => {
    expect(LINEAR_ERROR_CODES).toEqual({ RATELIMITED: 'rate-limited' });
    expect(callRow('issue').shape(RATELIMITED_ERRORS, SHAPE)).toEqual({ ok: false, word: 'rate-limited' });
    const other = { errors: [{ message: 'secret detail lin_api_fixture', extensions: { code: 'SOMETHING_ELSE' } }], data: null };
    const r = callRow('create').shape(other, SHAPE);
    expect(r).toEqual({ ok: false, word: 'unreachable' });
    expect(JSON.stringify(r)).not.toContain('secret');
    expect(callRow('issue').shape({ errors: [{ message: 'x' }], data: { issue: null } }, SHAPE)).toEqual({ ok: false, word: 'unreachable' });
    expect(shapeLinearResolve(RATELIMITED_ERRORS, { issue: true, parent: false })).toEqual({ ok: false, word: 'rate-limited' });
  });

  it('a write answers the issue it made, and gives the journal its result', () => {
    expect(callRow('create').shape({ data: { issueCreate: { success: true, issue: issueNode({ identifier: 'AAA-40' }) } } }, SHAPE))
      .toMatchObject({ ok: true, result: 'AAA-40', answer: { issue: { identifier: 'AAA-40', url: issueUrl('ws-a', 'AAA-40') } } });
    expect(callRow('update').shape({ data: { issueUpdate: { success: true, issue: issueNode() } } }, SHAPE))
      .toMatchObject({ ok: true, result: null, answer: { issue: { identifier: 'AAA-12' } } });
    expect(callRow('comment').shape({ data: { commentCreate: { success: true, comment: { id: COMMENT_ID, createdAt: '2026-10-31T10:00:00Z' } } } }, SHAPE))
      .toEqual({ ok: true, result: COMMENT_ID, answer: { comment: { createdAt: '2026-10-31T10:00:00Z' } } });
    expect(callRow('create').shape({ data: { issueCreate: { success: false, issue: null } } }, SHAPE)).toEqual({ ok: false, word: 'unreachable' });
  });

  it('teams and workspaces, answered from the store, clean every name', () => {
    expect(shapeLinearTeams('ws-a', [{ key: 'aaa', name: 'Team\u202E A' }, { key: 'bad key', name: 'x' }]))
      .toEqual([{ workspace: 'ws-a', key: 'AAA', name: 'Team A' }]);
    expect(shapeLinearWorkspaces([
      { urlKey: 'ws-a', name: 'Work\u200Bspace', teamKeys: ['AAA', 'bbb'], state: 'connected' },
      { urlKey: null, name: null, teamKeys: [], state: 'details-unknown' },
    ])).toEqual([
      { workspace: 'ws-a', name: 'Work space', teams: ['AAA', 'BBB'], state: 'connected' },
      { workspace: null, name: null, teams: [], state: 'details-unknown' },
    ]);
  });
});

// ── provenance and outbound text ──

describe('provenance and the linear-egress pass (spec §5.4, R7, §13.4)', () => {
  it('the line is fixed and holds no identifier', () => {
    expect(LINEAR_PROVENANCE_LINE).toBe('— written by a ccrc fleet session');
    expect(LINEAR_PROVENANCE_LINE).not.toMatch(/[0-9]|[A-Z]{2,}-|claude|lane|project-|ws-|@/);
  });

  it('a comment and a created description end with the line, after a blank line', () => {
    const c = linearOutbound(valid('comment', { ref: 'AAA-12', body: { body: 'Done.' } }));
    expect(c.input.fields.body).toBe(`Done.\n\n${LINEAR_PROVENANCE_LINE}`);
    const cr = linearOutbound(valid('create', { body: { team: 'AAA', title: 'T', description: 'Steps' } }));
    expect(cr.input.fields.description).toBe(`Steps\n\n${LINEAR_PROVENANCE_LINE}`);
    expect(cr.input.fields.title).toBe('T');
  });

  it('an update of a description that already ends with the line adds no second one', () => {
    const read = `Steps\n\n${LINEAR_PROVENANCE_LINE}`;
    for (const d of [read, `${read}\n`, `${read}\n\n`]) {
      const u = linearOutbound(valid('update', { ref: 'AAA-12', body: { description: d } }));
      expect(u.input.fields.description).toBe(d);
      expect(u.input.fields.description!.split(LINEAR_PROVENANCE_LINE)).toHaveLength(2);
    }
    expect(withLinearProvenance(withLinearProvenance('x'))).toBe(`x\n\n${LINEAR_PROVENANCE_LINE}`);
    // A line that only quotes it in the middle of a line is not the line.
    expect(withLinearProvenance(`see "${LINEAR_PROVENANCE_LINE}"`)).toBe(`see "${LINEAR_PROVENANCE_LINE}"\n\n${LINEAR_PROVENANCE_LINE}`);
  });

  it('an update or a create with no description adds none, and a search never gets one', () => {
    expect(linearOutbound(valid('update', { ref: 'AAA-12', body: { title: 'T' } })).input.fields).toEqual({ title: 'T' });
    expect(linearOutbound(valid('create', { body: { team: 'AAA', title: 'T' } })).input.fields).toEqual({ title: 'T' });
    expect(linearOutbound(valid('search', { body: { text: 'x' } })).input.fields).toEqual({ text: 'x' });
  });

  it('every outbound text passes linear-egress, masked and counted, and the line is appended after it', () => {
    const c = linearOutbound(valid('comment', { ref: 'AAA-12', body: { body: `key ${KEY_1} here` } }));
    expect(c.masked).toBe(1);
    expect(c.input.fields.body).not.toContain(KEY_1);
    expect(c.input.fields.body!.endsWith(`\n\n${LINEAR_PROVENANCE_LINE}`)).toBe(true);
    const s = linearOutbound(valid('search', { body: { text: `GH_TOKEN=${KEY_2}` } }));
    expect(s.masked).toBe(1);
    expect(s.input.fields.text).not.toContain(KEY_2);
    const u = linearOutbound(valid('update', { ref: 'AAA-12', body: { title: `t ${KEY_1}`, description: `d ${KEY_2}` } }));
    expect(u.masked).toBe(2);
    // Prose the command-line profile would mangle comes through as it was.
    const sha = 'a'.repeat(40);
    const prose = `see ${sha} and docs/superpowers/specs/2026-10-31-linear-central-key-design.md`;
    const p = linearOutbound(valid('comment', { ref: 'AAA-12', body: { body: prose } }));
    expect(p.masked).toBe(0);
    expect(p.input.fields.body).toBe(`${prose}\n\n${LINEAR_PROVENANCE_LINE}`);
  });
});

// ── the directory, filled in the background only ──

describe('the directory and the refresher\'s directory pass (spec §4.4, R5)', () => {
  interface Sent { auth: string; query: string; variables: Record<string, unknown> }
  interface Box {
    dir: string;
    clock: { now: number };
    fx: ReturnType<typeof linearServicesFake>;
    sent: Sent[];
    answer: (s: Sent) => Promise<LinearAnswer>;
  }
  const SLOT: LinearSlotRef = { source: 'file', id: WS_A };
  const ok = (body: unknown): LinearAnswer => linearAnswer({ ok: true, status: 200, json: async () => body });
  const conn = (nodes: unknown[], endCursor: string | null = null): Record<string, unknown> =>
    ({ nodes, pageInfo: { hasNextPage: endCursor !== null, endCursor } });
  /** One page of each collection, as the four directory documents ask. */
  const pageFor = (s: Sent): unknown => {
    if (s.query === LINEAR_DOCUMENTS.directoryStates) {
      return { data: { workflowStates: conn([{ id: STATE_TODO_A, name: 'Todo\u202E', type: 'unstarted', team: { key: 'AAA' } }]) } };
    }
    if (s.query === LINEAR_DOCUMENTS.directoryLabels) return { data: { issueLabels: conn([{ id: LABEL_BUG, name: 'Bug', team: null }]) } };
    if (s.query === LINEAR_DOCUMENTS.directoryProjects) return { data: { projects: conn([{ id: PROJECT_X, name: 'Project X' }]) } };
    if (s.query === LINEAR_DOCUMENTS.directoryUsers) {
      return { data: { viewer: { id: VIEWER }, users: conn([
        { id: USER_A, name: 'user-a', displayName: 'User A', active: true },
        { id: USER_B, name: 'user-b', displayName: null, active: false },
      ]) } };
    }
    throw new Error('box: not a directory document');
  };
  const box = (): Box => {
    const dir = path.join(mkTmp('ccrc-linear-ops-'), '.ccrc');
    mkdirSync(dir, { recursive: true });
    const clock = { now: T };
    const sent: Sent[] = [];
    const b: Box = { dir, clock, sent, answer: async (s) => ok(pageFor(s)), fx: undefined as unknown as Box['fx'] };
    const f: FetchLike = async (_u, init) => {
      const parsed = JSON.parse(init.body) as { query: string; variables: Record<string, unknown> };
      const s = { auth: init.headers['authorization'] ?? '', query: parsed.query, variables: parsed.variables };
      sent.push(s);
      return b.answer(s);
    };
    b.fx = linearServicesFake({ clock: () => clock.now, ccrcDir: dir, fetch: f });
    return b;
  };
  const record = (key: string): LinearStoreRecord => ({
    workspaceId: WS_A, name: 'Workspace', urlKey: 'ws-a', user: 'user-a', teams: [{ ...TEAM_A, name: 'Team A' }], teamsAt: T,
    keyTail: keyTailOf(key), keyDigest: valueDigestHex(key), checkedAt: T, outcome: 'ok',
  });
  const put = (b: Box, key: string): Promise<unknown> => putLinearSlot(b.dir, key, record(key), { replace: true });
  const D1 = valueDigestHex(KEY_1);

  it('a name the directory lacks answers name-unknown refreshing with Retry-After, queues one refresh, and makes no Linear call in the request', async () => {
    const b = box();
    await put(b, KEY_1);
    const before = b.fx.refresher.directory.get(SLOT, D1);
    expect(before).toBeNull();
    const v = callRow('update').variables(valid('update', { ref: 'AAA-12', body: { state: 'Todo' } }), ctxOf({ directory: before }));
    expect(v).toEqual({ ok: false, word: 'name-unknown', field: 'state' });
    expect(b.fx.refresher.nameMiss(SLOT)).toBe('refreshing');
    expect(LINEAR_MISS_RETRY_AFTER_S).toBe(10);
    // Answered at once: nothing reached the fake inside the request.
    expect(b.sent).toHaveLength(0);
    // A second miss while it is queued queues nothing new.
    expect(b.fx.refresher.nameMiss(SLOT)).toBe('refreshing');
    await b.fx.refresher.idle();
    expect(b.sent.map((s) => s.query)).toEqual(LINEAR_DIRECTORY_COLLECTIONS.map((c) => LINEAR_DIRECTORY_DOCUMENTS[c]));
    // The retry after the refresh resolves the name, cleaned, from the directory the refresher filled.
    const filled = b.fx.refresher.directory.get(SLOT, D1);
    expect(filled).toEqual({
      viewerId: VIEWER,
      states: [{ id: STATE_TODO_A, name: 'Todo', type: 'unstarted', teamKey: 'AAA' }],
      labels: [{ id: LABEL_BUG, name: 'Bug', teamKey: null }],
      projects: [{ id: PROJECT_X, name: 'Project X' }],
      users: [{ id: USER_A, name: 'user-a', displayName: 'User A' }],
    });
    expect(varsOf('update', valid('update', { ref: 'AAA-12', body: { state: 'todo', assignee: 'me' } }), ctxOf({ directory: filled })))
      .toEqual({ id: ISSUE_ID, input: { stateId: STATE_TODO_A, assigneeId: VIEWER } });
  });

  it('at most once in ten minutes a slot: inside the window a miss is unknown, and after it refreshes again', async () => {
    const b = box();
    await put(b, KEY_1);
    expect(LINEAR_DIRECTORY_REFRESH_MS).toBe(10 * MIN);
    b.fx.refresher.nameMiss(SLOT);
    await b.fx.refresher.idle();
    expect(b.sent).toHaveLength(4);
    b.clock.now = T + 10 * MIN - 1;
    expect(b.fx.refresher.nameMiss(SLOT)).toBe('unknown');
    await b.fx.refresher.idle();
    expect(b.sent).toHaveLength(4);
    b.clock.now = T + 10 * MIN;
    expect(b.fx.refresher.nameMiss(SLOT)).toBe('refreshing');
    await b.fx.refresher.idle();
    expect(b.sent).toHaveLength(8);
  });

  it('pages 250 a page, up to 4 pages a collection, with the cursor; a fifth page is never asked', async () => {
    const b = box();
    await put(b, KEY_1);
    b.answer = async (s) => (s.query === LINEAR_DOCUMENTS.directoryProjects
      ? ok({ data: { projects: conn([{ id: PROJECT_X, name: `P ${String(s.variables['after'])}` }], `c${Number(String(s.variables['after'] ?? 'c0').slice(1)) + 1}`) } })
      : ok(pageFor(s)));
    b.fx.refresher.nameMiss(SLOT);
    await b.fx.refresher.idle();
    const projectPages = b.sent.filter((s) => s.query === LINEAR_DOCUMENTS.directoryProjects);
    expect(projectPages.map((s) => s.variables['after'])).toEqual([null, 'c1', 'c2', 'c3']);
    expect(b.fx.refresher.directory.get(SLOT, D1)?.projects).toHaveLength(4);
  });

  it('reads the slot\'s key before each page, and a key replaced mid-refresh stops it, recording nothing', async () => {
    const b = box();
    await put(b, KEY_1);
    b.answer = async (s) => {
      if (s.query === LINEAR_DOCUMENTS.directoryLabels) await put(b, KEY_2);
      return ok(pageFor(s));
    };
    b.fx.refresher.nameMiss(SLOT);
    await b.fx.refresher.idle();
    expect(b.sent.map((s) => s.auth)).toEqual([KEY_1, KEY_1]);
    expect(b.fx.refresher.directory.get(SLOT, D1)).toBeNull();
    expect(b.fx.refresher.directory.get(SLOT, valueDigestHex(KEY_2))).toBeNull();
  });

  it('is kept only whole: a failed page leaves the directory as it was', async () => {
    const b = box();
    await put(b, KEY_1);
    b.answer = async (s) => (s.query === LINEAR_DOCUMENTS.directoryUsers
      ? linearAnswer({ ok: false, status: 500, json: async () => ({}) }) : ok(pageFor(s)));
    b.fx.refresher.nameMiss(SLOT);
    await b.fx.refresher.idle();
    expect(b.sent).toHaveLength(4);
    expect(b.fx.refresher.directory.get(SLOT, D1)).toBeNull();
  });

  it('is charged to the slot\'s floor: a spent floor refuses it with no call, and leaves the other lanes whole', async () => {
    const b = box();
    await put(b, KEY_1);
    while (b.fx.rate.take({ lane: 'floor', slot: SLOT, calls: 1 }).ok) { /* spend the floor */ }
    expect(b.fx.refresher.nameMiss(SLOT)).toBe('refreshing');
    await b.fx.refresher.idle();
    expect(b.sent).toHaveLength(0);
    expect(b.fx.rate.take({ lane: 'request', slot: SLOT, calls: 25 }).ok).toBe(true);
    expect(b.fx.rate.take({ lane: 'proxy', slot: SLOT, calls: 425 }).ok).toBe(true);
  });

  it('a team miss and a name miss are two jobs of the one queue, one slot at a time', async () => {
    const b = box();
    await put(b, KEY_1);
    b.fx.refresher.nameMiss(SLOT);
    await b.fx.refresher.idle();
    // A name miss inside its window does not stop a team refresh, and the other way about.
    const listed = await readLinearStore(b.dir);
    if (listed.kind !== 'listed') throw new Error('not listed');
    b.clock.now = T + 6 * MIN;
    b.answer = async (s) => (s.query.startsWith('query KeyCheck')
      ? ok({ data: { viewer: { name: 'user-a' }, organization: { id: WS_A, name: 'Workspace', urlKey: 'ws-a' },
        teams: { nodes: [{ ...TEAM_A, name: 'Team A' }], pageInfo: { hasNextPage: false, endCursor: null } } } })
      : ok(pageFor(s)));
    expect(b.fx.refresher.miss(listed)).toBe('refreshing');
    expect(b.fx.refresher.nameMiss(SLOT)).toBe('unknown');
    await b.fx.refresher.idle();
    expect(b.sent.slice(4).map((s) => s.query.split(' ')[1])).toEqual(['KeyCheck($after:']);
  });

  it('keyed by slot and key digest: another key\'s lookup finds nothing', () => {
    const d = new LinearDirectory();
    d.put(SLOT, D1, DIR, T);
    expect(d.get(SLOT, D1)).toEqual(DIR);
    expect(d.get(SLOT, valueDigestHex(KEY_2))).toBeNull();
    expect(d.get({ source: 'legacy' }, D1)).toBeNull();
    expect(d.filledAt(SLOT, D1)).toBe(T);
  });

  it('a directory page out of its grammar is malformed; inactive users are not held', () => {
    expect(readLinearDirectoryPage('states', { data: { workflowStates: conn([{ id: 'x', name: 'n', type: 't', team: { key: 'AAA' } }]) } }))
      .toEqual({ ok: false, word: 'malformed' });
    expect(readLinearDirectoryPage('users', { data: { users: conn([]) } })).toEqual({ ok: false, word: 'malformed' });
    expect(readLinearDirectoryPage('labels', RATELIMITED_ERRORS)).toEqual({ ok: false, word: 'rate-limited' });
    const big = Array.from({ length: 251 }, () => ({ id: PROJECT_X, name: 'p' }));
    expect(readLinearDirectoryPage('projects', { data: { projects: conn(big) } })).toEqual({ ok: false, word: 'malformed' });
    const users = readLinearDirectoryPage('users', pageFor({ auth: '', query: LINEAR_DOCUMENTS.directoryUsers, variables: {} }));
    expect(users).toMatchObject({ ok: true, viewerId: VIEWER, users: [{ id: USER_A }] });
  });
});

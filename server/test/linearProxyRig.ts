/**
 * The Linear proxy's test rig (#1444, spec §6, plan task LK9): slots on a fixture home, a Linear stand-in that answers
 * each fixed document in the shape the spec gives it, and the twelve routes, either through `buildServer` (the real
 * wiring: the gate, the box token, `attributionVerdict` over the fixture registry) or registered alone on a Fastify
 * instance with the outer limiter `server.ts` registers (for the rows that need a clock or many sessions).
 *
 * NOTHING HERE IS RECORDED. The answers below are written from the spec's shapes (§4.1, §4.4, §4.5, §5.4) and the
 * operation table's documents; the coordinator's FX capture (D-7684) has not run, so no `X-Complexity`, header value
 * or error code here stands for one Linear sent. Fixture vocabulary only: workspaces `ws-a` and `ws-b`, team keys
 * `AAA` and `BBB`, keys of the shape `lin_api_fixture…`, fixed UUIDs, sessions `project-a-…`.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import Fastify, { type FastifyInstance, type LightMyRequestResponse } from 'fastify';
import fastifyRateLimit from '@fastify/rate-limit';
import type { DatabaseSync } from 'node:sqlite';
import { buildServer, type Deps } from '../src/server.js';
import type { FetchLike } from '../src/linear/client.js';
import { keyTailOf } from '../src/linear/connection.js';
import { LINEAR_PROXY_ROUTES, registerLinearProxyRoutes } from '../src/linear/proxyRoutes.js';
import type { LinearVerb } from '../src/linear/ops.js';
import type { LinearWritePolicy } from '../src/linear/policy.js';
import { putLinearSlot, writeLegacyTeams } from '../src/linear/store.js';
import { valueDigestHex } from '../src/token/files.js';
import type { AttributionRead } from '../src/coord/openRun.js';
import { linearAnswer, type LinearAnswer } from './linearFetchFake.js';
import { linearServicesFake, type LinearServicesFake } from './linearServicesFake.js';
import { seedRow } from './idGateFixture.js';
import { testDeps } from './helpers.js';
import { mkTmp } from './tmpHelpers.js';

export const PROXY_TOKEN = 'e'.repeat(64);

/** Two fixture workspaces, each with its fixed ids. */
export const WS = {
  a: {
    id: 'aaaaaaaa-0000-4000-8000-00000000000a', urlKey: 'ws-a', name: 'Workspace A',
    key: 'lin_api_fixtureAlphaQ7mK2pX9vR4sT8wY1zB6nC3dF5gH0jL',
    teams: [{ id: 'aaaaaaaa-1111-4000-8000-00000000000a', key: 'AAA', name: 'Team A' }],
  },
  b: {
    id: 'bbbbbbbb-0000-4000-8000-00000000000b', urlKey: 'ws-b', name: 'Workspace B',
    key: 'lin_api_fixtureBravoW3eR6tY9uI2oP5aS8dF1gH4jK7lZ0x',
    teams: [{ id: 'bbbbbbbb-1111-4000-8000-00000000000b', key: 'BBB', name: 'Team B' }],
  },
} as const;
export type WsName = keyof typeof WS;

/** The fixed UUIDs a stand-in answer carries. */
export const IDS = {
  issue: 'cccccccc-0000-4000-8000-00000000000c',
  parent: 'cccccccc-0000-4000-8000-0000000000aa',
  comment: 'dddddddd-0000-4000-8000-00000000000d',
  state: 'eeeeeeee-0000-4000-8000-00000000000e',
  label: 'eeeeeeee-0000-4000-8000-0000000000e1',
  project: 'eeeeeeee-0000-4000-8000-0000000000e2',
  user: 'eeeeeeee-0000-4000-8000-0000000000e3',
  viewer: 'eeeeeeee-0000-4000-8000-0000000000e4',
} as const;

/** The calling session the rig seeds in the registry (`idGateFixture`'s row: uuid `u-<id>`). */
export const SESSION = 'project-a-calm-mesa';
export const who = (id: string = SESSION): { id: string; uuid: string } => ({ id, uuid: `u-${id}` });

const T0 = '2026-10-01T00:00:00.000Z';
const T1 = '2026-10-02T00:00:00.000Z';

/** The operation name a document declares (`query Issue(`, `mutation IssueCreate(`). */
export const opNameOf = (document: string): string => /^(?:query|mutation)\s+([A-Za-z]+)/.exec(document)?.[1] ?? '?';

/** One Linear issue, as the operation table's issue documents select it. */
export const issueNode = (identifier: string, over: Record<string, unknown> = {}): Record<string, unknown> => ({
  id: IDS.issue, identifier, title: 'A fixture title', description: 'A fixture description', priority: 2,
  createdAt: T0, updatedAt: T1, team: { key: identifier.slice(0, identifier.lastIndexOf('-')) },
  state: { name: 'Todo', type: 'unstarted' }, assignee: { name: 'User A' }, labels: { nodes: [{ name: 'Bug' }] },
  project: { name: 'Project A' }, parent: null, ...over,
});
const resolvedNode = (identifier: string, team: { id: string; key: string }, id: string = IDS.issue) =>
  ({ id, identifier, team: { id: team.id, key: team.key } });
const done = { hasNextPage: false, endCursor: null };

/** The team a reference's prefix names among the fixture workspaces. */
const teamOfRef = (ref: string): { id: string; key: string } => {
  const key = ref.slice(0, ref.lastIndexOf('-')).toUpperCase();
  for (const w of Object.values(WS)) for (const t of w.teams) if (t.key === key) return t;
  return WS.a.teams[0];
};

/** What the stand-in answers each document with, by default: the spec's shapes, data only. */
export function defaultBody(op: string, vars: Record<string, unknown>, key: string): unknown {
  const ws = Object.values(WS).find((w) => w.key === key) ?? WS.a;
  switch (op) {
    case 'Issue': return { data: { issue: issueNode(String(vars['id'])) } };
    case 'Search': {
      const { description: _d, ...item } = issueNode('AAA-12');
      return { data: { issues: { nodes: [item], pageInfo: done } } };
    }
    case 'Comments': return { data: { issue: { comments: { nodes: [{ id: IDS.comment, body: 'A fixture comment', createdAt: T0, user: { name: 'User A' } }], pageInfo: done } } } };
    case 'Statuses': return { data: { workflowStates: { nodes: [{ id: IDS.state, name: 'Todo', type: 'unstarted', team: { key: 'AAA' } }] } } };
    case 'Projects': return { data: { projects: { nodes: [{ id: IDS.project, name: 'Project A' }], pageInfo: done } } };
    case 'Labels': return { data: { issueLabels: { nodes: [{ id: IDS.label, name: 'Bug', team: { key: 'AAA' } }] } } };
    case 'Users': return { data: { users: { nodes: [{ id: IDS.user, name: 'User A', displayName: 'usera', active: true }], pageInfo: done } } };
    case 'IssueCreate': return { data: { issueCreate: { success: true, issue: issueNode('AAA-100') } } };
    case 'IssueUpdate': return { data: { issueUpdate: { success: true, issue: issueNode('AAA-12') } } };
    case 'CommentCreate': return { data: { commentCreate: { success: true, comment: { id: IDS.comment, createdAt: T1 } } } };
    case 'ResolveIssue': return { data: { issue: resolvedNode(String(vars['id']), teamOfRef(String(vars['id']))) } };
    case 'ResolveIssueAndParent': return { data: {
      issue: resolvedNode(String(vars['id']), teamOfRef(String(vars['id']))),
      parent: resolvedNode(String(vars['parent']), teamOfRef(String(vars['parent'])), IDS.parent),
    } };
    case 'ResolveParent': return { data: { parent: resolvedNode(String(vars['parent']), teamOfRef(String(vars['parent'])), IDS.parent) } };
    case 'DirectoryStates': return { data: { workflowStates: { nodes: [{ id: IDS.state, name: 'Todo', type: 'unstarted', team: { key: ws.teams[0].key } }], pageInfo: done } } };
    case 'DirectoryLabels': return { data: { issueLabels: { nodes: [{ id: IDS.label, name: 'Bug', team: null }], pageInfo: done } } };
    case 'DirectoryProjects': return { data: { projects: { nodes: [{ id: IDS.project, name: 'Project A' }], pageInfo: done } } };
    case 'DirectoryUsers': return { data: { viewer: { id: IDS.viewer }, users: { nodes: [{ id: IDS.user, name: 'User A', displayName: 'usera', active: true }], pageInfo: done } } };
    case 'KeyCheck': return { data: {
      viewer: { name: 'User A' }, organization: { id: ws.id, name: ws.name, urlKey: ws.urlKey },
      teams: { nodes: ws.teams.map((t) => ({ ...t })), pageInfo: done },
    } };
    default: return { errors: [{ message: 'the rig has no answer for this document' }] };
  }
}

/** One call the stand-in saw. */
export interface SeenCall { op: string; document: string; variables: Record<string, unknown>; authorization: string; body: string }

/** How the stand-in answers one call: an answer, or a body for a 200, or a promise of either. */
export type Responder = (call: SeenCall) => LinearAnswer | { body: unknown } | null | Promise<LinearAnswer | { body: unknown } | null>;

/** A Linear stand-in: records every call, and answers through `respond` (null there falls back to the defaults). */
export function linearStandIn(respond?: Responder): { fetch: FetchLike; calls: SeenCall[] } {
  const calls: SeenCall[] = [];
  const fetch: FetchLike = async (_url, init) => {
    const parsed = JSON.parse(init.body) as { query: string; variables: Record<string, unknown> };
    const seen: SeenCall = {
      op: opNameOf(parsed.query), document: parsed.query, variables: parsed.variables ?? {},
      authorization: init.headers['authorization'] ?? '', body: init.body,
    };
    calls.push(seen);
    // As `fetch` does: the deadline's abort rejects the call, whatever the answer is waiting on.
    const aborted = new Promise<never>((_resolve, reject) => {
      if (init.signal.aborted) reject(new Error('aborted'));
      init.signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true });
    });
    const own = respond === undefined ? null : await Promise.race([Promise.resolve(respond(seen)), aborted]);
    if (own !== null && 'status' in own) return own;
    const body = own !== null ? own.body : defaultBody(seen.op, seen.variables, seen.authorization);
    return linearAnswer({ ok: true, status: 200, json: async () => body });
  };
  return { fetch, calls };
}

/** A non-2xx answer, with headers. */
export const statusAnswer = (status: number, headers: Record<string, string> = {}, body: unknown = {}): LinearAnswer =>
  linearAnswer({ ok: status >= 200 && status < 300, status, headers, json: async () => body });

/** A file slot for a fixture workspace, its record learned and checked `ok` (as an add's check leaves it). */
export async function seedSlot(ccrcDir: string, name: WsName, over: { key?: string; teams?: { id: string; key: string; name: string }[]; teamsAt?: number } = {}): Promise<void> {
  const w = WS[name];
  const key = over.key ?? w.key;
  await putLinearSlot(ccrcDir, key, {
    workspaceId: w.id, name: w.name, urlKey: w.urlKey, user: 'User A', teams: (over.teams ?? w.teams).map((t) => ({ ...t })),
    teamsAt: over.teamsAt ?? Date.now(), keyTail: keyTailOf(key), keyDigest: valueDigestHex(key), checkedAt: Date.now(), outcome: 'ok',
  }, { replace: true });
}

/** The legacy pair (`linear.key` and its v1 `linear.json`), and, when `learned`, the `legacy-teams.json` its Check
 *  again would have left for `ws`. */
export async function seedLegacy(ccrcDir: string, ws: WsName, opts: { learned: boolean; key?: string }): Promise<string> {
  const w = WS[ws];
  const key = opts.key ?? `${w.key}Legacy`;
  mkdirSync(ccrcDir, { recursive: true });
  writeFileSync(path.join(ccrcDir, 'linear.key'), `${key}\n`, { mode: 0o600 });
  writeFileSync(path.join(ccrcDir, 'linear.json'), `${JSON.stringify({
    v: 1, org: w.name, user: 'User A', keyTail: keyTailOf(key), keyDigest: valueDigestHex(key), checkedAt: 1, outcome: 'ok',
  })}\n`, { mode: 0o600 });
  if (opts.learned) {
    await writeLegacyTeams(ccrcDir, valueDigestHex(key), {
      workspaceId: w.id, name: w.name, urlKey: w.urlKey, teams: w.teams.map((t) => ({ ...t })), teamsAt: Date.now(),
    });
  }
  return key;
}

export interface ProxyRigOpts {
  /** `buildServer` (the default) or the routes alone. */
  via?: 'server' | 'direct';
  authEnabled?: boolean;
  respond?: Responder;
  clock?: () => number;
  /** A policy in place of `allowAll`; null for none. */
  policy?: LinearWritePolicy | null;
  /** Leave a service out (D-7684). */
  absent?: readonly ('rate' | 'refresher' | 'journal' | 'policy')[];
  /** `direct` only: attribution in place of the registry's (every `u-<id>` pair is vouched for by default). */
  attribute?: (id: string, uuid: string) => Promise<AttributionRead>;
  /** The coord.db the journal writes (a fresh in-memory one by default). */
  db?: DatabaseSync;
  timeoutMs?: number;
  /** `server` only: the box token the server holds; null for a server never given one. */
  mailToken?: string | null;
  /** `server` only: more of `Deps` (a fleet state with caps, a runner), over the rig's own. */
  over?: Partial<Deps>;
  /** `server` only: more registry rows to seed beside `SESSION` (each vouched for as `u-<id>`). */
  sessions?: readonly string[];
}

export interface ProxyRig {
  app: FastifyInstance;
  home: string;
  ccrcDir: string;
  fx: LinearServicesFake;
  /** The Linear stand-in itself, for a test that calls a Linear path directly. */
  fetch: FetchLike;
  calls: SeenCall[];
  /** One proxy call: the verb's route, `ref` in its path, the query (identity appended unless `as` is null), a body. */
  call: (verb: LinearVerb, o?: {
    ref?: string; query?: Record<string, string>; body?: unknown; as?: { id: string; uuid: string } | null;
    token?: string | null; headers?: Record<string, string>; rawQuery?: string;
  }) => Promise<LightMyRequestResponse>;
  /** Every `linear_events` row, oldest first. */
  rows: () => Record<string, unknown>[];
  close: () => Promise<void>;
}

/** The URL of a verb's route with `ref` in its path. */
export const proxyUrl = (verb: LinearVerb, ref = 'AAA-12'): string =>
  LINEAR_PROXY_ROUTES[verb].slice(LINEAR_PROXY_ROUTES[verb].indexOf(' ') + 1).replace(':id', ref);
export const proxyMethod = (verb: LinearVerb): 'GET' | 'POST' => (LINEAR_PROXY_ROUTES[verb].startsWith('GET ') ? 'GET' : 'POST');

/** A body each POST verb accepts, for the rows that drive every route. */
export const BODIES: Readonly<Partial<Record<LinearVerb, unknown>>> = {
  search: { team: 'AAA', text: 'fixture' },
  create: { team: 'AAA', title: 'A fixture title' },
  update: { title: 'A new fixture title' },
  comment: { body: 'A fixture comment' },
};

export async function proxyRig(o: ProxyRigOpts = {}): Promise<ProxyRig> {
  const home = mkTmp('ccrc-linear-proxy-');
  const ccrcDir = path.join(home, '.ccrc');
  mkdirSync(ccrcDir, { recursive: true });
  const stand = linearStandIn(o.respond);
  const fx = linearServicesFake({ clock: o.clock, db: o.db, ccrcDir, fetch: stand.fetch, timeoutMs: o.timeoutMs });
  const absent = new Set(o.absent ?? []);
  const policy = o.policy === undefined ? fx.policy : o.policy;
  let app: FastifyInstance;
  if ((o.via ?? 'server') === 'server') {
    const base = testDeps(home);
    seedRow(home, SESSION);
    for (const id of o.sessions ?? []) seedRow(home, id);
    const deps: Deps = {
      ...base,
      cfg: { ...base.cfg, authEnabled: o.authEnabled ?? false, cookieSecure: false },
      ...(o.mailToken === null ? {} : { mailToken: o.mailToken ?? PROXY_TOKEN }),
      linear: { fetch: stand.fetch, timeoutMs: o.timeoutMs },
      ...(absent.has('rate') ? {} : { linearRate: fx.rate }),
      ...(absent.has('refresher') ? {} : { linearRefresher: fx.refresher }),
      ...(absent.has('journal') ? {} : { linearJournal: fx.journal }),
      ...(absent.has('policy') || policy === null ? {} : { linearPolicy: policy }),
      ...(o.over ?? {}),
    };
    app = await buildServer(deps);
  } else {
    app = Fastify({ logger: false });
    await app.register(fastifyRateLimit, {
      global: false, hook: 'preHandler', keyGenerator: () => 'GET /api/runs/:id',
      errorResponseBuilder: () => Object.assign(new Error('rate-limited'), { statusCode: 429 }),
    });
    registerLinearProxyRoutes(app, {
      ccrcDir, mailToken: () => PROXY_TOKEN,
      attribute: o.attribute ?? (async (id, uuid) => (uuid === `u-${id}` ? { ok: true }
        : { ok: false, error: 'stale-uuid', detail: 'byUuid does not match the registry — stale sender; re-read your own .uuid' })),
      rate: absent.has('rate') ? null : fx.rate,
      refresher: absent.has('refresher') ? null : fx.refresher,
      journal: absent.has('journal') ? null : fx.journal,
      policy: absent.has('policy') ? null : policy,
      fetch: stand.fetch, timeoutMs: o.timeoutMs, now: o.clock,
    });
  }
  await app.ready();
  const call: ProxyRig['call'] = (verb, c = {}) => {
    const as = c.as === undefined ? who() : c.as;
    const q = new URLSearchParams(c.query ?? {});
    if (as !== null) { q.append('byId', as.id); q.append('byUuid', as.uuid); }
    const qs = c.rawQuery ?? q.toString();
    const headers: Record<string, string> = { ...(c.token === null ? {} : { 'x-ccrc-mail-token': c.token ?? PROXY_TOKEN }), ...(c.headers ?? {}) };
    const body = c.body === undefined ? BODIES[verb] : c.body;
    const method = proxyMethod(verb);
    return app.inject({
      method, url: `${proxyUrl(verb, c.ref)}${qs === '' ? '' : `?${qs}`}`, headers,
      ...(method === 'POST' && body !== undefined ? { payload: body as Record<string, unknown> } : {}),
    });
  };
  const rows = (): Record<string, unknown>[] =>
    fx.db.prepare('SELECT * FROM linear_events ORDER BY id').all() as Record<string, unknown>[];
  return { app, home, ccrcDir, fx, fetch: stand.fetch, calls: stand.calls, call, rows, close: () => app.close() };
}

/** A response body, parsed. */
export const bodyOf = (res: LightMyRequestResponse): Record<string, unknown> => JSON.parse(res.body) as Record<string, unknown>;

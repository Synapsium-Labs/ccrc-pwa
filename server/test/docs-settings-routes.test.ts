// X2 P4.3: the settings doors over Fastify, a stateful store fake and the real account gate.
import { afterEach, describe, expect, it } from 'vitest';
import Fastify, { type FastifyInstance, type FastifyRequest } from 'fastify';
import { createAccountGate, type AccountGate, type AccountGateAsk } from '../src/accounts/gate.js';
import { NO_SESSION, type GateDecision } from '../src/auth/gate.js';
import { installDocsRequestPolicy, installDocsResponsePolicy } from '../src/docs/hooks.js';
import type { DocsSignIn } from '../src/docs/policy.js';
import { registerDocsSettingsRoutes } from '../src/docs/routes.js';
import { refuseRoute } from '../src/refuse.js';
import {
  EMPTY_DOCS_SETTINGS, settingsWidening, type DocsSettings, type DocsSettingsStoreWrite,
  type DocsSettingsStored, type TrackerRule,
} from '../../shared/docsTracker.js';
import { FOLDER_COOKIE, FOLDER_STEP_UP_HEADER, folderHeaders } from './docsRouteHelpers.js';

const URL_SETTINGS = '/api/docs/settings';
const NOW = 1_700_000_000_000;
const rule = (over: Partial<TrackerRule> = {}): TrackerRule => ({
  name: 'items', pattern: '([A-Z]+)-([0-9]+)', template: 'https://tracker.example/browse/{1}-{2}', ...over,
});
const settings = (rules: TrackerRule[] = [], defaultBranches: Record<string, string> = {}): DocsSettings => ({ rules, defaultBranches });
const A = rule();
const B = rule({ name: 'other', pattern: 'T[0-9]+', template: 'https://tracker.example/t/{0}' });
type Start = { kind: 'absent' } | { kind: 'row'; settings: DocsSettings } | { kind: 'unreadable' };

function fakeStore(start: Start) {
  let cur = start;
  const log = { reads: 0, attempts: 0, writes: [] as { settings: DocsSettings; at: number }[] };
  return {
    log,
    current: (): Start => cur,
    read: (): DocsSettingsStored => {
      log.reads += 1;
      if (cur.kind === 'absent') return { kind: 'absent' };
      if (cur.kind === 'unreadable') return { kind: 'unreadable', detail: '/fixture/home/coord.db: disk I/O error' };
      return { kind: 'row', body: JSON.stringify(cur.settings), updatedAt: 5 };
    },
    write: (next: DocsSettings, at: number, authorize: () => boolean): DocsSettingsStoreWrite => {
      log.attempts += 1;
      if (cur.kind === 'unreadable') return { kind: 'unreadable' };
      const before = cur.kind === 'absent' ? EMPTY_DOCS_SETTINGS : cur.settings;
      if (settingsWidening(before, next) && !authorize()) return { kind: 'denied' };
      log.writes.push({ settings: next, at });
      cur = { kind: 'row', settings: next };
      return { kind: 'written' };
    },
  };
}

const DECISION: GateDecision = { allow: true, verdict: 'ok', reason: 'session', device: 'fixture-device' };
const hasSession = (req: Pick<FastifyRequest, 'headers'>): boolean =>
  typeof req.headers.cookie === 'string' && req.headers.cookie.includes(FOLDER_COOKIE);
const apps: FastifyInstance[] = [];
afterEach(async () => { for (const app of apps.splice(0)) await app.close(); });

async function open(start: Start, signIn: DocsSignIn = 'armed', write?: () => DocsSettingsStoreWrite) {
  const store = fakeStore(start);
  const asks: AccountGateAsk[] = [];
  const real = createAccountGate({
    enabled: signIn === 'armed', origin: 'http://localhost:7788',
    sessionAuth: (req) => hasSession(req) ? DECISION : NO_SESSION,
    fleetState: () => ({ ccdVerbs: [] }),
    stepUp: { requireRecentAssertion: () => (req, reply) => {
      if (req.headers[FOLDER_STEP_UP_HEADER] === '1') return false;
      void refuseRoute(reply, 'step-up-required');
      return true;
    } },
  });
  const gate: AccountGate = (req, reply, ask) => { asks.push(ask); return real(req, reply, ask); };
  const app = Fastify({ logger: false });
  apps.push(app);
  await app.register(async (app) => {
    installDocsRequestPolicy(app);
    installDocsResponsePolicy(app);
    registerDocsSettingsRoutes(app, { read: store.read, write: write ?? store.write, now: () => NOW, gate, signIn: () => signIn, hasSession });
  });
  const put = (payload: unknown, headers: Record<string, string> = folderHeaders({ stepUp: true })) =>
    app.inject({ method: 'PUT', url: URL_SETTINGS, headers, payload: payload as never });
  const get = (headers: Record<string, string> = folderHeaders()) => app.inject({ method: 'GET', url: URL_SETTINGS, headers });
  return { app, store, asks, put, get };
}

describe('settings: GET', () => {
  it('returns empty for absent and only settings for a row, with no-store', async () => {
    const empty = await open({ kind: 'absent' });
    const first = await empty.get();
    expect(first.json()).toEqual({ ok: true, settings: EMPTY_DOCS_SETTINGS });
    expect(first.headers['cache-control']).toBe('no-store');
    const s = settings([A, B], { 'project-a': 'main' });
    for (const signIn of ['armed', 'dark'] as const) {
      const t = await open({ kind: 'row', settings: s }, signIn);
      const res = await t.get(folderHeaders({ session: signIn === 'armed' }));
      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual({ ok: true, settings: s });
      expect(t.asks).toEqual([]);
    }
  });

  it('refuses a missing session when armed before reading', async () => {
    const t = await open({ kind: 'row', settings: settings([A]) });
    const res = await t.get(folderHeaders({ session: false }));
    expect(res.statusCode).toBe(401);
    expect(res.json()).toEqual({ ok: false, failure: 'unauthenticated' });
    expect(t.store.log.reads).toBe(0);
  });

  it('refuses an unreadable store without leaking its detail', async () => {
    const t = await open({ kind: 'unreadable' });
    const res = await t.get();
    expect(res.statusCode).toBe(502);
    expect(res.json()).toEqual({ ok: false, failure: 'unreadable', reason: 'settings-store' });
    expect(res.body).not.toContain('coord.db');
  });

  it('refuses requests without the docs marker before reading', async () => {
    const t = await open({ kind: 'absent' });
    const res = await t.app.inject({ method: 'GET', url: URL_SETTINGS, headers: { cookie: FOLDER_COOKIE } });
    expect(res.statusCode).toBe(403);
    expect(res.json().failure).toBe('foreign-request');
    expect(t.store.log.reads).toBe(0);
  });
});

describe('settings: PUT', () => {
  it('a stale removal that restores a rule requires step-up against the latest stored settings', async () => {
    const t = await open({ kind: 'row', settings: settings([A, B]) });
    expect((await t.get()).json().settings).toEqual(settings([A, B]));
    expect((await t.put({ settings: settings([A]) }, folderHeaders())).statusCode).toBe(200);
    const restore = await t.put({ settings: settings([B]) }, folderHeaders());
    expect(restore.statusCode).toBe(403);
    expect(restore.json()).toEqual({ ok: false, error: 'step-up-required' });
    expect(t.store.current()).toEqual({ kind: 'row', settings: settings([A]) });
    const authorized = await t.put({ settings: settings([B]) }, folderHeaders({ stepUp: true }));
    expect(authorized.statusCode).toBe(200);
    expect((await t.get()).json()).toEqual({ ok: true, settings: settings([B]) });
  });

  const WIDENING: readonly (readonly [string, Start, DocsSettings])[] = [
    ['adding a rule', { kind: 'row', settings: settings([A]) }, settings([A, B])],
    ['adding the first rule', { kind: 'absent' }, settings([A])],
    ['changing the host', { kind: 'row', settings: settings([A]) }, settings([rule({ template: 'https://other.example/{1}' })])],
    ['setting a branch', { kind: 'row', settings: settings([A]) }, settings([A], { 'project-a': 'main' })],
  ];
  it.each(WIDENING)('widening needs step-up and refuses dark: %s', async (_label, start, next) => {
    const dark = await open(start, 'dark');
    const refused = await dark.put({ settings: next });
    expect(refused.statusCode).toBe(501);
    expect(refused.json()).toEqual({ ok: false, error: 'auth-off' });
    expect(dark.store.log.writes).toEqual([]);
    expect(dark.asks).toEqual([{ cap: null, stepUp: true }]);
    const armed = await open(start);
    const noStep = await armed.put({ settings: next }, folderHeaders());
    expect(noStep.statusCode).toBe(403);
    expect(noStep.json()).toEqual({ ok: false, error: 'step-up-required' });
    expect(armed.store.log.writes).toEqual([]);
    const done = await armed.put({ settings: next });
    expect(done.statusCode).toBe(200);
    expect(done.json()).toEqual({ ok: true, settings: next });
    expect(armed.store.log.writes).toEqual([{ settings: next, at: NOW }]);
    expect(armed.asks).toEqual([{ cap: null, stepUp: true }, { cap: null, stepUp: true }]);
  });

  it.each([
    ['remove a rule', settings([A, B]), settings([B])],
    ['remove all', settings([A, B]), settings()],
    ['unset a branch', settings([A], { 'project-a': 'main' }), settings([A])],
  ])('narrowing works dark without a gate: %s', async (_label, before, next) => {
    const t = await open({ kind: 'row', settings: before }, 'dark');
    const res = await t.put({ settings: next }, folderHeaders({ session: false }));
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true, settings: next });
    expect(t.asks).toEqual([]);
    expect(t.store.log.writes).toEqual([{ settings: next, at: NOW }]);
  });

  it('armed without a session refuses before any store operation', async () => {
    const t = await open({ kind: 'row', settings: settings([A, B]) });
    const res = await t.put({ settings: settings([A]) }, folderHeaders({ session: false }));
    expect(res.statusCode).toBe(401);
    expect(res.json()).toEqual({ ok: false, failure: 'unauthenticated' });
    expect(t.store.log.reads).toBe(0);
    expect(t.store.log.attempts).toBe(0);
  });

  it.each([
    ['list', []], ['text', 'text'], ['missing settings', {}],
    ['extra key', { settings: settings(), extra: 1 }], ['obsolete revision', { settings: settings(), rev: 0 }],
    ['settings not an object', { settings: 'x' }], ['missing field', { settings: { rules: [] } }],
    ['rule extra key', { settings: settings([{ ...A, extra: 1 } as TrackerRule]) }],
    ['rule missing name', { settings: { rules: [{ pattern: A.pattern, template: A.template }], defaultBranches: {} } }],
    ['invalid branch', { settings: settings([], { 'project-a': '../x' }) }],
  ])('refuses a malformed body before store access: %s', async (_label, payload) => {
    const t = await open({ kind: 'absent' });
    const res = await t.put(payload);
    expect(res.statusCode).toBe(400);
    expect(res.json().failure).toBe('bad-query');
    expect(t.store.log.attempts).toBe(0);
    expect(t.store.log.reads).toBe(0);
    expect(t.asks).toEqual([]);
  });

  it('refuses malformed JSON before store access', async () => {
    const t = await open({ kind: 'absent' });
    const res = await t.app.inject({ method: 'PUT', url: URL_SETTINGS,
      headers: { ...folderHeaders({ stepUp: true }), 'content-type': 'application/json' }, payload: '{not json' });
    expect(res.statusCode).toBe(400);
    expect(res.json().failure).toBe('bad-query');
    expect(t.store.log.attempts).toBe(0);
  });

  it.each([
    ['host placeholder', rule({ template: 'https://tracker.example{1}/x' }), 'template-host'],
    ['http', rule({ template: 'http://tracker.example/{0}' }), 'template-scheme'],
    ['empty match', rule({ pattern: 'a*' }), 'pattern-empty-match'],
    ['invalid pattern', rule({ pattern: '(' }), 'pattern-invalid'],
    ['long pattern', rule({ pattern: 'a'.repeat(201) }), 'pattern-long'],
  ])('refuses a bad rule with its index: %s', async (_label, bad, why) => {
    const t = await open({ kind: 'absent' });
    const res = await t.put({ settings: settings([A, bad]) });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({ ok: false, failure: 'bad-query', why, key: 'rules.1' });
    expect(t.store.log.attempts).toBe(0);
  });

  it('refuses too many rules', async () => {
    const t = await open({ kind: 'absent' });
    const res = await t.put({ settings: settings(Array.from({ length: 21 }, () => A)) });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({ ok: false, failure: 'bad-query', why: 'too-many' });
    expect(t.store.log.attempts).toBe(0);
  });

  it('unreadable on write refuses without asking the gate or leaking detail', async () => {
    const t = await open({ kind: 'unreadable' });
    const res = await t.put({ settings: settings([A]) });
    expect(res.statusCode).toBe(502);
    expect(res.json()).toEqual({ ok: false, failure: 'unreadable', reason: 'settings-store' });
    expect(t.asks).toEqual([]);
    expect(t.store.log.writes).toEqual([]);
  });

  it('unexpected writer exceptions do not leak their text', async () => {
    const t = await open({ kind: 'absent' }, 'armed', () => { throw new Error('/fixture/home/coord.db'); });
    const res = await t.put({ settings: settings() });
    expect(res.statusCode).toBe(500);
    expect(res.body).not.toContain('coord.db');
  });
});

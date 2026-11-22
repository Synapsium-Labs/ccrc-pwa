// Overlord W1, plan w1-other-lanes Task 1: the CHARACTERIZATION of every lane in the plan's Table 1, for today's callers.
//
// Later tasks (3 and 4) make these lanes refuse one special session, the Overlord's body. This suite pins what every OTHER caller
// (a coordinator, a worker, a plain session, the operator) is answered today, so that a refusal added for the body can be shown to
// leave everybody else's answers byte for byte as they are. It must pass UNEDITED after Tasks 3 and 4.
//
// Every case runs under three designation states, each on a fresh fixture HOME and coord.db:
//   no-row               no `overlord_designation` row;
//   live-with-owed-stop  a live binding to `lane-a-overlord-quiet-oak`, and `lane-a-overlord-owed` on `stopsOwed` (a failed
//                        attempt that owed its stop, then the successful designate), seeded through the store's own writers
//                        (`designatePending`, `failPending`, `bindPendingGeneration`, `goLive`) with a fake journal appender;
//   pending-only         a pending designate attempt for `lane-a-overlord-quiet-oak`, with its generation bound.
// The callers are never the fifth or sixth id. `three` runs a door's whole transcript under each state, expects the three to be
// identical, and returns the first, which an inline snapshot then pins (status, body bytes, and the door's side effects).
//
// What a line holds: `label: status body | delta`, where the delta is the change in row COUNT of every coord.db table across the
// call (mail, mail_deliveries, mail_rejections, claims, items, runs, landing entries, ...). Doors add facts of their own.
// NORMALISATION (the only one): an ISO instant becomes `<instant>` and a 13-digit epoch-millisecond number becomes `<ms>`, because
// a claim's lease, a run's stamp and the like come from the wall clock and would differ between the three states.
//
// Already covered elsewhere (files read while writing this; this suite adds only the three-state identity and the cross-door view):
//   POST /api/mail                      mail-routes.test.ts (rejection table, 'worker' role, wave-done)
//   items (raise)                       ledgers-coordinator-routes.test.ts (attribution, ownership, bodies)
//   claims, claims release              claims-routes.test.ts
//   questions rule / release            question-doors-pin.test.ts (the whole ladder; one row per position), approvalsHarness.ts
//   coordinators intent                 coordinator-intent-route.test.ts
//   landing entries / order             landing-writes-route.test.ts
//   linear proxy writes and search      linear-proxy-routes.test.ts + linearProxyRig.ts
//   the six plan doors, plan show       plan-routes.test.ts (on a bare Fastify with an always-ok attribution; here the real server)
//   runs open                           open-run-preconditions.test.ts, runs-attribution-switch.test.ts, run-routes.test.ts
//   runs reclaim, archive hand-over     reclaim-route.test.ts, coord-reclaim.test.ts, archive-claims-choice.test.ts
import { describe, it, expect, afterEach, afterAll, vi } from 'vitest';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
import type { LightMyRequestResponse } from 'fastify';
import { buildServer, type Deps } from '../src/server.js';
import { Bus } from '../src/bus.js';
import { FleetWatcher } from '../src/watch.js';
import { quietAtTestEnd } from './laneQuiet.js';
import { Tmux, type Runner } from '../src/exec.js';
import { askKey } from '../src/askkey.js';
import { openCoordDb } from '../src/coord/db.js';
import { CoordStore } from '../src/coord/store.js';
import { createLandingJournal } from '../src/coord/landingJournal.js';
import { planStorePort } from '../src/coord/planStore.js';
import { NotifyLog } from '../src/notifylog.js';
import {
  bindPendingGeneration, designatePending, failPending, goLive, type AuthorityAppender,
} from '../src/coord/overlordDesignationStore.js';
import { gateActorOf } from '../src/accounts/audit.js';
import { attributionIdentity } from '../src/auth/attributionIdentity.js';
import { testDeps } from './helpers.js';
import { mkTmp, removeTmpFixtures } from './tmpHelpers.js';
import { ID_GATE_TOKEN } from './idGateFixture.js';
import { legacyOpens } from './helpers/plan.js';
import { standardFixture, CHILD, CHILD2, PARENT, TOK, uuidOf, type Approvals } from './approvalsHarness.js';
import { BODIES, proxyRig, seedSlot, who, type ProxyRig } from './linearProxyRig.js';
import type { BuildInfo } from '../../shared/buildinfo.js';

// ── the callers ──────────────────────────────────────────────────────────────────────────────────────────────────────────
vi.setConfig({ testTimeout: 180_000 }); // each case builds three fixture servers
const COORD = 'lane-a-project-a-coord';
const WORKER = 'lane-a-project-a-worker';
const PLAIN = 'lane-a-plain';
const DEAD = 'lane-a-dead-coord';
const HEIR = 'lane-a-heir-coord';
const ROWS = [COORD, WORKER, PLAIN, DEAD, HEIR] as const;
/** The two ids the designation holds. No case's caller is either of them. */
const OAK = 'lane-a-overlord-quiet-oak';
const OWED = 'lane-a-overlord-owed';

// ── the three designation states ─────────────────────────────────────────────────────────────────────────────────────────
const NOW = 1_800_000_000_000;
const GEN = '11111111-2222-3333-4444-555555555555';
const STATES = ['no-row', 'live-with-owed-stop', 'pending-only'] as const;
type State = typeof STATES[number];
const fakeJournal = { appendInTx: () => ({ ok: true, kind: 'appended', record: {} }) } as unknown as AuthorityAppender;
const OPERATOR = attributionIdentity({ attribute: async () => ({ ok: true }), incarnation: async () => ({ kind: 'unmeasured', reason: 'absent' }) })
  .operator(gateActorOf('operator-a', '0123456789abcdef'));

function seedDesignation(db: DatabaseSync, st: State): void {
  const row = (): unknown => db.prepare('SELECT sessionId, pendingId, stopsOwed FROM overlord_designation').get();
  if (st === 'no-row') { expect(row()).toBeUndefined(); return; }
  const des = (id: string, opKey: string): void => {
    expect(designatePending(db, fakeJournal, { sessionId: id, deadlineAt: NOW + 60_000, model: 'opus', accountPools: { pools: ['pool-a'], untagged: false },
      actor: OPERATOR, at: NOW, opKey }).ok).toBe(true);
  };
  if (st === 'pending-only') {
    des(OAK, 'op-pending');
    expect(bindPendingGeneration(db, OAK, GEN, NOW + 1)).toEqual({ ok: true, changed: true });
    expect(row()).toMatchObject({ sessionId: null, pendingId: OAK, stopsOwed: '[]' });
    return;
  }
  des(OWED, 'op-owed');
  expect(failPending(db, OWED, 'create-failed', NOW + 1, true)).toEqual({ ok: true, changed: true });
  des(OAK, 'op-live');
  expect(bindPendingGeneration(db, OAK, GEN, NOW + 2)).toEqual({ ok: true, changed: true });
  expect(goLive(db, fakeJournal, OAK, GEN, NOW + 3)).toMatchObject({ ok: true, changed: true });
  expect(row()).toMatchObject({ sessionId: OAK, pendingId: null, stopsOwed: JSON.stringify([OWED]) });
}

/** One door's whole transcript under each state: the three must be identical; the first is returned for the snapshot. */
async function three(fn: (st: State) => Promise<string>): Promise<string> {
  const outs: string[] = [];
  for (const st of STATES) outs.push(await fn(st));
  expect(outs[1], 'live-with-owed-stop answered differently from no-row').toBe(outs[0]);
  expect(outs[2], 'pending-only answered differently from no-row').toBe(outs[0]);
  return outs[0]!;
}

// ── lines ────────────────────────────────────────────────────────────────────────────────────────────────────────────────
const norm = (s: string): string => s.replace(/\/[^"\s\\]*\/ccrc-other-lanes-[A-Za-z0-9]+/g, '<home>').replace(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z/g, '<instant>').replace(/\b\d{13}\b/g, '<ms>');
const counts = (db: DatabaseSync): Record<string, number> => {
  const names = (db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all() as { name: string }[])
    .map((r) => r.name).filter((n) => n !== 'overlord_designation');
  return Object.fromEntries(names.map((n) => [n, (db.prepare(`SELECT COUNT(*) AS n FROM "${n}"`).get() as { n: number }).n]));
};
const delta = (a: Record<string, number>, b: Record<string, number>): string => {
  const d = Object.keys(b).filter((k) => b[k] !== a[k]).map((k) => `${k}${b[k]! - (a[k] ?? 0) > 0 ? '+' : ''}${b[k]! - (a[k] ?? 0)}`);
  return d.length === 0 ? 'no rows changed' : d.join(' ');
};
/** One call: its label, the status, the body's exact text and the row-count delta it caused. */
async function step(w: { db: DatabaseSync }, label: string, call: () => Promise<LightMyRequestResponse>): Promise<string> {
  const before = counts(w.db);
  const res = await call();
  return `${label}: ${res.statusCode} ${norm(res.body)} | ${delta(before, counts(w.db))}`;
}
const facts = (w: { db: DatabaseSync }, label: string, sql: string): string => `${label}: ${norm(JSON.stringify(w.db.prepare(sql).all()))}`;

// ── the shared world ─────────────────────────────────────────────────────────────────────────────────────────────────────
const PANE = 4242;
const closers: Array<() => Promise<unknown>> = [];
afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(closers.splice(0).map((close) => close().catch(() => undefined)));
  removeTmpFixtures();
});
afterAll(() => removeTmpFixtures());

interface World {
  home: string; app: Awaited<ReturnType<typeof buildServer>>; coord: CoordStore; db: DatabaseSync; calls: string[][];
  /** prog-a's run 1: claimed by COORD, dispatched to WORKER, working. */
  runId: number;
  /** prog-dead's run: claimed by DEAD, whose pane measures dead. */
  deadRunId: number;
  /** The delegation lane's applier, for the world built with a watcher. */
  checkpoint: () => Promise<string>;
}
interface Opts { over?: Partial<Deps>; role?: 'server' | 'both'; watcher?: boolean }

/** Registry rows for the five callers, a coordinator with a working run, its worker, a dead coordinator's planned run, and the
 *  designation state. Every pane is live unless it is `DEAD`'s. */
async function core(st: State, o: Opts = {}): Promise<World> {
  const home = mkTmp('ccrc-other-lanes-');
  const dir = path.join(home, '.ccrc');
  const reg = path.join(home, '.cc-sessions');
  mkdirSync(dir, { recursive: true }); mkdirSync(reg, { recursive: true });
  const db = openCoordDb(path.join(dir, 'coord.db'));
  const coord = new CoordStore(db, { landingJournal: createLandingJournal(dir), onUnusableConnection: (): never => { throw new Error('fixture fail-stop'); } });
  const replay = coord.replayLandingJournal();
  if (!replay.ok) throw new Error(`fixture replay refused: ${replay.error}`);
  for (const id of ROWS) {
    const workdir = path.join(home, 'worktrees', 'demo', id);
    mkdirSync(workdir, { recursive: true });
    const fields: Record<string, string> = { wrapper: 'claude-a', project: 'demo', workdir, uuid: `u-${id}`, started: '1', workspace: id,
      branch: `ws/${id}`, base: 'origin/main', generation: `0189abcd-1234-4678-9abc-0123456789${ROWS.indexOf(id).toString().padStart(2, '0')}` };
    for (const [k, v] of Object.entries(fields)) writeFileSync(path.join(reg, `${id}.${k}`), v);
  }
  const sess = path.join(home, '.claude-a', 'sessions');
  mkdirSync(sess, { recursive: true });
  writeFileSync(path.join(sess, `${PANE}.json`), JSON.stringify({ pid: PANE, sessionId: 'u', status: 'idle', statusUpdatedAt: Date.now() - 60_000 }));
  const calls: string[][] = [];
  const run: Runner = async (_cmd, args) => {
    calls.push([...args]);
    const verb = args[0] ?? '';
    if (verb === 'has-session') {
      const target = args[2] ?? '';
      return target.includes(DEAD)
        ? { ran: true, code: 1, stdout: '', stderr: `can't find session: ${target}` } : { ran: true, code: 0, stdout: '', stderr: '' };
    }
    if (verb === 'list-panes') return { ran: true, code: 0, stdout: `${PANE}\n`, stderr: '' };
    return { ran: true, code: 0, stdout: '', stderr: '' };
  };
  const log = new NotifyLog(path.join(home, 'notify.json'));
  await log.load();
  const base = testDeps(home, run);
  const cfg = o.role === undefined ? base.cfg : { ...base.cfg, role: o.role };
  const deps: Deps = { ...base, cfg, mailToken: ID_GATE_TOKEN, coord, plan: planStorePort(db), notifyLog: log, ...o.over };
  let app: World['app'];
  let checkpoint: World['checkpoint'] = async () => 'no watcher';
  if (o.watcher === true) {
    const bus = new Bus();
    const watcher = quietAtTestEnd(new FleetWatcher(deps as never, bus, 10_000));   // D-8140
    app = await buildServer(deps, bus, watcher);
    closers.push(() => app.close(), () => watcher.closeDelegation());
    const durable = await watcher.delegationApplier();
    if (durable === null) throw new Error('the lane opened no applier');
    checkpoint = async () => JSON.stringify(durable.state().checkpoint.sessions.map((s) => [s.sessionId, s.explicitIntentAt !== null]));
  } else {
    app = await buildServer(deps);
    closers.push(() => app.close());
  }
  legacyOpens(app, db);
  const open = (program: string, claimedBy: string): number => {
    const r = coord.openRun({ program, title: program, project: 'demo', wave: 1, waveOf: 3, claimedBy });
    if (!('id' in r)) throw new Error(`fixture openRun refused: ${JSON.stringify(r)}`);
    return r.id;
  };
  const runId = open('prog-a', COORD);
  coord.markDispatched(runId, WORKER, WORKER, `ws/${WORKER}`, false);
  for (const to of ['dispatched', 'working'] as const) if (!coord.advance(runId, to, 'coordinator').ok) throw new Error(`fixture advance to ${to} refused`);
  const deadRunId = open('prog-dead', DEAD);
  seedDesignation(db, st);
  return { home, app, coord, db, calls, runId, deadRunId, checkpoint };
}

const post = (w: World, url: string, payload: unknown, headers: Record<string, string> = TOK) =>
  w.app.inject({ method: 'POST', url, headers, payload: payload as never });
const get = (w: World, url: string, headers: Record<string, string> = TOK) => w.app.inject({ method: 'GET', url, headers });
const as = (id: string): { byId: string; byUuid: string } => ({ byId: id, byUuid: `u-${id}` });
const stale = (id: string): { byId: string; byUuid: string } => ({ byId: id, byUuid: 'u-stale' });
const mailFrom = (id: string, o: Record<string, unknown>): Record<string, unknown> =>
  ({ fromId: id, fromUuid: `u-${id}`, kind: 'finding', subject: 'a finding', body: 'the body', artifacts: [], ...o });

describe('POST /api/mail', () => {
  it('a coordinator\'s run mail, a worker\'s wave-done, a plain peer mail, a stale uuid and an unknown sender', async () => {
    expect(await three(async (st) => {
      const w = await core(st);
      const L: string[] = [];
      L.push(await step(w, 'coordinator -> worker, run mail', () => post(w, '/api/mail', mailFrom(COORD, { toId: 'worker', runId: w.runId, kind: 'status', subject: 'go' }))));
      L.push(await step(w, 'worker wave-done -> coordinator', () => post(w, '/api/mail', mailFrom(WORKER, { toId: 'coordinator', runId: w.runId, kind: 'status', subject: 'wave-done' }))));
      L.push(await step(w, 'plain peer mail', () => post(w, '/api/mail', mailFrom(PLAIN, { toId: COORD }))));
      L.push(await step(w, 'stale fromUuid', () => post(w, '/api/mail', { ...mailFrom(PLAIN, { toId: COORD }), fromUuid: 'stale-uuid' })));
      L.push(await step(w, 'unknown sender', () => post(w, '/api/mail', mailFrom('lane-a-nobody-here', { toId: COORD }))));
      L.push(facts(w, 'rejections', 'SELECT code, fromId FROM mail_rejections ORDER BY id'));
      return L.join('\n');
    })).toMatchInlineSnapshot(`
      "coordinator -> worker, run mail: 202 {"ok":true,"id":1} | mail+1 mail_deliveries+1
      worker wave-done -> coordinator: 202 {"ok":true,"id":2} | mail+1 mail_deliveries+1
      plain peer mail: 202 {"ok":true,"id":3} | mail+1 mail_deliveries+1
      stale fromUuid: 403 {"ok":false,"error":"stale-uuid","detail":"fromUuid does not match the registry — stale sender"} | mail_rejections+1
      unknown sender: 403 {"ok":false,"error":"unknown-sender","detail":"no registry row for lane-a-nobody-here"} | mail_rejections+1
      rejections: [{"code":"stale-uuid","fromId":"lane-a-plain"},{"code":"unknown-sender","fromId":"lane-a-nobody-here"}]"
    `);
  });
});

describe('POST /api/programmes/:slug/items', () => {
  const RAISE = { kind: 'do', title: 'Turn on the setting', why: 'The wave needs it.', how: ['Open Settings', 'Switch it on'], neededBy: 'soon', soonLabel: 'before wave 6' };
  it('the claimant raises an item, a non-claimant is refused by ownership, a stale uuid', async () => {
    expect(await three(async (st) => {
      const w = await core(st);
      const L: string[] = [];
      L.push(await step(w, 'claimant raises', () => post(w, '/api/programmes/prog-a/items', { ...as(COORD), ...RAISE })));
      L.push(await step(w, 'non-claimant (plain)', () => post(w, '/api/programmes/prog-a/items', { ...as(PLAIN), ...RAISE })));
      L.push(await step(w, 'worker', () => post(w, '/api/programmes/prog-a/items', { ...as(WORKER), ...RAISE })));
      L.push(await step(w, 'stale uuid', () => post(w, '/api/programmes/prog-a/items', { ...stale(COORD), ...RAISE })));
      L.push(facts(w, 'items', 'SELECT id, program, raisedBy, kind, title FROM operator_items ORDER BY id'));
      return L.join('\n');
    })).toMatchInlineSnapshot(`
      "claimant raises: 200 {"ok":true,"id":1} | operator_item_events+1 operator_items+1 push_outbox+1
      non-claimant (plain): 403 {"ok":false,"error":"not-your-programme","detail":"lane-a-plain holds no open run of programme prog-a"} | no rows changed
      worker: 403 {"ok":false,"error":"not-your-programme","detail":"lane-a-project-a-worker holds no open run of programme prog-a"} | no rows changed
      stale uuid: 403 {"ok":false,"error":"stale-uuid","detail":"byUuid does not match the registry — stale sender; re-read your own .uuid"} | no rows changed
      items: [{"id":1,"program":"prog-a","raisedBy":"lane-a-project-a-coord","kind":"do","title":"Turn on the setting"}]"
    `);
  });
});

describe('POST /api/claims and /api/claims/:id/release', () => {
  it('take, re-take, release by the holder, release by another, a stale uuid', async () => {
    expect(await three(async (st) => {
      const w = await core(st);
      const L: string[] = [];
      const take = (who_: { byId: string; byUuid: string }, paths = ['shared/api.ts']) =>
        post(w, '/api/claims', { ...who_, project: 'demo', paths, intent: 'working' });
      L.push(await step(w, 'take', () => take(as(COORD))));
      L.push(await step(w, 're-take (renew)', () => take(as(COORD))));
      L.push(await step(w, 'take by a stale uuid', () => take(stale(WORKER), ['ccd/ccd'])));
      L.push(await step(w, 'take of a held path by another', () => take(as(PLAIN))));
      L.push(await step(w, 'release by another', () => post(w, '/api/claims/1/release', as(PLAIN))));
      L.push(await step(w, 'release, stale uuid', () => post(w, '/api/claims/1/release', stale(COORD))));
      L.push(await step(w, 'release by the holder', () => post(w, '/api/claims/1/release', as(COORD))));
      L.push(facts(w, 'claims', 'SELECT id, project, heldBy, state FROM claims ORDER BY id'));
      return L.join('\n');
    })).toMatchInlineSnapshot(`
      "take: 200 {"ok":true,"ids":[1],"expiresAt":<ms>,"hardExpiresAt":<ms>,"renewed":false} | claim_paths+1 claims+1
      re-take (renew): 200 {"ok":true,"ids":[1],"expiresAt":<ms>,"hardExpiresAt":<ms>,"renewed":true} | no rows changed
      take by a stale uuid: 403 {"ok":false,"error":"stale-uuid","detail":"byUuid does not match the registry — stale sender; re-read your own .uuid"} | no rows changed
      take of a held path by another: 409 {"ok":false,"error":"claim-conflict","conflicts":[{"path":"shared/api.ts","claimedPath":"shared/api.ts","claimId":1,"heldBy":"lane-a-project-a-coord","heldByUuid":"u-lane-a-project-a-coord","intent":"working","runId":null,"expiresAt":<ms>,"deliverable":"yes","mailHint":{"toId":"lane-a-project-a-coord","subject":"claim conflict: shared/api.ts"}}]} | claim_collisions+1
      release by another: 403 {"ok":false,"error":"not-owner","heldBy":"lane-a-project-a-coord"} | no rows changed
      release, stale uuid: 403 {"ok":false,"error":"stale-uuid","detail":"byUuid does not match the registry — stale sender; re-read your own .uuid"} | no rows changed
      release by the holder: 200 {"ok":true,"state":"released"} | no rows changed
      claims: [{"id":1,"project":"demo","heldBy":"lane-a-project-a-coord","state":"released"}]"
    `);
  });
});

describe('POST /api/questions/:id/rule and /release', () => {
  // The question doors' own fixture (`approvalsHarness.ts`): a parent, its dispatched child, and a second child.
  const QUESTION = { question: 'Which colour?', options: [{ label: 'Red' }, { label: 'Blue' }] };
  const ASK_KEY = askKey({ questions: [QUESTION] })!;
  const ASK_PANE = 'Which colour?\n❯ 1. Red\n  2. Blue\nEnter to select\n';
  const hookstate = (f: Approvals, id: string, updatedAt: number): void => {
    writeFileSync(path.join(f.home, '.cc-sessions', `${id}.hookstate.json`), JSON.stringify({
      v: 1, state: 'waiting', event: 'PermissionRequest', sessionId: uuidOf(id), pid: 4242, updatedAt, ask: { questions: [QUESTION] }, subagents: [],
    }));
  };
  it('the parent rules an ask and releases another; a non-parent; a stale uuid', async () => {
    expect(await three(async (st) => {
      const keys: string[] = [];
      vi.spyOn(Tmux.prototype, 'sendKey').mockImplementation(async (id: string, k: string) => { keys.push(`${id} ${k}`); return true; });
      vi.spyOn(Tmux.prototype, 'sendLiteral').mockImplementation(async (id: string, t: string) => { keys.push(`${id} -l ${t}`); return true; });
      const f = await standardFixture();
      closers.push(() => f.close());
      seedDesignation(f.coord.db, st);
      const now = Date.now();
      hookstate(f, CHILD, now);
      f.panes.set(CHILD, ASK_PANE);
      const insert = (childId: string, dialogId: string): number => f.coord.insertAsk({ childId, parentId: PARENT, runId: f.runId, askKey: ASK_KEY, askAt: now,
        dialogId, question: QUESTION.question, options: QUESTION.options.map((x) => x.label), now });
      const ruled = insert(CHILD, 'dlg-1');
      const released = insert(CHILD2, 'dlg-2');
      const P = { fromId: PARENT, fromUuid: uuidOf(PARENT) };
      const rule = (id: number, body: Record<string, unknown>) =>
        f.app.inject({ method: 'POST', url: `/api/questions/ask-${id}/rule`, headers: TOK, payload: { kind: 'ask', ...body } as never });
      const release = (id: number, body: Record<string, unknown>) =>
        f.app.inject({ method: 'POST', url: `/api/questions/ask-${id}/release`, headers: TOK, payload: { kind: 'ask', ...body } as never });
      const L: string[] = [];
      L.push(await step(f.coord, 'rule by a non-parent', () => rule(ruled, { fromId: CHILD2, fromUuid: uuidOf(CHILD2), optionIndexes: [1], askKey: ASK_KEY })));
      L.push(await step(f.coord, 'rule, stale uuid', () => rule(ruled, { fromId: PARENT, fromUuid: 'stale', optionIndexes: [1], askKey: ASK_KEY })));
      L.push(await step(f.coord, 'release by a non-parent', () => release(released, { fromId: CHILD, fromUuid: uuidOf(CHILD) })));
      L.push(await step(f.coord, 'release, stale uuid', () => release(released, { fromId: PARENT, fromUuid: 'stale' })));
      L.push(await step(f.coord, 'parent rules', () => rule(ruled, { ...P, optionIndexes: [1], askKey: ASK_KEY })));
      L.push(await step(f.coord, 'parent releases another', () => release(released, P)));
      const row = (id: number): string => { const r = f.coord.askById(id); return r.ok && r.ask !== null ? `${r.ask.state}/${r.ask.answeredBy}/${r.ask.answer}` : 'none'; };
      L.push(`ask rows: ${row(ruled)} ${row(released)}; keys: ${JSON.stringify(keys)}`);
      return L.join('\n');
    })).toMatchInlineSnapshot(`
      "rule by a non-parent: 403 {"ok":false,"error":"not-parent","detail":"only this child's derived parent may pre-empt its question"} | no rows changed
      rule, stale uuid: 403 {"ok":false,"error":"stale-uuid","detail":"fromUuid does not match the registry — stale sender; re-read your own .uuid"} | no rows changed
      release by a non-parent: 403 {"ok":false,"error":"not-parent","detail":"only this child's derived parent may decline its question"} | no rows changed
      release, stale uuid: 403 {"ok":false,"error":"stale-uuid","detail":"fromUuid does not match the registry — stale sender; re-read your own .uuid"} | no rows changed
      parent rules: 200 {"ok":true} | feed_events+1
      parent releases another: 200 {"ok":true} | push_outbox+1
      ask rows: answered/project-a-calm-mesa/Blue declined/null/null; keys: ["project-a-quiet-basin 2"]"
    `);
  });
});

describe('POST /api/coordinators/:session/intent', () => {
  it('set and clear by the session itself, byId not the path\'s session, a stale uuid', async () => {
    expect(await three(async (st) => {
      const w = await core(st, { watcher: true });
      const L: string[] = [];
      const intent = (session: string, action: string, who_: { byId: string; byUuid: string }) =>
        post(w, `/api/coordinators/${session}/intent`, { action, ...who_ });
      L.push(await step(w, 'set by the session', () => intent(COORD, 'set', as(COORD))));
      L.push(`checkpoint: ${await w.checkpoint()}`);
      L.push(await step(w, 'byId is not the path session', () => intent(PLAIN, 'set', as(COORD))));
      L.push(await step(w, 'stale uuid', () => intent(COORD, 'set', stale(COORD))));
      L.push(await step(w, 'clear by the session', () => intent(COORD, 'clear', as(COORD))));
      L.push(`checkpoint: ${await w.checkpoint()}`);
      return L.join('\n');
    })).toMatchInlineSnapshot(`
      "set by the session: 200 {"ok":true,"action":"set","session":"lane-a-project-a-coord","incarnation":"0189abcd-1234-4678-9abc-012345678900","changed":true,"explicitIntentAt":"<instant>","effective":true,"effectiveBasis":["explicit"],"projection":"projected","incarnationAfter":"same"} | delegation_sessions+1
      checkpoint: [["lane-a-project-a-coord",true]]
      byId is not the path session: 403 {"ok":false,"error":"not-owner","detail":"byId is not the session in the path: a session declares its own intent and no other session's"} | no rows changed
      stale uuid: 403 {"ok":false,"error":"stale-uuid","detail":"byUuid does not match the registry — stale sender; re-read your own .uuid"} | no rows changed
      clear by the session: 200 {"ok":true,"action":"clear","session":"lane-a-project-a-coord","incarnation":"0189abcd-1234-4678-9abc-012345678900","changed":true,"explicitIntentAt":null,"effective":false,"effectiveBasis":[],"projection":"projected","incarnationAfter":"same"} | no rows changed
      checkpoint: [["lane-a-project-a-coord",false]]"
    `);
  });
});

describe('POST /api/landing/entries and /api/landing/order', () => {
  const HEAD = 'a'.repeat(40);
  const HC = 'c'.repeat(40);
  const entry = (who_: { byId: string; byUuid: string }, pr: number) => ({ ...who_, project: 'demo', pr, pinnedSha: HEAD, handoffCommit: HC });
  it('a coordinator\'s entry and order write, a stale uuid, a malformed body', async () => {
    expect(await three(async (st) => {
      const w = await core(st);
      const L: string[] = [];
      L.push(await step(w, 'entry 11', () => post(w, '/api/landing/entries', entry(as(COORD), 11))));
      L.push(await step(w, 'entry 12', () => post(w, '/api/landing/entries', entry(as(COORD), 12))));
      L.push(await step(w, 'entry, stale uuid', () => post(w, '/api/landing/entries', entry(stale(COORD), 13))));
      L.push(await step(w, 'entry, malformed', () => post(w, '/api/landing/entries', { ...as(COORD), project: 'demo' })));
      L.push(await step(w, 'order 12 after 11', () => post(w, '/api/landing/order', { ...as(COORD), project: 'demo', pr: 12, afterIds: [1] })));
      L.push(await step(w, 'order, stale uuid', () => post(w, '/api/landing/order', { ...stale(COORD), project: 'demo', pr: 12, afterIds: [] })));
      L.push(await step(w, 'order, malformed', () => post(w, '/api/landing/order', { ...as(COORD), project: 'demo', pr: 'x' })));
      L.push(`line: ${norm((await get(w, '/api/landing?project=demo')).body)}`);
      return L.join('\n');
    })).toMatchInlineSnapshot(`
      "entry 11: 200 {"ok":true,"entry":{"id":1,"project":"demo","pr":11,"pinnedSha":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","handoffCommit":"cccccccccccccccccccccccccccccccccccccccc","runId":null,"state":"pinned","baseSha":null,"ejectionKind":null,"ejections":0,"afterIds":[],"fixesMain":false,"setBy":"lane-a-project-a-coord","pinnedAt":<ms>},"previous":null,"changed":true,"seq":1} | landing_authority+1 landing_entries+1 landing_subjects+1
      entry 12: 200 {"ok":true,"entry":{"id":2,"project":"demo","pr":12,"pinnedSha":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","handoffCommit":"cccccccccccccccccccccccccccccccccccccccc","runId":null,"state":"pinned","baseSha":null,"ejectionKind":null,"ejections":0,"afterIds":[],"fixesMain":false,"setBy":"lane-a-project-a-coord","pinnedAt":<ms>},"previous":null,"changed":true,"seq":2} | landing_authority+1 landing_entries+1 landing_subjects+1
      entry, stale uuid: 403 {"ok":false,"error":"stale-uuid","detail":"byUuid does not match the registry — stale sender; re-read your own .uuid"} | no rows changed
      entry, malformed: 400 {"ok":false,"error":"bad-request","detail":"the landing entry body is not a closed, well-formed request"} | no rows changed
      order 12 after 11: 200 {"ok":true,"entry":{"id":2,"project":"demo","pr":12,"pinnedSha":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","handoffCommit":"cccccccccccccccccccccccccccccccccccccccc","runId":null,"state":"pinned","baseSha":null,"ejectionKind":null,"ejections":0,"afterIds":[1],"fixesMain":false,"setBy":"lane-a-project-a-coord","pinnedAt":<ms>},"previous":{"id":2,"project":"demo","pr":12,"pinnedSha":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","handoffCommit":"cccccccccccccccccccccccccccccccccccccccc","runId":null,"state":"pinned","baseSha":null,"ejectionKind":null,"ejections":0,"afterIds":[],"fixesMain":false,"setBy":"lane-a-project-a-coord","pinnedAt":<ms>},"changed":true,"seq":3} | feed_events+1
      order, stale uuid: 403 {"ok":false,"error":"stale-uuid","detail":"byUuid does not match the registry — stale sender; re-read your own .uuid"} | no rows changed
      order, malformed: 400 {"ok":false,"error":"bad-request","detail":"the landing order body is not a closed, well-formed request"} | no rows changed
      line: {"ok":true,"project":"demo","operatorPaused":false,"mainRedHold":false,"entries":[{"id":1,"project":"demo","pr":11,"pinnedSha":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","handoffCommit":"cccccccccccccccccccccccccccccccccccccccc","runId":null,"state":"pinned","baseSha":null,"ejectionKind":null,"ejections":0,"afterIds":[],"fixesMain":false,"setBy":"lane-a-project-a-coord","pinnedAt":<ms>},{"id":2,"project":"demo","pr":12,"pinnedSha":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","handoffCommit":"cccccccccccccccccccccccccccccccccccccccc","runId":null,"state":"pinned","baseSha":null,"ejectionKind":null,"ejections":0,"afterIds":[1],"fixesMain":false,"setBy":"lane-a-project-a-coord","pinnedAt":<ms>}],"order":{"paused":false,"order":[{"id":1,"project":"demo","pr":11,"pinnedSha":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","handoffCommit":"cccccccccccccccccccccccccccccccccccccccc","runId":null,"state":"pinned","baseSha":null,"ejectionKind":null,"ejections":0,"afterIds":[],"fixesMain":false,"setBy":"lane-a-project-a-coord","pinnedAt":<ms>},{"id":2,"project":"demo","pr":12,"pinnedSha":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","handoffCommit":"cccccccccccccccccccccccccccccccccccccccc","runId":null,"state":"pinned","baseSha":null,"ejectionKind":null,"ejections":0,"afterIds":[1],"fixesMain":false,"setBy":"lane-a-project-a-coord","pinnedAt":<ms>}],"head":{"id":1,"project":"demo","pr":11,"pinnedSha":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","handoffCommit":"cccccccccccccccccccccccccccccccccccccccc","runId":null,"state":"pinned","baseSha":null,"ejectionKind":null,"ejections":0,"afterIds":[],"fixesMain":false,"setBy":"lane-a-project-a-coord","pinnedAt":<ms>}},"entriesScope":"open","recovery":{"subjects":[],"hold":null}}"
    `);
  });
});

describe('the Linear proxy: four writes stay attributed, search stays open', () => {
  it('a coordinator\'s create, update, comment and link; a stale uuid; search', async () => {
    expect(await three(async (st) => {
      const home = mkTmp('ccrc-other-lanes-linear-');
      const db = openCoordDb(path.join(home, 'coord.db'));
      const r: ProxyRig = await proxyRig({ db, over: { coord: new CoordStore(db) }, sessions: [COORD] });
      closers.push(() => r.close());
      await seedSlot(r.ccrcDir, 'a');
      seedDesignation(db, st);
      const L: string[] = [];
      const lin = (label: string, verb: 'create' | 'update' | 'comment' | 'link' | 'search', as_: { id: string; uuid: string }) =>
        step({ db }, label, () => r.call(verb, { as: as_, body: BODIES[verb] }));
      for (const verb of ['create', 'update', 'comment', 'link'] as const) {
        L.push(await lin(`${verb} by the coordinator`, verb, who(COORD)));
        L.push(await lin(`${verb}, stale uuid`, verb, { id: COORD, uuid: 'u-stale' }));
      }
      L.push(await lin('search', 'search', who(COORD)));
      L.push(`stand-in calls: ${JSON.stringify(r.calls.map((c) => c.op))}; events: ${r.rows().length}`);
      // The stand-in's issue url is masked: the tree's private-tracker class forbids its host spelled with a workspace.
      return L.join('\n').replace(/"url":"[^"]*"/g, '"url":"<url>"');
    })).toMatchInlineSnapshot(`
      "create by the coordinator: 200 {"ok":true,"issue":{"identifier":"AAA-100","url":"<url>","workspace":"ws-a","team":"AAA","state":{"name":"Todo","type":"unstarted"},"priority":2,"assignee":"User A","labels":["Bug"],"project":"Project A","parent":null,"createdAt":"<instant>","updatedAt":"<instant>","viaFleet":false,"untrusted":{"title":"A fixture title","description":"A fixture description","descriptionTruncated":false}}} | linear_events+1
      create, stale uuid: 403 {"ok":false,"error":"stale-uuid","detail":"byUuid does not match the registry — stale sender; re-read your own .uuid"} | no rows changed
      update by the coordinator: 200 {"ok":true,"issue":{"identifier":"AAA-12","url":"<url>","workspace":"ws-a","team":"AAA","state":{"name":"Todo","type":"unstarted"},"priority":2,"assignee":"User A","labels":["Bug"],"project":"Project A","parent":null,"createdAt":"<instant>","updatedAt":"<instant>","viaFleet":false,"untrusted":{"title":"A fixture title","description":"A fixture description","descriptionTruncated":false}}} | linear_events+1
      update, stale uuid: 403 {"ok":false,"error":"stale-uuid","detail":"byUuid does not match the registry — stale sender; re-read your own .uuid"} | no rows changed
      comment by the coordinator: 200 {"ok":true,"comment":{"createdAt":"<instant>"}} | linear_events+1
      comment, stale uuid: 403 {"ok":false,"error":"stale-uuid","detail":"byUuid does not match the registry — stale sender; re-read your own .uuid"} | no rows changed
      link by the coordinator: 200 {"ok":true,"linked":true} | linear_events+1
      link, stale uuid: 403 {"ok":false,"error":"stale-uuid","detail":"byUuid does not match the registry — stale sender; re-read your own .uuid"} | no rows changed
      search: 200 {"ok":true,"items":[{"identifier":"AAA-12","url":"<url>","workspace":"ws-a","team":"AAA","state":{"name":"Todo","type":"unstarted"},"priority":2,"assignee":"User A","labels":["Bug"],"project":"Project A","parent":null,"createdAt":"<instant>","updatedAt":"<instant>","viaFleet":false,"untrusted":{"title":"A fixture title"}}],"next":null} | no rows changed
      stand-in calls: ["IssueCreate","ResolveIssue","IssueUpdate","ResolveIssue","CommentCreate","ResolveIssue","AttachmentLinkURL","Search"]; events: 4"
    `);
  });
});

describe('the six plan doors', () => {
  const epic = (key: string, waves: number[]) => ({ key, title: `Epic ${key}`, summary: 's', waves, checkpoints: [{ key: `${key}-c1`, title: 'c', kind: 'acceptance' }] });
  const PLAN = { home: 'demo', epics: [epic('e1', [1]), epic('e2', [2])] };
  const DOORS: ReadonlyArray<readonly [string, string, (n: number) => Record<string, unknown>]> = [
    ['declare', '', () => PLAN],
    ['met', '/met', () => ({ checkpoint: 'e1-c1', evidence: { pr: 12 } })],
    ['tickets', '/tickets', (n) => ({ epic: 'e1', key: `t${n}`, kind: 'task', title: 'Do it', checkpoint: 'e1-c1' })],
    ['tickets/move', '/tickets/move', () => ({ ticket: 't1', epic: 'e2' })],
    ['epics/drop', '/epics/drop', () => ({ epic: 'e2', why: 'out of scope' })],
    ['close', '/close', () => ({ outcome: 'abandoned', why: 'superseded' })],
  ];
  const send = (w: World, slug: string, route: string, body: unknown, who_: { byId: string; byUuid: string }) =>
    w.app.inject({ method: 'POST', url: `/api/programmes/${slug}/plan${route}?byId=${who_.byId}&byUuid=${who_.byUuid}`, headers: TOK, payload: body as never });
  it('declare, met, tickets, tickets/move, epics/drop, close: the owner, another session, a plain session with no owner, a stale uuid', async () => {
    expect(await three(async (st) => {
      const L: string[] = [];
      for (const [name, route, body] of DOORS) {
        const w = await core(st);
        L.push(`== ${name}`);
        // prog-p has a plan owner (COORD); prog-q has none.
        L.push(`seed plan prog-p by the owner: ${(await send(w, 'prog-p', '', PLAN, as(COORD))).statusCode}`);
        if (name !== 'declare') L.push(`seed ticket t1: ${(await send(w, 'prog-p', '/tickets', { epic: 'e1', key: 't1', kind: 'task', title: 'First', checkpoint: 'e1-c1' }, as(COORD))).statusCode}`);
        L.push(await step(w, 'the owner', () => send(w, 'prog-p', route, body(2), as(COORD))));
        L.push(await step(w, 'another session, plan owned', () => send(w, 'prog-p', route, body(3), as(PLAIN))));
        if (name !== 'declare') {
          // prog-q gets the same plan and ticket, then its owner is cleared (fixture act): the arm that admits any attributed caller.
          await send(w, 'prog-q', '', PLAN, as(COORD));
          await send(w, 'prog-q', '/tickets', { epic: 'e1', key: 't1', kind: 'task', title: 'First', checkpoint: 'e1-c1' }, as(COORD));
          w.db.prepare("UPDATE programs SET planBy = NULL WHERE slug = 'prog-q'").run();
        }
        L.push(await step(w, 'a plain session, programme has no owner', () => send(w, 'prog-q', route, body(4), as(PLAIN))));
        L.push(await step(w, 'stale uuid', () => send(w, 'prog-p', route, body(5), stale(COORD))));
        L.push(facts(w, 'plan owners', "SELECT slug, planBy FROM programs WHERE slug IN ('prog-p','prog-q') ORDER BY slug"));
      }
      return L.join('\n');
    })).toMatchInlineSnapshot(`
      "== declare
      seed plan prog-p by the owner: 200
      the owner: 200 {"ok":true,"plan":{"program":"prog-p","planned":true,"initiatives":[],"epics":[{"key":"e1","title":"Epic e1","summary":"s","project":"demo","waves":[1],"state":"planned","url":null,"sync":"unsynced","syncWord":null,"checkpoints":[{"key":"e1-c1","title":"c","kind":"acceptance","state":"open","proves":[],"metAt":null,"evidence":null,"url":null,"sync":"unsynced","syncWord":null}],"tickets":[]},{"key":"e2","title":"Epic e2","summary":"s","project":"demo","waves":[2],"state":"planned","url":null,"sync":"unsynced","syncWord":null,"checkpoints":[{"key":"e2-c1","title":"c","kind":"acceptance","state":"open","proves":[],"metAt":null,"evidence":null,"url":null,"sync":"unsynced","syncWord":null}],"tickets":[]}],"doneWhen":[]}} | no rows changed
      another session, plan owned: 403 {"ok":false,"error":"not-plan-owner","detail":"only the programme's coordinator writes its plan"} | no rows changed
      a plain session, programme has no owner: 200 {"ok":true,"plan":{"program":"prog-q","planned":true,"initiatives":[],"epics":[{"key":"e1","title":"Epic e1","summary":"s","project":"demo","waves":[1],"state":"planned","url":null,"sync":"unsynced","syncWord":null,"checkpoints":[{"key":"e1-c1","title":"c","kind":"acceptance","state":"open","proves":[],"metAt":null,"evidence":null,"url":null,"sync":"unsynced","syncWord":null}],"tickets":[]},{"key":"e2","title":"Epic e2","summary":"s","project":"demo","waves":[2],"state":"planned","url":null,"sync":"unsynced","syncWord":null,"checkpoints":[{"key":"e2-c1","title":"c","kind":"acceptance","state":"open","proves":[],"metAt":null,"evidence":null,"url":null,"sync":"unsynced","syncWord":null}],"tickets":[]}],"doneWhen":[]}} | plan_checkpoints+2 plan_epics+2 plan_sync_due+1 programs+1
      stale uuid: 403 {"ok":false,"error":"stale-uuid","detail":"byUuid does not match the registry — stale sender; re-read your own .uuid"} | no rows changed
      plan owners: [{"slug":"prog-p","planBy":"lane-a-project-a-coord"},{"slug":"prog-q","planBy":"lane-a-plain"}]
      == met
      seed plan prog-p by the owner: 200
      seed ticket t1: 200
      the owner: 200 {"ok":true,"plan":{"program":"prog-p","planned":true,"initiatives":[],"epics":[{"key":"e1","title":"Epic e1","summary":"s","project":"demo","waves":[1],"state":"planned","url":null,"sync":"unsynced","syncWord":null,"checkpoints":[{"key":"e1-c1","title":"c","kind":"acceptance","state":"met","proves":[],"metAt":<ms>,"evidence":{"pr":12},"url":null,"sync":"unsynced","syncWord":null}],"tickets":[{"key":"t1","kind":"task","title":"First","project":"demo","checkpoint":"e1-c1","source":"plan","state":"open","runId":null,"identifier":null,"url":null,"sync":"unsynced","syncWord":null}]},{"key":"e2","title":"Epic e2","summary":"s","project":"demo","waves":[2],"state":"planned","url":null,"sync":"unsynced","syncWord":null,"checkpoints":[{"key":"e2-c1","title":"c","kind":"acceptance","state":"open","proves":[],"metAt":null,"evidence":null,"url":null,"sync":"unsynced","syncWord":null}],"tickets":[]}],"doneWhen":[]}} | no rows changed
      another session, plan owned: 403 {"ok":false,"error":"not-plan-owner","detail":"only the programme's coordinator marks a checkpoint met"} | no rows changed
      a plain session, programme has no owner: 200 {"ok":true,"plan":{"program":"prog-q","planned":true,"initiatives":[],"epics":[{"key":"e1","title":"Epic e1","summary":"s","project":"demo","waves":[1],"state":"planned","url":null,"sync":"unsynced","syncWord":null,"checkpoints":[{"key":"e1-c1","title":"c","kind":"acceptance","state":"met","proves":[],"metAt":<ms>,"evidence":{"pr":12},"url":null,"sync":"unsynced","syncWord":null}],"tickets":[{"key":"t1","kind":"task","title":"First","project":"demo","checkpoint":"e1-c1","source":"plan","state":"open","runId":null,"identifier":null,"url":null,"sync":"unsynced","syncWord":null}]},{"key":"e2","title":"Epic e2","summary":"s","project":"demo","waves":[2],"state":"planned","url":null,"sync":"unsynced","syncWord":null,"checkpoints":[{"key":"e2-c1","title":"c","kind":"acceptance","state":"open","proves":[],"metAt":null,"evidence":null,"url":null,"sync":"unsynced","syncWord":null}],"tickets":[]}],"doneWhen":[]}} | no rows changed
      stale uuid: 403 {"ok":false,"error":"stale-uuid","detail":"byUuid does not match the registry — stale sender; re-read your own .uuid"} | no rows changed
      plan owners: [{"slug":"prog-p","planBy":"lane-a-project-a-coord"},{"slug":"prog-q","planBy":null}]
      == tickets
      seed plan prog-p by the owner: 200
      seed ticket t1: 200
      the owner: 200 {"ok":true,"plan":{"program":"prog-p","planned":true,"initiatives":[],"epics":[{"key":"e1","title":"Epic e1","summary":"s","project":"demo","waves":[1],"state":"planned","url":null,"sync":"unsynced","syncWord":null,"checkpoints":[{"key":"e1-c1","title":"c","kind":"acceptance","state":"open","proves":[],"metAt":null,"evidence":null,"url":null,"sync":"unsynced","syncWord":null}],"tickets":[{"key":"t1","kind":"task","title":"First","project":"demo","checkpoint":"e1-c1","source":"plan","state":"open","runId":null,"identifier":null,"url":null,"sync":"unsynced","syncWord":null},{"key":"t2","kind":"task","title":"Do it","project":"demo","checkpoint":"e1-c1","source":"plan","state":"open","runId":null,"identifier":null,"url":null,"sync":"unsynced","syncWord":null}]},{"key":"e2","title":"Epic e2","summary":"s","project":"demo","waves":[2],"state":"planned","url":null,"sync":"unsynced","syncWord":null,"checkpoints":[{"key":"e2-c1","title":"c","kind":"acceptance","state":"open","proves":[],"metAt":null,"evidence":null,"url":null,"sync":"unsynced","syncWord":null}],"tickets":[]}],"doneWhen":[]}} | plan_tickets+1
      another session, plan owned: 403 {"ok":false,"error":"not-plan-owner","detail":"a worker files a follow-up into its own epic only"} | no rows changed
      a plain session, programme has no owner: 200 {"ok":true,"plan":{"program":"prog-q","planned":true,"initiatives":[],"epics":[{"key":"e1","title":"Epic e1","summary":"s","project":"demo","waves":[1],"state":"planned","url":null,"sync":"unsynced","syncWord":null,"checkpoints":[{"key":"e1-c1","title":"c","kind":"acceptance","state":"open","proves":[],"metAt":null,"evidence":null,"url":null,"sync":"unsynced","syncWord":null}],"tickets":[{"key":"t1","kind":"task","title":"First","project":"demo","checkpoint":"e1-c1","source":"plan","state":"open","runId":null,"identifier":null,"url":null,"sync":"unsynced","syncWord":null},{"key":"t4","kind":"task","title":"Do it","project":"demo","checkpoint":"e1-c1","source":"plan","state":"open","runId":null,"identifier":null,"url":null,"sync":"unsynced","syncWord":null}]},{"key":"e2","title":"Epic e2","summary":"s","project":"demo","waves":[2],"state":"planned","url":null,"sync":"unsynced","syncWord":null,"checkpoints":[{"key":"e2-c1","title":"c","kind":"acceptance","state":"open","proves":[],"metAt":null,"evidence":null,"url":null,"sync":"unsynced","syncWord":null}],"tickets":[]}],"doneWhen":[]}} | plan_tickets+1
      stale uuid: 403 {"ok":false,"error":"stale-uuid","detail":"byUuid does not match the registry — stale sender; re-read your own .uuid"} | no rows changed
      plan owners: [{"slug":"prog-p","planBy":"lane-a-project-a-coord"},{"slug":"prog-q","planBy":null}]
      == tickets/move
      seed plan prog-p by the owner: 200
      seed ticket t1: 200
      the owner: 200 {"ok":true,"plan":{"program":"prog-p","planned":true,"initiatives":[],"epics":[{"key":"e1","title":"Epic e1","summary":"s","project":"demo","waves":[1],"state":"planned","url":null,"sync":"unsynced","syncWord":null,"checkpoints":[{"key":"e1-c1","title":"c","kind":"acceptance","state":"open","proves":[],"metAt":null,"evidence":null,"url":null,"sync":"unsynced","syncWord":null}],"tickets":[]},{"key":"e2","title":"Epic e2","summary":"s","project":"demo","waves":[2],"state":"planned","url":null,"sync":"unsynced","syncWord":null,"checkpoints":[{"key":"e2-c1","title":"c","kind":"acceptance","state":"open","proves":[],"metAt":null,"evidence":null,"url":null,"sync":"unsynced","syncWord":null}],"tickets":[{"key":"t1","kind":"task","title":"First","project":"demo","checkpoint":null,"source":"plan","state":"open","runId":null,"identifier":null,"url":null,"sync":"unsynced","syncWord":null}]}],"doneWhen":[]}} | no rows changed
      another session, plan owned: 403 {"ok":false,"error":"not-plan-owner","detail":"only the programme's coordinator moves a ticket"} | no rows changed
      a plain session, programme has no owner: 200 {"ok":true,"plan":{"program":"prog-q","planned":true,"initiatives":[],"epics":[{"key":"e1","title":"Epic e1","summary":"s","project":"demo","waves":[1],"state":"planned","url":null,"sync":"unsynced","syncWord":null,"checkpoints":[{"key":"e1-c1","title":"c","kind":"acceptance","state":"open","proves":[],"metAt":null,"evidence":null,"url":null,"sync":"unsynced","syncWord":null}],"tickets":[]},{"key":"e2","title":"Epic e2","summary":"s","project":"demo","waves":[2],"state":"planned","url":null,"sync":"unsynced","syncWord":null,"checkpoints":[{"key":"e2-c1","title":"c","kind":"acceptance","state":"open","proves":[],"metAt":null,"evidence":null,"url":null,"sync":"unsynced","syncWord":null}],"tickets":[{"key":"t1","kind":"task","title":"First","project":"demo","checkpoint":null,"source":"plan","state":"open","runId":null,"identifier":null,"url":null,"sync":"unsynced","syncWord":null}]}],"doneWhen":[]}} | no rows changed
      stale uuid: 403 {"ok":false,"error":"stale-uuid","detail":"byUuid does not match the registry — stale sender; re-read your own .uuid"} | no rows changed
      plan owners: [{"slug":"prog-p","planBy":"lane-a-project-a-coord"},{"slug":"prog-q","planBy":null}]
      == epics/drop
      seed plan prog-p by the owner: 200
      seed ticket t1: 200
      the owner: 200 {"ok":true,"plan":{"program":"prog-p","planned":true,"initiatives":[],"epics":[{"key":"e1","title":"Epic e1","summary":"s","project":"demo","waves":[1],"state":"planned","url":null,"sync":"unsynced","syncWord":null,"checkpoints":[{"key":"e1-c1","title":"c","kind":"acceptance","state":"open","proves":[],"metAt":null,"evidence":null,"url":null,"sync":"unsynced","syncWord":null}],"tickets":[{"key":"t1","kind":"task","title":"First","project":"demo","checkpoint":"e1-c1","source":"plan","state":"open","runId":null,"identifier":null,"url":null,"sync":"unsynced","syncWord":null}]},{"key":"e2","title":"Epic e2","summary":"s","project":"demo","waves":[2],"state":"dropped","url":null,"sync":"unsynced","syncWord":null,"checkpoints":[{"key":"e2-c1","title":"c","kind":"acceptance","state":"dropped","proves":[],"metAt":null,"evidence":null,"url":null,"sync":"unsynced","syncWord":null}],"tickets":[]}],"doneWhen":[]}} | no rows changed
      another session, plan owned: 403 {"ok":false,"error":"not-plan-owner","detail":"only the programme's coordinator drops an epic"} | no rows changed
      a plain session, programme has no owner: 200 {"ok":true,"plan":{"program":"prog-q","planned":true,"initiatives":[],"epics":[{"key":"e1","title":"Epic e1","summary":"s","project":"demo","waves":[1],"state":"planned","url":null,"sync":"unsynced","syncWord":null,"checkpoints":[{"key":"e1-c1","title":"c","kind":"acceptance","state":"open","proves":[],"metAt":null,"evidence":null,"url":null,"sync":"unsynced","syncWord":null}],"tickets":[{"key":"t1","kind":"task","title":"First","project":"demo","checkpoint":"e1-c1","source":"plan","state":"open","runId":null,"identifier":null,"url":null,"sync":"unsynced","syncWord":null}]},{"key":"e2","title":"Epic e2","summary":"s","project":"demo","waves":[2],"state":"dropped","url":null,"sync":"unsynced","syncWord":null,"checkpoints":[{"key":"e2-c1","title":"c","kind":"acceptance","state":"dropped","proves":[],"metAt":null,"evidence":null,"url":null,"sync":"unsynced","syncWord":null}],"tickets":[]}],"doneWhen":[]}} | no rows changed
      stale uuid: 403 {"ok":false,"error":"stale-uuid","detail":"byUuid does not match the registry — stale sender; re-read your own .uuid"} | no rows changed
      plan owners: [{"slug":"prog-p","planBy":"lane-a-project-a-coord"},{"slug":"prog-q","planBy":"lane-a-plain"}]
      == close
      seed plan prog-p by the owner: 200
      seed ticket t1: 200
      the owner: 200 {"ok":true,"plan":{"program":"prog-p","planned":true,"initiatives":[],"epics":[{"key":"e1","title":"Epic e1","summary":"s","project":"demo","waves":[1],"state":"planned","url":null,"sync":"unsynced","syncWord":null,"checkpoints":[{"key":"e1-c1","title":"c","kind":"acceptance","state":"open","proves":[],"metAt":null,"evidence":null,"url":null,"sync":"unsynced","syncWord":null}],"tickets":[{"key":"t1","kind":"task","title":"First","project":"demo","checkpoint":"e1-c1","source":"plan","state":"open","runId":null,"identifier":null,"url":null,"sync":"unsynced","syncWord":null}]},{"key":"e2","title":"Epic e2","summary":"s","project":"demo","waves":[2],"state":"planned","url":null,"sync":"unsynced","syncWord":null,"checkpoints":[{"key":"e2-c1","title":"c","kind":"acceptance","state":"open","proves":[],"metAt":null,"evidence":null,"url":null,"sync":"unsynced","syncWord":null}],"tickets":[]}],"doneWhen":[]}} | no rows changed
      another session, plan owned: 403 {"ok":false,"error":"not-plan-owner","detail":"only the programme's coordinator closes its plan"} | no rows changed
      a plain session, programme has no owner: 200 {"ok":true,"plan":{"program":"prog-q","planned":true,"initiatives":[],"epics":[{"key":"e1","title":"Epic e1","summary":"s","project":"demo","waves":[1],"state":"planned","url":null,"sync":"unsynced","syncWord":null,"checkpoints":[{"key":"e1-c1","title":"c","kind":"acceptance","state":"open","proves":[],"metAt":null,"evidence":null,"url":null,"sync":"unsynced","syncWord":null}],"tickets":[{"key":"t1","kind":"task","title":"First","project":"demo","checkpoint":"e1-c1","source":"plan","state":"open","runId":null,"identifier":null,"url":null,"sync":"unsynced","syncWord":null}]},{"key":"e2","title":"Epic e2","summary":"s","project":"demo","waves":[2],"state":"planned","url":null,"sync":"unsynced","syncWord":null,"checkpoints":[{"key":"e2-c1","title":"c","kind":"acceptance","state":"open","proves":[],"metAt":null,"evidence":null,"url":null,"sync":"unsynced","syncWord":null}],"tickets":[]}],"doneWhen":[]}} | no rows changed
      stale uuid: 403 {"ok":false,"error":"stale-uuid","detail":"byUuid does not match the registry — stale sender; re-read your own .uuid"} | no rows changed
      plan owners: [{"slug":"prog-p","planBy":"lane-a-project-a-coord"},{"slug":"prog-q","planBy":null}]"
    `);
  });
  it('tickets by a worker into its own run\'s epic, and plan show stays open', async () => {
    expect(await three(async (st) => {
      const w = await core(st);
      const L: string[] = [];
      L.push(`declare prog-a by the claimant: ${(await send(w, 'prog-a', '', PLAN, as(COORD))).statusCode}`);
      await send(w, 'prog-a', '/tickets', { epic: 'e1', key: 't1', kind: 'task', title: 'First', checkpoint: 'e1-c1' }, as(COORD));
      // The worker's run holds ticket t1, which sits in epic e1 (fixture act): its "own run's epic".
      w.db.prepare("UPDATE runs SET ticketId = (SELECT id FROM plan_tickets WHERE key = 't1') WHERE id = ?").run(w.runId);
      L.push(await step(w, 'worker follow-up, epic e1', () => send(w, 'prog-a', '/tickets', { epic: 'e1', key: 'f1', kind: 'follow-up', title: 'later' }, as(WORKER))));
      L.push(await step(w, 'worker, kind work', () => send(w, 'prog-a', '/tickets', { epic: 'e1', key: 'f2', kind: 'work', title: 'later' }, as(WORKER))));
      L.push(await step(w, 'plan show, GET', () => get(w, `/api/programmes/prog-a/plan?byId=${PLAIN}&byUuid=u-${PLAIN}`)));
      return L.join('\n');
    })).toMatchInlineSnapshot(`
      "declare prog-a by the claimant: 200
      worker follow-up, epic e1: 200 {"ok":true,"plan":{"program":"prog-a","planned":true,"initiatives":[],"epics":[{"key":"e1","title":"Epic e1","summary":"s","project":"demo","waves":[1],"state":"planned","url":null,"sync":"unsynced","syncWord":null,"checkpoints":[{"key":"e1-c1","title":"c","kind":"acceptance","state":"open","proves":[],"metAt":null,"evidence":null,"url":null,"sync":"unsynced","syncWord":null}],"tickets":[{"key":"t1","kind":"task","title":"First","project":"demo","checkpoint":"e1-c1","source":"plan","state":"open","runId":null,"identifier":null,"url":null,"sync":"unsynced","syncWord":null},{"key":"f1","kind":"follow-up","title":"later","project":"demo","checkpoint":null,"source":"worker","state":"open","runId":null,"identifier":null,"url":null,"sync":"unsynced","syncWord":null}]},{"key":"e2","title":"Epic e2","summary":"s","project":"demo","waves":[2],"state":"planned","url":null,"sync":"unsynced","syncWord":null,"checkpoints":[{"key":"e2-c1","title":"c","kind":"acceptance","state":"open","proves":[],"metAt":null,"evidence":null,"url":null,"sync":"unsynced","syncWord":null}],"tickets":[]}],"doneWhen":[]}} | mail+1 mail_deliveries+1 plan_tickets+1
      worker, kind work: 403 {"ok":false,"error":"not-plan-owner","detail":"a worker files a follow-up into its own epic only"} | no rows changed
      plan show, GET: 200 {"ok":true,"plan":{"program":"prog-a","planned":true,"initiatives":[],"epics":[{"key":"e1","title":"Epic e1","summary":"s","project":"demo","waves":[1],"state":"planned","url":null,"sync":"unsynced","syncWord":null,"checkpoints":[{"key":"e1-c1","title":"c","kind":"acceptance","state":"open","proves":[],"metAt":null,"evidence":null,"url":null,"sync":"unsynced","syncWord":null}],"tickets":[{"key":"t1","kind":"task","title":"First","project":"demo","checkpoint":"e1-c1","source":"plan","state":"open","runId":null,"identifier":null,"url":null,"sync":"unsynced","syncWord":null},{"key":"f1","kind":"follow-up","title":"later","project":"demo","checkpoint":null,"source":"worker","state":"open","runId":null,"identifier":null,"url":null,"sync":"unsynced","syncWord":null}]},{"key":"e2","title":"Epic e2","summary":"s","project":"demo","waves":[2],"state":"planned","url":null,"sync":"unsynced","syncWord":null,"checkpoints":[{"key":"e2-c1","title":"c","kind":"acceptance","state":"open","proves":[],"metAt":null,"evidence":null,"url":null,"sync":"unsynced","syncWord":null}],"tickets":[]}],"doneWhen":[]},"work":{"source":"plan","end":null,"verdicts":"not-read","initiatives":[],"doneWhen":[],"counts":{"done":0,"in-progress":0,"waiting-on-you":0,"held":0,"not-started":2,"dropped":0,"closed":0,"left-open":0,"failed":0},"items":[{"key":"t1","title":"First","status":"not-started","group":"not-started","reason":null,"epic":{"key":"e1","title":"Epic e1"},"phases":[],"runId":null,"lastMoveAt":null,"wave":null,"doneAt":null,"itemIds":[],"lastFailedRunId":null},{"key":"f1","title":"later","status":"not-started","group":"not-started","reason":null,"epic":{"key":"e1","title":"Epic e1"},"phases":[],"runId":null,"lastMoveAt":null,"wave":null,"doneAt":null,"itemIds":[],"lastFailedRunId":null}],"phases":[],"notInPhase":[],"epics":[{"key":"e1","title":"Epic e1","url":null,"dropped":false,"done":0,"total":2,"checkpointsMet":0,"checkpointsTotal":1,"checkpoints":[{"key":"e1-c1","title":"c","kind":"acceptance","state":"open","metAt":null,"evidence":null,"url":null}],"items":["t1","f1"]},{"key":"e2","title":"Epic e2","url":null,"dropped":false,"done":0,"total":0,"checkpointsMet":0,"checkpointsTotal":1,"checkpoints":[{"key":"e2-c1","title":"c","kind":"acceptance","state":"open","metAt":null,"evidence":null,"url":null}],"items":[]}],"beforePlan":null,"runs":null}} | no rows changed"
    `);
  });
});

describe('POST /api/runs', () => {
  const OPEN = { program: 'prog-a', title: 'Wave two', project: 'demo', wave: 2, waveOf: 3, homeProject: 'demo' };
  it('a coordinator opens a work run and a review of its own work run; a stale uuid; no uuid after the switch-over', async () => {
    expect(await three(async (st) => {
      const w = await core(st);
      const L: string[] = [];
      if (!w.coord.advance(w.runId, 'awaiting-review', 'coordinator').ok) throw new Error('fixture advance refused');
      L.push(await step(w, 'work open', () => post(w, '/api/runs', { ...OPEN, claimedBy: COORD, claimedByUuid: `u-${COORD}` })));
      L.push(await step(w, 'review open', () => post(w, '/api/runs', { program: 'prog-a', title: 'Review wave 1', kind: 'review', reviews: w.runId,
        claimedBy: COORD, claimedByUuid: `u-${COORD}`, homeProject: 'demo' })));
      L.push(await step(w, 'stale claimedByUuid', () => post(w, '/api/runs', { ...OPEN, wave: 3, claimedBy: COORD, claimedByUuid: 'u-stale' })));
      L.push(await step(w, 'no claimedByUuid (the fleet carries the client)', () => post(w, '/api/runs', { ...OPEN, wave: 3, claimedBy: COORD })));
      L.push(facts(w, 'runs', 'SELECT id, program, wave, kind, state, claimedBy, unattributed FROM runs ORDER BY id'));
      return L.join('\n');
    })).toMatchInlineSnapshot(`
      "work open: 200 {"ok":true,"id":3,"program":"prog-a","state":"planned","ledgerPath":"docs/superpowers/programs/prog-a.md","ledgerRepo":"demo","ledgerAbsPath":"<home>/projects/demo/docs/superpowers/programs/prog-a.md"} | run_events+1 runs+1
      review open: 200 {"ok":true,"id":4,"program":"prog-a","state":"planned","ledgerPath":"docs/superpowers/programs/prog-a.md","ledgerRepo":"demo","ledgerAbsPath":"<home>/projects/demo/docs/superpowers/programs/prog-a.md"} | runs+1
      stale claimedByUuid: 403 {"ok":false,"error":"stale-uuid","detail":"claimedByUuid does not match the registry — stale sender; re-read your own .uuid"} | no rows changed
      no claimedByUuid (the fleet carries the client): 409 {"ok":false,"refused":"attribution-required","detail":"upgrade the fleet box's ccrc-api (ccrc rollout)"} | no rows changed
      runs: [{"id":1,"program":"prog-a","wave":1,"kind":"work","state":"awaiting-review","claimedBy":"lane-a-project-a-coord","unattributed":0},{"id":2,"program":"prog-dead","wave":1,"kind":"work","state":"planned","claimedBy":"lane-a-dead-coord","unattributed":0},{"id":3,"program":"prog-a","wave":2,"kind":"work","state":"planned","claimedBy":"lane-a-project-a-coord","unattributed":0},{"id":4,"program":"prog-a","wave":1,"kind":"review","state":"planned","claimedBy":"lane-a-project-a-coord","unattributed":0}]"
    `);
  });
  it('no claimedByUuid before the switch-over (the fleet stamp is older): accepted, journaled unattributed', async () => {
    const stamp = (sha: string): BuildInfo => ({ sha, ref: 'main', builtAt: '2026-10-18T00:00:00Z', dirty: false });
    expect(await three(async (st) => {
      const w = await core(st, { role: 'server', over: { build: stamp('b'.repeat(40)),
        fleetState: { connected: true, downSince: null, rosterFp: null, build: null, ccdVerbs: null } } });
      const L: string[] = [];
      L.push(await step(w, 'no claimedByUuid', () => post(w, '/api/runs', { ...OPEN, claimedBy: COORD })));
      L.push(facts(w, 'runs', 'SELECT id, program, wave, claimedBy, unattributed FROM runs ORDER BY id'));
      return L.join('\n');
    })).toMatchInlineSnapshot(`
      "no claimedByUuid: 200 {"ok":true,"id":3,"program":"prog-a","state":"planned","ledgerPath":"docs/superpowers/programs/prog-a.md","ledgerRepo":"demo","ledgerAbsPath":"<home>/projects/demo/docs/superpowers/programs/prog-a.md"} | run_events+1 runs+1
      runs: [{"id":1,"program":"prog-a","wave":1,"claimedBy":"lane-a-project-a-coord","unattributed":0},{"id":2,"program":"prog-dead","wave":1,"claimedBy":"lane-a-dead-coord","unattributed":0},{"id":3,"program":"prog-a","wave":2,"claimedBy":"lane-a-project-a-coord","unattributed":1}]"
    `);
  });
});

describe('POST /api/runs/:id/reclaim and the archive hand-over', () => {
  it('the operator moves a dead coordinator\'s programme to a live coordinator; an heir that is another run\'s worker', async () => {
    expect(await three(async (st) => {
      const w = await core(st);
      const L: string[] = [];
      L.push(await step(w, 'heir is a worker', () => post(w, `/api/runs/${w.deadRunId}/reclaim`, { claimedBy: WORKER }, {})));
      L.push(await step(w, 'reclaim to a live coordinator', () => post(w, `/api/runs/${w.deadRunId}/reclaim`, { claimedBy: HEIR }, {})));
      L.push(facts(w, 'runs', 'SELECT id, program, claimedBy FROM runs ORDER BY id'));
      return L.join('\n');
    })).toMatchInlineSnapshot(`
      "heir is a worker: 409 {"ok":false,"refused":"heir-is-a-worker","by":"lane-a-project-a-coord"} | no rows changed
      reclaim to a live coordinator: 200 {"ok":true,"program":"prog-dead","runIds":[2],"from":"lane-a-dead-coord","to":"lane-a-heir-coord"} | run_events+1
      runs: [{"id":1,"program":"prog-a","claimedBy":"lane-a-project-a-coord"},{"id":2,"program":"prog-dead","claimedBy":"lane-a-heir-coord"}]"
    `);
  });
  it('the archive door hands a coordinator\'s programme to a live coordinator', async () => {
    expect(await three(async (st) => {
      const w = await core(st);
      const L: string[] = [];
      L.push(await step(w, 'archive with a hand-over', () => w.app.inject({ method: 'POST', url: `/api/sessions/${COORD}/archive`, payload: { runs: 'handover', heir: HEIR } })));
      L.push(facts(w, 'runs', 'SELECT id, program, claimedBy FROM runs ORDER BY id'));
      L.push(`ccd: ${JSON.stringify(w.calls.filter((c) => c[0] === 'ws-archive'))}`);
      return L.join('\n');
    })).toMatchInlineSnapshot(`
      "archive with a hand-over: 200 {"ok":true,"archived":true,"stopped":false,"ended":[],"moved":{"to":"lane-a-heir-coord","runs":[{"id":1,"program":"prog-a","wave":1,"waveOf":3}]}} | run_events+1
      runs: [{"id":1,"program":"prog-a","claimedBy":"lane-a-heir-coord"},{"id":2,"program":"prog-dead","claimedBy":"lane-a-dead-coord"}]
      ccd: [["ws-archive","--session","lane-a-project-a-coord"]]"
    `);
  });
});

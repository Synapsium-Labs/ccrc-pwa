// Overlord W1, plan w1-other-lanes Tasks 3 and 4: the write lanes REFUSE the Overlord's body, and only it.
//
// The Task 1 suite (`overlord-other-lanes-pin.test.ts`) pins what every other caller is answered. This one shows the lanes of the
// plan's Table 1 refusing one caller: the designation's live binding, a pending attempt's body of either kind, and an id still
// owed its stop. Each case runs the real server over a fixture HOME and a real `coord.db`; the designation is seeded through the
// store's own writers (a fake journal appender) or, for the two states no writer reaches (a `rebind` attempt, an unreadable
// row), by SQL. Every refused caller is a REAL registry row with a current uuid, so attribution passes and the refusal that
// answers is the lane's own.
//
// What a refused call must leave: the answer (exact status and exact parsed body), no row changed in any table of `coord.db`
// (counts and a whole-table dump), and the door's own facts (no tmux or ccd call, no call to the Linear stand-in, no Linear
// journal line, no read of the Linear store, no change to the delegation applier, no key sent to a pane).
import { describe, it, expect, afterEach, afterAll, vi } from 'vitest';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
import type { LightMyRequestResponse } from 'fastify';
import { buildServer, type Deps } from '../src/server.js';
import { Bus } from '../src/bus.js';
import { FleetWatcher } from '../src/watch.js';
import { Tmux, type Runner } from '../src/exec.js';
import { askKey } from '../src/askkey.js';
import { openCoordDb } from '../src/coord/db.js';
import { CoordStore } from '../src/coord/store.js';
import { createLandingJournal } from '../src/coord/landingJournal.js';
import { planStorePort } from '../src/coord/planStore.js';
import { NotifyLog } from '../src/notifylog.js';
import {
  bindPendingGeneration, designatePending, designationRead, failPending, goLive, type AuthorityAppender,
} from '../src/coord/overlordDesignationStore.js';
import { testDeps } from './helpers.js';
import { mkTmp, removeTmpFixtures } from './tmpHelpers.js';
import { ID_GATE_TOKEN } from './idGateFixture.js';
import { seedLegacyProgramme } from './helpers/plan.js';
import { standardFixture, CHILD, CHILD2, PARENT, DUNE, TOK, uuidOf } from './approvalsHarness.js';
import { BODIES, proxyRig, seedSlot } from './linearProxyRig.js';
import { overlordDetail } from './otherLanesFixture.js';

// Counts every read of the Linear store that goes through the module's export (the plan doors' `readLinearStore` dep).
const storeReads = vi.hoisted(() => ({ n: 0 }));
vi.mock('../src/linear/store.js', async (orig) => {
  const actual = await orig<typeof import('../src/linear/store.js')>();
  return { ...actual, readLinearStore: (...a: Parameters<typeof actual.readLinearStore>) => { storeReads.n += 1; return actual.readLinearStore(...a); } };
});

vi.setConfig({ testTimeout: 300_000 });

// ── the callers ──────────────────────────────────────────────────────────────────────────────────────────────────────────
const COORD = 'lane-a-project-a-coord';
const WORKER = 'lane-a-project-a-worker';
const PLAIN = 'lane-a-plain';
const DEAD = 'lane-a-dead-coord';
const HEIR = 'lane-a-heir-coord';
/** The live binding, a failed attempt's owed stop, a pending designate's body, a pending rebind's body. */
const OAK = 'lane-a-overlord-quiet-oak';
const OWED = 'lane-a-overlord-owed';
const PEND_D = 'lane-a-overlord-pending-designate';
const PEND_R = 'lane-a-overlord-pending-rebind';
/** Callers with a `profile` route field (read only while the designation is unreadable). */
const OVL = 'lane-a-profile-overlord';
const UNR = 'lane-a-profile-unreadable';
const PROFC = 'lane-a-profile-coordinator';
const PLAIN_ROWS = [COORD, WORKER, PLAIN, DEAD, HEIR] as const;
const EXTRA_ROWS = [OAK, OWED, PEND_D, PEND_R, OVL, UNR, PROFC] as const;
const ROWS = [...PLAIN_ROWS, ...EXTRA_ROWS];

// ── the designation states ───────────────────────────────────────────────────────────────────────────────────────────────
const NOW = 1_800_000_000_000;
const GEN = '11111111-2222-3333-4444-555555555555';
type State = 'none' | 'live' | 'pend-designate' | 'pend-rebind' | 'bad';
/** The refused states and who each refuses. */
const REFUSED: Readonly<Record<'live' | 'pend-designate' | 'pend-rebind', readonly string[]>> = {
  live: [OAK, OWED], 'pend-designate': [PEND_D], 'pend-rebind': [OAK, PEND_R],
};
const REFUSING = ['live', 'pend-designate', 'pend-rebind'] as const;
type Refusing = typeof REFUSING[number];
const WHY = 'stopsOwed is not a JSON array of strings';
const fakeJournal = { appendInTx: () => ({ ok: true, kind: 'appended', record: {} }) } as unknown as AuthorityAppender;

function seedDesignation(db: DatabaseSync, st: State): void {
  if (st === 'none') return;
  const des = (id: string, opKey: string): void => {
    expect(designatePending(db, fakeJournal, { sessionId: id, deadlineAt: NOW + 60_000, model: 'opus', accountPools: { pools: ['pool-a'], untagged: false },
      actor: 'operator-a', at: NOW, opKey }).ok).toBe(true);
  };
  const live = (): void => {
    des(OWED, 'op-owed');
    expect(failPending(db, OWED, 'create-failed', NOW + 1, true)).toEqual({ ok: true, changed: true });
    des(OAK, 'op-live');
    expect(bindPendingGeneration(db, OAK, GEN, NOW + 2)).toEqual({ ok: true, changed: true });
    expect(goLive(db, fakeJournal, OAK, GEN, NOW + 3)).toMatchObject({ ok: true, changed: true });
  };
  if (st === 'live') { live(); return; }
  if (st === 'pend-designate') {
    des(PEND_D, 'op-pending');
    expect(bindPendingGeneration(db, PEND_D, GEN, NOW + 1)).toEqual({ ok: true, changed: true });
    return;
  }
  if (st === 'pend-rebind') {
    // No writer reaches a `rebind` attempt yet: the live binding stays, and the pending columns are written by hand.
    des(OAK, 'op-live');
    expect(bindPendingGeneration(db, OAK, GEN, NOW + 1)).toEqual({ ok: true, changed: true });
    expect(goLive(db, fakeJournal, OAK, GEN, NOW + 2)).toMatchObject({ ok: true, changed: true });
    db.prepare("UPDATE overlord_designation SET pendingId = ?, pendingKind = 'rebind', pendingSince = ?, pendingDeadlineAt = ?, pendingActor = 'operator-a'")
      .run(PEND_R, NOW + 3, NOW + 60_000);
    expect(designationRead(db)).toMatchObject({ kind: 'designated', row: { pending: { sessionId: PEND_R, kind: 'rebind' } } });
    return;
  }
  // bad: a row the one reader cannot narrow.
  des(OAK, 'op-bad');
  db.prepare("UPDATE overlord_designation SET stopsOwed = 'not-json'").run();
  expect(designationRead(db)).toEqual({ kind: 'unmeasured', why: WHY });
}

/** The three callers' `profile` route fields of the unreadable-designation cases: `overlord`, `coordinator`, a directory. */
function writeProfiles(home: string): void {
  const reg = path.join(home, '.cc-sessions');
  writeFileSync(path.join(reg, `${OVL}.profile`), 'overlord');
  writeFileSync(path.join(reg, `${PROFC}.profile`), 'coordinator');
  mkdirSync(path.join(reg, `${UNR}.profile`));
}
const applyState = (db: DatabaseSync, home: string, st: State): void => {
  seedDesignation(db, st);
  if (st === 'bad') writeProfiles(home);
};

// ── lines ────────────────────────────────────────────────────────────────────────────────────────────────────────────────
const norm = (s: string): string => s.replace(/\/[^"\s\\]*\/ccrc-[A-Za-z0-9-]+/g, '<home>').replace(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z/g, '<instant>').replace(/\b\d{13}\b/g, '<ms>');
const tablesOf = (db: DatabaseSync): string[] =>
  (db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all() as { name: string }[])
    .map((r) => r.name).filter((n) => n !== 'overlord_designation');
const counts = (db: DatabaseSync): Record<string, number> =>
  Object.fromEntries(tablesOf(db).map((n) => [n, (db.prepare(`SELECT COUNT(*) AS n FROM "${n}"`).get() as { n: number }).n]));
const delta = (a: Record<string, number>, b: Record<string, number>): string => {
  const d = Object.keys(b).filter((k) => b[k] !== a[k]).map((k) => `${k}${b[k]! - (a[k] ?? 0) > 0 ? '+' : ''}${b[k]! - (a[k] ?? 0)}`);
  return d.length === 0 ? 'no rows changed' : d.join(' ');
};
/** Every row of every table (the designation's own excepted): an UPDATE the counts cannot see shows here. */
const dump = (db: DatabaseSync): string => JSON.stringify(tablesOf(db).map((n) => [n, db.prepare(`SELECT * FROM "${n}"`).all()]));

// ── the rigs ─────────────────────────────────────────────────────────────────────────────────────────────────────────────
const closers: Array<() => Promise<unknown>> = [];
afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(closers.splice(0).map((close) => close().catch(() => undefined)));
  removeTmpFixtures();
});
afterAll(() => removeTmpFixtures());

interface Door {
  name: string;
  /** The route the refusal names. */
  route: string;
  /** The refusal word (`overlord-uses-its-doors` unless the door is a claimant's). */
  word?: string;
  call: (id: string, uuid: string) => Promise<LightMyRequestResponse>;
}
interface Rig {
  doors: Door[]; db: DatabaseSync;
  /** The door's own facts beyond coord.db: tmux and ccd calls, the Linear stand-in's calls, store reads, keys sent, the applier. */
  probe: () => Promise<string>;
  /** Callers every door answers as it does with no designation (a coordinator, a worker, a plain session, ...). */
  passCallers: string[];
  /** Any other session, for a comparison. */
  plain: string;
}
const DOORS_WORD = 'overlord-uses-its-doors';
const CLAIMANT_WORD = 'overlord-not-a-coordinator';

interface World {
  home: string; app: Awaited<ReturnType<typeof buildServer>>; coord: CoordStore; db: DatabaseSync; calls: string[][];
  runId: number; deadRunId: number; claimId: number; checkpoint: () => Promise<string>;
}
const PANE = 4242;
const post = (w: { app: World['app'] }, url: string, payload: unknown, headers: Record<string, string> = TOK) =>
  w.app.inject({ method: 'POST', url, headers, payload: payload as never });
const get = (w: { app: World['app'] }, url: string, headers: Record<string, string> = TOK) => w.app.inject({ method: 'GET', url, headers });
const as = (id: string): { byId: string; byUuid: string } => ({ byId: id, byUuid: `u-${id}` });

/** The fixture world with NO designation: registry rows for every id, a coordinator with a working run and its worker, a dead
 *  coordinator's planned run, one claim, an unowned plan programme. The caller seeds the designation last. */
async function buildWorld(o: { watcher?: boolean } = {}): Promise<World> {
  const home = mkTmp('ccrc-other-lanes-routes-');
  const dir = path.join(home, '.ccrc');
  const reg = path.join(home, '.cc-sessions');
  mkdirSync(dir, { recursive: true }); mkdirSync(reg, { recursive: true });
  const db = openCoordDb(path.join(dir, 'coord.db'));
  const coord = new CoordStore(db, { landingJournal: createLandingJournal(dir), onUnusableConnection: (): never => { throw new Error('fixture fail-stop'); } });
  const replay = coord.replayLandingJournal();
  if (!replay.ok) throw new Error(`fixture replay refused: ${replay.error}`);
  ROWS.forEach((id, i) => {
    const workdir = path.join(home, 'worktrees', 'demo', id);
    mkdirSync(workdir, { recursive: true });
    const fields: Record<string, string> = { wrapper: 'claude-a', project: 'demo', workdir, uuid: `u-${id}`, started: '1', workspace: id,
      branch: `ws/${id}`, base: 'origin/main', generation: `0189abcd-1234-4678-9abc-0123456789${i.toString().padStart(2, '0')}` };
    for (const [k, v] of Object.entries(fields)) writeFileSync(path.join(reg, `${id}.${k}`), v);
  });
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
  const deps: Deps = { ...base, mailToken: ID_GATE_TOKEN, coord, plan: planStorePort(db), notifyLog: log };
  let app: World['app'];
  let checkpoint: World['checkpoint'] = async () => 'no watcher';
  if (o.watcher === true) {
    const bus = new Bus();
    const watcher = new FleetWatcher(deps as never, bus, 10_000);
    app = await buildServer(deps, bus, watcher);
    closers.push(() => app.close(), () => watcher.closeDelegation());
    const durable = await watcher.delegationApplier();
    if (durable === null) throw new Error('the lane opened no applier');
    checkpoint = async () => JSON.stringify(durable.state().checkpoint.sessions.map((s) => [s.sessionId, s.explicitIntentAt !== null]));
  } else {
    app = await buildServer(deps);
    closers.push(() => app.close());
  }
  const open = (program: string, claimedBy: string): number => {
    const r = coord.openRun({ program, title: program, project: 'demo', wave: 1, waveOf: 3, claimedBy });
    if (!('id' in r)) throw new Error(`fixture openRun refused: ${JSON.stringify(r)}`);
    return r.id;
  };
  const runId = open('prog-a', COORD);
  coord.markDispatched(runId, WORKER, WORKER, `ws/${WORKER}`, false);
  for (const to of ['dispatched', 'working'] as const) if (!coord.advance(runId, to, 'coordinator').ok) throw new Error(`fixture advance to ${to} refused`);
  const deadRunId = open('prog-dead', DEAD);
  // The programme every refused `POST /api/runs` names: seeded here, so a refused open has no programme row to add.
  seedLegacyProgramme(db, 'prog-open', 'demo');
  const taken = await post({ app }, '/api/claims', { ...as(COORD), project: 'demo', paths: ['shared/api.ts'], intent: 'working' });
  if (taken.statusCode !== 200) throw new Error(`fixture claim refused: ${taken.body}`);
  const claimId = (JSON.parse(taken.body) as { ids: number[] }).ids[0]!;
  return { home, app, coord, db, calls, runId, deadRunId, claimId, checkpoint };
}

const epic = (key: string, waves: number[]) => ({ key, title: `Epic ${key}`, summary: 's', waves, checkpoints: [{ key: `${key}-c1`, title: 'c', kind: 'acceptance' }] });
const PLAN = { home: 'demo', epics: [epic('e1', [1]), epic('e2', [2])], phases: [{ key: 'p1', title: 'Phase p1', summary: 's', refs: [] }] };
const TICKET = { epic: 'e1', key: 't1', kind: 'task', title: 'First', checkpoint: 'e1-c1' };
const PLAN_DOORS: ReadonlyArray<readonly [name: string, suffix: string, body: (n: number) => Record<string, unknown>]> = [
  ['declare', '', () => PLAN],
  ['met', '/met', () => ({ checkpoint: 'e1-c1', evidence: { pr: 12 } })],
  ['tickets', '/tickets', (n) => ({ epic: 'e1', key: `t${n}`, kind: 'task', title: 'Do it', checkpoint: 'e1-c1' })],
  ['tickets/move', '/tickets/move', () => ({ ticket: 't1', epic: 'e2' })],
  ['epics/drop', '/epics/drop', () => ({ epic: 'e2', why: 'out of scope' })],
  ['phases/refs', '/phases/refs', () => ({ op: 'add', phase: 'p1', ref: { kind: 'epic', key: 'e1' } })],
  ['close', '/close', () => ({ outcome: 'abandoned', why: 'superseded' })],
];
const planSend = (w: { app: World['app'] }, slug: string, suffix: string, body: unknown, who_: { byId: string; byUuid: string }) =>
  w.app.inject({ method: 'POST', url: `/api/programmes/${slug}/plan${suffix}?byId=${who_.byId}&byUuid=${who_.byUuid}`, headers: TOK, payload: body as never });
/** A plan programme with a plan and a ticket and NO owner: the arm that admits any attributed caller. */
async function seedUnownedPlan(w: World, slug: string): Promise<void> {
  expect((await planSend(w, slug, '', PLAN, as(COORD))).statusCode).toBe(200);
  expect((await planSend(w, slug, '/tickets', TICKET, as(COORD))).statusCode).toBe(200);
  w.db.prepare('UPDATE programs SET planBy = NULL WHERE slug = ?').run(slug);
}

const RAISE = { kind: 'do', title: 'Turn on the setting', why: 'The wave needs it.', how: ['Open Settings', 'Switch it on'], neededBy: 'soon', soonLabel: 'before wave 6' };
const HEAD = 'a'.repeat(40);
const HC = 'c'.repeat(40);

function coreDoors(w: World): Door[] {
  const planDoors: Door[] = PLAN_DOORS.map(([name, suffix, body]) => ({
    name: `plan ${name}`, route: `POST /api/programmes/:slug/plan${suffix}`,
    call: (id, uuid) => planSend(w, 'prog-q', suffix, body(7), { byId: id, byUuid: uuid }),
  }));
  return [
    { name: 'mail', route: 'POST /api/mail', call: (id, uuid) => post(w, '/api/mail', { fromId: id, fromUuid: uuid, toId: COORD, kind: 'finding', subject: 'a finding', body: 'the body', artifacts: [] }) },
    { name: 'items', route: 'POST /api/programmes/:slug/items', call: (id, uuid) => post(w, '/api/programmes/prog-a/items', { byId: id, byUuid: uuid, ...RAISE }) },
    { name: 'claims take', route: 'POST /api/claims', call: (id, uuid) => post(w, '/api/claims', { byId: id, byUuid: uuid, project: 'demo', paths: ['ccd/ccd'], intent: 'working' }) },
    { name: 'claims release', route: 'POST /api/claims/:id/release', call: (id, uuid) => post(w, `/api/claims/${w.claimId}/release`, { byId: id, byUuid: uuid }) },
    { name: 'landing entries', route: 'POST /api/landing/entries', call: (id, uuid) => post(w, '/api/landing/entries', { byId: id, byUuid: uuid, project: 'demo', pr: 11, pinnedSha: HEAD, handoffCommit: HC }) },
    { name: 'landing order', route: 'POST /api/landing/order', call: (id, uuid) => post(w, '/api/landing/order', { byId: id, byUuid: uuid, project: 'demo', pr: 11, afterIds: [] }) },
    { name: 'runs open', route: 'POST /api/runs', word: CLAIMANT_WORD, call: (id, uuid) => post(w, '/api/runs', { program: 'prog-open', title: 'Wave one', project: 'demo', wave: 1, waveOf: 3,
      homeProject: 'demo', claimedBy: id, claimedByUuid: uuid }) },
    ...planDoors,
  ];
}

async function coreRig(st: State): Promise<Rig & { w: World }> {
  const w = await buildWorld();
  await seedUnownedPlan(w, 'prog-q');
  applyState(w.db, w.home, st);
  return { w, doors: coreDoors(w), db: w.db, passCallers: [COORD, WORKER, PLAIN, PROFC], plain: PLAIN,
    probe: async () => JSON.stringify({ calls: w.calls, storeReads: storeReads.n }) };
}

async function intentRig(st: State): Promise<Rig & { w: World }> {
  const w = await buildWorld({ watcher: true });
  applyState(w.db, w.home, st);
  const intent = (action: string) => (id: string, uuid: string) => post(w, `/api/coordinators/${id}/intent`, { action, byId: id, byUuid: uuid });
  return { w, db: w.db, passCallers: [COORD, PROFC], plain: PLAIN,
    doors: [{ name: 'intent set', route: 'POST /api/coordinators/:session/intent', call: intent('set') },
      { name: 'intent clear', route: 'POST /api/coordinators/:session/intent', call: intent('clear') }],
    probe: async () => JSON.stringify({ calls: w.calls, checkpoint: await w.checkpoint() }) };
}

const QUESTION = { question: 'Which colour?', options: [{ label: 'Red' }, { label: 'Blue' }] };
const ASK_KEY = askKey({ questions: [QUESTION] })!;
const ASK_PANE = 'Which colour?\n❯ 1. Red\n  2. Blue\nEnter to select\n';
async function questionRig(st: State): Promise<Rig> {
  const keys: string[] = [];
  vi.spyOn(Tmux.prototype, 'sendKey').mockImplementation(async (id: string, k: string) => { keys.push(`${id} ${k}`); return true; });
  vi.spyOn(Tmux.prototype, 'sendLiteral').mockImplementation(async (id: string, t: string) => { keys.push(`${id} -l ${t}`); return true; });
  const f = await standardFixture();
  closers.push(() => f.close());
  for (const id of EXTRA_ROWS) f.seed(id, 'project-a');
  const now = Date.now();
  writeFileSync(path.join(f.home, '.cc-sessions', `${CHILD}.hookstate.json`), JSON.stringify({
    v: 1, state: 'waiting', event: 'PermissionRequest', sessionId: uuidOf(CHILD), pid: 4242, updatedAt: now, ask: { questions: [QUESTION] }, subagents: [],
  }));
  f.panes.set(CHILD, ASK_PANE);
  const insert = (childId: string, dialogId: string): number => f.coord.insertAsk({ childId, parentId: PARENT, runId: f.runId, askKey: ASK_KEY, askAt: now,
    dialogId, question: QUESTION.question, options: QUESTION.options.map((x) => x.label), now });
  const ruled = insert(CHILD, 'dlg-1');
  const released = insert(CHILD2, 'dlg-2');
  applyState(f.coord.db, f.home, st);
  return { db: f.coord.db, passCallers: [PARENT, DUNE, PROFC], plain: DUNE,
    probe: async () => JSON.stringify({ keys }),
    doors: [
      { name: 'question rule', route: 'POST /api/questions/:id/rule', call: (id, uuid) => f.app.inject({ method: 'POST', url: `/api/questions/ask-${ruled}/rule`, headers: TOK,
        payload: { kind: 'ask', fromId: id, fromUuid: uuid, optionIndexes: [1], askKey: ASK_KEY } as never }) },
      { name: 'question release', route: 'POST /api/questions/:id/release', call: (id, uuid) => f.app.inject({ method: 'POST', url: `/api/questions/ask-${released}/release`, headers: TOK,
        payload: { kind: 'ask', fromId: id, fromUuid: uuid } as never }) },
    ] };
}

async function linearRig(st: State): Promise<Rig & { calls: () => string[]; search: (id: string) => Promise<LightMyRequestResponse>;
  create: (id: string, body: unknown) => Promise<LightMyRequestResponse> }> {
  const home = mkTmp('ccrc-other-lanes-routes-linear-');
  const db = openCoordDb(path.join(home, 'coord.db'));
  const r = await proxyRig({ db, over: { coord: new CoordStore(db) }, sessions: ROWS });
  closers.push(() => r.close());
  await seedSlot(r.ccrcDir, 'a');
  applyState(db, r.home, st);
  const route = (suffix: string): string => `POST /api/linear/proxy/issues${suffix}`;
  const verbs = [['create', ''], ['update', '/:id'], ['comment', '/:id/comments'], ['link', '/:id/links']] as const;
  return { db, passCallers: [COORD, WORKER, PLAIN, PROFC], plain: PLAIN, calls: () => r.calls.map((c) => c.op),
    search: (id) => r.call('search', { as: { id, uuid: `u-${id}` }, body: BODIES.search }),
    create: (id, body) => r.call('create', { as: { id, uuid: `u-${id}` }, body }),
    probe: async () => JSON.stringify({ calls: r.calls.map((c) => c.op), events: r.rows().length }),
    doors: verbs.map(([verb, suffix]) => ({ name: `linear ${verb}`, route: route(suffix),
      call: (id: string, uuid: string) => r.call(verb, { as: { id, uuid }, body: BODIES[verb] }) })) };
}

const RIGS: ReadonlyArray<readonly [name: string, make: (st: State) => Promise<Rig>]> = [
  ['core doors', coreRig], ['coordinator intent', intentRig], ['question doors', questionRig], ['Linear writes', linearRig],
];

// ── assertions ───────────────────────────────────────────────────────────────────────────────────────────────────────────
const parsed = (res: LightMyRequestResponse): unknown => JSON.parse(res.body);

/** One refused call: exact status and body, and nothing written anywhere. */
async function expectRefused(rig: Rig, door: Door, id: string): Promise<void> {
  const before = counts(rig.db); const d0 = dump(rig.db); const p0 = await rig.probe();
  const res = await door.call(id, `u-${id}`);
  expect({ door: door.name, caller: id, status: res.statusCode, body: parsed(res) }).toEqual({ door: door.name, caller: id, status: 403,
    body: { ok: false, error: door.word ?? DOORS_WORD, detail: overlordDetail(id, door.route) } });
  expect(delta(before, counts(rig.db)), `${door.name} by ${id}`).toBe('no rows changed');
  expect(dump(rig.db), `${door.name} by ${id}: a row changed`).toBe(d0);
  expect(await rig.probe(), `${door.name} by ${id}`).toBe(p0);
}

describe('the bound body, a pending body and an owed stop are refused on every door', () => {
  for (const st of REFUSING) {
    for (const [name, make] of RIGS) {
      it(`${st}: ${name}`, async () => {
        const rig = await make(st);
        for (const id of REFUSED[st]) for (const door of rig.doors) await expectRefused(rig, door, id);
      });
    }
  }
});

describe('a refused body is a real registry row, and the refusal is the lane\'s own', () => {
  it('the designation reads live and the caller passes attribution with a stale uuid under today\'s answer', async () => {
    for (const [name, make] of RIGS) {
      const rig = await make('live');
      for (const door of rig.doors) {
        // Recorded or not, the answer to a stale uuid is the one every caller gets: the refusal does not run before attribution.
        const b1 = counts(rig.db);
        const a = await door.call(OAK, 'u-stale');
        const d1 = delta(b1, counts(rig.db));
        const b2 = counts(rig.db);
        const p = await door.call(rig.plain, 'u-stale');
        const d2 = delta(b2, counts(rig.db));
        expect({ rig: name, door: door.name, status: a.statusCode, error: (parsed(a) as { error?: string }).error }, `${name} ${door.name}`)
          .toEqual({ rig: name, door: door.name, status: 403, error: 'stale-uuid' });
        expect(parsed(a), `${name} ${door.name}: same body as any caller`).toEqual(parsed(p));
        expect(d1, `${name} ${door.name}: same writes as any caller`).toBe(d2);
        if (door.name === 'mail') expect(d1).toBe('mail_rejections+1');
        else expect(d1, `${name} ${door.name}`).toBe('no rows changed');
      }
    }
  });
  it('the stale uuid on mail records the rejection against the bound body', async () => {
    const rig = await coreRig('live');
    const mail = rig.doors.find((d) => d.name === 'mail')!;
    const res = await mail.call(OAK, 'u-stale');
    expect(res.statusCode).toBe(403);
    expect(parsed(res)).toEqual({ ok: false, error: 'stale-uuid', detail: 'fromUuid does not match the registry — stale sender' });
    expect(rig.db.prepare('SELECT code, fromId FROM mail_rejections ORDER BY id').all()).toEqual([{ code: 'stale-uuid', fromId: OAK }]);
  });
});

describe('the plan doors: the bound body on a programme with no owner', () => {
  it('each of the seven is refused, and a plain session on a programme with no owner is admitted', async () => {
    const rig = await coreRig('live');
    const w = rig.w;
    const reads0 = storeReads.n;
    for (const door of rig.doors.filter((d) => d.name.startsWith('plan '))) await expectRefused(rig, door, OAK);
    expect(storeReads.n, 'a refused plan write reads no Linear store').toBe(reads0);
    expect(w.db.prepare("SELECT slug, planBy FROM programs WHERE slug = 'prog-q'").all()).toEqual([{ slug: 'prog-q', planBy: null }]);
    // The control: the same doors, each on a programme of its own with no owner, called by a plain session.
    let n = 0;
    for (const [name, suffix, body] of PLAN_DOORS) {
      n += 1;
      const slug = `prog-c${n}`;
      if (name !== 'declare') await seedUnownedPlan(w, slug);
      const res = await planSend(w, slug, suffix, body(9), as(PLAIN));
      expect({ name, status: res.statusCode }, `${name}: ${res.body}`).toEqual({ name, status: 200 });
    }
  });
});

describe('what stays open to the bound body', () => {
  it('its mail inbox and ack answer as for any session, and mail to it from a coordinator is delivered', async () => {
    const w = await buildWorld();
    seedDesignation(w.db, 'live');
    const mailTo = (to: string) => post(w, '/api/mail', { fromId: COORD, fromUuid: `u-${COORD}`, toId: to, kind: 'finding', subject: `for ${to}`, body: 'the body', artifacts: [] });
    for (const to of [OAK, PLAIN]) {
      const b = counts(w.db);
      const sent = await mailTo(to);
      expect(sent.statusCode, `${to}: ${sent.body}`).toBe(202);
      expect(parsed(sent)).toMatchObject({ ok: true });
      expect(delta(b, counts(w.db))).toBe('mail+1 mail_deliveries+1');
    }
    const answers: Record<string, { inbox: number; keys: string[]; ack: number; ackKeys: string[] }> = {};
    for (const id of [OAK, PLAIN]) {
      const inbox = await get(w, `/api/mail/inbox?fromId=${id}&fromUuid=u-${id}`);
      expect(inbox.body, id).toContain(`for ${id}`);
      const delivery = (w.db.prepare('SELECT id FROM mail_deliveries WHERE toId = ?').get(id) as { id: number }).id;
      const before = counts(w.db);
      const ack = await post(w, `/api/mail/${delivery}/ack`, { fromId: id, fromUuid: `u-${id}` });
      expect(delta(before, counts(w.db)), id).not.toContain('mail_rejections');
      answers[id] = { inbox: inbox.statusCode, keys: Object.keys(parsed(inbox) as object), ack: ack.statusCode, ackKeys: Object.keys(parsed(ack) as object) };
      expect(parsed(ack)).toMatchObject({ ok: true });
    }
    expect(answers[OAK]).toEqual({ inbox: 200, ack: 200, keys: answers[PLAIN]!.keys, ackKeys: answers[PLAIN]!.ackKeys });
    expect(answers[PLAIN]!.inbox).toBe(200);
    // The ack is recorded for the bound body's delivery, as for a plain session's.
    expect((w.db.prepare('SELECT state FROM mail_deliveries WHERE toId = ?').get(OAK) as { state: string }).state)
      .toBe((w.db.prepare('SELECT state FROM mail_deliveries WHERE toId = ?').get(PLAIN) as { state: string }).state);
  });

  it('its Linear search is unchanged', async () => {
    const rig = await linearRig('live');
    const oak = await rig.search(OAK);
    const coord = await rig.search(COORD);
    expect(oak.statusCode).toBe(200);
    expect(parsed(oak)).toEqual(parsed(coord));
    expect(rig.calls()).toEqual(['Search', 'Search']);
    expect(rig.db.prepare('SELECT COUNT(*) AS n FROM linear_events').get()).toEqual({ n: 0 });
  });

  it('a Linear write with a bad body is refused as the Overlord before the validator, and nothing reaches Linear', async () => {
    const rig = await linearRig('live');
    const oak = await rig.create(OAK, {});
    const coord = await rig.create(COORD, {});
    expect({ status: oak.statusCode, error: (parsed(oak) as { error?: string }).error })
      .toEqual({ status: 403, error: 'overlord-uses-its-doors' });
    expect(coord.statusCode, 'the same bad body from anyone else is the validator\'s answer').toBe(400);
    expect((parsed(coord) as { error?: string }).error).not.toBe('overlord-uses-its-doors');
    expect(rig.calls()).toEqual([]);
    expect(rig.db.prepare('SELECT COUNT(*) AS n FROM linear_events').get()).toEqual({ n: 0 });
  });

  it('POST /api/claims/:id/break with the bound body in the body is the ungated operator door, unchanged', async () => {
    const w = await buildWorld();
    seedDesignation(w.db, 'live');
    const second = await post(w, '/api/claims', { ...as(PLAIN), project: 'demo', paths: ['ccd/ccd'], intent: 'working' });
    const secondId = (parsed(second) as { ids: number[] }).ids[0]!;
    const named = await post(w, `/api/claims/${w.claimId}/break`, as(OAK), {});
    const empty = await post(w, `/api/claims/${secondId}/break`, {}, {});
    expect({ status: named.statusCode, body: parsed(named) }).toEqual({ status: 200, body: parsed(empty) });
    expect(empty.statusCode).toBe(200);
    expect(w.db.prepare('SELECT id, state FROM claims ORDER BY id').all()).toEqual([
      { id: w.claimId, state: 'broken' }, { id: secondId, state: 'broken' }]);
  });
});

// ── an unreadable designation ────────────────────────────────────────────────────────────────────────────────────────────
const unmeasuredDetail = (route: string, profile: string): string =>
  `the Overlord's designation could not be read (${WHY}), and this caller's launch profile reads ${profile}, so ${route} cannot rule out that it is the Overlord; transient, retry`;

/** Every door, once per caller: the status and the normalised body, in a fixed order. */
async function transcript(rig: Rig, callers: readonly string[]): Promise<string[]> {
  const lines: string[] = [];
  for (const door of rig.doors) for (const id of callers) {
    const res = await door.call(id, `u-${id}`);
    lines.push(`${door.name} by ${id}: ${res.statusCode} ${norm(res.body)}`);
  }
  return lines;
}

describe('a hand-written bad designation row (question 4)', () => {
  for (const [name, make] of RIGS) {
    it(`${name}: a caller that is not the Overlord's passes every door, a profile of overlord or an unreadable one is 502, and one line is logged`, async () => {
      // The reference: the same transcript with no row. Its measured reads also close any earlier unmeasured episode.
      const none = await make('none');
      const reference = await transcript(none, none.passCallers);
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
      const bad = await make('bad');
      const passed = await transcript(bad, bad.passCallers);
      expect(passed).toEqual(reference);
      expect(passed.join('\n')).not.toMatch(/overlord-uses-its-doors|overlord-not-a-coordinator|"unmeasured"/);
      expect(passed.some((l) => / 20\d /.test(l)), 'at least one door answered 2xx').toBe(true);
      // The callers that could be the Overlord's body: refused `unmeasured`, nothing written.
      for (const door of bad.doors) {
        for (const [id, profile] of [[OVL, 'overlord'], [UNR, null]] as const) {
          const before = counts(bad.db); const d0 = dump(bad.db); const p0 = await bad.probe();
          const res = await door.call(id, `u-${id}`);
          const body = parsed(res) as { ok: boolean; error: string; detail: string };
          expect({ door: door.name, id, status: res.statusCode, ok: body.ok, error: body.error }).toEqual({ door: door.name, id, status: 502, ok: false, error: 'unmeasured' });
          if (profile !== null) expect(body.detail).toBe(unmeasuredDetail(door.route, profile));
          else {
            const head = `the Overlord's designation could not be read (${WHY}), and this caller's launch profile reads profile `;
            expect(body.detail.startsWith(head), body.detail).toBe(true);
            expect(body.detail.endsWith(`, so ${door.route} cannot rule out that it is the Overlord; transient, retry`), body.detail).toBe(true);
          }
          expect(delta(before, counts(bad.db)), `${door.name} by ${id}`).toBe('no rows changed');
          expect(dump(bad.db)).toBe(d0);
          expect(await bad.probe()).toBe(p0);
        }
      }
      const lines = warn.mock.calls.map((c) => String(c[0])).filter((l) => l.includes('Overlord designation is unreadable'));
      expect(lines, 'one line for the episode').toHaveLength(1);
    });
  }
});

// ── Task 4: run open, run reclaim and the archive hand-over ──────────────────────────────────────────────────────────────
const RUN_OPEN = { program: 'prog-open', title: 'Wave one', project: 'demo', wave: 1, waveOf: 3, homeProject: 'demo' };
describe('the claimant doors: a run open, a reclaim and an archive hand-over refuse the Overlord\'s body', () => {
  it('the bound body opens a run: 403 overlord-not-a-coordinator, no run row and no hold', async () => {
    const rig = await coreRig('live');
    const w = rig.w;
    const runs0 = w.db.prepare('SELECT id, program, claimedBy FROM runs ORDER BY id').all();
    const calls0 = w.calls.length;
    const res = await post(w, '/api/runs', { ...RUN_OPEN, claimedBy: OAK, claimedByUuid: `u-${OAK}` });
    expect({ status: res.statusCode, body: parsed(res) }).toEqual({ status: 403,
      body: { ok: false, error: CLAIMANT_WORD, detail: overlordDetail(OAK, 'POST /api/runs') } });
    expect(w.db.prepare('SELECT id, program, claimedBy FROM runs ORDER BY id').all()).toEqual(runs0);
    expect(w.db.prepare("SELECT COUNT(*) AS n FROM run_events WHERE runId NOT IN (SELECT id FROM runs WHERE id IN (?, ?))").get(w.runId, w.deadRunId)).toEqual({ n: 0 });
    expect(w.calls.slice(calls0), 'no hold, no spawn').toEqual([]);
    expect(w.db.prepare("SELECT COUNT(*) AS n FROM programs WHERE slug = 'prog-open'").get()).toEqual({ n: 1 });
  });

  for (const st of REFUSING) {
    for (const heir of REFUSED[st]) {
      it(`${st}: the operator reclaims a dead coordinator's programme with ${heir} as heir: 403, claimedBy unchanged, no pane measured`, async () => {
        const w = (await coreRig(st)).w;
        const runs0 = w.db.prepare('SELECT id, program, claimedBy FROM runs ORDER BY id').all();
        const before = counts(w.db); const d0 = dump(w.db);
        const calls0 = w.calls.length;
        const res = await post(w, `/api/runs/${w.deadRunId}/reclaim`, { claimedBy: heir }, {});
        expect({ status: res.statusCode, body: parsed(res) }).toEqual({ status: 403,
          body: { ok: false, error: CLAIMANT_WORD, detail: overlordDetail(`the heir ${heir}`, 'POST /api/runs/:id/reclaim') } });
        expect(w.db.prepare('SELECT id, program, claimedBy FROM runs ORDER BY id').all()).toEqual(runs0);
        expect(delta(before, counts(w.db))).toBe('no rows changed');
        expect(dump(w.db)).toBe(d0);
        expect(w.calls.slice(calls0), 'no pane is measured').toEqual([]);
      });

      it(`${st}: the archive door's hand-over to ${heir} is the refused hand-over shape; nothing moves, stops or archives`, async () => {
        const w = (await coreRig(st)).w;
        const runs0 = w.db.prepare('SELECT id, program, claimedBy FROM runs ORDER BY id').all();
        const before = counts(w.db); const d0 = dump(w.db);
        const res = await post(w, `/api/sessions/${COORD}/archive`, { runs: 'handover', heir }, {});
        expect({ status: res.statusCode, body: parsed(res) }).toEqual({ status: 409, body: {
          ok: false, error: 'claims-not-moved', moved: [], notMoved: [{ id: w.runId, program: 'prog-a', wave: 1, waveOf: 3 }],
          refusal: { kind: CLAIMANT_WORD, detail: overlordDetail(`the heir ${heir}`, 'POST /api/runs/:id/reclaim') } } });
        expect(w.db.prepare('SELECT id, program, claimedBy FROM runs ORDER BY id').all()).toEqual(runs0);
        expect(delta(before, counts(w.db))).toBe('no rows changed');
        expect(dump(w.db)).toBe(d0);
        expect(w.calls.filter((c) => c[0] === 'ws-archive' || c[0] === 'kill-session' || c[0] === 'ws-stop'), 'nothing is stopped or archived').toEqual([]);
      });
    }
  }

  it('a pin, green from the start: a coordinator\'s open whose sessionId is the bound body is not-a-child (409), and no run row is written', async () => {
    const rig = await coreRig('live');
    const w = rig.w;
    const runs0 = w.db.prepare('SELECT id, program, claimedBy FROM runs ORDER BY id').all();
    const before = counts(w.db);
    const res = await post(w, '/api/runs', { ...RUN_OPEN, claimedBy: COORD, claimedByUuid: `u-${COORD}`, sessionId: OAK });
    expect(res.statusCode, res.body).toBe(409);
    expect(parsed(res)).toMatchObject({ ok: false, refused: 'not-a-child' });
    expect(w.db.prepare('SELECT id, program, claimedBy FROM runs ORDER BY id').all()).toEqual(runs0);
    expect(delta(before, counts(w.db))).toBe('no rows changed');
  });
});

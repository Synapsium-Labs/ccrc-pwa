// D-6096 (fleet-capacity W1-4b; spec §3.5 "The binding", §5.1 W1-4b; D-8126 amendment A8-4): a coordinator whose wave the
// concurrency cap refused may take that wave as the run's own worker, in place. The bind starts no process and composes no
// fleet act on the coordinator's workspace; a plain dispatch of a run claimed by the session it is bound to is refused
// `self-dispatch` before anything is composed; an in-place run's close and abandon compose no `ws-*` verb on the claimant;
// its done-claim is measured on the sibling worktree's recorded branch; and it is charged to neither cap.
//
// The operator's pause (answer 2, 2026-11-09) stops dispatch, the in-place bind and self-work on new waves, and nothing
// else: a close, an abandon and an advance are not refused by it, and a test below pins that.
//
// The first block is the CHARACTERIZATION: it is green on the base and pins what a self-claimed run does today. The
// behaviour commit flips exactly the rows it names.
import { describe, it, expect, afterEach } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildServer } from '../src/server.js';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { openCoordDb } from '../src/coord/db.js';
import { MIGRATIONS } from '../src/coord/schema.js';
import { CoordStore } from '../src/coord/store.js';
import { bindRunInPlace, dispatchRun, type DispatchRunDeps, type InPlaceDeps } from '../src/coord/dispatch.js';
import { attributionVerdict } from '../src/coord/attribution.js';
import { COORDINATOR_PAUSE_MARKER, MAIL_DISABLED_MARKER } from '../src/coord/rundefs.js';
import { closeRun, type CloseRunDeps } from '../src/coord/close.js';
import { doneRunOf, resolveDoneBranch, verifyDone } from '../src/coord/fingerprint.js';
import { clearSender } from '../src/inject/send.js';
import type { Runner } from '../src/exec.js';
import { ACTOR_FLAGS_CAP, ROUTE_ARGV_CAP, ROUTE_CAP, ROUTE_DEFAULT_CAP } from '../src/ccdargv.js';
import { configDirFor } from '../src/config.js';
import { testDeps } from './helpers.js';
import { mkTmp } from './tmpHelpers.js';
import { okRun } from './coordReadHelpers.js';

const PROJECT = 'demo';
/** The coordinator: it claims the run, and (a self-claimed run) is the session the run is bound to. */
const BOSS = 'demo-boss';
const CLEAR_PANES = ['scrollback\n❯ \n', 'scrollback\n❯ /clear\n', 'scrollback\n❯ \n'];
const VERBS = ['ws-add', 'ensure', 'ws-hold', 'ws-release', 'ws-archive', ACTOR_FLAGS_CAP, ROUTE_ARGV_CAP, ROUTE_DEFAULT_CAP, ROUTE_CAP];
/** An abandon-shaped ordinary close (`state:'failed'` skips `verifyDone`, D-49): the one ordinary-path body a fixture with
 *  no git repo can drive. */
const FAILED_CLOSE = { fingerprint: { branchTip: 'x', prNumber: null, prPhase: 'open', handoffCommit: 'x' },
  final: false, state: 'failed' };

const seedRow = (home: string, id: string, over: Partial<Record<string, string>> = {}): void => {
  const reg = path.join(home, '.cc-sessions');
  mkdirSync(reg, { recursive: true });
  const fields: Record<string, string> = {
    wrapper: 'claude', project: PROJECT, workdir: `/w/${id}`, uuid: `u-${id}`, started: '1',
    workspace: id, branch: `ws/${id}`, base: 'origin/main', ...over,
  };
  for (const [k, v] of Object.entries(fields)) writeFileSync(path.join(reg, `${id}.${k}`), v);
};

function build() {
  const home = mkTmp('ccrc-dispatch-in-place-');
  mkdirSync(path.join(home, '.cc-sessions'), { recursive: true });
  const coord = new CoordStore(openCoordDb(path.join(home, '.ccrc', 'coord.db')));
  const calls: string[][] = [];
  let cap = 0;
  const run: Runner = async (_cmd, args) => {
    calls.push(args);
    const verb = args[0] ?? '';
    if (verb === 'ws-add') { seedRow(home, `${PROJECT}-fresh`); return { ran: true, code: 0, stdout: '', stderr: '' }; }
    if (verb === 'capture-pane') {
      const p = CLEAR_PANES[Math.min(cap, CLEAR_PANES.length - 1)]!;
      cap++;
      return { ran: true, code: 0, stdout: p, stderr: '' };
    }
    return { ran: true, code: 0, stdout: '', stderr: '' };
  };
  const base = testDeps(home, run);
  const fleetState = { connected: true, downSince: null, ccdVerbs: VERBS, rosterFp: null, build: null };
  const deps: DispatchRunDeps & CloseRunDeps = {
    ...base, coord, fleetState,
    configDir: (w: string) => configDirFor(base.cfg, w), turnVerdict: async () => 'idle' as const, sendClear: clearSender(base),
  };
  seedRow(home, BOSS);
  /** A run claimed by BOSS, optionally bound to `session`, at `state`. */
  const open = (over: { wave?: number; session?: string | null; state?: 'planned' | 'dispatched' } = {}): number => {
    const o = coord.openRun({ program: 'p', title: 't', project: PROJECT, wave: over.wave ?? 1, waveOf: 3, claimedBy: BOSS });
    if (!('id' in o)) throw new Error(`fixture openRun refused: ${JSON.stringify(o)}`);
    const session = over.session === undefined ? null : over.session;
    if (session !== null) {
      if (over.state === 'dispatched') {
        coord.markDispatched(o.id, session, session, `ws/${session}`, false);
        if (!coord.advance(o.id, 'dispatched', 'test').ok) throw new Error('fixture: could not dispatch');
      } else coord.setSession(o.id, session);
    }
    return o.id;
  };
  const verbs = (): string[] => calls.map((c) => c[0] ?? '');
  /** The `ws-*` fleet acts, as `[verb, session it names]`. */
  const acts = (): [string, string | undefined][] => calls
    .filter((c) => c[0] === 'ws-hold' || c[0] === 'ws-release' || c[0] === 'ws-archive')
    .map((c) => [c[0]!, c[c.indexOf('--session') + 1]]);
  return { home, coord, deps, calls, open, verbs, acts, base, fleetState };
}

describe('a self-claimed run: what the characterization pinned, and what D-6096 flips', () => {
  it('a fresh run (no session) is dispatched by minting a workspace, holding it and queueing the brief', async () => {
    const b = build();
    const id = b.open();
    const out = await dispatchRun(b.deps, id, 'go', undefined);
    expect(out).toMatchObject({ ok: true, resumed: false });
    expect(b.verbs()).toContain('ws-add');
    expect(b.verbs()).toContain('ws-hold');
    expect(b.verbs()).not.toContain('ensure');
  });

  it('a plain dispatch to the claimant is refused self-dispatch and composes nothing (flipped by D-6096; was: the resume arm ran ensure, the hold and /clear on the coordinator)', async () => {
    const b = build();
    const id = b.open({ wave: 2, session: BOSS });
    const out = await dispatchRun(b.deps, id, 'go', undefined);
    expect(out).toMatchObject({ ok: false, kind: 'refused', code: 'self-dispatch' });
    expect(b.calls, 'no ensure, no ws-hold, no route, no /clear').toEqual([]);
    expect(okRun(b.coord.run(id))).toMatchObject({ state: 'planned', sessionId: BOSS });
    expect(b.coord.runEvents(id)).toEqual([]);
  });

  it('the self-dispatch frame\'s detail names the in-place bind', async () => {
    const b = build();
    const id = b.open({ wave: 2, session: BOSS });
    const out = await dispatchRun(b.deps, id, 'go', undefined);
    expect(out).toMatchObject({ ok: false, kind: 'refused', code: 'self-dispatch', detail: expect.stringContaining('inPlace: true') });
    const detail = (out as { detail: string }).detail;
    for (const word of ['by', 'byUuid', 'branch']) expect(detail).toContain(word);
  });

  it('self-dispatch is decided before the pause listing: it reads the registry no further than the run row', async () => {
    const b = build();
    const id = b.open({ wave: 2, session: BOSS });
    writeFileSync(path.join(b.home, '.cc-sessions', COORDINATOR_PAUSE_MARKER), '');
    expect(await dispatchRun(b.deps, id, 'go', undefined)).toMatchObject({ ok: false, kind: 'refused', code: 'self-dispatch' });
  });

  it('a run bound to a different session than its claimant still resumes as before', async () => {
    const b = build();
    seedRow(b.home, 'demo-worker');
    const id = b.open({ wave: 2, session: 'demo-worker' });
    expect(await dispatchRun(b.deps, id, 'go', undefined)).toMatchObject({ ok: true, resumed: true, sessionId: 'demo-worker' });
  });

  it('today: closing a self-claimed run releases, holds or archives the COORDINATOR’s workspace', async () => {
    const final = build();
    const f = final.open({ session: BOSS, state: 'dispatched' });
    expect(await closeRun(final.deps, f, { ...FAILED_CLOSE, final: true }, 'coordinator')).toMatchObject({ ok: true, released: true });
    expect(final.acts()).toEqual([['ws-release', BOSS]]);

    const next = build();
    const n = next.open({ session: BOSS, state: 'dispatched' });
    expect(await closeRun(next.deps, n, FAILED_CLOSE, 'coordinator')).toMatchObject({ ok: true, released: false });
    expect(next.acts()).toEqual([['ws-hold', BOSS]]);

    const arch = build();
    const a = arch.open({ session: BOSS, state: 'dispatched' });
    expect(await closeRun(arch.deps, a, { ...FAILED_CLOSE, archive: true }, 'coordinator')).toMatchObject({ ok: true });
    expect(arch.acts()).toEqual([['ws-archive', BOSS]]);
  });

  it('today: abandoning a self-claimed run releases the coordinator’s workspace', async () => {
    const b = build();
    const id = b.open({ session: BOSS, state: 'dispatched' });
    expect(await closeRun(b.deps, id, { intent: 'abandon' }, 'operator')).toMatchObject({ ok: true, state: 'failed' });
    expect(b.acts()).toEqual([['ws-release', BOSS]]);
  });

  it('today: the done branch is the registry’s branch for the session, never the run row’s', async () => {
    const b = build();
    const r = await resolveDoneBranch(b.base, { sessionId: BOSS, project: PROJECT, branch: 'feat/sibling' });
    expect(r).toMatchObject({ ok: true, branch: `ws/${BOSS}`, provenance: '' });
  });
});

describe('the column and the store call (D-6096)', () => {
  it('the migration is one nullable column and nothing else', () => {
    const entry = MIGRATIONS[51]!;
    expect(entry).toMatch(/ALTER TABLE runs ADD COLUMN inPlace INTEGER;/);
    expect(entry.replace(/--.*$/gm, '').match(/ALTER TABLE|CREATE |NOT NULL|CHECK|DEFAULT/g)).toEqual(['ALTER TABLE']);
    const b = build();
    const col = (b.coord.db.prepare('PRAGMA table_info(runs)').all() as { name: string; notnull: number; type: string }[])
      .find((c) => c.name === 'inPlace');
    expect(col).toMatchObject({ type: 'INTEGER', notnull: 0 });
  });

  it('bindInPlace moves planned to working in one transaction, binds the claimant and charges no slot', () => {
    const b = build();
    const id = b.open();
    expect(b.coord.bindInPlace(id, BOSS, 'feat/sibling')).toEqual({ ok: true, from: 'dispatched', to: 'working' });
    const run = okRun(b.coord.run(id))!;
    expect(run).toMatchObject({ state: 'working', sessionId: BOSS, branch: 'feat/sibling', resumed: false, inPlace: true,
      dispatchedAt: null, workspace: null });
    expect(b.coord.runEvents(id).map((e) => [e.fromState, e.toState, e.detail])).toEqual([
      ['planned', 'dispatched', 'inPlace'], ['dispatched', 'working', 'inPlace'],
    ]);
    // an in-place run takes no concurrency slot: neither the plain count nor the stale-run predicate's list sees it
    expect(b.coord.capsUsage().running).toBe(0);
    expect(b.coord.activeRunWorkers()).toEqual([]);
  });

  it('bindInPlace clears the admission stamp the cap left on the run', () => {
    const b = build();
    const id = b.open();
    b.coord.stampAdmissionWait(id, 1000);
    expect(b.coord.admissionStampOf(id)!.since).toBe(1000);
    b.coord.bindInPlace(id, BOSS, 'feat/sibling');
    expect(b.coord.admissionStampOf(id)).toMatchObject({ since: null, lastRefusedAt: null, wokenAt: null });
  });

  it('a run that is not planned is refused bad-transition with nothing written', () => {
    const b = build();
    const id = b.open({ session: 'demo-worker', state: 'dispatched' });
    const before = JSON.stringify(okRun(b.coord.run(id)));
    expect(b.coord.bindInPlace(id, BOSS, 'feat/sibling')).toMatchObject({ ok: false, error: 'bad-transition', from: 'dispatched' });
    expect(JSON.stringify(okRun(b.coord.run(id)))).toBe(before);
    expect(b.coord.runEvents(id)).toHaveLength(1);
  });

  it('an ordinary run carries no inPlace field on the wire', () => {
    const b = build();
    const id = b.open({ session: 'demo-worker', state: 'dispatched' });
    expect(okRun(b.coord.run(id))).not.toHaveProperty('inPlace');
  });
});

describe('bindRunInPlace: the coordinator takes its own refused wave, with no fleet act (D-6096)', () => {
  const BOSS_UUID = `u-${BOSS}`;
  const inPlaceDeps = (b: ReturnType<typeof build>): InPlaceDeps => ({
    coord: b.coord, io: b.base.io, cfg: b.base.cfg,
    attribute: (who, uuid) => attributionVerdict(b.base.io, b.base.cfg, who, uuid, 'claimedByUuid'),
  });
  const bind = (b: ReturnType<typeof build>, id: number, over: { by?: string; uuid?: string; branch?: unknown } = {}) =>
    bindRunInPlace(inPlaceDeps(b), id, over.by ?? BOSS, over.uuid ?? BOSS_UUID, 'branch' in over ? over.branch : 'feat/sibling');

  it('an in-place bind moves planned to working with no fleet act', async () => {
    const b = build();
    const id = b.open();
    expect(await bind(b, id)).toEqual({ ok: true, id, sessionId: BOSS, branch: 'feat/sibling' });
    expect(b.calls, 'no ensure, no ws-hold, no route, no send-keys, no ccd call of any kind').toEqual([]);
    expect(okRun(b.coord.run(id))).toMatchObject({ state: 'working', sessionId: BOSS, branch: 'feat/sibling', inPlace: true });
    // no brief mail is queued to the coordinator about its own wave
    expect(b.coord.db.prepare('SELECT COUNT(*) AS n FROM mail_deliveries').get()).toEqual({ n: 0 });
  });

  it('an in-place run takes no concurrency slot, and a full cap does not refuse the bind', async () => {
    const b = build();
    b.coord.setCaps({ maxConcurrentWorkers: 1 });
    const holder = b.open({ session: 'demo-worker', state: 'dispatched' });
    expect(b.coord.capsUsage().running).toBe(1);
    const id = b.open({ wave: 2 });
    expect(await bind(b, id)).toMatchObject({ ok: true });
    expect(b.coord.capsUsage().running, 'the in-place run is charged to neither cap').toBe(1);
    expect(okRun(b.coord.run(holder))!.state).toBe('dispatched');
  });

  it('a non-claimant inPlace is refused', async () => {
    const b = build();
    seedRow(b.home, 'demo-other');
    const id = b.open();
    expect(await bind(b, id, { by: 'demo-other', uuid: 'u-demo-other' })).toEqual({ ok: false, kind: 'refused', code: 'claimed-by-another' });
    expect(okRun(b.coord.run(id))!.state).toBe('planned');
  });

  it('a uuid mismatch is refused', async () => {
    const b = build();
    const id = b.open();
    expect(await bind(b, id, { uuid: 'u-someone-else' })).toMatchObject({ ok: false, kind: 'attribution', error: 'stale-uuid' });
    expect(okRun(b.coord.run(id))!.state).toBe('planned');
  });

  it('a project mismatch is refused, and an unrecorded or unreadable project fails shut', async () => {
    const b = build();
    seedRow(b.home, 'demo-elsewhere', { project: 'other' });
    const o = b.coord.openRun({ program: 'q', title: 't', project: PROJECT, wave: 1, waveOf: 1, claimedBy: 'demo-elsewhere' });
    if (!('id' in o)) throw new Error('fixture');
    expect(await bind(b, o.id, { by: 'demo-elsewhere', uuid: 'u-demo-elsewhere' }))
      .toEqual({ ok: false, kind: 'refused', code: 'project-mismatch', by: 'other' });
    // a registry row with no `.project` proves nothing about the claimant
    seedRow(b.home, 'demo-noproj');
    writeFileSync(path.join(b.home, '.cc-sessions', 'demo-noproj.project'), '');
    const o2 = b.coord.openRun({ program: 'r', title: 't', project: PROJECT, wave: 1, waveOf: 1, claimedBy: 'demo-noproj' });
    if (!('id' in o2)) throw new Error('fixture');
    expect(await bind(b, o2.id, { by: 'demo-noproj', uuid: 'u-demo-noproj' })).toEqual({ ok: false, kind: 'refused', code: 'project-mismatch' });
    expect(okRun(b.coord.run(o.id))!.state).toBe('planned');
    expect(okRun(b.coord.run(o2.id))!.state).toBe('planned');
  });

  it('a run not planned is refused', async () => {
    const b = build();
    const id = b.open({ session: 'demo-worker', state: 'dispatched' });
    expect(await bind(b, id)).toMatchObject({ ok: false, kind: 'bad-transition', from: 'dispatched' });
    const working = b.open({ wave: 2 });
    expect(await bind(b, working)).toMatchObject({ ok: true });
    expect(await bind(b, working)).toMatchObject({ ok: false, kind: 'bad-transition', from: 'working' });
  });

  it('an unknown run, a review run and a run bound to another session are refused', async () => {
    const b = build();
    expect(await bind(b, 9999)).toEqual({ ok: false, kind: 'unknown-run' });
    const rv = b.coord.openRun({ program: 'p', title: 't', project: PROJECT, wave: 1, waveOf: 1, claimedBy: BOSS, kind: 'review', reviews: b.open() });
    if (!('id' in rv)) throw new Error('fixture');
    expect(await bind(b, rv.id)).toMatchObject({ ok: false, kind: 'bad-request' });
    const bound = b.open({ wave: 2, session: 'demo-worker' });
    expect(await bind(b, bound)).toMatchObject({ ok: false, kind: 'bad-request' });
    expect(okRun(b.coord.run(bound))).toMatchObject({ state: 'planned', sessionId: 'demo-worker' });
  });

  it('an in-place bind holds the landing intents it names, and refuses another programme\'s held key (D-8085, D-8086)', async () => {
    const b = build();
    const a = b.open();
    const other = b.coord.openRun({ program: 'q', title: 't', project: PROJECT, wave: 1, waveOf: 1, claimedBy: BOSS });
    if (!('id' in other)) throw new Error('fixture');
    expect(await bindRunInPlace(inPlaceDeps(b), a, BOSS, BOSS_UUID, 'feat/a', ['#900'])).toMatchObject({ ok: true });
    expect(b.coord.heldLandingIntents(PROJECT, ['#900'])).toMatchObject([{ key: '#900', runId: a, program: 'p' }]);
    // the other programme's bind is refused for the same key
    expect(await bindRunInPlace(inPlaceDeps(b), other.id, BOSS, BOSS_UUID, 'feat/b', ['#900']))
      .toEqual({ ok: false, kind: 'refused', code: 'intent-held', key: '#900', holder: { runId: a, program: 'p' } });
    expect(okRun(b.coord.run(other.id))).toMatchObject({ state: 'planned', sessionId: null });
    // a malformed list is refused before any write; an unlisted key is free
    expect(await bindRunInPlace(inPlaceDeps(b), other.id, BOSS, BOSS_UUID, 'feat/b', 'no')).toMatchObject({ ok: false, kind: 'bad-request' });
    expect(await bindRunInPlace(inPlaceDeps(b), other.id, BOSS, BOSS_UUID, 'feat/b', ['#901'])).toMatchObject({ ok: true });
  });

  it('paused refuses an in-place bind, and so does the mail kill switch, and a registry that cannot be listed', async () => {
    const b = build();
    const id = b.open();
    writeFileSync(path.join(b.home, '.cc-sessions', COORDINATOR_PAUSE_MARKER), '');
    expect(await bind(b, id)).toEqual({ ok: false, kind: 'refused', code: 'paused' });
    rmSync(path.join(b.home, '.cc-sessions', COORDINATOR_PAUSE_MARKER));
    writeFileSync(path.join(b.home, '.cc-sessions', MAIL_DISABLED_MARKER), '');
    expect(await bind(b, id)).toEqual({ ok: false, kind: 'refused', code: 'mail-disabled' });
    rmSync(path.join(b.home, '.cc-sessions', MAIL_DISABLED_MARKER));
    const unlistable = { ...inPlaceDeps(b), io: { ...b.base.io, readdir: async () => null } as typeof b.base.io };
    expect(await bindRunInPlace(unlistable, id, BOSS, BOSS_UUID, 'feat/sibling')).toEqual({ ok: false, kind: 'refused', code: 'paused' });
    expect(okRun(b.coord.run(id))!.state).toBe('planned');
    expect(b.calls).toEqual([]);
  });

  it('a missing or invalid branch is refused before any write', async () => {
    const b = build();
    const id = b.open();
    for (const branch of [undefined, '', 42, 'HEAD', 'refs/heads/x', 'a..b', 'x.lock', '-x', 'a b', 'feat/', `${'a'.repeat(201)}`]) {
      expect(await bind(b, id, { branch }), `branch ${String(branch)}`).toMatchObject({ ok: false, kind: 'bad-request' });
    }
    expect(okRun(b.coord.run(id))).toMatchObject({ state: 'planned', sessionId: null, branch: null });
    expect(b.coord.runEvents(id)).toEqual([]);
  });
});

describe('POST /api/runs/:id/dispatch with inPlace: the route (D-6096)', () => {
  const TOKEN = 'f'.repeat(64);
  const H = { 'x-ccrc-mail-token': TOKEN };
  const open = async () => {
    const b = build();
    const app = await buildServer({ ...b.base, mailToken: TOKEN, coord: b.coord, fleetState: b.fleetState });
    return { b, app };
  };
  const post = (app: FastifyInstance, id: number, payload: Record<string, unknown>) =>
    app.inject({ method: 'POST', url: `/api/runs/${id}/dispatch`, headers: H, payload });
  let app: FastifyInstance | undefined;
  afterEach(async () => { if (app) await app.close(); app = undefined; });

  it('binds the run in place: 200, working, no fleet act, no skill self-install', async () => {
    const w = await open(); app = w.app;
    const id = w.b.open();
    const res = await post(app, id, { inPlace: true, by: BOSS, byUuid: `u-${BOSS}`, branch: 'feat/sibling' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true, id, sessionId: BOSS, inPlace: true, branch: 'feat/sibling' });
    expect(okRun(w.b.coord.run(id))).toMatchObject({ state: 'working', inPlace: true });
    expect(w.b.calls, 'no ccd call at all: no ensure, hold, route, skill-ensure or send-keys').toEqual([]);
  });

  it('any inPlace value but true, and a body without by, byUuid or branch, is bad-request', async () => {
    const w = await open(); app = w.app;
    const id = w.b.open();
    for (const inPlace of [false, 'true', 1, null]) {
      const res = await post(app, id, { inPlace, by: BOSS, byUuid: `u-${BOSS}`, branch: 'feat/sibling' });
      expect(res.statusCode, `inPlace ${JSON.stringify(inPlace)}`).toBe(400);
      expect(res.json()).toMatchObject({ ok: false, error: 'bad-request' });
    }
    for (const missing of ['by', 'byUuid']) {
      const body: Record<string, unknown> = { inPlace: true, by: BOSS, byUuid: `u-${BOSS}`, branch: 'feat/sibling' };
      delete body[missing];
      expect((await post(app, id, body)).statusCode, `missing ${missing}`).toBe(400);
    }
    const noBranch = await post(app, id, { inPlace: true, by: BOSS, byUuid: `u-${BOSS}` });
    expect(noBranch.statusCode).toBe(400);
    expect(noBranch.json()).toMatchObject({ error: 'bad-request', detail: expect.stringContaining('branch') });
    expect(okRun(w.b.coord.run(id))!.state).toBe('planned');
  });

  it('answers the caller\'s attribution refusals and the dispatch union\'s through the same wire', async () => {
    const w = await open(); app = w.app;
    const id = w.b.open();
    const stale = await post(app, id, { inPlace: true, by: BOSS, byUuid: 'u-stale', branch: 'feat/sibling' });
    expect(stale.statusCode).toBe(403);
    expect(stale.json()).toMatchObject({ ok: false, error: 'stale-uuid' });
    const other = await post(app, id, { inPlace: true, by: 'demo-ghost', byUuid: 'u-ghost', branch: 'feat/sibling' });
    expect(other.json()).toMatchObject({ ok: false });
    expect(okRun(w.b.coord.run(id))!.state).toBe('planned');
    writeFileSync(path.join(w.b.home, '.cc-sessions', COORDINATOR_PAUSE_MARKER), '');
    const paused = await post(app, id, { inPlace: true, by: BOSS, byUuid: `u-${BOSS}`, branch: 'feat/sibling' });
    expect(paused.statusCode).toBe(409);
    expect(paused.json()).toEqual({ ok: false, refused: 'paused' });
  });

  it('a plain dispatch of a self-claimed run answers 409 refused self-dispatch with the detail on the wire', async () => {
    const w = await open(); app = w.app;
    const id = w.b.open({ wave: 2, session: BOSS });
    const res = await post(app, id, { brief: 'go' });
    expect(res.statusCode).toBe(409);
    expect(res.json()).toMatchObject({ ok: false, refused: 'self-dispatch', detail: expect.stringContaining('inPlace: true') });
    expect(w.b.calls).toEqual([]);
  });
});

describe('an in-place run\'s close, abandon and done-claim never touch its coordinator\'s workspace (D-6096)', () => {
  const TIP = 'a'.repeat(40);
  /** An in-place run, bound through the real store call, at `working`. */
  const inPlaceRun = (b: ReturnType<typeof build>, wave = 1, branch = 'feat/sibling'): number => {
    const id = b.open({ wave });
    if (!b.coord.bindInPlace(id, BOSS, branch).ok) throw new Error('fixture: bind refused');
    return id;
  };

  it('closing an in-place run composes no ws-* verb on the claimant (final, and non-final)', async () => {
    for (const final of [true, false]) {
      const b = build();
      const id = inPlaceRun(b);
      const out = await closeRun(b.deps, id, { ...FAILED_CLOSE, final }, 'coordinator');
      expect(out, `final ${final}`).toMatchObject({ ok: true, state: 'failed', released: false, childReclaim: 'not-queued', childReclaimWhy: 'not-a-child' });
      expect(b.acts(), `final ${final}: no release, no hold`).toEqual([]);
      expect(b.calls.filter((c) => ['ws-release', 'ws-hold', 'ws-archive', 'ws-reclaim'].includes(c[0] ?? ''))).toEqual([]);
      expect(okRun(b.coord.run(id))!.state).toBe('failed');
    }
  });

  it('a non-final in-place close leaves no programme hold on the coordinator and hands the next wave no session', async () => {
    const b = build();
    const id = inPlaceRun(b);
    expect(await closeRun(b.deps, id, FAILED_CLOSE, 'coordinator')).toMatchObject({ ok: true });
    expect(b.calls.some((c) => c[0] === 'ws-hold')).toBe(false);
    const next = b.coord.openRun({ program: 'p', title: 't', project: PROJECT, wave: 2, waveOf: 3, claimedBy: BOSS });
    if (!('id' in next)) throw new Error('fixture: the next wave was refused');
    expect(okRun(b.coord.run(next.id))!.sessionId, 'the next wave names no session, never the claimant').toBeNull();
  });

  it('a failed close with archive never archives the claimant', async () => {
    const b = build();
    const id = inPlaceRun(b);
    const out = await closeRun(b.deps, id, { ...FAILED_CLOSE, archive: true }, 'coordinator');
    expect(out).toMatchObject({ ok: false, kind: 'hold-invalid', detail: expect.stringContaining('archive') });
    expect(b.acts()).toEqual([]);
    expect(okRun(b.coord.run(id))!.state, 'the refusal leaves the run where it was').toBe('working');
  });

  it('abandoning an in-place run composes no ws-* verb, and still moves the run to failed', async () => {
    const b = build();
    const id = inPlaceRun(b);
    expect(await closeRun(b.deps, id, { intent: 'abandon' }, 'operator')).toMatchObject({ ok: true, state: 'failed', released: false });
    expect(b.acts()).toEqual([]);
    expect(b.calls).toEqual([]);
    expect(okRun(b.coord.run(id))).toMatchObject({ state: 'failed', closedBy: 'operator' });
  });

  it('the dead-coordinator sweep\'s guard still binds the in-place abandon path, with no fleet act', async () => {
    const b = build();
    const id = inPlaceRun(b);
    const stop = { kind: 'revived' } as never;
    const out = await closeRun(b.deps, id, { intent: 'abandon' }, 'sweep', { claimedBy: BOSS, stillCrashed: async () => stop });
    expect(out).toMatchObject({ ok: false, kind: 'sweep-stopped', fleetAct: null });
    expect(okRun(b.coord.run(id))!.state).toBe('working');
    expect(b.calls).toEqual([]);
  });

  it('every other run\'s close and abandon are unchanged (the characterization rows above stay green)', async () => {
    const b = build();
    const id = b.open({ session: 'demo-worker', state: 'dispatched' });
    seedRow(b.home, 'demo-worker');
    expect(await closeRun(b.deps, id, { intent: 'abandon' }, 'operator')).toMatchObject({ ok: true, released: true });
    expect(b.acts()).toEqual([['ws-release', 'demo-worker']]);
  });

  it('an in-place done-claim is measured on the sibling branch, not the registry\'s branch for the claimant', async () => {
    const b = build();
    const id = inPlaceRun(b);
    const gitHeads = path.join(b.base.cfg.projectsRoot, PROJECT, '.git', 'refs', 'heads', 'feat');
    mkdirSync(gitHeads, { recursive: true });
    writeFileSync(path.join(gitHeads, 'sibling'), `${TIP}\n`);
    const run = okRun(b.coord.run(id))!;
    // the coordinator's own workspace has a PR (#7) and the sibling branch has another (#42): the claim is about #42
    const row = (number: number, head: string, over: Record<string, unknown> = {}) =>
      ({ number, state: 'OPEN', headRefName: head, baseRefName: 'main', isCrossRepository: false, ours: true, isDraft: false, ...over });
    const seen: string[][] = [];
    const prRun: Runner = async (_cmd, args) => {
      seen.push(args);
      const rows = [row(7, `ws/${BOSS}`), row(42, 'feat/sibling')];
      return { ran: true, code: 0, stdout: `${JSON.stringify({ id: BOSS, rows, baseShort: 'main', branch: `ws/${BOSS}`, ahead: 1, checkedAt: Date.now() })}\n`, stderr: '' };
    };
    const deps = testDeps(b.home, prRun);
    const claim = { branchTip: TIP, prNumber: 42, prPhase: 'open' as const, handoffCommit: TIP };
    const inPlace = doneRunOf({ ...run, sessionId: BOSS });
    expect(await verifyDone(deps, inPlace, claim)).toMatchObject({ ok: true, measured: { branchTip: TIP, prNumber: 42, prPhase: 'open' } });
    // the PR is read by project, never by the claimant's session
    expect(seen.every((a) => a.includes('--project') && !a.includes('--session'))).toBe(true);
    // a claim with no PR number is measured on the sibling's PR, not the coordinator's #7
    expect(await verifyDone(deps, inPlace, { ...claim, prNumber: null })).toMatchObject({ ok: true, measured: { prNumber: 42 } });
    // a claim naming the coordinator's own PR is refused
    expect(await verifyDone(deps, inPlace, { ...claim, prNumber: 7 })).toMatchObject({ ok: false, code: 'pr-regressed' });
    // the sibling has no PR of its own: an open claim is refused although the coordinator's workspace has one
    const noPr: Runner = async () => ({ ran: true, code: 0, stdout: `${JSON.stringify({ id: BOSS, rows: [row(7, `ws/${BOSS}`)], baseShort: 'main', branch: `ws/${BOSS}`, ahead: 1, checkedAt: Date.now() })}\n`, stderr: '' });
    expect(await verifyDone(testDeps(b.home, noPr), inPlace, claim)).toMatchObject({ ok: false, code: 'pr-regressed' });
    // the same claim for a run NOT taken in place reads the registry's `ws/<id>` branch, where there is no ref
    expect(await verifyDone(deps, { sessionId: BOSS, project: PROJECT, branch: 'feat/sibling' }, claim))
      .toMatchObject({ ok: false, code: 'tip-unmeasurable' });
  });

  it('resolveDoneBranch answers the recorded branch with its own provenance for an in-place run, and still refuses a bad session id', async () => {
    const b = build();
    expect(await resolveDoneBranch(b.base, { sessionId: BOSS, project: PROJECT, branch: 'feat/sibling', inPlace: true }))
      .toEqual({ ok: true, branch: 'feat/sibling', provenance: expect.stringContaining('in-place'), project: PROJECT });
    expect(await resolveDoneBranch(b.base, { sessionId: BOSS, project: PROJECT, branch: '', inPlace: true }))
      .toMatchObject({ ok: false, code: 'branch-unmeasurable' });
    expect(await resolveDoneBranch(b.base, { sessionId: '../x', project: PROJECT, branch: 'feat/sibling', inPlace: true }))
      .toMatchObject({ ok: false, code: 'tip-unmeasurable' });
    // the registry is not read for an in-place run at all: an unlistable registry does not change the answer
    const dark = { ...b.base, io: { ...b.base.io, readdir: async () => null } as typeof b.base.io };
    expect(await resolveDoneBranch(dark, { sessionId: BOSS, project: PROJECT, branch: 'feat/sibling', inPlace: true })).toMatchObject({ ok: true });
  });

  it('an in-place run reaches awaiting-review and opens a review run', () => {
    const b = build();
    const id = inPlaceRun(b);
    expect(b.coord.advance(id, 'awaiting-review', 'coordinator')).toMatchObject({ ok: true, to: 'awaiting-review' });
    const rv = b.coord.openRun({ program: 'p', title: 't', project: PROJECT, wave: 1, waveOf: 3, claimedBy: BOSS, kind: 'review', reviews: id });
    expect('id' in rv).toBe(true);
  });
});

describe('the operator\'s pause does not refuse non-dispatch acts (D-8126 answer 2, D-6096)', () => {
  const TOKEN = 'f'.repeat(64);
  const H = { 'x-ccrc-mail-token': TOKEN };
  let app: FastifyInstance | undefined;
  afterEach(async () => { if (app) await app.close(); app = undefined; });
  const paused = async () => {
    const b = build();
    app = await buildServer({ ...b.base, mailToken: TOKEN, coord: b.coord, fleetState: b.fleetState });
    writeFileSync(path.join(b.home, '.cc-sessions', COORDINATOR_PAUSE_MARKER), '');
    return b;
  };

  it('dispatch and the in-place bind are refused paused', async () => {
    const b = await paused();
    const id = b.open();
    const bind = await app!.inject({ method: 'POST', url: `/api/runs/${id}/dispatch`, headers: H,
      payload: { inPlace: true, by: BOSS, byUuid: `u-${BOSS}`, branch: 'feat/sibling' } });
    expect(bind.json()).toEqual({ ok: false, refused: 'paused' });
    const plain = await app!.inject({ method: 'POST', url: `/api/runs/${id}/dispatch`, headers: H, payload: { brief: 'go' } });
    expect(plain.json()).toEqual({ ok: false, refused: 'paused' });
    expect(okRun(b.coord.run(id))!.state).toBe('planned');
  });

  it('a close, an abandon and an advance of an in-place run are not refused by the pause', async () => {
    const b = await paused();
    // abandon
    const a = b.open();
    b.coord.bindInPlace(a, BOSS, 'feat/a');
    const ab = await app!.inject({ method: 'POST', url: `/api/runs/${a}/abandon` });
    expect(ab.statusCode).toBe(200);
    expect(ab.json()).toMatchObject({ ok: true, state: 'failed' });
    // close (the abandon-shaped ordinary close, which needs no git fixture)
    const c = b.open({ wave: 2 });
    b.coord.bindInPlace(c, BOSS, 'feat/c');
    const cl = await app!.inject({ method: 'POST', url: `/api/runs/${c}/close`, headers: H, payload: { ...FAILED_CLOSE, final: true } });
    expect(cl.statusCode).toBe(200);
    expect(cl.json()).toMatchObject({ ok: true, state: 'failed' });
    // advance: a send-back from awaiting-review to working retreats and re-measures nothing
    const d = b.open({ wave: 3 });
    b.coord.bindInPlace(d, BOSS, 'feat/d');
    expect(b.coord.advance(d, 'awaiting-review', 'coordinator').ok).toBe(true);
    const adv = await app!.inject({ method: 'POST', url: `/api/runs/${d}/advance`, headers: H,
      payload: { to: 'working', fingerprint: { branchTip: TIP_FOR_ADVANCE, prNumber: null, prPhase: 'none', handoffCommit: TIP_FOR_ADVANCE } } });
    expect(adv.statusCode, adv.body).toBe(200);
    expect(okRun(b.coord.run(d))!.state).toBe('working');
    expect(b.acts(), 'none of the three composed a ws-* verb on the claimant').toEqual([]);
  });
});
const TIP_FOR_ADVANCE = 'a'.repeat(40);

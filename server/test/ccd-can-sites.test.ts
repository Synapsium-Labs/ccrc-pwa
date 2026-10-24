// D-5866 (plan docs/superpowers/plans/2026-10-20-consolidation-w1b-schedule-listing-redactor.md, Task C1k, Step 1;
// ARCH-71 (#806)). THE CHARACTERIZATION PIN for `ccdCan(state, row)`: every verb question a call site asks today,
// answered through that site's own seam (`inject` for a route, the executor's rig for a lane) over the four states a
// box's `ccd caps` list can be in: no list (`null`, no evidence), an empty list, the list WITH the row's token and the
// list WITHOUT it. Written green on main, BEFORE any site moves, so a move that changes one answer reds here.
//
// What each row pins is the no-evidence polarity it has today: a `verbSupported` site PERMITS on no list, a
// `capSupported` site REFUSES. A row's token is what decides a measured list: `route apply` needs `route-apply-v1`,
// not the `route` verb name. The `stop` verb is ungated by decision: it is sent over every state, and only the FLAG
// `stop-surface` decides `--surface pwa`.
//
// The two-call sites (the expiry, reclaim and collect audits) ask a mode token AND the `ws-audit` verb, each with its
// own failure arm: a box with the token and without `ws-audit` answers the verb arm ("cannot answer ws-audit"), and a
// box with `ws-audit` and without the token answers the capability arm.
//
// FIXTURE HOMES ONLY: every case runs under `mkTmp` with a scripted runner. Nothing reaches a box.
import { describe, it, expect } from 'vitest';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { buildServer } from '../src/server.js';
import type { Deps } from '../src/server.js';
import { openCoordDb } from '../src/coord/db.js';
import { CoordStore } from '../src/coord/store.js';
import type { Runner } from '../src/exec.js';
import type { FleetState } from '../src/fleetstate.js';
import {
  COLLECT_CAP, DOCS_CAP, EXPIRE_CAP, RECLAIM_CAP, RECLAIM_PAUSE_CAP, ROUTE_APPLY_CAP,
} from '../src/ccdargv.js';
import { expireArchived, learnExpiry } from '../src/coord/expireArchived.js';
import {
  CHILD_RECLAIM_FEED_QUIET_NONE, reclaimChild, type ChildReclaimDeps, type ChildReclaimOutcome,
} from '../src/coord/childReclaim.js';
import { collectLaneCaps, collectTempRoot, learnCollect } from '../src/coord/collectTempRoot.js';
import { ccdDocsFetcher, ccdDocsReader } from '../src/docs/ccdsource.js';
import { NotifyLog } from '../src/notifylog.js';
import { testDeps } from './helpers.js';
import { mkTmp } from './tmpHelpers.js';
import { FULL_CAPS, ID as TMP_ID, rig as collectRig } from './collectTempRootFixture.js';
import { G1, modelCcd } from './childReclaimGenerationFixture.js';

const ID = 'demo-quiet-basin';
type Verbs = readonly string[] | null;
const stateOf = (v: Verbs): FleetState => ({ connected: true, downSince: null, ccdVerbs: v === null ? null : [...v], rosterFp: null, build: null });

/** The four states for a row whose token is `tok`: no list, an empty list, the list with it, the list without it. */
const FOUR = (tok: string): readonly (readonly [string, Verbs])[] => [
  ['no list', null], ['an empty list', []], [`a list with ${tok}`, [tok, 'caps']], [`a list without ${tok}`, ['caps']],
];

function seedWorkspace(): string {
  const home = mkTmp('ccrc-ccd-can-');
  const reg = path.join(home, '.cc-sessions');
  mkdirSync(reg, { recursive: true });
  const worktree = path.join(home, 'w');
  mkdirSync(worktree);
  for (const [f, v] of [['uuid', 'u'], ['wrapper', 'claude'], ['workdir', worktree],
    ['project', 'demo'], ['workspace', 'quiet-basin'], ['branch', 'ws/quiet-basin'], ['base', 'origin/main']]) {
    writeFileSync(path.join(reg, `${ID}.${f}`), v!);
  }
  return home;
}

/** One request through the real server, over `v`; the ccd verbs it sent (tmux reads dropped) and its status. */
async function hit(v: Verbs, method: 'GET' | 'POST', url: string, payload?: unknown): Promise<{ code: number; sent: string[] }> {
  const calls: string[][] = [];
  const run: Runner = async (_c, args) => {
    calls.push(args);
    if (args[0] === 'list-panes') return { ran: true, code: 0, stdout: '4242\n', stderr: '' };
    return { ran: true, code: 0, stdout: '', stderr: '' };
  };
  const home = seedWorkspace();
  const coord = new CoordStore(openCoordDb(path.join(home, '.ccrc', 'coord.db')));
  const app = await buildServer({ ...testDeps(home, run), coord, fleetState: stateOf(v) } satisfies Deps);
  try {
    const res = await app.inject({ method, url, payload: payload as never });
    return { code: res.statusCode, sent: calls.map((c) => c.join(' ')).filter((c) => !/^(?:list-|has-session|display|show)/.test(c)) };
  } finally {
    await app.close();
  }
}

// [row, method, url, body, the token that decides a measured list, the verb the call sends, the no-evidence polarity]
type RouteRow = readonly [string, 'GET' | 'POST', string, unknown, string, string, 'permit' | 'refuse'];
const ROUTES: readonly RouteRow[] = [
  ['prStateSession', 'GET', `/api/sessions/${ID}/pr`, undefined, 'pr-state', 'pr-state', 'permit'],
  ['prOpen', 'POST', `/api/sessions/${ID}/pr`, { title: 't', body: 'b' }, 'pr-open', 'pr-open', 'permit'],
  ['wsArchive', 'POST', `/api/sessions/${ID}/archive`, {}, 'ws-archive', 'ws-archive', 'permit'],
  ['wsRestore', 'POST', `/api/sessions/${ID}/restore`, {}, 'ws-restore', 'ws-restore', 'permit'],
  ['forget', 'POST', `/api/sessions/${ID}/forget`, {}, 'forget', 'forget', 'permit'],
  ['wsHold', 'POST', `/api/sessions/${ID}/hold`, { reason: 'r' }, 'ws-hold', 'ws-hold', 'permit'],
  ['wsRelease', 'POST', `/api/sessions/${ID}/release`, {}, 'ws-release', 'ws-release', 'permit'],
  ['wsAudit', 'GET', `/api/sessions/${ID}/workspace/audit`, undefined, 'ws-audit', 'ws-audit', 'permit'],
  ['wsReap', 'POST', `/api/sessions/${ID}/workspace/reap`, { expect: 'a'.repeat(64) }, 'ws-reap', 'ws-reap', 'permit'],
  ['projectPoolClear', 'POST', '/api/projects/demo/pool', { pool: null }, 'project-pool', 'project-pool', 'permit'],
  ['coordPause', 'POST', '/api/coord/pause', { paused: true }, 'coord-pause', 'coord-pause', 'permit'],
  ['reclaimPause', 'POST', '/api/coord/reclaim-pause', { state: 'on' }, RECLAIM_PAUSE_CAP, 'reclaim-pause', 'refuse'],
  ['routeApply', 'POST', `/api/sessions/${ID}/route`, { field: 'effort', value: 'high' }, ROUTE_APPLY_CAP, 'route', 'refuse'],
];

describe('every route-borne verb question answers as today over the four states (D-5866, Step 1)', () => {
  for (const [row, method, url, body, tok, verb, polarity] of ROUTES) {
    it.each(FOUR(tok))(`${row}: %s`, async (what, v) => {
      const r = await hit(v, method, url, body);
      const allowed = v === null ? polarity === 'permit' : v.includes(tok);
      if (allowed) {
        expect(r.sent.some((c) => c.startsWith(`${verb} `)), `${row} over ${what} sends ${verb}`).toBe(true);
        expect(r.code, `${row} over ${what}`).not.toBe(501);
      } else {
        expect(r.sent.filter((c) => c.startsWith(`${verb} `)), `${row} over ${what} sends nothing`).toEqual([]);
        // A refusing read route answers its 'unsupported' view with 200; every write answers 501.
        expect(r.code, `${row} over ${what}`).toBe(row === 'prStateSession' ? 200 : 501);
      }
    });
  }

  it('a box with no caps list never applies a route: route apply needs the route-apply token', async () => {
    expect((await hit(null, 'POST', `/api/sessions/${ID}/route`, { field: 'effort', value: 'high' })).code).toBe(501);
  });

  it('route apply needs the route-apply token: the bare `route` verb on the list is not it', async () => {
    const r = await hit(['route', 'caps'], 'POST', `/api/sessions/${ID}/route`, { field: 'effort', value: 'high' });
    expect(r.code).toBe(501);
    expect(r.sent).toEqual([]);
  });

  it('the reclaim-pause route needs its token: the bare verb on the list is not it', async () => {
    const r = await hit(['reclaim-pause', 'caps'], 'POST', '/api/coord/reclaim-pause', { state: 'on' });
    expect(r.code).toBe(501);
    expect(r.sent).toEqual([]);
  });
});

describe('the stop verb is ungated by decision; only the stop-surface FLAG is asked (D-5866, Step 1)', () => {
  it.each(FOUR('stop-surface'))('the operator\'s stop is sent on a box with %s', async (_what, v) => {
    const r = await hit(v, 'POST', `/api/sessions/${ID}/stop`, {});
    expect(r.code).toBe(200);
    const stops = r.sent.filter((c) => c.startsWith('stop '));
    expect(stops).toHaveLength(1);
    expect(stops[0]!.includes('--surface pwa'), '--surface pwa only when stop-surface is listed')
      .toBe(v !== null && v.includes('stop-surface'));
  });

  it('the operator\'s stop is sent on a box with no caps list', async () => {
    const r = await hit(null, 'POST', `/api/sessions/${ID}/stop`, {});
    expect(r.sent).toEqual([`stop ${ID}`]);
  });
});

// ── the expiry executor: a mode token (`expire-v1`, refuses on no evidence) and the `ws-audit` verb ─────────────────
describe('ws-expire and its audit (D-5866, Step 1)', () => {
  const runner = () => {
    const calls: string[][] = [];
    return { calls, runCcd: async (argv: readonly string[]) => { calls.push([...argv]); return { ran: true, ok: false, stdout: '', stderr: 'x' }; } };
  };

  it.each(FOUR(EXPIRE_CAP))('the learning audit over %s', async (_what, v) => {
    const r = runner();
    // The audit is the second question: the "with" list carries `ws-audit` too, so only the token decides here.
    const caps = v !== null && v.includes(EXPIRE_CAP) ? [...v, 'ws-audit'] : v;
    const read = await learnExpiry({ runCcd: r.runCcd as never, fleetState: stateOf(caps) }, ID);
    if (v !== null && v.includes(EXPIRE_CAP)) {
      expect(r.calls.map((c) => c[0])).toEqual(['ws-audit']);
    } else {
      expect(read).toEqual({ kind: 'unreadable', detail: `the fleet host does not advertise ${EXPIRE_CAP}` });
      expect(r.calls).toEqual([]);
    }
  });

  it('a box with expire-v1 and without ws-audit answers the verb arm: the fleet host cannot answer ws-audit', async () => {
    const r = runner();
    expect(await learnExpiry({ runCcd: r.runCcd as never, fleetState: stateOf([EXPIRE_CAP, 'caps']) }, ID))
      .toEqual({ kind: 'unreadable', detail: 'the fleet host cannot answer ws-audit' });
    expect(r.calls).toEqual([]);
  });

  it('a box with ws-audit and without expire-v1 answers the capability arm', async () => {
    const r = runner();
    expect(await learnExpiry({ runCcd: r.runCcd as never, fleetState: stateOf(['ws-audit', 'caps']) }, ID))
      .toEqual({ kind: 'unreadable', detail: `the fleet host does not advertise ${EXPIRE_CAP}` });
    expect(r.calls).toEqual([]);
  });

  it('a box with no caps list never expires: deferred unsupported, nothing composed', async () => {
    const r = runner();
    const home = mkTmp('ccrc-ccd-can-expire-');
    const coord = new CoordStore(openCoordDb(path.join(home, '.ccrc', 'coord.db')));
    const base = testDeps(home, async () => ({ ran: true, code: 1, stdout: '', stderr: '' }));
    const o = await expireArchived({ ...base, coord, runCcd: r.runCcd as never, fleetState: stateOf(null) } as never,
      { sessionId: ID, archivedAt: 1, expiresAt: 2 } as never);
    expect(o).toMatchObject({ kind: 'deferred', why: 'unsupported' });
    expect(r.calls).toEqual([]);
  });
});

// ── the reclaim executor: `reclaim-v1` (refuses on no evidence) and the `ws-audit` verb ─────────────────────────────
describe('ws-reclaim and its audit (D-5866, Step 1)', () => {
  const reclaim = async (v: Verbs): Promise<{ o: ChildReclaimOutcome; sent: string[] }> => {
    const home = mkTmp('ccrc-ccd-can-reclaim-');
    const reg = path.join(home, '.cc-sessions');
    mkdirSync(reg, { recursive: true });
    const coord = new CoordStore(openCoordDb(path.join(home, '.ccrc', 'coord.db')));
    const opened = coord.openRun({ program: 'p', title: 't', project: 'demo', wave: 1, waveOf: 2, claimedBy: 'demo-coordinator' });
    if (!('id' in opened)) throw new Error('openRun refused');
    const runId = opened.id;
    coord.markDispatched(runId, ID, ID, 'ws/quiet-basin', false);
    expect(coord.closeRun({ runId, finalState: 'failed', causedBy: 'test', handoffCommit: null, program: 'p',
      viaClosing: false }).ok).toBe(true);
    const fields: Record<string, string> = { wrapper: 'claude', project: 'demo', workdir: `/w/${ID}`, uuid: `u-${ID}`,
      started: '1', workspace: ID, branch: 'ws/quiet-basin', base: 'origin/main', child: String(runId), generation: G1 };
    for (const [k, val] of Object.entries(fields)) writeFileSync(path.join(reg, `${ID}.${k}`), val);
    const model = modelCcd({ reg, id: ID, wave7: true, hooks: {} });
    const sent: string[] = [];
    const run: Runner = async (_cmd, args) => {
      sent.push(args[0]!);
      const a = model(args);
      return a === undefined ? { ran: true, code: 1, stdout: '', stderr: `unscripted ${args[0]}` } : { ran: true, code: a.code, stdout: a.stdout, stderr: a.stderr ?? '' };
    };
    const base = testDeps(home, run);
    const notifyLog = new NotifyLog(path.join(home, '.ccrc', 'notify.json'));
    await notifyLog.load();
    const deps: ChildReclaimDeps = { coord, io: base.io, cfg: base.cfg, runCcd: base.runCcd, fleetState: stateOf(v),
      presence: { isVisible: () => false }, notifyLog };
    const o = await reclaimChild(deps, { sessionId: ID, runId, trigger: 'close', deferExpired: false, deferredSinceMs: null,
      feedQuiet: CHILD_RECLAIM_FEED_QUIET_NONE, licenceGeneration: { kind: 'none' } });
    return { o, sent };
  };
  const detail = (o: ChildReclaimOutcome): string => ('detail' in o ? String(o.detail) : '');

  it.each([['no list', null], ['an empty list', []], ['a list without reclaim-v1', ['ws-audit', 'ws-reclaim', 'caps']]] as const)(
    'a box with %s never reclaims: deferred unsupported, nothing sent', async (_what, v) => {
      const { o, sent } = await reclaim(v);
      expect(o).toMatchObject({ kind: 'deferred', why: 'unsupported' });
      expect(detail(o)).toContain(`does not advertise ${RECLAIM_CAP}`);
      expect(sent.filter((s) => s.startsWith('ws-'))).toEqual([]);
    });

  it('a box with reclaim-v1 and without ws-audit answers the verb arm: the fleet host cannot answer ws-audit', async () => {
    const { o, sent } = await reclaim([RECLAIM_CAP, 'ws-reclaim', 'caps']);
    expect(detail(o)).toContain('the fleet host cannot answer ws-audit');
    expect(sent.filter((s) => s.startsWith('ws-'))).toEqual([]);
  });

  it('a box with reclaim-v1 and ws-audit asks the audit', async () => {
    const { sent } = await reclaim([RECLAIM_CAP, 'ws-audit', 'ws-reclaim', 'actor-flags-v1', 'caps']);
    expect(sent).toContain('ws-audit');
  });
});

// ── the collector: `collect-v1` (refuses on no evidence), the `ws-audit` verb, and the reclaim-pause precondition ───
describe('ws-collect, its audit and its pause precondition (D-5866, Step 1)', () => {
  const without = (...drop: string[]): string[] => FULL_CAPS.filter((c) => !drop.includes(c));

  it.each([['no list', null], ['an empty list', []], ['a list without collect-v1', without(COLLECT_CAP)]] as const)(
    'a box with %s never collects: step 1, nothing composed', async (_what, v) => {
      const r = collectRig({ caps: v });
      expect(await collectTempRoot(r.deps, r.job(TMP_ID))).toMatchObject({ kind: 'not-asked', step: 1, why: 'caps' });
      expect(r.attempts).toEqual([]);
    });

  it('collect needs both tokens: a box without reclaim-pause-v1 never collects', async () => {
    const r = collectRig({ caps: without(RECLAIM_PAUSE_CAP) });
    expect(await collectTempRoot(r.deps, r.job(TMP_ID))).toMatchObject({ kind: 'not-asked', step: 1, why: 'caps' });
    expect(r.attempts).toEqual([]);
  });

  it('a box with the token and without ws-audit answers notAsked: verb (the fleet host cannot answer ws-audit)', async () => {
    const r = collectRig({ caps: without('ws-audit') });
    const o = await collectTempRoot(r.deps, r.job(TMP_ID));
    expect(o).toMatchObject({ kind: 'not-asked', step: 4, why: 'caps' });
    expect('detail' in o ? o.detail : '').toContain('the fleet host cannot answer ws-audit');
    expect(r.attempts).toEqual([]);
  });

  it.each(FOUR(COLLECT_CAP))('the learning audit over %s', async (_what, v) => {
    const caps = v === null ? null : v.includes(COLLECT_CAP) ? [...v, 'ws-audit'] : v;
    const r = collectRig({ caps });
    const a = await learnCollect(r.deps, TMP_ID);
    expect(a.kind, 'asked only with the token').toBe(v !== null && v.includes(COLLECT_CAP) ? 'answered' : 'not-asked');
  });

  it('the learning audit with collect-v1 and without ws-audit asks nothing', async () => {
    const r = collectRig({ caps: [COLLECT_CAP, 'caps'] });
    expect(await learnCollect(r.deps, TMP_ID)).toEqual({ kind: 'not-asked', why: 'caps' });
    expect(r.attempts).toEqual([]);
  });

  it.each([
    ['no list', null, { collect: false, reclaimPause: false }],
    ['an empty list', [], { collect: false, reclaimPause: false }],
    ['both tokens', [COLLECT_CAP, RECLAIM_PAUSE_CAP], { collect: true, reclaimPause: true }],
    ['collect-v1 alone', [COLLECT_CAP], { collect: true, reclaimPause: false }],
    ['the bare verbs', ['ws-collect', 'reclaim-pause'], { collect: false, reclaimPause: false }],
  ] as const)('the Settings view reads both capabilities: %s', (_what, v, want) => {
    expect(collectLaneCaps(stateOf(v))).toEqual(want);
  });
});

// ── the docs adapter: `docs-v1` (refuses on no evidence) gates all four docs verbs ─────────────────────────────────
describe('the docs verbs (D-5866, Step 1)', () => {
  const docs = (v: Verbs) => {
    const sent: string[] = [];
    const deps = { fleetState: stateOf(v), runCcd: async (argv: readonly string[]) => { sent.push(argv[0]!); return { ran: true, ok: false, stdout: '', stderr: '' }; } };
    return { sent, reader: ccdDocsReader(deps as never), fetcher: ccdDocsFetcher(deps as never) };
  };
  it.each(FOUR(DOCS_CAP))('docs-index and docs-fetch over %s', async (_what, v) => {
    const d = docs(v);
    await d.reader.index('n' as never);
    await d.fetcher.fetch({ project: 'demo' } as never, null);
    expect(d.sent).toEqual(v !== null && v.includes(DOCS_CAP) ? ['docs-index', 'docs-fetch'] : []);
  });
  it('the four docs verb names without docs-v1 are not the token', async () => {
    const d = docs(['caps', 'docs-index', 'docs-tree', 'docs-show', 'docs-fetch']);
    await d.reader.index('n' as never);
    await d.reader.tree({ project: 'demo' } as never, null);
    await d.fetcher.fetch({ project: 'demo' } as never, null);
    expect(d.sent).toEqual([]);
  });
});

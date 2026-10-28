// D-7165 (ARCH-44, GitHub #779; plan 2026-10-27-consolidation-arch44-retire.md, Task C4h; spec 2026-10-19 K1, §5.1
// rule 1). THE RETIRE EXECUTORS' CHARACTERIZATION PIN: the three server-side automatic retire executors that exist
// today (child-spent `reclaimChild`, archive-expired `expireArchived`, temp-orphan `collectTempRoot`), driven over one
// step matrix through fake ports, green on the old code, so the later tasks (`decideRetire`, `retireAct`, the three
// reason moves, `retireExecutor`) change only this file's imports.
//
// It imports today's PUBLIC faces only. Every fake is built here from those faces and from the fixture modules' public
// rigs (`collectTempRootFixture.ts`, `collectLaneFixture.ts`): no helper is moved out of, or copied from, a suite an open
// PR holds (plan §Gates, rule 6). The three spies below wrap the REAL functions (`vi.mock` with `importOriginal`), so the
// executors run unchanged and only their calls are recorded, in one order log.
//
// What it holds, each a named `it`:
//   (a) the step matrix, per reason: each step's deferral alone (word, detail byte for byte, argv recorder) and each
//       adjacent pair answering the earlier, with each reason's pause sentences (D-7224);
//   (b) the difference table (plan item 2, item 16): listing mode, unlistable and rejecting answers, the pause
//       precondition, the stale arm's capability, the shadow arms, the after-act hook, each reader's rejection mode;
//   (c) the rejection rows (D-7226): `propagate` readers reject the executor (no notice, no effect) and land in the
//       caller's own sentence; `judged` readers answer their step's sentence;
//   (d) child-spent's three `gone` sources (D-7230);
//   (e) the held-at-the-act rows, and today's gap (child-spent's `reclaim-paused` read once, at 2b);
//   (f) temp-orphan's synchronous tail (two probes);
//   (g) the collector's call order;
//   (h) the side-effect rows (D-7199);
//   (i) the argv rows;
//   (j) the notice rows;
//   (k) the close route (D-7228).
// FIXTURE HOMES ONLY: every path derives from `mkTmp`; ccd is a scripted runner behind the agent's real whitelist.
import { describe, it, expect, expectTypeOf, vi, afterEach } from 'vitest';
import { mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { openCoordDb } from '../src/coord/db.js';
import { CoordStore } from '../src/coord/store.js';
import { NotifyLog } from '../src/notifylog.js';
import { KeyedQueue } from '../src/inject/queue.js';
import { Bus } from '../src/bus.js';
import { FleetWatcher, CHILD_RECLAIM_SWEEP_MS } from '../src/watch.js';
import { readRegistry } from '../src/registry.js';
import { loadConfig } from '../src/config.js';
import { buildServer } from '../src/server.js';
import { notify } from '../src/notice.js';
import { recordNestedRescueShadow } from '../src/coord/nestedRescueShadow.js';
import { childReclaimStaleTold } from '../src/coord/childReclaimStale.js';
import {
  CHILD_RECLAIM_DEFER_WHYS, childReclaimPauseRead, reclaimChild, type ChildReclaimDeps, type ChildReclaimOutcome,
  type ChildReclaimRequest,
} from '../src/coord/childReclaim.js';
import { childReclaimDisabledRead, childReclaimUnlessDisabled } from '../src/coord/childReclaimDisabled.js';
import { expireArchived, expireLaneLive, type ExpireArchivedDeps } from '../src/coord/expireArchived.js';
import {
  collectSwitches, collectTempRoot, learnCollect, type CollectLanePort, type CollectTempRootDeps,
} from '../src/coord/collectTempRoot.js';
import { RECLAIM_PAUSE_MARKER } from '../src/coord/rundefs.js';
import { EXPIRE_CHILD_LIVE_MARKER, EXPIRE_LANE_LIVE_MARKER } from '../src/archivedExpiry.js';
import { COLLECT_LANE_LIVE_MARKER } from '../src/collectLane.js';
import {
  ACTOR_FLAGS_CAP, COLLECT_CAP, COLLECT_LOOSE_CAP, EXPIRE_CAP, EXPIRE_CHILD_CAP, RECLAIM_CAP, RECLAIM_PAUSE_CAP,
  RECLAIM_STALE_CAP,
} from '../src/ccdargv.js';
import type { FleetState } from '../src/fleetstate.js';
import type { ExecResult, Runner } from '../src/exec.js';
import type { FleetIO, ReadFailure } from '../src/io.js';
import { CHILD_RECLAIM_DISABLED_MARKER, COLLECT_LOOSE_LIVE_MARKER } from '../../shared/switches.js';
import { NESTED_RESCUE_SHADOW_TITLE } from '../../shared/nestedRescue.js';
import { TMPROOT_ID_MAX_CHARS } from '../../shared/api.js';
import { seedRoster, testDeps } from './helpers.js';
import { mkTmp } from './tmpHelpers.js';
import { FULL_CAPS, ID as CID, TOK as CTOK, WALL0, rig as collectRigOf, type Rig as CollectRig } from './collectTempRootFixture.js';
import { collectRig as collectLaneRig } from './collectLaneFixture.js';

// ── the spies: the real functions, wrapped, each call written to one order log ─────────────────────────────────────
const spy = vi.hoisted(() => ({ log: [] as string[] }));
vi.mock('../src/notice.js', async (importOriginal) => {
  const m = await importOriginal<typeof import('../src/notice.js')>();
  return { ...m, notify: vi.fn((...a: Parameters<typeof m.notify>) => { spy.log.push(`notify:${a[1].title}`); return m.notify(...a); }) };
});
vi.mock('../src/coord/nestedRescueShadow.js', async (importOriginal) => {
  const m = await importOriginal<typeof import('../src/coord/nestedRescueShadow.js')>();
  return { ...m, recordNestedRescueShadow: vi.fn((...a: Parameters<typeof m.recordNestedRescueShadow>) => {
    spy.log.push('shadow'); return m.recordNestedRescueShadow(...a);
  }) };
});
vi.mock('../src/coord/childReclaimStale.js', async (importOriginal) => {
  const m = await importOriginal<typeof import('../src/coord/childReclaimStale.js')>();
  return { ...m, childReclaimStaleTold: vi.fn(async (...a: Parameters<typeof m.childReclaimStaleTold>) => {
    spy.log.push('staleTold'); return m.childReclaimStaleTold(...a);
  }) };
});
const notifySpy = vi.mocked(notify);
const shadowSpy = vi.mocked(recordNestedRescueShadow);
const staleToldSpy = vi.mocked(childReclaimStaleTold);

afterEach(() => {
  spy.log.length = 0;
  notifySpy.mockClear(); shadowSpy.mockClear(); staleToldSpy.mockClear();
  vi.restoreAllMocks();
});

const ok = (stdout: string): ExecResult => ({ ran: true, code: 0, stdout, stderr: '' });
const caps = (verbs: readonly string[] | null): FleetState =>
  ({ connected: true, downSince: null, rosterFp: null, build: null, ccdVerbs: verbs === null ? null : [...verbs] });
/** What the scripted runner answers: an exec result, or a rejection of the call itself (a port that lost the link). */
type Scripted = ExecResult | 'reject';

// ══ child-spent: `reclaimChild` ══════════════════════════════════════════════════════════════════════════════════════

const KID = 'demo-a';
const KTOK = 'a'.repeat(64);
const G1 = '11111111-1111-4111-8111-111111111111';
const G2 = '22222222-2222-4222-8222-222222222222';
const CHILD_CAPS: readonly string[] = ['ws-audit', 'ws-reclaim', RECLAIM_CAP, RECLAIM_STALE_CAP, ACTOR_FLAGS_CAP];

interface ChildOpts {
  readonly caps?: readonly string[] | null;
  /** The sweep's licence generation: `G1` judged, or close's `none`. Default `none`. */
  readonly licence?: 'none' | 'g1';
  readonly deferExpired?: boolean;
  readonly trigger?: 'close' | 'sweep';
  readonly stale?: boolean;
  /** The `.generation` file's bytes; null writes none. Default G1. */
  readonly generation?: string | null;
  readonly feedQuiet?: ChildReclaimRequest['feedQuiet'];
}

/** A marked child of a FINISHED run under a fixture HOME, a scripted ccd, the registry listings scripted per call, a
 *  fake presence port, and the store's mail cancel recorded. Every port call is written to `spy.log`. */
const childRig = async (o: ChildOpts = {}) => {
  const home = mkTmp('ccrc-retire-pin-child-');
  const argvs: string[][] = [];
  const hooks: {
    audit?: () => void; act?: () => void;
    /** The Nth registry `readdir` (1-based), before it is taken: `reject` rejects it, `null` answers an unlistable one. */
    listing?: (n: number) => 'reject' | 'null' | void;
    generation?: () => 'reject' | void;
  } = {};
  const answers: { audit: () => Scripted; act: () => Scripted } = {
    audit: () => ok(JSON.stringify({ id: KID, mode: 'reclaim', childOf: runId, verdict: 'reclaimable', token: KTOK,
      ...(o.licence === 'g1' ? { generation: G1 } : {}) })),
    act: () => ok(JSON.stringify({ reclaimed: KID, childOf: runId, wip: null, attic: 2, residueBytes: null, secretsDropped: 0 })),
  };
  const run: Runner = async (_cmd, args) => {
    const a = args[0] === 'ws-audit' ? answers.audit() : args[0] === 'ws-reclaim' ? answers.act() : ok('');
    return a === 'reject' ? ok('') : a;
  };
  const base = testDeps(home, run);
  const reg = base.cfg.registryDir;
  mkdirSync(reg, { recursive: true });
  const coord = new CoordStore(openCoordDb(path.join(home, '.ccrc', 'coord.db')));
  const opened = coord.openRun({ program: 'w-pin', title: 'w-pin', project: 'demo', wave: 1, waveOf: null, claimedBy: 'demo-coord' });
  if (!('id' in opened)) throw new Error(`openRun refused: ${JSON.stringify(opened)}`);
  const runId = opened.id;
  const closed = coord.closeRun({ runId, finalState: 'failed', causedBy: 'operator', handoffCommit: null, program: 'w-pin', viaClosing: false });
  if (!closed.ok) throw new Error(`closeRun refused: ${JSON.stringify(closed)}`);
  const fields: Record<string, string> = {
    uuid: 'u-demo-a', wrapper: 'claude', project: 'demo', workdir: '/w/demo-a', workspace: 'a',
    branch: 'ws/demo-a', base: 'origin/main', started: '1', child: String(runId),
  };
  for (const [f, v] of Object.entries(fields)) writeFileSync(path.join(reg, `${KID}.${f}`), v);
  const generation = o.generation === undefined ? G1 : o.generation;
  if (generation !== null) writeFileSync(path.join(reg, `${KID}.generation`), generation);
  // The store's mail cancel, recorded (the executor's one mail effect).
  const cancelOf = coord.cancelDeliveriesTo.bind(coord);
  coord.cancelDeliveriesTo = ((id: string) => { spy.log.push(`cancel:${id}`); return cancelOf(id); }) as typeof coord.cancelDeliveriesTo;
  let listings = 0;
  const io: FleetIO = {
    ...base.io,
    async readdir(p: string, timeoutMs?: number, signal?: AbortSignal) {
      if (p !== reg) return base.io.readdir(p, timeoutMs, signal);
      listings += 1;
      spy.log.push('readdir');
      const what = hooks.listing?.(listings);
      if (what === 'reject') throw new Error('EIO: the registry listing failed');
      if (what === 'null') return null;
      return base.io.readdir(p, timeoutMs, signal);
    },
    async readFileMeasured(p: string, timeoutMs?: number, signal?: AbortSignal) {
      if (p === path.join(reg, `${KID}.generation`)) {
        spy.log.push('generation');
        if (hooks.generation?.() === 'reject') throw new Error('EIO: the generation read failed');
      }
      return base.io.readFileMeasured(p, timeoutMs, signal);
    },
  };
  let visible = false;
  let presenceThrows = false;
  const fleetState = caps(o.caps === undefined ? CHILD_CAPS : o.caps);
  const deps: ChildReclaimDeps = {
    coord, io, cfg: base.cfg, fleetState,
    runCcd: async (argv) => {
      argvs.push([...argv]);
      spy.log.push(`argv:${argv[0] ?? ''}`);
      if (argv[0] === 'ws-audit') hooks.audit?.(); else if (argv[0] === 'ws-reclaim') hooks.act?.();
      const a = argv[0] === 'ws-audit' ? answers.audit() : argv[0] === 'ws-reclaim' ? answers.act() : ok('');
      if (a === 'reject') throw new Error(`EIO: ${argv[0] ?? ''} lost its link`);
      return base.runCcd(argv);
    },
    viewers: { isVisible: (id: string) => {
      spy.log.push('presence');
      if (presenceThrows) throw new Error('presence gone');
      return visible && id === KID;
    } },
    notifyLog: new NotifyLog(path.join(home, '.ccrc', 'notify.json')),
  };
  await deps.notifyLog!.load();
  const req: ChildReclaimRequest = {
    sessionId: KID, runId, trigger: o.trigger ?? 'sweep', deferExpired: o.deferExpired ?? false, deferredSinceMs: null,
    feedQuiet: o.feedQuiet ?? { deferWhy: null, failureToken: null },
    licenceGeneration: o.licence === 'g1' ? { kind: 'value', v: G1 } : { kind: 'none' },
    ...(o.stale === true ? { stale: { word: 'held' as const, holdDigest: null, holdText: null } } : {}),
  };
  return {
    home, reg, coord, deps, req, runId, argvs, hooks, answers, fleetState,
    raise: (name: string): void => { writeFileSync(path.join(reg, name), ''); },
    see: (v: boolean): void => { visible = v; },
    presenceThrows: (): void => { presenceThrows = true; },
    /** A second run naming the child as its worker: an open sibling. */
    openSibling: (): number => {
      writeFileSync(path.join(reg, 'demo-coord.uuid'), 'u-demo-coord');
      for (const [f, v] of Object.entries({ wrapper: 'claude', project: 'demo', workdir: '/w/demo-coord', workspace: 'coord',
        branch: 'ws/demo-coord', base: 'origin/main', started: '1' })) writeFileSync(path.join(reg, `demo-coord.${f}`), v);
      const r = coord.openRun({ program: 'w-sib', title: 'w-sib', project: 'demo', wave: 1, waveOf: null, claimedBy: 'demo-coord' });
      if (!('id' in r)) throw new Error(`openRun refused: ${JSON.stringify(r)}`);
      coord.bindSession(r.id, KID);
      return r.id;
    },
    /** A finished run the child itself coordinated. */
    coordinated: (): void => {
      const r = coord.openRun({ program: 'w-own', title: 'w-own', project: 'demo', wave: 1, waveOf: null, claimedBy: KID });
      if (!('id' in r)) throw new Error(`openRun refused: ${JSON.stringify(r)}`);
      coord.closeRun({ runId: r.id, finalState: 'failed', causedBy: 'operator', handoffCommit: null, program: 'w-own', viaClosing: false });
    },
    drop: (field: string): void => { rmSync(path.join(reg, `${KID}.${field}`), { force: true }); },
    auditDoc: (over: Record<string, unknown>): Scripted => ok(JSON.stringify({ id: KID, mode: 'reclaim', ...over })),
    actDoc: (over: Record<string, unknown>): Scripted => ok(JSON.stringify(over)),
  };
};
type ChildRig = Awaited<ReturnType<typeof childRig>>;

const KAUDIT = ['ws-audit', '--session', KID, '--reclaim'];
const kAct = (runId: number, trigger: 'close' | 'sweep' = 'sweep'): string[] =>
  ['ws-reclaim', '--expect', KTOK, '--child-of', String(runId), '--session', KID, '--surface', 'agent', '--actor', `run:${runId} reclaim ${trigger}`];
const deferredC = (k: ChildRig, why: string, detail: string): ChildReclaimOutcome =>
  ({ kind: 'deferred', sessionId: KID, runId: k.runId, why, detail } as ChildReclaimOutcome);
const GEN_SENTENCE = 'The workspace under this name no longer carries the generation the sweep judged it under, so this request '
  + 'is not used, and the sweep judges the workspace afresh.';

/** Each step of child-spent's ladder with ITS deferral alone standing (plan item 2, the right-hand column): the
 *  outcome byte for byte, and the argv recorder empty or holding exactly the audit. */
const CHILD_STEPS: ReadonlyArray<{ readonly step: string; readonly opts?: ChildOpts; readonly set: (k: ChildRig) => void;
  readonly want: (k: ChildRig) => ChildReclaimOutcome; readonly argv: (k: ChildRig) => string[][] }> = [
  { step: '1 record: no marker', set: (k) => { k.drop('child'); },
    want: (k) => deferredC(k, 'marker-mismatch', 'the workspace carries no child marker'), argv: () => [] },
  { step: '1 record: another run', set: (k) => { writeFileSync(path.join(k.reg, `${KID}.child`), String(k.runId + 40)); },
    want: (k) => deferredC(k, 'marker-mismatch', `the child marker names run ${k.runId + 40}, not run ${k.runId}`), argv: () => [] },
  { step: '1 record: unlistable', set: (k) => { k.hooks.listing = (n) => (n === 1 ? 'null' : undefined); },
    want: (k) => deferredC(k, 'marker-unreadable', 'the registry could not be listed'), argv: () => [] },
  { step: '2 siblings', set: (k) => { const s = k.openSibling(); (k as { sib?: number }).sib = s; },
    want: (k) => deferredC(k, 'siblings-open', `open run(s) #${(k as { sib?: number }).sib} still name this workspace`), argv: () => [] },
  { step: '2a coordinated', set: (k) => { k.coordinated(); },
    want: (k) => deferredC(k, 'siblings-open', `${KID} has coordinated run(s)`), argv: () => [] },
  { step: '2b paused', set: (k) => { k.raise(RECLAIM_PAUSE_MARKER); },
    want: (k) => deferredC(k, 'paused-at-server', 'reclaim-paused is raised: automatic reclamation is paused fleet-wide'), argv: () => [] },
  { step: "2b' disabled", set: (k) => { k.raise(CHILD_RECLAIM_DISABLED_MARKER); },
    want: (k) => deferredC(k, 'paused-at-server', 'child-reclaim-disabled is set: child reclaim is switched off'), argv: () => [] },
  { step: '2c generation', opts: { licence: 'g1', generation: G2 }, set: () => {},
    want: (k) => deferredC(k, 'generation-changed', `the workspace now carries generation ${G2}, and this request was judged under generation ${G1}. ${GEN_SENTENCE}`),
    argv: () => [] },
  { step: '3 presence', set: (k) => { k.see(true); },
    want: (k) => deferredC(k, 'presence', 'someone is viewing this session'), argv: () => [] },
  { step: '4 capability', opts: { caps: ['ws-audit', 'ws-reclaim', ACTOR_FLAGS_CAP] }, set: () => {},
    want: (k) => deferredC(k, 'unsupported', 'the fleet host does not advertise reclaim-v1'), argv: () => [] },
  { step: '4a stale capability', opts: { stale: true, caps: ['ws-audit', 'ws-reclaim', RECLAIM_CAP, ACTOR_FLAGS_CAP] }, set: () => {},
    want: (k) => deferredC(k, 'unsupported', 'the fleet host does not advertise reclaim-stale-v1'), argv: () => [] },
  { step: '5 audit refusal (retry)', set: (k) => { k.answers.audit = () => k.auditDoc({ verdict: 'held', detail: 'a hold stands' }); },
    want: (k) => deferredC(k, 'held', 'a hold stands'), argv: () => [KAUDIT] },
  { step: '5 audit unreadable', set: (k) => { k.answers.audit = () => ok('not json'); },
    want: (k) => ({ kind: 'failed', sessionId: KID, runId: k.runId, resume: 'not-resumable', detail: 'ws-audit --reclaim printed no JSON document', token: null }),
    argv: () => [KAUDIT] },
  { step: '5 audit names another run', set: (k) => { k.answers.audit = () => k.auditDoc({ childOf: k.runId + 7, verdict: 'reclaimable', token: KTOK }); },
    want: (k) => deferredC(k, 'marker-mismatch', `ws-audit read the child marker as run ${k.runId + 7}, not run ${k.runId}`), argv: () => [KAUDIT] },
  { step: '5a audit generation', opts: { licence: 'g1' },
    set: (k) => { k.answers.audit = () => k.auditDoc({ childOf: k.runId, verdict: 'reclaimable', token: KTOK, generation: G2 }); },
    want: (k) => deferredC(k, 'generation-changed', `ws-audit minted its token over generation ${G2}, and this request was judged under generation ${G1}. ${GEN_SENTENCE}`),
    argv: () => [KAUDIT] },
  { step: '6 disabled at the act', set: (k) => { k.hooks.audit = () => { k.raise(CHILD_RECLAIM_DISABLED_MARKER); }; },
    want: (k) => deferredC(k, 'paused-at-server', 'child-reclaim-disabled is set at the act: child reclaim is switched off'), argv: () => [KAUDIT] },
];

describe('child-spent (reclaimChild): the step matrix (C4h a)', () => {
  it.each(CHILD_STEPS.map((s) => [s.step, s] as const))('child-spent: the deferral at step %s alone answers its own word and detail', async (_n, s) => {
    const k = await childRig(s.opts);
    s.set(k);
    expect(await reclaimChild(k.deps, k.req)).toEqual(s.want(k));
    expect(k.argvs).toEqual(s.argv(k));
  });

  it('child-spent: every pair standing together answers the earlier step', async () => {
    // Adjacent steps, in the ladder's order; each pair is set together, and the earlier one's word answers.
    const pairs: ReadonlyArray<readonly [number, number]> = [[1, 3], [3, 4], [4, 5], [5, 6], [6, 7], [7, 8], [8, 9], [9, 10], [10, 11], [14, 15]];
    for (const [a, b] of pairs) {
      const first = CHILD_STEPS[a]!; const second = CHILD_STEPS[b]!;
      const k = await childRig({ ...second.opts, ...first.opts });
      second.set(k); first.set(k);
      expect(await reclaimChild(k.deps, k.req), `${first.step} beside ${second.step}`).toEqual(first.want(k));
    }
  });

  it('child-spent: presence defers only until its ceiling (deferExpired skips it, and rides both argvs)', async () => {
    const k = await childRig({ deferExpired: true });
    k.see(true);
    expect(await reclaimChild(k.deps, k.req)).toMatchObject({ kind: 'reclaimed' });
    expect(k.argvs).toEqual([[...KAUDIT, '--defer-expired'],
      ['ws-reclaim', '--expect', KTOK, '--child-of', String(k.runId), '--session', KID, '--defer-expired', '--surface', 'agent', '--actor', `run:${k.runId} reclaim sweep`]]);
    expect(spy.log.filter((l) => l === 'presence'), 'presence is not even asked past the ceiling').toEqual([]);
  });

  it('child-spent: the pause sentences, per reading (a raised pause; an unlistable registry; a rejecting readdir keeps its own sentence)', async () => {
    const raised = await childRig();
    raised.raise(RECLAIM_PAUSE_MARKER);
    expect(await reclaimChild(raised.deps, raised.req)).toMatchObject({ why: 'paused-at-server',
      detail: 'reclaim-paused is raised: automatic reclamation is paused fleet-wide' });
    const unlistable = await childRig();
    unlistable.hooks.listing = (n) => (n === 2 ? 'null' : undefined);
    expect(await reclaimChild(unlistable.deps, unlistable.req)).toMatchObject({ why: 'paused-at-server',
      detail: 'the registry did not list, so a raised reclaim-paused cannot be ruled out' });
  });

  it('child-spent: a rejecting readdir keeps its own sentence (two plain listings, one per marker)', async () => {
    const k = await childRig();
    k.hooks.listing = (n) => (n === 2 ? 'reject' : undefined);
    expect(await reclaimChild(k.deps, k.req)).toEqual(deferredC(k, 'paused-at-server',
      'whether reclaim-paused is raised could not be read (EIO: the registry listing failed)'));
    // The wrappers themselves: `readdir` (never `readdirMeasured`), the rejection propagating out of each.
    const io = { readdir: async () => { throw new Error('EIO'); } };
    await expect(childReclaimPauseRead(io, '/fixture/reg')).rejects.toThrow('EIO');
    await expect(childReclaimDisabledRead(io, '/fixture/reg')).rejects.toThrow('EIO');
    expect(await childReclaimPauseRead({ readdir: async () => null }, '/fixture/reg')).toBe('unmeasurable');
    expect(await childReclaimPauseRead({ readdir: async () => [RECLAIM_PAUSE_MARKER] }, '/fixture/reg')).toBe('set');
  });

  it('child-spent: the listing count of a clean pass is four plain readdirs (record, pause, disabled, disabled at the act)', async () => {
    const k = await childRig();
    expect(await reclaimChild(k.deps, k.req)).toMatchObject({ kind: 'reclaimed' });
    expect(spy.log.filter((l) => l === 'readdir')).toHaveLength(4);
  });

  it('child-spent: the defer words are the ladder\'s own vocabulary', () => {
    expect([...CHILD_RECLAIM_DEFER_WHYS].sort()).toEqual(['attached', 'generation-changed', 'held', 'in-progress', 'marker-mismatch',
      'marker-unreadable', 'nested-rescue-failed', 'not-idle', 'paused', 'paused-at-server', 'presence', 'reap-in-progress',
      'siblings-open', 'siblings-unreadable', 'state-changed', 'tree-busy', 'unsupported']);
  });
});

describe('child-spent (reclaimChild): rejections, gone, the act, effects, argv and notices (C4h b-e, h-j)', () => {
  /** No answered-class effect ran: no mail cancel, no shadow, no stale told, no notice. */
  const noEffect = (): void => {
    expect(spy.log.filter((l) => l.startsWith('cancel:') || l === 'shadow' || l === 'staleTold' || l.startsWith('notify:'))).toEqual([]);
    expect(notifySpy).toHaveBeenCalledTimes(0);
  };

  // D-7226, item 16: the reads with NO try. Each rejects the executor; no outcome, no notice, no effect.
  const PROPAGATE: ReadonlyArray<readonly [string, (k: ChildRig) => void, string]> = [
    ['record re-read (readSessionRecord)', (k) => { k.hooks.listing = (n) => (n === 1 ? 'reject' : undefined); }, 'EIO: the registry listing failed'],
    ['row re-listing (childReclaimRowListing)', (k) => { k.drop('uuid'); k.hooks.listing = (n) => (n === 2 ? 'reject' : undefined); },
      'EIO: the registry listing failed'],
    ['sibling read (readChildSiblings)', (k) => { k.coord.bindingsOf = () => { throw new Error('the store is locked'); }; }, 'the store is locked'],
    ['presence (viewers.isVisible)', (k) => { k.presenceThrows(); }, 'presence gone'],
    ['audit (childReclaimAudit)', (k) => { k.answers.audit = () => 'reject'; }, 'EIO: ws-audit lost its link'],
    ['act (childReclaimAct)', (k) => { k.answers.act = () => 'reject'; }, 'EIO: ws-reclaim lost its link'],
  ];
  it.each(PROPAGATE)('child-spent: a rejecting %s rejects the executor, and no notice is written', async (_n, set, msg) => {
    const k = await childRig();
    set(k);
    await expect(reclaimChild(k.deps, k.req)).rejects.toThrow(msg);
    noEffect();
  });

  // The reads WITH a try: each answers its step's own sentence, and the notice is written as for any deferral.
  const JUDGED: ReadonlyArray<readonly [string, ChildOpts, (k: ChildRig) => void, (k: ChildRig) => ChildReclaimOutcome]> = [
    ['2a the coordination fence', {}, (k) => { k.coord.childReclaimCoordinatorClaims = () => { throw new Error('history unreadable'); }; },
      (k) => deferredC(k, 'siblings-unreadable', `whether ${KID} has coordinated a run could not be read (history unreadable)`)],
    ['2b the pause read', {}, (k) => { k.hooks.listing = (n) => (n === 2 ? 'reject' : undefined); },
      (k) => deferredC(k, 'paused-at-server', 'whether reclaim-paused is raised could not be read (EIO: the registry listing failed)')],
    ["2b' the disabled read", {}, (k) => { k.hooks.listing = (n) => (n === 3 ? 'reject' : undefined); },
      (k) => deferredC(k, 'paused-at-server', 'the registry did not list, so a set child-reclaim-disabled cannot be ruled out (EIO: the registry listing failed)')],
    ['2c the generation read', { licence: 'g1' }, (k) => { k.hooks.generation = () => 'reject'; },
      (k) => deferredC(k, 'marker-unreadable', `${KID}.generation could not be read (EIO: the generation read failed), so which workspace stands under this name cannot be said`)],
    ['6 the disabled read at the act', {}, (k) => { k.hooks.listing = (n) => (n === 4 ? 'reject' : undefined); },
      (k) => deferredC(k, 'paused-at-server', 'the registry did not list, so a set child-reclaim-disabled cannot be ruled out at the act (EIO: the registry listing failed)')],
  ];
  it.each(JUDGED)('child-spent: a rejecting pause read answers its own sentence — %s', async (_n, opts, set, want) => {
    const k = await childRig(opts);
    set(k);
    expect(await reclaimChild(k.deps, k.req)).toEqual(want(k));
    expect(notifySpy).toHaveBeenCalledTimes(1);
    expect(notifySpy.mock.calls[0]![1]).toMatchObject({ title: 'child reclaim deferred' });
  });

  it('child-spent: gone cancels the mail (the record step only), and writes no notice', async () => {
    const k = await childRig();
    k.drop('uuid'); k.drop('child');
    expect(await reclaimChild(k.deps, k.req)).toEqual({ kind: 'gone', sessionId: KID });
    expect(spy.log.filter((l) => l.startsWith('cancel:'))).toEqual([`cancel:${KID}`]);
    expect(k.argvs).toEqual([]);
    expect(notifySpy).toHaveBeenCalledTimes(0);
  });

  it('child-spent: a refusal answering gone cancels no mail (audit and act), the audit one still records the shadow; no notice', async () => {
    const audit = await childRig();
    audit.answers.audit = () => audit.auditDoc({ verdict: 'no-such-session', detail: '', nestedRescue: { wouldRescue: ['nested/a'] } });
    expect(await reclaimChild(audit.deps, audit.req)).toEqual({ kind: 'gone', sessionId: KID });
    expect(spy.log.filter((l) => l.startsWith('cancel:'))).toEqual([]);
    expect(shadowSpy).toHaveBeenCalledTimes(1);
    expect(notifySpy.mock.calls.map((c) => c[1].title)).toEqual([NESTED_RESCUE_SHADOW_TITLE]);
    spy.log.length = 0; notifySpy.mockClear(); shadowSpy.mockClear();
    const act = await childRig();
    act.answers.act = () => act.actDoc({ refused: 'no-such-session', detail: '' });
    expect(await reclaimChild(act.deps, act.req)).toEqual({ kind: 'gone', sessionId: KID });
    expect(spy.log.filter((l) => l.startsWith('cancel:'))).toEqual([]);
    expect(shadowSpy).toHaveBeenCalledTimes(0);
    expect(notifySpy).toHaveBeenCalledTimes(0);
  });

  it('child-spent: the mail is cancelled before the stale told, once, after a reclaimed act and never otherwise', async () => {
    const k = await childRig({ stale: true });
    expect(await reclaimChild(k.deps, k.req)).toMatchObject({ kind: 'reclaimed' });
    const tail = spy.log.filter((l) => l.startsWith('cancel:') || l === 'staleTold' || l.startsWith('notify:') || l.startsWith('argv:'));
    expect(tail).toEqual(['argv:ws-audit', 'argv:ws-reclaim', `cancel:${KID}`, 'staleTold', 'notify:child reclaimed']);
    for (const set of [
      (r: ChildRig) => { r.answers.act = () => r.actDoc({ failed: 'tree-busy', detail: 'x', crumb: true }); },
      (r: ChildRig) => { r.answers.act = () => r.actDoc({ refused: 'not-a-child', detail: 'x' }); },
      (r: ChildRig) => { r.see(true); },
    ]) {
      spy.log.length = 0;
      const r = await childRig({ stale: true });
      set(r);
      await reclaimChild(r.deps, r.req);
      expect(spy.log.filter((l) => l.startsWith('cancel:') || l === 'staleTold')).toEqual([]);
    }
  });

  // "On no other outcome" (plan C4h, the side-effect rows): the mail is cancelled on the record step's `gone` arm and
  // after a `reclaimed` act, and on nothing else. Every step row, every judged read and every refusal is driven here.
  it('child-spent: the mail is cancelled on no other outcome (every step row, every judged read, every refusal and failure)', async () => {
    const cancels = (): string[] => spy.log.filter((l) => l.startsWith('cancel:'));
    for (const s of CHILD_STEPS) {
      spy.log.length = 0;
      const k = await childRig(s.opts);
      s.set(k);
      expect(await reclaimChild(k.deps, k.req), s.step).toEqual(s.want(k));
      expect(cancels(), s.step).toEqual([]);
    }
    for (const [name, opts, set, want] of JUDGED) {
      spy.log.length = 0;
      const k = await childRig(opts);
      set(k);
      expect(await reclaimChild(k.deps, k.req), name).toEqual(want(k));
      expect(cancels(), name).toEqual([]);
    }
    const others: ReadonlyArray<readonly [string, (k: ChildRig) => void, string]> = [
      ['an audit refusal', (k) => { k.answers.audit = () => k.auditDoc({ verdict: 'not-a-child', detail: 'x' }); }, 'refused'],
      ['an audit refusal answering gone', (k) => { k.answers.audit = () => k.auditDoc({ verdict: 'no-such-session', detail: '' }); }, 'gone'],
      ['an act refusal', (k) => { k.answers.act = () => k.actDoc({ refused: 'not-a-child', detail: 'x' }); }, 'refused'],
      ['an act refusal answering gone', (k) => { k.answers.act = () => k.actDoc({ refused: 'no-such-session', detail: '' }); }, 'gone'],
      ['an act refusal answering a retry', (k) => { k.answers.act = () => k.actDoc({ refused: 'paused', detail: 'x' }); }, 'deferred'],
      ['a failed act', (k) => { k.answers.act = () => k.actDoc({ failed: 'tree-busy', detail: 'x', crumb: true }); }, 'failed'],
      ['an act that printed no document', (k) => { k.answers.act = () => ok('not json'); }, 'failed'],
    ];
    for (const [name, set, kind] of others) {
      spy.log.length = 0;
      const k = await childRig();
      set(k);
      expect((await reclaimChild(k.deps, k.req)).kind, name).toBe(kind);
      expect(cancels(), name).toEqual([]);
    }
  });

  it('child-spent: no mail is cancelled on a marker-unreadable re-listing (unlistable, or a row that lists and cannot be built)', async () => {
    const unlistable = await childRig();
    unlistable.drop('uuid');
    unlistable.hooks.listing = (n) => (n === 2 ? 'null' : undefined);
    expect(await reclaimChild(unlistable.deps, unlistable.req)).toEqual(deferredC(unlistable, 'marker-unreadable', 'the registry could not be listed'));
    expect(spy.log.filter((l) => l === 'readdir'), 'the record read, then its one re-listing').toHaveLength(2);
    expect(spy.log.filter((l) => l.startsWith('cancel:'))).toEqual([]);
    expect(unlistable.argvs).toEqual([]);
    spy.log.length = 0;
    const unbuilt = await childRig();
    unbuilt.drop('uuid');
    expect(await reclaimChild(unbuilt.deps, unbuilt.req)).toEqual(deferredC(unbuilt, 'marker-unreadable',
      'the registry lists this workspace but its row could not be built'));
    expect(spy.log.filter((l) => l.startsWith('cancel:'))).toEqual([]);
    expect(unbuilt.argvs).toEqual([]);
  });

  it('child-spent: an audit refusal records the nested-rescue shadow, before the refusal is classified; an act refusal never does', async () => {
    const k = await childRig();
    k.answers.audit = () => k.auditDoc({ verdict: 'not-a-child', detail: 'x', nestedRescue: { wouldRescue: ['nested/a', 'nested/b'] } });
    expect(await reclaimChild(k.deps, k.req)).toMatchObject({ kind: 'refused', token: 'not-a-child' });
    expect(shadowSpy).toHaveBeenCalledTimes(1);
    expect(shadowSpy.mock.calls[0]![1]).toEqual({ sessionId: KID, runId: k.runId, key: String(k.runId),
      who: `${KID}, child of run #${k.runId}`, count: 2, paths: ['nested/a', 'nested/b'], rung: 'reclaim:rescue' });
    expect(spy.log.filter((l) => l === 'shadow' || l.startsWith('notify:'))).toEqual(['shadow', `notify:${NESTED_RESCUE_SHADOW_TITLE}`, 'notify:child reclaim refused']);
    shadowSpy.mockClear();
    const act = await childRig();
    act.answers.act = () => act.actDoc({ refused: 'not-a-child', detail: 'x', nestedRescue: { wouldRescue: ['nested/a'] } });
    expect(await reclaimChild(act.deps, act.req)).toMatchObject({ kind: 'refused' });
    expect(shadowSpy).toHaveBeenCalledTimes(0);
  });

  it('child-spent: held at the act — child-reclaim-disabled raised during the audit, and the generation changed between 2c and 5a', async () => {
    const off = await childRig();
    off.hooks.audit = () => { off.raise(CHILD_RECLAIM_DISABLED_MARKER); };
    expect(await reclaimChild(off.deps, off.req)).toEqual(deferredC(off, 'paused-at-server',
      'child-reclaim-disabled is set at the act: child reclaim is switched off'));
    expect(off.argvs).toEqual([KAUDIT]);
    const gen = await childRig({ licence: 'g1' });
    gen.hooks.audit = () => { writeFileSync(path.join(gen.reg, `${KID}.generation`), G2); };
    gen.answers.audit = () => gen.auditDoc({ childOf: gen.runId, verdict: 'reclaimable', token: KTOK, generation: G2 });
    expect(await reclaimChild(gen.deps, gen.req)).toMatchObject({ kind: 'deferred', why: 'generation-changed' });
    expect(gen.argvs).toEqual([KAUDIT]);
  });

  it('child-spent: held at the act — reclaim-v1 withdrawn during the audit answers unsupported, and ws-reclaim is never composed', async () => {
    // The capability asked again in the act's own scope (`childReclaimAct`, plan item 2 "capability again"): the audit's
    // fake replaces the advertised verbs with a set that no longer carries reclaim-v1 as it answers.
    const k = await childRig();
    k.hooks.audit = () => { (k.fleetState as { ccdVerbs: string[] | null }).ccdVerbs = CHILD_CAPS.filter((c) => c !== RECLAIM_CAP); };
    expect(await reclaimChild(k.deps, k.req)).toEqual(deferredC(k, 'unsupported', 'the fleet host does not advertise reclaim-v1'));
    expect(k.argvs).toEqual([KAUDIT]);
    expect(spy.log.filter((l) => l.startsWith('cancel:') || l === 'staleTold')).toEqual([]);
    expect(notifySpy.mock.calls.map((c) => c[1].title)).toEqual(['child reclaim deferred']);
  });

  it("child-spent: TODAY'S GAP — reclaim-paused clean at 2b and raised from the next listing on still reaches the ws-reclaim argv (C4o flips this row)", async () => {
    const k = await childRig();
    k.hooks.audit = () => { k.raise(RECLAIM_PAUSE_MARKER); };
    k.answers.act = () => k.actDoc({ refused: 'paused', detail: 'reclaim-paused is raised' });
    expect(await reclaimChild(k.deps, k.req)).toEqual(deferredC(k, 'paused', 'reclaim-paused is raised'));
    expect(k.argvs).toEqual([KAUDIT, kAct(k.runId)]);
  });

  it('child-spent: the stale arm needs its own capability, and its flags ride both argvs', async () => {
    const k = await childRig({ stale: true });
    expect(await reclaimChild(k.deps, k.req)).toMatchObject({ kind: 'reclaimed' });
    expect(k.argvs).toEqual([[...KAUDIT, '--stale', 'held'],
      ['ws-reclaim', '--expect', KTOK, '--child-of', String(k.runId), '--session', KID, '--stale', 'held', '--surface', 'agent', '--actor', `run:${k.runId} reclaim sweep`]]);
  });

  it('child-spent argv: a plain row, the close trigger, and no actor flags on a box without actor-flags-v1', async () => {
    const plain = await childRig();
    await reclaimChild(plain.deps, plain.req);
    expect(plain.argvs).toEqual([KAUDIT, kAct(plain.runId)]);
    const close = await childRig({ trigger: 'close' });
    await reclaimChild(close.deps, close.req);
    expect(close.argvs).toEqual([KAUDIT, kAct(close.runId, 'close')]);
    const bare = await childRig({ caps: ['ws-audit', 'ws-reclaim', RECLAIM_CAP] });
    await reclaimChild(bare.deps, bare.req);
    expect(bare.argvs).toEqual([KAUDIT, ['ws-reclaim', '--expect', KTOK, '--child-of', String(bare.runId), '--session', KID]]);
  });

  it('child-spent: one notice per outcome, except gone and a repeat the feed already says (childReclaimFeedSkips)', async () => {
    const cases: ReadonlyArray<readonly [string, ChildOpts, (k: ChildRig) => void, string | null]> = [
      ['reclaimed', {}, () => {}, 'child reclaimed'],
      ['deferred', {}, (k) => { k.see(true); }, 'child reclaim deferred'],
      ['refused', {}, (k) => { k.answers.act = () => k.actDoc({ refused: 'not-a-child', detail: '' }); }, 'child reclaim refused'],
      ['failed', {}, (k) => { k.answers.act = () => k.actDoc({ failed: 'tree-busy', detail: 'x', crumb: true }); }, 'child reclaim failed'],
      ['gone', {}, (k) => { k.drop('uuid'); k.drop('child'); }, null],
      ['a deferral the feed already says', { feedQuiet: { deferWhy: 'presence', failureToken: null } }, (k) => { k.see(true); }, null],
      ['a failure the feed already lists', { feedQuiet: { deferWhy: null, failureToken: 'tree-busy' } },
        (k) => { k.answers.act = () => k.actDoc({ failed: 'tree-busy', detail: 'x', crumb: true }); }, null],
    ];
    for (const [name, opts, set, title] of cases) {
      notifySpy.mockClear();
      const k = await childRig(opts);
      set(k);
      const out = await reclaimChild(k.deps, k.req);
      expect(notifySpy.mock.calls.map((c) => [c[1].kind, c[1].title, c[2]]), name).toEqual(title === null ? [] : [['run', title, 'record-only']]);
      if (title !== null) {
        expect(notifySpy.mock.calls[0]![1], name).toMatchObject({ sessionId: KID, runId: k.runId });
        expect(String(notifySpy.mock.calls[0]![1].body), name).toContain(`${KID}, child of run #${k.runId}`);
      }
      expect(out.kind, name).toBe(name === 'a deferral the feed already says' ? 'deferred' : name === 'a failure the feed already lists' ? 'failed' : name);
    }
  });

  it('child-spent: each notice\'s kind, title and body, byte for byte (a fixed clock)', async () => {
    const NOW = 1_789_100_000_000;
    const cases: ReadonlyArray<readonly [string, ChildOpts, (k: ChildRig) => void, string, (k: ChildRig) => string]> = [
      ['reclaimed', {}, () => {}, 'child reclaimed',
        (k) => `${KID}, child of run #${k.runId}, was reclaimed (sweep). Nothing uncommitted was left.`],
      ['deferred', {}, (k) => { k.see(true); }, 'child reclaim deferred',
        (k) => `${KID}, child of run #${k.runId}: reclaim deferred (presence) — someone is viewing this session. Deferred for 90 minutes so far.`],
      ['refused', {}, (k) => { k.answers.act = () => k.actDoc({ refused: 'not-a-child', detail: 'a detail' }); }, 'child reclaim refused',
        (k) => `${KID}, child of run #${k.runId}: ccrc did not create this workspace for a run, or its record of which run did is missing or disagrees `
          + '— so it is never reclaimed automatically. Nothing was removed. (a detail)'],
      ['failed', {}, (k) => { k.answers.act = () => k.actDoc({ failed: 'tree-busy', detail: 'the tree is busy', crumb: true }); },
        'child reclaim failed',
        (k) => `${KID}, child of run #${k.runId}: reclaim failed — tree-busy: the tree is busy. It is retried; the box resumes where it stopped.`],
      ['a ceiling-expired deferral', { deferExpired: true }, (k) => { k.raise(RECLAIM_PAUSE_MARKER); }, 'child reclaim deferred',
        (k) => `${KID}, child of run #${k.runId}: reclaim deferred (paused-at-server) — reclaim-paused is raised: automatic reclamation `
          + 'is paused fleet-wide. The defer ceiling was reached after 90 minutes of deferral, so presence, an attached terminal and a '
          + 'git operation in progress no longer held it back.'],
    ];
    for (const [name, opts, set, title, body] of cases) {
      notifySpy.mockClear();
      const k = await childRig(opts);
      k.deps.now = () => NOW;
      set(k);
      // Deferred since 90 minutes before the fixed clock: the wait the body states is deterministic.
      await reclaimChild(k.deps, { ...k.req, deferredSinceMs: NOW - 5_400_000 });
      expect(notifySpy.mock.calls.map((c) => [c[1].kind, c[1].sessionId, c[1].runId, c[1].title, c[1].body, c[2]]), name)
        .toEqual([['run', KID, k.runId, title, body(k), 'record-only']]);
    }
  });
});

// ══ archive-expired: `expireArchived` ════════════════════════════════════════════════════════════════════════════════

const XID = 'demo-quiet-dune';
const XTOK = 'e'.repeat(64);
const ARCH = 1_789_000_000;
const DUE = ARCH + 604_800;
const EXPIRY_CAPS: readonly string[] = ['ws-audit', 'ws-expire', EXPIRE_CAP, EXPIRE_CHILD_CAP, ACTOR_FLAGS_CAP];

/** An archived row under a fixture HOME, `expire-lane-live` raised, a scripted ccd, the measured listing scripted per
 *  call, a fake presence port. Every port call is written to `spy.log`. */
const expiryRig = async (o: { readonly caps?: readonly string[] | null; readonly live?: boolean; readonly childOf?: number;
  readonly sessionId?: string } = {}) => {
  const home = mkTmp('ccrc-retire-pin-expiry-');
  const argvs: string[][] = [];
  const hooks: { audit?: () => void; act?: () => void; listing?: (n: number) => 'reject' | ReadFailure | void } = {};
  const sessionId = o.sessionId ?? XID;
  const auditDoc = (over: Record<string, unknown> = {}): Scripted => ok(JSON.stringify({ session: sessionId, mode: 'expire',
    archivedAt: ARCH, expiresAt: DUE, alive: false, exists: true, reaping: null, sensitive: [], verdict: 'expirable', token: XTOK,
    detail: '', ...over }));
  const answers: { audit: () => Scripted; act: () => Scripted } = {
    audit: () => auditDoc(),
    act: () => ok(JSON.stringify({ expired: sessionId, archivedAt: ARCH, wip: null, attic: 3, residueBytes: 0, secretsDropped: 0 })),
  };
  const run: Runner = async (_cmd, args) => {
    const a = args[0] === 'ws-audit' ? answers.audit() : args[0] === 'ws-expire' ? answers.act() : ok('');
    return a === 'reject' ? ok('') : a;
  };
  const base = testDeps(home, run);
  const reg = base.cfg.registryDir;
  mkdirSync(reg, { recursive: true });
  if (o.live !== false) writeFileSync(path.join(reg, EXPIRE_LANE_LIVE_MARKER), '');
  const coord = new CoordStore(openCoordDb(path.join(home, '.ccrc', 'coord.db')));
  let listings = 0;
  const io: FleetIO = {
    ...base.io,
    async readdirMeasured(p: string, timeoutMs?: number, signal?: AbortSignal) {
      if (p !== reg) return base.io.readdirMeasured(p, timeoutMs, signal);
      listings += 1;
      spy.log.push('readdirMeasured');
      const what = hooks.listing?.(listings);
      if (what === 'reject') throw new Error('EIO: the registry listing failed');
      if (typeof what === 'string') return { ok: false, reason: what };
      return base.io.readdirMeasured(p, timeoutMs, signal);
    },
    async readdir(p: string, timeoutMs?: number, signal?: AbortSignal) {
      if (p === reg) spy.log.push('readdir');
      return base.io.readdir(p, timeoutMs, signal);
    },
  };
  let visible = false;
  let presenceThrows = false;
  const deps: ExpireArchivedDeps = {
    coord, io, cfg: base.cfg, fleetState: caps(o.caps === undefined ? EXPIRY_CAPS : o.caps),
    runCcd: async (argv) => {
      argvs.push([...argv]);
      spy.log.push(`argv:${argv[0] ?? ''}`);
      if (argv[0] === 'ws-audit') hooks.audit?.(); else if (argv[0] === 'ws-expire') hooks.act?.();
      const a = argv[0] === 'ws-audit' ? answers.audit() : argv[0] === 'ws-expire' ? answers.act() : ok('');
      if (a === 'reject') throw new Error(`EIO: ${argv[0] ?? ''} lost its link`);
      return base.runCcd(argv);
    },
    viewers: { isVisible: (id: string) => {
      spy.log.push('presence');
      if (presenceThrows) throw new Error('presence gone');
      return visible && id === sessionId;
    } },
    notifyLog: new NotifyLog(path.join(home, '.ccrc', 'notify.json')),
  };
  await deps.notifyLog!.load();
  return {
    reg, coord, deps, argvs, hooks, answers, auditDoc,
    req: { sessionId, archivedAt: ARCH, expiresAt: DUE, ...(o.childOf === undefined ? {} : { childOf: o.childOf, rowUuid: null }) },
    raise: (name: string): void => { writeFileSync(path.join(reg, name), ''); },
    lower: (name: string): void => { rmSync(path.join(reg, name), { force: true }); },
    see: (v: boolean): void => { visible = v; },
    presenceThrows: (): void => { presenceThrows = true; },
    /** An open run naming the row as its worker. */
    bindWorker: (): number => {
      const r = coord.openRun({ program: 'w-x', title: 'w-x', project: 'demo', wave: 1, waveOf: null, claimedBy: 'demo-coord' });
      if (!('id' in r)) throw new Error('openRun refused');
      coord.bindSession(r.id, sessionId);
      return r.id;
    },
  };
};
type ExpiryRig = Awaited<ReturnType<typeof expiryRig>>;

const XAUDIT = ['ws-audit', '--session', XID, '--expire'];
const XACT = ['ws-expire', '--expect', XTOK, '--session', XID, '--surface', 'agent', '--actor', 'expire sweep'];
const answeredX = (o: Record<string, unknown>) => ({ ...o, sessionId: XID, archivedAt: ARCH, expiresAt: DUE });

const EXPIRY_STEPS: ReadonlyArray<{ readonly step: string; readonly opts?: Parameters<typeof expiryRig>[0];
  readonly set: (x: ExpiryRig) => void; readonly want: Record<string, unknown>; readonly argv: string[][] }> = [
  { step: '0 the id', opts: { sessionId: '-bad' }, set: () => {},
    want: { kind: 'composition', detail: 'the server refused this session id: it is not a registry id, so no call was composed',
      sessionId: '-bad', archivedAt: ARCH, expiresAt: DUE }, argv: [] },
  { step: '1 capability', opts: { caps: ['ws-audit', 'ws-expire', ACTOR_FLAGS_CAP] }, set: () => {},
    want: answeredX({ kind: 'deferred', why: 'unsupported', detail: 'the fleet host does not advertise expire-v1' }), argv: [] },
  { step: '2 switches', set: (x) => { x.raise(RECLAIM_PAUSE_MARKER); },
    want: answeredX({ kind: 'deferred', why: 'paused-at-server', detail: 'reclaim-paused is raised: cleanup is paused fleet-wide' }), argv: [] },
  { step: '3 store', set: (x) => { x.bindWorker(); },
    want: answeredX({ kind: 'deferred', why: 'open-run', detail: `the coordination store, re-read at the act, keeps ${XID} (open-run)` }), argv: [] },
  { step: '4 presence', set: (x) => { x.see(true); },
    want: answeredX({ kind: 'deferred', why: 'presence', detail: 'someone is viewing this session' }), argv: [] },
  { step: '5 audit unreadable', set: (x) => { x.answers.audit = () => ok('not json'); },
    want: answeredX({ kind: 'audit-failed', detail: 'ws-audit --expire printed no JSON document' }), argv: [XAUDIT] },
  { step: '5 no evidence', set: (x) => { x.answers.audit = () => x.auditDoc({ expiresAt: undefined }); },
    want: answeredX({ kind: 'no-evidence' }), argv: [XAUDIT] },
  { step: '5 a moved archive', set: (x) => { x.answers.audit = () => x.auditDoc({ archivedAt: ARCH + 5 }); },
    want: answeredX({ kind: 'deferred', why: 'state-changed', detail: `the audit read archive ${ARCH + 5}, not the ${ARCH} this pass queued` }),
    argv: [XAUDIT] },
  { step: '5 a refusal', set: (x) => { x.answers.audit = () => x.auditDoc({ verdict: 'held', token: undefined, detail: 'a hold stands' }); },
    want: answeredX({ kind: 'refused', token: 'held', detail: 'a hold stands', inUse: [], auditExpiresAt: DUE }), argv: [XAUDIT] },
  { step: '6 switches at the act', set: (x) => { x.hooks.audit = () => { x.raise(RECLAIM_PAUSE_MARKER); }; },
    want: answeredX({ kind: 'deferred', why: 'paused-at-server', detail: 'reclaim-paused is raised: cleanup is paused fleet-wide' }), argv: [XAUDIT] },
  { step: '7 shadow', opts: { live: false }, set: () => {},
    want: answeredX({ kind: 'would-expire', sensitive: 0 }), argv: [XAUDIT] },
];

describe('archive-expired (expireArchived): the step matrix (C4h a)', () => {
  it.each(EXPIRY_STEPS.map((s) => [s.step, s] as const))('archive-expired: the deferral at step %s alone answers its own word and detail', async (_n, s) => {
    const x = await expiryRig(s.opts);
    s.set(x);
    expect(await expireArchived(x.deps, x.req)).toEqual(s.want);
    expect(x.argvs).toEqual(s.argv);
  });

  it('archive-expired: every pair standing together answers the earlier step (the id before the capability)', async () => {
    const pairs: ReadonlyArray<readonly [number, number]> = [[0, 1], [1, 2], [2, 3], [3, 4], [4, 5], [8, 9]];
    for (const [a, b] of pairs) {
      const first = EXPIRY_STEPS[a]!; const second = EXPIRY_STEPS[b]!;
      const x = await expiryRig({ ...second.opts, ...first.opts });
      second.set(x); first.set(x);
      expect(await expireArchived(x.deps, x.req), `${first.step} beside ${second.step}`).toEqual(first.want);
    }
  });

  it('archive-expired: presence defers with no ceiling (no request field lets it through)', async () => {
    const x = await expiryRig();
    x.see(true);
    const req = { ...x.req, deferExpired: true } as typeof x.req;
    expect(await expireArchived(x.deps, req)).toMatchObject({ kind: 'deferred', why: 'presence' });
    expect(x.argvs).toEqual([]);
  });

  it('archive-expired: an unlistable registry names its reason; a rejecting one is unreadable (one measured listing)', async () => {
    for (const reason of ['unreadable', 'absent'] as const) {
      const x = await expiryRig();
      x.hooks.listing = (n) => (n === 1 ? reason : undefined);
      expect(await expireArchived(x.deps, x.req)).toEqual(answeredX({ kind: 'deferred', why: 'paused-at-server',
        detail: `the registry did not list (${reason}), so a raised reclaim-paused cannot be ruled out` }));
    }
    const r = await expiryRig();
    r.hooks.listing = (n) => (n === 1 ? 'reject' : undefined);
    expect(await expireArchived(r.deps, r.req)).toEqual(answeredX({ kind: 'deferred', why: 'paused-at-server',
      detail: 'the registry did not list (unreadable), so a raised reclaim-paused cannot be ruled out' }));
    spy.log.length = 0;
    const clean = await expiryRig();
    await expireArchived(clean.deps, clean.req);
    expect(spy.log.filter((l) => l === 'readdirMeasured' || l === 'readdir'), 'two measured listings, never a plain one')
      .toEqual(['readdirMeasured', 'readdirMeasured']);
    expect(expireLaneLive([EXPIRE_LANE_LIVE_MARKER])).toBe(true);
    expect(expireLaneLive([EXPIRE_CHILD_LIVE_MARKER])).toBe(false);
  });

  it('a pause raised during the act holds: archive-expired (and expire-lane-live removed answers would-expire)', async () => {
    const x = await expiryRig();
    x.hooks.audit = () => { x.raise(RECLAIM_PAUSE_MARKER); };
    expect(await expireArchived(x.deps, x.req)).toEqual(answeredX({ kind: 'deferred', why: 'paused-at-server',
      detail: 'reclaim-paused is raised: cleanup is paused fleet-wide' }));
    expect(x.argvs).toEqual([XAUDIT]);
    const y = await expiryRig();
    y.hooks.audit = () => { y.lower(EXPIRE_LANE_LIVE_MARKER); };
    expect(await expireArchived(y.deps, y.req)).toEqual(answeredX({ kind: 'would-expire', sensitive: 0 }));
    expect(y.argvs).toEqual([XAUDIT]);
  });

  it('archive-expired: held at the act — expire-v1, or a child row\'s expire-child-v1, withdrawn during the audit composes no ws-expire', async () => {
    // The capability asked again in the act's own scope (`expireAct`, plan item 2 "capability again"): the audit's fake
    // replaces the advertised verbs as it answers. Both re-asks answer today's one sentence, which names expire-v1.
    const withdraw = (x: ExpiryRig, cap: string): void => {
      x.hooks.audit = () => { (x.deps.fleetState as { ccdVerbs: string[] | null }).ccdVerbs = EXPIRY_CAPS.filter((c) => c !== cap); };
    };
    const plain = await expiryRig();
    withdraw(plain, EXPIRE_CAP);
    expect(await expireArchived(plain.deps, plain.req)).toEqual(answeredX({ kind: 'deferred', why: 'unsupported',
      detail: 'the fleet host does not advertise expire-v1' }));
    expect(plain.argvs).toEqual([XAUDIT]);
    const child = await expiryRig({ childOf: 41 });
    child.raise(EXPIRE_CHILD_LIVE_MARKER);
    withdraw(child, EXPIRE_CHILD_CAP);
    expect(await expireArchived(child.deps, child.req)).toEqual({ ...answeredX({ kind: 'deferred', why: 'unsupported',
      detail: 'the fleet host does not advertise expire-v1' }), child: true });
    expect(child.argvs).toEqual([[...XAUDIT, '--child-of', '41']]);
    expect(notifySpy).toHaveBeenCalledTimes(0);
  });

  it('archive-expired: the child arm (expire-child-v1 at step 1 and at the act; expire-child-live decides its shadow)', async () => {
    const noCap = await expiryRig({ childOf: 41, caps: ['ws-audit', 'ws-expire', EXPIRE_CAP, ACTOR_FLAGS_CAP] });
    expect(await expireArchived(noCap.deps, noCap.req)).toEqual({ ...answeredX({ kind: 'deferred', why: 'unsupported',
      detail: 'the fleet host does not advertise expire-child-v1' }), child: true });
    const held = await expiryRig({ childOf: 41 });
    expect(await expireArchived(held.deps, held.req)).toEqual({ ...answeredX({ kind: 'would-expire', sensitive: 0 }), child: true, childArmHeld: true });
    const armed = await expiryRig({ childOf: 41 });
    armed.raise(EXPIRE_CHILD_LIVE_MARKER);
    armed.answers.act = () => ok(JSON.stringify({ expired: XID, archivedAt: ARCH, wip: null, attic: 3, residueBytes: 0, secretsDropped: 0 }));
    expect(await expireArchived(armed.deps, armed.req)).toMatchObject({ kind: 'expired', child: true });
  });

  it('archive-expired argv: a plain row, a child row carries --child-of, and no actor flags without actor-flags-v1', async () => {
    const plain = await expiryRig();
    expect(await expireArchived(plain.deps, plain.req)).toMatchObject({ kind: 'expired' });
    expect(plain.argvs).toEqual([XAUDIT, XACT]);
    const child = await expiryRig({ childOf: 41 });
    child.raise(EXPIRE_CHILD_LIVE_MARKER);
    await expireArchived(child.deps, child.req);
    expect(child.argvs).toEqual([[...XAUDIT, '--child-of', '41'],
      ['ws-expire', '--expect', XTOK, '--session', XID, '--child-of', '41', '--surface', 'agent', '--actor', 'expire sweep']]);
    const bare = await expiryRig({ caps: ['ws-audit', 'ws-expire', EXPIRE_CAP] });
    await expireArchived(bare.deps, bare.req);
    expect(bare.argvs).toEqual([XAUDIT, ['ws-expire', '--expect', XTOK, '--session', XID]]);
  });
});

describe('archive-expired (expireArchived): rejections, effects and notices (C4h b, c, h, j)', () => {
  const PROPAGATE: ReadonlyArray<readonly [string, (x: ExpiryRig) => void, string]> = [
    ['presence (viewers.isVisible)', (x) => { x.presenceThrows(); }, 'presence gone'],
    ['audit (expireAudit)', (x) => { x.answers.audit = () => 'reject'; }, 'EIO: ws-audit lost its link'],
    ['act (expireAct)', (x) => { x.answers.act = () => 'reject'; }, 'EIO: ws-expire lost its link'],
  ];
  it.each(PROPAGATE)('archive-expired: a rejecting %s rejects the executor', async (_n, set, msg) => {
    const x = await expiryRig();
    set(x);
    await expect(expireArchived(x.deps, x.req)).rejects.toThrow(msg);
    expect(notifySpy).toHaveBeenCalledTimes(0);
    expect(shadowSpy).toHaveBeenCalledTimes(0);
  });

  it('archive-expired: a rejecting audit rejects the executor (named for the mutation table)', async () => {
    const x = await expiryRig();
    x.answers.audit = () => 'reject';
    await expect(expireArchived(x.deps, x.req)).rejects.toThrow('EIO: ws-audit lost its link');
  });

  it('archive-expired: the judged readers answer their own sentence (both listings fold a rejection; the store says store-unreadable)', async () => {
    const last = await expiryRig();
    last.hooks.listing = (n) => (n === 2 ? 'reject' : undefined);
    expect(await expireArchived(last.deps, last.req)).toEqual(answeredX({ kind: 'deferred', why: 'paused-at-server',
      detail: 'the registry did not list (unreadable), so a raised reclaim-paused cannot be ruled out' }));
    const store = await expiryRig();
    store.coord.bindingsOf = () => { throw new Error('the store is locked'); };
    expect(await expireArchived(store.deps, store.req)).toEqual(answeredX({ kind: 'deferred', why: 'store-unreadable',
      detail: `the coordination store, re-read at the act, keeps ${XID} (store-unreadable)` }));
  });

  it('archive-expired: an audit refusal records the nested-rescue shadow before gone or refused; an act refusal never does', async () => {
    for (const [verdict, kind] of [['held', 'refused'], ['not-archived', 'gone']] as const) {
      shadowSpy.mockClear();
      const x = await expiryRig();
      x.answers.audit = () => x.auditDoc({ verdict, token: undefined, detail: 'x', nestedRescue: { wouldRescue: ['nested/a'] } });
      expect(await expireArchived(x.deps, x.req)).toMatchObject({ kind });
      expect(shadowSpy).toHaveBeenCalledTimes(1);
      expect(shadowSpy.mock.calls[0]![1]).toEqual({ sessionId: XID, runId: null, key: String(ARCH), who: `${XID} (archived ${ARCH})`,
        count: 1, paths: ['nested/a'], rung: 'expire:rescue' });
    }
    shadowSpy.mockClear();
    const act = await expiryRig();
    act.answers.act = () => ok(JSON.stringify({ refused: 'held', detail: 'x', nestedRescue: { wouldRescue: ['nested/a'] } }));
    expect(await expireArchived(act.deps, act.req)).toMatchObject({ kind: 'refused', token: 'held' });
    expect(shadowSpy).toHaveBeenCalledTimes(0);
  });

  it('archive-expired: a moved archive records no shadow (the archive-match check comes first)', async () => {
    const x = await expiryRig();
    x.answers.audit = () => x.auditDoc({ archivedAt: ARCH + 5, verdict: 'held', token: undefined, detail: 'x', nestedRescue: { wouldRescue: ['nested/a'] } });
    expect(await expireArchived(x.deps, x.req)).toMatchObject({ kind: 'deferred', why: 'state-changed' });
    expect(shadowSpy).toHaveBeenCalledTimes(0);
  });

  it('archive-expired: the executor calls notify zero times, on every outcome (the lane writes its row)', async () => {
    for (const s of EXPIRY_STEPS) {
      notifySpy.mockClear();
      const x = await expiryRig(s.opts);
      s.set(x);
      await expireArchived(x.deps, x.req);
      expect(notifySpy, s.step).toHaveBeenCalledTimes(0);
    }
    const x = await expiryRig();
    expect(await expireArchived(x.deps, x.req)).toMatchObject({ kind: 'expired' });
    expect(notifySpy).toHaveBeenCalledTimes(0);
  });
});

// ══ temp-orphan: `collectTempRoot` ═══════════════════════════════════════════════════════════════════════════════════

const NODE = '6f0c2a4e-1b7d-4c3a-9e5f-0a1b2c3d4e5f';
const CAUDIT = ['ws-audit', '--session', CID, '--collect'];
const CACT = ['ws-collect', '--expect', CTOK, '--session', CID, '--surface', 'agent', '--actor', 'collect sweep'];
const without = (cap: string): string[] => FULL_CAPS.filter((c) => c !== cap);
/** Settings stores `live` for NODE, coherent at generation 2, its latch set (the fixture's public row and journal
 *  planters); NODE measured on the current connection unless `measured` is false. */
const settingsLive = (r: CollectRig, measured = true): void => {
  r.setRow({ choice: 'live', fleetNodeId: NODE, markerRetiredAt: WALL0, generation: 2, updatedAt: WALL0 });
  r.setJournal('{"generation":1}\n{"generation":2}\n');
  if (measured) r.setNode({ kind: 'known', nodeId: NODE, measuredAt: WALL0 });
};

/** The rig's deps with every port call recorded in order (`calls`), and the synchronous-tail probes armed: (a) on the
 *  `link.epochNow` that follows the LAST listing's return (the pair's `after`), (b) on the first read of
 *  `control.coord.collectLaneRow` after it (the latch's). Each queues a microtask flag; the fake `runCcd` reads both
 *  flags synchronously as it records the `ws-collect` argv. */
const traced = (r: CollectRig) => {
  const calls: string[] = [];
  const d = r.deps;
  let returned = 0;
  const probe = { armedA: false, armedB: false, ranA: false, ranB: false, atArgv: null as null | { a: boolean; b: boolean } };
  const lane: CollectLanePort = {
    clock: () => d.lane.clock(),
    generations: (id) => { calls.push('lane.generations'); return d.lane.generations(id); },
    observation: (id) => { calls.push('lane.observation'); return d.lane.observation(id); },
    cleared: (why) => { calls.push(`lane.cleared:${why}`); d.lane.cleared(why); },
    flipped: (s) => { calls.push('lane.flipped'); return d.lane.flipped(s); },
  };
  const deps: CollectTempRootDeps = {
    ...d,
    coord: {
      run: (n) => { calls.push('coord.run'); return d.coord.run(n); },
      bindingsOf: (id) => { calls.push('coord.bindingsOf'); return d.coord.bindingsOf(id); },
    },
    io: { readdirMeasured: async (p, t, s) => {
      calls.push('listing');
      try { return await d.io.readdirMeasured(p, t, s); } finally { returned += 1; }
    } },
    runCcd: async (argv) => {
      calls.push(`runCcd:${argv[0] ?? ''}`);
      if (argv[0] === 'ws-collect') probe.atArgv = { a: probe.ranA, b: probe.ranB };
      return d.runCcd(argv);
    },
    viewers: { isVisible: (id) => { calls.push('viewers.isVisible'); return d.viewers?.isVisible(id) ?? false; } },
    lane,
    control: {
      ...d.control,
      coord: {
        collectLaneRow: () => {
          calls.push('control.collectLaneRow');
          if (returned === 2 && !probe.armedB) { probe.armedB = true; queueMicrotask(() => { probe.ranB = true; }); }
          return d.control.coord.collectLaneRow();
        },
        setCollectLane: (...a) => { calls.push('control.setCollectLane'); return d.control.coord.setCollectLane(...a); },
      },
      journal: d.control.journal === null ? null : { ...d.control.journal, read: () => { calls.push('control.journal'); return d.control.journal!.read(); } },
    },
    link: {
      epochNow: () => {
        calls.push('link.epochNow');
        if (returned === 2 && !probe.armedA) { probe.armedA = true; queueMicrotask(() => { probe.ranA = true; }); }
        return d.link.epochNow();
      },
      current: () => { calls.push('link.current'); return d.link.current(); },
    },
  };
  return { deps, calls, probe };
};

const COLLECT_STEPS: ReadonlyArray<{ readonly step: string; readonly opts?: Parameters<typeof collectRigOf>[0];
  readonly set: (r: CollectRig) => void; readonly want: Record<string, unknown>; readonly clears: string[]; readonly argv: string[][] }> = [
  { step: '1 capability', opts: { caps: without(RECLAIM_PAUSE_CAP) }, set: () => {},
    want: { kind: 'not-asked', step: 1, why: 'caps', detail: 'the fleet host does not advertise both collect-v1 and reclaim-pause-v1' },
    clears: ['caps'], argv: [] },
  { step: '1 the id', set: () => {},
    want: { kind: 'not-asked', step: 1, why: 'id-refused', detail: `the id is not one the collector may name: a session id’s shape, with no leading dot or dash, of at most ${TMPROOT_ID_MAX_CHARS} characters` },
    clears: [], argv: [] },
  { step: '2 switches', opts: { paused: true }, set: () => {},
    want: { kind: 'not-asked', step: 2, why: 'paused', detail: 'reclaim-paused is raised: cleanup is paused fleet-wide' }, clears: ['paused'], argv: [] },
  { step: '3 presence', set: (r) => { r.see(true); },
    want: { kind: 'not-asked', step: 3, why: 'presence', detail: 'someone is viewing this session' }, clears: [], argv: [] },
  { step: '4 the audit gate', opts: { caps: without('ws-audit') }, set: () => {},
    want: { kind: 'not-asked', step: 4, why: 'caps', detail: 'the fleet host cannot answer ws-audit' }, clears: ['caps'], argv: [] },
  { step: '4 stale', set: (r) => { r.hooks.audit = () => { r.lane.resetId(CID); }; },
    want: { kind: 'answered', step: 4, why: 'stale', detail: 'a clear landed while the audit was in flight, so its answer is no observation' },
    clears: [], argv: [CAUDIT] },
  { step: '4 not collectable', set: (r) => { r.answerAudit(() => ok(JSON.stringify({ session: CID, mode: 'collect', exists: true, collect: null, verdict: 'witness', detail: 'x' }))); },
    want: { kind: 'answered', step: 4, why: 'not-collectable', detail: 'ws-audit answered verdict' }, clears: [], argv: [CAUDIT] },
  { step: '4 held', opts: { witness: null }, set: () => {},
    want: { kind: 'held', step: 4, hold: { kind: 'held', why: 'no-witness-run', detail: `ws-audit offered a fresh collection of ${CID} whose witness names no run, so no run can be asked whether it still needs the temp root` } },
    clears: [], argv: [CAUDIT] },
  { step: '4 not licensed', opts: { obs1: null }, set: () => {},
    want: { kind: 'answered', step: 4, why: 'not-licensed', detail: 'no earlier audit answered collectable with this token at least the interval before this one (no-first)' },
    clears: [], argv: [CAUDIT] },
  { step: '5 switches', set: (r) => { r.hooks.listing = (n) => { if (n === 2) r.raise(RECLAIM_PAUSE_MARKER); }; },
    want: { kind: 'answered', step: 5, why: 'paused', detail: 'reclaim-paused is raised: cleanup is paused fleet-wide' }, clears: ['paused'], argv: [CAUDIT] },
  { step: '5 the epoch', set: (r) => { r.hooks.listing = (n) => { if (n === 2) r.bumpEpoch(); }; },
    want: { kind: 'answered', step: 5, why: 'epoch-changed', detail: 'the connection to the fleet host was replaced while the last listing was out, so nothing it said stands for the box now connected' },
    clears: ['epoch'], argv: [CAUDIT] },
  { step: '5 the node', opts: { live: false, lastSeenLive: false }, set: (r) => { settingsLive(r, false); },
    want: { kind: 'answered', step: 5, why: 'unknown-fleet', detail: 'Settings stores live, and the fleet node on the current connection is unmeasured or its id is in collision, so nothing arms the collector for this box' },
    clears: ['node'], argv: [CAUDIT] },
  { step: '6 capability', set: (r) => { r.hooks.audit = () => { r.state.ccdVerbs = without(COLLECT_CAP); }; },
    want: { kind: 'answered', step: 6, why: 'caps', detail: 'the fleet host no longer advertises both collect-v1 and reclaim-pause-v1' }, clears: ['caps'], argv: [CAUDIT] },
  { step: '5 the flip', set: (r) => { r.hooks.listing = (n) => { if (n === 2) r.lower(COLLECT_LANE_LIVE_MARKER); }; },
    want: { kind: 'answered', step: 5, why: 'switch-flip', detail: 'the collector’s effective switch changed since this lane last read it, so every pair was cleared and this job composes nothing' },
    clears: [], argv: [CAUDIT] },
  { step: '5 safety', opts: { live: false, lastSeenLive: false }, set: (r) => { r.setRow({ generation: 5 }); },
    want: { kind: 'answered', step: 5, why: 'safety-stopped', detail: 'the collector’s control state could not be proved coherent, so this job composes nothing (journal-missing)' },
    clears: [], argv: [CAUDIT] },
  { step: '6 the pair', set: (r) => { r.hooks.listing = (n) => { if (n === 2) r.lane.resetId(CID); }; },
    want: { kind: 'answered', step: 6, why: 'pair-cleared', detail: 'the observations this act rested on were cleared before it could be composed' },
    clears: [], argv: [CAUDIT] },
  { step: '6 presence', set: (r) => { r.hooks.listing = (n) => { if (n === 2) r.see(true); }; },
    want: { kind: 'answered', step: 6, why: 'presence', detail: 'someone is viewing this session' }, clears: [], argv: [CAUDIT] },
  { step: '6 the hold', set: (r) => { r.hooks.listing = (n) => { if (n === 2) r.openRun({ sessionId: CID }); }; },
    want: { kind: 'held', step: 6, hold: { kind: 'held', why: 'id-in-open-run' } }, clears: [], argv: [CAUDIT] },
  { step: '6 shadow', opts: { live: false, lastSeenLive: false }, set: () => {},
    want: { kind: 'would-collect' }, clears: [], argv: [CAUDIT] },
];
/** The job a step row runs: the id-refused row names an id the predicate refuses. */
const jobOf = (r: CollectRig, step: string) => (step === '1 the id' ? r.job('-not-a-tmproot') : r.job());

describe('temp-orphan (collectTempRoot): the step matrix (C4h a)', () => {
  it.each(COLLECT_STEPS.map((s) => [s.step, s] as const))('temp-orphan: the deferral at step %s alone answers its own word and detail', async (_n, s) => {
    const r = collectRigOf(s.opts);
    s.set(r);
    expect(await collectTempRoot(r.deps, jobOf(r, s.step))).toMatchObject(s.want);
    expect(r.attempts).toEqual(s.argv);
    expect(r.lane.clears).toEqual(s.clears);
  });

  it('temp-orphan: every pair standing together answers the earlier step (the capability before the id)', async () => {
    const pairs: ReadonlyArray<readonly [number, number]> = [[0, 1], [1, 2], [2, 3], [3, 4], [4, 5], [7, 8], [9, 10], [15, 16], [16, 17]];
    for (const [a, b] of pairs) {
      const first = COLLECT_STEPS[a]!; const second = COLLECT_STEPS[b]!;
      const r = collectRigOf({ ...second.opts, ...first.opts });
      second.set(r);
      const [l2, a2] = [r.hooks.listing, r.hooks.audit];
      first.set(r);
      // Both rows' moments stand: a hook the earlier row set runs after the later row's, never in its place.
      const [l1, a1] = [r.hooks.listing, r.hooks.audit];
      if (l1 !== l2 && l2 !== undefined) r.hooks.listing = (n) => { l2(n); return l1?.(n); };
      if (a1 !== a2 && a2 !== undefined) r.hooks.audit = () => { a2(); a1?.(); };
      const job = a === 1 || b === 1 ? r.job('-not-a-tmproot') : r.job();
      expect(await collectTempRoot(r.deps, job), `${first.step} beside ${second.step}`).toMatchObject(first.want);
    }
  });

  it('temp-orphan: an unlistable registry names no reason (one measured listing, read by collectSwitches)', async () => {
    for (const n of [1, 2]) {
      const r = collectRigOf();
      r.hooks.listing = (k) => (k === n ? 'null' : undefined);
      expect(await collectTempRoot(r.deps, r.job())).toMatchObject({ why: 'paused',
        detail: 'the registry did not list, so a raised reclaim-paused cannot be ruled out' });
      expect(r.lane.clears).toEqual(['paused']);
    }
    expect(await collectSwitches({ readdirMeasured: async () => ({ ok: false, reason: 'absent' }) }, '/fixture/reg'))
      .toEqual({ paused: true, why: 'unlistable', reason: 'absent' });
    expect(await collectSwitches({ readdirMeasured: async () => { throw new Error('EIO'); } }, '/fixture/reg'))
      .toEqual({ paused: true, why: 'unlistable', reason: 'unreadable' });
    expect(await collectSwitches({ readdirMeasured: async () => ({ ok: true, entries: [COLLECT_LANE_LIVE_MARKER, COLLECT_LOOSE_LIVE_MARKER] }) }, '/fixture/reg'))
      .toEqual({ paused: false, marker: true, looseMarker: true });
  });

  it('temp-orphan: the capability\'s precondition (reclaim-pause-v1) is asked, and presence defers with no ceiling', async () => {
    const r = collectRigOf({ caps: without(RECLAIM_PAUSE_CAP) });
    expect(await collectTempRoot(r.deps, r.job())).toMatchObject({ kind: 'not-asked', step: 1, why: 'caps' });
    const learn = collectRigOf({ caps: without(COLLECT_CAP) });
    expect(await learnCollect(learn.deps, CID)).toEqual({ kind: 'not-asked', why: 'caps' });
    expect(await learnCollect(collectRigOf().deps, '-not-a-tmproot')).toEqual({ kind: 'id-refused' });
  });

  it('temp-orphan: held at the act — the switches, the epoch, a capability withdrawn, Settings flipped, presence and a run opened in step 6', async () => {
    // A capability withdrawn before step 6 answers caps at 6, with one cleared('caps'), and the flip, the step-6
    // presence read and the hold re-read are never made.
    const r = collectRigOf();
    r.hooks.audit = () => { r.state.ccdVerbs = without(COLLECT_CAP); };
    const t = traced(r);
    expect(await collectTempRoot(t.deps, r.job())).toMatchObject({ kind: 'answered', step: 6, why: 'caps' });
    expect(r.lane.clears).toEqual(['caps']);
    const after = t.calls.slice(t.calls.lastIndexOf('listing'));
    expect(after.filter((c) => c === 'lane.flipped' || c === 'viewers.isVisible' || c === 'coord.run' || c === 'coord.bindingsOf')).toEqual([]);
    expect(r.attempts).toEqual([CAUDIT]);
    // Settings flipped off during the last await: a flip, no argv.
    const s = collectRigOf({ live: false, lastSeenLive: true });
    settingsLive(s);
    s.hooks.listing = (n) => { if (n === 2) s.coord.setCollectLane({ kind: 'off' }, WALL0 + 1, s.journal); };
    expect(await collectTempRoot(s.deps, s.job())).toMatchObject({ kind: 'answered', step: 5, why: 'switch-flip' });
    expect(s.attempts).toEqual([CAUDIT]);
  });

  it('temp-orphan: held at the act — collect-loose-v1 withdrawn during the loose audit answers would-collect, and ws-collect is never composed', async () => {
    // The loose arm's capability asked again inside step 6 (plan item 2 "capability again"): the audit's fake replaces the
    // advertised verbs with a set that no longer carries collect-loose-v1 as it answers. The lane's own capabilities
    // stand, so the lane is live and only the loose re-ask holds the act.
    const r = looseRig();
    r.hooks.audit = () => { r.state.ccdVerbs = FULL_CAPS.filter((c) => c !== COLLECT_LOOSE_CAP); };
    expect(await collectTempRoot(r.deps, r.job(LOOSE_ID))).toMatchObject({ kind: 'would-collect' });
    expect(r.attempts).toEqual([['ws-audit', '--loose-hex', LOOSE_HEX, '--collect']]);
    expect(r.lane.clears).toEqual([]);
    expect(notifySpy).toHaveBeenCalledTimes(0);
  });
});

describe('temp-orphan (collectTempRoot): the tail, the order, effects, argv, rejections and notices (C4h b, c, f-j)', () => {
  it("temp-orphan: no microtask queued after the final listing's continuation runs before the argv", async () => {
    for (const loose of [false, true]) {
      const r = loose ? looseRig() : collectRigOf();
      const t = traced(r);
      const out = await collectTempRoot(t.deps, loose ? r.job(LOOSE_ID) : r.job());
      expect(out.kind).toBe('acted');
      expect(t.probe.armedA && t.probe.armedB, 'both probes were armed').toBe(true);
      expect(t.probe.atArgv, 'probe (a): the after epoch read; probe (b): the latch\'s first row read').toEqual({ a: false, b: false });
    }
  });

  it('temp-orphan: the call order of a job that composes (the pair\'s before is the job\'s epoch, never a read)', async () => {
    const r = collectRigOf();
    const t = traced(r);
    expect(await collectTempRoot(t.deps, r.job())).toMatchObject({ kind: 'acted' });
    expect(t.calls).toEqual([
      'listing', 'viewers.isVisible',
      'lane.generations', 'runCcd:ws-audit',
      'lane.generations', 'lane.observation', 'coord.run', 'coord.bindingsOf',
      'link.epochNow', 'listing', 'link.epochNow',
      'control.collectLaneRow', 'control.journal',
      'control.collectLaneRow', 'control.journal', 'link.current',
      'lane.flipped', 'lane.generations', 'lane.observation', 'viewers.isVisible', 'coord.run', 'coord.bindingsOf',
      'runCcd:ws-collect',
    ]);
    expect(t.calls.indexOf('link.epochNow')).toBeGreaterThan(t.calls.indexOf('runCcd:ws-audit'));
  });

  it('temp-orphan: each deferral point clears the lane once, with its why', async () => {
    const points: ReadonlyArray<readonly [string, () => CollectRig, string | null, string]> = [
      ['step-1 capability', () => collectRigOf({ caps: without(COLLECT_CAP) }), null, 'caps'],
      ['step-1 loose capability', () => collectRigOf(), LOOSE_ID, 'caps'],
      ['step-2 pause', () => collectRigOf({ paused: true }), null, 'paused'],
      ['step-4 audit refusal', () => collectRigOf({ caps: without('ws-audit') }), null, 'caps'],
      ['step-5 pause', () => { const r = collectRigOf(); r.hooks.listing = (n) => { if (n === 2) r.raise(RECLAIM_PAUSE_MARKER); }; return r; }, null, 'paused'],
      ['epoch-changed', () => { const r = collectRigOf(); r.hooks.listing = (n) => { if (n === 2) r.bumpEpoch(); }; return r; }, null, 'epoch'],
      ['unknown-fleet', () => { const r = collectRigOf({ live: false, lastSeenLive: false }); settingsLive(r, false); return r; }, null, 'node'],
      ['step-6 not-running', () => { const r = collectRigOf(); r.hooks.audit = () => { r.state.ccdVerbs = without(COLLECT_CAP); }; return r; }, null, 'caps'],
    ];
    for (const [name, mk, id, why] of points) {
      const r = mk();
      await collectTempRoot(r.deps, id === null ? r.job() : r.job(id));
      expect(r.lane.clears, name).toEqual([why]);
    }
  });

  it('temp-orphan: every other outcome clears nothing', async () => {
    for (const s of COLLECT_STEPS.filter((x) => x.clears.length === 0)) {
      const r = collectRigOf(s.opts);
      s.set(r);
      await collectTempRoot(r.deps, jobOf(r, s.step));
      expect(r.lane.clears, s.step).toEqual([]);
    }
    const acted = collectRigOf();
    expect(await collectTempRoot(acted.deps, acted.job())).toMatchObject({ kind: 'acted' });
    expect(acted.lane.clears).toEqual([]);
  });

  it('temp-orphan: the latch is written before the lane is resolved, even when the job stops', async () => {
    // The latch helper's first read (`collectControlNow`) is made once on every job that reaches step 6, before the
    // resolver's own read; a job that stops before step 6 makes neither.
    const reaching: ReadonlyArray<readonly [string, () => CollectRig]> = [
      ['acted', () => collectRigOf()],
      ['paused', () => { const r = collectRigOf(); r.hooks.listing = (n) => { if (n === 2) r.raise(RECLAIM_PAUSE_MARKER); }; return r; }],
      ['epoch-changed', () => { const r = collectRigOf(); r.hooks.listing = (n) => { if (n === 2) r.bumpEpoch(); }; return r; }],
      ['unknown-fleet', () => { const r = collectRigOf({ live: false, lastSeenLive: false }); settingsLive(r, false); return r; }],
      ['caps', () => { const r = collectRigOf(); r.hooks.audit = () => { r.state.ccdVerbs = without(COLLECT_CAP); }; return r; }],
    ];
    for (const [name, mk] of reaching) {
      const r = mk();
      const t = traced(r);
      await collectTempRoot(t.deps, r.job());
      const tail = t.calls.slice(t.calls.lastIndexOf('listing') + 1);
      expect(tail.slice(0, 6), name).toEqual(['link.epochNow', 'control.collectLaneRow', 'control.journal', 'control.collectLaneRow',
        'control.journal', 'link.current']);
    }
    // The latch RETIRES the legacy marker when it is due (Settings coherent, its latch unset, the marker measured
    // absent): the write is made once even when the job then stops (here: Settings live for a node the connection now
    // measures as another, so the job composes nothing), and a job that stops before step 6 reads no control state.
    const due = collectRigOf({ live: false, lastSeenLive: false });
    due.setRow({ choice: 'live', fleetNodeId: NODE, markerRetiredAt: null, generation: 2, updatedAt: WALL0 });
    due.setJournal('{"generation":1}\n{"generation":2}\n');
    due.hooks.listing = (n) => { if (n === 2) due.setNode({ kind: 'known', nodeId: 'other-node-id', measuredAt: WALL0 }); };
    await collectTempRoot(due.deps, due.job());
    expect(due.writes.map((w) => w.kind), 'the latch retired once, though the job then stopped').toEqual(['retire']);
    const early = collectRigOf({ paused: true });
    const te = traced(early);
    await collectTempRoot(te.deps, early.job());
    expect(te.calls.filter((c) => c.startsWith('control.'))).toEqual([]);
  });

  it('temp-orphan: the flip is asked only after the stop arms pass', async () => {
    const stops: ReadonlyArray<() => CollectRig> = [
      () => { const r = collectRigOf(); r.hooks.listing = (n) => { if (n === 2) r.raise(RECLAIM_PAUSE_MARKER); }; return r; },
      () => { const r = collectRigOf(); r.hooks.listing = (n) => { if (n === 2) r.bumpEpoch(); }; return r; },
      () => { const r = collectRigOf(); r.hooks.audit = () => { r.state.ccdVerbs = without(COLLECT_CAP); }; return r; },
    ];
    for (const mk of stops) {
      const r = mk();
      const t = traced(r);
      await collectTempRoot(t.deps, r.job());
      expect(t.calls.filter((c) => c === 'lane.flipped')).toEqual([]);
    }
    const passes = collectRigOf();
    const tp = traced(passes);
    await collectTempRoot(tp.deps, passes.job());
    expect(tp.calls.filter((c) => c === 'lane.flipped')).toHaveLength(1);
    // A flip: the job answers switch-flip and composes nothing; the lane's fake records its one flip and its pair
    // clear; the executor itself calls notify zero times.
    const flip = collectRigOf();
    flip.hooks.listing = (n) => { if (n === 2) flip.lower(COLLECT_LANE_LIVE_MARKER); };
    expect(await collectTempRoot(flip.deps, flip.job())).toMatchObject({ kind: 'answered', why: 'switch-flip' });
    expect(flip.lane.flips).toEqual([false]);
    expect(flip.lane.port.observation(CID)).toBeNull();
    expect(flip.attempts).toEqual([CAUDIT]);
    expect(notifySpy).toHaveBeenCalledTimes(0);
  });

  it('temp-orphan argv: the plain arm and the loose arm, each under the sweepDec actor; no actor flags without actor-flags-v1', async () => {
    const plain = collectRigOf();
    await collectTempRoot(plain.deps, plain.job());
    expect(plain.attempts).toEqual([CAUDIT, CACT]);
    const loose = looseRig();
    expect(await collectTempRoot(loose.deps, loose.job(LOOSE_ID))).toMatchObject({ kind: 'acted', result: { kind: 'collected' } });
    expect(loose.attempts).toEqual([['ws-audit', '--loose-hex', LOOSE_HEX, '--collect'],
      ['ws-collect', '--expect', CTOK, '--loose-hex', LOOSE_HEX, '--surface', 'agent', '--actor', 'collect sweep']]);
    const bare = collectRigOf({ caps: without(ACTOR_FLAGS_CAP) });
    await collectTempRoot(bare.deps, bare.job());
    expect(bare.attempts).toEqual([CAUDIT, ['ws-collect', '--expect', CTOK, '--session', CID]]);
    // The loose arm's own marker, from the same final listing: absent is shadow.
    const unarmed = looseRig(false);
    expect(await collectTempRoot(unarmed.deps, unarmed.job(LOOSE_ID))).toMatchObject({ kind: 'would-collect' });
  });

  // D-7226: the collector's synchronous reads with no try reject the job.
  const PROPAGATE: ReadonlyArray<readonly [string, (r: CollectRig) => CollectTempRootDeps]> = [
    ['viewers.isVisible', (r) => ({ ...r.deps, viewers: { isVisible: () => { throw new Error('presence gone'); } } })],
    ['lane.generations', (r) => ({ ...r.deps, lane: { ...r.deps.lane, generations: () => { throw new Error('presence gone'); } } })],
    ['lane.observation', (r) => ({ ...r.deps, lane: { ...r.deps.lane, observation: () => { throw new Error('presence gone'); } } })],
    ['link.epochNow', (r) => ({ ...r.deps, link: { ...r.deps.link, epochNow: () => { throw new Error('presence gone'); } } })],
  ];
  it.each(PROPAGATE)('temp-orphan: a throwing %s rejects the job: no outcome, no clear, no notice', async (_n, mk) => {
    const r = collectRigOf();
    await expect(collectTempRoot(mk(r), r.job())).rejects.toThrow('presence gone');
    expect(r.lane.clears).toEqual([]);
    expect(notifySpy).toHaveBeenCalledTimes(0);
  });

  it('temp-orphan: the judged readers answer no-document (the audit and the act fold a rejection)', async () => {
    const audit = collectRigOf();
    audit.deps.runCcd = async () => { throw new Error('link lost'); };
    expect(await collectTempRoot(audit.deps, audit.job())).toMatchObject({ kind: 'answered', step: 4, why: 'not-collectable',
      detail: 'ws-audit answered no-document', audit: { value: { kind: 'no-document', stderr: 'link lost' } } });
    const act = collectRigOf();
    const runCcd = act.deps.runCcd;
    act.deps.runCcd = async (argv) => { if (argv[0] === 'ws-collect') throw new Error('link lost'); return runCcd(argv); };
    expect(await collectTempRoot(act.deps, act.job())).toMatchObject({ kind: 'acted', result: { kind: 'no-document', stderr: 'link lost' } });
    // The hold folds a store throw (`store-unreadable`).
    const hold = collectRigOf({ coord: (real) => ({ run: (n) => real.run(n), bindingsOf: () => { throw new Error('locked'); } }) });
    expect(await collectTempRoot(hold.deps, hold.job())).toMatchObject({ kind: 'held', step: 4,
      hold: { why: 'store-unreadable', detail: 'the coordination database could not be read (locked)' } });
  });

  it('temp-orphan: the executor calls notify zero times, on every outcome (the lane folds the report)', async () => {
    for (const s of COLLECT_STEPS) {
      notifySpy.mockClear();
      const r = collectRigOf(s.opts);
      s.set(r);
      await collectTempRoot(r.deps, jobOf(r, s.step));
      expect(notifySpy, s.step).toHaveBeenCalledTimes(0);
    }
    const r = collectRigOf();
    expect(await collectTempRoot(r.deps, r.job())).toMatchObject({ kind: 'acted' });
    expect(notifySpy).toHaveBeenCalledTimes(0);
  });
});

const LOOSE_HEX = 'ab12';
const LOOSE_ID = `loose:${LOOSE_HEX}`;
/** A loose entry (D-6627) on the collector rig: the loose capability advertised, its marker raised unless `armed` is
 *  false, the audit and the verb answering the `--loose-hex` documents. */
const looseRig = (armed = true): CollectRig => {
  const r = collectRigOf({ caps: [...FULL_CAPS, COLLECT_LOOSE_CAP] });
  if (armed) r.raise(COLLECT_LOOSE_LIVE_MARKER);
  r.answerAudit(() => ok(JSON.stringify({ mode: 'collect-loose', name: LOOSE_HEX,
    collect: { class: 'loose', type: 'd', uid: 1000, records: [], newestCtimeNs: '1789990000000000000', entries: 3, floorS: 86400,
      idleAt: null, unmeasured: null }, verdict: 'collectable', detail: '', token: CTOK })));
  r.answerAct(() => ok(JSON.stringify({ collected: LOOSE_HEX, record: `${LOOSE_HEX}.1.1`, resumed: false, loose: true })));
  return r;
};

// ══ the difference table, and the callers (C4h b, c, k) ══════════════════════════════════════════════════════════════

/** Each reader of each reason's ladder and its rejection mode (D-7226; plan item 16), measured on the base: `propagate`
 *  (no try: the executor rejects, and the caller's own handling answers) or `judged` (a try, or a wrapper that folds the
 *  rejection: the step's own sentence). A pure read (the id predicate, `ccdCan` over the fleet state) rejects nothing
 *  and has no row. The `it`s above drive every row; this table names them, and the row below holds it to them. */
const READER_MODES: ReadonlyArray<{ readonly reason: 'child-spent' | 'archive-expired' | 'temp-orphan'; readonly reader: string;
  readonly mode: 'propagate' | 'judged' }> = [
  { reason: 'child-spent', reader: 'record re-read (readSessionRecord)', mode: 'propagate' },
  { reason: 'child-spent', reader: 'row re-listing (childReclaimRowListing)', mode: 'propagate' },
  { reason: 'child-spent', reader: 'sibling read (readChildSiblings)', mode: 'propagate' },
  { reason: 'child-spent', reader: '2a the coordination fence', mode: 'judged' },
  { reason: 'child-spent', reader: '2b the pause read', mode: 'judged' },
  { reason: 'child-spent', reader: "2b' the disabled read", mode: 'judged' },
  { reason: 'child-spent', reader: '2c the generation read', mode: 'judged' },
  { reason: 'child-spent', reader: 'presence (viewers.isVisible)', mode: 'propagate' },
  { reason: 'child-spent', reader: 'audit (childReclaimAudit)', mode: 'propagate' },
  { reason: 'child-spent', reader: '6 the disabled read at the act', mode: 'judged' },
  { reason: 'child-spent', reader: 'act (childReclaimAct)', mode: 'propagate' },
  { reason: 'archive-expired', reader: 'the switches (expirySwitches, both reads)', mode: 'judged' },
  { reason: 'archive-expired', reader: 'the store (readExpiryStore)', mode: 'judged' },
  { reason: 'archive-expired', reader: 'presence (viewers.isVisible)', mode: 'propagate' },
  { reason: 'archive-expired', reader: 'audit (expireAudit)', mode: 'propagate' },
  { reason: 'archive-expired', reader: 'act (expireAct)', mode: 'propagate' },
  { reason: 'temp-orphan', reader: 'the switches (collectSwitches, both reads)', mode: 'judged' },
  { reason: 'temp-orphan', reader: 'viewers.isVisible', mode: 'propagate' },
  { reason: 'temp-orphan', reader: 'the audit (collectAudit)', mode: 'judged' },
  { reason: 'temp-orphan', reader: 'lane.generations', mode: 'propagate' },
  { reason: 'temp-orphan', reader: 'lane.observation', mode: 'propagate' },
  { reason: 'temp-orphan', reader: 'the hold (collectOpenRunHold, both reads)', mode: 'judged' },
  { reason: 'temp-orphan', reader: 'link.epochNow', mode: 'propagate' },
  { reason: 'temp-orphan', reader: 'the act (ws-collect)', mode: 'judged' },
];

describe('the difference table (C4h b; plan item 2 and item 16)', () => {
  it('each reader\'s rejection mode, per reason: propagate or judged', () => {
    const by = (reason: string, mode: string): number => READER_MODES.filter((r) => r.reason === reason && r.mode === mode).length;
    expect([by('child-spent', 'propagate'), by('child-spent', 'judged')]).toEqual([6, 5]);
    expect([by('archive-expired', 'propagate'), by('archive-expired', 'judged')]).toEqual([3, 2]);
    expect([by('temp-orphan', 'propagate'), by('temp-orphan', 'judged')]).toEqual([4, 4]);
  });

  it('the listing mode: child-spent takes plain readdirs, one per marker; the other two ONE measured listing per read', async () => {
    const k = await childRig();
    await reclaimChild(k.deps, k.req);
    expect(spy.log.filter((l) => l === 'readdir')).toHaveLength(4);
    spy.log.length = 0;
    const x = await expiryRig();
    await expireArchived(x.deps, x.req);
    expect(spy.log.filter((l) => l === 'readdirMeasured' || l === 'readdir')).toEqual(['readdirMeasured', 'readdirMeasured']);
    const r = collectRigOf();
    const t = traced(r);
    await collectTempRoot(t.deps, r.job());
    expect(t.calls.filter((c) => c === 'listing')).toHaveLength(2);
  });

  it('the pause precondition (reclaim-pause-v1) is asked by temp-orphan only', async () => {
    const k = await childRig();
    expect(k.fleetState.ccdVerbs).not.toContain(RECLAIM_PAUSE_CAP);
    expect(await reclaimChild(k.deps, k.req)).toMatchObject({ kind: 'reclaimed' });
    const x = await expiryRig();
    expect(await expireArchived(x.deps, x.req)).toMatchObject({ kind: 'expired' });
    const r = collectRigOf({ caps: without(RECLAIM_PAUSE_CAP) });
    expect(await collectTempRoot(r.deps, r.job())).toMatchObject({ kind: 'not-asked', why: 'caps' });
  });

  it('the shadow arms: expire-lane-live at step 6, the collector\'s resolver at step 6, none for child-spent', async () => {
    const k = await childRig();
    expect(readdirSync(k.reg).some((n) => n.endsWith('-live'))).toBe(false);
    expect(await reclaimChild(k.deps, k.req)).toMatchObject({ kind: 'reclaimed' });
    const x = await expiryRig({ live: false });
    expect(await expireArchived(x.deps, x.req)).toMatchObject({ kind: 'would-expire' });
    const r = collectRigOf({ live: false, lastSeenLive: false });
    expect(await collectTempRoot(r.deps, r.job())).toMatchObject({ kind: 'would-collect' });
  });

  it('the after-act hook: child-spent tells the stale arm\'s coordinator after a reclaim; the other two have none', async () => {
    const k = await childRig({ stale: true });
    await reclaimChild(k.deps, k.req);
    expect(staleToldSpy).toHaveBeenCalledTimes(1);
    staleToldSpy.mockClear();
    const x = await expiryRig();
    await expireArchived(x.deps, x.req);
    const r = collectRigOf();
    await collectTempRoot(r.deps, r.job());
    expect(staleToldSpy).toHaveBeenCalledTimes(0);
  });
});

describe('the callers answer a rejecting executor in their own sentence (C4h c)', () => {
  it('archivedExpiryPass: "the expiry of <id> threw (…) — left for the next pass", and no recordExpireFeed', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    let clock = 1_790_000_000_000;
    vi.spyOn(Date, 'now').mockImplementation(() => clock);
    const home = mkTmp('ccrc-retire-pin-expiry-lane-');
    seedRoster(home);
    const reg = path.join(home, '.cc-sessions');
    mkdirSync(reg, { recursive: true });
    writeFileSync(path.join(reg, EXPIRE_LANE_LIVE_MARKER), '');
    const archivedAt = Math.floor(clock / 1000) - 8 * 86_400;
    const id = 'demo-old';
    const fields: Record<string, string> = { uuid: `u-${id}`, wrapper: 'claude', project: 'demo', workdir: `/w/${id}`, workspace: 'old',
      branch: `ws/${id}`, base: 'origin/main', started: '1', archived: String(archivedAt), archivedreason: 'operator' };
    for (const [f, v] of Object.entries(fields)) writeFileSync(path.join(reg, `${id}.${f}`), v);
    const cfg = loadConfig({ CCRC_HOME: home, CCRC_PROJECTS_ROOT: mkTmp('ccrc-retire-pin-projects-') } as never);
    const run: Runner = async (cmd, args) => {
      if (path.basename(cmd) === 'tmux') return { ran: true, code: 1, stdout: '', stderr: '' };
      if (args[0] === 'ws-audit') {
        return ok(JSON.stringify({ session: id, mode: 'expire', archivedAt, expiresAt: archivedAt + 604_800, alive: false, exists: true,
          reaping: null, sensitive: [], verdict: 'expirable', token: XTOK, detail: '' }));
      }
      if (args[0] === 'ws-expire') throw new Error('EIO: ws-expire lost its link');
      return { ran: true, code: 1, stdout: '', stderr: '' };
    };
    const coord = new CoordStore(openCoordDb(path.join(home, '.ccrc', 'coord.db')));
    const notifyLog = new NotifyLog(path.join(home, '.ccrc', 'notify.json'));
    await notifyLog.load();
    const deps = { ...testDeps(home, run), cfg, coord, notifyLog, monotonicMs: () => clock,
      fleetState: caps(EXPIRY_CAPS), viewers: { isVisible: () => false } };
    const watcher = new FleetWatcher(deps as never, new Bus(), 10_000);
    const pass = async (): Promise<void> => { await watcher.sweepArchivedExpiry(await readRegistry(deps.io, cfg), readdirSync(reg)); };
    for (let i = 0; i < 4; i += 1) { await pass(); clock += CHILD_RECLAIM_SWEEP_MS + 1; }
    const line = warn.mock.calls.map(([m]) => String(m)).find((m) => m.includes(`the expiry of ${id} threw`));
    expect(line).toBe(`ccrc-server: sweepArchivedExpiry: the expiry of ${id} threw (EIO: ws-expire lost its link) — left for the next pass`);
    expect(coord.feedEvents(50).filter((e) => e.title.startsWith('archived workspace'))).toEqual([]);
  });

  it("collectAct: a job that rejects is folded as threw, read as one that may have acted", async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const f = await collectLaneRig();
    f.pastHoldOff(); await f.goLive();
    f.witness('demo-a');
    f.next(); await f.pass(); await f.settled();
    let thrown = false;
    f.setVisible((id) => { if (id === 'demo-a' && !thrown) { thrown = true; throw new Error('presence gone'); } return false; });
    f.next(); await f.pass(); await f.settled();
    expect(thrown).toBe(true);
    expect(f.collects('demo-a')).toEqual([]);
    expect(f.lane().slot).toMatchObject({ kind: 'kept', id: 'demo-a' });
    expect(warn.mock.calls.map(([m]) => String(m)).some((m) => m.includes("the collector's job for demo-a threw (presence gone) — read as one that may have acted"))).toBe(true);
  });
});

describe('the close route (C4h k; D-7228)', () => {
  /** A server on a fixture HOME whose one run minted `demo-a` and is abandoned through the route: the close hand-off
   *  queues the reclaim on the session's own key. `answer` scripts ccd's `ws-audit --reclaim`. */
  const closeRig = async (answer: (args: readonly string[]) => Scripted) => {
    const home = mkTmp('ccrc-retire-pin-close-');
    const reg = path.join(home, '.cc-sessions');
    mkdirSync(reg, { recursive: true });
    let runId = 0;
    const verbs: string[] = [];
    const run: Runner = async (_cmd, args) => {
      verbs.push(args[0] ?? '');
      const a = args[0] === 'ws-audit' && args.includes('--reclaim') ? answer(args)
        : args[0] === 'ws-reclaim' ? ok(JSON.stringify({ reclaimed: KID, wip: null })) : ok('');
      if (a === 'reject') throw new Error('EIO: ws-audit lost its link');
      return a;
    };
    const coord = new CoordStore(openCoordDb(path.join(home, '.ccrc', 'coord.db')));
    const queue = new KeyedQueue();
    const notifyLog = new NotifyLog(path.join(home, '.ccrc', 'notify.json'));
    await notifyLog.load();
    const base = testDeps(home, run);
    const app = await buildServer({ ...base, coord, queue, notifyLog,
      fleetState: caps(['reclaim-v1', 'ws-audit', 'ws-reclaim', 'ws-release', 'ws-hold']) });
    const opened = coord.openRun({ program: 'w-close', title: 'w-close', project: 'demo', wave: 1, waveOf: null, claimedBy: 'demo-coord' });
    if (!('id' in opened)) throw new Error(`openRun refused: ${JSON.stringify(opened)}`);
    runId = opened.id;
    coord.markDispatched(runId, KID, KID, `ws/${KID}`, false);
    const fields: Record<string, string> = { uuid: 'u-demo-a', wrapper: 'claude', project: 'demo', workdir: '/w/demo-a', workspace: 'a',
      branch: `ws/${KID}`, base: 'origin/main', started: '1', child: String(runId) };
    for (const [f, v] of Object.entries(fields)) writeFileSync(path.join(reg, `${KID}.${f}`), v);
    return { app, coord, queue, reg, verbs, runId: () => runId, home };
  };

  it('a throw answers the route\'s .catch sentence: "the reclaim of <id> threw (…) — left to the sweep"', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const c = await closeRig(() => 'reject');
    try {
      const res = await c.app.inject({ method: 'POST', url: `/api/runs/${c.runId()}/abandon` });
      expect(res.json()).toMatchObject({ ok: true, childReclaim: 'queued' });
      await c.queue.run(KID, async () => undefined);
      await new Promise((r) => setImmediate(r));
      expect(warn.mock.calls.map(([m]) => String(m))).toContain(
        `ccrc-server: the reclaim of ${KID} threw (EIO: ws-audit lost its link) — left to the sweep`);
      expect(c.verbs.filter((v) => v === 'ws-reclaim')).toEqual([]);
      expect(c.coord.feedEvents(50).filter((e) => e.title.startsWith('child reclaim'))).toEqual([]);
    } finally { await c.app.close(); }
  });

  it('childReclaimUnlessDisabled runs first: a raised child-reclaim-disabled composes nothing, and a clear one reaches the executor', async () => {
    const off = await closeRig(() => ok(JSON.stringify({ id: KID, mode: 'reclaim', verdict: 'held', detail: '' })));
    try {
      writeFileSync(path.join(off.reg, CHILD_RECLAIM_DISABLED_MARKER), '');
      const res = await off.app.inject({ method: 'POST', url: `/api/runs/${off.runId()}/abandon` });
      expect(res.json()).toMatchObject({ ok: true, childReclaim: 'queued' });
      await off.queue.run(KID, async () => undefined);
      expect(off.verbs.filter((v) => v === 'ws-audit' || v === 'ws-reclaim')).toEqual([]);
      expect(off.coord.feedEvents(50).map((e) => e.title)).toContain('child reclaim switched off');
    } finally { await off.app.close(); }
    const on = await closeRig(() => ok(JSON.stringify({ id: KID, mode: 'reclaim', verdict: 'held', detail: 'a hold stands' })));
    try {
      await on.app.inject({ method: 'POST', url: `/api/runs/${on.runId()}/abandon` });
      await on.queue.run(KID, async () => undefined);
      expect(on.verbs.filter((v) => v === 'ws-audit' || v === 'ws-reclaim')).toEqual(['ws-audit']);
      expect(on.coord.feedEvents(50).map((e) => e.title)).toContain('child reclaim deferred');
    } finally { await on.app.close(); }
  });

  it('type FIXTURE: the close route\'s job answers Promise<void>, not a ChildReclaimOutcome', () => {
    expectTypeOf(childReclaimUnlessDisabled).returns.toEqualTypeOf<Promise<void>>();
    expectTypeOf(reclaimChild).returns.toEqualTypeOf<Promise<ChildReclaimOutcome>>();
    expectTypeOf<ReturnType<typeof childReclaimUnlessDisabled>>().not.toEqualTypeOf<Promise<ChildReclaimOutcome>>();
  });
});


// ══ decideRetire: the one gate decider over C4h's matrix (C4i; D-7166) ══════════════════════════════════════════════
//
// APPENDED by C4i; nothing above is edited. Each reason's row (`CHILD_SPENT_RETIRE`, `ARCHIVE_EXPIRED_RETIRE`,
// `TEMP_ORPHAN_RETIRE`) is driven by `decideRetire` over the facts this file's own readers take from a rig built exactly
// as the executor's twin rig is (each C4h matrix row's `opts` and `set` on both). The readers are built from the
// executors' public faces (a private read is composed here from the same exported pieces); they are this suite's
// oracle, not the ports C4k to C4m write. Each row must equal its old executor: the same outcome (word and detail, byte
// for byte), and a `need` sequence whose reads, as the rig records them, are the executor's reads in the executor's
// order up to its act. A row that answers `{ act: true }` must stand where the executor composed its verb.
import {
  RETIRE_LISTING_MODES, RETIRE_NOTICE_HOMES, RETIRE_PRESENCE_RULES, RETIRE_REASON_NAMES, RETIRE_STEPS, RetireRejected,
  decideRetire, type RetireDecision, type RetireFactSet, type RetireReason, type RetireReasonName, type RetireStep,
} from '../src/retire.js';
import {
  CHILD_SPENT_RETIRE, childReclaimGenerationRead, childReclaimHasCoordinated, childReclaimRowListing, childReclaimRowUuid,
  parseChildReclaimAudit, parseChildReclaimAuditFailed, type ChildSpentFacts,
} from '../src/coord/childReclaim.js';
import { readSessionRecord } from '../src/registry.js';
import { readChildSiblings } from '../src/coord/siblingRead.js';
import { CHILD_RECLAIM_DISABLED_UNREAD_SENTENCE, childReclaimDisabledSentence } from '../src/coord/childReclaimDisabled.js';
import { ARCHIVE_EXPIRED_RETIRE, readExpiryStore, type ArchiveExpiredFacts, type ExpireArchivedRequest } from '../src/coord/expireArchived.js';
import { parseExpireAudit } from '../src/archivedExpiry.js';
import {
  TEMP_ORPHAN_RETIRE, collectControlNow, collectOpenRunHold, collectRetireLatch, type CollectJob, type TempOrphanFacts,
} from '../src/coord/collectTempRoot.js';
import {
  collectLaneEffective, collectLicence, collectLooseHexOf, parseCollectAudit, parseCollectLooseAudit,
  type CollectLaneSettled,
} from '../src/collectLane.js';
import { CCD_ARGV, capSupported, ccdCan } from '../src/ccdargv.js';
import { notRanSentence } from '../src/unmeasured.js';
import type { MarkerState } from '../../shared/api.js';
import type { CcdResult } from '../src/lifecycle.js';
import type { MeasuredDirectoryRead } from '../src/io.js';

/** One reader per step of a row, over the facts read before it. */
type Readers<F> = { readonly [S in RetireStep]?: (facts: F) => unknown };
interface Driven<Out> { readonly decision: RetireDecision<Out>; readonly needs: readonly RetireStep[]; readonly facts: Record<string, unknown> }

/** A row's `sync` flag disagreeing with what its step's reader answered. */
class SyncFlagMismatch extends Error {}
/** A `sync: false` step whose reader may answer a plain value: child-spent's generation read, which the ladder skips
 *  (no read, no await) for a request whose licence generation is `none` (close's requests). Its reader answers `null`
 *  then. No other step is excused. */
const CONDITIONAL_READS: ReadonlyArray<readonly [RetireReasonName, RetireStep]> = [[RETIRE_REASON_NAMES.childSpent, RETIRE_STEPS.generation]];
/** The loop the decider is asked through (`retireAct`'s rules, D-7226): read the step it needs, a promise awaited and a
 *  plain value never; a `judged` step's rejection becomes its fact, any other propagates. The row's `sync` flag is held
 *  to the reader's answer: a `sync: true` reader answering a promise, or a `sync: false` reader answering a plain value
 *  (outside `CONDITIONAL_READS`' skipped read), fails the drive, so a wrong flag cannot pass through it. */
const drive = async <Req, F extends RetireFactSet, Out>(row: RetireReason<Req, F, Out>, req: Req, read: Readers<F>): Promise<Driven<Out>> => {
  const facts: Record<string, unknown> = {};
  const needs: RetireStep[] = [];
  const specs = [...row.decide, row.audit, ...row.act];
  for (;;) {
    const d = decideRetire(facts as F, row, req);
    if (!('need' in d)) return { decision: d, needs, facts };
    needs.push(d.need);
    const spec = specs.find((s) => s.step === d.need);
    const reader = read[d.need];
    if (spec === undefined || reader === undefined) throw new Error(`no reader for ${d.need}`);
    let v: unknown;
    try {
      v = reader(facts as F);
    } catch (err) {
      if (spec.onReject !== 'judged') throw err;
      facts[d.need] = new RetireRejected(err);
      continue;
    }
    if (spec.sync && v instanceof Promise) {
      v.catch(() => undefined);
      throw new SyncFlagMismatch(`${row.name}: step ${d.need} is sync: true, and its reader answered a promise`);
    }
    if (!spec.sync && !(v instanceof Promise)
      && !(v === null && CONDITIONAL_READS.some(([n, s]) => n === row.name && s === d.need))) {
      throw new SyncFlagMismatch(`${row.name}: step ${d.need} is sync: false, and its reader answered a plain value`);
    }
    try {
      facts[d.need] = v instanceof Promise ? await v : v;
    } catch (err) {
      if (spec.onReject !== 'judged') throw err;
      facts[d.need] = new RetireRejected(err);
    }
  }
};
const said = (err: unknown): string => (err instanceof Error ? err.message : String(err));
const stepsOf = (row: RetireReason<never, RetireFactSet, unknown>): RetireStep[] => [...row.decide, row.audit, ...row.act].map((s) => s.step);

// ── child-spent's readers ──────────────────────────────────────────────────────────────────────────────────────────────

/** The store's two reads, recorded in the order log too (the sibling read and the coordination fence). */
const logChildStore = (k: ChildRig): void => {
  const b = k.coord.bindingsOf.bind(k.coord);
  k.coord.bindingsOf = ((id: string) => { spy.log.push('store'); return b(id); }) as typeof k.coord.bindingsOf;
  const c = k.coord.childReclaimCoordinatorClaims.bind(k.coord);
  k.coord.childReclaimCoordinatorClaims = ((...a: Parameters<typeof c>) => { spy.log.push('claims'); return c(...a); }) as typeof c;
};
const childDisabledDetail = async (k: ChildRig, when: string): Promise<string | null> => {
  let state: MarkerState;
  try { state = await childReclaimDisabledRead(k.deps.io, k.deps.cfg.registryDir); } catch (err) {
    return `${CHILD_RECLAIM_DISABLED_UNREAD_SENTENCE}${when} (${said(err)})`;
  }
  if (state === 'set') return childReclaimDisabledSentence(when);
  return state === 'clear' ? null : `${CHILD_RECLAIM_DISABLED_UNREAD_SENTENCE}${when}`;
};
const childReaders = (k: ChildRig): Readers<ChildSpentFacts> => {
  const { deps, req } = k;
  const now = (): number => (deps.now ?? Date.now)();
  return {
    [RETIRE_STEPS.record]: async () => {
      const read = await readSessionRecord(deps.io, deps.cfg, req.sessionId);
      return read.kind === 'absent' || read.kind === 'unmeasurable'
        ? { read, again: await childReclaimRowListing(deps, req.sessionId) } : { read };
    },
    [RETIRE_STEPS.store]: () => readChildSiblings(deps, req.sessionId, now()),
    [RETIRE_STEPS.coordinated]: (f) => {
      const r = f[RETIRE_STEPS.record]?.read;
      if (r?.kind !== 'found') throw new Error('the fence read before a found record');
      return childReclaimHasCoordinated(deps.coord, req.sessionId, now(), childReclaimRowUuid(r.record));
    },
    [RETIRE_STEPS.switches]: () => childReclaimPauseRead(deps.io, deps.cfg.registryDir),
    [RETIRE_STEPS.offSwitch]: () => childDisabledDetail(k, ''),
    [RETIRE_STEPS.generation]: () => (req.licenceGeneration.kind === 'none' ? null
      : childReclaimGenerationRead(deps.io, deps.cfg.registryDir, req.sessionId)),
    [RETIRE_STEPS.presence]: () => !req.deferExpired && deps.viewers?.isVisible(req.sessionId) === true,
    [RETIRE_STEPS.capability]: () => [ccdCan(deps.fleetState, 'wsReclaim'),
      req.stale === undefined || capSupported(deps.fleetState, RECLAIM_STALE_CAP)],
    [RETIRE_STEPS.audit]: async () => {
      const argv = CCD_ARGV.wsReclaimAudit(req.sessionId, req.deferExpired, req.stale);
      if (!ccdCan(deps.fleetState, 'wsReclaimAudit')) return { kind: 'unreadable', detail: 'the fleet host cannot answer ws-audit' };
      const res = await deps.runCcd(argv);
      if (res.ran === false) return { kind: 'unreadable', detail: notRanSentence(argv[0] ?? 'ccd', res) };
      if (!res.ok) return parseChildReclaimAuditFailed(req.sessionId, res.stdout, res.stderr);
      return parseChildReclaimAudit(req.sessionId, res.stdout);
    },
    [RETIRE_STEPS.auditVerdict]: () => true,
    [RETIRE_STEPS.markerMatch]: () => true,
    [RETIRE_STEPS.auditGeneration]: () => true,
    [RETIRE_STEPS.offSwitchLast]: () => childDisabledDetail(k, ' at the act'),
  };
};
const CHILD_READS = (l: string): boolean => l === 'readdir' || l === 'generation' || l === 'presence' || l === 'store' || l === 'claims'
  || l.startsWith('argv:');
/** The executor on one rig and the decider on its twin, each rig built by `make`: both outcomes, both read logs (each
 *  up to the act's argv). */
const childTwins = async (make: () => Promise<ChildRig>) => {
  spy.log.length = 0;
  const a = await make();
  logChildStore(a);
  let exec: { ok: true; out: ChildReclaimOutcome } | { ok: false; err: string };
  try { exec = { ok: true, out: await reclaimChild(a.deps, a.req) }; } catch (err) { exec = { ok: false, err: said(err) }; }
  const all = spy.log.filter(CHILD_READS);
  const acted = all.includes('argv:ws-reclaim');
  const execReads = acted ? all.slice(0, all.indexOf('argv:ws-reclaim')) : all;
  spy.log.length = 0;
  const b = await make();
  logChildStore(b);
  let dec: { ok: true; d: Driven<ChildReclaimOutcome> } | { ok: false; err: string };
  try { dec = { ok: true, d: await drive(CHILD_SPENT_RETIRE, b.req, childReaders(b)) }; } catch (err) { dec = { ok: false, err: said(err) }; }
  const decReads = spy.log.filter(CHILD_READS);
  spy.log.length = 0;
  return { a, b, exec, acted, execReads, dec, decReads };
};
const childRow = async (opts: ChildOpts | undefined, set: (k: ChildRig) => void) => {
  const t = await childTwins(async () => { const k = await childRig(opts); set(k); return k; });
  expect(t.decReads, 'the decider\'s reads are the executor\'s, in its order').toEqual(t.execReads);
  if (!t.exec.ok || !t.dec.ok) {
    expect(t.dec.ok ? 'answered' : t.dec.err, 'both reject, with one error').toBe(t.exec.ok ? 'answered' : t.exec.err);
    return { ...t, outcome: null };
  }
  if (t.acted) {
    expect(t.dec.d.decision, 'the executor composed its verb: the gate lets the act run').toEqual({ act: true });
    return { ...t, outcome: null };
  }
  expect(t.dec.d.decision).toEqual({ outcome: t.exec.out });
  return { ...t, outcome: t.exec.out };
};

describe('decideRetire: child-spent over C4h\'s matrix (C4i; D-7166)', () => {
  it.each(CHILD_STEPS.map((s) => [s.step, s] as const))('child-spent: the deferral at step %s alone answers its own word and detail', async (_n, s) => {
    const t = await childRow(s.opts, s.set);
    expect(t.outcome).toEqual(s.want(t.b));
  });

  it('child-spent: every pair standing together answers the earlier step', async () => {
    const pairs: ReadonlyArray<readonly [number, number]> = [[1, 3], [3, 4], [4, 5], [5, 6], [6, 7], [7, 8], [8, 9], [9, 10], [10, 11], [14, 15]];
    for (const [i, j] of pairs) {
      const first = CHILD_STEPS[i]!; const second = CHILD_STEPS[j]!;
      const t = await childRow({ ...second.opts, ...first.opts }, (k) => { second.set(k); first.set(k); });
      expect(t.outcome, `${first.step} beside ${second.step}`).toEqual(first.want(t.b));
    }
  });

  it('child-spent: presence defers only until its ceiling (decider suite)', async () => {
    const t = await childRow({ deferExpired: true }, (k) => { k.see(true); });
    expect(t.dec.ok && t.dec.d.decision).toEqual({ act: true });
    // The rule itself, over facts: a person looking defers a request below its ceiling and passes one past it.
    const k = await childRig();
    const facts = (await drive(CHILD_SPENT_RETIRE, k.req, childReaders(k))).facts;
    const seen = { ...facts, [RETIRE_STEPS.presence]: true } as ChildSpentFacts;
    expect(decideRetire(seen, CHILD_SPENT_RETIRE, k.req)).toEqual({ outcome: deferredC(k, 'presence', 'someone is viewing this session') });
    expect(decideRetire(seen, CHILD_SPENT_RETIRE, { ...k.req, deferExpired: true })).toEqual({ act: true });
    expect(CHILD_SPENT_RETIRE.presence).toBe(RETIRE_PRESENCE_RULES.untilCeiling);
  });

  it('child-spent: a raised pause says automatic reclamation is paused', async () => {
    const t = await childRow(undefined, (k) => { k.raise(RECLAIM_PAUSE_MARKER); });
    expect(t.outcome).toEqual(deferredC(t.b, 'paused-at-server', 'reclaim-paused is raised: automatic reclamation is paused fleet-wide'));
    const u = await childRow(undefined, (k) => { k.hooks.listing = (n) => (n === 2 ? 'null' : undefined); });
    expect(u.outcome, 'the unmeasurable reading').toEqual(deferredC(u.b, 'paused-at-server',
      'the registry did not list, so a raised reclaim-paused cannot be ruled out'));
  });

  it('child-spent: a rejecting pause read answers its own sentence (decider suite: the judged steps)', async () => {
    const judged: ReadonlyArray<readonly [ChildOpts, (k: ChildRig) => void, (k: ChildRig) => ChildReclaimOutcome]> = [
      [{}, (k) => { k.coord.childReclaimCoordinatorClaims = () => { throw new Error('history unreadable'); }; },
        (k) => deferredC(k, 'siblings-unreadable', `whether ${KID} has coordinated a run could not be read (history unreadable)`)],
      [{}, (k) => { k.hooks.listing = (n) => (n === 2 ? 'reject' : undefined); },
        (k) => deferredC(k, 'paused-at-server', 'whether reclaim-paused is raised could not be read (EIO: the registry listing failed)')],
      [{}, (k) => { k.hooks.listing = (n) => (n === 3 ? 'reject' : undefined); },
        (k) => deferredC(k, 'paused-at-server', 'the registry did not list, so a set child-reclaim-disabled cannot be ruled out (EIO: the registry listing failed)')],
      [{ licence: 'g1' }, (k) => { k.hooks.generation = () => 'reject'; },
        (k) => deferredC(k, 'marker-unreadable', `${KID}.generation could not be read (EIO: the generation read failed), so which workspace stands under this name cannot be said`)],
      [{}, (k) => { k.hooks.listing = (n) => (n === 4 ? 'reject' : undefined); },
        (k) => deferredC(k, 'paused-at-server', 'the registry did not list, so a set child-reclaim-disabled cannot be ruled out at the act (EIO: the registry listing failed)')],
    ];
    for (const [opts, set, want] of judged) {
      const t = await childRow(opts, set);
      expect(t.outcome).toEqual(want(t.b));
    }
  });

  it('child-spent: a rejecting propagate read rejects, and the decider never judges it', async () => {
    const propagate: ReadonlyArray<readonly [(k: ChildRig) => void, string]> = [
      [(k) => { k.hooks.listing = (n) => (n === 1 ? 'reject' : undefined); }, 'EIO: the registry listing failed'],
      [(k) => { k.drop('uuid'); k.hooks.listing = (n) => (n === 2 ? 'reject' : undefined); }, 'EIO: the registry listing failed'],
      [(k) => { k.coord.bindingsOf = () => { throw new Error('the store is locked'); }; }, 'the store is locked'],
      [(k) => { k.presenceThrows(); }, 'presence gone'],
      [(k) => { k.answers.audit = () => 'reject'; }, 'EIO: ws-audit lost its link'],
    ];
    for (const [set, msg] of propagate) {
      const t = await childRow(undefined, set);
      expect(t.dec.ok ? 'answered' : t.dec.err).toBe(msg);
    }
    // A rejected fact handed to a propagate step is thrown, never judged.
    const k = await childRig();
    const facts = (await drive(CHILD_SPENT_RETIRE, k.req, childReaders(k))).facts;
    const boom = new Error('EIO: presence lost');
    expect(() => decideRetire({ ...facts, [RETIRE_STEPS.presence]: new RetireRejected(boom) } as unknown as ChildSpentFacts, CHILD_SPENT_RETIRE, k.req)).toThrow(boom);
  });

  it('child-spent: gone has three sources — the record step, the audit\'s verdict and the act — and the gate answers the first two', async () => {
    const record = await childRow(undefined, (k) => { k.drop('uuid'); k.drop('child'); });
    expect(record.outcome).toEqual({ kind: 'gone', sessionId: KID });
    expect(record.dec.ok && record.dec.d.needs).toEqual([RETIRE_STEPS.record]);
    const audit = await childRow(undefined, (k) => { k.answers.audit = () => k.auditDoc({ verdict: 'no-such-session', detail: '' }); });
    expect(audit.outcome).toEqual({ kind: 'gone', sessionId: KID });
    expect(audit.dec.ok && audit.dec.d.needs.at(-1)).toBe(RETIRE_STEPS.auditVerdict);
    const act = await childRow(undefined, (k) => { k.answers.act = () => k.actDoc({ refused: 'no-such-session', detail: '' }); });
    expect(act.dec.ok && act.dec.d.decision, 'the act\'s own refusal is the act\'s, past the gate').toEqual({ act: true });
  });

  it('child-spent: held at the act — the off switch at the act, the audit\'s generation, and today\'s gap (reclaim-paused read once)', async () => {
    const off = await childRow(undefined, (k) => { k.hooks.audit = () => { k.raise(CHILD_RECLAIM_DISABLED_MARKER); }; });
    expect(off.outcome).toEqual(deferredC(off.b, 'paused-at-server', 'child-reclaim-disabled is set at the act: child reclaim is switched off'));
    const gen = await childRow({ licence: 'g1' }, (k) => {
      k.hooks.audit = () => { writeFileSync(path.join(k.reg, `${KID}.generation`), G2); };
      k.answers.audit = () => k.auditDoc({ childOf: k.runId, verdict: 'reclaimable', token: KTOK, generation: G2 });
    });
    expect(gen.outcome).toMatchObject({ kind: 'deferred', why: 'generation-changed' });
    const gap = await childRow(undefined, (k) => { k.hooks.audit = () => { k.raise(RECLAIM_PAUSE_MARKER); }; });
    expect(gap.dec.ok && gap.dec.d.decision, 'C4o flips this row').toEqual({ act: true });
    const stale = await childRow({ stale: true }, () => {});
    expect(stale.dec.ok && stale.dec.d.decision).toEqual({ act: true });
  });
});

// ── archive-expired's readers ──────────────────────────────────────────────────────────────────────────────────────────

const logExpiryStore = (x: ExpiryRig): void => {
  const b = x.coord.bindingsOf.bind(x.coord);
  x.coord.bindingsOf = ((id: string) => { spy.log.push('store'); return b(id); }) as typeof x.coord.bindingsOf;
};
/** `expirySwitches`' answer, composed from the public `collectSwitches` (the one measured listing, its pause and its
 *  failure reason) and the names that listing returned: the expiry markers are read off the same listing. */
const expirySwitchesOf = async (x: ExpiryRig) => {
  let names: readonly string[] = [];
  const io = { readdirMeasured: async (p: string): Promise<MeasuredDirectoryRead> => {
    const r = await x.deps.io.readdirMeasured(p);
    if (r.ok) names = r.entries;
    return r;
  } };
  const s = await collectSwitches(io, x.deps.cfg.registryDir);
  if (s.paused) {
    return { kind: 'paused' as const, detail: s.why === 'raised' ? 'reclaim-paused is raised: cleanup is paused fleet-wide'
      : `the registry did not list (${s.reason ?? 'unreadable'}), so a raised reclaim-paused cannot be ruled out` };
  }
  return { kind: 'clear' as const, live: expireLaneLive(names), childLive: names.includes(EXPIRE_CHILD_LIVE_MARKER) };
};
const expiryReaders = (x: ExpiryRig): Readers<ArchiveExpiredFacts> => {
  const { deps } = x;
  const req: ExpireArchivedRequest = x.req;
  return {
    [RETIRE_STEPS.id]: () => req.sessionId,
    [RETIRE_STEPS.capability]: () => [ccdCan(deps.fleetState, 'wsExpire'),
      req.childOf === undefined || capSupported(deps.fleetState, EXPIRE_CHILD_CAP)],
    [RETIRE_STEPS.switches]: () => expirySwitchesOf(x),
    [RETIRE_STEPS.store]: () => readExpiryStore(deps.coord, req.sessionId, req.childOf === undefined ? undefined : { rowUuid: req.rowUuid ?? null }),
    [RETIRE_STEPS.presence]: () => deps.viewers?.isVisible(req.sessionId) === true,
    [RETIRE_STEPS.audit]: async () => {
      const argv = CCD_ARGV.wsExpireAudit(req.sessionId, req.childOf);
      if (!ccdCan(deps.fleetState, 'wsExpireAudit')) return { kind: 'unreadable', detail: 'the fleet host cannot answer ws-audit' };
      const res = await deps.runCcd(argv);
      if (res.ran === false) return { kind: 'unreadable', detail: notRanSentence(argv[0] ?? 'ccd', res) };
      return parseExpireAudit(req.sessionId, res.ok, res.stdout);
    },
    [RETIRE_STEPS.archiveMatch]: () => true,
    [RETIRE_STEPS.auditVerdict]: () => true,
    [RETIRE_STEPS.switchesLast]: () => expirySwitchesOf(x),
    [RETIRE_STEPS.live]: () => true,
  };
};
const EXPIRY_READS = (l: string): boolean => l === 'readdirMeasured' || l === 'readdir' || l === 'presence' || l === 'store' || l.startsWith('argv:');
const expiryRow = async (opts: Parameters<typeof expiryRig>[0], set: (x: ExpiryRig) => void) => {
  spy.log.length = 0;
  const a = await expiryRig(opts);
  set(a); logExpiryStore(a);
  let exec: { ok: true; out: unknown } | { ok: false; err: string };
  try { exec = { ok: true, out: await expireArchived(a.deps, a.req) }; } catch (err) { exec = { ok: false, err: said(err) }; }
  const all = spy.log.filter(EXPIRY_READS);
  const acted = all.includes('argv:ws-expire');
  const execReads = acted ? all.slice(0, all.indexOf('argv:ws-expire')) : all;
  spy.log.length = 0;
  const b = await expiryRig(opts);
  set(b); logExpiryStore(b);
  let dec: { ok: true; d: Driven<unknown> } | { ok: false; err: string };
  try { dec = { ok: true, d: await drive(ARCHIVE_EXPIRED_RETIRE, b.req, expiryReaders(b)) }; } catch (err) { dec = { ok: false, err: said(err) }; }
  const decReads = spy.log.filter(EXPIRY_READS);
  spy.log.length = 0;
  expect(decReads, 'the decider\'s reads are the executor\'s, in its order').toEqual(execReads);
  if (!exec.ok || !dec.ok) {
    expect(dec.ok ? 'answered' : dec.err, 'both reject, with one error').toBe(exec.ok ? 'answered' : exec.err);
    return { exec, dec, b, outcome: null as unknown };
  }
  if (acted) {
    expect(dec.d.decision, 'the executor composed its verb: the gate lets the act run').toEqual({ act: true });
    return { exec, dec, b, outcome: null as unknown };
  }
  expect(dec.d.decision).toEqual({ outcome: exec.out });
  return { exec, dec, b, outcome: exec.out };
};

describe('decideRetire: archive-expired over C4h\'s matrix (C4i; D-7166)', () => {
  it.each(EXPIRY_STEPS.map((s) => [s.step, s] as const))('archive-expired: the deferral at step %s alone answers its own word and detail', async (_n, s) => {
    expect((await expiryRow(s.opts, s.set)).outcome).toEqual(s.want);
  });

  it('archive-expired: every pair standing together answers the earlier step (the id before the capability)', async () => {
    const pairs: ReadonlyArray<readonly [number, number]> = [[0, 1], [1, 2], [2, 3], [3, 4], [4, 5], [8, 9]];
    for (const [i, j] of pairs) {
      const first = EXPIRY_STEPS[i]!; const second = EXPIRY_STEPS[j]!;
      const t = await expiryRow({ ...second.opts, ...first.opts }, (x) => { second.set(x); first.set(x); });
      expect(t.outcome, `${first.step} beside ${second.step}`).toEqual(first.want);
    }
  });

  it('archive-expired: presence defers with no ceiling (decider suite)', async () => {
    expect((await expiryRow(undefined, (x) => { x.see(true); })).outcome).toMatchObject({ kind: 'deferred', why: 'presence' });
    expect(ARCHIVE_EXPIRED_RETIRE.presence).toBe(RETIRE_PRESENCE_RULES.noCeiling);
  });

  it('archive-expired: an unlistable registry names its reason (decider suite)', async () => {
    for (const n of [1, 2]) {
      for (const reason of ['unreadable', 'absent'] as const) {
        const t = await expiryRow(undefined, (x) => { x.hooks.listing = (k) => (k === n ? reason : undefined); });
        expect(t.outcome, `listing ${n}, ${reason}`).toEqual(answeredX({ kind: 'deferred', why: 'paused-at-server',
          detail: `the registry did not list (${reason}), so a raised reclaim-paused cannot be ruled out` }));
      }
      const r = await expiryRow(undefined, (x) => { x.hooks.listing = (k) => (k === n ? 'reject' : undefined); });
      expect(r.outcome, `listing ${n}, rejecting`).toEqual(answeredX({ kind: 'deferred', why: 'paused-at-server',
        detail: 'the registry did not list (unreadable), so a raised reclaim-paused cannot be ruled out' }));
    }
  });

  it('archive-expired: one listing reads both switches (decider suite)', async () => {
    expect(ARCHIVE_EXPIRED_RETIRE.listing).toBe(RETIRE_LISTING_MODES.measuredOnce);
    const listing = [...ARCHIVE_EXPIRED_RETIRE.decide, ...ARCHIVE_EXPIRED_RETIRE.act].filter((s) => s.markers !== undefined);
    expect(listing.map((s) => [s.step, s.markers])).toEqual([
      [RETIRE_STEPS.switches, [RECLAIM_PAUSE_MARKER, EXPIRE_LANE_LIVE_MARKER, EXPIRE_CHILD_LIVE_MARKER]],
      [RETIRE_STEPS.switchesLast, [RECLAIM_PAUSE_MARKER, EXPIRE_LANE_LIVE_MARKER, EXPIRE_CHILD_LIVE_MARKER]],
    ]);
    // One measured listing per listing step, as the executor takes them.
    const t = await expiryRow(undefined, () => {});
    expect(t.dec.ok && t.dec.d.decision).toEqual({ act: true });
  });

  it('archive-expired: a rejecting audit rejects the executor (decider suite)', async () => {
    for (const [set, msg] of [
      [(x: ExpiryRig) => { x.answers.audit = () => 'reject'; }, 'EIO: ws-audit lost its link'],
      [(x: ExpiryRig) => { x.presenceThrows(); }, 'presence gone'],
    ] as const) {
      const t = await expiryRow(undefined, set);
      expect(t.dec.ok ? 'answered' : t.dec.err).toBe(msg);
    }
    expect(ARCHIVE_EXPIRED_RETIRE.audit.onReject).toBe('propagate');
  });

  it('a pause raised during the act holds: archive-expired (decider suite; and expire-lane-live removed answers would-expire)', async () => {
    const paused = await expiryRow(undefined, (x) => { x.hooks.audit = () => { x.raise(RECLAIM_PAUSE_MARKER); }; });
    expect(paused.outcome).toEqual(answeredX({ kind: 'deferred', why: 'paused-at-server', detail: 'reclaim-paused is raised: cleanup is paused fleet-wide' }));
    const shadow = await expiryRow(undefined, (x) => { x.hooks.audit = () => { x.lower(EXPIRE_LANE_LIVE_MARKER); }; });
    expect(shadow.outcome).toEqual(answeredX({ kind: 'would-expire', sensitive: 0 }));
  });

  it('archive-expired: the child arm (its capability at decide, expire-child-live deciding its shadow)', async () => {
    const noCap = await expiryRow({ childOf: 41, caps: ['ws-audit', 'ws-expire', EXPIRE_CAP, ACTOR_FLAGS_CAP] }, () => {});
    expect(noCap.outcome).toEqual({ ...answeredX({ kind: 'deferred', why: 'unsupported', detail: 'the fleet host does not advertise expire-child-v1' }), child: true });
    const held = await expiryRow({ childOf: 41 }, () => {});
    expect(held.outcome).toEqual({ ...answeredX({ kind: 'would-expire', sensitive: 0 }), child: true, childArmHeld: true });
    const armed = await expiryRow({ childOf: 41 }, (x) => { x.raise(EXPIRE_CHILD_LIVE_MARKER); });
    expect(armed.dec.ok && armed.dec.d.decision).toEqual({ act: true });
    const refused = await expiryRow(undefined, (x) => { x.answers.audit = () => x.auditDoc({ verdict: 'not-archived', token: undefined, detail: 'x' }); });
    expect(refused.outcome).toEqual(answeredX({ kind: 'gone' }));
  });
});

// ── temp-orphan's readers ──────────────────────────────────────────────────────────────────────────────────────────────

const collectAskedOf = async (d: CollectTempRootDeps, id: string) => {
  if (!ccdCan(d.fleetState, 'wsCollect')) return { notAsked: 'capability' as const };
  const hex = collectLooseHexOf(id);
  if (hex !== null && !ccdCan(d.fleetState, 'wsCollectLooseAudit')) return { notAsked: 'capability' as const };
  const argv = hex === null ? CCD_ARGV.wsCollectAudit(id) : CCD_ARGV.wsCollectLooseAudit(hex);
  if (!ccdCan(d.fleetState, 'wsCollectAudit')) return { notAsked: 'verb' as const };
  const composed = d.lane.generations(id);
  let res: CcdResult;
  try { res = await d.runCcd(argv); } catch (err) {
    return { value: { kind: 'no-document' as const, stderr: said(err) }, composed, arrived: d.lane.clock() };
  }
  const arrived = d.lane.clock();
  if (res.ran === false) return { value: { kind: 'no-document' as const, stderr: res.stderr }, composed, arrived };
  return { value: hex === null ? parseCollectAudit(id, res.ok, res.stdout, res.stderr)
    : parseCollectLooseAudit(hex, res.ok, res.stdout, res.stderr), composed, arrived };
};
const collectReaders = (d: CollectTempRootDeps, job: CollectJob): Readers<TempOrphanFacts> => {
  const doc = (f: TempOrphanFacts) => {
    const a = f[RETIRE_STEPS.audit];
    if (a === undefined || 'notAsked' in a || a.value.kind !== 'collectable') throw new Error('no collectable audit');
    return { ...a, value: a.value };
  };
  const last = (f: TempOrphanFacts) => {
    const l = f[RETIRE_STEPS.switchesLast];
    if (l === undefined) throw new Error('no last listing');
    return l;
  };
  return {
    [RETIRE_STEPS.capability]: () => [ccdCan(d.fleetState, 'wsCollect') && capSupported(d.fleetState, RECLAIM_PAUSE_CAP),
      collectLooseHexOf(job.id) === null || (ccdCan(d.fleetState, 'wsCollectLoose') && ccdCan(d.fleetState, 'wsCollectLooseAudit'))],
    [RETIRE_STEPS.id]: () => collectLooseHexOf(job.id),
    [RETIRE_STEPS.switches]: () => collectSwitches(d.io, d.cfg.registryDir),
    [RETIRE_STEPS.presence]: () => d.viewers?.isVisible(job.id) === true,
    [RETIRE_STEPS.audit]: () => collectAskedOf(d, job.id),
    [RETIRE_STEPS.staleGeneration]: () => d.lane.generations(job.id),
    [RETIRE_STEPS.auditVerdict]: () => true,
    [RETIRE_STEPS.licence]: (f) => {
      const a = doc(f);
      return collectLicence(d.lane.observation(job.id), a.value, a.arrived.mono, d.observeIntervalMs, true);
    },
    [RETIRE_STEPS.hold]: (f) => collectOpenRunHold(d.coord, job.id, doc(f).value),
    [RETIRE_STEPS.switchesLast]: async () => {
      const listedUnder = d.link.epochNow();
      return { listedUnder, last: await collectSwitches(d.io, d.cfg.registryDir) };
    },
    [RETIRE_STEPS.latch]: (f) => {
      const epoch = { before: job.epoch, after: d.link.epochNow() };
      collectRetireLatch(d.control, last(f).last, epoch);
      return epoch;
    },
    [RETIRE_STEPS.lane]: (f) => {
      const epoch = f[RETIRE_STEPS.latch];
      if (epoch === undefined) throw new Error('no pair');
      return collectLaneEffective({
        switches: last(f).last, epoch,
        caps: { collect: ccdCan(d.fleetState, 'wsCollect'), reclaimPause: capSupported(d.fleetState, RECLAIM_PAUSE_CAP) },
        control: collectControlNow(d.control).control, node: d.link.current(),
      });
    },
    [RETIRE_STEPS.flip]: (f) => d.lane.flipped(f[RETIRE_STEPS.lane] as CollectLaneSettled),
    [RETIRE_STEPS.safety]: () => true,
    [RETIRE_STEPS.licenceStands]: () => ({ generations: d.lane.generations(job.id), observation: d.lane.observation(job.id) }),
    [RETIRE_STEPS.presenceLast]: () => d.viewers?.isVisible(job.id) === true,
    [RETIRE_STEPS.holdLast]: (f) => collectOpenRunHold(d.coord, job.id, doc(f).value),
    [RETIRE_STEPS.live]: () => true,
    [RETIRE_STEPS.looseMarker]: () => ccdCan(d.fleetState, 'wsCollectLoose'),
  };
};
/** The executor on one traced rig and the decider on its twin: both answers, and both call logs up to the verb's argv
 *  (the lane clears are the port's effects, D-7199, and are left out of the read log). */
const collectRow = async (make: () => CollectRig, jobOf2: (r: CollectRig) => CollectJob, opts: { readonly mutate?: (d: CollectTempRootDeps) => CollectTempRootDeps } = {}) => {
  const reads = (calls: readonly string[]): string[] => {
    const r = calls.filter((c) => !c.startsWith('lane.cleared'));
    const at = r.findIndex((c) => c === 'runCcd:ws-collect');
    return at < 0 ? r : r.slice(0, at);
  };
  const a = make();
  const ta = traced(a);
  const da = opts.mutate?.(ta.deps) ?? ta.deps;
  let exec: { ok: true; out: unknown } | { ok: false; err: string };
  try { exec = { ok: true, out: await collectTempRoot(da, jobOf2(a)) }; } catch (err) { exec = { ok: false, err: said(err) }; }
  const b = make();
  const tb = traced(b);
  const db = opts.mutate?.(tb.deps) ?? tb.deps;
  let dec: { ok: true; d: Driven<unknown> } | { ok: false; err: string };
  try { dec = { ok: true, d: await drive(TEMP_ORPHAN_RETIRE, jobOf2(b), collectReaders(db, jobOf2(b))) }; } catch (err) { dec = { ok: false, err: said(err) }; }
  expect(reads(tb.calls), 'the decider\'s reads are the executor\'s, in its order').toEqual(reads(ta.calls));
  if (!exec.ok || !dec.ok) {
    expect(dec.ok ? 'answered' : dec.err, 'both reject, with one error').toBe(exec.ok ? 'answered' : exec.err);
    return { exec, dec, a, b, ta, tb, outcome: null as unknown };
  }
  const outcome = exec.out as { kind: string };
  if (outcome.kind === 'acted') {
    expect(dec.d.decision, 'the executor composed its verb: the gate lets the act run').toEqual({ act: true });
    return { exec, dec, a, b, ta, tb, outcome: null as unknown };
  }
  // The twin rigs' witnesses are written at their own wall instants: that one stamp is read as the rig's, every other
  // byte of the answer (its audit included) must be equal.
  const unstamped = (v: unknown): unknown => JSON.parse(JSON.stringify(v, (k, x: unknown) => (k === 'witnessAt' && typeof x === 'number' ? 'stamp' : x)));
  expect(unstamped(dec.d.decision)).toEqual({ outcome: unstamped(exec.out) });
  return { exec, dec, a, b, ta, tb, outcome: exec.out };
};

describe('decideRetire: temp-orphan over C4h\'s matrix (C4i; D-7166)', () => {
  it.each(COLLECT_STEPS.map((s) => [s.step, s] as const))('temp-orphan: the deferral at step %s alone answers its own word and detail', async (_n, s) => {
    const t = await collectRow(() => { const r = collectRigOf(s.opts); s.set(r); return r; }, (r) => jobOf(r, s.step));
    expect(t.outcome).toMatchObject(s.want);
  });

  it('temp-orphan: every pair standing together answers the earlier step', async () => {
    const pairs: ReadonlyArray<readonly [number, number]> = [[0, 1], [1, 2], [2, 3], [3, 4], [4, 5], [7, 8], [9, 10], [15, 16], [16, 17]];
    for (const [i, j] of pairs) {
      const first = COLLECT_STEPS[i]!; const second = COLLECT_STEPS[j]!;
      const make = (): CollectRig => {
        const r = collectRigOf({ ...second.opts, ...first.opts });
        second.set(r);
        const [l2, a2] = [r.hooks.listing, r.hooks.audit];
        first.set(r);
        const [l1, a1] = [r.hooks.listing, r.hooks.audit];
        if (l1 !== l2 && l2 !== undefined) r.hooks.listing = (n) => { l2(n); return l1?.(n); };
        if (a1 !== a2 && a2 !== undefined) r.hooks.audit = () => { a2(); a1?.(); };
        return r;
      };
      const t = await collectRow(make, (r) => (i === 1 || j === 1 ? r.job('-not-a-tmproot') : r.job()));
      expect(t.outcome, `${first.step} beside ${second.step}`).toMatchObject(first.want);
    }
    // A raised stop and a flip together answer the stop: the flip is judged only after the lane's stop arms.
    const r = collectRigOf();
    const facts = (await drive(TEMP_ORPHAN_RETIRE, r.job(), collectReaders(r.deps, r.job()))).facts;
    const both = { ...facts, [RETIRE_STEPS.lane]: { kind: 'stopped', why: 'raised' }, [RETIRE_STEPS.flip]: true } as TempOrphanFacts;
    expect(decideRetire(both, TEMP_ORPHAN_RETIRE, r.job())).toMatchObject({ outcome: { kind: 'answered', step: 5, why: 'paused' } });
    // A hold and a refused licence together answer the hold.
    const held = { ...facts, [RETIRE_STEPS.licence]: { kind: 'no-first' }, [RETIRE_STEPS.hold]: { kind: 'held', why: 'run-open', detail: 'x' } } as TempOrphanFacts;
    expect(decideRetire(held, TEMP_ORPHAN_RETIRE, r.job())).toMatchObject({ outcome: { kind: 'held', step: 4 } });
  });

  it('temp-orphan: the need sequence equals the old read order', async () => {
    const t = await collectRow(() => collectRigOf(), (r) => r.job());
    expect(t.dec.ok && t.dec.d.decision).toEqual({ act: true });
    expect(t.dec.ok && t.dec.d.needs).toEqual(stepsOf(TEMP_ORPHAN_RETIRE as RetireReason<never, RetireFactSet, unknown>));
    // The licence is read before the hold, which judges both.
    const order = t.tb.calls;
    expect(order.indexOf('lane.observation')).toBeLessThan(order.indexOf('coord.run'));
  });

  it('temp-orphan: an unlistable registry names no reason (decider suite)', async () => {
    // Each ReadFailure reason (`unreadable`, `absent`) and a rejecting listing, at listing 1 (step 2) and listing 2
    // (step 5), each compared with the executor.
    const answers: ReadonlyArray<'null' | 'absent' | 'reject'> = ['null', 'absent', 'reject'];
    let rows = 0;
    for (const n of [1, 2]) {
      for (const what of answers) {
        const t = await collectRow(() => { const r = collectRigOf(); r.hooks.listing = (k) => (k === n ? what : undefined); return r; }, (r) => r.job());
        expect(t.outcome, `listing ${n} answering ${what}`).toMatchObject({ kind: n === 1 ? 'not-asked' : 'answered', step: n === 1 ? 2 : 5, why: 'paused',
          detail: 'the registry did not list, so a raised reclaim-paused cannot be ruled out' });
        rows += 1;
      }
    }
    expect(rows).toBe(6);
  });

  it('temp-orphan: a throwing synchronous read rejects the job (decider suite)', async () => {
    const throwing: ReadonlyArray<(d: CollectTempRootDeps) => CollectTempRootDeps> = [
      (d) => ({ ...d, viewers: { isVisible: () => { throw new Error('presence gone'); } } }),
      (d) => ({ ...d, lane: { ...d.lane, generations: () => { throw new Error('presence gone'); } } }),
      (d) => ({ ...d, lane: { ...d.lane, observation: () => { throw new Error('presence gone'); } } }),
      (d) => ({ ...d, link: { ...d.link, epochNow: () => { throw new Error('presence gone'); } } }),
    ];
    for (const mutate of throwing) {
      const t = await collectRow(() => collectRigOf(), (r) => r.job(), { mutate });
      expect(t.dec.ok ? 'answered' : t.dec.err).toBe('presence gone');
    }
  });

  it('temp-orphan: held at the act — a capability withdrawn before step 6, Settings flipped, and the loose arm', async () => {
    const caps = await collectRow(() => { const r = collectRigOf(); r.hooks.audit = () => { r.state.ccdVerbs = without(COLLECT_CAP); }; return r; }, (r) => r.job());
    expect(caps.outcome).toMatchObject({ kind: 'answered', step: 6, why: 'caps' });
    const flip = await collectRow(() => {
      const s = collectRigOf({ live: false, lastSeenLive: true });
      settingsLive(s);
      s.hooks.listing = (n) => { if (n === 2) s.coord.setCollectLane({ kind: 'off' }, WALL0 + 1, s.journal); };
      return s;
    }, (r) => r.job());
    expect(flip.outcome).toMatchObject({ kind: 'answered', step: 5, why: 'switch-flip' });
    const loose = await collectRow(() => looseRig(), (r) => r.job(LOOSE_ID));
    expect(loose.dec.ok && loose.dec.d.decision).toEqual({ act: true });
    const unarmed = await collectRow(() => looseRig(false), (r) => r.job(LOOSE_ID));
    expect(unarmed.outcome).toMatchObject({ kind: 'would-collect' });
    const withdrawn = await collectRow(() => {
      const r = looseRig();
      r.hooks.audit = () => { r.state.ccdVerbs = FULL_CAPS.filter((c) => c !== COLLECT_LOOSE_CAP); };
      return r;
    }, (r) => r.job(LOOSE_ID));
    expect(withdrawn.outcome).toMatchObject({ kind: 'would-collect' });
    const looseCaps = await collectRow(() => collectRigOf(), (r) => r.job(LOOSE_ID));
    expect(looseCaps.outcome).toMatchObject({ kind: 'not-asked', step: 1, why: 'caps', detail: 'the fleet host does not advertise collect-loose-v1' });
  });

  it('temp-orphan: the judged audit answers no-document, and the hold folds a store throw', async () => {
    const audit = await collectRow(() => { const r = collectRigOf(); r.deps.runCcd = async () => { throw new Error('link lost'); }; return r; }, (r) => r.job());
    expect(audit.outcome).toMatchObject({ kind: 'answered', step: 4, why: 'not-collectable', detail: 'ws-audit answered no-document' });
    const hold = await collectRow(() => collectRigOf({ coord: (real) => ({ run: (n) => real.run(n), bindingsOf: () => { throw new Error('locked'); } }) }), (r) => r.job());
    expect(hold.outcome).toMatchObject({ kind: 'held', step: 4, hold: { why: 'store-unreadable' } });
  });
});

// ── the rows themselves ────────────────────────────────────────────────────────────────────────────────────────────────

describe('decideRetire: the rows carry the difference table (C4i; D-7166, D-7173, D-7226)', () => {
  const ROWS = [CHILD_SPENT_RETIRE, ARCHIVE_EXPIRED_RETIRE, TEMP_ORPHAN_RETIRE] as unknown as readonly RetireReason<never, RetireFactSet, unknown>[];

  it('each row names its reason, its listing mode, its presence rule and its notice home', () => {
    expect(ROWS.map((r) => [r.name, r.listing, r.presence, r.notice])).toEqual([
      [RETIRE_REASON_NAMES.childSpent, RETIRE_LISTING_MODES.plainPerMarker, RETIRE_PRESENCE_RULES.untilCeiling, RETIRE_NOTICE_HOMES.executor],
      [RETIRE_REASON_NAMES.archiveExpired, RETIRE_LISTING_MODES.measuredOnce, RETIRE_PRESENCE_RULES.noCeiling, RETIRE_NOTICE_HOMES.lane],
      [RETIRE_REASON_NAMES.tempOrphan, RETIRE_LISTING_MODES.measuredOnce, RETIRE_PRESENCE_RULES.noCeiling, RETIRE_NOTICE_HOMES.lane],
    ]);
  });

  it('each row\'s steps in the old ladder\'s order, each step once, the audit between decide and act', () => {
    expect(stepsOf(ROWS[0]!)).toEqual(['record', 'store', 'coordinated', 'switches', 'off-switch', 'generation', 'presence', 'capability',
      'audit', 'audit-verdict', 'marker-match', 'audit-generation', 'off-switch-last']);
    expect(stepsOf(ROWS[1]!)).toEqual(['id', 'capability', 'switches', 'store', 'presence', 'audit', 'archive-match', 'audit-verdict',
      'switches-last', 'live']);
    expect(stepsOf(ROWS[2]!)).toEqual(['capability', 'id', 'switches', 'presence', 'audit', 'stale-generation', 'audit-verdict', 'licence',
      'hold', 'switches-last', 'latch', 'lane', 'flip', 'safety', 'licence-stands', 'presence-last', 'hold-last', 'live', 'loose-marker']);
    for (const r of ROWS) expect(new Set(stepsOf(r)).size, r.name).toBe(stepsOf(r).length);
    const used = new Set(ROWS.flatMap(stepsOf));
    expect([...Object.values(RETIRE_STEPS)].filter((s) => !used.has(s)), 'every step name is some row\'s').toEqual([]);
  });

  it('each row\'s rejection modes are C4h\'s measured table (judged where the ladder\'s own try catches; a wrapper\'s fold is its fact)', () => {
    const judged = (r: RetireReason<never, RetireFactSet, unknown>): string[] =>
      [...r.decide, r.audit, ...r.act].filter((s) => s.onReject === 'judged').map((s) => s.step);
    expect(judged(ROWS[0]!)).toEqual(['coordinated', 'switches', 'generation']);
    expect(judged(ROWS[1]!)).toEqual([]);
    expect(judged(ROWS[2]!)).toEqual([]);
    // C4h's judged readers: the three above, and the wrappers that fold their own rejection into their answer.
    const FOLDED: Record<string, RetireStep> = {
      "2b' the disabled read": RETIRE_STEPS.offSwitch, '6 the disabled read at the act': RETIRE_STEPS.offSwitchLast,
      'the switches (expirySwitches, both reads)': RETIRE_STEPS.switches, 'the store (readExpiryStore)': RETIRE_STEPS.store,
      'the switches (collectSwitches, both reads)': RETIRE_STEPS.switches, 'the audit (collectAudit)': RETIRE_STEPS.audit,
      'the hold (collectOpenRunHold, both reads)': RETIRE_STEPS.hold, 'the act (ws-collect)': RETIRE_STEPS.looseMarker,
    };
    const LADDER_TRY: Record<string, RetireStep> = {
      '2a the coordination fence': RETIRE_STEPS.coordinated, '2b the pause read': RETIRE_STEPS.switches,
      '2c the generation read': RETIRE_STEPS.generation,
    };
    for (const m of READER_MODES.filter((x) => x.mode === 'judged')) {
      expect(LADDER_TRY[m.reader] ?? FOLDED[m.reader], m.reader).toBeDefined();
    }
    expect(Object.keys(LADDER_TRY).length + Object.keys(FOLDED).length).toBe(READER_MODES.filter((x) => x.mode === 'judged').length);
  });

  it('each row\'s sync flags are C4h\'s measured awaits (the listings, the store and disabled reads and the audit await; temp-orphan\'s tail (f) never does)', () => {
    const syncOf = (r: RetireReason<never, RetireFactSet, unknown>): Array<[RetireStep, boolean]> =>
      [...r.decide, r.audit, ...r.act].map((s) => [s.step, s.sync]);
    expect(syncOf(ROWS[0]!)).toEqual([
      ['record', false], ['store', false], ['coordinated', true], ['switches', false], ['off-switch', false],
      ['generation', false], ['presence', true], ['capability', true], ['audit', false], ['audit-verdict', true],
      ['marker-match', true], ['audit-generation', true], ['off-switch-last', false]]);
    expect(syncOf(ROWS[1]!)).toEqual([
      ['id', true], ['capability', true], ['switches', false], ['store', true], ['presence', true], ['audit', false],
      ['archive-match', true], ['audit-verdict', true], ['switches-last', false], ['live', true]]);
    expect(syncOf(ROWS[2]!)).toEqual([
      ['capability', true], ['id', true], ['switches', false], ['presence', true], ['audit', false],
      ['stale-generation', true], ['audit-verdict', true], ['licence', true], ['hold', true], ['switches-last', false],
      ['latch', true], ['lane', true], ['flip', true], ['safety', true], ['licence-stands', true], ['presence-last', true],
      ['hold-last', true], ['live', true], ['loose-marker', true]]);
    // C4h (f): after its last listing, temp-orphan's ladder reaches the verb with no await.
    const tail = syncOf(ROWS[2]!);
    expect(tail.slice(tail.findIndex(([s]) => s === RETIRE_STEPS.switchesLast) + 1).every(([, sync]) => sync)).toBe(true);
  });

  it('the listing steps: child-spent lists once per marker, the other two once per step for every marker', () => {
    const listing = (r: RetireReason<never, RetireFactSet, unknown>) =>
      [...r.decide, ...r.act].filter((s) => s.markers !== undefined).map((s) => [s.step, s.markers]);
    expect(listing(ROWS[0]!)).toEqual([[RETIRE_STEPS.switches, [RECLAIM_PAUSE_MARKER]]]);
    expect(listing(ROWS[2]!)).toEqual([
      [RETIRE_STEPS.switches, [RECLAIM_PAUSE_MARKER, COLLECT_LANE_LIVE_MARKER, COLLECT_LOOSE_LIVE_MARKER]],
      [RETIRE_STEPS.switchesLast, [RECLAIM_PAUSE_MARKER, COLLECT_LANE_LIVE_MARKER, COLLECT_LOOSE_LIVE_MARKER]],
    ]);
  });

  it('a step whose fact is missing is the step asked for: no fact is read out of order', () => {
    const later = { [RETIRE_STEPS.presence]: false, [RETIRE_STEPS.capability]: [true, true] } as ChildSpentFacts;
    expect(decideRetire(later, CHILD_SPENT_RETIRE, {} as ChildReclaimRequest)).toEqual({ need: RETIRE_STEPS.record });
  });

  it('each row names its lane verdict as evidence, never called by the gate (D-7173)', () => {
    expect(ROWS.map((r) => r.evidence.map((e) => e.name))).toEqual([
      ['childReclaimSweepVerdict', 'childReclaimDecision'], ['archivedExpiryVerdict'], ['collectLicence']]);
  });
});

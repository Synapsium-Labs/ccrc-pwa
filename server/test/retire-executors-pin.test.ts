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


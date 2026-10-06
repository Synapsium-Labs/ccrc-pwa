// The expiry lane's ONE executor (workspace lifecycle spec 2026-09-24 §5.3, wave 3b): `ws-audit --expire`, then
// `ws-expire` with THAT audit's token, behind `capSupported(state, EXPIRE_CAP)`. A scripted ccd answers; nothing
// here reaches a box. What is proven: which argv is composed and when, that SHADOW composes nothing destructive, that
// `reclaim-paused` and a person stop it, that an older ccd's document is no evidence, and that the box words and a
// composition error come back as themselves.
import { describe, it, expect, vi, afterEach } from 'vitest';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { openCoordDb } from '../src/coord/db.js';
import { CoordStore } from '../src/coord/store.js';
import { expireArchived, recordExpireFeed, type ExpireArchivedDeps } from '../src/coord/expireArchived.js';
import { EXPIRE_LANE_LIVE_MARKER } from '../src/archivedExpiry.js';
import { NotifyLog } from '../src/notifylog.js';
import type { FleetState } from '../src/fleetstate.js';
import type { Runner } from '../src/exec.js';
import { ACTOR_FLAGS_CAP, EXPIRE_CAP } from '../src/ccdargv.js';
import { testDeps } from './helpers.js';
import { mkTmp } from './tmpHelpers.js';

afterEach(() => { vi.restoreAllMocks(); });

const ID = 'demo-quiet-dune';
const TOK = 'c'.repeat(64);
const ARCH = 1_789_000_000;
const DUE = ARCH + 604_800;
const CAPS: FleetState = { connected: true, downSince: null, rosterFp: null, build: null,
  ccdVerbs: ['ws-audit', 'ws-expire', EXPIRE_CAP, ACTOR_FLAGS_CAP] };

const auditDoc = (verdict: string, extra: Record<string, unknown> = {}): string => JSON.stringify({
  session: ID, mode: 'expire', archivedAt: ARCH, expiresAt: DUE, alive: false, exists: true, reaping: null,
  sensitive: [], verdict, detail: '', ...extra });
const expiredDoc = JSON.stringify({ expired: ID, archivedAt: ARCH, wip: null, attic: 3, residueBytes: 0, secretsDropped: 0 });

interface Script { audit?: { code: number; stdout: string; stderr?: string }; verb?: { code: number; stdout: string; stderr?: string } }

const rig = async (over: { script?: Script; caps?: FleetState; live?: boolean; paused?: boolean; visible?: boolean;
  unlistable?: boolean; duringAudit?: (reg: string) => void } = {}) => {
  const home = mkTmp('ccrc-expire-archived-');
  const reg = path.join(home, '.cc-sessions');
  mkdirSync(reg, { recursive: true });
  if (over.live !== false) writeFileSync(path.join(reg, EXPIRE_LANE_LIVE_MARKER), '');
  if (over.paused === true) writeFileSync(path.join(reg, 'reclaim-paused'), '');
  const script = over.script ?? { audit: { code: 0, stdout: auditDoc('expirable', { token: TOK }) }, verb: { code: 0, stdout: expiredDoc } };
  const calls: string[][] = [];
  const run: Runner = async (_cmd, args) => {
    calls.push(args);
    if (args[0] === 'ws-audit') over.duringAudit?.(reg);
    const r = args[0] === 'ws-audit' ? script.audit : args[0] === 'ws-expire' ? script.verb : undefined;
    return r === undefined ? { code: 1, stdout: '', stderr: `unscripted ${args[0]}` } : { code: r.code, stdout: r.stdout, stderr: r.stderr ?? '' };
  };
  const base = testDeps(home, run);
  const coord = new CoordStore(openCoordDb(path.join(home, '.ccrc', 'coord.db')));
  const notifyLog = new NotifyLog(path.join(home, '.ccrc', 'notify.json'));
  await notifyLog.load();
  const deps: ExpireArchivedDeps = {
    coord, io: over.unlistable === true ? { ...base.io, readdir: async () => null } : base.io, cfg: base.cfg,
    runCcd: base.runCcd, fleetState: over.caps ?? CAPS,
    presence: { isVisible: (id: string) => over.visible === true && id === ID }, notifyLog,
  };
  const verbs = () => calls.map((c) => c[0]);
  return { deps, calls, verbs, coord, req: { sessionId: ID, archivedAt: ARCH, expiresAt: DUE } };
};

describe('the one executor', () => {
  it('LIVE: audits, then spends THAT audit’s token on ws-expire — and reports what was kept', async () => {
    const s = await rig();
    const out = await expireArchived(s.deps, s.req);
    expect(out).toMatchObject({ kind: 'expired', sessionId: ID, archivedAt: ARCH, expiresAt: DUE, wip: null, secretsDropped: 0 });
    expect(s.calls[0]).toEqual(['ws-audit', '--session', ID, '--expire']);
    expect(s.calls[1]!.slice(0, 5)).toEqual(['ws-expire', '--expect', TOK, '--session', ID]);
  });

  it('SHADOW (no `expire-lane-live`): audits and answers "would expire" — ws-expire is never composed', async () => {
    const s = await rig({ live: false, script: { audit: { code: 0, stdout: auditDoc('expirable', { token: TOK, sensitive: ['.env', 'id_rsa'] }) } } });
    expect(await expireArchived(s.deps, s.req)).toMatchObject({ kind: 'would-expire', sensitive: 2 });
    expect(s.verbs()).toEqual(['ws-audit']);
  });

  it('`reclaim-paused` — the one cleanup switch — stops it before ccd is asked anything, shadow included', async () => {
    for (const live of [true, false]) {
      const s = await rig({ paused: true, live });
      expect(await expireArchived(s.deps, s.req)).toMatchObject({ kind: 'deferred', why: 'paused-at-server' });
      expect(s.calls).toEqual([]);
    }
  });

  it('a registry that did not list cannot rule the pause out: deferred, nothing asked', async () => {
    const s = await rig({ unlistable: true });
    expect(await expireArchived(s.deps, s.req)).toMatchObject({ kind: 'deferred', why: 'paused-at-server' });
    expect(s.calls).toEqual([]);
  });

  it('no `expire-v1` on the box is NO EVIDENCE: deferred, nothing composed — `verbSupported` would have permitted', async () => {
    for (const ccdVerbs of [['ws-audit', 'ws-expire'], null]) {
      const s = await rig({ caps: { ...CAPS, ccdVerbs } as FleetState });
      expect(await expireArchived(s.deps, s.req)).toMatchObject({ kind: 'deferred', why: 'unsupported' });
      expect(s.calls).toEqual([]);
    }
  });

  it('a person at the session defers it, with no ceiling', async () => {
    const s = await rig({ visible: true });
    expect(await expireArchived(s.deps, s.req)).toMatchObject({ kind: 'deferred', why: 'presence' });
    expect(s.calls).toEqual([]);
  });

  it('an audit document with no `expiresAt` (an older ccd) is no evidence: nothing is composed', async () => {
    const doc = JSON.parse(auditDoc('expirable', { token: TOK })) as Record<string, unknown>;
    delete doc['expiresAt'];
    const s = await rig({ script: { audit: { code: 0, stdout: JSON.stringify(doc) }, verb: { code: 0, stdout: expiredDoc } } });
    expect(await expireArchived(s.deps, s.req)).toMatchObject({ kind: 'no-evidence' });
    expect(s.verbs()).toEqual(['ws-audit']);
  });

  it('an audit of ANOTHER archive than the one queued is a row that moved: deferred, never spent', async () => {
    const s = await rig({ script: { audit: { code: 0, stdout: auditDoc('expirable', { token: TOK, archivedAt: ARCH + 5 }) } } });
    expect(await expireArchived(s.deps, s.req)).toMatchObject({ kind: 'deferred', why: 'state-changed' });
    expect(s.verbs()).toEqual(['ws-audit']);
  });

  it('an expirable audit whose expiresAt is not an instant is a changed state: deferred, ws-expire never composed', async () => {
    const s = await rig({ script: { audit: { code: 0, stdout: auditDoc('expirable', { token: TOK, expiresAt: null }) }, verb: { code: 0, stdout: expiredDoc } } });
    expect(await expireArchived(s.deps, s.req)).toMatchObject({ kind: 'deferred', why: 'state-changed' });
    expect(s.verbs()).toEqual(['ws-audit']);
  });

  it('an audit exit 1 is a failure, its document never spent', async () => {
    const s = await rig({ script: { audit: { code: 1, stdout: auditDoc('unmeasured') } } });
    expect(await expireArchived(s.deps, s.req)).toMatchObject({ kind: 'failed' });
    expect(s.verbs()).toEqual(['ws-audit']);
  });

  it('a refusal at audit carries its word — in-use with the processes; a GONE word is gone', async () => {
    const inUse = [{ pid: 7, comm: 'tmux: server', cwd: '/w' }];
    const s = await rig({ script: { audit: { code: 0, stdout: auditDoc('in-use', { detail: 'process 7 …', inUse }) } } });
    expect(await expireArchived(s.deps, s.req)).toMatchObject({ kind: 'refused', token: 'in-use', inUse });
    const g = await rig({ script: { audit: { code: 0, stdout: auditDoc('not-archived', { archivedAt: null, expiresAt: null }) } } });
    expect(await expireArchived(g.deps, g.req)).toMatchObject({ kind: 'gone' });
  });

  it('the box words come back as themselves — flock-unavailable and lock-unopenable — and a composition error as the server’s', async () => {
    const lock = '/h/.cc-sessions/.reap-demo-quiet-dune.lock';
    const cases: [string, Record<string, unknown>][] = [
      ['ccd: flock (util-linux) is unavailable — refusing to run the destructive verb unserialised', { kind: 'box', word: 'flock-unavailable' }],
      [`/h/ccd: line 9: ${lock}: Is a directory\nccd: cannot open the reap lock at ${lock}`, { kind: 'box', word: 'lock-unopenable' }],
      ['ccd: bad token', { kind: 'composition', detail: 'bad token' }],
    ];
    for (const [stderr, want] of cases) {
      const s = await rig({ script: { audit: { code: 0, stdout: auditDoc('expirable', { token: TOK }) }, verb: { code: 1, stdout: '', stderr } } });
      expect(await expireArchived(s.deps, s.req), stderr).toMatchObject(want);
    }
  });

  // THE STORE, RE-READ AT THE ACT (child reclamation's executor's shape, `childReclaimOutcome` steps 2 and 2a): the lane
  // read the run conjuncts when its pass began; a run can bind the row while the pass learns other rows' instants, and
  // ccd cannot see coord.db. So the executor asks again, for its one row, before ccd is asked anything.
  it('a run that names the row NOW — as worker, or as claimant — defers it before ccd is asked anything', async () => {
    const worker = await rig();
    const w = worker.coord.openRun({ program: 'p', title: 'p', project: 'demo', wave: 1, waveOf: null, claimedBy: 'demo-coord' });
    if (!('id' in w)) throw new Error('openRun refused');
    worker.coord.markDispatched(w.id, ID, ID, 'ws/quiet-dune', false);
    expect(await expireArchived(worker.deps, worker.req)).toMatchObject({ kind: 'deferred', why: 'open-run' });
    expect(worker.calls).toEqual([]);
    const claimant = await rig();
    const c = claimant.coord.openRun({ program: 'q', title: 'q', project: 'demo', wave: 1, waveOf: null, claimedBy: ID });
    if (!('id' in c)) throw new Error('openRun refused');
    expect(await expireArchived(claimant.deps, claimant.req)).toMatchObject({ kind: 'deferred', why: 'coordinating' });
    expect(claimant.calls).toEqual([]);
  });

  it('a REVIEW run naming the row, whose reviewed run is still open, keeps it — and a store that cannot say does too', async () => {
    const s = await rig();
    const work = s.coord.openRun({ program: 'p', title: 'p', project: 'demo', wave: 1, waveOf: null, claimedBy: 'demo-coord' });
    if (!('id' in work)) throw new Error('openRun refused');
    const review = s.coord.openRun({ program: 'p', title: 'p', project: 'demo', wave: 1, waveOf: null, claimedBy: 'demo-coord',
      kind: 'review', reviews: work.id });
    if (!('id' in review)) throw new Error('openRun refused');
    s.coord.markDispatched(review.id, ID, ID, 'ws/quiet-dune', false);
    expect(s.coord.advance(review.id, 'failed', 'test').ok, 'the review run itself is over').toBe(true);
    expect(await expireArchived(s.deps, s.req)).toMatchObject({ kind: 'deferred', why: 'review-open' });
    expect(s.calls).toEqual([]);
    const broken = await rig();
    vi.spyOn(broken.coord, 'openRunsForSession').mockImplementation(() => { throw new Error('database is not open'); });
    expect(await expireArchived(broken.deps, broken.req)).toMatchObject({ kind: 'deferred', why: 'store-unreadable' });
    expect(broken.calls).toEqual([]);
  });

  it('the switches are read once more NEAREST THE ARGV: lowered or paused during the audit, ws-expire is never composed', async () => {
    const lowered = await rig({ duringAudit: (reg) => { rmSync(path.join(reg, EXPIRE_LANE_LIVE_MARKER)); } });
    expect(await expireArchived(lowered.deps, lowered.req)).toMatchObject({ kind: 'would-expire' });
    expect(lowered.verbs()).toEqual(['ws-audit']);
    const paused = await rig({ duringAudit: (reg) => { writeFileSync(path.join(reg, 'reclaim-paused'), ''); } });
    expect(await expireArchived(paused.deps, paused.req)).toMatchObject({ kind: 'deferred', why: 'paused-at-server' });
    expect(paused.verbs()).toEqual(['ws-audit']);
  });

  it('a `not-expired` refusal carries the audit’s own instant, for the lane to learn', async () => {
    const raised = ARCH + 2 * 604_800;
    const s = await rig({ script: { audit: { code: 0, stdout: auditDoc('not-expired', { expiresAt: raised }) } } });
    expect(await expireArchived(s.deps, s.req)).toMatchObject({ kind: 'refused', token: 'not-expired', auditExpiresAt: raised });
  });

  it('a feed row says what happened to which archive — and a shadow row says nothing was deleted', async () => {
    const s = await rig({ live: false });
    const out = await expireArchived(s.deps, s.req);
    recordExpireFeed(s.deps, out);
    const ev = s.coord.feedEvents(10).filter((e) => e.sessionId === ID);
    expect(ev.map((e) => e.title)).toEqual(['archived workspace would be cleaned up']);
    expect(ev[0]!.body).toContain('nothing was deleted');
    expect(ev[0]!.runId).toBeNull();
  });
});

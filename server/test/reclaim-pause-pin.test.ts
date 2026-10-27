// THE `reclaim-paused` VERDICT PIN (D-5852; ARCH-70 (#805)'s characterization half; consolidation spec 2026-10-19 K12).
// Characterization only: every row here is green on today's code and pins what each reader ANSWERS, word for word,
// never its source text. W1a moves these readers onto one switch read; this suite is what that move must keep.
//
// Three parts:
//   1. one row per parse site (`reclaimPauseParseSites()`, the census module's named query) and per caller of
//      `childReclaimPauseRead`, each over FOUR registry listings: the marker present, the marker absent, a listing of
//      `null` (both shipped `FleetIO` adapters fold every failure to it) and a `readdir` that REJECTS. The watch.ts lane
//      sites take the tick's listing, so their `null` and rejecting legs are the tick's own fold, pinned once below (D-5865);
//   2. the late reads, "a pause raised during the act holds": the fake `readdir` is scripted per call, clean for the
//      executor's first read and raised only from its late read on, so a row cannot pass on the first read alone;
//   3. the coord frame's `MarkerState` bytes, and the two spellings of `mail-disabled`.
// FIXTURE HOMES ONLY: a scripted ccd and fake ports answer. Nothing reaches a box, tmux or a live registry.
import { describe, it, expect, vi, afterEach } from 'vitest';
import { mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { Bus } from '../src/bus.js';
import { FleetWatcher, CHILD_RECLAIM_SWEEP_MS } from '../src/watch.js';
import { readRegistry } from '../src/registry.js';
import { loadConfig } from '../src/config.js';
import { openCoordDb } from '../src/coord/db.js';
import { CoordStore } from '../src/coord/store.js';
import { closeRun, type CloseOutcome } from '../src/coord/close.js';
import { parseJournalLine } from '../src/coord/journalparse.js';
import {
  CHILD_RECLAIM_FEED_QUIET_NONE, childReclaimPauseRead, reclaimChild, releaseRetiredChildHold,
  type ChildReclaimDeps, type ChildReclaimOutcome, type ChildReclaimRequest,
} from '../src/coord/childReclaim.js';
import { collectSwitches, collectTempRoot } from '../src/coord/collectTempRoot.js';
import { endDeadCoordinator, stillCrashed, type EndDeadCoordinatorDeps } from '../src/coord/endDeadCoordinator.js';
import { expireArchived, type ExpireArchivedDeps } from '../src/coord/expireArchived.js';
import { dispatchRun, type DispatchRunDeps } from '../src/coord/dispatch.js';
import { MAIL_DISABLED_MARKER, RECLAIM_PAUSE_MARKER } from '../src/coord/rundefs.js';
import { stopDonePass, type StopDoneSweepDeps } from '../src/sleepLane.js';
import { STOP_DONE_GRACE_MS } from '../src/stopDone.js';
import { EXPIRE_LANE_LIVE_MARKER } from '../src/archivedExpiry.js';
import { DEAD_COORDINATOR_JOURNAL_TRUSTED, DEAD_COORDINATOR_LANE_LIVE_MARKER } from '../src/deadCoordinator.js';
import { COLLECT_LANE_LIVE_MARKER } from '../src/collectLane.js';
import { NotifyLog } from '../src/notifylog.js';
import type { FleetIO } from '../src/io.js';
import { CHILD_RECLAIM_DISABLED_MARKER } from '../../shared/switches.js';
import type { FleetState } from '../src/fleetstate.js';
import type { Runner } from '../src/exec.js';
import type { SessionRecord } from '../src/registry.js';
import { ACTOR_FLAGS_CAP, EXPIRE_CAP, RECLAIM_CAP, RECLAIM_PAUSE_CAP } from '../src/ccdargv.js';
import { PRESENCE_OPEN_TTL_MS, holdReason, type CoordStatus, type FleetSession } from '../../shared/api.js';
import { reclaimPauseParseSites } from './consolidationCensus.js';
import { ID as COLLECT_ID, rig as collectRig } from './collectTempRootFixture.js';
import { seedRoster, testDeps } from './helpers.js';
import { mkTmp } from './tmpHelpers.js';
import { G1 } from './childReclaimGenerationFixture.js';
import { okRun } from './coordReadHelpers.js';

afterEach(() => { vi.restoreAllMocks(); });

// ── the four listings ────────────────────────────────────────────────────────

/** The four registry listings every reader is pinned over. */
type Listing = 'present' | 'absent' | 'null' | 'reject';
const LISTINGS: readonly Listing[] = ['present', 'absent', 'null', 'reject'];
/** The rejecting `readdir`'s message, so a sentence that carries it can be asked for byte for byte. */
const EIO = 'EIO: the registry listing failed';

/** A `FleetIO` whose REGISTRY listings are scripted per call (1-based, counting registry listings only): `real` is the
 *  fixture's own listing, `present` and `absent` are that listing with the marker added or taken out, `null` is the
 *  adapters' fold and `reject` throws. Every other directory is the base adapter's. `listings()` counts the calls.
 *  Both readers answer from the one script (D-5969): `readdirMeasured` answers `null` as `unreadable`, and the plain
 *  `readdir` derives from it, as `localIO`'s does, so a reader moved onto the measured listing keeps its row. */
const scripted = (base: FleetIO, reg: string, at: (n: number) => Listing | 'real') => {
  let n = 0;
  const readdirMeasured: FleetIO['readdirMeasured'] = async (p, timeoutMs, signal) => {
    if (p !== reg) return base.readdirMeasured(p, timeoutMs, signal);
    n += 1;
    const what = at(n);
    if (what === 'reject') throw new Error(EIO);
    if (what === 'null') return { ok: false, reason: 'unreadable' };
    const listed = await base.readdirMeasured(p, timeoutMs, signal);
    if (!listed.ok || what === 'real') return listed;
    const without = listed.entries.filter((x) => x !== RECLAIM_PAUSE_MARKER);
    return { ok: true, entries: what === 'present' ? [...without, RECLAIM_PAUSE_MARKER] : without };
  };
  const io: FleetIO = {
    ...base,
    readdirMeasured,
    readdir: async (p, timeoutMs, signal) => {
      const r = await readdirMeasured(p, timeoutMs, signal);
      return r.ok ? [...r.entries] : null;
    },
  };
  return { io, listings: (): number => n };
};

/** A `FleetIO` whose registry listings pass through `edit` (counted per registry listing, 1-based); both readers see it. */
const edited = (base: FleetIO, reg: string, edit: (n: number, names: string[]) => string[]): FleetIO => {
  let n = 0;
  const readdirMeasured: FleetIO['readdirMeasured'] = async (p, t, sig) => {
    const listed = await base.readdirMeasured(p, t, sig);
    if (p !== reg || !listed.ok) return listed;
    n += 1;
    return { ok: true, entries: edit(n, [...listed.entries]) };
  };
  return { ...base, readdirMeasured, readdir: async (p, t, sig) => {
    const r = await readdirMeasured(p, t, sig);
    return r.ok ? [...r.entries] : null;
  } };
};

// The sentences, as the readers word them today. Spelled here, not imported, so a reworded sentence is red.
const RAISED_CLEANUP = 'reclaim-paused is raised: cleanup is paused fleet-wide';
const RAISED_RECLAIM = 'reclaim-paused is raised: automatic reclamation is paused fleet-wide';
const UNLISTABLE = 'the registry did not list, so a raised reclaim-paused cannot be ruled out';
/** D-5969 (ARCH-08b, #534): the readers on the MEASURED listing name why it did not list; `null` and a rejecting port
 *  both read `unreadable`. */
const UNLISTABLE_UNREADABLE = 'the registry did not list (unreadable), so a raised reclaim-paused cannot be ruled out';
const UNREAD_RECLAIM = `whether reclaim-paused is raised could not be read (${EIO})`;
const RAISED_DURING = 'reclaim-paused was raised during the act';
const DISARMED_DURING = 'the lane was disarmed during the act';

// ── 0. every parse site has a row here ───────────────────────────────────────

/** The parse sites this suite pins, per file, as `reclaimPauseParseSites()` finds them. A site added anywhere without a
 *  row here is red; a site W1a folds away is green (the map is a ceiling, and the commit that folds one lowers it). */
const PINNED_SITES: Readonly<Record<string, number>> = {
  'server/src/coord/childReclaim.ts': 0,        // folded onto readSwitches (D-5856)
  'server/src/coord/collectTempRoot.ts': 0,     // folded onto readSwitches (D-5856)
  'server/src/coord/endDeadCoordinator.ts': 0,  // folded onto readSwitches (D-5856)
  'server/src/coord/expireArchived.ts': 0,      // folded onto readSwitches (D-5856)
  'server/src/stopDoneSweep.ts': 0,             // folded onto readSwitches (D-7041)
  'server/src/watch.ts': 0,                     // folded onto readSwitches (D-5856)
};

describe('every includes(RECLAIM_PAUSE_MARKER) site has a verdict row in this suite', () => {
  it('the census finds no site this suite does not pin', () => {
    const byFile = new Map<string, number>();
    for (const s of reclaimPauseParseSites()) byFile.set(s.file, (byFile.get(s.file) ?? 0) + 1);
    for (const [file, n] of byFile) {
      expect(n, `${file}: ${n} parse site(s), ${PINNED_SITES[file] ?? 0} pinned here`).toBeLessThanOrEqual(PINNED_SITES[file] ?? 0);
    }
  });
});

// ── 1a. childReclaimPauseRead and reclaimChild's step 2b ─────────────────────

describe('childReclaim.ts — childReclaimPauseRead, the server\'s read of the reclaim switch', () => {
  const io = (l: Listing): Pick<FleetIO, 'readdir'> => ({
    readdir: async () => {
      if (l === 'reject') throw new Error(EIO);
      if (l === 'null') return null;
      return l === 'present' ? ['demo-a.uuid', RECLAIM_PAUSE_MARKER] : ['demo-a.uuid'];
    },
  });
  it.each<[Listing, string]>([['present', 'set'], ['absent', 'clear'], ['null', 'unmeasurable']])(
    '%s → %s', async (l, word) => {
      expect(await childReclaimPauseRead(io(l), '/reg')).toBe(word);
    });
  it('reject → the rejection is NOT caught here: each caller\'s try answers it', async () => {
    await expect(childReclaimPauseRead(io('reject'), '/reg')).rejects.toThrow(EIO);
  });
});

/** A marked child of a finished run with nothing open on it: every re-read before the pause passes, so step 2b is
 *  the one thing that can stop it before the audit. Registry listing 1 is step 1's marker re-read; listing 2 is 2b. */
const childRig = async () => {
  const home = mkTmp('ccrc-pause-pin-child-');
  const calls: string[][] = [];
  const base = testDeps(home, async (_cmd, args) => { calls.push(args); return { ran: true as const, code: 1, stdout: '', stderr: '' }; });
  const reg = base.cfg.registryDir;
  mkdirSync(reg, { recursive: true });
  const coord = new CoordStore(openCoordDb(path.join(home, '.ccrc', 'coord.db')));
  const opened = coord.openRun({ program: 'pin-paused', title: 'pin-paused', project: 'demo', wave: 1, waveOf: null, claimedBy: 'demo-coord' });
  if (!('id' in opened)) throw new Error(`openRun refused: ${JSON.stringify(opened)}`);
  const closed = coord.closeRun({ runId: opened.id, finalState: 'failed', causedBy: 'operator', handoffCommit: null, program: 'pin-paused', viaClosing: false });
  if (!closed.ok) throw new Error(`close refused: ${JSON.stringify(closed)}`);
  const fields: Record<string, string> = {
    uuid: 'u-demo-a', wrapper: 'claude', project: 'demo', workdir: '/w/demo-a', workspace: 'a',
    branch: 'ws/demo-a', base: 'origin/main', started: '1', child: String(opened.id),
  };
  for (const [f, v] of Object.entries(fields)) writeFileSync(path.join(reg, `demo-a.${f}`), v);
  const notifyLog = new NotifyLog(path.join(home, '.ccrc', 'notify.json'));
  await notifyLog.load();
  const deps = (io: FleetIO): ChildReclaimDeps => ({
    coord, io, cfg: base.cfg, runCcd: base.runCcd,
    fleetState: { connected: true, downSince: null, rosterFp: null, build: null,
      ccdVerbs: ['ws-audit', 'ws-reclaim', RECLAIM_CAP, ACTOR_FLAGS_CAP] },
    viewers: { isVisible: () => false }, notifyLog,
  });
  const req: ChildReclaimRequest = { sessionId: 'demo-a', runId: opened.id, trigger: 'close', deferExpired: false,
    deferredSinceMs: null, feedQuiet: CHILD_RECLAIM_FEED_QUIET_NONE, licenceGeneration: { kind: 'none' } };
  const feed = (): string[] => coord.feedEvents(50).filter((e) => e.sessionId === 'demo-a').map((e) => e.title);
  return { base, reg, deps, req, calls, feed };
};

describe('childReclaim.ts — reclaimChild step 2b: the pause, read before presence and before any argv', () => {
  it.each<[Listing, string]>([
    ['present', RAISED_RECLAIM],
    ['null', UNLISTABLE],
    ['reject', UNREAD_RECLAIM],
  ])('%s → deferred paused-at-server, its own sentence, one feed row, nothing asked of ccd', async (l, detail) => {
    const f = await childRig();
    const s = scripted(f.base.io, f.reg, (n) => (n === 1 ? 'real' : l));
    const out = await reclaimChild(f.deps(s.io), f.req);
    expect(s.listings(), 'step 1 listed, then step 2b once').toBe(2);
    expect(out).toEqual({ kind: 'deferred', sessionId: 'demo-a', runId: f.req.runId, why: 'paused-at-server', detail });
    expect(f.calls, 'no argv composed or sent').toEqual([]);
    expect(f.feed()).toEqual(['child reclaim deferred']);
  });

  it('absent → it goes on past the switch, to the audit argv', async () => {
    const f = await childRig();
    const s = scripted(f.base.io, f.reg, (n) => (n === 1 ? 'real' : 'absent'));
    const out = await reclaimChild(f.deps(s.io), f.req);
    expect(out.kind === 'deferred' ? out.why : out.kind).not.toBe('paused-at-server');
    expect(f.calls.map((c) => c[0])).toContain('ws-audit');
  });

  it('an unlistable registry cannot rule the pause out: a null listing at 2b is a deferral, never clear', async () => {
    const f = await childRig();
    const s = scripted(f.base.io, f.reg, (n) => (n === 1 ? 'real' : 'null'));
    expect(await reclaimChild(f.deps(s.io), f.req)).toMatchObject({ why: 'paused-at-server', detail: UNLISTABLE });
  });

  it('childReclaim names a read that failed: a rejecting readdir keeps its own sentence, never the unlistable one', async () => {
    const f = await childRig();
    const s = scripted(f.base.io, f.reg, (n) => (n === 1 ? 'real' : 'reject'));
    const out = await reclaimChild(f.deps(s.io), f.req);
    expect(out.kind === 'deferred' ? out.detail : '').toBe(UNREAD_RECLAIM);
  });
});

// ── 1b. releaseRetiredChildHold step 6: the second caller of childReclaimPauseRead ───────────────────────────────

const RID = 'demo-quiet-basin';
const GEN_VALUE = G1;

/** `child-reclaim-hold-retired-generation.test.ts`'s release rig, trimmed: a terminal run of `demo`, its programme
 *  closed, the row carrying that run's hold text and generation. `ws-release` answers `released`. */
const releaseRig = async () => {
  const home = mkTmp('ccrc-pause-pin-release-');
  const reg = path.join(home, '.cc-sessions');
  mkdirSync(reg, { recursive: true });
  const coord = new CoordStore(openCoordDb(path.join(home, '.ccrc', 'coord.db')));
  const ccd: string[] = [];
  const run: Runner = async (_cmd, args) => {
    ccd.push(args[0] ?? '');
    return args[0] === 'ws-release' ? { ran: true as const, code: 0, stdout: `released ${RID}\n`, stderr: '' }
      : { ran: true as const, code: 1, stdout: '', stderr: `unscripted ${args[0]}` };
  };
  const base = testDeps(home, run);
  const r = coord.openRun({ program: 'demo', title: 'demo', project: 'demo', wave: 1, waveOf: null, claimedBy: 'demo-coord' });
  if (!('id' in r)) throw new Error(`openRun refused: ${JSON.stringify(r)}`);
  expect(coord.closeRun({ runId: r.id, finalState: 'failed', causedBy: 'test', handoffCommit: null, program: 'demo',
    viaClosing: false }).ok).toBe(true);
  const reason = holdReason('demo', 2, null, null);
  const fields: Record<string, string> = { uuid: `u-${RID}`, wrapper: 'claude', project: 'demo', workdir: `/w/${RID}`,
    workspace: 'quiet-basin', branch: 'ws/quiet-basin', base: 'origin/main', started: '1', child: String(r.id), hold: reason,
    generation: GEN_VALUE };
  for (const [k, v] of Object.entries(fields)) writeFileSync(path.join(reg, `${RID}.${k}`), v);
  const deps = (io: FleetIO): ChildReclaimDeps => ({ coord, io, cfg: base.cfg, runCcd: base.runCcd,
    fleetState: { connected: true, downSince: null, rosterFp: null, build: null, ccdVerbs: ['ws-release', ACTOR_FLAGS_CAP] } });
  const req = { sessionId: RID, runId: r.id, reason, program: 'demo', accountedRunId: r.id,
    generation: { kind: 'value' as const, v: GEN_VALUE } };
  // Step 6 is the job's LAST registry listing (step 7 reads a file): measured on a clean run, never typed.
  const probe = scripted(base.io, reg, () => 'real');
  expect(await releaseRetiredChildHold(deps(probe.io), req), 'the clean run releases').toBe('released');
  const step6 = probe.listings();
  ccd.length = 0;
  return { base, reg, deps, req, ccd, step6 };
};

describe('childReclaim.ts — releaseRetiredChildHold step 6: the reclaim switch, still down', () => {
  it.each<[Listing, string]>([['present', 'changed'], ['absent', 'released'], ['null', 'failed'], ['reject', 'failed']])(
    '%s at step 6 → %s', async (l, word) => {
      const f = await releaseRig();
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
      const s = scripted(f.base.io, f.reg, (n) => (n === f.step6 ? l : 'real'));
      expect(await releaseRetiredChildHold(f.deps(s.io), f.req)).toBe(word);
      expect(f.ccd, word === 'released' ? 'step 7 passed, ws-release composed' : 'no ws-release')
        .toEqual(word === 'released' ? ['ws-release'] : []);
      expect(warn.mock.calls.map((c) => String(c[0]))).toEqual(l === 'reject'
        ? [`ccrc-server: releaseRetiredChildHold: reading the reclaim switch failed (${EIO})`] : []);
    });

  it('a pause raised during the act holds: retired-child release — raised before step 6 only, the job answers changed and releases nothing', async () => {
    const f = await releaseRig();
    // Every listing before step 6 is clean; the marker stands from step 6 on.
    const s = scripted(f.base.io, f.reg, (n) => (n < f.step6 ? 'absent' : 'present'));
    expect(await releaseRetiredChildHold(f.deps(s.io), f.req)).toBe('changed');
    expect(f.ccd).toEqual([]);
  });
});

describe('childReclaim.ts — releaseRetiredChildHold step 6: child-reclaim-disabled, beside the reclaim switch', () => {
  it('set answers changed and composes no ws-release', async () => {
    const f = await releaseRig();
    writeFileSync(path.join(f.reg, CHILD_RECLAIM_DISABLED_MARKER), '');
    expect(await releaseRetiredChildHold(f.deps(f.base.io), f.req)).toBe('changed');
    expect(f.ccd).toEqual([]);
  });
});

// ── 1c. collectSwitches, and the collect job's two reads ─────────────────────

describe('collectTempRoot.ts — collectSwitches: both switches from one listing, a pause saying why', () => {
  const io = (l: Listing): Pick<FleetIO, 'readdirMeasured'> => ({
    readdirMeasured: async () => {
      if (l === 'reject') throw new Error(EIO);
      if (l === 'null') return { ok: false, reason: 'unreadable' };
      return { ok: true, entries: l === 'present' ? [COLLECT_LANE_LIVE_MARKER, RECLAIM_PAUSE_MARKER] : [COLLECT_LANE_LIVE_MARKER] };
    },
  });
  // D-5969: the unlistable pause carries the listing's `ReadFailure` reason.
  it.each<[Listing, unknown]>([
    ['present', { paused: true, why: 'raised', marker: true }],
    ['absent', { paused: false, marker: true }],
    ['null', { paused: true, why: 'unlistable', reason: 'unreadable' }],
    ['reject', { paused: true, why: 'unlistable', reason: 'unreadable' }],
  ])('%s → %j', async (l, want) => {
    expect(await collectSwitches(io(l), '/reg')).toStrictEqual(want);
  });
});

describe('collectTempRoot.ts — the job\'s step 2 (its first read) over the four listings', () => {
  it.each<[Listing, string | null]>([
    ['present', RAISED_CLEANUP], ['absent', null], ['null', UNLISTABLE], ['reject', UNLISTABLE],
  ])('%s → %s', async (l, detail) => {
    const r = collectRig();
    const first = l;
    r.hooks.listing = (n) => {
      if (n !== 1) return undefined;
      if (first === 'present') r.raise(RECLAIM_PAUSE_MARKER);
      if (first === 'null' || first === 'reject') return first;
      return undefined;
    };
    const out = await collectTempRoot(r.deps, r.job());
    if (detail === null) {
      expect(out.kind, 'the switch is down: the job goes on to act').toBe('acted');
    } else {
      expect(out).toEqual({ kind: 'not-asked', step: 2, why: 'paused', detail });
      expect(r.attempts, 'nothing composed').toEqual([]);
    }
  });

  it('the two causes are not one fact: raised and unlistable stop alike, each in its own words', async () => {
    const raised = collectRig({ paused: true });
    const unlistable = collectRig();
    unlistable.hooks.listing = (n) => (n === 1 ? 'null' : undefined);
    const a = await collectTempRoot(raised.deps, raised.job());
    const b = await collectTempRoot(unlistable.deps, unlistable.job());
    expect([a, b].map((o) => (o.kind === 'not-asked' ? o.detail : o.kind))).toEqual([RAISED_CLEANUP, UNLISTABLE]);
  });
});

describe('collectTempRoot.ts — the job\'s step 5 (its last read) over the four listings', () => {
  it.each<[Listing, string | null]>([
    ['present', RAISED_CLEANUP], ['absent', null], ['null', UNLISTABLE], ['reject', UNLISTABLE],
  ])('%s at the last read → %s', async (l, detail) => {
    const r = collectRig();
    r.hooks.listing = (n) => (n === 2 && (l === 'null' || l === 'reject') ? l : undefined);
    if (l === 'present') r.hooks.audit = () => { r.raise(RECLAIM_PAUSE_MARKER); };
    const out = await collectTempRoot(r.deps, r.job());
    if (detail === null) {
      expect(out.kind).toBe('acted');
    } else {
      expect(out).toMatchObject({ kind: 'answered', step: 5, why: 'paused', detail });
      expect(r.attempts.map((a) => a[0]), 'the audit only: no destructive argv').toEqual(['ws-audit']);
    }
  });

  it('a pause raised during the act holds: collect — clean at the first read, raised before the last, no ws-collect', async () => {
    const r = collectRig();
    r.hooks.listing = (n) => { if (n === 2) r.raise(RECLAIM_PAUSE_MARKER); };
    expect(await collectTempRoot(r.deps, r.job())).toMatchObject({ kind: 'answered', step: 5, why: 'paused', detail: RAISED_CLEANUP });
    expect(r.attempts.map((a) => a[0])).toEqual(['ws-audit']);
    expect(r.attempts.flat()).toContain(COLLECT_ID);
  });
});

// ── 1d. endDeadCoordinator: step 1, and stillCrashed (the late read inside abandon) ─────────────────────────────

const CRASHED = 'demo-coord-crashed';
const DEAD_NOW = 1_790_000_000_000;

/** `end-dead-coordinator.test.ts`'s rig, trimmed: a crashed coordinator (its supervisor heartbeat long gone), the lane
 *  armed, and the sweep's abandon exactly as the serialiser runs it — the REAL `closeRun`, handed `stillCrashed`. */
const deadRig = async () => {
  const home = mkTmp('ccrc-pause-pin-dead-');
  const reg = path.join(home, '.cc-sessions');
  mkdirSync(reg, { recursive: true });
  for (const [k, v] of Object.entries({ wrapper: 'claude', project: 'demo', workdir: `/w/${CRASHED}`, uuid: `u-${CRASHED}`,
    started: '1', supervised: String(DEAD_NOW / 1000 - 7200) })) writeFileSync(path.join(reg, `${CRASHED}.${k}`), v);
  writeFileSync(path.join(reg, DEAD_COORDINATOR_LANE_LIVE_MARKER), '');
  const calls: string[][] = [];
  const base = testDeps(home, async (_cmd, args) => { calls.push(args); return { ran: true as const, code: 0, stdout: '', stderr: '' }; });
  const coord = new CoordStore(openCoordDb(path.join(home, '.ccrc', 'coord.db')));
  const abandoned: number[] = [];
  const deps = (io: FleetIO): EndDeadCoordinatorDeps => ({
    coord, cfg: base.cfg, io,
    tmux: { sessionVerdict: async () => ({ verdict: 'gone' }) },
    journalTrust: async () => ({ hold: null, trust: DEAD_COORDINATOR_JOURNAL_TRUSTED }),
    journalReread: (early) => ({ hold: null, trust: early }),
    now: () => DEAD_NOW,
    abandon: (runId, crashedId, still): Promise<CloseOutcome> => {
      abandoned.push(runId);
      return closeRun({ coord, io: base.io, cfg: base.cfg, runCcd: base.runCcd }, runId, { intent: 'abandon' }, 'sweep',
        { claimedBy: crashedId, stillCrashed: still });
    },
  });
  const r = coord.openRun({ program: 'alpha', title: 'alpha', project: 'demo', wave: 1, waveOf: 2, claimedBy: CRASHED });
  if (!('id' in r)) throw new Error('openRun refused');
  const stateOf = (): string => okRun(coord.run(r.id))!.state;
  return { base, reg, deps, runId: r.id, calls, abandoned, stateOf };
};

describe('endDeadCoordinator.ts — the executor\'s step 1: the switches, from one listing, nearest the act', () => {
  it.each<[Listing, string]>([['present', RAISED_CLEANUP], ['null', UNLISTABLE_UNREADABLE], ['reject', UNLISTABLE_UNREADABLE]])(
    '%s → paused-at-server, its words, and abandon never reached', async (l, detail) => {
      const f = await deadRig();
      const s = scripted(f.base.io, f.reg, (n) => (n === 1 ? l : 'real'));
      expect(await endDeadCoordinator(f.deps(s.io), CRASHED, DEAD_NOW)).toEqual({ kind: 'paused-at-server', detail });
      expect(f.abandoned).toEqual([]);
      expect(f.stateOf()).toBe('planned');
    });

  it('absent → it goes on to abandon, and the run ends', async () => {
    const f = await deadRig();
    const s = scripted(f.base.io, f.reg, () => 'absent');
    expect(await endDeadCoordinator(f.deps(s.io), CRASHED, DEAD_NOW)).toMatchObject({ kind: 'ended', stoppedBy: null });
    expect(f.abandoned).toEqual([f.runId]);
  });
});

describe('endDeadCoordinator.ts — stillCrashed: the act\'s late switch verdict', () => {
  it.each<[Listing, unknown]>([
    ['present', { kind: 'switch', why: RAISED_DURING }],
    ['absent', null],
    ['null', { kind: 'switch', why: UNLISTABLE_UNREADABLE }],
    ['reject', { kind: 'switch', why: UNLISTABLE_UNREADABLE }],
  ])('%s → %j', async (l, want) => {
    const f = await deadRig();
    const s = scripted(f.base.io, f.reg, () => l);
    expect(await stillCrashed(f.deps(s.io), CRASHED)).toEqual(want);
  });

  it('a pause raised during the act holds: dead coordinator — clean at step 1, raised inside abandon\'s stillCrashed, the close does not run', async () => {
    const f = await deadRig();
    const s = scripted(f.base.io, f.reg, (n) => (n === 1 ? 'absent' : 'present'));
    const out = await endDeadCoordinator(f.deps(s.io), CRASHED, DEAD_NOW);
    expect(out).toMatchObject({ kind: 'ended', programmes: [], stoppedBy: { kind: 'switch', why: RAISED_DURING } });
    expect(f.abandoned, 'abandon was reached: the late read is the one that stopped it').toEqual([f.runId]);
    expect(f.stateOf()).toBe('planned');
  });

  it('the lane disarmed during the act: deadCoordinatorLaneArmed is false at stillCrashed, the close does not run', async () => {
    const f = await deadRig();
    const io = edited(f.base.io, f.reg, (n, names) => (n === 1 ? names : names.filter((x) => x !== DEAD_COORDINATOR_LANE_LIVE_MARKER)));
    const out = await endDeadCoordinator(f.deps(io), CRASHED, DEAD_NOW);
    expect(out).toMatchObject({ kind: 'ended', programmes: [], stoppedBy: { kind: 'switch', why: DISARMED_DURING } });
    expect(f.stateOf()).toBe('planned');
  });
});

// ── 1e. expireArchived: step 2 and step 6 (expirySwitches) ───────────────────

const XID = 'demo-quiet-dune';
const XTOK = 'c'.repeat(64);
const XARCH = 1_789_000_000;
const XDUE = XARCH + 604_800;

const expireRig = async () => {
  const home = mkTmp('ccrc-pause-pin-expire-');
  const reg = path.join(home, '.cc-sessions');
  mkdirSync(reg, { recursive: true });
  writeFileSync(path.join(reg, EXPIRE_LANE_LIVE_MARKER), '');
  const verbs: string[] = [];
  let duringAudit: (() => void) | undefined;
  const run: Runner = async (_cmd, args) => {
    verbs.push(args[0] ?? '');
    if (args[0] === 'ws-audit') {
      duringAudit?.();
      return { ran: true as const, code: 0, stdout: JSON.stringify({ session: XID, mode: 'expire', archivedAt: XARCH, expiresAt: XDUE, alive: false,
        exists: true, reaping: null, sensitive: [], verdict: 'expirable', detail: '', token: XTOK }), stderr: '' };
    }
    if (args[0] === 'ws-expire') {
      return { ran: true as const, code: 0, stdout: JSON.stringify({ expired: XID, archivedAt: XARCH, wip: null, attic: 3, residueBytes: 0, secretsDropped: 0 }), stderr: '' };
    }
    return { ran: true as const, code: 1, stdout: '', stderr: `unscripted ${args[0]}` };
  };
  const base = testDeps(home, run);
  const coord = new CoordStore(openCoordDb(path.join(home, '.ccrc', 'coord.db')));
  const deps = (io: FleetIO): ExpireArchivedDeps => ({ coord, io, cfg: base.cfg, runCcd: base.runCcd,
    fleetState: { connected: true, downSince: null, rosterFp: null, build: null, ccdVerbs: ['ws-audit', 'ws-expire', EXPIRE_CAP, ACTOR_FLAGS_CAP] },
    viewers: { isVisible: () => false } });
  return { base, reg, deps, verbs, req: { sessionId: XID, archivedAt: XARCH, expiresAt: XDUE },
    onAudit: (fn: () => void): void => { duringAudit = fn; } };
};

describe('expireArchived.ts — expirySwitches at step 2 (the first read)', () => {
  it.each<[Listing, string | null]>([['present', RAISED_CLEANUP], ['absent', null], ['null', UNLISTABLE_UNREADABLE], ['reject', UNLISTABLE_UNREADABLE]])(
    '%s → %s', async (l, detail) => {
      const f = await expireRig();
      const s = scripted(f.base.io, f.reg, (n) => (n === 1 ? l : 'absent'));
      const out = await expireArchived(f.deps(s.io), f.req);
      if (detail === null) {
        expect(out.kind).toBe('expired');
        expect(f.verbs).toEqual(['ws-audit', 'ws-expire']);
      } else {
        expect(out).toEqual({ kind: 'deferred', why: 'paused-at-server', detail, ...f.req });
        expect(f.verbs, 'ccd asked nothing').toEqual([]);
      }
    });
});

describe('expireArchived.ts — expirySwitches at step 6 (NEAREST THE ARGV)', () => {
  it.each<[Listing, string | null]>([['present', RAISED_CLEANUP], ['absent', null], ['null', UNLISTABLE_UNREADABLE], ['reject', UNLISTABLE_UNREADABLE]])(
    '%s at step 6 → %s', async (l, detail) => {
      const f = await expireRig();
      const s = scripted(f.base.io, f.reg, (n) => (n === 1 ? 'absent' : l));
      const out = await expireArchived(f.deps(s.io), f.req);
      expect(s.listings(), 'step 2 and step 6, one listing each').toBe(2);
      if (detail === null) {
        expect(out.kind).toBe('expired');
      } else {
        expect(out).toEqual({ kind: 'deferred', why: 'paused-at-server', detail, ...f.req });
        expect(f.verbs, 'the audit only: no destructive argv').toEqual(['ws-audit']);
      }
    });

  it('a pause raised during the act holds: expiry — raised during the audit, step 6 sees it, no ws-expire', async () => {
    const f = await expireRig();
    f.onAudit(() => { writeFileSync(path.join(f.reg, RECLAIM_PAUSE_MARKER), ''); });
    const out = await expireArchived(f.deps(f.base.io), f.req);
    expect(out).toMatchObject({ kind: 'deferred', why: 'paused-at-server', detail: RAISED_CLEANUP });
    expect(f.verbs).toEqual(['ws-audit']);
  });

  it('expire-lane-live removed during the audit: step 6 answers would-expire, nothing is deleted', async () => {
    const f = await expireRig();
    const io = edited(f.base.io, f.reg, (n, names) => (n === 1 ? names : names.filter((x) => x !== EXPIRE_LANE_LIVE_MARKER)));
    expect(await expireArchived(f.deps(io), f.req)).toMatchObject({ kind: 'would-expire' });
    expect(f.verbs).toEqual(['ws-audit']);
  });
});

// ── 1f. stopDonePass: the stop-done lane's switches (beside stop-done-disabled) ────────────────────────────────

describe('stopDoneSweep.ts — stopDonePass reads reclaim-paused off the tick\'s listing', () => {
  const NOW = 1_800_000_000_000;
  const HOUR = 3_600_000;
  const SID = 'project-a-quiet-basin';
  const row = { id: SID, child: { kind: 'child', runId: 1 }, archivedAt: null, held: null, stoppedBy: null, unmeasured: [],
    statusUnmeasured: false, dialogPending: false, background: null, subagents: null, stranded: null, swapBlocked: null,
    substrate: null, bucket: 'idle' } as unknown as FleetSession;
  const rec = { id: SID, uuid: `uuid-${SID}` } as unknown as SessionRecord;
  /** `stop-done-sweep.test.ts`'s fake, trimmed to one finished, idle worker past the grace. */
  const fake = () => {
    const argv: string[][] = [];
    const deps: StopDoneSweepDeps = {
      coord: {
        lastRunBySession: (asked: readonly string[]) => ({ ok: true as const,
          last: asked.map((sessionId) => ({ sessionId, runId: 10, state: 'done', closedAt: NOW - STOP_DONE_GRACE_MS - 1,
            program: 'p', programTitle: null, claimedBy: 'acct-a-project-a' })),
          openWorkers: [], openClaimants: ['acct-a-project-a'],
          // D-6091: the run-done policy's placed reads — the same finished run, and no placed open one.
          lastPlaced: asked.map((sessionId) => ({ sessionId, runId: 10, state: 'done', closedAt: NOW - STOP_DONE_GRACE_MS - 1,
            program: 'p', programTitle: null, claimedBy: 'acct-a-project-a' })),
          openPlacedWorkers: [], parkedPlacedWorkers: [] }),
        activeClaims: () => [],
        outstandingMailFor: () => [] as never,
        recordFeedEvent: () => undefined,
        runsNamingSession: () => ({ ok: true as const, runs: [] }) as never,
        run: () => ({ ok: true as const, run: { state: 'working', reviews: null } }) as never,
      } as unknown as StopDoneSweepDeps['coord'],
      runCcd: async (a) => { argv.push([...a]); return { ran: true as const, ok: true, stdout: '', stderr: '', killed: false, signal: null }; },
      fleetState: { ccdVerbs: ['hibernate', ACTOR_FLAGS_CAP] } as unknown as FleetState,
      viewers: { isOpen: () => false },
      notifyLog: { epoch: 'e', record: (e: object) => ({ ...e, seq: 1, at: NOW }), flush: async () => undefined } as unknown as StopDoneSweepDeps['notifyLog'],
      liveWord: async () => ({ ok: true, word: 'idle', since: null }),
      turnVerdict: async () => 'idle',
      mark: async () => ({ ok: true, state: 'done', bg: 0, crons: 0, turnAt: NOW - 7 * HOUR - 60_000, stopAt: NOW - 7 * HOUR, restartAt: null }) as const,
      rowAtAct: async (r) => ({ ok: true, row: { ...row, id: r.id } }),
      serial: async (fn) => fn(),
      queueRun: async (_id, fn) => fn(),
      startedAt: NOW - PRESENCE_OPEN_TTL_MS - 60_000,
      now: () => NOW,
    };
    return { deps, argv };
  };
  it('present → nothing is stopped', async () => {
    const f = fake();
    expect(await stopDonePass(f.deps, { retryAt: new Map() }, [row], [rec], [RECLAIM_PAUSE_MARKER])).toEqual([]);
    expect(f.argv).toEqual([]);
  });
  it('absent → the finished worker is put to sleep', async () => {
    const f = fake();
    expect(await stopDonePass(f.deps, { retryAt: new Map() }, [row], [rec], [])).toEqual([{ id: SID, kind: 'hibernated', runId: 10 }]);
    expect(f.argv.map((a) => a[0])).toEqual(['hibernate']);
  });
});

// ── 1g. the watch.ts sites, and the tick's fold of a null or rejecting listing (D-5865) ────────────────────────

const T0 = 1_790_000_000_000;
const GEN = '1790000000000000000';

/** A watcher over a fixture HOME, `child-reclaim-sweep.test.ts`'s and `archived-expiry-lane.test.ts`'s idiom: a
 *  recording ccd, the wall clock and the lane's monotonic clock faked, the child-reclaim executor stubbed. */
const watchRig = (o: { io?: (base: FleetIO, reg: string) => FleetIO } = {}) => {
  let clock = T0;
  let mono = 5_000;
  vi.spyOn(Date, 'now').mockImplementation(() => clock);
  const home = mkTmp('ccrc-pause-pin-watch-');
  seedRoster(home);
  const reg = path.join(home, '.cc-sessions');
  mkdirSync(reg, { recursive: true });
  const cfg = loadConfig({ CCRC_HOME: home, CCRC_PROJECTS_ROOT: mkTmp('ccrc-projects-') } as never);
  const calls: string[][] = [];
  const run = async (cmd: string, args: string[]) => {
    if (path.basename(cmd) === 'tmux') return { ran: true as const, code: 1, stdout: '', stderr: '' };
    calls.push(args);
    return { ran: true as const, code: 1, stdout: '', stderr: '' };
  };
  const coord = new CoordStore(openCoordDb(path.join(home, '.ccrc', 'coord.db')));
  const requests: ChildReclaimRequest[] = [];
  const base = testDeps(home, run);
  const deps = {
    ...base, cfg, coord, io: o.io?.(base.io, reg) ?? base.io,
    fleetState: { connected: true, downSince: null, rosterFp: null, build: null,
      ccdVerbs: ['ws-audit', 'ws-reclaim', 'ws-expire', RECLAIM_CAP, RECLAIM_PAUSE_CAP, EXPIRE_CAP, ACTOR_FLAGS_CAP] },
    viewers: { isVisible: () => false },
    childReclaimExec: async (req: ChildReclaimRequest): Promise<ChildReclaimOutcome> => {
      requests.push(req);
      return { kind: 'reclaimed', sessionId: req.sessionId, runId: req.runId, wip: { kind: 'none' }, secretsDropped: 0 };
    },
    monotonicMs: () => mono,
  };
  const bus = new Bus();
  const frames: CoordStatus[] = [];
  bus.on('coord', (c) => { frames.push(c); });
  const watcher = new FleetWatcher(deps as never, bus, 10_000);
  const plant = (id: string, extra: Record<string, string> = {}): void => {
    const fields: Record<string, string> = { uuid: `u-${id}`, wrapper: 'claude', project: 'demo', workdir: `/w/${id}`,
      workspace: id.slice('demo-'.length), branch: `ws/${id}`, base: 'origin/main', started: '1', ...extra };
    for (const [f, v] of Object.entries(fields)) writeFileSync(path.join(reg, `${id}.${f}`), v);
  };
  const touch = (name: string): void => { writeFileSync(path.join(reg, name), ''); };
  const records = async (): Promise<SessionRecord[]> => readRegistry(base.io, cfg);
  const next = (): void => { clock += CHILD_RECLAIM_SWEEP_MS + 1; mono += CHILD_RECLAIM_SWEEP_MS + 1; };
  return { reg, coord, watcher, calls, requests, frames, plant, touch, records, next,
    names: (): string[] => readdirSync(reg) };
};

describe('watch.ts — emitCoord: the coord frame\'s switch bytes (the wire\'s MarkerState)', () => {
  it.each<[Listing, string]>([['present', 'set'], ['absent', 'clear'], ['null', 'unmeasurable']])(
    '%s → reclaim: %s', async (l, word) => {
      const f = watchRig({ io: (b, reg) => scripted(b, reg, () => l).io });
      await f.watcher.tick();
      const frame = f.frames.at(-1)!;
      expect(frame.reclaim).toBe(word);
      expect(JSON.stringify({ pause: frame.pause, mail: frame.mail, reclaim: frame.reclaim })).toBe(l === 'null'
        ? '{"pause":"unmeasurable","mail":"unmeasurable","reclaim":"unmeasurable"}'
        : `{"pause":"clear","mail":"clear","reclaim":"${word}"}`);
    });

  it('reject → the tick emits no coord frame at all (the rejection leaves the tick before emitCoord)', async () => {
    const f = watchRig({ io: (b, reg) => scripted(b, reg, () => 'reject').io });
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    await f.watcher.tick().catch(() => undefined);
    expect(f.frames).toEqual([]);
    void warn;
  });
});

describe('watch.ts — the tick hands the lanes ITS listing, and a null or rejecting one reaches none of them', () => {
  // `sweepSleep` runs only once the watcher is primed, so each row primes it first.
  const lanes = ['sweepChildReclaim', 'sweepArchivedExpiry', 'sweepDeadCoordinators', 'sweepSleep'] as const;
  const prime = (w: FleetWatcher): void => { (w as unknown as { primed: boolean }).primed = true; };
  it.each<Listing>(['null', 'reject'])('%s → no lane is called', async (l) => {
    const f = watchRig({ io: (b, reg) => scripted(b, reg, () => l).io });
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    prime(f.watcher);
    const spies = lanes.map((m) => vi.spyOn(f.watcher, m));
    await f.watcher.tick().catch(() => undefined);
    expect(spies.map((s) => s.mock.calls.length)).toEqual([0, 0, 0, 0]);
  });
  it.each<Listing>(['present', 'absent'])('%s → each lane gets the tick\'s own listing', async (l) => {
    const f = watchRig({ io: (b, reg) => scripted(b, reg, () => l).io });
    prime(f.watcher);
    const spies = lanes.map((m) => vi.spyOn(f.watcher, m));
    await f.watcher.tick();
    // The listing is each lane's last argument (`sweepSleep` takes the rows first).
    expect(spies.map((s) => (s.mock.calls[0]?.at(-1) as string[] | undefined)?.includes(RECLAIM_PAUSE_MARKER)))
      .toEqual(lanes.map(() => l === 'present'));
  });
});

describe('watch.ts — sweepChildReclaim: a raised switch stops the lane and drops its sightings', () => {
  const finishedChild = (f: ReturnType<typeof watchRig>): void => {
    const r = f.coord.openRun({ program: 'pin-prog', title: 'pin-prog', project: 'demo', wave: 1, waveOf: null, claimedBy: 'demo-coord' });
    if (!('id' in r)) throw new Error('openRun refused');
    expect(f.coord.closeRun({ runId: r.id, finalState: 'failed', causedBy: 'operator', handoffCommit: null, program: 'pin-prog', viaClosing: false }).ok).toBe(true);
    f.plant('demo-a', { child: String(r.id) });
    f.coord.ingestJournal({ gen: GEN, rows: [parseJournalLine(JSON.stringify({ uid: 'w4.1.1', at: T0, act: 'create',
      outcome: 'done', verb: 'ws-add', id: 'demo-a' }))], cursor: 200, size: 200, at: T0 });
  };
  it.each<Listing>(['present', 'absent'])('%s over two passes: a reclaim is asked only when absent', async (l) => {
    const f = watchRig();
    finishedChild(f);
    if (l === 'present') f.touch(RECLAIM_PAUSE_MARKER);
    await f.watcher.sweepChildReclaim(await f.records(), f.names());
    f.next();
    await f.watcher.sweepChildReclaim(await f.records(), f.names());
    expect(f.requests.map((q) => q.sessionId)).toEqual(l === 'present' ? [] : ['demo-a']);
  });
  it('a raised switch drops the sightings: absent, present, absent asks nothing on the third pass, and the fourth (a second fresh sighting) asks', async () => {
    const f = watchRig();
    finishedChild(f);
    const pass = async (): Promise<string[]> => {
      await f.watcher.sweepChildReclaim(await f.records(), f.names());
      f.next();
      return f.requests.map((q) => q.sessionId);
    };
    expect(await pass()).toEqual([]);
    f.touch(RECLAIM_PAUSE_MARKER);
    expect(await pass()).toEqual([]);
    rmSync(path.join(f.reg, RECLAIM_PAUSE_MARKER));
    expect(await pass()).toEqual([]);
    expect(await pass()).toEqual(['demo-a']);
  });
});

describe('watch.ts — archivedExpiryPass: a raised switch stops the expiry lane before it asks anything', () => {
  it.each<Listing>(['present', 'absent'])('%s: ws-audit is asked only when absent', async (l) => {
    const f = watchRig();
    f.plant('demo-dune', { archived: String(T0 / 1000 - 8 * 86_400), archivedreason: 'operator' });
    if (l === 'present') f.touch(RECLAIM_PAUSE_MARKER);
    await f.watcher.sweepArchivedExpiry(await f.records(), f.names());
    expect(f.calls.some((c) => c[0] === 'ws-audit')).toBe(l === 'absent');
  });
});

describe('watch.ts — deadCoordinatorPass: a raised switch stops the lane before the journal is even asked', () => {
  it.each<Listing>(['present', 'absent'])('%s: the pass reaches the journal only when absent', async (l) => {
    const f = watchRig();
    if (l === 'present') f.touch(RECLAIM_PAUSE_MARKER);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    await f.watcher.sweepDeadCoordinators(await f.records(), f.names());
    // A mirror not swept yet holds the pass: the warn line is the proof the pass got past its switch.
    expect(warn.mock.calls.some((c) => String(c[0]).startsWith('ccrc-server: sweepDeadCoordinators:'))).toBe(l === 'absent');
  });
});

// ── 3. the mail switch's two definitions ─────────────────────────────────────

describe('both spellings of mail-disabled agree: rundefs.ts\'s export and watch.ts\'s private copy', () => {
  it('a listing holding rundefs\' MAIL_DISABLED_MARKER reads set on the coord frame (watch.ts\'s copy) and refuses dispatch (dispatch.ts)', async () => {
    expect(MAIL_DISABLED_MARKER).toBe('mail-disabled');
    const f = watchRig();
    f.touch(MAIL_DISABLED_MARKER);
    await f.watcher.tick();
    expect(f.frames.at(-1)!.mail).toBe('set');
    const opened = f.coord.openRun({ program: 'pin-mail', title: 'pin-mail', project: 'demo', wave: 1, waveOf: null, claimedBy: 'demo-coord' });
    if (!('id' in opened)) throw new Error('openRun refused');
    const ccd: string[][] = [];
    const deps = { coord: f.coord, io: { readdir: async () => [MAIL_DISABLED_MARKER] },
      cfg: { registryDir: f.reg }, runCcd: async (a: string[]) => { ccd.push(a); return { ok: false }; },
      sendClear: async () => ({ ok: true as const }) } as unknown as DispatchRunDeps;
    expect(await dispatchRun(deps, opened.id, 'do the thing', undefined)).toEqual({ ok: false, kind: 'refused', code: 'mail-disabled' });
    expect(ccd).toEqual([]);
  });

  it.each([true, false])('and watch.ts\'s mail lane stops on the same listing (listed: %s): it returns at its kill switch, before the gate mode is read', async (listed) => {
    const names = listed ? [MAIL_DISABLED_MARKER] : [];
    const f = watchRig({ io: (b, reg) => ({ ...b, readdir: async (p, t, s) => (p === reg ? names : b.readdir(p, t, s)) }) });
    (f.watcher as unknown as { primed: boolean }).primed = true;
    const stall = vi.spyOn(f.watcher as unknown as { stallResolveNow: () => unknown }, 'stallResolveNow');
    await f.watcher.sweepMail();
    expect(stall.mock.calls.length > 0).toBe(!listed);
  });

  it('fail-shut on both readers: a null listing stops the mail lane before the gate, and dispatchRun refuses with no ccd call', async () => {
    const f = watchRig({ io: (b, reg) => ({ ...b, readdir: async (p, t, s) => (p === reg ? null : b.readdir(p, t, s)) }) });
    (f.watcher as unknown as { primed: boolean }).primed = true;
    const stall = vi.spyOn(f.watcher as unknown as { stallResolveNow: () => unknown }, 'stallResolveNow');
    await f.watcher.sweepMail();
    expect(stall.mock.calls.length).toBe(0);
    const opened = f.coord.openRun({ program: 'pin-mail-null', title: 'pin-mail-null', project: 'demo', wave: 1, waveOf: null, claimedBy: 'demo-coord' });
    if (!('id' in opened)) throw new Error('openRun refused');
    const ccd: string[][] = [];
    const deps = { coord: f.coord, io: { readdir: async () => null },
      cfg: { registryDir: f.reg }, runCcd: async (a: string[]) => { ccd.push(a); return { ok: false }; },
      sendClear: async () => ({ ok: true as const }) } as unknown as DispatchRunDeps;
    expect(await dispatchRun(deps, opened.id, 'do the thing', undefined)).toEqual({ ok: false, kind: 'refused', code: 'paused' });
    expect(ccd).toEqual([]);
  });
});

// ── 4. two passes, the marker raised between them (D-5856; W1a C1b's characterization rows) ──────────────────────
// Each executor runs twice on one rig: the registry is clean for the first run, and the marker is raised on disk
// between the two. The second run must see it. An executor that kept the first run's switch reading (a cached
// snapshot, a module-level memo) would act on the second run: the stale act these rows exist to show.

describe('two passes, the marker raised between them: no executor acts on the first pass\'s reading', () => {
  it('expiry: the first run expires, the second (marker raised between) defers paused-at-server and asks ccd nothing', async () => {
    const f = await expireRig();
    expect((await expireArchived(f.deps(f.base.io), f.req)).kind).toBe('expired');
    expect(f.verbs).toEqual(['ws-audit', 'ws-expire']);
    writeFileSync(path.join(f.reg, RECLAIM_PAUSE_MARKER), '');
    expect(await expireArchived(f.deps(f.base.io), f.req))
      .toEqual({ kind: 'deferred', why: 'paused-at-server', detail: RAISED_CLEANUP, ...f.req });
    expect(f.verbs, 'nothing asked on the second run').toEqual(['ws-audit', 'ws-expire']);
  });

  it('collect: the first job acts, the second (marker raised between) is not asked at step 2 and composes nothing', async () => {
    const r = collectRig();
    expect((await collectTempRoot(r.deps, r.job())).kind).toBe('acted');
    const asked = r.attempts.length;
    r.raise(RECLAIM_PAUSE_MARKER);
    expect(await collectTempRoot(r.deps, r.job())).toEqual({ kind: 'not-asked', step: 2, why: 'paused', detail: RAISED_CLEANUP });
    expect(r.attempts.length, 'nothing composed on the second job').toBe(asked);
  });

  it('dead coordinator: the first act ends the run, the second (marker raised between) is paused-at-server', async () => {
    const f = await deadRig();
    expect(await endDeadCoordinator(f.deps(f.base.io), CRASHED, DEAD_NOW)).toMatchObject({ kind: 'ended', stoppedBy: null });
    expect(f.abandoned).toEqual([f.runId]);
    writeFileSync(path.join(f.reg, RECLAIM_PAUSE_MARKER), '');
    expect(await endDeadCoordinator(f.deps(f.base.io), CRASHED, DEAD_NOW)).toEqual({ kind: 'paused-at-server', detail: RAISED_CLEANUP });
    expect(f.abandoned, 'abandon not reached on the second act').toEqual([f.runId]);
  });

  it('child reclaim: the first run passes the switch to the audit, the second (marker raised between) defers at 2b', async () => {
    const f = await childRig();
    const first = await reclaimChild(f.deps(f.base.io), f.req);
    expect(first.kind === 'deferred' ? first.why : first.kind).not.toBe('paused-at-server');
    expect(f.calls.map((c) => c[0])).toContain('ws-audit');
    const asked = f.calls.length;
    writeFileSync(path.join(f.reg, RECLAIM_PAUSE_MARKER), '');
    expect(await reclaimChild(f.deps(f.base.io), f.req))
      .toEqual({ kind: 'deferred', sessionId: 'demo-a', runId: f.req.runId, why: 'paused-at-server', detail: RAISED_RECLAIM });
    expect(f.calls.length, 'no argv on the second run').toBe(asked);
  });

  it('retired-child release: the first run releases, the second (marker raised between) answers changed and releases nothing', async () => {
    const f = await releaseRig();
    expect(await releaseRetiredChildHold(f.deps(f.base.io), f.req)).toBe('released');
    expect(f.ccd).toEqual(['ws-release']);
    writeFileSync(path.join(f.reg, RECLAIM_PAUSE_MARKER), '');
    expect(await releaseRetiredChildHold(f.deps(f.base.io), f.req)).toBe('changed');
    expect(f.ccd, 'no ws-release on the second run').toEqual(['ws-release']);
  });
});

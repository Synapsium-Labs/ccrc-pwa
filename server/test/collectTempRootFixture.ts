// Child reclamation wave 9 (spec §5.10), widened by CCR-15 wave 10 (path-identity spec 2026-10-12 §5.4, §5.5): what the
// collector executor's case files share: `collect-temp-root.test.ts`, `collect-temp-root-reads.test.ts`,
// `collect-open-run-hold.test.ts` and `collect-switch-executor.test.ts`. A ccd SCRIPT behind the agent's REAL exec
// whitelist (`testDeps`), a registry and a coordination store under a fixture HOME, the switch's REAL generation journal
// under that HOME's `.ccrc`, a REAL connection-bound identity cell, and a FAKE of the lane's memory port, which
// `watch.ts` implements for real. Every argv the executor composes is recorded at `runCcd`, BEFORE the whitelist, so an
// argv the whitelist would refuse is still seen. The switch starts as a fresh deploy leaves it: the migration's exact
// seed row and no journal (the one bootstrap, generation 0), the node unmeasured at epoch 0. So every case written
// before wave 10 resolves by the legacy marker as it did. FIXTURE HOME ONLY: every path derives from `mkTmp`, and nothing
// here reaches a box.
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { openCoordDb } from '../src/coord/db.js';
import { CoordStore } from '../src/coord/store.js';
import { RECLAIM_PAUSE_MARKER } from '../src/coord/rundefs.js';
import { collectLaneJournalAt, defaultCollectLaneJournalPath } from '../src/coord/collectLaneJournal.js';
import { ACTOR_FLAGS_CAP, COLLECT_CAP, RECLAIM_PAUSE_CAP } from '../src/ccdargv.js';
import {
  COLLECT_LANE_LIVE_MARKER, collectLaneLive, type CollectLaneSettled, type CollectLaneWriteRequest,
  type CollectObservation,
} from '../src/collectLane.js';
import type {
  CollectControlDeps, CollectJob, CollectLanePort, CollectLinkPort, CollectTempRootDeps,
} from '../src/coord/collectTempRoot.js';
import { FleetIdentityCell, type FleetNodeMeasured } from '../src/fleetidentity.js';
import type { FleetIO } from '../src/io.js';
import type { FleetState } from '../src/fleetstate.js';
import type { ExecResult, Runner } from '../src/exec.js';
import type { CollectToken } from '../../shared/api.js';
import { testDeps } from './helpers.js';
import { mkTmp } from './tmpHelpers.js';

export const ID = 'demo-quiet-tarn';
/** Test-only casts: in `server/src`, the collect audit reader alone mints a `CollectToken`. */
export const TOK = 'c'.repeat(64) as CollectToken;
export const TOK2 = 'd'.repeat(64) as CollectToken;
/** The lane's `COLLECT_OBSERVE_INTERVAL_MS` as the executor receives it: an argument, never imported from `watch.ts`. */
export const INTERVAL = 60_000;
/** The fake lane's monotonic clock when a case starts, and the wall clock it pairs with. */
export const T0 = 5_000_000;
export const WALL0 = 1_790_000_000_000;
/** Every verb and capability the executor asks for, as `ccd caps` lists them. */
export const FULL_CAPS: readonly string[] = ['ws-audit', 'ws-collect', COLLECT_CAP, RECLAIM_PAUSE_CAP, ACTOR_FLAGS_CAP];
/** Observation 1, ripe: the token, exactly one interval before the clock. */
export const RIPE: CollectObservation = { token: TOK, arrivedMono: T0 - INTERVAL };

/** The two witness fields the server reads, as ccd prints them: JSON strings. */
export interface Witness { readonly run: string; readonly at: string }

/** `ws-audit --collect`'s document as ccd's audit printer writes it: `resume` only on a resume, `token` only when
 *  collectable, the witness's fields as strings. */
export const auditDoc = (o: {
  readonly id?: string; readonly verdict?: string; readonly token?: string; readonly witness?: Witness | null;
  readonly resume?: string; readonly unmeasured?: string | null; readonly idleAt?: number | null;
} = {}): string => {
  const id = o.id ?? ID;
  const verdict = o.verdict ?? 'collectable';
  const witness = o.witness === undefined || o.witness === null ? null
    : { dev: '64769', ino: '4242', btime: '1789000000', run: o.witness.run, at: o.witness.at };
  return JSON.stringify({
    session: id, mode: 'collect', exists: true,
    collect: { leaf: `/fixture-home/.cc-tmp/${id}`, witness, records: [], newestCtimeNs: '1789000000000000000',
      entries: 3, floorS: 86400, idleAt: o.idleAt ?? null, unmeasured: o.unmeasured ?? null },
    ...(o.resume === undefined ? {} : { resume: o.resume }),
    verdict, detail: verdict === 'collectable' ? '' : `ccd's detail for ${verdict}`,
    ...(verdict === 'collectable' ? { token: o.token ?? TOK } : {}),
  });
};

/** The verb's DONE document for a fresh collection of a present leaf. */
export const collectedDoc = (id: string = ID): string =>
  JSON.stringify({ collected: id, record: `${id}.1790000000000000000.4242`, resumed: false, witness: 'dropped' });

export const openedAtOf = (coord: CoordStore, id: number): number => {
  const read = coord.run(id);
  if (!read.ok || read.run === null) throw new Error(`run ${id} could not be read`);
  return read.run.openedAt;
};

/** The lane's memory port, faked: observation 1, both clear generations, the last-seen-live flag and the two clocks.
 *  `watch.ts` implements the real one over the lane's L1 state. These cases pin the executor against it. */
export interface FakeLane {
  readonly port: CollectLanePort;
  /** Every lane-wide clear the executor reported, in order. */
  readonly clears: string[];
  /** Every flip the executor saw: the effective live boolean of the resolution that flipped. */
  readonly flips: boolean[];
  /** Every resolution the executor asked the lane to compare, flip or not, in order (path-identity spec §5.5). A stop
   *  or a missing capability is never asked. */
  readonly seen: CollectLaneSettled[];
  advance(ms: number): void;
  /** What the lane does on a lane-wide clear (a pause, a missing capability, a moved epoch or an unknown node the job
   *  saw, or a switch flip): every pair goes. */
  clearAll(): void;
  /** What any reset of one id's pair does: the pair goes, and the id's generation moves. */
  resetId(id: string): void;
  /** Put observation 1 in place, with no generation moving. */
  seed(obs: CollectObservation | null): void;
}

export const fakeLane = (o: { readonly obs1: CollectObservation | null; readonly lastSeenLive: boolean }): FakeLane => {
  let mono = T0;
  let laneGen = 0;
  const idGen = new Map<string, number>();
  let obs = o.obs1;
  let lastSeenLive = o.lastSeenLive;
  const clears: string[] = [];
  const flips: boolean[] = [];
  const seen: CollectLaneSettled[] = [];
  const clearAll = (): void => { laneGen += 1; obs = null; };
  return {
    port: {
      clock: () => ({ mono, wall: WALL0 + mono }),
      generations: (id: string) => ({ lane: laneGen, id: idGen.get(id) ?? 0 }),
      observation: () => obs,
      cleared: (why: 'paused' | 'caps' | 'epoch' | 'node') => { clears.push(why); clearAll(); },
      flipped: (r: CollectLaneSettled) => {
        seen.push(r);
        const live = collectLaneLive(r);
        if (live === lastSeenLive) return false;
        lastSeenLive = live;
        flips.push(live);
        clearAll();
        return true;
      },
    },
    clears, flips, seen,
    advance: (ms: number) => { mono += ms; },
    clearAll,
    resetId: (id: string) => { idGen.set(id, (idGen.get(id) ?? 0) + 1); obs = null; },
    seed: (next: CollectObservation | null) => { obs = next; },
  };
};

export interface RigOpts {
  /** `ccd caps` as the agent advertised it; `null` is no list at all. Default `FULL_CAPS`. */
  readonly caps?: readonly string[] | null;
  /** `collect-lane-live` stands in the registry. Default true. */
  readonly live?: boolean;
  /** The lane's last-seen-live flag. Default: what `live` says, so no flip unless a case asks for one. */
  readonly lastSeenLive?: boolean;
  /** `reclaim-paused` stands. */
  readonly paused?: boolean;
  /** Observation 1 in the lane's memory. Default `RIPE`. */
  readonly obs1?: CollectObservation | null;
  /** The witness the audit prints, given the minting run; `null` prints none. Default: the minting run, 1 s after it
   *  opened. */
  readonly witness?: ((minting: { readonly id: number; readonly openedAt: number }) => Witness) | null;
  /** A resume document: the quarantine phase the audit prints. */
  readonly resume?: string;
  /** Wraps the store the executor reads, for a read that fails. */
  readonly coord?: (real: CoordStore) => CollectTempRootDeps['coord'];
}

/** A field of the switch's singleton row as a case plants it (path-identity spec §5.2). It is written straight to
 *  SQLite, never through the store's writer, so a case can build a state the writer would refuse to write: a mismatch,
 *  or a non-seed row beside no journal. */
export type CollectLaneRowPlant =
  Partial<Record<'choice' | 'fleetNodeId' | 'markerRetiredAt' | 'generation' | 'updatedAt', string | number | null>>;
const ROW_COLUMNS = ['choice', 'fleetNodeId', 'markerRetiredAt', 'generation', 'updatedAt'] as const;

export const rig = (o: RigOpts = {}) => {
  const home = mkTmp('ccrc-collect-temp-root-');
  const reg = path.join(home, '.cc-sessions');
  mkdirSync(reg, { recursive: true });
  const coord = new CoordStore(openCoordDb(path.join(home, '.ccrc', 'coord.db')));
  let programs = 0;
  const openRun = (over: { readonly sessionId?: string; readonly claimedBy?: string } = {}): { id: number; program: string } => {
    const program = `w9-collect-${++programs}`;
    const r = coord.openRun({ program, title: program, project: 'demo', wave: 1, waveOf: null,
      claimedBy: over.claimedBy ?? 'demo-coord' });
    if (!('id' in r)) throw new Error(`openRun refused: ${JSON.stringify(r)}`);
    if (over.sessionId !== undefined) coord.bindSession(r.id, over.sessionId);
    return { id: r.id, program };
  };
  const closeRun = (r: { id: number; program: string }): void => {
    const res = coord.closeRun({ runId: r.id, finalState: 'failed', causedBy: 'test', handoffCommit: null,
      program: r.program, viaClosing: false });
    if (!res.ok) throw new Error(`closeRun refused: ${JSON.stringify(res)}`);
  };
  // THE MINTING RUN: finished, and opened before its witness was written.
  const minting = openRun();
  closeRun(minting);
  const witnessOf = o.witness === undefined
    ? (m: { readonly id: number; readonly openedAt: number }): Witness => ({ run: String(m.id), at: String(m.openedAt + 1_000) })
    : o.witness;
  const witness = witnessOf === null ? null : witnessOf({ id: minting.id, openedAt: openedAtOf(coord, minting.id) });
  if (o.live !== false) writeFileSync(path.join(reg, COLLECT_LANE_LIVE_MARKER), '');
  if (o.paused === true) writeFileSync(path.join(reg, RECLAIM_PAUSE_MARKER), '');
  const state: FleetState = { connected: true, downSince: null, rosterFp: null, build: null,
    ccdVerbs: o.caps === undefined ? [...FULL_CAPS] : o.caps === null ? null : [...o.caps] };
  /** Moments inside the executor's awaits where a case changes the world: inside the audit, inside the act, and inside
   *  the Nth registry listing (1 is step 2's, 2 is step 5's), which may also answer `null` or reject. `retire` runs
   *  inside the store writer's call, before its transaction: another writer, landing between the latch's read and its
   *  write. */
  const hooks: {
    audit?: () => void; act?: () => void; listing?: (n: number) => 'null' | 'reject' | void; retire?: () => void;
  } = {};
  let auditAnswer = (): ExecResult => ({ code: 0, stdout: auditDoc({ witness, resume: o.resume }), stderr: '' });
  let actAnswer = (): ExecResult => ({ code: 0, stdout: collectedDoc(), stderr: '' });
  const run: Runner = async (_cmd, args) => {
    if (args[0] === 'ws-audit') { hooks.audit?.(); return auditAnswer(); }
    if (args[0] === 'ws-collect') { hooks.act?.(); return actAnswer(); }
    return { code: 1, stdout: '', stderr: `unscripted ${args[0] ?? ''}` };
  };
  const base = testDeps(home, run);
  let listings = 0;
  /** Registry listings that have RETURNED (answered, null or rejected): the order log's clock. */
  let returned = 0;
  const io: FleetIO = {
    ...base.io,
    readdir: async (p: string, timeoutMs?: number, signal?: AbortSignal) => {
      if (p !== reg) return base.io.readdir(p, timeoutMs, signal);
      listings += 1;
      const what = hooks.listing?.(listings);
      try {
        if (what === 'reject') throw new Error('EIO: the registry listing failed');
        if (what === 'null') return null;
        return await base.io.readdir(p, timeoutMs, signal);
      } finally {
        returned += 1;
      }
    },
  };
  const lane = fakeLane({ obs1: o.obs1 === undefined ? RIPE : o.obs1, lastSeenLive: o.lastSeenLive ?? (o.live !== false) });
  // THE SWITCH (path-identity spec §5.2): the store's row (the migration's exact seed), its generation journal at the
  // fixture HOME's `.ccrc` (absent until a transition), and the identity cell, unmeasured at epoch 0.
  const journal = collectLaneJournalAt(defaultCollectLaneJournalPath(path.join(home, '.ccrc')));
  const identity = new FleetIdentityCell();
  /** Every request the executor made of the store's one writer, in order. */
  const writes: CollectLaneWriteRequest[] = [];
  /** The latch row bodies the executor handed the lane (`latchRetired`), in order. */
  const latches: string[] = [];
  /** THE ORDER LOG: each control, identity and epoch read the executor made, and each retire, as `<what>@<n>`, where
   *  `n` is the registry listings that had returned when it was made (1 after step 2's, 2 after step 5's, the job's
   *  last await). The store's own reads inside its transaction go through `journal` too, and are logged. */
  const reads: string[] = [];
  const control: CollectControlDeps = {
    coord: {
      collectLaneRow: () => { reads.push(`row@${returned}`); return coord.collectLaneRow(); },
      setCollectLane: (req, at, j) => {
        writes.push(req);
        reads.push(`retire@${returned}`);
        hooks.retire?.();
        return coord.setCollectLane(req, at, j);
      },
    },
    journal: {
      read: () => { reads.push(`journal@${returned}`); return journal.read(); },
      appendGeneration: (g: number) => { journal.appendGeneration(g); },
    },
    wallNow: () => lane.port.clock().wall,
    latchRetired: (body: string) => { latches.push(body); },
  };
  const link: CollectLinkPort = {
    epochNow: () => { reads.push(`epoch@${returned}`); return identity.epochNow(); },
    current: () => { reads.push(`node@${returned}`); return identity.current(); },
  };
  let visible = false;
  const attempts: string[][] = [];
  const deps: CollectTempRootDeps = {
    coord: o.coord?.(coord) ?? coord, io, cfg: base.cfg, fleetState: state,
    runCcd: async (argv) => { attempts.push([...argv]); return base.runCcd(argv); },
    presence: { isVisible: (id: string) => visible && id === ID },
    lane: lane.port, observeIntervalMs: INTERVAL, control, link,
  };
  return {
    reg, coord, deps, state, lane, hooks, attempts, witness, minting, openRun, closeRun,
    journal, identity, writes, latches, reads,
    see: (v: boolean): void => { visible = v; },
    raise: (name: string): void => { writeFileSync(path.join(reg, name), ''); },
    lower: (name: string): void => { rmSync(path.join(reg, name), { force: true }); },
    answerAudit: (f: () => ExecResult): void => { auditAnswer = f; },
    answerAct: (f: () => ExecResult): void => { actAnswer = f; },
    /** The job as the lane queues it: the id, and the epoch the cell stands at NOW (path-identity spec §5.5). */
    job: (id: string = ID): CollectJob => ({ id, epoch: identity.epochNow() }),
    /** Plants row fields straight into SQLite (`CollectLaneRowPlant`). */
    setRow: (over: CollectLaneRowPlant): void => {
      for (const col of ROW_COLUMNS) {
        const v = over[col];
        if (v !== undefined) coord.db.prepare(`UPDATE collect_lane_settings SET ${col} = ? WHERE id = 1`).run(v);
      }
    },
    /** The journal file's bytes, written whole; null removes it (a proven ENOENT: the bootstrap's missing journal). */
    setJournal: (text: string | null): void => {
      if (text === null) { rmSync(journal.logPath, { force: true }); return; }
      mkdirSync(path.dirname(journal.logPath), { recursive: true });
      writeFileSync(journal.logPath, text);
    },
    /** A measurement published under the CURRENT epoch, as the inventory publishes one. */
    setNode: (m: FleetNodeMeasured): void => { identity.publish(identity.epochNow(), m); },
    /** A reconnect: the epoch rises, and the node is unmeasured until it is measured again under the new epoch. */
    bumpEpoch: (): number => identity.invalidate('link-down'),
  };
};
export type Rig = ReturnType<typeof rig>;

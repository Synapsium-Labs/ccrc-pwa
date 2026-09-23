// The inventory sweep (design 2026-09-20 §8) on FIXTURE HOMEs only: every
// ~/.ccrc file this module reads is planted under an `mkTmp` home, every
// coord.db is that home's own, and the fleet node is either `localIO` over the
// fixture, a scripted io spread over `localIO` (the `limits.test.ts:311`
// idiom), or a real in-process agent (`remoteHelpers.ts`) over a real
// loopback WS. Nothing here reads the live $HOME.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { chmodSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
import type { RunningAgent } from '../../agent/src/server.js';
import { NODE_FILES, type NodeFileKey } from '../../shared/agent-protocol.js';
import { IN_FLIGHT_UPDATE_PHASES } from '../../shared/api.js';
import { parseBuildInfo } from '../../shared/buildinfo.js';
import { Bus } from '../src/bus.js';
import { openCoordDb } from '../src/coord/db.js';
import { CoordStore, type NodeMeasurement, type NodeReport, type NodeRow } from '../src/coord/store.js';
import type { FleetState } from '../src/fleetstate.js';
import { localIO, type FleetIO, type MeasuredRead } from '../src/io.js';
import type { ConnectedFleet } from '../src/remote/client.js';
import type { Deps } from '../src/server.js';
import {
  FLEET_LABEL, NODE_FILE_CAP_BYTES, REPORT_DETAIL_MAX, SERVER_LABEL,
  buildInfoOfRow, capsFrom, installFrom, measurementFrom, nodeIdFrom, printableDetail, readNodeFile, readNodeFiles,
  reportFrom, stampFrom, sweepInventory, sweepPlanFor, tagLineFrom,
  type InventoryDeps, type NodeFileRead, type NodeFileReads, type SweepOutcome,
} from '../src/update/inventory.js';
import { FleetWatcher } from '../src/watch.js';
import { testDeps } from './helpers.js';
import { bootAgent, connectToAgent, makeFixture } from './remoteHelpers.js';
import { mkTmp } from './tmpHelpers.js';

const SHA = '0123456789abcdef0123456789abcdef01234567';
const OTHER_SHA = 'fedcba9876543210fedcba9876543210fedcba98';
const BUILT = '2026-09-22T10:00:00Z';
const U1 = '0f1e2d3c-4b5a-4978-8796-a5b4c3d2e1f0';
const U2 = '11111111-2222-4333-8444-555555555555';
const T_S = 1_758_500_000;          // the node's clock: update.json speaks unix SECONDS
const NOW = (T_S + 120) * 1000;     // the sweep's clock: every coord column is ms

type Measured = Exclude<NodeFileKey, 'projection'>;
const ok = (content: string): NodeFileRead => ({ ok: true, content });
const ABSENT: NodeFileRead = { ok: false, reason: 'absent' };
const UNREADABLE: NodeFileRead = { ok: false, reason: 'unreadable' };
const TOO_LARGE: NodeFileRead = { ok: false, reason: 'too-large' };

const stampJson = (over: Record<string, unknown> = {}): string =>
  `${JSON.stringify({ sha: SHA, ref: 'main', builtAt: BUILT, dirty: false, version: 'v0.0.12', ...over })}\n`;
const reportJson = (over: Record<string, unknown> = {}): string =>
  `${JSON.stringify({ target: 'v0.0.12', phase: 'done', startedAt: T_S, updatedAt: T_S + 90, detail: 'converged', from: 'pwa', ...over })}\n`;
const NO_ID: Partial<Record<Measured, string>> = {
  stamp: stampJson(), installed: `${SHA}\n`, caps: 'os linux\nverify\nnode-id\nfloor\n',
  floor: 'v0.0.12\n', previous: 'v0.0.11\n',
};
const FULL: Partial<Record<Measured, string>> = { ...NO_ID, nodeId: `${U1}\n` };

function plant(ccrcDir: string, files: Partial<Record<Measured, string>>): void {
  mkdirSync(ccrcDir, { recursive: true });
  for (const [key, body] of Object.entries(files) as [Measured, string][]) {
    writeFileSync(path.join(ccrcDir, NODE_FILES[key]), body);
  }
}
const unplant = (ccrcDir: string, key: Measured): void => rmSync(path.join(ccrcDir, NODE_FILES[key]), { force: true });

/** A fixture HOME with its own coord database — never the live one. */
function box(prefix: string): { ccrcDir: string; db: DatabaseSync; store: CoordStore } {
  const ccrcDir = path.join(mkTmp(prefix), '.ccrc');
  const db = openCoordDb(path.join(ccrcDir, 'coord.db'));
  return { ccrcDir, db, store: new CoordStore(db) };
}
const localDeps = (b: { ccrcDir: string; store: CoordStore }): InventoryDeps =>
  ({ store: b.store, localIo: localIO, ccrcDir: b.ccrcDir, role: 'both', fleet: null });
/** The server row's io in the remote-arm cases: it has none of the files, so
 *  the fleet row alone reads the fixture (both rows share one ccrcDir — the
 *  same-absolute-path assumption every remote read makes). */
const NOTHING_IO: FleetIO = { ...localIO, lstatMeasured: async () => ({ ok: false as const, reason: 'absent' as const }) };
const fleetState = (over: Partial<FleetState> = {}): FleetState =>
  ({ connected: true, downSince: null, ccdVerbs: null, rosterFp: null, build: null, ...over });
const remoteDeps = (store: CoordStore, ccrcDir: string, state: FleetState, io: FleetIO = localIO): InventoryDeps =>
  ({ store, localIo: NOTHING_IO, ccrcDir, role: 'server', fleet: { io, state } });
/** W4's dispatchNode, planted: nothing in W2 acquires a lease (Global Constraints). */
const plantLease = (db: DatabaseSync, nodeId: string, state: string, target: string, startedAt: number): void => {
  db.prepare('UPDATE nodes SET updateState = ?, updateTarget = ?, updateStartedAt = ? WHERE nodeId = ?')
    .run(state, target, startedAt, nodeId);
};

const ROW: NodeRow = {
  nodeId: U1, role: 'fleet', label: FLEET_LABEL,
  currentVersion: 'v0.0.12', currentSha: SHA, currentRef: 'main', currentBuiltAt: BUILT, currentDirty: false,
  stampRead: 'ok', installState: 'complete', provenance: 'verified',
  caps: ['verify', 'node-id', 'floor'], agentOps: [], highestVersion: 'v0.0.12', previousVersion: 'v0.0.11', os: 'linux',
  measuredAt: NOW - 60_000, reachable: true, unreachableSince: null,
  reportedPhase: null, reportedTarget: null, reportedStartedAt: null, reportedUpdatedAt: null, reportedDetail: null,
  updateState: 'idle', updateTarget: null, updateStartedAt: null, updateDetail: null,
  channel: null, desiredTag: null, resolveDetail: null,
  requestedTag: null, requestedKind: null, requestedAt: null,
  supersededBy: null,
};
const meas = (over: Partial<NodeMeasurement> = {}): NodeMeasurement => ({
  nodeId: U1, role: 'fleet', label: FLEET_LABEL,
  currentVersion: 'v0.0.12', currentSha: SHA, currentRef: 'main', currentBuiltAt: BUILT, currentDirty: false,
  stampRead: 'ok', installState: 'complete', provenance: 'verified', caps: ['verify', 'node-id', 'floor'], agentOps: [],
  highestVersion: 'v0.0.12', previousVersion: 'v0.0.11', os: 'linux', measuredAt: NOW, report: null, ...over,
});
const rep = (over: Partial<NodeReport> = {}): NodeReport => ({
  phase: 'done', target: 'v0.0.12', startedAt: T_S * 1000, updatedAt: (T_S + 90) * 1000, detail: 'converged', ...over,
});

describe('readNodeFile — lstat-gated, size-capped, bounded (§18 "reads refuse a non-regular file", "reads are bounded")', () => {
  it('a regular file reads; a missing one is absent', async () => {
    const b = box('ccrc-inv-read-');
    plant(b.ccrcDir, { floor: 'v0.0.12\n' });
    expect(await readNodeFile(localIO, path.join(b.ccrcDir, 'floor'), null)).toEqual(ok('v0.0.12\n'));
    expect(await readNodeFile(localIO, path.join(b.ccrcDir, 'previous'), null)).toEqual(ABSENT);
  });

  it('a symlinked build.json is unreadable and NEVER followed — even onto a perfectly good stamp', async () => {
    const b = box('ccrc-inv-symlink-');
    mkdirSync(b.ccrcDir, { recursive: true });
    // The target is a VALID stamp, so a reader that follows the link answers `ok`
    // — the one outcome that tells a removed lstat gate from a kept one.
    writeFileSync(path.join(b.ccrcDir, 'stamp-elsewhere.json'), stampJson());
    symlinkSync(path.join(b.ccrcDir, 'stamp-elsewhere.json'), path.join(b.ccrcDir, 'build.json'));
    const read = await readNodeFile(localIO, path.join(b.ccrcDir, 'build.json'), null);
    expect(read).toEqual(UNREADABLE);
    expect(stampFrom(read)).toEqual({ stampRead: 'unreadable', build: null });
  });

  it('a directory named build.json is unreadable, not absent', async () => {
    const b = box('ccrc-inv-dir-');
    mkdirSync(path.join(b.ccrcDir, 'build.json'), { recursive: true });
    expect(await readNodeFile(localIO, path.join(b.ccrcDir, 'build.json'), null)).toEqual(UNREADABLE);
  });

  it('a 70 KiB stamp is refused by its size before a byte is read, and reads malformed', async () => {
    const b = box('ccrc-inv-big-');
    plant(b.ccrcDir, { stamp: stampJson({ ref: 'x'.repeat(70 * 1024) }) });
    let reads = 0;
    const counting: FleetIO = {
      ...localIO,
      readFileMeasured: async (p: string, t?: number, s?: AbortSignal): Promise<MeasuredRead> => {
        reads += 1;
        return localIO.readFileMeasured(p, t, s);
      },
    };
    const read = await readNodeFile(counting, path.join(b.ccrcDir, 'build.json'), null);
    expect(read).toEqual(TOO_LARGE);
    expect(reads).toBe(0);
    expect(stampFrom(read).stampRead).toBe('malformed');
  });

  it('a file that grows between the stat and the read is still too-large — UTF-8 bytes, not string length (D-3177)', async () => {
    const b = box('ccrc-inv-grow-');
    plant(b.ccrcDir, { caps: 'os linux\n' });
    const grown = (content: string): FleetIO => ({ ...localIO, readFileMeasured: async () => ({ ok: true as const, content }) });
    const p = path.join(b.ccrcDir, 'ccrc-caps');
    expect(await readNodeFile(grown('x'.repeat(70 * 1024)), p, null)).toEqual(TOO_LARGE);
    expect(await readNodeFile(grown('x'.repeat(NODE_FILE_CAP_BYTES)), p, null)).toEqual(ok('x'.repeat(NODE_FILE_CAP_BYTES)));
    // 32769 characters, 65538 bytes: a `.length` check would admit it.
    expect(await readNodeFile(grown('é'.repeat(32_769)), p, null)).toEqual(TOO_LARGE);
  });

  it('an lstat this io cannot answer (an agent too old for the op) reads unreadable, never absent, and reads nothing (D-3178)', async () => {
    const b = box('ccrc-inv-unmeasured-');
    plant(b.ccrcDir, FULL);
    let reads = 0;
    const old: FleetIO = {
      ...localIO,
      lstatMeasured: async () => ({ ok: false as const, reason: 'unmeasured' as const }),
      readFileMeasured: async (p: string, t?: number, s?: AbortSignal): Promise<MeasuredRead> => {
        reads += 1;
        return localIO.readFileMeasured(p, t, s);
      },
    };
    const read = await readNodeFile(old, path.join(b.ccrcDir, 'build.json'), null);
    expect(read).toEqual(UNREADABLE);
    expect(reads).toBe(0);
    expect(stampFrom(read).stampRead).toBe('unreadable');
  });

  it('EACCES through a scripted io reads unreadable (the case that runs as root too)', async () => {
    const b = box('ccrc-inv-eacces-io-');
    plant(b.ccrcDir, FULL);
    const denied: FleetIO = { ...localIO, readFileMeasured: async () => ({ ok: false as const, reason: 'unreadable' as const }) };
    expect(await readNodeFile(denied, path.join(b.ccrcDir, 'build.json'), null)).toEqual(UNREADABLE);
  });

  it('a read that never answers is unreadable inside the budget; no budget means no measurement', async () => {
    const b = box('ccrc-inv-hang-');
    plant(b.ccrcDir, FULL);
    const hung: FleetIO = { ...localIO, readFileMeasured: (): Promise<MeasuredRead> => new Promise(() => {}) };
    const t0 = Date.now();
    const reads = await readNodeFiles(hung, b.ccrcDir, 50);
    expect(Date.now() - t0).toBeLessThan(2000);
    expect(Object.keys(reads).sort()).toEqual(['caps', 'floor', 'installed', 'nodeId', 'previous', 'report', 'stamp']);
    expect(reads.stamp).toEqual(UNREADABLE);
    let calls = 0;
    const counting: FleetIO = { ...localIO, lstatMeasured: async (p: string) => { calls += 1; return localIO.lstatMeasured(p); } };
    const none = await readNodeFiles(counting, b.ccrcDir, 0);
    expect(Object.values(none).every((r) => !r.ok && r.reason === 'unreadable')).toBe(true);
    expect(calls).toBe(0);
  });
});

describe('the validators (§8 "Validation", §18 "reads are bounded and validated")', () => {
  it('stampFrom: ok with the whole BuildInfo; no version is still ok; every other failure is its own word', () => {
    expect(stampFrom(ok(stampJson()))).toEqual({ stampRead: 'ok', build: parseBuildInfo(stampJson()) });
    const unversioned = stampFrom(ok(stampJson({ version: undefined })));
    expect(unversioned.stampRead).toBe('ok');
    expect(unversioned.build?.version).toBeUndefined();
    expect(stampFrom(ok('not json at all'))).toEqual({ stampRead: 'malformed', build: null });
    expect(stampFrom(ok(stampJson({ version: '0.0.12' }))).stampRead).toBe('malformed');
    expect(stampFrom(ok(stampJson({ version: 'v0.0.12 ' }))).stampRead).toBe('malformed');
    expect(stampFrom(ok(stampJson({ ref: 'main\u0007' }))).stampRead).toBe('malformed');
    expect(stampFrom(ok(stampJson({ ref: 'r'.repeat(201) }))).stampRead).toBe('malformed');
    expect(stampFrom(ok(stampJson({ builtAt: '2026-09-22\n10:00' }))).stampRead).toBe('malformed');
    expect(stampFrom(ok(stampJson({ sha: 'é'.repeat(40) }))).stampRead).toBe('malformed');
    expect(stampFrom(ABSENT)).toEqual({ stampRead: 'absent', build: null });
    expect(stampFrom(UNREADABLE)).toEqual({ stampRead: 'unreadable', build: null });
    expect(stampFrom(TOO_LARGE)).toEqual({ stampRead: 'malformed', build: null });
  });

  it('capsFrom: os then words; CRLF only as a terminator; one bad word drops the whole file', () => {
    expect(capsFrom(ok('os linux\nverify\nnode-id\nfloor\n'))).toEqual({ os: 'linux', caps: ['verify', 'node-id', 'floor'] });
    expect(capsFrom(ok('os darwin\r\nverify\r\n'))).toEqual({ os: 'darwin', caps: ['verify'] });
    expect(capsFrom(ok('os linux\n'))).toEqual({ os: 'linux', caps: [] });
    const refused = { os: 'unknown', caps: [] };
    expect(capsFrom(ABSENT)).toEqual(refused);
    expect(capsFrom(UNREADABLE)).toEqual(refused);
    expect(capsFrom(TOO_LARGE)).toEqual(refused);
    expect(capsFrom(ok('CCRC_AGENT_TOKEN=not-a-real-token\n'))).toEqual(refused);   // agent.env's shape
    expect(capsFrom(ok('os linux\nverify\nBAD\n'))).toEqual(refused);
    expect(capsFrom(ok('os linux\nverify \n'))).toEqual(refused);
    expect(capsFrom(ok('os linux\nver\rify\n'))).toEqual(refused);
    expect(capsFrom(ok('os linux\nver\u0000ify\n'))).toEqual(refused);
    expect(capsFrom(ok('os linux\n\nverify\n'))).toEqual(refused);
    expect(capsFrom(ok('os windows\nverify\n'))).toEqual(refused);
    const words = (n: number): string => Array.from({ length: n }, (_, i) => `w${i}`).join('\n');
    expect(capsFrom(ok(`os linux\n${words(32)}\n`)).caps).toHaveLength(32);
    expect(capsFrom(ok(`os linux\n${words(33)}\n`))).toEqual(refused);
  });

  it('tagLineFrom and nodeIdFrom: line 1 through the one guard, or null', () => {
    expect(tagLineFrom(ok('v0.0.12\n'))).toBe('v0.0.12');
    expect(tagLineFrom(ok('v0.0.12\r\n'))).toBe('v0.0.12');
    for (const bad of ['0.0.12\n', 'v0.0.12 \n', 'latest\n', '', 'v0.0\n']) expect(tagLineFrom(ok(bad)), bad).toBeNull();
    expect(tagLineFrom(ABSENT)).toBeNull();
    expect(tagLineFrom(UNREADABLE)).toBeNull();
    expect(nodeIdFrom(ok(`${U1}\n`))).toBe(U1);
    expect(nodeIdFrom(ok(`${U1.toUpperCase()}\n`))).toBeNull();
    expect(nodeIdFrom(ok(`${U1} \n`))).toBeNull();
    expect(nodeIdFrom(ok('not-a-uuid\n'))).toBeNull();
    expect(nodeIdFrom(ABSENT)).toBeNull();
  });

  it('installFrom: line 1 against the stamp sha; line 2 is provenance, and only a complete install has one', () => {
    const stamp = stampFrom(ok(stampJson()));
    expect(installFrom(ok(`${SHA}\nunsigned\n`), stamp, ['verify'])).toEqual({ installState: 'complete', provenance: 'unverified' });
    expect(installFrom(ok(`${SHA}\n`), stamp, ['verify', 'node-id', 'floor'])).toEqual({ installState: 'complete', provenance: 'verified' });
    expect(installFrom(ok(`${SHA}\n`), stamp, [])).toEqual({ installState: 'complete', provenance: 'unknown' });
    expect(installFrom(ok(`${SHA}\nsomething\n`), stamp, ['verify'])).toEqual({ installState: 'complete', provenance: 'unknown' });
    // A deploy.sh over an installed box: the marker names the OLD tree — its line 2 says nothing about this one.
    expect(installFrom(ok(`${OTHER_SHA}\n`), stamp, ['verify'])).toEqual({ installState: 'incomplete', provenance: 'unknown' });
    expect(installFrom(ABSENT, stamp, ['verify'])).toEqual({ installState: 'incomplete', provenance: 'unknown' });
    expect(installFrom(UNREADABLE, stamp, ['verify'])).toEqual({ installState: 'unknown', provenance: 'unknown' });
    expect(installFrom(ok(`${SHA}\n`), stampFrom(UNREADABLE), ['verify'])).toEqual({ installState: 'unknown', provenance: 'unknown' });
    expect(installFrom(ok(`${SHA}\n`), stampFrom(ABSENT), ['verify'])).toEqual({ installState: 'unknown', provenance: 'unknown' });
  });

  it('reportFrom: SECONDS in, ms out; a ms value is refused, not multiplied; everything else validated', () => {
    expect(reportFrom(ABSENT)).toBeNull();
    expect(reportFrom(ok(reportJson({ phase: 'installing' })))).toEqual({
      phase: 'installing', target: 'v0.0.12', startedAt: T_S * 1000, updatedAt: (T_S + 90) * 1000, detail: 'converged',
    });
    expect(reportFrom(ok(reportJson({ startedAt: T_S * 1000 })))?.startedAt).toBeNull();   // 13 digits: a ms value
    expect(reportFrom(ok(reportJson({ startedAt: -1 })))?.startedAt).toBeNull();
    expect(reportFrom(ok(reportJson({ startedAt: 1.5 })))?.startedAt).toBeNull();
    expect(reportFrom(ok(reportJson({ startedAt: String(T_S) })))?.startedAt).toBeNull();
    expect(reportFrom(ok(reportJson({ phase: 'exploding' })))?.phase).toBe('unknown');
    expect(reportFrom(ok(reportJson({ target: '0.0.12' })))?.target).toBeNull();
    expect(reportFrom(ok(reportJson({ detail: `\u001b[31m${'y'.repeat(500)}` })))?.detail).toHaveLength(REPORT_DETAIL_MAX);
    expect(reportFrom(ok(reportJson({ detail: 7 })))?.detail).toBeNull();
    // Additive discipline: the reader reads its five fields BY NAME, so a key a
    // newer writer adds (wave 4's `pid`, a departure of wave 4's plan) is ignored —
    // never a reason to read the report as `unknown`.
    expect(reportFrom(ok(reportJson({ pid: 4242, note: 'from a newer writer' })))).toEqual(reportFrom(ok(reportJson())));
    expect(reportFrom(ok(reportJson({ pid: 4242 })))?.phase).toBe('done');
    const unknown = { phase: 'unknown', target: null, startedAt: null, updatedAt: null, detail: null };
    expect(reportFrom(ok('{ torn'))).toEqual(unknown);
    expect(reportFrom(ok('[]'))).toEqual(unknown);
    expect(reportFrom(UNREADABLE)).toEqual(unknown);
    expect(reportFrom(TOO_LARGE)).toEqual(unknown);
  });

  it('printableDetail keeps printable ASCII only, bounded', () => {
    expect(printableDetail('a\u0000b\ncéd')).toBe('a b c d');
    expect(printableDetail('  spaced  ')).toBe('spaced');
    expect(printableDetail('z'.repeat(500))).toHaveLength(REPORT_DETAIL_MAX);
  });
});

describe('measurementFrom and buildInfoOfRow (§18 "a full BuildInfo round-trips")', () => {
  const reads = (over: Partial<NodeFileReads> = {}): NodeFileReads => ({
    stamp: ok(stampJson()), installed: ok(`${SHA}\n`), caps: ok('os linux\nverify\nnode-id\nfloor\n'),
    floor: ok('v0.0.12\n'), previous: ok('v0.0.11\n'), nodeId: ok(`${U1}\n`), report: ABSENT, ...over,
  });

  it('a full node maps every column, whole-object', () => {
    expect(measurementFrom(reads(), { label: SERVER_LABEL, role: 'both', agentOps: null }, NOW)).toEqual({
      nodeId: U1, role: 'both', label: SERVER_LABEL,
      currentVersion: 'v0.0.12', currentSha: SHA, currentRef: 'main', currentBuiltAt: BUILT, currentDirty: false,
      stampRead: 'ok', installState: 'complete', provenance: 'verified', caps: ['verify', 'node-id', 'floor'],
      agentOps: null, highestVersion: 'v0.0.12', previousVersion: 'v0.0.11', os: 'linux', measuredAt: NOW, report: null,
    });
  });

  it('no node-id keys by label with installState unknown; agentOps is validated again and [] when refused', () => {
    const m = measurementFrom(reads({ nodeId: ABSENT }), { label: FLEET_LABEL, role: 'fleet', agentOps: ['update'] }, NOW);
    // D-3200/finding 3: installFrom alone would answer 'verified' here (the
    // marker's sha matches and caps say 'verify') — installState 'unknown'
    // must still force provenance 'unknown', never a verdict about a tree
    // this row cannot even name.
    expect(m).toMatchObject({ nodeId: FLEET_LABEL, installState: 'unknown', provenance: 'unknown', agentOps: ['update'] });
    expect(measurementFrom(reads(), { label: FLEET_LABEL, role: 'fleet', agentOps: ['Bad Word'] }, NOW).agentOps).toEqual([]);
    expect(measurementFrom(reads(), { label: FLEET_LABEL, role: 'fleet', agentOps: [] }, NOW).agentOps).toEqual([]);
  });

  it('a caps file carrying a secret file\'s bytes leaves nothing of them in the measurement', () => {
    const m = measurementFrom(reads({ caps: ok('CCRC_AGENT_TOKEN=not-a-real-token\n') }), { label: SERVER_LABEL, role: 'both', agentOps: null }, NOW);
    expect(m).toMatchObject({ caps: [], os: 'unknown' });
    expect(JSON.stringify(m)).not.toContain('not-a-real-token');
  });

  it('buildInfoOfRow returns the parser\'s own shape, and null for anything not ok', () => {
    expect(buildInfoOfRow({ ...ROW, currentDirty: true })).toEqual(parseBuildInfo(stampJson({ dirty: true })));
    expect(Object.keys(buildInfoOfRow({ ...ROW, currentVersion: null })!)).toEqual(['sha', 'ref', 'builtAt', 'dirty']);
    expect(buildInfoOfRow({ ...ROW, stampRead: 'unreadable' })).toBeNull();
    expect(buildInfoOfRow({ ...ROW, currentDirty: null })).toBeNull();
    expect(buildInfoOfRow({ ...ROW, currentSha: null })).toBeNull();
  });
});

describe('sweepPlanFor — the §8 phase table, the precedence, and only a changed report acts', () => {
  const T0 = T_S * 1000 + 500;   // the lease was taken half a second into the report's own second
  const busy = (over: Partial<NodeRow> = {}): NodeRow =>
    ({ ...ROW, updateState: 'applying', updateTarget: 'v0.0.12', updateStartedAt: T0, ...over });
  const withReport = (r: Partial<NodeReport>, over: Partial<NodeMeasurement> = {}): NodeMeasurement => meas({ report: rep(r), ...over });
  const seen = (r: NodeReport): Partial<NodeRow> => ({
    reportedPhase: r.phase, reportedTarget: r.target, reportedStartedAt: r.startedAt,
    reportedUpdatedAt: r.updatedAt, reportedDetail: r.detail,
  });

  it('no report, an unchanged report, a settled row: nothing moves', () => {
    expect(sweepPlanFor(busy(), meas())).toEqual({ lease: { kind: 'none', why: 'no-report' }, refuse: null });
    expect(sweepPlanFor(busy(seen(rep())), withReport({}))).toEqual({ lease: { kind: 'none', why: 'unchanged-report' }, refuse: null });
    expect(sweepPlanFor(ROW, withReport({})).lease).toEqual({ kind: 'none', why: 'not-busy' });
    expect(sweepPlanFor(null, withReport({})).lease).toEqual({ kind: 'none', why: 'not-busy' });
  });

  it.each([...IN_FLIGHT_UPDATE_PHASES])('%s leaves a busy lease busy (pending → applying is the dispatcher\'s write)', (phase) => {
    expect(sweepPlanFor(busy(), withReport({ phase })).lease).toEqual({ kind: 'none', why: 'in-flight' });
  });

  it('done at the measured version settles; done at any other version is failed: stamp-mismatch', () => {
    expect(sweepPlanFor(busy(), withReport({})).lease).toEqual({ kind: 'settle', detail: 'done: v0.0.12' });
    expect(sweepPlanFor(busy(), withReport({}, { currentVersion: 'v0.0.11' })).lease)
      .toEqual({ kind: 'release', to: 'failed', detail: 'stamp-mismatch' });
    expect(sweepPlanFor(busy(), withReport({}, { currentVersion: null })).lease)
      .toEqual({ kind: 'release', to: 'failed', detail: 'stamp-mismatch' });
    expect(sweepPlanFor(busy(), withReport({ target: null }, { currentVersion: null })).lease)
      .toEqual({ kind: 'release', to: 'failed', detail: 'stamp-mismatch' });
  });

  it('failed and reverted release to the same word, carrying the report\'s detail (or the word)', () => {
    expect(sweepPlanFor(busy(), withReport({ phase: 'failed', detail: 'spine died at _inst_skills' })).lease)
      .toEqual({ kind: 'release', to: 'failed', detail: 'spine died at _inst_skills' });
    expect(sweepPlanFor(busy(), withReport({ phase: 'reverted', detail: null })).lease)
      .toEqual({ kind: 'release', to: 'reverted', detail: 'reverted' });
  });

  it('an out-of-vocabulary phase leaves the lease alone (the deadline that ends it is W4\'s)', () => {
    expect(sweepPlanFor(busy(), withReport({ phase: 'unknown' })).lease).toEqual({ kind: 'none', why: 'unknown-phase' });
  });

  it('a previous run\'s report never moves the lease — and the lease\'s own second is not a previous run', () => {
    expect(sweepPlanFor(busy(), withReport({ startedAt: (T_S - 3600) * 1000 })).lease).toEqual({ kind: 'none', why: 'stale-report' });
    expect(sweepPlanFor(busy(), withReport({ startedAt: (T_S - 1) * 1000 })).lease).toEqual({ kind: 'none', why: 'stale-report' });
    // D-3199: the report says T_S seconds, the lease was taken at T_S*1000+500 ms.
    expect(sweepPlanFor(busy(), withReport({ startedAt: T_S * 1000 })).lease).toEqual({ kind: 'settle', detail: 'done: v0.0.12' });
  });

  it('a NULL on either side of the precedence is not stale', () => {
    expect(sweepPlanFor(busy({ updateStartedAt: null }), withReport({ startedAt: (T_S - 3600) * 1000 })).lease.kind).toBe('settle');
    expect(sweepPlanFor(busy(), withReport({ startedAt: null })).lease.kind).toBe('settle');
  });

  it('a changed failed report whose detail begins provenance: refuses (node, target), busy or not — once', () => {
    const r = { phase: 'failed' as const, detail: 'provenance: the bundle names another workflow' };
    expect(sweepPlanFor(null, withReport(r)).refuse).toEqual({ tag: 'v0.0.12', detail: r.detail });
    expect(sweepPlanFor(ROW, withReport(r)).refuse).toEqual({ tag: 'v0.0.12', detail: r.detail });
    expect(sweepPlanFor(busy(), withReport(r))).toEqual({
      lease: { kind: 'release', to: 'failed', detail: r.detail }, refuse: { tag: 'v0.0.12', detail: r.detail },
    });
    expect(sweepPlanFor({ ...ROW, ...seen(rep(r)) }, withReport(r)).refuse).toBeNull();   // the standing report
    expect(sweepPlanFor(null, withReport({ ...r, target: null })).refuse).toBeNull();
    expect(sweepPlanFor(null, withReport({ phase: 'failed', detail: 'spine died' })).refuse).toBeNull();
    expect(sweepPlanFor(null, withReport({ phase: 'reverted', detail: 'provenance: x' })).refuse).toBeNull();
  });
});

describe('sweepInventory — the server row, rows and keys (§8 "Row identity, re-keying, freshness")', () => {
  it('a full stamp fills all five current* columns and round-trips — dirty included', async () => {
    const b = box('ccrc-inv-full-');
    plant(b.ccrcDir, { ...FULL, stamp: stampJson({ dirty: true }) });
    expect(await sweepInventory(localDeps(b), NOW)).toEqual([
      { label: SERVER_LABEL, result: 'measured', nodeId: U1, lease: 'none', refused: false },
    ]);
    const row = b.store.node(U1)!;
    expect(row).toMatchObject({
      role: 'both', label: SERVER_LABEL, currentVersion: 'v0.0.12', currentSha: SHA, currentRef: 'main',
      currentBuiltAt: BUILT, currentDirty: true, stampRead: 'ok', installState: 'complete', provenance: 'verified',
      caps: ['verify', 'node-id', 'floor'], agentOps: null, highestVersion: 'v0.0.12', previousVersion: 'v0.0.11',
      os: 'linux', measuredAt: NOW, reachable: true, unreachableSince: null, updateState: 'idle',
    });
    expect(buildInfoOfRow(row)).toEqual(parseBuildInfo(stampJson({ dirty: true })));
  });

  it.skipIf(process.getuid?.() === 0)('EACCES on the stamp is unreadable, never ok and never absent — and measuredAt is set', async () => {
    const b = box('ccrc-inv-eacces-');
    plant(b.ccrcDir, FULL);
    chmodSync(path.join(b.ccrcDir, 'build.json'), 0o000);
    await sweepInventory(localDeps(b), NOW);
    expect(b.store.node(U1)).toMatchObject({
      stampRead: 'unreadable', currentSha: null, currentVersion: null, currentDirty: null,
      installState: 'unknown', provenance: 'unknown', measuredAt: NOW,
    });
  });

  it('a parseable stamp with no version is ok with currentVersion NULL; a floor that is not a tag is NULL', async () => {
    const b = box('ccrc-inv-unversioned-');
    plant(b.ccrcDir, { ...FULL, stamp: stampJson({ version: undefined }), floor: 'latest\n' });
    await sweepInventory(localDeps(b), NOW);
    expect(b.store.node(U1)).toMatchObject({ stampRead: 'ok', currentVersion: null, currentSha: SHA, highestVersion: null });
  });

  it('missing node-id → keyed by label, installState unknown; absent ccrc-caps → [] and os unknown', async () => {
    const b = box('ccrc-inv-noid-');
    plant(b.ccrcDir, { stamp: stampJson(), installed: `${SHA}\n` });
    await sweepInventory(localDeps(b), NOW);
    expect(b.store.nodes().map((n) => n.nodeId)).toEqual([SERVER_LABEL]);
    expect(b.store.node(SERVER_LABEL)).toMatchObject({ installState: 'unknown', caps: [], os: 'unknown', highestVersion: null });
  });

  it('a node-id appearing on a labelled row re-keys it in place: one row, its history carried (§18 "a label row re-keys")', async () => {
    const b = box('ccrc-inv-rekey-');
    plant(b.ccrcDir, NO_ID);
    await sweepInventory(localDeps(b), NOW - 60_000);
    expect(b.store.refuseRelease(SERVER_LABEL, 'v0.0.9', NOW - 30_000, 'provenance: earlier')).toMatchObject({ ok: true, inserted: true });
    plant(b.ccrcDir, { nodeId: `${U1}\n` });
    await sweepInventory(localDeps(b), NOW);
    expect(b.store.nodes().map((n) => [n.nodeId, n.label])).toEqual([[U1, SERVER_LABEL]]);
    expect(b.store.node(SERVER_LABEL)).toBeNull();
    expect(b.store.node(U1)).toMatchObject({ installState: 'complete', measuredAt: NOW });
    expect(b.store.refusalsFor(U1).map((r) => r.tag)).toEqual(['v0.0.9']);
  });

  it('a node-id already keyed to a live row under a DIFFERENT label is a collision, never a merge (D-3211)', async () => {
    const b = box('ccrc-inv-supersede-');
    plant(b.ccrcDir, NO_ID);
    await sweepInventory(localDeps(b), NOW - 60_000);
    // A live row under a DIFFERENT label already owns this node-id — indistinguishable,
    // from this sweep's own evidence, from the two-connections-one-node-id case D-3211 covers.
    expect(b.store.upsertNodeMeasurement(meas({ nodeId: U1, label: 'reinstalled', role: 'both' }))).toMatchObject({ ok: true });
    plant(b.ccrcDir, { nodeId: `${U1}\n` });
    const [out] = await sweepInventory(localDeps(b), NOW);
    expect(out).toMatchObject({ label: SERVER_LABEL, result: 'node-id-collision', nodeId: SERVER_LABEL });
    expect(b.store.node(SERVER_LABEL)?.supersededBy).toBeNull();
    expect(b.store.nodes().map((n) => [n.nodeId, n.label]).sort()).toEqual([[U1, 'reinstalled'], [SERVER_LABEL, SERVER_LABEL]]);
  });

  it('a node-id that vanishes after a re-key keeps measuring into the UUID row, never a second live row (D-3201)', async () => {
    const b = box('ccrc-inv-vanish-');
    plant(b.ccrcDir, FULL);
    await sweepInventory(localDeps(b), NOW - 60_000);
    unplant(b.ccrcDir, 'nodeId');
    expect(await sweepInventory(localDeps(b), NOW)).toEqual([
      { label: SERVER_LABEL, result: 'measured', nodeId: U1, lease: 'none', refused: false },
    ]);
    expect(b.store.nodes().map((n) => n.nodeId)).toEqual([U1]);
    expect(b.store.node(U1)).toMatchObject({ installState: 'unknown', measuredAt: NOW });
  });
});

describe('sweepInventory — the fleet connection (§18 "unreachable is written on the sweep it happens")', () => {
  it('a missing connection is unreachable on THAT sweep; since stays the first; the placeholder re-keys on return', async () => {
    const b = box('ccrc-inv-unreach-');
    plant(b.ccrcDir, { ...NO_ID, nodeId: `${U2}\n` });
    const state = fleetState({ connected: false, downSince: NOW - 5000 });
    expect(await sweepInventory(remoteDeps(b.store, b.ccrcDir, state), NOW)).toEqual([
      { label: SERVER_LABEL, result: 'measured', nodeId: SERVER_LABEL, lease: 'none', refused: false },
      { label: FLEET_LABEL, result: 'unreachable', nodeId: FLEET_LABEL },
    ]);
    expect(b.store.node(FLEET_LABEL)).toMatchObject({
      role: 'fleet', reachable: false, unreachableSince: NOW, measuredAt: null, stampRead: 'unreadable', agentOps: [],
    });
    await sweepInventory(remoteDeps(b.store, b.ccrcDir, state), NOW + 60_000);
    expect(b.store.node(FLEET_LABEL)?.unreachableSince).toBe(NOW);
    state.connected = true;
    state.downSince = null;
    state.agentOps = ['update'];
    await sweepInventory(remoteDeps(b.store, b.ccrcDir, state), NOW + 120_000);
    expect(b.store.nodes().map((n) => [n.label, n.nodeId])).toEqual([[FLEET_LABEL, U2], [SERVER_LABEL, SERVER_LABEL]]);
    expect(b.store.node(U2)).toMatchObject({
      role: 'fleet', reachable: true, unreachableSince: null, stampRead: 'ok', agentOps: ['update'], measuredAt: NOW + 120_000,
    });
    expect(b.store.node(SERVER_LABEL)).toMatchObject({ role: 'server', agentOps: null, stampRead: 'absent' });
  });

  it('an agent that sent no ops reads [] (present, empty); the server row reads NULL (no agent by construction)', async () => {
    const b = box('ccrc-inv-ops-');
    plant(b.ccrcDir, FULL);
    await sweepInventory(remoteDeps(b.store, b.ccrcDir, fleetState()), NOW);
    expect(b.store.node(U1)?.agentOps).toEqual([]);
    expect(b.store.node(SERVER_LABEL)?.agentOps).toBeNull();
  });

  it('a link that drops while the reads are in flight is written unreachable, not as seven unreadables', async () => {
    const b = box('ccrc-inv-drop-');
    plant(b.ccrcDir, FULL);
    const state = fleetState();
    const dropping: FleetIO = {
      ...localIO,
      lstatMeasured: async () => { state.connected = false; return { ok: false as const, reason: 'unmeasured' as const }; },
    };
    const out = await sweepInventory(remoteDeps(b.store, b.ccrcDir, state, dropping), NOW);
    expect(out[1]).toEqual({ label: FLEET_LABEL, result: 'unreachable', nodeId: FLEET_LABEL });
    expect(b.store.node(FLEET_LABEL)).toMatchObject({ reachable: false, measuredAt: null });
  });

  it('an unreachable fleet whose label key a superseded row holds is reported refused, never as a row written', async () => {
    const b = box('ccrc-inv-keytaken-');
    // Task 5's own `label-key-taken` fixture: the label-keyed row is superseded
    // by a UUID row living under ANOTHER label, so no live row carries `fleet`
    // and the placeholder's key is taken.
    expect(b.store.upsertNodeMeasurement(meas({ nodeId: FLEET_LABEL }))).toMatchObject({ ok: true });
    expect(b.store.upsertNodeMeasurement(meas({ nodeId: U1, label: 'elsewhere' }))).toMatchObject({ ok: true });
    expect(b.store.rekeyNode(FLEET_LABEL, U1)).toMatchObject({ ok: true, how: 'superseded' });
    const out = await sweepInventory(remoteDeps(b.store, b.ccrcDir, fleetState({ connected: false, downSince: NOW - 5000 })), NOW);
    expect(out[1]).toEqual({ label: FLEET_LABEL, result: 'refused', why: `label-key-taken: ${U1}` });
    expect(b.store.node(U1)).toMatchObject({ label: 'elsewhere', reachable: true });
  });

  it('two connections measuring one node-id keep two rows and name the collision (D-3211)', async () => {
    const b = box('ccrc-inv-collision-');
    // A cloned/restored ~/.ccrc, or an agent pointed at the server's own box:
    // BOTH connections read the SAME directory and measure the SAME node-id.
    plant(b.ccrcDir, FULL);
    const deps: InventoryDeps = { store: b.store, localIo: localIO, ccrcDir: b.ccrcDir, role: 'both', fleet: { io: localIO, state: fleetState() } };
    const out1 = await sweepInventory(deps, NOW);
    expect(out1[0]).toMatchObject({ label: SERVER_LABEL, result: 'measured', nodeId: U1 });
    expect(out1[1]).toMatchObject({ label: FLEET_LABEL, result: 'node-id-collision', nodeId: FLEET_LABEL, lease: 'none', refused: false });
    expect(b.store.nodes().map((n) => [n.nodeId, n.label]).sort()).toEqual([[U1, SERVER_LABEL], [FLEET_LABEL, FLEET_LABEL]]);
    // The server's connection swept first, so it keeps the id every sweep —
    // the collision persists rather than resolving itself silently.
    const out2 = await sweepInventory(deps, NOW + 60_000);
    expect(out2[0]).toMatchObject({ result: 'measured', nodeId: U1 });
    expect(out2[1]).toMatchObject({ result: 'node-id-collision', nodeId: FLEET_LABEL });
    expect(b.store.nodes().map((n) => [n.nodeId, n.label]).sort()).toEqual([[U1, SERVER_LABEL], [FLEET_LABEL, FLEET_LABEL]]);
  });
});

describe('sweepInventory — per-row isolation (C1, final fix wave)', () => {
  /** Wraps a real store so exactly ONE connection's `upsertNodeMeasurement`
   *  throws — modelling `coord.db` locked/corrupt mid-write for that row's
   *  apply, while the other connection's store calls go through untouched. */
  function throwingOn(store: CoordStore, label: string): InventoryDeps['store'] {
    return {
      upsertNodeMeasurement: (m) => {
        if (m.label === label) throw new Error(`boom: coord.db locked (${label})`);
        return store.upsertNodeMeasurement(m);
      },
      markUnreachable: (...a) => store.markUnreachable(...a),
      rekeyNode: (...a) => store.rekeyNode(...a),
      releaseLease: (...a) => store.releaseLease(...a),
      settleNode: (...a) => store.settleNode(...a),
      refuseRelease: (...a) => store.refuseRelease(...a),
      node: (...a) => store.node(...a),
      nodeByLabel: (...a) => store.nodeByLabel(...a),
    };
  }

  it('a throw on the server row\'s apply still measures the fleet row, and reports an "error" outcome for the server row', async () => {
    const b = box('ccrc-inv-isolate-server-');
    plant(b.ccrcDir, FULL);
    const deps: InventoryDeps = {
      store: throwingOn(b.store, SERVER_LABEL), localIo: localIO, ccrcDir: b.ccrcDir, role: 'both',
      fleet: { io: localIO, state: fleetState() },
    };
    const out = await sweepInventory(deps, NOW);
    expect(out[0]).toMatchObject({ label: SERVER_LABEL, result: 'error' });
    expect((out[0] as { message: string }).message).toContain('boom');
    expect(out[1]).toMatchObject({ label: FLEET_LABEL, result: 'measured', nodeId: U1 });
    expect(b.store.node(U1)).toMatchObject({ reachable: true });
  });

  it('a throw on the fleet row\'s apply still measures the server row', async () => {
    const b = box('ccrc-inv-isolate-fleet-');
    plant(b.ccrcDir, FULL);
    const deps: InventoryDeps = {
      store: throwingOn(b.store, FLEET_LABEL), localIo: localIO, ccrcDir: b.ccrcDir, role: 'both',
      fleet: { io: localIO, state: fleetState() },
    };
    const out = await sweepInventory(deps, NOW);
    expect(out[0]).toMatchObject({ label: SERVER_LABEL, result: 'measured' });
    expect(out[1]).toMatchObject({ label: FLEET_LABEL, result: 'error' });
    expect((out[1] as { message: string }).message).toContain('boom');
  });
});

describe('sweepInventory — the phase table through the store (§18 "the phase table is applied", "a stale report never moves the lease")', () => {
  const T0 = T_S * 1000 + 500;
  async function busyBox(stampVersion = 'v0.0.12'): Promise<ReturnType<typeof box>> {
    const b = box('ccrc-inv-lease-');
    plant(b.ccrcDir, { ...FULL, stamp: stampJson({ version: stampVersion }) });
    await sweepInventory(localDeps(b), NOW - 60_000);   // the row exists; no report yet
    plantLease(b.db, U1, 'applying', 'v0.0.12', T0);
    return b;
  }

  it('done at the stamped version → idle via settleNode', async () => {
    const b = await busyBox();
    plant(b.ccrcDir, { report: reportJson() });
    expect(await sweepInventory(localDeps(b), NOW)).toEqual([
      { label: SERVER_LABEL, result: 'measured', nodeId: U1, lease: 'settle', refused: false },
    ]);
    expect(b.store.node(U1)).toMatchObject({
      updateState: 'idle', updateDetail: 'done: v0.0.12', reportedPhase: 'done', reportedStartedAt: T_S * 1000,
    });
  });

  it('done at another version → failed: stamp-mismatch via releaseLease', async () => {
    const b = await busyBox('v0.0.11');
    plant(b.ccrcDir, { report: reportJson() });
    await sweepInventory(localDeps(b), NOW);
    expect(b.store.node(U1)).toMatchObject({ updateState: 'failed', updateDetail: 'stamp-mismatch' });
  });

  it('a previous run\'s done leaves a fresh lease busy', async () => {
    const b = await busyBox();
    plant(b.ccrcDir, { report: reportJson({ startedAt: T_S - 3600 }) });
    const [out] = await sweepInventory(localDeps(b), NOW);
    expect(out).toMatchObject({ result: 'measured', lease: 'none' });
    expect(b.store.node(U1)).toMatchObject({ updateState: 'applying', updateStartedAt: T0, reportedStartedAt: (T_S - 3600) * 1000 });
  });

  it('installing leaves it applying; failed and reverted release to their own word', async () => {
    const inflight = await busyBox();
    plant(inflight.ccrcDir, { report: reportJson({ phase: 'installing', detail: null }) });
    await sweepInventory(localDeps(inflight), NOW);
    expect(inflight.store.node(U1)?.updateState).toBe('applying');
    for (const phase of ['failed', 'reverted'] as const) {
      const b = await busyBox();
      plant(b.ccrcDir, { report: reportJson({ phase, detail: `${phase} at checking` }) });
      await sweepInventory(localDeps(b), NOW);
      expect(b.store.node(U1)).toMatchObject({ updateState: phase, updateDetail: `${phase} at checking` });
    }
  });

  it('a provenance failure refuses (node, target) once, for THIS node only; ack clears it and the standing report does not re-insert it', async () => {
    const b = await busyBox();
    expect(b.store.upsertNodeMeasurement(meas({ nodeId: U2, label: 'other' }))).toMatchObject({ ok: true });
    const detail = 'provenance: the bundle names another workflow';
    plant(b.ccrcDir, { report: reportJson({ phase: 'failed', detail }) });
    expect(await sweepInventory(localDeps(b), NOW)).toEqual([
      { label: SERVER_LABEL, result: 'measured', nodeId: U1, lease: 'release', refused: true },
    ]);
    expect(b.store.refusalsFor(U1)).toEqual([{ nodeId: U1, tag: 'v0.0.12', at: NOW, detail }]);
    expect(b.store.refusalsFor(U2)).toEqual([]);
    // update.json persists: the same report on the next sweep inserts nothing and releases nothing.
    expect(await sweepInventory(localDeps(b), NOW + 60_000)).toEqual([
      { label: SERVER_LABEL, result: 'measured', nodeId: U1, lease: 'none', refused: false },
    ]);
    expect(b.store.ackNode(U1)).toMatchObject({ ok: true, clearedRefusals: 1 });
    await sweepInventory(localDeps(b), NOW + 120_000);
    expect(b.store.refusalsFor(U1)).toEqual([]);
    expect(b.store.node(U1)?.updateState).toBe('idle');
  });

  it.skipIf(process.getuid?.() === 0)('ack, an unreadable sweep, then the same standing report → the refusal stays cleared (D-3210)', async () => {
    const b = await busyBox();
    const detail = 'provenance: the bundle names another workflow';
    plant(b.ccrcDir, { report: reportJson({ phase: 'failed', detail }) });
    expect(await sweepInventory(localDeps(b), NOW)).toEqual([
      { label: SERVER_LABEL, result: 'measured', nodeId: U1, lease: 'release', refused: true },
    ]);
    expect(b.store.refusalsFor(U1)).toHaveLength(1);
    expect(b.store.ackNode(U1)).toMatchObject({ ok: true, clearedRefusals: 1 });
    expect(b.store.refusalsFor(U1)).toEqual([]);
    // update.json goes unreadable — a link hiccup, an EACCES, a budget
    // timeout — not a real change; an unmeasured read must not fold to
    // `unknown` and re-open the changed-report gate on the NEXT readable sweep.
    chmodSync(path.join(b.ccrcDir, 'update.json'), 0o000);
    const [unreadableOut] = await sweepInventory(localDeps(b), NOW + 60_000);
    expect(unreadableOut).toMatchObject({ result: 'measured', lease: 'none', refused: false });
    expect(b.store.node(U1)?.reportedPhase).toBe('failed');   // unchanged, D-3210
    expect(b.store.refusalsFor(U1)).toEqual([]);
    chmodSync(path.join(b.ccrcDir, 'update.json'), 0o644);
    const [readableOut] = await sweepInventory(localDeps(b), NOW + 120_000);
    expect(readableOut).toMatchObject({ result: 'measured', lease: 'none', refused: false });
    expect(b.store.refusalsFor(U1)).toEqual([]);
  });
});

describe('the inventory lane in FleetWatcher (§18 "measurement is a sweep")', () => {
  afterEach(() => { vi.useRealTimers(); });

  it('sweeps on the first tick even when the registry will not list, then once a minute', async () => {
    const home = mkTmp('ccrc-inv-tick-');
    const base = testDeps(home);   // no .cc-sessions: tick() fails shut on the registry read
    const coord = new CoordStore(openCoordDb(base.cfg.coordDbPath));
    plant(base.cfg.ccrcDir, FULL);
    const w = new FleetWatcher({ ...base, coord }, new Bus(), 2000, path.join(home, 'state-cache.json'));
    const spy = vi.spyOn(w, 'inventoryNow');
    vi.useFakeTimers();
    await w.tick();
    expect(spy).toHaveBeenCalledTimes(1);
    await spy.mock.results[0]!.value;
    expect(coord.nodes().map((n) => [n.label, n.nodeId])).toEqual([[SERVER_LABEL, U1]]);
    await w.tick();
    expect(spy).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(30_000);
    await w.tick();
    expect(spy).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(30_000);
    await w.tick();
    expect(spy).toHaveBeenCalledTimes(2);
  });

  it('a disconnected fleet is written unreachable by the tick that sees it — the registry read that fails with it does not stop the lane', async () => {
    const home = mkTmp('ccrc-inv-tick-remote-');
    const base = testDeps(home);
    const coord = new CoordStore(openCoordDb(base.cfg.coordDbPath));
    const deps: Deps = {
      ...base, coord, cfg: { ...base.cfg, fleetMode: 'remote' },
      fleetState: fleetState({ connected: false, downSince: Date.now() }),
    };
    const w = new FleetWatcher(deps, new Bus(), 2000, path.join(home, 'state-cache.json'));
    const spy = vi.spyOn(w, 'inventoryNow');
    await w.tick();
    expect(spy).toHaveBeenCalledTimes(1);
    await spy.mock.results[0]!.value;
    expect(coord.node(FLEET_LABEL)).toMatchObject({ reachable: false, role: 'fleet' });
  });

  it('inventoryNow is single-flight: a second call joins the run in flight', async () => {
    const home = mkTmp('ccrc-inv-flight-');
    const base = testDeps(home);
    const coord = new CoordStore(openCoordDb(base.cfg.coordDbPath));
    plant(base.cfg.ccrcDir, FULL);
    const w = new FleetWatcher({ ...base, coord }, new Bus(), 60_000, path.join(home, 'state-cache.json'));
    const a = w.inventoryNow();
    const b = w.inventoryNow();
    expect(b).toBe(a);
    expect(await a).toEqual([{ label: SERVER_LABEL, result: 'measured', nodeId: U1, lease: 'none', refused: false }]);
    const c = w.inventoryNow();
    expect(c).not.toBe(a);
    await c;
  });

  it('a server with no coord store sweeps nothing and does not throw', async () => {
    const home = mkTmp('ccrc-inv-nocoord-');
    const w = new FleetWatcher(testDeps(home), new Bus(), 60_000, path.join(home, 'state-cache.json'));
    await expect(w.inventoryNow()).resolves.toEqual([]);
  });

  it('C2: a rejected sweep is warned ONCE per distinct message, quiet on a repeat, re-armed after a clean settle', async () => {
    const home = mkTmp('ccrc-inv-reject-warn-');
    const w = new FleetWatcher(testDeps(home), new Bus(), 60_000, path.join(home, 'state-cache.json'));
    const runInventorySpy = vi.spyOn(
      w as unknown as { runInventory(): Promise<SweepOutcome[]> }, 'runInventory',
    );
    // The private helper both `tick()`'s gate and `triggerInventory()` share
    // — called and awaited directly, sequentially, so this case is about the
    // warn/dedupe logic alone, never about the join/rerun scheduling (C4 has
    // its own case for that).
    const dispatch = (): Promise<void> =>
      (w as unknown as { dispatchInventorySweep(): Promise<void> }).dispatchInventorySweep();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const boomWarns = (): number => warn.mock.calls.filter((c) => String(c[0]).includes('boom')).length;
    try {
      runInventorySpy.mockRejectedValueOnce(new Error('boom'));
      await dispatch();
      expect(boomWarns()).toBe(1);
      runInventorySpy.mockRejectedValueOnce(new Error('boom'));
      await dispatch();
      expect(boomWarns()).toBe(1);   // the SAME message, still standing — quiet
      runInventorySpy.mockResolvedValueOnce([]);
      await dispatch();               // a clean settle re-arms the dedupe
      runInventorySpy.mockRejectedValueOnce(new Error('boom'));
      await dispatch();
      expect(boomWarns()).toBe(2);   // the SAME message again, after a recovery — warns again
    } finally {
      warn.mockRestore();
    }
  });

  it('C3: a standing node-id collision is warned once, and stays quiet while it repeats', async () => {
    const home = mkTmp('ccrc-inv-collision-warn-');
    const base = testDeps(home);
    const coord = new CoordStore(openCoordDb(base.cfg.coordDbPath));
    plant(base.cfg.ccrcDir, FULL);
    const deps: Deps = { ...base, coord, cfg: { ...base.cfg, fleetMode: 'remote' }, fleetState: fleetState() };
    const w = new FleetWatcher(deps, new Bus(), 60_000, path.join(home, 'state-cache.json'));
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    try {
      await w.inventoryNow();   // both connections read node-id U1 -> a collision
      const collisionWarns = () => warn.mock.calls.filter((c) => String(c[0]).includes('node-id-collision') || String(c[0]).includes('already the key of a live row'));
      expect(collisionWarns()).toHaveLength(1);
      await w.inventoryNow();   // the SAME collision, still standing
      expect(collisionWarns()).toHaveLength(1);
    } finally {
      warn.mockRestore();
    }
  });

  it('C4: a ready that joins an in-flight sweep is not swallowed — exactly one rerun fires after it settles', async () => {
    const home = mkTmp('ccrc-inv-rerun-');
    const w = new FleetWatcher(testDeps(home), new Bus(), 60_000, path.join(home, 'state-cache.json'));
    let calls = 0;
    const deferred: { resolve: (v: SweepOutcome[]) => void }[] = [];
    vi.spyOn(w as unknown as { runInventory(): Promise<SweepOutcome[]> }, 'runInventory').mockImplementation(() => {
      calls += 1;
      return new Promise<SweepOutcome[]>((resolve) => { deferred.push({ resolve }); });
    });
    w.triggerInventory();                 // sweep #1 starts, in flight
    expect(calls).toBe(1);
    w.triggerInventory();                 // joins #1 — must NOT start a second run yet
    expect(calls).toBe(1);
    deferred[0]!.resolve([]);             // sweep #1 settles
    await vi.waitFor(() => { expect(calls).toBe(2); });   // the swallowed ready's rerun fires
    deferred[1]!.resolve([]);
    await new Promise((r) => setTimeout(r, 20));
    expect(calls).toBe(2);                // and no further, un-requested rerun
  });
});

describe('the fleet node over a real agent (the exact-basename read set, and the ready trigger)', () => {
  let agent: RunningAgent | undefined;
  let fleet: ConnectedFleet | undefined;
  afterEach(async () => {
    await fleet?.close();
    fleet = undefined;
    if (agent) await agent.close();
    agent = undefined;
  });

  it('a ready frame measures the fleet node inside the same second', async () => {
    const fixture = makeFixture();
    const ccrcDir = path.join(fixture.home, '.ccrc');
    // No node-id: the server row reads the same directory through localIO, and
    // two rows keyed by the same UUID would be one row flipping labels.
    plant(ccrcDir, { stamp: stampJson(), installed: `${SHA}\nunsigned\n`, caps: 'os linux\nverify\nnode-id\nfloor\n', floor: 'v0.0.12\n' });
    agent = await bootAgent(fixture);
    const serverHome = mkTmp('ccrc-inv-agent-server-');
    const base = testDeps(serverHome);
    const coord = new CoordStore(openCoordDb(base.cfg.coordDbPath));
    fleet = connectToAgent(agent.port);
    const deps: Deps = {
      ...base, coord, io: fleet.io, fleetState: fleet.state, cfg: { ...base.cfg, fleetMode: 'remote', ccrcDir },
    };
    const w = new FleetWatcher(deps, new Bus(), 60_000, path.join(serverHome, 'state-cache.json'));
    // index.ts's own line. The composition root is never imported by a test
    // (`refreshcaps.test.ts` says why); this is the seam it wires. That the
    // REAL line exists in index.ts is the text pin in the describe below.
    fleet.client.onConnected(() => w.triggerInventory());
    const t0 = Date.now();
    await vi.waitFor(() => { expect(coord.node(FLEET_LABEL)?.stampRead).toBe('ok'); }, { timeout: 1000, interval: 20 });
    expect(Date.now() - t0).toBeLessThan(1000);
    const row = coord.node(FLEET_LABEL)!;
    expect(buildInfoOfRow(row)).toEqual(parseBuildInfo(stampJson()));
    expect(row).toMatchObject({ role: 'fleet', caps: ['verify', 'node-id', 'floor'], os: 'linux', highestVersion: 'v0.0.12', agentOps: [], reachable: true });
  });

  it('a build.json symlinked onto a secret file is unreadable across the wire, and nothing of the secret arrives', async () => {
    const fixture = makeFixture();
    const ccrcDir = path.join(fixture.home, '.ccrc');
    plant(ccrcDir, { caps: 'os linux\nverify\n' });
    // A VALID stamp inside the secret-named file: following the link would answer `ok`.
    writeFileSync(path.join(ccrcDir, 'agent.env'), stampJson({ ref: 'not-a-real-secret' }));
    symlinkSync(path.join(ccrcDir, 'agent.env'), path.join(ccrcDir, 'build.json'));
    agent = await bootAgent(fixture);
    fleet = connectToAgent(agent.port);
    await vi.waitFor(() => { expect(fleet!.state.connected).toBe(true); }, { timeout: 3000 });
    const b = box('ccrc-inv-agent-symlink-');
    await sweepInventory(remoteDeps(b.store, ccrcDir, fleet.state, fleet.io), NOW);
    expect(b.store.node(FLEET_LABEL)).toMatchObject({ stampRead: 'unreadable', currentSha: null, caps: ['verify'], os: 'linux' });
    expect(JSON.stringify(b.store.nodes())).not.toContain('not-a-real-secret');
  });
});

describe('index.ts composes the update lanes (text pins over the composition root)', () => {
  // No test imports `index.ts`, and `boot.test.ts` spawns it in LOCAL mode
  // only, so a deleted REMOTE-arm line leaves every behavioural case green:
  // the real-agent case above runs over its own copy of the trigger, and a
  // missing `catalogue,` is no type error (`Deps.catalogue` is optional) —
  // production would then measure a reconnected agent only on the next
  // minute tick, or never poll the catalogue, with nothing red. These pins
  // read the one file, as `readme-holds.test.ts:290-318` does for
  // `readLocalCcdCaps`: a text pin proves the source, the case above proves
  // the behaviour.
  const indexTs = readFileSync(new URL('../src/index.ts', import.meta.url), 'utf8');
  // The two `deps = { … };` object literals, remote arm first (the `if`).
  const depsLiterals = indexTs.match(/^  deps = \{\n[\s\S]*?^  \};$/gm) ?? [];

  it('splits into exactly the remote and the local deps literal (the control for the arm pins)', () => {
    expect(depsLiterals).toHaveLength(2);
    expect(depsLiterals[0]).toContain('io: fleet.io');
    expect(depsLiterals[1]).toContain('io: localIO');
  });

  it('wires the ready trigger exactly once, below the watcher, over the hoisted client', () => {
    const lines = indexTs.split('\n');
    const trigger = lines.flatMap((l, i) => (l.trim() === 'fleetClient?.onConnected(() => watcher.triggerInventory());' ? [i] : []));
    expect(trigger, 'index.ts must carry the one ready trigger').toHaveLength(1);
    const watcherAt = lines.findIndex((l) => l.startsWith('const watcher = new FleetWatcher('));
    expect(watcherAt).toBeGreaterThanOrEqual(0);
    expect(trigger[0]).toBeGreaterThan(watcherAt);
    expect(indexTs).toMatch(/^  fleetClient = fleet\.client;$/m);
  });

  it('hands Task 10\'s catalogue poller to BOTH deps arms', () => {
    expect(depsLiterals).toHaveLength(2);
    for (const lit of depsLiterals) expect(lit).toMatch(/^\s+catalogue,$/m);
  });
});

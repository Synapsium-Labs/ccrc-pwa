// The server-role harness the D-3400/D-3413 cases share (`update-killed-arms.test.ts`, `update-local-spawn-throw.test.ts`): a
// fixture coord.db with three listed stable releases, a connected link whose live agentOps names the op, a recording send,
// and a server-role spawner that is the fake behind `spawnFromRunner` (or `runLocal` as given). Nothing here starts a process.
import { expect } from 'vitest';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { NodeRole, RequestKind } from '../../shared/api.js';
import { openCoordDb } from '../src/coord/db.js';
import { CoordStore, type NodeMeasurement, type ReleaseListingRow } from '../src/coord/store.js';
import type { ExecResult, Runner } from '../src/exec.js';
import type { FleetState } from '../src/fleetstate.js';
import { localIO } from '../src/io.js';
import type { ConvergeDeps, DispatchRunResult, LocalUpdateSpawn, SendUpdateOp } from '../src/update/converge.js';
import { FLEET_LABEL, SERVER_LABEL } from '../src/update/inventory.js';
import { spawnFromRunner } from './updateSpawnFake.js';
import { mkTmp } from './tmpHelpers.js';

export const TAG = 'v0.0.10';
export const T0 = 1_790_000_000_000;
export const FLEET_ID = '0f0f0f0f-0f0f-4f0f-8f0f-0f0f0f0f0f0f';
export const SERVER_ID = '05050505-0505-4505-8505-050505050505';
export const ACCEPTED = { t: 'res', id: 1, ok: true, accepted: true } as const;

export const rel = (tag: string, publishedAt: number): ReleaseListingRow => ({
  tag, channel: 'stable', publishedAt, commitSha: null, tarballUrl: `https://example.invalid/download/${tag}/ccrc-${tag}.tar.gz`,
  bundleListed: true, notes: null, draft: false,
});
export const fleetMeas = (over: Partial<NodeMeasurement> = {}): NodeMeasurement => ({
  nodeId: FLEET_ID, role: 'fleet', label: FLEET_LABEL,
  currentVersion: 'v0.0.9', currentSha: 'a'.repeat(40), currentRef: 'main', currentBuiltAt: '2026-09-20T00:00:00Z',
  currentDirty: false, stampRead: 'ok', installState: 'complete', provenance: 'verified',
  caps: ['verify', 'node-id', 'floor', 'update-json', 'detach', 'rollback'], agentOps: ['update'],
  highestVersion: 'v0.0.9', previousVersion: 'v0.0.8', floorRead: 'measured', previousRead: 'measured', os: 'linux', measuredAt: T0, report: null, ...over,
});
export const serverMeas = (over: Partial<NodeMeasurement> = {}): NodeMeasurement =>
  fleetMeas({ nodeId: SERVER_ID, role: 'server', label: SERVER_LABEL, agentOps: null, ...over });

export interface Harness {
  store: CoordStore; home: string; deps: ConvergeDeps; sent: { tag: string; kind: RequestKind }[]; spawned: number; accepted: () => number;
}
/** A fixture coord.db, a connected link, and a server-role spawner: the fake behind `spawnFromRunner` (resolves KILLED at
 *  `boundMs`, with `answer`'s stdout and pid, after `run` has planted whatever the parent left), or `runLocal` as given. */
export function harness(o: {
  run?: Runner; boundMs?: number; answer?: { stdout?: string | null; pid?: number | null }; runLocal?: LocalUpdateSpawn; role?: NodeRole;
} = {}): Harness {
  const home = mkTmp('update-killed-harness-');
  const store = new CoordStore(openCoordDb(path.join(home, 'coord.db')));
  expect(store.applyReleaseListing([rel('v0.0.8', T0 - 3000), rel('v0.0.9', T0 - 2000), rel(TAG, T0 - 1000)], T0 - 500, 'complete').ok).toBe(true);
  const sent: Harness['sent'] = [];
  const h: Harness = { store, home, sent, spawned: 0, accepted: () => 0, deps: undefined as unknown as ConvergeDeps };
  let accepted = 0;
  const state: FleetState = { connected: true, downSince: null, ccdVerbs: null, rosterFp: null, build: null, agentOps: ['update'] };
  const send: SendUpdateOp = async () => ACCEPTED;
  const recording: Runner = (cmd, args) => { h.spawned += 1; return (o.run ?? (async (): Promise<ExecResult> => ({ code: 0, stdout: '', stderr: '' })))(cmd, args); };
  h.deps = {
    store, role: o.role ?? 'server', ccrcDir: path.join(home, '.ccrc'), localIo: localIO, deadlineMs: 900_000,
    fleet: { state, send: (tag, kind) => { sent.push({ tag, kind }); return send(tag, kind); } },
    runLocal: o.runLocal ?? spawnFromRunner(recording, home, o.boundMs, o.answer),
    onAccepted: () => { accepted += 1; },
  };
  h.accepted = () => accepted;
  return h;
}
export const seedServer = (h: Harness): void => {
  expect(h.store.upsertNodeMeasurement(serverMeas()).ok).toBe(true);
  expect(h.store.requestNode(SERVER_ID, TAG, 'update', T0).ok).toBe(true);
};
export const seedFleet = (h: Harness): void => {
  expect(h.store.upsertNodeMeasurement(fleetMeas()).ok).toBe(true);
  expect(h.store.requestNode(FLEET_ID, TAG, 'update', T0).ok).toBe(true);
};
export type Ran = Extract<DispatchRunResult, { ran: true }>;
export const ran = (r: DispatchRunResult): Ran => { if (!r.ran) throw new Error(`did not run: ${r.why}`); return r; };
export const hang: Runner = () => new Promise<ExecResult>(() => {});
export const reportFile = (h: Harness): string => path.join(h.home, '.ccrc', 'update.json');
/** A parent that planted `before` in update.json (at spawn time it is already there) and leaves `after` behind. */
export const plant = (h: Harness, text: string | null): void => {
  mkdirSync(path.join(h.home, '.ccrc'), { recursive: true });
  if (text !== null) writeFileSync(reportFile(h), text);
};


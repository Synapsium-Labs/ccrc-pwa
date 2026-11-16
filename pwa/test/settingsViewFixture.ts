// Neutral fixtures for the Settings frame's suites (settings Task R2b1): one fleet node, an idle and confirmed box
// token, and an `/api/updates` answer with the fleet's intent row. The shapes are box-token-card.test.tsx's.
import type { NodeWire, UpdatesView } from '../../shared/api';
import { FLEET_SCOPE } from '../../shared/api';
import type { BoxTokenView } from '../../shared/box-token';

const MIN = 60_000;

export const boxToken = (over: Partial<BoxTokenView> = {}): BoxTokenView => ({
  phase: 'idle', origin: 'rotated', currentSeq: 4, currentSince: Date.now() - 90 * MIN,
  lastRotationAt: Date.now() - 90 * MIN, rotationOwed: false, owedWhy: null, hold: null, holdNode: null,
  failures: 0, lastFailure: null, banner: false, fleetConfirmed: 'current', fleetTransport: 'https',
  lastSync: { at: Date.now() - 90 * MIN, word: 'synced' }, previousPresented: 0, retiredPresented: 0,
  retiredRefused: true, lastBootRecovery: null, role: 'server', stalled: null, fileProblem: null,
  ...over,
});

export const node = (over: Partial<NodeWire> = {}): NodeWire => ({
  nodeId: '0f0e0d0c-0b0a-4908-8706-050403020100', role: 'fleet', label: 'fleet', os: 'linux',
  current: { sha: 'a'.repeat(40), ref: 'main', builtAt: '2026-10-07T12:00:00Z', dirty: false, version: 'v0.0.9' },
  stampRead: 'ok', installState: 'complete', provenance: 'verified',
  caps: ['verify'], agentOps: [], highestVersion: 'v0.0.9', previousVersion: null,
  floorRead: 'measured', previousRead: 'absent', measuredAt: 1_000, reachable: true, unreachableSince: null,
  channel: 'stable', desiredTag: 'v0.0.9', resolveDetail: null, request: null, report: null,
  update: { state: 'idle', target: null, startedAt: null, detail: null },
  ...over,
});

export const updatesView = (over: Partial<UpdatesView> = {}): UpdatesView => ({
  catalogue: { lastOkAt: Date.now() - 4 * MIN, lastError: null },
  releases: [],
  nodes: [node()],
  intent: [{ scope: FLEET_SCOPE, channel: 'stable', pinnedTag: null, auto: 'off', notify: 'channel', setAt: 1, setBy: 'test' }],
  boxToken: boxToken(),
  ...over,
});

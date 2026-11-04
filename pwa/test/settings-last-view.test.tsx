// Console speed, task C2 ("the last view kept"; spec 2026-11-04 §2.4): Settings' reads keep their last good answer in
// the screen cache (`src/lib/screenCache.ts`), so a return to Settings draws it at once and re-reads, instead of
// starting from "Loading" on every visit.
//
// What this pins:
//  • a second visit draws the last updates, stall, collect, abandon, testbox and linear views, the auth status and the
//    passkey list BEFORE any read of that visit returns;
//  • a kept answer goes through the hook's own reader every time, so one the reader refuses draws the pending state;
//  • a write's settle (and the auth pair's refresh after an Add or Revoke) forgets the key, so the next visit never
//    draws a view from before the operator's own write;
//  • a failed re-read keeps the kept view and shows the failure beside it;
//  • an answer that drops the view (not available on this server) forgets it too.
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render, waitFor } from '@testing-library/react';
import type {
  AuthStatus, CollectLaneView, NodeWire, PasskeyListResponse, StallWatchEffective, StallWatchView, UpdatesView,
} from '../../shared/api';
import type { DispatchAbandonView } from '../../shared/dispatch-abandon';
import type { LinearConnectionView, LinearLegacyRow, LinearWorkspaceView } from '../../shared/linear';
import { ApiError, api, readLinearWorkspaces, type LinearWorkspacesRead } from '../src/lib/api';
import { clearScreenCache, peek, put, settingsKey } from '../src/lib/screenCache';
import {
  SettingsDataProvider, useSettingsView, type SettingsPageView,
} from '../src/screens/settings/SettingsDataProvider';

// ---- fixtures: one good answer per read ----

const node = (): NodeWire => ({
  nodeId: '0f0e0d0c-0b0a-4908-8706-050403020100', role: 'fleet', label: 'fleet', os: 'linux',
  current: { sha: 'a'.repeat(40), ref: 'main', builtAt: '2026-09-22T00:00:00Z', dirty: false, version: 'v0.0.9' },
  stampRead: 'ok', installState: 'complete', provenance: 'verified',
  caps: ['verify', 'node-id', 'floor'], agentOps: [], highestVersion: 'v0.0.9', previousVersion: null,
  measuredAt: 1_000, reachable: true, unreachableSince: null,
  channel: 'stable', desiredTag: 'v0.0.9', resolveDetail: null, request: null, report: null,
  update: { state: 'idle', target: null, startedAt: null, detail: null },
});
const UPDATES: UpdatesView = { catalogue: { lastOkAt: 1_000, lastError: null }, releases: [], nodes: [node()], intent: [] };

const EFFECTIVE = {
  measured: true, level: 'check', files: 'check', source: 'files',
  stages: { runs: true, checks: true, alerts: false, busyDelivery: false, busyGate: true, wave2: false },
  held: { watchOff: false, mailOff: false, gateStrict: false, wave2HeldByStrict: false },
  next: { kind: 'step', level: 'alert', waitsOn: ['alerts'] },
  filesExceed: false,
} as StallWatchEffective;
const STALL: StallWatchView = {
  chosen: { level: 'follow', quietMs: 'default', updatedAt: 1_000, stored: 'row' },
  effective: EFFECTIVE,
  quiet: {
    effectiveMs: 7_200_000, builtInMs: 7_200_000, minMs: 1_800_000, maxMs: 43_200_000, stepMs: 1_800_000,
    source: 'default',
  },
  notices: {
    ok: true, since: 0, windowMs: 172_800_000,
    counts: [
      { row: 'checks', sent: 1, shadow: 2 }, { row: 'wakes', sent: 0, shadow: 0 },
      { row: 'reports', sent: 0, shadow: 3 }, { row: 'pushes', sent: 4, shadow: 0 },
    ],
  },
  fallback: null,
} as StallWatchView;

const COLLECT: CollectLaneView = {
  stored: { read: 'row', choice: 'live', fleetNodeId: 'node-a', markerRetiredAt: null, generation: 1, updatedAt: 1_000 },
  journal: { read: 'ok', max: 1 },
  control: { state: 'coherent', bootstrap: false },
  effective: { state: 'live', armedBy: 'both' },
  marker: { listing: 'stands', latch: 'unset' },
  node: { state: 'known', nodeId: 'node-a', measuredAt: 5_000, stored: 'this' },
  caps: { collect: true, reclaimPause: true },
  attention: { wouldCollect: 2, held: 1, boxLines: 0 },
  remedy: null,
  notice: null,
} as CollectLaneView;

const ABANDON: DispatchAbandonView = { stored: 'on', detail: null, armed: true, boundMs: 900_000, updatedAt: 0 };

const TESTBOX = { ok: true, testbox: null };

const ID_A = '00000000-0000-4000-8000-00000000000a';
const CONNECTED: LinearConnectionView = {
  state: 'connected', outcome: 'ok', org: 'Workspace A', user: 'user-a', keyTail: '4f2c', checkedAt: 1_000,
};
const WS_A = {
  id: ID_A, name: 'Workspace A', urlKey: 'ws-a', teams: [{ key: 'AAA', name: 'Team A' }], ...CONNECTED,
} as LinearWorkspaceView;
const LEGACY: LinearLegacyRow = {
  view: CONNECTED, workspace: { name: 'Workspace L', urlKey: 'ws-l', teams: [{ key: 'LLL', name: 'Team L' }] },
  superseded: false,
};
const LINEAR: LinearWorkspacesRead = readLinearWorkspaces({ store: 'ok', workspaces: [WS_A], legacy: LEGACY })!;

const AUTH: Partial<AuthStatus> = { authed: true, passkeysEnrolled: 1, mode: 'passphrase' };
const PASSKEYS: PasskeyListResponse = {
  credentials: [{ credentialIdB64url: 'AQID', label: 'phone', enrolledAt: 1, lastUsedAt: 2, uv: true } as never],
  storeUnreadable: false,
};

// ---- harness ----

const never = (): Promise<never> => new Promise<never>(() => undefined);
const reply = (status: number, body: unknown): Response =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

/** Every read answers its good fixture. */
function answerAll(): void {
  vi.spyOn(api, 'updates').mockResolvedValue(UPDATES);
  vi.spyOn(api, 'stallWatch').mockResolvedValue(STALL);
  vi.spyOn(api, 'collectLane').mockResolvedValue(COLLECT);
  vi.spyOn(api, 'dispatchAbandon').mockResolvedValue(ABANDON);
  vi.spyOn(api, 'testbox').mockResolvedValue(TESTBOX as never);
  vi.spyOn(api, 'linearWorkspaces').mockResolvedValue(LINEAR);
  vi.spyOn(api, 'passkeys').mockResolvedValue(PASSKEYS);
  vi.stubGlobal('fetch', vi.fn(async (path: string) => (path === '/api/auth/status' ? reply(200, AUTH) : reply(404, {}))));
}

/** Every read is held: nothing lands while a case looks. */
function holdAll(): void {
  for (const m of ['updates', 'stallWatch', 'collectLane', 'dispatchAbandon', 'testbox', 'linearWorkspaces', 'passkeys'] as const) {
    vi.spyOn(api, m).mockImplementation(never as never);
  }
  vi.stubGlobal('fetch', vi.fn(never));
}

let seen: SettingsPageView | null = null;
function Probe(): ReactNode {
  seen = useSettingsView();
  return null;
}
const visit = (): ReturnType<typeof render> => render(<SettingsDataProvider active><Probe /></SettingsDataProvider>);
const view = (): SettingsPageView => {
  if (seen === null) throw new Error('no settings view');
  return seen;
};

/** A first visit whose reads all land, then leave. */
async function firstVisit(): Promise<void> {
  answerAll();
  const r = visit();
  await waitFor(() => {
    const v = view();
    expect(v.updates.view).not.toBeNull();
    expect(v.stall.view).not.toBeNull();
    expect(v.collect.view).not.toBeNull();
    expect(v.dispatchAbandon.view).not.toBeNull();
    expect(v.testbox.view).not.toBeNull();
    expect(v.linear.view).not.toBeNull();
    expect(v.auth.kind).toBe('read');
    expect(v.passkeys.kind).toBe('read');
  });
  r.unmount();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
}

beforeEach(() => { clearScreenCache(); seen = null; });
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); clearScreenCache(); });

describe('Settings keeps its last view across visits (console speed C2)', () => {
  it('a first visit with an empty cache draws every read as pending', () => {
    holdAll();
    visit();
    const v = view();
    expect([v.updates.view, v.stall.view, v.collect.view, v.dispatchAbandon.view, v.testbox.view, v.linear.view])
      .toEqual([null, null, null, null, null, null]);
    expect(v.auth).toEqual({ kind: 'pending' });
    expect(v.passkeys).toEqual({ kind: 'pending' });
  });

  it('a second visit draws the last updates, stall, collect, abandon, testbox and linear views before any read returns', async () => {
    await firstVisit();
    holdAll();
    visit();
    const v = view();   // the first render: no read of this visit has landed
    expect(v.updates.view).toEqual(UPDATES);
    expect(v.updates.seq).toBe(0);   // no read of THIS mount has landed (D-4273's hold keeps waiting)
    expect(v.stall.view).toEqual(STALL);
    expect(v.collect.view).toEqual(COLLECT);
    expect(v.dispatchAbandon.view).toEqual(ABANDON);
    expect(v.testbox.view).toEqual({ block: null });
    expect(v.linear.view).toEqual(LINEAR);
    for (const f of [v.updates.failure, v.stall.failure, v.collect.failure, v.dispatchAbandon.failure, v.testbox.failure,
      v.linear.failure]) expect(f).toBeNull();
  });

  it('a second visit draws the last auth status and passkey list before any read returns', async () => {
    await firstVisit();
    holdAll();
    visit();
    expect(view().auth).toEqual({ kind: 'read', status: AUTH });
    expect(view().passkeys).toEqual({ kind: 'read', list: PASSKEYS });
  });

  it('a kept status that says the gate is off draws no passkey list', () => {
    put(settingsKey('auth'), { authed: true, passkeysEnrolled: 0, mode: 'off' }, 1);
    put(settingsKey('passkeys'), PASSKEYS, 1);
    holdAll();
    visit();
    expect(view().auth.kind).toBe('read');
    expect(view().passkeys).toEqual({ kind: 'unasked' });
  });

  it('a cached answer the reader refuses draws the pending state', () => {
    for (const name of ['updates', 'stall-watch', 'collect-lane', 'dispatch-abandon', 'testbox', 'linear-workspaces',
      'auth', 'passkeys'] as const) put(settingsKey(name), { junk: true, n: 7 }, 1);
    holdAll();
    visit();
    const v = view();
    expect([v.updates.view, v.stall.view, v.collect.view, v.dispatchAbandon.view, v.testbox.view, v.linear.view])
      .toEqual([null, null, null, null, null, null]);
    // the auth status's reader takes any JSON object, as `readAuthStatus` does; one naming no armed mode asks nothing
    expect(v.auth).toEqual({ kind: 'read', status: { junk: true, n: 7 } });
    expect(v.passkeys).toEqual({ kind: 'unasked' });
    // a non-object status is refused: pending
    put(settingsKey('auth'), 'not-a-status', 1);
    cleanup();
    visit();
    expect(view().auth).toEqual({ kind: 'pending' });
    expect(view().passkeys).toEqual({ kind: 'pending' });
    // an armed status with a list the reader refuses: the list is pending
    put(settingsKey('auth'), AUTH, 1);
    cleanup();
    visit();
    expect(view().auth).toEqual({ kind: 'read', status: AUTH });
    expect(view().passkeys).toEqual({ kind: 'pending' });
  });

  it('the linear list is kept as read, and its reader reads it back whole', () => {
    expect(readLinearWorkspaces(LINEAR)).toEqual(LINEAR);
    expect(readLinearWorkspaces(readLinearWorkspaces(LINEAR))).toEqual(LINEAR);
  });

  it("a write's settle forgets the key", async () => {
    await firstVisit();
    holdAll();
    visit();
    act(() => {
      view().stall.settle({ ...STALL, chosen: { ...STALL.chosen, level: 'off' } } as StallWatchView);
      view().collect.settle(COLLECT);
      view().dispatchAbandon.settle({ ...ABANDON, stored: 'off', armed: false });
      view().linear.settle(LINEAR);
    });
    for (const name of ['stall-watch', 'collect-lane', 'dispatch-abandon', 'linear-workspaces'] as const) {
      expect(peek(settingsKey(name)), name).toBeUndefined();
    }
    // the reads with no write of their own keep theirs
    for (const name of ['updates', 'testbox', 'auth', 'passkeys'] as const) expect(peek(settingsKey(name)), name).toBeDefined();
    // the next visit draws the forgotten reads as pending
    cleanup();
    visit();
    const v = view();
    expect([v.stall.view, v.collect.view, v.dispatchAbandon.view, v.linear.view]).toEqual([null, null, null, null]);
    expect(v.updates.view).toEqual(UPDATES);
  });

  it('a refresh of the auth pair after a write forgets both keys', async () => {
    await firstVisit();
    holdAll();
    visit();
    expect(peek(settingsKey('auth'))).toBeDefined();
    expect(peek(settingsKey('passkeys'))).toBeDefined();
    act(() => view().refreshAuth());
    expect(peek(settingsKey('auth'))).toBeUndefined();
    expect(peek(settingsKey('passkeys'))).toBeUndefined();
  });

  it('a failed re-read keeps the cached view and shows the failure', async () => {
    await firstVisit();
    const down = (): Promise<never> => Promise.reject(new TypeError('network down'));
    for (const m of ['updates', 'stallWatch', 'collectLane', 'dispatchAbandon', 'testbox', 'linearWorkspaces'] as const) {
      vi.spyOn(api, m).mockImplementation(down as never);
    }
    vi.stubGlobal('fetch', vi.fn(never));
    visit();
    await waitFor(() => {
      const v = view();
      expect(v.updates.failure).toBe('failed');
      expect(v.stall.failure).toBe('failed');
      expect(v.collect.failure).toEqual({ kind: 'failed' });
      expect(v.dispatchAbandon.failure).toBe('failed');
      expect(v.testbox.failure).toBe('failed');
      expect(v.linear.failure).toBe('failed');
    });
    const v = view();
    expect(v.updates.view).toEqual(UPDATES);
    expect(v.stall.view).toEqual(STALL);
    expect(v.collect.view).toEqual(COLLECT);
    expect(v.dispatchAbandon.view).toEqual(ABANDON);
    expect(v.testbox.view).toEqual({ block: null });
    expect(v.linear.view).toEqual(LINEAR);
  });

  it('an answer that drops the view forgets the key too', async () => {
    await firstVisit();
    const notHere = (): Promise<never> => Promise.reject(new ApiError(501, { ok: false, error: 'not-configured' }));
    holdAll();
    for (const m of ['collectLane', 'dispatchAbandon', 'testbox'] as const) vi.spyOn(api, m).mockImplementation(notHere as never);
    for (const name of ['collect-lane', 'dispatch-abandon', 'testbox'] as const) expect(peek(settingsKey(name)), name).toBeDefined();
    visit();
    await waitFor(() => {
      const v = view();
      expect([v.collect.view, v.dispatchAbandon.view, v.testbox.view]).toEqual([null, null, null]);
    });
    for (const name of ['collect-lane', 'dispatch-abandon', 'testbox'] as const) {
      expect(peek(settingsKey(name)), name).toBeUndefined();
    }
  });

  it('a good answer replaces the kept one', async () => {
    await firstVisit();
    holdAll();
    const newer = { ...ABANDON, boundMs: 600_000 };
    vi.spyOn(api, 'dispatchAbandon').mockResolvedValue(newer);
    visit();
    expect(view().dispatchAbandon.view).toEqual(ABANDON);
    await waitFor(() => expect(view().dispatchAbandon.view).toEqual(newer));
    expect(peek(settingsKey('dispatch-abandon'))?.raw).toEqual(newer);
  });
});

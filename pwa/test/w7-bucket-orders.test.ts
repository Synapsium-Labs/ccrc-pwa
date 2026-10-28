// The two bucket orders and the row order of every surface that reads each, pinned before C7j makes one (D-7179;
// Task C7a Step 5; plan docs/superpowers/plans/2026-10-27-consolidation-w7-pwa.md, item 9; ARCH-75; OA-C14 decides).
// `fleet/sortFleet.ts#RANK` (and `BUCKET_ORDER`, computed from it) orders attention, done, idle, working, cleanup,
// archived, dead; `fleet/statusGroups.ts#STATUS_GROUPS` orders attention, done, working, idle, cleanup, archived, dead.
// They differ only in Working and Idle. Written on the tree #1715 (one bucket vocabulary) merged into, which draws the
// bucket bar in Refined and in Instrument's project mode and no chips in Instrument's status mode (coordinator call 3,
// D-7221): so the bar's rows are Refined's and Instrument project mode's, and the status table's row is its group heads.
// Every surface reads one mixed-bucket fixture: one session per bucket, on one card, titled by its bucket.
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { createElement } from 'react';
import { act, cleanup, render } from '@testing-library/react';
import type { FleetSession, SessionBucket } from '../../shared/api';
import { fleetSession } from './fleetFixture';
import { BUCKET_ORDER, RANK, sortFleet } from '../src/fleet/sortFleet';
import { STATUS_GROUPS, groupByStatus } from '../src/fleet/statusGroups';
import { BucketBar } from '../src/fleet/BucketBar';
import { fleetTree } from '../src/fleet/fleetTree';
import { fleetOrder } from '../src/command/commands';
import { FleetChromeProvider } from '../src/fleet/FleetChrome';
import { FleetScreen } from '../src/screens/FleetScreen';
import { FleetTable, GROUP_MODE_KEY } from '../src/skins/instrument/FleetTable';
import { createFleetStore, useFleetStore, type FleetStore } from '../src/stores/fleet';
import { api } from '../src/lib/api';

const ARCHIVED_AT = 1_784_500_000;
/** One row per bucket, given in an order neither ranking uses, so every surface's order is its own. */
const MIXED: readonly FleetSession[] = ([
  ['dead', 'dead'], ['working', 'busy'], ['cleanup', 'dead'], ['idle', 'idle'], ['attention', 'idle'], ['archived', 'dead'], ['done', 'idle'],
] as const).map(([bucket, status], i) => fleetSession({
  id: `session-${bucket}`, project: 'project-a', workspace: `ws-${bucket}`, title: bucket, status, bucket,
  statusUpdatedAt: 1_784_600_000_000 - i * 1000, bucketSince: 1_784_600_000_000 - i * 1000,
  ...(bucket === 'archived' || bucket === 'cleanup' ? { archivedAt: ARCHIVED_AT } : {}),
  ...(bucket === 'attention' ? { dialogPending: true } : {}),
}));

const fleetStore = (): FleetStore => createFleetStore({ makeSocket: () => ({ onopen: null, onmessage: null, onclose: null, onerror: null, close(): void {} }) as unknown as WebSocket });
const chromeApis = (): void => {
  vi.spyOn(api, 'fleetHealth').mockReturnValue(new Promise(() => {}));
  vi.spyOn(api, 'updates').mockReturnValue(new Promise(() => {}));
  vi.spyOn(api, 'projects').mockReturnValue(new Promise(() => {}));
  vi.spyOn(api, 'accounts').mockReturnValue(new Promise(() => {}));
};
/** The bucket bar's chips, in DOM order, by bucket. */
const barOrder = (): string[] => [...document.querySelectorAll('.bucket-bar .bucket-head')].map((e) => e.getAttribute('aria-label') ?? '');
/** The session lines on screen, in DOM order, by the bucket their title names. */
const lineOrder = (): string[] => [...document.querySelectorAll('.sess-open')].map((e) => {
  const t = e.textContent ?? '';
  return (['attention', 'done', 'idle', 'working', 'cleanup', 'archived', 'dead'] as const).find((b) => t.includes(b)) ?? `?${t.slice(0, 20)}`;
});

beforeEach(() => { window.localStorage.clear(); });
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  window.localStorage.clear();
  act(() => { useFleetStore.setState({ sessions: [], conn: 'connecting' }); });
});

describe('the two orders, as literal lists', () => {
  it('RANK (and BUCKET_ORDER, computed from it)', () => {
    expect(BUCKET_ORDER).toEqual(['attention', 'done', 'idle', 'working', 'cleanup', 'archived', 'dead']);
    expect((Object.keys(RANK) as SessionBucket[]).sort((a, b) => RANK[a] - RANK[b])).toEqual(BUCKET_ORDER);
  });
  it('STATUS_GROUPS (its order field, ascending)', () => {
    expect((Object.keys(STATUS_GROUPS) as SessionBucket[]).sort((a, b) => STATUS_GROUPS[a].order - STATUS_GROUPS[b].order))
      .toEqual(['attention', 'done', 'working', 'idle', 'cleanup', 'archived', 'dead']);
  });
});

describe('every surface over the mixed fixture', () => {
  it('sortFleet, the list order RANK drives', () => {
    expect(sortFleet([...MIXED]).map((s) => s.bucket)).toEqual(['attention', 'done', 'idle', 'working', 'cleanup', 'archived', 'dead']);
  });

  it('BucketBar (Refined, and Instrument\'s project mode): its chips in RANK order', () => {
    render(createElement(BucketBar, { sessions: [...MIXED], acks: {}, ackAll: () => {} }));
    expect(barOrder()).toEqual(['Needs you', 'Done', 'Idle', 'Working', 'Cleanup', 'Archived', 'Exited']);
  });

  it('the project cards through fleetTree: each card\'s rows', () => {
    const tree = fleetTree([...MIXED], ['project-a'], [], {});
    expect(tree.map((g) => g.rows.map((r) => (r.kind === 'session' ? r.session.bucket : 'pending')))).toEqual([['attention', 'done', 'idle', 'working', 'cleanup', 'dead']]);
    expect(tree.map((g) => g.archived.map((s) => s.bucket))).toEqual([['archived']]);
  });

  it('command/commands.ts#fleetOrder (the palette\'s ] and [ stepping and its Open session order)', () => {
    expect(fleetOrder(MIXED, []).map((s) => s.bucket)).toEqual(['attention', 'done', 'idle', 'working', 'cleanup', 'dead']);
  });

  it('Instrument status mode: its group heads only, in STATUS_GROUPS order (no chips)', () => {
    expect(groupByStatus(MIXED, {}).filter((g) => g.sessions.length > 0).map((g) => g.bucket)).toEqual(['attention', 'done', 'working', 'idle', 'cleanup', 'archived', 'dead']);
    chromeApis();
    act(() => { useFleetStore.setState({ conn: 'open', sessions: [...MIXED], fleetFrameSeen: true }); });
    render(createElement(FleetChromeProvider, { store: useFleetStore }, createElement(FleetTable)));
    expect(barOrder()).toEqual([]);
    expect([...document.querySelectorAll('.ins-group')].map((e) => e.getAttribute('data-status-group'))).toEqual(['attention', 'done', 'working', 'idle', 'cleanup', 'archived', 'dead']);
  });

  it('Instrument project mode: the bucket bar in RANK order, then the card', () => {
    window.localStorage.setItem(GROUP_MODE_KEY, 'project');
    chromeApis();
    act(() => { useFleetStore.setState({ conn: 'open', sessions: [...MIXED], fleetFrameSeen: true }); });
    render(createElement(FleetChromeProvider, { store: useFleetStore }, createElement(FleetTable)));
    expect(barOrder()).toEqual(['Needs you', 'Done', 'Idle', 'Working', 'Cleanup', 'Archived', 'Exited']);
    expect(lineOrder()).toEqual(LINES_PROJECT_MODE);
  });

  it('Refined: the bucket bar in RANK order, and the list', () => {
    chromeApis();
    const store = fleetStore();
    act(() => { store.setState({ conn: 'open', sessions: [...MIXED], fleetFrameSeen: true }); });
    render(createElement(FleetChromeProvider, { store }, createElement(FleetScreen, { store })));
    expect(barOrder()).toEqual(['Needs you', 'Done', 'Idle', 'Working', 'Cleanup', 'Archived', 'Exited']);
    expect(lineOrder()).toEqual(LINES_REFINED);
  });
});

/** The lines each board draws, the card's order (fleetTree's): the archived row sits in its card's closed Archived fold. */
const LINES_PROJECT_MODE: readonly string[] = ['attention', 'done', 'idle', 'working', 'cleanup', 'dead'];
const LINES_REFINED: readonly string[] = ['attention', 'done', 'idle', 'working', 'cleanup', 'dead'];

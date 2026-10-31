// The two bucket orders and the row order of every surface that reads each, pinned before C7j makes one (D-7179;
// Task C7a Step 5; plan docs/superpowers/plans/2026-10-27-consolidation-w7-pwa.md, item 9; ARCH-75; OA-C14 decides).
// `fleet/sortFleet.ts#RANK` (and `BUCKET_ORDER`, computed from it) ordered attention, done, idle, working, cleanup,
// archived, dead; `fleet/statusGroups.ts#STATUS_GROUPS` orders attention, done, working, idle, cleanup, archived, dead.
// They differed only in Working and Idle. OA-C14 (a) (D-7265) rules the status table's order the one order: C7j
// (D-7188) moves `RANK` onto `shared/api.ts#BUCKET_RANK`, so every surface row below reads Working above Idle. Written on the tree #1715 (one bucket vocabulary) merged into, which draws the
// bucket bar in Refined and in Instrument's project mode and no chips in Instrument's status mode (coordinator call 3,
// D-7221): so the bar's rows are Refined's and Instrument project mode's, and the status table's row is its group heads.
// Every surface reads one mixed-bucket fixture: one session per bucket, on one card, titled by its bucket.
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { createElement } from 'react';
import { act, cleanup, render } from '@testing-library/react';
import type { FleetSession, SessionBucket } from '../../shared/api';
import { fleetSession } from './fleetFixture';
import { RANK, sortFleet } from '../src/fleet/sortFleet';
import { BUCKET_ORDER } from '../../shared/api';
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
  it('RANK (and BUCKET_ORDER, computed from it): the ruled order, Working above Idle', () => {
    expect(BUCKET_ORDER).toEqual(['attention', 'done', 'working', 'idle', 'cleanup', 'archived', 'dead']);
    expect((Object.keys(RANK) as SessionBucket[]).sort((a, b) => RANK[a] - RANK[b])).toEqual(BUCKET_ORDER);
  });
  // C7j Step 4 (D-7188): STATUS_GROUPS keeps its labels and folds and loses its `order`; the status table reads the one
  // BUCKET_ORDER, which holds the order STATUS_GROUPS held, so the table's order is the same list.
  it('the status table (groupByStatus, over BUCKET_ORDER; STATUS_GROUPS holds labels and folds, no order)', () => {
    expect(groupByStatus([], {}).map((g) => g.bucket)).toEqual(['attention', 'done', 'working', 'idle', 'cleanup', 'archived', 'dead']);
    expect((Object.keys(STATUS_GROUPS) as SessionBucket[]).map((b) => Object.keys(STATUS_GROUPS[b]).sort().join(','))).toEqual(Array(7).fill('folds,label'));
  });
});

describe('every surface over the mixed fixture', () => {
  it('sortFleet, the list order RANK drives', () => {
    expect(sortFleet([...MIXED]).map((s) => s.bucket)).toEqual(['attention', 'done', 'working', 'idle', 'cleanup', 'archived', 'dead']);
  });

  it('BucketBar (Refined, and Instrument\'s project mode): its chips in BUCKET_ORDER', () => {
    render(createElement(BucketBar, { sessions: [...MIXED], acks: {}, ackAll: () => {} }));
    expect(barOrder()).toEqual(['Needs you', 'Done', 'Working', 'Idle', 'Cleanup', 'Archived', 'Exited']);
  });

  it('the project cards through fleetTree: each card\'s rows', () => {
    const tree = fleetTree([...MIXED], ['project-a'], [], {});
    expect(tree.map((g) => g.rows.map((r) => (r.kind === 'session' ? r.session.bucket : 'pending')))).toEqual([['attention', 'done', 'working', 'idle', 'cleanup', 'dead']]);
    expect(tree.map((g) => g.archived.map((s) => s.bucket))).toEqual([['archived']]);
  });

  it('command/commands.ts#fleetOrder (the palette\'s ] and [ stepping and its Open session order)', () => {
    expect(fleetOrder(MIXED, []).map((s) => s.bucket)).toEqual(['attention', 'done', 'working', 'idle', 'cleanup', 'dead']);
  });

  it('Instrument status mode: its group heads only, in STATUS_GROUPS order (no chips)', () => {
    expect(groupByStatus(MIXED, {}).filter((g) => g.sessions.length > 0).map((g) => g.bucket)).toEqual(['attention', 'done', 'working', 'idle', 'cleanup', 'archived', 'dead']);
    chromeApis();
    act(() => { useFleetStore.setState({ conn: 'open', sessions: [...MIXED], fleetFrameSeen: true }); });
    render(createElement(FleetChromeProvider, { store: useFleetStore }, createElement(FleetTable)));
    expect(barOrder()).toEqual([]);
    expect([...document.querySelectorAll('.ins-group')].map((e) => e.getAttribute('data-status-group'))).toEqual(['attention', 'done', 'working', 'idle', 'cleanup', 'archived', 'dead']);
  });

  it('Instrument project mode: the bucket bar in BUCKET_ORDER, then the card', () => {
    window.localStorage.setItem(GROUP_MODE_KEY, 'project');
    chromeApis();
    act(() => { useFleetStore.setState({ conn: 'open', sessions: [...MIXED], fleetFrameSeen: true }); });
    render(createElement(FleetChromeProvider, { store: useFleetStore }, createElement(FleetTable)));
    expect(barOrder()).toEqual(['Needs you', 'Done', 'Working', 'Idle', 'Cleanup', 'Archived', 'Exited']);
    expect(lineOrder()).toEqual(LINES_PROJECT_MODE);
  });

  it('Refined: the bucket bar in BUCKET_ORDER, and the list', () => {
    chromeApis();
    const store = fleetStore();
    act(() => { store.setState({ conn: 'open', sessions: [...MIXED], fleetFrameSeen: true }); });
    render(createElement(FleetChromeProvider, { store }, createElement(FleetScreen, { store })));
    expect(barOrder()).toEqual(['Needs you', 'Done', 'Working', 'Idle', 'Cleanup', 'Archived', 'Exited']);
    expect(lineOrder()).toEqual(LINES_REFINED);
  });
});

/** A desk (laptop 1280, wide 1920: `DESK_QUERY` matches) or a phone (360, 390: it does not). jsdom has no `matchMedia`,
 *  so the rows above read the phone; the desk rows below stub it (C7j Step 0, after #1715). */
function stubDesk(desk: boolean): void {
  vi.stubGlobal('matchMedia', (q: string) => ({
    matches: q.includes('min-width: 900px') ? desk : false,
    media: q, onchange: null,
    addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {}, dispatchEvent: () => false,
  }));
}

describe('the board surfaces at each width (C7j Step 0: the rows C7a left for after #1715, D-7221)', () => {
  afterEach(() => { vi.unstubAllGlobals(); });
  for (const desk of [false, true]) {
    const width = desk ? 'laptop and wide' : 'phone';
    it(`Instrument project mode at ${width}: the bucket bar in BUCKET_ORDER, then the card`, () => {
      stubDesk(desk);
      window.localStorage.setItem(GROUP_MODE_KEY, 'project');
      chromeApis();
      act(() => { useFleetStore.setState({ conn: 'open', sessions: [...MIXED], fleetFrameSeen: true }); });
      render(createElement(FleetChromeProvider, { store: useFleetStore }, createElement(FleetTable)));
      expect(barOrder()).toEqual(['Needs you', 'Done', 'Working', 'Idle', 'Cleanup', 'Archived', 'Exited']);
      expect(lineOrder()).toEqual(LINES_PROJECT_MODE);
    });
    it(`Instrument status mode at ${width}: no chips, and the group heads in STATUS_GROUPS order`, () => {
      stubDesk(desk);
      chromeApis();
      act(() => { useFleetStore.setState({ conn: 'open', sessions: [...MIXED], fleetFrameSeen: true }); });
      render(createElement(FleetChromeProvider, { store: useFleetStore }, createElement(FleetTable)));
      expect(barOrder()).toEqual([]);
      expect([...document.querySelectorAll('.ins-group')].map((e) => e.getAttribute('data-status-group'))).toEqual(['attention', 'done', 'working', 'idle', 'cleanup', 'archived', 'dead']);
    });
    it(`Refined at ${width}: the bucket bar in BUCKET_ORDER, and the list`, () => {
      stubDesk(desk);
      chromeApis();
      const store = fleetStore();
      act(() => { store.setState({ conn: 'open', sessions: [...MIXED], fleetFrameSeen: true }); });
      render(createElement(FleetChromeProvider, { store }, createElement(FleetScreen, { store })));
      expect(barOrder()).toEqual(['Needs you', 'Done', 'Working', 'Idle', 'Cleanup', 'Archived', 'Exited']);
      expect(lineOrder()).toEqual(LINES_REFINED);
    });
  }
});

/** The lines each board draws, the card's order (fleetTree's): the archived row sits in its card's closed Archived fold. */
const LINES_PROJECT_MODE: readonly string[] = ['attention', 'done', 'working', 'idle', 'cleanup', 'dead'];
const LINES_REFINED: readonly string[] = ['attention', 'done', 'working', 'idle', 'cleanup', 'dead'];

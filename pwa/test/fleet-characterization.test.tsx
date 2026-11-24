// The Fleet's own path keeps the Fleet (Overlord W1 home, Task 2 Step 1, the characterization; review 3319 F4). The Fleet
// moved from `/` to `/fleet`. What it draws there must be what `/` drew before the home: its header, its column and list, its
// doors and the pane beside it, in Refined, at a phone width (jsdom's default answer) and at 1280 px, from the same fixture
// (two sessions, a fixed clock, a server answering `/health` with no capability word and nothing else).
//
// THE BASELINE IS NOT THIS BUILD'S. `BASE_PICTURE` was measured once on the unmodified base of this branch, b33a9ae137
// (origin/main when the branch was cut), by a probe that ran the measuring code below, word for word, at `/` in a checkout of
// that commit, through the fleet test slice, on 2026-11-22 (1 test passed). It is written here as it came, never regenerated
// from the branch under test. The base drew `/` with `data-view="fleet"` and kept the address `/`; this build draws the same
// at `/fleet`. A change to what the Fleet draws is a decision: re-measure on a base checkout and say so, never edit the text.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render } from '@testing-library/react';
import { REFINED } from '@ccrc/ui';
import { App } from '../src/app';
import { navigate } from '../src/lib/router';
import { setSkin } from '../src/lib/skin';
import { useFleetStore } from '../src/stores/fleet';
import { useOverlordStore } from '../src/stores/overlord';
import { fleetSession } from './fleetFixture';

// ---- shared measuring code (identical in the base probe and the head test) ----
const FIXED_NOW = Date.UTC(2026, 10, 1, 12, 0, 0);
const FLEET_SESSIONS = [
  fleetSession({ id: 'project-a-one', project: 'project-a', name: 'first', bucket: 'attention', status: 'idle', statusUpdatedAt: FIXED_NOW - 120_000 }),
  fleetSession({ id: 'project-a-two', project: 'project-a', name: 'second', bucket: 'idle', status: 'busy', statusUpdatedAt: FIXED_NOW - 600_000 }),
];
const norm = (t: string | null | undefined): string => (t ?? '').replace(/\s+/g, ' ').trim();
interface FleetPicture {
  readonly view: string | null; readonly headers: readonly string[]; readonly column: string;
  readonly rows: readonly string[]; readonly doors: readonly string[]; readonly detail: string;
}
function fleetPicture(): FleetPicture {
  return {
    view: document.querySelector('.app-shell')?.getAttribute('data-view') ?? null,
    headers: [...document.querySelectorAll('header')].map((h) => norm(h.textContent)),
    column: norm(document.querySelector('.shell-nav')?.textContent),
    rows: [...document.querySelectorAll('.fleet-list > *')].map((r) => norm(r.textContent)),
    doors: [...document.querySelectorAll('[data-command]')].map((d) =>
      `${d.getAttribute('data-command')}|${d.getAttribute('aria-label') ?? norm(d.textContent)}|${d.getAttribute('aria-current') ?? ''}`),
    detail: norm(document.querySelector('.shell-detail')?.textContent),
  };
}
/** Every width query answered against one viewport width, or none (jsdom's default answer, a phone). */
function fleetWidth(width: number | null): void {
  if (width === null) return;
  vi.stubGlobal('matchMedia', (q: string) => {
    const min = /min-width:\s*([\d.]+)px/.exec(q);
    const max = /max-width:\s*([\d.]+)px/.exec(q);
    const matches = (min === null || width >= Number(min[1])) && (max === null || width <= Number(max[1])) && (min !== null || max !== null);
    return { matches, media: q, onchange: null, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {}, dispatchEvent: () => false };
  });
}
/** A server that answers `/health` with no capability word, and nothing else (offline). */
function fleetFetch(): void {
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.pathname : input.url;
    if (url === '/health' || url.endsWith('/health')) {
      return new Response(JSON.stringify({ ok: true, build: null, caps: [] }), { status: 200, headers: { 'content-type': 'application/json' } });
    }
    throw new TypeError('offline');
  }));
}
async function drawFleetAt(path: string, width: number | null): Promise<FleetPicture> {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(FIXED_NOW);
  setSkin(REFINED);
  fleetWidth(width);
  fleetFetch();
  act(() => useFleetStore.setState({ conn: 'open', sessions: FLEET_SESSIONS, fleetFrameSeen: true }));
  act(() => { navigate(path); });
  render(<App />);
  await act(async () => { for (let i = 0; i < 20; i++) await Promise.resolve(); });
  return fleetPicture();
}
// ---- end of the shared measuring code ----

/** What the Fleet drew at `/` on the base, b33a9ae137 (see the header): the phone first, then the desk at 1280 px. */
const BASE_PICTURE: Readonly<Record<'phone' | 'desk', FleetPicture>> = {
  phone: {
    "view": "fleet",
    "headers": [
      "❯ccrc2 sessions · 1 waiting"
    ],
    "column": "❯ccrc2 sessions · 1 waitingLast known state — connecting…Runs · —AutomaticDefaultFableOpusSonnetHaikuNew projectNeeds you1Idle1▾held open: a question here is waiting on youproject-a2 sessionsclaude●+●firstwaitingneeds you···○secondidle···New",
    "rows": [
      "▾held open: a question here is waiting on youproject-a2 sessionsclaude●+●firstwaitingneeds you···○secondidle···"
    ],
    "doors": [
      "go-settings|Settings|",
      "new-session|New session|",
      "go-fleet|Fleet|page",
      "go-waiting|Waiting|",
      "go-inbox|Inbox, 1 waiting for you|",
      "go-runs|Runs|",
      "go-accounts|Accounts|",
      "go-docs|Docs|",
      "open-palette|Search and commands|"
    ],
    "detail": "❯Select a session"
  },
  desk: {
    "view": "fleet",
    "headers": [
      "❯ccrcWaiting on youInbox 1RunsAccountsDocs⌘KSettings+New sessionchecking accounts…",
      "2 sessions · 1 waiting"
    ],
    "column": "2 sessions · 1 waitingRuns · —AutomaticDefaultFableOpusSonnetHaikuNew projectNeeds you1Idle1▾held open: a question here is waiting on youproject-a2 sessionsclaude●+●firstwaitingneeds you···○secondidle···",
    "rows": [
      "▾held open: a question here is waiting on youproject-a2 sessionsclaude●+●firstwaitingneeds you···○secondidle···"
    ],
    "doors": [
      "go-waiting|Waiting on you|",
      "go-inbox|Inbox, 1 waiting for you|",
      "go-runs|Runs|",
      "go-accounts|Accounts|",
      "go-docs|Docs|",
      "open-palette|Search and commands|",
      "go-settings|Settings|",
      "new-session|+New session|",
      "go-accounts|account usage — open accounts|"
    ],
    "detail": "❯Select a session"
  },
};

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  act(() => useFleetStore.setState({ sessions: [], conn: 'connecting', fleetFrameSeen: false }));
  act(() => useOverlordStore.setState({ caps: { state: 'loading' }, designation: { state: 'loading' }, ladder: { state: 'loading' } }));
});

describe('the Fleet at /fleet draws what / drew on the base (the characterization)', () => {
  for (const [name, width] of [['phone', null], ['desk', 1280]] as const) {
    it(`${name}: the header, the column and its list, the doors and the pane, as measured on b33a9ae137`, async () => {
      const at = await drawFleetAt('/fleet', width);
      expect(location.pathname).toBe('/fleet');
      expect(at).toEqual(BASE_PICTURE[name]);
    });
  }
});

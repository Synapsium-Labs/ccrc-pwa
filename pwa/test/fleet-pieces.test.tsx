// The fleet pieces both skins' shells place (W2 Task S2c; D-5471, D-5472): the banner stack and its order,
// the fleet's one count readout, and the compact lane gauges. Each is built once here so Refined's app bar
// (S4b, S5) and Instrument's shell (S9, S11) only place them; a skin never re-implements one.
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import type { AccountUsage, AuthStatus, FleetHealth, FleetSession, NodeWire, RunSummary, UpdatesView } from '../../shared/api';
import { BANNER_ORDER, BannerStack, LOCAL_BANNERS, type BannerRank } from '../src/fleet/BannerStack';
import { fleetSummary } from '../src/fleet/fleetSummary';
import { AccountsStrip } from '../src/fleet/AccountsStrip';
import { COMPACT_FIT, CompactGauges, compactDoorLabel, compactReading, hiddenGauges } from '../src/fleet/CompactGauges';
import { DOOR_EVENT } from '../src/command/door';
import { FleetHostBanner, fleetHostBannerShows } from '../src/fleet/FleetHostBanner';
import { HaltBanner, haltBannerShows } from '../src/fleet/HaltBanner';
import { UpdateBanner, updateBannerShows } from '../src/fleet/UpdateBanner';
import { SubstrateBanner, substrateBannerShows } from '../src/fleet/SubstrateBanner';
import { PasskeyNotice, passkeyNoticeShows } from '../src/fleet/PasskeyNotice';
import { createFleetStore } from '../src/stores/fleet';
import { fleetSession } from './fleetFixture';
import { api } from '../src/lib/api';
import { navigate } from '../src/lib/router';

// This browser can enrol, so the passkey notice's check turns on the posture alone.
vi.mock('../src/lib/passkey', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../src/lib/passkey')>()), passkeyEnrollSupported: () => true,
}));

const SRC = path.join(import.meta.dirname, '..', 'src');

afterEach(() => { cleanup(); vi.restoreAllMocks(); navigate('/'); });

describe('BannerStack', () => {
  // A test order, so the fold is measured on its own: the fleet's real order has no alert today (every banner
  // on main is `role="status"`), and the rule "an alert is never folded" must hold before one arrives.
  const ORDER: Record<string, BannerRank> = {
    n1: { rank: 1, role: 'status', module: null },
    n2: { rank: 2, role: 'status', module: null },
    n3: { rank: 3, role: 'status', module: null },
    n4: { rank: 4, role: 'status', module: null },
    n5: { rank: 5, role: 'status', module: null },
    a1: { rank: 6, role: 'alert', module: null },
    a2: { rank: 7, role: 'alert', module: null },
    a3: { rank: 8, role: 'alert', module: null },
  };
  const note = (id: string, shows = true) => ({ id, shows, node: shows ? <div role="status">{id}</div> : null });
  const alert = (id: string) => ({ id, shows: true, node: <div role="alert">{id}</div> });

  it('the stack shows the first two applicable non-alert banners in BANNER_ORDER, then +n more, which expands the rest', () => {
    // Given out of order, with one that does not apply: the stack sorts by rank and counts only what shows.
    render(<BannerStack order={ORDER} items={[note('n4'), note('n2', false), note('n3'), note('n1'), note('n5')]} />);
    expect(screen.getAllByRole('status').map((el) => el.textContent)).toEqual(['n1', 'n3']);
    expect(screen.getByText('n4')).not.toBeVisible();
    expect(screen.getByText('n5')).not.toBeVisible();
    const more = screen.getByRole('button', { name: '2 more banners' });
    expect(more).toHaveAttribute('aria-expanded', 'false');
    fireEvent.click(more);
    expect(screen.getAllByRole('status').map((el) => el.textContent)).toEqual(['n1', 'n3', 'n4', 'n5']);
    expect(screen.getByRole('button', { name: 'Show fewer banners' })).toHaveAttribute('aria-expanded', 'true');
  });

  it('two or fewer applicable banners render with no fold control', () => {
    render(<BannerStack order={ORDER} items={[note('n1'), note('n2')]} />);
    expect(screen.getAllByRole('status')).toHaveLength(2);
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('an alert is never folded', () => {
    // Three alerts and one notice: the notice outranks them all, so a stack that counted alerts toward the two
    // would fold two alerts.
    render(<BannerStack order={ORDER} items={[alert('a1'), alert('a2'), alert('a3'), note('n1')]} />);
    expect(screen.getAllByRole('alert').map((el) => el.textContent)).toEqual(['a1', 'a2', 'a3']);
    for (const el of screen.getAllByRole('alert')) expect(el).toBeVisible();
    expect(screen.getByRole('status')).toHaveTextContent('n1');
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('alerts never count toward the two: three alerts and three notices fold exactly one notice', () => {
    render(<BannerStack order={ORDER} items={[alert('a1'), alert('a2'), alert('a3'), note('n1'), note('n2'), note('n3')]} />);
    expect(screen.getAllByRole('alert')).toHaveLength(3);
    expect(screen.getAllByRole('status').map((el) => el.textContent)).toEqual(['n1', 'n2']);
    expect(screen.getByRole('button', { name: '1 more banner' })).toHaveTextContent('+1 more');
  });

  it('the connection lines are pinned: with three banners above them, Reconnecting… still shows', () => {
    // The fleet's own order. Fleet host, halt and update take the two and fold one; the offline line ranks below
    // them all and says every one of them is stale, so it is never the one folded.
    const line = (id: string, text: string) => ({ id, shows: true, node: <div role="status">{text}</div> }) as const;
    render(<BannerStack items={[
      line('fleet-host', 'host'), line('halt', 'halt'), line('update', 'update'), line('offline', 'Reconnecting…'),
    ] as never} />);
    expect(screen.getByText('Reconnecting…')).toBeVisible();
    expect(screen.getByText('update')).not.toBeVisible();
    expect(screen.getByRole('button', { name: '1 more banner' })).toBeInTheDocument();
  });

  it('every banner module the fleet renders is in BANNER_ORDER or LOCAL_BANNERS, and every entry names a module the fleet renders', () => {
    // A source scan, both directions. A banner module is a file under `fleet/` named for one; it is rendered when
    // any other source file writes it as JSX.
    const files: string[] = [];
    const walk = (dir: string): void => {
      for (const e of readdirSync(dir, { withFileTypes: true })) {
        const p = path.join(dir, e.name);
        if (e.isDirectory()) walk(p);
        else if (/\.tsx?$/.test(e.name)) files.push(p);
      }
    };
    walk(SRC);
    const source = new Map(files.map((f) => [f, readFileSync(f, 'utf8')]));
    const renderedElsewhere = (name: string): boolean =>
      [...source].some(([f, text]) => path.basename(f, path.extname(f)) !== name && new RegExp(`<${name}[\\s/>]`).test(text));
    const modules = readdirSync(path.join(SRC, 'fleet'))
      .filter((f) => f.endsWith('.tsx'))
      .map((f) => f.slice(0, -4))
      .filter((m) => /(Banner|Notice|Attention|AttentionList|Recovery)$/.test(m))
      .filter(renderedElsewhere)
      .sort();
    const ordered = Object.values(BANNER_ORDER).map((r) => r.module).filter((m): m is string => m !== null);
    const registered = [...ordered, ...Object.keys(LOCAL_BANNERS)].sort();
    expect(registered).toEqual(modules);
    // A global banner is the fleet's: FleetScreen renders each one once, through the stack's items.
    const fleet = source.get(path.join(SRC, 'screens', 'FleetScreen.tsx'))!;
    for (const m of ordered) expect(fleet.match(new RegExp(`<${m}[\\s/>]`, 'g'))?.length, m).toBe(1);
    for (const id of Object.keys(BANNER_ORDER)) expect(fleet, id).toContain(`id: '${id}'`);
    // Every local entry carries its reason.
    for (const [m, why] of Object.entries(LOCAL_BANNERS)) expect(why.length, m).toBeGreaterThan(20);
  });
});

describe('each banner draws exactly when its check says it shows', () => {
  // The stack folds on the checks and never reads a banner's DOM, so a check that drifts from its render shows a
  // "+1 more" that opens to nothing, or folds a real banner behind one that never draws. Each module, over fixtures
  // that apply and that do not.
  const drawn = (container: HTMLElement): boolean => container.innerHTML.trim() !== '';
  const stamp = (version: string) => ({ sha: 'bd2bf57a91c3e0d4f6a8b2c5e7d9f1a3b5c7e9d1', ref: 'main', builtAt: '2026-09-20T12:00:00Z', dirty: false, version });
  const node = (over: Partial<NodeWire> = {}): NodeWire => ({
    nodeId: '0b6e1c62-7a4f-4d0e-9c1a-3f2d5e8a9b10', role: 'fleet', label: 'fleet', os: 'linux',
    current: stamp('v0.0.7'), stampRead: 'ok', installState: 'complete', provenance: 'verified',
    caps: ['update-gate'], agentOps: [], highestVersion: 'v0.0.7', previousVersion: null, floorRead: 'measured', previousRead: 'absent',
    measuredAt: Date.now() - 60_000, reachable: true, unreachableSince: null,
    channel: 'stable', desiredTag: 'v0.0.9', resolveDetail: null, request: null, report: null,
    update: { state: 'idle', target: null, startedAt: null, detail: null }, ...over,
  }) as NodeWire;
  const view = (nodes: NodeWire[]): UpdatesView => ({ catalogue: { lastOkAt: Date.now() - 60_000, lastError: null }, releases: [], nodes, intent: [] });
  const current = node({ desiredTag: 'v0.0.7' });
  const halted = node({ update: { state: 'failed', target: 'v0.0.9', startedAt: 1, detail: 'gate: unit not up' } });
  const views: (UpdatesView | null)[] = [null, view([current]), view([node()]), view([halted])];

  it('HaltBanner', () => {
    for (const v of views) {
      const { container } = render(<HaltBanner updates={v} seq={1} onAcked={() => 2} />);
      expect(drawn(container), JSON.stringify(v?.nodes.map((n) => n.update.state))).toBe(haltBannerShows(v));
      cleanup();
    }
    expect(views.map(haltBannerShows)).toContain(true);
    expect(views.map(haltBannerShows)).toContain(false);
  });

  it('UpdateBanner (its sheets stay mounted, so the banner line is what is drawn)', () => {
    for (const v of views) {
      render(<UpdateBanner updates={v} />);
      expect(document.querySelector('.update-banner') !== null, JSON.stringify(v?.nodes.map((n) => n.desiredTag))).toBe(updateBannerShows(v));
      cleanup();
    }
    expect(views.map(updateBannerShows)).toContain(true);
    expect(views.map(updateBannerShows)).toContain(false);
  });

  it('FleetHostBanner', () => {
    const healths: FleetHealth[] = [
      { mode: 'local', connected: true, downSince: null },
      { mode: 'remote', connected: true, downSince: null },
      { mode: 'remote', connected: false, downSince: Date.now() - 60_000 },
    ];
    for (const h of healths) {
      const { container } = render(<FleetHostBanner health={h} nodes={[]} intent={[]} />);
      expect(drawn(container), JSON.stringify(h)).toBe(fleetHostBannerShows(h));
      cleanup();
    }
    expect(healths.map(fleetHostBannerShows)).toEqual([false, false, true]);
  });

  it('SubstrateBanner', () => {
    const fault = { at: 1, text: 'protocol version mismatch' };
    const row = (over: Partial<FleetSession>) => fleetSession({ workspace: 'quiet-basin', status: 'busy', bucket: 'working', lifecycle: 'running', ...over });
    const cases: FleetSession[][] = [[], [row({ id: 'a' })], [row({ id: 'a', lifecycle: 'restarting', substrate: fault })]];
    for (const sessions of cases) {
      const store = createFleetStore({ makeSocket: () => ({ onopen: null, onmessage: null, onclose: null, onerror: null, close(): void {} }) as unknown as WebSocket });
      store.setState({ sessions });
      const { container } = render(<SubstrateBanner store={store} />);
      expect(drawn(container), String(sessions.length)).toBe(substrateBannerShows(sessions));
      cleanup();
    }
    expect(cases.map(substrateBannerShows)).toEqual([false, false, true]);
  });

  it('PasskeyNotice', () => {
    const statuses: (Partial<AuthStatus> | null)[] = [
      null,
      { mode: 'off', authed: true, passkeysEnrolled: 0 },
      { mode: 'passphrase', authed: true, passkeysEnrolled: 1 },
      { mode: 'passphrase', authed: true, passkeysEnrolled: 0 },
    ];
    for (const st of statuses) {
      const { container } = render(<PasskeyNotice status={st} />);
      expect(drawn(container), JSON.stringify(st)).toBe(passkeyNoticeShows(st));
      cleanup();
    }
    expect(statuses.map(passkeyNoticeShows)).toEqual([false, false, false, true]);
  });
});

describe('fleetSummary', () => {
  const session = (bucket: string, dialogPending: boolean): FleetSession =>
    ({ id: `s-${bucket}-${String(dialogPending)}`, bucket, dialogPending }) as unknown as FleetSession;
  const run = (state: string): RunSummary => ({ state }) as unknown as RunSummary;

  it('fleetSummary counts waiting from the attention bucket', () => {
    // A killed session can still be `dialogPending` (the hook's last `waiting` is ORed in); the server buckets it
    // `dead`, and it is not waiting on anyone.
    const sessions = [session('attention', true), session('dead', true), session('working', false)];
    const s = fleetSummary(sessions, [run('working'), run('done'), run('dispatched')]);
    expect(s).toMatchObject({ sessions: 3, waiting: 1, runs: 2 });
    expect(s.readout).toBe('3 sessions · 1 waiting · 2 runs');
  });

  it('says only what it knows: no waiting part at zero, no runs part when the runs are unknown', () => {
    expect(fleetSummary([session('working', false)], null).readout).toBe('1 session');
    expect(fleetSummary([session('attention', true)], [run('working')]).readout).toBe('1 session · 1 waiting · 1 run');
    expect(fleetSummary([], []).readout).toBe('0 sessions');
  });
});

describe('the compact gauges', () => {
  const nowSec = Math.floor(Date.now() / 1000);
  const lane = (wrapper: string, five: number | null, seven: number | null, over: Partial<AccountUsage> = {}): AccountUsage => ({
    wrapper, five, seven, ts: nowSec - 60, fiveResetAt: null, sevenResetAt: null,
    fiveRolledOver: false, sevenRolledOver: false, disabled: false, authDead: false, ...over,
  });
  const stub = (accounts: AccountUsage[]): void => {
    vi.spyOn(api, 'accounts').mockResolvedValue({ accounts, projected: { wrapper: accounts[0]?.wrapper ?? 'x', score: 0 }, roster: [] });
  };
  const seven = [
    lane('lane-a', 30, 80), lane('lane-b', 12, null), lane('lane-c', null, 5), lane('lane-d', 1, 2),
    lane('lane-e', 3, 4), lane('lane-f', 5, 6), lane('lane-g', 7, 8), lane('lane-off', 99, 99, { disabled: true }),
  ];

  it('the compact gauges: one meter per lane, +n where they do not fit, the group one door to /accounts', async () => {
    stub(seven);
    const { container } = render(<AccountsStrip compact="bar" />);
    const door = await screen.findByRole('link', { name: /^account usage.* — open accounts$/ });
    await within(door).findByText('lane-a');
    expect(door).toHaveAttribute('data-compact', 'bar');
    // The first that fit, one meter each, its name and its binding (the larger) percentage; then "+n" in the door.
    expect(door.querySelectorAll('.meter')).toHaveLength(COMPACT_FIT.bar);
    expect(within(door).getByText('80%')).toBeInTheDocument();
    expect(within(door).getByText(`+${7 - COMPACT_FIT.bar}`)).toBeInTheDocument();
    expect(within(door).queryByText('lane-off')).toBeNull();
    // One door: nothing inside it is a control of its own.
    expect(container.querySelectorAll('[role="link"], a, button')).toHaveLength(1);
    // The group is the `go-accounts` door (W2 Task S4b): it asks the command layer, which navigates.
    expect(door).toHaveAttribute('data-command', 'go-accounts');
    const ran: string[] = [];
    const hear = (e: Event): void => { ran.push((e as CustomEvent<string>).detail); };
    window.addEventListener(DOOR_EVENT, hear);
    fireEvent.click(door);
    fireEvent.keyDown(door, { key: 'Enter' });
    window.removeEventListener(DOOR_EVENT, hear);
    expect(ran).toEqual(['go-accounts', 'go-accounts']);
  });

  it('led fits more than bar; grid places every lane, two to a row, with no +n', async () => {
    stub(seven);
    render(<AccountsStrip compact="led" />);
    const led = await screen.findByRole('link', { name: /^account usage.* — open accounts$/ });
    await within(led).findByText('lane-a');
    expect(led.querySelectorAll('.meter')).toHaveLength(Math.min(7, COMPACT_FIT.led));
    expect(COMPACT_FIT.led).toBeGreaterThan(COMPACT_FIT.bar);
    cleanup();
    stub(seven);
    render(<AccountsStrip compact="grid" />);
    const grid = await screen.findByRole('link', { name: /^account usage.* — open accounts$/ });
    await within(grid).findByText('lane-a');
    expect(grid.querySelectorAll('.meter')).toHaveLength(7);
    expect(within(grid).queryByText(/^\+\d+$/)).toBeNull();
  });

  it('the compact arrangement keeps the strip\'s placeholder, so the door never renders nothing', async () => {
    stub([]);
    render(<AccountsStrip compact="bar" />);
    const door = await screen.findByRole('link', { name: /^account usage.* — open accounts$/ });
    expect(await within(door).findByText('no accounts reporting')).toBeInTheDocument();
  });

  it('the reading is kept three ways, like the full strip: reset when the binding window rolled over, — never measured', () => {
    expect(compactReading(lane('x', 30, 80))).toBe('80%');
    expect(compactReading(lane('x', null, null))).toBe('—');
    // The 5h window rolled over (the server zeroed it) and nothing else was measured: the zero is inferred.
    expect(compactReading(lane('x', 0, null, { fiveRolledOver: true }))).toBe('reset');
    // The 5h window rolled over, but the 7d one binds and was measured.
    expect(compactReading(lane('x', 0, 40, { fiveRolledOver: true }))).toBe('40%');
    expect(compactReading(lane('x', 0, 0, { fiveRolledOver: true, sevenRolledOver: true }))).toBe('reset');
    // A measured zero beside a rolled-over zero is still measured.
    expect(compactReading(lane('x', 0, 0, { fiveRolledOver: true }))).toBe('0%');
  });

  it('the fit is measured: a gauge below the first line wrapped out of the box and counts into +n', () => {
    const at = (...tops: number[]): { top: number; right: number }[] => tops.map((top) => ({ top, right: 100 }));
    expect(hiddenGauges([], 200)).toEqual([]);
    expect(hiddenGauges(at(10, 10, 10), 200)).toEqual([false, false, false]);
    expect(hiddenGauges(at(10, 10, 28, 28), 200)).toEqual([false, false, true, true]);
    expect(hiddenGauges(at(10, 10.5, 28), 200)).toEqual([false, false, true]);
  });

  // The first gauge cannot wrap (it opens the line), so in a row narrower than its floor it was squeezed and its
  // reading cut, and the "+n" never said it (W2 Task S4b review: the bar at 900 drew a meter with no number). A gauge
  // whose right edge passes the row's is hidden too, and counts into +n, the first one included.
  it('the fit is measured: a gauge whose right edge passes the row\'s is hidden and counts into +n, the first one too', () => {
    expect(hiddenGauges([{ top: 10, right: 629 }], 593)).toEqual([true]);
    expect(hiddenGauges([{ top: 10, right: 593.5 }, { top: 28, right: 400 }], 593)).toEqual([false, true]);
  });

  it('a row too narrow for its first gauge hides that gauge and says every lane in +n, first', () => {
    const six = [lane('lane-a', 100, 50), lane('lane-b', 88, 50), lane('lane-c', 76, 50), lane('lane-d', 40, 50), lane('lane-e', 30, 50), lane('lane-f', 20, 50)];
    // jsdom lays nothing out: the row is 84 wide and the first gauge, which opens its line, ends 36 past it; the
    // rest wrapped below. The bar places four lanes (COMPACT_FIT), so two more are capped.
    vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (this: Element) {
      const box = (left: number, top: number, right: number): DOMRect =>
        ({ left, top, right, bottom: top + 18, width: right - left, height: 18, x: left, y: top, toJSON: () => ({}) }) as DOMRect;
      if (this.classList.contains('accounts-compact-lanes')) return box(509, 10, 593);
      if (this.classList.contains('accounts-compact-gauge')) {
        return this === this.parentElement?.firstElementChild ? box(509, 10, 629) : box(509, 28, 629);
      }
      return box(0, 0, 0);
    });
    const { container } = render(<CompactGauges compact="bar" lanes={six} roster={[]} placeholder={null} />);
    const gauges = [...container.querySelectorAll('.accounts-compact-gauge')];
    expect(gauges).toHaveLength(4);
    expect(gauges.map((g) => g.hasAttribute('data-clipped'))).toEqual([true, true, true, true]);
    expect(container.querySelector('.accounts-compact-more')).toHaveTextContent('+6');
    expect(container.querySelector('.accounts-compact')).toHaveAttribute('data-lanes-hidden');
  });

  it('the door\'s name carries the fullest lane\'s reading', () => {
    expect(compactDoorLabel([], [])).toBe('account usage — open accounts');
    expect(compactDoorLabel([lane('lane-a', 30, 80), lane('lane-b', 90, null)], [])).toBe('account usage, highest lane-b 90% — open accounts');
  });
});

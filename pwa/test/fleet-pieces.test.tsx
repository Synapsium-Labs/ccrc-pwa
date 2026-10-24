// The fleet pieces both skins' shells place (W2 Task S2c; D-5471, D-5472): the banner stack and its order,
// the fleet's one count readout. Each is built once here so Refined's app bar
// (S4b, S5) and Instrument's shell (S9, S11) only place them; a skin never re-implements one.
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { AuthStatus, FleetHealth, FleetSession, NodeWire, RunSummary, UpdatesView } from '../../shared/api';
import { BANNER_ORDER, BannerStack, LOCAL_BANNERS, type BannerRank } from '../src/fleet/BannerStack';
import { fleetSummary } from '../src/fleet/fleetSummary';
import { FleetHostBanner, fleetHostBannerShows } from '../src/fleet/FleetHostBanner';
import { HaltBanner, haltBannerShows } from '../src/fleet/HaltBanner';
import { SubstrateBanner, substrateBannerShows } from '../src/fleet/SubstrateBanner';
import { PasskeyNotice, passkeyNoticeShows } from '../src/fleet/PasskeyNotice';
import { createFleetStore } from '../src/stores/fleet';
import { fleetSession } from './fleetFixture';
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
    // The fleet's own order. Fleet host, halt and substrate take the two and fold one; the offline line ranks below
    // them all and says every one of them is stale, so it is never the one folded.
    const line = (id: string, text: string) => ({ id, shows: true, node: <div role="status">{text}</div> }) as const;
    render(<BannerStack items={[
      line('fleet-host', 'host'), line('halt', 'halt'), line('substrate', 'substrate'), line('offline', 'Reconnecting…'),
    ] as never} />);
    expect(screen.getByText('Reconnecting…')).toBeVisible();
    expect(screen.getByText('substrate')).not.toBeVisible();
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

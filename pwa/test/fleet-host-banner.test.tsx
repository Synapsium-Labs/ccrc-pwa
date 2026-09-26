// FleetHostBanner — degraded-mode banner: hidden while the fleet is local or
// the remote host is reachable; when unreachable it names how long and offers
// a Reboot action gated behind a QuickConfirm whose copy names the collateral.
// The copy states the property EVERY fleet host has — a reboot takes the whole
// box down — rather than naming one fleet's co-tenant services, which on any
// other box was a false claim about the reader's machine.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { FleetHealth, NodeWire } from '../../shared/api';
import type { BuildInfo } from '../../shared/buildinfo';
import { api } from '../src/lib/api';
import { FleetHostBanner } from '../src/fleet/FleetHostBanner';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const health = (over: Partial<FleetHealth> = {}): FleetHealth => ({
  mode: 'remote',
  connected: false,
  downSince: Date.now() - 5 * 60_000,
  ...over,
});

const POOLS_UNAVAILABLE_COPY =
  "The fleet host's ccd does not honour project pools yet. Redeploy the agent lane.";

/** The skew arm's version clause reads the node inventory (centralised-update
 *  §14). A measured stable node; `current` null = a stamp that did not read. */
const inventoryNode = (role: 'fleet' | 'server' | 'both', current: BuildInfo | null): NodeWire => ({
  nodeId: role === 'fleet' ? '0b6e1c62-7a4f-4d0e-9c1a-3f2d5e8a9b10' : '5f3a9d21-2c8b-4e6f-a1d7-8b0c4e2f6a93',
  role, label: role === 'fleet' ? 'fleet' : 'server', os: 'linux',
  current, stampRead: current === null ? 'absent' : 'ok', installState: 'complete', provenance: 'verified',
  caps: [], agentOps: role === 'fleet' ? [] : null, highestVersion: current?.version ?? null, previousVersion: null,
  measuredAt: Date.now() - 60_000, reachable: true, unreachableSince: null,
  channel: 'stable', desiredTag: current?.version ?? null, resolveDetail: null,
  request: null, report: null,
  update: { state: 'idle', target: null, startedAt: null, detail: null },
});
const FLEET_V7: BuildInfo = { sha: 'bd2bf57a8733883085b3c118911fc983dc441299', ref: 'release', builtAt: '2026-09-18T00:00:00Z', dirty: false, version: 'v0.0.7' };
const SERVER_V9: BuildInfo = { sha: '2985b9d1000000000000000000000000000000000', ref: 'release', builtAt: '2026-09-18T00:00:00Z', dirty: false, version: 'v0.0.9' };
/** A stamp pair on the HEALTH answer that disagrees with every inventory row:
 *  whatever renders from it is the old reader, not the new one. */
const DECOY_BUILDS = {
  fleet: { sha: '9'.repeat(40), ref: 'release', builtAt: '2026-09-18T00:00:00Z', dirty: false, version: 'v9.9.9' },
  own: { sha: '9'.repeat(40), ref: 'release', builtAt: '2026-09-18T00:00:00Z', dirty: false, version: 'v9.9.9' },
};

describe('FleetHostBanner', () => {
  it('keeps the newest issued poll authoritative when an older request resolves last', async () => {
    vi.useFakeTimers();
    try {
      const first = Promise.withResolvers<FleetHealth>();
      const latest = health({ connected: true, downSince: null, roster: 'divergent' });
      vi.spyOn(api, 'fleetHealth')
        .mockReturnValueOnce(first.promise)
        .mockResolvedValueOnce(latest);

      render(<FleetHostBanner />);
      await act(async () => { await vi.advanceTimersByTimeAsync(15_000); });
      expect(screen.getByText(/different account rosters/i)).toBeInTheDocument();

      await act(async () => { first.resolve(health()); await first.promise; });
      expect(screen.getByText(/different account rosters/i)).toBeInTheDocument();
      expect(screen.queryByText(/unreachable/i)).not.toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });

  it('renders nothing while the fleet is local', async () => {
    vi.spyOn(api, 'fleetHealth').mockResolvedValue(health({ mode: 'local', connected: true, downSince: null }));
    render(<FleetHostBanner />);
    await act(async () => {});
    expect(screen.queryByText(/unreachable/i)).not.toBeInTheDocument();
  });

  it('renders nothing while remote and connected', async () => {
    vi.spyOn(api, 'fleetHealth').mockResolvedValue(health({ connected: true, downSince: null }));
    render(<FleetHostBanner />);
    await act(async () => {});
    expect(screen.queryByText(/unreachable/i)).not.toBeInTheDocument();
  });

  it('renders an unreachable banner + Reboot button when remote and disconnected', async () => {
    vi.spyOn(api, 'fleetHealth').mockResolvedValue(health());
    render(<FleetHostBanner />);
    expect(await screen.findByText(/unreachable/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Reboot' })).toBeInTheDocument();
  });

  it('warns when the host is UP but the two boxes disagree about the roster', async () => {
    vi.spyOn(api, 'fleetHealth').mockResolvedValue(
      health({ connected: true, downSince: null, roster: 'divergent' }));
    render(<FleetHostBanner />);
    expect(await screen.findByText(/different account rosters/i)).toBeInTheDocument();
    // No action button: the fix is a deploy or an edit on one of the two
    // boxes, and offering a button that cannot do either is worse than none.
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });

  it('stays silent on an unknown roster answer — an older agent reports no digest', async () => {
    // The distinction that makes `roster` a three-state and not a boolean. A
    // banner that fires whenever nothing was checked is a banner nobody reads
    // by the time something IS wrong.
    vi.spyOn(api, 'fleetHealth').mockResolvedValue(
      health({ connected: true, downSince: null, roster: 'unknown' }));
    render(<FleetHostBanner />);
    await act(async () => {});
    expect(screen.queryByText(/different account rosters/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/unreachable/i)).not.toBeInTheDocument();
  });

  it('an unreachable host outranks a roster warning — nothing can be fixed until it is back', async () => {
    vi.spyOn(api, 'fleetHealth').mockResolvedValue(health({ roster: 'divergent' }));
    render(<FleetHostBanner />);
    expect(await screen.findByText(/unreachable/i)).toBeInTheDocument();
    expect(screen.queryByText(/different account rosters/i)).not.toBeInTheDocument();
  });

  it('warns truthfully when no visible project tag was measured', async () => {
    vi.spyOn(api, 'fleetHealth').mockResolvedValue(
      health({ connected: true, downSince: null, projectPools: 'unavailable' }));
    render(<FleetHostBanner />);

    const banner = await screen.findByRole('status');
    expect(banner).toHaveTextContent(POOLS_UNAVAILABLE_COPY);
    expect(banner).not.toHaveTextContent(/tag shown here/i);
    // The banner is the whole reachable screen state in this component test:
    // no project row or pool tag exists for the copy to point at.
    expect(screen.queryByText(/pool ·/i)).not.toBeInTheDocument();
    // The remedy is a deploy on the other box, not a PWA action.
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });

  it('stays silent when pools are enforced, and when nobody could tell', async () => {
    for (const projectPools of ['enforced', 'unknown'] as const) {
      vi.spyOn(api, 'fleetHealth').mockResolvedValue(
        health({ connected: true, downSince: null, projectPools }));
      render(<FleetHostBanner />);
      await act(async () => {});
      expect(screen.queryByText(/project pools/i), projectPools).not.toBeInTheDocument();
      cleanup();
    }
  });

  it('stays silent when an older remote server omits the optional pools answer', async () => {
    const older = health({ connected: true, downSince: null });
    delete older.projectPools;
    vi.spyOn(api, 'fleetHealth').mockResolvedValue(older);
    render(<FleetHostBanner />);
    await act(async () => {});
    expect(screen.queryByText(/project pools/i)).not.toBeInTheDocument();
  });

  it('stays silent for a local host whose own ccd lacks pool support', async () => {
    vi.spyOn(api, 'fleetHealth').mockResolvedValue(
      health({ mode: 'local', connected: true, downSince: null, projectPools: 'unavailable' }));
    render(<FleetHostBanner />);
    await act(async () => {});
    expect(screen.queryByText(/project pools/i)).not.toBeInTheDocument();
  });

  it('a divergent roster outranks it — one is silent damage, the other is a feature not yet arrived', async () => {
    vi.spyOn(api, 'fleetHealth').mockResolvedValue(
      health({ connected: true, downSince: null, roster: 'divergent', projectPools: 'unavailable' }));
    render(<FleetHostBanner />);
    expect(await screen.findByText(/different account rosters/i)).toBeInTheDocument();
    expect(screen.queryByText(/project pools/i)).not.toBeInTheDocument();
  });

  it('an unreachable host outranks it too — nothing can be redeployed until the box is back', async () => {
    vi.spyOn(api, 'fleetHealth').mockResolvedValue(health({ projectPools: 'unavailable' }));
    render(<FleetHostBanner />);
    expect(await screen.findByText(/unreachable/i)).toBeInTheDocument();
    expect(screen.queryByText(/project pools/i)).not.toBeInTheDocument();
  });

  it('Reboot opens a confirm naming the whole-box collateral, and only calls the API on confirm', async () => {
    vi.spyOn(api, 'fleetHealth').mockResolvedValue(health());
    const reboot = vi.spyOn(api, 'rebootFleet').mockResolvedValue(undefined);
    render(<FleetHostBanner />);
    await screen.findByRole('button', { name: 'Reboot' });

    fireEvent.click(screen.getByRole('button', { name: 'Reboot' }));
    expect(
      screen.getByText(/Reboots the whole fleet box — everything else running on it goes down too/),
    ).toBeInTheDocument();
    expect(reboot).not.toHaveBeenCalled();

    // Cancel path does not reboot.
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(reboot).not.toHaveBeenCalled();

    // Confirm path fires the reboot.
    fireEvent.click(screen.getByRole('button', { name: 'Reboot' }));
    fireEvent.click(screen.getByRole('button', { name: 'Reboot the fleet host' }));
    expect(reboot).toHaveBeenCalledTimes(1);
  });

  it('warns when the boxes run DIFFERENT builds, naming both nodes\' versions from the inventory and the verb (spec §6, §14)', () => {
    render(<FleetHostBanner
      health={health({ connected: true, downSince: null, roster: 'agreed', build: 'skewed', builds: DECOY_BUILDS })}
      nodes={[inventoryNode('fleet', FLEET_V7), inventoryNode('server', SERVER_V9)]} />);
    expect(screen.getByText(/run different builds/i)).toBeInTheDocument();
    expect(screen.getByText(/fleet v0\.0\.7 \(bd2bf57a\)/)).toBeInTheDocument();
    expect(screen.getByText(/server v0\.0\.9 \(2985b9d1\)/)).toBeInTheDocument();
    expect(screen.queryByText(/v9\.9\.9/)).not.toBeInTheDocument();
    expect(screen.getByText(/ccrc rollout/)).toBeInTheDocument();
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });

  it('an unreachable skewed side does not name its cached version either — routed through statedOf (fix round 2, item 6)', () => {
    // Fix round 1 (D-3316) taught BuildLine this; the skew arm had its own,
    // separate `name()` reader that never learned it. Both now call the same
    // `statedOf` (shared/update-summary.ts) rather than each deciding for
    // itself.
    render(<FleetHostBanner health={health({ connected: true, downSince: null, build: 'skewed' })}
      nodes={[{ ...inventoryNode('fleet', FLEET_V7), reachable: false, unreachableSince: 1_000 }, inventoryNode('server', SERVER_V9)]} />);
    expect(screen.getByText(/fleet — · server v0\.0\.9 \(2985b9d1\)\./)).toBeInTheDocument();
    expect(screen.queryByText(/v0\.0\.7/)).not.toBeInTheDocument();
  });

  it('a skewed side with no version reads as unversioned (a deploy.sh stamp)', () => {
    const { version: _v, ...unversioned } = FLEET_V7;
    void _v;
    render(<FleetHostBanner health={health({ connected: true, downSince: null, build: 'skewed' })}
      nodes={[inventoryNode('fleet', unversioned), inventoryNode('server', SERVER_V9)]} />);
    expect(screen.getByText(/fleet unversioned \(bd2bf57a\)/)).toBeInTheDocument();
  });

  it('skewed with no inventory answer still warns, without versions — never from the health route\'s pair', () => {
    // `nodes` absent (the standalone shape) and `nodes: null` (FleetScreen
    // before /api/updates answers) both omit the clause; the decoy pair on the
    // health answer is NOT a fallback — reading it would be the old reader.
    const skewed = health({ connected: true, downSince: null, build: 'skewed', builds: DECOY_BUILDS });
    const { rerender } = render(<FleetHostBanner health={skewed} />);
    expect(screen.getByText(/run different builds/i)).toBeInTheDocument();
    expect(screen.queryByText(/v9\.9\.9/)).not.toBeInTheDocument();
    expect(screen.queryByText(/fleet —/)).not.toBeInTheDocument();
    rerender(<FleetHostBanner health={skewed} nodes={null} />);
    expect(screen.getByText(/run different builds/i)).toBeInTheDocument();
    expect(screen.queryByText(/v9\.9\.9/)).not.toBeInTheDocument();
  });

  it('the trigger is still the server\'s agreement word — disagreeing rows under an agreed health are silent', () => {
    // D-3312: the arm fires on `health.build`
    // (buildAgreement over sha + dirty, server-side). The PWA does not
    // recompute it from the rows — a second copy of the agreement rule.
    render(<FleetHostBanner health={health({ connected: true, downSince: null, build: 'agreed' })}
      nodes={[inventoryNode('fleet', FLEET_V7), inventoryNode('server', SERVER_V9)]} />);
    expect(screen.queryByText(/run different builds/i)).not.toBeInTheDocument();
  });

  it('names no fleet version off a server row recorded as both — on a remote fleet that row is this box', () => {
    // D-3313 — the same helper BuildLine reads.
    render(<FleetHostBanner health={health({ connected: true, downSince: null, build: 'skewed' })}
      nodes={[inventoryNode('both', SERVER_V9)]} />);
    expect(screen.getByText(/fleet — · server v0\.0\.9 \(2985b9d1\)\./)).toBeInTheDocument();
  });

  it('takes an injected health and does not poll — FleetScreen polls once for two readers', async () => {
    const spy = vi.spyOn(api, 'fleetHealth');
    render(<FleetHostBanner health={health({ connected: true, downSince: null, roster: 'divergent' })} />);
    expect(await screen.findByText(/different account rosters/i)).toBeInTheDocument();
    expect(spy).not.toHaveBeenCalled();
  });
});

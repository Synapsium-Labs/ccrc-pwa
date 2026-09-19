// FleetHostBanner — degraded-mode banner: hidden while the fleet is local or
// the remote host is reachable; when unreachable it names how long and offers
// a Reboot action gated behind a QuickConfirm whose copy names the collateral.
// The copy states the property EVERY fleet host has — a reboot takes the whole
// box down — rather than naming one fleet's co-tenant services, which on any
// other box was a false claim about the reader's machine.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { FleetHealth } from '../../shared/api';
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

  it('warns when the boxes run DIFFERENT builds, naming both versions and the verb (spec §6)', async () => {
    vi.spyOn(api, 'fleetHealth').mockResolvedValue(health({
      connected: true, downSince: null, roster: 'agreed', build: 'skewed',
      builds: {
        fleet: { sha: 'bd2bf57a8733883085b3c118911fc983dc441299', ref: 'release', builtAt: '2026-09-18T00:00:00Z', dirty: false, version: 'v0.0.7' },
        own: { sha: '2985b9d1000000000000000000000000000000000', ref: 'release', builtAt: '2026-09-18T00:00:00Z', dirty: false, version: 'v0.0.9' },
      },
    }));
    render(<FleetHostBanner />);
    expect(await screen.findByText(/run different builds/i)).toBeInTheDocument();
    expect(screen.getByText(/fleet v0\.0\.7 \(bd2bf57a\)/)).toBeInTheDocument();
    expect(screen.getByText(/server v0\.0\.9 \(2985b9d1\)/)).toBeInTheDocument();
    expect(screen.getByText(/ccrc rollout/)).toBeInTheDocument();
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });

  it('a skewed side with no version reads as unversioned (a deploy.sh stamp)', async () => {
    vi.spyOn(api, 'fleetHealth').mockResolvedValue(health({
      connected: true, downSince: null, build: 'skewed',
      builds: {
        fleet: { sha: 'bd2bf57a8733883085b3c118911fc983dc441299', ref: 'HEAD', builtAt: '2026-09-17T17:16:09Z', dirty: false },
        own: { sha: '2985b9d1000000000000000000000000000000000', ref: 'release', builtAt: '2026-09-18T00:00:00Z', dirty: false, version: 'v0.0.9' },
      },
    }));
    render(<FleetHostBanner />);
    expect(await screen.findByText(/fleet unversioned \(bd2bf57a\)/)).toBeInTheDocument();
  });

  it('skewed from an OLDER server (no builds field) still warns, without versions', async () => {
    vi.spyOn(api, 'fleetHealth').mockResolvedValue(health({ connected: true, downSince: null, build: 'skewed' }));
    render(<FleetHostBanner />);
    expect(await screen.findByText(/run different builds/i)).toBeInTheDocument();
  });

  it('takes an injected health and does not poll — FleetScreen polls once for two readers', async () => {
    const spy = vi.spyOn(api, 'fleetHealth');
    render(<FleetHostBanner health={health({ connected: true, downSince: null, roster: 'divergent' })} />);
    expect(await screen.findByText(/different account rosters/i)).toBeInTheDocument();
    expect(spy).not.toHaveBeenCalled();
  });
});

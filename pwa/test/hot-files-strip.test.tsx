import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ClaimSummary } from '../../shared/api';
import { HotFilesStrip } from '../src/fleet/HotFilesStrip';
import { api } from '../src/lib/api';
import { ICONS } from '../../ui/src/icons/lucide';

afterEach(() => { cleanup(); vi.restoreAllMocks(); });

const T0 = Date.now();

const claim = (over: Partial<ClaimSummary> = {}): ClaimSummary => ({
  id: 1, project: 'ccrc-pwa', paths: ['shared/api.ts'], heldBy: 'ccrc-pwa-clear-cove',
  heldByUuid: null, intent: 'wave 2: the L0 vocabulary slice', runId: 3, state: 'live',
  createdAt: T0 - 5 * 60_000, renewedAt: T0 - 5 * 60_000,
  expiresAt: T0 + 40 * 60_000, hardExpiresAt: T0 + 8 * 3_600_000,
  endedAt: null, endedBy: null, ...over,
});

const stub = (claims: ClaimSummary[]) =>
  vi.spyOn(api, 'claims').mockResolvedValue({ claims });

describe('HotFilesStrip', () => {
  it('renders NOTHING when no claim is live — a fleet not running a program pays no row', async () => {
    const spy = stub([]);
    const { container } = render(<HotFilesStrip />);
    await waitFor(() => expect(spy).toHaveBeenCalled());
    expect(container).toBeEmptyDOMElement();
  });

  it('collapses to a count and expands to holder, intent and paths', async () => {
    stub([claim(), claim({ id: 2, paths: ['ccd/ccd'], intent: '', heldBy: 'ccrc-pwa-still-water' })]);
    render(<HotFilesStrip />);
    await waitFor(() => expect(screen.getByText('2 files claimed')).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { expanded: false }));
    expect(screen.getByText('ccrc-pwa-clear-cove')).toBeInTheDocument();
    // Intent is free text off the wire — rendered VERBATIM, parsed nowhere.
    expect(screen.getByText('wave 2: the L0 vocabulary slice')).toBeInTheDocument();
    expect(screen.getByText('ccrc-pwa/shared/api.ts')).toBeInTheDocument();
    // Two live rows, two expiry spans — the *AllBy* variant, asserting the
    // expiry renders at all (each row carries its own).
    expect(screen.getAllByText(/expires in/).length).toBeGreaterThan(0);
  });

  it('names the strip "Claimed files" and counts files, not claims (T3a, D-6331)', async () => {
    // One claim holding two paths is two files claimed; the same path held under another project is a different file.
    stub([claim({ paths: ['shared/api.ts', 'ccd/ccd'] })]);
    render(<HotFilesStrip />);
    await waitFor(() => expect(screen.getByText('2 files claimed')).toBeInTheDocument());
    // The strip's name is its region's accessible name (`CollapsibleStrip`'s `label`), not visible text.
    expect(screen.getByRole('region', { name: 'Claimed files' })).toBeInTheDocument();
    expect(screen.queryByLabelText(/hot/i)).not.toBeInTheDocument();
  });

  it('counts a file claimed twice once, and the same path of another project separately', async () => {
    stub([
      claim({ id: 1, paths: ['shared/api.ts'] }),
      claim({ id: 2, paths: ['shared/api.ts', 'ccd/ccd'] }),
      claim({ id: 3, project: 'project-b', paths: ['shared/api.ts'] }),
    ]);
    render(<HotFilesStrip />);
    await waitFor(() => expect(screen.getByText('3 files claimed')).toBeInTheDocument());
  });

  it('marks the strip with Icon hand, never the ✋ emoji (D-5100)', async () => {
    stub([claim()]);
    const { container } = render(<HotFilesStrip />);
    await waitFor(() => expect(screen.getByText('1 file claimed')).toBeInTheDocument());
    const mark = container.querySelector('.hotfiles-mark')!;
    expect(mark.textContent).toBe('');
    expect([...mark.querySelectorAll('svg path')].map((p) => p.getAttribute('d'))).toEqual(ICONS.hand.map(([, a]) => a.d));
  });

  it('shows only LIVE claims — a lapsed row and a future state token both stay off the fleet screen', async () => {
    stub([
      claim(),
      claim({ id: 2, state: 'lapsed', endedAt: T0 - 60_000, endedBy: 'session-gone' }),
      // A state a newer server mints: not live, therefore not rendered —
      // and, load-bearing: not a crash either.
      claim({ id: 3, state: 'quarantined' as ClaimSummary['state'] }),
    ]);
    render(<HotFilesStrip />);
    await waitFor(() => expect(screen.getByText('1 file claimed')).toBeInTheDocument());
  });

  it('offers no way to release or break a claim — claims are advisory and this strip is read-only (D12)', async () => {
    stub([claim()]);
    render(<HotFilesStrip />);
    await waitFor(() => expect(screen.getByText('1 file claimed')).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { expanded: false }));
    for (const b of screen.getAllByRole('button')) {
      expect(b.getAttribute('aria-label') ?? b.textContent ?? '').not.toMatch(/release|break/i);
    }
  });
});

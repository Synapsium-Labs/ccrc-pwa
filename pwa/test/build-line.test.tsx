// BuildLine — the always-visible one-liner at the foot of FleetScreen
// (spec §6): which version each box runs, amber for unversioned/dirty,
// a dash for unknown, nothing at all when the server is older than the
// field or the fleet is local.
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import type { FleetHealth } from '../../shared/api';
import { BuildLine } from '../src/fleet/BuildLine';

afterEach(cleanup);

const stamp = (sha: string, version?: string, dirty = false) =>
  ({ sha, ref: 'release', builtAt: '2026-09-18T00:00:00Z', dirty, ...(version ? { version } : {}) });
const remote = (over: Partial<FleetHealth>): FleetHealth =>
  ({ mode: 'remote', connected: true, downSince: null, ...over });

describe('BuildLine', () => {
  it('renders both versions when both stamps carry one', () => {
    render(<BuildLine health={remote({ build: 'agreed', builds: { fleet: stamp('bd2bf57a' + '0'.repeat(32), 'v0.0.7'), own: stamp('bd2bf57a' + '0'.repeat(32), 'v0.0.7') } })} />);
    expect(screen.getByRole('status')).toHaveTextContent('fleet v0.0.7 · server v0.0.7');
    expect(screen.queryByText(/unversioned/)).not.toBeInTheDocument();
  });

  it('renders an unversioned side amber with its short sha, and a dirty side amber', () => {
    render(<BuildLine health={remote({ build: 'skewed', builds: { fleet: stamp('bd2bf57a' + '0'.repeat(32)), own: stamp('2985b9d1' + '0'.repeat(32), 'v0.0.9', true) } })} />);
    expect(screen.getByText('fleet unversioned (bd2bf57a)')).toHaveClass('build-line-side--warn');
    expect(screen.getByText('server v0.0.9 dirty')).toHaveClass('build-line-side--warn');
  });

  it('renders a dash for a side with no stamp', () => {
    render(<BuildLine health={remote({ build: 'unknown', builds: { fleet: null, own: stamp('2985b9d1' + '0'.repeat(32), 'v0.0.9') } })} />);
    expect(screen.getByRole('status')).toHaveTextContent('fleet — · server v0.0.9');
  });

  it('renders nothing in local mode, for a null health, or when the server sends no builds', () => {
    const fullBuilds = { fleet: stamp('bd2bf57a' + '0'.repeat(32), 'v0.0.7'), own: stamp('2985b9d1' + '0'.repeat(32), 'v0.0.9') };
    const { rerender } = render(<BuildLine health={null} />);
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
    // Local mode with a FULL builds object present — only the mode clause
    // can be hiding the line here, not the `!builds` clause.
    rerender(<BuildLine health={{ mode: 'local', connected: true, downSince: null, build: 'agreed', builds: fullBuilds } as FleetHealth} />);
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
    // A server older than the `builds` field — remote, but no builds key at all.
    rerender(<BuildLine health={remote({ build: 'agreed' })} />);
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });
});

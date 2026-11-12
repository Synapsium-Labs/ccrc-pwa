// Settings › Updates › Nodes: the supervisor sweep's record on a node row (D-8386, residue R37 of the centralised-update
// programme). `GET /api/updates` carries `report.sweep`, `update.json`'s `sweep` key, only when the node's report held a
// word the server read; absent is NOT MEASURED, so the row says nothing rather than "ok" or "none down". The line's
// layout at 390, 1280 and 1920 in both skins is `browser/update-sweep-line.browser.test.ts`'s.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, screen, within } from '@testing-library/react';
import type { NodeReportWire, NodeWire } from '../../shared/api';
import { api } from '../src/lib/api';
import { navigate } from '../src/lib/router';
import { sweepLine } from '../src/screens/updates';
import { renderSettings } from './settingsHost';
import { node, updatesView } from './settingsViewFixture';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  navigate('/');
});

const report = (over: Partial<NodeReportWire> = {}): NodeReportWire =>
  ({ phase: 'done', target: 'v0.0.9', startedAt: 1_000, updatedAt: 2_000, detail: null, ...over });

describe('sweepLine (D-8386)', () => {
  it('names the sweep word the report carried', () => {
    expect(sweepLine(node({ report: report({ sweep: 'ok' }) }))).toBe('Supervisor sweep: ok');
    expect(sweepLine(node({ report: report({ sweep: 'down: 2: alpha-one beta-two' }) })))
      .toBe('Supervisor sweep: down: 2: alpha-one beta-two');
  });

  it('says nothing when the sweep was not measured: no report, no key, or a word this build cannot read', () => {
    expect(sweepLine(node())).toBeNull();
    expect(sweepLine(node({ report: report() }))).toBeNull();
    for (const bad of [0, false, '', 'maybe', 'down:', { ok: true }]) {
      expect(sweepLine(node({ report: { ...report(), sweep: bad } as unknown as NodeReportWire })), JSON.stringify(bad)).toBeNull();
    }
  });
});

describe('the Nodes card shows the sweep line on the row whose report carried one (D-8386)', () => {
  it('one row measured, one not: only the measured row has the line', async () => {
    const swept: NodeWire = node({ report: report({ sweep: 'down: 1: alpha-one' }) });
    const unswept: NodeWire = node({
      nodeId: '1f0e0d0c-0b0a-4908-8706-050403020100', role: 'server', label: 'server', agentOps: null, report: report(),
    });
    vi.spyOn(api, 'updates').mockResolvedValue(updatesView({ nodes: [swept, unswept] }));
    renderSettings('updates');
    const rows = await within(await screen.findByRole('list', { name: 'Nodes' })).findAllByRole('listitem');
    const byLabel = (label: string): HTMLElement => rows.find((r) => r.querySelector('.settings-node-label')?.textContent === label)!;
    expect(within(byLabel('fleet')).getByText('Supervisor sweep: down: 1: alpha-one')).toBeInTheDocument();
    expect(within(byLabel('server')).queryByText(/Supervisor sweep/)).toBeNull();
  });
});

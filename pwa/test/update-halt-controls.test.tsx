// While any node halts, the dispatcher refuses every move but the Ack (spec §10; `moveRefusal`'s first clause), so
// the release row's Install (`{all: true}`) and every node's Update wait, disabled, and say why with Update all's own
// reason line (`updateAllHaltedText`, reused verbatim, plus the settings spec §5.1 sentence naming the remedy). Since
// D-5505 it is ONE line on the page, first, drawn while any control it gates is on screen, in either list. Roll back is not gated (the residue names Install and Update). The Ack on a node's row keeps
// focus in that row when it disables (R26(a)), as the halt banner's does.
//
// It renders the exported `HaltLine`, `ReleaseList` and `NodeList` composed as the screen composes them (the one
// line from `haltLineText`, its id handed to both lists), so these cases stay off the screen's own poll.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useId } from 'react';
import type { ReactNode } from 'react';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { NodeWire, ReleaseWire } from '../../shared/api';
import type { BuildInfo } from '../../shared/buildinfo';
import { api } from '../src/lib/api';
import { ToastHost } from '@ccrc/ui';
import { updateAllHaltedText } from '../src/fleet/updateHalt';
import { HaltLine, NodeList, ReleaseList, haltLineText, releaseWindow } from '../src/screens/updates';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const T0 = 1_760_000_000_000;
const FLEET_ID = '0b6e1c62-7a4f-4d0e-9c1a-3f2d5e8a9b10';
const SERVER_ID = '5f3a9d21-2c8b-4e6f-a1d7-8b0c4e2f6a93';
const stamp = (version: string): BuildInfo => ({ sha: 'a'.repeat(40), ref: 'main', builtAt: '2026-09-23T12:00:00Z', dirty: false, version });
const node = (over: Partial<NodeWire> = {}): NodeWire => ({
  nodeId: FLEET_ID, role: 'fleet', label: 'fleet', os: 'linux',
  current: stamp('v0.0.9'), stampRead: 'ok', installState: 'complete', provenance: 'verified',
  caps: ['detach', 'update-gate'], agentOps: ['update'], highestVersion: 'v0.0.9', previousVersion: null,
  floorRead: 'measured', previousRead: 'absent',
  measuredAt: T0, reachable: true, unreachableSince: null,
  channel: 'stable', desiredTag: 'v0.0.10', resolveDetail: null,
  request: null, report: null,
  update: { state: 'idle', target: null, startedAt: null, detail: null },
  ...over,
});
const server = (over: Partial<NodeWire> = {}): NodeWire =>
  node({ nodeId: SERVER_ID, role: 'server', label: 'server', agentOps: null, ...over });
const failed = (detail = 'gate: unit not up'): Partial<NodeWire> =>
  ({ update: { state: 'failed', target: 'v0.0.10', startedAt: T0, detail } });
const release = (tag: string): ReleaseWire => ({
  tag, version: tag, channel: 'stable', publishedAt: T0, commitSha: 'c'.repeat(40),
  bundleListed: true, yanked: false, refused: [], notes: null,
});

const UPDATE_ALL_HALT = 'Update all waits: nothing moves until fleet is acknowledged — tap Ack on it in the halt banner.';
const ONE_HALT = `${UPDATE_ALL_HALT} Clear it with Ack on that node, under Nodes, after you have fixed what made it fail.`;

/** The Updates page's composition: the one halt line first, its id handed to both lists (SettingsScreen's own). */
function Page({ nodes, releases, onMove, onAcked }: {
  nodes: NodeWire[]; releases: ReleaseWire[]; onMove: () => void; onAcked: () => void;
}): ReactNode {
  const id = useId();
  const text = haltLineText(nodes, releaseWindow(releases, nodes, 'stable'));
  return (
    <>
      <ToastHost />
      {text !== null && <HaltLine id={id} text={text} />}
      <ReleaseList releases={releases} nodes={nodes} channel="stable" haltedBy={text !== null ? id : null} onMove={onMove} />
      <NodeList nodes={nodes} releases={releases} now={T0} catalogueLastOkAt={T0} haltedBy={text !== null ? id : null} onAcked={onAcked} onMove={onMove} />
    </>
  );
}
const renderPage = (nodes: NodeWire[], releases: ReleaseWire[]) => {
  const onMove = vi.fn();
  const onAcked = vi.fn();
  render(<Page nodes={nodes} releases={releases} onMove={onMove} onAcked={onAcked} />);
  return { onMove, onAcked };
};
const renderReleases = (nodes: NodeWire[], releases: ReleaseWire[] = [release('v0.0.10')]) => {
  const r = renderPage(nodes, releases);
  return { ...r, list: screen.getByRole('region', { name: 'Releases' }) };
};
const renderNodes = (nodes: NodeWire[], releases: ReleaseWire[] = [release('v0.0.10')]) => {
  const r = renderPage(nodes, releases);
  return { ...r, list: screen.getByRole('list', { name: 'Nodes' }) };
};
const rowOf = (list: HTMLElement, id: string): HTMLElement => list.querySelector(`li[data-node-id="${id}"]`) as HTMLElement;

describe('Settings while a node halts — Install and Update wait, with Update all\'s reason (wave 19, R24(a))', () => {
  it('the reason is updateAllHaltedText, verbatim, then the remedy on this screen (settings spec §5.1)', () => {
    expect(updateAllHaltedText([node()])).toBe(UPDATE_ALL_HALT);
    expect(ONE_HALT.startsWith(updateAllHaltedText([node()]))).toBe(true);
  });

  it('a halting row disables the release row\'s Install, described by the one reason line', () => {
    const { onMove, list } = renderReleases([node(failed()), server()]);
    const install = within(list).getByRole('button', { name: 'Install' });
    expect(install).toBeDisabled();
    expect(install).toHaveAccessibleDescription(ONE_HALT);
    expect(screen.getAllByText(ONE_HALT)).toHaveLength(1);
    fireEvent.click(install);
    expect(onMove, 'a disabled Install opens no sheet').not.toHaveBeenCalled();
  });

  it('a halting row disables every node\'s Update, each described by the one reason line', () => {
    const { onMove, list } = renderNodes([node(failed()), server()]);
    const updates = within(list).getAllByRole('button', { name: 'Update' });
    expect(updates).toHaveLength(2);
    for (const b of updates) {
      expect(b).toBeDisabled();
      expect(b).toHaveAccessibleDescription(ONE_HALT);
    }
    expect(screen.getAllByText(ONE_HALT)).toHaveLength(1);
    fireEvent.click(updates[1]!);
    expect(onMove).not.toHaveBeenCalled();
  });

  it('with no halt both stay enabled, undescribed, with no reason line, and open the sheet', () => {
    const r = renderReleases([node(), server()]);
    const install = within(r.list).getByRole('button', { name: 'Install' });
    expect(install).not.toBeDisabled();
    expect(install).not.toHaveAttribute('aria-describedby');
    fireEvent.click(install);
    expect(r.onMove).toHaveBeenCalledWith({ scope: 'fleet', direction: 'update', tag: 'v0.0.10' });
    cleanup();
    const n = renderNodes([node(), server()]);
    for (const b of within(n.list).getAllByRole('button', { name: 'Update' })) {
      expect(b).not.toBeDisabled();
      expect(b).not.toHaveAttribute('aria-describedby');
    }
    expect(screen.queryByText(ONE_HALT)).toBeNull();
  });

  it('a failed row whose detail is a provenance verdict does not halt (D-3378): both stay enabled', () => {
    const r = renderReleases([node(failed('provenance: unsigned bundle')), server()]);
    expect(within(r.list).getByRole('button', { name: 'Install' })).not.toBeDisabled();
    cleanup();
    const n = renderNodes([node(failed('provenance: unsigned bundle')), server()]);
    expect(within(n.list).getAllByRole('button', { name: 'Update' })[1]).not.toBeDisabled();
    expect(screen.queryByText(ONE_HALT)).toBeNull();
  });

  it('two halting rows name both, in inventory order', () => {
    renderReleases([node(failed()), server({ update: { state: 'reverted', target: 'v0.0.10', startedAt: T0, detail: null } })]);
    expect(screen.getByText(
      'Update all waits: nothing moves until fleet, server are acknowledged — tap Ack on each in the halt banner. '
      + 'Clear it with Ack on each of them, under Nodes, after you have fixed what made it fail.',
    )).toBeInTheDocument();
  });

  // The CONTROL proves the fixture is an offered rollback row; if it reds, fix the fixture
  // (rollbackBlockers' inputs), never the assertion.
  it('a halt with no Install and no pending Update on screen shows no reason line; Roll back stays enabled and undescribed (Reading 2)', () => {
    const older = [release('v0.0.8')];
    const none: Partial<NodeWire> = { desiredTag: null };   // no pending Update either: the line is one per page now
    const c = renderReleases([node(none), server(none)], older);
    expect(within(c.list).getByRole('button', { name: 'Roll back' }), 'CONTROL: an offered rollback row').not.toBeDisabled();
    cleanup();
    const { onMove, list } = renderReleases([node({ ...failed(), ...none }), server(none)], older);
    const back = within(list).getByRole('button', { name: 'Roll back' });
    expect(back).not.toBeDisabled();
    expect(back).not.toHaveAttribute('aria-describedby');
    expect(screen.queryByText(ONE_HALT), 'no Install on screen: nothing for the line to explain').toBeNull();
    fireEvent.click(back);
    expect(onMove).toHaveBeenCalledWith({ scope: 'fleet', direction: 'rollback', to: 'v0.0.8' });
  });

  // Added at measurement: T4-8 survived the case above (with no Install on screen the line is not shown, so no
  // button is gated by it). Both kinds of row on screen under a halt: only the Install waits.
  it('a halt with an Install and a Roll back row on screen disables only the Install (Reading 2)', () => {
    const { list } = renderReleases([node(failed()), server()], [release('v0.0.10'), release('v0.0.8')]);
    const install = within(list).getByRole('button', { name: 'Install' });
    const back = within(list).getByRole('button', { name: 'Roll back' });
    expect(install).toBeDisabled();
    expect(install).toHaveAccessibleDescription(ONE_HALT);
    expect(back).not.toBeDisabled();
    expect(back).not.toHaveAttribute('aria-describedby');
  });

  it('a node\'s Roll back stays enabled and undescribed while another node halts (Reading 2)', () => {
    const back = (list: HTMLElement) => within(rowOf(list, SERVER_ID)).getByRole('button', { name: 'Roll back' });
    // The catalogue must hold the previous tag, else rollbackTargetRefusal refuses the row (no-bundle).
    const catalogue = [release('v0.0.10'), release('v0.0.8')];
    const c = renderNodes([node(), server({ previousVersion: 'v0.0.8' })], catalogue);
    expect(back(c.list), 'CONTROL: the fixture offers a Roll back').not.toBeDisabled();
    cleanup();
    const { list } = renderNodes([node(failed()), server({ previousVersion: 'v0.0.8' })], catalogue);
    expect(back(list)).not.toBeDisabled();
    expect(back(list)).not.toHaveAttribute('aria-describedby');
  });

  it('a halt that gates no Update and no Install shows no reason line', () => {
    // No release newer than the fleet in the catalogue, so the window draws no Install either.
    const { list } = renderNodes([node({ ...failed(), desiredTag: null }), server({ desiredTag: null })], [release('v0.0.9')]);
    const updates = within(list).getAllByRole('button', { name: 'Update' });
    expect(updates, 'CONTROL: the rows still offer an Update control').toHaveLength(2);
    for (const b of updates) expect(b).toBeDisabled();
    expect(screen.queryByText(ONE_HALT)).toBeNull();
  });

  it('an Update with nothing pending is disabled but not described by the halt line', () => {
    const { list } = renderNodes([node(failed()), server({ desiredTag: null })]);
    const updates = within(list).getAllByRole('button', { name: 'Update' });
    expect(updates).toHaveLength(2);
    expect(screen.getAllByText(ONE_HALT), 'the pending row\'s Update gates the line: it shows once').toHaveLength(1);
    const pending = within(rowOf(list, FLEET_ID)).getByRole('button', { name: 'Update' });
    expect(pending).toBeDisabled();
    expect(pending).toHaveAccessibleDescription(ONE_HALT);
    const none = within(rowOf(list, SERVER_ID)).getByRole('button', { name: 'Update' });
    expect(none).toBeDisabled();
    expect(none).not.toHaveAttribute('aria-describedby');
  });
});

// Wave 19's claim-gated fold (R24(d), and R24(b)'s Settings half): the screen asks the L0 gate read and says the
// update plane's one stale sentence, rather than spelling either itself. Read from source: the screen's own suite is
// another run's to edit, and behaviour is pinned there already (its gated fixtures and T7_STALE).
describe('SettingsScreen asks the shared reads (wave 19, R24(d))', () => {
  const settingsSrc = readFileSync(path.join(import.meta.dirname, '..', 'src', 'screens', 'SettingsScreen.tsx'), 'utf8');
  it('autoGateMissing asks carriesUpdateGate, keeping its Array.isArray guard', () => {
    expect(settingsSrc).toContain('nodes.filter((n) => !(Array.isArray(n.caps) && carriesUpdateGate(n.caps)))');
    expect(settingsSrc).not.toMatch(/caps\.includes\(UPDATE_GATE_CAP\)/);
  });
  it('the stale line is UPDATES_STALE_TEXT, imported, not a copy', () => {
    expect(settingsSrc).toContain('{stale && <p className="settings-note">{UPDATES_STALE_TEXT}</p>}');
    expect(settingsSrc).not.toContain('The latest read failed — this is the last answer that landed.');
  });
});

describe('Settings\' Ack keeps focus in its row when it disables (wave 19, R26(a))', () => {
  it('a focused Ack that disables hands focus to its node row', async () => {
    vi.spyOn(api, 'ackUpdateNode').mockResolvedValue({ ok: true, node: node() });
    const { onAcked, list } = renderNodes([node(failed()), server()]);
    const row = rowOf(list, FLEET_ID);
    const ack = within(row).getByRole('button', { name: 'Ack' });
    ack.focus();
    fireEvent.click(ack);
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Ack' }));   // through AckConfirm (D-5507)
    expect(ack).toBeDisabled();
    expect(document.activeElement, 'in flight: the row holds focus, not the disabled button').toBe(row);
    expect(row).toHaveAttribute('tabindex', '-1');
    await waitFor(() => expect(onAcked).toHaveBeenCalledTimes(1));
  });

  it('CONTROL: an Ack tapped while focus is elsewhere leaves focus where it was', async () => {
    vi.spyOn(api, 'ackUpdateNode').mockResolvedValue({ ok: true, node: node() });
    const { onAcked, list } = renderNodes([node(failed()), server()]);
    const other = document.body.appendChild(document.createElement('button'));
    try {
      other.focus();
      fireEvent.click(within(rowOf(list, FLEET_ID)).getByRole('button', { name: 'Ack' }));
      fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Ack' }));   // through AckConfirm (D-5507)
      await waitFor(() => expect(onAcked).toHaveBeenCalledTimes(1));
      expect(document.activeElement).toBe(other);
    } finally {
      other.remove();
    }
  });
});

// Settings › Updates' cards (settings Task R2b2; spec §3.3, §5.1, §15 D7; D-5503): Fleet version, then Nodes, then
// Update policy, rendered from ONE ordered list (`UPDATES_CARDS`, §15.3 C5's insert point), and the halt line as the
// first line of Fleet version. Neutral fixtures: nodes labelled fleet and server, tags v0.1.n.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, screen, within } from '@testing-library/react';
import type { NodeWire, ReleaseWire } from '../../shared/api';
import { api } from '../src/lib/api';
import { navigate } from '../src/lib/router';
import { SETTINGS_CARDS } from '../src/fleet/settingsText';
import { UPDATES_CARDS } from '../src/screens/settings/UpdatesSection';
import { renderSettings } from './settingsHost';
import { node, updatesView } from './settingsViewFixture';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  navigate('/');
});

const T0 = Date.UTC(2026, 8, 23, 12, 0, 0);
const stamp = (version: string): NodeWire['current'] =>
  ({ sha: 'a'.repeat(40), ref: 'main', builtAt: '2026-09-23T12:00:00Z', dirty: false, version });
const release = (tag: string, i: number): ReleaseWire => ({
  tag, version: tag, channel: 'stable', publishedAt: T0 + i * 86_400_000, commitSha: 'c'.repeat(40),
  bundleListed: true, yanked: false, refused: [], notes: null,
});
const releases = Array.from({ length: 6 }, (_, i) => release(`v0.1.${i + 1}`, i));
const fleetAt = (v: string, over: Partial<NodeWire> = {}): NodeWire[] => [
  node({ current: stamp(v), highestVersion: v, caps: ['verify', 'node-id', 'floor', 'update-gate'], ...over }),
  node({
    nodeId: '1f0e0d0c-0b0a-4908-8706-050403020100', role: 'server', label: 'server', agentOps: null,
    current: stamp(v), highestVersion: v, caps: ['verify', 'node-id', 'floor', 'update-gate'], ...over,
  }),
];

/** The page's cards, by their h3, in document order. */
const cardTitles = (): string[] => screen.getAllByRole('heading', { level: 3 }).map((h) => h.textContent ?? '');
const card = (title: string): HTMLElement => screen.getByRole('region', { name: title });

describe('Updates: the cards, in order and from one list (D-5503)', () => {
  it('the cards are Fleet version, Nodes, Update policy, in that order, from one list', async () => {
    vi.spyOn(api, 'updates').mockResolvedValue(updatesView({ releases, nodes: fleetAt('v0.1.4') }));
    renderSettings('updates');
    await screen.findByRole('heading', { level: 3, name: 'Update policy' });
    expect(cardTitles()).toEqual(['Fleet version', 'Nodes', 'Update policy']);
    // The one list is what decides it: the rendered order is the list's, mapped through the word table.
    expect(cardTitles()).toEqual(UPDATES_CARDS.map((id) => SETTINGS_CARDS.updates[id].title));
    // Each card holds its own controls: the releases and Check now in Fleet version, the node rows in Nodes, Channel
    // and Auto-install in Update policy.
    expect(within(card('Fleet version')).getByRole('region', { name: 'Releases' })).toBeInTheDocument();
    expect(within(card('Fleet version')).getByRole('button', { name: 'Check now' })).toBeInTheDocument();
    expect(within(card('Nodes')).getByRole('list', { name: 'Nodes' })).toBeInTheDocument();
    expect(within(card('Update policy')).getByRole('group', { name: 'Channel' })).toBeInTheDocument();
    expect(within(card('Update policy')).getByRole('group', { name: 'Auto-install' })).toBeInTheDocument();
  });

  it('before the poll lands, only Fleet version shows, holding the skeleton', () => {
    vi.spyOn(api, 'updates').mockReturnValue(new Promise(() => {}));
    renderSettings('updates');
    expect(cardTitles()).toEqual(['Fleet version']);
    expect(within(card('Fleet version')).getByRole('status', { name: 'Loading' })).toBeInTheDocument();
  });

  it('the halt line is Fleet version\'s first line', async () => {
    const halted: Partial<NodeWire> = { update: { state: 'failed', target: 'v0.1.6', startedAt: T0, detail: 'gate: unit not up' } };
    const [fleetRow, serverRow] = fleetAt('v0.1.4', { desiredTag: 'v0.1.6' });
    vi.spyOn(api, 'updates').mockResolvedValue(updatesView({ releases, nodes: [{ ...fleetRow!, ...halted }, serverRow!] }));
    renderSettings('updates');
    const line = await screen.findByText(/^Update all waits:/);
    const body = card('Fleet version').lastElementChild!;   // the Section's card, after its head and purpose
    expect(body.firstElementChild, 'the halt line leads the card').toBe(line);
    // It still names every control it gates, in Nodes as well as in the release window.
    const gated = within(card('Nodes')).getAllByRole('button', { name: 'Update' });
    expect(gated.length).toBeGreaterThan(0);
    for (const b of gated) expect(b.getAttribute('aria-describedby')).toBe(line.id);
  });
});

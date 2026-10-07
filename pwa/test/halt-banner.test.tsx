// HaltBanner (centralised-update programme wave 14, R15(a)) — the home screen names each node that halts the fleet,
// its state, target and detail, and offers that node's Ack in place: the same gate (`canAck`) and the same route
// (`POST /api/updates/ack`, `api.ackUpdateNode`) the Settings row uses.
//
// Found by CLASS and TEXT, never by a bare getByRole('status'): several banners on the fleet screen are status
// regions too (update-banner.test.tsx says why).
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { NodeWire, ReleaseWire, UpdatesView } from '../../shared/api';
import { UPDATE_STATES } from '../../shared/api';
import { isHaltingUpdate } from '../../shared/update-move';
import { ApiError, api, updateErrorText } from '../src/lib/api';
import { ToastHost } from '../src/components/Toast';
import { HALT_LEAD_TEXT, HaltBanner } from '../src/fleet/HaltBanner';
import { ACK_UNREADABLE_TEXT, canAck, sendAck } from '../src/fleet/updateAck';
import * as settings from '../src/screens/SettingsScreen';
import { declValue, ruleIn } from './cssRule';

// canAck through a pass-through spy, so ONE case can drive the rendered gate (T4-1) while every other case runs the
// real function. SettingsScreen re-exports from the same module, so `settings.canAck === canAck` still holds.
vi.mock('../src/fleet/updateAck', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/fleet/updateAck')>();
  return { ...actual, canAck: vi.fn(actual.canAck) };
});

const SRC = path.join(import.meta.dirname, '..', 'src');
const haltCss = readFileSync(path.join(SRC, 'fleet', 'fleet.css'), 'utf8');
const primitivesCss = readFileSync(path.join(SRC, 'components', 'primitives.css'), 'utf8');
const bannerSrc = readFileSync(path.join(SRC, 'fleet', 'HaltBanner.tsx'), 'utf8');
const settingsSrc = readFileSync(path.join(SRC, 'screens', 'SettingsScreen.tsx'), 'utf8');

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const FLEET_ID = '0b6e1c62-7a4f-4d0e-9c1a-3f2d5e8a9b10';
const SERVER_ID = '5f3a9d21-2c8b-4e6f-a1d7-8b0c4e2f6a93';
const node = (over: Partial<NodeWire> = {}): NodeWire => ({
  nodeId: FLEET_ID, role: 'fleet', label: 'fleet', os: 'linux',
  current: null, stampRead: 'ok', installState: 'complete', provenance: 'verified',
  caps: ['detach', 'update-gate'], agentOps: ['update'], highestVersion: 'v0.0.78', previousVersion: null,
  measuredAt: 1, reachable: true, unreachableSince: null,
  channel: 'stable', desiredTag: 'v0.0.84', resolveDetail: null,
  request: null, report: null,
  update: { state: 'idle', target: null, startedAt: null, detail: null },
  ...over,
});
const failed = (over: Partial<NodeWire> = {}): NodeWire =>
  node({ update: { state: 'failed', target: 'v0.0.84', startedAt: 1, detail: 'gate: unit not up' }, ...over });
const server = (over: Partial<NodeWire> = {}): NodeWire =>
  node({ nodeId: SERVER_ID, role: 'server', label: 'server', agentOps: null, ...over });
const view = (nodes: NodeWire[], releases: ReleaseWire[] = []): UpdatesView => ({
  catalogue: { lastOkAt: 1, lastError: null }, releases, nodes, intent: [],
});
const banner = (): Element | null => document.querySelector('.halt-banner');
const mount = (v: UpdatesView | null) => {
  const onAcked = vi.fn();
  render(<><ToastHost /><HaltBanner updates={v} onAcked={onAcked} /></>);
  return { onAcked };
};

describe('HaltBanner — when it speaks', () => {
  it('is silent with no view, and with no halting node: idle, busy, and a failed provenance verdict', () => {
    mount(null);
    expect(banner()).toBeNull();
    cleanup();
    mount(view([node(), server({ update: { state: 'applying', target: 'v0.0.84', startedAt: 1, detail: null } })]));
    expect(banner()).toBeNull();
    cleanup();
    mount(view([failed({ update: { state: 'failed', target: 'v0.0.84', startedAt: 1, detail: 'provenance: unsigned bundle' } })]));
    expect(banner(), 'a verdict on the release does not halt (D-3378)').toBeNull();
  });

  it('names each halting node, its state, its target and its detail, one row each, with its own Ack', () => {
    mount(view([server({ update: { state: 'reverted', target: 'v0.0.84', startedAt: 1, detail: null } }), failed()]));
    expect(banner()!.getAttribute('role')).toBe('status');
    expect(within(banner() as HTMLElement).getByText(HALT_LEAD_TEXT)).toBeInTheDocument();
    const rows = within(screen.getByRole('list', { name: 'Halted nodes' })).getAllByRole('listitem');
    expect(rows.map((li) => li.querySelector('.halt-banner-node-text')?.textContent)).toEqual([
      'server: reverted (last tried v0.0.84)',
      'fleet: failed (last tried v0.0.84) — gate: unit not up',
    ]);
    expect(screen.getByRole('button', { name: 'Ack server' })).toHaveTextContent('Ack');
    expect(screen.getByRole('button', { name: 'Ack fleet' })).not.toBeDisabled();
  });
});

describe('HaltBanner — the Ack in place is the Settings Ack', () => {
  it('sends POST /api/updates/ack for that node once, then re-polls', async () => {
    const ack = vi.spyOn(api, 'ackUpdateNode').mockResolvedValue({ ok: true, node: node() });
    const { onAcked } = mount(view([server(), failed()]));
    fireEvent.click(screen.getByRole('button', { name: 'Ack fleet' }));
    expect(screen.getByRole('button', { name: 'Ack fleet' }), 'one tap while the answer is in flight').toBeDisabled();
    await waitFor(() => expect(onAcked).toHaveBeenCalledTimes(1));
    expect(ack.mock.calls).toEqual([[FLEET_ID]]);
    expect(document.querySelector('.toast'), 'a clean 200 says nothing').toBeNull();
  });

  it('an unreadable answer and a refusal are said as the Settings row says them, and re-poll either way', async () => {
    vi.spyOn(api, 'ackUpdateNode').mockResolvedValueOnce('unreadable');
    const first = mount(view([failed()]));
    fireEvent.click(screen.getByRole('button', { name: 'Ack fleet' }));
    expect(await screen.findByText(ACK_UNREADABLE_TEXT)).toBeInTheDocument();
    await waitFor(() => expect(first.onAcked).toHaveBeenCalledTimes(1));
    const held = screen.getByRole('button', { name: 'Acked fleet' });
    expect(held, 'an unreadable answer may have cleared the row: it stays down until a poll shows a new lease').toBeDisabled();
    expect(held).toHaveTextContent('Acked');
    cleanup();
    const busy = new ApiError(409, { ok: false, error: 'busy' });
    vi.spyOn(api, 'ackUpdateNode').mockRejectedValueOnce(busy).mockResolvedValue({ ok: true, node: node() });
    const second = mount(view([failed()]));
    fireEvent.click(screen.getByRole('button', { name: 'Ack fleet' }));
    expect(await screen.findByText(updateErrorText(busy))).toBeInTheDocument();
    await waitFor(() => expect(second.onAcked).toHaveBeenCalledTimes(1));
    expect(screen.getByRole('button', { name: 'Ack fleet' }), 'a refused ack re-arms the button').not.toBeDisabled();
    // ... and a second tap goes out: a refusal is an answer the server gave, so nothing is in doubt.
    fireEvent.click(screen.getByRole('button', { name: 'Ack fleet' }));
    await waitFor(() => expect(second.onAcked).toHaveBeenCalledTimes(2));
    expect(api.ackUpdateNode, 'the unreadable tap, the refused tap, and the tap after the re-arm').toHaveBeenCalledTimes(3);
  });

  it('after a clean 200 the row stays down until a poll shows a different lease — a second tap sends nothing', async () => {
    const ack = vi.spyOn(api, 'ackUpdateNode').mockResolvedValue({ ok: true, node: node() });
    const onAcked = vi.fn(); // the re-poll failed: the hook keeps the last good view, so the same lease stands
    const { rerender } = render(<><ToastHost /><HaltBanner updates={view([failed()])} onAcked={onAcked} /></>);
    fireEvent.click(screen.getByRole('button', { name: 'Ack fleet' }));
    await waitFor(() => expect(onAcked).toHaveBeenCalledTimes(1));
    const button = screen.getByRole('button', { name: 'Acked fleet' });
    expect(button).toBeDisabled();
    expect(button).toHaveTextContent('Acked');
    fireEvent.click(button);
    expect(ack).toHaveBeenCalledTimes(1);
    // A NEW failure on the same node is a new lease: the button re-arms.
    rerender(<><ToastHost /><HaltBanner updates={view([failed({ update: { state: 'failed', target: 'v0.0.85', startedAt: 2, detail: 'gate: unit not up' } })])} onAcked={onAcked} /></>);
    expect(screen.getByRole('button', { name: 'Ack fleet' })).not.toBeDisabled();
    expect(screen.getByRole('button', { name: 'Ack fleet' })).toHaveTextContent(/^Ack$/);
  });

  it('every row the halt rule names is one canAck lets through, over every state and a detail spread', () => {
    // isHaltingUpdate DERIVES its states from the settled list; canAck NAMES failed/reverted. This is what keeps a
    // settled state added later from halting the fleet with its Ack disabled.
    for (const state of UPDATE_STATES) {
      for (const detail of [null, '', 'x', 'gate: unit not up', 'provenance: unsigned bundle']) {
        const row = failed({ update: { state, target: 'v0.0.84', startedAt: 1, detail } as NodeWire['update'] });
        if (isHaltingUpdate(state, detail)) expect(canAck(row, []), `${state} / ${String(detail)}`).toBe(true);
      }
    }
  });

  it('the rendered gate IS canAck: a row it refuses renders its Ack disabled', () => {
    vi.mocked(canAck).mockReturnValue(false);
    try {
      mount(view([failed()]));
      expect(screen.getByRole('button', { name: 'Ack fleet' })).toBeDisabled();
    } finally {
      vi.mocked(canAck).mockReset();
    }
    expect(canAck(failed(), []), 'the spy passes through again').toBe(true);
  });

  it('Settings re-exports the same function and text, and holds no copy of either (D-4267)', () => {
    expect(settings.canAck).toBe(canAck);
    expect(settings.ACK_UNREADABLE_TEXT).toBe(ACK_UNREADABLE_TEXT);
    expect(settingsSrc).not.toMatch(/function canAck\b/);
    expect(settingsSrc).not.toMatch(/api\.ackUpdateNode\(/);
    expect(settingsSrc).toMatch(/void sendAck\(n\.nodeId\)/);
    expect(bannerSrc).toMatch(/import \{ canAck, sendAck \} from '\.\/updateAck';/);
    // The gate is canAck on every row, though a halting row passes it by construction: no behaviour can red for it.
    expect(bannerSrc).toContain('disabled={!canAck(n, releases) || acking || held}');
    expect(bannerSrc).toContain('void sendAck(n.nodeId).then(');
    expect(bannerSrc).not.toMatch(/SETTLED_UPDATE_STATES|ackUpdateNode/);
  });

  it('sendAck never rejects, so a caller\'s finally always re-polls; it answers how the Ack ended', async () => {
    render(<ToastHost />);
    vi.spyOn(api, 'ackUpdateNode').mockRejectedValueOnce(new Error('offline'));
    await act(async () => { await expect(sendAck(FLEET_ID)).resolves.toBe('unanswered'); });
    vi.spyOn(api, 'ackUpdateNode').mockRejectedValueOnce(new TypeError('Failed to fetch'));
    await act(async () => { await expect(sendAck(FLEET_ID)).resolves.toBe('unanswered'); });
    vi.spyOn(api, 'ackUpdateNode').mockRejectedValueOnce(new ApiError(502, { ok: false, error: 'bad gateway' }));
    await act(async () => { await expect(sendAck(FLEET_ID)).resolves.toBe('unanswered'); });
    vi.spyOn(api, 'ackUpdateNode').mockRejectedValueOnce(new ApiError(500, { ok: false, error: 'internal' }));
    await act(async () => { await expect(sendAck(FLEET_ID)).resolves.toBe('unanswered'); });
    vi.spyOn(api, 'ackUpdateNode').mockRejectedValueOnce(new ApiError(409, { ok: false, error: 'busy' }));
    await act(async () => { await expect(sendAck(FLEET_ID)).resolves.toBe('refused'); });
    vi.spyOn(api, 'ackUpdateNode').mockRejectedValueOnce(new ApiError(400, { ok: false, error: 'bad request' }));
    await act(async () => { await expect(sendAck(FLEET_ID)).resolves.toBe('refused'); });
    vi.spyOn(api, 'ackUpdateNode').mockResolvedValueOnce('unreadable');
    await act(async () => { await expect(sendAck(FLEET_ID)).resolves.toBe('unreadable'); });
    vi.spyOn(api, 'ackUpdateNode').mockResolvedValueOnce({ ok: true, node: node() });
    await act(async () => { await expect(sendAck(FLEET_ID)).resolves.toBe('acked'); });
  });
});

// Review 307 F1 (D-4272): the Ack re-arms at once only on an answer the server gave. A request with no answer may
// have committed, so the row holds until a FRESH successful read (a new view object; a failed read keeps the old one).
const leaseOf = (over: Partial<NonNullable<NodeWire['update']>> = {}): NodeWire =>
  failed({ update: { state: 'failed', target: 'v0.0.84', startedAt: 1, detail: 'gate: unit not up', ...over } });
const renderWith = (v: UpdatesView, onAcked: () => void) => {
  const ui = (x: UpdatesView) => <><ToastHost /><HaltBanner updates={x} onAcked={onAcked} /></>;
  const r = render(ui(v));
  return { rerender: (x: UpdatesView) => r.rerender(ui(x)) };
};
const NO_ANSWER: ReadonlyArray<readonly [string, () => unknown]> = [
  ['a fetch TypeError', () => new TypeError('Failed to fetch')],
  ['a proxy 502', () => new ApiError(502, { ok: false, error: 'bad gateway' })],
  ['a server 500', () => new ApiError(500, { ok: false, error: 'internal' })],
  ['a proxy 503', () => new ApiError(503, { ok: false, error: 'unavailable' })],
  ['a proxy 504', () => new ApiError(504, { ok: false, error: 'gateway timeout' })],
  ['a timeout rejection', () => new DOMException('The operation timed out.', 'TimeoutError')],
];

describe('HaltBanner — an Ack with no answer holds until a fresh read (D-4272)', () => {
  it.each(NO_ANSWER)('%s holds through a kept view: Ack, disabled, one POST, today\'s toast', async (_n, make) => {
    const err = make();
    const ack = vi.spyOn(api, 'ackUpdateNode').mockRejectedValueOnce(err);
    const onAcked = vi.fn();
    const v1 = view([failed()]);
    const { rerender } = renderWith(v1, onAcked);
    fireEvent.click(screen.getByRole('button', { name: 'Ack fleet' }));
    await waitFor(() => expect(onAcked).toHaveBeenCalledTimes(1));
    expect(await screen.findByText(updateErrorText(err))).toBeInTheDocument();
    rerender(v1); // the re-poll failed: the hook keeps the very same object
    const held = screen.getByRole('button', { name: 'Ack fleet' });
    expect(held).toBeDisabled();
    expect(held, 'no 2xx was seen: it does not say Acked').toHaveTextContent(/^Ack$/);
    fireEvent.click(held);
    expect(ack).toHaveBeenCalledTimes(1);
  });

  it('a fresh read with the same lease re-arms, and a tap sends a second POST', async () => {
    const ack = vi.spyOn(api, 'ackUpdateNode').mockRejectedValueOnce(new TypeError('Failed to fetch'));
    ack.mockResolvedValueOnce({ ok: true, node: node() });
    const onAcked = vi.fn();
    const v1 = view([failed()]);
    const { rerender } = renderWith(v1, onAcked);
    fireEvent.click(screen.getByRole('button', { name: 'Ack fleet' }));
    await waitFor(() => expect(onAcked).toHaveBeenCalledTimes(1));
    rerender(v1);
    expect(screen.getByRole('button', { name: 'Ack fleet' })).toBeDisabled();
    rerender(view([failed()])); // a NEW object: a successful read landed, and the lease did not change
    const again = screen.getByRole('button', { name: 'Ack fleet' });
    expect(again).not.toBeDisabled();
    expect(again).toHaveTextContent(/^Ack$/);
    fireEvent.click(again);
    await waitFor(() => expect(ack).toHaveBeenCalledTimes(2));
  });

  it('a fresh read with a new lease follows it: the button is armed for that lease', async () => {
    vi.spyOn(api, 'ackUpdateNode').mockRejectedValueOnce(new ApiError(504, { ok: false, error: 'gateway timeout' }));
    const onAcked = vi.fn();
    const v1 = view([failed()]);
    const { rerender } = renderWith(v1, onAcked);
    fireEvent.click(screen.getByRole('button', { name: 'Ack fleet' }));
    await waitFor(() => expect(onAcked).toHaveBeenCalledTimes(1));
    rerender(view([leaseOf({ startedAt: 2 })]));
    expect(screen.getByRole('button', { name: 'Ack fleet' })).not.toBeDisabled();
  });

  it('an unreadable answer holds through a kept view, and releases on a fresh read with the same lease', async () => {
    vi.spyOn(api, 'ackUpdateNode').mockResolvedValueOnce('unreadable');
    const onAcked = vi.fn();
    const v1 = view([failed()]);
    const { rerender } = renderWith(v1, onAcked);
    fireEvent.click(screen.getByRole('button', { name: 'Ack fleet' }));
    await waitFor(() => expect(onAcked).toHaveBeenCalledTimes(1));
    rerender(v1);
    expect(screen.getByRole('button', { name: 'Acked fleet' }), 'a 2xx was seen: it says Acked').toBeDisabled();
    rerender(view([failed()]));
    const again = screen.getByRole('button', { name: 'Ack fleet' });
    expect(again).not.toBeDisabled();
    expect(again).toHaveTextContent(/^Ack$/);
  });

  it('a read that lands WHILE the POST is in flight does not release: the snapshot is taken at the outcome', async () => {
    let reject!: (e: unknown) => void;
    const ack = vi.spyOn(api, 'ackUpdateNode').mockImplementationOnce(() => new Promise((_res, rej) => { reject = rej; }));
    const onAcked = vi.fn();
    const { rerender } = renderWith(view([failed()]), onAcked);
    fireEvent.click(screen.getByRole('button', { name: 'Ack fleet' }));
    const midFlight = view([failed()]); // a poll answered while the POST was out; it may predate the commit
    rerender(midFlight);
    await act(async () => { reject(new TypeError('Failed to fetch')); });
    await waitFor(() => expect(onAcked).toHaveBeenCalledTimes(1));
    rerender(midFlight);
    expect(screen.getByRole('button', { name: 'Ack fleet' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Ack fleet' }));
    expect(ack).toHaveBeenCalledTimes(1);
    rerender(view([failed()]));
    expect(screen.getByRole('button', { name: 'Ack fleet' })).not.toBeDisabled();
  });
});

describe('HaltBanner — the accessible name follows the visible label (review 307 F3)', () => {
  it('Ack fleet / Ack before the tap, Acked fleet / Acked after a clean 200', async () => {
    vi.spyOn(api, 'ackUpdateNode').mockResolvedValue({ ok: true, node: node() });
    const { onAcked } = mount(view([failed()]));
    const before = screen.getByRole('button', { name: 'Ack fleet' });
    expect(before).toHaveTextContent(/^Ack$/);
    fireEvent.click(before);
    await waitFor(() => expect(onAcked).toHaveBeenCalledTimes(1));
    const after = screen.getByRole('button', { name: 'Acked fleet' });
    expect(after).toHaveTextContent(/^Acked$/);
    expect(screen.queryByRole('button', { name: 'Ack fleet' })).toBeNull();
  });
});

describe('HaltBanner — each field of the lease key re-arms a held row (review 307 F2)', () => {
  const heldAfter200 = async () => {
    vi.spyOn(api, 'ackUpdateNode').mockResolvedValue({ ok: true, node: node() });
    const onAcked = vi.fn();
    const { rerender } = renderWith(view([failed()]), onAcked);
    fireEvent.click(screen.getByRole('button', { name: 'Ack fleet' }));
    await waitFor(() => expect(onAcked).toHaveBeenCalledTimes(1));
    expect(screen.getByRole('button', { name: 'Acked fleet' })).toBeDisabled();
    return rerender;
  };

  it('only startedAt changes (auto retried the same tag and failed alike): a new lease', async () => {
    const rerender = await heldAfter200();
    rerender(view([leaseOf({ startedAt: 2 })]));
    expect(screen.getByRole('button', { name: 'Ack fleet' })).not.toBeDisabled();
  });

  it('only target changes: a new lease', async () => {
    const rerender = await heldAfter200();
    rerender(view([leaseOf({ target: 'v0.0.85' })]));
    expect(screen.getByRole('button', { name: 'Ack fleet' })).not.toBeDisabled();
  });
});

describe('HaltBanner — a class of its own, a tap floor, and text only', () => {
  it('is self-grounded on the attention pair under its own class, and not sticky', () => {
    mount(view([failed()]));
    expect(banner()!.className).toBe('halt-banner');
    const rule = ruleIn(haltCss, '.halt-banner');
    expect(declValue(rule, 'background')).toBe('var(--status-attention-tint)');
    expect(declValue(rule, 'color')).toBe('var(--status-attention-text)');
    expect(declValue(rule, 'position')).toBeNull();
  });

  it('keeps the shared button at the tap floor: the banner override resizes its width, never its height', () => {
    expect(declValue(ruleIn(primitivesCss, '.btn-primary'), 'min-height')).toBe('var(--tap-min)');
    const rule = ruleIn(haltCss, '.halt-banner-node .btn-primary');
    expect(declValue(rule, 'width')).toBe('auto');
    expect(declValue(rule, 'min-height')).toBeNull();
    expect(declValue(rule, 'height')).toBeNull();
  });

  it('no rule but the banner\'s own sets a colour, so every child inherits the measured pair', () => {
    const colourRules = [...haltCss.replace(/\/\*[\s\S]*?\*\//g, '').matchAll(/([^{}]+)\{([^}]*)\}/g)]
      .filter((m) => /halt-banner/.test(m[1]!) && /(^|;|\s)(color|background(-color)?)\s*:/.test(m[2]!)).map((m) => m[1]!.trim());
    expect(colourRules).toEqual(['.halt-banner']);
  });

  it('puts wire text into the DOM only as text children', () => {
    expect(bannerSrc).not.toMatch(/dangerouslySetInnerHTML/);
  });
});

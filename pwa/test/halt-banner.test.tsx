// HaltBanner (centralised-update programme wave 14, R15(a)) — the home screen names each node that halts the fleet,
// its state, target and detail, and offers that node's Ack in place: the same gate (`canAck`) and the same route
// (`POST /api/updates/ack`, `api.ackUpdateNode`) the Settings row uses.
//
// Found by CLASS and TEXT, never by a bare getByRole('status'): several banners on the fleet screen are status
// regions too (update-banner.test.tsx says why).
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { NodeWire, ReleaseWire, UpdatesView } from '../../shared/api';
import { UPDATE_STATES } from '../../shared/api';
import { isHaltingUpdate } from '../../shared/update-move';
import { ApiError, api, updateErrorText } from '../src/lib/api';
import { buttonVariants, ToastHost } from '@ccrc/ui';
import { HALT_LEAD_TEXT, HaltBanner } from '../src/fleet/HaltBanner';
import { useUpdatesView } from '../src/fleet/useUpdatesView';
import { ACK_UNREADABLE_TEXT, canAck, sendAck } from '../src/fleet/updateAck';
import * as updates from '../src/screens/updates';
import { declValue, ruleIn } from './cssRule';

// canAck through a pass-through spy, so ONE case can drive the rendered gate (T4-1) while every other case runs the
// real function. `screens/updates.tsx` re-exports from the same module, so
// `updates.canAck === canAck` still holds — the assertion is about the
// IDENTITY, not about which file carries the re-export (it moved out of
// SettingsScreen with `NodeItem`, its consumer).
vi.mock('../src/fleet/updateAck', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/fleet/updateAck')>();
  return { ...actual, canAck: vi.fn(actual.canAck) };
});

const SRC = path.join(import.meta.dirname, '..', 'src');
const haltCss = readFileSync(path.join(SRC, 'fleet', 'fleet.css'), 'utf8');
const bannerSrc = readFileSync(path.join(SRC, 'fleet', 'HaltBanner.tsx'), 'utf8');
// `screens/updates.tsx`, not SettingsScreen: the node inventory — and so
// `NodeItem`, the Ack's one caller — moved to a file of its own when
// SettingsScreen was split. D-4267's claim is unchanged (Settings holds no
// COPY of canAck/ackUpdateNode and calls the shared `sendAck`); what moved is
// which file carries it, so both files are read and the claim is made of the
// pair.
const settingsSrc = readFileSync(path.join(SRC, 'screens', 'SettingsScreen.tsx'), 'utf8')
  + readFileSync(path.join(SRC, 'screens', 'updates.tsx'), 'utf8');

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
// `onAcked` answers the issue number of the read it issued (D-4273): the poll's `seq` was 1 when the screen mounted, so
// the re-poll the Ack triggers is number 2.
const mount = (v: UpdatesView | null, seq = 1) => {
  const onAcked = vi.fn(() => 2);
  render(<><ToastHost /><HaltBanner updates={v} seq={seq} onAcked={onAcked} /></>);
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
    expect(held, 'an unreadable answer may have cleared the row: it stays down until a read issued after it lands').toBeDisabled();
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
    const onAcked = vi.fn(() => 2); // the re-poll failed: the hook keeps the last good view, so the same lease stands
    const { rerender } = render(<><ToastHost /><HaltBanner updates={view([failed()])} seq={1} onAcked={onAcked} /></>);
    fireEvent.click(screen.getByRole('button', { name: 'Ack fleet' }));
    await waitFor(() => expect(onAcked).toHaveBeenCalledTimes(1));
    const button = screen.getByRole('button', { name: 'Acked fleet' });
    expect(button).toBeDisabled();
    expect(button).toHaveTextContent('Acked');
    fireEvent.click(button);
    expect(ack).toHaveBeenCalledTimes(1);
    // A NEW failure on the same node is a new lease: the button re-arms.
    rerender(<><ToastHost /><HaltBanner updates={view([failed({ update: { state: 'failed', target: 'v0.0.85', startedAt: 2, detail: 'gate: unit not up' } })])} seq={2} onAcked={onAcked} /></>);
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
    expect(updates.canAck).toBe(canAck);
    expect(updates.ACK_UNREADABLE_TEXT).toBe(ACK_UNREADABLE_TEXT);
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

// Review 307 F1 and review 311 F1/F2 (D-4272, D-4273): the Ack re-arms at once only on an answer the server gave. A
// request with no answer may have committed, so the row holds until a successful read the screen ISSUED after the
// outcome. The poll carries the issue number of the read that set its view (`seq`), and `onAcked()` answers the number
// of the re-poll it issued inside the outcome callback: the hold ends when `seq >= that number`. A failed read keeps
// the old seq, so it changes nothing.
const leaseOf = (over: Partial<NonNullable<NodeWire['update']>> = {}): NodeWire =>
  failed({ update: { state: 'failed', target: 'v0.0.84', startedAt: 1, detail: 'gate: unit not up', ...over } });
const renderWith = (v: UpdatesView, onAcked: () => number, seq = 1) => {
  const ui = (x: UpdatesView, s: number) => <><ToastHost /><HaltBanner updates={x} seq={s} onAcked={onAcked} /></>;
  const r = render(ui(v, seq));
  return { rerender: (x: UpdatesView, s: number) => r.rerender(ui(x, s)) };
};
const NO_ANSWER: ReadonlyArray<readonly [string, () => unknown]> = [
  ['a fetch TypeError', () => new TypeError('Failed to fetch')],
  ['a proxy 502', () => new ApiError(502, { ok: false, error: 'bad gateway' })],
  ['a server 500', () => new ApiError(500, { ok: false, error: 'internal' })],
  ['a proxy 503', () => new ApiError(503, { ok: false, error: 'unavailable' })],
  ['a proxy 504', () => new ApiError(504, { ok: false, error: 'gateway timeout' })],
  ['a timeout rejection', () => new DOMException('The operation timed out.', 'TimeoutError')],
];

describe('HaltBanner — an Ack with no answer holds until a read issued after the outcome (D-4272, D-4273)', () => {
  it.each(NO_ANSWER)('%s holds through a kept view and seq: Ack, disabled, one POST, today\'s toast', async (_n, make) => {
    const err = make();
    const ack = vi.spyOn(api, 'ackUpdateNode').mockRejectedValueOnce(err);
    const onAcked = vi.fn(() => 2);
    const v1 = view([failed()]);
    const { rerender } = renderWith(v1, onAcked);
    fireEvent.click(screen.getByRole('button', { name: 'Ack fleet' }));
    await waitFor(() => expect(onAcked).toHaveBeenCalledTimes(1));
    expect(await screen.findByText(updateErrorText(err))).toBeInTheDocument();
    rerender(v1, 1); // the re-poll failed: the hook keeps the very same view and the very same seq
    const held = screen.getByRole('button', { name: 'Ack fleet' });
    expect(held).toBeDisabled();
    expect(held, 'no 2xx was seen: it does not say Acked').toHaveTextContent(/^Ack$/);
    fireEvent.click(held);
    expect(ack).toHaveBeenCalledTimes(1);
  });

  it('a read issued after the outcome with the same lease re-arms, and a tap sends a second POST', async () => {
    const ack = vi.spyOn(api, 'ackUpdateNode').mockRejectedValueOnce(new TypeError('Failed to fetch'));
    ack.mockResolvedValueOnce({ ok: true, node: node() });
    const onAcked = vi.fn(() => 2);
    const v1 = view([failed()]);
    const { rerender } = renderWith(v1, onAcked);
    fireEvent.click(screen.getByRole('button', { name: 'Ack fleet' }));
    await waitFor(() => expect(onAcked).toHaveBeenCalledTimes(1));
    rerender(v1, 1);
    expect(screen.getByRole('button', { name: 'Ack fleet' })).toBeDisabled();
    rerender(view([failed()]), 2); // read number 2 landed: it was issued after the outcome, and the lease did not change
    const again = screen.getByRole('button', { name: 'Ack fleet' });
    expect(again).not.toBeDisabled();
    expect(again).toHaveTextContent(/^Ack$/);
    fireEvent.click(again);
    await waitFor(() => expect(ack).toHaveBeenCalledTimes(2));
  });

  it('a read issued after the outcome with a new lease follows it: the button is armed for that lease', async () => {
    vi.spyOn(api, 'ackUpdateNode').mockRejectedValueOnce(new ApiError(504, { ok: false, error: 'gateway timeout' }));
    const onAcked = vi.fn(() => 2);
    const v1 = view([failed()]);
    const { rerender } = renderWith(v1, onAcked);
    fireEvent.click(screen.getByRole('button', { name: 'Ack fleet' }));
    await waitFor(() => expect(onAcked).toHaveBeenCalledTimes(1));
    rerender(view([leaseOf({ startedAt: 2 })]), 2);
    expect(screen.getByRole('button', { name: 'Ack fleet' })).not.toBeDisabled();
  });

  it('an unreadable answer holds through a kept view, and releases on a read issued after it with the same lease', async () => {
    vi.spyOn(api, 'ackUpdateNode').mockResolvedValueOnce('unreadable');
    const onAcked = vi.fn(() => 2);
    const v1 = view([failed()]);
    const { rerender } = renderWith(v1, onAcked);
    fireEvent.click(screen.getByRole('button', { name: 'Ack fleet' }));
    await waitFor(() => expect(onAcked).toHaveBeenCalledTimes(1));
    rerender(v1, 1);
    expect(screen.getByRole('button', { name: 'Acked fleet' }), 'a 2xx was seen: it says Acked').toBeDisabled();
    rerender(view([failed()]), 2);
    const again = screen.getByRole('button', { name: 'Ack fleet' });
    expect(again).not.toBeDisabled();
    expect(again).toHaveTextContent(/^Ack$/);
  });

  it('a read that lands WHILE the POST is in flight does not release: it was issued before the outcome (seq below after)', async () => {
    let reject!: (e: unknown) => void;
    const ack = vi.spyOn(api, 'ackUpdateNode').mockImplementationOnce(() => new Promise((_res, rej) => { reject = rej; }));
    const onAcked = vi.fn(() => 3); // the mid-flight read was number 2, so the re-poll the outcome issues is number 3
    const { rerender } = renderWith(view([failed()]), onAcked);
    fireEvent.click(screen.getByRole('button', { name: 'Ack fleet' }));
    const midFlight = view([failed()]); // a poll answered while the POST was out; it may predate the commit
    rerender(midFlight, 2);
    await act(async () => { reject(new TypeError('Failed to fetch')); });
    await waitFor(() => expect(onAcked).toHaveBeenCalledTimes(1));
    rerender(midFlight, 2);
    expect(screen.getByRole('button', { name: 'Ack fleet' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Ack fleet' }));
    expect(ack).toHaveBeenCalledTimes(1);
    rerender(view([failed()]), 3);
    expect(screen.getByRole('button', { name: 'Ack fleet' })).not.toBeDisabled();
  });

  it('a read landing with exactly the re-poll\'s number releases, and a lower one never does, at any lease', async () => {
    vi.spyOn(api, 'ackUpdateNode').mockRejectedValueOnce(new ApiError(502, { ok: false, error: 'bad gateway' }));
    const onAcked = vi.fn(() => 5);
    const { rerender } = renderWith(view([failed()]), onAcked, 3);
    fireEvent.click(screen.getByRole('button', { name: 'Ack fleet' }));
    await waitFor(() => expect(onAcked).toHaveBeenCalledTimes(1));
    rerender(view([leaseOf({ startedAt: 9 })]), 4); // a lower number, even with a new lease: not the read it waits for
    expect(screen.getByRole('button', { name: 'Ack fleet' })).toBeDisabled();
    rerender(view([failed()]), 5);
    expect(screen.getByRole('button', { name: 'Ack fleet' })).not.toBeDisabled();
  });
});

// Ruling G (D-4273): a parent that issues no read (the injected mode: `reload()` answers 0) gives the hold nothing to
// date a read by, so the hold falls back to the LEASE. No mode can re-arm on a read it cannot date.
describe('HaltBanner — a parent that issues no read holds on the lease (D-4273, ruling G)', () => {
  const ENDINGS: ReadonlyArray<readonly [string, () => void]> = [
    ['unanswered', () => { vi.spyOn(api, 'ackUpdateNode').mockRejectedValueOnce(new ApiError(502, { ok: false, error: 'bad gateway' })); }],
    ['unreadable', () => { vi.spyOn(api, 'ackUpdateNode').mockResolvedValueOnce('unreadable'); }],
  ];
  const ANSWERS: ReadonlyArray<readonly [string, () => number]> = [
    ['0', () => 0],
    ['undefined', () => undefined as unknown as number],
  ];
  const cells = ENDINGS.flatMap(([e, arm]) => ANSWERS.map(([a, fn]) => [e, a, arm, fn] as const));
  it.each(cells)('%s ending, onAcked answers %s: held on the lease through any seq, a new lease re-arms', async (_e, _a, arm, fn) => {
    arm();
    const onAcked = vi.fn(fn);
    const { rerender } = renderWith(view([failed()]), onAcked);
    fireEvent.click(screen.getByRole('button', { name: /^Ack(ed)? fleet$/ }));
    await waitFor(() => expect(onAcked).toHaveBeenCalledTimes(1));
    for (const seq of [1, 2, 7]) {
      rerender(view([failed()]), seq);
      expect(screen.getByRole('button', { name: /^Ack(ed)? fleet$/ }), `same lease at seq ${seq}`).toBeDisabled();
    }
    expect(api.ackUpdateNode).toHaveBeenCalledTimes(1);
    rerender(view([leaseOf({ startedAt: 2 })]), 8);
    expect(screen.getByRole('button', { name: 'Ack fleet' })).not.toBeDisabled();
  });
});

// Review 311 F1/F2/F4 (D-4273): the REAL hook and React's real commit, with every read and the Ack held in a
// hand-resolved deferred. A read issued before the outcome can land and render just after it, showing the same lease;
// it is never fresh, so the row stays down until the re-poll the outcome issued lands.
describe('HaltBanner — with the real poll, a read issued before the outcome never releases the hold (D-4273)', () => {
  const setVisibility = (v: DocumentVisibilityState): void => {
    Object.defineProperty(document, 'visibilityState', { value: v, configurable: true });
  };
  afterEach(() => { Reflect.deleteProperty(document, 'visibilityState'); });

  function Harness(): ReactNode {
    const p = useUpdatesView();
    return <><ToastHost /><HaltBanner updates={p.view} seq={p.seq} onAcked={p.reload} /></>;
  }

  type Read = PromiseWithResolvers<UpdatesView>;
  const setup = () => {
    const reads: Read[] = [];
    const updates = vi.spyOn(api, 'updates').mockImplementation(() => {
      const d = Promise.withResolvers<UpdatesView>();
      reads.push(d);
      return d.promise;
    });
    const acks: Array<PromiseWithResolvers<unknown>> = [];
    const ackSpy = vi.spyOn(api, 'ackUpdateNode').mockImplementation(() => {
      const d = Promise.withResolvers<unknown>();
      acks.push(d);
      return d.promise as ReturnType<typeof api.ackUpdateNode>;
    });
    return { reads, updates, acks, ackSpy };
  };
  const visibleRead = (): void => {
    setVisibility('visible');
    act(() => { document.dispatchEvent(new Event('visibilitychange')); });
  };
  const ENDINGS = [
    ['unanswered', 'Ack fleet', (d: PromiseWithResolvers<unknown>) => d.reject(new ApiError(502, { ok: false, error: 'bad gateway' }))],
    ['unreadable', 'Acked fleet', (d: PromiseWithResolvers<unknown>) => d.resolve('unreadable')],
  ] as const;
  const cells = (['a', 'c'] as const).flatMap((cell) => ENDINGS.map(([e, name, settle]) => [cell, e, name, settle] as const));

  /** The shared drive: the first read lands, the second is issued before the tap (cell a) or while the POST is in
   *  flight (cell c), and then, in ONE act, the second lands (same lease) and the Ack settles. */
  const drive = async (cell: 'a' | 'c', name: string, settle: (d: PromiseWithResolvers<unknown>) => void) => {
    const h = setup();
    render(<Harness />);
    await act(async () => { h.reads[0]!.resolve(view([failed()])); });
    const tapBtn = screen.getByRole('button', { name: 'Ack fleet' });
    if (cell === 'a') visibleRead();
    fireEvent.click(tapBtn);
    if (cell === 'c') visibleRead();
    expect(h.updates, 'two reads issued before the outcome').toHaveBeenCalledTimes(2);
    expect(h.ackSpy).toHaveBeenCalledTimes(1);
    await act(async () => {
      h.reads[1]!.resolve(view([failed()])); // same lease, landing and rendering after the outcome
      settle(h.acks[0]!);
      await Promise.resolve();
    });
    const held = screen.getByRole('button', { name });
    expect(held, 'read 2 was issued before the outcome: it does not release').toBeDisabled();
    fireEvent.click(held);
    expect(h.ackSpy, 'a click sends nothing').toHaveBeenCalledTimes(1);
    expect(h.updates, 'exactly one more read, issued inside the outcome callback').toHaveBeenCalledTimes(3);
    return h;
  };

  it.each(cells)('cell %s, %s ending: held until the re-poll the outcome issued lands', async (cell, _e, name, settle) => {
    await drive(cell, name, settle);
  });

  it.each(cells)('cell %s, %s ending: a failed post-outcome read keeps it down; a later read with the same lease re-arms', async (cell, _e, name, settle) => {
    const h = await drive(cell, name, settle);
    await act(async () => { h.reads[2]!.reject(new TypeError('Failed to fetch')); });
    expect(screen.getByRole('button', { name }), 'a failed read changes nothing').toBeDisabled();
    visibleRead();
    expect(h.updates).toHaveBeenCalledTimes(4);
    await act(async () => { h.reads[3]!.resolve(view([failed()])); });
    const again = screen.getByRole('button', { name: 'Ack fleet' });
    expect(again).not.toBeDisabled();
    expect(again).toHaveTextContent(/^Ack$/);
    fireEvent.click(again);
    expect(h.ackSpy, 'armed again: the tap sends the second POST').toHaveBeenCalledTimes(2);
  });

  it.each(cells)('cell %s, %s ending: the post-outcome read lands with the same lease and re-arms', async (cell, _e, name, settle) => {
    const h = await drive(cell, name, settle);
    await act(async () => { h.reads[2]!.resolve(view([failed()])); });
    const again = screen.getByRole('button', { name: 'Ack fleet' });
    expect(again).not.toBeDisabled();
    expect(again).toHaveTextContent(/^Ack$/);
  });

  it.each(cells)('cell %s, %s ending: the post-outcome read lands with a NEW lease and the button is armed for it', async (cell, _e, name, settle) => {
    const h = await drive(cell, name, settle);
    await act(async () => { h.reads[2]!.resolve(view([leaseOf({ startedAt: 2 })])); });
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
    const onAcked = vi.fn(() => 2);
    const { rerender } = renderWith(view([failed()]), onAcked);
    fireEvent.click(screen.getByRole('button', { name: 'Ack fleet' }));
    await waitFor(() => expect(onAcked).toHaveBeenCalledTimes(1));
    expect(screen.getByRole('button', { name: 'Acked fleet' })).toBeDisabled();
    return rerender;
  };

  it('only startedAt changes (auto retried the same tag and failed alike): a new lease', async () => {
    const rerender = await heldAfter200();
    rerender(view([leaseOf({ startedAt: 2 })]), 2);
    expect(screen.getByRole('button', { name: 'Ack fleet' })).not.toBeDisabled();
  });

  it('only target changes: a new lease', async () => {
    const rerender = await heldAfter200();
    rerender(view([leaseOf({ target: 'v0.0.85' })]), 2);
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
    // The shared button's own floor moved into @ccrc/ui with the component.
    // Asserted through the cva rather than through its source text: a scrape
    // of button.tsx would also match the sentence in its comment, and pass
    // with the utility deleted. `min-h-tap` is `var(--tap-min)` —
    // theme.css's `--spacing-tap`, pinned by theme-bridge.test.ts.
    expect(buttonVariants({ variant: 'primary' })).toContain('min-h-tap');
    // The width override was `.halt-banner-node .btn-primary` in fleet.css and
    // is now Button's `fit`; the rule is gone. `fit` sets width and padding and
    // nothing else, so the tap floor in the base survives it.
    const fit = buttonVariants({ variant: 'primary', size: 'fit' });
    expect(fit).toContain('w-auto');
    expect(fit).toContain('min-h-tap');
    expect(fit).not.toMatch(/\bh-\d|max-h-/);
    expect(() => ruleIn(haltCss, '.halt-banner-node .btn-primary')).toThrow();
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

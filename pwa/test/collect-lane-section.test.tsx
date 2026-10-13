// The Temp root collector section in Settings (path-identity spec 2026-10-12 §5.7, §5.9; child-reclamation wave 10,
// Task 12). The section reads its own endpoint through its own hook, so every case spies `api.collectLane` and
// `api.setCollectLane` and renders the section alone. Each case injects a fleet store (never the singleton, whose coord
// frame would leak between cases, settings-screen.test.tsx's afterEach resetting neither `coord` nor
// `coordFrameSeen`) and a cleanup-pause seam. Every word comes from `collectLaneWords.ts`, by its exported names; the
// section has no words of its own. Only the spec's two exact sentences, the pre-latch Off note and the not-available
// line, are written out here, so a softened copy reds.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { CollectLaneConfirmRequired, CollectLaneView, CoordStatus } from '../../shared/api';
import { CollectLaneSection } from '../src/fleet/CollectLaneSection';
import {
  COLLECT_OFF_NOTE_TEXT, COLLECT_PAUSE_TEXT, COLLECT_REFUSAL_TEXT, COLLECT_SECTION_TEXT, COLLECT_STATE_TEXT,
  COLLECT_WARN_TEXT, collectConfirmLines, collectCountLine, collectOffNote, collectOffersReconfirm, collectStateHead,
  collectUnmeasurableLines,
} from '../src/fleet/collectLaneWords';
import { COORD_CONFIRM_MS } from '../src/fleet/coordWords';
import { ApiError, COORD_UNSUPPORTED_TEXT, api } from '../src/lib/api';
import { ToastHost } from '../src/components/Toast';
import { UNCONFIRMED_TEXT } from '../src/screens/settingsText';
import { createFleetStore, type FleetStore } from '../src/stores/fleet';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  Reflect.deleteProperty(document, 'visibilityState');
});

type State = CollectLaneView['effective']['state'];
const STATES = Object.keys(COLLECT_STATE_TEXT) as State[];
const NOW = 1_800_000_000_000;
const NOTICE = "The choice applies from the collector's next check; a removal already handed to ccd is not stopped.";

const makeStore = (): FleetStore => createFleetStore({
  makeSocket: () => ({ onopen: null, onmessage: null, onclose: null, onerror: null,
    close(): void {} }) as unknown as WebSocket,
});
const coord = (over: Partial<CoordStatus> = {}): CoordStatus =>
  ({ pause: 'clear', mail: 'clear', reclaim: 'clear', childReclaimAttention: [], ...over });
const seen = (store: FleetStore, c: CoordStatus): void => {
  act(() => { store.setState({ coord: c, coordFrameSeen: true }); });
};

/** The untouched seed on a fleet box whose legacy file stands. Off is stored, there is no journal yet, the latch is
 *  unset, and the lane is live by the legacy file. Off is held here. */
const cv = (over: Partial<CollectLaneView> = {}): CollectLaneView => ({
  stored: { read: 'row', choice: 'off', fleetNodeId: null, markerRetiredAt: null, generation: 0, updatedAt: 0 },
  journal: { read: 'missing' },
  control: { state: 'coherent', bootstrap: true },
  effective: { state: 'live', armedBy: 'legacy-marker' },
  marker: { listing: 'stands', latch: 'unset' },
  node: { state: 'known', nodeId: 'node-a', measuredAt: 1_000, stored: 'none' },
  caps: { collect: true, reclaimPause: true },
  attention: { wouldCollect: 0, held: 0, boxLines: 0 },
  remedy: null,
  notice: null,
  ...over,
});
/** After the latch: the legacy file is retired and Off is stored. Off is enabled. */
const OFF_LATCHED = cv({
  stored: { read: 'row', choice: 'off', fleetNodeId: null, markerRetiredAt: 1_500, generation: 1, updatedAt: 1_500 },
  journal: { read: 'ok', max: 1 },
  control: { state: 'coherent', bootstrap: false },
  effective: { state: 'shadowed', armedBy: 'neither' },
  marker: { listing: 'absent', latch: 'set' },
});
/** Live by Settings for the node measured on this connection, after the latch. */
const LIVE_HERE = cv({
  stored: { read: 'row', choice: 'live', fleetNodeId: 'node-a', markerRetiredAt: 1_500, generation: 2, updatedAt: 2_000 },
  journal: { read: 'ok', max: 2 },
  control: { state: 'coherent', bootstrap: false },
  effective: { state: 'live', armedBy: 'settings' },
  marker: { listing: 'absent', latch: 'set' },
  node: { state: 'known', nodeId: 'node-a', measuredAt: 1_000, stored: 'this' },
});
/** Live stored for another node: shadowed here, so it must be confirmed again. */
const OTHER_NODE = cv({
  stored: { read: 'row', choice: 'live', fleetNodeId: 'node-b', markerRetiredAt: 1_500, generation: 2, updatedAt: 2_000 },
  journal: { read: 'ok', max: 2 },
  control: { state: 'coherent', bootstrap: false },
  effective: { state: 'shadowed', armedBy: 'neither' },
  marker: { listing: 'absent', latch: 'set' },
  node: { state: 'known', nodeId: 'node-a', measuredAt: 1_000, stored: 'other' },
});
const REMEDY = 'Confirm Live again, or choose Off, to repair the control state.';
/** Row generation 5 over a journal at 4: a measurable mismatch, safety-stopped. */
const MISMATCH = cv({
  stored: { read: 'row', choice: 'live', fleetNodeId: 'node-a', markerRetiredAt: 1_500, generation: 5, updatedAt: 2_000 },
  journal: { read: 'ok', max: 4 },
  control: { state: 'mismatch', journal: 'behind' },
  effective: { state: 'safety-stopped', armedBy: 'neither' },
  marker: { listing: 'absent', latch: 'set' },
  node: { state: 'known', nodeId: 'node-a', measuredAt: 1_000, stored: 'this' },
  remedy: REMEDY,
});

const FACTS: CollectLaneConfirmRequired['facts'] = {
  node: { nodeId: 'node-a', measuredAt: NOW - 120_000 },
  caps: { collect: true, reclaimPause: true },
  paused: false,
  marker: 'absent',
  repair: null,
  attention: { wouldCollect: 2, held: 1, boxLines: 0 },
};
const confirm409 = (error: 'confirm-required' | 'confirm-stale', confirmKey: string,
  facts: CollectLaneConfirmRequired['facts'] = FACTS): ApiError =>
  new ApiError(409, { ok: false, error, confirmKey, facts } satisfies CollectLaneConfirmRequired);

// `hidden: true`: an open sheet marks the page behind it aria-hidden, and these cases read the radios under it.
const section = (): HTMLElement =>
  screen.getByRole('heading', { name: COLLECT_SECTION_TEXT.title, hidden: true }).closest('section')!;
const choiceGroup = (): Promise<HTMLElement> =>
  within(section()).findByRole('group', { name: COLLECT_SECTION_TEXT.legend, hidden: true });
const radio = (c: 'off' | 'live'): HTMLElement =>
  within(section()).getByRole('radio', { name: COLLECT_SECTION_TEXT[c], hidden: true });
const repoll = async (): Promise<void> => {
  Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true });
  await act(async () => { document.dispatchEvent(new Event('visibilitychange')); });
};
const mount = async (first: CollectLaneView,
  pause: (state: 'on' | 'off') => Promise<void> = vi.fn(() => new Promise<void>(() => {}))) => {
  const store = makeStore();
  const read = vi.spyOn(api, 'collectLane').mockResolvedValue(first);
  render(<><ToastHost /><CollectLaneSection store={store} childReclaimPause={pause} /></>);
  await choiceGroup();
  return { read, store };
};

describe('the Temp root collector section (path-identity spec §5.7, §5.9)', () => {
  it("each of the six states shows its one Now line, \"Label: line\", and no other state's", async () => {
    expect(STATES).toHaveLength(6);
    for (const state of STATES) {
      await mount(cv({ effective: { state, armedBy: state === 'live' ? 'legacy-marker' : 'neither' } }));
      const s = section();
      expect(within(s).getByText(collectStateHead(state), { selector: 'p' }), state).toBeInTheDocument();
      for (const other of STATES.filter((o) => o !== state)) {
        expect(within(s).queryByText(collectStateHead(other), { selector: 'p' }), `${state} shows ${other}`).toBeNull();
      }
      cleanup();
      vi.restoreAllMocks();
    }
  });

  it('404 and 501 show only "Not available on this server.", replacing a landed Live view', async () => {
    expect(COLLECT_SECTION_TEXT.notAvailable).toBe('Not available on this server.');
    const { read, store } = await mount(LIVE_HERE);
    seen(store, coord());
    expect(radio('live')).toBeChecked();
    expect(within(section()).getByRole('button', { name: COLLECT_PAUSE_TEXT.label })).toBeInTheDocument();
    const onlyTheLine = (): void => {
      expect(within(section()).queryByRole('radio', { hidden: true })).toBeNull();
      expect(within(section()).queryByRole('button', { hidden: true })).toBeNull();
      expect([...section().querySelectorAll('p')].map((p) => p.textContent)).toEqual([COLLECT_SECTION_TEXT.notAvailable]);
    };

    read.mockRejectedValue(new ApiError(404, { ok: false, error: 'not-found' }));
    await repoll();
    expect(await within(section()).findByText(COLLECT_SECTION_TEXT.notAvailable)).toBeInTheDocument();
    onlyTheLine();

    read.mockResolvedValue(LIVE_HERE);
    await repoll();
    await waitFor(() => expect(radio('live')).toBeChecked());

    read.mockRejectedValue(new ApiError(501, { ok: false, error: 'not-configured' }));
    await repoll();
    expect(await within(section()).findByText(COLLECT_SECTION_TEXT.notAvailable)).toBeInTheDocument();
    onlyTheLine();
  });

  it("a GET 503 state-unmeasurable shows collectUnmeasurableLines (the Safety-stopped Now line and the server's detail), replacing a landed Live view, and offers no radio write", async () => {
    const { read } = await mount(LIVE_HERE);
    const write = vi.spyOn(api, 'setCollectLane').mockReturnValue(new Promise(() => {}));
    const detail = 'the collector switch row is absent';
    read.mockRejectedValue(new ApiError(503, { ok: false, error: 'state-unmeasurable', detail }));
    await repoll();
    const lines = collectUnmeasurableLines(detail);
    expect(lines.some((l) => l.text.includes(detail)), "the lines carry the server's detail").toBe(true);
    for (const line of lines) expect(await within(section()).findByText(line.text, { selector: 'p' })).toBeInTheDocument();
    expect(within(section()).getByText(collectStateHead('safety-stopped'), { selector: 'p' })).toBeInTheDocument();
    expect(within(section()).queryByText(collectStateHead('live'), { selector: 'p' })).toBeNull();
    expect(within(section()).queryByRole('radio', { hidden: true })).toBeNull();
    expect(within(section()).queryByRole('button', { name: COLLECT_SECTION_TEXT.reconfirm, hidden: true })).toBeNull();
    expect(within(section()).queryByText(COLLECT_SECTION_TEXT.notAvailable)).toBeNull();
    expect(write).not.toHaveBeenCalled();
  });

  it('a read that did not land keeps the last view, marked stale, so a kept Live is never shown as current', async () => {
    const { read } = await mount(LIVE_HERE);
    expect(within(section()).queryByText(COLLECT_SECTION_TEXT.stale)).toBeNull();
    read.mockRejectedValue(new ApiError(502, { ok: false, error: 'bad-gateway' }));
    await repoll();
    expect(await within(section()).findByText(COLLECT_SECTION_TEXT.stale)).toBeInTheDocument();
    expect(radio('live')).toBeChecked();
    expect(within(section()).queryByText(COLLECT_SECTION_TEXT.unread)).toBeNull();
    read.mockResolvedValue(LIVE_HERE);
    await repoll();
    await waitFor(() => expect(within(section()).queryByText(COLLECT_SECTION_TEXT.stale)).toBeNull());
  });

  it("before the latch Off is disabled; its note is the spec's text while the marker stands, pending while it is absent, unmeasured otherwise; Live stays enabled", async () => {
    expect(COLLECT_OFF_NOTE_TEXT.stands).toBe(
      "The fleet box's legacy file still controls this lane. Remove it by hand before Settings can turn the collector off.");
    const write = vi.spyOn(api, 'setCollectLane').mockReturnValue(new Promise(() => {}));
    const stands = cv();
    const { read } = await mount(stands);
    const noteOf = (): string | null => {
      const id = radio('off').getAttribute('aria-describedby');
      return id === null ? null : document.getElementById(id)?.textContent ?? null;
    };
    expect(radio('off')).toBeDisabled();
    expect(radio('off')).toBeChecked();
    expect(noteOf()).toBe(COLLECT_OFF_NOTE_TEXT.stands);
    expect(collectOffNote(stands)).toBe(COLLECT_OFF_NOTE_TEXT.stands);
    expect(radio('live')).toBeEnabled();
    expect(radio('live').getAttribute('aria-describedby')).toBeNull();
    fireEvent.click(radio('off'));
    expect(write).not.toHaveBeenCalled();

    read.mockResolvedValue(cv({ marker: { listing: 'absent', latch: 'unset' }, effective: { state: 'shadowed', armedBy: 'neither' } }));
    await repoll();
    await waitFor(() => expect(noteOf()).toBe(COLLECT_OFF_NOTE_TEXT.absent));
    expect(radio('off')).toBeDisabled();
    expect(radio('live')).toBeEnabled();

    read.mockResolvedValue(cv({ marker: { listing: 'unmeasured', latch: 'unset' }, effective: { state: 'unknown-fleet', armedBy: 'neither' } }));
    await repoll();
    await waitFor(() => expect(noteOf()).toBe(COLLECT_OFF_NOTE_TEXT.unmeasured));
    expect(radio('off')).toBeDisabled();
    expect(radio('live')).toBeEnabled();
  });

  it("with the latch set, Off posts exactly {choice:'off'}", async () => {
    await mount(LIVE_HERE);
    const write = vi.spyOn(api, 'setCollectLane').mockResolvedValue({ ...OFF_LATCHED, notice: NOTICE });
    expect(radio('off')).toBeEnabled();
    expect(radio('off').getAttribute('aria-describedby')).toBeNull();
    fireEvent.click(radio('off'));
    await waitFor(() => expect(radio('off')).toBeChecked());
    expect(write).toHaveBeenCalledTimes(1);
    expect(write.mock.calls[0]![0]).toStrictEqual({ choice: 'off' });
    expect(within(section()).getByText(NOTICE)).toBeInTheDocument();
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('a 409 marker-still-controls shows inline and re-reads', async () => {
    const { read } = await mount(LIVE_HERE);
    vi.spyOn(api, 'setCollectLane').mockRejectedValue(
      new ApiError(409, { ok: false, error: 'marker-still-controls', detail: 'the legacy file still controls the lane' }));
    fireEvent.click(radio('off'));
    expect(await within(section()).findByText(COLLECT_REFUSAL_TEXT['marker-still-controls'])).toBeInTheDocument();
    await waitFor(() => expect(read).toHaveBeenCalledTimes(2));
    expect(document.querySelector('.toast')).toBeNull();
    expect(radio('live')).toBeChecked();
    expect(radio('off')).not.toBeChecked();
  });

  it('a stored Live for another node shows its line and "Confirm Live again", which posts {choice:\'live\'} with no key', async () => {
    await mount(LIVE_HERE);
    expect(collectOffersReconfirm(LIVE_HERE)).toBe(false);
    expect(within(section()).queryByRole('button', { name: COLLECT_SECTION_TEXT.reconfirm })).toBeNull();
    cleanup();
    vi.restoreAllMocks();

    await mount(OTHER_NODE);
    expect(collectOffersReconfirm(OTHER_NODE)).toBe(true);
    expect(within(section()).getByText(COLLECT_WARN_TEXT.otherNode)).toBeInTheDocument();
    expect(radio('live')).toBeChecked();
    const write = vi.spyOn(api, 'setCollectLane').mockReturnValue(new Promise(() => {}));
    fireEvent.click(within(section()).getByRole('button', { name: COLLECT_SECTION_TEXT.reconfirm }));
    expect(write).toHaveBeenCalledTimes(1);
    expect(write.mock.calls[0]![0]).toStrictEqual({ choice: 'live' });
  });

  it('a mismatch shows the mismatch line, the remedy and the re-confirm button', async () => {
    await mount(MISMATCH);
    expect(within(section()).getByText(COLLECT_WARN_TEXT.mismatch)).toBeInTheDocument();
    expect(within(section()).getByText(REMEDY)).toBeInTheDocument();
    expect(collectOffersReconfirm(MISMATCH)).toBe(true);
    const write = vi.spyOn(api, 'setCollectLane').mockReturnValue(new Promise(() => {}));
    fireEvent.click(within(section()).getByRole('button', { name: COLLECT_SECTION_TEXT.reconfirm }));
    expect(write).toHaveBeenCalledTimes(1);
    expect(write.mock.calls[0]![0]).toStrictEqual({ choice: 'live' });
  });

  it("a mismatch with Off stored checks neither radio, so Off (latch set) posts {choice:'off'} to repair it", async () => {
    const offMismatch = cv({
      stored: { read: 'row', choice: 'off', fleetNodeId: null, markerRetiredAt: 1_500, generation: 3, updatedAt: 2_000 },
      journal: { read: 'ok', max: 5 },
      control: { state: 'mismatch', journal: 'ahead' },
      effective: { state: 'safety-stopped', armedBy: 'neither' },
      marker: { listing: 'absent', latch: 'set' },
      remedy: REMEDY,
    });
    await mount(offMismatch);
    expect(radio('off')).not.toBeChecked();
    expect(radio('live')).not.toBeChecked();
    expect(radio('off')).toBeEnabled();
    const write = vi.spyOn(api, 'setCollectLane').mockReturnValue(new Promise(() => {}));
    fireEvent.click(radio('off'));
    expect(write).toHaveBeenCalledTimes(1);
    expect(write.mock.calls[0]![0]).toStrictEqual({ choice: 'off' });
  });

  it('an unknown stored choice checks neither radio and says so', async () => {
    await mount(cv({
      stored: { read: 'row', choice: 'shadowed', fleetNodeId: null, markerRetiredAt: 1_500, generation: 1, updatedAt: 1_500 },
      journal: { read: 'ok', max: 1 },
      control: { state: 'coherent', bootstrap: false },
      effective: { state: 'shadowed', armedBy: 'neither' },
      marker: { listing: 'absent', latch: 'set' },
    }));
    expect(radio('off')).not.toBeChecked();
    expect(radio('live')).not.toBeChecked();
    expect(within(section()).getByText(COLLECT_WARN_TEXT.unknownChoice)).toBeInTheDocument();
  });

  it('Live opens the sheet from the 409 with the node, freshness, both capabilities and the checklist; Cancel sends nothing; Set re-posts the key; 200 settles to Live', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(NOW);
    await mount(OFF_LATCHED);
    const write = vi.spyOn(api, 'setCollectLane')
      .mockRejectedValueOnce(confirm409('confirm-required', 'a1b2c3d4'))
      .mockRejectedValueOnce(confirm409('confirm-required', 'a1b2c3d4'))
      .mockResolvedValueOnce({ ...LIVE_HERE, notice: NOTICE });
    fireEvent.click(radio('live'));
    const sheet = await screen.findByRole('dialog');
    const lines = collectConfirmLines(FACTS, false, NOW);
    expect(lines.some((l) => l.includes('node-a')), 'the words name the directly measured node').toBe(true);
    for (const line of lines) expect(within(sheet).getByText(line)).toBeInTheDocument();
    expect(radio('live')).toBeDisabled();

    fireEvent.click(within(sheet).getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(write).toHaveBeenCalledTimes(1);
    expect(radio('off')).toBeChecked();
    expect(radio('live')).not.toBeChecked();

    fireEvent.click(radio('live'));
    const again = await screen.findByRole('dialog');
    fireEvent.click(within(again).getByRole('button', { name: COLLECT_SECTION_TEXT.confirmLabel }));
    await waitFor(() => expect(radio('live')).toBeChecked());
    expect(write).toHaveBeenCalledTimes(3);
    expect(write.mock.calls[0]![0]).toStrictEqual({ choice: 'live' });
    expect(write.mock.calls[1]![0]).toStrictEqual({ choice: 'live' });
    expect(write.mock.calls[2]![0]).toStrictEqual({ choice: 'live', confirm: 'a1b2c3d4' });
    expect(within(section()).getByText(NOTICE)).toBeInTheDocument();
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('confirm-stale reopens the sheet with the stale lead and the new key', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(NOW);
    await mount(OFF_LATCHED);
    const fresh: CollectLaneConfirmRequired['facts'] = { ...FACTS, caps: { collect: true, reclaimPause: false } };
    const write = vi.spyOn(api, 'setCollectLane')
      .mockRejectedValueOnce(confirm409('confirm-required', 'a1b2c3d4'))
      .mockRejectedValueOnce(confirm409('confirm-stale', 'e5f60718', fresh))
      .mockResolvedValueOnce(LIVE_HERE);
    const lead = collectConfirmLines(fresh, true, NOW).filter((l) => !collectConfirmLines(fresh, false, NOW).includes(l));
    expect(lead.length, 'the stale lead is a line of its own').toBeGreaterThan(0);

    fireEvent.click(radio('live'));
    const first = await screen.findByRole('dialog');
    for (const l of lead) expect(within(first).queryByText(l)).toBeNull();
    fireEvent.click(within(first).getByRole('button', { name: COLLECT_SECTION_TEXT.confirmLabel }));
    await waitFor(() => expect(write).toHaveBeenCalledTimes(2));

    const reopened = await screen.findByRole('dialog');
    for (const l of collectConfirmLines(fresh, true, NOW)) expect(await within(reopened).findByText(l)).toBeInTheDocument();
    fireEvent.click(within(reopened).getByRole('button', { name: COLLECT_SECTION_TEXT.confirmLabel }));
    await waitFor(() => expect(radio('live')).toBeChecked());
    expect(write.mock.calls[1]![0]).toStrictEqual({ choice: 'live', confirm: 'a1b2c3d4' });
    expect(write.mock.calls[2]![0]).toStrictEqual({ choice: 'live', confirm: 'e5f60718' });
  });

  it('403 sign-in-unarmed toasts, re-reads, and leaves Live unchecked', async () => {
    const { read } = await mount(OFF_LATCHED);
    vi.spyOn(api, 'setCollectLane').mockRejectedValue(
      new ApiError(403, { ok: false, error: 'sign-in-unarmed', detail: 'Live needs sign-in armed on this server' }));
    fireEvent.click(radio('live'));
    expect(await screen.findByText(`${COLLECT_REFUSAL_TEXT['sign-in-unarmed']} (Live needs sign-in armed on this server)`)).toBeInTheDocument();
    await waitFor(() => expect(read).toHaveBeenCalledTimes(2));
    expect(radio('live')).not.toBeChecked();
    expect(radio('off')).toBeChecked();
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('the counts line, and the not-measured line', async () => {
    const counted = { wouldCollect: 3, held: 2, boxLines: 0 };
    const { read } = await mount(cv({ attention: counted }));
    expect(within(section()).getByText(collectCountLine(counted))).toBeInTheDocument();
    expect(collectCountLine(null)).not.toBe(collectCountLine(counted));
    read.mockResolvedValue(cv({ attention: null }));
    await repoll();
    expect(await within(section()).findByText(collectCountLine(null))).toBeInTheDocument();
    expect(within(section()).queryByText(collectCountLine(counted))).toBeNull();
  });

  it("a refused or unreadable write leaves the server's radio checked, never the tapped one", async () => {
    const { read } = await mount(OFF_LATCHED);
    const write = vi.spyOn(api, 'setCollectLane')
      .mockResolvedValueOnce('unreadable')
      .mockRejectedValueOnce(new ApiError(409, { ok: false, error: 'conflict', detail: 'the stored row changed' }));
    fireEvent.click(radio('live'));
    expect(await screen.findByText(UNCONFIRMED_TEXT)).toBeInTheDocument();
    await waitFor(() => expect(read).toHaveBeenCalledTimes(2));
    expect(radio('live')).not.toBeChecked();
    expect(radio('off')).toBeChecked();
    await waitFor(() => expect(radio('live')).toBeEnabled());

    fireEvent.click(radio('live'));
    expect(await screen.findByText(`${COLLECT_REFUSAL_TEXT.conflict} (the stored row changed)`)).toBeInTheDocument();
    await waitFor(() => expect(read).toHaveBeenCalledTimes(3));
    expect(radio('live')).not.toBeChecked();
    expect(radio('off')).toBeChecked();
    expect(write).toHaveBeenCalledTimes(2);
  });

  it('a second tap while a write is in flight sends nothing', async () => {
    await mount(OFF_LATCHED);
    const flight = Promise.withResolvers<CollectLaneView | 'unreadable'>();
    const write = vi.spyOn(api, 'setCollectLane').mockReturnValue(flight.promise);
    fireEvent.click(radio('live'));
    for (const r of within(section()).getAllByRole('radio', { hidden: true })) expect(r).toBeDisabled();
    fireEvent.click(radio('live'));
    fireEvent.click(radio('off'));
    expect(write).toHaveBeenCalledTimes(1);
    await act(async () => {
      flight.resolve(LIVE_HERE);
      await flight.promise;
    });
    await waitFor(() => expect(radio('live')).toBeChecked());
    expect(radio('off')).toBeEnabled();
    expect(write).toHaveBeenCalledTimes(1);
  });

  describe('Pause all cleanup: nothing before a coord frame; a tap calls \'on\' once; "pausing…" until a frame reads set; unconfirmed after COORD_CONFIRM_MS; 501 inline; no Resume control', () => {
    it('renders nothing before a coord frame, and the button with its four-lane text once a clear frame lands', async () => {
      const { store } = await mount(LIVE_HERE);
      expect(within(section()).queryByRole('button', { name: COLLECT_PAUSE_TEXT.label })).toBeNull();
      expect(within(section()).queryByText(COLLECT_PAUSE_TEXT.stops)).toBeNull();
      seen(store, coord());
      expect(within(section()).getByRole('button', { name: COLLECT_PAUSE_TEXT.label })).toBeEnabled();
      expect(within(section()).getByText(COLLECT_PAUSE_TEXT.stops)).toBeInTheDocument();
    });

    it("a tap calls 'on' exactly once and reads pausing… until a later frame reads set; then no Resume control", async () => {
      const pause = vi.fn<(state: 'on' | 'off') => Promise<void>>().mockResolvedValue(undefined);
      const { store } = await mount(LIVE_HERE, pause);
      seen(store, coord());
      fireEvent.click(within(section()).getByRole('button', { name: COLLECT_PAUSE_TEXT.label }));
      const pending = await within(section()).findByRole('button', { name: COLLECT_PAUSE_TEXT.pausing });
      expect(pending).toBeDisabled();
      fireEvent.click(pending);
      expect(pause).toHaveBeenCalledTimes(1);
      expect(pause).toHaveBeenCalledWith('on');
      seen(store, coord({ reclaim: 'clear', childReclaimAttention: [] }));   // a frame, still disagreeing
      expect(within(section()).getByRole('button', { name: COLLECT_PAUSE_TEXT.pausing })).toBeInTheDocument();
      seen(store, coord({ reclaim: 'set' }));
      expect(await within(section()).findByText(COLLECT_PAUSE_TEXT.paused)).toBeInTheDocument();
      expect(within(section()).queryByRole('button', { name: COLLECT_PAUSE_TEXT.pausing })).toBeNull();
      expect(within(section()).queryByRole('button', { name: /resume/i })).toBeNull();
      expect(pause).not.toHaveBeenCalledWith('off');
    });

    it('reads "unconfirmed — check /runs" when no frame confirms inside COORD_CONFIRM_MS', async () => {
      expect(COLLECT_PAUSE_TEXT.unconfirmed).toBe('unconfirmed — check /runs');
      vi.useFakeTimers();
      try {
        const store = makeStore();
        vi.spyOn(api, 'collectLane').mockResolvedValue(LIVE_HERE);
        const pause = vi.fn<(state: 'on' | 'off') => Promise<void>>().mockResolvedValue(undefined);
        render(<CollectLaneSection store={store} childReclaimPause={pause} />);
        await act(async () => { await vi.advanceTimersByTimeAsync(0); });
        seen(store, coord());
        fireEvent.click(within(section()).getByRole('button', { name: COLLECT_PAUSE_TEXT.label }));
        await act(async () => { await vi.advanceTimersByTimeAsync(0); });
        expect(within(section()).getByRole('button', { name: COLLECT_PAUSE_TEXT.pausing })).toBeDisabled();
        await act(async () => { await vi.advanceTimersByTimeAsync(COORD_CONFIRM_MS); });
        expect(within(section()).getByRole('button', { name: COLLECT_PAUSE_TEXT.unconfirmed })).toBeEnabled();
        expect(pause).toHaveBeenCalledTimes(1);
      } finally {
        vi.useRealTimers();
      }
    });

    it('a 501 renders inline with the one shared sentence, never a toast, and drops back to the Pause label', async () => {
      const pause = vi.fn<(state: 'on' | 'off') => Promise<void>>()
        .mockRejectedValue(new ApiError(501, { ok: false, error: 'unsupported' }));
      const { store } = await mount(LIVE_HERE, pause);
      seen(store, coord());
      fireEvent.click(within(section()).getByRole('button', { name: COLLECT_PAUSE_TEXT.label }));
      expect(await within(section()).findByText(COORD_UNSUPPORTED_TEXT)).toBeInTheDocument();
      expect(within(section()).getByRole('button', { name: COLLECT_PAUSE_TEXT.label })).toBeEnabled();
      expect(document.querySelector('.toast')).toBeNull();
    });

    it('offers Pause only: an unreadable switch still offers Pause, a paused one offers no Resume, and the file never asks off', async () => {
      const { store } = await mount(LIVE_HERE);
      seen(store, { ...coord(), reclaim: 'quarantined' } as unknown as CoordStatus);
      expect(within(section()).getByRole('button', { name: COLLECT_PAUSE_TEXT.label })).toBeInTheDocument();
      seen(store, coord({ reclaim: 'set' }));
      expect(within(section()).getByText(COLLECT_PAUSE_TEXT.paused)).toBeInTheDocument();
      expect(within(section()).queryByRole('button', { name: /resume/i })).toBeNull();
      const src = readFileSync(path.join(import.meta.dirname, '..', 'src', 'fleet', 'CollectLaneSection.tsx'), 'utf8');
      expect(src).not.toMatch(/childReclaimPause\(\s*'off'/);
      expect(src).not.toMatch(/UpdateMoveSheet/);
    });
  });
});

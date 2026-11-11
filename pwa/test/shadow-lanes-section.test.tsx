// D-8274 (spec 2026-10-28 R-6): Settings › Automation › Shadow lanes. The card reads its own door and writes `{lane, choice}`;
// Live goes out with no key, the server's 409 `confirm-required` opens the confirm sheet from the facts it read, and Go live
// sends the server's key back. Every case spies `api.laneArm` and `api.setLaneArm` and renders the card alone; every word is
// L0's `LANE_ARM_TEXT`, read by name. The card at every width is `browser/shadow-lanes-card.browser.test.ts`.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { LANE_ARM_TEXT as T, ROSTER_CARD_SHADOW_LOG, type LaneArmRowView, type LaneArmView } from '../../shared/lane-arm';
import { COORDINATOR_ROSTER_CARD_LIVE_MARKER } from '../../shared/switches';
import { ShadowLanesSection } from '../src/fleet/ShadowLanesSection';
import { asLaneArmConfirm, asLaneArmView, laneArmLines } from '../src/fleet/laneArmWords';
import { ApiError, api } from '../src/lib/api';
import { clearScreenCache } from '../src/lib/screenCache';
import { UNCONFIRMED_TEXT } from '../src/fleet/settingsText';

afterEach(() => {
  cleanup();
  clearScreenCache();
  vi.restoreAllMocks();
});

const R = T.rows['roster-card'];
const row = (over: Partial<LaneArmRowView> = {}): LaneArmRowView => ({
  lane: 'roster-card', stored: 'shadow', detail: null, live: false, updatedAt: 0, imported: null,
  marker: COORDINATOR_ROSTER_CARD_LIVE_MARKER, ...over,
});
const view = (over: Partial<LaneArmRowView> = {}): LaneArmView => ({ lanes: [row(over)] });
const radio = (name: string): HTMLInputElement => screen.getByRole('radio', { name }) as HTMLInputElement;
const confirm409 = (key = 'roster-card:shadow:0') => new ApiError(409, {
  ok: false, error: 'confirm-required', lane: 'roster-card', confirmKey: key,
  facts: { stored: 'shadow', updatedAt: 0, shadowLog: ROSTER_CARD_SHADOW_LOG },
});
const mount = () => render(<ShadowLanesSection />);

describe('Settings › Automation › Shadow lanes (D-8274)', () => {
  it('a seeded server reads Shadow: the roster card row, Shadow checked, the shadow record named', async () => {
    vi.spyOn(api, 'laneArm').mockResolvedValue(view());
    mount();
    await waitFor(() => expect(radio(T.shadow).checked).toBe(true));
    expect(radio(T.live).checked).toBe(false);
    expect(screen.getByRole('heading', { level: 3, name: T.title })).toBeInTheDocument();
    expect(screen.getByRole('group', { name: R.legend })).toBeInTheDocument();
    expect(screen.getByText(T.shadowLog(ROSTER_CARD_SHADOW_LOG))).toBeInTheDocument();
    expect(screen.getByText(R.liveNote)).toBeInTheDocument();
  });

  it('Live is one tap then a confirm: the tap sends no key, the server\'s 409 opens the sheet, Go live sends its key', async () => {
    vi.spyOn(api, 'laneArm').mockResolvedValue(view());
    const set = vi.spyOn(api, 'setLaneArm')
      .mockRejectedValueOnce(confirm409('roster-card:shadow:0'))
      .mockResolvedValueOnce(view({ stored: 'live', live: true, updatedAt: 5 }));
    mount();
    await waitFor(() => expect(radio(T.shadow).checked).toBe(true));
    fireEvent.click(radio(T.live));
    expect(set).toHaveBeenNthCalledWith(1, { lane: 'roster-card', choice: 'live' });
    const sheet = await screen.findByRole('dialog', { name: T.confirmTitle });
    for (const l of T.confirmLines(R.legend, ROSTER_CARD_SHADOW_LOG)) expect(within(sheet).getByText(l)).toBeInTheDocument();
    // Nothing moved yet: the checked radio is still the server's (the page behind the sheet is hidden from the tree).
    expect((screen.getByRole('radio', { name: T.shadow, hidden: true }) as HTMLInputElement).checked).toBe(true);
    fireEvent.click(within(sheet).getByRole('button', { name: T.confirmLabel }));
    expect(set).toHaveBeenNthCalledWith(2, { lane: 'roster-card', choice: 'live', confirm: 'roster-card:shadow:0' });
    await waitFor(() => expect(radio(T.live).checked).toBe(true));
  });

  it('Cancel on the sheet sends nothing more', async () => {
    vi.spyOn(api, 'laneArm').mockResolvedValue(view());
    const set = vi.spyOn(api, 'setLaneArm').mockRejectedValueOnce(confirm409());
    mount();
    await waitFor(() => expect(radio(T.shadow).checked).toBe(true));
    fireEvent.click(radio(T.live));
    const sheet = await screen.findByRole('dialog', { name: T.confirmTitle });
    fireEvent.click(within(sheet).getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(set).toHaveBeenCalledTimes(1);
    expect(radio(T.shadow).checked).toBe(true);
  });

  it('Shadow goes out at once, with no sheet, and the reply is what the card shows', async () => {
    vi.spyOn(api, 'laneArm').mockResolvedValue(view({ stored: 'live', live: true }));
    const set = vi.spyOn(api, 'setLaneArm').mockResolvedValue(view());
    mount();
    await waitFor(() => expect(radio(T.live).checked).toBe(true));
    fireEvent.click(radio(T.shadow));
    expect(set).toHaveBeenCalledWith({ lane: 'roster-card', choice: 'shadow' });
    await waitFor(() => expect(radio(T.shadow).checked).toBe(true));
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('sign-in dark: the refusal is said in the card\'s sentence, and the card re-reads', async () => {
    const read = vi.spyOn(api, 'laneArm').mockResolvedValue(view());
    vi.spyOn(api, 'setLaneArm').mockRejectedValue(new ApiError(403, { ok: false, error: 'sign-in-unarmed' }));
    mount();
    await waitFor(() => expect(radio(T.shadow).checked).toBe(true));
    fireEvent.click(radio(T.live));
    expect(await screen.findByText(T.signInUnarmed)).toBeInTheDocument();
    await waitFor(() => expect(read).toHaveBeenCalledTimes(2));
    expect(radio(T.shadow).checked).toBe(true);
  });

  it('an unreadable 2xx is not a refusal: it may have landed, and the card re-reads', async () => {
    const read = vi.spyOn(api, 'laneArm').mockResolvedValue(view({ stored: 'live', live: true }));
    vi.spyOn(api, 'setLaneArm').mockResolvedValue('unreadable');
    mount();
    await waitFor(() => expect(radio(T.live).checked).toBe(true));
    fireEvent.click(radio(T.shadow));
    expect(await screen.findByText(UNCONFIRMED_TEXT)).toBeInTheDocument();
    await waitFor(() => expect(read).toHaveBeenCalledTimes(2));
  });

  it('a marker imported at the upgrade is said on the row; a token this build does not know checks neither radio', async () => {
    vi.spyOn(api, 'laneArm').mockResolvedValue(view({ stored: 'live', live: true, imported: { result: 'stood', at: 1 } }));
    mount();
    expect(await screen.findByText(T.importedLive(COORDINATOR_ROSTER_CARD_LIVE_MARKER))).toBeInTheDocument();
    cleanup();
    clearScreenCache();
    vi.spyOn(api, 'laneArm').mockResolvedValue(view({ stored: 'unknown' }));
    mount();
    expect(await screen.findByText(T.unknown)).toBeInTheDocument();
    expect(radio(T.shadow).checked).toBe(false);
    expect(radio(T.live).checked).toBe(false);
  });

  it('a server without the route (404 not-found) shows only "Not available on this server."', async () => {
    vi.spyOn(api, 'laneArm').mockRejectedValue(new ApiError(404, { ok: false, error: 'not-found' }));
    mount();
    expect(await screen.findByText('Not available on this server.')).toBeInTheDocument();
    expect(screen.queryByRole('radio')).toBeNull();
  });
});

describe('laneArmWords (D-8274)', () => {
  it('the view guard takes a whole view, leaves out a lane this build does not know, and refuses a mistyped row', () => {
    expect(asLaneArmView(view())).toEqual(view());
    expect(asLaneArmView({ lanes: [row(), { ...row(), lane: 'a-newer-lane' }] })).toEqual(view());
    expect(asLaneArmView({ lanes: [{ ...row(), stored: 'maybe' }] })).toBeNull();
    expect(asLaneArmView({ lanes: [{ ...row(), live: 'yes' }] })).toBeNull();
    expect(asLaneArmView({ lanes: [{ ...row(), imported: { result: 'odd', at: 1 } }] })).toBeNull();
    expect(asLaneArmView(null)).toBeNull();
  });

  it('the confirm guard reads only a whole confirm-required body', () => {
    expect(asLaneArmConfirm(confirm409().body)).toMatchObject({ confirmKey: 'roster-card:shadow:0' });
    expect(asLaneArmConfirm({ ok: false, error: 'bad-request' })).toBeNull();
  });

  it('an unreadable row is said amber with the server\'s detail, before the shadow record', () => {
    expect(laneArmLines(row({ stored: 'unreadable', detail: 'disk I/O error' }), ROSTER_CARD_SHADOW_LOG)).toEqual([
      { text: `${T.unreadable} (disk I/O error)`, tone: 'warn' },
      { text: T.shadowLog(ROSTER_CARD_SHADOW_LOG), tone: 'note' },
    ]);
  });
});

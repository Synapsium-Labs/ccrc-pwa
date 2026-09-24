// SettingsScreen (route `/settings`, centralised update management W3 —
// design 2026-09-20 §13). Task 6 lands the SHELL — the header and its back
// control — because the route's own pin (app.test.tsx) needs the screen's
// heading; Tasks 7–10 append one describe each for the sections they add,
// merging their names into the import lines below.
//
// The idiom is accounts-screen.test.tsx's: the FULL afterEach (:46-51) —
// cleanup, restoreAllMocks, the route back to '/', and the fleet store reset —
// because a later section spies on `api` and reads the store, and dropping any
// one of the four leaks state into the next case. CSS is asserted by scraping
// fleet.css through test/cssRule.ts: vitest runs with `css: false`, so jsdom
// evaluates no stylesheet and no computed style can carry a claim.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { BuildInfo } from '../../shared/buildinfo';
import type {
  CatalogueState, IntentWriteAnswer, NodeWire, NotifyMode, ReleaseWire, UpdateIntentWire, UpdatesView,
} from '../../shared/api';
import { AUTO_MODES, FLEET_SCOPE, NOTIFY_MODES, UPDATE_GATE_CAP } from '../../shared/api';
import { LOOPBACK_HOSTS } from '../../shared/base-url';
import {
  ACK_UNREADABLE_TEXT, AUTO_LABELS, CHANNEL_SENTENCES, MACOS_UNMANAGED_TEXT, NOTIFY_LABELS, SettingsScreen,
  UNARMED_EXPOSURE_TEXT, UNCONFIRMED_TEXT, autoGateMissing, canAck, catalogueLine, catalogueReasonText, clockTime,
  currentIsAmber, currentText, dayClock, nodeStateLine, reachabilityLine, refusedLine, releaseDate,
  releaseDirection, requestLine, sortReleases, unarmedExposure, verifiedAt,
} from '../src/screens/SettingsScreen';
import { navigate } from '../src/lib/router';
import { useFleetStore } from '../src/stores/fleet';
import { ApiError, MOVE_DISABLED_TEXT, api, updateErrorText } from '../src/lib/api';
import { ToastHost } from '../src/components/Toast';
import { declValue, ruleIn } from './cssRule';

const fleetCss = readFileSync(path.join(import.meta.dirname, '..', 'src', 'fleet', 'fleet.css'), 'utf8');

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  navigate('/');
  act(() => useFleetStore.setState({ sessions: [], conn: 'connecting', notices: [], blocked: false }));
});

describe('SettingsScreen — the shell', () => {
  it('titles itself Settings, as the one level-1 heading', () => {
    render(<SettingsScreen />);
    expect(screen.getByRole('heading', { level: 1, name: /^settings$/i })).toBeInTheDocument();
  });

  it('has a back affordance that returns to the fleet', () => {
    // Starts ON /settings, so the assertion cannot pass by the route never
    // having moved (accounts-screen.test.tsx's own back case starts on '/').
    navigate('/settings');
    render(<SettingsScreen />);
    fireEvent.click(screen.getByRole('button', { name: /back to fleet/i }));
    expect(location.pathname).toBe('/');
  });
});

describe('SettingsScreen — tap targets and the header door', () => {
  it('.settings-back is at least one tap square, off the shared token', () => {
    expect(declValue(ruleIn(fleetCss, '.settings-back'), 'min-height')).toBe('var(--tap-min)');
    expect(declValue(ruleIn(fleetCss, '.settings-back'), 'min-width')).toBe('var(--tap-min)');
  });

  it('.settings-back is the class the rendered back button carries', () => {
    render(<SettingsScreen />);
    expect(screen.getByRole('button', { name: /back to fleet/i })).toHaveClass('settings-back');
  });

  it('.settings-door is at least one tap tall, off the shared token', () => {
    // The render half — a real element still carries the class — is the
    // fleet-screen.test.tsx door case, where the door is mounted.
    expect(declValue(ruleIn(fleetCss, '.settings-door'), 'min-height')).toBe('var(--tap-min)');
  });

  it('.settings-bell-row .bell is at least one tap square, off the shared token — the CONTROL, not just the row (F2)', () => {
    // The row's own min-height (:74 above) added the button no tap area: the
    // caption span beside it is not a <label> for it, so the row's height and
    // the control's own hit area were two different things. Pinned on the
    // control itself, per test/cssRule.ts.
    expect(declValue(ruleIn(fleetCss, '.settings-bell-row .bell'), 'min-width')).toBe('var(--tap-min)');
    expect(declValue(ruleIn(fleetCss, '.settings-bell-row .bell'), 'min-height')).toBe('var(--tap-min)');
  });

  it("wraps the fleet head's right group rather than overflowing it, by specificity", () => {
    // D-3303: the group's four steady-state items
    // leave ~38px at 390px (fleet.css's Chromium-measured width note above
    // `.fleet-runs-line`), and a fifth, labelled door cannot fit that. The
    // override must OUT-SPECIFY `.fleet-head-right` rather than restate it —
    // the cascade trap fleet-css.test.ts documents at the class chooser.
    const spec = (sel: string): number =>
      (sel.match(/\.[A-Za-z0-9_-]+|\[[^\]]*\]|:[a-z-]+/g) ?? []).length;
    const override = ruleIn(fleetCss, '.fleet-head > .fleet-head-right');
    expect(declValue(override, 'flex-wrap')).toBe('wrap');
    expect(declValue(override, 'justify-content')).toBe('flex-end');
    expect(spec('.fleet-head > .fleet-head-right')).toBeGreaterThan(spec('.fleet-head-right'));
    // Non-vacuity: wrapping means something only on a flex container, and the
    // base rule must still be the one that makes it one.
    expect(declValue(ruleIn(fleetCss, '.fleet-head-right'), 'display')).toBe('flex');
  });
});

// ── Task 7: the Updates section (design 2026-09-20 §13, §18) ─────────────────
// Fixtures carry the t7 prefix and stay module-level only because both
// describes read them: Tasks 8–10 keep their own, so no case here couples to a
// shape another task's cases own.
const T7_FLEET_ID = '0f0e0d0c-0b0a-4908-8706-050403020100';
const T7_SERVER_ID = '1f1e1d1c-1b1a-4918-9716-151413121110';
/** A full NodeWire (W2 Task 1), measured and settled, WITHOUT the gate word — every W2 node's caps. */
const t7Node = (over: Partial<NodeWire> = {}): NodeWire => ({
  nodeId: T7_FLEET_ID, role: 'fleet', label: 'fleet', os: 'linux',
  current: { sha: 'a'.repeat(40), ref: 'main', builtAt: '2026-09-23T12:00:00Z', dirty: false, version: 'v0.0.9' },
  stampRead: 'ok', installState: 'complete', provenance: 'verified',
  caps: ['verify', 'node-id', 'floor'], agentOps: [], highestVersion: 'v0.0.9', previousVersion: null,
  floorRead: 'measured', previousRead: 'absent',
  measuredAt: 1_000, reachable: true, unreachableSince: null,
  channel: 'stable', desiredTag: 'v0.0.9', resolveDetail: null, request: null, report: null,
  update: { state: 'idle', target: null, startedAt: null, detail: null },
  ...over,
});
const t7Server = (over: Partial<NodeWire> = {}): NodeWire =>
  t7Node({ nodeId: T7_SERVER_ID, role: 'server', label: 'server', agentOps: null, ...over });
const T7_GATED = ['verify', 'node-id', 'floor', UPDATE_GATE_CAP];
const t7Intent = (over: Partial<UpdateIntentWire> = {}): UpdateIntentWire => ({
  scope: FLEET_SCOPE, channel: 'stable', pinnedTag: null, auto: 'off', notify: 'channel', setAt: 1_000, setBy: 'test',
  ...over,
});
/** Checked 4 min 5 s before the call — "checked 4m ago" for the length of any case. */
const t7View = (over: Partial<UpdatesView> = {}): UpdatesView => ({
  catalogue: { lastOkAt: Date.now() - (4 * 60_000 + 5_000), lastError: null },
  releases: [],
  nodes: [t7Node(), t7Server()],
  intent: [t7Intent()],
  ...over,
});
/** 14:02 on 23 Sep 2026, LOCAL time — the clock the amber line prints, whatever zone the suite runs in; the helper cases pass their own `now`. */
const T7_1402 = new Date(2026, 8, 23, 14, 2).getTime();
/** 14:02 on the day the suite RUNS, local time. The rendering cases read the real clock (`useNow`), and the
 *  amber line dates an instant off the viewer's day (`dayClock`), so their fixed stamps must fall on today to
 *  print a bare `14:02` — T7_1402 there would print `14:02 · 23 Sep` on every other day. */
const T7_TODAY_1402 = (() => { const d = new Date(); d.setHours(14, 2, 0, 0); return d.getTime(); })();
/** Task 5's `rate-limited` sentence: a request went out, not that it landed. */
const T7_ASKED = 'GitHub was asked too recently — try again in a few minutes.';
const T7_NOT_CONFIGURED = 'This box has no update control plane — it runs without a coordination database.';
const T7_UNREAD = 'The update plane could not be read — the screen tries again every minute.';
const T7_STALE = 'The latest read failed — this is the last answer that landed.';
const T7_GATE_NOTE = 'Auto-install needs the rollback gate on every node — not yet on: ';
/** Mount the screen (beside a toast host) over one answer; resolves once the Updates section has its controls. */
const t7Mount = async (view: UpdatesView): Promise<HTMLElement> => {
  vi.spyOn(api, 'updates').mockResolvedValue(view);
  render(<><ToastHost /><SettingsScreen /></>);
  const region = screen.getByRole('region', { name: 'Updates' });
  await within(region).findByRole('button', { name: 'Check now' });
  return region;
};

describe('SettingsScreen — Updates: helpers (W3 Task 7)', () => {
  it('clockTime is the local 24-hour clock, zero-padded; a time Date cannot place is the missing mark', () => {
    expect(clockTime(T7_1402)).toBe('14:02');
    expect(clockTime(new Date(2026, 8, 23, 9, 5).getTime())).toBe('09:05');
    expect(clockTime(new Date(2026, 8, 23, 0, 0).getTime())).toBe('00:00');
    expect(clockTime(Number.NaN)).toBe('—');
  });

  it('dayClock is the bare clock on the viewer\'s own day and a dated clock off it — midnight and a day-long outage included', () => {
    expect(dayClock(T7_1402, T7_1402 + 9 * 3_600_000), 'same day, later').toBe('14:02');
    expect(dayClock(T7_1402, T7_1402 + 26 * 3_600_000), 'the next day').toBe('14:02 · 23 Sep');
    expect(dayClock(new Date(2026, 8, 23, 23, 50).getTime(), new Date(2026, 8, 24, 0, 10).getTime()), 'twenty minutes, across midnight')
      .toBe('23:50 · 23 Sep');
    expect(dayClock(T7_1402, new Date(2027, 8, 23, 15, 0).getTime()), 'the same date a year on is not today').toBe('14:02 · 23 Sep');
    expect(dayClock(Number.NaN, T7_1402)).toBe('—');
    // The wire only guards Number.isFinite (asUpdatesView); a magnitude this
    // build's Date cannot place (review R-b) is the missing mark too, not a
    // thrown exception or a silently wrong day.
    expect(dayClock(1e20, T7_1402)).toBe('—');
  });

  it('catalogueReasonText names each CatalogueErrorReason, reads http-NNN, and shows any other word as it came', () => {
    expect(catalogueReasonText('no-egress')).toBe('no network route to GitHub');
    expect(catalogueReasonText('rate-limited')).toBe('rate limited');
    expect(catalogueReasonText('malformed')).toBe('an answer this build could not read');
    expect(catalogueReasonText('no-release-source')).toBe('no release source configured');
    expect(catalogueReasonText('redirect')).toBe('a redirect this build will not follow');
    expect(catalogueReasonText('http-502')).toBe('HTTP 502');
    expect(catalogueReasonText('http-304')).toBe('HTTP 304');
    expect(catalogueReasonText('http-5020'), 'not a status code').toBe('http-5020');
    expect(catalogueReasonText('teapot')).toBe('teapot');
    expect(catalogueReasonText('toString'), 'own keys only').toBe('toString');
  });

  it('catalogueLine — checked, the two amber forms, never checked (spec §13, D-3306)', () => {
    expect(catalogueLine({ lastOkAt: T7_1402, lastError: null }, T7_1402 + 4 * 60_000 + 5_000))
      .toEqual({ text: 'checked 4m ago', tone: 'calm' });
    // A lastOkAt in the viewer's future (clock skew) is "moments", never a minus.
    expect(catalogueLine({ lastOkAt: T7_1402, lastError: null }, T7_1402 - 60_000))
      .toEqual({ text: 'checked moments ago', tone: 'calm' });
    // Reached at 14:02, failing since: "since" names the last good answer, which is measured.
    expect(catalogueLine({ lastOkAt: T7_1402, lastError: { at: T7_1402 + 90 * 60_000, reason: 'rate-limited' } }, T7_1402 + 91 * 60_000))
      .toEqual({ text: "couldn't reach GitHub since 14:02 — rate limited", tone: 'amber' });
    // Failing for 26 h: the clock carries its day, or "since 14:02" reads as
    // today's and makes a day-long outage look like two hours.
    expect(catalogueLine({ lastOkAt: T7_1402, lastError: { at: T7_1402 + 25 * 3_600_000, reason: 'no-egress' } }, T7_1402 + 26 * 3_600_000))
      .toEqual({ text: "couldn't reach GitHub since 14:02 · 23 Sep — no network route to GitHub", tone: 'amber' });
    // Never reached: no "since" it cannot measure — W2 keeps only the latest failure.
    expect(catalogueLine({ lastOkAt: null, lastError: { at: T7_1402, reason: 'no-egress' } }, T7_1402 + 60_000))
      .toEqual({ text: "couldn't reach GitHub (tried 14:02) — no network route to GitHub", tone: 'amber' });
    expect(catalogueLine({ lastOkAt: null, lastError: null }, T7_1402)).toEqual({ text: 'never checked', tone: 'muted' });
  });

  it('catalogueLine treats a lastOkAt this build\'s Date cannot place as UNMEASURED, never a "checked"/"since —" (review R-b)', () => {
    // asUpdatesView only guards Number.isFinite — 1e20 is finite and would
    // reach here over the wire, and new Date(1e20) is Invalid Date. Read as
    // null, exactly as an absent lastOkAt is: never-checked with no failure,
    // and the lastOkAt-null "tried" amber form with one, never "since —".
    expect(catalogueLine({ lastOkAt: 1e20, lastError: null }, T7_1402))
      .toEqual({ text: 'never checked', tone: 'muted' });
    expect(catalogueLine({ lastOkAt: 1e20, lastError: { at: T7_1402, reason: 'no-egress' } }, T7_1402 + 60_000))
      .toEqual({ text: "couldn't reach GitHub (tried 14:02) — no network route to GitHub", tone: 'amber' });
  });

  it('catalogueLine never says "checked" or "up to date" while lastOkAt is null (spec §18 "unreachable is not current")', () => {
    const unreached: CatalogueState[] = [
      { lastOkAt: null, lastError: null },
      ...['no-egress', 'rate-limited', 'http-503', 'malformed', 'no-release-source', 'redirect']
        .map((reason) => ({ lastOkAt: null, lastError: { at: T7_1402, reason } })),
    ];
    expect(unreached, 'guards the guard').toHaveLength(7);
    for (const c of unreached) {
      const { text, tone } = catalogueLine(c, T7_1402 + 60_000);
      expect(text, JSON.stringify(c)).not.toMatch(/^checked\b/);
      expect(text, JSON.stringify(c)).not.toMatch(/up to date/i);
      expect(tone, JSON.stringify(c)).not.toBe('calm');
    }
  });

  it('autoGateMissing lists every node whose measured caps lack the gate word, in wire order — a placeholder included', () => {
    const gated = t7Node({ caps: T7_GATED });
    const ungated = t7Server();
    // markUnreachable's label-keyed placeholder: never measured, no caps. §9
    // is written about exactly this node, and autoGateBlockers counts it too.
    // Its shape is W2 Task 5's markUnreachable: measuredAt NULL, stampRead
    // 'unreadable', installState/provenance/os 'unknown', caps '', floorRead/previousRead
    // 'unmeasured' (highestVersion NULL).
    const placeholder = t7Node({
      nodeId: 'fleet', measuredAt: null, reachable: false, unreachableSince: 1_000, caps: [], current: null,
      stampRead: 'unreadable', installState: 'unknown', provenance: 'unknown', os: 'unknown',
      highestVersion: null, floorRead: 'unmeasured', previousRead: 'unmeasured', desiredTag: null,
    });
    expect(autoGateMissing([gated, ungated, placeholder]).map((n) => n.nodeId)).toEqual([T7_SERVER_ID, 'fleet']);
    expect(autoGateMissing([gated, t7Server({ caps: T7_GATED })])).toEqual([]);
    expect(autoGateMissing([])).toEqual([]);
    // A caps STRING would answer `.includes` by substring and read as gated.
    const malformed = { ...gated, caps: UPDATE_GATE_CAP } as unknown as NodeWire;
    expect(autoGateMissing([malformed])).toEqual([malformed]);
  });
});

describe('SettingsScreen — Updates: rendering (design 2026-09-20 §13)', () => {
  it('shows a loading block, and no control, until the first poll lands', () => {
    vi.spyOn(api, 'updates').mockReturnValue(new Promise(() => {}));
    render(<SettingsScreen />);
    const region = screen.getByRole('region', { name: 'Updates' });
    expect(within(region).getByRole('status', { name: 'Loading' })).toBeInTheDocument();
    expect(within(region).queryByRole('radio')).toBeNull();
    expect(within(region).queryByRole('button', { name: 'Check now' })).toBeNull();
  });

  it('renders "checked 4m ago" in the calm style', async () => {
    const region = await t7Mount(t7View());
    const line = within(region).getByText('checked 4m ago');
    expect(line).toHaveClass('settings-catalogue');
    expect(line).not.toHaveClass('settings-catalogue--amber');
    expect(line).not.toHaveClass('settings-catalogue--muted');
  });

  it('renders a catalogue that stopped answering in amber — never the calm line it answered with before', async () => {
    const region = await t7Mount(t7View({
      catalogue: { lastOkAt: T7_TODAY_1402, lastError: { at: T7_TODAY_1402 + 90 * 60_000, reason: 'rate-limited' } },
    }));
    expect(within(region).getByText("couldn't reach GitHub since 14:02 — rate limited")).toHaveClass('settings-catalogue', 'settings-catalogue--amber');
    expect(within(region).queryByText(/^checked\b/)).toBeNull();
  });

  it('renders a catalogue never reached in amber with the time it was tried, and no "checked" line (§18)', async () => {
    const region = await t7Mount(t7View({ catalogue: { lastOkAt: null, lastError: { at: T7_TODAY_1402, reason: 'no-egress' } } }));
    expect(within(region).getByText("couldn't reach GitHub (tried 14:02) — no network route to GitHub")).toHaveClass('settings-catalogue--amber');
    expect(within(region).queryByText(/^checked\b/)).toBeNull();
    expect(within(region).queryByText(/up to date/i)).toBeNull();
  });

  it('renders "never checked" in the muted style when nothing was ever reached — never a "checked" line (§18)', async () => {
    const region = await t7Mount(t7View({ catalogue: { lastOkAt: null, lastError: null } }));
    expect(within(region).getByText('never checked')).toHaveClass('settings-catalogue', 'settings-catalogue--muted');
    expect(within(region).queryByText(/^checked\b/)).toBeNull();
    expect(within(region).queryByText(/up to date/i)).toBeNull();
  });

  it('checks the channel and auto radios the FLEET row names, not the first intent row', async () => {
    const region = await t7Mount(t7View({
      intent: [t7Intent({ scope: T7_FLEET_ID, channel: 'dev', auto: 'channel' }), t7Intent({ channel: 'stable', auto: 'off' })],
    }));
    expect(within(region).getByRole('radio', { name: CHANNEL_SENTENCES.stable })).toBeChecked();
    expect(within(region).getByRole('radio', { name: CHANNEL_SENTENCES.dev })).not.toBeChecked();
    expect(within(region).getByRole('radio', { name: AUTO_LABELS.off })).toBeChecked();
    expect(within(region).getByRole('radio', { name: AUTO_LABELS.channel })).not.toBeChecked();
  });

  it('checks nothing when the fleet row is absent — never a default the server does not hold', async () => {
    const region = await t7Mount(t7View({ intent: [t7Intent({ scope: T7_FLEET_ID, channel: 'dev' })] }));
    for (const radio of within(region).getAllByRole('radio')) expect(radio).not.toBeChecked();
    expect(within(region).getAllByRole('radio')).toHaveLength(5);
  });

  it('a tap on the other channel sends {scope: "*", channel} once and re-polls — the radio moves only when the server says so', async () => {
    const updates = vi.spyOn(api, 'updates').mockResolvedValue(t7View());
    const set = vi.spyOn(api, 'setUpdateIntent').mockResolvedValue({ ok: true, intent: t7Intent({ channel: 'dev' }), epoch: 2 });
    render(<SettingsScreen />);
    const dev = await screen.findByRole('radio', { name: CHANNEL_SENTENCES.dev });
    fireEvent.click(dev);
    await waitFor(() => expect(updates).toHaveBeenCalledTimes(2));
    expect(set).toHaveBeenCalledTimes(1);
    expect(set).toHaveBeenCalledWith({ scope: FLEET_SCOPE, channel: 'dev' });
    // The re-poll still answers stable (the stub never changes), so the screen
    // shows stable: the server's row, not the tap.
    expect(screen.getByRole('radio', { name: CHANNEL_SENTENCES.stable })).toBeChecked();
    expect(dev).not.toBeChecked();
    // `.finally` clears busy and re-polls in one callback; the call count can
    // be seen before React has committed the cleared busy, so wait for it.
    await waitFor(() => expect(screen.getByRole('group', { name: 'Channel' })).not.toBeDisabled());
  });

  it('a write whose answer is unreadable toasts that it is unconfirmed; a refusal toasts the update sentence as an error', async () => {
    vi.spyOn(api, 'updates').mockResolvedValue(t7View());
    const set = vi.spyOn(api, 'setUpdateIntent')
      .mockResolvedValueOnce('unreadable')
      .mockRejectedValueOnce(new ApiError(503, { ok: false, error: 'journal-unwritable', detail: 'the intent journal could not be written — see the server log' }));
    render(<><ToastHost /><SettingsScreen /></>);
    fireEvent.click(await screen.findByRole('radio', { name: CHANNEL_SENTENCES.dev }));
    expect(await screen.findByText("Saved — the server's answer could not be read; the screen will re-check.")).toBeInTheDocument();
    expect(document.querySelector('.toast--error')).toBeNull();
    await waitFor(() => expect(screen.getByRole('group', { name: 'Channel' })).not.toBeDisabled());
    fireEvent.click(screen.getByRole('radio', { name: CHANNEL_SENTENCES.dev }));
    await waitFor(() => expect(document.querySelector('.toast--error'))
      .toHaveTextContent('The server cannot write its intent journal — nothing was changed.'));
    expect(set).toHaveBeenCalledTimes(2);
  });

  it('disables the non-off auto-install radios (off stays enabled) and names every node without the gate word (D-3297, D-3315)', async () => {
    const region = await t7Mount(t7View());   // neither node carries it — every W2 node
    const auto = within(region).getByRole('group', { name: 'Auto-install' });
    // The route accepts `auto: 'off'` unconditionally (D-3315): the fieldset
    // itself is not disabled — only the two non-off radios are — so the one
    // safe action stays reachable while the gate is incomplete.
    expect(auto).not.toBeDisabled();
    expect(within(auto).getByRole('radio', { name: AUTO_LABELS.off })).not.toBeDisabled();
    for (const m of AUTO_MODES.filter((mode) => mode !== 'off')) {
      expect(within(auto).getByRole('radio', { name: AUTO_LABELS[m] })).toBeDisabled();
    }
    expect(within(region).getByText(`${T7_GATE_NOTE}fleet, server`)).toHaveClass('settings-note');
    expect(auto).toHaveAccessibleDescription(`${T7_GATE_NOTE}fleet, server`);
    // Only the non-off auto choices are gated: the channel and Check now stay live.
    expect(within(region).getByRole('group', { name: 'Channel' })).not.toBeDisabled();
    expect(within(region).getByRole('button', { name: 'Check now' })).not.toBeDisabled();
  });

  it('with the gate missing, tapping "off" still writes it — the route accepts auto: "off" unconditionally (D-3315)', async () => {
    const set = vi.spyOn(api, 'setUpdateIntent').mockResolvedValue({ ok: true, intent: t7Intent({ auto: 'off' }), epoch: 4 });
    const region = await t7Mount(t7View({ intent: [t7Intent({ channel: 'stable', auto: 'stable' })] }));
    const auto = within(region).getByRole('group', { name: 'Auto-install' });
    const off = within(auto).getByRole('radio', { name: AUTO_LABELS.off });
    expect(off).not.toBeDisabled();
    fireEvent.click(off);
    await waitFor(() => expect(set).toHaveBeenCalledTimes(1));
    expect(set).toHaveBeenCalledWith({ scope: FLEET_SCOPE, auto: 'off' });
  });

  it('names only the nodes that lack the word', async () => {
    const region = await t7Mount(t7View({ nodes: [t7Node({ caps: T7_GATED }), t7Server()] }));
    const auto = within(region).getByRole('group', { name: 'Auto-install' });
    expect(within(auto).getByRole('radio', { name: AUTO_LABELS.stable })).toBeDisabled();
    expect(within(auto).getByRole('radio', { name: AUTO_LABELS.off })).not.toBeDisabled();
    expect(within(region).getByText(`${T7_GATE_NOTE}server`)).toBeInTheDocument();
  });

  it('enables auto-install when every node carries the word, and a tap sends {scope: "*", auto}', async () => {
    const set = vi.spyOn(api, 'setUpdateIntent').mockResolvedValue({ ok: true, intent: t7Intent({ auto: 'stable' }), epoch: 3 });
    const region = await t7Mount(t7View({ nodes: [t7Node({ caps: T7_GATED }), t7Server({ caps: T7_GATED })] }));
    const auto = within(region).getByRole('group', { name: 'Auto-install' });
    expect(auto).not.toBeDisabled();
    expect(within(region).queryByText(/not yet on:/)).toBeNull();
    fireEvent.click(within(auto).getByRole('radio', { name: AUTO_LABELS.stable }));
    await waitFor(() => expect(set).toHaveBeenCalledTimes(1));
    expect(set).toHaveBeenCalledWith({ scope: FLEET_SCOPE, auto: 'stable' });
  });

  it('renders a 409 auto-needs-rollback-gate by node label — an id no row carries shown as the id — and not as a toast', async () => {
    vi.spyOn(api, 'setUpdateIntent').mockRejectedValue(
      new ApiError(409, { ok: false, error: 'auto-needs-rollback-gate', nodes: [T7_SERVER_ID, 'gone-node-id'] }));
    const region = await t7Mount(t7View({ nodes: [t7Node({ caps: T7_GATED }), t7Server({ caps: T7_GATED })] }));
    fireEvent.click(within(region).getByRole('radio', { name: AUTO_LABELS.channel }));
    expect(await within(region).findByText(`${T7_GATE_NOTE}server, gone-node-id`)).toHaveClass('settings-note');
    expect(document.querySelector('.toast--error')).toBeNull();
  });

  it("a 409's stale node list does not outlive the poll that answers it — a LATER poll showing the node now carries the word clears the note (F5)", async () => {
    // Before: the fleet node lacks the gate word (the CHANNEL fieldset is not
    // gated on it, so the radio stays clickable). After: a genuinely later,
    // distinct poll answer — the write's own reload — shows it now carries
    // the word. The 409's list must not outlive that: the note is gone, even
    // though nothing else about the fleet changed.
    const before = t7View({ nodes: [t7Node({ caps: ['verify', 'node-id', 'floor'] }), t7Server({ caps: T7_GATED })] });
    const after = t7View({ nodes: [t7Node({ caps: T7_GATED }), t7Server({ caps: T7_GATED })] });
    vi.spyOn(api, 'updates').mockResolvedValueOnce(before).mockResolvedValue(after);
    vi.spyOn(api, 'setUpdateIntent').mockRejectedValue(
      new ApiError(409, { ok: false, error: 'auto-needs-rollback-gate', nodes: [T7_FLEET_ID] }));
    render(<><ToastHost /><SettingsScreen /></>);
    const region = await screen.findByRole('region', { name: 'Updates' });
    await within(region).findByText(`${T7_GATE_NOTE}fleet`);
    fireEvent.click(within(region).getByRole('radio', { name: CHANNEL_SENTENCES.dev }));
    // The write's own reload fetches `after` — a fresh, distinct poll where
    // the fleet node now carries update-gate — and supersedes the stale 409
    // list rather than outliving it.
    await waitFor(() => expect(within(region).queryByText(/not yet on:/)).toBeNull());
  });

  it('a 409 auto-needs-rollback-gate naming an EMPTY node list falls back to the route\'s own toast, not an empty "not yet on:" note', async () => {
    vi.spyOn(api, 'setUpdateIntent').mockRejectedValue(
      new ApiError(409, { ok: false, error: 'auto-needs-rollback-gate', nodes: [] }));
    const region = await t7Mount(t7View({ nodes: [t7Node({ caps: T7_GATED }), t7Server({ caps: T7_GATED })] }));
    fireEvent.click(within(region).getByRole('radio', { name: AUTO_LABELS.channel }));
    await waitFor(() => expect(document.querySelector('.toast--error'))
      .toHaveTextContent('Auto-install needs the rollback gate on every node, and at least one does not carry it yet.'));
    expect(within(region).queryByText(/not yet on:/)).toBeNull();
  });

  it('a 409 auto-needs-rollback-gate naming only NON-STRING ids falls back to the route\'s own toast', async () => {
    vi.spyOn(api, 'setUpdateIntent').mockRejectedValue(
      new ApiError(409, { ok: false, error: 'auto-needs-rollback-gate', nodes: [42] }));
    const region = await t7Mount(t7View({ nodes: [t7Node({ caps: T7_GATED }), t7Server({ caps: T7_GATED })] }));
    fireEvent.click(within(region).getByRole('radio', { name: AUTO_LABELS.channel }));
    await waitFor(() => expect(document.querySelector('.toast--error'))
      .toHaveTextContent('Auto-install needs the rollback gate on every node, and at least one does not carry it yet.'));
    expect(within(region).queryByText(/not yet on:/)).toBeNull();
  });

  it('Check now refreshes once and re-polls; a 429 says GitHub was asked too recently', async () => {
    const updates = vi.spyOn(api, 'updates').mockResolvedValue(t7View());
    const refresh = vi.spyOn(api, 'refreshUpdates')
      .mockResolvedValueOnce({ lastOkAt: Date.now(), lastError: null })
      .mockRejectedValueOnce(new ApiError(429, { ok: false, error: 'rate-limited', retryAfterS: 42 }));
    render(<SettingsScreen />);
    const check = await screen.findByRole('button', { name: 'Check now' });
    fireEvent.click(check);
    await waitFor(() => expect(updates).toHaveBeenCalledTimes(2));
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(refresh).toHaveBeenCalledWith();
    expect(screen.queryByText(T7_ASKED)).toBeNull();
    await waitFor(() => expect(check).not.toBeDisabled());
    fireEvent.click(check);
    expect(await screen.findByText(T7_ASKED)).toHaveClass('settings-note');
    expect(refresh).toHaveBeenCalledTimes(2);
  });

  it('a 429 over a catalogue never reached claims only a request — no "checked" text anywhere in the section (§18)', async () => {
    // W2 answers 429 inside REFRESH_MIN_INTERVAL_MS (derived, D-3218) of lastRequestAt(), which a FAILED
    // scheduled poll sets too (D-3203): this is a tap just after one.
    vi.spyOn(api, 'refreshUpdates')
      .mockRejectedValue(new ApiError(429, { ok: false, error: 'rate-limited', retryAfterS: 42 }));
    const region = await t7Mount(t7View({ catalogue: { lastOkAt: null, lastError: { at: T7_TODAY_1402, reason: 'no-egress' } } }));
    fireEvent.click(within(region).getByRole('button', { name: 'Check now' }));
    expect(await within(region).findByText(T7_ASKED)).toHaveClass('settings-note');
    expect(within(region).getByText("couldn't reach GitHub (tried 14:02) — no network route to GitHub")).toHaveClass('settings-catalogue--amber');
    expect(within(region).queryByText(/^checked\b/)).toBeNull();
    expect(within(region).queryByText(/\bchecked\b/), 'nor a "checked" inside another sentence').toBeNull();
    expect(within(region).queryByText(/up to date/i)).toBeNull();
  });

  it('a box with no control plane says so, and nothing else of the section renders', async () => {
    vi.spyOn(api, 'updates').mockRejectedValue(new ApiError(501, { ok: false, error: 'not-configured' }));
    render(<SettingsScreen />);
    const region = screen.getByRole('region', { name: 'Updates' });
    expect(await within(region).findByText(T7_NOT_CONFIGURED)).toHaveClass('settings-note');
    expect(within(region).queryByRole('radio')).toBeNull();
    expect(within(region).queryByRole('button')).toBeNull();
    expect(within(region).queryByRole('status', { name: 'Loading' })).toBeNull();
  });

  it('a first read that failed says so instead of loading forever', async () => {
    vi.spyOn(api, 'updates').mockRejectedValue(new TypeError('Failed to fetch'));
    render(<SettingsScreen />);
    const region = screen.getByRole('region', { name: 'Updates' });
    expect(await within(region).findByText(T7_UNREAD)).toBeInTheDocument();
    expect(within(region).queryByText(T7_NOT_CONFIGURED)).toBeNull();
    expect(within(region).queryByRole('status', { name: 'Loading' })).toBeNull();
  });

  it('a later read that fails keeps the last answer on screen and says it is stale', async () => {
    vi.spyOn(api, 'updates').mockResolvedValueOnce(t7View()).mockRejectedValueOnce(new TypeError('Failed to fetch'));
    vi.spyOn(api, 'refreshUpdates').mockResolvedValue({ lastOkAt: Date.now(), lastError: null });
    render(<SettingsScreen />);
    fireEvent.click(await screen.findByRole('button', { name: 'Check now' }));   // its reload() is the failing read
    expect(await screen.findByText(T7_STALE)).toHaveClass('settings-note');
    expect(screen.getByRole('radio', { name: CHANNEL_SENTENCES.stable })).toBeChecked();
    expect(screen.getByText('checked 4m ago')).toBeInTheDocument();
  });

  it('floors every option row at the tap target, keeps a fieldset shrinkable, and tints the amber line with the attention ink', () => {
    const css = readFileSync(path.join(import.meta.dirname, '..', 'src', 'fleet', 'fleet.css'), 'utf8');
    expect(declValue(ruleIn(css, '.settings-option'), 'min-height')).toBe('var(--tap-min)');
    expect(declValue(ruleIn(css, '.settings-fieldset'), 'min-width')).toBe('0');
    expect(declValue(ruleIn(css, '.settings-catalogue--amber'), 'color')).toBe('var(--status-attention-text)');
  });
});

// ── Task 8: the release list (design 2026-09-20 §13, §18) ────────────────────
// Fixtures are local to these two describes on purpose: Tasks 7, 9 and 10 each
// keep their own, and a shared `node()` would couple four tasks' cases to one
// shape nobody owns.
const T8_T0 = Date.UTC(2026, 8, 23, 12, 0, 0);
const T8_NODE_A = '11111111-1111-4111-8111-111111111111';
const T8_NODE_B = '22222222-2222-4222-8222-222222222222';
/** A stamp at `version`; `undefined` = an unversioned (deploy.sh) build — the key is ABSENT, as the parser leaves it. */
const t8Stamp = (version: string | undefined): BuildInfo => ({
  sha: 'a'.repeat(40), ref: 'main', builtAt: '2026-09-23T12:00:00Z', dirty: false,
  ...(version === undefined ? {} : { version }),
});
/** A full NodeWire, every field W2 Task 1 declares, measured and settled. */
const t8Node = (over: Partial<NodeWire> = {}): NodeWire => ({
  nodeId: T8_NODE_A, role: 'fleet', label: 'fleet', os: 'linux',
  current: t8Stamp('v0.0.9'), stampRead: 'ok', installState: 'complete', provenance: 'verified',
  caps: ['verify', 'node-id', 'floor', 'update-gate'], agentOps: [], highestVersion: 'v0.0.9', previousVersion: null,
  floorRead: 'measured', previousRead: 'absent',
  measuredAt: T8_T0, reachable: true, unreachableSince: null,
  channel: 'stable', desiredTag: 'v0.0.9', resolveDetail: null,
  request: null, report: null,
  update: { state: 'idle', target: null, startedAt: null, detail: null },
  ...over,
});
const t8Server = (over: Partial<NodeWire> = {}): NodeWire =>
  t8Node({ nodeId: T8_NODE_B, role: 'server', label: 'server', agentOps: null, ...over });
/** A full ReleaseWire; `version` is the tag (W2 Task 4: `version = tag`). */
const t8Release = (tag: string, over: Partial<ReleaseWire> = {}): ReleaseWire => ({
  tag, version: tag, channel: 'stable', publishedAt: T8_T0, commitSha: 'c'.repeat(40),
  bundleListed: true, yanked: false, refused: [], notes: null, ...over,
});

describe('SettingsScreen — the release list: helpers', () => {
  it('sortReleases: semver order, newest first — v0.0.10 above v0.0.9 — and a non-tag row last, in wire order', () => {
    const wire = [t8Release('v0.0.9'), t8Release('vnext'), t8Release('v0.0.10'), t8Release('v0.1.0'), t8Release('v0.0.8 ')];
    expect(sortReleases(wire).map((r) => r.tag)).toEqual(['v0.1.0', 'v0.0.10', 'v0.0.9', 'vnext', 'v0.0.8 ']);
    // The input is not reordered in place: the view the poll holds is shared state.
    expect(wire.map((r) => r.tag)).toEqual(['v0.0.9', 'vnext', 'v0.0.10', 'v0.1.0', 'v0.0.8 ']);
  });

  it('verifiedAt: only a node MEASURED verified and running THAT tag — provenance alone or the tag alone is not enough', () => {
    expect(verifiedAt('v0.0.9', [t8Node()])).toBe(true);
    expect(verifiedAt('v0.0.9', [t8Node({ provenance: 'unverified' }), t8Server({ provenance: 'unknown' })])).toBe(false);
    expect(verifiedAt('v0.0.9', [t8Node({ current: t8Stamp('v0.0.8') })])).toBe(false);
    expect(verifiedAt('v0.0.9', [t8Node({ current: null })])).toBe(false);
    expect(verifiedAt('v0.0.9', [])).toBe(false);
  });

  it('releaseDirection: Roll back only when EVERY node runs a newer tag, compared by semver across v0.0.9/v0.0.10', () => {
    const both10 = [t8Node({ current: t8Stamp('v0.0.10') }), t8Server({ current: t8Stamp('v0.0.10') })];
    expect(releaseDirection('v0.0.9', both10)).toBe('rollback');          // string order would call v0.0.10 older
    expect(releaseDirection('v0.0.10', both10)).toBe('install');          // equal is not newer
    expect(releaseDirection('v0.0.9', [both10[0]!, t8Server({ current: t8Stamp(undefined) })])).toBe('install');
    expect(releaseDirection('v0.0.9', [both10[0]!, t8Server({ current: null, measuredAt: null })])).toBe('install');
    expect(releaseDirection('v0.0.9', [])).toBe('install');
    expect(releaseDirection('vnext', both10)).toBe('install');           // never handed to the comparator, which throws
  });

  it('refusedLine: distinct refusing nodes out of the live count; null with no refusal; a malformed element is ignored', () => {
    const two = [t8Node(), t8Server()];
    expect(refusedLine(t8Release('v0.0.9'), two)).toBeNull();
    expect(refusedLine(t8Release('v0.0.9', { refused: [{ by: T8_NODE_A, at: T8_T0 }] }), two)).toBe('refused by 1 of 2 nodes');
    expect(refusedLine(t8Release('v0.0.9', {
      refused: [{ by: T8_NODE_A, at: T8_T0 }, { by: T8_NODE_A, at: T8_T0 + 1 }, { by: T8_NODE_B, at: T8_T0 + 2 }],
    }), two)).toBe('refused by 2 of 2 nodes');
    expect(refusedLine(t8Release('v0.0.9', { refused: [{ by: T8_NODE_A, at: T8_T0 }] }), [t8Node()])).toBe('refused by 1 of 1 node');
    expect(refusedLine(t8Release('v0.0.9', { refused: {} as unknown as ReleaseWire['refused'] }), two)).toBeNull();
    expect(refusedLine(t8Release('v0.0.9', { refused: [null, { at: 1 }] as unknown as ReleaseWire['refused'] }), two)).toBeNull();
  });

  it('releaseDate: the UTC calendar day; a time Date cannot place is the missing mark, never a throw', () => {
    expect(releaseDate(Date.UTC(2026, 8, 23, 23, 59))).toBe('2026-09-23');
    expect(releaseDate(Date.UTC(2026, 8, 24, 0, 0))).toBe('2026-09-24');
    expect(releaseDate(Number.NaN)).toBe('—');
    expect(releaseDate(1e20)).toBe('—');
    // fix round 1: a non-number (the wire never sends one, but the guard is
    // load-bearing) must not fall through to `new Date(null)`, which is the
    // valid 1970-01-01 instant, not the missing mark.
    expect(releaseDate(null as unknown as number)).toBe('—');
  });
});

describe('SettingsScreen — the release list: rendering (design 2026-09-20 §13)', () => {
  const view = (releases: ReleaseWire[], nodes: NodeWire[]): UpdatesView => ({
    catalogue: { lastOkAt: T8_T0, lastError: null },
    releases,
    nodes,
    intent: [{ scope: FLEET_SCOPE, channel: 'stable', pinnedTag: null, auto: 'off', notify: 'channel', setAt: T8_T0, setBy: 'test' }],
  });
  /** Render the screen over one answer and return the release list — every case reads INSIDE it, because the
   *  inventory (Task 9) renders the same tags as node versions on the same screen. */
  const renderList = async (releases: ReleaseWire[], nodes: NodeWire[]): Promise<HTMLElement> => {
    vi.spyOn(api, 'updates').mockResolvedValue(view(releases, nodes));
    render(<SettingsScreen />);
    return screen.findByRole('list', { name: 'Releases' });
  };
  const rowOf = (list: HTMLElement, tag: string): HTMLElement => {
    const row = list.querySelector<HTMLElement>(`li[data-tag="${tag}"]`);
    if (row === null) throw new Error(`no release row for ${tag}`);
    return row;
  };

  it('renders "verified" when a node is measured verified at that tag (§18 "bundleListed is never verified")', async () => {
    const list = await renderList([t8Release('v0.0.9')], [t8Node(), t8Server({ provenance: 'unverified' })]);
    const row = rowOf(list, 'v0.0.9');
    expect(within(row).getByText('verified')).toHaveClass('settings-badge--verified');
    expect(within(row).getByText('bundle listed')).toBeInTheDocument();
  });

  it('bundle listed alone renders "bundle listed", never "verified"', async () => {
    const list = await renderList(
      [t8Release('v0.0.9', { bundleListed: true })],
      [t8Node({ provenance: 'unverified' }), t8Server({ provenance: 'unknown' })],
    );
    const row = rowOf(list, 'v0.0.9');
    expect(within(row).getByText('bundle listed')).toBeInTheDocument();
    expect(within(row).queryByText('verified')).toBeNull();
    expect(row.querySelector('.settings-badge--verified')).toBeNull();
  });

  it('a node verified on ANOTHER tag does not verify this one', async () => {
    const list = await renderList(
      [t8Release('v0.0.9'), t8Release('v0.0.8')],
      [t8Node({ current: t8Stamp('v0.0.8') }), t8Server({ current: t8Stamp('v0.0.8'), provenance: 'unverified' })],
    );
    expect(within(rowOf(list, 'v0.0.9')).queryByText('verified')).toBeNull();
    expect(within(rowOf(list, 'v0.0.8')).getByText('verified')).toBeInTheDocument();
  });

  it('reads "refused by 1 of 2 nodes" off refused[]', async () => {
    const list = await renderList(
      [t8Release('v0.0.9', { refused: [{ by: T8_NODE_B, at: T8_T0 }] })],
      [t8Node(), t8Server()],
    );
    expect(within(rowOf(list, 'v0.0.9')).getByText('refused by 1 of 2 nodes')).toHaveClass('settings-release-refused');
  });

  it('renders notes as literal text — no markup, no image, no link (§18 "notes are capped and plain")', async () => {
    const NOTES = '<b>bold</b> <img src=x onerror=alert(1)>\nsee https://example.com/x or javascript:alert(1)';
    const list = await renderList([t8Release('v0.0.9', { notes: NOTES })], [t8Node()]);
    const row = rowOf(list, 'v0.0.9');
    const pre = row.querySelector('pre.settings-release-notes');
    expect(pre).not.toBeNull();
    expect(pre!.textContent).toBe(NOTES);
    expect(row.querySelector('b, img, a, script')).toBeNull();
    expect(within(row).queryByRole('link')).toBeNull();
    expect(within(row).queryByRole('img')).toBeNull();
  });

  it('lists v0.0.10 above v0.0.9 whatever order the wire carries (semver, never string order)', async () => {
    const list = await renderList(
      [t8Release('v0.0.9', { publishedAt: T8_T0 + 5 }), t8Release('v0.0.10', { publishedAt: T8_T0 })],
      [t8Node()],
    );
    expect(within(list).getAllByRole('listitem').map((li) => li.getAttribute('data-tag'))).toEqual(['v0.0.10', 'v0.0.9']);
  });

  it('names the move by direction: Roll back when every node runs a newer tag, Install otherwise', async () => {
    const list = await renderList(
      [t8Release('v0.0.10'), t8Release('v0.0.9')],
      [t8Node({ current: t8Stamp('v0.0.10') }), t8Server({ current: t8Stamp('v0.0.10') })],
    );
    expect(within(rowOf(list, 'v0.0.9')).getByRole('button', { name: 'Roll back' })).toBeInTheDocument();
    expect(within(rowOf(list, 'v0.0.10')).getByRole('button', { name: 'Install' })).toBeInTheDocument();
  });

  it('an unversioned node makes the move Install, never Roll back', async () => {
    const list = await renderList(
      [t8Release('v0.0.9')],
      [t8Node({ current: t8Stamp('v0.0.10') }), t8Server({ current: t8Stamp(undefined), provenance: 'unknown' })],
    );
    expect(within(rowOf(list, 'v0.0.9')).getByRole('button', { name: 'Install' })).toBeInTheDocument();
  });

  it('renders every move button DISABLED, described by the one W3 sentence (§18 "the move controls are disabled in W3")', async () => {
    const list = await renderList(
      [t8Release('v0.0.10'), t8Release('v0.0.9'), t8Release('v0.0.8', { channel: 'dev' })],
      [t8Node({ current: t8Stamp('v0.0.9') }), t8Server({ current: t8Stamp('v0.0.9') })],
    );
    const buttons = within(list).getAllByRole('button');
    expect(buttons.map((b) => b.textContent)).toEqual(['Install', 'Install', 'Roll back']);
    for (const b of buttons) {
      expect(b).toBeDisabled();
      expect(b).toHaveAccessibleDescription(MOVE_DISABLED_TEXT);
    }
    expect(within(list).getAllByText(MOVE_DISABLED_TEXT)).toHaveLength(3);
  });

  it('badges the channel (dev / stable, none for an unknown one) and marks a yanked release', async () => {
    const list = await renderList(
      [
        t8Release('v0.0.11', { channel: 'dev' }),
        t8Release('v0.0.10', { channel: 'stable', yanked: true }),
        t8Release('v0.0.9', { channel: null }),
      ],
      [t8Node({ provenance: 'unknown' })],
    );
    expect(within(rowOf(list, 'v0.0.11')).getByText('dev')).toHaveClass('settings-badge', 'settings-badge--dev');
    expect(within(rowOf(list, 'v0.0.10')).getByText('stable')).toHaveClass('settings-badge', 'settings-badge--stable');
    expect(within(rowOf(list, 'v0.0.10')).getByText('yanked')).toHaveClass('settings-badge');
    const unknown = rowOf(list, 'v0.0.9');
    expect(unknown.querySelector('.settings-badge--dev, .settings-badge--stable')).toBeNull();
    expect(within(unknown).queryByText('yanked')).toBeNull();
    expect(within(rowOf(list, 'v0.0.11')).getByText('2026-09-23')).toHaveClass('settings-release-date');
  });

  it('renders no release list when the catalogue holds no release', async () => {
    vi.spyOn(api, 'updates').mockResolvedValue(view([], [t8Node()]));
    render(<SettingsScreen />);
    await screen.findByText(/^checked /);   // Task 7's calm catalogue line: the view HAS landed, so absence is measured
    expect(screen.queryByRole('list', { name: 'Releases' })).toBeNull();
  });

  it('spells no raw-HTML path anywhere in the screen (a literal-absence pin over the source)', () => {
    const src = readFileSync(path.join(import.meta.dirname, '..', 'src', 'screens', 'SettingsScreen.tsx'), 'utf8');
    expect(src).not.toMatch(/dangerouslySetInnerHTML/);
    expect(src).not.toMatch(/\binnerHTML\b/);
  });

  it('wraps the notes block inside the phone width (a <pre> that keeps newlines and breaks a long URL)', () => {
    const css = readFileSync(path.join(import.meta.dirname, '..', 'src', 'fleet', 'fleet.css'), 'utf8');
    const rule = ruleIn(css, '.settings-release-notes');
    expect(declValue(rule, 'white-space')).toBe('pre-wrap');
    expect(declValue(rule, 'overflow-wrap')).toBe('anywhere');
  });
});

// ── Task 9: the node inventory (design 2026-09-20 §13, §18) ──────────────────
// Local fixtures on purpose, as Task 8's are: a shared module-level `node()`
// would couple four tasks' cases to one shape nobody owns.
const T9_T0 = Date.UTC(2026, 8, 23, 12, 0, 0);
const T9_NODE_A = '33333333-3333-4333-8333-333333333333';
const T9_NODE_B = '44444444-4444-4444-8444-444444444444';
const T9_MIN = 60_000;
/** A stamp at `version`; `undefined` = an unversioned (deploy.sh) build — the key is ABSENT, as the parser leaves it. */
const t9Stamp = (version: string | undefined): BuildInfo => ({
  sha: 'b'.repeat(40), ref: 'main', builtAt: '2026-09-23T12:00:00Z', dirty: false,
  ...(version === undefined ? {} : { version }),
});
/** A full NodeWire, every field W2 Task 1 declares: measured, reachable, verified, settled, and current. */
const t9Node = (over: Partial<NodeWire> = {}): NodeWire => ({
  nodeId: T9_NODE_A, role: 'fleet', label: 'fleet', os: 'linux',
  current: t9Stamp('v0.0.9'), stampRead: 'ok', installState: 'complete', provenance: 'verified',
  caps: ['verify', 'node-id', 'floor', 'update-gate'], agentOps: [], highestVersion: 'v0.0.9', previousVersion: null,
  floorRead: 'measured', previousRead: 'absent',
  measuredAt: T9_T0, reachable: true, unreachableSince: null,
  channel: 'stable', desiredTag: 'v0.0.9', resolveDetail: null,
  request: null, report: null,
  update: { state: 'idle', target: null, startedAt: null, detail: null },
  ...over,
});
const t9Server = (over: Partial<NodeWire> = {}): NodeWire =>
  t9Node({ nodeId: T9_NODE_B, role: 'server', label: 'server', agentOps: null, ...over });
const t9Release = (tag: string, over: Partial<ReleaseWire> = {}): ReleaseWire => ({
  tag, version: tag, channel: 'stable', publishedAt: T9_T0, commitSha: 'd'.repeat(40),
  bundleListed: true, yanked: false, refused: [], notes: null, ...over,
});
/** A label placeholder exactly as W2's markUnreachable writes one: keyed by its LABEL (no node-id file was ever
 *  read), never measured, stamp unreadable, unknowns, caps empty, agentOps null for a non-fleet role. */
const t9Placeholder = (over: Partial<NodeWire> = {}): NodeWire => t9Server({
  nodeId: 'server', measuredAt: null, current: null, stampRead: 'unreadable', installState: 'unknown', provenance: 'unknown',
  os: 'unknown', caps: [], highestVersion: null, floorRead: 'unmeasured', previousRead: 'unmeasured', reachable: false, unreachableSince: T9_T0,
  // floorRead 'unmeasured' (D-3213): W2's resolver stores no desired for a placeholder, only this sentence
  desiredTag: null, resolveDetail: "this node's floor has not been measured — nothing resolves until it is", ...over,
});

describe('SettingsScreen — the node inventory: helpers', () => {
  it('currentText keeps "not measured", "stamp <word>" and "unversioned" apart (§18 "stampRead keeps EACCES from unversioned")', () => {
    expect(currentText(t9Node())).toBe('v0.0.9');
    expect(currentText(t9Node({ current: t9Stamp(undefined) })), 'read, no tag').toBe('unversioned');
    expect(currentText(t9Node({ stampRead: 'unreadable', current: null })), 'EACCES').toBe('stamp unreadable');
    expect(currentText(t9Node({ stampRead: 'malformed', current: null }))).toBe('stamp malformed');
    expect(currentText(t9Node({ stampRead: 'absent', current: null }))).toBe('stamp absent');
    expect(currentText(t9Node({ stampRead: 'later' as unknown as NodeWire['stampRead'], current: null })), 'an unnamed word')
      .toBe('stamp unreadable');
    expect(currentText(t9Placeholder()), 'a placeholder is not an unversioned node').toBe('not measured');
  });

  it('currentIsAmber: each condition alone turns the cell amber; a measured, verified, complete, tagged stamp does not', () => {
    expect(currentIsAmber(t9Node())).toBe(false);
    expect(currentIsAmber(t9Node({ current: t9Stamp(undefined) })), 'unversioned').toBe(true);
    expect(currentIsAmber(t9Node({ provenance: 'unverified' })), 'unverified').toBe(true);
    expect(currentIsAmber(t9Node({ provenance: 'unknown' })), 'provenance unknown').toBe(true);
    expect(currentIsAmber(t9Node({ installState: 'incomplete' })), 'incomplete').toBe(true);
    expect(currentIsAmber(t9Node({ stampRead: 'unreadable' })), 'stamp not read, tag still present').toBe(true);
    expect(currentIsAmber(t9Node({ measuredAt: null })), 'never measured').toBe(true);
  });

  it('canAck: on a settled lease only — then a halted state, an outstanding request or a refusal naming THIS node', () => {
    const settled = (state: NodeWire['update']['state']): NodeWire =>
      t9Node({ update: { state, target: null, startedAt: null, detail: null } });
    expect(canAck(settled('failed'), [])).toBe(true);
    expect(canAck(settled('reverted'), [])).toBe(true);
    for (const state of ['idle', 'pending', 'applying', 'unknown'] as const) {
      expect(canAck(settled(state), []), state).toBe(false);
    }
    const REQ = { tag: 'v0.0.10', kind: 'update', at: T9_T0 } as const;
    expect(canAck(t9Node({ request: REQ }), []), 'a request on an idle row').toBe(true);
    const refusedHere = t9Release('v0.0.10', { refused: [{ by: T9_NODE_A, at: T9_T0 }] });
    const refusedThere = t9Release('v0.0.10', { refused: [{ by: T9_NODE_B, at: T9_T0 }] });
    // A busy lease is never offered, whatever else the row carries: W2's ackNode answers `busy` there (D-3183).
    for (const state of ['pending', 'applying', 'unknown'] as const) {
      const busy = { state, target: 'v0.0.10', startedAt: T9_T0, detail: null };
      expect(canAck(t9Node({ update: busy, request: REQ }), []), `${state} with a request`).toBe(false);
      expect(canAck(t9Node({ update: busy }), [refusedHere]), `${state} with a refusal`).toBe(false);
    }
    const unnamed = { state: 'later', target: null, startedAt: null, detail: null } as unknown as NodeWire['update'];
    expect(canAck(t9Node({ update: unnamed, request: REQ }), []), 'an unnamed state').toBe(false);
    expect(canAck({ ...t9Node({ request: REQ }), update: undefined } as unknown as NodeWire, []), 'update absent').toBe(false);
    expect(canAck(t9Node(), [t9Release('v0.0.9'), refusedHere]), 'refused by this node').toBe(true);
    expect(canAck(t9Node(), [refusedThere]), 'refused by ANOTHER node').toBe(false);
    expect(canAck(t9Node(), [t9Release('v0.0.10', { refused: {} as unknown as ReleaseWire['refused'] })])).toBe(false);
    expect(canAck(t9Node(), [t9Release('v0.0.10', { refused: [null] as unknown as ReleaseWire['refused'] })])).toBe(false);
  });

  it('requestLine: kind, tag and age of an outstanding request; null with none or a malformed one', () => {
    expect(requestLine(t9Node(), T9_T0)).toBeNull();
    expect(requestLine(t9Node({ request: { tag: 'v0.0.10', kind: 'update', at: T9_T0 - 5 * T9_MIN } }), T9_T0))
      .toBe('update v0.0.10 requested 5m ago');
    expect(requestLine(t9Node({ request: { tag: 'v0.0.8', kind: 'rollback', at: T9_T0 } }), T9_T0))
      .toBe('rollback v0.0.8 requested moments ago');
    expect(requestLine(t9Node({ request: { tag: 'v0.0.8' } as unknown as NodeWire['request'] }), T9_T0)).toBeNull();
    // fix round 1: a magnitude this build's Date cannot place is not an age (isPlaceableInstant, review finding).
    expect(requestLine(t9Node({ request: { tag: 'v0.0.10', kind: 'update', at: -1e20 } }), T9_T0), 'at -1e20').toBeNull();
    expect(requestLine(t9Node({ request: { tag: 'v0.0.10', kind: 'update', at: 1e20 } }), T9_T0), 'at 1e20').toBeNull();
  });

  it("nodeStateLine: the lease state, then the report's phase, then its detail when it has one", () => {
    expect(nodeStateLine(t9Node())).toBe('idle');
    const report = { phase: 'fetching', target: 'v0.0.10', startedAt: T9_T0, updatedAt: T9_T0, detail: null } as const;
    expect(nodeStateLine(t9Node({
      update: { state: 'applying', target: 'v0.0.10', startedAt: T9_T0, detail: null }, report,
    }))).toBe('applying — fetching');
    expect(nodeStateLine(t9Node({
      update: { state: 'failed', target: 'v0.0.10', startedAt: T9_T0, detail: null },
      report: { ...report, phase: 'failed', detail: 'health check did not pass' },
    }))).toBe('failed — failed: health check did not pass');
    expect(nodeStateLine(t9Node({ report: { ...report, detail: '' } })), 'an empty detail adds nothing').toBe('idle — fetching');
    expect(nodeStateLine({ ...t9Node(), update: undefined } as unknown as NodeWire), 'update absent').toBe('unknown');
  });

  it('reachabilityLine: only reachable === false speaks; an absent field claims nothing', () => {
    expect(reachabilityLine(t9Node(), T9_T0)).toBeNull();
    expect(reachabilityLine(t9Node({ reachable: false, unreachableSince: T9_T0 - 5 * T9_MIN }), T9_T0))
      .toBe('unreachable since 5m ago');
    expect(reachabilityLine(t9Node({ reachable: false, unreachableSince: null }), T9_T0)).toBe('unreachable');
    expect(reachabilityLine({ ...t9Node(), reachable: undefined } as unknown as NodeWire, T9_T0)).toBeNull();
    // fix round 1: a magnitude this build's Date cannot place reads as no "since" (isPlaceableInstant, review finding).
    expect(reachabilityLine(t9Node({ reachable: false, unreachableSince: 1e16 }), T9_T0), 'unreachableSince 1e16').toBe('unreachable');
  });

  it("spells spec §13's Darwin sentence", () => {
    expect(MACOS_UNMANAGED_TEXT).toBe('macOS: not centrally managed');
  });
});

describe('SettingsScreen — the node inventory: rendering (design 2026-09-20 §13)', () => {
  const view = (nodes: NodeWire[], releases: ReleaseWire[] = [t9Release('v0.0.9')]): UpdatesView => ({
    catalogue: { lastOkAt: T9_T0, lastError: null },
    releases,
    nodes,
    intent: [{ scope: FLEET_SCOPE, channel: 'stable', pinnedTag: null, auto: 'off', notify: 'channel', setAt: T9_T0, setBy: 'test' }],
  });
  /** Render the screen (with the one toast subscriber) over one answer and return the inventory list — every case
   *  reads INSIDE it, because the release list (Task 8) renders the same tags on the same screen. */
  const renderNodes = async (nodes: NodeWire[], releases?: ReleaseWire[]) => {
    const updates = vi.spyOn(api, 'updates').mockResolvedValue(view(nodes, releases));
    render(<><ToastHost /><SettingsScreen /></>);
    const list = await screen.findByRole('list', { name: 'Nodes' });
    return { list, updates };
  };
  const rowOf = (list: HTMLElement, nodeId: string): HTMLElement => {
    const row = list.querySelector<HTMLElement>(`li[data-node-id="${nodeId}"]`);
    if (row === null) throw new Error(`no inventory row for ${nodeId}`);
    return row;
  };

  it('renders label, role, os and a calm current, with no arrow and no "up to date" for a node on its desired tag', async () => {
    const { list } = await renderNodes([t9Node(), t9Server({ role: null })]);
    expect(within(list).getAllByRole('listitem').map((li) => li.getAttribute('data-node-id'))).toEqual([T9_NODE_A, T9_NODE_B]);
    const row = rowOf(list, T9_NODE_A);
    expect(within(row).getByText('fleet')).toHaveClass('settings-node-label');
    expect(within(row).getByText('fleet · linux')).toHaveClass('settings-node-detail');
    const current = within(row).getByText('v0.0.9');
    expect(current).toHaveClass('settings-node-current');
    expect(current).not.toHaveClass('settings-node-current--amber');
    expect(row.textContent).not.toContain('→');
    expect(row.textContent).not.toMatch(/up to date/i);
    expect(within(row).getByText('idle')).toBeInTheDocument();
    expect(within(rowOf(list, T9_NODE_B)).getByText('unknown role · linux')).toBeInTheDocument();
  });

  it('draws the arrow for a newer desired tag, with the channel badge', async () => {
    const { list } = await renderNodes([t9Node({ desiredTag: 'v0.0.10' })]);
    const row = rowOf(list, T9_NODE_A);
    expect(within(row).getByText('→ v0.0.10')).toHaveClass('settings-node-desired');
    expect(within(row).getByText('stable')).toHaveClass('settings-badge', 'settings-badge--stable');
  });

  it('an unreadable stamp renders amber and no arrow, even with a newer desired tag (§13 Pins)', async () => {
    const { list } = await renderNodes([
      t9Node({ stampRead: 'unreadable', current: null, provenance: 'unknown', desiredTag: 'v0.0.10' }),
    ]);
    const row = rowOf(list, T9_NODE_A);
    expect(within(row).getByText('stamp unreadable')).toHaveClass('settings-node-current--amber');
    expect(within(row).queryByText('unversioned')).toBeNull();
    expect(row.textContent).not.toContain('→');
    expect(row.querySelector('.settings-badge')).toBeNull();
  });

  it('a node with no resolved channel renders resolveDetail and no badge, no arrow (§13 Pins)', async () => {
    const WHY = 'a stored channel is one this build cannot read — nothing resolves';
    const { list } = await renderNodes([t9Node({ channel: null, desiredTag: null, resolveDetail: WHY })]);
    const row = rowOf(list, T9_NODE_A);
    expect(within(row).getByText(WHY)).toHaveClass('settings-node-detail');
    expect(row.querySelector('.settings-badge')).toBeNull();
    expect(row.textContent).not.toContain('→');
  });

  it('a node never measured reads "not measured" in amber, says it is unreachable, and draws no arrow (§18 "unreachable is not current")', async () => {
    const { list } = await renderNodes([
      t9Node(),
      t9Placeholder({ unreachableSince: Date.now() - 5 * T9_MIN, channel: 'stable', desiredTag: 'v0.0.10', resolveDetail: null }),
    ]);
    const row = rowOf(list, 'server');   // the placeholder's id is its label (W2 markUnreachable)
    expect(within(row).getByText('not measured')).toHaveClass('settings-node-current--amber');
    expect(within(row).getByText('unreachable since 5m ago')).toHaveClass('settings-node-detail');
    expect(within(row).queryByText('unversioned')).toBeNull();
    expect(row.textContent).not.toContain('→');
  });

  it('a Darwin row reads the macOS sentence in place of its desired, and offers no move', async () => {
    const { list } = await renderNodes([t9Node({ os: 'darwin', desiredTag: 'v0.0.10' })]);
    const row = rowOf(list, T9_NODE_A);
    expect(within(row).getByText(MACOS_UNMANAGED_TEXT)).toBeInTheDocument();
    expect(row.textContent).not.toContain('→');
    expect(within(row).queryByRole('button', { name: 'Update' })).toBeNull();
    expect(within(row).queryByRole('button', { name: 'Roll back' })).toBeNull();
    expect(within(row).queryByText(MOVE_DISABLED_TEXT)).toBeNull();
    expect(within(row).getByRole('button', { name: 'Ack' })).toBeDisabled();   // idle, nothing to acknowledge
  });

  it('renders Update and Roll back DISABLED on every managed row, described by the one W3 sentence (§18 "the move controls are disabled in W3")', async () => {
    const { list } = await renderNodes([t9Node({ desiredTag: 'v0.0.10' }), t9Server()]);
    for (const id of [T9_NODE_A, T9_NODE_B]) {
      const row = rowOf(list, id);
      for (const name of ['Update', 'Roll back']) {
        const b = within(row).getByRole('button', { name });
        expect(b, `${id} ${name}`).toBeDisabled();
        expect(b).toHaveAccessibleDescription(MOVE_DISABLED_TEXT);
      }
      expect(within(row).getAllByText(MOVE_DISABLED_TEXT)).toHaveLength(1);
    }
  });

  it('an idle node with no request and no refusal has Ack disabled', async () => {
    const { list } = await renderNodes([t9Node()]);
    expect(within(rowOf(list, T9_NODE_A)).getByRole('button', { name: 'Ack' })).toBeDisabled();
  });

  it("a failed node's Ack is enabled, sends its nodeId and re-polls the view", async () => {
    const failed = t9Node({ update: { state: 'failed', target: 'v0.0.10', startedAt: T9_T0, detail: null } });
    const ack = vi.spyOn(api, 'ackUpdateNode').mockResolvedValue({ ok: true, node: t9Node() });
    const { list, updates } = await renderNodes([failed]);
    const before = updates.mock.calls.length;
    const button = within(rowOf(list, T9_NODE_A)).getByRole('button', { name: 'Ack' });
    expect(button).toBeEnabled();
    fireEvent.click(button);
    expect(ack).toHaveBeenCalledTimes(1);
    expect(ack).toHaveBeenCalledWith(T9_NODE_A);
    await waitFor(() => expect(updates.mock.calls.length).toBeGreaterThan(before));
  });

  it('a node named in refused[] has Ack enabled; a refusal naming another node does not enable it', async () => {
    const { list } = await renderNodes(
      [t9Node(), t9Server()],
      [t9Release('v0.0.10', { refused: [{ by: T9_NODE_B, at: T9_T0 }] })],
    );
    expect(within(rowOf(list, T9_NODE_B)).getByRole('button', { name: 'Ack' })).toBeEnabled();
    expect(within(rowOf(list, T9_NODE_A)).getByRole('button', { name: 'Ack' })).toBeDisabled();
  });

  it('an outstanding request renders its line and the state with the report phase; Ack is offered only once the lease is settled', async () => {
    const request = { tag: 'v0.0.10', kind: 'update', at: Date.now() - 5 * T9_MIN } as const;
    const { list } = await renderNodes([
      t9Node({
        desiredTag: 'v0.0.10', request,
        update: { state: 'pending', target: 'v0.0.10', startedAt: T9_T0, detail: null },
        report: { phase: 'fetching', target: 'v0.0.10', startedAt: T9_T0, updatedAt: T9_T0, detail: null },
      }),
      t9Server({ request }),   // the same request on an idle row
    ]);
    const row = rowOf(list, T9_NODE_A);
    expect(within(row).getByText('update v0.0.10 requested 5m ago')).toHaveClass('settings-node-detail');
    expect(within(row).getByText('pending — fetching')).toHaveClass('settings-node-detail');
    // pending is busy: W2's ackNode would answer `busy`, so the control is not offered (D-3183)
    expect(within(row).getByRole('button', { name: 'Ack' })).toBeDisabled();
    expect(within(rowOf(list, T9_NODE_B)).getByRole('button', { name: 'Ack' })).toBeEnabled();
  });

  it("a refused ack is the route's sentence in an error toast — the route stays the authority", async () => {
    // A race: the poll read the row idle with its request, and by the tap the route found it busy.
    const busy = new ApiError(409, { ok: false, error: 'busy', detail: 'applying' });
    vi.spyOn(api, 'ackUpdateNode').mockRejectedValue(busy);
    const { list } = await renderNodes([t9Node({ request: { tag: 'v0.0.10', kind: 'update', at: T9_T0 } })]);
    const button = within(rowOf(list, T9_NODE_A)).getByRole('button', { name: 'Ack' });
    expect(button).toBeEnabled();
    fireEvent.click(button);
    const t = await screen.findByText(updateErrorText(busy), { selector: '.toast' });
    expect(t).toHaveClass('toast--error');
  });

  it('an ack whose answer could not be read says so, and does not claim failure', async () => {
    vi.spyOn(api, 'ackUpdateNode').mockResolvedValue('unreadable');
    const { list } = await renderNodes([t9Node({ update: { state: 'reverted', target: null, startedAt: null, detail: null } })]);
    fireEvent.click(within(rowOf(list, T9_NODE_A)).getByRole('button', { name: 'Ack' }));
    const t = await screen.findByText(ACK_UNREADABLE_TEXT, { selector: '.toast' });
    expect(t).not.toHaveClass('toast--error');
  });

  it('renders a label and a report.detail carrying markup as literal text', async () => {
    const LABEL = '<img src=x onerror=alert(1)>box';
    const DETAIL = '<b>health</b> check failed — see https://example.com/x';
    const { list } = await renderNodes([t9Node({
      label: LABEL,
      update: { state: 'failed', target: 'v0.0.10', startedAt: T9_T0, detail: null },
      report: { phase: 'failed', target: 'v0.0.10', startedAt: T9_T0, updatedAt: T9_T0, detail: DETAIL },
    })]);
    const row = rowOf(list, T9_NODE_A);
    expect(within(row).getByText(LABEL)).toHaveClass('settings-node-label');
    expect(within(row).getByText(`failed — failed: ${DETAIL}`)).toBeInTheDocument();
    expect(row.querySelector('img, b, a, script')).toBeNull();
    expect(within(row).queryByRole('link')).toBeNull();
  });

  it('renders no inventory list for an empty nodes array', async () => {
    vi.spyOn(api, 'updates').mockResolvedValue(view([]));
    render(<SettingsScreen />);
    await screen.findByText(/^checked /);   // Task 7's catalogue line: the view has landed
    expect(screen.queryByRole('list', { name: 'Nodes' })).toBeNull();
  });

  it('keeps the amber ink and lets a long label wrap (css:false — read off fleet.css)', () => {
    const css = readFileSync(path.join(import.meta.dirname, '..', 'src', 'fleet', 'fleet.css'), 'utf8');
    expect(declValue(ruleIn(css, '.settings-node-current--amber'), 'color')).toBe('var(--status-attention-text)');
    expect(declValue(ruleIn(css, '.settings-node-label'), 'overflow-wrap')).toBe('anywhere');
    // The row's three buttons carry Task 8's pair; its compound rule is what keeps them inline.
    expect(declValue(ruleIn(css, '.btn-ghost.settings-move'), 'width')).toBe('auto');
  });
});

// ── Task 10: Notifications + the unarmed banner (design 2026-09-20 §12, §13) ──
// Fixtures are local to these describes, as Tasks 7–9 keep theirs. Every case
// that stubs a global (`fetch`, `location`, the three Web Push globals) undoes
// it in the describe's own afterEach, which vitest's stack order runs BEFORE
// the file-level reset — so `navigate('/')` there never meets a stubbed
// `location`.
const T10_T0 = Date.UTC(2026, 8, 23, 12, 0, 0);
const T10_NODE = '11111111-1111-4111-8111-111111111111';
/** One intent row. `scope` defaults to the fleet row the notifier reads. */
const t10Intent = (over: Partial<UpdateIntentWire> = {}): UpdateIntentWire => ({
  scope: FLEET_SCOPE, channel: 'stable', pinnedTag: null, auto: 'off', notify: 'channel',
  setAt: T10_T0, setBy: 'pwa', ...over,
});
/** A view that is only an intent list — the Notifications section reads nothing else. A NODE row is listed
 *  FIRST on purpose: W2 answers '*' first (`ORDER BY scope`), and a reader that took `intent[0]` would pass
 *  every fixture that kept that order. */
const t10View = (fleet: Partial<UpdateIntentWire> = {}): UpdatesView => ({
  catalogue: { lastOkAt: T10_T0, lastError: null },
  releases: [],
  nodes: [],
  intent: [t10Intent({ scope: T10_NODE, notify: 'off', setAt: T10_T0 - 1 }), t10Intent(fleet)],
});
const t10Answer = (notify: NotifyMode, setAt: number): IntentWriteAnswer =>
  ({ ok: true, intent: t10Intent({ notify, setAt }), epoch: 2 });
const t10Json = (status: number, body: unknown): Response =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
/** `GET /api/auth/status` answers `answer`; any other URL is a 404 no case reads. Returns the mock, so a
 *  "nothing renders" case can wait for the read to have HAPPENED before asserting its absence. */
const t10AuthStatus = (answer: { status: number; body: unknown } | 'network') => {
  const f = vi.fn(async (url: unknown): Promise<Response> => {
    if (String(url) !== '/api/auth/status') return t10Json(404, { error: 'not-found' });
    if (answer === 'network') throw new TypeError('Failed to fetch');
    return t10Json(answer.status, answer.body);
  });
  vi.stubGlobal('fetch', f);
  return f;
};
const t10Host = (hostname: string): void => { vi.stubGlobal('location', { ...window.location, hostname }); };
/** A browser that CAN do Web Push, as far as `pushSupported()` looks (lib/push.ts:13); permission stays
 *  'default', so the bell's mount read (`pushEnabled`) answers false without touching the worker. */
const t10PushBrowser = (): void => {
  vi.stubGlobal('PushManager', class {});
  vi.stubGlobal('Notification', { permission: 'default', requestPermission: vi.fn() });
  vi.stubGlobal('navigator', { ...navigator, serviceWorker: {} });
};
/** Let every microtask and 0 ms timer queued so far run (the status read's fetch → json → setState chain). */
const t10Settle = async (): Promise<void> => {
  await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
};
const t10Group = (): Promise<HTMLElement> => screen.findByRole('group', { name: 'Release notifications' });

describe('SettingsScreen — notifications: helpers', () => {
  it('unarmedExposure: the gate reported off AND a non-loopback hostname — both, and nothing else', () => {
    expect(unarmedExposure({ mode: 'off' }, 'ccrc.example')).toBe(true);
    for (const host of LOOPBACK_HOSTS) expect(unarmedExposure({ mode: 'off' }, host)).toBe(false);
    expect(unarmedExposure({ mode: 'passphrase' }, 'ccrc.example')).toBe(false);
    expect(unarmedExposure({ mode: 'locked-out' }, 'ccrc.example')).toBe(false);
    // An older server's silence and a failed read are not "off" — a red banner is a claim about this box.
    expect(unarmedExposure({ authed: true }, 'ccrc.example')).toBe(false);
    expect(unarmedExposure(null, 'ccrc.example')).toBe(false);
  });

  it('unarmedExposure: the loopback spellings are shared/base-url.ts\'s own — [::1] with brackets, as URL writes it', () => {
    expect(unarmedExposure({ mode: 'off' }, '[::1]')).toBe(false);
    expect(unarmedExposure({ mode: 'off' }, 'localhost')).toBe(false);
    expect(unarmedExposure({ mode: 'off' }, '127.0.0.1')).toBe(false);
    expect(unarmedExposure({ mode: 'off' }, '203.0.113.7')).toBe(true);
  });

  it('the banner sentence names the route it warns about and the three settings that arm the gate', () => {
    expect(UNARMED_EXPOSURE_TEXT).toContain('POST /api/updates/apply');
    for (const word of ['CCRC_AUTH=on', 'CCRC_RP_ID', 'CCRC_ORIGIN']) expect(UNARMED_EXPOSURE_TEXT).toContain(word);
  });

  it('labels every NotifyMode, and nothing else', () => {
    expect(Object.keys(NOTIFY_LABELS).sort()).toEqual([...NOTIFY_MODES].sort());
  });
});

describe('SettingsScreen — notifications: the section (design 2026-09-20 §13 item 2)', () => {
  afterEach(() => { vi.unstubAllGlobals(); });

  it('offers one native radio per NotifyMode, in NOTIFY_MODES order, checked from the \'*\' row', async () => {
    vi.spyOn(api, 'updates').mockResolvedValue(t10View({ notify: 'stable' }));
    render(<SettingsScreen />);
    const group = await t10Group();
    const radios = within(group).getAllByRole('radio');
    expect(radios.map((r) => r.getAttribute('value'))).toEqual([...NOTIFY_MODES]);
    expect(within(group).getByRole('radio', { name: 'stable only' })).toBeChecked();
    // The node row (listed first, notify 'off') is not what the fleet setting reads.
    expect(within(group).getByRole('radio', { name: 'off' })).not.toBeChecked();
    expect(within(group).getByRole('radio', { name: 'on my channel' })).not.toBeChecked();
  });

  it('a tap writes {scope: \'*\', notify} once, re-polls, and keeps the stored choice checked while the poll lags', async () => {
    const updates = vi.spyOn(api, 'updates').mockResolvedValue(t10View({ notify: 'channel' }));
    const write = vi.spyOn(api, 'setUpdateIntent').mockResolvedValue(t10Answer('stable', T10_T0 + 1));
    render(<SettingsScreen />);
    const group = await t10Group();
    fireEvent.click(within(group).getByRole('radio', { name: 'stable only' }));
    await waitFor(() => expect(updates).toHaveBeenCalledTimes(2));
    expect(write).toHaveBeenCalledTimes(1);
    expect(write).toHaveBeenCalledWith({ scope: FLEET_SCOPE, notify: 'stable' });
    await t10Settle();
    // The re-poll still answered the OLD row (setAt T0 < the answer's T0 + 1): the route's answer is shown.
    expect(within(group).getByRole('radio', { name: 'stable only' })).toBeChecked();
  });

  it('once the poll carries a row at least as new as the answer, the poll is what is checked', async () => {
    vi.spyOn(api, 'updates')
      .mockResolvedValueOnce(t10View({ notify: 'channel' }))
      .mockResolvedValue(t10View({ notify: 'off', setAt: T10_T0 + 5 }));   // another device, later
    vi.spyOn(api, 'setUpdateIntent').mockResolvedValue(t10Answer('stable', T10_T0 + 1));
    render(<SettingsScreen />);
    const group = await t10Group();
    fireEvent.click(within(group).getByRole('radio', { name: 'stable only' }));
    await waitFor(() => expect(within(group).getByRole('radio', { name: 'off' })).toBeChecked());
  });

  it('a poll row whose setAt EQUALS the answer\'s setAt is already caught up (>=, never >)', async () => {
    // Same shape as the case above, but the poll's second row lands at EXACTLY
    // the answer's setAt rather than strictly after it — the boundary >= is
    // meant to cover, not just the strictly-newer case a bare `>` would also pass.
    vi.spyOn(api, 'updates')
      .mockResolvedValueOnce(t10View({ notify: 'channel' }))
      .mockResolvedValue(t10View({ notify: 'off', setAt: T10_T0 + 1 }));   // exactly the answer's setAt
    vi.spyOn(api, 'setUpdateIntent').mockResolvedValue(t10Answer('stable', T10_T0 + 1));
    render(<SettingsScreen />);
    const group = await t10Group();
    fireEvent.click(within(group).getByRole('radio', { name: 'stable only' }));
    await waitFor(() => expect(within(group).getByRole('radio', { name: 'off' })).toBeChecked());
  });

  it('a write in flight disables the three radios, so a second tap cannot race the first', async () => {
    vi.spyOn(api, 'updates').mockResolvedValue(t10View({ notify: 'channel' }));
    const write = vi.spyOn(api, 'setUpdateIntent').mockReturnValue(new Promise(() => {}));
    render(<SettingsScreen />);
    const group = await t10Group();
    fireEvent.click(within(group).getByRole('radio', { name: 'off' }));
    await waitFor(() => expect(within(group).getByRole('radio', { name: 'off' })).toBeDisabled());
    expect(within(group).getByRole('radio', { name: 'off' })).toBeChecked();
    fireEvent.click(within(group).getByRole('radio', { name: 'stable only' }));
    expect(write).toHaveBeenCalledTimes(1);
  });

  it('an unreadable answer says the write may have landed and shows the stored row, not a guess', async () => {
    vi.spyOn(api, 'updates').mockResolvedValue(t10View({ notify: 'channel' }));
    vi.spyOn(api, 'setUpdateIntent').mockResolvedValue('unreadable');
    render(<><ToastHost /><SettingsScreen /></>);
    const group = await t10Group();
    fireEvent.click(within(group).getByRole('radio', { name: 'off' }));
    expect(await screen.findByText(UNCONFIRMED_TEXT)).toBeInTheDocument();
    expect(within(group).getByRole('radio', { name: 'on my channel' })).toBeChecked();
  });

  // fix round 1 (mutation-table finding): a 2xx answer that IS readable as JSON
  // but whose `intent` carries a shape this build cannot trust is the SAME
  // "may have landed" outcome as `'unreadable'` — never stored as-is. Three
  // ways an answer can fail that trust, each guarded by its own clause in
  // `choose`: a `notify` outside `NotifyMode` (`isNotifyMode`), a `setAt` that
  // is not a number (`typeof … === 'number'`), and an answer with no `intent`
  // at all (`answer?.intent ?? null`).
  it('a malformed notify value in the answer is not stored — unconfirmed, not a guess (isNotifyMode guard)', async () => {
    vi.spyOn(api, 'updates').mockResolvedValue(t10View({ notify: 'channel' }));
    vi.spyOn(api, 'setUpdateIntent').mockResolvedValue(
      { ok: true, intent: { ...t10Intent(), notify: 'loud' as NotifyMode }, epoch: 2 });
    render(<><ToastHost /><SettingsScreen /></>);
    const group = await t10Group();
    fireEvent.click(within(group).getByRole('radio', { name: 'off' }));
    expect(await screen.findByText(UNCONFIRMED_TEXT)).toBeInTheDocument();
    expect(within(group).getByRole('radio', { name: 'on my channel' })).toBeChecked();
  });

  it('a non-number setAt in the answer is not stored — unconfirmed, not a guess (typeof setAt guard)', async () => {
    vi.spyOn(api, 'updates').mockResolvedValue(t10View({ notify: 'channel' }));
    vi.spyOn(api, 'setUpdateIntent').mockResolvedValue(
      { ok: true, intent: { ...t10Intent(), notify: 'off', setAt: 'soon' as unknown as number }, epoch: 2 });
    render(<><ToastHost /><SettingsScreen /></>);
    const group = await t10Group();
    fireEvent.click(within(group).getByRole('radio', { name: 'off' }));
    expect(await screen.findByText(UNCONFIRMED_TEXT)).toBeInTheDocument();
    expect(within(group).getByRole('radio', { name: 'on my channel' })).toBeChecked();
  });

  it('an answer with no intent field at all is not stored — unconfirmed, not a guess (the ?? null guard)', async () => {
    vi.spyOn(api, 'updates').mockResolvedValue(t10View({ notify: 'channel' }));
    vi.spyOn(api, 'setUpdateIntent').mockResolvedValue({ ok: true } as unknown as IntentWriteAnswer);
    render(<><ToastHost /><SettingsScreen /></>);
    const group = await t10Group();
    fireEvent.click(within(group).getByRole('radio', { name: 'off' }));
    expect(await screen.findByText(UNCONFIRMED_TEXT)).toBeInTheDocument();
    expect(within(group).getByRole('radio', { name: 'on my channel' })).toBeChecked();
  });

  it('a refusal toasts the update route\'s own sentence and puts the stored choice back', async () => {
    vi.spyOn(api, 'updates').mockResolvedValue(t10View({ notify: 'channel' }));
    vi.spyOn(api, 'setUpdateIntent').mockRejectedValue(
      new ApiError(503, { ok: false, error: 'journal-unwritable', detail: 'the intent journal could not be written — see the server log' }));
    render(<><ToastHost /><SettingsScreen /></>);
    const group = await t10Group();
    fireEvent.click(within(group).getByRole('radio', { name: 'stable only' }));
    expect(await screen.findByText('The server cannot write its intent journal — nothing was changed.')).toBeInTheDocument();
    expect(within(group).getByRole('radio', { name: 'on my channel' })).toBeChecked();
    expect(within(group).getByRole('radio', { name: 'stable only' })).not.toBeChecked();
  });

  it('renders the section while /api/updates is pending and on a box with no control plane — with no release radios', async () => {
    vi.spyOn(api, 'updates').mockReturnValue(new Promise(() => {}));
    render(<SettingsScreen />);
    expect(screen.getByRole('heading', { name: 'Notifications' })).toBeInTheDocument();
    expect(screen.getByText('This browser cannot receive Web Push.')).toBeInTheDocument();
    expect(screen.queryByRole('group', { name: 'Release notifications' })).toBeNull();
    cleanup();
    vi.spyOn(api, 'updates').mockRejectedValue(new ApiError(501, { ok: false, error: 'not-configured' }));
    render(<SettingsScreen />);
    await screen.findByText('This box has no update control plane — it runs without a coordination database.');
    expect(screen.getByRole('heading', { name: 'Notifications' })).toBeInTheDocument();
    expect(screen.queryByRole('group', { name: 'Release notifications' })).toBeNull();
  });

  it('reuses the literal NotificationBell where the browser can do Web Push', async () => {
    t10PushBrowser();
    vi.spyOn(api, 'updates').mockReturnValue(new Promise(() => {}));
    render(<SettingsScreen />);
    const section = screen.getByRole('heading', { name: 'Notifications' }).closest('section')!;
    const bell = await within(section).findByRole('button', { name: 'Notifications off' });
    expect(bell).toHaveClass('bell');
    expect(bell).toHaveAttribute('aria-pressed', 'false');
    expect(within(section).getByText('Phone notifications for this browser')).toBeInTheDocument();
    expect(within(section).queryByText('This browser cannot receive Web Push.')).toBeNull();
  });

  it('spells none of the bell\'s own outcomes — the toggle is reused, never copied (a literal-absence pin)', () => {
    const src = readFileSync(path.join(import.meta.dirname, '..', 'src', 'screens', 'SettingsScreen.tsx'), 'utf8');
    expect(src).toMatch(/import \{ NotificationBell \} from '\.\.\/fleet\/NotificationBell';/);
    expect(src).toMatch(/<NotificationBell \/>/);
    for (const copy of [/\benablePush\b/, /\bdisablePush\b/, /\bpushEnabled\b/, /Allow notifications in your browser/,
      /Push isn't set up on the server/, /Your browser blocks web push/]) {
      expect(src).not.toMatch(copy);
    }
  });
});

describe('SettingsScreen — notifications: the unarmed-exposure banner (design 2026-09-20 §12)', () => {
  afterEach(() => { vi.unstubAllGlobals(); });
  const banner = (): HTMLElement | null => document.querySelector<HTMLElement>('.settings-unarmed');

  it('shows the red sentence when the gate reports off and the page was reached over a non-loopback name', async () => {
    t10AuthStatus({ status: 200, body: { authed: true, passkeysEnrolled: 0, mode: 'off' } });
    t10Host('ccrc.example');
    vi.spyOn(api, 'updates').mockReturnValue(new Promise(() => {}));   // independent of the update view
    render(<SettingsScreen />);
    const shown = await screen.findByText(UNARMED_EXPOSURE_TEXT);
    expect(shown).toHaveClass('settings-unarmed');
    expect(shown).toHaveAttribute('role', 'alert');
    // Directly under the header: before the Updates section, not inside it.
    const updates = screen.getByRole('heading', { name: 'Updates' });
    expect(shown.compareDocumentPosition(updates) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(shown.closest('section')).toBeNull();
  });

  it('shows nothing when the gate is off but the page is on loopback', async () => {
    const f = t10AuthStatus({ status: 200, body: { authed: true, passkeysEnrolled: 0, mode: 'off' } });
    t10Host('127.0.0.1');
    vi.spyOn(api, 'updates').mockResolvedValue(t10View());
    render(<SettingsScreen />);
    await waitFor(() => expect(f).toHaveBeenCalledWith('/api/auth/status', expect.anything()));
    await t10Settle();
    expect(banner()).toBeNull();
  });

  it('shows nothing when the gate is armed, whatever the hostname', async () => {
    const f = t10AuthStatus({ status: 200, body: { authed: true, passkeysEnrolled: 1, mode: 'passphrase' } });
    t10Host('ccrc.example');
    vi.spyOn(api, 'updates').mockResolvedValue(t10View());
    render(<SettingsScreen />);
    await waitFor(() => expect(f).toHaveBeenCalledWith('/api/auth/status', expect.anything()));
    await t10Settle();
    expect(banner()).toBeNull();
  });

  it('shows nothing when the status read fails — a 404 from an older server, or no network', async () => {
    for (const answer of [{ status: 404, body: { error: 'not-found' } }, 'network'] as const) {
      const f = t10AuthStatus(answer);
      t10Host('ccrc.example');
      vi.spyOn(api, 'updates').mockResolvedValue(t10View());
      render(<SettingsScreen />);
      await waitFor(() => expect(f).toHaveBeenCalledWith('/api/auth/status', expect.anything()));
      await t10Settle();
      expect(banner()).toBeNull();
      cleanup();
    }
  });

  it('shows nothing when the status body carries no mode — silence is not "off"', async () => {
    const f = t10AuthStatus({ status: 200, body: { authed: false } });
    t10Host('ccrc.example');
    vi.spyOn(api, 'updates').mockResolvedValue(t10View());
    render(<SettingsScreen />);
    await waitFor(() => expect(f).toHaveBeenCalledWith('/api/auth/status', expect.anything()));
    await t10Settle();
    expect(banner()).toBeNull();
  });

  it('is self-grounded red, not sticky, and wraps inside the phone width; the bell row keeps the tap floor', () => {
    const css = readFileSync(path.join(import.meta.dirname, '..', 'src', 'fleet', 'fleet.css'), 'utf8');
    const red = ruleIn(css, '.settings-unarmed');
    expect(declValue(red, 'background')).toBe('var(--status-dead-tint-solid)');
    expect(declValue(red, 'color')).toBe('var(--status-dead-text)');
    expect(declValue(red, 'position')).toBeNull();
    expect(declValue(red, 'overflow-wrap')).toBe('anywhere');
    expect(declValue(ruleIn(css, '.settings-bell-row'), 'min-height')).toBe('var(--tap-min)');
  });

  it('reads the gate from /api/auth/status once per mount, never from /health', async () => {
    const f = t10AuthStatus({ status: 200, body: { authed: true, passkeysEnrolled: 0, mode: 'off' } });
    t10Host('ccrc.example');
    vi.spyOn(api, 'updates').mockResolvedValue(t10View());
    render(<SettingsScreen />);
    await screen.findByText(UNARMED_EXPOSURE_TEXT);
    const urls = f.mock.calls.map(([u]) => String(u));
    expect(urls.filter((u) => u === '/api/auth/status')).toHaveLength(1);
    expect(urls.some((u) => u.startsWith('/health'))).toBe(false);
  });
});

// ── fix round 1 (F11, item 6): a malformed /api/updates ELEMENT is dropped,
// never a reason to blank the whole screen ────────────────────────────────

describe('SettingsScreen — a malformed /api/updates element does not blank the screen (F11)', () => {
  it('renders the node inventory over the well-formed rows, dropping a null node and one with no string sha', async () => {
    const badSha = {
      ...t7Node(), nodeId: '22222222-2222-2222-2222-222222222222', current: { ...t7Node().current, sha: undefined },
    };
    const raw = {
      catalogue: { lastOkAt: Date.now() - (4 * 60_000 + 5_000), lastError: null },
      releases: [],
      nodes: [null, badSha, t7Node(), t7Server()],
      intent: [t7Intent()],
    };
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const region = await t7Mount(raw as unknown as UpdatesView);
    expect(within(region).getByText('fleet')).toBeInTheDocument();
    expect(within(region).getByText('server')).toBeInTheDocument();
    expect(warn).toHaveBeenCalledTimes(1);
    warn.mockRestore();
  });
});

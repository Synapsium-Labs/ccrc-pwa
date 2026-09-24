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
import type { CatalogueState, NodeWire, UpdateIntentWire, UpdatesView } from '../../shared/api';
import { AUTO_MODES, FLEET_SCOPE, UPDATE_GATE_CAP } from '../../shared/api';
import {
  AUTO_LABELS, CHANNEL_SENTENCES, SettingsScreen, autoGateMissing, catalogueLine, catalogueReasonText, clockTime,
  dayClock,
} from '../src/screens/SettingsScreen';
import { navigate } from '../src/lib/router';
import { useFleetStore } from '../src/stores/fleet';
import { ApiError, api } from '../src/lib/api';
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

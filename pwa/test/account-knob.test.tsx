// The kill switch and Check on the Accounts screen (spec 2026-10-18 accounts-connect §10, §13.1; accounts plan Task
// A14, D-7732). The knob moves only on the server's ack; a lane that is off and not ready cannot be turned on, says why
// beneath the knob and offers Check; every refusal is worded from its code, never from the response's text; the
// trouble card's Check again calls the same route.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { ToastHost } from '@ccrc/ui';
import { stateWordFor } from '../../shared/accounts';
import type { AccountsConnect, AccountsResponse, AccountUsage, FleetSession, LaneWire, RosterWire } from '../../shared/api';
import { AccountsScreen } from '../src/screens/AccountsScreen';
import { CHECK_AGAIN_LABEL, CHECK_LABEL, laneActRefusal, notReadyWords, switchRow } from '../src/fleet/accountWords';
import { navigate } from '../src/lib/router';
import { useFleetStore } from '../src/stores/fleet';
import { deadSession, fleetSession, hibernatedSession } from './fleetFixture';

const now = Date.now();
const nowSec = Math.floor(now / 1000);
const CONNECT: AccountsConnect = { accountOps: 'available', gate: 'armed', origin: 'https' };

const lane = (id: string, over: Partial<RosterWire> = {}): RosterWire => ({
  id, label: id, hue: 'cyan', homeAble: true, hidden: false, pool: null, provider: 'anthropic', kind: 'sign-in', ...over,
});
const ROSTER: RosterWire[] = [lane('lane-a'), lane('lane-b', { hue: 'amber' }), lane('lane-d', { hue: 'blue' }), lane('lane-l', { hue: 'violet' })];
const usage = (wrapper: string, over: Partial<AccountUsage> = {}): AccountUsage => ({
  wrapper, five: 10, seven: 20, ts: nowSec - 120, fiveResetAt: null, sevenResetAt: null,
  fiveRolledOver: false, sevenRolledOver: false, disabled: false, authDead: false, ...over,
});

/** One lane's wire, its word from the one function, as the server would send it. */
const wire = (u: AccountUsage, check: { verdict: string; at: number } | undefined, over: Partial<LaneWire> = {}): LaneWire => ({
  state: stateWordFor({
    disabled: u.disabled === true, authDead: u.authDead === true, five: u.five, seven: u.seven,
    fiveResetAt: u.fiveResetAt, sevenResetAt: u.sevenResetAt, provider: 'anthropic', kind: 'sign-in',
    lane: { kind: 'read', state: check === undefined ? {} : { check } }, now,
  }),
  ...(check !== undefined ? { check } : {}),
  ready: true,
  ...over,
});

interface World { usage: AccountUsage[]; lanes: Record<string, LaneWire> }
/** lane-a on and ready; lane-b signed out (401); lane-d off, its last check failed; lane-l off, a legacy lane never checked. */
const world = (): World => {
  const u = [usage('lane-a'), usage('lane-b', { authDead: true }), usage('lane-d', { disabled: true }), usage('lane-l', { disabled: true })];
  return {
    usage: u,
    lanes: {
      'lane-a': wire(u[0]!, { verdict: 'ok', at: now - 60_000 }),
      'lane-b': wire(u[1]!, { verdict: 'auth-dead', at: now - 3_600_000 }),
      'lane-d': wire(u[2]!, { verdict: 'auth-dead', at: now - 60_000 }, { ready: false, notReadyReason: 'check-failed' }),
      'lane-l': wire(u[3]!, undefined, { ready: false, notReadyReason: 'not-checked' }),
    },
  };
};

const answerOf = (w: World): AccountsResponse => ({ accounts: w.usage, projected: { wrapper: 'lane-a', score: 1 }, roster: ROSTER, lanes: w.lanes, connect: CONNECT });

/** The fetch the app sees: `/api/accounts` answers `served`; each lane route answers what `routes` holds for it. */
function stubFetch(served: () => World, routes: Record<string, () => Promise<Response>>): ReturnType<typeof vi.fn> {
  const f = vi.fn(async (input: RequestInfo | URL): Promise<Response> => {
    const url = String(input);
    if (url === '/api/accounts') return new Response(JSON.stringify(answerOf(served())), { status: 200, headers: { 'content-type': 'application/json' } });
    const r = routes[url];
    if (r !== undefined) return r();
    return new Response('{}', { status: 404, headers: { 'content-type': 'application/json' } });
  });
  vi.stubGlobal('fetch', f);
  return f;
}
const json = (status: number, body: unknown): Response => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

const show = (w: World, o: { connect?: AccountsConnect | null; sessions?: FleetSession[] } = {}): void => {
  act(() => {
    useFleetStore.setState({
      usage: w.usage, projected: { wrapper: 'lane-a', score: 1 }, roster: ROSTER, lanes: w.lanes,
      accountsConnect: o.connect === undefined ? CONNECT : o.connect, sessions: o.sessions ?? [],
    });
  });
  render(<><AccountsScreen /><ToastHost /></>);
};
const card = (id: string): HTMLElement => document.querySelector(`.accounts-row[data-lane='${id}']`) as HTMLElement;
// By name: the card also draws "Start new sessions here" (D-8195), a switch of its own.
const knob = (id: string): HTMLElement => within(card(id)).getByRole('switch', { name: `${id}: lane on or off` });

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  navigate('/');
  act(() => useFleetStore.setState({ sessions: [], usage: null, projected: undefined, roster: [], lanes: null, accountsConnect: null }));
});

describe('the kill switch moves only on the server\'s ack (spec §10)', () => {
  it('the knob does not move until the ack', async () => {
    let w = world();
    let ack!: (r: Response) => void;
    const f = stubFetch(() => w, { '/api/accounts/lane-a/disable': () => new Promise<Response>((res) => { ack = res; }) });
    show(w);
    const k = knob('lane-a');
    expect(k).toHaveAttribute('aria-checked', 'true');
    expect(within(card('lane-a')).getByText(switchRow(true, 0))).toBeInTheDocument();
    fireEvent.click(k);
    await waitFor(() => expect(f).toHaveBeenCalledWith('/api/accounts/lane-a/disable', expect.objectContaining({ method: 'POST' })));
    // In flight: busy, not moved, and a second press sends nothing.
    expect(knob('lane-a')).toHaveAttribute('aria-checked', 'true');
    expect(knob('lane-a')).toHaveAttribute('aria-busy', 'true');
    fireEvent.click(knob('lane-a'));
    expect(f.mock.calls.filter(([u]) => u === '/api/accounts/lane-a/disable')).toHaveLength(1);
    // The ack: the lane as the route re-read it. The store's next answer agrees.
    const off = usage('lane-a', { disabled: true });
    w = { usage: [off, ...w.usage.slice(1)], lanes: { ...w.lanes, 'lane-a': wire(off, { verdict: 'ok', at: now - 60_000 }) } };
    await act(async () => { ack(json(200, { ok: true, roster: ROSTER, lane: w.lanes['lane-a'] })); });
    await waitFor(() => expect(knob('lane-a')).toHaveAttribute('aria-checked', 'false'));
    expect(knob('lane-a')).not.toHaveAttribute('aria-busy');
    expect(within(card('lane-a')).getByText(switchRow(false, 0))).toBeInTheDocument();
  });

  it('a refused switch never moves, and the row says how many sessions keep running', async () => {
    const w = world();
    stubFetch(() => w, { '/api/accounts/lane-a/disable': async () => json(409, { ok: false, error: 'last-enabled-home' }) });
    const sessions = [fleetSession({ id: 's1', wrapper: 'lane-a' }), fleetSession({ id: 's2', wrapper: 'lane-a' })];
    show(w, { sessions });
    fireEvent.click(knob('lane-a'));
    expect(await screen.findByText('lane-a is the only lane that can take new sessions. Turn another on first.')).toBeInTheDocument();
    expect(knob('lane-a')).toHaveAttribute('aria-checked', 'true');
    expect(switchRow(false, 2)).toBe('Off: no new sessions; the 2 running here keep running.');
    expect(switchRow(false, 1)).toBe('Off: no new sessions; the 1 running here keeps running.');
  });
});

describe('a not-ready lane (spec §10, G19)', () => {
  it("a not-ready lane's knob is disabled with its reason, and offers Check", async () => {
    const w = world();
    const f = stubFetch(() => w, {
      '/api/accounts/lane-d/check': async () => json(200, { ok: true, lane: w.lanes['lane-d'] }),
    });
    show(w);
    expect(knob('lane-d')).toBeDisabled();
    expect(knob('lane-d')).toHaveAttribute('aria-checked', 'false');
    const reason = within(card('lane-d')).getByText("Not ready: the last check didn't pass. Check it first.");
    expect(knob('lane-d')).toHaveAttribute('aria-describedby', reason.id);
    // The legacy lane: never checked.
    expect(knob('lane-l')).toBeDisabled();
    expect(within(card('lane-l')).getByText('Check it once to turn it on')).toBeInTheDocument();
    // Check, which spends a test reply and says so.
    fireEvent.click(within(card('lane-d')).getByRole('button', { name: CHECK_LABEL }));
    await waitFor(() => expect(f).toHaveBeenCalledWith('/api/accounts/lane-d/check', expect.objectContaining({ method: 'POST' })));
    expect(await screen.findByText('lane-d checked: Off.')).toBeInTheDocument();
  });

  it('an on lane that is not ready can still be switched off: readiness never holds the kill switch', () => {
    const w = world();
    w.lanes['lane-a'] = { ...w.lanes['lane-a']!, ready: false, notReadyReason: 'not-checked' };
    stubFetch(() => w, {});
    show(w);
    expect(knob('lane-a')).not.toBeDisabled();
    expect(within(card('lane-a')).queryByText('Check it once to turn it on')).toBeNull();
  });

  it('each box reason has its own sentence', () => {
    expect(notReadyWords('no-lane-state')).toBe('Check it once to turn it on');
    expect(notReadyWords('not-checked')).toBe('Check it once to turn it on');
    expect(notReadyWords('check-failed')).toBe("Not ready: the last check didn't pass. Check it first.");
    expect(notReadyWords('no-credential')).toMatch(/^Not ready: no credential/);
    expect(notReadyWords('seed-unverified')).toMatch(/^Not ready: its first-run setup/);
  });
});

describe('refusals are worded from their code (D-7732)', () => {
  it('a refusal is worded from its code, never from the response text', async () => {
    const w = world();
    const SENTENCE = 'the verb said: /home/someone/.cc-secrets/lane-a-oauth.env is missing';
    stubFetch(() => w, {
      '/api/accounts/lane-a/disable': async () => json(409, { ok: false, error: 'lane-act-refused', verbCode: 'marker-conflict', detail: SENTENCE }),
      '/api/accounts/lane-a/check': async () => new Response(`<html>${SENTENCE}</html>`, { status: 500 }),
    });
    show(w);
    fireEvent.click(knob('lane-a'));
    expect(await screen.findByText('The fleet host refused (marker-conflict): lane-a was not switched.')).toBeInTheDocument();
    fireEvent.click(within(card('lane-a')).getByRole('button', { name: CHECK_LABEL }));
    expect(await screen.findByText("lane-a couldn't be checked.")).toBeInTheDocument();
    expect(document.body.textContent).not.toContain('cc-secrets');
    expect(document.body.textContent).not.toContain('<html>');
  });

  it('every word the routes answer has its sentence, and a sentence in a code field is not printed', () => {
    const e = (body: unknown): unknown => ({ status: 409, body });
    expect(laneActRefusal('switch', 'lane-a', e({ error: 'not-ready', reason: 'check-failed' }))).toBe(notReadyWords('check-failed'));
    // The verb ran, and the lane-state file didn't take it: nothing the screen holds is this check's result (D-8051 (17)).
    expect(laneActRefusal('check', 'lane-a', e({ error: 'check-unrecorded' })))
      .toBe("The check ran, but its result couldn't be read back from the fleet host, so what this screen shows for lane-a is out of date. Run it on the fleet host to see the result: ccrc account check --id lane-a");
    expect(laneActRefusal('switch', 'lane-a', e({ error: 'lane-busy' }))).toBe('lane-a is busy with another account change. Try again in a moment.');
    expect(laneActRefusal('switch', 'lane-a', e({ error: 'outcome-unknown' })))
      .toBe("The fleet host didn't answer in time, so whether lane-a was switched is unknown. The screen reads it again.");
    expect(laneActRefusal('check', 'lane-a', e({ error: 'Some Sentence With Spaces' }))).toBe("lane-a couldn't be checked.");
    expect(laneActRefusal('switch', 'lane-a', e({ error: 'lane-act-refused', verbCode: 'a sentence' })))
      .toBe('The fleet host refused: lane-a was not switched.');
    expect(laneActRefusal('switch', 'lane-a', new TypeError('Failed to fetch')))
      .toBe("The request didn't complete, so whether lane-a was switched is unknown. The screen reads it again.");
  });
});

describe('Check again and the screen that cannot act', () => {
  it("the trouble card's Check again calls the same route", async () => {
    const w = world();
    const f = stubFetch(() => w, { '/api/accounts/lane-b/check': async () => json(200, { ok: true, lane: w.lanes['lane-b'] }) });
    show(w);
    fireEvent.click(within(card('lane-b')).getByRole('button', { name: CHECK_AGAIN_LABEL }));
    await waitFor(() => expect(f).toHaveBeenCalledWith('/api/accounts/lane-b/check', expect.objectContaining({ method: 'POST' })));
  });

  it('no connect draws no knob row and no Check again; a fleet that cannot run the acts says so beneath a disabled knob', () => {
    const w = world();
    stubFetch(() => w, {});
    show(w, { connect: null });
    expect(document.querySelector('.acct-knob')).toBeNull();
    expect(screen.queryByRole('button', { name: CHECK_AGAIN_LABEL })).toBeNull();
    cleanup();
    show(w, { connect: { ...CONNECT, accountOps: 'unsupported' } });
    expect(knob('lane-a')).toBeDisabled();
    expect(within(card('lane-a')).getByText('The fleet host needs an update before lanes can be switched or checked here.')).toBeInTheDocument();
    expect(within(card('lane-a')).queryByRole('button', { name: CHECK_LABEL })).toBeNull();
    expect(screen.queryByRole('button', { name: CHECK_AGAIN_LABEL })).toBeNull();
  });
});

describe('the off row offers Move N sessions off (spec §10, §4.5; Task A3, D-7736)', () => {
  // lane-d is off with one live session, one asleep and one dead; lane-a is on with a live session; lane-l is off with
  // none. The count is the sheet's (`sessionsToMove`): the asleep one is counted, the dead one has nothing to move.
  const SESSIONS = [
    fleetSession({ id: 'lane-d:p-one', wrapper: 'lane-d', home: 'lane-d', project: 'p-one', title: 'one' }),
    hibernatedSession(now - 60_000, { id: 'lane-d:p-two', wrapper: 'lane-d', home: 'lane-d', project: 'p-one', title: 'two' }),
    deadSession({ id: 'lane-d:p-three', wrapper: 'lane-d', home: 'lane-d', project: 'p-one', title: 'three' }),
    fleetSession({ id: 'lane-a:p-one', wrapper: 'lane-a', home: 'lane-a', project: 'p-one', title: 'stays' }),
  ];
  const moveOn = (id: string): HTMLElement | null =>
    within(card(id).querySelector('.acct-knob') as HTMLElement).queryByRole('button', { name: /^Move \d+ sessions? off$/ });

  it('shown on an off row with its count, beside the knob', () => {
    stubFetch(world, {});
    show(world(), { sessions: SESSIONS });
    const move = moveOn('lane-d');
    expect(move).not.toBeNull();
    expect(move).toHaveTextContent('Move 2 sessions off');
    // It sits on the knob row, before the reason line beneath it.
    const reason = within(card('lane-d')).getByText("Not ready: the last check didn't pass. Check it first.");
    expect(move!.compareDocumentPosition(reason) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('absent at zero, and absent while the lane is on', () => {
    stubFetch(world, {});
    show(world(), { sessions: SESSIONS });
    expect(moveOn('lane-l'), 'an off lane with no sessions to move').toBeNull();
    expect(moveOn('lane-a'), 'an on lane: the kill switch row offers no move').toBeNull();
    cleanup();
    show(world(), { sessions: [deadSession({ id: 'lane-d:p-three', wrapper: 'lane-d', home: 'lane-d', project: 'p-one' })] });
    expect(moveOn('lane-d'), 'a dead pane has nothing to move').toBeNull();
  });

  it('opens the Move sessions sheet for that lane', async () => {
    stubFetch(world, {});
    show(world(), { sessions: SESSIONS });
    fireEvent.click(moveOn('lane-d')!);
    const sheet = await screen.findByRole('dialog');
    expect(within(sheet).getByText('Move sessions off lane-d')).toBeInTheDocument();
    expect(within(sheet).getByText('one')).toBeInTheDocument();
    expect(within(sheet).getByText('two')).toBeInTheDocument();
    expect(within(sheet).queryByText('three')).toBeNull();
    expect(within(sheet).queryByText('stays')).toBeNull();
  });
});

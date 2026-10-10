// Box-token lifecycle wave 1, Task B6 (spec 4.7, D-4392): the Settings "Box
// token" card and its "Rotate now" button. The card reads ONE object, the
// `boxToken` field of `GET /api/updates`, through ONE reader (`readBoxTokenView`),
// and renders the server's own words: it decides nothing about the rotation.
//
// The idiom is settings-screen.test.tsx's: the full afterEach (cleanup,
// restoreAllMocks, the route back to '/', the fleet store reset), `api` spied,
// never a live fetch.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { NodeWire, UpdatesView } from '../../shared/api';
import type { BoxTokenView, RotateAnswer } from '../../shared/box-token';
import { BOX_TOKEN_PHASES, TOKEN_HOLDS } from '../../shared/box-token';
import { SettingsScreen, boxTokenHoldText, boxTokenStateText, boxTokenTransportText } from '../src/screens/SettingsScreen';
import { asUpdatesView } from '../src/fleet/useUpdatesView';
import { ApiError, api, createApi, readBoxTokenView } from '../src/lib/api';
import { navigate } from '../src/lib/router';
import { useFleetStore } from '../src/stores/fleet';
import { ToastHost } from '@ccrc/ui';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  navigate('/');
  act(() => useFleetStore.setState({ sessions: [], conn: 'connecting', notices: [], blocked: false }));
});

const MIN = 60_000;
const BT = (over: Partial<BoxTokenView> = {}): BoxTokenView => ({
  phase: 'idle', origin: 'rotated', currentSeq: 4, currentSince: Date.now() - 90 * MIN,
  lastRotationAt: Date.now() - 90 * MIN, rotationOwed: false, owedWhy: null, hold: null, holdNode: null,
  failures: 0, lastFailure: null, banner: false, fleetConfirmed: 'current', fleetTransport: 'https',
  lastSync: { at: Date.now() - 90 * MIN, word: 'synced' }, previousPresented: 0, retiredPresented: 0,
  retiredRefused: true, lastBootRecovery: null, role: 'server', stalled: null, fileProblem: null,
  ...over,
});
const node = (over: Partial<NodeWire> = {}): NodeWire => ({
  nodeId: '0f0e0d0c-0b0a-4908-8706-050403020100', role: 'fleet', label: 'fleet', os: 'linux',
  current: { sha: 'a'.repeat(40), ref: 'main', builtAt: '2026-10-07T12:00:00Z', dirty: false, version: 'v0.0.9' },
  stampRead: 'ok', installState: 'complete', provenance: 'verified',
  caps: ['verify'], agentOps: [], highestVersion: 'v0.0.9', previousVersion: null,
  floorRead: 'measured', previousRead: 'absent', measuredAt: 1_000, reachable: true, unreachableSince: null,
  channel: 'stable', desiredTag: 'v0.0.9', resolveDetail: null, request: null, report: null,
  update: { state: 'idle', target: null, startedAt: null, detail: null },
  ...over,
});
const view = (boxToken: unknown, over: Partial<UpdatesView> = {}): UpdatesView => ({
  catalogue: { lastOkAt: null, lastError: null }, releases: [], nodes: [node()], intent: [],
  ...(boxToken === undefined ? {} : { boxToken: boxToken as BoxTokenView }),
  ...over,
});
/** Mount the screen over one answer; resolves with the card's region once it has rendered. */
const mount = async (v: UpdatesView): Promise<HTMLElement> => {
  vi.spyOn(api, 'updates').mockResolvedValue(v);
  render(<><ToastHost /><SettingsScreen /></>);
  return screen.findByRole('region', { name: 'Box token' });
};

describe('readBoxTokenView — the ONE reader of UpdatesView.boxToken', () => {
  it('hands back a well-formed view unchanged', () => {
    const v = BT();
    expect(readBoxTokenView(v)).toEqual(v);
    expect(readBoxTokenView(BT({ phase: 'held', hold: 'update-in-flight', holdNode: 'fleet', fleetTransport: null,
      lastSync: null, lastBootRecovery: { at: 5, source: 'previous' }, origin: null, currentSeq: null, currentSince: null })))
      .not.toBeNull();
  });

  it.each([
    ['absent', undefined],
    ['null', null],
    ['an array', []],
    ['a phase this build does not know', { ...BT(), phase: 'rotating' }],
    ['a hold this build does not know', { ...BT(), hold: 'window' }],
    ['an owed reason this build does not know', { ...BT(), rotationOwed: true, owedWhy: 'weekly' }],
    ['a transport that is neither http, https, unmeasured nor null', { ...BT(), fleetTransport: 'ws' }],
    ['a fleet word this build does not know', { ...BT(), fleetConfirmed: 'maybe' }],
    ['a count that is not a non-negative integer', { ...BT(), retiredPresented: -1 }],
    ['failures as a string', { ...BT(), failures: '3' }],
    ['banner missing', (() => { const { banner: _b, ...rest } = BT(); return rest; })()],
    ['a lastSync with no word', { ...BT(), lastSync: { at: 5 } }],
    ['a boot recovery from a third source', { ...BT(), lastBootRecovery: { at: 5, source: 'current' } }],
    ['a role this build does not know', { ...BT(), role: 'edge' }],
    ['a stall with a reason this build does not know', { ...BT(), stalled: { why: 'weekly', since: 5 } }],
    ['a file finding this build does not know', { ...BT(), fileProblem: { at: 5, file: 'current', word: 'stolen' } }],
  ])('%s reads as null — "not reported", never a made-up idle', (_w, raw) => {
    expect(readBoxTokenView(raw)).toBeNull();
  });
});

describe('the card words (spec 4.7)', () => {
  it('names every phase and every hold the server can send, in words', () => {
    for (const phase of BOX_TOKEN_PHASES) expect(boxTokenStateText(BT({ phase })), phase).not.toBe('');
    for (const hold of TOKEN_HOLDS) expect(boxTokenHoldText(hold, null), hold).toMatch(/^held: /);
    expect(boxTokenHoldText('update-in-flight', 'fleet')).toBe('held: an update is in flight on fleet');
    expect(boxTokenHoldText('agent-predates-op', null)).toBe('held: fleet agent predates token-sync');
  });

  // F6 (review 362): the card's six fleet sentences, each pinned by its exact text. A `Record` keyed by the server's
  // word, so a word this build gains has no entry here and `satisfies` fails the typecheck until it is pinned.
  const FLEET_SENTENCES = {
    current: 'fleet: confirmed the current generation',
    behind: 'fleet: not on the current generation',                   // F3: says only what `behind` means, nothing about older or newer
    absent: 'fleet: no generation recorded on the fleet box',
    unreadable: "fleet: the fleet box's generation file could not be read",
    'own-write': 'fleet: this box writes the fleet copy itself',
    unknown: 'fleet: not yet measured',
  } as const satisfies Record<BoxTokenView['fleetConfirmed'], string>;

  it.each(Object.entries(FLEET_SENTENCES))('the fleet word %s renders exactly "%s" and no other fleet sentence', async (word, sentence) => {
    const card = await mount(view(BT({ fleetConfirmed: word as BoxTokenView['fleetConfirmed'] })));
    expect(within(card).getByText(sentence)).toBeInTheDocument();
    const fleetLines = within(card).getAllByText(/^fleet: /).map((e) => e.textContent);
    expect(fleetLines).toEqual([sentence]);
  });

  it('`behind` never says which side the fleet is on (review 362 F3)', async () => {
    const card = await mount(view(BT({ fleetConfirmed: 'behind' })));
    expect(card.textContent ?? '').not.toMatch(/older|newer|holds an/);
  });

  // F1 (review 362): the view a box with history whose boot mint failed now answers (see token-rotation-e2e.test.ts's
  // F1 pin for the server half). The card reads "none" and "not yet measured" from the view's own fields.
  it('a box whose boot mint failed over history: no current value, no fleet confirmation of one', async () => {
    const card = await mount(view(BT({ phase: 'unconfigured', currentSeq: null, currentSince: null, fleetConfirmed: 'unknown',
      stalled: { why: 'mint-failed', since: Date.now() - 5 * MIN } })));
    expect(within(card).getByText('state: no current value')).toBeInTheDocument();
    expect(within(card).getByText('current value: none')).toBeInTheDocument();
    expect(within(card).getByText('fleet: not yet measured')).toBeInTheDocument();
    expect(card.textContent ?? '').not.toMatch(/confirmed the current generation|writes the fleet copy itself|generation #/);
  });

  it('says plain http is unencrypted, and never folds an unmeasured transport into https', () => {
    expect(boxTokenTransportText('http')).toBe('transport: http (unencrypted)');
    expect(boxTokenTransportText('https')).toBe('transport: https');
    expect(boxTokenTransportText('unmeasured')).toBe('transport: not measured');
    expect(boxTokenTransportText(null)).toBe('transport: no sync yet');
  });

  it('renders age, last rotation, state, fleet confirmation, transport and both presented counts', async () => {
    const card = await mount(view(BT({ previousPresented: 2, retiredPresented: 1, fleetTransport: 'http' })));
    expect(within(card).getByText('state: idle')).toBeInTheDocument();
    expect(within(card).getByText('current value: generation #4, 1h 30m old')).toBeInTheDocument();
    expect(within(card).getByText('last rotation: 1h 30m ago')).toBeInTheDocument();
    expect(within(card).getByText('fleet: confirmed the current generation')).toBeInTheDocument();
    expect(within(card).getByText('transport: http (unencrypted)')).toBeInTheDocument();
    expect(within(card).getByText('previous still presented: 2 · retired value presented: 1')).toBeInTheDocument();
    expect(within(card).getByText('retired value refused: yes')).toBeInTheDocument();     // spec 10.3, plan assembly
    expect(within(card).queryByRole('alert'), 'no banner below three failures').toBeNull();
  });

  // ── added at plan assembly (review findings) ──
  it('before the first retirement the proof line says not yet', async () => {
    const card = await mount(view(BT({ retiredRefused: false })));
    expect(within(card).getByText('retired value refused: not yet')).toBeInTheDocument();
  });

  it('a stalled rotation raises the alert although no attempt failed; a failed mint does too', async () => {
    const owed = await mount(view(BT({ phase: 'held', hold: 'agent-predates-op', holdNode: 'fleet', rotationOwed: true,
      owedWhy: 'adopted', stalled: { why: 'owed', since: Date.now() - 25 * 60 * MIN } })));
    expect(within(owed).getByRole('alert')).toHaveTextContent('A box-token rotation has been owed for 1d 1h and has not completed (held: fleet agent predates token-sync).');
    cleanup();
    const mint = await mount(view(BT({ phase: 'unconfigured', currentSeq: null, currentSince: null,
      stalled: { why: 'mint-failed', since: Date.now() - 5 * MIN } })));
    expect(within(mint).getByRole('alert')).toHaveTextContent('The server could not mint a box token; every box-token call is refused until a mint succeeds.');
  });

  it('banner and stall together raise exactly ONE alert, and the failure sentence wins', async () => {
    const card = await mount(view(BT({ phase: 'failed', failures: 3, lastFailure: 'proof-failed', banner: true,
      rotationOwed: true, owedWhy: 'adopted', stalled: { why: 'owed', since: Date.now() - 25 * 60 * MIN } })));
    const alerts = within(card).getAllByRole('alert');
    expect(alerts).toHaveLength(1);
    expect(alerts[0]).toHaveTextContent('Box-token rotation has failed 3 times in a row (last: proof-failed).');
    expect(alerts[0]).not.toHaveTextContent('has been owed');
  });

  it('an owed-stall whose `since` is in the future or cannot be placed on a calendar never prints a made-up span', async () => {
    const future = await mount(view(BT({ rotationOwed: true, owedWhy: 'adopted',
      stalled: { why: 'owed', since: Date.now() + 60 * MIN } })));
    expect(within(future).getByRole('alert')).toHaveTextContent('A box-token rotation has been owed for moments and has not completed.');
    cleanup();
    const unplaceable = await mount(view(BT({ rotationOwed: true, owedWhy: 'adopted', stalled: { why: 'owed', since: 1e20 } })));
    expect(within(unplaceable).getByRole('alert').textContent).toBe('A box-token rotation has been owed and has not completed.');
  });

  it('a file finding from the re-read is shown with its file and word', async () => {
    const card = await mount(view(BT({ fileProblem: { at: Date.now() - 5 * MIN, file: 'current', word: 'changed' } })));
    expect(within(card).getByText(/^server token file: current changed on re-read \(the last good value is kept\), /)).toBeInTheDocument();
  });

  it('a held rotation renders the server\'s hold word with its node; an owed one says why', async () => {
    const card = await mount(view(BT({ phase: 'held', hold: 'update-in-flight', holdNode: 'fleet',
      rotationOwed: true, owedWhy: 'adopted', origin: 'adopted' })));
    expect(within(card).getByText('state: held: an update is in flight on fleet')).toBeInTheDocument();
    expect(within(card).getByText('rotation owed: adopted')).toBeInTheDocument();
    expect(within(card).getByText('current value: generation #4, 1h 30m old (hand-made, adopted)')).toBeInTheDocument();
  });

  it('a failed rotation names its word; three in a row raise the banner', async () => {
    const card = await mount(view(BT({ phase: 'failed', failures: 3, lastFailure: 'proof-failed', banner: true })));
    expect(within(card).getByText('state: failed (proof-failed)')).toBeInTheDocument();
    expect(within(card).getByRole('alert')).toHaveTextContent('Box-token rotation has failed 3 times in a row (last: proof-failed).');
  });

  it('a boot recovery is shown with its source', async () => {
    const card = await mount(view(BT({ lastBootRecovery: { at: Date.now() - 5 * MIN, source: 'pending' } })));
    expect(within(card).getByText(/^recovered at boot from the pending file, /)).toBeInTheDocument();
  });

  it('an older server (no field) and a malformed field are two sentences, and neither shows a button', async () => {
    const absent = await mount(view(undefined));
    expect(within(absent).getByText('This server reports no box-token state.')).toBeInTheDocument();
    expect(within(absent).queryByRole('button', { name: 'Rotate now' })).toBeNull();
    cleanup();
    const bad = await mount(view({ phase: 'rotating' }));
    expect(within(bad).getByText('Box-token state: not reported (the server\'s answer could not be read).')).toBeInTheDocument();
    expect(within(bad).queryByRole('button', { name: 'Rotate now' })).toBeNull();
  });

  it('survives asUpdatesView\'s rebuild: a dropped malformed node does not drop the box-token field', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const bt = BT();   // built once: BT() reads Date.now(), so a second call can differ by a millisecond
    const raw = { ...view(bt), nodes: [node(), null] };
    expect(asUpdatesView(raw)?.boxToken).toEqual(bt);
  });

  it('the card puts no value, code or hash on the page: no 43- or 64-character secret shape anywhere', async () => {
    const card = await mount(view(BT({ lastSync: { at: Date.now(), word: 'synced' } })));
    expect(card.textContent ?? '').not.toMatch(/[0-9a-f]{64}|[A-Za-z0-9_-]{43}/);
  });
});

describe('Rotate now', () => {
  it('posts the rotate route once, says what the server answered, and re-polls', async () => {
    const updates = vi.spyOn(api, 'updates').mockResolvedValue(view(BT()));
    const rotate = vi.spyOn(api, 'rotateBoxToken')
      .mockResolvedValue({ ok: true, outcome: 'started', view: BT({ phase: 'staged' }) } satisfies RotateAnswer);
    render(<><ToastHost /><SettingsScreen /></>);
    const card = await screen.findByRole('region', { name: 'Box token' });
    fireEvent.click(within(card).getByRole('button', { name: 'Rotate now' }));
    await within(card).findByText('Rotation started.');
    expect(rotate).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(updates).toHaveBeenCalledTimes(2));
  });

  it.each([
    ['joined', { ok: true, outcome: 'joined', view: BT() }, 'Joined the rotation already running.'],
    ['held', { ok: false, error: 'held', hold: 'stale-client', node: 'fleet', view: BT() },
      'Not started — held: a stale ccrc-api on fleet'],
    ['rate-limited', { ok: false, error: 'rate-limited', retryAfterS: 42 }, 'At most one Rotate now a minute — try again in 42 s.'],
    ['not-configured', { ok: false, error: 'not-configured' }, 'This server runs no box-token driver.'],
    ['unreadable', 'unreadable', "Asked — the server's answer could not be read; the card will re-check."],
  ] as const)('%s: the card says the answer in place', async (_w, answer, said) => {
    vi.spyOn(api, 'updates').mockResolvedValue(view(BT()));
    vi.spyOn(api, 'rotateBoxToken').mockResolvedValue(answer as RotateAnswer | 'unreadable');
    const card = await mount(view(BT()));
    fireEvent.click(within(card).getByRole('button', { name: 'Rotate now' }));
    await within(card).findByText(said);
  });

  it('the button is disabled while a tap is in flight, so a second tap sends nothing', async () => {
    vi.spyOn(api, 'updates').mockResolvedValue(view(BT()));
    const rotate = vi.spyOn(api, 'rotateBoxToken').mockReturnValue(new Promise(() => {}));
    const card = await mount(view(BT()));
    const button = within(card).getByRole('button', { name: 'Rotate now' });
    fireEvent.click(button);
    await waitFor(() => expect(button).toBeDisabled());
    fireEvent.click(button);
    expect(rotate).toHaveBeenCalledTimes(1);
  });
});

describe('api.rotateBoxToken — the route\'s refusals come back as answers, anything else rejects', () => {
  const answer = (status: number, body: unknown): typeof fetch =>
    (async () => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })) as typeof fetch;

  it('POSTs /api/token/rotate with no body', async () => {
    const seen: { url: string; init?: RequestInit }[] = [];
    const f = (async (url: string, init?: RequestInit) => {
      seen.push({ url, init });
      return new Response(JSON.stringify({ ok: true, outcome: 'started', view: BT() }), { status: 200 });
    }) as typeof fetch;
    await expect(createApi(f).rotateBoxToken()).resolves.toMatchObject({ ok: true, outcome: 'started' });
    expect(seen).toHaveLength(1);
    expect(seen[0]!.url).toBe('/api/token/rotate');
    expect(seen[0]!.init?.method).toBe('POST');
    expect(seen[0]!.init?.body).toBeUndefined();
  });

  it.each([
    [409, { ok: false, error: 'held', hold: 'link-down', node: null, view: BT() }],
    [429, { ok: false, error: 'rate-limited', retryAfterS: 30 }],
    [501, { ok: false, error: 'not-configured' }],
  ])('%i resolves as the RotateAnswer it carries', async (status, body) => {
    await expect(createApi(answer(status, body)).rotateBoxToken()).resolves.toEqual(body);
  });

  it.each([
    ['a 409 whose hold word this build does not know', 409, { ok: false, error: 'held', hold: 'window', node: null, view: BT() }],
    ['a 409 whose view is malformed', 409, { ok: false, error: 'held', hold: 'link-down', node: null, view: {} }],
    ['a 500', 500, { ok: false, error: 'internal' }],
    ['a 404', 404, { ok: false, error: 'not-found' }],
  ])('%s rejects with its ApiError', async (_w, status, body) => {
    await expect(createApi(answer(status, body)).rotateBoxToken()).rejects.toBeInstanceOf(ApiError);
  });

  it('a 200 whose body will not parse resolves to unreadable (it may have started)', async () => {
    const f = (async () => new Response('<html>', { status: 200 })) as typeof fetch;
    await expect(createApi(f).rotateBoxToken()).resolves.toBe('unreadable');
  });
});

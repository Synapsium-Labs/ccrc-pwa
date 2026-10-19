// Box-token lifecycle wave 1, Task B6 (spec 4.7, D-4392): the Settings "Box
// token" card and its "Rotate now" button. The card reads ONE object, the
// `boxToken` field of `GET /api/updates`, through ONE reader (`readBoxTokenView`),
// and renders the server's own words: it decides nothing about the rotation.
//
// The idiom is settings-screen.test.tsx's: the full afterEach (cleanup, restoreAllMocks, the route back
// to '/', the fleet store reset) and `api` spied. One live fetch is left: the screen's unarmed-exposure
// banner reads GET /api/auth/status through `readAuthStatus`, a global `fetch` this file does not stub.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { NodeWire, UpdatesView } from '../../shared/api';
import type { BoxTokenView, RotateAnswer } from '../../shared/box-token';
import { BOX_TOKEN_PHASES, TOKEN_HOLDS } from '../../shared/box-token';
import { SettingsScreen, boxTokenHoldText, boxTokenStateText, boxTokenTransportText } from '../src/screens/SettingsScreen';
import { asUpdatesView } from '../src/fleet/useUpdatesView';
import { ApiError, api, apiErrorText, createApi, readBoxTokenView } from '../src/lib/api';
import { navigate } from '../src/lib/router';
import { useFleetStore } from '../src/stores/fleet';
import { ToastHost } from '@ccrc/ui';

// Settings Task R1d (D-5503's words): the card's definition states the schedule's interval, read from
// `TOKEN_ROTATION_INTERVAL_MS` and never typed. So this file runs against a 3-day interval: a card that typed
// "7 days" reds the definition case. The rest of the module is the real one (spread), so every reader and word
// table this file pins is the shipped one. The value lives here, in a test file outside the seven-day scans' roots.
const FIXTURE_INTERVAL_DAYS = 3;
vi.mock('../../shared/box-token', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../shared/box-token')>()),
  TOKEN_ROTATION_INTERVAL_MS: 3 * 24 * 60 * 60_000,
}));

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
/** The screen also mounts the Stall watch and Temp root collector sections, whose hooks read `api.stallWatch()` and
 *  `api.collectLane()`: settle both as a server without the routes (501 not-configured), so neither section's route
 *  issues a live fetch. */
const spySectionReads = (): void => {
  vi.spyOn(api, 'stallWatch').mockRejectedValue(new ApiError(501, { error: 'not-configured' }));
  vi.spyOn(api, 'collectLane').mockRejectedValue(new ApiError(501, { error: 'not-configured' }));
};
/** The card's Details, one string per key/value row, spelled "key: value" (sans key, mono value). */
const detailLines = (card: HTMLElement): string[] =>
  [...card.querySelectorAll<HTMLElement>('details[data-box-token="details"] dl > div')]
    .map((row) => `${row.querySelector('dt')?.textContent ?? ''}: ${row.querySelector('dd')?.textContent ?? ''}`);
/** The card's one summary sentence. */
const summaryOf = (card: HTMLElement): HTMLElement => {
  const el = card.querySelector<HTMLElement>('[data-box-token="summary"]');
  expect(el, 'the card has one summary line').not.toBeNull();
  return el as HTMLElement;
};
/** Mount the screen over one answer; resolves with the card's region once it has rendered. */
const mount = async (v: UpdatesView): Promise<HTMLElement> => {
  vi.spyOn(api, 'updates').mockResolvedValue(v);
  spySectionReads();
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
    // R-g: a word the server sends is looked up in a keyed table; a name every object inherits is not a word.
    ['an inherited key as the fleet word', { ...BT(), fleetConfirmed: 'toString' }],
    ['__proto__ as the fleet word', { ...BT(), fleetConfirmed: '__proto__' }],
    ['an inherited key as a recovery source', { ...BT(), lastBootRecovery: { at: 5, source: 'constructor' } }],
    ['an inherited key as a stall reason', { ...BT(), stalled: { why: 'toString', since: 5 } }],
    ['an inherited key as a file slot', { ...BT(), fileProblem: { at: 5, file: 'hasOwnProperty', word: 'changed' } }],
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
    expect(detailLines(card).filter((l) => l.startsWith('fleet: '))).toEqual([sentence]);
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
    expect(detailLines(card)).toEqual(expect.arrayContaining(['state: no current value', 'current value: none',
      'fleet: not yet measured']));
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
    expect(detailLines(card)).toEqual(expect.arrayContaining([
      'state: idle',
      'current value: generation #4, 1h 30m old',
      'last rotation: 1h 30m ago',
      'fleet: confirmed the current generation',
      'transport: http (unencrypted)',
      'previous still presented: 2',
      'retired value presented: 1',
      'retired value refused: yes',     // spec 10.3, plan assembly
    ]));
    expect(within(card).queryByRole('alert'), 'no banner below three failures').toBeNull();
  });

  // ── added at plan assembly (review findings) ──
  it('before the first retirement the proof line says not yet', async () => {
    const card = await mount(view(BT({ retiredRefused: false })));
    expect(detailLines(card)).toContain('retired value refused: not yet');
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
    expect(detailLines(card).some((l) => /^server token file: current changed on re-read \(the last good value is kept\), /.test(l))).toBe(true);
  });

  it('a held rotation renders the server\'s hold word with its node; an owed one says why', async () => {
    const card = await mount(view(BT({ phase: 'held', hold: 'update-in-flight', holdNode: 'fleet',
      rotationOwed: true, owedWhy: 'adopted', origin: 'adopted' })));
    expect(detailLines(card)).toEqual(expect.arrayContaining(['state: held: an update is in flight on fleet',
      'rotation owed: adopted', 'current value: generation #4, 1h 30m old (hand-made, adopted)']));
  });

  it('a failed rotation names its word; three in a row raise the banner', async () => {
    const card = await mount(view(BT({ phase: 'failed', failures: 3, lastFailure: 'proof-failed', banner: true })));
    expect(detailLines(card)).toContain('state: failed (proof-failed)');
    expect(within(card).getByRole('alert')).toHaveTextContent('Box-token rotation has failed 3 times in a row (last: proof-failed).');
  });

  it('a boot recovery is shown with its source', async () => {
    const card = await mount(view(BT({ lastBootRecovery: { at: Date.now() - 5 * MIN, source: 'pending' } })));
    expect(detailLines(card).some((l) => /^recovered at boot: from the pending file, /.test(l))).toBe(true);
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

  // R-g: the literal is asserted because the screen's own constant is module-local. A `toString` fleet word must read
  // as "not reported", and must never reach the page as the inherited function's source text.
  it('a fleet word that is an inherited key reads as not reported, and never prints a function', async () => {
    const card = await mount(view({ ...BT(), fleetConfirmed: 'toString' }));
    expect(within(card).getByText('Box-token state: not reported (the server\'s answer could not be read).')).toBeInTheDocument();
    expect(within(card).queryByRole('button', { name: 'Rotate now' })).toBeNull();
    expect(card.textContent ?? '').not.toContain('function toString');
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
    spySectionReads();
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

// ── Settings Task R1d: the box token card (spec §5.5; D-5503's words, D-5507's rule that Rotate stays one tap) ──
describe('the box token card: definition, summary, Details, and a one-tap Rotate now (settings Task R1d)', () => {
  const DAY = 24 * 60 * MIN;
  const purposeOf = (card: HTMLElement): string =>
    card.querySelector('[data-box-token="purpose"]')?.textContent ?? '';

  it('the definition names the fleet box, mail and coordination, and the old key working until confirmed', async () => {
    const card = await mount(view(BT()));
    const purpose = purposeOf(card);
    expect(purpose).toMatch(/^The key that sessions and tools on the fleet box use to call this server, for mail and coordination\. /);
    expect(purpose).toContain('hands it to the fleet box itself.');
    expect(purpose).toContain('The old key keeps working until the fleet box confirms the new one, so nothing restarts or drops.');
    // The definition is the card's, whatever the server reports: an older server's card still says what the key is.
    cleanup();
    const absent = await mount(view(undefined));
    expect(purposeOf(absent)).toMatch(/^The key that sessions and tools on the fleet box use/);
  });

  it('the definition\'s interval follows TOKEN_ROTATION_INTERVAL_MS (a 3-day fixture), never a typed one', async () => {
    const card = await mount(view(BT()));
    expect(purposeOf(card)).toContain(`The server makes a new one every ${FIXTURE_INTERVAL_DAYS} days and hands it to the fleet box itself.`);
    expect(card.textContent ?? '').not.toMatch(/\b(?:7|seven)[ -]days?\b|weekly/i);
  });

  it('the summary reads Healthy, with the last rotation and the next, only in idle with the fleet confirmed', async () => {
    const card = await mount(view(BT({ lastRotationAt: Date.now() - (2 * DAY + 60 * MIN), nextRotationAt: Date.now() + 5 * DAY + 60 * MIN })));
    const summary = summaryOf(card);
    expect(summary.textContent).toBe('Healthy · rotated 2 days ago · next in 5 days');
    expect(summary).toHaveClass('settings-note');
    expect(summary).not.toHaveClass('settings-catalogue--amber');
    expect(summary).not.toHaveClass('settings-unarmed');
  });

  it('a box that writes the fleet copy itself is confirmed by construction: Healthy', async () => {
    const card = await mount(view(BT({ fleetConfirmed: 'own-write', nextRotationAt: Date.now() + 5 * DAY + 60 * MIN })));
    expect(summaryOf(card).textContent).toMatch(/^Healthy · /);
  });

  it('an older server (no next instant), a due rotation and an unreadable instant say only what is known', async () => {
    const two = Date.now() - (2 * DAY + 60 * MIN);
    const older = await mount(view(BT({ lastRotationAt: two })));
    expect(summaryOf(older).textContent).toBe('Healthy · rotated 2 days ago');
    cleanup();
    const due = await mount(view(BT({ lastRotationAt: two, nextRotationAt: Date.now() - MIN })));
    expect(summaryOf(due).textContent).toBe('Healthy · rotated 2 days ago · next due now');
    cleanup();
    const odd = await mount(view({ ...BT({ lastRotationAt: two }), nextRotationAt: 'soon' }));
    expect(summaryOf(odd).textContent).toBe('Healthy · rotated 2 days ago');
    cleanup();
    const never = await mount(view(BT({ lastRotationAt: null, origin: 'minted' })));
    expect(summaryOf(never).textContent).toBe('Healthy · never rotated');
  });

  it('while handed out it says the fleet box has yet to confirm and the old key still works', async () => {
    const card = await mount(view(BT({ phase: 'handed-out', fleetConfirmed: 'behind' })));
    expect(summaryOf(card).textContent).toBe('Rotating: waiting for the fleet box to confirm. The old key still works.');
    expect(summaryOf(card)).not.toHaveClass('settings-catalogue--amber');
  });

  it.each([
    ['held', BT({ phase: 'held', hold: 'update-in-flight', holdNode: 'fleet' }), 'Held: an update is in flight on fleet'],
    ['behind', BT({ fleetConfirmed: 'behind' }), 'Behind: fleet not on the current generation'],
  ] as const)('%s is amber and carries its word as well as the tone', async (_w, bt, said) => {
    const card = await mount(view(bt));
    expect(summaryOf(card).textContent).toBe(said);
    expect(summaryOf(card)).toHaveClass('settings-catalogue--amber');
  });

  it('failed is red and carries its word as well as the tone', async () => {
    const card = await mount(view(BT({ phase: 'failed', failures: 1, lastFailure: 'proof-failed' })));
    expect(summaryOf(card).textContent).toBe('Failed (proof-failed)');
    expect(summaryOf(card)).toHaveClass('settings-unarmed');
    expect(summaryOf(card)).not.toHaveClass('settings-catalogue--amber');
  });

  it.each([
    ['held', BT({ phase: 'held', hold: 'link-down' })],
    ['behind', BT({ fleetConfirmed: 'behind' })],
    ['failed', BT({ phase: 'failed', lastFailure: 'timeout' })],
    ['handed out', BT({ phase: 'handed-out' })],
    ['staged', BT({ phase: 'staged' })],
    ['grace', BT({ phase: 'grace' })],
    ['unconfigured', BT({ phase: 'unconfigured', currentSeq: null, currentSince: null })],
    ['idle, fleet not yet measured', BT({ fleetConfirmed: 'unknown' })],
    ['idle, fleet file unreadable', BT({ fleetConfirmed: 'unreadable' })],
    ['idle, no generation on the fleet box', BT({ fleetConfirmed: 'absent' })],
    ['idle, a rotation owed', BT({ rotationOwed: true, owedWhy: 'adopted' })],
    ['idle, a stall', BT({ stalled: { why: 'owed', since: Date.now() - 5 * MIN } })],
    ['idle, three failures', BT({ failures: 3, banner: true, lastFailure: 'timeout' })],
  ] as const)('the summary never reads Healthy when %s', async (_w, bt) => {
    const card = await mount(view(bt));
    expect(summaryOf(card).textContent ?? '').not.toMatch(/Healthy/);
  });

  it('Details holds every key/value line today\'s card shows, closed, and none of them sits outside it', async () => {
    const card = await mount(view(BT({
      rotationOwed: true, owedWhy: 'fleet-behind', previousPresented: 2, retiredPresented: 1,
      lastBootRecovery: { at: Date.now() - 5 * MIN, source: 'previous' },
      fileProblem: { at: Date.now() - 5 * MIN, file: 'pending', word: 'unreadable' },
    })));
    const details = card.querySelector<HTMLDetailsElement>('details[data-box-token="details"]');
    expect(details).not.toBeNull();
    expect(details!.open, 'Details starts closed').toBe(false);
    expect(details!.querySelector('summary')?.textContent).toBe('Details');
    const keys = detailLines(card).map((l) => l.slice(0, l.indexOf(': ')));
    expect(keys).toEqual(['state', 'current value', 'last rotation', 'rotation owed', 'fleet', 'transport', 'last sync',
      'previous still presented', 'retired value presented', 'retired value refused', 'recovered at boot',
      'server token file']);
    expect(detailLines(card)).toEqual(expect.arrayContaining(['state: idle', 'rotation owed: fleet-behind',
      'fleet: confirmed the current generation', 'transport: https', 'previous still presented: 2',
      'retired value presented: 1', 'retired value refused: yes']));
    expect(detailLines(card).find((l) => l.startsWith('last sync: '))).toMatch(/^last sync: synced · /);
    // Sans key, mono value.
    const row = details!.querySelector('dl > div')!;
    expect(row.querySelector('dt')).toHaveClass('settings-note');
    expect(row.querySelector('dd')).toHaveClass('settings-catalogue');
    // Nothing outside Details reads like one of its lines.
    const outside = [...card.querySelectorAll('p')].filter((p) => !details!.contains(p)).map((p) => p.textContent ?? '');
    for (const k of keys) expect(outside.filter((t) => t.startsWith(`${k}: `)), k).toEqual([]);
  });

  it('Details puts no value, code, hash or token prefix on the page', async () => {
    const card = await mount(view(BT({ lastSync: { at: Date.now(), word: 'synced' },
      lastBootRecovery: { at: Date.now(), source: 'pending' }, fileProblem: { at: Date.now(), file: 'current', word: 'changed' } })));
    const values = [...card.querySelectorAll('details[data-box-token="details"] dd')].map((dd) => dd.textContent ?? '');
    expect(values.length).toBeGreaterThan(8);
    for (const v of values) expect(v).not.toMatch(/[0-9a-f]{12,}|[A-Za-z0-9_-]{24,}/);
  });

  it('Rotate now posts the rotate route once, on one tap, with no dialog; ghost, alone at the card\'s foot after Details', async () => {
    vi.spyOn(api, 'updates').mockResolvedValue(view(BT()));
    const rotate = vi.spyOn(api, 'rotateBoxToken').mockReturnValue(new Promise(() => {}));
    const card = await mount(view(BT()));
    expect(card.querySelectorAll('button'), 'Rotate now is the card\'s only action').toHaveLength(1);
    const button = within(card).getByRole('button', { name: 'Rotate now' });
    expect(button).toHaveClass('btn-ghost');
    expect(button.className).not.toMatch(/danger/);
    const foot = card.querySelector<HTMLElement>('[data-box-token="foot"]');
    expect(foot, 'the foot').not.toBeNull();
    expect(foot!.contains(button)).toBe(true);
    expect(foot!.style.borderTopStyle, 'a hairline above the foot').toBe('solid');
    const details = card.querySelector('details[data-box-token="details"]')!;
    expect(details.compareDocumentPosition(foot!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    fireEvent.click(button);
    expect(rotate).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.queryByRole('alertdialog')).toBeNull();
  });

  it('Rotate now carries its note and its when-line under it', async () => {
    const card = await mount(view(BT()));
    const foot = card.querySelector<HTMLElement>('[data-box-token="foot"]')!;
    expect(foot.textContent).toContain('Starts a rotation now instead of waiting for the next scheduled one. Nothing restarts; the old key keeps working until the fleet box confirms.');
    expect(foot.textContent).toContain('You think the key has leaked.');
  });

  const lineUnderRotate = async (card: HTMLElement, text: string, tone: 'answer' | 'refusal'): Promise<void> => {
    const button = within(card).getByRole('button', { name: 'Rotate now' });
    const line = await waitFor(() => {
      const next = button.nextElementSibling as HTMLElement | null;
      expect(next, 'the line sits directly under Rotate now').not.toBeNull();
      expect(next).toHaveTextContent(text);
      return next as HTMLElement;
    });
    expect(line).toHaveAttribute('role', 'status');
    expect(line).toHaveClass('settings-result');
    if (tone === 'refusal') expect(line).toHaveClass('settings-catalogue--amber');
    else expect(line).not.toHaveClass('settings-catalogue--amber');
    expect(document.querySelector('.toast'), 'not a toast: Rotate now is still on screen').toBeNull();
  };

  it.each([
    ['started', { ok: true, outcome: 'started', view: BT() }, 'Rotation started.', 'answer'],
    ['rate-limited', { ok: false, error: 'rate-limited', retryAfterS: 42 }, 'At most one Rotate now a minute — try again in 42 s.', 'refusal'],
    ['held', { ok: false, error: 'held', hold: 'stale-client', node: 'fleet', view: BT() }, 'Not started — held: a stale ccrc-api on fleet', 'refusal'],
  ] as const)('Rotate\'s answer is a line under it, not a toast: %s', async (_w, answer, said, tone) => {
    vi.spyOn(api, 'updates').mockResolvedValue(view(BT()));
    vi.spyOn(api, 'rotateBoxToken').mockResolvedValue(answer as RotateAnswer);
    const card = await mount(view(BT()));
    fireEvent.click(within(card).getByRole('button', { name: 'Rotate now' }));
    await lineUnderRotate(card, said, tone);
  });

  it('Rotate\'s failure is a line under it, not a toast', async () => {
    vi.spyOn(api, 'updates').mockResolvedValue(view(BT()));
    const err = new ApiError(500, { ok: false, error: 'internal' });
    vi.spyOn(api, 'rotateBoxToken').mockRejectedValue(err);
    const card = await mount(view(BT()));
    fireEvent.click(within(card).getByRole('button', { name: 'Rotate now' }));
    await lineUnderRotate(card, apiErrorText(err), 'refusal');
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

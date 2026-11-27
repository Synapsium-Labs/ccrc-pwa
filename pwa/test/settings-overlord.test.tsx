// Settings › Overlord (Overlord W1 home C, Task 8): the section's cards in every store state, and each card's door. The console
// sends; the door asks the step-up, refuses or warns (the brief's ruling 1), so a narrowing lands in one tap and a widening only
// after the door's step. The api object is spied; neutral names only: the repository is public.
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { RosterWire } from '../../shared/api';
import type { DesignationView } from '../../shared/overlord-designation';
import { ApiError, OVERLORD_PLACE_REFUSAL_TEXT, OVERLORD_SETTINGS_REFUSAL_TEXT, api } from '../src/lib/api';
import { navigate } from '../src/lib/router';
import { OVERLORD_SETTINGS_WORDS as W } from '../src/overlord/overlordSettingsWords';
import type { ReadState } from '../src/overlord/readState';
import { OverlordSection } from '../src/screens/settings/OverlordSection';
import { useFleetStore } from '../src/stores/fleet';
import { useOverlordStore } from '../src/stores/overlord';
import { TEST_ROSTER } from './rosterFixture';

const AT = 1_700_000_000_000;
const ID = 'lane-a-overlord';
const row = (over: Partial<DesignationView> = {}): DesignationView => ({
  bound: null, pending: null, term: 2, designatedTerm: 1, model: 'opus', accountPools: { pools: ['pool-a', 'pool-b'], untagged: false },
  pastIds: [], actor: 'operator', lastAttempt: null, stopsOwed: [], ...over,
});
const BOUND = row({ bound: { sessionId: ID, generation: 'g1' } });
type Read = ReadState<DesignationView | null>;
const answered = (value: DesignationView | null): Read => ({ state: 'answered', value, at: AT });
const ROSTER: RosterWire[] = [
  { ...TEST_ROSTER[0]!, id: 'lane-a', label: 'Lane A', pool: 'pool-a' },
  { ...TEST_ROSTER[1]!, id: 'lane-b', label: 'Lane B', pool: 'pool-b' },
  { ...TEST_ROSTER[2]!, id: 'lane-c', label: 'Lane C', pool: 'pool-c' },
];
const stepUpRequired = (): ApiError => new ApiError(403, { ok: false, error: 'step-up-required' });
const BACKSTOP = { ok: true, hour: 4, zone: 'UTC', isDefault: true, setAt: null };
const RETENTION = { ok: true as const, days: 30, min: 7, max: 90, default: 30 };

let refresh: Mock<() => Promise<void>>;
const client = () => ({
  stepUpStart: vi.fn().mockResolvedValue({ allowCredentialIdsB64url: [] }),
  stepUpFinish: vi.fn(),
  stepUpPassphrase: vi.fn().mockResolvedValue({ stepUpFreshUntil: Date.now() + 300_000 }),
});
let stepClient: ReturnType<typeof client>;

function show(designation: Read): ReturnType<typeof render> {
  act(() => useOverlordStore.setState({ caps: { state: 'answered', value: ['overlord-v1'], at: AT }, designation, refresh }));
  return render(<OverlordSection stepUpDeps={{ client: stepClient }} />);
}
const settle = async (): Promise<void> => { await act(async () => { await new Promise((r) => setTimeout(r, 0)); }); };
const card = (name: string): HTMLElement => document.querySelector<HTMLElement>(`[data-settings-card="${name}"]`)!;
const controlsIn = (name: string): string[] =>
  [...(card(name)?.querySelectorAll('[data-settings-control]') ?? [])].map((e) => e.getAttribute('data-settings-control')!);
const press = (control: string): void => { fireEvent.click(document.querySelector(`[data-settings-control="${control}"]`)!); };
const confirmStep = async (): Promise<void> => {
  fireEvent.change(await screen.findByLabelText('Passphrase'), { target: { value: 'a passphrase' } });
  fireEvent.click(screen.getByRole('button', { name: 'Confirm with passphrase' }));
};

beforeEach(() => {
  refresh = vi.fn<() => Promise<void>>().mockResolvedValue(undefined);
  stepClient = client();
  vi.spyOn(api, 'renewalBackstop').mockResolvedValue(BACKSTOP);
  vi.spyOn(api, 'responseRetention').mockResolvedValue(RETENTION);
  vi.spyOn(api, 'accountHolds').mockResolvedValue({ ok: true, holds: [] });
  act(() => {
    useFleetStore.setState({ roster: ROSTER, accountsHeard: true, refreshAccounts: vi.fn().mockResolvedValue('ok') });
    navigate('/settings/overlord');
  });
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

describe('every card in each store state', () => {
  it('absent: one sentence, and no card and no control at all', async () => {
    show({ state: 'absent' });
    await settle();
    expect(screen.getByText(W.absent)).toBeTruthy();
    expect(document.querySelectorAll('[data-settings-card]')).toHaveLength(0);
    expect(screen.queryAllByRole('button')).toHaveLength(0);
  });

  it.each<[string, Read, string]>([
    ['loading', { state: 'loading' }, 'loading'],
    ['unmeasured', { state: 'unmeasured', error: 'HTTP 503' }, 'unmeasured'],
  ])('%s: the designation cards draw their sentence and no control; the other cards still draw', async (_n, read, kind) => {
    show(read);
    await settle();
    for (const c of ['designation', 'model', 'account-set']) {
      expect(card(c).querySelector(`[data-settings-gate="${c}:${kind}"]`), c).not.toBeNull();
      expect(controlsIn(c), c).toEqual([]);
    }
    expect(controlsIn('backstop')).toEqual(['backstop-save']);
    expect(controlsIn('retention')).toEqual(['retention-save']);
    expect(card('accounts').querySelectorAll('[data-fact-control]').length).toBe(ROSTER.length * 4);
  });

  it('none: "Start the Overlord first", with the place\'s Start link only', async () => {
    show(answered(null));
    await settle();
    expect(controlsIn('designation')).toEqual(['start-on-place']);
    expect(within(card('designation')).getByText(W.none)).toBeTruthy();
    expect(controlsIn('model')).toEqual([]);
    expect(within(card('model')).getByText(W.none)).toBeTruthy();
    expect(controlsIn('account-set')).toEqual([]);
    expect(controlsIn('backstop')).toEqual(['backstop-save']);
  });

  it('answered: each card draws its controls, and Retire only while something is bound', async () => {
    show(answered(BOUND));
    await settle();
    expect(controlsIn('designation')).toEqual(['open-place', 'retire']);
    expect(within(card('designation')).getByText(`Bound to ${ID} (term 2).`)).toBeTruthy();
    expect(controlsIn('model')).toEqual(['model-save']);
    expect(controlsIn('account-set')).toEqual(['set-save', 'set-save-again']);
    expect(document.querySelector('[data-settings-stale]')).toBeNull();
    cleanup();
    show(answered(row()));
    await settle();
    expect(controlsIn('designation')).toEqual(['open-place']);
  });

  it('stale: the controls stay, and each designation card says when it was last read', async () => {
    show({ state: 'stale', value: BOUND, at: AT, error: 'timeout' });
    await settle();
    expect(controlsIn('designation')).toEqual(['open-place', 'retire']);
    for (const c of ['designation', 'model', 'account-set']) {
      expect(card(c).querySelector(`[data-settings-stale="${c}"]`)?.textContent, c).toBe(W.stale(AT));
    }
  });
});

describe('Retire', () => {
  it('draws the answer\'s stopped and owed, and reads the designation again', async () => {
    vi.spyOn(api, 'overlordRetire').mockResolvedValue({ ok: true, changed: true, term: 2, stopped: [ID], owed: ['lane-b-overlord'] });
    show(answered(BOUND));
    await settle();
    press('retire');
    expect(await screen.findByText(`Stopped: ${ID}.`)).toBeTruthy();
    expect(screen.getByText('Still owed a stop: lane-b-overlord. Retire again to try the stop again.')).toBeTruthy();
    await waitFor(() => expect(refresh).toHaveBeenCalledTimes(1));
  });

  it('the door\'s step-up is drawn in its own card, and Retire runs again only when pressed', async () => {
    const retire = vi.spyOn(api, 'overlordRetire').mockRejectedValueOnce(stepUpRequired()).mockResolvedValue({ ok: true, changed: true, term: 2, stopped: [], owed: [] });
    show(answered(BOUND));
    await settle();
    press('retire');
    await waitFor(() => expect(card('designation').querySelector('[data-step-up]')).not.toBeNull());
    expect(document.querySelectorAll('[data-step-up]')).toHaveLength(1);
    await confirmStep();
    await waitFor(() => expect(document.querySelector('[data-step-up]')).toBeNull());
    expect(retire).toHaveBeenCalledTimes(1);
    press('retire');
    await waitFor(() => expect(retire).toHaveBeenCalledTimes(2));
  });
});

describe('the model class', () => {
  it('opus lands in one tap: the console adds no step the door does not ask', async () => {
    // The plan's hand mutant: ask the step-up in the console for an `opus` save. This case goes red.
    const model = vi.spyOn(api, 'overlordModel').mockResolvedValue({ ok: true, changed: true, model: 'opus', warnings: [], written: [] });
    show(answered(row({ model: 'fable', bound: { sessionId: ID, generation: 'g1' } })));
    await settle();
    fireEvent.click(screen.getByRole('radio', { name: 'Opus' }));
    press('model-save');
    expect(await screen.findByText(`Set to Opus. ${W.modelLater}`)).toBeTruthy();
    expect(model).toHaveBeenCalledTimes(1);
    expect(model).toHaveBeenCalledWith('opus');
    expect(stepClient.stepUpStart).not.toHaveBeenCalled();
    expect(document.querySelector('[data-step-up]')).toBeNull();
  });

  it('fable goes through the door\'s step, then acts once more when pressed again', async () => {
    const model = vi.spyOn(api, 'overlordModel').mockRejectedValueOnce(stepUpRequired()).mockResolvedValue({ ok: true, changed: true, model: 'fable', warnings: [], written: [] });
    show(answered(BOUND));
    await settle();
    fireEvent.click(screen.getByRole('radio', { name: 'Fable' }));
    press('model-save');
    await waitFor(() => expect(card('model').querySelector('[data-step-up]')).not.toBeNull());
    await confirmStep();
    await waitFor(() => expect(document.querySelector('[data-step-up]')).toBeNull());
    expect(model).toHaveBeenCalledTimes(1);
    press('model-save');
    await waitFor(() => expect(model).toHaveBeenCalledTimes(2));
    expect(model).toHaveBeenLastCalledWith('fable');
  });

  it('not-found after an answer reads "no designation row"; read before one, it says the door did not answer', async () => {
    let reject!: (e: unknown) => void;
    vi.spyOn(api, 'overlordModel').mockRejectedValueOnce(new ApiError(404, { ok: false, error: 'not-found' }))
      .mockImplementationOnce(() => new Promise((_r, rej) => { reject = rej; }));
    show(answered(BOUND));
    await settle();
    fireEvent.click(screen.getByRole('radio', { name: 'Fable' }));
    press('model-save');
    expect(await screen.findByText(OVERLORD_SETTINGS_REFUSAL_TEXT['no-row'])).toBeTruthy();
    // The store's read goes unmeasured while the next save is in flight: its 404 is read before an answer.
    press('model-save');
    act(() => useOverlordStore.setState({ designation: { state: 'unmeasured', error: 'HTTP 503' } }));
    await act(async () => { reject(new ApiError(404, { ok: false, error: 'not-found' })); });
    expect(await screen.findByText(OVERLORD_SETTINGS_REFUSAL_TEXT['no-door'])).toBeTruthy();
  });
});

describe('the account set', () => {
  it('draws the saved set in its saved order, with the same pool options as Start', async () => {
    show(answered(row({ accountPools: { pools: ['pool-b', 'pool-a'], untagged: false } })));
    await settle();
    const boxes = [...card('account-set').querySelectorAll('[data-set-box]')].map((b) => b.getAttribute('data-set-box'));
    expect(boxes).toEqual(['pool-b', 'pool-a', 'pool-c', '(untagged)']);
    expect(within(card('account-set')).getByRole('checkbox', { name: 'pool-b' })).toBeChecked();
    expect(within(card('account-set')).getByRole('checkbox', { name: 'pool-c' })).not.toBeChecked();
  });

  it('a narrowing lands in one tap', async () => {
    const save = vi.spyOn(api, 'overlordAccountSet').mockResolvedValue({ ok: true, changed: true, accounts: { list: ['lane-a'], counted: ['lane-a'], unmeasured: [] }, warnings: [] });
    show(answered(BOUND));
    await settle();
    fireEvent.click(within(card('account-set')).getByRole('checkbox', { name: 'pool-b' }));
    press('set-save');
    expect(await screen.findByText('The account set was saved.')).toBeTruthy();
    expect(save).toHaveBeenCalledTimes(1);
    expect(save).toHaveBeenCalledWith({ pools: ['pool-a'], untagged: false });
    expect(stepClient.stepUpStart).not.toHaveBeenCalled();
  });

  it('a widening is refused step-up-required, then acts once after the step, with the same set', async () => {
    const save = vi.spyOn(api, 'overlordAccountSet').mockRejectedValueOnce(stepUpRequired())
      .mockResolvedValue({ ok: true, changed: true, accounts: { list: ['lane-a', 'lane-b', 'lane-c'], counted: ['lane-a', 'lane-b', 'lane-c'], unmeasured: [] }, warnings: [] });
    show(answered(BOUND));
    await settle();
    fireEvent.click(within(card('account-set')).getByRole('checkbox', { name: 'pool-c' }));
    press('set-save');
    await waitFor(() => expect(card('account-set').querySelector('[data-step-up]')).not.toBeNull());
    expect(save).toHaveBeenCalledTimes(1);
    await confirmStep();
    await waitFor(() => expect(document.querySelector('[data-step-up]')).toBeNull());
    press('set-save');
    await waitFor(() => expect(save).toHaveBeenCalledTimes(2));
    expect(save.mock.calls[1]![0]).toEqual({ pools: ['pool-a', 'pool-b', 'pool-c'], untagged: false });
  });

  it('draws each warning, and overlord-single-account\'s count with its sentence', async () => {
    vi.spyOn(api, 'overlordAccountSet').mockResolvedValueOnce({
      ok: true, changed: true, accounts: { list: ['lane-a'], counted: ['lane-a'], unmeasured: [] },
      warnings: [{ warning: 'overlord-single-account', count: 1 }, { warning: 'unknown-pool', pool: 'pool-gone' }],
    }).mockRejectedValueOnce(new ApiError(409, { ok: false, error: 'overlord-single-account', count: 1 }));
    show(answered(row()));
    await settle();
    fireEvent.click(within(card('account-set')).getByRole('checkbox', { name: 'pool-b' }));
    press('set-save');
    expect(await screen.findByText('Only 1 account can serve it: the Overlord needs at least two.')).toBeTruthy();
    expect(within(card('account-set')).getByText(/pool-gone/)).toBeTruthy();
    press('set-save-again');
    expect(await screen.findByText(`${OVERLORD_PLACE_REFUSAL_TEXT['overlord-single-account']} It counts 1.`)).toBeTruthy();
  });

  it('"Save again" re-sends the stored set unchanged, whatever is ticked', async () => {
    const save = vi.spyOn(api, 'overlordAccountSet').mockResolvedValue({ ok: true, changed: false, accounts: { list: [], counted: [], unmeasured: [] }, warnings: [] });
    show(answered(BOUND));
    await settle();
    fireEvent.click(within(card('account-set')).getByRole('checkbox', { name: 'pool-c' }));
    press('set-save-again');
    await waitFor(() => expect(save).toHaveBeenCalledTimes(1));
    expect(save).toHaveBeenCalledWith({ pools: ['pool-a', 'pool-b'], untagged: false });
  });

  it('waits for the accounts to load before it can send', async () => {
    act(() => useFleetStore.setState({ accountsHeard: false }));
    show(answered(BOUND));
    await settle();
    expect(card('account-set').querySelector('[data-settings-set-wait="waiting"]')?.textContent).toBe(W.waitsForAccounts);
    expect((document.querySelector('[data-settings-control="set-save"]') as HTMLButtonElement).disabled).toBe(true);
  });
});

describe('the renewal backstop', () => {
  it('draws "the default" from the read, beside the read\'s own hour and zone', async () => {
    show(answered(null));
    await settle();
    expect(card('backstop').querySelector('[data-settings-backstop]')?.textContent).toBe('Daily at 04:00, UTC (the default).');
  });

  it('a bad hour or zone shows the server\'s detail, and nothing is claimed saved', async () => {
    const set = vi.spyOn(api, 'setRenewalBackstop').mockRejectedValue(new ApiError(400, { ok: false, error: 'bad-request', detail: 'zone must be an IANA time zone name of at most 64 characters' }));
    show(answered(null));
    await settle();
    fireEvent.change(card('backstop').querySelector('[data-settings-input="hour"]')!, { target: { value: '7' } });
    press('backstop-save');
    expect(await screen.findByText(`${OVERLORD_SETTINGS_REFUSAL_TEXT['bad-request']} (zone must be an IANA time zone name of at most 64 characters)`)).toBeTruthy();
    expect(set).toHaveBeenCalledWith({ hour: 7, zone: 'UTC' });
    expect(screen.queryByText(W.saved)).toBeNull();
  });

  it('a save draws what the door stored, with no step-up', async () => {
    vi.spyOn(api, 'setRenewalBackstop').mockResolvedValue({ ok: true, hour: 7, zone: 'UTC', isDefault: false, setAt: AT });
    show(answered(null));
    await settle();
    fireEvent.change(card('backstop').querySelector('[data-settings-input="hour"]')!, { target: { value: '7' } });
    press('backstop-save');
    await waitFor(() => expect(card('backstop').querySelector('[data-settings-backstop]')?.textContent).toBe('Daily at 07:00, UTC.'));
    expect(stepClient.stepUpStart).not.toHaveBeenCalled();
  });

  it('an older server\'s 404 draws no card; an unread one says so, with Read again and no Save', async () => {
    vi.spyOn(api, 'renewalBackstop').mockResolvedValue({ absent: true });
    show(answered(null));
    await settle();
    expect(card('backstop')).toBeNull();
    cleanup();
    vi.spyOn(api, 'renewalBackstop').mockRejectedValue(new ApiError(503, { ok: false, error: 'unavailable' }));
    show(answered(null));
    await settle();
    expect(card('backstop').querySelector('[data-settings-unread="backstop"]')?.textContent).toContain('The backstop could not be read (HTTP 503).');
    expect(controlsIn('backstop')).toEqual([]);
  });
});

describe('the response retention', () => {
  it('the bounds come from the read', async () => {
    vi.spyOn(api, 'responseRetention').mockResolvedValue({ ok: true, days: 8, min: 7, max: 9, default: 30 });
    show(answered(null));
    await settle();
    const options = [...card('retention').querySelectorAll('option')].map((o) => o.textContent);
    expect(options).toEqual(['7', '8', '9']);
  });

  it('raising lands in one tap', async () => {
    const set = vi.spyOn(api, 'setResponseRetention').mockResolvedValue({ ok: true, days: 60, min: 7, max: 90, default: 30 });
    show(answered(null));
    await settle();
    fireEvent.change(card('retention').querySelector('[data-settings-input="days"]')!, { target: { value: '60' } });
    press('retention-save');
    await waitFor(() => expect(set).toHaveBeenCalledTimes(1));
    expect(set).toHaveBeenCalledWith(60);
    expect(stepClient.stepUpStart).not.toHaveBeenCalled();
    expect(await screen.findByText(W.saved)).toBeTruthy();
  });

  it('lowering goes through the door\'s step-up', async () => {
    const set = vi.spyOn(api, 'setResponseRetention').mockRejectedValueOnce(stepUpRequired()).mockResolvedValue({ ok: true, days: 10, min: 7, max: 90, default: 30 });
    show(answered(null));
    await settle();
    fireEvent.change(card('retention').querySelector('[data-settings-input="days"]')!, { target: { value: '10' } });
    press('retention-save');
    await waitFor(() => expect(card('retention').querySelector('[data-step-up]')).not.toBeNull());
    await confirmStep();
    await waitFor(() => expect(document.querySelector('[data-step-up]')).toBeNull());
    press('retention-save');
    await waitFor(() => expect(set).toHaveBeenCalledTimes(2));
  });

  it('an unreadable stored value is said, and the form still offers a save', async () => {
    vi.spyOn(api, 'responseRetention').mockResolvedValue({ ok: true, days: null, unreadable: true, min: 7, max: 90, default: 30 });
    show(answered(null));
    await settle();
    expect(within(card('retention')).getByText(new RegExp(W.retentionStoredUnread))).toBeTruthy();
    expect(controlsIn('retention')).toEqual(['retention-save']);
  });
});

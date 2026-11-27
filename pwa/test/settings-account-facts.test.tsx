// Settings › Overlord › Account facts (Overlord W1 home C, Task 9): each roster account's Fable billing fact, its continuity
// record and its hold. Rows come from the roster, never a name list in source. The door decides the step-up: `credits` and `off`
// land in one tap, and `included` and `on` go through the step even when the stored value already matches. Neutral names only.
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import type { RosterWire } from '../../shared/api';
import { ACCOUNT_FACT_REFUSAL_TEXT, ApiError, OVERLORD_SETTINGS_REFUSAL_TEXT, api } from '../src/lib/api';
import { FACT_WORDS, NOT_SET } from '../src/overlord/overlordSettingsWords';
import { OverlordSection } from '../src/screens/settings/OverlordSection';
import { useFleetStore } from '../src/stores/fleet';
import { useOverlordStore } from '../src/stores/overlord';
import { TEST_ROSTER } from './rosterFixture';

const AT = 1_700_000_000_000;
const lane = (id: string, over: Partial<RosterWire> = {}): RosterWire => ({ ...TEST_ROSTER[0]!, id, label: id, pool: 'pool-a', ...over });
let refreshAccounts: Mock<() => Promise<'ok' | 'error'>>;
const stepClient = () => ({
  stepUpStart: vi.fn().mockResolvedValue({ allowCredentialIdsB64url: [] }),
  stepUpFinish: vi.fn(),
  stepUpPassphrase: vi.fn().mockResolvedValue({ stepUpFreshUntil: Date.now() + 300_000 }),
});
let client: ReturnType<typeof stepClient>;
const settle = async (): Promise<void> => { await act(async () => { await new Promise((r) => setTimeout(r, 0)); }); };

function show(roster: RosterWire[]): ReturnType<typeof render> {
  act(() => {
    useFleetStore.setState({ roster, accountsHeard: true, refreshAccounts });
    useOverlordStore.setState({ caps: { state: 'answered', value: ['overlord-v1'], at: AT }, designation: { state: 'answered', value: null, at: AT }, refresh: vi.fn().mockResolvedValue(undefined) });
  });
  return render(<OverlordSection stepUpDeps={{ client }} />);
}
const row = (id: string): HTMLElement => document.querySelector<HTMLElement>(`[data-account-facts="${id}"]`)!;
const press = (id: string, control: string): void => { fireEvent.click(row(id).querySelector(`[data-fact-control="${control}"]`)!); };
const stepUpRequired = (): ApiError => new ApiError(403, { ok: false, error: 'step-up-required' });

beforeEach(() => {
  refreshAccounts = vi.fn<() => Promise<'ok' | 'error'>>().mockResolvedValue('ok');
  client = stepClient();
  vi.spyOn(api, 'renewalBackstop').mockResolvedValue({ absent: true });
  vi.spyOn(api, 'responseRetention').mockResolvedValue({ absent: true });
  vi.spyOn(api, 'accountHolds').mockResolvedValue({ ok: true, holds: [] });
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

describe('each account\'s facts, read from the roster', () => {
  it('one row per roster account; an absent field reads "not set"', async () => {
    show([lane('lane-a'), lane('lane-b', { fableBilling: 'credits', continuity: { recordedAt: 1_700_000_000 } })]);
    await settle();
    expect([...document.querySelectorAll('[data-account-facts]')].map((e) => e.getAttribute('data-account-facts'))).toEqual(['lane-a', 'lane-b']);
    expect(row('lane-a').querySelector('[data-fact="billing"]')?.textContent).toBe(`${FACT_WORDS.billingLegend}: ${NOT_SET}`);
    expect(row('lane-a').querySelector('[data-fact="continuity"]')?.textContent).toBe(`${FACT_WORDS.continuityLegend}: ${NOT_SET}`);
    expect(row('lane-b').querySelector('[data-fact="billing"]')?.textContent).toBe(`${FACT_WORDS.billingLegend}: Fable bills credits`);
    expect(row('lane-b').querySelector('[data-fact="continuity"]')?.textContent).toMatch(/^Continuity record: Continuity recorded /);
  });

  it('no account name is written in the card\'s source: every row comes from the roster', () => {
    const src = readFileSync(path.join(__dirname, '../src/screens/settings/AccountFactsCard.tsx'), 'utf8');
    for (const a of TEST_ROSTER) expect(src.includes(a.id), a.id).toBe(false);
    expect(src).toMatch(/roster\.map\(/);
  });
});

describe('the door decides the step-up', () => {
  it.each([
    ['credits', { fableBilling: 'credits' }],
    ['continuity-off', { continuity: 'off' }],
  ])('%s lands in one tap', async (control, body) => {
    const set = vi.spyOn(api, 'accountSet').mockResolvedValue({ ok: true } as never);
    show([lane('lane-a')]);
    await settle();
    press('lane-a', control);
    await waitFor(() => expect(set).toHaveBeenCalledTimes(1));
    expect(set).toHaveBeenCalledWith('lane-a', body);
    expect(client.stepUpStart).not.toHaveBeenCalled();
    await waitFor(() => expect(refreshAccounts).toHaveBeenCalledTimes(1));
  });

  it.each([
    ['included', { fableBilling: 'included' }, { fableBilling: 'included' as const }],
    ['continuity-on', { continuity: 'on' }, { continuity: { recordedAt: 1_700_000_000 } }],
  ])('%s goes through the step even when the stored value already matches', async (control, body, stored) => {
    const set = vi.spyOn(api, 'accountSet').mockRejectedValueOnce(stepUpRequired()).mockResolvedValue({ ok: true } as never);
    show([lane('lane-a', stored)]);
    await settle();
    press('lane-a', control);
    await waitFor(() => expect(row('lane-a').querySelector('[data-step-up]')).not.toBeNull());
    fireEvent.change(await screen.findByLabelText('Passphrase'), { target: { value: 'a passphrase' } });
    fireEvent.click(screen.getByRole('button', { name: 'Confirm with passphrase' }));
    await waitFor(() => expect(document.querySelector('[data-step-up]')).toBeNull());
    expect(set).toHaveBeenCalledTimes(1);
    press('lane-a', control);
    await waitFor(() => expect(set).toHaveBeenCalledTimes(2));
    expect(set).toHaveBeenLastCalledWith('lane-a', body);
  });
});

describe('an older fleet node and an unmeasured outcome', () => {
  it('unknown-argument says the node is older, claims nothing saved, and writes nothing more', async () => {
    const set = vi.spyOn(api, 'accountSet').mockRejectedValue(new ApiError(409, { ok: false, error: 'lane-act-refused', verbCode: 'unknown-argument' }));
    show([lane('lane-a')]);
    await settle();
    press('lane-a', 'credits');
    expect(await within(row('lane-a')).findByText(ACCOUNT_FACT_REFUSAL_TEXT.older)).toBeTruthy();
    expect(within(row('lane-a')).queryByText('Saved.')).toBeNull();
    expect(set).toHaveBeenCalledTimes(1);
  });

  it('outcome-unknown says the result was not measured, claims nothing, and reads the roster again', async () => {
    const set = vi.spyOn(api, 'accountSet').mockRejectedValue(new ApiError(504, { ok: false, error: 'outcome-unknown' }));
    show([lane('lane-a')]);
    await settle();
    press('lane-a', 'continuity-off');
    expect(await within(row('lane-a')).findByText(ACCOUNT_FACT_REFUSAL_TEXT.unknown)).toBeTruthy();
    expect(within(row('lane-a')).queryByText('Saved.')).toBeNull();
    await waitFor(() => expect(refreshAccounts).toHaveBeenCalledTimes(1));
    expect(set).toHaveBeenCalledTimes(1);
  });
});

describe('the account-hold Clear', () => {
  it('is drawn only for a held lane, and calls the door once; its answer stays readable after the re-read it triggers (F7)', async () => {
    // The server's own answers: the hold stands on the first read, and the re-read after the clear no longer names it.
    const holds = vi.spyOn(api, 'accountHolds')
      .mockResolvedValueOnce({ ok: true, holds: [{ lane: 'lane-b', cause: 'launch-profile-unmet', startId: 4, heldAt: AT }] })
      .mockResolvedValue({ ok: true, holds: [] });
    let resolve!: (v: unknown) => void;
    const clear = vi.spyOn(api, 'clearAccountHold').mockImplementation(() => new Promise((r) => { resolve = r; }));
    show([lane('lane-a'), lane('lane-b')]);
    await settle();
    expect(row('lane-a').querySelector('[data-hold-clear]')).toBeNull();
    expect(within(row('lane-b')).getByText('Held: launch profile unmet')).toBeTruthy();
    const button = row('lane-b').querySelector<HTMLButtonElement>('[data-hold-clear="lane-b"]')!;
    // A double tap inside one render: the button is not yet disabled for the second, so only the in-flight guard holds it.
    act(() => { button.click(); button.click(); });
    expect(clear).toHaveBeenCalledTimes(1);
    expect(clear).toHaveBeenCalledWith('lane-b');
    expect(client.stepUpStart).not.toHaveBeenCalled();
    await act(async () => { resolve({ ok: true, lane: 'lane-b' }); });
    await settle();
    await waitFor(() => expect(holds).toHaveBeenCalledTimes(2));
    await settle();
    expect(row('lane-b').querySelector('[data-hold-clear]')).toBeNull();
    expect(row('lane-b').querySelector('[data-hold-cleared="lane-b"]')?.textContent).toBe(FACT_WORDS.cleared);
    expect(within(row('lane-b')).queryByText('Held: launch profile unmet')).toBeNull();
  });

  it('a hold that no longer stands says so after the re-read, and draws no button again (F7: the re-read answers as the server would)', async () => {
    const holds = vi.spyOn(api, 'accountHolds')
      .mockResolvedValueOnce({ ok: true, holds: [{ lane: 'lane-a', cause: 'launch-profile-unmet', startId: 4, heldAt: AT }] })
      .mockResolvedValue({ ok: true, holds: [] });
    vi.spyOn(api, 'clearAccountHold').mockRejectedValue(new ApiError(404, { ok: false, error: 'not-found' }));
    show([lane('lane-a')]);
    await settle();
    fireEvent.click(row('lane-a').querySelector('[data-hold-clear="lane-a"]')!);
    expect(await screen.findByText(OVERLORD_SETTINGS_REFUSAL_TEXT['no-hold'])).toBeTruthy();
    await waitFor(() => expect(holds).toHaveBeenCalledTimes(2));
    await settle();
    expect(row('lane-a').querySelector('[data-hold-refusal="lane-a"]')?.textContent).toBe(OVERLORD_SETTINGS_REFUSAL_TEXT['no-hold']);
    expect(row('lane-a').querySelector('[data-hold-clear]')).toBeNull();
  });

  it('a hold that returns after a clear is a new hold: its line and a live Clear, and no old answer (review 4065 F1)', async () => {
    // The server holds a cleared lane again on a later failing start: the re-read names the lane with a new held-at.
    const holds = vi.spyOn(api, 'accountHolds')
      .mockResolvedValueOnce({ ok: true, holds: [{ lane: 'lane-b', cause: 'launch-profile-unmet', startId: 4, heldAt: AT }] })
      .mockResolvedValue({ ok: true, holds: [{ lane: 'lane-b', cause: 'launch-profile-unmet', startId: 5, heldAt: AT + 60_000 }] });
    vi.spyOn(api, 'clearAccountHold').mockResolvedValue({ ok: true, lane: 'lane-b' });
    show([lane('lane-b')]);
    await settle();
    fireEvent.click(row('lane-b').querySelector('[data-hold-clear="lane-b"]')!);
    await waitFor(() => expect(holds).toHaveBeenCalledTimes(2));
    await settle();
    expect(within(row('lane-b')).getByText('Held: launch profile unmet')).toBeTruthy();
    expect(row('lane-b').querySelector<HTMLButtonElement>('[data-hold-clear="lane-b"]')?.disabled).toBe(false);
    expect(row('lane-b').querySelector('[data-hold-cleared]')).toBeNull();
  });

  it('the returned hold supersedes the old answer: when it goes in a re-read another row\'s Clear triggers, the row draws no Clear (review 4065 F1)', async () => {
    const A = { lane: 'lane-a', cause: 'launch-profile-unmet', startId: 4, heldAt: AT };
    const B = { lane: 'lane-b', cause: 'launch-profile-unmet', startId: 4, heldAt: AT };
    const holds = vi.spyOn(api, 'accountHolds')
      .mockResolvedValueOnce({ ok: true, holds: [A, B] })
      .mockResolvedValueOnce({ ok: true, holds: [A, { ...B, startId: 5, heldAt: AT + 60_000 }] })
      .mockResolvedValue({ ok: true, holds: [] });
    vi.spyOn(api, 'clearAccountHold').mockResolvedValue({ ok: true });
    show([lane('lane-a'), lane('lane-b')]);
    await settle();
    fireEvent.click(row('lane-b').querySelector('[data-hold-clear="lane-b"]')!);
    await waitFor(() => expect(holds).toHaveBeenCalledTimes(2));
    await settle();
    fireEvent.click(row('lane-a').querySelector('[data-hold-clear="lane-a"]')!);
    await waitFor(() => expect(holds).toHaveBeenCalledTimes(3));
    await settle();
    expect(row('lane-b').querySelector('[data-account-hold]')).toBeNull();
  });

  it('a refused Clear latches nothing: a re-read that drops the hold leaves no Clear behind (review 4065 F2)', async () => {
    const holds = vi.spyOn(api, 'accountHolds')
      .mockResolvedValueOnce({ ok: true, holds: [{ lane: 'lane-a', cause: 'launch-profile-unmet', startId: 4, heldAt: AT }] })
      .mockResolvedValue({ ok: true, holds: [] });
    vi.spyOn(api, 'clearAccountHold').mockRejectedValue(new ApiError(503, { ok: false, error: 'unavailable' }));
    show([lane('lane-a')]);
    await settle();
    fireEvent.click(row('lane-a').querySelector('[data-hold-clear="lane-a"]')!);
    await waitFor(() => expect(holds).toHaveBeenCalledTimes(2));
    await settle();
    expect(row('lane-a').querySelector('[data-hold-clear]')).toBeNull();
    expect(row('lane-a').querySelector('[data-account-hold]')).toBeNull();
  });

  it('holds that cannot be read are said, and no Clear is drawn', async () => {
    vi.spyOn(api, 'accountHolds').mockRejectedValue(new ApiError(502, { ok: false, error: 'unmeasured' }));
    show([lane('lane-a')]);
    await settle();
    expect(document.querySelector('[data-settings-unread="holds"]')?.textContent).toBe(FACT_WORDS.holdsUnread('HTTP 502'));
    expect(document.querySelector('[data-hold-clear]')).toBeNull();
  });
});

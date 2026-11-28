// Settings › Overlord's private-name list card (Overlord W2 Settings, plan `w2-settings.md` Task 3): its three states, the uncontrolled
// multiline field it types into, Upload (once, through the section's one step-up, the text kept until the door answers), the confirmed
// Clear, and the one rule that outranks the rest: the names are in no state, store, log line, error or markup, only in the box's own
// DOM node. The api object is spied. Synthetic names only (the repository is public), and no name appears in a test's own name.
import { useState, type ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi, type Mock, type MockInstance } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { RosterWire } from '../../shared/api';
import type { DesignationView } from '../../shared/overlord-designation';
import { ApiError, OVERLORD_SETTINGS_REFUSAL_TEXT, api } from '../src/lib/api';
import { navigate } from '../src/lib/router';
import { NAME_LIST_ROW_TEXT, NAME_LIST_WORDS as W } from '../src/overlord/nameListWords';
import type { ReadState } from '../src/overlord/readState';
import { OverlordSection } from '../src/screens/settings/OverlordSection';
import { useFleetStore } from '../src/stores/fleet';
import { useOverlordStore } from '../src/stores/overlord';
import { allFibers, fiberHolds } from './helpers/fiberWalk';
import { TEST_ROSTER } from './rosterFixture';

const AT = 1_700_000_000_000;
const NAMES = ['zz-alpha', 'zq-bravo-x9', 'zz-charlie'] as const;
const TEXT = 'zz-alpha\nexact: zq-bravo-x9';
const ROWS = [{ text: 'zz-alpha', mode: 'part' }, { text: 'zq-bravo-x9', mode: 'exact' }];
const OK = { ok: true, rows: 2, entries: 9, uploadedAt: AT };
const ROSTER: RosterWire[] = [{ ...TEST_ROSTER[0]!, id: 'lane-a', label: 'Lane A', pool: 'pool-a' }];
type Read = ReadState<DesignationView | null>;
const answered = (value: DesignationView | null): Read => ({ state: 'answered', value, at: AT });
const stepUpRequired = (): ApiError => new ApiError(403, { ok: false, error: 'step-up-required' });
const dateOf = (ms: number): string => new Date(ms).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });

let refresh: Mock<() => Promise<void>>;
const client = () => ({
  stepUpStart: vi.fn().mockResolvedValue({ allowCredentialIdsB64url: [] }),
  stepUpFinish: vi.fn(),
  stepUpPassphrase: vi.fn().mockResolvedValue({ stepUpFreshUntil: Date.now() + 300_000 }),
});
let stepClient: ReturnType<typeof client>;

function show(designation: Read = answered(null)): ReturnType<typeof render> {
  act(() => useOverlordStore.setState({ caps: { state: 'answered', value: ['overlord-v1'], at: AT }, designation, refresh }));
  return render(<OverlordSection stepUpDeps={{ client: stepClient }} />);
}
const settle = async (): Promise<void> => { await act(async () => { await new Promise((r) => setTimeout(r, 0)); }); };
const card = (): HTMLElement | null => document.querySelector<HTMLElement>('[data-settings-card="private-names"]');
const box = (): HTMLTextAreaElement => screen.getByLabelText(W.textLabel) as HTMLTextAreaElement;
const type = (text: string): void => { fireEvent.input(box(), { target: { value: text } }); };
const press = (control: string): void => { fireEvent.click(document.querySelector(`[data-settings-control="${control}"]`)!); };
const up = (): HTMLButtonElement => document.querySelector<HTMLButtonElement>('[data-settings-control="names-upload"]')!;
const clr = (): HTMLButtonElement => document.querySelector<HTMLButtonElement>('[data-settings-control="names-clear"]')!;
const confirmStep = async (): Promise<void> => {
  fireEvent.change(await screen.findByLabelText('Passphrase'), { target: { value: 'a passphrase' } });
  fireEvent.click(screen.getByRole('button', { name: 'Confirm with passphrase' }));
};
const refusalText = (kind = 'private-names'): string | undefined =>
  document.querySelector(`[data-settings-refusal="${kind}"]`)?.textContent ?? undefined;

let upload: MockInstance<typeof api.uploadPrivateNames>;
let status: MockInstance<typeof api.privateNameList>;

beforeEach(() => {
  refresh = vi.fn<() => Promise<void>>().mockResolvedValue(undefined);
  stepClient = client();
  vi.spyOn(api, 'renewalBackstop').mockResolvedValue({ absent: true });
  vi.spyOn(api, 'responseRetention').mockResolvedValue({ absent: true });
  vi.spyOn(api, 'accountHolds').mockResolvedValue({ absent: true });
  vi.spyOn(api, 'decisionModel').mockResolvedValue({ absent: true });
  status = vi.spyOn(api, 'privateNameList').mockResolvedValue({ state: 'none' });
  upload = vi.spyOn(api, 'uploadPrivateNames').mockResolvedValue(OK);
  act(() => {
    useFleetStore.setState({ roster: ROSTER, accountsHeard: true, refreshAccounts: vi.fn().mockResolvedValue('ok') });
    navigate('/settings/overlord');
  });
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true });
});

describe('the status', () => {
  it('none: its sentence', async () => {
    show();
    await settle();
    expect(card()!.querySelector('[data-names-state]')?.textContent).toBe(W.none);
    expect(card()!.querySelector('[data-names-state]')?.getAttribute('data-names-state')).toBe('none');
  });

  it('list: the count and when, and no entry count and no hash', async () => {
    // The read carries more than the console may draw; only the count and the time are read.
    status.mockResolvedValue({ state: 'list', rows: 3, uploadedAt: AT, entries: 9, hash: 'abcdef0123' } as never);
    show();
    await settle();
    const said = card()!.querySelector('[data-names-state]')!;
    expect(said.getAttribute('data-names-state')).toBe('list');
    expect(said.textContent).toBe(W.list(3, dateOf(AT)));
    expect(said.textContent).toContain('3 names');
    expect(said.textContent).not.toMatch(/entries|hash|abcdef|\b9\b/);
  });

  it('unreadable: its reason, in words', async () => {
    status.mockResolvedValue({ state: 'unreadable', reason: 'key-mismatch' });
    show();
    await settle();
    expect(card()!.querySelector('[data-names-state]')?.textContent).toBe(W.unreadable('key-mismatch'));
    expect(card()!.querySelector('[data-names-state]')?.getAttribute('data-names-state')).toBe('unreadable');
  });

  it('a 404 read draws no card at all', async () => {
    status.mockResolvedValue({ absent: true });
    show();
    await settle();
    expect(card()).toBeNull();
    expect(screen.queryByLabelText(W.textLabel)).toBeNull();
  });
});

describe('the box', () => {
  it('is a text area: empty on load, unmasked, with every autofill and correction opt-out, and never filled from the read', async () => {
    status.mockResolvedValue({ state: 'list', rows: 3, uploadedAt: AT });
    show();
    await settle();
    const el = box();
    expect(el.tagName).toBe('TEXTAREA');
    expect(el.value).toBe('');
    expect(el.hasAttribute('type')).toBe(false);
    expect(el.getAttribute('spellcheck')).toBe('false');
    expect(el.getAttribute('autocomplete')).toBe('off');
    expect(el.getAttribute('autocorrect')).toBe('off');
    expect(el.getAttribute('autocapitalize')).toBe('off');
    expect(el.hasAttribute('name')).toBe(false);
    // Unmasked: no Show control beside it.
    expect(within_(card()!, 'Show')).toBeNull();
    // After the read has answered a second time, still empty.
    expect(box().value).toBe('');
  });

  it('is emptied when the page is hidden', async () => {
    show();
    await settle();
    type(TEXT);
    act(() => {
      Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true });
      document.dispatchEvent(new Event('visibilitychange'));
    });
    expect(box().value).toBe('');
  });
});

/** The first button in `root` whose text is exactly `name`, or null. */
function within_(root: HTMLElement, name: string): HTMLElement | null {
  return [...root.querySelectorAll<HTMLElement>('button')].find((b) => b.textContent === name) ?? null;
}

describe('Upload', () => {
  it('parses the text, sends the rows once, and after an ok answer empties the box and reads the status again', async () => {
    show();
    await settle();
    expect(status).toHaveBeenCalledTimes(1);
    type(TEXT);
    press('names-upload');
    await waitFor(() => expect(upload).toHaveBeenCalledTimes(1));
    expect(upload).toHaveBeenCalledWith({ rows: ROWS });
    await waitFor(() => expect(box().value).toBe(''));
    await waitFor(() => expect(status).toHaveBeenCalledTimes(2));
    expect(await screen.findByText(W.uploaded(2))).toBeTruthy();
  });

  it('goes once: two presses inside one render call send the door one request', async () => {
    let answer!: (v: unknown) => void;
    upload.mockImplementation(() => new Promise((r) => { answer = r; }));
    show();
    await settle();
    type(TEXT);
    act(() => { press('names-upload'); press('names-upload'); });
    expect(upload).toHaveBeenCalledTimes(1);
    await act(async () => { answer(OK); });
    await settle();
    expect(upload).toHaveBeenCalledTimes(1);
  });

  it('an empty box, and one of blank lines only, sends nothing and says so', async () => {
    show();
    await settle();
    press('names-upload');
    expect(refusalText('private-names-local')).toBe(W.empty);
    type('\n  \n\t\n');
    press('names-upload');
    expect(refusalText('private-names-local')).toBe(W.empty);
    await settle();
    expect(upload).not.toHaveBeenCalled();
  });

  it('a word before the colon that is no mode names its line and sends nothing', async () => {
    show();
    await settle();
    type('zz-alpha\nexat: zq-bravo-x9');
    press('names-upload');
    expect(refusalText('private-names-local')).toBe(W.badMode(2));
    await settle();
    expect(upload).not.toHaveBeenCalled();
    expect(box().value).toBe('zz-alpha\nexat: zq-bravo-x9');
  });

  it('the step-up: shown inside this card only, Upload disabled while it shows, the confirm sends the same rows again by itself; only the ok answer empties the box', async () => {
    upload.mockRejectedValueOnce(stepUpRequired()).mockResolvedValue(OK);
    show();
    await settle();
    type(TEXT);
    press('names-upload');
    await waitFor(() => expect(card()!.querySelector('[data-step-up]')).not.toBeNull());
    expect(document.querySelectorAll('[data-step-up]')).toHaveLength(1);
    expect(upload).toHaveBeenCalledTimes(1);
    expect(box().value).toBe(TEXT);
    // While the step shows, Upload and the box are held, and a click sends nothing.
    expect(up().disabled).toBe(true);
    expect(box().disabled).toBe(true);
    press('names-upload');
    await settle();
    expect(upload).toHaveBeenCalledTimes(1);
    // The confirm starts the retry: no press.
    await confirmStep();
    await waitFor(() => expect(upload).toHaveBeenCalledTimes(2));
    expect(upload).toHaveBeenNthCalledWith(1, { rows: ROWS });
    expect(upload).toHaveBeenNthCalledWith(2, { rows: ROWS });
    await waitFor(() => expect(box().value).toBe(''));
    await settle();
    expect(upload).toHaveBeenCalledTimes(2);
  });

  it('a step-up-required on the automatic retry is final: the box is emptied, no step shows, and the sentence says nothing was uploaded', async () => {
    upload.mockRejectedValue(stepUpRequired());
    show();
    await settle();
    type(TEXT);
    press('names-upload');
    await waitFor(() => expect(card()!.querySelector('[data-step-up]')).not.toBeNull());
    expect(box().value).toBe(TEXT);
    await confirmStep();
    await waitFor(() => expect(upload).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(refusalText('private-names-local')).toBe(W.stepUpFinal));
    expect(box().value).toBe('');
    expect(document.querySelector('[data-step-up]')).toBeNull();
    await settle();
    expect(upload).toHaveBeenCalledTimes(2);
  });

  it('the whole card is held while Upload\'s step shows: the box, Upload and Clear, so no edit or other act reaches the retry, and the door is idle', async () => {
    // Review 4167 F2 (c) and F3. The hold is by attribute: the disabled box takes no keystroke (its only handler is its presence
    // report, which sends nothing) and a disabled button gets no click. The door is idle while the step shows, and nothing of the
    // card can start a send, so the confirm's retry always finds the door free (the in-flight guard is unreachable for it).
    status.mockResolvedValue({ state: 'list', rows: 3, uploadedAt: AT });
    upload.mockRejectedValueOnce(stepUpRequired()).mockResolvedValue(OK);
    show();
    await settle();
    type(TEXT);
    press('names-upload');
    await waitFor(() => expect(card()!.querySelector('[data-step-up]')).not.toBeNull());
    expect(box().disabled).toBe(true);
    expect(up().disabled).toBe(true);
    expect(clr().disabled).toBe(true);
    expect(up().textContent).toBe(W.upload);
    press('names-clear');
    await settle();
    expect(screen.queryByText(W.clearTitle(3))).toBeNull();
    expect(upload).toHaveBeenCalledTimes(1);
    await confirmStep();
    await waitFor(() => expect(upload).toHaveBeenCalledTimes(2));
    expect(upload).toHaveBeenNthCalledWith(2, { rows: ROWS });
    await waitFor(() => expect(box().disabled).toBe(false));
    expect(clr().disabled).toBe(false);
  });

  it('the whole card is held while Clear\'s step shows: Upload and the box too; the confirm retries Clear\'s own body (the mark is per act)', async () => {
    status.mockResolvedValue({ state: 'list', rows: 3, uploadedAt: AT });
    upload.mockRejectedValueOnce(stepUpRequired()).mockResolvedValue({ ok: true, rows: 0, entries: 0, uploadedAt: AT });
    show();
    await settle();
    type(TEXT);
    press('names-clear');
    expect(await screen.findByText(W.clearTitle(3))).toBeTruthy();
    fireEvent.click(document.querySelector('.qc-actions .btn-danger')!);
    await waitFor(() => expect(card()!.querySelector('[data-step-up]')).not.toBeNull());
    expect(box().disabled).toBe(true);
    expect(up().disabled).toBe(true);
    expect(clr().disabled).toBe(true);
    press('names-upload');
    await settle();
    expect(upload).toHaveBeenCalledTimes(1);
    expect(refusalText('private-names-local')).toBeUndefined();
    await confirmStep();
    await waitFor(() => expect(upload).toHaveBeenCalledTimes(2));
    expect(upload).toHaveBeenNthCalledWith(1, { rows: [], clear: true });
    expect(upload).toHaveBeenNthCalledWith(2, { rows: [], clear: true });
    expect(await screen.findByText(W.cleared)).toBeTruthy();
    await settle();
    expect(upload).toHaveBeenCalledTimes(2);
  });

  it('Clear\'s step-up on the automatic retry is final, in Clear\'s own words', async () => {
    status.mockResolvedValue({ state: 'list', rows: 3, uploadedAt: AT });
    upload.mockRejectedValue(stepUpRequired());
    show();
    await settle();
    press('names-clear');
    expect(await screen.findByText(W.clearTitle(3))).toBeTruthy();
    fireEvent.click(document.querySelector('.qc-actions .btn-danger')!);
    await waitFor(() => expect(card()!.querySelector('[data-step-up]')).not.toBeNull());
    await confirmStep();
    await waitFor(() => expect(upload).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(refusalText('private-names-local')).toBe(W.clearFinal));
    expect(card()!.textContent).not.toContain(W.stepUpFinal);
    expect(document.querySelector('[data-step-up]')).toBeNull();
    await settle();
    expect(upload).toHaveBeenCalledTimes(2);
  });

  it('another card\'s answer that hides this card\'s step resets it: the next press is a first send again', async () => {
    vi.spyOn(api, 'renewalBackstop').mockResolvedValue({ ok: true, hour: 4, zone: 'UTC', isDefault: true, setAt: null });
    vi.spyOn(api, 'setRenewalBackstop').mockResolvedValue({ ok: true, hour: 5, zone: 'UTC', isDefault: false, setAt: AT });
    upload.mockRejectedValueOnce(stepUpRequired()).mockRejectedValueOnce(stepUpRequired()).mockResolvedValue(OK);
    show();
    await settle();
    type(TEXT);
    press('names-upload');
    await waitFor(() => expect(card()!.querySelector('[data-step-up]')).not.toBeNull());
    fireEvent.change(document.querySelector('[data-settings-input="hour"]')!, { target: { value: '5' } });
    press('backstop-save');
    await waitFor(() => expect(card()!.querySelector('[data-step-up]')).toBeNull());
    await settle();
    expect(upload).toHaveBeenCalledTimes(1);
    // Another card's answer frees the whole card (review 4167 F2): the box and Upload are enabled, and the text is still there.
    expect(box().disabled).toBe(false);
    expect(up().disabled).toBe(false);
    expect(box().value).toBe(TEXT);
    press('names-upload');
    await waitFor(() => expect(upload).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(card()!.querySelector('[data-step-up]')).not.toBeNull());
    expect(refusalText('private-names-local')).toBeUndefined();
    expect(card()!.textContent).not.toContain(W.stepUpFinal);
    await confirmStep();
    await waitFor(() => expect(upload).toHaveBeenCalledTimes(3));
    await waitFor(() => expect(box().value).toBe(''));
    expect(upload).toHaveBeenNthCalledWith(3, { rows: ROWS });
    expect(upload).toHaveBeenCalledTimes(3);
  });

  it('the retry never sends less than the first send: a box emptied while the step showed sends nothing and says the names are gone', async () => {
    upload.mockRejectedValueOnce(stepUpRequired()).mockResolvedValue(OK);
    show();
    await settle();
    type(TEXT);
    press('names-upload');
    await waitFor(() => expect(card()!.querySelector('[data-step-up]')).not.toBeNull());
    act(() => {
      Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true });
      document.dispatchEvent(new Event('visibilitychange'));
    });
    expect(box().value).toBe('');
    act(() => {
      Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true });
      document.dispatchEvent(new Event('visibilitychange'));
    });
    await confirmStep();
    // A sentence, never undefined: an undefined on both sides would pass with no line drawn at all.
    expect(W.namesGone).toMatch(/hidden/);
    await waitFor(() => expect(refusalText('private-names-local')).toBe(W.namesGone));
    await settle();
    expect(upload).toHaveBeenCalledTimes(1);
  });

  it('a refused row is worded by the line it came from, and the text is kept', async () => {
    upload.mockRejectedValue(new ApiError(400, { ok: false, error: 'bad-request', row: 1, reason: 'non-ascii' }));
    show();
    await settle();
    type('zz-alpha\n\nzq-bravo-x9');
    press('names-upload');
    await waitFor(() => expect(refusalText()).toBe(W.rowRefused(3, 'non-ascii')));
    expect(refusalText()).toContain(NAME_LIST_ROW_TEXT['non-ascii']);
    expect(box().value).toBe('zz-alpha\n\nzq-bravo-x9');
    expect(upload).toHaveBeenCalledWith({ rows: [{ text: 'zz-alpha', mode: 'part' }, { text: 'zq-bravo-x9', mode: 'part' }] });
  });

  it('a bad-request with no readable row says the list was refused, and keeps the text', async () => {
    upload.mockRejectedValue(new ApiError(400, { ok: false, error: 'bad-request' }));
    show();
    await settle();
    type(TEXT);
    press('names-upload');
    await waitFor(() => expect(refusalText()).toBe(OVERLORD_SETTINGS_REFUSAL_TEXT['names-bad-request']));
    expect(box().value).toBe(TEXT);
  });

  it('oversize draws its sentence and keeps the text; a failed write draws its sentence and empties the box', async () => {
    upload.mockRejectedValueOnce(new ApiError(413, { ok: false, error: 'oversize' }))
      .mockRejectedValueOnce(new ApiError(503, { ok: false, error: 'write-failed', detail: 'the store is busy' }));
    show();
    await settle();
    type(TEXT);
    press('names-upload');
    await waitFor(() => expect(refusalText()).toBe(OVERLORD_SETTINGS_REFUSAL_TEXT.oversize));
    expect(box().value).toBe(TEXT);
    press('names-upload');
    await waitFor(() => expect(refusalText()).toBe(`${OVERLORD_SETTINGS_REFUSAL_TEXT['write-failed']} (the store is busy)`));
    expect(box().value).toBe('');
    expect(upload).toHaveBeenCalledTimes(2);
  });

  it('sign-in off draws its own sentence and empties the box', async () => {
    upload.mockRejectedValue(new ApiError(409, { ok: false, error: 'auth-off' }));
    show();
    await settle();
    type(TEXT);
    press('names-upload');
    await waitFor(() => expect(refusalText()).toBe(OVERLORD_SETTINGS_REFUSAL_TEXT['names-auth-off']));
    expect(box().value).toBe('');
  });

  it('a 401 empties the box', async () => {
    upload.mockRejectedValue(new ApiError(401, { ok: false, error: 'unauthenticated' }));
    show();
    await settle();
    type(TEXT);
    press('names-upload');
    await waitFor(() => expect(upload).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(box().value).toBe(''));
  });

  it('an answer with a word this build does not know empties the box', async () => {
    upload.mockRejectedValue(new ApiError(500, { ok: false, error: 'zz-newer-word' }));
    show();
    await settle();
    type(TEXT);
    press('names-upload');
    await waitFor(() => expect(upload).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(box().value).toBe(''));
  });

  it('a first step-up keeps the box, as a refused row and a refused cap do', async () => {
    upload.mockRejectedValueOnce(stepUpRequired());
    show();
    await settle();
    type(TEXT);
    press('names-upload');
    await waitFor(() => expect(card()!.querySelector('[data-step-up]')).not.toBeNull());
    expect(box().value).toBe(TEXT);
  });
});

describe('a list read back with no names', () => {
  it('says it is empty with its date, draws no count and offers no Clear', async () => {
    status.mockResolvedValue({ state: 'list', rows: 0, uploadedAt: AT });
    show();
    await settle();
    const said = card()!.querySelector('[data-names-state="empty"]');
    expect(said).not.toBeNull();
    expect(said!.textContent).toBe(W.listEmpty(dateOf(AT)));
    expect(card()!.textContent).not.toContain('0 names');
    expect(document.querySelector('[data-settings-control="names-clear"]')).toBeNull();
  });
});

describe('Clear the list', () => {
  it('is drawn only while a list stands', async () => {
    show();
    await settle();
    expect(document.querySelector('[data-settings-control="names-clear"]')).toBeNull();
    cleanup();
    status.mockResolvedValue({ state: 'unreadable', reason: 'store' });
    show();
    await settle();
    expect(document.querySelector('[data-settings-control="names-clear"]')).toBeNull();
    cleanup();
    status.mockResolvedValue({ state: 'list', rows: 3, uploadedAt: AT });
    show();
    await settle();
    expect(document.querySelectorAll('[data-settings-control="names-clear"]')).toHaveLength(1);
  });

  it('asks first, Cancel sends nothing, and confirming sends the door its clear flag once', async () => {
    status.mockResolvedValue({ state: 'list', rows: 3, uploadedAt: AT });
    show();
    await settle();
    press('names-clear');
    expect(await screen.findByText(W.clearTitle(3))).toBeTruthy();
    expect(screen.getByText(W.clearWhy)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    await settle();
    expect(upload).not.toHaveBeenCalled();
    press('names-clear');
    expect(await screen.findByText(W.clearTitle(3))).toBeTruthy();
    fireEvent.click(document.querySelector('.qc-actions .btn-danger')!);
    await waitFor(() => expect(upload).toHaveBeenCalledTimes(1));
    expect(upload).toHaveBeenCalledWith({ rows: [], clear: true });
    expect(await screen.findByText(W.cleared)).toBeTruthy();
  });
});

describe('the names are nowhere but the box', () => {
  const LOGS = ['log', 'warn', 'error', 'info', 'debug'] as const;
  const printed = (a: unknown): string => {
    if (a instanceof Error) return `${a.name} ${a.message} ${a.stack ?? ''}`;
    if (typeof a === 'string') return a;
    try { return JSON.stringify(a) ?? String(a); } catch { return String(a); }
  };

  it('no console call, store, or markup holds a name, after a refused upload', async () => {
    const spies = LOGS.map((m) => vi.spyOn(console, m).mockImplementation(() => {}));
    upload.mockRejectedValue(new ApiError(400, { ok: false, error: 'bad-request', row: 1, reason: 'non-ascii' }));
    show();
    await settle();
    type(`${NAMES[0]}\n${NAMES[1]}\nexact: ${NAMES[2]}`);
    press('names-upload');
    await waitFor(() => expect(refusalText()).toBe(W.rowRefused(2, 'non-ascii')));
    await settle();
    expect(upload).toHaveBeenCalledTimes(1);
    for (const n of NAMES) {
      for (const s of spies) for (const call of s.mock.calls) expect(call.map(printed).join(' '), `console, ${n}`).not.toContain(n);
      expect(JSON.stringify(useOverlordStore.getState()), `overlord store, ${n}`).not.toContain(n);
      expect(JSON.stringify(useFleetStore.getState()), `fleet store, ${n}`).not.toContain(n);
      expect(document.documentElement.outerHTML, `markup, ${n}`).not.toContain(n);
      for (const el of document.querySelectorAll('*')) {
        if (el.tagName === 'TEXTAREA') continue;
        expect(el.textContent ?? '', `text of <${el.tagName.toLowerCase()}>, ${n}`).not.toContain(n);
      }
    }
    // The box itself still holds them: the proof above is not an empty field.
    expect(box().value).toContain(NAMES[0]);
  });
});

// ── The text never lives in React props or state ─────────────────────────────────────────────────────────────────────
// The shared fiber walk (`helpers/fiberWalk.ts`, review 4167 F5): every fiber of the tree and every value reachable from its props
// and hook state. It skips what is not data: the fiber's own links, a DOM node, a function, so a text kept only in a closure is not
// seen; what the retry's closure may hold is pinned by source in `settings-retry-census.test.ts` (F1, F6). A text mirrored into a
// hook's state, or passed as a controlled `value`, is found.

describe('the text is never in React props or state', () => {
  it('after typing, no fiber of the tree holds a name in its props or its state', async () => {
    show();
    await settle();
    type(`${NAMES[0]}\n${NAMES[1]}\nexact: ${NAMES[2]}`);
    await settle();
    expect(box().value).toContain(NAMES[0]);
    const fibers = allFibers(box());
    // The walk reaches the card's own components, not only the box's ancestors.
    expect(fibers.length).toBeGreaterThan(20);
    for (const n of NAMES) expect(fiberHolds(box(), n), n).toBe(false);
  });

  it('with the step showing after an Upload answered step-up, and after the retry\'s ok answer, no fiber holds a name', async () => {
    upload.mockRejectedValueOnce(stepUpRequired()).mockResolvedValue(OK);
    show();
    await settle();
    type(`${NAMES[0]}\n${NAMES[1]}\nexact: ${NAMES[2]}`);
    press('names-upload');
    await waitFor(() => expect(card()!.querySelector('[data-step-up]')).not.toBeNull());
    await settle();
    expect(box().value).toContain(NAMES[0]);
    expect(allFibers(box()).length).toBeGreaterThan(20);
    for (const n of NAMES) expect(fiberHolds(box(), n), `step showing, ${n}`).toBe(false);
    await confirmStep();
    await waitFor(() => expect(upload).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(box().value).toBe(''));
    await settle();
    for (const n of NAMES) expect(fiberHolds(box(), n), `after the retry, ${n}`).toBe(false);
  });

  it('the walk itself sees a text mirrored into state, and a text passed as a controlled value (a control for the case above)', () => {
    function Mirrored(): ReactNode {
      const [t, setT] = useState('');
      return <textarea aria-label="mirrored" value={t} onChange={(e) => setT(e.currentTarget.value)} />;
    }
    function Bare(): ReactNode {
      return <textarea aria-label="bare" />;
    }
    render(<><Mirrored /><Bare /></>);
    fireEvent.change(screen.getByLabelText('mirrored'), { target: { value: NAMES[0] } });
    fireEvent.input(screen.getByLabelText('bare'), { target: { value: NAMES[0] } });
    expect(fiberHolds(screen.getByLabelText('mirrored'), NAMES[0])).toBe(true);
    // The bare box's own DOM value is not props or state: with the mirrored one gone, nothing holds the name.
    cleanup();
    render(<Bare />);
    fireEvent.input(screen.getByLabelText('bare'), { target: { value: NAMES[0] } });
    expect(fiberHolds(screen.getByLabelText('bare'), NAMES[0])).toBe(false);
  });
});

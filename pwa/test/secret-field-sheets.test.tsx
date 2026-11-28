// CHARACTERIZATION of the secret field (`accounts/SecretField.tsx`) as the connect sheet and the replace sheet use it.
// It pins today's behaviour, green on the code as it stands, so a later change to the field (a non-emptying read, a
// multiline form) cannot move what the two sheets do: the read that empties the field, the clear on a hidden page and
// on a route change, the uncontrolled input that never puts its value in the markup, and a refused step-up that leaves
// the field empty with the sheet's own sentence beside it.
import { useRef, useState, type ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { AccountsConnect, FleetSession, LaneWire, RosterWire } from '../../shared/api';
import { ConnectSheet, type ConnectClient, type ConnectSheetProps } from '../src/accounts/ConnectSheet';
import { ReplaceSheet, type ReplaceClient, type ReplaceSheetProps } from '../src/accounts/ReplaceSheet';
import { SecretField, type SecretFieldHandle } from '../src/accounts/SecretField';
import type { StepUpDeps } from '../src/accounts/useStepUp';
import { ADD_LANE, NEW_TOKEN_LABEL, REPLACE_SAVE, STEP_UP_AGAIN, STEP_UP_AGAIN_REPLACE, TOKEN_FIELD_LABEL } from '../src/fleet/accountWords';
import { ApiError } from '../src/lib/api';
import { navigate } from '../src/lib/router';
import { createFleetStore } from '../src/stores/fleet';
import { fleetSession } from './fleetFixture';

const VALUE = 'sk-ant-oat01-CHARACTER-' + 'q'.repeat(48);
const STEP_UP_REQUIRED = (): ApiError => new ApiError(403, { ok: false, error: 'step-up-required' });

/** A fake step-up client: no passkey enrolled, so the passphrase arm shows and nothing reaches the network. */
const STEP_UP_DEPS: StepUpDeps = {
  client: {
    stepUpStart: vi.fn(async () => ({ challengeB64url: 'AQID', rpId: 'box.example.invalid', allowCredentialIdsB64url: [] })),
    stepUpFinish: vi.fn(),
    stepUpPassphrase: vi.fn(),
  },
};

const setVisibility = (v: DocumentVisibilityState): void => {
  Object.defineProperty(document, 'visibilityState', { value: v, configurable: true });
  document.dispatchEvent(new Event('visibilitychange'));
};

/** The value is in no input and in no markup. */
function nowhere(when: string): void {
  expect(document.documentElement.outerHTML, `${when}: markup`).not.toContain(VALUE);
  for (const i of document.querySelectorAll('input')) expect(i.value, `${when}: an input's value`).not.toContain(VALUE);
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  navigate('/');
  Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true });
});

// ── The field alone ───────────────────────────────────────────────────────────────────────────────────────────────

describe('the secret field alone', () => {
  const FIELD_LABEL = 'The secret';
  function host(): { handle: () => SecretFieldHandle; presence: ReturnType<typeof vi.fn> } {
    const presence = vi.fn();
    // The host's ref lives outside the render, so the handle survives the host's own re-renders.
    const held: { current: SecretFieldHandle | null } = { current: null };
    function Host(): ReactNode {
      const handle = useRef<SecretFieldHandle>(null);
      const [, setN] = useState(0);
      held.current = handle.current;
      return (
        <SecretField label={FIELD_LABEL} handle={handle} onPresence={(has) => { presence(has); setN((n) => n + 1); }} />
      );
    }
    const drawn = render(<Host />);
    // Mounted: the handle is set by now; read it through a re-render of the host.
    drawn.rerender(<Host />);
    return { handle: () => held.current!, presence };
  }
  const input = (): HTMLInputElement => screen.getByLabelText(FIELD_LABEL) as HTMLInputElement;
  const type = (): void => { fireEvent.input(input(), { target: { value: VALUE } }); };

  it('take() returns the typed value, leaves the DOM value empty, and tells onPresence false', () => {
    const { handle, presence } = host();
    type();
    expect(input().value).toBe(VALUE);
    expect(presence).toHaveBeenLastCalledWith(true);
    expect(handle().take()).toBe(VALUE);
    expect(input().value).toBe('');
    expect(presence).toHaveBeenLastCalledWith(false);
    // A second read has nothing: the value was read once.
    expect(handle().take()).toBe('');
  });

  it('clear() empties it', () => {
    const { handle, presence } = host();
    type();
    expect(input().value).toBe(VALUE);
    act(() => handle().clear());
    expect(input().value).toBe('');
    expect(presence).toHaveBeenLastCalledWith(false);
  });

  it('a visibilitychange to hidden empties it, and one to visible does not', () => {
    host();
    type();
    act(() => setVisibility('visible'));
    expect(input().value).toBe(VALUE);
    act(() => setVisibility('hidden'));
    expect(input().value).toBe('');
  });

  it('a route change empties it while the field stays mounted', () => {
    host();
    type();
    const node = input();
    act(() => navigate('/accounts?lane=lane-a'));
    expect(input()).toBe(node);
    expect(input().value).toBe('');
  });

  it('never puts the value in the markup while it is typed: the field is uncontrolled', () => {
    host();
    type();
    expect(input().value).toBe(VALUE);
    expect(document.documentElement.outerHTML).not.toContain(VALUE);
    expect(input().getAttribute('value')).toBeNull();
  });

  it('is type="password" by default and carries no name attribute', () => {
    host();
    expect(input()).toHaveAttribute('type', 'password');
    expect(input().hasAttribute('name')).toBe(false);
  });
});

// ── The connect sheet ─────────────────────────────────────────────────────────────────────────────────────────────

describe('the connect sheet uses the field', () => {
  const ROSTER: RosterWire[] = [{ id: 'lane-a', label: 'lane-a', hue: 'cyan', homeAble: true, hidden: false, pool: null }];
  const CONNECT: AccountsConnect = {
    accountOps: 'available', gate: 'armed', origin: 'https', caps: ['account-v2'], stepUpFreshUntil: Date.now() + 3_600_000,
  };
  const LANE: LaneWire = { state: { word: 'signed-in', source: 'checked just now' }, ready: true, check: { verdict: 'ok', at: Date.now() } };

  function mount(accountAdd: ConnectClient['accountAdd']): void {
    const props: ConnectSheetProps = {
      open: true, onClose: vi.fn(), roster: ROSTER, connect: CONNECT, offline: null,
      refresh: vi.fn(async () => 'ok' as const), readRoster: () => ROSTER,
      client: { accountAdd, accountCheck: vi.fn(async () => ({ ok: true as const, lane: LANE })), accountEnable: vi.fn() },
      stepUpDeps: STEP_UP_DEPS,
    };
    render(<ConnectSheet {...props} />);
    fireEvent.click(screen.getByRole('button', { name: /Anthropic/ }));
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'lane-c' } });
    fireEvent.change(screen.getByLabelText('Label'), { target: { value: 'Lane C' } });
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
  }
  const field = (): HTMLInputElement | null => screen.queryByLabelText(TOKEN_FIELD_LABEL) as HTMLInputElement | null;
  const paste = (): void => { fireEvent.input(field()!, { target: { value: VALUE } }); };

  it('the submit read empties the field before the answer: the add is pending, the value went out once and is in no node', async () => {
    const add = vi.fn(() => new Promise<never>(() => {}));
    mount(add);
    paste();
    expect(field()!.value).toBe(VALUE);
    fireEvent.click(screen.getByRole('button', { name: ADD_LANE }));
    expect(add).toHaveBeenCalledTimes(1);
    expect((add.mock.calls[0] as unknown as [{ credential: string }])[0].credential).toBe(VALUE);
    // Today the sheet moves to its run frame on submit, so the field is not drawn at all while the add is pending.
    expect(field()).toBeNull();
    nowhere('in flight');
  });

  it('a step-up-required refusal leaves the field empty and draws STEP_UP_AGAIN', async () => {
    const add = vi.fn(async () => { throw STEP_UP_REQUIRED(); });
    mount(add);
    paste();
    fireEvent.click(screen.getByRole('button', { name: ADD_LANE }));
    // The sentence is drawn twice: as the visible notice and in the sheet's alert region.
    await waitFor(() => expect(document.querySelector('.acct-notice')).toHaveTextContent(STEP_UP_AGAIN));
    expect(screen.getByTestId('connect-alert')).toHaveTextContent(STEP_UP_AGAIN);
    // The act ran once and is not retried; the sheet is back at the method frame with a fresh, empty field.
    expect(add).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(field()).not.toBeNull());
    expect(field()!.value).toBe('');
    nowhere('step-up refused');
    // The step shows again, so the primary is held until the operator confirms.
    expect(screen.getByRole('button', { name: ADD_LANE })).toBeDisabled();
  });
});

// ── The replace sheet ─────────────────────────────────────────────────────────────────────────────────────────────

describe('the replace sheet uses the field', () => {
  const lane = (id: string, over: Partial<RosterWire> = {}): RosterWire => ({
    id, label: id, hue: 'cyan', homeAble: true, hidden: false, pool: null, provider: 'anthropic', kind: 'token', ...over,
  });
  const ROSTER: RosterWire[] = [lane('lane-a', { kind: 'sign-in' }), lane('lane-c')];
  const FRESH = (): AccountsConnect => ({
    accountOps: 'available', gate: 'armed', origin: 'https', caps: ['account-v2'], stepUpFreshUntil: Date.now() + 300_000,
  });
  const LANE_CHECKED: LaneWire = {
    state: { word: 'signed-in', source: 'checked just now' }, ready: true, check: { verdict: 'ok', at: Date.now() - 60_000 },
  };
  const running: FleetSession = fleetSession({ id: 'lane-c:p-one', wrapper: 'lane-c', home: 'lane-c', project: 'p-one', title: 'one' });

  function mount(accountCredential: ReplaceClient['accountCredential']): void {
    const fleet = createFleetStore({ makeSocket: () => ({ close: () => {}, send: () => {} }) as never });
    act(() => { fleet.setState({ conn: 'open', sessions: [running], roster: ROSTER, usage: [] }); });
    const props: ReplaceSheetProps = {
      id: 'lane-c', open: true, onClose: vi.fn(), connect: FRESH(), blocked: null, roster: ROSTER, lane: LANE_CHECKED,
      refresh: vi.fn(async () => 'ok' as const), ensure: vi.fn(async () => {}), fleet, stepUpDeps: STEP_UP_DEPS,
      client: {
        accountCredential,
        accountCheck: vi.fn(async () => ({ ok: true as const, lane: LANE_CHECKED })),
        accountRevokeAck: vi.fn(async () => ({ ok: true as const })),
        stop: vi.fn(async () => undefined as never),
      },
    };
    render(<ReplaceSheet {...props} />);
  }
  const field = (): HTMLInputElement | null => screen.queryByLabelText(NEW_TOKEN_LABEL) as HTMLInputElement | null;
  const paste = (): void => { fireEvent.input(field()!, { target: { value: VALUE } }); };

  it('the submit read empties the field before the answer: the call is pending, the value went out once and is in no node', async () => {
    const credential = vi.fn(() => new Promise<never>(() => {}));
    mount(credential as unknown as ReplaceClient['accountCredential']);
    paste();
    expect(field()!.value).toBe(VALUE);
    fireEvent.click(screen.getByRole('button', { name: REPLACE_SAVE }));
    expect(credential).toHaveBeenCalledTimes(1);
    expect(credential).toHaveBeenCalledWith('lane-c', { credential: VALUE });
    // Today the sheet leaves its paste phase on submit, so the field is not drawn at all while the call is pending.
    expect(field()).toBeNull();
    nowhere('in flight');
  });

  it('a step-up-required refusal leaves the field empty and draws STEP_UP_AGAIN_REPLACE', async () => {
    const credential = vi.fn(async () => { throw STEP_UP_REQUIRED(); });
    mount(credential as unknown as ReplaceClient['accountCredential']);
    paste();
    fireEvent.click(screen.getByRole('button', { name: REPLACE_SAVE }));
    expect(await screen.findByText(STEP_UP_AGAIN_REPLACE)).toBeInTheDocument();
    // The act ran once and is not retried; the sheet is back in its paste phase with a fresh, empty field.
    expect(credential).toHaveBeenCalledTimes(1);
    expect(field()).not.toBeNull();
    expect(field()!.value).toBe('');
    nowhere('step-up refused');
    // The step shows again, so the primary is held until the operator confirms.
    expect(screen.getByRole('button', { name: REPLACE_SAVE })).toBeDisabled();
  });
});

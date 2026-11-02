// Replace token by paste (accounts plan Task A19, D-7742; spec §9's token row, §6.3, §3.11; N6): validate-first on the
// box, a refusal leaving the lane as it was and the field empty, the fresh check, the live sessions with one-tap
// Restart, the revoke checklist item that may be left unticked, and the compromise disclosure that names only the
// providers in the roster. A fake box answers every route.
import { afterEach, describe, expect, it, vi, type Mock } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { AccountsConnect, FleetSession, LaneWire, RosterWire } from '../../shared/api';
import { CompromiseSteps, compromiseStepsFor } from '../src/accounts/CompromiseSteps';
import { ReplaceSheet, type ReplaceClient, type ReplaceSheetProps } from '../src/accounts/ReplaceSheet';
import { COMPROMISE_TITLE, NEW_TOKEN_LABEL, REPLACE_SAVE, revokeRecord } from '../src/fleet/accountWords';
import { ApiError } from '../src/lib/api';
import { createFleetStore, type FleetStore } from '../src/stores/fleet';
import { fleetSession } from './fleetFixture';

const fakeSocket = () => ({ close: () => {}, send: () => {} }) as never;
const lane = (id: string, over: Partial<RosterWire> = {}): RosterWire => ({
  id, label: id, hue: 'cyan', homeAble: true, hidden: false, pool: null, provider: 'anthropic', kind: 'token', ...over,
});
const ROSTER: RosterWire[] = [lane('lane-a', { kind: 'sign-in' }), lane('lane-c')];
const FRESH = (): AccountsConnect => ({
  accountOps: 'available', gate: 'armed', origin: 'https', caps: ['account-v2'], stepUpFreshUntil: Date.now() + 300_000,
});
const LANE_READY: LaneWire = { state: { word: 'signed-in', source: 'checked just now' }, ready: true };
const TOKEN = 'sk-ant-oat01-' + 'R'.repeat(60);
const running = fleetSession({ id: 'lane-c:p-one', wrapper: 'lane-c', home: 'lane-c', project: 'p-one', title: 'one' });

const storeWith = (sessions: FleetSession[] = [running]): FleetStore => {
  const store = createFleetStore({ makeSocket: fakeSocket });
  act(() => { store.setState({ conn: 'open', sessions, roster: ROSTER, usage: [] }); });
  return store;
};

function fakeClient(o: Partial<ReplaceClient> = {}): { [K in keyof ReplaceClient]: Mock<ReplaceClient[K]> } {
  return {
    accountCredential: vi.fn<ReplaceClient['accountCredential']>(o.accountCredential ?? (async () => ({ ok: true as const, lane: LANE_READY }))),
    accountCheck: vi.fn<ReplaceClient['accountCheck']>(o.accountCheck ?? (async () => ({ ok: true as const, lane: LANE_READY }))),
    accountRevokeAck: vi.fn<ReplaceClient['accountRevokeAck']>(o.accountRevokeAck ?? (async () => ({ ok: true as const }))),
    stop: vi.fn<ReplaceClient['stop']>(o.stop ?? (async () => undefined as never)),
  };
}

function sheet(client: ReplaceClient, over: Partial<ReplaceSheetProps> = {}): ReplaceSheetProps {
  const props: ReplaceSheetProps = {
    id: 'lane-c', open: true, onClose: vi.fn(), connect: FRESH(), blocked: null, roster: ROSTER,
    refresh: vi.fn(async () => 'ok' as const), client, ensure: vi.fn(async () => {}), fleet: storeWith(), ...over,
  };
  render(<ReplaceSheet {...props} />);
  return props;
}

const field = (): HTMLInputElement => screen.getByLabelText(NEW_TOKEN_LABEL) as HTMLInputElement;
const pasteAndSave = (): void => {
  fireEvent.input(field(), { target: { value: TOKEN } });
  fireEvent.click(screen.getByRole('button', { name: REPLACE_SAVE }));
};

afterEach(() => { cleanup(); vi.restoreAllMocks(); });

describe('Replace token by paste (spec §9)', () => {
  it('a refused token leaves the lane as it was and the field empty', async () => {
    const client = fakeClient({ accountCredential: async () => { throw new ApiError(400, { ok: false, error: 'key-rejected' }); } });
    sheet(client);
    pasteAndSave();
    expect(await screen.findByText('That token was refused (HTTP 401). lane-c keeps its old token.')).toBeInTheDocument();
    expect(client.accountCredential).toHaveBeenCalledWith('lane-c', { credential: TOKEN });
    // As it was: no check, no restart list, no revoke item; the field is back, and empty.
    expect(client.accountCheck).not.toHaveBeenCalled();
    expect(screen.queryByRole('checkbox')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Restart' })).toBeNull();
    expect(field().value).toBe('');
    expect(document.body.innerHTML).not.toContain(TOKEN);
  });

  it('the revoke item can be left unticked, and the record says so', async () => {
    const client = fakeClient();
    const ensure = vi.fn(async () => {});
    const props = sheet(client, { ensure });
    pasteAndSave();
    // The fresh check runs once the new token is saved.
    await waitFor(() => expect(client.accountCheck).toHaveBeenCalledWith('lane-c'));
    expect(await screen.findByText('✓ New token saved')).toBeInTheDocument();
    expect(document.body.innerHTML).not.toContain(TOKEN);

    // The live session keeps the old token until it restarts: one tap, stop then ensure.
    fireEvent.click(screen.getByRole('button', { name: 'Restart' }));
    await waitFor(() => expect(ensure).toHaveBeenCalledWith('lane-c:p-one'));
    expect(client.stop).toHaveBeenCalledWith('lane-c:p-one');
    expect(client.stop.mock.invocationCallOrder[0]!).toBeLessThan(ensure.mock.invocationCallOrder[0]!);
    expect(await screen.findByText('restarted')).toBeInTheDocument();

    // Unticked: allowed, and the record says so. Done closes with nothing sent for it.
    const box = screen.getByRole('checkbox', { name: 'I revoked the old token' });
    expect(box).toHaveAttribute('aria-checked', 'false');
    expect(screen.getByTestId('revoke-record')).toHaveTextContent(revokeRecord(false, true));
    expect(screen.getByTestId('revoke-record')).toHaveTextContent('old token not marked revoked');
    fireEvent.click(screen.getByRole('button', { name: 'Done' }));
    expect(props.onClose).toHaveBeenCalledTimes(1);
    expect(client.accountRevokeAck).not.toHaveBeenCalled();

    // Ticked: the lane and the kind only, and the record follows.
    fireEvent.click(box);
    await waitFor(() => expect(box).toHaveAttribute('aria-checked', 'true'));
    expect(client.accountRevokeAck.mock.calls[0]![0]).toStrictEqual({ laneId: 'lane-c', kind: 'anthropic-token' });
    expect(screen.getByTestId('revoke-record')).toHaveTextContent(revokeRecord(true, true));
  });

  it('CompromiseSteps names only the providers in the roster', () => {
    // Anthropic alone: no OpenAI step, no OpenRouter step; the rebuilt box always.
    render(<CompromiseSteps roster={ROSTER} />);
    const d = screen.getByText(COMPROMISE_TITLE).closest('details') as HTMLElement;
    expect(d).toHaveTextContent('Anthropic:');
    expect(d).toHaveTextContent('claude.ai/settings/claude-code');
    expect(d).toHaveTextContent('sign out other sessions');
    expect(d.textContent).not.toMatch(/OpenRouter|openrouter\.ai|OpenAI:|chatgpt\.com|Codex/);
    expect(within(d).getAllByRole('listitem')).toHaveLength(2);
    cleanup();

    // Every provider: four steps, in the spec's order, and the Codex gateway key in the last.
    const all = [...ROSTER, lane('lane-d', { provider: 'openrouter', kind: 'key' }), lane('lane-e', { provider: 'openai', kind: 'codex' })];
    const steps = compromiseStepsFor(all);
    expect(steps.map((s) => s.split(':')[0])).toEqual(['Anthropic', 'OpenAI', 'OpenRouter', 'On the rebuilt box']);
    expect(steps[3]).toContain("every Codex lane's gateway key");
    // Tokens only: no sign-in clause.
    expect(compromiseStepsFor([lane('lane-c')])[0]).not.toContain('sign-in');
    // OpenRouter alone: no Anthropic step.
    expect(compromiseStepsFor([lane('lane-d', { provider: 'openrouter', kind: 'key' })]).map((s) => s.split(':')[0]))
      .toEqual(['OpenRouter', 'On the rebuilt box']);
  });

  it('the replace sheet ends with the disclosure, and offline sends nothing and draws no field', async () => {
    sheet(fakeClient());
    pasteAndSave();
    expect(await screen.findByText(COMPROMISE_TITLE)).toBeInTheDocument();
    cleanup();

    const client = fakeClient();
    sheet(client, { blocked: "You're offline: nothing was sent. Read 4m ago." });
    expect(screen.queryByLabelText(NEW_TOKEN_LABEL)).toBeNull();
    expect(screen.getByRole('button', { name: REPLACE_SAVE })).toBeDisabled();
    expect(client.accountCredential).not.toHaveBeenCalled();
  });
});

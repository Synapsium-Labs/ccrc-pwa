// Replace token by paste (accounts plan Task A19, D-7742; spec §9's token row, §6.3, §3.11; N6): validate-first on the
// box, a refusal leaving the lane as it was and the field empty, the fresh check, the live sessions with one-tap
// Restart, the revoke checklist item that may be left unticked, and the compromise disclosure that names only the
// providers in the roster. A fake box answers every route.
import { afterEach, describe, expect, it, vi, type Mock } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { AccountsConnect, FleetSession, LaneWire, RosterWire } from '../../shared/api';
import { CompromiseSteps, compromiseStepsFor } from '../src/accounts/CompromiseSteps';
import { ReplaceSheet, type ReplaceClient, type ReplaceSheetProps } from '../src/accounts/ReplaceSheet';
import {
  COMPROMISE_TITLE, NEW_TOKEN_LABEL, REPLACE_SAVE, laneSignedOut, noCheckedCredential, replaceIntro, replaceRefusal, restartLead,
  revokeRecord, type OldCredential,
} from '../src/fleet/accountWords';
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
/** A passing check: the one shape on which the sheet says the lane keeps its old token (D-7872 (10)). */
const LANE_CHECKED: LaneWire = { ...LANE_READY, check: { verdict: 'ok', at: Date.now() - 60_000 } };
/** A token lane `add` wrote with no key file, left by a cancelled or expired mint: never checked, and nothing says it has one. */
const LANE_NEW: LaneWire = { state: { word: 'not-checked', source: 'no check recorded yet' }, ready: false, notReadyReason: 'not-checked' };
/** The box's own word for a lane with no credential: the Signed-out card's Paste a token reaches it. */
const LANE_NONE: LaneWire = { ...LANE_NEW, notReadyReason: 'no-credential' };
const AUTH_DEAD = {
  wrapper: 'lane-c', five: 0, seven: 0, ts: 0, fiveResetAt: null, sevenResetAt: null, fiveRolledOver: false, sevenRolledOver: false,
  disabled: false, authDead: true,
};
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

function sheet(client: ReplaceClient, over: Partial<ReplaceSheetProps> = {}): ReplaceSheetProps & { again: (next: Partial<ReplaceSheetProps>) => void } {
  const props: ReplaceSheetProps = {
    id: 'lane-c', open: true, onClose: vi.fn(), connect: FRESH(), blocked: null, roster: ROSTER, lane: LANE_CHECKED,
    refresh: vi.fn(async () => 'ok' as const), client, ensure: vi.fn(async () => {}), fleet: storeWith(), ...over,
  };
  const drawn = render(<ReplaceSheet {...props} />);
  return { ...props, again: (next) => drawn.rerender(<ReplaceSheet {...props} {...next} />) };
}

const field = (): HTMLInputElement => screen.getByLabelText(NEW_TOKEN_LABEL) as HTMLInputElement;
const pasteAndSave = (): void => {
  fireEvent.input(field(), { target: { value: TOKEN } });
  fireEvent.click(screen.getByRole('button', { name: REPLACE_SAVE }));
};

afterEach(() => { cleanup(); vi.restoreAllMocks(); });

const refused = (word: string): ApiError => new ApiError(400, { ok: false, error: word });
/** No sentence on screen claims the lane holds an old token. */
const claimsNoToken = (): void => {
  expect(document.body.textContent).not.toMatch(/keeps? (its|the) (old )?token|Revoke the old token|I revoked the old token|Record: old token/);
};

describe('what the paste sheet says of the old token follows the rule (D-7872 (10))', () => {
  const UNSURE: ReadonlyArray<readonly [string, Partial<ReplaceSheetProps>]> = [
    ['a never-checked lane', { lane: LANE_NEW }],
    ['a lane the screen has not read', { lane: undefined }],
    ['a 401 lane', { lane: LANE_CHECKED, usage: AUTH_DEAD }],
    ['a failed check', { lane: { ...LANE_NEW, check: { verdict: 'auth-dead', at: Date.now() - 60_000 } } }],
  ];

  it('the words: kept keeps its sentences, signed-out says so, unsure claims neither, for every refusal', () => {
    expect(replaceIntro('lane-c', 'kept')).toBe('The new token is checked with Anthropic before anything is saved. Until it passes, lane-c keeps the token it has.');
    expect(replaceIntro('lane-c', 'unsure')).toBe(`The new token is checked with Anthropic before anything is saved. ${noCheckedCredential('lane-c', 'token')}`);
    expect(replaceIntro('lane-c', 'signed-out')).toBe(`The new token is checked with Anthropic before anything is saved. ${laneSignedOut('lane-c')}`);

    expect(replaceRefusal('lane-c', 'key-rejected', 'kept')).toBe('That token was refused (HTTP 401). lane-c keeps its old token.');
    expect(replaceRefusal('lane-c', 'token-unverified', 'kept')).toBe("Anthropic didn't answer, so nothing was saved. lane-c keeps its old token. Try again.");
    expect(replaceRefusal('lane-c', 'unavailable', 'kept')).toBe("The fleet host couldn't run it. lane-c keeps its old token.");
    expect(replaceRefusal('lane-c', 'odd-word', 'kept')).toBe('The fleet host refused (odd-word). lane-c keeps its old token.');
    expect(replaceRefusal('lane-c', 'Not a word', 'kept')).toBe('The fleet host refused. lane-c keeps its old token.');

    expect(replaceRefusal('lane-c', 'key-rejected', 'unsure')).toBe('That token was refused (HTTP 401). Nothing was installed.');
    expect(replaceRefusal('lane-c', 'token-unverified', 'unsure')).toBe("Anthropic didn't answer, so nothing was saved. lane-c is as it was. Try again.");
    expect(replaceRefusal('lane-c', 'unavailable', 'unsure')).toBe("The fleet host couldn't run it. Nothing was installed.");
    expect(replaceRefusal('lane-c', 'odd-word', 'unsure')).toBe('The fleet host refused (odd-word). Nothing was installed.');
    expect(replaceRefusal('lane-c', 'Not a word', 'unsure')).toBe('The fleet host refused. Nothing was installed.');
    expect(replaceRefusal('lane-c', 'key-charset', 'unsure')).toMatch(/too long\. Nothing was installed\.$/);

    for (const word of ['key-rejected', 'token-unverified', 'key-charset', 'unavailable', 'odd-word', 'Not a word']) {
      for (const old of ['unsure', 'signed-out'] as OldCredential[]) expect(replaceRefusal('lane-c', word, old)).not.toMatch(/keeps/);
      expect(replaceRefusal('lane-c', word, 'signed-out')).toContain(laneSignedOut('lane-c'));
    }
    // These say nothing of the token, whatever the lane holds.
    for (const old of ['kept', 'unsure', 'signed-out'] as OldCredential[]) {
      expect(replaceRefusal('lane-c', 'lane-busy', old)).toBe('lane-c is busy with another account change. Nothing was changed. Try again in a moment.');
      expect(replaceRefusal('lane-c', 'not-found', old)).toBe("lane-c is no longer on this box's roster.");
      expect(replaceRefusal('lane-c', 'step-up-required', old)).toBeNull();
      expect(replaceRefusal('lane-c', 'outcome-unknown', old)).toBeNull();
      expect(replaceRefusal('lane-c', undefined, old)).toBeNull();
    }
  });

  it('a lane with a passing check keeps its words, in the intro, a refusal and the ending', async () => {
    const client = fakeClient({ accountCredential: async () => { throw refused('key-rejected'); } });
    sheet(client);
    expect(screen.getByText(replaceIntro('lane-c', 'kept'))).toBeInTheDocument();
    pasteAndSave();
    expect(await screen.findByText('That token was refused (HTTP 401). lane-c keeps its old token.')).toBeInTheDocument();
    cleanup();
    const ok = fakeClient();
    sheet(ok);
    pasteAndSave();
    expect(await screen.findByRole('checkbox', { name: 'I revoked the old token' })).toBeInTheDocument();
    expect(screen.getByText(restartLead(1, 'kept'))).toBeInTheDocument();
    expect(document.body.textContent).toContain('Revoke the old token at');
    expect(screen.getByTestId('revoke-record')).toHaveTextContent(revokeRecord(false, true));
  });

  for (const [how, over] of UNSURE) {
    it(`${how}: the intro, a refusal, a token that is not one and the ending claim no old token`, async () => {
      const client = fakeClient({ accountCredential: async () => { throw refused('key-rejected'); } });
      sheet(client, over);
      expect(screen.getByText(replaceIntro('lane-c', 'unsure'))).toBeInTheDocument();
      claimsNoToken();
      pasteAndSave();
      expect(await screen.findByText(replaceRefusal('lane-c', 'key-rejected', 'unsure')!)).toBeInTheDocument();
      claimsNoToken();
      fireEvent.input(field(), { target: { value: 'not\u0007this' } });
      fireEvent.click(screen.getByRole('button', { name: REPLACE_SAVE }));
      expect(await screen.findByText(replaceRefusal('lane-c', 'key-charset', 'unsure')!)).toBeInTheDocument();
      claimsNoToken();
      cleanup();
      const ok = fakeClient();
      sheet(ok, over);
      pasteAndSave();
      expect(await screen.findByRole('checkbox', { name: 'I revoked any old token' })).toBeInTheDocument();
      expect(screen.getByText(restartLead(1, 'unsure'))).toBeInTheDocument();
      expect(document.body.textContent).toContain('If lane-c had an old token, revoke it at');
      expect(screen.getByTestId('revoke-record')).toHaveTextContent(revokeRecord(false, 'any'));
      claimsNoToken();
    });
  }

  it("a no-credential lane: the box's own word, so the intro and a refusal say it is signed out", async () => {
    const client = fakeClient({ accountCredential: async () => { throw refused('token-unverified'); } });
    sheet(client, { lane: LANE_NONE });
    expect(screen.getByText(replaceIntro('lane-c', 'signed-out'))).toBeInTheDocument();
    pasteAndSave();
    expect(await screen.findByText(replaceRefusal('lane-c', 'token-unverified', 'signed-out')!)).toBeInTheDocument();
    claimsNoToken();
    cleanup();
    sheet(fakeClient(), { lane: LANE_NONE });
    pasteAndSave();
    expect(await screen.findByRole('checkbox', { name: 'I revoked any old token' })).toBeInTheDocument();
    claimsNoToken();
  });

  it('a lane signed out elsewhere while the sheet is open: the intro and a refusal move off keeps, and do not come back', async () => {
    const client = fakeClient({ accountCredential: async () => { throw refused('key-rejected'); } });
    const { again } = sheet(client);
    expect(screen.getByText(replaceIntro('lane-c', 'kept'))).toBeInTheDocument();
    again({ usage: AUTH_DEAD });
    expect(screen.getByText(replaceIntro('lane-c', 'unsure'))).toBeInTheDocument();
    again({ lane: { ...LANE_CHECKED, check: { verdict: 'ok', at: Date.now() } }, usage: null });
    expect(screen.getByText(replaceIntro('lane-c', 'unsure'))).toBeInTheDocument();
    pasteAndSave();
    expect(await screen.findByText(replaceRefusal('lane-c', 'key-rejected', 'unsure')!)).toBeInTheDocument();
    claimsNoToken();
  });

  it('an answer that never came: a later read of the lane may be the new token\'s, so the revoke item stays', async () => {
    const { again } = sheet(fakeClient({ accountCredential: async () => { throw refused('outcome-unknown'); } }));
    pasteAndSave();
    expect(await screen.findByRole('checkbox', { name: 'I revoked the old token' })).toBeInTheDocument();
    again({ lane: LANE_NEW });
    expect(screen.getByRole('checkbox', { name: 'I revoked the old token' })).toBeInTheDocument();
  });

  it('once the new token is saved, a later read of the lane is about it: the revoke item stays', async () => {
    const { again } = sheet(fakeClient());
    pasteAndSave();
    expect(await screen.findByRole('checkbox', { name: 'I revoked the old token' })).toBeInTheDocument();
    again({ lane: LANE_NEW });
    expect(screen.getByRole('checkbox', { name: 'I revoked the old token' })).toBeInTheDocument();
    expect(screen.getByText(restartLead(1, 'kept'))).toBeInTheDocument();
  });
});

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

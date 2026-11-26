// The Overlord place's body part (Overlord W1 home B, Task 5): Start, Open, Rebind and Restart, drawn per designation state
// by `bodyControlsOf` (L1), with the place's one step-up. Neutral names only: the repository is public. The part's real layout
// (44 px inputs, 320 px wide) is the browser leg's; jsdom holds the tap-floor class and the behaviour.
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { ReactNode } from 'react';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import type { DesignationView } from '../../shared/overlord-designation';
import type { ReadinessWire } from '../../shared/overlord-readiness';
import { ConfirmItsYou } from '../src/accounts/ConfirmItsYou';
import { useStepUp, type StepUpDeps } from '../src/accounts/useStepUp';
import { ApiError, OVERLORD_PLACE_REFUSAL_TEXT, api } from '../src/lib/api';
import { navigate } from '../src/lib/router';
import { BodyPart } from '../src/overlord/BodyPart';
import { BODY_CONTROLS, BODY_WORDS, ATTEMPT_OUTCOME_TEXT, bodyControlsOf, startBlockedWhy } from '../src/overlord/placeWords';
import type { ReadState } from '../src/overlord/readState';
import { useFleetStore } from '../src/stores/fleet';
import { useOverlordStore } from '../src/stores/overlord';
import { TEST_ROSTER } from './rosterFixture';

const AT = 1_700_000_000_000;
const ID = 'lane-a-overlord';
const row = (over: Partial<DesignationView> = {}): DesignationView => ({
  bound: null, pending: null, term: 1, designatedTerm: 1, model: 'opus', accountPools: { pools: ['pool-a'], untagged: false },
  pastIds: [], actor: 'operator', lastAttempt: null, stopsOwed: [], ...over,
});
const BOUND = row({ bound: { sessionId: ID, generation: 'g1' } });
const PENDING = row({ pending: { sessionId: ID, kind: 'rebind', deadlineAt: Date.now() + 5 * 60_000, since: AT, actor: 'operator', generation: null } });
const FAILED = row({ lastAttempt: { sessionId: ID, outcome: 'overlord-sandbox-unmet', at: AT } });
const answered = <T,>(value: T): ReadState<T> => ({ state: 'answered', value, at: AT });
const ready = (over: Partial<ReadinessWire> = {}): ReadinessWire => ({
  word: 'ready', since: AT, why: null, until: null, questionsGo: 'operator', restartable: false, strandCause: null, ...over,
});

const stepUpClient = () => ({
  stepUpStart: vi.fn().mockResolvedValue({ allowCredentialIdsB64url: [] }),
  stepUpFinish: vi.fn(),
  stepUpPassphrase: vi.fn().mockResolvedValue({ stepUpFreshUntil: Date.now() + 300_000 }),
});
type Client = ReturnType<typeof stepUpClient>;

/** The place's wiring: one step-up for the part and its sheet. */
function Place({ deps }: { deps: StepUpDeps }): ReactNode {
  const stepUp = useStepUp(Infinity, deps);
  return (<><BodyPart stepUp={stepUp} /><ConfirmItsYou stepUp={stepUp} subject="the Overlord" /></>);
}

let refresh: Mock<() => Promise<void>>;
let client: Client;
function show(
  designation: ReadState<DesignationView | null>, readiness: ReadState<ReadinessWire> = answered(ready()),
): ReturnType<typeof render> {
  act(() => useOverlordStore.setState({ caps: answered(['overlord-v1']), designation, readiness, refresh }));
  return render(<Place deps={{ client }} />);
}
const controls = (): string[] => [...document.querySelectorAll('[data-overlord-control]')].map((e) => e.getAttribute('data-overlord-control')!);
const click = (name: string | RegExp): void => { fireEvent.click(screen.getByRole('button', { name })); };

beforeEach(() => {
  refresh = vi.fn<() => Promise<void>>().mockResolvedValue(undefined);
  client = stepUpClient();
  act(() => {
    useFleetStore.setState({ roster: TEST_ROSTER.map((a, i) => ({ ...a, pool: i < 2 ? 'pool-a' : i < 4 ? 'pool-b' : null })) });
    navigate('/overlord');
  });
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

describe('each state draws its controls and only those', () => {
  it.each([
    ['none', answered<DesignationView | null>(null), ['start']],
    ['an older server with no Overlord (absent)', { state: 'absent' } as ReadState<DesignationView | null>, ['start']],
    ['failed-start', answered<DesignationView | null>(FAILED), ['start']],
    ['pending', answered<DesignationView | null>(PENDING), []],
    ['bound', answered<DesignationView | null>(BOUND), ['open', 'rebind']],
    ['unmeasured', { state: 'unmeasured', error: 'HTTP 503' } as ReadState<DesignationView | null>, []],
    ['loading', { state: 'loading' } as ReadState<DesignationView | null>, []],
  ])('%s', (_name, designation, expected) => {
    show(designation);
    expect(controls()).toEqual(expected);
  });

  it('failed-start says the outcome and offers Start again', () => {
    show(answered(FAILED));
    expect(screen.getByText(ATTEMPT_OUTCOME_TEXT['overlord-sandbox-unmet'])).toBeTruthy();
    expect(screen.getByRole('button', { name: BODY_WORDS.startAgain })).toBeTruthy();
    expect(screen.queryByRole('button', { name: BODY_WORDS.start })).toBeNull();
  });

  it.each(['overlord-sandbox-unmet', 'create-failed', 'deadline-passed', 'authority-unrecorded'] as const)('failed-start outcome %s has its own sentence', (outcome) => {
    show(answered(row({ lastAttempt: { sessionId: ID, outcome, at: AT } })));
    expect(screen.getByText(ATTEMPT_OUTCOME_TEXT[outcome])).toBeTruthy();
  });

  it('an outcome this build does not know is drawn raw', () => {
    show(answered(row({ lastAttempt: { sessionId: ID, outcome: 'new-outcome' as never, at: AT } })));
    expect(screen.getByText('The last start failed (new-outcome).')).toBeTruthy();
  });

  it('pending says the session, the kind and the deadline from the read, and offers nothing', () => {
    show(answered(PENDING));
    const line = document.querySelector('[data-overlord-pending]')!;
    expect(line.getAttribute('data-overlord-pending')).toBe('rebind');
    expect(line.textContent).toContain(`A rebind is pending on ${ID}.`);
    expect(line.textContent).toContain('within 5 min');
    expect(controls()).toEqual([]);
    expect(screen.queryByRole('radio')).toBeNull();
  });

  it('unmeasured says the designation could not be read and draws no control and no input', () => {
    show({ state: 'unmeasured', error: 'HTTP 503' });
    expect(screen.getByText(BODY_WORDS.unmeasured)).toBeTruthy();
    expect(screen.queryByRole('button')).toBeNull();
    expect(screen.queryByRole('radio')).toBeNull();
  });

  it('a designation still loading says nothing of its own', () => {
    const { container } = show({ state: 'loading' });
    expect(container.textContent).toBe('');
  });

  it('Start is in no row of a session that is bound or pending: the spec\'s "no second start"', () => {
    expect(BODY_CONTROLS.bound).not.toContain('start');
    expect(BODY_CONTROLS.pending).not.toContain('start');
    for (const restartable of [false, true]) {
      const r = answered(ready({ restartable }));
      expect(bodyControlsOf({ kind: 'bound', sessionId: ID }, r)).not.toContain('start');
      expect(bodyControlsOf({ kind: 'pending', sessionId: ID }, r)).not.toContain('start');
    }
    show(answered(BOUND), answered(ready({ restartable: true })));
    expect(screen.queryByRole('button', { name: /^Start/ })).toBeNull();
    cleanup();
    show(answered(PENDING));
    expect(screen.queryByRole('button', { name: /^Start/ })).toBeNull();
  });
});

describe('Start', () => {
  it('sends the designate body: opus and every roster pool and untagged accounts by default', async () => {
    const designate = vi.spyOn(api, 'overlordDesignate').mockResolvedValue({ sessionId: ID, deadlineAt: AT, warnings: [] });
    show(answered(null));
    click(BODY_WORDS.start);
    await waitFor(() => expect(designate).toHaveBeenCalledTimes(1));
    expect(designate).toHaveBeenCalledWith({ model: 'opus', accountPools: { pools: ['pool-a', 'pool-b'], untagged: true } });
    await waitFor(() => expect(refresh).toHaveBeenCalledTimes(1));
  });

  it('sends what was chosen: fable, a pool left out, no untagged accounts', async () => {
    const designate = vi.spyOn(api, 'overlordDesignate').mockResolvedValue({ sessionId: ID, deadlineAt: AT, warnings: [] });
    show(answered(null));
    fireEvent.click(screen.getByRole('radio', { name: 'Fable' }));
    fireEvent.click(screen.getByRole('checkbox', { name: 'pool-b' }));
    fireEvent.click(screen.getByRole('checkbox', { name: BODY_WORDS.untagged }));
    click(BODY_WORDS.start);
    await waitFor(() => expect(designate).toHaveBeenCalledTimes(1));
    expect(designate).toHaveBeenCalledWith({ model: 'fable', accountPools: { pools: ['pool-a'], untagged: false } });
  });

  it('offers opus selected and fable, and the pools come from the roster, never from source', () => {
    act(() => useFleetStore.setState({ roster: TEST_ROSTER.map((a, i) => ({ ...a, pool: i === 0 ? 'pool-x' : null })) }));
    show(answered(null));
    expect((screen.getByRole('radio', { name: 'Opus' }) as HTMLInputElement).checked).toBe(true);
    expect((screen.getByRole('radio', { name: 'Fable' }) as HTMLInputElement).checked).toBe(false);
    const boxes = within(document.querySelector('[data-overlord-account-set]')!).getAllByRole('checkbox').map((b) => b.parentElement!.textContent);
    expect(boxes).toEqual(['pool-x', BODY_WORDS.untagged]);
  });

  it('every input is a 44 px row (the tap floor)', () => {
    show(answered(null));
    for (const input of screen.getAllByRole('radio')) expect(input.closest('label')!.className).toContain('min-h-tap');
    // Each account box sits inside its own label, the hit area, whose rule in the place's stylesheet carries the floor (vitest
    // loads no stylesheet, so the rule is read as text; the browser file measures the drawn box).
    const css = readFileSync(path.join(import.meta.dirname, '..', 'src', 'overlord', 'overlord.css'), 'utf8');
    expect(css).toMatch(/\.ov-account-hit\s*\{[^}]*min-height:\s*var\(--tap-min\)/);
    for (const input of screen.getAllByRole('checkbox')) expect(input.closest('label')!.className).toBe('ov-account-hit');
  });

  it('an empty account set cannot be sent, and says so', () => {
    const designate = vi.spyOn(api, 'overlordDesignate');
    show(answered(null));
    for (const pool of ['pool-a', 'pool-b']) fireEvent.click(screen.getByRole('checkbox', { name: pool }));
    fireEvent.click(screen.getByRole('checkbox', { name: BODY_WORDS.untagged }));
    expect(screen.getByText(BODY_WORDS.noAccounts)).toBeTruthy();
    expect((screen.getByRole('button', { name: BODY_WORDS.start }) as HTMLButtonElement).disabled).toBe(true);
    expect(startBlockedWhy({ pools: [], untagged: false })).toBe(BODY_WORDS.noAccounts);
    expect(startBlockedWhy({ pools: [], untagged: true })).toBeNull();
    expect(designate).not.toHaveBeenCalled();
  });

  it('draws the answer\'s warnings: an unknown pool by name, and a word this build does not know raw', async () => {
    vi.spyOn(api, 'overlordDesignate').mockResolvedValue({
      sessionId: ID, deadlineAt: AT, warnings: [{ warning: 'unknown-pool', pool: 'pool-z' }, { warning: 'new-warning' }],
    });
    show(answered(null));
    click(BODY_WORDS.start);
    expect(await screen.findByText('No account is in the pool pool-z, so it serves nothing until one is.')).toBeTruthy();
    expect(screen.getByText('Warning: new-warning')).toBeTruthy();
  });

  it('a step-up refusal opens the step and the act runs once after it, and only when pressed again', async () => {
    const designate = vi.spyOn(api, 'overlordDesignate')
      .mockRejectedValueOnce(new ApiError(403, { ok: false, error: 'step-up-required' }))
      .mockResolvedValue({ sessionId: ID, deadlineAt: AT, warnings: [] });
    show(answered(null));
    click(BODY_WORDS.start);
    await waitFor(() => expect(client.stepUpStart).toHaveBeenCalled());
    expect(designate).toHaveBeenCalledTimes(1);
    expect(document.querySelector('[data-step-up]')).not.toBeNull();
    expect(screen.queryByRole('alert')).toBeNull();
    expect(refresh).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText('Passphrase'), { target: { value: 'a passphrase' } });
    fireEvent.click(screen.getByRole('button', { name: 'Confirm with passphrase' }));
    await waitFor(() => expect(document.querySelector('[data-step-up]')).toBeNull());
    expect(designate).toHaveBeenCalledTimes(1);
    click(BODY_WORDS.start);
    await waitFor(() => expect(designate).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(refresh).toHaveBeenCalledTimes(1));
  });
});

describe('every refusal renders its sentence, never swallowed', () => {
  const T = OVERLORD_PLACE_REFUSAL_TEXT;
  it.each([
    ['overlord-exists', {}, T['overlord-exists']],
    ['overlord-single-account', { count: 1 }, `${T['overlord-single-account']} It counts 1.`],
    ['launch-profile-unmet', { detail: 'x' }, T['launch-profile-unmet']],
    ['overlord-sandbox-unmet', {}, T['overlord-sandbox-unmet']],
    ['overlord-body-alive', { detail: 'the session is running' }, `${T['overlord-body-alive']} (the session is running)`],
    ['overlord-attempt-pending', {}, T['overlord-attempt-pending']],
    ['auth-off', {}, T['auth-off']],
    ['a-word-from-a-newer-server', {}, 'Refused: a-word-from-a-newer-server'],
  ])('%s', async (error, extra, sentence) => {
    vi.spyOn(api, 'overlordDesignate').mockRejectedValue(new ApiError(409, { ok: false, error, ...extra }));
    show(answered(null));
    click(BODY_WORDS.start);
    expect((await screen.findByRole('alert')).textContent).toBe(sentence);
    await waitFor(() => expect(refresh).toHaveBeenCalledTimes(1));
    expect(client.stepUpStart).not.toHaveBeenCalled();
  });

  it('a failure with no word (the network) is drawn as its message', async () => {
    vi.spyOn(api, 'overlordDesignate').mockRejectedValue(new TypeError('Failed to fetch'));
    show(answered(null));
    click(BODY_WORDS.start);
    expect((await screen.findByRole('alert')).textContent).toBe('Failed to fetch');
  });

  it('a 401 is left to the sign-in screen: no sentence of ours', async () => {
    const designate = vi.spyOn(api, 'overlordDesignate').mockRejectedValue(new ApiError(401, { ok: false, error: 'unauthenticated' }));
    show(answered(null));
    click(BODY_WORDS.start);
    await waitFor(() => expect(designate).toHaveBeenCalled());
    await waitFor(() => expect((screen.getByRole('button', { name: BODY_WORDS.start }) as HTMLButtonElement).disabled).toBe(false));
    expect(screen.queryByRole('alert')).toBeNull();
  });
});

describe('Restart', () => {
  it('is offered only while restartable is true, and then after Open and Rebind', () => {
    show(answered(BOUND), answered(ready({ word: 'dead', restartable: true })));
    expect(controls()).toEqual(['open', 'rebind', 'restart']);
  });

  it('a dead word with restartable false offers no Restart (never keyed on the word)', () => {
    show(answered(BOUND), answered(ready({ word: 'dead', restartable: false })));
    expect(controls()).toEqual(['open', 'rebind']);
    expect(screen.queryByRole('button', { name: BODY_WORDS.restart })).toBeNull();
  });

  it('a ready word with restartable true is still offered it: the flag is the rule', () => {
    show(answered(BOUND), answered(ready({ word: 'ready', restartable: true })));
    expect(controls()).toContain('restart');
  });

  it.each([
    ['loading', { state: 'loading' } as ReadState<ReadinessWire>],
    ['unmeasured', { state: 'unmeasured', error: 'HTTP 503' } as ReadState<ReadinessWire>],
    ['absent', { state: 'absent' } as ReadState<ReadinessWire>],
  ])('a readiness read that is %s offers none', (_n, readiness) => {
    show(answered(BOUND), readiness);
    expect(controls()).toEqual(['open', 'rebind']);
  });

  it('a stale read keeps its last answer\'s flag', () => {
    show(answered(BOUND), { state: 'stale', value: ready({ restartable: true }), at: AT, error: 'HTTP 503' });
    expect(controls()).toContain('restart');
  });

  it('sends the restart with no step-up, then reads again', async () => {
    const restart = vi.spyOn(api, 'overlordRestart').mockResolvedValue({ sessionId: ID });
    show(answered(BOUND), answered(ready({ word: 'dead', restartable: true })));
    click(BODY_WORDS.restart);
    await waitFor(() => expect(restart).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(refresh).toHaveBeenCalledTimes(1));
    expect(client.stepUpStart).not.toHaveBeenCalled();
    expect(document.querySelector('[data-step-up]')).toBeNull();
  });

  it('a refused restart says its sentence', async () => {
    vi.spyOn(api, 'overlordRestart').mockRejectedValue(new ApiError(409, { ok: false, error: 'overlord-attempt-pending' }));
    show(answered(BOUND), answered(ready({ restartable: true })));
    click(BODY_WORDS.restart);
    expect((await screen.findByRole('alert')).textContent).toBe(OVERLORD_PLACE_REFUSAL_TEXT['overlord-attempt-pending']);
  });
});

describe('Rebind', () => {
  it('sends force false through the step-up, then reads again', async () => {
    const rebind = vi.spyOn(api, 'overlordRebind').mockResolvedValue({ sessionId: 'lane-b-overlord', deadlineAt: AT });
    show(answered(BOUND));
    click(BODY_WORDS.rebind);
    await waitFor(() => expect(rebind).toHaveBeenCalledWith(false));
    await waitFor(() => expect(refresh).toHaveBeenCalledTimes(1));
    expect(screen.queryByText(BODY_WORDS.forceSentence)).toBeNull();
  });

  it('a step-up refusal of Rebind opens the step and sends nothing more', async () => {
    const rebind = vi.spyOn(api, 'overlordRebind').mockRejectedValue(new ApiError(403, { ok: false, error: 'step-up-required' }));
    show(answered(BOUND));
    click(BODY_WORDS.rebind);
    await waitFor(() => expect(client.stepUpStart).toHaveBeenCalled());
    expect(rebind).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('overlord-body-alive offers "Rebind anyway" with the sentence, and the forced call goes through the step-up', async () => {
    const rebind = vi.spyOn(api, 'overlordRebind')
      .mockRejectedValueOnce(new ApiError(409, { ok: false, error: 'overlord-body-alive', detail: 'the body is running' }))
      .mockRejectedValueOnce(new ApiError(403, { ok: false, error: 'step-up-required' }))
      .mockResolvedValue({ sessionId: 'lane-b-overlord', deadlineAt: AT });
    show(answered(BOUND));
    expect(screen.queryByRole('button', { name: BODY_WORDS.rebindAnyway })).toBeNull();
    click(BODY_WORDS.rebind);
    expect((await screen.findByRole('alert')).textContent).toBe(`${OVERLORD_PLACE_REFUSAL_TEXT['overlord-body-alive']} (the body is running)`);
    expect(screen.getByText(BODY_WORDS.forceSentence)).toBeTruthy();
    expect(BODY_WORDS.forceSentence).toContain('stops it first');
    click(BODY_WORDS.rebindAnyway);
    await waitFor(() => expect(rebind).toHaveBeenLastCalledWith(true));
    // the forced call was refused for a step-up: the step shows, and nothing runs until it is pressed again
    await waitFor(() => expect(client.stepUpStart).toHaveBeenCalled());
    expect(rebind).toHaveBeenCalledTimes(2);
    fireEvent.change(screen.getByLabelText('Passphrase'), { target: { value: 'a passphrase' } });
    fireEvent.click(screen.getByRole('button', { name: 'Confirm with passphrase' }));
    await waitFor(() => expect(document.querySelector('[data-step-up]')).toBeNull());
    click(BODY_WORDS.rebindAnyway);
    await waitFor(() => expect(rebind).toHaveBeenCalledTimes(3));
    expect(rebind.mock.calls.map((c) => c[0])).toEqual([false, true, true]);
    await waitFor(() => expect(screen.queryByText(BODY_WORDS.forceSentence)).toBeNull());
  });

  it('any other refusal offers no "Rebind anyway"', async () => {
    vi.spyOn(api, 'overlordRebind').mockRejectedValue(new ApiError(409, { ok: false, error: 'overlord-attempt-pending' }));
    show(answered(BOUND));
    click(BODY_WORDS.rebind);
    expect((await screen.findByRole('alert')).textContent).toBe(OVERLORD_PLACE_REFUSAL_TEXT['overlord-attempt-pending']);
    expect(screen.queryByRole('button', { name: BODY_WORDS.rebindAnyway })).toBeNull();
  });
});

describe('Open', () => {
  it('lands on the bound session\'s path', () => {
    show(answered(BOUND));
    click(BODY_WORDS.open);
    expect(window.location.pathname).toBe(`/s/${ID}`);
  });
});

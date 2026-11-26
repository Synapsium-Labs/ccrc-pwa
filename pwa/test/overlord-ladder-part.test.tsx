// The Overlord place's ladder part and its doors (Overlord W1 home B, Task 4; plan "The ladder", "A latch's Clear is a raise" and
// "Authority"). Every control comes from a row of the read (H9): the rung buttons from `rungs[]`, Clear from `latches[]`. Lowering
// (Off, Chat) asks no step-up and exchanges the witness; a raise and a latch's Clear go through the step-up; Clear answers no
// narrowing, so no "taking effect" line and no witness exchange follow it. Every door refreshes the store. Refusals are drawn in
// their sentences, never swallowed. Neutral names only: the repository is public.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useMemo } from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { LadderWire } from '../../shared/overlord-ladder';
import { ConfirmItsYou } from '../src/accounts/ConfirmItsYou';
import { useStepUp, type StepUp, type StepUpDeps } from '../src/accounts/useStepUp';
import { ApiError, api } from '../src/lib/api';
import { nudgeWitness } from '../src/lib/witness';
import { LadderPart } from '../src/overlord/LadderPart';
import { useLadderDoors, type LadderDoors } from '../src/overlord/useLadderDoors';
import { clockOf } from '../src/overlord/readinessWords';
import { ladderCauseWords, takingEffectWords } from '../src/overlord/ladderWords';
import { refreshOverlord, useOverlordStore } from '../src/stores/overlord';

vi.mock('../src/lib/witness', async (orig) => ({ ...(await orig<typeof import('../src/lib/witness')>()), nudgeWitness: vi.fn() }));
vi.mock('../src/stores/overlord', async (orig) => ({ ...(await orig<typeof import('../src/stores/overlord')>()), refreshOverlord: vi.fn(async () => {}) }));

const NOW = 1_700_000_000_000;
const RUNGS_WITHOUT_WORDS: LadderWire['rungs'] = [
  { rung: 'off', available: true, needs: null },
  { rung: 'chat', available: true, needs: null },
  { rung: 'advise', available: false, needs: 'overlord-route-v1' },
  { rung: 'full', available: false, needs: 'overlord-answer-v1' },
];
const ladder = (over: Partial<LadderWire> = {}): LadderWire => ({
  ok: true, operatorRung: 'chat', operatorRungSource: 'set', effectiveRung: 'chat',
  binding: [{ cause: 'shared-user', kind: 'condition', cap: 'chat', reading: 'standing', known: true }],
  latches: [
    { cause: 'restore-detected', cap: 'chat', raisedAt: NOW - 3_600_000, detail: 'the volume was restored', known: true, narrowing: { state: 'done' } },
    { cause: 'a-newer-latch', cap: 'chat', raisedAt: NOW - 7_200_000, detail: 'a cause a later build raised', known: false, narrowing: { state: 'done' } },
  ],
  conditions: [
    { cause: 'shared-user', reading: 'standing', effect: { kind: 'cap', cap: 'advise' } },
    { cause: 'load-past-95', reading: 'lifted', effect: { kind: 'cap', cap: 'chat' } },
    { cause: 'no-witness-since-boot', reading: 'unmeasured', effect: { kind: 'cap', cap: 'advise' } },
    { cause: 'a-newer-condition', reading: 'standing', effect: { kind: 'cap', cap: 'chat' } },
  ],
  readBy: [], lastChange: null, rungs: RUNGS_WITHOUT_WORDS, ...over,
});
const answered = (l: LadderWire): void => { act(() => useOverlordStore.setState({ ladder: { state: 'answered', value: l, at: NOW } })); };

const fakeStepUp = (): StepUp => ({
  needed: false, arm: 'loading', ready: false, busy: false, notice: null, canRetry: false,
  confirm: () => {}, submitPassphrase: () => {}, retry: () => {}, actRefused: () => false,
  runAct: vi.fn(async (act: () => Promise<unknown>) => { await act(); return 'done' as const; }),
});

let doorsOut: LadderDoors | null = null;
function Harness({ stepUp }: { stepUp: StepUp }) {
  const doors = useLadderDoors(stepUp);
  doorsOut = doors;
  return <LadderPart doors={doors} />;
}
const mount = (stepUp: StepUp = fakeStepUp()): StepUp => { render(<Harness stepUp={stepUp} />); return stepUp; };
const part = (): HTMLElement => document.querySelector<HTMLElement>('[data-ladder-part]')!;
const rungButton = (r: string): HTMLButtonElement => part().querySelector<HTMLButtonElement>(`[data-rung="${r}"]`)!;
const takingEffect = (): string | null => document.querySelector('[data-taking-effect]')?.textContent ?? null;

beforeEach(() => {
  vi.setSystemTime(new Date(NOW));
  doorsOut = null;
  useOverlordStore.setState({ ladder: { state: 'loading' }, readiness: { state: 'loading' } });
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.mocked(nudgeWitness).mockClear();
  vi.mocked(refreshOverlord).mockClear();
});

describe('the ladder part when the read is not an answer', () => {
  it('loading says loading, and draws no control', () => {
    mount();
    expect(part().textContent).toContain('Loading…');
    expect(part().querySelector('button')).toBeNull();
  });
  it('a failed read says the ladder could not be read, and draws no control', () => {
    act(() => useOverlordStore.setState({ ladder: { state: 'unmeasured', error: 'HTTP 503' } }));
    mount();
    expect(part().querySelector('[data-ladder-unreadable]')?.textContent).toBe('The ladder could not be read');
    expect(part().querySelector('button')).toBeNull();
  });
  it('an older server with no ladder says the same', () => {
    act(() => useOverlordStore.setState({ ladder: { state: 'absent' } }));
    mount();
    expect(part().querySelector('[data-ladder-unreadable]')).not.toBeNull();
  });
  it('a stale read draws its last answer and says when it was read', () => {
    act(() => useOverlordStore.setState({ ladder: { state: 'stale', value: ladder(), at: NOW - 60_000, error: 'timeout' } }));
    mount();
    expect(part().querySelector('[data-ladder-stale]')?.textContent).toBe(`last read ${clockOf(NOW - 60_000)}`);
    expect(rungButton('off')).toBeTruthy();
  });
});

describe('the rows of the read, and only those', () => {
  it('draws the operator\'s rung, the effective rung and each binding row', () => {
    answered(ladder({ operatorRung: 'chat', effectiveRung: 'off' }));
    mount();
    expect(part().querySelector('[data-operator-rung]')?.textContent).toContain('Chat');
    expect(part().querySelector('[data-effective-rung]')?.textContent).toContain('Off');
    const binding = part().querySelector('[data-binding="shared-user"]')!;
    expect(binding.textContent).toContain(ladderCauseWords['shared-user']);
    expect(binding.textContent).toContain('chat');
  });

  it('draws one rung control per row of rungs[]: Off and Chat enabled, a rung above chat disabled with the word it needs', () => {
    answered(ladder({ operatorRung: 'advise', effectiveRung: 'advise', rungs: [
      { rung: 'off', available: true, needs: null }, { rung: 'chat', available: true, needs: null },
      { rung: 'advise', available: true, needs: 'overlord-route-v1' }, { rung: 'full', available: false, needs: 'overlord-answer-v1' },
    ] }));
    mount();
    expect([...part().querySelectorAll('[data-rung]')].map((b) => b.getAttribute('data-rung'))).toEqual(['off', 'chat', 'advise', 'full']);
    expect(rungButton('off').disabled).toBe(false);
    expect(rungButton('chat').disabled).toBe(false);
    expect(rungButton('advise').disabled).toBe(true);   // the operator's own rung
    expect(rungButton('advise').getAttribute('aria-pressed')).toBe('true');
    expect(rungButton('full').disabled).toBe(true);
    expect(part().querySelector('[data-rung-needs="full"]')?.textContent).toContain('Needs overlord-answer-v1');
    expect(part().querySelector('[data-rung-needs="advise"]')).toBeNull();
  });

  it('while the words are missing, advise and full are disabled and name what they need', () => {
    answered(ladder());
    mount();
    expect(rungButton('chat').disabled).toBe(true);
    expect(rungButton('advise').disabled).toBe(true);
    expect(part().querySelector('[data-rung-needs="advise"]')?.textContent).toContain('Needs overlord-route-v1');
    expect(part().querySelector('[data-rung-needs="full"]')?.textContent).toContain('Needs overlord-answer-v1');
  });

  it('NO CONTROL WITHOUT A ROW: a read with two rungs draws two rung controls, and no list of the console\'s own', () => {
    answered(ladder({ rungs: [{ rung: 'off', available: true, needs: null }, { rung: 'chat', available: true, needs: null }], latches: [], conditions: [], binding: [] }));
    mount();
    expect([...part().querySelectorAll('[data-rung]')].map((b) => b.getAttribute('data-rung'))).toEqual(['off', 'chat']);
    expect(part().querySelector('[data-rung="advise"]')).toBeNull();
    expect(part().querySelector('[data-rung="full"]')).toBeNull();
    expect(part().querySelectorAll('[data-latch]')).toHaveLength(0);
    expect(part().querySelectorAll('[data-condition]')).toHaveLength(0);
    expect(screen.queryByRole('button', { name: /clear/i })).toBeNull();
  });

  it('draws each standing latch with its cause sentence, its cap, its time and a Clear', () => {
    answered(ladder());
    mount();
    const row = part().querySelector('[data-latch="restore-detected"]')!;
    expect(row.textContent).toContain(ladderCauseWords['restore-detected']);
    expect(row.textContent).toContain('chat');
    expect(row.textContent).toContain(clockOf(NOW - 3_600_000));
    expect(within(row as HTMLElement).getByRole('button', { name: /clear/i })).toBeTruthy();
  });

  it('draws each condition with its reading and its effect', () => {
    answered(ladder());
    mount();
    const shared = part().querySelector('[data-condition="shared-user"]')!;
    expect(shared.textContent).toContain('Standing');
    expect(shared.textContent).toContain('caps the rung at advise');
    expect(part().querySelector('[data-condition="load-past-95"]')?.textContent).toContain('Lifted');
    expect(part().querySelector('[data-condition="no-witness-since-boot"]')?.textContent).toContain('Unmeasured');
  });

  it('a cause the console does not know is drawn by its key, and a latch of one is clearable', async () => {
    answered(ladder());
    const clear = vi.spyOn(api, 'clearLatch').mockResolvedValue({ changed: true });
    const stepUp = mount();
    const row = part().querySelector('[data-latch="a-newer-latch"]')!;
    expect(row.textContent).toContain('a-newer-latch');
    expect(part().querySelector('[data-condition="a-newer-condition"]')?.textContent).toContain('a-newer-condition');
    fireEvent.click(within(row as HTMLElement).getByRole('button', { name: /clear/i }));
    await waitFor(() => expect(clear).toHaveBeenCalledWith('a-newer-latch'));
    expect(stepUp.runAct).toHaveBeenCalledTimes(1);
  });
});

describe('lowering the rung', () => {
  const TAKING = { state: 'taking-effect', why: 'witness-unmeasured' } as const;

  it('Off sends the rung off with no step-up, draws "taking effect", exchanges the witness and refreshes the store', async () => {
    answered(ladder());
    const rung = vi.spyOn(api, 'overlordRung').mockResolvedValue({ changed: true, rung: 'off', narrowing: TAKING });
    const stepUp = mount();
    fireEvent.click(rungButton('off'));
    await waitFor(() => expect(takingEffect()).toBe(takingEffectWords['witness-unmeasured']));
    expect(rung).toHaveBeenCalledTimes(1);
    expect(rung).toHaveBeenCalledWith('off');
    expect(stepUp.runAct).not.toHaveBeenCalled();
    expect(nudgeWitness).toHaveBeenCalledTimes(1);
    expect(refreshOverlord).toHaveBeenCalledTimes(1);
  });

  it('Chat from a higher rung is a lowering too: no step-up', async () => {
    answered(ladder({ operatorRung: 'full', effectiveRung: 'full', rungs: [
      { rung: 'off', available: true, needs: null }, { rung: 'chat', available: true, needs: null },
      { rung: 'advise', available: true, needs: 'overlord-route-v1' }, { rung: 'full', available: true, needs: 'overlord-answer-v1' },
    ] }));
    const rung = vi.spyOn(api, 'overlordRung').mockResolvedValue({ changed: true, rung: 'chat', narrowing: TAKING });
    const stepUp = mount();
    fireEvent.click(rungButton('chat'));
    await waitFor(() => expect(rung).toHaveBeenCalledWith('chat'));
    expect(stepUp.runAct).not.toHaveBeenCalled();
  });

  it('the line stays while the ladder reads taking-effect and goes once it reads done', async () => {
    answered(ladder());
    vi.spyOn(api, 'overlordRung').mockResolvedValue({ changed: true, rung: 'off', narrowing: { state: 'taking-effect', why: 'not-journalled' } });
    mount();
    fireEvent.click(rungButton('off'));
    await waitFor(() => expect(takingEffect()).toBe(takingEffectWords['not-journalled']));
    answered(ladder({ lastChange: { at: NOW, actor: 'operator', narrowing: { state: 'taking-effect', why: 'not-journalled' } } }));
    expect(takingEffect()).toBe(takingEffectWords['not-journalled']);
    answered(ladder({ lastChange: { at: NOW, actor: 'operator', narrowing: { state: 'done' } } }));
    expect(takingEffect()).toBeNull();
  });

  it('a refusal says its sentence and refreshes the store; no line, no witness', async () => {
    answered(ladder());
    vi.spyOn(api, 'overlordRung').mockRejectedValue(new ApiError(503, { ok: false, error: 'authority-rolled-back', detail: 'witness-epoch' }));
    mount();
    fireEvent.click(rungButton('off'));
    const said = await screen.findByText(/authority reads rolled back/i);
    expect(said.textContent).toContain('(witness-epoch)');
    expect(takingEffect()).toBeNull();
    expect(nudgeWitness).not.toHaveBeenCalled();
    expect(refreshOverlord).toHaveBeenCalledTimes(1);
  });
});

describe('raising the rung', () => {
  it('a raise goes through the step-up', async () => {
    answered(ladder({ rungs: [
      { rung: 'off', available: true, needs: null }, { rung: 'chat', available: true, needs: null },
      { rung: 'advise', available: true, needs: 'overlord-route-v1' }, { rung: 'full', available: false, needs: 'overlord-answer-v1' },
    ] }));
    const rung = vi.spyOn(api, 'overlordRung').mockResolvedValue({ changed: true, rung: 'advise', narrowing: null });
    const stepUp = mount();
    fireEvent.click(rungButton('advise'));
    await waitFor(() => expect(rung).toHaveBeenCalledWith('advise'));
    expect(stepUp.runAct).toHaveBeenCalledTimes(1);
    expect(nudgeWitness).not.toHaveBeenCalled();
    expect(takingEffect()).toBeNull();
  });

  it('a raise is disabled while its word is missing: a tap sends nothing', () => {
    answered(ladder());
    const rung = vi.spyOn(api, 'overlordRung').mockResolvedValue({ changed: true, rung: 'advise' });
    mount();
    expect(rungButton('advise').disabled).toBe(true);
    fireEvent.click(rungButton('advise'));
    expect(rung).not.toHaveBeenCalled();
  });

  it('a forced call refused capability-missing says the sentence and names the word', async () => {
    answered(ladder());
    vi.spyOn(api, 'overlordRung').mockRejectedValue(new ApiError(409, { ok: false, error: 'capability-missing', needs: 'overlord-route-v1' }));
    mount();
    await act(async () => { await doorsOut!.setRung('advise'); });
    expect(part().querySelector('[data-said]')?.textContent)
      .toBe('This server does not advertise a capability word this needs, so nothing was changed. It needs overlord-route-v1.');
    expect(refreshOverlord).toHaveBeenCalledTimes(1);
  });
});

describe('a latch\'s Clear, a raise', () => {
  /** The real `useStepUp` on a fake box with no passkey enrolled (the passphrase arm), as the place mounts it. */
  function ClearHarness({ client }: { client: NonNullable<StepUpDeps['client']> }) {
    const deps = useMemo(() => ({ client }), [client]);
    const stepUp = useStepUp(Infinity, deps);
    const doors = useLadderDoors(stepUp);
    return (
      <>
        <LadderPart doors={doors} />
        <ConfirmItsYou stepUp={stepUp} subject="the Overlord's authority" />
      </>
    );
  }
  const stepClient = () => ({
    stepUpStart: vi.fn().mockResolvedValue({ allowCredentialIdsB64url: [] }),
    stepUpFinish: vi.fn(),
    stepUpPassphrase: vi.fn().mockResolvedValue({ stepUpFreshUntil: Date.now() + 300_000 }),
  });

  it('on step-up-required it shows the step, runs the act again once after it, draws no line, exchanges no witness, and refreshes the store', async () => {
    answered(ladder());
    const clear = vi.spyOn(api, 'clearLatch')
      .mockRejectedValueOnce(new ApiError(403, { ok: false, error: 'step-up-required' }))
      .mockResolvedValue({ changed: true });
    const client = stepClient();
    render(<ClearHarness client={client} />);
    const clearButton = (): HTMLElement => within(part().querySelector('[data-latch="restore-detected"]') as HTMLElement).getByRole('button', { name: /clear/i });
    fireEvent.click(clearButton());
    await waitFor(() => expect(document.querySelector('[data-step-up]')).not.toBeNull());
    expect(clear).toHaveBeenCalledTimes(1);
    expect(clear).toHaveBeenLastCalledWith('restore-detected');
    // Confirm it's you, with the passphrase arm; the stamp is fresh again and the operator presses Clear again.
    fireEvent.change(await screen.findByLabelText(/passphrase/i), { target: { value: 'pass-one' } });
    fireEvent.click(screen.getByRole('button', { name: /confirm with passphrase/i }));
    await waitFor(() => expect(document.querySelector('[data-step-up]')).toBeNull());
    expect(clear).toHaveBeenCalledTimes(1);   // the step never re-sends the act itself
    fireEvent.click(clearButton());
    await waitFor(() => expect(clear).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(refreshOverlord).toHaveBeenCalledTimes(2));
    expect(takingEffect()).toBeNull();
    expect(nudgeWitness).not.toHaveBeenCalled();
  });

  it('draws no "taking effect" line even when an earlier narrowing door left one, and exchanges no witness', async () => {
    answered(ladder());
    vi.spyOn(api, 'overlordRung').mockResolvedValue({ changed: true, rung: 'off', narrowing: { state: 'taking-effect', why: 'no-witness-yet' } });
    vi.spyOn(api, 'clearLatch').mockResolvedValue({ changed: true });
    const stepUp = mount();
    fireEvent.click(rungButton('off'));
    await waitFor(() => expect(takingEffect()).toBe(takingEffectWords['no-witness-yet']));
    vi.mocked(nudgeWitness).mockClear();
    fireEvent.click(within(part().querySelector('[data-latch="restore-detected"]') as HTMLElement).getByRole('button', { name: /clear/i }));
    await waitFor(() => expect(stepUp.runAct).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(takingEffect()).toBeNull());
    expect(nudgeWitness).not.toHaveBeenCalled();
  });

  it('a Clear that answers a narrowing anyway draws no line: Clear is a raise, never a narrowing door', async () => {
    answered(ladder());
    vi.spyOn(api, 'clearLatch').mockResolvedValue({ changed: true, narrowing: { state: 'taking-effect', why: 'no-witness-yet' } } as never);
    mount();
    fireEvent.click(within(part().querySelector('[data-latch="restore-detected"]') as HTMLElement).getByRole('button', { name: /clear/i }));
    await waitFor(() => expect(refreshOverlord).toHaveBeenCalledTimes(1));
    expect(takingEffect()).toBeNull();
    expect(nudgeWitness).not.toHaveBeenCalled();
  });

  it('a refusal says its sentence', async () => {
    answered(ladder());
    vi.spyOn(api, 'clearLatch').mockRejectedValue(new ApiError(503, { ok: false, error: 'unavailable', detail: 'the ladder could not be read' }));
    mount();
    fireEvent.click(within(part().querySelector('[data-latch="restore-detected"]') as HTMLElement).getByRole('button', { name: /clear/i }));
    expect(await screen.findByText(/state could not be read just now/i)).toBeTruthy();
  });
});

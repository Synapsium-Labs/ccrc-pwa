// The Overlord place's readiness part and its Pause (Overlord W1 home B, Task 4; plan question 5 and "The taking effect line").
// The part draws one read of the word as the store holds it: the word with its sentence, since, `until` as time left, `why`,
// the strand cause and where questions go, rendered FROM `questionsGo` and never decided from the word. A word it does not know
// is drawn raw; a failed read says "unmeasured", never a value. Pause is one tap with no step-up, and draws "taking effect"
// until the ladder read says `done`, keyed on the door's `narrowing` being present, never on `changed`.
// Neutral names only: the repository is public.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { LadderWire } from '../../shared/overlord-ladder';
import { READINESS_WORDS, STRAND_CAUSE_MAP, type ReadinessWire } from '../../shared/overlord-readiness';
import type { StepUp } from '../src/accounts/useStepUp';
import { ApiError, api } from '../src/lib/api';
import { nudgeWitness } from '../src/lib/witness';
import { ReadinessPart } from '../src/overlord/ReadinessPart';
import { useLadderDoors } from '../src/overlord/useLadderDoors';
import { clockOf, readinessWords } from '../src/overlord/readinessWords';
import { takingEffectWords } from '../src/overlord/ladderWords';
import { refreshOverlord, useOverlordStore } from '../src/stores/overlord';

vi.mock('../src/lib/witness', async (orig) => ({ ...(await orig<typeof import('../src/lib/witness')>()), nudgeWitness: vi.fn() }));
vi.mock('../src/stores/overlord', async (orig) => ({ ...(await orig<typeof import('../src/stores/overlord')>()), refreshOverlord: vi.fn(async () => {}) }));

const NOW = 1_700_000_000_000;
const wire = (over: Partial<ReadinessWire> = {}): ReadinessWire => ({
  word: 'ready', since: NOW - 120_000, why: null, until: null, questionsGo: 'operator', restartable: false, strandCause: null, ...over,
});
const answered = (w: ReadinessWire): void => {
  act(() => useOverlordStore.setState({ readiness: { state: 'answered', value: w, at: NOW } }));
};
const ladderWith = (narrowing: unknown): LadderWire =>
  ({ ok: true, operatorRung: 'off', lastChange: { at: NOW, actor: 'operator', narrowing } }) as unknown as LadderWire;

/** A stand-in for the place's one `useStepUp`: runs the act and counts the asks, so "no step-up" is a number. */
const fakeStepUp = (): StepUp => ({
  needed: false, arm: 'loading', ready: false, busy: false, notice: null, canRetry: false,
  confirm: () => {}, submitPassphrase: () => {}, retry: () => {}, actRefused: () => false,
  runAct: vi.fn(async (act: () => Promise<unknown>) => { await act(); return 'done' as const; }),
});

function Harness({ stepUp }: { stepUp: StepUp }) {
  const doors = useLadderDoors(stepUp);
  return <ReadinessPart doors={doors} />;
}
const mount = (stepUp: StepUp = fakeStepUp()) => { render(<Harness stepUp={stepUp} />); return stepUp; };
const part = (): HTMLElement => document.querySelector<HTMLElement>('[data-readiness-part]')!;
const takingEffect = (): string | null => document.querySelector('[data-taking-effect]')?.textContent ?? null;

beforeEach(() => {
  vi.setSystemTime(new Date(NOW));
  useOverlordStore.setState({ readiness: { state: 'loading' }, ladder: { state: 'loading' } });
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.mocked(nudgeWitness).mockClear();
  vi.mocked(refreshOverlord).mockClear();
});

describe('the readiness part draws the word', () => {
  it('each word renders its sentence', () => {
    for (const word of READINESS_WORDS) {
      answered(wire({ word }));
      mount();
      expect(part().querySelector('[data-readiness-sentence]')?.textContent, word).toBe(readinessWords[word].sentence);
      expect(part().querySelector('[data-readiness-word]')?.textContent, word).toBe(word);
      cleanup();
    }
  });

  it('draws since as a clock', () => {
    answered(wire());
    mount();
    expect(part().querySelector('[data-readiness-since]')?.textContent).toContain(clockOf(NOW - 120_000));
  });

  it('renders where questions go from the field: a ready word still says "to you" in W1', () => {
    answered(wire({ word: 'ready', questionsGo: 'operator' }));
    mount();
    expect(screen.getByText('Questions go to you')).toBeTruthy();
  });

  it('a questionsGo value this build does not know is drawn raw, whatever the word', () => {
    answered(wire({ word: 'off', questionsGo: 'overlord' as never }));
    mount();
    expect(screen.getByText('Questions go to: overlord')).toBeTruthy();
    expect(screen.queryByText('Questions go to you')).toBeNull();
  });

  it('an unknown word is drawn raw, with "unknown word"', () => {
    answered(wire({ word: 'hovering' as never }));
    mount();
    expect(part().querySelector('[data-readiness-word]')?.textContent).toBe('hovering');
    expect(part().querySelector('[data-readiness-sentence]')?.textContent).toBe('unknown word');
  });

  it('renewing and restarting say the time left; ready does not', () => {
    answered(wire({ word: 'renewing', until: NOW + 5 * 60_000 }));
    mount();
    expect(part().querySelector('[data-readiness-left]')?.textContent).toBe('5 min left');
    cleanup();
    answered(wire({ word: 'ready', until: NOW + 5 * 60_000 }));
    mount();
    expect(part().querySelector('[data-readiness-left]')).toBeNull();
  });

  it('unmeasured and dead say why; stranded says its cause in the cause\'s sentence', () => {
    answered(wire({ word: 'unmeasured', why: 'registry' }));
    mount();
    expect(part().querySelector('[data-readiness-why]')?.textContent).toContain('registry');
    cleanup();
    answered(wire({ word: 'dead', why: 'third restart in the hour' }));
    mount();
    expect(part().querySelector('[data-readiness-why]')?.textContent).toContain('third restart in the hour');
    cleanup();
    answered(wire({ word: 'stranded', strandCause: 'limited' }));
    mount();
    expect(part().querySelector('[data-readiness-strand]')?.textContent).toContain(STRAND_CAUSE_MAP.limited);
  });
});

describe('the readiness part, when the read is not an answer', () => {
  it('loading says loading', () => {
    mount();
    expect(part().textContent).toContain('Loading…');
  });

  it('a failed read says unmeasured with its error, and names no word', () => {
    act(() => useOverlordStore.setState({ readiness: { state: 'unmeasured', error: 'HTTP 503' } }));
    mount();
    const said = part().querySelector('[data-readiness-unmeasured]');
    expect(said?.textContent).toContain('unmeasured');
    expect(said?.textContent).toContain('HTTP 503');
    expect(part().querySelector('[data-readiness-word]')).toBeNull();
    expect(part().textContent).not.toMatch(/quiet|ready/i);
  });

  it('a stale read draws the last answer with its read time', () => {
    act(() => useOverlordStore.setState({ readiness: { state: 'stale', value: wire({ word: 'degraded' }), at: NOW - 90_000, error: 'timeout' } }));
    mount();
    expect(part().querySelector('[data-readiness-sentence]')?.textContent).toBe(readinessWords.degraded.sentence);
    expect(part().querySelector('[data-readiness-stale]')?.textContent).toBe(`last read ${clockOf(NOW - 90_000)}`);
  });

  it('an absent read says no Overlord is bound', () => {
    act(() => useOverlordStore.setState({ readiness: { state: 'absent' } }));
    mount();
    expect(part().textContent).toContain('No Overlord is bound');
  });

  it('Pause stays drawn whatever the read says: the brake never hides', () => {
    act(() => useOverlordStore.setState({ readiness: { state: 'unmeasured', error: 'HTTP 503' } }));
    mount();
    expect(screen.getByRole('button', { name: /^pause/i })).toBeTruthy();
  });
});

describe('Pause', () => {
  const TAKING = { state: 'taking-effect', why: 'no-witness-yet' } as const;

  it('sends one request with no step-up, then draws "taking effect" until the ladder read says done', async () => {
    answered(wire());
    const pause = vi.spyOn(api, 'overlordPause').mockResolvedValue({ changed: true, rung: 'off', narrowing: TAKING });
    const stepUp = mount();
    fireEvent.click(screen.getByRole('button', { name: /^pause/i }));
    await waitFor(() => expect(takingEffect()).toBe(takingEffectWords['no-witness-yet']));
    expect(pause).toHaveBeenCalledTimes(1);
    expect(stepUp.runAct).not.toHaveBeenCalled();
    // The ladder read the change as still taking effect, for another reason: its sentence rules.
    act(() => useOverlordStore.setState({ ladder: { state: 'answered', at: NOW, value: ladderWith({ state: 'taking-effect', why: 'not-journalled' }) } }));
    expect(takingEffect()).toBe(takingEffectWords['not-journalled']);
    act(() => useOverlordStore.setState({ ladder: { state: 'answered', at: NOW, value: ladderWith({ state: 'done' }) } }));
    expect(takingEffect()).toBeNull();
  });

  it('exchanges the witness once and refreshes the store after the answer', async () => {
    answered(wire());
    vi.spyOn(api, 'overlordPause').mockResolvedValue({ changed: true, rung: 'off', narrowing: TAKING });
    mount();
    fireEvent.click(screen.getByRole('button', { name: /^pause/i }));
    await waitFor(() => expect(refreshOverlord).toHaveBeenCalledTimes(1));
    expect(nudgeWitness).toHaveBeenCalledTimes(1);
  });

  it('the line is keyed on the narrowing being present, never on changed', async () => {
    answered(wire());
    vi.spyOn(api, 'overlordPause').mockResolvedValue({ changed: false, rung: 'chat', narrowing: { state: 'taking-effect', why: 'not-journalled' } });
    mount();
    fireEvent.click(screen.getByRole('button', { name: /^pause/i }));
    await waitFor(() => expect(takingEffect()).toBe(takingEffectWords['not-journalled']));
    expect(nudgeWitness).toHaveBeenCalledTimes(1);
  });

  it('an answer with no narrowing draws no line and exchanges nothing (main answers {changed:false, rung} from chat)', async () => {
    answered(wire());
    vi.spyOn(api, 'overlordPause').mockResolvedValue({ changed: false, rung: 'chat' });
    mount();
    fireEvent.click(screen.getByRole('button', { name: /^pause/i }));
    await waitFor(() => expect(refreshOverlord).toHaveBeenCalledTimes(1));
    expect(takingEffect()).toBeNull();
    expect(nudgeWitness).not.toHaveBeenCalled();
  });

  it('a null narrowing is not a narrowing', async () => {
    answered(wire());
    vi.spyOn(api, 'overlordPause').mockResolvedValue({ changed: true, rung: 'off', narrowing: null });
    mount();
    fireEvent.click(screen.getByRole('button', { name: /^pause/i }));
    await waitFor(() => expect(refreshOverlord).toHaveBeenCalledTimes(1));
    expect(takingEffect()).toBeNull();
    expect(nudgeWitness).not.toHaveBeenCalled();
  });

  it('a refusal says its sentence, never swallowed, and the store is refreshed all the same', async () => {
    answered(wire());
    vi.spyOn(api, 'overlordPause').mockRejectedValue(new ApiError(503, { ok: false, error: 'journal-unreadable', detail: 'the authority journal could not be read' }));
    mount();
    fireEvent.click(screen.getByRole('button', { name: /^pause/i }));
    const said = await screen.findByText(/authority journal could not record this/i);
    expect(said.textContent).toContain('(the authority journal could not be read)');
    expect(takingEffect()).toBeNull();
    expect(refreshOverlord).toHaveBeenCalledTimes(1);
    expect(nudgeWitness).not.toHaveBeenCalled();
  });

  it('a word this build does not know is drawn raw', async () => {
    answered(wire());
    vi.spyOn(api, 'overlordPause').mockRejectedValue(new ApiError(409, { ok: false, error: 'a-newer-word' }));
    mount();
    fireEvent.click(screen.getByRole('button', { name: /^pause/i }));
    expect(await screen.findByText('Refused: a-newer-word')).toBeTruthy();
  });

  it('a 401 is left to the sign-in screen: nothing is said', async () => {
    answered(wire());
    vi.spyOn(api, 'overlordPause').mockRejectedValue(new ApiError(401, { ok: false, error: 'unauthorized' }));
    mount();
    fireEvent.click(screen.getByRole('button', { name: /^pause/i }));
    await waitFor(() => expect(refreshOverlord).toHaveBeenCalledTimes(1));
    expect(document.querySelector('[data-said]')).toBeNull();
  });

  it('is one tap: a second tap while the first is in flight sends nothing', async () => {
    answered(wire());
    let release: (v: { changed: boolean; rung: 'off' }) => void = () => {};
    const pause = vi.spyOn(api, 'overlordPause').mockReturnValue(new Promise((r) => { release = r; }));
    mount();
    const button = screen.getByRole('button', { name: /^pause/i });
    fireEvent.click(button);
    fireEvent.click(button);
    expect(pause).toHaveBeenCalledTimes(1);
    expect((button as HTMLButtonElement).disabled).toBe(true);
    await act(async () => { release({ changed: true, rung: 'off' }); });
    await waitFor(() => expect((button as HTMLButtonElement).disabled).toBe(false));
  });
});

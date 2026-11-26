// The readiness word's one-line form (Overlord W1 home B, Task 4; plan question 5 and question 9): drawn on the Fleet's health row
// and in Waiting on you's head, only while the console reads `overlord-v1` and the word is not `absent` (neither the read state
// nor the word). A failed read says unmeasured, never a value; a stale one says when it was read. Neutral names only.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render, screen } from '@testing-library/react';
import type { ReadinessWire } from '../../shared/overlord-readiness';
import { api } from '../src/lib/api';
import { resetAcks } from '../src/lib/seen';
import { ReadinessLine } from '../src/overlord/ReadinessLine';
import { clockOf, readinessWords } from '../src/overlord/readinessWords';
import { WaitingScreen } from '../src/ledgers/WaitingScreen';
import { FleetScreen } from '../src/screens/FleetScreen';
import { createFleetStore, type FleetStore } from '../src/stores/fleet';
import { useOverlordStore } from '../src/stores/overlord';
import { renderFleet } from './fleetHost';
import { NOW, waitingView } from './ledgersFixture';

vi.mock('../src/fleet/FleetCards', () => ({ FleetCards: () => null }));

const AT = 1_700_000_000_000;
const wire = (over: Partial<ReadinessWire> = {}): ReadinessWire => ({
  word: 'ready', since: AT - 120_000, why: null, until: null, questionsGo: 'operator', restartable: false, strandCause: null, ...over,
});
const WITH_WORD = { state: 'answered', value: ['overlord-v1'], at: AT } as const;
const WITHOUT_WORD = { state: 'answered', value: ['mail-v1'], at: AT } as const;
const set = (s: Partial<ReturnType<typeof useOverlordStore.getState>>): void => { act(() => useOverlordStore.setState(s)); };
const lineEl = (): HTMLElement | null => document.querySelector<HTMLElement>('[data-readiness-line]');

beforeEach(() => {
  window.localStorage.clear();
  resetAcks();
  vi.spyOn(api, 'updates').mockReturnValue(new Promise(() => {}));
  useOverlordStore.setState({ caps: { state: 'loading' }, readiness: { state: 'loading' } });
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('the readiness line', () => {
  it('draws the word\'s sentence, its since and where questions go, under overlord-v1', () => {
    set({ caps: WITH_WORD, readiness: { state: 'answered', value: wire({ word: 'degraded' }), at: AT } });
    render(<ReadinessLine />);
    const text = lineEl()!.textContent!;
    expect(text).toContain(readinessWords.degraded.sentence);
    expect(text).toContain(`since ${clockOf(AT - 120_000)}`);
    expect(text).toContain('Questions go to you');
  });

  it('draws nothing without overlord-v1, whatever the word says', () => {
    set({ caps: WITHOUT_WORD, readiness: { state: 'answered', value: wire(), at: AT } });
    const { container } = render(<ReadinessLine />);
    expect(container.firstChild).toBeNull();
  });

  it('draws nothing while the caps are loading or failed', () => {
    set({ readiness: { state: 'answered', value: wire(), at: AT } });
    const { container, rerender } = render(<ReadinessLine />);
    expect(container.firstChild).toBeNull();
    set({ caps: { state: 'unmeasured', error: 'HTTP 503' } });
    rerender(<ReadinessLine />);
    expect(container.firstChild).toBeNull();
  });

  it('draws nothing for the word absent, nor for an absent read, nor while loading', () => {
    set({ caps: WITH_WORD, readiness: { state: 'answered', value: wire({ word: 'absent', since: 0 }), at: AT } });
    const { container, rerender } = render(<ReadinessLine />);
    expect(container.firstChild).toBeNull();
    set({ readiness: { state: 'absent' } });
    rerender(<ReadinessLine />);
    expect(container.firstChild).toBeNull();
    set({ readiness: { state: 'loading' } });
    rerender(<ReadinessLine />);
    expect(container.firstChild).toBeNull();
  });

  it('a failed read says unmeasured, never a value', () => {
    set({ caps: WITH_WORD, readiness: { state: 'unmeasured', error: 'HTTP 503' } });
    render(<ReadinessLine />);
    expect(lineEl()!.textContent).toMatch(/unmeasured/);
    expect(lineEl()!.textContent).not.toMatch(/ready|quiet/i);
  });

  it('a stale read draws the last answer and says when it was read', () => {
    set({ caps: WITH_WORD, readiness: { state: 'stale', value: wire({ word: 'wedged' }), at: AT - 60_000, error: 'timeout' } });
    render(<ReadinessLine />);
    expect(lineEl()!.textContent).toContain(readinessWords.wedged.sentence);
    expect(lineEl()!.textContent).toContain(`last read ${clockOf(AT - 60_000)}`);
  });

  it('an unknown word is drawn raw, and questionsGo is drawn from the field', () => {
    set({ caps: WITH_WORD, readiness: { state: 'answered', value: wire({ word: 'hovering' as never, questionsGo: 'overlord' as never }), at: AT } });
    render(<ReadinessLine />);
    expect(lineEl()!.textContent).toContain('unknown word');
    expect(lineEl()!.textContent).toContain('hovering');
    expect(lineEl()!.textContent).toContain('Questions go to: overlord');
  });

  it('carries the word as a hook for the browser suite and its tone as a class hook', () => {
    set({ caps: WITH_WORD, readiness: { state: 'answered', value: wire({ word: 'dead' }), at: AT } });
    render(<ReadinessLine />);
    expect(lineEl()!.getAttribute('data-readiness-word')).toBe('dead');
    expect(lineEl()!.getAttribute('data-tone')).toBe('dead');
  });
});

describe('where the line is mounted', () => {
  it('Waiting on you draws it in its head, in the answered and the unavailable states, and not without the word', () => {
    set({ caps: WITH_WORD, readiness: { state: 'answered', value: wire(), at: AT } });
    const { rerender } = render(<WaitingScreen view={waitingView()} sessions={[]} runs={[]} now={NOW} onOpenItem={() => {}} onOpenSession={() => {}} />);
    expect(document.querySelector('.wl-head [data-readiness-line]')).not.toBeNull();
    rerender(<WaitingScreen view={null} sessions={null} runs={[]} now={NOW} onOpenItem={() => {}} onOpenSession={() => {}} />);
    expect(document.querySelector('.wl-head [data-readiness-line]')).not.toBeNull();
    set({ caps: WITHOUT_WORD });
    expect(document.querySelector('[data-readiness-line]')).toBeNull();
  });

  it('Waiting on you draws no line for an absent word', () => {
    set({ caps: WITH_WORD, readiness: { state: 'answered', value: wire({ word: 'absent', since: 0 }), at: AT } });
    render(<WaitingScreen view={waitingView()} sessions={[]} runs={[]} now={NOW} onOpenItem={() => {}} onOpenSession={() => {}} />);
    expect(document.querySelector('[data-readiness-line]')).toBeNull();
    expect(screen.getByText('Waiting on you')).toBeTruthy();
  });

  const fleet = (): FleetStore => createFleetStore({
    makeSocket: () => ({ onopen: null, onmessage: null, onclose: null, onerror: null, close(): void {} }) as unknown as WebSocket,
  });

  it('the Fleet draws it beside its build line under overlord-v1, and not for an absent word or without the word', () => {
    set({ caps: WITH_WORD, readiness: { state: 'answered', value: wire({ word: 'degraded' }), at: AT } });
    const store = fleet();
    renderFleet(<FleetScreen store={store} />, store);
    expect(document.querySelectorAll('[data-readiness-line]')).toHaveLength(1);
    set({ readiness: { state: 'answered', value: wire({ word: 'absent', since: 0 }), at: AT } });
    expect(document.querySelector('[data-readiness-line]')).toBeNull();
    set({ readiness: { state: 'answered', value: wire(), at: AT }, caps: WITHOUT_WORD });
    expect(document.querySelector('[data-readiness-line]')).toBeNull();
  });
});

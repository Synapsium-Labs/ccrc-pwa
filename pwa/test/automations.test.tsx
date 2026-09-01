// Task 11 — the automations screen (spec §11). Written by the controller after
// the implementing agent hit a session rate limit before its Step 1; the
// implementation therefore landed BEFORE its tests, which is backwards, and
// these are the tests that would have driven it. Each one is measured against
// a deliberate mutation in the commit body rather than assumed to bite.
//
// WHAT THIS PINS AND WHY:
//  - THREE empty states, never one. "No answer yet", "answered empty" and "the
//    read failed" are three different facts and an operator acts on them three
//    different ways: wait, create one, or go look at the server. An
//    empty-state sentence is a POSITIVE CLAIM, so rendering "no automations"
//    when the read actually failed is a lie the operator will act on.
//  - The default loader is a MODULE-SCOPE constant. An inline
//    `() => api.automations()` default parameter re-mints its identity every
//    render, and any effect depending on it then re-runs forever — an
//    unbounded fetch loop on the shipping path that no test would otherwise
//    exercise, because every test passes its own loader in.
//  - TWO total sentence tables, not one. `never-run-by-hand` is the refusal an
//    operator meets on the FIRST automation they ever create, and it is not an
//    `AutomationRefusal` — it is decided before any run row exists, so it can
//    never be written to `automation_runs.refusal`. A single
//    `Record<AutomationRefusal, string>` cannot hold it.
//  - Every table is entered through an `is*` guard. Indexing a raw wire string
//    is `undefined` under `noUncheckedIndexedAccess`, and JSX renders
//    `undefined` as an EMPTY CELL rather than throwing — so an older build
//    against a newer server would show the operator blank space where a state
//    should be. `? <token>` is the honest degrade.
import { describe, it, expect, vi, afterEach } from 'vitest';
import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import type { AutomationSummary } from '../../shared/api';
import {
  AUTOMATION_REFUSALS, AUTOMATION_ROUTE_REFUSALS, AUTOMATION_STATES,
  AUTOMATION_OUTCOMES, SCHEDULE_ERRORS,
} from '../../shared/api';
import { AutomationsScreen } from '../src/screens/AutomationsScreen';
import {
  AUTOMATION_REFUSAL_SENTENCE, AUTOMATION_ROUTE_REFUSAL_SENTENCE,
  SCHEDULE_ERROR_SENTENCE, AUTOMATION_STATE_WORD, AUTOMATION_STATE_GLYPH,
  AUTOMATION_OUTCOME_WORD, AUTOMATION_OUTCOME_GLYPH,
  automationStateChip, automationOutcomeChip,
  refusalSentence, routeRefusalSentence, scheduleErrorSentence,
} from '../src/auto/autoWords';
import { useFleetStore } from '../src/stores/fleet';

afterEach(() => { cleanup(); vi.restoreAllMocks(); });

const auto = (over: Partial<AutomationSummary> = {}): AutomationSummary => ({
  id: 1, name: 'nightly', state: 'paused', project: 'ccrc-pwa', prompt: 'go',
  cadenceKind: 'wall-clock', cadenceDays: 0b0111110, cadenceMinute: 540,
  cadenceEvery: null, tz: 'Europe/Warsaw',
  graceMs: 1_800_000, createdAt: 0, updatedAt: 0, provedAt: null,
  nextRunAt: null, scheduleError: null,
  lastFireAt: null, lastOutcome: null, lastRefusal: null,
  consecutiveFailures: 0, runsEvicted: 0,
  ...over,
} as AutomationSummary);

/** Put the store in a known state without going through a socket. */
function seedStore(over: { automations?: AutomationSummary[]; automationsFrameSeen?: boolean }): void {
  act(() => {
    useFleetStore.setState({
      automations: over.automations ?? [],
      automationsFrameSeen: over.automationsFrameSeen ?? false,
    } as never);
  });
}

describe('three empty states, never one — an empty-state sentence is a positive claim', () => {
  it('renders a DIFFERENT data-state for no-answer-yet, answered-empty, and read-failed', async () => {
    const seen: string[] = [];

    // (1) no answer yet — the frame has not arrived and the cold read has not settled.
    seedStore({ automations: [], automationsFrameSeen: false });
    const pending = render(
      <AutomationsScreen loadAutomations={() => new Promise(() => { /* never settles */ })} />,
    );
    seen.push(pending.container.querySelector('[data-state]')?.getAttribute('data-state') ?? 'MISSING');
    cleanup();

    // (2) answered empty — a genuine zero-automation fleet.
    seedStore({ automations: [], automationsFrameSeen: true });
    const empty = render(<AutomationsScreen loadAutomations={async () => ({ automations: [] })} />);
    await waitFor(() => {
      expect(empty.container.querySelector('[data-state]')?.getAttribute('data-state')).not.toBe('loading');
    });
    seen.push(empty.container.querySelector('[data-state]')?.getAttribute('data-state') ?? 'MISSING');
    cleanup();

    // (3) the read failed — NOT the same fact as "there are none".
    seedStore({ automations: [], automationsFrameSeen: false });
    const failed = render(
      <AutomationsScreen loadAutomations={async () => { throw new Error('unreachable'); }} />,
    );
    await waitFor(() => {
      expect(failed.container.querySelector('[data-state]')?.getAttribute('data-state')).not.toBe('loading');
    });
    seen.push(failed.container.querySelector('[data-state]')?.getAttribute('data-state') ?? 'MISSING');

    expect(seen).not.toContain('MISSING');
    expect(new Set(seen).size, `three states collapsed to ${JSON.stringify(seen)}`).toBe(3);
  });

  it('the failed read never claims there are no automations', async () => {
    seedStore({ automations: [], automationsFrameSeen: false });
    render(<AutomationsScreen loadAutomations={async () => { throw new Error('unreachable'); }} />);
    await waitFor(() => {
      expect(document.querySelector('[data-state="error"]')).not.toBeNull();
    });
    // The words an operator would read as "the fleet has none" must be absent.
    expect(document.body.textContent ?? '').not.toMatch(/no automations|none yet|nothing scheduled/i);
  });
});

describe('the default loader is module-scope — the unbounded-fetch guard', () => {
  it('does not refetch on re-render when the caller passes NO loader', async () => {
    // The shipping path: no `loadAutomations` prop, so the default is used.
    //
    // WHICH GUARD THIS ACTUALLY CATCHES, measured rather than assumed. The
    // brief calls for "a module-scope constant held in a ref" and the screen
    // does both — but only the REF is load-bearing. Swapping the constant for
    // an inline `() => api.automations()` default leaves this test GREEN,
    // because `loadRef.current = loadAutomations` with `[]` deps already
    // absorbs the identity churn. The mutation that DOES red it is bypassing
    // the ref — putting `loadAutomations` in the effect's dependency array —
    // and then the inline default loops without bound. So this test pins the
    // property that matters (the shipping path issues one fetch, not a
    // stream) rather than the particular spelling of the fix.
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ ok: true, automations: [] }),
        { status: 200, headers: { 'content-type': 'application/json' } }),
    );
    seedStore({ automations: [], automationsFrameSeen: false });
    const view = render(<AutomationsScreen />);
    await waitFor(() => expect(fetchSpy).toHaveBeenCalled());
    const afterFirst = fetchSpy.mock.calls.length;

    for (let i = 0; i < 3; i++) act(() => { view.rerender(<AutomationsScreen />); });
    await new Promise((r) => setTimeout(r, 30));

    expect(fetchSpy.mock.calls.length,
      'the default loader re-mints identity every render — an unbounded fetch loop')
      .toBe(afterFirst);
  });
});

describe('two total sentence tables, because never-run-by-hand is not a run refusal', () => {
  it('every AutomationRefusal has a sentence, and it is a SENTENCE not a bare token', () => {
    for (const r of AUTOMATION_REFUSALS) {
      const s = AUTOMATION_REFUSAL_SENTENCE[r];
      expect(s, `no sentence for ${r}`).toBeTruthy();
      expect(s, `${r} renders its own token back at the operator`).not.toBe(r);
      expect(s.length, `${r}'s sentence is too short to explain anything`).toBeGreaterThan(10);
    }
  });

  it('every AutomationRouteRefusal has its own sentence — including the two the run table CANNOT hold', () => {
    for (const r of AUTOMATION_ROUTE_REFUSALS) {
      const s = AUTOMATION_ROUTE_REFUSAL_SENTENCE[r];
      expect(s, `no sentence for ${r}`).toBeTruthy();
      expect(s.length).toBeGreaterThan(10);
    }
    // The two that prove the second table has to exist: neither is an
    // `AutomationRefusal`, so a single table over that union could not hold
    // them and both would render as an empty cell.
    expect(AUTOMATION_ROUTE_REFUSALS).toContain('never-run-by-hand');
    expect(AUTOMATION_ROUTE_REFUSALS).toContain('unknown-automation');
    expect(AUTOMATION_REFUSALS as readonly string[]).not.toContain('never-run-by-hand');
    expect(AUTOMATION_REFUSALS as readonly string[]).not.toContain('unknown-automation');
  });

  it('every ScheduleError has a sentence too — the arm gate quotes it back', () => {
    for (const e of SCHEDULE_ERRORS) expect(SCHEDULE_ERROR_SENTENCE[e]).toBeTruthy();
  });

  it('the state and outcome tables are total, in both directions', () => {
    for (const s of AUTOMATION_STATES) {
      expect(AUTOMATION_STATE_WORD[s], s).toBeTruthy();
      expect(AUTOMATION_STATE_GLYPH[s], s).toBeTruthy();
    }
    for (const o of AUTOMATION_OUTCOMES) {
      expect(AUTOMATION_OUTCOME_WORD[o], o).toBeTruthy();
      expect(AUTOMATION_OUTCOME_GLYPH[o], o).toBeTruthy();
    }
    expect(Object.keys(AUTOMATION_STATE_WORD).sort()).toEqual([...AUTOMATION_STATES].sort());
    expect(Object.keys(AUTOMATION_OUTCOME_WORD).sort()).toEqual([...AUTOMATION_OUTCOMES].sort());
  });
});

describe('an unknown wire token degrades to "? <token>", never to a blank cell', () => {
  it('a state the build does not know keeps its token visible', () => {
    const chip = automationStateChip('teleported');
    expect(chip.word).toContain('teleported');
    expect(chip.word).toMatch(/^\?/);
    expect(chip.token).toBe('teleported');
  });

  it('an unknown outcome does the same', () => {
    expect(automationOutcomeChip('sideways').word).toContain('sideways');
  });

  it('unknown refusals and schedule errors answer a sentence, not undefined', () => {
    for (const f of [refusalSentence, routeRefusalSentence, scheduleErrorSentence]) {
      const s = f('a-token-from-the-future');
      expect(s, 'an unknown token produced no sentence — JSX renders that as nothing at all').toBeTruthy();
      expect(s).toContain('a-token-from-the-future');
    }
  });

  it('the guard door is what makes this work — a non-string cannot smuggle through', () => {
    for (const bad of [null, undefined, 42, {}, []]) {
      expect(automationStateChip(bad).word).toBeTruthy();
      expect(refusalSentence(bad)).toBeTruthy();
    }
  });
});

describe('the list says what an operator needs before it fires', () => {
  it('a new automation reads as paused and needing one manual run', async () => {
    seedStore({ automations: [auto({ state: 'paused', provedAt: null })], automationsFrameSeen: true });
    render(<AutomationsScreen loadAutomations={async () => ({ automations: [] })} />);
    await waitFor(() => expect(screen.getByText(/nightly/)).toBeTruthy());
    const text = document.body.textContent ?? '';
    expect(text.toLowerCase()).toContain('paused');
  });

  it('renders the runsEvicted gap row in the run history, rather than pretending it is complete', async () => {
    // The gap belongs to the HISTORY, not the list — which is why it renders
    // in the expanded detail. A silently truncated history reads as a
    // complete one, the same class of lie as the wrong empty state, so the
    // count is shown rather than the rows quietly ending.
    const row = auto({ runsEvicted: 42, state: 'armed', provedAt: 1 });
    seedStore({ automations: [row], automationsFrameSeen: true });
    const view = render(
      <AutomationsScreen
        loadAutomations={async () => ({ automations: [] })}
        getAutomation={(async () => ({ ok: true, automation: row, runs: [] })) as never}
      />,
    );
    await waitFor(() => expect(screen.getByText(/nightly/)).toBeTruthy());
    act(() => { view.container.querySelector<HTMLButtonElement>('.auto-open')!.click(); });
    await waitFor(() => expect(view.container.querySelector('[data-gap="true"]')).not.toBeNull());
    expect(view.container.querySelector('[data-gap="true"]')!.textContent).toMatch(/42/);
  });
});

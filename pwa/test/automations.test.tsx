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
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { AutomationRunSummary, AutomationSummary } from '../../shared/api';
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

// ── *Run now* after the claim-only cut-over ────────────────────────────────
//
// The route answers `202` the moment the run is CLAIMED; the spawn happens on
// the box's next sweep pass. Two things about the phone follow, and neither
// was covered before — `runAutomation` appeared nowhere in this suite, so the
// whole manual door was untested on the client.
const runRow = (over: Partial<AutomationRunSummary> = {}): AutomationRunSummary => ({
  id: 7, automationId: 1, scheduledFor: 0, startedAt: 0, endedAt: null, lateMs: 0,
  outcome: 'running', refusal: null, trigger: 'manual', dstShifted: false, adopted: false,
  sessionId: null, workspace: null, branch: null, wrapper: null, homeScore: null, spawnRc: null,
  ...over,
} as AutomationRunSummary);

const openRow = async (): Promise<void> => {
  const toggle = await screen.findByRole('button', { name: /nightly/ });
  fireEvent.click(toggle);
};

describe('the filter chips say what they are and whether they are on', () => {
  it('names each chip by its dimension, so two "all" chips are two controls', async () => {
    // `stateFilters` and `outcomeFilters` both contain `all`, so before this
    // there were two buttons with the identical accessible name "all" — a
    // screen reader, and any test, could only say "the all button" and mean
    // either.
    seedStore({ automations: [auto()], automationsFrameSeen: true });
    render(<AutomationsScreen loadAutomations={async () => ({ automations: [auto()] })} />);
    expect(await screen.findByRole('button', { name: 'state: all' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'last outcome: all' })).toBeInTheDocument();
  });

  it('carries selection as aria-pressed, not as colour alone', async () => {
    // Selection used to live ONLY in `data-selected`, which is not in the
    // accessibility tree — its whole visible effect is a colour and a border
    // on `.auto-filter[data-selected='true']`. State by colour alone is on
    // this project's refused list.
    seedStore({ automations: [auto()], automationsFrameSeen: true });
    render(<AutomationsScreen loadAutomations={async () => ({ automations: [auto()] })} />);
    const all = await screen.findByRole('button', { name: 'state: all' });
    const armed = screen.getByRole('button', { name: 'state: armed' });
    expect(all).toHaveAttribute('aria-pressed', 'true');
    expect(armed).toHaveAttribute('aria-pressed', 'false');
    fireEvent.click(armed);
    expect(screen.getByRole('button', { name: 'state: armed' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: 'state: all' })).toHaveAttribute('aria-pressed', 'false');
  });
});

describe('the step trail — the log the runner exists to leave behind', () => {
  it('opens a run and renders its steps in order, with the truncation marker', async () => {
    // Spec §11's run detail: "the step trail in order, each with time, `ok`,
    // detail, and a visible marker when `truncatedBytes > 0`". The route and
    // its api client both shipped; NOTHING rendered them, so the branch's
    // whole point — "full history of runs AND LOGS" — stopped at the run's
    // one-line outcome. A refused spawn's ccd stderr, the reason a prompt did
    // not land, which rung refused: all of it was on the box and nowhere a
    // phone could see it.
    const steps = [
      { id: 1, runId: 7, at: 1_000, step: 'precheck' as const, ok: true, detail: 'placed on claude, homeScore 12', truncatedBytes: 0 },
      { id: 2, runId: 7, at: 2_000, step: 'spawn' as const, ok: false, detail: 'ws-add failed: disk floor', truncatedBytes: 48 },
      { id: 3, runId: 7, at: 3_000, step: 'close' as const, ok: false, detail: 'settled refused:spawn-refused', truncatedBytes: 0 },
    ];
    const row = runRow({ id: 7, outcome: 'refused', refusal: 'spawn-refused', endedAt: 3_000 });
    seedStore({ automations: [auto()], automationsFrameSeen: true });
    render(
      <AutomationsScreen
        loadAutomations={async () => ({ automations: [auto()] })}
        getAutomation={async () => ({ automation: auto(), runs: [row] })}
        getRun={async (runId: number) => {
          expect(runId, 'the trail is fetched for the run that was tapped').toBe(7);
          return { run: row, steps };
        }}
      />,
    );
    await openRow();
    fireEvent.click(await screen.findByRole('button', { name: /refused/ }));

    let trail: HTMLElement[] = [];
    await waitFor(() => {
      trail = screen.getAllByRole('listitem').filter((li) => li.className.includes('auto-step-row'));
      expect(trail.length).toBe(3);
    });
    expect(trail.map((li) => li.textContent ?? ''), 'in the order the act wrote them')
      .toEqual([
        expect.stringContaining('precheck'),
        expect.stringContaining('spawn'),
        expect.stringContaining('close'),
      ]);
    expect(trail[1]!.textContent).toContain('ws-add failed: disk floor');
    expect(trail[1]!.getAttribute('data-ok'), 'a failed step is marked as one').toBe('false');
    expect(trail[0]!.getAttribute('data-ok')).toBe('true');
    // `truncatedBytes > 0` is a VISIBLE marker, not a silence: the operator
    // must know the text they are reading is not all of it.
    expect(trail[1]!.textContent).toMatch(/48 bytes/);
  });

  it('says which of the three things happened — loading, failed, or a run with no steps', async () => {
    const row = runRow({ id: 7 });
    let reject: ((e: Error) => void) | null = null;
    seedStore({ automations: [auto()], automationsFrameSeen: true });
    render(
      <AutomationsScreen
        loadAutomations={async () => ({ automations: [auto()] })}
        getAutomation={async () => ({ automation: auto(), runs: [row] })}
        getRun={async () => new Promise((_res, rej) => { reject = rej; })}
      />,
    );
    await openRow();
    // The run row's own door, not a filter chip that happens to share a word.
    const runOpen = await waitFor(() => {
      const b = screen.getAllByRole('button').find((x) => x.className.includes('auto-run-open'));
      expect(b, 'the panel is open and its run row is there').toBeDefined();
      return b!;
    });
    fireEvent.click(runOpen);
    expect(await screen.findByText('Loading…')).toBeInTheDocument();
    await act(async () => { reject!(new Error('offline')); });
    const err = await screen.findByText(/Could not reach the server/);
    expect(err, 'a failed trail read must not read as "this run had no steps"')
      .toHaveAttribute('data-state', 'error');
  });
});

describe('the global kill switch has a door, and the door shows which way it points', () => {
  it('reads the switch from the server and flips it', async () => {
    let paused = true;
    const calls: boolean[] = [];
    seedStore({ automations: [auto()], automationsFrameSeen: true });
    render(
      <AutomationsScreen
        loadAutomations={async () => ({ automations: [auto()], paused })}
        pauseAutomations={async (p: boolean) => { calls.push(p); paused = p; return { paused: p }; }}
      />,
    );
    // It POINTS somewhere: an operator must be able to see that every
    // automation on this box is currently held, which is exactly what a
    // set-only route could never tell them.
    const toggle = await screen.findByRole('button', { name: /automations paused|pause all automations/i });
    expect(toggle).toHaveAttribute('aria-pressed', 'true');
    fireEvent.click(toggle);
    await waitFor(() => { expect(calls).toEqual([false]); });
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /automations paused|pause all automations/i }))
        .toHaveAttribute('aria-pressed', 'false');
    });
  });
});

describe('the filters actually narrow the list', () => {
  it('each chip and the project select narrow it, and an empty result says FILTERED, not empty', async () => {
    // The chip fixtures asserted `aria-pressed` and stopped there, so the
    // three conjuncts of the predicate — and the `data-state="filtered"`
    // sentence that distinguishes "these filters match nothing" from "there
    // are no automations" — were unmeasured. Deleting any conjunct left the
    // suite green.
    const rows = [
      auto({ id: 1, name: 'armed-ccrc', state: 'armed', project: 'ccrc-pwa', provedAt: 1, nextRunAt: 9e12, lastOutcome: 'ok', lastFireAt: 5 }),
      auto({ id: 2, name: 'paused-other', state: 'paused', project: 'other-proj', lastOutcome: 'failed', lastFireAt: 6 }),
      auto({ id: 3, name: 'never-fired', state: 'paused', project: 'ccrc-pwa', lastOutcome: null, lastFireAt: null }),
    ];
    seedStore({ automations: rows, automationsFrameSeen: true });
    render(<AutomationsScreen loadAutomations={async () => ({ automations: rows })} />);
    await screen.findByRole('button', { name: /armed-ccrc/ });
    const names = (): string[] => screen.getAllByRole('button', { name: /armed-ccrc|paused-other|never-fired/ })
      .map((b) => b.textContent ?? '');
    expect(names().length).toBe(3);

    fireEvent.click(screen.getByRole('button', { name: 'state: armed' }));
    expect(names().length, 'the state conjunct').toBe(1);
    expect(names()[0]).toContain('armed-ccrc');

    fireEvent.click(screen.getByRole('button', { name: 'state: all' }));
    fireEvent.click(screen.getByRole('button', { name: 'last outcome: failed' }));
    expect(names().length, 'the outcome conjunct').toBe(1);
    expect(names()[0]).toContain('paused-other');

    fireEvent.click(screen.getByRole('button', { name: 'last outcome: never-ran' }));
    // `never-ran` reads `lastFireAt`; in practice `lastOutcome` answers the
    // same question, because the claim stamps `running` at open — so this
    // asserts the ARM, not a difference between the two columns.
    expect(names().length, 'the never-ran arm').toBe(1);
    expect(names()[0]).toContain('never-fired');

    fireEvent.click(screen.getByRole('button', { name: 'last outcome: all' }));
    fireEvent.change(screen.getByLabelText(/project/i), { target: { value: 'other-proj' } });
    expect(names().length, 'the project conjunct').toBe(1);
    expect(names()[0]).toContain('paused-other');

    // Two filters that between them match nothing: the sentence must be the
    // FILTERED one, because "No automations yet." is a claim about the fleet
    // and this is a claim about the filters.
    fireEvent.click(screen.getByRole('button', { name: 'state: armed' }));
    const empty = screen.getByText(/No automations match these filters/);
    expect(empty).toHaveAttribute('data-state', 'filtered');
  });
});

describe('the retired chip is a door, not a dead control', () => {
  it('asks the server for retired rows — neither feed of the live list carries them', async () => {
    // The store's DEFAULT filter appends `state != 'retired'`, deliberately
    // (spec §9: "a retired automation leaves the default list"), and BOTH
    // feeds of this screen take that default — the `{type:'automations'}`
    // frame and the param-less cold read. So a chip that filtered
    // client-side could never match a row: it always rendered "No
    // automations match these filters." even when retired automations
    // existed, and since the list row is the only door to `api.automation`
    // (there is no `/automations/:id` route), a retired automation's run
    // history had no way in from the phone at all — against §9's other half,
    // "what did that thing do before I removed it? stays answerable".
    const asked: (string | undefined)[] = [];
    const loadAutomations = async (filter?: { state?: AutomationState }) => {
      asked.push(filter?.state);
      return filter?.state === 'retired'
        ? { automations: [auto({ id: 9, name: 'old-nightly', state: 'retired' })] }
        : { automations: [auto({ id: 1, name: 'nightly' })] };
    };
    seedStore({ automations: [auto({ id: 1, name: 'nightly' })], automationsFrameSeen: true });
    render(<AutomationsScreen loadAutomations={loadAutomations} />);
    await screen.findByRole('button', { name: /nightly/ });

    fireEvent.click(screen.getByRole('button', { name: 'state: retired' }));
    expect(await screen.findByRole('button', { name: /old-nightly/ }),
      'the retired row must be reachable').toBeInTheDocument();
    expect(asked, 'and it must be ASKED for, not filtered out of a list that never had it')
      .toContain('retired');
    // The live list is not replaced by it — going back shows the frame again.
    fireEvent.click(screen.getByRole('button', { name: 'state: all' }));
    expect(await screen.findByRole('button', { name: /nightly/ })).toBeInTheDocument();
  });

  it('a failed retired read does not claim there are none', async () => {
    // The screen refuses to make a positive empty claim when a read fails
    // (its own three-empty-states rule); a chip-scoped read is no different.
    const loadAutomations = async (filter?: { state?: AutomationState }) => {
      if (filter?.state === 'retired') throw new Error('offline');
      return { automations: [auto({ id: 1, name: 'nightly' })] };
    };
    seedStore({ automations: [auto({ id: 1, name: 'nightly' })], automationsFrameSeen: true });
    render(<AutomationsScreen loadAutomations={loadAutomations} />);
    await screen.findByRole('button', { name: /nightly/ });
    fireEvent.click(screen.getByRole('button', { name: 'state: retired' }));
    const p = await screen.findByText(/automations may exist that are not shown/);
    expect(p).toHaveAttribute('data-state', 'error');
  });
});

describe('a panel landing names the row it was fetched for', () => {
  it('re-reads when the panel STARTS showing an unsettled run, not only when the frame moves', async () => {
    // The missed ordering, and it is ordinary rather than exotic: the frame
    // changes BEFORE the cold read lands (so the guard's `showsUnsettledRun`
    // is still false at that instant), the run settles server-side in that
    // gap, and the frame never changes again. With the guard sampled only on
    // a frame change, the panel then says `running` under a header that says
    // `ok` — for ever, which is the exact contradiction the effect exists to
    // prevent.
    let calls = 0;
    let release: ((v: { automation: AutomationSummary; runs: AutomationRunSummary[] }) => void) | null = null;
    const getAutomation = (): Promise<{ automation: AutomationSummary; runs: AutomationRunSummary[] }> => {
      calls++;
      if (calls === 1) return new Promise((resolve) => { release = resolve; });
      return Promise.resolve({ automation: auto({ lastOutcome: 'ok' }), runs: [runRow({ endedAt: 9, outcome: 'ok' })] });
    };
    seedStore({ automations: [auto()], automationsFrameSeen: true });
    render(
      <AutomationsScreen
        loadAutomations={async () => ({ automations: [auto()] })}
        getAutomation={getAutomation}
      />,
    );
    await openRow();
    await waitFor(() => { expect(calls).toBe(1); });

    // The frame moves while the first read is STILL in flight.
    seedStore({ automations: [auto({ lastOutcome: 'ok', lastFireAt: 5_000 })], automationsFrameSeen: true });
    // …and only now does the read land, carrying an unsettled run.
    await act(async () => { release!({ automation: auto(), runs: [runRow()] }); });

    await waitFor(() => {
      expect(calls, 'the panel must re-read once it starts showing an unsettled run').toBeGreaterThanOrEqual(2);
    });
  });

  it('does not write a slow answer for one row into the panel of another', async () => {
    // `detail`/`detailState`/`busy`/`actionError` are single screen-level
    // states handed to whichever row is expanded, and every write to them was
    // unconditional. Two rows are one finger-width apart, so a fetch landing
    // after the operator moved on is ordinary use.
    const slow = auto({ id: 1, name: 'nightly', prompt: 'PROMPT-ONE' });
    const fast = auto({ id: 2, name: 'weekly', prompt: 'PROMPT-TWO' });
    let releaseSlow: ((v: { automation: AutomationSummary; runs: AutomationRunSummary[] }) => void) | null = null;
    const getAutomation = (id: number): Promise<{ automation: AutomationSummary; runs: AutomationRunSummary[] }> => {
      if (id === 1) return new Promise((resolve) => { releaseSlow = resolve; });
      return Promise.resolve({ automation: fast, runs: [] });
    };
    seedStore({ automations: [slow, fast], automationsFrameSeen: true });
    render(
      <AutomationsScreen
        loadAutomations={async () => ({ automations: [slow, fast] })}
        getAutomation={getAutomation}
      />,
    );
    fireEvent.click(await screen.findByRole('button', { name: /nightly/ }));
    await waitFor(() => { expect(releaseSlow).not.toBeNull(); });
    // The operator moves on before the first answer arrives.
    fireEvent.click(await screen.findByRole('button', { name: /weekly/ }));
    await screen.findByText('PROMPT-TWO');

    await act(async () => { releaseSlow!({ automation: slow, runs: [] }); });
    expect(screen.queryByText('PROMPT-ONE'),
      "the collapsed row's answer must not land in the panel now on screen").toBeNull();
    expect(screen.getByText('PROMPT-TWO')).toBeInTheDocument();
  });
});

describe('the run history says WHEN, not "now"', () => {
  it('renders an age for a run that started an hour ago', async () => {
    // `formatReset` is a COUNTDOWN to a FUTURE epoch-seconds instant — its
    // own first branch is `const s = resetAt - nowSec; if (s <= 0) return
    // 'now'`. `run.startedAt` is always in the PAST, so feeding it there made
    // the time column of EVERY row in the history read the literal string
    // `now`, whatever the run's real age. The whole history looked like it had
    // just happened. `formatAge` is the helper for a past instant, and it
    // takes an AGE, so the subtraction has to happen at the call site.
    const startedAt = Date.now() - 3_600_000;
    seedStore({ automations: [auto()], automationsFrameSeen: true });
    render(
      <AutomationsScreen
        loadAutomations={async () => ({ automations: [auto()] })}
        getAutomation={async () => ({
          automation: auto(),
          runs: [runRow({ startedAt, endedAt: startedAt + 1_000, outcome: 'ok' })],
        })}
      />,
    );
    await openRow();
    const when = await waitFor(() => {
      const el = document.querySelector('.auto-run-when');
      expect(el).not.toBeNull();
      return el!;
    });
    expect(when.textContent ?? '', 'an hour-old run must not read "now"').not.toBe('now');
    expect(when.textContent ?? '').toMatch(/ago$/);
  });
});

describe('Run now says what it queued, without claiming what has not happened', () => {
  it('renders a status note on the 202, and states no duration', async () => {
    // `Starting…` lives on the button and is gone in a millisecond once the
    // answer is immediate; the run row then reads `running`, which after the
    // cut-over means CLAIMED, not "a session exists". Without a note the
    // operator is told a session started when none has.
    seedStore({ automations: [auto()], automationsFrameSeen: true });
    render(
      <AutomationsScreen
        loadAutomations={async () => ({ automations: [auto()] })}
        getAutomation={async () => ({ automation: auto(), runs: [] })}
        runAutomation={async () => ({ ok: true, runId: 7 } as never)}
      />,
    );
    await openRow();
    fireEvent.click(await screen.findByRole('button', { name: 'Run now' }));

    const note = await screen.findByRole('status');
    expect(note.textContent ?? '').toMatch(/queued/i);
    // No number, ever. The lag is one AUTOMATION_SWEEP_MS gate plus a tick,
    // both server-side and neither on the wire, so a duration rendered here
    // would be the same drift `single-definition.test.ts` polices — asserted
    // to the operator as a fact about their box.
    expect(note.textContent ?? '').not.toMatch(/[0-9]/);
  });

  it('re-reads the expanded panel when the frame moves, so the row cannot contradict its own header', async () => {
    // The list row is frame-fed and updates itself; the panel's runs come from
    // a one-shot cold read. With an immediate 202 that read lands while the
    // run is still `running`, so without this the panel says `running` for
    // ever while the header of the SAME <li> flips to `ok` — one row, two
    // contradictory claims.
    let calls = 0;
    const getAutomation = async (): Promise<{ automation: AutomationSummary; runs: AutomationRunSummary[] }> => {
      calls++;
      return calls <= 1
        ? { automation: auto(), runs: [runRow()] }
        : { automation: auto({ lastOutcome: 'ok' }), runs: [runRow({ endedAt: 5_000, outcome: 'ok' })] };
    };
    seedStore({ automations: [auto()], automationsFrameSeen: true });
    render(
      <AutomationsScreen
        loadAutomations={async () => ({ automations: [auto()] })}
        getAutomation={getAutomation}
        runAutomation={async () => ({ ok: true, runId: 7 } as never)}
      />,
    );
    await openRow();
    await waitFor(() => { expect(calls).toBeGreaterThanOrEqual(1); });

    // The settle reaches the phone as a new frame — `emitAutomations` emits on
    // any change to the row — and that is the signal the panel listens to.
    seedStore({
      automations: [auto({ lastOutcome: 'ok', lastFireAt: 5_000 })],
      automationsFrameSeen: true,
    });
    await waitFor(() => { expect(calls).toBeGreaterThanOrEqual(2); });
  });
});

// The Models sheet (model-class-advance wave R4; plan 2026-10-15-model-class-auto-advance-codex-arm.md, Task 20 as
// re-planned): each class's model, hold, last move and previous; the advance state in words, all five and the absent key;
// Hold and Release that move a row only on the server's answer; a refusal that leaves the row and says why; an unknown
// outcome that reads the lane again; and a Revert that appears only when it can, and asks first. Neutral lane and model ids
// only: this repository is public.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { LaneAdvanceRead, LaneClassAdvance, LaneModelsRead, ModelClass } from '../../shared/models';
import { ModelsSheet } from '../src/accounts/ModelsSheet';
import { PickSheet } from '../src/session/PickSheet';
import { laneReadWords } from '../src/lib/models';
import { VERB_CODE_WORDS } from '../src/accounts/modelsSheetWords';
import { ApiError } from '../src/lib/apiError';
import { clearScreenCache, laneModelsKey, peek, put } from '../src/lib/screenCache';

afterEach(() => { cleanup(); clearScreenCache(); vi.restoreAllMocks(); });

const MODELS: Record<ModelClass, [string | null, string | null]> = {
  haiku: ['model-6-alpha', 'Alpha 6'], sonnet: ['model-6-beta', 'Beta 6'], opus: ['model-6.1-gamma', 'Gamma 6.1'], fable: [null, null],
};
const classAdv = (over: Partial<LaneClassAdvance> = {}): LaneClassAdvance => ({ family: null, hold: null, previous: null, revertable: false, lastMove: null, ...over });
const OPUS_ADV = classAdv({
  family: 'gamma', previous: { model: 'model-6-gamma', effort: 'high' }, revertable: true,
  lastMove: { at: '2026-11-17T09:00:00Z', how: 'advance', from: 'model-6-gamma', to: 'model-6.1-gamma', ok: true, canary: 'passed' },
});
const okAdvance = (classes: Partial<Record<ModelClass, LaneClassAdvance>> = {}, pending: LaneAdvanceRead['pending'] = null): LaneAdvanceRead => ({
  state: 'ok', detail: null, pending,
  classes: { haiku: classAdv({ family: 'alpha' }), sonnet: classAdv({ family: 'beta' }), opus: OPUS_ADV, fable: classAdv(), ...classes },
});
const read = (advance: LaneAdvanceRead | undefined, labels: Partial<Record<ModelClass, string | null>> = {}): LaneModelsRead => ({
  kind: 'read',
  classes: Object.fromEntries((Object.keys(MODELS) as ModelClass[]).map((c) =>
    [c, { model: MODELS[c][0], label: c in labels ? labels[c] : MODELS[c][1], efforts: null }])) as never,
  ...(advance !== undefined ? { advance } : {}),
});
const wire = (models: LaneModelsRead): unknown => ({ ok: true, lane: 'lane-a', models });
const actAnswer = (action: string, cls: ModelClass, models: LaneModelsRead, over: Record<string, unknown> = {}): unknown =>
  ({ ok: true, lane: 'lane-a', action, class: cls, changed: action === 'revert' ? null : true, partial: false, models, ...over });

function mount(models: LaneModelsRead | 'pending', over: { act?: (lane: string, body: { action: string; class: string }) => Promise<unknown>; offline?: string | null; load?: ReturnType<typeof vi.fn> } = {}) {
  const load = over.load ?? vi.fn(async () => (models === 'pending' ? new Promise<unknown>(() => {}) : wire(models)));
  const doAct = vi.fn(over.act ?? (async () => { throw new Error('no act expected'); }));
  const onClose = vi.fn();
  render(<ModelsSheet lane="lane-a" open onClose={onClose} offline={over.offline ?? null} act={doAct as never} load={load as never} />);
  return { load, act: doAct, onClose };
}
const rowOf = (cls: ModelClass): HTMLElement => screen.getByTestId(`models-class-${cls}`);
const ready = async (): Promise<void> => { await screen.findByTestId('models-class-opus'); };
const deferred = <T,>(): { promise: Promise<T>; resolve: (v: T) => void; reject: (e: unknown) => void } => {
  let resolve!: (v: T) => void; let reject!: (e: unknown) => void;
  const promise = new Promise<T>((a, b) => { resolve = a; reject = b; });
  return { promise, resolve, reject };
};
const alertText = (): string => screen.getByTestId('models-alert').textContent ?? '';
const noteOf = (cls: ModelClass): HTMLElement => screen.getByTestId(`models-note-${cls}`);
const statusText = (): string => screen.getByTestId('models-status').textContent ?? '';

describe('ModelsSheet: what it shows', () => {
  it('shows a skeleton until a read lands', async () => {
    mount('pending');
    expect(await screen.findByRole('status', { name: 'Loading' })).toBeTruthy();
    expect(screen.queryByTestId('models-class-opus')).toBeNull();
  });

  it('shows each class in order with its model and label, an empty class saying so', async () => {
    mount(read(okAdvance()));
    await ready();
    const order = [...document.querySelectorAll('[data-testid^="models-class-"]')].map((e) => e.getAttribute('data-testid'));
    expect(order).toEqual(['models-class-haiku', 'models-class-sonnet', 'models-class-opus', 'models-class-fable']);
    expect(rowOf('opus').textContent).toContain('Gamma 6.1 (model-6.1-gamma)');
    expect(rowOf('fable').textContent).toMatch(/no model/i);
  });

  it('shows the family, the hold (who and when), the last move and what a revert would put back', async () => {
    mount(read(okAdvance({ opus: { ...OPUS_ADV, hold: { at: '2026-11-18T08:00:00Z', by: 'revert' } } })));
    await ready();
    const opus = rowOf('opus').textContent ?? '';
    expect(opus).toContain('gamma');
    expect(opus).toContain('Held by a revert since 2026-11-18 08:00Z');
    expect(opus).toContain('Advanced 2026-11-17 09:00Z: model-6-gamma → model-6.1-gamma');
    expect(opus).toContain('A revert would put back model-6-gamma');
    expect(rowOf('haiku').textContent).toMatch(/not held/i);
    expect(rowOf('haiku').textContent).toMatch(/no move on record/i);
  });

  it('says each of the five advance states, and the absent key apart, unreadable and invalid with their detail', async () => {
    const seen: string[] = [];
    for (const [advance, re] of [
      [okAdvance(), /advance record is read/i],
      [{ state: 'absent', detail: null, pending: null, classes: null }, /no automatic advance is on record/i],
      [{ state: 'unreadable', detail: 'bad bytes', pending: null, classes: null }, /cannot be read: bad bytes/i],
      [{ state: 'invalid', detail: 'odd field', pending: null, classes: null }, /not one this build reads: odd field/i],
      [{ state: 'unreported', detail: null, pending: null, classes: null }, /predates the advance record/i],
      [undefined, /advance record was not read/i],
    ] as [LaneAdvanceRead | undefined, RegExp][]) {
      mount(read(advance));
      await ready();
      const t = screen.getByTestId('models-advance').textContent ?? '';
      expect(t).toMatch(re);
      seen.push(t);
      cleanup(); clearScreenCache();
    }
    expect(new Set(seen).size).toBe(6);
  });

  it('says a pending intent in words', async () => {
    mount(read(okAdvance({}, { how: 'hand', class: 'opus', from: 'model-6-gamma', to: 'model-6.1-gamma', emptied: [], at: '2026-11-18T08:00:00Z' })));
    await ready();
    expect(screen.getByTestId('models-pending').textContent).toMatch(/opus.*pending.*model-6\.1-gamma/i);
  });

  it('an absent or unreadable read says so in words and offers no act', async () => {
    mount({ kind: 'absent' });
    expect(await screen.findByTestId('models-read-state')).toBeTruthy();
    expect(screen.getByTestId('models-read-state').textContent).toMatch(/no class registry/i);
    expect(screen.queryAllByRole('button', { name: /hold|release|revert/i })).toHaveLength(0);
    cleanup(); clearScreenCache();
    mount({ kind: 'unreadable' });
    expect((await screen.findByTestId('models-read-state')).textContent).toMatch(/could not be read/i);
  });

  // R3b: each arm the read can answer instead of the classes reaches the sheet in its own words, with the class names
  // listed and no act offered.
  it.each([
    [{ kind: 'unsupported' }, /does not offer/i],
    [{ kind: 'not-started' }, /did not start/i],
    [{ kind: 'refused', why: 'bad-lane' }, /would not ask/i],
    [{ kind: 'busy' }, /busy.*next read/i],
    [{ kind: 'unreadable' }, /could not be read just now/i],
    [{ kind: 'unreadable', code: 'catalogue-invalid' }, /catalogue is not one the fleet box accepts/i],
    [{ kind: 'unreadable', code: 'roster-absent' }, /no account roster/i],
    [{ kind: 'unreadable', code: 'no-output' }, /printed nothing/i],
  ] as const)('%o says so in words, lists the class names and offers no act', async (models, words) => {
    mount(models as LaneModelsRead);
    const said = await screen.findByTestId('models-read-state');
    expect(said.textContent).toMatch(words);
    expect(said.getAttribute('data-kind')).toBe(models.kind);
    expect(screen.getByTestId('models-name-opus')).toBeTruthy();
    expect(screen.queryAllByRole('button', { name: /hold|release|revert/i })).toHaveLength(0);
  });

  it('the model picker says why it names no model, and says nothing over a read', () => {
    const opts = [{ label: 'Opus class', route: { field: 'class' as const, value: 'opus' }, readback: '', active: false }];
    render(<PickSheet open onClose={() => {}} eyebrow="model" title="Choose a model" options={opts} onPick={() => {}}
      note={laneReadWords({ kind: 'busy' })} />);
    expect(screen.getByTestId('pick-note').textContent).toMatch(/busy.*next read/i);
    cleanup();
    render(<PickSheet open onClose={() => {}} eyebrow="model" title="Choose a model" options={opts} onPick={() => {}} note={null} />);
    expect(screen.queryByTestId('pick-note')).toBeNull();
  });

  it('offline: the sentence shows and every act is stood down', async () => {
    mount(read(okAdvance()), { offline: 'You are offline.' });
    await ready();
    expect(screen.getByText('You are offline.')).toBeTruthy();
    for (const b of screen.getAllByRole('button', { name: /^(hold|release|revert)/i })) expect((b as HTMLButtonElement).disabled).toBe(true);
  });
});

describe('ModelsSheet: which acts a class offers', () => {
  it('Hold only on a class that is not held, Release only on one that is, each named for its class', async () => {
    mount(read(okAdvance({ opus: { ...OPUS_ADV, hold: { at: '2026-11-18T08:00:00Z', by: 'hand' } } })));
    await ready();
    expect(within(rowOf('opus')).queryByRole('button', { name: 'Hold the opus class' })).toBeNull();
    expect(within(rowOf('opus')).getByRole('button', { name: 'Release the opus class' })).toBeTruthy();
    expect(within(rowOf('haiku')).getByRole('button', { name: 'Hold the haiku class' })).toBeTruthy();
    expect(within(rowOf('haiku')).queryByRole('button', { name: /release/i })).toBeNull();
  });

  it('offers a Hold on an absent record (nothing is held) and none where the hold is not known', async () => {
    mount(read({ state: 'absent', detail: null, pending: null, classes: null }));
    await ready();
    expect(screen.getAllByRole('button', { name: /^Hold the/ })).toHaveLength(4);
    cleanup(); clearScreenCache();
    for (const advance of [undefined, { state: 'unreadable', detail: 'x', pending: null, classes: null }, { state: 'unreported', detail: null, pending: null, classes: null }] as (LaneAdvanceRead | undefined)[]) {
      mount(read(advance));
      await ready();
      expect(screen.queryAllByRole('button', { name: /^(Hold|Release|Revert) the/ }), String(advance?.state)).toHaveLength(0);
      cleanup(); clearScreenCache();
    }
  });

  it('Revert shows only on a class whose `revertable` is true', async () => {
    mount(read(okAdvance()));
    await ready();
    expect(screen.getAllByRole('button', { name: /^Revert the/ }).map((b) => b.getAttribute('aria-label'))).toEqual(['Revert the opus class']);
  });
});

describe('ModelsSheet: Hold and Release settle only on the server\'s answer', () => {
  it('Hold: the row does not change before the act resolves, the class\'s controls stand down, then the row shows the ANSWER\'s read', async () => {
    const d = deferred<unknown>();
    // the lane\'s next read, asked for after the act, is held open, so what the row and the cache show is the ANSWER\'s own
    const reread = deferred<unknown>();
    const heldRead = read(okAdvance({ opus: { ...OPUS_ADV, hold: { at: '2026-11-18T10:30:00Z', by: 'hand' } } }), { opus: 'Gamma Plus' });
    let reads = 0;
    const load = vi.fn(() => { reads += 1; return reads === 1 ? Promise.resolve(wire(read(okAdvance()))) : reread.promise; });
    const { act: doAct } = mount(read(okAdvance()), { load, act: () => d.promise });
    await ready();
    fireEvent.click(within(rowOf('opus')).getByRole('button', { name: 'Hold the opus class' }));
    expect(doAct).toHaveBeenCalledWith('lane-a', { action: 'hold', class: 'opus' });
    // before the answer: the row is exactly what it was, and its control is busy and disabled
    expect(rowOf('opus').textContent).toMatch(/not held/i);
    const busy = within(rowOf('opus')).getByRole('button', { name: 'Hold the opus class' }) as HTMLButtonElement;
    expect(busy.disabled).toBe(true);
    expect(busy.getAttribute('aria-busy')).toBe('true');
    // the answer carries a state no guess could produce: a different hold time and a different label
    await act(async () => { d.resolve(actAnswer('hold', 'opus', heldRead)); await d.promise; });
    expect(rowOf('opus').textContent).toContain('Held by hand since 2026-11-18 10:30Z');
    expect(rowOf('opus').textContent).toContain('Gamma Plus');
    expect(within(rowOf('opus')).getByRole('button', { name: 'Release the opus class' })).toBeTruthy();
    expect(statusText()).toMatch(/held the opus class/i);
    // the lane is read again after the act (F1 a), and that read is still in flight
    await waitFor(() => expect(load).toHaveBeenCalledTimes(2));
    // the answer is put in the screen cache for the other surfaces
    // (the hook's own `put` holds the GET's answer, which has no `action`: only the act's answer does)
    expect(peek(laneModelsKey('lane-a'))?.raw).toMatchObject({ action: 'hold', class: 'opus', models: heldRead });
  });

  it('shows the answer\'s read at once, and reads the lane again after EVERY act: the read that lands replaces it (F1 a)', async () => {
    const after = deferred<unknown>();
    let reads = 0;
    const load = vi.fn(() => {
      reads += 1;
      return reads === 1 ? Promise.resolve(wire(read(okAdvance()))) : after.promise;
    });
    mount(read(okAdvance()), {
      load,
      act: async () => actAnswer('hold', 'opus', read(okAdvance({ opus: { ...OPUS_ADV, hold: { at: '2026-11-18T10:30:00Z', by: 'hand' } } }))),
    });
    await ready();
    fireEvent.click(within(rowOf('opus')).getByRole('button', { name: 'Hold the opus class' }));
    await waitFor(() => expect(rowOf('opus').textContent).toContain('Held by hand since 2026-11-18 10:30Z'));
    await waitFor(() => expect(load).toHaveBeenCalledTimes(2)); // the post-act read was asked for
    // while it is in flight the row keeps the answer's read; when it lands (the box moved the hold again) it replaces it
    expect(rowOf('opus').textContent).toContain('2026-11-18 10:30Z');
    await act(async () => { after.resolve(wire(read(okAdvance({ opus: { ...OPUS_ADV, hold: { at: '2026-11-18T12:00:00Z', by: 'hand' } } })))); await after.promise; });
    expect(rowOf('opus').textContent).toContain('Held by hand since 2026-11-18 12:00Z');
    expect(rowOf('opus').textContent).not.toContain('10:30Z');
  });

  it('a read sent BEFORE the act that lands AFTER its 200 does not put the old state back (F6)', async () => {
    const stale = deferred<unknown>();
    const fresher = deferred<unknown>();
    let reads = 0;
    const load = vi.fn(() => { reads += 1; return reads === 1 ? stale.promise : fresher.promise; });
    // the lane is already drawn from the screen cache, so the sheet\'s opening read is still in flight when the act is tapped
    put(laneModelsKey('lane-a'), wire(read(okAdvance())), Date.now());
    mount('pending', {
      load,
      act: async () => actAnswer('hold', 'opus', read(okAdvance({ opus: { ...OPUS_ADV, hold: { at: '2026-11-18T10:30:00Z', by: 'hand' } } }))),
    });
    await ready();
    fireEvent.click(within(rowOf('opus')).getByRole('button', { name: 'Hold the opus class' }));
    await waitFor(() => expect(rowOf('opus').textContent).toContain('Held by hand since 2026-11-18 10:30Z'));
    await act(async () => { stale.resolve(wire(read(okAdvance()))); await stale.promise; }); // the older read lands late: not held
    expect(rowOf('opus').textContent).toContain('Held by hand since 2026-11-18 10:30Z');
    expect(within(rowOf('opus')).getByRole('button', { name: 'Release the opus class' })).toBeTruthy();
    await act(async () => { fresher.resolve(wire(read(okAdvance({ opus: { ...OPUS_ADV, hold: { at: '2026-11-18T10:30:00Z', by: 'hand' } } })))); await fresher.promise; });
    expect(rowOf('opus').textContent).toContain('Held by hand since 2026-11-18 10:30Z');
  });

  it('a read sent BEFORE the act that lands after its 200 but BEFORE the follow-up read is issued is dropped, even when that follow-up read then fails (review 2523 F2)', async () => {
    const opening = deferred<unknown>();
    const answered = deferred<unknown>();
    const held = read(okAdvance({ opus: { ...OPUS_ADV, hold: { at: '2026-11-18T10:30:00Z', by: 'hand' } } }));
    let reads = 0;
    const load = vi.fn(() => {
      reads += 1;
      return reads === 1 ? opening.promise : Promise.reject(new TypeError('Failed to fetch'));
    });
    // drawn from the screen cache, so the opening read is still in flight when Hold is tapped
    put(laneModelsKey('lane-a'), wire(read(okAdvance())), Date.now());
    mount('pending', { load, act: () => answered.promise });
    await ready();
    fireEvent.click(within(rowOf('opus')).getByRole('button', { name: 'Hold the opus class' }));
    // the 200 and the late opening read (not held) in one turn: the read lands after the 200, before any effect has asked again
    await act(async () => {
      answered.resolve(actAnswer('hold', 'opus', held));
      opening.resolve(wire(read(okAdvance())));
      for (let i = 0; i < 5; i += 1) await Promise.resolve();
    });
    // the follow-up read was asked for, and failed
    await waitFor(() => expect(load).toHaveBeenCalledTimes(2));
    await screen.findByTestId('models-read-failed');
    // the row and the cache are still the act's: held, with Release offered
    expect(rowOf('opus').textContent).toContain('Held by hand since 2026-11-18 10:30Z');
    expect(within(rowOf('opus')).getByRole('button', { name: 'Release the opus class' })).toBeTruthy();
    expect(peek(laneModelsKey('lane-a'))?.raw).toMatchObject({ action: 'hold', class: 'opus', models: held });
  });

  it('a sheet closed mid-act still puts the answer in the screen cache, so a reopen shows the post-act state (F6)', async () => {
    const d = deferred<unknown>();
    put(laneModelsKey('lane-a'), wire(read(okAdvance())), Date.now());
    mount('pending', { act: () => d.promise });
    await ready();
    fireEvent.click(within(rowOf('opus')).getByRole('button', { name: 'Hold the opus class' }));
    cleanup(); // the sheet is gone while the act is still with the box
    await act(async () => { d.resolve(actAnswer('hold', 'opus', read(okAdvance({ opus: { ...OPUS_ADV, hold: { at: '2026-11-18T10:30:00Z', by: 'hand' } } })))); await d.promise; });
    expect(peek(laneModelsKey('lane-a'))?.raw).toMatchObject({ action: 'hold', class: 'opus' });
    // a reopen draws it at once, held, before any read lands
    mount('pending');
    await ready();
    expect(rowOf('opus').textContent).toContain('Held by hand since 2026-11-18 10:30Z');
  });

  it('a 200 whose read carries NO advance key (the fleet box fell back to its files) schedules another read, never leaving the acts hidden (F7)', async () => {
    let reads = 0;
    const load = vi.fn(async () => { reads += 1; return wire(read(reads === 1 ? okAdvance() : okAdvance({ opus: { ...OPUS_ADV, hold: { at: '2026-11-18T10:30:00Z', by: 'hand' } } }))); });
    mount(read(okAdvance()), { load, act: async () => actAnswer('hold', 'opus', read(undefined)) });
    await ready();
    fireEvent.click(within(rowOf('opus')).getByRole('button', { name: 'Hold the opus class' }));
    await waitFor(() => expect(load).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(within(rowOf('opus')).getByRole('button', { name: 'Release the opus class' })).toBeTruthy());
  });

  it('a Release that found nothing to do says so', async () => {
    mount(read(okAdvance({ opus: { ...OPUS_ADV, hold: { at: '2026-11-18T08:00:00Z', by: 'hand' } } })), {
      act: async () => actAnswer('release', 'opus', read(okAdvance()), { changed: false }),
    });
    await ready();
    fireEvent.click(screen.getByRole('button', { name: 'Release the opus class' }));
    await waitFor(() => expect(statusText()).toMatch(/was not held/i));
  });

  const REFUSALS: [string, ApiError, RegExp][] = [
    ['not-found', new ApiError(404, { ok: false, error: 'not-found' }), /no lane named lane-a/i],
    ['bad-request', new ApiError(400, { ok: false, error: 'bad-request', why: 'bad-class' }), /four classes/i],
    ['unsupported', new ApiError(501, { ok: false, error: 'unsupported' }), /predates this act/i],
    ['unavailable', new ApiError(503, { ok: false, error: 'unavailable', cause: 'not-started' }), /did not start/i],
    ['busy', new ApiError(409, { ok: false, error: 'busy', cause: 'agent-busy' }), /busy with another models request/i],
    ['unauthenticated', new ApiError(401, { ok: false, error: 'unauthenticated' }), /signed out/i],
  ];
  it.each(REFUSALS)('a refusal in which the verb never ran (%s) says why beside the row and in the ONE alert, and says nothing was changed', async (_name, err, re) => {
    const load = vi.fn(async () => wire(read(okAdvance())));
    mount(read(okAdvance()), { act: async () => { throw err; }, load });
    await ready();
    fireEvent.click(within(rowOf('haiku')).getByRole('button', { name: 'Hold the haiku class' }));
    await waitFor(() => expect(noteOf('haiku')).toBeTruthy());
    expect(noteOf('haiku').textContent).toMatch(re);
    expect(noteOf('haiku').textContent).toMatch(/nothing was changed/i);
    expect(alertText()).toMatch(re);
    // the lane is read again after EVERY act (F1 a); the row is what that read says, and the control is available again
    await waitFor(() => expect(load).toHaveBeenCalledTimes(2));
    expect(rowOf('haiku').textContent).toMatch(/not held/i);
    expect((within(rowOf('haiku')).getByRole('button', { name: 'Hold the haiku class' }) as HTMLButtonElement).disabled).toBe(false);
  });

  it('an exited refusal (lane-act-refused) says its code\'s words, never claims that nothing was changed, and reads the lane again', async () => {
    const load = vi.fn(async () => wire(read(okAdvance())));
    mount(read(okAdvance()), { act: async () => { throw new ApiError(409, { ok: false, error: 'lane-act-refused', verbCode: 'lock-busy' }); }, load });
    await ready();
    fireEvent.click(within(rowOf('haiku')).getByRole('button', { name: 'Hold the haiku class' }));
    await waitFor(() => expect(noteOf('haiku')).toBeTruthy());
    expect(noteOf('haiku').textContent).toBe(VERB_CODE_WORDS['lock-busy']);
    expect(noteOf('haiku').textContent).not.toMatch(/nothing was changed/i);
    await waitFor(() => expect(load).toHaveBeenCalledTimes(2));
  });

  it('an unknown outcome says the act MAY have happened and reads the lane again; the new read replaces the row', async () => {
    let held = false;
    const load = vi.fn(async () => wire(read(okAdvance({ haiku: classAdv({ family: 'alpha', hold: held ? { at: '2026-11-18T09:00:00Z', by: 'hand' } : null }) }))));
    mount(read(okAdvance()), {
      load,
      act: async () => { held = true; throw new ApiError(502, { ok: false, error: 'outcome-unknown', cause: 'timeout' }); },
    });
    await ready();
    fireEvent.click(within(rowOf('haiku')).getByRole('button', { name: 'Hold the haiku class' }));
    await waitFor(() => expect(load).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(rowOf('haiku').textContent).toContain('Held by hand since 2026-11-18 09:00Z'));
    expect(alertText()).toMatch(/may have happened/i);
    expect(alertText()).not.toMatch(/nothing was changed/i);
  });

  it('a 200 this build cannot read is an unknown outcome too: said, and the lane is read again', async () => {
    const load = vi.fn(async () => wire(read(okAdvance())));
    mount(read(okAdvance()), { load, act: async () => ({ ok: true, lane: 'lane-a', models: null }) });
    await ready();
    fireEvent.click(within(rowOf('haiku')).getByRole('button', { name: 'Hold the haiku class' }));
    await waitFor(() => expect(load).toHaveBeenCalledTimes(2));
    expect(alertText()).toMatch(/may have happened/i);
  });

  it('a transport failure with no answer at all is unknown, not a refusal', async () => {
    const load = vi.fn(async () => wire(read(okAdvance())));
    mount(read(okAdvance()), { load, act: async () => { throw new TypeError('Failed to fetch'); } });
    await ready();
    fireEvent.click(within(rowOf('haiku')).getByRole('button', { name: 'Hold the haiku class' }));
    await waitFor(() => expect(load).toHaveBeenCalledTimes(2));
    expect(alertText()).toMatch(/may have happened/i);
  });
});

describe('ModelsSheet: a Revert refused after its hold was written (F1 d)', () => {
  it('the act rejects lane-act-refused, the lane is read again and the class is HELD by the revert: the row shows held, offers Release, and never says nothing was changed', async () => {
    let wrote = false;
    const load = vi.fn(async () => wire(read(okAdvance(wrote ? { opus: { ...OPUS_ADV, hold: { at: '2026-11-18T11:00:00Z', by: 'revert' } } } : {}))));
    mount(read(okAdvance()), {
      load,
      act: async () => { wrote = true; throw new ApiError(409, { ok: false, error: 'lane-act-refused', verbCode: 'registry-unwritable' }); },
    });
    await ready();
    expect(rowOf('opus').textContent).toMatch(/not held/i);
    fireEvent.click(screen.getByRole('button', { name: 'Revert the opus class' }));
    const dialog = await screen.findByRole('dialog', { name: /revert the opus class\?/i });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Put back and hold' }));
    await waitFor(() => expect(rowOf('opus').textContent).toContain('Held by a revert since 2026-11-18 11:00Z'));
    expect(within(rowOf('opus')).getByRole('button', { name: 'Release the opus class' })).toBeTruthy();
    expect(noteOf('opus').textContent).toBe(VERB_CODE_WORDS['registry-unwritable']);
    expect(document.body.textContent).not.toMatch(/nothing was changed/i);
    expect(load).toHaveBeenCalledTimes(2);
  });
});

describe('ModelsSheet: Revert asks first', () => {
  it('Revert opens a confirmation naming what it restores; nothing is sent until it is confirmed', async () => {
    const reverted = read(okAdvance({ opus: classAdv({ hold: { at: '2026-11-18T11:00:00Z', by: 'revert' } }) }));
    let after = false;
    const { act: doAct } = mount(read(okAdvance()), {
      load: vi.fn(async () => wire(after ? reverted : read(okAdvance()))),
      act: async () => { after = true; return actAnswer('revert', 'opus', reverted); },
    });
    await ready();
    fireEvent.click(screen.getByRole('button', { name: 'Revert the opus class' }));
    expect(doAct).not.toHaveBeenCalled();
    const dialog = await screen.findByRole('dialog', { name: /revert the opus class\?/i });
    expect(dialog.textContent).toContain('Put back model-6-gamma and hold opus');
    expect(dialog.textContent).toMatch(/may keep their current model until they are relaunched/i);
    fireEvent.click(within(dialog).getByRole('button', { name: 'Put back and hold' }));
    expect(doAct).toHaveBeenCalledWith('lane-a', { action: 'revert', class: 'opus' });
    await waitFor(() => expect(rowOf('opus').textContent).toContain('Held by a revert since 2026-11-18 11:00Z'));
    expect(screen.queryByRole('button', { name: 'Revert the opus class' })).toBeNull(); // nothing left to revert to
  });

  it('Cancel sends nothing', async () => {
    const { act: doAct } = mount(read(okAdvance()));
    await ready();
    fireEvent.click(screen.getByRole('button', { name: 'Revert the opus class' }));
    const dialog = await screen.findByRole('dialog', { name: /revert the opus class\?/i });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    expect(doAct).not.toHaveBeenCalled();
    await waitFor(() => expect(screen.queryByRole('dialog', { name: /revert the opus class\?/i })).toBeNull());
  });

  it('a partial revert says the move landed but a final write failed', async () => {
    mount(read(okAdvance()), { act: async () => actAnswer('revert', 'opus', read(okAdvance()), { partial: true }) });
    await ready();
    fireEvent.click(screen.getByRole('button', { name: 'Revert the opus class' }));
    const dialog = await screen.findByRole('dialog', { name: /revert the opus class\?/i });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Put back and hold' }));
    await waitFor(() => expect(statusText()).toMatch(/bookkeeping write failed/i));
  });
});

describe('ModelsSheet: one announcement, kinds apart, and where the focus goes (F11)', () => {
  it('a failure is announced ONCE (the shell\'s alert), and the card\'s note is visible text, not a second alert', async () => {
    mount(read(okAdvance()), { act: async () => { throw new ApiError(501, { ok: false, error: 'unsupported' }); } });
    await ready();
    fireEvent.click(within(rowOf('haiku')).getByRole('button', { name: 'Hold the haiku class' }));
    await waitFor(() => expect(noteOf('haiku')).toBeTruthy());
    const loud = screen.queryAllByRole('alert').filter((e) => (e.textContent ?? '') !== '');
    expect(loud).toHaveLength(1);
    expect(loud[0]).toBe(screen.getByTestId('models-alert'));
    expect(noteOf('haiku').getAttribute('role')).toBeNull();
  });

  it('a refusal and a note that the act MAY have run are two kinds, on `data-kind`', async () => {
    const acts = [new ApiError(501, { ok: false, error: 'unsupported' }), new ApiError(502, { ok: false, error: 'outcome-unknown', cause: 'lost' })];
    let i = 0;
    mount(read(okAdvance()), { act: async () => { throw acts[i++]!; } });
    await ready();
    fireEvent.click(within(rowOf('haiku')).getByRole('button', { name: 'Hold the haiku class' }));
    await waitFor(() => expect(noteOf('haiku').getAttribute('data-kind')).toBe('refused'));
    await waitFor(() => expect((within(rowOf('haiku')).getByRole('button', { name: 'Hold the haiku class' }) as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(within(rowOf('haiku')).getByRole('button', { name: 'Hold the haiku class' }));
    await waitFor(() => expect(noteOf('haiku').getAttribute('data-kind')).toBe('unknown'));
  });

  it('after an act settles the focus is on the class\'s card, never the body', async () => {
    mount(read(okAdvance()), { act: async () => actAnswer('hold', 'haiku', read(okAdvance({ haiku: classAdv({ family: 'alpha', hold: { at: '2026-11-18T10:30:00Z', by: 'hand' } }) }))) });
    await ready();
    const tapped = within(rowOf('haiku')).getByRole('button', { name: 'Hold the haiku class' });
    tapped.focus();
    fireEvent.click(tapped);
    await waitFor(() => expect(rowOf('haiku').textContent).toContain('Held by hand'));
    await waitFor(() => expect(document.activeElement).toBe(rowOf('haiku')));
    expect(rowOf('haiku').getAttribute('tabindex')).toBe('-1');
  });

  it('a refused act puts the focus on the card too', async () => {
    mount(read(okAdvance()), { act: async () => { throw new ApiError(409, { ok: false, error: 'busy', cause: 'agent-busy' }); } });
    await ready();
    const tapped = within(rowOf('sonnet')).getByRole('button', { name: 'Hold the sonnet class' });
    tapped.focus();
    fireEvent.click(tapped);
    await waitFor(() => expect(noteOf('sonnet')).toBeTruthy());
    await waitFor(() => expect(document.activeElement).toBe(rowOf('sonnet')));
  });

  it('after a confirmed Revert the focus is on the class\'s card', async () => {
    mount(read(okAdvance()), { act: async () => actAnswer('revert', 'opus', read(okAdvance({ opus: classAdv({ hold: { at: '2026-11-18T11:00:00Z', by: 'revert' } }) }))) });
    await ready();
    const opener = screen.getByRole('button', { name: 'Revert the opus class' });
    opener.focus();
    fireEvent.click(opener);
    const dialog = await screen.findByRole('dialog', { name: /revert the opus class\?/i });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Put back and hold' }));
    await waitFor(() => expect(rowOf('opus').textContent).toContain('Held by a revert'));
    await waitFor(() => expect(document.activeElement).toBe(rowOf('opus')));
  });
});

describe('ModelsSheet: a failed read of the lane is said in words (F12)', () => {
  it.each([
    ['signed out', new ApiError(401, { error: 'unauthenticated' }), 'signed-out', /signed out/i],
    ['a foreign origin, which is not signed out (F9)', new ApiError(403, { ok: false, error: 'foreign-origin' }), 'foreign-origin', /not opened at the console's own address/i],
    ['a lane that left the roster (F9)', new ApiError(404, { ok: false, error: 'not-found' }), 'not-in-roster', /no longer in the fleet's roster/i],
    ['no answer', new TypeError('Failed to fetch'), 'no-answer', /no answer arrived/i],
    ['an answer it cannot read', new ApiError(400, { error: 'Bad Request' }), 'unreadable', /cannot read/i],
  ])('%s: words, the reason class, no skeleton forever, and a Try again that reads once more', async (_n, err, failure, re) => {
    let fail = true;
    const load = vi.fn(async () => { if (fail) throw err; return wire(read(okAdvance())); });
    mount('pending', { load });
    const box = await screen.findByTestId('models-read-failed');
    expect(box.textContent).toMatch(re);
    expect(box.getAttribute('data-failure')).toBe(failure);
    expect(screen.queryByRole('status', { name: 'Loading' })).toBeNull();
    expect(alertText()).toMatch(re); // and said once by the shell
    fail = false;
    fireEvent.click(within(box).getByRole('button', { name: 'Try again' }));
    await ready();
    expect(load).toHaveBeenCalledTimes(2);
    expect(screen.queryByTestId('models-read-failed')).toBeNull();
  });

  it('a 200 the one reader refuses is the unreadable class', async () => {
    mount('pending', { load: vi.fn(async () => ({ ok: true, lane: 'lane-a', models: { kind: 'later' } })) });
    expect((await screen.findByTestId('models-read-failed')).getAttribute('data-failure')).toBe('unreadable');
  });

  it('the unreadable-files read draws the four class names it promises, and no act', async () => {
    mount({ kind: 'unreadable' });
    await screen.findByTestId('models-read-state');
    for (const cls of ['haiku', 'sonnet', 'opus', 'fable'] as const) expect(screen.getByTestId(`models-name-${cls}`).textContent).toMatch(new RegExp(`${cls} class`, 'i'));
    expect(screen.queryAllByRole('button', { name: /^(hold|release|revert)/i })).toHaveLength(0);
  });
});

describe('ModelsSheet: a Revert confirm is re-checked against the CURRENT read (F13)', () => {
  it('a read that lands while the confirm is open and no longer offers the revert closes it, says why in words, and sends nothing', async () => {
    const hold = deferred<unknown>();
    const nothingToRevert = read(okAdvance({ opus: classAdv({ family: 'gamma' }) }));
    let after = false;
    const { act: doAct } = mount(read(okAdvance()), {
      load: vi.fn(async () => wire(after ? nothingToRevert : read(okAdvance()))),
      act: () => { after = true; return hold.promise; },
    });
    await ready();
    fireEvent.click(screen.getByRole('button', { name: 'Revert the opus class' }));
    const dialog = await screen.findByRole('dialog', { name: /revert the opus class\?/i });
    // another act answers while the confirm stands, with a read in which opus has nothing on record to put back
    fireEvent.click(within(rowOf('haiku')).getByRole('button', { name: 'Hold the haiku class', hidden: true }));
    await act(async () => { hold.resolve(actAnswer('hold', 'haiku', nothingToRevert)); await hold.promise; });
    await waitFor(() => expect(screen.queryByRole('dialog', { name: /revert the opus class\?/i })).toBeNull());
    expect(dialog.isConnected).toBe(false);
    expect(alertText()).toMatch(/revert of the opus class was cancelled/i);
    expect(doAct).toHaveBeenCalledTimes(1); // the hold only: the revert was never sent
    expect(document.body.textContent).not.toContain('Put back an empty class');
    expect(screen.queryByRole('button', { name: 'Revert the opus class' })).toBeNull();
  });

  it('a read whose advance record cannot be read also withdraws it, and the sentence covers that state too (review 2523 F9)', async () => {
    const hold = deferred<unknown>();
    const advanceUnreadable = read({ state: 'unreadable', detail: 'bad bytes', pending: null, classes: null });
    let after = false;
    mount(read(okAdvance()), {
      load: vi.fn(async () => wire(after ? advanceUnreadable : read(okAdvance()))),
      act: () => { after = true; return hold.promise; },
    });
    await ready();
    fireEvent.click(screen.getByRole('button', { name: 'Revert the opus class' }));
    await screen.findByRole('dialog', { name: /revert the opus class\?/i });
    fireEvent.click(within(rowOf('haiku')).getByRole('button', { name: 'Hold the haiku class', hidden: true }));
    await act(async () => { hold.resolve(actAnswer('hold', 'haiku', advanceUnreadable)); await hold.promise; });
    await waitFor(() => expect(screen.queryByRole('dialog', { name: /revert the opus class\?/i })).toBeNull());
    expect(alertText()).toMatch(/revert of the opus class was cancelled/i);
    expect(alertText()).toMatch(/advance record could not be read/i);
  });
});

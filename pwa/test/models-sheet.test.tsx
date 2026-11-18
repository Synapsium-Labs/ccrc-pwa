// The Models sheet (model-class-advance wave R4; plan 2026-10-15-model-class-auto-advance-codex-arm.md, Task 20 as
// re-planned): each class's model, hold, last move and previous; the advance state in words, all five and the absent key;
// Hold and Release that move a row only on the server's answer; a refusal that leaves the row and says why; an unknown
// outcome that reads the lane again; and a Revert that appears only when it can, and asks first. Neutral lane and model ids
// only: this repository is public.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { LaneAdvanceRead, LaneClassAdvance, LaneModelsRead, ModelClass } from '../../shared/models';
import { ModelsSheet } from '../src/accounts/ModelsSheet';
import { VERB_CODE_WORDS } from '../src/accounts/modelsSheetWords';
import { ApiError } from '../src/lib/apiError';
import { clearScreenCache, laneModelsKey, peek } from '../src/lib/screenCache';

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
    const { act: doAct } = mount(read(okAdvance()), { act: () => d.promise });
    await ready();
    fireEvent.click(within(rowOf('opus')).getByRole('button', { name: 'Hold the opus class' }));
    expect(doAct).toHaveBeenCalledWith('lane-a', { action: 'hold', class: 'opus' });
    // before the answer: the row is exactly what it was, and its control is busy and disabled
    expect(rowOf('opus').textContent).toMatch(/not held/i);
    const busy = within(rowOf('opus')).getByRole('button', { name: 'Hold the opus class' }) as HTMLButtonElement;
    expect(busy.disabled).toBe(true);
    expect(busy.getAttribute('aria-busy')).toBe('true');
    // the answer carries a state no guess could produce: a different hold time and a different label
    const answer = read(okAdvance({ opus: { ...OPUS_ADV, hold: { at: '2026-11-18T10:30:00Z', by: 'hand' } } }), { opus: 'Gamma Plus' });
    await act(async () => { d.resolve(actAnswer('hold', 'opus', answer)); await d.promise; });
    expect(rowOf('opus').textContent).toContain('Held by hand since 2026-11-18 10:30Z');
    expect(rowOf('opus').textContent).toContain('Gamma Plus');
    expect(within(rowOf('opus')).getByRole('button', { name: 'Release the opus class' })).toBeTruthy();
    expect(statusText()).toMatch(/held the opus class/i);
    // the answer is put in the screen cache for the other surfaces
    // (the hook's own `put` holds the GET's answer, which has no `action`: only the act's answer does)
    expect(peek(laneModelsKey('lane-a'))?.raw).toMatchObject({ action: 'hold', class: 'opus', models: { kind: 'read' } });
  });

  it('keeps the answer\'s read until the hook\'s next landed read replaces it', async () => {
    let reads = 0;
    const load = vi.fn(async () => {
      reads += 1;
      // the second landed read (after the unknown outcome below) holds haiku, which the first act's answer did not
      return wire(read(okAdvance(reads === 1 ? {} : { haiku: classAdv({ family: 'alpha', hold: { at: '2026-11-18T12:00:00Z', by: 'hand' } }) })));
    });
    let n = 0;
    mount(read(okAdvance()), {
      load,
      act: async (_l, body) => {
        n += 1;
        if (n === 1) return actAnswer('hold', 'opus', read(okAdvance({ opus: { ...OPUS_ADV, hold: { at: '2026-11-18T10:30:00Z', by: 'hand' } } })));
        expect(body.class).toBe('sonnet');
        throw new ApiError(502, { ok: false, error: 'outcome-unknown', cause: 'lost' });
      },
    });
    await ready();
    fireEvent.click(within(rowOf('opus')).getByRole('button', { name: 'Hold the opus class' }));
    await waitFor(() => expect(rowOf('opus').textContent).toContain('Held by hand since 2026-11-18 10:30Z'));
    expect(load).toHaveBeenCalledTimes(1); // the answer itself is shown: no second read
    fireEvent.click(within(rowOf('sonnet')).getByRole('button', { name: 'Hold the sonnet class' }));
    await waitFor(() => expect(rowOf('haiku').textContent).toContain('Held by hand since 2026-11-18 12:00Z'));
    expect(rowOf('opus').textContent).not.toContain('2026-11-18 10:30Z'); // the landed read replaced the answer's
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
    ['busy', new ApiError(409, { ok: false, error: 'busy', cause: 'agent-busy' }), /another models change/i],
    ['lane-act-refused', new ApiError(409, { ok: false, error: 'lane-act-refused', verbCode: 'lock-busy' }), new RegExp(VERB_CODE_WORDS['lock-busy']!.slice(0, 30))],
    ['unauthenticated', new ApiError(401, { ok: false, error: 'unauthenticated' }), /signed out/i],
  ];
  it.each(REFUSALS)('a refusal (%s) leaves the row as it was and says why beside it and in the alert', async (_name, err, re) => {
    const load = vi.fn(async () => wire(read(okAdvance())));
    mount(read(okAdvance()), { act: async () => { throw err; }, load });
    await ready();
    fireEvent.click(within(rowOf('haiku')).getByRole('button', { name: 'Hold the haiku class' }));
    await waitFor(() => expect(within(rowOf('haiku')).getByRole('alert')).toBeTruthy());
    expect(within(rowOf('haiku')).getByRole('alert').textContent).toMatch(re);
    expect(within(rowOf('haiku')).getByRole('alert').textContent).toMatch(/nothing was changed/i);
    expect(alertText()).toMatch(re);
    // the row did not move, and the control is available again; a refusal that proves nothing ran asks no re-read
    expect(rowOf('haiku').textContent).toMatch(/not held/i);
    expect((within(rowOf('haiku')).getByRole('button', { name: 'Hold the haiku class' }) as HTMLButtonElement).disabled).toBe(false);
    expect(load).toHaveBeenCalledTimes(1);
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

describe('ModelsSheet: Revert asks first', () => {
  it('Revert opens a confirmation naming what it restores; nothing is sent until it is confirmed', async () => {
    const { act: doAct } = mount(read(okAdvance()), { act: async () => actAnswer('revert', 'opus', read(okAdvance({ opus: classAdv({ hold: { at: '2026-11-18T11:00:00Z', by: 'revert' } }) }))) });
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

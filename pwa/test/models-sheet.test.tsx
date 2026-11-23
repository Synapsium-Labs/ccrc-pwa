// The Models sheet (model-class-advance wave R4; plan 2026-10-15-model-class-auto-advance-codex-arm.md, Task 20 as
// re-planned): each class's model, hold, last move and previous; the advance state in words, all five and the absent key;
// a Revert that moves a row only on the server's answer, appears only where the read proves the fleet box ends a revert's
// hold by itself, and asks first (revert-holds-until-newer, D-8757: no Hold, no Release); a refusal that leaves the row and
// says why; and an unknown outcome that reads the lane again. Neutral lane and model ids only: this repository is public.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { LaneAdvanceRead, LaneClassAdvance, LaneClassModel, LaneModelsRead, ModelClass } from '../../shared/models';
import { ModelsSheet } from '../src/accounts/ModelsSheet';
import { PickSheet } from '../src/session/PickSheet';
import { laneReadWords } from '../src/lib/models';
import { MODELS_REVERT_UNOFFERED, SUPERVISOR_RESIDUAL_WORDS, VERB_CODE_WORDS } from '../src/accounts/modelsSheetWords';
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
// `endsHold`: the read carries the fleet box's proof that it ends a revert's hold by itself (`revertHoldEnds: true`).
const read = (advance: LaneAdvanceRead | undefined, labels: Partial<Record<ModelClass, string | null>> = {}, endsHold = true): LaneModelsRead => ({
  kind: 'read',
  ...(endsHold ? { revertHoldEnds: true as const } : {}),
  classes: Object.fromEntries((Object.keys(MODELS) as ModelClass[]).map((c) =>
    [c, { model: MODELS[c][0], label: c in labels ? labels[c] : MODELS[c][1], efforts: null }])) as never,
  ...(advance !== undefined ? { advance } : {}),
});
const wire = (models: LaneModelsRead): unknown => ({ ok: true, lane: 'lane-a', models });
const actAnswer = (action: string, cls: ModelClass, models: LaneModelsRead, over: Record<string, unknown> = {}): unknown =>
  ({ ok: true, lane: 'lane-a', action, class: cls, changed: null, partial: false, models, ...over });

function mount(models: LaneModelsRead | 'pending', over: { act?: (lane: string, body: { action: string; class: string }) => Promise<unknown>; offline?: string | null; load?: ReturnType<typeof vi.fn>; anthropic?: boolean } = {}) {
  const load = over.load ?? vi.fn(async () => (models === 'pending' ? new Promise<unknown>(() => {}) : wire(models)));
  const doAct = vi.fn(over.act ?? (async () => { throw new Error('no act expected'); }));
  const onClose = vi.fn();
  render(<ModelsSheet lane="lane-a" open onClose={onClose} offline={over.offline ?? null} anthropic={over.anthropic ?? false} act={doAct as never} load={load as never} />);
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
/** Revert one class through its confirm: the control, then the dialog's yes. */
const confirmRevert = async (cls: ModelClass): Promise<void> => {
  fireEvent.click(within(rowOf(cls)).getByRole('button', { name: `Revert the ${cls} class` }));
  const dialog = await screen.findByRole('dialog', { name: new RegExp(`revert the ${cls} class\\?`, 'i') });
  fireEvent.click(within(dialog).getByRole('button', { name: 'Put back and hold' }));
};
/** A hold made by a revert, as the lane's next read shows it. */
const REVERT_HOLD = { at: '2026-11-18T11:00:00Z', by: 'revert' } as const;
const reverted = (over: Partial<LaneClassAdvance> = {}): LaneAdvanceRead => okAdvance({ opus: { ...OPUS_ADV, hold: REVERT_HOLD, ...over } });
const ENDS = 'It ends by itself once a newer model appears; nothing needs doing.';
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
    expect(opus).toContain(`Held by a revert since 2026-11-18 08:00Z. ${ENDS}`);
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
    expect(screen.getByTestId('models-read-state').textContent).toMatch(/did not find this lane's models/i);
    expect(screen.queryAllByRole('button', { name: /hold|release|revert/i })).toHaveLength(0);
    cleanup(); clearScreenCache();
    mount({ kind: 'unreadable' });
    expect((await screen.findByTestId('models-read-state')).textContent).toMatch(/could not be read/i);
  });

  // R3b: each arm the read can answer instead of the classes reaches the sheet in its own words, with the class names
  // listed and no act offered.
  it.each([
    [{ kind: 'unsupported' }, /does not offer/i],
    [{ kind: 'not-started' }, /did not reach the fleet box/i],
    [{ kind: 'refused', why: 'bad-lane' }, /would not ask/i],
    [{ kind: 'busy' }, /busy.*reads the lane again/i],
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

  // R3b fix round 1, F2: a transient newest answer keeps the lane's last good read on the sheet, its word beside it.
  it.each(['busy', 'not-started'] as const)('a %s answer over a good read keeps the classes and says the word beside them', async (kind) => {
    put(laneModelsKey('lane-a'), wire(read(okAdvance())), Date.now());
    mount({ kind });
    await ready();
    const said = await screen.findByTestId('models-read-transient');
    expect(said.getAttribute('data-kind')).toBe(kind);
    expect(said.textContent).toMatch(kind === 'busy' ? /busy.*reads the lane again/i : /did not reach the fleet box.*reads the lane again/i);
    expect(rowOf('opus').textContent).toContain('Gamma 6.1');
    expect(screen.queryByTestId('models-read-state')).toBeNull();
  });

  // Follow-up transient-beside-kept-answer (item 1): a kept answer that names no model, beside a transient word: the sheet
  // says both, the kept answer's words and the transient line, and says "reads again" once, in the transient line.
  describe('a kept answer that names no model, beside a transient word', () => {
    const KEPT: readonly LaneModelsRead[] = [
      { kind: 'unreadable' }, { kind: 'unreadable', code: 'roster-absent' }, { kind: 'unsupported' },
      { kind: 'refused', why: 'bad-lane' }, { kind: 'absent', laneKind: 'never-made' }, { kind: 'absent' },
    ];
    for (const kept of KEPT) {
      for (const word of ['busy', 'not-started'] as const) {
        it(`${JSON.stringify(kept)} beside ${word}`, async () => {
          put(laneModelsKey('lane-a'), wire(kept), Date.now());
          const { load } = mount({ kind: word });
          await waitFor(() => expect(load).toHaveBeenCalled());
          const line = await screen.findByTestId('models-read-transient');
          expect(line.getAttribute('data-kind')).toBe(word);
          expect(line.textContent).toBe(laneReadWords({ kind: word }));
          const state = screen.getByTestId('models-read-state');
          expect(state.getAttribute('data-kind')).toBe(kept.kind);
          expect(state.textContent).toContain(laneReadWords(kept)!);
          expect(state.textContent).not.toMatch(/reads? (the lane )?again/i);
          expect(screen.queryAllByRole('button', { name: /hold|release|revert/i })).toHaveLength(0);
        });
      }
    }

    // An Anthropic lane's absent is by design, as on the picker (F1): its words alone, no transient line.
    it.each(['busy', 'not-started'] as const)('an Anthropic absent beside %s says its own words only', async (word) => {
      put(laneModelsKey('lane-a'), wire({ kind: 'absent', laneKind: 'anthropic' }), Date.now());
      const { load } = mount({ kind: word });
      await waitFor(() => expect(load).toHaveBeenCalled());
      await act(async () => { await Promise.resolve(); });
      expect(screen.getByTestId('models-read-state').textContent).toMatch(/Anthropic lane/);
      expect(screen.queryByTestId('models-read-transient')).toBeNull();
    });
  });

  it('the model picker says why it names no model, and says nothing over a read', () => {
    const opts = [{ label: 'Opus class', route: { field: 'class' as const, value: 'opus' }, readback: '', active: false }];
    render(<PickSheet open onClose={() => {}} eyebrow="model" title="Choose a model" options={opts} onPick={() => {}}
      note={laneReadWords({ kind: 'busy' })} />);
    expect(screen.getByTestId('pick-note').textContent).toMatch(/busy.*reads the lane again/i);
    cleanup();
    render(<PickSheet open onClose={() => {}} eyebrow="model" title="Choose a model" options={opts} onPick={() => {}} note={null} />);
    expect(screen.queryByTestId('pick-note')).toBeNull();
  });

  it('offline: the sentence shows and every act is stood down', async () => {
    mount(read(okAdvance()), { offline: 'You are offline.' });
    await ready();
    expect(screen.getByText('You are offline.')).toBeTruthy();
    const controls = screen.getAllByRole('button', { name: /^Revert the/ });
    expect(controls.length).toBeGreaterThan(0);
    for (const b of controls) expect((b as HTMLButtonElement).disabled).toBe(true);
  });
});


describe('ModelsSheet: which acts a class offers', () => {
  const noHoldOrRelease = (): void => {
    expect(screen.queryAllByRole('button', { name: /hold|release/i, hidden: true }).filter((b) => !/put back and hold/i.test(b.textContent ?? ''))).toHaveLength(0);
    expect(document.body.textContent).not.toMatch(/\bRelease\b/);
  };

  it('no Hold and no Release anywhere, held or not, on a Codex lane', async () => {
    mount(read(okAdvance({ opus: { ...OPUS_ADV, hold: { at: '2026-11-18T08:00:00Z', by: 'hand' } }, haiku: classAdv({ family: 'alpha', hold: REVERT_HOLD }) })));
    await ready();
    noHoldOrRelease();
    cleanup(); clearScreenCache();
    mount(read({ state: 'absent', detail: null, pending: null, classes: null }));
    await ready();
    noHoldOrRelease();
    expect(screen.queryAllByRole('button', { name: /^(Hold|Release|Revert) the/ })).toHaveLength(0);
  });

  it('Revert shows only on a class whose `revertable` is true and that names what to put back, named for its class', async () => {
    mount(read(okAdvance({ sonnet: classAdv({ family: 'beta', revertable: true, previous: null }) })));
    await ready();
    expect(screen.getAllByRole('button', { name: /^Revert the/ }).map((b) => b.getAttribute('aria-label'))).toEqual(['Revert the opus class']);
    expect(within(rowOf('opus')).getByRole('button', { name: 'Revert the opus class' })).toBeTruthy();
  });

  it('a held class may still revert (a hand hold or a revert hold), and the hold stays shown beside it', async () => {
    mount(read(okAdvance({ opus: { ...OPUS_ADV, hold: { at: '2026-11-18T08:00:00Z', by: 'hand' } } })));
    await ready();
    expect(within(rowOf('opus')).getByRole('button', { name: 'Revert the opus class' })).toBeTruthy();
    expect(rowOf('opus').getAttribute('data-held')).toBe('true');
    expect(rowOf('haiku').getAttribute('data-held')).toBe('false');
  });

  it('where the record is absent, unreadable, unreported or not read, no revert is offered', async () => {
    for (const advance of [{ state: 'absent', detail: null, pending: null, classes: null }, undefined, { state: 'unreadable', detail: 'x', pending: null, classes: null }, { state: 'unreported', detail: null, pending: null, classes: null }] as (LaneAdvanceRead | undefined)[]) {
      mount(read(advance));
      await ready();
      expect(screen.queryAllByRole('button', { name: /^(Hold|Release|Revert) the/ }), String(advance?.state)).toHaveLength(0);
      cleanup(); clearScreenCache();
    }
  });

  // revert-holds-until-newer (D-8757): the control is drawn only where the read the sheet shows proves the box ends holds.
  describe('only where the read proves the fleet box ends a revert\'s hold by itself', () => {
    it('a read without `revertHoldEnds` offers no Revert, says why on the lane, and still shows an existing hold with no ending promised', async () => {
      mount(read(okAdvance({ opus: { ...OPUS_ADV, hold: { at: '2026-11-18T08:00:00Z', by: 'hand' } } }), {}, false));
      await ready();
      expect(screen.queryAllByRole('button', { name: /^Revert the/ })).toHaveLength(0);
      expect(screen.getByTestId('models-revert-unoffered').textContent).toBe(MODELS_REVERT_UNOFFERED);
      expect(rowOf('opus').textContent).toContain('Held by hand since 2026-11-18 08:00Z.');
      expect(rowOf('opus').textContent).not.toMatch(/ends by itself/);
      // what a revert would put back is said only on a card that offers one
      expect(rowOf('opus').textContent).not.toMatch(/a revert would put back/i);
      expect(document.body.textContent).not.toMatch(/\bRelease\b/);
    });

    it('with `revertHoldEnds` the Revert is drawn and the lane note is not', async () => {
      mount(read(okAdvance()));
      await ready();
      expect(screen.getAllByRole('button', { name: /^Revert the/ })).toHaveLength(1);
      expect(screen.queryByTestId('models-revert-unoffered')).toBeNull();
    });

    it('the note is said only where the read is good AND the advance record is read: not beside an unread record, nor over a non-read arm', async () => {
      for (const advance of [undefined, { state: 'absent', detail: null, pending: null, classes: null }, { state: 'unreadable', detail: 'x', pending: null, classes: null }, { state: 'unreported', detail: null, pending: null, classes: null }] as (LaneAdvanceRead | undefined)[]) {
        mount(read(advance, {}, false));
        await ready();
        expect(screen.queryByTestId('models-revert-unoffered'), String(advance?.state)).toBeNull();
        cleanup(); clearScreenCache();
      }
      mount({ kind: 'unreadable' });
      await screen.findByTestId('models-read-state');
      expect(screen.queryByTestId('models-revert-unoffered')).toBeNull();
    });

    it('a hold made by hand and one made by a revert read differently in their first sentence only', async () => {
      mount(read(okAdvance({ opus: { ...OPUS_ADV, hold: { at: '2026-11-18T08:00:00Z', by: 'hand' } }, haiku: classAdv({ family: 'alpha', hold: { at: '2026-11-18T08:00:00Z', by: 'revert' } }) })));
      await ready();
      const sentence = (cls: ModelClass): string[] => (rowOf(cls).textContent ?? '').match(/Held by [^.]*\. It ends by itself once a newer model appears; nothing needs doing\./)![0].split('. ');
      const [handFirst, ...handRest] = sentence('opus');
      const [revertFirst, ...revertRest] = sentence('haiku');
      expect(handFirst).toBe('Held by hand since 2026-11-18 08:00Z');
      expect(revertFirst).toBe('Held by a revert since 2026-11-18 08:00Z');
      expect(handRest).toEqual(revertRest);
    });

    it('a read that proves the box ends holds on an Anthropic lane offers the same Revert', async () => {
      mount(read(okAdvance()), { anthropic: true });
      await ready();
      expect(screen.getAllByRole('button', { name: /^Revert the/ })).toHaveLength(1);
    });
  });
});

describe('ModelsSheet: a Revert settles only on the server\'s answer', () => {
  it('the row does not change before the act resolves, its control stands down, the body is exactly {action, class}, then the row shows the ANSWER\'s read', async () => {
    const d = deferred<unknown>();
    // the lane's next read, asked for after the act, is held open, so what the row and the cache show is the ANSWER's own
    const reread = deferred<unknown>();
    const after = read(reverted({ previous: null, revertable: false }), { opus: 'Gamma Plus' });
    let reads = 0;
    const load = vi.fn(() => { reads += 1; return reads === 1 ? Promise.resolve(wire(read(okAdvance()))) : reread.promise; });
    const { act: doAct } = mount(read(okAdvance()), { load, act: () => d.promise });
    await ready();
    await confirmRevert('opus');
    expect(doAct).toHaveBeenCalledWith('lane-a', { action: 'revert', class: 'opus' });
    expect(Object.keys(doAct.mock.calls[0]![1] as object).sort()).toEqual(['action', 'class']);
    // before the answer: the row is exactly what it was, and its control is busy and disabled
    expect(rowOf('opus').textContent).toMatch(/not held/i);
    const busy = within(rowOf('opus')).getByRole('button', { name: 'Revert the opus class', hidden: true }) as HTMLButtonElement;
    expect(busy.disabled).toBe(true);
    expect(busy.getAttribute('aria-busy')).toBe('true');
    // the answer carries a state no guess could produce: a hold time and a different label
    await act(async () => { d.resolve(actAnswer('revert', 'opus', after)); await d.promise; });
    expect(rowOf('opus').textContent).toContain(`Held by a revert since 2026-11-18 11:00Z. ${ENDS}`);
    expect(rowOf('opus').textContent).toContain('Gamma Plus');
    expect(statusText()).toBe('Reverted the opus class and held it. The hold ends by itself once a newer model appears.');
    // the lane is read again after the act (F1 a), and that read is still in flight
    await waitFor(() => expect(load).toHaveBeenCalledTimes(2));
    // the answer is put in the screen cache for the other surfaces
    // (the hook's own `put` holds the GET's answer, which has no `action`: only the act's answer does)
    expect(peek(laneModelsKey('lane-a'))?.raw).toMatchObject({ action: 'revert', class: 'opus', models: after });
  });

  it('shows the answer\'s read at once, and reads the lane again after EVERY act: the read that lands replaces it (F1 a)', async () => {
    const after = deferred<unknown>();
    let reads = 0;
    const load = vi.fn(() => {
      reads += 1;
      return reads === 1 ? Promise.resolve(wire(read(okAdvance()))) : after.promise;
    });
    mount(read(okAdvance()), { load, act: async () => actAnswer('revert', 'opus', read(reverted())) });
    await ready();
    await confirmRevert('opus');
    await waitFor(() => expect(rowOf('opus').textContent).toContain('Held by a revert since 2026-11-18 11:00Z'));
    await waitFor(() => expect(load).toHaveBeenCalledTimes(2)); // the post-act read was asked for
    // while it is in flight the row keeps the answer's read; when it lands (the box moved the hold again) it replaces it
    expect(rowOf('opus').textContent).toContain('2026-11-18 11:00Z');
    await act(async () => { after.resolve(wire(read(reverted({ hold: { at: '2026-11-18T12:00:00Z', by: 'revert' } })))); await after.promise; });
    expect(rowOf('opus').textContent).toContain('Held by a revert since 2026-11-18 12:00Z');
    expect(rowOf('opus').textContent).not.toContain('11:00Z');
  });

  it('a read sent BEFORE the act that lands AFTER its 200 does not put the old state back (F6)', async () => {
    const stale = deferred<unknown>();
    const fresher = deferred<unknown>();
    let reads = 0;
    const load = vi.fn(() => { reads += 1; return reads === 1 ? stale.promise : fresher.promise; });
    // the lane is already drawn from the screen cache, so the sheet's opening read is still in flight when the act is tapped
    put(laneModelsKey('lane-a'), wire(read(okAdvance())), Date.now());
    mount('pending', { load, act: async () => actAnswer('revert', 'opus', read(reverted())) });
    await ready();
    await confirmRevert('opus');
    await waitFor(() => expect(rowOf('opus').textContent).toContain('Held by a revert since 2026-11-18 11:00Z'));
    await act(async () => { stale.resolve(wire(read(okAdvance()))); await stale.promise; }); // the older read lands late: not held
    expect(rowOf('opus').textContent).toContain('Held by a revert since 2026-11-18 11:00Z');
    await act(async () => { fresher.resolve(wire(read(reverted()))); await fresher.promise; });
    expect(rowOf('opus').textContent).toContain('Held by a revert since 2026-11-18 11:00Z');
  });

  it('a read sent BEFORE the act that lands after its 200 but BEFORE the follow-up read is issued is dropped, even when that follow-up read then fails (review 2523 F2)', async () => {
    const opening = deferred<unknown>();
    const answered = deferred<unknown>();
    const held = read(reverted());
    let reads = 0;
    const load = vi.fn(() => {
      reads += 1;
      return reads === 1 ? opening.promise : Promise.reject(new TypeError('Failed to fetch'));
    });
    // drawn from the screen cache, so the opening read is still in flight when Revert is confirmed
    put(laneModelsKey('lane-a'), wire(read(okAdvance())), Date.now());
    mount('pending', { load, act: () => answered.promise });
    await ready();
    await confirmRevert('opus');
    // the 200 and the late opening read (not held) in one turn: the read lands after the 200, before any effect has asked again
    await act(async () => {
      answered.resolve(actAnswer('revert', 'opus', held));
      opening.resolve(wire(read(okAdvance())));
      for (let i = 0; i < 5; i += 1) await Promise.resolve();
    });
    // the follow-up read was asked for, and failed
    await waitFor(() => expect(load).toHaveBeenCalledTimes(2));
    await screen.findByTestId('models-read-failed');
    // the row and the cache are still the act's: held by the revert
    expect(rowOf('opus').textContent).toContain('Held by a revert since 2026-11-18 11:00Z');
    expect(peek(laneModelsKey('lane-a'))?.raw).toMatchObject({ action: 'revert', class: 'opus', models: held });
  });

  it('a sheet closed mid-act still puts the answer in the screen cache, so a reopen shows the post-act state (F6)', async () => {
    const d = deferred<unknown>();
    put(laneModelsKey('lane-a'), wire(read(okAdvance())), Date.now());
    mount('pending', { act: () => d.promise });
    await ready();
    await confirmRevert('opus');
    cleanup(); // the sheet is gone while the act is still with the box
    await act(async () => { d.resolve(actAnswer('revert', 'opus', read(reverted()))); await d.promise; });
    expect(peek(laneModelsKey('lane-a'))?.raw).toMatchObject({ action: 'revert', class: 'opus' });
    // a reopen draws it at once, held, before any read lands
    mount('pending');
    await ready();
    expect(rowOf('opus').textContent).toContain('Held by a revert since 2026-11-18 11:00Z');
  });

  // fix round 2, N4 and N5: a 200 whose read is transient says nothing ran after the act, so the lane's cache entry, which
  // predates the act, goes: another surface then reads the lane fresh rather than seed from it.
  it.each(['busy', 'not-started'] as const)('a 200 whose read is %s drops the lane\'s cache entry, and writes no transient one', async (kind) => {
    let reads = 0;
    const load = vi.fn(() => { reads += 1; return reads === 1 ? Promise.resolve(wire(read(okAdvance()))) : new Promise<unknown>(() => {}); });
    mount(read(okAdvance()), { load, act: async () => actAnswer('revert', 'opus', { kind }) });
    await ready();
    expect(peek(laneModelsKey('lane-a'))?.raw, 'the pre-act read is cached').toBeTruthy();
    await confirmRevert('opus');
    await waitFor(() => expect(load).toHaveBeenCalledTimes(2));
    expect(peek(laneModelsKey('lane-a'))).toBeUndefined();
  });

  it('a 200 whose read carries NO advance key (the fleet box fell back to its files) schedules another read, never leaving the row stale (F7)', async () => {
    let reads = 0;
    const load = vi.fn(async () => { reads += 1; return wire(read(reads === 1 ? okAdvance() : reverted())); });
    mount(read(okAdvance()), { load, act: async () => actAnswer('revert', 'opus', read(undefined)) });
    await ready();
    await confirmRevert('opus');
    await waitFor(() => expect(load).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(rowOf('opus').textContent).toContain('Held by a revert since 2026-11-18 11:00Z'));
  });

  it('a partial revert says the move landed but a final write failed, and that the hold ends by itself', async () => {
    mount(read(okAdvance()), { act: async () => actAnswer('revert', 'opus', read(okAdvance()), { partial: true }) });
    await ready();
    await confirmRevert('opus');
    await waitFor(() => expect(statusText()).toMatch(/bookkeeping write failed/i));
    expect(statusText()).toMatch(/The hold ends by itself once a newer model appears\.$/);
  });

  const REFUSALS: [string, ApiError, RegExp][] = [
    ['not-found', new ApiError(404, { ok: false, error: 'not-found' }), /no lane named lane-a/i],
    ['bad-request', new ApiError(400, { ok: false, error: 'bad-request', why: 'bad-class' }), /four classes/i],
    ['bad-action', new ApiError(400, { ok: false, error: 'bad-request', why: 'bad-action' }), /not revert/i],
    ['unsupported', new ApiError(501, { ok: false, error: 'unsupported' }), /predates this act/i],
    ['unsupported, revert-hold-ends', new ApiError(501, { ok: false, error: 'unsupported', cause: 'revert-hold-ends' }), /does not end a revert's hold by itself, so the revert was not sent/i],
    ['unavailable', new ApiError(503, { ok: false, error: 'unavailable', cause: 'not-started' }), /did not start/i],
    ['unavailable, lane-unreadable', new ApiError(503, { ok: false, error: 'unavailable', cause: 'lane-unreadable' }), /could not be read just before the revert, so it was not sent/i],
    ['unavailable, lane-absent', new ApiError(503, { ok: false, error: 'unavailable', cause: 'lane-absent' }), /no model record for this lane, so the revert was not sent/i],
    ['busy', new ApiError(409, { ok: false, error: 'busy', cause: 'agent-busy' }), /busy with another models request/i],
    ['unauthenticated', new ApiError(401, { ok: false, error: 'unauthenticated' }), /signed out/i],
  ];
  it.each(REFUSALS)('a refusal in which the verb never ran (%s) says why beside the row and in the ONE alert, and says nothing was changed', async (_name, err, re) => {
    const load = vi.fn(async () => wire(read(okAdvance())));
    mount(read(okAdvance()), { act: async () => { throw err; }, load });
    await ready();
    await confirmRevert('opus');
    await waitFor(() => expect(noteOf('opus')).toBeTruthy());
    expect(noteOf('opus').textContent).toMatch(re);
    expect(noteOf('opus').textContent).toMatch(/nothing was changed/i);
    expect(alertText()).toMatch(re);
    // the lane is read again after EVERY act (F1 a); the row is what that read says, and the control is available again
    await waitFor(() => expect(load).toHaveBeenCalledTimes(2));
    expect(rowOf('opus').textContent).toMatch(/not held/i);
    expect((within(rowOf('opus')).getByRole('button', { name: 'Revert the opus class' }) as HTMLButtonElement).disabled).toBe(false);
  });

  it('an exited refusal (lane-act-refused) says its code\'s words, never claims that nothing was changed, and reads the lane again', async () => {
    const load = vi.fn(async () => wire(read(okAdvance())));
    mount(read(okAdvance()), { act: async () => { throw new ApiError(409, { ok: false, error: 'lane-act-refused', verbCode: 'lock-busy' }); }, load });
    await ready();
    await confirmRevert('opus');
    await waitFor(() => expect(noteOf('opus')).toBeTruthy());
    expect(noteOf('opus').textContent).toBe(VERB_CODE_WORDS['lock-busy']);
    expect(noteOf('opus').textContent).not.toMatch(/nothing was changed/i);
    await waitFor(() => expect(load).toHaveBeenCalledTimes(2));
  });

  it('an unknown outcome says the act MAY have happened and reads the lane again; the new read replaces the row', async () => {
    let wrote = false;
    const load = vi.fn(async () => wire(read(wrote ? reverted() : okAdvance())));
    mount(read(okAdvance()), {
      load,
      act: async () => { wrote = true; throw new ApiError(502, { ok: false, error: 'outcome-unknown', cause: 'timeout' }); },
    });
    await ready();
    await confirmRevert('opus');
    await waitFor(() => expect(load).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(rowOf('opus').textContent).toContain('Held by a revert since 2026-11-18 11:00Z'));
    expect(alertText()).toMatch(/may have happened/i);
    expect(alertText()).not.toMatch(/nothing was changed/i);
  });

  it('a 200 this build cannot read is an unknown outcome too: said, and the lane is read again', async () => {
    const load = vi.fn(async () => wire(read(okAdvance())));
    mount(read(okAdvance()), { load, act: async () => ({ ok: true, lane: 'lane-a', models: null }) });
    await ready();
    await confirmRevert('opus');
    await waitFor(() => expect(load).toHaveBeenCalledTimes(2));
    expect(alertText()).toMatch(/may have happened/i);
  });

  it('a 200 answering a hold or a release (this sheet never asks one) is off the grammar: unknown, and the lane is read again', async () => {
    const load = vi.fn(async () => wire(read(okAdvance())));
    mount(read(okAdvance()), { load, act: async () => actAnswer('hold', 'opus', read(okAdvance()), { changed: true }) });
    await ready();
    await confirmRevert('opus');
    await waitFor(() => expect(load).toHaveBeenCalledTimes(2));
    expect(alertText()).toMatch(/may have happened/i);
  });

  it('a transport failure with no answer at all is unknown, not a refusal', async () => {
    const load = vi.fn(async () => wire(read(okAdvance())));
    mount(read(okAdvance()), { load, act: async () => { throw new TypeError('Failed to fetch'); } });
    await ready();
    await confirmRevert('opus');
    await waitFor(() => expect(load).toHaveBeenCalledTimes(2));
    expect(alertText()).toMatch(/may have happened/i);
  });
});

describe('ModelsSheet: a Revert refused after its hold was written (F1 d)', () => {
  it('the act rejects lane-act-refused, the lane is read again and the class is HELD by the revert: the row shows held, offers no Release, and never says nothing was changed', async () => {
    let wrote = false;
    const load = vi.fn(async () => wire(read(okAdvance(wrote ? { opus: { ...OPUS_ADV, hold: REVERT_HOLD } } : {}))));
    mount(read(okAdvance()), {
      load,
      act: async () => { wrote = true; throw new ApiError(409, { ok: false, error: 'lane-act-refused', verbCode: 'registry-unwritable' }); },
    });
    await ready();
    expect(rowOf('opus').textContent).toMatch(/not held/i);
    await confirmRevert('opus');
    await waitFor(() => expect(rowOf('opus').textContent).toContain(`Held by a revert since 2026-11-18 11:00Z. ${ENDS}`));
    expect(screen.queryByRole('button', { name: /release/i })).toBeNull();
    expect(noteOf('opus').textContent).toBe(VERB_CODE_WORDS['registry-unwritable']);
    expect(document.body.textContent).not.toMatch(/nothing was changed/i);
    expect(load).toHaveBeenCalledTimes(2);
  });
});

describe('ModelsSheet: Revert asks first', () => {
  it('Revert opens a confirmation naming what it restores and that the hold ends by itself; nothing is sent until it is confirmed', async () => {
    const after = read(okAdvance({ opus: classAdv({ hold: REVERT_HOLD }) }));
    let done = false;
    const { act: doAct } = mount(read(okAdvance()), {
      load: vi.fn(async () => wire(done ? after : read(okAdvance()))),
      act: async () => { done = true; return actAnswer('revert', 'opus', after); },
    });
    await ready();
    fireEvent.click(screen.getByRole('button', { name: 'Revert the opus class' }));
    expect(doAct).not.toHaveBeenCalled();
    const dialog = await screen.findByRole('dialog', { name: /revert the opus class\?/i });
    expect(dialog.textContent).toContain('Put back model-6-gamma and hold opus on lane-a.');
    expect(dialog.textContent).toContain('The hold ends by itself once a newer model appears, so nothing needs doing to lift it.');
    expect(dialog.textContent).toContain('As last read, that replaces model-6.1-gamma.');
    expect(dialog.textContent).toMatch(/may keep their current model until they are relaunched/i);
    expect(dialog.textContent).not.toMatch(/release/i);
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
});

describe('ModelsSheet: one announcement, kinds apart, and where the focus goes (F11)', () => {
  // a second revertable class, so a refusal and a note that the act MAY have run can each land on a class of its own
  const TWO = (): LaneAdvanceRead => okAdvance({ sonnet: classAdv({ family: 'beta', previous: { model: 'model-5-beta', effort: null }, revertable: true }) });

  it('a failure is announced ONCE (the shell\'s alert), and the card\'s note is visible text, not a second alert', async () => {
    mount(read(TWO()), { act: async () => { throw new ApiError(501, { ok: false, error: 'unsupported' }); } });
    await ready();
    await confirmRevert('sonnet');
    await waitFor(() => expect(noteOf('sonnet')).toBeTruthy());
    const loud = screen.queryAllByRole('alert').filter((e) => (e.textContent ?? '') !== '');
    expect(loud).toHaveLength(1);
    expect(loud[0]).toBe(screen.getByTestId('models-alert'));
    expect(noteOf('sonnet').getAttribute('role')).toBeNull();
  });

  it('a refusal and a note that the act MAY have run are two kinds, on `data-kind`', async () => {
    const acts = [new ApiError(501, { ok: false, error: 'unsupported' }), new ApiError(502, { ok: false, error: 'outcome-unknown', cause: 'lost' })];
    let i = 0;
    mount(read(TWO()), { act: async () => { throw acts[i++]!; } });
    await ready();
    await confirmRevert('sonnet');
    await waitFor(() => expect(noteOf('sonnet').getAttribute('data-kind')).toBe('refused'));
    await waitFor(() => expect((within(rowOf('sonnet')).getByRole('button', { name: 'Revert the sonnet class' }) as HTMLButtonElement).disabled).toBe(false));
    await confirmRevert('opus');
    await waitFor(() => expect(noteOf('opus').getAttribute('data-kind')).toBe('unknown'));
  });

  it('a refused act puts the focus on the card', async () => {
    mount(read(TWO()), { act: async () => { throw new ApiError(409, { ok: false, error: 'busy', cause: 'agent-busy' }); } });
    await ready();
    within(rowOf('sonnet')).getByRole('button', { name: 'Revert the sonnet class' }).focus();
    await confirmRevert('sonnet');
    await waitFor(() => expect(noteOf('sonnet')).toBeTruthy());
    await waitFor(() => expect(document.activeElement).toBe(rowOf('sonnet')));
    expect(rowOf('sonnet').getAttribute('tabindex')).toBe('-1');
  });

  it('after a confirmed Revert the focus is on the class\'s card, never the body', async () => {
    mount(read(okAdvance()), { act: async () => actAnswer('revert', 'opus', read(okAdvance({ opus: classAdv({ hold: REVERT_HOLD }) }))) });
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
  // The lane is drawn from the screen cache, so the sheet's opening read is still in flight while the confirm stands, and the
  // read that lands then is the one the confirm is re-checked on.
  const withdrawnBy = async (landing: LaneModelsRead): Promise<{ doAct: ReturnType<typeof mount>['act'] }> => {
    const opening = deferred<unknown>();
    put(laneModelsKey('lane-a'), wire(read(okAdvance())), Date.now());
    const { act: doAct } = mount('pending', { load: vi.fn(() => opening.promise) });
    await ready();
    fireEvent.click(screen.getByRole('button', { name: 'Revert the opus class' }));
    const dialog = await screen.findByRole('dialog', { name: /revert the opus class\?/i });
    await act(async () => { opening.resolve(wire(landing)); await opening.promise; });
    await waitFor(() => expect(screen.queryByRole('dialog', { name: /revert the opus class\?/i })).toBeNull());
    expect(dialog.isConnected).toBe(false);
    expect(alertText()).toMatch(/revert of the opus class was cancelled/i);
    expect(doAct).not.toHaveBeenCalled(); // the revert was never sent
    expect(document.body.textContent).not.toContain('Put back an empty class');
    return { doAct };
  };

  it('a read that lands while the confirm is open and no longer offers the revert closes it, says why in words, and sends nothing', async () => {
    await withdrawnBy(read(okAdvance({ opus: classAdv({ family: 'gamma' }) })));
    expect(screen.queryByRole('button', { name: 'Revert the opus class' })).toBeNull();
  });

  it('a read whose advance record cannot be read also withdraws it, and the sentence covers that state too (review 2523 F9)', async () => {
    await withdrawnBy(read({ state: 'unreadable', detail: 'bad bytes', pending: null, classes: null }));
    expect(alertText()).toMatch(/advance record could not be read/i);
  });

  it('a read that no longer proves the fleet box ends holds withdraws it too (an older build answered), and the control goes', async () => {
    await withdrawnBy(read(okAdvance(), {}, false));
    expect(screen.queryByRole('button', { name: 'Revert the opus class' })).toBeNull();
    expect(screen.getByTestId('models-revert-unoffered')).toBeTruthy();
  });
});

// ── an Anthropic lane (wave 9, Task A4.3; D-8744, D-8746, D-8820; revert-holds-until-newer, D-8757) ──
// Invented ids and builds only. The sheet is told the lane is Anthropic by the screen (the roster's telemetry), never by
// guessing from a read. Its Revert rule is the Codex lane's: where the read proves the fleet box ends holds.
describe('ModelsSheet: an Anthropic lane', () => {
  type Over = Partial<Record<ModelClass, Partial<LaneClassModel>>>;
  const ANTH: Record<ModelClass, LaneClassModel> = {
    haiku: { model: 'claude-haiku-9-1', label: 'Haiku 9.1', efforts: null },
    sonnet: { model: 'claude-sonnet-9-1', label: 'Sonnet 9.1', efforts: null },
    opus: { model: 'claude-opus-9-1', label: 'Opus 9.1', efforts: null },
    fable: { model: 'claude-fable-9-1', label: 'Fable 9.1', efforts: null },
  };
  const aclass = (family: string, over: Partial<LaneClassAdvance> = {}): LaneClassAdvance => classAdv({ family, ...over });
  const HELD = { at: '2026-11-18T08:00:00Z', by: 'hand', model: 'claude-opus-9-1' } as const;
  const aadvance = (classes: Partial<Record<ModelClass, LaneClassAdvance>> = {}): LaneAdvanceRead => ({
    state: 'ok', detail: null, pending: null,
    classes: { haiku: aclass('haiku'), sonnet: aclass('sonnet'), opus: aclass('opus'), fable: aclass('fable'), ...classes },
  });
  const aread = (over: Over = {}, advance: LaneAdvanceRead = aadvance(), endsHold = true): LaneModelsRead => ({
    kind: 'read',
    ...(endsHold ? { revertHoldEnds: true as const } : {}),
    classes: Object.fromEntries((Object.keys(ANTH) as ModelClass[]).map((c) => [c, { ...ANTH[c], ...over[c] }])) as never,
    advance,
  });
  const facts = (cls: ModelClass): string[] =>
    [...rowOf(cls).querySelectorAll('[data-fact]')].map((e) => e.getAttribute('data-fact') as string);
  const fact = (cls: ModelClass, kind: string): string | null => rowOf(cls).querySelector(`[data-fact="${kind}"]`)?.textContent ?? null;

  it('an Anthropic class shows where its id came from', async () => {
    mount(aread({ opus: { source: 'cache' }, sonnet: { source: 'use' } }), { anthropic: true });
    await ready();
    expect(rowOf('opus').textContent).toContain('Opus 9.1 (claude-opus-9-1)');
    expect(fact('opus', 'source')).toMatch(/from Claude Code's catalogue/);
    expect(fact('sonnet', 'source')).toMatch(/seen at a launch/);
    expect(facts('haiku')).toEqual([]);
  });

  it('both ids show when the catalogue and a launch disagree', async () => {
    mount(aread({ opus: { source: 'use', cacheTarget: 'claude-opus-9-1', seenId: 'claude-opus-9-2' }, sonnet: { cacheTarget: 'claude-sonnet-9-1', seenId: 'claude-sonnet-9-1' } }), { anthropic: true });
    await ready();
    expect(fact('opus', 'disagree')).toContain('claude-opus-9-1');
    expect(fact('opus', 'disagree')).toContain('claude-opus-9-2');
    expect(fact('sonnet', 'disagree')).toBeNull();
  });

  it('a held Anthropic class shows the held id and the alias\'s id', async () => {
    // held on 9-1 while the alias moved to 9-2; the card's own model is the held id, as the wire sends it
    mount(aread({ opus: { aliasId: 'claude-opus-9-2' } }, aadvance({ opus: aclass('opus', { hold: HELD }) })), { anthropic: true });
    await ready();
    expect(fact('opus', 'held')).toBe('Held at claude-opus-9-1.');
    expect(fact('opus', 'alias')).toContain('claude-opus-9-2');
    expect(fact('haiku', 'held')).toBeNull();
  });

  it('the held id is the advance file\'s, not the card\'s model', async () => {
    mount(aread({ opus: { model: 'claude-opus-9-3', aliasId: 'claude-opus-9-2' } }, aadvance({ opus: aclass('opus', { hold: HELD }) })), { anthropic: true });
    await ready();
    expect(fact('opus', 'held')).toBe('Held at claude-opus-9-1.');
  });

  it('a hold on the alias\'s own id shows no second id', async () => {
    mount(aread({ opus: { aliasId: 'claude-opus-9-1' } }, aadvance({ opus: aclass('opus', { hold: HELD }) })), { anthropic: true });
    await ready();
    expect(fact('opus', 'alias')).toBeNull();
  });

  it('a revertable held Anthropic class offers Revert where the read proves holds end, with its hold facts, hold sentence and previous kept', async () => {
    mount(aread({}, aadvance({ opus: aclass('opus', { hold: HELD, revertable: true, previous: { model: 'claude-opus-9-0', effort: null } }) })), { anthropic: true });
    await ready();
    expect(screen.getAllByRole('button', { name: /^Revert the/ }).map((b) => b.getAttribute('aria-label'))).toEqual(['Revert the opus class']);
    expect(screen.queryAllByRole('button', { name: /^(Hold|Release) the/ })).toHaveLength(0);
    expect(fact('opus', 'held')).toBe('Held at claude-opus-9-1.');
    expect(fact('opus', 'supervisor')).toBe(SUPERVISOR_RESIDUAL_WORDS);
    expect(rowOf('opus').textContent).toContain(`Held by hand since 2026-11-18 08:00Z. ${ENDS}`);
    expect(rowOf('opus').textContent).toMatch(/a revert would put back claude-opus-9-0/i);
    expect(rowOf('haiku').textContent).not.toMatch(/a revert would put back/i);
  });

  it('without the proof the same class has no Revert, keeps its hold facts, promises no ending, and the lane says why', async () => {
    mount(aread({}, aadvance({ opus: aclass('opus', { hold: HELD, revertable: true, previous: { model: 'claude-opus-9-0', effort: null } }) }), false), { anthropic: true });
    await ready();
    expect(screen.queryAllByRole('button', { name: /^(Hold|Release|Revert) the/ })).toHaveLength(0);
    expect(fact('opus', 'held')).toBe('Held at claude-opus-9-1.');
    expect(fact('opus', 'supervisor')).toBe(SUPERVISOR_RESIDUAL_WORDS);
    expect(rowOf('opus').textContent).toContain('Held by hand since 2026-11-18 08:00Z.');
    expect(rowOf('opus').textContent).not.toMatch(/ends by itself/);
    expect(screen.getByTestId('models-revert-unoffered').textContent).toBe(MODELS_REVERT_UNOFFERED);
  });

  it('an Anthropic Revert sends exactly {action:\'revert\', class}', async () => {
    const adv = aadvance({ opus: aclass('opus', { revertable: true, previous: { model: 'claude-opus-9-0', effort: null } }) });
    const { act: doAct } = mount(aread({}, adv), { anthropic: true, act: async () => actAnswer('revert', 'opus', aread({}, adv)) });
    await ready();
    await confirmRevert('opus');
    expect(doAct).toHaveBeenCalledWith('lane-a', { action: 'revert', class: 'opus' });
  });

  it('an unreported advance record says one thing on every lane kind, and directs to no Hold', async () => {
    mount(aread({}, { state: 'unreported', detail: null, pending: null, classes: null }), { anthropic: true });
    await ready();
    const anthropicText = screen.getByTestId('models-advance').textContent;
    expect(anthropicText).toMatch(/holds are not known/i);
    expect(anthropicText).not.toMatch(/hold or revert from here/i);
    cleanup(); clearScreenCache();
    mount(read({ state: 'unreported', detail: null, pending: null, classes: null }));
    await ready();
    expect(screen.getByTestId('models-advance').textContent).toBe(anthropicText);
  });

  it('the orphaned saved level is one line', async () => {
    mount(aread({ opus: { orphanedEffort: { id: 'claude-opus-9-0', level: 'high' } } }), { anthropic: true });
    await ready();
    expect(fact('opus', 'orphaned')).toBe('Saved effort high is keyed to an older model; ccd carries it at launch under Auto.');
    expect(facts('sonnet')).toEqual([]);
  });

  it('a class with no id shows its class word', async () => {
    mount(aread({ fable: { model: null, label: null, efforts: null, unobserved: true } }), { anthropic: true });
    await ready();
    expect(within(rowOf('fable')).getByText('Fable class', { selector: '.acct-models-model' })).toBeTruthy();
    expect(rowOf('fable').textContent).not.toMatch(/no model: this class is empty/i);
    expect(facts('fable')).toEqual(['no-id']);
  });

  it('an unlaunchable class names both builds', async () => {
    mount(aread({
      opus: { model: null, label: null, efforts: null, unobserved: true, unlaunchable: { needs: '9.1.0', laneVersion: '9.0.1' } },
      sonnet: { model: null, label: null, efforts: null, unlaunchable: { needs: '9.1.0', laneVersion: null } },
    }), { anthropic: true });
    await ready();
    expect(within(rowOf('opus')).getByText('Opus class', { selector: '.acct-models-model' })).toBeTruthy();
    expect(facts('opus')).toEqual(['unlaunchable']);
    expect(fact('opus', 'unlaunchable')).toMatch(/older than/);
    expect(fact('opus', 'unlaunchable')).toContain('9.0.1');
    expect(fact('opus', 'unlaunchable')).toContain('9.1.0');
    expect(fact('sonnet', 'unlaunchable')).toMatch(/could not be read/);
    expect(fact('sonnet', 'unlaunchable')).toContain('9.1.0');
  });

  it('a held Anthropic class carries the supervisor sentence', async () => {
    mount(aread({}, aadvance({ opus: aclass('opus', { hold: HELD }) })), { anthropic: true });
    await ready();
    expect(fact('opus', 'supervisor')).toBe(SUPERVISOR_RESIDUAL_WORDS);
    for (const c of ['haiku', 'sonnet', 'fable'] as const) expect(rowOf(c).textContent).not.toContain(SUPERVISOR_RESIDUAL_WORDS);
  });

  it('unobserved shows only on its own class', async () => {
    // opus is held and unobserved; fable has no id and is unobserved too (the wire's own shape), but is not held
    mount(aread({
      opus: { unobserved: true },
      fable: { model: null, label: null, efforts: null, unobserved: true },
    }, aadvance({ opus: aclass('opus', { hold: HELD }) })), { anthropic: true });
    await ready();
    expect(fact('opus', 'unobserved')).toMatch(/not observed while the hold stands/);
    for (const c of ['haiku', 'sonnet', 'fable'] as const) {
      expect(rowOf(c).textContent, c).not.toMatch(/not observed/i);
      expect(fact(c, 'unobserved'), c).toBeNull();
    }
  });

  it('an Anthropic lane offers no Hold or Release, whatever the class and the record', async () => {
    // Every class: unheld, held, with no id, and unlaunchable.
    mount(aread({
      sonnet: { model: null, label: null, efforts: null, unobserved: true },
      fable: { model: null, label: null, efforts: null, unobserved: true, unlaunchable: { needs: '9.1.0', laneVersion: '9.0.1' } },
    }, aadvance({ opus: aclass('opus', { hold: HELD }) })), { anthropic: true });
    await ready();
    expect(screen.queryAllByRole('button', { name: /^(Hold|Release) the/ })).toHaveLength(0);
    cleanup(); clearScreenCache();
    // and an absent record, where an old Codex sheet offered a Hold on every class
    mount(aread({}, { state: 'absent', detail: null, pending: null, classes: null }), { anthropic: true });
    await ready();
    expect(screen.queryAllByRole('button', { name: /^(Hold|Release|Revert) the/ })).toHaveLength(0);
  });

  it('a Codex lane\'s sheet offers Revert only: no Hold or Release, and no Anthropic line appears', async () => {
    mount(read(okAdvance({ opus: { ...OPUS_ADV, hold: { at: '2026-11-18T08:00:00Z', by: 'hand' } } })));
    await ready();
    expect(screen.queryAllByRole('button', { name: /^(Hold|Release) the/ })).toHaveLength(0);
    expect(screen.getAllByRole('button', { name: /^Revert the/ })).toHaveLength(1);
    expect(document.querySelectorAll('[data-fact]')).toHaveLength(0);
    expect(document.body.textContent).not.toContain(SUPERVISOR_RESIDUAL_WORDS);
    expect(rowOf('fable').textContent).toMatch(/no model: this class is empty/i);
  });
});

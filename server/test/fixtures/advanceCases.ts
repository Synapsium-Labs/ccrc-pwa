// Fixtures for the model-class auto-advance (spec 2026-10-13): a NEUTRAL catalogue and registry, and (Task 3)
// advance files. Never folded into `modelCases.ts`'s CODEX catalogue, and no real model id anywhere: every id is
// `<vendor>-<version>-<family>` with neutral words, because this repository is public.
import type { Catalogue, CatalogueModel, Registry } from '../../../shared/models.js';
import type { Advance } from '../../../shared/model-advance.mjs';

export const EFFORTS5: readonly string[] = ['low', 'medium', 'high', 'xhigh', 'max'];
export const EFFORTS4: readonly string[] = ['low', 'medium', 'high', 'xhigh'];

/** One catalogue row: visible, a 272000 context, the five effort levels, unless `o` says otherwise. */
export const mrow = (id: string, o: Partial<CatalogueModel> = {}): CatalogueModel => ({
  id, label: id, context: 272000, maxContext: 272000, efforts: [...EFFORTS5], hidden: false,
  priceIn: null, priceOut: null, ...o,
});

/** A fresh codex catalogue of `models`, unless `o` says otherwise (`{ stale: true }`). */
export const cat = (models: CatalogueModel[], o: Partial<Catalogue> = {}): Catalogue => ({
  probe: 'codex', fetchedAt: 1789000000, stale: false, models, ...o,
});

/** A codex registry: the four classes empty unless `classes` names them, subagents on the sonnet class,
 *  discovery the whole catalogue. Key order is `parseRegistry`'s own, so `JSON.stringify` of one is what
 *  `writeRegistry` would write. */
export const reg = (classes: Partial<Registry['classes']>, o: Partial<Registry> = {}): Registry => ({
  probe: 'codex', classes: { haiku: null, sonnet: null, opus: null, fable: null, ...classes },
  subagent: 'sonnet', discovery: 'catalogue', ...o,
});

/** The lane the op-level cases plant: families alpha, beta, gamma and delta; three classes pinned one version
 *  behind a newer listed model and the fourth empty; a hidden newer row; a tie (6.2 and 6.2.0); three ids that
 *  break the grammar. The newer beta and gamma rows offer four effort levels where the older ones offer five,
 *  so a level that must resolve down has a reason to. */
export const ADV_CATALOGUE: Catalogue = cat([
  mrow('model-5.6-alpha'), mrow('model-6.1-alpha'),
  mrow('model-6-beta'), mrow('model-6.1-beta', { efforts: [...EFFORTS4] }),
  mrow('model-5.6-gamma'), mrow('model-6.1-gamma', { efforts: [...EFFORTS4] }), mrow('model-7-gamma', { hidden: true }),
  mrow('model-6-delta'),
  mrow('model-6.2-omega'), mrow('model-6.2.0-omega'),
  mrow('model-auto-alpha'), mrow('vendor-6-alpha-mini'), mrow('model-6'),
]);

export const ADV_REGISTRY: Registry = reg(
  { haiku: 'model-5.6-alpha', sonnet: 'model-6-beta', opus: 'model-5.6-gamma' },
  { effort: { haiku: 'high', sonnet: 'high', opus: 'max', fable: 'max' } },
);

/** `ADV_REGISTRY` as `writeRegistry` writes it: 2-space JSON and a trailing newline. */
export const ADV_REGISTRY_BYTES = `${JSON.stringify(ADV_REGISTRY, null, 2)}\n`;

/** The plan's complete example of an advance file (§3.1): sonnet held back by a failing canary; opus advanced,
 *  its effort resolved down; fable advanced from empty, then reverted to empty and held. */
export const ADVANCE_EXAMPLE: Advance = {
  v: 1,
  classes: {
    haiku: { family: 'alpha', hold: null, previous: null, history: [] },
    sonnet: {
      family: 'beta', hold: null, previous: null,
      history: [
        { at: '2026-10-22T10:05:12Z', how: 'advance', from: 'model-6-beta', to: 'model-6.1-beta', ok: false,
          canary: 'failed', reason: 'http 500: upstream error', tries: 3, lastAt: '2026-10-22T12:05:09Z' },
      ],
    },
    opus: {
      family: 'gamma', hold: null, previous: { model: 'model-5.6-gamma', effort: 'max' },
      history: [
        { at: '2026-10-21T14:05:11Z', how: 'advance', from: 'model-5.6-gamma', to: 'model-6.1-gamma', ok: true,
          canary: 'passed', effort: { from: 'max', to: 'xhigh' } },
      ],
    },
    fable: {
      family: 'delta', hold: { at: '2026-10-22T08:00:00Z', by: 'revert' }, previous: null,
      history: [
        { at: '2026-10-21T15:05:40Z', how: 'advance', from: null, to: 'model-6-delta', ok: true, canary: 'passed' },
        { at: '2026-10-22T08:00:00Z', how: 'revert', from: 'model-6-delta', to: null, ok: true, canary: 'not-run' },
      ],
    },
  },
  pending: null,
};

/** Neutral seed families, one per class, for the pure backfill cases. */
export const ADV_SEEDS = { haiku: 'alpha', sonnet: 'beta', opus: 'gamma', fable: 'delta' } as const;

// Fixtures for the model-class auto-advance (spec 2026-10-13): a NEUTRAL catalogue and registry, and (Task 3)
// advance files. Never folded into `modelCases.ts`'s CODEX catalogue, and no real model id anywhere: every id is
// `<vendor>-<version>-<family>` with neutral words, because this repository is public.
import type { Catalogue, CatalogueModel, Registry } from '../../../shared/models.js';

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

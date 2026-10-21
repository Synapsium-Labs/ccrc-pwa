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

/** How deep `ADV_DEEP_TEXT` nests: far past the depth at which `JSON.stringify` overflows the stack (measured
 *  between 4000 and 5000 on node 24), so a copy through JSON throws a RangeError on any supported node, while
 *  `JSON.parse`, which does not recurse, reads it. Ten times the measured depth, not just past it, because the
 *  depth at which the stack overflows varies with the node version and the platform. */
export const ADV_DEEP = 50_000;
/** A JSON list nested `ADV_DEEP` deep: about 100 KB, valid JSON, unknown to every reader. */
export const ADV_DEEP_TEXT = `${'['.repeat(ADV_DEEP)}${']'.repeat(ADV_DEEP)}`;

// ── The advance step's own fixtures (auto-advance plan W2, Tasks 8 to 12) ──
// Appended after W1's and importing nothing, so this block moves no line
// above it and adds nothing to the file's import list. Neutral ids only, in
// the `<vendor>-<version>-<family>` grammar: this repository is public. One
// lane is built from them everywhere, `lane-a` (codex-kind), and each case
// varies it by spreading. `CODEX` (modelCases.ts) is never extended.

/** Every effort level a row may list, lowest first: the catalogue's own order,
 *  which `resolveEffort` ranks by. */
export const STEP_EFFORTS: readonly string[] = ['low', 'medium', 'high', 'xhigh', 'max'];

/** One catalogue row, in `parseCatalogue`'s normalised shape. */
export const stepRow = (id: string, efforts: readonly string[] = STEP_EFFORTS, hidden = false) => ({
  id, label: `Fixture ${id}`, context: 272000, maxContext: 272000, efforts: [...efforts], hidden,
  priceIn: null, priceOut: null,
});

/** A fresh codex catalogue with four families:
 *  - alpha: `model-6-alpha` is newest (`model-5.6-alpha` is older);
 *  - beta: one model;
 *  - gamma: `model-6.1-gamma` is newer than `model-5.6-gamma` and lists no
 *    `max`, so an opus at `max` resolves down to `xhigh`;
 *  - delta: one model, for an empty class whose family is stored. */
export const STEP_CATALOGUE = {
  probe: 'codex', fetchedAt: 1789000000, stale: false,
  models: [
    stepRow('model-5.6-alpha'), stepRow('model-6-alpha'),
    stepRow('model-6-beta'),
    stepRow('model-5.6-gamma'), stepRow('model-6.1-gamma', ['low', 'medium', 'high', 'xhigh']),
    stepRow('model-6-delta'),
  ],
};

/** lane-a's registry: haiku and sonnet on their family's newest model, opus one
 *  version behind (its one candidate is `model-6.1-gamma`), fable empty. Its key
 *  order is `parseRegistry`'s, so these bytes are what `writeRegistry` writes. */
export const STEP_REGISTRY = {
  probe: 'codex',
  classes: { haiku: 'model-6-alpha', sonnet: 'model-6-beta', opus: 'model-5.6-gamma', fable: null as string | null },
  subagent: 'sonnet',
  discovery: 'catalogue',
  effort: { haiku: 'high', sonnet: 'high', opus: 'max' } as Record<string, string>,
};

/** The family each class's advance-file entry stores. fable's is null: an empty
 *  class nobody seeded stays empty until a case gives it a family. */
export const STEP_FAMILIES: Readonly<Record<string, string | null>> = {
  haiku: 'alpha', sonnet: 'beta', opus: 'gamma', fable: null,
};

/** A v1 advance file (plan §3.1) for lane-a: every class at `STEP_FAMILIES`
 *  with no hold, no previous and no history, then `over[class]` spread over its
 *  entry, and `pending`. */
export const stepAdvance = (
  over: Readonly<Record<string, Record<string, unknown>>> = {},
  pending: Record<string, unknown> | null = null,
) => ({
  v: 1,
  classes: Object.fromEntries(Object.entries(STEP_FAMILIES).map(([cls, family]) =>
    [cls, { family, hold: null, previous: null, history: [], ...(over[cls] ?? {}) }])),
  pending,
});

/** Where a codex-kind fixture lane listens, and where its OAuth would live. */
export interface StepLane { proxyPort: number; litellmPort: number; authDir: string }

/** The advance step's roster: one upstream row (a roster needs exactly one),
 *  `lane-a` (codex-kind, on `laneA`'s ports), `lane-b` and `lane-c` (an
 *  Anthropic lane). `lane-b` is external-kind (the live lanes' shape before their
 *  flip), or, given `laneB`, a second codex-kind lane on those ports. */
export const stepRoster = (laneA: StepLane, laneB?: StepLane) => ({
  version: 1,
  accounts: [
    { id: 'lane-up', label: 'lane-up', configDirSuffix: '.claude', exec: { kind: 'upstream' }, homeAble: true,
      telemetry: 'anthropic' },
    { id: 'lane-a', label: 'lane-a', configDirSuffix: '.claude-lane-a',
      exec: { kind: 'codex', provider: 'openai', proxyPort: laneA.proxyPort, litellmPort: laneA.litellmPort,
        authDir: laneA.authDir },
      homeAble: false, telemetry: 'codex' },
    { id: 'lane-b', label: 'lane-b', configDirSuffix: '.claude-lane-b',
      exec: laneB === undefined ? { kind: 'external', provider: 'openai' }
        : { kind: 'codex', provider: 'openai', proxyPort: laneB.proxyPort, litellmPort: laneB.litellmPort,
          authDir: laneB.authDir },
      homeAble: false, telemetry: 'codex' },
    { id: 'lane-c', label: 'lane-c', configDirSuffix: '.claude-lane-c', exec: { kind: 'generated' }, homeAble: true,
      telemetry: 'anthropic' },
  ],
});

/** `catalogue` in the RAW shape the Codex endpoint answers, the fields
 *  `ccrc-models-probe`'s `codex_models` reads, for `CCRC_MODELS_PROBE_FIXTURE`:
 *  a refresh then probes this same catalogue back. */
export const stepRaw = (catalogue: { models: ReadonlyArray<ReturnType<typeof stepRow>> }) => ({
  models: catalogue.models.map((m) => ({
    slug: m.id, display_name: m.label, description: '', context_window: m.context, max_context_window: m.maxContext,
    visibility: m.hidden ? 'hide' : 'show', default_reasoning_level: m.efforts[0] ?? null,
    supported_reasoning_levels: m.efforts.map((effort) => ({ effort })),
  })),
});

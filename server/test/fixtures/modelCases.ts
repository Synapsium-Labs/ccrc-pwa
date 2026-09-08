// ONE table, THREE readers: `shared/models.ts`, `shared/models.mjs`, and (from
// Plan 2) `ccd/ccd`'s bash reader of the TSV this same registry produces.
// `server/test/fixtures/leastLoaded.ts`'s pattern and its reason: two
// implementations compared to the same expectation AND to each other, so a
// change to either alone reds.
//
// The Codex rows are the catalogue measured 2026-09-08 (spec §1): nine models,
// of which `gpt-reserve` and `codex-auto-review` are hidden.
import type { Catalogue, DerivedModels, Registry } from '../../../shared/models.js';

const m = (id: string, hidden = false, efforts: string[] = ['low', 'medium', 'high', 'xhigh', 'max']) =>
  ({ id, label: id, context: 272000, maxContext: 272000, efforts, hidden, priceIn: null, priceOut: null });

export const CODEX: Catalogue = {
  probe: 'codex', fetchedAt: 1789000000, stale: false,
  models: [
    { ...m('gpt-6-astra'), maxContext: 872000, efforts: ['low', 'medium', 'high', 'xhigh', 'max', 'ultra'] },
    m('gpt-5.6-sol'), m('gpt-5.6-terra'), m('gpt-5.6-luna'),
    m('gpt-5.5'), m('gpt-5.4-mini'),
    { ...m('gpt-5.3-codex-spark'), context: 128000, maxContext: 128000 },
    m('gpt-reserve', true), m('codex-auto-review', true),
  ],
};

/** The same catalogue, marked stale — the previous one kept after a failed
 *  probe (§11). `retired` must go EMPTY on it: absence from a catalogue
 *  nobody could refresh is not evidence a model is gone. */
export const CODEX_STALE: Catalogue = { ...CODEX, stale: true, lastError: 'HTTP 401' };

/** Today's seeded gpt registry (§13.1): luna/terra/sol, fable null, subagent
 *  the SONNET slot by explicit choice (§4.1, ruling 5c — never derived). */
export const SEEDED: Registry = {
  probe: 'codex',
  classes: { haiku: 'gpt-5.6-luna', sonnet: 'gpt-5.6-terra', opus: 'gpt-5.6-sol', fable: null },
  subagent: 'sonnet',
  discovery: 'catalogue',
  effort: { haiku: 'high', sonnet: 'high', opus: 'max', fable: 'max' },
};

/** What `ccrc models <id> init openrouter` writes: a legal but UNSEEDED
 *  registry (deviation B-1). Every class null, so the "subagent's slot is
 *  non-null" and "discovery is non-empty" rules stand down until one is set. */
export const UNSEEDED: Registry = {
  probe: 'openrouter',
  classes: { haiku: null, sonnet: null, opus: null, fable: null },
  subagent: 'sonnet',
  discovery: [],
};

export interface ModelCase {
  why: string;
  reg: Registry | null;
  catalogue: Catalogue | null;
  expect: DerivedModels;
}

export const modelCases: readonly ModelCase[] = [
  {
    why: 'the seeded gpt lane against today\'s catalogue: four unclassified, no fable',
    reg: SEEDED, catalogue: CODEX,
    expect: {
      classified: ['gpt-5.6-luna', 'gpt-5.6-terra', 'gpt-5.6-sol'],
      unclassified: ['gpt-6-astra', 'gpt-5.5', 'gpt-5.4-mini', 'gpt-5.3-codex-spark'],
      retired: [],
      available: ['haiku', 'sonnet', 'opus'],
    },
  },
  {
    why: 'hidden models are excluded from a "catalogue" discovery list',
    reg: { probe: 'codex', classes: { haiku: null, sonnet: null, opus: null, fable: null },
      subagent: 'sonnet', discovery: 'catalogue' },
    catalogue: CODEX,
    expect: {
      classified: [],
      unclassified: ['gpt-6-astra', 'gpt-5.6-sol', 'gpt-5.6-terra', 'gpt-5.6-luna',
        'gpt-5.5', 'gpt-5.4-mini', 'gpt-5.3-codex-spark'],
      retired: [],
      available: [],
    },
  },
  {
    why: 'a classed id absent from a fresh catalogue is retired, and its class unavailable',
    reg: {
      probe: 'codex',
      classes: { haiku: 'gpt-5.6-luna', sonnet: 'gpt-5.5-mini', opus: 'gpt-5.6-sol', fable: null },
      subagent: 'haiku', discovery: 'catalogue',
    },
    catalogue: CODEX,
    expect: {
      classified: ['gpt-5.6-luna', 'gpt-5.5-mini', 'gpt-5.6-sol'],
      unclassified: ['gpt-6-astra', 'gpt-5.6-terra', 'gpt-5.5', 'gpt-5.4-mini', 'gpt-5.3-codex-spark'],
      retired: ['gpt-5.5-mini'],
      available: ['haiku', 'opus'],
    },
  },
  {
    why: 'a STALE catalogue retires nothing — absence is not evidence when the probe failed',
    reg: {
      probe: 'codex',
      classes: { haiku: 'gpt-5.6-luna', sonnet: 'gpt-5.5-mini', opus: 'gpt-5.6-sol', fable: null },
      subagent: 'haiku', discovery: 'catalogue',
    },
    catalogue: CODEX_STALE,
    expect: {
      classified: ['gpt-5.6-luna', 'gpt-5.5-mini', 'gpt-5.6-sol'],
      unclassified: ['gpt-6-astra', 'gpt-5.6-terra', 'gpt-5.5', 'gpt-5.4-mini', 'gpt-5.3-codex-spark'],
      retired: [],
      available: ['haiku', 'sonnet', 'opus'],
    },
  },
  {
    why: 'never probed: a "catalogue" discovery list resolves to nothing, and nothing retires',
    reg: SEEDED, catalogue: null,
    expect: {
      classified: ['gpt-5.6-luna', 'gpt-5.6-terra', 'gpt-5.6-sol'],
      unclassified: [], retired: [],
      available: ['haiku', 'sonnet', 'opus'],
    },
  },
  {
    why: 'an explicit discovery list survives a never-probed lane',
    reg: {
      probe: 'openrouter',
      classes: { haiku: 'v/h', sonnet: 'v/s', opus: null, fable: null },
      subagent: 'sonnet', discovery: ['v/h', 'v/s', 'v/x'],
    },
    catalogue: null,
    expect: {
      classified: ['v/h', 'v/s'], unclassified: ['v/x'], retired: [],
      available: ['haiku', 'sonnet'],
    },
  },
  {
    why: 'no registry file at all reads as every class unavailable (§13.1)',
    reg: null, catalogue: CODEX,
    expect: { classified: [], unclassified: [], retired: [], available: [] },
  },
  {
    why: 'an UNSEEDED registry is the same answer, and is not an error',
    reg: UNSEEDED, catalogue: null,
    expect: { classified: [], unclassified: [], retired: [], available: [] },
  },
  {
    why: 'a hidden model that is EXPLICITLY discovered is offered, and is not retired',
    reg: {
      probe: 'codex',
      classes: { haiku: null, sonnet: null, opus: null, fable: 'gpt-reserve' },
      subagent: 'fable', discovery: ['gpt-reserve'],
    },
    catalogue: CODEX,
    expect: { classified: ['gpt-reserve'], unclassified: [], retired: [], available: ['fable'] },
  },
  {
    why: 'every class retired leaves available EMPTY without nulling a single slot',
    reg: {
      probe: 'codex',
      classes: { haiku: 'gone-a', sonnet: 'gone-b', opus: 'gone-c', fable: 'gone-d' },
      subagent: 'sonnet', discovery: ['gone-a', 'gone-b', 'gone-c', 'gone-d'],
    },
    catalogue: CODEX,
    expect: {
      classified: ['gone-a', 'gone-b', 'gone-c', 'gone-d'],
      unclassified: [],
      retired: ['gone-a', 'gone-b', 'gone-c', 'gone-d'],
      available: [],
    },
  },
  {
    // Fix round 1 (2026-09-08 review), Finding 2: deleting the `...discovery`
    // half of `[...classified, ...discovery]` in the retirement loop survived
    // every other row above, because in each of them an unclassified id was
    // either absent from the catalogue for a reason `classified` alone already
    // covers, or the catalogue was null/stale. Here `gpt-gone` is retired ONLY
    // reachable through `discovery` — it is never a classed id — so this row
    // reds the instant that half of the loop is dropped.
    why: 'an id retired ONLY through discovery, never classified, still retires',
    reg: {
      probe: 'codex',
      classes: { haiku: 'gpt-5.6-luna', sonnet: null, opus: null, fable: null },
      subagent: 'haiku', discovery: ['gpt-5.6-luna', 'gpt-gone'],
    },
    catalogue: CODEX,
    expect: {
      classified: ['gpt-5.6-luna'],
      unclassified: ['gpt-gone'],
      retired: ['gpt-gone'],
      available: ['haiku'],
    },
  },
];

// The model-class REGISTRY (spec §4.1), the CATALOGUE (§4.2) and the DERIVED
// states (§4.3) — the one place "unclassified", "retired" and "available" are
// computed, so the server, the PWA, the verbs and (Plan 2) ccd's bash reader
// cannot come to three different answers about the same lane.
//
// ── WHY THE REGISTRY IS ITS OWN FILE ─────────────────────────────────────
// `~/.ccrc/models/<accountId>.classes.json`, user-owned, created by
// `ccrc models <id> init <probe>` and edited only by the verbs. Ruling 280
// (2026-09-08): `exec.models`' shape belongs to the account-connections spec,
// whose branch is not on `main`, and any change there is additive and lands
// after that branch merges. So this design restates none of that shape and
// carries its own. If `classes` later folds into `exec.models` as an optional
// sibling, this file becomes the generated mirror's type and nothing here has
// to be re-argued.
//
// ── SINGLE SOURCE: THIS FILE IS TYPES, NOT IMPLEMENTATION ─────────────────
// Fix round 1 (2026-09-08 review), controller ruling: the first task-2 draft
// had every function's BODY hand-duplicated between this file and
// `shared/models.mjs` — ~200 lines the review measured, the first duplicated
// pair in `shared/`, where every other bare-`node` module (`generate.mjs`,
// `wrapper.mjs`, `mark.mjs`, `roster-json.mjs`) is ONE implementation plus a
// hand-written `.d.mts`. This file now carries only what genuinely needs to
// exist twice — `CLASSES` and `PROBE_KINDS`, whose `as const` literal is what
// derives `ModelClass`/`ProbeKind` as TYPES, a job `shared/models.mjs` cannot
// do for it — and the plain TypeScript interfaces (`Registry`, `Catalogue`,
// `CatalogueModel`, `DerivedModels`), which are erased at compile time and so
// were never really "duplicated" even before this fix. Every function,
// `RegistryInvalid`, `CatalogueInvalid`, `MODEL_ID_RE` and the sentinel prefix
// at the bottom of the re-export list below are now defined ONCE, in
// `shared/models.mjs`, and re-exported here — `instanceof RegistryInvalid`
// therefore works identically whichever of the two files a caller imported it
// from, because both names resolve to the SAME class object at runtime.
//
// The PWA still bundles this file, so it still imports nothing from `node:*`
// and nothing from a sibling `.ts` — its one import is `./models.mjs` itself,
// which is equally import-free. `server/test/models.test.ts` asserts the
// import list is exactly that one specifier and nothing else.

/** The four classes every model any lane can run is classified into, and the
 *  ONE order every walk over them uses — `classOfModel`'s reverse lookup, the
 *  four lines of `classesTsv`, the env block's key order, and the bash reader
 *  in `ccd/ccd` (Plan 2) all depend on it being the same sequence in each.
 *
 *  Exported from HERE, not from `shared/models.mjs`: this is the one constant
 *  the single-source ruling above keeps on the TypeScript side, because the
 *  `as const` literal is what lets `ModelClass` be derived as a real union
 *  TYPE (`(typeof CLASSES)[number]`) — a job only `.ts` can do. `models.mjs`
 *  exports its own copy for its own runtime walk — the `.mjs` cannot import
 *  the `.ts`'s exported `CLASSES` (that would be an import cycle), so it is a
 *  second EXPORT, not a private one; the two are pinned to agree
 *  element-for-element by `server/test/models.test.ts`. */
export const CLASSES = ['haiku', 'sonnet', 'opus', 'fable'] as const;
export type ModelClass = (typeof CLASSES)[number];

/** The four slots, ALWAYS all four keys. `null` means *this class is
 *  unavailable on this lane by nature*, never "use a default" and never
 *  "retired" — retirement is its own derived list (§4.3). The materialiser
 *  writes `ccrc-unavailable-<class>` for a null slot (§6.1), because an UNSET
 *  alias falls through to Anthropic's own id and the proxied backend answers
 *  with an opaque 404: today's Fable-on-gpt failure, measured 2026-09-08. */
export type ClassMap = Record<ModelClass, string | null>;

/** The lane's DEFAULT reasoning effort per class, used when a request names
 *  none (§6.4). Validated against the classed model's own `efforts` only when
 *  a catalogue is handed in — accepted unvalidated otherwise, and flagged by
 *  doctor once one appears (§4.1). */
export type EffortMap = Partial<Record<ModelClass, string>>;

/** Which catalogue PROBE runs for this lane (§5). It names the DISCOVERY
 *  mechanism, not the account-connections `provider` (auth and connection):
 *  round-2 ruling 10 keys probes here and nowhere else. Once `exec.provider`
 *  exists on `main` this defaults from it and a mismatch is a doctor finding.
 *
 *  Exported from HERE for the same `as const` reason as `CLASSES` above, and
 *  for no other — see that constant's comment. */
export const PROBE_KINDS = ['codex', 'openrouter', 'compatible'] as const;
export type ProbeKind = (typeof PROBE_KINDS)[number];

/** What discovery and classification operate on. The literal `'catalogue'`
 *  means the whole advertised set (hidden models excluded — §4.2), and is the
 *  default for `codex` and `compatible`; an explicit list is REQUIRED for
 *  `openrouter`, which advertises several hundred models and would make an
 *  "unclassified" badge pure noise (§2).
 *
 *  It is NOT the account-connections `selectable`, which is a picker PERMISSION
 *  (ruling 280): narrowing what an operator may pick must never narrow what the
 *  prober classifies. The two never alias, and a registry file carrying a
 *  `selectable` key is refused by name. */
export type Discovery = 'catalogue' | readonly string[];

/** One lane's class registry — the whole content of
 *  `~/.ccrc/models/<accountId>.classes.json`. */
export interface Registry {
  probe: ProbeKind;
  classes: ClassMap;
  /** A CLASS NAME, default `sonnet`, settable to `haiku`: the class
   *  `CLAUDE_CODE_SUBAGENT_MODEL` is materialised as on this lane, which
   *  Claude Code resolves to that class's own slot on a materialised lane —
   *  `haiku` follows the haiku slot only while that model is also
   *  `ANTHROPIC_SMALL_FAST_MODEL`, which the materialiser guarantees (§6.1,
   *  amended 2026-09-09). `opus` and `fable` are refused — measured on
   *  Claude Code 2.1.267, a subagent set to either runs on the sonnet slot's
   *  model regardless. It is a routing destination the operator SETS — a
   *  class-to-slot map — and never a derivation (ruling 5c). */
  subagent: ModelClass;
  discovery: Discovery;
  effort?: EffortMap;
  /** Required iff `probe` is `compatible`, which ships no default endpoint —
   *  only the operator can know one. Round-2 ruling 10; it moves to
   *  `exec.baseUrl` once that exists on `main`. */
  baseUrl?: string;
}

/** One model as a probe recorded it. Everything but `id` is best effort: an
 *  OpenRouter row has prices and no efforts, a Codex row has efforts and no
 *  prices, and a `compatible` `/v1/models` row has neither. `null` is
 *  "unknown", never "zero". */
export interface CatalogueModel {
  id: string;
  label: string;
  context: number | null;
  maxContext: number | null;
  efforts: string[];
  hidden: boolean;
  priceIn: number | null;
  priceOut: number | null;
}

/** `~/.ccrc/models/<accountId>.json`. An ABSENT file is "never probed" and is
 *  a distinct state from an empty `models` — which is why every function here
 *  takes `Catalogue | null` rather than defaulting one. `stale: true` means the
 *  last probe failed and this is the previous catalogue (§11).
 *
 *  `probe`, not `provider`: spec §4.2's own example already uses `probe`
 *  (round-2 ruling 10), and `openai` is an account-connections `ProviderId`
 *  this branch has no access to. The field records WHICH PROBE PRODUCED THIS
 *  FILE (deviation B-2), which is the only thing any reader here asks of it. */
export interface Catalogue {
  probe: ProbeKind;
  fetchedAt: number;
  stale: boolean;
  lastError?: string;
  models: CatalogueModel[];
}

/** The four derived states computed by `deriveModels` (§4.3) — see
 *  `shared/models.mjs` for how `classified`, `unclassified`, `retired` and
 *  `available` are actually worked out; this is only its shape. */
export interface DerivedModels {
  classified: string[];
  unclassified: string[];
  retired: string[];
  available: ModelClass[];
}

// ── EVERYTHING BELOW IS THE SINGLE IMPLEMENTATION IN `shared/models.mjs` ──
// `MODEL_ID_RE`, the two error classes, and every function are defined
// exactly once, over there — see that file for their behaviour, their
// refusal rules and the reasoning behind each. Re-exporting rather than
// re-declaring means `instanceof RegistryInvalid` and `instanceof
// CatalogueInvalid` both work no matter which of the two files a caller
// imported the class from, since both names are bindings to the identical
// runtime object. Types for the `.mjs`'s untyped JS come from the
// hand-written `shared/models.d.mts` beside it.
export {
  MODEL_ID_RE,
  RegistryInvalid,
  CatalogueInvalid,
  parseCatalogue,
  parseRegistry,
  resolveDiscovery,
  deriveModels,
  availableFor,
  familyClassOf,
  classOfModel,
  UNAVAILABLE_PREFIX,
  SUBAGENT_CLASSES,
} from './models.mjs';

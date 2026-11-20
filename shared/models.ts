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
// do for it (since D-8620 also two unexported literals that only derive
// `CatalogueVerbosity` and `TruncationMode`) — and the plain TypeScript interfaces (`Registry`, `Catalogue`,
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

/** A Codex model's default `text.verbosity` (D-8620), derived as a TYPE from an `as const` literal the way
 *  `ModelClass` is from `CLASSES`, so it is no hand-spelled literal union (wire totality, D-6048). The literal is NOT
 *  exported: the runtime list every reader validates with is `CATALOGUE_VERBOSITIES` (`shared/models.mjs`, re-exported
 *  below), and `server/test/models.test.ts` pins that list to this type through a `Record<CatalogueVerbosity, true>`. */
const CATALOGUE_VERBOSITY_LITERAL = ['low', 'medium', 'high'] as const;
export type CatalogueVerbosity = (typeof CATALOGUE_VERBOSITY_LITERAL)[number];
/** The unit of a Codex truncation policy's `limit` (D-8620), derived the same way; `CATALOGUE_TRUNCATION_MODES`
 *  (`shared/models.mjs`) is its runtime list, pinned to this type by the same test. */
const TRUNCATION_MODE_LITERAL = ['tokens', 'bytes'] as const;
export type TruncationMode = (typeof TRUNCATION_MODE_LITERAL)[number];
/** Codex's cap on one tool output (D-8620): `limit` is an integer in `1..CATALOGUE_TRUNCATION_LIMIT_MAX`. */
export interface TruncationPolicy {
  mode: TruncationMode;
  limit: number;
}

/** One model as a probe recorded it. Everything but `id` is best effort: an
 *  OpenRouter row has prices and no efforts, a Codex row has efforts and no
 *  prices, and a `compatible` `/v1/models` row has neither. `null` is
 *  "unknown", never "zero".
 *
 *  The five optional keys after `priceOut` are the Codex catalogue's request-shape fields (D-8620), kept on a Codex
 *  row only. Each is ABSENT when the reply did not carry a valid value, never null and never a default, so a row
 *  without them reads exactly as before and a genuine `false` stays a fact. */
export interface CatalogueModel {
  id: string;
  label: string;
  context: number | null;
  maxContext: number | null;
  efforts: string[];
  hidden: boolean;
  priceIn: number | null;
  priceOut: number | null;
  /** `use_responses_lite`: native Codex sends `reasoning.context: "all_turns"`, `parallel_tool_calls: false` and
   *  the Lite header when it is true. */
  useResponsesLite?: boolean;
  /** `support_verbosity`: whether Codex sends `text.verbosity` for this model at all. */
  supportVerbosity?: boolean;
  /** `default_verbosity`: the `text.verbosity` Codex sends when the user configured none. */
  defaultVerbosity?: CatalogueVerbosity;
  /** `default_reasoning_level`: the effort Codex sends when the user configured none. A non-empty string, valid
   *  whether or not `efforts` lists it. */
  defaultReasoningLevel?: string;
  /** `truncation_policy`: Codex's cap on tool output. */
  truncationPolicy?: TruncationPolicy;
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
  /** D-8743: the Codex client version a Codex catalogue was fetched as, a plain `X.Y.Z`. Absent on any other probe's
   *  catalogue, and on a Codex catalogue fetched before the field or through the probe's test seam. */
  clientVersion?: string;
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

/** A lane's MEASURED context windows (codex-bridge spec §2.7): model id →
 *  tokens, as `parseWindows` reads them from the lane's sibling windows file.
 *  Frozen and null-prototype at runtime. Never a field of `Registry`: see
 *  `shared/models.mjs`'s `parseWindows` for why. */
export type ModelWindows = Readonly<Record<string, number>>;

/** D-8406: one class on one lane, as the lane's own files say it: the model its registry slot names (`null`: the class
 *  is unavailable on this lane by nature) and the catalogue's label for that model (`null`: no catalogue, or no row
 *  for it). `laneClassModels` derives it. */
export interface LaneClassModel {
  readonly model: string | null;
  readonly label: string | null;
  /** D-8686 (re-plan R1): the effort levels the catalogue row for `model` lists, as `parseCatalogue` kept them (`[]`:
   *  the row lists none). `null` when there is no catalogue, no row for the model, or no model. An older server omits
   *  the field, and its one reader (`asLaneModelsRead`, `pwa/src/lib/models.ts`) reads that as `null`. */
  readonly efforts: readonly string[] | null;
}
export type LaneClassModels = Readonly<Record<ModelClass, LaneClassModel>>;

/** Why a lane's read is `unreadable` when the box said why (R3b, D-8693): the `show` refusals the retired file read used
 *  to answer past, by the coordinator's ruling of 2026-11-16 (the catalogue before the registry, the registry parsed
 *  with the catalogue, the fleet box's roster read first, and `ccd/ccrc`'s `no-answer` on a node half that answered
 *  nothing usable), and `no-output`: `ccrc` exited 1 printing nothing, which is `_ccrc_die` before any lane sub ran.
 *  Derived as a TYPE from an `as const` literal, `CatalogueVerbosity`'s pattern above, and not exported: its readers
 *  hold it through `Record<LaneUnreadableCode, …>` tables, so a word added here is a compile error until each says it. */
const LANE_UNREADABLE_CODE_LITERAL = [
  'catalogue-unreadable', 'catalogue-invalid', 'registry-invalid', 'roster-absent', 'roster-unreadable', 'roster-invalid',
  'no-answer', 'no-output',
] as const;
export type LaneUnreadableCode = (typeof LANE_UNREADABLE_CODE_LITERAL)[number];

/** Why a lane has no class registry, as `show` said it (R3b fix round 1, F1): `anthropic` is an Anthropic lane, whose
 *  classes are the client's own aliases by design, and `never-made` a lane `ccrc models <id> init` never ran on. Derived
 *  from an `as const` literal, the pattern above, and not exported. */
const LANE_ABSENT_KIND_LITERAL = ['anthropic', 'never-made'] as const;
export type LaneAbsentKind = (typeof LANE_ABSENT_KIND_LITERAL)[number];

/** Why the server's builder refused to ask (`buildModelsArgv`), a type-only import, erased at compile time. */
type ModelsArgvRefusal = import('./agent-protocol.js').ModelsArgvRefusal;

/** D-8406, R3b: `GET /api/models/:lane`'s reading of a lane, through the fleet's `models` op alone. Every outcome is its
 *  own arm, and none is folded into another (R3b, the coordinator's rulings of 2026-11-18):
 *  - `read`: the lane's classes, and `advance` as `show` reported it (absent only from a server older than R3).
 *  - `absent`: a lane with no class registry, or one the fleet box did not find. `laneKind` keeps the reason `show` sent
 *    (`LaneAbsentKind`); absent, the fleet box's roster has no such lane (`no-such-account`, fix round 2, N1). That is
 *    its one cause from this server: a null registry whose `show` body lacks the `anthropic` boolean is off the grammar
 *    and reads `unreadable` (follow-up transient-beside-kept-answer). A server from before R3b fix round 1 (F1) sent no
 *    `laneKind` at all, so from it an `absent` with none may also be a lane with no registry.
 *  - `unreadable`: the registry could not be read or parsed, or the op RAN and gave no usable answer (a timeout, an
 *    output past its cap, a lost answer, a stdout off the grammar). `code`, when present, is the box's reason
 *    (`LaneUnreadableCode`); absent, the server has no reason to name.
 *  - `unsupported`: this build does not offer the read: the fleet's agent predates the op, or the server's bare local
 *    io has no configured home. Nothing ran.
 *  - `not-started`: the frame never left, or the launcher could not start. Nothing ran.
 *  - `refused`: the server's own builder refused the lane (`why`). Nothing ran.
 *  - `busy`: the agent's one models gate was held by another request. Nothing ran, and it is transient: the next read
 *    asks again.
 *  A reader shows class names for every arm but `read`, and never a model name this tree spells. */
export type LaneModelsRead =
  | { readonly kind: 'read'; readonly classes: LaneClassModels; readonly advance?: LaneAdvanceRead }
  | { readonly kind: 'absent'; readonly laneKind?: LaneAbsentKind }
  | { readonly kind: 'unreadable'; readonly code?: LaneUnreadableCode }
  | { readonly kind: 'unsupported' }
  | { readonly kind: 'not-started' }
  | { readonly kind: 'refused'; readonly why: ModelsArgvRefusal }
  | { readonly kind: 'busy' };

/** D-8406: `GET /api/models/:lane`'s 200. */
export interface LaneModelsAnswer {
  readonly ok: true;
  readonly lane: string;
  readonly models: LaneModelsRead;
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
  FAMILY_TOKENS,
  UNAVAILABLE_PREFIX,
  SUBAGENT_CLASSES,
  parseWindows,
  WINDOW_MIN,
  WINDOW_MAX,
  CATALOGUE_VERBOSITIES,
  CATALOGUE_TRUNCATION_MODES,
  CATALOGUE_TRUNCATION_LIMIT_MAX,
  MODELS_LANE_ID_RE,
  MODELS_RESERVED_IDS,
  MODELS_DIR_NAME,
  registryFileName,
  catalogueFileName,
  aliasesFileName,
  laneClassModels,
  MODELS_PUSH_MAX,
  modelsPushOf,
  modelsPushDecision,
  // The policy's own types, declared in `shared/models.d.mts` and erased at runtime. They sit in this one block, not in
  // a second type-only re-export statement: a test pins that this file names `./models.mjs` exactly once.
  type ModelsPushDecision,
  type ModelsPushKind,
  type ModelsPushRefusal,
  type ModelsPushRoster,
} from './models.mjs';

// ── the lane's advance state, as `show` reports it (plan W4a Task 18 as re-planned, D-8686, D-5228, D-8693) ──
// `LaneModelsRead`'s `read` arm carries it from the `models` op's `show`; ABSENT `advance` is an answer from a server
// older than R3, whose read went through the retired file grant and never read the advance file, never folded into
// `unreported`. Its one reader is
// `server/src/laneModels.ts`. The four shapes are `shared/model-advance.mjs`'s own (`.d.mts`), never restated: they are
// named through type-only `import()` expressions, erased at compile time, so the PWA bundles nothing from that file, and
// this file's one `from` specifier stays `./models.mjs` (`server/test/models.test.ts` pins it; D-8709).
type HistoryEntry = import('./model-advance.mjs').HistoryEntry;
type Hold = import('./model-advance.mjs').Hold;
type Pending = import('./model-advance.mjs').Pending;
type Previous = import('./model-advance.mjs').Previous;

/** D-8686, D-5228: how `show` reported the lane's advance file, five states never folded. `unreported`: the answer
 *  carried no `advance` key, or an `ok` one without `pending` (only a `ccrc` older than this reader sends either).
 *  `invalid` is also a state WORD this reader does not know (R3b, the operator's ruling of 2026-11-17): the lane's
 *  classes are kept, and only the advance record is "not one this build reads".
 *  The literal is NOT exported, `CatalogueVerbosity`'s pattern above: a value declared here and not in
 *  `shared/models.mjs` would be `undefined` to an extension-less import at runtime (`server/test/models.test.ts`),
 *  and its one reader, `server/src/laneModels.ts`, switches on the type (D-8709). */
const LANE_ADVANCE_STATES = ['ok', 'absent', 'unreadable', 'invalid', 'unreported'] as const;
export type LaneAdvanceState = (typeof LANE_ADVANCE_STATES)[number];
export interface LaneClassAdvance {
  readonly family: string | null;
  readonly hold: Hold | null;
  readonly previous: Previous | null;
  /** True only when the file was read and holds a `previous` for the class: a Revert has somewhere to go. */
  readonly revertable: boolean;
  /** The newest SUCCESSFUL move (`lastMoveOf`), or null. */
  readonly lastMove: HistoryEntry | null;
}
export interface LaneAdvanceRead {
  readonly state: LaneAdvanceState;
  /** The reason an `unreadable` or `invalid` file gave; null in every other state. */
  readonly detail: string | null;
  /** The file's pending intent (D-5188); null for none, and in every state but `ok`. */
  readonly pending: Pending | null;
  /** Every class, only when `state` is `ok`; null otherwise. */
  readonly classes: Readonly<Record<ModelClass, LaneClassAdvance>> | null;
}

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
// ── L0, AND IT IMPORTS NOTHING ───────────────────────────────────────────
// The PWA bundles this file, so no `node:*` and no fs. The catalogue and the
// registry arrive here already parsed from JSON: whoever reads the files off
// disk does the `readFile` and hands the value in. There is no sibling to
// import either — `CLASSES` lives here, not in `shared/roster.ts`, because
// ruling 280 keeps this design out of the roster entirely.
// `server/test/models.test.ts` asserts the empty import list.
//
// Its bare-`node` twin is `shared/models.mjs`, driven over the same case table
// in the same suite.

/** The four classes every model any lane can run is classified into, and the
 *  ONE order every walk over them uses — `classOfModel`'s reverse lookup, the
 *  four lines of `classesTsv`, the env block's key order, and the bash reader
 *  in `ccd/ccd` (Plan 2) all depend on it being the same sequence in each. */
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
 *  exists on `main` this defaults from it and a mismatch is a doctor finding. */
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

/** A model id, as the account-connections branch defines it.
 *
 *  COPIED, not imported: that branch is not on `main` (ruling 280) and this
 *  design must not depend on it. Its origin is `shared/roster.ts:97` on branch
 *  `ws/gemini-subscription-account-connection`, whose own comment records the
 *  reason for the charset — an account id becomes a filename and a bash `case`
 *  pattern and so cannot hold `/`, `.` or `:`, while an OpenRouter model id is
 *  `anthropic/claude-opus-4.5:beta` and holds all three. Capped at 128
 *  characters. `server/test/models.test.ts` compares this literal to the twin's
 *  SOURCE for source, because the last regex hand-copied in this tree shipped
 *  as raw control bytes with every suite green. */
export const MODEL_ID_RE = /^[A-Za-z0-9][A-Za-z0-9._:\/-]{0,127}$/;

/** One lane's class registry — the whole content of
 *  `~/.ccrc/models/<accountId>.classes.json`. */
export interface Registry {
  probe: ProbeKind;
  classes: ClassMap;
  /** A CLASS NAME, default `sonnet`: what `CLAUDE_CODE_SUBAGENT_MODEL`
   *  resolves to on this lane (§6.1). It is a routing destination the operator
   *  SETS — a class-to-slot map — and never a derivation (ruling 5c). */
  subagent: ModelClass;
  discovery: Discovery;
  effort?: EffortMap;
  /** Required iff `probe` is `compatible`, which ships no default endpoint —
   *  only the operator can know one. Round-2 ruling 10; it moves to
   *  `exec.baseUrl` once that exists on `main`. */
  baseUrl?: string;
}

/** Thrown by `parseRegistry`. Carries the offending FIELD as data, not only in
 *  the sentence: the verbs' contract is "refuses, with the field named" (§10),
 *  and Plan 3a's PATCH route points a UI control at it. */
export class RegistryInvalid extends Error {
  readonly field: string;
  constructor(field: string, message: string) {
    super(message);
    this.name = 'RegistryInvalid';
    this.field = field;
  }
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
 *  `probe`, not `provider`: spec §4.2's example predates round-2 ruling 10,
 *  and `openai` is an account-connections `ProviderId` this branch has no
 *  access to. The field records WHICH PROBE PRODUCED THIS FILE (deviation
 *  B-2), which is the only thing any reader here asks of it. */
export interface Catalogue {
  probe: ProbeKind;
  fetchedAt: number;
  stale: boolean;
  lastError?: string;
  models: CatalogueModel[];
}

/** Thrown by `parseCatalogue`. A GENERATED file, so a bad one is a bug in the
 *  probe and not an operator's typo — there is no field to name and no remedy
 *  to offer beyond "re-probe". */
export class CatalogueInvalid extends Error {
  constructor(message: string) { super(message); this.name = 'CatalogueInvalid'; }
}

function isObj(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function num(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

/** Validates a catalogue read off disk and fills its optional fields. Refuses
 *  the WHOLE file on a model with no `id` (§11): a partial catalogue would
 *  retire every model the probe happened to drop, which is a warning on every
 *  surface about models that answer fine. */
export function parseCatalogue(json: unknown): Catalogue {
  if (!isObj(json)) throw new CatalogueInvalid('a catalogue must be an object');
  const probe = json['probe'];
  if (typeof probe !== 'string' || !(PROBE_KINDS as readonly string[]).includes(probe)) {
    throw new CatalogueInvalid(
      `unknown catalogue probe ${JSON.stringify(probe)}: it must be one of ${PROBE_KINDS.join(', ')}`);
  }
  const fetchedAt = json['fetchedAt'];
  if (typeof fetchedAt !== 'number' || !Number.isFinite(fetchedAt)) {
    throw new CatalogueInvalid('a catalogue needs a numeric fetchedAt');
  }
  const modelsRaw = json['models'];
  if (!Array.isArray(modelsRaw)) throw new CatalogueInvalid('a catalogue needs a models array');
  const models: CatalogueModel[] = modelsRaw.map((raw, i) => {
    if (!isObj(raw) || typeof raw['id'] !== 'string' || raw['id'].length === 0) {
      throw new CatalogueInvalid(`catalogue models[${i}] has no id`);
    }
    const id = raw['id'];
    const label = typeof raw['label'] === 'string' && raw['label'].length > 0 ? raw['label'] : id;
    const efforts = Array.isArray(raw['efforts'])
      ? raw['efforts'].filter((e): e is string => typeof e === 'string')
      : [];
    return {
      id, label,
      context: num(raw['context']),
      maxContext: num(raw['maxContext']),
      efforts,
      hidden: raw['hidden'] === true,
      priceIn: num(raw['priceIn']),
      priceOut: num(raw['priceOut']),
    };
  });
  const lastError = json['lastError'];
  return {
    probe: probe as ProbeKind, fetchedAt, stale: json['stale'] === true, models,
    ...(typeof lastError === 'string' ? { lastError } : {}),
  };
}

const REGISTRY_KEYS: readonly string[] = ['probe', 'classes', 'subagent', 'discovery', 'effort', 'baseUrl'];

/**
 * Validates `~/.ccrc/models/<id>.classes.json`, naming the offending field.
 *
 * `catalogue` is OPTIONAL and changes exactly one rule: with it, an `effort`
 * level must be one the classed model actually offers; without it, the level is
 * accepted unvalidated and doctor flags it once a catalogue appears (§4.1). No
 * other rule reads the catalogue — a registry that stopped parsing because a
 * catalogue was stale would take the server down for a fact about the network.
 *
 * THE UNSEEDED CASE (deviation B-1): a registry whose four slots are ALL null
 * is what `ccrc models <id> init openrouter` writes, and it is legal. On it the
 * "subagent's slot is non-null" and "discovery is non-empty" rules stand down —
 * there is nothing yet to point at. Both apply in full the moment any slot is
 * filled, and the materialiser refuses to write an env block for such a lane
 * anyway ("a lane needs at least one class"), so nothing routes to it meanwhile.
 */
export function parseRegistry(json: unknown, catalogue?: Catalogue | null): Registry {
  if (!isObj(json)) {
    throw new RegistryInvalid('', 'a class registry must be a JSON object');
  }
  for (const key of Object.keys(json)) {
    if (!REGISTRY_KEYS.includes(key)) {
      throw new RegistryInvalid(key,
        `unknown field "${key}" in the class registry. It holds ${REGISTRY_KEYS.join(', ')}. `
        + '"selectable" is the account-connections picker permission and is deliberately not this '
        + 'file\'s "discovery" scope — the two never alias.');
    }
  }

  const probe = json['probe'];
  if (typeof probe !== 'string' || !(PROBE_KINDS as readonly string[]).includes(probe)) {
    throw new RegistryInvalid('probe',
      `probe ${JSON.stringify(probe)} is not a probe kind: it must be one of ${PROBE_KINDS.join(', ')}.`);
  }

  const classesRaw = json['classes'];
  if (!isObj(classesRaw)) {
    throw new RegistryInvalid('classes',
      `classes is missing or is not an object. It needs all four of ${CLASSES.join(', ')}, each a `
      + 'model id or null.');
  }
  for (const key of Object.keys(classesRaw)) {
    if (!(CLASSES as readonly string[]).includes(key)) {
      throw new RegistryInvalid(`classes.${key}`,
        `classes has an unknown key "${key}" — the four are ${CLASSES.join(', ')}. "subagent" is not `
        + 'one of them: it is a sibling field naming which of those four the subagents run as.');
    }
  }
  const classes: Record<string, string | null> = {};
  for (const cls of CLASSES) {
    const v = classesRaw[cls];
    if (v === null) { classes[cls] = null; continue; }
    if (typeof v !== 'string' || !MODEL_ID_RE.test(v)) {
      throw new RegistryInvalid(`classes.${cls}`,
        `classes.${cls} is ${JSON.stringify(v)}, which is not a model id. Set it to a letter or `
        + 'digit followed by up to 127 of letters, digits, ".", "_", ":", "/" and "-", or to null — '
        + 'null means this class is unavailable on this lane.');
    }
    classes[cls] = v;
  }
  const seeded = CLASSES.some((c) => classes[c] !== null);

  const subagent = json['subagent'];
  if (typeof subagent !== 'string' || !(CLASSES as readonly string[]).includes(subagent)) {
    throw new RegistryInvalid('subagent',
      `subagent is ${JSON.stringify(subagent)}, which is not a class: it must be one of `
      + `${CLASSES.join(', ')}. It is the class SUBAGENTS run as on this lane, set deliberately and `
      + 'never derived.');
  }
  if (seeded && classes[subagent] === null) {
    throw new RegistryInvalid('subagent',
      `subagent names "${subagent}", whose slot is null — CLAUDE_CODE_SUBAGENT_MODEL would resolve `
      + `to a sentinel and every subagent on this lane would fail. Assign ${subagent} a model, or `
      + 'point subagent at a class that has one.');
  }

  const discoveryRaw = json['discovery'];
  let discovery: Discovery;
  if (discoveryRaw === 'catalogue') {
    if (probe === 'openrouter') {
      throw new RegistryInvalid('discovery',
        'openrouter requires an explicit discovery list: it advertises several hundred models, and '
        + 'an "unclassified" badge over all of them is noise. Build one with '
        + "'ccrc models <id> discovery add <modelId>'.");
    }
    discovery = 'catalogue';
  } else if (Array.isArray(discoveryRaw)) {
    if (discoveryRaw.length === 0 && seeded) {
      throw new RegistryInvalid('discovery',
        'discovery is an empty list on a registry that already classifies models — an empty list '
        + 'offers nothing to classify. Add the classed ids, or set it to "catalogue".');
    }
    const seen = new Set<string>();
    for (const [i, entry] of discoveryRaw.entries()) {
      if (typeof entry !== 'string' || !MODEL_ID_RE.test(entry)) {
        throw new RegistryInvalid(`discovery[${i}]`,
          `discovery[${i}] is ${JSON.stringify(entry)}, which is not a model id.`);
      }
      if (seen.has(entry)) {
        throw new RegistryInvalid('discovery',
          `discovery lists ${JSON.stringify(entry)} twice. Remove the duplicate.`);
      }
      seen.add(entry);
    }
    for (const cls of CLASSES) {
      const target = classes[cls];
      if (target !== null && target !== undefined && !seen.has(target)) {
        throw new RegistryInvalid('discovery',
          `${cls} routes to ${JSON.stringify(target)}, which the discovery list does not offer — a `
          + 'routing target no surface ever showed. Add it to discovery, or point classes.'
          + `${cls} at a model the list already offers.`);
      }
    }
    discovery = discoveryRaw as readonly string[];
  } else {
    throw new RegistryInvalid('discovery',
      `discovery is ${JSON.stringify(discoveryRaw)}. Set it to the string "catalogue" (the whole `
      + 'advertised set) or to a list of model ids.');
  }

  const baseUrlRaw = json['baseUrl'];
  let baseUrl: string | undefined;
  if (baseUrlRaw !== undefined) {
    if (typeof baseUrlRaw !== 'string' || baseUrlRaw.length === 0) {
      throw new RegistryInvalid('baseUrl', 'baseUrl must be a non-empty string when it is present.');
    }
    baseUrl = baseUrlRaw;
  }
  if (probe === 'compatible' && baseUrl === undefined) {
    throw new RegistryInvalid('baseUrl',
      'probe "compatible" needs a baseUrl: it ships no default endpoint, so only you can say where '
      + 'this lane talks to.');
  }

  const effortRaw = json['effort'];
  if (effortRaw === undefined) {
    return { probe: probe as ProbeKind, classes: classes as ClassMap,
      subagent: subagent as ModelClass, discovery, ...(baseUrl !== undefined ? { baseUrl } : {}) };
  }
  if (!isObj(effortRaw)) {
    throw new RegistryInvalid('effort',
      'effort must be an object keyed by class, or absent — absent means the provider\'s own default '
      + 'for each model.');
  }
  const byId = new Map((catalogue?.models ?? []).map((m) => [m.id, m]));
  const effort: Record<string, string> = {};
  for (const [key, value] of Object.entries(effortRaw)) {
    if (!(CLASSES as readonly string[]).includes(key)) {
      throw new RegistryInvalid(`effort.${key}`,
        `effort.${key} is an unknown key — the keys are ${CLASSES.join(', ')}.`);
    }
    if (typeof value !== 'string' || value.length === 0) {
      throw new RegistryInvalid(`effort.${key}`,
        `effort.${key} is ${JSON.stringify(value)}. Set it to one of the classed model's own effort `
        + "levels — run 'ccrc models <id> show' to see them.");
    }
    const target = classes[key];
    const row = target === null || target === undefined ? undefined : byId.get(target);
    // A level is refused only when the catalogue POSITIVELY contradicts it. An
    // absent catalogue, or a row with an EMPTY `efforts` (every OpenRouter and
    // `compatible` row), leaves it alone: unknown is not "none offered".
    if (row !== undefined && row.efforts.length > 0 && !row.efforts.includes(value)) {
      throw new RegistryInvalid(`effort.${key}`,
        `effort.${key} is "${value}", which "${target}" does not offer. It offers: `
        + `${row.efforts.join(', ')}.`);
    }
    effort[key] = value;
  }
  return { probe: probe as ProbeKind, classes: classes as ClassMap,
    subagent: subagent as ModelClass, discovery, effort: effort as EffortMap,
    ...(baseUrl !== undefined ? { baseUrl } : {}) };
}

/** What discovery and classification operate on. `'catalogue'` resolves to the
 *  catalogue's VISIBLE ids — hidden Codex models are excluded (§4.2, decision
 *  6) and reachable only by an explicit discovery entry. With no catalogue it
 *  resolves to NOTHING, never to "everything": never-probed is a state, and a
 *  list invented from the classed ids would make `unclassified` silently empty
 *  on exactly the lane nobody has ever looked at. */
export function resolveDiscovery(reg: Registry, catalogue: Catalogue | null): string[] {
  if (reg.discovery !== 'catalogue') return [...reg.discovery];
  if (catalogue === null) return [];
  return catalogue.models.filter((m) => !m.hidden).map((m) => m.id);
}

export interface DerivedModels {
  classified: string[];
  unclassified: string[];
  retired: string[];
  available: ModelClass[];
}

function classIds(classes: ClassMap): string[] {
  const out: string[] = [];
  for (const c of CLASSES) {
    const v = classes[c];
    if (v !== null && !out.includes(v)) out.push(v);
  }
  return out;
}

/**
 * The four derived states, from a lane's registry and its catalogue (§4.3).
 *
 *  - `reg === null` — no registry file — → every class unavailable. That is
 *    §13.1's migration state on a non-Anthropic lane, and it is deliberately
 *    not "all four": a lane nobody has seeded routes nowhere, and doctor says
 *    so. **An Anthropic lane is the CALLER's business** — see `availableFor`.
 *  - `retired` is computed only against a catalogue that EXISTS and is NOT
 *    stale. Absence from a catalogue nobody could refresh is not evidence.
 *  - A retired id NEVER empties its slot. It stays classified, stays in the
 *    registry, and the class simply stops being available until the operator
 *    reassigns (§4.3, ruling 4).
 */
export function deriveModels(reg: Registry | null, catalogue: Catalogue | null): DerivedModels {
  if (reg === null) {
    return { classified: [], unclassified: [], retired: [], available: [] };
  }
  const classified = classIds(reg.classes);
  const discovery = resolveDiscovery(reg, catalogue);
  const unclassified = discovery.filter((id) => !classified.includes(id));
  const retired: string[] = [];
  if (catalogue !== null && !catalogue.stale) {
    // Against the WHOLE catalogue including hidden models: a hidden model the
    // operator discovered explicitly still exists upstream, and calling it
    // retired would warn on every surface about a model that answers fine.
    const live = new Set(catalogue.models.map((m) => m.id));
    for (const id of [...classified, ...discovery]) {
      if (!live.has(id) && !retired.includes(id)) retired.push(id);
    }
  }
  const available = CLASSES.filter((c) => {
    const id = reg.classes[c];
    return id !== null && !retired.includes(id);
  });
  return { classified, unclassified, retired, available: [...available] };
}

/**
 * Which classes routing may use on this lane — the ONE implementation of
 * "an Anthropic lane has all four" (round-2 ruling 2).
 *
 * `anthropic` is a parameter and not a field because the roster on `main` has
 * no `exec.provider` to derive it from: `ExecSpec` is `upstream | generated |
 * external` and nothing more. Every caller computes it from the roster's own
 * declaration, `telemetry === 'anthropic'` (deviation B-3), in one place per
 * program. On such a lane the four classes are Claude Code's own defaults, the
 * registry file does not exist, and there is nothing to classify.
 */
export function availableFor(
  reg: Registry | null, catalogue: Catalogue | null, anthropic: boolean,
): ModelClass[] {
  if (anthropic) return [...CLASSES];
  return deriveModels(reg, catalogue).available;
}

/** The four family tokens, in match order — an id is FABLE-class before it is
 *  opus-class, so a hybrid name resolves the way its most specific token says.
 *  Matched WITH their dashes: `opus` bare would classify `opusml/x`. Plan 2's
 *  `_session_class` implements the same rule in bash and is pinned against
 *  this one by that plan's agreement test. */
const FAMILY_TOKENS: readonly (readonly [string, ModelClass])[] = [
  ['-fable-', 'fable'], ['-opus-', 'opus'], ['-sonnet-', 'sonnet'], ['-haiku-', 'haiku'],
];

export function familyClassOf(anthropicModelId: string): ModelClass | null {
  for (const [token, cls] of FAMILY_TOKENS) {
    if (anthropicModelId.includes(token)) return cls;
  }
  return null;
}

/** Reverse lookup: which class does this lane route to `modelId`? The FIRST
 *  class in `CLASSES` order wins, so two slots holding one id resolve
 *  deterministically rather than by object key order. A `null` slot never
 *  matches — `classOfModel(reg, '')` is null, not "haiku". */
export function classOfModel(reg: Registry, modelId: string): ModelClass | null {
  if (modelId.length === 0) return null;
  for (const c of CLASSES) {
    if (reg.classes[c] === modelId) return c;
  }
  return null;
}

/** What the materialiser writes into the env block for a `null` slot (§6.1).
 *  Never left unset: unset, the alias falls through to Anthropic's own id and
 *  the proxied backend answers with an opaque 404.
 *
 *  IT LIVES IN A SINK. Nothing branches on it — not here, not in ccd, not in
 *  the API, not in the UI. Availability is `DerivedModels.available` in
 *  TypeScript and node, and the THIRD COLUMN of `<id>.classes.tsv` in bash. */
export const UNAVAILABLE_PREFIX = 'ccrc-unavailable-';

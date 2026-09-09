// shared/models.mjs — THE SINGLE IMPLEMENTATION of the registry (§4.1), the
// catalogue (§4.2) and the derived states (§4.3), for every caller: the
// callers that run under a BARE `node` — `deploy/models-op.mjs`,
// `shared/modelenv.mjs`, and (Plan 2) the reader ccd shells out to, none of
// which can import a `.ts` (no build step, no `tsx`, no compiled `dist/`,
// exactly `shared/wrapper.mjs`'s constraint in this tree) — AND
// `shared/models.ts`, which the server and the PWA bundle and which re-exports
// every function, `MODEL_ID_RE`, the two error classes and the sentinel
// constant straight from this file. See `shared/models.ts` for the TYPES
// (`Registry`, `Catalogue`, `ModelClass`, …) and for its OWN `CLASSES`/
// `PROBE_KINDS`, an `as const` literal that derives `ModelClass`/`ProbeKind`
// as TYPES — a job only `.ts` can do, so that copy stays there rather than
// re-exporting this file's runtime one. This file exports its own `CLASSES`/
// `PROBE_KINDS` too (fix round 1, finding 3, 2026-09-08): every bare-`node`
// caller that needs the runtime list — `shared/modelenv.mjs` among them —
// imports it from HERE rather than keeping a third hand-copy.
// `server/test/models.test.ts` still pins the two arrays to agree
// element-for-element, since this file cannot import `shared/models.ts`
// without creating an import cycle (`.ts` imports `.mjs`, so `.mjs` cannot
// import `.ts` back).
//
// SINGLE SOURCE since fix round 1 (2026-09-08 review), controller ruling: the
// first task-2 draft had this file and `shared/models.ts` each carrying a full,
// hand-duplicated copy of every function body — ~200 lines the review
// measured, the first duplicated pair in `shared/`, where every other
// bare-`node` module (`generate.mjs`, `wrapper.mjs`, `mark.mjs`,
// `roster-json.mjs`) is ONE implementation plus a hand-written `.d.mts`.
// `server/test/models.test.ts` now drives the case table over this file's
// exports ONCE, imported through `shared/models.ts`'s re-export — there is no
// second implementation left to compare it against.
//
// It imports nothing, not even `node:*`.

/** The runtime twin of `shared/models.ts`'s own `as const` `CLASSES`, in the
 *  same order — that file keeps its own literal because only `.ts` can derive
 *  `ModelClass` as a TYPE from it (see the file header); this is the value
 *  every bare-`node` caller imports, `shared/modelenv.mjs` among them (fix
 *  round 1, finding 3). `server/test/models.test.ts` pins the two arrays to
 *  agree element-for-element, so a change to one alone reds. */
export const CLASSES = ['haiku', 'sonnet', 'opus', 'fable'];

/** Same arrangement as `CLASSES` above, for `shared/models.ts`'s own
 *  `PROBE_KINDS`. */
export const PROBE_KINDS = ['codex', 'openrouter', 'compatible'];

/** A model id, as the account-connections branch defines it.
 *
 *  COPIED, not imported: that branch is not on `main` (ruling 280) and this
 *  design must not depend on it. Its origin is `shared/roster.ts:97` on branch
 *  `ws/gemini-subscription-account-connection`, whose own comment records the
 *  reason for the charset — an account id becomes a filename and a bash `case`
 *  pattern and so cannot hold `/`, `.` or `:`, while an OpenRouter model id is
 *  `anthropic/claude-opus-4.5:beta` and holds all three. Capped at 128
 *  characters. `server/test/models.test.ts` checks this literal against a
 *  pinned copy of the text, because the last regex hand-copied in this tree
 *  shipped as raw control bytes with every suite green. */
export const MODEL_ID_RE = /^[A-Za-z0-9][A-Za-z0-9._:\/-]{0,127}$/;

const REGISTRY_KEYS = ['probe', 'classes', 'subagent', 'discovery', 'effort', 'baseUrl'];

/** The hostnames `parseRegistry`'s `baseUrl` scheme gate (C13) treats as a
 *  local proxy, and so the one case http:// is legal for. `URL#hostname`
 *  keeps the brackets on an IPv6 literal (`new URL('http://[::1]/').hostname`
 *  is `'[::1]'`, measured), so that is the form matched here. */
const LOOPBACK_HOSTS = ['127.0.0.1', 'localhost', '[::1]'];

/** Thrown by `parseRegistry`. Carries the offending FIELD as data, not only in
 *  the sentence: the verbs' contract is "refuses, with the field named" (§10),
 *  and Plan 3a's PATCH route points a UI control at it. Defined here and
 *  re-exported (not redeclared) by `shared/models.ts`, so `instanceof
 *  RegistryInvalid` is true for the same thrown error regardless of which of
 *  the two files a catcher imported the class from. */
export class RegistryInvalid extends Error {
  constructor(field, message) {
    super(message);
    this.name = 'RegistryInvalid';
    this.field = field;
  }
}

/** Thrown by `parseCatalogue`. A GENERATED file, so a bad one is a bug in the
 *  probe and not an operator's typo — there is no field to name and no remedy
 *  to offer beyond "re-probe". Defined here and re-exported by
 *  `shared/models.ts` for the same `instanceof` reason as `RegistryInvalid`. */
export class CatalogueInvalid extends Error {
  constructor(message) { super(message); this.name = 'CatalogueInvalid'; }
}

const isObj = (v) => typeof v === 'object' && v !== null && !Array.isArray(v);
const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);

/** `(json: unknown) => Catalogue`. Validates a catalogue read off disk and
 *  fills its optional fields. Refuses the WHOLE file on a model with no `id`
 *  (§11): a partial catalogue would retire every model the probe happened to
 *  drop, which is a warning on every surface about models that answer fine. */
export function parseCatalogue(json) {
  if (!isObj(json)) throw new CatalogueInvalid('a catalogue must be an object');
  const probe = json['probe'];
  if (typeof probe !== 'string' || !PROBE_KINDS.includes(probe)) {
    throw new CatalogueInvalid(
      `unknown catalogue probe ${JSON.stringify(probe)}: it must be one of ${PROBE_KINDS.join(', ')}`);
  }
  const fetchedAt = json['fetchedAt'];
  if (typeof fetchedAt !== 'number' || !Number.isFinite(fetchedAt)) {
    throw new CatalogueInvalid('a catalogue needs a numeric fetchedAt');
  }
  const modelsRaw = json['models'];
  if (!Array.isArray(modelsRaw)) throw new CatalogueInvalid('a catalogue needs a models array');
  const models = modelsRaw.map((raw, i) => {
    if (!isObj(raw) || typeof raw['id'] !== 'string' || raw['id'].length === 0) {
      throw new CatalogueInvalid(`catalogue models[${i}] has no id`);
    }
    const id = raw['id'];
    const label = typeof raw['label'] === 'string' && raw['label'].length > 0 ? raw['label'] : id;
    const efforts = Array.isArray(raw['efforts'])
      ? raw['efforts'].filter((e) => typeof e === 'string')
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
  const out = { probe, fetchedAt, stale: json['stale'] === true, models };
  if (typeof json['lastError'] === 'string') out.lastError = json['lastError'];
  return out;
}

/**
 * `(json: unknown, catalogue?: Catalogue | null) => Registry`. Validates
 * `~/.ccrc/models/<id>.classes.json`, naming the offending field.
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
export function parseRegistry(json, catalogue) {
  if (!isObj(json)) throw new RegistryInvalid('', 'a class registry must be a JSON object');
  for (const key of Object.keys(json)) {
    if (!REGISTRY_KEYS.includes(key)) {
      throw new RegistryInvalid(key,
        `unknown field "${key}" in the class registry. It holds ${REGISTRY_KEYS.join(', ')}. `
        + '"selectable" is the account-connections picker permission and is deliberately not this '
        + 'file\'s "discovery" scope — the two never alias.');
    }
  }
  const probe = json['probe'];
  if (typeof probe !== 'string' || !PROBE_KINDS.includes(probe)) {
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
    if (!CLASSES.includes(key)) {
      throw new RegistryInvalid(`classes.${key}`,
        `classes has an unknown key "${key}" — the four are ${CLASSES.join(', ')}. "subagent" is not `
        + 'one of them: it is a sibling field naming which of those four the subagents run as.');
    }
  }
  const classes = {};
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
  if (typeof subagent !== 'string' || !CLASSES.includes(subagent)) {
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
  let discovery;
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
    const seen = new Set();
    discoveryRaw.forEach((entry, i) => {
      if (typeof entry !== 'string' || !MODEL_ID_RE.test(entry)) {
        throw new RegistryInvalid(`discovery[${i}]`,
          `discovery[${i}] is ${JSON.stringify(entry)}, which is not a model id.`);
      }
      if (seen.has(entry)) {
        throw new RegistryInvalid('discovery',
          `discovery lists ${JSON.stringify(entry)} twice. Remove the duplicate.`);
      }
      seen.add(entry);
    });
    for (const cls of CLASSES) {
      const target = classes[cls];
      if (target !== null && target !== undefined && !seen.has(target)) {
        throw new RegistryInvalid('discovery',
          `${cls} routes to ${JSON.stringify(target)}, which the discovery list does not offer — a `
          + 'routing target no surface ever showed. Add it to discovery, or point classes.'
          + `${cls} at a model the list already offers.`);
      }
    }
    discovery = [...discoveryRaw];
  } else {
    throw new RegistryInvalid('discovery',
      `discovery is ${JSON.stringify(discoveryRaw)}. Set it to the string "catalogue" (the whole `
      + 'advertised set) or to a list of model ids.');
  }

  const baseUrlRaw = json['baseUrl'];
  let baseUrl;
  if (baseUrlRaw !== undefined) {
    if (typeof baseUrlRaw !== 'string' || baseUrlRaw.length === 0) {
      throw new RegistryInvalid('baseUrl', 'baseUrl must be a non-empty string when it is present.');
    }
    // C13: this URL carries the lane's bearer token on every request the
    // probe makes (`ccrc-models-probe`'s `compatible` arm). http:// sends
    // that key in cleartext, so it is refused — except for a loopback host
    // (127.0.0.1, localhost, [::1]), the one legitimate local-proxy case.
    let parsed;
    try {
      parsed = new URL(baseUrlRaw);
    } catch {
      throw new RegistryInvalid('baseUrl', `baseUrl ${JSON.stringify(baseUrlRaw)} is not a valid URL.`);
    }
    const isLoopbackHost = LOOPBACK_HOSTS.includes(parsed.hostname);
    if (parsed.protocol !== 'https:' && !(parsed.protocol === 'http:' && isLoopbackHost)) {
      throw new RegistryInvalid('baseUrl',
        `baseUrl ${JSON.stringify(baseUrlRaw)} must be https:// — the lane's key goes out on every `
        + 'request this probe makes. http:// is accepted only for a loopback host (127.0.0.1, '
        + 'localhost, [::1]), the one legitimate local-proxy case.');
    }
    baseUrl = baseUrlRaw;
  }
  if (probe === 'compatible' && baseUrl === undefined) {
    throw new RegistryInvalid('baseUrl',
      'probe "compatible" needs a baseUrl: it ships no default endpoint, so only you can say where '
      + 'this lane talks to.');
  }

  const out = { probe, classes, subagent, discovery };
  const effortRaw = json['effort'];
  if (effortRaw !== undefined) {
    if (!isObj(effortRaw)) {
      throw new RegistryInvalid('effort',
        'effort must be an object keyed by class, or absent — absent means the provider\'s own '
        + 'default for each model.');
    }
    const byId = new Map(((catalogue && catalogue.models) || []).map((m) => [m.id, m]));
    const effort = {};
    for (const [key, value] of Object.entries(effortRaw)) {
      if (!CLASSES.includes(key)) {
        throw new RegistryInvalid(`effort.${key}`,
          `effort.${key} is an unknown key — the keys are ${CLASSES.join(', ')}.`);
      }
      if (typeof value !== 'string' || value.length === 0) {
        throw new RegistryInvalid(`effort.${key}`,
          `effort.${key} is ${JSON.stringify(value)}. Set it to one of the classed model's own `
          + "effort levels — run 'ccrc models <id> show' to see them.");
      }
      const target = classes[key];
      const row = target === null || target === undefined ? undefined : byId.get(target);
      if (row !== undefined && row.efforts.length > 0 && !row.efforts.includes(value)) {
        throw new RegistryInvalid(`effort.${key}`,
          `effort.${key} is "${value}", which "${target}" does not offer. It offers: `
          + `${row.efforts.join(', ')}.`);
      }
      effort[key] = value;
    }
    out.effort = effort;
  }
  if (baseUrl !== undefined) out.baseUrl = baseUrl;
  return out;
}

/** `(reg, catalogue) => string[]`. What discovery and classification operate
 *  on. `'catalogue'` resolves to the catalogue's VISIBLE ids — hidden Codex
 *  models are excluded (§4.2, decision 6) and reachable only by an explicit
 *  discovery entry. With no catalogue it resolves to NOTHING, never to
 *  "everything": never-probed is a state, and a list invented from the classed
 *  ids would make `unclassified` silently empty on exactly the lane nobody has
 *  ever looked at. An explicit list is returned as written. */
export function resolveDiscovery(reg, catalogue) {
  if (reg.discovery !== 'catalogue') return [...reg.discovery];
  if (catalogue === null || catalogue === undefined) return [];
  return catalogue.models.filter((m) => !m.hidden).map((m) => m.id);
}

function classIds(classes) {
  const out = [];
  for (const c of CLASSES) {
    const v = classes[c];
    if (v !== null && v !== undefined && !out.includes(v)) out.push(v);
  }
  return out;
}

/**
 * `(reg, catalogue) => DerivedModels` — the four derived states, from a lane's
 * registry and its catalogue (§4.3).
 *
 *  - `reg` nullish — no registry file — → every class unavailable. That is
 *    §13.1's migration state on a non-Anthropic lane, and it is deliberately
 *    not "all four": a lane nobody has seeded routes nowhere, and doctor says
 *    so. **An Anthropic lane is the CALLER's business** — see `availableFor`.
 *  - `retired` is computed only against a catalogue that EXISTS and is NOT
 *    stale. Absence from a catalogue nobody could refresh is not evidence.
 *    It is checked against BOTH the classed ids and the resolved discovery
 *    list — a hidden model discovered explicitly but no longer live must
 *    retire too, not only a classed one.
 *  - A retired id NEVER empties its slot. It stays classified, stays in the
 *    registry, and the class simply stops being available until the operator
 *    reassigns (§4.3, ruling 4).
 */
export function deriveModels(reg, catalogue) {
  if (reg === null || reg === undefined) {
    return { classified: [], unclassified: [], retired: [], available: [] };
  }
  const classified = classIds(reg.classes);
  const discovery = resolveDiscovery(reg, catalogue ?? null);
  const unclassified = discovery.filter((id) => !classified.includes(id));
  const retired = [];
  if (catalogue !== null && catalogue !== undefined && !catalogue.stale) {
    const live = new Set(catalogue.models.map((m) => m.id));
    for (const id of [...classified, ...discovery]) {
      if (!live.has(id) && !retired.includes(id)) retired.push(id);
    }
  }
  const available = CLASSES.filter((c) => {
    const id = reg.classes[c];
    return id !== null && id !== undefined && !retired.includes(id);
  });
  return { classified, unclassified, retired, available };
}

/**
 * `(reg, catalogue, anthropic: boolean) => ModelClass[]` — which classes
 * routing may use on this lane, the ONE implementation of "an Anthropic lane
 * has all four" (round-2 ruling 2).
 *
 * `anthropic` is a parameter and not a field because the roster on `main` has
 * no `exec.provider` to derive it from: `ExecSpec` is `upstream | generated |
 * external` and nothing more. Every caller computes it from the roster's own
 * declaration, `telemetry === 'anthropic'` (deviation B-3), in one place per
 * program. On such a lane the four classes are Claude Code's own defaults, the
 * registry file does not exist, and there is nothing to classify.
 */
export function availableFor(reg, catalogue, anthropic) {
  if (anthropic) return [...CLASSES];
  return deriveModels(reg, catalogue).available;
}

/** The four family tokens, in match order — an id is FABLE-class before it is
 *  opus-class, so a hybrid name resolves the way its most specific token says.
 *  Matched WITH their dashes: `opus` bare would classify `opusml/x`. Plan 2's
 *  `_session_class` implements the same rule in bash and is pinned against
 *  this one by that plan's agreement test. */
const FAMILY_TOKENS = [
  ['-fable-', 'fable'], ['-opus-', 'opus'], ['-sonnet-', 'sonnet'], ['-haiku-', 'haiku'],
];

/** `(anthropicModelId: string) => ModelClass | null` — first token wins. */
export function familyClassOf(anthropicModelId) {
  for (const [token, cls] of FAMILY_TOKENS) {
    if (anthropicModelId.includes(token)) return cls;
  }
  return null;
}

/** `(reg, modelId) => ModelClass | null`. Reverse lookup: which class does
 *  this lane route to `modelId`? The FIRST class in `CLASSES` order wins, so
 *  two slots holding one id resolve deterministically rather than by object
 *  key order. A `null` slot never matches — `classOfModel(reg, '')` is null,
 *  not "haiku". */
export function classOfModel(reg, modelId) {
  if (typeof modelId !== 'string' || modelId.length === 0) return null;
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

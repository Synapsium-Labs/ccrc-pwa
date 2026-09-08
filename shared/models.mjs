// shared/models.mjs — the registry, the catalogue and the derived states (§4)
// for the callers that run under a BARE `node`: `deploy/models-op.mjs`,
// `shared/modelenv.mjs`, and (Plan 2) the reader ccd shells out to. None of
// them can import `shared/models.ts` — no build step, no `tsx`, no compiled
// `dist/` — exactly `shared/wrapper.mjs`'s constraint in this tree.
//
// TWIN, NOT COPY. `server/test/models.test.ts` drives both over
// `server/test/fixtures/modelCases.ts` and compares them to EACH OTHER, so a
// change to either alone reds. The constants that must be duplicated —
// `CLASSES`, `PROBE_KINDS` and `MODEL_ID_RE` — are compared to the TypeScript
// SOURCE for source, not behaviourally, because the last constant hand-copied
// between these two languages shipped as raw control bytes with every suite
// green (`server/test/source-bytes.test.ts:5-15`).
//
// It imports nothing, not even `node:*`.

/** Mirrors `shared/models.ts`'s `CLASSES`, in the same order. */
const CLASSES = ['haiku', 'sonnet', 'opus', 'fable'];

/** Mirrors `shared/models.ts`'s `PROBE_KINDS`, in the same order. */
const PROBE_KINDS = ['codex', 'openrouter', 'compatible'];

/** Mirrors `shared/models.ts`'s `MODEL_ID_RE`, itself copied from the
 *  account-connections branch's `shared/roster.ts:97`. */
export const MODEL_ID_RE = /^[A-Za-z0-9][A-Za-z0-9._:\/-]{0,127}$/;

const REGISTRY_KEYS = ['probe', 'classes', 'subagent', 'discovery', 'effort', 'baseUrl'];

export class RegistryInvalid extends Error {
  constructor(field, message) {
    super(message);
    this.name = 'RegistryInvalid';
    this.field = field;
  }
}

export class CatalogueInvalid extends Error {
  constructor(message) { super(message); this.name = 'CatalogueInvalid'; }
}

const isObj = (v) => typeof v === 'object' && v !== null && !Array.isArray(v);
const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);

/** `(json: unknown) => Catalogue` — the same checks, the same order, the same
 *  filled defaults as `shared/models.ts`'s `parseCatalogue`. */
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

/** `(json: unknown, catalogue?: Catalogue | null) => Registry` — the same rules,
 *  in the same order, with the same field names on `RegistryInvalid`. */
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

/** `(reg, catalogue) => string[]` — visible ids for `'catalogue'`, the list as
 *  written otherwise, and EMPTY when there is no catalogue at all. */
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

/** `(reg, catalogue) => { classified, unclassified, retired, available }` */
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

/** `(reg, catalogue, anthropic: boolean) => ModelClass[]` — the one place
 *  "an anthropic lane has all four" lives. See the `.ts`'s comment for why the
 *  boolean is a parameter. */
export function availableFor(reg, catalogue, anthropic) {
  if (anthropic) return [...CLASSES];
  return deriveModels(reg, catalogue).available;
}

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

/** `(reg, modelId) => ModelClass | null` — first class in CLASSES order. */
export function classOfModel(reg, modelId) {
  if (typeof modelId !== 'string' || modelId.length === 0) return null;
  for (const c of CLASSES) {
    if (reg.classes[c] === modelId) return c;
  }
  return null;
}

export const UNAVAILABLE_PREFIX = 'ccrc-unavailable-';

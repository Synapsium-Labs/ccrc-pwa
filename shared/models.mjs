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

/** Fix round 1, v2 (2026-09-09 measurement): the subset of `CLASSES` a lane's
 *  `subagent` field, and so `CLAUDE_CODE_SUBAGENT_MODEL`, may name. Measured
 *  on a fleet host running Claude Code 2.1.267, on the gpt lane, in headless
 *  `-p` turns that call the Agent tool, with the env overridden per run:
 *   - `sonnet` runs the subagent on the sonnet slot's model, following that
 *     slot when it moves.
 *   - `haiku` runs the subagent on the haiku slot's model when that model is
 *     also `ANTHROPIC_SMALL_FAST_MODEL` — which the materialiser guarantees,
 *     since it writes `ANTHROPIC_SMALL_FAST_MODEL` as the haiku slot whenever
 *     that slot is non-null — and on the sonnet slot's model when the haiku
 *     default is pointed elsewhere.
 *   - `opus` and `fable` run the subagent on the sonnet slot's model
 *     regardless of their own slot's value.
 *   - Mechanism, from the client's own strings only (not measured further):
 *     an `availableModels` allowlist with a family step-down.
 *  Writing `opus` or `fable` would be a choice Claude Code silently overrides
 *  — the same shape as the null-slot refusal below — so this list carries
 *  only the two classes that are honoured. Fix round 2A (N1): `parseRegistry`
 *  does NOT gate on this list — a registry already on disk with `subagent`
 *  set to `opus`/`fable` (legal before this ruling) must stay READABLE, or
 *  every verb on that lane bricks the moment this ships. The refusal lives
 *  where a value is about to be ACTED on instead: `shared/modelenv.mjs`'s
 *  `modelEnvBlock` (the renderer) and `deploy/models-op.mjs`'s
 *  `set-subagent` (the verb) both gate on `SUBAGENT_CLASSES` and both name
 *  `ccrc models <id> set-subagent <haiku|sonnet>` as the remedy — a command
 *  the parse gate above lets run, since it only ever writes `haiku` or
 *  `sonnet`. This ruling is tied to Claude Code 2.1.267; lifting it needs a
 *  re-measurement of the opus/fable rows. */
export const SUBAGENT_CLASSES = Object.freeze(['haiku', 'sonnet']);

/** Same arrangement as `CLASSES` above, for `shared/models.ts`'s own
 *  `PROBE_KINDS`. */
export const PROBE_KINDS = ['codex', 'openrouter', 'compatible'];

/** A model id, as the account-connections branch defines it.
 *
 *  COPIED, not imported: that branch is not on `main` (ruling 280) and this
 *  design must not depend on it. Its origin is `shared/roster.ts:99` on branch
 *  `ws/gemini-subscription-account-connection`, whose own comment records the
 *  reason for the charset — an account id becomes a filename and a bash `case`
 *  pattern and so cannot hold `/`, `.` or `:`, while an OpenRouter model id is
 *  `anthropic/claude-opus-4.5:beta` and holds all three. Capped at 128
 *  characters. `server/test/models.test.ts` checks this literal against a
 *  pinned copy of the text, because the last regex hand-copied in this tree
 *  shipped as raw control bytes with every suite green. */
export const MODEL_ID_RE = /^[A-Za-z0-9][A-Za-z0-9._:\/-]{0,127}$/;

/** The lane-id shape `ccrc models` and `deploy/models-op.mjs` accept (C6),
 *  DEFINED ONCE, here (auto-advance plan W2 Task 7). The same shape as
 *  `shared/roster.ts`'s module-private ID_RE and the bash shape contract's
 *  WRAPPER_ID_RE: a lane id becomes a file name under ~/.ccrc/models and a
 *  directory under ~/.ccrc/codex, so it is lowercase letters, digits and "-"
 *  only, a letter first, 32 characters at most. `deploy/models-op.mjs`
 *  re-exports it as ACCOUNT_ID_RE; `deploy/models-canary.mjs` and the agent's
 *  `models` op validate against it before any path is built.
 *  `server/test/models-lane-id-parity.test.ts` holds the four spellings equal. */
export const MODELS_LANE_ID_RE = /^[a-z][a-z0-9-]{0,31}$/;

/** The two words `ccrc models <here> …` reads as box-wide subcommands, never as
 *  a lane id (deviation B-4): `ccd/ccrc`'s MODELS_RESERVED in bash, here for
 *  every node and TypeScript caller (the agent's `models` op refuses them as a
 *  lane). Pinned equal to the bash list by the same test. */
export const MODELS_RESERVED_IDS = Object.freeze(['refresh', 'litellm']);

/** The longest models notice `/api/notify` sends to the phone (auto-advance
 *  plan W2 Task 12). A CEILING, not a promise that every well-formed line
 *  fits: a `moved` line is at most a 32-character lane id, the longest class
 *  word, two 128-character model ids and the fixed text between them, which
 *  makes exactly 300, so it always fits (`server/test/notify-push.test.ts`
 *  holds that sum); the two failure lines carry a reason of up to 120
 *  characters on top of the same two ids, so with long ids they pass it. Such
 *  a line still gets its banner and is refused the phone push, with the reason
 *  `over-cap` in `modelsPushDecision`'s answer and one line in the server's
 *  log. The cap is not raised to make them fit. */
export const MODELS_PUSH_MAX = 300;

/** Whether `message` is a string longer than the cap: the ONE place the cap is compared, read by `modelsPushOf` (which
 *  refuses such a message) and by `modelsPushDecision` (which names that refusal `over-cap`), so the two can never
 *  disagree on a boundary. */
const overCap = (message) => typeof message === 'string' && message.length > MODELS_PUSH_MAX;

/** The lane, class and model-id patterns without their anchors, so the three
 *  shapes below are built from `MODELS_LANE_ID_RE`, `CLASSES` and
 *  `MODEL_ID_RE` and never spell any of them a second time; and the reason
 *  slot of the two failure shapes, written once: up to 120 printable-ASCII
 *  characters in brackets. */
const pushInner = (re) => re.source.replace(/^\^/, '').replace(/\$$/, '');
const PUSH_HEAD = `^(${pushInner(MODELS_LANE_ID_RE)}): (${CLASSES.join('|')}) `;
const PUSH_ID = `(?:${pushInner(MODEL_ID_RE)})`;
const PUSH_REASON = '\\([\\x20-\\x7e]{0,120}\\)';
const PUSH_SHAPES = Object.freeze([
  ['moved', new RegExp(`${PUSH_HEAD}${PUSH_ID} → ${PUSH_ID}$`)],
  ['canary-failed', new RegExp(`${PUSH_HEAD}stays on ${PUSH_ID}: ${PUSH_ID} failed its canary ${PUSH_REASON}$`)],
  ['move-failed', new RegExp(`${PUSH_HEAD}stays on ${PUSH_ID}: moving to ${PUSH_ID} failed ${PUSH_REASON}$`)],
]);

/** The ONE reader of the advance step's push lines (the auto-advance plan's
 *  `### 3.8 Push`, docs/superpowers/plans/2026-10-15-model-class-auto-advance-codex-arm.md;
 *  `ccd/ccrc`'s receipt program and its `recovered` definition write them):
 *  `{lane, cls, kind}` for a message of exactly one of the three shapes
 *    `<lane>: <class> <from|none> → <to>`                                        kind `moved`
 *    `<lane>: <class> stays on <from|none>: <to> failed its canary (<reason>)`   kind `canary-failed`
 *    `<lane>: <class> stays on <from|none>: moving to <to> failed (<reason>)`    kind `move-failed`
 *  and null for anything else: a `cc swap:` notice, a second line, a message
 *  that is not a string, and any message over MODELS_PUSH_MAX included. The
 *  lane is MODELS_LANE_ID_RE's, the class one of CLASSES, each model id
 *  MODEL_ID_RE's (`none` is one) and the reason printable ASCII of at most 120
 *  characters. It is a PARSER only: whether a line may reach a phone is
 *  `modelsPushDecision`'s, which calls it. */
export function modelsPushOf(message) {
  if (typeof message !== 'string' || overCap(message)) return null;
  for (const [kind, re] of PUSH_SHAPES) {
    const m = re.exec(message);
    if (m !== null) return { lane: m[1], cls: m[2], kind };
  }
  return null;
}

/** THE POLICY OF `POST /api/notify`'s `push: true` (auto-advance plan W2
 *  Task 12, D-5211): pure, no I/O, no Fastify, no push call. The box token
 *  proves only "a process on the fleet box" (`deploy/notify.sh`'s own header),
 *  so the route sends a message to the phone only when `modelsPushOf` reads it
 *  AND its lane is a row of `roster` whose `exec.kind` is `codex`. The roster
 *  arrives as a PARAMETER, anything with a `get(laneId)` that answers the
 *  lane's row or `undefined` (the server's `roster.byId`, a `ReadonlyMap`, is
 *  one), so this file reads no file and imports nothing.
 *
 *  Answers one of two shapes, and never a bare null: `{verdict: 'pushable',
 *  lane, cls, kind, tag}` or `{verdict: 'refused', reason}` with the reason one
 *  of
 *    `not-a-model-line`  no shape of `modelsPushOf` matched (or not a string)
 *    `over-cap`          longer than MODELS_PUSH_MAX, so `modelsPushOf` refused it
 *    `unknown-lane`      a model line of a lane the roster has no row for
 *    `not-a-codex-lane`  a model line of a row whose exec kind is not codex.
 *  The last two also carry the `lane` (grammar-checked, so safe to print), for
 *  the operator's remedy. The roster is asked only about a line that matched,
 *  once. The tag is per lane AND class (D-5212): a phone REPLACES a
 *  notification that carries the same tag (`pwa/public/push-sw.js`), so a
 *  constant tag would let a second move or failure in one run erase the first.
 *
 *  WHAT A PUSHABLE LINE CAN CARRY, stated exactly: the lane, the class and the
 *  model ids are grammar-checked, but a model id may be URL-shaped (`:` and `/`
 *  are in MODEL_ID_RE) and the reason slot of a failure line takes up to 120
 *  characters of ANY printable ASCII. So a box-token holder can put a sentence
 *  of up to 120 characters in the reason slot of a well-shaped failure line for
 *  a codex-kind lane and have it pushed under the title "Model classes"
 *  (attribution, not authentication); a models push also gets no feed record
 *  and no per-(lane, class) rate cap. That residual is accepted (D-5211). */
export function modelsPushDecision(message, roster) {
  const line = modelsPushOf(message);
  if (line === null) return { verdict: 'refused', reason: overCap(message) ? 'over-cap' : 'not-a-model-line' };
  const row = roster.get(line.lane);
  if (row === undefined) return { verdict: 'refused', reason: 'unknown-lane', lane: line.lane };
  if (row.exec.kind !== 'codex') return { verdict: 'refused', reason: 'not-a-codex-lane', lane: line.lane };
  return { verdict: 'pushable', lane: line.lane, cls: line.cls, kind: line.kind, tag: `models-advance:${line.lane}:${line.cls}` };
}

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
 *
 * READING IS NOT WRITING (fix round 2A, N1): `subagent` here is gated on
 * `CLASSES` alone, exactly as before the 2026-09-09 `SUBAGENT_CLASSES`
 * narrowing — a registry written under the earlier contract, with `subagent`
 * set to `opus` or `fable`, parses today exactly as it did then. Refusing it
 * HERE would brick every verb on that lane, including the one that repairs
 * it, the moment this file ships: `readRegistry` runs before any op dispatch
 * (`deploy/models-op.mjs`), so a parse-time refusal leaves no path forward but
 * a destructive `rm` or a hand edit. The narrowing is enforced only where a
 * value is about to be ACTED on: `shared/modelenv.mjs`'s `modelEnvBlock`
 * refuses to materialise an env block for `opus`/`fable`, and
 * `deploy/models-op.mjs`'s `set-subagent` refuses to WRITE one — both naming
 * `ccrc models <id> set-subagent <haiku|sonnet>` as the remedy, a command the
 * gate below lets run because it only ever writes `haiku` or `sonnet`.
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
        + "one of them: it is a FIELD naming which class subagents run as — haiku or sonnet; run "
        + "'ccrc models <id> set-subagent <haiku|sonnet>' to change it.");
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

/** The bounds of a measured context window, in tokens (codex-bridge spec
 *  §2.7: "an integer from 1,000 to 1,000,000"). `parseWindows` refuses a value
 *  outside them, `deploy/models-op.mjs`'s `set-window` refuses to write one,
 *  and `shared/modelenv.mjs`'s `contextWindowFor` caps at `WINDOW_MAX`. Defined
 *  here, once, and imported by every reader — never re-spelled. */
export const WINDOW_MIN = 1000;
export const WINDOW_MAX = 1000000;

/**
 * `(json: unknown) => ModelWindows` — a lane's MEASURED context windows, read
 * from `~/.ccrc/models/<id>.windows.json`:
 * `{"windows": {"<model id>": {"tokens": <integer>, "setAt": "<ISO-8601 UTC>"}}}`.
 * Returns a frozen, null-prototype object mapping each model id to its tokens.
 *
 * A SIBLING FILE, NOT A REGISTRY KEY (D-5160).
 * `parseRegistry` above refuses any key outside `REGISTRY_KEYS`, so a
 * `windows` key in `<id>.classes.json` would make an older ccrc, after a
 * rollback, refuse every lane's registry — and with it every verb on the
 * lane, the one that could remove the key included. An older ccrc never
 * opens this file, so its lanes fall back to the default window rule, the
 * safe direction.
 *
 * AND THE OPPOSITE POLICY ON UNKNOWN KEYS. The registry refuses them; this
 * file TOLERATES them, at the top level and inside every entry, because it is
 * forward-compatible by design (a later build may record more per model), and
 * `deploy/models-op.mjs`'s writer PRESERVES them by editing the raw parsed
 * object rather than this function's answer.
 *
 * What it refuses, naming the field the way `parseRegistry` does: a top level
 * that is not an object; a `windows` that is missing or not an object; a key
 * that is not a model id (`MODEL_ID_RE`, which refuses `__proto__` too); an
 * entry that is not an object; a `tokens` that is not an integer from
 * `WINDOW_MIN` to `WINDOW_MAX`; a `setAt` that is present and not a string.
 */
export function parseWindows(json) {
  if (!isObj(json)) {
    throw new RegistryInvalid('',
      'a windows file must be a JSON object: {"windows": {"<model id>": {"tokens": <integer>}}}.');
  }
  const raw = json['windows'];
  if (!isObj(raw)) {
    throw new RegistryInvalid('windows',
      `windows is missing or is not an object. It maps each model id to {"tokens": <integer from ${WINDOW_MIN} `
      + `to ${WINDOW_MAX}>}.`);
  }
  const out = Object.create(null);
  for (const [id, entry] of Object.entries(raw)) {
    if (!MODEL_ID_RE.test(id)) {
      throw new RegistryInvalid(`windows.${id}`,
        `windows has the key ${JSON.stringify(id)}, which is not a model id.`);
    }
    if (!isObj(entry)) {
      throw new RegistryInvalid(`windows.${id}`,
        `windows.${id} is ${JSON.stringify(entry)}: each entry is an object, {"tokens": <integer>}.`);
    }
    const tokens = entry['tokens'];
    if (typeof tokens !== 'number' || !Number.isInteger(tokens) || tokens < WINDOW_MIN || tokens > WINDOW_MAX) {
      throw new RegistryInvalid(`windows.${id}.tokens`,
        `windows.${id}.tokens is ${JSON.stringify(tokens)}: it must be an integer from ${WINDOW_MIN} to `
        + `${WINDOW_MAX}.`);
    }
    if (entry['setAt'] !== undefined && typeof entry['setAt'] !== 'string') {
      throw new RegistryInvalid(`windows.${id}.setAt`,
        `windows.${id}.setAt is ${JSON.stringify(entry['setAt'])}: when present it is an ISO-8601 time string.`);
    }
    out[id] = tokens;
  }
  return Object.freeze(out);
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
/** The ONE model-id → class table (routing spec §6: never a second list).
 *  Exported so the usage sweep's runner can hand it to the python scanner as
 *  data. */
export const FAMILY_TOKENS = [
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

// shared/modelenv.mjs — the materialiser's pure half (§6.1, §6.4, §7): a lane's
// class registry turned into the eight environment variables Claude Code reads,
// the THREE-column TSV ccd reads (Plan 2), and the effort map `ccgpt-proxy`
// reads per request.
//
// `.mjs` because every caller runs under a bare `node`: `deploy/models-op.mjs`
// (the verbs' node half) and, when the account-connections wave's settings-block
// writer lands, that writer too — its plan's Task 25 calls this function rather
// than growing a second copy. One writer of these bytes, pinned by
// `server/test/modelenv-single-writer.test.ts` because the single-definition
// scan filters `.tsx?` and is blind to a second `.mjs` writer.
//
// WHY THE SENTINEL EXISTS AT ALL, measured 2026-09-08 and recorded in spec §1:
// with `ANTHROPIC_DEFAULT_{HAIKU,SONNET,OPUS,FABLE}_MODEL` set, `--model
// <alias>` leaves the client as that value; UNSET, the alias falls through to
// Anthropic's own id and a proxied backend answers with an opaque 404. So a
// null slot is written as `ccrc-unavailable-<class>` rather than omitted: the
// failure then names what is missing. A settings-file `env` block also BEATS
// the shell env for the same variable (probed), which is why the wrapper's own
// exports become dead code once this block lands (§6.2).
//
// AND THE SENTINEL GOES NOWHERE ELSE. `classesTsv` never emits it; its third
// column is the positive availability marker every bash reader branches on.
// The EIGHTH key, `CLAUDE_CODE_MAX_CONTEXT_TOKENS` (spec §6.1, amended
// 2026-09-08), gets neither treatment: it is OMITTED, never sentinelled, when
// no measured window exists — there is no "unavailable" reading for a context
// size, only "unknown", and Claude Code's own 200k default already means
// "unknown" to the client. `CLAUDE_CODE_DISABLE_UNKNOWN_MODEL_WINDOW_
// ENFORCEMENT` is never set by this file or by anything this design writes:
// that proactive compaction is what keeps an unexpectedly large lane from
// hitting the provider's 400 ("input exceeds the context window").

import { readFileSync, writeFileSync, renameSync, unlinkSync } from 'node:fs';
import { CLASSES, UNAVAILABLE_PREFIX, deriveModels } from './models.mjs';

export class ModelEnvInvalid extends Error {
  constructor(message) { super(message); this.name = 'ModelEnvInvalid'; }
}

/** The client's default window for a model id it does not know (spec §6.1).
 *  `CLAUDE_CODE_MAX_CONTEXT_TOKENS` never exceeds this. */
export const CLIENT_DEFAULT_CONTEXT_TOKENS = 200000;

/** The eight keys `modelEnvBlock` can write, frozen so a caller iterates them
 *  rather than spelling them a second time. `clearSettingsEnv(path,
 *  MODEL_ENV_KEYS)` is `ccrc models <id> rm`'s whole settings step (spec §4.1
 *  Lifecycle, §10, §11) — the single-writer pin below counts this export as
 *  the one place these eight names originate, so a caller that respelled them
 *  would be a second definition and not merely a second writer. The eighth,
 *  `CLAUDE_CODE_MAX_CONTEXT_TOKENS`, is the one entry `modelEnvBlock` may
 *  OMIT from a given answer (§6.1 amendment) — `mergeSettingsEnv` below is
 *  what deletes it off a lane's settings when a re-materialise stops emitting
 *  it, which is why this list, and not just `modelEnvBlock`'s return value,
 *  is the set that function treats as its own. */
export const MODEL_ENV_KEYS = Object.freeze([
  'ANTHROPIC_DEFAULT_HAIKU_MODEL',
  'ANTHROPIC_DEFAULT_SONNET_MODEL',
  'ANTHROPIC_DEFAULT_OPUS_MODEL',
  'ANTHROPIC_DEFAULT_FABLE_MODEL',
  'ANTHROPIC_MODEL',
  'ANTHROPIC_SMALL_FAST_MODEL',
  'CLAUDE_CODE_SUBAGENT_MODEL',
  'CLAUDE_CODE_MAX_CONTEXT_TOKENS',
]);

const slot = (registry, cls) => {
  const v = registry.classes[cls];
  return typeof v === 'string' && v.length > 0 ? v : null;
};

/**
 * `(registry: Registry, catalogue: Catalogue | null) => Record<string, string>`
 * — the seven MANDATORY variables of §6.1, plus an eighth,
 * `CLAUDE_CODE_MAX_CONTEXT_TOKENS`, written only when `catalogue` can measure
 * it (§6.1, amended 2026-09-08).
 *
 * The two fallback chains STOP where §6.1 stops them, and that is deliberate:
 * `ANTHROPIC_MODEL` is opus ?? sonnet ?? haiku and `ANTHROPIC_SMALL_FAST_MODEL`
 * is haiku ?? sonnet, so neither ever reaches `fable`. A lane whose only class
 * were Fable would otherwise run every unqualified request — including the
 * small-fast ones — on the most expensive model it has. That lane is refused
 * instead, by the same guard that refuses an all-null registry.
 *
 * `CLAUDE_CODE_SUBAGENT_MODEL` is `classes[registry.subagent]` — the operator's
 * explicit class-to-slot choice (§4.1, ruling 5c), never `classes.sonnet` by
 * derivation. A subagent naming a null slot is REFUSED rather than sentinelled:
 * a sentinel there fails one subagent turn at a time, at the provider, with
 * nothing having said so when the lane was configured. `parseRegistry` refuses
 * the same shape; this is the second gate, for a caller that built a registry
 * object in memory rather than reading one off disk.
 *
 * `CLAUDE_CODE_MAX_CONTEXT_TOKENS` exists because Claude Code 2.1.263 assumes
 * a 200k window for any model id it does not know, and compacts proactively at
 * that window. It is written as `min(row.context, CLIENT_DEFAULT_CONTEXT_TOKENS)`,
 * NOT the row's own number (§6.1, amended 2026-09-08, Task 16c): a fleet-host
 * measurement found the catalogue's advertised context (272000 for the
 * GPT-5.6/6 tiers) is not the usable one — over 2,339 transcripts the largest
 * prompt ever accepted on gpt-5.6-sol was 196,341 tokens, with 30 refusals
 * past that wall — so the key may LOWER the client's default (a 128k model
 * like gpt-5.3-codex-spark must compact at 128k) but never RAISES it above
 * the default on an advertised number alone; raising above it needs a
 * MEASURED ceiling, a future registry field, not this one. It is written
 * ONLY when `catalogue` is non-null, NOT stale (§11: a stale catalogue is the
 * previous one kept after a failed probe, and a stale window is not a
 * measured one), lists the model `ANTHROPIC_MODEL` resolved to above, and
 * that row's `context` is a POSITIVE INTEGER (fix round 1, M2: zero, a
 * negative or a fractional value is not a measured window either) — every
 * other case OMITS the key (never a sentinel: there is no "unavailable"
 * reading for a context window, only "unknown", and the client's own default
 * already means "unknown"). The value is written as a STRING: every other
 * value in this block is one, env vars are always strings on the wire, and a
 * bare number here would be the one key that differs.
 * `CLAUDE_CODE_DISABLE_UNKNOWN_MODEL_WINDOW_ENFORCEMENT` is never written by
 * this function, or anywhere else in this design (§6.1): the proactive
 * compaction it would disable is what keeps a lane whose default model has no
 * measured window from hitting the provider's own 400 instead.
 *
 * @throws {ModelEnvInvalid} when no class among opus/sonnet/haiku is set, or
 *   when the subagent class's slot is null.
 */
export function modelEnvBlock(registry, catalogue) {
  const haiku = slot(registry, 'haiku');
  const sonnet = slot(registry, 'sonnet');
  const opus = slot(registry, 'opus');
  const fable = slot(registry, 'fable');
  const primary = opus ?? sonnet ?? haiku;
  if (primary === null) {
    throw new ModelEnvInvalid(
      'a lane needs at least one class among opus, sonnet and haiku: ANTHROPIC_MODEL cannot be '
      + 'derived, so every unqualified request on this lane would have no model at all');
  }
  const subagentClass = registry.subagent;
  if (!CLASSES.includes(subagentClass)) {
    throw new ModelEnvInvalid(
      `subagent is ${JSON.stringify(subagentClass)}, which is not one of ${CLASSES.join(', ')}`);
  }
  const subagentId = slot(registry, subagentClass);
  if (subagentId === null) {
    throw new ModelEnvInvalid(
      `subagent names "${subagentClass}", whose slot is null: CLAUDE_CODE_SUBAGENT_MODEL would be a `
      + 'sentinel and every subagent on this lane would fail at the provider, one turn at a time. '
      + `Assign ${subagentClass} a model, or point subagent at a class that has one.`);
  }
  const sentinel = (cls) => `${UNAVAILABLE_PREFIX}${cls}`;
  const block = {
    ANTHROPIC_DEFAULT_HAIKU_MODEL: haiku ?? sentinel('haiku'),
    ANTHROPIC_DEFAULT_SONNET_MODEL: sonnet ?? sentinel('sonnet'),
    ANTHROPIC_DEFAULT_OPUS_MODEL: opus ?? sentinel('opus'),
    ANTHROPIC_DEFAULT_FABLE_MODEL: fable ?? sentinel('fable'),
    ANTHROPIC_MODEL: primary,
    ANTHROPIC_SMALL_FAST_MODEL: haiku ?? sonnet ?? sentinel('haiku'),
    CLAUDE_CODE_SUBAGENT_MODEL: subagentId,
  };
  if (catalogue !== null && catalogue !== undefined && !catalogue.stale) {
    const row = catalogue.models.find((m) => m.id === primary);
    // A POSITIVE INTEGER only (fix round 1, M2): zero, a negative or a
    // fractional value is not a measured window — writing one of them
    // verbatim ("0", "-1", "131072.5") would put a number on disk with no
    // window it describes. The omit rule's existing reason applies
    // unchanged: there is no "unavailable" reading for a context window,
    // only "unknown", and the client's own default already means "unknown".
    if (row !== undefined && typeof row.context === 'number'
      && Number.isInteger(row.context) && row.context > 0) {
      // min(), not the row's own number (§6.1, amended 2026-09-08, Task 16c):
      // fleet-host measurement found the Codex catalogue's advertised
      // context_window (272000 for the GPT-5.6/6 tiers) is not the usable
      // one — over 2,339 transcripts the largest prompt ever ACCEPTED on
      // gpt-5.6-sol was 196,341 tokens, with 30 refusals past that wall — so
      // this key may LOWER the client's default (a 128k model still compacts
      // at 128k) but never RAISES it on an advertised number alone.
      block.CLAUDE_CODE_MAX_CONTEXT_TOKENS = String(Math.min(row.context, CLIENT_DEFAULT_CONTEXT_TOKENS));
    }
  }
  return block;
}

/**
 * `(settingsPath: string, block: Record<string,string>) => { changed: boolean }`
 *
 * ADD AND UPDATE for every key `block` carries; for the REST of `MODEL_ENV_KEYS`
 * — today, only `CLAUDE_CODE_MAX_CONTEXT_TOKENS` can be absent from a given
 * `block` — DELETE it if present. Every other key, owned by nobody this
 * function knows about, is never touched: `ccgpt`'s own `_sync_gpt_config`
 * mirrors an allow-list into this same file and is equally careful in the
 * other direction (measured, §1), and a lane's `settings.json` carries the
 * operator's own edits. The eighth key is the one exception because it alone
 * has no sentinel (§6.1 amendment): a catalogue going stale, or the lane's
 * default model changing to one with no measured context, must not leave a
 * STALE number on disk — omission from `block` has to reach the file as a
 * deletion, or a re-materialise could only ever add this key, never retract
 * it.
 *
 * A file that is not JSON, or whose top level is not an object, is a REFUSAL
 * and not an overwrite: the alternative is destroying a hand-edited settings
 * file to fix a model id.
 *
 * Written tmp + rename, this repo's rule for any file another process reads —
 * Claude Code reads this one at launch.
 *
 * @throws {ModelEnvInvalid}
 */
export function mergeSettingsEnv(settingsPath, block) {
  let json = {};
  let existed = false;
  try {
    const text = readFileSync(settingsPath, 'utf8');
    existed = true;
    try {
      json = JSON.parse(text);
    } catch (e) {
      throw new ModelEnvInvalid(
        `${settingsPath} is not valid JSON (${e.message}), so this run will not rewrite it. Fix the `
        + 'file by hand, then re-run — nothing was written.');
    }
  } catch (e) {
    if (e instanceof ModelEnvInvalid) throw e;
    if (e.code !== 'ENOENT') {
      throw new ModelEnvInvalid(`${settingsPath} could not be read: ${e.message}. Nothing was written.`);
    }
  }
  if (existed && (typeof json !== 'object' || json === null || Array.isArray(json))) {
    throw new ModelEnvInvalid(
      `${settingsPath} does not hold a JSON object, so it is not a Claude Code settings file. `
      + 'Nothing was written.');
  }
  const env = (typeof json.env === 'object' && json.env !== null && !Array.isArray(json.env))
    ? json.env : {};
  let changed = false;
  for (const [k, v] of Object.entries(block)) {
    if (env[k] !== v) { env[k] = v; changed = true; }
  }
  // The eighth key can drop OUT of `block` between two materialisations (a
  // catalogue going stale, or the default model changing to one with no
  // measured context). It carries no sentinel, so a STALE value left on disk
  // would misstate the window rather than merely go missing — this is the
  // one member of MODEL_ENV_KEYS this function ever deletes on its own, and
  // it never deletes a key `block` did not have the chance to name.
  for (const k of MODEL_ENV_KEYS) {
    if (!(k in block) && Object.prototype.hasOwnProperty.call(env, k)) {
      delete env[k];
      changed = true;
    }
  }
  if (json.env === undefined) { json.env = env; changed = true; }
  else json.env = env;
  if (!changed && existed) return { changed: false };
  const tmp = `${settingsPath}.${process.pid}.tmp`;
  try {
    writeFileSync(tmp, `${JSON.stringify(json, null, 2)}\n`, { mode: 0o600 });
    renameSync(tmp, settingsPath);
  } catch (e) {
    try { unlinkSync(tmp); } catch { /* the tmp may never have been created */ }
    throw new ModelEnvInvalid(`${settingsPath} could not be written: ${e.message}.`);
  }
  return { changed: true };
}

/**
 * `(settingsPath: string, keys: readonly string[]) => { changed: boolean }`
 *
 * `ccrc models <id> rm`'s whole settings step (spec §4.1 Lifecycle, §10, §11):
 * deletes exactly the given keys from a lane's settings `env`, and nothing
 * else. Other env keys are left untouched and every other top-level key is
 * left untouched too — the same "this lane owns its own settings" rule
 * `mergeSettingsEnv` keeps, in the other direction. An `env` left EMPTY by the
 * deletion is removed rather than kept as `{}`, so a fully-reaped lane's
 * settings file carries no trace of the block.
 *
 * A MISSING settings file is not an error: there is nothing to clear, nothing
 * is written, and `{ changed: false }` comes back — `rm` is idempotent, and a
 * second call against an already-reaped lane must be silent.
 *
 * Written tmp + rename, the same atomicity `mergeSettingsEnv` uses.
 *
 * @throws {ModelEnvInvalid} on a settings file that is not JSON, or whose top
 *   level is not an object — the same refusal `mergeSettingsEnv` makes, for
 *   the same reason: the alternative is destroying a hand-edited file to
 *   reap eight keys from it.
 */
export function clearSettingsEnv(settingsPath, keys) {
  let json;
  try {
    const text = readFileSync(settingsPath, 'utf8');
    try {
      json = JSON.parse(text);
    } catch (e) {
      throw new ModelEnvInvalid(
        `${settingsPath} is not valid JSON (${e.message}), so this run will not rewrite it. Fix the `
        + 'file by hand, then re-run — nothing was written.');
    }
  } catch (e) {
    if (e instanceof ModelEnvInvalid) throw e;
    if (e.code === 'ENOENT') return { changed: false };
    throw new ModelEnvInvalid(`${settingsPath} could not be read: ${e.message}. Nothing was written.`);
  }
  if (typeof json !== 'object' || json === null || Array.isArray(json)) {
    throw new ModelEnvInvalid(
      `${settingsPath} does not hold a JSON object, so it is not a Claude Code settings file. `
      + 'Nothing was written.');
  }
  const env = (typeof json.env === 'object' && json.env !== null && !Array.isArray(json.env))
    ? json.env : {};
  let changed = false;
  for (const k of keys) {
    if (Object.prototype.hasOwnProperty.call(env, k)) { delete env[k]; changed = true; }
  }
  if (!changed) return { changed: false };
  if (Object.keys(env).length === 0) delete json.env;
  else json.env = env;
  const tmp = `${settingsPath}.${process.pid}.tmp`;
  try {
    writeFileSync(tmp, `${JSON.stringify(json, null, 2)}\n`, { mode: 0o600 });
    renameSync(tmp, settingsPath);
  } catch (e) {
    try { unlinkSync(tmp); } catch { /* the tmp may never have been created */ }
    throw new ModelEnvInvalid(`${settingsPath} could not be written: ${e.message}.`);
  }
  return { changed: true };
}

/**
 * `(registry: Registry, catalogue: Catalogue | null) => { byModel: Record<string,string> }`
 *
 * The lane's default effort per class, re-keyed BY MODEL ID so `ccgpt-proxy`
 * can answer a request from the body's own `model` field and never parse the
 * registry (§6.4).
 *
 * A level the catalogue positively contradicts is DROPPED rather than written:
 * Luna has no `ultra` and Astra does, and a lane default the provider rejects
 * turns every turn on that class into a 400. "Positively contradicts" is the
 * whole rule — an ABSENT catalogue, or a model listed with an EMPTY `efforts`
 * (every OpenRouter and `compatible` row), leaves the level alone, because
 * unknown is not "none offered". §4.1 states the same asymmetry for the
 * validator: accepted unvalidated, flagged by doctor once a catalogue appears.
 */
export function effortFile(registry, catalogue) {
  const byModel = {};
  const effort = registry.effort ?? {};
  const byId = new Map(((catalogue && catalogue.models) || []).map((m) => [m.id, m]));
  for (const cls of CLASSES) {
    const id = slot(registry, cls);
    const level = effort[cls];
    if (id === null || typeof level !== 'string' || level.length === 0) continue;
    const row = byId.get(id);
    if (row !== undefined && row.efforts.length > 0 && !row.efforts.includes(level)) continue;
    byModel[id] = level;
  }
  return { byModel };
}

/**
 * `(registry: Registry, catalogue: Catalogue | null) => string` — four lines in
 * `CLASSES` order, `<class>\t<modelId>\t<state>`, with
 * `state ∈ assigned | unassigned | retired`, and a trailing newline.
 *
 * THREE COLUMNS, because availability is its own marker and is never inferred
 * from an empty field (round-2 ruling 6). A retired class keeps its model id in
 * column 2 — the roster is the operator's and retirement does not empty a slot
 * (§4.3) — and column 3 is what Plan 2's `_lane_classes` reads. The second
 * field is empty EXACTLY when the state is `unassigned`, which is the invariant
 * a `cut -f2` reader depends on.
 *
 * Four lines always, even on an unseeded registry: a fixed line count is what
 * lets a bash reverse lookup answer "no class holds this id" without deciding
 * whether a short file means "not classified" or "not written yet".
 *
 * The sentinel never appears here. It lives in the env block, in a sink.
 */
export function classesTsv(registry, catalogue) {
  const retired = new Set(deriveModels(registry, catalogue ?? null).retired);
  return `${CLASSES.map((c) => {
    const id = slot(registry, c);
    if (id === null) return `${c}\t\tunassigned`;
    return `${c}\t${id}\t${retired.has(id) ? 'retired' : 'assigned'}`;
  }).join('\n')}\n`;
}

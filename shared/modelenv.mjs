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
// The EIGHTH key, `CLAUDE_CODE_MAX_CONTEXT_TOKENS` (`contextWindowFor` below:
// the model-class-registry spec §6.1, amended 2026-09-08 and again by the
// codex-bridge spec §2.7), gets neither treatment: it is OMITTED, never
// sentinelled, when neither the measured rule nor the default rule yields a
// window — there is no "unavailable" reading for a context size, only
// "unknown", and Claude Code's own 200k default already means "unknown" to the
// client. `CLAUDE_CODE_DISABLE_UNKNOWN_MODEL_WINDOW_ENFORCEMENT` is never set
// by this file or by anything this design writes: that proactive compaction is
// what keeps an unexpectedly large lane from hitting the provider's 400
// ("input exceeds the context window").

import { readFileSync, writeFileSync, renameSync, unlinkSync, statSync } from 'node:fs';
import {
  CLASSES, SUBAGENT_CLASSES, UNAVAILABLE_PREFIX, WINDOW_MAX, WINDOW_MIN, deriveModels,
} from './models.mjs';

export class ModelEnvInvalid extends Error {
  constructor(message) { super(message); this.name = 'ModelEnvInvalid'; }
}

/** A LANE FILE's read, type-tested first: the ONE definition. Plan 3a's
 *  final fix wave (MF-2) wrote it in `deploy/models-op.mjs`; Plan 3b Task A6
 *  moved it here so this module's own two `settings.json` reads use it too,
 *  and `deploy/models-op.mjs` imports it (`single-definition.test.ts` pins
 *  one definition). `readFileSync` opens BY NAME with no regard for TYPE: a
 *  FIFO with no writer blocks INSIDE the open, so no `catch` ever runs, and
 *  `ccrc doctor`'s `_check_codex` and `--fix`'s `_fix_codex`, which call the
 *  op with no deadline, hang whole. So the type is asked first. `statSync`
 *  FOLLOWS links, as bash `-f` does: a symlink to a regular file reads as
 *  before, and an absent path or a dangling link throws ENOENT exactly as
 *  the bare read did. Anything that is not a regular file throws `ENOTREG`,
 *  which every caller's existing non-ENOENT arm answers as that read's own
 *  unreadable answer, never a block. */
export function readRegular(p) {
  if (!statSync(p).isFile()) throw Object.assign(new Error('not a regular file'), { code: 'ENOTREG' });
  return readFileSync(p, 'utf8');
}

/** The client's default window for a model id it does not know (spec §6.1).
 *  The DEFAULT window rule never writes more than this; only a measured window
 *  (`contextWindowFor`, codex-bridge spec §2.7) may. */
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

/** `ANTHROPIC_MODEL`'s chain, opus ?? sonnet ?? haiku (§6.1), spelled ONCE:
 *  `modelEnvBlock` writes the model it names, and the default window rule
 *  reads that model's catalogue row. It never reaches `fable` — see
 *  `modelEnvBlock` for why. */
const primaryModel = (registry) => slot(registry, 'opus') ?? slot(registry, 'sonnet') ?? slot(registry, 'haiku');

/** A measured window is rounded DOWN to a multiple of this (codex-bridge spec
 *  §2.7: "rounded down to 1k"). */
const WINDOW_STEP = 1000;

/** The DEFAULT rule's number, or null when it has none: the 2026-09-08
 *  amendment's code, moved here unchanged from `modelEnvBlock` so the two rules
 *  sit side by side. Written ONLY when `catalogue` is non-null, NOT stale (§11:
 *  a stale catalogue is the previous one kept after a failed probe), lists the
 *  model `ANTHROPIC_MODEL` resolves to, and that row's `context` is a POSITIVE
 *  INTEGER. */
function catalogueWindow(registry, catalogue) {
  if (catalogue === null || catalogue === undefined || catalogue.stale) return null;
  const primary = primaryModel(registry);
  const row = catalogue.models.find((m) => m.id === primary);
  // A POSITIVE INTEGER only (fix round 1, M2): zero, a negative or a
  // fractional value is not a window — writing one of them verbatim ("0",
  // "-1", "131072.5") would put a number on disk with no window it describes.
  if (row !== undefined && typeof row.context === 'number'
    && Number.isInteger(row.context) && row.context > 0) {
    // min(), not the row's own number (§6.1, amended 2026-09-08): an
    // ADVERTISED context may lower the client's 200k default (a 128k model
    // still compacts at 128k) but never raises it. Raising is the measured
    // rule's job, never an advertised number's.
    return Math.min(row.context, CLIENT_DEFAULT_CONTEXT_TOKENS);
  }
  return null;
}

/**
 * `(registry, catalogue, windows) => { tokens, rule, unmeasured }` — the eighth
 * key, `CLAUDE_CODE_MAX_CONTEXT_TOKENS`, decided ONCE (the model-class-registry
 * spec §6.1, as amended by the codex-bridge spec §2.7). `modelEnvBlock` writes
 * `tokens` as a string, or omits the key when it is null, and `ccrc models <id>
 * show` reports all three fields. The key exists because Claude Code assumes a
 * 200k window for any model id it does not know and compacts proactively at
 * that window; the key replaces that assumption for EVERY model in the
 * session, subagents and quick tasks included.
 *
 * THE MEASURED RULE (`rule: 'measured'`). The lane's class models are the
 * distinct non-null slots among haiku, sonnet, opus and fable. When every one
 * of them has a measured window in `windows` (the lane's sibling windows file,
 * read by `parseWindows` in `shared/models.mjs`), the key is the SMALLEST of
 * them, rounded down to a multiple of 1000 and capped at `WINDOW_MAX`: Claude
 * Code applies the one value to every model in the session, so the smallest is
 * the only safe one. The rule reads no catalogue: a measured window is a fact
 * the operator measured about the backend, not a number a catalogue
 * advertised, so it holds whether the catalogue is fresh, stale or absent. A
 * window for a model no class names is ignored. An empty set of class models
 * (an unseeded registry) is never "every one measured". A value built in
 * memory that is not an integer, or is below `WINDOW_MIN`, counts as
 * unmeasured: `parseWindows` refuses both on disk, and this function never
 * writes a window of that shape, whoever built the object.
 *
 * THE DEFAULT RULE (`rule: 'default'`, or `'none'` when it yields nothing),
 * unchanged from 2026-09-08: when any class model has no measured window, or
 * there is no windows reading at all, the key is `catalogueWindow`'s
 * `min(catalogue context, 200000)` for `ANTHROPIC_MODEL`'s model, or OMITTED —
 * never sentinelled: there is no "unavailable" reading for a window, only
 * "unknown", and the client's own default already means "unknown". A class
 * that moves to a new model, by hand or by auto-advance, therefore falls back
 * here until the new model is measured.
 *
 * THE PREMISE THE MEASURED RULE REPLACES. The default rule's 200k cap was
 * first argued from a "196k wall", the largest prompt one home had ever had
 * accepted, in one July sample. A whole-fleet scan on 2026-10-15 withdrew it
 * (codex-bridge spec §1.2): prompts of 548,799 and 584,415 tokens had been
 * accepted on two different models in September, the six context refusals on
 * record sat near 373k and moved over time, and every model the lanes'
 * classes name accepted about 512k in a stepped probe that day. The cap stays
 * only where nothing is measured.
 *
 * `unmeasured` lists the class models with no measured window, distinct and in
 * `CLASSES` order. It is empty when `rule` is `measured`, and on an unseeded
 * registry.
 */
export function contextWindowFor(registry, catalogue, windows) {
  const models = [];
  for (const cls of CLASSES) {
    const id = slot(registry, cls);
    if (id !== null && !models.includes(id)) models.push(id);
  }
  const measuredOf = (id) => {
    if (windows === null || windows === undefined || !Object.prototype.hasOwnProperty.call(windows, id)) {
      return null;
    }
    const v = windows[id];
    return typeof v === 'number' && Number.isInteger(v) && v >= WINDOW_MIN ? v : null;
  };
  const unmeasured = models.filter((id) => measuredOf(id) === null);
  if (models.length > 0 && unmeasured.length === 0) {
    const least = Math.min(...models.map(measuredOf));
    return { tokens: Math.min(Math.floor(least / WINDOW_STEP) * WINDOW_STEP, WINDOW_MAX), rule: 'measured', unmeasured };
  }
  const tokens = catalogueWindow(registry, catalogue);
  return { tokens, rule: tokens === null ? 'none' : 'default', unmeasured };
}

/**
 * `(registry: Registry, catalogue: Catalogue | null, windows?: ModelWindows | null) => Record<string, string>`
 * — the seven MANDATORY variables of §6.1, plus an eighth,
 * `CLAUDE_CODE_MAX_CONTEXT_TOKENS`, written whenever `contextWindowFor` yields
 * a window (§6.1, amended 2026-09-08 and by the codex-bridge spec §2.7).
 *
 * The two fallback chains STOP where §6.1 stops them, and that is deliberate:
 * `ANTHROPIC_MODEL` is opus ?? sonnet ?? haiku and `ANTHROPIC_SMALL_FAST_MODEL`
 * is haiku ?? sonnet, so neither ever reaches `fable`. A lane whose only class
 * were Fable would otherwise run every unqualified request — including the
 * small-fast ones — on the most expensive model it has. That lane is refused
 * instead, by the same guard that refuses an all-null registry.
 *
 * `CLAUDE_CODE_SUBAGENT_MODEL` is written as `registry.subagent` itself — the
 * class ALIAS, `haiku` or `sonnet` only — never `classes[registry.subagent]`,
 * the model id that alias resolves to, and never `opus` or `fable`. Measured
 * 2026-09-09 on a fleet host running Claude Code 2.1.267, on the gpt lane, in
 * headless `-p` turns that call the Agent tool with the env overridden per
 * run (`--settings` on top of the materialised block; "ran on" read from the
 * result's `modelUsage`):
 *   - A model id in this key is ignored; the subagent runs on
 *     `ANTHROPIC_SMALL_FAST_MODEL` instead.
 *   - `sonnet` runs the subagent on the sonnet slot's model, following that
 *     slot when it moves.
 *   - `haiku` runs the subagent on the haiku slot's model when that model is
 *     also `ANTHROPIC_SMALL_FAST_MODEL` — which this materialiser guarantees,
 *     since `ANTHROPIC_SMALL_FAST_MODEL` is written as the haiku slot
 *     whenever that slot is non-null — and on the sonnet slot's model when
 *     the haiku default is pointed elsewhere.
 *   - `opus` and `fable` run the subagent on the sonnet slot's model
 *     regardless of their own default.
 *   - Mechanism, from the client's own strings only (not measured further):
 *     an `availableModels` allowlist with a family step-down.
 * Writing the id, as this function used to, meant every subagent on the gpt
 * lane ran on the haiku-class model regardless of the operator's `subagent`
 * choice. Writing `opus` or `fable` would silently run every subagent on the
 * sonnet-class model regardless of the operator's choice instead — a choice
 * Claude Code would silently override, the same shape as the null-slot case
 * below — so this function gates on `SUBAGENT_CLASSES` (`shared/models.mjs`,
 * `haiku` and `sonnet` only) and REFUSES TO MATERIALISE an env block naming
 * `opus` or `fable`, rather than letting an operator discover the override
 * one subagent turn at a time. This ruling is tied to Claude Code 2.1.267;
 * lifting it needs a re-measurement of the opus/fable rows.
 * Fix round 2A (N1): this is a RENDER-time refusal, not a parse-time one —
 * `parseRegistry` (`shared/models.mjs`) gates `subagent` on `CLASSES` alone,
 * so a registry already on disk with `subagent: 'opus'`/`'fable'` (legal
 * before 2026-09-09) still PARSES; it is this function, and
 * `deploy/models-op.mjs`'s `set-subagent`, that refuse it, each naming
 * `ccrc models <accountId> set-subagent <haiku|sonnet>` as the remedy. Two
 * gates guard the field in order: a value outside `CLASSES` entirely (a
 * typo, or garbage) is refused first, with the vocabulary; a value that IS a
 * class but not one `SUBAGENT_CLASSES` allows gets the measured sentence
 * above — so a typo is never answered with an explanation about opus/fable.
 * A subagent naming a null slot is still REFUSED rather than sentinelled: an
 * alias resolving through a sentinel would fail one subagent turn at a time,
 * at the provider, with nothing having said so when the lane was configured.
 * `parseRegistry` refuses the same shape; this is the second gate, for a
 * caller that built a registry object in memory rather than reading one off
 * disk.
 *
 * `CLAUDE_CODE_MAX_CONTEXT_TOKENS` is `contextWindowFor(registry, catalogue,
 * windows)`'s answer: the smallest measured window when every class model has
 * one, else the default rule, else omitted. That function's docstring carries
 * both rules and the premise the measured one replaced. It is written as a
 * STRING: every other value in this block is one, env vars are always strings
 * on the wire, and a bare number here would be the one key that differs.
 * `windows` is the lane's measured windows (`parseWindows`) or null; null, the
 * default, gives exactly the block this function wrote before measured windows
 * existed. `CLAUDE_CODE_DISABLE_UNKNOWN_MODEL_WINDOW_ENFORCEMENT` is never
 * written by this function, or anywhere else in this design (§6.1): the
 * proactive compaction it would disable is what keeps a lane whose window is
 * set wrong from hitting the provider's own 400 instead.
 *
 * @throws {ModelEnvInvalid} when no class among opus/sonnet/haiku is set, or
 *   when the subagent class's slot is null.
 */
export function modelEnvBlock(registry, catalogue, windows = null) {
  const haiku = slot(registry, 'haiku');
  const sonnet = slot(registry, 'sonnet');
  const opus = slot(registry, 'opus');
  const fable = slot(registry, 'fable');
  const primary = primaryModel(registry);
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
  if (!SUBAGENT_CLASSES.includes(subagentClass)) {
    throw new ModelEnvInvalid(
      `subagent is ${JSON.stringify(subagentClass)}: it must be haiku or sonnet. Measured 2026-09-09 on `
      + `Claude Code 2.1.267, a subagent set to opus or fable runs on the sonnet slot's model `
      + `regardless. Run 'ccrc models <accountId> set-subagent <haiku|sonnet>'.`);
  }
  const subagentId = slot(registry, subagentClass);
  if (subagentId === null) {
    throw new ModelEnvInvalid(
      `subagent names "${subagentClass}", whose slot is null: CLAUDE_CODE_SUBAGENT_MODEL would resolve `
      + 'to a sentinel and every subagent on this lane would fail at the provider, one turn at a time. '
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
    CLAUDE_CODE_SUBAGENT_MODEL: subagentClass,
  };
  // The eighth key: ONE decision, `contextWindowFor`'s, which `show` reports
  // too. Omitted, never sentinelled, when it yields no window.
  const room = contextWindowFor(registry, catalogue, windows);
  if (room.tokens !== null) block.CLAUDE_CODE_MAX_CONTEXT_TOKENS = String(room.tokens);
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
    // Type-tested (Plan 3b Task A6): a FIFO is "could not be read", never a block.
    const text = readRegular(settingsPath);
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
    // Type-tested (Plan 3b Task A6): a FIFO is "could not be read", never a block.
    const text = readRegular(settingsPath);
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

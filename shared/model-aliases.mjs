// shared/model-aliases.mjs — the model-class ANTHROPIC ARM's pure rules (plan
// docs/superpowers/plans/2026-11-18-model-class-advance-anthropic-arm.md, wave A2; spec
// docs/superpowers/specs/2026-10-13-model-class-auto-advance-design.md §2.5): Claude Code's own alias resolution is the
// source of truth for which model id each class names on an Anthropic lane. This file reads its catalogue cache
// (Task A2.1) and resolves each class's id from the newest evidence (Task A2.2). ONE implementation plus a
// hand-written `.d.mts`, `shared/model-advance.mjs`'s arrangement.
//
// PURE. It imports `./models.mjs` and `./model-advance.mjs` (for `isoSeconds`, the one writer of the whole-second time
// form) and nothing else, not even `node:*`; it reads no file and no clock (`nowMs` is an input). It SPELLS NO CLASS
// WORD and no model id, in code or prose: the classes come from `CLASSES`, the family of an id from `familyClassOf`,
// and every id from data.
import { CLASSES, MODEL_ID_RE } from './models.mjs';
import { isoSeconds } from './model-advance.mjs';

const isObj = (v) => typeof v === 'object' && v !== null && !Array.isArray(v);
const isStr = (v) => typeof v === 'string' && v.length > 0;

/** The suffix Claude Code puts on an id to mark a 1M-context session. */
const LONG_CONTEXT_SUFFIX = '[1m]';

/** `(raw) => bare`: ONE trailing `[1m]` removed (Claude Code's mark of a 1M-context session), nothing else: a second
 *  one stays, and one inside the id is not a suffix. The JS reader of that suffix for every id ccrc compares or
 *  records; `ccd/lib/model-aliases.sh`'s `_model_id_bare_to` is its bash twin (two readers, two processes), and
 *  `server/test/fixtures/model-id-bare.json` holds the two equal. */
export function bareModelId(raw) {
  return raw.endsWith(LONG_CONTEXT_SUFFIX) ? raw.slice(0, -LONG_CONTEXT_SUFFIX.length) : raw;
}

// ── THE CATALOGUE CACHE (Task A2.1) ─────────────────────────────────────────────────────────────────────────────────
// A cache file's CURRENT format carries `catalog.config.provider_alias_targets` (each class key's `.default` is the id
// its alias resolves to) and `catalog.config.models[]` (the rows). An OLDER file has rows and no alias targets, so it
// can never say what an alias resolves to. `fetchedAt` is epoch milliseconds in the current format; it is read into the
// whole-second ISO form the aliases file uses (`isoSeconds`), and an ISO string is accepted too.

const VERSION_RE = /^\d+(?:\.\d+)*$/;

/** `(v) => 'YYYY-MM-DDTHH:MM:SSZ' | null`: an epoch in ms (a number), or an ISO time string, in the whole-second form. */
function fetchedIso(v) {
  if (typeof v === 'number') return Number.isFinite(v) ? isoSeconds(Math.floor(v)) : null;
  if (typeof v === 'string') {
    const ms = Date.parse(v);
    return Number.isNaN(ms) ? null : isoSeconds(ms);
  }
  return null;
}

/** The row of one model: `efforts` is `[]` only when the row SAYS the model takes none (`thinking.type` "none"), the
 *  row's own list when it has one, and `null` when it carries no effort field at all. The two are never folded
 *  (D-8750). Throws a string naming the field when a field is present and unusable. */
function readRow(m, f) {
  if (!isObj(m)) throw new Error(`${f} is not an object`);
  if (typeof m.id !== 'string') throw new Error(`${f}.id is not a string`);
  const id = bareModelId(m.id);
  if (!MODEL_ID_RE.test(id)) throw new Error(`${f}.id is not a model id`);
  const runtime = isObj(m.runtime) ? m.runtime : {};
  const thinking = isObj(m.thinking) ? m.thinking : {};
  let efforts = null;
  if (thinking.type === 'none') efforts = [];
  else if (Array.isArray(runtime.effort_levels) && runtime.effort_levels.every(isStr)) efforts = [...runtime.effort_levels];
  let minVersion = null;
  if (m.min_claude_code_version !== undefined && m.min_claude_code_version !== null) {
    if (typeof m.min_claude_code_version !== 'string' || !VERSION_RE.test(m.min_claude_code_version)) {
      throw new Error(`${f}.min_claude_code_version is not a version`);
    }
    minVersion = m.min_claude_code_version;
  }
  return {
    id,
    label: isStr(m.name) ? m.name : null,
    efforts,
    defaultEffort: isStr(runtime.default_effort) ? runtime.default_effort : null,
    minVersion,
  };
}

/** `(json) => CacheReading`: one cache file's parsed JSON. `{format:'current', fetchedAt, aliasTargets, rows}` when it
 *  carries alias targets (a class its map does not name has a null target; a target with no row keeps the target and
 *  has no entry in `rows`), `{format:'older', fetchedAt}` when it does not (`fetchedAt` null when unreadable: the file
 *  is never a source), and `{format:'invalid', why}` for anything that is not a cache file or breaks a field. */
export function parseCatalogueCache(json) {
  if (!isObj(json)) return { format: 'invalid', why: 'a catalogue cache is a JSON object' };
  if (!isObj(json.catalog) || !isObj(json.catalog.config)) {
    return { format: 'invalid', why: 'catalog.config is missing or is not an object' };
  }
  const config = json.catalog.config;
  const fetchedAt = fetchedIso(json.fetchedAt);
  if (!isObj(config.provider_alias_targets)) return { format: 'older', fetchedAt };
  if (fetchedAt === null) return { format: 'invalid', why: 'fetchedAt is not a time' };
  const targets = config.provider_alias_targets;
  const aliasTargets = {};
  try {
    for (const c of CLASSES) {
      const entry = targets[c];
      const raw = isObj(entry) ? entry.default : undefined;
      if (raw === undefined || raw === null) { aliasTargets[c] = null; continue; }
      const id = typeof raw === 'string' ? bareModelId(raw) : '';
      if (!MODEL_ID_RE.test(id)) throw new Error(`provider_alias_targets.${c}.default is not a model id`);
      aliasTargets[c] = id;
    }
    const rows = new Map();
    const models = config.models === undefined ? [] : config.models;
    if (!Array.isArray(models)) throw new Error('models is not a list');
    models.forEach((m, i) => {
      const row = readRow(m, `models[${i}]`);
      if (!rows.has(row.id)) rows.set(row.id, row);
    });
    return { format: 'current', fetchedAt, aliasTargets, rows };
  } catch (e) {
    return { format: 'invalid', why: e instanceof Error ? e.message : String(e) };
  }
}

/** `(readings) => CacheReading | null`: the newest `current` reading by `fetchedAt` (the first of equals), `null` when
 *  none is current. An older-format or invalid reading is never the answer, newer or not. */
export function newestCache(readings) {
  let best = null;
  for (const r of readings) {
    if (r.format !== 'current') continue;
    if (best === null || r.fetchedAt > best.fetchedAt) best = r;
  }
  return best;
}

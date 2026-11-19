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
import { CLASSES, MODEL_ID_RE, familyClassOf } from './models.mjs';
import { compareVersions, isoSeconds } from './model-advance.mjs';

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

// ── THE RESOLVER (Task A2.2) ────────────────────────────────────────────────────────────────────────────────────────
// Per class, the id Claude Code's alias resolves to, from the NEWEST evidence (D-8744): the lane's own cache's target
// (dated by its `fetchedAt`) or the kept reading of a fresh alias launch (dated by the process start). An id only ever
// moves to newer evidence: a candidate no newer than the evidence the class's current id rests on never replaces it.

/** The aliases file's format version (`v`). */
export const ALIASES_VERSION = 1;
/** A cache fetched more than this long before `nowMs` is stale: seven days (D-8745), by its own `fetchedAt`, never by
 *  the cache's `staleAt`, which lapses within the hour while Claude Code keeps launching over it. */
export const CACHE_STALE_AFTER_MS = 604_800_000;

const AT_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/;
const isAt = (v) => typeof v === 'string' && AT_RE.test(v);

/** `(version) => number[] | null`: a dotted version as integers; null for anything else (an unreadable build). */
function versionParts(v) {
  return typeof v === 'string' && VERSION_RE.test(v) ? v.split('.').map(Number) : null;
}

/** Whether a row can be launched by a build of `laneVersion`: a row naming no minimum always can (a target with no
 *  row has none); one naming a minimum cannot when the build is unreadable, and otherwise when the build is below it. */
function launchable(row, laneVersion) {
  if (row === null || row.minVersion === null) return true;
  const lane = versionParts(laneVersion);
  return lane !== null && compareVersions(versionParts(row.minVersion), lane) <= 0;
}

/** The current-format readings, newest first (equal times keep their order). */
const currentsNewestFirst = (readings) => readings
  .filter((r) => r.format === 'current')
  .sort((a, b) => (a.fetchedAt < b.fetchedAt ? 1 : a.fetchedAt > b.fetchedAt ? -1 : 0));

/** The newest reading that is a cache at all (current or older format), by `fetchedAt` (an unreadable one is oldest),
 *  a current one before an older one of the same time. Null when there is none. */
function newestOwnReading(own) {
  let best = null;
  for (const r of own) {
    if (r.format === 'invalid') continue;
    if (best === null) { best = r; continue; }
    const a = r.fetchedAt ?? '';
    const b = best.fetchedAt ?? '';
    if (a > b || (a === b && r.format === 'current' && best.format === 'older')) best = r;
  }
  return best;
}

/** The row of `id` as a plain object, and where it came from: the lane's own cache first (any own current file, the
 *  newest first), else the newest box cache that lists it. A box reading's targets are never read, only its rows. */
function findRow(id, own, box) {
  for (const r of currentsNewestFirst(own)) {
    const row = r.rows.get(id);
    if (row !== undefined) return { row: plainRow(row), from: 'own' };
  }
  for (const r of currentsNewestFirst(box)) {
    const row = r.rows.get(id);
    if (row !== undefined) return { row: plainRow(row), from: 'box' };
  }
  return { row: null, from: null };
}
const plainRow = (r) => ({ ...r, efforts: r.efforts === null ? null : [...r.efforts] });

/** The saved level of a home under an id of the class's family other than the class's current id, when the home has
 *  none under the current one. The greatest such id, so the answer does not depend on key order. */
function orphanedOf(cls, id, saved) {
  if (id === null) return null;
  let found = null;
  for (const [raw, level] of Object.entries(saved)) {
    const bare = bareModelId(raw);
    if (bare === id) return null;
    if (!isStr(level) || familyClassOf(bare) !== cls) continue;
    if (found === null || bare > found.id) found = { id: bare, level };
  }
  return found;
}

/** `(input) => Aliases`: the aliases file's content for one lane, from the evidence in hand. Pure; the caller reads the
 *  cache files, the launch markers, the advance file's holds, the build and the home's saved levels, and writes the
 *  answer (Task A2.3). See `shared/model-aliases.d.mts` for the input and the file's shape. */
export function resolveAliases({ own, box, launches, prior, holds, laneVersion, saved, nowMs, ownUnreadable = false }) {
  const at = isoSeconds(nowMs);
  if (at === null) throw new RangeError('resolveAliases: nowMs is not an epoch in milliseconds');
  const lane = versionParts(laneVersion) === null ? null : laneVersion;

  const newest = newestOwnReading(own);
  let cache;
  if (newest !== null) cache = { fetchedAt: newest.fetchedAt, format: newest.format };
  else if (ownUnreadable) cache = { none: 'unreadable' };
  else cache = { none: own.length > 0 ? 'invalid' : 'absent' };
  const stale = newest !== null
    && (newest.format === 'older' || nowMs - Date.parse(newest.fetchedAt) > CACHE_STALE_AFTER_MS);

  const ownCache = newestCache(own);
  const classes = {};
  for (const c of CLASSES) {
    const p = prior === null ? null : prior.classes[c];
    // The kept launch reading: the newer, by process start, of the prior file's and the current markers'.
    let seenId = p !== null && p.seenId !== null && p.seenAt !== null ? p.seenId : null;
    let seenAt = seenId === null ? null : p.seenAt;
    for (const l of launches) {
      if (l.class !== c || familyClassOf(l.id) !== c || !isAt(l.bornAt)) continue;
      if (seenAt === null || l.bornAt > seenAt) { seenId = l.id; seenAt = l.bornAt; }
    }

    const target = ownCache === null ? null : ownCache.aliasTargets[c];
    const cacheCand = target !== null && launchable(findRow(target, own, box).row, lane)
      ? { id: target, at: ownCache.fetchedAt, source: 'cache' } : null;
    const useCand = seenId === null ? null : { id: seenId, at: seenAt, source: 'use' };
    // The newer wins; a tie goes to the cache.
    const winner = cacheCand !== null && useCand !== null ? (useCand.at > cacheCand.at ? useCand : cacheCand)
      : cacheCand ?? useCand;

    const priorId = p === null ? null : p.id;
    let id = null;
    let source = null;
    let evidenceAt = null;
    if (winner !== null && (priorId === null || p.evidenceAt === null || winner.at > p.evidenceAt)) {
      id = winner.id;
      source = winner.source;
      evidenceAt = winner.at;
    } else if (priorId !== null) {
      ({ id, source, evidenceAt } = p);
    }
    const idSince = id === null ? null : (priorId === id && isAt(p.idSince) ? p.idSince : at);

    const found = id === null ? { row: null, from: null } : findRow(id, own, box);
    const unlaunchable = id !== null && !launchable(found.row, lane)
      ? { needs: found.row.minVersion, laneVersion: lane } : null;
    const hold = holds[c];
    const heldRow = hold === undefined || hold === null ? null : findRow(hold.model, own, box).row;
    const held = hold !== undefined && hold !== null;
    classes[c] = {
      id, source, evidenceAt, idSince,
      cacheTarget: target, seenId, seenAt,
      unobserved: id === null || unlaunchable !== null || (held && (evidenceAt === null || evidenceAt < hold.at)),
      unlaunchable,
      row: found.row, rowFrom: found.from,
      heldRow,
      orphaned: orphanedOf(c, id, saved),
    };
  }
  return { v: ALIASES_VERSION, at, cache, stale, classes };
}

/** `(aliases) => 'alias-source-absent' | 'alias-cache-stale' | null`: the two `model-advance-blocked` causes the
 *  resolver's own answer carries. No class has an id: absent. Else a stale newest cache: stale. */
export function aliasesSourceCause(a) {
  if (CLASSES.every((c) => a.classes[c].id === null)) return 'alias-source-absent';
  return a.stale ? 'alias-cache-stale' : null;
}

// ── THE ALIASES FILE (Task A2.2) ────────────────────────────────────────────────────────────────────────────────────

/** Thrown by `parseAliases`, carrying the offending FIELD as data (`AdvanceInvalid`'s idiom): `v`, `at`,
 *  `classes.<class>.unlaunchable.needs`, or `''` for a top level that is not an object. */
export class AliasesInvalid extends Error {
  constructor(field, message) {
    super(message);
    this.name = 'AliasesInvalid';
    this.field = field;
  }
}

const bad = (field, what) => { throw new AliasesInvalid(field, `${field} ${what}`); };
const isIdOrNull = (v) => v === null || (typeof v === 'string' && MODEL_ID_RE.test(v));
const isAtOrNull = (v) => v === null || isAt(v);
const isStrOrNull = (v) => v === null || isStr(v);
const CACHE_NONE = Object.freeze(['absent', 'unreadable', 'invalid']);
const SOURCES = Object.freeze(['cache', 'use']);
const ROW_FROMS = Object.freeze(['own', 'box']);

function checkRow(r, f) {
  if (r === null) return;
  if (!isObj(r)) bad(f, 'is not null or a model row.');
  if (!(typeof r.id === 'string' && MODEL_ID_RE.test(r.id))) bad(`${f}.id`, 'is not a model id.');
  if (!isStrOrNull(r.label)) bad(`${f}.label`, 'is not a non-empty string or null.');
  if (!(r.efforts === null || (Array.isArray(r.efforts) && r.efforts.every(isStr)))) {
    bad(`${f}.efforts`, 'is not null (no effort field) or a list of effort levels (empty: the model takes none).');
  }
  if (!isStrOrNull(r.defaultEffort)) bad(`${f}.defaultEffort`, 'is not an effort level or null.');
  if (!(r.minVersion === null || (typeof r.minVersion === 'string' && VERSION_RE.test(r.minVersion)))) {
    bad(`${f}.minVersion`, 'is not a version (digits and dots) or null.');
  }
}

function checkClass(x, f) {
  if (!isObj(x)) bad(f, 'is missing or is not an object.');
  if (!isIdOrNull(x.id)) bad(`${f}.id`, 'is not a model id or null.');
  if (x.source !== null && !SOURCES.includes(x.source)) bad(`${f}.source`, `is not null or one of ${SOURCES.join(', ')}.`);
  for (const k of ['evidenceAt', 'idSince', 'seenAt']) {
    if (!isAtOrNull(x[k])) bad(`${f}.${k}`, 'is not null or a time of the form YYYY-MM-DDTHH:MM:SSZ.');
  }
  for (const k of ['cacheTarget', 'seenId']) {
    if (!isIdOrNull(x[k])) bad(`${f}.${k}`, 'is not a model id or null.');
  }
  if (typeof x.unobserved !== 'boolean') bad(`${f}.unobserved`, 'is not true or false.');
  if (x.unlaunchable !== null) {
    if (!isObj(x.unlaunchable)) bad(`${f}.unlaunchable`, 'is not null or {"needs": <version>, "laneVersion": <version|null>}.');
    if (!(typeof x.unlaunchable.needs === 'string' && VERSION_RE.test(x.unlaunchable.needs))) {
      bad(`${f}.unlaunchable.needs`, 'is not a version (digits and dots).');
    }
    const lv = x.unlaunchable.laneVersion;
    if (!(lv === null || (typeof lv === 'string' && VERSION_RE.test(lv)))) {
      bad(`${f}.unlaunchable.laneVersion`, 'is not a version (digits and dots) or null.');
    }
  }
  checkRow(x.row, `${f}.row`);
  if (x.rowFrom !== null && !ROW_FROMS.includes(x.rowFrom)) bad(`${f}.rowFrom`, `is not null or one of ${ROW_FROMS.join(', ')}.`);
  if ((x.row === null) !== (x.rowFrom === null)) bad(`${f}.rowFrom`, 'is null exactly when row is null.');
  checkRow(x.heldRow, `${f}.heldRow`);
  if (x.orphaned !== null) {
    if (!isObj(x.orphaned)) bad(`${f}.orphaned`, 'is not null or {"id": <model id>, "level": <effort level>}.');
    if (!(typeof x.orphaned.id === 'string' && MODEL_ID_RE.test(x.orphaned.id))) bad(`${f}.orphaned.id`, 'is not a model id.');
    if (!isStr(x.orphaned.level)) bad(`${f}.orphaned.level`, 'is not an effort level.');
  }
}

/** `(json) => Aliases`: an aliases file read off disk, COPIED FIRST through JSON (so the validated object is the one
 *  returned), then checked field by field (throws `AliasesInvalid` naming the field), every key it does not know kept. */
export function parseAliases(input) {
  let json;
  try {
    const text = JSON.stringify(input);
    json = text === undefined ? undefined : JSON.parse(text);
  } catch (e) {
    if (e instanceof RangeError) {
      throw new AliasesInvalid('', `this aliases file nests too deeply, or is too large, to be written back (${e.message}).`);
    }
    throw e;
  }
  if (!isObj(json)) {
    throw new AliasesInvalid('', 'an aliases file must be a JSON object: {"v": 1, "at": …, "cache": …, "stale": …, "classes": {…}}.');
  }
  if (json.v !== ALIASES_VERSION) bad('v', `is ${JSON.stringify(json.v)}: this build reads version ${ALIASES_VERSION} only.`);
  if (!isAt(json.at)) bad('at', 'is not a time of the form YYYY-MM-DDTHH:MM:SSZ.');
  if (!isObj(json.cache)) bad('cache', 'is missing or is not an object.');
  if (json.cache.none !== undefined) {
    if (!CACHE_NONE.includes(json.cache.none)) bad('cache.none', `is not one of ${CACHE_NONE.join(', ')}.`);
  } else {
    if (json.cache.format !== 'current' && json.cache.format !== 'older') bad('cache.format', 'is not "current" or "older".');
    const ok = isAt(json.cache.fetchedAt) || (json.cache.format === 'older' && json.cache.fetchedAt === null);
    if (!ok) bad('cache.fetchedAt', 'is not a time of the form YYYY-MM-DDTHH:MM:SSZ (null only for an older-format cache).');
  }
  if (typeof json.stale !== 'boolean') bad('stale', 'is not true or false.');
  if (!isObj(json.classes)) bad('classes', 'is missing or is not an object.');
  for (const k of Object.keys(json.classes)) {
    if (!CLASSES.includes(k)) bad(`classes.${k}`, `is not a class: the four are ${CLASSES.join(', ')}.`);
  }
  for (const c of CLASSES) checkClass(json.classes[c], `classes.${c}`);
  return json;
}

/** The file's bytes: 2-space JSON and a trailing newline, the shape every hand-editable ccrc file has. */
export function serializeAliases(a) {
  return `${JSON.stringify(a, null, 2)}\n`;
}

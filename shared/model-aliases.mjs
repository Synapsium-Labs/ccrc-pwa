// shared/model-aliases.mjs — the model-class ANTHROPIC ARM's pure rules (plan
// docs/superpowers/plans/2026-11-18-model-class-advance-anthropic-arm.md, wave A2; spec
// docs/superpowers/specs/2026-10-13-model-class-auto-advance-design.md §2.5): Claude Code's own alias resolution is the
// source of truth for which model id each class names on an Anthropic lane. This file reads its catalogue cache
// (Task A2.1) and resolves each class's id from the newest evidence (Task A2.2). ONE implementation plus a
// hand-written `.d.mts`, `shared/model-advance.mjs`'s arrangement.
//
// PURE. It imports `./models.mjs` and `./model-advance.mjs` (for `isoSeconds`, the one writer of the whole-second time
// form, and `isAt`, its one test) and nothing else, not even `node:*`; it reads no file and no clock (`nowMs` is an
// input). It SPELLS NO CLASS WORD and no model id, in code or prose: the classes come from `CLASSES`, the family of an
// id from `familyClassOf`, and every id from data.
import { CLASSES, MODEL_ID_RE, familyClassOf } from './models.mjs';
import { BEHIND_AFTER_MS, compareVersions, isAt, isoSeconds } from './model-advance.mjs';

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

/** A Claude Code build's version, a dotted number: the one test of that form, for a row's minimum here and for the lane's
 *  build where the writer reads it (`deploy/models-anthropic.mjs`). */
export const VERSION_RE = /^\d+(?:\.\d+)*$/;

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
 *  (D-8750). `{row}`, or `{skip}` with the broken field and its reason. A skip carries `rowId` if the id was
 *  valid, `null` if the id was unreadable, and no `rowId` if the string cannot name a valid target. */
function readRow(m, f) {
  const skip = (at, why, rowId) => ({ skip: { at, why, ...(rowId === undefined ? {} : { rowId }) } });
  if (!isObj(m)) return skip(f, 'is not an object', null);
  if (typeof m.id !== 'string') return skip(`${f}.id`, 'is not a string', null);
  const id = bareModelId(m.id);
  if (!MODEL_ID_RE.test(id)) return skip(`${f}.id`, 'is not a model id');
  const runtime = isObj(m.runtime) ? m.runtime : {};
  const thinking = isObj(m.thinking) ? m.thinking : {};
  let efforts = null;
  if (thinking.type === 'none') efforts = [];
  else if (Array.isArray(runtime.effort_levels) && runtime.effort_levels.every(isStr)) efforts = [...runtime.effort_levels];
  let minVersion = null;
  if (m.min_claude_code_version !== undefined && m.min_claude_code_version !== null) {
    if (typeof m.min_claude_code_version !== 'string' || !VERSION_RE.test(m.min_claude_code_version)) {
      return skip(`${f}.min_claude_code_version`, 'is not a version', id);
    }
    minVersion = m.min_claude_code_version;
  }
  return {
    row: {
      id,
      label: isStr(m.name) ? m.name : null,
      efforts,
      defaultEffort: isStr(runtime.default_effort) ? runtime.default_effort : null,
      minVersion,
    },
  };
}

/** `(json) => CacheReading`: one cache file's parsed JSON. `{format:'current', fetchedAt, aliasTargets, rows, skipped}`
 *  when it carries alias targets (a class its map does not name has a null target; a target with no row keeps the
 *  target and has no entry in `rows`), `{format:'older', fetchedAt}` when it does not (`fetchedAt` null when unreadable:
 *  the file is never a source), and `{format:'invalid', why}` for anything that is not a cache file or breaks a field
 *  of the FILE: not an object, no `catalog.config` object, a `fetchedAt` that is not a time, `models` not a list.
 *  A field of ONE row or ONE class's target is read row by row (cache-row-skip): a row that breaks a field is left out
 *  of `rows`, a class whose target is not a model id has a null target, and each has an entry in `skipped` (targets
 *  first). The resolver uses the skips to distinguish a target whose row failed to parse from one with no row. */
export function parseCatalogueCache(json) {
  if (!isObj(json)) return { format: 'invalid', why: 'a catalogue cache is a JSON object' };
  if (!isObj(json.catalog) || !isObj(json.catalog.config)) {
    return { format: 'invalid', why: 'catalog.config is missing or is not an object' };
  }
  const config = json.catalog.config;
  const fetchedAt = fetchedIso(json.fetchedAt);
  if (!isObj(config.provider_alias_targets)) return { format: 'older', fetchedAt };
  if (fetchedAt === null) return { format: 'invalid', why: 'fetchedAt is not a time' };
  const models = config.models === undefined ? [] : config.models;
  if (!Array.isArray(models)) return { format: 'invalid', why: 'models is not a list' };
  const targets = config.provider_alias_targets;
  const skipped = [];
  const aliasTargets = {};
  for (const c of CLASSES) {
    const entry = targets[c];
    const raw = isObj(entry) ? entry.default : undefined;
    const id = typeof raw === 'string' ? bareModelId(raw) : '';
    if (raw !== undefined && raw !== null && !MODEL_ID_RE.test(id)) {
      skipped.push({ at: `provider_alias_targets.${c}.default`, why: 'is not a model id' });
    }
    aliasTargets[c] = MODEL_ID_RE.test(id) ? id : null;
  }
  const rows = new Map();
  models.forEach((m, i) => {
    const read = readRow(m, `models[${i}]`);
    if (read.skip !== undefined) skipped.push(read.skip);
    else if (!rows.has(read.row.id)) rows.set(read.row.id, read.row);
  });
  return { format: 'current', fetchedAt, aliasTargets, rows, skipped };
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

/** `(evidenceAt, hold) => boolean`: whether a held class's id is UNOBSERVED against the hold standing now: a hold stands,
 *  and the id rests on no evidence or on evidence older than the hold. Such an id says nothing about where the alias
 *  went after the hold, so no reader names the class behind on it. The one rule: the resolver sets `unobserved` with
 *  it, and the health reading (`deploy/models-anthropic.mjs`) asks it again of the hold that stands at its read, since a
 *  `revert` writes a new hold without rewriting the aliases file. */
export function heldUnobserved(evidenceAt, hold) {
  return hold !== undefined && hold !== null && (evidenceAt === null || evidenceAt < hold.at);
}

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

/** `(row, laneVersion) => boolean`: `launchable`, for the writer (`deploy/models-op.mjs`), which asks it of the id a class
 *  just left to tell a move from the replacement of an id the lane's build could not launch (Task A2.3). */
export const rowLaunchable = launchable;

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

/** With no readable row here, did a skipped row name this id or have no readable id at all? A string that cannot
 *  name a valid target (or a skipped alias target, not a row) is irrelevant to this lookup. */
const skippedRowFor = (cache, id) => !cache.rows.has(id)
  && cache.skipped.some((s) => s.rowId === id || s.rowId === null);

/** Prefer the newest readable own row, then the newest readable box row. If neither can provide one, distinguish
 *  a genuinely absent row from a skip that may have hidden a build requirement. Box targets are never read. */
function findRow(id, own, box) {
  let skipped = false;
  for (const [readings, from] of [[own, 'own'], [box, 'box']]) {
    for (const r of currentsNewestFirst(readings)) {
      const row = r.rows.get(id);
      if (row !== undefined) return { row: plainRow(row), from, skipped: false };
      skipped ||= skippedRowFor(r, id);
    }
  }
  return { row: null, from: null, skipped };
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

    const rawTarget = ownCache === null ? null : ownCache.aliasTargets[c];
    // The file that names the alias must not hide its target's minimum behind a skip. Other files can supply a
    // readable row, but if all they have is a relevant skip, that is not proof that there was no minimum either.
    const targetRow = rawTarget === null || skippedRowFor(ownCache, rawTarget) ? null : findRow(rawTarget, own, box);
    const target = targetRow === null || targetRow.skipped ? null : rawTarget;
    const cacheCand = target !== null && launchable(targetRow.row, lane)
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
    classes[c] = {
      id, source, evidenceAt, idSince,
      cacheTarget: target, seenId, seenAt,
      unobserved: id === null || unlaunchable !== null || heldUnobserved(evidenceAt, hold),
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

// ── A SESSION BEHIND ITS CLASS'S ALIAS (Task A2.5) ──────────────────────────────────────────────────────────────────

/** `(session, cls, adv, lane, nowMs) => AliasBehind | null`: whether ONE running session of an Anthropic lane is still on
 *  a model its class has left (the Anthropic arm of `sessionBehind`, `shared/model-advance.mjs`, which needs a registry
 *  this lane has none of). Pure: it reads no file and no clock. `session.cls` is the class word of the session's routing
 *  record (the class ccd composed and served); `cls` is that class's row of the aliases file, `adv` its advance entry and
 *  `lane` the whole aliases file. Behind means ALL of:
 *   1. the session has a class (`session.cls` a class, and `cls` its row);
 *   2. the class's expected id: the hold's `model` while a hold stands, whatever `unobserved` says; else the aliases `id`,
 *      none when `id` is null or `unlaunchable` is set;
 *   3. the session's model, through `bareModelId`, is not that id;
 *   4. that model belongs to the session's own class (`familyClassOf`) and is no other class's current or held id: a
 *      session whose operator picked another class by hand is not behind;
 *   5. with a turn marker (`turnAtMs`), the render came strictly after the turn began; with none, the turn is the render;
 *   6. the move, `movedAt` (the hold's `at` while held, else the later of the class's `idSince` and its `releasedAt`), is
 *      at least `BEHIND_AFTER_MS` before `nowMs`, and the turn began strictly after it.
 *  Every time test is written as a comparison that HOLDS for evidence, negated, so a NaN fails it. */
export function aliasSessionBehind(session, cls, adv, lane, nowMs) {
  if (session.cls === null || cls === null) return null;
  const held = adv.hold !== null && adv.hold !== undefined;
  if (held && typeof adv.hold.model !== 'string') return null;
  const to = held ? adv.hold.model : (cls.unlaunchable !== null ? null : cls.id);
  if (to === null) return null;
  const from = bareModelId(session.model);
  if (from === to || familyClassOf(from) !== session.cls) return null;
  for (const c of CLASSES) {
    const other = lane.classes[c];
    if (c !== session.cls && (other.id === from || (other.heldRow !== null && other.heldRow.id === from))) return null;
  }
  if (session.turnAtMs !== null && !(session.renderMs > session.turnAtMs)) return null;
  const turnMs = session.turnAtMs ?? session.renderMs;
  const since = held ? adv.hold.at : [cls.idSince, adv.releasedAt].filter(isAt).sort().pop();
  const movedMs = Date.parse(since);
  if (!(movedMs <= nowMs - BEHIND_AFTER_MS) || !(turnMs > movedMs)) return null;
  return { class: session.cls, from, to, movedAt: since, turnAt: isoSeconds(turnMs), renderAt: isoSeconds(session.renderMs) };
}

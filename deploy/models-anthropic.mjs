// models-anthropic — the ANTHROPIC ARM of `deploy/models-op.mjs` (model-class Anthropic arm A2): an Anthropic lane's aliases
// file, its refresh and its holds, and the Anthropic lane's `advance-health` reading. Moved out of `models-op.mjs` whole.
// It is imported by `models-op.mjs` and never imports it (that file is a script with a `main`): every helper both files
// need reaches the arm through the one `io` object `models-op.mjs` builds at load, so this file holds no second copy of
// any of them. Bare `node`, so every import is a `.mjs`.

import { readdirSync } from 'node:fs';
import path from 'node:path';
import { CLASSES, MODEL_ID_RE, aliasesFileName } from '../shared/models.mjs';
import { MODEL_ENV_KEYS, readRegular } from '../shared/modelenv.mjs';
import {
  SIDECAR_TS_MAX_S, endHold, holdEndDue, holdEnds, holdFrom, isoSeconds, recordMove, seedAnthropicAdvance,
} from '../shared/model-advance.mjs';
import {
  AliasesInvalid, VERSION_RE, aliasSessionBehind, aliasesSourceCause, bareModelId, parseAliases, parseCatalogueCache,
  resolveAliases, rowLaunchable,
} from '../shared/model-aliases.mjs';

// ── An Anthropic lane's own path (model-class Anthropic arm A2, Task A2.3; D-8744, D-8747) ───────────────────────────
// An Anthropic lane carries no class registry: Claude Code's own alias resolution decides which model id each class
// names, and ccrc only READS that (the lane's catalogue cache, the build, the launches ccd marked) and keeps the answer
// in the lane's aliases file. ccrc never re-pins a class and never writes a model or effort choice into the home's
// `settings.json`. This path admits four ops past the `anthropic-lane` and `no-registry` gates: `aliases-refresh`, and
// `hold`, `release` and `revert`, which keep a class on an id by the advance file alone. Every writer here runs under
// the lane-files lock its bash caller holds, and writes the advance file BEFORE the aliases file.

/** The ops an Anthropic lane's own path admits. */
export const ANTHROPIC_OPS = Object.freeze(['hold', 'release', 'revert', 'aliases-refresh']);

/** The largest cache file read: a catalogue cache is far smaller; a larger file is an `invalid` reading, never read whole. */
const CACHE_FILE_MAX_BYTES = 1_048_576;
/** At most this many cache files of one home are read (names sorted): a directory of thousands is not a cache. */
const CACHE_FILES_MAX = 256;
/** The largest build file and settings file read (ids and levels only are taken from the settings). */
const BUILD_FILE_MAX_BYTES = 65_536;
const SETTINGS_FILE_MAX_BYTES = 1_048_576;
const LAUNCH_LINE_RE = /^(\d{1,12}) (\S+) (\S+) (\S+)$/;
const LAUNCH_SUFFIX = '.aliaslaunch';
/** The key a class's alias is overridden by in a settings file's variables block: the one `MODEL_ENV_KEYS` entry naming
 *  the class, derived from that one list, never respelled here (`shared/modelenv.mjs` owns the names). */
const CLASS_ENV_KEY_RE = /^ANTHROPIC_DEFAULT_([A-Z]+)_MODEL$/;
const classEnvKey = (cls) => MODEL_ENV_KEYS.find((k) => CLASS_ENV_KEY_RE.exec(k)?.[1] === cls.toUpperCase()) ?? null;

/** One Anthropic session's evidence as `aliasSessionBehind` takes it, or null when its files do not say a main-loop
 *  render of a turn (`sessionBehind`'s own input checks: a sidecar `ts` in whole seconds, no `agent`, a model; and, with a
 *  turn marker, a `sessionId` equal to the sidecar's `uuid` and a `turnAt` that is an epoch). No marker is no failure:
 *  `turnAtMs` is null and the turn is the reading. */
function anthropicSessionOf(cls, usage, turn) {
  const { ts, uuid, model, agent } = usage;
  if (!Number.isInteger(ts) || ts > SIDECAR_TS_MAX_S || (agent !== undefined && agent !== null)) return null;
  if (typeof model !== 'string' || model === '') return null;
  if (turn !== null && (typeof turn.sessionId !== 'string' || turn.sessionId === '' || uuid !== turn.sessionId
    || isoSeconds(turn.turnAt) === null)) return null;
  return { cls, model, renderMs: ts * 1000, turnAtMs: turn === null ? null : turn.turnAt };
}

/** The sentence `model-advance-blocked` prints for an aliases file's source cause. */
function aliasCauseDetail(a, cause) {
  if (cause === 'alias-source-absent') {
    const c = a.cache;
    const why = c.none === 'absent' ? "the lane's home has no catalogue cache"
      : c.none === 'unreadable' ? "the lane's catalogue cache could not be read"
        : c.none === 'invalid' ? "the lane's catalogue cache files are not in a form this build reads"
          : `the newest catalogue cache (fetched ${c.fetchedAt}) names no model this lane's build can launch`;
    return `no class has a model id: ${why}, and no alias launch has reported one`;
  }
  return a.cache.format === 'older'
    ? 'the lane\'s newest catalogue cache is in an older format, which names no alias target'
    : `the lane's newest catalogue cache was fetched ${a.cache.fetchedAt}, more than 7 days before the last refresh`;
}

/** The advance file's standing holds that name an id, in the resolver's shape. */
function holdsOf(advance) {
  const holds = {};
  if (advance === null) return holds;
  for (const c of CLASSES) {
    const h = advance.classes[c].hold;
    if (h !== null && typeof h.model === 'string') holds[c] = { at: h.at, model: h.model };
  }
  return holds;
}

/** A class's release evidence (review 2964 F4, D-8857): its `releasedHold`, the id it was held at when the release that set
 *  its `releasedAt` lifted the hold, or null. It names that release only while its `at` is `releasedAt`: a later release by
 *  a build that does not write the field leaves one naming an earlier release, and nothing reads that one. */
function releaseEvidenceOf(c) {
  const r = c.releasedHold;
  return r !== undefined && r !== null && r.at === c.releasedAt ? r : null;
}

/** Whether an aliases row is a reading a release can be settled against (D-8857): an id the lane's build can launch. With
 *  no hold standing this is the resolver's own `unobserved` rule; asked of a row a refresh wrote under the hold that was
 *  since released, it leaves that hold out, as the release did. */
const releaseReadable = (row) => row !== null && row !== undefined && row.id !== null && row.unlaunchable === null;

/** Why a class has no model a hold could name, from its aliases file (`readAliases`'s answer, read) and its row. */
function noModelWhy(aliases, k) {
  if (aliases === null) return 'it has no aliases file yet';
  if (k.id === null) return 'its alias has no model on record';
  return `its model ${k.id} needs Claude Code ${k.unlaunchable.needs}, and the lane runs `
    + `${k.unlaunchable.laneVersion ?? 'a build that cannot be read'}`;
}

/** An Anthropic lane's `show` `labels` (model-class Anthropic arm A4, Task A4.1): per class the model the lane's sessions
 *  launch on, its catalogue label and its effort levels, read from the aliases file's own rows (`aliases`, as `aliasesReport`
 *  gives it) and the lane's advance report (`advance`, as `advanceReport` gives it). Pure: no file is read here.
 *  While a hold stands on a class with a `hold.model`, that id is the model (the class's sessions launch on it, not on the
 *  alias) and its row is the aliases' `heldRow`; the alias's own id rides along as `aliasId` only when it differs, so the
 *  sheet can show both. Otherwise the class's `id` and `row`. A class with no id, or one whose kept id the lane's build
 *  cannot launch (`unlaunchable`), is a row of nulls, never a bare null (the reader would read the whole lane
 *  `unreadable`). The aliases file's own readings (`source`, `cacheTarget`, `seenId`, `unobserved`, `unlaunchable`, the
 *  home's `orphaned` level) ride along as the optional fields of `LaneClassModel`: `source`, `cacheTarget`, `seenId`
 *  and `orphanedEffort` always (null when none), `unobserved` only when true, and `unlaunchable` only when set on a class
 *  that is not held (a held class launches on its held id, so the alias's build need says nothing about it; `aliasId` names
 *  the alias's id there).
 *  `takesNoEffort` is the row saying the model takes no level (`efforts: []`, D-8750); `efforts` stays the row's own list.
 *  Null when the aliases report is not a parsed file (`absent`, `unreadable`, `invalid`): those are `show`'s `aliases`
 *  states, which the server reads as three answers, so `labels` carries none of them. */
export function anthropicLabels(aliases, advance) {
  if (aliases === null || typeof aliases !== 'object' || aliases.state !== undefined || aliases.classes === undefined) return null;
  const labels = {};
  for (const c of CLASSES) {
    const k = aliases.classes[c];
    const hold = advance !== null && advance !== undefined && advance.state === 'ok' ? advance.classes[c].hold : null;
    const held = hold !== null && hold !== undefined && typeof hold.model === 'string';
    let model = null;
    let row = null;
    if (held) {
      model = hold.model;
      row = k.heldRow?.id === hold.model ? k.heldRow : null;
    } else if (k.id !== null && k.unlaunchable === null) {
      model = k.id;
      row = k.row;
    }
    const efforts = row === null || row.efforts === null ? null : [...row.efforts];
    labels[c] = {
      model,
      label: model === null ? null : row !== null && row.label !== null ? row.label : model,
      efforts: model === null ? null : efforts,
      ...(model !== null && efforts !== null && efforts.length === 0 ? { takesNoEffort: true } : {}),
      source: k.source,
      cacheTarget: k.cacheTarget,
      seenId: k.seenId,
      ...(k.unobserved === true ? { unobserved: true } : {}),
      ...(!held && k.unlaunchable !== null ? { unlaunchable: { needs: k.unlaunchable.needs, laneVersion: k.unlaunchable.laneVersion } } : {}),
      ...(held && k.id !== null && k.id !== hold.model ? { aliasId: k.id } : {}),
      orphanedEffort: k.orphaned === null ? null : { id: k.orphaned.id, level: k.orphaned.level },
    };
  }
  return labels;
}

/** The arm, bound to the helpers of `models-op.mjs` it shares (`io`, built once there): the output and refusal
 *  envelope (`out`, `refuse`), the clock and home (`now`, `HOME`), the models directory, the advance file's reader and
 *  writer and its refusal (`readAdvance`, `writeAdvance`, `refuseAdvance`), the atomic JSON write and its sentence
 *  (`writeJsonFile`, `sayWhatChanged`), the session-file readers and their caps, the lock probe, the answer `show`
 *  gives (`describe`) and the windows file's reader. Answers `{anthropicOp, anthropicLaneHealth, aliasIdsOf,
 *  aliasesReport, aliasesPath}`. */
export function anthropicArm(io) {
  const {
    HOME, now, out, refuse, isObj, isAnthropicLane, modelsDir, readAdvance, writeAdvance, refuseAdvance, writeJsonFile,
    sayWhatChanged, readSessionFile, readSessionJson, SESSION_FILE_MAX_BYTES, SESSION_ID_RE, lockUnwritable, describe,
    readWindowsFile,
  } = io;


  /** An Anthropic lane's aliases file (model-class Anthropic arm, Task A2.3): the id each class's alias resolves to, and
   *  where that reading comes from. A lane has either this or a class registry, never both. `readAliases` reads it,
   *  `writeAliases` is its one writer, `rm` reaps it. */
  const aliasesPath = (id) => path.join(modelsDir(), aliasesFileName(id));

  /** The class word of one session's routing record (`$REG/<sid>.routeapplied`, ccd's `field=value` word list: the class
   *  ccd composed and served, a degrade included), size-capped like every session file. Three answers, never folded:
   *  `{absent: true}` (a never-routed session, outside the check), `{why: 'route-record-unreadable'}`, and `{cls}`, a
   *  class or null (no `class=` word, `default`, or a word that is none of the four). */
  function routeClassOf(reg, session) {
    let raw;
    try {
      raw = readSessionFile(path.join(reg, `${session}.routeapplied`), SESSION_FILE_MAX_BYTES);
    } catch (e) {
      return e.code === 'ENOENT' ? { absent: true } : { why: 'route-record-unreadable' };
    }
    const word = raw.split(/\s+/).find((w) => w.startsWith('class='));
    const cls = word === undefined ? null : word.slice('class='.length);
    return { cls: CLASSES.includes(cls) ? cls : null };
  }

  /** The Anthropic lane's sessions behind their class's alias (`aliasSessionBehind`), and those it could not judge, by the
   *  first file that failed, in this order: the routing record, the usage sidecar, the turn marker when it stands. A session
   *  with no routing record was never routed and is outside the check; one whose record names no class, or `default`, is read
   *  and not behind. */
  function anthropicSessionsBehindOf(id, ctx, advance, aliases) {
    const behind = [];
    const unmeasured = [];
    for (const session of ctx.sessions.byLane.get(id) ?? []) {
      const route = routeClassOf(ctx.reg, session);
      if (route.absent === true || (route.why === undefined && route.cls === null)) continue;
      if (route.why !== undefined) {
        unmeasured.push({ session, why: route.why });
        continue;
      }
      const usage = readSessionJson(path.join(ctx.reg, 'usage', `${session}.json`));
      if (usage.why !== undefined) {
        unmeasured.push({ session, why: usage.why === 'absent' ? 'sidecar-absent' : 'sidecar-unreadable' });
        continue;
      }
      const turn = readSessionJson(path.join(ctx.reg, `${session}.turn.json`));
      if (turn.why === 'unreadable') {
        unmeasured.push({ session, why: 'marker-unreadable' });
        continue;
      }
      const s = anthropicSessionOf(route.cls, usage.value, turn.why === 'absent' ? null : turn.value);
      if (s === null) continue;
      const b = aliasSessionBehind(s, aliases.classes[route.cls], advance.classes[route.cls], aliases, ctx.nowMs);
      if (b !== null) behind.push({ session, ...b });
    }
    return { behind, unmeasured };
  }

  /** One Anthropic lane's findings (Task A2.5), or null for a lane with neither an aliases file nor an advance file (not in
   *  the population, as a registry lane with no registry file is not). The order of `blocked` is the lock, the advance
   *  file, then the aliases file. An ABSENT aliases file is no finding (the first hourly refresh writes it) and no session
   *  is read; an unreadable or invalid one is a finding and names every session of the lane unmeasured with its word. There
   *  is no canary, so `heldBack` is always empty. Each held class is asked the one decider of a hold's end (`holdEnds`,
   *  revert-ends-itself): `heldBehind` names one whose end has come (its alias names a third id on evidence after the hold),
   *  with `from`, `since` (that evidence's time) and `due` (`holdEndDue`: it has stood past the next hourly refresh, which
   *  ends it); `holdsWaiting` names one whose end has not, with `from`. `sessionsBehind` and `sessionsUnmeasured` are
   *  `anthropicSessionsBehindOf`'s, judged against the advance file's holds and releases (none when the advance file is
   *  absent). */
  function anthropicLaneHealth(acc, ctx) {
    const id = acc.id;
    const al = readAliases(id);
    const rd = readAdvance(id);
    if (al.err === undefined && al.aliases === null && rd.err === undefined && rd.advance === null) return null;
    const lane = { id, anthropic: true, heldBack: [], heldBehind: [], holdsWaiting: [], blocked: [], sessionsBehind: [],
      sessionsUnmeasured: [] };
    const block = (cause, detail) => { lane.blocked.push({ class: null, cause, detail }); };
    const sessions = ctx.sessions.byLane.get(id) ?? [];
    const lockWhy = lockUnwritable(ctx.lockTemplate.replace('{id}', id));
    if (lockWhy !== null) block('lock-unwritable', lockWhy);
    if (rd.err !== undefined) block(rd.err[0], rd.err[1]);
    if (al.err !== undefined) {
      block(al.err[0], al.err[1]);
      lane.sessionsUnmeasured = sessions.map((session) => ({ session, why: al.err[0] }));
      return lane;
    }
    const aliases = al.aliases;
    if (aliases === null) return lane;
    const cause = aliasesSourceCause(aliases);
    if (cause !== null) block(cause, aliasCauseDetail(aliases, cause));
    if (rd.err !== undefined) {
      lane.sessionsUnmeasured = sessions.map((session) => ({ session, why: rd.err[0] }));
      return lane;
    }
    const adv = rd.advance ?? seedAnthropicAdvance();
    for (const cls of CLASSES) {
      const hold = adv.classes[cls].hold;
      const row = aliases.classes[cls];
      if (hold === null || typeof hold.model !== 'string') continue;
      const end = holdEnds({ arm: 'alias', c: adv.classes[cls], row });
      if (!end.ends) {
        lane.holdsWaiting.push({ class: cls, pin: hold.model, hold: { at: hold.at, by: hold.by }, from: end.from });
        continue;
      }
      lane.heldBehind.push({ class: cls, hold: { at: hold.at, by: hold.by }, reason: 'newer', pin: hold.model, newer: row.id,
        from: end.from, since: row.evidenceAt, due: holdEndDue(row.evidenceAt, ctx.nowMs) });
    }
    const s = anthropicSessionsBehindOf(id, ctx, adv, aliases);
    lane.sessionsBehind = s.behind;
    lane.sessionsUnmeasured = s.unmeasured;
    return lane;
  }

  /** The lane's home: `<HOME>/<configDirSuffix>`, as `materialise` joins it. */
  const homeOf = (account) => path.join(HOME, account.configDirSuffix);

  /** An Anthropic lane's aliases file as a writer loads it: `{aliases: null}` when absent (the one fresh start),
   *  `{aliases}` parsed, or `{err: [word, detail]}` for a file that exists and cannot be read
   *  (`aliases-file-unreadable`: a FIFO or a directory included, type-tested first) or is not an aliases file this build
   *  reads (`aliases-file-invalid`). Never folded: absent, unreadable and invalid are three answers. */
  function readAliases(id) {
    const p = aliasesPath(id);
    let text;
    try {
      text = readRegular(p);
    } catch (e) {
      if (e.code === 'ENOENT') return { aliases: null };
      return { err: ['aliases-file-unreadable', `${p} could not be read: ${e.message}.`] };
    }
    let json;
    try {
      json = JSON.parse(text);
    } catch (e) {
      return { err: ['aliases-file-invalid', `${p} is not valid JSON: ${e.message}.`] };
    }
    try {
      return { aliases: parseAliases(json) };
    } catch (e) {
      if (e instanceof AliasesInvalid) {
        return { err: ['aliases-file-invalid', `${e.message} (${p} is not an aliases file this build reads)`] };
      }
      throw e;
    }
  }

  /** The `lanes` op's `ids` for an Anthropic row: each class's `{id, cacheTarget, seenId}` from the lane's aliases file (the
   *  id ccrc keeps, the cache's own target and the id a fresh launch reported, so a reader sees both when they disagree),
   *  or `null` when that file is absent, unreadable or invalid. */
  function aliasIdsOf(id) {
    const r = readAliases(id);
    if (r.err !== undefined || r.aliases === null) return null;
    return Object.fromEntries(CLASSES.map((c) => {
      const row = r.aliases.classes[c];
      return [c, { id: row.id, cacheTarget: row.cacheTarget, seenId: row.seenId }];
    }));
  }

  /** The lane's aliases file as `show` reports it: the parsed file itself, or `{state: 'absent'|'unreadable'|'invalid'}`
   *  (with the reason, for the last two). */
  function aliasesReport(id) {
    const r = readAliases(id);
    if (r.err !== undefined) {
      return { state: r.err[0] === 'aliases-file-unreadable' ? 'unreadable' : 'invalid', detail: r.err[1] };
    }
    return r.aliases === null ? { state: 'absent' } : r.aliases;
  }

  /** THE ONE WRITER of the aliases file. Like `writeAdvance`, the object goes back through its parser before it is
   *  written, so no caller can leave a file the next reader refuses; the write is `writeJsonFile`'s (D-5783). */
  function writeAliases(id, aliases) {
    let parsed;
    try {
      parsed = parseAliases(aliases);
    } catch (e) {
      if (e instanceof AliasesInvalid) {
        return ['aliases-invalid', `the aliases file for account "${id}" would not read back (${e.message}), so it `
          + 'was not written. Nothing was changed.'];
      }
      throw e;
    }
    return writeJsonFile(aliasesPath(id), parsed, 'aliases-unwritable');
  }

  /** One home's cache files, each a `CacheReading` (`parseCatalogueCache`): `{readings, unreadable}`. A directory that is
   *  absent is no readings; one that exists and cannot be listed is `unreadable` (the file's `cache.none` word); a file
   *  that is not a regular file, is over its cap or is not JSON is an `invalid` reading. Read-only. */
  function readCacheReadings(home) {
    const dir = path.join(home, 'cache', 'model-catalog');
    let names;
    try {
      names = readdirSync(dir);
    } catch (e) {
      return { readings: [], unreadable: e.code !== 'ENOENT' };
    }
    const readings = [];
    for (const n of [...names].filter((x) => x.endsWith('.json')).sort().slice(0, CACHE_FILES_MAX)) {
      try {
        readings.push(parseCatalogueCache(JSON.parse(readSessionFile(path.join(dir, n), CACHE_FILE_MAX_BYTES))));
      } catch (e) {
        readings.push({ format: 'invalid', why: `${n} could not be read as JSON: ${e.message}` });
      }
    }
    return { readings, unreadable: false };
  }

  /** The lane's Claude Code build: `version_to` of the home's last update result, a dotted number, else null. */
  function readLaneBuild(home) {
    try {
      const j = JSON.parse(readSessionFile(path.join(home, '.last-update-result.json'), BUILD_FILE_MAX_BYTES));
      return isObj(j) && typeof j.version_to === 'string' && VERSION_RE.test(j.version_to) ? j.version_to : null;
    } catch {
      return null;
    }
  }

  /** The home's `settings.json`, parsed: `{json}`, `{json: null}` when absent, or `{err}` naming why it cannot be used.
   *  Read in-process and size-capped; callers take only ids, levels and the names of the variables block's keys from it. */
  function readHomeSettings(home) {
    const p = path.join(home, 'settings.json');
    let text;
    try {
      text = readSessionFile(p, SETTINGS_FILE_MAX_BYTES);
    } catch (e) {
      return e.code === 'ENOENT' ? { json: null } : { err: `${p} could not be read: ${e.message}` };
    }
    try {
      const json = JSON.parse(text);
      return isObj(json) ? { json } : { err: `${p} is not a JSON object` };
    } catch {
      // Never the parser's message: it quotes the text around the bad token, which can be part of a value.
      return { err: `${p} is not valid JSON` };
    }
  }

  /** The home's saved effort levels, model id to level: `modelSettings.<id>.effortLevel`, ids and levels only. */
  function readSavedLevels(home) {
    const s = readHomeSettings(home);
    const ms = s.json === null || s.err !== undefined ? null : s.json.modelSettings;
    const saved = {};
    if (!isObj(ms)) return saved;
    for (const [k, v] of Object.entries(ms)) {
      if (MODEL_ID_RE.test(bareModelId(k)) && isObj(v) && typeof v.effortLevel === 'string' && v.effortLevel !== '') {
        saved[k] = v.effortLevel;
      }
    }
    return saved;
  }

  /** The lane's filled launch markers (`<sid>.aliaslaunch` in the session registry, one line `<born-epoch>
   *  <wrapper> <class> <model-id|->`, written by ccd): only a line of THIS lane, of a class, with an id (not `-`, the
   *  unfilled mark). The id goes through `bareModelId`, the time through `isoSeconds`. A registry that is absent or cannot
   *  be listed means no launches, and a marker that cannot be read or does not parse is skipped. Read-only. */
  function readLaunches(reg, lane) {
    let names;
    try {
      names = readdirSync(reg);
    } catch {
      return [];
    }
    const launches = [];
    for (const n of [...names].sort()) {
      if (!n.endsWith(LAUNCH_SUFFIX) || !SESSION_ID_RE.test(n.slice(0, -LAUNCH_SUFFIX.length))) continue;
      let line;
      try {
        line = readSessionFile(path.join(reg, n), SESSION_FILE_MAX_BYTES).split('\n')[0];
      } catch {
        continue;
      }
      const m = LAUNCH_LINE_RE.exec(line);
      if (m === null) continue;
      const [, epoch, wrapper, cls, rawId] = m;
      if (wrapper !== lane || !CLASSES.includes(cls) || rawId === '-') continue;
      const id = bareModelId(rawId);
      const bornAt = isoSeconds(Number(epoch) * 1000);
      if (!MODEL_ID_RE.test(id) || bornAt === null) continue;
      launches.push({ class: cls, id, bornAt });
    }
    return launches;
  }

  /** `aliases-refresh --file --id --reg` (Task A2.3): read the evidence, resolve each class's id, record each MOVE in the
   *  advance file, then write the aliases file. Both writes happen under the lane-files lock the caller holds, the advance
   *  file FIRST.
   *   - Only an ABSENT aliases file is a fresh start. One that cannot be read, or is not one this build reads, is never
   *     written over: the refresh refuses with its cause word and writes neither file.
   *   - A MOVE is a class whose id went from one id to another, which by the resolver's rule rests on newer evidence, and
   *     whose old id the lane's build could have launched. A change of source alone, a class's first id and the replacement
   *     of an id the build cannot launch are not moves.
   *   - THE CRASH KEY. A move is the same one when the class's newest history entry, counted only when it is LATER than the
   *     class's `idSince` in the aliases file we started from, is an `ok` move from `from` to `to`: a refresh cut short
   *     after the advance write finds it, appends nothing and leaves `previous` as it is, writes the aliases file, and
   *     answers the move so that it is pushed then. An entry no later than `idSince` is an earlier move of an id since
   *     replaced, so a genuine repeat gets its own entry. `evidenceAt` is data and never part of the key: it is recomputed
   *     from the evidence at every refresh.
   *   - A RELEASE IS SETTLED HERE (review 2964 F4, D-8857). A held class records nothing, and its release records no move:
   *     it keeps the id the class was held at (`releasedHold`). The first refresh after it whose reading of the class is
   *     trustworthy (`releaseReadable`, in an aliases file that was there before: a first baseline is not) settles it in
   *     this refresh's one advance write: a move from the held id to the alias's id, with `previous` at the held id, when
   *     they differ, and the evidence cleared either way. It stands in for the class's ordinary move in that refresh, so
   *     the move is one entry and one push. An untrustworthy reading, or none, keeps the evidence for a later refresh; a
   *     renewed hold drops it (`anthropicHoldOp`). Clearing the evidence in the write that records the move is what makes
   *     a repeat record nothing.
   *   - THE SETTLE'S CRASH KEY. A settle cut short after the advance write left no evidence to find; the class's alias has
   *     not moved since (`before.id` is `after.id`), and its newest entry, a move TO that id, is LATER than the aliases
   *     file we started from (`at`), whose write that refresh never made. That entry is answered so that it is pushed
   *     then, and nothing is appended.
   *   - A HOLD ENDS HERE (revert-ends-itself). A held class whose hold ends now (`holdEnds`: its alias names an id other
   *     than the one the Revert left and the held one, on evidence after the hold), in an aliases file that was there
   *     before, is settled as a release is: a move from the held id to the alias's id, `previous` at the held id, and the
   *     hold cleared in the same advance write (`endHold`, which records `releasedAt` as a release does). The aliases file
   *     this refresh writes is resolved without that hold. Any other held class records nothing, as before, except that
   *     a revert hold nothing derives a `from` for gets the alias's id stamped as its `from` in this refresh's advance
   *     write (`holdEnds`' `stamp`, call 469), and does not end on that pass.
   *   - THE CRASH KEY, read for every class: a refresh cut short after the advance write left the class's newest entry, an
   *     `ok` move TO the alias's id, LATER than the aliases file we started from. That entry is answered so it is pushed
   *     then, and nothing is appended, whatever id that older file names (a hold's end may have been the first refresh to
   *     see the id).
   *   - It never calls `advanceForWrite` or `reconcilePending`, and writes no pending intent: there is no registry move
   *     to be cut short, only these two writes. A missing advance file is made (`seedAnthropicAdvance`) only when a move
   *     is recorded. An advance file that cannot be read refuses the refresh, writing neither file. */
  function aliasesRefreshOp(a, account, json) {
    if (!path.isAbsolute(a.reg)) {
      return refuse(2, 'bad-argv', `--reg must be the session registry's absolute path (got ${JSON.stringify(a.reg)}).`);
    }
    const at = now();
    const nowMs = Date.parse(at);
    if (!Number.isFinite(nowMs)) return refuse(2, 'bad-argv', `the clock answered ${JSON.stringify(at)}, which is not a time.`);
    const prior = readAliases(a.id);
    if (prior.err !== undefined) {
      return refuse(1, prior.err[0], `${prior.err[1]} aliases-refresh rewrites account "${a.id}"'s aliases file and will `
        + 'not overwrite one it cannot read. Move it aside by hand (the next refresh rebuilds it from the lane\'s cache), '
        + 'then re-run. Nothing was written.');
    }
    const cur = readAdvance(a.id);
    if (cur.err !== undefined) return refuseAdvance(cur.err, 'aliases-refresh', a.id);

    const home = homeOf(account);
    const own = readCacheReadings(home);
    // Every OTHER Anthropic home's cache is read for ROWS only: the resolver reads a box reading's rows by id and never
    // its targets, so another home's alias target can never become this lane's.
    const box = [];
    const seen = new Set([account.configDirSuffix]);
    for (const other of (json.accounts ?? [])) {
      if (!isObj(other) || !isAnthropicLane(other) || typeof other.configDirSuffix !== 'string'
          || seen.has(other.configDirSuffix)) continue;
      seen.add(other.configDirSuffix);
      box.push(...readCacheReadings(path.join(HOME, other.configDirSuffix)).readings);
    }
    const laneVersion = readLaneBuild(home);
    const evidence = {
      own: own.readings, box, launches: readLaunches(a.reg, a.id), prior: prior.aliases,
      holds: holdsOf(cur.advance), laneVersion, saved: readSavedLevels(home), nowMs, ownUnreadable: own.unreadable,
    };
    let next = resolveAliases(evidence);

    const moves = [];
    const settled = [];
    const ended = [];
    const stamped = [];
    for (const c of CLASSES) {
      const before = prior.aliases === null ? null : prior.aliases.classes[c];
      const after = next.classes[c];
      const was = cur.advance === null ? null : cur.advance.classes[c];
      // A HELD CLASS MOVES NOTHING (review 2886, F4), as the Codex arm's advance abandons a held class (`held`): no history
      // entry, `previous` untouched and no push, so a second revert still holds at the model the first one named. The
      // aliases file below still records where the alias went, which is how doctor names the class held behind; the first
      // trustworthy refresh after the release records the move (D-8857).
      if (was !== null && was.hold !== null) {
        // revert-ends-itself: the one exception, a hold whose end has come, judged against a file that was there
        // before; a revert hold nothing derives a `from` for gets the alias's id stamped as one, and waits (call 469).
        const end = holdEnds({ arm: 'alias', c: was, row: after });
        if (typeof end.stamp === 'string') stamped.push([c, end.stamp]);
        if (prior.aliases === null || !end.ends) continue;
        ended.push(c);
        moves.push({ class: c, from: was.hold.model, to: after.id, evidenceAt: after.evidenceAt, recorded: false });
        continue;
      }
      const lifted = was === null ? null : releaseEvidenceOf(was);
      if (lifted !== null) {
        if (prior.aliases === null || !releaseReadable(after)) continue;
        settled.push(c);
        if (after.id !== lifted.model) {
          moves.push({ class: c, from: lifted.model, to: after.id, evidenceAt: after.evidenceAt, recorded: false });
        }
        continue;
      }
      const history = was === null ? [] : was.history;
      const newest = history[history.length - 1];
      if (before !== null && after.id !== null && newest !== undefined && newest.ok === true
          && newest.how === 'advance' && newest.to === after.id && newest.at > prior.aliases.at) {
        moves.push({ class: c, from: newest.from, to: newest.to, evidenceAt: after.evidenceAt, recorded: true });
        continue;
      }
      if (before === null || before.id === null || after.id === null || before.id === after.id) continue;
      if (before.unlaunchable !== null || !rowLaunchable(before.row, laneVersion)) continue;
      const recorded = newest !== undefined && newest.ok === true && newest.from === before.id && newest.to === after.id
        && typeof before.idSince === 'string' && newest.at > before.idSince;
      moves.push({ class: c, from: before.id, to: after.id, evidenceAt: after.evidenceAt, recorded });
    }

    const toRecord = moves.filter((m) => !m.recorded);
    if (ended.length > 0) {
      // The aliases file this refresh writes is resolved without the holds that just ended, so it never reads as held.
      const holds = { ...evidence.holds };
      for (const c of ended) delete holds[c];
      next = resolveAliases({ ...evidence, holds });
    }
    if (toRecord.length > 0 || settled.length > 0 || stamped.length > 0) {
      let advance = cur.advance ?? seedAnthropicAdvance();
      for (const m of toRecord) {
        advance = recordMove(advance, m.class, {
          at, how: 'advance', from: m.from, to: m.to, ok: true, canary: 'not-run', cause: 'newer',
          ...(m.evidenceAt === null ? {} : { evidenceAt: m.evidenceAt }),
        });
        advance.classes[m.class].previous = { model: m.from, effort: null };
      }
      for (const c of settled) delete advance.classes[c].releasedHold;
      for (const c of ended) advance = endHold(advance, c, at, { alias: true });
      for (const [c, from] of stamped) advance.classes[c].hold = { ...advance.classes[c].hold, from };
      const w = writeAdvance(a.id, advance);
      if (w !== null) return refuse(1, w[0], w[1]);
    }
    const w = writeAliases(a.id, next);
    if (w !== null) {
      return refuse(1, w[0], toRecord.length === 0 ? w[1] : sayWhatChanged(w[1], 'The advance file already records '
        + `this refresh's ${toRecord.length === 1 ? 'move' : 'moves'}; the aliases file is as it was, so the next refresh `
        + 're-derives the same move, records nothing twice, and writes it.'));
    }
    out({ ok: true, op: 'aliases-refresh', id: a.id, moved: moves.map((m) => ({ class: m.class, from: m.from, to: m.to })) });
    return 0;
  }

  /** `hold`, `release` and `revert` on an Anthropic lane (D-8747). They touch only the lane's advance file (made from
   *  `seedAnthropicAdvance` when absent, never `backfillAdvance`): the aliases file, the home's settings and every cache
   *  stay as they are, so nothing re-materialises.
   *   - `hold` records the class's current id from the aliases file as `hold.model`. It refuses `aliases-file-unreadable`
   *     or `aliases-file-invalid` when that file cannot be read, `alias-source-absent` when the class has no id or its id
   *     is one the lane's build cannot launch, and `settings-overrides-hold` when the home's `settings.json` variables
   *     block names the class's alias key (that block beats the launch environment, so the hold could not reach a
   *     launch; a file that cannot be read cannot be shown not to, so it refuses the same). A second hold changes nothing.
   *     A new hold drops a release's evidence (`releasedHold`): the move that release lifted is never recorded (D-8857).
   *   - `revert` holds the class at `previous.model` (`by: 'revert'`), over any hold already standing, under the same
   *     settings refusal; `previous` stays on record and no history entry is made: the hold is not a move. While a
   *     release's evidence stands (D-8857: a release the hourly refresh has not settled, or a revert's hold over it),
   *     `previous` may be stale, so revert reads the class's alias in the aliases file: an alias that moved off the held id
   *     reverts to the held id, which is the `previous` the settle would write; one still at it reverts to `previous`. An
   *     aliases file that cannot be read refuses with its word, and one with no id the lane can launch refuses
   *     `alias-source-absent`, writing nothing. A second revert holds where the first did, whatever the alias does in
   *     between (review 3006 F1): a revert that finds the alias still at the held id drops the evidence in its write (the
   *     alias had not moved when the hold was placed, so there is no move to settle), and the next revert reads `previous`
   *     as it did; one that finds the alias moved keeps it, and a revert over that revert's hold at the held id holds there
   *     again without reading the aliases file for it. Its hold names what it moved the class away from
   *     (`from`, revert-ends-itself): the class's current id in the aliases file when that row is one a launch can use, so
   *     the hold ends once the alias names a third id; with no such row, or an id equal to the held one, a re-revert keeps
   *     what the hold it replaces waited for, and otherwise it is left out: `holdFrom` then reads the newest move from the
   *     held id, and failing that the next refresh stamps the alias's id (call 469). A revert hold never ends on the id
   *     it left.
   *   - `release` clears the hold and records the time as the class's `releasedAt`, so a later reader can count a day from
   *     it, and the held id with that time as `releasedHold`, the evidence the next trustworthy refresh settles (D-8857).
   *     It makes no history entry and spends no `HISTORY_CAP` slot, and `lastMoveOf` never sees it. */
  function anthropicHoldOp(opName, a, account) {
    if (!CLASSES.includes(a.class)) {
      return refuse(1, 'unknown-class', `"${a.class}" is not a class: the four are ${CLASSES.join(', ')}.`);
    }
    const loaded = readAdvance(a.id);
    if (loaded.err !== undefined) return refuseAdvance(loaded.err, opName, a.id);
    const created = loaded.advance === null;
    const advance = loaded.advance ?? seedAnthropicAdvance();
    const c = advance.classes[a.class];
    let changed = false;
    if (opName === 'release') {
      if (c.hold !== null) {
        const held = c.hold.model;
        c.hold = null;
        c.releasedAt = now();
        if (typeof held === 'string') c.releasedHold = { model: held, at: c.releasedAt };
        else delete c.releasedHold;
        changed = true;
      }
    } else if (opName === 'revert' || c.hold === null) {
      let model;
      if (opName === 'revert') {
        const lifted = releaseEvidenceOf(c);
        let moved = false;
        if (lifted !== null && c.hold !== null && c.hold.by === 'revert' && c.hold.model === lifted.model) {
          moved = true; // an earlier revert in this window found the alias moved and held here: hold here again
        } else if (lifted !== null) {
          const al = readAliases(a.id);
          if (al.err !== undefined) {
            return refuse(1, al.err[0], `${al.err[1]} The ${a.class} class's hold at ${lifted.model} was released and the `
              + 'hourly refresh has not yet recorded where its alias went, so revert reads that file to tell and will not '
              + 'guess. Move it aside by hand (the next refresh rebuilds it), then revert again. Nothing was written.');
          }
          const k = al.aliases === null ? null : al.aliases.classes[a.class];
          if (!releaseReadable(k)) {
            return refuse(1, 'alias-source-absent', `account "${a.id}"'s ${a.class} class was released from a hold at `
              + `${lifted.model}, and ${noModelWhy(al.aliases, k)}, so revert cannot tell whether its alias moved under the `
              + 'hold and will not guess an earlier model from the history. Revert again after the next hourly refresh '
              + 'that reads a model the lane can launch. Nothing was written.');
          }
          moved = k.id !== lifted.model;
          if (!moved) delete c.releasedHold;
        }
        model = moved ? lifted.model : (c.previous === null ? null : c.previous.model);
        if (model === null) {
          return refuse(1, 'no-previous',
            `account "${a.id}"'s ${a.class} class has no earlier model on record, so there is nothing to revert to. `
            + 'Nothing was written.');
        }
      } else {
        const al = readAliases(a.id);
        if (al.err !== undefined) {
          return refuse(1, al.err[0], `${al.err[1]} hold records the class's current model from account "${a.id}"'s `
            + 'aliases file and will not guess one. Move that file aside by hand (the next refresh rebuilds it), then '
            + 'hold again. Nothing was written.');
        }
        const k = al.aliases === null ? null : al.aliases.classes[a.class];
        if (!releaseReadable(k)) {
          return refuse(1, 'alias-source-absent', `account "${a.id}"'s ${a.class} class has no model a hold could name: `
            + `${noModelWhy(al.aliases, k)}. Start one session on this lane through ccd, or sign it in so Claude Code `
            + 'fetches its catalogue, then hold again. Nothing was written.');
        }
        model = k.id;
      }
      const key = classEnvKey(a.class);
      const settings = readHomeSettings(homeOf(account));
      const named = settings.err === undefined && settings.json !== null && isObj(settings.json['env']) && key !== null
        && Object.prototype.hasOwnProperty.call(settings.json['env'], key);
      if (settings.err !== undefined || named) {
        return refuse(1, 'settings-overrides-hold', settings.err !== undefined
          ? `${settings.err}, so it cannot be shown not to name ${key}, and a settings variables block beats the launch `
            + 'environment: a hold could not be shown to reach a launch. Fix that file, then hold again. Nothing was written.'
          : `account "${a.id}"'s settings.json names ${key} in its variables block, which beats the launch `
            + `environment, so a hold on ${a.class} could not reach a launch. ccrc never writes that key: remove it from `
            + `${path.join(homeOf(account), 'settings.json')} yourself, then hold again. Nothing was written.`);
      }
      // revert-ends-itself: a revert names the id it moves the class away from, read from the aliases file; never refused
      // for it. With no new one to read, a re-revert keeps what the hold it replaces waited for (call 469); with
      // neither, `from` is left out and the next refresh stamps it.
      let left = null;
      if (opName === 'revert') {
        const al = readAliases(a.id);
        const k = al.err !== undefined || al.aliases === null ? null : al.aliases.classes[a.class];
        const kept = c.hold === null ? null : holdFrom(c, c.hold.model, 'alias');
        if (releaseReadable(k) && k.id !== model) left = k.id;
        else if (kept !== model) left = kept;
      }
      c.hold = { at: now(), by: opName === 'revert' ? 'revert' : 'hand', model, ...(left !== null ? { from: left } : {}) };
      if (opName === 'hold') delete c.releasedHold;
      changed = true;
    }
    if (changed || created) {
      const w = writeAdvance(a.id, advance);
      if (w !== null) return refuse(1, w[0], w[1]);
    }
    out({ ok: true, op: opName, class: a.class, changed, ...describe(account, null, null, readWindowsFile(a.id)) });
    return 0;
  }

  /** An Anthropic lane's own path, before the `anthropic-lane` and `no-registry` gates (`ANTHROPIC_OPS`). */
  function anthropicOp(opName, a, account, json) {
    // A held id reaches every launch on the lane: ccd puts it in the launch environment (`_held_model_env_to`,
    // ccd/lib/model-aliases.sh, Task A3.4), which lifted D-8820's gate in the same build.
    if (opName === 'aliases-refresh') return aliasesRefreshOp(a, account, json);
    return anthropicHoldOp(opName, a, account);
  }

  return { anthropicOp, anthropicLaneHealth, aliasIdsOf, aliasesReport, aliasesPath };
}

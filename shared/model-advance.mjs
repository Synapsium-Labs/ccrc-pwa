// shared/model-advance.mjs — the model-class AUTO-ADVANCE's pure rules (spec
// docs/superpowers/specs/2026-10-13-model-class-auto-advance-design.md), for every caller: the node writer
// (`deploy/models-op.mjs`, which owns the lane's advance file) and the readers the later waves add. ONE
// implementation plus a hand-written `.d.mts`, `shared/models.mjs`'s arrangement.
//
// PURE. It imports `./models.mjs` and nothing else, not even `node:*`, and reads no file and no clock. It SPELLS
// NO CLASS WORD, in code or prose: the four come from `CLASSES`, so the class census in
// `single-definition.test.ts` never counts this file.
//
// THE FAMILY RULE (§2.2, D16). A candidate id has exactly three dash-separated parts,
// `<vendor>-<version>-<family>`, the version dot-separated integers. Any other id is never a candidate and
// never a seed: the grammar is the provider's convention, not a contract, so an id that breaks it is ignored
// rather than guessed at. A class follows ONE family and moves only forwards, to the newest eligible model of it,
// except when its pin has left a fresh catalogue.
import { CLASSES, MODEL_ID_RE, RegistryInvalid, parseRegistry, resolveDiscovery } from './models.mjs';

/** Every reason a lane or a class cannot advance, the words `model-advance-blocked` names. `chooseCandidate`
 *  answers the two that are a fact about one class; the others are facts about a lane's files, its kind or its
 *  lock. `windows-unreadable`, `shared-family`, `lane-not-codex-kind` and `lock-unwritable` are this plan's
 *  additions to the spec's list (D-5193), so none of them goes quiet. `lock-unwritable` is
 *  measured by `advance-health` alone, read-only, and says what every writer on that lane is already refused. The last
 *  four are an Anthropic lane's (spec §2.8, model-class Anthropic arm): its aliases file names no id for any class,
 *  its newest cache is stale, or the aliases file cannot be read or is not one this build reads. No fifth word. */
export const BLOCKED_CAUSES = Object.freeze([
  'advance-file-unreadable', 'advance-file-invalid', 'registry-unreadable', 'registry-invalid',
  'catalogue-unreadable', 'catalogue-invalid', 'windows-unreadable', 'pin-grammar', 'shared-family',
  'lane-not-codex-kind', 'lock-unwritable',
  'alias-source-absent', 'alias-cache-stale', 'aliases-file-unreadable', 'aliases-file-invalid',
  // Programme wave 3 (backward-move, effort-level-dropped; D-8838, D-8842): a class waiting out `RETIRE_GRACE_MS` on a
  // pin its fresh catalogue no longer lists; a registry still refused for a stored effort level its model no longer
  // offers (`effortFallbacks`, until the hourly refresh writes the fallback); and a class running at the fallback the
  // refresh recorded (`effortFallbackOf`). `advance-health` answers them; no file holds them, so an older build never
  // reads any of the three words.
  'pin-missing', 'effort-dropped', 'effort-fallback',
]);

/** The shortest span of CONTINUOUS fresh sightings of the same missing pin before its class moves `retired`
 *  (programme wave 3, backward-move, D-8838): six hours of the catalogue's own observation times (`fetchedAt`), never
 *  wall time spent blind. Measured 2026-11-10: one lane's fresh catalogue left out a current pin for about two hours
 *  and listed it again, and the class moved to an older model and back, each move behind a passing canary. The
 *  hourly refresh observes about once an hour (its timer, plus however long the first pass takes), so the span is
 *  six to seven hourly sightings. A pin that is gone for good is still retired (D-5199), six hours late; a newer
 *  model never waits (`newer`). It is a backstop against a short absence, whatever caused it; it is not a finding
 *  about why a catalogue was short. The class records the run of sightings as its `missing` (`markMissing`). */
export const RETIRE_GRACE_MS = 6 * 3_600_000;

/** The longest gap between two fresh sightings that still continues a run of them (D-8838): one hourly refresh plus
 *  half an hour of slack, never two. A longer gap, from a missed hour, a failed probe or a stale catalogue, restarts
 *  the run at the next sighting, so hours the lane was not observed never count toward `RETIRE_GRACE_MS`. */
export const RETIRE_GAP_MS = 90 * 60_000;

/** Why `chooseCandidate` named its candidate, the three words its `reason` takes: `newer` (a model strictly newer
 *  than the pin), `retired` (the pin left a fresh catalogue, the one move that may go to an OLDER version) and
 *  `empty` (a class with no pin). A successful advance's history entry carries the word as `cause` (D-8384), so a
 *  retirement reads differently from an advance; `causeOf` reads an entry written before the field as `unknown`. */
export const CANDIDATE_REASONS = Object.freeze(['newer', 'retired', 'empty']);

/** The longest `reason` an advance-file history entry may carry, in characters, every one printable ASCII. ONE
 *  number for the file's reader and for every writer of a reason: `parseAdvance` refuses a longer one and
 *  `recordFailure` cuts one to it (below), and the later waves' commit (`deploy/models-op.mjs`) and canary
 *  (`deploy/models-canary.mjs`) import it, so a reason any of them writes always reads back. Assigned here and
 *  nowhere else: `single-definition.test.ts` refuses a second assignment in any source it scans. */
export const REASON_MAX = 200;

/** A vendor or family word: a lowercase letter, then lowercase letters and digits. */
const WORD_RE = /^[a-z][a-z0-9]*$/;
/** A version: one to four dot-separated integers, each `0` or up to six digits with no leading zero. */
const VERSION_RE = /^(0|[1-9][0-9]{0,5})(\.(0|[1-9][0-9]{0,5})){0,3}$/;

/** `(id) => {vendor, version, family} | null`: the id split by D16's grammar, or null for any id that breaks
 *  it. Never throws, whatever it is handed. */
export function parseModelId(id) {
  if (typeof id !== 'string') return null;
  const parts = id.split('-');
  if (parts.length !== 3) return null;
  const [vendor, version, family] = parts;
  if (!WORD_RE.test(vendor) || !VERSION_RE.test(version) || !WORD_RE.test(family)) return null;
  return { vendor, version: version.split('.').map(Number), family };
}

/** The family of an id that parses, else null; null for no id at all (an empty class). */
export function familyOf(id) {
  if (id === null || id === undefined) return null;
  const p = parseModelId(id);
  return p === null ? null : p.family;
}

/** Two versions compared part by part as integers, a missing part read as 0: 6.1 > 6 > 5.6, 10 > 9, 6.0 = 6. */
export function compareVersions(a, b) {
  const n = Math.max(a.length, b.length);
  for (let i = 0; i < n; i += 1) {
    const x = a[i] ?? 0;
    const y = b[i] ?? 0;
    if (x !== y) return x > y ? 1 : -1;
  }
  return 0;
}

/** The ids a class may move to (§2.2 "Eligible"): inside the lane's discovery scope AND listed VISIBLE by its
 *  catalogue. An explicit discovery list may name a hidden row or one the catalogue lacks; neither is eligible.
 *  A never-probed lane has nothing eligible. Discovery order, each id once. */
export function eligibleIds(registry, catalogue) {
  if (catalogue === null || catalogue === undefined) return [];
  const visible = new Set(catalogue.models.filter((m) => !m.hidden).map((m) => m.id));
  return [...new Set(resolveDiscovery(registry, catalogue))].filter((id) => visible.has(id));
}

/**
 * `({registry, catalogue, cls, family}) => {candidate, reason, blocked}` — the model one class should move to
 * this hour, or why not. `family` is the class's stored family, or null when there is none.
 *  1. A pin that breaks the grammar is `blocked: 'pin-grammar'`: such a class never advances, and the
 *     `model-advance-blocked` WARN names it, so it cannot go quiet.
 *  2. THE FAMILY (D-5992). A PINNED class follows its pin's own family, whatever family is stored: a stored family
 *     that disagrees with the pin is stale (a hand set-class by a build from before the advance file, a hand-edited
 *     registry), and following it would move the class across families. The stored family decides only for an
 *     EMPTY class, which is what it exists for: an empty class with no family gets nothing, because it is filled
 *     only from a family stored for it (init's seed, or the backfill's), never from a guess.
 *  3. SHARED FAMILY (D-5819). Over every eligible id of the family, ties included, take its newest version. The
 *     class is `blocked: 'shared-family'` when an id at that version, other than the class's own pin, is
 *     another class's pin: two classes follow one family, and only the operator can say which keeps it. A model
 *     two classes pin is each one's own pin, so it blocks neither. The check reads the ties: a tied newest pair
 *     is tested like any other id, never skipped in favour of an older one.
 *  4. Then ties are dropped: any version two eligible ids share (6 and 6.0 included) loses both, so a tie is
 *     never a candidate until one of its ids leaves the catalogue. Only ELIGIBLE ids make a tie: a hidden twin,
 *     or one outside the discovery list, unties the other.
 *  5. Then, among the untied ids that neither this class nor another pins: an EMPTY class takes the newest
 *     (`empty`); a pinned class takes the newest STRICTLY newer than its pin (`newer`), and on a FRESH catalogue
 *     whether or not it still lists the pin, so a newer model never waits (D-8839); a pin a STALE catalogue does not
 *     list gets nothing, as before, because absence from a stale one is not evidence (D-5199). Failing a newer
 *     model, a pin a fresh catalogue no longer lists takes the newest left (`retired`, the one move that may go to an
 *     older version), and only once `retireDue` holds (programme wave 3, backward-move, D-8838): `missing`, the
 *     class's record of its run of sightings (`markMissing`), names this pin, its last sighting is this catalogue's
 *     own observation time (so a sighting whose record was never written proposes nothing), and the run spans at
 *     least `RETIRE_GRACE_MS`. Until then the class waits (`pinMissing` names it). A pin the catalogue lists HIDDEN
 *     is listed, so it is never retired.
 * Another class's pin is excluded in step 5 as well as tested in step 3, and a case pins it: when the family's
 * newest version is a tie of two ids nobody pins, step 3 stays quiet, and only the exclusion keeps a class off
 * the older id another class holds.
 * THE STALE GATE HERE COVERS A PIN THE CATALOGUE DOES NOT LIST ONLY. On a stale catalogue this function still names
 * a `newer` candidate for a pin it lists, or an `empty` one; the rule that nothing advances on a stale catalogue at all
 * (D-5199) is the ops' — `advance-plan` answers `why: catalogue-stale`, and
 * `advance-commit` abandons with it (W2 Tasks 8 and 9). A case pins this split, so neither half is "fixed" alone.
 */
export function chooseCandidate({ registry, catalogue, cls, family, missing, nowMs }) {
  const r = choose({ registry, catalogue, cls, family });
  if (r.older === undefined) return r.choice;
  return retireDue({ registry, catalogue, cls, missing, nowMs })
    ? { ...r.choice, candidate: r.older, reason: 'retired' } : r.choice;
}

/** `(catalogue) => 'YYYY-MM-DDTHH:MM:SSZ' | null`: when a FRESH catalogue was observed, its `fetchedAt` (whole epoch
 *  seconds, the probe's) in the advance file's time form; null for a stale or absent catalogue, or a `fetchedAt` that
 *  is not a time a `Date` holds (D-8838: an unmeasured time is no sighting). */
export function observedAt(catalogue) {
  if (catalogue === null || catalogue === undefined || catalogue.stale) return null;
  return isoSeconds(catalogue.fetchedAt * 1000);
}

/** Whether a class's run of sightings of its missing pin has qualified it to move `retired` (D-8838): the record names
 *  the pin and has a last sighting (`seen`; a record of the original shape has none, so it never qualifies), that
 *  sighting is this catalogue's own observation (`observedAt`), it is not later than `nowMs` (a future time never
 *  qualifies), and the run from `since` to `seen` spans at least `RETIRE_GRACE_MS`. Every comparison is written as one
 *  that HOLDS, so a time that does not parse fails it. */
function retireDue({ registry, catalogue, cls, missing, nowMs }) {
  const t = observedAt(catalogue);
  return t !== null && isObj(missing) && missing.model === registry.classes[cls] && isAt(missing.since)
    && missing.seen === t && Date.parse(t) <= nowMs && Date.parse(t) - Date.parse(missing.since) >= RETIRE_GRACE_MS;
}

/** `({registry, catalogue, cls, missing, nowMs}) => {model, since, until, older} | null`: the class `chooseCandidate`
 *  holds back on a missing pin (programme wave 3, backward-move, D-8838). Its pin is not listed by a FRESH catalogue,
 *  no model newer than the pin is free, and `older`, the newest model left in its family, is the `retired` move the
 *  grace has not yet allowed. `since` is when the class's current run of sightings began (`missing`, when it names
 *  this pin and records a last sighting; null when nothing has recorded a run yet), and `until` the EARLIEST the move
 *  can come, if every hourly sighting until then misses the pin (null with no `since`). Null on every other class, a
 *  class `retireDue` has qualified included: `chooseCandidate` names its move. Pure. */
export function pinMissing({ registry, catalogue, cls, missing, nowMs }) {
  const r = choose({ registry, catalogue, cls, family: null });
  if (r.older === undefined || retireDue({ registry, catalogue, cls, missing, nowMs })) return null;
  const pin = registry.classes[cls];
  const run = isObj(missing) && missing.model === pin && isAt(missing.since) && isAt(missing.seen);
  return { model: pin, since: run ? missing.since : null,
    until: run ? isoSeconds(Date.parse(missing.since) + RETIRE_GRACE_MS) : null, older: r.older };
}

/** The family rule's steps 1 to 5 (`chooseCandidate`'s comment), with the `retired` fallback held apart: `choice` is
 *  the answer with no retirement, and `older` the id a retirement would take, present only when the pin is not listed
 *  by a fresh catalogue and no newer model is free. */
function choose({ registry, catalogue, cls, family }) {
  const none = { candidate: null, reason: null, blocked: null };
  const pin = registry.classes[cls] ?? null;
  if (pin !== null && parseModelId(pin) === null) return { choice: { ...none, blocked: 'pin-grammar' } };
  const fam = pin !== null ? familyOf(pin) : family;   // D-5992: step 1 has refused a pin familyOf cannot read
  const inFamily = [];
  for (const id of eligibleIds(registry, catalogue)) {
    const p = parseModelId(id);
    if (p !== null && p.family === fam) inFamily.push({ id, version: p.version });
  }
  const otherPins = new Set(CLASSES.filter((c) => c !== cls).map((c) => registry.classes[c])
    .filter((v) => v !== null && v !== undefined));
  const topVersion = inFamily.reduce((v, m) => (v === null || compareVersions(m.version, v) > 0 ? m.version : v), null);
  if (topVersion !== null && inFamily.some((m) => compareVersions(m.version, topVersion) === 0
      && m.id !== pin && otherPins.has(m.id))) return { choice: { ...none, blocked: 'shared-family' } };
  const untied = inFamily.filter((m) => inFamily.filter((o) => compareVersions(o.version, m.version) === 0).length === 1);
  const newestFirst = [...untied].sort((x, y) => compareVersions(y.version, x.version));
  const free = newestFirst.filter((m) => m.id !== pin && !otherPins.has(m.id));
  if (pin === null) return { choice: free.length > 0 ? { ...none, candidate: free[0].id, reason: 'empty' } : none };
  if (catalogue === null || catalogue === undefined) return { choice: none };   // never probed: nothing is eligible
  const listed = catalogue.models.some((m) => m.id === pin);
  if (!listed && catalogue.stale) return { choice: none };   // D-5199: absence from a stale catalogue is no evidence
  const pinVersion = parseModelId(pin).version;
  const newer = free.filter((m) => compareVersions(m.version, pinVersion) > 0);
  if (newer.length > 0) return { choice: { ...none, candidate: newer[0].id, reason: 'newer' } };
  if (listed || free.length === 0) return { choice: none };
  return { choice: none, older: free[0].id };
}

/** `({registry, catalogue, cls, family, missing, nowMs}) => {candidate, reason, blocked, effortTo, canaryEffort}`: one
 *  class's candidate this hour (`chooseCandidate`) and the two effort levels that go with it (auto-advance spec §2.2
 *  to §2.3): `effortTo`, the level the class would carry on the candidate (`resolveEffort`, ranked by its pin's own
 *  row, D-5200; null: none), and `canaryEffort`, the lowest level the candidate lists (null: it lists none). Both null
 *  with no candidate. ONE computation for `advance-plan`, which reports it before the canary, and `advance-commit`,
 *  which re-checks it under the lock after the canary and writes its `effortTo`, so the level a plan names and the
 *  level a commit writes cannot differ. `family` is the class's stored family, which `chooseCandidate` reads for an
 *  EMPTY class only (D-5992); `missing` and `nowMs` are its grace on a missing pin. Moved here from
 *  `deploy/models-op.mjs` (programme wave 3), where it was the op's own; it is pure. */
export function candidateFor({ registry, catalogue, cls, family, missing, nowMs }) {
  const choice = chooseCandidate({ registry, catalogue, cls, family, missing, nowMs });
  if (choice.candidate === null) return { ...choice, effortTo: null, canaryEffort: null };
  const rowOf = (id) => catalogue.models.find((m) => m.id === id);
  const pin = registry.classes[cls];
  const next = rowOf(choice.candidate);
  const prev = pin === null ? undefined : rowOf(pin);
  const newEfforts = next === undefined ? [] : next.efforts;
  return {
    ...choice,
    effortTo: resolveEffort({
      stored: isObj(registry.effort) ? registry.effort[cls] : undefined,
      oldEfforts: prev === undefined ? null : prev.efforts,
      newEfforts,
    }) ?? null,
    canaryEffort: canaryEffort(newEfforts),
  };
}

/** `(adv, registry, catalogue, nowMs) => {advance, changed}`: each pinned class's `missing`, its run of sightings of
 *  a missing pin `{model, since, seen}`, brought up to date with one catalogue (programme wave 3, backward-move,
 *  D-8838). Only a FRESH catalogue with a measured observation time (`observedAt`) is a sighting: a stale or absent
 *  catalogue changes nothing either way.
 *   - A listed pin, or an empty class, loses its record, so a listed-again read ends the run.
 *   - A sighting later than `nowMs` is unmeasured: it starts or continues no run.
 *   - The same sighting twice (one catalogue read again) changes nothing.
 *   - A pin the catalogue does not list continues its run (`seen` moves to the sighting) when the record names that
 *     pin, has a last sighting, that sighting is earlier, and the gap is at most `RETIRE_GAP_MS`. Anything else
 *     restarts the run at this sighting: no record, one naming another model, one of the original shape (no `seen`),
 *     a gap past `RETIRE_GAP_MS` (a missed interval, or a clock that jumped forward), or a sighting earlier than the
 *     last one (a clock that went back).
 *  `changed` says whether the file would differ. The one writer is the hourly refresh's `materialise`, under the lane
 *  lock, after every successful probe and before the advance step reads the record; every other writer keeps the key
 *  as it keeps any unknown one. */
export function markMissing(adv, registry, catalogue, nowMs) {
  const t = observedAt(catalogue);
  if (t === null) return { advance: adv, changed: false };
  const tMs = Date.parse(t);
  const next = copy(adv);
  let changed = false;
  for (const cls of CLASSES) {
    const pin = registry.classes[cls] ?? null;
    const c = next.classes[cls];
    const m = c.missing;
    if (pin === null || catalogue.models.some((row) => row.id === pin)) {
      if (m !== undefined) { delete c.missing; changed = true; }
      continue;
    }
    if (!(tMs <= nowMs) || (isObj(m) && m.model === pin && m.seen === t)) continue;
    const run = isObj(m) && m.model === pin && isAt(m.since) && isAt(m.seen) && Date.parse(m.seen) < tMs
      && tMs - Date.parse(m.seen) <= RETIRE_GAP_MS;
    c.missing = { model: pin, since: run ? m.since : t, seen: t };
    changed = true;
  }
  return { advance: changed ? next : adv, changed };
}

/**
 * `({stored, oldEfforts, newEfforts}) => level | undefined` — the effort level a class carries onto a new model
 * (§2.3 step 4): the stored level when the new model offers it, or when its list is empty (unknown); otherwise
 * the highest level the new model offers that ranks BELOW the stored one by the OLD model's own order
 * (D-5200: the catalogue gives no order across models, and the old row is the one the
 * stored level was chosen from); with no old row, a stored level the old row does not list, or nothing below
 * it, the new model's lowest. A class with no stored level stays without one.
 */
export function resolveEffort({ stored, oldEfforts, newEfforts }) {
  if (stored === undefined) return undefined;
  if (newEfforts.length === 0 || newEfforts.includes(stored)) return stored;
  const rank = oldEfforts === null ? -1 : oldEfforts.indexOf(stored);
  for (let i = rank - 1; i >= 0; i -= 1) {
    if (newEfforts.includes(oldEfforts[i])) return oldEfforts[i];
  }
  return newEfforts[0]; // the model's lowest: the list is lowest first (see `canaryEffort`)
}

/** `(json, catalogue) => {registry, fallbacks} | null` (programme wave 3, effort-level-dropped, D-8842): a class
 *  registry `parseRegistry` refuses ONLY because a stored effort level is one its class's model no longer offers, read
 *  with each such level replaced by `resolveEffort`'s fallback, ranked by a catalogue row that still lists the stored
 *  level (D-5991's rule, as `revert` ranks it). Usually the next level down that the model offers (`max` on a model
 *  now offering up to `xhigh` becomes `xhigh`); with nothing below it offered, or no row listing it, the model's
 *  LOWEST, which can rank above the stored level. The new level is always one the model offers. `fallbacks` is one
 *  `{class, model, from, to}` per class that falls back, `CLASSES` order. Null for a registry that parses as it is,
 *  one refused for any other reason, or one still refused after the fallback: those are `registry-invalid` as before.
 *  Pure: the caller writes. */
export function effortFallbacks(json, catalogue) {
  const field = (fn) => { try { fn(); return null; } catch (e) { if (e instanceof RegistryInvalid) return e; throw e; } };
  if (field(() => parseRegistry(json, catalogue)) === null || !isObj(json) || !isObj(json.effort) || !isObj(json.classes)) {
    return null;
  }
  const rows = catalogue?.models ?? [];
  const next = copy(json);
  const fallbacks = [];
  for (const cls of CLASSES) {
    const from = next.effort[cls];
    const row = rows.find((m) => m.id === next.classes[cls]);
    if (typeof from !== 'string' || row === undefined || row.efforts.length === 0 || row.efforts.includes(from)) continue;
    const ranker = rows.find((m) => m.efforts.includes(from));
    const to = resolveEffort({ stored: from, oldEfforts: ranker?.efforts ?? null, newEfforts: row.efforts });
    next.effort[cls] = to;
    fallbacks.push({ class: cls, model: row.id, from, to });
  }
  let registry = null;
  if (fallbacks.length === 0 || field(() => { registry = parseRegistry(next, catalogue); }) !== null) return null;
  return { registry, fallbacks };
}

/** A class's effort level in a registry copy the caller is building (`next`, edited in place and returned): set to
 *  `level`, or removed for null, the `effort` map dropped once that was its last entry. ONE rule for every op that
 *  moves a level: `revert`, `advance-commit` and `set-effort` (moved here from `deploy/models-op.mjs`, programme wave 3). */
export function withEffort(next, cls, level) {
  if (level === null) {
    if (isObj(next.effort)) {
      delete next.effort[cls];
      if (Object.keys(next.effort).length === 0) delete next.effort;
    }
  } else {
    next.effort = { ...(isObj(next.effort) ? next.effort : {}), [cls]: level };
  }
  return next;
}

/** A history `reason` as the advance file's reader accepts it (plan §3.1):
 *  printable ASCII, at most `REASON_MAX` characters, the number `parseAdvance`
 *  holds every reason to. Every reason `deploy/models-op.mjs` records passes
 *  through it (moved here from that file, programme wave 3), the canary's
 *  (`--reason`) and its own, because one the reader refused would make the
 *  whole advance file unreadable, and every later advance on the lane blocked
 *  behind it. */
export const historyReason = (text) =>
  String(text).replace(/[^\x20-\x7e]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, REASON_MAX);

/** The canary's effort (§2.3 step 3): the lowest level the model offers, or null when it lists none.
 *  `efforts[0]` IS the lowest, here and in `resolveEffort`'s fallback: the probe keeps the provider's own order,
 *  and the recorded catalogue (`server/test/fixtures/catalogues/codex-raw-2026-09-08.json`) lists every row
 *  lowest first. A provider that reordered its levels would make this the wrong level, never an invalid one. */
export function canaryEffort(efforts) {
  return efforts.length > 0 ? efforts[0] : null;
}

// ── THE ADVANCE FILE (§2.1, D13, D21) ───────────────────────────────────────────────────────────────────────
// One per lane: per class the `family` it follows, an optional `hold`, the `previous` pin and its last moves
// (`history`), and one top-level `pending` intent. A SIBLING of the class registry, never a key in it:
// `parseRegistry` refuses any key it does not know, so an older ccrc after a rollback would refuse every lane's
// registry (D13). Unknown keys — top level, per class and per history entry — are PRESERVED: `parseAdvance`
// answers a deep copy of what it read, every function below edits a deep copy of what it was handed, and nothing
// rebuilds the object from the keys it knows. `deploy/models-op.mjs` reads and writes the file (`writeAdvance` is
// its one writer); this module only decides what the file holds.

export const ADVANCE_VERSION = 1;
export const HISTORY_CAP = 10;
export const HOWS = Object.freeze(['advance', 'revert', 'hand']);
export const CANARY_RESULTS = Object.freeze(['passed', 'failed', 'not-run']);
/** The act that set a hold (D-5190): the agent's child gets a fixed argv and a three-name
 *  environment that carry no caller, so the who is the ACT, and the server's audit line names the PWA session. */
export const HOLD_BY = Object.freeze(['hand', 'revert']);

/** Thrown by `parseAdvance`, carrying the offending FIELD as data (`RegistryInvalid`'s idiom): `v`,
 *  `classes.<class>.hold.by`, `pending.to`, or `''` for a top level that is not an object. */
export class AdvanceInvalid extends Error {
  constructor(field, message) {
    super(message);
    this.name = 'AdvanceInvalid';
    this.field = field;
  }
}

/** A stored time's one form, `YYYY-MM-DDTHH:MM:SSZ` (whole seconds, UTC; `isoSeconds` writes it), and its test. The one
 *  owner of that form: `shared/model-aliases.mjs` imports both. */
export const AT_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/;
/** A reason the file may hold: printable ASCII, at most `REASON_MAX` characters (Task 2's one number). */
const REASON_RE = new RegExp(`^[\\x20-\\x7e]{0,${REASON_MAX}}$`);
const isObj = (v) => typeof v === 'object' && v !== null && !Array.isArray(v);
export const isAt = (v) => typeof v === 'string' && AT_RE.test(v);
const isIdOrNull = (v) => v === null || (typeof v === 'string' && MODEL_ID_RE.test(v));
const isLevelOrNull = (v) => v === null || (typeof v === 'string' && v.length > 0);
const copy = (v) => JSON.parse(JSON.stringify(v));
const bad = (field, what) => { throw new AdvanceInvalid(field, `${field} ${what}`); };

function checkEntry(e, f) {
  if (!isObj(e)) bad(f, 'is not an object.');
  if (!isAt(e.at)) bad(`${f}.at`, 'is not a time of the form YYYY-MM-DDTHH:MM:SSZ.');
  if (!HOWS.includes(e.how)) bad(`${f}.how`, `is not one of ${HOWS.join(', ')}.`);
  if (!isIdOrNull(e.from)) bad(`${f}.from`, 'is not a model id or null.');
  if (!isIdOrNull(e.to)) bad(`${f}.to`, 'is not a model id or null.');
  if (typeof e.ok !== 'boolean') bad(`${f}.ok`, 'is not true or false.');
  if (!CANARY_RESULTS.includes(e.canary)) bad(`${f}.canary`, `is not one of ${CANARY_RESULTS.join(', ')}.`);
  if (e.effort !== undefined && !(isObj(e.effort) && isLevelOrNull(e.effort.from) && isLevelOrNull(e.effort.to))) {
    bad(`${f}.effort`, 'is not {"from": <level|null>, "to": <level|null>}.');
  }
  if (e.reason !== undefined && !(typeof e.reason === 'string' && REASON_RE.test(e.reason))) {
    bad(`${f}.reason`, `is not printable ASCII of at most ${REASON_MAX} characters.`);
  }
  const failedAdvance = e.how === 'advance' && e.ok === false;
  if (e.tries !== undefined && !(failedAdvance && Number.isInteger(e.tries) && e.tries >= 1)) {
    bad(`${f}.tries`, 'belongs on a failed advance only, as a whole number from 1.');
  }
  if (e.lastAt !== undefined && !(failedAdvance && isAt(e.lastAt))) {
    bad(`${f}.lastAt`, 'belongs on a failed advance only, as a time of the form YYYY-MM-DDTHH:MM:SSZ.');
  }
  if (e.recovered !== undefined && typeof e.recovered !== 'boolean') bad(`${f}.recovered`, 'is not true or false.');
  if (e.evidenceAt !== undefined && !isAt(e.evidenceAt)) {
    bad(`${f}.evidenceAt`, 'is not a time of the form YYYY-MM-DDTHH:MM:SSZ.');
  }
  if (e.cause !== undefined && !(e.how === 'advance' && CANDIDATE_REASONS.includes(e.cause))) {
    bad(`${f}.cause`, `belongs on an advance only, as one of ${CANDIDATE_REASONS.join(', ')}.`);
  }
}

/** The pending intent, in one of its two shapes (D-5188): an automatic advance's, with no
 *  `how` (`to` a model id, the two effort levels), or a hand set-class's, `how: 'hand'` (`to` a model id or null,
 *  and `emptied`, the OTHER classes one model, one class empties, each named once and only when `to` is a model). */
function checkPending(p) {
  if (p === null) return;
  if (!isObj(p)) {
    bad('pending', 'is not null or an intent: {"class", "from", "to", "effortFrom", "effortTo", "at"} for an '
      + 'automatic advance, {"how": "hand", "class", "from", "to", "emptied", "at"} for a hand set-class.');
  }
  if (p.how !== undefined && p.how !== 'hand') {
    bad('pending.how', 'is not "hand" (a hand set-class), or absent (an automatic advance).');
  }
  if (!CLASSES.includes(p.class)) bad('pending.class', `is not one of ${CLASSES.join(', ')}.`);
  if (!isIdOrNull(p.from)) bad('pending.from', 'is not a model id or null.');
  if (!isAt(p.at)) bad('pending.at', 'is not a time of the form YYYY-MM-DDTHH:MM:SSZ.');
  if (p.how === 'hand') {
    if (!isIdOrNull(p.to)) bad('pending.to', 'is not a model id or null.');
    if (!Array.isArray(p.emptied)
        || p.emptied.some((c, i) => !CLASSES.includes(c) || c === p.class || p.emptied.indexOf(c) !== i)) {
      bad('pending.emptied', 'is not a list of the OTHER classes this set-class empties, each named once.');
    }
    if (p.emptied.length > 0 && p.to === null) {
      bad('pending.emptied', 'names a class, but a set-class to none empties no other class.');
    }
    return;
  }
  if (!(typeof p.to === 'string' && MODEL_ID_RE.test(p.to))) bad('pending.to', 'is not a model id.');
  if (!isLevelOrNull(p.effortFrom)) bad('pending.effortFrom', 'is not an effort level or null.');
  if (!isLevelOrNull(p.effortTo)) bad('pending.effortTo', 'is not an effort level or null.');
  if (p.cause !== undefined && !CANDIDATE_REASONS.includes(p.cause)) {
    bad('pending.cause', `is not one of ${CANDIDATE_REASONS.join(', ')}.`);
  }
}

/** What a file written from `value` would hold, and what its next reader would parse: `value`'s JSON round trip,
 *  which keeps every own key and drops what JSON cannot carry (an inherited key; a hole in a list, which comes back
 *  as null). A value `JSON.stringify` cannot copy, because it nests too deeply (`JSON.stringify` recurses and
 *  `JSON.parse` does not, so such a file parses) or is too large, is refused as `AdvanceInvalid` at the top
 *  level, so it never escapes a reader or the writer as a RangeError. */
function fileCopy(value) {
  let text;
  try {
    text = JSON.stringify(value);
  } catch (e) {
    if (e instanceof RangeError) {
      throw new AdvanceInvalid('',
        `this advance file nests too deeply, or is too large, to be written back (${e.message}).`);
    }
    throw e;
  }
  return text === undefined ? undefined : JSON.parse(text);
}

/** `(json) => Advance`: an advance file read off disk, COPIED FIRST (`fileCopy`), then the copy validated field by
 *  field (throws `AdvanceInvalid` naming the field) and answered, every key it does not know kept. Checking the
 *  copy, never the object handed in, is what makes `writeAdvance`'s read-back check the bytes it writes. Every
 *  class must be present with all four facts; `hold`, `previous` and `pending` are `null` when unset, never
 *  absent. */
export function parseAdvance(input) {
  const json = fileCopy(input);
  if (!isObj(json)) {
    throw new AdvanceInvalid('', 'an advance file must be a JSON object: {"v": 1, "classes": {…}, "pending": null}.');
  }
  if (json.v !== ADVANCE_VERSION) bad('v', `is ${JSON.stringify(json.v)}: this build reads version ${ADVANCE_VERSION} only.`);
  if (!isObj(json.classes)) bad('classes', 'is missing or is not an object.');
  for (const k of Object.keys(json.classes)) {
    if (!CLASSES.includes(k)) bad(`classes.${k}`, `is not a class: the four are ${CLASSES.join(', ')}.`);
  }
  for (const c of CLASSES) {
    const f = `classes.${c}`;
    const x = json.classes[c];
    if (!isObj(x)) bad(f, 'is missing or is not an object.');
    if (!(x.family === null || (typeof x.family === 'string' && WORD_RE.test(x.family)))) {
      bad(`${f}.family`, 'is not a family word (a lowercase letter, then lowercase letters and digits) or null.');
    }
    if (x.hold !== null) {
      if (!isObj(x.hold)) bad(`${f}.hold`, 'is not null or {"at": <time>, "by": <act>}.');
      if (!isAt(x.hold.at)) bad(`${f}.hold.at`, 'is not a time of the form YYYY-MM-DDTHH:MM:SSZ.');
      if (!HOLD_BY.includes(x.hold.by)) bad(`${f}.hold.by`, `is not one of ${HOLD_BY.join(', ')}.`);
      // An Anthropic lane's hold names the id it holds (model-class Anthropic arm, Task A2.3); absent on every other.
      if (x.hold.model !== undefined && !(typeof x.hold.model === 'string' && MODEL_ID_RE.test(x.hold.model))) {
        bad(`${f}.hold.model`, 'is not a model id.');
      }
    }
    if (x.releasedAt !== undefined && !isAt(x.releasedAt)) {
      bad(`${f}.releasedAt`, 'is not a time of the form YYYY-MM-DDTHH:MM:SSZ.');
    }
    // Programme wave 3: the run of sightings of a missing pin (`markMissing`; `seen` optional, so a record of the
    // first shape still reads, and restarts), and the effort fallback the refresh last wrote (`recordEffortFallbacks`).
    // Optional, so every file written before reads; an older build keeps both.
    const ms = x.missing;
    if (ms !== undefined && !(isObj(ms) && isIdOrNull(ms.model) && ms.model !== null && isAt(ms.since)
        && (ms.seen === undefined || isAt(ms.seen)))) {
      bad(`${f}.missing`, 'is not {"model": <id>, "since": <time>, "seen": <time>}.');
    }
    const fb = x.effortFallback;
    if (fb !== undefined && !(isObj(fb) && isAt(fb.at) && typeof fb.model === 'string' && MODEL_ID_RE.test(fb.model)
        && isLevelOrNull(fb.from) && fb.from !== null && isLevelOrNull(fb.to) && fb.to !== null)) {
      bad(`${f}.effortFallback`, 'is not {"at": <time>, "model": <id>, "from": <level>, "to": <level>}.');
    }
    if (x.previous !== null) {
      if (!isObj(x.previous)) bad(`${f}.previous`, 'is not null or {"model": <id|null>, "effort": <level|null>}.');
      if (!isIdOrNull(x.previous.model)) bad(`${f}.previous.model`, 'is not a model id or null.');
      if (!isLevelOrNull(x.previous.effort)) bad(`${f}.previous.effort`, 'is not an effort level or null.');
    }
    if (!Array.isArray(x.history)) bad(`${f}.history`, 'is not a list.');
    if (x.history.length > HISTORY_CAP) bad(`${f}.history`, `holds ${x.history.length} entries; it keeps at most ${HISTORY_CAP}.`);
    x.history.forEach((e, i) => checkEntry(e, `${f}.history[${i}]`));
  }
  checkPending(json.pending);
  return json;
}

/** The file's bytes: 2-space JSON and a trailing newline, the shape every hand-editable ccrc file has. */
export function serializeAdvance(adv) {
  return `${JSON.stringify(adv, null, 2)}\n`;
}

/** The advance file a lane starts with (§2.1, §2.2 Seeding): each pinned class the family of its pin (null for a
 *  pin that breaks the grammar), each EMPTY class the seed family it is given (null with no seeds), and no hold,
 *  previous or history. A seed never overrides a pin. */
export function backfillAdvance({ registry, seedFamilies }) {
  const classes = {};
  for (const c of CLASSES) {
    const pin = registry.classes[c] ?? null;
    classes[c] = { family: pin !== null ? familyOf(pin) : (seedFamilies?.[c] ?? null), hold: null, previous: null, history: [] };
  }
  return { v: ADVANCE_VERSION, classes, pending: null };
}

/** The advance file an Anthropic lane starts with (model-class Anthropic arm, Task A2.3): it has no class registry to
 *  read a family off, so each class's `family` is its own class word, and there is no hold, previous or history and no
 *  pending intent. A fresh object each call. */
export function seedAnthropicAdvance() {
  const classes = {};
  for (const c of CLASSES) classes[c] = { family: c, hold: null, previous: null, history: [] };
  return { v: ADVANCE_VERSION, classes, pending: null };
}

/** One history entry appended to a class, newest last, keeping the newest `HISTORY_CAP`. */
export function recordMove(adv, cls, e) {
  const next = copy(adv);
  const h = next.classes[cls].history;
  h.push(copy(e));
  if (h.length > HISTORY_CAP) h.splice(0, h.length - HISTORY_CAP);
  return next;
}

/** A reason as the file may hold it: printable ASCII, at most `REASON_MAX` characters. */
const cleanReason = (s) => String(s).replace(/[^\x20-\x7e]/g, '?').slice(0, REASON_MAX);

/** A failed advance (D-5192). When the class's NEWEST entry is already a failed advance of
 *  the same `from` and `to`, that entry is updated (`tries` + 1, `lastAt`, the latest reason) and `isNew` is
 *  false; otherwise one entry is appended and `isNew` is true. That is what makes a failure "one push, not one an
 *  hour" (§2.3 step 6), and it keeps real moves from being evicted by the cap. Every entry it writes or updates
 *  says `canary: 'failed'`; a caller whose canary passed and a later step failed (W2's failed materialise)
 *  overwrites that word on the entry it gets back. */
export function recordFailure(adv, cls, f) {
  const next = copy(adv);
  const reason = cleanReason(f.reason);
  const history = next.classes[cls].history;
  const last = history[history.length - 1];
  if (last !== undefined && last.how === 'advance' && last.ok === false && last.from === f.from && last.to === f.to) {
    last.tries = (Number.isInteger(last.tries) ? last.tries : 1) + 1;
    last.lastAt = f.at;
    last.reason = reason;
    last.canary = 'failed';
    return { advance: next, isNew: false };
  }
  const e = {
    at: f.at, how: 'advance', from: f.from, to: f.to, ok: false, canary: 'failed', reason, tries: 1, lastAt: f.at,
  };
  return { advance: recordMove(next, cls, e), isNew: true };
}

/** The crash gap (D-5188). A writer that moves a pin writes `pending` under the lane lock
 *  BEFORE it renames the registry, and clears it once the move is recorded, so a writer killed in between leaves the
 *  intent behind. Every locked writer calls this first. When the registry's pin for the intent's class is its `to`,
 *  the move landed and is recorded; any other pin means it never landed, and the intent is dropped. Two shapes:
 *   - an AUTOMATIC advance's (no `how`; W2's `advance-commit`): recorded as a successful advance with
 *     `recovered: true` and `previous` set (D-5189), and the intent's `cause` when it carries one (D-8384);
 *   - a HAND set-class's (`how: 'hand'`; Task 5): recorded exactly as set-class records its own move, because
 *     set-class settles its intent through this very function. One `how: 'hand'` entry for the class it named and
 *     for each class it emptied (one model, one class) whose pin is still none, each from its old pin to its new
 *     one; the family of each of those classes rewritten from its pin, CLEARED when the pin is none or breaks the
 *     id grammar (D-5195), even for a named class whose pin did not move (which gets no
 *     entry, because nothing moved); `previous` left alone, so Revert still undoes the last automatic advance. No
 *     `recovered` mark on those entries: they record the operator's act, which owes no push.
 *  Either way `pending` comes back null, and `recovered` is true when an intent of either shape landed and was
 *  recorded: a caller that reports recovered moves reads the intent's `how` before it calls this, and reports a
 *  landed hand move as hand, never as an advance. With no intent the advance comes back as it was. */
export function reconcilePending(adv, registry) {
  const p = adv.pending;
  if (p === null) return { advance: adv, recovered: false };
  let next = copy(adv);
  next.pending = null;
  if (registry.classes[p.class] !== p.to) return { advance: next, recovered: false };
  if (p.how === 'hand') {
    const moves = [[p.class, p.from, p.to],
      ...p.emptied.filter((c) => registry.classes[c] === null).map((c) => [c, p.to, null])];
    for (const [c, from, to] of moves) {
      next.classes[c].family = familyOf(to);
      if (from !== to) next = recordMove(next, c, { at: p.at, how: 'hand', from, to, ok: true, canary: 'not-run' });
    }
    return { advance: next, recovered: true };
  }
  next.classes[p.class].previous = { model: p.from, effort: p.effortFrom };
  const e = {
    at: p.at, how: 'advance', from: p.from, to: p.to, ok: true, canary: 'passed',
    ...(p.effortFrom !== p.effortTo ? { effort: { from: p.effortFrom, to: p.effortTo } } : {}),
    ...(p.cause !== undefined ? { cause: p.cause } : {}),
    recovered: true,
  };
  return { advance: recordMove(next, p.class, e), recovered: true };
}

/** The entry `model-advance-held-back` reports, or null: the class's NEWEST entry, when it is a failed advance
 *  whose `to` is still the class's candidate (D-5191: a candidate that moved on clears
 *  it). */
export function heldBackOf(c, candidate) {
  const last = c.history[c.history.length - 1];
  return last !== undefined && candidate !== null && last.how === 'advance' && last.ok === false && last.to === candidate
    ? last : null;
}

/** `(adv, fallbacks, at) => Advance`: each `effortFallbacks` row recorded on its class as `effortFallback`, `{at, model,
 *  from, to}`, replacing the one before (programme wave 3, effort-level-dropped). Not a history entry: an older build's
 *  `parseAdvance` refuses an entry `how` or `cause` it does not know, and would then read the whole file as invalid. */
export function recordEffortFallbacks(adv, fallbacks, at) {
  const next = copy(adv);
  for (const f of fallbacks) next.classes[f.class].effortFallback = { at, model: f.model, from: f.from, to: f.to };
  return next;
}

/** The class's recorded effort fallback while it still stands, or null (D-8842): the class still pins the model it was
 *  recorded on, still carries the level it fell back to, and the catalogue's row for that model does not offer the old
 *  level again. A move, a hand level (`set-effort` deletes the record, `clearEffortFallback`), or the old level offered
 *  again ends it; the refresh deletes a record that no longer stands (`refreshRecord`), and never puts the old level
 *  back over the one the class runs at. */
export function effortFallbackOf(c, registry, cls, catalogue) {
  const fb = isObj(c) ? c.effortFallback : undefined;
  const level = isObj(registry.effort) ? registry.effort[cls] : undefined;
  if (!(isObj(fb) && fb.model === registry.classes[cls] && fb.to === level)) return null;
  const row = catalogue?.models.find((m) => m.id === fb.model);
  return row !== undefined && row.efforts.includes(fb.from) ? null : fb;
}

/** `({registry, catalogue, cls, c, nowMs}) => [{cause, detail}]`: one class's programme wave 3 rows for
 *  `advance-health`'s `blocked` list, in the op's words (D-8838, D-8842): `effort-fallback` while a recorded fallback
 *  stands (`effortFallbackOf`), and `pin-missing` while an unheld class waits out its grace (`pinMissing`; a held class
 *  is quiet about it, D-8840). `c` is the class's advance entry, or null. Pure. */
export function classWaits({ registry, catalogue, cls, c, nowMs }) {
  const rows = [];
  const fb = effortFallbackOf(c, registry, cls, catalogue);
  if (fb !== null) {
    rows.push({ cause: 'effort-fallback', detail: `${fb.model} no longer offers effort ${fb.from}, so since ${fb.at} `
      + `it runs at ${fb.to}, the fallback the hourly refresh chose` });
  }
  const gone = c !== null && c.hold !== null ? null : pinMissing({ registry, catalogue, cls, missing: c?.missing, nowMs });
  if (gone !== null) {
    rows.push({ cause: 'pin-missing', detail: `${gone.model} is missing from the lane's catalogue${gone.since === null
      ? '' : ` since ${gone.since}`}; the class moves to ${gone.older}, an older model, once every hourly sighting has `
      + `missed it for six hours (${gone.until === null ? 'counted from the next sighting the refresh records'
      : `${gone.until} at the earliest`}), and any sighting that lists it again ends the wait` });
  }
  return rows;
}

/** `advance-health`'s detail for a registry still refused for a dropped level (`effort-dropped`, D-8842), one per
 *  `effortFallbacks` row. `onDisk` when the lane's effort file already carries the fallback: a refresh wrote it, then
 *  could not render the files from the stored registry it put back (D-8865). */
export const effortDroppedDetail = (f, onDisk = false) => `${f.model} no longer offers effort ${f.from}, so the lane's `
  + `registry is refused until the hourly refresh writes the fallback, ${f.to}${onDisk ? `, which the lane's effort file `
  + 'already carries: a refresh wrote it and could not put that file back' : ''}`;

/** Why the automatic advance does not act on a lane that has a class registry, or null when it does (auto-advance
 *  spec §2.2; D-5198). The first that applies:
 *    - `lane-not-codex-kind`: only an `exec.kind: "codex"` row advances; an external row's tier, port and key are
 *      not ccrc's to know;
 *    - `probe-not-codex`: the family rule is the Codex lanes', so a registry whose probe is not `codex` never
 *      advances.
 *  A fact about the lane, never a refusal: each op of the advance step reports it as its `why`. ONE answer for all
 *  of them, so they can never disagree about which lanes advance: `advance-backfill` and `advance-plan` call it, and
 *  W2 Task 9's `advance-commit` calls it too. */
export function advanceIneligible(account, registry) {
  if (!(isObj(account.exec) && account.exec.kind === 'codex')) return 'lane-not-codex-kind';
  if (registry.probe !== 'codex') return 'probe-not-codex';
  return null;
}

/** `(adv, cls) => {advance, changed}`: the class's `effortFallback` deleted, after a hand `set-effort` on it succeeded
 *  (any level, the one it already runs at included): the operator has chosen the level (D-8842). */
export function clearEffortFallback(adv, cls) {
  if (adv.classes[cls].effortFallback === undefined) return { advance: adv, changed: false };
  const next = copy(adv);
  delete next.classes[cls].effortFallback;
  return { advance: next, changed: true };
}

/** `(adv, {registry, catalogue, fallbacks, nowMs}) => {advance, changed}`: what the hourly refresh's `materialise`
 *  records on the lane's advance file after one probe (D-8838, D-8842), as one write: each class's run of sightings of
 *  a missing pin (`markMissing`), each effort fallback it just wrote (`recordEffortFallbacks`, at the sighting's own
 *  clock), and the deletion of every recorded fallback that no longer stands (`effortFallbackOf`). Pure. */
export function refreshRecord(adv, { registry, catalogue, fallbacks, nowMs }) {
  const m = markMissing(adv, registry, catalogue, nowMs);
  const next = recordEffortFallbacks(m.advance, fallbacks, isoSeconds(nowMs));
  let changed = m.changed || fallbacks.length > 0;
  for (const cls of CLASSES) {
    const c = next.classes[cls];
    if (c.effortFallback !== undefined && effortFallbackOf(c, registry, cls, catalogue) === null) {
      delete c.effortFallback;
      changed = true;
    }
  }
  return { advance: changed ? next : adv, changed };
}

/** The class's newest entry that succeeded, of any kind, or null. */
export function lastMoveOf(c) {
  for (let i = c.history.length - 1; i >= 0; i -= 1) {
    if (c.history[i].ok === true) return c.history[i];
  }
  return null;
}

/** Why an advance entry moved (D-8384): its `cause`, one of `CANDIDATE_REASONS`, or `unknown` for an entry written
 *  before the field existed, or one that is not an advance's. Never throws: an old file reads, it is not an error. */
export function causeOf(e) {
  return e !== null && typeof e === 'object' && e.how === 'advance' && CANDIDATE_REASONS.includes(e.cause)
    ? e.cause : 'unknown';
}

const ownWindow = (windows, id) => windows !== null && windows !== undefined
  && Object.prototype.hasOwnProperty.call(windows, id) && typeof windows[id] === 'number';

/**
 * `({registry, advance, windows, rule, tokens}) => Move[]` — the classes whose last move lowered the lane's context
 * window (D-8384, public issue #2607): the lane's window `rule` (`contextWindowFor`'s, in `shared/modelenv.mjs`) is
 * not `measured`, the class's pin has no measured window in `windows`, the class's newest successful history entry
 * moved it TO that pin FROM a model `windows` does measure, and `tokens`, the window now in force
 * (`contextWindowFor`'s `tokens`, null when no key is written), is below that old model's measured window. Under
 * D-8564 an unmeasured model runs at its provider's promise, so a move to one whose promise is at least the old
 * measured window lowered nothing and is not named. One row per such class, `CLASSES` order:
 * `{class, from, to, fromTokens, how, cause}`, `cause` being `causeOf`'s word on an advance and null on a hand move or
 * a revert. A lane whose window is measured, or with no advance file (`advance` null), has none. Pure: the caller
 * reads the files.
 */
export function unmeasuredMoves({ registry, advance, windows, rule, tokens }) {
  if (rule === 'measured' || advance === null || advance === undefined) return [];
  const rows = [];
  for (const cls of CLASSES) {
    const pin = registry.classes[cls] ?? null;
    if (pin === null || ownWindow(windows, pin) || !isObj(advance.classes?.[cls])) continue;
    const last = lastMoveOf(advance.classes[cls]);
    if (last === null || last.to !== pin || last.from === null || !ownWindow(windows, last.from)) continue;
    if (tokens !== null && tokens >= windows[last.from]) continue;
    rows.push({ class: cls, from: last.from, to: pin, fromTokens: windows[last.from], how: last.how,
      cause: last.how === 'advance' ? causeOf(last) : null });
  }
  return rows;
}

/** What each kind of move is called in `unmeasuredMoveNotice`, by `how` and, for an advance, by `cause`. */
const MOVE_WORDS = Object.freeze({
  newer: 'auto-advance to a newer model',
  retired: 'auto-advance because the old model was retired',
  empty: 'auto-advance into an empty class',
  unknown: 'auto-advance, its reason not recorded',
  hand: 'set by hand',
  revert: 'a revert',
});

/** THE ONE SPELLING of the notice for one `unmeasuredMoves` row (D-8384): `ccrc models <id> show` answers it as
 *  `windowNotices`, and `ccrc doctor`'s `models` row prints it as a WARN. `lane` is the lane's id and `tokens` the
 *  window now in force (`contextWindowFor`'s `tokens`, null when no key is written). It names the unmeasured model
 *  and the remedy, and carries no lane, account or machine of its own: every name in it comes from the arguments. */
export function unmeasuredMoveNotice(lane, m, tokens) {
  const what = MOVE_WORDS[m.how === 'advance' ? (m.cause ?? 'unknown') : m.how] ?? MOVE_WORDS.unknown;
  const now = tokens === null ? "the client's own default window" : `${tokens} tokens`;
  return `${lane}'s ${m.class} class moved from ${m.from} to ${m.to} (${what}), and ${m.to} has no measured window `
    + `while ${m.from} had ${m.fromTokens} tokens, so every session on the lane now runs at ${now}; measure ${m.to}, `
    + `then: ccrc models ${lane} set-window ${m.to} <tokens>`;
}

/** THE ONE SPELLING of the other way a lane's window falls (D-8685, public issue #2607): its catalogue is STALE, so
 *  `contextWindowFor` cannot read a class model's advertised window (`providerWindow` never reads a stale one), that
 *  model has no measured window, and the lane falls to the client's own default (`room.source === 'client'`, which
 *  `contextWindowFor` chooses only when it is below every window it could read). `room` is `contextWindowFor`'s
 *  answer and `stale` whether the lane's catalogue is marked stale. Null on every other lane, so a fresh catalogue
 *  that simply lists no window for a model is not named here (D-8685 rules the stale case). The catalogue's
 *  advertised window is never offered as a measurement: the remedies are a refresh, or a measurement. Pure. */
export function clientWindowNotice(lane, registry, stale, room) {
  if (stale !== true || room === null || typeof room !== 'object' || room.source !== 'client') return null;
  if (typeof room.model !== 'string' || typeof room.tokens !== 'number') return null;
  const cls = CLASSES.find((c) => registry.classes[c] === room.model);
  if (cls === undefined) return null;
  return `${lane}'s ${cls} class model ${room.model} has no measured window, and the lane's catalogue is stale, so `
    + `its advertised window is not read: every session on the lane now runs at the client's own default window, `
    + `${room.tokens} tokens; refresh the catalogue (ccrc models refresh ${lane}), or measure ${room.model}, then: `
    + `ccrc models ${lane} set-window ${room.model} <tokens>`;
}

// ── SESSIONS BEHIND A MOVE (§2.8; plan W3 Task 14) ──────────────────────────────────────────────────────────────
// `model-sessions-behind` is the backstop for a running session that kept a model a move replaced: the plan's
// Task 1 measured that a running session does not reliably pick up a re-pin by itself. This half decides, from the
// evidence its caller read (the session's main-thread turn marker and its status line's usage sidecar), whether one
// session is behind. Still pure: it reads no file and no clock. `isoSeconds` formats a time it is handed.

/** How long after a move a session still on the model it replaced counts as behind: one day (§2.8). Defined once,
 *  here, for the op and for any later reader of its answer. */
export const BEHIND_AFTER_MS = 86_400_000;
/** The largest epoch, in ms, a JS `Date` holds. */
const EPOCH_MS_MAX = 8.64e15;
/** A usage sidecar's `ts` is whole SECONDS (the status line writes `date +%s`). A value past this is not seconds
 *  (thirteen digits of milliseconds, say) and is never compared, so a writer that slipped into milliseconds can never
 *  make a render look newer than every turn. 99999999999 s is in the year 5138. */
export const SIDECAR_TS_MAX_S = 99_999_999_999;
const isEpochMs = (v) => Number.isInteger(v) && v >= 0 && v <= EPOCH_MS_MAX;

/** `(ms) => 'YYYY-MM-DDTHH:MM:SSZ' | null`: an epoch in ms in the advance file's own time form, cut to whole
 *  seconds; null for anything that is not an epoch a `Date` holds. It formats the time it is handed and never reads
 *  the clock. */
export function isoSeconds(ms) {
  if (!isEpochMs(ms)) return null;
  return new Date(ms).toISOString().replace(/\.\d{3}Z$/, 'Z');
}

/**
 * `({advance, registry, nowMs, turn, usage}) => {class, from, to, movedAt, turnAt, renderAt} | null`: whether ONE
 * session of a lane is behind a move (§2.8). It names the evidence, the render and the turn, not a ccd reason
 * (D-5194). The caller has matched the session to the lane (its registry `.wrapper`)
 * and parsed its two files; `turn` and `usage` are whatever JSON they held, and are checked here. Behind means ALL of:
 *  1. the marker names a main-thread turn: `sessionId` a non-empty string, `turnAt` an epoch in ms;
 *  2. the sidecar is the session's own main-loop render of that same Claude Code session: `ts` whole seconds;
 *     `agent` null or absent (a subagent's render goes to a file of its own, and one that names an agent here is not
 *     the main loop's); `uuid` equal to the marker's `sessionId` (a `/clear` between them rotates it); `model` an id;
 *  3. the render came after that turn began: `ts`, read as ms, strictly later than `turnAt`. A render in the same
 *     second may predate the turn, so it is not evidence;
 *  4. no class of the lane pins that model now: a session on another class's model is not behind;
 *  5. some class's history holds a SUCCESSFUL move away from that model, at least `BEHIND_AFTER_MS` before `nowMs`,
 *     and the turn began after it. A move after `nowMs` (a clock set back) never counts. The NEWEST such entry of each
 *     class is judged, not only the class's newest move, so a session two moves behind is still behind
 *     (D-5222). Classes are tried in `CLASSES` order; the first that holds answers.
 * Anything else is null: an input it cannot read is never a finding (§2.8, "failures fail shut"). Every time test is
 * written as a comparison that HOLDS for evidence, negated, so a NaN fails it: a clock that is not a number, a move
 * time that does not parse and a render dated before 1970 (never later than a turn, which is never negative) are
 * each "not behind" with no guard of their own. The caller (`advance-health`) names, apart, a session whose files it
 * could not read as JSON objects; this rule only judges what it is handed.
 */
export function sessionBehind({ advance, registry, nowMs, turn, usage }) {
  if (!isObj(turn) || !isObj(usage)) return null;
  const sid = turn.sessionId;
  const turnAt = turn.turnAt;
  if (typeof sid !== 'string' || sid === '' || !isEpochMs(turnAt)) return null;
  const { ts, uuid, model, agent } = usage;
  if (!Number.isInteger(ts) || ts > SIDECAR_TS_MAX_S) return null;
  if (agent !== undefined && agent !== null) return null;
  if (uuid !== sid || typeof model !== 'string' || model === '') return null;
  const renderMs = ts * 1000;
  if (!(renderMs > turnAt)) return null;
  if (CLASSES.some((c) => registry.classes[c] === model)) return null;
  for (const cls of CLASSES) {
    const history = advance.classes[cls].history;
    let move = null;
    for (let i = history.length - 1; i >= 0; i -= 1) {
      if (history[i].ok === true && history[i].from === model) { move = history[i]; break; }
    }
    if (move === null) continue;
    const movedMs = Date.parse(move.at);
    if (!(movedMs <= nowMs - BEHIND_AFTER_MS) || !(turnAt > movedMs)) continue;
    return { class: cls, from: move.from, to: move.to, movedAt: move.at, turnAt: isoSeconds(turnAt),
      renderAt: isoSeconds(renderMs) };
  }
  return null;
}

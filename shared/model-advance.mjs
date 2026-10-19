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
import { CLASSES, MODEL_ID_RE, resolveDiscovery } from './models.mjs';

/** Every reason a lane or a class cannot advance, the words `model-advance-blocked` names. `chooseCandidate`
 *  answers the two that are a fact about one class; the others are facts about a lane's files or its kind.
 *  `windows-unreadable`, `shared-family` and `lane-not-codex-kind` are this plan's additions to the spec's list
 *  (D-5193), so none of them goes quiet. */
export const BLOCKED_CAUSES = Object.freeze([
  'advance-file-unreadable', 'advance-file-invalid', 'registry-unreadable', 'registry-invalid',
  'catalogue-unreadable', 'catalogue-invalid', 'windows-unreadable', 'pin-grammar', 'shared-family',
  'lane-not-codex-kind',
]);

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
 *  2. A missing family is derived from the pin. An empty class with no family gets nothing: an empty class is
 *     filled only from a family stored for it (init's seed, or the backfill's), never from a guess.
 *  3. SHARED FAMILY (D-5819). Over every eligible id of the family, ties included, take its newest version. The
 *     class is `blocked: 'shared-family'` when an id at that version, other than the class's own pin, is
 *     another class's pin: two classes follow one family, and only the operator can say which keeps it. A model
 *     two classes pin is each one's own pin, so it blocks neither. The check reads the ties: a tied newest pair
 *     is tested like any other id, never skipped in favour of an older one.
 *  4. Then ties are dropped: any version two eligible ids share (6 and 6.0 included) loses both, so a tie is
 *     never a candidate until one of its ids leaves the catalogue. Only ELIGIBLE ids make a tie: a hidden twin,
 *     or one outside the discovery list, unties the other.
 *  5. Then, among the untied ids that neither this class nor another pins: an EMPTY class takes the newest
 *     (`empty`); a pin the catalogue no longer lists takes the newest (`retired`, the one move that may go to
 *     an older version) but only on a catalogue that is fresh, because absence from a stale one is not evidence
 *     (D-5199); otherwise the newest STRICTLY newer than the pin (`newer`). A pin the catalogue lists HIDDEN is
 *     listed, so it is never retired.
 * Another class's pin is excluded in step 5 as well as tested in step 3, and a case pins it: when the family's
 * newest version is a tie of two ids nobody pins, step 3 stays quiet, and only the exclusion keeps a class off
 * the older id another class holds.
 * THE STALE GATE HERE COVERS THE RETIRED FALLBACK ONLY. On a stale catalogue this function still names a `newer`
 * or an `empty` candidate; the rule that nothing advances on a stale catalogue at all
 * (D-5199) is the ops' — `advance-plan` answers `why: catalogue-stale`, and
 * `advance-commit` abandons with it (W2 Tasks 8 and 9). A case pins this split, so neither half is "fixed" alone.
 */
export function chooseCandidate({ registry, catalogue, cls, family }) {
  const none = { candidate: null, reason: null, blocked: null };
  const pin = registry.classes[cls] ?? null;
  if (pin !== null && parseModelId(pin) === null) return { ...none, blocked: 'pin-grammar' };
  const fam = family ?? familyOf(pin);
  const inFamily = [];
  for (const id of eligibleIds(registry, catalogue)) {
    const p = parseModelId(id);
    if (p !== null && p.family === fam) inFamily.push({ id, version: p.version });
  }
  const otherPins = new Set(CLASSES.filter((c) => c !== cls).map((c) => registry.classes[c])
    .filter((v) => v !== null && v !== undefined));
  const topVersion = inFamily.reduce((v, m) => (v === null || compareVersions(m.version, v) > 0 ? m.version : v), null);
  if (topVersion !== null && inFamily.some((m) => compareVersions(m.version, topVersion) === 0
      && m.id !== pin && otherPins.has(m.id))) return { ...none, blocked: 'shared-family' };
  const untied = inFamily.filter((m) => inFamily.filter((o) => compareVersions(o.version, m.version) === 0).length === 1);
  const newestFirst = [...untied].sort((x, y) => compareVersions(y.version, x.version));
  const free = newestFirst.filter((m) => m.id !== pin && !otherPins.has(m.id));
  if (pin === null) return free.length > 0 ? { ...none, candidate: free[0].id, reason: 'empty' } : none;
  const listed = catalogue !== null && catalogue !== undefined && catalogue.models.some((m) => m.id === pin);
  if (!listed) {
    if (catalogue === null || catalogue === undefined || catalogue.stale) return none;
    return free.length > 0 ? { ...none, candidate: free[0].id, reason: 'retired' } : none;
  }
  const pinVersion = parseModelId(pin).version;
  const newer = free.filter((m) => compareVersions(m.version, pinVersion) > 0);
  return newer.length > 0 ? { ...none, candidate: newer[0].id, reason: 'newer' } : none;
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

const AT_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/;
/** A reason the file may hold: printable ASCII, at most `REASON_MAX` characters (Task 2's one number). */
const REASON_RE = new RegExp(`^[\\x20-\\x7e]{0,${REASON_MAX}}$`);
const isObj = (v) => typeof v === 'object' && v !== null && !Array.isArray(v);
const isAt = (v) => typeof v === 'string' && AT_RE.test(v);
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
}

/** `(json) => Advance`: an advance file read off disk, validated field by field (throws `AdvanceInvalid` naming
 *  the field), and answered as a deep COPY with every key it does not know kept. Every class must be present
 *  with all four facts; `hold`, `previous` and `pending` are `null` when unset, never absent. */
export function parseAdvance(json) {
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
  return copy(json);
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
 *     `recovered: true` and `previous` set (D-5189);
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

/** The class's newest entry that succeeded, of any kind, or null. */
export function lastMoveOf(c) {
  for (let i = c.history.length - 1; i >= 0; i -= 1) {
    if (c.history[i].ok === true) return c.history[i];
  }
  return null;
}

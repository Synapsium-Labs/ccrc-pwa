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
import { CLASSES, resolveDiscovery } from './models.mjs';

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

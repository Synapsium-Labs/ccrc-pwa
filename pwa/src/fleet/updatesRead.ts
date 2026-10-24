// The update plane's pure readers (ARCH-30, #544), out of `useUpdatesView`'s hook file so they import without React:
// the wire guard for `GET /api/updates`' answer (`asUpdatesView`) and the two reads of its nodes every update surface
// shares (`newestPending`, `behindSince`). The guard kit is `lib/wire.ts`'s.
import { isReleaseTag, type NodeWire, type UpdatesView } from '../../../shared/api';
import { compareReleaseTags } from '../../../shared/semver';
import { nodeVersion, pendingTag } from '../../../shared/update-arrow';
import { isRecord } from '../lib/wire';

/** `isPlaceableInstant` lives in `lib/format.ts` with `releaseDate`, its date reader (D-5897); re-exported for its
 *  readers here. */
export { isPlaceableInstant } from '../lib/format';

/** A node element the renderers can read without throwing (fix round 1, F11/
 *  item 6; widened fix round 2 review, items 2/5): `versionSides` dereferences
 *  `.role` (`shared/update-summary.ts`), `pendingTag`/`nodeVersion` (below)
 *  dereference `.measuredAt` and `.current`, `BuildLine`/`FleetHostBanner` read
 *  `.current.sha` off a `BuildInfo` that arrives whatever shape the wire hands
 *  them, and `SettingsScreen`'s `NodeItem` renders `{n.label}` as a React CHILD
 *  — an object there does not throw, it blanks the row with React's own "Objects
 *  are not valid as a React child" error, screen-wide with no error boundary.
 *  None of those reads needs its VALUE to be the exact wire type (`role` is
 *  only ever compared with `===`), only that dereferencing it cannot throw and
 *  that a rendered field is a primitive — so this checks structure (object; a
 *  nullable field is that type or null; `label` a string; `current`, where
 *  present, is an object whose `sha` is a string; `reachable` a boolean,
 *  REQUIRED, never tolerated absent — `NodeWire.reachable` is not optional on
 *  the wire (shared/api.ts), `statedOf`/`pendingTag` read it `=== true` and
 *  `reachabilityLine` reads a confirmed `=== false`, and an element silent
 *  about it is neither of those two spellings (W5 review 161, F-B; corrects
 *  fix round 2 item 5's "absent tolerated", which was itself the bug), the
 *  same discipline
 *  `asUpdatesView`'s catalogue check already applies one level up. */
const isNodeElement = (v: unknown): v is NodeWire => {
  if (!isRecord(v)) return false;
  if (typeof v.role !== 'string' && v.role !== null) return false;
  if (typeof v.label !== 'string') return false;
  if (typeof v.measuredAt !== 'number' && v.measuredAt !== null) return false;
  // W5 review 161 (F-B): `NodeWire.reachable` is a REQUIRED boolean
  // (shared/api.ts), never optional — `statedOf`/`pendingTag` read it
  // `=== true` and `reachabilityLine` reads a confirmed `false`, so an
  // element that says NOTHING about `reachable` is not one of those two
  // spellings either; a non-conforming server that omits the field is
  // dropped exactly as one that sends a stray non-boolean is, never
  // tolerated as "unknown, treat like absent".
  if (typeof v.reachable !== 'boolean') return false;
  if (v.current !== null) {
    if (!isRecord(v.current) || typeof (v.current as { sha?: unknown }).sha !== 'string') return false;
  }
  return true;
};

/** A release element the renderers can read: `ReleaseItem`/`sortReleases` key
 *  and compare on `.tag`. */
const isReleaseElement = (v: unknown): v is UpdatesView['releases'][number] =>
  isRecord(v) && typeof (v as { tag?: unknown }).tag === 'string';

/** An intent element the renderers can read: `NotificationsSection` and
 *  `UpdatesBody` find a row by `.scope` and compare `.setAt` (a number). */
const isIntentElement = (v: unknown): v is UpdatesView['intent'][number] =>
  isRecord(v) && typeof (v as { scope?: unknown }).scope === 'string'
  && typeof (v as { setAt?: unknown }).setAt === 'number';

/**
 * The wire guard: null unless the answer has the `UpdatesView` SHAPE — a
 * catalogue line whose two fields are what they claim, and three arrays. A
 * malformed answer (a proxy's HTML, a stub `{}`, an older server's other JSON)
 * is a FAILURE the caller reports, never an empty fleet it renders as "nothing
 * to update".
 *
 * The catalogue's FIELDS are checked, not only that it is an object, because
 * every surface decides "checked" on `lastOkAt !== null` and `undefined !==
 * null` is true: `{catalogue: {}}` passing here would render a "checked" line
 * for a catalogue nobody reached (spec §18 "unreachable is not current").
 *
 * Fix round 1 (F11, item 6): each ELEMENT of the three arrays is also
 * checked, for the fields the renderers actually dereference — a `null` node
 * or one whose `current` has no string `sha` used to reach FleetScreen and
 * throw with no error boundary (`pwa/src` has none), blanking the whole
 * screen for one bad row a non-conforming server or a rewriting intermediary
 * sent. A non-conforming element is DROPPED, not a reason to refuse the whole
 * answer — the other, well-formed rows are real fleet state and stay
 * rendered — with exactly ONE `console.warn` for the answer, however many
 * elements it drops, so a chatty malformed poll cannot flood the console once
 * per row every 60 s.
 */
export function asUpdatesView(raw: unknown): UpdatesView | null {
  if (!isRecord(raw)) return null;
  const { catalogue, releases, nodes, intent } = raw;
  if (!isRecord(catalogue)) return null;
  const { lastOkAt, lastError } = catalogue;
  if (lastOkAt !== null && !(typeof lastOkAt === 'number' && Number.isFinite(lastOkAt))) return null;
  if (lastError !== null
    && !(isRecord(lastError) && typeof lastError['at'] === 'number' && typeof lastError['reason'] === 'string')) {
    return null;
  }
  if (!Array.isArray(releases) || !Array.isArray(nodes) || !Array.isArray(intent)) return null;
  const okNodes = nodes.filter(isNodeElement);
  const okReleases = releases.filter(isReleaseElement);
  const okIntent = intent.filter(isIntentElement);
  const dropped = (nodes.length - okNodes.length) + (releases.length - okReleases.length)
    + (intent.length - okIntent.length);
  // Every element conformed: hand back the SAME object the caller passed in,
  // unchanged (`.filter` always allocates, even keeping everything) — a well-
  // formed answer's identity is a pin (`asUpdatesView(v)).toBe(v)`), and
  // rebuilding it here for no reason would be a needless allocation on every
  // one of the ordinary 60s polls that never sees a bad row.
  if (dropped === 0) return raw as unknown as UpdatesView;
  console.warn(`ccrc: /api/updates dropped ${dropped} malformed element(s) it could not read — the rest still rendered.`);
  return {
    catalogue: catalogue as unknown as UpdatesView['catalogue'], releases: okReleases, nodes: okNodes, intent: okIntent,
    // The box-token card's field (D-4392) rides through untouched: this guard does not judge it, its ONE reader
    // (`readBoxTokenView`, lib/api.ts) does, and a rebuild that dropped it would blank the card for a bad node row.
    ...(raw.boxToken !== undefined ? { boxToken: raw.boxToken as UpdatesView['boxToken'] } : {}),
  };
}

// THE ONE ARROW PREDICATE (`pendingTag`) and `nodeVersion` beside it now live
// in L0 (`shared/update-arrow.ts`): BuildLine moved into @ccrc/ui, and a
// design-system component cannot reach into this file — it owns the
// `GET /api/updates` poll, and therefore the API client. They are re-exported
// here, unchanged, so SettingsScreen, releaseWaiting.ts, movePlan and their tests
// keep the import they already have and there is still ONE definition.
export { nodeVersion, pendingTag } from '../../../shared/update-arrow';

/** The release a waiting update names: the NEWEST `pendingTag` across the inventory in semver order, with the node
 *  behind it. One definition for the fleet's update line (`bannerRelease`, fleet/releaseWaiting.ts) and the Settings release window
 *  (`releaseWindow`, D-5505), so the two cannot name different waiting releases. `null` when no node has an arrow. */
export function newestPending(nodes: readonly NodeWire[] | null | undefined): { tag: string; node: NodeWire } | null {
  let best: { tag: string; node: NodeWire } | null = null;
  for (const n of Array.isArray(nodes) ? nodes : []) {
    const tag = pendingTag(n);
    if (tag === null) continue;
    if (best === null || compareReleaseTags(tag, best.tag) === 1) best = { tag, node: n };
  }
  return best;
}

/** The oldest measured version a node that is behind runs (a node with an arrow, `pendingTag`): what the What's-new
 *  range counts from (`whatsNewReleases`), and the version the release window's "See every change since" names.
 *  `null` when no behind node has a measured version. */
export function behindSince(nodes: readonly NodeWire[] | null | undefined): string | null {
  let since: string | null = null;
  for (const n of Array.isArray(nodes) ? nodes : []) {
    if (pendingTag(n) === null) continue;
    const v = nodeVersion(n);
    if (!isReleaseTag(v)) continue;
    if (since === null || compareReleaseTags(v, since) === -1) since = v;
  }
  return since;
}

// The ONE poll of `GET /api/updates` (design 2026-09-20 §13; W3 Task 5), and
// the two pure readers every update surface shares — the settings screen, the
// fleet banner and BuildLine all read THIS file's answers, so none of them can
// hold its own opinion of what "malformed" or "behind" means.
//
// The hook is `useFleetHealth`'s shape — newest issued request authoritative,
// `pollMs <= 0` as the injected mode, one poll per screen handed down — with
// two additions that hook does not need. (1) It keeps the last GOOD view across
// a failed poll and reports the failure BESIDE it rather than instead of it:
// the settings screen must not blank a node list because one read timed out,
// and must not claim the list is fresh either. (2) It re-polls when the page
// becomes visible, because a phone that slept through three polls should not
// show a 3-minute-old "vX is out" as current.
import { useCallback, useEffect, useRef, useState } from 'react';
import { isReleaseTag, isUpdateChannel, type NodeWire, type UpdatesView } from '../../../shared/api';
import { isNewerTag } from '../../../shared/semver';
import { ApiError, api } from '../lib/api';

/** THE ONE invalid-Date predicate (fix round 1, F13/item 8): a `lastOkAt`/
 *  `lastError.at`/`publishedAt`/`unreachableSince`/a request's `at` magnitude
 *  this build's `Date` cannot place — a caller's own `typeof x === 'number'`
 *  guard only rules out a non-number; 1e20 is finite but `new Date(1e20)` is
 *  Invalid Date. Moved here (from SettingsScreen.tsx, which had it
 *  module-private) so the banner's `bannerRelease` can share it: the two
 *  surfaces disagreeing about what "the catalogue was reached" means was
 *  itself a defect (F13) — the settings screen routed `catalogue.lastOkAt`
 *  through this, the banner did not, and `lastOkAt: 1e20` had one saying
 *  "checked" while the other stayed silent. One predicate, one import, both
 *  surfaces read the same answer. */
export const isPlaceableInstant = (ms: number): boolean => !Number.isNaN(new Date(ms).getTime());

/** The read's cadence. The spec names none for the PWA; 60 s is the server's
 *  own fastest cadence over these rows — the inventory sweep
 *  (`UPDATE_INVENTORY_MS`, `server/src/watch.ts`, design §9's "every inventory
 *  sweep (60 s)"); the catalogue poll is 30 min — so a faster read would fetch
 *  the same rows again. The visibility refresh covers a phone that slept
 *  through polls. */
export const UPDATES_POLL_MS = 60_000;

/** Why the latest poll produced no view — two words, because the screen says
 *  two different things: `not-configured` is a box with no control plane (a
 *  state, rendered as such), `failed` is a read that did not land (transient). */
export type UpdatesFailure = 'not-configured' | 'failed';

export interface UpdatesPoll {
  /** The LAST GOOD answer — a later failure never clears it. */
  view: UpdatesView | null;
  /** The latest poll's failure; null after a good answer. */
  failure: UpdatesFailure | null;
  /** One poll now (after a write), under the same newest-issued guard. A no-op
   *  in the injected mode: a consumer handed its view re-polls through its parent. */
  reload: () => void;
}

const isObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

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
 *  present, is an object whose `sha` is a string; `reachable`, where PRESENT,
 *  is a boolean — absent tolerated, wire discipline, but a malformed non-
 *  boolean is not, since `statedOf`/`pendingTag` read it `=== true` and a
 *  stray truthy non-boolean must not silently vouch), the same discipline
 *  `asUpdatesView`'s catalogue check already applies one level up. */
const isNodeElement = (v: unknown): v is NodeWire => {
  if (!isObject(v)) return false;
  if (typeof v.role !== 'string' && v.role !== null) return false;
  if (typeof v.label !== 'string') return false;
  if (typeof v.measuredAt !== 'number' && v.measuredAt !== null) return false;
  if (v.reachable !== undefined && typeof v.reachable !== 'boolean') return false;
  if (v.current !== null) {
    if (!isObject(v.current) || typeof (v.current as { sha?: unknown }).sha !== 'string') return false;
  }
  return true;
};

/** A release element the renderers can read: `ReleaseItem`/`sortReleases` key
 *  and compare on `.tag`. */
const isReleaseElement = (v: unknown): v is UpdatesView['releases'][number] =>
  isObject(v) && typeof (v as { tag?: unknown }).tag === 'string';

/** An intent element the renderers can read: `NotificationsSection` and
 *  `UpdatesBody` find a row by `.scope` and compare `.setAt` (a number). */
const isIntentElement = (v: unknown): v is UpdatesView['intent'][number] =>
  isObject(v) && typeof (v as { scope?: unknown }).scope === 'string'
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
  if (!isObject(raw)) return null;
  const { catalogue, releases, nodes, intent } = raw;
  if (!isObject(catalogue)) return null;
  const { lastOkAt, lastError } = catalogue;
  if (lastOkAt !== null && !(typeof lastOkAt === 'number' && Number.isFinite(lastOkAt))) return null;
  if (lastError !== null
    && !(isObject(lastError) && typeof lastError['at'] === 'number' && typeof lastError['reason'] === 'string')) {
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
  };
}

/** The node's running tag, or null when there is none to compare: no stamp, an
 *  untagged build, or a `version` that is not a release tag. */
export function nodeVersion(n: NodeWire): string | null {
  const v = n.current?.version;
  return isReleaseTag(v) ? v : null;
}

/**
 * THE ONE ARROW PREDICATE — the tag a node should move UP to, or null. Read by
 * the node inventory (Task 9), the fleet banner (Task 11) and BuildLine's affix
 * (Task 12); none of them compares tags itself.
 *
 * No arrow while the node is UNMEASURED or has NO RESOLVED CHANNEL (spec §18
 * "unreachable is not current"): `typeof … === 'number'` and `isUpdateChannel`
 * rather than `!== null`, so an absent field reads as "don't know", never as
 * measured. No arrow for a desired tag that is not a tag, or not NEWER than the
 * running one — a desired tag below it is a rollback's direction, which is not
 * an update arrow. Newer is `isNewerTag` (semver: `v0.0.10` > `v0.0.9`), after
 * `isReleaseTag` on both sides, because it throws on a non-tag. A node running
 * nothing comparable (unversioned) points at its desired tag — but only when its
 * stamp was READ: `stampRead` other than `ok` (EACCES, malformed, absent) is an
 * unmeasured current, which W2 also reports as a null `current`, and draws no
 * arrow (spec §13 Pins; §18 "`stampRead` keeps EACCES from unversioned";
 * D-3307). No arrow for a macOS node either: this
 * programme does not manage one (decision 17), and its row says so in place of
 * a desired — the rule is here, not in that row, so the banner and BuildLine
 * say the same (`os: 'unknown'` is not Darwin; D-3309).
 *
 * Fix round 2 (review of d5aefc4a, item 4): no arrow either while the node is
 * UNREACHABLE (`reachable !== true`) — D-3316's own text, ruled to widen from
 * "no side states a version" to the arrow too: an unreachable node is treated
 * exactly like one whose stamp did not read (D-3307, the clause right above),
 * so BuildLine's affix, the settings inventory's `→ vX` and the banner's own
 * "is this node behind" question all agree — an unreachable node offers
 * nothing to move up to, on any of the three surfaces this one predicate
 * feeds. The settings row still says "unreachable since …" (`reachabilityLine`,
 * unaffected); only the ARROW is gone.
 */
export function pendingTag(n: NodeWire): string | null {
  if (typeof n.measuredAt !== 'number') return null;
  if (!isUpdateChannel(n.channel)) return null;
  if (n.stampRead !== 'ok') return null;
  if (n.reachable !== true) return null;
  if (n.os === 'darwin') return null;
  const want = n.desiredTag;
  if (!isReleaseTag(want)) return null;
  const have = nodeVersion(n);
  return have === null || isNewerTag(want, have) ? want : null;
}

/** `not-configured` needs BOTH the status and the code: a 501 carrying any other
 *  word is a read that failed, and folding it into "this box has no control
 *  plane" would overload one value with two conditions the screen renders
 *  differently. */
const failureOf = (err: unknown): UpdatesFailure =>
  err instanceof ApiError && err.status === 501
    && typeof err.body === 'object' && err.body !== null
    && (err.body as { error?: unknown }).error === 'not-configured'
    ? 'not-configured'
    : 'failed';

/**
 * `GET /api/updates` every `pollMs` and whenever the page becomes visible.
 * Newest ISSUED request authoritative — an older in-flight answer, good or bad,
 * never overwrites a newer one (`useFleetHealth`'s issued/mine guard). State is
 * set functionally, so a failure keeps whatever view the previous commit held.
 * `pollMs <= 0` is the injected mode: no request, no interval, no listener.
 */
export function useUpdatesView(pollMs: number = UPDATES_POLL_MS): UpdatesPoll {
  const [state, setState] = useState<{ view: UpdatesView | null; failure: UpdatesFailure | null }>(
    { view: null, failure: null });
  const loadRef = useRef<() => void>(() => {});

  useEffect(() => {
    if (pollMs <= 0) return undefined;   // an injected consumer never polls
    let live = true;
    let issued = 0;
    const load = (): void => {
      const mine = ++issued;
      void api.updates().then(
        (raw) => {
          if (!live || mine !== issued) return;
          const view = asUpdatesView(raw);
          setState((prev) => (view === null ? { view: prev.view, failure: 'failed' } : { view, failure: null }));
        },
        (err: unknown) => {
          if (!live || mine !== issued) return;
          const failure = failureOf(err);
          setState((prev) => ({ view: prev.view, failure }));
        },
      );
    };
    const onVisible = (): void => {
      if (document.visibilityState === 'visible') load();
    };
    loadRef.current = load;
    load();
    const t = setInterval(load, pollMs);
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      live = false;
      loadRef.current = () => {};
      clearInterval(t);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [pollMs]);

  const reload = useCallback(() => { loadRef.current(); }, []);
  return { view: state.view, failure: state.failure, reload };
}

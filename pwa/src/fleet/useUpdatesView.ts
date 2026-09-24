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
 * Elements are passed through as the wire types — the server is their one
 * writer — and each reader below still tolerates an absent field.
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
  return raw as unknown as UpdatesView;
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
 */
export function pendingTag(n: NodeWire): string | null {
  if (typeof n.measuredAt !== 'number') return null;
  if (!isUpdateChannel(n.channel)) return null;
  if (n.stampRead !== 'ok') return null;
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

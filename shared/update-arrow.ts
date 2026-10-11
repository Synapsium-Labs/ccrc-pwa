// THE ONE ARROW PREDICATE and the tag it compares against, in L0 so every
// surface that draws `→ vX` reads the same answer.
//
// They lived in `pwa/src/fleet/useUpdatesView.ts` — the file that also owns the
// `GET /api/updates` poll and therefore the API client — until BuildLine moved
// into @ccrc/ui in the composite-migration wave. A presentational component in
// the design system cannot import the app's polling hook to find out whether a
// node is behind, and these two functions never needed it: they are pure reads
// of a `NodeWire`. `useUpdatesView.ts` re-exports both, so every existing
// reader (SettingsScreen, UpdateBanner, movePlan and their tests) keeps its
// import and there is still exactly one definition.
import { isReleaseTag, isUpdateChannel, type NodeWire } from './api.js';
import { isNewerTag } from './semver.js';
import { statedOf } from './update-summary.js';

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
 *
 * W5 review 161 (F-J): the measuredAt/stampRead/reachable trio above is
 * `statedOf`'s (`shared/update-summary.ts`) own three-clause fact — "does
 * this reading vouch for its version" — read through it rather than
 * re-derived inline, which was itself a second, undetected copy of the
 * predicate `single-definition.test.ts` exists to forbid.
 */
export function pendingTag(n: NodeWire): string | null {
  if (!statedOf(n)) return null;
  if (!isUpdateChannel(n.channel)) return null;
  if (n.os === 'darwin') return null;
  const want = n.desiredTag;
  if (!isReleaseTag(want)) return null;
  const have = nodeVersion(n);
  return have === null || isNewerTag(want, have) ? want : null;
}

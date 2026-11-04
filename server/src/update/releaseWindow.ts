// L1 — THE RELEASE WINDOW of GET /api/updates (console speed S2, step 4). Pure: no fs, no store, no fastify, no clock.
//
// `CoordStore.releases()` stays WHOLE: the planner and the release notice need the whole catalogue. Only the WIRE is
// limited, by this function, to the rows the PWA's own window can need (`releaseWindow` and `sortReleases` in
// `pwa/src/screens/updates.tsx` — a function of the same name in another package, not imported here):
//   1. the newest `recent` releases;
//   2. every release newer than the oldest installed tag of any node (the What's-new sheet lists that span, and
//      Newer reads its tail);
//   3. every previous and intent tag, however old (Roll back's "ran before" row; the pinned target);
//   4. per installed tag, the newest `stableBack` Stable releases older than it (Roll back's list).
// Ordering and "newer/older" are the PWA's: `compareReleaseTags` over release-tag rows, newest first, and rows whose
// tag is not a release tag keep their input order after them. `compareReleaseTags` throws on a non-tag, so every
// call is behind `isReleaseTag`; an installed, previous or intent value that is not a release tag is ignored by
// rules 2 and 4 (rule 3 still matches any string exactly) and never throws.
import { isReleaseTag } from '../../../shared/api.js';
import { compareReleaseTags, isNewerTag } from '../../../shared/semver.js';

/** The newest releases always on the wire (rule 1). */
export const RELEASE_WINDOW_RECENT = 30;
/** The older Stable releases kept per installed tag (rule 4). */
export const RELEASE_WINDOW_STABLE_BACK = 3;

export interface ReleaseWindowContext {
  /** Every node's measured version; a value that is not a release tag (null, unmeasured, garbage) is ignored. */
  readonly installed: readonly string[];
  readonly previous: readonly string[];
  readonly intentTags: readonly string[];
  readonly recent: number;
  readonly stableBack: number;
}

export function releaseWindow<R extends { tag: string; channel: string | null }>(
  releases: readonly R[], ctx: ReleaseWindowContext,
): R[] {
  // Newest first; `filter` returns fresh arrays, so the stable sort never reorders the caller's list.
  const tagged = releases.filter((r) => isReleaseTag(r.tag));
  tagged.sort((a, b) => compareReleaseTags(b.tag, a.tag));
  const sorted = [...tagged, ...releases.filter((r) => !isReleaseTag(r.tag))];

  const installed = ctx.installed.filter((t): t is string => isReleaseTag(t));
  const keep = new Set<R>();

  // 1. The newest `recent`.
  for (const r of sorted.slice(0, Math.max(0, ctx.recent))) keep.add(r);

  // 2. Everything newer than the oldest installed tag.
  const oldest = installed.reduce<string | null>((lo, t) => (lo === null || compareReleaseTags(t, lo) < 0 ? t : lo), null);
  if (oldest !== null) for (const r of tagged) if (isNewerTag(r.tag, oldest)) keep.add(r);

  // 3. Previous and intent tags, by exact match.
  const named = new Set<string>([...ctx.previous, ...ctx.intentTags]);
  for (const r of releases) if (named.has(r.tag)) keep.add(r);

  // 4. Per installed tag, the newest `stableBack` Stable releases older than it (`tagged` is newest first).
  for (const t of new Set(installed)) {
    let taken = 0;
    for (const r of tagged) {
      if (taken >= ctx.stableBack) break;
      if (r.channel === 'stable' && isNewerTag(t, r.tag)) { keep.add(r); taken++; }
    }
  }

  return sorted.filter((r) => keep.has(r));
}

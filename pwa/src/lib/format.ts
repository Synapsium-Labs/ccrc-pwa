// D-5897 (ARCH-05, #551): the PWA's pure formatters, a leaf that imports nothing. Each one was defined inside the
// module of its first reader, and a later reader had to import that whole module. `humanBytes` lived in
// `screens/ArchiveScreen.tsx`, `timeOf` in `session/MessageBubble.tsx`, `releaseDate` in `screens/updates.tsx`, and
// `isPlaceableInstant` in `fleet/useUpdatesView.ts`, which re-exports it. So a word module loaded a screen, a
// component or a hook. `screens-back-edges.test.ts` pins this file's import list at empty.

/** A byte count in the fleet's one size spelling: the archive footer, the archive screen's total, a session's
 *  cleanup chip and the reap sheet's words all read it. */
export function humanBytes(n: number): string {
  if (n >= 1e9) return `${(n / 1e9).toFixed(1)} GB`;
  if (n >= 1e6) return `${Math.round(n / 1e6)} MB`;
  if (n >= 1e3) return `${Math.round(n / 1e3)} kB`;
  return `${n} B`;
}

/** 'HH:MM' from an ISO ts; '' when unparsable (receipts degrade quietly). */
export function timeOf(ts: string): string {
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return '';
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

/** THE ONE invalid-Date predicate (fix round 1, F13/item 8): a `lastOkAt`/
 *  `lastError.at`/`publishedAt`/`unreachableSince`/a request's `at` magnitude
 *  this build's `Date` cannot place — a caller's own `typeof x === 'number'`
 *  guard only rules out a non-number; 1e20 is finite but `new Date(1e20)` is
 *  Invalid Date. Moved here (from SettingsScreen.tsx, which had it
 *  module-private) so `bannerRelease` (fleet/releaseWaiting.ts) can share it: the two
 *  surfaces disagreeing about what "the catalogue was reached" means was
 *  itself a defect (F13) — the settings screen routed `catalogue.lastOkAt`
 *  through this, the banner did not, and `lastOkAt: 1e20` had one saying
 *  "checked" while the other stayed silent. One predicate, one import, both
 *  surfaces read the same answer. */
export const isPlaceableInstant = (ms: number): boolean => !Number.isNaN(new Date(ms).getTime());

/** A release's UTC calendar day, or the missing mark for a time this build's `Date` cannot place. */
export function releaseDate(ms: number): string {
  return typeof ms === 'number' && isPlaceableInstant(ms) ? new Date(ms).toISOString().slice(0, 10) : '—';
}

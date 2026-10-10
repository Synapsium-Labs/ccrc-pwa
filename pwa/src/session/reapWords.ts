// The reap sheet's WORDS — every sentence it builds out of a measurement,
// and the one word it uses for a measurement nobody took.
//
// WHY IT IS ITS OWN FILE, and why it is named like `runWords`,
// `spawnWords` and `lifecycleWords`: these five are pure, they are the whole
// of this surface's "a number is a measurement" discipline, and every one of
// them carries a long argument about what it refuses to say. Separated, they
// are reachable by a test directly instead of only through a render — which
// matters most for the branches a real audit reaches rarely.
import type { WsAuditChild } from '../../../shared/api';
// Pre-merge fix round, finding 6: byte-for-byte identical to the local
// `bytes()` the sheet used to define — one shared formatter, imported,
// rather than two copies that could drift. `ArchiveScreen.tsx` is the
// existing home (`FleetScreen.tsx` already imports it from there).
import { humanBytes } from '../screens/ArchiveScreen';

export const days = (epochSeconds: number): string => {
  const d = Math.floor((Date.now() / 1000 - epochSeconds) / 86_400);
  return d <= 0 ? 'today' : `${d} day${d === 1 ? '' : 's'} ago`;
};

/** The one word this sheet uses for a read that never happened — final-round
 *  tests review F3. It is a SINGLE constant rather than five string literals
 *  because the rows below must be indistinguishable in kind: a reader who
 *  learns what it means on the "not in git" row must not have to learn it
 *  again on "uncommitted".
 *
 *  It is deliberately NOT `sizeText`'s "unknown" / "size unknown". Those two
 *  say "a measurement was attempted and could not be completed" — a `du` that
 *  failed on one subdirectory. This says "no measurement was attempted at
 *  all", which is a different fact and, on a refusal that leaves the worktree
 *  standing, the more important one. The seam pass's residual #8 asked for
 *  exactly this: two kinds of "we are not telling you a number" on one sheet,
 *  worded apart. */
export const NOT_SCANNED = 'not scanned';

/** A byte total this screen was actually given, or the word for not having been
 *  given one. Every size on the delete-confirmation surface goes through here.
 *
 *  `A number is a measurement`: a failed `du` yields `null`, never `0` — the
 *  house rule deviation 10 and pre-merge finding F already closed for
 *  `worktreeBytes`. `ignoredBytes` is the same figure for the not-in-git tree
 *  and ccd is being fixed (verifier round 3 P3, ccd lane) to stop answering a
 *  failed read with `0`; this is the display half, and it is safe to land
 *  first because the honest branch is simply unreachable while the producer
 *  still fabricates.
 *
 *  The parameter is wider than `WsAudit` currently declares on purpose. The
 *  wire type for `ignoredBytes` is still `number` (widening it is svc's, and
 *  `worktreeBytes` is already `number | null`), so this accepts `undefined`
 *  too: an old server, or a field dropped anywhere between ccd and here,
 *  renders the honest word instead of `NaN B`. Nothing about that degradation
 *  waits on another lane.
 *
 *  `unknown` is a parameter only because the two rows read differently: the
 *  worktree row is a bare figure in its own `<span>`, the not-in-git row is
 *  inline after a count, where a bare "unknown" would not say unknown WHAT. */
export const sizeText = (bytes: number | null | undefined, unknown = 'unknown'): string =>
  (typeof bytes === 'number' ? humanBytes(bytes) : unknown);

/** The clips' total, which is a SUM and therefore the one figure here that can
 *  be wrong without any single input being wrong: `n + c.bytes` silently
 *  under-counts an unmeasured clip (`3 + null === 3`) and produces `NaN` for a
 *  missing one — a partial total, which the house rule bans by name alongside
 *  `0`. Same producer class as the two rows above, and the same answer
 *  ArchiveScreen already gives for a partially measured set: state what WAS
 *  measured and disclose the rest, rather than fold the unknown into the
 *  number.
 *
 *  PRODUCER LANDED (cross-lane seam round). When this was written, the ccd
 *  half still fabricated `0` and `clips[].bytes` was `number` on the wire, so
 *  every branch below was reachable only from a fixture that went past the
 *  compile-time type — disclosed as such at the time. `_ws_clip_manifest`
 *  (ccd:4010/3109) now emits `null` for a clip it could not size, and
 *  `WsAudit['clips'][number]['bytes']` is `number | null`, so the unmeasured
 *  branches are reachable from a real audit and the fixtures no longer have to
 *  lie to reach them. The earlier disclosure worried the producer might land
 *  as `-1` or as an omitted field instead; it landed as `null`, and the
 *  parameter stays deliberately wider than the wire (`undefined` too) so an
 *  older server or a dropped field degrades to the honest word rather than to
 *  `NaN B` — the same defence `sizeText` above carries, for the same reason. */
export const clipsSizeText = (clips: { bytes: number | null | undefined }[]): string => {
  const measured = clips.map((c) => c.bytes).filter((b): b is number => typeof b === 'number');
  const unmeasured = clips.length - measured.length;
  if (measured.length === 0) return 'size unknown';
  const total = humanBytes(measured.reduce((n, b) => n + b, 0));
  return unmeasured === 0 ? total : `${total} + ${unmeasured} unmeasured`;
};

/** One line per nested checkout (D4): a `stray` earns no claim about its
 *  state beyond existing at `path` — `WsAuditChild`'s own docstring is why
 *  (an unregistered checkout ccd did not create). A registered child gets
 *  its real reading: the branch it is on, how many paths are uncommitted
 *  THERE, and the git operation in progress there, if any. `dirty === null`
 *  is defensive rather than reachable today — the type admits it, and this
 *  row refuses to print "null uncommitted" the same way every other row on
 *  this sheet refuses an unmeasured figure. */
export const childLine = (c: WsAuditChild): string => {
  if (c.stray) return `${c.path} — not registered with git, contents unknown`;
  const dirty = c.dirty === null ? NOT_SCANNED : `${c.dirty} uncommitted`;
  const mid = c.busy !== null ? `, mid-${c.busy}` : '';
  return `${c.path} — ${c.branch ?? 'detached'}, ${dirty}${mid}`;
};

// What a box is RUNNING, stated by the box itself: the stamp
// `deploy/deploy.sh`'s `stamp_build` writes to `~/.ccrc/build.json` on every
// deploy lane, one line of JSON — `{sha, ref, builtAt, dirty}`.
//
// Pure and import-free, like every other file in `shared/`: this is the tree
// the PWA bundles from, so nothing here may import `node:*` — a rule about the
// tree, which holds whether or not a PWA module imports THIS file today (none
// does yet). `parseBuildInfo`
// therefore takes the FILE'S TEXT and never a path; whoever reads the file off
// disk does the `readFile` and hands the string in here. (`shared/roster.ts`
// takes already-parsed JSON instead, for the same reason from the other end:
// its caller had a parsed value already. Here both callers hold raw text, and
// "unparseable JSON is not a stamp" is one of the four ways a stamp can be
// unusable — keeping it inside the parser is what stops each caller having its
// own opinion about it.)
//
// WHY IT LIVES HERE rather than in `server/src/buildinfo.ts`, where it was
// written. Two boxes now read a stamp with these four fields: the server reads
// its own at boot (`/health`), and the agent reads the FLEET HOST's on every
// `ready` frame (`AgentReady.build`) so the server can compare the two. The
// agent cannot import from `server/src`, and a second copy of the field checks
// is precisely the drift this repo fails the build over
// (`server/test/single-definition.test.ts`) — two validators that disagree
// about what a well-formed stamp is would compare shas across a definition of
// "well-formed" that only one of them applies. The FILESYSTEM read stays in
// each package, where it belongs; only the shape and its validation are shared.

export interface BuildInfo {
  sha: string;
  ref: string;
  builtAt: string;
  dirty: boolean;
}

/** A stamp's string field: present, a string, and NOT EMPTY.
 *
 *  The emptiness half is the whole point and it is not decoration. A `typeof`
 *  check alone accepts `{"sha":"","ref":"","builtAt":"","dirty":false}` as a
 *  well-formed stamp, and an empty sha is the one malformed value that fails
 *  SAFE-LOOKING: two boxes that both report `sha: ''` compare EQUAL, so the
 *  cross-box skew check would report "the builds agree" on the strength of two
 *  files neither box could read. That is worse than the false alarm a
 *  half-stamp causes, and it is exactly the overloaded-null-at-a-seam defect
 *  this codebase bans — "nothing is known" and "they match" collapsing to one
 *  value the caller cannot tell apart.
 *
 *  This is the same guard the sibling field on the same frame already applies
 *  (`server/src/remote/client.ts`'s `typeof frame.rosterFp === 'string' &&
 *  frame.rosterFp.length > 0`), applied one layer earlier — in the parser both
 *  boxes share, so neither can be the one that forgot.
 *
 *  All three strings, not just `sha`: `stamp_build` writes them from
 *  `git rev-parse`, `git rev-parse --abbrev-ref` and `date -u`, none of which
 *  can produce an empty string, so an empty one anywhere means the file was
 *  written by something other than a deploy. A stamp is accepted whole or not
 *  at all — the alternative is a `BuildInfo` whose `ref` is `''`, which every
 *  consumer would then have to re-check for itself. */
function nonEmptyString(v: unknown): v is string {
  return typeof v === 'string' && v.length > 0;
}

/**
 * The stamp's text -> a `BuildInfo`, or `null` for every way it can fail to be
 * one: not JSON, not an object, or an object missing a field, holding one of
 * the wrong type, or holding an EMPTY string where an identifier belongs.
 *
 * Never a throw and never a partial. `/health` is the deploy's own
 * verification gate and the `ready` frame is the fleet link's handshake —
 * neither may be taken down by a malformed file, and neither may report half a
 * stamp. A half-stamp is worse than none: `sha: undefined` compares unequal to
 * the other box's sha, so forwarding one manufactures a skew alarm out of a
 * file nobody could read — and `sha: ''` is worse still, because it compares
 * EQUAL to the other box's empty sha and reports agreement instead (see
 * `nonEmptyString`). `dirty` rides along for the same reason it is in the file
 * at all — a working-tree deploy must never masquerade as the clean sha it
 * names.
 */
export function parseBuildInfo(raw: string): BuildInfo | null {
  let parsed: unknown;
  try { parsed = JSON.parse(raw); } catch { return null; }
  if (typeof parsed !== 'object' || parsed === null) return null;
  const o = parsed as Record<string, unknown>;
  if (!nonEmptyString(o.sha) || !nonEmptyString(o.ref)
    || !nonEmptyString(o.builtAt) || typeof o.dirty !== 'boolean') return null;
  return { sha: o.sha, ref: o.ref, builtAt: o.builtAt, dirty: o.dirty };
}

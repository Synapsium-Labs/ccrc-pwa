// What a box is RUNNING, stated by the box itself: the stamp
// `deploy/deploy.sh`'s `stamp_build` writes to `~/.ccrc/build.json` on every
// deploy lane, one line of JSON — `{sha, ref, builtAt, dirty}`.
//
// Pure and import-free, like every other file in `shared/`: this bundles into
// the PWA, so it imports nothing — not even `node:*`. `parseBuildInfo`
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

/**
 * The stamp's text -> a `BuildInfo`, or `null` for every way it can fail to be
 * one: not JSON, not an object, or an object missing a field or holding one of
 * the wrong type.
 *
 * Never a throw and never a partial. `/health` is the deploy's own
 * verification gate and the `ready` frame is the fleet link's handshake —
 * neither may be taken down by a malformed file, and neither may report half a
 * stamp. A half-stamp is worse than none: `sha: undefined` compares unequal to
 * the other box's sha, so forwarding one manufactures a skew alarm out of a
 * file nobody could read. `dirty` rides along for the same reason it is in the
 * file at all — a working-tree deploy must never masquerade as the clean sha
 * it names.
 */
export function parseBuildInfo(raw: string): BuildInfo | null {
  let parsed: unknown;
  try { parsed = JSON.parse(raw); } catch { return null; }
  if (typeof parsed !== 'object' || parsed === null) return null;
  const o = parsed as Record<string, unknown>;
  if (typeof o.sha !== 'string' || typeof o.ref !== 'string'
    || typeof o.builtAt !== 'string' || typeof o.dirty !== 'boolean') return null;
  return { sha: o.sha, ref: o.ref, builtAt: o.builtAt, dirty: o.dirty };
}

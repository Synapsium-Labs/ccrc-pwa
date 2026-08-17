import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import path from 'node:path';
import { reviveFleetSessions, type BuildAgreement, type FleetSession } from '../../shared/api.js';
import type { BuildInfo } from '../../shared/buildinfo.js';

// One vocabulary for "the two boxes' builds", declared in `shared/api.ts`
// because `FleetHealth` (the wire shape) needs it and L0 may not import from
// `server/src`. Re-exported — not restated — so this module, where the decision
// is made, still answers in a type it names. Same shape as
// `server/src/buildinfo.ts`'s `export type { BuildInfo }`: one declaration
// reachable by two names, which is the opposite of a copy.
export type { BuildAgreement };

/**
 * Degraded-mode snapshot cache, and the ONE declaration of fleet reachability.
 *
 * `remote/client.ts` used to declare its own structurally identical
 * `FleetState`; it now imports this one. The rule that mattered is unchanged —
 * this module must never import from `remote/`, so local-mode code still needs
 * no knowledge that the remote client exists — but two copies of a type that
 * must stay in lockstep is how `ccdVerbs` would have been added to one of them
 * and read off the other.
 */
export interface FleetState {
  connected: boolean;
  downSince: number | null;
  /** What `ccd caps` printed on the box that actually runs it — the fleet
   *  host in remote mode, THIS box in local mode (`localcaps.ts`'s
   *  `readLocalCcdCaps`, fix round 3, task 14: local mode measures for
   *  real now, it does not merely go without) — or null when even that
   *  probe found no evidence (a remote agent old enough not to send it, or
   *  either side's local exec failing). Null is NOT "no verbs", but it is
   *  also not universally "do not block": `verbSupported` treats it as
   *  permit (guessing wrong about an ordinary VERB is loud — ccd's own
   *  usage refusal, never a lie), while `stopSurfaceSupported` inverts
   *  that for the one capability where guessing wrong is a SILENT success
   *  — see its own comment in `ccdargv.ts` for why the two must disagree. */
  ccdVerbs: string[] | null;
  /** `bodyDigest` of the roster projection installed on the fleet host, or
   *  null when we have no evidence (local mode, an older agent, or a fleet
   *  host with no readable `~/.ccrc/accounts.sh`). Null is NOT "divergent" —
   *  see `rosterAgreement` for the three-way answer that keeps those apart. */
  rosterFp: string | null;
  /** The build stamp the fleet host reported for ITSELF (`AgentReady.build`,
   *  read from its `~/.ccrc/build.json` on every `ready` frame), or null when
   *  we have no evidence — local mode, an older agent, a box that was never
   *  stamped, or a stamp that failed validation. Null is NOT "a different
   *  build": `buildAgreement` is where the three-way answer that keeps those
   *  apart is made.
   *
   *  REQUIRED, not optional, and that is the whole mechanism. `Deps.fleetState`
   *  is itself optional, so an omitted field here would be invisible at every
   *  construction site and the one site that matters — `FleetClient.state`,
   *  the object `onReady` mutates — would compile while never carrying a
   *  stamp. Requiring it turns "who has evidence about the fleet host's build?"
   *  into a compile error at every site, each of which then has to answer
   *  honestly; the sites with nothing to say answer `null`, by measurement
   *  rather than by omission. This is what `rosterFp` did before it, and it is
   *  why `server/test/` (typechecked by `typecheck-tests.test.ts`, not by the
   *  build) is part of the enumeration rather than collateral damage. */
  build: BuildInfo | null;
}

export interface FleetSnapshot { sessions: FleetSession[]; savedAt: number }

/**
 * Do this box and the fleet host agree about which accounts exist?
 *
 * Compares the digest the agent reported for its INSTALLED
 * `~/.ccrc/accounts.sh` against the digest of the projection this server's own
 * roster produces. Both sides run `bodyDigest` over the output of the one
 * generator, so equal digests mean the two boxes would run identical bash, and
 * unequal ones mean they would not.
 *
 * The two `accounts.json` files are deliberately NOT what is compared, even
 * though "the rosters diverged" is how the problem is usually described.
 * `accounts.json` is user-owned and never overwritten, but nothing on the
 * fleet host READS it at runtime — `ccd` sources the generated projection, and
 * the deploy is what regenerates one from the other. So a fleet host whose
 * `accounts.json` was hand-edited and never redeployed has two files that
 * agree and a `ccd` that behaves like neither. Digesting the projection sees
 * that; digesting the JSON does not.
 *
 * WHAT `'divergent'` ACTUALLY MEANS, stated precisely because the obvious
 * reading is narrower than the truth: the two boxes would run different
 * `accounts.sh`. Usually that is a roster edit on one box only — but the
 * generated body is a function of `shared/generate.mjs`'s CODE as well as of
 * the roster, so a build in which the emitter changed (a new emission, a
 * different arm layout) deployed to one box and not the other lands here too,
 * with both `accounts.json` files identical. That is not a false positive —
 * the boxes genuinely are running different projections, and `ccd` on one of
 * them can behave differently from what the server assumes — but it does mean
 * the operator-facing remedy is REDEPLOY BOTH first and reconcile the JSON
 * second, which is the order `FleetHostBanner` states it in.
 *
 * Three answers, not two, and the third is why this is a function rather than
 * an `===`. `'unknown'` means no evidence — local mode has no second box, an
 * older agent omits the field, and a fleet host with no readable projection
 * cannot report one. None of those is disagreement, and a UI that rendered
 * them as disagreement would cry wolf on every deploy of an older agent.
 * Overloading `unknown` into `divergent` is exactly the collapsed distinction
 * this codebase bans at a seam: the operator does something about
 * `'divergent'` and nothing about `'unknown'`.
 */
export type RosterAgreement = 'agreed' | 'divergent' | 'unknown';

export function rosterAgreement(
  fleetFp: string | null | undefined,
  ownFp: string,
): RosterAgreement {
  if (fleetFp === null || fleetFp === undefined) return 'unknown';
  return fleetFp === ownFp ? 'agreed' : 'divergent';
}

/**
 * Are the two boxes running the same BUILD?
 *
 * The sibling question to `rosterAgreement`, over the same link and with the
 * same three-answer shape, and it exists because until the stamp crossed the
 * wire a deploy that landed on one box and not the other was INVISIBLE: this
 * server's `/health` reports this server's sha, and the fleet host's sha was
 * legible only by ssh'ing there and reading `~/.ccrc/build.json` by hand. Every
 * symptom of that skew shows up as a behaviour and never as a version — a `ccd`
 * verb the server believes exists, a hook writing a field the server does not
 * read, a frame field one side sends and the other drops.
 *
 * WHAT IS COMPARED, and what deliberately is not. The `sha` AND the `dirty`
 * flag, from both stamps; `ref` and `builtAt` are ignored. The two boxes are
 * deployed by two runs of `deploy.sh`, minutes apart and agent-first by
 * contract, so `builtAt` ALWAYS differs and `ref` differs whenever one box was
 * deployed from a branch and the other from the same commit on `main`. An
 * object comparison would therefore report skew on every healthy deploy, which
 * is the same false alarm that stops a banner being read.
 *
 * `'skewed'` INCLUDES THE DIRTY CASE, on either side, and this is the part the
 * obvious reading misses. `dirty` says "what this box runs is not the commit it
 * names" — so two boxes reporting one identical sha, one of them dirty, are not
 * running the same code, and the sha they both print is a lie about at least
 * one of them. The remedy is the same either way: DEPLOY THE LAGGING BOX,
 * AGENT-FIRST (the fleet host before the server — the server reads what the
 * hook writes, and the agent caches `ccd caps` at boot), from a clean tree.
 *
 * Three answers, not two, and the third is why this is a function and not an
 * `===`. `'unknown'` means no evidence, from EITHER side: local mode has no
 * second box, an older agent omits the field, a fleet host that was never
 * stamped (or whose stamp failed `parseBuildInfo`) reports nothing — and this
 * box can equally be the unstamped one, on a dev checkout, which is why `own`
 * is nullable too. None of those is disagreement. Collapsing `'unknown'` into
 * `'skewed'` is the overloaded-null-at-a-seam defect this codebase bans at a
 * seam: an operator deploys a box on `'skewed'` and does nothing on
 * `'unknown'`, so the two must not arrive as one value.
 */
export function buildAgreement(
  fleet: BuildInfo | null | undefined,
  own: BuildInfo | null | undefined,
): BuildAgreement {
  if (!fleet || !own) return 'unknown';
  if (fleet.dirty || own.dirty) return 'skewed';
  return fleet.sha === own.sha ? 'agreed' : 'skewed';
}

/**
 * Cache lives on THIS box's disk — the one running ccrc-server — regardless
 * of fleet mode. Same stance as server.ts's dist-pwa existsSync check: this
 * is local-box housekeeping, never proxied through FleetIO/the agent.
 */
export function defaultCachePath(home: string = homedir()): string {
  return path.join(home, '.ccrc', 'state-cache.json');
}

/** Atomic write: tmp file in the same directory, then rename over the target
 *  — a reader never observes a partially-written cache file. */
export async function saveSnapshot(sessions: FleetSession[], cachePath: string): Promise<void> {
  const dir = path.dirname(cachePath);
  await mkdir(dir, { recursive: true });
  const tmpPath = path.join(dir, `.state-cache.${process.pid}.${Date.now()}.tmp`);
  const snapshot: FleetSnapshot = { sessions, savedAt: Date.now() };
  await writeFile(tmpPath, JSON.stringify(snapshot));
  await rename(tmpPath, cachePath);
}

/** Never throws — missing file, unreadable file, or corrupt JSON all
 *  collapse to null (same "no data" stance as `localIO`'s read ops).
 *
 *  There is no version key to bump here and nowhere to put one: the path is
 *  fixed, and renaming the file would discard the degraded-mode snapshot at the
 *  exact moment it is needed — the fleet host being down. So the READ is the
 *  version negotiation: sessions are revived into today's shape (shared/api.ts),
 *  and a cache that cannot be revived is treated as absent, which the route
 *  already handles by assembling live. */
export async function loadSnapshot(cachePath: string): Promise<FleetSnapshot | null> {
  let raw: string;
  try {
    raw = await readFile(cachePath, 'utf8');
  } catch {
    return null;
  }
  try {
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null) return null;
    const { sessions, savedAt } = parsed as { sessions?: unknown; savedAt?: unknown };
    if (typeof savedAt !== 'number') return null;
    const revived = reviveFleetSessions(sessions);
    if (revived === null) return null;
    return { sessions: revived, savedAt };
  } catch {
    return null;
  }
}

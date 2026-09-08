import path from 'node:path';
import type { CcrcConfig } from './config.js';
import type { FleetIO } from './io.js';
import { CCD_ARGV } from './ccdargv.js';
import { POOL_NAME_RE } from '../../shared/roster.js';
import type { PoolsEnforcement, ProjectPoolWire, ProjectPoolsWire } from '../../shared/api.js';

/**
 * L3 — the server's view of the fleet box's project pool tags.
 *
 * WAVE 2a SHIPS ONE LINE OF IT, DELIBERATELY. `readProjectPools`, `poolFor`,
 * `poolsEnforcement` and `poolsWire` are wave 3's; what has to exist NOW is a
 * TypeScript spelling of the directory name for `pool-name-parity.test.ts` to
 * compare `ccd/ccd`'s `POOLS_DIR=` against. The alternative — waiting for wave
 * 3 — would mean the bash constant shipped to the fleet with nothing holding
 * it equal to anything, which is the state `ccd/ccrc-wrapper-shape:67` is
 * already in and discloses.
 */
export const POOLS_DIR_NAME = 'pools';

/**
 * One sweep of `$REG/pools/`, ring L3 (spec §5.4.4).
 *
 * `listed: false` is the `io.readdir` COLLAPSE itself and nothing else: the
 * registry root would not list, or `pools` is at the root but would not list
 * (a regular file planted there, an EACCES, a remote `forbidden`). It is NOT
 * "there are no tags" — that is `listed: true` with an empty map, and the
 * difference is the whole reason this type exists. `poolFor` reads the first
 * as `unreadable` (nobody decides) and the second as `untagged`
 * (unconstrained); folding them would silently LIFT every constraint on the
 * box the moment a listing dropped.
 */
export type ProjectPoolsRead =
  | { listed: false }
  | { listed: true; tags: Map<string, ProjectPoolWire> };

/**
 * The verb whose PRESENCE in `ccd caps` is the evidence that the deployed ccd
 * honours pools (spec §5.11: "the verb and every reader ship in one `ccd`
 * inode, so the verb's presence in `ccdVerbs` IS the evidence").
 *
 * READ OFF THE BUILDER rather than spelled a second time here — `ccdargv.ts`
 * is where ccd verb names live, and a capability token copied into two files
 * is the drift shape `single-definition.test.ts` exists for. The probe argv is
 * built and its verb taken; it is never run.
 */
const PROJECT_POOL_VERB: string = CCD_ARGV.projectPoolClear('')[0] ?? '';

/**
 * Read every project's pool tag in one pass.
 *
 * `rootNames` is the registry root listing the CALLER already took — the
 * watcher's `registryRead.names` (`watch.ts:702`'s own source), or the route's
 * own `io.readdir(cfg.registryDir)`. It is a PARAMETER rather than a read of
 * our own because it is what splits "the directory is not there" from "the
 * directory would not list": `io.readdir` cannot say (`io.ts:96` — the one
 * read in that file with no measured sibling), and the parent listing can.
 *
 * Cost: ZERO extra root readdirs for a caller that has a listing, then one
 * `pools/` readdir and one measured read per tagged project.
 */
export async function readProjectPools(
  io: FleetIO, cfg: CcrcConfig, rootNames: readonly string[] | null,
): Promise<ProjectPoolsRead> {
  if (rootNames === null) return { listed: false };
  if (!rootNames.includes(POOLS_DIR_NAME)) return { listed: true, tags: new Map() };
  const dir = path.join(cfg.registryDir, POOLS_DIR_NAME);
  const names = await io.readdir(dir);
  if (names === null) return { listed: false };
  const tags = new Map<string, ProjectPoolWire>();
  for (const name of names) {
    // Dot-leading is ccd's private namespace and the disclosed tmp-leak shape
    // (`$REG/pools/.<p>.$BASHPID.tmp`). Exact, since no project may lead with
    // a dot (`_ws_project_valid`).
    if (name.startsWith('.')) continue;
    const read = await io.readFileMeasured(path.join(dir, name));
    if (!read.ok) {
      // A PROVEN ENOENT is a proven untag — the `--clear` (or the `rm`) that
      // landed between the listing and this read. Anything else is the file
      // being there and this box not being able to read it, which is a state
      // of its own and must never read as absence (D-114's rule).
      if (read.reason === 'absent') continue;
      tags.set(name, { state: 'unreadable' });
      continue;
    }
    // THE CAP COMES FIRST, exactly as it does on the other side, and the
    // COMPARISON IS `>=`, NOT `>` (D-2010 — this line said `> 64` for one
    // commit). `ccd` reads the tag with `IFS= read -r -d '' -n 64`
    // (`grep -n "read -r -d '' -n 64" ccd/ccd`) and answers `malformed` when
    // that read SUCCEEDS. `read -n 64` succeeds when it gets its 64 characters
    // OR meets the NUL; it fails only at EOF before either. So a 64-byte file
    // is ALREADY malformed there — measured, not reasoned: 63 bytes rc 1,
    // 64 bytes rc 0, 65 bytes rc 0. `> 64` would pass a 64-byte tag straight
    // to the strip and answer `tagged` for the one input the cap exists to
    // catch. `ccd`'s own comment names the same boundary from the other end:
    // "a tag padded with 58+ characters of trailing whitespace", and
    // `pool-a` + 58 spaces is exactly 64.
    //
    // BYTES vs UTF-16 UNITS, said once so nobody re-derives it: `.length`
    // counts UTF-16 code units and `read -n` counts characters in the shell's
    // locale, so the two agree only for ASCII. That is sufficient here because
    // anything non-ASCII fails `POOL_NAME_RE` below and is `malformed` on both
    // sides regardless of which side's cap it trips — the boundary only ever
    // decides an all-ASCII input, where the three units coincide.
    if (read.content.length >= 64 || read.content.includes('\0')) {
      tags.set(name, { state: 'malformed' });
      continue;
    }
    // TRAILING whitespace only: `echo pool-a > …` is a legal writer (ruling 2),
    // a leading space is not. The quote this comment used to carry —
    // `v=${v%"${v##*[![:space:]]}"}` — is still verbatim at `ccd`'s strip, but
    // it is no longer the whole rule (D-1850); the cap above is the rest of it.
    const value = read.content.replace(/\s+$/, '');
    tags.set(name, POOL_NAME_RE.test(value)
      ? { state: 'tagged', name: value }
      : { state: 'malformed' });
  }
  return { listed: true, tags };
}

/** One project's answer. `unreadable` for a collapsed listing: nobody
 *  decides, and the caller answers 503 / `unmeasurable` rather than placing. */
export function poolFor(read: ProjectPoolsRead, project: string): ProjectPoolWire {
  if (!read.listed) return { state: 'unreadable' };
  return read.tags.get(project) ?? { state: 'untagged' };
}

/**
 * Does the deployed ccd honour project pools? The `lifecycleState` three-state
 * shape (`coord/mirrorplan.ts:207`), for its reasons: `unavailable` is a
 * MEASURED absence — ccd answered `caps` and the verb was not there, so an
 * operator may act on it (redeploy the agent lane) — while `null` is NO
 * EVIDENCE (local mode before `readLocalCcdCaps` ran, an agent too old to send
 * a list), and a reader must stay silent on `unknown`.
 */
export function poolsEnforcement(ccdVerbs: readonly string[] | null): PoolsEnforcement {
  if (ccdVerbs === null) return 'unknown';
  return ccdVerbs.includes(PROJECT_POOL_VERB) ? 'enforced' : 'unavailable';
}

/** The read, on the wire. The Map becomes a plain object; nothing narrows. */
export function poolsWire(read: ProjectPoolsRead, enforcement: PoolsEnforcement): ProjectPoolsWire {
  return read.listed
    ? { listed: true, byProject: Object.fromEntries(read.tags), enforcement }
    : { listed: false, enforcement };
}

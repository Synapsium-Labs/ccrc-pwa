import path from 'node:path';
import type { CcrcConfig } from './config.js';
import type { FleetIO } from './io.js';
import { CCD_ARGV } from './ccdargv.js';
import { POOL_NAME_RE } from '../../shared/roster.js';
import type { PoolsEnforcement, ProjectPoolWire, ProjectPoolsWire } from '../../shared/api.js';

/**
 * L3 — the server's view of the fleet box's project pool tags.
 *
 * Wave 2a first shipped `POOLS_DIR_NAME` so `pool-name-parity.test.ts` could
 * compare `ccd/ccd`'s `POOLS_DIR=` against a TypeScript spelling before any
 * server reader existed. Wave 3 completes that seam in this module:
 * `readProjectPools`, `poolFor`, `poolsEnforcement` and `poolsWire` now carry
 * the measured tags into watcher and route decisions. The staged history
 * matters because waiting for the reader would have left the fleet's Bash
 * constant unpinned during wave 2a — the state `ccd/ccrc-wrapper-shape:67`
 * already has to disclose for another constant.
 */
export const POOLS_DIR_NAME = 'pools';

/**
 * One sweep of `$REG/pools/`, ring L3 (spec §5.4.4).
 *
 * `listed: false` means the marker population could not be established: the
 * registry root would not list, `pools` is at the root but would not list (a
 * regular file planted there, an EACCES, a remote `forbidden`), or the caller's
 * budget expired before that listing arrived. It is NOT "there are no tags" —
 * that is `listed: true` with an empty map, and the
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
 * watcher's `registryRead.names`, or the route's own
 * `io.readdir(cfg.registryDir)`. It is a PARAMETER rather than a read of our own
 * because it is what splits "the directory is not there" from "the directory
 * would not list": `io.readdir` cannot say (`server/src/io.ts:99` — the one read in that
 * file with no measured sibling), and the parent listing can.
 *
 * `budgetMs` belongs to that caller too: a watcher supplies a slice of its poll
 * cadence; request routes pass `null` and retain the adapter's normal timeout.
 * When bounded, one shared deadline covers the listing and all concurrent
 * marker reads, and its remaining time is also forwarded to remote FleetIO.
 * The aggregate race is still necessary because local or test FleetIO
 * implementations may ignore the forwarded timeout.
 *
 * Cost: ZERO extra root readdirs for a caller that has a listing, then one
 * `pools/` readdir and concurrent measured reads for the listed projects.
 */
export async function readProjectPools(
  io: FleetIO,
  cfg: CcrcConfig,
  rootNames: readonly string[] | null,
  budgetMs: number | null,
): Promise<ProjectPoolsRead> {
  if (rootNames === null) return { listed: false };
  if (!rootNames.includes(POOLS_DIR_NAME)) return { listed: true, tags: new Map() };
  const dir = path.join(cfg.registryDir, POOLS_DIR_NAME);
  const bounded = budgetMs !== null;
  const budget = budgetMs === null ? null : Math.max(0, budgetMs);
  if (budget === 0) return { listed: false };
  const startedAt = Date.now();
  let timer: ReturnType<typeof setTimeout> | undefined;
  let deadlineExpired = false;
  const deadline = budget === null
    ? null
    : new Promise<null>((resolve) => {
        timer = setTimeout(() => {
          deadlineExpired = true;
          resolve(null);
        }, budget);
        timer.unref?.();
      });
  const raceDeadline = async <T>(operation: () => Promise<T>): Promise<T | null> => {
    if (deadlineExpired) return null;
    const pending = operation().catch(() => null);
    return deadline === null ? pending : Promise.race([pending, deadline]);
  };

  try {
    const names = await raceDeadline(() => io.readdir(dir, budget ?? undefined));
    if (names === null) return { listed: false };
    const projectNames = names.filter((name) => !name.startsWith('.'));
    const remainingMs = budget === null
      ? undefined
      : Math.max(0, budget - (Date.now() - startedAt));

    // A listing that consumed the budget proves which markers existed, but it
    // leaves no time to ask for their bytes. Preserve that population as
    // unreadable without launching already-doomed requests (D-2482).
    const reads = remainingMs === 0 && bounded
      ? projectNames.map((name) => ({ name, read: null }))
      : await Promise.all(projectNames.map(async (name) => ({
          name,
          read: await raceDeadline(
            () => io.readFileMeasured(path.join(dir, name), remainingMs),
          ),
        })));
    const tags = new Map<string, ProjectPoolWire>();
    for (const { name, read: completedRead } of reads) {
      // If the shared deadline fired, publish one coherent degraded snapshot.
      // Which individual request happened to settle first is transport timing,
      // not a stable project-pool fact (D-2482).
      const read = deadlineExpired ? null : completedRead;
      if (read === null || !read.ok) {
        // A PROVEN ENOENT is a proven untag — the `--clear` (or the `rm`) that
        // landed between the listing and this read. Anything else is the file
        // being there and this box not being able to read it, which is a state
        // of its own and must never read as absence (D-114's rule).
        if (read !== null && read.reason === 'absent') continue;
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
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
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

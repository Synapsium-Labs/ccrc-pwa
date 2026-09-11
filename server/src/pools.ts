import path from 'node:path';
import { performance } from 'node:perf_hooks';
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

/** Do not launch a marker burst that has too little time to produce evidence. */
const MARKER_LAUNCH_FLOOR_MS = 50;

interface PoolReadDeadline {
  budgetMs: number;
  signal: AbortSignal;
  expired(): boolean;
  remaining(): number;
  race<T>(operation: Promise<T>): Promise<T | null>;
  close(): void;
}

/** One monotonic, aborting aggregate deadline for the complete pool read. */
function openPoolReadDeadline(budgetMs: number): PoolReadDeadline | null {
  const budget = Number.isFinite(budgetMs) ? Math.max(0, budgetMs) : 0;
  if (budget === 0) return null;

  const deadlineAt = performance.now() + budget;
  const controller = new AbortController();
  let deadlineExpired = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<null>((resolve) => {
    timer = setTimeout(() => {
      deadlineExpired = true;
      controller.abort();
      resolve(null);
    }, budget);
    timer.unref?.();
  });

  return {
    budgetMs: budget,
    signal: controller.signal,
    expired: () => deadlineExpired,
    remaining: () => {
      const elapsedBudget = Math.floor(deadlineAt - performance.now());
      return Number.isFinite(elapsedBudget) ? Math.max(0, elapsedBudget) : 0;
    },
    race: async <T>(operation: Promise<T>): Promise<T | null> =>
      Promise.race([operation.catch(() => null), deadline]),
    close: () => {
      if (timer !== undefined) clearTimeout(timer);
      controller.abort();
    },
  };
}

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
 * box the moment a listing dropped. The deliberately disclosed D-2516
 * dangling-marker residual is narrower: `FleetIO.readFileMeasured` follows
 * the listed symlink to ENOENT, so that single marker still reads untagged
 * here while ccd detects the link and remains the fail-shut authority.
 */
export type ProjectPoolsRead =
  | { listed: false }
  | { listed: true; tags: Map<string, ProjectPoolWire> };

/** A route-owned root measurement and its optional pool view. */
export type ProjectPoolsWithRoot =
  | { rootNames: readonly string[] | null; poolsRead: false }
  | { rootNames: readonly string[] | null; poolsRead: true; pools: ProjectPoolsRead };

type RootReader = (
  timeoutMs: number,
  signal: AbortSignal,
) => Promise<readonly string[] | null>;

type RootSource = readonly string[] | null | RootReader;

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
 * `root` is either the registry root listing the CALLER already took — the
 * watcher's `registryRead.names` — or a callback that starts a route's listing
 * only after the aggregate deadline exists. `readProjectPoolsWithRoot` is the
 * variant for a route that also consumes that root answer.
 * The parent listing is what splits "the directory is not there" from "the
 * directory would not list": the `FleetIO.readdir` member in `server/src/io.ts`
 * cannot say (it is the one read with no measured sibling), and the parent can.
 *
 * `budgetMs` belongs to that caller too: a watcher supplies a slice of its poll
 * cadence and request routes supply their request-oriented budget. One shared
 * deadline covers a promised root listing, the pools listing and all concurrent
 * marker reads, and its remaining time is also forwarded to remote FleetIO. The
 * aggregate race is still necessary because local or test FleetIO implementations
 * may ignore the forwarded timeout. An AbortSignal reaches local
 * `readFileMeasured` operations and removes losing remote requests from the client
 * table. The derived local `readFile` has no cancellation parameter, and the
 * local `readdir` adapter ignores both timeout and signal — the Node API used
 * there accepts neither — so only the aggregate race strictly
 * bounds when its caller receives a decision. Node cannot interrupt every local
 * filesystem syscall after dispatch (a FIFO blocked in open is the known example),
 * so cancellation is best-effort beneath that strict result deadline.
 *
 * Cost: ZERO extra root readdirs for a caller that has a listing; a route starts
 * exactly one root readdir here, then one `pools/` readdir and concurrent measured
 * reads for the listed projects.
 */
async function readProjectPoolsWithinDeadline(
  io: FleetIO,
  cfg: CcrcConfig,
  rootNames: readonly string[] | null,
  deadline: PoolReadDeadline,
): Promise<ProjectPoolsRead> {
  const rootRemainingMs = deadline.remaining();
  if (rootNames === null || rootRemainingMs === 0) return { listed: false };
  if (!rootNames.includes(POOLS_DIR_NAME)) return { listed: true, tags: new Map() };

  const dir = path.join(cfg.registryDir, POOLS_DIR_NAME);
  const names = await deadline.race(io.readdir(dir, rootRemainingMs, deadline.signal));
  const remainingMs = deadline.remaining();
  if (names === null || remainingMs === 0) return { listed: false };
  const projectNames = names.filter((name) => !name.startsWith('.'));

  // A listing that consumed nearly all the budget proves which markers
  // existed, but leaves no useful time for a burst of file reads. Preserve
  // that population as unreadable without launching already-doomed requests
  // (D-2482, D-2488).
  const reads = remainingMs < MARKER_LAUNCH_FLOOR_MS
    ? projectNames.map((name) => ({ name, read: null }))
    : await Promise.all(projectNames.map(async (name) => ({
        name,
        read: await deadline.race(
          io.readFileMeasured(path.join(dir, name), remainingMs, deadline.signal),
        ),
      })));
  // Re-measure the monotonic deadline after the whole burst too. A blocked event
  // loop can delay the timer callback until after late marker promises settle;
  // callback order must not extend elapsed-time policy (D-2488).
  const markersExpired = deadline.remaining() === 0;
  const tags = new Map<string, ProjectPoolWire>();
  for (const { name, read: completedRead } of reads) {
    // If the shared deadline fired or elapsed while its callback was delayed,
    // publish one coherent degraded snapshot. Which individual request happened
    // to settle first is transport timing, not a stable pool fact (D-2482).
    const read = deadline.expired() || markersExpired ? null : completedRead;
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
}

export async function readProjectPools(
  io: FleetIO,
  cfg: CcrcConfig,
  root: RootSource,
  budgetMs: number,
): Promise<ProjectPoolsRead> {
  const deadline = openPoolReadDeadline(budgetMs);
  // No production caller supplies an unusable value; this prevents future
  // direct callers from launching I/O without a meaningful bound.
  if (deadline === null) return { listed: false };

  try {
    const rootNames = typeof root === 'function'
      ? await deadline.race(root(deadline.budgetMs, deadline.signal))
      : root;
    return await readProjectPoolsWithinDeadline(io, cfg, rootNames, deadline);
  } finally {
    deadline.close();
  }
}

/**
 * Route variant for a caller that also needs the parent listing itself.
 * The root and pool answers share one deadline and one root measurement;
 * `needsPools` may skip remaining work for any verdict that does not consume pool
 * evidence, including a proven revival or a declared crossing.
 */
export async function readProjectPoolsWithRoot(
  io: FleetIO,
  cfg: CcrcConfig,
  readRoot: RootReader,
  budgetMs: number,
  needsPools: (rootNames: readonly string[] | null) => boolean = () => true,
): Promise<ProjectPoolsWithRoot> {
  const deadline = openPoolReadDeadline(budgetMs);
  if (deadline === null) return { rootNames: null, poolsRead: false };

  try {
    const completedRoot = await deadline.race(readRoot(deadline.budgetMs, deadline.signal));
    // A delayed timer callback must not let a late root answer prove revival.
    // Normalize it to the same unmeasurable value as an ordinary timeout before
    // either consumer sees it.
    const rootNames = deadline.remaining() === 0 ? null : completedRoot;
    return needsPools(rootNames)
      ? {
          rootNames,
          poolsRead: true,
          pools: await readProjectPoolsWithinDeadline(io, cfg, rootNames, deadline),
        }
      : { rootNames, poolsRead: false };
  } finally {
    deadline.close();
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

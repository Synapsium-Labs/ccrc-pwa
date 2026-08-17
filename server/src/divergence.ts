import type { Divergence } from '../../shared/api.js';

/**
 * L1: pure, clock-free, `fs`-free, fastify-free — it imports TYPES from
 * `shared/api.js` and nothing else. Gathering is L4's job
 * (`FleetWatcher.sweepDivergences`), THE CENSUS'S SINGLE PRODUCER.
 *
 * Deliberately NOT under `server/src/coord/`: it holds no DB handle and has no
 * business near the coord-ring scanner in `single-definition.test.ts`.
 */
export interface DivergenceInput {
  readonly records: readonly {
    readonly id: string;
    readonly project: string;
    readonly workspace: string | null;
    readonly workdir: string;
    readonly branch: string | null;
    readonly held: string | null;
    readonly archivedAt: number | null;
  }[];
  /**
   * Every linked worktree GIT ITSELF records, per project, read out of
   * `<projectsRoot>/<project>/.git/worktrees/`.
   *
   * KEYED BY GIT'S OWN ADMIN NAME, NEVER BY ABSOLUTE PATH, and that is not a
   * style choice: `~/worktrees` is a symlink to `/data/worktrees` on the fleet
   * box, ccd writes the registry's `workdir` UNRESOLVED (`$WORKTREES_ROOT/...`)
   * while git's own record resolves it, and `FleetIO.realpath` answers null
   * unconditionally in remote mode. Comparing absolute paths would report every
   * worktree on the fleet as unregistered.
   */
  readonly worktrees: readonly {
    readonly project: string;
    readonly name: string;
    readonly path: string;
  }[];
  /** `<project>/<name>` -> the branch that worktree's own HEAD names, or null
   *  where HEAD could not be read or is detached. A null NEVER yields
   *  `branch-drift`: not knowing is not a disagreement. */
  readonly headBranch: ReadonlyMap<string, string | null>;
  readonly openRunSessionIds: ReadonlySet<string>;
  /**
   * The registry DIRECTORY LISTING, raw — `$REG`'s own filenames, not parsed
   * rows. It is the second half of the claim evidence below, and it has to be
   * the listing rather than `records` for the reason `buildRecord` already
   * relies on: a name proves PRESENCE independently of whether any field read
   * succeeded, or of whether the row parsed at all.
   */
  readonly registryNames: readonly string[];
  /**
   * `unclaimedWorktrees` as the PREVIOUS sweep measured it — the census's
   * one-interval debounce (see `unregistered-worktree` below). Empty on the
   * first sweep after a restart, which costs one interval of quiet on this kind
   * and nothing else.
   */
  readonly unclaimedLastSweep: ReadonlySet<string>;
}

const key = (project: string, name: string): string => `${project}/${name}`;

/**
 * `<project>/<name>` for every worktree NOBODY claims — the raw measurement
 * behind `unregistered-worktree`, before the debounce that decides whether to
 * report it. Exported so the caller can carry it to the next sweep without a
 * second copy of the claim rule living in L4.
 *
 * TWO KINDS OF CLAIM, and the second one is why a workspace mid-`ws-add` no
 * longer reads as a leak:
 *
 *  - a PARSED ROW whose `workspace` names it. This alone was the old rule, and
 *    `ws-add` breaks it twice on the way in. `cmd_ws_add` runs `git worktree
 *    add` (git writes `.git/worktrees/<slug>/` before it even starts the
 *    checkout) and only then writes the registry, field by field, one
 *    `printf >` each: `.wrapper`, `.project`, `.workdir`, `.uuid`, `.workspace`.
 *    Until `.uuid` lands the id is not even in `readRegistry`'s listing-derived
 *    id set, so there is no row at all; between `.uuid` and `.workspace` there
 *    IS a row and its `workspace` is null. Both windows produced
 *    `unregistered-worktree` for a workspace being created that second — a
 *    false alarm on every single `ws-add`, aimed at the one repair (`ws-gc`)
 *    that deletes worktrees.
 *  - ANY REGISTRY FIELD FILE for the id `<project>-<name>`. That is ccd's own
 *    `_ws_slug_free` rule, character for character, including its nested-id
 *    guard (a suffix containing a further dot — `x-y.uuid`, `hookstate.json` —
 *    belongs to a different id and does not count). Reusing ccd's rule is what
 *    makes this sound rather than merely convenient: `_ws_slug_free` is the
 *    predicate `ws-add` itself consults before handing a slug out, so a slug
 *    the registry still holds ANY trace of is a slug ccd will not re-use, and
 *    calling its worktree unclaimed contradicts the writer. It also covers the
 *    residue case `_ws_slug_free` was widened for (verification round 3, P1):
 *    an interrupted purge leaves `.archived`/`.reaping` behind, ccd treats the
 *    slug as in use, and so does this.
 *
 * The id is `<project>-<name>` because that is what `cmd_ws_add` builds
 * (`local id="$project-$slug"`) and `<name>` is git's own admin name for the
 * worktree, which is the slug. A worktree nobody made through ccd — the actual
 * `unregistered-worktree` case — has no registry file under that id at all.
 */
export function unclaimedWorktrees(
  input: Pick<DivergenceInput, 'records' | 'worktrees' | 'registryNames'>,
): string[] {
  const claimedByRow = new Set(
    input.records
      .filter((r) => r.workspace !== null)
      .map((r) => key(r.project, r.workspace as string)),
  );
  // `lastIndexOf`, which is `_ws_slug_free`'s "the suffix must hold no further
  // dot" read from the other end: `demo-quiet-basin.uuid` is a field of
  // `demo-quiet-basin`, while `demo-quiet-basin.hookstate.json` is a field of
  // `demo-quiet-basin.hookstate` — a different id, exactly as ccd reads it.
  const claimedById = new Set<string>();
  for (const n of input.registryNames) {
    const dot = n.lastIndexOf('.');
    if (dot > 0) claimedById.add(n.slice(0, dot));
  }
  return input.worktrees
    .filter((w) => !claimedByRow.has(key(w.project, w.name))
      && !claimedById.has(`${w.project}-${w.name}`))
    .map((w) => key(w.project, w.name));
}

export function divergences(input: DivergenceInput): Divergence[] {
  const out: Divergence[] = [];

  // 1 — a worktree git records that no registry row claims. ccd's `ws-gc` owns
  // the repair and it is HUMAN-ONLY; this only names it.
  //
  // DEBOUNCED BY ONE SWEEP, and that covers what no signal can. The claim rule
  // above answers from the first `_reg_set` of a `ws-add` onward; before it
  // there is an instant with git's admin record already written and nothing
  // anywhere on the box tying it to a session — the `git worktree add` checkout
  // itself, which on a large repo is not milliseconds. At that instant "being
  // created" and "genuinely unregistered" are the same observation, so the
  // census does not guess: it waits for a SECOND, independent observation one
  // interval later, the same twice-observed-absence discipline `readRegistry`
  // uses to tell a reap from a failed read. A leak that has existed for hours
  // is still named a minute after the server notices it; a workspace being
  // created is registered long before the second look.
  const unclaimed = new Set(unclaimedWorktrees(input));
  for (const w of input.worktrees) {
    const k = key(w.project, w.name);
    if (!unclaimed.has(k) || !input.unclaimedLastSweep.has(k)) continue;
    out.push({
      kind: 'unregistered-worktree', id: null, path: w.path,
      detail: `git records a worktree at ${w.path} that no registry row claims`,
    });
  }

  // 2 — the registry's `.branch` and the worktree's own HEAD disagree. Reconcile
  // before a done-fingerprint trusts either. An ARCHIVED row is skipped: its
  // worktree is gone by construction, so there is nothing left to disagree with.
  for (const r of input.records) {
    if (r.archivedAt !== null || r.workspace === null || r.branch === null) continue;
    const head = input.headBranch.get(key(r.project, r.workspace)) ?? null;
    if (head === null || head === r.branch) continue;
    out.push({
      kind: 'branch-drift', id: r.id, path: r.workdir,
      detail: `the registry says ${r.branch}, the worktree's own HEAD says ${head}`,
    });
  }

  // 3 — a claim and a run that do not agree about each other, in BOTH directions.
  // Wave 2 supplies the second half's input (`openRunsForSession`); here it is
  // just a set, so this stays pure.
  const live = input.records.filter((r) => r.archivedAt === null);
  for (const r of live) {
    if (r.held !== null && !input.openRunSessionIds.has(r.id)) {
      out.push({
        kind: 'claim-divergence', id: r.id, path: null,
        detail: `held (${r.held}) with no open run naming this session`,
      });
    }
  }
  const heldIds = new Set(live.filter((r) => r.held !== null).map((r) => r.id));
  for (const id of input.openRunSessionIds) {
    if (heldIds.has(id)) continue;
    out.push({
      kind: 'claim-divergence', id, path: null,
      detail: 'an open run names this session, which carries no hold',
    });
  }

  return out;
}

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
}

const key = (project: string, name: string): string => `${project}/${name}`;

export function divergences(input: DivergenceInput): Divergence[] {
  const out: Divergence[] = [];

  // 1 — a worktree git records that no registry row claims. ccd's `ws-gc` owns
  // the repair and it is HUMAN-ONLY; this only names it.
  const claimed = new Set(
    input.records
      .filter((r) => r.workspace !== null)
      .map((r) => key(r.project, r.workspace as string)),
  );
  for (const w of input.worktrees) {
    if (claimed.has(key(w.project, w.name))) continue;
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

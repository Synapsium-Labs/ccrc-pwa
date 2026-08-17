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
   *
   * `path` IS NOT DECORATION. It is what the layouts are told apart by, and the
   * ccd id the claim rule looks up is measured off it (`ccdIdForWorktree`);
   * `name` alone cannot say which layout produced it. That is a reading of the
   * last two segments, which no root symlink can move — not the whole-path
   * comparison the paragraph above rules out.
   */
  readonly worktrees: readonly {
    readonly project: string;
    readonly name: string;
    /** git's `gitdir` record with its `/.git` removed, i.e. the checkout itself
     *  (`coord/gitref.ts`). Never `''`. */
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
 * The ccd id — `$project-$slug`, the name every registry field file is keyed by
 * — for the worktree GIT records at `wtPath`, or `null` when this path names no
 * ccd id at all.
 *
 * READ OFF THE CHECKOUT PATH, NEVER OFF GIT'S ADMIN NAME, and that is a
 * measurement replacing a composition that was right for only one of the two
 * layouts on the box. `<project>/.git/worktrees/<name>/` takes its `<name>` from
 * the LAST SEGMENT OF THE CHECKOUT PATH, so:
 *
 *   ~/worktrees/custom-tools/brisk-ridge   admin name `brisk-ridge`
 *   ~/worktrees/custom-tools-alertwire     admin name `custom-tools-alertwire`
 *
 * — both measured live, in one project, on 2026-08-17. Composing
 * `${project}-${name}` is ccd's own `cmd_ws_add` rule (`local id="$project-$slug"`,
 * `local wt="$WORKTREES_ROOT/$project/$slug"`) and holds for the first; for the
 * second it yields `custom-tools-custom-tools-alertwire`, an id no registry row
 * can hold, so the any-field claim below could never match and the census named
 * that worktree on every sweep for ever — on the one kind whose repair deletes
 * worktrees.
 *
 * THE LAYOUT IS SETTLED BY THE PARENT DIRECTORY, and the ORDER of the two arms
 * is the whole reason this is not the string heuristic it might be mistaken for
 * (`name.startsWith(project + '-') ? name : …`). That heuristic is ambiguous
 * exactly where it matters: `~/worktrees/demo/demo-fix` (ccd's `demo-demo-fix`)
 * and `~/worktrees/demo-fix` (`demo-fix`) are DIFFERENT workspaces that git
 * records under the SAME admin name, and it reads both as `demo-fix` — handing
 * one workspace's registry row the power to claim the other's worktree. Asking
 * the parent directory first removes the ambiguity instead of guessing through
 * it: a checkout whose parent directory IS the project is ccd's nested layout,
 * full stop, whatever its slug happens to begin with. Only once that reading is
 * ruled out is the last segment read as an id in its own right.
 *
 * NO ROOT IS COMPARED, deliberately. `~/worktrees` is a symlink to
 * `/data/worktrees` on the fleet box, ccd writes the registry's `workdir`
 * unresolved while git resolves it, and `FleetIO.realpath` answers null
 * unconditionally in remote mode — the same reasoning that keeps
 * `DivergenceInput.worktrees` keyed by admin name rather than by absolute path.
 * The last two segments are enough to tell the layouts apart and are unaffected
 * by whatever the prefix resolves to.
 *
 * `null` CARRIES ONE CONDITION: this path names no ccd id, because it is
 * neither `<root>/<project>/<slug>` nor `<root>/<project>-<slug>` — a worktree
 * ccd did not create (`ws-gc` calls these `foreign`, lists them, and never
 * prunes them). It is NOT "we could not measure": the path was read, and ccd
 * builds ids only in the two shapes above, so the honest answer is that no
 * registry id can name this checkout. The one caller therefore skips the
 * id half of the claim rule rather than testing an invented id — a worktree
 * with no ccd id cannot have a ccd registry claim, which is a reason to keep
 * looking at the row half, never a reason to fall silent.
 */
function ccdIdForWorktree(project: string, wtPath: string): string | null {
  // Empty segments dropped so a trailing or doubled `/` cannot shift which
  // segment is read as which. git writes an absolute POSIX path here.
  const seg = wtPath.split('/').filter((s) => s !== '');
  const base = seg[seg.length - 1];
  if (base === undefined) return null;
  // NESTED — `$WORKTREES_ROOT/$project/$slug`, the only layout `ws-add` builds.
  if (seg[seg.length - 2] === project) return `${project}-${base}`;
  // FLAT — the directory IS the id. Read only after the nested reading is out.
  if (base.length > project.length + 1 && base.startsWith(`${project}-`)) return base;
  return null;
}

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
 * THE ID THE SECOND RULE LOOKS UP IS MEASURED OFF `w.path`, not composed from
 * git's admin name — see `ccdIdForWorktree` for what the two live layouts do to
 * a composition, and for why the parent directory rather than a prefix test is
 * what tells them apart. A worktree nobody made through ccd — the actual
 * `unregistered-worktree` case — has no registry file under that id at all, and
 * one whose path names no ccd id at all cannot have a registry claim to find.
 *
 * HOW THIS LINES UP WITH `ws-gc`, THE REPAIR THIS KIND NAMES. Not the same
 * predicate, deliberately, and the difference is a stated set relation rather
 * than a drift nobody noticed. `_ws_gc_row` classifies a worktree `orphan` on
 * `[[ ! -f "$REG/$project-$slug.uuid" ]]` ALONE, with `.reaping` and `.archived`
 * as their own states on the next two rungs and `--prune`'s orphan arm gated
 * further still (dirty tree, merged-PR proof). Against that, this function is
 * WIDER ON CLAIM and therefore NARROWER ON NAMING, both ways round:
 *
 *  - Everything it names has NO `.uuid` file. `uuid` is a suffix holding no
 *    further dot, so any `.uuid` present already claims the slug through the
 *    any-field rule. What it names is therefore a SUBSET of ws-gc's own orphan
 *    test on the registry evidence: it can never name a worktree ws-gc would
 *    read as a live workspace and refuse to touch.
 *  - It stays SILENT for slugs ws-gc would call `orphan`: a workspace mid-
 *    `ws-add` before `.uuid` lands, and the `.archived`/`.reaping` residue an
 *    interrupted purge leaves behind — `orphan` is tested FIRST in that chain,
 *    so residue with no `.uuid` reads as `orphan` there and as CLAIMED here.
 *    That asymmetry is the point, not an oversight: this kind's repair deletes
 *    worktrees, and adopting `.uuid`-alone would re-open the false alarm on
 *    every single `ws-add`.
 *
 * WHERE THEY GENUINELY DIVERGE is ws-gc's OWNERSHIP gate, which has no
 * counterpart here — and it is a difference in the report, not a repair that
 * cannot run. `_ws_gc_row` only reaches the orphan rung for a worktree at
 * exactly `$WORKTREES_ROOT/<project>/<slug>`; anything else is `foreign`
 * (listed, NEVER pruned, because guessing at another tool's lifecycle is how a
 * reclaimer destroys work it does not understand), and one whose checkout
 * directory is gone is `stale-meta`, repaired by `git worktree prune` instead.
 * This function reads git's admin records and names all of them. `ws-gc` with
 * no flag is a REPORT and lists every one of those states, so "go look at
 * ws-gc" holds for every finding this kind emits — it is only `--prune`'s
 * orphan arm that is narrower, and that arm is human-only by contract anyway.
 * Both directions are pinned in `divergence.test.ts`; the ccd side of this
 * relation is written down beside `_ws_gc_row`'s own orphan test.
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
    .filter((w) => {
      if (claimedByRow.has(key(w.project, w.name))) return false;
      const id = ccdIdForWorktree(w.project, w.path);
      // A path that names no ccd id has no registry claim to look for, so the
      // row rule above is the only one that could have spoken for it.
      return id === null || !claimedById.has(id);
    })
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

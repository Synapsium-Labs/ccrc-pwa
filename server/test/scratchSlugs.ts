// ONE TypeScript home for the scratch-slug rule (D-2375).
//
// Three bash sites spell the predicate — `_mem_is_scratch` in `ccd/ccrc` (the
// census and `--apply` both reach it), `_check_memory` in
// `ccd/ccrc-doctor-checks` (spelled there: D-92's trade, that table is sourced
// under `set -u` by things that are not `ccrc`), and `ccd/session-hook.sh`'s
// own `case`. Three suites need to state fixture preconditions against the
// same rule, and there is no importing a bash `case`, so this module is the
// mirror they share. `single-definition.test.ts` compares it against the
// shipped alternation and reds on a drift in either direction.
//
// It exists because the first cut of D-2375 put a copy in each of the three
// suites and pinned only one of them, which is the duplication class this
// repository forbids outright — and the two unpinned copies were byte-equal
// hand transcriptions, the exact shape that drifts.

/** The four prefixes, WITHOUT the shipped `*`. Unanchored, matching the
 *  shipped globs: `-tmp` also covers `-tmp` bare and `-tmpfs-…`. */
export const SCRATCH_PREFIXES = ['-tmp', '-private-tmp', '-var-folders', '-private-var-folders'];

/** The predicate itself, for a precondition that has to ask about a slug it
 *  derived from a real path rather than one it wrote. */
export const isScratchSlug = (s: string): boolean =>
  SCRATCH_PREFIXES.some((p) => s.startsWith(p));

/** One seeded fixture slug PER PREFIX, derived rather than written out, so a
 *  prefix added to the list without a test row is impossible. A real Darwin
 *  scratch slug carries its `/<x>/<y>/T` segments too; those are more
 *  `-`-separated tokens and change nothing about which arm matches. */
export const SCRATCH_SLUGS = SCRATCH_PREFIXES.map((p) => `${p}-ccrc-scratch-fixture`);

/** THE NEGATIVE CONTROLS — the widening's upper bound, in BOTH spellings.
 *  `/var/tmp` is POSIX *persistent* scratch: it survives a reboot, unlike
 *  `/tmp`, so it is not the OS scratch root, and `session-hook.test.ts` roots
 *  the memory-convergence block's project fixtures there precisely because
 *  this rule must not skip them. The `-private-` spelling is the one a real
 *  Darwin box produces (`/var` is a symlink to `/private/var`) and is the one
 *  a Linux-only control cannot see — which is how an over-widening beginning
 *  `-private-` stayed invisible to the first cut of this pin. */
export const PERSISTENT_SLUGS = ['-var-tmp-project', '-private-var-tmp-project'];

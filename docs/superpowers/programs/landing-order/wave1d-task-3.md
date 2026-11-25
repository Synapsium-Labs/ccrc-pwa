# Wave 1d, Task 3: the growth check measures a queue entry against its parent (D-9016)

Run 3739, plan `docs/superpowers/plans/2026-11-25-landing-order-wave1d-queue-ci.md`.

- `growthBase(env, git)` in `server/test/growthCheck.ts`, to the plan's interface: under `merge_group`, a
  `QUEUE_BASE` of 40 lower-case hex that `git merge-base --is-ancestor <QUEUE_BASE> HEAD` accepts is the base
  (`queue-parent`); everything else, and any failed read in that arm, is `git merge-base origin/main HEAD`
  (`merge-base`), as before.
- **One reader.** The armed rows found their base in one place, `resolveBase()` in `growth-check.test.ts`. Since fix
  round 1 that is one call of `armedBase(env, root, git)` in `growthCheck.ts`, which asks `growthBase` and which the
  stacked case calls too (wave1d-fix-round-1.md); every reader of that base (the armed rows, the waiver rows, the method counts, the
  summary) takes it from there. No second `merge-base` read remains for them. The job summary and the printed line say
  "against the queue group's parent" when the base is one.
- **Exemptions and waivers are read as before.** `armedGrowth` still reads the exemption list from `origin/main` and
  waivers only from the measured diff; only the base it is handed changes. In a stack, a waiver an earlier entry added
  is on the later entry's parent, so it waives nothing for the later entry, which is the per-pull-request rule.
- **The cases**, one fixture repository: `origin/main` at M; A grows `server/src/server.ts` by 30 net code lines; B
  by 30 more on A. A pull request's environment at B is measured against M, +60, over (the control). `merge_group`
  with `QUEUE_BASE` = A at B: +30, not over. C grows it by 41 alone on B; `QUEUE_BASE` = B: +41, over. `QUEUE_BASE`
  unset, empty, 39 characters, upper-case, or a commit off HEAD's history: the merge-base.
- `ci.yml`: the server shards' Test step carries `QUEUE_BASE: ${{ github.event.merge_group.base_sha }}`; empty on
  every other event. Applied by packet, approved by the file's holder.
- **Order.** The cases and `growthBase` were written in one sitting, so the plan's Step 3 (the cases seen red before
  the code) was not observed on its own; the red was measured instead by mutations 1D-06 and 1D-07 (Task 4's table).
  The same holds for Task 2's Step 3.
- Touched no absolute cap: `server/test/growth-caps/` names none of these files.

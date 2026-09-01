# D-1161 — the fix that broke what it was fixing

> **Not a multi-task plan.** This is the ledger record for one round of corrections,
> written in plan shape because that is where this repo's deviation ledger lives.

**Goal:** Correct five defects introduced by D-1159 and D-1160 themselves, found by a
seven-lens adversarial review of the branch that carried them.

---

## What happened

D-1159 (the install that took the fleet's agent down) and D-1160 (the sweep that refused
every build over ccrc's own mess) were written, tested, mutation-tabled, and opened as
PR #41 with three green suites behind them. A seven-lens adversarial review of that
branch — every finding then put to two independent verifiers prompted to refute it —
raised 27 findings, of which 21 survived. Collapsed across lenses they are five distinct
defects, and **all five are in the fix, not in the code it was fixing.**

Two of them make the branch strictly worse than the `main` it was cut from. That is the
part worth recording: both fixes were correct about the defect they had measured, and
both then broke something adjacent that nobody had measured.

## Deviations found

- **D-1161** (2026-09-01) — five defects introduced by D-1159 and D-1160, corrected here.

  **(1) The default noise list made the foreign-`.graphifyignore` refusal universal.**
  Before D-1160, `_gs_guard`'s whole noise block ran only when
  `~/.ccrc/graph-noise/<repo>.list` existed — opt-in, per repo, almost never. D-1160
  shipped `_default.list` to every non-server box, so the block, and with it the refusal
  at its head, now ran for **every tree on every pass**. A repo that COMMITS its own
  `.graphifyignore` — the exact case `_gs_owns_ignore` was written to protect — became
  `refused-by-guard` for ever, with no remedy available on the box. Measured: the same
  fixture builds on `origin/main` and is refused on the branch.

  The correction is an asymmetry, and it is the same one three times over: **an operator's
  `<repo>.list` is an instruction about one repo; ccrc's `_default.list` is hygiene applied
  to repos that never asked.** Where the two would act differently, the instruction wins
  and the hygiene yields. So a foreign `.graphifyignore` refuses only when a `<repo>.list`
  exists; otherwise the default stands down and the corpus measurement has the last word.

  **(2) The default list dropped TRACKED content from the corpus, and wedged the tree.**
  `.graphifyignore` is a pure path filter that knows nothing about git, so the shipped
  list's own stated contract — "only what ccrc and its skills create" — was a comment, not
  a mechanism. In a repo that commits `.claude/settings.json` the default removed tracked
  nodes from `detect()`'s corpus. The corpus guard cannot notice: it measures corpus MINUS
  tracked, so a *shrinking* corpus never breaches. graphify's shrink guard then saw a net
  loss it could not account for (`had_explicit_deletions=False`, `watch.py:594`) and
  refused the write — `refused-shrink`, on every pass, for ever.

  **Seven repos on the reference fleet track such content — and three of them are among the
  five D-1160 was written to unblock.** The fix would have wedged the repos it targeted.

  The correction makes the contract a mechanism: the sweep asks git which TRACKED files a
  pattern would hide (`git ls-files -c -i -X` — exact gitignore semantics, not a bash
  reimplementation) and **withholds** any default pattern that would hide any, announcing
  what it withheld and naming the remedy. An operator pattern is honoured as written,
  tracked content included: that is the escape hatch, and rule (1)'s asymmetry again.

  **(3) The cleanup trap leaked past every refusal, and fired ungated.** `_gs_guard` armed
  `trap 'rm -f "$tree/.graphifyignore"' EXIT INT TERM` and only the BUILD path disarmed it.
  A corpus-breach refusal returned with the trap armed and the loop's `continue` skipped the
  disarm. Unreachable in practice before D-1160 (the block was opt-in); universal after it.
  Two measured consequences: at pass end the loop variable is EMPTY, so the leaked EXIT trap
  ran **`rm -f /.graphifyignore`** — at the filesystem root, every pass; and a SIGTERM
  mid-pass ran the trap against the tree in flight with the one `rm` in this file that was
  **not** ownership-gated, deleting a repo's own committed `.graphifyignore` (`git status`
  afterwards: ` D .graphifyignore`).

  Both are now structural rather than careful: the tree is carried in a global set at arm
  time (`GS_FILTER_TREE`), the removal re-checks ownership at fire time like every other
  removal site (`_gs_rm_generated`), and one cleanup+disarm in the caller's refusal branch
  covers every `return 1` in the guard, present and future.

  **(4) D-1159 stopped one import short.** It made the agent's ENTRY POINT exist; it did not
  make the tree STARTABLE. `_inst_tree`'s rsync excludes `node_modules` in both directions
  and the function ran `npm ci` in `server/` only, so a fleet install placed `agent/dist`
  beside no `agent/node_modules` — and `agent/src/server.ts` imports `ws` on its second line
  (`agent/package.json` declares `ws` and `node-pty` as runtime deps). `_inst_enable` then
  restarts `ccrc-agent.service` and node dies with the **same `ERR_MODULE_NOT_FOUND`**, one
  import further in. The reference fleet escaped it only because an earlier `deploy.sh agent`
  had left a `node_modules` behind — which is precisely why the postmortem saw the missing
  `dist` and stopped there. `deploy/build-release.sh` has shipped `agent/package{,-lock}.json`
  "for `npm ci --omit=dev` on the box" since it was written; this is the call it always meant.

  **(5) The D-1159 preflight's role gate refused the DEFAULT role**, and its comment asserted
  the opposite. `fleet` is the only role that installs the agent unit (`_inst_units`) or
  enables and restarts it (`_inst_enable`) — both test `[ "$INST_ROLE" = fleet ]`. The
  preflight gated on `!= server`, so `--role both` (the default: a single box that drives ccd
  directly in `local` mode and speaks to no agent) was refused over an artifact it never uses.
  A new failure mode introduced by the fix for an old one.

  Also corrected: `_inst_graph_noise` used a bare unchecked `cp` after an unchecked `mkdir -p`
  and printed "converged" whatever happened — the one install-time converger in `ccd/ccrc`
  bypassing `_inst_atomic`, while its own sibling on the deploy lane used `install_atomic`.
  It matters here more than most: the sweep timer reads that file every 15 minutes, so the
  write has a live reader, and `cp` writes THROUGH a symlink instead of replacing it.

  Files: `ccd/ccd-graph-sweep` (`_gs_rm_generated`/`_gs_disarm`, the three rules in
  `_gs_guard`, the caller's refusal branch), `ccd/ccrc` (the preflight's gate, the agent
  `npm ci`, `_inst_graph_noise`), `ccd/graph-noise.default.list` (header), and five test
  files.

## The mutation table

Nine mutations, each measured:

| mutation | result |
| --- | --- |
| foreign-ignore refusal gated on ANY list (the D-1160 first draft) | `(a2)` red |
| never withhold a default pattern | withhold + announce tests red |
| withhold operator patterns too (drop the asymmetry) | escape-hatch test red |
| drop the caller-side cleanup + disarm | stray-filter test red |
| restore the original inline trap body | **green alone** — see below |
| the two above TOGETHER (the true pre-fix state) | root-`rm` test red, reproducing `rm -f /.graphifyignore` |
| preflight gate back to `!= server` | `--role both` test red |
| drop the agent `npm ci` | agent-deps test red |
| bare `cp` for the noise list | atomic/symlink test red |
| delete deploy.sh's two lines | 3 of 4 ship tests red |

## What the table admits

The trap-body fix and the caller-side cleanup are **defense in depth**: each alone closes
the root-level `rm`, so neither reddens that test on its own, and only the pair reddens it.
That is stated here rather than papered over, because a table that claimed each was
independently pinned would be the same lie this branch already caught itself telling once.
The cleanup does have an effect of its own — a tree refused on the `detect()`-failure path
keeps its generated filter until a trap that a later tree's arm has renamed, i.e. never —
and that effect has its own test, which the cleanup mutation reddens.

## The recurring failure, fifth and sixth instances

`graph-sweep.test.ts` case (a) asserts, in its own describe header, that "a foreign file
must survive every pass, forever, **whether or not a noise list applies**". D-1160 made
that false on every installed box, and (a) stayed green — because no fixture in the file
ever installs the shipped default, so the suite went on exercising a world that no longer
existed. **A test can go stale without being touched**, when the code moves the world out
from under its fixtures. That is a new shape of *tests pin shape, not effect*, and the
remedy used here is to plant the REAL shipped artifact (`plantDefaultNoise` copies
`ccd/graph-noise.default.list` itself) rather than a hand-written paraphrase of it.

The sixth: the first root-`rm` test written in this round was itself vacuous — it stayed
green under both single mutations, because each fix masked the other. It was kept only
after the combined mutation reddened it, and its limitation is recorded above.

## Known, and deliberately not fixed here

The nine trees refused for genuinely untracked project files stay refused, and should. A
repo that tracks `.claude/` content and ALSO carries untracked files under it now keeps
both — the withheld pattern covers neither — so it stays refused until the operator tracks
the file or writes a `<repo>.list`. That is the guard doing its job, and the remedy is now
named on stderr every pass instead of being silent.

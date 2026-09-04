# D-1243 — everything kept the graph fresh; nothing made anyone read it

> **Not a multi-task plan.** This is the ledger record for one fix, written in plan shape
> because that is where this repo's deviation ledger lives.

**Goal:** Give graphify's READ path a mechanism, having spent three deviations perfecting
its write path.

---

## What was measured

D-1159, D-1160 and D-1161 all served the same half of graphify: the engine, the skill, the
per-tree excludes, the noise list, the 15-minute sweep. That half now works, and it was
verified by effect rather than shape — after the D-1161 deploy, `refused-by-guard` fell
from 15 trees to 11, and three repos rebuilt within minutes (OpenClawHetzner 2,611 nodes,
data-internal 4,181, wt-model-rates-sync 1,797), each `built_at_commit` matching HEAD.

None of it makes a session *read* a graph.

Measured across the five rostered homes before this step:

```
homes carrying the query-first rule ........... 0 of 5
homes carrying any always-on graphify text .... 2 of 5
  ...and what those two say: "When the user types `/graphify`, use the
     installed graphify skill" — an explicit slash command, which is the
     OPPOSITE of always-on
project CLAUDE.md files mentioning graphify-out  4 (ad hoc, in repos ccrc does not own)
```

So the update path was enforced by systemd and the read path was a skill description plus a
command the operator had to type. A graph could be rebuilt every fifteen minutes, be
perfectly current, and never once be consulted.

## Deviations found

- **D-1243** (2026-09-01) — the graphify integration had no read-side mechanism at all, and
  graphify itself ships the remedy we had never installed: `always_on/claude-md.md` in the
  package, whose first rule is *"For codebase questions, first run `graphify query`"*.
  `_inst_graph_always_on` converges it into every rostered wrapper home's `CLAUDE.md`.

  **Assembled from the package, never vendored.** `install-graphify-skill.sh`'s header
  states that rule for the skill (spec §B — "two writers to `<home>/skills/graphify` would
  drift"), and the same reasoning binds here: reading the block out of the pinned venv keeps
  its wording in lockstep with the engine the box actually runs, and leaves exactly one
  author.

  **Into the homes, not into the repos** — D-1161's asymmetry a third time. ccrc owns its
  wrapper homes and may converge them; it does not own the repos sessions work in. Writing
  this block into each project's `CLAUDE.md` would be ccrc editing files it has no claim on,
  which is the exact objection that killed O6(a). One block per home covers every session in
  every repo while touching nothing that is not ours.

  **Never clobbers.** The block sits between ccrc's own markers, so convergence is
  unambiguous and content outside them is neither read nor rewritten. A home whose
  `CLAUDE.md` carries an UNMARKED `## graphify` section — precisely what `graphify install`
  writes — is reported and SKIPPED: this installer did not author that text and cannot tell
  an operator's edit of it from a stale copy of it.

  `ccd/ccrc` (`_inst_graph_always_on`, registered after `_inst_graphify_skill`), and
  `server/test/ccrc-install{,-graphify}.test.ts`.

## Why graphify's own git hooks are still not the answer

The question "can graphify's shipped hooks do this for us?" has a clean answer: **they are
write-path only.** What the package installs is `post-commit` and `post-checkout` **git**
hooks that rebuild the graph. There is no read-side hook in it.

And the refusal recorded in O6 still holds on its own terms. Measured, those hooks satisfy
none of §C.2's five containment preconditions: a **detached** rebuild with no `nice`, no
`MemoryMax`, no slice, no `GRAPHIFY_NO_BACKUP=1`, and a worker cap applied **only under
Windows** — the 16-way fan-out C.2.5 exists to prevent, on the path that fires *during a
wave when N workers commit at once* — plus an interpreter pinned to `/usr/bin/python3`
rather than the venv.

There is now a second reason to keep that call. The sweep's idle gate is **narrow**: it
defers a tree only while a session is mid-turn on that exact tree, and the O3 escape hatch
overrides even that at ≥20 commits or ≥6h. So a hook would buy minutes of latency in
exchange for an uncontained fan-out at the worst possible moment.

## A defect of mine, in the fix, again

The first draft used `_ccrc_die` on all three availability gates. A fixture carrying no
graphify package then took the **whole install** down — a fix for a missing nicety that was
worse than the nicety being missing. `_inst_enable` already states the rule for the sweep
timer: a convenience "must not turn an otherwise-converged install into a failed one". All
three gates now degrade with a transcript line, and the degradation has its own test.

The three notices go to **stdout**, not stderr: a skip is this step's RESULT, and
`ccrc-install.test.ts` pins that a clean install leaves stderr empty.

## The number this entry nearly had

It was written as **D-1162**, which was free when this branch was cut and was **taken** by
the time it was committed: `origin/main` moved from `47ac50da` to `6ee36ca5` while the work
was in progress, and D-refs in shipped source now reach 1242 while the plans' own
`## Deviations found` definitions stop at 1161. Allocating from the ledger alone would have
collided, exactly as `CLAUDE.md` warns it has twice before — which is why the rule is to
grep `origin/main` across **both** `docs/` and source, and why it has to be re-run at commit
time rather than at cut time. Renumbered to D-1243 before the first push.

## A second defect of mine, found by self-review after the PR was opened

`~/.claude-gpt/CLAUDE.md` on the reference fleet **is a symlink** to
`~/.claude/CLAUDE.md` — two homes deliberately sharing one file. This step stages a temp file
and `mv`s it into place, which **replaces a symlink rather than writing through it**, so the
first draft would have severed that link silently. It happened not to, on this box, purely
because `.claude` sorts before `.claude-gpt` in the roster and the shared file already carried
the block by the time the link was reached: correctness by roster order, which is luck.

The destination is now resolved with `readlink -f` before any write, so the link survives, the
real file is converged once, and the loop no longer depends on the order homes appear in.

## The seventh vacuous test, and it was the one for this very fix

The first symlink test pointed a LATER home at an EARLIER home's file — and stayed **green
with the fix removed**, because the already-converged branch skipped the write and no `mv`
ever ran. It pinned the roster order, not the fix. It now puts the link on the home converged
FIRST, pointing outside the homes entirely (the dotfiles case), which puts it squarely on the
write path; the mutation then reddens.

Seventh instance in this repo of *tests pin shape, not effect*, and the third caught by the
mutation table rather than by review. The pattern across all three: the test was written from
the same mental model as the code, so it reproduced the code's blind spot instead of probing
it. Only running the mutation exposes that, which is why the table is measured and not
asserted.

## A third defect, and the only one no test here could have found

`test-macos` went red on the PR: **`awk: newline in string`**. The replace path passed the
whole multi-line block as `awk -v repl="$want"`. GNU awk accepts a newline inside a `-v`
assignment; **BSD awk, which macOS ships, refuses it** — so the rewrite died there and nowhere
else. Every Linux run in this repo was green, including seven mutation runs and two full
suites.

The splice is now three pieces — lines before the start marker, the block via `printf`, lines
after the end marker — so each `-v` carries a single line and the block never goes through awk
at all. Verified under `nawk` locally as well as the suite.

The guard added for it is an honest source rule, not an effect test, and its limits are stated
in the test itself: no fixture on Linux can reproduce a BSD awk refusal, so what is available
is to forbid the shape that causes it. `$want` is the one multi-line value in the function and
it must never reach a `-v`; every other `-v` value is pinned to the two single-line markers.

This is the argument for keeping the macOS CI leg. It is the slowest check by far (~30 min)
and it is the only thing in the pipeline that could have caught this.

## Mutation table

| mutation | result |
| --- | --- |
| never write the block | 4 tests red **at the time of writing — see D-1244** |
| always append; never replace between the markers | the replace test red |
| drop the unmarked-`## graphify` skip | the foreign-section test red |
| rewrite a file that is already current | the idempotence test red |
| `_ccrc_die` instead of degrading on a missing block | the degradation test red |
| drop the symlink resolution | the symlink test red (only after it was de-vacuumed) |
| pass the multi-line block through `awk -v` again | the awk-portability guard red |

## What this does NOT claim

This is an instruction, not an enforced code path. No hook can make a model query a graph,
and no test in this repo can assert that one did. What changed is that the rule is now in
context on every turn, unconditionally, in every rostered home — rather than living in a
skill description and a slash command the operator has to remember to type. That is a
materially stronger mechanism than what was there, and it is still weaker than the write
path's systemd timer. Both halves of that sentence are meant.

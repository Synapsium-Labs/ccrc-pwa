# Deviation numbers without the allocator: self-assigned, checked at merge

Status: draft for the owner's approval. Changes a standing rule (CLAUDE.md's deviation-ledger bullet), so it needs the
owner's sign-off before it lands.

## Why

A deviation number (`D-N`) is issued today only by `POST /api/ledger/deviations`, a box-token route on the team's ccrc
server. Every ccrc install runs its own server with its own empty ledger, so a number from a contributor's local server
is unique only on that machine. Only the team's server is a real authority, and an outside contributor has no way to
reach it and should not be given one. A contributor without it can only write `D-TBD-<slug>` and wait, and
`dtbd.test.ts` keeps the pull request red until someone with access issues numbers. As the project opens to outside
contributors, that is a wait on one person for every pull request that records a deviation.

## Goal

Anyone, from any checkout and with no server, can give a deviation its number and land it. Two deviations still never
share a number on `main`.

Non-goals: renumbering any existing `D-N`; changing what a deviation entry says or where it lives; changing the
`Ledger-Edit:` trailer or the ledger guard's layout arm.

Anti-goals: two definitions of one number reaching `main`; a contributor needing any secret, server or network call
beyond `git fetch`.

## The rule (decided)

**A new deviation takes the next number: the highest `D-N` defined on `origin/main` and on the author's branch,
plus one, and never below `D-10000`.** Several deviations in one change take consecutive numbers from there. The author assigns them; nobody
issues them.

- **Where a deviation is defined:** a `D-N` entry in any file under `docs/superpowers/plans/`,
  `docs/superpowers/programs/` or `docs/superpowers/specs/` (definitions exist in all three on `main`; since D-6926
  and D-8719 a task note under `programs/` is the usual home). "Highest on `main`" means across all three.
- **The floor of 10000** is the cut-over. The allocator has issued numbers that sit on open branches and are not on
  `main` yet (the highest on `main` measured 8966 on 2026-11-23; the allocator's own floor is higher). Starting at
  10000 keeps every self-assigned number clear of every number the allocator ever issued. 10000 is a round mark a
  reader can recognise as "after the allocator". It is the helper's starting point, not a guard: a number below it
  that collides with nothing is harmless, and the allocator-issued numbers on open branches must keep landing, which
  the repository cannot tell apart from any other low number. So nothing reds a low number; the collision check does
  the work.
- **A collision is caught, not prevented.** Two pull requests in flight will often take the same next number. The
  cross-tree check (`deviation-refs.test.ts` with `crossTreeCollisions`, which compares this branch's definitions
  against `origin/main`'s without merging) reds the one that is second to reach `main`, and the merge queue runs it on
  the merged result, so the pair never lands. The second author renumbers: the entry and every reference to it in the
  change. Today that check has two holes that self-assignment makes likely, and PR 1 closes both: it reads only
  `plans/` (`readPlansAt`), and it groups definitions by file, so one number defined twice in one file passes.
- **`D-TBD-<slug>` stays** as the placeholder for work in progress, and `dtbd.test.ts` still refuses it on `main`. It
  is now cleared by the author in one step (take the next numbers), not by waiting.

The owner chose plain "+1" over a random jump (2026-11-23). The cost is renumbering when two pull requests collide;
the check makes that loud and cheap.

## What changes

1. **The helper.** One command prints the next free numbers, so nobody counts by hand:
   `cd server && npm run next-deviation -- [count]` (a tsx script, `server/scripts/next-deviation.ts`, because the guards' reader is TypeScript) reads the definitions on `origin/main` (or `--ref <ref>`, for a fork's `upstream/main`) and on `HEAD`, so a
   stacked or unmerged branch never gets a number it already took, with the same `definitionsIn` the guards use and prints `max(highest + 1, 10000)` onward. No network, no token. (`ccrc-api ledger next` may wrap it later.)
2. **The guard.** For numbers of 10000 and above, the cross-tree check reads `plans/`, `programs/` and `specs/`, and
   reds one number defined with two different subjects, in one file or in two (council cycle 1: identical subjects
   are one deviation, so a spec mirroring its plan or a file renamed on the branch is not a collision, and a path on
   both trees is judged by the branch's copy). Below 10000 the check stays exactly as it is:
   measured on 2026-11-23, `main` holds 44 allocator-era numbers defined twice in one file and 43 restated across a
   plan and a spec or note, all landed and harmless, so widening the old range would red `main` on day one. Each
   widening ships with a fixture that goes red without it. The grandfathered sets are untouched (they may still only
   shrink). The failure messages in
   `dtbd.test.ts` and `deviation-refs.test.ts` name the helper instead of `POST /api/ledger/deviations`.
3. **The words.** Replace "you are ISSUED a number" with the rule above in CLAUDE.md's ledger bullet, CONTRIBUTING.md,
   README's allocator section, `shared/api.ts`'s brief sentence ("Never invent a deviation number…"), the coordinator
   skill's clause 10 and `references/peer-protocol.md`, `decision-procedure.md`, `cross-project.md` and
   `wave-lifecycle-run-care.md`, the worker skill's clause 11 and the reviewer skill's clause 6. The skills' clauses are pinned verbatim
   (`coordinator-skill.test.ts`, `reviewer-skill.test.ts`), and `ledger-instruction.test.ts` pins the three live
   instruction passages; each pin moves with its text in the same commit.
4. **The allocator retires.** Remove `POST /api/ledger/deviations`, `GET /api/ledger`, the `ccrc-api ledger` verbs, the
   watcher's `sweepLedgerFloor` and `sweepLedgerReconcile` (its orphan warning would fire on every self-assigned
   number), their `auth/gate.ts` EXEMPT rows and census entries, and the code in `server/src/coord/ledger.ts` that only
   they use. What the guards use (`definitionsIn`, `crossTreeCollisions`, the fence reader) stays. The `ledger_floor`
   and `ledger_alloc` tables stay in `coord.db` unread: `coord.db` migrations only move forward, and dropping them buys
   nothing. `~/.ccrc/ledger-alloc.log` stops growing. Keeping the allocator beside the new rule would be two owners of
   one fact, which CLAUDE.md forbids.

## Order

Two pull requests, so the rule can land fast and the removal is reviewed on its own:

- **PR 1, the rule:** items 1 to 3, and the allocator switched off. Left running, its prose-seeded floor would climb
  past 10000 off self-assigned numbers and it could issue a number someone already took, and
  `sweepLedgerReconcile` would warn about every self-assigned number. So in PR 1 `POST /api/ledger/deviations`
  answers 410 with a body naming the helper, and the watcher stops both ledger sweeps.
- **PR 2, the removal:** the rest of item 4, the dead code. `LEDGER_ALLOCATOR_ERA`, `projectEra` and
  `ledger-crosstree.test.ts` keep their meaning (the era still decides which numbers the subject-free rule covers)
  and are renamed or retired here only if the builder finds them dead.

The Flows stack's 14 `D-TBD-` placeholders take their numbers with the helper once PR 1 is on `main`.

## Left to the builder

- The helper's exact output format and whether `ccrc-api` wraps it.
- The guard's message wording.
- Splitting PR 2 further if the census edits make it large.

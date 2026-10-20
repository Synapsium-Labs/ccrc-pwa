# The hook's delegated-task jq lists held to the TypeScript lists as sets; the dead `isDelegatedTask` removed (#533, ARCH-26) — Implementation Plan

**Issue:** #533, "[ARCH-26] Delegated-task jq lists held to the TS lists by set equality; dead isDelegatedTask resolved". The consolidation wave design maps ARCH-26 onto K9 as the cluster's first ticket, with its scope unchanged (spec §4.1). K9's own planned task, ARCH-65 (the jq transcript library), does not include this test, so this slice lands on its own.

**Status:** complete in one PR. It is test-only apart from deleting one exported function that nothing called. `ccd/session-hook.sh` is not touched, so the hook's behaviour cannot change.

## The gap

The delegated-task rule has one TypeScript home in `shared/api.ts`: `NON_DELEGATING_TASK_KINDS` (six cleaned kinds) and `TERMINAL_TASK_STATUSES` (three words). It runs in exactly one place, the main Stop's `jq` program in `ccd/session-hook.sh`, which spells both lists again as `IN(...)`. `session-hook-background.test.ts` iterates over the TypeScript lists and runs the hook once per entry. That proves only TS ⊆ jq. If a kind or status is added to the `jq` alone, every existing test stays green and that task silently stops counting as delegated.

`isDelegatedTask({type, status})` was meant to be the TypeScript executor of the same rule, but it has no production caller. The server and the PWA never hold raw task objects: they read the hook's computed `bgDelegated` count and `bgDelegatedKinds`. A predicate with no input to run on cannot get a real reader, so it is deleted rather than given a made-up one.

## Changes

- `server/test/session-hook-background.test.ts`: a new describe, "the hook's jq lists equal the TypeScript lists as sets (D-6117)". It reads the `(kind | IN(...)) | not)` and `(.status | IN(...)) | not)` lists out of the hook as text and checks four things:
  - each list appears exactly once;
  - each list is plain string literals only;
  - neither list has a duplicate;
  - each list equals its TypeScript list as a set, in both directions.

  A CONTROL case checks the extractor itself: it reads a list, counts a copy, and refuses a non-literal entry.
- `server/test/single-definition.test.ts`: the delegated-task-rule describe now pins `isDelegatedTask` as declared nowhere across the four roots, so it cannot come back without a reader. The header comment and the test name were edited in place, with no line added, because `session-hook.test.ts` cites this file by line.
- `shared/api.ts`: `isDelegatedTask` is deleted. The lists' doc comment now says that the hook is the rule's only executor and that the jq lists are held to these lists as sets.

## Red first

- The new `single-definition` assertion was red on `origin/main`, because `shared/api.ts` still declared `isDelegatedTask`. It went green after the deletion.
- The set-equality case describes behaviour that already ships, so it is green on `origin/main` by design. Its red is the mutation table: M1 and M2 (a kind or status added to the jq alone) survive every test that existed before and are killed only by this case. That is the issue's first acceptance criterion.

## Mutation table

Measured on a `git archive` copy of `origin/main` with this slice's three files overlaid. The suites were `session-hook-background.test.ts` (whole) and `single-definition.test.ts` (`-t "delegated-task rule"`). Every mutant is killed.

| Mutant | Killed by |
|---|---|
| M1: a kind (`remote-agent`) added to the jq list only | the set-equality case only |
| M2: a status (`cancelled`) added to the jq list only | the set-equality case only |
| M3: `dream` dropped from the jq list | the iterating kind case and the set-equality case |
| M4: a kind (`remote-agent`) added to the TypeScript list only | the iterating kind case and the set-equality case |
| M5: `shell` duplicated in the jq list | the set-equality case only |
| M6: the jq entry `"dream"` written as `("dre" + "am")`, which behaves the same | the set-equality case only (non-literal entry) |
| M7: a second `(kind \| IN(...)) \| not)` list in the hook | the set-equality case only (exactly one list) |
| M8: `isDelegatedTask` declared again in `shared/api.ts` | the `single-definition` "isDelegatedTask nowhere" assertion |

## Not done here

- The issue's deferred `HookEvent` L0 union retype across five consumers. It waits for working-state Task 2, as the issue's proposal says.
- `ccd/session-hook.sh` and `server/src/watch.ts` are not touched. The `watch.ts` exclusion keeps this slice clear of open PR #832's `DelegationLane`.

## Deviations and decisions

D-6117 is defined here, once.

- **D-6117** — `delegated-task-jq-ts-set-equality`: the hook's `jq` `IN(...)` lists for the delegated-task rule are each spelled exactly once, as plain string literals with no duplicate, and each equals its `shared/api.ts` list (`NON_DELEGATING_TASK_KINDS`, `TERMINAL_TASK_STATUSES`) as a set in both directions. `isDelegatedTask` had no production reader, because no TypeScript code holds raw background tasks, so it is deleted and pinned as declared nowhere. Held by `session-hook-background.test.ts` and `single-definition.test.ts`.

Issued and unused: none

# Growth check: measure every large file, a classifier in place of the blanket new-file waiver, dated waivers

- **D-8563 (2026-11-13)** — growth-check-measure-everything: the operator's ruling of 2026-11-13, option A, "measure everything now, tighten later". (1) `GROWTH_FILES` gains every non-test source file over 3,000 lines, at the one per-PR limit (`GROWTH_LIMIT`, 40 net code lines) with no total ceiling, and a row fails when a tracked non-test source over 3,000 lines is not listed. (2) The blanket new-file waiver (`L1_L2_NEW_FILE_DIRS`, D-6046) is deleted: a new file waives a listed file's growth only when the ring classifier gives it the grown file's ring (`rings/ring.ts`) and context (the 08-10 spec's `ring-context-map` table, read at the merge-base). (3) Every waiver under `server/test/growth-waivers/` carries a required `createdAt` day, and the check reports the waivers older than 30 days by name, a report and never a failure.

## Why

Three gaps let growth go unmeasured. Eight source files over 3,000 lines were not listed, so they could grow without a row.
Any new file under `server/src/coord/` or `shared/` passed every listed file, however far it grew (the W5 C5h design
found `ccd/ccd` passing at +300 that way). And a waiver had no age the check could read, so old debt was invisible.

## (1) The files added to `GROWTH_FILES`

Measured with `wc -l` on 2026-11-13 at `972c36cb8`, over every tracked file that is not a test, a fixture, a doc, data
or a lockfile:

| File | Lines |
| --- | ---: |
| `shared/api.ts` | 14,499 |
| `ccd/ccrc-doctor-checks` | 12,105 |
| `ccd/history/lib.mjs` | 11,615 |
| `ccd/history/sweep.mjs` | 10,549 |
| `deploy/history-replay.mjs` | 10,128 |
| `pwa/src/fleet/fleet.css` | 4,466 |
| `deploy/account-op.mjs` | 3,558 |
| `server/src/coord/delegation-checkpoint.ts` | 3,273 |

The other files over 3,000 lines (`ccd/ccd`, `ccd/ccrc`, `server/src/watch.ts`, `server/src/coord/store.ts`,
`ccd/session-hook.sh`, `server/src/coord/routes.ts`, `server/src/server.ts`) were already listed. `fleet.css` is
measured by a new CSS stripper (`stripCss`: `/* */` comments and blank lines go; the bash stripper would have read a
`#id` rule as a comment). The `.mjs` files take the TypeScript stripper and `ccrc-doctor-checks` the bash one.

## (2) The classifier rule

The ARCH-04 stage-4 plan (`2026-10-24-arch-04-stage-4-ring-rules.md`, "Not in this stage") leaves `L1_L2_NEW_FILE_DIRS`
as a follow-up and states no rule of its own, so the rule is the ruling's words, read narrowly: **a file the diff adds
waives a listed file's growth only when both have a home and the homes are equal.** A home is `{ring, context}`:

- only a source under `server/src` or `pwa/src` has one (a test, story, declaration or `__` transient does not;
  `.css` counts in the PWA, as in stage 4's walk);
- the ring is `serverRing` or `pwaRing` over the file's blob at HEAD;
- the context is the spec table's row as the **merge-base** holds it, so a row the PR adds moves nothing;
- the listed file itself, new in its own diff, does not waive itself.

The homes of today's listed files: `watch.ts` L4 K, `server.ts` L4 K, `coord/store.ts` L3 C5, `coord/routes.ts` L4 C5,
`sessionws.ts` L4 C3, `coord/delegation-checkpoint.ts` L1 C5, `pwa/src/lib/api.ts` L3 K, `pwa/src/fleet/fleet.css`
L4 C1. Every ccd file, `shared/api.ts` and the `deploy/` and `ccd/history/` modules have no home, so no new file
waives them; a waiver or a listed shrink still does.

## (3) Waiver ages

`createdAt` is the day the waiver file first entered the ledger, from `git log --diff-filter=A` of its file (the
commit date of the squash on `main`). `added` stays as the author wrote it. A waiver at HEAD must carry `createdAt`;
a merge-base's waiver may lack it, so a PR behind this change still reads its base. The age is counted from
`createdAt` in whole days; more than 30 is reported on every run (console and job summary). Ages on 2026-11-13:

| Waiver | added | createdAt | Days |
| --- | --- | --- | ---: |
| `D-6180-ccd-ccd.json` | 2026-10-21 | 2026-10-25 | 19 |
| `D-6181-ccd-ccd.json` | 2026-11-04 | 2026-11-06 | 7 |
| `D-6619-ccd-ccd.json` | 2026-10-23 | 2026-10-25 | 19 |
| `D-6693-ccd-ccrc.json` | 2026-10-23 | 2026-10-25 | 19 |
| `D-6773-ccd-ccd.json` | 2026-10-24 | 2026-10-25 | 19 |
| `D-6786-server-src-watch-ts.json` | 2026-10-25 | 2026-10-25 | 19 |
| `D-6798-ccd-session-hook-sh.json` | 2026-10-24 | 2026-10-25 | 19 |
| `D-6907-ccd-ccrc.json` | 2026-10-25 | 2026-10-25 | 19 |
| `D-6918-ccd-ccrc.json` | 2026-11-03 | 2026-11-04 | 9 |
| `D-7081-ccd-ccd.json` | 2026-10-27 | 2026-10-28 | 16 |
| `D-7111-ccd-session-hook-sh.json` | 2026-10-29 | 2026-10-29 | 15 |
| `D-7302-ccd-ccd.json` | 2026-10-28 | 2026-10-29 | 15 |
| `D-7351-ccd-session-hook-sh.json` | 2026-10-30 | 2026-10-30 | 14 |
| `D-7599-pr-state-pr-form.json` | 2026-10-31 | 2026-10-31 | 13 |
| `D-7735-ccd-ccrc.json` | 2026-11-01 | 2026-11-02 | 11 |
| `D-7750-ccd-ccrc.json` | 2026-11-02 | 2026-11-03 | 10 |
| `D-7902-ccd-ccd.json` | 2026-11-04 | 2026-11-05 | 8 |
| `D-7906-ccd-ccrc.json` | 2026-11-04 | 2026-11-05 | 8 |
| `D-8001-ccd-session-hook-sh.json` | 2026-11-05 | 2026-11-05 | 8 |
| `D-8002-ccd-ccd.json` | 2026-11-05 | 2026-11-06 | 7 |
| `D-8016-ccd-ccrc.json` | 2026-11-04 | 2026-11-06 | 7 |
| `D-8077-coord-routes-ts.json` | 2026-11-09 | 2026-11-10 | 3 |
| `D-8077-coord-store-ts.json` | 2026-11-09 | 2026-11-10 | 3 |
| `D-8077-watch-ts.json` | 2026-11-09 | 2026-11-10 | 3 |
| `D-8078-coord-store-ts.json` | 2026-11-09 | 2026-11-10 | 3 |
| `D-8078-watch-ts.json` | 2026-11-09 | 2026-11-10 | 3 |
| `D-8121-ccd-ccd.json` | 2026-11-08 | 2026-11-08 | 5 |
| `D-8122-ccd-ccrc.json` | 2026-11-08 | 2026-11-08 | 5 |
| `D-8123-ccd-ccd.json` | 2026-11-09 | 2026-11-09 | 4 |
| `D-8124-ccd-ccd.json` | 2026-11-09 | 2026-11-09 | 4 |
| `D-8135-ccd-session-hook-sh.json` | 2026-11-09 | 2026-11-10 | 3 |
| `D-8147-ccd-ccd.json` | 2026-11-09 | 2026-11-10 | 3 |
| `D-8173-ccd-ccd.json` | 2026-11-11 | 2026-11-11 | 2 |
| `D-8193-ccd-ccd.json` | 2026-11-11 | 2026-11-11 | 2 |
| `D-8286-ccd-ccd.json` | 2026-11-11 | 2026-11-11 | 2 |
| `D-8320-ccd-ccd.json` | 2026-11-12 | 2026-11-12 | 1 |
| `D-8335-ccd-ccd.json` | 2026-11-11 | 2026-11-11 | 2 |

None is over 30 days today; the seven created 2026-10-25 are the first reported, from 2026-11-25.

## Deviations found

- **No rule in the ARCH-04 plan.** It names the follow-up and no rule; the ruling's "the ring and context the growth
  moved out of" is implemented as equal ring and equal context, the narrowest reading. A new `coord/` decider (L1) no
  longer waives `store.ts` (L3), and a new `shared/` file waives nothing: plans that counted on that waiver
  (landing-order waves 5e, 5g and 5h) need a waiver file or a shrink from now on.
- **`createdAt` beside `added`.** Waivers already carried `added`, written by hand. `createdAt` is the ledger date,
  read from git, and for the waivers the directory migration (D-6925) moved it is the migration's day, not the
  original entry's. The backfill is the one edit the "no waiver the merge-base holds is edited" row allows.
- **The classifier is growth machinery.** `rings/ring.ts`, `rings/ringContextMap.ts`, `rings/walkSrc.ts` and the new
  leaf `ccdContextIds.ts` join `GROWTH_MACHINERY` (the ruled seven become eleven), because the closure row holds every
  module the check loads there. `CCD_CONTEXTS` moved to `ccdContextIds.ts` (`consolidationCensus.ts` re-exports it)
  so the check does not load the census. The closure row now allows `node:module` when it binds only
  `builtinModules` or `isBuiltin`, which load nothing (`ring.ts` reads `builtinModules`).
- **`deploy/account-op.mjs` and `fleet.css`** were not in the task's list; they are over 3,000 lines, so they are added.
- **Not here:** the file-split plan's `SPINE_LIMIT` (its Task 8), which stays after the split.

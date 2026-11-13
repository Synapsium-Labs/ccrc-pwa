# The large-file programme: one file at a time (design)

**Spec** · 2026-11-13 · D-8615 · Status: **for the operator's approval** (§5). Docs only: no code ships with it.
Every figure was measured on `origin/main` `218a5e3a3`; line citations are snapshots of that sha, not anchors. "Code
lines" is the growth check's measure, `codeLines` in `server/test/growthCheck.ts`. The plan doc is
`docs/superpowers/plans/2026-11-13-large-file-programme.md`.

- **D-8615 (2026-11-13)** — `large-file-programme`: a design for refactoring every source file over 3,000 lines, one
  file at a time, by DDD, Clean Architecture and SOLID. Each file ends at a target layout with one context and one ring
  per module, then takes an absolute cap that may only fall.

## 1. Goal, and the measure of done

| File | Lines | Code lines | Commits, 14 days | Context and ring today |
|---|---|---|---|---|
| `ccd/ccd` | 48,487 | 21,759 | 52 | every ccd context (`ccd/contexts.tsv`) |
| `ccd/ccrc` | 30,108 | 14,140 | 48 | install, update, accounts, models; no context map |
| `shared/api.ts` | 14,517 | 5,088 | 79 | L0, the wire vocabulary (1,057 exports) |
| `server/src/watch.ts` | 12,304 | 6,244 | 55 | K, L4: `FleetWatcher` (254 methods), `DelegationLane` (73) |
| `ccd/ccrc-doctor-checks` | 12,106 | 6,895 | 27 | 165 functions behind one table, every context |
| `ccd/history/lib.mjs` | 11,615 | 6,981 | 7 | history L1 (649 exports) |
| `server/src/coord/store.ts` | 11,195 | 5,257 | 46 | C5, L3: `CoordStore` (402 methods) |
| `ccd/history/sweep.mjs` | 10,549 | 6,677 | 2 | history L4, the store's writer |
| `deploy/history-replay.mjs` | 10,128 | 6,756 | 0 | history W2 replay driver |
| `ccd/session-hook.sh` | 6,343 | 2,836 | 20 | the hook: C1, C3, C6 and history |
| `server/src/coord/routes.ts` | 4,898 | 2,578 | 33 | C5, L4: 74 routes in one function |
| `pwa/src/fleet/fleet.css` | 4,466 | n/a | 32 | L4 styles for C1, C4, C5 and K |
| `server/src/server.ts` | 4,388 | 1,971 | 41 | K, L4: 60 inline routes |
| `deploy/account-op.mjs` | 3,558 | 1,839 | 9 | C1 operator script |
| `server/src/coord/delegation-checkpoint.ts` | 3,273 | 2,335 | 3 | C5: L1 above `:1739`, L3 below |

**Target shape.** Each module holds one context and one ring, with one reason to change; the original file keeps only
its role (façade, spine, route registration or schedule). **A file is done when:**

1. every module the refactor produced is under the **ceiling** (Q1): 2,500 code lines, about the ccd plan's "no
   library over 6,000 lines" at this repository's comment density;
2. `rings/totality.test.ts` gives every new module one ring and one context;
3. the original file is reduced to its role;
4. it carries an absolute cap by §4's one rule, and no growth waivers;
5. its characterization pins are green and stay in the tree.

**Where the ceiling decides nothing.** At 2,500, `server.ts`, `delegation-checkpoint.ts` and `account-op.mjs` already
pass item 1, and `routes.ts` is 78 over. They are in scope for mixing contexts or rings, so their done test is items 2
to 5. At Q1's other option, 1,500, the ceiling binds all four: `routes.ts` must lose about 1,080 code lines,
`delegation-checkpoint.ts` 835, `server.ts` 471 and `account-op.mjs` 339.

This answers the closure's carried constraint 7 per file: a budget while a file moves, a cap once it is done. The 39
waivers in `server/test/growth-waivers/` show a budget alone does not stop growth.

## 2. The method, the same for every file

1. **Pin first, on `main`:** characterization tests that pass against the old code (O9 (a) allows such a series).
2. **Pure-move slices, one PR each**, changing only imports, exports or loader lines: either top-level declarations
   byte for byte, or **delegate extraction** (a method body moves to a function, the method stays a one-line delegate,
   the body identical but for `this.`), as `ledgersStore.ts` does.
3. **One behaviour change per commit:** a defect found in a move gets its own later commit, red test first.
4. **A slice tool and a pure-move pin, as in the ccd plan's Task 1.** Bash reuses `ccd-split.py` and `programDump`.
   TypeScript and `.mjs` get `.github/ci/file-split.mjs` on `server/test/scan/parse.ts`, with `plan`, `preflight` (no
   open PR has a hunk in the slice, and §4's context slot is free) and `move`. Pins judge against `moveBase`: moved
   declarations' text equal; for `.mjs`, equal namespace keys and `String()` of each export.
5. **Review each slice through a pure-move lens**, at most two rounds, three if security-sensitive.
6. **Freeze growth:** from the pin PR to the cap PR the per-PR limit is 10, not 40 (`SPINE_LIMIT`); waivers waive
   nothing; new code goes to the target module §3 names; the operator's named exemption is the only way past (Q8).
7. **Scanners move before the code:** each slice repoints text-reading census and ratchet tests to a program view, as
   `ccdSource()` does, so no scan stays green because the code left it (rule (e)).

## 3. Per file

**`ccd/ccd`.** D-8048 unchanged: 19 slices, then Phase D. Its Task 0 (measured 2026-11-13) named #2735, #2739 and #2742
as open PRs on `ccd/ccd`. At `218a5e3a3` #2735 and #2742 have merged; the unmerged heads that edit `ccd/ccd`, read by
git from `refs/pull/N/head`, are #2739 and #2740 (Overlord, both also edit the hook) and #2763 (a ccd fix). Task 0 waits
on those, and its list is refreshed when ticked. Ruling touched: no runtime-sourced ccd siblings (2026-10-26);
assembling at install keeps to it.

**`ccd/ccrc`.** Phase D of that plan: 11 slices, `ccrc-update` last, gated by Phase B and Q7 (how the file loads). Its
context map also covers the doctor.

**`ccd/ccrc-doctor-checks`.** The table `CCRC_DOCTOR_CHECKS` (`:178`) and `_dr_*` helpers stay in the spine; checks go
to about ten `ccd/doctor/<group>.sh` libraries loaded by Q7: tools, disk and backups (K); services (C2); auth and box
token (C8); accounts, pools and models (C1); transcripts and history (C3); update (C7); approvals (C6); docs (C9);
delegation hooks (C5). Smallest and coldest first; `_check_graphify` (`:4763`, 621 lines) alone. Pin: each check's
verdict lines on existing fixtures (79 test files name this file) and the table's order. Risk: lines "cited by number
elsewhere" become anchors first.

**`ccd/session-hook.sh`.** It runs on every tool call, so it stays one installed file, assembled at install as in ccd's
Task 5 (Q9). Target: `hook-compact` (C3: compaction arms and stable lock, `:1078` to `:2503`, `:2723` to `:2930`),
`hook-cards` (C9: `:2504` to `:2722`), `hook-history` (C3: `:3100`), `hook-approval` (C6), `hook-roster` (C1). The event
`case` (`:3265`) and the generated helpers (`:64` to `:78`) stay in the spine. Pin: the hook suites and `programDump` of
the assembled file. Gate: ccd Task 5 and the Overlord hook PRs (#2739, #2740).

**`server/src/coord/store.ts`.** `CoordStore` stays one class (the Rejected entry; `DatabaseSync` is synchronous), and
consolidation §2.5 allows "files per context inside one class". Today: types (`:1` to `:1915`); C5 runs (`:1925`), mail
(`:6547`), claims (`:8517`); C6 feed and approvals; C4 lifecycle mirror (`:7984`); C1 pool edges (`:9759`); C7 updates
(`:9860` to `:10665`). Target: `coord/<concern>Store.ts` modules for runs, mail, claims, lifecycle, attention, updates
and pools beside the seven that exist; row types to `coord/storeRows.ts` (L2); `store.ts` a façade of delegates
(inferred 1,200 code lines). Pin: the set of SQL texts the store prepares is unchanged. Risk: a delegate runs in its
caller's `tx()`, never its own. Ruling touched: none.

**`server/src/watch.ts`: FleetWatcher, where a split was rejected.** `FleetWatcher` runs `:655` to `:9678`; largest
methods `mailPass` (`:7904`, 605 lines), `childReclaimPass` (`:4382`, 546), `tick` (`:2514`, 519). `DelegationLane`
(`:10412`) is a separate class. `*Lane.ts` and `*Beat.ts` already hold 5,360 lines behind one-line methods. O4 (a)
re-affirms the rejection: lanes stay methods driven by `LANE_SCHEDULE` and `runLane`.
- **(a) Keep it, narrower (recommended).** Step 1: pure-move `DelegationLane` to `coord/delegationLane.ts` (C5); it was
  never part of `FleetWatcher`. Step 2: delegate-extract each lane body into its context's lane file; method, table row
  and `runLane` stay. Step 3: deciders found go to L1. §4 orders the steps by context.
- **(b) Revisit with per-context scheduler classes.** Reopens O4 (a). Not recommended.
- Pins: tick-order and lane-census tests, `rings/watcher-store-port.test.ts`, lane suites. **Operator** (Q3).

**`server/src/coord/routes.ts`: kept as one file by ruling 12.** `registerCoordRoutes` (`:575` to `:4898`) holds 74
routes; 21 handlers exceed 60 lines, 12 exceed 100, the largest `POST /api/mail` (`:767`, 365). By `ringContextMap.ts`,
18 routes belong to other contexts: `/api/testbox` (5, C2); approvals, questions, asks, feed (9, C6); landing and
lifecycle (4, C4). Ruling 12 (D-8066) keeps existing routes here; a new group gets its own file. The ceiling cannot
choose here (§1).
- **(a) Drain.** Every route stays registered here (`coord-pause-route.test.ts` reads them all); decisions move to L1
  deciders (the `openRun`, `decideDispatch` pattern), outcome mappers to a delivery helper. Done per handler: parse,
  gate, one decider or store call, map, in at most 60 lines.
- **(b) Move only the 18 other-context routes** to their contexts' route files, called from `registerCoordRoutes` so
  every census still sees them, as `ledgersRoutes.ts` is. Without it, `routes.ts` stays a named exception to one
  context per module. 67 test files name this file.
- **Recommendation:** (a), then (b); the trigger is the context rule, not size. **Operator** (Q4).

**`server/src/server.ts`.** No ruling covers it. `buildServer` (`:368` to `:4388`) holds 12 auth routes (from `:679`)
and 37 session routes (`:2433` to `:4347`) inline beside 14 `register*Routes` calls, the precedent. Target: auth to
`auth/routes.ts` (C8), sessions to `sessionRoutes.ts` (C3), pools and accounts to C1, notify and push to C6; `server.ts`
keeps composition, socket upgrades and `/health`. Pin: `app.printRoutes()` (method, path, gate), the auth-gate and
box-token censuses.

**`server/src/coord/delegation-checkpoint.ts`: the pilot.** Codec, builder and recovery above `:1739` (L1);
`DelegationDurability` (`:2163`) and the SQLite projection below (L3). Target: `delegation-checkpoint.ts`,
`delegation-recovery.ts` (L1), `delegation-durability.ts`, `delegation-projection.ts` (L3), all pure moves of top-level
declarations. Risk: the coordination scanner reads the words spelled at `:3229`; that block moves with them.

**`ccd/history/lib.mjs`, `sweep.mjs`, `deploy/history-replay.mjs`.** The open ccrc-history programme owns them, and
`lib.mjs` has a slot held for a redaction PR; gate: that programme's coordinator or close. `lib.mjs` becomes modules
under `ccd/history/lib/` behind an `export *` barrel: vocabulary (`:34`); paths and ids (`:443`, `:885`); spool and
journal (`:1055`, `:1166`); health (`:4399`); headless seam (`:4968`); as-of cut (`:5349`); read verbs (`:8776` to
`:10056`); doctor repair (`:10159`); steer (`:10410`). `lib.d.mts` splits alike under the same namespace pin.
`sweep.mjs` splits by pass phase after it. `history-replay.mjs`, untouched since 2026-10-27 and "not run, not
scheduled", is capped and left (Q6).

**`shared/api.ts`: kept whole by the Rejected list.** It is the ubiquitous language, parsed by three processes on
independent deploy cadences; 99 test files read it as text and 464 source files import it.
- **(a) Keep it, narrower (recommended).** Cap it now; new vocabulary keeps going to one-concern siblings
  (consolidation §2.5). A named exception to the ceiling.
- **(b) Revisit narrowly.** Move concern blocks that have a sibling, re-exported so no import changes (precedent
  `export type { NodeRole }`, `:10499`): accounts (`:13627`), approvals (`:13220`), digest, stall-watch, test box.
  Needs a `sharedSource()` program view first.
- Hottest file (79 commits in 14 days), so either runs last. **Operator** (Q5).

**`fleet.css` and `account-op.mjs`.** Caps only; `account-op.mjs` is one context under the ceiling. `fleet.css` may
later split per component, pinned by screenshots at 390, 1280 and 1920.

## 4. Sequence, parallelism, caps

| # | File | Gate | Why here |
|---|---|---|---|
| 0 | caps, `file-split.mjs` and its pin | #2750 (D-8563) merged | everything below uses them |
| 1 | `ccd/ccd` | its Task 0 | D-8048, unchanged |
| 2 | `delegation-checkpoint.ts` | none | pilot: pure moves, cold, clear rings |
| 3 | `server.ts` | none | no ruling, a precedent, hot |
| 4 | `store.ts` | after 2 (C5) | the deciders of 6 need its modules |
| 5 | `watch.ts` | Q3; step 1 after 4 | `DelegationLane` first |
| 6 | `routes.ts` | after 5's step 1; Q4 | drains into the deciders |
| 7 | `ccd/ccrc`, then the doctor | Phase B; Q7 | one loader |
| 8 | `session-hook.sh` | ccd Task 5; Overlord | reuses the assembler |
| 9 | `lib.mjs`, then `sweep.mjs` | the history programme | owned elsewhere |
| 10 | `shared/api.ts` | Q5 | most readers, hottest |

**Parallelism: the slot is the context a slice writes, not the file.** `preflight` takes the slot of every context the
slice's destination modules sit in (`ringContextMap.ts`) and refuses while another file's open move PR holds one. A file
has at most one open move PR; a slice yields to features. That gives:
- **C5:** `delegation-checkpoint.ts`, `store.ts`, `watch.ts` step 1 (one PR), then `routes.ts`.
- **`watch.ts` step 2:** each lane-body slice takes its lane file's context. C1, C2, C4 and K lanes run beside the C5
  sequence once `server.ts` (K, C8, C3, C1, C6) has closed; C5 lanes such as `mailPass` wait for `routes.ts`.
- **The bash track** (`ccd/ccd`, then `ccd/ccrc` and the doctor, then the hook) runs in sequence because the files share
  the slice tool, the assembler and Q7's loader, not a context. Its modules never meet a server module, so it runs
  beside them.

In-flight programmes keep their files until they close or hand over a slot: session-continuity and Overlord (`ccd/ccd`,
the hook, `api.ts`), ccrc-history, the delegation broker (`delegation-checkpoint.ts`).

**From budgets to caps.** #2750 lists every file over 3,000 lines at the 40-line per-PR limit. Step 0 adds caps:
- **One rule:** a cap is the code lines measured on the PR that sets it, plus 40 (one PR's budget, so a small fix needs
  no exemption), and may only fall. A finished file takes it at its closing PR; files between 1,500 code lines and
  3,000 lines (`collectLane.ts`, `coord/stall.ts`, `ccd/ccrc-testbox-admin`, others) and the cap-only files take it at
  step 0, so the next god file cannot form.
- **Storage:** `server/test/growth-caps/`, one JSON file per capped file (`{file, cap, d, since}`), so two PRs never
  edit one line (why `growth-check.test.ts` has "no per-file absolute constant" today).
- **Check:** code lines at HEAD within the cap; the cap at HEAD within the merge-base's; a capped file drops the per-PR
  limit and its waivers; the named exemption may raise a cap once.
- **Stages:** listed (40 per PR), frozen (10, §2.6), capped. A new module is bounded by the ceiling until its file
  closes, then capped by the same rule; one that reaches the ceiling first splits by sub-domain in a pure move.

**Operator acts in the console.** Starting a file and granting an exemption are ledger items under "Waiting on you"
with their own control; the coordinator writes the cap or exemption file after the tap.

## 5. Questions for the operator, recommendation first

1. **Ceiling:** 2,500 code lines (three files already pass and are refactored for rings and contexts only); or 1,500,
   which binds those too and adds seven files.
2. **Caps:** §4's one rule (measured plus 40, may only fall); or budgets only.
3. **FleetWatcher:** is option (a) inside O4 (a)? Recommended: yes.
4. **`routes.ts`:** drain, then move the 18 other-context routes; or drain only, a named exception.
5. **`shared/api.ts`:** keep whole and cap now; or move concern blocks to re-exported siblings.
6. **`history-replay.mjs`:** cap only; or retire it; or refactor it.
7. **Order:** §4's, with `delegation-checkpoint.ts` as the pilot.
8. **Freeze:** 10 lines per PR, no waivers, the named exemption as the only door.
9. **Hook and doctor:** assembled at install like ccd, decided with Q7 at the Phase D gate.
10. **Starts and exemptions:** ledger items with a console control; or a hand-edited JSON door.

## Known limits

- The `store.ts` façade size, what draining removes from `routes.ts`, and ccd library code lines are inferred.
- Method and handler lengths run header to header, trailing comments included. `fleet.css` has no code-line measure.
- Whether #2739, #2740 and #2763 are open was not read (no REST call); git shows only that they have not merged.

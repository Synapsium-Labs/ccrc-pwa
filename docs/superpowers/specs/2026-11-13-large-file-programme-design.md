# The large-file programme: one file at a time (design)

**Spec** · 2026-11-13 · D-8615 · Status: **for the operator's approval** (§5). Docs only: no code ships with it.
Every size, line and count below was measured on `origin/main` `218a5e3a3`. Line citations are snapshots of that sha,
not anchors. "Code lines" means the growth check's own measure: `codeLines` in `server/test/growthCheck.ts`, which drops
comments and blank lines and counts heredoc bodies. The plan doc is `docs/superpowers/plans/2026-11-13-large-file-programme.md`.

- **D-8615 (2026-11-13)** — `large-file-programme`: a design for refactoring every source file over 3,000 lines, one
  file at a time, by DDD, Clean Architecture and SOLID. Each file ends at a target layout with one context and one ring
  per module, then takes an absolute cap that may only fall.

## In short

The architecture refactor (closed, D-8565) fixed import directions and owners, not size: fifteen non-test files are
still over 3,000 lines. This design gives each the same method, a target layout, a place in the order and a size rule
for after. The `ccd/ccd` split plan (D-8048) is unchanged and goes first when its gate opens.

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

**Target shape.** Each module holds one bounded context and one ring, and has one reason to change. The original file
keeps only its role, such as façade, spine, route registration or schedule.

**A file is done when all six hold:**

1. Every module the refactor produced is under the **ceiling**: 2,500 code lines (Q1). That is about 5,000 to 6,000
   lines at this repository's comment density, which matches the ccd plan's "no library over 6,000 lines".
2. `rings/totality.test.ts` gives every new module one ring and one context.
3. The original file is reduced to its role.
4. The original file carries an **absolute cap**: the code lines measured at the closing PR plus 40, set once, and it
   may only fall (§4).
5. The file has no growth waivers left.
6. Its characterization pins are green and stay in the tree.

This answers the closure's carried constraint 7 (absolute caps or per-PR budgets) for every file: a budget while a file
moves, a cap once it is done. The 39 waivers in `server/test/growth-waivers/` show a budget alone does not stop growth.

## 2. The method, the same for every file

1. **Pin first, on `main`.** The first PR adds characterization tests that pass against the old code. O9 (a) allows a
   standalone series that starts with such a pin.
2. **Pure-move slices, one PR each.** A move commit changes only imports, exports or loader lines. There are two kinds:
   - **Pure move:** top-level declarations, byte for byte.
   - **Delegate extraction:** a method body moves into a function, and the method stays as a one-line delegate. The
     body is identical apart from `this.` becoming the parameter, and the tool checks that. `ledgersStore.ts` already
     works this way ("`CoordStore` keeps the public methods as one-line delegates").
3. **One behaviour change per commit.** A defect found during a move gets its own commit after the move, red test first.
4. **A slice tool and a pure-move pin, as in the ccd plan's Task 1.** Bash reuses `ccd-split.py` and `programDump`
   (generalised by Phase D). TypeScript and `.mjs` get `.github/ci/file-split.mjs` on the one parser module
   (`server/test/scan/parse.ts`), with `plan`, `preflight` (no open PR has a hunk in the slice) and `move`. Pins judge
   against `moveBase`: for TypeScript, moved declarations' text equal and only imports and exports otherwise changed;
   for `.mjs`, the module imported at base and HEAD with equal namespace keys and `String()` of each export.
5. **Review each slice through a pure-move lens** (only imports changed; every scanner still sees the code), at most
   two rounds, three for a security-sensitive file.
6. **Freeze growth during the refactor.** From the pin PR to the cap PR the file's per-PR limit is 10, not 40 (the ccd
   plan's `SPINE_LIMIT`); waivers and the new-file route waive nothing; a feature puts new code in the target module §3
   names, creating it if needed; the operator's named exemption is the only way past (Q8).
7. **Scanners move before the code.** Each slice repoints the census and ratchet tests that read the file as text to a
   program view, as `ccdSource()` does for ccd, so no scan stays green because the code left it (rule (e)).

## 3. Per file

**`ccd/ccd`.** The D-8048 plan is unchanged: 19 slices, then Phase D. Task 0 still holds, because #2739, #2740 and #2763
edit `ccd/ccd`. The ruling it touches is the ban on runtime-sourced ccd siblings (2026-10-26). Assembling the file at
install keeps to it.

**`ccd/ccrc`.** This is the same plan's Phase D: 11 slices with `ccrc-update` last, gated by Phase B's exit and Q7 (how
the file loads). One addition: Phase D's step 0 context map, `ccd/ccrc-contexts.tsv`, also covers the doctor.

**`ccd/ccrc-doctor-checks`.**
- **Today:** `ccrc` sources it from the tree. The table `CCRC_DOCTOR_CHECKS` (`:178`) stays the one table.
- **Target:** about ten fixed `ccd/doctor/<group>.sh` libraries, loaded as Q7 rules; the table and `_dr_*` helpers stay
  in the spine. Groups: tools, disk, backups and memory (K); services and scopes (C2); auth, exposure and the box token
  (C8); wrappers, accounts, pools, models and routing (C1); transcripts and history (C3); update and provenance (C7);
  approvals (C6); docs (C9); delegation hooks (C5).
- **Order:** smallest and coldest first; `_check_graphify` (`:4763`, 621 lines) goes alone.
- **Pin:** the verdict lines of each check on the existing fixtures (79 test files name this file), and the order of the
  table.
- **Risk:** its comments say lines are "cited by number elsewhere"; those become anchors first.

**`ccd/session-hook.sh`.**
- **Today:** it runs on every tool call, so it stays one installed file. Libraries are assembled at install, as in
  ccd's Task 5 (Q9). Sections: envelopes (`:91`); compaction arms and the stable lock (`:1078` to `:2503`, `:2723` to `:2930`); cards and
  gates (`:2504` to `:2722`); history spool and card (`:3100`); approvals; the roster card; the event `case` (`:3265`).
- **Target:** `hook-compact` (C3), `hook-cards` (C9), `hook-history` (C3), `hook-approval` (C6) and `hook-roster` (C1).
  The `case` and the generated helper block (`:64` to `:78`) stay in the spine.
- **Pin:** the hook suites and `programDump` of the assembled file.
- **Gate:** ccd Task 5 has landed, and so have the session-continuity hook PRs (#2739, #2740).

**`server/src/coord/store.ts`.**
- **Today:** `CoordStore` stays one class (the Rejected entry; `DatabaseSync` is synchronous), and consolidation §2.5
  already allows "files per context inside one class". Sections: types (`:1` to `:1915`); C5 runs (`:1925`), mail
  (`:6547`), claims (`:8517`), ledger and delegation; C6 feed, notify, approvals and digest; C4 the lifecycle mirror
  (`:7984`); C1 pool edges (`:9759`); C7 updates (`:9860` to `:10665`); K settings and recovery.
- **Target:** `coord/<concern>Store.ts` function modules for runs, mail, claims, lifecycle, attention, updates and
  pools, beside the seven that exist. Row types go to `coord/storeRows.ts` (L2). `store.ts` becomes a façade of
  delegates, inferred at about 1,200 code lines (402 methods).
- **Pin:** the set of SQL statement texts the store prepares is equal before and after, and the store suites stay green.
- **Risk:** a delegate runs inside its caller's `tx()` and never opens a transaction of its own.
- **Ruling touched:** none.

**`server/src/watch.ts`: FleetWatcher, where a split was rejected.**
- **Today:** `FleetWatcher` runs from `:655` to `:9678`. Its largest methods are `mailPass` (`:7904`, 605 lines),
  `childReclaimPass` (`:4382`, 546) and `tick` (`:2514`, 519). The delegation lane (`:9681` to the end) is a separate
  class, `DelegationLane` (`:10412`). `*Lane.ts` and `*Beat.ts` already hold 5,360 lines of lane code behind one-line
  methods, for example `sleepLane.ts`.
- **Ruling:** O4 (a) re-affirms the rejection: lanes stay methods driven by `LANE_SCHEDULE` and `runLane`.
- **(a) Keep it, with a narrower change (recommended).**
  1. Pure-move `DelegationLane` and its constants to `coord/delegationLane.ts`. It was never part of `FleetWatcher`.
  2. Delegate-extract each lane's body into its context's lane file. The method, its table row and `runLane` stay.
  3. Move the deciders found along the way to L1.

  `FleetWatcher` keeps the tick, the schedule and one delegate per lane.
- **(b) Revisit, with per-context scheduler classes.** This reopens O4 (a). Not recommended.
- **Pins:** the tick-order and lane-census tests, `rings/watcher-store-port.test.ts`, each lane's suites.
- **Operator:** confirm that (a) sits inside O4 (a) (Q3).

**`server/src/coord/routes.ts`: kept as one file by ruling 12.**
- **Today:** `registerCoordRoutes` runs from `:575` to `:4898`. Its largest handler is `POST /api/mail` (`:767`, 365
  lines). Ruling 12 (D-8066) keeps existing routes in this file and lets a new group of routes have a file of its own.
- **(a) Keep it, with a narrower change (recommended).** Every route stays registered here, so
  `coord-pause-route.test.ts` still reads them all. Handler decisions move to L1 deciders (the `openRun` and
  `decideDispatch` pattern), and outcome mappers move to a delivery helper. That should roughly halve the file
  (inferred). Then the cap applies.
- **(b) Revisit, with per-group files.** `/api/coord` (24 routes) and `/api/runs` (15) would register from
  `registerCoordRoutes` and join `box-token-census.test.ts`, as `ledgersRoutes.ts` does. 67 test files name this file.
- **Recommendation:** do (a), measure, and ask for (b) only if the file is still over the ceiling. **Operator** (Q4).

**`server/src/server.ts`.**
- **Today:** no ruling covers it. `buildServer` (`:368` to `:4388`) holds 12 auth routes (from `:679`) and 37 session
  routes (`:2433` to `:4347`) inline, beside 14 `register*Routes` calls, which are the precedent.
- **Target:** auth routes to `auth/routes.ts` (C8); session routes to `sessionRoutes.ts` (C3, a new file row); pools and
  accounts to C1; notify and push to C6. `server.ts` keeps composition, the socket upgrades and `/health`.
- **Pin:** the `app.printRoutes()` table (method, path and gate), and the auth-gate and box-token censuses.

**`server/src/coord/delegation-checkpoint.ts`: the pilot.**
- **Today:** the pure codec, builder and recovery sit above the `:1739` banner (L1). `DelegationDurability` (`:2163`)
  and the SQLite projection sit below it (L3).
- **Target:** `delegation-checkpoint.ts` and `delegation-recovery.ts` (L1); `delegation-durability.ts` and
  `delegation-projection.ts` (L3).
- **Why it is the pilot:** every slice is a pure move of top-level declarations.
- **Risk:** the coordination scanner reads the words this file spells (`:3229`), so that block moves with them.
- **Coordinate with** the delegation-broker programme.

**`ccd/history/lib.mjs`, `sweep.mjs` and `deploy/history-replay.mjs`.**
- **Today:** the open ccrc-history programme owns them (W3, W4); `lib.mjs` has a slot held for a redaction PR.
- **`lib.mjs` target:** modules under `ccd/history/lib/`, with `lib.mjs` kept as an `export *` barrel so no importer
  changes. One module per subject: vocabulary (`:34`); paths and ids (`:443`, `:885`); spool and journal (`:1055`,
  `:1166`); health (`:4399`); the headless seam (`:4968`); the as-of cut (`:5349`); the read verbs (`:8776` to `:10056`);
  doctor repair (`:10159`); steer (`:10410`). The hand-written `lib.d.mts` (1,404 lines) splits the same way, and the
  namespace pin covers both.
- **`sweep.mjs`:** split by pass phase, after `lib.mjs`.
- **`history-replay.mjs`:** untouched since 2026-10-27, and its replay is "not run, not scheduled". Cap it and leave it
  (Q6).
- **Gate:** the history programme's coordinator, or that programme's close.

**`shared/api.ts`: kept whole by the Rejected list.**
- **Grounds:** it is the ubiquitous language; three processes on independent deploy cadences parse it; scanners read it
  whole. Today 99 test files read it as text, and 464 source files import it.
- **(a) Keep it, with a narrower change (recommended).** Cap it now. New vocabulary goes on going to one-concern siblings
  (consolidation §2.5; `shared/` holds 100 files). It stays a named exception to the ceiling.
- **(b) Revisit narrowly.** Move concern blocks that already have a sibling module, and re-export them so no import
  changes (`export type { NodeRole }`, `:10499`, is the precedent). Candidates: accounts (`:13627` onward), approvals
  (`:13220`), the digest, stall-watch settings and the test box. This needs a `sharedSource()` program view first, for
  the 99 text readers.
- **Order:** it is the hottest file (79 commits in 14 days), so either option runs last. **Operator** (Q5).

**`pwa/src/fleet/fleet.css` and `deploy/account-op.mjs`.** Caps only. `fleet.css` may later move to per-component
stylesheets (precedent: `programmeBox.css`), pinned by screenshots at 390, 1280 and 1920.

## 4. Sequence, parallelism, caps

| # | File | Gate | Why here |
|---|---|---|---|
| 0 | caps, `file-split.mjs` and its pin | #2750 (D-8563) merged | everything below uses them |
| 1 | `ccd/ccd` | its Task 0 | D-8048, unchanged |
| 2 | `delegation-checkpoint.ts` | none | pilot: pure moves, cold, clear rings |
| 3 | `server.ts` | none | no ruling, a precedent, hot |
| 4 | `store.ts` | after 2 (C5) | step 6's deciders need its modules |
| 5 | `watch.ts` | Q3 | `DelegationLane` first |
| 6 | `routes.ts` | after 4; Q4 | drains into the deciders |
| 7 | `ccd/ccrc`, then the doctor | Phase B; Q7 | one loader |
| 8 | `session-hook.sh` | ccd Task 5; session-continuity | reuses the assembler |
| 9 | `lib.mjs`, then `sweep.mjs` | the history programme | owned elsewhere |
| 10 | `shared/api.ts` | Q5 | most readers, hottest |

**Parallelism.** One file per context at a time, so C5's files (2, 4, 6) run in sequence, as do K's (3, 5); one move
PR per file; a slice yields to features (`preflight`). At most three files are in flight: one bash, one C5, one K.
In-flight programmes keep their files until they close or hand over a slot: session-continuity and the Overlord
programme (`ccd/ccd`, the hook, `api.ts`), ccrc-history (the history files), the delegation broker
(`delegation-checkpoint.ts`).

**From budgets to caps.** #2750 lists every file over 3,000 lines at the 40-line per-PR limit. Step 0 adds the caps on
top:
- **Storage:** `server/test/growth-caps/`, one JSON file per capped file (`{file, cap, d, since}`), so two PRs never
  edit one line (the reason `growth-check.test.ts` keeps "no per-file absolute constant" today).
- **Rule:** code lines at HEAD at or under the cap; the cap at HEAD at or under the merge-base's; a capped file drops
  the per-PR limit and its waivers; the operator's named exemption may raise a cap once.
- **Each file moves from listed (40 per PR) to frozen (10, §2.6) to capped.** New modules take the ceiling plus the
  per-PR limit; one that reaches the ceiling splits by sub-domain in a pure-move PR.
- **Files between 1,500 code lines and 3,000 lines** (`collectLane.ts`, `coord/stall.ts`, `ccd/ccrc-testbox-admin`, and
  others) take caps at today's size in step 0, so the next god file cannot form.

**Operator acts in the console.** Starting a file and granting an exemption are operator acts. Each one is raised as an
item in the programme's ledger, so it appears under "Waiting on you" with its own control. The coordinator writes the
cap or exemption file after the tap.

## 5. Questions for the operator, recommendation first

1. **Ceiling:** 2,500 code lines per module; or 1,500, which brings seven more files into scope.
2. **Caps:** an absolute cap per finished file (measured plus 40, may only fall, one cap file each); or budgets only.
3. **FleetWatcher:** is §3's option (a) inside O4 (a)? Recommended: yes.
4. **`coord/routes.ts`:** keep ruling 12 and drain decisions to L1; or per-group files.
5. **`shared/api.ts`:** keep it whole and cap it now; or move concern blocks to siblings with re-exports.
6. **`history-replay.mjs`:** cap only; or retire it; or refactor it.
7. **Order:** §4's, with `delegation-checkpoint.ts` as the pilot.
8. **Freeze:** 10 lines per PR during a file's refactor, no waivers, the named exemption as the only door.
9. **Hook and doctor:** assembled at install like ccd, decided with Q7 at the Phase D gate.
10. **Starts and exemptions:** ledger items with a console control; or a hand-edited JSON door.

## Known limits

- The `store.ts` façade size, the share of `routes.ts` that draining removes, and the code lines of ccd libraries are
  inferred, not measured.
- Method lengths run from one method header to the next, so a method's figure includes the comments after it.
- `fleet.css` has no code-line measure: the growth check's bash stripper counts CSS lines as code.

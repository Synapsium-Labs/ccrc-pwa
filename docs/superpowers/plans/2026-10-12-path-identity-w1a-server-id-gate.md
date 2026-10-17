# Path identity W1a: the server's id gate Implementation Plan

> **For agentic workers:** this plan is dispatched as a wave to a `ccrc-worker` session; follow the `ccrc-worker` skill for the protocol (ack, claims, asks, wave-done). To execute the tasks, REQUIRED SUB-SKILL: superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`) syntax for tracking.

**Programme:** path-identity, **wave 1 of 4 (spec name W1a)**, run 399. **Deploy class: server.** This wave touches the server and the shared L0 file only. It makes no ccd, agent or PWA edit. It closes the server's half of spec §2. ccd's half (its loops and predicates) is W1b, which waits for workspace-lifecycle wave 6 (#351).

**Goal:** no id that ccd could read as a flag ever reaches an id-taking argv the server composes. After this wave:
- **One L0 predicate decides a registry id.** `isRegistryId` accepts a string of at most 255 characters with the session-id shape and no leading `-` or `.`. The collector's `isTmpRootId` derives from it, so the accepted set is unchanged and the rule is written once.
- **The registry readers can tell a refused id from an absent one.**
  - `readSessionRecord` answers `bad-id` before any listing. Every caller that acts on absence treats `bad-id` as unmeasured, never as absent.
  - `readRegistryMeasured` names its refused rows. It never reads or builds them, and it logs each one once.
  - Every reader call site is classified: the 22 consumer sites (the 19 at `837a099c0`, plus the three reads Task 7 adds), plus `readRegistry`'s own wrapper call. A census pins the classification.
- **Every request id is checked before it reaches an argv:** `knownId`'s 18 routes, `/ensure`, the cross-pool swap, `/stop`, `/swap`, `/kickoff`, `POST /api/runs` and the reclaim door.
- **Every stored run row is re-checked where it enters an id-taking flow:**
  - dispatch;
  - close: non-abandon closes refuse, and an abandon closes the run `failed` with no fleet act;
  - advance, the routing door, and the reclaim door's stored claimant;
  - expiry's executor boundary refuses before either builder, and the collector's existing gates are pinned.
- **`stop` sends `--surface` before the id.** An id spelled `--surface` can then no longer turn into a stop of `pwa`. A legacy row whose wrapper or project part is not a registry id is refused before its stop is composed.
- **One stray file cannot wedge the fleet.** A refused `.uuid` leaves dispatch, the snapshot, mail, peers, projects and the fleet route each giving an honest answer.
- **A structural census pins all 41 id-taking calls** by file, builder, origin and gate. A new call must be classified, or the suite goes red.

**Architecture, by ring:**
1. **L0, `shared/api.ts` (Task 1).** `REGISTRY_ID_MAX_CHARS` and `isRegistryId` are inserted into the foot block. `TMPROOT_ID_MAX_CHARS` becomes an alias of the new cap, and `isTmpRootId` derives from `isRegistryId`.
2. **L1.** No new policy file. `abandonMove` (`coord/close.ts`) stays the single spelling of the abandon move.
3. **L2.** No new port. `SingleRead` and `RegistryRead` stay the registry adapter's consumer-facing results, declared in `server/src/registry.ts` as today.
4. **L3 adapters:**
   - `registry.ts` (Tasks 4, 5);
   - `fleet.ts`, `lifecycle.ts`, `commands.ts` (Tasks 4, 5, 7, 8);
   - `coord/close.ts`, `coord/dispatch.ts` (Tasks 3 to 6);
   - `coord/childBind.ts`, `coord/childReclaim.ts`, `coord/reclaim.ts` (Tasks 4, 9);
   - `coord/fingerprint.ts` (Task 6), `coord/expireArchived.ts` (Task 12), `ccdargv.ts` (Task 14).
5. **L4 delivery:**
   - `server.ts` routes (Tasks 2, 4, 7, 14);
   - `coord/routes.ts` (Tasks 3, 4, 7, 9 to 11);
   - `watch.ts` (Tasks 5, 6, 8);
   - `sessionws.ts` (Task 4).

Each gate decides with the L0 predicate. L4 only places the gate and maps its answer.

**Tech Stack:**
- TypeScript (server and shared), vitest 4, Fastify 5;
- `node:sqlite` CoordStore: existing reads and writes only, with no migration;
- Node ≥ 22.16.0;
- the real `ccd` binary, sourced in a fixture HOME, in Task 14's one new file only.

**Spec:** `docs/superpowers/specs/2026-10-12-path-identity-design.md`: §2.1, §2.2, §2.3, §2.7 (SEC2 B, SEC8 A), §2.8 (the server rows), §7 (items 22 and 23) and §8. Task 16 does not edit the spec. It records the corrections in this plan's as-built note (R7, R3).

**Contract:** `docs/superpowers/programs/child-reclamation-contract.md`. **§17 BINDS this plan and amends §1 to §16.**
- R93 places this wave: W1a, run 399, its own programme, continuing that contract.
- R98 widens R90's SECURITY carry, by SEC2 B, to the registry readers, `knownId`, `POST /api/runs`, every stored-row argv seam and the two executor seams. It also says every plan locates code by content.
- §17's other rulings bind other waves.

**Pre-dispatch condition.** Neither §17 nor the programme ledger is on `main` at `837a099c0`. The coordinator's ledger and contract PR must merge before this wave is dispatched. Until then, Task 0's (a2) STOPs with `contract-17-not-on-main`.

The coordinator's rulings, folded in below, win over any task text they name.

**Programme ledger:** `docs/superpowers/programs/path-identity.md`.

**HARD BOUNDARY.** This wave edits only these files:
- `shared/api.ts`: inside the foot block only (wave 9's collector block, which begins `/* ── child-workspace reclamation: the temp-root collector's server lane`). Nothing above that block changes.
- In `server/src/`: `server.ts`, `registry.ts`, `fleet.ts`, `sessionws.ts`, `commands.ts`, `lifecycle.ts`, `watch.ts` and `ccdargv.ts`.
- In `server/src/coord/`: `routes.ts`, `close.ts`, `dispatch.ts`, `reclaim.ts`, `childBind.ts`, `childReclaim.ts`, `fingerprint.ts` and `expireArchived.ts`.
- `server/test/**`: new files, and the existing files each task names.
- `README.md`: the two `stop` prose lines, and only if #351 had merged when Task 0 ran (R14).
- This plan file: Task 16's as-built section only.

**It never edits:**
- anything under `ccd/` (skills and their `references/` included), `agent/`, `pwa/` or `deploy/`;
- `CLAUDE.md`, the spec, the contract, or the programme ledger (the coordinator's);
- in `server/src/coord/`: `store.ts` (R1's alias exists to avoid it), `schema.ts`, `endDeadCoordinator.ts`, `archiveDoor.ts`, `childSpent.ts` and `collectTempRoot.ts`;
- in `server/src/`: `archivedExpiry.ts`, `deadCoordinator.ts`, `collectLane.ts` and `childReclaimSweep.ts`.

**What it adds and never adds:**
- It adds no route, no table, no migration, no ccd verb, no capability token, no agent grant, no L0 wire type and no new refusal word.
- It reuses existing words: `bad-session`, `bad-session-id`, `bad-request`, `unknown-session`, `registry-unmeasurable`, `composition`, `unreadable`, `child-unmeasurable` and `marker-unreadable`.
- It adds three additive, absence-permitting response fields: `/api/projects`'s `registry`, `/api/peers`'s `refusedRows`, and a `stale: true` arm on `GET /api/fleet`.
- A step that seems to need anything else STOPS: name it by slug in the wave-done, and build nothing.

---

## Global Constraints

Each line binds every task.

- **Fakes and fixture HOMEs only.**
  - No test reaches a live fleet. Never run `ccd` against the live `$HOME`. Never run a destructive verb. Never touch tmux, `~/.cc-sessions`, `~/.cc-limits` or `claude-session@*.service`. Task 0's ls-only counts are the one read of a live registry, and they print counts only.
  - A dash-named row is a plain file under a fixture HOME's registry (`path.join(reg, '--actor.uuid')`).
- **Rings:**
  - L0 `shared/api.ts` imports nothing.
  - L3 adapters never narrow a distinction they received.
  - L4 places gates and maps answers; it never decides.
  - No overloaded null at a seam.
  - coord.db stays synchronous; never wrap it in async.
- **Wire:** additive only, absence permits, ONE reader per field, no `FLEET_PROTO` bump, and no new L0 wire type.
- **Single definition:** the predicate and its cap have one definer each (Task 1). No server line re-derives the predicate from `isSessionIdShape` and a `startsWith` (`single-definition.test.ts`'s per-line `REDERIVED` scan, and Task 1's whole-text scan, which also sees a re-derivation split across lines). Every gate imports `isRegistryId` from L0 (Task 15).
- **Census sentences stay intact.** `registry.test.ts`'s `taggedRegistryCensusClaims` parses every `[registry-read-census:*]` sentence in `server/src` comments. Examples are the `knownId` comment's "745 agent-WS operations [registry-read-census:fleet]" and "31 [registry-read-census:fields]". Keep each number and its tag, and keep them within 40 characters of each other.
  - Any task that rewrites a comment holding one of these sentences runs `registry`.
- **Guard placement.** Guards sit at the entry of a function or a switch arm, never on a call-site line, because `unattended-actor.test.ts` pins call sites by their surrounding text.
  - Never wrap a single-line signature. `verb-gate.test.ts` reads an enclosing scope through one; `verifyDone`'s signature is an example.
  - Every task that edits `watch.ts`, `coord/close.ts`, `coord/dispatch.ts`, `coord/routes.ts` or `coord/childReclaim.ts` runs `unattended-actor` and `verb-gate`.
- **Mutation-table discipline:**
  - Every guard ships with a case that goes red when the guard is deleted or mutated, measured before and after and recorded in the SDD ledger.
  - A fold row on an exhaustive switch is measured against an UNLISTED bad id (R15).
  - An arm masked by an outer gate answers the safe word, and its comment names the mask. It gets no second pin (R17).
- **Run vitest in the foreground, from `server/`:** `./node_modules/.bin/vitest run test/<file>`, with a timeout of at least 600000 ms. Never bare `npx vitest`.
  - Run every command line written `cd server && …` as `(cd server && …)`, in a subshell. The worker's shell keeps its working directory between calls, so a bare `cd server` makes the next `cd server` line fail and runs the next root-relative command (`grep … server/src`, `git add server/…`) from the wrong directory. A mutation table's `S` or "from `server/`" command runs the same way.
  - Re-run a CLAUDE.md load flake in isolation before calling it a break.
  - New cases go in NEW files (the precedent of the CCR-15 waves). Edit an existing file only where a task names it: a literal shape, a pin of the old order, or a test the new gate breaks.
- **Modules.** An isolated worktree installs server modules only. Run `npm ci` in `pwa/` or `agent/` before any command there.
- **`shared/api.ts`:**
  - Edits stay inside the foot block, below every line that README and the compaction-card corpus cite. The highest cited line is README's `:7951`; the block starts at `:9679`.
  - After Task 1, run session-hook's citation cases: `-t 'every line citation is anchored|CITATION DEBT|README HAS ITS OWN CENSUS|THE RANGE BOUND'`.
  - `single-definition.test.ts` is cited by line, so append to it only after its last line.
- **No `D-` token anywhere, and no number range.** Name a departure by kebab-case slug; the coordinator assigns its number. Existing deviation references in source comments stay, untouched.
- **Branch discipline:** one commit per task, on this workspace's own branch. Absorb `main` only with `git merge`. Every commit compiles and leaves every suite it touches green.
- **Citations:** code comments and test titles cite the SPEC (`spec §2.3`), never the contract.
- **Locate code by CONTENT.** Line numbers are hints at `837a099c0`. #351 and run 400 move some of them when they land.
- **Overlaps (R16, R30):**
  - Open PR #351 (workspace-lifecycle wave 6) changes `server/src/watch.ts` (+142), `server/src/coord/expireArchived.ts` (+35) and `server/src/coord/store.ts` (+72).
  - Run 400 (child-reclamation wave 10, the collector settings switch) ships in parallel. It touches:
    - L0 names at the foot of `shared/api.ts`;
    - `watch.ts` (an accessor and its warn latches);
    - a route registered in `coord/routes.ts`;
    - `collectLane.ts` and `collectTempRoot.ts`;
    - the census suites, including `single-definition.test.ts`'s foot and `mail-routes.test.ts`'s kebab census.
  - This wave edits `watch.ts`, `expireArchived.ts`, `coord/routes.ts`, the `shared/api.ts` foot block, `single-definition.test.ts`'s foot and `mail-routes.test.ts`'s `NOT_CODES` in narrow regions. It never edits `store.ts`, `collectLane.ts` or `collectTempRoot.ts`.
  - Whichever wave lands second merges `main` and re-points by content.
  - A live claim on a path this wave edits STOPS the task unless the brief records the coordinator's agreement.
- **Commands are approval-free:** plain reads, git, grep, node and vitest.
  - No `bash -c` with `eval`, and no `pkill`/`killall`. Kill only recorded PIDs.
  - A subagent's permission prompt blocks the whole pane and its mail.
  - Subagents never send mail and never invoke a ccrc skill.
- **Public repository:** no host name, no absolute home path, and no private project, account or lane name, in code, tests, commits or the PR. Use `<projects-root>`, "the fleet box", `demo` and similar stand-ins.

## Rulings that amend the task text (binding; the coordinator, 2026-10-12)

These are the coordinator's W1a rulings on the two grounding reports (`1A-R1` to `1A-R16`), renumbered here R1 to R16. R17 to R30 were **proposed by the frame** to settle points where the reports disagreed or where order matters. The coordinator confirmed them on 2026-10-12, R17 with the one amendment written into it; they bind exactly as R1 to R16 do. The census word `wrapper` (Task 5) is confirmed, and Task 0's STOP on a bad stored id in a terminal run as well as an open one stands. A ruling wins over any task text it names.

- **R1 — Placement (1A-R1).**
  - `REGISTRY_ID_MAX_CHARS` (255) and `isRegistryId` go into `shared/api.ts`'s foot block, immediately above `TMPROOT_ID_MAX_CHARS` and `isTmpRootId`.
  - They do not go after `isSessionIdShape` (about `:6231`). README cites `shared/api.ts:7878-7880` and `:7930`, `:7938`, `:7951`, and an insertion near `:6231` would move every one of them.
  - `isTmpRootId` stays a `function` declaration whose body is `return isRegistryId(id);`. This keeps single-definition's `DEF_FN`/`DEF_VAL` pins green.
  - `TMPROOT_ID_MAX_CHARS` becomes `= REGISTRY_ID_MAX_CHARS`, a derived alias. The full rename waits until after #351, because it touches `coord/store.ts`.
  - Departure slug: `registry-id-at-foot`.
- **R2 — The refused set (1A-R2).**
  - `RegistryRead.refused` holds IDS: the basename minus `.uuid`.
  - A refused row is never read, never built and never composed.
  - Each refused row is logged once, quoted by `JSON.stringify`, through a separate module-private `refusedLogged` set. On each listing, that set is pruned to the current refused set.
  - It never uses `warnState`'s keys: their prune splits on `#`, and a raw name may contain one.
- **R3 — The watches (1A-R3).**
  - For the main, hook-state and task-state watches, omission is the behaviour: a refused id gets no state, no reads and no acts. The census tags it `omits` and pins it.
  - There is no retention code. Refusal is a pure function of the id string, so no prior state can exist, and retaining it would be unobservable.
  - The as-built note corrects the spec's "retain prior state" sentence.
  - The snapshot shrink guard is fixed, so that a refused id cannot freeze snapshot writes.
- **R4 — Charset (1A-R4).**
  - The coordinator measured the fleet box: 0 of 87 rows fail `^[A-Za-z0-9._-]+$`, none is dash- or dot-leading, and none is over 255 characters (the longest is 31).
  - Task 0 re-measures with ls-only counts and STOPS on any non-zero count.
- **R5 — The reclaim door (1A-R5).**
  - A request `claimedBy` (the heir) that fails the predicate answers 400 `bad-session`.
  - A STORED `claimedBy` (the claimant being replaced) that fails it answers 409 `bad-session`, with a detail naming the abandon door. Nothing is re-pointed.
  - The door's ungated semantics are unchanged for every valid id. Measured: 0 such rows.
- **R6 — Abandon (1A-R6).**
  - Three paths close a run whose stored `sessionId` fails the predicate: the operator abandon, the archive door's programme end, and the dead-coordinator sweep.
  - Each closes it `failed`, with no fleet act, no child gate, `released:false` and one run event.
  - `abandonRefusal` mirrors this: it refuses nothing new for such a run, so the door ends such a programme whole.
  - Every non-abandon path, review closes included, refuses 409 `bad-session`.
- **R7 — The two ungated request routes (1A-R7).**
  - `POST /api/sessions/:id/ensure` and the `crossPool` arm of `POST /api/sessions/:id/swap` ask `isRegistryId(id)` first and answer 400 `bad-session-id`.
  - The `knownId` census stays at 18 (14 POST, 4 GET), so `routes.test.ts`'s claim pin is untouched.
  - The as-built note (Task 16) corrects the spec's §2.3 sentence about one choke point.
- **R8 — POST /api/runs (1A-R8).**
  - A `claimedBy` or `sessionId` that fails the predicate answers 400 `bad-session`, with a detail naming the field.
  - A work run's `project` that begins with `-` or `.` answers 400 `bad-request`, with a detail naming `project`.
  - The project check is a coordinator extension. It closes the server half of spec §2.2's ws-add row. Measured: 0 such rows.
- **R9 — Expiry (1A-R9).**
  - The executor's refusal is the existing `composition` outcome, with a detail saying that the server refused the id.
  - `learnExpiry` is guarded as well as `expireArchived`, so neither `wsExpireAudit` nor `wsExpire` is ever built for such an id.
- **R10 — Collector (1A-R10).** There is no source change. Mutation pins prove two things:
  - the population gate keeps a bad id from the learning audit;
  - the executor's step-1 `isTmpRootId` keeps it from both builders.
- **R11 — Advance (1A-R11).** The stored-row gate stands before `verifyDone` only, so a legacy row can still retreat to `working`.
- **R12 — Readers on an unlistable registry (1A-R12).**
  - `GET /api/fleet` serves the stale fleet with `stale: true`, and never an empty fleet that is not marked stale.
  - `/api/projects` gains an additive `registry: 'listed' | 'unlistable'`.
  - `/api/peers` gains an additive `refusedRows`, present only when it is greater than 0.
  - Dispatch's pre-spawn read refuses `registry-unmeasurable` on an unlistable registry; nothing has been spawned at that point.
- **R13 — Small placements (1A-R13).**
  - `releaseRetiredChildHold` answers `changed` for a bad id.
  - Error words: `/api/sessions/*` routes answer `bad-session-id`, and coordination routes answer `bad-session`.
  - A refused mail recipient is held as `registry-unmeasurable`. No `MailGate` member is added.
- **R14 — Stop builders (1A-R14).**
  - The builders become `['stop', '--surface', surface, id]` and `['stop', '--surface', surface, w, p]`.
  - Every pin of today's order is updated in the same commit.
  - README's stop prose rides along only if #351 had merged by Task 0. Otherwise it becomes a carried line.
- **R15 — Mutation rows on exhaustive switches (1A-R15).**
  - They read "fold `bad-id` into the `absent` arm" (`case 'absent': case 'bad-id':`). Deleting the arm instead would only be a compile error.
  - Each is measured against an UNLISTED bad id, where the two arms diverge.
  - `readSessionRecord` answers `bad-id` before any `readdir`. A zero-listing count pins this.
- **R16 — Overlaps (1A-R16).** #351 edits `expireArchived.ts` and `watch.ts`. The second lander merges main and re-points by content.
- **R17 — Order and masked arms (proposed by the frame; confirmed 2026-10-12).**
  - The request-route gate (Task 2) and the stored-row gates (Task 3) land BEFORE the reader widening (Task 4). Some reader arms are therefore masked from the moment they exist, and none of them is pinned twice:
    - `server.ts`'s `/archive` arm and `fleet.ts`'s `liveStatus` (behind `/interrupt`) are masked by `knownId`.
    - `readAsk` has two paths:
      - `/ask`, masked by `knownId`;
      - `POST /api/asks/:id/answer`, which hands a STORED `ask.childId` to `freshAskAt` before `answerAsk` reaches `readAsk`. There the mask is `freshAskAt`'s `bad-id` answer, which gives `UNMEASURED_ASK_AT` and then 409 `child-unmeasurable`. Task 4's ask case pins this path end to end.
    - `close.ts`'s `childGateAtClose` is masked by both close gates.
    - Dispatch's resume `childBindGate` is masked by the dispatch gate.
    - `POST /api/runs`'s `childBindGate` is masked by the open gate (Task 9).
  - Each masked arm answers the safe word. Its comment names its mask. It gets no pin of its own: its pins are the outer gate's and `readSessionRecord`'s zero-listing case.
  - `childBindGate`, `measureClaimant` and `reclaimChild` are exported, so they keep unit pins. `measureClaimant` is also reachable unmasked through the dead-coordinator lane.
  - This departs from spec §2.3, which asks for "a pin each" for every absence-acting caller, `close.ts`'s child gate included. Slug: `masked-arms-pinned-by-their-masks`.
  - **Amended by the coordinator on confirming (2026-10-12):** `close.ts`'s child gate at close is the exception. Spec §2.3 names all four absence-acting callers for a pin each, so `childGateAtClose` is exported (its docstring says it is exported for its pin, and nothing else calls it outside `close.ts`) and pinned directly with an unlisted bad id, with the mutation row "fold `bad-id` into `absent`". The other masked arms stand as proposed.
- **R18 — Dispatch's pre-spawn read moves with the post-spawn refusal (proposed by the frame; confirmed 2026-10-12).**
  - The post-spawn clause refuses a refused name that was absent BEFORE the spawn, so it needs the pre-spawn read's `refused` set.
  - Both therefore land in Task 6. Task 7 migrates only the other three callers.
  - Landed alone, the post-spawn clause would refuse every dispatch while any refused row stands.
- **R19 — The fleet fallback (proposed by the frame; confirmed 2026-10-12).**
  - Three production callers pass `records: undefined` today: `GET /api/fleet`, the ws cold start and the claims-conflict path. Each now calls `readRegistryMeasured` itself and passes the records.
  - `assembleFleet`'s own fallback reads `readRegistryMeasured` and uses `[]` when the registry cannot be listed.
    - Only tests reach it: 90 test calls omit the parameter.
    - It is tagged `tests-only`, and a census pins the six production calls' records argument.
  - The ws cold start reads the registry only when the watcher has no broadcast. On an unlistable registry it sends no `fleet` frame, and still sends its `runs` frame. The `fleet` frame has no stale marker, and this wave adds no L0 wire field.
  - Slugs: `fleet-fallback-is-tests-only`, `cold-start-skips-an-unmeasured-fleet`.
- **R20 — `bad-id` is a read result, not a code (proposed by the frame; confirmed 2026-10-12).** The kebab scan in `mail-routes.test.ts` reads every quoted kebab token in `server/src/coord`. `'bad-id'` joins its `NOT_CODES`, with a comment: it is `SingleRead`'s word, and no refusal or wire field ever carries it. Slug: `bad-id-is-not-a-code`.
- **R21 — The reclaim door's two gates (proposed by the frame; confirmed 2026-10-12).**
  - The heir is gated inside `reclaimRun`, by `readSessionRecord`'s `bad-id`. The route head does not get a copy that would mask it.
  - The stored claimant is gated inside `reclaimRun` immediately after `no-claimant`, before any read.
  - `ReclaimOutcome` gains ONE member: `{ ok: false; kind: 'bad-session'; which: 'heir' | 'claimant'; detail: string }`. Task 4 adds it with `which: 'heir'`, and Task 9 widens `which`.
- **R22 — Where the cross-pool check sits (proposed by the frame; confirmed 2026-10-12).**
  - It is the cross arm's first statement, ahead of the skew gate. It is not at the swap route's head, where it would mask the ordinary arm's `readSessionRecord` gate.
  - `/ensure`'s check is its route's first statement.
- **R23 — `/api/peers` (proposed by the frame; confirmed 2026-10-12).**
  - When `?of=` fails the predicate, the route answers 400 `bad-session` before any read, since a bad id never heals. Today it answers 502 forever.
  - The check runs on the trimmed value the route already uses for `selfId`.
  - Every 200 body carries `refusedRows` when it is greater than 0.
- **R24 — Skill docs are carried (proposed by the frame; confirmed 2026-10-12).** The coordinator skill's `references/wave-lifecycle.md` rows for `bad-session` (open, dispatch, close, advance, reclaim) live under `ccd/`, outside this boundary. They are a carried line for W1b, which edits `ccd/`. Slug: `wave-lifecycle-rows-carried`.
- **R25 — The reader census grows by task (proposed by the frame; confirmed 2026-10-12).**
  - Task 5 tags all 19 consumer sites `[registry-refused:unplaced]`, and tags `readRegistry`'s own call `wrapper`.
  - Tasks 6, 7 and 8 replace each `unplaced` tag with its placed word and pin the behaviour.
  - Task 8 pins zero `unplaced`. No commit ever carries a tag that claims behaviour not yet built.
- **R26 — fingerprint's own check stays (proposed by the frame; confirmed 2026-10-12).**
  - `verifyReviewDone` reads the WORK run's `sessionId`, which the review run's close gate does not check.
  - `resolveDoneBranch`'s `isRegistryId` check is therefore reachable through a review close. It is pinned there as well as directly.
- **R27 — Abandon's event (proposed by the frame; confirmed 2026-10-12).**
  - The event is ONE `run_events` row, `recordRunEvent(id, causedBy, 'fleet-act-omitted:bad-session')`, written only after the store's close succeeds.
  - Its colon keeps the kebab scan from reading it as a code.
- **R28 — Expiry's guard is step 0 (proposed by the frame; confirmed 2026-10-12).**
  - In `expireArchived` the check sits before the capability read. In `learnExpiry` it sits before that function's own capability read.
  - A pure check runs before any read.
- **R29 — Ids are checked as given (proposed by the frame; confirmed 2026-10-12).**
  - `POST /api/runs` checks `claimedBy`, `sessionId` and a work run's `project` untrimmed, which is how it stores them. A padded id now answers 400 where it used to be accepted.
  - The reclaim door keeps its existing trim, because it stores the trimmed heir.
  - Measured: 0 stored rows fail.
- **R30 — Run 400 overlaps (proposed by the frame; confirmed 2026-10-12).**
  - Run 400 (child-reclamation wave 10) runs in parallel and edits files this wave also edits:
    - the `shared/api.ts` foot block (its SW-R14 L0 names);
    - `watch.ts` (SW-R12, SW-R16);
    - `coord/routes.ts` (its route);
    - the `single-definition.test.ts` foot;
    - the `mail-routes.test.ts` kebab census.
  - It also edits `collectLane.ts` and `collectTempRoot.ts`, whose gates Task 13 pins.
  - The R16 rule applies: the second lander merges `main` and re-points by content. Task 0 measures its diff.
  - Task 17 re-measures the foot block's start against the then-current `main`.

## Review Focus (the five failure modes most likely to bite)

1. **A dash-leading, dot-leading or over-long id reaches an id-taking argv.** The id may be a request id, a stored `claimedBy` or `sessionId`, a registry basename, or an executor's job id. The expected behaviour is a refusal before `runCcd`, with the route's own word. Pinned by Tasks 2, 3, 4, 9 to 12 and 14, and by Task 15's census.
2. **An absence-acting caller treats a bad id as absent, and acts.** Four failures are at risk:
   - a dead claimant leads to a reclaim or an abandon;
   - the answer is `not-a-child`;
   - a bind answers `ok`;
   - the executor answers `gone` and cancels mail.

   The expected behaviour is unmeasured, and a hold. Pinned by Task 4's fold rows against an unlisted bad id.
3. **One stray refused `.uuid` wedges something fleet-wide.** The risks are:
   - every dispatch refused;
   - snapshot writes frozen;
   - mail parked `undeliverable`;
   - peers answering 502 forever;
   - an empty fleet served without a stale mark;
   - a log line every 2 s.

   The expected behaviour is that each reader answers honestly and logs once. Pinned by Tasks 5, 6 and 7.
4. **An operator's release valve loses its door.**
   - Abandon, programme end or the dead-coordinator sweep must not refuse a bad stored `sessionId`: each closes it `failed` with no fleet act.
   - A reclaim of a bad stored claimant must not answer 502 forever: it answers 409, naming the abandon door.

   Pinned by Tasks 3 and 9.
5. **stop's reorder regresses, or a new id-taking call ships unclassified.**
   - On the real binary, the old order turns an id of `--surface` into a stop of `pwa`, and the new order refuses it.
   - A 42nd call, or a new builder key, must classify itself or go red.

   Pinned by Task 14 (the real binary) and Task 15.

---

## File Structure

Every file this wave touches, taken from each task's **Files** block. That block stays the authority for what the task does there. Files a task merely runs are not listed.

| File | Task(s) |
|---|---|
| `shared/api.ts` | 1 (the foot block only) |
| `server/src/server.ts` | 2 (`knownId`, `/ensure`, the cross arm), 4 (`readAsk`, `/kickoff`, `/stop`, `/swap`, `/archive` switches), 5 (one tag), 7 (`/api/fleet`, ws cold start), 8 (tag word), 14 (`stopArgvFor`'s docstring and wrapper line, `stopPairWrapper`, `stopPairRefused`, and the `/stop` and `/archive` identity arms) |
| `server/src/registry.ts` | 4 (`SingleRead`, `readSessionRecord`, `freshAskAt`), 5 (`RegistryRead.refused`, the refused-name log, the wrapper's tag) |
| `server/src/fleet.ts` | 4 (`liveStatus`), 5 (tag), 7 (the fallback) |
| `server/src/sessionws.ts` | 4 |
| `server/src/commands.ts` | 5 (tag), 8 (tag word) |
| `server/src/lifecycle.ts` | 5 (tag), 7 (`listProjects`) |
| `server/src/watch.ts` | 5 (tags), 6 (snapshot guard, `sweepMail`, tag words), 8 (tag words) |
| `server/src/ccdargv.ts` | 14 |
| `server/src/coord/routes.ts` | 3 (`sendDispatchOutcome`, `sendCloseOutcome`), 4 (the reclaim switch), 5 (tags), 7 (peers, claims conflict), 8 (tag words), 9 (`POST /api/runs`, the reclaim switch's `which`), 10 (routing door), 11 (advance) |
| `server/src/coord/close.ts` | 3 (the gates, the abandon arm, `CloseOutcome` and its `released` docstring), 4 (`childGateAtClose`) |
| `server/src/coord/dispatch.ts` | 3 (the gate, `DispatchOutcome`), 5 (tags), 6 (the pre-spawn and post-spawn reads, the resume comment) |
| `server/src/coord/reclaim.ts` | 4 (`measureClaimant`, the heir, `ReclaimOutcome`), 9 (the stored claimant) |
| `server/src/coord/childBind.ts` | 4 |
| `server/src/coord/childReclaim.ts` | 4 |
| `server/src/coord/fingerprint.ts` | 5 (tag), 6 |
| `server/src/coord/expireArchived.ts` | 12 |
| `server/test/registryIdCases.ts` (new) | 1 |
| `server/test/registry-id-l0.test.ts` (new) | 1 |
| `server/test/single-definition.test.ts` | 1 (one describe appended) |
| `server/test/idGateFixture.ts` (new) | 2, 3 (`storedRun` added) |
| `server/test/knownid-registry-id.test.ts` (new) | 2 |
| `server/test/stored-row-id-gates.test.ts` (new) | 3 |
| `server/test/single-read-bad-id.test.ts` (new) | 4 |
| `server/test/registry.test.ts`, `coord-reclaim.test.ts`, `child-reclaim.test.ts`, `child-reclaim-spent.test.ts`, `child-reclaim-mark.test.ts` | 4 (`.found` literal shapes become `.kind`; any further file the compiler names) |
| `server/test/child-reclaim-generation.test.ts` | 4 (the close's text pin follows `read.kind === 'found'`; slug `generation-pin-follows-kind`) |
| `server/test/child-reclaim-generation.test.ts` | 4 (the one `read.found` text pin; slug `generation-pin-follows-kind`) |
| `server/test/mail-routes.test.ts` | 4 (`'bad-id'` joins `NOT_CODES`) |
| `server/test/registry-refused.test.ts` (new) | 5 |
| `server/test/registry-refused-census.test.ts` (new) | 5, 6, 7, 8 |
| `server/test/run-route-route.test.ts` | 5 (the `'bad worker'` case, seeded through the store), 9 (the `'bad claimant'` case, seeded through the store) |
| `server/test/registry-refused-callers.test.ts` (new) | 6 |
| `server/test/registry-migrated-callers.test.ts` (new) | 7 |
| `server/test/registry-retained-callers.test.ts` (new) | 8 |
| `server/test/run-open-registry-id.test.ts` (new) | 9 |
| `server/test/run-route-registry-id.test.ts` (new) | 10 |
| `server/test/advance-registry-id.test.ts` (new) | 11 |
| `server/test/expire-id-boundary.test.ts` (new) | 12 |
| `server/test/collect-id-pins.test.ts` (new) | 13 |
| `server/test/ccd-stop-argv-order.test.ts` (new) | 14 (the real-binary order cases, and the four pair-part route cases) |
| `server/test/whitelist-subset.test.ts` | 14 (`EXPECTED`'s two stop rows, two `isExecAllowed` literals) |
| `server/test/lifecycle.test.ts` | 14 (the six stop rows and two comments) |
| `server/test/fleetws.test.ts` | 7 (the case `reports unmeasurable for BOTH markers when the registry cannot be listed` loses its `fleet` expectation) |
| `server/test/fleet-health.test.ts` | 7 (two live-arm cases seed an empty registry directory; slug `fleet-health-fixtures-list-their-registry`) |
| `server/test/id-argv-census.test.ts` (new) | 15 |
| `README.md` | 16 (the stop prose, only if #351 merged before Task 0) |
| `docs/superpowers/plans/2026-10-12-path-identity-w1a-server-id-gate.md` | 16 (the as-built section) |

## Execution order and dependencies

The tasks run in order, Task 0 to Task 17. Each task is one commit on the workspace branch. Every commit compiles and leaves every suite it touches green.

| Task | Needs | Model routing | Why this place |
|---|---|---|---|
| 0 Entry conditions | — | `sonnet`, medium | Before any edit: the registry's charset (R4), the stored rows, #351's and run 400's state, and stop-surface's history |
| 1 L0 predicate | 0 | `opus`, high | Every later gate types against it |
| 2 Request-id routes | 1 | `opus`, high | Closes the console path first, and masks the reader arms behind `knownId` before they exist (R17) |
| 3 Stored-row gates: dispatch, close, abandon | 1, 2 | `opus`, xhigh | The destructive flows. Lands before the reader widening, so close's child gate and the resume bind are masked from birth (R17) |
| 4 `SingleRead.kind` and 14 callers | 1–3 | `opus`, xhigh | One commit, because the type change breaks compile. Every absence-acting caller holds |
| 5 `RegistryRead.refused` and the census | 4 | `opus`, high | Refused rows leave every reader at once. The census starts `unplaced` (R25) |
| 6 The seven measured callers, and the pre-spawn read | 5 | `opus`, xhigh | Each caller holds, refuses or omits, placed. The pre-spawn read moves with the post-spawn clause (R18) |
| 7 Three migrations | 5, 6 | `opus`, high | Fleet, projects and peers report what they could not measure (R12, R19) |
| 8 The eight retained callers | 2, 5, 7 | `sonnet`, high | Pins only, plus zero `unplaced` |
| 9 `POST /api/runs` and the reclaim door | 4 | `opus`, high | The request ingress and the stored claimant (R5, R8, R21) |
| 10 The routing door | 1, 2, 3, 9 | `sonnet`, high | One predicate swap and its pins |
| 11 The advance gate | 1, 6 | `sonnet`, high | Before `verifyDone`, so no rejection mail is sent to a bad id |
| 12 The expiry boundary | 1 | `sonnet`, high | Two guards in a file #351 shares |
| 13 Collector pins | 1 | `sonnet`, medium | No source change (R10) |
| 14 stop's builder order | 1, 2 | `opus`, high | The one positional redirect, pinned on the real binary, and the legacy pair's parts refused before composition (it uses Task 2's `isRegistryId` import in `server.ts` and Task 2's `appFor` rig) |
| 15 The id-argv census | 2–14 | `sonnet`, high | Measures the finished set of 41 calls |
| 16 Docs: as built | 1–15 | `sonnet`, high | The spec corrections, the carried lines and the README condition |
| 17 Whole-branch verification and the PR | 0–16 | `sonnet`, high | The wave-done's `suite:` line |

---

## Interfaces (canonical)

The names here are canonical, and every task uses them exactly. "Unchanged signature" means that only the body or the union changes.

**L0, `shared/api.ts`** (in the foot block, in this order, R1):
```ts
/** One file-name component (`$REG/<id>.uuid`); the session-id shape is ASCII, so a character is a byte. */
export const REGISTRY_ID_MAX_CHARS = 255;
/** THE ONE PREDICATE of a registry id (spec §2.3): length first, then the session-id shape, then no leading `.` or `-`. */
export function isRegistryId(id: unknown): id is string;
//   typeof id === 'string' && id.length <= REGISTRY_ID_MAX_CHARS && isSessionIdShape(id)
//     && !id.startsWith('.') && !id.startsWith('-')
export const TMPROOT_ID_MAX_CHARS = REGISTRY_ID_MAX_CHARS;   // CHANGED: a derived alias (R1)
export function isTmpRootId(id: unknown): id is string;      // CHANGED: body `return isRegistryId(id);`
```
It consumes `isSessionIdShape(s: string): boolean` (`shared/api.ts:6229`), unchanged.

**L3, `server/src/registry.ts`:**
```ts
export type SingleRead =                                  // CHANGED (Task 4): a `kind` discriminant, no boolean
  | { kind: 'found'; record: SessionRecord }
  | { kind: 'absent' }        // no `.uuid` listed, a dropped row, or a twice-observed retirement (the existing fold)
  | { kind: 'unlistable' }
  | { kind: 'bad-id' };       // isRegistryId(id) is false; answered before any readdir (R15)
export async function readSessionRecord(io: FleetIO, cfg: CcrcConfig, id: string): Promise<SingleRead>;  // unchanged signature
export type RegistryRead =                                // CHANGED (Task 5)
  | { listed: true; records: SessionRecord[]; names: readonly string[]; refused: ReadonlySet<string> }
  | { listed: false };
export async function readRegistryMeasured(io: FleetIO, cfg: CcrcConfig): Promise<RegistryRead>;   // unchanged signature
export async function readRegistry(io: FleetIO, cfg: CcrcConfig): Promise<SessionRecord[]>;        // unchanged
// module-private (Task 5, R2): const refusedLogged = new Set<string>(); function noteRefused(refused: ReadonlySet<string>): void
//   one console.warn per id while it stays listed:
//   `ccrc-server: registry lists ${JSON.stringify(`${id}.uuid`)}, which is not a registry id — it is never read and never composed`
```
`refused` holds ids (R2). For every listed id `x`, `refused.has(x)` holds exactly when `!isRegistryId(x)`. `names` keeps every raw name. `pruneWarnState` receives the valid ids only. No exported function named `read…` is added (`divergence-sweep.test.ts`'s derived reader list).

**L3, `server/src/coord/reclaim.ts`:**
```ts
export type ReclaimOutcome = /* …today's members… */
  | { ok: false; kind: 'bad-session'; which: 'heir' | 'claimant'; detail: string };   // Task 4: which 'heir'; Task 9 widens (R21)
```
`measureClaimant(deps, id, nowMs): Promise<ClaimantVerdict>` keeps its signature. On `bad-id` it answers `{ state: 'unmeasurable', why: 'the claimant id is not a registry id, so it is never measured or composed' }`.

**L3, `server/src/coord/dispatch.ts` and `server/src/coord/close.ts`:**
```ts
export type DispatchOutcome = /* …today's members… */ | { ok: false; kind: 'bad-session' };   // Task 3
export type CloseOutcome    = /* …today's members… */ | { ok: false; kind: 'bad-session' };   // Task 3
// closeRun's abandon arm, a stored sessionId failing isRegistryId (R6, R27): no siblings, no child gate, no argv;
// the sweep gate still runs; on the store's successful close, ONE
//   coord.recordRunEvent(id, causedBy, 'fleet-act-omitted:bad-session');
// and it answers, as a literal (never through handOffChildReclaim or NO_CHILD_GATE, whose 'not-a-child' nobody measured):
//   { ok: true, id, state: 'failed', released: false, childReclaim: 'not-queued', childReclaimWhy: 'marker-unreadable' }
```
- `abandonMove` and `abandonRefusal` keep their signatures and code. `abandonRefusal`'s docstring gains one sentence for R6.
- `childGateAtClose` becomes exported (Task 4, R17 as amended). Its signature is unchanged: `export async function childGateAtClose(deps: CloseRunDeps, run: RunRow, sessionId: string, siblings: OpenSiblingsResult, final: boolean, state: 'done' | 'failed', verifiedLine: CcdPrLine | null): Promise<ChildGate>`. `ChildGate` stays module-private, and the function's one caller outside `close.ts` is its pin.
- `CloseOutcome.released`'s docstring today lists four ways to get `false`. It gains a fifth: "5. an ABANDON of a run whose stored `sessionId` is not a registry id: NO fleet act, the same as (4), but the run HAD a session id."

**L3, `server/src/lifecycle.ts`** (Task 7):
```ts
export async function listProjects(io: FleetIO, cfg: CcrcConfig):
  Promise<{ roots: string[]; projects: ProjectRow[]; registry: 'listed' | 'unlistable' }>;   // CHANGED: `registry` added
```

**L3, `server/src/coord/expireArchived.ts`** (Task 12, R9, R28):
- `expireArchived` and `learnExpiry` keep their signatures.
- A module-private constant holds the refusal detail:
  - `const EXPIRE_ID_REFUSED = 'the server refused this session id: it is not a registry id, so no call was composed';`
- `expireArchived` answers `answer({ kind: 'composition', detail: EXPIRE_ID_REFUSED })`.
- `learnExpiry` answers `{ kind: 'unreadable', detail: EXPIRE_ID_REFUSED }`.

**L3, `server/src/ccdargv.ts`** (Task 14):
```ts
stopId:   (id: string, surface: StopSurface | null) => CcdArgv   // ['stop', id] | ['stop', '--surface', surface, id]
stopPair: (w: string, p: string, surface: StopSurface | null) => CcdArgv   // ['stop', w, p] | ['stop', '--surface', surface, w, p]
```

**L4, `server/src/server.ts`:** `knownId(id: string, names?: readonly string[] | null): Promise<boolean>` keeps its signature. Its first statement is `if (!isRegistryId(id)) return false;`, before the listing.

**L4, `server/src/server.ts`** (Task 14): two closures inside `buildServer`, declared directly above `stopArgvFor`, whose signature does not change:
```ts
function stopPairWrapper(id: string, rec: SessionRecord, identity: { wrapper: string }): string;    // the id's own prefix when the id ends in `-<project>`, else identity.wrapper (stopArgvFor's rule, moved)
function stopPairRefused(id: string, rec: SessionRecord, identity: { wrapper: string }): boolean;   // false for a workspace row; else !isRegistryId(stopPairWrapper(…)) || !isRegistryId(rec.project)
```
`/stop` and the archive door each ask `stopPairRefused` in their identity arm, as `identity === null || stopPairRefused(id, read.record, identity)`, and answer 503 `registry-unmeasurable` with no argv composed.

**The answers this wave adds (R13; every word already exists):**

| Where | Condition | Answer |
|---|---|---|
| `knownId`'s 18 routes | id fails `isRegistryId` | 404 `{ ok: false, error: 'unknown-session' }`, before any listing |
| `POST /api/sessions/:id/ensure` | id fails | 400 `{ ok: false, error: 'bad-session-id' }` |
| `POST /api/sessions/:id/swap`, `crossPool: true` | id fails | 400 `bad-session-id`, ahead of the skew gate (R22) |
| `/stop`, `/swap` (ordinary arm), `/kickoff` | `readSessionRecord` answers `bad-id` | 400 `bad-session-id` |
| `/archive` | masked by `knownId` (R17) | the arm answers 400 `bad-session-id` |
| `/stop`, `/archive`, a legacy row | its wrapper part or `.project` fails `isRegistryId` (`stopPairRefused`, Task 14) | 503 `{ ok: false, error: 'registry-unmeasurable' }` from the identity arm, with no argv composed; at `/archive`, before the turn read and the programme's end |
| `POST /api/asks/:id/answer` | stored `ask.childId` fails | 409 `{ ok: false, error: 'child-unmeasurable', detail }` (the existing answer, through `freshAskAt`'s `bad-id`, R17); no keys sent, the ask stays `held` |
| `POST /api/runs` | `claimedBy` or `sessionId` fails | 400 `{ ok: false, error: 'bad-session', detail: 'claimedBy is not a registry id' }`, or the same with `'sessionId …'` |
| `POST /api/runs` | a work `project` (as given) beginning `-` or `.` | 400 `{ ok: false, error: 'bad-request', detail: 'project must not begin with - or .' }` |
| `POST /api/runs/:id/reclaim` | the heir fails | 400 `{ ok: false, error: 'bad-session', detail }` (`which: 'heir'`) |
| `POST /api/runs/:id/reclaim` | the stored claimant fails | 409 `{ ok: false, error: 'bad-session', detail }` (`which: 'claimant'`), the detail naming `POST /api/runs/:id/abandon` |
| `POST /api/runs/:id/dispatch` (resume too) | stored `sessionId` fails | 409 `{ ok: false, error: 'bad-session' }` |
| `POST /api/runs/:id/close` (review runs too) | stored `sessionId` fails | 409 `{ ok: false, error: 'bad-session' }` |
| abandon, programme end, dead-coordinator sweep | stored `sessionId` fails | closed `failed`, `released: false`, `childReclaim: 'not-queued'`, `childReclaimWhy: 'marker-unreadable'`, no fleet act, one event (R6, R27) |
| `POST /api/runs/:id/advance` to `awaiting-review` or `merging` | stored `sessionId` fails | 409 `{ ok: false, reject: { code: 'bad-session' } }` |
| `POST /api/runs/:id/route` | stored `sid` fails | 409 `{ ok: false, error: 'bad-session' }` (the existing word, now from `isRegistryId`) |
| `GET /api/peers?of=` | trimmed `of` fails | 400 `{ ok: false, error: 'bad-session' }`, before any read (R23) |
| `GET /api/peers` (200) | refused rows exist | additive `refusedRows: number`, only when greater than 0 |
| `GET /api/projects` | always | additive `registry: 'listed' \| 'unlistable'` |
| `GET /api/fleet` | registry unlistable | `{ sessions: watcher?.currentFleet() ?? snapshot?.sessions ?? [], stale: true }` |
| the ws cold start (no watcher broadcast) | registry unlistable | no `fleet` frame; the `runs` frame is still sent (R19) |
| the mail sweep | recipient refused | held with gate `registry-unmeasurable`, never `rejectDelivery` |

**Test-side shared names:**

`server/test/registryIdCases.ts` (Task 1; data only):
```ts
export const REDIRECT_IDS: readonly string[];   // ['--actor', '--surface', '--reason', '--expect', '--session', '--', '-h', '-x']
export const REFUSED_IDS: readonly string[];    // REDIRECT_IDS, then '.hidden' and 'x'.repeat(256)
export const EDGE_ACCEPTED_IDS: readonly string[];   // ['a--actor', 'a.--actor', 'x'.repeat(255)]
```

`server/test/idGateFixture.ts` (Task 2; Task 3 adds `storedRun`):
```ts
export const ID_GATE_TOKEN: string;   // 'f'.repeat(64): the box token appFor builds every server with (send it as x-ccrc-mail-token)
export function seedRow(home: string, id: string, fields?: Record<string, string>): void;   // coord-abandon.test.ts's `seed` shape, any id
export function recorder(cfg?: { fail?: ReadonlySet<string> }): { run: Runner; calls: string[][] };
export function appFor(home: string, run: Runner, over?: Partial<Omit<Deps, 'cfg'>>): Promise<{ app: FastifyInstance; coord: CoordStore; cfg: CcrcConfig }>;
export function storedRun(coord: CoordStore, r: { state: RunState; sessionId: string | null; claimedBy: string; kind?: 'work' | 'review'; reviews?: number }): number;   // opens through the store, bypassing POST (the `wedged` precedent)
```

**The reader census vocabulary** (`registry-refused-census.test.ts`, test-only, R25):
- The tag form is `[registry-refused:<word>]`, written in a comment within the 3 lines above each `readRegistry(` or `readRegistryMeasured(` call.
- The word is one of `holds`, `refuses`, `gated`, `omits`, `stale`, `reports`, `tests-only`, `knownId`, `raw-name`, `wrapper` and `unplaced`.
- `wrapper` is reserved for `readRegistry`'s own `readRegistryMeasured(` call in `registry.ts`.

The final placement (Task 8) has 23 sites: the 22 consumer sites and the wrapper.

| Reader | Word | Sites |
|---|---|---|
| `readRegistry` | `knownId` | `sessionCommands` (`commands.ts`), `prTasks` (`server.ts`) |
| `readRegistry` | `omits` | `sweepNames`, `sweepPr` (`watch.ts`) |
| `readRegistry` | `tests-only` | `detectDialogs`'s fallback (`watch.ts`; `tick` passes `records`) |
| `readRegistry` | `raw-name` | `requireAttribution`, `POST /api/mail`, `POST /api/mail/:id/ack` (`coord/routes.ts`) |
| `readRegistryMeasured` | `wrapper` | `readRegistry` (`registry.ts`) |
| `readRegistryMeasured` | `holds` | `resolveDoneBranch` (`coord/fingerprint.ts`), `sweepMail` (`watch.ts`) |
| `readRegistryMeasured` | `refuses` | dispatch's pre-spawn and post-spawn reads |
| `readRegistryMeasured` | `gated` | dispatch's resume arm |
| `readRegistryMeasured` | `omits` | `tick`, `sweepTasks` (`watch.ts`) |
| `readRegistryMeasured` | `tests-only` | `sweepHookStates`'s own read (`watch.ts`; `tick` passes `records`), `assembleFleet`'s fallback (`fleet.ts`) |
| `readRegistryMeasured` | `stale` | `GET /api/fleet`, the ws cold start (`server.ts`) |
| `readRegistryMeasured` | `reports` | `listProjects`, `GET /api/peers`, the claims-conflict path |

No bash function changes: this wave makes no ccd edit.

---

---

### Task 0: Entry conditions

**Model routing:** `sonnet`, effort `medium`.

**Files:** none. This task writes nothing, not even a temporary file.

Measure from the workspace root, before Task 1. Record every answer in the SDD ledger. If a check does not print what it states, apply the STOP rules below. **STOP** means: report to the coordinator, by slug, and build nothing.

- [ ] **Step 1: The tree, and the texts that bind**

```bash
git fetch origin main
git merge-base --is-ancestor origin/main HEAD; echo "a0 rc=$?"     # (a0) rc=0; if 1, run `git merge origin/main` once (never a rebase), then re-measure
git merge-base --is-ancestor 837a099c0 origin/main; echo "a1 rc=$?" # (a1) rc=0: the path-identity spec (#360) is on main
grep -c '^## 17\. Rulings, 2026-10-12' docs/superpowers/programs/child-reclamation-contract.md   # (a2) 1: §17 binds
grep -c '^### 2\.3 The server gate (W1a)$' docs/superpowers/specs/2026-10-12-path-identity-design.md   # (a3) 1
grep -rn 'isRegistryId\|REGISTRY_ID_MAX_CHARS' shared server/src pwa/src agent/src | wc -l      # (a4) 0: nobody has declared it
```

- [ ] **Step 2: The registry's charset, on the fleet box (R4; ls-only, counts only, never a name)**

```bash
ls -Ab ~/.cc-sessions > /dev/null 2>&1; echo "b0 rc=$?"                                                     # (b0) rc=0: the registry was listed
ls -Ab ~/.cc-sessions 2>/dev/null | grep -c '\.uuid$'                                                       # (b1) > 0: the row count (87 at the coordinator's measure)
ls -Ab ~/.cc-sessions 2>/dev/null | grep '\.uuid$' | sed 's/\.uuid$//' | grep -cv '^[A-Za-z0-9._-]\+$'       # (b2) 0: every id has the shape (an empty id counts here)
ls -Ab ~/.cc-sessions 2>/dev/null | grep '\.uuid$' | grep -c '^[-.]'                                         # (b3) 0: none is dash- or dot-leading
ls -Ab ~/.cc-sessions 2>/dev/null | grep '\.uuid$' | sed 's/\.uuid$//' | awk 'length > 255' | wc -l          # (b4) 0
```

Why these flags:
- `-A`, not plain `ls`: plain `ls` hides exactly the dot-leading names that (b3) exists to count.
- `-b`: it prints a control byte, a newline included, as a backslash escape on the name's own line. Such a name then fails (b2)'s charset rather than splitting into two lines.

- [ ] **Step 3: The stored run rows (counts only, nothing written to disk)**

`GET /api/runs?closed=1` answers the open runs together with the 500 most recent terminal ones (`closedLimit`'s default), in ONE list. `ccrc-api` takes the query key with a value, so the call is `--closed 1`.

```bash
~/.local/bin/ccrc-api runs list --closed 1 2>/dev/null | node -e '
let s = "";
process.stdin.on("data", (d) => { s += d; }).on("end", () => {
  let b;
  try { b = JSON.parse(s); } catch { console.log("unparseable"); return; }
  const rows = Array.isArray(b) ? b : (b && Array.isArray(b.runs) ? b.runs : null);
  if (rows === null) { console.log("unparseable"); return; }
  const ok = (v) => typeof v === "string" && v.length <= 255 && /^[A-Za-z0-9._-]+$/.test(v) && !/^[-.]/.test(v);
  const terminal = new Set(["done", "failed"]);
  for (const [label, set] of [["non-terminal", rows.filter((r) => !terminal.has(r.state))],
                              ["terminal", rows.filter((r) => terminal.has(r.state))]]) {
    const bad = (k) => set.filter((r) => r[k] !== null && r[k] !== undefined && !ok(r[k])).length;
    const proj = set.filter((r) => typeof r.project === "string" && /^\s*[-.]/.test(r.project)).length;
    console.log(label, set.length, bad("claimedBy"), bad("sessionId"), proj);
  }
});'
echo "c0 rc=${PIPESTATUS[0]}"
# (c0) rc=0, then `non-terminal <n> 0 0 0` and `terminal <m> 0 0 0`, with n + m > 0
#      (30 open and 400 closed at the coordinator's measure)
```

If `ccrc-api` spells the closed listing differently, read its own `--help` and adapt. Print counts only. The parse prints `unparseable` and never echoes the input.

- [ ] **Step 4: The anchors this plan leans on (located by content)**

```bash
grep -n '^export const TMPROOT_ID_MAX_CHARS = 255;$\|^export function isTmpRootId(id: unknown): id is string {$' shared/api.ts   # (c1) two lines (9689, 9700)
grep -n "^/\* ── child-workspace reclamation: the temp-root collector's server lane" shared/api.ts   # (c2) one line (9679): R1's block
grep -n 'shared/api\.ts:[0-9]' README.md                                                       # (c3) one line (4956), naming :7878-7880, then :7930 :7938 :7951; all below (c2)
grep -rnE 'readSessionRecord\(' server/src --include=*.ts | grep -vE 'export async function|^\S+:[0-9]+:\s+(//|\*)' | wc -l   # (c4) 14
grep -rnE 'readRegistryMeasured\(' server/src --include=*.ts | grep -vc 'export async function'   # (c5) 8: seven callers and readRegistry's wrapper
grep -rnE '(await|\?\?|\() *readRegistry\(' server/src --include=*.ts | grep -vE '^\S+:[0-9]+:\s+(//|\*)' | wc -l   # (c6) 12
grep -c 'await knownId(' server/src/server.ts                                                  # (c7) 19: 18 gates and the revival probe
grep -c '`knownId` gates 18 request-id routes (14 POST, 4 GET' server/src/server.ts             # (c8) 1
grep -c "return runCcdOr502(reply, CCD_ARGV.ensure(id));" server/src/server.ts                  # (c9) 1: /ensure, ungated
grep -c "argv = CCD_ARGV.swapCross(id, body.wrapper);" server/src/server.ts                     # (c10) 1: the cross arm, ungated
grep -c "if (!isSessionIdShape(sid)) {" server/src/coord/routes.ts                               # (c11) 1: the routing door
grep -c "const hold = holdReasonVerdict(run.program, run.wave, run.waveOf, run.id);" server/src/coord/dispatch.ts   # (c12) 1
grep -c "if (run.kind === 'review') return closeReviewRun(" server/src/coord/close.ts            # (c13) 1
grep -c "if (to === 'awaiting-review' || to === 'merging') {" server/src/coord/routes.ts         # (c14) 1
grep -c "^export async function learnExpiry" server/src/coord/expireArchived.ts                 # (c15) 1
grep -c "argv(surface === null ? \['stop', id\] : \['stop', id, '--surface', surface\])" server/src/ccdargv.ts   # (c16) 1
grep -c "const allGenuinelyPurged = names !== null" server/src/watch.ts                          # (c17) 1
grep -c "const unmeasurable = rec !== undefined;" server/src/watch.ts                            # (c18) 1
grep -c "const fresh = await freshAskAt(deps.io, deps.cfg, ask.childId);" server/src/coord/routes.ts   # (c19) 1: the ask answer's stored-id path (R17)
grep -c "if (isTmpRootId(n)) witnessed.add(n); else refusedNames += 1;" server/src/collectLane.ts      # (c20) 1: the collector's population gate (Task 13)
```

- [ ] **Step 5: Overlaps (R16, R30)**

```bash
gh pr view 351 --json state -q .state                                                   # (d1) OPEN or MERGED; MERGED lets Task 16 carry README's stop prose (R14)
git fetch origin pull/351/head:refs/remotes/origin/pr-351                               # only while (d1) is OPEN
git diff --stat origin/main...origin/pr-351 -- server/src/watch.ts server/src/coord/expireArchived.ts server/src/coord/store.ts README.md   # (d2) record (+142, +35, +72 at planning)
git diff -U0 origin/main...origin/pr-351 -- server/src/watch.ts server/src/coord/expireArchived.ts | grep '^@@'   # (d3) record every hunk header
gh pr list --state all --json number,state,title -q '.[] | "\(.number) \(.state) \(.title)"' | grep -i 'collector' | grep -i 'wave 10\|settings'   # (d5) run 400's PR, or nothing if it is not yet open
```

While (d5) names an OPEN PR `<n>`:

```bash
git fetch origin pull/<n>/head:refs/remotes/origin/pr-run400
git diff --stat origin/main...origin/pr-run400 -- shared/api.ts server/src/watch.ts server/src/coord/routes.ts server/src/collectLane.ts server/src/coord/collectTempRoot.ts server/test/single-definition.test.ts server/test/mail-routes.test.ts   # (d6) record
```

If run 400's PR is not open yet, record `not-open` and re-run (d5) at Tasks 1, 5 and 13.

```bash
~/.local/bin/ccrc-api claims list --project ccrc-pwa 2>/dev/null | node -e '
const EDIT = ["shared/api.ts", "server/src/", "server/test/", "README.md", "docs/superpowers/plans/2026-10-12-path-identity-w1a-server-id-gate.md"];
let s = "";
process.stdin.on("data", (d) => { s += d; }).on("end", () => {
  let b;
  try { b = JSON.parse(s); } catch { console.log("unparseable"); return; }
  const claims = b && Array.isArray(b.claims) ? b.claims : null;
  if (claims === null) { console.log("unparseable"); return; }
  const norm = (p) => String(p).replace(/\/\*\*$/, "").replace(/\/$/, "");
  const hits = claims.filter((c) => Array.isArray(c.paths) && c.paths.some((p) => EDIT.some((e) => {
    const a = norm(p), x = norm(e);
    return a === x || a.startsWith(x + "/") || x.startsWith(a + "/") || a === "" ;
  })));
  console.log("overlapping", hits.length, "claim ids", hits.map((c) => c.id).join(",") || "none");
});'
# (d4) `overlapping 0`, or every claim id it lists is recorded in the brief with the coordinator's agreement
```

(d4) prints only a count and numeric claim ids, never a holder.

Map each (d3) and (d6) hunk, by content, to this wave's regions:
- in `watch.ts`: `tick`'s registry read and its snapshot guard, and `tick`'s `records` hand-off to `sweepHookStates` and `detectDialogs`; `sweepHookStates`; `sweepTasks`; `sweepMail`'s read and its recipient arm; and the read lines of `sweepNames`, `sweepPr` and `detectDialogs`;
- in `expireArchived.ts`: `expireArchived`'s head and `learnExpiry`;
- in `shared/api.ts`: the foot block's head, where R1 inserts;
- in `coord/routes.ts`: `POST /api/runs`, the reclaim switch, the routing door, advance, peers, the claims-conflict path and the mail ingress reads;
- in `collectLane.ts` and `collectTempRoot.ts`: (c20)'s population gate and the executor's step 1, which Task 13 pins.

Record any overlap. An overlap is not a STOP (R16, R30).

- [ ] **Step 6: stop-surface shipped with an any-position loop (Task 14's premise)**

```bash
git log --format=%h -S'echo stop-surface' -- ccd/ccd | tail -1                          # (e1) the commit that first advertised stop-surface
git show <e1>:ccd/ccd | awk '/^cmd_stop\(\)/,/^}/' | grep -c -- '--surface)'            # (e2) ≥ 1: that ccd's cmd_stop already stripped --surface inside its argument loop
```

**STOP rules:**
- **(a0) to (a3) not as stated.** The tree is not ready: `tree-not-ready`. (a2) at 0 means the coordinator's ledger PR carrying §17 has not merged: `contract-17-not-on-main`.
- **(a4) non-zero.** Another wave declared the predicate: `registry-id-owned-elsewhere`.
- **(b0) non-zero, or (b1) 0.** The registry could not be measured, and every count would read 0: `registry-unmeasured`.
- **(b2), (b3) or (b4) non-zero (R4).** Such a row would vanish from the fleet after this wave: `registry-rows-fail-the-predicate`. Report the counts only.
- **(c0)'s rc non-zero, `unparseable`, or 0 rows in all.** The stored rows were not measured: `stored-rows-unmeasured`.
- **(c0) non-zero in any of its last three columns, on either line.** Those runs would meet R5's, R6's or R8's refusals live: `stored-rows-fail-the-predicate`. Report the counts only.
- **(c1) to (c20) different.**
  - A different count or line number is not a departure: re-point by content and record it.
  - A gate site that is GONE (a count of 0 where 1 is stated) is a STOP: `gate-site-moved`.
- **(d4) a live claim** on a path this wave edits, with no recorded agreement: `claim-overlap`.
- **(e2) is 0.** On an older ccd that advertises stop-surface, the reorder would be unsafe: `stop-surface-loop-postdates-token`.

---

---

### Task 1: L0 — `isRegistryId`, `REGISTRY_ID_MAX_CHARS`, and `isTmpRootId` derived from them

**Model routing:** `opus`, effort `high`. This is a SAFETY task. The leading-`-` clause is the server's whole answer to spec §2.1: ccd's verbs read their decision flags from any position, so an id spelled like a flag makes the verb bind some other token as the id. Every red, count and green below was predicted at planning on the read-only export of `837a099c0`. None was measured, so measure each one. A different count is not a departure. A different *kind* of failure is: report it by slug.

**Why:**
- **R1, placement.** The pair goes into `shared/api.ts`'s foot block, the collector's block that begins `/* ── child-workspace reclamation: the temp-root collector's server lane`, directly above `TMPROOT_ID_MAX_CHARS`. Spec §2.3 puts it after `isSessionIdShape` (about `:6231`) instead. That spot is rejected because README cites this file at `:7878-7880`, `:7930`, `:7938` and `:7951`, and an insertion there would move all of them. Departure slug: `registry-id-at-foot` (ruled).
- **Order inside the block.** The pair sits ABOVE the alias. `export const TMPROOT_ID_MAX_CHARS = REGISTRY_ID_MAX_CHARS;` evaluates its right-hand side when the module loads. Declared below the alias, the `const` would still be in its temporal dead zone, and loading `shared/api.ts` would throw a ReferenceError.
- **R1, derivation.**
  - `isTmpRootId` stays a `function` declaration whose body is `return isRegistryId(id);`. Wave 9's single-definition pins need this: `DEF_FN('isTmpRootId')` must find `['shared/api.ts']` and `DEF_VAL('isTmpRootId')` must find `[]`.
  - `TMPROOT_ID_MAX_CHARS` becomes a derived alias, so `coord/store.ts` (seven uses, and #351 adds +72 lines there) is not edited. The full rename waits until after #351.
  - The accepted set is unchanged. `collect-l0`, `collect-population` and `collect-attention` stay green with no edit.
- **This task pins only the predicate's answers.** The "refuse before any argv" halves are pinned where each gate is placed (Tasks 2 to 14). The census that every gate imports `isRegistryId` from L0 is Task 15's.

**Files:**
- Modify `shared/api.ts`, inside the foot block only. Replace the 20 lines from `/** The longest temp-root id (spec §5.10): 255 characters.` through `isTmpRootId`'s closing `}` (`:9684-9703` at `837a099c0`) with 38 lines: the new pair, the alias and the derived `isTmpRootId`. That is ONE region, and the file grows by 18 lines. Nothing above `/** The longest temp-root id` changes, and nothing below `isTmpRootId`'s `}` (`declare const collectTokenBrand: unique symbol;` onward) changes.
- Create `server/test/registryIdCases.ts` (data only).
- Create `server/test/registry-id-l0.test.ts`.
- Modify `server/test/single-definition.test.ts`: ONE describe appended after the file's last line (`});` closing `child reclamation wave 9: the collector’s lane and executor call the temp-root id predicate from L0`, or whatever run 400 has appended after it by then). No line above it changes.
- Nothing else. No server source, no README, no PWA or agent edit. Step 5 runs the PWA's and the agent's `tsc` to prove none is owed, because both compile `../shared`.

**Interfaces:**
- Consumes (at `837a099c0`):
  - `isSessionIdShape(s: string): boolean`, `shared/api.ts:6229` (`grep -n "^export function isSessionIdShape" shared/api.ts`), unchanged;
  - on the test side, `single-definition.test.ts`'s module-scope `ALL`, `rel`, `ccrcRoot` (`:63`, `:64`, `:32`), `stallCodeText` and `stallCode` (`:4094`, `:4096`, the comment-line filter wave 9's scans use), `readFileSync` and `path` (its imports).
- Produces, all in `shared/api.ts`'s foot block, L0, importing nothing, in this order:
  ```ts
  export const REGISTRY_ID_MAX_CHARS = 255;
  export function isRegistryId(id: unknown): id is string;
  //   typeof id === 'string' && id.length <= REGISTRY_ID_MAX_CHARS && isSessionIdShape(id)
  //     && !id.startsWith('.') && !id.startsWith('-')
  export const TMPROOT_ID_MAX_CHARS = REGISTRY_ID_MAX_CHARS;   // CHANGED: a derived alias
  export function isTmpRootId(id: unknown): id is string;      // CHANGED: body `return isRegistryId(id);`
  ```
- Produces, in `server/test/registryIdCases.ts` (data only; Tasks 2 to 14 import it):
  ```ts
  export const REDIRECT_IDS: readonly string[];        // ['--actor', '--surface', '--reason', '--expect', '--session', '--', '-h', '-x']
  export const REFUSED_IDS: readonly string[];         // REDIRECT_IDS, then '.hidden' and 'x'.repeat(256)
  export const EDGE_ACCEPTED_IDS: readonly string[];   // ['a--actor', 'a.--actor', 'x'.repeat(255)]
  ```

- [ ] **Step 1: Re-measure the anchors (read-only, from the workspace root)**

```bash
grep -n '^export const TMPROOT_ID_MAX_CHARS = 255;$\|^export function isTmpRootId(id: unknown): id is string {$' shared/api.ts   # (c1) two lines (9689, 9700)
grep -n "^/\* ── child-workspace reclamation: the temp-root collector's server lane" shared/api.ts                                # (c2) one line (9679)
grep -n '^/\*\* The longest temp-root id (spec §5.10): 255 characters\.$' shared/api.ts                                           # one line (9684): this task's first replaced line
grep -c "^  return typeof id === 'string' && id.length <= TMPROOT_ID_MAX_CHARS && isSessionIdShape(id)$" shared/api.ts           # 1: isTmpRootId's own body, which this task replaces
grep -n 'shared/api\.ts:[0-9]' README.md                                                                                           # (c3) one line (4956), naming :7878-7880, then :7930 :7938 :7951; all below (c2)
grep -rn 'isRegistryId\|REGISTRY_ID_MAX_CHARS' shared server/src pwa/src agent/src | wc -l                                        # (a4) 0
ls server/test/registryIdCases.ts server/test/registry-id-l0.test.ts 2>&1 | grep -c 'No such file'                                 # 2
wc -l shared/api.ts server/test/single-definition.test.ts                                                                          # 9755 and 5683; record both
gh pr list --state all --json number,state,title -q '.[] | "\(.number) \(.state) \(.title)"' | grep -i 'collector' | grep -i 'wave 10\|settings'   # (d5), only if Task 0 recorded not-open
```

STOP rules:
- **(a4) non-zero.** Another wave has declared the predicate. Report `registry-id-owned-elsewhere` and build nothing.
- **A README `shared/api.ts` anchor at or below (c2)'s line.** The insertion could move cited bytes. Report `readme-anchor-in-the-foot-block` and build nothing.
- **`isTmpRootId`'s body is no longer the five-clause body** (the fourth grep prints 0). Someone else has rewritten it. Report `gate-site-moved` and build nothing.
- **A different line number** is not a departure. Re-point by content and record the number. If (d5) shows run 400 open or merged and it added names to the foot block, record where they sit. This task inserts only between the line `/** The longest temp-root id` and `isTmpRootId`'s closing brace, whatever comes before or after them.

- [ ] **Step 2: Write the failing tests**

(a) Create `server/test/registryIdCases.ts`:

```ts
// Path identity W1a (spec §2.1, §2.3): the ids the W1a gate tests plant. Data only: no test runs here.
// - REDIRECT_IDS: each begins `-`, so ccd could read it as a flag (spec §2.1). `--surface` is the id that turns a stop
//   into a stop of `pwa`; `--actor`, `--reason` and `--expect` are read by the decision-flag loops.
// - REFUSED_IDS: the redirect ids, then a dot-leading id and an id one character past the cap.
// - EDGE_ACCEPTED_IDS: ids that look close to a refusal and are registry ids: dashes inside, a dot then dashes, and
//   exactly the cap.
// The caps are written as literals on purpose: a list derived from REGISTRY_ID_MAX_CHARS would move with a wrong cap.
export const REDIRECT_IDS: readonly string[] = ['--actor', '--surface', '--reason', '--expect', '--session', '--', '-h', '-x'];
export const REFUSED_IDS: readonly string[] = [...REDIRECT_IDS, '.hidden', 'x'.repeat(256)];
export const EDGE_ACCEPTED_IDS: readonly string[] = ['a--actor', 'a.--actor', 'x'.repeat(255)];
```

(b) Create `server/test/registry-id-l0.test.ts`:

```ts
// Path identity W1a (spec §2.1, §2.3): THE ONE PREDICATE of a registry id.
// - `isRegistryId` accepts a string of at most 255 characters with the session-id shape and no leading `-` or `.`.
// - The leading `-` is the server's whole answer to spec §2.1: ccd's verbs read their decision flags from any position,
//   so an id of `--actor` or `--surface` is read as a flag and another token is bound as the id.
// - The collector's `isTmpRootId` and `TMPROOT_ID_MAX_CHARS` derive from it, so the accepted set is unchanged. The
//   collector's own table (`collect-l0.test.ts`) is copied here row for row and asked of the new predicate.
// The type guard is a compile-time fact, so `typecheck-tests.test.ts` is half of this file. Each gate's
// "refused before any argv" half is pinned where that gate is placed, not here.
import { describe, it, expect } from 'vitest';
import { REGISTRY_ID_MAX_CHARS, TMPROOT_ID_MAX_CHARS, isRegistryId, isTmpRootId } from '../../shared/api.js';
import { EDGE_ACCEPTED_IDS, REDIRECT_IDS, REFUSED_IDS } from './registryIdCases.js';

/** `collect-l0.test.ts`'s 18 rows, copied: what the case is, the value, and the answer. */
const TABLE: readonly (readonly [string, unknown, boolean])[] = [
  ['an ordinary child id', 'demo-quiet-mesa', true],
  ['a nested id with dots', 'demo.quiet.mesa', true],
  ['dashes inside', 'a--actor', true],
  ['a dot, then dashes', 'a.--actor', true],
  ['exactly 255 characters', 'a'.repeat(255), true],
  ['256 characters', 'a'.repeat(256), false],
  ['a flag with its value (the shape refuses =)', '--actor=x', false],
  ['.', '.', false],
  ['..', '..', false],
  ['a dot-leading name', '.hidden', false],
  ['the empty string', '', false],
  ['a space', 'demo gone', false],
  ['a slash', 'x/../y', false],
  ['a trailing newline', 'demo\n', false],
  ['null', null, false],
  ['a number', 3, false],
  ['undefined', undefined, false],
  ['an object', {}, false],
];

describe('isRegistryId — the one predicate of a registry id (spec §2.3)', () => {
  it('its cap is 255 characters, hardcoded', () => {
    expect(REGISTRY_ID_MAX_CHARS).toBe(255);
    expect(TMPROOT_ID_MAX_CHARS).toBe(REGISTRY_ID_MAX_CHARS);
  });

  // ccd's verbs read their decision flags from any position, `--session`'s value included, and every such flag begins
  // `--`. An id that begins `-` could be read as one (spec §2.1).
  it.each(REDIRECT_IDS)('a dash-leading id %j is refused', (id) => {
    expect(isRegistryId(id)).toBe(false);
  });

  it.each(TABLE)('%s -> %s', (_what, id, ok) => {
    expect(isRegistryId(id)).toBe(ok);
  });

  it('narrows an unknown to a string', () => {
    const v: unknown = 'demo-quiet-mesa';
    expect(isRegistryId(v) ? v.length : -1).toBe(15);
  });

  it('isTmpRootId agrees with isRegistryId on every case', () => {
    const cases: unknown[] = [...TABLE.map(([, id]) => id), ...REFUSED_IDS, ...EDGE_ACCEPTED_IDS];
    const answers = new Set<boolean>();
    for (const id of cases) {
      expect(isTmpRootId(id), String(JSON.stringify(id))).toBe(isRegistryId(id));
      answers.add(isRegistryId(id));
    }
    expect([...answers].sort(), 'the union holds both answers, so the agreement is not vacuous').toEqual([false, true]);
  });

  // The later W1a gate tests plant these lists. A list that drifted from its name would make every one of those pins
  // vacuous, so the lists are asked here once.
  it('the shared case lists answer as their names say', () => {
    for (const id of REFUSED_IDS) expect(isRegistryId(id), JSON.stringify(id).slice(0, 40)).toBe(false);
    for (const id of EDGE_ACCEPTED_IDS) expect(isRegistryId(id), JSON.stringify(id).slice(0, 40)).toBe(true);
    expect(REFUSED_IDS.slice(0, REDIRECT_IDS.length)).toEqual(REDIRECT_IDS);
  });
});
```

(c) Append to `server/test/single-definition.test.ts`, after its last line (one blank line, then the block):

```ts

// PATH IDENTITY W1a (spec 2026-10-12 §2.3): the registry id predicate and its cap are ONE L0 function and ONE L0
// constant, and the collector's temp-root names derive from them, so the dash, dot and length clauses are written
// once. APPENDED after the last describe, for the reason the blocks above state: `session-hook.test.ts`'s citation
// audit cites this file by line. The wave 9 describe above still holds `isTmpRootId`'s one function definer and the
// store's use of `TMPROOT_ID_MAX_CHARS`. Its three pattern helpers are block-local there, and hoisting them would move
// this file's cited lines, so this block keeps its own copies under the same names.
describe('path identity W1a: the registry id predicate is defined once, and isTmpRootId derives from it', () => {
  const DEF_FN = (n: string): RegExp => new RegExp(`^\\s*(?:export\\s+)?function\\s+${n}\\b`, 'm');
  const DEF_VAL = (n: string): RegExp => new RegExp(`^\\s*(?:export\\s+)?(?:const|let|var)\\s+${n}\\b`, 'm');
  const definers = (re: RegExp): string[] => ALL.filter((f) => re.test(readFileSync(f, 'utf8'))).map(rel).sort();
  const API = (): string => readFileSync(path.join(ccrcRoot, 'shared/api.ts'), 'utf8');
  const TMP_DECL = 'export function isTmpRootId(id: unknown): id is string {';
  /** `isTmpRootId`'s body: from the end of its declaration line to the first bare closing brace, or null. */
  const tmpBody = (t: string): string | null => {
    const at = t.indexOf(TMP_DECL);
    if (at === -1) return null;
    const end = t.indexOf('\n}', at);
    return end === -1 ? null : t.slice(at + TMP_DECL.length, end);
  };
  /** The right-hand side of `TMPROOT_ID_MAX_CHARS`'s declaration, or null. */
  const aliasRhs = (t: string): string | null => /^export const TMPROOT_ID_MAX_CHARS = (.*)$/m.exec(t)?.[1] ?? null;

  it('CONTROL: the body slice sees a re-derived body and a derived one, and the alias reader sees a literal', () => {
    const old = `${TMP_DECL}\n  return typeof id === 'string' && id.length <= TMPROOT_ID_MAX_CHARS && isSessionIdShape(id)\n`
      + `    && !id.startsWith('.') && !id.startsWith('-');\n}\n`;
    expect(tmpBody(old)).toMatch(/startsWith/);
    expect(tmpBody(old)).not.toMatch(/\bisRegistryId\s*\(/);
    const derived = `${TMP_DECL}\n  return isRegistryId(id);\n}\n`;
    expect(tmpBody(derived)).toMatch(/\bisRegistryId\s*\(/);
    expect(tmpBody(derived)).not.toMatch(/startsWith/);
    expect(tmpBody('export const isTmpRootId = isRegistryId;\n')).toBeNull();
    expect(aliasRhs('export const TMPROOT_ID_MAX_CHARS = 255;\n')).toBe('255;');
    expect(DEF_VAL('REGISTRY_ID_MAX_CHARS').test('export const TMPROOT_ID_MAX_CHARS = REGISTRY_ID_MAX_CHARS;')).toBe(false);
  });

  it('isRegistryId and REGISTRY_ID_MAX_CHARS are declared in shared/api.ts and nowhere else', () => {
    expect(definers(DEF_FN('isRegistryId'))).toEqual(['shared/api.ts']);
    expect(definers(DEF_VAL('isRegistryId'))).toEqual([]);
    expect(definers(DEF_VAL('REGISTRY_ID_MAX_CHARS'))).toEqual(['shared/api.ts']);
  });

  it('isTmpRootId calls isRegistryId and tests no prefix itself', () => {
    const body = tmpBody(API());
    expect(body, 'isTmpRootId is not declared as a function in shared/api.ts').not.toBeNull();
    expect(body).toMatch(/\bisRegistryId\s*\(/);
    expect(body).not.toMatch(/startsWith/);
    expect(body).not.toMatch(/\bisSessionIdShape\b/);
  });

  it('TMPROOT_ID_MAX_CHARS is the alias, never a second literal', () => {
    expect(aliasRhs(API())).toBe('REGISTRY_ID_MAX_CHARS;');
  });

  // Wave 9's REDERIVED scan reads one code line at a time, so a copy of the old two-line body under a new name (the
  // shape call on one line, the prefix tests on the next) passes it. This scan reads each file's whole code text, and
  // `[^;{}]` keeps a match inside one statement, so a shape check and a prefix test in two statements are not a copy.
  it('no file outside shared/api.ts re-derives it from the shape and a prefix test, even across lines', () => {
    const REDERIVED_STMT = new RegExp(
      String.raw`\bisSessionIdShape\s*\([^;{}]*?startsWith\(\s*['"][.-]['"]\s*\)`
      + String.raw`|startsWith\(\s*['"][.-]['"]\s*\)[^;{}]*?\bisSessionIdShape\s*\(`);
    expect(REDERIVED_STMT.test("const ok = (id: string): boolean => isSessionIdShape(id)\n  && !id.startsWith('-');\n"),
      'CONTROL: a two-line copy').toBe(true);
    expect(REDERIVED_STMT.test("const ok = (id: string): boolean => !id.startsWith('.')\n  && isSessionIdShape(id);\n"),
      'CONTROL: a two-line copy, prefix first').toBe(true);
    expect(REDERIVED_STMT.test("if (!isSessionIdShape(sid)) {\n  return null;\n}\nif (sid.startsWith('-')) {\n"),
      'CONTROL: two statements are not a copy').toBe(false);
    expect(REDERIVED_STMT.test(stallCodeText("  // isSessionIdShape(id) && !id.startsWith('-')\n")),
      'CONTROL: a comment line is not code').toBe(false);
    expect(ALL.filter((f) => rel(f) !== 'shared/api.ts' && REDERIVED_STMT.test(stallCode(f))).map(rel)).toEqual([]);
  });
});
```

- [ ] **Step 3: Run the tests and watch them fail**

```bash
(cd server && ./node_modules/.bin/vitest run test/registry-id-l0.test.ts)
(cd server && ./node_modules/.bin/vitest run test/single-definition.test.ts -t 'path identity W1a')
(cd server && ./node_modules/.bin/tsc --noEmit -p test/tsconfig.tests.json 2>&1 | grep 'registry-id-l0')
```

Expected: FAIL.
- `registry-id-l0.test.ts`:
  - vitest resolves a missing named export to `undefined`, and nothing here reads the new names while tests are being collected (`it.each` iterates the local lists only). So the file collects and every case fails on its own: 30 failed, 0 passed.
  - The cap case fails `expected undefined to be 255`.
  - The 8 dash rows, the 18 table rows, the narrowing case, the agreement case and the lists case each fail with `TypeError: … isRegistryId is not a function`.
  - If instead the whole file fails at collection, record that by slug (`registry-id-l0-red-at-collection`) and measure the per-case reds through a temporary copy, as wave 9 did.
- `single-definition.test.ts -t 'path identity W1a'`: 3 failed, 2 passed, and every other describe skipped.
  - The CONTROL case passes: it reads only literals.
  - The cross-line scan passes: at the base only `shared/api.ts`, which it exempts, holds the shape and a prefix test in one statement (measured on the export: no file in `shared`, `server/src`, `pwa/src` or `agent/src` but `shared/api.ts` matches).
  - The declaration case fails `expected [] to deeply equal [ 'shared/api.ts' ]`.
  - The body pin fails `expected '\n  return typeof id === …' to match /\bisRegistryId\s*\(/`.
  - The alias pin fails `expected '255;' to be 'REGISTRY_ID_MAX_CHARS;'`.
- The test `tsc` reports `registry-id-l0.test.ts` with TS2305 (`Module '"../../shared/api.js"' has no exported member 'REGISTRY_ID_MAX_CHARS'`, and the same for `isRegistryId`), and possibly TS18046 on the narrowing line. Count them; the exact number is not pinned.

Record every red in the SDD ledger.

- [ ] **Step 4: Write the predicate and derive the temp-root names from it**

In `shared/api.ts`, inside the foot block, replace these 20 lines (located by content: from `/** The longest temp-root id (spec §5.10): 255 characters.` to `isTmpRootId`'s closing brace, `:9684-9703` at `837a099c0`).

Before:

```ts
/** The longest temp-root id (spec §5.10): 255 characters.
 *  - A session id is a FILE NAME component (`$REG/<id>.uuid`, `$REG/tmproots/<id>`), and no file system this runs on
 *    takes a component over 255 bytes. The session-id shape is ASCII, so a character is a byte.
 *  - ccd's own names run out sooner: `.reap-<id>.lock` past 244, and a slot's or a record's name sooner still (spec §7).
 *  - The coordination store's displacement parsers bound a candidate id by it too. */
export const TMPROOT_ID_MAX_CHARS = 255;

/** THE ONE PREDICATE of a temp-root id (spec §5.10): ccd's `_ws_tmproot_id_ok` (a session id's shape, no leading
 *  `.`), plus NO LEADING `-` and at most `TMPROOT_ID_MAX_CHARS` characters.
 *  - The leading `-` is a SAFETY rule, not defence in depth. ccd's destructive verbs read their decision flags from any
 *    position, `--session`'s value included, and every such flag begins `--`. The shape refuses `=`, so no
 *    `--flag=value` can be an id either.
 *  - The collector asks it of every listed name before any argv, and again of a job's id before its audit or its act.
 *  - The kept-leaf reader asks it before it names a leaf, so an id the collector never audits is not listed there
 *    either.
 *  - A non-string is not an id. The length is asked first, so a long string never reaches the shape's regex. */
export function isTmpRootId(id: unknown): id is string {
  return typeof id === 'string' && id.length <= TMPROOT_ID_MAX_CHARS && isSessionIdShape(id)
    && !id.startsWith('.') && !id.startsWith('-');
}
```

After (38 lines):

```ts
/** The longest registry id (spec 2026-10-12 §2.3): 255 characters, one file-name component (`$REG/<id>.uuid`); the session-id
 *  shape is ASCII, so a character is a byte.
 *  - No file system this runs on takes a component over 255 bytes. A temp root is named by the same id
 *    (`$REG/tmproots/<id>`), so the collector's cap below is this one.
 *  - ccd's own names run out sooner: `.reap-<id>.lock` past 244, and a slot's name sooner still. A tighter cap belongs
 *    where ccd mints an id (spec 2026-10-12 §2.6), not here: this cap is the longest name the registry can hold at all. */
export const REGISTRY_ID_MAX_CHARS = 255;

/** THE ONE PREDICATE of a registry id (spec 2026-10-12 §2.3): length first, then the session-id shape, then no leading `.` or `-`.
 *  - The leading `-` is a SAFETY rule, not defence in depth (spec 2026-10-12 §2.1). ccd's verbs read their decision flags from any
 *    position, `--session`'s value included, and every such flag begins `--`. An id of `--actor` is read as a flag,
 *    and the verb binds another token as its id. The shape refuses `=`, so no `--flag=value` can be an id either.
 *  - The leading `.` keeps `.`, `..` and a hidden name out, as ccd's own `_ws_tmproot_id_ok` does.
 *  - It is the rule for an id the server composes into an id-taking argv, whether the id came from a request, a
 *    stored run row, a registry file name or an executor's job.
 *  - It sits at this foot, beside the collector's names, and not after `isSessionIdShape`: README cites this file by
 *    line, and an insertion there would move every anchor it names.
 *  - A non-string is not an id. The length is asked first, so a long string never reaches the shape's regex. */
export function isRegistryId(id: unknown): id is string {
  return typeof id === 'string' && id.length <= REGISTRY_ID_MAX_CHARS && isSessionIdShape(id)
    && !id.startsWith('.') && !id.startsWith('-');
}

/** The longest temp-root id (spec §5.10) is the longest registry id: a temp root is named by a registry id.
 *  - A derived alias, never a second literal. The coordination store's displacement parsers bound a candidate id by
 *    this name, and their move to `REGISTRY_ID_MAX_CHARS` waits for a wave that edits the store. */
export const TMPROOT_ID_MAX_CHARS = REGISTRY_ID_MAX_CHARS;

/** THE ONE PREDICATE of a temp-root id (spec 2026-09-22 §5.10) is the registry id predicate, so the dash, dot and length clauses
 *  are written once (spec 2026-10-12 §2.3) and the accepted set is unchanged.
 *  - The collector asks it of every listed name before any argv, and again of a job's id before its audit or its act.
 *  - The kept-leaf reader asks it before it names a leaf, so an id the collector never audits is not listed there
 *    either.
 *  - It stays a `function` declaration that calls `isRegistryId`, never a `const` alias of it, so the temp-root name
 *    keeps its one function definer. */
export function isTmpRootId(id: unknown): id is string {
  return isRegistryId(id);
}
```

Then check the shape of the edit:

```bash
wc -l shared/api.ts                                                         # 9773: the Step 1 count plus 18
grep -c '^export const REGISTRY_ID_MAX_CHARS = 255;$' shared/api.ts         # 1
grep -c '^export const TMPROOT_ID_MAX_CHARS = REGISTRY_ID_MAX_CHARS;$' shared/api.ts   # 1
grep -n '^export const REGISTRY_ID_MAX_CHARS\|^export const TMPROOT_ID_MAX_CHARS' shared/api.ts   # REGISTRY's line is the lower number: declared above the alias
```

- [ ] **Step 5: Run the tests, the type-checks and the neighbours green**

```bash
(cd server && ./node_modules/.bin/vitest run test/registry-id-l0.test.ts test/collect-l0.test.ts test/collect-population.test.ts \
  test/collect-attention.test.ts test/run-signals-routing.test.ts)
(cd server && ./node_modules/.bin/vitest run test/single-definition.test.ts)
(cd server && ./node_modules/.bin/vitest run test/typecheck-tests.test.ts)
(cd server && ./node_modules/.bin/tsc --noEmit -p . && ./node_modules/.bin/tsc --noEmit -p test/tsconfig.tests.json)
(cd pwa && npm ci && ./node_modules/.bin/tsc --noEmit -p .)
(cd agent && npm ci && ./node_modules/.bin/tsc --noEmit -p .)
```

Expected:
- First command: every file passes. `registry-id-l0.test.ts` has 30 cases. The collector suites pass unchanged, which is the measured form of "the accepted set is unchanged". `collect-population`'s `HARDCODED on purpose` case still reads 255 through the alias.
- `single-definition`: exactly as green as at the base, plus this block's 5 cases. The wave 9 describes stay green: `DEF_FN('isTmpRootId')` still finds `['shared/api.ts']`, `DEF_VAL('TMPROOT_ID_MAX_CHARS')` still finds `['shared/api.ts']` (the alias is a `const` declaration), and `REDERIVED` (per line) and this block's cross-line scan each read no file but `shared/api.ts`'s exempt copy. If anything else is red, run it on the base first.
- `typecheck-tests` passes. It is a known load flake, so re-run it alone before calling it red.
- The two server `tsc` runs, the PWA's and the agent's print nothing and exit 0. The PWA bundles `shared/api.ts` and the agent compiles `../shared/**/*.ts`; neither reads the new names, and the pwa's `noUnusedLocals` sees no unused local.

- [ ] **Step 6: Prove README, the head of the file and the citation census owe nothing**

```bash
BASE=$(git merge-base HEAD origin/main)
S=$(git show "$BASE:shared/api.ts" | grep -n '^/\*\* The longest temp-root id (spec §5.10): 255 characters\.$' | cut -d: -f1); echo "S=$S"
diff <(git show "$BASE:shared/api.ts" | sed -n "1,$((S - 1))p") <(sed -n "1,$((S - 1))p" shared/api.ts) && echo HEAD-UNCHANGED
diff <(git show "$BASE:shared/api.ts" | sed -n '7878,7880p;7930p;7938p;7951p') <(sed -n '7878,7880p;7930p;7938p;7951p' shared/api.ts) && echo SAME-BYTES
git diff -U0 "$BASE" -- shared/api.ts | awk -v s="$S" -v e="$((S + 19))" \
  '/^@@/ { split($2, a, /[-,]/); n += 1; if (a[2] < s - 1 || a[2] > e) bad += 1 } END { print n " hunks, " bad + 0 " outside the pair" }'
diff <(git show "$BASE:shared/api.ts" | sed -n "$((S + 20)),\$p") <(sed -n "$((S + 38)),\$p" shared/api.ts) && echo TAIL-UNCHANGED
(cd server && ./node_modules/.bin/vitest run test/session-hook.test.ts -t 'every line citation is anchored|CITATION DEBT|README HAS ITS OWN CENSUS|THE RANGE BOUND')
git diff --stat -- README.md server/test/session-hook.test.ts                # prints nothing
```

Expected:
- `S=9684` at `837a099c0` (re-point if Step 1 recorded another number). `HEAD-UNCHANGED`, `SAME-BYTES` and `TAIL-UNCHANGED` are each printed.
- The awk line prints `<n> hunks, 0 outside the pair`. `-U0` splits the edit wherever an old line survives byte for byte, so `<n>` is not pinned: record it.
- The session-hook citation cases pass. Record the passed and skipped counts.
- The last line prints nothing.

If any of these differs, the edit moved a byte outside the pair. STOP and report `foot-edit-moved-a-line`.

- [ ] **Step 7: Mutation check**

Make each mutation alone, run its command, record the red in the SDD ledger, and revert before making the next. None was measured at planning, so measure each one.

| # | Mutation (exact edit) | Command | Expected red |
|---|---|---|---|
| T1.1 | In `isRegistryId`, delete ` && !id.startsWith('-')` | `(cd server && ./node_modules/.bin/vitest run test/registry-id-l0.test.ts test/collect-l0.test.ts)` | `registry-id-l0`: the 8 `a dash-leading id … is refused` rows (`expected true to be false`) and `the shared case lists answer as their names say` (`"--actor": expected true to be false`). The agreement case stays green, because the alias moves with the predicate. `collect-l0`: its 8 dash rows and `a dash-leading or over-long id is not listed` (`expected [ '--', '--actor', '-x' ] to deeply equal []`), which proves the derivation. Record any further collector suite that reds. |
| T1.2 | In `isRegistryId`, delete `&& !id.startsWith('.') ` (the second line becomes `    && !id.startsWith('-');`) | same | `registry-id-l0`: `. -> false`, `.. -> false` and `a dot-leading name -> false` (`expected true to be false`), and the lists case (`".hidden"`). `collect-l0`: the same three rows. |
| T1.3 | In `isRegistryId`, delete `id.length <= REGISTRY_ID_MAX_CHARS && ` | same | `registry-id-l0`: `256 characters -> false` and the lists case (the 256-character id). `collect-l0`: its 256 row and `a dash-leading or over-long id is not listed` (the 256-character id is now listed). |
| T1.4 | Replace `isTmpRootId`'s body `  return isRegistryId(id);` with the old two lines `  return typeof id === 'string' && id.length <= TMPROOT_ID_MAX_CHARS && isSessionIdShape(id)` / `    && !id.startsWith('.') && !id.startsWith('-');` | `(cd server && ./node_modules/.bin/vitest run test/single-definition.test.ts -t 'path identity W1a')` | `isTmpRootId calls isRegistryId and tests no prefix itself` (`expected '\n  return typeof id === …' to match /\bisRegistryId\s*\(/`). `registry-id-l0` stays green, because the answers are the same; that is why the body pin exists. |
| T1.5 | `export const TMPROOT_ID_MAX_CHARS = REGISTRY_ID_MAX_CHARS;` → `export const TMPROOT_ID_MAX_CHARS = 255;` | same | `TMPROOT_ID_MAX_CHARS is the alias, never a second literal` (`expected '255;' to be 'REGISTRY_ID_MAX_CHARS;'`). `registry-id-l0`'s cap case stays green (255 equals 255); that is why the alias pin exists. |
| T1.6 | In `server/src/registry.ts`, add the line `const REGISTRY_ID_MAX_CHARS = 255;` directly after `} from '../../shared/api.js';` | same | `isRegistryId and REGISTRY_ID_MAX_CHARS are declared in shared/api.ts and nowhere else` (`expected [ 'server/src/registry.ts', 'shared/api.ts' ] to deeply equal [ 'shared/api.ts' ]`) |
| T1.7 | `export const REGISTRY_ID_MAX_CHARS = 255;` → `= 256;` | `(cd server && ./node_modules/.bin/vitest run test/registry-id-l0.test.ts test/collect-population.test.ts)` | `its cap is 255 characters, hardcoded` (`expected 256 to be 255`), `256 characters -> false`, the lists case, and `collect-population`'s `HARDCODED on purpose` case (`expected 256 to be 255`) |
| T1.8 | Replace `export function isTmpRootId(id: unknown): id is string {` / `  return isRegistryId(id);` / `}` with `export const isTmpRootId = isRegistryId;` | `(cd server && ./node_modules/.bin/vitest run test/single-definition.test.ts)` (the whole file: an alternation needs a bare pipe, which this table cannot carry, and `\|` is a literal pipe to vitest) | wave 9's `isTmpRootId and TMPROOT_ID_MAX_CHARS are declared in shared/api.ts and nowhere else` (`expected [] to deeply equal [ 'shared/api.ts' ]`), and this block's body pin (`isTmpRootId is not declared as a function in shared/api.ts: expected null not to be null`) |
| T1.9 | In `server/src/registry.ts`, add the two lines `const idOk = (id: string): boolean => isSessionIdShape(id)` / `  && !id.startsWith('-');` directly after `} from '../../shared/api.js';` (text only: no command here compiles `registry.ts`) | `(cd server && ./node_modules/.bin/vitest run test/single-definition.test.ts)` | this block's `no file outside shared/api.ts re-derives it from the shape and a prefix test, even across lines` (`expected [ 'server/src/registry.ts' ] to deeply equal []`). Wave 9's per-line `no code line outside shared/api.ts re-derives it …` case stays green, because neither line holds both tests; that is why the cross-line scan exists. |

After reverting each mutation, run Step 5's first two commands again and see them green. Then check that `git diff --stat` names only the four files Step 8 adds.

- [ ] **Step 8: Commit**

```bash
git add shared/api.ts server/test/registryIdCases.ts server/test/registry-id-l0.test.ts server/test/single-definition.test.ts
git commit -m "$(cat <<'MSG'
feat(shared): isRegistryId, the one registry id predicate; isTmpRootId derives from it

isRegistryId accepts a string of at most 255 characters with the session-id
shape and no leading dash or dot (spec §2.3). The dash clause is a safety rule:
ccd's verbs read their decision flags from any position, so an id spelled like
a flag would make a verb bind another token as its id (spec §2.1). The
predicate and REGISTRY_ID_MAX_CHARS sit in shared/api.ts's foot block, above
the collector's names, not after isSessionIdShape: README cites the file by
line, and the head of the file is unchanged (measured). TMPROOT_ID_MAX_CHARS
becomes a derived alias, so the store is not edited, and isTmpRootId stays a
function whose body calls isRegistryId, so the collector accepts the same set
(its suites pass unchanged). A new test file pins the predicate's answers on
the collector's table and the dash ids. A shared case list holds the ids the
later gate tests plant. single-definition pins the pair's one definer,
the derived body and the alias, and that no file re-derives the rule,
even split across lines.
MSG
)"
```

---

### Task 2: Request-id routes — `knownId`, `/ensure` and the cross-pool swap

**Model routing:** `opus`, effort `high`.

**Why:** spec §2.3, as R7 and R22 amend it.
- `knownId` returns false for any id that fails `isRegistryId`, and it does so before it lists the registry. The census stays at 18 routes (14 POST, 4 GET), so `routes.test.ts`'s claim pin does not change.
- `POST /api/sessions/:id/ensure` and the `crossPool` arm of `POST /api/sessions/:id/swap` are outside `knownId`. Each asks `isRegistryId(id)` itself and answers 400 `bad-session-id`.
  - `/ensure` asks it as the route's first statement.
  - The cross arm asks it as the arm's first statement, ahead of the skew gate. It is not placed at the route's head, where it would mask the ordinary arm's `readSessionRecord` gate (R22).
- The masked reader arms that Task 4 adds behind `knownId` (`/archive`, and `liveStatus` behind `/interrupt`) are masked from the moment they exist (R17).

**Measured at planning:** one fact only. It was measured on a bare Fastify 5.10.0 instance taken from the worktree's server modules, with no ccrc code. A `POST /api/sessions/:id/release` with an `:id` of 7 or 100 characters reaches the handler. An `:id` of 101, 255 or 256 characters is answered `414 {code:'FST_ERR_MAX_PARAM_LENGTH'}` by the router, before any handler runs. The cause is Fastify's default `maxParamLength` of 100, and `server.ts` builds `Fastify({ logger: false })`, which keeps that default. Every other count, red text and status below is DERIVED. The worker measures each one and records the measured value. A different count is not a departure; a different meaning is.

**Departure this task names (by slug; the coordinator numbers it):**
- **`over-long-request-ids-stop-at-the-router`.** The scope's control "a 255-character id, rows planted, release normally" cannot be built, and neither can a 404 for the 256-character refused id:
  - Fastify answers 414 for any `:id` over 100 characters, so neither id reaches `knownId`, `/ensure` or the cross arm;
  - a 255-character id's `.uuid` file is 260 bytes, which is over the filesystem's 255-byte name limit, so its row cannot be planted either.

  So the HTTP cases use the refused ids of 100 characters or fewer. A separate case pins that the router answers 414 for the over-long ids and composes nothing. The longest control is a 100-character id. The predicate's 255-character clause keeps its pin in Task 1's L0 table.

**Files:**
- Modify `server/src/server.ts` (L4). The anchors are by content. Line numbers are hints at `837a099c0`.
  - (a) The first `../../shared/api.js` import block, whose last name line is `  parseRouteFields, programKickoffVerdict, routeFieldsOrNull, routeParseDetail, type RouteFields,` (`:88-89`). `isRegistryId` joins that line.
  - (b) `knownId`'s census comment (`:1902-1921`), at the sentence that begins `It carries no identity of its own: \`isSafeSessionId\` is`.
    - Keep `` `knownId` gates 18 request-id routes (14 POST, 4 GET `` exactly as it is.
    - Keep "745 agent-WS operations [registry-read-census:fleet]" and "(31 [registry-read-census:fields]" exactly as they are.
  - (c) `knownId`'s first statement (`:1922`).
  - (d) `/ensure`'s body (`:2630-2633`).
  - (e) The `/swap` route-head comment, at the line `// server-side preflight they share. A declared crossing gets the 501 skew` (`:3106-3107`).
  - (f) The cross arm's first statement, at `    if (body.crossPool === true) {` followed by `      // The declared crossing skips the verdict entirely — that IS the` (`:3114-3115`). Do not use the other `body.crossPool === true` line, at `:2597` with six spaces of indentation, which belongs to `POST /api/sessions`.
- Create `server/test/idGateFixture.ts`, the shared rig of the id-gate suites. Task 3 adds `storedRun` to it, and no later task makes a second rig.
- Create `server/test/knownid-registry-id.test.ts`.
- Do not edit `shared/api.ts`, `routes.test.ts`, `registry.test.ts`, any other test file, or any other route.

**Interfaces:**
- **Consumes:**
  - `isRegistryId(id: unknown): id is string`, from `shared/api.ts` (Task 1).
  - `REFUSED_IDS: readonly string[]` and `EDGE_ACCEPTED_IDS: readonly string[]`, from `server/test/registryIdCases.ts` (Task 1).
  - Existing names:
    - `buildServer` and `type Deps` (`../src/server.js`);
    - `type CcrcConfig` (`../src/config.js`);
    - `type Runner` (`../src/exec.js`);
    - `localIO` and `type FleetIO` (`../src/io.js`);
    - `POOLS_CAP` (`../src/ccdargv.js`);
    - `type FleetState` (`../src/fleetstate.js`);
    - `openCoordDb` (`../src/coord/db.js`);
    - `CoordStore` (`../src/coord/store.js`);
    - `testDeps` (`./helpers.js`);
    - `mkTmp` (`./tmpHelpers.js`).
- **Produces:**
  - `knownId(id: string, names?: readonly string[] | null): Promise<boolean>`, with its signature unchanged and `if (!isRegistryId(id)) return false;` as its first statement.
  - `POST /api/sessions/:id/ensure`: a failing id answers `400 { ok: false, error: 'bad-session-id' }`.
  - `POST /api/sessions/:id/swap` with `crossPool: true`: a failing id answers `400 { ok: false, error: 'bad-session-id' }`, ahead of the 501 skew gate.
  - In `server/test/idGateFixture.ts`:
    ```ts
    export const ID_GATE_TOKEN: string;   // 'f'.repeat(64), the mailToken appFor builds with (interface addition)
    export function seedRow(home: string, id: string, fields?: Record<string, string>): void;
    export function recorder(cfg?: { fail?: ReadonlySet<string> }): { run: Runner; calls: string[][] };
    export function appFor(home: string, run: Runner, over?: Partial<Omit<Deps, 'cfg'>>):
      Promise<{ app: FastifyInstance; coord: CoordStore; cfg: CcrcConfig }>;
    ```

- [ ] **Step 0: Entry conditions (Task 1 is committed; measure, never assume)**

From the workspace root:

```bash
grep -c 'await knownId(' server/src/server.ts                                                        # (a) 19: 18 gates and the revival probe
grep -c '`knownId` gates 18 request-id routes (14 POST, 4 GET' server/src/server.ts                   # (b) 1
grep -c "return runCcdOr502(reply, CCD_ARGV.ensure(id));" server/src/server.ts                        # (c) 1: /ensure, ungated
grep -c "argv = CCD_ARGV.swapCross(id, body.wrapper);" server/src/server.ts                           # (d) 1: the cross arm, ungated
grep -c "^    if (body.crossPool === true) {$" server/src/server.ts                                   # (e) 1: the swap route's arm (the :2597 one is indented six)
grep -c "server-side preflight they share. A declared crossing gets the 501 skew" server/src/server.ts # (f) 1
grep -c "isRegistryId" server/src/server.ts                                                          # (g) 0
grep -c '^export function isRegistryId(id: unknown): id is string {$' shared/api.ts                  # (h) 1: Task 1's predicate
grep -cE '^export const (REDIRECT_IDS|REFUSED_IDS|EDGE_ACCEPTED_IDS)\b' server/test/registryIdCases.ts # (i) 3: Task 1's lists
grep -c 'maxParamLength' server/src/server.ts                                                        # (j) 0: Fastify's default of 100 stands
grep -c "const app = Fastify({ logger: false });" server/src/server.ts                               # (k) 1
ls server/test/idGateFixture.ts server/test/knownid-registry-id.test.ts 2>/dev/null | wc -l           # (l) 0: both new
```

Rules:
- If (h) or (i) is not as stated, Task 1 has not landed. **STOP**: `tree-not-ready`.
- If (c), (d), (e) or (f) is 0, the site has moved. **STOP**: `gate-site-moved`.
- If (j) is not 0, someone has set the router's cap. The over-long case's 414 boundary must then be re-derived from the value that was set. Report it, and build on the coordinator's word.
- Any other difference in a count is re-pointed by content and recorded.

- [ ] **Step 1: Write `server/test/idGateFixture.ts`**

```ts
// Path identity W1a (spec 2026-10-12 §2.3): the shared rig of the id-gate suites. A refused id is planted as a REAL
// row under a fixture HOME's registry (`$REG/--actor.uuid` is an ordinary file), so a gate that refuses it is shown
// refusing a row that EXISTS, never an absent one. Fixture HOMEs only: `testDeps` loads its config from the HOME it
// is given, and the runner here records argv and never execs anything (`testDeps` puts `guardRunner`, the agent's
// whitelist, in front of it).
//
// Task 3 adds `storedRun` here. Every later id-gate suite builds on this file, never on a second rig.
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { FastifyInstance } from 'fastify';
import { buildServer, type Deps } from '../src/server.js';
import type { CcrcConfig } from '../src/config.js';
import type { Runner } from '../src/exec.js';
import { openCoordDb } from '../src/coord/db.js';
import { CoordStore } from '../src/coord/store.js';
import { testDeps } from './helpers.js';

/** The box token `appFor` builds every server with: send it as `x-ccrc-mail-token` on a box-token-gated route. */
export const ID_GATE_TOKEN = 'f'.repeat(64);

/** `coord-abandon.test.ts`'s `seed` row: every field a workspace session carries, for any id. */
const rowDefaults = (id: string): Record<string, string> => ({
  wrapper: 'claude', project: 'demo', workdir: `/w/${id}`, uuid: `u-${id}`, started: '1',
  workspace: id, branch: `ws/${id}`, base: 'origin/main',
});

/** Plants `$REG/<id>.<field>` for every field, `fields` overriding the defaults. Any id: `--actor` included. */
export function seedRow(home: string, id: string, fields: Record<string, string> = {}): void {
  const reg = path.join(home, '.cc-sessions');
  mkdirSync(reg, { recursive: true });
  for (const [k, v] of Object.entries({ ...rowDefaults(id), ...fields })) {
    writeFileSync(path.join(reg, `${id}.${k}`), v);
  }
}

/** Records every argv (ccd's verb or tmux's subcommand at `[0]`) and answers success, or a failure for any
 *  `args[0]` in `fail`. Records BEFORE answering, so a failed call is still on the record. */
export function recorder(cfg: { fail?: ReadonlySet<string> } = {}): { run: Runner; calls: string[][] } {
  const calls: string[][] = [];
  const run: Runner = async (_cmd, args) => {
    calls.push([...args]);
    const verb = args[0] ?? '';
    if (cfg.fail?.has(verb)) return { code: 1, stdout: '', stderr: `${verb} failed on the box` };
    return { code: 0, stdout: '', stderr: '' };
  };
  return { run, calls };
}

/** The server over a fixture HOME, with a real CoordStore and `ID_GATE_TOKEN` as its box token. */
export async function appFor(
  home: string, run: Runner, over: Partial<Omit<Deps, 'cfg'>> = {},
): Promise<{ app: FastifyInstance; coord: CoordStore; cfg: CcrcConfig }> {
  mkdirSync(path.join(home, '.cc-sessions'), { recursive: true });
  const coord = new CoordStore(openCoordDb(path.join(home, '.ccrc', 'coord.db')));
  const base = testDeps(home, run);
  const app = await buildServer({ ...base, mailToken: ID_GATE_TOKEN, coord, ...over });
  return { app, coord, cfg: base.cfg };
}
```

- [ ] **Step 2: Write `server/test/knownid-registry-id.test.ts`**

```ts
// Path identity W1a (spec 2026-10-12 §2.3, as built): a request id that is not a registry id never reaches an
// id-taking argv through the session routes. Three doors:
//   - `knownId`, the membership gate of 18 request-id routes, asks the L0 predicate FIRST and spends no listing;
//   - `POST /api/sessions/:id/ensure` and the crossing arm of `POST /api/sessions/:id/swap`, which `knownId` does not
//     gate, ask it at their own heads and answer 400 `bad-session-id`. The crossing arm asks it ahead of its skew gate.
// Every refused id has its row PLANTED (`$REG/--actor.uuid` is an ordinary file in a fixture HOME), so the 404 is the
// predicate's answer and never the listing's.
//
// THE ROUTER IS AN OUTER GATE FOR LENGTH. Fastify's default `maxParamLength` is 100, and `server.ts` builds
// `Fastify({ logger: false })`, so the router answers a request `:id` over 100 characters with 414 before any handler
// runs. The predicate's 255-character clause is therefore unreachable through these routes, and Task 1's L0 table
// pins it. This file pins the router's answer for the over-long ids instead, and its longest control is 100 characters.
import { describe, it, expect, afterEach } from 'vitest';
import path from 'node:path';
import type { FastifyInstance } from 'fastify';
import { localIO, type FleetIO } from '../src/io.js';
import { POOLS_CAP } from '../src/ccdargv.js';
import type { FleetState } from '../src/fleetstate.js';
import { mkTmp } from './tmpHelpers.js';
import { appFor, recorder, seedRow } from './idGateFixture.js';
import { EDGE_ACCEPTED_IDS, REFUSED_IDS } from './registryIdCases.js';

/** Fastify's default `maxParamLength` (find-my-way): the router answers a longer `:id` with 414. */
const ROUTER_PARAM_MAX = 100;
const ROUTABLE_REFUSED = REFUSED_IDS.filter((id) => id.length <= ROUTER_PARAM_MAX);
const OVER_LONG = [...REFUSED_IDS, ...EDGE_ACCEPTED_IDS].filter((id) => id.length > ROUTER_PARAM_MAX);
const CONTROLS = [...EDGE_ACCEPTED_IDS.filter((id) => id.length <= ROUTER_PARAM_MAX), 'x'.repeat(ROUTER_PARAM_MAX)];

const NO_EVIDENCE: FleetState = { connected: true, downSince: null, ccdVerbs: null, rosterFp: null, build: null };
const POOLS_ADVERTISED: FleetState = {
  connected: true, downSince: null, ccdVerbs: ['swap', POOLS_CAP], rosterFp: null, build: null,
};

interface Rig { app: FastifyInstance; calls: string[][]; listings: () => number }

let opened: FastifyInstance[] = [];
afterEach(async () => {
  for (const a of opened) await a.close();
  opened = [];
});

/** A server over a fresh fixture HOME with `plant`'s rows on disk. `listings` counts `readdir`s of the registry. */
const rig = async (
  plant: readonly string[], opts: { fleetState?: FleetState; fail?: ReadonlySet<string> } = {},
): Promise<Rig> => {
  const home = mkTmp('ccrc-knownid-');
  for (const id of plant) seedRow(home, id);
  const registryDir = path.join(home, '.cc-sessions');
  let n = 0;
  const io: FleetIO = {
    ...localIO,
    readdir: async (p, timeoutMs, signal) => {
      if (p === registryDir) n += 1;
      return localIO.readdir(p, timeoutMs, signal);
    },
  };
  const { run, calls } = recorder(opts.fail === undefined ? {} : { fail: opts.fail });
  const w = await appFor(home, run, { io, ...(opts.fleetState === undefined ? {} : { fleetState: opts.fleetState }) });
  opened.push(w.app);
  return { app: w.app, calls, listings: () => n };
};

const post = (app: FastifyInstance, id: string, verb: string, payload: Record<string, unknown> = {}) =>
  app.inject({ method: 'POST', url: `/api/sessions/${id}/${verb}`, payload });

describe('knownId refuses a non-registry id before its listing (spec §2.3)', () => {
  it.each(ROUTABLE_REFUSED)(
    'POST /release for %s, with its row planted, answers 404 unknown-session and runs no ccd verb',
    async (id) => {
      const r = await rig([id]);
      const res = await post(r.app, id, 'release');
      expect(res.statusCode).toBe(404);
      expect(res.json()).toEqual({ ok: false, error: 'unknown-session' });
      expect(r.calls).toEqual([]);
      expect(r.listings(), 'the registry listing count: knownId listed for a name it must refuse unread').toBe(0);
    },
  );

  it.each(ROUTABLE_REFUSED)('POST /restore for %s answers 404 and runs no ccd verb', async (id) => {
    const r = await rig([id]);
    const res = await post(r.app, id, 'restore');
    expect(res.statusCode).toBe(404);
    expect(res.json()).toEqual({ ok: false, error: 'unknown-session' });
    expect(r.calls).toEqual([]);
    expect(r.listings(), 'the registry listing count').toBe(0);
  });

  it.each(ROUTABLE_REFUSED)('POST /prompt for %s answers 404 and sends no keys', async (id) => {
    // `capture-pane` fails in this rig, so an id that got past the gate is answered 409 `not-alive` at once rather
    // than walking sendPrompt's verify loop: the red is fast, and the failed capture is still on the record.
    const r = await rig([id], { fail: new Set(['capture-pane']) });
    const res = await post(r.app, id, 'prompt', { text: 'hello' });
    expect(res.statusCode).toBe(404);
    expect(res.json()).toEqual({ ok: false, error: 'unknown-session' });
    expect(r.calls.filter((c) => c[0] === 'send-keys')).toEqual([]);
    expect(r.calls, 'no tmux or ccd call at all').toEqual([]);
    expect(r.listings(), 'the registry listing count').toBe(0);
  });

  it('controls: a--actor, a.--actor and a 100-character id, rows planted, release normally', async () => {
    for (const id of CONTROLS) {
      const r = await rig([id]);
      const res = await post(r.app, id, 'release');
      expect(res.statusCode, id).toBe(200);
      expect(res.json(), id).toEqual({ ok: true });
      expect(r.calls, id).toEqual([['ws-release', '--session', id]]);
      expect(r.listings(), `${id}: the counter sees knownId's one listing`).toBe(1);
    }
  });
});

describe('the router answers an over-long request id before any gate (spec §2.3, as built)', () => {
  it.each(OVER_LONG.map((id) => [id.length, id] as const))(
    'an id of %i characters never reaches a handler: the router answers 414 and composes nothing',
    async (_n, id) => {
      const r = await rig([], { fleetState: POOLS_ADVERTISED });
      for (const [verb, payload] of [
        ['release', {}], ['restore', {}], ['prompt', { text: 'hello' }], ['ensure', {}],
        ['swap', { wrapper: 'claude-b', crossPool: true }],
      ] as const) {
        const res = await post(r.app, id, verb, payload);
        expect(res.statusCode, verb).toBe(414);
        expect(res.json(), verb).toMatchObject({ code: 'FST_ERR_MAX_PARAM_LENGTH' });
      }
      expect(r.calls).toEqual([]);
      expect(r.listings()).toBe(0);
    },
  );
});

describe('the two request-id routes outside knownId (spec §2.3, as built)', () => {
  it.each(ROUTABLE_REFUSED)('/ensure for %s answers 400 bad-session-id and composes no ensure', async (id) => {
    const r = await rig([id]);
    const res = await post(r.app, id, 'ensure');
    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({ ok: false, error: 'bad-session-id' });
    expect(r.calls).toEqual([]);
  });

  it.each(ROUTABLE_REFUSED)(
    '/swap with crossPool:true for %s answers 400 bad-session-id ahead of the skew gate',
    async (id) => {
      // Both fleet states, in this order. With NO evidence of `pools-v1` the skew gate answers 501, so a 400 here
      // proves the predicate stands AHEAD of it (R22). With the capability advertised, a missing predicate would
      // compose `swap --cross-pool <id>`.
      for (const [label, fleetState] of [
        ['no evidence', NO_EVIDENCE], ['pools-v1 advertised', POOLS_ADVERTISED],
      ] as const) {
        const r = await rig([id], { fleetState });
        const res = await post(r.app, id, 'swap', { wrapper: 'claude-b', crossPool: true });
        expect(res.statusCode, label).toBe(400);
        expect(res.json(), label).toEqual({ ok: false, error: 'bad-session-id' });
        expect(r.calls, label).toEqual([]);
      }
    },
  );

  it('control: /ensure for a--actor composes ensure a--actor', async () => {
    const r = await rig(['a--actor']);
    const res = await post(r.app, 'a--actor', 'ensure');
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true });
    expect(r.calls).toEqual([['ensure', 'a--actor']]);
  });

  it('control: /swap with crossPool:true for a--actor, pools-v1 advertised, composes the crossing', async () => {
    const r = await rig(['a--actor'], { fleetState: POOLS_ADVERTISED });
    const res = await post(r.app, 'a--actor', 'swap', { wrapper: 'claude-b', crossPool: true });
    expect(res.statusCode).toBe(200);
    expect(r.calls).toEqual([['swap', '--cross-pool', 'a--actor', 'claude-b']]);
  });
});
```

- [ ] **Step 3: Run it and see it fail**

From `server/`, in the foreground, with a timeout of at least 600000 ms:

```bash
cd server && ./node_modules/.bin/vitest run test/knownid-registry-id.test.ts
```

Expected (derived): FAIL, 45 failed and 5 passed, out of 50.

| Case | Count | Expected |
|---|---|---|
| `/release` refused | 9 | `expected 200 to be 404`: `knownId` finds the planted row, and `ws-release --session <id>` is composed |
| `/restore` refused | 9 | `expected 200 to be 404` |
| `/prompt` refused | 9 | `expected 409 to be 404`: `not-alive`, after a `capture-pane` for the id |
| `/ensure` refused | 9 | `expected 200 to be 400` |
| `/swap` cross refused | 9 | `no evidence: expected 501 to be 400` |
| The release controls | 1 | GREEN already |
| The two over-long cases (255 and 256) | 2 | GREEN already: they pin the router, not this task's code |
| The two route controls | 2 | GREEN already |

Record the measured counts in the SDD ledger.

- [ ] **Step 4: Implement, in `server/src/server.ts`**

(a) Edit the import. Before:

```ts
  parseRouteFields, programKickoffVerdict, routeFieldsOrNull, routeParseDetail, type RouteFields,
} from '../../shared/api.js';
import { ARCHIVE_REFUSALS, archiveInterrupts } from '../../shared/api.js';
```

After:

```ts
  isRegistryId, parseRouteFields, programKickoffVerdict, routeFieldsOrNull, routeParseDetail, type RouteFields,
} from '../../shared/api.js';
import { ARCHIVE_REFUSALS, archiveInterrupts } from '../../shared/api.js';
```

(b) Edit the census comment. Every census sentence outside these four lines stays byte for byte. Before:

```ts
  // every human keystroke — purely to answer "does
  // this id exist". It carries no identity of its own: `isSafeSessionId` is
  // the real injection guard, and ccd re-checks `[[ -f "$REG/$id.uuid" ]]` on
  // the box regardless. One
```

After:

```ts
  // every human keystroke — purely to answer "does
  // this id exist". Its FIRST statement is the registry-id predicate
  // (`isRegistryId`, L0; path-identity spec §2.3): a name ccd could read as a
  // flag (`--actor`), a dot-leading name, or one past the file-name cap is
  // unknown before any listing is spent on it, so these routes hand an
  // id-taking argv nothing but a registry id. `isSafeSessionId`, which most of
  // them still ask first, stays the clip path-component rule: it admits
  // `--actor` and is not the injection guard. ccd re-checks
  // `[[ -f "$REG/$id.uuid" ]]` on the box regardless. Two request-id routes
  // stand outside this census and ask the predicate at their own heads
  // (`/ensure`, and the crossing arm of `/swap`), so the count above is still
  // what `routes.test.ts` measures. An `:id` over 100 characters reaches none
  // of these handlers: Fastify's default `maxParamLength` answers 414 first.
  // One
```

(c) Edit `knownId`'s first statement. Before:

```ts
  const knownId = async (id: string, names?: readonly string[] | null): Promise<boolean> => {
    // `names` PASSED IN by a caller that already listed (the sessions route,
```

After:

```ts
  const knownId = async (id: string, names?: readonly string[] | null): Promise<boolean> => {
    // Before the listing, and whatever a passed-in listing says (path-identity
    // spec §2.3): a planted `$REG/--actor.uuid` is exactly the row this refuses.
    if (!isRegistryId(id)) return false;
    // `names` PASSED IN by a caller that already listed (the sessions route,
```

(d) Edit `/ensure`. Before:

```ts
  app.post('/api/sessions/:id/ensure', async (req, reply) => {
    const { id } = req.params as { id: string };
    return runCcdOr502(reply, CCD_ARGV.ensure(id));
  });
```

After:

```ts
  app.post('/api/sessions/:id/ensure', async (req, reply) => {
    const { id } = req.params as { id: string };
    // NOT behind `knownId`, whose census of 18 stays what `routes.test.ts`
    // measures: the route asks the registry-id predicate itself, first
    // (path-identity spec §2.3, as built). ccd's `cmd_ensure` binds its argument
    // literally and dies on an absent row, so this is no redirect today; the
    // check keeps a name ccd could read as a flag from ever reaching the argv.
    if (!isRegistryId(id)) return reply.code(400).send({ ok: false, error: 'bad-session-id' });
    return runCcdOr502(reply, CCD_ARGV.ensure(id));
  });
```

(e) Edit the `/swap` route-head comment. Before:

```ts
    // server-side preflight they share. A declared crossing gets the 501 skew
    // refusal and deliberately skips `readSessionRecord` plus the pool verdict;
```

After:

```ts
    // server-side preflight they share. A declared crossing asks the registry-id
    // predicate of its id first (400 `bad-session-id`), then gets the 501 skew
    // refusal, and deliberately skips `readSessionRecord` plus the pool verdict;
```

(f) Edit the cross arm. Before:

```ts
    if (body.crossPool === true) {
      // The declared crossing skips the verdict entirely — that IS the
```

After:

```ts
    if (body.crossPool === true) {
      // FIRST in this arm, ahead of the skew gate (path-identity spec §2.3, as
      // built): the crossing skips `readSessionRecord`, the ordinary arm's gate,
      // so nothing else stands between a request id and `swap --cross-pool <id>`.
      // It sits in the arm, not at the route's head, where it would also answer
      // for the ordinary arm and mask that arm's own read.
      if (!isRegistryId(id)) return reply.code(400).send({ ok: false, error: 'bad-session-id' });
      // The declared crossing skips the verdict entirely — that IS the
```

No other line of `server.ts` changes.

- [ ] **Step 5: Run it green**

```bash
cd server && ./node_modules/.bin/vitest run test/knownid-registry-id.test.ts
```

Expected: PASS, 50 of 50.

- [ ] **Step 6: Mutation table.** Apply each mutation alone. Run its command from `server/`, see the red, record the before and the after in the SDD ledger, and revert. Every red text below is derived; measure each one and record the measured text.

| # | Mutation (exact edit) | Command | Expected red |
|---|---|---|---|
| T2.1 | `knownId`: delete `if (!isRegistryId(id)) return false;` | `./node_modules/.bin/vitest run test/knownid-registry-id.test.ts -t 'knownId refuses'` | release ×9 and restore ×9: `expected 200 to be 404`. prompt ×9: `expected 409 to be 404`. The controls stay green. |
| T2.2 | `knownId`: replace that statement with `if (!isSafeSessionId(id)) return false;`. This is the old guard, asked in the new place. | same | the same 27 reds: `isSafeSessionId` admits every routable refused id, so it is the predicate, and not the placement, that refuses |
| T2.3 | `knownId`: move `if (!isRegistryId(id)) return false;` below the `const listed = …` line | same | release ×9 and restore ×9: `the registry listing count: expected 1 to be 0`. prompt ×9: the same count. The status stays 404, so the count is the only red. |
| T2.4 | `/ensure`: delete the `if (!isRegistryId(id)) …` line | `./node_modules/.bin/vitest run test/knownid-registry-id.test.ts -t 'outside knownId'` | ensure ×9: `expected 200 to be 400`, with `[['ensure', '--actor']]` and the others composed |
| T2.5 | The cross arm: delete the `if (!isRegistryId(id)) …` line | same | swap ×9: `no evidence: expected 501 to be 400`. With the first variant passed over, the advertised one shows `pools-v1 advertised: expected 200 to be 400`. |
| T2.6 | The cross arm: move the check to directly above `argv = CCD_ARGV.swapCross(id, body.wrapper);`, below the `capSupported` block | same | swap ×9: `no evidence: expected 501 to be 400`. The advertised variant alone stays green, which is why the no-evidence variant runs first. |

Revert each mutation, then re-run Step 5's command: green.

- [ ] **Step 7: Run the other named suites, and type-check**

From `server/`, in the foreground, each with a timeout of at least 600000 ms:

```bash
./node_modules/.bin/vitest run test/routes.test.ts test/registry.test.ts test/swap-route-pool.test.ts test/lifecycle.test.ts test/kickoff-route.test.ts test/auth-passkey.test.ts
./node_modules/.bin/vitest run test/typecheck-tests.test.ts
./node_modules/.bin/tsc --noEmit -p .
```

Expected: PASS, and tsc prints nothing.
- **`routes`:** `knownId route census` stays green unchanged, with 18 request gates (14 POST, 4 GET) and the one revival probe. The comment's claim phrase is untouched.
- **`registry`:** `registry read census` stays green. "745 … [registry-read-census:fleet]" and "31 [registry-read-census:fields]" are intact, and no new digit stands within 40 characters before a tag.
- **`swap-route-pool` and `lifecycle`:** the ordinary arm, the 501 skew cases and `ensure passes the id through` are unchanged, because their ids are registry ids.
- **`auth-passkey`:** its `BODYLESS_WRITES` row for `/api/sessions/x/ensure` still answers 403 `foreign-origin`.
- **`typecheck-tests`:** it compiles the two new files.
- **A known load flake** (`typecheck-tests`): re-run it in isolation before calling it a break.

Then confirm the tree:

```bash
git diff --stat   # server/src/server.ts only, plus the two new test files (untracked)
```

- [ ] **Step 8: Commit**

```bash
git add server/src/server.ts server/test/idGateFixture.ts server/test/knownid-registry-id.test.ts
git commit -F - <<'EOF'
fix(server): knownId, /ensure and the cross-pool swap refuse a non-registry id

knownId, the membership gate of 18 request-id routes, now asks the L0
registry-id predicate first and answers unknown before any listing. A
planted --actor.uuid, a dot-leading name or an over-long id never reaches
an id-taking argv through those routes. The census comment says so, and
it no longer calls isSafeSessionId the injection guard: that stays the
clip path-component rule.

Two request-id routes stand outside that census and now ask the
predicate at their own heads, answering 400 bad-session-id:
- /ensure, as its first statement;
- the crossing arm of /swap, as the arm's first statement, ahead of the
  skew gate, so the ordinary arm's own read is not masked.
The knownId count stays 18.

A request id over 100 characters never reaches these handlers: Fastify's
default maxParamLength answers 414 first. The new suite pins that, with a
100-character control, and the predicate's 255-character clause keeps its
L0 pin.

idGateFixture.ts is the shared rig of the id-gate suites: a real dash-named
row in a fixture HOME, a recording runner, and a server with a real
CoordStore.
EOF
```

---

### Task 3: Stored-row gates — `dispatchRun`, `closeRun` and the abandon arm

**Model routing:** **`opus`, effort `xhigh`**. SAFETY: this is the destructive subject. Release, archive, hold, `ensure` and `pr-state` all take the stored id, and no ingress check stands in front of a row written before that check existed.

**Why:**
- **Spec §2.3.** Every stored `claimedBy` or `sessionId` that can reach an id-taking builder is re-checked where the stored row enters the id-taking flow, before the builder is built. The POST check (Task 9) is not relied on, because existing coord.db rows predate it. This task covers the two flows that read `run.sessionId`: `dispatchRun` and `closeRun`. Close covers its nested calls too: `verifyDone`'s `pr-state` and child-spent's live `pr-state` (spec §7 item 23).
- **R6.** Three paths close a run whose stored `sessionId` fails the predicate: the operator abandon, the archive door's programme end and the dead-coordinator sweep. Each closes the run `failed`, with no fleet act, no child gate, `released:false` and one run event. `abandonRefusal` refuses nothing new for such a run, so the door ends such a programme whole. Every non-abandon path refuses with 409 `bad-session`, review closes included.
- **R27.** The event is ONE row, `coord.recordRunEvent(id, causedBy, 'fleet-act-omitted:bad-session')`, written only after the store's close succeeds. The colon keeps `mail-routes.test.ts`'s kebab scan from reading it as a code.
- **R13.** Coordination routes answer `bad-session`, a word that already exists (`RUN_ROUTE_REFUSE_CODES`, so the kebab scan admits it through `isRunRouteRefuseCode`).
- **R17.** These gates land before Task 4's reader widening, so two arms are masked from birth:
  - `close.ts`'s `childGateAtClose` is masked by both close gates. Task 4 exports it and pins it directly.
  - Dispatch's resume `childBindGate` is masked by the dispatch gate.
  This task adds no pin for either beyond its own gate cases.
- **Departure `resume-dispatch-refuses-not-holds`.** Spec §2.3 says resume dispatch "holds" on a refused id. Here the dispatch gate refuses with 409 `bad-session` instead, and the run stays `planned`.
- **Traps measured at `837a099c0`. Each one reds a suite this task runs:**
  - `unattended-actor.test.ts` counts every LINE of `coord/close.ts`, `coord/dispatch.ts` and `coord/routes.ts` that matches `CCD_ARGV\.(wsArchive|wsRestore|wsHold|wsRelease|wsRename|wsReclaim)\(`, comments included. No comment this task writes may spell `CCD_ARGV.`.
  - `dispatch-hold-order.test.ts` takes the FIRST `'/clear'` (single-quoted) in `dispatch.ts`, which must come after `const holdArgv =`. The gate's comment never spells `/clear`.
  - `child-reclaim-generation.test.ts` counts `childReclaimHasCoordinated(` in `close.ts` and expects exactly 1. No comment spells it.
  - `child-reclaim-close.test.ts` counts `reclaimChild(` in `routes.ts` and expects exactly 1.
  - `child-reclaim-refusals.test.ts` harvests `sendDispatchOutcome`'s `case 'childSpent':` arm up to the next `\n    case ` and reads every `word:` in it as a field. So the new `case 'bad-session'` goes right after `case 'bad-transition'` in both maps, never after `childSpent`.
  - The kebab scan reads comments too. Comments name kebab words in backticks, never in single quotes.

**Files:**
- Modify `server/src/coord/dispatch.ts`:
  - the `../../../shared/api.js` import, which gains `isRegistryId`;
  - `DispatchOutcome`, which gains `| { ok: false; kind: 'bad-session' }` right after `  | { ok: false; kind: 'unknown-run' }`;
  - the gate, placed right after `  if (!hold.ok) return hold;` and before `  // 1: PAUSE / KILL-SWITCH FIRST`.
- Modify `server/src/coord/close.ts`:
  - the `../../../shared/api.js` import, which gains `isRegistryId`;
  - `CloseOutcome.released`'s docstring: "All four" becomes "All five", item 5 is added, and the `AbandonSheet.tsx` sentence gains one clause;
  - `CloseOutcome`, which gains its member right after `  | { ok: false; kind: 'unknown-run' }`;
  - `abandonRefusal`'s docstring, which gains one sentence (its code is unchanged);
  - the abandon arm's R6 branch, placed between the end of `sweepGate` (`    };`) and `    // The fleet act, AHEAD of the commit`;
  - the non-abandon gate, placed between the `not-dispatched` block's closing `  }` and `  // Design 2026-09-14 §5: a REVIEW run closes`.
- Modify `server/src/coord/routes.ts`: `sendDispatchOutcome` and `sendCloseOutcome` each gain `case 'bad-session'`, placed right after their `case 'bad-transition':` arm.
- Modify `server/test/idGateFixture.ts` (Task 2's): append `storedRun` and its module-private walk table, and add the `RunState` type import (and `CoordStore` only if it is absent).
- Create `server/test/stored-row-id-gates.test.ts`.
- No edit to `store.ts`, `archiveDoor.ts`, `endDeadCoordinator.ts`, `deadCoordinator.ts`, `fingerprint.ts`, `childSpent.ts`, `shared/api.ts`, any other test file or any doc (R24 carries the skill rows to W1b).

**Interfaces:**
- Consumes:
  ```ts
  // Task 1 — shared/api.ts foot block (L0)
  export function isRegistryId(id: unknown): id is string;
  // Task 1 — server/test/registryIdCases.ts
  export const REFUSED_IDS: readonly string[];   // the eight REDIRECT_IDS, then '.hidden' and 'x'.repeat(256)
  // Task 2 — server/test/idGateFixture.ts
  export function seedRow(home: string, id: string, fields?: Record<string, string>): void;
  export function recorder(cfg?: { fail?: ReadonlySet<string> }): { run: Runner; calls: string[][] };
  export function appFor(home: string, run: Runner, over?: Partial<Omit<Deps, 'cfg'>>):
    Promise<{ app: FastifyInstance; coord: CoordStore; cfg: CcrcConfig }>;
  // Existing at 837a099c0, located by content
  closeRun(deps: CloseRunDeps, id: number, body: unknown, causedBy: 'coordinator' | 'operator'): Promise<CloseOutcome>;
  closeRun(deps: CloseRunDeps, id: number, body: unknown, causedBy: 'sweep', sweep: SweepCloseGuard): Promise<CloseOutcome>;
  abandonRefusal(coord: CoordStore, id: number): Extract<CloseOutcome, { ok: false }> | null;   // close.ts
  dispatchRun(deps: DispatchRunDeps, id: number, brief: unknown, items: unknown, route?: unknown): Promise<DispatchOutcome>;
  CoordStore.closeRun(input: { runId; finalState; causedBy; handoffCommit; program; viaClosing; expectClaimedBy? }): AdvanceResult;
  CoordStore.recordRunEvent(runId: number, causedBy: string, detail: string, at?: number): void;
  CoordStore.openRun(input) / setSession(runId, sessionId) / markDispatched(runId, sessionId, workspace, branch, resumed) / advance(runId, to, causedBy);
  decideArchive(port: ArchiveCoordPort | null, id: string, flags: ArchiveFlags, m: ArchiveMeasure): Promise<ArchiveDecision>;
  registerCoordRoutes(app, deps: Deps, bus: Bus, sessionAuth?, askDeps: AskDeps, watcher?): CoordRoutesHandle;  // .withAbandon
  ```
- Produces:
  ```ts
  // server/src/coord/dispatch.ts
  export type DispatchOutcome = /* …today's members… */ | { ok: false; kind: 'bad-session' };
  // server/src/coord/close.ts
  export type CloseOutcome    = /* …today's members… */ | { ok: false; kind: 'bad-session' };
  // closeRun's abandon arm, a stored sessionId failing isRegistryId (R6, R27): the sweep gate, the store's close, then
  //   coord.recordRunEvent(id, causedBy, 'fleet-act-omitted:bad-session'), answering the literal
  //   { ok: true, id, state: 'failed', released: false, childReclaim: 'not-queued', childReclaimWhy: 'marker-unreadable' }
  // server/src/coord/routes.ts: both maps answer 409 { ok: false, error: 'bad-session' }
  // server/test/idGateFixture.ts
  export function storedRun(coord: CoordStore, r: { state: RunState; sessionId: string | null; claimedBy: string;
    kind?: 'work' | 'review'; reviews?: number }): number;
  ```

- [ ] **Step 0: Measure the entry conditions (nothing is written)**

Run from the workspace root:

```bash
grep -n "^export function isRegistryId(id: unknown): id is string" shared/api.ts      # Task 1: one line, in the foot block
grep -n "^export const REFUSED_IDS" server/test/registryIdCases.ts                     # Task 1: one line
grep -n "^export function seedRow\|^export function recorder\|^export async function appFor\|^export function appFor" server/test/idGateFixture.ts   # Task 2: three lines
grep -n "^import" server/test/idGateFixture.ts                                         # record it: does it import CoordStore? RunState?
grep -n "calls.push\|fail?.has\|buildServer(" server/test/idGateFixture.ts              # recorder pushes args, fails by args[0]; appFor spreads ...over last
grep -c "storedRun" server/test/idGateFixture.ts                                       # 0
grep -c "const hold = holdReasonVerdict(run.program, run.wave, run.waveOf, run.id);" server/src/coord/dispatch.ts   # (c12) 1
grep -c "  if (!hold.ok) return hold;" server/src/coord/dispatch.ts                    # 1
grep -c "if (run.kind === 'review') return closeReviewRun(" server/src/coord/close.ts   # (c13) 1
grep -c "return fresh.run.claimedBy === g.claimedBy" server/src/coord/close.ts          # 1: the sweep gate the R6 branch follows
grep -c "isRegistryId" server/src/coord/close.ts server/src/coord/dispatch.ts server/src/coord/routes.ts   # 0 each
grep -c "CCD_ARGV\." server/src/coord/close.ts server/src/coord/dispatch.ts server/src/coord/routes.ts   # record each: Step 4 compares close.ts against this base (7 at 837a099c0)
grep -n "kind: 'bad-session'" server/src/coord/*.ts                                    # nothing
grep -c "        unbound: r.unbound });" server/src/coord/routes.ts                    # 1 (the childSpent arm Step 4 (j) stays away from)
ls server/test/stored-row-id-gates.test.ts 2>/dev/null || echo "absent, as expected"
```

Expected: each line prints what its comment states.

STOP rules:
- **Task 1 or Task 2 is not on the branch** (`isRegistryId`, `REFUSED_IDS`, or any of the three fixture exports is missing): STOP with `entry-tasks-missing`.
- **A gate site is gone** ((c12), (c13) or the sweep-gate anchor counts 0): STOP with `gate-site-moved`. A count that only moved lines is not a STOP: re-point by content.
- **`appFor` spreads `over` before its own fields.** The two box-token cases below would then answer 401. STOP with `id-gate-fixture-over-first`.
- **`seedRow` replaces the default fields instead of merging them**, so that `seedRow(home, id, { child: '3' })` would write no `.uuid`. STOP with `id-gate-fixture-seedrow-replaces`.
- **`recorder` does not record `args` and fail by `args[0]`.** The `calls` literals below assume that shape, which is `coord-abandon.test.ts`'s `makeRunner`. STOP with `id-gate-fixture-recorder-shape`.
- If run 400 or #351 has merged since Task 0 and moved `coord/routes.ts`, re-point (j) and (k) by content. That is not a STOP (R16, R30).

- [ ] **Step 1: Add `storedRun` to the shared fixture**

(a) In `server/test/idGateFixture.ts`, take Step 0's record of the import block:
- Unless the file already imports `RunState`, add this line directly below the last `import` line:
  ```ts
  import type { RunState } from '../../shared/api.js';
  ```
- `CoordStore` is already imported, because `appFor`'s return type names it. Only if Step 0 showed no `CoordStore` import, also add:
  ```ts
  import type { CoordStore } from '../src/coord/store.js';
  ```
- Never import a name a second time. Binding one name twice is TS2300.

(b) Append this block at the end of the file:

```ts
// ── Task 3 (spec §2.3): a stored run row, written through the store ─────────────────────────────────────────────

/** Where `storedRun` parks a run, by kind. `advance` is the only writer of `runs.state`, so a row is parked by walking
 *  its own machine's forward edges from `dispatched`. A review run has no `awaiting-review` and no `merging`. */
const STORED_RUN_WALK: Readonly<Record<'work' | 'review', readonly RunState[]>> = {
  work: ['dispatched', 'working', 'awaiting-review', 'merging'],
  review: ['dispatched', 'working'],
};
let storedRunPrograms = 0;

/**
 * A run row opened THROUGH THE STORE, never through `POST /api/runs`, as `coord-abandon.test.ts`'s `wedged` does. A
 * row written before any ingress check, or rebuilt from the registry, is exactly what the stored-row gates exist for,
 * so the fixture must be able to write one the route would refuse.
 *
 * Each call opens its own programme (`id-gate-<n>`), wave 1 of 2, project `demo`. One programme for all calls would
 * break two ways: `openRun` is idempotent per programme, wave and claimant while a run is `planned`, so two calls would
 * fold into one row; and it refuses a second claimant on one programme. A test that needs a second run in the SAME
 * programme opens it with `coord.openRun` itself.
 *
 * Binding: a `planned` run with a session is bound by `setSession`, a wave-N reclaim's shape. Any other state is bound
 * by `markDispatched` (workspace = the id, branch `ws/<id>`) and then walked forward. This plants no registry row:
 * `seedRow` does that.
 */
export function storedRun(coord: CoordStore, r: {
  state: RunState; sessionId: string | null; claimedBy: string; kind?: 'work' | 'review'; reviews?: number;
}): number {
  storedRunPrograms += 1;
  const opened = coord.openRun({
    program: `id-gate-${storedRunPrograms}`, title: 'id gate', project: 'demo', wave: 1, waveOf: 2,
    claimedBy: r.claimedBy,
    ...(r.kind === undefined ? {} : { kind: r.kind }),
    ...(r.reviews === undefined ? {} : { reviews: r.reviews }),
  });
  if (!('id' in opened)) throw new Error(`storedRun: openRun refused: ${JSON.stringify(opened)}`);
  const { id } = opened;
  if (r.sessionId !== null) {
    if (r.state === 'planned') coord.setSession(id, r.sessionId);
    else coord.markDispatched(id, r.sessionId, r.sessionId, `ws/${r.sessionId}`, false);
  }
  if (r.state === 'planned') return id;
  const kind = r.kind ?? 'work';
  const walk = STORED_RUN_WALK[kind];
  const stop = walk.indexOf(r.state);
  if (stop < 0) throw new Error(`storedRun: a ${kind} run cannot be parked in ${r.state}`);
  for (const to of walk.slice(0, stop + 1)) {
    const adv = coord.advance(id, to, 'coordinator');
    if (!adv.ok) throw new Error(`storedRun: could not reach ${r.state}: ${JSON.stringify(adv)}`);
  }
  return id;
}
```

- [ ] **Step 2: Write the failing tests**

Create `server/test/stored-row-id-gates.test.ts`:

```ts
// Path identity W1a, Task 3 (spec §2.3): a stored run row is re-checked where it enters an id-taking flow.
// `dispatchRun` and `closeRun` refuse a stored `sessionId` that is not a registry id before any read or argv. The
// abandon arm is the operator's door, the archive door's programme end and the dead-coordinator sweep. It closes such
// a run `failed`, with no fleet act and one run event.
//
// Every refused id has its registry row PLANTED, so registry membership cannot be what refuses: only the gate can.
// A 256-character id cannot name a file, so it alone has no row. Runs are stored through `CoordStore` (`storedRun`),
// never through `POST /api/runs`, because the rows these gates exist for predate any ingress check.
import { describe, it, expect, afterEach } from 'vitest';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import Fastify from 'fastify';
import type { FastifyInstance } from 'fastify';
import { Bus } from '../src/bus.js';
import { configDirFor } from '../src/config.js';
import { openCoordDb } from '../src/coord/db.js';
import { CoordStore } from '../src/coord/store.js';
import { abandonRefusal, closeRun, type CloseRunDeps } from '../src/coord/close.js';
import { dispatchRun, type DispatchRunDeps } from '../src/coord/dispatch.js';
import { registerCoordRoutes } from '../src/coord/routes.js';
import { decideArchive, type ArchiveMeasure } from '../src/coord/archiveDoor.js';
import type { Runner } from '../src/exec.js';
import type { FleetIO } from '../src/io.js';
import { isRegistryId } from '../../shared/api.js';
import { testDeps } from './helpers.js';
import { mkTmp } from './tmpHelpers.js';
import { okRun } from './coordReadHelpers.js';
import { REFUSED_IDS } from './registryIdCases.js';
import { appFor, recorder, seedRow, storedRun } from './idGateFixture.js';

const CLAIMED_BY = 'demo-coordinator';
const TOKEN = 'f'.repeat(64);
const HEADERS = { 'x-ccrc-mail-token': TOKEN };
const BAD = '--actor';
const TIP = 'c'.repeat(40);
/** A done claim whose two facts agree, so `verifyDone`, were it reached, would go on to measure the branch. */
const DONE_CLOSE = { fingerprint: { branchTip: TIP, prNumber: null, prPhase: 'open', handoffCommit: TIP }, final: true };
/** An ordinary close shaped like an abandon (`state:'failed'` skips `verifyDone`); `archive:true` asks for the one
 *  archive the coordination lane composes. */
const ARCHIVE_CLOSE = { fingerprint: { branchTip: TIP, prNumber: null, prPhase: 'open', handoffCommit: TIP },
  final: false, state: 'failed', archive: true };
/** The coordinator's own main checkout, idle: the archive door's measure when it ends a programme. */
const IDLE_MAIN: ArchiveMeasure = { workspace: false, turn: 'idle', worktree: 'present', verbSupported: false };
/** R6's answer, as `closeRun` returns it and as `sendCloseOutcome` sends it. */
const OMITTED = { ok: true, state: 'failed', released: false, childReclaim: 'not-queued',
  childReclaimWhy: 'marker-unreadable' } as const;
const OMITTED_EVENT = 'fleet-act-omitted:bad-session';

let app: FastifyInstance | undefined;
afterEach(async () => { if (app) await app.close(); app = undefined; });

/** Plants `id`'s registry row. `seedRow` writes one `<id>.<field>` file per field, and a 256-character id cannot name
 *  a file: a name is at most 255 bytes. So that one id is stored with no row. The gate is still the only thing that
 *  can refuse it, because no registry read comes before the gate. */
const plant = (home: string, id: string, fields?: Record<string, string>): void => {
  if (id.length <= 200) seedRow(home, id, fields);
};

/** `closeRun` and `dispatchRun` called directly, over a fixture HOME. The io counts every listing of the registry
 *  directory, which is what "before any read" is measured by. */
const direct = (home: string, run: Runner) => {
  const base = testDeps(home, run);
  mkdirSync(base.cfg.registryDir, { recursive: true });
  const coord = new CoordStore(openCoordDb(path.join(home, '.ccrc', 'coord.db')));
  let listings = 0;
  const io: FleetIO = {
    ...base.io,
    readdir: async (p: string, timeoutMs?: number, signal?: AbortSignal) => {
      if (p === base.cfg.registryDir) listings += 1;
      return base.io.readdir(p, timeoutMs, signal);
    },
  };
  const closeDeps: CloseRunDeps = { coord, io, cfg: base.cfg, runCcd: base.runCcd };
  const dispatchDeps: DispatchRunDeps = {
    coord, io, cfg: base.cfg, runCcd: base.runCcd, tmux: base.tmux, queue: base.queue,
    configDir: (w: string) => configDirFor(base.cfg, w),
  };
  return { base, coord, closeDeps, dispatchDeps, listings: (): number => listings };
};

/** A real loose ref for `ws/<sessionId>` under `<projectsRoot>/demo`. With it, `verifyDone`, were it reached, would
 *  measure the branch and go on to compose `pr-state`: the mutation rows need that call to be reachable. */
const gitRef = (projectsRoot: string, sessionId: string): void => {
  const heads = path.join(projectsRoot, 'demo', '.git', 'refs', 'heads', 'ws');
  mkdirSync(heads, { recursive: true });
  writeFileSync(path.join(heads, sessionId), `${TIP}\n`);
};

/** `recorder` answers every verb with nothing. The child case needs `pr-state` to answer a full line, so this runner
 *  records the same way (`args`, in order) and answers that one verb. */
const answeringPrState = (stdout: string): { run: Runner; calls: string[][] } => {
  const calls: string[][] = [];
  const run: Runner = async (_cmd, args) => {
    calls.push(args);
    return args[0] === 'pr-state' ? { code: 0, stdout, stderr: '' } : { code: 0, stdout: '', stderr: '' };
  };
  return { run, calls };
};

const eventsOf = (coord: CoordStore, id: number): [string, string, string, string | null][] =>
  coord.runEvents(id).map((e): [string, string, string, string | null] => [e.causedBy, e.fromState, e.toState, e.detail]);

describe('dispatchRun re-checks a stored session id before any read (spec §2.3)', () => {
  it.each([...REFUSED_IDS])('a planned run whose stored sessionId is %s refuses bad-session and composes nothing', async (sid) => {
    expect(isRegistryId(sid), 'the premise: the id fails the predicate').toBe(false);
    const home = mkTmp('ccrc-stored-id-');
    // `ensure` fails on purpose. Were the gate deleted, the resume would compose `ensure` and stop there, quickly and
    // visibly, instead of running on into the pane.
    const { run, calls } = recorder({ fail: new Set(['ensure']) });
    const d = direct(home, run);
    plant(home, sid);
    const id = storedRun(d.coord, { state: 'planned', sessionId: sid, claimedBy: CLAIMED_BY });
    expect(await dispatchRun(d.dispatchDeps, id, 'go', undefined)).toEqual({ ok: false, kind: 'bad-session' });
    expect(calls).toEqual([]);
    expect(okRun(d.coord.run(id))!.state).toBe('planned');
    expect(d.listings(), 'the pause marker was never listed: the gate stands before every read').toBe(0);
  });

  it('POST /api/runs/:id/dispatch answers 409 bad-session', async () => {
    const home = mkTmp('ccrc-stored-id-');
    const { run, calls } = recorder({ fail: new Set(['ensure']) });
    const w = await appFor(home, run, { mailToken: TOKEN }); app = w.app;
    plant(home, BAD);
    const id = storedRun(w.coord, { state: 'planned', sessionId: BAD, claimedBy: CLAIMED_BY });
    const res = await w.app.inject({ method: 'POST', url: `/api/runs/${id}/dispatch`, headers: HEADERS,
      payload: { brief: 'go' } });
    expect(res.statusCode).toBe(409);
    expect(res.json()).toEqual({ ok: false, error: 'bad-session' });
    expect(calls).toEqual([]);
    expect(okRun(w.coord.run(id))!.state).toBe('planned');
  });

  it('control: a planned run on a--actor resumes', async () => {
    const home = mkTmp('ccrc-stored-id-');
    const { run, calls } = recorder({ fail: new Set(['ensure']) });
    const d = direct(home, run);
    plant(home, 'a--actor');
    const id = storedRun(d.coord, { state: 'planned', sessionId: 'a--actor', claimedBy: CLAIMED_BY });
    // An inner `--` is a registry id: the resume composes `ensure a--actor`, and the fixture's failing `ensure`
    // stops it there.
    expect(await dispatchRun(d.dispatchDeps, id, 'go', undefined)).toMatchObject({ ok: false, kind: 'fleetFailed' });
    expect(calls).toEqual([['ensure', 'a--actor']]);
  });
});

describe('closeRun refuses a stored bad id on every arm but abandon (spec §2.3)', () => {
  it('a coordinator close of a dispatched --actor run answers bad-session', async () => {
    const home = mkTmp('ccrc-stored-id-');
    const { run, calls } = recorder();
    const d = direct(home, run);
    plant(home, BAD, { branch: `ws/${BAD}` });
    gitRef(d.base.cfg.projectsRoot, BAD);
    const id = storedRun(d.coord, { state: 'dispatched', sessionId: BAD, claimedBy: CLAIMED_BY });
    expect(await closeRun(d.closeDeps, id, DONE_CLOSE, 'coordinator')).toEqual({ ok: false, kind: 'bad-session' });
    expect(calls, 'no pr-state, no hold, no release').toEqual([]);
    expect(d.coord.rejections(), 'no rejection is recorded against the id').toEqual([]);
    expect(d.coord.mailForRecipient(BAD), 'no rejection mail is queued to the id').toEqual([]);
    expect(okRun(d.coord.run(id))!.state).toBe('dispatched');
  });

  it('a coordinator close of a --actor child run, its child row and minting row planted, composes no pr-state from child-spent', async () => {
    // Spec §7 item 23. Built so that, were the gate gone, child-spent's own `pr-state` would be reached:
    // - `verifyDone` passes, on a real ref and a full pr-state line;
    // - but the line names ANOTHER session, so the child gate cannot reuse it and fetches afresh;
    // - and a wave-2 run keeps the programme open, so this non-final close is not finished without a spent verdict.
    const foreign = JSON.stringify({ id: 'demo-other', rows: [{ number: 42, state: 'OPEN', headRefName: `ws/${BAD}`,
      baseRefName: 'main', isCrossRepository: false, ours: true, isDraft: false }], baseShort: 'main',
      branch: `ws/${BAD}`, ahead: 1, tip: TIP, checkedAt: 1 });
    const home = mkTmp('ccrc-stored-id-');
    const { run, calls } = answeringPrState(`${foreign}\n`);
    const d = direct(home, run);
    gitRef(d.base.cfg.projectsRoot, BAD);
    const id = storedRun(d.coord, { state: 'dispatched', sessionId: BAD, claimedBy: CLAIMED_BY });
    // The minting row is this run: its marker names it.
    plant(home, BAD, { branch: `ws/${BAD}`, child: String(id) });
    const program = okRun(d.coord.run(id))!.program;
    const next = d.coord.openRun({ program, title: 'id gate', project: 'demo', wave: 2, waveOf: 2, claimedBy: CLAIMED_BY });
    if (!('id' in next)) throw new Error(`the wave-2 run was refused: ${JSON.stringify(next)}`);
    const out = await closeRun(d.closeDeps, id,
      { fingerprint: { branchTip: TIP, prNumber: null, prPhase: 'open', handoffCommit: TIP }, final: false }, 'coordinator');
    expect(out).toEqual({ ok: false, kind: 'bad-session' });
    expect(calls, 'neither verifyDone nor child-spent composed pr-state').toEqual([]);
    expect(d.coord.rejections()).toEqual([]);
    expect(okRun(d.coord.run(id))!.state).toBe('dispatched');
  });

  it('a failed close with archive:true composes no ws-archive', async () => {
    const home = mkTmp('ccrc-stored-id-');
    const { run, calls } = recorder();
    const d = direct(home, run);
    plant(home, BAD);
    const id = storedRun(d.coord, { state: 'working', sessionId: BAD, claimedBy: CLAIMED_BY });
    expect(await closeRun(d.closeDeps, id, ARCHIVE_CLOSE, 'coordinator')).toEqual({ ok: false, kind: 'bad-session' });
    expect(calls).toEqual([]);
    expect(okRun(d.coord.run(id))!.state).toBe('working');
  });

  it('a review run whose stored sessionId is --actor answers bad-session with no ws-hold or ws-release', async () => {
    const home = mkTmp('ccrc-stored-id-');
    const { run, calls } = recorder();
    const d = direct(home, run);
    plant(home, BAD);
    const work = storedRun(d.coord, { state: 'working', sessionId: 'demo-worker', claimedBy: CLAIMED_BY });
    const review = storedRun(d.coord,
      { state: 'working', sessionId: BAD, claimedBy: CLAIMED_BY, kind: 'review', reviews: work });
    // `state:'failed'` (the reviewer died): no claim to re-measure, so only the gate stands before the release.
    expect(await closeRun(d.closeDeps, review, { state: 'failed' }, 'coordinator')).toEqual({ ok: false, kind: 'bad-session' });
    expect(calls).toEqual([]);
    expect(okRun(d.coord.run(review))!.state).toBe('working');
  });

  it('POST /api/runs/:id/close answers 409 bad-session', async () => {
    const home = mkTmp('ccrc-stored-id-');
    const { run, calls } = recorder();
    const w = await appFor(home, run, { mailToken: TOKEN }); app = w.app;
    plant(home, BAD);
    const id = storedRun(w.coord, { state: 'working', sessionId: BAD, claimedBy: CLAIMED_BY });
    const res = await w.app.inject({ method: 'POST', url: `/api/runs/${id}/close`, headers: HEADERS, payload: DONE_CLOSE });
    expect(res.statusCode).toBe(409);
    expect(res.json()).toEqual({ ok: false, error: 'bad-session' });
    expect(calls).toEqual([]);
    expect(okRun(w.coord.run(id))!.state).toBe('working');
  });
});

describe('the abandon arm closes a bad stored id failed with no fleet act (spec §2.3)', () => {
  it('the operator abandon of a working --actor run', async () => {
    const home = mkTmp('ccrc-stored-id-');
    const { run, calls } = recorder();
    const w = await appFor(home, run); app = w.app;
    plant(home, BAD);
    const id = storedRun(w.coord, { state: 'working', sessionId: BAD, claimedBy: CLAIMED_BY });
    const res = await w.app.inject({ method: 'POST', url: `/api/runs/${id}/abandon` });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ...OMITTED, id });
    expect(calls, 'no release and no hold: nothing names the id').toEqual([]);
    expect(okRun(w.coord.run(id))!.state).toBe('failed');
    expect(eventsOf(w.coord, id).filter(([by]) => by === 'operator')).toEqual([
      ['operator', 'working', 'closing', null],
      ['operator', 'closing', 'failed', null],
      ['operator', 'failed', 'failed', OMITTED_EVENT],
    ]);
  });

  it('the dead-coordinator sweep\'s abandon re-measures its claimant, then closes failed with no fleet act', async () => {
    const home = mkTmp('ccrc-stored-id-');
    const { run, calls } = recorder();
    const d = direct(home, run);
    plant(home, BAD);
    const id = storedRun(d.coord, { state: 'working', sessionId: BAD, claimedBy: CLAIMED_BY });
    let asked = 0;
    const out = await closeRun(d.closeDeps, id, { intent: 'abandon' }, 'sweep',
      { claimedBy: CLAIMED_BY, stillCrashed: async () => { asked += 1; return null; } });
    expect(out).toEqual({ ...OMITTED, id });
    expect(asked, 'the claimant is re-measured once, before the close').toBe(1);
    expect(calls).toEqual([]);
    expect(eventsOf(d.coord, id).filter(([, , , detail]) => detail === OMITTED_EVENT))
      .toEqual([['sweep', 'failed', 'failed', OMITTED_EVENT]]);
  });

  it('a sweep whose claimant revived answers sweep-stopped with no fleet act', async () => {
    const home = mkTmp('ccrc-stored-id-');
    const { run, calls } = recorder();
    const d = direct(home, run);
    plant(home, BAD);
    const id = storedRun(d.coord, { state: 'working', sessionId: BAD, claimedBy: CLAIMED_BY });
    const stop = { kind: 'remeasured', why: 're-measured alive' } as const;
    const out = await closeRun(d.closeDeps, id, { intent: 'abandon' }, 'sweep',
      { claimedBy: CLAIMED_BY, stillCrashed: async () => stop });
    expect(out).toEqual({ ok: false, kind: 'sweep-stopped', stop, fleetAct: null });
    expect(calls).toEqual([]);
    expect(okRun(d.coord.run(id))!.state).toBe('working');
    expect(eventsOf(d.coord, id).filter(([, , , detail]) => detail === OMITTED_EVENT)).toEqual([]);
  });

  it('the archive door\'s programme end over a --actor run and a valid run ends both', async () => {
    const home = mkTmp('ccrc-stored-id-');
    const { run, calls } = recorder();
    const d = direct(home, run);
    plant(home, BAD);
    plant(home, 'demo-valid');
    const bad = storedRun(d.coord, { state: 'working', sessionId: BAD, claimedBy: CLAIMED_BY });
    const good = storedRun(d.coord, { state: 'working', sessionId: 'demo-valid', claimedBy: CLAIMED_BY });
    expect(abandonRefusal(d.coord, bad), 'the pre-read refuses nothing new for a bad stored id').toBeNull();
    // The door as `server.ts` wires it: the coordination serialiser's own abandon and pre-read, inside its hold.
    const handle = registerCoordRoutes(Fastify({ logger: false }), { ...d.base, coord: d.coord }, new Bus(), undefined,
      { tmux: d.base.tmux, queue: d.base.queue, readAsk: async () => null });
    const plan = await handle.withAbandon(d.coord, (abandon, refusalOf) => decideArchive({
      openRunsForSession: (sid) => d.coord.openRunsForSession(sid),
      openRunsClaimedBy: (sid) => d.coord.openRunsClaimedBy(sid),
      abandonRefusal: refusalOf,
      abandon,
    }, CLAIMED_BY, { force: false, interrupt: false, programmeEnd: true }, IDLE_MAIN));
    if (!plan.ok) throw new Error(`the door refused: ${JSON.stringify(plan.reply)}`);
    expect(plan.ended.map((r) => r.id), 'no programme-partly-ended: both runs ended').toEqual([bad, good]);
    expect(okRun(d.coord.run(bad))!.state).toBe('failed');
    expect(okRun(d.coord.run(good))!.state).toBe('failed');
    expect(calls, 'only the valid run\'s workspace is released').toEqual([['ws-release', '--session', 'demo-valid']]);
    expect(eventsOf(d.coord, bad).filter(([, , , detail]) => detail === OMITTED_EVENT)).toHaveLength(1);
    expect(eventsOf(d.coord, good).filter(([, , , detail]) => detail === OMITTED_EVENT)).toEqual([]);
  });

  it('control: a valid id\'s abandon still releases', async () => {
    const home = mkTmp('ccrc-stored-id-');
    const { run, calls } = recorder();
    const d = direct(home, run);
    plant(home, 'demo-valid');
    const id = storedRun(d.coord, { state: 'working', sessionId: 'demo-valid', claimedBy: CLAIMED_BY });
    expect(await closeRun(d.closeDeps, id, { intent: 'abandon' }, 'operator')).toEqual(
      { ok: true, id, state: 'failed', released: true, childReclaim: 'not-queued', childReclaimWhy: 'not-a-child' });
    expect(calls).toEqual([['ws-release', '--session', 'demo-valid']]);
    expect(eventsOf(d.coord, id).filter(([, , , detail]) => detail === OMITTED_EVENT)).toEqual([]);
  });
});
```

- [ ] **Step 3: Run the tests to verify they fail**

```bash
cd server && ./node_modules/.bin/vitest run test/stored-row-id-gates.test.ts
```

Run it in the foreground, with a timeout of at least 600000 ms.

Expected: `Tests  19 failed | 3 passed (22)`.
- Three cases pass, for reasons that are already true at the base:
  - the dispatch control;
  - the valid-abandon control;
  - "a sweep whose claimant revived…", because today's arm already runs the sweep gate before its fleet act.
- The reds:
  - The ten `%s` dispatch cases: `expected { ok: false, kind: 'fleetFailed', … } to deeply equal { ok: false, kind: 'bad-session' }`.
  - The dispatch route case: `expected 502 to be 409`.
  - The dispatched close: `expected { ok: false, kind: 'doneVerdict', code: 'pr-unmeasurable', … } to deeply equal …`.
  - The child case: `expected { ok: true, … childReclaimWhy: 'not-finished-unmeasured' } …`.
  - The archive and review cases: an `ok: true` outcome.
  - The close route case: the body `{ ok: false, error: 'tip-unmeasurable', … }`.
  - The operator abandon: `released: true` and `childReclaimWhy: 'not-a-child'`.
  - The sweep re-measure case: `released: true`.
  - The programme end: `calls` also holds `[ 'ws-release', '--session', '--actor' ]`.
- A load error naming `storedRun` means Step 1 did not land. A load error naming `registryIdCases.js` or `idGateFixture.js` means Task 1 or 2 is missing: STOP (Step 0).

- [ ] **Step 4: Implement**

(a) `server/src/coord/dispatch.ts`, the L0 import. Replace:

```ts
import {
  MAIL_BODY_MAX_BYTES, SPAWN_NOT_RECORDED, WORK_ITEM_MAX, WORK_ITEM_TITLE_MAX, armEventDetail, parseRouteFields,
  routeFieldsOrNull, routeParseDetail, spawnVerdict, transitionsFor,
```

with:

```ts
import {
  MAIL_BODY_MAX_BYTES, SPAWN_NOT_RECORDED, WORK_ITEM_MAX, WORK_ITEM_TITLE_MAX, armEventDetail, isRegistryId,
  parseRouteFields, routeFieldsOrNull, routeParseDetail, spawnVerdict, transitionsFor,
```

(b) `server/src/coord/dispatch.ts`, `DispatchOutcome`. Replace:

```ts
  | { ok: false; kind: 'unknown-run' }
  | { ok: false; kind: 'bad-transition'; from: RunState; to: RunState }
  /** `detail` is PRESENT only for the malformed-`route` refusal (routing spec
```

with:

```ts
  | { ok: false; kind: 'unknown-run' }
  /** Spec §2.3: the run's STORED `sessionId` is not a registry id, so no id-taking argv may name it. That rules out
   *  the resume's `ensure`, the spent-child release or hand-over, the hold and the route write. It is refused before
   *  the pause listing, and the run stays `planned`. This is a stored defect, not a transient: a retry cannot change
   *  it, and `POST /api/runs/:id/abandon` closes such a run with no fleet act. */
  | { ok: false; kind: 'bad-session' }
  | { ok: false; kind: 'bad-transition'; from: RunState; to: RunState }
  /** `detail` is PRESENT only for the malformed-`route` refusal (routing spec
```

(c) `server/src/coord/dispatch.ts`, the gate. Replace:

```ts
  const hold = holdReasonVerdict(run.program, run.wave, run.waveOf, run.id);
  if (!hold.ok) return hold;

  // 1: PAUSE / KILL-SWITCH FIRST, before anything is counted or spawned. A
```

with:

```ts
  const hold = holdReasonVerdict(run.program, run.wave, run.waveOf, run.id);
  if (!hold.ok) return hold;
  // The stored SESSION ID, re-checked here for the hold's reason (spec §2.3). A row written before any ingress check,
  // or rebuilt from the registry, reaches this seam unchecked, and every id-taking call below takes this column: the
  // resume's `ensure`, the spent-child release or hand-over, the hold and the route write. The check runs after the
  // body checks and before the pause listing, so a refused id costs no read and composes nothing. A resume refuses
  // here rather than holding, and the run stays `planned`; the abandon is its door.
  if (run.sessionId !== null && !isRegistryId(run.sessionId)) return { ok: false, kind: 'bad-session' };

  // 1: PAUSE / KILL-SWITCH FIRST, before anything is counted or spawned. A
```

(d) `server/src/coord/close.ts`, the L0 import. Replace:

```ts
import {
  transitionsFor, type ChildMark, type DoneRejectCode, type RunRefuseCode, type RunState,
} from '../../../shared/api.js';
```

with:

```ts
import {
  isRegistryId, transitionsFor, type ChildMark, type DoneRejectCode, type RunRefuseCode, type RunState,
} from '../../../shared/api.js';
```

(e) `server/src/coord/close.ts`, `CloseOutcome.released`'s docstring, first of two edits. Replace:

```ts
       *  that renders a single sentence from it alone will be wrong. All four
       *  ways to get it, so nobody has to rediscover them (review finding,
```

with:

```ts
       *  that renders a single sentence from it alone will be wrong. All five
       *  ways to get it, so nobody has to rediscover them (review finding,
```

Then replace:

```ts
       *    4. an ABANDON of a `planned` run with `sessionId === null`: NO
       *       fleet act at all, and no workspace to claim. Nothing happened.
       *  A client that wants a sentence must branch on `state`/`archive` and
       *  on whether the run had a session — `pwa/src/fleet/AbandonSheet.tsx`
       *  does exactly that, and only speaks for case (1). */
```

with:

```ts
       *    4. an ABANDON of a `planned` run with `sessionId === null`: NO
       *       fleet act at all, and no workspace to claim. Nothing happened.
       *    5. an ABANDON of a run whose stored `sessionId` is not a registry
       *       id: NO fleet act, the same as (4), but the run HAD a session id
       *       (spec §2.3). One `fleet-act-omitted:bad-session` run event
       *       records it.
       *  A client that wants a sentence must branch on `state`/`archive` and
       *  on whether the run had a session — `pwa/src/fleet/AbandonSheet.tsx`
       *  does exactly that, and only speaks for case (1). It cannot yet tell
       *  (5) from (1), and would read (5) as a hand-over. */
```

(f) `server/src/coord/close.ts`, `CloseOutcome`'s member. Replace:

```ts
  | { ok: false; kind: 'unknown-run' }
  | { ok: false; kind: 'bad-transition'; from: RunState; to: RunState }
  | { ok: false; kind: 'bad-request' }
```

with:

```ts
  | { ok: false; kind: 'unknown-run' }
  /** Spec §2.3: the run's STORED `sessionId` is not a registry id. Every close but the abandon refuses it, review
   *  closes included, before any read or argv names it. The abandon arm closes such a run `failed` with no fleet act
   *  instead (`released`, case 5). */
  | { ok: false; kind: 'bad-session' }
  | { ok: false; kind: 'bad-transition'; from: RunState; to: RunState }
  | { ok: false; kind: 'bad-request' }
```

(g) `server/src/coord/close.ts`, `abandonRefusal`'s docstring. Replace:

```ts
 * What only the act measures — the sibling read, a hand-over hold, the verb, ccd's own answer — can still refuse after
 * an earlier run was ended, and the door says which runs it ended (`programme-partly-ended`).
 */
export function abandonRefusal(coord: CoordStore, id: number): Extract<CloseOutcome, { ok: false }> | null {
```

with:

```ts
 * What only the act measures — the sibling read, a hand-over hold, the verb, ccd's own answer — can still refuse after
 * an earlier run was ended, and the door says which runs it ended (`programme-partly-ended`).
 * A run whose stored `sessionId` is not a registry id is not refused here, and the arm does not refuse it either: the
 * arm closes it `failed` with no fleet act (spec §2.3), so the door ends such a programme whole.
 */
export function abandonRefusal(coord: CoordStore, id: number): Extract<CloseOutcome, { ok: false }> | null {
```

(h) `server/src/coord/close.ts`, the abandon arm's R6 branch. Replace:

```ts
      return fresh.run.claimedBy === g.claimedBy ? null : { ok: false, kind: 'claimant-changed', claimedBy: fresh.run.claimedBy };
    };
    // The fleet act, AHEAD of the commit (D-48), and only when there is
```

with:

```ts
      return fresh.run.claimedBy === g.claimedBy ? null : { ok: false, kind: 'claimant-changed', claimedBy: fresh.run.claimedBy };
    };
    // SPEC §2.3: A STORED ID NO VERB MAY NAME. A `sessionId` that is not a registry id can be named by no id-taking
    // argv, so this arm takes no fleet act for it: no sibling read, no child gate, no hold and no release.
    //
    // It still CLOSES the run. This arm is the release valve of three doors: the operator's abandon, the archive
    // door's programme end and the dead-coordinator sweep. A coordinator's own `POST /api/runs/:id/close` whose body
    // is `{ intent: 'abandon' }` reaches this arm too, and closes such a run the same way. A valve that refused would
    // leave such a run holding its slot for good.
    //
    // The order: the sweep's gate runs first, as it does before any act; then the store's close, with the sweep's
    // compare-and-set; and only once that commits, ONE run event, so the trail tells this close from an ordinary
    // `failed`.
    //
    // The answer is spelled here rather than through the child hand-off. That path would say `not-a-child`, which
    // nobody measured; `marker-unreadable` says the child question was never asked. `abandonRefusal` refuses nothing
    // new for such a run, so the archive door ends such a programme whole.
    if (run.sessionId !== null && !isRegistryId(run.sessionId)) {
      if (sweep !== undefined) {
        const gate = await sweepGate(sweep);
        if (gate !== null) return gate;
      }
      const omitted = coord.closeRun({
        runId: id, finalState: 'failed', causedBy, handoffCommit: null,
        program: run.program, viaClosing: target === 'closing',
        ...(sweep === undefined ? {} : { expectClaimedBy: sweep.claimedBy }),
      });
      if (!omitted.ok) {
        return omitted.error === 'claimant-changed' ? { ok: false, kind: 'claimant-changed', claimedBy: omitted.claimedBy }
          : { ok: false, kind: 'advanceFailed', adv: omitted };
      }
      coord.recordRunEvent(id, causedBy, 'fleet-act-omitted:bad-session');
      return { ok: true, id, state: 'failed', released: false,
        childReclaim: 'not-queued', childReclaimWhy: 'marker-unreadable' };
    }
    // The fleet act, AHEAD of the commit (D-48), and only when there is
```

(i) `server/src/coord/close.ts`, the non-abandon gate. Replace:

```ts
    return { ok: false, kind: 'refused', code: 'not-dispatched' };
  }
  // Design 2026-09-14 §5: a REVIEW run closes on its own claim, with no
```

with:

```ts
    return { ok: false, kind: 'refused', code: 'not-dispatched' };
  }
  // Spec §2.3: a stored `sessionId` that is not a registry id refuses every close but the abandon above, this work
  // close and the review close below alike. The refusal comes before `verifyDone`, the child gate, the PR ledger, or
  // any hold, release or archive can name the id, and before any rejection is recorded against it or mailed to it.
  // It is a stored defect, not a transient: the run is left exactly as it was, and the abandon is its door.
  if (!isRegistryId(run.sessionId)) return { ok: false, kind: 'bad-session' };
  // Design 2026-09-14 §5: a REVIEW run closes on its own claim, with no
```

(j) `server/src/coord/routes.ts`, `sendDispatchOutcome`. The new arm sits right after `bad-transition`, never after `childSpent` (see the `child-reclaim-refusals` trap). Replace:

```ts
    case 'bad-transition':
      return reply.code(409).send({ ok: false, error: 'bad-transition', from: r.from, to: r.to });
    // `detail` spread, not `detail: r.detail`: an L4 adapter may not narrow a
```

with:

```ts
    case 'bad-transition':
      return reply.code(409).send({ ok: false, error: 'bad-transition', from: r.from, to: r.to });
    // Spec §2.3, a stored defect: the run's session id is not a registry id, and nothing was read or composed.
    case 'bad-session': return reply.code(409).send({ ok: false, error: 'bad-session' });
    // `detail` spread, not `detail: r.detail`: an L4 adapter may not narrow a
```

(k) `server/src/coord/routes.ts`, `sendCloseOutcome`. Replace:

```ts
    case 'bad-transition':
      return reply.code(409).send({ ok: false, error: 'bad-transition', from: r.from, to: r.to });
    case 'bad-request': return reply.code(400).send({ ok: false, error: 'bad-request' });
    case 'refused': return reply.code(409).send({ ok: false, refused: r.code });
```

with:

```ts
    case 'bad-transition':
      return reply.code(409).send({ ok: false, error: 'bad-transition', from: r.from, to: r.to });
    // Spec §2.3, a stored defect: every close but the abandon refuses it, and nothing was read or composed.
    case 'bad-session': return reply.code(409).send({ ok: false, error: 'bad-session' });
    case 'bad-request': return reply.code(400).send({ ok: false, error: 'bad-request' });
    case 'refused': return reply.code(409).send({ ok: false, refused: r.code });
```

Then run these checks:

```bash
git diff --stat   # five files: server/src/coord/{dispatch,close,routes}.ts, server/test/idGateFixture.ts, and the new test file is untracked
grep -c "CCD_ARGV\." server/src/coord/close.ts      # unchanged from Step 0's base count (no comment spells it)
grep -c "childReclaimHasCoordinated(" server/src/coord/close.ts   # 1
grep -c "reclaimChild(" server/src/coord/routes.ts               # 1
grep -c "isRegistryId" server/src/coord/dispatch.ts server/src/coord/close.ts   # dispatch 2 (import, gate); close 3 (import, two gates)
```

- [ ] **Step 5: Run the tests to verify they pass**

```bash
cd server && ./node_modules/.bin/vitest run test/stored-row-id-gates.test.ts
cd server && ./node_modules/.bin/vitest run test/coord-abandon.test.ts test/dispatch-route.test.ts test/run-routes.test.ts test/child-reclaim-close.test.ts
cd server && ./node_modules/.bin/vitest run test/archive-door.test.ts test/archive-door-decide.test.ts test/dead-coordinator-lane.test.ts test/end-dead-coordinator.test.ts
cd server && ./node_modules/.bin/vitest run test/mail-routes.test.ts test/unattended-actor.test.ts test/verb-gate.test.ts
cd server && ./node_modules/.bin/vitest run test/sweep-close.test.ts test/dispatch-hold-order.test.ts test/child-reclaim-refusals.test.ts test/child-reclaim-generation.test.ts test/knownid-registry-id.test.ts
```

Run each line in the foreground, with a timeout of at least 600000 ms.

Expected: every file PASSES, and the first line reads `Tests  22 passed (22)`.
- Re-run a CLAUDE.md load flake in isolation before calling it a break.
- Each trap from **Why** has its own red:
  - A `CCD_ARGV.` in a new comment reds `unattended-actor`: `the unattended call-site count drifted from SITES.length (15)`.
  - A `'/clear'` spelled above the hold reds `dispatch-hold-order`.
  - The dispatch arm placed after `childSpent` reds `child-reclaim-refusals`, with a field word harvested out of the comment.
  - A single-quoted kebab word in a comment reds `mail-routes`' scan.
- An existing suite may red because its fixture STORES a session id that fails the predicate (a space, a slash, a leading `-` or `.`). Then the gate is right and the fixture predates it. STOP and report `stored-fixture-id-fails-the-predicate` with the file and the title. Do not loosen the gate.

- [ ] **Step 6: Mutation check**

Make each edit, run it, see the red, and revert before the next. Record each before/after in the SDD ledger. The commands run from `server/`; S is `./node_modules/.bin/vitest run test/stored-row-id-gates.test.ts`. The worker measures every red text. Where the measured text differs from the draft's, the measured text replaces it.

| # | Mutation (exact edit) | Command | Expected red |
|---|---|---|---|
| 1 | `dispatch.ts`: delete `if (run.sessionId !== null && !isRegistryId(run.sessionId)) return { ok: false, kind: 'bad-session' };` | `S -t 'dispatchRun re-checks'` | All ten `%s` cases: `expected { ok: false, kind: 'fleetFailed', … } to deeply equal { ok: false, kind: 'bad-session' }`, because `ensure <id>` was composed. The route case: `expected 502 to be 409`. After Task 4 the planted-row cases answer `childSpent`/`spent-unmeasured` instead, which is still red on the kind. |
| 2 | `dispatch.ts`: move that line below the `mail-disabled` block (after `if (names.includes(MAIL_DISABLED_MARKER)) { … }`) | `S -t 'composes nothing'` | `the pause marker was never listed: the gate stands before every read: expected 1 to be 0` |
| 3 | `close.ts`: delete `if (!isRegistryId(run.sessionId)) return { ok: false, kind: 'bad-session' };` | `S -t 'closeRun refuses'` | See the list below this table. |
| 4 | `close.ts`: move that line below `if (run.kind === 'review') return closeReviewRun(…);` | `S -t 'review run whose stored'` | `expected { ok: true, … released: true … } to deeply equal { ok: false, kind: 'bad-session' }` |
| 5 | `close.ts`: delete the whole R6 block (`if (run.sessionId !== null && !isRegistryId(run.sessionId)) { … }` in the abandon arm) | `S -t 'abandon arm'` | Operator case: `expected { …, released: true, childReclaim: 'not-queued', childReclaimWhy: 'not-a-child' } to deeply equal { …, released: false, …, childReclaimWhy: 'marker-unreadable' }`, with `[ 'ws-release', '--session', '--actor' ]` composed. Programme end: `calls` also holds that release. |
| 6 | `close.ts`: make the R6 block's body `return { ok: false, kind: 'bad-session' };` | `S -t 'operator abandon'`, then `S -t 'programme end'` (two runs: a bare pipe cannot sit in this table, and `\|` is a literal pipe to vitest) | Operator case: `expected 409 to be 200`. Programme end: `the door refused: {"status":409,"body":{"ok":false,"error":"programme-partly-ended",…` |
| 7 | `close.ts`: make the R6 block's return `return { ok: true, id, state: 'failed', released: false, ...handOffChildReclaim(deps, NO_CHILD_GATE) };` | `S -t 'operator abandon'` | `childReclaimWhy: 'not-a-child'` where `'marker-unreadable'` is expected |
| 8 | `close.ts`: delete `coord.recordRunEvent(id, causedBy, 'fleet-act-omitted:bad-session');` | `S -t 'abandon arm'` | Operator case: the event list lacks its third row. Sweep case: `expected [] to deeply equal [ [ 'sweep', 'failed', 'failed', 'fleet-act-omitted:bad-session' ] ]`. Programme end: `expected [] to have a length of 1`. |
| 9 | `close.ts`: delete the R6 block's `if (sweep !== undefined) { … }` | `S -t 'sweep'` | Revived case: `expected { ok: true, … state: 'failed' … } to deeply equal { ok: false, kind: 'sweep-stopped', … }`. Re-measure case: `the claimant is re-measured once, before the close: expected 0 to be 1`. |
| 10 | `routes.ts`: delete either `case 'bad-session': …` arm | `./node_modules/.bin/tsc --noEmit -p .` | `error TS2322: Type '{ ok: false; kind: "bad-session"; }' is not assignable to type 'never'.` at that map's `const _exhaustive: never = r;` |

Row 3's expected reds, case by case:
- **The dispatched case:** `expected { ok: false, kind: 'doneVerdict', code: 'pr-unmeasurable', … } to deeply equal { ok: false, kind: 'bad-session' }`, with `pr-state --session --actor` composed and a rejection recorded.
- **The child case:** `expected { ok: true, … childReclaimWhy: 'not-finished-unmeasured' } …`. The calls are two `pr-state --session --actor` (the second is child-spent's) and then a `ws-hold`.
- **The archive case:** `ws-archive --session --actor` is composed.
- **The review case:** `ws-release --session --actor` is composed.
- **The route case:** `error: 'tip-unmeasurable'`.
- **After Task 6:** fingerprint's own check answers `tip-unmeasurable` first, with a rejection and mail queued to `--actor`. That is still red.

- [ ] **Step 7: Typecheck**

```bash
cd server && ./node_modules/.bin/tsc --noEmit -p . && ./node_modules/.bin/tsc --noEmit -p test/tsconfig.tests.json
cd server && ./node_modules/.bin/vitest run test/typecheck-tests.test.ts
```

Expected: no output from either `tsc`, and `typecheck-tests` passes.

- [ ] **Step 8: Commit**

```bash
git add server/src/coord/dispatch.ts server/src/coord/close.ts server/src/coord/routes.ts \
  server/test/idGateFixture.ts server/test/stored-row-id-gates.test.ts
git commit -m "$(cat <<'MSG'
fix(coord): dispatch and close re-check a stored session id; abandon closes a bad one with no fleet act

A run row's stored sessionId reaches ensure, ws-hold, ws-release,
ws-archive and pr-state. Rows written before any ingress check, or
rebuilt from the registry, were never checked. Now:
- dispatchRun refuses a stored id that is not a registry id with
  bad-session, after the body and hold checks and before the pause
  listing. A resume refuses too, and the run stays planned.
- closeRun refuses it on every arm but abandon, review closes
  included, before verifyDone, the child gate or any fleet act.
- The abandon arm is the operator's door, the archive door's
  programme end and the dead-coordinator sweep. It closes such a run
  failed, after the sweep's gate, with no fleet act and no child gate,
  and records one fleet-act-omitted:bad-session run event. It answers
  released:false, childReclaim not-queued, childReclaimWhy
  marker-unreadable.
- Both route maps answer 409 bad-session.

abandonRefusal is unchanged, so a programme end over such a run ends
the whole programme. idGateFixture gains storedRun, which opens a run
through the store. Spec §2.3.
MSG
)"
```

Name these departures, by slug, in the wave-done:
- `resume-dispatch-refuses-not-holds`
- `overlong-id-plants-no-row`

---

### Task 4: `SingleRead.kind` and its 14 callers

**Model routing:** `opus`, effort `xhigh`. This is ONE commit, because the type change breaks the compile. SAFETY: four of the fourteen callers act on absence (`measureClaimant`, `childBindGate`, `childReclaimOutcome` and `childGateAtClose`). Each must read the new `bad-id` as unmeasured, never as absent.

**Why:**
- **Spec §2.3.** `readSessionRecord` moves from a `found` boolean to a `kind` discriminant, and answers `bad-id` for an id `isRegistryId` refuses. Every caller becomes an exhaustive switch ending in a `never` check, so each one places `bad-id` deliberately.
- **R15.** `readSessionRecord` answers `bad-id` before the clock, the listing and `noteWholeFleetListing`. A zero-listing count pins this. Each fold row ("fold `bad-id` into the `absent` arm", `case 'absent': case 'bad-id':`) is measured against an UNLISTED bad id. That is where the two arms part: the `absent` arms re-list, find nothing, and act (`dead`, `ok`, `gone`, `not-a-child`).
- **R17, with the coordinator's amendment.** The arms an outer gate already masks answer the safe word and name their mask, and get no pin of their own:
  - `server.ts`'s `/archive` and `fleet.ts`'s `liveStatus` are masked by `knownId`.
  - `readAsk` is masked by `knownId` on `/ask`, and by `freshAskAt`'s own `bad-id` on `POST /api/asks/:id/answer`.
  - **The one exception is `close.ts`'s `childGateAtClose`.** It is exported, its docstring says why, and it is pinned directly with an unlisted bad id, with its own fold row.
- **R13.** `releaseRetiredChildHold` answers `changed`. `/api/sessions/*` routes answer `bad-session-id`, and coordination routes answer `bad-session`.
- **R20.** `'bad-id'` joins `mail-routes.test.ts`'s `NOT_CODES`. It is a read result, and no refusal or wire field carries it.
- **R21.** The heir is gated INSIDE `reclaimRun`, by `readSessionRecord`'s `bad-id`. The route head gets no copy that would mask it. `ReclaimOutcome` gains its one member here, with `which: 'heir'`. Task 9 widens `which`.

**Files:**
- Modify `server/src/registry.ts`:
  - the `../../shared/api.js` import (`CHILD_RUN_ID, isPrPhase, isStopSurface, ROUTE_WRITABLE_FIELDS,`);
  - the `SessionRecord.child` docstring's two `found:` spellings (`returns \`found:true\` with \`child:unreadable\``);
  - `export type SingleRead =` and its docstring;
  - `readSessionRecord`'s docstring and body (`export async function readSessionRecord(`);
  - `freshAskAt`'s body (`if (!read.found) return UNMEASURED_ASK_AT;`).
  - Every `[registry-read-census:*]` sentence stays byte for byte.
- Modify `server/src/fleet.ts`: `liveStatus`'s `if (!read.found || !(await tmux.hasSession(id))) return 'dead';`, and its comment's `` `!read.found` `` sentence.
- Modify `server/src/sessionws.ts`: `resolve()`'s `if (!read.found) {` block, and the `Resolution` docstring.
- Modify `server/src/server.ts`:
  - `askDeps.readAsk` (`if (!read.found) return null;`);
  - `/kickoff`, `/stop`, the ordinary arm of `/swap`, and `/archive`: each one's `if (!read.found) {` ladder.
- Modify `server/src/coord/close.ts`:
  - `childGateAtClose` becomes `export async function childGateAtClose(`, and its docstring gains two paragraphs;
  - its mark ladder (`if (read.found) {`), its `hasCoordinated` line, and its minting-arm condition.
- Modify `server/src/coord/childBind.ts`: `childBindGate` (`if (!read.found) {`) and its docstring's answer list.
- Modify `server/src/coord/childReclaim.ts`:
  - `childReclaimOutcome`'s step 1 (`if (!read.found && read.reason === 'absent') {`);
  - `releaseRetiredChildHold`'s step 1 (`if (!read.found) return read.reason === 'unlistable' ? 'failed' : 'changed';`);
  - the `childReclaimRowListing` docstring's `{ found: false, reason: 'absent' }`.
- Modify `server/src/coord/reclaim.ts`:
  - `ReclaimOutcome`'s last member (`| { ok: false; kind: 'heir-is-a-worker'; by: string };`);
  - `measureClaimant`'s head (`if (!read.found) {`), and the rung-1 prose that cites stale lines and the stale consumer count;
  - `reclaimRun`'s rung 3 (`if (!incoming.found) {`) and its docstring's rung 3.
- Modify `server/src/coord/routes.ts`: the reclaim switch (`case 'heir-is-a-worker':`).
- Create `server/test/single-read-bad-id.test.ts`.
- Modify these tests (the literal shapes and text pins the new type breaks):
  - `server/test/registry.test.ts`, `server/test/child-reclaim.test.ts`, `server/test/child-reclaim-spent.test.ts`, `server/test/child-reclaim-mark.test.ts` and `server/test/coord-reclaim.test.ts`;
  - `server/test/child-reclaim-generation.test.ts`: ONE text pin, which spells `read.found` in `close.ts` (slug `generation-pin-follows-kind`);
  - `server/test/mail-routes.test.ts`: `'bad-id'` joins `NOT_CODES`;
  - any further file that `typecheck-tests` names after Step 5.
- No edit to `shared/api.ts`, `watch.ts`, `dispatch.ts`, `store.ts`, `README.md` or any `ccd/`, `agent/` or `pwa/` file.

**Interfaces:**
- Consumes:
  ```ts
  // Task 1, shared/api.ts foot (L0)
  export function isRegistryId(id: unknown): id is string;
  // Tasks 2 and 3, server/test/idGateFixture.ts
  export function seedRow(home: string, id: string, fields?: Record<string, string>): void;
  export function recorder(cfg?: { fail?: ReadonlySet<string> }): { run: Runner; calls: string[][] };
  export function appFor(home: string, run: Runner, over?: Partial<Omit<Deps, 'cfg'>>): Promise<{ app: FastifyInstance; coord: CoordStore; cfg: CcrcConfig }>;
  export function storedRun(coord: CoordStore, r: { state: RunState; sessionId: string | null; claimedBy: string; kind?: 'work' | 'review'; reviews?: number }): number;
  // Existing at 837a099c0
  measureClaimant(deps: ReclaimDeps, id: string, nowMs: number): Promise<ClaimantVerdict>;     // coord/reclaim.ts
  childBindGate(deps: ChildSpentDeps, runs: ChildBindRuns, sessionId: string): Promise<ChildBindVerdict>;   // coord/childBind.ts
  reclaimChild(deps: ChildReclaimDeps, req: ChildReclaimRequest): Promise<ChildReclaimOutcome>;  // coord/childReclaim.ts
  CHILD_RECLAIM_FEED_QUIET_NONE, CHILD_RECLAIM_LICENCE_NONE                                       // coord/childReclaim.ts
  ```
- Produces:
  ```ts
  // server/src/registry.ts (L3)
  export type SingleRead =
    | { kind: 'found'; record: SessionRecord }
    | { kind: 'absent' }        // no `.uuid` listed, a dropped row, or a twice-observed retirement (the existing fold)
    | { kind: 'unlistable' }
    | { kind: 'bad-id' };       // isRegistryId(id) is false; answered before any readdir
  export async function readSessionRecord(io: FleetIO, cfg: CcrcConfig, id: string): Promise<SingleRead>;  // unchanged signature
  // server/src/coord/reclaim.ts (L3)
  export type ReclaimOutcome = /* …today's members… */
    | { ok: false; kind: 'bad-session'; which: 'heir'; detail: string };   // Task 9 widens `which` to 'heir' | 'claimant'
  // measureClaimant's bad-id answer:
  //   { state: 'unmeasurable', why: 'the claimant id is not a registry id, so it is never measured or composed' }
  // server/src/coord/close.ts (L3): exported for its pin (R17 amendment); signature unchanged, `ChildGate` stays module-private
  export async function childGateAtClose(
    deps: CloseRunDeps, run: RunRow, sessionId: string, siblings: OpenSiblingsResult,
    final: boolean, state: 'done' | 'failed', verifiedLine: CcdPrLine | null,
  ): Promise<ChildGate>;
  ```

**What each caller answers for `bad-id`:**

| Caller | `bad-id` → | Pin |
|---|---|---|
| `fleet.ts` `liveStatus` | `'dead'` | masked by `knownId` (R17) |
| `sessionws.ts` `resolve` | `{ ok: false, reason: 'absent' }` (terminal) | the same as absent by design; the zero-listing case |
| `server.ts` `readAsk` | `null` | masked by `knownId` and by `freshAskAt` (R17) |
| `server.ts` `/kickoff`, `/stop`, `/swap` (ordinary arm) | 400 `bad-session-id` | the route case |
| `server.ts` `/archive` | 400 `bad-session-id` | masked by `knownId` (R17) |
| `close.ts` `childGateAtClose` | mark `unreadable`, with no second listing and a `null` uuid | the direct case (R17 amendment) |
| `childBind.ts` `childBindGate` | `spent-unmeasured` | the direct case |
| `childReclaim.ts` `childReclaimOutcome` | `deferred('marker-unreadable', …)`, with no mail cancel | the direct case |
| `childReclaim.ts` `releaseRetiredChildHold` | `'changed'` (R13) | the same as absent by design; the zero-listing case |
| `reclaim.ts` `measureClaimant` | `unmeasurable` | the direct cases, and the lane case |
| `reclaim.ts` `reclaimRun` (heir) | `{ ok: false, kind: 'bad-session', which: 'heir', detail }` → 400 | the route case |
| `registry.ts` `freshAskAt` | `UNMEASURED_ASK_AT` | the zero-listing case, and the ask case end to end |

- [ ] **Step 0: Entry conditions (Tasks 1–3 are committed; measure, never assume)**

From the workspace root:

```bash
grep -c '^export function isRegistryId(id: unknown): id is string {$' shared/api.ts                       # 1: Task 1
grep -cE '^export (async )?function (seedRow|recorder|appFor|storedRun)\(' server/test/idGateFixture.ts   # 4: Tasks 2 and 3
grep -c 'if (!isRegistryId(id)) return false;' server/src/server.ts                                       # 1: Task 2's knownId
grep -c "kind: 'bad-session'" server/src/coord/dispatch.ts server/src/coord/close.ts                       # each >= 1: Task 3
grep -rnE 'readSessionRecord\(' server/src --include=*.ts | grep -vE 'export async function|^\S+:[0-9]+:\s+(//|\*)' | wc -l   # (c4) 14
grep -c "const fresh = await freshAskAt(deps.io, deps.cfg, ask.childId);" server/src/coord/routes.ts      # (c19) 1
grep -c "\`rekeyed\` and \`superseded\` are one word each." server/test/mail-routes.test.ts                # 1: NOT_CODES' last entry
grep -rnE "\bread\.found\b|incoming\.found\b|reason === 'unlistable'" server/src --include=*.ts | wc -l   # record: the sites this task converts
```

- A different count or line is not a departure: re-point by content and record it.
- A missing Task 1–3 name is a STOP: `entry-not-met`.
- If run 400 has merged and changed `mail-routes.test.ts`'s `NOT_CODES`, re-point Step 5 (f) by content (R30).

- [ ] **Step 1: Write the failing tests: `server/test/single-read-bad-id.test.ts`**

```ts
// Path identity W1a (spec §2.3): `readSessionRecord` answers `bad-id` for an id `isRegistryId`
// refuses, BEFORE any listing, and every caller that acts on absence reads that answer as unmeasured,
// never as absent.
//
// Each absence-acting case below uses an UNLISTED non-registry id unless its title says the row is
// planted. Unlisted is the input on which `bad-id` and `absent` part: an `absent` arm re-lists, finds
// nothing, and acts (`dead`, `ok`, `gone`, `not-a-child`). So a mutant that folds `bad-id` into
// `absent` goes red here instead of passing for the wrong reason. The route cases plant the row, so
// that only the read's own answer can refuse.
//
// Nothing here reaches a live HOME. Every registry is a fixture HOME's, a dash-named row is a plain
// file in it, and ccd and tmux are scripted recorders.
import { describe, it, expect, afterEach, vi } from 'vitest';
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { FastifyInstance } from 'fastify';
import { loadConfig } from '../src/config.js';
import { localIO, type FleetIO } from '../src/io.js';
import { readRegistry, readSessionRecord } from '../src/registry.js';
import { openCoordDb } from '../src/coord/db.js';
import { CoordStore } from '../src/coord/store.js';
import { measureClaimant, type ReclaimDeps } from '../src/coord/reclaim.js';
import { childBindGate } from '../src/coord/childBind.js';
import {
  CHILD_RECLAIM_FEED_QUIET_NONE, CHILD_RECLAIM_LICENCE_NONE, reclaimChild, type ChildReclaimDeps,
} from '../src/coord/childReclaim.js';
import { childGateAtClose, closeRun, type CloseRunDeps } from '../src/coord/close.js';
import { parseJournalLine } from '../src/coord/journalparse.js';
import { Bus } from '../src/bus.js';
import { FleetWatcher, CHILD_RECLAIM_SWEEP_MS } from '../src/watch.js';
import { DEAD_COORDINATOR_AFTER_MS, DEAD_COORDINATOR_LANE_LIVE_MARKER } from '../src/deadCoordinator.js';
import { NotifyLog } from '../src/notifylog.js';
import { Tmux, type Runner, type SessionVerdict } from '../src/exec.js';
import { askKey } from '../src/askkey.js';
import { seedRoster, testDeps } from './helpers.js';
import { mkTmp } from './tmpHelpers.js';
import { okAsk, okRun } from './coordReadHelpers.js';
import { appFor, recorder, seedRow, storedRun } from './idGateFixture.js';

const BAD = '--actor';
const CLAIMANT = 'demo-coord-a';
const WORKER = 'demo-worker-1';
const PARENT = 'demo-coordinator';
const TOKEN = 'f'.repeat(64);
const T0 = 1_790_000_000_000;
const GONE: SessionVerdict = { verdict: 'gone' };
const QUESTION = { question: 'Which colour?', options: [{ label: 'Red' }, { label: 'Blue' }] };
const ASK_KEY = askKey({ questions: [QUESTION] })!;
const ASK_PANE = 'Which colour?\n❯ 1. Red\n  2. Blue\nEnter to select\n';
const BAD_CLAIMANT = {
  state: 'unmeasurable', why: 'the claimant id is not a registry id, so it is never measured or composed',
};

const store = (home: string): CoordStore => new CoordStore(openCoordDb(path.join(home, '.ccrc', 'coord.db')));
const regOf = (home: string): string => path.join(home, '.cc-sessions');
/** Read back from disk, so no case depends on the uuid `seedRow` happens to write. */
const uuidOf = (home: string, id: string): string => readFileSync(path.join(regOf(home), `${id}.uuid`), 'utf8');

/** tmux answers `capture-pane` with the ask's own menu, so a press that got past the guard WOULD land
 *  and the no-keys assertion cannot pass for the wrong reason. Every other exec succeeds, empty. */
const paneRunner = (pane: string): { run: Runner; calls: string[][] } => {
  const calls: string[][] = [];
  const run: Runner = async (_cmd, args) => {
    calls.push(args);
    return args[0] === 'capture-pane' ? { code: 0, stdout: pane, stderr: '' } : { code: 0, stdout: '', stderr: '' };
  };
  return { run, calls };
};

let app: FastifyInstance | undefined;
afterEach(async () => {
  await app?.close();
  app = undefined;
  vi.restoreAllMocks();
});

describe('readSessionRecord answers bad-id before any read (spec §2.3)', () => {
  it("a planted --actor row answers {kind:'bad-id'} with zero listings and zero field reads", async () => {
    const home = mkTmp('ccrc-bad-id-read-');
    seedRow(home, BAD);
    expect(readdirSync(regOf(home)), 'the row really is planted').toContain(`${BAD}.uuid`);
    let listings = 0;
    let fieldReads = 0;
    const io: FleetIO = {
      ...localIO,
      readdir: async (p) => { listings += 1; return localIO.readdir(p); },
      readFileMeasured: async (p) => { fieldReads += 1; return localIO.readFileMeasured(p); },
    };
    expect(await readSessionRecord(io, testDeps(home).cfg, BAD)).toEqual({ kind: 'bad-id' });
    expect(listings, 'no listing is spent on an id ccd could read as a flag').toBe(0);
    expect(fieldReads, 'and no field is read').toBe(0);
  });

  it('.hidden and a 256-character id answer bad-id', async () => {
    const home = mkTmp('ccrc-bad-id-read-');
    seedRow(home, '.hidden');   // planted, so only the predicate can refuse it
    const cfg = testDeps(home).cfg;
    expect(await readSessionRecord(localIO, cfg, '.hidden')).toEqual({ kind: 'bad-id' });
    expect(await readSessionRecord(localIO, cfg, 'x'.repeat(256))).toEqual({ kind: 'bad-id' });
  });

  it('control: a planted a--actor row is found', async () => {
    const home = mkTmp('ccrc-bad-id-read-');
    seedRow(home, 'a--actor');
    const read = await readSessionRecord(localIO, testDeps(home).cfg, 'a--actor');
    expect(read.kind).toBe('found');
    expect(read.kind === 'found' && read.record.id).toBe('a--actor');
  });
});

describe('every absence-acting caller holds on bad-id (spec §2.3)', () => {
  const claimantDeps = (home: string): ReclaimDeps =>
    ({ coord: store(home), io: localIO, cfg: testDeps(home).cfg, tmux: { sessionVerdict: async () => GONE } });

  it("measureClaimant('--actor') is unmeasurable, never dead", async () => {
    const home = mkTmp('ccrc-bad-id-claimant-');
    seedRow(home, CLAIMANT);   // the registry lists cleanly, and names no --actor
    expect(readdirSync(regOf(home)), 'unlisted: the input on which bad-id and absent part').not.toContain(`${BAD}.uuid`);
    expect(await measureClaimant(claimantDeps(home), BAD, Date.now())).toEqual(BAD_CLAIMANT);
  });

  it('with its row planted, still unmeasurable', async () => {
    const home = mkTmp('ccrc-bad-id-claimant-');
    seedRow(home, BAD);
    expect(await measureClaimant(claimantDeps(home), BAD, Date.now())).toEqual(BAD_CLAIMANT);
  });

  it('the dead-coordinator lane leaves a run claimed by --actor', async () => {
    let clock = T0;
    vi.spyOn(Date, 'now').mockImplementation(() => clock);
    const home = mkTmp('ccrc-bad-id-lane-');
    seedRoster(home);
    const reg = regOf(home);
    mkdirSync(path.join(reg, '.lifecycle'), { recursive: true });
    // ARMED: a fold of bad-id into absent would END the programme here, not merely record it.
    writeFileSync(path.join(reg, DEAD_COORDINATOR_LANE_LIVE_MARKER), '');
    const cfg = loadConfig({ CCRC_HOME: home, CCRC_PROJECTS_ROOT: mkTmp('ccrc-projects-') } as never);
    const calls: string[][] = [];
    const run: Runner = async (cmd, args) => {
      if (path.basename(cmd) === 'tmux') {
        if (args[0] !== 'has-session') return { code: 1, stdout: '', stderr: '' };
        const id = (args[2] ?? '').replace(/^=cc-/, '').replace(/:$/, '');
        return { code: 1, stdout: '', stderr: `can't find session: cc-${id}` };
      }
      calls.push(args);
      return { code: 0, stdout: '', stderr: '' };
    };
    const coord = store(home);
    const notifyLog = new NotifyLog(path.join(home, '.ccrc', 'notify.json'));
    await notifyLog.load();
    const base = testDeps(home, run);
    const deps = { ...base, cfg, coord, notifyLog, tmux: new Tmux(run), presence: { isVisible: () => false } };
    const watcher = new FleetWatcher(deps as never, new Bus(), 10_000);
    watcher.useCoordSerialiser({ withSweepAbandon: (c, fn) => fn((runId, crashedId, stillCrashed) =>
      closeRun({ coord: c, io: deps.io, cfg, runCcd: deps.runCcd }, runId, { intent: 'abandon' }, 'sweep',
        { claimedBy: crashedId, stillCrashed })) });
    const id = storedRun(coord, { state: 'working', sessionId: WORKER, claimedBy: BAD });
    // A journal history for --actor. Folded into `absent`, an unlisted claimant WITH history reads
    // CRASHED (one with none reads unmeasured on its own), so this is the input on which the arms part.
    coord.ingestJournal({ gen: '1790000000000000000', cursor: 1, size: 1, at: 1, rows: [parseJournalLine(JSON.stringify(
      { v: 1, uid: `badid.create.${clock}`, at: clock, act: 'create', outcome: 'done', id: BAD, dec: { surface: 'none' } }))] });
    const pass = async (): Promise<void> => {
      await watcher.sweepLifecycle();
      await watcher.sweepDeadCoordinators(await readRegistry(deps.io, cfg), readdirSync(reg));
    };
    // The first pass, passes nine minutes apart across the hour, then one more: an act would land here.
    await pass();
    for (let done = 0; done < DEAD_COORDINATOR_AFTER_MS; done += 9 * 60_000) {
      clock += Math.min(9 * 60_000, DEAD_COORDINATOR_AFTER_MS - done);
      await pass();
    }
    clock += CHILD_RECLAIM_SWEEP_MS + 1;
    await pass();
    expect(okRun(coord.run(id))!.state, 'never abandoned').toBe('working');
    expect(calls, 'no ccd verb composed').toEqual([]);
    expect(coord.feedEvents(50).filter((e) => e.title.startsWith('dead coordinator: programme')), 'no feed death row')
      .toEqual([]);
  });

  it('childBindGate(--actor) answers spent-unmeasured, never ok, and composes no pr-state', async () => {
    const home = mkTmp('ccrc-bad-id-bind-');
    seedRow(home, CLAIMANT);
    const rec = recorder();
    const base = testDeps(home, rec.run);
    const verdict = await childBindGate({ io: base.io, cfg: base.cfg, runCcd: base.runCcd }, store(home), BAD);
    expect(verdict).toEqual({ ok: false, code: 'spent-unmeasured', detail: 'the session id is not a registry id' });
    expect(rec.calls.filter((c) => c[0] === 'pr-state')).toEqual([]);
  });

  it('reclaimChild(--actor) defers marker-unreadable', async () => {
    const home = mkTmp('ccrc-bad-id-reclaim-child-');
    seedRow(home, CLAIMANT);
    const rec = recorder();
    const base = testDeps(home, rec.run);
    const coord = store(home);
    const runId = storedRun(coord, { state: 'planned', sessionId: null, claimedBy: CLAIMANT });
    const m = coord.insertMail({ fromId: CLAIMANT, fromUuid: 'u', toId: BAD, runId: null,
      kind: 'status', subject: 's', body: 'b', artifacts: [] });
    const delivery = coord.queueDelivery(m.id, BAD, '<mail/>').id;
    const deps: ChildReclaimDeps = { coord, io: base.io, cfg: base.cfg, runCcd: base.runCcd };
    const out = await reclaimChild(deps, { sessionId: BAD, runId, trigger: 'close', deferExpired: false,
      deferredSinceMs: null, feedQuiet: CHILD_RECLAIM_FEED_QUIET_NONE, licenceGeneration: CHILD_RECLAIM_LICENCE_NONE });
    expect(out).toEqual({ kind: 'deferred', sessionId: BAD, runId, why: 'marker-unreadable',
      detail: 'the session id is not a registry id' });
    const state = (coord.db.prepare('SELECT state FROM mail_deliveries WHERE id = ?').get(delivery) as { state: string }).state;
    expect(state, 'its outstanding delivery stays outstanding').toBe('queued');
    expect(rec.calls, 'no runCcd').toEqual([]);
  });

  it('childGateAtClose(--actor) reads the mark unreadable, never not-a-child, with no second listing', async () => {
    const home = mkTmp('ccrc-bad-id-close-gate-');
    seedRow(home, CLAIMANT);
    const rec = recorder();
    const base = testDeps(home, rec.run);
    const coord = store(home);
    const id = storedRun(coord, { state: 'working', sessionId: BAD, claimedBy: CLAIMANT });
    let listings = 0;
    const io: FleetIO = { ...localIO, readdir: async (p) => { listings += 1; return localIO.readdir(p); } };
    const deps: CloseRunDeps = { coord, io, cfg: base.cfg, runCcd: base.runCcd };
    const gate = await childGateAtClose(deps, okRun(coord.run(id))!, BAD, { ok: true, siblings: [] }, false, 'failed', null);
    expect(gate).toEqual({ decision: { reclaim: false, why: 'marker-unreadable' }, request: null });
    expect(listings, 'nothing ever listed this id, so nothing is re-listed for it').toBe(0);
    expect(rec.calls).toEqual([]);
  });

  it('POST /api/sessions/--actor/kickoff, /stop and /swap answer 400 bad-session-id', async () => {
    const home = mkTmp('ccrc-bad-id-routes-');
    seedRow(home, BAD);   // planted: only the read's own answer can refuse
    const rec = recorder();
    const w = await appFor(home, rec.run);
    app = w.app;
    const kick = await app.inject({ method: 'POST', url: `/api/sessions/${BAD}/kickoff`,
      payload: { slug: 'demo-programme', title: 'Demo programme' } });
    expect(kick.statusCode).toBe(400);
    expect(kick.json()).toEqual({ ok: false, error: 'bad-session-id' });
    expect(w.coord.dueDeliveries(Date.now(), 60_000), 'no kickoff mail queued').toEqual([]);
    const stop = await app.inject({ method: 'POST', url: `/api/sessions/${BAD}/stop` });
    expect(stop.statusCode).toBe(400);
    expect(stop.json()).toEqual({ ok: false, error: 'bad-session-id' });
    const swap = await app.inject({ method: 'POST', url: `/api/sessions/${BAD}/swap`, payload: { wrapper: 'claude' } });
    expect(swap.statusCode).toBe(400);
    expect(swap.json()).toEqual({ ok: false, error: 'bad-session-id' });
    expect(rec.calls.filter((c) => c[0] === 'stop' || c[0] === 'swap'), 'no stop or swap argv').toEqual([]);
  });

  it('POST /api/runs/:id/reclaim with claimedBy --actor answers 400 bad-session', async () => {
    const home = mkTmp('ccrc-bad-id-reclaim-');
    seedRow(home, CLAIMANT);
    const rec = recorder();
    const w = await appFor(home, rec.run);
    app = w.app;
    const id = storedRun(w.coord, { state: 'working', sessionId: WORKER, claimedBy: CLAIMANT });
    const res = await app.inject({ method: 'POST', url: `/api/runs/${id}/reclaim`, payload: { claimedBy: BAD } });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({ ok: false, error: 'bad-session', detail: 'claimedBy is not a registry id' });
    expect(okRun(w.coord.run(id))!.claimedBy, "the run's claimant is unchanged").toBe(CLAIMANT);
    expect(rec.calls).toEqual([]);
  });

  it('POST /api/asks/:id/answer for an ask whose stored childId is --actor answers 409 child-unmeasurable', async () => {
    const home = mkTmp('ccrc-bad-id-ask-');
    seedRow(home, PARENT);
    seedRow(home, BAD);   // planted, with a live hook state, so only the read's own answer can refuse
    const now = Date.now();
    writeFileSync(path.join(regOf(home), `${BAD}.hookstate.json`), JSON.stringify({
      v: 1, state: 'waiting', event: 'PermissionRequest', sessionId: uuidOf(home, BAD), pid: 4242,
      updatedAt: now, ask: { questions: [QUESTION] }, subagents: [],
    }));
    const panes = paneRunner(ASK_PANE);
    const w = await appFor(home, panes.run, { mailToken: TOKEN });
    app = w.app;
    const askId = w.coord.insertAsk({
      childId: BAD, parentId: PARENT, runId: null, askKey: ASK_KEY, askAt: now, dialogId: 'dlg-1',
      question: QUESTION.question, options: QUESTION.options.map((o) => o.label), now,
    });
    const res = await app.inject({ method: 'POST', url: `/api/asks/${askId}/answer`,
      headers: { 'x-ccrc-mail-token': TOKEN },
      payload: { fromId: PARENT, fromUuid: uuidOf(home, PARENT), optionIndexes: [1] } });
    expect(res.statusCode).toBe(409);
    expect(res.json()).toMatchObject({ ok: false, error: 'child-unmeasurable' });
    expect(panes.calls.filter((c) => c[0] === 'send-keys'), 'no tmux keys are sent').toEqual([]);
    expect(okAsk(w.coord.askById(askId))!.state, 'the ask stays held').toBe('held');
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

```bash
cd server && ./node_modules/.bin/vitest run test/single-read-bad-id.test.ts
```

Expected: FAIL. The messages below are derived, not measured: re-measure them and record them in the SDD ledger.
- `a planted --actor row …`: `expected { found: true, record: { … } } to deeply equal { kind: 'bad-id' }`.
- `.hidden and a 256-character id …`: the same shape for `.hidden`.
- `control: a planted a--actor row is found`: `expected undefined to be 'found'`. The control is red only because `kind` does not exist yet. It goes green with the type.
- The `measureClaimant` cases:
  - unlisted: `expected { state: 'dead', cause: 'absent', … } to deeply equal { state: 'unmeasurable', … }`;
  - planted: a found row's tmux and lifecycle verdict, not `BAD_CLAIMANT`.
- The lane case: `never abandoned: expected 'failed' to be 'working'`.
- `childBindGate(--actor) …`: `expected { ok: true } to deeply equal { ok: false, code: 'spent-unmeasured', … }`.
- `reclaimChild(--actor) …`: `expected { kind: 'gone', sessionId: '--actor' } to deeply equal { kind: 'deferred', … }`.
- `childGateAtClose(--actor) …`: `TypeError: … childGateAtClose is not a function`. If the runner checks named exports when it links the file, the whole file instead fails to load with `does not provide an export named 'childGateAtClose'`. Either one is the red.
- The routes case: `expected 200 to be 400` (`/kickoff`).
- The reclaim case: `expected 404 to be 400`.
- The ask case: `expected 200 to be 409`, or a 409 whose `error` is not `child-unmeasurable`.

A case that PASSES here is a defect in the case: report it and fix the case, never the code.

- [ ] **Step 3: `server/src/registry.ts`, the type and the read**

(a) The import. Replace
```ts
  CHILD_RUN_ID, isPrPhase, isStopSurface, ROUTE_WRITABLE_FIELDS,
```
with
```ts
  CHILD_RUN_ID, isPrPhase, isRegistryId, isStopSurface, ROUTE_WRITABLE_FIELDS,
```

(b) The `SessionRecord.child` docstring's two spellings. Replace
```ts
   * returns `found:true` with `child:unreadable`, and the caller (the bind
```
with
```ts
   * returns `kind:'found'` with `child:unreadable`, and the caller (the bind
```
and replace
```ts
   * first (`readSessionRecord` answers `found:false, reason:'absent'`
```
with
```ts
   * first (`readSessionRecord` answers `kind:'absent'`
```

(c) `SingleRead`. Replace
```ts
/** `readSessionRecord`'s widened result (architecture doc, increment 1's
 *  second half): the same three-way split `RegistryRead` draws for the
 *  whole fleet, narrowed to one id. `found: true` may still carry a
 *  `record.unmeasured` — a caller that needs identity, not just presence,
 *  reaches it through `measuredIdentity`, never through this shape alone. */
export type SingleRead =
  | { found: true; record: SessionRecord }
  | { found: false; reason: 'absent' }
  | { found: false; reason: 'unlistable' };
```
with
```ts
/** `readSessionRecord`'s widened result (architecture doc, increment 1's
 *  second half): the three-way split `RegistryRead` draws for the whole
 *  fleet, narrowed to one id, plus a fourth answer about the id itself
 *  (path identity, spec §2.3). There is a `kind` per answer and no boolean,
 *  so every caller places each answer in an exhaustive switch, rather than
 *  letting a new answer fall into whatever its `else` already did.
 *   - `found` may still carry a `record.unmeasured`: a caller that needs
 *     identity, not just presence, reaches it through `measuredIdentity`,
 *     never through this shape alone.
 *   - `absent` keeps its fold of three conditions: no `.uuid` in the
 *     listing, a row `buildRecord` dropped, and a twice-observed retirement.
 *   - `unlistable` is the whole-directory collapse, never a proven absence.
 *   - `bad-id` is an id `isRegistryId` refuses, answered before any listing.
 *     It says nothing about the registry, so a caller that acts on absence
 *     reads it as unmeasured, never as absent. */
export type SingleRead =
  | { kind: 'found'; record: SessionRecord }
  | { kind: 'absent' }        // no `.uuid` listed, a dropped row, or a twice-observed retirement (the existing fold)
  | { kind: 'unlistable' }
  | { kind: 'bad-id' };       // isRegistryId(id) is false; answered before any readdir
```

(d) `readSessionRecord`'s docstring, the absence paragraph. Replace
```ts
 * `reason: 'absent'` covers both of `readRegistry`'s old ways to answer
 * `undefined` for one id — no `.uuid` in the listing at all, and a dropped
 * (narrowed, see `buildRecord`'s own docstring) entry — collapsed into one
 * shape at the source instead of two. `reason: 'unlistable'` is the SEPARATE
 * whole-directory collapse, never conflated with a proven absence.
```
with
```ts
 * `kind: 'absent'` covers both of `readRegistry`'s old ways to answer
 * `undefined` for one id — no `.uuid` in the listing at all, and a dropped
 * (narrowed, see `buildRecord`'s own docstring) entry — collapsed into one
 * shape at the source instead of two. `kind: 'unlistable'` is the SEPARATE
 * whole-directory collapse, never conflated with a proven absence.
```

(e) The docstring's tail and the function. Replace
```ts
 * absence there retires the record to `{found:false, reason:'absent'}`,
 * never a silent degrade-forever.
 */
export async function readSessionRecord(io: FleetIO, cfg: CcrcConfig, id: string): Promise<SingleRead> {
  const now = Date.now();
  const names = await io.readdir(cfg.registryDir);
  noteWholeFleetListing(names !== null, now);
  if (names === null) return { found: false, reason: 'unlistable' };
  if (!names.includes(`${id}.uuid`)) return { found: false, reason: 'absent' };   // no field reads worth making
  const rec = await buildRecord(io, cfg, names, id, now);
  if (rec === null) return { found: false, reason: 'absent' };
  if (rec.held === HOLD_UNREADABLE || rec.unmeasured.length > 0) {
    const again = await io.readdir(cfg.registryDir);
    if (again !== null) {
      if (rec.held === HOLD_UNREADABLE && !again.includes(`${id}.hold`)) rec.held = null;
      if (rec.unmeasured.length > 0 && !again.includes(`${id}.uuid`)) return { found: false, reason: 'absent' };
    }
  }
  return { found: true, record: rec };
}
```
with
```ts
 * absence there retires the record to `{kind:'absent'}`, never a silent
 * degrade-forever.
 *
 * `kind: 'bad-id'` (path identity, spec §2.3) is answered FIRST, from the id
 * string alone: no clock, no listing, no `noteWholeFleetListing`, no field
 * read. An id `isRegistryId` refuses is one ccd could read as a flag. It is
 * never listed for, never built and never composed. It proves nothing about
 * the registry, so every caller that acts on absence reads it as unmeasured,
 * never as absent.
 */
export async function readSessionRecord(io: FleetIO, cfg: CcrcConfig, id: string): Promise<SingleRead> {
  if (!isRegistryId(id)) return { kind: 'bad-id' };
  const now = Date.now();
  const names = await io.readdir(cfg.registryDir);
  noteWholeFleetListing(names !== null, now);
  if (names === null) return { kind: 'unlistable' };
  if (!names.includes(`${id}.uuid`)) return { kind: 'absent' };   // no field reads worth making
  const rec = await buildRecord(io, cfg, names, id, now);
  if (rec === null) return { kind: 'absent' };
  if (rec.held === HOLD_UNREADABLE || rec.unmeasured.length > 0) {
    const again = await io.readdir(cfg.registryDir);
    if (again !== null) {
      if (rec.held === HOLD_UNREADABLE && !again.includes(`${id}.hold`)) rec.held = null;
      if (rec.unmeasured.length > 0 && !again.includes(`${id}.uuid`)) return { kind: 'absent' };
    }
  }
  return { kind: 'found', record: rec };
}
```

(f) `freshAskAt` (the 14th caller). Replace
```ts
  const read = await readSessionRecord(io, cfg, childId);
  if (!read.found) return UNMEASURED_ASK_AT;
  const identity = measuredIdentity(read.record);
```
with
```ts
  const read = await readSessionRecord(io, cfg, childId);
  switch (read.kind) {
    case 'found': break;
    case 'absent': case 'unlistable': return UNMEASURED_ASK_AT;
    // An id `isRegistryId` refuses (spec §2.3) is a child this box did not
    // measure, exactly as the two above: it answers as they do, by design.
    // Its pins are `readSessionRecord`'s zero-listing case and, end to end,
    // `POST /api/asks/:id/answer`'s `child-unmeasurable` for a stored
    // non-registry `childId`.
    case 'bad-id': return UNMEASURED_ASK_AT;
    default: {
      const _x: never = read;
      return _x;
    }
  }
  const identity = measuredIdentity(read.record);
```

- [ ] **Step 4: The thirteen other callers**

(a) `server/src/fleet.ts`, `liveStatus`. First, the comment. Replace
```ts
  // plainly busy one. `!read.found` (genuinely absent, or the whole
  // directory unlistable) is still 'dead': there is no pane to ask about
  // either way, the same answer this gave before the ladder existed.
```
with
```ts
  // plainly busy one. `absent` and `unlistable` (genuinely absent, or the
  // whole directory unlistable) are still 'dead': there is no pane to ask
  // about either way, the same answer this gave before the ladder existed.
```
Then the code. Replace
```ts
  if (!read.found || !(await tmux.hasSession(id))) return 'dead';
  const rec = read.record;
```
with
```ts
  switch (read.kind) {
    case 'found': break;
    case 'absent': case 'unlistable': return 'dead';
    // Masked by `knownId` (spec §2.3): `POST /api/sessions/:id/interrupt`,
    // this function's one consumer, refuses an id `isRegistryId` refuses
    // before it calls here. 'dead' all the same: it refuses the interrupt.
    case 'bad-id': return 'dead';
    default: {
      const _x: never = read;
      return _x;
    }
  }
  if (!(await tmux.hasSession(id))) return 'dead';
  const rec = read.record;
```

(b) `server/src/sessionws.ts`. First, the `Resolution` docstring. Replace
```ts
 * `resolve()`'s own three-way (registry ladder, Task 2) — same `ok`+`reason`
 * shape `SingleRead` (registry.ts) already draws, deliberately not a new
 * vocabulary. `ok: false, reason: 'unmeasurable'` covers BOTH of
```
with
```ts
 * `resolve()`'s own three-way (registry ladder, Task 2) — `SingleRead`'s
 * (registry.ts) answers folded into this stream's `ok`+`reason`, deliberately
 * not a new vocabulary. `ok: false, reason: 'unmeasurable'` covers BOTH of
```
and replace
```ts
 * `ok: false, reason: 'absent'` covers a PROVEN absence (`SingleRead`'s own
 * `absent`) and the wrapper/config-dir mapping gap this function has always
 * folded into the same answer (see its own comment below) — neither is
 * registry-unmeasurable, so retrying this same 2 s poll can never heal
 * either one.
```
with
```ts
 * `ok: false, reason: 'absent'` covers a PROVEN absence (`SingleRead`'s own
 * `absent`), an id `isRegistryId` refuses (`SingleRead`'s `bad-id`, spec
 * §2.3), and the wrapper/config-dir mapping gap this function has always
 * folded into the same answer (see its own comment below) — none is
 * registry-unmeasurable, so retrying this same 2 s poll can never heal
 * any of them.
```
Then `resolve()`. Replace
```ts
    const read = await readSessionRecord(this.deps.io, this.deps.cfg, this.id);
    if (!read.found) {
      // `unlistable` is the SAME whole-fleet collapse `RegistryRead`'s own
      // `listed: false` types elsewhere in this build — it proves nothing
      // about whether THIS id exists, only that this read could not say.
      // Only a proven `absent` earns the terminal "unknown session".
      return read.reason === 'unlistable' ? { ok: false, reason: 'unmeasurable' } : { ok: false, reason: 'absent' };
    }
```
with
```ts
    const read = await readSessionRecord(this.deps.io, this.deps.cfg, this.id);
    switch (read.kind) {
      case 'found': break;
      // `unlistable` is the SAME whole-fleet collapse `RegistryRead`'s own
      // `listed: false` types elsewhere in this build — it proves nothing
      // about whether THIS id exists, only that this read could not say.
      // Only a proven `absent` earns the terminal "unknown session".
      case 'unlistable': return { ok: false, reason: 'unmeasurable' };
      case 'absent': return { ok: false, reason: 'absent' };
      // An id `isRegistryId` refuses (spec §2.3) is terminal too: it never
      // heals by polling, so no poll is installed. It answers exactly as
      // `absent` does, by design, so folding it there changes nothing
      // observable; its pin is `readSessionRecord`'s zero-listing case.
      case 'bad-id': return { ok: false, reason: 'absent' };
      default: {
        const _x: never = read;
        return _x;
      }
    }
```

(c) `server/src/server.ts`, `askDeps.readAsk`. Replace
```ts
      const read = await readSessionRecord(deps.io, deps.cfg, id);
      if (!read.found) return null;
```
with
```ts
      const read = await readSessionRecord(deps.io, deps.cfg, id);
      switch (read.kind) {
        case 'found': break;
        case 'absent': case 'unlistable': return null;
        // Masked on both of its paths (spec §2.3): `knownId` refuses a
        // non-registry id on `POST /api/sessions/:id/ask`, and on
        // `POST /api/asks/:id/answer` `freshAskAt`'s own `bad-id` answers
        // `child-unmeasurable` before `answerAsk` reaches this read. `null`,
        // the safe word, all the same.
        case 'bad-id': return null;
        default: {
          const _x: never = read;
          return _x;
        }
      }
```

(d) `server/src/server.ts`, `POST /api/sessions/:id/kickoff`. Replace
```ts
    const read = await readSessionRecord(deps.io, deps.cfg, id);
    if (!read.found) {
      return reply.code(read.reason === 'unlistable' ? 503 : 404).send({
        ok: false,
        error: read.reason === 'unlistable' ? 'registry-unmeasurable' : 'unknown-session',
      });
    }
```
with
```ts
    const read = await readSessionRecord(deps.io, deps.cfg, id);
    switch (read.kind) {
      case 'found': break;
      case 'unlistable': return reply.code(503).send({ ok: false, error: 'registry-unmeasurable' });
      case 'absent': return reply.code(404).send({ ok: false, error: 'unknown-session' });
      // An id `isRegistryId` refuses (spec §2.3) is a malformed request, never an unknown session: 400 in
      // this file's request-shape word, the one `isSafeSessionId` above answers.
      case 'bad-id': return reply.code(400).send({ ok: false, error: 'bad-session-id' });
      default: {
        const _x: never = read;
        return reply.code(500).send({ ok: false, error: 'internal', kind: (_x as { kind: string }).kind });
      }
    }
```

(e) `server/src/server.ts`, `POST /api/sessions/:id/stop`. Replace
```ts
    const read = await readSessionRecord(deps.io, deps.cfg, id);
    if (!read.found) {
      // Fix (blocking review finding 3): `reason: 'unlistable'` is the SAME
      // registry-unmeasurable fact the identity gate three lines below
      // already answers 503 for — the whole-fleet cousin of a degraded row,
      // and just as much not a proof this session is unknown ("404 would be
      // a LIE" applies here too: the whole-fleet collapse proves nothing
      // about THIS id one way or the other). Only `reason: 'absent'` — a
      // listing that plainly does not name this id at all — earns the
      // terminal unknown-session answer; a route that answered 404 for both
      // would be reopening the exact overloaded-null this 503 gate exists
      // to close, one branch over.
      return reply.code(read.reason === 'unlistable' ? 503 : 404)
        .send({ ok: false, error: read.reason === 'unlistable' ? 'registry-unmeasurable' : 'unknown-session' });
    }
```
with
```ts
    const read = await readSessionRecord(deps.io, deps.cfg, id);
    switch (read.kind) {
      case 'found': break;
      // Fix (blocking review finding 3): `unlistable` is the SAME
      // registry-unmeasurable fact the identity gate below already answers
      // 503 for — the whole-fleet cousin of a degraded row, and just as much
      // not a proof this session is unknown ("404 would be a LIE" applies
      // here too: the whole-fleet collapse proves nothing about THIS id one
      // way or the other). Only `absent` — a listing that plainly does not
      // name this id at all — earns the terminal unknown-session answer; a
      // route that answered 404 for both would be reopening the exact
      // overloaded-null this 503 gate exists to close, one branch over.
      case 'unlistable': return reply.code(503).send({ ok: false, error: 'registry-unmeasurable' });
      case 'absent': return reply.code(404).send({ ok: false, error: 'unknown-session' });
      // This read is the ONLY gate in front of `stopArgvFor` (spec §2.3), so an id `isRegistryId` refuses
      // is refused here, before any argv: 400, this file's request-shape word, never a proven absence's 404.
      case 'bad-id': return reply.code(400).send({ ok: false, error: 'bad-session-id' });
      default: {
        const _x: never = read;
        return reply.code(500).send({ ok: false, error: 'internal', kind: (_x as { kind: string }).kind });
      }
    }
```

(f) `server/src/server.ts`, `POST /api/sessions/:id/swap`, the ordinary arm. Leave the `crossPool` arm as Task 2 left it. Replace
```ts
      const read = await readSessionRecord(deps.io, deps.cfg, id);
      if (!read.found) {
        return reply.code(read.reason === 'unlistable' ? 503 : 404)
          .send({ ok: false, error: read.reason === 'unlistable' ? 'registry-unmeasurable' : 'unknown-session' });
      }
      const pool = poolFor(await readProjectPools(
```
with
```ts
      const read = await readSessionRecord(deps.io, deps.cfg, id);
      switch (read.kind) {
        case 'found': break;
        case 'unlistable': return reply.code(503).send({ ok: false, error: 'registry-unmeasurable' });
        case 'absent': return reply.code(404).send({ ok: false, error: 'unknown-session' });
        // The ordinary arm's id gate (spec §2.3): an id `isRegistryId` refuses is a malformed request.
        case 'bad-id': return reply.code(400).send({ ok: false, error: 'bad-session-id' });
        default: {
          const _x: never = read;
          return reply.code(500).send({ ok: false, error: 'internal', kind: (_x as { kind: string }).kind });
        }
      }
      const pool = poolFor(await readProjectPools(
```

(g) `server/src/server.ts`, `POST /api/sessions/:id/archive`. Replace
```ts
    const read = await readSessionRecord(deps.io, deps.cfg, id);
    if (!read.found) {
      return reply.code(read.reason === 'unlistable' ? 503 : 404)
        .send({ ok: false, error: read.reason === 'unlistable' ? 'registry-unmeasurable' : 'unknown-session' });
    }
    const identity = measuredIdentity(read.record);
    if (identity === null) return reply.code(503).send({ ok: false, error: 'registry-unmeasurable' });
```
with
```ts
    const read = await readSessionRecord(deps.io, deps.cfg, id);
    switch (read.kind) {
      case 'found': break;
      case 'unlistable': return reply.code(503).send({ ok: false, error: 'registry-unmeasurable' });
      case 'absent': return reply.code(404).send({ ok: false, error: 'unknown-session' });
      // Masked by `knownId` above (spec §2.3), which answers 404 for an id `isRegistryId` refuses before
      // its listing. This arm answers the request-shape word all the same.
      case 'bad-id': return reply.code(400).send({ ok: false, error: 'bad-session-id' });
      default: {
        const _x: never = read;
        return reply.code(500).send({ ok: false, error: 'internal', kind: (_x as { kind: string }).kind });
      }
    }
    const identity = measuredIdentity(read.record);
    if (identity === null) return reply.code(503).send({ ok: false, error: 'registry-unmeasurable' });
```

(h) `server/src/coord/close.ts`, `childGateAtClose`. It is exported for its pin (R17 amendment). Replace
```ts
 * PR opened in the gap can only HOLD the child, never make one vanish.
 */
async function childGateAtClose(
  deps: CloseRunDeps, run: RunRow, sessionId: string, siblings: OpenSiblingsResult,
  final: boolean, state: 'done' | 'failed', verifiedLine: CcdPrLine | null,
): Promise<ChildGate> {
  const read = await readSessionRecord(deps.io, deps.cfg, sessionId);
  let mark: ChildMark;
  if (read.found) {
    mark = read.record.child;
  } else if (read.reason === 'unlistable') {
    mark = { kind: 'unreadable' };
  } else {
    // A6/P5: `absent` is re-listed once, folding ONLY `.child` (never
    // `.uuid`) — the close's own question, distinct from the executor's.
    const listing = await childReclaimRowListing(deps, sessionId);
    mark = listing.kind === 'unlistable' || listing.child ? { kind: 'unreadable' } : { kind: 'none' };
  }
```
with
```ts
 * PR opened in the gap can only HOLD the child, never make one vanish.
 *
 * A NON-REGISTRY ID (path identity, spec §2.3) reads `unreadable`, never
 * `none`. `readSessionRecord` answers `bad-id` before any listing. The
 * `absent` arm's re-listing would find nothing for an id nothing lists, and
 * would answer `not-a-child`, a verdict nobody measured. No second listing is
 * taken, and the coordination fence gets a `null` uuid. `closeRun` checks the
 * stored id on every arm before it gets here, so no close reaches this arm
 * today.
 *
 * EXPORTED FOR ITS PIN, and for nothing else: no file outside `close.ts`
 * calls it. Spec §2.3 asks for a pin at each absence-acting caller, and with
 * the arm masked no flow can reach it, so the pin calls this function directly
 * (`single-read-bad-id.test.ts`).
 */
export async function childGateAtClose(
  deps: CloseRunDeps, run: RunRow, sessionId: string, siblings: OpenSiblingsResult,
  final: boolean, state: 'done' | 'failed', verifiedLine: CcdPrLine | null,
): Promise<ChildGate> {
  const read = await readSessionRecord(deps.io, deps.cfg, sessionId);
  let mark: ChildMark;
  switch (read.kind) {
    case 'found':
      mark = read.record.child;
      break;
    case 'unlistable':
      mark = { kind: 'unreadable' };
      break;
    case 'absent': {
      // A6/P5: `absent` is re-listed once, folding ONLY `.child` (never
      // `.uuid`) — the close's own question, distinct from the executor's.
      const listing = await childReclaimRowListing(deps, sessionId);
      mark = listing.kind === 'unlistable' || listing.child ? { kind: 'unreadable' } : { kind: 'none' };
      break;
    }
    // Masked by `closeRun`'s stored-id checks; see the docstring.
    case 'bad-id':
      mark = { kind: 'unreadable' };
      break;
    default: {
      const _x: never = read;
      return _x;
    }
  }
```
Then replace
```ts
    hasCoordinated = childReclaimHasCoordinated(deps.coord, sessionId, Date.now(), read.found ? childReclaimRowUuid(read.record) : null);
```
with
```ts
    hasCoordinated = childReclaimHasCoordinated(deps.coord, sessionId, Date.now(), read.kind === 'found' ? childReclaimRowUuid(read.record) : null);
```
and replace
```ts
  if (!decision.reclaim && decision.why === 'not-finished' && read.found && minting.kind === 'row') {
```
with
```ts
  if (!decision.reclaim && decision.why === 'not-finished' && read.kind === 'found' && minting.kind === 'row') {
```

(i) `server/src/coord/childBind.ts`. First, the docstring's answer list. Replace
```ts
 *   - `child.kind === 'unreadable'` → `spent-unmeasured`: a bind REFUSES what
 *     it cannot read (wave 3's reclaim will DEFER on the same answer).
```
with
```ts
 *   - `child.kind === 'unreadable'` → `spent-unmeasured`: a bind REFUSES what
 *     it cannot read (wave 3's reclaim will DEFER on the same answer);
 *   - `bad-id` → `spent-unmeasured` (path identity, spec §2.3): an id
 *     `isRegistryId` refuses was never listed for, so it is UNMEASURED. It is
 *     never the `absent` arm's `ok`, which would let the open or the `ensure`
 *     that follows compose it. No second listing is taken.
```
Then the gate. Replace
```ts
  const read = await readSessionRecord(deps.io, deps.cfg, sessionId);
  if (!read.found) {
    if (read.reason === 'unlistable') {
      return { ok: false, code: 'spent-unmeasured', detail: 'the registry could not be listed' };
    }
    const names = await deps.io.readdir(deps.cfg.registryDir);
    if (names === null) return { ok: false, code: 'spent-unmeasured', detail: 'the registry could not be listed' };
    if (names.includes(`${sessionId}.child`)) {
      return { ok: false, code: 'spent-unmeasured',
        detail: 'the child marker is listed but its registry row could not be built' };
    }
    return { ok: true };
  }
  const mark = read.record.child;
```
with
```ts
  const read = await readSessionRecord(deps.io, deps.cfg, sessionId);
  switch (read.kind) {
    case 'found': break;
    case 'unlistable':
      return { ok: false, code: 'spent-unmeasured', detail: 'the registry could not be listed' };
    case 'absent': {
      const names = await deps.io.readdir(deps.cfg.registryDir);
      if (names === null) return { ok: false, code: 'spent-unmeasured', detail: 'the registry could not be listed' };
      if (names.includes(`${sessionId}.child`)) {
        return { ok: false, code: 'spent-unmeasured',
          detail: 'the child marker is listed but its registry row could not be built' };
      }
      return { ok: true };
    }
    // Path identity (spec §2.3): unmeasured, never absent (see the docstring).
    // Dispatch's stored-id gate masks it on the resume arm. It holds whichever
    // door reaches it.
    case 'bad-id':
      return { ok: false, code: 'spent-unmeasured', detail: 'the session id is not a registry id' };
    default: {
      const _x: never = read;
      return _x;
    }
  }
  const mark = read.record.child;
```

(j) `server/src/coord/childReclaim.ts`, `childReclaimOutcome`'s step 1. Replace
```ts
  const read = await readSessionRecord(deps.io, deps.cfg, sessionId);
  if (!read.found && read.reason === 'absent') {
    // `absent` is read the way wave 2's `childBindGate` reads it: re-listed ONCE.
    // Absent twice is `gone`; a second listing that still names this id's
    // `.child` (or `.uuid`) — a row that exists and could not be built — is
    // `marker-unreadable`, and so is a second listing that fails. See
    // `childReclaimRowListing`.
    const again = await childReclaimRowListing(deps, sessionId);
    if (again.kind === 'unlistable') return deferred('marker-unreadable', 'the registry could not be listed');
    // The executor's OWN gone-check: `.uuid`-OR-`.child` (fix round 1, review
    // Important #1) — `childReclaimRowListing` no longer folds this for us.
    if (again.uuid || again.child) {
      return deferred('marker-unreadable', 'the registry lists this workspace but its row could not be built');
    }
    // GONE, AND THE MAIL GOES WITH IT. The box half of a reclaim can finish
    // without step 7 ever running: the server restarted between `ws-reclaim`
    // and the cancel, or the verb answered `purge-incomplete` (the row WAS
    // purged, and it reads as `failed`). The next attempt lands HERE, and
    // without this its outstanding mail would wait for `sweepMail`'s
    // abandonment park — listed as a human's to act on — through exactly the
    // slug-recycling window spec §5.6 moved the cancel into this wave to close.
    // Safe: a listing that names neither `<id>.uuid` nor `<id>.child` means no
    // session holds this id now.
    childReclaimCancelMail(deps, sessionId, 'gone');
    return { kind: 'gone', sessionId };
  }
  if (!read.found) return deferred('marker-unreadable', 'the registry could not be listed');
  const mark = read.record.child;
```
with
```ts
  const read = await readSessionRecord(deps.io, deps.cfg, sessionId);
  switch (read.kind) {
    case 'found': break;
    case 'absent': {
      // `absent` is read the way wave 2's `childBindGate` reads it: re-listed ONCE.
      // Absent twice is `gone`; a second listing that still names this id's
      // `.child` (or `.uuid`) — a row that exists and could not be built — is
      // `marker-unreadable`, and so is a second listing that fails. See
      // `childReclaimRowListing`.
      const again = await childReclaimRowListing(deps, sessionId);
      if (again.kind === 'unlistable') return deferred('marker-unreadable', 'the registry could not be listed');
      // The executor's OWN gone-check: `.uuid`-OR-`.child` (fix round 1, review
      // Important #1) — `childReclaimRowListing` no longer folds this for us.
      if (again.uuid || again.child) {
        return deferred('marker-unreadable', 'the registry lists this workspace but its row could not be built');
      }
      // GONE, AND THE MAIL GOES WITH IT. The box half of a reclaim can finish
      // without step 7 ever running: the server restarted between `ws-reclaim`
      // and the cancel, or the verb answered `purge-incomplete` (the row WAS
      // purged, and it reads as `failed`). The next attempt lands HERE, and
      // without this its outstanding mail would wait for `sweepMail`'s
      // abandonment park — listed as a human's to act on — through exactly the
      // slug-recycling window spec §5.6 moved the cancel into this wave to close.
      // Safe: a listing that names neither `<id>.uuid` nor `<id>.child` means no
      // session holds this id now.
      childReclaimCancelMail(deps, sessionId, 'gone');
      return { kind: 'gone', sessionId };
    }
    case 'unlistable': return deferred('marker-unreadable', 'the registry could not be listed');
    // Path identity (spec §2.3): UNMEASURED, never gone. Read as `absent`, an
    // id nothing lists would come out of the re-listing above as `gone`, and
    // the mail addressed to it would be cancelled. A non-registry id was never
    // listed for at all. No listing, no mail cancel, no argv.
    case 'bad-id': return deferred('marker-unreadable', 'the session id is not a registry id');
    default: {
      const _x: never = read;
      return _x;
    }
  }
  const mark = read.record.child;
```

(k) `server/src/coord/childReclaim.ts`, `releaseRetiredChildHold`'s step 1. Replace
```ts
  if (!read.found) return read.reason === 'unlistable' ? 'failed' : 'changed';
```
with
```ts
  switch (read.kind) {
    case 'found': break;
    case 'unlistable': return 'failed';
    case 'absent': return 'changed';
    // An id `isRegistryId` refuses (spec §2.3) answers `changed`, as `absent`
    // does, by design. The row this job relied on cannot be measured, and the
    // id never heals, so a `failed` would retry and warn on every pass.
    // Folding it into `absent` changes nothing observable; its pin is
    // `readSessionRecord`'s zero-listing case.
    case 'bad-id': return 'changed';
    default: {
      const _x: never = read;
      return _x;
    }
  }
```
Then the `childReclaimRowListing` docstring's spelling. Replace
```ts
/** `readSessionRecord`'s `{ found: false, reason: 'absent' }` is TWO
```
with
```ts
/** `readSessionRecord`'s `{ kind: 'absent' }` is TWO
```

(l) `server/src/coord/reclaim.ts`. Five edits, none of them on a line that carries a deviation reference.

First, the stale cites in `measureClaimant`'s docstring. Replace
```ts
 * (registry.ts:929-932) is two lines over `readRegistryMeasured` ending
```
with
```ts
 * (in `registry.ts`) is two lines over `readRegistryMeasured` ending
```
and replace
```ts
 * already had to close on its own registry read (dispatch.ts:462-480, blocking
 * review finding 7). `readSessionRecord` (registry.ts:973) answers `unlistable`
 * and `absent` separately (`SingleRead`, registry.ts:863-866), and nothing below
```
with
```ts
 * already had to close on its own post-spawn registry read (`dispatch.ts`, blocking
 * review finding 7). `readSessionRecord` answers `unlistable`, `absent` and
 * `bad-id` separately (`SingleRead`, one `kind` each), and nothing below
```

Second, the head. The switch classifies every answer. Rung 1 stays the `if` block it is today, so its comment lines do not move. Replace
```ts
  const read = await readSessionRecord(deps.io, deps.cfg, id);
  if (!read.found) {
    if (read.reason === 'unlistable') {
      return { state: 'unmeasurable',
        why: 'the registry directory could not be listed — transient, not a fact about the claimant' };
    }
```
with
```ts
  const read = await readSessionRecord(deps.io, deps.cfg, id);
  switch (read.kind) {
    case 'found': break;
    // Rung 1, below the switch: `absent` is re-split before any verdict.
    case 'absent': break;
    case 'unlistable':
      return { state: 'unmeasurable',
        why: 'the registry directory could not be listed — transient, not a fact about the claimant' };
    // Path identity (spec §2.3): UNMEASURABLE, never dead. `readSessionRecord`
    // answers `bad-id` before any listing, so it proves nothing about the
    // claimant. Read as `absent`, an id nothing lists would reach rung 1's
    // `dead`, and `dead` PROCEEDS: a reclaim, or the dead-coordinator lane's
    // abandon. That lane reaches this arm unmasked.
    case 'bad-id':
      return { state: 'unmeasurable',
        why: 'the claimant id is not a registry id, so it is never measured or composed' };
    default: {
      const _x: never = read;
      return _x;
    }
  }
  if (read.kind !== 'found') {
```
The rung-1 comment block and body that follow, down to `    return { state: 'dead', cause: 'absent', why: 'no registry row in a directory that listed cleanly' };` and the closing `  }`, stay as they are.

Third, the stale cites inside rung 1. Replace
```ts
    // (registry.ts:973, three `reason: 'absent'` returns): the listing did not
```
with
```ts
    // (`readSessionRecord`, three `kind: 'absent'` returns): the listing did not
```
and replace
```ts
    // (routes.ts:578-585: `names.includes(<toId>.uuid)` -> 502
```
with
```ts
    // (`coord/routes.ts`'s mail ingress: `names.includes(<toId>.uuid)` -> 502
```

Fourth, the consumer count in the debt paragraph, the one that opens `THE DEBT THIS DOES NOT PAY`. Replace
```ts
    // considered for this fix and declined on scope, not on merit: `SingleRead`
    // has ~8 consumers (sessionws.ts:500, skillstate.ts:82, server.ts:1532 and
    // 1699, fleet.ts:116, watch.ts:3104, this file's own rung 3 below, and the
    // readiness/hookstate/livestate analogues), each of which needs a deliberate
    // direction rather than a mechanical one, and the ruling that produced this
    // arm is scoped to the one rung that stands in front of a destructive act.
```
with
```ts
    // considered for this fix and declined on scope, not on merit: `SingleRead`
    // had 14 direct consumers (path identity spec §2.3 lists them), each of
    // which needed a deliberate direction rather than a mechanical one, and the
    // ruling that produced this arm is scoped to the one rung that stands in
    // front of a destructive act. Path identity W1a then gave it a `kind` per
    // answer and a fourth answer, `bad-id`, placed in every consumer by an
    // exhaustive switch. `absent` still folds the three conditions above, so
    // this rung's re-split, and the debt it names, both stand.
```

Fifth, `ReclaimOutcome`, `reclaimRun`'s rung 3 and its docstring. Replace
```ts
  // the NEW claimant is a live worker of another run (spec §12)
  | { ok: false; kind: 'heir-is-a-worker'; by: string };
```
with
```ts
  // the NEW claimant is a live worker of another run (spec §12)
  | { ok: false; kind: 'heir-is-a-worker'; by: string }
  // path identity (spec §2.3): an id `isRegistryId` refuses, never measured and
  // never composed. `bad-session` is borrowed too, from `RUN_ROUTE_REFUSE_CODES`.
  // `which` names the refused id; `heir` is the incoming `claimedBy`.
  | { ok: false; kind: 'bad-session'; which: 'heir'; detail: string };
```
Then replace
```ts
 *   3. `to` is a session this box can SEE — else `unknown-session`, or
 *      `registry-unmeasurable` when the directory would not list. Ahead of the
```
with
```ts
 *   3. `to` is a session this box can SEE — else `unknown-session`, or
 *      `registry-unmeasurable` when the directory would not list, or
 *      `bad-session` (`which: 'heir'`) for an id `isRegistryId` refuses, which
 *      `readSessionRecord` answers before any listing (spec §2.3). Ahead of the
```
Then replace
```ts
  const incoming = await readSessionRecord(deps.io, deps.cfg, to);
  if (!incoming.found) {
    if (incoming.reason === 'unlistable') {
      return { ok: false, kind: 'registry-unmeasurable',
        detail: 'the registry directory could not be listed, so the incoming coordinator could not be checked' };
    }
    return { ok: false, kind: 'unknown-session' };
  }
```
with
```ts
  const incoming = await readSessionRecord(deps.io, deps.cfg, to);
  switch (incoming.kind) {
    case 'found': break;
    case 'unlistable':
      return { ok: false, kind: 'registry-unmeasurable',
        detail: 'the registry directory could not be listed, so the incoming coordinator could not be checked' };
    case 'absent': return { ok: false, kind: 'unknown-session' };
    // Path identity (spec §2.3): the heir is gated HERE, by the read's own
    // `bad-id`, before any listing. The route head has no copy that would
    // mask this one. Nothing is re-pointed.
    case 'bad-id':
      return { ok: false, kind: 'bad-session', which: 'heir', detail: 'claimedBy is not a registry id' };
    default: {
      const _x: never = incoming;
      return _x;
    }
  }
```

(m) `server/src/coord/routes.ts`, the reclaim switch. Replace
```ts
      case 'heir-is-a-worker':
        return reply.code(409).send({ ok: false, refused: 'heir-is-a-worker', by: r.by });
```
with
```ts
      case 'heir-is-a-worker':
        return reply.code(409).send({ ok: false, refused: 'heir-is-a-worker', by: r.by });
      // Path identity (spec §2.3): the heir is not a registry id. That is a
      // request defect, answered 400 in `POST /api/runs`' own word, before any
      // listing. `detail` rides along because L1 measured it.
      case 'bad-session':
        return reply.code(400).send({ ok: false, error: 'bad-session', detail: r.detail });
```

- [ ] **Step 5: The tests the new type breaks, in the same commit**

(a) `server/test/registry.test.ts`. Replace every occurrence of each string below (the Edit tool's `replace_all`):
- `{ found: false, reason: 'absent' }` → `{ kind: 'absent' }` (four places);
- `{ found: false, reason: 'unlistable' }` → `{ kind: 'unlistable' }` (one);
- `{ found: true, record: whole.find(` → `{ kind: 'found', record: whole.find(` (one: the whole-registry equality case; the rest of that line, its id literal included, stays byte for byte);
- `single.found && ` → `single.kind === 'found' && ` (two);
- `rec.found && rec.record.held` → `rec.kind === 'found' && rec.record.held` (one);
- in the titles, `{found:false, reason:\'absent\'}` → `{kind:\'absent\'}` (four), and `{found:false, reason:\'unlistable\'}` → `{kind:\'unlistable\'}` (one).

(b) `server/test/child-reclaim.test.ts`. Replace
```ts
    expect(probe, 'the fixture really is the DROPPED population').toEqual({ found: false, reason: 'absent' });
```
with
```ts
    expect(probe, 'the fixture really is the DROPPED population').toEqual({ kind: 'absent' });
```

(c) `server/test/child-reclaim-spent.test.ts` and `server/test/child-reclaim-mark.test.ts`, one line each. Replace
```ts
  if (!r.found) throw new Error(`fixture row not found: ${r.reason}`);
```
with
```ts
  if (r.kind !== 'found') throw new Error(`fixture row not found: ${r.kind}`);
```

(d) `server/test/coord-reclaim.test.ts`. Replace
```ts
 *  and if the row started assembling the read would answer `found: true` and skip
```
with
```ts
 *  and if the row started assembling the read would answer `kind: 'found'` and skip
```
and replace
```ts
    .toEqual({ found: false, reason: 'absent' });
```
with
```ts
    .toEqual({ kind: 'absent' });
```

(e) `server/test/child-reclaim-generation.test.ts`, the close's text pin (slug `generation-pin-follows-kind`). Replace
```ts
      + 'read.found ? childReclaimRowUuid(read.record) : null)'), 'close passes the row its mark read read').toBe(1);
```
with
```ts
      + "read.kind === 'found' ? childReclaimRowUuid(read.record) : null)"), 'close passes the row its mark read read').toBe(1);
```

(f) `server/test/mail-routes.test.ts`, `NOT_CODES` (R20). Replace
```ts
                                  // `rekeyed` and `superseded` are one word each.
    ]);
```
with
```ts
                                  // `rekeyed` and `superseded` are one word each.
      'bad-id',                  // path identity W1a (spec §2.3) — `SingleRead`'s
                                  // word (registry.ts), switched on by the
                                  // `readSessionRecord` callers in this directory.
                                  // A READ RESULT, never a code: no refusal, no
                                  // `error`/`refused`/`reject.code` and no wire
                                  // field ever carries it. Each caller maps it to
                                  // a word of its own (`bad-session`,
                                  // `spent-unmeasured`, `marker-unreadable`).
    ]);
```

(g) Any further file `typecheck-tests` names in Step 6 with a `SingleRead` `found`/`reason` shape is converted the same way (`found: true` → `kind: 'found'`, `{ found: false, reason: X }` → `{ kind: X }`, `x.found` → `x.kind === 'found'`) and added to the commit. Record each such file in the SDD ledger.

- [ ] **Step 6: Run to green**

```bash
cd server && ./node_modules/.bin/vitest run test/single-read-bad-id.test.ts
cd server && ./node_modules/.bin/vitest run test/registry.test.ts test/coord-reclaim.test.ts test/reclaim-route.test.ts \
  test/dead-coordinator-lane.test.ts test/end-dead-coordinator.test.ts
cd server && ./node_modules/.bin/vitest run test/child-reclaim.test.ts test/child-reclaim-bind.test.ts test/child-reclaim-close.test.ts \
  test/child-reclaim-spent.test.ts test/child-reclaim-mark.test.ts test/child-reclaim-generation.test.ts
cd server && ./node_modules/.bin/vitest run test/kickoff-route.test.ts test/swap-route-pool.test.ts test/lifecycle.test.ts \
  test/sessionws.test.ts test/fleet.test.ts test/archive-door.test.ts test/routes.test.ts test/asks-routes.test.ts \
  test/ask-route.test.ts test/stall-sweep.test.ts
cd server && ./node_modules/.bin/vitest run test/mail-routes.test.ts test/divergence-sweep.test.ts test/single-definition.test.ts \
  test/unattended-actor.test.ts test/verb-gate.test.ts test/stored-row-id-gates.test.ts test/knownid-registry-id.test.ts
cd server && ./node_modules/.bin/tsc --noEmit -p . && ./node_modules/.bin/tsc --noEmit -p test/tsconfig.tests.json
cd server && ./node_modules/.bin/vitest run test/typecheck-tests.test.ts
grep -rnE "\bread\.found\b|incoming\.found\b|reason === 'unlistable'" server/src --include=*.ts      # one line only: server/src/watch.ts's worktree census (`read.reason === 'unreachable' || read.reason === 'unlistable'`), a different read that this task does not touch
grep -rn "case 'bad-id'" server/src --include=*.ts | wc -l                                            # 14: one arm per caller
grep -rnE 'readSessionRecord\(' server/src --include=*.ts | grep -vE 'export async function|^\S+:[0-9]+:\s+(//|\*)' | wc -l   # 14: unchanged
git diff --stat HEAD -- shared ccd agent pwa README.md server/src/watch.ts server/src/coord/dispatch.ts server/src/coord/store.ts   # prints nothing
```

Expected:
- `single-read-bad-id`: `Test Files  1 passed (1)`, with 12 cases green. The count is derived, not measured: re-measure it.
- Every other listed suite is green. `registry` re-checks the `[registry-read-census:*]` claims in the docstrings this task touched.
- `typecheck-tests` and `stall-sweep` are known load flakes: re-run either in isolation before calling it red.
- Both `tsc` runs print nothing. The greps print as stated, and the `git diff --stat` prints nothing.
- An existing suite may go red because its fixture hands one of the fourteen callers an id that fails the predicate (a leading `-` or `.`, a space, more than 255 characters). The read is then right, and the fixture predates it. STOP and report `existing-fixture-id-fails-the-predicate` with the file and the title. Do not loosen the read.

- [ ] **Step 7: Mutation table**

Apply each mutation alone, run its command from `server/`, see the red, and revert it before the next. S is `./node_modules/.bin/vitest run test/single-read-bad-id.test.ts`. Every red text below is derived, not measured: measure each one and record it, before and after, in the SDD ledger. Each fold row is measured against an UNLISTED bad id (R15).

| # | Mutation (exact edit) | Command | Expected red |
|---|---|---|---|
| T4.1 | `readSessionRecord`: delete `if (!isRegistryId(id)) return { kind: 'bad-id' };` | S | Every case but the control. The zero-listing case: `expected { kind: 'found', record: { … } } to deeply equal { kind: 'bad-id' }`. `measureClaimant` (unlisted): `dead`. The lane: `expected 'failed' to be 'working'`. `childBindGate`: `{ ok: true }`. `reclaimChild`: `gone`. `childGateAtClose`: `not-a-child`. The routes: `/kickoff` `expected 200 to be 400`. The reclaim door: `expected 404 to be 400`. The ask: `expected 200 to be 409` (the answer is taken) |
| T4.2 | `readSessionRecord`: move the guard to just below `noteWholeFleetListing(names !== null, now);` | S | two cases, each on its listing count only: the zero-listing case (`no listing is spent on an id ccd could read as a flag: expected 1 to be 0`), and `childGateAtClose(--actor) …` (`nothing ever listed this id, so nothing is re-listed for it: expected 1 to be 0`), whose io counts every `readdir` |
| T4.3 | `measureClaimant`: fold — delete the `case 'bad-id':` arm and write `case 'absent': case 'bad-id': break;` (rung 1's `if (read.kind !== 'found')` then admits it) | S | `measureClaimant('--actor') is unmeasurable, never dead`: `expected { state: 'dead', cause: 'absent', … } to deeply equal { state: 'unmeasurable', … }`; `with its row planted`: rung 1's listed-but-unassembled `why`; the lane: `never abandoned: expected 'failed' to be 'working'` |
| T4.4 | `childBindGate`: fold — delete the `case 'bad-id':` arm and write `case 'absent': case 'bad-id': {` | S | `expected { ok: true } to deeply equal { ok: false, code: 'spent-unmeasured', … }` |
| T4.5 | `childReclaimOutcome`: fold — delete the `case 'bad-id':` arm and write `case 'absent': case 'bad-id': {` | S | `expected { kind: 'gone', sessionId: '--actor' } to deeply equal { kind: 'deferred', … }` (the mail is cancelled) |
| T4.6 | `childGateAtClose`: fold — delete the `case 'bad-id':` arm and write `case 'absent': case 'bad-id': {` (R17 amendment) | S | `expected { decision: { reclaim: false, why: 'not-a-child' }, request: null } to deeply equal { decision: { reclaim: false, why: 'marker-unreadable' }, … }` |
| T4.7 | `/kickoff`: fold — delete the `case 'bad-id':` arm and write `case 'absent': case 'bad-id': return reply.code(404)…` | S | the routes case: `expected 404 to be 400` (at `/kickoff`) |
| T4.8 | `/stop`: the same fold | S | the routes case: `expected 404 to be 400` (at `/stop`) |
| T4.9 | `/swap`'s ordinary arm: the same fold | S | the routes case: `expected 404 to be 400` (at `/swap`) |
| T4.10 | `reclaimRun`'s heir: fold — delete the `case 'bad-id':` arm and write `case 'absent': case 'bad-id': return { ok: false, kind: 'unknown-session' };` | S | the reclaim case: `expected 404 to be 400` (`unknown-session`) |
| T4.11 | `routes.ts`'s reclaim switch: `case 'bad-session': return reply.code(400)…` → `return reply.code(404).send({ ok: false, error: 'unknown-session' });` | S | the reclaim case: `expected 404 to be 400` |
| T4.12 | `childBindGate`: delete the `case 'bad-id':` arm and its return, with no fold | `./node_modules/.bin/tsc --noEmit -p .` | `src/coord/childBind.ts(…): error TS2322: Type '{ kind: "bad-id"; }' is not assignable to type 'never'.` (the exhaustive check) |

By design, these arms answer as `absent` does, so a fold changes nothing observable and they get no row:
- `sessionws`, `freshAskAt` and `releaseRetiredChildHold`. Their pin is the zero-listing case (T4.1, T4.2). `freshAskAt`'s path is also pinned end to end by the ask case.
- The masked arms (`/archive`, `readAsk` and `liveStatus`) answer the safe word and name their mask (R17).

After each mutation, revert it. Then re-run Step 6's first command green, and `git diff --stat` must show only this task's files.

- [ ] **Step 8: Commit**

```bash
git add server/src/registry.ts server/src/fleet.ts server/src/sessionws.ts server/src/server.ts \
  server/src/coord/close.ts server/src/coord/childBind.ts server/src/coord/childReclaim.ts \
  server/src/coord/reclaim.ts server/src/coord/routes.ts \
  server/test/single-read-bad-id.test.ts server/test/registry.test.ts server/test/child-reclaim.test.ts \
  server/test/child-reclaim-spent.test.ts server/test/child-reclaim-mark.test.ts server/test/coord-reclaim.test.ts \
  server/test/child-reclaim-generation.test.ts server/test/mail-routes.test.ts
git commit -m "$(cat <<'MSG'
refactor(registry): SingleRead answers bad-id, and every caller places it

readSessionRecord now answers a kind per result: found, absent,
unlistable or bad-id. It answers bad-id for an id isRegistryId refuses,
before the clock, the listing or any field read (spec 2.3). Each of its
fourteen callers places the new answer in an exhaustive switch.

The four callers that act on absence read bad-id as unmeasured:
- measureClaimant answers unmeasurable, never dead;
- childBindGate refuses spent-unmeasured;
- the reclaim executor defers marker-unreadable and keeps its mail;
- the close's child gate reads the mark unreadable, with no second
  listing. That gate is exported for its pin.

/kickoff, /stop and the ordinary /swap answer 400 bad-session-id. The
reclaim door answers 400 bad-session for an heir that is not a registry
id. The arms that knownId or a stored-id check already masks answer the
safe word and name their mask.

bad-id joins the kebab scan's NOT_CODES: it is a read result, and no
refusal or wire field carries it.
MSG
)"
```

If Step 5 (g) converted a further file, add it to the `git add` line.

---

### Task 5: `RegistryRead.refused`, the refused-name log, and the reader census

**Model routing:** `opus`, effort `high`.

**Why:**
- **R2: the refused set.** `RegistryRead.refused` holds IDS: each `.uuid` basename minus `.uuid`. A refused row is never read, never built and never composed. Each refused id is logged once, quoted by `JSON.stringify`. The log uses its own module-private `refusedLogged` set, which is pruned on every listing to the current refused set. It never uses `warnState`. `pruneWarnState` gets an id back as `key.slice(0, key.indexOf('#'))`, and a raw file name may contain `#`. If refused names were keyed there, `a#b` would be pruned as `a` on every listing and logged again every 2 s.
- **R25: the census starts `unplaced`.** All 19 consumer sites get the tag `[registry-refused:unplaced]`. `readRegistry`'s own `readRegistryMeasured(` call gets `[registry-refused:wrapper]`. `unplaced` describes no behaviour. Tasks 6, 7 and 8 replace each `unplaced` with its placed word and pin it, and Task 8 leaves none. So no commit carries a tag that describes behaviour that does not exist yet.
- **Omission reaches every reader at once.** After this commit no `records` array holds a refused row. That covers every `readRegistry` caller and every `readRegistryMeasured` caller. So this task runs the FULL server suite, not only its own files.
- **Census sentences stay intact (Global Constraints).** `registry.test.ts`'s `taggedRegistryCensusClaims` joins every comment line of a file into one text. It then reads `(\d+)\s+[^\d\n]{0,40}?\[registry-read-census:…\]`. So **every tag comment this task adds contains no digit**, and none is inserted between an existing number and its `[registry-read-census:*]` tag. No `[registry-read-census:*]` sentence is edited.
- **Guard placement.** Each tag line goes directly above its call line, at the call's own indentation. Nothing is put on a call-site line, and no signature is wrapped. This task edits `watch.ts`, `coord/dispatch.ts` and `coord/routes.ts`, so it runs `unattended-actor` and `verb-gate`.

**Entry (measured in Step 0):** Tasks 1 to 4 are committed on this branch. Task 1's `isRegistryId` is at `shared/api.ts`'s foot. Task 4's `readSessionRecord` answers `{ kind: 'bad-id' }`, so `server/src/registry.ts` already imports `isRegistryId` from `../../shared/api.js`.

**Files:**
- Modify `server/src/registry.ts`:
  - (a) Add the module-private `refusedLogged` and `noteRefused`. They go immediately above the `RegistryRead` docstring, which opens `/** The whole-fleet read, typed (architecture doc, increment 1's second half):` (`:1093` at `837a099c0`; `grep -n "The whole-fleet read, typed" server/src/registry.ts`).
  - (b) `RegistryRead`: its docstring gains a `refused` paragraph, and its listed arm gains `refused: ReadonlySet<string>`. The type is at `:1110` at `837a099c0` (`grep -n "^export type RegistryRead =" server/src/registry.ts`).
  - (c) `readRegistryMeasured`: the id split before the loop, and `refused` on both listed returns (`grep -n "^export async function readRegistryMeasured" server/src/registry.ts`).
  - (d) `readRegistry`: one tag line above its `readRegistryMeasured(` call.
- Modify (one comment line each, nothing else) at the 19 consumer sites. Each is located in Step 4 by its quoted content:
  - `server/src/commands.ts` (`sessionCommands`);
  - `server/src/lifecycle.ts` (`listProjects`);
  - `server/src/fleet.ts` (`assembleFleet`);
  - `server/src/server.ts` (`prTasks`);
  - `server/src/watch.ts` (`tick`, `sweepHookStates`, `sweepTasks`, `sweepNames`, `sweepMail`, `sweepPr`, `detectDialogs`);
  - `server/src/coord/routes.ts` (`requireAttribution`, `POST /api/mail`, `POST /api/mail/:id/ack`, `GET /api/peers`);
  - `server/src/coord/dispatch.ts` (`dispatchRun`'s three reads);
  - `server/src/coord/fingerprint.ts` (`resolveDoneBranch`).
- Create `server/test/registry-refused.test.ts`.
- Create `server/test/registry-refused-census.test.ts`. Tasks 6, 7 and 8 edit its `EXPECTED_SITES` and add describes.
- Modify `server/test/run-route-route.test.ts`: the one case titled `'409s bad-session for target worker when the dispatched sessionId is not a legal shape (a routable record, so without the guard this would 200 and write an unparseable event)'`. Locate it with `grep -n "wsAddCreates: \['bad worker'\]" server/test/run-route-route.test.ts`. Its setup now seeds the stored `sessionId` through the store (`markDispatched`) instead of the dispatch route. Its title and its three assertions stay as they are.
- Modify any further test that Step 8's full run shows planting a non-registry id as a fresh registry row (Step 8 (c)). Step 0's scan found none besides `'bad worker'`.
- No edit to `shared/api.ts`, `README.md` or any other file. No `[registry-read-census:*]` sentence changes.

**Interfaces:**
- Consumes:
  ```ts
  // shared/api.ts foot (Task 1), already imported by server/src/registry.ts (Task 4)
  export function isRegistryId(id: unknown): id is string;
  // server/test/sourceScan.ts
  export const codeOnly: (s: string) => string;
  // server/src/registry.ts, unchanged signatures
  export async function readRegistryMeasured(io: FleetIO, cfg: CcrcConfig): Promise<RegistryRead>;
  export async function readRegistry(io: FleetIO, cfg: CcrcConfig): Promise<SessionRecord[]>;
  // server/src/coord/store.ts, unchanged
  CoordStore.markDispatched(runId: number, sessionId: string, workspace: string | null, branch: string | null,
                            resumed: boolean, at?: number): void;
  ```
- Produces:
  ```ts
  // server/src/registry.ts
  export type RegistryRead =
    | { listed: true; records: SessionRecord[]; names: readonly string[]; refused: ReadonlySet<string> }
    | { listed: false };
  // module-private (R2)
  const refusedLogged = new Set<string>();
  function noteRefused(refused: ReadonlySet<string>): void;
  //   one console.warn per id while it stays listed:
  //   `ccrc-server: registry lists ${JSON.stringify(`${id}.uuid`)}, which is not a registry id — it is never read and never composed`
  ```
  - The census vocabulary: the tag form `[registry-refused:<word>]`, in a comment within the 3 lines above each `readRegistry(` or `readRegistryMeasured(` call.
  - The words are `holds`, `refuses`, `gated`, `omits`, `stale`, `reports`, `tests-only`, `knownId`, `raw-name`, `wrapper` and `unplaced`. `wrapper` is reserved for `readRegistry`'s own call.

---

- [ ] **Step 0: Measure the entry conditions (nothing is written)**

Run from the workspace root:

```bash
grep -c '^export function isRegistryId(' shared/api.ts                                              # 1: Task 1 landed
grep -c "if (!isRegistryId(id)) return { kind: 'bad-id' };" server/src/registry.ts                  # 1: Task 4 landed
grep -c 'isRegistryId' server/src/registry.ts                                                       # >= 2: imported and called
grep -rnE 'readRegistryMeasured\(' server/src --include=*.ts | grep -vc 'export async function'     # (c5) 8: seven callers and the wrapper
grep -rnE '(await|\?\?|\() *readRegistry\(' server/src --include=*.ts | grep -vE '^\S+:[0-9]+:\s+(//|\*)' | wc -l   # (c6) 12
grep -rn 'registry-refused' server/src server/test | wc -l                                          # 0: no tag exists yet
grep -c "wsAddCreates: \['bad worker'\]" server/test/run-route-route.test.ts                         # 1: the case Step 1 (c) rewrites
```

If Task 0 recorded run 400 as `not-open`, re-run (d5):

```bash
gh pr list --state all --json number,state,title -q '.[] | "\(.number) \(.state) \(.title)"' | grep -i 'collector' | grep -i 'wave 10\|settings'
```

Record every answer in the SDD ledger. Apply these rules:
- If the first three lines do not read as stated, Tasks 1 or 4 have not landed: STOP, `task-4-not-landed`.
- A different (c5) or (c6) count is not a STOP. Re-point by content and record the new figure. A new call site also joins Step 1's `EXPECTED_SITES` as `unplaced`.
- If a tag already exists, STOP: `registry-refused-owned-elsewhere`.

- [ ] **Step 1: Write the failing tests**

(a) Create `server/test/registry-refused.test.ts`:

```ts
// Path identity W1a (spec §2.3): `readRegistryMeasured` names every listed
// `.uuid` whose id is not a registry id in `refused`. It never reads or
// builds such a row and never puts it in `records`. It keeps the raw name in
// `names`, because `names` is the listing, not a list of sessions. It logs
// each refused id once while it stays listed.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { loadConfig, type CcrcConfig } from '../src/config.js';
import { localIO, type FleetIO } from '../src/io.js';
import { readRegistry, readRegistryMeasured, type RegistryRead } from '../src/registry.js';
import { mkTmp } from './tmpHelpers.js';
import { seedRoster } from './helpers.js';

const VALID = 'demo-quiet-basin';
/** Sorted, the order `readRegistryMeasured` builds `refused` in. */
const REFUSED: readonly string[] = ['--actor', '.hidden', 'a#b'];

/** A row `buildRecord` keeps: wrapper, workdir and uuid, the same fields registry.test.ts seeds. */
const seedRow = (reg: string, id: string): void => {
  const fields: Record<string, string> = { wrapper: 'claude', project: 'demo', workdir: '/w', uuid: `u-${id}` };
  for (const [k, v] of Object.entries(fields)) writeFileSync(path.join(reg, `${id}.${k}`), v);
};

const homeWithRegistry = (): { reg: string; cfg: CcrcConfig } => {
  const home = mkTmp('ccrc-refused-');
  seedRoster(home);
  const reg = path.join(home, '.cc-sessions');
  mkdirSync(reg, { recursive: true });
  return { reg, cfg: loadConfig({ CCRC_HOME: home }) };
};

const listedOf = (read: RegistryRead): Extract<RegistryRead, { listed: true }> => {
  if (!read.listed) throw new Error('setup: the fixture registry must list');
  return read;
};

const refusedLine = (id: string): string =>
  `ccrc-server: registry lists ${JSON.stringify(`${id}.uuid`)}, which is not a registry id — it is never read and never composed`;

/** localIO, with the first argument of every call recorded when it is a path. */
const recordingIO = (touched: string[]): FleetIO => new Proxy(localIO, {
  get(target, key, receiver) {
    const value: unknown = Reflect.get(target, key, receiver);
    if (typeof value !== 'function') return value;
    return (...args: unknown[]): unknown => {
      if (typeof args[0] === 'string') touched.push(args[0]);
      return (value as (...a: unknown[]) => unknown).apply(target, args);
    };
  },
});

describe('readRegistryMeasured names refused rows and never reads them (spec §2.3)', () => {
  let warnSpy: ReturnType<typeof vi.spyOn>;
  const refusedLines = (): string[] =>
    warnSpy.mock.calls.map((c) => String(c[0])).filter((l) => l.includes('which is not a registry id')).sort();

  beforeEach(async () => {
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    // `refusedLogged` is module state. One listing that refuses nothing prunes
    // it, so every case starts with no name logged.
    await readRegistryMeasured(localIO, homeWithRegistry().cfg);
    warnSpy.mockClear();
  });
  afterEach(() => {
    warnSpy.mockRestore();
  });

  it('--actor.uuid, .hidden.uuid and a#b.uuid beside a valid row', async () => {
    const { reg, cfg } = homeWithRegistry();
    seedRow(reg, VALID);
    for (const id of REFUSED) seedRow(reg, id);
    const read = listedOf(await readRegistryMeasured(localIO, cfg));
    expect([...read.refused].sort()).toEqual([...REFUSED]);
    expect(read.records.map((r) => r.id)).toEqual([VALID]);
    // `names` is the listing, not a list of sessions: every raw name stays.
    expect([...read.names].sort()).toEqual((await localIO.readdir(reg))!.sort());
    expect(read.names).toEqual(expect.arrayContaining(REFUSED.map((id) => `${id}.uuid`)));
  });

  it('a refused row costs zero field reads', async () => {
    const { reg, cfg } = homeWithRegistry();
    seedRow(reg, VALID);
    for (const id of REFUSED) seedRow(reg, id);
    const touched: string[] = [];
    listedOf(await readRegistryMeasured(recordingIO(touched), cfg));
    // CONTROL: the recorder does see the valid row's field reads.
    expect(touched.some((p) => path.basename(p).startsWith(`${VALID}.`))).toBe(true);
    expect(touched.filter((p) => REFUSED.some((id) => path.basename(p).startsWith(`${id}.`)))).toEqual([]);
  });

  it('each refused name is logged once while it stays listed, quoted by JSON.stringify', async () => {
    const { reg, cfg } = homeWithRegistry();
    seedRow(reg, VALID);
    seedRow(reg, '--actor');
    writeFileSync(path.join(reg, 'x\ny.uuid'), 'u');
    await readRegistryMeasured(localIO, cfg);
    await readRegistryMeasured(localIO, cfg);
    expect(refusedLines()).toEqual([refusedLine('--actor'), refusedLine('x\ny')].sort());
    // A newline in a file name cannot forge a second log line.
    expect(refusedLines().every((l) => !l.includes('\n'))).toBe(true);
  });

  it('a name that leaves and returns is logged again', async () => {
    const { reg, cfg } = homeWithRegistry();
    seedRow(reg, VALID);
    writeFileSync(path.join(reg, '--actor.uuid'), 'u');
    await readRegistryMeasured(localIO, cfg);
    expect(refusedLines()).toEqual([refusedLine('--actor')]);
    rmSync(path.join(reg, '--actor.uuid'));
    await readRegistryMeasured(localIO, cfg);
    expect(refusedLines()).toEqual([refusedLine('--actor')]);
    writeFileSync(path.join(reg, '--actor.uuid'), 'u');
    await readRegistryMeasured(localIO, cfg);
    expect(refusedLines()).toEqual([refusedLine('--actor'), refusedLine('--actor')]);
  });

  it('a refused name holding # does not re-log on every call', async () => {
    const { reg, cfg } = homeWithRegistry();
    seedRow(reg, VALID);
    writeFileSync(path.join(reg, 'a#b.uuid'), 'u');
    await readRegistryMeasured(localIO, cfg);
    await readRegistryMeasured(localIO, cfg);
    await readRegistryMeasured(localIO, cfg);
    expect(refusedLines()).toEqual([refusedLine('a#b')]);
  });

  it('the retired-row early return carries refused', async () => {
    const { reg, cfg } = homeWithRegistry();
    seedRow(reg, VALID);
    writeFileSync(path.join(reg, '--actor.uuid'), 'u');
    let listings = 0;
    // The valid row's identity reads unreadable, so the read takes its ONE
    // second listing. That listing no longer names the valid row's `.uuid`,
    // so the row retires and the read leaves by its early return.
    const reapedMidRead: FleetIO = {
      ...localIO,
      readdir: async (p) => {
        const names = await localIO.readdir(p);
        if (names === null || p !== cfg.registryDir) return names;
        listings += 1;
        return listings === 1 ? names : names.filter((n) => n !== `${VALID}.uuid`);
      },
      readFileMeasured: async (p) => (p.endsWith(`${VALID}.wrapper`)
        ? { ok: false, reason: 'unreadable' }
        : localIO.readFileMeasured(p)),
    };
    const read = listedOf(await readRegistryMeasured(reapedMidRead, cfg));
    expect(listings).toBe(2);
    expect(read.records).toEqual([]);
    expect([...read.refused]).toEqual(['--actor']);
  });

  it('readRegistry still answers records only', async () => {
    const { reg, cfg } = homeWithRegistry();
    seedRow(reg, VALID);
    seedRow(reg, '--actor');
    const recs = await readRegistry(localIO, cfg);
    expect(Array.isArray(recs)).toBe(true);
    expect(recs.map((r) => r.id)).toEqual([VALID]);
  });
});
```

(b) Create `server/test/registry-refused-census.test.ts`:

```ts
// Path identity W1a (spec §2.3): every `readRegistry(` and
// `readRegistryMeasured(` call in server/src is classified by what it does
// with a REFUSED row: a listed `.uuid` whose id is not a registry id.
// `readRegistryMeasured` names such a row in `refused` and leaves it out of
// `records`. The classification is a comment tag, `[registry-refused:<word>]`,
// within the three lines above the call. The suite goes red on any of these:
// - a new call with no tag;
// - a tag with no call;
// - a word outside the vocabulary;
// - a site that moves to another function or route.
//
// `unplaced` describes no behaviour. It marks a caller whose handling of a
// refused row is not built yet. Later tasks of this wave replace each one
// with its placed word and pin the behaviour, and the last of them leaves
// none. `wrapper` is reserved for `readRegistry`'s own read.
//
// Tag comments in server/src carry no digit. registry.test.ts's census-claim
// parser joins every comment line of a file and reads a number followed,
// within forty characters, by a `[registry-read-census:*]` tag. A digit in a
// tag line could create or hide such a claim.
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { codeOnly } from './sourceScan.js';

const srcRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'src');

/** The census vocabulary. */
const WORDS: readonly string[] = [
  'holds', 'refuses', 'gated', 'omits', 'stale', 'reports', 'tests-only', 'knownId', 'raw-name', 'wrapper', 'unplaced',
];

const TAG = /\[registry-refused:([A-Za-z-]+)\]/;
const TAGS = /\[registry-refused:[A-Za-z-]+\]/g;
const READER_CALL = /\b(readRegistryMeasured|readRegistry)\s*\(/g;

/** The scope a call is classified under: the nearest line above it, the call's own line
 *  included, that registers a route or declares a function, an async arrow or an async
 *  class method. Matched on `codeOnly` lines, where string literals (route paths) survive. */
const ROUTE = /\bapp\.(get|post|put|delete|patch)\s*(?:<[^>]*>)?\(\s*'([^']+)'/;
const FUNC = /^\s*(?:export\s+)?(?:async\s+)?function\s*\*?\s*(\w+)/;
const ARROW = /^\s*(?:export\s+)?(?:const|let)\s+(\w+)\s*=\s*async\b/;
const METHOD = /^ {2}(?:(?:private|protected|public|static)\s+)*async\s+(\w+)\s*[<(]/;

interface Site { file: string; line: number; enclosing: string; reader: string; word: string | null }

/** `codeOnly`'s output with every '…' and "…" literal blanked to spaces, so a quoted
 *  reader name is not a call. A template literal is kept as code: a reader named in
 *  one reads as a call, the safe direction (a false red, never a missed call). */
const blankQuoted = (code: string): string =>
  code.replace(/`(?:\\[\s\S]|[^\\`])*`|'(?:\\.|[^\\'\n])*'|"(?:\\.|[^\\"\n])*"/g,
    (m) => (m.startsWith('`') ? m : m.replace(/[^\n]/g, ' ')));

const enclosingOf = (codeLines: readonly string[], at: number): string => {
  for (let k = at; k >= 0; k--) {
    const l = codeLines[k];
    const route = l.match(ROUTE);
    if (route) return `${route[1].toUpperCase()} ${route[2]}`;
    const named = l.match(FUNC) ?? l.match(ARROW) ?? l.match(METHOD);
    if (named) return named[1];
  }
  return '?';
};

/** The nearest tag in a COMMENT on the three lines above `at`. A tag inside a string is no tag. */
const tagAbove = (raw: readonly string[], codeLines: readonly string[], at: number): string | null => {
  for (let k = at - 1; k >= Math.max(0, at - 3); k--) {
    const t = raw[k].match(TAG);
    if (t && !TAG.test(codeLines[k])) return t[1];
  }
  return null;
};

/** Every reader call in `src`. The definitions (`function readRegistry(`) are not calls. */
const scan = (file: string, src: string): Site[] => {
  const raw = src.split('\n');
  const code = codeOnly(src);
  const codeLines = code.split('\n');
  const callLines = blankQuoted(code).split('\n');
  const sites: Site[] = [];
  callLines.forEach((l, i) => {
    for (const m of l.matchAll(READER_CALL)) {
      if (/\bfunction\s+$/.test(l.slice(0, m.index ?? 0))) continue;
      sites.push({ file, line: i + 1, enclosing: enclosingOf(codeLines, i), reader: m[1], word: tagAbove(raw, codeLines, i) });
    }
  });
  return sites;
};

/** Tags in comments: every tag in the source, less those `codeOnly` keeps (strings). */
const commentTagCount = (src: string): number =>
  (src.match(TAGS) ?? []).length - (codeOnly(src).match(TAGS) ?? []).length;

/** Every `.ts` under server/src, recursively. */
const sources = (dir = srcRoot): string[] =>
  readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) return sources(full);
    return /\.ts$/.test(e.name) ? [full] : [];
  });

const rel = (f: string): string => path.relative(srcRoot, f).split(path.sep).join('/');
const allSites = (): Site[] => sources().flatMap((f) => scan(rel(f), readFileSync(f, 'utf8')));
const key = (s: Site): string => `${s.file} | ${s.enclosing} | ${s.reader} | ${s.word}`;
const where = (s: Site): string => `${s.file}:${s.line}`;

/** The classified set, as the tree stands. Later tasks of this wave place each `unplaced`. */
const EXPECTED_SITES: readonly string[] = [
  'commands.ts | sessionCommands | readRegistry | unplaced',
  'coord/dispatch.ts | dispatchRun | readRegistry | unplaced',
  'coord/dispatch.ts | dispatchRun | readRegistryMeasured | unplaced',
  'coord/dispatch.ts | dispatchRun | readRegistryMeasured | unplaced',
  'coord/fingerprint.ts | resolveDoneBranch | readRegistryMeasured | unplaced',
  'coord/routes.ts | GET /api/peers | readRegistry | unplaced',
  'coord/routes.ts | POST /api/mail | readRegistry | unplaced',
  'coord/routes.ts | POST /api/mail/:id/ack | readRegistry | unplaced',
  'coord/routes.ts | requireAttribution | readRegistry | unplaced',
  'fleet.ts | assembleFleet | readRegistry | unplaced',
  'lifecycle.ts | listProjects | readRegistry | unplaced',
  'registry.ts | readRegistry | readRegistryMeasured | wrapper',
  'server.ts | prTasks | readRegistry | unplaced',
  'watch.ts | detectDialogs | readRegistry | unplaced',
  'watch.ts | sweepHookStates | readRegistryMeasured | unplaced',
  'watch.ts | sweepMail | readRegistryMeasured | unplaced',
  'watch.ts | sweepNames | readRegistry | unplaced',
  'watch.ts | sweepPr | readRegistry | unplaced',
  'watch.ts | sweepTasks | readRegistryMeasured | unplaced',
  'watch.ts | tick | readRegistryMeasured | unplaced',
];

describe('every registry reader call is classified for refused rows (spec §2.3)', () => {
  it('CONTROL: the scan sees a call, and ignores a comment, a string and the definitions', () => {
    const CONTROL = [
      '// readRegistry(io, cfg) named in a comment is not a call',
      "const quoted = 'readRegistryMeasured(io, cfg)';",
      'export async function readRegistryMeasured(io: FleetIO, cfg: CcrcConfig): Promise<RegistryRead> {',
      '  return { listed: false };',
      '}',
      'export async function readRegistry(io: FleetIO, cfg: CcrcConfig): Promise<SessionRecord[]> {',
      '  // [registry-refused:wrapper] the tagged call',
      '  const r = await readRegistryMeasured(io, cfg);',
      '  return r.listed ? r.records : [];',
      '}',
      'export async function untagged(io: FleetIO, cfg: CcrcConfig): Promise<number> {',
      "  const label = '[registry-refused:holds]';",
      '  return (await readRegistry(io, cfg)).length + label.length;',
      '}',
      "app.get('/api/demo', async (req, reply) => {",
      '  // [registry-refused:omits] a route',
      '  return reply.send(await readRegistry(io, cfg));',
      '});',
    ].join('\n');
    expect(scan('control.ts', CONTROL).map(key)).toEqual([
      'control.ts | readRegistry | readRegistryMeasured | wrapper',
      'control.ts | untagged | readRegistry | null',
      'control.ts | GET /api/demo | readRegistry | omits',
    ]);
    // The quoted tag is no tag: two comment tags, not three.
    expect(commentTagCount(CONTROL)).toBe(2);
  });

  it('each readRegistry( and readRegistryMeasured( call carries a [registry-refused:<word>] tag within three lines above it', () => {
    const sites = allSites();
    expect(sites.length, 'the scan found no reader call: this guard is measuring nothing').toBeGreaterThan(0);
    expect(sites.filter((s) => s.word === null).map(where), 'an untagged reader call').toEqual([]);
    expect(sites.filter((s) => s.word !== null && !WORDS.includes(s.word)).map((s) => `${where(s)} ${s.word}`),
      'a word outside the census vocabulary').toEqual([]);
    const tags = sources().reduce((n, f) => n + commentTagCount(readFileSync(f, 'utf8')), 0);
    expect(tags, 'a [registry-refused:*] tag that stands above no reader call').toBe(sites.length);
  });

  it('the classified set is exactly these 20 sites', () => {
    expect(EXPECTED_SITES).toHaveLength(20);
    expect(allSites().map(key).sort()).toEqual([...EXPECTED_SITES].sort());
  });

  it('wrapper is used once, in registry.ts, inside readRegistry', () => {
    expect(allSites().filter((s) => s.word === 'wrapper').map(key))
      .toEqual(['registry.ts | readRegistry | readRegistryMeasured | wrapper']);
  });
});
```

(c) In `server/test/run-route-route.test.ts`, rewrite the setup of the one case found by `grep -n "wsAddCreates: \['bad worker'\]"`. Before:

```ts
    const home = mkTmp('ccrc-route-');
    const { run } = makeRunner(home, { wsAddCreates: ['bad worker'] });
    const w = await openApp(home, run, { fleetState: ROUTE_READY_FLEET }); app = w.app;
    const { id, sid } = await dispatchedRun(w.app, 'bad worker');
    seed(home, sid, { class: 'opus', effort: 'high' });
```

After:

```ts
    const home = mkTmp('ccrc-route-');
    const { run } = makeRunner(home);
    const w = await openApp(home, run, { fleetState: ROUTE_READY_FLEET }); app = w.app;
    // Seeded through the store, not the dispatch route (path identity, spec
    // §2.3). `readRegistryMeasured` refuses a listed row whose id is not a
    // registry id, so a fresh dispatch can no longer adopt `bad worker` as its
    // spawn. The stored row this door reads is one a build before that
    // refusal could have written.
    const opened = (await postOpen(w.app)).json() as { id: number };
    const id = opened.id;
    const sid = 'bad worker';
    w.coord.markDispatched(id, sid, sid, `ws/${sid}`, false);
    w.coord.db.prepare("UPDATE runs SET state = 'dispatched' WHERE id = ?").run(id);
    seed(home, sid, { class: 'opus', effort: 'high' });
```

The case's title and its remaining lines stay byte for byte:

```ts
    const res = await postRoute(w.app, id, { target: 'worker', why: 'x', kind: 'shallow' });
    expect(res.statusCode).toBe(409);
    expect(res.json()).toEqual({ ok: false, error: 'bad-session' });
    expect(w.coord.runEvents(id).some((e) => e.detail?.startsWith('route:'))).toBe(false);
```

- [ ] **Step 2: Run the tests to verify they fail**

```bash
cd server && ./node_modules/.bin/vitest run test/registry-refused.test.ts test/registry-refused-census.test.ts test/run-route-route.test.ts
```

Run it in the foreground, with a timeout of at least 600000 ms. Expected:
- `registry-refused.test.ts`: all seven cases FAIL.
  - The first case and `the retired-row early return carries refused` fail with `TypeError: read.refused is not iterable`.
  - `a refused row costs zero field reads` fails with `expected [ '<home>/.cc-sessions/--actor.wrapper', … ] to deeply equal []`.
  - The three log cases fail with `expected [] to deeply equal [ 'ccrc-server: registry lists "--actor.uuid", … ]`, or the `a#b` equivalent.
  - `readRegistry still answers records only` fails with `expected [ '--actor', 'demo-quiet-basin' ] to deeply equal [ 'demo-quiet-basin' ]`.
- `registry-refused-census.test.ts`: the CONTROL PASSES, because the scanner is pure. The other three FAIL:
  - `an untagged reader call: expected [ 'commands.ts:52', … ] to deeply equal []` (20 entries);
  - the multiset, with every word `null`;
  - `expected [] to deeply equal [ 'registry.ts | readRegistry | readRegistryMeasured | wrapper' ]`.
- `run-route-route.test.ts` PASSES. The rewrite is valid both before and after the implementation. Under Step 3 it is the only form of the case that can still set up.

Record each red text in the SDD ledger.

- [ ] **Step 3: Implement `server/src/registry.ts`**

(a) Insert `refusedLogged` and `noteRefused` immediately ABOVE the line `/** The whole-fleet read, typed (architecture doc, increment 1's second half):`. Before:

```ts
/** The whole-fleet read, typed (architecture doc, increment 1's second half):
```

After:

```ts
/** Path identity (spec §2.3): the refused ids already logged. A refused id is a
 *  listed `.uuid` basename, minus `.uuid`, that is not a registry id. This set is
 *  SEPARATE from `warnState` on purpose. `pruneWarnState` gets an id back as
 *  everything before a key's first `#`, and a refused name is an arbitrary file
 *  name that may hold one. Keyed there, `a#b` would be pruned as `a` on every
 *  listing and logged again on every tick. */
const refusedLogged = new Set<string>();

/** One `console.warn` per refused id while it stays listed. The set is pruned to
 *  the current refused set first, so a name that leaves the listing and comes
 *  back is logged again. The name is quoted by `JSON.stringify`, so a newline or
 *  a control byte in a file name cannot forge a second log line. */
function noteRefused(refused: ReadonlySet<string>): void {
  for (const id of refusedLogged) if (!refused.has(id)) refusedLogged.delete(id);
  for (const id of refused) {
    if (refusedLogged.has(id)) continue;
    refusedLogged.add(id);
    console.warn(`ccrc-server: registry lists ${JSON.stringify(`${id}.uuid`)}, which is not a registry id — it is never read and never composed`);
  }
}

/** The whole-fleet read, typed (architecture doc, increment 1's second half):
```

(b) `RegistryRead`'s docstring tail and type. Before:

```ts
 *  runs on some calls only, and hanging the markers' cadence on it would make
 *  the banner's clock depend on whether an unrelated session was mid-reap. */
export type RegistryRead =
  | { listed: true; records: SessionRecord[]; names: readonly string[] }
  | { listed: false };
```

After:

```ts
 *  runs on some calls only, and hanging the markers' cadence on it would make
 *  the banner's clock depend on whether an unrelated session was mid-reap.
 *
 *  `refused` (path identity, spec §2.3) holds the IDS, each `.uuid` basename
 *  minus `.uuid`, of the listed rows that are not registry ids (`isRegistryId`,
 *  shared/api.ts). For every listed id `x`, `refused.has(x)` holds exactly when
 *  `!isRegistryId(x)`, so it is a pure function of the listing. A refused row is
 *  never read, never built and never in `records`, so no caller can compose it.
 *  Its raw name stays in `names`, which is the listing, not a list of sessions.
 *  Each caller classifies what a refused row means to it; the census in
 *  `registry-refused-census.test.ts` pins every call. */
export type RegistryRead =
  | { listed: true; records: SessionRecord[]; names: readonly string[]; refused: ReadonlySet<string> }
  | { listed: false };
```

(c) `readRegistryMeasured`'s head. Before:

```ts
  if (names === null) return { listed: false };
  const ids = names.filter((n) => n.endsWith('.uuid')).map((n) => n.slice(0, -'.uuid'.length)).sort();
  pruneWarnState(new Set(ids));
  const out: SessionRecord[] = [];
```

After:

```ts
  if (names === null) return { listed: false };
  // Path identity (spec §2.3): a listed id that is not a registry id is
  // REFUSED here, before the loop. It is never handed to `buildRecord`, so
  // none of its fields is read and none of its `noteIssue` keys is minted. It
  // is never in `records`, so no caller can compose it. `pruneWarnState` sees
  // the valid ids only; `noteRefused` logs each refused id once.
  const listedIds = names.filter((n) => n.endsWith('.uuid')).map((n) => n.slice(0, -'.uuid'.length)).sort();
  const ids = listedIds.filter((x) => isRegistryId(x));
  const refused: ReadonlySet<string> = new Set(listedIds.filter((x) => !isRegistryId(x)));
  pruneWarnState(new Set(ids));
  noteRefused(refused);
  const out: SessionRecord[] = [];
```

(d) `readRegistryMeasured`'s two listed returns. Before:

```ts
      if (retired.size > 0) return { listed: true, records: out.filter((r) => !retired.has(r.id)), names };
    }
  }
  return { listed: true, records: out, names };
}
```

After:

```ts
      if (retired.size > 0) return { listed: true, records: out.filter((r) => !retired.has(r.id)), names, refused };
    }
  }
  return { listed: true, records: out, names, refused };
}
```

(e) `readRegistry`, one tag line. Before:

```ts
export async function readRegistry(io: FleetIO, cfg: CcrcConfig): Promise<SessionRecord[]> {
  const r = await readRegistryMeasured(io, cfg);
  return r.listed ? r.records : [];
}
```

After:

```ts
export async function readRegistry(io: FleetIO, cfg: CcrcConfig): Promise<SessionRecord[]> {
  // [registry-refused:wrapper] answers records only, so a refused row reads as absent to every caller of this wrapper.
  const r = await readRegistryMeasured(io, cfg);
  return r.listed ? r.records : [];
}
```

The import block needs no edit: Task 4 already imports `isRegistryId` (Step 0). No other line of `registry.ts` changes. Confirm that nothing else changed:

```bash
grep -c 'registry-read-census' server/src/registry.ts   # the same count as before this task (git show HEAD:server/src/registry.ts | grep -c 'registry-read-census')
```

- [ ] **Step 4: Tag the 19 consumer sites**

Each site gets ONE comment line, inserted directly above its call line at that line's indentation. Each tag line is that indentation followed by this text, byte for byte:

```
// [registry-refused:unplaced] refused rows never reach these records; this caller's answer is not yet placed.
```

The line has no digit and no quote character. Nothing else changes at any site. The anchors are content and unique as quoted. The line numbers are hints at `837a099c0`.

(1) `server/src/commands.ts`, `sessionCommands` (`:52`). Before:
```ts
  const rec = (await readRegistry(deps.io, deps.cfg)).find((r) => r.id === id);
```
After:
```ts
  // [registry-refused:unplaced] refused rows never reach these records; this caller's answer is not yet placed.
  const rec = (await readRegistry(deps.io, deps.cfg)).find((r) => r.id === id);
```

(2) `server/src/lifecycle.ts`, `listProjects` (`:163`). Before:
```ts
  for (const rec of await readRegistry(io, cfg)) {
```
After:
```ts
  // [registry-refused:unplaced] refused rows never reach these records; this caller's answer is not yet placed.
  for (const rec of await readRegistry(io, cfg)) {
```

(3) `server/src/fleet.ts`, `assembleFleet` (`:506`). Before:
```ts
  const [recs, limits] = await Promise.all([records ?? readRegistry(io, cfg), readLimits(io, cfg, now)]);
```
After:
```ts
  // [registry-refused:unplaced] refused rows never reach these records; this caller's answer is not yet placed.
  const [recs, limits] = await Promise.all([records ?? readRegistry(io, cfg), readLimits(io, cfg, now)]);
```

(4) `server/src/server.ts`, `prTasks` (`:3208`). Before:
```ts
  const prTasks = async (id: string): Promise<TaskItem[] | null> => {
    const rec = (await readRegistry(deps.io, deps.cfg)).find((r) => r.id === id);
```
After:
```ts
  const prTasks = async (id: string): Promise<TaskItem[] | null> => {
    // [registry-refused:unplaced] refused rows never reach these records; this caller's answer is not yet placed.
    const rec = (await readRegistry(deps.io, deps.cfg)).find((r) => r.id === id);
```

(5) `server/src/watch.ts`, `tick` (`:1949`). Before:
```ts
      // and changes nothing".
      const registryRead = await readRegistryMeasured(this.deps.io, this.deps.cfg);
```
After:
```ts
      // and changes nothing".
      // [registry-refused:unplaced] refused rows never reach these records; this caller's answer is not yet placed.
      const registryRead = await readRegistryMeasured(this.deps.io, this.deps.cfg);
```

(6) `server/src/watch.ts`, `sweepHookStates`'s own read (`:2770`). Before:
```ts
      // below exists to protect.
      const registryRead = await readRegistryMeasured(this.deps.io, this.deps.cfg);
```
After:
```ts
      // below exists to protect.
      // [registry-refused:unplaced] refused rows never reach these records; this caller's answer is not yet placed.
      const registryRead = await readRegistryMeasured(this.deps.io, this.deps.cfg);
```

(7) `server/src/watch.ts`, `sweepTasks` (`:2859`). Before:
```ts
    // keeps.
    const registryRead = await readRegistryMeasured(this.deps.io, this.deps.cfg);
```
After:
```ts
    // keeps.
    // [registry-refused:unplaced] refused rows never reach these records; this caller's answer is not yet placed.
    const registryRead = await readRegistryMeasured(this.deps.io, this.deps.cfg);
```

(8) `server/src/watch.ts`, `sweepNames` (`:3013`). Before:
```ts
    // Same reason sweepTasks and sweepPr read the registry themselves.
    const records = await readRegistry(this.deps.io, this.deps.cfg);
```
After:
```ts
    // Same reason sweepTasks and sweepPr read the registry themselves.
    // [registry-refused:unplaced] refused rows never reach these records; this caller's answer is not yet placed.
    const records = await readRegistry(this.deps.io, this.deps.cfg);
```

(9) `server/src/watch.ts`, `sweepMail` (`:6052`). Before:
```ts
    // "we could not read the fleet this pass" for "this recipient is gone".
    const registryRead = await readRegistryMeasured(this.deps.io, this.deps.cfg);
```
After:
```ts
    // "we could not read the fleet this pass" for "this recipient is gone".
    // [registry-refused:unplaced] refused rows never reach these records; this caller's answer is not yet placed.
    const registryRead = await readRegistryMeasured(this.deps.io, this.deps.cfg);
```

(10) `server/src/watch.ts`, `sweepPr` (`:6729`). Before:
```ts
    try {
      const records = await readRegistry(this.deps.io, this.deps.cfg);
```
After:
```ts
    try {
      // [registry-refused:unplaced] refused rows never reach these records; this caller's answer is not yet placed.
      const records = await readRegistry(this.deps.io, this.deps.cfg);
```

(11) `server/src/watch.ts`, `detectDialogs` (`:7170`). Before:
```ts
    const recs = records ?? await readRegistry(this.deps.io, this.deps.cfg);
```
After:
```ts
    // [registry-refused:unplaced] refused rows never reach these records; this caller's answer is not yet placed.
    const recs = records ?? await readRegistry(this.deps.io, this.deps.cfg);
```

(12) `server/src/coord/routes.ts`, `requireAttribution` (`:620`). Before:
```ts
    const registry = await readRegistry(deps.io, deps.cfg);
    const row = registry.find((r) => r.id === whoId);
```
After:
```ts
    // [registry-refused:unplaced] refused rows never reach these records; this caller's answer is not yet placed.
    const registry = await readRegistry(deps.io, deps.cfg);
    const row = registry.find((r) => r.id === whoId);
```

(13) `server/src/coord/routes.ts`, `POST /api/mail` (`:825`). Before:
```ts
    const registry = await readRegistry(deps.io, deps.cfg);

    // 5: sender — a registry row must exist for fromId.
```
After:
```ts
    // [registry-refused:unplaced] refused rows never reach these records; this caller's answer is not yet placed.
    const registry = await readRegistry(deps.io, deps.cfg);

    // 5: sender — a registry row must exist for fromId.
```

(14) `server/src/coord/routes.ts`, `POST /api/mail/:id/ack` (`:1055`). Before:
```ts
    const registry = await readRegistry(deps.io, deps.cfg);
    const sender = registry.find((r) => r.id === fromId);
```
After:
```ts
    // [registry-refused:unplaced] refused rows never reach these records; this caller's answer is not yet placed.
    const registry = await readRegistry(deps.io, deps.cfg);
    const sender = registry.find((r) => r.id === fromId);
```

(15) `server/src/coord/routes.ts`, `GET /api/peers` (`:3158`). Before:
```ts
    const recs = await readRegistry(deps.io, deps.cfg);
    const recById = new Map(recs.map((r) => [r.id, r]));
```
After:
```ts
    // [registry-refused:unplaced] refused rows never reach these records; this caller's answer is not yet placed.
    const recs = await readRegistry(deps.io, deps.cfg);
    const recById = new Map(recs.map((r) => [r.id, r]));
```

(16) `server/src/coord/dispatch.ts`, `dispatchRun`'s pre-spawn read (`:548`). Before:
```ts
    const before = await readRegistry(deps.io, deps.cfg);
```
After:
```ts
    // [registry-refused:unplaced] refused rows never reach these records; this caller's answer is not yet placed.
    const before = await readRegistry(deps.io, deps.cfg);
```

(17) `server/src/coord/dispatch.ts`, the post-spawn read (`:630`). Before:
```ts
    const afterRead = await readRegistryMeasured(deps.io, deps.cfg);
```
After:
```ts
    // [registry-refused:unplaced] refused rows never reach these records; this caller's answer is not yet placed.
    const afterRead = await readRegistryMeasured(deps.io, deps.cfg);
```

(18) `server/src/coord/dispatch.ts`, the resume arm's read (`:787`). Before:
```ts
    const registryRead = await readRegistryMeasured(deps.io, deps.cfg);
    if (!registryRead.listed) {
```
After:
```ts
    // [registry-refused:unplaced] refused rows never reach these records; this caller's answer is not yet placed.
    const registryRead = await readRegistryMeasured(deps.io, deps.cfg);
    if (!registryRead.listed) {
```

(19) `server/src/coord/fingerprint.ts`, `resolveDoneBranch` (`:112`). Before:
```ts
  const registryRead = await readRegistryMeasured(deps.io, deps.cfg);
```
After:
```ts
  // [registry-refused:unplaced] refused rows never reach these records; this caller's answer is not yet placed.
  const registryRead = await readRegistryMeasured(deps.io, deps.cfg);
```

Then confirm the counts:

```bash
grep -rc '\[registry-refused:unplaced\]' server/src | awk -F: '{ s += $2 } END { print s }'   # 19
grep -rc '\[registry-refused:wrapper\]' server/src | awk -F: '{ s += $2 } END { print s }'    # 1
grep -rh '\[registry-refused:' server/src | grep -c '[0-9]'   # 0
grep -rnE 'readRegistryMeasured\(' server/src --include=*.ts | grep -vc 'export async function'     # (c5) still 8
grep -rnE '(await|\?\?|\() *readRegistry\(' server/src --include=*.ts | grep -vE '^\S+:[0-9]+:\s+(//|\*)' | wc -l   # (c6) still 12
```

The third line counts the tag lines that carry a digit. `-h` drops the file name and there is no `-n`, so only each line's own text is matched. If it prints anything other than `0`, list the tag lines with `grep -rn '\[registry-refused:' server/src`, and remove the digit from each tag line that carries one.

- [ ] **Step 5: Run the tests to verify they pass**

```bash
cd server && ./node_modules/.bin/vitest run test/registry-refused.test.ts test/registry-refused-census.test.ts test/run-route-route.test.ts
```

Expected: all three files PASS. Run in the foreground, with a timeout of at least 600000 ms.

- [ ] **Step 6: Mutation check**

Make each edit, run it, see the red, and undo the edit by hand before the next. Never use `git checkout --` or `git restore`: they would drop this task's uncommitted work. Before row 1, record `git diff -- server/src | wc -c`. After each undo, re-measure it: it must print the recorded number. The commands are run from `server/`:
- R is `./node_modules/.bin/vitest run test/registry-refused.test.ts`;
- C is `./node_modules/.bin/vitest run test/registry-refused-census.test.ts`.

The worker measures every red text. Where the measured text differs from the draft's, the measured text replaces it in the SDD ledger.

| # | Mutation (exact edit) | Command | Expected red |
|---|---|---|---|
| 1 | Build refused ids into `records`. In `readRegistryMeasured`, `const ids = listedIds.filter((x) => isRegistryId(x));` becomes `const ids = listedIds;` | R | The first case: `expected [ '--actor', '.hidden', 'a#b', 'demo-quiet-basin' ] to deeply equal [ 'demo-quiet-basin' ]`. The zero-read case: `expected [ '<home>/.cc-sessions/--actor.wrapper', … ] to deeply equal []`. `readRegistry still answers records only`: `expected [ '--actor', 'demo-quiet-basin' ] to deeply equal [ 'demo-quiet-basin' ]` |
| 2 | Drop `refusedLogged`'s dedupe. In `noteRefused`, delete `if (refusedLogged.has(id)) continue;` | `R -t 'logged once'`, then `R -t 'holding #'` | The once case: four lines, `expected [ …4… ] to deeply equal [ …2… ]`. The `#` case: three lines where one was expected |
| 3 | Key refused names in `warnState`. In `readRegistryMeasured`, `noteRefused(refused);` becomes ``for (const id of refused) noteIssue(`${id}#refused`, now, `registry lists ${JSON.stringify(`${id}.uuid`)}, which is not a registry id — it is never read and never composed`, false);`` | `R -t 'holding #'` | `expected [ …3 × "a#b.uuid"… ] to deeply equal [ 'ccrc-server: registry lists "a#b.uuid", … ]`: `pruneWarnState` keeps the valid ids only, so the key is pruned and logged again on every call |
| 4 | Omit `refused` on the retired return. `…, names, refused };` on the `retired.size > 0` line becomes `…, names };` | `R -t 'retired-row'`, then `./node_modules/.bin/tsc --noEmit -p .` | R: `TypeError: read.refused is not iterable`. tsc: a TS2322 (or TS2741) on that line naming `refused` |
| 5 | Delete the wrapper's tag line in `readRegistry` | C | `an untagged reader call: expected [ 'registry.ts:<n>' ] to deeply equal []`. The multiset: `registry.ts \| readRegistry \| readRegistryMeasured \| null` in place of `… \| wrapper`. The wrapper case: `expected [] to deeply equal [ 'registry.ts \| readRegistry \| readRegistryMeasured \| wrapper' ]` |
| 6 | Add an untagged reader call. In `server/src/commands.ts`, insert `  await readRegistry(deps.io, deps.cfg);` as the first statement of `sessionCommands`, ABOVE its tag line | C | `an untagged reader call: expected [ 'commands.ts:<n>' ] to deeply equal []`. The multiset gains `commands.ts \| sessionCommands \| readRegistry \| null` |
| 7 | A word outside the vocabulary. In `sweepNames`' tag, `[registry-refused:unplaced]` becomes `[registry-refused:unplacd]` | C | `a word outside the census vocabulary: expected [ 'watch.ts:<n> unplacd' ] to deeply equal []` |
| 8 | A tag with no call. Insert `// [registry-refused:holds] stray` as a new line directly above `export async function listProjects(` in `server/src/lifecycle.ts` | C | `a [registry-refused:*] tag that stands above no reader call: expected 21 to be 20` |
| 9 | Drop the prune. In `noteRefused`, delete the line `for (const id of refusedLogged) if (!refused.has(id)) refusedLogged.delete(id);` | `R -t 'leaves and returns'` | the third assertion: one line where two were expected (`expected [ 'ccrc-server: registry lists "--actor.uuid", … ] to deeply equal [ …, … ]`), because a name that left and came back is never logged again |
| 10 | Drop the quoting. In `noteRefused`'s `console.warn`, ``${JSON.stringify(`${id}.uuid`)}`` becomes `"${id}.uuid"` | `R -t 'logged once'` | the line equality fails on the `x\ny` name (a raw newline where the escaped `\n` was expected), and `A newline in a file name cannot forge a second log line` reads `expected false to be true` |

- [ ] **Step 7: Typecheck and the neighbouring suites**

```bash
cd server && ./node_modules/.bin/tsc --noEmit -p . && ./node_modules/.bin/tsc --noEmit -p test/tsconfig.tests.json
```

Expected: no output from either.

Then run these files in the foreground, one line at a time, each with a timeout of at least 600000 ms. Each line names files whose subject this task touches:

```bash
cd server && ./node_modules/.bin/vitest run test/registry.test.ts test/divergence-sweep.test.ts test/routes.test.ts
cd server && ./node_modules/.bin/vitest run test/unattended-actor.test.ts test/verb-gate.test.ts test/mail-routes.test.ts
cd server && ./node_modules/.bin/vitest run test/mail-sweep.test.ts test/dispatch-adopt.test.ts test/coord-fingerprint.test.ts
cd server && ./node_modules/.bin/vitest run test/peers-route.test.ts test/fleetws.test.ts test/hold-gate.test.ts
cd server && ./node_modules/.bin/vitest run test/typecheck-tests.test.ts
```

Expected: every file PASSES.
- `registry.test.ts`'s `registry read census` case proves that the `[registry-read-census:*]` claims survive unchanged (Global Constraints).
- `divergence-sweep.test.ts` proves that no `read…` export was added.
- `routes.test.ts` proves that the `knownId` claim phrase is untouched.

Re-run a known load flake in isolation before calling it a break.

- [ ] **Step 8: The FULL server suite, in the foreground**

After this commit no `records` array holds a refused row, for every reader at once. So run the whole server suite, sharded as Task 17 runs it:

```bash
cd server && find test -name '*.test.ts' | wc -l
```

Then, for k from 1 to 24, run one foreground call each, each with a timeout of 600000 ms:

```bash
cd server && ./node_modules/.bin/vitest run --shard=<k>/24
```

The shards' `Test Files` lines must sum to the `find` count. If a shard overruns 600 s, re-run the whole set at `/48`, so the run uses one denominator.

Rules for any red:
- **(a)** Re-run a CLAUDE.md load flake in isolation before calling it a break.
- **(b)** A red that a clean `origin/main` also shows is reported once, as `main-red`, and is not fixed here.
- **(c)** A red caused by a test that plants a NON-registry id as a fresh registry row, where that id's shape is not the test's subject: convert it the way Step 1 (c) converts `'bad worker'`. Seed the stored value through the store, or rename the planted id to a registry id when nothing reads it from a store. Keep the title's intent, record the file in the SDD ledger, and add it to Step 9's `git add`.
- **(d)** A red in a file Tasks 1 to 4 created, or a red whose subject IS reading a non-registry id through `readRegistry` or `readRegistryMeasured`: change nothing. STOP and report `refused-omission-reds-an-earlier-pin`, naming the file and the case.

Record the shard verdicts in the SDD ledger.

- [ ] **Step 9: Commit**

```bash
git add server/src/registry.ts server/src/commands.ts server/src/lifecycle.ts server/src/fleet.ts \
  server/src/server.ts server/src/watch.ts server/src/coord/routes.ts server/src/coord/dispatch.ts \
  server/src/coord/fingerprint.ts server/test/registry-refused.test.ts \
  server/test/registry-refused-census.test.ts server/test/run-route-route.test.ts
git commit -m "$(cat <<'MSG'
feat(registry): refused rows are named, never read, and logged once; every reader call is censused

readRegistryMeasured now splits the listed ids before its loop. A listed
.uuid whose id is not a registry id is refused:
- it is never handed to buildRecord, so none of its fields is read;
- it is never in records, so no caller can compose it;
- it is named in the new RegistryRead.refused, an id set that is a pure
  function of the listing.

names still carries every raw name. pruneWarnState sees the valid ids
only. Each refused id is logged once while it stays listed, quoted by
JSON.stringify, through a module-private set pruned on every listing.
That set is not warnState, because warnState's prune splits on '#'.

Every readRegistry( and readRegistryMeasured( call in server/src now
carries a [registry-refused:<word>] tag. readRegistry's own read is
wrapper, and the 19 consumer sites are unplaced until their handling is
built and pinned. A new census suite pins the twenty sites by file,
enclosing function or route, reader and word. It reds on an untagged
call, a tag with no call, or a word outside the vocabulary.

run-route-route's bad-worker case now seeds its stored session id
through the store, because a fresh dispatch can no longer adopt a
refused row. Spec §2.3.
MSG
)"
```

If Step 8 (c) converted any further test file, add it to the `git add` line and name it in the body's last paragraph. Before committing, check the message:

```bash
git log -1 --format=%B | grep -cE 'D-[0-9]'   # 0
```

---

---

### Task 6: The seven measured callers place refused rows, and dispatch's pre-spawn read is measured

**Model routing:** `opus`, effort `xhigh`. This task decides what each direct reader of `readRegistryMeasured` does with a registry name that is not a registry id. The readers are fingerprint, the three dispatch reads, the main watch, the hook-state watch, the task watch and the mail lane. It also moves dispatch's pre-spawn read off `readRegistry` (R18).

**Why:**
- **Spec §2.3, "Its seven direct application callers place that distinction explicitly".** Task 5 named the refused rows and stopped building them. Each consumer still reads that absence as "no row", and that is wrong in four places:
  - fingerprint falls back to the frozen `run.branch`;
  - dispatch's subtraction cannot see a refused name the spawn made;
  - the snapshot shrink guard freezes on a cached refused id;
  - mail parks a refused recipient `undeliverable`.
- **R3.** For the main, hook-state and task-state watches, omission is the behaviour. There is no retention code, because refusal is a pure function of the id. The census tags these sites `omits` and pins them. The snapshot guard is fixed so that a refused id cannot freeze snapshot writes.
- **R12 and R18.** Dispatch's pre-spawn read refuses `registry-unmeasurable` on an unlistable registry, before anything is spawned. It moves together with the post-spawn clause, because that clause needs the pre-spawn read's `refused` set. Landed alone, the clause would refuse every dispatch while any refused row stands.
- **R17.** The resume arm's read gets no new arm. Task 3's stored-row gate and `childBindGate`'s `bad-id` stand ahead of it, and a comment says so.
- **R26.** `resolveDoneBranch`'s own check stays. `verifyReviewDone` reads the WORK run's `sessionId`, which the review run's close gate never checks. The check is pinned through a review close as well as directly.
- **R13.** A refused mail recipient is held as `registry-unmeasurable`. No `MailGate` member is added.
- **R25.** Eight of Task 5's `[registry-refused:unplaced]` tags get their placed word in this commit, and no tag claims behaviour that is not yet built.

**Entry (measured in Step 0).** Tasks 1 to 5 are committed on this branch:
- Task 1: `isRegistryId` at the `shared/api.ts` foot.
- Task 3: dispatch's stored-row gate.
- Task 4: `childBindGate`'s `bad-id` arm.
- Task 5: `RegistryRead.refused`, the 20 census tags and `server/test/registry-refused-census.test.ts`.

**Files:**
- Modify `server/src/coord/fingerprint.ts`:
  - The shared import: `import { isPrPhase, type DoneRejectCode, type PrPhase } from '../../../shared/api.js';`.
  - `resolveDoneBranch`'s first statement, placed directly after its return-type line `): Promise<{ ok: true; branch: string; provenance: string } | { ok: false; code: DoneRejectCode; detail: string }> {`.
  - The one comment line holding `[registry-refused:unplaced]` directly above `const registryRead = await readRegistryMeasured(deps.io, deps.cfg);` in `resolveDoneBranch`. Its word becomes `holds`.
  - `verifyDone`'s single-line signature is NOT touched (`verb-gate.test.ts` reads scopes through it).
- Modify `server/src/coord/dispatch.ts`:
  - The registry import: `import { fieldMeasured, measuredIdentity, readRegistry, readRegistryMeasured } from '../registry.js';`.
  - One clause in `DispatchOutcome`'s `registry-unmeasurable` docstring, at the line `   *  `ws-add` or `ensure` succeeded, and only the registry read failed). An empty`.
  - The pre-spawn block in `dispatchRun`'s fresh arm. It runs from `    // BEFORE tolerates degradation, deliberately — the question it answers` through `    const beforeIds = new Set(before.map((r) => r.id));`, and Task 5's tag line sits between those.
  - The post-spawn refusal, from `    // nothing else has claimed the row.` through `        afterRead.records.some((r) => r.project === run.project && measuredIdentity(r) === null)) {`.
  - The resume arm's tag line, directly above `    const registryRead = await readRegistryMeasured(deps.io, deps.cfg);`, which follows `    // means only the first, tolerated case — never the second.`.
- Modify `server/src/watch.ts`:
  - The single-line shared import that holds `UNCHECKED_PR` (`import { FLEET_SCOPE, LEDGER_STALE_MS, …, UNCHECKED_PR, lifecycleIsDead, sessionLifecycle } from '../../shared/api.js';`).
  - `tick`'s tag line, above `      const registryRead = await readRegistryMeasured(this.deps.io, this.deps.cfg);`, which follows `      // and changes nothing".`.
  - The snapshot shrink guard: `const allGenuinelyPurged = names !== null && missingIds.every((id) => !names.includes(`${id}.uuid`));`.
  - `sweepHookStates`'s tag line, above its own `readRegistryMeasured(` inside the `else` arm.
  - `sweepTasks`'s tag line.
  - `sweepMail`'s tag line, above `    const registryRead = await readRegistryMeasured(this.deps.io, this.deps.cfg);`, which follows `    // "we could not read the fleet this pass" for "this recipient is gone".`.
  - `sweepMail`'s `          const unmeasurable = rec !== undefined;`.
- Modify `server/test/registry-refused-census.test.ts`:
  - Eight rows of Task 5's classified-set table, including the pre-spawn row's reader.
  - One new describe, appended at the file's end, with its imports.
- Create `server/test/registry-refused-callers.test.ts`.
- Nothing else. `registry.ts` is touched only by mutation row 7, which is reverted.

**Interfaces:**
- Consumes:
  ```ts
  // shared/api.ts (Task 1, foot block)
  export function isRegistryId(id: unknown): id is string;
  export const MAIL_MAX_ATTEMPTS: number;                      // existing; watch.ts already imports it from here
  // server/src/registry.ts (Task 5)
  export type RegistryRead =
    | { listed: true; records: SessionRecord[]; names: readonly string[]; refused: ReadonlySet<string> }
    | { listed: false };
  export async function readRegistryMeasured(io: FleetIO, cfg: CcrcConfig): Promise<RegistryRead>;
  // server/src/coord/dispatch.ts (existing at 837a099c0)
  //   DispatchOutcome member: { ok: false; kind: 'registry-unmeasurable'; stderr?: string }
  export async function dispatchRun(deps: DispatchRunDeps, id: number, brief: unknown, items: unknown, route?: unknown): Promise<DispatchOutcome>;
  //   Task 3's stored-row gate, right after `if (!hold.ok) return hold;`:
  //   if (run.sessionId !== null && !isRegistryId(run.sessionId)) return { ok: false, kind: 'bad-session' };
  // server/src/coord/childBind.ts (Task 4): on bad-id, { ok: false, code: 'spent-unmeasured', detail: 'the session id is not a registry id' }
  // server/src/coord/fingerprint.ts (existing; signatures unchanged)
  export async function resolveDoneBranch(deps: VerifyDoneDeps, run: DoneRun):
    Promise<{ ok: true; branch: string; provenance: string } | { ok: false; code: DoneRejectCode; detail: string }>;
  export async function verifyDone(deps: VerifyDoneDeps, run: DoneRun, claim: DoneClaim): Promise<DoneVerdict>;
  // server/src/coord/close.ts (existing)
  export function closeRun(deps: CloseRunDeps, id: number, body: unknown, causedBy: 'coordinator' | 'operator'): Promise<CloseOutcome>;
  // shared/api.ts (existing): DoneRejectCode 'tip-unmeasurable'; MailGate 'registry-unmeasurable'
  ```
- Produces:
  - No new exported name, wire field or refusal word.
  - The placed census words `holds`, `refuses`, `refuses`, `gated`, `omits`, `tests-only`, `omits` and `holds`.
  - Census-file test helpers `TICK_WATCH_TS`, `TICK_HEAD`, `TICK_STRINGS`, `tickCode` and `tickBodyOf`. Task 8 extends the same describe with `detectDialogs(`.

- [ ] **Step 0: Measure the entry conditions (nothing is written)**

Run these from the workspace root:

```bash
grep -c "const allGenuinelyPurged = names !== null" server/src/watch.ts                                   # (c17) 1
grep -c "const unmeasurable = rec !== undefined;" server/src/watch.ts                                     # (c18) 1
grep -c "const before = await readRegistry(deps.io, deps.cfg);" server/src/coord/dispatch.ts              # 1: the pre-spawn read
grep -c "const afterRead = await readRegistryMeasured(deps.io, deps.cfg);" server/src/coord/dispatch.ts   # 1: the post-spawn read
grep -c "registry-refused:unplaced" server/src/coord/fingerprint.ts server/src/coord/dispatch.ts server/src/watch.ts
#   fingerprint.ts:1, dispatch.ts:3, watch.ts:7 (Task 5's tags)
grep -c "!isRegistryId(run.sessionId)) return { ok: false, kind: 'bad-session' };" server/src/coord/dispatch.ts   # 1 (Task 3)
grep -c "the session id is not a registry id" server/src/coord/childBind.ts                               # >= 1 (Task 4)
grep -c "refused: ReadonlySet<string>" server/src/registry.ts                                              # >= 1 (Task 5)
ls server/test/registry-refused-census.test.ts                                                             # exists (Task 5)
grep -n "UNCHECKED_PR, lifecycleIsDead, sessionLifecycle } from '../../shared/api.js';" server/src/watch.ts   # one line: the import to widen
grep -c "await this.sweepHookStates(records);" server/src/watch.ts                                         # 1
```

STOP rules:
- **A Task 3, 4 or 5 anchor is 0.** The tasks before this one are not on the branch: STOP, `prior-task-missing`.
- **A count or line moved but is present.** #351 or run 400 landed in between. Re-point by content and record it in the SDD ledger. This is not a departure.
- **`watch.ts`'s import line was split by another wave.** Add `isRegistryId` to whichever `from '../../shared/api.js'` value import holds `UNCHECKED_PR`, keeping it on one line (`single-definition.test.ts` scans that line).

- [ ] **Step 1: Write the failing tests**

(a) Create `server/test/registry-refused-callers.test.ts`:

```ts
// Path identity W1a, Task 6 (spec §2.3): the seven direct callers of `readRegistryMeasured` PLACE a refused row —
// a `.uuid` whose basename is not a registry id, which that read lists in `refused` and never reads or builds.
// Fingerprint HOLDS it, dispatch REFUSES what subtraction cannot see and measures before it spawns, the watches
// OMIT it, and mail HOLDS a delivery to it. Every refused row here is a plain file under a fixture HOME's registry
// (`path.join(reg, '--actor.uuid')`): no live fleet, no real ccd.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { Bus } from '../src/bus.js';
import type { CcdArgv } from '../src/ccdargv.js';
import { configDirFor, loadConfig } from '../src/config.js';
import { closeRun, type CloseRunDeps } from '../src/coord/close.js';
import { openCoordDb } from '../src/coord/db.js';
import { dispatchRun, type DispatchRunDeps } from '../src/coord/dispatch.js';
import { verifyDone, type DoneClaim } from '../src/coord/fingerprint.js';
import { CoordStore } from '../src/coord/store.js';
import type { Runner } from '../src/exec.js';
import { loadSnapshot, saveSnapshot, type FleetState } from '../src/fleetstate.js';
import { localIO, type FleetIO } from '../src/io.js';
import type { CcdResult } from '../src/lifecycle.js';
import type { Deps } from '../src/server.js';
import { tasksDir } from '../src/tasks/read.js';
import { FleetWatcher } from '../src/watch.js';
import { MAIL_MAX_ATTEMPTS } from '../../shared/api.js';
import { okRun } from './coordReadHelpers.js';
import { seedRoster, testDeps } from './helpers.js';
import { mkTmp } from './tmpHelpers.js';

const PROJECT = 'demo';
/** A redirect id (spec §2.1): ccd's loops would read it as a flag. */
const BAD = '--actor';
const COORDINATOR = 'demo-coordinator';
const BRANCH = 'ws/quiet-mesa';
const TIP = 'c'.repeat(40);
const REFUSED_DETAIL = 'the run\'s session id is not a registry id: it is refused, never read';

/** One registry row as plain files, `coord-abandon.test.ts`'s `seed` shape. `over` replaces a field. */
const plant = (home: string, id: string, over: Record<string, string> = {}): void => {
  const reg = path.join(home, '.cc-sessions');
  mkdirSync(reg, { recursive: true });
  const fields: Record<string, string> = {
    wrapper: 'claude', project: PROJECT, workdir: `/w/${id}`, uuid: `u-${id}`, started: '1',
    workspace: id, branch: `ws/${id}`, base: 'origin/main', ...over,
  };
  for (const [k, v] of Object.entries(fields)) writeFileSync(path.join(reg, `${id}.${k}`), v);
};

/** `<root>/demo/.git` holding one loose ref, `branch` at `tip`: exactly what `readBranchTip` reads. */
const gitRoot = (branch: string, tip: string): string => {
  const root = mkTmp('ccrc-refused-git-');
  const segs = branch.split('/');
  const leaf = segs.pop()!;
  const dir = path.join(root, PROJECT, '.git', 'refs', 'heads', ...segs);
  mkdirSync(dir, { recursive: true });
  writeFileSync(path.join(dir, leaf), `${tip}\n`);
  return root;
};

/** A runner that records every argv and answers `code`. */
const recording = (calls: string[][], code = 0): Runner => async (_cmd, args) => {
  calls.push([...args]);
  return { code, stdout: '', stderr: '' };
};

const connected: FleetState = { connected: true, downSince: null, ccdVerbs: null, rosterFp: null, build: null };

describe('fingerprint holds a refused session id (spec §2.3)', () => {
  it('verifyDone for a run whose sessionId is --actor answers tip-unmeasurable, never the frozen run.branch', async () => {
    const home = mkTmp('ccrc-refused-fp-');
    plant(home, BAD);                                   // the row is planted: only the check can refuse
    const root = gitRoot(BRANCH, TIP);                  // a valid ref at run.branch, the fallback a refused row would take
    const calls: string[][] = [];
    const base = testDeps(home, recording(calls));
    const deps = { ...base, cfg: { ...base.cfg, projectsRoot: root } };
    const claim: DoneClaim = { branchTip: TIP, prNumber: null, prPhase: 'open', handoffCommit: TIP };

    const res = await verifyDone(deps, { sessionId: BAD, project: PROJECT, branch: BRANCH }, claim);

    expect(res).toEqual({ ok: false, code: 'tip-unmeasurable', detail: REFUSED_DETAIL });
    expect(calls, 'no pr-state is composed for a refused id').toEqual([]);
  });

  it('a review close whose WORK run\'s stored sessionId is --actor answers tip-unmeasurable', async () => {
    const home = mkTmp('ccrc-refused-review-');
    const REVIEWER = 'demo-r1';
    plant(home, BAD);
    plant(home, REVIEWER);
    const root = gitRoot(BRANCH, TIP);
    const report = path.join(root, 'report.md');
    writeFileSync(report, '# findings\n');
    const calls: string[][] = [];
    const base = testDeps(home, recording(calls));
    const coord = new CoordStore(openCoordDb(path.join(home, '.ccrc', 'coord.db')));

    const work = coord.openRun({ program: 'demo-prog', title: 'work', project: PROJECT, wave: 1, waveOf: 1,
      claimedBy: COORDINATOR });
    if (!('id' in work)) throw new Error(`fixture openRun refused: ${JSON.stringify(work)}`);
    // A legacy row: stored through the store, as a row from before any ingress gate would be.
    coord.markDispatched(work.id, BAD, BAD, BRANCH, false);
    for (const to of ['dispatched', 'working', 'awaiting-review'] as const) {
      expect(coord.advance(work.id, to, 'test').ok).toBe(true);
    }
    const review = coord.openRun({ program: 'demo-prog', title: 'review', project: PROJECT, wave: 1, waveOf: 1,
      claimedBy: COORDINATOR, kind: 'review', reviews: work.id });
    if (!('id' in review)) throw new Error(`fixture openRun (review) refused: ${JSON.stringify(review)}`);
    // The REVIEW run's own session is a valid id, so the close gate (Task 3) passes it: only fingerprint can refuse.
    coord.markDispatched(review.id, REVIEWER, 'r1', 'ws/r1', false);
    for (const to of ['dispatched', 'working'] as const) {
      expect(coord.advance(review.id, to, 'test').ok).toBe(true);
    }
    const deps: CloseRunDeps = { coord, io: base.io, cfg: { ...base.cfg, projectsRoot: root }, runCcd: base.runCcd };

    const out = await closeRun(deps, review.id, { fingerprint: { reviewedTip: TIP, report } }, 'coordinator');

    expect(out).toEqual({ ok: false, kind: 'doneVerdict', code: 'tip-unmeasurable', detail: REFUSED_DETAIL });
    expect(calls, 'no fleet act on a refusal').toEqual([]);
    expect(okRun(coord.run(review.id))!.state).toBe('working');
    expect(coord.rejections().filter((r) => r.runId === review.id).map((r) => r.code)).toEqual(['tip-unmeasurable']);
  });
});

describe('dispatch refuses what subtraction cannot see (spec §2.3)', () => {
  const NEW_ROW = 'demo-quiet-basin';

  /** A fresh-spawn dispatch. `before` rows exist before it; the `ws-add` double plants `after` rows, so the
   *  pre-spawn read cannot see them. `failBeforeListing` fails the SECOND registry listing only: the first is
   *  dispatch's pause-marker read, the second is the pre-spawn registry read. */
  const spawn = (cfg: { before?: readonly string[]; after?: readonly string[]; failBeforeListing?: boolean }) => {
    const home = mkTmp('ccrc-refused-dispatch-');
    mkdirSync(path.join(home, '.cc-sessions'), { recursive: true });
    for (const id of cfg.before ?? []) plant(home, id);
    const coord = new CoordStore(openCoordDb(path.join(home, '.ccrc', 'coord.db')));
    const opened = coord.openRun({ program: 'demo-prog', title: 'Refused rows', project: PROJECT, wave: 1, waveOf: 3,
      claimedBy: COORDINATOR });
    if (!('id' in opened)) throw new Error(`fixture openRun refused: ${JSON.stringify(opened)}`);
    const calls: string[][] = [];
    const runCcd = async (argv: CcdArgv): Promise<CcdResult> => {
      calls.push([...argv]);
      if (argv[0] === 'ws-add') for (const id of cfg.after ?? []) plant(home, id);
      return { ok: true, stdout: '', stderr: '', killed: false, signal: null };
    };
    const base = testDeps(home);
    let listings = 0;
    const io: FleetIO = {
      ...localIO,
      readdir: async (p, timeoutMs, signal) => {
        if (p === base.cfg.registryDir) {
          listings += 1;
          if (cfg.failBeforeListing === true && listings === 2) return null;
        }
        return localIO.readdir(p, timeoutMs, signal);
      },
    };
    const deps = { ...base, io, coord, runCcd, configDir: (w: string) => configDirFor(base.cfg, w) } as DispatchRunDeps;
    return {
      coord, runId: opened.id, calls,
      listings: (): number => listings,
      dispatch: () => dispatchRun(deps, opened.id, 'go', undefined),
    };
  };

  it('an unlistable registry before the spawn refuses registry-unmeasurable and composes no ws-add', async () => {
    const h = spawn({ failBeforeListing: true, after: [NEW_ROW] });
    expect(await h.dispatch()).toEqual({ ok: false, kind: 'registry-unmeasurable' });
    expect(h.calls, 'nothing is spawned').toEqual([]);
    expect(h.listings(), 'the pause listing, then the failed pre-spawn read; nothing after').toBe(2);
    const row = okRun(h.coord.run(h.runId))!;
    expect(row.state).toBe('planned');
    expect(row.sessionId).toBeNull();
    expect(row.dispatchStartedAt, 'markDispatchStarted never ran').toBeNull();
    expect(h.coord.runEvents(h.runId), 'no route-omitted or child-omitted event').toEqual([]);
  });

  it('a refused name that appeared during the spawn refuses registry-unmeasurable and binds nothing', async () => {
    const h = spawn({ after: [NEW_ROW, BAD] });
    expect(await h.dispatch()).toEqual({ ok: false, kind: 'registry-unmeasurable' });
    expect(h.calls.map((c) => c[0]), 'the spawn ran; no hold followed it').toEqual(['ws-add']);
    const row = okRun(h.coord.run(h.runId))!;
    expect(row.sessionId).toBeNull();
    expect(row.state).toBe('planned');
  });

  it('control: a refused row present before the spawn does not refuse', async () => {
    const h = spawn({ before: [BAD], after: [NEW_ROW] });
    expect(await h.dispatch()).toMatchObject({ ok: true, sessionId: NEW_ROW, adopted: false });
    expect(okRun(h.coord.run(h.runId))!.sessionId).toBe(NEW_ROW);
  });
});

describe('the watches omit a refused id (spec §2.3)', () => {
  it('a prior snapshot holding --actor shrinks to the valid rows, and writes never freeze', async () => {
    const home = mkTmp('ccrc-refused-snap-');
    seedRoster(home);
    plant(home, 'demo-a');
    const cachePath = path.join(home, 'state-cache.json');
    const deps: Deps = {
      ...testDeps(home), cfg: loadConfig({ CCRC_HOME: home, CCRC_FLEET: 'remote' }),
      fleetState: connected, stateCachePath: cachePath,
    };
    const w = new FleetWatcher(deps, new Bus());
    await w.tick();                                                    // the first write: [demo-a]
    const first = await loadSnapshot(cachePath);
    expect(first?.sessions.map((s) => s.id)).toEqual(['demo-a']);
    // The cache an older build left: it assembled --actor, and that row's .uuid is still listed.
    const valid = first!.sessions[0]!;
    await saveSnapshot([{ ...valid, id: BAD }, valid], cachePath);
    plant(home, BAD);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      await w.tick();
      expect((await loadSnapshot(cachePath))?.sessions.map((s) => s.id)).toEqual(['demo-a']);
      await w.tick();
      expect((await loadSnapshot(cachePath))?.sessions.map((s) => s.id)).toEqual(['demo-a']);
      expect(warn.mock.calls.filter(([m]) => typeof m === 'string' && m.includes('snapshot write skipped')))
        .toEqual([]);
    } finally {
      warn.mockRestore();
    }
  }, 30_000);

  it('one tick over a planted --actor row with a hook-state and a tasks file gives it no hookStates or taskProgress key, and no read', async () => {
    const home = mkTmp('ccrc-refused-watch-');
    const GOOD = 'demo-a';
    const UUID_GOOD = '1'.repeat(36);
    const UUID_BAD = '2'.repeat(36);
    plant(home, GOOD, { uuid: UUID_GOOD });
    plant(home, BAD, { uuid: UUID_BAD });
    const base = testDeps(home);
    const cfgDir = configDirFor(base.cfg, 'claude')!;
    for (const [id, uuid] of [[GOOD, UUID_GOOD], [BAD, UUID_BAD]] as const) {
      writeFileSync(path.join(base.cfg.registryDir, `${id}.hookstate.json`), JSON.stringify({
        v: 1, state: 'waiting', event: 'Notification', sessionId: uuid, pid: 40613,
        updatedAt: Date.now(), ask: null, subagents: [],
      }));
      const dir = tasksDir(cfgDir, uuid);
      mkdirSync(dir, { recursive: true });
      writeFileSync(path.join(dir, '1.json'), JSON.stringify({
        id: '1', subject: 'one', description: 'do 1', activeForm: 'Doing one', status: 'in_progress',
        blocks: [], blockedBy: [],
      }));
    }
    const touched: string[] = [];
    const io: FleetIO = {
      ...localIO,
      readFileMeasured: async (p, t, s) => { touched.push(p); return localIO.readFileMeasured(p, t, s); },
      readFile: async (p) => { touched.push(p); return localIO.readFile(p); },
      readFileFromMeasured: async (p, o) => { touched.push(p); return localIO.readFileFromMeasured(p, o); },
      readFileFrom: async (p, o) => { touched.push(p); return localIO.readFileFrom(p, o); },
      readdir: async (p, t, s) => { touched.push(p); return localIO.readdir(p, t, s); },
      statMeasured: async (p) => { touched.push(p); return localIO.statMeasured(p); },
      stat: async (p) => { touched.push(p); return localIO.stat(p); },
      lstatMeasured: async (p) => { touched.push(p); return localIO.lstatMeasured(p); },
    };
    const w = new FleetWatcher({ ...base, io, stateCachePath: path.join(home, 'state-cache.json') }, new Bus());

    await w.tick();

    expect(touched.filter((p) => path.basename(p).startsWith(`${BAD}.`) || p.includes(UUID_BAD)),
      'a refused row is never read: no field, no hook state, no task file').toEqual([]);
    expect(w.currentHookStates().has(BAD)).toBe(false);
    expect(w.currentTaskProgress().has(BAD)).toBe(false);
    // CONTROL: the two lanes did run, over the valid row.
    expect(w.currentHookStates().get(GOOD)?.state).toBe('waiting');
    expect(w.currentTaskProgress().get(GOOD)?.total).toBe(1);
  }, 30_000);
});

describe('mail holds a delivery to a refused recipient (spec §2.3)', () => {
  const NOW = 1_800_000_000_000;
  beforeEach(() => { vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(NOW); });
  afterEach(() => { vi.useRealTimers(); });

  interface DeliveryRow {
    state: string; attempts: number; nextAttemptAt: number; rejectCode: string | null; lastGate: string | null;
  }

  it('past MAIL_MAX_ATTEMPTS the delivery to --actor is still held registry-unmeasurable', async () => {
    const home = mkTmp('ccrc-refused-mail-');
    mkdirSync(path.join(home, '.cc-sessions'), { recursive: true });   // empty but listable: the priming tick needs it
    const calls: string[][] = [];
    const coord = new CoordStore(openCoordDb(path.join(home, '.ccrc', 'coord.db')));
    const deps: Deps = { ...testDeps(home, recording(calls, 1)), coord, stateCachePath: path.join(home, 'state-cache.json') };
    const w = new FleetWatcher(deps, new Bus(), 2000);
    await w.tick();                                                    // primes the watcher
    plant(home, BAD);                                                  // the recipient: listed, refused, never read
    const mail = coord.insertMail({ fromId: 'demo-quiet-mesa', fromUuid: 'b'.repeat(36), toId: BAD, runId: null,
      kind: 'finding', subject: 'hi', body: 'payload', artifacts: [] });
    const { id } = coord.queueDelivery(mail.id, BAD, 'payload');
    const row = (): DeliveryRow => coord.db.prepare(
      'SELECT state, attempts, nextAttemptAt, rejectCode, lastGate FROM mail_deliveries WHERE id = ?',
    ).get(id) as unknown as DeliveryRow;

    await w.sweepMail();
    expect(row().lastGate).toBe('registry-unmeasurable');
    expect(row().attempts).toBe(0);
    // Well past the point that parks a genuinely absent recipient.
    for (let i = 1; i < MAIL_MAX_ATTEMPTS + 4; i++) {
      vi.setSystemTime(row().nextAttemptAt + 1_000);
      await w.sweepMail();
    }
    expect(row()).toMatchObject({ state: 'queued', rejectCode: null, attempts: 0, lastGate: 'registry-unmeasurable' });
    expect(calls.filter((c) => c[0] === 'send-keys'), 'nothing is typed into any pane').toEqual([]);
  }, 30_000);
});
```

(b) In `server/test/registry-refused-census.test.ts`, change exactly these eight rows of the classified-set list `EXPECTED_SITES` (Task 5's case `the classified set is exactly these 20 sites`).
- Each row is one string in Task 5's spelling, `'<file under server/src> | <enclosing> | <reader> | <word>'`.
- Match each row by its whole string, wherever it stands; the case sorts both sides.
- The `wrapper` row and the eleven other `unplaced` rows stay as they are, and the count stays 20.
- `coord/dispatch.ts` has three `dispatchRun` rows: one `readRegistry` and two `readRegistryMeasured`. They become two `refuses` rows and one `gated` row. The `refuses` rows are the pre-spawn read, now measured, and the post-spawn read; the `gated` row is the resume arm.

Before:

```ts
  'coord/fingerprint.ts | resolveDoneBranch | readRegistryMeasured | unplaced',
  'coord/dispatch.ts | dispatchRun | readRegistry | unplaced',
  'coord/dispatch.ts | dispatchRun | readRegistryMeasured | unplaced',
  'coord/dispatch.ts | dispatchRun | readRegistryMeasured | unplaced',
  'watch.ts | sweepHookStates | readRegistryMeasured | unplaced',
  'watch.ts | sweepMail | readRegistryMeasured | unplaced',
  'watch.ts | sweepTasks | readRegistryMeasured | unplaced',
  'watch.ts | tick | readRegistryMeasured | unplaced',
```

After:

```ts
  'coord/fingerprint.ts | resolveDoneBranch | readRegistryMeasured | holds',
  'coord/dispatch.ts | dispatchRun | readRegistryMeasured | refuses',
  'coord/dispatch.ts | dispatchRun | readRegistryMeasured | refuses',
  'coord/dispatch.ts | dispatchRun | readRegistryMeasured | gated',
  'watch.ts | sweepHookStates | readRegistryMeasured | tests-only',
  'watch.ts | sweepMail | readRegistryMeasured | holds',
  'watch.ts | sweepTasks | readRegistryMeasured | omits',
  'watch.ts | tick | readRegistryMeasured | omits',
```

Then append this block at the END of the same file. Make sure the file imports `readFileSync` (`node:fs`), `path` (`node:path`), `fileURLToPath` (`node:url`) and `codeOnly` (`./sourceScan.js`). Add any missing one to the existing import block, and never import a name twice.

```ts
// Path identity W1a, Task 6 (spec §2.3, R19's precedent): `sweepHookStates`'s own registry read is `tests-only`
// ONLY because `tick()` hands the lane the `records` of its own listing. Pinned here, so a tick that stopped passing
// them would turn that read into a second, production read without the census above noticing. Task 8 adds
// `detectDialogs(` to this describe.
const TICK_WATCH_TS = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../src/watch.ts');
const TICK_HEAD = 'async tick(): Promise<void> {';
const TICK_STRINGS = /'(?:\\.|[^\\'\n])*'|"(?:\\.|[^\\"\n])*"|`(?:\\[\s\S]|[^\\`])*`/g;
/** Code only, every string's contents blanked: a brace inside a comment or a string cannot end a body. */
const tickCode = (src: string): string => codeOnly(src).replace(TICK_STRINGS, (m) => `${m[0]}${m[0]}`);
/** The body of the member whose head is `head` (which ends with its own `{`), through its matching `}`. */
const tickBodyOf = (code: string, head: string): string => {
  const at = code.indexOf(head);
  if (at < 0) throw new Error(`${head} is not in the scanned source`);
  const open = at + head.length - 1;
  let depth = 0;
  for (let i = open; i < code.length; i += 1) {
    if (code[i] === '{') depth += 1;
    else if (code[i] === '}') {
      depth -= 1;
      if (depth === 0) return code.slice(open, i + 1);
    }
  }
  throw new Error(`${head} has no matching closing brace`);
};

describe('tick hands its records to the lanes that would otherwise read the registry again (spec §2.3)', () => {
  it('CONTROL: the body slicer ends at the matching brace, past a brace in a comment or a string', () => {
    const src = `${TICK_HEAD}\n  // a } in a comment\n  if (a) { b('}'); }\n  await this.sweepHookStates(records);\n}\nafter();\n`;
    const body = tickBodyOf(tickCode(src), TICK_HEAD);
    expect(body).toMatch(/\bthis\.sweepHookStates\(\s*records\s*\)/);
    expect(body).not.toContain('after');
  });

  it('tick() passes its records to sweepHookStates(', () => {
    const body = tickBodyOf(tickCode(readFileSync(TICK_WATCH_TS, 'utf8')), TICK_HEAD);
    expect(body, 'tick no longer hands sweepHookStates its records: that lane would read the registry itself')
      .toMatch(/\bthis\.sweepHookStates\(\s*records\s*\)/);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

```bash
cd server && ./node_modules/.bin/vitest run test/registry-refused-callers.test.ts test/registry-refused-census.test.ts
```

Run it in the foreground, with a timeout of at least 600000 ms. Expected:
- `registry-refused-callers.test.ts`: 6 failed and 2 passed.
  - `verifyDone for a run whose sessionId is --actor…`: `expected { ok: false, code: 'pr-unmeasurable', …(1) } to deeply equal { ok: false, code: 'tip-unmeasurable', …(1) }`. The refused row is in no `records`, so the fallback took `run.branch` and composed `pr-state --session --actor`.
  - `a review close whose WORK run's…`: `expected { ok: true, id: <n>, state: 'done', … } to deeply equal { ok: false, kind: 'doneVerdict', … }`.
  - `an unlistable registry before the spawn…`: `expected { ok: true, … sessionId: 'demo-quiet-basin', … } to deeply equal { ok: false, kind: 'registry-unmeasurable' }`.
  - `a refused name that appeared during the spawn…`: the same shape.
  - `a prior snapshot holding --actor…`: `expected [ '--actor', 'demo-a' ] to deeply equal [ 'demo-a' ]`.
  - `past MAIL_MAX_ATTEMPTS…`: `expected 'registry-absent' to be 'registry-unmeasurable'`.
  - GREEN already, and correctly so: `control: a refused row present before the spawn does not refuse`, because nothing refuses yet. Also `one tick over a planted --actor row…`, because Task 5's omission is the behaviour. Their reds are mutation rows 3 and 7.
- `registry-refused-census.test.ts`: `the classified set is exactly these 20 sites` FAILS on the eight words, because every tag still reads `unplaced`. The two new `tick hands its records…` cases PASS, because the source already passes them. Their red is mutation row 8.

A different failure, such as a load error on `refused` or a TS error in the census file, means Task 5's names differ from the frame. STOP and report `census-row-shape`.

- [ ] **Step 3: Implement**

(a) `server/src/coord/fingerprint.ts`.

The import:

```ts
import { isPrPhase, type DoneRejectCode, type PrPhase } from '../../../shared/api.js';
```

becomes

```ts
import { isPrPhase, isRegistryId, type DoneRejectCode, type PrPhase } from '../../../shared/api.js';
```

In `resolveDoneBranch`, the lines

```ts
): Promise<{ ok: true; branch: string; provenance: string } | { ok: false; code: DoneRejectCode; detail: string }> {
  // The registry's branch, not `run.branch` — see `DoneRun`'s docstring for
```

become

```ts
): Promise<{ ok: true; branch: string; provenance: string } | { ok: false; code: DoneRejectCode; detail: string }> {
  // FIRST, and pure, so it stands before the read (spec §2.3). A session id
  // that is not a registry id is refused by `readRegistryMeasured`: listed,
  // never read, absent from `records`. Without this check `record` below would
  // be `undefined` and the frozen `run.branch` fallback would answer for it — a
  // done-claim settled on a ref nobody measured, and `verifyDone`'s `pr-state`
  // composed with an id ccd could read as a flag. Held, never a fact:
  // `tip-unmeasurable`. `verifyReviewDone` reaches here with the WORK run's id,
  // which the review run's own close gate never checks, so on that path this is
  // the only check.
  if (!isRegistryId(run.sessionId)) {
    return { ok: false, code: 'tip-unmeasurable',
      detail: 'the run\'s session id is not a registry id: it is refused, never read' };
  }
  // The registry's branch, not `run.branch` — see `DoneRun`'s docstring for
```

Replace the one comment line holding `[registry-refused:unplaced]` directly above `  const registryRead = await readRegistryMeasured(deps.io, deps.cfg);` in `resolveDoneBranch` with:

```ts
  // [registry-refused:holds] the check at the top of this function holds a refused id before this read.
```

(b) `server/src/coord/dispatch.ts`.

The import:

```ts
import { fieldMeasured, measuredIdentity, readRegistry, readRegistryMeasured } from '../registry.js';
```

becomes

```ts
import { fieldMeasured, measuredIdentity, readRegistryMeasured } from '../registry.js';
```

In `DispatchOutcome`'s `registry-unmeasurable` docstring, the lines

```ts
   *  ABSENT is not "ccd said nothing": it is "ccd is not the failing party" (the
   *  `ws-add` or `ensure` succeeded, and only the registry read failed). An empty
```

become

```ts
   *  ABSENT is not "ccd said nothing": it is "ccd is not the failing party" (the
   *  `ws-add` or `ensure` succeeded, and only the registry read failed; or, on the
   *  fresh-spawn arm's pre-spawn read, no ccd call has been made at all). An empty
```

The pre-spawn block runs from the line `    // BEFORE tolerates degradation, deliberately — the question it answers` through `    const beforeIds = new Set(before.map((r) => r.id));`, including Task 5's `[registry-refused:unplaced]` line between them. Replace the whole span with:

```ts
    // BEFORE is MEASURED, and an unlistable registry REFUSES here (spec §2.3).
    // It used to be tolerated: `readRegistry` collapsed a failed listing to
    // `[]`, which empties `beforeIds` — one of the two measured triggers for a
    // false-new ADOPTION the AFTER read below describes. Refusing costs a retry
    // and nothing else: no `route-omitted` or `child-omitted` event, no
    // `markDispatchStarted` and no `ws-add` has happened yet, and the run stays
    // `planned`.
    //
    // A DEGRADED or DROPPED row is still tolerated, deliberately: the question
    // BEFORE answers ("which ids already exist") is "does this still exist", and
    // a row that just doesn't count as pre-existing is the SAFE direction to be
    // wrong in here: at worst a real id is treated as new and trips
    // `ambiguous-dispatch` below, never a silent misbind.
    //
    // `beforeIds` holds the REFUSED ids too: names `readRegistryMeasured` lists
    // and never reads, because they are not registry ids. The AFTER read refuses
    // a refused name BEFORE did not list, so one that was already here must count
    // as pre-existing, or one stray file would refuse every dispatch.
    // [registry-refused:refuses] an unlistable registry refuses before anything is spawned.
    const beforeRead = await readRegistryMeasured(deps.io, deps.cfg);
    if (!beforeRead.listed) return { ok: false, kind: 'registry-unmeasurable' };
    const beforeIds = new Set<string>([...beforeRead.records.map((r) => r.id), ...beforeRead.refused]);
```

The post-spawn refusal. The lines

```ts
    // nothing else has claimed the row.
```

then Task 5's one `[registry-refused:unplaced]` line, then

```ts
    const afterRead = await readRegistryMeasured(deps.io, deps.cfg);
    if (!afterRead.listed ||
        afterRead.records.some((r) => r.project === run.project && measuredIdentity(r) === null)) {
```

become

```ts
    // nothing else has claimed the row.
    //
    // Since spec §2.3 the first of those triggers refuses at BEFORE, above. And a
    // THIRD condition refuses here: a REFUSED name (listed, never read, because
    // it is not a registry id) that BEFORE did not list. Subtraction cannot see
    // it: it is in no `records`, so it is never a candidate, and the one valid
    // new row beside it would be bound as this spawn's own while the name this
    // spawn may really have made sits unread. Unmeasurable, never a guess. A
    // refused name BEFORE already listed is in `beforeIds` and refuses nothing.
    // [registry-refused:refuses] a refused name new since BEFORE refuses the bind.
    const afterRead = await readRegistryMeasured(deps.io, deps.cfg);
    if (!afterRead.listed ||
        afterRead.records.some((r) => r.project === run.project && measuredIdentity(r) === null) ||
        [...afterRead.refused].some((x) => !beforeIds.has(x))) {
```

The body of that `if` (ccd's stderr ride-along and its return) is unchanged.

The resume arm. Replace the one comment line holding `[registry-refused:unplaced]` that sits between `    // means only the first, tolerated case — never the second.` and `    const registryRead = await readRegistryMeasured(deps.io, deps.cfg);` with:

```ts
    //
    // NO REFUSED-ID ARM HERE, by design (spec §2.3). `sessionId` is the run's
    // STORED id, and two guards stand ahead of this read: `dispatchRun`'s
    // stored-row gate (the `bad-session` refusal right after
    // `holdReasonVerdict`, before the pause listing) refuses it outright, and
    // behind that gate `childBindGate` above holds it `spent-unmeasured`
    // (`readSessionRecord` answers `bad-id`) before `ensure` is composed. An arm
    // here could never be reached, so it could never be pinned: the two guards
    // carry the pins.
    // [registry-refused:gated] guarded by the stored-row gate and childBindGate, above.
```

The `return refuseSpentChild(deps, { id: run.id, sessionId }, childGate, dispatchDec);` line is NOT touched: `unattended-actor.test.ts` pins it by its own text.

(c) `server/src/watch.ts`.

The single-line import:

```ts
import { FLEET_SCOPE, LEDGER_STALE_MS, MAIL_MAX_ATTEMPTS, MAIL_REPLAY_MS, STALL_FOLLOW_LABEL, STALL_LEVEL_TEXT, TERMINAL_DELIVERY_STATES, UNCHECKED_PR, lifecycleIsDead, sessionLifecycle } from '../../shared/api.js';
```

becomes, still ONE line:

```ts
import { FLEET_SCOPE, LEDGER_STALE_MS, MAIL_MAX_ATTEMPTS, MAIL_REPLAY_MS, STALL_FOLLOW_LABEL, STALL_LEVEL_TEXT, TERMINAL_DELIVERY_STATES, UNCHECKED_PR, isRegistryId, lifecycleIsDead, sessionLifecycle } from '../../shared/api.js';
```

`tick`. Replace the one `[registry-refused:unplaced]` line between `      // and changes nothing".` and `      const registryRead = await readRegistryMeasured(this.deps.io, this.deps.cfg);` with:

```ts
      // [registry-refused:omits] a refused id is in no `records`: no state, no field read, no act (spec §2.3).
```

The snapshot shrink guard. The line

```ts
              const allGenuinelyPurged = names !== null && missingIds.every((id) => !names.includes(`${id}.uuid`));
```

becomes

```ts
              // Spec §2.3: a REFUSED id (not a registry id) is never assembled, so a
              // snapshot an older build wrote may still carry it while its `.uuid`
              // stays listed. Its absence from `sessions` is not a partial read and
              // never heals, so it counts as purged — or one stray file would freeze
              // every snapshot write for as long as it stands.
              const allGenuinelyPurged = names !== null && missingIds.every((id) => !isRegistryId(id) || !names.includes(`${id}.uuid`));
```

`sweepHookStates`. Replace the one `[registry-refused:unplaced]` line directly above `      const registryRead = await readRegistryMeasured(this.deps.io, this.deps.cfg);` inside its `else` arm, which ends `if (!registryRead.listed) return;` then `recs = registryRead.records;`, with:

```ts
      // [registry-refused:tests-only] `tick()` hands this lane its own `records`; the census pins that hand-off.
```

`sweepTasks`. Replace the one `[registry-refused:unplaced]` line directly above its `    const registryRead = await readRegistryMeasured(this.deps.io, this.deps.cfg);`, which is followed by `const next = new Map<string, TaskProgress>();` two lines down, with:

```ts
    // [registry-refused:omits] a refused id is in no `records`: no `taskProgress` entry and no read (spec §2.3).
```

`sweepMail`. Replace the one `[registry-refused:unplaced]` line between `    // "we could not read the fleet this pass" for "this recipient is gone".` and `    const registryRead = await readRegistryMeasured(this.deps.io, this.deps.cfg);` with:

```ts
    // [registry-refused:holds] a refused recipient is held `registry-unmeasurable` below, never parked (spec §2.3).
```

Then, in the recipient arm, the line

```ts
          const unmeasurable = rec !== undefined;
```

becomes

```ts
          // Spec §2.3: a REFUSED recipient (listed, never read, because its id is
          // not a registry id) is absent from `records` but is not proven gone. It
          // is held exactly as a degraded row is: backed off, never ratcheted,
          // never parked.
          const unmeasurable = rec !== undefined || registryRead.refused.has(d.toId);
```

This change sits inside the `try` that follows `this.mailInFlight.add(d.toId)`, so `finally` still releases the claim. `registryRead` is a `const` narrowed by `if (!registryRead.listed) return;`.

Check from the workspace root:

```bash
grep -c "registry-refused:unplaced" server/src/coord/fingerprint.ts server/src/coord/dispatch.ts server/src/watch.ts   # 0, 0, 3
grep -c "await readRegistry(" server/src/coord/dispatch.ts                                                             # 0
git diff --stat                                                                                                        # three src files, the two test files
```

- [ ] **Step 4: Run the tests to verify they pass**

```bash
cd server && ./node_modules/.bin/vitest run test/registry-refused-callers.test.ts test/registry-refused-census.test.ts
```

Expected: both files PASS. Run it in the foreground, with a timeout of at least 600000 ms.

- [ ] **Step 5: Mutation check**

Record `git diff --stat` before row 1. Make each edit, run it, see the red, and revert it by hand before the next row. In this table `\|` is Markdown's escape for `|`: rows 4 to 6 edit the code's `||`. After each revert, `git diff --stat` must print exactly what it printed before row 1. Record each row's before and after in the SDD ledger. Run every command from `server/`:
- C is `./node_modules/.bin/vitest run test/registry-refused-callers.test.ts`.
- K is `./node_modules/.bin/vitest run test/registry-refused-census.test.ts`.

The worker measures every red text. Where the measured text differs from the draft's, the measured text replaces it.

| # | Mutation (exact edit) | Command | Expected red |
|---|---|---|---|
| 1 | `fingerprint.ts`: delete the whole `if (!isRegistryId(run.sessionId)) { … }` block at the top of `resolveDoneBranch` | `C -t 'fingerprint holds'` | verifyDone: `expected { ok: false, code: 'pr-unmeasurable', … } to deeply equal { ok: false, code: 'tip-unmeasurable', … }`. Review close: `expected { ok: true, … state: 'done', … } to deeply equal { ok: false, kind: 'doneVerdict', … }` |
| 2 | `dispatch.ts`: replace `if (!beforeRead.listed) return { ok: false, kind: 'registry-unmeasurable' };` and the `beforeIds` line with the old tolerance, `const beforeIds = new Set<string>(beforeRead.listed ? [...beforeRead.records.map((r) => r.id), ...beforeRead.refused] : []);` | `C -t 'before the spawn refuses'` | `expected { ok: true, … sessionId: 'demo-quiet-basin', … } to deeply equal { ok: false, kind: 'registry-unmeasurable' }` |
| 3 | `dispatch.ts`: `beforeIds` built as `new Set<string>(beforeRead.records.map((r) => r.id))` (refused ids left out) | `C -t 'present before the spawn'` | `expected { ok: false, kind: 'registry-unmeasurable' } to match object { ok: true, sessionId: 'demo-quiet-basin', adopted: false }` |
| 4 | `dispatch.ts`: delete ` \|\|` and the line `[...afterRead.refused].some((x) => !beforeIds.has(x))` from the post-spawn refusal | `C -t 'appeared during the spawn'` | `expected { ok: true, … sessionId: 'demo-quiet-basin', … } to deeply equal { ok: false, kind: 'registry-unmeasurable' }` |
| 5 | `watch.ts`: drop `!isRegistryId(id) \|\| ` from `allGenuinelyPurged` | `C -t 'prior snapshot'` | `expected [ '--actor', 'demo-a' ] to deeply equal [ 'demo-a' ]`, and the `snapshot write skipped` warn fires |
| 6 | `watch.ts`: delete ` \|\| registryRead.refused.has(d.toId)` | `C -t 'past MAIL_MAX_ATTEMPTS'` | `expected 'registry-absent' to be 'registry-unmeasurable'`. With that assertion skipped, it parks: `expected { state: 'rejected', rejectCode: 'undeliverable', … } to match object { state: 'queued', … }` |
| 7 | `registry.ts` (Task 5's code): the record loop in `readRegistryMeasured`, `for (const id of ids) {`, reads `for (const id of [...ids, ...refused]) {` (refused rows built into `records`) | `C -t 'one tick over a planted'` | `a refused row is never read…: expected [ '…/.cc-sessions/--actor.wrapper', … ] to deeply equal []`. It also reds `prior snapshot` (`[ '--actor', 'demo-a' ]`) |
| 8 | `watch.ts`: in `tick`, `await this.sweepHookStates(records);` becomes `await this.sweepHookStates();` | `K -t 'passes its records'` | `tick no longer hands sweepHookStates its records…: expected '{ … }' to match /\bthis\.sweepHookStates\(\s*records\s*\)/` |
| 9 | `fingerprint.ts`: the tag line's word `holds` reads `unplaced` again | `K -t 'exactly these 20 sites'` | the multiset differs on the `resolveDoneBranch` row (`unplaced` against `holds`) |

The compiler holds one guard, not a case; record it as such. Deleting only `if (!beforeRead.listed) return …;` turns `beforeRead.records` and `beforeRead.refused` into TS2339 errors, so tsc refuses that mutant. Row 2 measures the same guard through the tolerant spelling. The resume arm has no row: it adds no arm (R17), and its guards' rows are Task 3's dispatch-gate row and Task 4's `childBindGate` fold row.

- [ ] **Step 6: Run the task's other suites, and the typecheck**

```bash
cd server && ./node_modules/.bin/vitest run test/registry-refused-callers.test.ts test/registry-refused-census.test.ts test/coord-fingerprint.test.ts test/registry.test.ts
cd server && ./node_modules/.bin/vitest run test/dispatch-adopt.test.ts test/dispatch-route.test.ts test/run-routes.test.ts
cd server && ./node_modules/.bin/vitest run test/mail-sweep.test.ts test/fleetws.test.ts test/divergence-sweep.test.ts
cd server && ./node_modules/.bin/vitest run test/unattended-actor.test.ts test/verb-gate.test.ts test/mail-routes.test.ts test/typecheck-tests.test.ts
cd server && ./node_modules/.bin/tsc --noEmit -p . && ./node_modules/.bin/tsc --noEmit -p test/tsconfig.tests.json
```

Expected: every file PASSES, and both `tsc` calls print nothing. Run each line in the foreground, from the workspace root, with a timeout of at least 600000 ms.
- `mail-sweep`'s `MailGate` census is unchanged: `registry-unmeasurable` already has its call site.
- `mail-routes`'s kebab scan sees no new quoted kebab token in `server/src/coord`.
- Re-run a CLAUDE.md load flake in isolation before calling it a break.
- If a suite reds on a case that plants a non-registry id as a NEW row during a spawn, STOP and report `refused-spawn-row-in-an-existing-suite`. Such a case now answers `registry-unmeasurable` where it expected `ambiguous-dispatch` or `fleetFailed`. Task 5 should have rewritten it, and this task names no such file.

Then check the boundary:

```bash
git diff --name-only    # exactly: server/src/coord/dispatch.ts server/src/coord/fingerprint.ts server/src/watch.ts
                        #          server/test/registry-refused-callers.test.ts server/test/registry-refused-census.test.ts
```

- [ ] **Step 7: Commit**

```bash
git add server/src/coord/fingerprint.ts server/src/coord/dispatch.ts server/src/watch.ts \
  server/test/registry-refused-census.test.ts server/test/registry-refused-callers.test.ts
git commit -m "$(cat <<'MSG'
fix(coord,watch): the measured readers hold, refuse or omit a refused row; dispatch measures before it spawns

A refused row is a registry name that is not a registry id:
readRegistryMeasured lists it in refused and never reads it. Its seven
direct callers now place that answer:
- fingerprint: resolveDoneBranch holds a refused session id as
  tip-unmeasurable before its read, so neither verifyDone nor a review
  close falls back to the frozen run.branch for it;
- dispatch: the pre-spawn read is measured and refuses
  registry-unmeasurable on an unlistable registry before anything is
  spawned. beforeIds carries the refused ids, and the post-spawn read
  refuses when a refused name appears that the pre-spawn read did not
  list. The resume arm's read stays guarded by the stored-row gate and
  childBindGate;
- the watches: tick, sweepTasks and sweepHookStates omit a refused id,
  and the snapshot shrink guard counts a refused id as purged, so a
  cache an older build wrote cannot freeze snapshot writes;
- mail: a delivery to a refused recipient is held
  registry-unmeasurable, never parked undeliverable.
The reader census places these eight sites and pins that tick hands its
records to sweepHookStates. Spec §2.3.
MSG
)"
```

Name these departures, by slug, in the wave-done: `pre-spawn-listing-is-the-second` and `registry-unmeasurable-docstring-names-the-pre-spawn-refusal`. Also carry one more row under R24's `wave-lifecycle-rows-carried`: a review close whose WORK run's stored `sessionId` is not a registry id answers `tip-unmeasurable` on every retry, so the coordinator closes that review `failed`.

---

### Task 7: Three more callers migrate — the fleet fallback, projects and peers

**Model routing:** `opus`, effort `high`.

**Why:** spec §2.3 says the readers that turned an unlistable registry or a refused row into a silent answer must report what they could not measure. Four such answers stand at the tip:
- `GET /api/fleet` and the ws cold start pass `records: undefined`, so `assembleFleet`'s fallback reads `readRegistry`. That read turns an unlistable registry into `[]`, and the route then serves an empty fleet with no stale mark.
- `listProjects` drops the registry half of its union without saying so.
- `GET /api/peers` lists the registry and reads it in two separate reads. It answers 502 forever for a `?of=` that can never be a registry id, and since Task 5 it silently loses refused rows.
- The claims-conflict path lists the registry once for its presence ladder and reads its rows a second time through the fallback, so the two halves describe different observations.

This task applies R12, R19 and R23. Every new reader call carries its placed `[registry-refused:<word>]` tag (R25).

**Departures this task takes (each named by slug in the wave-done):**
- `fleet-health-fixtures-list-their-registry`. Two existing `fleet-health.test.ts` cases build a remote-mode fixture with no `.cc-sessions` directory and assert the LIVE arm's shape. After this task, an unlistable registry serves the stale arm, so those cases would assert the old behaviour. Each case gains one `mkdirSync(deps.cfg.registryDir, { recursive: true })`, and its expected `pools` becomes the listed-and-untagged shape. The case titles' intent ("live assemble") is kept. This file is not in the frame's list for Task 7.
- `claims-conflict-pinned-on-its-own-listing`. The frame's case is titled "the claims-conflict path on an unlistable registry reads presence unmeasured". A wholly unlistable registry never reaches the conflict arm, because the attribution answers 502 first. It also reads `unknown` both before and after this task, so a case built that way could not go red. The case therefore fails exactly the conflict arm's own listing, which it finds by a calibration request. It pins `unknown` and a total of attribution + 1 listings (one read).
- `task7-census-pins-carry-their-own-scan`. The census file's new describe brings its own aliased imports and scan helpers, so it cannot collide with whatever names Task 5's file declares.

**Files:**
- Modify `server/src/fleet.ts`:
  - the `./registry.js` import: `readRegistry` becomes `readRegistryMeasured`;
  - `assembleFleet`'s fallback line, located by `records ?? readRegistry(io, cfg)`, and the `[registry-refused:unplaced]` tag line Task 5 placed directly above it.
- Modify `server/src/server.ts`:
  - the `./registry.js` import (`import { freshAskAt, measuredIdentity, readRegistry, readSessionRecord } from './registry.js';`);
  - `GET /api/fleet` (`app.get('/api/fleet', async () => {`): a read between the disconnected arm's closing `}` and `// FIRST PAINT (spec §5.4.4).`, plus the records argument of its `sessions: await assembleFleet(` line;
  - the ws cold start, from `const broadcast = watcher?.currentFleet() ?? null;` through `if (!broadcastSeen) sendFleet(sessions);`, and the `hello, fleet, runs.` comment line above it.
- Modify `server/src/lifecycle.ts`:
  - the `./registry.js` import;
  - `listProjects`: its docstring's last lines, its return type, the `for (const rec of await readRegistry(io, cfg)) {` line with Task 5's tag line above it, and its `return`.
- Modify `server/src/coord/routes.ts`:
  - the `../../../shared/api.js` import line holding `isSessionIdShape`;
  - `GET /api/peers`, from `// ONE listing, reused below for the presence ladder` through its `assembleFleet(` call, and its final `return reply.code(200).send({ ok: true, peers, projects, etiquette: PEER_ETIQUETTE });`;
  - the claims-conflict arm's `const names = await deps.io.readdir(deps.cfg.registryDir);` and the `assembleFleet(` call under it.
- Modify `server/test/registry-refused-census.test.ts`:
  - Task 5's multiset case: retitle it, change three rows and add three;
  - add four aliased import lines below its last `import`;
  - append one describe at its foot.
- Modify `server/test/fleetws.test.ts`: the case `reports unmeasurable for BOTH markers when the registry cannot be listed` loses its `fleet` expectation (the frame's "only if the cold-start order pin names a fleet frame on an unlistable registry": it does).
- Modify `server/test/fleet-health.test.ts`: the two cases named under the departure `fleet-health-fixtures-list-their-registry`.
- Create `server/test/registry-migrated-callers.test.ts`.
- Not edited: `server/test/lifecycle.test.ts`. Measured at `837a099c0`, no equality there names `listProjects`'s result or the `/api/projects` body whole. Each assertion reads `.roots`, `.projects` or one row, so the additive `registry` key breaks nothing.

**Interfaces:**
- Consumes:
  - `RegistryRead` (Task 5): `{ listed: true; records: SessionRecord[]; names: readonly string[]; refused: ReadonlySet<string> } | { listed: false }`;
  - `readRegistryMeasured(io: FleetIO, cfg: CcrcConfig): Promise<RegistryRead>`;
  - `isRegistryId(id: unknown): id is string` (Task 1, `shared/api.ts`);
  - `REFUSED_IDS: readonly string[]` (Task 1, `server/test/registryIdCases.ts`);
  - existing: `loadSnapshot(cachePath: string): Promise<FleetSnapshot | null>` and `saveSnapshot(sessions, cachePath)` (`server/src/fleetstate.ts`), `codeOnly` (`server/test/sourceScan.ts`), `testDeps`, `mkTmp`.
- Produces:
  - `listProjects(io: FleetIO, cfg: CcrcConfig): Promise<{ roots: string[]; projects: ProjectRow[]; registry: 'listed' | 'unlistable' }>` (canonical);
  - wire, additive and absence-permitting, with no L0 type:
    - `GET /api/fleet` on an unlistable registry answers `{ sessions: watcher?.currentFleet() ?? snapshot?.sessions ?? [], stale: true }`;
    - `GET /api/projects` carries `registry`;
    - `GET /api/peers` carries `refusedRows: number` only when it is greater than 0;
    - `GET /api/peers?of=` with a non-registry id answers 400 `{ ok: false, error: 'bad-session' }` before any read;
    - the ws cold start sends no `fleet` frame on an unlistable registry, and still sends `runs`.
  - Test-local only: `registryIO(registryDir)`, `openSocket(server)`, `t7Args(text, open)`, `t7CallLines(rel, name)`, `t7TagAbove(rel, line)`.

- [ ] **Step 1: Re-measure the five sites by content (from the workspace root)**

```bash
grep -n "records ?? readRegistry(io, cfg)" server/src/fleet.ts                                           # (1) one line: the fallback
grep -n "for (const rec of await readRegistry(io, cfg)) {" server/src/lifecycle.ts                       # (2) one line: listProjects
grep -n "app.get('/api/fleet', async () => {" server/src/server.ts                                       # (3) one line
grep -n "const broadcast = watcher?.currentFleet() ?? null;" server/src/server.ts                        # (4) one line: the ws cold start
grep -n "const recs = await readRegistry(deps.io, deps.cfg);" server/src/coord/routes.ts                 # (5) one line: GET /api/peers
grep -n "undefined, undefined, undefined, undefined, undefined, undefined, undefined, deps.coord, undefined);" server/src/coord/routes.ts   # (6) one line: the claims conflict
grep -n "refused: ReadonlySet<string>" server/src/registry.ts                                            # (7) Task 5's RegistryRead
grep -c "\[registry-refused:unplaced\]" server/src/fleet.ts server/src/lifecycle.ts server/src/coord/routes.ts   # (8) 1, 1, 4
grep -n "isRegistryId" server/src/coord/routes.ts server/src/server.ts | head                             # (9) whether routes.ts already imports it
grep -ln "url: '/api/fleet'\|/ws/fleet\`" server/test/*.ts                                               # (10) every test that reaches the two changed doors
```

- (1) to (6): each prints one line. A different line number is not a departure; re-point by content and record it. A count of 0 is a STOP (`gate-site-moved`).
- (7): one line. If it prints nothing, Task 5 is not in this tree. **STOP**.
- (8): Task 5 tagged these sites. Each `unplaced` line directly above sites (1), (2) and (5) is deleted in Step 5.
- (9): if `routes.ts` already imports `isRegistryId` (an earlier task added it), skip Step 5d's import edit.
- (10): at `837a099c0` this prints `auth-gate`, `fleetws`, `divergence-sweep`, `pr-sweep`, `fleet-health` and `auth-passkey`. For any file outside that list, read whether its fixture HOME has a `.cc-sessions` directory. If it has none and the file asserts a `fleet` frame or a `pools` key, it meets the stale arm: record it, and fix it the way Step 6 fixes `fleet-health`.

- [ ] **Step 2: Write the failing behaviour file `server/test/registry-migrated-callers.test.ts`**

```ts
// Path identity W1a, Task 7 (spec §2.3). Readers that answered an unlistable registry, or a refused row, with an
// empty or silent answer now say what they could not measure:
// - GET /api/fleet serves the watcher's last fleet, else the last-known-good snapshot, else nothing, marked
//   `stale: true`, and never a bare `{sessions: []}`;
// - the /ws/fleet cold start sends no `fleet` frame then, and still sends its `runs` frame;
// - GET /api/projects carries `registry: 'listed' | 'unlistable'`;
// - GET /api/peers counts refused rows (`refusedRows`, only when greater than 0) and refuses a `?of=` that is not a
//   registry id before any read;
// - the claims-conflict path reads the registry ONCE, so its rows and its presence ladder are one observation.
// Fixture HOMEs only. A dash-named row is a plain file under the fixture's registry.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import WebSocket from 'ws';
import type { FastifyInstance } from 'fastify';
import { buildServer, type Deps } from '../src/server.js';
import type { Runner } from '../src/exec.js';
import { Bus } from '../src/bus.js';
import { FleetWatcher } from '../src/watch.js';
import { loadConfig } from '../src/config.js';
import { localIO, type FleetIO } from '../src/io.js';
import { saveSnapshot } from '../src/fleetstate.js';
import { listProjects } from '../src/lifecycle.js';
import { openCoordDb } from '../src/coord/db.js';
import { CoordStore } from '../src/coord/store.js';
import type { FleetSession } from '../../shared/api.js';
import { REFUSED_IDS } from './registryIdCases.js';
import { testDeps } from './helpers.js';
import { mkTmp } from './tmpHelpers.js';

const TOKEN = 'f'.repeat(64);
const tok = { 'x-ccrc-mail-token': TOKEN };
const UUID_A = 'a'.repeat(36);
const UUID_B = 'b'.repeat(36);
const UUID_X = 'c'.repeat(36);

/** A registry row `readRegistryMeasured` builds. Any id, a dash-led one included: it is a plain file name under the
 *  fixture's registry. */
const seed = (home: string, id: string, uuid: string, over: Record<string, string> = {}): void => {
  const reg = path.join(home, '.cc-sessions');
  mkdirSync(reg, { recursive: true });
  const fields: Record<string, string> = {
    wrapper: 'claude', project: 'demo', workdir: `/w/demo/${id}`, uuid, started: '1', ...over,
  };
  for (const [k, v] of Object.entries(fields)) writeFileSync(path.join(reg, `${id}.${k}`), v);
};

/** tmux answers every pane alive, with a pid and an empty capture; every other exec fails. */
const aliveTmux: Runner = async (_cmd, args) => {
  if (args[0] === 'has-session') return { code: 0, stdout: '', stderr: '' };
  if (args[0] === 'list-panes') return { code: 0, stdout: '4061\n', stderr: '' };
  if (args[0] === 'capture-pane') return { code: 0, stdout: '', stderr: '' };
  return { code: 1, stdout: '', stderr: '' };
};

/** `localIO`, except that each listing of the registry directory is COUNTED and can be failed: while `blind` is set
 *  every one fails, and `failAt` (1-based, 0 = never) fails exactly that one. Every other path reads through. */
const registryIO = (registryDir: string) => {
  const state = { listings: 0, blind: false, failAt: 0 };
  const io: FleetIO = {
    ...localIO,
    readdir: async (p, timeoutMs, signal) => {
      if (p !== registryDir) return localIO.readdir(p, timeoutMs, signal);
      state.listings += 1;
      if (state.blind || state.listings === state.failAt) return null;
      return localIO.readdir(p, timeoutMs, signal);
    },
  };
  return { io, state };
};

/** A fixture-local state cache, so no case reads the default path. */
const cachePathOf = (home: string): string => path.join(home, '.ccrc', 'state-cache.json');

type Frame = { type: string; sessions?: FleetSession[] };

/** Listen, connect to /ws/fleet, and record every frame in arrival order. */
const openSocket = async (server: FastifyInstance): Promise<{ ws: WebSocket; frames: Frame[] }> => {
  await server.listen({ host: '127.0.0.1', port: 0 });
  const addr = server.server.address();
  const port = typeof addr === 'object' && addr !== null ? addr.port : 0;
  const ws = new WebSocket(`ws://127.0.0.1:${port}/ws/fleet`);
  const frames: Frame[] = [];
  ws.on('message', (d) => { frames.push(JSON.parse(String(d)) as Frame); });
  await new Promise<void>((resolve, reject) => { ws.on('open', () => resolve()); ws.on('error', reject); });
  return { ws, frames };
};

describe('fleet, projects and peers report what they could not measure (spec §2.3)', () => {
  let app: FastifyInstance | undefined;
  // An unlistable registry logs `noteWholeFleetListing`'s line and a refused row logs once: both are expected here.
  beforeEach(() => { vi.spyOn(console, 'warn').mockImplementation(() => {}); });
  afterEach(async () => {
    if (app) await app.close();
    app = undefined;
    vi.restoreAllMocks();
  });

  it('GET /api/fleet on an unlistable registry answers stale:true', async () => {
    const home = mkTmp('ccrc-w1a-fleet-');
    seed(home, 'demo-quiet-mesa', UUID_A);
    const base = testDeps(home, aliveTmux);
    const { io, state } = registryIO(base.cfg.registryDir);
    const cachePath = cachePathOf(home);
    const deps: Deps = { ...base, io, stateCachePath: cachePath };

    // (1) No watcher and no snapshot: an EMPTY fleet marked stale, never a bare `{sessions: []}`, which would tell
    // the phone every session had gone.
    app = await buildServer(deps);
    state.blind = true;
    const bare = await app.inject({ method: 'GET', url: '/api/fleet' });
    expect(bare.statusCode).toBe(200);
    expect(bare.json()).toEqual({ sessions: [], stale: true });

    // (2) The last-known-good snapshot, when there is one.
    state.blind = false;
    const live = (await app.inject({ method: 'GET', url: '/api/fleet' })).json() as { sessions: FleetSession[]; stale?: boolean };
    expect(live.stale).toBeUndefined();
    expect(live.sessions.map((s) => s.id)).toEqual(['demo-quiet-mesa']);
    await saveSnapshot(live.sessions, cachePath);
    state.blind = true;
    const fromSnap = (await app.inject({ method: 'GET', url: '/api/fleet' })).json() as Record<string, unknown>;
    expect(fromSnap['stale']).toBe(true);
    expect((fromSnap['sessions'] as FleetSession[]).map((s) => s.id)).toEqual(['demo-quiet-mesa']);
    expect(Object.keys(fromSnap).sort(), 'no pools (nothing measured) and no downSince (the link is up)')
      .toEqual(['sessions', 'stale']);
    await app.close();
    app = undefined;

    // (3) The watcher's last broadcast wins over the snapshot: it is this process's newest measurement.
    seed(home, 'demo-still-pond', UUID_B);
    state.blind = false;
    const bus = new Bus();
    const watcher = new FleetWatcher(deps, bus);
    app = await buildServer(deps, bus, watcher);
    await watcher.tick();
    state.blind = true;
    const fromWatcher = (await app.inject({ method: 'GET', url: '/api/fleet' })).json() as { sessions: FleetSession[]; stale: boolean };
    expect(fromWatcher.stale).toBe(true);
    expect(fromWatcher.sessions.map((s) => s.id).sort()).toEqual(['demo-quiet-mesa', 'demo-still-pond']);
  });

  it('the ws cold start with no watcher broadcast, on an unlistable registry, sends hello, then runs, and no fleet frame', async () => {
    const home = mkTmp('ccrc-w1a-cold-');
    seed(home, 'demo-quiet-mesa', UUID_A);
    const base = testDeps(home, aliveTmux);
    const { io, state } = registryIO(base.cfg.registryDir);
    state.blind = true;
    const coord = new CoordStore(openCoordDb(path.join(home, '.ccrc', 'coord.db')));
    app = await buildServer({ ...base, io, coord, stateCachePath: cachePathOf(home) });
    const { ws, frames } = await openSocket(app);
    // `runs` is chained after the fleet decision in ONE `.then`, so once it has arrived no cold `fleet` can follow.
    await vi.waitFor(() => expect(frames.map((f) => f.type)).toContain('runs'));
    expect(frames.map((f) => f.type)).toEqual(['hello', 'runs']);
    ws.close();
  });

  it('the ws cold start with a watcher broadcast reads no registry', async () => {
    const home = mkTmp('ccrc-w1a-cold-');
    seed(home, 'demo-quiet-mesa', UUID_A);
    const base = testDeps(home, aliveTmux);
    const { io, state } = registryIO(base.cfg.registryDir);
    const bus = new Bus();
    // The watcher reads through its OWN io, so every listing `state` counts is the server's.
    const watcher = new FleetWatcher({ ...base, io: localIO, stateCachePath: cachePathOf(home) }, bus);
    app = await buildServer({ ...base, io, stateCachePath: cachePathOf(home) }, bus, watcher);
    await watcher.tick();
    expect(watcher.currentFleet()?.map((s) => s.id)).toEqual(['demo-quiet-mesa']);
    state.listings = 0;
    const { ws, frames } = await openSocket(app);
    await vi.waitFor(() => expect(frames.map((f) => f.type)).toContain('fleet'));
    expect(frames.find((f) => f.type === 'fleet')?.sessions?.map((s) => s.id)).toEqual(['demo-quiet-mesa']);
    expect(state.listings, 'the cold frame is the broadcast: no registry read').toBe(0);
    ws.close();
  });

  it("GET /api/projects answers registry:'unlistable' on an unlistable registry, and still lists the root projects", async () => {
    const home = mkTmp('ccrc-w1a-projects-');
    const root = mkTmp('ccrc-w1a-root-');
    mkdirSync(path.join(root, 'alpha'));
    seed(home, 'demo-quiet-mesa', UUID_A, { project: 'regonly', workdir: '/w/regonly' });
    const base = testDeps(home, aliveTmux);
    const cfg = loadConfig({ CCRC_HOME: home, CCRC_PROJECTS_ROOT: root });
    const { io, state } = registryIO(cfg.registryDir);
    state.blind = true;
    app = await buildServer({ ...base, cfg, io });
    const res = await app.inject({ method: 'GET', url: '/api/projects' });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { registry?: string; projects: { name: string }[] };
    expect(body.registry).toBe('unlistable');
    expect(body.projects.map((p) => p.name), 'the root walk still answers; the registry half was not read')
      .toEqual(['alpha']);
    const direct = await listProjects(io, cfg);
    expect(direct.registry).toBe('unlistable');
    expect(direct.projects.map((p) => p.name)).toEqual(['alpha']);
  });

  it("GET /api/projects answers registry:'listed' when the registry lists", async () => {
    const home = mkTmp('ccrc-w1a-projects-');
    const root = mkTmp('ccrc-w1a-root-');
    mkdirSync(path.join(root, 'alpha'));
    seed(home, 'demo-quiet-mesa', UUID_A, { project: 'regonly', workdir: '/w/regonly' });
    const base = testDeps(home, aliveTmux);
    const cfg = loadConfig({ CCRC_HOME: home, CCRC_PROJECTS_ROOT: root });
    app = await buildServer({ ...base, cfg });
    const body = (await app.inject({ method: 'GET', url: '/api/projects' })).json() as { registry?: string; projects: { name: string }[] };
    expect(body.registry).toBe('listed');
    expect(body.projects.map((p) => p.name)).toEqual(['alpha', 'regonly']);
    expect((await listProjects(localIO, cfg)).registry).toBe('listed');
  });

  const peersApp = async (home: string, io: FleetIO = localIO): Promise<FastifyInstance> => {
    const coord = new CoordStore(openCoordDb(path.join(home, '.ccrc', 'coord.db')));
    return buildServer({ ...testDeps(home, aliveTmux), mailToken: TOKEN, coord, io });
  };

  it('GET /api/peers?project= with a planted --actor row answers 200 with refusedRows:1', async () => {
    const home = mkTmp('ccrc-w1a-peers-');
    seed(home, 'demo-quiet-mesa', UUID_A);
    seed(home, '--actor', UUID_X);
    app = await peersApp(home);
    const res = await app.inject({ method: 'GET', url: '/api/peers?project=demo', headers: tok });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { peers: { id: string }[]; refusedRows?: number };
    expect(body.peers.map((p) => p.id), 'a refused row is never read, so never a peer').toEqual(['demo-quiet-mesa']);
    expect(body.refusedRows).toBe(1);
  });

  it('GET /api/peers?project= with no refused row has no refusedRows key', async () => {
    const home = mkTmp('ccrc-w1a-peers-');
    seed(home, 'demo-quiet-mesa', UUID_A);
    app = await peersApp(home);
    const res = await app.inject({ method: 'GET', url: '/api/peers?project=demo', headers: tok });
    expect(res.statusCode).toBe(200);
    expect('refusedRows' in (res.json() as Record<string, unknown>), 'absence permits: the key rides only when > 0').toBe(false);
  });

  it('GET /api/peers?of=--actor answers 400 bad-session with no listing', async () => {
    const home = mkTmp('ccrc-w1a-peers-');
    seed(home, 'demo-quiet-mesa', UUID_A);
    seed(home, '--actor', UUID_X);
    const { io, state } = registryIO(path.join(home, '.cc-sessions'));
    app = await peersApp(home, io);
    const res = await app.inject({ method: 'GET', url: '/api/peers?of=--actor', headers: tok });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({ ok: false, error: 'bad-session' });
    expect(state.listings, 'refused before any read: a bad id never heals').toBe(0);
  });

  it.each(REFUSED_IDS)('GET /api/peers?of=%j, no row planted, answers 400 bad-session with no listing', async (id) => {
    const home = mkTmp('ccrc-w1a-peers-');
    seed(home, 'demo-quiet-mesa', UUID_A);
    const { io, state } = registryIO(path.join(home, '.cc-sessions'));
    app = await peersApp(home, io);
    const res = await app.inject({ method: 'GET', url: `/api/peers?of=${encodeURIComponent(id)}`, headers: tok });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({ ok: false, error: 'bad-session' });
    expect(state.listings).toBe(0);
  });

  it('GET /api/peers on an unlistable registry answers the existing 502', async () => {
    const home = mkTmp('ccrc-w1a-peers-');
    seed(home, 'demo-quiet-mesa', UUID_A);
    const { io, state } = registryIO(path.join(home, '.cc-sessions'));
    state.blind = true;
    app = await peersApp(home, io);
    const res = await app.inject({ method: 'GET', url: '/api/peers?project=demo', headers: tok });
    expect(res.statusCode).toBe(502);
    expect(res.json()).toMatchObject({ ok: false, error: 'registry-unmeasurable' });
    expect(state.listings, 'ONE read: the listing and the rows are one observation').toBe(1);
  });

  it('the claims-conflict path on an unlistable registry reads presence unmeasured', async () => {
    const home = mkTmp('ccrc-w1a-claims-');
    seed(home, 'demo-quiet-mesa', UUID_A);
    seed(home, 'demo-still-pond', UUID_B);
    const { io, state } = registryIO(path.join(home, '.cc-sessions'));
    const coord = new CoordStore(openCoordDb(path.join(home, '.ccrc', 'coord.db')));
    const server = await buildServer({ ...testDeps(home, aliveTmux), mailToken: TOKEN, coord, io });
    app = server;
    const claim = (byId: string, byUuid: string, p: string) => server.inject({
      method: 'POST', url: '/api/claims', headers: tok,
      payload: { byId, byUuid, project: 'demo', paths: [p], intent: 'work' },
    });

    // Calibrate: an uncontested claim spends the attribution's listings alone, so the conflict arm's own read is
    // the one after them.
    state.listings = 0;
    expect((await claim('demo-quiet-mesa', UUID_A, 'shared/api.ts')).statusCode).toBe(200);
    const attribution = state.listings;
    expect(attribution, 'the attribution lists the registry').toBeGreaterThan(0);

    // Control: the same conflict with nothing failed reads the holder as deliverable, in ONE more listing.
    state.listings = 0;
    const seen = await claim('demo-still-pond', UUID_B, 'shared/api.ts');
    expect(seen.statusCode).toBe(409);
    expect((seen.json() as { conflicts: { deliverable: string }[] }).conflicts[0]!.deliverable).toBe('yes');
    expect(state.listings, 'the conflict arm reads the registry ONCE').toBe(attribution + 1);

    // The conflict arm's one listing fails: no rows and no listing, so presence is unmeasured, never `yes` off a
    // second read the ladder never saw.
    state.listings = 0;
    state.failAt = attribution + 1;
    const res = await claim('demo-still-pond', UUID_B, 'shared/api.ts');
    expect(res.statusCode).toBe(409);
    const c = (res.json() as { conflicts: { heldBy: string; deliverable: string }[] }).conflicts[0]!;
    expect(c.heldBy).toBe('demo-quiet-mesa');
    expect(c.deliverable).toBe('unknown');
    expect(state.listings).toBe(attribution + 1);
  });
});
```

- [ ] **Step 3: Extend the census `server/test/registry-refused-census.test.ts`**

(a) Task 5's case `the classified set is exactly these 20 sites` still counts 20: Task 6 changed eight words and one reader, and kept the count. Make these changes to it:
- Retitle it `the classified set is exactly these 23 sites`.
- Change its `expect(EXPECTED_SITES).toHaveLength(20);` to `expect(EXPECTED_SITES).toHaveLength(23);`.
- In `EXPECTED_SITES`, replace three rows and add three, as shown below. Each row is one string in Task 5's spelling, `'<file under server/src> | <enclosing> | <reader> | <word>'`. A route's enclosing is `<METHOD> <path>`, as Task 5's `enclosingOf` writes it. Match each row by its whole string, wherever it stands; the case sorts both sides.

Replace these three rows:
```ts
  'fleet.ts | assembleFleet | readRegistry | unplaced',
  'lifecycle.ts | listProjects | readRegistry | unplaced',
  'coord/routes.ts | GET /api/peers | readRegistry | unplaced',
```
with these six:
```ts
  'fleet.ts | assembleFleet | readRegistryMeasured | tests-only',
  'lifecycle.ts | listProjects | readRegistryMeasured | reports',
  'coord/routes.ts | GET /api/peers | readRegistryMeasured | reports',
  'coord/routes.ts | POST /api/claims | readRegistryMeasured | reports',
  'server.ts | GET /api/fleet | readRegistryMeasured | stale',
  'server.ts | GET /ws/fleet | readRegistryMeasured | stale',
```
The ws route is registered as `app.get('/ws/fleet', { websocket: true }, …)`, so Task 5's `ROUTE` regex names it `GET /ws/fleet`.

(b) Add these four lines directly below the file's last `import` line. The aliases cannot collide with any name Task 5 declared, and a module may import the same binding twice under two names:
```ts
import { readFileSync as t7ReadFileSync, readdirSync as t7ReaddirSync } from 'node:fs';
import t7path from 'node:path';
import { fileURLToPath as t7FileURLToPath } from 'node:url';
import { codeOnly as t7CodeOnly } from './sourceScan.js';
```

(c) Append at the file's foot, below its last `});`:
```ts
// PATH IDENTITY W1a, TASK 7 (spec §2.3). The three migrated readers and the three new reads carry their placed words,
// and every production `assembleFleet(` call passes the rows it read, so `assembleFleet`'s own fallback read, tagged
// `tests-only`, is reached by tests alone. A production call left at `undefined` would quietly bring back the fallback's
// `[]` for an unlistable registry, the empty fleet without a stale mark that this wave removes. Self-contained: its
// own aliased imports and scan helpers (slug `task7-census-pins-carry-their-own-scan`).
const T7_SRC = t7path.resolve(t7path.dirname(t7FileURLToPath(import.meta.url)), '..', 'src');

/** Every `.ts` under server/src, recursively, relative to it with `/` separators. */
const t7Sources = (dir = T7_SRC): string[] =>
  t7ReaddirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const full = t7path.join(dir, e.name);
    if (e.isDirectory()) return t7Sources(full);
    return /\.ts$/.test(e.name) ? [t7path.relative(T7_SRC, full).split(t7path.sep).join('/')] : [];
  });

/** One source, comments blanked, line numbers kept (`codeOnly`). */
const t7Code = (rel: string): string => t7CodeOnly(t7ReadFileSync(t7path.join(T7_SRC, rel), 'utf8'));

/** A `function name(` declaration, not a call. */
const t7IsDefinition = (text: string, at: number): boolean =>
  /\bfunction\s+$/.test(text.slice(text.lastIndexOf('\n', at) + 1, at));

/** The top-level arguments of the call whose `(` sits at `open`, whitespace-normalised. String literals survive
 *  `codeOnly`, so quotes are tracked and a comma inside one never splits. */
function t7Args(text: string, open: number): string[] {
  const args: string[] = [];
  let depth = 0;
  let quote: string | null = null;
  let start = open + 1;
  for (let i = open; i < text.length; i += 1) {
    const c = text[i]!;
    if (quote !== null) {
      if (c === '\\') { i += 1; continue; }
      if (c === quote) quote = null;
      continue;
    }
    if (c === '\'' || c === '"' || c === '`') { quote = c; continue; }
    if (c === '(' || c === '[' || c === '{') { depth += 1; continue; }
    if (c === ')' || c === ']' || c === '}') {
      depth -= 1;
      if (depth === 0) {
        args.push(text.slice(start, i));
        return args.map((a) => a.replace(/\s+/g, ' ').trim());
      }
      continue;
    }
    if (c === ',' && depth === 1) { args.push(text.slice(start, i)); start = i + 1; }
  }
  throw new Error(`no closing parenthesis for the call at offset ${open}`);
}

/** The 1-based line of each code-only CALL of `name(` in `rel` (definitions excluded). */
const t7CallLines = (rel: string, name: 'readRegistry' | 'readRegistryMeasured'): number[] => {
  const text = t7Code(rel);
  return [...text.matchAll(new RegExp(`\\b${name}\\s*\\(`, 'g'))]
    .filter((m) => !t7IsDefinition(text, m.index ?? 0))
    .map((m) => text.slice(0, m.index ?? 0).split('\n').length);
};

/** The `[registry-refused:<word>]` tag within the three raw lines above `line`, nearest first; null when none. */
const t7TagAbove = (rel: string, line: number): string | null => {
  const raw = t7ReadFileSync(t7path.join(T7_SRC, rel), 'utf8').split('\n');
  for (let k = line - 1; k >= Math.max(1, line - 3); k -= 1) {
    const m = /\[registry-refused:([a-z-]+)\]/.exec(raw[k - 1] ?? '');
    if (m) return m[1]!;
  }
  return null;
};

describe('Task 7: the migrated readers and the six production assembleFleet calls (spec §2.3)', () => {
  it('CONTROL: the argument splitter sees nesting, strings and a commented call', () => {
    const sample = t7CodeOnly([
      '// assembleFleet(a, b, c, d, e, f, g, h, i, NOT_THIS, k)',
      "const s = assembleFleet(io, cfg, f(x, y), [1, 2], 'a,b', { k: 1, j: 2 }, u, u, u, reg.listed ? reg.records : [], coord);",
    ].join('\n'));
    const hits = [...sample.matchAll(/\bassembleFleet\s*\(/g)];
    expect(hits, 'the commented call is not code').toHaveLength(1);
    const args = t7Args(sample, (hits[0]!.index ?? 0) + hits[0]![0].length - 1);
    expect(args).toHaveLength(11);
    expect(args[9]).toBe('reg.listed ? reg.records : []');
    expect(t7IsDefinition('export async function assembleFleet(', 'export async function '.length)).toBe(true);
    expect(t7IsDefinition('  const x = assembleFleet(', '  const x = '.length)).toBe(false);
  });

  it('the six production assembleFleet calls each pass the rows they read, never undefined', () => {
    const calls = t7Sources().flatMap((rel) => {
      const text = t7Code(rel);
      return [...text.matchAll(/\bassembleFleet\s*\(/g)]
        .filter((m) => !t7IsDefinition(text, m.index ?? 0))
        .map((m) => ({ file: rel, records: t7Args(text, (m.index ?? 0) + m[0].length - 1)[9] ?? '<absent>' }));
    });
    expect(calls.map((c) => `${c.file} ${c.records}`).sort()).toEqual([
      'coord/routes.ts reg.listed ? reg.records : []',   // the claims conflict
      'coord/routes.ts reg.records',                     // GET /api/peers
      'server.ts [rec]',                                 // liveRowFor, the archive door's busy read
      'server.ts reg.records',                           // GET /api/fleet
      'server.ts reg.records',                           // the ws cold start
      'watch.ts records',                                // tick
    ]);
    expect(calls.filter((c) => c.records === 'undefined' || c.records === '<absent>'),
      'a production call leaves its rows to the tests-only fallback').toEqual([]);
  });

  it('the migrated readers carry their placed words, and readRegistry keeps 8 sites', () => {
    const words = (rel: string): (string | null)[] =>
      t7CallLines(rel, 'readRegistryMeasured').map((line) => t7TagAbove(rel, line));
    expect(words('fleet.ts'), 'assembleFleet’s fallback is reached by tests alone').toEqual(['tests-only']);
    expect(words('lifecycle.ts'), 'listProjects reports registry').toEqual(['reports']);
    expect(words('server.ts'), 'GET /api/fleet, then the ws cold start').toEqual(['stale', 'stale']);
    expect(words('coord/routes.ts'), 'GET /api/peers, then the claims conflict').toEqual(['reports', 'reports']);
    expect(t7CallLines('fleet.ts', 'readRegistry')).toEqual([]);
    expect(t7CallLines('lifecycle.ts', 'readRegistry')).toEqual([]);
    expect(t7CallLines('server.ts', 'readRegistry'), 'prTasks alone (Task 8 places it)').toHaveLength(1);
    expect(t7CallLines('coord/routes.ts', 'readRegistry'), 'attribution, mail and ack (Task 8 places them)').toHaveLength(3);
    const count = (name: 'readRegistry' | 'readRegistryMeasured'): number =>
      t7Sources().reduce((n, rel) => n + t7CallLines(rel, name).length, 0);
    expect(count('readRegistry'), 'readRegistry( call sites in server/src').toBe(8);
    expect(count('readRegistryMeasured'), 'readRegistryMeasured( call sites in server/src, the wrapper included').toBe(15);
  });
});
```

- [ ] **Step 4: Run them and see them fail**

```bash
cd server
./node_modules/.bin/vitest run test/registry-migrated-callers.test.ts test/registry-refused-census.test.ts
```

Expected: FAIL. These red texts are drafted, not measured; record the measured ones in the SDD ledger.
- `GET /api/fleet on an unlistable registry answers stale:true`: `expected { sessions: [], pools: { listed: false, … } } to deeply equal { sessions: [], stale: true }`.
- `… sends hello, then runs, and no fleet frame`: `expected [ 'hello', 'fleet', 'runs' ] to deeply equal [ 'hello', 'runs' ]`.
- `the ws cold start with a watcher broadcast reads no registry`: PASSES already. It is a guard pin; its mutation (T7.8) is the proof.
- Both projects cases: `expected undefined to be 'unlistable'` and `expected undefined to be 'listed'`.
- `… refusedRows:1`: `expected undefined to be 1`. `… has no refusedRows key`: PASSES (absence).
- `?of=--actor`: `expected 502 to be 400` (Task 5 omits the planted row and the raw-name ladder answers 502). Each `REFUSED_IDS` row: `expected 404 to be 400`.
- `… answers the existing 502`: PASSES (the old route also made one listing before its 502).
- The claims case: `the conflict arm reads the registry ONCE: expected 4 to be 3` (with an attribution of 2).
- The census:
  - the retitled multiset case is red on the six changed or added rows;
  - `the six production assembleFleet calls …` gives `expected [ …, 'server.ts undefined', 'server.ts undefined', …, 'coord/routes.ts undefined' ] to deeply equal [ … ]`;
  - `the migrated readers carry their placed words …` gives `fleet.ts: expected [] to deeply equal [ 'tests-only' ]`.

If `vi.waitFor` in the cold-start case times out instead (no `runs` frame at all), the coord store did not reach the handler: read the case's `buildServer` deps before going on.

- [ ] **Step 5: Implement**

**5a. `server/src/fleet.ts`.** Change the import.

Before:
```ts
import { readRegistry, readSessionRecord } from './registry.js';
```
After:
```ts
import { readRegistryMeasured, readSessionRecord } from './registry.js';
```

At the fallback, delete the `[registry-refused:unplaced]` comment line that Task 5 placed directly above it, and replace the line itself.

Before:
```ts
  const [recs, limits] = await Promise.all([records ?? readRegistry(io, cfg), readLimits(io, cfg, now)]);
```
After:
```ts
  // Reached by TESTS alone (spec §2.3): every production caller passes the rows it read itself, and
  // registry-refused-census.test.ts pins all six `assembleFleet(` calls, so this fallback decides nothing a user
  // sees. An unlistable registry reads as no rows here, the old fallback's answer; refused rows were never rows.
  // [registry-refused:tests-only]
  const [recs, limits] = await Promise.all([records ?? readRegistryMeasured(io, cfg).then((r) => (r.listed ? r.records : [])), readLimits(io, cfg, now)]);
```

`records ?? <promise>` is `SessionRecord[] | Promise<SessionRecord[]>`, exactly the shape the old `records ?? readRegistry(io, cfg)` gave `Promise.all`.

**5b. `server/src/server.ts`.** Change the import.

Before:
```ts
import { freshAskAt, measuredIdentity, readRegistry, readSessionRecord } from './registry.js';
```
After:
```ts
import { freshAskAt, measuredIdentity, readRegistry, readRegistryMeasured, readSessionRecord } from './registry.js';
```

In `GET /api/fleet`, after the disconnected arm:

Before:
```ts
      if (snap) return { sessions: snap.sessions, stale: true, downSince: deps.fleetState.downSince };
    }
    // FIRST PAINT (spec §5.4.4). The `pools` frame is emitted ON CHANGE from
```
After:
```ts
      if (snap) return { sessions: snap.sessions, stale: true, downSince: deps.fleetState.downSince };
    }
    // ONE registry read for this request (spec §2.3), handed to `assembleFleet` as its `records`; that function's own
    // fallback read is reached by tests alone. An UNLISTABLE registry is not an empty fleet: `{sessions: []}` would
    // tell the phone every session had gone. So this serves what the process last knew (the watcher's last
    // broadcast, else the last-known-good snapshot, else nothing), marked `stale: true`, the disconnected arm's word.
    // No `pools` key, for that arm's reason (nothing measured to serve), and no `downSince`: the link may be up; it
    // is the listing that failed.
    // [registry-refused:stale]
    const reg = await readRegistryMeasured(deps.io, deps.cfg);
    if (!reg.listed) {
      return { sessions: watcher?.currentFleet() ?? (await loadSnapshot(stateCachePath))?.sessions ?? [], stale: true };
    }
    // FIRST PAINT (spec §5.4.4). The `pools` frame is emitted ON CHANGE from
```

Then in the same route's assemble call:

Before:
```ts
      sessions: await assembleFleet(deps.io, deps.cfg, deps.tmux, undefined, watcher?.currentPending(), watcher?.currentStatuslines(), watcher?.currentTaskProgress(), watcher?.currentPrStates(), watcher?.currentHookStates(), undefined, deps.coord, watcher?.currentUsage(), watcher?.currentHeadBranches()),
```
After:
```ts
      sessions: await assembleFleet(deps.io, deps.cfg, deps.tmux, undefined, watcher?.currentPending(), watcher?.currentStatuslines(), watcher?.currentTaskProgress(), watcher?.currentPrStates(), watcher?.currentHookStates(), reg.records, deps.coord, watcher?.currentUsage(), watcher?.currentHeadBranches()),
```

In `/ws/fleet`, edit the order comment.

Before:
```ts
    // `fleet` ever resolves. Chaining pins the wire order every client (and
    // `fleetws.test.ts`) can rely on: hello, fleet, runs.
```
After:
```ts
    // `fleet` ever resolves. Chaining pins the wire order every client (and
    // `fleetws.test.ts`) can rely on: hello, fleet, runs — or hello, runs when
    // the cold read could not list the registry, which sends no `fleet` frame.
```

Then the cold read itself.

Before:
```ts
    const broadcast = watcher?.currentFleet() ?? null;
    const cold = broadcast !== null
      ? Promise.resolve(broadcast)
      : assembleFleet(deps.io, deps.cfg, deps.tmux, undefined, watcher?.currentPending(), watcher?.currentStatuslines(), watcher?.currentTaskProgress(), watcher?.currentPrStates(), watcher?.currentHookStates(), undefined, deps.coord, watcher?.currentUsage(), watcher?.currentHeadBranches());
    void cold.then((sessions) => {
      if (!broadcastSeen) sendFleet(sessions);
```
After:
```ts
    const broadcast = watcher?.currentFleet() ?? null;
    // `null` means the registry could not be listed (spec §2.3). This socket then gets NO cold `fleet` frame: an
    // assembled `[]` would tell it every session had gone, and the `fleet` frame has no stale marker to say
    // otherwise (this wave adds no wire field). The next broadcast reaches it as it reaches any connected client,
    // and the `runs` frame below is still sent.
    let cold: Promise<FleetSession[] | null>;
    if (broadcast !== null) {
      cold = Promise.resolve(broadcast);
    } else {
      // [registry-refused:stale]
      cold = readRegistryMeasured(deps.io, deps.cfg).then((reg) => (reg.listed
        ? assembleFleet(deps.io, deps.cfg, deps.tmux, undefined, watcher?.currentPending(), watcher?.currentStatuslines(), watcher?.currentTaskProgress(), watcher?.currentPrStates(), watcher?.currentHookStates(), reg.records, deps.coord, watcher?.currentUsage(), watcher?.currentHeadBranches())
        : null));
    }
    void cold.then((sessions) => {
      if (sessions !== null && !broadcastSeen) sendFleet(sessions);
```

The rest of the `.then` (the `runs`, `coord` and `pools` blocks) is unchanged, so `runs` is still sent on the `null` arm.

**5c. `server/src/lifecycle.ts`.** Change the import.

Before:
```ts
import { readRegistry } from './registry.js';
```
After:
```ts
import { readRegistryMeasured } from './registry.js';
```

Then the docstring tail and the signature.

Before:
```ts
 * project through either door: `isLinkedWorktree` skips it whether it turned
 * up under the projects root or only in the registry.
 */
export async function listProjects(
  io: FleetIO,
  cfg: CcrcConfig,
): Promise<{ roots: string[]; projects: ProjectRow[] }> {
```
After:
```ts
 * project through either door: `isLinkedWorktree` skips it whether it turned
 * up under the projects root or only in the registry.
 *
 * `registry` (spec §2.3; additive on `GET /api/projects`, which spreads this
 * result) says whether the registry half of the union was MEASURED.
 * `'unlistable'` means the registry directory could not be listed, so
 * `projects` holds the root walk alone: a registry-only project is then
 * missing because nothing was read, not because it is gone. A refused row
 * (`RegistryRead.refused`) is never read, so its workdir never joins the union.
 */
export async function listProjects(
  io: FleetIO,
  cfg: CcrcConfig,
): Promise<{ roots: string[]; projects: ProjectRow[]; registry: 'listed' | 'unlistable' }> {
```

At the union loop, delete Task 5's `[registry-refused:unplaced]` line directly above it.

Before:
```ts
  for (const rec of await readRegistry(io, cfg)) {
```
After:
```ts
  // [registry-refused:reports] spec §2.3: one read; `registry` below reports whether it listed.
  const reg = await readRegistryMeasured(io, cfg);
  for (const rec of reg.listed ? reg.records : []) {
```

Then the return.

Before:
```ts
  return { roots: [cfg.projectsRoot], projects };
```
After:
```ts
  return { roots: [cfg.projectsRoot], projects, registry: reg.listed ? 'listed' : 'unlistable' };
```

`GET /api/projects` needs no edit: both of its returns start with `...listed` and override only `projects`, so `registry` rides through unchanged.

**5d. `server/src/coord/routes.ts`.** Change the L0 import (skip this if Step 1 (9) showed `isRegistryId` already imported here).

Before:
```ts
  FAILURE_KINDS, ROUTE_CONTROL_CHAR_RE, isSessionIdShape, parseRouteEventDetail, parseRouteFields, routeEventDetail, RUN_STATES, TERMINAL_RUN_STATES,
```
After:
```ts
  FAILURE_KINDS, ROUTE_CONTROL_CHAR_RE, isRegistryId, isSessionIdShape, parseRouteEventDetail, parseRouteFields, routeEventDetail, RUN_STATES, TERMINAL_RUN_STATES,
```

In `GET /api/peers`, delete Task 5's `[registry-refused:unplaced]` line above `const recs = await readRegistry(` and replace the read block.

Before:
```ts
    // ONE listing, reused below for the presence ladder — the same
    // fail-shut-on-unlistable idiom the mail ingress uses for this directory.
    const names = await deps.io.readdir(deps.cfg.registryDir);
    if (names === null) {
      return reply.code(502).send({ ok: false, error: 'registry-unmeasurable',
        detail: 'the registry directory could not be listed — transient, not a fact about any peer' });
    }
    // The records are read ONCE and handed to `assembleFleet` (its own
    // `records` parameter's contract: every lane of one pass describes one
    // observation) — this route needs them itself for `uuid`, which
    // `FleetSession` does not carry.
    const recs = await readRegistry(deps.io, deps.cfg);
    const recById = new Map(recs.map((r) => [r.id, r]));
    const sessions = await assembleFleet(deps.io, deps.cfg, deps.tmux,
      undefined, undefined, undefined, undefined, undefined, undefined, recs, deps.coord, undefined);
```
After:
```ts
    // A `?of=` that is not a registry id is refused BEFORE any read (spec §2.3): it can never name a row this server
    // reads, so the presence ladder below would answer 502 for it forever. Checked on the trimmed value `selfId`
    // takes below.
    if (hasOf && !isRegistryId((q.of as string).trim())) {
      return reply.code(400).send({ ok: false, error: 'bad-session' });
    }

    // ONE read (spec §2.3). Its listing is the presence ladder's. Its rows are `assembleFleet`'s (its own `records`
    // parameter's contract: every lane of one pass describes one observation) and this route's own for `uuid`,
    // which `FleetSession` does not carry. Its refused count rides the 200 as `refusedRows`. Unlistable keeps the
    // fail-shut 502 that the mail ingress uses for this directory.
    // [registry-refused:reports]
    const reg = await readRegistryMeasured(deps.io, deps.cfg);
    if (!reg.listed) {
      return reply.code(502).send({ ok: false, error: 'registry-unmeasurable',
        detail: 'the registry directory could not be listed — transient, not a fact about any peer' });
    }
    const names = reg.names;
    const recById = new Map(reg.records.map((r) => [r.id, r]));
    const sessions = await assembleFleet(deps.io, deps.cfg, deps.tmux,
      undefined, undefined, undefined, undefined, undefined, undefined, reg.records, deps.coord, undefined);
```

`names` is now `readonly string[]`. The `?of=` ladder's `names.includes(`${selfId}.uuid`)` is unchanged and still compiles.

Then the route's 200.

Before:
```ts
    const projects = [...new Set(sessions.map((s) => s.project))].sort();
    return reply.code(200).send({ ok: true, peers, projects, etiquette: PEER_ETIQUETTE });
```
After:
```ts
    const projects = [...new Set(sessions.map((s) => s.project))].sort();
    // `refusedRows` (spec §2.3): additive and absence-permitting, present only when a listed `.uuid` was refused, so a
    // peer list that is silently short of a row says that it is. One writer of the field: this line.
    return reply.code(200).send({ ok: true, peers, projects, etiquette: PEER_ETIQUETTE,
      ...(reg.refused.size > 0 ? { refusedRows: reg.refused.size } : {}) });
```

In `POST /api/claims`'s `case 'conflict':` arm:

Before:
```ts
        const names = await deps.io.readdir(deps.cfg.registryDir);
        const sessions = await assembleFleet(deps.io, deps.cfg, deps.tmux,
          undefined, undefined, undefined, undefined, undefined, undefined, undefined, deps.coord, undefined);
```
After:
```ts
        // ONE registry read (spec §2.3): its rows are `assembleFleet`'s and its listing is the presence ladder's, so
        // the two describe one observation. Unlistable gives no rows and a `null` listing: every holder reads
        // unmeasurable, never absent and never `yes` off a second read the ladder did not see.
        // [registry-refused:reports]
        const reg = await readRegistryMeasured(deps.io, deps.cfg);
        const names = reg.listed ? reg.names : null;
        const sessions = await assembleFleet(deps.io, deps.cfg, deps.tmux,
          undefined, undefined, undefined, undefined, undefined, undefined, reg.listed ? reg.records : [], deps.coord, undefined);
```

`deliverableOf` is unchanged. Its `names === null` arm now means "the conflict arm's one read could not list".

- [ ] **Step 6: The two existing pins this task's behaviour moves**

**6a. `server/test/fleetws.test.ts`.** This is the only cold-start pin that names a `fleet` frame on an unlistable registry (located by `connect({ io: unlistable }, { tick: false })`).

Before:
```ts
      const { ws, next, watcher } = await connect({ io: unlistable }, { tick: false });
      expect((await next()).type).toBe('hello');
      expect((await next()).type).toBe('fleet');
      await watcher.tick();
```
After:
```ts
      const { ws, next, watcher } = await connect({ io: unlistable }, { tick: false });
      expect((await next()).type).toBe('hello');
      // No cold `fleet` frame: on an unlistable registry the cold start sends none rather than an empty fleet
      // (spec §2.3, path identity W1a). The tick's `coord` frame is the next one.
      await watcher.tick();
```

**6b. `server/test/fleet-health.test.ts`** (slug `fleet-health-fixtures-list-their-registry`). In `falls back to a live assemble (no stale flag) when disconnected but no cache exists yet`:

Before:
```ts
    const deps = remoteDeps({}, { connected: false, downSince: Date.now(), ccdVerbs: null, rosterFp: null, build: null }, cachePath);
    const app = await buildServer(deps);
    const res = await app.inject({ method: 'GET', url: '/api/fleet' });
    // WIDENED, NOT LOOSENED (account pools, wave 3): the LIVE-assemble arm now
    // carries `pools` for first paint, and this stays an exact-shape assertion
    // so the DEGRADED arm's own case — which asserts the key is ABSENT — keeps
    // its meaning. `listed: false` is the truthful answer for a fixture whose
    // registry root does not list: nobody decides, and that is not `untagged`.
    // `observedEpoch: null` (item 1, wave-1 fix round A): no `$REG/pool-epoch`
    // was planted in this fixture's home, a real ENOENT `readObservedEpochFromRegistry`
    // measures and reports honestly, independent of the root listing above.
    expect(res.json()).toEqual({
      sessions: [], pools: { listed: false, enforcement: 'unknown', observedEpoch: null, accountPools: 'unknown' },
    });
```
After:
```ts
    const deps = remoteDeps({}, { connected: false, downSince: Date.now(), ccdVerbs: null, rosterFp: null, build: null }, cachePath);
    // The registry root must LIST for this case to reach the live arm: an unlistable registry now serves the stale
    // arm instead (spec §2.3, path identity W1a), which registry-migrated-callers.test.ts pins.
    mkdirSync(deps.cfg.registryDir, { recursive: true });
    const app = await buildServer(deps);
    const res = await app.inject({ method: 'GET', url: '/api/fleet' });
    // WIDENED, NOT LOOSENED (account pools, wave 3): the LIVE-assemble arm now
    // carries `pools` for first paint, and this stays an exact-shape assertion
    // so the DEGRADED arm's own case — which asserts the key is ABSENT — keeps
    // its meaning. `listed: true, byProject: {}`: the registry root lists (an
    // empty `.cc-sessions`, seeded above) and holds no `pools/`, so nothing is tagged.
    // `observedEpoch: null` (item 1, wave-1 fix round A): no `$REG/pool-epoch`
    // was planted in this fixture's home, a real ENOENT `readObservedEpochFromRegistry`
    // measures and reports honestly, independent of the root listing above.
    expect(res.json()).toEqual({
      sessions: [], pools: { listed: true, byProject: {}, enforcement: 'unknown', observedEpoch: null, accountPools: 'unknown' },
    });
```

In `ignores the cache and assembles live when connected`:

Before:
```ts
    await saveSnapshot([session('claude-Stale')], cachePath);

    const deps = remoteDeps({}, { connected: true, downSince: null, ccdVerbs: null, rosterFp: null, build: null }, cachePath);
    const app = await buildServer(deps);
    const res = await app.inject({ method: 'GET', url: '/api/fleet' });
    // WIDENED, NOT LOOSENED (account pools, wave 3): the LIVE-assemble arm now
    // carries `pools` for first paint, and this stays an exact-shape assertion
    // so the DEGRADED arm's own case — which asserts the key is ABSENT — keeps
    // its meaning. `listed: false` is the truthful answer for a fixture whose
    // registry root does not list: nobody decides, and that is not `untagged`.
    // `observedEpoch: null` (item 1, wave-1 fix round A) — see the sibling
    // case above.
    expect(res.json()).toEqual({
      sessions: [], pools: { listed: false, enforcement: 'unknown', observedEpoch: null, accountPools: 'unknown' },
    });
```
After:
```ts
    await saveSnapshot([session('claude-Stale')], cachePath);

    const deps = remoteDeps({}, { connected: true, downSince: null, ccdVerbs: null, rosterFp: null, build: null }, cachePath);
    // The registry root must LIST, or this case would meet the stale arm, which serves this very cache marked
    // `stale: true` (spec §2.3, path identity W1a). Listing, the cache is ignored, as the title says.
    mkdirSync(deps.cfg.registryDir, { recursive: true });
    const app = await buildServer(deps);
    const res = await app.inject({ method: 'GET', url: '/api/fleet' });
    // WIDENED, NOT LOOSENED (account pools, wave 3): the LIVE-assemble arm now
    // carries `pools` for first paint, and this stays an exact-shape assertion
    // so the DEGRADED arm's own case — which asserts the key is ABSENT — keeps
    // its meaning. `listed: true, byProject: {}`: the registry root lists (seeded
    // above) and holds no `pools/`, so nothing is tagged.
    // `observedEpoch: null` (item 1, wave-1 fix round A) — see the sibling
    // case above.
    expect(res.json()).toEqual({
      sessions: [], pools: { listed: true, byProject: {}, enforcement: 'unknown', observedEpoch: null, accountPools: 'unknown' },
    });
```

`mkdirSync` is already imported in that file (`import { mkdirSync, writeFileSync } from 'node:fs';`).

- [ ] **Step 7: Run green**

```bash
cd server
./node_modules/.bin/vitest run test/registry-migrated-callers.test.ts test/registry-refused-census.test.ts test/fleetws.test.ts test/fleet-health.test.ts
```

Expected: PASS. If a census case is red on a row's scope label or field name, that is Task 5's spelling: match it in Step 3 (a), and never loosen the scan.

- [ ] **Step 8: Mutation table.** Apply each mutation alone, run its command from `server/`, see the red, revert, and record the measured red text in the SDD ledger. Every red below is drafted, not measured.

| # | Mutation (exact edit) | Command | Expected red |
|---|---|---|---|
| T7.1 | `server.ts` `GET /api/fleet`: delete the `if (!reg.listed) { … }` block (at runtime `reg.records` is then `undefined` on an unlistable registry, so the fallback answers `[]`) | `./node_modules/.bin/vitest run test/registry-migrated-callers.test.ts -t "answers stale:true"` | `expected { sessions: [], pools: { listed: false, … } } to deeply equal { sessions: [], stale: true }` |
| T7.2 | `server.ts` `GET /api/fleet`: its `assembleFleet(` call's `reg.records` becomes `undefined` (the route's old records) | `./node_modules/.bin/vitest run test/registry-refused-census.test.ts -t "six production"` | `expected [ …, 'server.ts undefined', … ] to deeply equal [ …, 'server.ts reg.records', 'server.ts reg.records', … ]` |
| T7.3 | `lifecycle.ts`: `registry: reg.listed ? 'listed' : 'unlistable'` becomes `registry: 'listed' as const` | `./node_modules/.bin/vitest run test/registry-migrated-callers.test.ts -t "registry:'unlistable'"` | `expected 'listed' to be 'unlistable'` |
| T7.4 | `coord/routes.ts` `GET /api/peers`: delete the `...(reg.refused.size > 0 ? { refusedRows: reg.refused.size } : {})` spread | `./node_modules/.bin/vitest run test/registry-migrated-callers.test.ts -t "refusedRows:1"` | `expected undefined to be 1` |
| T7.5 | `coord/routes.ts` `GET /api/peers`: delete the `if (hasOf && !isRegistryId(…)) { … }` check, so a refused `?of=` falls to the 502 arm | `./node_modules/.bin/vitest run test/registry-migrated-callers.test.ts -t "bad-session"` | `?of=--actor` (row planted): `expected 502 to be 400`; each `REFUSED_IDS` row: `expected 404 to be 400`; and `refused before any read: a bad id never heals: expected 1 to be 0` |
| T7.6 | `server.ts` cold start: `if (sessions !== null && !broadcastSeen) sendFleet(sessions);` becomes `if (!broadcastSeen) sendFleet(sessions ?? []);` | `./node_modules/.bin/vitest run test/registry-migrated-callers.test.ts -t "no fleet frame"` | `expected [ 'hello', 'fleet', 'runs' ] to deeply equal [ 'hello', 'runs' ]` |
| T7.7 | `server.ts` cold start: add `if (sessions === null) return;` as the `.then` callback's first statement (so the `runs` frame is skipped along with the fleet frame) | same | `vi.waitFor` times out: `expected [ 'hello' ] to include 'runs'` |
| T7.8 | `server.ts` cold start: in the `broadcast !== null` arm, `cold = Promise.resolve(broadcast);` becomes `cold = readRegistryMeasured(deps.io, deps.cfg).then(() => broadcast);` | `./node_modules/.bin/vitest run test/registry-migrated-callers.test.ts -t "reads no registry"` | `the cold frame is the broadcast: no registry read: expected 1 to be 0` |
| T7.9 | `coord/routes.ts` claims conflict: restore the pre-task pair, `const names = await deps.io.readdir(deps.cfg.registryDir);` and the `assembleFleet(` call with `undefined` records (delete the `reg` line) | `./node_modules/.bin/vitest run test/registry-migrated-callers.test.ts -t "claims-conflict"` and `./node_modules/.bin/vitest run test/registry-refused-census.test.ts` | `the conflict arm reads the registry ONCE: expected 4 to be 3`; census: `'coord/routes.ts undefined'` in the six-call list, and `coord/routes.ts: expected [ 'reports' ] to deeply equal [ 'reports', 'reports' ]` |
| T7.10 | `fleet.ts`: the tag `[registry-refused:tests-only]` becomes `[registry-refused:stale]` | `./node_modules/.bin/vitest run test/registry-refused-census.test.ts` | `assembleFleet’s fallback is reached by tests alone: expected [ 'stale' ] to deeply equal [ 'tests-only' ]`, and Task 5's multiset case on the `fleet.ts` row |
| T7.11 | `fleet.ts`: restore the fallback to `records ?? readRegistry(io, cfg)` (with `readRegistry` back in the import) | same | `fleet.ts: expected [] to deeply equal [ 'tests-only' ]`; `readRegistry( call sites in server/src: expected 9 to be 8`; `… readRegistryMeasured( …: expected 14 to be 15` |

Revert each mutation, then re-run Step 7's command: green. Confirm with `git diff --stat` that the tree holds only this task's edits.

- [ ] **Step 9: The task's other suites, the guards and the type-check**

```bash
cd server
./node_modules/.bin/vitest run test/fleet.test.ts test/fleet-wire-route.test.ts test/peers-route.test.ts \
  test/projects-route-placement.test.ts test/projects-route-class.test.ts test/lifecycle.test.ts \
  test/claim-sweep.test.ts test/claims-routes.test.ts test/divergence-sweep.test.ts test/pr-sweep.test.ts \
  test/auth-gate.test.ts test/auth-passkey.test.ts
./node_modules/.bin/vitest run test/registry.test.ts test/mail-routes.test.ts test/unattended-actor.test.ts test/verb-gate.test.ts test/typecheck-tests.test.ts
./node_modules/.bin/tsc --noEmit -p .
```

Run each command in the foreground, with a timeout of at least 600000 ms.

Expected: PASS, and tsc prints nothing.
- `registry`: the `[registry-read-census:*]` sentences are untouched. The `31 [registry-read-census:fields]` sentence in `assembleFleet`'s docstring sits above the parameter list and is not edited.
- `mail-routes`: its kebab scan meets only `'bad-session'` and `'registry-unmeasurable'`, both existing codes.
- `unattended-actor` and `verb-gate`: this task composes no ccd argv.

`pr-sweep` is a CLAUDE.md load flake: re-run a red in isolation before calling it a break. A red in a file outside these lists is read for the fixture shape Step 1 (10) names. Record each such red, and fix it the Step 6b way only if it is that shape. Any other red is a STOP, reported by slug.

- [ ] **Step 10: Commit**

```bash
git add server/src/fleet.ts server/src/server.ts server/src/lifecycle.ts server/src/coord/routes.ts \
  server/test/registry-migrated-callers.test.ts server/test/registry-refused-census.test.ts \
  server/test/fleetws.test.ts server/test/fleet-health.test.ts
git commit -F - <<'EOF'
fix(server): fleet, projects and peers report an unlistable registry and refused rows

Spec 2.3: a reader that cannot measure the registry says so, and never
answers with an empty or silently short list.

- GET /api/fleet reads the registry once and hands the rows to
  assembleFleet. When the registry cannot be listed it serves the
  watcher's last fleet, else the last-known-good snapshot, else nothing,
  marked stale: true, with no pools key. It no longer serves an empty
  fleet as if it were fresh.
- The /ws/fleet cold start reads the registry only when the watcher has
  not broadcast. On an unlistable registry it sends no fleet frame, since
  the frame has no stale marker, and still sends its runs frame.
- assembleFleet's own fallback read is now reached by tests alone, and is
  tagged so. A census pins the six production calls' records argument.
- listProjects reads the registry once and reports registry: listed or
  unlistable, which GET /api/projects carries additively.
- GET /api/peers refuses a ?of= that is not a registry id with 400
  bad-session before any read, rather than 502 forever. It reads the
  registry once, and adds refusedRows when a listed row was refused.
- The claims-conflict path reads the registry once, so its rows and its
  presence ladder describe one observation.

The reader census places the three migrated sites and the three new
reads. readRegistry now has 8 call sites.

Two fleet-health cases now seed an empty registry directory so that they
still measure the live arm, and one fleetws cold-start case no longer
expects a fleet frame on an unlistable registry.
EOF
```

---

### Task 8: The eight retained `readRegistry` callers, pinned

**Model routing:** `sonnet`, effort `high`.

**Why:** Spec §2.3 lets eight callers keep the `readRegistry` wrapper. Each one keeps it for a stated reason, and the spec asks for "a mutation pin for its terminal behavior" for each:
- `sessionCommands` (`commands.ts`) and `prTasks` (`server.ts`) sit behind `knownId`. Task 2 made `knownId` refuse a non-registry id before it lists anything.
- `sweepNames` and `sweepPr` (`watch.ts`) act only on `records`. Task 5 left refused rows out of `records`, so a refused row is never renamed and never swept.
- `detectDialogs`' own read is a fallback that only tests reach, because `tick` passes its `records`.
- `requireAttribution`, `POST /api/mail` and `POST /api/mail/:id/ack` (`coord/routes.ts`) each keep a raw listing (`names`). A listed row that `records` omits therefore reads as `registry-unmeasurable`, never as `unknown-sender` or `unknown-recipient`.

Tasks 2 and 5 built all of this behaviour. Task 8 changes eight tag words, adds the behaviour pins, and brings the census to its final 23-site table with no `unplaced` tag. The behaviour cases go green at once, and the mutation table below is their proof. The census goes red until the tags are placed.

**Files:**
- Modify `server/src/commands.ts`: the one tag line within the three lines above `const rec = (await readRegistry(deps.io, deps.cfg)).find((r) => r.id === id);`, inside `export async function sessionCommands(`.
- Modify `server/src/server.ts`: the one tag line within the three lines above `const rec = (await readRegistry(deps.io, deps.cfg)).find((r) => r.id === id);`, inside `const prTasks = async (id: string): Promise<TaskItem[] | null> => {`.
- Modify `server/src/watch.ts`, one tag line above each of three calls:
  - `const records = await readRegistry(this.deps.io, this.deps.cfg);` inside `async sweepNames(): Promise<void> {` (indent 4);
  - `const records = await readRegistry(this.deps.io, this.deps.cfg);` inside `private async sweepPr(): Promise<void> {` (indent 6, inside its `try {`);
  - `const recs = records ?? await readRegistry(this.deps.io, this.deps.cfg);` inside `private async detectDialogs(`.
- Modify `server/src/coord/routes.ts`, one tag line above `const registry = await readRegistry(deps.io, deps.cfg);` in each of three places:
  - inside `const requireAttribution = async (`;
  - inside `app.post('/api/mail', …)`;
  - inside `app.post('/api/mail/:id/ack', …)`.
- Modify `server/test/registry-refused-census.test.ts` in place (Step 2); never replace it. Three edits: eight `EXPECTED_SITES` word changes, a `no site is unplaced` case in Task 5's first describe, and a `tick() passes its records to detectDialogs(` case in Task 6's `tick` describe. Every earlier case, helper and import stays byte for byte.
- Create `server/test/registry-retained-callers.test.ts`.
- Not edited: `shared/api.ts`, `server/src/registry.ts`, `server/test/idGateFixture.ts`, and every file outside this list.

**Interfaces:**
- Consumes:
  - `seedRow(home: string, id: string, fields?: Record<string, string>): void`, `recorder(cfg?: { fail?: ReadonlySet<string> }): { run: Runner; calls: string[][] }` and `appFor(home: string, run: Runner, over?: Partial<Omit<Deps, 'cfg'>>): Promise<{ app: FastifyInstance; coord: CoordStore; cfg: CcrcConfig }>`, from `server/test/idGateFixture.ts` (Task 2).
  - `codeOnly(s: string): string` (`server/test/sourceScan.ts`).
  - `tmuxTarget(id: string): string` (`shared/tmux-target.ts`).
  - `FleetWatcher`'s `sweepNames(): Promise<void>`, `tick(): Promise<void>`, `currentPrStates(): Map<string, PrState>` and `stop()`, with its constructor `(deps: Deps, bus: Bus, intervalMs?: number, cachePath?: string)`.
  - `testDeps(home, run)` (`server/test/helpers.ts`).
  - The census vocabulary: `[registry-refused:<word>]`, where `<word>` is one of `holds`, `refuses`, `gated`, `omits`, `stale`, `reports`, `tests-only`, `knownId`, `raw-name`, `wrapper` and `unplaced`.
- Produces (test-local, never exported):
  ```ts
  // registry-refused-census.test.ts: no new helper. Step 2 reuses Task 5's `allSites` and `key`,
  // and Task 6's `TICK_WATCH_TS`, `TICK_HEAD`, `tickCode` and `tickBodyOf`.
  // registry-retained-callers.test.ts
  const plantRow: (home: string, id: string, fields: Record<string, string>) => void;
  const expectPlanted: (home: string, id: string) => void;
  const uuidOf: (home: string, id: string) => string;
  const cachePathIn: (home: string) => string;
  ```

- [ ] **Step 0: Entry conditions (Tasks 0 to 7 are committed; measure, never assume)**

Run from the workspace root:

```bash
grep -rn '\[registry-refused:unplaced\]' server/src                     # (a) the eight tag lines of Step 4's table, and no others
grep -rn '\[registry-refused:' server/src | grep -vc unplaced             # (b) 15: the placed sites of Tasks 5 to 7
grep -c 'if (!isRegistryId(id)) return false;' server/src/server.ts       # (c) 1: Task 2's knownId gate
grep -n 'refused' server/src/registry.ts | head -20                       # (d) Task 5's RegistryRead.refused, refusedLogged and noteRefused
grep -n '^export function seedRow\|^export function recorder\|^export function appFor\|^export async function appFor' server/test/idGateFixture.ts   # (e) three lines
(cd server && ./node_modules/.bin/vitest run test/registry-refused-census.test.ts)   # (f) GREEN at Task 7's tip
grep -nE "^\s*(describe|it)(\.each\([^)]*\))?\(" server/test/registry-refused-census.test.ts   # (g) record every describe and it title in the SDD ledger
gh pr view 351 --json state -q .state                                      # (h) record; MERGED means watch.ts may have moved (R16)
```

- **(a)** lists exactly the eight lines in Step 4: one each in `commands.ts` and `server.ts`, and three each in `watch.ts` and `coord/routes.ts`. If a docstring also names the word, that line is not a tag and stays. If any tag line is missing, or sits more than three lines above its call, **STOP** with `retained-tag-missing` and report the measured lines.
- **(c)** prints 0: Task 2's gate is gone, and this task's `knownId` pin would pin nothing. **STOP** with `gate-site-moved`.
- **(f)** red: Task 7 did not leave the census green. **STOP** and report.
- **(h)** MERGED: re-point Step 4's `watch.ts` anchors by content. A moved line is not a departure.

- [ ] **Step 1: Write the behaviour pins, `server/test/registry-retained-callers.test.ts`**

```ts
// Path identity W1a, Task 8 (spec §2.3): the eight callers that keep the
// `readRegistry` wrapper, each pinned on a PLANTED refused row. A refused row is
// a `.uuid` whose basename is not a registry id. `readRegistryMeasured` names it
// in `refused` and never builds it, so `readRegistry` never returns it. Each
// caller keeps the wrapper for its own reason, and each reason is pinned here:
//   - knownId: `/commands` and `/pr` sit behind `knownId`, which refuses a
//     non-registry id before its listing;
//   - omits: `sweepNames`, `sweepPr` and the dialog detector act only on
//     `records`, so a refused row is never renamed, swept or captured;
//   - raw-name: attribution, mail creation and mail acknowledgement keep a raw
//     listing, so a listed-but-omitted row reads as registry-unmeasurable,
//     never as an unknown sender or recipient.
// These cases are green at once, because Tasks 2 and 5 built the behaviour.
// Their proof is the plan's mutation table, each row measured red against this file.
import { describe, it, expect, afterEach, vi } from 'vitest';
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { FastifyInstance } from 'fastify';
import { Bus } from '../src/bus.js';
import type { Runner } from '../src/exec.js';
import { FleetWatcher } from '../src/watch.js';
import { tmuxTarget } from '../../shared/tmux-target.js';
import { testDeps } from './helpers.js';
import { mkTmp } from './tmpHelpers.js';
import { appFor, recorder, seedRow } from './idGateFixture.js';

const TOKEN = 'f'.repeat(64);
const BAD = '--actor';
const VALID = 'demo-quiet-basin';

/** Every field written exactly as given, under the fixture HOME's registry. A
 *  dash-led name is a plain file there (`path.join(reg, '--actor.uuid')`). */
const plantRow = (home: string, id: string, fields: Record<string, string>): void => {
  const reg = path.join(home, '.cc-sessions');
  mkdirSync(reg, { recursive: true });
  for (const [k, v] of Object.entries(fields)) writeFileSync(path.join(reg, `${id}.${k}`), v);
};

/** The row the case is about IS listed, so the refusal under test is the
 *  reader's, never a missing file's. */
const expectPlanted = (home: string, id: string): void => {
  expect(readdirSync(path.join(home, '.cc-sessions'))).toContain(`${id}.uuid`);
};

/** The planted row's own uuid, read back rather than assumed from the fixture. */
const uuidOf = (home: string, id: string): string =>
  readFileSync(path.join(home, '.cc-sessions', `${id}.uuid`), 'utf8').trim();

/** A snapshot path inside the fixture HOME, so no watcher here can name a real one. */
const cachePathIn = (home: string): string => path.join(home, '.ccrc', 'state-cache.json');

/** A workspace row in `pr-sweep.test.ts`'s shape, in a project of the case's choosing. */
const workspaceRow = (id: string, project: string, workspace: string): Record<string, string> => ({
  uuid: `u-${id}`, wrapper: 'claude', workdir: `/w/${id}`, project, workspace,
  branch: `ws/${id}`, base: 'origin/main', started: '1',
});

/** `pr-sweep.test.ts`'s merged line, for the valid row in project demo. */
const mergedLine = (id: string, number = 42): string => JSON.stringify({
  id, project: 'demo', repo: 'o/r', branch: 'ws/' + id, base: 'origin/main', baseShort: 'main',
  tip: 'f'.repeat(40), ahead: 3, dirty: 0, commits: [], template: null,
  rows: [{ number, state: 'MERGED', headRefName: 'ws/' + id, headRefOid: 'deadbee',
    baseRefName: 'main', isCrossRepository: false, mergedAt: '2026-07-20T10:00:00Z',
    mergeCommit: { oid: '7a68ca0' }, url: 'u', title: 't', isDraft: false,
    statusCheckRollup: null, ours: true }],
  phase: 'merged', number, checkedAt: 1785300000000, reason: null,
});

/** `pr-sweep.test.ts`'s idle live-state file, so a tick reads the pane as idle. */
const liveIdle = (home: string, pid = '4242'): void => {
  const dir = path.join(home, '.claude', 'sessions');
  mkdirSync(dir, { recursive: true });
  writeFileSync(path.join(dir, `${pid}.json`),
    JSON.stringify({ pid: Number(pid), sessionId: '1'.repeat(36), cwd: '/d', status: 'idle', statusUpdatedAt: 1 }));
};

const post = (a: FastifyInstance, url: string, payload: Record<string, unknown>) =>
  a.inject({ method: 'POST', url, headers: { 'x-ccrc-mail-token': TOKEN }, payload });

let app: FastifyInstance | undefined;
afterEach(async () => {
  if (app) await app.close();
  app = undefined;
  vi.restoreAllMocks();
});

describe('the knownId callers never read a refused id (spec §2.3)', () => {
  it('GET /api/sessions/--actor/commands and GET /pr answer 404 unknown-session', async () => {
    const home = mkTmp('ccrc-retained-');
    seedRow(home, BAD);
    seedRow(home, VALID);
    expectPlanted(home, BAD);
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const rec = recorder();
    const w = await appFor(home, rec.run);
    app = w.app;

    const commands = await app.inject({ method: 'GET', url: `/api/sessions/${BAD}/commands` });
    expect(commands.statusCode).toBe(404);
    expect(commands.json()).toEqual({ ok: false, error: 'unknown-session' });
    const pr = await app.inject({ method: 'GET', url: `/api/sessions/${BAD}/pr` });
    expect(pr.statusCode).toBe(404);
    expect(pr.json()).toEqual({ ok: false, error: 'unknown-session' });
    expect(rec.calls.filter((a) => a.includes(BAD))).toEqual([]);

    // Control: the same route answers a valid planted row, so the 404 above is the id gate's.
    const ok = await app.inject({ method: 'GET', url: `/api/sessions/${VALID}/commands` });
    expect(ok.statusCode).toBe(200);
  });
});

describe('the watch sweeps omit a refused row (spec §2.3)', () => {
  // `name-sweep.test.ts`'s fixture: a workspace still on its born branch, and the
  // transcript whose ai-title names it. The refused row carries the SAME fields,
  // so a build that let it into `records` would find the same title and rename it too.
  const NAME_ID = 'demo-quiet-mesa';
  const NAME_UUID = 'a'.repeat(36);
  const NAME_WORKDIR = '/w/demo/quiet-mesa';
  const NAME_MUNGED = '-w-demo-quiet-mesa';   // mungePath turns / . _ into -, as name-sweep.test.ts states

  it('sweepNames composes no ws-rename naming --actor', async () => {
    const home = mkTmp('ccrc-retained-');
    const fields = {
      wrapper: 'claude', project: 'demo', workdir: NAME_WORKDIR, uuid: NAME_UUID,
      started: '1', workspace: 'quiet-mesa', branch: 'ws/quiet-mesa',
    };
    plantRow(home, NAME_ID, fields);
    plantRow(home, BAD, fields);
    expectPlanted(home, BAD);
    const dir = path.join(home, '.claude', 'projects', NAME_MUNGED);
    mkdirSync(dir, { recursive: true });
    writeFileSync(path.join(dir, `${NAME_UUID}.jsonl`),
      JSON.stringify({ type: 'ai-title', aiTitle: 'Brainstorm Helix and slide notes integration' }) + '\n');
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(console, 'log').mockImplementation(() => {});
    const renames: string[][] = [];
    const run: Runner = async (_cmd, args) => {
      if (args[0] === 'ws-rename') {
        renames.push([...args]);
        return { code: 0, stdout: JSON.stringify({ renamed: args[2], old: 'ws/quiet-mesa', new: args[4] }), stderr: '' };
      }
      return { code: 1, stdout: '', stderr: '' };
    };
    const w = new FleetWatcher(testDeps(home, run), new Bus(), 2000, cachePathIn(home));

    await w.sweepNames();
    expect(renames.filter((a) => a.includes(BAD))).toEqual([]);
    // Control: the sweep ran and renamed the valid row, so the absence above is the omission's.
    expect(renames.map((a) => a[2])).toEqual([NAME_ID]);
  });

  it('sweepPr keeps no pr state for --actor and composes no pr-state naming it', async () => {
    // `sweepPr` composes `pr-state --project <p>`, never an id, so the refused row
    // gets a project of its own (`solo`). Ids are listed in sorted order, and
    // `--actor` sorts first, so a build that swept it would ask `solo` (and fail,
    // backing `--actor` off into `prStates`) BEFORE the valid row's project answers.
    const home = mkTmp('ccrc-retained-');
    plantRow(home, VALID, workspaceRow(VALID, 'demo', 'quiet-basin'));
    plantRow(home, BAD, workspaceRow(BAD, 'solo', 'actor-ws'));
    expectPlanted(home, BAD);
    liveIdle(home);
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const prCalls: string[][] = [];
    const run: Runner = async (_cmd, args) => {
      if (args[0] === 'pr-state') {
        prCalls.push([...args]);
        return args[2] === 'demo'
          ? { code: 0, stdout: mergedLine(VALID), stderr: '' }
          : { code: 1, stdout: '', stderr: 'gh unreachable' };
      }
      if (args[0] === 'has-session') return { code: 0, stdout: '', stderr: '' };
      if (args[0] === 'list-panes') return { code: 0, stdout: '4242\n', stderr: '' };
      if (args[0] === 'capture-pane') return { code: 0, stdout: '', stderr: '' };
      return { code: 0, stdout: '', stderr: '' };
    };
    const w = new FleetWatcher(testDeps(home, run), new Bus(), 10_000, cachePathIn(home));
    try {
      await w.tick();
      await vi.waitFor(() => expect(w.currentPrStates().get(VALID)?.phase).toBe('merged'), { timeout: 3000 });
      expect(prCalls.filter((a) => a.includes('solo') || a.includes(BAD))).toEqual([]);
      expect(w.currentPrStates().has(BAD)).toBe(false);
      expect(prCalls).toContainEqual(['pr-state', '--project', 'demo']);
    } finally {
      w.stop();
    }
  });

  it("one tick never captures --actor's pane", async () => {
    // The dialog detector reads `tick`'s own `records` (the census pins the
    // hand-off), so this is the production path, not `detectDialogs`' fallback.
    const home = mkTmp('ccrc-retained-');
    plantRow(home, VALID, workspaceRow(VALID, 'demo', 'quiet-basin'));
    plantRow(home, BAD, workspaceRow(BAD, 'demo', 'actor-ws'));
    expectPlanted(home, BAD);
    liveIdle(home);
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const captures: string[][] = [];
    const run: Runner = async (_cmd, args) => {
      if (args[0] === 'capture-pane') { captures.push([...args]); return { code: 0, stdout: '', stderr: '' }; }
      if (args[0] === 'has-session') return { code: 0, stdout: '', stderr: '' };
      if (args[0] === 'list-panes') return { code: 0, stdout: '4242\n', stderr: '' };
      return { code: 0, stdout: '', stderr: '' };
    };
    const w = new FleetWatcher(testDeps(home, run), new Bus(), 10_000, cachePathIn(home));
    try {
      await w.tick();
      const targets = captures.map((a) => a[a.indexOf('-t') + 1]);
      expect(targets).not.toContain(tmuxTarget(BAD));
      // Control: the detector ran over the valid row.
      expect(targets).toContain(tmuxTarget(VALID));
    } finally {
      w.stop();
    }
  });
});

describe('the raw-name ladders read a refused row as unmeasurable, never as absent (spec §2.3)', () => {
  it('POST /api/claims by --actor answers 502 registry-unmeasurable', async () => {
    const home = mkTmp('ccrc-retained-');
    seedRow(home, BAD);
    expectPlanted(home, BAD);
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const rec = recorder();
    const w = await appFor(home, rec.run, { mailToken: TOKEN });
    app = w.app;

    const res = await post(app, '/api/claims', {
      byId: BAD, byUuid: uuidOf(home, BAD), project: 'demo',
      intent: 'pin a refused claimant', paths: ['server/src/watch.ts'],
    });
    expect(res.statusCode).toBe(502);
    expect(res.json()).toMatchObject({ ok: false, error: 'registry-unmeasurable' });
    expect(rec.calls).toEqual([]);
  });

  it('POST /api/mail from --actor answers 502 and records a registry-unmeasurable rejection', async () => {
    const home = mkTmp('ccrc-retained-');
    seedRow(home, BAD);
    expectPlanted(home, BAD);
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const w = await appFor(home, recorder().run, { mailToken: TOKEN });
    app = w.app;

    const res = await post(app, '/api/mail', {
      fromId: BAD, fromUuid: uuidOf(home, BAD), toId: 'coordinator',
      kind: 'finding', subject: 'a finding', body: 'the body', artifacts: [],
    });
    expect(res.statusCode).toBe(502);
    expect(res.json()).toMatchObject({ ok: false, error: 'registry-unmeasurable' });
    expect(w.coord.rejections().map((r) => r.code)).toEqual(['registry-unmeasurable']);
  });

  it('POST /api/mail to --actor answers 502', async () => {
    const home = mkTmp('ccrc-retained-');
    seedRow(home, BAD);
    seedRow(home, VALID);
    expectPlanted(home, BAD);
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const w = await appFor(home, recorder().run, { mailToken: TOKEN });
    app = w.app;

    const res = await post(app, '/api/mail', {
      fromId: VALID, fromUuid: uuidOf(home, VALID), toId: BAD,
      kind: 'finding', subject: 'a finding', body: 'the body', artifacts: [],
    });
    expect(res.statusCode).toBe(502);
    expect(res.json()).toMatchObject({ ok: false, error: 'registry-unmeasurable' });
    expect(w.coord.rejections().map((r) => r.code)).toEqual(['registry-unmeasurable']);
    expect(w.coord.dueDeliveries(Date.now(), 60_000)).toEqual([]);
  });

  it('POST /api/mail/:id/ack by --actor answers 502', async () => {
    const home = mkTmp('ccrc-retained-');
    seedRow(home, BAD);
    expectPlanted(home, BAD);
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const w = await appFor(home, recorder().run, { mailToken: TOKEN });
    app = w.app;

    const res = await post(app, '/api/mail/1/ack', { fromId: BAD, fromUuid: uuidOf(home, BAD) });
    expect(res.statusCode).toBe(502);
    expect(res.json()).toMatchObject({ ok: false, error: 'registry-unmeasurable' });
    expect(w.coord.rejections().map((r) => r.code)).toEqual(['registry-unmeasurable']);
  });
});
```

- [ ] **Step 2: Bring the census to its final placement, `server/test/registry-refused-census.test.ts`**

Edit the file Tasks 5, 6 and 7 left, in place; never replace it. Every existing case, helper and import stays byte for byte, apart from the three edits below. That keeps:
- Task 5's scan and its first describe: the CONTROL, the `sites.length > 0` guard, and the orphan-tag count (`commentTagCount`);
- Task 6's describe, with its body-slicer CONTROL and its helpers `TICK_WATCH_TS`, `TICK_HEAD`, `TICK_STRINGS`, `tickCode` and `tickBodyOf`;
- Task 7's describe, with its four aliased imports and its `t7…` helpers. It already pins every production `assembleFleet(` call's records argument, and the `readRegistry(` and `readRegistryMeasured(` call counts (8 and 15).

Keep Step 0 (g)'s title list, make the three edits, and run Step 0 (g)'s grep again. Every title from the first list must still appear, and the second list adds exactly two: `no site is unplaced` and `tick() passes its records to detectDialogs(`. Record the comparison in the SDD ledger.

(a) In `EXPECTED_SITES` (Task 7's case `the classified set is exactly these 23 sites`), change exactly these eight rows. Match each row by its whole string, wherever it stands; the case sorts both sides. Only the word changes: the other fifteen rows stay as they are, and `expect(EXPECTED_SITES).toHaveLength(23);` stays.

Before:

```ts
  'commands.ts | sessionCommands | readRegistry | unplaced',
  'coord/routes.ts | POST /api/mail | readRegistry | unplaced',
  'coord/routes.ts | POST /api/mail/:id/ack | readRegistry | unplaced',
  'coord/routes.ts | requireAttribution | readRegistry | unplaced',
  'server.ts | prTasks | readRegistry | unplaced',
  'watch.ts | detectDialogs | readRegistry | unplaced',
  'watch.ts | sweepNames | readRegistry | unplaced',
  'watch.ts | sweepPr | readRegistry | unplaced',
```

After:

```ts
  'commands.ts | sessionCommands | readRegistry | knownId',
  'coord/routes.ts | POST /api/mail | readRegistry | raw-name',
  'coord/routes.ts | POST /api/mail/:id/ack | readRegistry | raw-name',
  'coord/routes.ts | requireAttribution | readRegistry | raw-name',
  'server.ts | prTasks | readRegistry | knownId',
  'watch.ts | detectDialogs | readRegistry | tests-only',
  'watch.ts | sweepNames | readRegistry | omits',
  'watch.ts | sweepPr | readRegistry | omits',
```

The list then holds these 23 rows, in Task 5's spelling (a route is `<METHOD> <path>`, as Task 5's `enclosingOf` writes it). They are shown sorted; the list's own order is free:

```ts
  'commands.ts | sessionCommands | readRegistry | knownId',
  'coord/dispatch.ts | dispatchRun | readRegistryMeasured | gated',
  'coord/dispatch.ts | dispatchRun | readRegistryMeasured | refuses',
  'coord/dispatch.ts | dispatchRun | readRegistryMeasured | refuses',
  'coord/fingerprint.ts | resolveDoneBranch | readRegistryMeasured | holds',
  'coord/routes.ts | GET /api/peers | readRegistryMeasured | reports',
  'coord/routes.ts | POST /api/claims | readRegistryMeasured | reports',
  'coord/routes.ts | POST /api/mail | readRegistry | raw-name',
  'coord/routes.ts | POST /api/mail/:id/ack | readRegistry | raw-name',
  'coord/routes.ts | requireAttribution | readRegistry | raw-name',
  'fleet.ts | assembleFleet | readRegistryMeasured | tests-only',
  'lifecycle.ts | listProjects | readRegistryMeasured | reports',
  'registry.ts | readRegistry | readRegistryMeasured | wrapper',
  'server.ts | GET /api/fleet | readRegistryMeasured | stale',
  'server.ts | GET /ws/fleet | readRegistryMeasured | stale',
  'server.ts | prTasks | readRegistry | knownId',
  'watch.ts | detectDialogs | readRegistry | tests-only',
  'watch.ts | sweepHookStates | readRegistryMeasured | tests-only',
  'watch.ts | sweepMail | readRegistryMeasured | holds',
  'watch.ts | sweepNames | readRegistry | omits',
  'watch.ts | sweepPr | readRegistry | omits',
  'watch.ts | sweepTasks | readRegistryMeasured | omits',
  'watch.ts | tick | readRegistryMeasured | omits',
```

(b) In the first describe, `every registry reader call is classified for refused rows (spec §2.3)`, insert this case directly after the case `wrapper is used once, in registry.ts, inside readRegistry`, below its closing `  });`:

```ts
  it('no site is unplaced', () => {
    expect(allSites().filter((s) => s.word === 'unplaced').map(key)).toEqual([]);
  });
```

(c) In Task 6's describe, `tick hands its records to the lanes that would otherwise read the registry again (spec §2.3)`, insert this case directly after the case `tick() passes its records to sweepHookStates(`, below its closing `  });`. It reuses Task 6's helpers, and `readFileSync`, which Task 5's imports already hold:

```ts
  it('tick() passes its records to detectDialogs(', () => {
    const body = tickBodyOf(tickCode(readFileSync(TICK_WATCH_TS, 'utf8')), TICK_HEAD);
    expect(body, 'tick no longer hands detectDialogs its records: that lane would read the registry itself')
      .toMatch(/\bthis\.detectDialogs\([^)]*\brecords\s*\)/);
  });
```

Measured at `837a099c0`: `tick`'s body (`async tick(): Promise<void> {`, `watch.ts:1874`) holds `const pending = await this.detectDialogs(this.primed, records);` (`watch.ts:2023`), so this case passes at once. T8.3 is its proof.

- [ ] **Step 3: Run both files and see the expected red**

```bash
cd server && ./node_modules/.bin/vitest run test/registry-retained-callers.test.ts test/registry-refused-census.test.ts
```

Expected:
- `registry-retained-callers.test.ts`: all eight cases PASS. Tasks 2 and 5 built this behaviour; Step 6 proves each pin.
- `registry-refused-census.test.ts`: two cases are RED and the rest PASS.
  - `the classified set is exactly these 23 sites` is red. The diff shows eight rows reading `unplaced` where `EXPECTED_SITES` has `knownId` (2), `omits` (2), `tests-only` (1) or `raw-name` (3).
  - `no site is unplaced` is red: `expected [ 'commands.ts | sessionCommands | readRegistry | unplaced', … ] to deeply equal []`, with eight entries.

Every other case in the file PASSES, the two new ones included: `tick() passes its records to detectDialogs(` is green at once, and Task 7's describe names no `unplaced` site. The scanner is Task 5's, unchanged, and Step 0 (f) measured it green at Task 7's tip, so the `enclosing` column cannot move here. A diff on any row other than the eight words, or a 22nd or 24th site, is not this case. **STOP** and report the measured rows.

- [ ] **Step 4: Place the eight tags**

Each edit replaces ONE whole line: the comment line within the three lines above the named call that contains `[registry-refused:unplaced]`. Task 5 wrote that line; its prose after the tag is whatever Task 5 wrote, and all of it goes. Nothing else in the file changes. The new line's indentation is the call's own.

Locate the lines with:

```bash
grep -n 'registry-refused:unplaced' server/src/commands.ts server/src/server.ts server/src/watch.ts server/src/coord/routes.ts
```

1. `server/src/commands.ts`, in `sessionCommands`, above `  const rec = (await readRegistry(deps.io, deps.cfg)).find((r) => r.id === id);`. After:
   ```ts
     // [registry-refused:knownId] the route's knownId refuses a non-registry id before this read (spec §2.3).
   ```
2. `server/src/server.ts`, in `const prTasks = async (id: string): Promise<TaskItem[] | null> => {`, above `    const rec = (await readRegistry(deps.io, deps.cfg)).find((r) => r.id === id);`. After:
   ```ts
       // [registry-refused:knownId] GET /pr's knownId refuses a non-registry id before this read (spec §2.3).
   ```
3. `server/src/watch.ts`, in `async sweepNames(): Promise<void> {`, above `    const records = await readRegistry(this.deps.io, this.deps.cfg);`. After:
   ```ts
       // [registry-refused:omits] a refused row is never in `records`, so it is never renamed (spec §2.3).
   ```
4. `server/src/watch.ts`, in `private async sweepPr(): Promise<void> {`, inside its `try {`, above `      const records = await readRegistry(this.deps.io, this.deps.cfg);`. After:
   ```ts
         // [registry-refused:omits] a refused row is never in `records`: no pr-state, no prStates key (spec §2.3).
   ```
5. `server/src/watch.ts`, in `private async detectDialogs(notify: boolean, records?: SessionRecord[]): Promise<Set<string>> {`, above `    const recs = records ?? await readRegistry(this.deps.io, this.deps.cfg);`. After:
   ```ts
       // [registry-refused:tests-only] tick() passes its records; only tests reach this read, which omits refused rows.
   ```
6. `server/src/coord/routes.ts`, in `const requireAttribution = async (`, above `    const registry = await readRegistry(deps.io, deps.cfg);`; the next line is `    const row = registry.find((r) => r.id === whoId);`. After:
   ```ts
       // [registry-refused:raw-name] a refused row is in `names`, never in `registry`: the ladder answers 502.
   ```
7. `server/src/coord/routes.ts`, in `app.post('/api/mail', async (req, reply) => {`, above `    const registry = await readRegistry(deps.io, deps.cfg);`; the next code line is `    const sender = registry.find((r) => r.id === fromId);`, under the comment `// 5: sender — a registry row must exist for fromId.`. After:
   ```ts
       // [registry-refused:raw-name] a refused row is in `names`, never in `registry`: the ladder answers 502.
   ```
8. `server/src/coord/routes.ts`, in `app.post('/api/mail/:id/ack', async (req, reply) => {`, above `    const registry = await readRegistry(deps.io, deps.cfg);`; the next line is `    const sender = registry.find((r) => r.id === fromId);`. After:
   ```ts
       // [registry-refused:raw-name] a refused row is in `names`, never in `registry`: the ladder answers 502.
   ```

None of these lines quotes a kebab word in single quotes, so `mail-routes.test.ts`'s kebab scan reads nothing new. Check the edit:

```bash
grep -rn 'registry-refused:unplaced' server/src | wc -l      # 0, apart from any docstring Step 0 (a) recorded as not a tag
git diff --numstat -- server/src                             # commands.ts 1 1, server.ts 1 1, watch.ts 3 3, coord/routes.ts 3 3
```

- [ ] **Step 5: Run both files green**

```bash
cd server && ./node_modules/.bin/vitest run test/registry-retained-callers.test.ts test/registry-refused-census.test.ts
```

Expected: PASS, both files.

- [ ] **Step 6: Mutation table**

Apply each mutation alone and run its command from `server/`. See the red, then revert by undoing exactly that edit. In this table `\|` is Markdown's escape for `|`: type T8.2's filter as `-t 'sweepNames|sweepPr|pane'`. A literal `\|` in a vitest `-t` pattern matches a `|` character, so no test would run and the row would show no red. After each revert, `git diff --numstat -- server/src` shows Step 4's eight lines only. Do not use `git checkout --` on `server.ts`, `watch.ts` or `coord/routes.ts`: it would discard Step 4's tags too. Every red text below was drafted, not measured. Measure each and record the measured text in the SDD ledger; a different count is not a departure.

| # | Mutation (exact edit) | Command | Expected red |
|---|---|---|---|
| T8.1 | `server.ts` `knownId`: delete its first statement, `if (!isRegistryId(id)) return false;` (Task 2) | `./node_modules/.bin/vitest run test/registry-retained-callers.test.ts -t 'commands and GET /pr'` | `expected 200 to be 404` on `/commands`. Measure `/pr` too by commenting out the `/commands` pair for one run, then restore it: `expected 200 to be 404` |
| T8.2 | `registry.ts` `readRegistryMeasured`: let the loop build every listed id. `const ids = listedIds.filter((x) => isRegistryId(x));` becomes `const ids = listedIds;` (Task 5's mutation row 1), so `ids` keeps every `.uuid` id, sorted, refused ones included. `refused` stays as it is | `./node_modules/.bin/vitest run test/registry-retained-callers.test.ts -t 'sweepNames\|sweepPr\|pane'` | sweepNames: `expected [ [ 'ws-rename', '--session', '--actor', '--branch', 'ws/brainstorm-helix-and-slide-notes' ] ] to deeply equal []`. sweepPr: `expected [ [ 'pr-state', '--project', 'solo' ] ] to deeply equal []`. tick: `expected [ '=cc---actor:', '=cc-demo-quiet-basin:' ] not to include '=cc---actor:'` |
| T8.3 | `watch.ts` `tick`: `const pending = await this.detectDialogs(this.primed, records);` becomes `const pending = await this.detectDialogs(this.primed);` | `./node_modules/.bin/vitest run test/registry-refused-census.test.ts -t 'detectDialogs'` | `tick() passes its records to detectDialogs(`: `tick no longer hands detectDialogs its records: that lane would read the registry itself: expected '…' to match /\bthis\.detectDialogs\([^)]*\brecords\s*\)/`. The behaviour case stays green, because the fallback omits refused rows as well; this census case is the pin |
| T8.4 | `coord/routes.ts` `requireAttribution`: delete the `if (names.includes(\`${whoId}.uuid\`)) { … return false; }` block inside `if (!row) {` | `./node_modules/.bin/vitest run test/registry-retained-callers.test.ts -t 'claims'` | `expected 403 to be 502` (`unknown-sender`) |
| T8.5 | `coord/routes.ts` `POST /api/mail`, check 5: delete the `if (names.includes(\`${fromId}.uuid\`)) { return refuse(…); }` block inside `if (!sender) {` | `./node_modules/.bin/vitest run test/registry-retained-callers.test.ts -t 'mail from'` | `expected 403 to be 502` (`unknown-sender`) |
| T8.6 | `coord/routes.ts` `POST /api/mail`, check 7: delete the `if (names.includes(\`${toId}.uuid\`)) { return refuse(…); }` block | `./node_modules/.bin/vitest run test/registry-retained-callers.test.ts -t 'mail to'` | `expected 404 to be 502` (`unknown-recipient`) |
| T8.7 | `coord/routes.ts` `POST /api/mail/:id/ack`: delete the `if (names.includes(\`${fromId}.uuid\`)) { return refuse(…); }` block inside `if (!sender) {` | `./node_modules/.bin/vitest run test/registry-retained-callers.test.ts -t 'ack'` | `expected 403 to be 502` (`unknown-sender`) |
| T8.8 | `commands.ts`: Step 4 edit 1's tag word goes back to `unplaced` | `./node_modules/.bin/vitest run test/registry-refused-census.test.ts` | `the classified set is exactly these 23 sites`: the diff names `commands.ts \| sessionCommands \| readRegistry \| unplaced`. `no site is unplaced`: `expected [ 'commands.ts \| sessionCommands \| readRegistry \| unplaced' ] to deeply equal []` |
| T8.9 | `watch.ts`: delete Step 4 edit 5's whole tag line | same | `each … call carries a … tag`: `an untagged reader call: expected [ 'watch.ts:<n>' ] to deeply equal []`, and the 23-site case on `watch.ts \| detectDialogs \| readRegistry \| null` |
| T8.10 | `commands.ts` `sessionCommands`: add a second line, `const again = await readRegistry(deps.io, deps.cfg); void again;`, directly under its tagged call | same | the 23-site case (a 24th row, `commands.ts \| sessionCommands \| readRegistry \| knownId`, because the tag is within three lines of both calls). The second call shares that tag, so the word rule cannot see it. The multiset carries this row, together with the kept orphan count (`a [registry-refused:*] tag that stands above no reader call: expected 23 to be 24`) and Task 7's kept count case (`readRegistry( call sites in server/src: expected 9 to be 8`) |
| T8.11 | `lifecycle.ts`: insert `// [registry-refused:holds] stray` as a new line directly above `export async function listProjects(` (Task 5's row 8; Step 2 keeps Task 5's `commentTagCount`) | same | `a [registry-refused:*] tag that stands above no reader call: expected 24 to be 23` |

Revert each mutation, then run Step 5's command again: green.

- [ ] **Step 7: The task's other suites, and the type-check**

```bash
cd server && ./node_modules/.bin/vitest run test/mail-routes.test.ts test/claim-sweep.test.ts test/divergence-sweep.test.ts test/registry.test.ts test/name-sweep.test.ts test/pr-sweep.test.ts test/unattended-actor.test.ts test/verb-gate.test.ts
cd server && ./node_modules/.bin/vitest run test/typecheck-tests.test.ts
cd server && ./node_modules/.bin/tsc --noEmit -p .
```

Expected:
- every file PASSES;
- `typecheck-tests` compiles both new and changed test files;
- `tsc` prints nothing.

`pr-sweep` is a known load flake (CLAUDE.md): re-run it alone before calling a red a break. `unattended-actor` and `verb-gate` run because this task edits `watch.ts` and `coord/routes.ts` (Global Constraints). `registry` runs because its `[registry-read-census:*]` scan reads every `server/src` comment, these eight lines included; their prefix is not its own, so it stays green.

- [ ] **Step 8: Commit**

```bash
git add server/src/commands.ts server/src/server.ts server/src/watch.ts server/src/coord/routes.ts \
  server/test/registry-refused-census.test.ts server/test/registry-retained-callers.test.ts
git commit -F - <<'EOF'
test(registry): pin the eight retained readRegistry callers on a refused row

Eight callers keep the readRegistry wrapper, and spec 2.3 asks for a pin on
each reason. Each is now placed in the reader census and pinned on a
planted --actor row:

- knownId: GET /commands and GET /pr answer 404 unknown-session, because
  knownId refuses a non-registry id before it lists anything;
- omits: sweepNames composes no ws-rename for it, sweepPr asks no
  pr-state for its project and keeps no pr state for it, and one tick
  never captures its pane;
- tests-only: the dialog detector's own read is reached by tests only,
  and the census pins that tick hands it its records;
- raw-name: POST /api/claims, POST /api/mail (as sender and as
  recipient) and the mail ack answer 502 registry-unmeasurable, never an
  unknown sender or recipient, because their raw listing still names the
  row.

The census reaches its final placement: 23 sites, the 22 consumer sites
and readRegistry's own wrapper call, with no site left unplaced.
EOF
```

Name this carried line, by slug, in the wave-done: `raw-name-refused-detail-says-transient`. The three raw-name ladders answer a refused row 502 `registry-unmeasurable`. That word is right (spec §2.3: never absence), but the detail says "listed but unreadable — transient", which is never true of a refused id. This task edits tag lines only, so the clearer detail is a later wave's.

---

### Task 9: `POST /api/runs` and the reclaim door

**Model routing:** `opus`, effort `high`. This task covers the request ingress for every id a run row stores, and the one ungated door that re-points a programme. R5, R8, R21 and R29 bind it.

**Files:**
- Modify `server/src/coord/routes.ts`:
  - **`POST /api/runs`** (`app.post('/api/runs', async (req, reply) => {`, about `:1269` at `837a099c0`). Insert three checks between the comment that begins `` // `kind`'s own vocabulary was already proven above, before this guard. `` and `const runKind: 'work' | 'review' = kind === 'review' ? 'review' : 'work';`. That puts them after the shape guard's bare `bad-request` return.
  - **The reclaim switch** (`app.post('/api/runs/:id/reclaim'`, the `switch (r.kind) {` under `const r = await coordMutex.run(() => reclaimRun(reclaimDeps, id, to));`). Task 4's `case 'bad-session':` arm becomes a two-status arm.
  - **The `../../../shared/api.js` import** gains `isRegistryId` only if Task 7 did not already add it (Step 0 (g)).
- Modify `server/src/coord/reclaim.ts`:
  - the `../../../shared/api.js` import (`import { lifecycleIsDead, sessionLifecycle, type SessionLifecycle } from '../../../shared/api.js';`);
  - `ReclaimOutcome`'s `bad-session` member (Task 4's, located by `kind: 'bad-session'; which: 'heir'`);
  - `reclaimRun`'s docstring ladder: one unnumbered bullet after rung 2;
  - `reclaimRun`'s body: the stored-claimant check right after `if (from === null) return { ok: false, kind: 'no-claimant' };`.
- Modify `server/test/run-route-route.test.ts`. The case `'409s bad-session (not 200, and writes no event) when the COORDINATOR session id is not a legal shape'` opens its run through `w.coord.openRun`, not `POST /api/runs`. Its title is unchanged.
- Create `server/test/run-open-registry-id.test.ts`.
- NOT edited: `shared/api.ts`, `coord/store.ts`, any other route, `ccd/`, `agent/` and `pwa/`.

**Interfaces:**
- Consumes:
  - `isRegistryId(id: unknown): id is string` (`shared/api.ts`, Task 1);
  - `REFUSED_IDS: readonly string[]` (`server/test/registryIdCases.ts`, Task 1);
  - `seedRow(home: string, id: string, fields?: Record<string, string>): void` and `recorder(cfg?: { fail?: ReadonlySet<string> }): { run: Runner; calls: string[][] }` (`server/test/idGateFixture.ts`, Task 2);
  - `storedRun(coord: CoordStore, r: { state: RunState; sessionId: string | null; claimedBy: string; kind?: 'work' | 'review'; reviews?: number }): number` (`server/test/idGateFixture.ts`, Task 3);
  - `ReclaimOutcome`'s Task 4 member `{ ok: false; kind: 'bad-session'; which: 'heir'; detail: string }`, and Task 4's heir return `{ ok: false, kind: 'bad-session', which: 'heir', detail: 'claimedBy is not a registry id' }`.
- Produces:
  ```ts
  // server/src/coord/reclaim.ts — the member widens (R21); no new member, no signature change
  | { ok: false; kind: 'bad-session'; which: 'heir' | 'claimant'; detail: string }
  export async function reclaimRun(deps: ReclaimDeps, runId: number, to: string): Promise<ReclaimOutcome>;   // unchanged signature
  ```
  The new answers (R13 table):
  - `POST /api/runs`:
    - `claimedBy` fails: 400 `{ ok: false, error: 'bad-session', detail: 'claimedBy is not a registry id' }`.
    - `sessionId` fails: 400 `{ ok: false, error: 'bad-session', detail: 'sessionId is not a registry id' }`.
    - A work `project` beginning `-` or `.`: 400 `{ ok: false, error: 'bad-request', detail: 'project must not begin with - or .' }`.
  - `POST /api/runs/:id/reclaim`:
    - `which: 'heir'`: 400 `{ ok: false, error: 'bad-session', detail }`.
    - `which: 'claimant'`: 409 `{ ok: false, error: 'bad-session', detail }`, with a detail that names `POST /api/runs/:id/abandon`.
  - The PWA's reclaim sheet (`pwa/src/fleet/ResumeSheet.tsx`'s `reclaimErrorText`) reads a 409's code only through `isReclaimRefuseCode`, and `bad-session` is not a `ReclaimRefuseCode`. So it shows this 409 as an unrecognised refusal and never shows the `detail`. `pwa/` is outside this wave; Task 16 carries it as `reclaim-sheet-drops-the-bad-session-detail`.

- [ ] **Step 0: Entry conditions.** Tasks 1 to 8 are committed. Measure each one from the workspace root; never assume it.

```bash
grep -n "^export function isRegistryId" shared/api.ts                                              # (a) one line (Task 1)
grep -n "^export const REFUSED_IDS" server/test/registryIdCases.ts                                 # (b) one line (Task 1)
grep -n "^export function seedRow\|^export function recorder\|^export function storedRun" server/test/idGateFixture.ts   # (c) three lines (Tasks 2, 3)
grep -n "kind: 'bad-session'; which: 'heir'" server/src/coord/reclaim.ts                           # (d) one line: Task 4's member
grep -c "which: 'heir'" server/src/coord/reclaim.ts                                                # (e) 3: the member, rung 3's docstring line, and the heir return
awk '/reclaimRun\(reclaimDeps, id, to\)/,/const _exhaustive: never = r;/' server/src/coord/routes.ts | grep -c "case 'bad-session':"   # (f) 1: Task 4's reclaim arm
grep -n "isRegistryId" server/src/coord/routes.ts | head -3                                        # (g) the shared/api.js import names it (Task 7's peers check); record whether it does
grep -c "if (from === null) return { ok: false, kind: 'no-claimant' };" server/src/coord/reclaim.ts   # (h) 1
grep -c "const runKind: 'work' | 'review' = kind === 'review' ? 'review' : 'work';" server/src/coord/routes.ts   # (i) 1
grep -c "\"malformed JSON\" from \"you sent the wrong thing\"." server/src/coord/routes.ts          # (j) 1: the comment line right above (i)
grep -c "claimedBy: 'bad claimant'" server/test/run-route-route.test.ts                            # (k) 1
grep -c "^import { lifecycleIsDead, sessionLifecycle, type SessionLifecycle } from '../../../shared/api.js';$" server/src/coord/reclaim.ts   # (l) 1, or 0 if Task 4 already added isRegistryId (record which)
```

A different line number is not a departure: re-point by content and record it. If (a) to (f), (h), (i) or (k) is 0, STOP with `gate-site-moved` and build nothing.

- [ ] **Step 1: Write the failing test.** Create `server/test/run-open-registry-id.test.ts`:

```ts
// Path identity W1a, Task 9 (spec §2.3): `POST /api/runs` asks the ONE registry
// id predicate of every id it stores, and the reclaim door asks it of both the
// heir it is handed and the claimant it would replace.
//
// Every refused id that CAN be a file has its row planted, so only the predicate
// can refuse it; absence never answers. A file name is at most 255 bytes, so the
// 256-character id is the one row these tables cannot plant. It fails the
// predicate on length alone.
import { describe, it, expect, afterEach } from 'vitest';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import type { FastifyInstance } from 'fastify';
import { buildServer } from '../src/server.js';
import { openCoordDb } from '../src/coord/db.js';
import { CoordStore } from '../src/coord/store.js';
import type { Runner } from '../src/exec.js';
import { localIO, type FleetIO } from '../src/io.js';
import { testDeps } from './helpers.js';
import { mkTmp } from './tmpHelpers.js';
import { okRun } from './coordReadHelpers.js';
import { recorder, seedRow, storedRun } from './idGateFixture.js';
import { REFUSED_IDS } from './registryIdCases.js';

const PROJECT = 'demo';
const CLAIMED_BY = 'demo-coordinator';
const TOKEN = 'f'.repeat(64);
/** The claimant a reclaim replaces; never planted, so it measures dead. */
const DEAD = 'demo-coordinator-old';
const HEIR = 'demo-coordinator-new';

const OPEN_BODY = { program: 'build4', title: 'Path identity', project: PROJECT,
  wave: 1, waveOf: 3, claimedBy: CLAIMED_BY, homeProject: PROJECT };

/** The longest id this file plants: `seedRow` writes `<id>.<field>`, and a file name is at most 255 bytes. */
const PLANTABLE_MAX = 200;

/** `run-routes.test.ts`'s app, plus an io that counts listings of the registry
 *  directory, so "refused before any read" is a number rather than a reading of
 *  the code. */
const openApp = async (home: string, run: Runner) => {
  mkdirSync(path.join(home, '.cc-sessions'), { recursive: true });
  const coord = new CoordStore(openCoordDb(path.join(home, '.ccrc', 'coord.db')));
  const base = testDeps(home, run);
  let listings = 0;
  const io: FleetIO = {
    ...localIO,
    readdir: async (p, timeoutMs, signal) => {
      if (p === base.cfg.registryDir) listings += 1;
      return localIO.readdir(p, timeoutMs, signal);
    },
  };
  const app = await buildServer({ ...base, io, mailToken: TOKEN, coord });
  return { app, coord, listings: (): number => listings, resetListings: (): void => { listings = 0; } };
};

const postOpen = (app: FastifyInstance, body: unknown) =>
  app.inject({ method: 'POST', url: '/api/runs', headers: { 'x-ccrc-mail-token': TOKEN },
    payload: body as Record<string, unknown> });
const getRuns = (app: FastifyInstance) => app.inject({ method: 'GET', url: '/api/runs' });
/** The reclaim door is ungated against the box token (its route docstring), so no header. */
const postReclaim = (app: FastifyInstance, id: number, claimedBy: string) =>
  app.inject({ method: 'POST', url: `/api/runs/${id}/reclaim`, payload: { claimedBy } });

describe('POST /api/runs refuses an id that is not a registry id (spec §2.3)', () => {
  let app: FastifyInstance | undefined;
  afterEach(async () => { if (app) await app.close(); app = undefined; });

  it.each(REFUSED_IDS)('claimedBy %s answers 400 bad-session naming claimedBy', async (id) => {
    const home = mkTmp('ccrc-runopen-id-');
    if (id.length <= PLANTABLE_MAX) seedRow(home, id);
    const { run, calls } = recorder();
    const w = await openApp(home, run); app = w.app;
    const res = await postOpen(w.app, { ...OPEN_BODY, claimedBy: id });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({ ok: false, error: 'bad-session', detail: 'claimedBy is not a registry id' });
    expect((await getRuns(w.app)).json()).toEqual({ runs: [] });
    expect(calls).toEqual([]);
  });

  it.each(REFUSED_IDS)('sessionId %s, its row planted, answers 400 bad-session naming sessionId', async (id) => {
    const home = mkTmp('ccrc-runopen-id-');
    if (id.length <= PLANTABLE_MAX) seedRow(home, id);
    const { run, calls } = recorder();
    const w = await openApp(home, run); app = w.app;
    const res = await postOpen(w.app, { ...OPEN_BODY, wave: 2, sessionId: id });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({ ok: false, error: 'bad-session', detail: 'sessionId is not a registry id' });
    expect(calls.filter((c) => c[0] === 'ws-hold')).toEqual([]);
    expect((await getRuns(w.app)).json()).toEqual({ runs: [] });
  });

  it.each(['-x', '--actor', '.', '.hidden'])('a work project beginning - or . answers 400 bad-request naming project: %s', async (project) => {
    const home = mkTmp('ccrc-runopen-id-');
    const { run, calls } = recorder();
    const w = await openApp(home, run); app = w.app;
    const res = await postOpen(w.app, { ...OPEN_BODY, project });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({ ok: false, error: 'bad-request', detail: 'project must not begin with - or .' });
    expect((await getRuns(w.app)).json()).toEqual({ runs: [] });
    expect(calls).toEqual([]);
  });

  it('controls: claimedBy a--actor, sessionId a.--actor and a project with an inner dash all open', async () => {
    const home = mkTmp('ccrc-runopen-id-');
    seedRow(home, 'a.--actor');
    const { run, calls } = recorder();
    const w = await openApp(home, run); app = w.app;
    const claimant = await postOpen(w.app, { ...OPEN_BODY, program: 'ctl-claimant', claimedBy: 'a--actor' });
    expect(claimant.statusCode).toBe(200);
    const session = await postOpen(w.app, { ...OPEN_BODY, program: 'ctl-session', wave: 2, sessionId: 'a.--actor' });
    expect(session.statusCode).toBe(200);
    // `CCD_ARGV.wsHold` is `['ws-hold', '--session', <id>, …]`: the accepted id reaches its argv whole.
    expect(calls.filter((c) => c[0] === 'ws-hold').map((c) => c[2])).toEqual(['a.--actor']);
    const project = await postOpen(w.app, { ...OPEN_BODY, program: 'ctl-project', project: 'demo-inner-dash' });
    expect(project.statusCode).toBe(200);
    expect(((await getRuns(w.app)).json() as { runs: unknown[] }).runs).toHaveLength(3);
  });

  it('a padded claimedBy is checked as given, never trimmed, and answers 400 bad-session', async () => {
    const home = mkTmp('ccrc-runopen-id-');
    const { run } = recorder();
    const w = await openApp(home, run); app = w.app;
    const res = await postOpen(w.app, { ...OPEN_BODY, claimedBy: ` ${CLAIMED_BY}` });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({ ok: false, error: 'bad-session', detail: 'claimedBy is not a registry id' });
    expect((await getRuns(w.app)).json()).toEqual({ runs: [] });
  });

  it("a review open with a bad sessionId answers bad-session ahead of the review arm's checks", async () => {
    const home = mkTmp('ccrc-runopen-id-');
    seedRow(home, '--actor');
    const { run } = recorder();
    const w = await openApp(home, run); app = w.app;
    const review = { program: 'build4', title: 'Review', claimedBy: CLAIMED_BY, homeProject: PROJECT,
      kind: 'review', reviews: 9999 };
    const bad = await postOpen(w.app, { ...review, sessionId: '--actor' });
    expect(bad.statusCode).toBe(400);
    expect(bad.json()).toEqual({ ok: false, error: 'bad-session', detail: 'sessionId is not a registry id' });
    // The ordering, stated: a VALID sessionId still meets the review arm's own refusal.
    const valid = await postOpen(w.app, { ...review, sessionId: 'demo-worker' });
    expect(valid.statusCode).toBe(400);
    expect(valid.json()).toEqual({ ok: false, error: 'bad-request',
      detail: 'sessionId is refused on a review run — it always spawns fresh on its own workspace' });
  });
});

describe('the reclaim door refuses a bad id on either side (spec §2.3)', () => {
  let app: FastifyInstance | undefined;
  afterEach(async () => { if (app) await app.close(); app = undefined; });

  it('a stored claimedBy of --actor answers 409 bad-session whose detail names POST /api/runs/:id/abandon', async () => {
    const home = mkTmp('ccrc-reclaim-id-');
    seedRow(home, '--actor');
    seedRow(home, HEIR);
    const { run, calls } = recorder();
    const w = await openApp(home, run); app = w.app;
    const id = storedRun(w.coord, { state: 'planned', sessionId: null, claimedBy: '--actor' });
    w.resetListings();
    const res = await postReclaim(w.app, id, HEIR);
    expect(res.statusCode).toBe(409);
    const body = res.json() as { ok: boolean; error: string; detail: string };
    expect(body).toMatchObject({ ok: false, error: 'bad-session' });
    expect(body.detail).toContain('POST /api/runs/:id/abandon');
    expect(okRun(w.coord.run(id))!.claimedBy).toBe('--actor');
    expect(w.coord.runEvents(id).some((e) => e.detail?.startsWith('reclaim:'))).toBe(false);
    expect(w.listings()).toBe(0);
    expect(calls).toEqual([]);
  });

  it('the heir --actor answers 400 bad-session, and the stored claimant is unchanged', async () => {
    const home = mkTmp('ccrc-reclaim-id-');
    seedRow(home, '--actor');
    const { run, calls } = recorder();
    const w = await openApp(home, run); app = w.app;
    const id = storedRun(w.coord, { state: 'planned', sessionId: null, claimedBy: DEAD });
    w.resetListings();
    const res = await postReclaim(w.app, id, '--actor');
    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({ ok: false, error: 'bad-session', detail: 'claimedBy is not a registry id' });
    expect(okRun(w.coord.run(id))!.claimedBy).toBe(DEAD);
    expect(w.listings()).toBe(0);
    expect(calls).toEqual([]);
  });

  it('control: a stored claimant a--actor, measured dead, is reclaimed by a valid heir', async () => {
    const home = mkTmp('ccrc-reclaim-id-');
    seedRow(home, HEIR);
    const { run } = recorder();
    const w = await openApp(home, run); app = w.app;
    const id = storedRun(w.coord, { state: 'planned', sessionId: null, claimedBy: 'a--actor' });
    const res = await postReclaim(w.app, id, HEIR);
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ ok: true, from: 'a--actor', to: HEIR });
    expect(okRun(w.coord.run(id))!.claimedBy).toBe(HEIR);
  });
});
```

- [ ] **Step 2: Run it and see it fail**

```bash
cd server && ./node_modules/.bin/vitest run test/run-open-registry-id.test.ts
```

Expected: FAIL, as follows. The text below was drafted, not measured; record what you measure.
- `claimedBy %s …`: all 10 rows fail with `expected 200 to be 400`, because the open succeeds today.
- `sessionId %s …`: all 10 rows fail with `expected 409 to be 400`. Task 4's `childBindGate` already answers `spent-unmeasured` on `bad-id`.
- `a work project …`: 4 rows fail with `expected 200 to be 400`.
- `a padded claimedBy …`: fails with `expected 200 to be 400`.
- `a review open with a bad sessionId …`: fails on `toEqual`. It received `{ ok: false, error: 'bad-request', detail: 'sessionId is refused on a review run — it always spawns fresh on its own workspace' }`.
- `a stored claimedBy of --actor …`: fails with `expected 502 to be 409`. Task 4's `measureClaimant` reads `bad-id` as `unmeasurable`, which gives `registry-unmeasurable`.
- Already green, and recorded as such:
  - `controls: …` and the reclaim `control: …`, which are controls;
  - `the heir --actor …`, which Task 4 already built. It stays green, and becomes this task's pin against mapping every `bad-session` to 409.

- [ ] **Step 3: `reclaim.ts`: the import, the widened member, the ladder bullet and the stored-claimant check**

3a. The import (skip if Step 0 (l) read 0 because Task 4 already imports it). Before:

```ts
import { lifecycleIsDead, sessionLifecycle, type SessionLifecycle } from '../../../shared/api.js';
```

After:

```ts
import { isRegistryId, lifecycleIsDead, sessionLifecycle, type SessionLifecycle } from '../../../shared/api.js';
```

3b. The member. Locate it with `grep -n "kind: 'bad-session'; which: 'heir'" server/src/coord/reclaim.ts`. Replace that member's line and the three `//` comment lines Task 4 put directly above it (the first begins `// path identity (spec §2.3): an id`) with the lines below. Task 4 left the member as the union's last, so the new member line ends with `;`, as shown.

```ts
  /** spec §2.3. `which` names the side that is not a registry id. `heir` is this
   *  request's `claimedBy`, refused by `readSessionRecord`'s `bad-id` before any
   *  listing; the route answers 400. `claimant` is the run's STORED `claimedBy`,
   *  a row no retry heals; the route answers 409, and `detail` names the abandon
   *  door, the one way to end such a programme. */
  | { ok: false; kind: 'bad-session'; which: 'heir' | 'claimant'; detail: string };
```

3c. The ladder. In `reclaimRun`'s docstring, locate by content. Before:

```ts
 *      D-12 clause skips exactly those rows (store.ts:373-383); adopting one here
 *      would invent an owner for a row that never had one;
```

After:

```ts
 *      D-12 clause skips exactly those rows (store.ts:373-383); adopting one here
 *      would invent an owner for a row that never had one;
 *    • the CLAIMANT'S SHAPE (spec §2.3), deliberately UNNUMBERED like the heir rung
 *      below, so the cited numbers hold: a stored `claimedBy` that is not a registry
 *      id — else `bad-session` with `which: 'claimant'`. It runs before any read,
 *      because such an id is never measured and never composed. A row stored before
 *      `POST /api/runs` asked the predicate is the only way to reach it, and nothing
 *      is re-pointed;
```

3d. The check. Before:

```ts
  const from = run.claimedBy;
  if (from === null) return { ok: false, kind: 'no-claimant' };
```

After:

```ts
  const from = run.claimedBy;
  if (from === null) return { ok: false, kind: 'no-claimant' };
  // spec §2.3: the STORED claimant is asked the one predicate before any read.
  // The heir's own check is `readSessionRecord`'s `bad-id` below, inside the
  // incoming read, and the route head carries no copy that would mask it.
  // Answering this through `measureClaimant` instead would be a 502
  // `registry-unmeasurable` that no retry ever clears.
  if (!isRegistryId(from)) {
    return { ok: false, kind: 'bad-session', which: 'claimant',
      detail: 'the run\'s stored claimedBy is not a registry id, so it is never measured or composed: '
        + 'end the programme by abandoning each of its open runs through POST /api/runs/:id/abandon' };
  }
```

- [ ] **Step 4: `routes.ts`: the import (if needed), `POST /api/runs`'s three checks, and the reclaim arm**

4a. Only if Step 0 (g) printed no import line. Before (inside the `../../../shared/api.js` import):

```ts
  FAILURE_KINDS, ROUTE_CONTROL_CHAR_RE, isSessionIdShape, parseRouteEventDetail, parseRouteFields, routeEventDetail, RUN_STATES, TERMINAL_RUN_STATES,
```

After:

```ts
  FAILURE_KINDS, ROUTE_CONTROL_CHAR_RE, isRegistryId, isSessionIdShape, parseRouteEventDetail, parseRouteFields, routeEventDetail, RUN_STATES, TERMINAL_RUN_STATES,
```

4b. `POST /api/runs`. Before:

```ts
    // `kind`'s own vocabulary was already proven above, before this guard.
    // Each further refusal below names its field so the caller can tell
    // "malformed JSON" from "you sent the wrong thing".
    const runKind: 'work' | 'review' = kind === 'review' ? 'review' : 'work';
```

After:

```ts
    // `kind`'s own vocabulary was already proven above, before this guard.
    // Each further refusal below names its field so the caller can tell
    // "malformed JSON" from "you sent the wrong thing".
    //
    // Path identity (spec §2.3). Every id this route stores can later reach an
    // id-taking argv: `wsHold` below, then dispatch, close and the routing door.
    // So each is asked the ONE predicate here, AS GIVEN. `openRun` stores the
    // untrimmed body field, so a padded id is refused rather than stored. These
    // checks stand ahead of the review arm, so a review open with a bad
    // `sessionId` answers `bad-session` before that arm refuses any `sessionId`.
    // The project check is a work run's only: a review run's project is the
    // reviewed run's, compared below. A new row can then never carry a project
    // ccd could read as a flag to `ws-add`.
    if (!isRegistryId(claimedBy)) {
      return reply.code(400).send({ ok: false, error: 'bad-session', detail: 'claimedBy is not a registry id' });
    }
    if (sessionId !== undefined && !isRegistryId(sessionId)) {
      return reply.code(400).send({ ok: false, error: 'bad-session', detail: 'sessionId is not a registry id' });
    }
    if (kind !== 'review' && /^[-.]/.test(body.project as string)) {
      return reply.code(400).send({ ok: false, error: 'bad-request', detail: 'project must not begin with - or .' });
    }
    const runKind: 'work' | 'review' = kind === 'review' ? 'review' : 'work';
```

4c. The reclaim arm. Inside the `switch (r.kind) {` that follows `const r = await coordMutex.run(() => reclaimRun(reclaimDeps, id, to));`, Task 4 wrote one `case 'bad-session':` arm that answers 400 (Step 0 (f)). Its expected shape is:

```ts
      case 'bad-session':
        return reply.code(400).send({ ok: false, error: 'bad-session', detail: r.detail });
```

Replace that arm, together with any comment Task 4 placed directly above it, with:

```ts
      // spec §2.3: `which` names the side that is not a registry id. The HEIR is
      // this request's own value, so 400. The stored CLAIMANT is a row no retry
      // heals, so 409, and its detail names the abandon door. Nothing was re-pointed.
      case 'bad-session':
        return reply.code(r.which === 'claimant' ? 409 : 400).send({ ok: false, error: 'bad-session', detail: r.detail });
```

- [ ] **Step 5: `run-route-route.test.ts`: seed the bad claimant through the store.** `POST /api/runs` now refuses `'bad claimant'` at the door. The routing door still guards a STORED row that predates that gate, which is what the case's title means. Before:

```ts
    const w = await openApp(home, run, { fleetState: ROUTE_READY_FLEET }); app = w.app;
    const opened = (await postOpen(w.app, { ...OPEN_BODY, claimedBy: 'bad claimant' })).json() as { id: number };
```

After:

```ts
    const w = await openApp(home, run, { fleetState: ROUTE_READY_FLEET }); app = w.app;
    // Seeded through the STORE: since path identity W1a, `POST /api/runs` refuses
    // this claimedBy at the door (spec §2.3). Such a row now exists only as a
    // stored row that predates that gate, which is the case this door still guards.
    const seeded = w.coord.openRun({ program: 'build4', title: 'Routing door', project: PROJECT,
      wave: 1, waveOf: 3, claimedBy: 'bad claimant', homeProject: PROJECT });
    if (!('id' in seeded)) throw new Error(`fixture openRun refused: ${JSON.stringify(seeded)}`);
    const opened = { id: seeded.id };
```

The case's remaining lines (`postRoute(w.app, opened.id, …)`, its three `expect`s) are unchanged.

- [ ] **Step 6: Run the new file, the rewritten case and the type-check**

```bash
cd server && ./node_modules/.bin/vitest run test/run-open-registry-id.test.ts test/run-route-route.test.ts test/single-read-bad-id.test.ts
cd server && ./node_modules/.bin/tsc --noEmit -p .
cd server && ./node_modules/.bin/vitest run test/typecheck-tests.test.ts
```

Expected: PASS, and tsc prints nothing. The widened `which` changes no exhaustive switch, because `bad-session` is still one `kind`.

- [ ] **Step 7: Mutation table.**
- Apply each mutation alone, run its command from `server/`, see the red, then revert the edit by hand.
- The task is still uncommitted, so never `git checkout` a file to revert it.
- Before the first mutation, record `git diff --stat`. After each revert, it must print the same lines.
- The red texts were drafted, not measured. Record each measured text in the SDD ledger, with its before and after.

| # | Mutation (exact edit) | Command | Expected red |
|---|---|---|---|
| T9.1 | `routes.ts` `POST /api/runs`: delete the `if (!isRegistryId(claimedBy)) { … }` block | `./node_modules/.bin/vitest run test/run-open-registry-id.test.ts` | the 10 `claimedBy %s` rows and the padded case: `expected 200 to be 400`, with a run row written |
| T9.2 | delete the `if (sessionId !== undefined && !isRegistryId(sessionId)) { … }` block | same | the 10 `sessionId %s` rows: `expected 409 to be 400` (`spent-unmeasured`, from `childBindGate`'s `bad-id`, Task 4); the review case: `toEqual` received `error: 'bad-request'` with the review arm's detail |
| T9.3 | delete the `if (kind !== 'review' && /^[-.]/.test(…)) { … }` block | same | the 4 project rows: `expected 200 to be 400`, with a run row whose project is `-x` |
| T9.4 | `reclaim.ts`: delete the `if (!isRegistryId(from)) { … }` block | same | `a stored claimedBy of --actor …`: `expected 502 to be 409` (`registry-unmeasurable`, `measureClaimant`'s `bad-id`) |
| T9.5 | `routes.ts` reclaim arm: `reply.code(r.which === 'claimant' ? 409 : 400)` becomes `reply.code(400)` | same | `a stored claimedBy of --actor …`: `expected 400 to be 409` |
| T9.6 | `routes.ts` reclaim arm: `reply.code(r.which === 'claimant' ? 409 : 400)` becomes `reply.code(409)` | same | `the heir --actor …`: `expected 409 to be 400` |
| T9.7 | `reclaim.ts`: move the `if (!isRegistryId(from)) { … }` block from after `no-claimant` to directly before `if (to !== from) {` (after the heir's read) | same | `a stored claimedBy of --actor …`: `expected 1 to be 0` (a listing was spent before the refusal) |
| T9.8 | `routes.ts`: `isRegistryId(claimedBy)` becomes `isRegistryId(claimedBy.trim())` | same | `a padded claimedBy …`: `expected 200 to be 400` |

Revert each mutation, then re-run Step 6's commands: green.

- [ ] **Step 8: The task's other suites and guards**

```bash
cd server && ./node_modules/.bin/vitest run test/run-routes.test.ts test/run-route-route.test.ts test/reclaim-route.test.ts test/coord-reclaim.test.ts test/home-project-required.test.ts
cd server && ./node_modules/.bin/vitest run test/mail-routes.test.ts test/single-definition.test.ts test/unattended-actor.test.ts test/verb-gate.test.ts
```

Expected: PASS. In particular:
- `mail-routes`' kebab scan stays green. This task adds no quoted kebab token: `'bad-session'` and `'bad-request'` already pass, and `'heir'` and `'claimant'` are one word each.
- `single-definition`'s `REDERIVED` scan stays green, because the project check never names `isSessionIdShape`.
- `run-routes` opens every run with registry-shaped ids.

If a test outside this list posts a non-registry `claimedBy` or `sessionId` through `POST /api/runs` and goes red, re-seed it through `coord.openRun` and keep its title's intent, as Step 5 does. Record it in the ledger, and add its file to Step 9's `git add`.

- [ ] **Step 9: Commit**

```bash
git add server/src/coord/routes.ts server/src/coord/reclaim.ts server/test/run-route-route.test.ts server/test/run-open-registry-id.test.ts
git commit -F - <<'EOF'
fix(coord): POST /api/runs and the reclaim door refuse a non-registry id

POST /api/runs stores claimedBy and sessionId, and both later reach an
id-taking argv: ws-hold at the open, then dispatch, close and the routing
door. Each is now asked the one registry id predicate, as given and
untrimmed, the way the store keeps it, and a failure answers 400
bad-session naming the field. A work run's project that begins with - or
. answers 400 bad-request. The checks stand ahead of the review arm, so a
review open with a bad sessionId answers bad-session first.

The reclaim door's outcome now says which side failed. The heir, this
request's own value, answers 400. A stored claimant that is not a registry
id answers 409 before any read, with a detail naming the abandon door,
and nothing is re-pointed. Every valid id meets the door exactly as
before.

The routing door's bad-claimant case now seeds its row through the store,
since the open route refuses that id at the door.
EOF
```

---

### Task 10: The routing door

**Model routing:** `sonnet`, effort `high`.

**Why:**
- `POST /api/runs/:id/route` composes `CCD_ARGV.route(sid, …)` or `CCD_ARGV.routeSet(sid, …)`. Here `sid` is a STORED `run.sessionId` (the worker target) or a stored `run.claimedBy` (the coordinator target).
- Today the door checks `sid` with `isSessionIdShape`. That accepts `--actor`, because `SESSION_ID_SEGMENT` is `[A-Za-z0-9._-]+`. So a stored `--actor` reaches `route --session --actor`. ccd's `route` consumes each key with its value atomically (spec §2.1), so it binds `--actor` whole and nothing redirects today; the door is gated because spec §2.3 puts every stored-row argv seam behind the one predicate.
- Task 9's `POST /api/runs` check covers new rows only. A row written before that check still stands, so the door re-checks what it reads.
- **The change:** the same 409 `bad-session`, now decided by `isRegistryId` (spec §2.3). No new word, no new route, no wire change.
- **What the tests must do:**
  - The door reads the routing fields itself, through `fieldMeasured` on `$REG/<sid>.<field>`, never through `readRegistry`. So Task 5's omission of refused rows does not stand behind it.
  - A manual-field write reads no field at all.
  - So every `--actor` case plants `--actor`'s row (`.uuid` and the rest), plus `.class` and `.effort`, and advertises `ROUTE_CAP`. Then only the predicate can refuse.

**Entry:** Tasks 1, 2, 3 and 9 are committed on this branch:
- Task 1: `isRegistryId` and `server/test/registryIdCases.ts`;
- Tasks 2 and 3: `server/test/idGateFixture.ts`, with `seedRow`, `recorder`, `appFor` and `storedRun`;
- Task 9: `run-route-route.test.ts`'s `'bad claimant'` case opens through the store.

Step 0 measures all of them.

**Files:**
- Modify `server/src/coord/routes.ts`, inside `app.post('/api/runs/:id/route'`:
  - The gate. Locate it by `grep -n "if (!isSessionIdShape(sid)) {" server/src/coord/routes.ts` (`:2021` at `837a099c0`).
    - `if (!isSessionIdShape(sid)) {` becomes `if (!isRegistryId(sid)) {`.
    - The 409 `{ ok: false, error: 'bad-session' }` body stays byte for byte.
  - The comment directly above the gate: the eleven lines that begin `// Fix round 1, finding #2: \`sid\` comes off \`run.sessionId\`/` are rewritten to name the new rule. Step 3 (b).
  - The `../../../shared/api.js` import block (`:48` at `837a099c0`, the line `FAILURE_KINDS, ROUTE_CONTROL_CHAR_RE, isSessionIdShape, parseRouteEventDetail, …`).
    - `isSessionIdShape` leaves the import. Nothing else in `server/src` uses it after this edit; Step 0 measures that.
    - `isRegistryId` joins the import only if Tasks 7 and 9 have not already added it. Step 3 (a).
  - Nothing else in the file changes.
- Create `server/test/run-route-registry-id.test.ts`.
- No other file changes. Leave `run-route-route.test.ts` alone: its two `bad-session` cases use ids with a space (`'bad claimant'`, `'bad worker'`), which both predicates refuse, so they stay green unedited.

**Interfaces:**
- Consumes:
  ```ts
  // shared/api.ts foot block (Task 1)
  export function isRegistryId(id: unknown): id is string;
  // server/test/registryIdCases.ts (Task 1)
  export const REFUSED_IDS: readonly string[];   // REDIRECT_IDS, then '.hidden' and 'x'.repeat(256)
  // server/test/idGateFixture.ts (Task 2; storedRun from Task 3)
  export function seedRow(home: string, id: string, fields?: Record<string, string>): void;
  export function recorder(cfg?: { fail?: ReadonlySet<string> }): { run: Runner; calls: string[][] };
  export function appFor(home: string, run: Runner, over?: Partial<Omit<Deps, 'cfg'>>): Promise<{ app: FastifyInstance; coord: CoordStore; cfg: CcrcConfig }>;
  export function storedRun(coord: CoordStore, r: { state: RunState; sessionId: string | null; claimedBy: string; kind?: 'work' | 'review'; reviews?: number }): number;
  // existing at 837a099c0
  ROUTE_CAP          // server/src/ccdargv.ts   grep -n "^export const ROUTE_CAP" server/src/ccdargv.ts        ('route-v1')
  ACTOR_FLAGS_CAP    // server/src/ccdargv.ts   grep -n "^export const ACTOR_FLAGS_CAP" server/src/ccdargv.ts  ('actor-flags-v1')
  CoordStore.runEvents(runId: number): { at: number; fromState: string; toState: string; causedBy: string; detail: string | null }[];
  mkTmp(prefix: string): string   // server/test/tmpHelpers.ts
  ```
- Produces no new name.
  - The route's existing answer, 409 `{ ok: false, error: 'bad-session' }`, is now decided by `isRegistryId(sid)` (the Interfaces answers table, row `POST /api/runs/:id/route`).
  - `isSessionIdShape` keeps its definition and its other callers in `shared/api.ts`, `isRegistryId` among them.

- [ ] **Step 0: Measure the entry conditions (nothing is written)**

Run from the workspace root:

```bash
grep -c "if (!isSessionIdShape(sid)) {" server/src/coord/routes.ts                                   # (c11) 1
grep -n "isSessionIdShape" server/src/coord/routes.ts                                                # two lines: the import (:48) and the gate (:2021)
grep -rn "isSessionIdShape" server/src --include=*.ts | wc -l                                        # 3: the same two lines, plus one prose mention in coord/store.ts's docstring (outside this wave's boundary); no other code use
grep -c "^export function isRegistryId(id: unknown): id is string {$" shared/api.ts                  # 1 (Task 1)
grep -c "^export const REFUSED_IDS" server/test/registryIdCases.ts                                   # 1 (Task 1)
grep -cE "^export (async )?function (seedRow|recorder|appFor|storedRun)\b" server/test/idGateFixture.ts   # 4 (Tasks 2 and 3)
grep -c "openRun" server/test/run-route-route.test.ts                                                # >= 1: Task 9 seeds 'bad claimant' through the store
node -e 'const s=require("fs").readFileSync("server/src/coord/routes.ts","utf8");const end=s.indexOf("} from '"'"'../../../shared/api.js'"'"';");console.log(end>0&&/\bisRegistryId\b/.test(s.slice(0,end))?"imported":"not-imported")'   # "imported" after Tasks 7 and 9; decides Step 3 (a)
```

**What to do with the results:**
- If (c11) prints 0, the gate site has moved. STOP and report `gate-site-moved`.
- If a count or line number differs only because #351 or run 400 has landed, re-point by content and record it in the SDD ledger.
- If `isSessionIdShape` has a use in `server/src` beyond those three lines, keep it in `routes.ts`'s import only when that use is code in `routes.ts`. Record it.
- If any of the Task 1/2/3 counts is 0, a prior task is not on this branch. STOP and report `tree-not-ready`.

- [ ] **Step 1: Write the failing test**

Create `server/test/run-route-registry-id.test.ts`:

```ts
// Path identity W1a, Task 10 (spec §2.3): the routing door re-checks the id it
// READS OFF A STORED RUN ROW with THE registry-id predicate, `isRegistryId`,
// before it reads a routing field, composes a `route` argv or writes a `route:`
// event. The check it replaces, `isSessionIdShape`, admits `--actor`.
//
// The door reads `.class`/`.effort`/`.degraded` through `fieldMeasured` on
// `$REG/<sid>.<field>` directly, never through `readRegistry`, so a refused
// registry row is NOT omitted in front of it. A manual-field write reads no
// field at all. So every `--actor` case below plants `--actor`'s row (and the
// two fields the ladder reads) and advertises `ROUTE_CAP`: with the gate
// gone, each case composes `route --session --actor` and answers 200. Only
// the predicate can refuse.
import { describe, it, expect, afterEach } from 'vitest';
import { existsSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { FastifyInstance } from 'fastify';
import { ACTOR_FLAGS_CAP, ROUTE_CAP } from '../src/ccdargv.js';
import type { CoordStore } from '../src/coord/store.js';
import { mkTmp } from './tmpHelpers.js';
import { appFor, recorder, seedRow, storedRun } from './idGateFixture.js';
import { REFUSED_IDS } from './registryIdCases.js';

const TOKEN = 'f'.repeat(64);
const COORDINATOR = 'demo-coordinator';

/** `capSupported(ROUTE_CAP)` passes, so the door's 501 cannot answer first, and
 *  `sweepDec` composes `--actor run:<id> coordinator`: the argv shape
 *  `run-route-route.test.ts` pins. */
const ROUTE_READY_FLEET = {
  connected: true, downSince: null, rosterFp: null, build: null,
  ccdVerbs: [ROUTE_CAP, ACTOR_FLAGS_CAP] as string[],
};

const ESCALATE = { why: 'checks failed', kind: 'shallow' } as const;
const MANUAL = { why: 'operator judgement', field: 'subagent', value: 'opus' } as const;

interface Rig {
  app: FastifyInstance;
  coord: CoordStore;
  home: string;
  registryDir: string;
  calls: string[][];
}

async function rig(): Promise<Rig> {
  const home = mkTmp('ccrc-route-id-');
  const { run, calls } = recorder();
  const { app, coord, cfg } = await appFor(home, run, { mailToken: TOKEN, fleetState: ROUTE_READY_FLEET });
  return { app, coord, home, registryDir: cfg.registryDir, calls };
}

/** Plants `id`'s registry row and the two fields the ladder reads (opus·high),
 *  so the door would route it if nothing but the predicate stood in the way. */
function plantRoutable(w: Rig, id: string): void {
  seedRow(w.home, id);
  writeFileSync(path.join(w.registryDir, `${id}.class`), 'opus');
  writeFileSync(path.join(w.registryDir, `${id}.effort`), 'high');
  expect(existsSync(path.join(w.registryDir, `${id}.uuid`)), `setup: ${id}'s row is planted where the server reads`)
    .toBe(true);
}

const postRoute = (app: FastifyInstance, id: number, body: Record<string, unknown>) =>
  app.inject({
    method: 'POST', url: `/api/runs/${id}/route`,
    headers: { 'x-ccrc-mail-token': TOKEN }, payload: body,
  });

const routeCalls = (calls: string[][]): string[][] => calls.filter((c) => c[0] === 'route');

const routeEvents = (coord: CoordStore, id: number): string[] =>
  coord.runEvents(id).map((e) => e.detail ?? '').filter((d) => d.startsWith('route:'));

describe('the routing door refuses a stored id that is not a registry id (spec §2.3)', () => {
  let app: FastifyInstance | undefined;
  afterEach(async () => { if (app) await app.close(); app = undefined; });

  it('the coordinator target with a stored claimedBy of --actor answers 409 bad-session', async () => {
    const w = await rig(); app = w.app;
    plantRoutable(w, '--actor');
    const id = storedRun(w.coord, { state: 'working', sessionId: null, claimedBy: '--actor' });

    const res = await postRoute(w.app, id, { target: 'coordinator', ...ESCALATE });
    expect(res.statusCode).toBe(409);
    expect(res.json()).toEqual({ ok: false, error: 'bad-session' });
    expect(routeCalls(w.calls), 'no route argv is composed').toEqual([]);
    expect(routeEvents(w.coord, id), 'no route: event is written').toEqual([]);
  });

  it('the worker target with a stored sessionId of --actor answers 409 bad-session', async () => {
    const w = await rig(); app = w.app;
    plantRoutable(w, '--actor');
    const id = storedRun(w.coord, { state: 'working', sessionId: '--actor', claimedBy: COORDINATOR });

    const res = await postRoute(w.app, id, { target: 'worker', ...ESCALATE });
    expect(res.statusCode).toBe(409);
    expect(res.json()).toEqual({ ok: false, error: 'bad-session' });
    expect(routeCalls(w.calls), 'no route argv is composed').toEqual([]);
    expect(routeEvents(w.coord, id), 'no route: event is written').toEqual([]);
  });

  it('a manual-field write to a stored --actor answers 409 bad-session', async () => {
    const w = await rig(); app = w.app;
    plantRoutable(w, '--actor');
    const id = storedRun(w.coord, { state: 'working', sessionId: '--actor', claimedBy: COORDINATOR });

    const res = await postRoute(w.app, id, { target: 'worker', ...MANUAL });
    expect(res.statusCode).toBe(409);
    expect(res.json()).toEqual({ ok: false, error: 'bad-session' });
    expect(routeCalls(w.calls), 'no route argv is composed').toEqual([]);
    expect(routeEvents(w.coord, id), 'no route: event is written').toEqual([]);
  });

  // Every refused id, as a stored worker id, on the one path that reads no
  // registry field: a manual write. No row is planted, because `'x'.repeat(256)`
  // plus `.uuid` is longer than a file name may be, and a manual write would not
  // read one anyway.
  it.each(REFUSED_IDS)('a manual-field write to a stored sessionId of %j answers 409 bad-session', async (bad) => {
    const w = await rig(); app = w.app;
    const id = storedRun(w.coord, { state: 'working', sessionId: bad, claimedBy: COORDINATOR });

    const res = await postRoute(w.app, id, { target: 'worker', ...MANUAL });
    expect(res.statusCode).toBe(409);
    expect(res.json()).toEqual({ ok: false, error: 'bad-session' });
    expect(routeCalls(w.calls), 'no route argv is composed').toEqual([]);
    expect(routeEvents(w.coord, id), 'no route: event is written').toEqual([]);
  });

  it('control: a stored a--actor routes', async () => {
    const w = await rig(); app = w.app;
    plantRoutable(w, 'a--actor');
    const id = storedRun(w.coord, { state: 'working', sessionId: 'a--actor', claimedBy: COORDINATOR });

    const res = await postRoute(w.app, id, { target: 'worker', ...ESCALATE });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({
      ok: true,
      applied: { session: 'a--actor', mode: 'escalate', field: 'effort', from: 'high', to: 'xhigh', kind: 'shallow', effortReset: null },
    });
    expect(routeCalls(w.calls)).toEqual([
      ['route', '--session', 'a--actor', '--set', 'effort=xhigh', '--actor', `run:${id} coordinator`,
        '--reason', 'escalate shallow: checks failed'],
    ]);
    expect(routeEvents(w.coord, id)).toEqual(['route:escalate:effort:high->xhigh:shallow:a--actor']);
  });

  it('control: a stored coordinator a.--actor routes', async () => {
    const w = await rig(); app = w.app;
    plantRoutable(w, 'a.--actor');
    const id = storedRun(w.coord, { state: 'working', sessionId: null, claimedBy: 'a.--actor' });

    const res = await postRoute(w.app, id, { target: 'coordinator', ...ESCALATE });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({
      ok: true,
      applied: { session: 'a.--actor', mode: 'escalate', field: 'effort', from: 'high', to: 'xhigh', kind: 'shallow', effortReset: null },
    });
    expect(routeCalls(w.calls)).toEqual([
      ['route', '--session', 'a.--actor', '--set', 'effort=xhigh', '--actor', `run:${id} coordinator`,
        '--reason', 'escalate shallow: checks failed'],
    ]);
    expect(routeEvents(w.coord, id)).toEqual(['route:escalate:effort:high->xhigh:shallow:a.--actor']);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
cd server && ./node_modules/.bin/vitest run test/run-route-registry-id.test.ts
```

Run it in the foreground, with a timeout of at least 600000 ms.

**Expected: FAIL, 13 failed and 2 passed.**
- Failing: the three `--actor` cases and all ten `REFUSED_IDS` rows. Each reads `expected 200 to be 409 // Object.is equality`, because `isSessionIdShape` admits every one of these ids.
- Passing: the two controls.

If a control fails, the rig does not route a valid id. Fix the rig before going on, and never the door: check `recorder()`'s answer for `route` and `appFor`'s handling of `fleetState`/`mailToken`.

- [ ] **Step 3: Implement**

(a) **The import** in `server/src/coord/routes.ts`. Locate it with `grep -n "ROUTE_CONTROL_CHAR_RE, isSessionIdShape, parseRouteEventDetail" server/src/coord/routes.ts`.

Before:
```ts
  FAILURE_KINDS, ROUTE_CONTROL_CHAR_RE, isSessionIdShape, parseRouteEventDetail, parseRouteFields, routeEventDetail, RUN_STATES, TERMINAL_RUN_STATES,
```

After, when Step 0's `node -e` printed `imported` (Tasks 7 and 9 already brought `isRegistryId` into this block):
```ts
  FAILURE_KINDS, ROUTE_CONTROL_CHAR_RE, parseRouteEventDetail, parseRouteFields, routeEventDetail, RUN_STATES, TERMINAL_RUN_STATES,
```

After, when it printed `not-imported`:
```ts
  FAILURE_KINDS, ROUTE_CONTROL_CHAR_RE, isRegistryId, parseRouteEventDetail, parseRouteFields, routeEventDetail, RUN_STATES, TERMINAL_RUN_STATES,
```

(b) **The gate and its comment.** Locate them with `grep -n "// Fix round 1, finding #2: \`sid\` comes off" server/src/coord/routes.ts`.

Before:
```ts
      // Fix round 1, finding #2: `sid` comes off `run.sessionId`/
      // `run.claimedBy` (`POST /api/runs` shape-checks `claimedBy`/
      // `sessionId` only for "non-empty string", no charset guard), but
      // `routeEventDetail` below embeds `sid` unescaped as the sixth segment
      // of a `:`-delimited grammar that `ROUTE_EVENT_DETAIL_RE`'s own group
      // accepts only `[A-Za-z0-9._-]+` for. Refuse the bad shape HERE, before
      // ever building an argv or writing an event this door's own reader
      // would later refuse to parse back — `no-session` (nothing to route
      // to) and `bad-session` (something to route to, but not a name this
      // door can safely write) are two different conditions and must not
      // collapse to one refusal.
      if (!isSessionIdShape(sid)) {
        return reply.code(409).send({ ok: false, error: 'bad-session' });
      }
```

After:
```ts
      // The stored id is re-checked HERE, before any field read, argv or
      // event (spec §2.3). `sid` comes off `run.sessionId`/`run.claimedBy`,
      // a STORED row: `POST /api/runs` now refuses a `claimedBy` or
      // `sessionId` that is not a registry id, but a row written before that
      // check can still hold one, so this door asks again rather than
      // trusting the open. The rule is THE registry-id predicate,
      // `isRegistryId` (`shared/api.ts`): the session-id shape, no leading
      // `-` or `.`, and at most 255 characters. Fix round 1, finding #2
      // checked the SHAPE alone, because `routeEventDetail` below embeds
      // `sid` unescaped as the sixth segment of a `:`-delimited grammar whose
      // `ROUTE_EVENT_DETAIL_RE` group accepts only `[A-Za-z0-9._-]+`. The
      // predicate keeps that guarantee and closes what the shape let through:
      // a stored `--actor` would reach `CCD_ARGV.route`/`routeSet` as
      // `route --session --actor`, an id the one predicate refuses (spec §2.3).
      // A manual-field write reads no registry field, so nothing but this
      // check stands between a bad stored id and that argv. `no-session`
      // (nothing to route to) and `bad-session` (something to route to, but
      // not a name this door can safely write or compose) are two different
      // conditions and must not collapse to one refusal.
      if (!isRegistryId(sid)) {
        return reply.code(409).send({ ok: false, error: 'bad-session' });
      }
```

(c) **Confirm the edit:**

```bash
grep -c "if (!isRegistryId(sid)) {" server/src/coord/routes.ts          # 1
grep -c "isSessionIdShape" server/src/coord/routes.ts                   # 0
grep -rn "isSessionIdShape" server/src --include=*.ts | wc -l           # 1: coord/store.ts's docstring prose only; no code use remains
git diff --stat                                                         # server/src/coord/routes.ts only (the new test is untracked)
```

- [ ] **Step 4: Run the tests to verify they pass**

```bash
cd server && ./node_modules/.bin/vitest run test/run-route-registry-id.test.ts
cd server && ./node_modules/.bin/vitest run test/run-route-route.test.ts test/run-route-session-trail.test.ts test/run-signals-routing.test.ts
cd server && ./node_modules/.bin/vitest run test/mail-routes.test.ts test/unattended-actor.test.ts test/verb-gate.test.ts test/single-definition.test.ts
```

**Expected: every file PASSES.** Run each line in the foreground, with a timeout of at least 600000 ms.
- `run-route-registry-id`: 15 passed.
- `run-route-route`: both of its `bad-session` cases stay green. Their ids hold a space, which `isRegistryId` refuses just as the shape did.
- `mail-routes`: green with no edit. `'bad-session'` is already a declared word.
- `single-definition`: the `REDERIVED` scan sees no line that combines the shape with a leading-character test.

If a file reds, re-run a CLAUDE.md load flake in isolation before calling it a break.

Four prose texts outside this edit still name `isSessionIdShape` as the door's check, or say `POST /api/runs` has no charset guard: the docstring above `SESSION_ID_SEGMENT` in `shared/api.ts` (above the foot block), `coord/store.ts`'s docstring (never edited), the comment above `run-signals-routing.test.ts`'s `describe('isSessionIdShape (shared/api.ts)'`, and the comment above `run-route-route.test.ts`'s `'bad claimant'` case. Each stays true in substance, because `isRegistryId` includes the shape check. Leave them unedited. Record the slug `door-check-prose-names-the-shape` in the SDD ledger, naming the four, so that Task 16 lists it under the departures recorded while building.

- [ ] **Step 5: Mutation check**

Make each edit, run it, see the red, and undo the edit by hand before the next one. Never use `git checkout -- server/src/coord/routes.ts`: this task's change is not committed yet, and a checkout would discard it.

The commands run from `server/`:
- T is `./node_modules/.bin/vitest run test/run-route-registry-id.test.ts`;
- R is `./node_modules/.bin/vitest run test/run-route-route.test.ts -t 'bad-session'`.

The worker measures every red text. Where the measured text differs, it replaces the draft's. Record each row's before and after in the SDD ledger.

| # | Mutation (exact edit in `server/src/coord/routes.ts`) | Command | Expected red |
|---|---|---|---|
| 1 | Revert to the shape check: `if (!isRegistryId(sid)) {` becomes `if (!isSessionIdShape(sid)) {`, and `isSessionIdShape, ` goes back into the `shared/api.js` import after `ROUTE_CONTROL_CHAR_RE, ` (without the import, the mutant throws a ReferenceError and answers 500 rather than reproducing the old door) | T | 13 failed: the coordinator, worker and manual-field `--actor` cases, and every `REFUSED_IDS` row, each `expected 200 to be 409 // Object.is equality`. With the status assertion skipped, the `route` argv names `--actor` (`[ [ 'route', '--session', '--actor', '--set', 'effort=xhigh', … ] ]`). The two controls stay green. |
| 2 | Delete the gate (its three lines `if (!isRegistryId(sid)) {` … `}`) | T, then R | T: the same 13, `expected 200 to be 409`. R: `'bad claimant'` (coordinator target, no row) answers `{ ok: false, error: 'no-record', field: 'class' }`, so `expected { …(3) } to deeply equal { ok: false, error: 'bad-session' }`. `'bad worker'` (fields planted) gives `expected 200 to be 409`. |

After the last row:

```bash
grep -c "if (!isRegistryId(sid)) {" server/src/coord/routes.ts   # 1
grep -c "isSessionIdShape" server/src/coord/routes.ts            # 0
```

Then re-run T: 15 passed.

- [ ] **Step 6: Typecheck**

```bash
cd server && ./node_modules/.bin/tsc --noEmit -p . && ./node_modules/.bin/tsc --noEmit -p test/tsconfig.tests.json
cd server && ./node_modules/.bin/vitest run test/typecheck-tests.test.ts
```

**Expected:** no output from either `tsc`, and `typecheck-tests` passes.
- `tsc` does not report an unused import (the server tsconfig sets no `noUnusedLocals`), so a skipped Step 3 (a) shows only in Step 3 (c): `grep -c "isSessionIdShape" server/src/coord/routes.ts` must print 0.
- `Cannot find name 'isRegistryId'` means the `not-imported` arm was needed.

- [ ] **Step 7: Commit**

```bash
git add server/src/coord/routes.ts server/test/run-route-registry-id.test.ts
git commit -m "$(cat <<'MSG'
fix(coord): the routing door asks isRegistryId of a stored id

POST /api/runs/:id/route reads the id it routes off a stored run row:
run.sessionId for the worker target, run.claimedBy for the coordinator.
It checked that id with isSessionIdShape, which admits --actor, so a
stored --actor reached CCD_ARGV.route and routeSet as
"route --session --actor". The door now asks isRegistryId, the one
registry-id predicate, and answers the same 409 bad-session.

The door reads its routing fields through fieldMeasured, never through
readRegistry, and a manual-field write reads none, so the new cases
plant the refused row and its fields and advertise route-v1: only the
predicate can refuse. Every refused id is pinned on the manual-field
path. Controls: a stored a--actor worker and a stored a.--actor
coordinator still route. isSessionIdShape leaves this file's import;
nothing else in server/src used it.

Spec §2.3.
MSG
)"
```

---

### Task 11: The advance gate

**Model routing:** `sonnet`, effort `high`.

**Why:**
- **Spec §2.3 and R98.** Every stored `sessionId` that can reach an id-taking `CCD_ARGV` builder is checked where the stored row enters the id-taking flow, before any builder is built.
  - `POST /api/runs/:id/advance` toward `awaiting-review` or `merging` runs `verifyDone`, which composes `CCD_ARGV.prStateSession(run.sessionId)`.
  - The POST gate (Task 9) does not cover this, because coord.db rows written before it existed are not re-checked.
- **R11.** The gate is the first statement inside the forward block, `if (to === 'awaiting-review' || to === 'merging') {`, and nowhere else.
  - Retreating to `working` composes no argv, so a legacy row can still be sent back.
  - The gate must sit outside `verifyDone` (seams trap 4). A refusal from inside `verifyDone` would be a `DoneRejectCode`, which records a rejection and queues `wave-advance-rejected` mail to the bad id.
- **The answer** (Interfaces, R13): 409 `{ ok: false, reject: { code: 'bad-session' } }`. Every advance refusal is carried on `reject.code`. `'bad-session'` is already declared (`isRunRouteRefuseCode`), so the kebab scan stays green.

**Entry:** Tasks 1 to 10 are committed on this branch:
- Task 1 provides `isRegistryId`.
- Task 3 provides `storedRun` in `server/test/idGateFixture.ts`.
- Task 6 provides `resolveDoneBranch`'s own check. Without it, mutation row 1 has a different red text.
- Tasks 7, 9 and 10 already import `isRegistryId` into `coord/routes.ts`.

**Files:**
- Modify `server/src/coord/routes.ts`. There is one edit inside `app.post('/api/runs/:id/advance'`: a comment and one guard statement, inserted as the first lines of the block that opens `if (to === 'awaiting-review' || to === 'merging') {`, directly above `const verdict = await verifyDone(`. There is no import edit unless Step 0 finds `isRegistryId` missing from the file's `../../../shared/api.js` import; Step 3 (b) covers that case.
- Create `server/test/advance-registry-id.test.ts`.
- Nothing else. `verifyDone`'s signature line, `fingerprint.ts`, `shared/api.ts` and every other test file stay untouched.

**Interfaces:**
- Consumes:
  ```ts
  // shared/api.ts foot block (Task 1)
  export function isRegistryId(id: unknown): id is string;
  // server/test/idGateFixture.ts (Tasks 2 and 3)
  export function seedRow(home: string, id: string, fields?: Record<string, string>): void;
  export function recorder(cfg?: { fail?: ReadonlySet<string> }): { run: Runner; calls: string[][] };
  export function appFor(home: string, run: Runner, over?: Partial<Omit<Deps, 'cfg'>>): Promise<{ app: FastifyInstance; coord: CoordStore; cfg: CcrcConfig }>;
  export function storedRun(coord: CoordStore, r: { state: RunState; sessionId: string | null; claimedBy: string; kind?: 'work' | 'review'; reviews?: number }): number;
  // existing
  okRun(r: RunReadResult): RunRow | null                       // server/test/coordReadHelpers.ts
  mkTmp(prefix: string): string                                // server/test/tmpHelpers.ts
  CoordStore.rejections(), CoordStore.mailForRecipient(toId, limit?), CoordStore.setCaps(next, at?)
  ```
- Produces: the 409 `{ ok: false, reject: { code: 'bad-session' } }` answer on a forward advance whose stored `sessionId` fails `isRegistryId`. There is no new name and no new type.

- [ ] **Step 0: Measure the entry conditions (nothing is written)**

Run from the workspace root:

```bash
grep -n "if (to === 'awaiting-review' || to === 'merging') {" server/src/coord/routes.ts   # (c14) one line (1865 at 837a099c0; Tasks 7, 9, 10 move it)
grep -n "const verdict = await verifyDone(" server/src/coord/routes.ts                       # one line, the line after (c14): advance's call (close's own call is in coord/close.ts)
grep -n "isRegistryId" server/src/coord/routes.ts                                            # >= 2: one import line from ../../../shared/api.js, plus the gates of Tasks 7, 9 and 10
grep -n "^export function isRegistryId(id: unknown): id is string {" shared/api.ts           # one line (Task 1)
grep -n "isRegistryId(run.sessionId)" server/src/coord/fingerprint.ts                        # one line (Task 6, resolveDoneBranch's first statement)
grep -n "^export function storedRun\|^export function appFor\|^export function recorder\|^export function seedRow\|^export async function appFor" server/test/idGateFixture.ts   # four lines (Tasks 2 and 3)
ls server/test/advance-registry-id.test.ts 2>/dev/null || echo "absent, as expected"
```

Expected: every grep finds its line, and the new test file is absent.

STOP rules:
- (c14) prints nothing: the forward block is gone or renamed. STOP with `gate-site-moved`.
- `isRegistryId` is not exported from `shared/api.ts`, `idGateFixture.ts` lacks `storedRun`, or `fingerprint.ts` lacks `isRegistryId(run.sessionId)`: the branch is not at Task 10's tip. STOP with `tree-not-ready`.
- The import line is missing while the gates of Tasks 7, 9 and 10 exist: that cannot compile, so re-read the file. If the file truly has no import, Step 3 (b) adds it.
- A different line number is not a departure. Locate by content and record the number in the SDD ledger.

- [ ] **Step 1: Write the failing test**

Create `server/test/advance-registry-id.test.ts`:

```ts
// Path identity W1a, Task 11 (spec §2.3): `POST /api/runs/:id/advance`
// re-checks a STORED sessionId before it re-measures. Moving forward to
// `awaiting-review` or `merging` runs `verifyDone`, which composes
// `pr-state --session <id>`. On a refusal it also records a rejection and
// queues mail to that id. A run row written before `POST /api/runs` checked
// its ids can hold an id that ccd would read as a flag, so the advance gate
// refuses it first, with 409 `reject.code: 'bad-session'`. Retreating to
// `working` composes no argv and is left alone, so such a row can still be
// sent back.
//
// Every case plants `--actor`'s registry row, so that only the gate can
// refuse. Every claim passes `verifyDone`'s two I/O-free checks. With the gate
// deleted, the route therefore reaches the registry step and records its
// refusal, which is the red this file exists to show.
import { describe, it, expect, afterEach } from 'vitest';
import type { FastifyInstance } from 'fastify';
import type { RunState } from '../../shared/api.js';
import { appFor, recorder, seedRow, storedRun } from './idGateFixture.js';
import { okRun } from './coordReadHelpers.js';
import { mkTmp } from './tmpHelpers.js';

const TOKEN = 'f'.repeat(64);
const COORDINATOR = 'ccrc-pwa-coordinator';
const BAD = '--actor';
const SHA = 'a'.repeat(40);
/** handoffCommit === branchTip, both 40-hex, with a recognised prPhase: past
 *  `no-handoff-commit` and `pr-unmeasurable`, so these two checks can never
 *  stand in for the gate. */
const CLAIM = { branchTip: SHA, prNumber: 7, prPhase: 'open', handoffCommit: SHA };

const postAdvance = (app: FastifyInstance, id: number, to: RunState) =>
  app.inject({
    method: 'POST', url: `/api/runs/${id}/advance`,
    headers: { 'x-ccrc-mail-token': TOKEN },
    payload: { to, fingerprint: CLAIM },
  });

describe('advance re-checks the stored session id before it re-measures (spec §2.3)', () => {
  let app: FastifyInstance | undefined;
  afterEach(async () => { if (app) await app.close(); app = undefined; });

  /** One work run, stored on `--actor` in `state` through the store (never
   *  through POST, whose gate would refuse it), with its registry row planted. */
  const rig = async (state: RunState) => {
    const home = mkTmp('ccrc-advance-id-');
    const { run, calls } = recorder();
    const w = await appFor(home, run, { mailToken: TOKEN });
    app = w.app;
    seedRow(home, BAD);
    const id = storedRun(w.coord, { state, sessionId: BAD, claimedBy: COORDINATOR });
    expect(okRun(w.coord.run(id))!.state).toBe(state);
    expect(okRun(w.coord.run(id))!.sessionId).toBe(BAD);
    return { app: w.app, coord: w.coord, calls, id, before: calls.length };
  };

  /** The forward refusal: 409 bad-session, then the four absences (no
   *  rejection, no mail, no move, no argv). The soft assertions report every
   *  absence a mutant breaks, not only the first. */
  const refusedForward = async (from: RunState, to: RunState): Promise<void> => {
    const r = await rig(from);
    const res = await postAdvance(r.app, r.id, to);
    expect(res.statusCode).toBe(409);
    expect.soft(res.json()).toEqual({ ok: false, reject: { code: 'bad-session' } });
    expect.soft(r.coord.rejections()).toEqual([]);
    expect.soft(r.coord.mailForRecipient(BAD)).toEqual([]);
    expect.soft(okRun(r.coord.run(r.id))!.state).toBe(from);
    // No ccd verb at all: no `pr-state --session --actor`, nothing else.
    expect(r.calls.slice(r.before)).toEqual([]);
  };

  it('advancing a --actor run to awaiting-review answers 409 reject bad-session', async () => {
    await refusedForward('working', 'awaiting-review');
  });

  it('the same to merging', async () => {
    await refusedForward('awaiting-review', 'merging');
  });

  it('control: retreating a --actor run to working is unaffected', async () => {
    const r = await rig('awaiting-review');
    // Room for one active run, so that only the gate could refuse this retreat
    // (the re-entry into `working` from an idle state takes the cap check).
    r.coord.setCaps({ maxConcurrentWorkers: 4, maxSessionsPerDay: 12 });
    const res = await postAdvance(r.app, r.id, 'working');
    expect(res.statusCode).toBe(200);
    expect((res.json() as { run: { state: string } }).run.state).toBe('working');
    expect(okRun(r.coord.run(r.id))!.state).toBe('working');
    expect(r.coord.rejections()).toEqual([]);
    expect(r.calls.slice(r.before)).toEqual([]);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
cd server && ./node_modules/.bin/vitest run test/advance-registry-id.test.ts
```

Run it in the foreground, with a timeout of at least 600000 ms.

Expected: `Test Files  1 failed (1)`, `Tests  2 failed | 1 passed (3)`.
- The two refusal cases fail on their soft assertions. Each reports:
  - `expected { ok: false, reject: { code: 'tip-unmeasurable', detail: 'the run\'s session id is not a registry id: it is refused, never read' } } to deeply equal { ok: false, reject: { code: 'bad-session' } }`;
  - `expected [ { …code: 'tip-unmeasurable', toId: '--actor'… } ] to deeply equal []` (the rejection);
  - `expected [ { …subject: 'wave-advance-rejected', toId: '--actor'… } ] to deeply equal []` (the mail).

  Without the gate, Task 6's own check in `resolveDoneBranch` answers first. The route then records the rejection and queues mail to `--actor`, which is exactly what this task prevents.
- The retreat control passes. It is a control, green before and after.

Record the measured texts in the SDD ledger. Where they differ from this draft, the measured text replaces it.

If the refusal cases fail on `expect(res.statusCode).toBe(409)` with `401`, `appFor` did not let `over.mailToken` win. Read `idGateFixture.ts`'s `appFor`, pass the fixture's own token if it exports one, and record `advance-test-token-source` in the wave-done.

- [ ] **Step 3: Implement**

(a) In `server/src/coord/routes.ts`, inside `app.post('/api/runs/:id/advance'`, insert the gate as the first statement of the forward block.

Before:

```ts
    // Forward motion toward a review claim re-measures; retreating to
    // `working` does not — see this route's own docstring.
    if (to === 'awaiting-review' || to === 'merging') {
      const verdict = await verifyDone(
        { io: deps.io, cfg: deps.cfg, runCcd: deps.runCcd, fleetState: deps.fleetState },
        { sessionId: run.sessionId, project: run.project, branch: run.branch ?? '' },
        claim,
      );
```

After:

```ts
    // Forward motion toward a review claim re-measures; retreating to
    // `working` does not — see this route's own docstring.
    if (to === 'awaiting-review' || to === 'merging') {
      // Spec §2.3: a STORED sessionId is re-checked where the row enters an
      // id-taking flow. `verifyDone` composes `pr-state --session <id>`, and a
      // refusal from it records a rejection and queues mail to that id, so
      // this check stands before it and outside it. A row written before
      // POST /api/runs checked its ids can hold an id ccd would read as a
      // flag. Retreating to `working` composes no argv, so such a row can
      // still be sent back: the check guards this block alone.
      if (!isRegistryId(run.sessionId)) return reply.code(409).send({ ok: false, reject: { code: 'bad-session' } });
      const verdict = await verifyDone(
        { io: deps.io, cfg: deps.cfg, runCcd: deps.runCcd, fleetState: deps.fleetState },
        { sessionId: run.sessionId, project: run.project, branch: run.branch ?? '' },
        claim,
      );
```

`run.sessionId` is already narrowed to `string` here by the `if (run.sessionId === null)` return above. The gate is a statement of its own at the block's entry, never on the `verifyDone(` call-site line (Global Constraints, guard placement). `verifyDone`'s signature in `fingerprint.ts` is not touched.

(b) **Only if Step 0 found no `isRegistryId` import in `routes.ts`.** This is not expected, because Tasks 7, 9 and 10 import it. In the `../../../shared/api.js` import, on the line that carries `parseRouteEventDetail, parseRouteFields,`:

Before:

```ts
parseRouteEventDetail, parseRouteFields,
```

After:

```ts
isRegistryId, parseRouteEventDetail, parseRouteFields,
```

The rest of that line is unchanged. If you take (b), record it in the SDD ledger, because it means an earlier task's import landed elsewhere.

- [ ] **Step 4: Run the test to verify it passes**

```bash
cd server && ./node_modules/.bin/vitest run test/advance-registry-id.test.ts
```

Expected: `Test Files  1 passed (1)`, `Tests  3 passed (3)`.

- [ ] **Step 5: Run the task's other suites and guards**

```bash
cd server && ./node_modules/.bin/vitest run test/run-routes.test.ts
cd server && ./node_modules/.bin/vitest run test/mail-routes.test.ts
cd server && ./node_modules/.bin/vitest run test/unattended-actor.test.ts test/verb-gate.test.ts
cd server && ./node_modules/.bin/vitest run test/typecheck-tests.test.ts
```

Run each line in the foreground, with a timeout of at least 600000 ms.

Expected: every file passes.
- `run-routes`: its `POST /api/runs/:id/advance (review findings 1/15)` describe stays green. Its sessions (`demo-adv2`, `demo-adv3`, `demo-reentry`, `demo-start`) are registry ids, so the gate lets them through.
- `mail-routes`: the kebab scan `every quoted kebab token in server/src/coord that looks like a code is declared` stays green, because `'bad-session'` is admitted by `isRunRouteRefuseCode` and the edit adds no other kebab literal.
- `unattended-actor` and `verb-gate`: green. Neither pins the advance block, and the edit adds no `CCD_ARGV` call.
- `typecheck-tests`: green, with the new file typed against the fixture's signatures.

`typecheck-tests` is a known load flake. Re-run it alone before calling a red a break.

- [ ] **Step 6: Mutation check**

Make each edit in `server/src/coord/routes.ts`, run the command from `server/`, see the red, and undo the edit by hand before the next row. Never use `git checkout -- server/src/coord/routes.ts`: this task's change is not committed yet, and a checkout would discard it along with the mutation. Before the first row, record `git diff --stat`; after each undo it must print the same lines. Record each before and after in the SDD ledger. Every red text below is a draft, and the measured text replaces it.

`A` is `./node_modules/.bin/vitest run test/advance-registry-id.test.ts`. `RR` is `./node_modules/.bin/vitest run test/run-routes.test.ts -t 'DOES re-measure'`.

| # | Mutation (exact edit) | Command | Expected red |
|---|---|---|---|
| 1 | Delete the line `if (!isRegistryId(run.sessionId)) return reply.code(409).send({ ok: false, reject: { code: 'bad-session' } });` | `A` | Both refusal cases. `expected { ok: false, reject: { code: 'tip-unmeasurable', detail: … } } to deeply equal { ok: false, reject: { code: 'bad-session' } }`; the rejection, `expected [ { …code: 'tip-unmeasurable'… } ] to deeply equal []`; and the mail queued to `--actor`, `expected [ { …subject: 'wave-advance-rejected'… } ] to deeply equal []`. The control stays green. |
| 2 | Move that line (with its comment) out of the block to directly ABOVE `if (to === 'awaiting-review' \|\| to === 'merging') {`, so it guards every target | `A -t 'retreating'` | `control: retreating a --actor run to working is unaffected`: `expected 409 to be 200`. |
| 3 | Drop the negation: `if (!isRegistryId(run.sessionId))` becomes `if (isRegistryId(run.sessionId))` | `A`, then `RR` | A: both refusal cases, as row 1. RR: `working -> awaiting-review DOES re-measure, and a stale claim is refused (D-6)`, `expected { ok: false, reject: { code: 'bad-session' } } to match object { ok: false, reject: { code: 'stale-tip' } }`. Valid ids are now refused, which is the over-refusal pin. That pin is the existing `run-routes` case, not a new one. |

After row 3, confirm the restore: `git status --short` shows `server/src/coord/routes.ts` modified and `server/test/advance-registry-id.test.ts` untracked (`git diff --stat` never lists an untracked file, so it cannot show the test file), `git diff --stat` prints the lines recorded before row 1, and `server/src/coord/routes.ts` carries only Step 3's edit (`git diff server/src/coord/routes.ts` shows one hunk of eight added lines, plus the one-line import change if Step 3 (b) was taken).

- [ ] **Step 7: Typecheck**

```bash
cd server && ./node_modules/.bin/tsc --noEmit -p . && ./node_modules/.bin/tsc --noEmit -p test/tsconfig.tests.json
```

Expected: no output from either.

- [ ] **Step 8: Commit**

```bash
git add server/src/coord/routes.ts server/test/advance-registry-id.test.ts
git commit -m "$(cat <<'MSG'
fix(coord): advance re-checks the stored session id before verifyDone

POST /api/runs/:id/advance toward awaiting-review or merging runs
verifyDone, which composes pr-state --session <id>. When verifyDone
refuses, the route records a rejection and queues mail to that id. A run
row written before POST /api/runs checked its ids can hold an id that ccd
would read as a flag.

The forward block now asks isRegistryId of the stored sessionId as its
first statement, and answers 409 reject bad-session. Nothing is composed,
recorded or mailed, and the run does not move. Retreating to working
composes no argv and is unchanged, so such a row can still be sent back.

advance-registry-id.test.ts pins both forward targets and the retreat
control on a planted --actor row. Spec §2.3.
MSG
)"
```

If Step 3 (b) was taken, the import line is already part of the `server/src/coord/routes.ts` hunk; there is no other path.

---

### Task 12: The expiry executor boundary

**Model routing:** `sonnet`, effort `high`. Open PR #351 also edits `expireArchived.ts` (R16). Keep this task's change to one import, one module-private constant and two guard statements, so that whichever wave lands second can re-point the change by its content.

**Why:**
- Spec §2.3 names `coord/expireArchived.ts` as a residual seam that nothing persists. Expiry gets a `sessionId` taken from the registry. It must check that id with `isRegistryId` at the executor boundary, before either `CCD_ARGV.wsExpireAudit` or `CCD_ARGV.wsExpire`.
- The lane's population is `records`. After Task 5, `records` already leaves out a refused row. This guard is the executor's own re-check, and it is pinned on the executor directly.
- **R9.** `expireArchived` answers the existing `composition` outcome, and its detail says the server refused the id. The lane folds `composition` to `nextAskAt: Infinity` with a final report, so a bad id is never asked again. `learnExpiry` is guarded too, and answers `{ kind: 'unreadable', detail }`. So neither `wsExpireAudit` nor `wsExpire` is ever built for such an id. Both answers carry the one module-private constant `EXPIRE_ID_REFUSED` (Interfaces).
- **R28.** Each guard is step 0:
  - In `expireArchived` it sits after the `answer` closure and before the capability read.
  - In `learnExpiry` it is the first statement, before that function's own capability read.
  - A pure check runs before any read. That includes the registry listing in `expirySwitches`.
- Code comments cite the spec only (`spec §2.3`), never the contract or a ruling number.

**Files:**
- Modify `server/src/coord/expireArchived.ts`, in four places, each located by content:
  - (a) One import line, inserted after the multi-line import that ends `} from '../archivedExpiry.js';`.
  - (b) The module-private constant `EXPIRE_ID_REFUSED` with its docstring. It goes immediately above `export async function expireArchived(deps: ExpireArchivedDeps, req: ExpireArchivedRequest): Promise<ExpireArchivedResult> {`.
  - (c) `expireArchived`'s step 0. It goes between the `answer` closure (`    ({ ...o, sessionId, archivedAt, expiresAt, ...extra } as ExpireArchivedResult);`) and `  // 1 — the capability, refusing on no evidence.`.
  - (d) `learnExpiry`'s first statement. It goes above `  if (!capSupported(deps.fleetState, EXPIRE_CAP)) return { kind: 'unreadable', detail: \`the fleet host does not advertise ${EXPIRE_CAP}\` };`.
  - Nothing else in the file changes:
    - not the executor's numbered docstring;
    - not `expireAudit`, `expireAct` or `expirySwitches`;
    - not `expireFeedBody` or the feed table.
- Create `server/test/expire-id-boundary.test.ts`. It has its own minimal rig, shaped like `expire-archived.test.ts`'s:
  - capabilities that include `EXPIRE_CAP`, plus a variant without it;
  - a recording runner;
  - an `io` whose `readdir` counts listings.
- Do not edit `expire-archived.test.ts`, `archivedExpiry.ts`, `watch.ts` or any census file.

**Interfaces:**
- Consumes:
  ```ts
  // shared/api.ts foot block (Task 1)
  export function isRegistryId(id: unknown): id is string;
  // server/test/registryIdCases.ts (Task 1; data only)
  export const REFUSED_IDS: readonly string[];        // '--actor', '--surface', '--reason', '--expect', '--session', '--', '-h', '-x', '.hidden', 'x'.repeat(256)
  export const EDGE_ACCEPTED_IDS: readonly string[];  // 'a--actor', 'a.--actor', 'x'.repeat(255)
  // existing at 837a099c0
  export async function expireArchived(deps: ExpireArchivedDeps, req: ExpireArchivedRequest): Promise<ExpireArchivedResult>;   // coord/expireArchived.ts
  export async function learnExpiry(deps: Pick<ExpireArchivedDeps, 'runCcd' | 'fleetState'>, sessionId: string): Promise<ExpireAuditRead>;
  // ArchivedExpiryOutcome already has { kind: 'composition'; detail: string }  (archivedExpiry.ts)
  // ExpireAuditRead already has { kind: 'unreadable'; detail: string }         (archivedExpiry.ts)
  export const EXPIRE_CAP = 'expire-v1';           // server/src/ccdargv.ts
  export const ACTOR_FLAGS_CAP = 'actor-flags-v1'; // server/src/ccdargv.ts
  testDeps(home, run): Deps   // server/test/helpers.ts; its runner crosses the agent's real whitelist (guardRunner)
  mkTmp(prefix): string       // server/test/tmpHelpers.ts
  ```
- Produces (R9, R28). Both signatures are unchanged:
  ```ts
  const EXPIRE_ID_REFUSED = 'the server refused this session id: it is not a registry id, so no call was composed';   // module-private
  // expireArchived: step 0 → answer({ kind: 'composition', detail: EXPIRE_ID_REFUSED })
  // learnExpiry:    first statement → { kind: 'unreadable', detail: EXPIRE_ID_REFUSED }
  ```

- [ ] **Step 0: Measure the entry conditions (nothing is written)**

Run from the workspace root:

```bash
grep -c "^export async function learnExpiry" server/src/coord/expireArchived.ts                         # (c15) 1
grep -n "^export function isRegistryId(id: unknown): id is string {$" shared/api.ts                   # 1 line: Task 1 is on the branch
ls server/test/registryIdCases.ts                                                                     # present: Task 1 is on the branch
grep -c "isRegistryId\|EXPIRE_ID_REFUSED" server/src/coord/expireArchived.ts                          # 0: not yet guarded
grep -n "^} from '../archivedExpiry.js';$" server/src/coord/expireArchived.ts                         # 1 line: (a)'s anchor
grep -n "^export async function expireArchived(deps: ExpireArchivedDeps, req: ExpireArchivedRequest)" server/src/coord/expireArchived.ts   # 1 line: (b)'s anchor
grep -n "as ExpireArchivedResult);$" server/src/coord/expireArchived.ts                                # 1 line: the answer closure, (c)'s anchor
grep -n "  // 1 — the capability, refusing on no evidence.$" server/src/coord/expireArchived.ts        # 1 line, the line after it
grep -n "if (!capSupported(deps.fleetState, EXPIRE_CAP)) return { kind: 'unreadable'" server/src/coord/expireArchived.ts   # 1 line: learnExpiry's capability read, (d)'s anchor
grep -c "CCD_ARGV\.wsExpireAudit(\|CCD_ARGV\.wsExpire(" server/src/coord/expireArchived.ts            # 2: the file's two id-taking calls (spec §2.3's count)
ls server/test/expire-id-boundary.test.ts 2>/dev/null || echo "absent, as expected"
gh pr view 351 --json state -q .state                                                                 # (d1) OPEN or MERGED
```

Expected:
- every count is as stated;
- the new test file is absent;
- (d1) reads `OPEN` or `MERGED`.

STOP rules:
- **`isRegistryId` absent from `shared/api.ts`, or `registryIdCases.ts` missing.** Task 1 is not on the branch. STOP and report `tree-not-ready`.
- **(d1) reads `MERGED`.** Run `git fetch origin main && git merge origin/main` once (never a rebase), then re-run this step.
  - #351 adds about 35 lines to this file. Every anchor above is located by content, so line numbers do not matter.
  - If the merge leaves an anchor at 0, re-read `expireArchived`'s head and `learnExpiry` and re-point:
    - (c) still goes after the `answer` closure and before the first read of any kind;
    - (d) still goes before `learnExpiry`'s first read.
  - Record the re-point in the SDD ledger.
  - If `learnExpiry` or `expireArchived` is GONE, or no longer composes `wsExpireAudit`, STOP and report `gate-site-moved`.
- **A live claim** on `server/src/coord/expireArchived.ts` that the brief does not record as agreed: STOP and report `claim-overlap`.

- [ ] **Step 1: Write the failing test**

Create `server/test/expire-id-boundary.test.ts`:

```ts
// Path identity W1a (spec §2.3): the expiry lane's executor boundary. `expireArchived` and `learnExpiry` each ask
// `isRegistryId` of the session id first — before the capability, before the registry listing, before the store — so
// an id that is not a registry id reaches neither `CCD_ARGV.wsExpireAudit` nor `CCD_ARGV.wsExpire`. The lane's
// population is registry-derived and already omits such a row; this pins the executor's OWN re-check. A scripted ccd
// in a fixture HOME answers; nothing here reaches a box.
import { describe, it, expect } from 'vitest';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { openCoordDb } from '../src/coord/db.js';
import { CoordStore } from '../src/coord/store.js';
import { expireArchived, learnExpiry, type ExpireArchivedDeps } from '../src/coord/expireArchived.js';
import type { FleetState } from '../src/fleetstate.js';
import type { Runner } from '../src/exec.js';
import { ACTOR_FLAGS_CAP, EXPIRE_CAP } from '../src/ccdargv.js';
import { testDeps } from './helpers.js';
import { mkTmp } from './tmpHelpers.js';
import { EDGE_ACCEPTED_IDS, REFUSED_IDS } from './registryIdCases.js';

const ARCH = 1_789_000_000;
const DUE = ARCH + 86_400;
/** The words both refusals carry; the constant itself is module-private to the executor. */
const REFUSED_TEXT = 'the server refused this session id';

const CAPS: FleetState = { connected: true, downSince: null, rosterFp: null, build: null,
  ccdVerbs: ['ws-audit', 'ws-expire', EXPIRE_CAP, ACTOR_FLAGS_CAP] };
/** The same box with `expire-v1` withdrawn: a guard that sat behind the capability would answer `unsupported` here. */
const NO_EXPIRE: FleetState = { ...CAPS, ccdVerbs: ['ws-audit', 'ws-expire', ACTOR_FLAGS_CAP] };
const VARIANTS: readonly (readonly [string, FleetState])[] = [
  [`with ${EXPIRE_CAP}`, CAPS],
  [`without ${EXPIRE_CAP}`, NO_EXPIRE],
];

/** A minimal executor rig: a fixture HOME with an empty registry, a runner that records every argv and answers exit 1
 *  with no document, and an `io` that counts listings. */
const rig = (caps: FleetState) => {
  const home = mkTmp('ccrc-expire-id-boundary-');
  mkdirSync(path.join(home, '.cc-sessions'), { recursive: true });
  const calls: string[][] = [];
  const run: Runner = async (_cmd, args) => {
    calls.push(args);
    return { code: 1, stdout: '', stderr: `scripted: ${args[0] ?? ''} answers nothing here` };
  };
  const base = testDeps(home, run);
  const listings: string[] = [];
  const io = {
    ...base.io,
    readdir: async (p: string, timeoutMs?: number, signal?: AbortSignal) => {
      listings.push(p);
      return base.io.readdir(p, timeoutMs, signal);
    },
  };
  const deps: ExpireArchivedDeps = {
    coord: new CoordStore(openCoordDb(path.join(home, '.ccrc', 'coord.db'))),
    io, cfg: base.cfg, runCcd: base.runCcd, fleetState: caps,
  };
  return { deps, calls, listings };
};

describe('expiry refuses a non-registry id before either builder (spec §2.3)', () => {
  it.each([...REFUSED_IDS])('expireArchived for %s answers composition, saying the server refused the id; no call', async (id) => {
    for (const [label, caps] of VARIANTS) {
      const s = rig(caps);
      const out = await expireArchived(s.deps, { sessionId: id, archivedAt: ARCH, expiresAt: DUE });
      expect(s.calls, `${label}: no ccd call`).toEqual([]);
      expect(s.listings, `${label}: no registry listing`).toEqual([]);
      expect(out, label).toMatchObject({
        kind: 'composition', sessionId: id, archivedAt: ARCH, expiresAt: DUE,
        detail: expect.stringContaining(REFUSED_TEXT),
      });
    }
  });

  it.each([...REFUSED_IDS])('learnExpiry for %s answers unreadable; no call', async (id) => {
    for (const [label, caps] of VARIANTS) {
      const s = rig(caps);
      const read = await learnExpiry({ runCcd: s.deps.runCcd, fleetState: caps }, id);
      expect(s.calls, `${label}: no ccd call`).toEqual([]);
      expect(read, label).toEqual({ kind: 'unreadable', detail: expect.stringContaining(REFUSED_TEXT) });
    }
  });

  it('controls: a--actor and a 255-character id compose their ws-audit', async () => {
    for (const id of EDGE_ACCEPTED_IDS) {
      const s = rig(CAPS);
      const out = await expireArchived(s.deps, { sessionId: id, archivedAt: ARCH, expiresAt: DUE });
      expect(s.calls, `expireArchived ${id}`).toEqual([['ws-audit', '--session', id, '--expire']]);
      expect(out, `expireArchived ${id}`).toMatchObject({ kind: 'audit-failed', sessionId: id });

      const l = rig(CAPS);
      const read = await learnExpiry({ runCcd: l.deps.runCcd, fleetState: CAPS }, id);
      expect(l.calls, `learnExpiry ${id}`).toEqual([['ws-audit', '--session', id, '--expire']]);
      expect(read, `learnExpiry ${id}`).toMatchObject({ kind: 'unreadable' });
      expect((read as { detail: string }).detail, `learnExpiry ${id}`).not.toContain(REFUSED_TEXT);
    }
  });
});
```

Notes for the implementer:
- Every `REFUSED_IDS` argv crosses the agent's real whitelist through `guardRunner`. The `ws-audit` grant is the prefix `['ws-audit', '--session']`, so the bad-id argv is admitted, and a missing guard shows up in `calls`, not as a thrown whitelist error.
- In each refused case the `calls` assertion comes first. A deleted guard therefore reds with the composed argv itself.

- [ ] **Step 2: Run the test and see it fail**

```bash
cd server && ./node_modules/.bin/vitest run test/expire-id-boundary.test.ts
```

Run it in the foreground, with a timeout of at least 600000 ms.

Expected: `Test Files  1 failed (1)`, and `Tests  20 failed | 1 passed (21)`.
- Each `expireArchived for <id>` case reds on its first variant: `with expire-v1: no ccd call: expected [ [ 'ws-audit', '--session', '--actor', '--expire' ] ] to deeply equal []`. For `--` the argv is `[ 'ws-audit', '--session', '--', '--expire' ]`, and so on per id.
- Each `learnExpiry for <id>` case reds the same way.
- The controls case passes.
- A load error on `./registryIdCases.js` means Task 1 is not on the branch: STOP (Step 0).

- [ ] **Step 3: Implement**

(a) The import. In `server/src/coord/expireArchived.ts`, find this text:

```ts
  type ArchivedExpiryOutcome, type ExpireAuditRead, type ExpiryStoreRead,
} from '../archivedExpiry.js';
```

and replace it with:

```ts
  type ArchivedExpiryOutcome, type ExpireAuditRead, type ExpiryStoreRead,
} from '../archivedExpiry.js';
import { isRegistryId } from '../../../shared/api.js';
```

(b) The constant. Find this text:

```ts
export async function expireArchived(deps: ExpireArchivedDeps, req: ExpireArchivedRequest): Promise<ExpireArchivedResult> {
  const { sessionId, archivedAt, expiresAt } = req;
```

and replace it with:

```ts
/** What both executor entries answer for a session id that is not a registry id (spec §2.3): refused here, before
 *  either builder, so no call is composed. The lane's population is registry-derived and omits such a row; this is the
 *  executor boundary's own re-check. */
const EXPIRE_ID_REFUSED = 'the server refused this session id: it is not a registry id, so no call was composed';

export async function expireArchived(deps: ExpireArchivedDeps, req: ExpireArchivedRequest): Promise<ExpireArchivedResult> {
  const { sessionId, archivedAt, expiresAt } = req;
```

(c) `expireArchived`'s step 0. Find this text:

```ts
    ({ ...o, sessionId, archivedAt, expiresAt, ...extra } as ExpireArchivedResult);
  // 1 — the capability, refusing on no evidence.
```

and replace it with:

```ts
    ({ ...o, sessionId, archivedAt, expiresAt, ...extra } as ExpireArchivedResult);
  // 0 — the id, before any read (spec §2.3): one that is not a registry id reaches neither builder. A pure check, so it
  //     stands ahead of the capability; `composition` is the answer the lane never asks again.
  if (!isRegistryId(sessionId)) return answer({ kind: 'composition', detail: EXPIRE_ID_REFUSED });
  // 1 — the capability, refusing on no evidence.
```

(d) `learnExpiry`'s first statement. Find this text:

```ts
export async function learnExpiry(deps: Pick<ExpireArchivedDeps, 'runCcd' | 'fleetState'>, sessionId: string): Promise<ExpireAuditRead> {
  if (!capSupported(deps.fleetState, EXPIRE_CAP)) return { kind: 'unreadable', detail: `the fleet host does not advertise ${EXPIRE_CAP}` };
```

and replace it with:

```ts
export async function learnExpiry(deps: Pick<ExpireArchivedDeps, 'runCcd' | 'fleetState'>, sessionId: string): Promise<ExpireAuditRead> {
  // The id first, as the act's step 0 (spec §2.3): the learning audit is the other `wsExpireAudit` builder.
  if (!isRegistryId(sessionId)) return { kind: 'unreadable', detail: EXPIRE_ID_REFUSED };
  if (!capSupported(deps.fleetState, EXPIRE_CAP)) return { kind: 'unreadable', detail: `the fleet host does not advertise ${EXPIRE_CAP}` };
```

Check the diff:

```bash
git diff --stat -- server/src/coord/expireArchived.ts     # 1 file changed, 11 insertions(+), 0 deletions
git diff -- server/src/coord/expireArchived.ts | grep '^-[^-]' | wc -l   # 0: nothing removed
```

- [ ] **Step 4: Run the test and see it pass**

```bash
cd server && ./node_modules/.bin/vitest run test/expire-id-boundary.test.ts
```

Expected: `Tests  21 passed (21)`.

- [ ] **Step 5: Mutation check**

Make each edit, run the command, see the red, record it in the SDD ledger, and undo the edit by hand before the next row. Never `git checkout` the file: this task's change is not committed yet, and a checkout would discard it. The worker measures every red text, and a measured text replaces the draft's where they differ. Every command runs from `server/`, and `X` stands for `./node_modules/.bin/vitest run test/expire-id-boundary.test.ts`.

| # | Mutation (in `server/src/coord/expireArchived.ts`) | Command | Expected red |
|---|---|---|---|
| 1 | Delete `expireArchived`'s step-0 line `if (!isRegistryId(sessionId)) return answer({ kind: 'composition', detail: EXPIRE_ID_REFUSED });` | `X -t 'expireArchived for'` | 10 failed. For example `with expire-v1: no ccd call: expected [ [ 'ws-audit', '--session', '--actor', '--expire' ] ] to deeply equal []` |
| 2 | Move that line below the step-1 block (after the closing `}` of `if (!capSupported(deps.fleetState, EXPIRE_CAP)) { … }`) | `X -t 'expireArchived for'` | 10 failed, on the no-capability variant: `without expire-v1: expected { kind: 'deferred', why: 'unsupported', … } to match object { kind: 'composition', … }` |
| 3 | Delete `learnExpiry`'s line `if (!isRegistryId(sessionId)) return { kind: 'unreadable', detail: EXPIRE_ID_REFUSED };` | `X -t 'learnExpiry for'` | 10 failed. For example `with expire-v1: no ccd call: expected [ [ 'ws-audit', '--session', '--actor', '--expire' ] ] to deeply equal []` |
| 4 | Swap `learnExpiry`'s two first lines, so that the capability read comes first | `X -t 'learnExpiry for'` | 10 failed, on the no-capability variant: `without expire-v1: expected { kind: 'unreadable', detail: 'the fleet host does not advertise expire-v1' } to deeply equal { kind: 'unreadable', detail: StringContaining "the server refused this session id" }` |

Afterwards, check that the tree is restored:

```bash
git diff --stat -- server/src/coord/expireArchived.ts     # the Step 3 diff only: 11 insertions(+)
cd server && ./node_modules/.bin/vitest run test/expire-id-boundary.test.ts   # 21 passed
```

- [ ] **Step 6: The other suites, the scans that read this file, and the typecheck**

Run each line in the foreground, with a timeout of at least 600000 ms:

```bash
cd server && ./node_modules/.bin/vitest run test/expire-archived.test.ts test/archived-expiry-lane.test.ts test/verb-gate.test.ts
cd server && ./node_modules/.bin/vitest run test/collect-lane-scans.test.ts test/ws-collect-wiring.test.ts test/mail-routes.test.ts
cd server && ./node_modules/.bin/vitest run test/single-definition.test.ts test/typecheck-tests.test.ts
cd server && ./node_modules/.bin/tsc --noEmit -p . && ./node_modules/.bin/tsc --noEmit -p test/tsconfig.tests.json
```

Expected: every file passes, and neither `tsc` prints anything. Why each scan stays green:
- **`verb-gate`.** `expireAudit`'s scope still holds `verbSupported(`, and `expireAct`'s still holds `capSupported(…, EXPIRE_CAP)`. Neither function changed.
- **`collect-lane-scans`.** `isRegistryId` is no collector name, and the new import is not a lane module.
- **`single-definition`.** The `EXPIRE_LANE_LIVE_MARKER` holders are unchanged and reach no write. The new prose names no period.
- **`mail-routes`.** The new string literal holds spaces, so the kebab scan reads no token from it.

Re-run a known CLAUDE.md load flake in isolation before calling it a break.

- [ ] **Step 7: Commit**

```bash
git add server/src/coord/expireArchived.ts server/test/expire-id-boundary.test.ts
git commit -m "$(cat <<'MSG'
fix(coord): expiry refuses a non-registry id before either builder

expireArchived and learnExpiry ask isRegistryId of the session id as
their first act. The check runs before the capability, the registry
listing and the store, so an id that is not a registry id never reaches
the expire audit or the expire verb.
- expireArchived answers the existing composition outcome, which the lane
  never asks again;
- learnExpiry answers unreadable;
- both details say the server refused the id and composed no call.
The lane's population is registry-derived and already omits such a row.
This is the executor boundary's own re-check, pinned directly against
every refused id, with the expire capability and without it. An id with
inner dashes, one with an inner dot and a 255-character id still compose
their audit.
Spec §2.3.
MSG
)"
```

Record one slug in the SDD ledger, `expiry-composition-words-misread-a-server-refusal`. The lane's report (`archivedExpiry.ts`, outside this boundary) and `expireFeedBody`'s `composition` arm both describe `composition` as a call ccd rejected, so this refusal reads "the server composed a call ccd rejected: the server refused this session id …". Production cannot reach it while the lane's population omits refused rows (Task 5), so it is carried, not fixed here (R16 keeps this file's hunk small). Task 16 lists it under the departures recorded while building. Name no other departure for this task, unless Step 0 re-pointed an anchor after #351 merged. In that case, record the re-point in the SDD ledger.

---

### Task 13: The collector's id pins

**Model routing:** `sonnet`, effort `medium`. There is no source change (R10). The two gates already exist. This task pins them against the shared id lists and measures each pin by a temporary mutation that is then reverted.

**Files:**
- Create: `server/test/collect-id-pins.test.ts`. It imports the existing rigs and changes neither:
  - `collectRig` from `server/test/collectLaneFixture.ts`, the lane's watcher rig with a scripted ccd behind the real exec whitelist;
  - `rig` from `server/test/collectTempRootFixture.ts`, the executor's rig. It records every argv at `runCcd` in `r.attempts`, before the whitelist.
- Mutated, measured, restored, and NEVER committed (HARD BOUNDARY: this wave never edits these files):
  - `server/src/collectLane.ts`: the population gate, located by its content `if (isTmpRootId(n)) witnessed.add(n); else refusedNames += 1;`. Row 3 also mutates the population's record half, `parseCollectRecordName`'s `return id !== undefined && isTmpRootId(id) ? id : null;`, measured on the existing `collect-population.test.ts` pins. The box listing's `if (!isTmpRootId(id)) continue;` is not touched.
  - `server/src/coord/collectTempRoot.ts`: the executor's step-1 id check, located by its content `if (!isTmpRootId(job.id)) return { kind: 'not-asked', step: 1, why: 'id-refused', detail: COLLECT_ID_REFUSED };`.
- No other file is modified.

**Interfaces:**
- Consumes:
  ```ts
  // shared/api.ts foot block, Task 1 (L0):
  export const REGISTRY_ID_MAX_CHARS = 255;
  export function isTmpRootId(id: unknown): id is string;   // body: `return isRegistryId(id);`
  export const COLLECT_BOX_LABELS: { readonly tmproots: '~/.cc-sessions/tmproots'; /* …unchanged… */ };
  export interface ChildReclaimCollectAttention { kind: 'collect'; sessionId: string; runId: number | null; word: …; sentence: string }
  // server/test/registryIdCases.ts, Task 1 (data only):
  export const REDIRECT_IDS: readonly string[];       // ['--actor', '--surface', '--reason', '--expect', '--session', '--', '-h', '-x']
  export const REFUSED_IDS: readonly string[];        // REDIRECT_IDS, then '.hidden' and 'x'.repeat(256)
  export const EDGE_ACCEPTED_IDS: readonly string[];  // ['a--actor', 'a.--actor', 'x'.repeat(255)]
  // server/src/collectLane.ts (unchanged):
  export interface CollectPopulation { ids; candidates; recordIds; refusedNames: number; unmeasured; bothMeasured }
  // server/src/coord/collectTempRoot.ts (unchanged):
  export async function collectTempRoot(deps: CollectTempRootDeps, job: CollectJob): Promise<CollectJobOutcome>;
  // server/test/collectLaneFixture.ts (unchanged):
  export const collectRig: (opts?: CollectRigOpts) => Promise<CollectRig>;   // .witness .pass .settled .audits .collects .lane .attention .boxWide .watcher
  // server/test/collectTempRootFixture.ts (unchanged):
  export const rig: (o?: RigOpts) => Rig;                                     // .deps .attempts .lane.clears
  ```
- Produces: no source names. It adds pins only: the lane case, the executor's ten refused cases, and three controls.

- [ ] **Step 1: Re-measure the two gates and run 400's state (nothing is written)**

From the workspace root:

```bash
grep -c "if (isTmpRootId(n)) witnessed.add(n); else refusedNames += 1;" server/src/collectLane.ts                 # (c20) 1: the population gate
grep -c "isTmpRootId(" server/src/collectLane.ts                                                                 # 3: the gate, parseCollectRecordName, the box listing
grep -c "return id !== undefined && isTmpRootId(id) ? id : null;" server/src/collectLane.ts                        # 1: the record half (Row 3)
grep -c "if (!isTmpRootId(job.id)) return { kind: 'not-asked', step: 1, why: 'id-refused', detail: COLLECT_ID_REFUSED };" server/src/coord/collectTempRoot.ts   # 1: the executor's step 1
grep -c 'return isRegistryId(id);' shared/api.ts                                                                  # 1: Task 1 derived isTmpRootId
grep -c '^export const REFUSED_IDS' server/test/registryIdCases.ts                                                # 1: Task 1's lists exist
gh pr list --state all --json number,state,title -q '.[] | "\(.number) \(.state) \(.title)"' | grep -i 'collector' | grep -i 'wave 10\|settings'   # (d5) record
```

Record every answer in the SDD ledger.
- A count that differs from what is stated, but whose gate is still present, means re-pointing by content. Record it.
- A gate that is GONE (a count of 0 on the first or third line) is a STOP: `gate-site-moved`.
- If (d5) shows run 400 MERGED and this branch has merged `main` since Task 0, re-run the first three lines against this tree, and use whatever spelling they find in the Step 4 mutations.
- If run 400 has removed or renamed `collectRig`'s `armed` option, arm the lane the way the rig now does. The learning audit reads no switch, so no assertion changes. Name it `collector-rig-arming-renamed`.

- [ ] **Step 2: Write the tests**

Create `server/test/collect-id-pins.test.ts`:

```ts
// Path identity W1a (spec §2.3): the temp-root collector's two id gates, pinned with no source change. The collector
// already refuses a dash-leading, dot-leading or over-long id twice before any argv:
// - the POPULATION gate (`collectPopulation`, `server/src/collectLane.ts`): a name under `$REG/tmproots` that fails
//   `isTmpRootId` is counted in `refusedNames` and never becomes an id. So the learning audit (`learnCollect`, which
//   asks no predicate of its own) never names it;
// - the EXECUTOR's step 1 (`collectTempRoot`, `server/src/coord/collectTempRoot.ts`): `isTmpRootId(job.id)` again, on
//   the job's own id, before `wsCollectAudit` or `wsCollect` is built.
// `isTmpRootId` derives from L0's `isRegistryId`, so these cases read the shared lists of `registryIdCases.ts`. They
// pass at once; their mutation rows are the proof.
// FIXTURE HOME ONLY: the lane case runs `collectLaneFixture.ts`'s scripted ccd, the executor cases
// `collectTempRootFixture.ts`'s. Nothing reaches a box.
import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  COLLECT_BOX_LABELS, REGISTRY_ID_MAX_CHARS, isTmpRootId, type ChildReclaimCollectAttention,
} from '../../shared/api.js';
import type { CollectPopulation } from '../src/collectLane.js';
import { collectTempRoot } from '../src/coord/collectTempRoot.js';
import { collectRig } from './collectLaneFixture.js';
import { rig } from './collectTempRootFixture.js';
import { EDGE_ACCEPTED_IDS, REDIRECT_IDS, REFUSED_IDS } from './registryIdCases.js';

afterEach(() => { vi.restoreAllMocks(); });

/** The refused ids a fixture HOME can hold as a witness file. A name longer than one file-name component cannot be
 *  created, so the 256-character case is pinned at the executor below, and in `collect-population.test.ts`'s pure
 *  table, and is never planted. */
const PLANTABLE: readonly string[] = REFUSED_IDS.filter((id) => id.length <= REGISTRY_ID_MAX_CHARS);

describe("the collector's two id gates (spec §2.3)", () => {
  it('a dash- or dot-leading witness name never reaches the learning audit', async () => {
    const f = await collectRig({ armed: true });
    for (const id of PLANTABLE) f.witness(id);
    f.witness('demo-a');                                    // the control: a witnessed id the same pass DOES audit
    await f.pass(); await f.settled();
    expect(f.audits().filter((c) => PLANTABLE.includes(c.id)).map((c) => c.id),
      'no ws-audit … --collect names a refused witness').toEqual([]);
    expect(f.audits().map((c) => c.id), 'the pass audited its one id').toEqual(['demo-a']);
    expect(f.collects(), 'and composed no act').toEqual([]);
    expect([...f.lane().entries.keys()], 'the lane remembers no refused name').toEqual(['demo-a']);
    // The count. Every dash-leading name is refused and counted. A dot-leading one is a writer's temp file by the
    // population's own rule, and is dropped before the gate, uncounted.
    const pop = (f.watcher as unknown as { collectPop: CollectPopulation | null }).collectPop;
    expect(pop?.ids, 'only the control became an id').toEqual(['demo-a']);
    expect(pop?.refusedNames, 'each dash-leading witness counts as a refused name').toBe(REDIRECT_IDS.length);
    const items = await f.attention();
    const prefix = `${REDIRECT_IDS.length} names under ${COLLECT_BOX_LABELS.tmproots} or `;
    const line = f.boxWide(items).find((a) => a.word === 'refused-names');
    expect(line?.sentence.slice(0, prefix.length), 'the refused-names line carries the count').toBe(prefix);
    const perId = items.filter((a): a is ChildReclaimCollectAttention =>
      a.kind === 'collect' && PLANTABLE.includes(a.sessionId));
    expect(perId, 'and no refused name is an item of its own').toEqual([]);
  });

  it.each([...REFUSED_IDS])('the executor refuses %s at step 1', async (id) => {
    expect(isTmpRootId(id), 'the case is one the predicate refuses').toBe(false);
    const r = rig();
    expect(await collectTempRoot(r.deps, { id })).toMatchObject({ kind: 'not-asked', step: 1, why: 'id-refused' });
    expect(r.attempts.filter((a) => a[0] === 'ws-audit'), 'no ws-audit').toEqual([]);
    expect(r.attempts.filter((a) => a[0] === 'ws-collect'), 'no ws-collect').toEqual([]);
    expect(r.attempts, 'no argv at all').toEqual([]);
    expect(r.lane.clears, 'a refused id clears no pair').toEqual([]);
  });

  it.each([...EDGE_ACCEPTED_IDS])('control: the executor audits %s as itself', async (id) => {
    expect(isTmpRootId(id), 'the case is one the predicate accepts').toBe(true);
    const r = rig();
    await collectTempRoot(r.deps, { id });
    expect(r.attempts[0]).toEqual(['ws-audit', '--session', id, '--collect']);
  });
});
```

- [ ] **Step 3: Run the new file (green at once)**

```bash
cd server && ./node_modules/.bin/vitest run test/collect-id-pins.test.ts
```

Run it in the foreground, with a timeout of at least 600000 ms.

Expected: PASS, `Tests  14 passed (14)`: the lane case, ten executor cases and three controls.

A red here means a gate does not stand as R10 says. Do NOT edit source: STOP and report `collector-gate-not-as-pinned`, with the red text. A red that names `registryIdCases.js` as missing means Task 1 is not on the branch: STOP (Step 1).

- [ ] **Step 4: Mutation rows (each a temporary edit, measured, then restored)**

Make each edit from the workspace root, and run every line below as its own Bash call starting there: each `cd server && …` line enters `server/` for that call only. In a shell that keeps its directory between calls, write those lines as `(cd server && …)`, or the next `cd server` fails and the restore's `server/src/…` path misses. Record the red text in the SDD ledger, and restore before the next row. The worker measures every red text. Where the measured text differs from the draft below, the measured text replaces it.

**Row 1: the population gate becomes `true`.**

```bash
node -e '
const fs = require("node:fs");
const f = "server/src/collectLane.ts";
const a = "if (isTmpRootId(n)) witnessed.add(n); else refusedNames += 1;";
const s = fs.readFileSync(f, "utf8");
if (s.split(a).length !== 2) throw new Error("population gate not found exactly once");
fs.writeFileSync(f, s.replace(a, "if (true) witnessed.add(n); else refusedNames += 1;"));
'
cd server && ./node_modules/.bin/vitest run test/collect-id-pins.test.ts -t 'never reaches the learning audit'
cd server && ./node_modules/.bin/vitest run test/collect-population.test.ts -t 'dash-leading name is never an id'
```

Expected red:
- **collect-id-pins.** The lane case fails with `no ws-audit … --collect names a refused witness: expected [ '--', '--actor' ] to deeply equal []`. The pass audits up to `COLLECT_AUDITS_PER_PASS` (2) fresh candidates, ordered by id, and `-` sorts before `d`, so the audit composed for `--actor` is the red.
- **collect-population.** The existing pin "a dash-leading name is never an id, as a witness or as a record, and is counted" also reds, at `expected { ids: [ '--', '--actor', … ], … } to deeply equal { ids: [], … }`.

Restore:

```bash
git checkout -- server/src/collectLane.ts
```

**Row 2: delete the executor's step-1 check.**

```bash
node -e '
const fs = require("node:fs");
const f = "server/src/coord/collectTempRoot.ts";
const re = /^  if \(!isTmpRootId\(job\.id\)\) return .*\n/m;
const s = fs.readFileSync(f, "utf8");
if ((s.match(/^  if \(!isTmpRootId\(job\.id\)\) return .*$/gm) ?? []).length !== 1) throw new Error("step-1 check not found exactly once");
fs.writeFileSync(f, s.replace(re, ""));
'
cd server && ./node_modules/.bin/vitest run test/collect-id-pins.test.ts -t 'the executor refuses'
cd server && ./node_modules/.bin/vitest run test/collect-temp-root.test.ts -t 'refused before any argv'
```

Expected red:
- **collect-id-pins.** All ten "the executor refuses … at step 1" cases red. For `--actor` the text is `expected { kind: 'answered', step: 4, why: 'not-collectable', … } to match object { kind: 'not-asked', step: 1, why: 'id-refused' }`. The job composed `ws-audit --session --actor --collect`, and the scripted audit document names another session.
- **collect-temp-root.** The existing ten "the id … is refused before any argv: no audit, no act" cases red the same way.
- **The controls stay green.**

Restore:

```bash
git checkout -- server/src/coord/collectTempRoot.ts
```

**Row 3: the population's record half drops its predicate.** The lane case plants witnesses only. A quarantine record's name is the population's other way to an id, and so to the learning audit, so its gate is measured too, on the existing pins.

```bash
node -e '
const fs = require("node:fs");
const f = "server/src/collectLane.ts";
const a = "return id !== undefined && isTmpRootId(id) ? id : null;";
const s = fs.readFileSync(f, "utf8");
if (s.split(a).length !== 2) throw new Error("record-name gate not found exactly once");
fs.writeFileSync(f, s.replace(a, "return id !== undefined ? id : null;"));
'
cd server && ./node_modules/.bin/vitest run test/collect-population.test.ts -t 'dash-leading|redirect flag'
```

Expected red (derived; the measured text replaces it): the parse table's `a dash-leading id` and `a redirect flag` rows (`expected '-x' to be null`, `expected '--actor' to be null`), and "a dash-leading name is never an id, as a witness or as a record, and is counted" (`recordIds` gains the eight redirect ids, and `refusedNames` reads 8, not 16).

Restore:

```bash
git checkout -- server/src/collectLane.ts
```

**After all three rows, prove the tree is restored:**

```bash
git diff --exit-code -- server/src/collectLane.ts server/src/coord/collectTempRoot.ts; echo "rc=$?"   # rc=0
git status --short                                                                                  # only: ?? server/test/collect-id-pins.test.ts
```

- [ ] **Step 5: Run the task's suites and the typecheck**

```bash
cd server && ./node_modules/.bin/vitest run test/collect-id-pins.test.ts
cd server && ./node_modules/.bin/vitest run test/collect-temp-root.test.ts
cd server && ./node_modules/.bin/vitest run test/collect-population.test.ts
cd server && ./node_modules/.bin/tsc --noEmit -p test/tsconfig.tests.json
```

Run each command in the foreground, with a timeout of at least 600000 ms.

Expected: all three files PASS, and `tsc` prints nothing. The new file must compile under the tests project, because `typecheck-tests` compiles `server/test/**`.

- [ ] **Step 6: Commit**

```bash
git add server/test/collect-id-pins.test.ts
git commit -m "$(cat <<'MSG'
test(collect): pin the collector's two id gates

The temp-root collector already refuses a dash-leading, dot-leading or
over-long id twice before any argv, and this commit changes no source:
- the population gate counts a witness name that fails isTmpRootId as
  refused, so the learning audit, which asks no predicate of its own,
  never names it;
- the executor's step 1 checks the job's own id again before
  wsCollectAudit or wsCollect is built.

isTmpRootId now derives from isRegistryId, so the cases read the shared
registry id lists: one armed lane pass over every plantable refused
witness with a control id, each refused id at the executor, and the
accepted edge ids as controls. Each gate's mutation was measured red,
here and in the existing population and executor pins, then reverted.
Spec §2.3.
MSG
)"
```

---

### Task 14: stop's builder order

**Model routing:** `opus`, effort `high`. This is the one positional redirect in the server's argv set, and it is pinned on the real binary. The server's id gates already refuse an id spelled `--surface` before either builder runs: `/stop` through `readSessionRecord`'s `bad-id` (Task 4), and the archive door through `knownId` (Task 2). This task reorders the builders so that the argv itself refuses such an id. It is the second lock for an id spelled `--surface`, and it also covers any future caller of `stopId`. The task also closes the pair form's own gap (`stop-pair-fields-refused-at-composition`). `stopPair`'s project is a legacy row's `.project`, and its wrapper is the row's `.wrapper` when the id does not end in `-<project>`: fields no id gate reads. A field spelled `--surface=<word>` survives every argv order, because `cmd_stop`'s `--surface=*` arm strips that token from any position and stops the other one, in the leading, trailing and bare forms alike. So `/stop` and the archive door refuse a legacy row whose wrapper part or project part fails `isRegistryId`, in their identity arm, before any argv is composed. For a `.project` spelled `--surface`, that refusal is the first lock and the leading order the second.

**Why:** spec §2.3 says the stop builders move to `['stop', '--surface', surface, id]` and `['stop', '--surface', surface, w, p]`. Spec §2.4 gives the reason: with the id first, `cmd_stop`'s loop cannot tell an id spelled `--surface` from the key. R14 binds the two shapes, and every pin of today's order is updated in this same commit. README's two stop prose lines are Task 16's, under R14's condition, and this task does not touch them. The pair-part refusal is a coordinator ruling at plan review. No ccd-side rule closes the `--surface=<word>` gap without also refusing the pre-W1a trailing order while the fleet box runs ahead of the server during a rollout, so the server closes it here. It answers with the identity arm's existing word, 503 `registry-unmeasurable`, and adds none. Measured by the coordinator: the fleet box has 18 distinct registry projects and none begins with `-` or `.`, so no row is stranded.

**Measured at planning:** nothing has been run. Every red text below is DERIVED from the code at `837a099c0`. The worker measures each one, and the measured text replaces the draft's. A different count is not a departure; a different meaning is.

**Files:**
- Modify `server/src/ccdargv.ts`, in the `CCD_ARGV` table:
  - the docstring above `stopId` (anchor: its last line, `   *  never happens. */`). The old-ccd hazard paragraph stays word for word, and a new paragraph gives the reason for the leading position;
  - the two builders (anchors: `  stopId:    (id: string, surface: StopSurface | null) =>` and `  stopPair:  (w: string, p: string, surface: StopSurface | null) =>`).
  - Nothing else in the file changes. `stopSurfaceSupported`'s docstring (`old ccd parses \`stop <id> --surface pwa\``) describes the pre-flag ccd and is still true.
- Modify `server/src/server.ts`, inside `buildServer` (Step 4(b) and (c)):
  - `stopArgvFor`'s docstring (anchor: `   * always understood, where \`['stop', id, '--surface', 'pwa']\` against an`);
  - two new closures, `stopPairWrapper` and `stopPairRefused`, inserted directly above that docstring (anchor: its first line, `   * The stop argv — ONE spelling, two callers, both the PWA's own controls: …`);
  - in `stopArgvFor`'s body, only the `originalWrapper` ternary, which becomes a call of `stopPairWrapper`. Its line `return CCD_ARGV.stopPair(originalWrapper, rec.project, surface);` does not change;
  - the identity arm of `POST /api/sessions/:id/stop` (anchor: `    // registry-unmeasurable shape, instead.`) and of `POST /api/sessions/:id/archive` (anchor: `    if (identity === null) return reply.code(503).send({ ok: false, error: 'registry-unmeasurable' });`). Each also asks `stopPairRefused`.
- Modify `server/test/whitelist-subset.test.ts`:
  - in `EXPECTED` (layer 2c), the `stopId` and `stopPair` rows, plus a comment above them;
  - in `it('stop is a bare one-token grant, …')`, the two `isExecAllowed` string literals, plus the last two lines of the comment above that `it`.
- Modify `server/test/lifecycle.test.ts`:
  - the six `[cfg.ccdBin, 'stop', …, '--surface', 'pwa']]` rows, rewritten by a pattern with a count guard (Step 2(c)). The rows name fixture projects that this plan does not repeat;
  - one sentence appended to each of the two comments that spell the trailing form (anchors: `  // SAME decision the route makes in that real deployment window.` and `// argv below would have risked; the assertion is that it is never there.`).
- Create `server/test/ccd-stop-argv-order.test.ts`. It runs the real `cmd_stop`, sourced in a fixture HOME from `makeCcdHarness`. tmux, systemctl and launchctl are stubbed the way `ccd-session-state.test.ts`'s `describe('cmd_stop')` stubs them. It is a new file because `ccd-session-state` is a known load flake. A second describe drives `/stop` and the archive door through Task 2's `appFor` over planted legacy rows, with a runner that records argv and never execs: one `.project` case and one fallback `.wrapper` case for each caller.
- No edit to `ccd/`, `agent/` (the grant stays the bare `['stop']`), `README.md`, `archive-door.test.ts` (it sends no surface), or any other file.

**Interfaces:**
- Consumes:
  - `CCD_ARGV.stopId(id: string, surface: StopSurface | null): CcdArgv` and `CCD_ARGV.stopPair(w: string, p: string, surface: StopSurface | null): CcdArgv` (`server/src/ccdargv.ts`), and `type CcdArgv` from the same file;
  - `isRegistryId(id: unknown): id is string` (`shared/api.ts`, Task 1), which Task 2 imported into `server.ts`, and `measuredIdentity` and `type SessionRecord` (`server/src/registry.ts`), which `server.ts` already imports;
  - from the test side: `CCD`, `ghContainedEnv`, `makeCcdHarness` and `type CcdHarness` (`server/test/ccdWsHelpers.ts`), `inheritedEnv` (`server/test/gitEnvStrip.ts`), `readJournal`, `eventsOf` and `decOf` (`server/test/lifecycleHelpers.ts`), `asManagerCalls` (`server/test/platformFixtures.ts`), `appFor` (`server/test/idGateFixture.ts`, Task 2), `mkTmp` (`server/test/tmpHelpers.ts`), `type Runner` (`server/src/exec.ts`) and `type FleetState` (`server/src/fleetstate.ts`).
- Produces the leading-form argv. The signatures are unchanged:
  ```ts
  stopId:   (id: string, surface: StopSurface | null) => CcdArgv   // ['stop', id] | ['stop', '--surface', surface, id]
  stopPair: (w: string, p: string, surface: StopSurface | null) => CcdArgv   // ['stop', w, p] | ['stop', '--surface', surface, w, p]
  ```
- Produces, in `server/src/server.ts`, the two closures of the canonical Interfaces (L4, Task 14), and one answer from the identity arm of `/stop` and of the archive door: a legacy row whose wrapper part or project part fails `isRegistryId` answers 503 `{ ok: false, error: 'registry-unmeasurable' }`, with no argv composed and no `runCcd` call.

- [ ] **Step 1: Re-measure the entry conditions (nothing is written)**

Run from the workspace root:

```bash
grep -c "argv(surface === null ? \['stop', id\] : \['stop', id, '--surface', surface\])" server/src/ccdargv.ts        # (c16) 1
grep -c "argv(surface === null ? \['stop', w, p\] : \['stop', w, p, '--surface', surface\])" server/src/ccdargv.ts     # 1: the pair builder
grep -c "if (rec.workspace !== null) return CCD_ARGV.stopId(id, surface);" server/src/server.ts                        # 1: stopArgvFor, the one composer
grep -c "return CCD_ARGV.stopPair(originalWrapper, rec.project, surface);" server/src/server.ts                       # 1
grep -c "if (identity === null) return reply.code(503).send({ ok: false, error: 'registry-unmeasurable' });" server/src/server.ts   # 1: the archive door's identity arm
grep -A3 -F "    // registry-unmeasurable shape, instead." server/src/server.ts | grep -c "    if (identity === null) {"           # 1: /stop's identity arm
grep -cF "The stop argv — ONE spelling, two callers" server/src/server.ts                                               # 1: stopArgvFor's docstring, above which the closures go
grep -c "isRegistryId" server/src/server.ts                                                                             # >= 2: Task 2's import and knownId's gate
grep -cE '^export (async )?function appFor\(' server/test/idGateFixture.ts                                              # 1: Task 2's rig
grep -c "stopPairRefused\|stopPairWrapper" server/src/server.ts                                                         # 0: both are new
grep -c "'--surface', 'pwa'\]\]" server/test/lifecycle.test.ts                                                          # 6: the trailing-form rows
grep -c "stopId: \['stop', 'demo-quiet-basin', '--surface', 'pwa'\]," server/test/whitelist-subset.test.ts             # 1
git log --format=%h -S'echo stop-surface' -- ccd/ccd | tail -1                                                          # (e1) record the hash
git show <e1>:ccd/ccd | awk '/^cmd_stop\(\)/,/^}/' | grep -c -- '--surface)'                                            # (e2) >= 1
```

The SDD ledger already holds Task 0's (e1) and (e2). Compare the re-measured values with it. If (e2) is 0, STOP with `stop-surface-loop-postdates-token`: an older ccd that advertises the token would then meet a leading flag with no loop to strip it. If (c16), the pair line, either identity-arm line or the docstring line is 0, STOP with `gate-site-moved`. If `isRegistryId` or `appFor` is missing, Task 2 has not landed: STOP with `tree-not-ready`. If any other count differs, re-point by content and record the new value.

- [ ] **Step 2: Write the failing tests**

(a) Create `server/test/ccd-stop-argv-order.test.ts`:

```ts
// server/test/ccd-stop-argv-order.test.ts
//
// stop sends --surface BEFORE the id (path identity W1a, spec §2.3, §2.4).
//
// The server's two stop builders, run through the REAL `cmd_stop`, sourced in
// a fixture HOME. With the id first, an id spelled `--surface` reached ccd as
// `stop --surface --surface pwa`: the loop read the first two tokens as the
// pair, and the residue `pwa` was stopped. With the pair first, the loop
// consumes one closed-grammar pair and the residue is the id, so
// `stop --surface pwa --surface` dies on the usage line. A project spelled
// `--surface` redirected the legacy pair form the same way, to
// `<wrapper>-pwa`.
//
// A new file, not a case in `ccd-session-state.test.ts`, because that suite is
// a known load flake (CLAUDE.md).
//
// STANDING NOTE: this file matches `ccd-workspaces.test.ts`'s `/^ccd.*\.ts$/`
// containment scan. Its one bash spawn goes through `ghContainedEnv` and asks
// for systemd and tmux containment, and HOME is always `makeCcdHarness`'s
// fixture, never the live one.
//
// THE PAIR PARTS (path identity W1a, a coordinator ruling at plan review). The
// second describe runs the SERVER, not ccd: `/stop` and the archive door over
// planted legacy rows, through Task 2's `appFor` in its own `mkTmp` fixture
// HOME, with a runner that records argv and never execs.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import type { FastifyInstance } from 'fastify';
import { CCD_ARGV, type CcdArgv } from '../src/ccdargv.js';
import type { Runner } from '../src/exec.js';
import type { FleetState } from '../src/fleetstate.js';
import { CCD, ghContainedEnv, makeCcdHarness, type CcdHarness } from './ccdWsHelpers.js';
import { inheritedEnv } from './gitEnvStrip.js';
import { appFor } from './idGateFixture.js';
import { decOf, eventsOf, readJournal } from './lifecycleHelpers.js';
import { asManagerCalls } from './platformFixtures.js';
import { mkTmp } from './tmpHelpers.js';

let h: CcdHarness;
beforeEach(() => { h = makeCcdHarness('ccrc-ccd-stop-order-'); });
afterEach(() => { h.cleanup(); });

const ID = 'demo-quiet-mesa';
const REGDIR = (): string => path.join(h.home, '.cc-sessions');

/** Every manager and tmux call lands in `$HOME/ccd-calls`, never on a box. */
const STOP = `systemctl() { echo "systemctl $*" >> "$HOME/ccd-calls"; }; `
  + `launchctl() { echo "launchctl $*" >> "$HOME/ccd-calls"; }; `
  + `tmux() { echo "tmux $*" >> "$HOME/ccd-calls"; };`;

/** The builder's argv after its verb, each token single-quoted for bash. */
const argsOf = (argv: CcdArgv): string =>
  argv.slice(1).map((t) => `'${t.replace(/'/g, `'\\''`)}'`).join(' ');

/** Captures the exit status and stderr of a refusal, which `h.sh` would throw on. */
const run = (snippet: string): { code: number; stdout: string; stderr: string } => {
  const r = spawnSync('bash', ['-c', `source "${CCD}"; ${snippet}`], {
    encoding: 'utf8', cwd: h.home, timeout: 15000,
    env: ghContainedEnv(h.home, { ...inheritedEnv(), HOME: h.home }, { systemd: true, tmux: true }),
  });
  return { code: r.status ?? 1, stdout: r.stdout ?? '', stderr: r.stderr ?? '' };
};

describe('stop sends --surface before the id (spec §2.3, §2.4)', () => {
  it("cmd_stop run on stopId's argv stops the id and stamps surface pwa", () => {
    const argv = CCD_ARGV.stopId(ID, 'pwa');
    expect([...argv]).toEqual(['stop', '--surface', 'pwa', ID]);
    const r = run(`${STOP} cmd_stop ${argsOf(argv)}`);
    expect(r.code, r.stderr).toBe(0);
    expect(r.stdout.trim()).toBe(`stopped ${ID}`);
    expect(asManagerCalls(h.calls())).toEqual([
      // `cmd_stop`'s own `_lc_done` is the first lifecycle emit in this
      // process, so `_lc_obs`'s once-per-process pane probe comes first.
      `tmux list-panes -a -F #{session_name} #{pane_pid}`,
      `systemctl --user disable --now claude-session@${ID}`,
      `tmux kill-session -t =cc-${ID}:`,
    ]);
    expect(h.reg(ID, 'stopped')).toMatch(/^\d{10} pwa$/);
    const stops = eventsOf(h.home, 'stop');
    expect(stops).toHaveLength(1);
    expect(stops[0]!['id']).toBe(ID);
    expect(decOf(stops[0]!)['surface']).toBe('pwa');
  });

  it("cmd_stop run on stopPair's argv stops <wrapper>-<project>", () => {
    const argv = CCD_ARGV.stopPair('claude-a', 'demo', 'pwa');
    expect([...argv]).toEqual(['stop', '--surface', 'pwa', 'claude-a', 'demo']);
    const r = run(`${STOP} cmd_stop ${argsOf(argv)}`);
    expect(r.code, r.stderr).toBe(0);
    expect(r.stdout.trim()).toBe('stopped claude-a-demo');
    expect(asManagerCalls(h.calls())).toEqual([
      `tmux list-panes -a -F #{session_name} #{pane_pid}`,
      'systemctl --user disable --now claude-session@claude-a-demo',
      'tmux kill-session -t =cc-claude-a-demo:',
    ]);
    expect(h.reg('claude-a-demo', 'stopped')).toMatch(/^\d{10} pwa$/);
    const stops = eventsOf(h.home, 'stop');
    expect(stops).toHaveLength(1);
    expect(stops[0]!['id']).toBe('claude-a-demo');
    expect(decOf(stops[0]!)['surface']).toBe('pwa');
  });

  it('an id spelled --surface is refused by usage, and a planted row named pwa is not stopped', () => {
    fs.writeFileSync(path.join(REGDIR(), 'pwa.uuid'), `${'1'.repeat(36)}\n`);
    const argv = CCD_ARGV.stopId('--surface', 'pwa');
    const r = run(`${STOP} cmd_stop ${argsOf(argv)}`);
    // The redirect the trailing order allowed: a stop of `pwa`, a session nobody named.
    expect(h.reg('pwa', 'stopped'), 'pwa was stopped: the id was read as the flag').toBeNull();
    expect(readJournal(h.home), 'a lifecycle line was written').toEqual([]);
    expect(asManagerCalls(h.calls()), 'a unit or a pane was touched').toEqual([]);
    expect(r.stdout).not.toContain('stopped');
    expect(r.code).not.toBe(0);
    expect(r.stderr).toContain('usage: ccd stop');
    expect(fs.existsSync(path.join(REGDIR(), 'pwa.uuid')), 'the planted row is left as it was').toBe(true);
    expect([...argv]).toEqual(['stop', '--surface', 'pwa', '--surface']);
  });

  it('a project spelled --surface is refused by usage, and no <wrapper>-pwa is stopped', () => {
    // The pair form's redirect. Trailing, `stop claude-a --surface --surface pwa`
    // keeps `claude-a`, eats `--surface --surface` as the pair, and recomputes
    // `claude-a-pwa`. Leading, the second `--surface` has no value and dies.
    fs.writeFileSync(path.join(REGDIR(), 'claude-a-pwa.uuid'), `${'2'.repeat(36)}\n`);
    const argv = CCD_ARGV.stopPair('claude-a', '--surface', 'pwa');
    const r = run(`${STOP} cmd_stop ${argsOf(argv)}`);
    expect(h.reg('claude-a-pwa', 'stopped'), 'claude-a-pwa was stopped: the project was read as the flag')
      .toBeNull();
    expect(readJournal(h.home), 'a lifecycle line was written').toEqual([]);
    expect(asManagerCalls(h.calls()), 'a unit or a pane was touched').toEqual([]);
    expect(r.code).not.toBe(0);
    expect(r.stderr).toContain('usage: ccd stop');
    expect([...argv]).toEqual(['stop', '--surface', 'pwa', 'claude-a', '--surface']);
  });

  it('with no surface, the bare form still stops', () => {
    const one = CCD_ARGV.stopId(ID, null);
    const pair = CCD_ARGV.stopPair('claude-a', 'demo', null);
    expect([...one]).toEqual(['stop', ID]);
    expect([...pair]).toEqual(['stop', 'claude-a', 'demo']);
    const r1 = run(`${STOP} cmd_stop ${argsOf(one)}`);
    expect(r1.code, r1.stderr).toBe(0);
    expect(r1.stdout.trim()).toBe(`stopped ${ID}`);
    expect(h.reg(ID, 'stopped')).toMatch(/^\d{10} cli$/);
    const r2 = run(`${STOP} cmd_stop ${argsOf(pair)}`);
    expect(r2.code, r2.stderr).toBe(0);
    expect(r2.stdout.trim()).toBe('stopped claude-a-demo');
    expect(h.reg('claude-a-demo', 'stopped')).toMatch(/^\d{10} cli$/);
    // cmd_stop's own `cli` default is not a declaration: the journal says `none`.
    const stops = eventsOf(h.home, 'stop');
    expect(stops).toHaveLength(2);
    expect(stops.map((e) => decOf(e)['surface'])).toEqual(['none', 'none']);
  });
});

// THE PAIR PARTS. `stopPair`'s project is a legacy row's `.project`, and its
// wrapper the row's `.wrapper` when the id does not end in `-<project>`: fields
// no id gate reads. `cmd_stop`'s `--surface=*` arm strips a token of that
// spelling from ANY position, so a field reading `--surface=<word>` made the
// pair a one-argument stop of the OTHER token, in the leading, trailing and
// bare forms alike. Both callers of `stopArgvFor` now ask `stopPairRefused` in
// their identity arm and answer 503 `registry-unmeasurable`, with no argv
// composed.

/** Records every argv and never execs. tmux answers that the pane is GONE, so the archive door's fail-closed turn
 *  read is `idle` for a rostered wrapper, and only the identity arm stands between a request and its stop. */
const gonePane = (): { runner: Runner; calls: string[][] } => {
  const calls: string[][] = [];
  const runner: Runner = async (_cmd, args) => {
    calls.push([...args]);
    if (args[0] === 'has-session') return { code: 1, stdout: '', stderr: `can't find session: ${args[2] ?? ''}` };
    return { code: 0, stdout: '', stderr: '' };
  };
  return { runner, calls };
};

/** A legacy row (no `.workspace` file), with the fields `/stop` and the archive door read. */
const seedLegacy = (home: string, id: string, wrapper: string, project: string): void => {
  const reg = path.join(home, '.cc-sessions');
  fs.mkdirSync(reg, { recursive: true });
  const fields = { wrapper, project, workdir: path.join(home, 'projects', 'demo'), uuid: `u-${id}`, started: '1' };
  for (const [k, v] of Object.entries(fields)) fs.writeFileSync(path.join(reg, `${id}.${k}`), v);
};

const WITH_SURFACE: FleetState = {
  connected: true, downSince: null, ccdVerbs: ['stop', 'stop-surface'], rosterFp: null, build: null,
};
const REFUSED = { ok: false, error: 'registry-unmeasurable' };

describe('stop refuses a legacy pair part that is not a registry id', () => {
  let opened: FastifyInstance[] = [];
  afterEach(async () => { for (const a of opened) await a.close(); opened = []; });

  /** The server over its own fixture HOME. No `fleetState` is the no-evidence default, so the bare form. */
  const rig = async (fleetState?: FleetState) => {
    const home = mkTmp('ccrc-stop-pair-');
    const { runner, calls } = gonePane();
    const { app } = await appFor(home, runner, fleetState === undefined ? {} : { fleetState });
    opened.push(app);
    return { home, app, stops: () => calls.filter((c) => c[0] === 'stop') };
  };

  it('/stop refuses a pair part: a .project spelled --surface=pwa, 503 and no stopPair argv', async () => {
    // The id does not end in `---surface=pwa`, so the pair is the row's `.wrapper` and `.project`. Composed in the
    // leading form, it was `stop --surface pwa claude-a --surface=pwa`, a stop of `claude-a`.
    const r = await rig(WITH_SURFACE);
    seedLegacy(r.home, 'claude-a-demo', 'claude-a', '--surface=pwa');
    const res = await r.app.inject({ method: 'POST', url: '/api/sessions/claude-a-demo/stop' });
    expect(r.stops(), 'a stopPair argv was composed and sent').toEqual([]);
    expect(res.statusCode).toBe(503);
    expect(res.json()).toEqual(REFUSED);
  });

  it('/stop refuses a pair part: a dash-leading fallback .wrapper, 503 and no stopPair argv', async () => {
    // The id does not end in `-demo`, so the wrapper is the row's `.wrapper`. Composed with no capability evidence,
    // it was the bare `stop --surface=pwa demo`, a stop of `demo`.
    const r = await rig();
    seedLegacy(r.home, 'claude-a-legacy', '--surface=pwa', 'demo');
    const res = await r.app.inject({ method: 'POST', url: '/api/sessions/claude-a-legacy/stop' });
    expect(r.stops(), 'a stopPair argv was composed and sent').toEqual([]);
    expect(res.statusCode).toBe(503);
    expect(res.json()).toEqual(REFUSED);
  });

  it('the archive door refuses a pair part before its turn read: a .project spelled --surface=pwa, 503 and no stop', async () => {
    // `claude-a` has a config dir and its pane is gone, so the turn reads idle and nothing else refuses. Composed, it
    // was the bare `stop claude-a --surface=pwa`, a stop of `claude-a`.
    const r = await rig();
    seedLegacy(r.home, 'claude-a-demo', 'claude-a', '--surface=pwa');
    const res = await r.app.inject({ method: 'POST', url: '/api/sessions/claude-a-demo/archive' });
    expect(r.stops(), 'a stopPair argv was composed and sent').toEqual([]);
    expect(res.statusCode).toBe(503);
    expect(res.json()).toEqual(REFUSED);
  });

  it('the archive door refuses a pair part before its turn read: a dash-leading fallback .wrapper, 503 and no stop', async () => {
    // A roster id never begins with `-`, so this wrapper has no config dir. Without the identity arm's refusal, the
    // fail-closed turn read answers first, 409 `status-unknown`; the refusal stands before that read.
    const r = await rig();
    seedLegacy(r.home, 'claude-a-legacy', '--surface=pwa', 'demo');
    const res = await r.app.inject({ method: 'POST', url: '/api/sessions/claude-a-legacy/archive' });
    expect(r.stops(), 'a stopPair argv was composed and sent').toEqual([]);
    expect(res.statusCode).toBe(503);
    expect(res.json()).toEqual(REFUSED);
  });
});
```

(b) In `server/test/whitelist-subset.test.ts`, make three edits.

First, in layer 2c's `EXPECTED`, replace:

```ts
    stopId: ['stop', 'demo-quiet-basin', '--surface', 'pwa'],
    stopPair: ['stop', 'claude', 'demo', '--surface', 'pwa'],
```

with:

```ts
    // LEADING pair, then the id (path identity W1a, spec §2.3, §2.4): with the
    // id first, an id spelled `--surface` reached cmd_stop as `stop --surface
    // --surface pwa`, and its loop stopped `pwa`. `ccd-stop-argv-order.test.ts`
    // runs both rows through the real binary.
    stopId: ['stop', '--surface', 'pwa', 'demo-quiet-basin'],
    stopPair: ['stop', '--surface', 'pwa', 'claude', 'demo'],
```

Second, in the comment above `it('stop is a bare one-token grant, so --surface crosses with no widening, in both argv forms', …)`, replace:

```ts
  // for both forms `stop` actually takes, since the id form and the
  // `<wrapper> <project>` form put the flag at different offsets.
```

with:

```ts
  // for both forms `stop` actually takes: since path identity W1a the flag
  // LEADS in both (spec §2.4), and the two forms leave different residues.
```

Third, in that `it`, replace:

```ts
    expect(isExecAllowed('ccd', ['stop', 'demo-quiet-basin', '--surface', 'pwa'])).toBe(true);
    expect(isExecAllowed('ccd', ['stop', 'claude', 'demo', '--surface', 'pwa'])).toBe(true);
```

with:

```ts
    expect(isExecAllowed('ccd', ['stop', '--surface', 'pwa', 'demo-quiet-basin'])).toBe(true);
    expect(isExecAllowed('ccd', ['stop', '--surface', 'pwa', 'claude', 'demo'])).toBe(true);
```

These two literals pass under either order, because the grant is the bare `['stop']`. The change is for clarity.

(c) In `server/test/lifecycle.test.ts`, rewrite the six trailing-form rows by pattern. Run this from `server/`. The script refuses to write unless it finds exactly six rows:

```bash
node -e '
const fs = require("node:fs");
const f = "test/lifecycle.test.ts";
const src = fs.readFileSync(f, "utf8");
const re = /\[cfg\.ccdBin, \x27stop\x27, ((?:\x27[^\x27]*\x27, )*?\x27[^\x27]*\x27), \x27--surface\x27, \x27pwa\x27\]\]/g;
const n = [...src.matchAll(re)].length;
if (n !== 6) { console.error("expected 6 trailing-form stop rows, found " + n); process.exit(1); }
fs.writeFileSync(f, src.replace(re, "[cfg.ccdBin, \x27stop\x27, \x27--surface\x27, \x27pwa\x27, $1]]"));
console.log("rewrote", n, "rows");
'
grep -c "'--surface', 'pwa'\]\]" test/lifecycle.test.ts                    # 0
grep -c "\[cfg.ccdBin, 'stop', '--surface', 'pwa', " test/lifecycle.test.ts   # 6
git diff --numstat -- test/lifecycle.test.ts                               # 6	6	server/test/lifecycle.test.ts
```

Each row `[cfg.ccdBin, 'stop', <w>, <p>, '--surface', 'pwa']]` becomes `[cfg.ccdBin, 'stop', '--surface', 'pwa', <w>, <p>]]`, and the workspace row `[cfg.ccdBin, 'stop', <id>, '--surface', 'pwa']]` becomes `[cfg.ccdBin, 'stop', '--surface', 'pwa', <id>]]`. The rows sit in these six cases:
- `POST /api/sessions/:id/stop derives wrapper+project from the registry`;
- `a fleet ccd that DOES advertise stop-surface still gets --surface pwa (the capability check is not a permanent regression)`;
- `POST /api/sessions/:id/stop uses the id-prefix wrapper, not a swapped registry wrapper`;
- `POST /api/sessions/:id/stop passes a WORKSPACE id whole, never a reversed one` (the `stopId` row);
- `a new-shaped local ccd (advertises stop-surface) sends --surface pwa`;
- `boot does not block on the local-caps read; a request racing it sees no-evidence, a later one sees the real answer` (its `late` row).

The bare rows (`[cfg.ccdBin, 'stop', <w>, <p>]]`) do not match the pattern and stay as they are.

Then make two comment edits in the same file, with the Edit tool.

Replace:

```ts
  // SAME decision the route makes in that real deployment window.
```

with:

```ts
  // SAME decision the route makes in that real deployment window.
  // Since path identity W1a a flagged stop puts the pair FIRST
  // (`stop --surface pwa <id>`, spec §2.4); the trailing spelling above is
  // the measured history. The rule this test pins is unchanged: a ccd that
  // never advertised stop-surface is sent no flag, in either position.
```

Replace:

```ts
// argv below would have risked; the assertion is that it is never there.
```

with:

```ts
// argv below would have risked; the assertion is that it is never there.
// Since path identity W1a the flag, when sent, LEADS the id (spec §2.4); the
// rule pinned here is unchanged: no evidence, no flag, in either position.
```

- [ ] **Step 3: Run the tests to verify they fail**

```bash
cd server && ./node_modules/.bin/vitest run test/ccd-stop-argv-order.test.ts test/whitelist-subset.test.ts test/lifecycle.test.ts
```

Run it in the foreground, with a timeout of at least 600000 ms. Expected: 16 failures (derived; record the measured texts):
- `ccd-stop-argv-order.test.ts`, 8 of 9:
  - "cmd_stop run on stopId's argv …": `expected [ 'stop', 'demo-quiet-mesa', '--surface', 'pwa' ] to deeply equal [ 'stop', '--surface', 'pwa', 'demo-quiet-mesa' ]`.
  - "cmd_stop run on stopPair's argv …": `expected [ 'stop', 'claude-a', 'demo', '--surface', 'pwa' ] to deeply equal [ 'stop', '--surface', 'pwa', 'claude-a', 'demo' ]`.
  - "an id spelled --surface …": `pwa was stopped: the id was read as the flag: expected '<10 digits> unknown' to be null`. This is the live redirect on today's builder.
  - "a project spelled --surface …": `claude-a-pwa was stopped: the project was read as the flag: expected '<10 digits> unknown' to be null`.
  - "with no surface, the bare form still stops" PASSES. It is the control.
  - "/stop refuses a pair part: a .project …": `a stopPair argv was composed and sent: expected [ [ 'stop', 'claude-a', '--surface=pwa', '--surface', 'pwa' ] ] to deeply equal []`. This is today's trailing order, which `cmd_stop` reads as a stop of `claude-a`.
  - "/stop refuses a pair part: a dash-leading fallback .wrapper …": the same message with `[ [ 'stop', '--surface=pwa', 'demo' ] ]`, the bare form, a stop of `demo`.
  - "the archive door refuses a pair part …: a .project …": the same message with `[ [ 'stop', 'claude-a', '--surface=pwa' ] ]`.
  - "the archive door refuses a pair part …: a dash-leading fallback .wrapper …": `expected 409 to be 503`. No argv is composed today either: the door's fail-closed turn read answers `status-unknown` first, because the wrapper has no config dir. The case pins that the identity arm refuses before that read.
- `whitelist-subset.test.ts`, 2: `stopId builds the exact argv, token for token` and `stopPair builds the exact argv, token for token`, each `expected [ 'stop', …, '--surface', 'pwa' ] to deeply equal [ 'stop', '--surface', 'pwa', … ]`. The bare-grant `it` PASSES.
- `lifecycle.test.ts`, 6: the six cases listed in Step 2(c). Each fails with `expected [ [ '<ccdBin>', 'stop', …, '--surface', 'pwa' ] ] to deeply equal [ [ '<ccdBin>', 'stop', '--surface', 'pwa', … ] ]`.

If "an id spelled --surface …" PASSES here, the binary under test is not today's ccd. STOP and report `stop-redirect-not-reproduced`.

- [ ] **Step 4: Implement**

(a) In `server/src/ccdargv.ts`, replace:

```ts
   *  flag yet" instead of finding out from a fleet-wide stop that silently
   *  never happens. */
  stopId:    (id: string, surface: StopSurface | null) =>
               argv(surface === null ? ['stop', id] : ['stop', id, '--surface', surface]),
  stopPair:  (w: string, p: string, surface: StopSurface | null) =>
               argv(surface === null ? ['stop', w, p] : ['stop', w, p, '--surface', surface]),
```

with:

```ts
   *  flag yet" instead of finding out from a fleet-wide stop that silently
   *  never happens.
   *
   *  THE PAIR LEADS THE ID (path identity W1a, spec §2.3, §2.4), and the
   *  position is the safety property, not a style choice. With the id
   *  first, `cmd_stop`'s loop cannot tell an id spelled `--surface` from the
   *  key itself: `stop --surface --surface pwa` reads the first two tokens
   *  as the pair, and the residue `pwa` is stopped, a session nobody named
   *  (a project spelled `--surface` sends the pair form to `<wrapper>-pwa`
   *  the same way). With the pair first, the loop consumes one
   *  closed-grammar pair and the residue is the id: `stop --surface pwa
   *  --surface` dies on ccd's usage line and stops nothing. The server's id
   *  gates (`knownId`, `readSessionRecord`'s `bad-id`) refuse such an id
   *  before either builder runs; this order is the lock behind them, for any
   *  future caller of `stopId`. `stopPair` is narrower: its project is the
   *  legacy row's `.project`, and its wrapper the row's `.wrapper` when the
   *  id does not end in `-<project>`, fields no id gate reads. `cmd_stop`'s
   *  `--surface=*` arm strips a token of that spelling from any position, so
   *  a field reading `--surface=<word>` leaves a one-argument stop of the
   *  other token in either order, and no order can refuse it. The server
   *  refuses it before this builder runs: `stopArgvFor`'s two callers ask
   *  `stopPairRefused` (`server.ts`), which needs `isRegistryId` of each part.
   *  The order is safe on every ccd that advertises `stop-surface`,
   *  whose loop strips the flag from any position (the loop shipped in the
   *  same ccd as the token, and `ccd-session-state.test.ts`'s "takes the
   *  flag before the id as well" pins the current one). A ccd without the
   *  token is still sent no flag at all, by the `null` arm above.
   *  `ccd-stop-argv-order.test.ts` runs both builders' argv through the
   *  real `cmd_stop`. */
  stopId:    (id: string, surface: StopSurface | null) =>
               argv(surface === null ? ['stop', id] : ['stop', '--surface', surface, id]),
  stopPair:  (w: string, p: string, surface: StopSurface | null) =>
               argv(surface === null ? ['stop', w, p] : ['stop', '--surface', surface, w, p]),
```

(b) In `server/src/server.ts`, in `stopArgvFor`'s docstring, replace:

```ts
   * Important #1): a bare `['stop', id]` is what every ccd generation has
   * always understood, where `['stop', id, '--surface', 'pwa']` against an
   * old one parses as a stop of a session named `<id>---surface` — exit 0,
   * nothing real touched, and the caller reads that as success. This is the
   * deploy-ordering hazard `deploy/deploy.sh` itself does not close (the
   * agent target installs `ccd`; the default server target never does, and
   * neither cross-checks the other's version), so the check has to live here
   * instead of being a rollout note.
   *
```

with:

```ts
   * Important #1): a bare `['stop', id]` is what every ccd generation has
   * always understood, where a flagged argv against an old one misparses —
   * measured on the old trailing spelling `['stop', id, '--surface', 'pwa']`,
   * it stopped a session named `<id>---surface`: exit 0, nothing real
   * touched, and the caller reads that as success. This is the
   * deploy-ordering hazard `deploy/deploy.sh` itself does not close (the
   * agent target installs `ccd`; the default server target never does, and
   * neither cross-checks the other's version), so the check has to live here
   * instead of being a rollout note.
   *
   * With the capability, the pair LEADS the id (path identity W1a, spec §2.3,
   * §2.4): `['stop', '--surface', 'pwa', id]` for a workspace id and
   * `['stop', '--surface', 'pwa', w, p]` for a legacy one. With the id first,
   * an id spelled `--surface` became a stop of `pwa`; with the pair first,
   * ccd consumes the pair and refuses that id by usage. Both callers refuse
   * such an id before this runs (`/stop` through `readSessionRecord`'s
   * `bad-id`, the archive door through `knownId`); the order is the lock
   * behind them, argued once on `CCD_ARGV.stopId`.
   *
   * A legacy row's PAIR PARTS are vetted before this runs as well: both
   * callers ask `stopPairRefused` (above) in their identity arm and answer
   * 503 `registry-unmeasurable` for a wrapper part or project part that is
   * not a registry id, so `stopPair` below never carries one.
   *
```

(c) In `server/src/server.ts`, make four more edits, each located by content. `isRegistryId` is already imported there (Task 2).

First, insert the two closures directly above `stopArgvFor`'s docstring. Replace:

```ts
  /**
   * The stop argv — ONE spelling, two callers, both the PWA's own controls: `POST /api/sessions/:id/stop` ("Stop only",
```

with:

```ts
  /**
   * The wrapper a legacy stop names: the ORIGINAL one baked into the id when the id ends in `-<project>`, else the
   * row's `.wrapper`. One rule, read by `stopArgvFor`, which composes the pair, and by `stopPairRefused`, which vets
   * it first, so the part the check reads is the part the argv carries.
   */
  function stopPairWrapper(id: string, rec: SessionRecord, identity: { wrapper: string }): string {
    return id.endsWith(`-${rec.project}`) ? id.slice(0, id.length - rec.project.length - 1) : identity.wrapper;
  }

  /**
   * True when a stop of this row would hand `CCD_ARGV.stopPair` a part that is not a registry id (path identity W1a,
   * a coordinator ruling at plan review). The pair's project is the legacy row's `.project`, and its wrapper is the
   * row's `.wrapper` when the id does not end in `-<project>`: fields no id gate reads. `cmd_stop`'s `--surface=*`
   * arm strips a token of that spelling from ANY position, so a field reading `--surface=<word>` turned the pair
   * into a one-argument stop of the OTHER token, a session nobody named, in the leading, trailing and bare forms
   * alike. No argv order refuses that, and no ccd rule refuses it without also refusing the pre-W1a trailing order
   * while the fleet box runs ahead of this server. So each part must pass `isRegistryId`: the session-id charset,
   * which has no `=`, and no leading `-` or `.`. Both callers of `stopArgvFor` ask this in their identity arm and
   * answer what an unmeasured identity field answers, 503 `registry-unmeasurable`, with no argv composed; the
   * archive door asks it before its turn read, its claim reads and the programme's end. A workspace row is never
   * refused here: it stops by its id, which each caller's id gate has already vetted.
   */
  function stopPairRefused(id: string, rec: SessionRecord, identity: { wrapper: string }): boolean {
    if (rec.workspace !== null) return false;
    return !isRegistryId(stopPairWrapper(id, rec, identity)) || !isRegistryId(rec.project);
  }

  /**
   * The stop argv — ONE spelling, two callers, both the PWA's own controls: `POST /api/sessions/:id/stop` ("Stop only",
```

Second, in `stopArgvFor`'s body, replace:

```ts
    // Legacy ids DO encode a wrapper, and ccd stop's two-argument form
    // recomputes them — so it needs the ORIGINAL wrapper baked into the id, not
    // identity.wrapper, which a prior swap flips to the new account while the
    // id/tmux name keep the old prefix.
    const originalWrapper = id.endsWith(`-${rec.project}`)
      ? id.slice(0, id.length - rec.project.length - 1)
      : identity.wrapper;
```

with:

```ts
    // Legacy ids DO encode a wrapper, and ccd stop's two-argument form
    // recomputes them — so it needs the ORIGINAL wrapper baked into the id, not
    // identity.wrapper, which a prior swap flips to the new account while the
    // id/tmux name keep the old prefix. `stopPairWrapper` holds that rule, and
    // both callers have already asked `stopPairRefused` of the same two parts.
    const originalWrapper = stopPairWrapper(id, rec, identity);
```

The next line, `return CCD_ARGV.stopPair(originalWrapper, rec.project, surface);`, does not change: Task 15's census reads it.

Third, in `POST /api/sessions/:id/stop`, replace:

```ts
    // registry-unmeasurable shape, instead.
    const identity = measuredIdentity(read.record);
    if (identity === null) {
      return reply.code(503).send({ ok: false, error: 'registry-unmeasurable' });
    }
```

with:

```ts
    // registry-unmeasurable shape, instead. A legacy row whose pair part is
    // not a registry id (`stopPairRefused`) is refused the same way: a
    // measured field that would aim the stop at a session nobody named is no
    // more an identity than an unmeasured one.
    const identity = measuredIdentity(read.record);
    if (identity === null || stopPairRefused(id, read.record, identity)) {
      return reply.code(503).send({ ok: false, error: 'registry-unmeasurable' });
    }
```

Fourth, in `POST /api/sessions/:id/archive`, replace:

```ts
    const identity = measuredIdentity(read.record);
    if (identity === null) return reply.code(503).send({ ok: false, error: 'registry-unmeasurable' });
```

with:

```ts
    const identity = measuredIdentity(read.record);
    // `/stop`'s pair-part refusal (`stopPairRefused`), asked HERE, before the turn read, the claim reads and the
    // programme's end, so a refused part ends nothing, stops nothing and composes no argv.
    if (identity === null || stopPairRefused(id, read.record, identity)) {
      return reply.code(503).send({ ok: false, error: 'registry-unmeasurable' });
    }
```

Nothing else in `stopArgvFor` changes, and both routes' calls of `stopArgvFor(id, rec, identity)` stay as they are: Task 15 pins three call lines.

- [ ] **Step 5: Run the tests to verify they pass**

```bash
cd server && ./node_modules/.bin/vitest run test/ccd-stop-argv-order.test.ts test/whitelist-subset.test.ts test/lifecycle.test.ts
cd server && grep -rnE "'stop', (id|w, p), '--surface'|'--surface', 'pwa'\]\]" src test | grep -v 'old trailing spelling' | wc -l    # 0: no trailing-form spelling is left in code or tests; stopArgvFor's docstring names the old order once, as history, on its "old trailing spelling" line, which the grep -v drops
```

Expected: every file PASSES. Run it in the foreground, with a timeout of at least 600000 ms.

- [ ] **Step 6: Mutation check**

Make each edit, run it, see the red, and revert before the next. Revert each row by its inverse edit, never with `git checkout -- src/ccdargv.ts` or `git checkout -- src/server.ts`: until Step 8 commits, those files hold Step 4's uncommitted changes, and a checkout would discard them. Commands run from `server/`. Let S be `./node_modules/.bin/vitest run test/ccd-stop-argv-order.test.ts test/whitelist-subset.test.ts test/lifecycle.test.ts`, and T be `./node_modules/.bin/vitest run test/ccd-stop-argv-order.test.ts -t 'refuses a pair part'`. Record the before (green) and the after (red) in the SDD ledger. The red texts are derived; the measured text replaces them.

| # | Mutation (exact edit, in `server/src/ccdargv.ts` unless the row names `server.ts`) | Command | Expected red |
|---|---|---|---|
| 1 | In `stopId`, `['stop', '--surface', surface, id]` becomes `['stop', id, '--surface', surface]` (the trailing order) | S | `ccd-stop-argv-order`: "cmd_stop run on stopId's argv …" (the argv-shape assertion), and "an id spelled --surface …" with `pwa was stopped: the id was read as the flag: expected '<10 digits> unknown' to be null`. `whitelist-subset`: `stopId builds the exact argv, token for token`. `lifecycle`: `POST /api/sessions/:id/stop passes a WORKSPACE id whole, never a reversed one` |
| 2 | In `stopPair`, `['stop', '--surface', surface, w, p]` becomes `['stop', w, p, '--surface', surface]` | S | `ccd-stop-argv-order`: "cmd_stop run on stopPair's argv …" (argv shape), and "a project spelled --surface …" with `claude-a-pwa was stopped: the project was read as the flag: expected '<10 digits> unknown' to be null`. `whitelist-subset`: `stopPair builds the exact argv, token for token`. `lifecycle`: the other five cases listed in Step 2(c) |
| 3 | In `stopId`, the `null` arm `['stop', id]` becomes `['stop', '--surface', 'cli', id]` (a flag sent with no evidence) | S, then `./node_modules/.bin/vitest run test/archive-door.test.ts` | `ccd-stop-argv-order`: "with no surface, the bare form still stops": `expected [ 'stop', '--surface', 'cli', 'demo-quiet-mesa' ] to deeply equal [ 'stop', 'demo-quiet-mesa' ]`. `lifecycle` and `whitelist-subset` stay GREEN: every bare `lifecycle` row is the legacy pair form (`stopPair`), and `whitelist-subset` builds `stopId` with `'pwa'` only. `archive-door` (derived): its workspace-id stop rows, `['stop', 'demo-amber']`, receive the flagged argv and red. This row pins that the reorder never touched the skew arm |
| 4 | In `server/src/server.ts`, `POST /api/sessions/:id/stop`'s identity arm: `if (identity === null \|\| stopPairRefused(id, read.record, identity)) {` becomes `if (identity === null) {` | T | "/stop refuses a pair part: a .project …": `a stopPair argv was composed and sent: expected [ [ 'stop', '--surface', 'pwa', 'claude-a', '--surface=pwa' ] ] to deeply equal []`. "/stop refuses a pair part: a dash-leading fallback .wrapper …": the same message with `[ [ 'stop', '--surface=pwa', 'demo' ] ]`. Both archive cases stay GREEN: their arm is a separate line |
| 5 | In `server/src/server.ts`, the same edit in `POST /api/sessions/:id/archive`'s identity arm | T | "the archive door refuses a pair part …: a .project …": `a stopPair argv was composed and sent: expected [ [ 'stop', 'claude-a', '--surface=pwa' ] ] to deeply equal []`. "… a dash-leading fallback .wrapper …": `expected 409 to be 503`. Its argv is still not composed, because the fail-closed turn read refuses `status-unknown` first (a roster id never begins with `-`, so the wrapper has no config dir). Both `/stop` cases stay GREEN |
| 6 | In `server/src/server.ts`'s `stopPairRefused`, delete ` \|\| !isRegistryId(rec.project)` | T | The two `.project` cases, each with its row 4 or row 5 text. The two `.wrapper` cases stay GREEN |
| 7 | In `server/src/server.ts`'s `stopPairRefused`, delete `!isRegistryId(stopPairWrapper(id, rec, identity)) \|\| ` | T | The two `.wrapper` cases, each with its row 4 or row 5 text. The two `.project` cases stay GREEN |

After the last revert, `git diff --stat -- server/src/ccdargv.ts` must show only Step 4(a)'s hunk, and `git diff -- server/src/server.ts` only Step 4(b)'s and (c)'s.

- [ ] **Step 7: The other named suites, the guards and the typecheck**

```bash
cd server && ./node_modules/.bin/vitest run test/archive-door.test.ts test/verb-gate.test.ts test/ccdargv-dec-parity.test.ts test/readme-holds.test.ts test/routes.test.ts
cd server && ./node_modules/.bin/vitest run test/ccd-workspaces.test.ts -t 'routes EVERY bash call site'
cd server && ./node_modules/.bin/vitest run test/typecheck-tests.test.ts
cd server && ./node_modules/.bin/tsc --noEmit -p . && ./node_modules/.bin/tsc --noEmit -p test/tsconfig.tests.json
```

Expected: every file PASSES, and both `tsc` runs print nothing. Run each line in the foreground, with a timeout of at least 600000 ms.
- `archive-door` sends no surface, so its stop rows are unchanged. Its legacy row, `claude-a-demo`, takes its wrapper from the id's own prefix and its project is `demo`, so `stopPairRefused` passes it.
- `routes`' two 503 cases for `/stop` and the archive door (an unreadable `.wrapper`) still answer from the identity arm's `identity === null` half. Its fully measured `/stop` case still stops: that row's `.project` equals its id, so the wrapper is the row's `.wrapper`, `claude-a`, and both parts pass.
- `verb-gate` reads `stopArgvFor` as a `function` declaration, and stop stays `UNGATED_BY_DECISION`.
- `ccdargv-dec-parity` scans only `argv([…])` literals, and stop's builders are ternaries.
- `readme-holds` pins `stopSurfaceSupported`'s delegation, which is untouched.
- The `ccd-workspaces` case is the containment scan that reads the new `ccd-*.ts` file: its `spawnSync('bash', …)` must sit within reach of `ghContainedEnv(`, `systemd: true` and `tmux: true`. Its red would be `ccd-stop-argv-order.test.ts:<n> spawns bash without ghContainedEnv`.

`ccdargv-dec-parity` runs the real binary. If it reds, re-run it alone before calling it a break.

- [ ] **Step 8: Commit**

```bash
git add server/src/ccdargv.ts server/src/server.ts \
  server/test/ccd-stop-argv-order.test.ts server/test/whitelist-subset.test.ts server/test/lifecycle.test.ts
git commit -m "$(cat <<'MSG'
fix(ccdargv): stop sends --surface before the id

stopId and stopPair now compose ['stop', '--surface', surface, id] and
['stop', '--surface', surface, w, p]. With the id first, an id spelled
--surface reached cmd_stop as `stop --surface --surface pwa`, whose loop
read the first two tokens as the pair and stopped pwa, a session nobody
named; a project spelled --surface sent the pair form to <wrapper>-pwa
the same way. With the pair first, the loop consumes one closed-grammar
pair and the residue is the id: `stop --surface pwa --surface` dies on
usage and stops nothing.

The order is safe on every ccd that advertises stop-surface, whose loop
strips the flag from any position; a ccd without the token is still sent
no flag. ccd-stop-argv-order.test.ts runs both builders' argv through the
real cmd_stop in a fixture HOME. whitelist-subset's EXPECTED rows and its
two isExecAllowed literals, and lifecycle's six stop rows, take the
leading form; stopArgvFor's docstring and two lifecycle comments say so.
Spec §2.3, §2.4.

A legacy row's pair parts are refused before the pair is composed. /stop
and the archive door ask stopPairRefused in their identity arm, and a
wrapper part or project part that fails isRegistryId answers 503
registry-unmeasurable with no argv; the archive door asks before its turn
read and the programme's end. cmd_stop strips a --surface=<word> token
from any position, so such a field stopped the other token in every argv
order, and no ccd rule refuses it without also refusing the old trailing
order mid-rollout. Four cases in ccd-stop-argv-order.test.ts drive both
routes over planted legacy rows.
MSG
)"
```

Name this task's plan-text corrections and extra pins in the wave-done, by slug: `stop-pair-project-redirect-pinned` and `lifecycle-rows-edited-by-pattern`. Name its departure too: `stop-pair-fields-refused-at-composition` (a coordinator ruling at plan review).

---

### Task 15: The id-argv census

**Model routing:** `sonnet`, effort `high`. This task adds one test file and changes no source. It measures the gates that Tasks 2 to 14 built. Review Focus 5 depends on it: a 42nd id-taking call, or a new builder, has to be classified here or the suite goes red.

**Why (spec §2.3, SEC2 B):**
- Spec §2.3 counts 41 direct calls of the 26 id-taking builders, across 10 files.
- R98 widens the SECURITY carry to every id source: request ids, stored rows, registry names and the executor seams. Each one has its own gate, built by Tasks 2 to 14.
- Those tasks' behaviour suites prove that each gate refuses. This census proves two more things:
  - no id-taking call exists without an origin and a gate;
  - each gate's text still stands where the census says it does.
- The classification over builder keys follows `whitelist-subset.test.ts`'s `EXPECTED: Record<keyof typeof CCD_ARGV, …>` precedent. The claim pin follows `routes.test.ts`'s `knownId` claim precedent.

**Files:**
- Create: `server/test/id-argv-census.test.ts`.
- Read, never edited. These are the anchors the census pins, located by content (the text Tasks 2 to 14 wrote, with the frame's Interfaces and scopes as their source):
  - `server/src/server.ts`:
    - `knownId`'s first statement, `if (!isRegistryId(id)) return false;` (Task 2);
    - `/ensure`'s `if (!isRegistryId(id))` straight after `const { id } = req.params as { id: string };` (Task 2, R22);
    - the cross arm's `if (!isRegistryId(id))` as the first statement inside `if (body.crossPool === true) {` (Task 2, R22);
    - the `/stop` route's `readSessionRecord(deps.io, deps.cfg, id)` and the `/archive` route's `knownId(id)`, each above its `stopArgvFor(id, rec, identity)`.
  - `server/src/registry.ts`:
    - `readSessionRecord`'s first statement, `if (!isRegistryId(id)) return { kind: 'bad-id' };` (Task 4);
    - an `isRegistryId(` call inside `readRegistryMeasured` (Task 5).
  - `server/src/coord/routes.ts`:
    - `POST /api/runs`: `!isRegistryId(claimedBy)`, then `!isRegistryId(sessionId)` (Task 9);
    - the routing door: `if (!isRegistryId(sid)) {` (Task 10);
    - advance: `if (!isRegistryId(run.sessionId)) return reply.code(409).send({ ok: false, reject: { code: 'bad-session' } });` as the first statement inside `if (to === 'awaiting-review' || to === 'merging') {` (Task 11).
  - `server/src/coord/dispatch.ts`: `if (run.sessionId !== null && !isRegistryId(run.sessionId)) return { ok: false, kind: 'bad-session' };` straight after `if (!hold.ok) return hold;` (Task 3).
  - `server/src/coord/close.ts`:
    - the abandon branch's `isRegistryId(run.sessionId)` check, followed by its `'fleet-act-omitted:bad-session'` event (Task 3, R27);
    - the non-abandon gate's `!isRegistryId(run.sessionId)) … kind: 'bad-session' …;` straight above `if (run.kind === 'review') return closeReviewRun(` (Task 3).
  - `server/src/coord/fingerprint.ts`: `resolveDoneBranch`'s block `if (!isRegistryId(run.sessionId)) {`, whose first statement is `return { ok: false, code: 'tip-unmeasurable', …` (Task 6).
  - `server/src/coord/childReclaim.ts`: `childReclaimOutcome`'s `deferred('marker-unreadable', 'the session id is not a registry id')` (Task 4).
  - `server/src/coord/expireArchived.ts`: `!isRegistryId(sessionId)` with `EXPIRE_ID_REFUSED`, ahead of `capSupported(deps.fleetState, EXPIRE_CAP)`, in both `expireArchived` and `learnExpiry` (Task 12, R28).
  - `server/src/coord/collectTempRoot.ts`: `if (!isTmpRootId(job.id)) return { kind: 'not-asked', step: 1, why: 'id-refused'` (existing; pinned by Task 13).
  - `server/src/collectLane.ts`: `if (isTmpRootId(n)) witnessed.add(n); else refusedNames += 1;` inside `collectPopulation`, and its record half `return id !== undefined && isTmpRootId(id) ? id : null;` inside `parseCollectRecordName` (both existing; pinned by Task 13, Rows 1 and 3).
- NOT edited: anything under `server/src/`, `shared/`, `ccd/`, `agent/`, `pwa/`, and every existing test file.

**Interfaces:**
- Consumes:
  - `CCD_ARGV` (`server/src/ccdargv.ts`; 42 keys, `as const`);
  - `codeOnly(s: string): string` (`server/test/sourceScan.ts`);
  - `type CollectToken` (`shared/api.ts`);
  - the gate texts listed under **Files**, which Tasks 2, 3, 4, 5, 6, 9, 10, 11 and 12 wrote.
- Produces only test-local names, none exported:
  ```ts
  const ID_BUILDERS: { readonly [K in keyof typeof CCD_ARGV]: 'id' | 'no-id' };   // as const satisfies Record<keyof typeof CCD_ARGV, 'id' | 'no-id'>; 26 'id'
  type IdBuilder;                                   // the keys classified 'id'
  const ID_PROBE: { [K in IdBuilder]: Parameters<(typeof CCD_ARGV)[K]> };   // the id slot holds PROBE_ID
  const GATES: Readonly<Record<Gate, { file: string; scope: string; re: RegExp }>>;
  const CENSUS: readonly CensusRow[];               // 41 rows: { file, scope, builder, id, origin[], gate[], entry? }
  function scanSource(src: string, file: string): Site[];
  function scopeText(file: string, name: string): string | null;
  ```

- [ ] **Step 1: Re-measure the tip. Tasks 2 to 14 are committed; measure, never assume.**

From `server/`:

```bash
# (1) the 41 calls, and their per-file split: 3 1 7 2 5 2 1 3 15 2 in the order printed
grep -rnE 'CCD_ARGV\.(ensure|stopId|stopPair|forget|swap|swapCross|prStateSession|prOpen|wsArchive|wsRestore|wsAudit|wsReap|wsReclaimAudit|wsReclaim|wsExpireAudit|wsExpire|wsCollectAudit|wsCollect|wsAttic|wsHold|wsRelease|wsRename|route|routeApply|routeSet|winSize)\s*\(' src --include=*.ts | grep -vE '^\S+:[0-9]+:\s*(//|\*|/\*)' | wc -l
grep -rnE 'CCD_ARGV\.(ensure|stopId|stopPair|forget|swap|swapCross|prStateSession|prOpen|wsArchive|wsRestore|wsAudit|wsReap|wsReclaimAudit|wsReclaim|wsExpireAudit|wsExpire|wsCollectAudit|wsCollect|wsAttic|wsHold|wsRelease|wsRename|route|routeApply|routeSet|winSize)\s*\(' src --include=*.ts | grep -vE '^\S+:[0-9]+:\s*(//|\*|/\*)' | cut -d: -f1 | sort | uniq -c
# (2) 42 builder keys
awk '/^export const CCD_ARGV = \{/{f=1} f&&/^}/{exit} f' src/ccdargv.ts | grep -cE '^  [A-Za-z]+: *\('
# (3) the gate homes, each 1 unless stated
grep -c 'if (!isRegistryId(id)) return false;' src/server.ts
grep -c "if (!isRegistryId(id)) return { kind: 'bad-id' };" src/registry.ts
grep -c "if (run.sessionId !== null && !isRegistryId(run.sessionId)) return { ok: false, kind: 'bad-session' };" src/coord/dispatch.ts
grep -c "'fleet-act-omitted:bad-session'" src/coord/close.ts
grep -c "if (run.kind === 'review') return closeReviewRun(" src/coord/close.ts
grep -c '!isRegistryId(claimedBy)' src/coord/routes.ts
grep -c '!isRegistryId(sessionId)' src/coord/routes.ts                                  # >= 1
grep -c 'if (!isRegistryId(sid)) {' src/coord/routes.ts
grep -c "if (!isRegistryId(run.sessionId)) return reply.code(409).send({ ok: false, reject: { code: 'bad-session' } });" src/coord/routes.ts
grep -A1 -F 'if (!isRegistryId(run.sessionId)) {' src/coord/fingerprint.ts | grep -c "return { ok: false, code: 'tip-unmeasurable',"   # 1: Task 6's block, its return on the next line
grep -c "deferred('marker-unreadable', 'the session id is not a registry id')" src/coord/childReclaim.ts
grep -c 'EXPIRE_ID_REFUSED' src/coord/expireArchived.ts                                  # 3: the constant and two uses
grep -c "if (!isTmpRootId(job.id)) return { kind: 'not-asked', step: 1, why: 'id-refused'" src/coord/collectTempRoot.ts
grep -c 'if (isTmpRootId(n)) witnessed.add(n); else refusedNames += 1;' src/collectLane.ts
# (4) the files that import isRegistryId from shared/api.js: exactly the nine gate files
node -e '
const fs = require("fs"), path = require("path");
const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => e.isDirectory() ? walk(path.join(d, e.name)) : (e.name.endsWith(".ts") && !e.name.startsWith("__")) ? [path.join(d, e.name)] : []);
const re = /import\s*\{[^}]*\bisRegistryId\b[^}]*\}\s*from\s*.(?:\.\.\/)+shared\/api\.js./;
console.log(walk("src").filter((f) => re.test(fs.readFileSync(f, "utf8"))).map((f) => path.relative("src", f)).sort().join(" "));'
# expected: coord/close.ts coord/dispatch.ts coord/expireArchived.ts coord/fingerprint.ts coord/reclaim.ts coord/routes.ts registry.ts server.ts watch.ts
# (5) overlaps
gh pr view 351 --json state -q .state
gh pr list --state all --json number,state,title -q '.[] | "\(.number) \(.state) \(.title)"' | grep -i 'collector' | grep -i 'wave 10\|settings'
```

Record every answer in the SDD ledger. Rules:
- **(1) not 41, or (2) not 42, because #351 or run 400 has merged** (from (5)):
  - Read each new call by content. Add its row to `CENSUS` with the origin and gate it has as built, and move the CLAIM line and the claim test's title to the new count. Record it.
  - A new builder key gets its `ID_BUILDERS` and, if it is `id`, its `ID_PROBE` entry.
  - If a new call's id reaches it with no gate that this wave or an earlier wave built: STOP, `id-argv-call-ungated`.
- **(3) prints 0 where 1 is stated:**
  - The gate exists, spelled in an equivalent way: re-point that `GATES` entry's regex to the committed text by content and record it under `id-argv-census-anchor-repointed`. Never loosen a regex to a bare `isRegistryId(`.
  - The gate is absent: STOP, `gate-missing-at-census`, naming it.
- **(4) differs:** record the difference. A missing file is a STOP, `gate-missing-at-census`. An extra file is recorded, and `GATE_FILES` gains it only if the coordinator agrees.

- [ ] **Step 2: Write `server/test/id-argv-census.test.ts`**

```ts
// THE ID-ARGV CENSUS (path identity W1a, spec §2.3).
//
// Every call of an id-taking `CCD_ARGV` builder in `server/src` is listed below, with where its id comes from and the
// check that stands before it, so that no id ccd could read as a flag reaches an argv the server composes unexamined.
// The scan is the discovery half and the table is the classification half, the same two-way shape as
// `verb-gate.test.ts` and `routes.test.ts`'s knownId census. A new call, or a new builder key, must classify itself
// here, or this suite goes red.
//
// THE CLAIM: 41 id-taking calls across 10 files.
//
// Origins:
//   `request`   a route's own parameter or body;
//   `stored`    a coord.db run row;
//   `registry`  a name the registry listing produced;
//   `collector` the collector's population.
// Gates: each names a check by its HOME (file, scope, text). When the home is the call's own scope, its text must
// stand above the call. When the call's scope reaches a gate that lives elsewhere, the row's `entry` must stand above
// the call. A gate in a caller (close's gates above `closeReviewRun` and `verifyDone`, dispatch's gate above
// `refuseSpentChild`) is pinned at its home only.
//
// WHAT THIS DOES NOT COVER, stated plainly:
// - It recognises a call by the literal text `CCD_ARGV.<name>(`. An argv obtained any other way is invisible to it;
//   `ccdargv-brand.test.ts` and `whitelist-subset.test.ts` police argv provenance.
// - A gate is checked by its text standing in place, not by tracing every path. That each gate REFUSES is proved by
//   the behaviour suites: `knownid-registry-id`, `stored-row-id-gates`, `single-read-bad-id`, `registry-refused`,
//   `registry-refused-callers`, `run-open-registry-id`, `run-route-registry-id`, `advance-registry-id`,
//   `expire-id-boundary`, `collect-id-pins` and `ccd-stop-argv-order`.
// - The server gate is not an OS wall: a session can still run `ccd` itself. ccd's own half is a later wave.
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { CCD_ARGV } from '../src/ccdargv.js';
import type { CollectToken } from '../../shared/api.js';
import { codeOnly } from './sourceScan.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const srcRoot = path.resolve(here, '..', 'src');

/** Every `CCD_ARGV` key, classified by whether its argv carries a session or temp-root id (spec §2.3's 26). A new key
 *  is a tsc error here (`typecheck-tests`) and a red first case below, until someone decides which it is. */
const ID_BUILDERS = {
  start: 'no-id', enable: 'no-id', startCross: 'no-id', enableCross: 'no-id',
  ensure: 'id', stopId: 'id', stopPair: 'id', forget: 'id', swap: 'id', swapCross: 'id',
  wsAdd: 'no-id', wsAddWorker: 'no-id',
  prStateSession: 'id', prStateProject: 'no-id', prOpen: 'id',
  wsArchive: 'id', wsRestore: 'id', wsAudit: 'id', wsReap: 'id',
  wsReclaimAudit: 'id', wsReclaim: 'id', wsExpireAudit: 'id', wsExpire: 'id',
  wsCollectAudit: 'id', wsCollect: 'id', wsAttic: 'id',
  wsHold: 'id', wsRelease: 'id', wsRename: 'id',
  coordPause: 'no-id', reclaimPause: 'no-id', projectPoolSet: 'no-id', projectPoolClear: 'no-id',
  route: 'id', routeApply: 'id', routeSet: 'id', winSize: 'id',
  docsIndex: 'no-id', docsTree: 'no-id', docsShowCommitted: 'no-id', docsShowDraft: 'no-id', docsFetch: 'no-id',
} as const satisfies Record<keyof typeof CCD_ARGV, 'id' | 'no-id'>;

type IdBuilder = {
  [K in keyof typeof ID_BUILDERS]: (typeof ID_BUILDERS)[K] extends 'id' ? K : never;
}[keyof typeof ID_BUILDERS];

const isIdBuilder = (k: string): k is IdBuilder =>
  (ID_BUILDERS as Readonly<Record<string, 'id' | 'no-id'>>)[k] === 'id';

const ID_KEYS: readonly IdBuilder[] = Object.keys(ID_BUILDERS).filter(isIdBuilder);

/** A dash-leading probe id: each id builder must carry it into its argv. */
const PROBE_ID = '--census-probe-id';

/** One well-typed call per id builder, with PROBE_ID in its id slot. The slot's index is where the scan reads each
 *  call's id argument, so the index is measured, never hand-kept. */
const ID_PROBE = {
  ensure: [PROBE_ID],
  stopId: [PROBE_ID, 'pwa'],
  stopPair: [PROBE_ID, 'demo', 'pwa'],
  forget: [PROBE_ID],
  swap: [PROBE_ID, 'acct-a'],
  swapCross: [PROBE_ID, 'acct-a'],
  prStateSession: [PROBE_ID],
  prOpen: [PROBE_ID, 'a title', 'Ym9keQ==', false],
  wsArchive: [PROBE_ID, null],
  wsRestore: [PROBE_ID, null],
  wsAudit: [PROBE_ID],
  wsReap: ['probe-token', PROBE_ID],
  wsReclaimAudit: [PROBE_ID, false],
  wsReclaim: ['probe-token', 7, PROBE_ID, false, null],
  wsExpireAudit: [PROBE_ID],
  wsExpire: ['probe-token', PROBE_ID, null],
  wsCollectAudit: [PROBE_ID],
  wsCollect: ['probe-token' as CollectToken, PROBE_ID, null],
  wsAttic: [PROBE_ID],
  wsHold: [PROBE_ID, 'a reason', null],
  wsRelease: [PROBE_ID, null],
  wsRename: [PROBE_ID, 'a-branch', null],
  route: [PROBE_ID, 'class', 'x', null],
  routeApply: [PROBE_ID, 'class', 'x', null],
  routeSet: [PROBE_ID, { effort: 'high' }, null],
  winSize: [PROBE_ID, 'smallest'],
} satisfies { [K in IdBuilder]: Parameters<(typeof CCD_ARGV)[K]> };

const ID_ARG_AT: Readonly<Record<string, number>> = Object.fromEntries(
  Object.entries(ID_PROBE).map(([k, args]) => [k, (args as readonly unknown[]).indexOf(PROBE_ID)]),
);

/** A scope head: a route registration, a function, a nested function, an async const arrow, or a class method. The
 *  scope of a call is the last head at or above its line. */
const HEADS: readonly (readonly [RegExp, (m: RegExpExecArray) => string | null])[] = [
  [/^ {2}app\.(get|post)\(\s*'([^']+)'/, (m) => `${m[1]!.toUpperCase()} ${m[2]!}`],
  [/^(?:export )?(?:async )?function (\w+)/, (m) => m[1]!],
  [/^ {2}(?:async )?function (\w+)/, (m) => m[1]!],
  [/^(?: {2})?(?:export )?const (\w+) = async \(/, (m) => m[1]!],
  [/^ {2}(?:private |public |protected )?(?:static )?(?:async )?(\w+)\([^)]*\)[^{;]*\{\s*$/,
    (m) => (/^(?:if|for|while|switch|catch)$/.test(m[1]!) ? null : m[1]!)],
];

interface Head { readonly name: string; readonly line: number }

function headOf(line: string): string | null {
  for (const [re, name] of HEADS) {
    const m = re.exec(line);
    if (m !== null) {
      const n = name(m);
      if (n !== null) return n;
    }
  }
  return null;
}

function headsOf(lines: readonly string[]): Head[] {
  const out: Head[] = [];
  lines.forEach((l, i) => {
    const n = headOf(l);
    if (n !== null) out.push({ name: n, line: i });
  });
  return out;
}

function lastHeadAtOrBefore(heads: readonly Head[], line: number): Head | null {
  let found: Head | null = null;
  for (const h of heads) {
    if (h.line > line) break;
    found = h;
  }
  return found;
}

/** `codeOnly`'s output with every string and template body blanked to spaces, line for line and length for length,
 *  so a quoted builder name is not a call and a quoted comma or bracket does not split an argument. */
const STRING = /'(?:\\.|[^\\'\n])*'|"(?:\\.|[^\\"\n])*"|`(?:\\[\s\S]|[^\\`])*`/g;
const blankStrings = (code: string): string =>
  code.replace(STRING, (m) => m[0] + m.slice(1, -1).replace(/[^\n]/g, ' ') + m[m.length - 1]);

/** The top-level arguments of the call whose `(` ends just before `open`, and the index of its closing paren. */
function argsFrom(bare: string, open: number): { readonly args: string[]; readonly close: number } | null {
  const args: string[] = [];
  let depth = 0;
  let cur = '';
  for (let i = open; i < bare.length; i++) {
    const c = bare[i]!;
    if (c === '(' || c === '[' || c === '{') depth++;
    else if (c === ')' || c === ']' || c === '}') {
      if (depth === 0) {
        args.push(cur);
        return { args, close: i };
      }
      depth--;
    } else if (c === ',' && depth === 0) {
      args.push(cur);
      cur = '';
      continue;
    }
    cur += c;
  }
  return null;
}

interface Site {
  readonly file: string;
  readonly scope: string | null;
  readonly builder: IdBuilder;
  readonly id: string;
  readonly line: number;
  /** The scope's code from its head down to the call's own line, comments dropped, strings kept. */
  readonly before: string;
}

function scanSource(src: string, file: string): Site[] {
  const code = codeOnly(src);
  const bare = blankStrings(code);
  const lines = code.split('\n');
  const heads = headsOf(lines);
  const sites: Site[] = [];
  const re = /CCD_ARGV\.([A-Za-z]\w*)\s*\(/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(bare)) !== null) {
    const builder = m[1]!;
    if (!isIdBuilder(builder)) continue;
    const call = argsFrom(bare, m.index + m[0].length);
    if (call === null) throw new Error(`${file}: CCD_ARGV.${builder}( never closes`);
    // A NAME READ IS NOT A CALL: `CCD_ARGV.<name>(…)[0]` takes the verb and throws the argv away, as verb-gate reads it.
    if (bare.slice(call.close + 1, call.close + 4) === '[0]') continue;
    const line = bare.slice(0, m.index).split('\n').length - 1;
    const head = lastHeadAtOrBefore(heads, line);
    sites.push({
      file,
      scope: head === null ? null : head.name,
      builder,
      id: (call.args[ID_ARG_AT[builder]!] ?? '').replace(/\s+/g, ' ').trim(),
      line: line + 1,
      before: head === null ? '' : lines.slice(head.line, line + 1).join('\n'),
    });
  }
  return sites;
}

/** Every `.ts` file under `dir`. `__`-prefixed entries are TRANSIENT mutants written by a parallel suite (`boot.test.ts`
 *  writes `server/src/__boot_control_mutant__.ts` for about 15 s): the same skip, for the same reason, as
 *  `single-definition.test.ts`'s `sources`. */
function sourcesUnder(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => (
    e.name.startsWith('__') ? []
      : e.isDirectory() ? sourcesUnder(path.join(dir, e.name))
        : e.name.endsWith('.ts') ? [path.join(dir, e.name)] : []
  ));
}

const rel = (f: string): string => path.relative(srcRoot, f).split(path.sep).join('/');

const SITES: readonly Site[] = sourcesUnder(srcRoot).sort()
  .flatMap((f) => scanSource(readFileSync(f, 'utf8'), rel(f)));

/** The named scope's code, from its head to the next head. Take the LAST head of that name: an overloaded function's
 *  body follows its signatures (`closeRun` has two). */
function scopeText(file: string, name: string): string | null {
  const lines = codeOnly(readFileSync(path.join(srcRoot, file), 'utf8')).split('\n');
  const heads = headsOf(lines);
  let at = -1;
  for (let i = 0; i < heads.length; i++) if (heads[i]!.name === name) at = i;
  if (at < 0) return null;
  const end = at + 1 < heads.length ? heads[at + 1]!.line : lines.length;
  return lines.slice(heads[at]!.line, end).join('\n');
}

interface GateHome { readonly file: string; readonly scope: string; readonly re: RegExp }

const EXPIRY_STEP_0 = /!isRegistryId\(sessionId\)[^;]*EXPIRE_ID_REFUSED[\s\S]*?capSupported\(deps\.fleetState, EXPIRE_CAP\)/;

/** Where each check is written, and its text (spec §2.3). */
const GATES = {
  /** `knownId`'s first statement: a non-registry id is unknown before any listing. */
  knownId: { file: 'server.ts', scope: 'knownId', re: /Promise<boolean> => \{\s*if \(!isRegistryId\(id\)\) return false;/ },
  /** `/ensure`'s own check, right after it reads its id. */
  'ensure-route-head': {
    file: 'server.ts', scope: 'POST /api/sessions/:id/ensure',
    re: /const \{ id \} = req\.params as \{ id: string \};\s*if \(!isRegistryId\(id\)\)/,
  },
  /** The cross-pool arm's first statement, ahead of its skew gate. */
  'cross-arm-head': {
    file: 'server.ts', scope: 'POST /api/sessions/:id/swap',
    re: /if \(body\.crossPool === true\) \{\s*if \(!isRegistryId\(id\)\)/,
  },
  /** `readSessionRecord` answers `bad-id` before any listing, so a caller only ever holds a found row's valid id. */
  readSessionRecord: {
    file: 'registry.ts', scope: 'readSessionRecord',
    re: /Promise<SingleRead> \{\s*if \(!isRegistryId\(id\)\) return \{ kind: 'bad-id' \};/,
  },
  /** `readRegistryMeasured` refuses a non-registry name: it is never read, built or composed. */
  'registry-refused': { file: 'registry.ts', scope: 'readRegistryMeasured', re: /\bisRegistryId\(/ },
  /** `POST /api/runs` checks `claimedBy`, then `sessionId`, as given. */
  'run-open-checks': {
    file: 'coord/routes.ts', scope: 'POST /api/runs',
    re: /!isRegistryId\(claimedBy\)[\s\S]*?!isRegistryId\(sessionId\)/,
  },
  /** The routing door asks the predicate of the stored id it is about to write. */
  'routing-door': { file: 'coord/routes.ts', scope: 'POST /api/runs/:id/route', re: /if \(!isRegistryId\(sid\)\) \{/ },
  /** Advance re-checks the stored id before `verifyDone`, and only there. */
  'advance-gate': {
    file: 'coord/routes.ts', scope: 'POST /api/runs/:id/advance',
    re: /if \(to === 'awaiting-review' \|\| to === 'merging'\) \{\s*if \(!isRegistryId\(run\.sessionId\)\) return reply\.code\(409\)\.send\(\{ ok: false, reject: \{ code: 'bad-session' \} \}\);/,
  },
  /** Dispatch re-checks the stored id straight after the hold verdict, before any read. */
  'dispatch-gate': {
    file: 'coord/dispatch.ts', scope: 'dispatchRun',
    re: /if \(!hold\.ok\) return hold;\s*if \(run\.sessionId !== null && !isRegistryId\(run\.sessionId\)\) return \{ ok: false, kind: 'bad-session' \};/,
  },
  /** The abandon arm closes a bad stored id `failed` with no fleet act, and records its one event. */
  'close-abandon-branch': {
    file: 'coord/close.ts', scope: 'closeRun',
    re: /isRegistryId\(run\.sessionId\)[\s\S]*?'fleet-act-omitted:bad-session'/,
  },
  /** Every other close refuses `bad-session`, straight above the review hand-off. */
  'close-gate': {
    file: 'coord/close.ts', scope: 'closeRun',
    re: /!isRegistryId\(run\.sessionId\)\)[^;]*kind: 'bad-session'[^;]*;\s*\}?\s*if \(run\.kind === 'review'\) return closeReviewRun\(/,
  },
  /** `resolveDoneBranch` holds a refused id (`tip-unmeasurable`), so a review close reaches no `pr-state` for it. */
  'fingerprint-check': {
    file: 'coord/fingerprint.ts', scope: 'resolveDoneBranch',
    re: /if \(!isRegistryId\(run\.sessionId\)\) \{\s*return \{ ok: false, code: 'tip-unmeasurable'/,
  },
  /** The child-reclaim executor defers a bad id before either of its builders. */
  'child-reclaim-outcome': {
    file: 'coord/childReclaim.ts', scope: 'childReclaimOutcome',
    re: /deferred\('marker-unreadable', 'the session id is not a registry id'\)/,
  },
  /** Expiry's step 0, before its capability read. */
  'expiry-step-0': { file: 'coord/expireArchived.ts', scope: 'expireArchived', re: EXPIRY_STEP_0 },
  /** The learning audit's own step 0, before its capability read. */
  'learn-expiry-step-0': { file: 'coord/expireArchived.ts', scope: 'learnExpiry', re: EXPIRY_STEP_0 },
  /** The collector executor's step 1. */
  'collector-step-1': {
    file: 'coord/collectTempRoot.ts', scope: 'collectTempRoot',
    re: /if \(!isTmpRootId\(job\.id\)\) return \{ kind: 'not-asked', step: 1, why: 'id-refused'/,
  },
  /** The population gate's witness half; with the record half below, the learning audit's only id check. */
  'collector-population': {
    file: 'collectLane.ts', scope: 'collectPopulation',
    re: /if \(isTmpRootId\(n\)\) witnessed\.add\(n\); else refusedNames \+= 1;/,
  },
  /** The population gate's record half: a quarantine record names an id only when that id passes the predicate. */
  'collector-record-name': {
    file: 'collectLane.ts', scope: 'parseCollectRecordName',
    re: /return id !== undefined && isTmpRootId\(id\) \? id : null;/,
  },
} as const satisfies Readonly<Record<string, GateHome>>;

type Gate = keyof typeof GATES;

type Origin = 'request' | 'stored' | 'registry' | 'collector';

interface CensusRow {
  readonly file: string;
  readonly scope: string;
  readonly builder: IdBuilder;
  /** The id argument's source text, whitespace collapsed. */
  readonly id: string;
  readonly origin: readonly Origin[];
  readonly gate: readonly Gate[];
  /** When the gate lives outside the call's scope: the call the scope makes to it, above the call. */
  readonly entry?: RegExp;
}

const KNOWN_ID = /\bknownId\(\s*id\s*\)/;

/** The 41 calls. Rows of one key (file, scope, builder, id) are in source order. */
const CENSUS: readonly CensusRow[] = [
  // coord/childReclaim.ts: the close path's child gate (masked by close's gates) and the sweep both reach the one executor.
  { file: 'coord/childReclaim.ts', scope: 'childReclaimAudit', builder: 'wsReclaimAudit', id: 'req.sessionId', origin: ['stored', 'registry'], gate: ['child-reclaim-outcome'] },
  { file: 'coord/childReclaim.ts', scope: 'childReclaimAct', builder: 'wsReclaim', id: 'req.sessionId', origin: ['stored', 'registry'], gate: ['child-reclaim-outcome'] },
  { file: 'coord/childReclaim.ts', scope: 'releaseRetiredChildHold', builder: 'wsRelease', id: 'sessionId', origin: ['registry'], gate: ['readSessionRecord'], entry: /\breadSessionRecord\(deps\.io, deps\.cfg, sessionId\)/ },
  // coord/childSpent.ts: `rec` is a FOUND row of `readSessionRecord` (childBindGate, childGateAtClose).
  { file: 'coord/childSpent.ts', scope: 'childSpentLive', builder: 'prStateSession', id: 'rec.id', origin: ['stored', 'request'], gate: ['readSessionRecord'] },
  // coord/close.ts: the abandon arm's fleet act, then the coordinator close's three acts, then the review close's two.
  { file: 'coord/close.ts', scope: 'closeRun', builder: 'wsHold', id: 'run.sessionId', origin: ['stored'], gate: ['close-abandon-branch'] },
  { file: 'coord/close.ts', scope: 'closeRun', builder: 'wsRelease', id: 'run.sessionId', origin: ['stored'], gate: ['close-abandon-branch'] },
  { file: 'coord/close.ts', scope: 'closeRun', builder: 'wsArchive', id: 'run.sessionId', origin: ['stored'], gate: ['close-gate'] },
  { file: 'coord/close.ts', scope: 'closeRun', builder: 'wsRelease', id: 'run.sessionId', origin: ['stored'], gate: ['close-gate'] },
  { file: 'coord/close.ts', scope: 'closeRun', builder: 'wsHold', id: 'run.sessionId', origin: ['stored'], gate: ['close-gate'] },
  { file: 'coord/close.ts', scope: 'closeReviewRun', builder: 'wsHold', id: 'sessionId', origin: ['stored'], gate: ['close-gate'] },
  { file: 'coord/close.ts', scope: 'closeReviewRun', builder: 'wsRelease', id: 'sessionId', origin: ['stored'], gate: ['close-gate'] },
  // coord/collectTempRoot.ts: the learning audit is reached from the population and from the executor's step 1.
  { file: 'coord/collectTempRoot.ts', scope: 'collectAudit', builder: 'wsCollectAudit', id: 'id', origin: ['collector'], gate: ['collector-step-1', 'collector-population', 'collector-record-name'] },
  { file: 'coord/collectTempRoot.ts', scope: 'collectTempRoot', builder: 'wsCollect', id: 'job.id', origin: ['collector'], gate: ['collector-step-1'] },
  // coord/dispatch.ts: refuseSpentChild's only caller is dispatchRun, below its gate; the fresh winner is a listed, valid row.
  { file: 'coord/dispatch.ts', scope: 'refuseSpentChild', builder: 'wsHold', id: 'run.sessionId', origin: ['stored'], gate: ['dispatch-gate'] },
  { file: 'coord/dispatch.ts', scope: 'refuseSpentChild', builder: 'wsRelease', id: 'run.sessionId', origin: ['stored'], gate: ['dispatch-gate'] },
  { file: 'coord/dispatch.ts', scope: 'dispatchRun', builder: 'ensure', id: 'sessionId', origin: ['stored'], gate: ['dispatch-gate'] },
  { file: 'coord/dispatch.ts', scope: 'dispatchRun', builder: 'wsHold', id: 'sessionId', origin: ['stored', 'registry'], gate: ['dispatch-gate', 'registry-refused'] },
  { file: 'coord/dispatch.ts', scope: 'dispatchRun', builder: 'routeSet', id: 'sessionId', origin: ['stored'], gate: ['dispatch-gate'] },
  // coord/expireArchived.ts: the audit serves both the executor and the learning read.
  { file: 'coord/expireArchived.ts', scope: 'expireAudit', builder: 'wsExpireAudit', id: 'sessionId', origin: ['registry'], gate: ['expiry-step-0', 'learn-expiry-step-0'] },
  { file: 'coord/expireArchived.ts', scope: 'expireAct', builder: 'wsExpire', id: 'sessionId', origin: ['registry'], gate: ['expiry-step-0'] },
  // coord/fingerprint.ts: reached from close (below close's gate) and advance (below advance's gate).
  { file: 'coord/fingerprint.ts', scope: 'verifyDone', builder: 'prStateSession', id: 'run.sessionId', origin: ['stored'], gate: ['close-gate', 'advance-gate', 'fingerprint-check'], entry: /\bresolveDoneBranch\(deps, run\)/ },
  // coord/routes.ts
  { file: 'coord/routes.ts', scope: 'POST /api/runs', builder: 'wsHold', id: 'sessionId', origin: ['request'], gate: ['run-open-checks'] },
  { file: 'coord/routes.ts', scope: 'POST /api/runs/:id/route', builder: 'route', id: 'sid', origin: ['stored'], gate: ['routing-door'] },
  { file: 'coord/routes.ts', scope: 'POST /api/runs/:id/route', builder: 'routeSet', id: 'sid', origin: ['stored'], gate: ['routing-door'] },
  // server.ts
  { file: 'server.ts', scope: 'POST /api/sessions/:id/route', builder: 'routeApply', id: 'id', origin: ['request'], gate: ['knownId'], entry: KNOWN_ID },
  { file: 'server.ts', scope: 'POST /api/sessions/:id/ensure', builder: 'ensure', id: 'id', origin: ['request'], gate: ['ensure-route-head'] },
  // stopArgvFor's two callers gate the id: /stop by readSessionRecord, /archive by knownId (pinned in their own case below).
  { file: 'server.ts', scope: 'stopArgvFor', builder: 'stopId', id: 'id', origin: ['request'], gate: ['readSessionRecord', 'knownId'] },
  // The wrapper is the request id's own prefix, or the row's `.wrapper` when the id does not end in `-<project>`; the
  // project is the row's `.project`. These gates vet the request id; both fields are vetted in each caller's identity
  // arm by `stopPairRefused` (Task 14), whose own cases and mutation rows pin it.
  { file: 'server.ts', scope: 'stopArgvFor', builder: 'stopPair', id: 'originalWrapper', origin: ['request', 'registry'], gate: ['readSessionRecord', 'knownId'] },
  { file: 'server.ts', scope: 'POST /api/sessions/:id/swap', builder: 'swapCross', id: 'id', origin: ['request'], gate: ['cross-arm-head'] },
  { file: 'server.ts', scope: 'POST /api/sessions/:id/swap', builder: 'swap', id: 'id', origin: ['request'], gate: ['readSessionRecord'], entry: /\breadSessionRecord\(deps\.io, deps\.cfg, id\)/ },
  { file: 'server.ts', scope: 'GET /api/sessions/:id/pr', builder: 'prStateSession', id: 'id', origin: ['request'], gate: ['knownId'], entry: KNOWN_ID },
  { file: 'server.ts', scope: 'POST /api/sessions/:id/pr', builder: 'prOpen', id: 'id', origin: ['request'], gate: ['knownId'], entry: KNOWN_ID },
  { file: 'server.ts', scope: 'POST /api/sessions/:id/archive', builder: 'wsArchive', id: 'id', origin: ['request'], gate: ['knownId'], entry: KNOWN_ID },
  { file: 'server.ts', scope: 'POST /api/sessions/:id/restore', builder: 'wsRestore', id: 'id', origin: ['request'], gate: ['knownId'], entry: KNOWN_ID },
  { file: 'server.ts', scope: 'POST /api/sessions/:id/forget', builder: 'forget', id: 'id', origin: ['request'], gate: ['knownId'], entry: KNOWN_ID },
  { file: 'server.ts', scope: 'POST /api/sessions/:id/hold', builder: 'wsHold', id: 'id', origin: ['request'], gate: ['knownId'], entry: KNOWN_ID },
  { file: 'server.ts', scope: 'POST /api/sessions/:id/release', builder: 'wsRelease', id: 'id', origin: ['request'], gate: ['knownId'], entry: KNOWN_ID },
  { file: 'server.ts', scope: 'GET /api/sessions/:id/workspace/audit', builder: 'wsAudit', id: 'id', origin: ['request'], gate: ['knownId'], entry: KNOWN_ID },
  { file: 'server.ts', scope: 'POST /api/sessions/:id/workspace/reap', builder: 'wsReap', id: 'id', origin: ['request'], gate: ['knownId'], entry: KNOWN_ID },
  // watch.ts: the naming sweep's rows come from the listing, which never builds a refused name.
  { file: 'watch.ts', scope: 'sweepNames', builder: 'wsRename', id: 'r.id', origin: ['registry'], gate: ['registry-refused'] },
  { file: 'watch.ts', scope: 'sweepNames', builder: 'wsRename', id: 'r.id', origin: ['registry'], gate: ['registry-refused'] },
];

/** The files whose gates ask the predicate themselves. */
const GATE_FILES = [
  'server.ts', 'registry.ts', 'watch.ts',
  'coord/routes.ts', 'coord/dispatch.ts', 'coord/close.ts', 'coord/reclaim.ts', 'coord/fingerprint.ts', 'coord/expireArchived.ts',
] as const;

const IMPORTS_PREDICATE = /import\s*\{[^}]*\bisRegistryId\b[^}]*\}\s*from\s*'(?:\.\.\/)+shared\/api\.js'/;

const keyOf = (r: { readonly file: string; readonly scope: string | null; readonly builder: string; readonly id: string }): string =>
  `${r.file} | ${r.scope ?? '(no scope)'} | ${r.builder} | ${r.id}`;

/** Each scanned call with its row: the k-th call of a key takes the k-th row of that key. */
function paired(): { readonly site: Site; readonly row: CensusRow }[] {
  const queues = new Map<string, CensusRow[]>();
  for (const row of CENSUS) queues.set(keyOf(row), [...(queues.get(keyOf(row)) ?? []), row]);
  return SITES.map((site) => {
    const row = queues.get(keyOf(site))?.shift();
    if (row === undefined) throw new Error(`unclassified id-taking call: ${keyOf(site)} (line ${site.line})`);
    return { site, row };
  });
}

describe('every id-taking argv call has an origin and a gate (spec §2.3)', () => {
  it('every CCD_ARGV key is classified id or no-id', () => {
    expect(Object.keys(ID_BUILDERS).sort()).toEqual(Object.keys(CCD_ARGV).sort());
    expect(ID_KEYS).toHaveLength(26);
    expect(Object.keys(ID_PROBE).sort()).toEqual([...ID_KEYS].sort());
    for (const k of ID_KEYS) {
      const args = ID_PROBE[k] as readonly unknown[];
      expect(args.filter((a) => a === PROBE_ID), `${k}'s probe names its id once`).toHaveLength(1);
      const built = (CCD_ARGV[k] as (...a: unknown[]) => readonly string[])(...args);
      expect(built, `${k} carries the id it is given into its argv`).toContain(PROBE_ID);
    }
  });

  it('the id-taking calls are exactly these', () => {
    expect(SITES.filter((s) => s.scope === null).map(keyOf), 'a call outside every function or route').toEqual([]);
    expect(SITES.map(keyOf).sort()).toEqual(CENSUS.map(keyOf).sort());
    for (const row of CENSUS) {
      expect(row.origin.length, `${keyOf(row)} names its origin`).toBeGreaterThan(0);
      expect(row.gate.length, `${keyOf(row)} names its gate`).toBeGreaterThan(0);
    }
  });

  it('the header claim, "41 id-taking calls across 10 files", matches the scan', () => {
    const self = readFileSync(fileURLToPath(import.meta.url), 'utf8');
    const claim = /^\/\/ THE CLAIM: (\d+) id-taking calls across (\d+) files\b/m.exec(self);
    expect(claim, 'the census claim was removed or reworded without its guard').not.toBeNull();
    expect([Number(claim![1]), Number(claim![2])]).toEqual([SITES.length, new Set(SITES.map((s) => s.file)).size]);
    expect(CENSUS).toHaveLength(SITES.length);
  });

  it('every gate stands where the census says, above the call it guards', () => {
    for (const [name, g] of Object.entries(GATES)) {
      const text = scopeText(g.file, g.scope);
      expect(text, `${name}: ${g.file} has no scope ${g.scope}`).not.toBeNull();
      expect(text, `${name}: the gate's text is gone from ${g.file} ${g.scope}`).toMatch(g.re);
    }
    for (const { site, row } of paired()) {
      for (const gate of row.gate) {
        const g = GATES[gate];
        if (g.file === site.file && g.scope === site.scope) {
          expect(site.before, `${keyOf(site)} (line ${site.line}): ${gate} must stand above the call`).toMatch(g.re);
        }
      }
      if (row.entry !== undefined) {
        expect(site.before, `${keyOf(site)} (line ${site.line}): its scope must reach its gate above the call`).toMatch(row.entry);
      }
    }
    const used = new Set<string>(CENSUS.flatMap((r) => r.gate));
    expect(Object.keys(GATES).filter((g) => !used.has(g)), 'a gate no call names').toEqual([]);
  });

  it("stopArgvFor's two callers each gate the id before they compose it", () => {
    const lines = codeOnly(readFileSync(path.join(srcRoot, 'server.ts'), 'utf8')).split('\n');
    const heads = headsOf(lines);
    const callers = lines.flatMap((l, i) => (/\bstopArgvFor\(/.test(l) && !/\bfunction stopArgvFor\(/.test(l)
      ? [{ head: lastHeadAtOrBefore(heads, i), line: i }]
      : []));
    expect(callers.map((c) => c.head?.name ?? null)).toEqual([
      'POST /api/sessions/:id/stop',
      'POST /api/sessions/:id/archive',
      'POST /api/sessions/:id/archive',
    ]);
    const GATE_OF: Readonly<Record<string, RegExp>> = {
      'POST /api/sessions/:id/stop': /\breadSessionRecord\(deps\.io, deps\.cfg, id\)/,
      'POST /api/sessions/:id/archive': KNOWN_ID,
    };
    for (const c of callers) {
      const before = lines.slice(c.head!.line, c.line + 1).join('\n');
      expect(before, `${c.head!.name}: its gate stands above stopArgvFor(`).toMatch(GATE_OF[c.head!.name]!);
    }
  });

  it('every gate file imports isRegistryId from shared/api.js and calls it', () => {
    for (const f of GATE_FILES) {
      const code = codeOnly(readFileSync(path.join(srcRoot, f), 'utf8'));
      expect(code, `${f} imports isRegistryId from shared/api.js`).toMatch(IMPORTS_PREDICATE);
      expect(code.replace(IMPORTS_PREDICATE, ''), `${f} calls isRegistryId`).toMatch(/\bisRegistryId\s*\(/);
    }
    const importers = sourcesUnder(srcRoot)
      .filter((f) => IMPORTS_PREDICATE.test(codeOnly(readFileSync(f, 'utf8'))))
      .map(rel)
      .sort();
    expect(importers).toEqual([...GATE_FILES].sort());
  });

  it('each helper whose gate stands in its caller is called only from that caller', () => {
    // A row whose gate's home is another scope, and that carries no `entry`, is guarded only through its callers, as
    // `stopArgvFor` is (the case above). A new CALL of a builder is the scan's to find; a new CALLER of such a helper,
    // one that skips the gate, is this case's.
    const CALLERS: Readonly<Record<string, readonly string[]>> = {
      closeReviewRun: ['coord/close.ts | closeRun'],
      refuseSpentChild: ['coord/dispatch.ts | dispatchRun'],
      expireAudit: ['coord/expireArchived.ts | expireArchived', 'coord/expireArchived.ts | learnExpiry'],
      expireAct: ['coord/expireArchived.ts | expireArchived'],
      childReclaimAudit: ['coord/childReclaim.ts | childReclaimOutcome'],
      childReclaimAct: ['coord/childReclaim.ts | childReclaimOutcome'],
      collectAudit: ['coord/collectTempRoot.ts | collectTempRoot', 'coord/collectTempRoot.ts | learnCollect'],
    };
    for (const [callee, want] of Object.entries(CALLERS)) {
      const call = new RegExp(`\\b${callee}\\(`);
      const def = new RegExp(`\\bfunction ${callee}\\(`);
      const found = sourcesUnder(srcRoot).flatMap((f) => {
        const code = codeOnly(readFileSync(f, 'utf8'));
        const heads = headsOf(code.split('\n'));
        return blankStrings(code).split('\n').flatMap((l, i) => (call.test(l) && !def.test(l)
          ? [`${rel(f)} | ${lastHeadAtOrBefore(heads, i)?.name ?? '(no scope)'}`]
          : []));
      });
      expect(found.sort(), `${callee}'s callers`).toEqual([...want].sort());
    }
  });

  it('CONTROL: the scan sees a call, and ignores a comment, a string and a definition', () => {
    const src = [
      'export async function sample(deps: Deps, id: string): Promise<void> {',
      '  // CCD_ARGV.wsRelease(id, null) is prose',
      '  /* CCD_ARGV.forget(id) in a block comment */',
      "  const quoted = 'CCD_ARGV.wsAudit(id)';",
      '  const templated = `CCD_ARGV.ensure(${id})`;',
      '  const verb = CCD_ARGV.wsArchive(id, null)[0];',
      '  await deps.runCcd(CCD_ARGV.wsAdd(id));',
      '  await deps.runCcd(CCD_ARGV.wsHold(',
      "    id, 'a reason, with a comma', null));",
      '}',
      'const BUILDERS = {',
      "  wsHold: (id: string, reason: string) => argv(['ws-hold', '--session', id, '--reason', reason]),",
      '};',
      'export function register(app: App): void {',
      "  app.post('/api/x/:id', async (req, reply) => {",
      '    return send(CCD_ARGV.forget(req.id));',
      '  });',
      '}',
      'class Watcher {',
      '  async sweep(): Promise<void> {',
      '    await this.run(CCD_ARGV.wsReap(token, r.id));',
      '  }',
      '}',
    ].join('\n');
    expect(scanSource(src, 'control.ts').map(({ file, scope, builder, id, line }) => ({ file, scope, builder, id, line })))
      .toEqual([
        { file: 'control.ts', scope: 'sample', builder: 'wsHold', id: 'id', line: 8 },
        { file: 'control.ts', scope: 'POST /api/x/:id', builder: 'forget', id: 'req.id', line: 16 },
        { file: 'control.ts', scope: 'sweep', builder: 'wsReap', id: 'r.id', line: 21 },
      ]);
  });
});
```

Notes on the code:
- The CONTROL's `templated` line is a single-quoted TypeScript string, so `${id}` in it is literal text.
- Inside the scanned source, that line is a template literal, which `blankStrings` blanks.

- [ ] **Step 3: Run it. It should be green on its first run.**

```bash
cd server && ./node_modules/.bin/vitest run test/id-argv-census.test.ts
```

Expected: `Test Files  1 passed (1)`, `Tests  8 passed (8)`. Run it in the foreground with a timeout of at least 600000 ms.

This census measures code that Tasks 2 to 14 already built, so its first run is green. Task 13 has the same shape. Step 4's mutation rows are this task's red-first proof.

A red on this first run is a census mismatch, never something to fix by editing the table to match. Read the named site:
- An unclassified call, or a `(no scope)` key: apply Step 1's rule for (1).
- A gate's text missing at its home: apply Step 1's rule for (3).
- A row whose gate stands BELOW its call is a gate that does not guard that call: STOP, `gate-below-its-call`, naming the key.

- [ ] **Step 4: The mutation rows (one scratch edit at a time; measure, restore, confirm the restore)**

Run every row from `server/`, with `./node_modules/.bin/vitest run test/id-argv-census.test.ts` unless the row names another suite. Record each before and after in the SDD ledger. After each row, run `git checkout -- <file>` and then `git diff --stat -- src` (expected: empty).

| # | Mutation (located by content) | Expected red | Restore |
|---|---|---|---|
| M1 | `src/server.ts`, in `POST /api/sessions/:id/forget`: below `    const argv = CCD_ARGV.forget(id);` insert `    void CCD_ARGV.wsAttic(id);` (a 42nd call) | `the id-taking calls are exactly these` (the sorted keys gain `server.ts \| POST /api/sessions/:id/forget \| wsAttic \| id`); `the header claim, …` (`[42, 10]` against `[41, 10]`); `every gate stands …` throws `unclassified id-taking call: server.ts \| POST /api/sessions/:id/forget \| wsAttic \| id` | `git checkout -- src/server.ts` |
| M2 | `src/coord/fingerprint.ts`: delete `isRegistryId` (and its comma) from the `'../../../shared/api.js'` import, and leave the call | `every gate file imports isRegistryId from shared/api.js and calls it`: `coord/fingerprint.ts imports isRegistryId from shared/api.js` | `git checkout -- src/coord/fingerprint.ts` |
| M3 | `src/ccdargv.ts`: above `  winSize: (id: string, mode: 'smallest' \| 'canonical') =>` insert `  censusProbe: (id: string) => argv(['ws-audit', '--session', id]),` | this file: `every CCD_ARGV key is classified id or no-id` (the keys differ). `./node_modules/.bin/vitest run test/typecheck-tests.test.ts`: `server/test/ is clean under a tests-inclusive project` is red, with a TS error naming `censusProbe` in `id-argv-census.test.ts` (and in `whitelist-subset.test.ts`'s `SAMPLES`/`EXPECTED`) | `git checkout -- src/ccdargv.ts` |
| M4 | `src/server.ts`: delete `knownId`'s first statement, `if (!isRegistryId(id)) return false;` | `every gate stands …`: `knownId: the gate's text is gone from server.ts knownId` | `git checkout -- src/server.ts` |
| M5 | `src/server.ts`, in `POST /api/sessions/:id/swap`: move the cross arm's `isRegistryId(id)` check from first inside `if (body.crossPool === true) {` to just below the `capSupported(deps.fleetState, POOLS_CAP)` block | `every gate stands …`: `cross-arm-head: the gate's text is gone from server.ts POST /api/sessions/:id/swap` | `git checkout -- src/server.ts` |
| M6 | `src/coord/close.ts`: delete the statement that records `'fleet-act-omitted:bad-session'` | `every gate stands …`: `close-abandon-branch: the gate's text is gone from coord/close.ts closeRun` | `git checkout -- src/coord/close.ts` |
| M7 | `src/coord/expireArchived.ts`, in `learnExpiry`: above `  return expireAudit(deps, sessionId);` insert `  void expireAct(deps as never, sessionId, 'probe');` (a second caller that skips the act's step 0) | `each helper whose gate stands in its caller …`: `expireAct's callers: expected [ 'coord/expireArchived.ts \| expireArchived', 'coord/expireArchived.ts \| learnExpiry' ] to deeply equal [ 'coord/expireArchived.ts \| expireArchived' ]` | `git checkout -- src/coord/expireArchived.ts` |

M1 to M3 are the scope's three rows. M4 to M6 prove that the gate homes are load-bearing. M7 proves the caller pin. Each source-side mutation leaves the census file itself untouched.

- [ ] **Step 5: Run the task's other suites**

```bash
(cd server && ./node_modules/.bin/vitest run test/id-argv-census.test.ts)
(cd server && ./node_modules/.bin/vitest run test/typecheck-tests.test.ts)
(cd server && ./node_modules/.bin/vitest run test/whitelist-subset.test.ts)
git status --short    # from the workspace root, exactly: ?? server/test/id-argv-census.test.ts
```

All three should be green, in the foreground, with a timeout of at least 600000 ms. `typecheck-tests` is the gate on `ID_BUILDERS`'s and `ID_PROBE`'s `satisfies` clauses. `whitelist-subset` shares `CCD_ARGV`'s key set with this file's first case. This task edits no file under `server/src`, so `unattended-actor` and `verb-gate` are not required. A red in a known load flake is re-run in isolation first.

- [ ] **Step 6: Commit**

```bash
git add server/test/id-argv-census.test.ts
git commit -m "test(server): census every id-taking argv call, its origin and its gate" -m "A structural census of the 41 calls of the 26 id-taking CCD_ARGV builders across 10 server files (spec section 2.3).
Every CCD_ARGV key is classified id or no-id (a new key is a tsc error), and each id builder is probed to carry its
id into its argv. Each call is keyed by file, enclosing scope, builder and id argument, and classified by origin
(request, stored, registry, collector) and by the gate that stands before it. Each gate is pinned at its home, and
above the call where the two share a scope. stopArgvFor's two callers are pinned to their gates, and the nine gate
files must import isRegistryId from shared/api.js and call it. A new call, a missing gate text or a dropped import
turns the suite red."
```

---

### Task 16: Docs — W1a as built

**Model routing:** `sonnet`, effort `high`. This is prose that the reviewer and the W1b planner will rely on. Measure every sentence against this branch's tip, never against the rulings' text. When the code and the text disagree, correct the text to the code. A sentence that cannot be made true is reported by slug in the wave-done.

**Why:**
- **R7 and R3.** The spec is not edited. Its §2.3 corrections are recorded here instead: `knownId` is not the one choke point, and the watches omit a refused id rather than keep its earlier state.
- **R1, R17 (as amended), R18, R19, R20 and Task 3.** Each departure these name is listed by slug, and none gets a number. The departures are `registry-id-at-foot`, `masked-arms-pinned-by-their-masks`, `fleet-fallback-is-tests-only`, `cold-start-skips-an-unmeasured-fleet`, `bad-id-is-not-a-code` and `resume-dispatch-refuses-not-holds`. A coordinator ruling at plan review adds Task 14's `stop-pair-fields-refused-at-composition`.
- **R13.** The answers table is restated as built.
- **R14 and R24, plus Task 16's own carried lines.** These are README's stop prose (when it is not edited here), the coordinator skill's rows, the abandon sheet, the reclaim sheet, a stored work-run `project`, the parity rows on the real binary, the rename, the expiry lane's words for the executor's own refusal, the prose that still calls `POST /api/runs` unguarded, and SEC2 C and D.

**Files:**
- Modify: `docs/superpowers/plans/2026-10-12-path-identity-w1a-server-id-gate.md`. APPEND the section `## As built (W1a, run 399)` after the last line of the file. That line closes `## Deviations found`, whose last subsection is `### Plan-text corrections and extra pins, one number per task`. Nothing above it is edited, including `## Deviations found` (the coordinator owns it until the fix round).
- Modify (ONLY if Step 0's (r1) and (r2) both hold): `README.md`, two lines, both line-neutral:
  - the line holding ``which is what lets `ccd stop <id> --surface <word>` `` (`:2921` at `837a099c0`);
  - the line holding ``ccd parses `stop <id> --surface pwa` as a two-argument stop of a session`` (`:2966` at `837a099c0`).

  Locate both by content.
- Test: none of its own (scope). The section is checked by an inline `node -e` check (Step 1). It writes no file.
- NOT edited:
  - the spec, the contract and the programme ledger;
  - `CLAUDE.md`;
  - anything under `ccd/` or `pwa/`;
  - `server/test/readme-holds.test.ts` and `server/test/session-hook.test.ts` (run only).

**Interfaces:**
- Consumes:
  - the code at this branch's tip after Tasks 1 to 15: `isRegistryId`, `REGISTRY_ID_MAX_CHARS`, `TMPROOT_ID_MAX_CHARS`, `isTmpRootId`, `SingleRead`, `RegistryRead.refused`, `knownId`, `childGateAtClose`, `measureClaimant`, `childBindGate`, `reclaimChild`, `freshAskAt`, `UNMEASURED_ASK_AT`, `assembleFleet`, `listProjects`, `abandonRefusal`, `EXPIRE_ID_REFUSED`, `CCD_ARGV.stopId`, `CCD_ARGV.stopPair` and `stopPairRefused`;
  - the census vocabulary `[registry-refused:<word>]` (`server/test/registry-refused-census.test.ts`);
  - Task 15's claim in `server/test/id-argv-census.test.ts`;
  - the SDD ledger's Task 0 entry (the recorded (d1)) and every departure slug recorded there for Tasks 0 to 15.
- Produces: prose only. No code name, no test file.

- [ ] **Step 0: Entry conditions**

Run from the workspace root.

```bash
git log --format=%s --no-merges origin/main..HEAD   # (e1) one subject per task, Tasks 1 to 15, each once, with Task 15's
                                                    # "test(server): census every id-taking argv call, its origin and its gate" newest
P=docs/superpowers/plans/2026-10-12-path-identity-w1a-server-id-gate.md
grep -c '^## Deviations found$' "$P"                # (e2) 1
awk '/^## Deviations found$/{f=1} f && $0 == "## As built (W1a, run 399)"{n++} END{print n+0}' "$P"         # (e3) 0
grep -n '^### Plan-text corrections and extra pins, one number per task$' "$P"   # (e4) one line, the file's last heading
tail -c 1 "$P" | od -An -c                          # (e5) \n: the file ends in a newline
```

Then decide whether README is edited. Both conditions must hold (R14):
- **(r1)** The SDD ledger's Task 0 entry recorded (d1) as `MERGED`. Read the ledger; do not re-ask `gh`. #351 merging after Task 0 does not count.
- **(r2)** #351's merge commit is in this branch:

```bash
gh pr view 351 --json state,mergeCommit -q '.state + " " + (.mergeCommit.oid // "none")'   # MERGED <oid> when (r1) holds
git merge-base --is-ancestor <oid> HEAD; echo "r2 rc=$?"                                     # rc=0
grep -c 'which is what lets `ccd stop <id> --surface <word>`' README.md                    # (r3) 1
grep -c 'ccd parses `stop <id> --surface pwa` as a two-argument stop of a session' README.md # (r4) 1
```

What to do with the answers:
- If (r1) or (r2) fails, README is not edited. Skip Step 4. The section uses the "carried" variant (Step 3).
- If both hold but (r3) or (r4) prints 0, #351 rewrote the lines. Locate the order they now spell by `grep -n 'stop <id> --surface' README.md` and edit those lines in the same way. If no such line remains, the README is already correct: use the "edited here" variant, change its sentence to say #351 left no trailing-order line, and report slug `readme-stop-prose-gone`.

STOP rules:
- (e1) missing a task: the wave is not ready for its docs (`tree-not-ready`).
- (e2) not 1, or (e3) not 0: the plan file was edited outside this task (`plan-file-moved`). Report it and build nothing.

- [ ] **Step 1: Write the section check. Run it: RED.**

Run this from the workspace root. It prints one line, and its exit code is the verdict.

```bash
node -e '
const fs = require("node:fs");
const f = "docs/superpowers/plans/2026-10-12-path-identity-w1a-server-id-gate.md";
const t = fs.readFileSync(f, "utf8");
const bad = [];
const dev = t.indexOf("\n## Deviations found\n");
if (dev < 0) bad.push("no Deviations found section");
// Step 3 of this task holds the section as a heredoc template ABOVE Deviations found, so only the text below
// Deviations found can be the appended section.
const below = dev < 0 ? "" : t.slice(dev);
const heads = below.split("\n").filter((l) => l === "## As built (W1a, run 399)").length;
if (heads !== 1) bad.push("the as-built heading appears " + heads + " times below Deviations found, not once");
const at = below.indexOf("\n## As built (W1a, run 399)\n");
const s = at < 0 ? "" : below.slice(at);
if (/\bD-\d/.test(s)) bad.push("a deviation token");
if (/\d{4} ?(–|\.\.|-) ?\d{4}/.test(s)) bad.push("a number range");
if (/\/home\/|\/Users\/|\.ts\.net|\b100\.\d+\.\d+\.\d+/.test(s)) bad.push("a host or a home path");
const slugs = ["registry-id-at-foot", "masked-arms-pinned-by-their-masks", "resume-dispatch-refuses-not-holds",
  "fleet-fallback-is-tests-only", "cold-start-skips-an-unmeasured-fleet", "bad-id-is-not-a-code",
  "wave-lifecycle-rows-carried", "abandon-sheet-misreads-an-omitted-fleet-act",
  "reclaim-sheet-drops-the-bad-session-detail", "work-run-project-reaches-ws-add-unchecked", "stop-pair-fields-refused-at-composition"];
for (const slug of slugs) if (!s.includes("`" + slug + "`")) bad.push("slug " + slug + " missing");
const names = ["### Corrections to spec §2.3", "### The readers as built", "### The masked arms and their masks",
  "### The answers this wave adds", "### Carried lines, and README", "`childGateAtClose`", "`freshAskAt`",
  "`readRegistryMeasured`", "`knownId`", "ccdargv-dec-parity", "SEC2 C and D", "is not an OS wall"];
for (const n of names) if (!s.includes(n)) bad.push(n + " missing");
const readme = ["**README stop prose: edited here.**", "**README stop prose: carried.**"].filter((m) => s.includes(m)).length;
if (readme !== 1) bad.push("README stop prose: " + readme + " variants, not one");
const siteRows = s.split("\n").filter((l) => /^\| `readRegistry(Measured)?` \|/.test(l)).length;
if (siteRows !== 12) bad.push("reader table rows " + siteRows + ", not 12");
const answerRows = s.split("\n").filter((l) => /^\| .+ \| .+ \| .+ \|$/.test(l) && !/^\| (Where|Arm|Reader|---)/.test(l)).length;
if (answerRows < 26) bad.push("table body rows " + answerRows + ", fewer than 26");
console.log(bad.length === 0 ? "as-built ok" : "as-built RED: " + bad.join("; "));
process.exitCode = bad.length === 0 ? 0 : 1;
'
echo "check rc=$?"
```

Expected: `as-built RED: the as-built heading appears 0 times below Deviations found, not once; slug registry-id-at-foot missing; …`, then `check rc=1`.

What `answerRows` counts: the section's table body rows, which are 12 reader rows, 8 masked-arm rows and 22 answer rows, 42 in all. The floor of 26 only proves that the answers table is not missing. The exact pins are `siteRows`, the slugs and the names.

- [ ] **Step 2: Measure what the section states, at the tip**

Run from the workspace root. Each expected answer is what Tasks 1 to 15 were planned to build. A different answer means the text in Step 3 changes to match the code, and the wave-done names it.

```bash
grep -n '^export const REGISTRY_ID_MAX_CHARS = 255;$\|^export function isRegistryId(id: unknown): id is string {$\|^export const TMPROOT_ID_MAX_CHARS = REGISTRY_ID_MAX_CHARS;$\|^export function isTmpRootId(id: unknown): id is string {$' shared/api.ts
                                                           # (m1) four lines, in this order, each below (m2)
grep -n "^/\* ── child-workspace reclamation: the temp-root collector's server lane" shared/api.ts   # (m2) one line
grep -c 'if (!isRegistryId(id)) return false;' server/src/server.ts                                 # (m3) 1: knownId's first statement
grep -c '`knownId` gates 18 request-id routes (14 POST, 4 GET' server/src/server.ts                  # (m4) 1: the census stays 18
grep -rhoE '\[registry-refused:[A-Za-z-]+\]' server/src | LC_ALL=C sort | uniq -c
# (m5) 1 gated, 2 holds, 2 knownId, 4 omits, 3 raw-name, 2 refuses, 3 reports, 2 stale, 3 tests-only, 1 wrapper;
#      23 in all, and no unplaced. If a docstring spells a tag in prose, the census file's table is the authority:
grep -c "| unplaced'" server/test/registry-refused-census.test.ts                                   # (m5b) 0: no EXPECTED_SITES row is left unplaced
grep -cE '^export (async )?function childGateAtClose\(' server/src/coord/close.ts                    # (m6) 1: exported for its pin (R17 as amended)
grep -rn 'childGateAtClose' server/test --include=*.test.ts | wc -l                                  # (m6b) >= 1: its direct pin exists
grep -c "fleet-act-omitted:bad-session" server/src/coord/close.ts                                    # (m7) 1 (R27)
grep -n "stale: true" server/src/server.ts                                                           # (m8) GET /api/fleet's unlistable arm
grep -c "refusedRows" server/src/coord/routes.ts                                                     # (m9) >= 1
grep -n "registry: 'listed' | 'unlistable'" server/src/lifecycle.ts                                  # (m10) listProjects's return type
grep -c "\['stop', '--surface', surface, id\]\|\['stop', '--surface', surface, w, p\]" server/src/ccdargv.ts   # (m11) 2
grep -c "EXPIRE_ID_REFUSED" server/src/coord/expireArchived.ts                                       # (m12) 3: the constant and two answers
grep -n "id-taking calls across" server/test/id-argv-census.test.ts                                  # (m13) "41 id-taking calls across 10 files", or Task 15's recount
grep -n "'bad-id'" server/test/mail-routes.test.ts                                                    # (m14) one line, inside NOT_CODES
grep -c "if (!isSessionIdShape(sid)) {" server/src/coord/routes.ts                                   # (m15) 0: the routing door asks isRegistryId
grep -c "if (!isRegistryId(sid)) {" server/src/coord/routes.ts                                       # (m16) 1
grep -c "if (identity === null || stopPairRefused(id, read.record, identity)) {" server/src/server.ts   # (m17) 2: /stop and the archive door (Task 14)
```

How to read each answer:
- (m5): if a count differs, read that site in `registry-refused-census.test.ts`'s final table, and correct the section's table and its "23 sites" sentence to it.
- (m6) and (m6b): if either prints 0, Task 4 did not build R17's amended pin. Do NOT write the sentence saying `childGateAtClose` is pinned directly. Write instead "`childGateAtClose` is masked by both close gates and gets no pin of its own", and report slug `child-gate-at-close-unpinned` (the ruling asked for the pin).
- (m13): if Task 15 recounted, write its number in place of 41 and its file count in place of 10.
- Then list every departure slug the SDD ledger recorded for Tasks 0 to 15. Step 3 adds each one that the section does not already name.

- [ ] **Step 3: Append the section**

First choose ONE of the two README bullets in "Carried lines, and README" below, and delete the other before you append:
- "edited here" when Step 0's (r1) and (r2) both held;
- "carried" otherwise.

If Step 0 reported `readme-stop-prose-gone`, change the "edited here" bullet's second sentence as Step 0 says.

Then fill "Departures recorded while building":
- one bullet for each slug Step 2 listed that the section does not already name, each one measured sentence;
- if there are none, delete that heading and its sentence.

Correct every number and name to Step 2's answers, and leave no other text changed. Then append:

```bash
printf '\n---\n\n%s\n' '## As built (W1a, run 399)' >> docs/superpowers/plans/2026-10-12-path-identity-w1a-server-id-gate.md
cat >> docs/superpowers/plans/2026-10-12-path-identity-w1a-server-id-gate.md <<'EOF'

This note records where wave 1 of the path-identity programme (the spec's W1a) differs, as built, from the spec
`docs/superpowers/specs/2026-10-12-path-identity-design.md`, and what it carries to later waves. The spec is not edited:
its corrections live here (R7, R3). The note amends; it edits no earlier text of this plan. It names each departure by
slug and carries no number. The coordinator assigns this wave's numbers at the fix round and defines them under
**Deviations found** above. The comments and test titles this wave added cite spec §2.3, and §2.4 for stop's order.

### What the gate does not claim

The server gate keeps a non-registry id out of every argv the server composes. It is not an OS wall: a session can
still run `ccd` directly with any id, and ccd's own loops and predicates are W1b's (spec §2.4). Until W1b merges,
ccd's half of spec §2 stays open.

### Corrections to spec §2.3

- **`knownId` is not the one choke point (R7).** §2.3 calls `knownId` "one choke point for every request-id route".
  Two request-id routes never call it:
  - `POST /api/sessions/:id/ensure` asks `isRegistryId(id)` as its route's first statement;
  - `POST /api/sessions/:id/swap`'s `crossPool: true` arm asks it as the arm's first statement, ahead of the skew gate
    (R22).

  Each answers 400 `bad-session-id`. `knownId` refuses a failing id before its listing, and its census stays at 18
  routes (14 POST, 4 GET).
- **The watches omit a refused id, and nothing is retained (R3).**
  - §2.3 says the main, hook-state and task-state watches "retain prior state for refused ids". It also says the
    watch sweeps keep the wrapper because omission suppresses observation "while retaining prior state".
  - Refusal is a pure function of the id string, so a refused id never had state to retain, and code that retained
    it would be unobservable.
  - As built, omission is the behaviour: a refused id gets no state, no reads and no acts, and the reader census tags
    those sites `omits`.
  - The snapshot shrink guard skips a refused id, so a refused row cannot freeze snapshot writes.
- **The predicate sits at the foot of `shared/api.ts` (R1, `registry-id-at-foot`).**
  - §2.3 places `isRegistryId` "right after `isSessionIdShape` (about `:6231`)". README and the compaction-card
    corpus cite `shared/api.ts` by line, and an insertion there would move every cited anchor below it.
  - `REGISTRY_ID_MAX_CHARS` (255) and `isRegistryId` stand in the foot block, immediately above
    `TMPROOT_ID_MAX_CHARS`.
  - §2.3's "`TMPROOT_ID_MAX_CHARS` becomes a `REGISTRY_ID_MAX_CHARS`" is built as a derived alias,
    `TMPROOT_ID_MAX_CHARS = REGISTRY_ID_MAX_CHARS`, and `isTmpRootId` returns `isRegistryId(id)`.
  - The accepted set is unchanged. The full rename is carried (below).
- **Masked arms are pinned by their masks (R17, `masked-arms-pinned-by-their-masks`).**
  - §2.3 asks for "a pin each" for every absence-acting caller. The request-route gates and the stored-row gates
    landed before the reader widening, so some reader arms were masked from the moment they existed.
  - Each masked arm answers the safe word and its comment names its mask. Its pins are the outer gate's cases and
    `readSessionRecord`'s zero-listing case (the table below).
  - One exception, by the coordinator's amendment of R17: `close.ts`'s `childGateAtClose` is exported for its pin and
    pinned directly with an unlisted bad id. So all four absence-acting callers that §2.3 names, `measureClaimant`,
    `childGateAtClose`, `reclaimChild` and `childBindGate`, carry a pin each.
- **Resume dispatch refuses; it does not hold (`resume-dispatch-refuses-not-holds`).**
  - §2.3 says resume dispatch "holds when the requested id is refused".
  - As built, `dispatchRun` re-checks the stored `sessionId` right after its hold verdict and before any read. It does
    so for a fresh dispatch and a resume alike: the run stays `planned`, and the route answers 409 `bad-session`.
- **The readers that pass `records: undefined` measure the registry themselves (R19).**
  - §2.3 migrates four `readRegistry` callers to `RegistryRead`: project enumeration, the fleet fallback, peer
    enumeration and dispatch's pre-spawn read. All four migrated.
  - Beyond them, the three production callers that passed `records: undefined` to `assembleFleet` each call
    `readRegistryMeasured` and pass its records: `GET /api/fleet`, the ws cold start and the claims-conflict path.
  - `readRegistry` keeps eight production callers, each classified below.

### The readers as built

- `readSessionRecord` answers `{ kind: 'bad-id' }` for an id that fails `isRegistryId`, before any listing.
  - `SingleRead` has four kinds, and every one of its 14 callers is an exhaustive switch.
  - A fold of `bad-id` into `absent` was measured against an UNLISTED bad id at each site where the two arms diverge
    (R15).
- `bad-id` is a read result, not a code (R20, `bad-id-is-not-a-code`). It joins `mail-routes.test.ts`'s `NOT_CODES`,
  and no refusal or wire field carries it.
- `readRegistryMeasured` names its refused rows (R2):
  - `refused` holds ids (the basename less `.uuid`), and `names` keeps every raw name.
  - A refused row is never read, never built into `records` and never composed.
  - `pruneWarnState` receives the valid ids only.
  - Each refused id is logged once while it stays listed, quoted by `JSON.stringify`, through a module-private set
    pruned on each listing. That set is never `warnState`'s keys.
- Dispatch's pre-spawn read migrated in the same commit as the post-spawn clause (R18), because the clause needs the
  pre-spawn `refused` set. On an unlistable registry, the pre-spawn read refuses `registry-unmeasurable` before
  anything is spawned. The post-spawn clause refuses a refused name that was absent before the spawn.
- The fallbacks that only tests reach:
  - `assembleFleet`'s own fallback reads `readRegistryMeasured` and uses `[]` on an unlistable registry. A census
    pins every production `assembleFleet(` call's records argument as present (R19, `fleet-fallback-is-tests-only`).
  - `sweepHookStates`'s own read and `detectDialogs`'s fallback: `tick` passes its `records` to both, and a census
    describe pins that hand-off.
- On an unlistable registry, the ws cold start with no watcher broadcast sends no `fleet` frame and still sends its
  `runs` frame. The wire order becomes "hello, runs" (R19, `cold-start-skips-an-unmeasured-fleet`). The `fleet` frame
  has no stale marker, and this wave adds no L0 wire field. With a watcher broadcast, the cold start reads no
  registry.
- The census (`registry-refused-census.test.ts`) classifies 23 sites, with no site `unplaced`. They are eight
  `readRegistry` calls and fifteen `readRegistryMeasured` calls, `readRegistry`'s own wrapper call among them:

| Reader | Word | Sites |
|---|---|---|
| `readRegistry` | `knownId` | `sessionCommands` (`commands.ts`), `prTasks` (`server.ts`) |
| `readRegistry` | `omits` | `sweepNames`, `sweepPr` (`watch.ts`) |
| `readRegistry` | `tests-only` | `detectDialogs`'s fallback (`watch.ts`; `tick` passes `records`) |
| `readRegistry` | `raw-name` | `requireAttribution`, `POST /api/mail`, `POST /api/mail/:id/ack` (`coord/routes.ts`) |
| `readRegistryMeasured` | `wrapper` | `readRegistry` (`registry.ts`) |
| `readRegistryMeasured` | `holds` | `resolveDoneBranch` (`coord/fingerprint.ts`), `sweepMail` (`watch.ts`) |
| `readRegistryMeasured` | `refuses` | dispatch's pre-spawn and post-spawn reads (`coord/dispatch.ts`) |
| `readRegistryMeasured` | `gated` | dispatch's resume arm (`coord/dispatch.ts`) |
| `readRegistryMeasured` | `omits` | `tick`, `sweepTasks` (`watch.ts`) |
| `readRegistryMeasured` | `tests-only` | `sweepHookStates`'s own read (`watch.ts`; `tick` passes `records`), `assembleFleet`'s fallback (`fleet.ts`) |
| `readRegistryMeasured` | `stale` | `GET /api/fleet`, the ws cold start (`server.ts`) |
| `readRegistryMeasured` | `reports` | `listProjects` (`lifecycle.ts`), `GET /api/peers`, the claims-conflict path (`coord/routes.ts`) |

- Fingerprint keeps its own check (R26). `resolveDoneBranch` refuses a run whose `sessionId` fails the predicate with
  `tip-unmeasurable`, before its read. `verifyReviewDone` reads the WORK run's `sessionId`, which a review run's close
  gate does not check, so the check is reachable through a review close and is pinned there as well as directly.

### The masked arms and their masks

These arms answer the safe word, and their comments name the mask. Unless the last column names a pin of the arm's
own (R17 as amended, and the exported functions' unit pins), their pins are the mask's cases and
`readSessionRecord`'s zero-listing case (R17).

| Arm | Its answer for `bad-id` | Its mask | Pinned by |
|---|---|---|---|
| `/archive`'s `readSessionRecord` switch (`server.ts`) | 400 `bad-session-id` | `knownId` | `knownId`'s cases; the zero-listing case |
| `liveStatus` (`fleet.ts`), behind `/interrupt` | `'dead'` | `knownId` | `knownId`'s cases; the zero-listing case |
| `readAsk` on `/ask` (`server.ts`) | `null` | `knownId` | `knownId`'s cases; the zero-listing case |
| `readAsk` under `POST /api/asks/:id/answer` | never reached | `freshAskAt`'s `bad-id`, giving `UNMEASURED_ASK_AT` and then 409 `child-unmeasurable` before `answerAsk` reaches `readAsk` | the ask case, end to end: no keys sent, the ask stays `held` |
| dispatch's resume `childBindGate` | `spent-unmeasured` | the dispatch gate | the dispatch gate's cases; `childBindGate`'s own unit pin |
| `POST /api/runs`'s `childBindGate` | `spent-unmeasured` | the open gate | the open gate's cases; `childBindGate`'s own unit pin |
| `childGateAtClose` (`coord/close.ts`) | mark `unreadable` | both close gates | its own direct pin (R17 as amended), with an unlisted bad id |
| `measureClaimant` (`coord/reclaim.ts`) | `unmeasurable`, never `dead` | none on the dead-coordinator lane | its unit pin, and the lane case (no abandon, no ccd verb) |

Three arms answer exactly what absence answers, by design: `sessionws`'s `resolve`, `freshAskAt`, and
`releaseRetiredChildHold` (`changed`, R13). A fold changes nothing observable there, so their pin is the zero-listing
case. `freshAskAt`'s path is also pinned end to end by the ask case.

### The answers this wave adds

Every word already existed (R13). This wave adds no route, table, migration, ccd verb, capability token, agent grant,
L0 wire type or refusal word.

| Where | Condition | Answer |
|---|---|---|
| `knownId`'s 18 routes | id fails `isRegistryId` | 404 `{ ok: false, error: 'unknown-session' }`, before any listing |
| `POST /api/sessions/:id/ensure` | id fails | 400 `{ ok: false, error: 'bad-session-id' }` |
| `POST /api/sessions/:id/swap`, `crossPool: true` | id fails | 400 `bad-session-id`, ahead of the skew gate (R22) |
| `/stop`, `/swap` (ordinary arm), `/kickoff` | `readSessionRecord` answers `bad-id` | 400 `bad-session-id` |
| `/archive` | masked by `knownId` (R17) | the arm answers 400 `bad-session-id` |
| `/stop`, `/archive`, a legacy row | its wrapper part or `.project` fails `isRegistryId` (`stopPairRefused`) | 503 `{ ok: false, error: 'registry-unmeasurable' }` from the identity arm, with no argv composed; at `/archive`, before the turn read and the programme's end |
| `POST /api/asks/:id/answer` | stored `ask.childId` fails | 409 `{ ok: false, error: 'child-unmeasurable', detail }` (the existing answer, through `freshAskAt`'s `bad-id`, R17); no keys sent, the ask stays `held` |
| `POST /api/runs` | `claimedBy` or `sessionId` fails | 400 `{ ok: false, error: 'bad-session', detail: 'claimedBy is not a registry id' }`, or the same naming `sessionId` |
| `POST /api/runs` | a work `project` (as given) beginning `-` or `.` | 400 `{ ok: false, error: 'bad-request', detail: 'project must not begin with - or .' }` |
| `POST /api/runs/:id/reclaim` | the heir fails | 400 `{ ok: false, error: 'bad-session', detail }` (`which: 'heir'`) |
| `POST /api/runs/:id/reclaim` | the stored claimant fails | 409 `{ ok: false, error: 'bad-session', detail }` (`which: 'claimant'`), the detail naming `POST /api/runs/:id/abandon` |
| `POST /api/runs/:id/dispatch` (resume too) | stored `sessionId` fails | 409 `{ ok: false, error: 'bad-session' }` |
| `POST /api/runs/:id/close` (review runs too) | stored `sessionId` fails | 409 `{ ok: false, error: 'bad-session' }` |
| abandon, programme end, dead-coordinator sweep | stored `sessionId` fails | closed `failed`, `released: false`, `childReclaim: 'not-queued'`, `childReclaimWhy: 'marker-unreadable'`, no fleet act, one event (R6, R27) |
| `POST /api/runs/:id/advance` to `awaiting-review` or `merging` | stored `sessionId` fails | 409 `{ ok: false, reject: { code: 'bad-session' } }` |
| `POST /api/runs/:id/route` | stored `sid` fails | 409 `{ ok: false, error: 'bad-session' }` (the existing word, now from `isRegistryId`) |
| `GET /api/peers?of=` | trimmed `of` fails | 400 `{ ok: false, error: 'bad-session' }`, before any read (R23) |
| `GET /api/peers` (200) | refused rows exist | additive `refusedRows: number`, only when greater than 0 |
| `GET /api/projects` | always | additive `registry: 'listed' \| 'unlistable'` |
| `GET /api/fleet` | registry unlistable | `{ sessions: watcher?.currentFleet() ?? snapshot?.sessions ?? [], stale: true }` |
| the ws cold start (no watcher broadcast) | registry unlistable | no `fleet` frame; the `runs` frame is still sent (R19) |
| the mail sweep | recipient refused | held with gate `registry-unmeasurable`, never `rejectDelivery` |

Notes on the table:
- **What `POST /api/runs` checks (R29, R8).** It checks `claimedBy`, `sessionId` and a work run's `project` as given,
  untrimmed, which is how it stores them. A padded id that it once accepted now answers 400. The project check is a
  coordinator extension that closes the server's half of spec §2.2's ws-add row.
- **The reclaim door (R21).** It keeps its trim, because it stores the trimmed heir. Its stored-claimant check sits
  right after `no-claimant`, before any read.
- **The abandon arm (R6, R27).** It still runs the sweep gate. It writes its one
  `fleet-act-omitted:bad-session` event only after the store's close succeeds. `abandonRefusal` refuses nothing new
  for such a run, so the archive door's programme end ends such a programme whole.
- **Advance (R11).** The gate stands before `verifyDone` only, so a legacy row can still retreat to `working`.
- **Expiry (R9, R28).** `expireArchived` refuses a non-registry id as its step 0, before the capability read, with
  the existing `composition` outcome. `learnExpiry` refuses it before its own capability read, with `unreadable`.
  Both use one detail sentence saying the server refused the id, so neither `wsExpireAudit` nor `wsExpire` is ever
  built for it.
- **The collector (R10).** It has no source change. Mutation pins prove two things: the population gate keeps a bad
  id from the learning audit, and the executor's step-1 `isTmpRootId` keeps it from both builders.
- **Stop's order (spec §2.4).** `stopId` and `stopPair` send `['stop', '--surface', surface, id]` and
  `['stop', '--surface', surface, w, p]`. On the real binary, an id spelled `--surface` is now refused by usage, and a
  planted row named `pwa` is not stopped. With no surface, the bare form is unchanged.
- **Stop's pair parts (`stop-pair-fields-refused-at-composition`, a coordinator ruling at plan review).** `stopPair`
  takes its project from a legacy row's `.project`, and its wrapper from the row's `.wrapper` when the id does not end
  in `-<project>`: fields no id gate reads. `cmd_stop`'s `--surface=*` arm strips a token of that spelling from any
  position, so a field reading `--surface=<word>` made the pair a one-argument stop of the other token, in the
  leading, trailing and bare forms alike. No ccd rule closes that without also refusing the pre-W1a trailing order
  while the fleet box runs ahead of the server, so the server closes it. `/stop` and the archive door ask
  `stopPairRefused` in their identity arm: a row whose wrapper part or project part fails `isRegistryId` answers 503
  `registry-unmeasurable` with no argv composed, and the archive door asks before its turn read and the programme's
  end. At planning, none of the fleet box's 18 distinct registry projects began with `-` or `.`, so no row is
  stranded.
- **The id-argv census.** `id-argv-census.test.ts` classifies all 41 id-taking calls across 10 files by file, builder,
  origin and gate (SEC2 B, as R98 widens it). A new call, or a new `CCD_ARGV` key, must classify itself, or the suite
  goes red.

### Carried lines, and README

- **README stop prose: edited here.** #351 had merged when Task 0 ran (R14), so this wave edited README's two `stop`
  prose lines, each line-neutral:
  - the exec-whitelist bullet now spells the leading order, `ccd stop --surface <word> <id>`;
  - the old-ccd hazard line names `stop <id> --surface pwa` as the trailing order the server sent before this wave.
- **README stop prose: carried.** #351 had not merged when Task 0 ran (R14), so README's two `stop` prose lines still
  spell the trailing order: the exec-whitelist bullet's `ccd stop <id> --surface <word>`, and the old-ccd hazard line.
  The edit is one line-neutral change to each line, carried to the first wave that lands after #351.
- **The coordinator skill's `bad-session` rows (R24, `wave-lifecycle-rows-carried`).**
  `references/wave-lifecycle.md`'s rows for `bad-session` live under `ccd/`, outside this wave's boundary: open,
  dispatch, close, advance and reclaim, with "stop and report a stored defect; no fleet act ran". They are carried to
  W1b, which edits `ccd/`.
- **The abandon sheet (`abandon-sheet-misreads-an-omitted-fleet-act`).**
  - `pwa/src/fleet/AbandonSheet.tsx` speaks for `released: false` whenever the run had a session id.
  - After R6, it tells the operator `<workspace> is still claimed by another open run` for an abandon that performed
    no fleet act.
  - `pwa/` is outside this boundary, so this is carried.
- **The reclaim sheet drops the abandon pointer (`reclaim-sheet-drops-the-bad-session-detail`).**
  - `pwa/src/fleet/ResumeSheet.tsx`'s `reclaimErrorText` reads a 409's code only through `isReclaimRefuseCode`, and
    `bad-session` is not a `ReclaimRefuseCode`.
  - So the reclaim door's 409 for a stored claimant that is not a registry id (R5) reaches the operator as "the
    hand-over was refused, for a reason this build does not recognise". Its `detail`, which names
    `POST /api/runs/:id/abandon`, is not shown.
  - `pwa/` is outside this boundary, so this is carried. Measured: 0 such stored rows at Task 0.
- **A stored work-run `project` reaches `ws-add` unchecked (`work-run-project-reaches-ws-add-unchecked`).**
  - At dispatch, a stored `project` reaches `CCD_ARGV.wsAddWorker(run.project, …)` with no server re-check.
  - Measured: 0 such rows at Task 0, and the `POST /api/runs` check covers every new row.
  - W1b's ws-add loop and `_ws_project_valid` close it.
- **The expiry lane's words for the executor's own refusal (`expiry-composition-words-misread-a-server-refusal`).** R9 answers a non-registry id with `composition`, whose detail says no call was composed, but `expireFeedBody`'s `composition` arm still says "ccd rejected the call this server composed" and `archivedExpiry.ts`'s lane report says "the server composed a call ccd rejected". The lane's population omits refused rows (Task 5), so production does not reach it. `archivedExpiry.ts` is outside this boundary and Task 12 keeps its hunk to the guards while #351 shares the file, so this is carried.
- **The real-binary parity rows.** Spec §2.8's `ccdargv-dec-parity` rows on the real binary, with the ids `--actor`,
  `--surface`, `--reason`, `--expect` and `--defer-expired`, go green only with W1b's loops, so they ride W1b.
- **Prose that still calls `POST /api/runs` unguarded (`session-shape-prose-predates-the-id-gate`).** After Tasks 9 and 10, these comments still say that `POST /api/runs` checks `claimedBy`/`sessionId` only for a non-empty string, or that the routing door asks `isSessionIdShape`:
  - `shared/api.ts`'s docstring above `SESSION_ID_SEGMENT`, which sits above the foot block;
  - `coord/store.ts`'s docstring of the `reclaim:` event reader, a file this wave never edits;
  - the comments in `run-signals-routing.test.ts` (above its `isSessionIdShape` describe), `run-route-route.test.ts` (above the `'bad claimant'` case) and `child-reclaim-paused-at-server.test.ts` (above its `from` round-trip cases).

  Legacy rows can still hold such ids, so each comment's conclusion stands; only its description of the route is stale. Carried to the first wave that edits each file.
- **The full rename of `TMPROOT_ID_MAX_CHARS`.** It touches `coord/store.ts`, so it waits until after #351. Until
  then, the alias stands.
- **SEC2 C and D.** A `RegistryId` brand on every builder, or an assertion inside each id-taking builder, stays in the
  spec's "Later".

### Departures recorded while building

These are the departures the SDD ledger recorded for Tasks 0 to 15 that the sections above do not already name, one
measured sentence each.
EOF
```

What the heredoc does to the file:
- The `printf` before it starts with one empty line, so the `---` cannot join the file's last line as a setext heading (Step 0's (e5)). It writes the section's heading itself, outside the heredoc, so that this plan's own text never holds that heading at the start of a line: Step 0's (e3), Step 1's check and Step 5's `sed` range each find the appended heading and nothing else.
- Delete the bullet that does not apply, from "README stop prose" (one of the two).
- If Step 2 listed no extra slug, delete the last heading and its sentence. Otherwise, add one bullet per slug below that sentence, in the form ``- `<slug>`: <one sentence, measured at the tip>.``

- [ ] **Step 4: README (ONLY if Step 0's (r1) and (r2) both held)**

Each edit replaces one line with one line.

(a) The exec-whitelist bullet, located by ``which is what lets `ccd stop <id> --surface <word>` ``.

Before:
```markdown
  everything after the verb unconstrained, which is what lets `ccd stop <id> --surface <word>`
```
After:
```markdown
  everything after the verb unconstrained, which is what lets `ccd stop --surface <word> <id>`
```

(b) The hazard line, located by ``ccd parses `stop <id> --surface pwa` as a two-argument stop of a session``.

Before:
```markdown
  ccd parses `stop <id> --surface pwa` as a two-argument stop of a session
```
After:
```markdown
  ccd parses the trailing order the server sent before path identity W1a, `stop <id> --surface pwa`, as a two-argument stop of a session
```

The next line (``literally named `<id>---surface`, exits 0, and the real session is never``) is unchanged. The sentence still reads whole.

Then check:

```bash
git diff --numstat -- README.md                                                        # 2	2	README.md
git diff -U0 -- README.md | grep -c '^@@'                                               # 2
grep -c 'ccd stop <id> --surface <word>' README.md                                      # 0
grep -c 'which is what lets `ccd stop --surface <word> <id>`' README.md                 # 1
```

- [ ] **Step 5: Run the section check: GREEN**

Re-run Step 1's `node -e` command exactly as written.

Expected: `as-built ok`, then `check rc=0`.

Then:

```bash
awk '/^## Deviations found$/{f=1} f && $0 == "## As built (W1a, run 399)"{p=1} p' docs/superpowers/plans/2026-10-12-path-identity-w1a-server-id-gate.md | grep -cE 'D-[0-9]|[0-9]{4} ?(–|\.\.|-) ?[0-9]{4}'   # 0
git diff --stat -- docs/superpowers/plans/2026-10-12-path-identity-w1a-server-id-gate.md   # insertions only
git diff -- docs/superpowers/plans/2026-10-12-path-identity-w1a-server-id-gate.md | grep -c '^-[^-]'   # 0: nothing above the section changed
```

- [ ] **Step 6: Run the suites the change touches**

```bash
git fetch origin main
cd server && ./node_modules/.bin/vitest run test/deviation-refs.test.ts test/dtbd.test.ts test/topology-clean.test.ts
```

Expected: PASS. Each suite's role:
- `deviation-refs`: compares this branch's plans with `origin/main`'s, and the section defines no number.
- `dtbd`: no concrete placeholder.
- `topology-clean`: no host or topology name in a tracked file.

Only if Step 4 edited README:

```bash
cd server && ./node_modules/.bin/vitest run test/readme-holds.test.ts
cd server && ./node_modules/.bin/vitest run test/session-hook.test.ts -t 'README HAS ITS OWN CENSUS|every line citation is anchored'
```

Expected: PASS.
- `readme-holds.test.ts`'s describe `README: the --surface bullet` slices the exec-whitelist bullet from `- **Exec whitelist**:` to `- **Path whitelist**:` and scans it sentence by sentence. Neither edited sentence adds `every`, `all`, `any`, `always`, `record`, `stamp` or `cli`. The bullet still names `conditional`, `stop-surface`, `stopSurfaceSupported`, `opposite`, `silent success`, `rollback` and `60`.
- The session-hook cases read README's `shared/api.ts:` anchors. Both edits are line-neutral and far from them.

Each run is in the foreground, with a timeout of at least 600000 ms.

- [ ] **Step 7: The section check's own controls (scratch edits, then reverted)**

The check is the task's only test, so prove that it sees what it checks. Apply each mutation alone with the Edit tool, re-run Step 1's command, see the red, and revert.

| # | Mutation | Expected red |
|---|---|---|
| T16.1 | In the section, add a deviation token to one sentence: the letter D, a hyphen and four digits. Type it in the scratch edit only, never in a committed file | `as-built RED: a deviation token`, `check rc=1` |
| T16.2 | Delete `` `bad-id-is-not-a-code` `` from the readers section | `as-built RED: slug bad-id-is-not-a-code missing` |
| T16.3 | Leave BOTH README bullets in place | `as-built RED: README stop prose: 2 variants, not one` |
| T16.4 | Delete the `stale` row of the reader table | `as-built RED: reader table rows 11, not 12` |

Revert each one. Then confirm the tree with `git diff --stat`: only the plan file, and README when Step 4 ran. Re-run Step 1's command: `as-built ok`.

- [ ] **Step 8: Commit**

```bash
git add docs/superpowers/plans/2026-10-12-path-identity-w1a-server-id-gate.md
git add README.md   # only if Step 4 edited it; otherwise this stages nothing
git diff --cached --name-only   # the plan file, and README.md only when Step 4 ran
git commit -F - <<'EOF'
docs(path-identity): W1a as built

The plan gains "As built (W1a, run 399)", after Deviations found. It
records where the server's id gate, as built, differs from spec §2.3. Two
request-id routes, /ensure and the cross-pool swap, are gated at their own
heads, so knownId is not the one choke point, and its census stays 18. The
watches omit a refused id and retain nothing. The predicate sits at the
foot of shared/api.ts, with TMPROOT_ID_MAX_CHARS as a derived alias.
Masked reader arms are pinned by their masks, except close's child gate,
which is pinned directly. Resume dispatch refuses with bad-session rather
than holding.

It lists the 23 classified registry reader sites, the masked arms and
their masks, and the answers this wave adds. It also lists the carried
lines: the coordinator skill's bad-session rows, the abandon sheet's
reading of an omitted fleet act, the reclaim sheet's dropped bad-session
detail, a stored work-run project reaching ws-add, the expiry lane's
words for a server refusal, prose that predates the id gate, the
real-binary parity rows, the alias's rename, and SEC2 C and D.
Departures are named by slug and carry no number.

README's two stop prose lines spell the leading order when #351 had
merged by Task 0. Otherwise they are a carried line.
EOF
```

If Step 4 did not run, replace the last paragraph of the body with: "README's two stop prose lines are carried, because #351 had not merged by Task 0."

---

---

### Task 17: Whole-branch verification and the PR

**Model routing:** `sonnet`, effort `high`. Steps 1 to 4 may run in a subagent. Steps 5 and 6 run in the worker's own main thread, because they push, open the PR and send mail. A subagent never sends mail and never invokes a ccrc skill.

**Files:**
- Create: none.
- Modify: none. Step 3 has no `docs(census)` commit; see `census-move-is-a-stop` in the drafter notes.
- Test: none new. This task runs existing suites only.
- Scratch, outside the tree, removed in the same step: the PR body file (`mktemp`), and a detached `origin/main` worktree under `${TMPDIR:-/tmp}`, used only when a red has to be checked against `main`.

**Interfaces:**
- **Consumes:**
  - every canonical name this wave built, through the suites that pin it: `isRegistryId`, `REGISTRY_ID_MAX_CHARS`, `SingleRead`, `RegistryRead.refused`, `ReclaimOutcome`'s `bad-session` member, `DispatchOutcome`, `CloseOutcome`, `listProjects`'s `registry`, `stopId` and `stopPair`, and `knownId`;
  - Task 15's claim "41 id-taking calls across 10 files", through `id-argv-census.test.ts`.
- **Produces:**
  - no code interface;
  - the PR "Path identity W1a: the server's id gate";
  - the `wave-done` mail for run 399, whose `suite:` line is Step 1's verdict.

This task adds no guard, so it has no failing test of its own and no mutation row. Its checks are the measurements below. Each one states what it must print.

- [ ] **Step 1: The FIRST full run after implementation, in the foreground**

This run's verdict is the wave-done's `suite:` line (worker clause 15). Record it in the SDD ledger before any fix. A later fix never changes it.

Run each line below as its own Bash call from the workspace root, with a timeout of 600000 ms and never in the background. Each `cd server && …` (or `cd agent`, `cd pwa`) line here and in Steps 2 and 3 assumes it starts at the workspace root: in a shell that keeps its directory between calls, write it as `(cd server && …)`, or every line after the first fails on `cd`:

```bash
cd server && npm ci
cd server && find test -name '*.test.ts' | wc -l
cd server && MB=$(git merge-base origin/main HEAD) && echo "base $(git ls-tree -r --name-only "$MB" -- test | grep -c '\.test\.ts$') added $(git diff --name-only --diff-filter=A "$MB" HEAD -- test | grep -c '\.test\.ts$') deleted $(git diff --name-only --diff-filter=D "$MB" HEAD -- test | grep -c '\.test\.ts$')"
```

Expected:
- the `find` count equals `base + added`;
- `added` is `16`: the sixteen new files in the File Structure table;
- `deleted` is `0`;
- at `837a099c0`, `base` is `664`, so `find` prints `680`. If the branch absorbed `main`, `base` may differ.

Then run the 24 shards, one call each:

```bash
cd server && ./node_modules/.bin/vitest run --shard=1/24
cd server && ./node_modules/.bin/vitest run --shard=2/24
cd server && ./node_modules/.bin/vitest run --shard=3/24
cd server && ./node_modules/.bin/vitest run --shard=4/24
cd server && ./node_modules/.bin/vitest run --shard=5/24
cd server && ./node_modules/.bin/vitest run --shard=6/24
cd server && ./node_modules/.bin/vitest run --shard=7/24
cd server && ./node_modules/.bin/vitest run --shard=8/24
cd server && ./node_modules/.bin/vitest run --shard=9/24
cd server && ./node_modules/.bin/vitest run --shard=10/24
cd server && ./node_modules/.bin/vitest run --shard=11/24
cd server && ./node_modules/.bin/vitest run --shard=12/24
cd server && ./node_modules/.bin/vitest run --shard=13/24
cd server && ./node_modules/.bin/vitest run --shard=14/24
cd server && ./node_modules/.bin/vitest run --shard=15/24
cd server && ./node_modules/.bin/vitest run --shard=16/24
cd server && ./node_modules/.bin/vitest run --shard=17/24
cd server && ./node_modules/.bin/vitest run --shard=18/24
cd server && ./node_modules/.bin/vitest run --shard=19/24
cd server && ./node_modules/.bin/vitest run --shard=20/24
cd server && ./node_modules/.bin/vitest run --shard=21/24
cd server && ./node_modules/.bin/vitest run --shard=22/24
cd server && ./node_modules/.bin/vitest run --shard=23/24
cd server && ./node_modules/.bin/vitest run --shard=24/24
```

How to read the shards:
- Use ONE denominator for the whole set. If any shard overruns 600 s, discard the set and run it again at `--shard=k/48`, for k from 1 to 48, one call each.
- For each shard, record its `Test Files` line in the ledger: the counts, and the total in parentheses.
- The totals must sum to the `find` count. A shortfall means a file never ran, and the verdict is `unrun` until the whole set has run.
- Record which shard printed `test/ccd-stop-argv-order.test.ts`, and that it passed there (review lens 3).

Then run the other two packages, one call each. `agent/` and `pwa/` have no modules in an isolated worktree:

```bash
cd agent && npm ci
cd agent && npm run test
cd pwa && npm ci
cd pwa && npm run test
```

Both must be green with no change. The PWA bundles `shared/api.ts`, so a green PWA run proves that the foot-block insertion compiles there.

Then run the real-binary stop file alone (review lens 3):

```bash
cd server && ./node_modules/.bin/vitest run test/ccd-stop-argv-order.test.ts
```

Expected: PASS.

**Reading a red.**
1. **A file on CLAUDE.md's load-flake list** (`ccd-ws-gc`, `pr-sweep`, `session-hook`, `typecheck-tests`, `ccd-session-state`, `ccd-bounded-reads`, and the collector suites `ccd-ws-collect-*` and `ccd-collect-*`): re-run it alone, `./node_modules/.bin/vitest run test/<file>`. Record both results. A flake that passes alone is a flake, but the first run's verdict still stands.
2. **Any other red, or a flake that is red alone.** Check it against a clean `main` in one call:

```bash
git fetch origin main && git worktree add --detach "${TMPDIR:-/tmp}/w1a-main-red" origin/main && cd "${TMPDIR:-/tmp}/w1a-main-red/server" && npm ci && ./node_modules/.bin/vitest run test/<the red file>; rc=$?; cd - >/dev/null; git worktree remove --force "${TMPDIR:-/tmp}/w1a-main-red"; echo "main rc=$rc"
```

   - If `main` is red on the same case, report it once as `main-red` and leave it alone.
   - If `main` is green, the red is this wave's. Fix it in its own commit, `fix(server): <the case it fixes>`, after the verdict is recorded. Then re-run that file alone, and run the 24 shards once more.
   - The `suite:` line stays `red`. `failure:` takes one word: `shallow` (a missed test or a plan half-followed), `ceiling` (an ambiguity, a design flaw, or a debug that survived two attempts) or `unclear`.

- [ ] **Step 2: Type-check, build, and the token cross-checks**

Run each line as its own call (600000 ms):

```bash
cd server && ./node_modules/.bin/tsc --noEmit -p .
cd pwa && npm run build
git fetch origin main
cd server && ./node_modules/.bin/vitest run test/deviation-refs.test.ts test/dtbd.test.ts test/single-definition.test.ts test/topology-clean.test.ts test/verb-gate.test.ts test/unattended-actor.test.ts test/typecheck-tests.test.ts test/mail-routes.test.ts test/routes.test.ts test/registry.test.ts test/whitelist-subset.test.ts test/id-argv-census.test.ts
git log origin/main..HEAD --format=%B | grep -cE 'D-[0-9]'
git log origin/main..HEAD --format=%B | grep -cE '[0-9]{4} ?(–|\.\.|-) ?[0-9]{4}'
git diff origin/main...HEAD | grep -nE '^\+.*D-[0-9]+ ?(–|\.\.|-) ?(D-)?[0-9]+'
comm -23 <(git diff origin/main...HEAD | grep -E '^\+[^+]' | grep -oE 'D-[0-9]+' | sort) <(git diff origin/main...HEAD | grep -E '^-[^-]' | grep -oE 'D-[0-9]+' | sort)
MB=$(git merge-base origin/main HEAD); echo "routes base $(git grep -hoE '\bapp\.(get|post|put|delete|patch)\(' "$MB" -- server/src | wc -l) head $(git grep -hoE '\bapp\.(get|post|put|delete|patch)\(' HEAD -- server/src | wc -l)"
git diff origin/main...HEAD -- shared/api.ts | grep -nE '^[-+].*\bFLEET_PROTO(_MIN)? ='
git status --porcelain --untracked-files=no
```

Expected:
- `tsc` and `npm run build` exit 0;
- the vitest call PASSES every file. `id-argv-census` holds the claim "41 id-taking calls across 10 files", or the re-count Task 15 recorded if #351 or run 400 had merged by then;
- both `grep -c` lines print `0`;
- the range grep prints nothing;
- the `comm` line prints nothing. This wave adds no deviation token. A line that only moved carries its existing token on both a `-` line and a `+` line, so it cancels out;
- `routes base N head N`, with the two numbers equal: no new route;
- the `FLEET_PROTO` grep prints nothing: no wire bump;
- `git status` prints nothing: the builds left no tracked change.

- [ ] **Step 3: The citation tax and the README size**

```bash
cd server && ./node_modules/.bin/vitest run test/session-hook.test.ts -t 'every line citation is anchored|CITATION DEBT|README HAS ITS OWN CENSUS|THE RANGE BOUND'
git diff --name-only origin/main...HEAD -- server/test/session-hook.test.ts
git diff --numstat origin/main...HEAD -- README.md
```

Expected:
- the vitest call PASSES. The census map is untouched, so `'shared/api.ts': 1` and `'server/test/single-definition.test.ts': 8` read as on `main`;
- the second line prints nothing: this wave never edits `session-hook.test.ts`;
- the third line prints nothing when Task 0's (d1) read `OPEN`. When (d1) read `MERGED` and Task 16 edited the stop prose, it prints one line whose two counts are equal (line-neutral, R14).

The census tracks only two files that this wave edits. R1 keeps `shared/api.ts`'s edits below every cited line, and Task 1 appends to `single-definition.test.ts` only after its last line. A red `CITATION DEBT` or `RANGE BOUND` case that a clean `main` does not show (Step 1's worktree check) therefore means an edit landed above a cited line. **STOP** with `census-move-is-a-stop`, and name the moved file and its count. Never re-measure the entry to turn it green.

- [ ] **Step 4: The hard boundary, the foot block, and the overlaps**

Run as one call:

```bash
git fetch origin
git diff --name-only origin/main...HEAD | grep -vE '^(server/src/(server|registry|fleet|sessionws|commands|lifecycle|watch|ccdargv)\.ts$|server/src/coord/(routes|close|dispatch|reclaim|childBind|childReclaim|fingerprint|expireArchived)\.ts$|server/test/|shared/api\.ts$|README\.md$|docs/superpowers/plans/2026-10-12-path-identity-w1a-server-id-gate\.md$)'
git diff --name-only origin/main...HEAD -- ccd/ agent/ pwa/ deploy/ CLAUDE.md docs/superpowers/specs/ docs/superpowers/programs/ server/src/coord/store.ts server/src/coord/schema.ts server/src/archivedExpiry.ts server/src/deadCoordinator.ts server/src/coord/endDeadCoordinator.ts server/src/coord/archiveDoor.ts server/src/coord/childSpent.ts server/src/collectLane.ts server/src/coord/collectTempRoot.ts server/src/childReclaimSweep.ts
git diff origin/main...HEAD -- docs/superpowers/plans/2026-10-12-path-identity-w1a-server-id-gate.md | grep -cE '^-[^-]'
MB=$(git merge-base origin/main HEAD)
FOOT_MB=$(git show "$MB:shared/api.ts" | grep -nF "/* ── child-workspace reclamation: the temp-root collector's server lane" | cut -d: -f1)
FOOT_MAIN=$(git show origin/main:shared/api.ts | grep -nF "/* ── child-workspace reclamation: the temp-root collector's server lane" | cut -d: -f1)
FOOT_HEAD=$(grep -nF "/* ── child-workspace reclamation: the temp-root collector's server lane" shared/api.ts | cut -d: -f1)
echo "foot merge-base=$FOOT_MB origin/main=$FOOT_MAIN head=$FOOT_HEAD"
git diff -U0 "$MB" HEAD -- shared/api.ts | awk -v foot="$FOOT_MB" '/^@@ / { split($2, a, ","); s = substr(a[1], 2) + 0; n++; if (s < foot) bad++ } END { printf "hunks %d, above-foot %d\n", n, bad + 0 }'
git show origin/main:README.md | grep -n 'shared/api\.ts:[0-9]'
git merge-tree --write-tree --name-only --no-messages HEAD origin/main; echo "merge-tree rc=$?"
gh pr view 351 --json state -q .state
gh pr list --state all --json number,state,title -q '.[] | "\(.number) \(.state) \(.title)"' | grep -i 'collector' | grep -i 'wave 10\|settings'
```

Expected:
- the first two diffs print nothing. `README.md` appears in the full name list only when Task 0's (d1) read `MERGED` (R14). Otherwise a `README.md` entry is a boundary break: STOP `boundary-break`;
- the plan-file count prints `0`: Task 16 only added its as-built section;
- each `foot` value is exactly one number, and `FOOT_HEAD` equals `FOOT_MB`. At `837a099c0`, `FOOT_MB` is `9679`. Run 400 or #351 may have moved `FOOT_MAIN`; record it (R30);
- `above-foot 0`: every `shared/api.ts` hunk sits at or below the block's own section comment;
- the README grep prints one line (README `:4956` at `837a099c0`), and every `:NNNN` it names is below `FOOT_MAIN`;
- `merge-tree rc=0`. If it prints `rc=1` with a tree id on its first line, the branch conflicts with `main`. That is clause 16's first trigger: run `git merge origin/main` once (never a rebase), resolve by content, then re-run Steps 2 to 4. Step 1's verdict stays. Any other rc is unmeasured, and licenses nothing;
- record the #351 state and run 400's PR line in the ledger. A PR that merged after Task 0 with `rc=0` is not a trigger: absorb nothing. Name it in the wave-done prose, so the reviewer reads the census suites on the PR's merge ref.

- [ ] **Step 5: Push and open the PR (the worker's main thread)**

Run as one call:

```bash
BR=$(git branch --show-current)
git push -u origin "$BR"
EXISTING=$(gh pr list --head "$BR" --state open --json number -q '.[0].number')
SUITE_LINE='REPLACE with the Step 1 record from the ledger, verbatim (its shape: suite: green, 680 files over 24 shards, all passed; agent and pwa green unchanged)'
EXTRA_SLUGS=''   # each further departure slug recorded in the ledger during Tasks 0 to 16, comma-separated, or empty
if git diff --quiet origin/main...HEAD -- README.md; then README_CARRY="- README's two \`stop\` prose lines still show the old argument order; they ride the next README edit after #351 (R14)."; else README_CARRY="- README's two \`stop\` prose lines were updated here, line-neutral (R14)."; fi
BODY=$(mktemp)
cat > "$BODY" <<'EOF'
## What this does

Path identity, wave W1a (spec `docs/superpowers/specs/2026-10-12-path-identity-design.md`, §2.1, §2.2, §2.3, §2.7 SEC2 B and SEC8 A, and §2.8's server rows). It is the server's half of spec §2: no id that ccd could read as a flag reaches an id-taking argv that the server composes. Deploy class: **server**. It makes no ccd, agent or PWA edit.

The boundary of the claim: this is not an OS wall. A session can still run `ccd` directly. ccd's own half (its loops and predicates) is wave W1b, which waits for #351.

## Tasks

0. Entry conditions (read-only)
1. L0: `isRegistryId`, `REGISTRY_ID_MAX_CHARS`, and `isTmpRootId` derived from them
2. Request-id routes: `knownId`, `/ensure` and the cross-pool swap
3. Stored-row gates: `dispatchRun`, `closeRun` and the abandon arm
4. `SingleRead.kind` and its 14 callers
5. `RegistryRead.refused`, the refused-name log, and the reader census
6. The seven measured callers place refused rows, and dispatch's pre-spawn read is measured
7. Three more callers migrate: the fleet fallback, projects and peers
8. The eight retained `readRegistry` callers, pinned
9. `POST /api/runs` and the reclaim door
10. The routing door
11. The advance gate
12. The expiry executor boundary
13. The collector's id pins
14. stop's builder order
15. The id-argv census
16. Docs: W1a as built
17. Whole-branch verification and this PR

## Boundary

Edited: `shared/api.ts` (its foot block only), `server/src/` (`server.ts`, `registry.ts`, `fleet.ts`, `sessionws.ts`, `commands.ts`, `lifecycle.ts`, `watch.ts`, `ccdargv.ts`), `server/src/coord/` (`routes.ts`, `close.ts`, `dispatch.ts`, `reclaim.ts`, `childBind.ts`, `childReclaim.ts`, `fingerprint.ts`, `expireArchived.ts`), `server/test/`, and the plan's as-built section.

Not edited: `ccd/`, `agent/`, `pwa/`, `deploy/`, `CLAUDE.md`, the spec, `coord/store.ts`, `coord/schema.ts`. No route, table, migration, ccd verb, capability token, agent grant, L0 wire type or refusal word is added, and `FLEET_PROTO` is unchanged. There are three additive, absence-permitting response fields: `/api/projects`'s `registry`, `/api/peers`'s `refusedRows`, and `GET /api/fleet`'s `stale: true`.

## Answers this wave adds (every word already existed)

| Where | Condition | Answer |
|---|---|---|
| `knownId`'s 18 routes | id fails `isRegistryId` | 404 `unknown-session`, before any listing |
| `POST /api/sessions/:id/ensure` | id fails | 400 `bad-session-id` |
| `POST /api/sessions/:id/swap`, `crossPool: true` | id fails | 400 `bad-session-id`, ahead of the skew gate |
| `/stop`, `/swap` (ordinary arm), `/kickoff` | `readSessionRecord` answers `bad-id` | 400 `bad-session-id` |
| `/archive` | masked by `knownId` | the arm answers 400 `bad-session-id` |
| `/stop`, `/archive`, a legacy row | its wrapper part or `.project` fails `isRegistryId` | 503 `registry-unmeasurable` from the identity arm, with no argv composed; at `/archive`, before the turn read and the programme's end |
| `POST /api/asks/:id/answer` | stored `ask.childId` fails | 409 `child-unmeasurable` (through `freshAskAt`'s `bad-id`); no keys sent, the ask stays `held` |
| `POST /api/runs` | `claimedBy` or `sessionId` fails | 400 `bad-session`, the detail naming the field |
| `POST /api/runs` | a work `project` (as given) beginning `-` or `.` | 400 `bad-request`, detail `project must not begin with - or .` |
| `POST /api/runs/:id/reclaim` | the heir fails | 400 `bad-session` |
| `POST /api/runs/:id/reclaim` | the stored claimant fails | 409 `bad-session`, the detail naming `POST /api/runs/:id/abandon` |
| `POST /api/runs/:id/dispatch` (resume too) | stored `sessionId` fails | 409 `bad-session` |
| `POST /api/runs/:id/close` (review runs too) | stored `sessionId` fails | 409 `bad-session` |
| abandon, programme end, dead-coordinator sweep | stored `sessionId` fails | closed `failed`, `released: false`, `childReclaim: 'not-queued'`, `childReclaimWhy: 'marker-unreadable'`, no fleet act, one run event `fleet-act-omitted:bad-session` |
| `POST /api/runs/:id/advance` to `awaiting-review` or `merging` | stored `sessionId` fails | 409 `reject.code: 'bad-session'` |
| `POST /api/runs/:id/route` | stored `sid` fails | 409 `bad-session` (now from `isRegistryId`) |
| `GET /api/peers?of=` | trimmed `of` fails | 400 `bad-session`, before any read |
| `GET /api/peers` (200) | refused rows exist | additive `refusedRows`, only when greater than 0 |
| `GET /api/projects` | always | additive `registry: 'listed' \| 'unlistable'` |
| `GET /api/fleet` | registry unlistable | the watcher's or the snapshot's fleet, with `stale: true` |
| ws cold start (no watcher broadcast) | registry unlistable | no `fleet` frame; the `runs` frame is still sent |
| the mail sweep | recipient refused | held with gate `registry-unmeasurable`, never rejected |

`stop` now sends `--surface <word>` before the id or the pair. On the real binary (pinned in a fixture HOME), an id spelled `--surface` can no longer become a stop of `pwa`. A ccd that does not advertise `stop-surface` gets no flag at all, as before. A legacy row whose wrapper or project part is not a registry id is refused 503 `registry-unmeasurable` at `/stop` and at the archive door before its pair is composed: ccd strips a `--surface=<word>` token from any position, so such a field would otherwise stop a session nobody named, in any argv order.

## Masked arms (pinned by their masks)

- `server.ts`'s `/archive` arm, and `fleet.ts`'s `liveStatus` behind `/interrupt`: masked by `knownId`.
- `readAsk`, through `/ask`: masked by `knownId`. Through `POST /api/asks/:id/answer`: masked by `freshAskAt`'s `bad-id`, pinned end to end.
- Dispatch's resume `childBindGate`: masked by the dispatch gate.
- `POST /api/runs`'s `childBindGate`: masked by the open gate.
- `close.ts`'s `childGateAtClose`: masked by both close gates, and ALSO pinned directly with an unlisted bad id, because spec §2.3 names it among the four absence-acting callers.
- `childBindGate`, `measureClaimant` and `reclaimChild` are exported and keep unit pins. `measureClaimant` is also reached unmasked through the dead-coordinator lane.

EOF
printf '## Suite\n\n%s\n\n' "$SUITE_LINE" >> "$BODY"
cat >> "$BODY" <<'EOF'
## Carried lines

- The coordinator skill's `references/wave-lifecycle.md` rows for `bad-session` (open, dispatch, close, advance, reclaim) live under `ccd/`. They ride W1b.
- `pwa/src/fleet/AbandonSheet.tsx` reads `released: false` as "still claimed by another open run", which misdescribes an abandon that performed no fleet act. `pwa/` is outside this wave.
- `pwa/src/fleet/ResumeSheet.tsx` shows the reclaim door's 409 `bad-session` as an unrecognised refusal and drops its `detail`, which names the abandon door. `pwa/` is outside this wave.
- A stored work-run `project` reaches the dispatch `ws-add` with no server re-check. 0 such rows were measured, and the POST check covers new rows. W1b's ws-add loop closes it.
- Spec §2.8's real-binary parity rows (ids `--actor`, `--surface`, `--reason`, `--expect`, `--defer-expired`) go green only with W1b's loops, so they ride W1b.
- `TMPROOT_ID_MAX_CHARS`'s full rename waits until after #351.
- SEC2 C and D are left for later (spec "Later").
EOF
printf '%s\n\n' "$README_CARRY" >> "$BODY"
cat >> "$BODY" <<'EOF'
## Departures, by slug

`registry-id-at-foot`, `masked-arms-pinned-by-their-masks`, `fleet-fallback-is-tests-only`, `cold-start-skips-an-unmeasured-fleet`, `bad-id-is-not-a-code`, `wave-lifecycle-rows-carried`, `resume-dispatch-refuses-not-holds`, `abandon-sheet-misreads-an-omitted-fleet-act`, `reclaim-sheet-drops-the-bad-session-detail`, `work-run-project-reaches-ws-add-unchecked`, `stop-pair-fields-refused-at-composition`
EOF
[ -n "$EXTRA_SLUGS" ] && printf '\nRecorded during the wave: %s\n' "$EXTRA_SLUGS" >> "$BODY"
printf '\n🤖 Generated with [Claude Code](https://claude.com/claude-code)\n' >> "$BODY"
if grep -nE '/home/|/Users/|/root/|/mnt/|\.ts\.net|linear\.app|\b100\.[0-9]+\.[0-9]+\.[0-9]+|\bD-[0-9]|REPLACE' "$BODY" || grep -oE 'https?://[^ )>]+' "$BODY" | grep -vE '^https://(github\.com|claude\.com)(/|$)'; then echo 'body-not-clean'; rm -f "$BODY"; exit 1; fi
if [ -n "$EXISTING" ]; then echo "pr-exists $EXISTING"; rm -f "$BODY"; exit 1; fi
gh pr create --base main --head "$BR" --title "Path identity W1a: the server's id gate" --body-file "$BODY"
rm -f "$BODY"
```

Before running it:
- set `SUITE_LINE` to the ledger's Step 1 record, verbatim. Its placeholder value holds `REPLACE`, and the scan refuses a body that still holds `REPLACE`, so an unset suite line is never posted;
- set `EXTRA_SLUGS` to any further slug the ledger recorded.

Expected: the push succeeds, the body scan prints nothing, and `gh pr create` prints the PR URL.
- **`body-not-clean`:** fix the text and re-run. Never post first and edit later, because GitHub keeps every revision.
- **`pr-exists <n>`:** a PR is already open for this branch. Do not open a second one. Edit its body over REST (`gh api -X PATCH repos/{owner}/{repo}/pulls/<n> -F body=@<file>`), after the same scan.
- **A pre-push hook refusal** (identity residue): STOP, and report it by slug `push-refused`.

- [ ] **Step 6: The wave-done, in the same turn as the push (the worker's main thread)**

First list your mail and handle anything waiting (ack by the DELIVERY id, never the row id):

```bash
API="$HOME/.local/bin/ccrc-api"; who=$("$API" whoami) || { echo 'identity refused' >&2; exit 1; }; id=${who#*\"id\":\"}; id=${id%%\"*}; "$API" mail list --to "$id"
```

Then measure the fingerprint once and send it once, in one call:

```bash
API="$HOME/.local/bin/ccrc-api"
who=$("$API" whoami) || { printf 'identity refused\n' >&2; exit 1; }
id=${who#*\"id\":\"};     id=${id%%\"*}
uuid=${who#*\"uuid\":\"}; uuid=${uuid%%\"*}
[[ -n "$id" && -n "$uuid" ]] || { printf 'identity unreadable\n' >&2; exit 1; }
SUITE=green      # the ledger's Step 1 verdict: green, red or unrun
FAILURE=''       # empty when SUITE=green; otherwise shallow, ceiling or unclear
BR=$(git branch --show-current)
git fetch origin "$BR"
TIP=$(git rev-parse HEAD)
[[ "$TIP" == "$(git rev-parse "origin/$BR")" ]] || { echo 'tip-not-pushed'; exit 1; }
PR=$(gh pr list --head "$BR" --state all --json number -q '.[0].number')
[[ "$PR" =~ ^[0-9]+$ ]] || { echo 'pr-unmeasured'; exit 1; }
PHASE=$(gh pr view "$PR" --json state,isDraft -q 'if .isDraft then "draft" elif .state == "OPEN" then "open" elif .state == "MERGED" then "merged" elif .state == "CLOSED" then "closed" else "unknown" end')
S351=$(gh pr view 351 --json state -q .state)
PROSE=$(printf '%s\n' \
  "Path identity W1a, run 399: PR #$PR, $(git rev-list --count origin/main..HEAD) commits on $BR. Deploy class: server." \
  "First full run: see the ledger's Step 1 record (shards, Test Files total, agent and pwa)." \
  "Departures by slug: registry-id-at-foot, masked-arms-pinned-by-their-masks, fleet-fallback-is-tests-only, cold-start-skips-an-unmeasured-fleet, bad-id-is-not-a-code, wave-lifecycle-rows-carried, resume-dispatch-refuses-not-holds, stop-pair-fields-refused-at-composition, plus any the ledger recorded." \
  "Carried: wave-lifecycle bad-session rows (W1b), abandon-sheet-misreads-an-omitted-fleet-act, reclaim-sheet-drops-the-bad-session-detail, work-run-project-reaches-ws-add-unchecked, the real-binary parity rows (W1b), the TMPROOT_ID_MAX_CHARS rename, SEC2 C and D; README stop prose: $(git diff --quiet origin/main...HEAD -- README.md && echo carried || echo landed here)." \
  "Overlaps at Step 4: #351 $S351; run 400's PR as recorded in the ledger. Step 4 merge-tree was clean, so main was not absorbed; read the census suites on the merge ref.")
ID="$id" UUID="$uuid" SUITE="$SUITE" FAILURE="$FAILURE" TIP="$TIP" PR="$PR" PHASE="$PHASE" PROSE="$PROSE" node -e '
const e = process.env;
const lines = ["suite: " + e.SUITE];
if (e.FAILURE) lines.push("failure: " + e.FAILURE);
lines.push(JSON.stringify({ branchTip: e.TIP, prNumber: Number(e.PR), prPhase: e.PHASE, handoffCommit: e.TIP }));
lines.push(e.PROSE);
process.stdout.write(JSON.stringify({ fromId: e.ID, fromUuid: e.UUID, toId: "coordinator", runId: 399, kind: "status", subject: "wave-done", body: lines.join("\n"), artifacts: [] }));
' | "$API" mail send --json -
```

Before running it:
- set `SUITE` and `FAILURE` from the ledger;
- if Step 1 recorded a `main-red`, a fix commit, or a slug beyond the listed ones, add it to `PROSE` as one more `printf` argument.

Expected: the client prints `{"ok":true,…}`. A `stale-uuid` means the uuid was cached: re-run the whole call, which re-derives it. Any other refusal is reported as it reads; never retry it unchanged.

Then stop pushing (clause 9). Do not end the turn to wait for CI: CI is the coordinator's re-measure. End the turn only on a wake you can name (clause 17).

**Commit:** none. Step 1 may produce a `fix(server): <the case it fixes>` commit for a red that `main` does not show, recorded in the ledger. Its body names the failing case and the measured cause. It carries no `D-` token; the worker appends its session's required attribution trailer, as on every commit of this plan.

---

## Review lenses

These lenses run IN ADDITION to the held-out panel (`ccd/coordinator-skill/references/review-panel.md`), which runs as written. Every finding gets the panel's refuters. A lens that dies or returns nothing counts as unverified, never as approval. Every scratch case uses fakes or fixture HOMEs only.

### 0. SAFETY and SECURITY: which id an id-taking argv binds (opus, xhigh, MANDATORY)

Read at the tip, against `origin/main`:
- `isRegistryId`, and `knownId` with every `server.ts` route that composes an id-taking builder;
- `readSessionRecord` and its 14 callers, and `readRegistryMeasured`'s `refused`;
- `POST /api/runs`, `reclaimRun`, the routing door and advance;
- `dispatchRun`, and `closeRun` with both of its arms and `closeReviewRun`;
- `expireArchived` and `learnExpiry`, and `collectTempRoot`'s step 1 with the population gate;
- `stopId`/`stopPair`, `stopPairRefused` with its two callers' identity arms, and `id-argv-census.test.ts`.

**Re-derive:**
- **Every route to an argv.** For each of the 41 calls, find its origin and the gate that stands before it. Construct each of these ids:
  - `--actor`, `--surface`, `--reason` and `-x`;
  - `.hidden`, and a 256-character id;
  - a name holding a newline or `#`;
  - a name equal to a surface word (`pwa`, `agent`).

  Use each as a request id, a stored `claimedBy`, a stored `sessionId`, a stored `ask.childId`, a registry basename and a `project`. Show that each is refused before `runCcd`, or that its call composes no id-taking argv.
- **The release valves.** Abandon, the programme end, the dead-coordinator sweep and the reclaim door each have a door for a bad stored id, and none of them composes a verb that names it.
- **stop.** The leading form is safe on every ccd that advertises stop-surface (Task 0's (e2)), and the bare form is safe on one that does not. A legacy row whose wrapper or project part fails `isRegistryId` (a `.project`, or a fallback `.wrapper`, reading `--surface=<word>`) is refused at `/stop` and at the archive door before any argv is composed, in every argv order.
- **The boundary of the claim.** A session can still run `ccd` directly, so the server gate is not an OS wall; W1b closes ccd's half. Say so wherever the PR body might read stronger.

### 1. Readers: refused, absent and unmeasured stay three answers (opus, high)

- Each `SingleRead` consumer's `bad-id` arm has its pin, or names its mask (R17), and every fold row was measured against an unlisted bad id.
- Every census tag matches the site's behaviour, the `tests-only` and `wrapper` tags included.
- Plant one refused row, then check dispatch (before, after and resume), the snapshot, mail, peers, projects, the fleet route and the log volume.
- Check `refusedLogged`'s pruning and quoting, and check that refused names never touch `warnState`.
- The stale fleet arm never claims freshness. The cold start sends no fleet frame rather than a guess, and still sends `runs`.

### 2. Derivation, wire and rings (opus, high)

- The predicate and its cap each have one definer. `isTmpRootId` is derived, nothing re-derives the rule, and the accepted set is unchanged for the collector.
- The wire is additive: `registry`, `refusedRows`, the stale arm. Absence permits, there is no `FLEET_PROTO` bump, and there is no L0 wire type.
- Every new union member reaches an exhaustive switch. The kebab scan stays green with `'bad-id'` only in `NOT_CODES`. No overloaded null.
- The R6 abandon answer carries `childReclaim`, and never claims `not-a-child`.
- The `knownId` census phrase, the `[registry-read-census:*]` sentences, and `shared/api.ts`'s citation cases.

### 3. Test integrity (sonnet, high)

- Each mutation row has a before and an after in the SDD ledger, and the tree is restored after each.
- No test reaches a live HOME. ccd runs only in a fixture HOME (Task 14). There is no `pkill`.
- New cases are in new files, and the `run-route-route.test.ts` rewrites keep their titles' intent.
- The real-binary stop file is not a known load flake, and it passes in isolation and in its shard.

---

## Deviations found

This wave's numbers come from the block the allocator issued for run 399 on 2026-10-12: twenty-four single numbers, 4860, 4861, 4862, 4863, 4864, 4865, 4866, 4867, 4868, 4869, 4870, 4871, 4872, 4873, 4874, 4875, 4876, 4877, 4878, 4879, 4880, 4881, 4882 and 4883, and one more issued at fix round 1 for that round's own substantive departure: 5004, and one more issued at fix round 2 for its substantive departure: 5044. The coordinator assigns them at the fix round, one per departure. Each is defined here, singly.

- The worker never calls the allocator (worker clause 11; coordinator clause 10).
- A departure from this plan is named by a short kebab-case slug in the wave-done mail. The worker never gives it a number.
- The worker writes no `D-` token for a number that `origin/main` does not define, and puts none in a commit message.
- The coordinator assigns each departure a number and defines it here, number and definition in one act. Each substantive departure gets its own number. Each task's plan-text corrections and extra pins share one.
- A new substantive departure that a later round finds is named by slug in that round's wave-done, and the coordinator allocates its number.
- A sentence of this plan's body that a fix round made false is not edited. The entry that names it corrects the plan's text, and the entry's sentence says what changed.

**Slugs this plan already names** (each gets its number at the fix round if the coordinator rules it a departure):
- from the rulings and tasks:
  - `registry-id-at-foot` (R1);
  - `masked-arms-pinned-by-their-masks` (R17);
  - `fleet-fallback-is-tests-only` and `cold-start-skips-an-unmeasured-fleet` (R19);
  - `bad-id-is-not-a-code` (R20);
  - `wave-lifecycle-rows-carried` (R24);
  - `over-long-request-ids-stop-at-the-router` (Task 2);
  - `resume-dispatch-refuses-not-holds` and `overlong-id-plants-no-row` (Task 3);
  - `generation-pin-follows-kind` (Task 4);
  - `abandon-sheet-misreads-an-omitted-fleet-act`, `reclaim-sheet-drops-the-bad-session-detail` and `work-run-project-reaches-ws-add-unchecked` (Task 16's carried lines);
  - `stop-pair-fields-refused-at-composition` (Task 14, a coordinator ruling at plan review);
- from Task 0's STOP rules: `tree-not-ready`, `contract-17-not-on-main`, `registry-id-owned-elsewhere`, `registry-unmeasured`, `registry-rows-fail-the-predicate`, `stored-rows-unmeasured`, `stored-rows-fail-the-predicate`, `gate-site-moved`, `claim-overlap` and `stop-surface-loop-postdates-token`.

### Substantive departures, one number each

- **D-4860** (Task 1) `registry-id-at-foot` — spec §2.3 placed `isRegistryId` right after `isSessionIdShape` and renamed `TMPROOT_ID_MAX_CHARS` to `REGISTRY_ID_MAX_CHARS`, and as built `REGISTRY_ID_MAX_CHARS` (255) and `isRegistryId` stand in the foot block of `shared/api.ts`, immediately above `TMPROOT_ID_MAX_CHARS`, which stays as a derived alias while `isTmpRootId` returns `isRegistryId(id)`, so no line that README or the compaction-card corpus cites moves (R1).
- **D-4861** (Task 2) `over-long-request-ids-stop-at-the-router` — the scope's control asked for a 255-character id released normally and a 404 for the 256-character refused id, and as built the router's default parameter-length cap answers 414 `FST_ERR_MAX_PARAM_LENGTH` for any request `:id` over 100 characters before a handler runs, with no call composed and no listing, so the HTTP cases pin the router's answer and their longest control is 100 characters.
- **D-4862** (Task 3) `resume-dispatch-refuses-not-holds` — spec §2.3 said resume dispatch "holds" when the requested id is refused, and as built `dispatchRun` re-checks a stored `sessionId` right after its hold verdict and before every other read, so the run stays `planned`, the route answers 409 `bad-session`, and the abandon door is the way out.
- **D-4863** (Task 4) `masked-arms-pinned-by-their-masks` — spec §2.3 asked for a pin each for every absence-acting caller, and as built an arm that an earlier gate already masks answers the safe word, its comment names its mask, and its pins are the mask's cases and `readSessionRecord`'s zero-listing case; by the coordinator's amendment of R17, `childGateAtClose` is exported and pinned directly with an unlisted bad id, so all four absence-acting callers that spec §2.3 names carry a pin each (R17).
- **D-4864** (Task 7) `fleet-fallback-is-tests-only` — spec §2.3 migrated the fleet fallback as a production reader, and as built `assembleFleet`'s own fallback is reached by tests alone: the three production callers that passed `records: undefined` (`GET /api/fleet`, the ws cold start and the claims-conflict path) each read `readRegistryMeasured` and pass its records, the fallback reads `readRegistryMeasured` and uses `[]` on an unlistable registry, and a census pins each of the six production `assembleFleet(` calls as passing its records (R19).
- **D-4865** (Task 7) `cold-start-skips-an-unmeasured-fleet` — R12 never serves an empty fleet that is not marked stale, and the ws `fleet` frame has no stale marker, so as built the ws cold start with no watcher broadcast sends no `fleet` frame on an unlistable registry and still sends its `runs` frame (the socket gets `hello`, then `runs`), and this wave adds no L0 wire field (R19).
- **D-4866** (Task 8) `tag-lines-carry-no-digit` — the plan's tag lines for Tasks 6, 7 and 8 carried the citation "(spec §2.3)", and its three raw-name tags the status "502", and as built no `[registry-refused:<word>]` tag line carries a digit (ruling C2): the rule is applied in Tasks 6, 7 and 8, whose tag lines drop the citation and the status number, the raw-name tags say "the ladder reads it as unmeasurable", the slug is named at Task 8, and Task 6's census case pins the rule.
- **D-4867** (Task 14) `stop-pair-fields-refused-at-composition` — the stop builders' reorder alone left the legacy pair's parts unchecked: `stopPair` takes its project from a legacy row's `.project`, and its wrapper from `.wrapper` when the id does not end in `-<project>`, fields no id gate reads, so a field spelled `--surface=<word>` made the pair a one-argument stop of the other token; as built, by a coordinator ruling at plan review, `/stop` and the archive door ask `stopPairRefused` in their identity arm, and a row whose wrapper part or project part fails `isRegistryId` answers 503 `registry-unmeasurable` with no argv composed, the archive door asking before its turn read and the programme's end.
- **D-4868** (Task 14) `stop-pair-refused-when-the-pair-is-not-the-id` — the plan's `stopPairRefused` checked the pair's two parts only, and as built from the final fix round it also refuses a legacy row whose `<wrapper>-<project>` pair is not its id (503 `registry-unmeasurable`, no argv), because the fallback wrapper's stop of such a row (a workspace row whose `.workspace` read failed, or a row whose absent or unreadable `.project` reads as the id) named a different session, such as the operator's main checkout; the id-argv census's `stop-pair-refused` pattern follows the new body.
- **D-4869** (Task 14) `stop-normal-case-seeds-a-well-formed-row` — the plan left `routes.test.ts`'s "stops normally (200) when the row is fully measured" case on `seedSession`, which writes `project: id`, and as built from the final fix round that one case seeds a well-formed legacy row by hand (id `demo-a-demo`, wrapper `demo-a`, project `demo`) and asserts its composed argv, because the old fixture's row composed a stop that named a different session, which the pair clause now refuses.
- **D-5004** (Task 4) `lone-surrogate-claimant-case-re-pointed` — workspace-lifecycle's lone-surrogate claimant case in `server/test/dead-coordinator-lane.test.ts` expected its lone-surrogate coordinator to read crashed and trip the breaker beside its partner, which this wave makes impossible because `measureClaimant` answers `unmeasurable` for any non-registry id, and as built from fix round 1 that one case, re-pointed under that programme's consent, proves that a dirty seed holds the claimant flagged with its exact spelling across a restart, that a sealed start reads it unmeasured while its partner ends as a lone crash, and that it never receives a crash anchor. As built from fix round 2 (F7), the case's dirty-seed block moves the clock 1 ms at its partner's first tmux read, so the seed instant stays T0 while the lone-surrogate claimant's measurement instant is T0 + 1; the two snapshots' `writtenAt` read T0 + 1, and the claimant's held member is asserted exactly (`firstDeadAt` T0, flagged, no crash instants), which reds once `bad-id` is folded into `absent` in `measureClaimant`.
- **D-5044** (Task 6) `tick-lanes-hold-a-refused-id` — the plan named the main watch's `records` hand-offs but none of the lanes that run on its tick, and four of them read a listed-but-refused id as absent (review 457's F1), so as built from fix round 2 `tick` hands this tick's `registryRead.refused` to each, and each places that id as unmeasured: (i) the stall lane's run verdict receives a refused worker as its own `StallWorker` arm, `{ present: 'refused' }`, never `{ present: false }`, which `stallVerdict` holds `unmeasured` at a new step (1b) and `stallSessionHolds` holds `unmeasured`, so its dead, orphan, failed and marker-unreadable arms hold while mail-stuck's `registry-unmeasurable` gate clause still reports its held delivery, and `judgeStall` composes no path or argv for it and takes no live, marker or hook-state read; (ii) the run-less coordinator judge does the same for a refused claimant, whose marker verdict holds; (iii) the claim lease lane's `claimProbe` answers `unmeasurable` for a refused holder before its `gone` test, so `renewClaims` renews the claim, `lapseClaims` holds its lease lapse, and the 8 h hard cap still fells it; (iv) the divergence census leaves a refused id out of rule 3's open-run side, so no `claim-divergence` is reported for it. From fix round 3 (review 463's F1) the stall lane drops a refused subject's clocks: on a sweep that refuses the id, `judgeStall` drops the worker's absent, dead and marker-unreadable clocks and `judgeStallCoordinator` the claimant's marker-unreadable clock, because a refused sweep observes nothing about the subject, so its clocks restart, as `stall-clocks-drop-on-an-unobserved-gap` restarts every clock after an unobserved gap; fix round 2 kept them, and the first sweep after a re-unlisting then reported the worker dead at once, counting the refused minutes as absence and skipping `DEAD_GRACE_MS`. Red first, each with its fix reverted: the six refused cases in `stall-verdict.test.ts`; the coordinator marker case in `stall-session.test.ts`; the lane cases under a fixture HOME in the new `tick-refused-lanes.test.ts`, (A), (A'), the two (C) cases and (D), and fix round 3's (E) and (E'), the second for a worker's and a claimant's marker clock, which red with the drop deleted (the dead notice "registry row absent for 1h 3m", or the marker push, at the first sweep after the re-unlisting); the `divergence.test.ts` case; and one `registry-refused-census.test.ts` case per hand-off, with `tick`'s census line naming the hand-off. (A2) and (A3), added by the review of fix round 2 as pins of behaviour already built, red with the lane hold reverted, or with a clock call moved past the drop, so no clock starts while the id is refused (a clock call moved out of the refused guard but above the drop is now an equivalent mutant). Red only under a named mutation: ten of the refused session cases (the shared holds, orphan E and failed, orphan D, and the two mail-stuck cases) red under the session verdicts' fold of the refused arm into absent; and "run-unnamed still comes first" reds when the refused hold moves above run-unnamed. Two measured re-points of the rulings' predictions: (1) the ruled R2 mutation on the ruled combined input, the absent and marker clocks both past their bounds, reds with the marker-unreadable push, not the dead notice, because the spec takes (2a) first, so an absent-only case was added, which reds R2 with the dead notice and stays green under R3; (2) eleven of the refused session cases passed on the unfixed code, because there the arm's missing lifecycle already held `unmeasured`, so their red is the named mutations above. For the same reason `stallSessionHolds`' refused line is runtime-equivalent to its deletion, which only tsc reds. Two survivors are equivalent at lane level, and recorded: deleting the dead clock's drop alone, since a refused id is in no `sessions` and that clock is never set for it; and the fold of the refused arm into `{ present: false }` in `stallWorkerFor`, since under the drop the clocks are null whenever the arm reaches L1 (green under it in `tick-refused-lanes`, the one suite that reaches that line, and in `stall-sweep`, `stall-verdict` and `stall-session`). The arm is kept as the distinct fact the rulings require, and the L1 pins hold its meaning. Placing the refused hold ahead of step (2a) departs from the evaluation order of the stall-watch spec (`2026-09-29-worker-stall-watch-design.md`, which takes (2a) first, then any unmeasured input), and `stallVerdictInner`'s docstring records it. Carried, with no number: `unlisted-non-registry-id-reads-absent-on-the-tick`, a non-registry id that no row lists still reads absent on the tick, as on main.

### Plan-text corrections and extra pins, one number per task

- **D-4870** (Task 0) plan-text corrections and extra pins — (c3) README's `shared/api.ts` citation measured at line 4962, not the plan's 4956, and was re-pointed by content; (d2) #351's measured diff figures differed from the plan's, because #351 had grown since planning (`watch.ts` 287 and `store.ts` 206 in its diff stat, against 142 and 72 at planning; `expireArchived.ts` 35, as planned).
- **D-4871** (Task 2) plan-text corrections and extra pins — T2.4's expected red, which also named the composed `[['ensure', '--actor']]`, measured as the status assertion alone (`expected 200 to be 400`), because that assertion comes first in the case; the census comment and the describe title "the two request-id routes outside knownId" read as exhaustive, though more routes never call `knownId` (the as-built's R7 correction counts seven); the plan's `knownId` rule also governs `POST /api/sessions`' revival probe, which its text did not name: a failing candidate id reads not-a-revival and takes the creating arm's pool check, and under `crossPool: true` it composes `startCross`/`enableCross`.
- **D-4872** (Task 3) plan-text corrections and extra pins — `overlong-id-plants-no-row`: the 256-character refused id cannot name a file, so the stored-row suite plants no registry row for it, and the gate still refuses it because no registry read stands before the gate; the brief's counts re-pointed: `grep -c storedRun` on the fixture printed 1, not 0 (its header comment's mention), `git diff --stat` showed four tracked files plus one untracked test file where the plan said five files, mutation 5 also reds the sweep re-measure case, and mutation 3's composed argv was inferred from the outcomes, because each case's first `toEqual` stops it; Task 3's fix round 1 added the planned-run and review-run abandon cases with a refused stored id (pinning `viaClosing: true` by mutation) and corrected the `close.ts` abandon-arm docstring to name its third commit copy.
- **D-4873** (Task 4) plan-text corrections and extra pins — `generation-pin-follows-kind`: `child-reclaim-generation.test.ts`'s close text pin spells `read.kind === 'found' ? childReclaimRowUuid(read.record) : null`, because `SingleRead` has no `found` boolean; `bad-id-is-not-a-code` (R20), ruled a pin rather than a departure from the spec: `'bad-id'` joins `mail-routes.test.ts`'s `NOT_CODES`; T4.7 to T4.9 (the `/kickoff`, `/stop` and `/swap` fold rows) were measured with the `--actor` row PLANTED, as Task 4's case prescribes, not unlisted as R15 says, and the arms diverge either way, because `readSessionRecord` answers `bad-id` before any listing. As built from fix round 2 (F6), `ClaimantVerdict`'s docstring lists the `bad-id` arm among its `unmeasurable` answers: a non-registry id answers `unmeasurable` before any listing.
- **D-4874** (Task 5) plan-text corrections and extra pins — `refused-test-warn-spy-typed`: the refused-row test's log helper types its two callback parameters, because the spy's `mock.calls` is untyped under the tests' tsconfig; Step 4 says its tag line has no quote character, but the line's exact text carries an apostrophe (`caller's`), kept byte for byte; the census header sentence was corrected in the final fix round, because four tags (`stale` twice, `reports` in `lifecycle.ts`, and the pre-spawn `refuses`) describe the unlistable-registry behaviour, not the refused-row behaviour.
- **D-4875** (Task 6) plan-text corrections and extra pins — `pre-spawn-listing-is-the-second`: dispatch's pause-marker listing is a fresh dispatch's first registry listing and the pre-spawn read its second, so the test that fails the pre-spawn read fails the second listing; `registry-unmeasurable-docstring-names-the-pre-spawn-refusal`: `DispatchOutcome`'s `registry-unmeasurable` docstring says its `stderr` is also absent on the pre-spawn read; `adopted-birth-comment-names-the-old-tolerance`: the adopted-arm comment in `dispatch.ts` still said the pre-spawn read tolerates an unlistable registry as empty, fixed in the final fix round; the census scan is memoised, so it reads `server/src` once per run; fix round 1's F8 resume-arm case proves that the dispatch resume arm resumes the valid row while a refused row is listed.
- **D-4876** (Task 7) plan-text corrections and extra pins — `fleet-health-fixtures-list-their-registry`: two live-arm cases in `fleet-health.test.ts` create an empty registry directory, because an unlistable registry now serves the stale arm; `claims-conflict-pinned-on-its-own-listing`: the claims-conflict case fails exactly the conflict arm's own registry read; `census-helpers-shared-not-copied`: the migrated readers' census cases reuse the census file's own scan and add `callArgs` and `isDefinition` once; the claims case's listing count is attribution + 2, not + 1, because `readLimits` also lists the registry inside `assembleFleet`; Step 1 (10)'s expected test list differed (`auth-passkey` missing, and three files that name the doors in comments only added); the two cold-start `vi.waitFor` calls take `{ timeout: 3000 }`, where the plan's text used the default (final fix round); fix round 1 corrected the stale arm's comment, which said "the link may be up", to name the disconnected remote box with no snapshot as well, and F8 added the listed-fleet and projects cases (with one refused row listed, the valid row is still listed, with no `stale` key, and `registry` reads `listed`).
- **D-4877** (Task 8) plan-text corrections and extra pins — `census-comments-left-stale`: three census comments and `expect` messages still said later tasks, or Task 8, would place sites, fixed in the final fix round; `EXPECTED_SITES` and the `wrapper` case sit in Task 5's first describe, not Task 7's as the brief worded it.
- **D-4878** (Task 9) plan-text corrections and extra pins — Step 4a (the import) was skipped, because Task 7 had already imported `isRegistryId` into `routes.ts`; T9.2's drafted `spent-unmeasured` body was not separately observed, because the failing status assertion stops each case first; from the final fix round, a case abandons a run whose stored `claimedBy` is not a registry id, `routes.ts`'s comment says "a new WORK row" where the plan said "a new row", and `childBind.ts`'s `bad-id` comment names its second mask, `POST /api/runs`' open gate.
- **D-4879** (Task 10) plan-text corrections and extra pins — ruling B1: Step 3(a)'s Before line no longer existed once Task 7 had added `isRegistryId` to the `routes.ts` import, so only `isSessionIdShape, ` was deleted and `isRegistryId` stays imported.
- **D-4880** (Task 14) plan-text corrections and extra pins — `lifecycle-rows-edited-by-pattern`: `lifecycle.test.ts`'s six stop rows were rewritten by a count-guarded pattern edit, each keeping its fixture ids; `stop-pair-project-redirect-pinned`: the real-binary file also proves that a project spelled `--surface` redirected the legacy pair to `<wrapper>-pwa` under the old order and is refused by usage under the new one; the final fix round's nested-describe cases (a legacy row whose id does not end in `-<project>`, at `/stop` and at the archive door); fix round 1's F2 (the `stopPair` and `stopPairRefused` docstrings name the pair rule), F3 (the project clause pinned by a `/stop` case for `demo-a--x` with `.project` `-x`, the wrapper clause recorded as an equivalent mutant, the four part cases and their describe retitled to name the clauses that refuse them, and mutation rows 6 and 7 corrected in the as-built), F4 (the comment naming both reachable fallback shapes) and F7 (the two identity-arm cases re-seeded with the well-formed `demo-a-demo`, so the pair clause no longer masks their arm); measured, deleting `/stop`'s `identity === null` check reds that case by a composed stop (200, `stop demo-a demo`, because an id ending in `-<project>` never reads `identity.wrapper`), while the archive door reds by a TypeError (500), where the ruling expected a TypeError at both; mutation I (the identity ignoring `unmeasured`) stayed green on the old seed and reds both cases after the re-seed (`/stop` 200 with the stop composed; the archive door 409 `status-unknown`, no stop). As built from fix round 2, F2: the real-binary file's header and `stopPairRefused`'s lead-in say the part checks stand as defence in depth (the project check alone refuses a project that is empty or leads with `-` or `.`, the `demo-a--x` case, and the wrapper check is an equivalent mutant); and F12: the "stops normally (200)" case calls `seedWellFormed`, the helper the three `/stop` cases now share, with its assertions unchanged.
- **D-4881** (Task 15) plan-text corrections and extra pins — `census-names-the-stop-pair-gate`: the brief's census text predated the stop-pair ruling and named `readSessionRecord` and `knownId` as the `stopPair` row's gates, so after Task 15's fix round `id-argv-census.test.ts` lists `stopPairRefused` among its gates and in the `stopPair` row and requires it above each of `stopArgvFor`'s three call sites; the same fix round's pins: `childSpent`, `childSpentLive` and the two `sweepNames` rows pinned through their callers or an entry, and a title that said two callers corrected to the three call sites. As built from fix round 2 (F4), the census's three comments on the `stopPair` row say that the wrapper `stopPair` carries is always a prefix of a vetted id, that the row's `.wrapper` fallback never reaches the builder, and that the project is the row's `.project`, which `stopPairRefused` vets; every pattern and pinned count is unchanged.
- **D-4882** (Task 16) plan-text corrections and extra pins — the nine as-built template sentences that disagreed with the code were corrected to it; Task 16 review's I1 (a new review row copies the reviewed run's stored `project`, so the `POST /api/runs` check covers new WORK rows only) and M1 to M5 were corrected with `f65651af8`'s other as-built corrections, and M6 (line length) was left as is; (m7)'s `grep -c` with the double-quoted pattern counts 2, not 1 (the `CloseOutcome.released` docstring and the code), so the single-quoted pattern was used; fix round 1's F5 (the `/kickoff`, `/stop` and `/swap` fold rows measured with the row planted) and F6 (the empty string among the ids `isSafeSessionId` refuses) as-built fixes.
- **D-4883** (Task 17) plan-text corrections and extra pins — `shards-27-32-7-overrun-at-48`: shards 7, 27 and 32 overran 600 s twice at /48 and completed, and the plan's shard rule has no clause past /48; the PR-body template was corrected for the final fix wave before the PR opened; fix round 1 merged `origin/main` (clause 16, main-passes-red, named by the coordinator), which departs from Task 17's "absorb nothing".

---

## As built (W1a, run 399)

This note records where wave 1 of the path-identity programme (the spec's W1a) differs, as built, from the spec
`docs/superpowers/specs/2026-10-12-path-identity-design.md`, and what it carries to later waves. The spec is not edited:
its corrections live here (R7, R3). The note amends; it edits no earlier text of this plan. It names each departure by
slug and carries no number. The coordinator assigns this wave's numbers at the fix round and defines them under
**Deviations found** above. The comments and test titles this wave added cite spec §2.3, and §2.4 for stop's order.

### What the gate does not claim

The server gate keeps a non-registry id out of every id-taking `CCD_ARGV` call the server composes, which is the id-argv
census's scope. It is not an OS wall: a session can still run `ccd` directly with any id, and ccd's own loops and
predicates are W1b's (spec §2.4). Until W1b merges, ccd's half of spec §2 stays open.

### Corrections to spec §2.3

- **`knownId` is not the one choke point (R7).** §2.3 calls `knownId` "one choke point for every request-id route".
  Of the 25 routes in `server.ts` that take a session `:id`, 18 call it and seven never do, measured route by route at
  the tip. Two of the seven compose an id-taking ccd argv and ask the predicate themselves:
  - `POST /api/sessions/:id/ensure` asks `isRegistryId(id)` first, before any call is composed;
  - `POST /api/sessions/:id/swap`'s `crossPool: true` arm asks it as the arm's first statement, ahead of the skew gate
    (R22).

  Each answers 400 `bad-session-id`. Of the other five, `/stop` and `/swap`'s ordinary arm compose an id-taking argv
  behind `readSessionRecord`'s `bad-id` (400 `bad-session-id`), and `/kickoff` gates through the same read and composes
  no ccd argv. `GET /api/sessions/:id/pane/history`, `/ws/session/:id` and `/ws/pty/:id` compose no ccd argv: the
  session stream's `readSessionRecord` answers `bad-id` as absent, and the history and pty routes reach only tmux,
  through `tmuxTarget`'s exact-match target. `knownId` refuses a failing id before its listing, and its census stays
  at 18 routes (14 POST, 4 GET).
- **The watches omit a refused id, and nothing is retained (R3).**
  - §2.3 says the main, hook-state and task-state watches "retain prior state for refused ids". It also says the
    watch sweeps keep the wrapper because omission suppresses observation "while retaining prior state".
  - Refusal is a pure function of the id string, so a refused id never had state to retain, and code that retained
    it would be unobservable.
  - As built, omission is the behaviour: a refused id gets no state, no reads and no acts, and the reader census tags
    those sites `omits`.
  - The snapshot shrink guard counts a refused id as purged, so a refused row cannot freeze snapshot writes.
- **The predicate sits at the foot of `shared/api.ts` (R1, `registry-id-at-foot`).**
  - §2.3 places `isRegistryId` "right after `isSessionIdShape` (about `:6231`)". README and the compaction-card
    corpus cite `shared/api.ts` by line, and an insertion there would move every cited anchor below it.
  - `REGISTRY_ID_MAX_CHARS` (255) and `isRegistryId` stand in the foot block, immediately above
    `TMPROOT_ID_MAX_CHARS`.
  - §2.3's "`TMPROOT_ID_MAX_CHARS` becomes a `REGISTRY_ID_MAX_CHARS`" is built as a derived alias,
    `TMPROOT_ID_MAX_CHARS = REGISTRY_ID_MAX_CHARS`, and `isTmpRootId` returns `isRegistryId(id)`.
  - The accepted set is unchanged. The full rename is carried (below).
- **Masked arms are pinned by their masks (R17, `masked-arms-pinned-by-their-masks`).**
  - §2.3 asks for "a pin each" for every absence-acting caller. The request-route gates and the stored-row gates
    landed before the reader widening, so some reader arms were masked from the moment they existed.
  - Each masked arm answers the safe word and its comment names its mask. Its pins are the outer gate's cases and
    `readSessionRecord`'s zero-listing case (the table below).
  - One exception, by the coordinator's amendment of R17: `close.ts`'s `childGateAtClose` is exported for its pin and
    pinned directly with an unlisted bad id. So all four absence-acting callers that §2.3 names, `measureClaimant`,
    `childGateAtClose`, `reclaimChild` and `childBindGate`, carry a pin each.
- **Resume dispatch refuses; it does not hold (`resume-dispatch-refuses-not-holds`).**
  - §2.3 says resume dispatch "holds when the requested id is refused".
  - As built, `dispatchRun` re-checks a stored `sessionId` right after its hold verdict, before the pause listing and
    every other read. A run with no stored id is not asked, so the only arm that meets a stored id is the resume
    dispatch: the run stays `planned`, and the route answers 409 `bad-session`. The abandon door is the way out.
- **The readers that pass `records: undefined` measure the registry themselves (R19).**
  - §2.3 migrates four `readRegistry` callers to `RegistryRead`: project enumeration, the fleet fallback, peer
    enumeration and dispatch's pre-spawn read. All four migrated.
  - Beyond them, the three production callers that passed `records: undefined` to `assembleFleet` each call
    `readRegistryMeasured` and pass its records: `GET /api/fleet`, the ws cold start and the claims-conflict path.
  - `readRegistry` keeps eight call sites, each classified below. One of them, `detectDialogs`'s fallback, is reached
    by tests alone.

### The readers as built

- `readSessionRecord` answers `{ kind: 'bad-id' }` for an id that fails `isRegistryId`, before any listing.
  - `SingleRead` has four kinds, and each of its 14 callers is an exhaustive switch ending in a `never` check.
  - A fold of `bad-id` into `absent` was measured against an UNLISTED bad id at each site where the two arms diverge
    (R15), except the `/kickoff`, `/stop` and `/swap` fold rows (T4.7 to T4.9). Those were measured with the `--actor`
    row PLANTED, as Task 4's case prescribes. The arms diverge either way, because `readSessionRecord` answers `bad-id`
    before any listing.
- `bad-id` is a read result, not a code (R20, `bad-id-is-not-a-code`). It joins `mail-routes.test.ts`'s `NOT_CODES`,
  and no refusal or wire field carries it.
- `readRegistryMeasured` names its refused rows (R2):
  - `refused` holds ids (the basename less `.uuid`), and `names` keeps every raw name.
  - A refused row is never read, never built into `records` and never composed.
  - `pruneWarnState` receives the valid ids only.
  - Each refused id is logged once while it stays listed, quoted by `JSON.stringify`, through a module-private set
    pruned on each listing. That set is never `warnState`'s keys.
- Dispatch's pre-spawn read migrated in the same commit as the post-spawn clause (R18), because the clause needs the
  pre-spawn `refused` set. On an unlistable registry, the pre-spawn read refuses `registry-unmeasurable` before
  anything is spawned. The post-spawn clause refuses a refused name that was absent before the spawn.
- The fallbacks that only tests reach:
  - `assembleFleet`'s own fallback reads `readRegistryMeasured` and uses `[]` on an unlistable registry. A census
    pins each of the six production `assembleFleet(` calls as passing its records, never `undefined` (R19,
    `fleet-fallback-is-tests-only`).
  - `sweepHookStates`'s own read and `detectDialogs`'s fallback: `tick` passes its `records` to both, and a census
    describe pins that hand-off.
- On an unlistable registry, the ws cold start with no watcher broadcast sends no `fleet` frame and still sends its
  `runs` frame, so the socket gets `hello` and then `runs` (R19, `cold-start-skips-an-unmeasured-fleet`). The `fleet`
  frame has no stale marker, and this wave adds no L0 wire field. With a watcher broadcast, the cold start reads no
  registry.
- The census (`registry-refused-census.test.ts`) classifies 23 sites, with no site `unplaced`. They are eight
  `readRegistry` calls and fifteen `readRegistryMeasured` calls, `readRegistry`'s own wrapper call among them:

| Reader | Word | Sites |
|---|---|---|
| `readRegistry` | `knownId` | `sessionCommands` (`commands.ts`), `prTasks` (`server.ts`) |
| `readRegistry` | `omits` | `sweepNames`, `sweepPr` (`watch.ts`) |
| `readRegistry` | `tests-only` | `detectDialogs`'s fallback (`watch.ts`; `tick` passes `records`) |
| `readRegistry` | `raw-name` | `requireAttribution`, `POST /api/mail`, `POST /api/mail/:id/ack` (`coord/routes.ts`) |
| `readRegistryMeasured` | `wrapper` | `readRegistry` (`registry.ts`) |
| `readRegistryMeasured` | `holds` | `resolveDoneBranch` (`coord/fingerprint.ts`), `sweepMail` (`watch.ts`) |
| `readRegistryMeasured` | `refuses` | dispatch's pre-spawn and post-spawn reads (`coord/dispatch.ts`) |
| `readRegistryMeasured` | `gated` | dispatch's resume arm (`coord/dispatch.ts`) |
| `readRegistryMeasured` | `omits` | `tick`, `sweepTasks` (`watch.ts`) |
| `readRegistryMeasured` | `tests-only` | `sweepHookStates`'s own read (`watch.ts`; `tick` passes `records`), `assembleFleet`'s fallback (`fleet.ts`) |
| `readRegistryMeasured` | `stale` | `GET /api/fleet`, the ws cold start (`server.ts`) |
| `readRegistryMeasured` | `reports` | `listProjects` (`lifecycle.ts`), `GET /api/peers`, the claims-conflict path (`coord/routes.ts`) |

- Fingerprint keeps its own check (R26). `resolveDoneBranch` refuses a run whose `sessionId` fails the predicate with
  `tip-unmeasurable`, before its read. `verifyReviewDone` reads the WORK run's `sessionId`, which a review run's close
  gate does not check, so the check is reachable through a review close and is pinned there as well as directly.

### The masked arms and their masks

These arms answer the safe word, and their comments name the mask. Unless the last column names a pin of the arm's
own (R17 as amended, and the exported functions' unit pins), their pins are the mask's cases and
`readSessionRecord`'s zero-listing case (R17).

| Arm | Its answer for `bad-id` | Its mask | Pinned by |
|---|---|---|---|
| `/archive`'s `readSessionRecord` switch (`server.ts`) | 400 `bad-session-id` | `knownId` | `knownId`'s cases; the zero-listing case |
| `liveStatus` (`fleet.ts`), behind `/interrupt` | `'dead'` | `knownId` | `knownId`'s cases; the zero-listing case |
| `readAsk` on `/ask` (`server.ts`) | `null` | `knownId` | `knownId`'s cases; the zero-listing case |
| `readAsk` under `POST /api/asks/:id/answer` | never reached | `freshAskAt`'s `bad-id`, giving `UNMEASURED_ASK_AT` and then 409 `child-unmeasurable` before `answerAsk` reaches `readAsk` | the ask case, end to end: no keys sent, the ask stays `held` |
| dispatch's resume `childBindGate` | `spent-unmeasured` | the dispatch gate | the dispatch gate's cases; `childBindGate`'s own unit pin |
| `POST /api/runs`'s `childBindGate` | `spent-unmeasured` | the open gate | the open gate's cases; `childBindGate`'s own unit pin |
| `childGateAtClose` (`coord/close.ts`) | mark `unreadable` | both close gates | its own direct pin (R17 as amended), with an unlisted bad id |
| `measureClaimant` (`coord/reclaim.ts`) | `unmeasurable`, never `dead` | none on the dead-coordinator lane | its unit pin, and the lane case (no abandon, no ccd verb) |

Three arms that no outer gate masks answer exactly what absence answers, by design: `sessionws`'s `resolve`,
`freshAskAt`, and `releaseRetiredChildHold` (`changed`, R13). A fold changes nothing observable there, so their pin is
the zero-listing case. `freshAskAt`'s path is also pinned end to end by the ask case. `reclaimChild`'s own arm is not
masked either: it defers `marker-unreadable`, never `gone`, and its pin is `reclaimChild`'s unit case.

### The answers this wave adds

Every word already existed (R13). This wave adds no route, table, migration, ccd verb, capability token, agent grant,
L0 wire type or refusal word.

| Where | Condition | Answer |
|---|---|---|
| `knownId`'s 18 routes | id fails `isRegistryId` | 404 `{ ok: false, error: 'unknown-session' }`, before `knownId`'s own listing. `/archive` lists the registry before it asks `knownId`, so on an unlistable registry it answers 503 `registry-unmeasurable` first; and the 11 routes that ask `isSafeSessionId` first answer 400 for an id it refuses (the empty string, `.`, `..`, or one holding `/`, `\` or NUL): `bad-session-id`, or `bad-request` at the clip route |
| `POST /api/sessions/:id/ensure` | id fails | 400 `{ ok: false, error: 'bad-session-id' }` |
| `POST /api/sessions/:id/swap`, `crossPool: true` | id fails | 400 `bad-session-id`, ahead of the skew gate (R22) |
| `/stop`, `/swap` (ordinary arm), `/kickoff` | `readSessionRecord` answers `bad-id` | 400 `bad-session-id` |
| `/archive` | masked by `knownId` (R17) | the arm answers 400 `bad-session-id` |
| `/stop`, `/archive`, a legacy row | its wrapper part or `.project` fails `isRegistryId`, or its id does not end in `-<project>` (`stopPairRefused`) | 503 `{ ok: false, error: 'registry-unmeasurable' }` from the identity arm, with no argv composed; at `/archive`, before the turn read and the programme's end |
| `POST /api/asks/:id/answer` | stored `ask.childId` fails | 409 `{ ok: false, error: 'child-unmeasurable', detail }` (the existing answer, through `freshAskAt`'s `bad-id`, R17); no keys sent, the ask stays `held` |
| `POST /api/runs` | `claimedBy` or `sessionId` fails | 400 `{ ok: false, error: 'bad-session', detail: 'claimedBy is not a registry id' }`, or the same naming `sessionId` |
| `POST /api/runs` | a work `project` (as given) beginning `-` or `.` | 400 `{ ok: false, error: 'bad-request', detail: 'project must not begin with - or .' }` |
| `POST /api/runs/:id/reclaim` | the heir fails | 400 `{ ok: false, error: 'bad-session', detail }` (`which: 'heir'`) |
| `POST /api/runs/:id/reclaim` | the stored claimant fails | 409 `{ ok: false, error: 'bad-session', detail }` (`which: 'claimant'`), the detail naming `POST /api/runs/:id/abandon` |
| `POST /api/runs/:id/dispatch` (resume too) | stored `sessionId` fails | 409 `{ ok: false, error: 'bad-session' }` |
| `POST /api/runs/:id/close` (review runs too) | stored `sessionId` fails | 409 `{ ok: false, error: 'bad-session' }` |
| abandon, programme end, dead-coordinator sweep | stored `sessionId` fails | closed `failed`, `released: false`, `childReclaim: 'not-queued'`, `childReclaimWhy: 'marker-unreadable'`, no fleet act, one event (R6, R27) |
| `POST /api/runs/:id/advance` to `awaiting-review` or `merging` | stored `sessionId` fails | 409 `{ ok: false, reject: { code: 'bad-session' } }` |
| `POST /api/runs/:id/route` | stored `sid` fails | 409 `{ ok: false, error: 'bad-session' }` (the existing word, now from `isRegistryId`) |
| `GET /api/peers?of=` | trimmed `of` fails | 400 `{ ok: false, error: 'bad-session' }`, before any read (R23) |
| `GET /api/peers` (200) | refused rows exist | additive `refusedRows: number`, only when greater than 0 |
| `GET /api/projects` | always | additive `registry: 'listed' \| 'unlistable'` |
| `GET /api/fleet` | registry unlistable | `{ sessions, stale: true }`, where `sessions` is the watcher's last broadcast, else the last-known-good snapshot's sessions, else `[]`; no `pools` key and no `downSince` |
| the ws cold start (no watcher broadcast) | registry unlistable | no `fleet` frame; the `runs` frame is still sent (R19) |
| the mail sweep | recipient refused | held with gate `registry-unmeasurable`, never `rejectDelivery` |

Notes on the table:
- **What `POST /api/runs` checks (R29, R8).** It checks `claimedBy`, `sessionId` and a work run's `project` as given,
  untrimmed, which is how it stores them. A padded id that it once accepted now answers 400. The project check is a
  coordinator extension that closes the server's half of spec §2.2's ws-add row.
- **The reclaim door (R21).** It keeps its trim, because it stores the trimmed heir. Its stored-claimant check sits
  right after `no-claimant`, before any read.
- **The abandon arm (R6, R27).** It takes no fleet act for such a run: no sibling read, no child gate, no hold and no
  release. When the dead-coordinator sweep closes the run, the sweep's own gate still runs first (the operator's
  abandon carries none). The arm then closes the run through the store, and writes its one
  `fleet-act-omitted:bad-session` event only after that close succeeds. `abandonRefusal` refuses nothing new for such
  a run, so the archive door's programme end ends such a programme whole.
- **Advance (R11).** The gate stands before `verifyDone` only, so a legacy row can still retreat to `working`.
- **Expiry (R9, R28).** `expireArchived` refuses a non-registry id as its step 0, before the capability read, with
  the existing `composition` outcome. `learnExpiry` refuses it before its own capability read, with `unreadable`.
  Both use one detail sentence saying the server refused the id, so neither `wsExpireAudit` nor `wsExpire` is ever
  built for it.
- **The collector (R10).** It has no source change. Mutation pins prove two things: the population gate keeps a bad
  id from the learning audit, and the executor's step-1 `isTmpRootId` keeps it from both builders.
- **Readers on an unlistable registry (R12).** The `GET /api/fleet` (`stale: true`), `GET /api/projects` (`registry`)
  and `GET /api/peers` (`refusedRows`) rows above are R12's answers, with dispatch's pre-spawn refusal of
  `registry-unmeasurable` (under the readers, above).
- **Stop's order (spec §2.4).** `stopId` and `stopPair` send `['stop', '--surface', surface, id]` and
  `['stop', '--surface', surface, w, p]`. On the real binary, an id spelled `--surface` is now refused by usage, and a
  planted row named `pwa` is not stopped; a project spelled `--surface` is refused the same way. With no surface, the
  bare form is unchanged.
- **Stop's pair parts (`stop-pair-fields-refused-at-composition`, a coordinator ruling at plan review).** `stopPair`
  takes its project from a legacy row's `.project`, and its wrapper from the row's `.wrapper` when the id does not end
  in `-<project>`: fields no id gate reads. `cmd_stop`'s `--surface=*` arm strips a token of that spelling from any
  position, so a field reading `--surface=<word>` made the pair a one-argument stop of the other token, in the
  leading, trailing and bare forms alike. No ccd rule closes that without also refusing the pre-W1a trailing order
  while the fleet box runs ahead of the server, so the server closes it. `/stop` and the archive door ask
  `stopPairRefused` in their identity arm: a row whose wrapper part or project part fails `isRegistryId` answers 503
  `registry-unmeasurable` with no argv composed, and the archive door asks before its turn read and the programme's
  end. A row whose id does not end in `-<project>` answers the same, because ccd would recompute its pair into a
  different session (`stop-pair-refused-when-the-pair-is-not-the-id`). At planning, none of the fleet box's 18
  distinct registry projects began with `-` or `.`; the whole-charset measurement once carried below is withdrawn.
- **Task 14's mutation rows 6 and 7, as measured at fix round 1.** The plan's body is not edited; this corrects it.
  Since the pair clause, deleting either part check alone leaves the four Task 14 part cases green (each still answers
  503), because the pair clause refuses every fallback-arm row on its own. The project check is pinned instead by a
  `/stop` case whose id ends in `-<project>` with a dash-leading project (`demo-a--x`, `.project` `-x`): deleting the
  check reds that case, which then answers 200 and composes `['stop', '--surface', 'pwa', 'demo-a', '-x']`, and the
  id-argv census's "every gate stands where the census says", through its `stop-pair-refused` text pattern (2 of the
  21 cases in `ccd-stop-argv-order.test.ts` and `id-argv-census.test.ts`, measured at fix round 2). The wrapper check
  is an equivalent mutant, kept as the part check's other half: on the fallback arm the pair clause refuses alone, and
  on the prefix arm the wrapper is a prefix of an id already vetted. Deleting it reds nothing in
  `ccd-stop-argv-order.test.ts`, and reds only the id-argv census's "every gate stands where the census says", through
  its `stop-pair-refused` text pattern (1 of the 21). Deleting the pair clause reds the two cases whose id does not end
  in `-<project>`, and the id-argv census's "every gate stands where the census says", through its `stop-pair-refused`
  text pattern (3 of the 21).
- **The id-argv census.** `id-argv-census.test.ts` classifies all 41 id-taking calls across 10 files by file, builder,
  origin and gate (SEC2 B, as R98 widens it). A new call, or a new `CCD_ARGV` key, must classify itself, or the suite
  goes red. The `stopPair` row's gate is `stopPairRefused`, required above each of `stopArgvFor`'s three call sites
  (one at `/stop`, two at `/archive`); `childSpent` and `childSpentLive` are pinned through their callers, and the two
  `sweepNames` rows through an entry listing. The 41 and the 10 hold while #351 and run 400's PR stay unmerged: the
  second lander re-measures.

### Carried lines, and README

- **README stop prose: carried.** #351 had not merged when Task 0 ran (R14), so README's two `stop` prose lines still
  spell the trailing order: the exec-whitelist bullet's `ccd stop <id> --surface <word>`, and the old-ccd hazard line.
  The edit is one line-neutral change to each line, carried to the first wave that lands after #351.
- **The coordinator skill's `bad-session` rows (R24, `wave-lifecycle-rows-carried`).**
  - `references/wave-lifecycle.md`'s rows for `bad-session` live under `ccd/`, outside this wave's boundary: open,
    dispatch, close, advance and reclaim, with "stop and report a stored defect; no fleet act ran". They are carried
    to W1b, which edits `ccd/`.
  - One more row for the same file: a review close whose WORK run's stored `sessionId` is not a registry id answers
    409 `tip-unmeasurable` on every retry, because `verifyReviewDone` reads that id and the review's own close gate
    does not check it. The coordinator closes that review `failed`, which skips the re-measurement.
- **The abandon sheet (`abandon-sheet-misreads-an-omitted-fleet-act`).**
  - `pwa/src/fleet/AbandonSheet.tsx` speaks for `released: false` whenever the run had a session id.
  - After R6, it tells the operator `<workspace> is still claimed by another open run` for an abandon that performed
    no fleet act.
  - `pwa/` is outside this boundary, so this is carried.
- **The reclaim sheet drops the abandon pointer (`reclaim-sheet-drops-the-bad-session-detail`).**
  - `pwa/src/fleet/ResumeSheet.tsx`'s `reclaimErrorText` reads a 409's code only through `isReclaimRefuseCode`, and
    `bad-session` is not a `ReclaimRefuseCode`.
  - So the reclaim door's 409 for a stored claimant that is not a registry id (R5) reaches the operator as "the
    hand-over was refused, for a reason this build does not recognise". Its `detail`, which names
    `POST /api/runs/:id/abandon`, is not shown.
  - `pwa/` is outside this boundary, so this is carried. Measured: 0 such stored rows at Task 0.
- **A stored work-run `project` reaches `ws-add` unchecked (`work-run-project-reaches-ws-add-unchecked`).**
  - At dispatch, a stored `project` reaches `CCD_ARGV.wsAddWorker(run.project, …)` with no server re-check.
  - The `POST /api/runs` check covers every new WORK row (`kind !== 'review'`), as the note on the table says. A new
    review row copies the reviewed run's stored `project`, which the check does not read, and a review run always
    spawns fresh, so that copied value reaches `ws-add` through dispatch exactly as a legacy work row's does.
  - Measured: 0 such stored rows at Task 0.
  - W1b's ws-add loop and `_ws_project_valid` close it.
- **A legacy stop row's pair fields (`legacy-pair-fields-charset-unmeasured`): withdrawn.** A row whose id ends in
  `-<project>` has a wrapper part that is a prefix of its vetted id and a project part that is a suffix of it, so its
  parts pass whenever its id passes, unless the project is empty or begins with `-` or `.` (none of the 18 projects
  measured at planning did); any other row is now refused by `stopPairRefused`'s pair-is-the-id clause, so no fleet
  read is needed.
- **The mail ingress ladders' detail for a refused row (`raw-name-refused-detail-says-transient`).** The three
  raw-name ladders (`requireAttribution`, `POST /api/mail`, `POST /api/mail/:id/ack`) answer a refused row 502
  `registry-unmeasurable`, the right word, but with a detail saying "listed but unreadable — transient", which is never
  true of a refused id. This wave edited their tag lines only. `sweepMail`'s back-off detail for a refused recipient,
  `registry row listed but unreadable (registry-unmeasurable)`, stays: it is literally true, because the row is listed
  and never read, and it says nothing transient.
- **The expiry lane's words for the executor's own refusal (`expiry-composition-words-misread-a-server-refusal`).** R9 answers a non-registry id with `composition`, whose detail says no call was composed, but `expireFeedBody`'s `composition` arm still says "ccd rejected the call this server composed" and `archivedExpiry.ts`'s lane report says "the server composed a call ccd rejected". The lane's population omits refused rows (Task 5), so production does not reach it. `archivedExpiry.ts` is outside this boundary, and Task 12 keeps its hunk in `coord/expireArchived.ts`, where `expireFeedBody`'s `composition` arm lives, to the guards while #351 shares that file, so this is carried.
- **The collector's learning audit relies on the population gate alone (`collector-learning-audit-relies-on-the-population-gate`).**
  The collector's learning audit (`learnCollect`) relies only on the lane's population gate, while expiry also
  re-checks at its executor (`learnExpiry`). R10 and the never-edit boundary keep the collector files unchanged in this
  wave, so the two executor seams are made to agree in the next wave that edits them.
- **The executor's docstring lists no step 0 (`expiry-docstring-lists-no-step-0`).** The numbered docstring at the top of `expireArchived.ts` lists steps 1 to 7 and not the new step 0. Task 12 kept its edit to the guards, because #351 shares the file, so the sentence is carried.
- **The advance reject docstring omits `bad-session` (`advance-reject-docstring-omits-bad-session`).** `shared/api.ts`'s docstring above `RunRefuseCode` says every typed refusal code of `POST /api/runs/:id/advance` is a `MailRejectCode` or a `RunRefuseCode`. The advance gate's `reject.code` of `bad-session` is in neither, and the kebab scan admits it through the routing door's union. The docstring sits above the foot block, so this wave could not edit it.
- **The real-binary parity rows.** Spec §2.8's `ccdargv-dec-parity` rows on the real binary, with the ids `--actor`,
  `--surface`, `--reason`, `--expect` and `--defer-expired`, go green only with W1b's loops, so they ride W1b.
- **Prose that still calls `POST /api/runs` unguarded (`session-shape-prose-predates-the-id-gate`).** After Tasks 9 and 10, these comments still say that `POST /api/runs` checks `claimedBy`/`sessionId` only for a non-empty string, or that the routing door asks `isSessionIdShape`:
  - `shared/api.ts`'s docstring above `SESSION_ID_SEGMENT`, which sits above the foot block;
  - `coord/store.ts`'s docstring above the `reclaim:` run-event reader, a file this wave never edits;
  - the comments in `run-signals-routing.test.ts` (above its `isSessionIdShape` describe), `run-route-route.test.ts` (above the `'bad claimant'` case) and `child-reclaim-paused-at-server.test.ts` (above its `from` round-trip cases).

  Legacy rows can still hold such ids, so each comment's conclusion stands; only its description of the route is stale. Carried to the first wave that edits each file.
- **The dead-coordinator docstring predates the `claimedBy` gate (`dead-coordinator-docstring-predates-the-claimedby-gate`).**
  `server/src/deadCoordinator.ts`'s docstring says `claimedBy` is not shape-checked at `POST /api/runs`, which this
  wave's gate makes false. The file is workspace-lifecycle's, so this wave leaves it, and the coordinator reports it to
  that programme.
- **An unlisted non-registry id on the tick (`unlisted-non-registry-id-reads-absent-on-the-tick`).** Fix round 2's
  lanes hold a listed-but-refused id, but a non-registry id that no row lists still reads absent on the main watch's
  tick, as on main, and the stall lane's marker and hook-state reads still compose `$REG/<id>.*` for it.
- **The stale fleet arm's remote case (`fleet-stale-arm-remote-case-unpinned`).** No test pins the remote,
  disconnected, no-snapshot, unlistable case of `GET /api/fleet`'s stale arm.
- **The stale fleet arm's `downSince` (`fleet-stale-arm-down-since`).** Whether `GET /api/fleet`'s stale arm should
  carry a measured `downSince`, which it now drops even when the link recorded one, is review 432's open question.
- **The full rename of `TMPROOT_ID_MAX_CHARS`.** It touches `coord/store.ts`, so it waits until after #351. Until
  then, the alias stands.
- **SEC2 C and D.** A `RegistryId` brand on every builder, or an assertion inside each id-taking builder, stays in the
  spec's "Later".

### Departures recorded while building

These are the departures the SDD ledger recorded for Tasks 0 to 15, the final fix round, fix rounds 1 to 3 and both landing rounds that the
sections above do not already name, one measured sentence each.

- `over-long-request-ids-stop-at-the-router`: the router's default parameter-length cap answers 414 `FST_ERR_MAX_PARAM_LENGTH` for a request `:id` over 100 characters before any handler, so a 255- or 256-character request id never reaches `knownId`; the cases pin the router's answer, and their longest control is 100 characters.
- `overlong-id-plants-no-row`: a 256-character id cannot name a file, so the stored-row suite plants no registry row for it, and the gate still refuses it because no registry read stands before the gate.
- `generation-pin-follows-kind`: `child-reclaim-generation.test.ts`'s one text pin of the close now spells `read.kind === 'found' ? childReclaimRowUuid(read.record) : null`, because `SingleRead` has no `found` boolean.
- `refused-test-warn-spy-typed`: the refused-row test's log helper types its two callback parameters, because the spy's `mock.calls` is untyped under the tests' tsconfig.
- `pre-spawn-listing-is-the-second`: dispatch's pause-marker listing is the first registry listing of a fresh dispatch and the pre-spawn read is the second, so the test that fails the pre-spawn read fails the second listing.
- `registry-unmeasurable-docstring-names-the-pre-spawn-refusal`: `DispatchOutcome`'s `registry-unmeasurable` docstring now says its `stderr` is also absent on the pre-spawn read, where no ccd call has been made.
- `fleet-health-fixtures-list-their-registry`: two live-arm cases in `fleet-health.test.ts` create an empty registry directory, because an unlistable registry now serves the stale arm instead of the live one.
- `claims-conflict-pinned-on-its-own-listing`: the claims-conflict case calibrates the listings an uncontested claim spends, then fails exactly the conflict arm's own registry read, the next one, because `assembleFleet`'s limits read also lists the registry directory inside that arm.
- `census-helpers-shared-not-copied`: the census cases for the migrated readers reuse the census file's own scan (`sourceTexts`, `allSites` and `codeOnly`) and add two helpers once at module scope, `callArgs` and `isDefinition`, instead of a second copy of the scanner.
- `tag-lines-carry-no-digit`: no `[registry-refused:<word>]` tag line carries a digit, so the spec citation and the status number that tag lines once held are dropped from them, and a census case pins the rule.
- `stop-pair-project-redirect-pinned`: the real-binary file also proves that a project spelled `--surface` redirected the legacy pair form to `<wrapper>-pwa` under the old order, and is refused by usage under the new one.
- `lifecycle-rows-edited-by-pattern`: `lifecycle.test.ts`'s six stop rows were rewritten by a count-guarded pattern edit rather than retyped from the plan, so each row keeps its fixture ids and changes only the position of the surface pair.
- `census-names-the-stop-pair-gate`: after the census's fix round, `id-argv-census.test.ts` lists `stopPairRefused` among its gates and in the `stopPair` row, requires it above each of `stopArgvFor`'s three call sites, and pins `childSpent`, `childSpentLive` and the two `sweepNames` rows through their callers or an entry.
- `stop-pair-refused-when-the-pair-is-not-the-id`: after the final review, `stopPairRefused` also refuses a legacy row whose `<wrapper>-<project>` pair is not its id, because the fallback wrapper's stop of such a row (a workspace row whose `.workspace` read failed, or a malformed legacy row) named a different session; the id-argv census's `stop-pair-refused` pattern follows the new body.
- `stop-normal-case-seeds-a-well-formed-row`: `routes.test.ts`'s "stops normally (200)" case now seeds a well-formed legacy row by hand and asserts its composed argv, because its old fixture's `project: id` row composed a stop that named a different session, which the new clause refuses.
- `lone-surrogate-claimant-case-re-pointed`: fix round 1 re-pointed workspace-lifecycle's lone-surrogate claimant case in `server/test/dead-coordinator-lane.test.ts` (one case, under that programme's consent), because after this wave `measureClaimant` answers `unmeasurable` for any non-registry id, so the case's crashed lone-surrogate coordinator cannot happen; the case now proves that the dirty seed holds it flagged with its exact spelling across a restart, that a sealed start reads it unmeasured while its partner ends as a lone crash, and that it never receives a crash anchor.
- The merges of main: fix round 1 merged `origin/main` at `b953aefa4` into the wave's tip `f65651af8` with `git merge` (clause 16, main-passes-red, named by the coordinator); the probe `git merge-tree --write-tree` was clean (exit 0, tree `0f6f7efb5`), and the merge commit's tree equals it. Fix round 3 merged `origin/main` at `cb72ca064` as `eac01c765` (clause 16, a conflict: the probe exited 1), and the landing round merged it at `0b3ff2f62`, once #384 had landed, as `f42c74874`, which brought #418, #411, #419, #426, #427, #428, #431 and #384. Both later merges conflicted in `server/test/single-definition.test.ts` alone, where main's appended describe blocks met this branch's: every block is kept whole, this branch's first, each closing before the next opens, and no line of any block changed. After the landing merge, `collect-id-pins.test.ts`'s two executor cases pass the rig's `r.job(id)` instead of a bare `{ id }` (`4cafb17cf`): #384's collector job carries its epoch, so the bare object no longer type-checks under the tests' tsconfig, though both cases passed at run time either way. Landing round 2 merged `origin/main` at `5fa7efddc` as `ccfeefb44` (clause 16, a conflict: the probe exited 1, and the coordinator named the landing round), which brought #440, #438, #439, #443, #446, #447, #449, #450, #451, #452, #483, #484, #487, #488, #485, #489 and #429. It conflicted in `server/src/coord/dispatch.ts` alone, on the import block: #489 added the `SessionRecord` and `TurnVerdict` type imports beside the `readRegistry` import this branch had dropped, so the merge keeps #489's two type imports and this branch's list without `readRegistry`, and the merged file differs from main by exactly this branch's change. After that merge, three of this wave's tests take #489's interface (`865a22708`): the reader census expects `liveRowFor`'s `[rec]` call in `turnverdict.ts`, where #489 moved it, and the dispatch deps in `registry-refused-callers.test.ts` and `stored-row-id-gates.test.ts` answer the now-required `turnVerdict` port with `'idle'`; run alone, those three files passed 16, 11 and 24 tests, and the tests' own type-check ran with no error.
- `tick-lanes-hold-a-refused-id`: fix round 2 hands the main watch's tick's `refused` set to the four lanes that read a listed-but-refused id as absent (the stall lane's run verdict, its run-less coordinator judge, the claim lease lane and the divergence census's open-run side), and each holds that id as unmeasured or leaves it out; it is defined under Deviations found.

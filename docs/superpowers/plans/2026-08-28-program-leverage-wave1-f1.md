# program-leverage wave 1 — F1: drift fixes + the coordinator-resume runbook — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan
> task-by-task (the brief names it). Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Correct the measured drifts in the coordination corpus and ship
`ccd/coordinator-skill/references/resume.md`, the coordinator-resume runbook, with the corpus-wide guards
that make the constraints on it mechanisms rather than comments.

**Architecture:** Everything here is prose or test-corpus change; no runtime code path moves. The one
structural change is that two of the guards *about* that prose read a HAND-MAINTAINED list of reference
files, so the new reference would be invisible to every whole-corpus assertion unless the corpus is derived
from the directory itself.

**Tech Stack:** Markdown (skill corpus), TypeScript + vitest (`server/`), bash
(`ccd/install-coordinator-skill.sh`), TSX comments (`pwa/`). No new dependencies, no new ccd verbs, no
`FLEET_PROTO` bump, no wire change, no route added or exempted.

**Spec:** `docs/superpowers/specs/2026-08-28-program-leverage-design.md` §3 (design items 1–4), read from
`origin/ws/brisk-meadow` (`git fetch origin ws/brisk-meadow`). Program context: §1, §2, §12.
Ledger: `docs/superpowers/programs/program-leverage.md` on the same ref.

**Run:** 10 · **Program:** `program-leverage` wave 1/8 · **Coordinator:** `ccrc-pwa-brisk-meadow`
· **Worker workspace:** `quiet-meadow`, branch `ws/quiet-meadow`.

---

## Global Constraints

- **Commit on `ws/quiet-meadow`, this workspace's own branch — never a separate feature branch.** The
  done-fingerprint re-measures this branch's tip; work parked elsewhere wedges the close `stale-tip` forever.
- **TDD red-first, mutation-table discipline.** Every new pin is MEASURED red against the deletion or
  mutation of the thing it guards, before the fix lands.
- **Destructive-verb census.** `coordinator-skill.test.ts`'s census counts `ws-reap`, `ws-rm` and `ws-gc`
  across SKILL.md + all references and requires each exactly as many times as contract clause 3 names it
  (once). **`resume.md` must not name any of the three** (`ws-gc` matches as a substring, so `ws-gc --prune`
  counts too).
- **`resume.md` must not name any of the three ungated operator doors** — `/api/coord/pause`,
  `/api/runs/:id/abandon`, `/api/claims/:id/break`. `allSkillText` already carries a negative pin on the third.
- **No `METHOD /api/path` spelling for a route that is not in `EXEMPT`.**
  `server/test/auth-passkey.test.ts:2284-2321` walks every `.md` under `ccd/coordinator-skill` and
  `ccd/worker-skill`, harvests `/(GET|POST|PUT|PATCH|DELETE)\s+`?(\/api\/…)/g`, and asserts every hit is a
  member of `EXEMPT` — "these are mandated by a skill and REFUSED by the armed gate". This is what forbids
  the spec's own literal for the revive route (D-1001).
- **No `curl` invocation inside a fenced block** in either corpus (`server/test/ccrc-api-closed.test.ts:53-72`,
  D-739). Prose may say the word; a block a reader would run may not call it.
- **Role vocabulary only, in every byte this wave writes** — including this plan.
  `server/test/topology-clean.test.ts` scans `git ls-files` AND every blob `origin/main..HEAD` introduces
  (D-208), and bans the operator's username, the two real box names, the volume id, the GitHub handle and the
  old employer org. **No absolute `/home/<user>/…` paths anywhere; `cd "$(git rev-parse --show-toplevel)"`.**
- **Deviation refs are ledgered and bounded.** `server/test/deviation-refs.test.ts` requires the highest
  `D-<n>` token ANYWHERE in the tracked tree to equal the highest `D-<n>` DEFINED by a heading or bullet in a
  plan (`^(?:#{2,4} |- \*\*)D-(\d+)\b`). So: define every number you cite, and **never write the top of an
  unconsumed range with a `D-` prefix** — spell a block `D-999..1046`, the `build4.md:379` idiom.
- **The trigger-sentence fix must KEEP the operator-designation arm and must NOT assert the coordinator is a
  main checkout.** This program's own coordinator is workspace-resident.
- **The frontmatter description must keep containing `never use it to do a wave`**, keep
  `name: ccrc-coordinator`, and stay on ONE physical line.
- **Apostrophes: STRAIGHT (`'`) in every new byte.** Measured: all four existing references carry ZERO curly
  apostrophes; `SKILL.md` carries exactly 5, all inside pinned contract clauses 4, 5 and 10 — do not touch
  those five (D-104).
- **Do not touch the ten pinned contract clauses** in `ccd/coordinator-skill/SKILL.md`, the eleven in
  `ccd/worker-skill/SKILL.md`, or `ccd/coordinator-skill/references/ledger-template.md` (byte-pinned to
  `docs/superpowers/programs/TEMPLATE.md`).
- **Do not touch `pwa/src/fleet/StartProgramSheet.tsx:68`** — the kickoff string is pinned by
  `pwa/test/start-program.test.tsx:116` and `:313`.
- **Do NOT deploy anything this wave.** AGENT-FIRST ordering is the coordinator's job at wave close.
- **Deviations: this program's block is `D-999..1046`.** Every number cited is defined below.
- **Suites run in the FOREGROUND, `timeout ≥ 600000`, cd'd into the package.** Single suite:
  `./node_modules/.bin/vitest run test/<file>` from inside `server/`. **Never bare `npx vitest`.**

---

## File Structure

| File | Change | Responsibility after the change |
|---|---|---|
| `CLAUDE.md` | Modify `:141-145` | States the ungated-door count as THREE, names all three, and stops saying the test pins "the pair" |
| `ccd/coordinator-skill/references/resume.md` | **Create** | The runbook: measure the run record, the session-id invariant, the two id-preserving revives, the wave-N re-kickoff text, the terminal recovery |
| `ccd/install-coordinator-skill.sh` | Modify `:53-62` | `REQUIRED_REFS` names all five references; the comment above it stops claiming a count it no longer has |
| `server/test/coordinator-skill.test.ts` | Modify corpus consts + one stale message; add one describe | Every whole-corpus guard reads the references directory, not a typed list |
| `ccd/coordinator-skill/SKILL.md` | Modify `:3`, `:8-13`, `:14-25` | Trigger and resume constraint name the RUN RECORD and the SESSION ID, and point at the runbook |
| `pwa/src/fleet/StartProgramSheet.tsx` | Modify comments only | Every `file:line` anchor in the file resolves to what its prose says |

**Ordering rationale.** `resume.md` lands (Task 2) before the corpus is widened to police it (Task 3), because
Task 3's headline red is only measurable once the file exists. `SKILL.md` is reworded (Task 4) after
`resume.md` exists, because the reworded paragraph points at it.

---

## Verified facts this plan is built on

Read at `05be5a67` on 2026-08-28, in this worktree. Do not re-derive them; DO re-check any that a step's
expected output contradicts, and believe the tree over this table.

| Fact | Evidence |
|---|---|
| The ungated set is three | `server/src/coord/routes.ts:1132-1139` ("the WHOLE unauthenticated write surface of this file"); `server/test/coord-pause-route.test.ts:172` `UNGATED = {'/api/coord/pause','/api/runs/:id/abandon','/api/claims/:id/break'}` |
| All three stay behind the SESSION gate when `CCRC_AUTH` is armed | `server/src/auth/gate.ts:156-166`, the NOT-EXEMPT note: gating them there "strengthens D-282 rather than reversing it" |
| `POST /api/sessions/:id/ensure` is NOT in `EXEMPT` | `server/src/auth/gate.ts:167-262` — the map has no such key |
| Every `METHOD /api/path` in either skill corpus must be in `EXEMPT` | `server/test/auth-passkey.test.ts:2284-2321`, `expect(blocked, 'these are mandated by a skill and REFUSED by the armed gate — the D-149 shape').toEqual([])` |
| `GET /api/runs`, `GET /api/runs/:id/items`, `GET /api/mail`, `POST /api/runs` are all in `EXEMPT` | `server/src/auth/gate.ts:179-196` |
| `ccd ws-hold` hard-refuses a main checkout | `ccd/ccd:4938-4939` |
| A PWA-started coordinator is a main checkout | `pwa/src/fleet/StartProgramSheet.tsx:89-90` `s.project === project && s.workspace === null` |
| `cmd_start`'s one-argument form is the id-preserving one | `ccd/ccd:12117-12129`; refusals `:12146`, `:12149`, `:12150-12151`; registry-wins warning `:12165-12166`; alive → no-op `:12203`; dead → `:12210` `mode=resume` |
| `Restart session` calls `ensure` | `pwa/src/lib/api.ts:361` → `server/src/server.ts:1532-1534` → `ccd/ccd:12275` `cmd_ensure`; live branch `_resupervise_live` (`ccd/ccd:12061`) |
| PWA copy for the three dead/unclaimed states | `pwa/src/fleet/SessionActionsSheet.tsx:293`, `:318`, `:331`, `:358` |
| The second-claimant refusal, and that it is permanent | `server/src/coord/store.ts:363-371`; `claimedBy` is written by two INSERTs (`:399-401` `openRun`, `:1918-1925` `reconstruct`, bound `null`) and NO update |
| Only `POST /api/runs` consults it; `resolveCoordinator` keeps returning the dead id | `server/src/coord/store.ts:1165-1173` |
| `openRun`'s idempotent retry is narrow | `server/src/coord/store.ts:383-388` — same program+wave+`claimedBy` AND `state = 'planned'` |
| A program with no active run does not resolve the runId-less coordinator | `server/src/coord/store.ts:1169-1171` `if (active.length !== 1) return null;` |
| The only machine kickoff hardcodes wave 1 | `pwa/src/fleet/StartProgramSheet.tsx:65-68`, sent at `:373`; pinned by `pwa/test/start-program.test.tsx:116`, `:313` |
| `GET /api/runs` is the standing re-orientation | `ccd/coordinator-skill/references/wave-lifecycle.md:35-37`; route `server/src/coord/routes.ts:1223`, cookie-OR-token `:1238-1239`; `RunSummary.claimedBy` `store.ts:933` |
| Restore before reconstruct | `server/src/coord/db.ts:145-149` — `~/ccrc-backups/<ts>/coord.db`, `VACUUM INTO`, "Only if no snapshot exists, reconstruct" |
| `reconstruct` is a TEST, not an operator tool | `server/src/coord/store.ts:1836-1838`; `grep -rn "\.reconstruct(" server/src` → 0 hits; drill `server/test/reconstruction-drill.test.ts`, plus `server/test/coord-store.test.ts:485` |
| Reconstruct clears the claim wedge | inserts `claimedBy` NULL (`store.ts:1925`) and `openRun`'s guard skips NULL rows (`store.ts:355-364`); pinned `coord-store.test.ts:559-579` |
| `_id()` `ccd/ccd:1091`; `cmd_start` `:12117`; `_ws_least_loaded` `:3530`; `cmd_swap` `:12958` with `_reg_set … wrapper` `:13125`; `.uuid` write `:12206-12208`; `cmd_ensure` `:12275` | measured with `grep -n` / `sed -n` |
| `runCcdOr502` `server/src/server.ts:1510-1513`; `POST /api/sessions` `:1517-1530`; `POST /api/runs` `server/src/coord/routes.ts:872` | measured |
| `registry.ts` id listing `server/src/registry.ts:793`; `watch.ts` 2 s tick `server/src/watch.ts:533` | measured |
| `REQUIRED_REFS` is pinned against the real directory | `ccd/install-coordinator-skill.sh:62`; `server/test/wrapper-roster-fixture.test.ts:398-411` |
| The corpus consts are hand-maintained | `server/test/coordinator-skill.test.ts:33` (`allSkillText`), `:50` (`routeSkillText`), `:747-754` (the address `corpus`) |
| `single-definition.test.ts` cannot see a new `.md` under `ccd/` | its `ROOTS` are `shared`, `server/src`, `pwa/src`, `agent/src`, `.tsx?` only (`:32-56`); its ledger-path rule skips comment lines and allowlists `StartProgramSheet.tsx:55` |
| Highest `D-` in `origin/main` is `D-945` | `git grep -ho "D-[0-9]\{3,4\}" origin/main` (the `1234` hit is inside the `D-123456` garbage fixture at `server/test/ledger.test.ts:89`) |
| No corpus file names any of the three doors today | per-file `grep -c` over `ccd/coordinator-skill/**` and `ccd/worker-skill/SKILL.md`: 0 everywhere |

---

## Task 1: Root `CLAUDE.md` — the door count is THREE

**Files:** Modify `CLAUDE.md:141-145`.

**Interfaces:** Consumes nothing; produces nothing. Independent of Tasks 2–5.

**Why no test.** Spec §3's "Tests" paragraph rules it: "CLAUDE.md is prose and gets none." Mutation-table
discipline binds new GUARDS; this is a corrected sentence. See `## Notes for the coordinator`, item 1.

- [ ] **Step 1: Read the current bullet**

Run: `sed -n '141,145p' CLAUDE.md`

Expected — and if it differs, STOP and re-measure the whole task:

```
- **Box token gates every coordination WRITE** (`/api/mail*`, `/api/runs*`) — header `x-ccrc-mail-token`, `401`
  on missing — **except TWO deliberately ungated operator doors: `POST /api/coord/pause` and `POST
  /api/runs/:id/abandon`** (D-282 (was D-B4-9): the coordinator holds the box token, so gating a wedged run's release valve
  behind that key leaves the wedge no door). `coord-pause-route.test.ts`'s `UNGATED` set pins the pair in both
  directions, and with `CCRC_AUTH` armed both still sit behind the session gate. Don't assume — read the guards.
```

- [ ] **Step 2: Replace it**

There are TWO errors in this sentence, not one: the count, and "pins **the pair**" — the set has three
members. Keep `D-282 (was D-B4-9)` intact and on one line: a rewrap that separates the legacy alias from the
`was ` immediately before it reds `server/test/deviation-refs.test.ts:200-204`
(`const BARE = /(?<!was )\bD-B\d+-\d+\b/g`) — and note that writing the alias in prose ANYWHERE without that
exact prefix reds it too, which is why this paragraph does not spell it a second time.

```
- **Box token gates every coordination WRITE** (`/api/mail*`, `/api/runs*`) — header `x-ccrc-mail-token`, `401`
  on missing — **except THREE deliberately ungated operator doors: `POST /api/coord/pause`, `POST
  /api/runs/:id/abandon` and `POST /api/claims/:id/break`** (D-282 (was D-B4-9), extended to the third by build 9
  D12: the sessions that would be locked out — the coordinator, and any session holding a claim — are the ones
  holding the box token, so gating a wedge's release valve behind that key leaves the wedge no door).
  `coord-pause-route.test.ts`'s `UNGATED` set pins all three in both directions, and with `CCRC_AUTH` armed all
  three still sit behind the session gate (`auth/gate.ts`'s NOT-EXEMPT note: gating them there "strengthens
  D-282 rather than reversing it"). Don't assume — read the guards.
```

- [ ] **Step 3: Verify the claim you just wrote, in both directions**

```bash
grep -n "UNGATED = new Set" server/test/coord-pause-route.test.ts
sed -n '156,166p' server/src/auth/gate.ts
```
Expected: the `UNGATED` literal names exactly the three paths you wrote; the gate note names the same three
under "NOT EXEMPT". If either disagrees, the source moved — fix the sentence to the source.

- [ ] **Step 4: Commit**

```bash
git add CLAUDE.md
git commit -m "docs(claude-md): the ungated operator doors are three, not two"
```
(Full message body in the repo's usual shape — say what drifted, cite `routes.ts:1132-1139` and
`coord-pause-route.test.ts:172`, and name the wave and run.)

---

## Task 2: `references/resume.md` — the coordinator-resume runbook

**Files:**
- Create: `ccd/coordinator-skill/references/resume.md`
- Modify: `ccd/install-coordinator-skill.sh:53-62`
- Test (existing, goes red first then green): `server/test/wrapper-roster-fixture.test.ts:398-411`

**Interfaces:**
- Consumes: nothing.
- Produces: the runbook. Task 3's pins quote it BYTE FOR BYTE. If you reword any of these, reword the pin:
  - `` `GET /api/runs` is the whole orientation. ``
  - `ccd start <id>`
  - `Both of these are the OPERATOR's act`
  - ``nothing in the HTTP API ever rewrites `claimedBy` ``
  - `open the run for wave <N>`
  - `do not open wave 1 again`
  - `A dead WORKER is not this door`
  - `CoordStore.reconstruct`
  - `/api/sessions/:id/ensure` — **without a preceding HTTP method, deliberately** (D-1001)

- [ ] **Step 1: Create `ccd/coordinator-skill/references/resume.md`**

Write exactly this. Straight apostrophes only. Indented code blocks, not fences (the peer-protocol idiom).
No `curl`, no `CCRC_SERVER_URL`, no token pipeline, no numeric host literal, no `ws-reap`/`ws-rm`/`ws-gc`,
none of the three ungated doors, and no `METHOD /api/…` spelling for the revive route.

````markdown
# Resuming a coordinator

A coordinator is disposable by design and a program is meant to survive its death — but only if the
revive preserves the one thing the server compares: the SESSION ID. This is the runbook for that, and
for the case where the id is already lost.

Two readers: the OPERATOR performing the revive, and the fresh coordinator that wakes up in the revived
pane. Nothing here is a fleet act this session performs on itself — clause 1 stands. The revive happens
at a terminal or from the PWA, by a human.

Every call named below is made exactly as SKILL.md's "How to call the API" sets it up. This file carries
no second copy of that setup, of the address, or of the token.

## 1. Measure first: is the program still open, and who claims it?

    body=$("$API" runs list)

`GET /api/runs` is the whole orientation. Find this program's rows and read three fields off the newest
open one:

- `claimedBy` — the session id the server will accept calls from. THIS is the identity a revive has to
  preserve. It is not a workspace name, not an account, and not something a fresh session can be told.
- `wave` — which wave the program is on. Never infer that from a hold reason: the reason is display-only,
  it lands on the WORKER's workspace, and a coordinator may carry none at all.
- `state` — `planned` means the wave was opened and never dispatched; `working` means a worker is out
  there holding a brief.

The default scope of that route excludes closed runs, so a program with no row here is retired. Mail
addressed to the `coordinator` role with no `runId` then resolves to nothing — the runId-less form needs
exactly one active program. Mail that names the `runId` explicitly still resolves, and that is the
documented recovery (`references/wave-lifecycle.md` §3), not a reason to open a fresh run.

## 2. The invariant: same session id, or the program is wedged

`POST /api/runs` refuses any later call for a program whose `claimedBy` differs from whichever session
first opened it — `claimed-by-another`, contract clause 8, decided in `CoordStore.openRun`. The refusal
is PERMANENT: it does not lapse when the named session dies, and nothing in the HTTP API ever rewrites
`claimedBy`. A fresh coordinator under a new id can never take the program over through the API at all.

Everything else keeps working, which is what makes this easy to misread. Mail still routes to the dead
id, the board still renders the program, and only this one call refuses. The wedge shows up at the wave
boundary, when the next run has to be opened.

A session id is minted once, at creation, from the account and the project — and it does not change
afterwards. A session keeps the id it was born with across every account swap, so `claimedBy` may name
an account that session no longer runs on. Re-creating the session from what the board renders TODAY
therefore mints a DIFFERENT id for a session that already exists. That is the trap this runbook exists
to avoid.

## 3. The two id-preserving revives

Both of these are the OPERATOR's act, at a terminal or in the PWA.

**At a terminal on the fleet host — the ONE-ARGUMENT form:**

    ccd start <id>

One argument means "the session that already exists, under the id it already has". The two-argument
`<wrapper> <project>` form is the CREATING form: it recomputes the id from that pair, which is exactly
how an operator who reads the current account off the board mints a second id for a live session. The
one-argument form cannot do that — it refuses an id with no registry row, naming the creating form in
the message rather than resolving to a guess, and where the argument disagrees with the registry about
the ACCOUNT the registry wins with a warning that names the verb which would actually move it. On a
session that is already alive it is a no-op that says so; on a dead one it respawns and resumes the
transcript.

**From the PWA — the session's `Restart session` control.** It calls ccd's own `ensure` on this id
(`/api/sessions/:id/ensure`; `cmd_ensure` in ccd), so the id is in the PATH and this form cannot mint a
new one either. It is written here without an HTTP method on purpose: a method spelled in front of a
path in this corpus means "a call you make", and this is not one — it is the browser's own
cookie-bearing call, it is not on the armed gate's exempt list, and a fleet-host session cannot post it
cookieless. On a pane that has died it builds a new pane and the conversation is resumed from the
transcript; on a pane that is running but unclaimed it writes the registry claim and adopts the pane,
restarting nothing and losing nothing. If the last spawn stopped on a login screen or a limit banner,
this hits the same banner again — the account lane has to be fixed, or the session moved, first.

## 4. Briefing the revived coordinator

The machine kickoff the PWA writes when a program is STARTED hardcodes wave 1 — correct exactly once,
and wrong for every revive after it. A revive is briefed by hand, and this is the text:

    You are the coordinator for program `<slug>` (<title>).
    Its ledger is `docs/superpowers/programs/<slug>.md`.
    Run the ccrc-coordinator skill. Its run is ALREADY OPEN: read `GET /api/runs`,
    find run <run id> at wave <N>, and pick that wave up where the ledger says it
    stands. Do not open the run for wave <N> again, and do not open wave 1 again.

Those last two sentences are the load-bearing half. An open run does not need re-opening, and re-opening
is not a harmless no-op: the open route dedupes ONLY a retry naming the same program, wave and
`claimedBy` against a row that is still `planned`. Re-opening a `working` wave, or opening wave 1 on a
program that is at wave 5, writes a SECOND row — a second ledger the board renders, and an open-run
count the program never gets back down to zero.

First acts of the revived session, in order: read the ledger commit; `GET /api/runs`;
`GET /api/runs/:id/items` for the wave's declared ledger, the only route that publishes item ids; then
read outstanding mail before deciding anything. A worker that finished while the coordinator was dead
has its `wave-done` waiting there, and acting off the ledger alone re-dispatches finished work.

## 5. A dead WORKER is not this door

A worker that dies mid-wave is recovered by re-dispatching fresh into the held workspace — SKILL.md's
"When something is wrong" says so, and the dispatch route is the one writer of the `/clear` step
(clause 9). Reaching for a revive door on a worker instead skips the state transition the board renders
and leaves a wave nobody advanced. This runbook is about the COORDINATOR's own death.

## 6. When the id is already lost — the terminal recovery

If the program was re-opened under a different id, or the original id can no longer be revived, no
sequence of API calls fixes it: every `POST /api/runs` for that program answers `claimed-by-another`,
naming a session that may no longer exist. Stop and report it to the operator. This is a recovery on the
box, not a retry, and a coordinator that keeps retrying is spending turns on a refusal that is working
exactly as designed.

Two things make that recovery ordinary rather than frightening. The database is snapshotted before every
deploy — the newest `~/ccrc-backups/<ts>/coord.db` is the restore path, and it is the FIRST thing to
check. And the database was never the ground truth in the first place: the committed ledger, the session
registry and `.prhistory` are. `CoordStore.reconstruct` is the drill that rebuilds a program's runs from
exactly those three — a TEST rather than an operator tool
(`server/test/reconstruction-drill.test.ts`), which is why it is a constraint on what may be stored
rather than a button. Its rebuilt rows carry no claimant at all, and the one-coordinator guard skips
rows with none, so a reconstructed program is claimable again by whichever session opens its next wave.
````

- [ ] **Step 2: Measure the RED the new file causes**

```bash
cd server && timeout 600 ./node_modules/.bin/vitest run test/wrapper-roster-fixture.test.ts
```
Expected: **FAIL** — `install-coordinator-skill.sh REQUIRED_REFS agrees with the real references/ directory
(I8) > names exactly the .md files that live under ccd/coordinator-skill/references/ today`, with `resume.md`
in `actual` and absent from `declared`. The guard is doing its job: a reference the installer does not
require is one an interrupted `rsync -az --delete` can silently drop.

- [ ] **Step 3: Add `resume.md` to `REQUIRED_REFS`, and correct the comment above it**

`ccd/install-coordinator-skill.sh:62` becomes:

```bash
REQUIRED_REFS=(ledger-template.md mail-envelope.md peer-protocol.md resume.md wave-lifecycle.md)
```

The comment at `:53-61` says SKILL.md "points a live coordinator at the first three of these by name". That
was already imprecise and a fifth file makes it wrong; replace the two sentences that count files with:

```bash
# SKILL.md is not enough on its own (fix, review finding 14): the guard used
# to check only that file, and the convergence check three lines below
# (`diff -r -q "$SRC" "$dest"`) treats a partial SRC as "differs" from a
# previously-good install — so a source that lost its references/ mid-rsync
# (`deploy/deploy.sh`'s `rsync -az --delete`, interrupted; SKILL.md sorts
# before `references/`) does not fail closed, it REPLACES a good install with
# the fragment, exit 0, no stderr. Every file below is named by something a
# live session reads: SKILL.md points at wave-lifecycle.md, mail-envelope.md,
# ledger-template.md and resume.md; the WORKER skill points across at
# peer-protocol.md (Build 9 wave 8, D-214 — it ships here because a skill's
# references install as one unit and the worker ships none of its own). Every
# one of them missing is exactly the half-installed shape the comment above
# already says is worse than none. The list is pinned against the real
# directory by wrapper-roster-fixture.test.ts (I8) — it is a projection, and
# nothing but that test keeps it honest.
```

- [ ] **Step 4: Verify GREEN**

```bash
cd server && timeout 600 ./node_modules/.bin/vitest run test/wrapper-roster-fixture.test.ts test/install-coordinator-skill.test.ts
```
Expected: PASS both.

- [ ] **Step 5: Verify the hard constraints on the new file BY MEASUREMENT**

```bash
cd "$(git rev-parse --show-toplevel)"
R=ccd/coordinator-skill/references/resume.md
for t in ws-reap ws-rm ws-gc '/api/coord/pause' '/api/runs/:id/abandon' '/api/claims/:id/break' curl CCRC_SERVER_URL; do
  printf '%-28s %s\n' "$t" "$(grep -c -- "$t" "$R")"
done
printf '%-28s %s\n' 'curly-apostrophes' "$(grep -o $'’' "$R" | wc -l)"
printf '%-28s %s\n' 'METHOD-spelled routes' "$(grep -oE '(GET|POST|PUT|PATCH|DELETE) `?/api/[A-Za-z0-9/:_<>-]+' "$R" | sort -u | tr '\n' ' ')"
grep -nE '(https?|wss?)://[0-9]{1,3}\.' "$R" || echo 'no numeric host literal'
```
Expected: **0** for every named token and for the curly count; the METHOD-spelled route list is exactly
`GET /api/runs`, `GET /api/runs/:id/items`, `POST /api/runs` (all three in `EXEMPT`); and
`no numeric host literal`.

- [ ] **Step 6: Run the two corpus-wide guards that already cover the new file without any wiring**

```bash
cd server && timeout 600 ./node_modules/.bin/vitest run test/auth-passkey.test.ts test/ccrc-api-closed.test.ts test/topology-clean.test.ts
```
Expected: PASS all three. `auth-passkey`'s `THE SWEEP` is the one that would red on a method-spelled
`/api/sessions/:id/ensure`; prove it by temporarily writing `POST /api/sessions/:id/ensure` into the file,
re-running that one test (expect FAIL naming it), and reverting. **Record the outcome** — this mutation IS
D-1001's evidence.

- [ ] **Step 7: Commit**

```bash
git add ccd/coordinator-skill/references/resume.md ccd/install-coordinator-skill.sh
git commit   # message: what the runbook is, the four things it carries, D-1001's spelling constraint,
             # and the measured red in wrapper-roster-fixture (I8)
```

---

## Task 3: Fold `resume.md` into the corpus the guards actually read

**Files:** Modify `server/test/coordinator-skill.test.ts` — the corpus consts (`:29-50`), one stale failure
message (`:217-218`), the address corpus (`:747-754`), plus one new describe at the foot.

**Interfaces:**
- Consumes: `ccd/coordinator-skill/references/resume.md` from Task 2, byte for byte.
- Produces: `REFERENCE_NAMES` (`readonly string[]`) and `ROUTE_CORPUS_EXCLUDES` (`ReadonlySet<string>`), both
  module-scope in this test file. Nothing outside it consumes them.

**Why this task exists.** Spec §3 states the census as a HARD constraint on `resume.md`: it "counts the three
destructive verbs across SKILL.md + ALL references". It does not — `allSkillText` is a hand-typed three-file
list, so the constraint would have bound nothing (**D-1000**). Two more whole-corpus guards read the same
list, and a third copy sits in the address scan (**D-1003**).

**What this task does NOT need.** An earlier draft added an `OUT_OF_DOMAIN` table and a whole-server route
registry so the runbook could name `POST /api/sessions/:id/ensure`. `auth-passkey.test.ts` forbids that
spelling outright (D-1001), so the runbook names no out-of-domain route and the existing forward scan passes
unchanged. Do not add the table.

- [ ] **Step 1: Write the failing coverage pin**

Append a new `describe` at the END of `server/test/coordinator-skill.test.ts`:

```ts
// ── program-leverage wave 1 (F1): the coordinator-resume runbook ───────────
//
// The runbook ships into a corpus whose whole-file assertions — the
// destructive-verb census, the break-door prohibition, the untyped-refusal
// census — read `allSkillText`. That const was a HAND-TYPED list of three
// reference files, so this file would have been invisible to every one of
// them: spec S3 names the census as the binding constraint on this very file,
// and it would have bound nothing (D-1000). The corpus is derived from the
// directory now; this describe is what reds if anyone types the list back.
describe('the coordinator-resume runbook (program-leverage wave 1, spec S3 item 3)', () => {
  const rb = (): string => refs('resume.md');

  it('is INSIDE the corpus every whole-file assertion in this suite reads', () => {
    // Not a tautology: with a hand-maintained `allSkillText` this is exactly
    // the assertion that fails, and it fails for the right reason.
    expect(allSkillText, 'references/resume.md is not in allSkillText — the census, the break-door ' +
      'prohibition and the untyped-refusal scan all skip it')
      .toContain('`GET /api/runs` is the whole orientation.');
  });

  it('names the two id-preserving revives, and says whose act they are', () => {
    // The one-argument form is the whole point: the two-argument form mints a
    // second id for a live session (ccd:12118-12123, and
    // SessionActionsSheet.tsx:287-289 names the same operator).
    expect(rb()).toContain('ccd start <id>');
    expect(rb()).toContain('/api/sessions/:id/ensure');
    // Clause 1 survives the runbook: a revive is not a fleet act this session
    // performs. Without this sentence the file reads as a coordinator's todo.
    expect(flat(rb())).toContain("Both of these are the OPERATOR's act");
  });

  it('spells the revive route WITHOUT a method, and says why', () => {
    // `auth-passkey.test.ts`'s THE SWEEP requires every `METHOD /api/path` in
    // either skill corpus to be in EXEMPT, and this route deliberately is not
    // (gate.ts) — it is the browser's cookie-bearing call. Spelling a method
    // here would red that suite AND teach a call a fleet-host session cannot
    // make. The negative is the mechanism; the positive keeps the reason
    // attached, because a rule whose reason is filed off gets re-broken.
    expect(rb(), 'a method in front of the revive path reads as "a call you make", and reds auth-passkey')
      .not.toMatch(/(GET|POST|PUT|PATCH|DELETE)\s+`?\/api\/sessions/);
    expect(flat(rb())).toContain('it is not on the armed gate\'s exempt list');
  });

  it('says why a revive under a different id wedges the program permanently', () => {
    expect(rb()).toContain('claimed-by-another');
    expect(flat(rb())).toContain('nothing in the HTTP API ever rewrites `claimedBy`');
  });

  it('carries a wave-N re-kickoff template, not the wave-1 text the machine hardcodes', () => {
    // `kickoff()` (StartProgramSheet.tsx:65-68) is correct exactly once per
    // program; a revive briefed with it re-opens wave 1 on a program at wave N.
    expect(rb()).toContain('open the run for wave <N>');
    expect(flat(rb())).toContain('do not open wave 1 again');
  });

  it('points at the reconstruction drill as the terminal recovery, and at the snapshot first', () => {
    expect(rb()).toContain('CoordStore.reconstruct');
    expect(rb()).toContain('ccrc-backups');
  });

  it('tells a LIVE coordinator that the revive door is not its recovery for a dead worker', () => {
    // The one real hazard of naming a revive door in this corpus: a
    // coordinator reaching for it on a WORKER instead of re-dispatching.
    expect(rb()).toContain('A dead WORKER is not this door');
  });

  it('names none of the three ungated operator doors', () => {
    // `allSkillText` already forbids the break door corpus-wide; the other two
    // are exempt-by-omission with no positive prohibition anywhere, and a
    // wedge-recovery runbook is the file most likely to reach for one.
    for (const door of ['/api/coord/pause', '/api/runs/:id/abandon', '/api/claims/:id/break']) {
      expect(rb(), `resume.md names ${door} — a door the coordinator is not the one to walk through`)
        .not.toContain(door);
    }
  });
});
```

- [ ] **Step 2: Run it and confirm the red is the RIGHT red**

```bash
cd server && timeout 600 ./node_modules/.bin/vitest run test/coordinator-skill.test.ts
```
Expected: **FAIL**, exactly one new test — `is INSIDE the corpus every whole-file assertion in this suite
reads`. If it PASSES here, `allSkillText` was already derived and **D-1000 is wrong** — stop and re-measure.

- [ ] **Step 3: Derive the corpus from the references directory**

Replace the two corpus consts (`:33` and `:50`, with the block comment between them) with:

```ts
/** Every reference this skill ships, FROM THE DIRECTORY — never a hand-typed
 *  list. `install-coordinator-skill.sh`'s `REQUIRED_REFS` is the other
 *  projection of this same directory and is pinned against it in
 *  `wrapper-roster-fixture.test.ts` (I8) for exactly this reason: "a literal
 *  array is a PROJECTION of something real that a future change can silently
 *  drift away from, and a comment asking a future author to keep them in sync
 *  is not a mechanism". The corpus below WAS that literal array until
 *  program-leverage wave 1 (D-1000), which means the census, the break-door
 *  prohibition and the untyped-refusal scan would all have skipped a fifth
 *  reference file in silence — while the spec that added it named the census
 *  as the binding constraint on that very file. */
const REFERENCE_NAMES: readonly string[] =
  readdirSync(path.join(skillDir, 'references'))
    .filter((n) => n.endsWith('.md'))
    .sort();
const allSkillText = [skill, ...REFERENCE_NAMES.map(refs)].join('\n');

/** The route harvest's corpus: SKILL.md + every reference EXCEPT the ones
 *  named here. `mail-envelope.md`'s only route-shaped text is the worked
 *  example's `ack: POST /api/mail/<id>/ack` line, and the byte-identity test
 *  below requires it to be `renderEnvelope`'s REAL output — a concrete
 *  delivery id, never the literal `:id` fastify registers. It stays in
 *  `allSkillText` (the census still scans it — a worked example naming a
 *  destructive verb would be exactly as licensing as prose naming one) and is
 *  pulled OUT of just the route harvest, so a real numeric id never reads as a
 *  route this skill "names" and fails a literal-match check no server route
 *  can ever satisfy.
 *  Everything else is IN, in both parity directions: `peer-protocol.md`'s
 *  curl-free call shapes and headings name real registered routes, and
 *  `resume.md` names three coordination reads — so neither may name a ghost.
 *  (`resume.md` also names the PWA's revive door, deliberately WITHOUT a
 *  method: see the foot-of-file describe and D-1001.) */
const ROUTE_CORPUS_EXCLUDES: ReadonlySet<string> = new Set(['mail-envelope.md']);
const routeSkillText = [
  skill, ...REFERENCE_NAMES.filter((n) => !ROUTE_CORPUS_EXCLUDES.has(n)).map(refs),
].join('\n');
```

- [ ] **Step 4: Fix the stale failure message the derivation makes visibly wrong**

`:217-218` says a route is `'…never named anywhere in SKILL.md or references/wave-lifecycle.md'` — stale
since `peer-protocol.md` joined the corpus, and now wrong for a third reason. Replace with:

```ts
      expect(named.has(r), `${r} is registered in coord/routes.ts but is named nowhere in the route ` +
        `corpus (SKILL.md + ${REFERENCE_NAMES.filter((n) => !ROUTE_CORPUS_EXCLUDES.has(n)).join(', ')})`)
        .toBe(true);
```

- [ ] **Step 5: Derive the address corpus too**

`the server address is config, never a literal`'s `corpus` const (`:747-754`) is the third hand-typed copy.
Replace with:

```ts
  const corpus: ReadonlyArray<readonly [string, string]> = [
    ['coordinator SKILL.md', skill],
    ['worker SKILL.md', workerSkill],
    // DERIVED, same reason as `REFERENCE_NAMES` above (D-1003): a new
    // reference file carrying a hardcoded server address would have been
    // checked by nothing.
    ...REFERENCE_NAMES.map((n) => [n, refs(n)] as const),
  ];
```

- [ ] **Step 6: Verify GREEN, then MUTATE to prove each derivation still guards**

```bash
cd server && timeout 600 ./node_modules/.bin/vitest run test/coordinator-skill.test.ts test/typecheck-tests.test.ts
```
Expected: PASS both. (`typecheck-tests` is a known load flake — re-run it in isolation before calling it a
real break.)

Then, one at a time, reverting each:

1. **Corpus regression.** Replace `REFERENCE_NAMES` with the old literal
   `['ledger-template.md','mail-envelope.md','peer-protocol.md','wave-lifecycle.md']` → expect FAIL on
   `is INSIDE the corpus every whole-file assertion in this suite reads`.
2. **Census reach.** Add the sentence `A wedged workspace is not cleared with ws-rm.` to `resume.md` →
   expect FAIL on `names the three destructive verbs ONLY inside the clause that forbids them` (`ws-rm`
   appears 2×, licensed 1×). This is the proof the spec's stated constraint is now a mechanism.
3. **Ghost route.** Append ``Then call `POST /api/runs/:id/resurrect`.`` to `resume.md` → expect FAIL on
   `names no route the server does not register`.
4. **Address scan reach.** Add `http://192.0.2.7:7788` to `resume.md`... **do not run this one** — the
   pattern would be committed if a step is interrupted, and `topology-clean`'s history scan reads every blob
   the branch introduces. Reason about it from the derivation instead and say so in the report.

Record every outcome in `## Deviations found` if any mutation does NOT red.

- [ ] **Step 7: Commit**

```bash
git add server/test/coordinator-skill.test.ts
git commit   # message: D-1000 and D-1003, the three derivations, the measured red, and the mutation results
```

---

## Task 4: `SKILL.md` — the trigger and the resume constraint name the run record

**Files:** Modify `ccd/coordinator-skill/SKILL.md:3`, `:8-13`, `:14-25`; add one describe to
`server/test/coordinator-skill.test.ts`.

**Interfaces:** Consumes `references/resume.md` (Task 2) — the reworded paragraph points at it. Produces
nothing later tasks read.

**The defect, measured.** The trigger arm `or this workspace's hold reads `program:<slug> wave:N/M``
describes a state a PWA-started coordinator can never be in: `ccd ws-hold` hard-refuses a non-workspace
(`ccd/ccd:4938-4939`) and a PWA-started coordinator is a main checkout (`StartProgramSheet.tsx:89-90`). Every
`program:` hold on this fleet is on a WORKER's workspace — which is why the WORKER skill's identical-looking
arm is correct and must not be touched. An operator-designated coordinator MAY be workspace-resident (this
program's is), so the fix must not swing to asserting main-checkout-ness either.

- [ ] **Step 1: Write the failing pins**

Append to `server/test/coordinator-skill.test.ts`:

```ts
// ── program-leverage wave 1 (F1): the trigger names the RUN RECORD ─────────
//
// `ccd ws-hold` hard-refuses a non-workspace (ccd:4938-4939) and a PWA-started
// coordinator is a main checkout (StartProgramSheet.tsx:89-90), so the hold arm
// of the old trigger described a state half the coordinators this skill runs in
// can never reach — while the WORKER's identical-looking arm is correct,
// because every `program:` hold lands on the worker's workspace. The run record
// is the one fact both kinds of coordinator share, and `GET /api/runs` is
// EXEMPT-BUT-AUTHENTICATED (gate.ts, D-149) precisely so a cookieless
// fleet-host session can read it.
describe('the coordinator skill triggers and resumes on the RUN RECORD, not a hold', () => {
  const fm = (): string => skill.slice(4, skill.indexOf('\n---', 4));

  it('triggers on the run record and KEEPS the operator-designation arm', () => {
    expect(fm()).toContain('the operator said so');
    expect(fm()).toContain('`GET /api/runs` names this session id as the `claimedBy` of an open run');
    // The mutation: restoring the hold arm. Scoped to the frontmatter, because
    // the body legitimately discusses holds — the WORKER's, placed at dispatch.
    expect(fm(), 'the frontmatter trigger describes a hold again').not.toMatch(/hold reads/);
  });

  it('does not over-correct into asserting the coordinator is a main checkout', () => {
    // This program's own coordinator is workspace-resident, so a trigger that
    // says "main checkout" excludes the live case.
    expect(fm()).not.toMatch(/main checkout/i);
  });

  it('states the resume constraint as the SESSION ID, not the workspace', () => {
    expect(flat(skill)).toContain('and it is the SESSION ID, not the workspace');
    expect(skill, 'the workspace framing is back').not.toContain('same workspace, same id');
  });

  it('does not count the hold among the things a fresh coordinator resumes from', () => {
    expect(flat(skill)).toContain('The hold is NOT one of them');
    expect(flat(skill), 'the three-things sentence lists the hold again')
      .not.toMatch(/Everything you know lives in the program ledger[\s\S]{0,200}the workspace's hold/);
  });

  it('points a dying coordinator at the runbook, by the path the skill installs it at', () => {
    expect(skill).toContain('`references/resume.md`');
  });
});
```

- [ ] **Step 2: Run and confirm the reds**

```bash
cd server && timeout 600 ./node_modules/.bin/vitest run test/coordinator-skill.test.ts -t 'RUN RECORD'
```
Expected: **4 failed, 1 passed**. The passing one is `does not over-correct into asserting the coordinator is
a main checkout` — the current text does not say it, so that pin is a regression guard on the fix rather than
a red-first driver. Note that in the report; do not "fix" it by weakening it.

- [ ] **Step 3: Rewrite the frontmatter description (`SKILL.md:3`)**

Replace the whole `description:` line with (ONE physical line, straight apostrophes):

```
description: Drive a multi-wave ccrc program as the coordinator session — open the run, dispatch each wave, read mail, re-measure a claimed wave-done, review the handoff commit, release on the final merge. Use when this session IS the coordinator for a program (the operator said so, or `GET /api/runs` names this session id as the `claimedBy` of an open run). Never use it to do a wave's own work — a coordinator that starts implementing has become a worker with a stale plan.
```

Only the parenthetical changed. `never use it to do a wave` survives verbatim.

- [ ] **Step 4: Rewrite the three-things paragraph (`SKILL.md:8-13`)**

Replace:

```
You are one disposable session driving a long-horizon program. **You hold no
unique state.** Everything you know lives in the program ledger
(`docs/superpowers/programs/<slug>.md`, committed), in the run record on the
server, and in the workspace's hold. If you die mid-wave the operator starts a
fresh you, and it resumes from those three things. Write accordingly: never
carry a decision only in your own context.
```

with:

```
You are one disposable session driving a long-horizon program. **You hold no
unique state.** Everything you know lives in the program ledger
(`docs/superpowers/programs/<slug>.md`, committed) and in the run record on the
server — `GET /api/runs` is what tells a fresh you which program it owns and
which wave that program is on. If you die mid-wave the operator starts a fresh
you, and it resumes from those two things. Write accordingly: never carry a
decision only in your own context. The hold is NOT one of them: `ccd ws-hold`
refuses a main checkout outright, so a coordinator that is not
workspace-resident carries no hold at all, and every `program:` hold on this
fleet sits on a WORKER's workspace.
```

- [ ] **Step 5: Rewrite the resumability paragraph (`SKILL.md:14-25`)**

Replace the whole `**One real constraint on that resumability:** …` paragraph with:

```
**One real constraint on that resumability, and it is the SESSION ID, not the
workspace:** `POST /api/runs`'s `claimedBy` is your tmux-derived session id
(below), and the server refuses any later call for this program whose
`claimedBy` differs from whichever session first opened it
(`claimed-by-another` — clause 8). A fresh coordinator resumes cleanly ONLY if
the operator revives it under that SAME id — the id-preserving revive, never a
re-creation that recomputes one from an account and a project. Revived under a
different id (the operator's own placement rule may pick any least-loaded
home), every `POST /api/runs` call for this program answers
`claimed-by-another` naming a session that may no longer even exist —
permanently, since nothing in the HTTP API ever rewrites `claimedBy`. That is
a recovery on the box, not something this session can fix by retrying.
`references/resume.md` is the runbook for all of it: how to measure which run
is open, the two id-preserving revives, the wave-N re-kickoff text, and what is
left when the id is already lost.
```

- [ ] **Step 6: Verify GREEN across both skill suites**

```bash
cd server && timeout 600 ./node_modules/.bin/vitest run test/coordinator-skill.test.ts test/worker-skill.test.ts test/auth-passkey.test.ts
```
Expected: PASS all. The ten contract clauses still match verbatim (you did not touch them); the census is
unchanged; `GET /api/runs` in the new frontmatter is `EXEMPT`, so `THE SWEEP` stays green.

- [ ] **Step 7: Check the WORKER's hold arm was not collateral damage**

```bash
grep -n "hold reads" ccd/worker-skill/SKILL.md ccd/coordinator-skill/SKILL.md
```
Expected: exactly ONE hit, in `ccd/worker-skill/SKILL.md` (its frontmatter). The worker's arm is correct and
stays — see D-1004 for its own separate, deferred drift.

- [ ] **Step 8: Verify no curly apostrophe crept in**

```bash
grep -o $'’' ccd/coordinator-skill/SKILL.md | wc -l
```
Expected: **5** — the five inside pinned clauses 4, 5 and 10, unchanged.

- [ ] **Step 9: Commit**

```bash
git add ccd/coordinator-skill/SKILL.md server/test/coordinator-skill.test.ts
git commit   # message: the three sites (frontmatter, three-things, resumability), why the worker's arm
             # stays, D-1002, and that the ten clauses are untouched
```

---

## Task 5: `StartProgramSheet.tsx` — every anchor in the file resolves

**Files:** Modify comments only in `pwa/src/fleet/StartProgramSheet.tsx`.

**Interfaces:** none in either direction.

**Scope, and its limit.** Spec §3 item 4 names ONE stale anchor. Eleven are stale in this file by the same
measurement (**D-999**). Fixing one and leaving ten is worse than either extreme, so this task makes the
FILE correct — and stops there. The same-class anchors in four OTHER files are measured, reported and NOT
touched (**D-1005**): a tree-wide anchor audit is a different feature and nothing in the tree resolves
anchors mechanically, so it will re-rot without one.

- [ ] **Step 1: Harvest every anchor in the file and re-measure each one yourself**

```bash
cd "$(git rev-parse --show-toplevel)"
grep -nEo '`[A-Za-z0-9_./-]+:[0-9]+(-[0-9]+)?`' pwa/src/fleet/StartProgramSheet.tsx | sort -u
```
For each hit, open the cited file at the cited line and decide: does it show what the prose says? Build the
table before editing anything. **Believe your own measurement over the table below.**

- [ ] **Step 2: Apply the corrections**

Measured stale, with the verified target:

| comment line | claim | correct anchor |
|---|---|---|
| `:4` | `POST /api/runs` demands a claimant | `server/src/coord/routes.ts:872`, with the second-claimant refusal at `server/src/coord/store.ts:363-371` |
| `:15` | `POST /api/sessions`'s body is `{ok:true}`, via `runCcdOr502` | `server/src/server.ts:1510-1513` (the helper) and `:1517-1530` (the route) |
| `:16` | `_id()` | `ccd/ccd:1091` |
| `:27` | `cmd_start` is idempotent | `ccd/ccd:12117` (definition), `:12144` and `:12182` (the collision test) |
| `:83` | `_ws_least_loaded` | `ccd/ccd:3530` (definition), call site `:3707` |
| `:96`, `:155`, `:308`, `:582` | `_reg_set "$id" wrapper "$target"` | `ccd/ccd:13125`, inside `cmd_swap()` at `ccd/ccd:12958` |
| `:98` | `cmd_start`'s collision test | `ccd/ccd:12144` and `:12182` |
| `:451` | writes `.uuid` then spawns | `ccd/ccd:12206-12208`, then `_spawn_start` |
| `:159`, `:452` | registry id listing keyed on `.uuid` | `server/src/registry.ts:793` |
| `:454` | reports `status:'idle'` | `server/src/fleet.ts` — **measure the line yourself**; the sweep did not verify it |
| `:455` | the 2 s tick | `server/src/watch.ts:533` (`intervalMs = 2000`), `setInterval` at `:540` |

Measured CORRECT — do not touch: `server/src/limits.ts:96` (`projectHome`), `shared/api.ts:35-37`
(`workspace: string | null`), `pwa/src/fleet/coordWords.ts:43` (`markerState`).

Do NOT rewrite the prose claim at `:4` that the route "demands a live `claimedBy`" — the route requires a
non-empty string and checks no liveness. That is a semantic correction, not an anchor fix; see
`## Notes for the coordinator`, item 2.

Do NOT touch `:68`.

- [ ] **Step 3: Prove the file is comment-only changed and every anchor now resolves**

```bash
git diff -U0 pwa/src/fleet/StartProgramSheet.tsx | grep -E '^\+' | grep -vE '^\+\+\+' | grep -vE '^\+\s*(\*|//|/\*)' || echo 'comment-only: no non-comment line added'
```
Expected: `comment-only: no non-comment line added`. Then re-run Step 1's harvest and re-open each anchor.

- [ ] **Step 4: Test the PWA**

```bash
cd pwa && timeout 600 npm run test
```
Expected: PASS — including `start-program.test.tsx`, whose `:116`/`:313` pin the kickoff string you did not
touch.

- [ ] **Step 5: Commit**

```bash
git add pwa/src/fleet/StartProgramSheet.tsx
git commit   # message: D-999, the anchor table, comment-only, and the four out-of-file siblings left as D-1005
```

---

## Task 6: Whole-branch verification and the PR

**Files:** none modified.

- [ ] **Step 1: Run the three suites, foreground, one package at a time**

```bash
cd server && timeout 600 npm run test
cd ../agent && timeout 600 npm run test
cd ../pwa   && timeout 600 npm run test
```
All three green. Known load flakes — `ccd-ws-gc`, `pr-sweep`, `session-hook`, `typecheck-tests`,
`ccd-session-state` — must be **re-run in isolation** before being called a real break.

- [ ] **Step 2: Re-verify the wave's own constraints, and the two tree-wide ratchets**

```bash
cd "$(git rev-parse --show-toplevel)"
for v in ws-reap ws-rm ws-gc; do
  printf '%-10s %s\n' "$v" "$(cat ccd/coordinator-skill/SKILL.md ccd/coordinator-skill/references/*.md | grep -c -- "$v")"
done
grep -c -- '/api/claims/:id/break' ccd/coordinator-skill/SKILL.md ccd/coordinator-skill/references/*.md
git status --short
git log --oneline origin/main..HEAD
```
Expected: `1` for each destructive verb; `0` for the break door in every corpus file; a clean tree; five
commits plus the plan commit on `ws/quiet-meadow`.

`topology-clean` and `deviation-refs` both ran inside Step 1 and both read `origin/main..HEAD`, so a residue
token or an over-high `D-` ref in ANY commit of this branch — not just the tip — is already covered there.

- [ ] **Step 3: Push and open the PR**

```bash
git push -u origin ws/quiet-meadow
gh pr create --base main --head ws/quiet-meadow \
  --title "program-leverage wave 1 — F1: drift fixes + the coordinator-resume runbook" \
  --body-file <the body described in Notes item 5>
```

- [ ] **Step 4: Measure the fingerprint ONCE, after the last push**

```bash
git rev-parse HEAD
gh pr view --json number,state
```
`branchTip` and `handoffCommit` are the SAME sha. `prPhase` is one of the eight enum words — read it, never
invent it. Send the `wave-done` mail with `runId: 10`, then STOP PUSHING (worker clause 9).

---

## Deviations found

Block for this program: **D-999..1046** (allocated at run-open; the upper bound is written prefix-less on
purpose — `deviation-refs.test.ts` reads every `D-<n>` token in the tree as a live ref).

### D-999 (drift, found while measuring spec S3 item 4) — `StartProgramSheet.tsx` carries ELEVEN stale anchors, not one
Spec §3 names one (`ccd:185` for `_id()`). Ten more in the same file are stale by the same measurement, all
verified: `routes.ts:660-709` (that range is `POST /api/mail/:id/ack` today; `POST /api/runs` is
`coord/routes.ts:872` and the refusal it describes is `coord/store.ts:363-371`), `server/src/server.ts:593-596`
(the passkey block; `runCcdOr502` is `:1510-1513`), `ccd:7192-7203` ×2 and `ccd:7203-7208` (reap-variable
resets; `cmd_start` is `:12117`), `ccd:1164+` (`_ws_least_loaded` is `:3530`), `ccd:7307` ×4 (`_reg_set …
wrapper` is `:13125`), `registry.ts:375` ×2 (`:793`), `fleet.ts:186-190`, `watch.ts:424` (`:533`).
**Decision:** make the FILE correct; leave the tree-wide audit alone (D-1005). Three anchors in the file
measured CORRECT and are untouched. The comment's PROSE claim that the route "demands a live `claimedBy`" is
separately imprecise and deliberately NOT rewritten — an anchor fix is not a semantic one.

### D-1000 (defect in the guard, found while planning spec S3 item 3) — the destructive-verb census could not see a new reference at all
Spec §3 states the census as a HARD constraint on `resume.md`: it "counts the three destructive verbs across
SKILL.md + ALL references". It did not. `allSkillText` (`coordinator-skill.test.ts:33`) was a hand-typed list
of three reference files, so a fifth would have been invisible to the census, to the break-door prohibition
and to the untyped-refusal census alike — the constraint would have bound nothing. **Decision:** derive the
corpus from `readdirSync(references/)`, the identical rule `wrapper-roster-fixture.test.ts` (I8) already
applies to `install-coordinator-skill.sh`'s `REQUIRED_REFS`. Measured red first, and re-proved by mutation
(a `ws-rm` mention in the runbook must red the census).

### D-1001 (spec item unachievable as literally written) — the revive route may not be spelled with a method
Spec §3 item 3 asks the runbook to name "the PWA's dead-session Restart session → `POST
/api/sessions/:id/ensure`". `server/test/auth-passkey.test.ts:2284-2321` walks every `.md` in both skill
corpora, harvests `METHOD /api/path`, and asserts every hit is a member of `EXEMPT` — "these are mandated by
a skill and REFUSED by the armed gate". `POST /api/sessions/:id/ensure` is deliberately NOT exempt
(`server/src/auth/gate.ts`), because it is the browser's cookie-bearing call and a fleet-host session cannot
make it. The spec's literal therefore reds a shipped guard AND would teach a call the reader cannot perform.
**Decision:** the runbook names the control, and the path WITHOUT a method, and states in the same paragraph
that it is the operator's browser call and not on the exempt list — with a pin on both the negative (no
method) and the reason. The guard is right; the spec sentence is the thing that had to bend. This also
retires an earlier draft's plan to widen the route-linkage scan: with no out-of-domain route named, the
existing forward scan passes unchanged and no test-infrastructure change is needed.

### D-1002 (drift, found while rewording spec S3 item 2) — the hold is named as a coordinator resume source in a THIRD place
Spec §3 names two sites: the frontmatter trigger (`SKILL.md:3`) and the resumability paragraph's "same
workspace" (`:14-25`). A third is `SKILL.md:8-13`, which tells a coordinator everything it knows lives in
"the program ledger …, the run record …, and in the workspace's hold" and that a fresh one "resumes from
those three things" — false for the same reason, and more load-bearing than the trigger, because it is what a
LIVE coordinator reads before deciding what to write down. **Decision:** corrected in the same task, with its
own pin.

### D-1003 (defect in the guard, same discovery as D-1000) — a third hand-typed copy of the references directory
`the server address is config, never a literal`'s `corpus` array (`coordinator-skill.test.ts:747-754`)
enumerates the reference files by hand a third time, so a new reference shipping with a hardcoded server
address would have been checked by nothing. **Decision:** derived from `REFERENCE_NAMES` in the same commit.

### D-1004 (drift, measured and DEFERRED) — the ledger template still tells an orchestrator to place the hold at program start
`ccd/coordinator-skill/references/ledger-template.md:3-5` says to copy the template "when an orchestrator
starts a multi-wave program (`ccd ws-hold --session <id> --reason "program:<slug> wave:1/N"`)". Two things
are wrong with it: `SKILL.md:209-212` and `references/wave-lifecycle.md:31-33` both say wave 1 places NO hold
until its own dispatch, and the reason format is missing the ` run:<id>` suffix the shipped builder emits
(`server/src/coord/rundefs.ts:90-93`). The same stale reason format appears in `ccd/worker-skill/SKILL.md:3`
and `references/wave-lifecycle.md:31`. **Decision: NOT fixed in this wave.** The template is byte-pinned to
`docs/superpowers/programs/TEMPLATE.md` (`coordinator-skill.test.ts:380-381`), so it is a two-file edit to a
document every program's ledger is copied from; and the worker frontmatter is explicitly out of scope (spec
§3: "The worker skill's trigger keeps its hold arm"). It is the same defect family as item 2 and belongs in a
wave that owns it.

### D-1005 (drift, measured and DEFERRED) — same-class stale anchors outside this wave's files
`pwa/test/start-program.test.tsx:6-17` mirrors the sheet's own stale anchors (`server.ts:593-596` among
them); `pwa/src/lib/api.ts:433-435` cites `coord/routes.ts:844` for a route now at `:975`/`:995`;
`server/src/limits.ts:46` cites `ccd:2451` for `_ws_least_loaded` (`:3530`); `ccd/ccd:13127` cites
`ccd:11034` for `cmd_ensure` (`:12275`). **Decision: NOT fixed.** Spec item 4 names one file; a tree-wide
anchor pass is its own piece of work, and worth doing only alongside something that resolves anchors
mechanically — otherwise it re-rots on the next refactor.

*(1006..1046 remain unconsumed. Anything found during execution takes the next free one and is appended here
with the same shape.)*

---

## Notes for the coordinator

1. **The pin this wave deliberately did NOT add.** Root `CLAUDE.md`'s door count drifted because nothing
   measured it, and a test comparing that sentence against `coord/routes.ts`'s real ungated set would stop it
   recurring. Spec §3 rules it out in words ("CLAUDE.md is prose and gets none"), so this wave follows the
   spec. Flagged because F5 has to touch the same sentence again (two → three → four): a sentence edited
   twice with no mechanism will drift a third time. **A suggestion, not a deviation** — the spec's decision
   stands unless you change it.
2. **`StartProgramSheet.tsx:4`'s prose** claims `POST /api/runs` "demands a live `claimedBy`". The route
   requires a non-empty string and checks no liveness; the second-claimant refusal is `openRun`'s. Left
   untouched — it is one sentence and belongs to whichever wave next opens that file for a reason.
3. **`README.md:1421-1425`** says "every coordinator write route now fails the same way the mail pair always
   has. None of these six routes tolerates a missing token", and README never mentions the ungated three
   anywhere (`grep -n ungated README.md` → nothing). Measured: the six routes it enumerates ARE all gated, so
   the sentence is a SILENCE rather than a lie. No deviation number consumed; raised so a README pass can
   decide.
4. **Wave 5 depends on this wave's re-kickoff template** (spec §12). It lives in
   `ccd/coordinator-skill/references/resume.md` under `## 4. Briefing the revived coordinator`, pinned by
   `carries a wave-N re-kickoff template, not the wave-1 text the machine hardcodes`.
5. **AGENT-FIRST at close.** This slice touches `ccd/coordinator-skill/`, so the fleet host ships before the
   server. Nothing in this plan deploys. PR body should carry: the four spec items and where each landed; the
   seven deviations, one line each; the measured reds (`wrapper-roster-fixture` I8, the corpus coverage pin,
   the four trigger pins) and the mutation results; three suites green; "AGENT-FIRST deploy, not performed".

---

## Self-review

**Spec coverage.** §3 item 1 → Task 1. Item 2 → Task 4. Item 3 → Tasks 2 and 3 (the file, then the guards
that make its constraints real), with item 3's route literal amended per D-1001. Item 4 → Task 5. §3's
"Tests" paragraph → Tasks 3 and 4's pins, in the existing verbatim-literal style, small set; CLAUDE.md gets
none, as ruled. §3's hard constraint (no destructive verbs in the runbook) → measured in Task 2 Step 5 and
made a MECHANISM in Task 3 Step 3, then proved by the Step 6 mutation. §12's AGENT-FIRST rule → Global
Constraints and Note 5: nothing deploys.

**Placeholder scan.** No TBDs. Every prose deliverable is quoted in full; every test body is written out;
every command has an expected output. The one place a step says "measure it yourself" (Task 5's
`fleet.ts:186-190`) is deliberate — the sweep that found it did not verify it, and saying so is more useful
than inventing a line number.

**Type consistency.** `REFERENCE_NAMES` (`readonly string[]`) and `ROUTE_CORPUS_EXCLUDES`
(`ReadonlySet<string>`) are the only new identifiers; `refs`, `skill`, `skillDir`, `workerSkill`, `flat`,
`readdirSync`, `readFileSync` and `path` are already imported or defined in `coordinator-skill.test.ts`, so
no new imports. `flat` is defined at module scope and is only ever CALLED inside `it` bodies, so a describe
written above it may use it. The corpus consts must stay ABOVE their first use (`allSkillText` is read in the
census at the top of the file), which is where they already sit.

---

## Execution record (measured, 2026-08-28)

Every red below was observed before its fix landed; every mutation was applied, measured and reverted.

| # | what was measured | outcome |
|---|---|---|
| 1 | `resume.md` created, `REQUIRED_REFS` untouched | **RED** — `wrapper-roster-fixture.test.ts:409`, `declared` missing `resume.md` |
| 2 | the coverage pin, against the hand-typed `allSkillText` | **RED** — 1 failed / 49 passed, exactly the one new assertion |
| 3 | D-1001: `POST /api/sessions/:id/ensure` spelled with its method in `resume.md` | **RED** — `auth-passkey.test.ts:2321`, `blocked` = `["POST /api/sessions/:id/ensure"]`. Reverted. |
| 4 | mutation: `REFERENCE_NAMES` restored to the four-element literal | **RED** — the coverage pin. Reverted. |
| 5 | mutation: `A wedged workspace is not cleared with ws-rm.` appended to `resume.md` | **RED** — `ws-rm appears 2×; only the forbidding clause may name it: expected 2 to be 1`. Reverted. **This is the proof spec §3's stated census constraint is now a mechanism for the new file rather than a request.** |
| 6 | mutation: `` `POST /api/runs/:id/resurrect` `` appended to `resume.md` | **RED** — `names no route the server does not register`. Reverted. |
| 7 | the four trigger/resume pins, against the pre-fix `SKILL.md` | **RED** — 4 failed / 1 passed. The passing one is `does not over-correct into asserting the coordinator is a main checkout`, kept deliberately as a regression guard (see its own comment). |
| 8 | Task 3 Step 6 mutation 4 (a numeric host literal in `resume.md`) | **NOT RUN**, as the plan directs: `topology-clean`'s history scan reads every blob the branch introduces, so an interrupted step would publish the token permanently. The property is covered by the derivation the same three-way as mutations 4–6. |

Constraints re-measured on the finished branch: `ws-reap`/`ws-rm`/`ws-gc` = 1 each across SKILL.md + all
five references; `/api/claims/:id/break` = 0 in every corpus file; `resume.md` carries zero curly
apostrophes, zero `curl`, zero `CCRC_SERVER_URL`, no numeric host literal, and exactly three METHOD-spelled
routes (`GET /api/runs`, `GET /api/runs/:id/items`, `POST /api/runs`) — all three in `EXEMPT`;
`SKILL.md` still carries exactly 5 curly apostrophes, all inside pinned clauses; one `hold reads` survives in
the tree and it is the WORKER's.

Suites, foreground, per package: **server 230 files / 5789 passed** (54 skipped), **agent 18 / 280**,
**pwa 74 / 1935**. No flake re-runs were needed.

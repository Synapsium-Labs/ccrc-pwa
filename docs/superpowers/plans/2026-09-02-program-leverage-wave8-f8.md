# program-leverage wave 8 — F8: the honest read, the terminal write, and the ledger's own procedure — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan
> task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the last wave of the program by making three seams stop lying and one procedure stop
generating the incident it was written to prevent. `FleetIO`'s four remaining reads fold absent,
unreadable and over-cap into one `null` — and the agent's `stat` op answers EACCES as
`{missing:true}`, so the wire's own absent-marker already lies. `MailDeliveryState`'s terminality is
enforced at some writers and not others, with no record of which. And the ledger's landing sweep asks
"did this number land?" with a bare token match while asking "was it defined?" eleven lines below with
the definition shape — a divergence that terminally mis-stamped two rows against an unmerged file at
**13:12:58.004Z on 2026-09-02**, from a line that was another lane following the very grep procedure
this item retires.

**Architecture:** Five independent work items on one branch, ordered agent-first. (1) The measured-read
completion (D-114): `readFileMeasured`'s `MeasuredRead`/`ReadFailure` shape is extended to
`readFileFrom`, `readFileB64`, `readdir` and `stat`, each derived through `this` from one honest read
so no adapter narrows a distinction it received; the agent's over-cap third condition and its
EACCES-as-missing answer both get their own marker. (2) The `MailDeliveryState` terminality audit:
every writer enumerated, each either guarded or carrying a recorded reason, with a source-scanning
test that reds when a new unguarded writer appears. (3) The ledger procedure, in three parts — `byId`
refused at the CLIENT unless identity is provably this pane's (`TMUX_PANE`, plus a `--by` door for
contributors and CI); root `CLAUDE.md` gains what the floor MEANS, which it has never said; and the
sweep's landing half is moved onto `definitionsIn`, with a `user_version 7 → 8` repair migration that
un-lands rows whose recorded landing cannot be a definition so the corrected sweep re-decides.
(4) The three inherited: the fifth repoint arm, `ccd/ccrc-api`'s stale two-door census (D-1168) where
there are four ungated doors, and both SKILL.md identity blocks moved onto `ccrc-api whoami`.
(5) Wave 7's twelve carries: two real defects (the `FENCE` regex's `\s` admitting a tab where the
fence rule does not, and D-1329's retraction reaching only `ledger.ts`) and ten stale prose cardinals
at eleven sites — one commit, measured, not a design.

**Tech Stack:** TypeScript (`"type":"module"` in all four packages), Fastify 5, `node:sqlite`
`DatabaseSync`, vitest 4, React 19 + zustand (PWA), jsdom + @testing-library/react, bash (`ccd`,
`ccrc-api`).

**Spec:** `docs/superpowers/specs/2026-08-28-program-leverage-design.md` §9 — fetch `ws/brisk-meadow`
from origin; the program ledger on that ref carries this wave's brief (run 30, items 139–143) and
wave 7's close record.

## Global Constraints

- **Branch:** commit on `ws/quiet-meadow`, never a feature branch. The done-fingerprint re-measures
  THIS workspace branch's tip; work parked elsewhere wedges every close with `stale-tip`.
- **AGENT-FIRST.** Items 3 and 4 touch `ccd/ccrc-api`, `ccd/coordinator-skill/` and
  `ccd/worker-skill/`. Root `CLAUDE.md`: such a change ships to the fleet host BEFORE the server.
  **Deploy is not the worker's act** — the plan lands the change and says so in the wave-done mail; it
  does not run `deploy.sh`.
- **Wire discipline:** additive-only; a SINGLE reader per new field; an older peer omitting a field is
  tolerated and renders NOTHING (never a lie); no `FLEET_PROTO` bump (stays 1); no new `ccd` verbs
  (`EXEC_COMMANDS` stays `['tmux','ccd']`); **no overloaded null at any seam this wave touches** —
  which is item 1's entire subject, so the rule is the deliverable, not a side condition.
- **Rings** (`docs/superpowers/specs/2026-08-10-architecture-ddd-clean-solid.md`): L0 `shared/*.ts`
  imports nothing but a sibling TYPE; L1 pure decisions, no `fs`/fastify/`reply`/clock; L2 ports
  declared by the consumer; **L3 adapters may not narrow a distinction they received** — the
  highest-yield rule in this plan; L4 delivery owns fastify/sockets/timers and may not DECIDE; L5 is
  `index.ts` only.
- **Mutation-table discipline:** every guard ships WITH a test measured RED on that guard's deletion.
  TDD red-first. Rows carry **suite / mutation / verbatim first-fail**, written AS YOU GO, and the
  table is counted twice by independent methods. A row that comes back GREEN is a hole, not a pass.
  A mutation that reds for the WRONG reason (inert regex edit, or one that breaks compilation rather
  than the guard) is a hole too — name the reason in the row.
- **Deviations:** `D-1396`-`D-1437`, taken from `~/.local/bin/ccrc-api ledger allocate` in ONE call
  carrying `byId`, floor read from that answer and **never from a document**, **allocated and defined
  in the same act**. Every definition lives in this plan's **Deviations found** section and nowhere
  else — the `LEDGER` line inside a task REFERENCES its number, it does not define it. Use the number
  the section gives you; never renumber, never predict, never reuse.
  A deviation found DURING execution is allocated from the same allocator at the moment it is found
  and defined in that section in the same act. **The floor is never quoted anywhere else in this
  plan**: on 2026-09-02 alone it read 1333, 1389, 1392, 1396 and then 1438 — a standing floor is a
  cardinal that goes stale within the hour, which is what D-1331 records.
  Before merge: `git fetch origin main` then `cd server && ./node_modules/.bin/vitest run
  test/deviation-refs.test.ts test/dtbd.test.ts`.
- **Suites:** `./node_modules/.bin/vitest run` from inside the package, FOREGROUND, timeout
  ≥600000ms, tails READ not grepped. Never bare `npx vitest`. All three packages installed or
  `typecheck-tests` reports spurious failures. Known load flakes (`ccd-ws-gc`, `pr-sweep`,
  `session-hook`, `typecheck-tests`, `ccd-session-state`) are re-run IN ISOLATION before being called
  a break.
- **Node floor `>=22.13.0`** identical across the three engines. If `node-floor`'s absolute assertion
  is red while the others are green, RAISE engines — never lower them.
- **Safety, non-negotiable:** never run `ws-rm`, `ws-reap`, `ws-gc --prune`, `ws-archive`/`ws-restore`
  against the live host; never touch tmux, `~/.cc-sessions`, `~/.cc-limits` or `claude-session@*`
  directly; tests use FIXTURE HOMEs only; never print secret file contents (existence by `ls`); never
  add a `gh` exec-whitelist entry.
- **Every line number in this plan is PROVENANCE, not an address.** All of them were opened at HEAD
  `5e9f650d`; thirty-four tasks then edit twenty-odd files in order, and an earlier task's insert
  moves every number a later task quotes. **Anchor by the quoted text — every task supplies it.**
  A cross-task audit of the assembled plan measured fifteen such shifts; the text anchors survive
  all fifteen, the numbers survive none. Where a shift is large enough to mislead (`store.ts` after
  Task 20's +14; `ccd/ccrc-api` after Task 40's ~+75; `server/src/io.ts` after Task 2's ~+25;
  `ccrc-api.test.ts` after Task 40's harness) the owning item says so, but the rule is general:
  **if a quoted anchor is not where the plan says it is, search for the text; do not edit the line.**
- **Suite COUNTS are deltas, never absolutes.** A task asserts what its own edit adds or leaves
  unchanged, measured immediately before and after. HEAD counts appear only as provenance — items
  run in order and four items land before item 5 reads the same files.
- **Baseline:** measure all three suites BEFORE the first edit and record the counts in the Execution
  record. Any red beyond that baseline is this wave's.

## File Structure

Fifty-three files, grouped by work item. **Ring** is a property of the file's import block, not its
path — where a row names one, it was read at HEAD.

### Item 1 — the measured-read completion (Tasks 1–8)

| File | Responsibility |
|---|---|
| `server/src/io.ts` | L2 port. `FleetIO`'s 9 members; `readFileMeasured` is the honest template the four folding reads are derived from through `this`. |
| `server/src/remote/io.ts` | L3 adapter, fleet-remote half. Single reader of the `read` op's `absent?: true`; gains the same for `readFrom`/`readB64`/`readdir`/`stat`. |
| `agent/src/fileops.ts` | Agent-side file ops. Owns the over-cap third condition `localIO` has no equivalent of, and the `stat` op that answers EACCES as `{missing:true}`. |
| `agent/src/server.ts` | Agent frame dispatch — carries the new failure markers on the wire. |
| `shared/agent-protocol.ts` | L0. The op result types gain the additive failure discriminator; no `FLEET_PROTO` bump. |
| `server/src/coord/gitref.ts`, `server/src/transcript/tail.ts`, `server/src/sessionws.ts` | Consumers that must keep compiling as each read widens; each decides per condition or records why it still folds. |
| `server/test/io.test.ts`, `server/test/remote-io.test.ts`, `server/test/ioDoubles.ts`, `agent/test/fileops.test.ts` | The four suites that pin each new distinction and go red on its collapse. |
| `pwa/src/stores/session.ts`, `pwa/src/screens/SessionScreen.tsx` | The PWA end of the widened reads — a distinction that reaches the wire must reach the screen or be recorded as deliberately dropped. |
| `server/test/transcript-tail.test.ts`, `server/test/sessionws.test.ts`, `server/test/routes.test.ts`, `pwa/test/stores.test.ts`, `pwa/test/session-lifecycle.test.tsx` | Consumer-side pins that the widened reads did not change behaviour they were not meant to change. |

### Item 2 — the `MailDeliveryState` terminality audit (Tasks 20–26)

| File | Responsibility |
|---|---|
| `server/src/coord/store.ts` | Every `mail_deliveries` writer. Task 20 inserts the terminality docstring and the guard constant immediately after `:210`; every later `store.ts` line number in this item is the PRE-insertion number, ≈ +14 after. |
| `server/test/mail-hardening.test.ts` | `describe("terminality guards")` — the writer census scan lives here, not in `single-definition.test.ts`. |
| `server/test/coord-store.test.ts`, `server/test/mail-routes.test.ts` | Per-writer behaviour pins. |
| `pwa/src/session/MailStrip.tsx` | The delivery states as the operator sees them — a terminal state must render as terminal. |
| `server/src/coord/rundefs.ts` | The state definitions the writers and the strip both read. |
| `server/test/single-definition.test.ts` | Gains the one-definition rows Tasks 20/21 create. |

### Item 3 — the ledger procedure (Tasks 40–48)

| File | Responsibility |
|---|---|
| `ccd/ccrc-api` | **AGENT-FIRST.** `whoami`/`byId` refused unless identity is provably this pane's (`TMUX_PANE`), with `--by` as the documented door for contributors and CI. |
| `server/src/watch.ts` | `sweepLedgerReconcile` — the landing half moves off the bare `\bD-N\b` token match onto `definitionsIn`, the predicate its own orphan half eleven lines below already used. |
| `server/src/coord/ledger.ts` | L1 pure. `DEFINITION`, `GLOBAL_RE`, `definitionsIn`, `unallocatedDefinitions` — the shared predicate both halves now read. |
| `server/src/coord/schema.ts` | Migration `8: user_version 7 → 8` — un-lands rows whose recorded landing cannot be a definition, so the corrected sweep re-decides. Idempotent; must not touch the ~230 correct rows. |
| `server/src/coord/store.ts`, `server/src/coord/routes.ts` | `markLanded`'s terminality and the allocator route's floor answer. |
| `CLAUDE.md` | Gains what the floor MEANS — only-rises, publish-and-sweep burn, a hand-written number seals its band. The paragraph has never said it. |
| `docs/superpowers/specs/2026-08-21-account-provisioning-design.md` | The one LIVE-INSTRUCTION surface still carrying the old grep procedure in imperative present tense (`:892-896`). Merged plans are history and are left alone. |
| `ccd/coordinator-skill/references/peer-protocol.md` | **Task 42.** `:48`'s `body="${resp%\n'*}"` curl-era leftover, and `:124-129`'s documented allocate body that omits `byId` — the path the empty holders came from. |
| `ccd/coordinator-skill/SKILL.md`, `ccd/worker-skill/SKILL.md` | **Task 43.** Both identity blocks move onto `ccrc-api whoami`. Both verbatim-clause suites are baselined BEFORE the edit. |
| `server/test/ledger-sweep.test.ts`, `server/test/ledger-crosstree.test.ts`, `server/test/ledger-instruction.test.ts` **(new)**, `server/test/coord-db.test.ts`, `server/test/ccrc-api.test.ts`, `server/test/ccrc-api-closed.test.ts`, `server/test/deviation-refs.test.ts` | The pins: the live line must not stamp, a real definition still must, the migration is idempotent, and `byId` refuses off-pane. |

### Item 4 — the three inherited (Tasks 60–64)

| File | Responsibility |
|---|---|
| `ccd/ccrc-api` | **AGENT-FIRST.** `:32-38`'s "WHAT IS DELIBERATELY ABSENT" census names TWO ungated doors where there are FOUR (D-1168); `:24` and `:62` both say "seventeen" routes where the table holds eighteen. Task 63's 7→21-line replacement shifts Task 64's lines by +14. |
| `ccd/coordinator-skill/references/mail-envelope.md` | The repoint's other half. |
| `server/src/coord/routes.ts`, `server/src/coord/rundefs.ts` | The four ungated doors the census must now name correctly. |
| `server/test/coordinator-skill.test.ts`, `server/test/worker-skill.test.ts`, `server/test/box-token-census.test.ts`, `server/test/coord-pause-route.test.ts`, `server/test/peers-route.test.ts`, `server/test/coord-kickoff.test.ts`, `server/test/coord-fingerprint.test.ts` | Verbatim pins and the door census in both directions. |

### Item 5 — wave 7's twelve carries (Tasks 80–84)

| File | Responsibility |
|---|---|
| `server/src/coord/ledger.ts` | `FENCE = /^\s{0,3}(\`{3,}\|~{3,})/` — `\s` admits a TAB where the fence rule does not (C1, live). |
| `server/test/deviation-refs.test.ts`, `server/test/ledger-crosstree.test.ts` | D-1329's retraction reached `ledger.ts` only; both of these still assert what it retracted (`deviation-refs.test.ts:118`, `ledger-crosstree.test.ts:45`). |
| `docs/superpowers/plans/2026-09-02-program-leverage-wave7-f7.md` | Ten stale cardinals at eleven sites (the brief named seven). Dated, not deleted — a cardinal may stay only if it cannot move. |

## Work item 1 — the measured-read completion (D-114) (Tasks 1–8)

**Tasks 1–8. Branch `ws/quiet-meadow`, in this workspace's worktree, HEAD `5e9f650d` (= `origin/main`).**

> **ORDER, and the shifts it creates — this item had no such note until the assembled plan was
> audited.** Run 1 → 8. Task 2 inserts `MeasuredStat` after `io.ts:33`, replaces `:49` with five
> lines and adds `failureFor` above `:79`, so **Task 7's quoted `:46-47`, `:95-109` and
> `remote/io.ts:61-80` have moved by roughly +25 by the time Task 7 runs**; Task 1 rewrites
> `agent/src/server.ts`'s `statPayload` (`:162-170`), shifting **Task 6's `case 'readFrom'` /
> `case 'readB64'` (`:257-269`) by about +10**; and Task 3's new backlog field in `shared/api.ts`
> (`:2729-2745`) shifts everything below it. Anchor by the quoted text in every one of these
> cases. `shared/agent-protocol.ts` is the model: Task 6's replacement reproduces Task 1's edit
> verbatim and carries it forward, so the two compose instead of colliding.
Every anchor and every cardinal below was re-opened at HEAD on **2026-09-02** and is recorded with the command that
produced it. Anchors in this repo drift; the numbers here are measurements, not quotations from an earlier report.

---

### What is actually broken, measured

`server/src/io.ts`'s `FleetIO` (the interface block is **io.ts:41-64**, 9 members) grew ONE honest read in wave 1 —
`readFileMeasured` (**io.ts:81-88**), with `readFile` derived from it through `this` at **io.ts:90-93**, and its remote
half as the SINGLE READER of the `read` op's `absent?: true` wire field (**remote/io.ts:40-54**, contract stated at
**remote/io.ts:13-22**). Four members were left folding, and one of them does something worse than fold: it *lies*.

1. **THE HEADLINE — the agent's `stat` op republishes every errno as PROVEN ABSENCE.**
   `statPath` (**agent/src/fileops.ts:91-96**) catches every error alike; the op handler at
   **agent/src/server.ts:276-282** sends `send(ws, ok(req.id, result ?? { missing: true }));` — the fold is verbatim at
   **agent/src/server.ts:280**. `missing: true` is the wire's absence marker (schema comment,
   **shared/agent-protocol.ts:106**), and `remote/io.ts:92-102` reads it as `null` = "not there". So an EACCES, an
   ENOTDIR, an ELOOP or an EIO on the fleet host arrives at the server as *proof the path is gone*.
   The tree already knows: **server/src/coord/routes.ts:1668-1673** says `projects[]` replaces a `projectKnown`
   boolean because "the obvious fix, one `io.stat` of the project dir, is built on the call the tree already knows lies
   (D-114: the agent's stat answers EACCES as `{missing:true}`)", and **server/test/peers-route.test.ts:5** repeats it
   in the file header. A shipped route declined its obvious design over this.

2. **`readFileB64`'s THIRD condition.** The agent caps at `MAX_READ_B64_BYTES` (**agent/src/fileops.ts:61**, used at
   **:70**) and folds over-cap into the same `null` as missing and unreadable. `localIO` has **no cap at all**
   (**server/src/io.ts:107-109**). `ccd clip` `mv -f`s an image of any size into `$HOME/.cc-clips/$id`
   (**ccd/ccd:13414** and **:13416**) with no size check, while the upload route refuses >12 MB with 413
   (**server/src/server.ts:1803-1804**) — so an over-cap clip is REACHABLE, and the same file serves **200 in `local`
   mode and 404 in `remote`**, which is the live standing config.

3. **`readFileFrom` swallows twice** (**server/src/io.ts:95-105**: `catch { return null; }` at **:100** and **:104**),
   and its remote half folds five conditions (**remote/io.ts:61-70**). Its `{ data: '', size }` arm at **io.ts:102** is a
   POSITIVE answer (cursor at EOF) that must never join them.

4. **The seam consumers that demonstrably behave differently.** `readBacklog` (**server/src/transcript/tail.ts:17-32**)
   stats at **:18** and reads at **:21**; `sessionws.ts` takes a SECOND stat of the same path at **:564**
   (`const missing = (await this.deps.io.stat(r.file)) === null;`) and ships it as the `backlog` frame's `missing`
   (**sessionws.ts:569**), which the PWA renders as a banner naming the path
   (**pwa/src/screens/SessionScreen.tsx:305-317**, store field at **pwa/src/stores/session.ts:83**). The precedent for
   the fix is already ON that frame: `searchComplete` (**shared/api.ts:2738-2743**) was added for exactly this reason on
   the `readdir` side and its docstring says `missing: true` with `searchComplete: false` is "can't read the fleet host
   right now" — NEVER "no messages yet". And the highest-stakes stat consumer is `readBranchTip`'s fail-shut proof at
   **server/src/coord/gitref.ts:90-102**: if that stat lies "missing", a possibly-stale `packed-refs` tip
   (**gitref.ts:103-112**) is allowed to settle a wave close.

#### Cardinals (each with the command that produced it, all run 2026-09-02 at `5e9f650d`)

| Number | What | Command |
|---|---|---|
| **15** | `readFile`/`readFileB64`/`readFileFrom` call sites in shipped source | `grep -rnE "\.(readFile\|readFileB64\|readFileFrom)\(" --include=*.ts server/src agent/src pwa/src shared \| wc -l` |
| **17** | `io.stat` call sites in `server/src` | `grep -rn "\.stat(" --include=*.ts server/src \| grep -v "async stat" \| wc -l` |
| **1** | `readFileB64` CALLERS in shipped source — `server/src/server.ts:1826`, and nothing else | `grep -rn "readFileB64" --include=*.ts . \| grep -v node_modules` → 11 hits: 5 in source (`io.ts:25` docstring, `:47` interface, `:107` impl, `remote/io.ts:72` impl, `server.ts:1826` the one caller) and 6 in tests |
| **2** | real `FleetIO` implementations — `io.ts:80`, `remote/io.ts:29` | same grep, plus `grep -rn "FleetIO" --include=*.ts pwa/src shared ccd agent` returns no third |
| **2 + 1** | `MAX_READ_B64_BYTES` hits: 2 code (`fileops.ts:61`, `:70`) + 1 prose (`io.ts:47`) | `grep -rn "MAX_READ_B64_BYTES" --include=*.ts . \| grep -v node_modules` |
| **5** | test doubles overriding `readFile:` directly (ledgerseed ×4, ledger-sweep ×1) | `grep -rn "readFile:" --include=*.ts server/test` |
| **10 / 0** | `chmodSync` calls / `skipIf` guards in `coord-fingerprint.test.ts` (D-116 still open) | `grep -c chmodSync server/test/coord-fingerprint.test.ts; grep -c skipIf …` |
| **25** | cases in `agent/test/malformed.test.ts`'s array (**:58-84**), incl. `frobnicate` at **:83** | `python3` count of `{ name:` in the literal, minus the one in the `Array<{ name: … }>` annotation |
| **0** | call sites that destructure a read method off a `FleetIO` (so the `this`-derivation's receiver is never lost) | `grep -rnE "const \{[^}]*(readFile\|readdir\|stat)" --include=*.ts server/src server/test agent/src pwa/src shared` → only 2 `readFileSync` from `node:fs` and one unrelated `status` destructure |
| **210 / 225 / 114** | lines in `server/src/io.ts` / `server/src/remote/io.ts` / `agent/src/fileops.ts` | `wc -l` |
| **185 / 179 / 212 / 73** | lines in `io.test.ts` / `remote-io.test.ts` / `agent/test/fileops.test.ts` / `ioDoubles.ts` | `wc -l` |

**Errno facts measured, not assumed** (`node -e` against a scratch dir, uid 1000, 2026-09-02):
`stat("<a-file>/child")` → **ENOTDIR**; `stat("<missing>")` → **ENOENT**; `stat("<dir>")` → **OK, size 4096**;
`readFile("<dir>")` → **EISDIR**; `createReadStream("<dir>")` → **error EISDIR**. These are the root-safe fixtures this
section uses instead of `chmod 000` (see the root-runner rule below).

---

### Standing constraints for every task in this item

- **AGENT-FIRST DEPLOY, no exceptions.** This item changes what the AGENT EMITS and what the SERVER READS.
  `bash deploy/deploy.sh agent <host>` **before** `bash deploy/deploy.sh`. Reversed, the new server runs against an old
  agent for the window and **every new measured read answers its fail-shut value**: every stat reads `unreadable`, every
  measured b64 read reads `unreadable`, every measured range read reads `unreadable`. That is the safe direction and it
  is still a visible degradation (banners say "can't read the fleet host", missing clips answer 502, packed-branch tips
  answer `tip-unmeasurable`) — so the order is not a preference. `local` mode has no window at all: `localIO`'s measured
  reads are exact.
- **The agent cannot import the server's types.** `agent/tsconfig.json` includes only `src/**` + `../shared/**`
  (stated in the module docstring at **agent/src/fileops.ts:16-32**), and the reason union is deliberately NOT in
  `shared/` because that is the PWA's bundle path. Every new agent-side result type is LOCAL, copying the
  `ReadResult` (**fileops.ts:48**) / `WriteResult` (**fileops.ts:98**) precedent.
- **`server/src/remote/io.ts:40-54` is the template, copied verbatim in structure**: ONE reader per (op, field) pair,
  POSITIVE marker only, spread only when true, omission fails SHUT to `unreadable`, rejected promise → `unreadable`.
  Note `absent` will now ride three ops; "one reader per field" means one reader per **(op, field)** — `read`'s
  `absent` is read only by `readFileMeasured`, `stat`'s only by `statMeasured`, `readFrom`'s only by
  `readFileFromMeasured`.
- **NO new ops, NO `FLEET_PROTO` bump.** Every marker rides an existing RESPONSE. The no-new-op rule is already
  MECHANISED: `agent/test/malformed.test.ts:83`'s `frobnicate` case pins that an unknown op answers `bad-request`
  (`validateReq`'s `default: return null` at **agent/src/server.ts:417-418**, the send at **:620**). Extend existing
  ops; do not add one. `FLEET_PROTO`/`FLEET_PROTO_MIN` (**shared/api.ts**) govern the PWA↔server pair, not this link.
- **The vacuous-double trap.** Five doubles override `readFile:` directly, against `ioDoubles.ts`'s governing rule:
  `ledgerseed.test.ts:99, :115, :150, :206` and `ledger-sweep.test.ts:128`. They work only because their subject
  (`readLedgerDocs`) still calls `io.readFile`. **No task in this item migrates ledgerseed or ledger-sweep**, so those
  five stay valid — and no task may migrate them without converting the doubles in the SAME commit, or they go silently
  vacuous (override never called, `localIO` answers honestly, test still green).
- **The root-runner trap.** `coord-fingerprint.test.ts` has 10 `chmodSync` calls and 0 `skipIf` (D-116, open). **No new
  test in this item uses `chmod`** — every "unreadable" fixture is ENOTDIR/EISDIR, which deny root too. If a later
  revision does add one, it carries `it.skipIf(process.getuid?.() === 0)` the way **server/test/io.test.ts:43** does.
- **No text-scanning guard is added by this item, deliberately** — every guard below is behavioural, so the
  self-matching-needle hazard (`server/test/auth-gate.test.ts`'s `claim('in one loop ' + 'over all')` split) does not
  arise. That is the standing "structural over textual" ruling recorded at **agent/src/whitelist.ts:104-107**.
- **Suites run from INSIDE the package**, foreground, `timeout ≥ 600000`:
  `cd server && ./node_modules/.bin/vitest run test/x.test.ts`. Never bare `npx vitest`.

---

### Task 1: The agent's `stat` op stops republishing every errno as proven absence

**Files:**
- Modify `agent/src/fileops.ts:91-96` (`statPath`) — add `StatResult` + `statMeasured`, `statPath` deleted
  (`grep -rn "statPath" agent/src` → 3 hits: the definition, the import at `server.ts:32`, the single call at
  `server.ts:279` — all three replaced here; nothing in `agent/test` imports `fileops.ts` at all —
  `grep -rn "fileops" agent/test` → empty).
- Modify `agent/src/server.ts:32` (import), add `statPayload` after `readPayload` (**:162-170**), rewrite
  `case 'stat'` (**:276-282**).
- Modify `shared/agent-protocol.ts:106` — the response schema comment.
- Test `agent/test/fileops.test.ts` — two cases appended after the existing stat pair (**:147-163**).

**Interfaces:**
- Produces (agent-local): `export type StatResult = { ok: true; mtimeMs: number; size: number } | { ok: false; absent: boolean }`
  and `export async function statMeasured(p: string): Promise<StatResult>`.
- Produces (wire, additive): `stat → {mtimeMs, size} | {missing: true, absent?: true}`.
- Consumes: nothing new.

**Why:** `statPath` catches every errno and `server.ts:280`'s `result ?? { missing: true }` hands all of them to the
server as the wire's proven-absence marker. The server cannot narrow a distinction it never received, so the fix must
start here. Polarity is `absent?: true` — a NEW positive marker beside an UNTOUCHED `missing: true` — because an older
agent then omits it and a newer server reads a bare `missing: true` as UNMEASURED, which is fail-shut. The inverse
(`unreadable?: true`) would make an old agent's every bare `missing: true` read as proof of absence, which is the
current defect with extra steps.

- [ ] **Step 1: Write the failing test** — append to `agent/test/fileops.test.ts` after **:163**:

```ts
  it('stat marks a genuinely missing whitelisted path with absent:true', async () => {
    await open();
    const res = await client!.req<Res>(nextId(), {
      op: 'stat', path: path.join(fixture!.home, '.cc-limits', 'nope-absent'),
    });
    expect(res).toMatchObject({ ok: true, missing: true, absent: true });
  });

  it('stat THROUGH a file (ENOTDIR) answers missing:true with NO absent key — unmeasured is not absent', async () => {
    await open();
    // The whole of D-114 in one case. `claude.json` is a FILE, so the kernel
    // refuses to walk THROUGH it: ENOTDIR, not ENOENT. Today this op answers
    // `{missing:true}` — byte-identical to a genuine ENOENT — and the server
    // reads that as proof the path is gone.
    //
    // ENOTDIR rather than `chmod 000` deliberately: chmod does not deny root,
    // so a root runner would silently assert the wrong thing (D-116, still
    // open at server/test/coord-fingerprint.test.ts:100/:632/:650/:701, which
    // is why nothing new here uses chmod).
    const file = path.join(fixture!.home, '.cc-limits', 'claude.json');
    writeFileSync(file, 'abcd');
    const res = await client!.req<Res>(nextId(), { op: 'stat', path: path.join(file, 'child') });
    expect(res).toMatchObject({ ok: true, missing: true });
    expect(res).not.toHaveProperty('absent');
  });
```

- [ ] **Step 2: Run it and watch it fail** — Run: `cd agent && ./node_modules/.bin/vitest run test/fileops.test.ts`
      Expected: the first case FAILS with
      `expected { ok: true, missing: true } to match object { ok: true, missing: true, absent: true }`
      (the marker does not exist yet). The second case PASSES already — it is the pin that the fix must not break, and it
      only becomes load-bearing once the marker exists. Both are stated here so Step 5's mutation table has both poles.

- [ ] **Step 3: Implement** — `agent/src/fileops.ts`, replacing **:91-96**:

```ts
/** `statMeasured`'s result — the `stat` op's half of `ReadResult` above, and
 *  a LOCAL type for the same reason (this side cannot import
 *  `server/src/io.ts`, and the reason union stays out of `shared/` because
 *  that is the PWA's bundle path).
 *
 *  `absent` is true ONLY on a proven ENOENT. Every other errno — EACCES,
 *  ENOTDIR, ELOOP, EIO — and every non-errno throw leaves it false, meaning
 *  "this path may well be there and this box could not measure it". Before
 *  this type, all of them left through `server.ts`'s `?? { missing: true }`
 *  wearing the wire's proven-absence marker (D-114).
 *
 *  SAME DANGLING-SYMLINK RESIDUAL as `ReadResult`, and it must be stated here
 *  too: `stat` follows the link, the TARGET's ENOENT is what throws, and
 *  `absent` comes back true for a name still in its directory listing. Not
 *  closed with an `lstat` ladder, for the reason recorded there. */
export type StatResult =
  | { ok: true; mtimeMs: number; size: number }
  | { ok: false; absent: boolean };

export async function statMeasured(p: string): Promise<StatResult> {
  try {
    const s = await stat(p);
    return { ok: true, mtimeMs: s.mtimeMs, size: s.size };
  } catch (e) {
    return { ok: false, absent: (e as NodeJS.ErrnoException).code === 'ENOENT' };
  }
}
```

`agent/src/server.ts` — import at **:32** becomes:

```ts
import { readB64, readFrom, listDir, readWhole, statMeasured, writeB64, type ReadResult, type StatResult } from './fileops.js';
```

new helper immediately after `readPayload` (**:170**):

```ts
/** Builds the `stat` op's wire payload from `statMeasured`'s result.
 *  `missing: true` keeps its EXACT pre-existing meaning — "no {mtimeMs,size}
 *  for you", absent and unmeasurable alike — so an older server's
 *  `r.missing === true ? null : …` reader is unaffected. `absent` is spread
 *  in ONLY when the failure was a proven ENOENT, never sent as
 *  `absent: false`, matching `{mtimeMs,size} | {missing: true, absent?: true}`
 *  in `shared/agent-protocol.ts`. A newer server reads a bare `missing: true`
 *  as UNMEASURED — which is what makes an OLDER agent's every stat failure
 *  fail SHUT instead of masquerading as proof the path is gone (D-114). */
function statPayload(r: StatResult): { mtimeMs: number; size: number } | { missing: true; absent?: true } {
  if (r.ok) return { mtimeMs: r.mtimeMs, size: r.size };
  return { missing: true, ...(r.absent ? { absent: true as const } : {}) };
}
```

and `case 'stat'` (**:276-282**):

```ts
    case 'stat': {
      const p = await checkPath(req.path, ctx.cfg, 'read');
      if (!p) { send(ws, fail(req.id, 'forbidden')); return; }
      send(ws, ok(req.id, statPayload(await statMeasured(p))));
      return;
    }
```

`shared/agent-protocol.ts:106` — the schema comment's `stat` clause:

```ts
// readB64 → {dataB64: string|null}; readdir → {names: string[]|null}; stat → {mtimeMs, size}|{missing: true, absent?: true};
```

- [ ] **Step 4: Run it and watch it pass** — `cd agent && ./node_modules/.bin/vitest run test/fileops.test.ts`, then
      the whole agent suite: `cd agent && npm run test`. `agent/test/malformed.test.ts`'s 25 cases must stay green
      (nothing here touches `validateReq`), and `agent/test/fileops.test.ts:147-157`'s existing
      `toMatchObject({ ok: true, missing: true })` still passes because `toMatchObject` is a subset match.

- [ ] **Step 5: MUTATION CHECK** — three, each reverted:
  1. Delete the ` ...(r.absent ? { absent: true as const } : {})` spread from `statPayload`.
     Expect RED on *stat marks a genuinely missing whitelisted path with absent:true* with
     `expected { ok: true, missing: true } to match object { ok: true, missing: true, absent: true }`.
     Right reason: the positive marker is gone, so nothing can ever prove absence.
  2. Change `absent: (e as NodeJS.ErrnoException).code === 'ENOENT'` to `absent: true`.
     Expect RED on *stat THROUGH a file (ENOTDIR)* with
     `expected { ok: true, missing: true, absent: true } not to have property "absent"`.
     Right reason: a non-ENOENT errno claimed proof — the exact lie being closed.
  3. Change it to `absent: false`. Expect RED on case 1's assertion again, for the opposite reason (a proven ENOENT
     refused to say so). Together 2 and 3 pin the errno branch in BOTH directions, so neither constant survives.

- [ ] **Step 6: Commit**
      `git commit -am "fix(agent): stat reports a proven ENOENT as absent, and stops calling every other errno missing (D-1396)"`

---

### Task 2: `statMeasured` on the port — one reader of the marker, `stat` derived through `this`

**Files:**
- Modify `server/src/io.ts`: `ReadFailure` docstring (**:5-21**), new `MeasuredStat` type after `MeasuredRead`
  (**:33**), new interface member beside `stat` (**:49**), `localIO.statMeasured` + derived `stat` replacing
  **:115-120**, and a new module-local `failureFor` used by `readFileMeasured` (**:81-88**) as well.
- Modify `server/src/remote/io.ts`: docstring (**:13-22**), `statMeasured` + derived `stat` replacing **:92-102**.
- Modify `server/test/ioDoubles.ts` (73 lines) — add `degradedStatIO` / `absentStatIO`.
- Test `server/test/io.test.ts` (185 lines) and `server/test/remote-io.test.ts` (179 lines).

**Interfaces:**
- Produces: `export type MeasuredStat = { ok: true; mtimeMs: number; size: number } | { ok: false; reason: ReadFailure }`;
  `statMeasured(path: string): Promise<MeasuredStat>` on `FleetIO`;
  `export function degradedStatIO(predicate: (path: string) => boolean): FleetIO`;
  `export function absentStatIO(predicate: (path: string) => boolean): FleetIO`.
- Consumes: the `stat` op's `absent?: true` (Task 1), in exactly one place.

**Why:** Task 1 put the fact on the wire; nothing reads it yet. `remote/io.ts:92-102` folds three facts to one `null`
(`missing:true`, a malformed response, a rejected request) and `localIO`'s `stat` (**:115-120**) folds every errno.
Deriving `stat` from `statMeasured` through `this` — the pattern proven at **io.ts:90-93** and **remote/io.ts:56-59** —
means the 17 existing `io.stat` call sites keep byte-identical behaviour while the new fact becomes available, and
`ioDoubles.ts`'s governing rule (override the MEASURED method only, spread `localIO` for the derivation) extends to
`stat` for free. Reusing `ReadFailure` rather than minting a second two-member union keeps the vocabulary enumerated
once.

- [ ] **Step 1: Write the failing test** — append to `server/test/io.test.ts` after **:112**:

```ts
describe('localIO.statMeasured', () => {
  it('reports {ok:true, mtimeMs, size} for a real file', async () => {
    const file = tmpFile();
    writeFileSync(file, 'abcd');
    const r = await localIO.statMeasured(file);
    expect(r.ok).toBe(true);
    expect(r).toMatchObject({ ok: true, size: 4 });
  });

  it('a missing path (ENOENT) reads as {ok:false, reason:"absent"}', async () => {
    const dir = mktempDir();
    expect(await localIO.statMeasured(path.join(dir, 'nope'))).toEqual({ ok: false, reason: 'absent' });
  });

  it('a path THROUGH a file (ENOTDIR, not ENOENT) reads as {ok:false, reason:"unreadable"}', async () => {
    const file = tmpFile();
    writeFileSync(file, 'abcd');
    expect(await localIO.statMeasured(path.join(file, 'child'))).toEqual({ ok: false, reason: 'unreadable' });
  });

  it('stat DERIVES from statMeasured — both failure reasons still collapse to null for every existing caller', async () => {
    const file = tmpFile();
    writeFileSync(file, 'abcd');
    expect(await localIO.stat(path.join(path.dirname(file), 'nope'))).toBeNull();
    expect(await localIO.stat(path.join(file, 'child'))).toBeNull();
    // And the derivation is real, not a copy: a double that overrides ONLY
    // the measured method must reach the derived one (ioDoubles.ts's rule).
    const io: FleetIO = { ...localIO, statMeasured: async () => ({ ok: false, reason: 'unreadable' }) };
    expect(await io.stat(file)).toBeNull();
  });
});
```

(`io.test.ts` gains `import { localIO, type FleetIO } from '../src/io.js';` at **:5**.)

Append to `server/test/remote-io.test.ts` — inside the real-agent describe, after **:78**:

```ts
  describe('statMeasured', () => {
    it('a real file reads as {ok:true, …}, a missing one as {ok:false, reason:"absent"}', async () => {
      const f = await connected();
      const file = path.join(fixture!.home, '.cc-sessions', 'sm.txt');
      writeFileSync(file, 'abcd');
      expect(await f.io.statMeasured(file)).toMatchObject({ ok: true, size: 4 });
      expect(await f.io.statMeasured(path.join(fixture!.home, '.cc-sessions', 'nope.txt')))
        .toEqual({ ok: false, reason: 'absent' });
    });

    it('a path THROUGH a file (ENOTDIR) reads as "unreadable", NEVER "absent" — the D-114 case, end to end', async () => {
      const f = await connected();
      const file = path.join(fixture!.home, '.cc-sessions', 'sm2.txt');
      writeFileSync(file, 'abcd');
      expect(await f.io.statMeasured(path.join(file, 'child'))).toEqual({ ok: false, reason: 'unreadable' });
    });

    it('a path outside every whitelist reads as "unreadable", NEVER "absent"', async () => {
      const f = await connected();
      const outside = path.join(fixture!.projectsRoot, '..', 'definitely-outside.txt');
      expect(await f.io.statMeasured(outside)).toEqual({ ok: false, reason: 'unreadable' });
    });
  });
```

and to the stub-client describe, after **:178**:

```ts
  it('an OLDER AGENT — {missing:true} with no `absent` key — reads as "unreadable", NEVER "absent"', async () => {
    const io = createIo(clientAnswering({ missing: true }));
    expect(await io.statMeasured('/whatever/missing.txt')).toEqual({ ok: false, reason: 'unreadable' });
  });

  it('a modern agent answering {missing:true, absent:true} reads as "absent"', async () => {
    const io = createIo(clientAnswering({ missing: true, absent: true }));
    expect(await io.statMeasured('/whatever/missing.txt')).toEqual({ ok: false, reason: 'absent' });
  });

  it('a rejected stat request (forbidden/disconnected/timeout) reads as "unreadable"', async () => {
    const io = createIo(rejectingClient(new Error('forbidden')));
    expect(await io.statMeasured('/whatever/file.txt')).toEqual({ ok: false, reason: 'unreadable' });
  });
```

- [ ] **Step 2: Run it and watch it fail** — Run:
      `cd server && ./node_modules/.bin/vitest run test/io.test.ts test/remote-io.test.ts`
      Expected: FAIL at compile/type level first —
      `TS2339: Property 'statMeasured' does not exist on type 'FleetIO'` — and at runtime
      `TypeError: localIO.statMeasured is not a function`. The member does not exist yet.

- [ ] **Step 3: Implement** — `server/src/io.ts`. Extend the `ReadFailure` docstring's first sentence (**:5-9**) so the
      vocabulary's second user is declared where it is defined:

```ts
/** Why a read couldn't produce content — and, since `MeasuredStat` below,
 *  why a `stat` couldn't produce {mtimeMs,size} either: ONE vocabulary for
 *  both, because they are the same two facts. `absent` means the path
 *  genuinely does not exist (ENOENT); `unreadable` means everything else …
```

Add after `MeasuredRead` (**:33**):

```ts
/** A `stat` that distinguishes its own two failure modes instead of
 *  collapsing both to `null`, exactly as `MeasuredRead` does for reads — and
 *  for a sharper reason: the agent's `stat` op used to answer EACCES/ENOTDIR
 *  as `{missing:true}`, so the wire's absence marker was already a LIE for
 *  every non-ENOENT failure (D-114). `stat` derives from this. THE GOVERNING
 *  RULE applies unchanged: `ok`/`absent` are positive answers that
 *  short-circuit, `unreadable` falls back to exactly the evidence the site
 *  already used. */
export type MeasuredStat =
  | { ok: true; mtimeMs: number; size: number }
  | { ok: false; reason: ReadFailure };
```

Interface member, replacing **:49**:

```ts
  /** Distinguishes "genuinely does not exist" from "could not be measured".
   *  `stat` derives from this; see `MeasuredStat` above for why the wire's
   *  own absence marker could not be trusted before this existed. */
  statMeasured(path: string): Promise<MeasuredStat>;
  stat(path: string): Promise<{ mtimeMs: number; size: number } | null>;   // null on ANY failure — absent and unreadable both collapse here; use statMeasured to tell them apart
```

Add the one-place errno rule above `localIO` (**:79**) and use it in BOTH measured readers, so the ternary is written
once rather than three times:

```ts
/** The ONE place an errno becomes a `ReadFailure`. Only a proven ENOENT may
 *  answer `absent`; every other errno — and a non-errno throw, which carries
 *  no `code` at all — is `unreadable`. */
const failureFor = (err: unknown): ReadFailure =>
  (err as NodeJS.ErrnoException).code === 'ENOENT' ? 'absent' : 'unreadable';
```

`readFileMeasured`'s catch (**:84-87**) becomes `catch (err) { return { ok: false, reason: failureFor(err) }; }`, and
**:115-120** becomes:

```ts
  async statMeasured(p) {
    try {
      const s = await stat(p);
      return { ok: true, mtimeMs: s.mtimeMs, size: s.size };
    } catch (err) {
      return { ok: false, reason: failureFor(err) };
    }
  },

  async stat(p) {
    const r = await this.statMeasured(p);
    return r.ok ? { mtimeMs: r.mtimeMs, size: r.size } : null;
  },
```

`server/src/remote/io.ts` — extend the docstring at **:13-22** with one sentence, then replace **:92-102**:

```ts
 * `statMeasured` is the second such reader, on the `stat` op's `absent?:
 * true`, and it is the reason D-114 could be closed at all: a bare
 * `missing: true` is what an OLDER agent sends for EVERY stat failure and
 * what a NEWER one sends for EACCES/ENOTDIR/ELOOP, so it means UNMEASURED,
 * never proof. Only `absent: true` proves.
```

```ts
    async statMeasured(path) {
      try {
        const res = await client.request({ t: 'req', op: 'stat', path });
        const r = res as { missing?: unknown; absent?: unknown; mtimeMs?: unknown; size?: unknown };
        if (typeof r.mtimeMs === 'number' && typeof r.size === 'number') {
          return { ok: true, mtimeMs: r.mtimeMs, size: r.size };
        }
        return { ok: false, reason: r.absent === true ? 'absent' : 'unreadable' };
      } catch {
        // Disconnected / timeout / forbidden / bad-request — none of these is
        // proof the path is absent, same reasoning as `readFileMeasured`.
        return { ok: false, reason: 'unreadable' };
      }
    },

    async stat(path) {
      const r = await this.statMeasured(path);
      return r.ok ? { mtimeMs: r.mtimeMs, size: r.size } : null;
    },
```

*(Behaviour of the derived `stat` is unchanged: today's `if (r.missing === true) return null;` followed by the two
`typeof` guards answers null for exactly the same responses this answers null for.)*

`server/test/ioDoubles.ts` — append, keeping the file's governing-rule shape:

```ts
/**
 * The `stat` half of `degradedReadIO`: every `statMeasured` whose path
 * matches `predicate` answers `{ ok: false, reason: 'unreadable' }` — a path
 * that IS there and could not be measured, which is what one dropped
 * agent-WS round trip produces (and what an EACCES produced silently before
 * D-114 was closed). Overrides `statMeasured` ONLY: `localIO.stat` derives
 * from it through `this`, so spreading `localIO` carries the derivation and
 * the two can never drift.
 */
export function degradedStatIO(predicate: (path: string) => boolean): FleetIO {
  return {
    ...localIO,
    statMeasured: async (p) => (predicate(p) ? { ok: false, reason: 'unreadable' } : localIO.statMeasured(p)),
  };
}

/** The `stat` half of `absentReadIO`: a PROVEN ENOENT for matching paths,
 *  whatever is actually on disk — so a test can model a path the fixture
 *  seeded and a race then unlinked. */
export function absentStatIO(predicate: (path: string) => boolean): FleetIO {
  return {
    ...localIO,
    statMeasured: async (p) => (predicate(p) ? { ok: false, reason: 'absent' } : localIO.statMeasured(p)),
  };
}
```

- [ ] **Step 4: Run it and watch it pass** — `cd server && ./node_modules/.bin/vitest run test/io.test.ts test/remote-io.test.ts`,
      then the suites that own the 17 existing `io.stat` callers:
      `cd server && ./node_modules/.bin/vitest run test/transcript-ladder.test.ts test/sessionws.test.ts test/coord-fingerprint.test.ts test/watch.test.ts`.
      All must stay green — the derivation makes this a no-op for them.

- [ ] **Step 5: MUTATION CHECK** — two, each reverted:
  1. In `remote/io.ts`'s `statMeasured`, change `r.absent === true ? 'absent' : 'unreadable'` to
     `r.missing === true ? 'absent' : 'unreadable'`.
     Expect RED on *an OLDER AGENT — {missing:true} with no `absent` key* with
     `expected { ok: false, reason: 'absent' } to deeply equal { ok: false, reason: 'unreadable' }`.
     Right reason: omission stopped failing shut — the reader started trusting a field an old agent sends for
     everything.
  2. In `io.ts`, change `failureFor` to `() => 'absent'`.
     Expect RED on *a path THROUGH a file (ENOTDIR, not ENOENT)* with
     `expected { ok: false, reason: 'absent' } to deeply equal { ok: false, reason: 'unreadable' }` **and** on
     `localIO.readFileMeasured`'s existing EISDIR case at **io.test.ts:36-41** — one mutation, two files' worth of red,
     which is the point of having one errno rule instead of three.

- [ ] **Step 6: Commit**
      `git commit -am "feat(server): statMeasured on FleetIO — one reader of the stat marker, stat derived (D-1396, D-1397)"`

---

### Task 3: The `backlog` frame stops asserting an absence nobody measured

**Files:**
- Modify `server/src/transcript/tail.ts:17-32` (`readBacklog`) — returns a named result, one stat instead of a boolean.
- Modify `server/src/sessionws.ts:563-574` — delete the second stat at **:564**, carry the new fact onto the frame at
  **:569**.
- Modify `shared/api.ts:2729-2745` — one new OPTIONAL field on the `backlog` frame plus its paragraph.
- Test `server/test/transcript-tail.test.ts:33-73` (the `toEqual` at **:48** must be updated — it is exact) and
  `server/test/sessionws.test.ts` (new case after **:1034**).

**Interfaces:**
- Produces: `export interface BacklogRead { events: ChatEvent[]; offset: number; missing: boolean; measured: boolean }`
  and `readBacklog(io, file, lastN): Promise<BacklogRead>`;
  wire: `{ type: 'backlog'; …; fileMeasured?: boolean }`.
- Consumes: `io.statMeasured` (Task 2).

**Why:** `sessionws.ts:564` derives the frame's `missing` from `io.stat(...) === null`, which in remote mode covers a
dropped round trip, a `forbidden` path, and — until Task 1 — every non-ENOENT errno on the fleet host. The PWA renders
that as "Can't find this session's transcript" over a path that is sitting right there. The precedent for the shape is
already on this very frame: `searchComplete` (**shared/api.ts:2738-2743**) exists because remote `readdir` returns null
for a missing directory, a forbidden path and a disconnected agent alike, and "this build refuses to render that
ambiguity as a confident empty chat." Copy it. Consolidating onto ONE stat also removes a real TOCTOU: today
`sessionws.ts:564` and `tail.ts:18` stat the same path twice and can disagree.

- [ ] **Step 1: Write the failing test** — update `server/test/transcript-tail.test.ts:46-49` and add one case:

```ts
  it('missing file returns empty events, offset 0, and says so as a MEASUREMENT', async () => {
    const out = await readBacklog(localIO, path.join(tmpdir(), 'ccrc-definitely-missing', 'x.jsonl'), 50);
    expect(out).toEqual({ events: [], offset: 0, missing: true, measured: true });
  });

  it('a transcript whose stat cannot be MEASURED is missing-but-unmeasured, never a measured absence', async () => {
    // The file is really there. Only the stat is unmeasurable — one dropped
    // agent round trip, or (before D-114) an EACCES anywhere on the way to
    // it. `missing` keeps its old wire meaning; `measured` is the new fact
    // that stops the PWA rendering this as "there is no transcript".
    const file = tmpFile();
    writeFileSync(file, userLine('u1', 'one'));
    const io = degradedStatIO((p) => p === file);
    expect(await readBacklog(io, file, 50)).toEqual({ events: [], offset: 0, missing: true, measured: false });
  });
```

(`transcript-tail.test.ts` gains `import { degradedStatIO } from './ioDoubles.js';`.)

And in `server/test/sessionws.test.ts`, after **:1034**:

```ts
  it('a transcript that is RIGHT THERE but unmeasurable is not reported as a found-nothing search', async () => {
    // The exact D-114 shape at the delivery seam: the resolver's every stat
    // of the .jsonl is unmeasurable, so the ladder falls to `fallback` with
    // complete: true (its readdirs all worked) and the frame would say
    // `missing: true, searchComplete: true` — which the PWA renders as
    // "Can't find this session's transcript" about a file the fixture just
    // wrote. `fileMeasured: false` is the sentence that fact deserves.
    const home = mkTmp('ccrc-unmeasured-backlog-');
    seedRoster(home);
    seed(home);
    const io = degradedStatIO((p) => p.endsWith(`${UUID_A}.jsonl`));
    const frames: any[] = [];
    const stream = new SessionStream(mkLadderDeps(home, io), new Bus(), ID, (m) => frames.push(m));
    try {
      await stream.start();
      const backlog = frames.find((f) => f.type === 'backlog');
      expect(backlog).toBeDefined();
      expect(backlog.file).toBe(path.join(home, '.claude-a', 'projects', MUNGED, `${UUID_A}.jsonl`));
      expect(backlog.missing).toBe(true);        // unchanged wire meaning
      expect(backlog.searchComplete).toBe(true); // the SEARCH did finish
      expect(backlog.fileMeasured).toBe(false);  // the FILE was never measured
    } finally {
      stream.stop();
      rmSync(home, { recursive: true, force: true });
    }
  });
```

(`sessionws.test.ts:23` gains `degradedStatIO` in the existing `./ioDoubles.js` import.)

- [ ] **Step 2: Run it and watch it fail** — Run:
      `cd server && ./node_modules/.bin/vitest run test/transcript-tail.test.ts test/sessionws.test.ts`
      Expected: FAIL — `expected { events: [], offset: 0 } to deeply equal { events: [], offset: 0, missing: true, measured: true }`
      in the first file, and `expected undefined to be false` (`backlog.fileMeasured`) in the second.

- [ ] **Step 3: Implement** — `server/src/transcript/tail.ts`, replacing **:13-32**:

```ts
/**
 * What `readBacklog` answers. THREE facts, not one:
 *   - `events`/`offset` as before;
 *   - `missing` — no {mtimeMs,size} came back for `file`. Byte-identical in
 *     meaning to `io.stat(file) === null`, which is what the `backlog` frame's
 *     own `missing` was derived from at `sessionws.ts:564` before this type
 *     existed, so the wire field's meaning does not move;
 *   - `measured` — false when that failure was NOT a proven absence. An
 *     UNMEASURED absence rendered as a confident empty chat is the defect
 *     D-114 closes, and `searchComplete` on the same frame already refuses it
 *     on the readdir side (`shared/api.ts`'s `backlog` docstring).
 */
export interface BacklogRead {
  events: ChatEvent[];
  offset: number;
  missing: boolean;
  measured: boolean;
}

/**
 * Return the last `lastN` events plus the end-of-file byte offset (where a
 * tailer should resume), reading only the file's tail, and say whether the
 * answer rests on a completed measurement.
 */
export async function readBacklog(io: FleetIO, file: string, lastN: number): Promise<BacklogRead> {
  const st = await io.statMeasured(file);
  if (!st.ok) return { events: [], offset: 0, missing: true, measured: st.reason === 'absent' };
  if (st.size === 0) return { events: [], offset: 0, missing: false, measured: true };
  const start = Math.max(0, st.size - BACKLOG_TAIL_BYTES);
  const res = await io.readFileFrom(file, start);
  if (res === null) return { events: [], offset: st.size, missing: false, measured: true };
  let text = res.data;
  // A non-zero start almost certainly lands mid-line — drop the partial head so
  // we never hand half a JSON object to the parser.
  if (start > 0) {
    const nl = text.indexOf('\n');
    text = nl >= 0 ? text.slice(nl + 1) : '';
  }
  const events = text.split('\n').filter((l) => l.trim() !== '').flatMap(parseTranscriptLine);
  return { events: events.slice(-lastN), offset: res.size, missing: false, measured: true };
}
```

*(The `res === null` arm keeps `measured: true` HERE on purpose — the body half is Task 8's, and this task must not
claim a distinction it has not yet acquired.)*

`server/src/sessionws.ts:563-574`:

```ts
  private async sendBacklogAndTail(r: Resolved): Promise<void> {
    // ONE stat, not two. `missing` used to come from a second `io.stat` right
    // here, so this method and `readBacklog` could stat the same path a
    // moment apart and disagree; and that stat's `null` asserted absence for
    // conditions nobody measured (D-114).
    const { events, offset, missing, measured } = await readBacklog(this.deps.io, r.file, BACKLOG_N);
    if (this.stopped) return;
    this.tailed = r.resolution;
    this.send({
      type: 'backlog', uuid: r.uuid, events, offset, file: r.file, missing,
      fileMeasured: measured,
      foreignAccount: r.resolution.kind === 'found' ? r.resolution.account : null,
      searchComplete: r.resolution.kind === 'fallback' ? r.resolution.complete : true,
    });
    this.startTailer(r.file, r.uuid, offset);
  }
```

`shared/api.ts` — add to the `backlog` docstring's bullet list (after **:2743**) and to the type (**:2744-2745**):

```ts
   *    - `fileMeasured`: false when the transcript itself could not be
   *      MEASURED — a stat that failed for a reason that is not a proven
   *      ENOENT (an unreachable agent, a whitelist refusal, an EACCES or
   *      ENOTDIR on the way to it). `missing: true` with
   *      `fileMeasured: false` earns the same sentence `searchComplete:
   *      false` earns — "can't read the fleet host right now", NEVER "there
   *      is no transcript". Absent on the wire reads as TRUE, exactly like
   *      `searchComplete` and for the same reason: every older server DID
   *      stat the file, it simply could not tell you what the failure meant,
   *      and reading omission as `false` would put the host-unreadable
   *      banner on every session of every pre-field server. */
  | { type: 'backlog'; uuid: string; events: ChatEvent[]; offset: number; file: string; missing: boolean;
      foreignAccount?: string | null; searchComplete?: boolean; fileMeasured?: boolean }
```

- [ ] **Step 4: Run it and watch it pass** — `cd server && ./node_modules/.bin/vitest run test/transcript-tail.test.ts test/sessionws.test.ts`,
      then `cd server && npm run test` (the frame is cast in several suites; `sessionws.test.ts:974-1034`'s existing
      foreign-account/searchComplete case must stay green).

- [ ] **Step 5: MUTATION CHECK** — two, each reverted:
  1. In `readBacklog`, change `measured: st.reason === 'absent'` to `measured: true`.
     Expect RED on *a transcript whose stat cannot be MEASURED …* with
     `expected { …, measured: true } to deeply equal { …, measured: false }`, and on the sessionws case with
     `expected true to be false`. Right reason: the unmeasured case went back to claiming a measurement.
  2. In `sessionws.ts`, drop `fileMeasured: measured,` from the frame.
     Expect RED on the sessionws case with `expected undefined to be false`. Right reason: the fact stops crossing the
     seam, which is where it is needed.

- [ ] **Step 6: Commit**
      `git commit -am "fix(server): the backlog frame says whether the transcript was measured, on one stat (D-1398, D-1399)"`

---

### Task 4: The PWA says the two different things, and forgets them on rotation

**Files:**
- Modify `pwa/src/stores/session.ts`: state field beside `searchComplete` (**:107**), snapshot member (**:127** and
  **:274**), backlog reducer (**:190**), the `rotated` reset (**:222-244**), initial state (**:446**).
- Modify `pwa/src/screens/SessionScreen.tsx`: new selector beside **:62**, the `empty` gate (**:173**), the banner
  (**:305-317**).
- Test `pwa/test/session-lifecycle.test.tsx` (banner + empty state; the existing pair at **:509-535** is the idiom) and
  `pwa/test/stores.test.ts` (**:189-213** is the reducer idiom).

**Interfaces:**
- Consumes: `backlog.fileMeasured?: boolean` (Task 3), read in ONE place — `pwa/src/stores/session.ts`'s backlog case.
- Produces: `SessionState.fileMeasured: boolean` (and the same key on `SessionSnapshot`).

**Why:** The frame now carries the fact; nothing renders it. Four combinations of `(missing, fileMeasured)` are now
distinct and three of them must not read as "there is no transcript": measured-absent (today's sentence), unmeasurable
stat (the host sentence), and — reachable after Task 8 — a file that IS there whose bytes could not be read, which must
suppress "No messages yet" rather than assert an empty chat. The `rotated` arm (**:222-244**) resets four transcript
facts because "a banner that outlives its cause reads as a statement about what is on screen now"; `fileMeasured` is a
fifth and must go with them.

- [ ] **Step 1: Write the failing test** — append to `pwa/test/session-lifecycle.test.tsx` after **:535**:

```ts
  // D-114 at the last seam. The transcript EXISTS; the server could not
  // measure it. Kills one sentence serving a measured and an unmeasured
  // absence — the same mutant `searchComplete` killed on the readdir side.
  it('an UNMEASURABLE transcript says the fleet host is unreadable, not "can\'t find it"', () => {
    const store = makeStore();
    const fleet = makeFleet();
    render(<SessionScreen id="claude:OpenClawHetzner" store={store} fleet={fleet} />);
    applyBacklog(store, {
      type: 'backlog', uuid: 'u1', offset: 0, missing: true,
      file: '/home/rc/.claude/projects/x/u1.jsonl',
      searchComplete: true, fileMeasured: false, events: [],
    } as Backlog);
    expect(screen.getByText("Can't read the fleet host right now")).toBeInTheDocument();
    expect(screen.queryByText("Can't find this session's transcript")).not.toBeInTheDocument();
    expect(screen.queryByText('No messages yet')).not.toBeInTheDocument();
  });

  // The fourth combination, reachable once readBacklog measures the BODY too:
  // the file is present (missing:false) and its bytes never came back. No
  // "No messages yet", because nobody looked at any messages.
  it('a PRESENT transcript whose bytes could not be read is not an empty chat', () => {
    const store = makeStore();
    const fleet = makeFleet();
    render(<SessionScreen id="claude:OpenClawHetzner" store={store} fleet={fleet} />);
    applyBacklog(store, {
      type: 'backlog', uuid: 'u1', offset: 4096, missing: false,
      file: '/home/rc/.claude/projects/x/u1.jsonl',
      searchComplete: true, fileMeasured: false, events: [],
    } as Backlog);
    expect(screen.queryByText('No messages yet')).not.toBeInTheDocument();
    expect(screen.getByText("Can't read the fleet host right now")).toBeInTheDocument();
  });

  // Kills `fileMeasured: msg.fileMeasured ?? false`, which would put the
  // host-unreadable banner on every session of every pre-field server.
  it('an older server that sends no fileMeasured has MEASURED the file', () => {
    const store = makeStore();
    const fleet = makeFleet();
    render(<SessionScreen id="claude:OpenClawHetzner" store={store} fleet={fleet} />);
    applyBacklog(store, {
      type: 'backlog', uuid: 'u1', offset: 0, missing: true,
      file: '/home/rc/.claude/projects/x/u1.jsonl', searchComplete: true, events: [],
    } as Backlog);
    expect(screen.getByText("Can't find this session's transcript")).toBeInTheDocument();
    expect(screen.queryByText("Can't read the fleet host right now")).not.toBeInTheDocument();
  });
```

and EXTEND the existing reducer test `rotated drops every statement about the transcript it just left`
(**pwa/test/stores.test.ts:199-215**) rather than adding a parallel one — its name already claims *every* statement, so
the fifth fact belongs inside it. It drives the pure reducer (`applySessionMsg(emptySnap(), msg)`), not a store:

```ts
    let s = applySessionMsg(emptySnap(), {
      type: 'backlog', uuid: 'u1', events: [user('a', 'hi')], offset: 90,
      file: '/t/claude2/u1.jsonl', missing: true,
      foreignAccount: 'claude2', searchComplete: false, fileMeasured: false,
    });
    expect(s.strandedAccount).toBe('claude2');
    expect(s.searchComplete).toBe(false);
    expect(s.fileMeasured).toBe(false);            // NEW
    expect(s.missingFile).toBe('/t/claude2/u1.jsonl');
    expect(s.file).toBe('/t/claude2/u1.jsonl');

    s = applySessionMsg(s, { type: 'rotated', uuid: 'u2' });

    expect(s.strandedAccount).toBeNull();
    expect(s.searchComplete).toBe(true);
    expect(s.fileMeasured).toBe(true);             // NEW
    expect(s.missingFile).toBeNull();
    expect(s.file).toBeNull();
```

- [ ] **Step 2: Run it and watch it fail** — Run: `cd pwa && ./node_modules/.bin/vitest run test/session-lifecycle.test.tsx test/stores.test.ts`
      Expected: FAIL — `Unable to find an element with the text: Can't read the fleet host right now`
      (the screen still prints the can't-find sentence), and in `stores.test.ts`
      `TS2353: Object literal may only specify known properties, and 'fileMeasured' does not exist in type …`
      followed, once the field lands on the wire type, by `expected undefined to be false`.

- [ ] **Step 3: Implement** — `pwa/src/stores/session.ts`. After **:107**:

```ts
  /** Whether the transcript itself was MEASURED. False means the server's
   *  stat (or, since the body read is measured too, its read) failed for a
   *  reason that is not a proven ENOENT — rule (b) again, one seam further
   *  in than `searchComplete`: the search may well have finished and still
   *  have measured nothing. Absent on the wire reads as `true`: every
   *  pre-field server did stat the file. */
  fileMeasured: boolean;
```

`SessionSnapshot` (**:127**) gains `fileMeasured: boolean;`; the mapper (**:274**) gains
`fileMeasured: s.fileMeasured,`; the initial state (**:446**) gains `fileMeasured: true,`; the backlog case (**:190**)
gains, directly under `searchComplete`:

```ts
        fileMeasured: msg.fileMeasured ?? true,
```

and the `rotated` arm (**:235-244**) gains `fileMeasured: true,` with its comment corrected from four facts to five:

```ts
      // FIVE transcript facts die with the transcript (final review, Minor 6;
      // `fileMeasured` joined them with the measured-read completion) …
```

`pwa/src/screens/SessionScreen.tsx` — a selector beside **:62**:

```ts
  const fileMeasured = useStore((s) => s.fileMeasured);
  const file = useStore((s) => s.file);
```

the `empty` gate (**:173**):

```ts
  const empty = !loading && events.length === 0 && pending.length === 0 && searchComplete && fileMeasured;
```

the banner (**:305-317**):

```tsx
      {(missingFile !== null || !fileMeasured) && (
        <div className="chat-banner chat-banner--missing" role="status">
          <span>
            {searchComplete && fileMeasured
              ? "Can't find this session's transcript"
              : "Can't read the fleet host right now"}
          </span>
          <span className="banner-path">{missingFile ?? file ?? ''}</span>
          <button type="button" className="btn-ghost" onClick={openTerminal}>
            Open terminal
          </button>
        </div>
      )}
```

- [ ] **Step 4: Run it and watch it pass** — `cd pwa && ./node_modules/.bin/vitest run test/session-lifecycle.test.tsx test/stores.test.ts`,
      then `cd pwa && npm run test`. **Six `SessionSnapshot` literals must gain `fileMeasured: true`**: five one-line
      ones — `pwa/test/stores.test.ts:1136`, `tasks.test.tsx:84`, `mail-card.test.tsx:197`, `:419`,
      `mail-strip.test.tsx:228` (`grep -rn "searchComplete: true, file: null" pwa/test | wc -l` → 5, 2026-09-02) — plus
      the multi-line `emptySnap()` at **stores.test.ts:52-66**, which that one-line grep does not catch (find it with
      `grep -rn "SessionSnapshot" pwa/test`). A required snapshot member is a compile error until each one answers it,
      which is exactly why it goes on `SessionSnapshot` rather than staying optional.

- [ ] **Step 5: MUTATION CHECK** — three, each reverted:
  1. `fileMeasured: msg.fileMeasured ?? true` → `?? false`. Expect RED on *an older server that sends no fileMeasured*
     with `Unable to find an element with the text: Can't find this session's transcript`. Right reason: omission
     stopped meaning "measured" and every legacy server started crying wolf.
  2. Revert the banner to `{searchComplete ? … : …}`. Expect RED on *an UNMEASURABLE transcript* with
     `Unable to find an element with the text: Can't read the fleet host right now`. Right reason: one sentence back to
     serving two facts.
  3. Delete `fileMeasured: true,` from the `rotated` arm. Expect RED on the stores case with `expected false to be true`.
     Right reason: a banner outliving its transcript.

- [ ] **Step 6: Commit**
      `git commit -am "fix(pwa): an unmeasurable transcript is not a missing one, and rotation forgets it (D-1398)"`

---

### Task 5: `readBranchTip` refuses a tip it cannot prove, instead of settling from `packed-refs`

**Files:**
- Modify `server/src/coord/gitref.ts:90-102` (the `unreadable` arm and its ten-line comment) — `io.stat` → `io.statMeasured`.
- Modify `server/src/coord/routes.ts:1668-1673` and `server/test/peers-route.test.ts:5` — RE-STATE the D-114 citation as
  history (the repo reads its comments as history; a stale one is not deleted, it is dated).
- Test `server/test/coord-fingerprint.test.ts` — one case beside the existing pair at **:89-118**.

**Interfaces:**
- Consumes: `io.statMeasured` (Task 2). Produces: no signature change — `readBranchTip` stays
  `Promise<string | null>`; only which inputs answer `null` moves.

**Why:** This is the highest-stakes stat in the tree. The arm at **gitref.ts:90-102** exists because a loose ref whose
BYTES could not be read might still be the true tip, and letting `packed-refs` (**:103-112**) answer instead would hand
a wave close a possibly-stale SHA — the function's own docstring (**:55-58**) says it "refuses (`null`, UNMEASURABLE)
rather than let a possibly-stale `packed-refs` entry stand in for one it could not read." Today the proof is
`io.stat(loosePath) !== null`, so a stat that FAILS for any reason — including, until Task 1, an EACCES on the fleet
host — reads as "no loose ref here" and the stale tip settles the close. `statMeasured` splits that: `absent` is the
proof the arm always wanted, `unreadable` is not proof of anything and must refuse.

**Blast radius, measured rather than assumed.** The arm runs only when the loose ref's own READ failed. For a workspace
branch — the branch a done-fingerprint actually compares — the loose ref exists and is read at **:86-88**, so the arm is
never reached. It is reached for a branch with no loose ref (a packed one, e.g. `main` after `git pack-refs`). Against a
NEW agent the stat then answers `absent` and behaviour is unchanged. Against an OLD agent every measured read is
`unreadable`, so a packed branch's tip answers `null` (`tip-unmeasurable`) until the agent is deployed — see the OPEN
DECISION below, and the AGENT-FIRST rule that buys that window down. In `local` mode a stat only fails `unreadable` for
ENOTDIR/EACCES-on-the-parent-chain, so today's behaviour is preserved for every ordinary case: the existing
`chmod 000` case (**coord-fingerprint.test.ts:89-106**) and EISDIR case (**:107-118**) both still take the
stat-succeeds branch and still return `null`.

- [ ] **Step 1: Write the failing test** — `server/test/coord-fingerprint.test.ts` needs two import edits first
      (**:8** gains `rmSync`, **:10** becomes `import { localIO, type FleetIO } from '../src/io.js';`), then append
      after **:118**:

```ts
  it('refuses when the loose ref can be NEITHER read NOR measured, rather than settle from a stale packed-refs entry', async () => {
    // One dropped agent round trip hits both calls — which is exactly what
    // remote mode does, and what the agent's stat used to HIDE by answering
    // EACCES as {missing:true} (D-114). packed-refs holds the stale OTHER;
    // the loose ref holds the true TIP and can be neither read nor measured.
    // "I could not tell" must answer null, never OTHER.
    const root = project(TIP, OTHER);
    const loosePath = path.join(root, 'demo', '.git', 'refs', 'heads', 'ws', 'quiet-mesa');
    const unmeasurable: FleetIO = {
      ...localIO,
      readFileMeasured: async (p) => (p === loosePath ? { ok: false, reason: 'unreadable' } : localIO.readFileMeasured(p)),
      statMeasured: async (p) => (p === loosePath ? { ok: false, reason: 'unreadable' } : localIO.statMeasured(p)),
    };
    expect(await readBranchTip(unmeasurable, root, 'demo', 'ws/quiet-mesa')).toBeNull();
  });

  it('a PROVEN-absent loose ref still falls through to packed-refs — the ordinary packed branch', async () => {
    // The other pole, and the one that keeps this fix from being a blanket
    // refusal: `absent` is a positive answer ("git has no loose ref for this
    // name"), so packed-refs is git's honest fallback and must still be read.
    const root = project(TIP, OTHER);
    const loosePath = path.join(root, 'demo', '.git', 'refs', 'heads', 'ws', 'quiet-mesa');
    rmSync(loosePath);
    expect(await readBranchTip(localIO, root, 'demo', 'ws/quiet-mesa')).toBe(OTHER);
  });
```

- [ ] **Step 2: Run it and watch it fail** — Run: `cd server && ./node_modules/.bin/vitest run test/coord-fingerprint.test.ts`
      Expected: the first case FAILS with
      `expected '<OTHER sha>' to be null` — today the derived `io.stat` collapses the double's `unreadable` to `null`,
      the arm reads that as "no loose ref", and the stale packed tip is returned. The second case passes already and is
      the anti-over-correction pin.

- [ ] **Step 3: Implement** — `server/src/coord/gitref.ts`, replacing **:90-102**:

```ts
  if (loose.reason === 'unreadable') {
    // A proven ENOENT (`reason === 'absent'`) already answers "no loose ref
    // exists" — nothing left to corroborate, straight to packed-refs below.
    // `unreadable` is weaker: EACCES/EISDIR/a transport hiccup — the path
    // could still be a live ref this box just can't read the bytes of, so
    // `stat` on the SAME path proves presence without needing the bytes
    // (docstring above). THREE answers now, where this used to see two:
    //   ok         — this IS the loose ref, git's authoritative answer, and
    //                it must be refused rather than answered from packed-refs;
    //   unreadable — the stat could not be TAKEN. Not proof of anything, and
    //                this function's whole contract is to refuse what it
    //                cannot prove rather than let a stale packed tip settle a
    //                wave close. Until D-114 was closed this arrived wearing
    //                `{missing:true}`, i.e. indistinguishable from proof;
    //   absent     — proven no loose ref: packed-refs is the honest fallback.
    // AGENT SKEW: an OLDER agent's every measured read is `unreadable`, so a
    // PACKED branch reads `tip-unmeasurable` against one until the agent is
    // deployed. That is the fail-shut direction (refusing a close, never
    // settling one on a stale SHA) and the reason this ships AGENT-FIRST.
    const st = await io.statMeasured(loosePath);
    if (st.ok) return null;                  // the ref IS there — refuse, as before
    if (st.reason !== 'absent') return null;  // could not be measured — refuse
    // Only a PROVEN absence reaches packed-refs below.
  }
```

*(Written as `!== 'absent'` rather than `=== 'unreadable'` so the refusal is the DEFAULT: a third `ReadFailure` member
added later refuses here instead of silently acquiring a fall-through to a stale tip.)*

Then re-state the two now-historical citations, in the same commit. `server/src/coord/routes.ts:1668-1673`:

```ts
   * `projects[]` — every project measured this pass — replaces a
   * `projectKnown` boolean: a typo'd project is this feature's central failure
   * mode (a worker reads `[]` as "I am alone" and conflicts), and the obvious
   * fix, one `io.stat` of the project dir, was built on the call the tree then
   * knew lied (D-114: the agent's stat answered EACCES as `{missing:true}`).
   * That lie is CLOSED — `io.statMeasured` exists and the wire carries
   * `absent?: true` — and `projects[]` still stands, now on its own merit: it
   * is the measurement this pass already makes, so the probe would be a
   * second syscall to learn something already in hand.
```

`server/test/peers-route.test.ts:5`:

```ts
// replaces a `projectKnown` boolean: the obvious `io.stat` probe was built on
// the one call the tree then knew lied (D-114, closed by `statMeasured`), and
// `projects[]` is the free measurement this pass already makes.
```

*(Neither restatement carries a guard of its own — they are history, not behaviour. Stated so no reviewer looks for
one.)*

- [ ] **Step 4: Run it and watch it pass** — `cd server && ./node_modules/.bin/vitest run test/coord-fingerprint.test.ts`,
      then the coordination suites that consume a tip:
      `cd server && ./node_modules/.bin/vitest run test/coord-prhistory.test.ts test/peers-route.test.ts test/divergence-sweep.test.ts`.
      Re-run `coord-fingerprint.test.ts` IN ISOLATION if it flakes — it is not on the known-flake list, so a repeat
      failure is real.

- [ ] **Step 5: MUTATION CHECK** — two, each reverted:
  1. Delete the second line (`if (st.reason !== 'absent') return null;`), leaving today's polarity.
     Expect RED on *refuses when the loose ref can be NEITHER read NOR measured* with `expected '<OTHER sha>' to be null`.
     Right reason: an unmeasurable stat went back to authorising a stale packed tip.
  2. Change the second line to `return null;` unconditionally (refuse on every failed read).
     Expect RED on *a PROVEN-absent loose ref still falls through to packed-refs* with
     `expected null to be '<OTHER sha>'`. Right reason: the fix over-corrected into a blanket refusal, which would
     answer `tip-unmeasurable` for every packed branch on every fleet.

- [ ] **Step 6: Commit**
      `git commit -am "fix(coord): a loose ref that cannot be measured refuses the tip instead of settling from packed-refs (D-1400)"`

---

### Task 6: The agent reports `readB64`'s third condition and `readFrom`'s absence

**Files:**
- Modify `agent/src/fileops.ts:58-73` (`readB64`) and **:75-85** (`readFrom`); export `MAX_READ_B64_BYTES` (**:61**).
- Modify `agent/src/server.ts`: import **:32**, two payload helpers after `statPayload`, `case 'readFrom'` (**:257-263**)
  and `case 'readB64'` (**:264-269**).
- Modify `shared/agent-protocol.ts:105-106` — the response schema comment for both ops.
- Test `agent/test/fileops.test.ts` — five cases beside the existing readB64/readFrom pairs (**:95-129**).

**Interfaces:**
- Produces (agent-local):
  `export type ReadB64Result = { ok: true; dataB64: string } | { ok: false; reason: 'absent' | 'unreadable' } | { ok: false; reason: 'too-large'; size: number }`
  and `export type ReadFromResult = { ok: true; data: string; size: number } | { ok: false; reason: 'absent' | 'unreadable' }`.
- Produces (wire, additive): `readB64 → {dataB64: string|null, absent?: true, tooLarge?: true, size?: number}`;
  `readFrom → {data: string, size: number} | {data: null, absent?: true}`.

**Why:** `readB64` folds THREE facts into one `null` (**fileops.ts:67-73**), and the third — over-cap at
`MAX_READ_B64_BYTES` (**:61**, checked at **:70**) — is the agent's own invention: `localIO` has no cap
(**server/src/io.ts:107-109**), and `ccd clip` `mv -f`s an image of any size into the clips dir
(**ccd/ccd:13414, :13416**) with no check, so the same >12 MB clip serves 200 in local mode and 404 in remote. The cap
is a property of the WS ROUND TRIP (one JSON frame carrying a base64 payload), not of the file, so it stays agent-side
and is REPORTED, never folded and never mirrored into `localIO` — capping `localIO` would start refusing clips the
server serves today. `readFrom` swallows twice (**:80** and **:84**) and its EOF arm at **:82** is a POSITIVE answer
that must stay distinct from both.

- [ ] **Step 1: Write the failing test** — append to `agent/test/fileops.test.ts` after **:129**:

```ts
  it('readB64 marks a genuinely missing whitelisted file absent:true', async () => {
    await open();
    const res = await client!.req<Res>(nextId(), {
      op: 'readB64', path: path.join(fixture!.home, '.cc-clips', 'nope-absent.png'),
    });
    expect(res).toMatchObject({ ok: true, dataB64: null, absent: true });
  });

  it('readB64 of a DIRECTORY (EISDIR) answers null with no absent and no tooLarge key', async () => {
    await open();
    const res = await client!.req<Res>(nextId(), { op: 'readB64', path: path.join(fixture!.home, '.cc-clips') });
    expect(res).toMatchObject({ ok: true, dataB64: null });
    expect(res).not.toHaveProperty('absent');
    expect(res).not.toHaveProperty('tooLarge');
  });

  it('readB64 REPORTS an over-cap clip as tooLarge with its measured size, never as missing', async () => {
    await open();
    // Sparse via truncate: the cap is checked against st.size BEFORE any byte
    // is read, so no 12 MB buffer is ever allocated by this test. Reachable in
    // production because `ccd clip` (ccd/ccd:13416) mv -f's an image of any
    // size into this directory with no size check, while the upload route
    // refuses one (server/src/server.ts:1803-1804).
    const file = path.join(fixture!.home, '.cc-clips', 'huge.png');
    writeFileSync(file, '');
    truncateSync(file, MAX_READ_B64_BYTES + 1);
    const res = await client!.req<Res>(nextId(), { op: 'readB64', path: file });
    expect(res).toMatchObject({ ok: true, dataB64: null, tooLarge: true, size: MAX_READ_B64_BYTES + 1 });
    expect(res).not.toHaveProperty('absent');
  });

  it('readFrom marks a genuinely missing whitelisted file absent:true', async () => {
    await open();
    const res = await client!.req<Res>(nextId(), {
      op: 'readFrom', path: path.join(fixture!.home, '.cc-limits', 'nope-absent.json'), offset: 0,
    });
    expect(res).toMatchObject({ ok: true, data: null, absent: true });
  });

  it('readFrom at EOF is a POSITIVE answer — empty data with the real size, and no absent key', async () => {
    await open();
    const file = path.join(fixture!.home, '.cc-limits', 'eof.json');
    writeFileSync(file, 'abcd');
    const res = await client!.req<Res>(nextId(), { op: 'readFrom', path: file, offset: 4 });
    expect(res).toMatchObject({ ok: true, data: '', size: 4 });
    expect(res).not.toHaveProperty('absent');
  });

  it('readFrom of a DIRECTORY (stat ok, range read EISDIR) answers null with no absent key', async () => {
    await open();
    const res = await client!.req<Res>(nextId(), { op: 'readFrom', path: path.join(fixture!.home, '.cc-clips'), offset: 0 });
    expect(res).toMatchObject({ ok: true, data: null });
    expect(res).not.toHaveProperty('absent');
  });
```

(`agent/test/fileops.test.ts:2` gains `truncateSync`; a new import line brings in the cap:
`import { MAX_READ_B64_BYTES } from '../src/fileops.js';` — importing the constant rather than re-typing `12 * 1024 * 1024`
keeps the cardinal enumerated once, which is why Step 3 exports it.)

- [ ] **Step 2: Run it and watch it fail** — Run: `cd agent && ./node_modules/.bin/vitest run test/fileops.test.ts`
      Expected: FAIL at import — `SyntaxError: The requested module '../src/fileops.js' does not provide an export named 'MAX_READ_B64_BYTES'` —
      and once that export lands, `expected { ok: true, dataB64: null } to match object { ok: true, dataB64: null, absent: true }`
      on the first case and `… tooLarge: true, size: 12582913 }` on the third.

- [ ] **Step 3: Implement** — `agent/src/fileops.ts`, replacing **:58-85**:

```ts
/** Same cap as the server's post-downscale upload ceiling (`MAX_UPLOAD_BYTES`
 *  in server/src/server.ts) — a clip round-trips through both, so neither
 *  side should accept what the other would reject. Exported so tests assert
 *  against THIS number rather than a second copy of it; it is a property of
 *  the WS round trip (one JSON frame carrying a base64 payload), not of the
 *  file, which is why `server/src/io.ts`'s `localIO` deliberately has no
 *  equivalent and why over-cap is REPORTED rather than folded (D-114). */
export const MAX_READ_B64_BYTES = 12 * 1024 * 1024;

/** `readB64Measured`'s result. THREE failure facts where `readB64` had one
 *  null: a proven ENOENT, a file whose size exceeds the cap (carrying the
 *  measured `size`, so a caller can say what it refused and how big it was),
 *  and everything else. Local type, same reason as `ReadResult` above. */
export type ReadB64Result =
  | { ok: true; dataB64: string }
  | { ok: false; reason: 'absent' | 'unreadable' }
  | { ok: false; reason: 'too-large'; size: number };

/** Binary-safe read: never decodes through a string, so bytes that aren't
 *  valid UTF-8 (e.g. a PNG header) survive byte-for-byte. Never throws, same
 *  contract as every other op in this file. */
export async function readB64Measured(p: string): Promise<ReadB64Result> {
  let size: number;
  try {
    size = (await stat(p)).size;
  } catch (e) {
    return { ok: false, reason: (e as NodeJS.ErrnoException).code === 'ENOENT' ? 'absent' : 'unreadable' };
  }
  if (size > MAX_READ_B64_BYTES) return { ok: false, reason: 'too-large', size };
  try {
    return { ok: true, dataB64: (await readFile(p)).toString('base64') };
  } catch (e) {
    // Unlinked between the stat and the read is a real race and a real
    // absence; anything else is not.
    return { ok: false, reason: (e as NodeJS.ErrnoException).code === 'ENOENT' ? 'absent' : 'unreadable' };
  }
}

/** `readFromMeasured`'s result. The EOF arm is `ok`, NOT a failure: an offset
 *  at or past the file's size means "the cursor is at the end and there are
 *  no new bytes", which is a measurement, not a miss. */
export type ReadFromResult =
  | { ok: true; data: string; size: number }
  | { ok: false; reason: 'absent' | 'unreadable' };

export async function readFromMeasured(p: string, offset: number): Promise<ReadFromResult> {
  // Stream only [offset, size) — never load the whole file. A transcript backlog
  // read of a tens-of-MB file used to slurp the whole thing here, ballooning the
  // agent's memory and stalling its event loop.
  let size: number;
  try {
    size = (await stat(p)).size;
  } catch (e) {
    return { ok: false, reason: (e as NodeJS.ErrnoException).code === 'ENOENT' ? 'absent' : 'unreadable' };
  }
  const from = Math.max(0, Math.min(offset, size));
  if (from >= size) return { ok: true, data: '', size };
  try {
    return { ok: true, data: (await readRange(p, from, size)).toString('utf8'), size };
  } catch (e) {
    return { ok: false, reason: (e as NodeJS.ErrnoException).code === 'ENOENT' ? 'absent' : 'unreadable' };
  }
}
```

*(`readB64` and `readFrom` are deleted, not kept as derived wrappers: on this side the payload helper is the single
reader, so a wrapper would be dead code. `grep -rn "readB64\|readFrom" agent/src` shows `agent/src/server.ts` as the
only consumer, and `grep -rn "fileops" agent/test` is empty.)*

`agent/src/server.ts` — import **:32**, then two helpers after `statPayload`:

```ts
/** Builds the `readB64` op's payload. `dataB64` keeps its exact pre-existing
 *  meaning (null for every failure), so an older server's
 *  `typeof data === 'string' ? data : null` reader is unaffected. TWO
 *  positive markers, spread only when true: `absent` (a proven ENOENT) and
 *  `tooLarge` (over the cap, with the measured `size` beside it so the server
 *  can answer 413 with a number instead of a shrug). An older server ignores
 *  both; a newer one reads a bare `dataB64: null` as UNMEASURED. */
function readB64Payload(r: ReadB64Result): { dataB64: string | null; absent?: true; tooLarge?: true; size?: number } {
  if (r.ok) return { dataB64: r.dataB64 };
  if (r.reason === 'too-large') return { dataB64: null, tooLarge: true, size: r.size };
  return { dataB64: null, ...(r.reason === 'absent' ? { absent: true as const } : {}) };
}

/** Builds the `readFrom` op's payload. Shape is unchanged for both existing
 *  arms — `{data, size}` on success, `{data: null}` on failure — with
 *  `absent` spread in only on a proven ENOENT. The EOF case rides the SUCCESS
 *  arm as `{data: '', size}`, exactly as it does today. */
function readFromPayload(r: ReadFromResult): { data: string; size: number } | { data: null; absent?: true } {
  if (r.ok) return { data: r.data, size: r.size };
  return { data: null, ...(r.reason === 'absent' ? { absent: true as const } : {}) };
}
```

and the two cases (**:257-269**):

```ts
    case 'readFrom': {
      const p = await checkPath(req.path, ctx.cfg, 'read');
      if (!p) { send(ws, fail(req.id, 'forbidden')); return; }
      send(ws, ok(req.id, readFromPayload(await readFromMeasured(p, req.offset))));
      return;
    }
    case 'readB64': {
      const p = await checkPath(req.path, ctx.cfg, 'read');
      if (!p) { send(ws, fail(req.id, 'forbidden')); return; }
      send(ws, ok(req.id, readB64Payload(await readB64Measured(p))));
      return;
    }
```

`shared/agent-protocol.ts:105-106`:

```ts
// exec → {code, stdout, stderr}; read → {data: string|null, absent?: true}; readFrom → {data: string, size: number}|{data: null, absent?: true};
// readB64 → {dataB64: string|null, absent?: true, tooLarge?: true, size?: number}; readdir → {names: string[]|null}; stat → {mtimeMs, size}|{missing: true, absent?: true};
```

- [ ] **Step 4: Run it and watch it pass** — `cd agent && ./node_modules/.bin/vitest run test/fileops.test.ts`, then
      `cd agent && npm run test`. The existing `readB64 returns null for a missing whitelisted file` (**:122-129**) and
      `readFrom reads from an offset` (**:95-101**) stay green: both use `toMatchObject`, and neither payload's existing
      keys moved.

- [ ] **Step 5: MUTATION CHECK** — three, each reverted:
  1. In `readB64Payload`, replace the `too-large` branch with `return { dataB64: null };`.
     Expect RED on *readB64 REPORTS an over-cap clip as tooLarge …* with
     `expected { ok: true, dataB64: null } to match object { ok: true, dataB64: null, tooLarge: true, size: 12582913 }`.
     Right reason: the third condition went back to being folded into "no data".
  2. In `readFromMeasured`, move the `if (from >= size)` line BELOW the range read (so EOF falls into the catch).
     Expect RED on *readFrom at EOF is a POSITIVE answer* with
     `expected { ok: true, data: null } to match object { ok: true, data: '', size: 4 }`.
     Right reason: a measurement was reclassified as a failure — the precise thing the EOF arm exists to prevent.
  3. In `readB64Measured`, change the post-stat catch's ternary to `'absent'` unconditionally.
     Expect RED on *readB64 of a DIRECTORY (EISDIR)* with
     `expected { …, absent: true } not to have property "absent"`. Right reason: an EISDIR claimed proof of absence.

- [ ] **Step 6: Commit**
      `git commit -am "fix(agent): readB64 reports over-cap and absence, readFrom reports absence, EOF stays positive (D-1401)"`

---

### Task 7: `readFileB64Measured` and `readFileFromMeasured` on the port

**Files:**
- Modify `server/src/io.ts`: two types after `MeasuredStat`, two interface members beside **:46-47**,
  `localIO.readFileB64Measured` + derived `readFileB64` (replacing **:107-109**) and
  `localIO.readFileFromMeasured` + derived `readFileFrom` (replacing **:95-105**).
- Modify `server/src/remote/io.ts:61-70` and **:72-80** — the two single readers, both derived.
- Test `server/test/io.test.ts` (**:58-88** grow siblings) and `server/test/remote-io.test.ts`.

**Interfaces:**
- Produces:
  `export type MeasuredB64Read = { ok: true; dataB64: string } | { ok: false; reason: ReadFailure } | { ok: false; reason: 'too-large'; size: number | null }`
  and `export type MeasuredRangeRead = { ok: true; data: string; size: number } | { ok: false; reason: ReadFailure }`;
  `readFileB64Measured(path)` and `readFileFromMeasured(path, offset)` on `FleetIO`.
- Consumes: the `readB64`/`readFrom` markers from Task 6, each in exactly one place.

**Why:** `remote/io.ts:72-80` folds SIX conditions to one `null` — the widest fold in the port — and its single caller
turns them all into HTTP 404 (**server/src/server.ts:1826-1827**). `remote/io.ts:61-70` folds five. `localIO`'s halves
fold four (**io.ts:95-105**) and two (**:107-109**). The markers now exist on the wire and nothing reads them.
`size: number | null` on the too-large arm rather than a defaulted `0`: an agent that sent `tooLarge` without a size
would otherwise be reported as a zero-byte over-cap file, which is a manufactured number at a seam.

- [ ] **Step 1: Write the failing test** — in `server/test/io.test.ts`, add siblings to the two describes:

```ts
describe('localIO.readFileFromMeasured', () => {
  it('EOF is a POSITIVE answer: {ok:true, data:"", size}', async () => {
    const file = tmpFile();
    writeFileSync(file, 'abc');
    expect(await localIO.readFileFromMeasured(file, 3)).toEqual({ ok: true, data: '', size: 3 });
    expect(await localIO.readFileFromMeasured(file, 99)).toEqual({ ok: true, data: '', size: 3 });
  });

  it('a missing file is {ok:false, reason:"absent"}; a DIRECTORY (stat ok, range read EISDIR) is "unreadable"', async () => {
    const dir = mktempDir();
    expect(await localIO.readFileFromMeasured(path.join(dir, 'nope'), 0)).toEqual({ ok: false, reason: 'absent' });
    expect(await localIO.readFileFromMeasured(dir, 0)).toEqual({ ok: false, reason: 'unreadable' });
  });

  it('readFileFrom DERIVES: both failure reasons still answer null, EOF still answers {data:"",size}', async () => {
    const file = tmpFile();
    writeFileSync(file, 'abc');
    expect(await localIO.readFileFrom(file, 3)).toEqual({ data: '', size: 3 });
    expect(await localIO.readFileFrom(path.join(path.dirname(file), 'nope'), 0)).toBeNull();
  });
});

describe('localIO.readFileB64Measured', () => {
  it('round-trips bytes; a missing file is "absent"; a DIRECTORY is "unreadable"', async () => {
    const dir = mktempDir();
    const file = path.join(dir, 'clip.png');
    const bytes = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x00, 0xff]);
    writeFileSync(file, bytes);
    expect(await localIO.readFileB64Measured(file)).toEqual({ ok: true, dataB64: bytes.toString('base64') });
    expect(await localIO.readFileB64Measured(path.join(dir, 'nope.png'))).toEqual({ ok: false, reason: 'absent' });
    expect(await localIO.readFileB64Measured(dir)).toEqual({ ok: false, reason: 'unreadable' });
  });

  it('has NO cap, deliberately — the cap is the agent WS round trip, not the file', async () => {
    // localIO must keep serving a clip the agent would refuse, or this seam
    // starts refusing files the server serves today. The divergence is
    // REPORTED (remote answers too-large, local answers the bytes), never
    // equalised — see MAX_READ_B64_BYTES's docstring in agent/src/fileops.ts.
    const dir = mktempDir();
    const file = path.join(dir, 'huge.png');
    writeFileSync(file, '');
    truncateSync(file, MAX_READ_B64_BYTES + 1);
    const r = await localIO.readFileB64Measured(file);
    expect(r.ok).toBe(true);
  });
});
```

(`io.test.ts` gains `truncateSync` from `node:fs` and `import { MAX_READ_B64_BYTES } from '../../agent/src/fileops.js';`
— the same cross-package import `server/test/remoteHelpers.ts:3` already makes.)

In `server/test/remote-io.test.ts`, add to the stub-client describe:

```ts
  it('an OLDER AGENT — {dataB64: null} with no marker — reads as "unreadable", NEVER "absent"', async () => {
    const io = createIo(clientAnswering({ dataB64: null }));
    expect(await io.readFileB64Measured('/whatever/clip.png')).toEqual({ ok: false, reason: 'unreadable' });
  });

  it('a modern agent answering {dataB64: null, tooLarge: true, size: N} reads as "too-large" WITH the size', async () => {
    const io = createIo(clientAnswering({ dataB64: null, tooLarge: true, size: 12582913 }));
    expect(await io.readFileB64Measured('/whatever/huge.png')).toEqual({ ok: false, reason: 'too-large', size: 12582913 });
  });

  it('a tooLarge marker with no size reports a NULL size, never a manufactured 0', async () => {
    const io = createIo(clientAnswering({ dataB64: null, tooLarge: true }));
    expect(await io.readFileB64Measured('/whatever/huge.png')).toEqual({ ok: false, reason: 'too-large', size: null });
  });

  it('an OLDER AGENT — readFrom {data: null} with no marker — reads as "unreadable"', async () => {
    const io = createIo(clientAnswering({ data: null }));
    expect(await io.readFileFromMeasured('/whatever/t.jsonl', 0)).toEqual({ ok: false, reason: 'unreadable' });
  });

  it('a modern agent answering readFrom {data: null, absent: true} reads as "absent"', async () => {
    const io = createIo(clientAnswering({ data: null, absent: true }));
    expect(await io.readFileFromMeasured('/whatever/t.jsonl', 0)).toEqual({ ok: false, reason: 'absent' });
  });
```

and one real-agent case proving the over-cap round trip end to end (`remote-io.test.ts:2` gains `truncateSync`, and the
file gains `import { MAX_READ_B64_BYTES } from '../../agent/src/fileops.js';` — the same cross-package import
`server/test/remoteHelpers.ts:3` already makes):

```ts
  it('an over-cap clip reads as {ok:false, reason:"too-large"} with the real size, not as missing', async () => {
    const f = await connected();
    const file = path.join(fixture!.home, '.cc-clips', 'huge.png');
    writeFileSync(file, '');
    truncateSync(file, MAX_READ_B64_BYTES + 1);
    expect(await f.io.readFileB64Measured(file)).toEqual({ ok: false, reason: 'too-large', size: MAX_READ_B64_BYTES + 1 });
    // And the derived method still answers today's null, so its one caller is untouched until Task 8.
    expect(await f.io.readFileB64(file)).toBeNull();
  });
```

- [ ] **Step 2: Run it and watch it fail** — Run:
      `cd server && ./node_modules/.bin/vitest run test/io.test.ts test/remote-io.test.ts`
      Expected: FAIL with `TS2339: Property 'readFileB64Measured' does not exist on type 'FleetIO'` and, at runtime,
      `TypeError: localIO.readFileFromMeasured is not a function`.

- [ ] **Step 3: Implement** — `server/src/io.ts`, after `MeasuredStat`:

```ts
/** A binary read that distinguishes its THREE failure modes. `too-large` is
 *  not a fault and not an absence: the file is there and this transport
 *  cannot carry it (the agent's `MAX_READ_B64_BYTES`, a property of the WS
 *  frame). `localIO` has no cap and therefore never answers it — the
 *  divergence is REPORTED at the seam rather than equalised, because capping
 *  `localIO` would start refusing clips this server serves today. `size` is
 *  `number | null`: null when the marker arrived without one, never a
 *  manufactured 0. */
export type MeasuredB64Read =
  | { ok: true; dataB64: string }
  | { ok: false; reason: ReadFailure }
  | { ok: false; reason: 'too-large'; size: number | null };

/** A range read that distinguishes its two failure modes. The EOF answer —
 *  `{ok: true, data: '', size}` — is a MEASUREMENT (the cursor is at the end)
 *  and never joins them. */
export type MeasuredRangeRead =
  | { ok: true; data: string; size: number }
  | { ok: false; reason: ReadFailure };
```

Interface members, replacing **:46-47**:

```ts
  /** Distinguishes absence from unreadability for a range read; the EOF arm
   *  is a positive answer. `readFileFrom` derives from this. */
  readFileFromMeasured(path: string, offset: number): Promise<MeasuredRangeRead>;
  readFileFrom(path: string, offset: number): Promise<{ data: string; size: number } | null>;   // null on ANY failure; use readFileFromMeasured to tell absent from unreadable
  /** Distinguishes absence, unreadability and over-cap. `readFileB64` derives
   *  from this. */
  readFileB64Measured(path: string): Promise<MeasuredB64Read>;
  readFileB64(path: string): Promise<string | null>;      // null on ANY failure — the agent's half folds a THIRD condition in here, over-cap (agent/src/fileops.ts's MAX_READ_B64_BYTES); localIO has no cap — binary-safe
```

`localIO`, replacing **:95-109**:

```ts
  async readFileFromMeasured(p, offset) {
    // Stream only [offset, size) — never load the whole file. Transcripts reach
    // tens of MB; the old read-whole-then-slice bloated the agent's RSS and
    // blocked its event loop (base64 + JSON.stringify of the full buffer).
    let size: number;
    try { size = (await stat(p)).size; } catch (err) { return { ok: false, reason: failureFor(err) }; }
    const from = Math.max(0, Math.min(offset, size));
    if (from >= size) return { ok: true, data: '', size };
    try { return { ok: true, data: (await readRange(p, from, size)).toString('utf8'), size }; }
    catch (err) { return { ok: false, reason: failureFor(err) }; }
  },

  async readFileFrom(p, offset) {
    const r = await this.readFileFromMeasured(p, offset);
    return r.ok ? { data: r.data, size: r.size } : null;
  },

  async readFileB64Measured(p) {
    try { return { ok: true, dataB64: (await readFile(p)).toString('base64') }; }
    catch (err) { return { ok: false, reason: failureFor(err) }; }
  },

  async readFileB64(p) {
    const r = await this.readFileB64Measured(p);
    return r.ok ? r.dataB64 : null;
  },
```

`server/src/remote/io.ts`, replacing **:61-80**:

```ts
    async readFileFromMeasured(path, offset) {
      try {
        const res = await client.request({ t: 'req', op: 'readFrom', path, offset });
        const r = res as { data?: unknown; size?: unknown; absent?: unknown };
        if (typeof r.data === 'string') {
          return { ok: true, data: r.data, size: typeof r.size === 'number' ? r.size : Buffer.byteLength(r.data, 'utf8') };
        }
        return { ok: false, reason: r.absent === true ? 'absent' : 'unreadable' };
      } catch {
        return { ok: false, reason: 'unreadable' };
      }
    },

    async readFileFrom(path, offset) {
      const r = await this.readFileFromMeasured(path, offset);
      return r.ok ? { data: r.data, size: r.size } : null;
    },

    async readFileB64Measured(path) {
      try {
        const res = await client.request({ t: 'req', op: 'readB64', path });
        const r = res as { dataB64?: unknown; absent?: unknown; tooLarge?: unknown; size?: unknown };
        if (typeof r.dataB64 === 'string') return { ok: true, dataB64: r.dataB64 };
        // `tooLarge` first: an over-cap file is present, so it must never be
        // reported as absent even if a future agent sent both markers.
        if (r.tooLarge === true) return { ok: false, reason: 'too-large', size: typeof r.size === 'number' ? r.size : null };
        return { ok: false, reason: r.absent === true ? 'absent' : 'unreadable' };
      } catch {
        return { ok: false, reason: 'unreadable' };
      }
    },

    async readFileB64(path) {
      const r = await this.readFileB64Measured(path);
      return r.ok ? r.dataB64 : null;
    },
```

- [ ] **Step 4: Run it and watch it pass** — `cd server && ./node_modules/.bin/vitest run test/io.test.ts test/remote-io.test.ts`,
      then the suites whose subjects call the derived methods:
      `cd server && ./node_modules/.bin/vitest run test/routes.test.ts test/transcript-tail.test.ts test/coord-mirror.test.ts test/dialog.test.ts`.
      Behaviour of all four derived methods is unchanged, so all must be green.

- [ ] **Step 5: MUTATION CHECK** — three, each reverted:
  1. In `remote/io.ts`'s `readFileB64Measured`, delete the `tooLarge` branch.
     Expect RED on *a modern agent answering {dataB64: null, tooLarge: true, size: N}* with
     `expected { ok: false, reason: 'unreadable' } to deeply equal { ok: false, reason: 'too-large', size: 12582913 }`.
     Right reason: the third condition arrived on the wire and the adapter narrowed it away — the exact
     "an adapter may not narrow a distinction it received" violation.
  2. Change `size: typeof r.size === 'number' ? r.size : null` to `: 0`.
     Expect RED on *a tooLarge marker with no size* with
     `expected { …, size: 0 } to deeply equal { …, size: null }`. Right reason: a number nobody measured.
  3. In `localIO.readFileB64Measured`, add `if ((await stat(p)).size > MAX_READ_B64_BYTES) return { ok: false, reason: 'too-large', size: … };`.
     Expect RED on *has NO cap, deliberately* with `expected false to be true`. Right reason: the local half started
     refusing a file it serves today, which is the equalisation this seam rejects.

- [ ] **Step 6: Commit**
      `git commit -am "feat(server): readFileB64Measured + readFileFromMeasured, one reader per marker, both derived (D-1401)"`

---

### Task 8: The two delivery-edge consumers stop narrowing

**Files:**
- Modify `server/src/server.ts:1826-1832` — the clip route, the ONLY `readFileB64` caller in shipped source.
- Modify `server/src/transcript/tail.ts` — `readBacklog`'s body read becomes measured (the arm Task 3 deliberately left).
- Test `server/test/routes.test.ts` — `makeApp` (**:35-68**) gains an optional `io`, plus two cases in the
  `clip route` describe (**:540-589**); `server/test/transcript-tail.test.ts` — one case.

**Interfaces:**
- Consumes: `io.readFileB64Measured`, `io.readFileFromMeasured` (Task 7).
- Produces: HTTP `413 {ok:false, error:'too-large', bytes?: number}` and `502 {ok:false, error:'clip-unmeasurable'}`
  on `GET /api/sessions/:id/clip/:name`; `BacklogRead.measured` now also false when the BODY could not be read.

**Why:** Six conditions become one HTTP 404 at **server.ts:1827** — a status that ASSERTS the resource does not exist —
and two of them demonstrably are not absence: an over-cap clip (reachable via `ccd clip`, **ccd/ccd:13416**) and a
disconnected agent. The precedent for the honest answer is in the same tree: `GET /api/peers?of=` answers
`502 registry-unmeasurable` rather than 404 for an unlistable registry
(**server/test/peers-route.test.ts:155-168**). And `readBacklog`'s `res === null` arm returns an EMPTY backlog with a
real offset, so an unreadable transcript renders as an empty chat with no signal at all — Task 4 already built the
delivery surface for that fact (`empty` is gated on `fileMeasured`); this arm is what makes it reachable from a real
server.

- [ ] **Step 1: Write the failing test** — `server/test/routes.test.ts`: give `makeApp` an optional io (**:37** and
      **:66**), then two cases in the `clip route` describe:

```ts
async function makeApp(
  panes: (string | null)[] | ((home: string) => (string | null)[]),
  opts: { status?: 'busy' | 'idle'; io?: FleetIO } = {},
): Promise<{ app: FastifyInstance; calls: string[][]; bus: Bus; home: string }> {
  // …unchanged through the runner…
  const app = await buildServer(
    { cfg, runCcd: ccdRunner(run, cfg), tmux: new Tmux(run), io: opts.io ?? localIO, queue: new KeyedQueue() },
    bus,
  );
  return { app, calls, bus, home };
}
```

```ts
  it('413s an over-cap clip with its size — a real file this transport cannot carry is not a missing one', async () => {
    // The measured local/remote divergence, at the only surface that shows
    // it: `ccd clip` (ccd/ccd:13416) files an image of any size, the agent
    // refuses >12 MB, and this route used to call that "not-found".
    const io: FleetIO = {
      ...localIO,
      readFileB64Measured: async () => ({ ok: false, reason: 'too-large', size: 12582913 }),
    };
    const { app } = await makeApp([null], { io });
    const res = await app.inject({
      method: 'GET', url: `/api/sessions/${ID}/clip/clip-20260726-150340-a1b2.png`,
    });
    expect(res.statusCode).toBe(413);
    expect(res.json()).toMatchObject({ ok: false, error: 'too-large', bytes: 12582913 });
  });

  it('502s a clip the fleet host could not be asked about, rather than asserting it is gone', async () => {
    const io: FleetIO = {
      ...localIO,
      readFileB64Measured: async () => ({ ok: false, reason: 'unreadable' }),
    };
    const { app } = await makeApp([null], { io });
    const res = await app.inject({
      method: 'GET', url: `/api/sessions/${ID}/clip/clip-20260726-150340-a1b2.png`,
    });
    expect(res.statusCode).toBe(502);
    expect(res.json()).toMatchObject({ ok: false, error: 'clip-unmeasurable' });
  });
```

*(Both doubles override the MEASURED method only. They are not vacuous: `localIO.readFileB64` derives through `this`
after Task 7, so the override IS consulted even before the route changes — which is exactly why the red below is a
status-code mismatch and not a fixture that never fired.)*

`server/test/transcript-tail.test.ts` (**:6** becomes `import { localIO, type FleetIO } from '../src/io.js';`):

```ts
  it('a transcript whose BYTES cannot be read is not an empty chat — present, but unmeasured', async () => {
    const file = tmpFile();
    writeFileSync(file, userLine('u1', 'one'));
    const size = statSync(file).size;
    const io: FleetIO = {
      ...localIO,
      readFileFromMeasured: async () => ({ ok: false, reason: 'unreadable' }),
    };
    expect(await readBacklog(io, file, 50)).toEqual({ events: [], offset: size, missing: false, measured: false });
  });

  it('a transcript unlinked between the stat and the read is a MEASURED absence', async () => {
    const file = tmpFile();
    writeFileSync(file, userLine('u1', 'one'));
    const size = statSync(file).size;
    const io: FleetIO = {
      ...localIO,
      readFileFromMeasured: async () => ({ ok: false, reason: 'absent' }),
    };
    expect(await readBacklog(io, file, 50)).toEqual({ events: [], offset: size, missing: true, measured: true });
  });
```

- [ ] **Step 2: Run it and watch it fail** — Run:
      `cd server && ./node_modules/.bin/vitest run test/routes.test.ts test/transcript-tail.test.ts`
      Expected: FAIL with `expected 404 to be 413` and `expected 404 to be 502` (the route still folds), and
      `expected { …, measured: true } to deeply equal { …, measured: false }` in the tail file.

- [ ] **Step 3: Implement** — `server/src/server.ts`, replacing **:1826-1832**:

```ts
    const r = await deps.io.readFileB64Measured(file);
    if (!r.ok) {
      // THREE facts, three answers. 404 asserts the clip does not exist and is
      // now said only when the read PROVED it. An over-cap clip is a real file
      // this transport cannot carry — 413, the same status the upload route
      // gives the same ceiling (`MAX_UPLOAD_BYTES`, server.ts:1803-1804), with
      // the measured size when the agent sent one. Everything else — a dropped
      // agent round trip, a whitelist refusal, an EACCES — is 502, matching
      // `GET /api/peers?of=`'s `registry-unmeasurable` rather than
      // manufacturing an absence out of a failure to look (D-114).
      if (r.reason === 'absent') return reply.code(404).send({ ok: false, error: 'not-found' });
      if (r.reason === 'too-large') {
        return reply.code(413).send({ ok: false, error: 'too-large', ...(r.size !== null ? { bytes: r.size } : {}) });
      }
      return reply.code(502).send({ ok: false, error: 'clip-unmeasurable' });
    }
    const ext = name.slice(name.lastIndexOf('.') + 1).toLowerCase();
    return reply
      .type(CLIP_MIME[ext] ?? 'application/octet-stream')
      .header('cache-control', 'private, max-age=31536000, immutable')
      .send(Buffer.from(r.dataB64, 'base64'));
```

`server/src/transcript/tail.ts` — the body arm:

```ts
  const res = await io.readFileFromMeasured(file, start);
  if (!res.ok) {
    // Absent HERE is a real race — the file was stat'd and then unlinked — and
    // it is a MEASUREMENT, so it reports as missing-and-measured. Unreadable
    // is the opposite: the file is still there and its bytes never came, so
    // `missing` stays false and `measured` goes false, which is what stops the
    // PWA rendering an empty chat over a transcript nobody could read.
    const absent = res.reason === 'absent';
    return { events: [], offset: st.size, missing: absent, measured: absent };
  }
  let text = res.data;
```

(the remainder of the function reads `res.data` / `res.size` unchanged.)

- [ ] **Step 4: Run it and watch it pass** — `cd server && ./node_modules/.bin/vitest run test/routes.test.ts test/transcript-tail.test.ts test/sessionws.test.ts`,
      then `cd server && npm run test` and `cd agent && npm run test` and `cd pwa && npm run test`.
      `routes.test.ts:573-579` (*404s a clip that is not on disk*) must stay green — in local mode
      `readFileB64Measured` answers `absent` for a real ENOENT, so 404 survives as the *measured* answer.

- [ ] **Step 5: MUTATION CHECK** — three, each reverted:
  1. In the clip route, replace the three-way branch with `if (!r.ok) return reply.code(404).send({ ok: false, error: 'not-found' });`.
     Expect RED on both new route cases with `expected 404 to be 413` and `expected 404 to be 502`.
     Right reason: six conditions back to one status that asserts absence.
  2. Change the `absent` arm to 502 as well.
     Expect RED on the EXISTING *404s a clip that is not on disk* with `expected 502 to be 404`.
     Right reason: over-correction — a measured absence must still be a 404, or the PWA loses its only honest
     broken-thumbnail signal.
  3. In `readBacklog`, change the body arm to `return { events: [], offset: st.size, missing: false, measured: true };`.
     Expect RED on *a transcript whose BYTES cannot be read* with `expected true to be false`.
     Right reason: the unreadable body went back to being indistinguishable from an empty transcript.

- [ ] **Step 6: Commit**
      `git commit -am "fix(server): the clip route and readBacklog stop narrowing what they measured (D-1402, D-1403)"`

---

### Deviations to allocate

**Never invent a D-number.** Read the floor from `POST /api/ledger/deviations` and DEFINE IN THE SAME ACT, one call per
entry, at the moment the entry is written into the plan's `## Deviations found` section. The slugs below are
placeholders and carry no digits after `D-`, so `definitionsIn` (`server/src/coord/ledger.ts:284`) cannot parse them as
definitions and `deviation-refs.test.ts`'s corpus table cannot fire on them while this draft is unmerged.

- **LEDGER D-1396** — the agent's `stat` op answered every errno — EACCES, ENOTDIR, ELOOP, EIO —
  as `{missing:true}`, the wire's proven-absence marker, so `remote/io.ts` reported "not there" for paths it had merely
  failed to measure; closed by a positive `absent?: true` beside an untouched `missing:true`, read in exactly one place
  (`statMeasured`), omission failing shut.
- **LEDGER D-1397** — the ENOENT→`absent` ternary was about to exist in three copies inside
  `server/src/io.ts`; `failureFor` makes it one, and one mutation of it now reds both measured readers.
- **LEDGER D-1398** — the `backlog` frame's `missing` was derived from a collapsed
  `io.stat`, so a transcript the server merely could not measure rendered as "Can't find this session's transcript";
  `fileMeasured` reports the difference the way `searchComplete` already does on the readdir side.
- **LEDGER D-1399** — `sessionws.ts` and `readBacklog` stat'd the same transcript path a moment
  apart and could disagree; one measured stat now serves both.
- **LEDGER D-1400** — `readBranchTip`'s fail-shut proof stat treated "could not measure" as
  "no loose ref", so a stale `packed-refs` tip could settle a wave close; only a PROVEN absence now falls through.
- **LEDGER D-1401** — the agent capped `readB64` at 12 MB and folded over-cap into the same null as
  missing, while `localIO` had no cap and `ccd clip` files images of any size — the same clip served 200 locally and
  404 remotely; over-cap is now REPORTED (`tooLarge` + `size`) and never equalised.
- **LEDGER D-1402** — `GET /api/sessions/:id/clip/:name` turned six conditions into one HTTP 404,
  asserting non-existence for an over-cap clip and a disconnected agent; now 404 / 413 / 502 by what was measured.
- **LEDGER D-1403** — an unreadable transcript body returned an empty backlog with a real
  offset, rendering as an empty chat with no signal; it now reports `measured: false`.

### Open decisions for the operator

1. **Task 5's old-agent window.** With an agent that predates Task 1, `readBranchTip` answers `tip-unmeasurable` for a
   PACKED branch (a workspace branch keeps a loose ref and is unaffected). Fail-shut, and bounded by the AGENT-FIRST
   deploy — but it can block a close if the agent deploy is skipped. Accept, or gate the refusal behind a measured
   capability?
2. **Task 8's 502 for a missing clip during that same window.** An old agent's `unreadable` covers a genuinely absent
   clip, so a missing thumbnail answers 502 instead of 404 until the agent ships. Accept (recommended: the PWA renders
   a broken thumbnail either way and 502 is the honest one), or keep 404 as the fallback for `unreadable`?
3. **`localIO`'s missing cap** — recommendation NO CAP (Task 7, mutation 3 pins it). Confirm: the alternative makes the
   server refuse >12 MB clips it serves today.
4. **`readdir`** — see below.

### Deliberately out of scope, each with its reason

- **`readdir` (D-1019).** `docs/superpowers/plans/2026-08-28-program-leverage-wave2-f2.md` names wave 8 as its natural
  home, and three shipped comments assign it to D-114's family (`server/src/tasks/read.ts:88-94`,
  `server/src/coord/ledgerseed.ts:150-157`, `server/test/dialog.test.ts:414-419`) — but **this wave's brief does not
  list it**, and there are 28 `io.readdir` call sites in `server/src`
  (`grep -rn "\.readdir(" --include=*.ts server/src | grep -v "async readdir" | wc -l` → 28, 2026-09-02), 16 of them on
  `cfg.registryDir`, so including it roughly doubles the item. **Recorded as the follow-up**, with the two halves it
  needs already scoped: the agent's `listDir` (`agent/src/fileops.ts:87-89`) and the remote fold
  (`server/src/remote/io.ts:82-90`), whose ambiguity `shared/api.ts:2740-2742` already names verbatim.
- **The transcript-resolve ladder rewrite** (`server/src/transcript/resolve.ts:212-221`, **:289-293**, **:425**).
  Every rung is a `stat !== null` boolean probe and the module has built a compensating witness ladder around exactly
  that. THE GOVERNING RULE (`server/src/io.ts:24-32`) says the `unreadable` arm must be TODAY's code, and rewriting a
  ladder whose every rung is an `unreadable` fall-through would be a behaviour change per rung, not a de-collapsing.
  Out.
- **`realpath`** (`io.ts:122-124`, documented at **:50-55**; `remote/io.ts:36-38` answers `null` unconditionally).
  A third collapse the interface already DOCUMENTS and the remote half deliberately never implements — closing it means
  a new resolver op, which the no-new-op constraint forbids. Named so it does not look overlooked.
- **The 13 registry fields still on the collapsed `field()`** (`server/src/registry.ts:333-336`, call sites
  **:513-524**: archived, archivemanifest, base, home, lastswap, pool, prcheckedat, prnumber, project, prphase, spawn,
  swapblocked, workspace; nine others already use `fieldMeasured`). The wave-1 plan ruled the migrated nine one by one
  and did NOT rule these thirteen, so each needs its own consumer read before it is called indifferent or defective —
  per-field work, not a block migration. `prnumber`/`prphase`/`prcheckedat` are the likeliest real defects (the PR
  lifecycle treats "no PR recorded" and "could not read the marker" differently) and are the natural first three.
- **`readBranchTip`'s and `WorktreeRecord`'s own return types** (`gitref.ts:103-112`, **:116-120**, **:290-298**).
  Widening them is D-115's shape — a behaviour change per consumer — and the wave-1 plan deferred them explicitly. The
  worktree-record loop's two live defects (an unreadable `gitdir` silently DROPS a row from a census typed
  `{ok:true, records}`; four conditions produce `headBranch: null`) are real and stay open.

## Work item 2 — the `MailDeliveryState` terminality audit (Tasks 20–26)

Every anchor and every number below was re-opened at **HEAD `5e9f650d36a39b1cb0482411c673315b5dd0ca0b`**, branch
`ws/quiet-meadow`, tree clean, on **2026-09-02**. Each task carries its own `grep` **locator** — use it, not the
line number, because **Task 20 inserts a blank line, a twelve-line docstring and one `const` immediately after
`server/src/coord/store.ts:210`**, so every `store.ts` line number quoted in Tasks 22-26 is the PRE-insertion
number and is roughly **+14** once Task 20 has landed. The locators are drift-proof; the numbers are history.

Order is load-bearing and NOT parallelisable: **20 → 21 → 22 → 23 → 24 → 25 → 26.** Tasks 20 and 21 both insert
into the same region of `single-definition.test.ts`; Task 26's scan is RED until 20, 24 and 25 have all landed.
22 and 23 are the only two that may swap.

> Note for whoever assembles the plan document: every deviation below is a `D-TBD-<slug>`, never `D-<digits>`,
> so none of these lines can be read as a live ledger definition by `deviation-refs.test.ts`'s `DEFINED` regex
> (`/^(?:#{2,4} |- \*\*)D-(\d+)\b/`, `server/test/deviation-refs.test.ts:123` — verified at HEAD: it requires
> digits directly after `D-`). Allocate real numbers from `POST /api/ledger/deviations` at write-up time.

---

### Task 20: Mint `TERMINAL_DELIVERY_STATES` in L0, build the SQL guard from it, forbid the second SQL copy

**Files:**
- Modify: `shared/api.ts` — insert after line 3055, the closing `}` of `isMailDeliveryState` (`:3050` is
  `export type MailDeliveryState`, `:3053-3055` is the guard, `:3059` is `MAIL_BODY_MAX_BYTES`, the next
  declaration). Locator: `grep -n 'export function isMailDeliveryState' shared/api.ts` → `3053`.
- Modify: `server/src/coord/store.ts` — the import block `:8-29` (add to line **19**, `  RUN_TRANSITIONS,`);
  immediately after `:210` (`const OUTSTANDING_STATES_SQL = "('queued','delivered')";`); and the 13 lines
  carrying `('acked','rejected')`: `347 352 2157 2186 2205 2223 2237 2245 2296 2326 2354 2358 2375`.
- Test: `server/test/single-definition.test.ts` — new `it` after line **458** (the closing `});` of the
  terminal-trio test), inside `describe('Build 7 nouns')` which opens at `:335`.

**Interfaces:**
- Consumes: nothing.
- Produces: `export const TERMINAL_DELIVERY_STATES = ['acked', 'rejected'] as const satisfies readonly MailDeliveryState[]`
  (`shared/api.ts`); module-level `const TERMINAL_DELIVERY_SQL: string` (`server/src/coord/store.ts`, not
  exported). Tasks 21, 23, 24, 25 and 26 all depend on both.

**Why:** No `TERMINAL_DELIVERY_STATES` exists (`grep -n 'TERMINAL' shared/api.ts` → no hits), though
`TERMINAL_RUN_STATES` (`store.ts:38`) and `TERMINAL_ITEM_STATES` (`store.ts:100`) exist for the sibling
vocabularies, and the latter's docstring already makes the argument: "The SQL literal in `setWorkItemState`'s
`WHERE` is BUILT from this list and `settleItems`' pre-pass READS it, so the guard and the precheck cannot
drift". Measured 2026-09-02 at `5e9f650d`: `grep -rn "NOT IN ('acked','rejected')" --include=*.ts server/src/ | wc -l`
→ **13** — six shipped SQL literals (`2186 2223 2245 2326 2354 2375`) and seven docstrings respelling the same
SQL (`347 352 2157 2205 2237 2296 2358`). The home is **L0 `shared/api.ts`, not `store.ts`**: another copy of the
pair lives in `pwa/src/session/MailStrip.tsx:167`, in a different package, which a `store.ts`-local constant
could not reach (`single-definition.test.ts`'s `ROOTS`, `:32-37`, are `shared` + `server/src` + `pwa/src` +
`agent/src`).

- [ ] **Step 1: Write the failing test**

Insert in `server/test/single-definition.test.ts` immediately after line 458 (`ALL`, `rel`, `ccrcRoot`,
`path` and `readFileSync` are all already in scope at `:17-59`):

```ts
  // D-1404. Same shape and the same reason as the
  // deliberate-cancel scan at the top of this describe (D-1319) and the
  // terminal-trio scan above: the shipped SQL is BUILT by `join`, so this
  // scanner sees no literal at all in the real source, and any hand-written SQL
  // list of the delivery terminal pair scores a hit. Either order, because a
  // copy written from memory is as likely to be the other way round.
  //
  // Measured before this test existed (2026-09-02, 5e9f650d): the pair was
  // spelled six times in `store.ts`'s own SQL and seven more times in its
  // docstrings, and the whole suite was green. Those prose copies are why the
  // SQL rewrite must also rewrite the comments — unlike the deliberate-cancel
  // case the prose here spells the SQL FORM itself, so an SQL-shaped regex hits
  // a comment explaining the constant.
  //
  // ANCHORED ON `(` AND `)` ONLY, never `[`. The trio scan above can use
  // `[[(]` because its own definition lives in a file it EXPECTS to see in
  // `holders`; this one asserts `holders` is EMPTY, and the definition is
  // `['acked', 'rejected']` — bracketed. A `[[(]` here would match the
  // definition itself and the test could never pass. The cost is stated
  // honestly: a hand-written JS ARRAY copy under another name is out of this
  // scanner's reach, exactly as this file's own header paragraph says
  // ("A determined author can evade either one").
  it('spells the delivery terminal pair ONCE — TERMINAL_DELIVERY_STATES, never a hand-written SQL list', () => {
    // This scan reads ALL, and ALL is built from ROOTS — which does NOT include
    // `server/test`. That is what makes it safe for this test to spell the
    // forbidden literal in its own self-checks below, and it is measured here
    // rather than assumed: adding `server/test` to ROOTS would turn every
    // literal-scan in this file into a guard that matches its own source.
    expect(ALL.map(rel)).not.toContain('server/test/single-definition.test.ts');

    const PAIR = /\(\s*'(acked|rejected)'\s*,\s*'(acked|rejected)'\s*\)/;
    // The premise, established inside the test rather than assumed: without
    // these three lines the assertion below is satisfied by a regex that
    // matches nothing.
    expect(PAIR.test("NOT IN ('acked','rejected') ")).toBe(true);
    expect(PAIR.test("NOT IN ( 'rejected', 'acked' )")).toBe(true);
    expect(PAIR.test("IN ('queued','delivered')")).toBe(false);

    const holders = ALL.filter((f) => PAIR.test(readFileSync(f, 'utf8'))).map(rel).sort();
    expect(holders, 'a hand-written SQL list of the delivery terminal pair').toEqual([]);

    // …and the one definition still exists and is still what the guards are
    // built from, so "no literal anywhere" cannot be satisfied by deleting
    // every guard instead.
    const api = readFileSync(path.join(ccrcRoot, 'shared/api.ts'), 'utf8');
    expect(api).toMatch(
      /export const TERMINAL_DELIVERY_STATES = \['acked', 'rejected'\] as const/);
    const defs = ALL.filter((f) =>
      /^\s*export const TERMINAL_DELIVERY_STATES\b/m.test(readFileSync(f, 'utf8'))).map(rel);
    expect(defs, 'TERMINAL_DELIVERY_STATES').toEqual(['shared/api.ts']);

    const store = readFileSync(path.join(ccrcRoot, 'server/src/coord/store.ts'), 'utf8');
    expect(store).toMatch(
      /const TERMINAL_DELIVERY_SQL =\s*\n?\s*`\('\$\{TERMINAL_DELIVERY_STATES\.join\("','"\)\}'\)`/);

    // THE FLOOR IS COUNTED OVER CODE, NOT PROSE, and that is the whole point of
    // it. This task rewrites SEVEN DOCSTRING lines to read
    // `NOT IN ${TERMINAL_DELIVERY_SQL}` as well, so a count over the raw file
    // would sit at 13 and stay above 6 with every real guard deleted — an
    // anti-vacuity check that is itself vacuous. Comment lines are stripped
    // first, and the strip is proved to work on a sentence that only exists
    // inside a comment.
    const code = store.split('\n').filter((l) => !/^\s*(\*|\/\*|\/\/)/.test(l)).join('\n');
    expect(store, 'the sentinel is gone from store.ts — pick another comment-only phrase')
      .toContain('the same guard every other');
    expect(code, 'the comment strip did not strip comments').not.toContain('the same guard every other');
    // Six negative-form guards at 5e9f650d (2026-09-02), as a FLOOR so a
    // seventh writer raises it rather than breaking it.
    expect((code.match(/NOT IN \$\{TERMINAL_DELIVERY_SQL\}/g) ?? []).length)
      .toBeGreaterThanOrEqual(6);
  });
```

- [ ] **Step 2: Run it and watch it fail**
Run: `cd server && ./node_modules/.bin/vitest run test/single-definition.test.ts -t "delivery terminal pair"`
Expected: FAIL on `expect(holders, 'a hand-written SQL list of the delivery terminal pair').toEqual([])` with
received `[ 'server/src/coord/store.ts' ]`.

- [ ] **Step 3: Implement**

**(3a)** `shared/api.ts`, insert immediately after line 3055 (`isMailDeliveryState`'s closing `}`):

```ts

/** The two terminal members of `MailDeliveryState`, ONCE. `TERMINAL_ITEM_STATES`
 *  (`server/src/coord/store.ts`) is the precedent and carries the argument: the
 *  SQL literal in every delivery writer's `WHERE` is BUILT from this list
 *  (`TERMINAL_DELIVERY_SQL`), so the guard and the prose that explains it cannot
 *  drift — and `single-definition.test.ts` pins that this is the only place the
 *  pair is spelled as one adjacent list under any of the four roots.
 *
 *  L0 rather than beside the guards it feeds, and that is the load-bearing
 *  choice: a copy of this pair also lived in `pwa/src/session/MailStrip.tsx`,
 *  in a DIFFERENT PACKAGE, which a constant minted in `server/src` could not
 *  have been imported by (D-1405).
 *
 *  `unknown` is deliberately NOT a member. A state this build cannot name is not
 *  a state it may declare finished; what to do with one is an open question
 *  recorded by this wave, not a decision this list makes. */
export const TERMINAL_DELIVERY_STATES = ['acked', 'rejected'] as const satisfies
  readonly MailDeliveryState[];
```

**(3b)** `server/src/coord/store.ts` — extend the import. Line **19** currently reads `  RUN_TRANSITIONS,`
(locator: `grep -n '^  RUN_TRANSITIONS,$' server/src/coord/store.ts`). Replace that one line with:

```ts
  RUN_TRANSITIONS, TERMINAL_DELIVERY_STATES,
```

Same line, so this adds **no** line-number shift. `isMailDeliveryState` and `type MailDeliveryState` are
already imported there (`:11` and `:23`) — Tasks 24 and 25 need both.

**(3c)** `server/src/coord/store.ts` — insert directly after `const OUTSTANDING_STATES_SQL = "('queued','delivered')";`
(line **210**; locator: `grep -n 'const OUTSTANDING_STATES_SQL' server/src/coord/store.ts`):

```ts

/** The WRITE-side complement of `OUTSTANDING_STATES_SQL` above, built from L0's
 *  `TERMINAL_DELIVERY_STATES` by the same `.join` interpolation
 *  `CoordStore.TERMINAL_SQL` already uses for work items. Every delivery-row
 *  `UPDATE` in this file names one of these two fragments and never a literal —
 *  pinned in both directions by `single-definition.test.ts`'s two pair scans and
 *  by `mail-hardening.test.ts`'s writer scan.
 *
 *  NOT the complement of `OUTSTANDING_STATES_SQL` for a token in NEITHER list: a
 *  row holding an out-of-vocabulary `state` is not-outstanding to the positive
 *  form and still-live to this one. That asymmetry is deliberate, unchanged by
 *  this wave, and recorded as an open design question
 *  (D-1406). */
const TERMINAL_DELIVERY_SQL = `('${TERMINAL_DELIVERY_STATES.join("','")}')`;
```

The docstring says "Every delivery-row `UPDATE`" and **must not** say "Every `UPDATE mail_deliveries`":
Task 26's scan looks for that exact phrase in this file's text, and a comment carrying it would be counted.

**(3d)** Rewrite all thirteen `('acked','rejected')` lines mechanically — six SQL fragments become template
literals, seven docstrings name the constant (they then describe the source text truthfully). Run from the
repo root:

```bash
python3 - <<'PY'
p = 'server/src/coord/store.ts'
lines = open(p, encoding='utf8').read().split('\n')
LIT, CONST = "('acked','rejected')", '${TERMINAL_DELIVERY_SQL}'
changed = 0
for i, l in enumerate(lines):
    if LIT not in l:
        continue
    new = l.replace(LIT, CONST)
    s = new.strip()
    # A shipped fragment is a double-quoted string literal and needs its quotes
    # turned into a template literal; a docstring line starts with * or // and
    # only needs to stop respelling the list.
    if not (s.startswith('*') or s.startswith('/**') or s.startswith('//')):
        assert s.startswith('"') and s.endswith('",'), s
        j, k = new.index('"'), new.rindex('"')
        new = new[:j] + '`' + new[j + 1:k] + '`' + new[k + 1:]
    lines[i] = new
    changed += 1
assert changed == 13, changed
open(p, 'w', encoding='utf8').write('\n'.join(lines))
print('rewrote', changed, 'lines')
PY
```

Rehearsed on a scratch copy 2026-09-02: `rewrote 13 lines`, all six SQL lines correctly converted to
backticks, all seven prose lines left as comments. Verify:

```bash
grep -c "('acked','rejected')" server/src/coord/store.ts            # -> 0
grep -c 'TERMINAL_DELIVERY_SQL' server/src/coord/store.ts           # -> 14 (13 uses + the definition)
```

- [ ] **Step 4: Run it and watch it pass**
From inside `server/`, in this order:
`./node_modules/.bin/vitest run test/single-definition.test.ts`
`./node_modules/.bin/vitest run test/coord-store.test.ts`
`./node_modules/.bin/vitest run test/mail-hardening.test.ts`
`./node_modules/.bin/vitest run test/mail-sweep.test.ts`
`npm run build` (tsc — the new import must resolve, and the six rewritten fragments must still typecheck as
template literals)

- [ ] **Step 5: MUTATION CHECK** — in `server/src/coord/store.ts`, change the new definition to
`const TERMINAL_DELIVERY_SQL = "('acked','rejected')";` (a hand-written list, byte-identical in behaviour).
Expect RED on `./node_modules/.bin/vitest run test/single-definition.test.ts -t "delivery terminal pair"`:
`a hand-written SQL list of the delivery terminal pair` receives `[ 'server/src/coord/store.ts' ]`, and the
`const TERMINAL_DELIVERY_SQL =` `toMatch` reds too. Right reason: the mutant is exactly the hand-respelled
copy that shipped GREEN through the whole suite in the D-1319 incident, and no behavioural test can see it —
`coord-store.test.ts`, `mail-hardening.test.ts` and `mail-sweep.test.ts` all stay green under it, which is
the measurement to record.
**Second mutation, for the floor:** delete the `AND state NOT IN ${TERMINAL_DELIVERY_SQL}` clause from **all
six** shipped guards (leaving the seven docstrings alone). Expect RED on
`expect((code.match(...)).length).toBeGreaterThanOrEqual(6)` with `expected 0 to be greater than or equal to 6`.
Right reason: this is the exact vacuity the comment-strip exists to prevent — over the RAW file the count
would still be 7 (the seven rewritten docstrings) and the check would pass with every real guard gone. Inside
`single-definition.test.ts` the floor is the ONLY assertion that reds: `holders` is still `[]` and the
definition `toMatch` still passes, which is precisely the gap being closed. Other suites red too under this
mutation (`mail-hardening.test.ts`'s markIngested/bumpReplayCount tests, `coord-store.test.ts`'s R1/H1/H2) —
expected, and not the measurement. Revert both.

- [ ] **Step 6: Commit**
```bash
git add shared/api.ts server/src/coord/store.ts server/test/single-definition.test.ts && git commit -m "feat(wave8): one TERMINAL_DELIVERY_STATES, and the scan that forbids the second copy (D-1405, D-1404, D-1406)"
```

**LEDGER: D-1405** — The delivery terminal pair had no single definition: spelled six
times in `store.ts`'s SQL, seven more in its docstrings, and once more as a JS disjunction in
`pwa/src/session/MailStrip.tsx`; minted `TERMINAL_DELIVERY_STATES` in L0 `shared/api.ts` (not beside
`TERMINAL_ITEM_STATES` in `store.ts`, because the client copy is in another package) and built
`TERMINAL_DELIVERY_SQL` from it by the same `.join` interpolation `CoordStore.TERMINAL_SQL` uses.

**LEDGER: D-1404** — `single-definition.test.ts` forbade a second hand-written copy of the
deliberate-cancel pair (D-1319) and of the work-item terminal trio but had never mentioned the delivery pair;
two scans were added rather than one — the SQL scan here, the JS-disjunction scan in Task 21, both under
this number — because the SQL-list copy and the JS-disjunction copy do not look alike
and a regex loose enough to catch both would fire on prose — and the SQL scan's anti-vacuity floor is counted
over comment-stripped source, because the same task rewrites seven docstrings into the shape it counts.

**LEDGER: D-1406** — the positive-form guard (`state IN ('queued','delivered')`) and the
negative-form guard (`state NOT IN TERMINAL_DELIVERY_SQL`) disagree about a token in neither list: such a row
is not-outstanding to `dueDeliveries` and the three positive-form writers but LIVE to every negative-form
writer and to `markAcked`, making the ack route the sole path that can reach it after a deploy rollback;
behaviour deliberately unchanged by this wave and recorded undecided.

---

### Task 21: Convert the PWA's copy, and scan for the JS-disjunction shape the SQL regex cannot see

**Files:**
- Modify: `pwa/src/session/MailStrip.tsx` — the value import at `:23-26`; the `heldGate` docstring paragraph at
  **`:156-161`** (from `The state test is an EXCLUSION` through `by design).`); the copy at `:167`.
  Locator: `grep -n "item.state === 'acked'" pwa/src/session/MailStrip.tsx` → `167`.
- Test: `server/test/single-definition.test.ts` — new `it` immediately after the one Task 20 added.

**Interfaces:**
- Consumes: `TERMINAL_DELIVERY_STATES` from `shared/api.ts` (Task 20).
- Produces: nothing later tasks rely on.

**Why:** `pwa/src/session/MailStrip.tsx:167` reads `if (item.state === 'acked' || item.state === 'rejected') return null;`
— another spelling of the terminal pair, and the only one outside `store.ts`. Task 20's SQL-shaped regex is
structurally incapable of seeing it (it is a JS disjunction, not an SQL list), so minting the constant without
this second scan leaves the client's copy exactly where it was. Measured 2026-09-02 at `5e9f650d`: a scan of
the four ROOTS for `===\s*'(acked|rejected)'[^\n]*\|\|[^\n]*===\s*'(acked|rejected)'` over **178** `.ts`/`.tsx`
files returns exactly `['pwa/src/session/MailStrip.tsx']`. The function's own docstring (`:156-157`) says the
test is "an EXCLUSION of the two terminal words, not an allow-list of the live ones", and
`pwa/test/mail-strip.test.tsx:557-563` already pins that property behaviourally — so the conversion must
preserve it, not restate it.

- [ ] **Step 1: Write the failing test**

Insert in `server/test/single-definition.test.ts` immediately after the `it` Task 20 added:

```ts
  // …and the SAME pair in its JS shape, which the SQL-anchored regex above is
  // structurally incapable of seeing. Two scans, not one, because the two
  // copies do not look alike: `store.ts` wrote an SQL list, `MailStrip.tsx`
  // wrote a disjunction, and a single regex that caught both would have to be
  // loose enough to fire on prose (D-1404).
  it('spells the delivery terminal pair ONCE in JS too — no hand-written === disjunction', () => {
    const DISJ = /===\s*'(acked|rejected)'[^\n]*\|\|[^\n]*===\s*'(acked|rejected)'/;
    // The premise, established here: both orders are recognised, and a
    // SINGLE-member test — which is not a copy of the pair and is a legitimate
    // thing to write (`statusArm`, MailStrip.tsx: `state === 'rejected'` alone)
    // — is not.
    expect(DISJ.test("if (item.state === 'acked' || item.state === 'rejected') return null;")).toBe(true);
    expect(DISJ.test("x.state === 'rejected' || x.state === 'acked'")).toBe(true);
    expect(DISJ.test("if (item.state === 'rejected') return 'abandoned';")).toBe(false);

    const holders = ALL.filter((f) => DISJ.test(readFileSync(f, 'utf8'))).map(rel).sort();
    expect(holders, 'a hand-written JS disjunction of the delivery terminal pair').toEqual([]);

    // The client really does still EXCLUDE the pair — "no disjunction anywhere"
    // is also satisfied by deleting the test entirely, which would put a gate
    // line on an acked row. Asserted as the CALL SHAPE, not as the identifier:
    // the identifier also appears in this file's own new docstring paragraph,
    // so a `toContain('TERMINAL_DELIVERY_STATES')` would be satisfied by the
    // comment alone and would pass with line 167 deleted.
    const strip = readFileSync(path.join(ccrcRoot, 'pwa/src/session/MailStrip.tsx'), 'utf8');
    expect(strip).toMatch(
      /if \(\(TERMINAL_DELIVERY_STATES as readonly string\[\]\)\.includes\(item\.state\)\) return null;/);
  });
```

- [ ] **Step 2: Run it and watch it fail**
Run: `cd server && ./node_modules/.bin/vitest run test/single-definition.test.ts -t "in JS too"`
Expected: FAIL on `a hand-written JS disjunction of the delivery terminal pair` with received
`[ 'pwa/src/session/MailStrip.tsx' ]`.

- [ ] **Step 3: Implement**

In `pwa/src/session/MailStrip.tsx`, extend the value import (`:23-26`, the block that currently reads
`import {\n  MAIL_MAX_ATTEMPTS, MAIL_GATE_HELD_MS, MAIL_GATE_HELD_COUNT, MAIL_GATE_FRESH_MS,\n} from '../../../shared/api';`):

```tsx
import {
  MAIL_MAX_ATTEMPTS, MAIL_GATE_HELD_MS, MAIL_GATE_HELD_COUNT, MAIL_GATE_FRESH_MS,
  TERMINAL_DELIVERY_STATES,
} from '../../../shared/api';
```

Replace the **whole paragraph at `:156-161`** — from `* The state test is an EXCLUSION` through
`* this one anyway (there is one status line per row, by design).` — with:

```tsx
 * The state test is an EXCLUSION of the two terminal words, not an allow-list
 * of the live ones — so `unknown`, which is what a state this client does not
 * recognise revives as, keeps its gate line instead of losing it. It reads
 * those two words from `TERMINAL_DELIVERY_STATES` rather than respelling them:
 * this file held a copy of that pair, and the server's own guards are built
 * from the same list, so a member added there can never again mean one thing to
 * the lane and another to the strip. The server clears all four columns on
 * send, ack and reject, but a client must not depend on a server having done
 * that, and the row's terminal arm outranks this one anyway (there is one
 * status line per row, by design).
```

Do NOT leave the old `* clears all four columns on send, ack and reject…` tail standing underneath — it is
reproduced inside the replacement above, and replacing only `:156-158` would duplicate three lines inside the
JSDoc.

Replace line `:167`:

```tsx
  if ((TERMINAL_DELIVERY_STATES as readonly string[]).includes(item.state)) return null;
```

The cast is required and is the same one `shared/api.ts` already uses on `MAIL_DELIVERY_STATES`
(`isMailDeliveryState`'s body): `item.state` is a `MailDeliveryState`, which is not assignable to the tuple's
`'acked' | 'rejected'` element type.

Leave `statusArm`'s `if (item.state === 'rejected') return 'abandoned';` alone — it is a single-member test
asking a different question ("is this row abandoned"), not a copy of the pair, and the scan's own third
self-check pins that it stays legal.

- [ ] **Step 4: Run it and watch it pass**
`cd server && ./node_modules/.bin/vitest run test/single-definition.test.ts`
`cd pwa && ./node_modules/.bin/vitest run test/mail-strip.test.tsx` — the behavioural half; its
`keeps a gate on the \`unknown\` state` test (`:557-563`) is what proves the conversion preserved the
exclusion rather than turning it into an allow-list.
`cd pwa && npm run build`

- [ ] **Step 5: MUTATION CHECK** — in `pwa/src/session/MailStrip.tsx:167`, revert to
`if (item.state === 'acked' || item.state === 'rejected') return null;`. Expect RED on
`cd server && ./node_modules/.bin/vitest run test/single-definition.test.ts -t "in JS too"` — `holders`
receives `[ 'pwa/src/session/MailStrip.tsx' ]` — while `cd pwa && ./node_modules/.bin/vitest run test/mail-strip.test.tsx`
stays fully GREEN, which is the point: the mutant is behaviourally identical, so only the structural scan can
name it. (`npm run build` in `pwa/` will separately complain about the now-unused import; that is not the red
being measured.)
**Second mutation:** delete line `:167` entirely. Expect RED on the same test, this time on the
`toMatch(/if \(\(TERMINAL_DELIVERY_STATES as readonly string\[\]\)…/)` assertion — and on
`pwa/test/mail-strip.test.tsx`'s `keeps a gate on the \`unknown\` state` test, where `heldGate(heldRow({ state: 'acked' }))`
now returns a hold instead of `null`. Right reason: "no disjunction anywhere" must not be satisfiable by
removing the exclusion, and this is the mutant that would do it. Revert both.

- [ ] **Step 6: Commit**
```bash
git add pwa/src/session/MailStrip.tsx server/test/single-definition.test.ts && git commit -m "refactor(wave8): the client reads the terminal pair from L0 too, and a scan for its JS shape (D-1404)"
```

---

### Task 22: Pin `cancelOutstandingDeliveries`' guard with a mutation-red test

**Files:**
- Modify: `server/test/coord-store.test.ts:11` (the store import); new `it` inserted after line **926** —
  the closing `  });` of the `markAcked still refuses a DIFFERENT rejectCode` test — so it lands INSIDE
  `describe('CoordStore: mail delivery replay (spec:174-180)')`, which opens at `:613` and closes at `:927`.
  Inserting after `:927` would put it outside that describe.
  Locator: `grep -n "markAcked still refuses a DIFFERENT" server/test/coord-store.test.ts` → `916`; its
  closing `  });` is ten lines down at `926`, and `927` is the describe's own `});`.
- Test: `server/test/coord-store.test.ts` (no source change).

**Interfaces:**
- Consumes: the shipped guard on `server/src/coord/store.ts:995` (locator:
  `grep -n 'cancelOutstandingDeliveries' server/src/coord/store.ts` → the method opens at `992`).
- Produces: none.

**Why:** `cancelOutstandingDeliveries` (`store.ts:992-998`) carries the positive-form guard
`WHERE state IN ${OUTSTANDING_STATES_SQL}` on `:995`, and nothing asserts the property that guard exists for.
Measured 2026-09-02: `grep -rn 'cancelOutstandingDeliveries' server/test/*.test.ts` returns **14** hits, and
the only three DIRECT calls — `coord-store.test.ts:793` (R1), `:834` (H1), `:864` (H2) — each park a single
freshly-`queueDelivery`'d row and use the method as the FIXTURE that establishes a park. Not one asserts that
a terminal row survives it. That is a mutation-table gap on the one writer `closeRun` calls (`store.ts:967`)
from inside its own transaction.

- [ ] **Step 1: Write the failing test**

Extend the import at `server/test/coord-store.test.ts:11` — it currently reads
`import { CoordStore, MAIL_RECLAIM_CANCELLED_ERROR } from '../src/coord/store.js';`:

```ts
import { CoordStore, MAIL_RECLAIM_CANCELLED_ERROR, MAIL_REPLAY_CEILING_ERROR,
         MAIL_RUN_CLOSED_ERROR } from '../src/coord/store.js';
```

Insert after line **926**, still inside `describe('CoordStore: mail delivery replay (spec:174-180)')`
(`store()` and `openRun()` are module-scope helpers at `:16-21`):

```ts
  // D-1407. The guard on `cancelOutstandingDeliveries`
  // is real and has been since the run-close park shipped, but nothing measured
  // it: every test that named this method used it as a FIXTURE to park a queued
  // row, so nothing in this describe asserts what it must NOT touch. Three rows,
  // not one — an ACKED row, a row parked for a DIFFERENT reason, and a live row
  // beside them so a mutation cannot pass by moving nothing at all.
  it('cancelOutstandingDeliveries leaves an acked row and a DIFFERENTLY-parked row alone', () => {
    const s = store();
    const r = openRun(s) as { id: number };
    const queue = (): { id: number } => {
      const m = s.insertMail({ fromId: 'coordinator', fromUuid: 'u1', toId: 'ccrc-pwa-quiet-mesa',
                               runId: r.id, kind: 'status', subject: 'wave-brief', body: 'go',
                               artifacts: [] });
      return s.queueDelivery(m.id, 'ccrc-pwa-quiet-mesa', '<mail>go</mail>');
    };
    const acked = queue();
    const parked = queue();
    const live = queue();
    s.markAcked(acked.id, 1_776_000_000_000);
    s.rejectDelivery(parked.id, 'undeliverable', MAIL_REPLAY_CEILING_ERROR);

    s.cancelOutstandingDeliveries(r.id);

    const row = (id: number) => s.db.prepare(
      'SELECT state, rejectCode, lastError FROM mail_deliveries WHERE id = ?',
    ).get(id) as { state: string; rejectCode: string | null; lastError: string | null };

    // An ack is a decision this close does not get to reverse.
    expect(row(acked.id)).toEqual({ state: 'acked', rejectCode: null, lastError: null });
    // …and a park already has a reason; a later park must not restamp it.
    expect(row(parked.id)).toEqual({ state: 'rejected', rejectCode: 'undeliverable',
                                     lastError: MAIL_REPLAY_CEILING_ERROR });
    // The positive control: the live row DID move, so a mutant cannot satisfy
    // the two assertions above by cancelling nothing at all.
    expect(row(live.id)).toEqual({ state: 'rejected', rejectCode: 'undeliverable',
                                   lastError: MAIL_RUN_CLOSED_ERROR });
  });
```

If Task 25 has already landed in your tree, `s.markAcked(...)` returns a union rather than a boolean; the call
above ignores the return either way, so no edit is needed.

- [ ] **Step 2: Run it and watch it fail**

This test PASSES on the clean tree — the guard already ships; the defect is that nothing measured it. So the
red-first measurement is the MUTANT, and it is taken FIRST, before the test exists:

1. Apply the Step 5 mutation to `server/src/coord/store.ts`.
2. Run, and RECORD the result in the commit body:
   `cd server && ./node_modules/.bin/vitest run test/coord-store.test.ts test/mail-sweep.test.ts test/mail-routes.test.ts test/mail-hardening.test.ts test/run-routes.test.ts test/sessionws.test.ts test/coord-health.test.ts`
   The claim this task rests on is that `coord-store.test.ts` is GREEN under it. If any OTHER suite reds,
   record which and why — the guard is then incidentally covered by a fixture somewhere, and this task's value
   is that it becomes DIRECTLY covered by an assertion that names the property.
3. Revert the mutation, add the test, and confirm:
   `cd server && ./node_modules/.bin/vitest run test/coord-store.test.ts -t "cancelOutstandingDeliveries leaves an acked row"`
   → PASS.

- [ ] **Step 3: Implement**
No source change. The guard already exists — `server/src/coord/store.ts:995-996`, verbatim at `5e9f650d`:

```ts
      `lastError = '${MAIL_RUN_CLOSED_ERROR}' WHERE state IN ${OUTSTANDING_STATES_SQL} ` +
      'AND mailId IN (SELECT id FROM mail WHERE runId = ?)',
```

- [ ] **Step 4: Run it and watch it pass**
`cd server && ./node_modules/.bin/vitest run test/coord-store.test.ts`

- [ ] **Step 5: MUTATION CHECK** — drop ONLY the state clause, keeping the `WHERE` keyword. This is a
**two-line** edit; do not delete the tail of the first line, because that removes `WHERE` itself and SQLite
then parses `lastError = ('run closed' AND mailId IN (…))` as a boolean expression against EVERY row, which
reds for the wrong reason. Change the two lines above to read:

```ts
      `lastError = '${MAIL_RUN_CLOSED_ERROR}' WHERE ` +
      'mailId IN (SELECT id FROM mail WHERE runId = ?)',
```

Expect RED on the new test at the FIRST assertion —
`expected { state: 'rejected', rejectCode: 'undeliverable', lastError: 'run closed' } to deeply equal { state: 'acked', rejectCode: null, lastError: null }`
— and on the `parked` row, whose `lastError` is now `'run closed'` instead of the replay-ceiling sentence.
Right reason: the guard's only job is that a terminal row is not re-parked, and the `live` assertion still
PASSES, proving the red is "a finished row was overwritten", not "the method stopped working". Revert.

- [ ] **Step 6: Commit**
```bash
git add server/test/coord-store.test.ts && git commit -m "test(wave8): red-on-mutation for cancelOutstandingDeliveries' terminality guard (D-1407)"
```

**LEDGER: D-1407** — `cancelOutstandingDeliveries`' positive-form guard was present
and correct but measured green under deletion: all 14 of its test references used it as the fixture that parks
a queued row, and none asserted that an acked or differently-parked row survives it; closed with a three-row
test carrying its own live-row positive control.

---

### Task 23: Pin `noteGate`'s guard with a mutation-red test

**Files:**
- Modify: `server/test/mail-hardening.test.ts` — new `it`s appended inside
  `describe('terminality guards: markIngested and bumpReplayCount (D10 holes 3/4)')`, which opens at `:146`
  and whose closing `});` is line **212**, the last line of the file. Append after the `bumpReplayCount` test
  that ends at `:211`.
- Test: `server/test/mail-hardening.test.ts` (no source change).

**Interfaces:**
- Consumes: the shipped guard inside `noteGate` (`server/src/coord/store.ts:2350-2356` pre-Task-20; locator:
  `grep -n '^  noteGate(' server/src/coord/store.ts`), and the `deliveredRow` helper already defined at
  `mail-hardening.test.ts:149-159`.
- Produces: none.

**Why:** `noteGate` carries `WHERE id = ? AND state NOT IN …` and shipped guarded on 2026-08-28 (`9f805510`),
but no test drives a terminal row through it. Measured 2026-09-02: `grep -rn 'noteGate' server/test/` returns
calls only at `mail-sweep.test.ts:2145, 2167, 2168, 2173, 2188`, and every one of those is on a freshly
`queueTestDelivery`'d — i.e. `queued` — row (read at `:2138-2194`). Deleting the clause leaves that suite
green. `noteGate` is the single writer of EVERY `MailGate` member (its only production caller is
`watch.ts:2371`), so an unpinned guard there means a parked row can silently acquire a gate line claiming
something is still holding a delivery that was abandoned.

- [ ] **Step 1: Write the failing test**

Append inside the existing `describe` in `server/test/mail-hardening.test.ts`, after the `bumpReplayCount`
test that ends at `:211` (the file's `now` const is at `:147`, `store()` at `:12-13`):

```ts
  // D-1408. `noteGate` is hole 3/4's sibling and shipped WITH
  // its guard — and with nothing that measures it: every `noteGate` call in the
  // suite is on a fresh `queued` row, so deleting the guard left everything
  // green. The gate columns are the one place a terminal row could acquire a
  // fresh claim that something is still holding it.
  const gates = (s: CoordStore, id: number) => s.db.prepare(
    'SELECT lastGate, gateAt, gateCount, gateSince FROM mail_deliveries WHERE id = ?',
  ).get(id) as { lastGate: string | null; gateAt: number | null;
                 gateCount: number; gateSince: number | null };

  it('noteGate leaves a PARKED row\'s gate columns alone — nothing is holding an abandoned delivery', () => {
    const s = store();
    const d = deliveredRow(s);
    s.rejectDelivery(d.id, 'undeliverable', 'parked at the ceiling');
    // `rejectDelivery` clears all four columns on the way in (its own statement
    // sets `lastGate = NULL, gateCount = 0, gateSince = NULL, gateAt = NULL`),
    // so this is the honest starting point, not an assumption. `gateCount` is
    // `INTEGER NOT NULL DEFAULT 0` in the schema, hence 0 rather than null.
    expect(gates(s, d.id)).toEqual({ lastGate: null, gateAt: null, gateCount: 0, gateSince: null });
    s.noteGate(d.id, 'not-idle', now + 100, false, null);
    expect(gates(s, d.id)).toEqual({ lastGate: null, gateAt: null, gateCount: 0, gateSince: null });
  });

  it('noteGate leaves an ACKED row\'s gate columns alone', () => {
    const s = store();
    const d = deliveredRow(s);
    s.markAcked(d.id, now + 1);
    expect(gates(s, d.id)).toEqual({ lastGate: null, gateAt: null, gateCount: 0, gateSince: null });
    s.noteGate(d.id, 'not-idle', now + 100, false, null);
    expect(gates(s, d.id)).toEqual({ lastGate: null, gateAt: null, gateCount: 0, gateSince: null });
  });

  it('noteGate still records a gate on a live delivered row', () => {
    // The positive control. Without it the two assertions above are satisfied
    // by a `noteGate` that writes nothing at all, on any row.
    const s = store();
    const d = deliveredRow(s);
    s.noteGate(d.id, 'not-idle', now + 100, false, null);
    expect(gates(s, d.id)).toEqual({ lastGate: 'not-idle', gateAt: now + 100,
                                     gateCount: 1, gateSince: now + 100 });
  });
```

- [ ] **Step 2: Run it and watch it fail**

As in Task 22 the guard already ships, so the tests pass on the clean tree and the red-first measurement is
the mutant, taken FIRST:

1. Apply the Step 5 mutation.
2. Run and RECORD in the commit body:
   `cd server && ./node_modules/.bin/vitest run test/mail-hardening.test.ts test/mail-sweep.test.ts test/coord-store.test.ts test/sessionws.test.ts`
   The claim: all GREEN. If anything reds, record which and why.
3. Revert, add the tests, and confirm:
   `cd server && ./node_modules/.bin/vitest run test/mail-hardening.test.ts -t "noteGate"` → 3 passed.

- [ ] **Step 3: Implement**
No source change. The guard already exists as the last line of `noteGate`'s statement, reading
`"WHERE id = ? AND state NOT IN ('acked','rejected')",` before Task 20 and
`` `WHERE id = ? AND state NOT IN ${TERMINAL_DELIVERY_SQL}`, `` after it.
Locator: `grep -n 'WHERE id = ? AND state NOT IN' server/src/coord/store.ts` — `noteGate`'s is the one
directly under `'gateCount = CASE WHEN ? THEN gateCount + 1 ELSE 1 END, gateSince = ? ' +`.

- [ ] **Step 4: Run it and watch it pass**
`cd server && ./node_modules/.bin/vitest run test/mail-hardening.test.ts`

- [ ] **Step 5: MUTATION CHECK** — in `noteGate`'s statement, drop the guard so that line reads exactly:

```ts
      'WHERE id = ?',
```

The clause carries **no** bind placeholder, so `.run(gate, now, same ? 1 : 0, same ? (sinceIfSame ?? now) : now, id)`
stays untouched and there is no parameter-count error to red for the wrong reason.
Expect RED on BOTH terminality tests with
`expected { lastGate: 'not-idle', gateAt: 1000000000100, gateCount: 1, gateSince: 1000000000100 } to deeply equal { lastGate: null, gateAt: null, gateCount: 0, gateSince: null }`.
Right reason: a row that was parked or acked acquired a fresh gate claim, which is exactly what the clause
forbids — and the third test stays GREEN, proving `noteGate` still writes on a live row and the red is not
"the method stopped working". Revert.

- [ ] **Step 6: Commit**
```bash
git add server/test/mail-hardening.test.ts && git commit -m "test(wave8): red-on-mutation for noteGate's terminality guard (D-1408)"
```

**LEDGER: D-1408** — `noteGate` shipped with its terminality guard on 2026-08-28 (`9f805510`)
and with nothing that measures it: every `noteGate` call in the suite (`mail-sweep.test.ts` 2145/2167/2168/
2173/2188) is on a fresh queued row, so deleting the guard left the whole suite green on the single writer of
every `MailGate` member.

---

### Task 24: Guard `setDeliveryEnvelope`, and widen it so the guard is not invisible

**Files:**
- Modify: `server/src/coord/store.ts` — the docstring `:2047-2063` and the method `:2064-2066` (pre-Task-20
  numbers). Locator: `grep -n 'setDeliveryEnvelope(id: number' server/src/coord/store.ts`.
- Modify: `server/src/coord/routes.ts:676` and `server/src/coord/rundefs.ts:202` — the two call sites.
  Locator: `grep -rn 'setDeliveryEnvelope' server/src/coord/` (exactly three hits: the definition and these two).
- Test: `server/test/coord-store.test.ts` — new `it` after the existing `setDeliveryEnvelope` test, which
  opens at `:468` and whose closing `  });` is line **482**.

**Interfaces:**
- Consumes: `TERMINAL_DELIVERY_SQL` (Task 20), `isMailDeliveryState` and `type MailDeliveryState` (already
  imported in `store.ts` at `:11` and `:23`).
- Produces:
  ```ts
  export type SetEnvelopeResult =
    | { ok: true }
    | { ok: false; why: 'absent' }
    | { ok: false; why: 'terminal'; state: MailDeliveryState };
  setDeliveryEnvelope(id: number, envelope: string): SetEnvelopeResult
  ```
  Task 26's writer scan requires this guard to exist. **The signature must stay on ONE line** — Task 26's
  scan walks backwards from each prepared statement to the nearest single-line method signature to name the
  writer, and a signature broken across lines silently mis-attributes.

**Why:** `setDeliveryEnvelope` is the only delivery-row writer with a bare `WHERE id = ?`. Measured
2026-09-02 at `5e9f650d` by extracting all eleven `UPDATE mail_deliveries` prepared statements from `store.ts`
and classifying each `WHERE`: three positive-form (`cancelKickoffsTo`, `repointCoordinatorMail`,
`cancelOutstandingDeliveries`), six negative-form, and two bare — `setDeliveryEnvelope` and `markAcked` (whose
guard sat in JS, not SQL; Task 25). It is not exploitable today: both call sites (`routes.ts:667-678`,
`rundefs.ts:195-204`) run inside the same `tx(coord.db, …)` as the `queueDelivery` that created the row, and
`tx` is `BEGIN IMMEDIATE` over a synchronous `DatabaseSync`, so the row is provably `'queued'` and nothing can
interleave. The guard is therefore a no-op on the only reachable path — which is precisely why it costs
nothing and removes the last exception from the audit Task 26 turns into a mechanism. The return is widened in
the same act: adding a guard while leaving `: void` would recreate, in this method, the exact
caller-invisible-refusal defect this wave is closing everywhere else — the defect `store.ts:103-105`'s own
`SetWorkItemResult` docstring names ("A refusal that the caller cannot see is a refusal that reads as a
success").

- [ ] **Step 1: Write the failing test**

Insert in `server/test/coord-store.test.ts` immediately after line **482** (the closing `  });` of the
existing `setDeliveryEnvelope overwrites a delivery's stored envelope in place…` test), inside the same
describe. If Task 22 has not landed, extend `:11`'s import the same way it does; the line below needs
`MAIL_RUN_CLOSED_ERROR`:

```ts
  // D-1409. The last delivery-row writer with a bare `WHERE id = ?`.
  // Unreachable on a terminal row today — both call sites run inside the same
  // `tx()` as the `queueDelivery` that created the row, and `tx` is
  // BEGIN IMMEDIATE over a synchronous DatabaseSync — so this test drives the
  // method DIRECTLY, which is the only way the refusal arms can be reached at
  // all. That is the point: the guard is free here, and a free guard that is
  // also measured is one fewer exception in the audit.
  it('setDeliveryEnvelope refuses a terminal row, and says which refusal it is', () => {
    const s = store();
    const r = openRun(s) as { id: number };
    const mail = s.insertMail({ fromId: 'coordinator', fromUuid: 'u1', toId: 'ccrc-pwa-quiet-mesa',
                                runId: r.id, kind: 'status', subject: 'wave-brief', body: 'go',
                                artifacts: [] });
    const d = s.queueDelivery(mail.id, 'ccrc-pwa-quiet-mesa', '<mail>original</mail>');

    // The positive control FIRST, so the refusals below cannot pass on a method
    // that writes nothing.
    expect(s.setDeliveryEnvelope(d.id, '<mail>stamped</mail>')).toEqual({ ok: true });
    expect(s.deliveryEnvelope(d.id)?.envelope).toBe('<mail>stamped</mail>');

    s.rejectDelivery(d.id, 'undeliverable', MAIL_RUN_CLOSED_ERROR);
    expect(s.setDeliveryEnvelope(d.id, '<mail>too late</mail>'))
      .toEqual({ ok: false, why: 'terminal', state: 'rejected' });
    expect(s.deliveryEnvelope(d.id)?.envelope).toBe('<mail>stamped</mail>');

    // …and an id that names no row is a DIFFERENT answer, not the same one:
    // "there is nothing here" and "there is something here and it is finished"
    // are two conditions a caller handles differently.
    expect(s.setDeliveryEnvelope(999_999, '<mail>nowhere</mail>'))
      .toEqual({ ok: false, why: 'absent' });
  });
```

- [ ] **Step 2: Run it and watch it fail**
Run: `cd server && ./node_modules/.bin/vitest run test/coord-store.test.ts -t "setDeliveryEnvelope refuses a terminal row"`
Expected: FAIL at the first assertion — `expected undefined to deeply equal { ok: true }` (the method returns
`void` today).

- [ ] **Step 3: Implement**

Keep the existing docstring at `:2047-2063` and APPEND these paragraphs to it (i.e. replace its closing
`   * computed. */` line with `   * computed.` followed by the block below), then replace `:2064-2066`:

```ts
   *
   * GUARDED, and the guard is a no-op on every reachable path — deliberately.
   * EVERY call site runs inside the SAME `tx()` as the `queueDelivery` above
   * it, and `tx` is `BEGIN IMMEDIATE` over a synchronous `DatabaseSync`, so
   * the row this stamps is provably `'queued'` and no concurrent writer can see
   * it. The clause is here anyway because a writer whose safety rests on its
   * callers' shape is a writer that breaks silently the day a third one
   * appears — and one does, in Task 61 of this same wave — and because an
   * audit with one exception in it is an audit nobody
   * finishes. DO NOT "simplify" it away: it costs one `AND`, and it is what
   * lets `mail-hardening.test.ts`'s writer scan say EVERY with no carve-out
   * (D-1409).
   *
   * The result is a union rather than `void` for the reason `bumpReplayCount`
   * states below — "the union is the fix; the guard alone is not". Adding a
   * guard and keeping `void` would have put a caller-invisible refusal into one
   * of the very methods this wave exists to fix. `'absent'` and `'terminal'`
   * are separated because they are two conditions a caller handles differently:
   * the first means the row this transaction just inserted is gone, the second
   * means someone else finished this delivery. */
  setDeliveryEnvelope(id: number, envelope: string): SetEnvelopeResult {
    const res = this.db.prepare(
      `UPDATE mail_deliveries SET envelope = ? WHERE id = ? AND state NOT IN ${TERMINAL_DELIVERY_SQL}`,
    ).run(envelope, id);
    if (Number(res.changes) > 0) return { ok: true };
    const row = this.db.prepare('SELECT state FROM mail_deliveries WHERE id = ?')
      .get(id) as { state: string } | undefined;
    if (!row) return { ok: false, why: 'absent' };
    return { ok: false, why: 'terminal',
             state: isMailDeliveryState(row.state) ? row.state : 'unknown' };
  }
```

Declare the result type at **MODULE SCOPE — outside the class.** `export class CoordStore {` opens at
`store.ts:453`, so a type declared beside the method would be inside the class body and will not compile. Put
it directly under Task 20's `const TERMINAL_DELIVERY_SQL = …;` (module scope, ~`:224` after that insertion;
locator: `grep -n 'const TERMINAL_DELIVERY_SQL' server/src/coord/store.ts`), which keeps the delivery
vocabulary in one place — the same arrangement `SetWorkItemResult` (`:103-109`) has beside
`TERMINAL_ITEM_STATES` (`:100`):

```ts

/** `setDeliveryEnvelope`'s answer — `SetWorkItemResult`'s shape, for
 *  `SetWorkItemResult`'s reason. `'absent'` and `'terminal'` are kept apart
 *  because the first says this transaction has already lost the row it just
 *  inserted and the second says another writer finished the delivery: no
 *  overloaded null at a seam (D-1409). */
export type SetEnvelopeResult =
  | { ok: true }
  | { ok: false; why: 'absent' }
  | { ok: false; why: 'terminal'; state: MailDeliveryState };
```

Every call site must now handle the refusal — the two that exist today, and the third that Task 61
adds later in this wave. In `server/src/coord/routes.ts`, replace line `:676`
(`      coord.setDeliveryEnvelope(delivery.id, envelope);`) with:

```ts
      const stamped = coord.setDeliveryEnvelope(delivery.id, envelope);
      // Structurally impossible inside this transaction — the row was inserted
      // six lines up and nothing else can see it. THROWN rather than ignored
      // because `tx` rolls back on throw and rethrows: if the impossible
      // happens, the whole mail is withdrawn rather than accepted with the
      // placeholder envelope, which carries no `ack:` line and so names no
      // delivery id for any recipient to ack against.
      if (!stamped.ok) throw new Error(`delivery ${delivery.id} unstampable: ${stamped.why}`);
```

In `server/src/coord/rundefs.ts`, replace line `:202` (the identical call inside `queueSystemMail`'s `tx`,
`:195-204`) with the same two statements, re-indented to that block's four spaces. **State the blast radius rather than discovering it later:** a
throw here escapes `queueSystemMail`, whose callers are `close.ts:248`, `dispatch.ts:661`, `kickoff.ts:156`
and `routes.ts:1204`. That is deliberate and is the fail-shut choice — a system mail whose envelope could not
be stamped is a mail no recipient can ever ack, and `queueSystemMail`'s existing `{ queued: false }` means
"the dedupe guard suppressed it", a different and true statement that this must not borrow.

- [ ] **Step 4: Run it and watch it pass**
`cd server && ./node_modules/.bin/vitest run test/coord-store.test.ts`
`cd server && ./node_modules/.bin/vitest run test/mail-routes.test.ts`
`cd server && ./node_modules/.bin/vitest run test/coord-kickoff.test.ts`
`cd server && ./node_modules/.bin/vitest run test/mail-sweep.test.ts test/run-routes.test.ts test/coord-health.test.ts`
`cd server && ./node_modules/.bin/vitest run test/typecheck-tests.test.ts`
`cd server && npm run build`

- [ ] **Step 5: MUTATION CHECK** — two mutations, each with its own red.
**(a) Drop the guard:** change the statement back to
`'UPDATE mail_deliveries SET envelope = ? WHERE id = ?'` (a plain single-quoted string; the binds
`.run(envelope, id)` are unchanged, so there is no parameter-count error). Expect RED with
`expected { ok: true } to deeply equal { ok: false, why: 'terminal', state: 'rejected' }`, and the following
envelope assertion receiving `'<mail>too late</mail>'`. Right reason: a finished row's published envelope was
rewritten.
**(b) Collapse the two refusals:** delete the `if (!row) return { ok: false, why: 'absent' };` line so an
absent row falls through to the terminal arm. Expect RED with
`expected { ok: false, why: 'terminal', state: 'unknown' } to deeply equal { ok: false, why: 'absent' }`.
Right reason: that is the overloaded-value-at-a-seam this wave exists to remove, and only the `999_999` case
can see it — the first two assertions stay green under this mutation, which is what makes the red name the
collapse rather than a broken method. Revert both.

- [ ] **Step 6: Commit**
```bash
git add server/src/coord/store.ts server/src/coord/routes.ts server/src/coord/rundefs.ts server/test/coord-store.test.ts && git commit -m "fix(wave8): guard setDeliveryEnvelope and widen it, so the guard is not invisible (D-1409)"
```

**LEDGER: D-1409** — `setDeliveryEnvelope` was the last delivery-row writer with a bare
`WHERE id = ?`; the guard is a no-op on every reachable path (both call sites run inside the same `tx()` as
the `queueDelivery` that created the row) and was added anyway to remove the audit's one exception — and its
return was widened in the same act, because adding a guard while keeping `: void` would have recreated the
caller-invisible refusal this wave was closing everywhere else.

---

### Task 25: `markAcked` returns a union, the guard moves into SQL, and the ack route gives the third answer

**Files:**
- Modify: `server/src/coord/store.ts` — the existing `markAcked` docstring (`:2249-2282` pre-Task-20), its
  signature and body (`:2283-2294`), and a new exported result type beside it.
  Locator: `grep -n '^  markAcked(' server/src/coord/store.ts`.
- Modify: `server/src/coord/routes.ts` — the route docstring lines `:692-693`, and the seam at `:762-763`.
  Locator: `grep -n 'coord.markAcked' server/src/coord/routes.ts` → `762` (the only caller in the tree).
- Modify: `server/test/mail-routes.test.ts` — the import at `:13`; ONE new entry in the `NOT_CODES` set
  (the literal is `:438-516`, its last entries `'bad-count'` and `'not-live'`); two new `it`s inside
  `describe('POST /api/mail/:id/ack')` (opens `:651`), after the double-ack test that ends at **`:673`**.
- Modify (assertion sites — measured 2026-09-02 with
  `grep -rn 'expect(s\.markAcked\|expect(landed)\.toBe\|expect(coord\.markAcked' server/test | wc -l` → **8**):
  `server/test/coord-store.test.ts:873 :895 :905 :923 :1639`, `server/test/mail-hardening.test.ts:173 :207`,
  `server/test/coord-kickoff.test.ts:124`. Every OTHER `markAcked` call in the tree ignores the return value,
  so widening it is source-compatible with them.
- Test: `server/test/coord-store.test.ts` (one new `it` for the arm the route cannot reach) and
  `server/test/mail-routes.test.ts`.

**Interfaces:**
- Consumes: `TERMINAL_DELIVERY_SQL` (Task 20), `MAIL_REPLAY_CEILING_ERROR` (`store.ts:227`),
  `isMailDeliveryState` / `type MailDeliveryState` (already imported).
- Produces:
  ```ts
  export type MarkAckedResult =
    | { ok: true; state: 'acked' }
    | { ok: false; why: 'absent' }
    | { ok: false; why: 'already-acked'; state: MailDeliveryState }
    | { ok: false; why: 'parked'; state: MailDeliveryState; lastError: string | null };
  markAcked(id: number, at: number): MarkAckedResult
  ```
  and the ack route's 200 body gains `parked: boolean` and `state: MailDeliveryState`, plus `lastError` on the
  parked arm. **Keep the signature on ONE line** (Task 26's scan walks back to it).

**Why:** `markAcked` returns a bare `boolean` and `routes.ts:762-763` turns it into `{ ok: true, already: !landed }`.
At the HTTP seam that collapses **two** conditions, not three — an absent delivery id already 404s
`unknown-recipient` at `routes.ts:756-759`, and nothing in the tree deletes a delivery row
(`grep -rn "DELETE FROM" --include=*.ts server/src` → one hit, `store.ts:2437`, on `feed_events`) — so what a
caller cannot distinguish is ALREADY-ACKED from PARKED. That matters to the worker protocol:
`ccd/worker-skill/SKILL.md:60` clause 3 is "Ack before you act", so a worker whose brief was parked (run
closed, attempt ceiling, replay ceiling, enter-ignored, reaped recipient) reads `already: true` as
confirmation and proceeds on a brief the coordinator's lane has permanently abandoned. Measured 2026-09-02:
`grep -rn 'already:' server/test/` → `mail-routes.test.ts:668, :672, :873` only, all three `toMatchObject`,
and no test acks a parked delivery over HTTP. Secondarily, the guard is a read-then-write across two
statements with no `BEGIN`; folding it into the UPDATE's own `WHERE` makes the decision atomic and leaves the
read doing only what it is good for — labelling the refusal.

- [ ] **Step 1: Write the failing test**

**(1a)** In `server/test/mail-routes.test.ts`, extend the import at `:13`
(`import { CoordStore } from '../src/coord/store.js';`):

```ts
import { CoordStore, MAIL_RUN_CLOSED_ERROR } from '../src/coord/store.js';
```

and insert inside `describe('POST /api/mail/:id/ack')`, after line **673** (the closing `  });` of
`acks once, and a second ack is not an error but is not a second ack either`):

```ts
  it('a PARKED delivery is not a double ack — the third answer, so a worker does not act on an abandoned brief', async () => {
    // D-1410. `already: true` meant BOTH "somebody already
    // acked this" and "this brief was abandoned and your ack changed nothing".
    // Worker-skill clause 3 is "Ack before you act", so the second reading is
    // the one that costs a wave: the worker sees confirmation and starts work
    // on a brief the coordinator's lane has given up on.
    const home = mkTmp('ccrc-mail-');
    seed(home, 'demo-quiet-mesa'); seed(home, 'demo-coordinator');
    const w = await withMail(home); app = w.app;
    await send(app, { ...GOOD, toId: 'demo-coordinator' });
    const deliveryId = ackIdFromEnvelope(w.coord.dueDeliveries(Date.now(), 60_000)[0]!.envelope);

    w.coord.rejectDelivery(deliveryId, 'undeliverable', MAIL_RUN_CLOSED_ERROR);

    const res = await ack(app, deliveryId, { fromId: 'demo-coordinator', fromUuid: UUID });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true, already: true, parked: true,
                                 state: 'rejected', lastError: MAIL_RUN_CLOSED_ERROR });
    // The row is untouched: an ack that did not land must not look like one
    // that did, in the body OR in the store.
    expect(w.coord.delivery(deliveryId)?.state).toBe('rejected');
  });

  it('a genuine double ack still says already, and says it is NOT parked', async () => {
    // The discriminator, in the other direction — without this the assertion
    // above is satisfied by a server that reports `parked: true` for
    // everything.
    const home = mkTmp('ccrc-mail-');
    seed(home, 'demo-quiet-mesa'); seed(home, 'demo-coordinator');
    const w = await withMail(home); app = w.app;
    await send(app, { ...GOOD, toId: 'demo-coordinator' });
    const deliveryId = ackIdFromEnvelope(w.coord.dueDeliveries(Date.now(), 60_000)[0]!.envelope);

    await ack(app, deliveryId, { fromId: 'demo-coordinator', fromUuid: UUID });
    const second = await ack(app, deliveryId, { fromId: 'demo-coordinator', fromUuid: UUID });
    expect(second.statusCode).toBe(200);
    expect(second.json()).toEqual({ ok: true, already: true, parked: false, state: 'acked' });
  });
```

Both `it`s are `async` — the bodies `await`, and a non-async callback does not compile.

**(1b)** In `server/test/coord-store.test.ts`, rewrite the five return-value assertions. Exact edits:

| line | from | to |
|---|---|---|
| 873 | `    expect(landed).toBe(false);` | `    expect(landed).toEqual({ ok: false, why: 'parked', state: 'rejected', lastError: MAIL_RUN_CLOSED_ERROR });` |
| 895 | `    expect(landed).toBe(true);` | `    expect(landed).toEqual({ ok: true, state: 'acked' });` |
| 905 | `    expect(s.markAcked(d.id, at + 1)).toBe(false);` | `    expect(s.markAcked(d.id, at + 1)).toEqual({ ok: false, why: 'already-acked', state: 'acked' });` |
| 923 | `    expect(s.markAcked(d.id, Date.now())).toBe(false);` | `    expect(s.markAcked(d.id, Date.now())).toEqual({ ok: false, why: 'parked', state: 'rejected', lastError: 'enter-ignored' });` |
| 1639 | `    expect(s.markAcked(acked, 1_776_000_000_000)).toBe(true);` | `    expect(s.markAcked(acked, 1_776_000_000_000)).toEqual({ ok: true, state: 'acked' });` |

`:873` is the scoped-verify H2 test, whose park comes from `cancelOutstandingDeliveries` — hence
`MAIL_RUN_CLOSED_ERROR`; if Task 22 has not landed, extend `:11`'s import the way Task 22 does.
`:923` is the narrowness test, whose park is `rejectDelivery(d.id, 'undeliverable', 'enter-ignored')`.

Add, in the same `describe` (after `:926`, or after Task 22's test if that has landed):

```ts
  it('markAcked tells an id that names no row apart from one it refuses', () => {
    // Unreachable through `POST /api/mail/:id/ack` — `coord.delivery(id)` 404s
    // `unknown-recipient` first, and nothing in this tree DELETEs a delivery
    // row — so the store is the only place this arm can be measured. It exists
    // because the store may not assume its caller pre-checked.
    const s = store();
    expect(s.markAcked(999_999, Date.now())).toEqual({ ok: false, why: 'absent' });
  });
```

**(1c)** In `server/test/mail-hardening.test.ts:173` and `:207`, and `server/test/coord-kickoff.test.ts:124`,
replace `.toBe(true)` with `.toEqual({ ok: true, state: 'acked' })`.

- [ ] **Step 2: Run it and watch it fail**
Run: `cd server && ./node_modules/.bin/vitest run test/mail-routes.test.ts -t "PARKED delivery is not a double ack"`
Expected: FAIL with
`expected { ok: true, already: true } to deeply equal { ok: true, already: true, parked: true, state: 'rejected', lastError: 'run closed' }`.
Also: `cd server && ./node_modules/.bin/vitest run test/coord-store.test.ts -t "markAcked"` → FAIL with
`expected false to deeply equal { ok: false, why: 'parked', state: 'rejected', lastError: 'run closed' }`.

- [ ] **Step 3: Implement**

**(3a)** `server/src/coord/store.ts` — add the result type at **MODULE SCOPE, outside the class**.
`export class CoordStore {` opens at `:453`, so it cannot go beside `markAcked`; put it directly under Task
24's `SetEnvelopeResult` (which sits under Task 20's `const TERMINAL_DELIVERY_SQL = …;`, ~`:230`; locator:
`grep -n 'export type SetEnvelopeResult' server/src/coord/store.ts`), keeping the delivery vocabulary in one
place the way `SetWorkItemResult` (`:106`) sits beside `TERMINAL_ITEM_STATES` (`:100`):

```ts
/** `markAcked`'s answer. The boolean it replaces collapsed the store's refusal
 *  reasons into one value, and at the HTTP seam collapsed ALREADY-ACKED with
 *  PARKED — `already: !landed` said the same thing about "somebody already
 *  acked this" and "this delivery was parked and your ack changed nothing".
 *  Worker-skill clause 3 is "Ack before you act", so the second one, read as
 *  the first, is a worker starting a wave on a brief the lane has abandoned.
 *  Same remedy as `bumpReplayCount`'s union below and `SetWorkItemResult`
 *  above: the union is the fix; the guard alone is not
 *  (D-1410). */
export type MarkAckedResult =
  | { ok: true; state: 'acked' }
  | { ok: false; why: 'absent' }
  | { ok: false; why: 'already-acked'; state: MailDeliveryState }
  | { ok: false; why: 'parked'; state: MailDeliveryState; lastError: string | null };
```

APPEND one paragraph to `markAcked`'s existing docstring (which already argues the H2 guard and the I2(b)
exception), replacing its closing `   *  through this door; every one of those stays refused, unchanged. */`
line with that text followed by:

```ts
   *
   *  THE GUARD IS NOW IN THE `WHERE`, not in the two `if`s that used to precede
   *  the write, and the I2(b) exception rides in the same clause as an `OR` on
   *  both columns. The SELECT no longer DECIDES — it only LABELS a refusal the
   *  UPDATE already made, which closes the read-then-write window this method
   *  carried: in-process it was airtight (synchronous `DatabaseSync`, no
   *  `await` between the two statements), but that safety was a property of the
   *  runtime, not of the row, and one added `await` would have removed it
   *  silently. An out-of-vocabulary `state` token still passes — the negative
   *  form is true of anything that is not in `TERMINAL_DELIVERY_STATES` — which
   *  is exactly the behaviour this method had before and is deliberately NOT
   *  changed here: whether an unnameable state is terminal is an open design
   *  question (D-1406), and answering it inside a refactor
   *  would be deciding it by accident. */
```

That paragraph must NOT respell the pair as `('acked','rejected')`. Task 20's scanner reads this file and
`holders` would receive `[ 'server/src/coord/store.ts' ]` the moment it did.

Replace the body (`:2283-2294` pre-Task-20) with:

```ts
  markAcked(id: number, at: number): MarkAckedResult {
    // UPDATE FIRST, then label. One statement decides; the read that follows is
    // only there to say WHICH refusal it was.
    const res = this.db.prepare(
      'UPDATE mail_deliveries SET state = ?, ackedAt = ?, '
      + 'lastGate = NULL, gateCount = 0, gateSince = NULL, gateAt = NULL '
      + `WHERE id = ? AND (state NOT IN ${TERMINAL_DELIVERY_SQL} `
      + "OR (state = 'rejected' AND rejectCode = 'undeliverable' AND lastError = ?))",
    ).run('acked', at, id, MAIL_REPLAY_CEILING_ERROR);
    if (Number(res.changes) > 0) return { ok: true, state: 'acked' };
    const row = this.db.prepare('SELECT state, lastError FROM mail_deliveries WHERE id = ?')
      .get(id) as { state: string; lastError: string | null } | undefined;
    if (!row) return { ok: false, why: 'absent' };
    const state: MailDeliveryState = isMailDeliveryState(row.state) ? row.state : 'unknown';
    if (row.state === 'acked') return { ok: false, why: 'already-acked', state };
    return { ok: false, why: 'parked', state, lastError: row.lastError };
  }
```

**(3b)** `server/src/coord/routes.ts` — replace `:762-763`
(`    const landed = coord.markAcked(id, Date.now());` / `    return reply.code(200).send({ ok: true, already: !landed });`):

```ts
    const acked = coord.markAcked(id, Date.now());
    if (acked.ok) {
      return reply.code(200).send({ ok: true, already: false, parked: false, state: acked.state });
    }
    if (acked.why === 'parked') {
      // The third answer. 200, because the REQUEST was well-formed, addressed
      // to this session and authenticated — nothing was rejected; what the
      // caller needs to know is that its ack landed on nothing. `already` keeps
      // its old value so a client that reads only that field behaves exactly as
      // before; `parked` is the POSITIVE marker, present in both directions, so
      // its absence means "this server does not know", never "not parked".
      return reply.code(200).send({ ok: true, already: true, parked: true,
                                    state: acked.state, lastError: acked.lastError });
    }
    if (acked.why === 'already-acked') {
      return reply.code(200).send({ ok: true, already: true, parked: false, state: acked.state });
    }
    // `'absent'` — unreachable from here: `coord.delivery(id)` above already
    // 404s an id that names no row, and nothing in this tree deletes one. Total
    // rather than dropped, and it answers with the SAME code that pre-check
    // does, because from the server's side that is what it is.
    return refuse(reply, 404, 'unknown-recipient', { fromId, fromUuid },
      'this delivery is not addressed to you');
```

Replace the route docstring's lines `:692-693` (`   * A second ack of an already-acked delivery is not an error — \`markAcked\`` /
`   * is idempotent — but it is not a second ack either: \`already: true\`.`) with:

```ts
   * A second ack of an already-acked delivery is not an error — `markAcked` is
   * idempotent — but neither is it a second ack (`already: true`, `parked:
   * false`). A PARKED delivery is a THIRD answer again (`parked: true`, with
   * the park's own `lastError`): the ack landed on nothing, and a worker that
   * treats `already` as confirmation would act on an abandoned brief.
```

**(3c)** `server/test/mail-routes.test.ts` — the kebab scanner at `:431` reads every quoted hyphenated token
under `server/src/coord` (regex `/'([a-z]+(?:-[a-z]+)+)'/g`, `:517`) and demands each be a declared code.
`'already-acked'` is neither a `MailRejectCode` nor a member of any of the five guards the scan consults, so
add ONE entry to the `NOT_CODES` set — after `'not-live'`, immediately before the closing `    ]);` at `:516`:

```ts
      'already-acked',        // store.ts `MarkAckedResult`'s refusal arm (wave 8) —
                              // the `bad-count`/`not-live` shape exactly: a
                              // store-internal spelling no wire carries. The ack
                              // route maps it to `{already:true, parked:false}`
                              // before any caller sees it, so admitting it to a
                              // wire union would put a never-wire word INTO the
                              // wire vocabulary to do it. Its siblings `absent`
                              // and `parked` are one word each and never reach
                              // this scan at all.
```

- [ ] **Step 4: Run it and watch it pass**
`cd server && ./node_modules/.bin/vitest run test/coord-store.test.ts`
`cd server && ./node_modules/.bin/vitest run test/mail-routes.test.ts`
`cd server && ./node_modules/.bin/vitest run test/mail-hardening.test.ts`
`cd server && ./node_modules/.bin/vitest run test/coord-kickoff.test.ts`
`cd server && ./node_modules/.bin/vitest run test/single-definition.test.ts` — the docstring paragraph
this task adds is in the file Task 20's scanner reads; this is the run that proves it did not respell the pair.
`cd server && ./node_modules/.bin/vitest run test/mail-sweep.test.ts test/sessionws.test.ts test/run-routes.test.ts test/mail-peer-quota.test.ts test/coord-health.test.ts`
`cd server && ./node_modules/.bin/vitest run test/typecheck-tests.test.ts`
`cd server && npm run build`

- [ ] **Step 5: MUTATION CHECK** — three mutations, three distinct reds. Each SQL mutation is a **pair of
edits**: the `WHERE` and the `.run(…)` argument list. `node:sqlite` throws `column index out of range` on a
surplus positional parameter (measured on node v24.14.1), so dropping a placeholder without dropping its bind
value reds on a binding error instead of on the answer — the wrong reason.

**(a) Collapse the seam:** in `routes.ts`, delete the whole `if (acked.why === 'parked') { … }` arm so a
parked ack falls through to the `already-acked` arm. Expect RED on `a PARKED delivery is not a double ack`
with
`expected { ok: true, already: true, parked: false, state: 'rejected' } to deeply equal { ok: true, already: true, parked: true, state: 'rejected', lastError: 'run closed' }`.
Right reason: that IS the two-into-one overload; and `a genuine double ack still says already` stays green, so
the red names the collapse, not a broken route.

**(b) Delete the SQL guard:** reduce the `WHERE` to `` + `WHERE id = ?`, `` **and** change the execution to
`.run('acked', at, id)`. Expect RED on `coord-store.test.ts -t "scoped-verify H2"` with
`expected { ok: true, state: 'acked' } to deeply equal { ok: false, why: 'parked', state: 'rejected', lastError: 'run closed' }`,
and the following row assertion showing `state: 'acked', rejectCode: 'undeliverable'`. Right reason: a park was
reopened into a self-contradictory row.

**(c) Widen the I2(b) exception:** replace the `OR (state = 'rejected' AND rejectCode = … AND lastError = ?)`
clause with `OR state = 'rejected'` **and** change the execution to `.run('acked', at, id)`. Expect RED on
`markAcked still refuses a DIFFERENT rejectCode:'undeliverable' park` (`coord-store.test.ts:916`) with
`expected { ok: true, state: 'acked' } to deeply equal { ok: false, why: 'parked', state: 'rejected', lastError: 'enter-ignored' }`.
The H2 test reds too, for the same widening; the narrowness test is the one that NAMES it, and it is the
mutant orchestrator ruling I2 calls out by name ("widen the markAcked exception to ALL rejected rows"). Right
reason: it proves the rewrite preserved the narrow exception rather than smuggling it wider.
Revert all three.

- [ ] **Step 6: Commit**
```bash
git add server/src/coord/store.ts server/src/coord/routes.ts server/test/coord-store.test.ts server/test/mail-routes.test.ts server/test/mail-hardening.test.ts server/test/coord-kickoff.test.ts && git commit -m "fix(wave8): markAcked answers a union and the ack route gives the third answer (D-1410)"
```

**LEDGER: D-1410** — `markAcked` returned a bare boolean that `routes.ts` turned into
`{ ok: true, already: !landed }`, so ALREADY-ACKED and PARKED were indistinguishable in the 200 body — and
worker-skill clause 3 is "Ack before you act", so a worker whose brief was parked read `already: true` as
confirmation and proceeded on an abandoned brief; `markAcked` now answers a union, its terminality test moved
into the UPDATE's own `WHERE` (closing the read-then-write window), and the route carries a positive `parked`
marker plus the park's own `lastError`.

---

### Task 26: The writer scan that makes the claim, and `CLAUDE.md`'s terminality clause rewritten, dated and pinned

**Files:**
- Modify: `server/test/mail-hardening.test.ts` — imports at `:5-10`; new top-level `describe` appended at EOF
  (the file is 212 lines).
- Modify: `CLAUDE.md:195` — the first line of the `## Open on \`main\`` paragraph.
  Locator: `grep -n 'terminality is incomplete' CLAUDE.md` → `195`.
- Test: `server/test/mail-hardening.test.ts`.

**Interfaces:**
- Consumes: `TERMINAL_DELIVERY_SQL` (Task 20), `setDeliveryEnvelope`'s guard and `SetEnvelopeResult` (Task 24),
  `markAcked`'s SQL guard and `MarkAckedResult` (Task 25). **This task MUST run last** — the scan is red until
  all three have landed.
- Produces: none.

**Why:** `CLAUDE.md:195` says "`MailDeliveryState` terminality is incomplete (some writers lack the guard)".
Measured 2026-09-02:
`git log --oneline --format='%h %ad %s' --date=short -S 'MailDeliveryState\` terminality is incomplete' -- CLAUDE.md`
→ exactly one commit, `49df54a9`, **2026-08-12** — the sentence has never been reworded, while guards landed
at `fb312a46` (2026-08-10), `5821bbe6` (2026-08-24) and `9f805510` (2026-08-28). It is literally TRUE
(`setDeliveryEnvelope` genuinely lacked a guard until Task 24) and uselessly vague: it names no writer, so
nobody can tell whether it has been fixed. Rewrite-and-date it, the `4810ddac` precedent — and back BOTH of
its claims with a mechanism instead of a promise. Measured pre-wave at `5e9f650d` (reproduce with the command
in Step 2): **11** `UPDATE mail_deliveries` prepared statements in `store.ts`, of which **3** named a shared
guard fragment and **8** did not.

- [ ] **Step 1: Write the failing test**

Extend `server/test/mail-hardening.test.ts`'s imports (`:5-10` — `path` is already imported at `:6`):

```ts
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
```

Append at EOF:

```ts
// D-1411. The audit, as a mechanism instead of a sentence.
// Every `UPDATE mail_deliveries` in the store must name one of the TWO shared
// guard fragments — `OUTSTANDING_STATES_SQL` (the positive form: this write is
// only for a row still in play) or `TERMINAL_DELIVERY_SQL` (the negative form:
// this write is for any row that is not finished). A hand-written state list
// fails this too, which is deliberate: it is the same rule the single-definition
// scans state, said once more at the point of use.
//
// This is what lets `CLAUDE.md`'s "Open on main" section stop hedging. It scans
// TEXT, and that limitation is worth stating: it cannot tell a guard that is
// correct from one that is merely present, and it does not reach `server/test`,
// where a fixture may still write raw SQL (`coord-health.test.ts` does, on
// purpose). The bar is "a twelfth writer added in the ordinary way is stopped
// before review".
describe('every delivery-row writer names a shared terminality guard (wave 8)', () => {
  const ccrcRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
  const storeSrc = readFileSync(path.join(ccrcRoot, 'server/src/coord/store.ts'), 'utf8');
  const srcLines = storeSrc.split('\n');

  /** A single-line method signature at class-member indent, e.g.
   *  `  markIngested(id: number, at: number): void {`. Single-line ON PURPOSE:
   *  the walk-back below names the writer by finding the nearest one above the
   *  statement, and a signature split across lines would silently attribute a
   *  statement to the PREVIOUS method. The `^  }` check guards exactly that. */
  const SIG = /^ {2}(?:private |public |static |readonly )*([A-Za-z_$][\w$]*)\(.*\)\s*:\s*(.+?)\s*\{\s*$/;

  /** Every prepared statement in `store.ts` that writes a delivery row, sliced
   *  from `this.db.prepare(` to the call that executes it, and tagged with the
   *  method it lives in. Anchored on `prepare(` rather than on the SQL verb so
   *  that PROSE naming the table — a docstring explaining one of these guards —
   *  can never be counted as a twelfth statement. */
  const writers = (): { line: number; method: string; returns: string; text: string }[] => {
    const out: { line: number; method: string; returns: string; text: string }[] = [];
    const EXEC = /\.(?:run|get|all|iterate)\(/;
    for (const m of storeSrc.matchAll(/this\.db\.prepare\(/g)) {
      const at = m.index!;
      const rest = storeSrc.slice(at);
      const e = EXEC.exec(rest);
      expect(e, `the prepare( at offset ${at} never reaches an execution call`).not.toBeNull();
      const text = rest.slice(0, e!.index);
      if (!/UPDATE mail_deliveries\b/.test(text)) continue;
      const line = storeSrc.slice(0, at).split('\n').length;
      let sigLine = 0;
      for (let i = line - 1; i > 0; i--) { if (SIG.test(srcLines[i - 1]!)) { sigLine = i; break; } }
      expect(sigLine, `no method signature above the delivery write at store.ts:${line}`)
        .toBeGreaterThan(0);
      // If a method CLOSED between that signature and this statement, the
      // walk-back left its own method and the name below would be a lie.
      const between = srcLines.slice(sigLine, line - 1).join('\n');
      expect(/^ {2}\}/m.test(between),
        `the walk-back from store.ts:${line} crossed a method close — its signature is not single-line`)
        .toBe(false);
      const sig = SIG.exec(srcLines[sigLine - 1]!)!;
      out.push({ line, method: sig[1]!, returns: sig[2]!, text });
    }
    return out;
  };

  it('finds every one of them — a renamed table or a rewritten call shape must red this, not disarm it', () => {
    const found = writers();
    // A FLOOR, not a count: eleven at 5e9f650d (2026-09-02), and a twelfth
    // writer raises it rather than breaking it. Without this the assertion in
    // the next test is satisfied by an extractor that found nothing.
    expect(found.length).toBeGreaterThanOrEqual(11);
    // …and each window is a STATEMENT, not a runaway slice that swallowed the
    // next method's docstring. Measured max at 5e9f650d: 498 characters, and
    // none contains a JSDoc terminator.
    for (const w of found) {
      expect(w.text.includes('*/'), `store.ts:${w.line}'s window swallowed a docstring`).toBe(false);
      expect(w.text.length, `store.ts:${w.line}'s window is implausibly long`).toBeLessThan(1000);
      expect(w.method.length, `store.ts:${w.line} resolved to an empty method name`).toBeGreaterThan(0);
    }
    // Eleven statements in eleven distinct methods — a duplicate name means the
    // walk-back attributed two statements to one signature.
    expect(new Set(found.map((w) => w.method)).size).toBe(found.length);
  });

  it('names OUTSTANDING_STATES_SQL or TERMINAL_DELIVERY_SQL, never a hand-written state list', () => {
    for (const w of writers()) {
      expect(/OUTSTANDING_STATES_SQL|TERMINAL_DELIVERY_SQL/.test(w.text),
        `store.ts:${w.line} (${w.method}) writes a delivery row with no shared terminality guard`).toBe(true);
    }
  });

  it("CLAUDE.md names exactly the delivery-row writers that still return void", () => {
    // THE OTHER HALF OF THE SENTENCE, as a mechanism. The clause this replaces
    // sat unreworded from 2026-08-12 while three guard commits landed after it,
    // because nothing measured it. This derives the list from source and
    // compares both directions, so widening one of these writers reds here and
    // the sentence has to move with the code.
    const md = readFileSync(path.join(ccrcRoot, 'CLAUDE.md'), 'utf8').replace(/\s+/g, ' ');
    // Flattened first, the way `box-token-census.test.ts` flattens its own
    // corpus and for the same reason: this is hard-wrapped prose and a
    // backticked name routinely sits either side of a newline.
    const MARK = 'still return `void` are ';
    expect(md, 'CLAUDE.md no longer carries the void-writer sentence this test reads')
      .toContain(MARK);
    const span = md.slice(md.indexOf(MARK) + MARK.length);
    const listed = span.slice(0, span.indexOf('.'));
    const named = [...listed.matchAll(/`([A-Za-z_$][\w$]*)`/g)].map((m) => m[1]!);
    expect(named, 'the void-writer list in CLAUDE.md came out empty — was the sentence reworded?')
      .not.toEqual([]);
    const voids = writers().filter((w) => w.returns === 'void').map((w) => w.method);
    expect([...named].sort(), 'CLAUDE.md and store.ts disagree about which delivery writers return void')
      .toEqual([...voids].sort());
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Establish the pre-wave measurement first — it is reproducible from git, no reverting required:

```bash
git show 5e9f650d:server/src/coord/store.ts | python3 -c "
import sys, re
src = sys.stdin.read()
EXEC = re.compile(r'\.(?:run|get|all|iterate)\(')
g, u = [], []
for m in re.finditer(r'this\.db\.prepare\(', src):
    rest = src[m.start():]; e = EXEC.search(rest); text = rest[:e.start()]
    if not re.search(r'UPDATE mail_deliveries\b', text): continue
    ln = src[:m.start()].count(chr(10)) + 1
    (g if re.search(r'OUTSTANDING_STATES_SQL|TERMINAL_DELIVERY_SQL', text) else u).append(ln)
print('guarded', len(g), g); print('unguarded', len(u), u)"
```
Expected, verbatim: `guarded 3 [714, 763, 993]` / `unguarded 8 [2065, 2180, 2222, 2244, 2290, 2324, 2351, 2372]`.

Then take the red on the live tree by applying Step 5's mutation (a) BEFORE writing the test, confirming
`cd server && ./node_modules/.bin/vitest run test/mail-hardening.test.ts` is GREEN with the guard gone —
that is the gap. Revert, add the tests, and re-apply in Step 5.
Run: `cd server && ./node_modules/.bin/vitest run test/mail-hardening.test.ts -t "names OUTSTANDING_STATES_SQL"`
Expected on the clean post-Task-25 tree: PASS.

- [ ] **Step 3: Implement**

No source change — Tasks 20, 24 and 25 already did it. Replace `CLAUDE.md:195`, which currently reads:

```
`MailDeliveryState` terminality is incomplete (some writers lack the guard); `FleetIO.readFile`'s docstring now
```

with:

```
`MailDeliveryState` terminality: as of **2026-09-02 (wave 8)** every `UPDATE mail_deliveries` in
`server/src/coord/store.ts` names one of two shared guard fragments — `OUTSTANDING_STATES_SQL` or
`TERMINAL_DELIVERY_SQL`, the latter built by `.join` from L0's `TERMINAL_DELIVERY_STATES` (`shared/api.ts`) —
pinned by `mail-hardening.test.ts`'s writer scan and, against a second hand-written copy in SQL or in JS, by
two scans in `single-definition.test.ts`. STILL OPEN, and do not assume otherwise. The delivery-row writers
that still return `void` are `cancelKickoffsTo`, `repointCoordinatorMail`, `cancelOutstandingDeliveries`,
`markDelivered`, `markIngested`, `backOff`, `noteGate` and `rejectDelivery`. Their guard is invisible to the
caller — the defect `store.ts`'s own `SetWorkItemResult` docstring names `markDelivered` as the archetype of,
and `watch.ts`'s `sweepMail` leans on `bumpReplayCount`'s union to cover `markDelivered`'s silence in its
replay branch. And an out-of-vocabulary `state` token (the column is `schema.ts:138-139`; the deploy-rollback
that can reach it is argued at `schema.ts:41-45`) is LIVE to every negative-form guard and to `markAcked`,
while `dueDeliveries` and the positive-form writers treat it as not-outstanding — an asymmetry nothing has
ruled on. `FleetIO.readFile`'s docstring now
```

The sentence beginning `The delivery-row writers that still return \`void\` are ` is READ BY THE TEST above:
it slices from that literal to the next `.` and compares the backticked names against the set derived from
`store.ts`. Reword it freely, but keep the marker and the terminating period, or update the test in the same
commit.

- [ ] **Step 4: Run it and watch it pass**
`cd server && ./node_modules/.bin/vitest run test/mail-hardening.test.ts`
`cd server && ./node_modules/.bin/vitest run test/single-definition.test.ts test/coord-store.test.ts test/mail-routes.test.ts test/mail-sweep.test.ts test/coord-db.test.ts test/coord-health.test.ts`
`cd server && ./node_modules/.bin/vitest run test/topology-clean.test.ts` — `CLAUDE.md` is in that scan's
corpus; the new prose names no host, account or tailnet, and this is the run that says so.
`cd server && ./node_modules/.bin/vitest run test/box-token-census.test.ts` — the other test that reads
`CLAUDE.md`; it slices the box-token bullet, which this edit does not touch.
`cd server && ./node_modules/.bin/vitest run test/typecheck-tests.test.ts test/node-floor.test.ts`
`cd pwa && ./node_modules/.bin/vitest run test/mail-strip.test.tsx`

- [ ] **Step 5: MUTATION CHECK** — three mutations.

**(a) Guard deletion, on a writer this file does not otherwise test:** in `server/src/coord/store.ts`, drop
`` AND state NOT IN ${TERMINAL_DELIVERY_SQL} `` from `setDeliveryEnvelope` (Task 24's guard) so the statement
reads `'UPDATE mail_deliveries SET envelope = ? WHERE id = ?'` (binds unchanged, so no parameter-count
error). Expect RED on `cd server && ./node_modules/.bin/vitest run test/mail-hardening.test.ts` with
`store.ts:<line> (setDeliveryEnvelope) writes a delivery row with no shared terminality guard` — and NOTHING
ELSE in that file reds, which is the point: `setDeliveryEnvelope` has no behavioural test here, so this scan
is the only thing in this file that can see the guard leave. (`coord-store.test.ts` reds too, on Task 24's own
test; that is the behavioural half, run it to confirm both.)

**(b) Extractor inertness:** rename the table in ONE statement — `cancelKickoffsTo`'s, at the top of the file —
to `UPDATE mail_deliveries_x`. Expect RED on the floor test with
`expected 10 to be greater than or equal to 11`. Right reason: this is the drift the floor exists to catch —
a scan that quietly stops finding things. `\b` is load-bearing here and was measured: `/UPDATE mail_deliveries\b/`
does NOT match `UPDATE mail_deliveries_x` (there is no word boundary between `s` and `_`), while an
unanchored `/UPDATE mail_deliveries/` still would and the mutation would be completely inert.
`mail-hardening.test.ts` reds ONLY on the floor test under this mutation; on the full suite it also breaks the
reclaim behaviour in `coord-store.test.ts`, which is expected and is not the measurement.

**(c) The CLAUDE.md census:** delete `` `noteGate` `` from the void-writer list in `CLAUDE.md`. Expect RED on
`CLAUDE.md names exactly the delivery-row writers that still return void` with
`CLAUDE.md and store.ts disagree about which delivery writers return void`, the received array missing
`noteGate`. Right reason: this is exactly the failure mode the task's own Why measured — a sentence about
these guards drifting out of true with nothing to notice.
Revert all three.

- [ ] **Step 6: Commit**
```bash
git add server/test/mail-hardening.test.ts CLAUDE.md && git commit -m "docs+test(wave8): the writer scan that makes the audit a mechanism, and CLAUDE.md's terminality clause rewritten, dated and pinned (D-1411)"
```

**LEDGER: D-1411** — `CLAUDE.md:195`'s "some writers lack the guard" was literally true
and uselessly vague: added 2026-08-12 (`49df54a9`) and never reworded while three separate guard commits
landed after it; rewritten and dated the way `4810ddac` dated the two surviving counts, and backed by two
mechanisms over `store.ts` — a writer scan asserting every delivery-row `UPDATE` names a shared guard
fragment, and a census asserting the sentence's own list of `void`-returning writers is the one the source
actually has.

**LEDGER: D-1412** — `markDelivered`, `markIngested`, `backOff`, `noteGate`,
`rejectDelivery`, `cancelKickoffsTo`, `repointCoordinatorMail` and `cancelOutstandingDeliveries` still return
`void`, so their guards are invisible to the caller — deferred out of this wave because it changes eight
signatures and every `watch.ts` call site in `sweepMail`; the one live consequence is recorded:
`watch.ts:2733` calls `markDelivered`, then branches at `:2739` on its OWN pre-call `d.deliveredAt` snapshot,
so a skipped write is caught only by `bumpReplayCount`'s union at `:2744` — one method's silence covered by a
second method's union.

**LEDGER: D-1406** — *allocated and defined at Task 20*, which is the first task to
write the ref into shipped source. Restated here only because this task's writer census is where the
disagreement is finally measured; it takes no second number.

---

### Open decisions this section deliberately does not take

1. **The unknown-token ruling.** Should an out-of-vocabulary `state` be TERMINAL (fail shut — refuse every
   write including the ack) or LIVE (today's behaviour of all six negative-form guards)? FOR fail-shut: the
   tree's own doctrine says acking a state you cannot name is a guess, and the reachability is real
   (`schema.ts:41-45` argues the deploy-rollback case). AGAINST: it is a behaviour change, not a refactor, and
   it would strand such a row permanently — `dueDeliveries` already refuses to select it, so the ack route is
   its only door. Tasks 20 and 25 both preserve today's behaviour and say so in their docstrings.
2. **The scope of the void-writer closure.** All eight, or `markDelivered` alone — the only one with a traced
   live consequence (`watch.ts:2733`/`:2739`)? A scope call; the measured justification is in the ledger entry
   so the follow-up need not re-derive it.
3. **The ack route's status code for a parked delivery.** 200 with `parked: true` was chosen over a 4xx: the
   request was well-formed, authenticated and correctly addressed, and `refuse()` (`routes.ts:371-378`) both
   RECORDS a rejection row and demands a `MailRejectCode`, so a 409 would mean minting `'delivery-parked'`
   into `MAIL_REJECT_CODES` and through `mail-routes.test.ts`'s both-directions membership scan.
   `ccd/ccrc-api:253` (`cat "$out"`) prints the whole body on every status, so both shapes are equally visible
   to a worker; the choice is about what the answer MEANS, not about visibility.
4. **Whether to keep the legacy `already` field.** Nothing in `pwa/src`, `agent/src` or `ccd` consumes it;
   only `mail-routes.test.ts:668, :672, :873` assert it, all three with `toMatchObject`. It is kept with its
   exact current value (`!ok`) so a worker mid-wave holding the old shape is not surprised. A clean break
   would drop it and update those three.
5. **Where Task 26's writer scan should live.** It is in `mail-hardening.test.ts` (the file whose `describe`
   is literally named "terminality guards"), not `single-definition.test.ts` (which is about
   one-definition-per-value, a different claim). It moves without change if a reviewer prefers otherwise.

## Work item 3 — the ledger procedure (Tasks 40–48)

Every anchor and cardinal below was re-opened at HEAD `5e9f650d` on 2026-09-02 (worktree clean,
`git rev-parse HEAD` → `5e9f650d36a39b1cb0482411c673315b5dd0ca0b`). Where a number could move, the
task asserts the PROPERTY and names a dated exemplar instead.

Deviation numbers are **not** allocated here. Each task names `D-TBD-<slug>` markers; the executor
allocates from `POST /api/ledger/deviations` and defines in the same act.

---

### Task 40: `whoami` refuses unless the identity is provably this pane's

**Files:**
- Modify: `ccd/ccrc-api:147-162` (the identity comment + `cmd_whoami`, exactly as quoted below)
- Test: `server/test/ccrc-api.test.ts` — the harness `run()` at `:84-97`, and the
  `describe('whoami')` block at `:367-375` (the file is 375 lines)

**Interfaces:**
- Consumes: nothing new
- Produces: `derive_identity()` setting `DERIVED_ID` / `DERIVED_UUID`, or refusing with `no-pane` /
  `bad-pane` / `no-tmux` / `bad-session` / `no-uuid`. Harness: `run(args, input?, overrides?)` where
  an `undefined` value DELETES the variable; `plantPane(id, uuid?)`; `tmuxArgv()`.

**Why:** For a caller with no pane, `whoami` does not fail — it returns SOMEONE ELSE'S identity and
exits 0. Measured on the fleet host three times across 2026-09-02, most recently at 15:1x UTC:
`env -i HOME=$HOME PATH=/usr/bin:/bin tmux display-message -p '#S'` exits 0 naming the
most-recently-active session, and on that last run it named `cc-intake-platform-keen-meadow` while
the caller's own pane (`$TMUX_PANE` = `%184`) belonged to `cc-ccrc-pwa-quiet-meadow`. The three runs
named different sessions, which is why the guard asserts the property and no session name or
timestamp goes into shipped source. tmux resolves from `TMUX_PANE`, not `$TMUX`
(`tmux display-message -p -t "$TMUX_PANE" '#S'` → `cc-ccrc-pwa-quiet-meadow`, rc 0), so a `$TMUX`
gate would be right only by accident. And `ccd/ccrc-api:154`'s refusal detail
`'not inside a tmux session'` is measured-false on any box running a tmux server.

- [ ] **Step 1: Write the failing test**

First, **add `harnessBin` to the EXISTING import at `server/test/ccrc-api.test.ts:20`** — that line
already reads `import { CCRC_API, ghContainedEnv } from './ccdWsHelpers.js';`, so a second import
statement is a duplicate-identifier compile error (TS2300), not an addition. It becomes:

```ts
import { CCRC_API, ghContainedEnv, harnessBin } from './ccdWsHelpers.js';
```

Then REPLACE the body of `run()` at `:84-97` — keep its docstring at `:75-83` untouched — and add
the two helpers after `const runBoth = run;` at `:102`:

```ts
function run(args: string[], input?: string,
             overrides?: Record<string, string | undefined>): Promise<Run> {
  const env = ghContainedEnv(home, { ...process.env, HOME: home }, { systemd: true, tmux: true });
  // EXPLICIT, NEVER INHERITED. `process.env` is spread above, so a developer
  // running this suite inside a tmux pane hands the child a real TMUX_PANE and
  // the "no pane" case would measure their terminal instead of the fixture.
  // `undefined` DELETES — the state cron and CI are actually in.
  for (const [k, v] of Object.entries(overrides ?? {})) {
    if (v === undefined) delete env[k]; else env[k] = v;
  }
  return new Promise<Run>((resolve) => {
    const child = spawn(CCRC_API, args, { env });
    let stdout = '', stderr = '';
    child.stdout.on('data', (c) => { stdout += c; });
    child.stderr.on('data', (c) => { stderr += c; });
    // stdin is CLOSED unless a test supplies input. Left open, `--json -` would
    // block in `cat` forever — the client is right to wait, so the harness must
    // be explicit about there being nothing to read.
    if (input !== undefined) child.stdin.end(input); else child.stdin.end();
    child.on('close', (code) => resolve({ stdout, stderr, status: code ?? -1 }));
  });
}

/** A tmux that ANSWERS, planted where `ghContainedEnv`'s poison cannot displace
 *  it: `ccdWsHelpers.ts:233` is `if (fs.existsSync(p)) continue;`, so the stub
 *  loop SKIPS a file already there, and `harnessBin` is the first PATH entry
 *  (`ccdWsHelpers.ts:109-122, :245`). Every test plants before it calls `run`,
 *  so this is the tmux the client meets — NOT a vacuous fixture.
 *
 *  It logs argv to the SAME `$HOME/tmux-calls` the poison stub uses
 *  (`ccdWsHelpers.ts:229`), so `tmuxArgv()` reads one file whichever stub is in
 *  place, and a test can prove the pane was passed as an explicit target. */
const plantPane = (id: string, uuid = 'u-1234'): void => {
  fs.writeFileSync(path.join(harnessBin(home), 'tmux'),
    `#!/bin/sh\nprintf '%s\\n' "$*" >> "$HOME/tmux-calls"\nprintf 'cc-${id}\\n'\n`,
    { mode: 0o755 });
  fs.mkdirSync(path.join(home, '.cc-sessions'), { recursive: true });
  fs.writeFileSync(path.join(home, '.cc-sessions', `${id}.uuid`), `${uuid}\n`);
};

/** Every argv the tmux on PATH saw. Absent file == no calls. */
const tmuxArgv = (): string[] => {
  const p = path.join(home, 'tmux-calls');
  return fs.existsSync(p) ? fs.readFileSync(p, 'utf8').split('\n').filter(Boolean) : [];
};
```

Now REPLACE `describe('whoami')` at `:367-375` entirely:

```ts
describe('whoami: the pane is the proof', () => {
  it('answers for THIS pane, and names it as an explicit target', async () => {
    plantPane('demo-ws');
    const r = await run(['whoami'], undefined, { TMUX_PANE: '%7' });
    expect(r.status).toBe(0);
    expect(JSON.parse(r.stdout)).toEqual({ id: 'demo-ws', uuid: 'u-1234' });
    expect(tmuxArgv()[0], 'tmux was asked about the BOX, not about this pane')
      .toContain('-t %7');
  });

  it('refuses with NO pane even though tmux would gladly answer', async () => {
    // THE PRESENCE THE ABSENCE NEEDS: the stub SUCCEEDS and names a session that
    // is not the caller's, which is exactly what the real binary does — measured
    // 2026-09-02 from `env -i`, exit 0, another project's session.
    plantPane('someone-else');
    const r = await run(['whoami'], undefined, { TMUX_PANE: undefined, TMUX: undefined });
    // ASSERTED FIRST, deliberately: this is the live defect, and a mutation that
    // reopens it should red with the leaked identity in the message rather than
    // with `expected 0 not to be 0`.
    expect(r.stdout + r.stderr, 'it answered with another session identity')
      .not.toContain('someone-else');
    expect(r.status).not.toBe(0);
    expect(r.stdout).toContain('no-pane');
    expect(tmuxArgv(), 'tmux was shelled before the gate decided').toEqual([]);
  });

  it('refuses a TMUX_PANE that is not a pane id — the forgery door', async () => {
    // `-t` accepts a SESSION name, so an unvalidated `TMUX_PANE=cc-other` asks
    // tmux about someone else's session and is believed.
    plantPane('demo-ws');
    const r = await run(['whoami'], undefined, { TMUX_PANE: 'cc-someone-else' });
    expect(tmuxArgv(), 'a session NAME reached -t as though it were a pane').toEqual([]);
    expect(r.status).not.toBe(0);
    expect(r.stdout).toContain('bad-pane');
  });

  it('says tmux could not answer FOR THIS PANE, not that there is no session', async () => {
    // No plantPane: the harness's own poisoned tmux answers rc 97 and prints
    // nothing (`ccdWsHelpers.ts:229,235-239`), which is the "tmux refused" case.
    const r = await run(['whoami'], undefined, { TMUX_PANE: '%7' });
    expect(r.status).not.toBe(0);
    expect(r.stdout).toContain('could not answer for this pane');
    expect(r.stdout, 'the measured-false detail is back')
      .not.toContain('not inside a tmux session');
  });

  it('refuses when the registry has no uuid for the derived id', async () => {
    // A REGRESSION PIN CARRIED ACROSS THE REWRITE, not a new guard: today's
    // client already refuses here, so this case is green before and after. It is
    // written down because the rewrite moves the check into a new function, and
    // its mutation (Step 5 (iv)) is what makes it more than decoration.
    plantPane('demo-ws');
    fs.rmSync(path.join(home, '.cc-sessions', 'demo-ws.uuid'));
    const r = await run(['whoami'], undefined, { TMUX_PANE: '%7' });
    expect(r.status).not.toBe(0);
    expect(r.stdout).toContain('no-uuid');
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `cd server && ./node_modules/.bin/vitest run test/ccrc-api.test.ts -t "pane"`

Expected: FAIL —
- *answers for THIS pane*: `tmux was asked about the BOX, not about this pane: expected 'display-message -p #S' to contain '-t %7'`
- *refuses with NO pane*: `it answered with another session identity: expected '{"id":"someone-else","uuid":"u-1234"}\n' not to contain 'someone-else'`
- *the forgery door*: `a session NAME reached -t as though it were a pane: expected [ 'display-message -p #S' ] to deeply equal []`
- *could not answer FOR THIS PANE*: `expected '{"ok":false,"error":"no-tmux","detail":"not inside a tmux session; identity cannot be derived"}\n' to contain 'could not answer for this pane'`
- *no uuid*: PASSES already (stated above).

- [ ] **Step 3: Implement** — replace `ccd/ccrc-api:147-162` in full:

```bash
# Attribution, not authentication: the one fact not carried in any payload is
# what tmux says about the pane this runs in.
#
# THE VARIABLE THAT DECIDES IS `TMUX_PANE`, NOT `$TMUX`, and that gate is the
# whole guard. `tmux display-message -p '#S'` with no pane in the environment
# does NOT refuse on a box running a tmux server — it answers for the MOST
# RECENTLY ACTIVE session and exits 0. Measured on the fleet host three times
# across 2026-09-02: from `env -i` the same binary named a DIFFERENT session on
# each run, and on the last one it named another project's session while the
# caller's own pane belonged to this one. A caller with no pane therefore got a
# complete, confident, WRONG identity. WHICH session it names is a race, so no
# cardinal about it belongs in this file; the property is what is guarded. The
# detail this refusal used to carry — 'not inside a tmux session' — was itself
# false on any box that has panes at all.
#
# THE PANE ID IS VALIDATED BEFORE IT IS PASSED, and that check is load-bearing
# rather than tidy: `-t` accepts a SESSION name, so an unvalidated TMUX_PANE of
# `cc-other` would ask tmux about someone else's session and be believed.
#
# TWO REFUSAL CODES, NOT ONE. 'no-pane' (you are not in a pane) and 'bad-pane'
# (your TMUX_PANE is not a pane id) are different facts to whoever reads them —
# "run me inside a session" against "your environment is lying" — and collapsing
# them is the overloaded value this repo forbids at a seam.
DERIVED_ID=''
DERIVED_UUID=''
derive_identity() {   # sets DERIVED_ID / DERIVED_UUID, or refuses. NEVER call it
                      # inside $( ): `refuse` prints the envelope on stdout and a
                      # substitution would swallow it (`server_url` has that shape).
  local pane tname
  # READ ONCE into a local, so `set -u` (line 43) cannot turn a deleted gate
  # below into an unbound-variable error instead of the misattribution the gate
  # is there to stop. A guard whose removal fails for the wrong reason is a
  # guard nobody has actually measured.
  pane="${TMUX_PANE:-}"
  [[ -n "$pane" ]] \
    || refuse 'no-pane' 'not inside a tmux pane (TMUX_PANE unset); identity cannot be derived'
  [[ "$pane" =~ ^%[0-9]+$ ]] \
    || refuse 'bad-pane' 'TMUX_PANE is not a pane id'
  tname=$(tmux display-message -p -t "$pane" '#S' 2>/dev/null) \
    || refuse 'no-tmux' 'tmux could not answer for this pane'
  [[ -n "$tname" ]] || refuse 'no-tmux' 'tmux named no session for this pane'
  DERIVED_ID="${tname#cc-}"
  [[ "$DERIVED_ID" =~ $SAFE_RE ]] || refuse 'bad-session' 'tmux session name is not a usable id'
  [[ -r "$REG/$DERIVED_ID.uuid" ]] || refuse 'no-uuid' "no $REG/$DERIVED_ID.uuid for this session"
  DERIVED_UUID=$(tr -d '[:space:]' < "$REG/$DERIVED_ID.uuid")
  [[ -n "$DERIVED_UUID" ]] || refuse 'no-uuid' "$REG/$DERIVED_ID.uuid is empty"
}

cmd_whoami() {
  derive_identity
  printf '{"id":"%s","uuid":"%s"}\n' "$DERIVED_ID" "$DERIVED_UUID"
}
```

This keeps the `=~ $SAFE_RE` count at 3, which is what `ccrc-api-closed.test.ts:143-144`'s
`toBeGreaterThanOrEqual(3)` pins (measured at HEAD: 3).

- [ ] **Step 4: Run it and watch it pass**

`cd server && ./node_modules/.bin/vitest run test/ccrc-api.test.ts test/ccrc-api-closed.test.ts test/ccrc-api-ship.test.ts`

- [ ] **Step 5: MUTATION CHECK**
  - **(i) delete the two pane-gate lines** (`[[ -n "$pane" ]] || refuse 'no-pane' …` and
    `[[ "$pane" =~ ^%[0-9]+$ ]] || refuse 'bad-pane' …`), leaving `pane=""` to flow into `-t ""`:
    expect RED on *refuses with NO pane* —
    `it answered with another session identity: expected '{"id":"someone-else","uuid":"u-1234"}\n' not to contain 'someone-else'`.
    RIGHT REASON: that output is the live misattribution, restored.
  - **(ii) drop `-t "$pane"` from the `display-message` call**: expect RED on *answers for THIS
    pane* — `expected 'display-message -p #S' to contain '-t %7'`. RIGHT REASON: without the
    target, tmux answers about the box.
  - **(iii) delete only the `^%[0-9]+$` line**: expect RED on *the forgery door* —
    `a session NAME reached -t as though it were a pane: expected [ 'display-message -p -t cc-someone-else #S' ] to deeply equal []`.
  - **(iv) delete BOTH `no-uuid` refusals** (the `-r` and the `-n` line — they overlap on purpose,
    so removing one alone is inert and proves nothing): expect RED on *refuses when the registry has
    no uuid* — `expected 0 not to be +0`, the client having printed `{"id":"demo-ws","uuid":""}`.

  Revert each.

- [ ] **Step 6: Commit**

```bash
git add ccd/ccrc-api server/test/ccrc-api.test.ts && git commit -m "fix(wave8): whoami answered for the most-recently-active session, not this pane (D-1413)"
```

**LEDGER: D-1413** — `ccrc-api whoami` gated on nothing, so a caller with no pane
got the MOST RECENTLY ACTIVE session's id and uuid with exit 0 (measured three times on the fleet
host on 2026-09-02, a different session each time), and its refusal detail
`'not inside a tmux session'` was itself false on any box running a tmux server; it now gates on
`TMUX_PANE`, validates the pane id — because `-t` accepts a session NAME and would otherwise be a
forgery door — and passes the pane as an explicit target.

---

### Task 41: `ledger allocate` carries an identity or refuses; `--by` is the documented door

**Files:**
- Modify: `ccd/ccrc-api` — the `derive_identity` header block (Task 40), `usage()` at
  `:107-118`, the arg loop at `:192-209` and the body read ending at `:219`
  **The ROUTES row-count sentences at `:24` and `:62` are NOT this task's.** An earlier draft of this
  task fixed them too; Task 64 owns them, with a guard that DERIVES the count from the table rather
  than forbidding any count, and with the second false claim in the same sentence (`Measured from
  both corpora`) that this task's version would have left standing. Leave both lines alone here.
- Test: `server/test/ccrc-api.test.ts` (new describe after the whoami block),
  `server/test/ccrc-api-closed.test.ts:91-99`

**Interfaces:**
- Consumes: `derive_identity()`, `DERIVED_ID`, `plantPane`, `run(args, input?, overrides?)` (Task 40)
- Produces: refusal codes `bad-by`, `bad-body`; the `--by <id>` flag, accepted on the
  `ledger.allocate` row alone

**Why:** Measured 2026-09-02 via `~/.local/bin/ccrc-api ledger list --project ccrc-pwa | jq`: **101**
allocations carry `allocatedTo: ''` — all of them `state: landed`, highest `n` 1065 — because the
documented body omits `byId` and `routes.ts:2126` writes `allocatedTo: byId ?? ''`, an omitted field
and an explicit empty string reaching one column. That 101 is a FLOOR that can only grow: `grep -rn
allocatedTo server/src | grep -i update` finds no UPDATE path, and `LedgerLog.append`
(`ledgerlog.ts:34-40`) has already written each row's `allocatedTo` into the append-only log. The
route may not change (operator ruling), and `server/src/auth/gate.ts:256-259` keeps it EXEMPT from
the session gate precisely so *"a session that cannot reach the allocator must not invent a number"*
— while `CONTRIBUTING.md:66-70` sends outside contributors to the same allocator. So the client
fills from the pane, refuses when it cannot, and `--by` keeps the contributor path open.

- [ ] **Step 1: Write the failing test**

```ts
// server/test/ccrc-api.test.ts — new describe, after the whoami block
describe('ledger allocate carries an identity, or refuses', () => {
  const BODY = '{"project":"p","count":2,"title":"t"}';

  it('fills byId from this pane when the body names none', async () => {
    plantPane('demo-ws');
    await run(['ledger', 'allocate', '--json', '-'], BODY, { TMUX_PANE: '%7' });
    expect(seen).toHaveLength(1);
    expect(JSON.parse(seen[0]!.body))
      .toEqual({ byId: 'demo-ws', project: 'p', count: 2, title: 't' });
  });

  it('sends NOTHING when there is a body and no derivable identity', async () => {
    plantPane('someone-else');                       // tmux WOULD answer
    const r = await run(['ledger', 'allocate', '--json', '-'], BODY,
      { TMUX_PANE: undefined, TMUX: undefined });
    expect(seen, 'an unattributed allocate reached the wire').toHaveLength(0);
    expect(r.status).not.toBe(0);
    expect(r.stdout).toContain('no-pane');
  });

  it('refuses a present-but-BLANK byId rather than laundering it into the column', async () => {
    // What a derivation that failed on the caller's side produces. The route
    // stores '' with the same confidence as a real id, so the refusal has to
    // happen here or not at all.
    plantPane('demo-ws');
    const r = await run(['ledger', 'allocate', '--json', '-'],
      '{"byId":"","project":"p"}', { TMUX_PANE: '%7' });
    expect(seen).toHaveLength(0);
    expect(r.status).not.toBe(0);
    expect(r.stdout).toContain('bad-body');
  });

  it('refuses a body that is not a JSON object rather than splicing into it', async () => {
    plantPane('demo-ws');
    const r = await run(['ledger', 'allocate', '--json', '-'], '[1,2]', { TMUX_PANE: '%7' });
    expect(seen, 'a spliced non-object reached the wire').toHaveLength(0);
    expect(r.status).not.toBe(0);
    expect(r.stdout).toContain('bad-body');
  });

  it('--by is the door for a caller with no pane', async () => {
    await run(['ledger', 'allocate', '--by', 'ci-runner', '--json', '-'], BODY,
      { TMUX_PANE: undefined, TMUX: undefined });
    expect(seen).toHaveLength(1);
    expect(JSON.parse(seen[0]!.body).byId).toBe('ci-runner');
  });

  it('--by is refused on every other row, and its value must be a plain id', async () => {
    const a = await run(['claims', 'take', '--by', 'x', '--json', '-'], '{}');
    expect(a.status).not.toBe(0);
    expect(seen).toHaveLength(0);
    const b = await run(['ledger', 'allocate', '--by', 'a b', '--json', '-'], BODY);
    expect(b.status).not.toBe(0);
    expect(b.stdout).toContain('bad-by');
    expect(seen).toHaveLength(0);
  });

  // GREEN BEFORE AND AFTER — pins on the new code's restraint, reddable only by
  // Step 5's mutations (ii) and (v). Written down because without them the two
  // decisions they record would be true by accident.
  it('leaves a caller-supplied byId exactly as written', async () => {
    plantPane('demo-ws');
    await run(['ledger', 'allocate', '--json', '-'],
      '{"byId":"chosen","project":"p"}', { TMUX_PANE: '%7' });
    expect(seen[0]!.body).toBe('{"byId":"chosen","project":"p"}');
  });

  it('a BODYLESS allocate is untouched — there is nothing to attribute', async () => {
    // The scope decision, pinned: the rule is about a body THIS CLIENT SENDS,
    // and the closed-table row at :126 already exercises the path with none.
    // Without this case that row would stay green for a reason nobody stated.
    const r = await run(['ledger', 'allocate'], undefined,
      { TMUX_PANE: undefined, TMUX: undefined });
    expect(r.status).toBe(0);
    expect(seen).toHaveLength(1);
    expect(seen[0]!.body).toBe('');
  });
});
```

And in `server/test/ccrc-api-closed.test.ts`, REPLACE the `it()` at `:91-99`, in place, inside the
existing describe:

```ts
  it('has exactly ONE identity flag, and it declares rather than forges', () => {
    // Identity here is attribution, not authentication — one UNIX user, no
    // caller auth. `--by` exists because CONTRIBUTING.md:66-70 sends outside
    // contributors to this allocator and auth/gate.ts:256-259 keeps that route
    // EXEMPT so the door stays open: it is a DECLARATION by a caller with no
    // pane, refused on every other row, while a session in a pane is filled from
    // its pane. These spellings would be something else — a way to answer AS
    // another session on a route that checks attribution.
    for (const flag of ['--as', '--from-id', '--from-uuid', '--impersonate',
                        '--as-session', '--identity', '--who']) {
      expect(clientCode(), `ccrc-api grew a ${flag} argument`)
        .not.toMatch(new RegExp(`['"\`\\s]\\${flag}\\b`));
    }
    // DERIVED from the client's own case labels, not a hand-kept list: a second
    // identity-bearing flag reds here the day it lands. (`--*)` is not matched —
    // `*` is outside the class.)
    const cases = [...clientCode().matchAll(/^\s*(--[a-z-]+)\)/gm)].map((m) => m[1]!);
    expect(cases.sort()).toEqual(['--by', '--json']);
  });
```

- [ ] **Step 2: Run it and watch it fail**

Run: `cd server && ./node_modules/.bin/vitest run test/ccrc-api.test.ts test/ccrc-api-closed.test.ts`

Expected: FAIL —
- *fills byId from this pane*: `expected { project: 'p', count: 2, title: 't' } to deeply equal { byId: 'demo-ws', project: 'p', … }`
- *sends NOTHING*: `an unattributed allocate reached the wire: expected [ { … } ] to have a length of 0 but got 1`
- *refuses a present-but-BLANK byId*: same shape, `to have a length of 0 but got 1`
- *not a JSON object*: same shape
- *`--by` is the door* and *`--by` is refused on every other row*: the `--by` cases exit 2 today with
  `unknown-query` (`ledger.allocate`'s query column is `-`), so the first reds at
  `expected [] to have a length of 1` and the second at `expected '…"error":"unknown-query"…' to contain 'bad-by'`
- *has exactly ONE identity flag*: `expected [ '--json' ] to deeply equal [ '--by', '--json' ]`
- The two "green before and after" cases PASS from the start, as stated.

- [ ] **Step 3: Implement**

**(a)** Append to the `derive_identity` header block written in Task 40 (after its
`TWO REFUSAL CODES` paragraph, before `DERIVED_ID=''`):

```bash
# THERE IS ONE FLAG, AND IT DECLARES RATHER THAN FORGES. `--by <id>`, on the
# `ledger allocate` row alone, names a caller that HAS no pane — a contributor at
# a shell or in CI, whom CONTRIBUTING.md sends to this allocator and for whom
# auth/gate.ts's EXEMPT entry keeps the door open. It is refused on every other
# row, and a session in a pane is filled from its pane. What is still
# deliberately absent is any way to answer AS another session on a route that
# checks attribution.
```

**(b)** `usage()` — insert after the `whoami` line at `:116`:

```bash
    printf '  %-18s %s\n' '' '(ledger allocate fills "byId" from this pane; --by <id> for a caller with none)'
```

**(c)** The arg loop at `:192`: `local body_src='' query=''` becomes
`local body_src='' query='' by=''`, and a `--by)` arm goes between the `--json)` arm (ends `:197`)
and the `--*)` arm (`:198`) — the order matters, `--*)` would otherwise swallow it:

```bash
      --by)
        [[ $# -ge 2 ]] || refuse 'bad-args' '--by needs a value'
        [[ "$key" == 'ledger.allocate' ]] || refuse 'bad-args' "$group $verb takes no --by"
        [[ "$2" =~ $SAFE_RE ]] || refuse 'bad-by' '--by value is not a plain session id'
        by="$2"; shift 2 ;;
```

**(d)** Splice this block immediately after the body read's closing `fi` at `:219`, before
`local base token path url` at `:221`:

```bash
  # THE ONE BODY THIS CLIENT REWRITES, and the first in its history. Measured
  # 2026-09-02: at least 101 of this project's allocations already carry an empty
  # holder, because the documented body omits `byId` and the route stores
  # `byId ?? ''` — an omitted field and an explicit empty string reaching one
  # column. That 101 is a FLOOR that can only grow, which is why it may stand
  # here: nothing in the tree UPDATEs `allocatedTo`, and `LedgerLog.append` has
  # already put each of those lines in the append-only log, so no repair can
  # lower it. The route may not change (operator ruling), so the fill happens
  # here: from the pane, or from `--by`, or not at all.
  #
  # NEVER AN OVERRIDE. If the body already names `byId` it is left alone. The
  # test is TEXTUAL, over a whitespace-stripped COPY (so `"byId" : ""` reads the
  # same as `"byId":""`), and it errs toward not touching the body — the safe
  # direction, since duplicate keys resolve last-wins and a splice would silently
  # change precedence. A blank one is REFUSED rather than passed through: that is
  # exactly what a derivation that failed on the caller's side produces. The
  # textual test's limit, stated rather than hidden: a title whose own text
  # carries an escaped `"byId":` either suppresses the fill (safe) or trips the
  # blank refusal (loud). Neither is silent, which is the property that matters.
  #
  # THE SPLICE IS SAFE BECAUSE OF SAFE_RE. Both `$by` and the derived id admit no
  # quote and no backslash, so neither can escape the JSON string it lands in.
  if [[ "$key" == 'ledger.allocate' && -n "$body" ]]; then
    local nb="${body//[[:space:]]/}"
    case "$nb" in
      *'"byId":""'*)
        refuse 'bad-body' 'the body names an EMPTY byId; the allocator would store it as no holder at all' ;;
    esac
    case "$nb" in
      *'"byId":'*) : ;;                      # the caller has spoken
      *)
        local who lead rest restnb
        if [[ -n "$by" ]]; then who="$by"; else derive_identity; who="$DERIVED_ID"; fi
        lead="${body%%[![:space:]]*}"
        rest="${body#"$lead"}"
        [[ "$rest" == '{'* ]] \
          || refuse 'bad-body' 'the allocate body is not a JSON object; byId cannot be added'
        rest="${rest#\{}"
        restnb="${rest//[[:space:]]/}"
        if [[ "$restnb" == '}' ]]; then body="{\"byId\":\"$who\"}"
        else body="{\"byId\":\"$who\",$rest"; fi ;;
    esac
  fi
```

Driven end to end in bash before it was written down (single-line body, a multi-line heredoc body,
`{  }`, `[1,2]`, `{"byId" : "chosen", …}` and `{"byId" : "" , …}`): the four filled forms parse as
JSON, the two `byId`-bearing forms are untouched or refused, and `[1,2]` refuses.

- [ ] **Step 4: Run it and watch it pass**

`cd server && ./node_modules/.bin/vitest run test/ccrc-api.test.ts test/ccrc-api-closed.test.ts test/ccrc-api-ship.test.ts test/ledger-routes.test.ts`

- [ ] **Step 5: MUTATION CHECK**
  - **(i) delete the whole `if [[ "$key" == 'ledger.allocate' … ]]` block**: expect RED on *fills
    byId from this pane* (`expected { project: 'p', … } to deeply equal { byId: 'demo-ws', … }`)
    AND on *sends NOTHING* (`expected [ { … } ] to have a length of 0 but got 1`). RIGHT REASON:
    both are the measured defect restored.
  - **(ii) make the `*'"byId":'*)` arm fall through** (change `: ;;` to `;&` so it splices anyway):
    expect RED on *leaves a caller-supplied byId exactly as written* —
    `expected '{"byId":"demo-ws","byId":"chosen","project":"p"}' to be '{"byId":"chosen","project":"p"}'`.
  - **(iii) delete the `[[ "$key" == 'ledger.allocate' ]]` line inside `--by)`**: expect RED on
    *--by is refused on every other row* — `expected 0 not to be +0`, `claims take --by x` having
    been accepted.
  - **(iv) delete the `[[ "$rest" == '{'* ]] || refuse` line**: expect RED on *refuses a body that
    is not a JSON object* — `a spliced non-object reached the wire: expected [ { … } ] to have a
    length of 0 but got 1`, the wire body being `{"byId":"demo-ws",[1,2]`.

  Revert each.

- [ ] **Step 6: Commit**

```bash
git add ccd/ccrc-api server/test/ccrc-api.test.ts server/test/ccrc-api-closed.test.ts && git commit -m "fix(wave8): the allocate body carries a proven identity or does not go (D-1414)"
```

**LEDGER: D-1414** — at least 101 ccrc-pwa allocations carry `allocatedTo: ''`
(measured 2026-09-02; a floor, since nothing UPDATEs that column and the append-only log has already
recorded each) because the route stores `byId ?? ''`, so an omitted field and an explicit empty string
reach one column — and the client sent an unattributed body without complaint. (The DOCUMENTED body's
own omission, which is where callers learned to omit it, is `D-1415`'s; the skill
identity blocks are `D-1416`'. This number is the client's silence.) The
client now fills the allocate body from the pane, refuses a present-but-blank `byId`, refuses to
send an unattributed body at all, and offers `--by <id>` on that row alone as the door
`CONTRIBUTING.md` and `auth/gate.ts`'s EXEMPT entry both require for a caller with no pane.


---

### Task 42: peer-protocol.md — the allocate fence names `byId`, and the curl-era clobber goes

**Files:**
- Modify: `ccd/coordinator-skill/references/peer-protocol.md:48` and `:126-129`
- Test: `server/test/coordinator-skill.test.ts`, inside
  `describe('the peer protocol reference (Build 9 wave 8, D17)')` at `:917-1039` (its `pp()` helper
  is at `:918`)

**Interfaces:**
- Consumes: nothing (the doc stands alone; Task 41's client fill is belt-and-braces)
- Produces: nothing

**Why:** `peer-protocol.md:126-129` is the ONE and ONLY fenced allocate body in either skill corpus
and it omits `byId` — the omission that produced the empty holders. And `:48` is
`body="${resp%$'\n'*}"`, a curl-era leftover: `${resp` occurs exactly once in the whole reference
(measured with node) and `resp=` is assigned nowhere in either corpus
(`grep -rn 'resp=' ccd/coordinator-skill ccd/worker-skill` → only `SKILL.md:108`, which is prose
about a *deny* matcher), so the line silently overwrites the just-captured claims response with the
empty expansion of an unset variable — losing the 409 address the rest of that section teaches
reading. Nothing pins either today: `pp()`'s existing `"byId":"$id"` assertion at `:980` is about
the CLAIM fence, and the regex below (verified against the file at HEAD: `false`) is what ties the
spelling to the allocate fence.

- [ ] **Step 1: Write the failing test**

```ts
// server/test/coordinator-skill.test.ts — two cases inside
// describe('the peer protocol reference (Build 9 wave 8, D17)')
  it('the allocate fence names byId, in the spelling the claim fence already uses', () => {
    // The route takes `byId` optionally and stores `byId ?? ''`, so an omitted
    // field lands as no holder at all — measured 2026-09-02, at least 101 of
    // this project's allocations are in that state. This fence is the only
    // documented allocate body in either corpus, so it is where that started.
    // The proximity bound is what makes it about THIS fence: `:980` already
    // asserts the same spelling for the claims fence 80 lines above.
    expect(pp()).toMatch(/ledger allocate[\s\S]{0,220}"byId":"\$id"/);
  });

  it('carries no ${resp expansion — the client returns the body, and there is no second stream', () => {
    // A curl-era leftover: `resp` is assigned nowhere in either corpus, so the
    // line overwrote the captured body with the empty expansion of an unset
    // variable. A coordinator copying that fence lost the whole 409 answer —
    // the ADDRESS this section's own prose (`:79`) teaches reading.
    expect(pp()).not.toContain('${resp');
  });
```

- [ ] **Step 2: Run it and watch it fail**

Run: `cd server && ./node_modules/.bin/vitest run test/coordinator-skill.test.ts -t "peer protocol"`

Expected: FAIL —
`expected '…' to match /ledger allocate[\s\S]{0,220}"byId":"\$id"/` and
`expected '…' not to contain '${resp'`.

- [ ] **Step 3: Implement**

Delete `peer-protocol.md:48` outright — `:47`'s `    )` already closes the capture, and `:49` is
blank. Then replace the fence at `:126-129`:

```bash
    body=$("$API" ledger allocate --json - <<JSON
    {"byId":"$id","project":"$project","count":8,"title":"program $slug D-block"}
    JSON
    )
```

And add one paragraph immediately after the fence's `201 {numbers, floor}` paragraph (which begins
at `:131`):

```
`byId` is who asked, and it is stored unverified — attribution, not authentication,
the claims table's stance one section up. Omit it and the row records no holder at
all: at least 101 of this project's allocations were in that state when this was
written (2026-09-02), and nothing can put a holder back on them. The client fills it
from your pane when the body leaves it out, and refuses rather than sending a blank
one; `--by <id>` is for a caller that has no pane at all.
```

- [ ] **Step 4: Run it and watch it pass**

`cd server && ./node_modules/.bin/vitest run test/coordinator-skill.test.ts test/ccrc-api-closed.test.ts`

- [ ] **Step 5: MUTATION CHECK**
  - **(i) delete `"byId":"$id",` from the allocate fence**: expect RED with
    `expected '…' to match /ledger allocate[\s\S]{0,220}"byId":"\$id"/`. RIGHT REASON: the exact
    omission that produced the empty holders is back, and `:980`'s claims-fence assertion stays
    green — which is what the proximity bound is for.
  - **(ii) re-add the `body="${resp%$'\n'*}"` line at `:48`**: expect RED with
    `expected '…' not to contain '${resp'`.

  Revert both.

- [ ] **Step 6: Commit** (AGENT-FIRST: this corpus ships to the fleet host before the server)

```bash
git add ccd/coordinator-skill/references/peer-protocol.md server/test/coordinator-skill.test.ts && git commit -m "fix(wave8): the documented allocate body names byId, and the curl-era resp clobber goes (D-1415, D-1417)"
```

**LEDGER: D-1415** — the only documented allocate body in either skill corpus
omitted `byId`, which is where the empty holders came from; it now carries `"byId":"$id"` in the
spelling the claim fence in the same file already uses, pinned by proximity so dropping it reds
while the claims-fence pin stays green.

**LEDGER: D-1417** — `peer-protocol.md:48`'s `body="${resp%$'\n'*}"` was a
curl-era leftover assigning from a variable nothing in either corpus sets, so a coordinator copying
that fence overwrote the whole claims response — including the 409 address the section teaches
reading — with an empty expansion; deleted and pinned.

---

### Task 43: both skills learn their identity from `ccrc-api whoami`

**Files:**
- Modify: `ccd/coordinator-skill/SKILL.md:41-50`, `ccd/worker-skill/SKILL.md:24-33` and `:58`
  (clause 1)
- Test: `server/test/coordinator-skill.test.ts:134-139`, `server/test/worker-skill.test.ts:34-37`
  (the comment above `CONTRACT`), `:48` (`CONTRACT[0]`) and `:110-117`

**Interfaces:**
- Consumes: `ccrc-api whoami`'s gated behaviour (Task 40)
- Produces: nothing

**Why:** Both skills teach a byte-identical unchecked derivation — coordinator `:46-49` and worker
`:29-32`, `diff` of the two four-line blocks is empty: `tname=$(tmux display-message -p '#S')` with
no exit-status check and `uuid=$(cat "$REG/$id.uuid")` with no existence check. That is the path
that produced the empty holders, and — measured in Task 40 — the bare `display-message` names the
most-recently-active session for a caller with no pane. Neither corpus mentions `whoami`
(`grep -rn whoami ccd/` → three hits, all in `ccd/ccrc-api`). **Correcting the brief:** its premise
that both identity blocks sit OUTSIDE the pinned clause lists is half false. True for the
coordinator; for the WORKER, `CONTRACT[0]` (`worker-skill.test.ts:48`, `worker SKILL.md:58`) itself
quotes `tmux display-message -p '#S'` inside the eleven verbatim clauses, and both test files carry
a standing `expect(skill).toContain("tmux display-message -p '#S'")`
(`coordinator-skill.test.ts:137`, `worker-skill.test.ts:114`). So this task edits a pinned clause and
must land the CONTRACT literal in the same commit.

- [ ] **Step 1: Run both suites and record the baseline** (before touching anything)

Run: `cd server && ./node_modules/.bin/vitest run test/coordinator-skill.test.ts test/worker-skill.test.ts`
and record the file/test counts. Any later red that is NOT one of the assertions below is a pin
break, not this task's work.

- [ ] **Step 2: Write the failing test**

```ts
// server/test/coordinator-skill.test.ts — REPLACES the it() at :134-139
  it('tells the session how to learn its own id the ONE way that is actually its own', () => {
    // The bare derivation this replaced was measured on the fleet host three
    // times on 2026-09-02: with no TMUX_PANE it exits 0 naming the MOST RECENTLY
    // ACTIVE session — a different one on each run — so a session whose lookup
    // went wrong got another session's id and believed it. `ccrc-api whoami`
    // targets THIS pane and refuses instead.
    expect(skill).toContain('ccrc-api" whoami');
    expect(skill).toContain('cc-');
    expect(skill, 'the unchecked derivation is back')
      .not.toContain("tname=$(tmux display-message -p '#S')");
  });
```

```ts
// server/test/worker-skill.test.ts — REPLACES the it() at :110-117
  it('tells the session how to learn its own id the ONE way that is actually its own', () => {
    expect(skill).toContain('ccrc-api" whoami');
    expect(skill).toContain('cc-');
    expect(skill).toContain('.uuid');
    expect(skill, 'the unchecked derivation is back')
      .not.toContain("tname=$(tmux display-message -p '#S')");
  });
```

`CONTRACT[0]` at `worker-skill.test.ts:48` becomes exactly this. **ASCII only — do NOT retype any
other clause**, they carry U+2019 curly apostrophes and the file's own comment at `:38-41` says so;
copy those from `SKILL.md`. Note D-104 (`:43-46`): no clause may contain a `"` character, and this
one contains none.

```ts
  "Learn who you are on EVERY call: `fromId` and `fromUuid` come from `ccrc-api whoami`, which reads the pane you are in and REFUSES rather than naming another session. Re-read them each time. `/clear` rotates that uuid and dispatch `/clear`s you on every wave >= 2, so a uuid you cached is guaranteed stale.",
```

And the comment above `CONTRACT` at `worker-skill.test.ts:34-35` currently reads
`// The eleven clauses, verbatim. Every entry is DOUBLE-quoted on purpose: clause 1` /
`// quotes \`tmux display-message -p '#S'\` and clause 3 quotes \`toId:'coordinator'\``. Clause 1 no
longer quotes that, so those two lines become:

```ts
// The eleven clauses, verbatim. Every entry is DOUBLE-quoted on purpose: clause 3
// quotes `toId:'coordinator'` and clause 9 quotes the eight enum words
```

- [ ] **Step 3: Run it and watch it fail**

Run: `cd server && ./node_modules/.bin/vitest run test/coordinator-skill.test.ts test/worker-skill.test.ts`

Expected: FAIL — `expected '…' to contain 'ccrc-api" whoami'` in both files, plus
`missing contract clause: Learn who you are on EVERY call: \`fromId\` and \`fro…` from the verbatim
clause loop at `worker-skill.test.ts:68-72`.

- [ ] **Step 4: Implement**

Replace the fenced block at `ccd/coordinator-skill/SKILL.md:45-50` and at
`ccd/worker-skill/SKILL.md:28-33` with the SAME block — the duplication is the corpora's standing
policy (a skill reaches a home only once its installer has run there, D-107). `REG` stays defined
here because the prose below each block, and coordinator clause 4, both name `$REG`. The client is
invoked BY EXPLICIT PATH rather than through `$API`, because `API=` is not assigned until
`coordinator SKILL.md:114` / `worker SKILL.md:101` — below this block — and a forward reference
would teach a call that cannot run:

```bash
REG="$HOME/.cc-sessions"                       # named here; the prose below uses it
who=$("$HOME/.local/bin/ccrc-api" whoami) || { printf 'identity refused: %s\n' "$who" >&2; exit 1; }
id=${who#*\"id\":\"};     id=${id%%\"*}        # your session id, cc- prefix already stripped
uuid=${who#*\"uuid\":\"}; uuid=${uuid%%\"*}    # the current $REG/$id.uuid, read by the client
```

The introducing sentence gains one clause in both files. Coordinator `:42-43`
(`… what tmux says about the pane you are in:`) and worker `:25-26` (same wording) become:

```
… what tmux says about the pane you are in — asked through the client, which targets
THIS pane and refuses if you are not in one, rather than answering for whichever
session happened to be active last:
```

Then `ccd/worker-skill/SKILL.md:58` becomes the `CONTRACT[0]` sentence above, verbatim, keeping its
`1. ` list prefix.

- [ ] **Step 5: Run it and watch it pass** — the same two suites; every other clause must still be
  green against the baseline from Step 1. `coordinator-skill.test.ts:892-907` also re-runs (both
  files must still contain `$HOME/.local/bin/ccrc-api` and the "empty derivation is a stop"
  sentence) — the new block satisfies the first directly and the second is untouched at `:116-122` /
  `:103-109`.

- [ ] **Step 6: MUTATION CHECK**
  - **(i) restore `tname=$(tmux display-message -p '#S')` in either SKILL.md**: expect RED with
    `the unchecked derivation is back: expected '…' not to contain "tname=$(tmux display-message -p '#S')"`.
    RIGHT REASON: that literal IS the derivation measured to name another session.
  - **(ii) edit one word of the new clause 1 in `worker SKILL.md` without touching the test**:
    expect RED with `missing contract clause: Learn who you are on EVERY call: \`fromId\` and \`fro…`,
    proving the verbatim pin still holds over the rewritten clause.

  Revert both.

- [ ] **Step 7: Commit** (AGENT-FIRST)

```bash
git add ccd/coordinator-skill/SKILL.md ccd/worker-skill/SKILL.md server/test/coordinator-skill.test.ts server/test/worker-skill.test.ts && git commit -m "fix(wave8): both skills derive identity through whoami, which refuses instead of guessing (D-1416)"
```

**LEDGER: D-1416** — both skills taught a byte-identical unchecked tmux+cat
derivation with no exit-status or existence check (coordinator `SKILL.md:46-49`, worker `:29-32`,
`diff` empty) — the path that produced the empty holders, and the one measured to name another
session for a caller with no pane; both blocks, and the worker's verbatim-pinned clause 1 plus the
test comment that described it, now derive through `ccrc-api whoami`, which refuses instead of
guessing.

---

### Task 44: root CLAUDE.md says what the floor MEANS, and stops making four false claims

**Files:**
- Modify: `CLAUDE.md:121-133` (the deviation-ledger bullet; `wc -l CLAUDE.md` → 202)
- Test: `server/test/ledger-instruction.test.ts` (NEW)

**Interfaces:**
- Consumes: nothing
- Produces: `server/test/ledger-instruction.test.ts`; its `passage`, `sectionToEnd` and
  `BY_SCANNING` are reused by Task 45 in the same file

**Why:** The grep instruction is already gone — `git log -L 121,133:CLAUDE.md` shows `9c2eb04d`
(2026-09-02 06:26) replaced it, and `grep -c 'grep' CLAUDE.md` → 0 — so there is no grep sentence
left to edit. What survives is a paragraph that never says what the floor IS, plus four measured
defects:

1. `:123-124` tells the reader to *read the floor from POST* while the D-1293 entry it cites in the
   same parenthesis records the floor being read with **GET**
   (`2026-09-02-program-leverage-wave7-f7.md:1498`: *"this worker reads `GET /api/ledger?project=ccrc-pwa`, gets 1292"*).
   POST mints; GET reads.
2. `:122`'s *"a build-scoped `D-B4-N` series runs alongside"* is false:
   `git ls-files -z | xargs -0 grep -hoP '(?<!was )\bD-B\d+-\d+\b' | wc -l` → **0**, against 296
   total `D-B<k>-<m>` tokens — every survivor is the licensed `was …` alias form that
   `deviation-refs.test.ts:168`'s `BARE` regex exempts.
3. `:125-126`'s *"Source runs ahead of the plans' ledgers"* is a pre-D13 fossil that
   `deviation-refs.test.ts:140-150` now forbids outright: *"a source ref to an allocated-but-unentered
   number reds here until its entry lands"*.
4. `:126`'s *"three incidents"* names only **two** — `D-1157/1158 via PR #38` and
   `D-1159/1160/1161 via PR #41` — and the tree counts the class differently in different places
   (`deviation-refs.test.ts:297` says "three times" with the same two; wave7 `:1503` calls an
   avoided fourth "the fourth collision in this program"). The honest fix is to drop the count, not
   to pick a bigger one.

- [ ] **Step 1: Write the failing test**

```ts
// server/test/ledger-instruction.test.ts — NEW
// The LIVE-INSTRUCTION surfaces for getting a deviation number: root CLAUDE.md's
// ledger bullet, CONTRIBUTING.md's ledger paragraph, and the account-provisioning
// spec's section 14. Merged PLANS are history and deliberately out of reach here
// (operator ruling).
//
// This is three ANCHORED PASSAGES, not a corpus scanner. topology-clean.test.ts's
// FORBIDDEN table is the corpus ratchet, and its `scope?` docstring (:216-219)
// states "at ship NO class carries one" — a class scoped to three files would
// break a stated ship invariant of that file. box-token-census.test.ts:220's
// `passage()` idiom touches nothing shared, so that is the one copied.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = (rel: string): string => readFileSync(path.join(REPO, rel), 'utf8');

/** box-token-census.test.ts:220's helper, copied for its REASON as much as its
 *  shape: an anchor that stopped matching yields '', and '' satisfies every
 *  negative assertion below it. This tree has been bitten by that twice. */
const passage = (name: string, text: string, from: string, to: string): string => {
  const a = text.indexOf(from);
  expect(a, `${name}: the opening anchor is gone`).toBeGreaterThan(-1);
  const b = text.indexOf(to, a + from.length);
  expect(b, `${name}: the closing anchor is gone`).toBeGreaterThan(a);
  const out = text.slice(a, b).replace(/\s+/g, ' ');
  expect(out.length, `${name} is too short to be the passage`).toBeGreaterThan(120);
  return out;
};

/** A section that runs to end of file. The spec's §14 is the LAST section (the
 *  file is 896 lines and §14 opens at :890), so `passage`'s closing anchor
 *  cannot exist and would red for the wrong reason. */
const sectionToEnd = (name: string, text: string, from: string): string => {
  const a = text.indexOf(from);
  expect(a, `${name}: the opening anchor is gone`).toBeGreaterThan(-1);
  const out = text.slice(a).replace(/\s+/g, ' ');
  expect(out.length, `${name} is too short to be the section`).toBeGreaterThan(120);
  return out;
};

const NUM = '(?:next (?:free|available|unused)|highest|next number)';
const VERB = '(?:grep\\w*|sweep\\w*|scan\\w*|read)';
const TREE = '(?:origin/main|remote ref|both trees|the tree|`main`)';
/** "Get your number by reading a tree", in the spellings this corpus has used. */
const BY_SCANNING = new RegExp(
  `${NUM}[^.]{0,120}${VERB}[^.]{0,120}${TREE}` + '|' +
  `${NUM}[^.]{0,120}${TREE}` + '|' +
  `${VERB}[^.]{0,120}${TREE}[^.]{0,120}(?:before allocating|${NUM})`, 'i');

describe('the allocation instruction', () => {
  it('the scanner is LIVE — it catches the sentences it replaced and spares the ones it keeps', () => {
    // ANTI-VACUITY. Most assertions below are absences, and an absence proves
    // nothing unless the pattern can produce a presence. These three positives
    // are real historical texts (the middle one is still in the spec at HEAD).
    for (const yes of [
      'Allocate the next number by grepping `origin/main` across BOTH `docs/` and source',
      'The next free number must be read from `origin/main` at plan-writing time',
      'Verify at execution by sweeping every remote ref across `docs/` AND source before allocating',
    ]) expect(BY_SCANNING.test(yes), yes).toBe(true);
    // …and the procedures the bullets KEEP must not trip it, or the guard gets
    // deleted the first time it cries wolf.
    for (const no of [
      'git fetch origin main then vitest run test/deviation-refs.test.ts, which compares ' +
      "this branch's entries against `origin/main` without merging",
      '`GET /api/ledger?project=` is the READ, and its `floor` is what the next POST would mint',
    ]) expect(BY_SCANNING.test(no), no).toBe(false);
  });

  it('CLAUDE.md tells you that you are ISSUED a number, and what the floor is', () => {
    const b = passage('CLAUDE.md, the deviation-ledger bullet', read('CLAUDE.md'),
      '- **Deviation ledger (D-N):**', '\n- **');
    // A RATCHET, stated as one: this passage does NOT match today (measured), so
    // it is here to keep the instruction from coming back, not to go red first.
    // The liveness case above is what proves it can still fire.
    expect(b, 'the bullet prescribes reading a tree for a number').not.toMatch(BY_SCANNING);
    expect(b).toContain('POST /api/ledger/deviations');
    expect(b, 'nothing says the floor cannot come back down').toMatch(/only ever rises/i);
    // NAMED, not valued: the gap lives in shared/api.ts and the bullet points at
    // it. Asserting its NUMBER here would red a doc test on a legitimate change
    // to the constant — a red for the wrong reason.
    expect(b, 'the bullet does not name the gap the floor is built from')
      .toContain('LEDGER_SEED_GAP');
    expect(b, 'the reconciled legacy series is described as still running')
      .not.toMatch(/runs alongside/);
    expect(b, 'source cannot run ahead of the plans — deviation-refs.test.ts reds on it')
      .not.toMatch(/[Ss]ource runs ahead/);
    expect(b, 'a collision cardinal is back; the bullet names two events and the tree counts them differently elsewhere')
      .not.toMatch(/\b(two|three|four|five|six|seven|eight)\s+(incidents|collisions|times)\b/i);
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `cd server && ./node_modules/.bin/vitest run test/ledger-instruction.test.ts`

Expected: the liveness case PASSES. The CLAUDE.md case FAILS at
`nothing says the floor cannot come back down: expected '- **Deviation ledger (D-N):** plans carry…' to match /only ever rises/i`
— vitest stops at the first failing `expect`, so as each is fixed the next appears, in this order:
`LEDGER_SEED_GAP`, then `runs alongside`, then `Source runs ahead`, then the collision cardinal.
The two assertions above it (`BY_SCANNING`, `POST /api/ledger/deviations`) pass from the start.

- [ ] **Step 3: Implement** — replace `CLAUDE.md:121-133` with:

```
- **Deviation ledger (D-N):** plans carry a `## Deviations found` section of numbered `D-N` entries (global,
  monotonic across project history — not reset per plan; ONE namespace, the old build-scoped `D-B<k>-<m>` ids
  were reconciled into it and survive only as `was D-B4-9` aliases — zero bare legacy refs remain in tracked
  text, measured).
  **You are ISSUED a number — you never look one up.** `POST /api/ledger/deviations` MINTS a contiguous block,
  and those are the only numbers you may define; allocate and DEFINE IN THE SAME ACT. It is box-token gated, so
  a session that cannot reach it writes `D-TBD-<slug>` and reports (worker clause 11) rather than guessing.
  `GET /api/ledger?project=` is the READ, and its `floor` is what the next POST would mint, not a number you
  may take (a brief once said 1243 while the allocator said 1292, D-1293).
  **WHAT THE FLOOR IS.** It is seeded from PROSE — the highest `D-<n>` token anywhere in this project's
  `docs/superpowers/{plans,specs}`, a mere mention counting, plus `LEDGER_SEED_GAP` — and it ONLY EVER RISES
  (`raiseLedgerFloor`'s `WHERE excluded.floor > ledger_floor.floor`; no lowering path exists). So every
  publish-then-sweep burns `LEDGER_SEED_GAP - 1` numbers by design, which costs nothing, and a number WRITTEN
  without being ISSUED seals its own band forever: it never enters the ledger, and it raises this project's
  floor anyway. Measured 2026-09-02: the live floor stood well ABOVE the highest number the allocator has ever
  issued, raised off a plan file that is on no merged ref — every number between is unissuable for good.
  The parallel-branch collision — two branches each measuring a checkout and each taking the same next number —
  is now MEASURED rather than remembered: `git fetch origin main` then `cd server &&
  ./node_modules/.bin/vitest run test/deviation-refs.test.ts`, which compares this branch's entries against
  `origin/main`'s **without merging** and reds on any allocator-era number defined in two plans. It fires before
  the merge that would otherwise decide it; the older one-tree scan could only name the loser afterwards. It
  cannot see the other shape — one plan defining a number NOBODY was issued — which `sweepLedgerReconcile`'s
  orphan warning reports and nothing refuses. Source files carry `D-N` refs in comments; **read them
  as authoritative history, don't delete them.** Anchors in plans are snapshots — trust shipped source's own
  comments over a plan document.
```

**Why no `1392`, no `56`.** The draft of this task wrote *"the live floor read 1389 against a
highest-ever-issued 1332 — the 56 numbers between are unissuable"*. Re-measured while correcting it,
the floor was **1392** and the derived gap **59**; the wire floor rises on its own hourly sweep. A
wave whose purpose is removing cardinals that can move must not ship one into a live-instruction
file. The property (`floor > max(n) + 1`) is stable, dated, and re-derivable from
`~/.local/bin/ccrc-api ledger list --project ccrc-pwa`.

**No contiguous `D-<n>` above the ledger high-water may appear in the new text.** The only D-ref
above is `D-1293`; `1243`, `1292` and the floor language are written prefix-less on purpose, the
convention this file already uses. Verified: `deviation-refs.test.ts:136-151` asserts
`floorFromScan(trackedFiles()).floor === definedMax() + LEDGER_SEED_GAP`, and `definedMax()` at HEAD
is 1332 (`git grep -hoE '\bD-[0-9]{1,5}\b' origin/main -- docs/superpowers/plans docs/superpowers/specs | grep -oE '[0-9]+' | sort -n | tail -1` → 1332).

- [ ] **Step 4: Run it and watch it pass** — and the suites a `CLAUDE.md` edit can red:

```
cd server && ./node_modules/.bin/vitest run test/ledger-instruction.test.ts test/deviation-refs.test.ts test/topology-clean.test.ts test/box-token-census.test.ts test/oss-metadata.test.ts
```

`box-token-census.test.ts:383-384` pins a DIFFERENT `CLAUDE.md` passage
(`- **Box token gates every coordination WRITE**`), so it is a control here, not a target.
`oss-metadata.test.ts:89-100` pins the README size claim, likewise untouched.

- [ ] **Step 5: MUTATION CHECK**
  - **(i) put `Source runs ahead of the plans' ledgers, so a number taken from a plan alone collides
    with shipped refs.` back into the bullet**: expect RED with
    `source cannot run ahead of the plans — deviation-refs.test.ts reds on it`.
  - **(ii) restore `(three incidents: D-1157/1158 via PR #38, D-1159/1160/1161 via PR #41)`**:
    expect RED with `a collision cardinal is back; …`.
  - **(iii) delete the `and it ONLY EVER RISES` clause**: expect RED with
    `nothing says the floor cannot come back down`.
  - **(iv) restore `a build-scoped D-B4-N series runs alongside`**: expect RED with
    `the reconciled legacy series is described as still running`.

  Each reds because the exact false or missing claim came back. Revert all four.

- [ ] **Step 6: Commit**

```bash
git add CLAUDE.md server/test/ledger-instruction.test.ts && git commit -m "docs+test(wave8): say what the ledger floor means, and pin the four claims that were false (D-1418)"
```

**LEDGER: D-1418** — root `CLAUDE.md`'s deviation-ledger bullet never said
what the floor IS and made four measured-false claims in the process (read the floor from POST while
citing an entry that records it being read with GET; a build-scoped series that "runs alongside"
when zero bare legacy refs survive in tracked text; "source runs ahead of the plans' ledgers" when a
shipped guard now reds on exactly that; and "three incidents" beside an enumeration of two, with the
tree counting the class differently elsewhere) — rewritten to say a number is ISSUED, that the floor
only ever rises, and that a number written without being issued seals its own band, with an anchored
guard and no cardinal that can move.

---

### Task 45: the live-instruction residue outside CLAUDE.md

**Files:**
- Modify: `docs/superpowers/specs/2026-08-21-account-provisioning-design.md:892-896`,
  `CONTRIBUTING.md:68` and `:72-73`, `server/test/deviation-refs.test.ts:109-110` and `:297-299`
- Test: `server/test/ledger-instruction.test.ts` (from Task 44)

**Interfaces:**
- Consumes: `passage`, `sectionToEnd`, `BY_SCANNING` (Task 44, same file)
- Produces: nothing

**Why:** Operator ruling — live-instruction surfaces only; merged plans are history. Three surfaces
still instruct.
- The spec's §14 is imperative and present tense, and it is the one passage `BY_SCANNING` matches
  TODAY (measured: 431 chars flattened, match =
  `next free number must be read from \`origin/main`). The procedure it prescribes is the very
  procedure that caused the renumber the same paragraph records.
- `CONTRIBUTING.md:68`'s *"take the next free number from the allocator"* keeps the take-a-number
  framing in the PUBLIC-facing file, and `:72` carries the same undercounted cardinal as CLAUDE.md
  (*"has caused a renumber three times"*).
- `deviation-refs.test.ts:109-110` is a shipped source comment asserting that *"the hand-allocation
  grep the ledger convention prescribes"* exists — the convention no longer does — and `:297-299`
  repeats the "three times" count beside its own enumeration of two.

- [ ] **Step 1: Write the failing test**

```ts
// server/test/ledger-instruction.test.ts — two more cases in the same describe
  it('CONTRIBUTING.md, the public-facing copy, says the same thing and no cardinal', () => {
    const p = passage('CONTRIBUTING.md, the ledger paragraph', read('CONTRIBUTING.md'),
      '**`D-N` markers in comments are the deviation ledger**', '\n**Do');
    expect(p, 'the public file prescribes reading a tree for a number').not.toMatch(BY_SCANNING);
    expect(p).toContain('POST /api/ledger/deviations');
    expect(p, 'the take-a-number framing is what produced the collisions')
      .not.toMatch(/take the next free number/i);
    expect(p, 'a renumber cardinal is back; this file names no incident at all')
      .not.toMatch(/\b(two|three|four|five|six|seven|eight)\s+times\b/i);
  });

  it('the account-provisioning spec no longer prescribes reading a tree for a number', () => {
    // A design SPEC, imperative and present tense — not a dated note. Its
    // INCIDENT RECORD stays: the D-108..D-140 renumber is why the section
    // exists, and deleting the instruction must not take the history with it.
    const s = sectionToEnd('account-provisioning spec, section 14',
      read('docs/superpowers/specs/2026-08-21-account-provisioning-design.md'),
      '## 14. Deviations');
    expect(s, 'the spec still prescribes reading a tree for a number').not.toMatch(BY_SCANNING);
    expect(s, 'the incident record was deleted along with the instruction')
      .toContain('descending-order rewrite');
  });
```

- [ ] **Step 2: Run it and watch it fail**

Run: `cd server && ./node_modules/.bin/vitest run test/ledger-instruction.test.ts -t "spec"` then
`-t "CONTRIBUTING"`

Expected: FAIL —
- the spec case at
  `the spec still prescribes reading a tree for a number: expected '## 14. Deviations D-numbers are **not allocated in this document**. …' not to match /…/`
  (`BY_SCANNING` fires on it today, measured);
- the CONTRIBUTING case at
  `the take-a-number framing is what produced the collisions: expected '…' not to match /take the next free number/i`,
  then, once that is fixed, at the `three times` cardinal. Its first two assertions
  (`BY_SCANNING`, `POST /api/ledger/deviations`) pass from the start — the first is a ratchet, as in
  Task 44.

- [ ] **Step 3: Implement**

**(a)** `docs/superpowers/specs/2026-08-21-account-provisioning-design.md:892-896` (the four prose
lines under the `## 14. Deviations` header at `:890`) become:

```
D-numbers are **not allocated in this document**. The ledger is global and monotonic across project
history, and four PRs merged onto `main` during this design conversation. Numbers are ISSUED by the
allocator at plan-writing time (`POST /api/ledger/deviations`) and defined in the same act — never
derived from this branch, from any checkout, or from Stage 3a's ceiling. The renumber that cost a full
descending-order rewrite of D-108..D-140 is the reason this paragraph exists; the procedure it
originally prescribed was itself the defect, and root `CLAUDE.md`'s deviation-ledger bullet is the
current rule.
```

**(b)** `CONTRIBUTING.md:68` — currently
`you add one, take the next free number from the allocator (\`POST /api/ledger/deviations\`),` —
becomes:

```
you add one, you are ISSUED numbers by the allocator (`POST /api/ledger/deviations`),
```

**(c)** `CONTRIBUTING.md:72-73` — the sentence spans TWO lines
(`:72` = `Two branches allocating in parallel has caused a renumber three times, so it is checked`,
`:73` = `rather than remembered:`). Replace BOTH lines with:

```
Two branches allocating in parallel has forced a renumber more than once, so it is checked
rather than remembered:
```

**(d)** `server/test/deviation-refs.test.ts:109-110` — currently
`// classes — the wider net also guards test/source fixtures, which poison the` /
`// hand-allocation grep the ledger convention prescribes).` — becomes:

```ts
  // classes — the wider net also guards test/source fixtures, which poison the
  // live FLOOR: one contiguous ref seeds it thousands of numbers high, and it
  // only rises).
```

**(e)** `server/test/deviation-refs.test.ts:297-299` — becomes:

```ts
  // That has now happened more than once (D-1157/1158 via PR #38, D-1159/1160/1161
  // via PR #41 — the tree counts the class differently in different places, so the
  // count is deliberately not restated here), and the detection procedure the
  // coordinator actually used both times was a human cloning the tip, merging
  // origin/main and running this file.
```

- [ ] **Step 4: Run it and watch it pass**

`cd server && ./node_modules/.bin/vitest run test/ledger-instruction.test.ts test/deviation-refs.test.ts test/oss-metadata.test.ts`

- [ ] **Step 5: MUTATION CHECK**
  - **(i) restore the spec's original sentence** — `The next free number must be read from
    \`origin/main\` at plan-writing time — not from this branch, and not from Stage 3a's ceiling.`:
    expect RED with `the spec still prescribes reading a tree for a number: expected '## 14. Deviations …' not to match /…/`,
    the pattern's SECOND alternative firing on exactly that text (verified by running the compiled
    regex against the current file: match =
    `next free number must be read from \`origin/main`).
  - **(ii) delete the `descending-order rewrite` clause from the new §14**: expect RED with
    `the incident record was deleted along with the instruction` — proving the guard protects the
    history as well as forbidding the instruction, so "fix it by deleting the paragraph" is not
    available.
  - **(iii) restore `three times` in CONTRIBUTING.md:72**: expect RED with
    `a renumber cardinal is back; this file names no incident at all`.

  Revert all three.

- [ ] **Step 6: Commit**

```bash
git add docs/superpowers/specs/2026-08-21-account-provisioning-design.md CONTRIBUTING.md server/test/deviation-refs.test.ts server/test/ledger-instruction.test.ts && git commit -m "docs(wave8): the last live surfaces that still prescribed reading a tree for a number (D-1419)"
```

**LEDGER: D-1419** — `2026-08-21-account-provisioning-design.md` §14 was still
instructing, in the imperative present, that the next free number be read from `origin/main` at
plan-writing time — the procedure that caused the renumber the same paragraph records, and the one
passage in the live-instruction set that a compiled scanner still matched at HEAD; corrected in
place with the incident kept, and `CONTRIBUTING.md`'s matching take-a-number framing and undercounted
renumber cardinal, plus two stale comments in `deviation-refs.test.ts`, corrected with it.

---

### Task 46: the reconcile sweep applies ONE notion of "this plan carries D-N"

**Files:**
- Modify: `server/src/watch.ts:2113-2125`
- Test: `server/test/ledger-sweep.test.ts` — two new cases in
  `describe('sweepLedgerReconcile')` (after the case ending at `:186`), plus repairs to the fixture
  lines at `:267` and `:292`

**Interfaces:**
- Consumes: `definitionsIn(files): Definition[]` (`{ file: string; n: number }`,
  `server/src/coord/ledger.ts:269-283`) and
  `unallocatedDefinitions(defs, issued)` — both already imported at `watch.ts:36-37`
- Produces: nothing

**Why:** The two halves of ONE loop, eleven lines apart, over the same `files`, use two different
notions of carrying a number. `watch.ts:2114-2115` is
``const re = new RegExp(`\\bD-${a.n}\\b`); const hit = files.find((f) => re.test(f.text));`` — a bare
token match anywhere in the text — while `:2124-2125` is
`unallocatedDefinitions(definitionsIn(files), …)`, the definition shape. It fired: at
`landedAt: 1788354778004` (= 2026-09-02T13:12:58Z) the sweep stamped D-1294 and D-1332 `landed`
against `docs/superpowers/plans/2026-09-02-graphify-read-side-ccrc-level.md`, a file
`git cat-file -e origin/main:<path>` reports absent and `git branch -a --contains` places only on
`feat/` and `design/graphify-read-side-ccrc-level`. The stamp is TERMINAL: `store.ts:3345`'s
``WHERE project = ? AND n = ? AND state = 'allocated'`` never re-evaluates a landed row, and
`openAllocations()` (`:3315-3321`) only ever returns `allocated` ones. Verified by replaying BOTH
real predicates over that exact file: the bare pattern matches, `definitionsIn` finds ZERO
definitions of either number (the line is a blockquote,
`> **D-1294..D-1332** from \`POST /api/ledger/deviations\``, and `ledger.ts:184`'s `DEFINITION`
returns null on it with and without the `> ` marker). So had the landing half used `definitionsIn`,
the mis-stamp could not have happened even reading the unmerged tree.

- [ ] **Step 1: Write the failing test**

```ts
// server/test/ledger-sweep.test.ts — in describe('sweepLedgerReconcile'), after the
// case that ends at :186
  it('lands on the file that DEFINES the number, not on one that merely cites it', async () => {
    // BOTH DIRECTIONS IN ONE MEASUREMENT, because the fixture corpus here is a
    // bare directory tree with no repository at all (`fixture()`:33 is a mkTmp,
    // and readLedgerDocs reads it through FleetIO): "on the served ref" and "not
    // on it" are the same state, so a ref-based fixture is not constructible and
    // every existing green assertion in this file is compatible with the defect.
    // The SHAPE is constructible, and it is the live one — copied from the
    // blockquote that stamped two numbers against an unmerged file on 2026-09-02.
    //
    // The citing file sorts FIRST (`ledgerseed.ts:182` walks `[...names].sort()`),
    // so under the old matcher `files.find` returns it — which is what makes this
    // a measurement rather than a coin toss.
    const h = fixture();
    await seedAndAllocate(h, 1);                          // 261
    h.plantDoc('demo', 'plans', 'a-cites.md',
      `> **D-${261}..D-${299}** from \`POST /api/ledger/deviations\`.`);
    h.plantDoc('demo', 'plans', 'b-defines.md', `- **D-${261}** — the real entry`);
    at(NOW + 1000);
    await h.watcher.sweepLedgerReconcile();
    expect(h.coord.ledgerAllocations('demo')[0]).toMatchObject({
      n: 261, state: 'landed',
      landedIn: 'docs/superpowers/plans/b-defines.md',
    });
  });

  it('a citation ALONE lands nothing — the live shape, with no definition anywhere', async () => {
    const h = fixture();
    await seedAndAllocate(h, 1);                          // 261
    h.plantDoc('demo', 'plans', 'cite.md',
      `> **D-${261}..D-${299}** from \`POST /api/ledger/deviations\`.`);
    at(NOW + 1000);
    await h.watcher.sweepLedgerReconcile();
    expect(h.coord.ledgerAllocations('demo')[0])
      .toMatchObject({ n: 261, state: 'allocated', landedIn: null, landedAt: null });
  });
```

And repair two existing cases that go VACUOUS under the fix. Each currently plants a BARE MENTION,
which after the fix can never land at all — so each would pass with its own mechanism deleted:

```ts
// REPLACES the plantDoc line at :267, inside
// it(`D-${261} does not land D-${2611} — the boundary is a word boundary`)
// (add the warn spy too: the definition below is an unissued number, so the
//  orphan half now reports it, and an unmocked console.warn is noise in the run)
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    h.plantDoc('demo', 'plans', 'p.md', `### D-${2611} — a different number, defined`);

// REPLACES the plantDoc line at :292, inside
// it('own clock: a second sweep inside 15 minutes does not act')
    h.plantDoc('demo', 'plans', 'p.md', `### D-${261} — would land, but for the clock`);
```

Both replacements were checked against `ledger.ts:184`'s real `DEFINITION` regex:
`### D-${2611} — …` and `- **D-${261}** — …` classify as definitions (spelled SPLIT here, as in the fixtures themselves: writing that number contiguously in a TRACKED file seeds
`floorFromScan` at 2661 and burns ~1300 numbers forever — measured, this line did exactly that the
moment this plan was first committed, and `deviation-refs.test.ts:150` caught it);
`> **D-261..D-299** from …` classifies as none, with or without the `> `. `afterEach` at `:27`
already calls `vi.restoreAllMocks()`.

- [ ] **Step 2: Run it and watch it fail**

Run: `cd server && ./node_modules/.bin/vitest run test/ledger-sweep.test.ts`

Expected: FAIL —
- *lands on the file that DEFINES the number*:
  `expected { n: 261, state: 'landed', landedIn: 'docs/superpowers/plans/a-cites.md', … } to match object { n: 261, state: 'landed', landedIn: 'docs/superpowers/plans/b-defines.md' }`
- *a citation ALONE lands nothing*:
  `expected { n: 261, state: 'landed', landedIn: 'docs/superpowers/plans/cite.md', landedAt: … } to match object { n: 261, state: 'allocated', landedIn: null, landedAt: null }`
- The two repaired cases stay GREEN at this step (their new fixtures still land nothing under the
  old matcher for the word-boundary case, and the clock still gates the other) — they are
  de-vacuumings, and Step 5 (ii) and (iii) are what prove they are now live.

- [ ] **Step 3: Implement** — replace `server/src/watch.ts:2113-2125`:

```ts
      // ONE NOTION OF "THIS PLAN CARRIES D-N", shared by both halves of this
      // sweep. Until now the landing half matched a bare `\bD-<n>\b` over the
      // whole file text while the orphan half below used `definitionsIn` — two
      // standards over the same corpus, eleven lines apart, in the same loop. It
      // fired: on 2026-09-02 a BLOCKQUOTE citing an allocation range stamped two
      // numbers `landed` (terminally — markLanded's `state = 'allocated'` guard
      // never re-evaluates a landed row) against a plan that DEFINES neither and
      // sits on no merged ref. `definitionsIn` reads that same line as no
      // definition at all, which is why SHARING the predicate is the fix rather
      // than adding a second regex. Computed once and used twice, so the two
      // halves cannot drift apart again.
      const defs = definitionsIn(files);
      for (const a of openByProject.get(project) ?? []) {
        const hit = defs.find((d) => d.n === a.n);
        if (hit !== undefined) store.markLanded(project, a.n, hit.file, now);
      }
      // The INVERSE of `markLanded`, and the half nothing has ever measured: a
      // plan that DEFINES an allocator-era number the allocator never issued.
      // Reported, never enforced — the ledger is prose and this sweep has no
      // standing to refuse anything (D13's own stance on `stale`, one block
      // down). See `unallocatedDefinitions` for what this deliberately does NOT
      // claim, and why batch scatter is not reported here.
      const orphans = unallocatedDefinitions(defs, store.ledgerIssued(project));
```

Note `hit.file` — `Definition` names it `file`, where the old `LedgerDoc` named it `path`.

- [ ] **Step 4: Run it and watch it pass**

```
cd server && ./node_modules/.bin/vitest run test/ledger-sweep.test.ts test/ledger-crosstree.test.ts test/ledger-store.test.ts test/ledgerseed.test.ts test/ledger-routes.test.ts
```

`ledger-crosstree.test.ts` is the L1 pin for BOTH predicates (355 lines, 30 `it(` across three
describes, measured `grep -c "  it(" ` on 2026-09-02); this task changes the CALLER, not the
predicates, so all 30 must stay green — they are the control.

- [ ] **Step 5: MUTATION CHECK**
  - **(i) restore the old matcher** —
    ``const re = new RegExp(`\\bD-${a.n}\\b`); const hit = files.find((f) => re.test(f.text));``
    with `store.markLanded(project, a.n, hit.path, now)`: expect RED on BOTH new cases —
    `landedIn: 'docs/superpowers/plans/a-cites.md'` and `state: 'landed'` where `'allocated'` was
    expected. RIGHT REASON: that is byte-for-byte the code that produced the live mis-stamp, and the
    fixture is the live shape.
  - **(ii) change `defs.find((d) => d.n === a.n)` to
    `defs.find((d) => String(d.n).startsWith(String(a.n)))`**: expect RED on the repaired
    word-boundary case at `:264` — `expected 'landed' to be 'allocated'`, since `'2611'` starts with
    `'261'`. This is what proves the repaired fixture is live: with the OLD bare-mention fixture the
    same mutation stayed green.
  - **(iii) delete the 15-minute gate** (`watch.ts:2084-2085`'s
    `if (this.lastLedgerReconcile !== 0 && now - this.lastLedgerReconcile < LEDGER_RECONCILE_SWEEP_MS) return;`):
    expect RED on the repaired *own clock* case at `:287` — `expected 'landed' to be 'allocated'`.
    Same purpose: the old bare-mention fixture could never land, so that case was compatible with
    the gate being gone.

  Revert all three.

- [ ] **Step 6: Commit**

```bash
git add server/src/watch.ts server/test/ledger-sweep.test.ts && git commit -m "fix(wave8): a number CITED in a plan is not a number the plan defines (D-1420, D-1421)"
```

**LEDGER: D-1420** — the reconcile sweep applied two different notions of
"this plan carries D-N" to the same corpus eleven lines apart (a bare `\bD-<n>\b` over the whole file
text for landing, the definition shape for orphans), and on 2026-09-02 a blockquote citing an
allocation range terminally stamped two numbers `landed` against a plan that defines neither and sits
on no merged ref; both halves now share `definitionsIn`, computed once.

**LEDGER: D-1421** — two existing reconcile cases (the word-boundary case and the
own-clock case) planted a BARE MENTION, so under the corrected matcher each would have passed with
its own mechanism deleted; both fixtures now plant a real definition, which is the only shape that
can reach the behaviour they claim to measure, and each carries the mutation that proves it.

---

### Task 47: the docstrings stop claiming `landed` means merged

**Files:**
- Modify: `server/src/watch.ts:2076-2080` and an INSERT after `:1980`;
  `server/src/coord/schema.ts:552-555`; `server/src/coord/store.ts:3323-3324` (delete) and a new
  docstring above `:3342`; `shared/api.ts:5525-5529`
- Test: `server/test/ledger-sweep.test.ts` (new `describe` at the end of the file)

**Interfaces:**
- Consumes: nothing
- Produces: nothing

**Why:** FOUR shipped-source files claim `landed` means merged. Measured at HEAD with
`tr -s '[:space:]' ' ' < <file> | grep -oiE 'genuinely means merged|genuinely merged|in a merged plan|in a plan in the MAIN'`:
`watch.ts` → 1 (`genuinely means merged`), `schema.ts` → 1 (`in a plan in the MAIN`), `store.ts` → 1
(`in a merged plan`), `shared/api.ts` → 2 (`in a plan in the MAIN`, `genuinely merged`). It is not
true: `readLedgerDocs` (`ledgerseed.ts:158-198`) builds `${projectsRoot}/${project}/docs/superpowers`
at `:164` and reads it with `io.readdir`/`io.readFile`; `files[].path` at `:194` is SYNTHESISED from
a readdir entry; nothing between that readdir and the column consults git
(`grep -cin git server/src/coord/ledgerseed.ts` → 0). Measured 2026-09-02: the sweep stamped
`landedIn` with a path on no merged ref. `shared/api.ts` even contradicts itself — `:5525-5526`
claims merged while `:5544-5546`, six lines down, honestly says *"the plan file reconcile found the
number in"*. And `store.ts:3323-3324`'s copy is ORPHANED: two block comments sit back to back and
the one that follows them is `ledgerProjects()` at `:3330`, while `markLanded` at `:3342` has no
docstring at all (measured: `allocated -> landed, once` is 1052 chars above `markLanded`, outside any
reasonable docstring window).

**Correcting the draft:** it listed `server/test/ledger-sweep.test.ts` as a fifth site. Measured, that
file matches the regex **zero** times — its header at `:1-4` says *"reconcile marks allocated ->
landed off the plans dir every 15 minutes"* and claims no merge. It is therefore NOT a site, and it
is deliberately kept OUT of `SITES` for a second reason: the guard's own regex literal lives in that
file, so including it would make the scan self-matching and permanently red.

- [ ] **Step 1: Write the failing test**

Add `readFileSync` to the **existing** `node:fs` import at `ledger-sweep.test.ts:13` (which reads
`import { mkdirSync, writeFileSync } from 'node:fs';`) — do NOT add a second `node:fs` import — and
add one new line after `:12`:

```ts
import { fileURLToPath } from 'node:url';
```

Then a new `describe` at the end of the file:

```ts
describe('what `landed` is allowed to claim', () => {
  const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
  const read = (rel: string): string => readFileSync(path.join(REPO, rel), 'utf8');
  const flat = (s: string): string => s.replace(/\s+/g, ' ');

  /** A named slice between two literal anchors. An anchor that stopped matching
   *  yields '', and '' satisfies every assertion below it — box-token-census
   *  .test.ts:220's rule, copied for its reason as much as its shape. */
  const passage = (name: string, text: string, from: string, to: string): string => {
    const a = text.indexOf(from);
    expect(a, `${name}: the opening anchor is gone`).toBeGreaterThan(-1);
    const b = text.indexOf(to, a + from.length);
    expect(b, `${name}: the closing anchor is gone`).toBeGreaterThan(a);
    const out = flat(text.slice(a, b));
    expect(out.length, `${name} is too short to be the passage`).toBeGreaterThan(120);
    return out;
  };

  // THIS FILE IS DELIBERATELY NOT A SITE. It makes no merge claim (measured: the
  // regex below scores zero against it at 5e9f650d), and it holds that regex as a
  // literal — scanning itself is the self-matching-guard failure, permanently red
  // for a reason that has nothing to do with the corpus.
  const SITES = ['server/src/watch.ts', 'server/src/coord/schema.ts',
                 'server/src/coord/store.ts', 'shared/api.ts'] as const;

  // ANCHORED PER SITE, not whole-file: `shared/api.ts` already contains a
  // lowercase "working tree" at :652 (`cmd_ws_audit reads the working tree
  // ITSELF`), so a whole-file presence check would be green before the change and
  // stay green if the corrected sentence were deleted — the exact mutation this
  // case exists to catch.
  const PASSAGES: ReadonlyArray<readonly [string, string, string, string]> = [
    ['watch.ts, sweepLedgerReconcile', 'server/src/watch.ts',
     '   * D13: allocated -> landed', '  async sweepLedgerReconcile'],
    ['watch.ts, sweepLedgerFloor', 'server/src/watch.ts',
     '   * D13: the allocator SELF-SEEDS', '  async sweepLedgerFloor'],
    ['schema.ts, the ledger_alloc DDL comment', 'server/src/coord/schema.ts',
     "  -- D13: the allocator's record.", '  CREATE TABLE ledger_alloc ('],
    ['store.ts, markLanded', 'server/src/coord/store.ts',
     '  /** allocated -> landed, once', '  markLanded(project: string'],
    ['shared/api.ts, DeviationAllocation', 'shared/api.ts',
     ' * One allocated deviation number, as `GET /api/ledger` reports it.',
     'export interface DeviationAllocation'],
  ];

  it('no site claims a merge the reader never performs', () => {
    // The read is io.readdir/io.readFile under ${projectsRoot}/${project}, on
    // whatever branch that checkout is on, uncommitted edits included — measured
    // 2026-09-02, when it stamped landedIn with a path on no merged ref.
    for (const rel of SITES) {
      expect(flat(read(rel)), `${rel} still says landed means merged`)
        .not.toMatch(/genuinely means merged|genuinely merged|in a merged plan|in a plan in the MAIN/);
    }
  });

  it('and each passage that used to lie says what IS measured', () => {
    // Absence is not enough: deleting the sentence would satisfy the case above.
    // Lowercase on purpose — the assertion is case-SENSITIVE, so the prose must
    // spell it `working tree`, not `WORKING TREE`.
    for (const [name, rel, from, to] of PASSAGES) {
      expect(passage(name, read(rel), from, to),
        `${name} dropped the claim instead of correcting it`).toMatch(/working tree/);
    }
  });

  it('markLanded carries its own docstring, and ledgerProjects is not described as landing', () => {
    const src = read('server/src/coord/store.ts');
    const i = src.indexOf('  markLanded(project: string');
    expect(i, 'markLanded moved — re-anchor this guard').toBeGreaterThan(-1);
    expect(src.slice(Math.max(0, i - 700), i),
      'markLanded still has no docstring of its own').toMatch(/allocated -> landed, once/);
    const j = src.indexOf('  ledgerProjects(): string[]');
    expect(j, 'ledgerProjects moved — re-anchor this guard').toBeGreaterThan(-1);
    expect(src.slice(Math.max(0, j - 700), j),
      'the landing docstring is still attached to ledgerProjects').not.toMatch(/allocated -> landed/);
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `cd server && ./node_modules/.bin/vitest run test/ledger-sweep.test.ts -t "landed is allowed"`

Expected: FAIL —
- *no site claims a merge*: vitest stops at the loop's first failure,
  `server/src/watch.ts still says landed means merged`. All FOUR sites match (measured counts above),
  so the message walks the list as each is fixed. It is FOUR, not five.
- *each passage … says what IS measured*: `watch.ts, sweepLedgerReconcile dropped the claim instead
  of correcting it: expected '…' to match /working tree/`. (Both `watch.ts` and `store.ts` contain
  zero case-insensitive matches of `working tree` at HEAD, and `shared/api.ts`'s only one is at
  `:652`, outside every passage — so all five passages red.)
- *markLanded carries its own docstring*: `markLanded still has no docstring of its own` — the
  window 700 chars before `markLanded` does not reach the orphaned comment (distance 1052,
  measured). The `ledgerProjects` assertion is the second one and appears after that is fixed.

- [ ] **Step 3: Implement** — one sentence, five places, adapted to each comment syntax.

**`server/src/watch.ts:2076-2080`** (inside the existing `/** … */`, which opens at `:2075` and
closes at `:2081`):

```ts
   * D13: allocated -> landed when a plan of the main checkout DEFINES the number.
   * `landed` means exactly that and no more: the number was seen defined in a plan
   * file in the working tree of `<projectsRoot>/<project>` at the moment of a
   * sweep, on whatever branch that checkout was sitting on, uncommitted edits
   * included. It is NOT proof of a merge — nothing between `readLedgerDocs`'s
   * readdir and this column consults git, and `landedIn` names a path in that tree
   * which may exist on no ref (measured 2026-09-02: it did). Reading a REF instead
   * would need git, which is unreachable BY POLICY rather than by construction:
   * `CCRC_FLEET=remote` sends every command across the agent's
   * `EXEC_COMMANDS = ['tmux','ccd']` whitelist, while the server process itself
   * holds an unwhitelisted `execFile` (`server/src/exec.ts:59-71`) that LOCAL mode
   * uses. A number 7 days old and never landed is REPORTED (once per changing set)
   * and NEVER reclaimed.
```

**`server/src/coord/schema.ts:552-555`** — a COMMENT inside the frozen `MIGRATIONS[3]` string.
Amending it is safe precisely because nothing re-runs that entry and SQL comments are not persisted;
the correction is for the reader of this file, not for any database. Note that `:555` is re-emitted
at the end so `:556`'s `-- never-landed), reported and NEVER reclaimed.` keeps its subject, and the
`'stale' is NEVER WRITTEN here` invariant survives verbatim:

```sql
  -- shared/api.ts) — 'landed' means the number was seen DEFINED in a plan file
  -- in the working tree of the MAIN checkout at sweep time, on whatever branch
  -- that checkout was on, uncommitted edits included (sweepLedgerReconcile,
  -- part B). NOT proof of a merge: no git is consulted on that path, so it is a
  -- weaker signal than the one the bb47c9e incident lacked, not the same one.
  -- 'stale' is NEVER WRITTEN here: a fact about a row and a clock is
  -- derived by the reader (allocatedAt + LEDGER_STALE_MS, 7 days
```

**`shared/api.ts:5525-5529`** (inside the `DeviationAllocation` docstring; `:5530` is the closing
` */`):

```ts
 * `'landed'` means the number was seen DEFINED in a plan file in the working
 * tree of the MAIN checkout at sweep time (`sweepLedgerReconcile`), on whatever
 * branch that checkout was on — NOT proof of a merge; `landedIn` (below) names a
 * path in that tree, which may exist on no ref. `stale` is DERIVED at read time
 * from `allocatedAt`, `state` and the clock, never stored (see
 * `DEVIATION_ALLOC_STATES`); it rides the wire so a phone can see it without
 * owning a clock policy.
```

**`server/src/coord/store.ts`** — DELETE the orphaned block at `:3323-3324` and give `markLanded` at
`:3342` its own:

```ts
  /** allocated -> landed, once. `landed` means the number was seen DEFINED in a
   *  plan file of the main checkout's working tree (D13) — not proof of a merge —
   *  and the `state = 'allocated'` guard makes it TERMINAL, so a re-scan never
   *  re-stamps the date and a wrong stamp is never re-decided. */
  markLanded(project: string, n: number, landedIn: string, at: number): void {
```

**`server/src/watch.ts`, the FLOOR lane** — an INSERT, not a replacement: `:1977` ends
`* mechanism. \`floorFromScan\` owns the gap arithmetic and the evidence` and `:1978-1980` finish
that sentence and state the 50-number-gap rationale plus the `bb47c9e` reference. Leave `:1972-1980`
exactly as they are and insert this paragraph after `:1980`, before the blank `   *` at `:1981`:

```ts
   *
   * SEEDED FROM THE SAME branch-dependent working tree as reconcile, and unlike
   * reconcile that is left alone DELIBERATELY. A floor that reads a plan on an
   * unmerged branch raises the fleet's floor permanently and burns every number
   * below it — measured 2026-09-02, this project's floor stood well above the
   * highest number the allocator had ever issued, raised off a file on no merged
   * ref. (No cardinal here: the floor rises on its own sweep, so any figure
   * written down is false by the next tick.) That is WASTE, not corruption: the
   * numbers are cheap and a conservative floor is exactly what prevents a
   * reissue, which is the failure this lane exists to make impossible.
   * Reconcile's looseness was different in kind — it wrote a false fact into a
   * TERMINAL column — which is why only that one was tightened.
```

- [ ] **Step 4: Run it and watch it pass**

`cd server && ./node_modules/.bin/vitest run test/ledger-sweep.test.ts test/coord-db.test.ts test/single-definition.test.ts`
and `cd pwa && ./node_modules/.bin/vitest run` (the PWA bundles `shared/api.ts`).

- [ ] **Step 5: MUTATION CHECK**
  - **(i) restore `genuinely means merged` in `watch.ts`**: expect RED on *no site claims a merge*
    with `server/src/watch.ts still says landed means merged`.
  - **(ii) DELETE the corrected sentence from `shared/api.ts`'s `DeviationAllocation` docstring**
    (leaving the rest of the docstring): expect RED on *each passage … says what IS measured* with
    `shared/api.ts, DeviationAllocation dropped the claim instead of correcting it: expected '…' to
    match /working tree/`. RIGHT REASON, and the reason the assertion is scoped to the passage: the
    file's unrelated `working tree` at `:652` would have kept a whole-file check green.
  - **(iii) move the new `markLanded` docstring back above `ledgerProjects`**: expect RED with
    `markLanded still has no docstring of its own`, then with
    `the landing docstring is still attached to ledgerProjects`.
  - **(iv) delete the inserted floor-lane paragraph**: expect RED with
    `watch.ts, sweepLedgerFloor dropped the claim instead of correcting it`.

  Revert all four.

- [ ] **Step 6: Commit**

```bash
git add server/src/watch.ts server/src/coord/schema.ts server/src/coord/store.ts shared/api.ts server/test/ledger-sweep.test.ts && git commit -m "docs+test(wave8): landed means what the sweep measured, in all four places that claimed a merge (D-1422, D-1423)"
```

**LEDGER: D-1422** — four shipped-source sites claimed `landed` means merged, while
`readLedgerDocs` reads the main checkout's working tree through `FleetIO` with no git anywhere and
synthesises `landedIn` from a readdir entry — and `shared/api.ts` contradicted itself six lines
apart; all four now say what is measured, and `store.ts`'s copy is moved off `ledgerProjects`, which
it had drifted onto, and given to `markLanded`, which had no docstring at all. (The sweep suite's own
header was checked and makes no such claim, so it is not a site.)

**LEDGER: D-1423** — `sweepLedgerFloor` seeds from the same branch-dependent
working tree and the floor only ever rises, so an unmerged plan raised this project's floor above
the highest number ever issued (measured 2026-09-02) — the matcher is deliberately NOT changed and
the docstring now argues why: a conservative floor burns numbers, which is waste, where reconcile's
looseness wrote a false fact into a terminal column.

---

### Task 48: a migration un-lands the two rows the old matcher stamped

**Files:**
- Modify: `server/src/coord/schema.ts` (append `MIGRATIONS[7]` after the entry that ends at `:720`,
  before the closing `];` at `:721`), `server/test/coord-db.test.ts` (nine `.toBe(7)` sites — see
  below)
- Test: `server/test/coord-db.test.ts` (new `describe` at the end)

**Interfaces:**
- Consumes: Task 46's corrected matcher — the repair only makes sense once the sweep re-decides
  correctly
- Produces: `COORD_SCHEMA_VERSION` becomes 8 (`schema.ts:726` is `MIGRATIONS.length` and nothing
  else)

**Why:** Hand-editing production data is available to nobody, so the repair has to be an in-tree
mechanism. Measured live 2026-09-02: D-1294 and D-1332 are `state: landed`, `landedAt:
1788354778004`, `landedIn: docs/superpowers/plans/2026-09-02-graphify-read-side-ccrc-level.md` — a
file `git cat-file -e origin/main:…` reports absent and `git branch -a --contains` places only on
`feat/` and `design/graphify-read-side-ccrc-level`. Both ARE genuinely defined on `origin/main` in
`docs/superpowers/plans/2026-09-02-program-leverage-wave7-f7.md` (`- **D-1294**` at `:1195`,
`- **D-1332**` at `:1789`), so a corrected sweep re-lands them with the right file once the main
checkout carries it. `markLanded`'s `WHERE … state = 'allocated'` (`store.ts:3345`) makes the wrong
stamp terminal, so the corrected sweep would otherwise never re-decide them. The WHERE clause keys on
the PATH rather than on a number list, and that is safe by measurement: replaying `definitionsIn`
over that file shows it defines 18 numbers of which the allocator has issued ZERO, so no
correctly-landed row can name it — exactly two rows do, and both are the corrupted pair (23 distinct
`landedIn` files overall).

- [ ] **Step 1: Write the failing test**

```ts
// server/test/coord-db.test.ts — new describe at the end of the file
describe('coord.db: migration 8 — un-landing the mention-matched rows', () => {
  const BAD = 'docs/superpowers/plans/2026-09-02-graphify-read-side-ccrc-level.md';
  const GOOD = 'docs/superpowers/plans/2026-09-02-program-leverage-wave7-f7.md';

  /** A file exactly as a server at user_version 7 left it, carrying two rows
   *  stamped off a CITATION, one stamped off a real definition, and one open. */
  const atV7 = (): string => {
    const p = dbPathIn(mkTmp('ccrc-coord-'));
    mkdirSync(path.dirname(p), { recursive: true });
    const raw = new DatabaseSync(p);
    tx(raw, () => {
      for (let i = 0; i <= 6; i++) raw.exec(MIGRATIONS[i]!);
      raw.exec('PRAGMA user_version = 7');
    });
    const ins = raw.prepare(
      'INSERT INTO ledger_alloc (project, n, title, allocatedTo, runId, allocatedAt, ' +
      'state, landedAt, landedIn) VALUES (?, ?, ?, ?, NULL, ?, ?, ?, ?)');
    ins.run('ccrc-pwa', 1293, 'genuinely landed', 'x', 1, 'landed', 9, GOOD);
    ins.run('ccrc-pwa', 1294, 'stamped off a citation', 'x', 1, 'landed', 9, BAD);
    ins.run('ccrc-pwa', 1300, 'still open', 'x', 1, 'allocated', null, null);
    ins.run('ccrc-pwa', 1332, 'stamped off a citation', 'x', 1, 'landed', 9, BAD);
    raw.close();
    return p;
  };

  const ROWS = 'SELECT n, state, landedAt, landedIn FROM ledger_alloc ORDER BY n';

  it('un-lands exactly the rows landed against the citing file, and touches nothing else', () => {
    const p = atV7();
    const db = openCoordDb(p);
    expect((db.prepare('PRAGMA user_version').get() as { user_version: number }).user_version)
      .toBe(COORD_SCHEMA_VERSION);
    expect(db.prepare(ROWS).all()).toEqual([
      { n: 1293, state: 'landed', landedAt: 9, landedIn: GOOD },
      { n: 1294, state: 'allocated', landedAt: null, landedIn: null },
      { n: 1300, state: 'allocated', landedAt: null, landedIn: null },
      { n: 1332, state: 'allocated', landedAt: null, landedIn: null },
    ]);
    db.close();
  });

  it('is scoped by PATH, so a row landed elsewhere afterwards survives a re-run', () => {
    // Not merely "running it twice changes nothing" — that is trivially true once
    // no row matches. This plants a row the CORRECTED sweep would land, after the
    // migration, and proves the statement cannot reach it.
    const p = atV7();
    const db = openCoordDb(p);
    db.prepare(
      'INSERT INTO ledger_alloc (project, n, title, allocatedTo, runId, allocatedAt, ' +
      'state, landedAt, landedIn) VALUES (?, ?, ?, ?, NULL, ?, ?, ?, ?)',
    ).run('ccrc-pwa', 1340, 're-landed by the corrected sweep', 'x', 1, 'landed', 11, GOOD);
    const before = db.prepare(ROWS).all();
    db.exec(MIGRATIONS[7]!);
    expect(db.prepare(ROWS).all()).toEqual(before);
    db.close();
  });
});
```

**And the version constant.** `grep -n 'toBe(7)' server/test/coord-db.test.ts` returns NINE sites:
`330, 331, 376, 444, 551, 573, 649, 656, 657`. Handle them as three groups — and note the line
numbers shift once `:331` is deleted, so work from the bottom up or anchor on the text:

1. **SIX identical lines** at `:330, 376, 444, 551, 573, 649`, each byte-for-byte
   `    expect((db.prepare('PRAGMA user_version').get() as { user_version: number }).user_version).toBe(7);`
   — replace ALL with `.toBe(COORD_SCHEMA_VERSION)`. They assert *"an old file reached the current
   version"*, which is what that constant IS.
2. **DELETE `:331`** (`    expect(COORD_SCHEMA_VERSION).toBe(7);`, inside the migration-1 test). It
   is a second literal copy of the claim `:656` already pins deliberately, and a value enumerated
   twice is the defect this repo forbids. `:656` remains the one place the number is a claim someone
   has to edit.
3. **HAND-EDIT the three deliberate pins**: the title at `:655`
   (`it('COORD_SCHEMA_VERSION derives to 7 — never hand-edited beside a growing array', …`) → `8`,
   and `expect(COORD_SCHEMA_VERSION).toBe(8)` / `expect(MIGRATIONS.length).toBe(8)` at `:656-657`.

- [ ] **Step 2: Run it and watch it fail**

Run: `cd server && ./node_modules/.bin/vitest run test/coord-db.test.ts`

Expected: FAIL —
- *un-lands exactly the rows*: `expected [ { n: 1293, … }, { n: 1294, state: 'landed', landedAt: 9,
  landedIn: '…graphify-read-side-ccrc-level.md' }, … ] to deeply equal [ … { n: 1294, state:
  'allocated', landedAt: null, landedIn: null } … ]`
- *scoped by PATH*: `TypeError: Cannot read properties of undefined` at `db.exec(MIGRATIONS[7]!)` —
  the entry does not exist yet
- *COORD_SCHEMA_VERSION derives to 8*: `expected 7 to be 8`, twice.

- [ ] **Step 3: Implement** — append to `MIGRATIONS` in `server/src/coord/schema.ts`, after the entry
  ending at `:720`:

```ts
  // ── 8: user_version 7 -> 8 ────────────────────────────────────────────────
  // A ONE-TIME DATA REPAIR — the only entry here that is not DDL, and the reason
  // it is one is that hand-editing a live coord.db is available to nobody.
  // MIGRATIONS[0..6] ARE FROZEN, for the reason every entry above states:
  // db.ts's loop runs `for (v = current; v < COORD_SCHEMA_VERSION; v++)`, so an
  // amendment to an applied entry never runs again.
  //
  // WHAT WENT WRONG. Until this build the reconcile sweep's landing half matched
  // a bare `\bD-<n>\b` anywhere in a plan's text while its orphan half, eleven
  // lines away, used the DEFINITION shape. On 2026-09-02 a blockquote citing an
  // allocation range stamped two numbers `landed` against a plan that defines
  // neither and that is on no merged ref. `markLanded`'s
  // `WHERE ... state = 'allocated'` makes that terminal, so the corrected sweep
  // would never re-decide them: the rows have to be put back before it can.
  //
  // WHY THE PATH IS THE DISCRIMINATOR, and not a list of numbers. SQL cannot run
  // `definitionsIn`, so the repair keys on the one thing the row records.
  // Measured before writing it: replaying `definitionsIn` over that file yields
  // 18 defined numbers of which the allocator has issued NONE, so no
  // correctly-landed row can name it — and exactly two rows do, out of 23
  // distinct `landedIn` files. This therefore cannot reach a good row, and it
  // also repairs any further row the old matcher stamped there before this
  // shipped. It does NOT generalise to a different citing file; the matcher fix
  // is what stops there being one.
  //
  // AFTER THIS both numbers are `allocated` again and the corrected sweep
  // re-decides them from the plans it can actually read. Both ARE defined on
  // origin/main in 2026-09-02-program-leverage-wave7-f7.md, so the honest outcome
  // is a re-land with the right file once the main checkout carries it — and
  // until then an open row, which is a true statement where the stamp was a
  // false one.
  `
  UPDATE ledger_alloc
     SET state = 'allocated', landedAt = NULL, landedIn = NULL
   WHERE state = 'landed'
     AND landedIn = 'docs/superpowers/plans/2026-09-02-graphify-read-side-ccrc-level.md';
  `,
```

- [ ] **Step 4: Run it and watch it pass**

`cd server && ./node_modules/.bin/vitest run test/coord-db.test.ts test/ledger-store.test.ts test/ledger-sweep.test.ts test/node-floor.test.ts`

- [ ] **Step 5: MUTATION CHECK**
  - **(i) point the WHERE clause at the wave7 path (`GOOD`) instead**: expect RED on *un-lands
    exactly the rows* with the `n: 1293` row coming back `state: 'allocated', landedAt: null` while
    1294/1332 stay `landed`. RIGHT REASON: it proves the path is what selects, and that selecting
    wrongly damages a correct row.
  - **(ii) drop `landedAt = NULL` from the SET**: expect RED with `landedAt: 9` where `null` was
    expected — an un-landed row keeping its stamp is exactly the overloaded value this repair
    removes.
  - **(iii) delete the whole entry**: expect RED at `expect(MIGRATIONS.length).toBe(8)` —
    `expected 7 to be 8`.

  **The `state = 'landed'` predicate carries NO mutation, and that is stated rather than hidden.**
  Measured: `markLanded` (`store.ts:3342-3347`) is the only writer of `landedIn` anywhere in
  `server/src` and it always sets `state`, `landedAt` and `landedIn` together, so an `allocated` row
  with a non-null `landedIn` is a state the tree cannot reach. A fixture that could red that
  predicate would have to invent one, which is the "fixture that cannot occur" fault in mirror
  image. The predicate stays as documented belt-and-braces; the two mutations above are what hold
  this statement.

  Revert each.

- [ ] **Step 6: Commit**

```bash
git add server/src/coord/schema.ts server/test/coord-db.test.ts && git commit -m "fix(wave8): un-land the two rows a citation stamped, so the corrected sweep can re-decide them (D-1424)"
```

**LEDGER: D-1424** — a `user_version` 7→8 migration un-lands exactly the rows whose
recorded landing names the file the citation stamped, because `markLanded`'s terminal WHERE clause
means the corrected sweep would otherwise never re-decide them — keyed on the path rather than on a
number list, which is provably safe because that file defines 18 numbers of which the allocator
issued none, so no correctly-landed row can name it.

---

### Open decisions for the operator

1. **Task 43 edits a VERBATIM-PINNED clause.** The brief said both identity blocks sit outside the
   pinned clause lists; verified, that is true of the coordinator and FALSE of the worker — worker
   clause 1 (`SKILL.md:58`, pinned at `worker-skill.test.ts:48`) itself quotes
   `tmux display-message -p '#S'`, and both suites carry a standing `toContain` on that literal. The
   task therefore rewrites a clause, its pin and the test comment that describes it in one commit. A
   ruling that clause text is frozen would mean fixing only the fenced blocks and leaving clause 1
   contradicting the block three lines above it.
2. **`--by` passes today's identity denylist** (`ccrc-api-closed.test.ts:91-99` names four spellings
   and not a fifth). Task 41 rewrites that guard to STATE the new rule rather than slip past it, and
   derives the permitted flag set from the client's own case labels. Confirm that is the intended
   reading of "an explicit `--by` flag as the documented door", because `ccd/ccrc-api:149-150`
   currently says in words that there is deliberately no flag.
3. **Task 41 scopes the `byId` fill to `ledger allocate` WITH a body.** That keeps the existing
   closed-table row at `ccrc-api.test.ts:126` green for a stated reason (a bodyless allocate
   attributes nothing, and the route 400s it anyway) rather than by accident — but it does mean the
   rule is about bodies this client sends, not about the verb.
4. **Task 48's migration is the only non-DDL entry in the chain and it names a specific file path.**
   Confirm that a one-time data repair belongs in `MIGRATIONS` rather than in an operator tool; the
   argument in the comment is that hand-editing a live `coord.db` is available to nobody and
   `markLanded` is terminal, so nothing else can put the rows back.
5. **Adding `MIGRATIONS[7]` moves `COORD_SCHEMA_VERSION` to 8 and touches nine assertions in
   `coord-db.test.ts`.** The task converts the six "an old file reached the current version"
   assertions to the derived constant, DELETES one redundant literal, and hand-edits the three
   deliberate pins. Confirm the derivation is wanted — the alternative is nine literal edits now and
   nine again next migration.
6. **Un-landing D-1294 and D-1332 puts them back in the open set.** Because the main checkout
   currently sits on the graphify branch, which does not carry the wave-7 plan that defines them,
   they will stay `allocated` until that checkout is on a tree containing it — and the 7-day stale
   warning would name them from 2026-09-09. That is an honest open row where the stamp was a false
   landing, but it is a visible consequence an operator should expect.
7. **The floor is already burned** — well above the highest number ever issued, raised off a file on
   no merged ref, and irreversible by design. This item does not try to lower it. If the lost band
   matters, that is a separate decision about the floor lane's matcher; Task 47 only documents the
   argument.

### Deliberately out of scope

1. Any change to `POST /api/ledger/deviations`. The operator fenced this to the client, so
   `byId ?? ''` keeps laundering an absent field into an empty string at the route; the client now
   refuses a blank one before it can be sent, which closes the path in practice.
2. Backfilling the historic empty holders. All of them are `state: landed`, and `ledgerlog.ts:34-40`
   has already written each as a line of `"allocatedTo":""` into the append-only
   `~/.ccrc/ledger-alloc.log` — the artefact that makes reissue impossible — so a DB-only backfill
   would put the two ground truths out of step. There is also no `UPDATE … SET allocatedTo` anywhere
   in the tree.
3. `requireAttribution` on the allocator (`routes.ts:331`): it would need `byUuid` and would 403 old
   clients; outside the fence.
4. Making `landed` actually mean merged. Reading a ref needs git, which on this fleet is unreachable
   by POLICY (every command crosses the agent's `EXEC_COMMANDS = ['tmux','ccd']`) though NOT by
   construction (`server/src/exec.ts:59-71` is an unwhitelisted `execFile` that local mode uses) —
   either an agent-whitelist widening or a new ccd verb, both above a wave's authority. No
   `landedOn` column either: that is a wire+schema addition whose value depends on the ruling above.
5. The floor lane's MATCHER: argued and left alone in Task 47's docstring.
6. `read.complete` at `watch.ts:2111`: a PARTIAL read still runs both halves, and the 7-day warning
   then asserts a positive fact about a corpus that was never fully measured. Real, adjacent, and a
   different defect from the one this item was sent for.
7. `isSafeProjectSegment` missing at `watch.ts:2004` and `:2109` (present at `ledgerseed.ts:213`):
   closed today only by an indirect argument through the allocator route.
8. Merged plan files still carrying the old grep procedure (this program's waves 1/2/5, build9a/9b,
   ws-reap, stage5): operator ruling — they are history.
9. `topology-clean.test.ts`: no eighth FORBIDDEN class, because its `scope?` docstring (`:216-219`)
   states "at ship NO class carries one" and this rule needs three files. The anchored `passage()`
   idiom is used instead.

## Work item 4 — the three inherited (Tasks 60–64)

### Preamble the executor of any task below needs

**Everything here was re-measured at HEAD `5e9f650d` (tree clean) on 2026-09-02.** Where a line number
appears it was opened and the quoted text confirmed at that line.

**`server/test/ccrc-api.test.ts` is NOT this item's alone.** Task 40 installs the `run()` harness at
`:84-97` and Task 41 adds a describe after the whoami block — both in work item 3, both before Task
64. So Task 64's quoted `:104` (`describe('the closed route table', …)`) and `:144-149` have moved
by the time it runs. Anchor by that describe's text, not by the number. The item's other ownership
note — that `ccd/ccrc-api`'s blocks are fenced off from work item 3's — still holds; this is the
TEST file, which is shared.

**Deploy lane.** Tasks 62, 63 and 64 touch `ccd/`. Root `CLAUDE.md`: a change touching `ccd/` is
**AGENT-FIRST** — `bash deploy/deploy.sh agent <host>` ships before the server lane. `ccd/ccrc-api` is
installed by `deploy/deploy.sh:624` (`install_atomic ccd/ccrc-api .local/bin/ccrc-api 755`), verified at
HEAD.

**TASK ORDER, and why it is not free.** Tasks 60 → 61 are strictly ordered (61 consumes a constant 60
creates, and 61's own pin has a premise 60 does not establish). Tasks 62, 63, 64 are independent of 60/61
and of each other. **Tasks 63 and 64 edit the same file in two disjoint places, and 63's edit MOVES 64's
lines**: 63 replaces a 7-line comment block with a 21-line one, so everything below it shifts by +14. Both
tasks below therefore anchor by **TEXT, never by line number, inside `ccd/ccrc-api`** — run them in either
order. The HEAD line numbers are quoted once, in each task's **Files** header, marked as provenance.

**File ownership, so work item 3 does not collide in `ccd/ccrc-api`.** Task 63 owns the comment block that
begins `# WHAT IS DELIBERATELY ABSENT.` and ends at the blank `#` before `# SELF-CONTAINED.` (HEAD: lines
32–38). Task 64 owns the single line beginning `#   * The route comes from ROUTES below,` and the comment
block that begins `# METHOD|path|needs-id|` and ends at the line before `declare -A ROUTES=(` (HEAD: line
24 and lines 61–65). Neither touches the `declare -A ROUTES=(` body or any `cmd_*` function — which is
where work item 3's `byId`/`cmd_whoami` change lands. And if work item 3 *adds* a ROUTES row, Task 64's pin
makes the prose update mandatory rather than optional: the suite reds until both prose sites state the new
word.

**A vitest trap that would silently hide every red below.** `-t` is `--testNamePattern`, a **regex**. `-t
"ARM (e)"` compiles to `ARM ` followed by a capture group matching the literal `e`; it does **not** match a
test named `ARM (e): …`, and it selects **zero** tests, which vitest reports as a pass. Every `-t` in this
section is deliberately **paren-free** and was checked for uniqueness against the target file at HEAD.
After every `-t` run, confirm vitest printed `1 passed` or `1 failed` — never `0 tests`.

---

### Task 60: Name the abandonment-park predicate once, before it gets a second reader

**Files:**
- Modify: `server/src/coord/store.ts` — insert a new constant between `DELIBERATE_CANCEL_ERRORS_SQL`
  (`:265-266`) and the long `/**  The READ-side "still needs a human's attention" predicate` docstring
  (`:268-357`); rewrite the definition at `:358-361`; amend two lines of that docstring at `:344-346`.
  (Verified at HEAD: `const OUTSTANDING_OR_ABANDONED_SQL` at `:358`, its three clauses at `:359-361`;
  `Written entirely as` ends `:344` and `a \`LEFT JOIN\` in this one SQL definition: no writer touched, no
  park` is `:345`.)
- Test: `server/test/single-definition.test.ts` — a new `it` inside `describe('Build 7 nouns', …)`
  (`:335-503`), immediately after the deliberate-cancel pin (`:380-407`).

**Interfaces:**
- Consumes: `DELIBERATE_CANCEL_ERRORS_SQL` (`server/src/coord/store.ts:265`)
- Produces: `const ABANDONED_PARK_SQL` (module-private, `server/src/coord/store.ts`) — the SQL fragment
  `(d.state = 'rejected' AND COALESCE(d.lastError, '') NOT IN <DELIBERATE_CANCEL_ERRORS_SQL> AND
  COALESCE(rr.state, '') NOT IN ('done','failed'))`. Aliases are the CALLER's: `d` = `mail_deliveries`,
  `rr` = the delivery's own run joined on `m.runId`. Task 61 selects on it.

**Why:** `OUTSTANDING_OR_ABANDONED_SQL` (`store.ts:358-361`) is about to acquire a second reader. Its
abandonment arm is *exactly* the set Task 61's fifth arm must re-queue — "a park this lane gave up on, that
a human still needs to see" — and a second statement that respelled those three clauses is how the read
side and the write side would come to disagree about which parks matter. The tree already has the precedent
and the guard shape: `DELIBERATE_CANCEL_ERRORS_SQL` (`store.ts:265-266`) exists for the same reason, and
`single-definition.test.ts:380-407` reds on a hand-written copy of it. Measured 2026-09-02: `grep -c
"COALESCE(rr.state, '') NOT IN ('done','failed')" server/src/coord/store.ts` → **1**, and `grep -c
"'done','failed'" server/src/coord/store.ts` → **13 lines**, one of which *is* that clause (`:361`) — so
**twelve** other lines carry the pair, every one of them a predicate on `runs` rows (`r.state`/`state`,
never the mail join's `rr`). That is why the needle below is the `rr.`-aliased clause and not a blanket ban.

**One sentence in the docstring above becomes false the moment this lands, and it is amended in the same
act.** `store.ts:344-345` reads "Written entirely as a `LEFT JOIN` in this one SQL definition". After the
extraction there are two definitions. Leaving it is precisely the defect class this wave exists to close.

- [ ] **Step 1: Write the failing test**

In `server/test/single-definition.test.ts`, append inside `describe('Build 7 nouns', …)` — immediately
after the `it('spells the deliberate-cancel pair ONCE …')` case that ends at `:407`:

```ts
  // The SECOND half of the same rule, and the reason it needs its own case: the
  // abandonment predicate is about to have two readers — the mailbox
  // (`outstandingMailFor`) and the reclaim's re-queue — and a respelling in
  // either is invisible to the deliberate-cancel pin above, which watches only
  // the two `lastError` literals. This watches the run-state clause, the half a
  // re-queue is most likely to retype because its alias (`rr`) is the caller's
  // own join.
  //
  // NO SELF-MATCH RISK, stated so the next author does not "fix" a hazard that
  // is not here: this case reads `server/src/coord/store.ts` ALONE, never `ALL`
  // and never itself, and `ROOTS` (:32-37) does not include `server/test`. The
  // needles below can therefore be written whole.
  it('spells the abandonment predicate ONCE — the constant, never a second copy of its clauses', () => {
    const store = readFileSync(path.join(ccrcRoot, 'server/src/coord/store.ts'), 'utf8');

    // The premise, established rather than assumed: this needle really is the
    // clause, and it really is distinct from the twelve `runs`-row predicates in
    // the same file (those read `r.state`/`state`, never the mail join's `rr`).
    const CLAUSE = "COALESCE(rr.state, '') NOT IN ('done','failed')";
    expect(store, 'the abandonment clause is not in store.ts at all').toContain(CLAUSE);
    expect(store.split(CLAUSE).length - 1,
      'the abandonment run-state clause is written more than once').toBe(1);

    // …and the one spelling lives in a named constant that the read predicate is
    // COMPOSED from, so "written once" cannot be satisfied by deleting a reader.
    expect(store, 'ABANDONED_PARK_SQL is not defined').toMatch(/^const ABANDONED_PARK_SQL =/m);
    expect(store).toMatch(
      /const OUTSTANDING_OR_ABANDONED_SQL =\s*`\(d\.state IN \$\{OUTSTANDING_STATES_SQL\} OR \$\{ABANDONED_PARK_SQL\}\)`;/);

    // THE PROSE HALF. The docstring one screen up describes the composed
    // predicate; after the split it may not still call itself ONE definition.
    // The premise is established first — there really are two now — so this is
    // not an absence assertion whose fixture cannot produce the presence.
    const defs = (store.match(/^const (?:ABANDONED_PARK_SQL|OUTSTANDING_OR_ABANDONED_SQL)\b/gm) ?? []).length;
    expect(defs, 'the two predicate definitions are not both present').toBe(2);
    const doc = store.slice(
      store.indexOf(' * The READ-side "still needs a human'),
      store.indexOf('const OUTSTANDING_OR_ABANDONED_SQL'));
    expect(doc.length, 'the predicate docstring anchors moved').toBeGreaterThan(300);
    expect(doc, 'the predicate docstring still calls the composed predicate one SQL definition')
      .not.toContain('in this one SQL definition');
  });
```

- [ ] **Step 2: Run it and watch it fail**

Run: `cd server && ./node_modules/.bin/vitest run test/single-definition.test.ts -t "spells the abandonment predicate ONCE"`

Expected: **1 failed** (not `0 tests`) — `ABANDONED_PARK_SQL is not defined`, on the
`toMatch(/^const ABANDONED_PARK_SQL =/m)` assertion, because the clauses are still inline in
`OUTSTANDING_OR_ABANDONED_SQL`.

- [ ] **Step 3: Implement**

(a) In `server/src/coord/store.ts`, insert the new constant **between** `DELIBERATE_CANCEL_ERRORS_SQL`
(ends `:266`) and the long docstring that opens `/**\n * The READ-side "still needs a human's attention"
predicate` (`:268`). Placing it here — rather than between the docstring and its constant — keeps that
docstring adjacent to the definition it describes:

```ts
/** The ABANDONMENT half of the predicate below, lifted into its own name because
 *  it is about to have a second reader: `requeueAbandonedCoordinatorMail`
 *  selects exactly the rows a mailbox shows as an abandoned park, and a re-queue
 *  that respelled these clauses would drift from the thing it is meant to
 *  mirror — the same argument `DELIBERATE_CANCEL_ERRORS_SQL` above makes about
 *  its two literals, one level up. Pinned by `single-definition.test.ts`'s
 *  "spells the abandonment predicate ONCE".
 *
 *  THE ALIASES ARE THE CALLER'S: `d` is `mail_deliveries` and `rr` is the
 *  delivery's own run, joined on `m.runId`. `COALESCE(rr.state, '')` is what
 *  makes the fragment indifferent to the JOIN KIND the caller brings, which is
 *  the whole reason a read path may reach it through a LEFT join and a write
 *  path through an inner one. */
const ABANDONED_PARK_SQL =
  "(d.state = 'rejected' " +
  `AND COALESCE(d.lastError, '') NOT IN ${DELIBERATE_CANCEL_ERRORS_SQL} ` +
  "AND COALESCE(rr.state, '') NOT IN ('done','failed'))";
```

(b) Replace the definition at `:358-361` with:

```ts
const OUTSTANDING_OR_ABANDONED_SQL =
  `(d.state IN ${OUTSTANDING_STATES_SQL} OR ${ABANDONED_PARK_SQL})`;
```

The composed string is **byte-identical** to what the file produces today — verified by construction
(`(d.state IN ('queued','delivered') OR (d.state = 'rejected' AND COALESCE(d.lastError, '') NOT IN ('run
closed','coordinator reclaimed') AND COALESCE(rr.state, '') NOT IN ('done','failed')))`, both before and
after). The extraction changes no SQL.

(c) Amend the docstring sentence the split falsifies. Replace `:344-346`, which today read:

```
 * exactly the outcome the ruling's own text calls out. Written entirely as
 * a `LEFT JOIN` in this one SQL definition: no writer touched, no park
 * restamped, every existing park-immutability guard in this file (`markDelivered`/
```

with:

```
 * exactly the outcome the ruling's own text calls out. Written entirely on the
 * READ, in SQL, and now in two composed definitions — `ABANDONED_PARK_SQL`
 * above is the abandonment half, and this constant is that half unioned with
 * `OUTSTANDING_STATES_SQL`. Neither is a writer: no park restamped, every
 * existing park-immutability guard in this file (`markDelivered`/
```

- [ ] **Step 4: Run it and watch it pass**

Run: `cd server && ./node_modules/.bin/vitest run test/single-definition.test.ts test/coord-store.test.ts`

Both must be green. `coord-store.test.ts` is the behavioural proof the composition is unchanged: the
deliberate-cancel clause is pinned by `it('D-1143 read side: the cancelled kickoff stops reading as mail
that needs attention')` at `:1711`, and the terminal-run clause by `it('clears an abandoned park by
DERIVATION once its own run reaches a terminal state — never by mutating the row (I2(a))')` at `:1054`.

- [ ] **Step 5: MUTATION CHECK** — four, each red for its own reason; revert after each:

  1. Delete `AND COALESCE(rr.state, '') NOT IN ('done','failed')` from `ABANDONED_PARK_SQL`.
     Run: `cd server && ./node_modules/.bin/vitest run test/coord-store.test.ts -t "clears an abandoned park by DERIVATION"`
     Expect **RED** at `expect(idsAfterClose).not.toContain(onWillClose)` (`:1083`) — the failed run's park
     is visible again. Right reason: that fixture reaches a terminal run through `planned -> failed`, which
     `advance` performs **without** `closeRun`'s park (the test says so at `:1075-1078`), so the run-state
     clause is the only thing hiding the row and is measured alone.
  2. Delete `AND COALESCE(d.lastError, '') NOT IN ${DELIBERATE_CANCEL_ERRORS_SQL}` from
     `ABANDONED_PARK_SQL`.
     Run: `cd server && ./node_modules/.bin/vitest run test/coord-store.test.ts -t "D-1143 read side"`
     Expect **RED** at `expect(s.outstandingMailFor(DEAD)).toEqual([])` (`:1730`) — the cancelled kickoff
     reappears. Right reason: that row's `mail.runId` **is NULL**, so the terminal-run clause structurally
     cannot cover it and this clause is measured alone.
  3. Respell the run-state clause inline in `OUTSTANDING_OR_ABANDONED_SQL` instead of naming the constant.
     Run: `cd server && ./node_modules/.bin/vitest run test/single-definition.test.ts -t "spells the abandonment predicate ONCE"`
     Expect **RED**: `the abandonment run-state clause is written more than once`.
  4. Restore `:344-345`'s old sentence (`Written entirely as a \`LEFT JOIN\` in this one SQL definition`).
     Run the same command as (3). Expect **RED**: `the predicate docstring still calls the composed
     predicate one SQL definition`. Right reason: two definitions exist and the assertion above it
     (`defs === 2`) proves it before this one fires.

- [ ] **Step 6: Commit**

```bash
git add server/src/coord/store.ts server/test/single-definition.test.ts && git commit -m "refactor(wave8): name the abandonment-park predicate once, before it gets a second reader"
```

---

### Task 61: The fifth arm — re-queue a parked role-addressed report to the heir, as a NEW delivery

**Files:**
- Modify: `server/src/coord/store.ts` — the import block (`:1-30`); the arms list (`:575-585`, insert after
  arm (d) at `:583-585` and before `:586`'s "…and, in the opposite direction"); the bound paragraph
  (`:601-608`); the join-kind sentence in the predicate docstring (`:336-338`); `setDeliveryEnvelope`'s
  docstring (`:2047-2063`); the `displaced.length > 0` block (`:657-660`); and a new private method
  immediately after `repointCoordinatorMail` (ends `:769`).
- Test: `server/test/coord-store.test.ts` — inside `describe('CoordStore.reclaimProgram — the mail follows
  the chair (D-1141/D-1142/D-1143)')` (`:1557-1797`), after the ARM (d) case that ends at `:1667`.
- Test: `server/test/single-definition.test.ts` — a NEW `describe` appended after the existing
  `describe('Build 7 nouns', …)` (ends `:503`).

**Interfaces:**
- Consumes: `ABANDONED_PARK_SQL` and `OUTSTANDING_STATES_SQL` (Task 60 / `store.ts:210`);
  `renderEnvelope` (`server/src/coord/envelope.ts:60`, `EnvelopeInput` at `:3-15`); `placeholders`
  (`store.ts:219`); `isMailKind` (already imported at `store.ts:11`).
- Produces: `private requeueAbandonedCoordinatorMail(program: string, to: string, displaced: readonly
  string[]): number` on `CoordStore` — returns how many new deliveries it queued. **Nothing on the wire
  changes**: `ReclaimOutcome` (`reclaim.ts:225-231`) and the 200 body (`routes.ts:1097-1099`) are untouched,
  so there is no `FLEET_PROTO` question to answer.

**Why:** `repointCoordinatorMail` (`store.ts:762-769`) begins `WHERE state IN ${OUTSTANDING_STATES_SQL}`
(`:764`) — arm (c) — so a role-addressed report that had already parked against the dead coordinator is not
moved, and `outstandingMailFor` (`store.ts:1904-1912`) is `WHERE d.toId = ?` (`:1909`), so the heir's box
never shows it. `reclaimProgram`'s own docstring states the bound at `:601-608`: "`MAIL_MAX_ATTEMPTS` is 6
on a 30 s doubling, so a never-delivered mail to a provably-dead coordinator parks itself `undeliverable`
about fifteen and a half minutes after it was queued … the report stays on the corpse, visible to
`outstandingMailFor(<corpse>)` and to nobody else." That falsifies the heir-facing promise the coordinator
skill ships: `ccd/coordinator-skill/references/resume.md:107-108` — "read outstanding mail before deciding
anything. A worker that finished while the coordinator was dead has its `wave-done` waiting there, and
acting off the ledger alone re-dispatches finished work." The origin
(`docs/superpowers/plans/2026-08-31-program-leverage-wave5-f5.md:6382-6388`, under the heading `### Two
things measured and deliberately NOT fixed` at `:6380`) reserved the shape as "a different decision on a
different door, and the coordinator's to make" — it carries **no D-N of its own**, so this task allocates
one and defines it in the same act.

**THE DESIGN RULING, MADE — and the cost of the other arm, stated.**

The origin left two shapes open. This task implements **(B) INSERT a new delivery row for the same
`mailId`**, and the reasoning is measured, not preferred:

- **(A) UN-PARK the existing row** — one `UPDATE`, three costs. (i) It would be *the tree's first writer
  returning a terminal row to a NON-TERMINAL state*. The broader sentence — "the first writer that reopens
  a terminal row" — is **false and must not be shipped**: `markAcked` (`store.ts:2283-2294`) already admits
  one park back through its door (`isAbandonedReplayPark` at `:2287-2288`, the replay-ceiling park, then
  `UPDATE … SET state = 'acked'`). (ii) It forces an unanswerable ruling on `deliveredAt`. `sweepMail`
  branches on it: the replay bump is `if (d.deliveredAt !== null) { const bumped = store.bumpReplayCount(d.id); … }`
  (`server/src/watch.ts:2739-2748`), and the session-dead rung parks only when
  `d.deliveredAt === null && attempts >= MAIL_MAX_ATTEMPTS` (`server/src/watch.ts:2629-2630`). Keep the
  corpse's `deliveredAt` and the heir's *first* receipt is counted as a replay, and the never-delivered
  budget structurally cannot apply to it; null it and the row denies a delivery that really happened. That
  is one value carrying two conditions a consumer handles differently — the seam rule this repo forbids.
  (iii) It falsifies prose in several places at once: arm (c) at `store.ts:580-582`, the bound at
  `:601-608`, and the shipped operator surface `ccd/coordinator-skill/references/mail-envelope.md:115-117`
  ("The park is terminal for that delivery, not for the conversation…"), which is on the agent-first lane.
- **(B) INSERT a new row** — costs a second `mail_deliveries` row per re-queued report and a second
  `renderEnvelope` call for one `mail` row, and buys everything (A) spends. Every terminality claim stays
  true; **arm (c)'s sentence stands verbatim and the existing ARM (c) test at `coord-store.test.ts:1634-1650`
  stays green unmodified** (it asserts only that the parked row is still `{ toId: DEAD, state: 'rejected' }`,
  which (B) never touches); the counters question is moot because a new row starts at
  `attempts = 0, replayCount = 0, nextAttemptAt = 0, deliveredAt = NULL` and every one of those is *true of
  it*; and the heir's envelope names the heir in `to:` and its own delivery id in `ack:`.
  - **Argue (B)'s legality from the SPEC line, never from `setDeliveryEnvelope`'s docstring.**
    `docs/superpowers/specs/2026-08-07-build7-fleet-coordination-design.md:176-177` reads "Until acked, the
    delivery replays — verbatim, never re-rendered — on later sweeps after cooldown." The rule binds **a
    delivery replaying**; a second delivery is not a replay of the first. `setDeliveryEnvelope`'s docstring
    (`store.ts:2047-2063`) says `renderEnvelope` "still runs exactly once, at queue time", which reads
    *against* (B) on its face and means once per queue ACT — do not cite it in support.
  - **(B) is not novel machinery.** The `queueDelivery(…, '') → renderEnvelope(delivery.id) →
    setDeliveryEnvelope` idiom already exists twice: `routes.ts:667-678` and `rundefs.ts:195-204`.
  - Structurally available, measured: `mail_deliveries` has **no** unique constraint on `(mailId, toId)` —
    the only index on it is `mail_deliveries_due ON mail_deliveries(state, nextAttemptAt)`
    (`schema.ts:186`). That permissiveness is also the hazard this task must close; see below.

**THIS IS THE TREE'S FIRST WRITER OF A SECOND DELIVERY FOR ONE MAIL, so it is the first statement that has
to reckon with a mail having more than one delivery row.** Measured: `grep -rn "queueDelivery(" server/src/`
returns exactly two call sites (`routes.ts:670`, `rundefs.ts:198`), each immediately after an `insertMail`
— so today one mail has exactly one delivery. Two consequences the naïve statement gets wrong, both
reachable through the multi-claimant state `reclaimProgram`'s own comment (`store.ts:648-656`) says is real
("a hand-recovered row, a `reconstruct` a human finished by hand"):

1. **Two displaced claimants, one mail, two parks** → two new deliveries of the same message to the heir.
   Closed by `GROUP BY m.id`.
2. **The heir already holds an outstanding delivery of that mail** — because `repointCoordinatorMail`, one
   line above, just handed them one — → a duplicate again. Closed by a `NOT EXISTS` clause on `to`.

**ORDERING, and it is MEASURABLE — but not for D-1143's reason.** The new statement runs **last**, after
`cancelKickoffsTo` and `repointCoordinatorMail`. Do **not** write D-1143's argument here
(`cancelKickoffsTo`'s docstring, `store.ts:701-711`, "narrowing statement first"); it is about a different
mechanism. What makes this position load-bearing is the `NOT EXISTS` clause: it reads `mail_deliveries` as
the two statements above left it, so a mail the repoint just moved to the heir is seen and skipped. Run
first, the repoint's row would still name the corpse, the guard would miss it, and the heir would get two
copies — which is exactly what the mutation in Step 5 measures.

**One mutant that CANNOT go red, stated rather than faked.** `cancelKickoffsTo` parks the kickoff with
`MAIL_RECLAIM_CANCELLED_ERROR` **and** on a row whose `m.runId IS NULL`. The fifth arm excludes such a row
twice over — by `DELIBERATE_CANCEL_ERRORS_SQL` inside `ABANDONED_PARK_SQL`, and by the INNER `JOIN runs`.
Deleting either exclusion alone leaves the kickoff still excluded by the other, so "the fifth arm swallows
the cancelled kickoff" has no single-clause mutant. That is why the two `ABANDONED_PARK_SQL` clauses are
measured **separately in Task 60, against the read side**, where a `runId IS NULL` kickoff and a
`planned -> failed` run each isolate one, and why M1 here mutates the constant reference as a whole.

**TWO SENTENCES IN THIS FILE GO FALSE WHEN THE NEW CALLER LANDS, and one is ALREADY false at HEAD.** Both
are repaired in this task, each with its own derived pin:
- `store.ts:336-338` — "`rr.state` (via the `LEFT JOIN runs rr ON rr.id = m.runId` **every caller of this
  fragment now carries**) is checked directly". The new method carries an INNER join. Measured on
  non-comment lines at HEAD: `LEFT JOIN runs rr` × 3, bare `JOIN runs rr` × 0.
- `store.ts:2047-2048` — "Overwrites a delivery's stored `envelope` — used by the **ingress route ONLY**".
  **Already false at HEAD**: `grep -rn "setDeliveryEnvelope" server/src/` shows call sites at
  `routes.ts:676` **and** `rundefs.ts:202`. This task adds a third and corrects the claim.

**LEDGER:** D-1425 — `reclaimProgram` moved only OUTSTANDING role-addressed mail (arm (c),
`OUTSTANDING_STATES_SQL` at `store.ts:764`), so a wave-done report that had already parked `undeliverable`
against the dead coordinator stayed readable at `outstandingMailFor(<corpse>)` and nowhere else, falsifying
the heir-facing promise `ccd/coordinator-skill/references/resume.md:107-108` ships; closed by a fifth arm
that queues the heir a NEW delivery for exactly the parks the corpse's own mailbox was showing — deduped by
`GROUP BY m.id` and by a `NOT EXISTS` on the heir's own outstanding rows, because this is the tree's first
writer of a second delivery for one mail (inherited scope: D-1141/D-1142/D-1143 and the "deliberately NOT
fixed" note at `docs/superpowers/plans/2026-08-31-program-leverage-wave5-f5.md:6382-6388`, which carries no
number of its own).

**LEDGER:** D-1426 — `setDeliveryEnvelope`'s docstring
(`server/src/coord/store.ts:2047-2048`) said it is "used by the ingress route ONLY" while
`server/src/coord/rundefs.ts:202`'s system-mail queue had been calling it too; corrected and pinned by a
test that derives the caller set from the tree rather than reading the sentence.

- [ ] **Step 1: Write the failing test**

(a) In `server/test/coord-store.test.ts`, **ADD** `MAIL_RECLAIM_CANCELLED_ERROR` and
`MAIL_REPLAY_CEILING_ERROR` to the existing `../src/coord/store.js` import (both are exported:
`store.ts:227` and `:255`), and add

> **Do NOT retype that import as a whole line.** By the time this task runs, Task 22 has already
> extended it to a TWO-LINE import carrying `MAIL_RUN_CLOSED_ERROR`, which Task 22's own test,
> Task 24's new `it` and Task 25's `:873` rewrite all use. Replacing it with a single-line
> `{ CoordStore, MAIL_RECLAIM_CANCELLED_ERROR, MAIL_REPLAY_CEILING_ERROR }` drops
> `MAIL_RUN_CLOSED_ERROR` and the file stops compiling. Locator, not a line number:
> `grep -n "from '../src/coord/store.js'" server/test/coord-store.test.ts`. If Task 22 has NOT
> landed, the import is still one line — add to it just the same.

`import { renderEnvelope } from '../src/coord/envelope.js';` beside it.

(b) Add, inside the `reclaimProgram` describe, after the ARM (d) case that ends at `:1667`:

```ts
  /** Abandonment parks a role-addressed report can wear, one per writer that
   *  actually writes one: `server/src/watch.ts:2533-2536` (registry-absent, and
   *  its second string for a purged-after-delivery row), `:2630` (session-dead,
   *  which writes a TEMPLATE — `recipient session is ${lc}` — of which this is
   *  one instantiation), `:2747` (the replay ceiling) and `:2832`/`:2840` (a
   *  send that never landed, `res.error`).
   *
   *  ONLY `MAIL_REPLAY_CEILING_ERROR` IS DRIFT-PROOF, and saying so is the
   *  point: it is imported from the store, the other four are literals typed
   *  from the writers named above. The list is BREADTH, not a contract — what
   *  the predicate actually keys on is a park NOT being one of the two
   *  deliberate cancels, so a sixth abandonment string would be re-queued by
   *  this arm whether or not it is listed here. */
  const ABANDONMENT_ERRORS = [
    'recipient not in registry',
    'recipient purged after this message was delivered, and never acked',
    'recipient session is stopped',
    MAIL_REPLAY_CEILING_ERROR,
    'enter-ignored',
  ] as const;

  /** A park wearing a REAL envelope, not the block's placeholder. M6 in the
   *  mutation table is "reuse the parked row's stored envelope", and against
   *  `queue()`'s placeholder string (`'envelope rendered once, at queue time'`,
   *  :1588) that mutant would red because the fixture never had a `to:` line at
   *  all — the right colour for the wrong reason. Rendered through
   *  `renderEnvelope`, the same function the ingress uses, so a reused envelope
   *  really does name the CORPSE and really does carry an `ack:` id `markAcked`
   *  refuses. */
  const parkRendered = (
    s: CoordStore, mailToId: string, runId: number, lastError: string,
  ): number => {
    const r = s.run(runId)!;
    const mail = s.insertMail({ fromId: WORKER, fromUuid: `u-${WORKER}`, toId: mailToId,
      runId, kind: 'status', subject: 'wave-done', body: 'the wave is done', artifacts: [] });
    const d = s.queueDelivery(mail.id, DEAD, '');
    s.setDeliveryEnvelope(d.id, renderEnvelope({
      id: d.id, fromId: WORKER, toId: DEAD, runId,
      program: r.program, wave: r.wave, waveOf: r.waveOf,
      kind: 'status', subject: 'wave-done', body: 'the wave is done', artifacts: [],
    }));
    s.rejectDelivery(d.id, 'undeliverable', lastError);
    return d.id;
  };

  /** The state `reclaimProgram`'s own comment (store.ts:648-656) says is real: a
   *  program whose rows disagree about the claimant — "a hand-recovered row, a
   *  `reconstruct` a human finished by hand" — so `displaced` has two members.
   *  Written by hand because it is the only way: `openRun` REFUSES a second
   *  claimant (see `CoordStore: runs` → 'refuses a second coordinator rather
   *  than arbitrating'), which is exactly why this is a fixture and not a
   *  scenario. */
  const splitClaim = (s: CoordStore, runId: number, other: string): void => {
    s.db.prepare('UPDATE runs SET claimedBy = ? WHERE id = ?').run(other, runId);
  };

  it('ARM (e): an ABANDONED role-addressed report reaches the heir as a NEW delivery', () => {
    const s = store();
    const ids = waves(s);
    const parked = ABANDONMENT_ERRORS.map((e) => parkRendered(s, 'coordinator', ids[3]!, e));

    // ANTI-VACUITY, in the direction the wedge was actually reported: every one
    // of these is visible on the CORPSE before the reclaim — that IS the leak —
    // and the heir's box is empty.
    expect(s.outstandingMailFor(DEAD).map((m) => m.deliveryId).sort((a, b) => a - b))
      .toEqual([...parked].sort((a, b) => a - b));
    expect(s.outstandingMailFor(LIVE)).toEqual([]);

    expect(s.reclaimProgram(ids[4]!, LIVE, 1_777_000_000_000)).toMatchObject({ ok: true });

    // The park is UNTOUCHED — this is a new delivery, not a reopen, and arm
    // (c)'s sentence stands exactly as it was written.
    parked.forEach((d, i) => {
      expect(del(s, d)).toMatchObject({
        toId: DEAD, state: 'rejected', rejectCode: 'undeliverable',
        lastError: ABANDONMENT_ERRORS[i]!,
      });
    });

    // …and the heir holds ONE queued delivery per parked mail, none of them the
    // parked row itself.
    const heir = s.outstandingMailFor(LIVE);
    expect(heir.map((m) => m.state)).toEqual(parked.map(() => 'queued'));
    expect(new Set(heir.map((m) => m.id)))
      .toEqual(new Set(parked.map((d) => s.delivery(d)!.mailId)));
    for (const m of heir) expect(parked).not.toContain(m.deliveryId);

    // The two lines a re-used envelope could never have carried: it names the
    // HEIR, and its `ack:` names its OWN delivery id (`mail.id` and
    // `mail_deliveries.id` are separate sequences — D-41). The parks above were
    // given REAL envelopes naming DEAD, so this measures the distinction rather
    // than the absence of a fixture.
    for (const m of heir) {
      const env = s.deliveryEnvelope(m.deliveryId)!.envelope;
      expect(env).toContain(`to: ${LIVE}`);
      expect(env).toContain(`ack: ccrc-api mail ack ${m.deliveryId} `);
    }
  });

  it('re-queues exactly the abandoned role mail this program owes the chair — nothing else', () => {
    const s = store();
    const ids = waves(s);
    const other = (openRun(s, { program: 'sibling', wave: 1, waveOf: 1, claimedBy: DEAD }) as
      { id: number }).id;

    // MOVES.
    const mine = parkRendered(s, 'coordinator', ids[3]!, 'recipient session is stopped');
    // STAYS (1): addressed to a literal session id — arm (b).
    const literal = parkRendered(s, DEAD, ids[3]!, 'recipient session is stopped');
    // STAYS (2): role-addressed with no run — arm (d), D-1142's fold, still shut.
    const noRun = park(s, queue(s, { toId: 'coordinator', runId: null }, DEAD),
      'recipient session is stopped');
    // STAYS (3): a sibling program's chair.
    const sibling = parkRendered(s, 'coordinator', other, 'recipient session is stopped');
    // STAYS (4): a third session this reclaim displaced nobody from.
    const bystander = park(s, queue(s, { toId: 'coordinator', runId: ids[3]! }, 'ccrc-pwa-uninvolved'),
      'recipient session is stopped');
    // STAYS (5): a DELIBERATE cancel. `cancelOutstandingDeliveries` is called
    //   from `closeRun`, which also advances the run — so in the field this park
    //   and a terminal run arrive TOGETHER and the two exclusion clauses double-
    //   cover the row. This calls the store's own public writer WITHOUT the
    //   advance (its docstring at store.ts:992-999 blesses the standalone call),
    //   so the row is excluded by the deliberate-cancel clause alone.
    const closedRunMail = queue(s, { toId: 'coordinator', runId: ids[0]! }, DEAD);
    s.cancelOutstandingDeliveries(ids[0]!);
    // STAYS (6): an ABANDONMENT park whose own run has since gone terminal.
    //   `planned -> failed` is a legal single transition (`RUN_TRANSITIONS`,
    //   shared/api.ts:3000) and a bare `advance` does not park anything, so this
    //   reaches a terminal run without `closeRun` — the terminal-run clause is
    //   the only thing excluding it. The same trick the I2(a) case uses.
    const failedRunMail = parkRendered(s, 'coordinator', ids[1]!, 'recipient session is stopped');
    expect(s.advance(ids[1]!, 'failed', 'operator')).toMatchObject({ ok: true });

    // THE PREMISE, established rather than assumed: the corpse's own mailbox
    // already answers which parks still need a human — and it is that set, minus
    // what the ADDRESSING rules keep in place, that the heir must inherit.
    expect(s.outstandingMailFor(DEAD).map((m) => m.deliveryId).sort((a, b) => a - b))
      .toEqual([mine, literal, noRun, sibling].sort((a, b) => a - b));

    expect(s.reclaimProgram(ids[4]!, LIVE, 1_777_000_000_000)).toMatchObject({ ok: true });

    const heir = s.outstandingMailFor(LIVE);
    expect(heir.map((m) => m.id)).toEqual([s.delivery(mine)!.mailId]);
    expect(heir[0]!.deliveryId).not.toBe(mine);
    for (const d of [mine, literal, noRun, sibling, bystander, closedRunMail, failedRunMail]) {
      expect(del(s, d).toId, `delivery ${d} was moved`).not.toBe(LIVE);
    }
    // Exactly one row addressed to the heir exists AT ALL — history read, not
    // the outstanding one — so no second delivery slipped in for a mail this arm
    // was supposed to leave alone.
    expect(s.mailForRecipient(LIVE).map((m) => m.deliveryId)).toEqual([heir[0]!.deliveryId]);
  });

  it('one mail parked against TWO displaced claimants reaches the heir once, not twice', () => {
    // THE HAZARD THIS TREE HAS NEVER HAD BEFORE. `mail_deliveries` has no unique
    // constraint on (mailId, toId) — the only index is `mail_deliveries_due`
    // (schema.ts:186) — and until this arm nothing ever wrote a second delivery
    // for one mail. Two claimants is the state reclaimProgram's own comment
    // (store.ts:648-656) says is reachable.
    const s = store();
    const ids = waves(s);
    const OTHER = 'ccrc-pwa-second-corpse';
    splitClaim(s, ids[0]!, OTHER);

    const mail = s.insertMail({ fromId: WORKER, fromUuid: `u-${WORKER}`, toId: 'coordinator',
      runId: ids[3]!, kind: 'status', subject: 'wave-done', body: 'the wave is done', artifacts: [] });
    const toDead = s.queueDelivery(mail.id, DEAD, 'envelope rendered once, at queue time').id;
    const toOther = s.queueDelivery(mail.id, OTHER, 'envelope rendered once, at queue time').id;
    s.rejectDelivery(toDead, 'undeliverable', 'recipient session is stopped');
    s.rejectDelivery(toOther, 'undeliverable', 'recipient session is stopped');

    // THE PREMISE: both parks are candidates before the reclaim — each is on a
    // displaced claimant's box and each reads as needing a human.
    expect(s.outstandingMailFor(DEAD).map((m) => m.deliveryId)).toEqual([toDead]);
    expect(s.outstandingMailFor(OTHER).map((m) => m.deliveryId)).toEqual([toOther]);

    const r = s.reclaimProgram(ids[4]!, LIVE, 1_777_000_000_000);
    expect(r).toMatchObject({ ok: true });

    // ONE new delivery, for ONE mail — the heir is not told the same thing twice.
    expect(s.mailForRecipient(LIVE).map((m) => m.id)).toEqual([mail.id]);
  });

  it('never re-queues a mail the heir can already read — which is why it runs after the repoint', () => {
    // ANTI-REGRESSION, and flagged as such rather than dressed up: this case is
    // GREEN before the fifth arm exists (nothing re-queues anything), so its
    // red-first proof is the mutation table, where dropping the NOT EXISTS
    // clause and moving the call above `repointCoordinatorMail` are each
    // measured RED. The tree's own doctrine for this shape is
    // wave5-f5.md:6375-6378.
    const s = store();
    const ids = waves(s);
    const OTHER = 'ccrc-pwa-second-corpse';
    splitClaim(s, ids[0]!, OTHER);

    const mail = s.insertMail({ fromId: WORKER, fromUuid: `u-${WORKER}`, toId: 'coordinator',
      runId: ids[3]!, kind: 'status', subject: 'wave-done', body: 'the wave is done', artifacts: [] });
    // One delivery still OUTSTANDING on one displaced claimant — arm (c) moves
    // this one — and one PARKED on the other, which is arm (e)'s candidate.
    const live = s.queueDelivery(mail.id, OTHER, 'envelope rendered once, at queue time').id;
    const dead = s.queueDelivery(mail.id, DEAD, 'envelope rendered once, at queue time').id;
    s.rejectDelivery(dead, 'undeliverable', 'recipient session is stopped');

    expect(s.reclaimProgram(ids[4]!, LIVE, 1_777_000_000_000)).toMatchObject({ ok: true });

    // The repoint moved the outstanding row; the park was left; and NO third row
    // was minted, because the heir can already read that message.
    expect(del(s, live).toId).toBe(LIVE);
    expect(del(s, dead)).toMatchObject({ toId: DEAD, state: 'rejected' });
    expect(s.mailForRecipient(LIVE).map((m) => m.deliveryId)).toEqual([live]);
  });

  it('the re-queue leaves the wave unread badge alone — unreadMail is keyed by the run session', () => {
    // THE READER THE NEW DOCSTRING NAMES, MEASURED. `unreadMailCount(runId,
    // sessionId)` is called from `hydrateRun` with `row.sessionId` — the run's
    // WORKER — never with `claimedBy`, so a delivery to the heir CHAIR must not
    // move it. A bare `toBe(0)` would be true for a reason that has nothing to
    // do with this arm (the counter short-circuits to 0 on a null sessionId), so
    // the premise is established first: give the wave its worker and one unread
    // message, and the badge reads 1.
    const s = store();
    const ids = waves(s);
    s.setSession(ids[3]!, WORKER);
    queue(s, { toId: WORKER, runId: ids[3]! }, WORKER);
    expect(s.run(ids[3]!)!.unreadMail).toBe(1);

    const parked = parkRendered(s, 'coordinator', ids[3]!, 'recipient session is stopped');
    expect(s.run(ids[3]!)!.unreadMail).toBe(1);

    expect(s.reclaimProgram(ids[4]!, LIVE, 1_777_000_000_000)).toMatchObject({ ok: true });

    // The heir really did get the report…
    expect(s.outstandingMailFor(LIVE).map((m) => m.id)).toEqual([s.delivery(parked)!.mailId]);
    // …and the wave's badge did not move.
    expect(s.run(ids[3]!)!.unreadMail).toBe(1);
  });

  it('the fifth arm is in the SAME transaction — a throw rolls back runs, mail AND the re-queue', () => {
    const s = store();
    const ids = waves(s);
    const parked = parkRendered(s, 'coordinator', ids[3]!, 'recipient session is stopped');
    const patched = s as unknown as { requeueAbandonedCoordinatorMail: () => void };
    patched.requeueAbandonedCoordinatorMail = () => { throw new Error('requeue failed'); };

    expect(() => s.reclaimProgram(ids[4]!, LIVE, 1_777_000_000_000)).toThrow('requeue failed');

    expect(ids.map((id) => s.run(id)!.claimedBy)).toEqual([DEAD, DEAD, DEAD, DEAD, DEAD]);
    expect(del(s, parked).toId).toBe(DEAD);
    expect(s.mailForRecipient(LIVE)).toEqual([]);
  });
```

The `park` helper the two `park(s, queue(s, …), …)` lines above use is small enough to declare beside the
others:

```ts
  const park = (s: CoordStore, id: number, lastError: string): number => {
    s.rejectDelivery(id, 'undeliverable', lastError);
    return id;
  };
```

(c) In `server/test/single-definition.test.ts`, append a NEW describe after the one that ends at `:503`:

```ts
// ── program-leverage wave 8 ────────────────────────────────────────────────
//
// A docstring that names its own callers is a SECOND COPY of a fact the code
// already states, and this file exists because two copies of one fact drift.
// Same corpus, same argument as the header above — "a comment is a request; a
// red suite is a mechanism" — one level up from a duplicated VALUE to a
// duplicated CLAIM. Both cases derive the fact from `server/src` and check the
// prose against it; neither reads itself, and `ROOTS` (:32-37) contains no test
// directory, so no needle here can match its own source line.
describe('store.ts docstrings that describe their own callers', () => {
  const STORE = path.join(ccrcRoot, 'server/src/coord/store.ts');
  /** Source with every comment LINE removed, so a sentence about a call is
   *  never counted as a call. */
  const codeOnly = (t: string): string =>
    t.split('\n').filter((l) => !/^\s*(\*|\/\/|\/\*)/.test(l)).join('\n');
  /** A docstring as a reader sees it: leading ` * ` gone, wrapping collapsed —
   *  `coordinator-skill.test.ts`'s `flat()` lesson, applied to a JSDoc block.
   *  Without it, "the ingress route\n   * ONLY" walks past every `toContain`. */
  const prose = (t: string): string =>
    t.split('\n').map((l) => l.replace(/^\s*\*\s?/, '')).join(' ').replace(/\s+/g, ' ');

  it('the predicate docstring names the join kinds its callers actually carry', () => {
    const store = readFileSync(STORE, 'utf8');
    const code = codeOnly(store);
    const left = (code.match(/LEFT JOIN runs rr\b/g) ?? []).length;
    const inner = (code.match(/(?<!LEFT )JOIN runs rr\b/g) ?? []).length;
    // BOTH premises, established before the claim is judged. Without the second
    // one this assertion would be demanding a word about a caller that does not
    // exist.
    expect(left, 'no LEFT-JOIN caller of the mail→run edge — nothing to contrast').toBeGreaterThan(0);
    expect(inner, 'no INNER-JOIN caller of the mail→run edge — the sentence under test is not yet false')
      .toBeGreaterThan(0);

    const doc = store.slice(
      store.indexOf(' * The READ-side "still needs a human'),
      store.indexOf('const OUTSTANDING_OR_ABANDONED_SQL'));
    expect(doc.length, 'the predicate docstring anchors moved').toBeGreaterThan(300);
    expect(prose(doc),
      'the predicate docstring names one join kind while its callers carry two').toContain('INNER');
  });

  it('setDeliveryEnvelope names every caller it has, derived from the tree', () => {
    const store = readFileSync(STORE, 'utf8');
    const doc = store.slice(
      store.indexOf('   * Overwrites a delivery'), store.indexOf('  setDeliveryEnvelope('));
    expect(doc.length, "setDeliveryEnvelope's docstring anchors moved").toBeGreaterThan(300);

    // The claim that was false for two builds. Split at the call site so this
    // needle can never match a scan of this file (`ALL` does not reach
    // `server/test`, but the idiom is cheap and the next scanner may).
    expect(prose(doc), 'the docstring still says the ingress route is its only caller')
      .not.toContain('used by the ingress ' + 'route ONLY');

    const outside = ALL.filter((f) =>
      rel(f).startsWith('server/src/') && rel(f) !== 'server/src/coord/store.ts'
      && /\.setDeliveryEnvelope\(/.test(codeOnly(readFileSync(f, 'utf8'))));
    expect(outside.length, 'the scan found no caller outside store.ts — nothing to check the prose against')
      .toBeGreaterThanOrEqual(2);
    for (const f of outside) {
      expect(prose(doc), `the docstring does not name ${rel(f)}`).toContain(path.basename(rel(f)));
    }

    expect(/\bthis\.setDeliveryEnvelope\(/.test(codeOnly(store)),
      'no in-file caller of setDeliveryEnvelope — this half has nothing to check').toBe(true);
    expect(prose(doc), 'the docstring does not name the in-file caller')
      .toContain('requeueAbandonedCoordinatorMail');
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `cd server && ./node_modules/.bin/vitest run test/coord-store.test.ts -t "an ABANDONED role-addressed report"`

Expected: **1 failed** — `expect(heir.map((m) => m.state)).toEqual(parked.map(() => 'queued'))` gets `[]`
against `['queued','queued','queued','queued','queued']`, because nothing re-queues anything yet.

Run: `cd server && ./node_modules/.bin/vitest run test/coord-store.test.ts -t "AND the re-queue"`

Expected: **1 failed** with `expected function to throw an error, but it didn't throw anything`, on the
`toThrow('requeue failed')` line. **There is no `TypeError`** — `patched.requeueAbandonedCoordinatorMail =
…` is an ordinary own-property assignment that succeeds whether or not the method exists; pre-implementation
`reclaimProgram` simply never calls it, the reclaim succeeds, and nothing throws.

Run: `cd server && ./node_modules/.bin/vitest run test/single-definition.test.ts -t "join kinds"`

Expected: **1 failed** with `no INNER-JOIN caller of the mail→run edge — the sentence under test is not yet
false`. (The docstring assertion is not reached; the premise fails first, which is the point.)

Run: `cd server && ./node_modules/.bin/vitest run test/single-definition.test.ts -t "names every caller"`

Expected: **1 failed** with `the docstring still says the ingress route is its only caller`.

- [ ] **Step 3: Implement**

(a) Add the import to `server/src/coord/store.ts`, beside `import { tx } from './db.js';` at `:2`:

```ts
import { renderEnvelope } from './envelope.js';
```

`envelope.ts` imports only `shared/api.js` (`envelope.ts:1`) and nothing imports `store.ts` from it, so
there is no cycle and no ring violation: an L3 adapter reaching a pure renderer. `rundefs.ts` already
imports it for the same reason.

(b) In the arms list, after arm (d) (`store.ts:583-585`) and before `:586`'s "…and, in the opposite
direction", add:

```ts
   *   (e) role-addressed, naming a run of THIS program, ABANDONED against a
   *       displaced claimant — a park this lane GAVE UP on, never a deliberate
   *       cancel, on a run that is not itself terminal -> the heir is queued a
   *       NEW delivery for the same `mail` row. Arm (c) stands exactly as
   *       written and is not weakened by this: the parked row is not moved and
   *       not reopened. What the heir gets is a SECOND delivery of one mail,
   *       which is what two delivery attempts to two recipients have always
   *       looked like in this schema — `mail` and `mail_deliveries` are separate
   *       tables for exactly that reason. The set is not hand-written here
   *       either: it is `ABANDONED_PARK_SQL`, the same predicate
   *       `outstandingMailFor(<corpse>)` uses to decide a park still needs a
   *       human, so "what the heir inherits" and "what the corpse's box was
   *       showing" cannot drift apart. (D-1425,
   *       `requeueAbandonedCoordinatorMail` below.)
```

(c) Replace the last sentence of the bound paragraph — `store.ts:606-608`, "…Reopening a parked row is a
different decision, on a different door, and this one does not make it." — with:

```ts
   * visible to `outstandingMailFor(<corpse>)` and to nobody else — and that is
   * now arm (e)'s half of the job rather than a hole:
   * `requeueAbandonedCoordinatorMail` queues the heir a NEW delivery for exactly
   * the parks that mailbox was showing. Reopening the parked row is still a
   * decision this store does not make. The row stays `rejected`, and the reason
   * it parked stays readable on it.
```

(d) Amend the join-kind sentence. `store.ts:336-338` today reads:

```
 * chase this (another mutation, another race with the same close-time park
 * this file's other comments spend so many words guarding against), the
 * READ derives it: `rr.state` (via the `LEFT JOIN runs rr ON rr.id =
 * m.runId` every caller of this fragment now carries) is checked directly,
```

Replace the parenthetical so it states what the callers actually carry:

```
 * chase this (another mutation, another race with the same close-time park
 * this file's other comments spend so many words guarding against), the
 * READ derives it: `rr.state` (via the `runs rr ON rr.id = m.runId` join each
 * caller of this fragment brings — LEFT in the read paths, INNER in
 * `requeueAbandonedCoordinatorMail`, and `COALESCE` below is what makes the
 * predicate indifferent to which) is checked directly,
```

Do **not** write the token `LEFT JOIN runs rr` or a bare `JOIN runs rr` into any comment: the pin counts
those sequences on non-comment lines only, and a comment that contains one would still read oddly beside a
scan that ignores it.

(e) Amend `setDeliveryEnvelope`'s docstring opening (`store.ts:2047-2049`). It reads
"Overwrites a delivery's stored `envelope` — used by the ingress route ONLY, once, immediately after
`queueDelivery`, to close a bug fix-round finding 5 / D-41 named:". Replace that opening with:

```ts
  /**
   * Overwrites a delivery's stored `envelope`, once, immediately after
   * `queueDelivery`. THREE callers, each doing exactly that and none of them a
   * re-render: the ingress route in `routes.ts`, the system-mail queue in
   * `rundefs.ts` (which has called it since Build 7 — this sentence said "the
   * ingress route ONLY" for two builds while it did:
   * D-1426) and `requeueAbandonedCoordinatorMail`
   * in this file, which renders
   * the heir's own envelope for a second delivery of one mail. Pinned by
   * `single-definition.test.ts`'s "setDeliveryEnvelope names every caller it
   * has", which derives the caller set from `server/src` rather than reading
   * this sentence. It exists to close a bug fix-round finding 5 / D-41 named:
```

Leave the rest of that docstring — the `mail.id`/`mail_deliveries.id` argument and the "renders exactly
once, at queue time" sentence — exactly as it is. Both stay true: each caller renders once per queue ACT.

(f) In `reclaimProgram`'s `displaced.length > 0` block (`store.ts:657-660`), append the third call:

```ts
      if (displaced.length > 0) {
        this.cancelKickoffsTo(displaced);
        this.repointCoordinatorMail(run.program, to, displaced);
        // LAST, and the position is LOAD-BEARING — but not for `cancelKickoffsTo`'s
        // reason above, which is about a narrowing statement running before a
        // widening one and does not apply here. This statement's `NOT EXISTS`
        // clause reads `mail_deliveries` as the two above left it, so a mail the
        // repoint just moved to `to` is SEEN and skipped. Run first, that row
        // would still name the corpse, the guard would miss it, and the heir
        // would be handed two copies of one report.
        this.requeueAbandonedCoordinatorMail(run.program, to, displaced);
      }
```

(g) Add the method immediately after `repointCoordinatorMail` (ends `store.ts:769`):

```ts
  /**
   * D-1425 — the arm (a) could not reach. A role-addressed report the
   * lane had ALREADY GIVEN UP on is delivered to the heir as a NEW row.
   *
   * WHY A SECOND DELIVERY AND NOT AN UN-PARK. Un-parking is one statement and
   * three problems. It would be the first writer in this tree to return a
   * terminal row to a NON-TERMINAL state — not the first to reopen a terminal
   * row, which `markAcked` below already does for one park, and the broader
   * sentence would itself be a false claim. It would force a ruling on
   * `deliveredAt` that has no true answer: `sweepMail` branches on it (the
   * replay bump and the session-dead rung both read it), so keeping the corpse's
   * value counts the HEIR's first receipt as a replay, and nulling it denies a
   * delivery that happened — one column carrying two conditions a consumer
   * handles differently. And it would falsify arm (c) here, the bound paragraph
   * above, and `ccd/coordinator-skill/references/mail-envelope.md`'s "the park
   * is terminal for that delivery". A new row makes every one of those sentences
   * stay true, and its zeroed counters are TRUE OF IT rather than reset.
   *
   * NOT A RE-RENDER OF A REPLAY. spec:176-177 is "Until acked, the delivery
   * replays — verbatim, never re-rendered". That binds a DELIVERY replaying;
   * this is a second delivery, so it renders its own envelope, naming the heir
   * in `to:` and its own id in `ack:` — the `queueDelivery(…, '') ->
   * renderEnvelope(delivery.id) -> setDeliveryEnvelope` pair `routes.ts` and
   * `rundefs.ts` already use, for the same reason (the delivery id does not
   * exist until the row does).
   *
   * THE PREDICATE IS NOT HAND-WRITTEN. `ABANDONED_PARK_SQL` is the mailbox's own
   * "this park still needs a human" clause, so the deliberate-cancel parks (a
   * run closing, a chair changing hands) and the parks whose own run has since
   * finished are excluded BY THE CONSTANT rather than by three more words here.
   * The rest are the repoint's clauses, unchanged in meaning: `d.toId IN
   * (<displaced>)` (never `to`, never a bystander), `m.toId = 'coordinator'`
   * (arm (b)), the INNER join to `runs` (arm (d) — every `m.runId IS NULL` row
   * drops out on the way), and `rr.program = ?`.
   *
   * TWO CLAUSES ARE THIS METHOD'S OWN, and they exist because this is the FIRST
   * writer in the tree to give one `mail` row a second delivery. Nothing else
   * ever did — `queueDelivery` has exactly two other call sites and each follows
   * an `insertMail` — and `mail_deliveries` carries no unique key on
   * `(mailId, toId)` to fall back on (`schema.ts`: the one index is
   * `mail_deliveries_due`). So:
   *   `GROUP BY m.id` — a program whose rows disagree about the claimant (the
   *     hand-recovered row the caller's own comment describes) puts TWO
   *     displaced ids in `displaced`, and one mail parked against both would
   *     otherwise be queued to the heir twice. SQLite's bare-column rule makes
   *     the selected `m.*`/`rr.*` values well defined here: `m.id` is the
   *     grouping key and `rr` joins it one-to-one on `m.runId`.
   *   `NOT EXISTS (… x.toId = ? AND x.state IN OUTSTANDING_STATES_SQL)` — the
   *     heir may ALREADY be able to read this message, most often because
   *     `repointCoordinatorMail` handed it to them one statement ago. This is
   *     why this call is last: run before the repoint, the guard would look at a
   *     row still naming the corpse and mint a duplicate.
   *
   * THE READERS OF THE PREDICATE WERE WALKED, as `OUTSTANDING_OR_ABANDONED_SQL`'s
   * own docstring does for D-1143. All four:
   *   `outstandingMailFor(<heir>)` — the point. Reached from `GET /api/mail?to=`
   *     and from `sessionws.ts`'s `checkMail`, so the heir's live socket shows
   *     it with no wire change.
   *   `unreadMailCount(runId, sessionId)` — NOT reached, and not by luck:
   *     `hydrateRun` calls it with `row.sessionId`, the run's WORKER, never with
   *     `claimedBy`. A delivery to the heir CHAIR therefore leaves
   *     `RunSummary.unreadMail` — the badge the MailStrip renders — exactly
   *     where it was. Measured by "the re-queue leaves the wave unread badge
   *     alone" in `coord-store.test.ts`.
   *   the coordinator-kickoff-wedge query in `healthFor` — unreachable: it is
   *     `m.runId IS NULL`-scoped, and every row this method inserts belongs to a
   *     mail that survived an INNER join on `m.runId`.
   *   the composed constant's own definition — no reader of its own.
   * And on the narrower `OUTSTANDING_STATES_SQL` side: `dueDeliveries` picks the
   * new row up, which is the whole point; `hasOutstandingMail`'s slot is keyed by
   * SENDER, and `queueSystemMail`'s sender type is `SystemMailSender` =
   * coordinator|operator with no call site addressing the ROLE, so no system
   * mail is in this candidate set and none can be swallowed;
   * `hasOutstandingPeerDuplicate` and `outstandingPeerCount` are
   * `m.runId IS NULL`-scoped and therefore unreachable too.
   *
   * BOUNDED by the role-addressed reports of ONE program that parked while its
   * coordinator was dead, at most one new row per `mail` row, and deliberately
   * NOT capped beyond that: a cap here would drop mail silently, which is the
   * failure this method exists to end.
   */
  // THIS SIGNATURE IS MULTI-LINE, AND THAT IS A DECLARED EXEMPTION, NOT AN
  // OVERSIGHT. Task 24 requires delivery-row WRITERS to keep their signature on
  // one line, because Task 26's writer census walks back from each prepared
  // statement to the nearest single-line signature and a wrapped one silently
  // mis-attributes. This method is not such a writer: it prepares a SELECT and
  // reaches the delivery rows only through `queueDelivery` and
  // `setDeliveryEnvelope`, each of which carries its own one-line signature and
  // is named by the census in its own right. The exemption is stated rather
  // than relied on: Step 4 re-runs `mail-hardening.test.ts` — Task 26's census,
  // which landed earlier in this wave — AFTER this method exists, so if the walk
  // ever does reach back past this signature, it reds here rather than in the
  // field.
  private requeueAbandonedCoordinatorMail(
    program: string, to: string, displaced: readonly string[],
  ): number {
    const rows = this.db.prepare(
      'SELECT m.id AS mailId, m.fromId AS fromId, m.kind AS kind, m.subject AS subject, ' +
      'm.body AS body, m.artifacts AS artifacts, m.runId AS runId, ' +
      'rr.program AS program, rr.wave AS wave, rr.waveOf AS waveOf ' +
      'FROM mail_deliveries d JOIN mail m ON m.id = d.mailId ' +
      'JOIN runs rr ON rr.id = m.runId ' +
      `WHERE ${ABANDONED_PARK_SQL} AND d.toId IN (${placeholders(displaced.length)}) ` +
      "AND m.toId = 'coordinator' AND rr.program = ? " +
      'AND NOT EXISTS (SELECT 1 FROM mail_deliveries x ' +
      `WHERE x.mailId = m.id AND x.toId = ? AND x.state IN ${OUTSTANDING_STATES_SQL}) ` +
      'GROUP BY m.id ORDER BY MIN(d.id)',
    ).all(...displaced, program, to) as {
      mailId: number; fromId: string; kind: string; subject: string; body: string;
      artifacts: string; runId: number; program: string; wave: number; waveOf: number | null;
    }[];
    for (const r of rows) {
      const delivery = this.queueDelivery(r.mailId, to, '');
      // THE RESULT IS READ, NOT DROPPED. Task 24 gave `setDeliveryEnvelope` a
      // `SetEnvelopeResult` precisely because "a writer whose safety rests on its
      // two callers' shape breaks silently the day a third one appears" — this IS
      // that third caller, and TypeScript does not complain about a discarded
      // return, so dropping it here would re-mint the defect one task after it was
      // fixed. Same handling as the other two: unstampable is a bug, not a state.
      const stamped = this.setDeliveryEnvelope(delivery.id, renderEnvelope({
        id: delivery.id, fromId: r.fromId, toId: to, runId: r.runId,
        program: r.program, wave: r.wave, waveOf: r.waveOf,
        // Narrowed the way `hydrateMail` narrows it, not cast: `kind` is a
        // CLOSED union and `'unknown'` is a real member. The branch is dead in
        // practice (`insertMail`'s parameter is already `MailKind`), and a cast
        // would have been this method quietly asserting what it did not check.
        kind: isMailKind(r.kind) ? r.kind : 'unknown',
        subject: r.subject, body: r.body,
        artifacts: JSON.parse(r.artifacts) as string[],
      }));
      if (!stamped.ok) {
        throw new Error(`delivery ${delivery.id} unstampable: ${stamped.why}`);
      }
    }
    return rows.length;
  }
```

> **Task 24 dependency, stated because TypeScript will not state it.** `stamped` and the throw above
> exist only once Task 24 has landed; before that `setDeliveryEnvelope` returns `void` and this reads
> `this.setDeliveryEnvelope(...)` with no binding. Task 24 runs first (24 < 61), so write it as shown.
> If it somehow has not, land Task 24 before this one rather than dropping the check — a discarded
> return is not a compile error, so nothing would tell you.

- [ ] **Step 4: Run it and watch it pass**

Run, in the foreground, timeout ≥ 600000 ms:

```bash
cd server && ./node_modules/.bin/vitest run test/coord-store.test.ts test/single-definition.test.ts \
  test/reclaim-route.test.ts test/coord-reclaim.test.ts test/mail-sweep.test.ts test/typecheck-tests.test.ts \
  test/mail-hardening.test.ts
```

All green. In particular the pre-existing ARM (c) case at `coord-store.test.ts:1634` must still pass
**unmodified** — that it does is the load-bearing evidence that (B) weakens no arm. (`typecheck-tests` is a
known load flake; re-run it in isolation before calling it a real break.)

- [ ] **Step 5: MUTATION CHECK** — nine bullets carrying eight M-numbers (M7 is split into M7a/M7b, which are two mutations of one clause), each measured before/after and reverted:

  - **M1** replace `${ABANDONED_PARK_SQL}` with `d.state = 'rejected'`.
    `-t "nothing else"` → **RED**: `closedRunMail` and `failedRunMail` both reach the heir, so
    `expect(heir.map((m) => m.id)).toEqual([…])` fails with three members. Right reason: the arm re-queued
    parks the corpse's own mailbox does not show. (See the "one mutant that cannot go red" note in **Why**
    for why the constant's two clauses are measured separately in Task 60 rather than here.)
  - **M2** delete `AND m.toId = 'coordinator'`.
    `-t "nothing else"` → **RED** at `expect(heir.map((m) => m.id)).toEqual([…])`, which gains `literal`'s
    mail id. Right reason: arm (b) violated — mail sent to a session, not to a chair, followed the chair.
  - **M3** change `JOIN runs rr` to `LEFT JOIN runs rr` and `rr.program = ?` to
    `(rr.program = ? OR m.runId IS NULL)`.
    `-t "nothing else"` → **RED**, `noRun`'s mail id appears on the heir. Right reason: D-1142's fold opened.
  - **M4** drop `AND rr.program = ?`.
    `-t "nothing else"` → **RED**, `sibling`'s mail id appears. Right reason: a second program's chair was
    rewritten by a door that hands over one.
  - **M5** drop `AND d.toId IN (…)`.
    `-t "nothing else"` → **RED**, `bystander`'s mail id appears. Right reason: a session this reclaim
    displaced nobody from lost its mail.
  - **M6** replace the `renderEnvelope(...)` argument with the parked row's stored envelope (add
    `d.envelope AS envelope` to the SELECT and pass `r.envelope` to `setDeliveryEnvelope`).
    `-t "an ABANDONED role-addressed report"` → **RED** at ``expect(env).toContain(`to: ${LIVE}`)``. Right
    reason, and this is why `parkRendered` exists: the parked rows carry a REAL `renderEnvelope` output
    naming DEAD, so the failure is "the heir was handed the corpse's envelope", not "the fixture had no
    envelope". The reused envelope's `ack:` line also names a delivery id `markAcked` refuses (that row is
    `rejected` and is not the replay-ceiling park), i.e. mail the heir cannot acknowledge.
  - **M7a** drop `GROUP BY m.id ORDER BY MIN(d.id)`.
    `-t "TWO displaced claimants"` → **RED**: `expect(s.mailForRecipient(LIVE).map((m) => m.id)).toEqual([mail.id])`
    receives that id twice. Right reason: one report, two nudges.
  - **M7b** drop the `AND NOT EXISTS (…)` clause — *or*, separately, move
    `this.requeueAbandonedCoordinatorMail(...)` above `this.repointCoordinatorMail(...)` and leave the
    clause in place.
    `-t "already read"` → **RED** in both cases: `expect(s.mailForRecipient(LIVE).map((m) => m.deliveryId)).toEqual([live])`
    receives two ids. Right reasons, and they are different ones — the first is a missing guard, the second
    is a guard that ran before the statement whose effect it has to see.
  - **M8** in `hydrateRun` (`store.ts:1387`), change `this.unreadMailCount(row.id, row.sessionId)` to
    `this.unreadMailCount(row.id, row.claimedBy)`.
    `-t "unread badge"` → **RED** at the first `expect(s.run(ids[3]!)!.unreadMail).toBe(1)` (`expected 0 to
    be 1`). Right reason: the badge stopped counting what is addressed to the run's own session, which is
    the exact property the new docstring's reader-walk asserts.

- [ ] **Step 6: Commit**

```bash
git add server/src/coord/store.ts server/test/coord-store.test.ts server/test/single-definition.test.ts && git commit -m "fix(wave8): re-queue an abandoned role-addressed report to the heir on reclaim, deduped (D-1425, D-1426)"
```

---

### Task 62: Tell the heir, in the file it actually reads — AGENT-FIRST

**Files:**
- Modify: `ccd/coordinator-skill/references/mail-envelope.md` — insert after list item 4, which begins
  `4. **If the delivery has already parked**,` (`:114`) and ends `said is lost.` (`:117`), and before the
  blank line preceding `You do not have to poll for any of this.` (`:119`).
- Test: `server/test/coordinator-skill.test.ts` — a new `it` in the describe whose helper is
  `const envelope = (): string => refs('mail-envelope.md');` (`:564`), inserted after the stranded-`/clear`
  case that ends at `:598` and before the `// NO CENSUS ASSERTION HERE` comment at `:600`.

**Interfaces:**
- Consumes: `requeueAbandonedCoordinatorMail` (Task 61) — behaviour only, no symbol
- Produces: none

**Why:** After Task 61, item 4 of that list is *incomplete* rather than wrong: the sentence stays true (the
park IS terminal; nothing reopens it) but the heir is not told that a handover has already put those reports
in its box. `ccd/coordinator-skill/references/resume.md:107-108`'s promise — "read outstanding mail before
deciding anything" — becomes true again only if the heir knows to believe it. Measured 2026-09-02:
`grep -rn "park is terminal" . | grep -v node_modules | grep -v graphify-out` → three hits, at
`ccd/coordinator-skill/references/mail-envelope.md:115`, `server/src/coord/store.ts:2369` and
`docs/superpowers/plans/2026-08-15-fleet-robustness-build8.md:13142`. The plan copy is **off-limits** —
`box-token-census.test.ts:41-47` states the corpus rule that archived plan generations are history and
correcting them falsifies the ledger. The skill reference is the one in scope, and it is the file a revived
coordinator reads.

**THE ONE THING THIS PARAGRAPH MAY NOT SAY, and it is a hard block, not a preference.**
`server/test/coordinator-skill.test.ts:1159-1166` is
`it('never names the reclaim door — the release valve for a wedge the coordinator IS', () => { expect(allSkillText).not.toContain('/api/runs/:id/reclaim'); })`
— **corpus-wide**. `allSkillText` (`:53`) is `SKILL.md` plus **every** reference file;
`ROUTE_CORPUS_EXCLUDES` (`:73`) removes `mail-envelope.md` from `routeSkillText` **only**, and the comment
at `:60-62` says so in as many words ("It stays in `allSkillText`"). That prohibition is D-1123's deliberate
accounting: the EXEMPT entry only PERMITS the omission; `:1165` is what FORBIDS the mention. Two sibling
prohibitions apply as well — `:1018` `not.toContain('/api/coord/caps')` and `:1026`
`not.toContain('/api/claims/:id/break')`. **So the paragraph below names the handover in prose and spells no
route for it, and the test anchors on a paren-free phrase the paragraph owns rather than on a route string.
Do NOT amend, weaken or delete `:1159-1166`.** `GET /api/mail?to=<your id>` is safe and is used: it is in
`EXEMPT` (`server/src/auth/gate.ts:202`), which is what `auth-passkey.test.ts:2284`'s THE SWEEP requires of
every `METHOD /api/path` either skill corpus names, and the same spelling already appears in this file at
`:4` and `:41`.

- [ ] **Step 1: Write the failing test**

```ts
  // A handover now puts the corpse's unacked ROLE mail in the heir's box as a
  // new delivery. Unsaid, the heir reads item 4 above, concludes the reports are
  // gone, and re-dispatches finished work — exactly the harm `resume.md`'s "read
  // outstanding mail before deciding anything" exists to prevent.
  //
  // ANCHORED ON A PHRASE THE PARAGRAPH OWNS, NOT ON THE ROUTE, and that is not a
  // style choice: `:1165` above forbids `/api/runs/:id/reclaim` in this corpus,
  // so a paragraph anchored on the route string could not exist. The phrase is
  // paren-free so it is also safe as a `-t` pattern, and `find` returning
  // `undefined` is what makes a deleted passage red instead of silently passing.
  it('tells the heir a handover re-queues the reports the dead coordinator never acked', () => {
    const para = envelope().split('\n\n')
      .find((p) => p.includes('hands the program to a new coordinator'));
    expect(para,
      'no paragraph in mail-envelope.md says what a handover does to a parked report').toBeDefined();
    expect(para, 'the passage does not say the heir gets a NEW delivery').toMatch(/new delivery/i);
    // The distinction that must survive any rewrite: a NEW delivery, not the old
    // park reopened — item 4's own "the park is terminal" is still true and this
    // paragraph must not read as a retraction of it. One exact phrase, not a
    // disjunction with alternatives no prose here can satisfy.
    expect(para, 'the passage does not say the old park is left unreopened')
      .toContain('is not reopened');
  });
```

- [ ] **Step 2: Run it and watch it fail**

Run: `cd server && ./node_modules/.bin/vitest run test/coordinator-skill.test.ts -t "never acked"`

Expected: **1 failed** with `no paragraph in mail-envelope.md says what a handover does to a parked report`
— `find` returns `undefined`, because that phrase appears nowhere in the file today.

- [ ] **Step 3: Implement**

In `ccd/coordinator-skill/references/mail-envelope.md`, after the line `   said is lost.` (the end of item
4) and before the existing blank line that precedes `You do not have to poll for any of this.`, insert a
blank line and then this indented continuation of item 4:

```markdown

   You do not have to do that for a report addressed to the CHAIR after the
   operator hands the program to a new coordinator. That handover queues the new
   coordinator a new delivery — a fresh row, with its own `ack:` id — for every
   role-addressed report the lane had already given up on, so
   `GET /api/mail?to=<your id>` is the whole recovery, and `resume.md`'s "read
   outstanding mail before deciding anything" holds even for a chair that changed
   hands an hour after the report was sent. The old park is not reopened: it
   stays exactly as it is, a true record that the delivery to that session was
   abandoned. Nothing is re-queued for a delivery the run's own close cancelled,
   for a run that has since finished, for mail addressed to a session by name
   rather than to the chair, or for a report the new coordinator can already
   read. The door itself is the operator's, and this corpus does not name it.
```

- [ ] **Step 4: Run it and watch it pass**

Run: `cd server && ./node_modules/.bin/vitest run test/coordinator-skill.test.ts test/auth-passkey.test.ts`

Whole files, not `-t`: the new paragraph enters `allSkillText`, which the destructive-verb census (`:128`),
the refusal-vocabulary scans (`:334-354`) and the three corpus-wide route prohibitions (`:1018`, `:1026`,
`:1165`) all read; and `auth-passkey.test.ts:2284`'s THE SWEEP walks every `.md` under both skill dirs,
`mail-envelope.md` included. `ROUTE_CORPUS_EXCLUDES` (`:73`) keeps this file out of the route-parity harvest
only — verified at HEAD, and it is precisely the reason the prohibition at `:1165` still applies.

- [ ] **Step 5: MUTATION CHECK** — two; revert after each:
  1. Delete the whole sentence `The old park is not reopened: it stays exactly as it is, a true record that
     the delivery to that session was abandoned.` — from `The old park` through `abandoned.` inclusive,
     keeping every other sentence. Expect **RED**: `the passage does not say the old park is left
     unreopened`. Right reason: without it the paragraph reads as a retraction of item 4's "the park is
     terminal for that delivery", and two sentences with opposite meanings standing side by side is exactly
     the false-prose class this wave exists to close.
  2. Replace `hands the program to a new coordinator` with `POST /api/runs/:id/reclaim` — the phrasing a
     future author will reach for. Expect **RED twice**: this task's own case (`find` → `undefined`) **and**
     `coordinator-skill.test.ts` `-t "never names the reclaim door"`. Right reason, and the point of running
     it: it shows the executor that the route string is forbidden by a standing prohibition, so the fix is
     to restore the prose phrase, never to touch `:1165`.

- [ ] **Step 6: Commit**

```bash
git add ccd/coordinator-skill/references/mail-envelope.md server/test/coordinator-skill.test.ts && git commit -m "docs(wave8): tell the heir a handover re-queues the parked role mail, and that the park is still terminal"
```

---

### Task 63: `ccd/ccrc-api`'s ungated census says two; there are four — and make it a mechanism (D-1168)

**Files:**
- Modify: `ccd/ccrc-api` — the comment block that begins `# WHAT IS DELIBERATELY ABSENT.` and ends at the
  bare `#` line before `# SELF-CONTAINED.`. **Anchor by that text, not by line number.** (Provenance: at
  HEAD that block is lines 32–38, the bare `#` is line 39 and `# SELF-CONTAINED.` is line 40. Task 64 edits
  this file too; if it has already landed, these numbers have not moved, but do not rely on them.)
- Modify: `server/test/box-token-census.test.ts:22-28` **and** `:45-47` — **both** carry the now-false
  claim; correcting one and leaving the other re-mints this task's own defect.
- Test: `server/test/coord-pause-route.test.ts` — the imports (`:15-27`), the source reads beside
  `CLAUDE_MD` (`:411`), `enumerations()` (`:433-443`) and the pinned site count at `:454`.

**Interfaces:**
- Consumes: `CCRC_API` (`server/test/ccdWsHelpers.ts:29`)
- Produces: a fifth `enumerations()` entry, `'ccd/ccrc-api, the deliberately-absent block'`, which both the
  count test (`:445-464`) and the lists-ALL test (`:466-475`) then scan.

**Why:** D-1168 (`docs/superpowers/plans/2026-08-31-program-leverage-wave6-f6-f7a.md:2069`, restated inside
D-1216 at `:2504-2508` — "the one number that has already gone two → three → four and left `ccd/ccrc-api`
stuck at 'two'") reported this and left it, because `ccd/` is agent-first and wave 6 was server + PWA + root
docs. **FOUR was re-derived, not taken on trust**: a script parsing `app.(get|post)('…'` in
`server/src/coord/routes.ts` and slicing each POST body to the next handler against
`[/requireMailToken\(req/, /checkMailToken\(/]` gives **25 handlers, 15 POSTs, 5 tokenless** —
`/api/runs/:id/abandon` (`:1027`), `/api/runs/:id/reclaim` (`:1073`), `/api/coord/pause` (`:1286`),
`/api/coord/caps` (`:1352`), `/api/claims/:id/break` (`:2004`) — of which **four** are the D-282 release
valves in `UNGATED` (`coord-pause-route.test.ts:177-180`) and the fifth, `/api/coord/caps`, is
`SESSION_ONLY` (`:213`) and by its own docstring releases no wedge. **"Five ungated doors" would be a new
false claim in the opposite direction.** The file's own header at `:29-30` says "a property this
load-bearing must be a mechanism and not a docstring", and nothing reads its prose today: `ccrc-api.test.ts`
reads the ROUTES table only (`:144-149`), and `ccrc-api-closed.test.ts`'s `clientCode()` (`:34-36`) *strips
every `#` line* by design (D-741) — so that file is the wrong home and must not grow a comment-reading
assertion.

**Home chosen deliberately: `coord-pause-route.test.ts`'s `enumerations()`, not `box-token-census.test.ts`.**
That census file addresses wave 8 by name at `:22-28` and pre-specifies its own recipe, so the choice is a
real one. `enumerations()` is stronger for two measured reasons: it feeds **both** the count test at
`:445-464` (which requires exactly one distinct CAPS cardinal, equal to `CARDINAL[UNGATED.size]`) **and**
the lists-ALL test at `:466-475` (which requires every `UNGATED` member by name), where the census file's
recipe checks number-words only; and its `passage()` helper (`:418-426`) fails loudly on a moved anchor and
on a slice under 300 chars.

**Measured at HEAD, 2026-09-02, and it corrects both the report and its crosscheck.** The
`WHAT IS DELIBERATELY ABSENT` → `SELF-CONTAINED` slice is **562 bytes** (clears the 300-byte floor), states
**zero** CAPS cardinals and **zero** CAPS ordinals, and contains **two** of the four door strings
(`/api/coord/pause`, `/api/runs/:id/abandon`) — not zero, as both earlier documents said. So the red-today
prediction stands, but the lists-ALL failure will name `/api/claims/:id/break` first, not an arbitrary door.

**Drafting hazard.** `CARD_RE` (`:405`) demands the passage state exactly one distinct CAPS cardinal, and
the block's subject is "what this client does not carry" — a much larger set than the four valves (25
handlers in `routes.ts` against 18 ROUTES rows). The rewrite below makes FOUR unmistakably the count of
D-282 release valves and states no other CAPS cardinal anywhere in the slice.

- [ ] **Step 1: Write the failing test**

In `server/test/coord-pause-route.test.ts`, add one import beside the others at `:15-27` (`readFileSync` is
already imported at `:16`):

```ts
import { CCRC_API } from './ccdWsHelpers.js';
```

Add the source read beside `CLAUDE_MD` at `:411`:

```ts
  const CCRC_API_SRC = readFileSync(CCRC_API, 'utf8');
```

Add the fifth entry to `enumerations()` (`:433-443`), after the `CLAUDE.md` one:

```ts
    // The shipped bash client, added in wave 8 (D-1168). It is a CLIENT and not
    // a route table, so it enumerates the doors for the opposite reason the
    // sites above do: to say which ones it deliberately does not carry. The
    // scanner does not care why a site names the set — only that a site that
    // names it names all of it, at the count this tree actually has.
    ['ccd/ccrc-api, the deliberately-absent block',
      passage('the deliberately-absent block', CCRC_API_SRC,
        'WHAT IS DELIBERATELY ABSENT', 'SELF-CONTAINED')],
```

And at `:454` change the pinned site count:

```ts
    expect(sites.length, 'a count site was dropped instead of corrected').toBe(6);
```

- [ ] **Step 2: Run it and watch it fail**

Run: `cd server && ./node_modules/.bin/vitest run test/coord-pause-route.test.ts -t "lists the doors"`

Expected: **1 failed** with
`ccd/ccrc-api, the deliberately-absent block does not name /api/claims/:id/break`.

Then run: `cd server && ./node_modules/.bin/vitest run test/coord-pause-route.test.ts -t "states the DERIVED one"`

Expected: **1 failed** with
`ccd/ccrc-api, the deliberately-absent block does not state the count as FOUR` — the passage states no CAPS
cardinal at all, so the assertion compares `Set {}` against `Set {'FOUR'}`.

- [ ] **Step 3: Implement**

(a) Replace the `# WHAT IS DELIBERATELY ABSENT.` block in `ccd/ccrc-api` — everything from that line down to
(but not including) the bare `#` line that precedes `# SELF-CONTAINED.` — with:

```bash
# WHAT IS DELIBERATELY ABSENT. Plenty of routes have no row below, and most of
# them are simply not this client's business. FOUR are absent as a DECISION —
# the release valves D-282 leaves ungated:
#   `POST /api/coord/pause`
#   `POST /api/runs/:id/abandon`
#   `POST /api/claims/:id/break`
#   `POST /api/runs/:id/reclaim`
# They carry no box token on purpose: the party a wedge locks out — the
# coordinator, a session holding a claim, a program whose coordinator is the
# corpse and whose box token died with it — is the party holding that key, so
# putting a wedge's release valve behind it would leave the wedge no door. That
# is precisely why none of them may be reachable from HERE. Coordinator clause 4
# is the other half — "This session never unpauses itself.
# `$REG/coordinator-paused` is the operator's file." — and an ungated door plus a
# session-side verb is a door with no lock at all. They are operator doors,
# reached from the PWA. If the need is ever real it is an operator tool, not a
# row below. (D-688. The names and the count here are not a census anyone keeps
# by hand: `server/test/coord-pause-route.test.ts` derives both from `UNGATED`,
# the one place the set is decided, and reds this passage when they disagree —
# D-1168, which is what this passage cost the last time a docstring stood in for
# a mechanism.)
```

Verified against the scanner's rules with the block in place: slice length **1349** bytes (> 300); CAPS
cardinals `['FOUR']` — exactly one distinct, and it equals `CARDINAL[UNGATED.size]`; CAPS ordinals `[]`; all
four door strings present. Note there is no CAPS `FIFTH`/`SIXTH`/`SEVENTH` anywhere — `ORD_RE` (`:406`)
would fail those against `UNGATED.size`.

(b) Amend **both** stale claims in `server/test/box-token-census.test.ts`. `:22-28` today reads:

```
// HOW TO ADD A SITE, because the next one is already known. Wave 8 inherits
// `ccd/ccrc-api:32-38`, which states the ungated set as TWO against the four in
// `UNGATED` (D-1168) — out of scope here because `ccd/` is on the coordinator's
// agent-first deploy lane. Pointing this mechanism at it is meant to be a few
// lines, not a redesign: read the file, slice the passage with `passage()`, and
// compare `numeralsIn()` against `word(<the derived size>)` — the same
// set-naming, one more site. Nothing about the derivation needs to change.
```

Replace it with:

```
// HOW TO ADD A SITE — and the next one is now done. Wave 8 corrected
// `ccd/ccrc-api`'s deliberately-absent block, which stated the ungated set as
// two against the four in `UNGATED` (D-1168), and put it under a scanner. It
// landed in `coord-pause-route.test.ts`'s `enumerations()` rather than here, and
// the reason is the same one that sent D-1223 to `auth-gate.test.ts`: the
// stronger home is the file that already derives the thing being checked.
// `enumerations()` feeds BOTH the count test and the lists-ALL test, so that
// block must now name every door as well as state the count; the recipe this
// note used to prescribe (slice with `passage()`, compare `numeralsIn()` against
// `word(<the derived size>)`) reads number words and nothing else. The rule the
// sites share is unchanged: the number is derived where it is derivable, and the
// prose beside it is checked against that.
```

`:45-47` today reads:

```
// on. NOT `graphify-out/`, a generated artefact. NOT `ccd/`, which is out of
// scope this wave and on the coordinator's agent-first deploy lane (D-1168:
// `ccd/ccrc-api` states the ungated set as TWO and is reported, not fixed).
```

Replace it with:

```
// on. NOT `graphify-out/`, a generated artefact. NOT `ccd/`, which was out of
// scope in wave 6 and is on the coordinator's agent-first deploy lane — its one
// census site, `ccd/ccrc-api`'s deliberately-absent block, was corrected in wave
// 8 and is now scanned by `coord-pause-route.test.ts`'s `enumerations()`, which
// reads the door names and the CAPS cardinal together (D-1168, closed).
```

Leave `:334-340` alone. That comment is inside `it('README\'s caps paragraph ENUMERATES the ungated doors
instead of counting them')` and narrates, in the past tense, the history D-1216 recorded ("the very number
that has already gone two → three → four and left `ccd/ccrc-api` stuck at 'two'"). It is a record of what
was measured then, not a claim about the tree now, and the ledger depends on that record.

- [ ] **Step 4: Run it and watch it pass**

```bash
cd server && ./node_modules/.bin/vitest run test/coord-pause-route.test.ts test/box-token-census.test.ts \
  test/ccrc-api.test.ts test/ccrc-api-closed.test.ts test/ccrc-api-ship.test.ts test/coordinator-skill.test.ts
```

The last four are run because the edit changes a shipped executable's bytes. They should be indifferent —
`clientCode()` strips `#` lines (`ccrc-api-closed.test.ts:34-36`), the token scan skips them too (`:127`),
`ccrc-api-ship.test.ts` reads `deploy.sh` and the file's mode, and `coordinator-skill.test.ts` touches
`ccd/ccrc-api` only through two shell pipelines — but this measures that rather than assuming it.

- [ ] **Step 5: MUTATION CHECK** — two; revert after each:
  1. Delete the `` #   `POST /api/runs/:id/reclaim` `` line from the corrected block.
     Run: `cd server && ./node_modules/.bin/vitest run test/coord-pause-route.test.ts -t "lists the doors"`
     Expect **RED**: `ccd/ccrc-api, the deliberately-absent block does not name /api/runs/:id/reclaim`.
     Right reason — the site enumerates the set and now omits a member, the exact defect D-1168 recorded.
  2. Change `FOUR` to `THREE` in the corrected block.
     Run: `cd server && ./node_modules/.bin/vitest run test/coord-pause-route.test.ts -t "states the DERIVED one"`
     Expect **RED**: `… does not state the count as FOUR`, because the scanner compares the passage's
     distinct CAPS cardinals against `CARDINAL[UNGATED.size]`, derived from the literal at `:177-180` and
     from no prose anywhere. Right reason — the number is derived where it is decided.

- [ ] **Step 6: Commit**

```bash
git add ccd/ccrc-api server/test/coord-pause-route.test.ts server/test/box-token-census.test.ts && git commit -m "fix(wave8): name all four ungated doors in ccrc-api and put the census under the scanner (D-1168)"
```

---

### Task 64: The second stale cardinal in the same file — seventeen against eighteen — and the mechanism that never existed

**Files:**
- Modify: `ccd/ccrc-api` — the single line beginning `#   * The route comes from ROUTES below,`, and the
  comment block beginning `# METHOD|path|needs-id|` that ends at the line before `declare -A ROUTES=(`.
  **Anchor by that text, not by line number.** (Provenance: at HEAD these are line 24 and lines 61–65. Task
  63 replaces a 7-line block above them with a 21-line one, so **if Task 63 has already landed, the block
  has moved to roughly lines 75–79.** Line 24 is unaffected either way. Nothing below depends on a number.)
- Test: `server/test/ccrc-api.test.ts` — hoist a helper above `describe('the closed route table', …)`
  (`:104`), replace the inline derivation inside `it('has exactly the rows exercised above …')`
  (`:144-149`), and add one `it` beside it.

**Interfaces:**
- Consumes: `CCRC_API` (`server/test/ccrc-api.test.ts:20`), `fs` (`:18`)
- Produces: `routeKeys()` — a module-level helper in `server/test/ccrc-api.test.ts` returning the client's
  ROUTES keys, used by both the existing row-set assertion and the new prose pin. Line-disjoint from Task
  63, which owns the `WHAT IS DELIBERATELY ABSENT` block.

**Why:** Not named by D-1168; found by counting. Measured 2026-09-02:
`awk '/^declare -A ROUTES=\(/,/^\)/' ccd/ccrc-api | grep -cE '^\s*\[[a-z.-]+\]='` → **18**, and
`grep -niE "seventeen|eighteen|sixteen|nineteen" ccd/ccrc-api` → exactly two hits, both **"seventeen"**, at
`:24` and `:62`. `server/test/ccrc-api.test.ts:159` already asserts `expect(keys).toHaveLength(18)` with
"Eighteen since `runs items-list` landed" at `:156` — and stayed green through the drift because it never
reads the prose. Separately, the ROUTES-table header claims the rows were "Measured from both corpora …
which Task 5's standing test re-runs so a skill that starts calling an unreachable route goes red rather
than failing in the field." **Measured false:** no test compares corpus-harvested routes against this table.
`coordinator-skill.test.ts:174-198` compares the COORDINATOR corpus (`routeSkillText`) to
`server/src/coord/routes.ts` (`registeredCoordRoutes`) — never to this table — and
`grep -c "routes.ts\|registered\|parity\|ROUTES" server/test/worker-skill.test.ts` → **0**, so "both
corpora" is backed by nothing. Two false claims, one file, both in D-1168's class.

**LEDGER:** D-1427 — `ccd/ccrc-api`'s closed-surface bullet and its ROUTES-table header
both said "seventeen rows" while the table held eighteen, and `server/test/ccrc-api.test.ts:159` pinned
eighteen but stayed green because no test read the client's prose; corrected, and both prose sites are now
checked against a count derived from the table.

**LEDGER:** D-1428 — `ccd/ccrc-api`'s ROUTES-table header claimed its rows are
re-derived from both skill corpora by "Task 5's standing test", a mechanism that does not exist: the only
route parity in the tree (`server/test/coordinator-skill.test.ts:174-198`) compares the COORDINATOR corpus
against `server/src/coord/routes.ts` and never this table, and `worker-skill.test.ts` has no route parity at
all — a comment claiming a guard it does not have.

- [ ] **Step 1: Write the failing test**

In `server/test/ccrc-api.test.ts`, hoist the derivation to module scope, just above
`describe('the closed route table', …)` at `:104`:

```ts
/** The client's own ROUTES table, read from the client. Hoisted because the
 *  prose pin below needs the SAME derivation the row-set assertion uses — a
 *  second copy of this slice is exactly how the two would come to disagree,
 *  which is the fault the pin exists to catch one level up.
 *
 *  The class allows a HYPHEN: `runs items-list` is the first two-word verb, and
 *  a `[a-z.]+` class silently DROPPED it (D-843) — that is the whole reason this
 *  reads the client instead of counting the `ROWS` table below. */
const routeKeys = (): string[] => {
  const src = fs.readFileSync(CCRC_API, 'utf8');
  const table = src.slice(src.indexOf('declare -A ROUTES=('));
  return [...table.slice(0, table.indexOf('\n)')).matchAll(/^\s*\[([a-z.-]+)\]=/gm)].map((m) => m[1]!);
};
```

Then replace the body lines `:144-149` of `it('has exactly the rows exercised above …')` with
`const keys = routeKeys();`, moving the D-843 comment into the helper above (it is reproduced there).
**Leave `expect(keys.sort()).toEqual(...)` and `expect(keys).toHaveLength(18)` exactly as they are** — that
18 is a deliberate tripwire, per its own comment at `:151` ("Stated separately so the number itself is a
claim someone has to edit"). Then add, beside it:

```ts
  it('states the row count in prose as the number the table actually holds', () => {
    const n = routeKeys().length;
    const WORDS: Record<number, string> = {
      15: 'fifteen', 16: 'sixteen', 17: 'seventeen', 18: 'eighteen',
      19: 'nineteen', 20: 'twenty', 21: 'twenty-one', 22: 'twenty-two',
    };
    const want = WORDS[n];
    expect(want, `the ROUTES table outgrew this test's word list at ${n}`).toBeDefined();

    const src = fs.readFileSync(CCRC_API, 'utf8');
    // TWO ANCHORED SITES, not a sweep over every numeral in the file — and the
    // difference matters: `ccrc-api` opens with "twelve permission denials in one
    // wave", which is HISTORY and must stay exactly as written. A blanket scan
    // would demand that sentence say eighteen. Each regex fails loudly when its
    // own anchor moves, so a deleted sentence reds here rather than passing on an
    // empty match — `passage()`'s lesson, applied to two one-line slices.
    const SITES: [string, RegExp][] = [
      ['the closed-surface bullet', /The route comes from ROUTES below, ([A-Za-z-]+) rows/],
      ['the ROUTES table header', /\n#\s*([A-Za-z-]+) rows\b/],
    ];
    for (const [name, re] of SITES) {
      const m = src.match(re);
      expect(m, `${name}: the anchor this pin reads is gone from ccd/ccrc-api`).not.toBeNull();
      expect(m![1]!.toLowerCase(), `${name} states a row count this table does not have`).toBe(want);
    }
    // The header anchor is a FIRST-match read, so it is only honest while it is
    // unique. A second `# <word> rows` line anywhere in the client would make
    // this pin silently watch the wrong one.
    expect([...src.matchAll(/\n#\s*([A-Za-z-]+) rows\b/g)].length,
      'the ROUTES-table header anchor is no longer unique in ccd/ccrc-api').toBe(1);
  });
```

- [ ] **Step 2: Run it and watch it fail**

Run: `cd server && ./node_modules/.bin/vitest run test/ccrc-api.test.ts -t "states the row count in prose"`

Expected: **1 failed** with `the closed-surface bullet states a row count this table does not have` —
`expected 'seventeen' to be 'eighteen'`. Both regexes match at HEAD and were verified to capture
`seventeen` and `Seventeen` respectively, with the second matching exactly once in the whole file.

- [ ] **Step 3: Implement**

(a) The line beginning `#   * The route comes from ROUTES below,` becomes:

```bash
#   * The route comes from ROUTES below, eighteen rows, and nothing else.
```

(b) The comment block beginning `# METHOD|path|needs-id|` — everything from that line down to the line
before `declare -A ROUTES=(` — becomes:

```bash
# METHOD|path|needs-id|comma-separated query keys this row accepts (or `-`).
# Eighteen rows, and that word is SCANNED: `server/test/ccrc-api.test.ts` derives
# the count from the table below and reds if this line or the bullet at the top
# of this file states a different one. The rows were CHOSEN on 2026-08-26 by
# `grep -rhoE '(GET|POST) /api/[A-Za-z0-9/:_-]+' ccd/coordinator-skill ccd/worker-skill`,
# which is how they were measured once and is NOT a guard that re-runs — an
# earlier version of this comment claimed it was, and nothing in the tree ever
# compared those corpora to this table. What does exist is narrower and worth
# knowing before you rely on it: `coordinator-skill.test.ts` checks the
# COORDINATOR corpus against `server/src/coord/routes.ts`, and the worker corpus
# has no route parity at all — so a skill that starts calling a route this table
# lacks fails in the field, not in the suite.
```

Note the new text contains no second `# <word> rows` line (`# Eighteen rows.` is the only one), which the
uniqueness assertion in Step 1 checks.

- [ ] **Step 4: Run it and watch it pass**

```bash
cd server && ./node_modules/.bin/vitest run test/ccrc-api.test.ts test/ccrc-api-closed.test.ts \
  test/ccrc-api-ship.test.ts test/coord-pause-route.test.ts
```

`coord-pause-route.test.ts` is in the list because Task 63 scans a slice of this same file. Both edits here
sit **outside** the `WHAT IS DELIBERATELY ABSENT` → `SELF-CONTAINED` slice — one above it, one below it — so
that scanner is unaffected; running it here measures that rather than assuming it.

- [ ] **Step 5: MUTATION CHECK** — two; revert after each:
  1. Restore `seventeen` on the closed-surface bullet line.
     Run: `cd server && ./node_modules/.bin/vitest run test/ccrc-api.test.ts -t "states the row count in prose"`
     Expect **RED**: `the closed-surface bullet states a row count this table does not have — expected
     'seventeen' to be 'eighteen'`. Right reason: the prose disagrees with the derivation, which is the
     defect itself.
  2. Delete the whole `#   * The route comes from ROUTES below, …` line.
     Run the same command. Expect **RED**: `the closed-surface bullet: the anchor this pin reads is gone
     from ccd/ccrc-api`. Right reason — this is the anti-vacuity half: a pin whose site was deleted must
     fail, not pass on an empty match.

- [ ] **Step 6: Commit**

```bash
git add ccd/ccrc-api server/test/ccrc-api.test.ts && git commit -m "fix(wave8): ccrc-api said seventeen rows against eighteen, and named a parity test that never existed (D-1427, D-1428)"
```

---

### NOTE FOR THE PLAN — the brief names two of three inherited items

Record this verbatim in the plan, and carry it into the wave-done mail as a question rather than a guess:

> **The brief for this work item is headed "THE THREE INHERITED" and then names two:** (i) the missing fifth
> repoint arm, and (ii) `ccd/ccrc-api`'s stale two-door census (D-1168). No third item was described. The
> measurement pass measured nothing about a third and made no claim, and this plan invents none — a third
> item guessed at is a wave doing work nobody asked for, on a program whose whole subject is prose that
> outran its measurement.
>
> Three *candidates* name wave 8 by name, offered here only so the coordinator can answer with a pointer
> instead of from memory. **They are unverified by this plan and none is scheduled.** (a)
> `docs/superpowers/plans/2026-09-02-program-leverage-wave7-f7.md:1674-1686` — the escalated `byId`
> question, ruled "do not require it at the route; fix it in the client … It goes to wave 8, which is
> already AGENT-FIRST", with the design half flagged ("a caller whose lookup fails, and a caller that is not
> a session at all, must not silently send an empty `byId`"). If this is the third item it lands in the SAME
> FILE as item (ii) and is a **behaviour** change, which is why Tasks 63 and 64 above declare their line
> ownership and anchor by text. (b) wave7-f7.md:1718-1719 — "the widened bare-bold prefix they handed me
> opens a small new false-positive class their eleven shapes did not cover. Theirs to own, carried to wave
> 8." (c) `docs/superpowers/plans/2026-08-28-program-leverage-wave2-f2.md:1835-1837` (D-1019) — "Adding a
> measured `readdir` to the agent protocol would be the real fix … wave 8 already owns the measured-read
> completion work and is its natural home."
>
> One number in candidate (a)'s neighbourhood must NOT be repeated from prose if it is picked up:
> wave7-f7.md:1676-1677 states "101 of 243 allocator-era rows carry `allocatedTo: ''`". That is live
> `coord.db` data on the server box; it was not verified from this worktree and must be re-measured from
> `GET /api/ledger` before any plan restates it.

**LEDGER:** D-1429 — wave 8's brief is headed "THE THREE INHERITED" and names two;
the third was never described, so it is recorded as an open question to the coordinator with three evidenced
candidates rather than guessed at, and no work was scheduled against it.

## Work item 5 — wave 7's twelve carries (Tasks 80–84)

> **Scope note every executor in this section must read first.**
>
> **Allocate every `D-TBD-<slug>` before you write it.** Each task below carries one or two
> `D-TBD-<slug>` placeholders and a `LEDGER:` line. Read the floor from `POST /api/ledger/deviations`
> at the moment you write the entry, never from this document and never from a plan — and allocate
> BEFORE the ref goes into source, which is the exact discipline D-1332 records this program breaking.
> Measured on 2026-09-02 in this worktree, the ccrc-pwa floor read **1333**, then **1389**, then
> **1392** on three reads in one day. Any floor printed in a document is already stale; that is why
> none is printed here.
>
> **Counts the brief gave are low; each task fixes its whole class.** The brief names SEVEN stale
> counts in `docs/superpowers/plans/2026-09-02-program-leverage-wave7-f7.md`. Measured at HEAD
> `5e9f650d` there are **TEN stale figures at ELEVEN sites** (C11 is stated twice) — Task 84 fixes all
> eleven sites, plus three edits of other classes and one in `server/src/coord/ledger.ts`. Same for
> Task 82 (FIVE false provenance claims in one file, not the two the brief names) and Task 83 (SEVEN
> muted floor messages, not four). Shipping a fix for seven while leaving three of the same class is
> exactly the shape D-1326 records — a true guard sold with a false measurement — and it is why D-1332
> was allocated 31 minutes after the round that was meant to have closed that class.
>
> **Baseline, and what is measured versus inherited.** Every anchor, line number and cardinal below was
> re-opened and re-measured in this worktree on **2026-09-02 at HEAD `5e9f650d`**
> (`git rev-parse HEAD == git rev-parse origin/main == 5e9f650d36a39b1cb0482411c673315b5dd0ca0b`), with
> the command recorded in the task that uses it. Per-suite test counts were measured by counting
> `it` blocks and `describe.each` rows: `ledger-crosstree` **30** (no `describe.each`),
> `deviation-refs` **26** (14 plain `it` + 2 rows at `:382` + 10 rows at `:406`), `ledger-sweep`
> **15**. The whole-suite figure (250 files / 6348 passed / 56 skipped) is INHERITED from the F8
> report and was NOT run by the planner — re-measure it before the first edit rather than quoting it.
>
> **This section's own plan document is scanned by the guards it edits.**
> `deviation-refs.test.ts`'s corpus classification table asserts that EVERY line at HEAD containing one
> of its `'definition'` needles really classifies as a definition, and `plansAt('HEAD')` reads every
> tracked `docs/superpowers/plans/*.md` — including the wave-8 plan. Measured 2026-09-02: each of those
> needles occurs in exactly ONE plan today, so a second, indented occurrence in this document would red
> rows `:415`/`:416` the moment it is committed. Every fixture and comment below is therefore spelled so
> that no `'definition'` needle appears contiguously in this document, and no line of it is itself a
> `DEFINITION`- or `ENTRY`-shaped line at column 0. **Do not "tidy" a split needle back together in this
> document.** Inside the test files themselves the contiguous spelling is fine and intended.

---

### Task 80: `FENCE` admits a TAB where CommonMark reads indented code — and it fails BOTH ways

**Files:**
- Modify: `server/src/coord/ledger.ts` — replace lines **186-202** exactly (`:186-201` is the docstring,
  `:202` is `const FENCE = /^\s{0,3}(\`{3,}|~{3,})/;`, verified verbatim at HEAD with `sed -n '202p' | cat -A`).
  The final text of `:186-202` is given in full in Step 3 — nothing is left to infer, and the D-1326
  provenance paragraph now at `:191-201` is carried through UNCHANGED, because CLAUDE.md's rule is that
  source `D-N` refs are authoritative history and are not deleted.
- Test: `server/test/ledger-crosstree.test.ts` — insert two `it` blocks immediately after the `});` at
  `:153` that closes `it('scans a file whose fence is never CLOSED whole, rather than going quiet after
  it', …)`, and before the blank line preceding `it('lets a longer fence quote a shorter one …')` at
  `:155`.

**Interfaces:**
- Consumes: nothing.
- Produces: `FENCE` narrowed from `\s{0,3}` to ` {0,3}`. No exported signature changes; `FENCE` is
  module-private.

**Why:** CommonMark 4.5 lets an opening fence carry up to three SPACES; §2.2 expands a tab to the next
4-column tab stop, so a tab-indented run is four columns of indentation — an indented code block, not a
fence. The shipped `\s{0,3}` admits a tab (and `\r \f \v`, NBSP, U+2000–200A, U+3000, U+FEFF), while the
docstring one line above it says "up to three spaces of indent": the code and its own description
disagree. The brief calls this a hide-only under-report; measured, that is incomplete — there is a
second and more dangerous direction. Both were driven on 2026-09-02 with a faithful python port of the
shipped `FENCE`/`opensFence`/`fencedLines`/`DEFINITION`, using the exact fixture strings below:
**(A) HIDE** — a tab-indented pair opens and closes a block that does not exist, and the real entry
between them vanishes in silence (shipped `[1300]`, correct `[1231, 1300]`).
**(B) OVER-REPORT** — a single tab-indented run CLOSES a real fence early, leaves an odd fence at EOF,
and the whole-file fail-loud arm then scans the file whole, so every QUOTED entry reads as a definition
(shipped `[1231, 1232]`, correct `[]`). (B) prints "renumber NOW" at a quotation — the exact false
positive D-1310 and D-1322 exist to prevent, arriving through the guard added to prevent it.
Corpus-neutral: measured over the 67 plans `plansAt` feeds, **5540** lines match the shipped `FENCE`
and **0** of them fail `^ {0,3}` (python port, both regexes, per line, 2026-09-02 at `5e9f650d`). So
this is potential rather than live — the same bar `opensFence`'s own paragraph sets one docstring
below. That dated pair stays in this document and does NOT go into source or into a test comment:
`ledger-crosstree.test.ts`'s header says "No cardinal here, deliberately (D-1320)", and this wave does
not get to break that rule inside the fix for its own class.

- [ ] **Step 1: Write the failing test** — `server/test/ledger-crosstree.test.ts`, after `:153`
```ts
  // ── D-1430 ───────────────────────────────────────────────────────
  // CommonMark 4.5 allows up to three SPACES before an opening fence; §2.2
  // expands a tab to the next 4-column tab stop, so a TAB-indented run is four
  // columns of indentation — an indented code block, and not a fence at all.
  //
  // BOTH DIRECTIONS ARE REAL, and the second is the dangerous one. The brief
  // that sent this back called it a hide-only under-report; it is not.
  //   (A) HIDE — a tab-indented pair opens and closes a block that does not
  //       exist, and a real entry between them is dropped IN SILENCE.
  //   (B) OVER-REPORT — a tab-indented run CLOSES a real fence early, leaving
  //       an odd fence at EOF; the whole-file fail-loud arm then scans the file
  //       whole and every QUOTED entry reads as a definition. That prints
  //       "renumber NOW" at a quotation — the false positive D-1310 and D-1322
  //       were both written to close, arriving through the guard that closes it.
  //
  // No line in today's corpus is affected: the narrowing was measured over the
  // plans `plansAt` feeds before it was made, and the dated figures live in the
  // wave plan, not here — this file's own header forbids a cardinal in a comment
  // (D-1320), and this fix does not get an exemption from it.
  it('does not read a TAB-indented run as a fence — the HIDE direction', () => {
    const hidden = [
      '\t```',
      '- **D-1231** — an entry inside what is really an indented code block',
      '\t```',
      '- **D-1300** — this plan’s own entry, after it',
    ].join('\n');
    expect(definitionsIn([f('a.md', hidden)]).map((d) => d.n)).toEqual([1231, 1300]);
  });

  it('and the same class OVER-reports: a tab run closing a real fence exposes a quotation', () => {
    const quoting = [
      '```',
      '- **D-1231** — the entry another plan defines, quoted',
      '\t```',
      '- **D-1232** — and the one after it, still quoted',
      '```',
    ].join('\n');
    expect(definitionsIn([f('b.md', quoting)]).map((d) => d.n)).toEqual([]);
  });
```
- [ ] **Step 2: Run it and watch it fail**
Run: `cd server && ./node_modules/.bin/vitest run test/ledger-crosstree.test.ts -t "TAB-indented"`
Expected: FAIL — `AssertionError: expected [ 1300 ] to deeply equal [ 1231, 1300 ]`
Then: `cd server && ./node_modules/.bin/vitest run test/ledger-crosstree.test.ts -t "OVER-reports"`
Expected: FAIL — `AssertionError: expected [ 1231, 1232 ] to deeply equal []`
(Both outputs were produced by the python port on 2026-09-02 with these exact fixture strings.)

- [ ] **Step 3: Implement** — `server/src/coord/ledger.ts`, replace lines **186-202** with exactly this
```ts
/** A fenced-code delimiter: up to three SPACES of indent, then a run of three or
 *  more backticks or tildes. Captured as the RUN, because a fence closes only on
 *  the same character at the same length or longer — which is how a four-backtick
 *  block can quote a three-backtick one.
 *
 *  THE EXEMPLAR THIS DOCSTRING FIRST GAVE WAS INVENTED (D-1326).
 *  `2026-08-28-program-leverage-wave1-f1.md:216` was named as a corpus instance
 *  "copied from the corpus, not invented"; measured, its four-backtick block
 *  (216–338) contains ZERO fence runs at all, and the file says why at :212 —
 *  "Indented code blocks, not fences". The shape IS in this repo —
 *  `2026-08-08-build7-surfaces.md:408`, inner fences at 429/432 and 460/465 — but
 *  that file is in `LEGACY_PER_PLAN_LEDGERS`, so `plansAt` never feeds it to this
 *  guard. The nesting fixture is therefore CONSTRUCTED, deliberately, and saying
 *  so is the point: the behaviour was always right and red-on-mutation, and only
 *  the provenance lied. A true guard sold with a false measurement is this wave's
 *  own recurring class.
 *
 *  SPACES, NOT `\s` (D-1430). The sentence at the top said "three
 *  spaces" while the pattern below said `\s{0,3}`, which admits a TAB (and \r,
 *  \f, \v, NBSP, U+2000-200A, U+3000, U+FEFF). CommonMark §2.2 expands a tab to
 *  the next 4-column tab stop, so a tab-indented run is four columns of
 *  indentation — an indented code block, not a fence. It failed in BOTH
 *  directions, each driven by a fixture in `ledger-crosstree.test.ts`: a
 *  tab-indented PAIR hid a real entry between two delimiters that do not exist,
 *  and a single tab-indented run CLOSED a real fence early, left an odd fence at
 *  EOF, and handed the whole-file arm a quotation to report as a definition —
 *  "renumber NOW" aimed at a quoted line. Zero lines in the plans this guard
 *  reads are affected today, so this is potential rather than live, which is the
 *  bar `opensFence` sets one docstring below. The >= 4-space direction needs no
 *  rule of its own: `DEFINITION` is anchored at column 0. */
const FENCE = /^ {0,3}(`{3,}|~{3,})/;
```
- [ ] **Step 4: Run it and watch it pass**
Run: `cd server && ./node_modules/.bin/vitest run test/ledger-crosstree.test.ts` — expect **32** tests
(30 at HEAD + these 2). Then `cd server && ./node_modules/.bin/vitest run test/deviation-refs.test.ts`
and `cd server && ./node_modules/.bin/vitest run test/ledger-sweep.test.ts`: both corpus-reading
suites must be UNCHANGED by this task — record each count before and after and assert the delta is
**0**, which is exactly what the 0-divergence measurement predicts. Their HEAD counts (26 and 15,
measured 2026-09-02) are provenance only: items 1-4 run first and Tasks 46 and 47 add five cases to
`ledger-sweep`.
- [ ] **Step 5: MUTATION CHECK** — restore `const FENCE = /^\s{0,3}(\`{3,}|~{3,})/;` as the last line of
the block, leaving the docstring and both fixtures alone. Expect RED **twice**, once per direction:
`expected [ 1300 ] to deeply equal [ 1231, 1300 ]` (the HIDE) and
`expected [ 1231, 1232 ] to deeply equal []` (the OVER-REPORT). Each reds for its own reason — one for a
dropped definition, one for a quotation reported as a definition — so neither can pass for the other's
reason, and neither can red because a fixture happens to be malformed: both fixtures are asserted in
opposite directions. Revert.
- [ ] **Step 6: Commit**
```bash
git add server/src/coord/ledger.ts server/test/ledger-crosstree.test.ts && git commit -m "fix(wave8): FENCE reads a tab as three spaces of indent, hiding entries and exposing quotations (D-1430)"
```
LEDGER (D-1430): `FENCE`'s `\s{0,3}` admitted a TAB where CommonMark reads four columns of
indented code, and the defect ran in BOTH directions — a tab-indented pair HID a real entry between two
delimiters that do not exist, and a single tab-indented run CLOSED a real fence early and handed the
whole-file fail-loud arm a quotation to report as a definition, printing "renumber NOW" at a quoted line;
narrowed to `^ {0,3}`, which also makes the sentence beside it true, with zero corpus lines affected
(5540 fence-shaped lines over 67 plans, 0 divergence, measured 2026-09-02 at `5e9f650d`).

---

### Task 81: D-1329's retraction reached `ledger.ts` only — both test files still assert the refuted exemplar

**Files:**
- Modify: `server/test/deviation-refs.test.ts:117-123` — the `DEFINED` comment is `:117-122` and
  `const DEFINED = /^(?:#{2,4} |- \*\*)D-(\d+)\b/;` is `:123`; the Step-3 block reproduces the const, so
  the range MUST include `:123` or the file gets a duplicate declaration.
- Modify: `server/test/ledger-crosstree.test.ts:43-51` — the whole `it('reads the colon form …')` block.
- Test: `server/test/deviation-refs.test.ts` — one new `it`, inserted as the **second-to-last** test of
  `describe('the cross-tree collision scan (F7 — before the merge, not after)')`: immediately after the
  `});` at `:433` that closes the corpus `describe.each`, and immediately before
  `it('sees MORE than the subject-based scan above — the two are not redundant', …)` at `:435`.

**Interfaces:**
- Consumes: nothing.
- Produces: a marker line reading `COLON-FORM EXEMPLAR: <plan>.md`, present exactly once in each of the
  two suites, read by the new guard and checked against the corpus.

**Why:** D-1329 retracted the claim that build 9b spells its entries `- **D-211** (Task 3):` — colon, no
em-dash — and the retraction reached `server/src/coord/ledger.ts` **only**. At HEAD the tree contradicts
itself in three places: `deviation-refs.test.ts:118-119` still states it, `ledger-crosstree.test.ts:45`
still attributes its colon fixture to build 9b, and the SAME file's corpus row at `:415` — the
`'definition'` row for build 9b's D-211 line — pins the EM-DASH spelling and passes. Measured
2026-09-02: `2026-08-24-build9b-peers-claims-allocator.md:72` carries U+2014 (`cat -A` shows
`M-bM-^@M-^T`), and that plan holds **14 definitions, 0 of them invisible to `ENTRY`, 0 colon-form**.
The real colon-form exemplar is `2026-08-23-stage5-oss-polish.md`, whose entries are spelled
`- **D-189** (Task 1): …` through `- **D-195** …`; that plan holds **15 definitions, all 15 invisible
to `ENTRY`, all 15 with no em-dash on the line**. Landing one site without the other keeps a
half-retracted claim alive, so both move in one commit and a guard makes the claim un-re-breakable.

- [ ] **Step 1: Write the failing test** — `server/test/deviation-refs.test.ts`, after `:433`
```ts
  // D-1431. The `auth-gate.test.ts` idiom — read the claim OUT of
  // the source file and check it against the thing it claims about — which is
  // the only mechanism in this area that has ever stopped a false claim from
  // re-entering. D-1329 retracted "build 9b spells its entries with a colon and
  // no em-dash"; the retraction reached ledger.ts only, so at 5e9f650d two
  // suites asserted the refuted exemplar while the corpus row for that very line
  // pinned the em-dash spelling and passed.
  //
  // THE NEEDLE IS SPELLED SPLIT, and that is not decoration: this scan reads its
  // OWN file, so a contiguous tag matches its own call site and the "one marker
  // per suite" check fires on a file that is perfectly correct. Measured — the
  // first draft of this test did exactly that, which is the same trap
  // `auth-gate.test.ts`'s own header records springing on all three of its
  // needles, first run.
  //
  // No cardinal is asserted: the counts move with the corpus. The PROPERTY is
  // that the plan each marker names holds at least one entry `DEFINITION` reads
  // and `ENTRY` cannot, and that at least one of those is the COLON spelling
  // rather than the WRAPPED em-dash — a different blindness with its own test.
  it('the colon-form exemplar these suites name really is colon-form, and really ENTRY-blind', () => {
    const TAG = 'COLON-FORM ' + 'EXEMPLAR: ';
    const MARKER = new RegExp(TAG + '(\\S+\\.md)');
    const SUITES = ['deviation-refs.test.ts', 'ledger-crosstree.test.ts'];
    const named = SUITES.flatMap((suite) =>
      readFileSync(path.join(here, suite), 'utf8').split('\n')
        .map((l) => MARKER.exec(l))
        .filter((m): m is RegExpExecArray => m !== null)
        .map((m) => [suite, m[1]!] as [string, string]));
    expect(named.map(([s]) => s),
      `expected one exemplar marker in each of ${SUITES.join(', ')}, found ` +
      `${named.length}: ${named.map(([s, p]) => `${s} -> ${p}`).join(', ')}`).toEqual(SUITES);

    const plans = plansAt('HEAD');
    for (const [suite, plan] of named) {
      const hit = plans.find((p) => p.path === plan);
      expect(hit, `${suite} names ${plan}, which the scanned corpus does not hold`).toBeDefined();
      // Fence-aware: a line only counts if the number it opens is also a real
      // definition of the whole file, so a quoted entry cannot stand in.
      const defined = new Set(definitionsIn([hit!]).map((d) => d.n));
      const blind = hit!.text.split('\n').filter((line) => {
        const one = definitionsIn([{ path: 'one-line.md', text: line }]);
        return one.length === 1 && defined.has(one[0]!.n) && ENTRY.exec(line) === null;
      });
      expect(blind.length,
        `${suite} names ${plan} as the exemplar of the form ENTRY cannot see, but that plan holds ` +
        `${blind.length} such entries out of ${defined.size} definitions`).toBeGreaterThan(0);
      const colon = blind.filter((line) => !line.includes('—'));
      expect(colon.length,
        `${suite} names ${plan} as the colon-spelling exemplar, but all ${blind.length} of its ` +
        'ENTRY-blind entries carry an em-dash — that is the WRAPPED form, a different blindness')
        .toBeGreaterThan(0);
    }
  });
```
- [ ] **Step 2: Run it and watch it fail**
Run: `cd server && ./node_modules/.bin/vitest run test/deviation-refs.test.ts -t "colon-form exemplar"`
Expected: FAIL — `AssertionError: expected one exemplar marker in each of deviation-refs.test.ts, ledger-crosstree.test.ts, found 0: : expected [] to deeply equal [ 'deviation-refs.test.ts', 'ledger-crosstree.test.ts' ]`
(The claim is not yet machine-readable — that is the correct first red. Note the split `TAG` means the
test's own source lines do NOT count as markers; verified in python against both source lines.)

- [ ] **Step 3: Implement** — replace `server/test/deviation-refs.test.ts:117-123` with
```ts
  // Definition-SHAPED line prefixes, deliberately looser than ENTRY: this repo's
  // ledgers hold entries spelled `- **D-190** (Task 1): the session-id
  // pattern shipped …` — colon, no em-dash — which ENTRY cannot see. For a MAX
  // the prefix alone is enough: it reads the number a heading/bullet line
  // DEFINES, whatever its subject punctuation.
  //
  // THE EXEMPLAR THIS COMMENT FIRST GAVE WAS REFUTED (D-1329, whose retraction
  // reached `server/src/coord/ledger.ts` and not this file). It named build 9b;
  // measured, that plan's D-211 entry is the EM-DASH form and the plan holds zero
  // ENTRY-blind entries — a claim the corpus table below already refuted, and
  // passed while refuting. The line break in the quoted spelling above is
  // deliberate: the contiguous string is a needle in that table, and this repo's
  // own plans are part of the corpus it scans.
  // COLON-FORM EXEMPLAR: 2026-08-23-stage5-oss-polish.md
  const DEFINED = /^(?:#{2,4} |- \*\*)D-(\d+)\b/;
```
and replace `server/test/ledger-crosstree.test.ts:43-51` with
```ts
  it('reads the colon form and the WRAPPED form that ENTRY cannot see (D-1294)', () => {
    // Exactly PR #38's spelling of D-1158 — an em-dash at end of line with the
    // subject on the next — and the colon form this repo's stage-5 ledger uses,
    // copied verbatim from that plan. ENTRY matches neither, which is why half
    // of the first incident was undetectable even in a fully merged tree.
    //
    // The colon exemplar was attributed to build 9b until D-1329 refuted it;
    // that retraction reached ledger.ts only, so this fixture carried the refuted
    // spelling for a wave. `deviation-refs.test.ts` now reads the marker below
    // and checks the named plan against the corpus, in both directions.
    // COLON-FORM EXEMPLAR: 2026-08-23-stage5-oss-polish.md
    expect(definitionsIn([f('a.md', '- **D-1158** (2026-08-31, found by running the suite) —\n  the subject')])
      .map((d) => d.n)).toEqual([1158]);
    expect(definitionsIn([f('b.md', '- **D-189** (Task 1): the duckdns placeholder set shipped as')])
      .map((d) => d.n)).toEqual([189]);
  });
```
The colon fixture is `2026-08-23-stage5-oss-polish.md`'s D-189 line, verbatim (verified at HEAD:
`DEFINITION` reads 189, `ENTRY` does not match). D-189 rather than D-190 is deliberate — the D-190 line
is a live `'definition'` needle in `deviation-refs.test.ts`'s corpus table, and quoting it in this
plan document would red that row.

- [ ] **Step 4: Run it and watch it pass**
Run: `cd server && ./node_modules/.bin/vitest run test/deviation-refs.test.ts` — expect **27** tests
(26 + 1). Then `cd server && ./node_modules/.bin/vitest run test/ledger-crosstree.test.ts` — expect
**32** (30 + Task 80's 2; this task replaces an existing `it`, it does not add one).
- [ ] **Step 5: MUTATION CHECK** — change **either** marker line to
`// COLON-FORM EXEMPLAR: 2026-08-24-build9b-peers-claims-allocator.md`, i.e. put the refuted claim back.
Expect RED: `AssertionError: <suite> names 2026-08-24-build9b-peers-claims-allocator.md as the exemplar
of the form ENTRY cannot see, but that plan holds 0 such entries out of 14 definitions: expected +0 to
be greater than +0`. That is the right reason and not a fixture accident: 0 and 14 are measured facts
about a tracked file (`definitionsIn` + `ENTRY`, per line, fence-aware, 2026-09-02), and they are
exactly the facts that refute the claim D-1329 retracted. Revert.
- [ ] **Step 6: Commit**
```bash
git add server/test/deviation-refs.test.ts server/test/ledger-crosstree.test.ts && git commit -m "fix(wave8): land D-1329's retraction in the two test files it never reached, and pin the exemplar (D-1422, D-1431)"
```
LEDGER (D-1431): D-1329's retraction of the "build 9b spells its entries with a colon and
no em-dash" exemplar reached `server/src/coord/ledger.ts` only, so at `5e9f650d`
`deviation-refs.test.ts:118` and `ledger-crosstree.test.ts:45` still asserted the refuted claim while the
same file's corpus row pinned the em-dash spelling and passed — both sites now name the measured
exemplar (`2026-08-23-stage5-oss-polish.md`: 15 ENTRY-blind colon entries against build 9b's 0) behind a
split-spelled marker a new guard reads out of the source and checks against the corpus.

---

### Task 82: four false provenance claims in `ledger-crosstree.test.ts`, and a set that must be derived

**Files:**
- Modify: `server/test/ledger-crosstree.test.ts:20-22` (the header's blanket claim), `:59-64` (the
  "copied from a real plan" comment; `:58` is the `it(` line and stays), `:109-112` (the "verbatim" /
  "every entry" comment; `:108` is the `it(` line and stays), `:277-280` (the `it(` line plus its
  three-line comment — **NOT `:281`**, which is a live assertion:
  `expect(crossTreeCollisions([f('a.md', '- **D-72** — x')], [f('b.md', '- **D-72** — y')])).toEqual([]);`
  and deleting it weakens the guard silently, because the suite still passes without it).
- Modify: `server/test/deviation-refs.test.ts` — two new rows inserted after `:416`, i.e. as the last
  two entries of the corpus `describe.each` array that opens at `:406` and closes at `:417`.
- Test: `server/test/deviation-refs.test.ts` — one new `it` immediately after Task 81's new `it`.

**Interfaces:**
- Consumes: Task 81's placement (both `it`s live in the same `describe`; land Task 81 first).
- Produces: a marker line `SUB-211 COLLISIONS: D-73, D-142, D-143, D-144` in
  `ledger-crosstree.test.ts`, read by the new guard; two new rows in the corpus classification table.

**Why:** Five provenance claims in this one file are false, and the file refutes one of them itself.
Measured 2026-09-02 by substring search over all 129 tracked `docs/**/*.md`:
(1) **all three** strings the `:112` comment calls "copied verbatim from `origin/main`" are ABSENT — the
real lines are longer (`2026-08-15-fleet-robustness-build8.md:13355` and `:13564`,
`2026-08-19-stage2e-remote-control.md:155`);
(2) of the four strings at `:65-68` that `:60-61` calls "copied from a real plan", only the D-172 one is
present, as a prefix of a line in `2026-08-23-stage5-oss-polish.md`;
(3) `:22`'s blanket "every shape below is copied from a real plan" is contradicted by this same file's
nesting-fixture paragraph, which says of its own fixture "THIS FIXTURE IS CONSTRUCTED";
(4) `:109-110`'s "four plans on main open **every** entry this way" is true of the count — build 8,
stage 2e, worker-skill and upstream-launcher-locks — but false of build 8, which holds **9** bare-bold
entries **and 5 in other forms** (14 definitions total);
(5) `:278-280` still claims **six** sub-211 collisions (D-73/142/143/144/149/172) when D-1310 retracted
D-149 and D-172 in the same document — measured, the shipped `DEFINITION` derives **four**
(D-73, D-142, D-143, D-144) and only the pre-lookahead prefix-only regex derives six.
That is D-1326's class — a true guard sold with a false measurement — five more times, in the file where
D-1326 was recorded. **(1)-(4) are `D-1432`; (5) is `D-1433`, allocated
separately because it is the one claim here that can be pinned to a derivation rather than corrected in
prose.** That is why this task's ledger entry counts FOUR and its title says four, not five: the fifth
claim is real, and it is the other number's.
The four-vs-six number is the one cardinal here that CAN be pinned, because it is
derived from tracked text rather than from a live `coord.db`, so it is mechanised rather than corrected.

- [ ] **Step 1: Write the failing test** — `server/test/deviation-refs.test.ts`, after Task 81's `it`
```ts
  // D-1433. The era-scoping argument's own data points. D-1310 found
  // that two of the six sub-211 collisions cited for it (D-149, D-172) were
  // never collisions — they are line-initial bolded CITATIONS, and the shipped
  // DEFINITION drops both — so the argument rests on four. That correction
  // landed in D-1310's entry and in D-1320's, and never in the test file the
  // argument ships in. Derived here rather than remembered, in the
  // `auth-gate.test.ts` idiom: read the claim out of the source, check it
  // against the corpus. No split needle is needed — this scan reads the OTHER
  // file, never its own.
  it('the era-scoping comment names the sub-211 collision set this corpus derives', () => {
    const CROSSTREE = readFileSync(path.join(here, 'ledger-crosstree.test.ts'), 'utf8');
    const claim = CROSSTREE.split('\n').filter((l) => l.includes('SUB-211 COLLISIONS:'));
    expect(claim.length,
      'expected exactly one line marked SUB-211 COLLISIONS: in ledger-crosstree.test.ts, found ' +
      `${claim.length}`).toBe(1);
    const claimed = [...claim[0]!.matchAll(/D-(\d+)/g)].map((m) => Number(m[1]));

    const byN = new Map<number, Set<string>>();
    for (const d of definitionsIn(plansAt('HEAD'))) {
      byN.set(d.n, (byN.get(d.n) ?? new Set<string>()).add(d.file));
    }
    const derived = [...byN.entries()]
      .filter(([n, files]) => n < LEDGER_ALLOCATOR_ERA && files.size > 1 && !GRANDFATHERED.has(n))
      .map(([n]) => n).sort((a, b) => a - b);
    // The premise, established rather than assumed: a derivation that found
    // nothing would be satisfied by any claim that named nothing.
    expect(derived.length,
      `the derivation found ${derived.length} sub-211 collisions outside GRANDFATHERED — a scan that ` +
      'finds none asserts nothing').toBeGreaterThan(0);
    expect(claimed,
      'the comment names a sub-211 collision set this corpus does not derive').toEqual(derived);
  });
```
and widen the existing import at `server/test/deviation-refs.test.ts:15`
(`import { crossTreeCollisions, definitionsIn, floorFromScan } from '../src/coord/ledger.js';`) to
```ts
import { crossTreeCollisions, definitionsIn, floorFromScan,
         LEDGER_ALLOCATOR_ERA } from '../src/coord/ledger.js';
```
(`LEDGER_ALLOCATOR_ERA` is exported at `server/src/coord/ledger.ts:114`; `GRANDFATHERED` is already
module-scope in this test file at `:33-35`.)

- [ ] **Step 2: Run it and watch it fail**
Run: `cd server && ./node_modules/.bin/vitest run test/deviation-refs.test.ts -t "sub-211 collision set"`
Expected: FAIL — `AssertionError: expected exactly one line marked SUB-211 COLLISIONS: in ledger-crosstree.test.ts, found 0: expected +0 to be +1`

- [ ] **Step 3: Implement** — four edits in `server/test/ledger-crosstree.test.ts`, then two rows in
`server/test/deviation-refs.test.ts`.

`:20-22` (the header's blanket claim; `:19` ends "one of the five numbers this program actually lost."):
```ts
//      No cardinal here, deliberately (D-1320): the totals move with every plan,
//      and a count in a comment is stale by its own commit. What is stable is the
//      SHAPE. Provenance is stated PER FIXTURE below and is NOT uniform: some
//      shapes are ABRIDGED from real lines on main, the nesting fixture is
//      CONSTRUCTED and says so in its own paragraph, and the unabridged lines are
//      pinned by `deviation-refs.test.ts`'s corpus classification table, which
//      reads them out of HEAD. The blanket "every shape below is copied from a
//      real plan" that stood here was false of at least four fixtures and was
//      refuted by this file's own nesting paragraph (D-1432).
```
`:59-64`:
```ts
    // The first version of this suite tested only MID-LINE mentions, and a
    // prefix-only DEFINITION called all four of these definitions. Every string
    // here is ABRIDGED from a real citation on main — only the D-172 one is
    // present as written, as a prefix of a line in
    // `2026-08-23-stage5-oss-polish.md`; the other three are shortened or
    // reworded, and the unabridged lines are pinned against HEAD by the corpus
    // table in `deviation-refs.test.ts`. The second is the exact prose a wave
    // writes when it RECORDS a ledger collision — so a prefix-only rule reds on
    // the narrative describing the incident this guard exists to detect, and
    // tells the author to renumber a deviation they only cited.
```
`:109-112`:
```ts
    // Four plans on main open entries this way — build 8 (which uses BOTH forms:
    // most of its entries are bare-bold and the rest are heading/bullet ones),
    // stage 2e, the worker skill, upstream-launcher-locks. A re-definition of any
    // of those numbers was silently missed by a guard whose subject is not
    // missing one. Strings ABRIDGED from real entries on `origin/main` — not
    // verbatim, as this comment claimed for a wave: the real lines are longer,
    // and the corpus table in `deviation-refs.test.ts` pins them unabridged at
    // HEAD.
```
`:277-280` (the `it(` line and its three comment lines only — leave `:281` alone):
```ts
  it('leaves the pre-allocator era alone — GRANDFATHERED must never have to grow', () => {
    // Widening the SUBJECT extraction instead would have surfaced sub-211
    // collisions outside GRANDFATHERED, every one of which would have had to
    // join a set whose own rule says it may only SHRINK. The set is DERIVED,
    // never remembered: `deviation-refs.test.ts` reads the line below and checks
    // it against the corpus. It read SIX until D-1310 found that D-149 and D-172
    // are citations the shipped DEFINITION drops — a retraction that reached two
    // plan entries and not this file (D-1433).
    // SUB-211 COLLISIONS: D-73, D-142, D-143, D-144
```
and two rows appended to the corpus table in `server/test/deviation-refs.test.ts` after `:416`, so the
"pinned by the corpus table" pointer above is true of the two abridged fixtures that have a real line:
```ts
    ['definition', 'D-301 (was D-B8-5)' + ' — four guards were decorated'],
    ['citation', "D-291's wait — `startedSessionFor`"],
```
The first needle is spelled SPLIT **in this plan document and in the test file alike**: contiguous, it
is a line this document would then contain, and the row asserts that every line at HEAD holding it
classifies as a definition — an indented quotation does not, so the row would red on its own commit.
The concatenation evaluates to the same needle. Verified at HEAD: `D-301 (was D-B8-5) — four guards
were decorated` occurs on exactly one line (`2026-08-15-fleet-robustness-build8.md:13564`) and
classifies as a definition; `D-291's wait — \`startedSessionFor\`` occurs on exactly one line
(`2026-08-11-build4-conversation-and-controls.md:122`) and classifies as a citation.

- [ ] **Step 4: Run it and watch it pass**
Run: `cd server && ./node_modules/.bin/vitest run test/deviation-refs.test.ts` — expect **30** tests
(26 baseline + 1 from Task 81 + 1 `it` here + 2 table rows). Then
`cd server && ./node_modules/.bin/vitest run test/ledger-crosstree.test.ts` — expect **32**, unchanged
by this task (comments only).
- [ ] **Step 5: MUTATION CHECK** — two, both required.
(a) Restore the retracted members: `// SUB-211 COLLISIONS: D-73, D-142, D-143, D-144, D-149, D-172`.
Expect RED: `AssertionError: the comment names a sub-211 collision set this corpus does not derive:
expected [ 73, 142, 143, 144, 149, 172 ] to deeply equal [ 73, 142, 143, 144 ]`. Right reason: the two
extra numbers are exactly the two D-1310 retracted, the derivation runs over tracked text at HEAD, and
the premise assertion above it is green (4 > 0) — so nothing but the false claim can red it.
(b) Change the new row `['definition', 'D-301 (was D-B8-5)' + ' — four guards were decorated']` to
`['citation', …]`. Expect RED:
`AssertionError: citation expected, got 1 definition(s) from: **D-301 (was D-B8-5) — four guards …`
(the message quotes the first 90 characters of the real line at HEAD; it is truncated HERE, in this
document, for the same reason the row's needle is spelled split — a contiguous copy in a tracked plan
would red the very row it describes).
Right reason: the row is classified against the real line at HEAD, not against a fixture — an inverted
`kind` is the only thing that can produce it.
Revert both.
- [ ] **Step 6: Commit**
```bash
git add server/test/ledger-crosstree.test.ts server/test/deviation-refs.test.ts && git commit -m "fix(wave8): four false provenance claims in ledger-crosstree, and derive the sub-211 set (D-1432, D-1433)"
```
LEDGER (D-1432): four provenance claims in `ledger-crosstree.test.ts` were false — a
blanket "every shape below is copied from a real plan" the file itself refutes in its own nesting
paragraph, a "copied verbatim from origin/main" for three strings absent from all 129 tracked docs, a
"copied from a real plan" for three of four, and "four plans open EVERY entry this way" when build 8
opens 9 of its 14 that way — all four sentences now state abridgement honestly and point at the corpus
table, which gained two rows so the pointer is true of the fixtures that have a real line.
LEDGER (D-1433): the era-scoping argument's "six sub-211 collisions
(D-73/142/143/144/149/172)" survived at `ledger-crosstree.test.ts:278-280` after D-1310 retracted D-149
and D-172 in two plan entries — measured, the shipped `DEFINITION` derives FOUR and only the
pre-lookahead prefix derives six, and the set is now DERIVED from the corpus by a guard that reads the
comment's own marker line, so it cannot go stale again.

---

### Task 83: seven floor assertions state a condition they do not isolate, and the sweep names the wrong plan

**Files:**
- Modify: `server/test/deviation-refs.test.ts:78`, `:79`, `:144`, `:206-213` (the `it(` line at `:206`
  through its closing `});` at `:213` — the replacement block reproduces that `});`, so a `:206-212`
  edit would leave a stray one), `:333`, `:334`, `:335`, `:336`.
- Modify: `server/test/ledger-sweep.test.ts:189-191` and `:224-226`.
- Test: `server/test/deviation-refs.test.ts` — one new `it` (a self-scan), inserted as the **last** test
  inside `describe('the cross-tree collision scan (F7 — before the merge, not after)')`: immediately
  after the `it('sees MORE than the subject-based scan above — the two are not redundant', …)` block and
  before that `describe`'s closing `});`. It reads the file by path, so only determinism matters here.

**Interfaces:**
- Consumes: nothing from Tasks 80-82; lands after them so the self-scan sees the final file.
- Produces: the rule "a messaged floor assertion in this file whose floor is an integer literal >= 2
  must interpolate the expression it asserts on", enforced by a scan of this file's own source, plus a
  named REQUIRED set so the scan cannot silently stop seeing an assertion it was written for.

**Why:** `expect(there.length, 'no plans read from …').toBeGreaterThanOrEqual(50)` reds for 1..49 as
well as for 0, so in 49 of its 50 failing states the message is a false statement about what happened —
and a CI reader has only the message. Measured 2026-09-02: `plansAt('HEAD')` returns **67** plans
against a floor of 50, and `definitionsIn` finds **439** definitions against a floor of 300, so the
stated condition is not merely un-isolated, it is 26% and 32% below being reachable at all. The brief
names one instance (`:334`); the report found three siblings on adjacent lines; the crosscheck found a
fifth at `:144`; a full scan of the file with the regex below finds **seven**, which is the whole class
in this file, and all seven are mute. Separately, `ledger-sweep.test.ts:190-191` attributes
D-1067/1068/1069 to `2026-08-30-d1066-dead-recipient-parks.md`, which defines only D-1066 — measured
with `grep -rnE '^(#{2,4} |- \*\*|\*\*)D-(106[6-9]|1243|1244)\b' docs/superpowers/plans/`, the other
three are in `2026-08-30-d1067-d1068-delivered-row-terms.md` — and both that comment and its sibling at
`:224-226` name the orphan set in the present tense as four when it is six. Those two are PROSE-ONLY:
the fixtures use a synthetic `demo` project and synthetic numbers (261/299), so nothing the suite
asserts depends on them; they are the only place a reader learns what the guard is for, which is why
they are fixed and why they are labelled prose-only here.

- [ ] **Step 1: Write the failing test** — `server/test/deviation-refs.test.ts`, last in the cross-tree
`describe`
```ts
  // D-1434. A messaged floor assertion whose message says the
  // scan read nothing, while the floor is 50, reds for 1..49 as well as for 0 —
  // so in 49 of its 50 failing states the message is a false statement about
  // what happened, and the reader of a CI log has only the message.
  //
  // NO EXAMPLE CALL IS SPELLED IN THIS COMMENT, deliberately: this scan reads its
  // own file, and an illustrative `expect(…).toBeGreaterThanOrEqual(50)` written
  // out here would be matched by the regex below and would keep the guard red
  // forever. Measured — the first draft of this comment did exactly that.
  //
  // The rule is scoped so it never asks for churn where the message is already
  // exact: when the floor is an integer literal >= 2 the failing set is wide, so
  // the message must carry the measured value. A floor of 0 reds only on
  // emptiness, and a comparison against another measured quantity states its own
  // condition; both are left alone.
  //
  // KNOWN LIMIT, stated where a CI reader sees it rather than only in a plan: the
  // regex requires the message to sit on ONE line, so an assertion whose message
  // is built by concatenation across lines is invisible to this scan. REQUIRED
  // below is what stops that from degrading silently — it names the assertions
  // this rule was measured against, so losing one reds by name instead of just
  // lowering a count.
  it('every wide floor assertion in this file reports the value it measured', () => {
    const SELF = readFileSync(path.join(here, 'deviation-refs.test.ts'), 'utf8');
    const FLOOR = /expect\(\s*([^,\n]+?),\s*(['"`])([^\n]*?)\2\s*\)\s*\.toBeGreaterThan(?:OrEqual)?\(\s*(\d+)\s*\)/g;
    const wide = [...SELF.matchAll(FLOOR)].filter((m) => Number(m[4]) >= 2);
    const seen = wide.map((m) => `${m[1]!.trim()} >= ${m[4]}`);
    const REQUIRED = [
      'es.length >= 100',
      'new Set(es.map((e) => e.file)).size >= 8',
      'highWater >= 215',
      'here.length >= 50',
      'there.length >= 50',
      'definitionsIn(here).length >= 300',
      'definitionsIn(there).length >= 300',
    ];
    // The premise, established rather than assumed: a scan that had drifted off
    // its own file would find nothing and every assertion below it would hold.
    expect(REQUIRED.filter((r) => !seen.includes(r)),
      `this scan no longer sees assertions it was written for; it found: ${seen.join(' | ')}`)
      .toEqual([]);
    const mute = wide
      .filter((m) => !m[3]!.includes('${' + m[1]!.trim() + '}'))
      .map((m) => `${m[1]!.trim()} >= ${m[4]} :: ${m[3]}`);
    expect(mute,
      'a floor assertion states a condition it does not isolate — put the measured value in the message')
      .toEqual([]);
  });
```
- [ ] **Step 2: Run it and watch it fail**
Run: `cd server && ./node_modules/.bin/vitest run test/deviation-refs.test.ts -t "reports the value it measured"`
Expected: FAIL — the premise assertion passes (all seven REQUIRED entries are present at HEAD; measured
by running this exact regex over the file in python3 on 2026-09-02), and the second reds:
`AssertionError: a floor assertion states a condition it does not isolate — put the measured value in the message: expected [ 'es.length >= 100 :: ledger entries scanned', 'new Set(es.map((e) => e.file)).size >= 8 :: plans scanned', 'highWater >= 215 :: the definition-derived high-water went vacuous', 'here.length >= 50 :: no plans read from HEAD', 'there.length >= 50 :: no plans read from ${LEDGER_BASE}', 'definitionsIn(here).length >= 300 :: HEAD holds no ledger entries', 'definitionsIn(there).length >= 300 :: the base holds no ledger entries' ] to deeply equal []`
(Seven, in that order — source order — measured 2026-09-02.)

- [ ] **Step 3: Implement** — all seven, plus the `c.files` comment's undated cardinal, plus the two
sweep comments.

`server/test/deviation-refs.test.ts:78-79`:
```ts
    expect(es.length, `only ${es.length} ledger entries scanned`).toBeGreaterThanOrEqual(100);
    expect(new Set(es.map((e) => e.file)).size,
      `only ${new Set(es.map((e) => e.file)).size} plans scanned`).toBeGreaterThanOrEqual(8);
```
`:144`:
```ts
    expect(highWater,
      `the definition-derived high-water is ${highWater} — too low to be this tree's ledger`)
      .toBeGreaterThanOrEqual(215);
```
`:333-336`:
```ts
    expect(here.length, `only ${here.length} plans read from HEAD`).toBeGreaterThanOrEqual(50);
    expect(there.length,
      `only ${there.length} plans read from ${LEDGER_BASE}`).toBeGreaterThanOrEqual(50);
    expect(definitionsIn(here).length,
      `HEAD holds only ${definitionsIn(here).length} ledger entries`).toBeGreaterThanOrEqual(300);
    expect(definitionsIn(there).length,
      `the base holds only ${definitionsIn(there).length} ledger entries`).toBeGreaterThanOrEqual(300);
```
`:206-213` — move the cardinal into the derived message, which is where it cannot go stale:
```ts
  it('is looking at the real tree — guards the guard', async () => {
    // The floor has margin so ordinary growth or pruning never touches it, while
    // a broken walk (a wrong cwd, a filter eating everything) reds loudly and
    // specifically instead of letting the tree scan above pass over nothing. The
    // count that used to sit in this comment — "707 tracked files measured at
    // reconciliation" — is now in the message, where it is derived rather than
    // remembered: the walk read 822 when this was changed, so a reader checking
    // "the floor has margin" against 707 was computing 15% where the true figure
    // was 27%.
    const c = await load();
    expect(c.files, `only ${c.files} tracked files walked — the corpus walk is broken`)
      .toBeGreaterThan(600);
  });
```
(This adds an eighth wide floor assertion, non-mute; it is deliberately NOT in `REQUIRED`, which names
the seven the rule was measured against.)

`server/test/ledger-sweep.test.ts:189-191` — prose only; the fixture is synthetic (`demo`, D-261/299),
so nothing this suite asserts changes:
```ts
    // The inverse of markLanded, and the half nothing has ever measured. The
    // live shape on main is an allocator-era number that a merged plan defines
    // and the allocator never issued — D-1066 in
    // 2026-08-30-d1066-dead-recipient-parks.md, D-1067..1069 in
    // 2026-08-30-d1067-d1068-delivered-row-terms.md, and more since. The comment
    // that stood here put all four of those numbers in the first file, which
    // defines only D-1066, and no suite can pin either the set or its size: it
    // is read from the live coord.db (D-1435).
```
`:224-226` — the property only; the size is NOT restated here, because a cardinal restated in a second
place is D-1331's own recorded defect:
```ts
    // The live case it protects is on main right now — the same NON-EMPTY orphan
    // set the REPORTS test above describes — so without the dedupe every
    // ccrc-server on the fleet logs that line every 15 minutes, forever. The
    // enumeration this comment used to carry named four and was already wrong
    // when it was read back nine days later; the property is what the guard
    // needs.
```
- [ ] **Step 4: Run it and watch it pass**
Run: `cd server && ./node_modules/.bin/vitest run test/deviation-refs.test.ts` and
`cd server && ./node_modules/.bin/vitest run test/ledger-sweep.test.ts`.

**Assert the DELTA, not an absolute.** Record each suite's count immediately BEFORE this task's
edit and immediately after: `deviation-refs` gains **+1**, `ledger-sweep` gains **0** (this task's
sweep edits are comments). An absolute is wrong here and was wrong in the draft, which predicted
`ledger-sweep` **15** — its HEAD count. By the time item 5 runs, Tasks 46 and 47 have added five
cases to that file, so the number is 20 and would have been 20 whatever this task did. Measured at
HEAD `5e9f650d` on 2026-09-02: `deviation-refs` **26**, `ledger-sweep` **15**, `ledger-crosstree`
**30** — provenance for the deltas, not values to assert after four items have landed.
- [ ] **Step 5: MUTATION CHECK** — revert `:333` alone to
`expect(here.length, 'no plans read from HEAD').toBeGreaterThanOrEqual(50);`. Expect RED:
`AssertionError: a floor assertion states a condition it does not isolate — put the measured value in the message: expected [ 'here.length >= 50 :: no plans read from HEAD' ] to deeply equal []`.
Right reason, and provably not another one: the premise assertion above it stays green (the expression
and the floor are untouched, so `here.length >= 50` is still in `seen`), and the reverted assertion
itself is still green (67 >= 50) — so the only thing red is the message being a claim the assertion
does not isolate. Revert.
- [ ] **Step 6: Commit**
```bash
git add server/test/deviation-refs.test.ts server/test/ledger-sweep.test.ts && git commit -m "fix(wave8): seven floor messages that state a condition they do not isolate, and the sweep's wrong-plan attribution (D-1434, D-1435)"
```
LEDGER (D-1434): seven messaged floor assertions in `deviation-refs.test.ts` state a
condition their assertion does not isolate (`'no plans read from HEAD'` reds for 1..49 as well as 0,
with 67 plans measured against a floor of 50), and a self-scan now requires every messaged floor
assertion in that file with an integer floor >= 2 to interpolate the expression it asserts on, with the
seven it was measured against named so the scan cannot silently stop seeing one; floors of 0 and
comparisons against another measured quantity are exempt because their messages are already exact in
every failing state, and the single-line-message limit is stated in the failure path rather than only
in a plan.
LEDGER (D-1435): `ledger-sweep.test.ts:190-191` attributed D-1067/1068/1069 to
`2026-08-30-d1066-dead-recipient-parks.md`, which defines only D-1066 (the other three are in
`2026-08-30-d1067-d1068-delivered-row-terms.md`), and both that comment and its sibling at `:224-226`
named the orphan set in the present tense as four when it is six — the enumeration is replaced by the
property in the first and dropped entirely from the second, since no suite can pin a live-`coord.db`
fact and a cardinal restated in a second place is D-1331's defect.

---

### Task 84: the wave-7 plan's ten stale figures at eleven sites, and the one movable cardinal still in shipped source

**Files:**
- Modify: `docs/superpowers/plans/2026-09-02-program-leverage-wave7-f7.md` (1870 lines at HEAD) — lines
  `1024-1025`, `1026-1028`, `1029-1031`, `1152-1153`, `1189`, `1211-1213`, `1397-1401`, `1423-1425`,
  `1434-1436`, `1572-1582`, `1604`, `1676-1677`, `1696-1699`, `1841`. **Every range was re-opened at
  HEAD and each ends on a sentence boundary** — four of them were half-sentences in the previous draft
  and are corrected here.
- Modify: `server/src/coord/ledger.ts:341-346` — the `projectEra` docstring paragraph whose third line
  (`:343`) reads `It was true when written and there are six today, because two merged plans`.
- Test: none, and the absence is the finding — see Step 5.

**Interfaces:**
- Consumes: nothing.
- Produces: nothing on any wire.

**Why:** Ten counts/ranges in the wave-7 plan are stale at HEAD, at eleven sites, not the seven the
brief names. Re-measured 2026-09-02 against the live allocator
(`~/.local/bin/ccrc-api ledger list --project ccrc-pwa`, a read-only GET) and the 67-plan corpus:
**270** allocation rows, not 243 (C11, stated at two sites); **74** allocation batches, not 65 (C12);
**six** orphans, not four (C8, C9, and the hedge C10); **four** sub-211 collisions, not six (E1 — the
retraction D-1310 applied in two plan entries and not here); the final-round section spans
**D-1326..D-1332**, not D-1326..D-1331 (C6, C7); and two undated total pairs, 394/388 at E9a and
394/388-plus-405/399 at E9b, which read **421/415** today. Three further defects of other classes are
fixed in the same act because leaving them is D-1326's shape: `:1604` repeats the "write every entry"
claim Task 82 fixes in the test file; `:1189` carries a `shared/api.ts:5443` anchor that went stale
inside this wave's own merge (`LEDGER_SEED_GAP` is at `shared/api.ts:5598` at HEAD, and
`sed -n '5443p' shared/api.ts` reads `* written by the closer (…)`); and `:1841`'s mutation-table row
describes a mutation nobody can apply, because `LEDGER_BOOTSTRAP` has no definition anywhere in the tree
(`git grep -n LEDGER_BOOTSTRAP` returns one docstring at `ledger.ts:326` narrating its retirement plus
four plan lines, and zero constants) and the assertion string it quotes appears in no test file.
And the one MOVABLE CARDINAL still standing in shipped source is `ledger.ts:343`'s "there are six
today" — the very sentence D-1332 was allocated to fix, whose replacement then named a count of its own.
It is measured from a live `coord.db` that no suite may open; it moved from four to six in nine days; it
goes, and the dated snapshot moves into this document. That is the program's own standard: a cardinal
may stay in shipped source only if it cannot move.

**Two crosscheck corrections this task MUST honour, or it replaces a true fact with a vaguer one:**
1. **C6's "in one act of six" is TRUE.** The allocator shows D-1326..D-1331 all carrying `allocatedAt`
   `1788347619644` (2026-09-02T11:13:39.644Z) under one title, and D-1332 at `1788349510260`
   (11:45:10.260Z) under another. Widen the RANGE and keep the act structure. Do not delete a measured
   fact as if it were stale.
2. **E9's "delta 27" is NOT stale.** Re-measured at HEAD today it is exactly 27. Only the TOTALS moved.
   Date the totals; keep the deltas, and say why they survived: 6, 18, 24 and 27 are properties of a
   regex pair, while 394/405/421 are properties of a corpus that grows with every merge.

- [ ] **Step 1: Re-measure every figure before editing** (this task has no test, so the measurement IS
the step)
```bash
cd "$(git rev-parse --show-toplevel)"
S="$(mktemp -t ccrc-wave8-alloc.XXXXXX.json)"
# (1) allocator: rows, era, empty holders, batches
~/.local/bin/ccrc-api ledger list --project ccrc-pwa > $S
python3 - "$S" <<'PY'
import json, collections, sys
d=json.load(open(sys.argv[1])); rows=d['allocations']
print('floor', d['floor'], '(re-read at allocation time; never quote this)')
print('rows', len(rows), 'MIN(n)', min(r['n'] for r in rows), 'MAX(n)', max(r['n'] for r in rows))
print('allocatedTo empty:', sum(1 for r in rows if r['allocatedTo']==''), 'of', len(rows))
byt=collections.defaultdict(list)
for r in rows: byt[r['title']].append(r)
sc=[t for t,rs in byt.items() if len({r['landedIn'] for r in rs if r['landedIn']})>1]
print('batches', len(byt), 'scattered', len(sc))
for n in (1326,1332):
    print(n, [r['allocatedAt'] for r in rows if r['n']==n])
PY
# (2) the plan's own entry range and count
P=docs/superpowers/plans/2026-09-02-program-leverage-wave7-f7.md
grep -nE '^- \*\*D-1[0-9]+\*\*' $P | tail -8
grep -cE '^- \*\*D-1[0-9]+\*\*' $P
# (3) the anchor
grep -n 'export const LEDGER_SEED_GAP' shared/api.ts
# (4) the mutation table's total (must stay 45 — it is a counted total and is true)
awk 'NR>=1805 && /^\|/' $P | wc -l     # 47 = 45 data rows + header + separator
# (5) the orphan set, from the tree rather than from memory
grep -rnE '^(#{2,4} |- \*\*|\*\*)D-(106[6-9]|1243|1244)\b' docs/superpowers/plans/
```
Values these commands produced on 2026-09-02 at `5e9f650d`: floor **1392** (it read 1333 and 1389
earlier the same day — this is exactly why no floor is written into any document below); **270** rows;
MIN(n) **274**; MAX(n) **1332**; **101 of 270** empty holders; **74** batches with **2** scattered
(`program-leverage: onboarding, trigger hardening, throughput (8 waves)` across 4 files, and
`program-leverage wave 6 (run 19) …` across 5); D-1326 `allocatedAt` **1788347619644** and D-1332
**1788349510260**; last entry D-1332 at plan `:1789` with **40** entries D-1293..D-1332;
`LEDGER_SEED_GAP` at `shared/api.ts:5598`; **47** pipe lines = **45** rows; and the six orphans
D-1066 / D-1067 / D-1068 / D-1069 / D-1243 / D-1244, with D-1067..1069 in
`2026-08-30-d1067-d1068-delivered-row-terms.md` and NOT in the D-1066 plan.

- [ ] **Step 2: Apply the fifteen edits — BOTTOM-UP, highest line number first**, so no earlier edit
shifts a later range. Each is `old range -> new text`; the eleven sites of the stale-count class are
marked ★. (Ten distinct figures, eleven sites: C11 is stated twice.)

★ **C10, `:1024-1025`** — a hedge, not a falsehood: it says "while this was written". It gains a date
and the later measurement, rather than being corrected as if it had been wrong.
```md
with no allocation row — unambiguous, because nobody asked for it. Live instance on `main` when this
was written (2026-09-02, morning): D-1066..1069; six by the end of the same day, D-1243 and D-1244
having merged. NOT reported, each rejected by measurement:
```
★ **C11 (first site), `:1026-1028`** — property plus one dated snapshot
```md
- *"allocated to its definer"*, the question as posed — it cannot be built. 101 allocator-era rows
  carry `allocatedTo: ''` (measured 2026-09-02, of 270 rows), because `byId` is optional and the
  coordinator's own documented call omits it (D-1301). The empty-holder population is CLOSED — they are
  historical build-4/8 reconciliation rows — but the denominator rises with every allocation, which is
  why only one of the two is a property and the pair is dated.
```
★ **C12, `:1029-1031`** — the load-bearing half is "exactly two"; the denominator is dated
```md
- *batch scatter* — exactly two batches are scattered (measured 2026-09-02, over 74), and one of them
  (D-999..D-1046) is a program block spent correctly across its own waves. Structurally identical to
  the theft, so scatter is an observation and never a defect.
```
★ **C7, `:1152-1153`**
```md
defined-but-not-allocated to this session.** (The fix rounds add D-1318..D-1325 and D-1326..D-1332;
each section below states its own range and act structure, taken from the allocator.)
```
**`:1189`** (anchor, not one of the eleven) — replace `` `shared/api.ts:5443` `` with
`` `shared/api.ts:5598` (it was 5443 when this was written and went stale inside this wave's own merge;
anchors in plans are snapshots) ``
★ **E1, `:1211-1213`**
```md
  rule a widened subject scan would have forced us to break (measured: widening the subject extraction
  surfaces four sub-211 collisions — D-73/142/143/144 — every one of which would have had to join that
  set. It read six until D-1310 found D-149 and D-172 are citations the shipped `DEFINITION` drops; the
  set is now DERIVED from the corpus by `deviation-refs.test.ts`, so it cannot go stale again).
```
★ **E9a (D-1310), `:1397-1401`** — the previous draft cut this paragraph mid-sentence at `:1399`; it
runs to `:1401` and the tail is carried through
```md
  lookahead for the four ways a real entry opens (`**`, ` —`, ` (`, `:`); measured over the scanned
  plans at the time, 394 prefix matches → 388 entry-shaped, and **all six dropped lines are citations**
  (D-149, D-171, D-172, D-291, D-292, D-1026). Re-measured 2026-09-02 at `5e9f650d` the same pairing
  reads 421 → 415: the totals moved with the corpus, the DROP is still exactly six and still the same
  six lines, which is why one figure is dated and the other is not. Both directions now pinned.
  Knock-on: two of the six sub-211 collisions this wave cited as evidence for the era scoping (D-149,
  D-172) were never collisions — they are these citations — so that argument rested on four data
  points, not six.
```
★ **C9, `:1423-1425`** — the previous draft cut this at `:1424`, orphaning "makes this an omission
rather than a policy."
```md
  deleting the condition left `ledger-sweep` 14/14. Without it the live orphan set — non-empty, and six
  numbers on 2026-09-02 — logs on every 15-minute sweep forever. Its mirror on the *stale* side has
  been pinned since D13, which is what makes this an omission rather than a policy. Both now have tests
  that red on the deletion.
```
★ **C8, `:1434-1436`**
```md
  this project's first ISSUED number is **274**, not 211 — so 211..273 were all hand-numbered and the
  bootstrap set was both too narrow and repo-specific — and the two forms report the **same orphan set,
  whatever it is at the time**. (It was four when this was written and six on the same evening, which
  is what D-1332 records; the count itself reads a live `coord.db` no suite may open, so wave 8 deleted
  it from `projectEra`'s docstring and left the property there and the dated snapshot here.) A project
  with no allocations reports nothing, because it has no era.
```
★ **E9b (D-1320), `:1572-1582`** — the previous draft started at `:1571`, which is the middle of the
entry's opening sentence, and duplicated the words that open `:1580`. The range here begins at `:1572`
("paragraph said …") and runs to the paragraph's end at `:1582`.
```md
  paragraph said *"394 prefix matches, 388 entry-shaped"* (measured over the corpus at the review's
  HEAD `ed81ad85`: 405 and 399) and *"this shape sees 29 definition lines `ENTRY` cannot"* — where 29
  is the **`DEFINED`** figure, the floor scan's lookahead-less pattern, i.e. the looser shape that
  paragraph exists to distinguish itself from; the true `DEFINITION`-not-`ENTRY` delta was 27. D-1310's
  knock-on correction applied to the other argument in the same docstring (six sub-211 collisions
  became four) and never to the 29. The same number is repeated in `ledger-crosstree.test.ts`'s header
  and at three places in this plan. **Independently re-measured before fixing** — the reviewer's HEAD
  figures reproduced exactly (405/399/375, delta 27); their `origin/main` figures are one lower than
  mine because main gained PR #44 in between. **Re-measured again on 2026-09-02 at `5e9f650d`: the
  three totals now read 421/415/391 and the delta is still exactly 27.** That is the finding, stated as
  a measurement rather than an aphorism: the totals are properties of a corpus that grows with every
  merge, the delta is a property of a regex pair, and only the second survived nine days — so the
  totals are dated and the delta is not. Fixed by removing every cardinal from that docstring and
  stating the delta as SHAPES with named exemplars, which is D-1294's own argument for a delta carried
  one step further: a delta still moves, a shape does not.
```
**`:1604`** (E5's plan copy of the claim Task 82 fixes in the test file; `:1603` ends "and no list")
```md
  bullet — how build 8 writes most of its entries, and how stage 2e, the worker-skill plan and
  upstream-launcher-locks write all of theirs —
```
★ **C11 (second site), `:1676-1677`** — the restated pair is deleted and cross-referenced, because a
cardinal restated in a second place is D-1331's own recorded defect
```md
The wave escalated one item: `byId` at `POST /api/ledger/deviations` is optional, the empty-holder
count reported above is what that produced, and hole (a) — *was this number allocated to its definer* —
```
★ **C6, `:1696-1699`** — widen the range, KEEP the act structure (allocator-verified), and carry the
`ledger.ts`-before-the-allocate sentence that the previous draft's `:1696-1697` cut in half
```md
Numbers **D-1326..D-1332**, allocated from `POST /api/ledger/deviations` with `byId` set: six in one
act (D-1326..D-1331, one `allocatedAt`), plus D-1332 in a separate act 31 minutes later during
self-review. **The refs for D-1326 and D-1327 were written into `ledger.ts` BEFORE the allocate call
returned** — the floor happened to be 1326 and nobody raced it, but that is luck, not the discipline,
and the discipline is the whole subject of this wave. Recorded rather than smoothed over.
```
**`:1841`** (E11) — mark the row SUPERSEDED in place; do NOT delete it (the table is landing-order
history) and do NOT renumber (45 is a counted total and is currently true, stated at `:1815`)
```md
| ~~empty `LEDGER_BOOTSTRAP`~~ **SUPERSEDED by D-1313**, which retired the constant — the mutation can no longer be applied and the quoted first-fail can no longer be produced (`LEDGER_BOOTSTRAP` has no definition in the tree; the assertion string appears in no test file). Kept because the table is landing-order history and D-1306's lesson — **came back GREEN first time**, reds only after the test was made to read the shipped constant — is load-bearing. The row that replaces it in practice is *hardcode the era back to 211 + a bootstrap set instead of `projectEra` (D-1313)*, already in this table. | `AssertionError: the bootstrap set is not 211..224 — it may only SHRINK, never move: expected [] to deeply equal [ 211, 212, 213, 214, 215, 216, …(8) ]` | server `ledger-crosstree` |
```
**`server/src/coord/ledger.ts:341-346`** — the movable cardinal leaves shipped source. Both existing
`D-N` refs are carried through, per CLAUDE.md's rule that source refs are authoritative history.
```ts
 * THE COUNT THAT USED TO SIT IN THAT SENTENCE — "the SAME four orphans
 * (D-1066..1069)" — WAS FALSIFIED BY THIS WAVE'S OWN NEXT MEASUREMENT (D-1332),
 * because two merged plans defined numbers the allocator never issued (D-1325).
 * ITS REPLACEMENT THEN NAMED A COUNT OF ITS OWN, and that one is gone too
 * (D-1436): this set is read from a live `coord.db` that
 * no suite may open, so nothing in this repo can pin it, and any number written
 * here is a snapshot waiting to go stale in a file whose subject is exactly
 * that. The property is what the sentence is for — the hardcoded pair and this
 * derivation report the SAME SET, whatever it is at the time. The dated snapshot
 * lives in the wave's plan, which is what a document is for (D-1328).
```

- [ ] **Step 3: Verify no stale figure survives, and that nothing protected was touched**
```bash
P=docs/superpowers/plans/2026-09-02-program-leverage-wave7-f7.md
# (a) every stale-figure sentinel must be GONE. 13 hits at 5e9f650d, 0 after.
grep -nF -e 'of 243' -e '65 batches' -e 'shared/api.ts:5443' \
         -e 'D-73/142/143/144/149/172' -e 'D-1326..D-1331' -e '**same four' \
         -e 'plans as 394 prefix matches' -e 'the corpus at HEAD: 405 and' \
         -e 'the live D-1066..1069 orphan set' -e 'write every entry' \
         -e 'empty `LEDGER_BOOTSTRAP` — **came back' $P
# (b) exactly TWO occurrences of the old orphan enumeration may remain, and both are legitimate:
#     the dated hedge in "What is reported…", and D-1332's own entry quoting the sentence it
#     retracts. Editing the second would delete a retraction's evidence.
grep -c 'D-1066\.\.1069' $P          # expect 2
grep -n  'D-1066\.\.1069' $P         # expect the hedge, and the line inside D-1332's entry
# (c) the movable cardinal is out of shipped source
grep -nF 'there are six today' server/src/coord/ledger.ts   # expect no output
# (d) the counted total is untouched
awk 'NR>=1805 && /^\|/' $P | wc -l   # still 47
```
- [ ] **Step 4: Confirm nothing else moved**
```bash
cd server && ./node_modules/.bin/vitest run test/deviation-refs.test.ts test/ledger-crosstree.test.ts test/ledger-sweep.test.ts
```
Expect 31 / 32 / 15. This is not a formality: the plan is a tracked file the floor scan reads and one of
the 67 plans the collision scans read, so a `D-`ref edited into a new spelling above the ledger
high-water would red `floorFromScan`, and a line accidentally written as a definition at column 0 would
red the cross-tree scan.
- [ ] **Step 5: MUTATION CHECK — not applicable, and the reason is the finding.** Every figure in this
task reads the live `~/.ccrc/coord.db` (which the server box owns and no suite may open) or a corpus
snapshot that moves on every merge; there is no mutation any suite can observe, and inventing a guard
that appeared to pin one would be this wave's own recurring class. That is precisely why the program's
standard says a cardinal like this may not live in shipped source, and why `ledger.ts:341-346`'s count
is DELETED here rather than corrected. **The one cardinal in this area that IS mechanised is the
sub-211 set, and it is mechanised in Task 82, not here.** Put this sentence in the commit body so the
next reviewer does not read the absent mutation check as an omission.
- [ ] **Step 6: Commit**
```bash
git add docs/superpowers/plans/2026-09-02-program-leverage-wave7-f7.md server/src/coord/ledger.ts && git commit -m "docs+fix(wave8): all TEN stale figures in the wave-7 plan, and the last movable cardinal out of ledger.ts (D-1437, D-1436)"
```
LEDGER (D-1437): the wave-7 plan carried TEN stale counts and ranges at ELEVEN
sites, not the seven the wave-8 brief named — 243 rows (270, twice), 65 batches (74), four orphans in
three places (six), six sub-211 collisions (four), D-1326..D-1331 for a section spanning D-1332 (twice),
and two undated total pairs (394/388 and 405/399, both now 421/415) — all eleven fixed in one act, with
the two figures the crosscheck proved still true (the delta 27, and "in one act of six") deliberately
KEPT and one anchor, one prose claim and one inapplicable mutation row fixed alongside, because fixing
seven of ten of one class is the shape D-1326 records.
LEDGER (D-1436): `projectEra`'s docstring, rewritten by D-1332 to remove a
falsified four-orphan enumeration, replaced it with a count of its own — "there are six today" at
`ledger.ts:343` — which reads a live `coord.db` no suite may open and had already moved from four to six
in nine days; the count is deleted from shipped source and the property kept, with the dated snapshot
moved into the wave plan, which is the treatment D-1328 ruled and the standard this program states.

---

### Open decisions for the coordinator

1. **D-1328's ruling says a count may live in the plan "where a dated snapshot is what a document is
   for", and `4810ddac` dated D-1322's pair with both shas.** Task 84 applies that treatment to
   D-1310's and D-1320's totals — it DATES them and adds today's re-measurement rather than deleting
   them, because they are historical records of what a review measured. A coordinator may prefer
   deletion. Correcting them to today's numbers without a date just restarts the staleness clock, which
   is the one option Task 84 does not take.
2. **`ledger.ts:343`'s "there are six today" is DELETED from shipped source, not dated.** An argument
   exists for keeping it dated, the way `4810ddac` treated D-1322 — but `ledger.ts` is shipped source
   and its own subject is stale cardinals, so it was ruled the other way. Worth a confirmation; it is
   the one edit in this section that changes a source file for prose reasons alone.
3. **A real defect in this area was deliberately left, because it is a ratchet question.**
   `GRANDFATHERED`'s stated rule is that every member must still collide, and D-171's only second
   "definition" (`2026-08-23-stage5-oss-polish.md:46`) is a line the shipped `DEFINITION` correctly
   drops as a citation — so the ratchet passes because the two scans disagree, not because the premise
   holds. Shrinking a set whose own rule says it may only shrink changes what the collision scan will
   accept in future, so it wants an operator ruling rather than a worker's judgement.
4. **Task 83's sweep-comment edits are PROSE-ONLY** (`ledger-sweep.test.ts:189-191`, `:224-226`): the
   fixtures use a synthetic `demo` project and synthetic numbers, so nothing the suite asserts depends
   on them. If the coordinator wants only behaviour-affecting fixes this wave, those two drop out — but
   they are the only place a reader learns what the guard is for, and the brief treats them as carries.
5. **Task 83's self-scan creates a standing constraint on one file.** Every messaged floor assertion
   added to `deviation-refs.test.ts` from now on, by any later wave, must interpolate its expression
   when the floor is an integer >= 2, and a multi-line message escapes the scan — both stated in the
   test itself rather than hidden. If a wider rule is wanted (all three ledger suites, or all test
   files), that is a bigger change than "one commit, measured" and should be its own item.
6. **Task 84 changes the plan's `:1189` anchor** from `shared/api.ts:5443` to `:5598`. The project
   convention says "anchors in plans are snapshots", which partly licenses leaving it — but this one
   went stale inside the wave's own merge (it was correct at `651f40c5`, the base the plan names), so it
   is corrected and labelled as a snapshot. A coordinator reading the convention strictly may prefer it
   left alone with a note.

### Explicitly out of scope, and why

- **The full server suite run.** No vitest was run while planning. The 250 files / 6348 passed / 56
  skipped baseline is inherited from the F8 report and its crosscheck (both dated 2026-09-02 at
  `5e9f650d`); the per-suite figures in each task were derived by counting `it` blocks and
  `describe.each` rows at HEAD, which is a measurement, and each task's Step 4 states the expected count
  so a mismatch is visible.
- **Any change to the FENCE fix beyond the narrowing.** The >= 4-space direction is inert because
  `DEFINITION` is anchored at column 0, so no rule is needed there, and widening to `\s*` would be the
  wrong direction entirely.
- **The wave-7 plan's review-process cardinals** ("eighteen agents", "25 agents", "nine lenses", "Mail
  194/196", "twenty-one real shapes classified by hand", "the shipped pattern getting six wrong"). No
  artefact in the tree records them; they are unverifiable from this worktree, so they are neither
  fixed nor endorsed.
- **"PR #44 brings eleven cases"** (plan Execution record). Verifying it needs a suite run at
  `651f40c5` and at its parent. The arithmetic chain it sits in (6332 + 11 = 6343, + 5 = 6348)
  reconciles against the inherited 6348, so it is consistent but not measured, and it is left alone.
- **Mechanising C8-C12 and the sweep comments.** They read the live `~/.ccrc/coord.db` on the server
  box; no suite may open it, so no guard is possible and none was invented. The remedy is D-1328's:
  delete from shipped source, date in the document.

## Deviations found

**Allocated and defined in one act, from the live allocator, on 2026-09-02.**
`~/.local/bin/ccrc-api ledger allocate --json -` with `count: 42` and `byId: ccrc-pwa-quiet-meadow`
answered `D-1396`-`D-1437` and moved the floor to **1438**. The floor was read from that answer, never
from a document: on 2026-09-02 alone it read 1333, 1389, 1392, 1396 and then 1438, which is why no
range is quoted anywhere else in this plan.

**These entries are the definitions, and this is the only place they are defined.** The `LEDGER` line
inside each task states the same finding in that task's own words and REFERENCES the number; it does
not define it. The shipped `DEFINITION` regex reads the shape below (`- **D-N** ...`) and nothing
else, so this section is the one place the sweep can land a number.

A note on why they were allocated before execution rather than task by task, recorded rather than
smoothed over. The drafted plan carried `D-TBD-<slug>` markers throughout, on the reasoning that a
number written into a document before it is allocated is precisely this program's recorded failure.
`server/test/dtbd.test.ts` refused that: a CONCRETE `D-TBD-` placeholder in a tracked file is a red
diff by design, because the placeholder means *the allocator was unreachable and this session
stopped* - an outage marker, not a drafting convention (build 9 D13, root cause bb47c9e). The
allocator was reachable. So the numbers were taken in one call and every definition written in the
same act, which is the rule the markers were trying to honour by another route. The guard was right
and the draft was wrong.

- **D-1396** (Task 1): the agent's `stat` op answered every errno — EACCES, ENOTDIR, ELOOP, EIO — as
  `{missing:true}`, the wire's proven-absence marker, so `remote/io.ts` reported "not there" for paths it had
  merely failed to measure; closed by a positive `absent?: true` beside an untouched `missing:true`, read in
  exactly one place (`statMeasured`), omission failing shut.
- **D-1397** (Task 2): the ENOENT→`absent` ternary was about to exist in three copies inside
  `server/src/io.ts`; `failureFor` makes it one, and one mutation of it now reds both measured readers.
- **D-1398** (Task 3): the `backlog` frame's `missing` was derived from a collapsed `io.stat`, so a transcript
  the server merely could not measure rendered as "Can't find this session's transcript"; `fileMeasured`
  reports the difference the way `searchComplete` already does on the readdir side.
- **D-1399** (Task 3): `sessionws.ts` and `readBacklog` stat'd the same transcript path a moment apart and
  could disagree; one measured stat now serves both.
- **D-1400** (Task 5): `readBranchTip`'s fail-shut proof stat treated "could not measure" as "no loose ref",
  so a stale `packed-refs` tip could settle a wave close; only a PROVEN absence now falls through.
- **D-1401** (Task 6): the agent capped `readB64` at 12 MB and folded over-cap into the same null as missing,
  while `localIO` had no cap and `ccd clip` files images of any size — the same clip served 200 locally and
  404 remotely; over-cap is now REPORTED (`tooLarge` + `size`) and never equalised.
- **D-1402** (Task 8): `GET /api/sessions/:id/clip/:name` turned six conditions into one HTTP 404, asserting
  non-existence for an over-cap clip and a disconnected agent; now 404 / 413 / 502 by what was measured.
- **D-1403** (Task 8): an unreadable transcript body returned an empty backlog with a real offset, rendering
  as an empty chat with no signal; it now reports `measured: false`.
- **D-1404** (Task 20): `single-definition.test.ts` forbade a second hand-written copy of the
  deliberate-cancel pair (D-1319) and of the work-item terminal trio but had never mentioned the delivery
  pair; two scans were added rather than one — the SQL scan here, the JS-disjunction scan in Task 21, both
  under this number — because the SQL-list copy and the JS-disjunction copy do not look alike and a regex
  loose enough to catch both would fire on prose — and the SQL scan's anti-vacuity floor is counted over
  comment-stripped source, because the same task rewrites seven docstrings into the shape it counts.
- **D-1405** (Task 20): The delivery terminal pair had no single definition: spelled six times in `store.ts`'s
  SQL, seven more in its docstrings, and once more as a JS disjunction in `pwa/src/session/MailStrip.tsx`;
  minted `TERMINAL_DELIVERY_STATES` in L0 `shared/api.ts` (not beside `TERMINAL_ITEM_STATES` in `store.ts`,
  because the client copy is in another package) and built `TERMINAL_DELIVERY_SQL` from it by the same `.join`
  interpolation `CoordStore.TERMINAL_SQL` uses.
- **D-1406** (Task 20): the positive-form guard (`state IN ('queued','delivered')`) and the negative-form
  guard (`state NOT IN TERMINAL_DELIVERY_SQL`) disagree about a token in neither list: such a row is
  not-outstanding to `dueDeliveries` and the three positive-form writers but LIVE to every negative-form
  writer and to `markAcked`, making the ack route the sole path that can reach it after a deploy rollback;
  behaviour deliberately unchanged by this wave and recorded undecided.
- **D-1407** (Task 22): `cancelOutstandingDeliveries`' positive-form guard was present and correct but
  measured green under deletion: all 14 of its test references used it as the fixture that parks a queued row,
  and none asserted that an acked or differently-parked row survives it; closed with a three-row test carrying
  its own live-row positive control.
- **D-1408** (Task 23): `noteGate` shipped with its terminality guard on 2026-08-28 (`9f805510`) and with
  nothing that measures it: every `noteGate` call in the suite (`mail-sweep.test.ts` 2145/2167/2168/
  2173/2188) is on a fresh queued row, so deleting the guard left the whole suite green on the single writer
  of every `MailGate` member.
- **D-1409** (Task 24): `setDeliveryEnvelope` was the last delivery-row writer with a bare `WHERE id = ?`; the
  guard is a no-op on every reachable path (both call sites run inside the same `tx()` as the `queueDelivery`
  that created the row) and was added anyway to remove the audit's one exception — and its return was widened
  in the same act, because adding a guard while keeping `: void` would have recreated the caller-invisible
  refusal this wave was closing everywhere else.
- **D-1410** (Task 25): `markAcked` returned a bare boolean that `routes.ts` turned into `{ ok: true, already:
  !landed }`, so ALREADY-ACKED and PARKED were indistinguishable in the 200 body — and worker-skill clause 3
  is "Ack before you act", so a worker whose brief was parked read `already: true` as confirmation and
  proceeded on an abandoned brief; `markAcked` now answers a union, its terminality test moved into the
  UPDATE's own `WHERE` (closing the read-then-write window), and the route carries a positive `parked` marker
  plus the park's own `lastError`.
- **D-1411** (Task 26): `CLAUDE.md:195`'s "some writers lack the guard" was literally true and uselessly
  vague: added 2026-08-12 (`49df54a9`) and never reworded while three separate guard commits landed after it;
  rewritten and dated the way `4810ddac` dated the two surviving counts, and backed by two mechanisms over
  `store.ts` — a writer scan asserting every delivery-row `UPDATE` names a shared guard fragment, and a census
  asserting the sentence's own list of `void`-returning writers is the one the source actually has.
- **D-1412** (Task 26): `markDelivered`, `markIngested`, `backOff`, `noteGate`, `rejectDelivery`,
  `cancelKickoffsTo`, `repointCoordinatorMail` and `cancelOutstandingDeliveries` still return `void`, so their
  guards are invisible to the caller — deferred out of this wave because it changes eight signatures and every
  `watch.ts` call site in `sweepMail`; the one live consequence is recorded: `watch.ts:2733` calls
  `markDelivered`, then branches at `:2739` on its OWN pre-call `d.deliveredAt` snapshot, so a skipped write
  is caught only by `bumpReplayCount`'s union at `:2744` — one method's silence covered by a second method's
  union.
- **D-1413** (Task 40): `ccrc-api whoami` gated on nothing, so a caller with no pane got the MOST RECENTLY
  ACTIVE session's id and uuid with exit 0 (measured three times on the fleet host on 2026-09-02, a different
  session each time), and its refusal detail `'not inside a tmux session'` was itself false on any box running
  a tmux server; it now gates on `TMUX_PANE`, validates the pane id — because `-t` accepts a session NAME and
  would otherwise be a forgery door — and passes the pane as an explicit target.
- **D-1414** (Task 41): at least 101 ccrc-pwa allocations carry `allocatedTo: ''` (measured 2026-09-02; a
  floor, since nothing UPDATEs that column and the append-only log has already recorded each) because the
  route stores `byId ?? ''`, so an omitted field and an explicit empty string reach one column — and the
  client sent an unattributed body without complaint. (The DOCUMENTED body's own omission, which is where
  callers learned to omit it, is `D-1415`'s; the skill identity blocks are `D-1416`'. This number is the
  client's silence.) The client now fills the allocate body from the pane, refuses a present-but-blank `byId`,
  refuses to send an unattributed body at all, and offers `--by <id>` on that row alone as the door
  `CONTRIBUTING.md` and `auth/gate.ts`'s EXEMPT entry both require for a caller with no pane.
- **D-1415** (Task 42): the only documented allocate body in either skill corpus omitted `byId`, which is
  where the empty holders came from; it now carries `"byId":"$id"` in the spelling the claim fence in the same
  file already uses, pinned by proximity so dropping it reds while the claims-fence pin stays green.
- **D-1416** (Task 43): both skills taught a byte-identical unchecked tmux+cat derivation with no exit-status
  or existence check (coordinator `SKILL.md:46-49`, worker `:29-32`, `diff` empty) — the path that produced
  the empty holders, and the one measured to name another session for a caller with no pane; both blocks, and
  the worker's verbatim-pinned clause 1 plus the test comment that described it, now derive through `ccrc-api
  whoami`, which refuses instead of guessing.
- **D-1417** (Task 42): `peer-protocol.md:48`'s `body="${resp%$'\n'*}"` was a curl-era leftover assigning from
  a variable nothing in either corpus sets, so a coordinator copying that fence overwrote the whole claims
  response — including the 409 address the section teaches reading — with an empty expansion; deleted and
  pinned.
- **D-1418** (Task 44): root `CLAUDE.md`'s deviation-ledger bullet never said what the floor IS and made four
  measured-false claims in the process (read the floor from POST while citing an entry that records it being
  read with GET; a build-scoped series that "runs alongside" when zero bare legacy refs survive in tracked
  text; "source runs ahead of the plans' ledgers" when a shipped guard now reds on exactly that; and "three
  incidents" beside an enumeration of two, with the tree counting the class differently elsewhere) — rewritten
  to say a number is ISSUED, that the floor only ever rises, and that a number written without being issued
  seals its own band, with an anchored guard and no cardinal that can move.
- **D-1419** (Task 45): `2026-08-21-account-provisioning-design.md` §14 was still instructing, in the
  imperative present, that the next free number be read from `origin/main` at plan-writing time — the
  procedure that caused the renumber the same paragraph records, and the one passage in the live-instruction
  set that a compiled scanner still matched at HEAD; corrected in place with the incident kept, and
  `CONTRIBUTING.md`'s matching take-a-number framing and undercounted renumber cardinal, plus two stale
  comments in `deviation-refs.test.ts`, corrected with it.
- **D-1420** (Task 46): the reconcile sweep applied two different notions of "this plan carries D-N" to the
  same corpus eleven lines apart (a bare `\bD-<n>\b` over the whole file text for landing, the definition
  shape for orphans), and on 2026-09-02 a blockquote citing an allocation range terminally stamped two numbers
  `landed` against a plan that defines neither and sits on no merged ref; both halves now share
  `definitionsIn`, computed once.
- **D-1421** (Task 46): two existing reconcile cases (the word-boundary case and the own-clock case) planted a
  BARE MENTION, so under the corrected matcher each would have passed with its own mechanism deleted; both
  fixtures now plant a real definition, which is the only shape that can reach the behaviour they claim to
  measure, and each carries the mutation that proves it.
- **D-1422** (Task 47): four shipped-source sites claimed `landed` means merged, while `readLedgerDocs` reads
  the main checkout's working tree through `FleetIO` with no git anywhere and synthesises `landedIn` from a
  readdir entry — and `shared/api.ts` contradicted itself six lines apart; all four now say what is measured,
  and `store.ts`'s copy is moved off `ledgerProjects`, which it had drifted onto, and given to `markLanded`,
  which had no docstring at all. (The sweep suite's own header was checked and makes no such claim, so it is
  not a site.)
- **D-1423** (Task 47): `sweepLedgerFloor` seeds from the same branch-dependent working tree and the floor
  only ever rises, so an unmerged plan raised this project's floor above the highest number ever issued
  (measured 2026-09-02) — the matcher is deliberately NOT changed and the docstring now argues why: a
  conservative floor burns numbers, which is waste, where reconcile's looseness wrote a false fact into a
  terminal column.
- **D-1424** (Task 48): a `user_version` 7→8 migration un-lands exactly the rows whose recorded landing names
  the file the citation stamped, because `markLanded`'s terminal WHERE clause means the corrected sweep would
  otherwise never re-decide them — keyed on the path rather than on a number list, which is provably safe
  because that file defines 18 numbers of which the allocator issued none, so no correctly-landed row can name
  it.
- **D-1425** (Task 61): `reclaimProgram` moved only OUTSTANDING role-addressed mail (arm (c),
  `OUTSTANDING_STATES_SQL` at `store.ts:764`), so a wave-done report that had already parked `undeliverable`
  against the dead coordinator stayed readable at `outstandingMailFor(<corpse>)` and nowhere else, falsifying
  the heir-facing promise `ccd/coordinator-skill/references/resume.md:107-108` ships; closed by a fifth arm
  that queues the heir a NEW delivery for exactly the parks the corpse's own mailbox was showing — deduped by
  `GROUP BY m.id` and by a `NOT EXISTS` on the heir's own outstanding rows, because this is the tree's first
  writer of a second delivery for one mail (inherited scope: D-1141/D-1142/D-1143 and the "deliberately NOT
  fixed" note at `docs/superpowers/plans/2026-08-31-program-leverage-wave5-f5.md:6382-6388`, which carries no
  number of its own).
- **D-1426** (Task 61): `setDeliveryEnvelope`'s docstring (`server/src/coord/store.ts:2047-2048`) said it is
  "used by the ingress route ONLY" while `server/src/coord/rundefs.ts:202`'s system-mail queue had been
  calling it too; corrected and pinned by a test that derives the caller set from the tree rather than reading
  the sentence.
- **D-1427** (Task 64): `ccd/ccrc-api`'s closed-surface bullet and its ROUTES-table header both said
  "seventeen rows" while the table held eighteen, and `server/test/ccrc-api.test.ts:159` pinned eighteen but
  stayed green because no test read the client's prose; corrected, and both prose sites are now checked
  against a count derived from the table.
- **D-1428** (Task 64): `ccd/ccrc-api`'s ROUTES-table header claimed its rows are re-derived from both skill
  corpora by "Task 5's standing test", a mechanism that does not exist: the only route parity in the tree
  (`server/test/coordinator-skill.test.ts:174-198`) compares the COORDINATOR corpus against
  `server/src/coord/routes.ts` and never this table, and `worker-skill.test.ts` has no route parity at all — a
  comment claiming a guard it does not have.
- **D-1429** (Task 64): wave 8's brief is headed "THE THREE INHERITED" and names two; the third was never
  described, so it is recorded as an open question to the coordinator with three evidenced candidates rather
  than guessed at, and no work was scheduled against it.
- **D-1430** (Task 80): `FENCE`'s `\s{0,3}` admitted a TAB where CommonMark reads four columns of indented
  code, and the defect ran in BOTH directions — a tab-indented pair HID a real entry between two delimiters
  that do not exist, and a single tab-indented run CLOSED a real fence early and handed the whole-file
  fail-loud arm a quotation to report as a definition, printing "renumber NOW" at a quoted line; narrowed to
  `^ {0,3}`, which also makes the sentence beside it true, with zero corpus lines affected (5540 fence-shaped
  lines over 67 plans, 0 divergence, measured 2026-09-02 at `5e9f650d`).
- **D-1431** (Task 81): D-1329's retraction of the "build 9b spells its entries with a colon and no em-dash"
  exemplar reached `server/src/coord/ledger.ts` only, so at `5e9f650d` `deviation-refs.test.ts:118` and
  `ledger-crosstree.test.ts:45` still asserted the refuted claim while the same file's corpus row pinned the
  em-dash spelling and passed — both sites now name the measured exemplar (`2026-08-23-stage5-oss-polish.md`:
  15 ENTRY-blind colon entries against build 9b's 0) behind a split-spelled marker a new guard reads out of
  the source and checks against the corpus.
- **D-1432** (Task 82): four provenance claims in `ledger-crosstree.test.ts` were false — a blanket "every
  shape below is copied from a real plan" the file itself refutes in its own nesting paragraph, a "copied
  verbatim from origin/main" for three strings absent from all 129 tracked docs, a "copied from a real plan"
  for three of four, and "four plans open EVERY entry this way" when build 8 opens 9 of its 14 that way — all
  four sentences now state abridgement honestly and point at the corpus table, which gained two rows so the
  pointer is true of the fixtures that have a real line.
- **D-1433** (Task 82): the era-scoping argument's "six sub-211 collisions (D-73/142/143/144/149/172)"
  survived at `ledger-crosstree.test.ts:278-280` after D-1310 retracted D-149 and D-172 in two plan entries —
  measured, the shipped `DEFINITION` derives FOUR and only the pre-lookahead prefix derives six, and the set
  is now DERIVED from the corpus by a guard that reads the comment's own marker line, so it cannot go stale
  again.
- **D-1434** (Task 83): seven messaged floor assertions in `deviation-refs.test.ts` state a condition their
  assertion does not isolate (`'no plans read from HEAD'` reds for 1..49 as well as 0, with 67 plans measured
  against a floor of 50), and a self-scan now requires every messaged floor assertion in that file with an
  integer floor >= 2 to interpolate the expression it asserts on, with the seven it was measured against named
  so the scan cannot silently stop seeing one; floors of 0 and comparisons against another measured quantity
  are exempt because their messages are already exact in every failing state, and the single-line-message
  limit is stated in the failure path rather than only in a plan.
- **D-1435** (Task 83): `ledger-sweep.test.ts:190-191` attributed D-1067/1068/1069 to
  `2026-08-30-d1066-dead-recipient-parks.md`, which defines only D-1066 (the other three are in
  `2026-08-30-d1067-d1068-delivered-row-terms.md`), and both that comment and its sibling at `:224-226` named
  the orphan set in the present tense as four when it is six — the enumeration is replaced by the property in
  the first and dropped entirely from the second, since no suite can pin a live-`coord.db` fact and a cardinal
  restated in a second place is D-1331's defect.
- **D-1436** (Task 84): `projectEra`'s docstring, rewritten by D-1332 to remove a falsified four-orphan
  enumeration, replaced it with a count of its own — "there are six today" at `ledger.ts:343` — which reads a
  live `coord.db` no suite may open and had already moved from four to six in nine days; the count is deleted
  from shipped source and the property kept, with the dated snapshot moved into the wave plan, which is the
  treatment D-1328 ruled and the standard this program states.
- **D-1437** (Task 84): the wave-7 plan carried TEN stale counts and ranges at ELEVEN sites, not the seven the
  wave-8 brief named — 243 rows (270, twice), 65 batches (74), four orphans in three places (six), six sub-211
  collisions (four), D-1326..D-1331 for a section spanning D-1332 (twice), and two undated total pairs
  (394/388 and 405/399, both now 421/415) — all eleven fixed in one act, with the two figures the crosscheck
  proved still true (the delta 27, and "in one act of six") deliberately KEPT and one anchor, one prose claim
  and one inapplicable mutation row fixed alongside, because fixing seven of ten of one class is the shape
  D-1326 records.

Before the merge, both arms of the collision guard must be green:

    git fetch origin main
    cd server && ./node_modules/.bin/vitest run test/deviation-refs.test.ts test/dtbd.test.ts

A deviation discovered DURING execution is allocated from the same allocator at the moment it is
found and defined here in the same act - never predicted, never taken from this range.

---

## Execution record

### Baseline, measured before the first edit

At HEAD `5e9f650d` (= `origin/main`), worktree clean, **2026-09-02 18:03–18:10 UTC**:

| Package | Files | Tests | Duration |
|---|---|---|---|
| `server` | 250 passed | 6348 passed, 56 skipped | 291.37s |
| `agent` | 18 passed | 281 passed | 3.44s |
| `pwa` | 78 passed | 2120 passed, **no type errors** | 51.98s |

Any red beyond this baseline is this wave's. The known load flakes (`ccd-ws-gc`, `pr-sweep`,
`session-hook`, `typecheck-tests`, `ccd-session-state`) were all green in this run, so a later red in
one of them is re-run IN ISOLATION before it is called a break — and a single green isolated run is
not by itself proof it was the load.

### Mutation table

Filled AS THE WAVE RUNS, never afterwards from memory. One row per mutation, counted twice by
independent methods at the end.

| # | Task | Suite | Mutation | Verbatim first failure |
|---|---|---|---|---|
| | | | | |

**A row that comes back GREEN is a hole, not a pass.** So is a row that reds for the wrong reason —
an inert regex edit, or one that breaks compilation rather than the guard. Where a mutation cannot be
constructed, the row says so and says why, rather than being omitted.

### Commits

One commit per task, message naming the deviation numbers it defines.

| Task | Commit | Subject |
|---|---|---|
| | | |

### Deploy lane

**AGENT-FIRST.** Tasks 41–43 and 62–64 touch `ccd/ccrc-api`, `ccd/coordinator-skill/` and
`ccd/worker-skill/`; the fleet host takes those before the server lane does. **Deploy is not the
worker's act** — this wave lands the change and says so in the wave-done mail.

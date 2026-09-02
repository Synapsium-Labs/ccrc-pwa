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
- **Deviations:** allocated from `~/.local/bin/ccrc-api ledger allocate`, floor read from the
  allocator at the moment of allocation and **never from a document**, **allocated and defined in the
  same act**. Every entry below is a `D-TBD-<slug>` marker precisely so that no line in this plan can
  be read as a live definition before the executor allocates it. **No range is printed at the top of
  this plan**: on 2026-09-02 alone the ccrc-pwa floor read 1333, 1389, 1392 and 1396 on four reads —
  a standing range is a cardinal that goes stale within the hour, which is what D-1331 records.
  Before merge: `git fetch origin main` then `cd server && ./node_modules/.bin/vitest run
  test/deviation-refs.test.ts`.
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
entry, at the moment the entry is written into the plan's `## Deviations found

**Allocated and defined in one act, from the live allocator, on 2026-09-02.**
`~/.local/bin/ccrc-api ledger allocate --json -` with `count: 42` and `byId: ccrc-pwa-quiet-meadow`
answered `D-1396`-`D-1437` and moved the floor to **1438**. The floor was read from that answer, never
from a document: on 2026-09-02 alone it read 1333, 1389, 1392, 1396 and then 1438, which is why no
range is quoted anywhere else in this plan.

**These entries are the definitions.** The `**LEDGER:**` line inside each task states the same finding
in that task's own words and REFERENCES the number; it does not define it. `definitionsIn` reads the
shape below (`- **D-N** ...`) and nothing else, so this section is the one place the sweep can land a
number - which is also why every entry here carries its task, and why none of them is a bare mention.

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
- **D-1404** (Task 20): `single-definition.test.ts` forbade a second hand-written copy of the deliberate-
  cancel pair (D-1319) and of the work-item terminal trio but had never mentioned the delivery pair; two scans
  were added rather than one — the SQL scan here, the JS-disjunction scan in Task 21, both under this number —
  because the SQL-list copy and the JS-disjunction copy do not look alike and a regex loose enough to catch
  both would fire on prose — and the SQL scan's anti-vacuity floor is counted over comment-stripped source,
  because the same task rewrites seven docstrings into the shape it counts.
- **D-1405** (Task 20): The delivery terminal pair had no single definition: spelled six times in `store.ts`'s
  SQL, seven more in its docstrings, and once more as a JS disjunction in `pwa/src/session/MailStrip.tsx`;
  minted `TERMINAL_DELIVERY_STATES` in L0 `shared/api.ts` (not beside `TERMINAL_ITEM_STATES` in `store.ts`,
  because the client copy is in another package) and built `TERMINAL_DELIVERY_SQL` from it by the same `.join`
  interpolation `CoordStore.TERMINAL_SQL` uses.
- **D-1406** (Task 20): the positive-form guard (`state IN ('queued','delivered')`) and the negative-form
  guard (`state NOT IN TERMINAL_DELIVERY_SQL`) disagree about a token in neither list: such a row is not-
  outstanding to `dueDeliveries` and the three positive-form writers but LIVE to every negative-form writer
  and to `markAcked`, making the ack route the sole path that can reach it after a deploy rollback; behaviour
  deliberately unchanged by this wave and recorded undecided.
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
  callers learned to omit it, is `D-1415`'s; the skill identity blocks are `D-1416`'.
  This number is the client's silence.) The client now fills the allocate body from the
  pane, refuses a present-but-blank `byId`, refuses to send an unattributed body at all, and offers `--by
  <id>` on that row alone as the door `CONTRIBUTING.md` and `auth/gate.ts`'s EXEMPT entry both require for a
  caller with no pane.
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
  that do not exist, and a single tab-indented run CLOSED a real fence early and handed the whole-file fail-
  loud arm a quotation to report as a definition, printing "renumber NOW" at a quoted line; narrowed to `^
  {0,3}`, which also makes the sentence beside it true, with zero corpus lines affected (5540 fence-shaped
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
- **D-1435** (Task 83): `ledger-sweep.test.ts:190-191` attributed D-1067/1068/1069 to `2026-08-30-d1066-dead-
  recipient-parks.md`, which defines only D-1066 (the other three are in `2026-08-30-d1067-d1068-delivered-
  row-terms.md`), and both that comment and its sibling at `:224-226` named the orphan set in the present
  tense as four when it is six — the enumeration is replaced by the property in the first and dropped entirely
  from the second, since no suite can pin a live-`coord.db` fact and a cardinal restated in a second place is
  D-1331's defect.
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

# Cross-repo programmes — wave 3: the operator's docs, historical-ruling preservation, and the legacy flip by evidence — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make every operator-facing sentence about cross-repo programmes true — README's two coordination sections, the current build spec's pointer back to the immutable Aug 11 ruling, and the programme ledger — hold each of them to the code and the spec they describe, and then flip the legacy generation shut **only against a measurement that was actually taken**, recording the number either way.

**Architecture:** This wave writes almost no mechanism. It CONSUMES everything waves 1 and 2 shipped (the two refusal codes, `homeProject` on every canonical run-open body and on the programme row, `ledgerRepo`/`ledgerAbsPath` on the open response, the immutable plan tuple required for every foreign-plan wave, the producer-source tuple and merge proof required only for a producer-interface dependency, same-project versus cross-project succession, bounded ask list/answer/release operations with held-list semantics and corpus parity across fenced and indented Markdown blocks, safe ask examples with no usable default id, the `worker` mail role and `bindSession`'s heir re-issue, outstanding versus historical programme mail, the feed archive, the runs-screen badge and crossing marker, the fleet card's abroad line, the mail screen's grouping) and PRODUCES prose plus the ratchet that holds the prose to its source. One new suite, `server/test/crossrepo-prose.test.ts`, carries every prose pin; every assertion is grounded in the file it describes — `shared/api.ts`'s own `RUN_REFUSE_CODES`, `server/src/coord/routes.ts`'s handlers, the PWA sources, the current build spec's own §9 paragraph — never in a fixed sentence a later edit could silently falsify. The historical `docs/superpowers/specs/2026-08-11-crossrepo-programmes-design.md` is a read-only ruling record and remains byte-for-byte identical to `origin/main`; current README/build-spec prose points back to it instead of rewriting it. The one code change in the wave is a single constant, and it is gated on a measurement this plan makes an explicit, separately-reviewable task.

**Tech Stack:** Markdown (`README.md`, `CLAUDE.md`, `docs/superpowers/specs/2026-09-08-crossrepo-programmes-design.md` read-only, `docs/superpowers/programs/crossrepo-programmes.md`), TypeScript (`server/src/coord/routes.ts` — one constant), vitest (`server/test/crossrepo-prose.test.ts`, `server/test/home-project-required.test.ts`), `sqlite3`/`node:sqlite` for the one operator-side read.

**Spec:** docs/superpowers/specs/2026-09-08-crossrepo-programmes-design.md

**Original planning snapshot:** `origin/main` at `d0064e6e`.

**Execution base:** fetch `origin/main`, require the exact commit containing wave 2's merge, and record that full SHA before Task 1. This future wave does not execute from the old planning snapshot. Branch: `ws/<the workspace the coordinator dispatches into>`.

**NOT agent-first — measured from this plan's prescribed file set, and it disagrees with one line of the spec.** Spec §9's wave-3 bullet lists "the coordinator references" in this wave's scope, but §3 F3's own bullet moved the refusal-list sentence and its `wave-lifecycle.md` rows into WAVE 1 (because `server/test/coordinator-skill.test.ts` requires every `RunRefuseCode` to be named in the skill corpus the moment the code exists) and the behavioural clauses into WAVE 2. This wave's file table and Task 7's final diff census touch **nothing** under `ccd/`, nothing under `session-hook.sh`, and nothing under `ccd/coordinator-skill/` or `ccd/worker-skill/`. The AGENT-FIRST rule therefore does not bind it, and there is no agent deploy step in this plan. The server lane alone ships, and it ships only if Task 6 lands (`bash deploy/deploy.sh`); a docs-only outcome ships nothing at all. This disagreement with §9 is recorded as **D-2069**.

---

## Global Constraints

Copied from the spec and from `CLAUDE.md`. Every task's requirements implicitly include this section.

- **Fixture HOMEs only.** No test in this plan runs `ccd`, and none may read or write the live `$HOME`. The one route suite builds its server against `mkTmp` (`server/test/tmpHelpers.ts`); everything else is a read of a TRACKED file in this checkout. Never touch tmux, `~/.cc-sessions`, `~/.cc-limits`, or a `claude-session@*` unit.
- **The one live read in this wave is an OPERATOR act, and it prints a COUNT.** Task 5's `sqlite3 ~/.ccrc/coord.db` read is run by the operator on the server box, returns two integers, and never prints a row, a body or a secret. Nothing in this plan `cat`s a file under `~/.cc-secrets` or `~/.ccrc`.
- **No real host, IP, tailnet name, DuckDNS name or fleet-account label anywhere** — source, test, README, ledger, or this document. README's examples use `<project>` / `<other project>` placeholders. The dogfood pair `custom-tools` ↔ `data-internal` appears only where the spec and the ledger already carry it (measured: `server/test/topology-clean.test.ts` is green on this branch with the spec present — 48 tests, run 2026-09-08). `topology-clean` scans every tracked file, docs included.
- **`FLEET_PROTO` stays 1; the wire is additive-only.** This wave changes no wire type, and its prose must not describe a bumped protocol.
- **No overloaded null at a seam.** `project-mismatch` and `home-mismatch` are two conditions a caller handles differently and the prose must keep them apart; a NULL stored home and a home that differs are likewise two facts with two remedies. A sentence that folds them is how the folding gets built next.
- **`EXEC_COMMANDS = ['tmux','ccd']` stays closed; `gh` gets no grant, ever.** This wave adds no exec surface, and prose implying one is false.
- **L0 `shared/*.ts` imports nothing.** Unchanged here; the pins read `shared/api.ts` by IMPORTING `RUN_REFUSE_CODES` (a value that is already L0-pure) and read every other source as TEXT.
- **Mutation-table discipline.** Every prose correction and the one constant ship WITH an assertion that goes RED when the paragraph is deleted or the constant is reverted, measured before and after — not asserted in a comment. TDD, red first.
- **Deviation numbers come only from the allocator.** This plan's five plan-time findings are already allocated and defined as D-2066–D-2070; do not mint replacements, placeholders, or another block. The later acceptance corrections are likewise already allocated and defined as D-2680–D-2687 and D-2715–D-2720 in the wave-2 plan. A deviation FOUND during execution gets its own allocator call at the moment it is found, never a number from a gap.
- **README is canonical; `CLAUDE.md` is the non-obvious operational rules.** This wave adds prose to README only. Its single `CLAUDE.md` edit is the README line-count figure (Task 2, Step 7), nothing else.
- **Node floor `>=22.13.0`,** identical across the three engines; if `node-floor.test.ts`'s absolute assertion reds while the others are green, RAISE engines — never lower them.
- **Run suites in the FOREGROUND**, timeout ≥ 600000 ms, from inside the package, by absolute path: `cd server && ./node_modules/.bin/vitest run test/<file>.test.ts`. NEVER bare `npx vitest` — it resolves a global copy with no jsdom and falsely reports "no tests".

---

## Wave map

The other two plans, both under `docs/superpowers/plans/`:
`2026-09-08-crossrepo-wave1-server.md` (both refusal codes at both sites, the one migration, `homeProject` at open with the legacy generation, `RunSummary.homeProject`, the `worker` mail role, `bindSession` and the heir re-issue, the two programme filters, the `ccrc-api` rows, the codes named in the coordinator skill) and
`2026-09-08-crossrepo-wave2-skills-pwa.md` (both skills' behavioural clauses, the runs-screen badge and crossing marker, the fleet card's marker and abroad line, the mail screen's grouping and chip).

**Execution precondition, stated plainly: this wave runs LAST.** Its suite reads names the earlier waves create — `project-mismatch` and `home-mismatch` in `RUN_REFUSE_CODES`, `ledgerRepo`/`ledgerAbsPath`/`homeProject` in `server/src/coord/routes.ts`, `program` in the mail and feed handlers, `run-project` in `pwa/src/screens/RunsScreen.tsx`, `abroad` in `pwa/src/fleet/ProjectCard.tsx`, `HOME_PROJECT_LEGACY_ACCEPTED` in `routes.ts` — and every one of those is an anti-vacuity assertion that REFUSES rather than passing when its subject has not shipped. A prose pin whose subject does not exist should red, not go green over nothing.

**Consumes (documented by this wave, produced by waves 1–2), by the cross-wave contract's own names:**

- Wave 1, `shared/api.ts`: `RunRefuseCode` gains `'project-mismatch'` and `'home-mismatch'` (and `RUN_REFUSE_CODES` derives from `RUN_REFUSE_CODE_MAP`); `RunSummary.homeProject: string | null`; `NotifyEvent.runId: number | null`; mail `toId` literals `'coordinator' | 'worker' | <session id>`.
- Wave 1, `server/src/coord/store.ts`: `sessionProject`, `programHome`, `setProgramHome`, `bindSession` (the one writer of `runs.sessionId`), `requeueAbandonedMail`, `resolveWorker`, `mailForProgram`, `feedEventsForProgram`; `recordFeedEvent` stores `e.runId`.
- Wave 1, `server/src/coord/schema.ts`: one new `MIGRATIONS` entry — `programs.homeProject`, `feed_events.runId`; `COORD_SCHEMA_VERSION = MIGRATIONS.length` rises by one.
- Wave 1, `server/src/coord/routes.ts`: `POST /api/runs` takes `homeProject`; the two 409 refusals with `by`; the run events `legacy-home-project` and `home-project-backfilled`; the constant `HOME_PROJECT_LEGACY_ACCEPTED`; the response fields `ledgerRepo` and `ledgerAbsPath`; `POST /api/mail` admits `toId: 'worker'`; `GET /api/mail?program=` returns outstanding mail, `GET /api/mail?program=&all=1` returns full mail history, and `GET /api/feed?program=` returns the full event archive. `server/src/coord/dispatch.ts`: `DispatchOutcome`'s refused member gains `by?: string`, passed through by `sendDispatchOutcome`.
- Wave 1, `ccd/ccrc-api`: `--program` on the `mail list` row and a new `feed list GET /api/feed [--program | --limit]` row.
- Wave 2, coordinator and worker corpora: every canonical `runscodes run`, `runs open`, and `runs list --closed 1` call maps to a declared bounded-client row; the canonical open body includes `homeProject`; same-project and cross-project succession are separate ordered procedures, each requiring its own post-close closed-row proof. Every foreign-plan wave carries `homeRepoRoot`, `planRepoPath`, and `planSha`; only a consumer with a producer-interface dependency also carries `producerRepoRoot`, `producerSourceRepoPath`, `producerSha`, and an inline excerpt, and only that arm adds same-SHA merge proof. A no-dependency foreign-plan wave invents no producer evidence.
- Wave 2, `ccd/ccrc-api`: bounded `asks.list`, `asks.answer`, and `asks.release` rows, with caller identity derived narrowly from the current pane, `asks list` fixed to the held view, copied ask examples requiring an explicitly supplied id before client invocation, and exact executable corpus-command-to-route-table parity across fenced and indented Markdown blocks.
- Wave 2, PWA: `run-project` on every runs-screen row; the crossing marker; `ProjectCard`'s additive `abroad` prop and the rule-3 orphan marker text `"<program> wave n/N · home <project>"`; `FleetScreen`'s per-card abroad list; `MailScreen`'s programme grouping and filter chip.

**Produces (for reviewers, for the dogfood programme, and for whoever flips the constant if this wave defers it):**

- `README.md` § "Cross-repo programmes: one home, waves anywhere" — the canonical operator-facing account. Any later change to crossing behaviour edits this section and reds `crossrepo-prose.test.ts` if it does not.
- `server/test/crossrepo-prose.test.ts` — the prose ratchet, four describe blocks.
- `server/test/home-project-required.test.ts` — the flip's own suite (Task 6 only).
- `docs/superpowers/programs/crossrepo-programmes.md` — waves 1–2 closed, the dogfood exit criteria derived from current spec §9, and the flip measurement recorded with its date whichever way it went.
- No edit to `docs/superpowers/specs/2026-08-11-crossrepo-programmes-design.md`: it remains byte-for-byte historical evidence; the current build spec and README carry the pointer back.

---

## File Structure

| File | Change | Task | Responsibility after this wave |
|---|---|---|---|
| `server/test/crossrepo-prose.test.ts` | **Create** (Task 1, appended by Tasks 2, 4 and 5) | 1, 2, 4, 5 | Holding every cross-repo sentence to the code, the current spec and the ledger it describes |
| `README.md` — new `###` subsection inserted at `:1293` | Modify | 1 | The whole crossing story: home project, the two refusals with their 409 bodies, `ledgerRepo`/`ledgerAbsPath`, same- versus cross-project succession, producer-source and merge proof, the worker role and the `runId` rule, the two programme filters, the board's three cues, and real cap accounting |
| `README.md:1378-1385`, `:1386-1401`, insertion at `:1484` | Modify | 2 | The run lifecycle's two refusals and two succession procedures, and the programme-mail paragraph between the mail-bus paragraph and `**Caps and pause.**` |
| `CLAUDE.md:10` | Modify — one number | 2 | The README size claim, re-measured after the growth |
| `docs/superpowers/specs/2026-08-11-crossrepo-programmes-design.md` | **Read only; byte-equality checked** | 3 | Historical ruling body preserved exactly; current docs point back to it |
| `docs/superpowers/programs/crossrepo-programmes.md` | Modify | 4, 5, 7 | Waves 1–2 closed with their PRs; wave 2's D-2680–D-2687 and D-2715–D-2720 outcomes and wave 3's historical-preservation scope stated; the mandatory-plan/conditional-producer contract and corrected dogfood exit criteria; the flip measurement; the final row |
| `server/src/coord/routes.ts` — `HOME_PROJECT_LEGACY_ACCEPTED` | Modify — one constant | 6 | The legacy generation ends; `homeProject` becomes required at open |
| `server/test/home-project-required.test.ts` | **Create** | 6 | The require branch, driven through the route, plus the shipped value of the constant |
| `server/test/home-project.test.ts` | Modify | 6 | Wave 1's pure-function suite: gains the `required` case the deleted route test covered; its shipped-value assertion flips with the constant (Step 6) |
| `server/test/run-routes.test.ts` | Modify | 6 | `OPEN_BODY` gains `homeProject`; the legacy-generation route test is deleted; the backfill case seeds its own precondition |
| `server/test/coord-caps-route.test.ts` | Modify | 6 | Its `POST /api/runs` fixture gains `homeProject`, so the caps route's own open still opens |

**Prose pins this future wave must re-read on its execution base.** The anchors below were originally measured at the planning snapshot `d0064e6e`; they are finders, not permission to overwrite later changes. Before each edit, locate the named symbol or passage on the fetched wave-2-merged base, preserve intervening work, and update a stale line number or expected count to the measured current value. None of these pins may be broken.

| Suite | What it asserts, and what it means for this wave |
|---|---|
| `server/test/box-token-census.test.ts:307-339` | Slices README `` '`/api/mail` (and its ack route)' `` → `'Minting the token file matters'` and requires that passage to state **no number word at all** (`numeralsIn(p)` `toEqual([])`) while naming every gated run route and every ungated door. **Task 2's new paragraph goes AFTER that passage's closing anchor**, between the end of the mail-bus paragraph (`:1483`) and `**Caps and pause.**` (`:1485`). |
| `server/test/box-token-census.test.ts:341-358` | Slices `'**Caps and pause.**'` → `'Pause is a'` and requires **no number word** there either, plus every ungated door by name. Task 1 therefore states the measured accounting in its cross-repo subsection without a hand-kept slot count; D-2686 supersedes D-2068's false two-slot premise. |
| `server/test/box-token-census.test.ts:277-305` | Slices `'What is gated, and what is not:'` (README `:535`) → `'Enrolling a passkey'`. Far above every edit here; untouched. |
| `server/test/readme-holds.test.ts:27-34` | `holdsSection()` slices `'### Workspace holds & programs'` (`:1293`) to the next `\n## `. **Task 1 inserts its subsection immediately BEFORE that heading**, so the holds slice is byte-identical afterwards. |
| `server/test/worker-skill.test.ts:118-134` | Every mention of `ccd/worker-skill/SKILL.md` in `README.md` and `CLAUDE.md` must state "thirteen clauses" within 160 characters. `server/test/coordinator-skill.test.ts` likewise derives and pins eleven coordinator clauses. **Do not name either skill path in new prose without its derived count nearby.** |
| `server/test/oss-metadata.test.ts:89-101` | `CLAUDE.md`'s `` `README.md` (~N lines) `` claim must be within 10% of the real count. README grows ~95 lines in Tasks 1–2; Task 2 Step 7 re-measures. |
| `server/test/ccrc-install-graphify.test.ts:648-668` | Two NEGATIVE scans over the WHOLE README: no present-tense verb (`converges|writes|installs|plants|puts`) within 140 characters of `block`/`read rule` and `CLAUDE.md`, and none within 140 characters of `always_on/claude-md.md`. New prose here never names `CLAUDE.md` at all. |
| `server/test/license.test.ts:105-127`, `server/test/ccrc-update.test.ts:929-930` | README's `## License` section (holder, licence, `(LICENSE)` link, §13) and its `bash ≥ <floor>` claim. Untouched. |
| `server/test/topology-clean.test.ts` | Every tracked file, docs included: no operator host, address, tailnet or account residue. Fixture and placeholder names only. |
| `server/test/single-definition.test.ts` | Four TS roots (`shared`, `server/src`, `pwa/src`, `agent/src`) — no second copy of a single-source value. `server/test` is not in `ROOTS`, which is why this plan's local `passage`/`read` helpers (the same shape `box-token-census.test.ts:227` and `readme-holds.test.ts:27` each already spell locally) are not a second definition of anything the guard governs. |
| `server/test/dtbd.test.ts` | `git grep` over every tracked file: no concrete `D-TBD-<slug>` may land. This plan uses its already-issued D-2066–D-2070 and D-2680–D-2687 and D-2715–D-2720 numbers directly. |
| `server/test/deviation-refs.test.ts` | Compares this branch's plan entries against `origin/main`'s WITHOUT merging; run after `git fetch origin main` in Task 7. |

`ccd/coordinator-skill/SKILL.md` and `ccd/worker-skill/SKILL.md` are VERBATIM-pinned by `server/test/coordinator-skill.test.ts` and `server/test/worker-skill.test.ts`. **This wave edits neither** — see the header note and D-2069.

**Mutation table for this wave.** Spec §7's table is unnumbered and covers waves 1–2's guards; this plan numbers its own rows and each task names the one it discharges.

| Row | Guard | Red when |
|---|---|---|
| W3-1 | README's cross-repo subsection | the subsection is deleted or renamed; a `*-mismatch` code exists that it does not name; it stops naming a response field the open route sends; it loses the mandatory immutable-plan tuple/read, makes the conditional producer tuple/excerpt universal, omits the producer repository root/read or dependency-gated merge proof, or loses the authority split, fail-closed rule, or ledger/plan distinction; it stops naming the worker role, the `runId` rule, outstanding versus historical mail, the feed archive, `run-project`, `abroad`, or the measured cap predicates |
| W3-2 | README's run-lifecycle steps and the programme-mail paragraph | either mismatch code or either succession procedure goes missing; either branch loses open-before-close or post-close closed-row ordering; the cross-project close loses `final:true`/`released:true`; a dependency-bearing arm loses its conditional same-SHA merge proof or dispatch ordering; the programme-mail paragraph is deleted or stops naming a role, `unknown-recipient`, the exact `&all=1` history URL, the default outstanding-mail behavior, or the feed's archive semantics |
| W3-3 | historical-ruling preservation | the Aug 11 file differs byte-for-byte from `origin/main`, or either README or the current build spec stops naming it and saying its rulings stand |
| W3-4 | the programme ledger | wave 1 or wave 2's row carries no PR or is not closed; wave 2 loses its D-2680–D-2687 and D-2715–D-2720 record; wave 3 regresses to editing the historical Status line or omits byte-preservation; the dogfood subject or any corrected §9 acceptance concept is missing; the mandatory plan tuple/read, this dependency-bearing dogfood consumer's producer tuple/read, the inline-shape authority, exact producer `done`, independent merge proof, same-SHA equality, board cue, cross-repo PR record, no-copy rule, or refusal-as-test rule is weakened |
| W3-5 | the flip measurement | the ledger's `## Measurements` block is deleted, or loses either number or its date |
| W3-6 | `HOME_PROJECT_LEGACY_ACCEPTED` | the constant is reverted to `true`; an open with no `homeProject` stops being refused; the refusal stops naming the field |
| W3-7 | the whole tree | `topology-clean`, `single-definition`, `dtbd` or `deviation-refs` red after the last edit |

---

### Task 1: README — the crossing, in the operator's own section

**Files:**
- Create: `server/test/crossrepo-prose.test.ts`
- Modify: `README.md` — insert a new `###` subsection immediately BEFORE `### Workspace holds & programs` (`:1293`)

**Interfaces:**
- Consumes: `RUN_REFUSE_CODES` (`shared/api.ts`, wave 1's `'project-mismatch'` and `'home-mismatch'` among its members); `server/src/coord/routes.ts`'s `homeProject`, `ledgerRepo`, `ledgerAbsPath`, `'worker'`, and the `program` query on the mail and feed handlers; `pwa/src/screens/RunsScreen.tsx`'s `run-project`; `pwa/src/fleet/ProjectCard.tsx`'s `abroad`.
- Produces: `read(rel)`, `passage(name, text, from, to)` and `crossSection()` in `server/test/crossrepo-prose.test.ts`, used by every later task in this file; and README's `### Cross-repo programmes: one home, waves anywhere`, the canonical statement.

**Spec refs:** §3 F1 (both refusal sites), §3 F2 (the home project, the response fields), §3 F3 (the mandatory immutable-plan tuple, conditional producer-source tuple/excerpt, exact Git-object reads, project-specific succession and dependency-gated merge proof), §3 F4 (the board's three cues), §4 (the worker role, the heir, outstanding/history mail and the feed archive), §5 (the actual cap predicates), §9 wave 3.

**Mutation table:** row W3-1. Measured in Step 6 by deleting the whole subsection from `README.md` and re-running the suite: `crossSection()`'s opening-anchor assertion reds first and every test in the describe follows it.

**LEDGER:** D-2068 recorded where the old two-slot sentence could fit, but D-2686 later refuted its premise against the server query. `maxConcurrentWorkers` counts dispatched non-terminal run rows, not held workspaces; the rolling daily counter counts accepted dispatches. Keep README's count-free caps paragraph untouched, and put the corrected predicate in this subsection where the crossing procedure is explained. A planned consumer and a terminal retained producer each use no running-worker slot; every producer or consumer dispatch still uses one daily unit while its timestamp is inside the rolling window. Ordinary `cap-concurrency` and `cap-daily` refusals remain authoritative.

Anchor quotes from the original planning snapshot, so the sites remain findable even when the numbers drift. Re-read each named source on the wave-2-merged execution base before applying the prescribed replacement.

`README.md:1288-1293`:

```markdown
5. Open the run, then dispatch. Watch `/runs`; read `/mail`.

Success is a program that completes with human pauses only at review points,
and an audit trail that reads true.

### Workspace holds & programs
```

`server/src/coord/routes.ts:975-978` — the open response as it stands before wave 1 widens it:

```ts
    return reply.code(200).send({
      ok: true, id: opened.id, program: opened.program, state: opened.state,
      ledgerPath: `docs/superpowers/programs/${program}.md`,
    });
```

`shared/api.ts:3792-3798` — the map that makes a missing member a compile error, and the derived list this suite reads:

```ts
const RUN_REFUSE_CODE_MAP: Record<RunRefuseCode, true> = {
  'claimed-by-another': true, paused: true, 'mail-disabled': true, 'cap-concurrency': true,
  'cap-daily': true, 'ambiguous-dispatch': true, 'worker-busy': true,
  'hookstate-unmeasurable': true, 'not-dispatched': true,
  'prhistory-unreadable': true, 'bad-transition': true, 'unknown-item': true, 'item-terminal': true,
};
export const RUN_REFUSE_CODES: readonly RunRefuseCode[] = Object.keys(RUN_REFUSE_CODE_MAP) as RunRefuseCode[];
```

`server/src/coord/routes.ts:1610-1615` — the feed handler, which wave 1 teaches `program`:

```ts
  app.get('/api/feed', async (req, reply) => {
    if (!deps.coord) return notConfigured(reply);
    const q = req.query as { limit?: string };
    const limit = Number(q.limit);
    return { events: deps.coord.feedEvents(limit) };
  });
```

- [ ] **Step 1: Write the failing tests**

Create `server/test/crossrepo-prose.test.ts`:

```ts
// Prose that must stay TRUE about cross-repo programmes: README's own
// subsection and its run-lifecycle/mail paragraphs, the immutable Aug 11 ruling,
// and the programme ledger. Every assertion is grounded in the SOURCE it
// describes — `RUN_REFUSE_CODES`, the route handlers, the PWA files, and the
// current build spec's own §9 paragraph — never in a fixed sentence a later edit could
// silently falsify, which is `readme-holds.test.ts`'s founding lesson.
//
// The helpers below are deliberately local. `box-token-census.test.ts:227` and
// `readme-holds.test.ts:27` each spell their own slicer for the same reason:
// `server/test` is not one of `single-definition.test.ts`'s four ROOTS, and a
// shared slicer would couple three unrelated ratchets to one another's anchors.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { RUN_REFUSE_CODES } from '../../shared/api.js';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = (rel: string): string => readFileSync(path.join(REPO, rel), 'utf8');

const README = read('README.md');
const ROUTES = read('server/src/coord/routes.ts');
const STORE = read('server/src/coord/store.ts');

/** A named window of a document, from one distinctive marker to the next, so a
 *  match anywhere else in a 2500-line file cannot satisfy an assertion about
 *  this passage. Both anchors are asserted present with their own message: a
 *  moved heading and a deleted paragraph are different repairs. */
const passage = (name: string, text: string, from: string, to: string): string => {
  const a = text.indexOf(from);
  expect(a, `${name}: the opening anchor is gone`).toBeGreaterThan(-1);
  const b = text.indexOf(to, a + from.length);
  expect(b, `${name}: the closing anchor is gone`).toBeGreaterThan(a);
  const out = text.slice(a, b);
  expect(out.length, `${name} is too short to be the passage`).toBeGreaterThan(120);
  return out;
};

/** README's cross-repo subsection alone — its own `###` heading to the next
 *  `###`, which is `### Workspace holds & programs`. */
const crossSection = (): string =>
  passage('README, the cross-repo subsection', README,
    '### Cross-repo programmes: one home, waves anywhere', '\n### ');

/** Every refusal code whose name ENDS in `-mismatch`, derived from the wire's
 *  own list rather than typed here. A third one lands the day it is declared,
 *  and this section reds until it is documented — which is the whole reason to
 *  derive rather than to list. */
const MISMATCH_CODES = RUN_REFUSE_CODES.filter((c) => c.endsWith('-mismatch'));

describe('README: cross-repo programmes', () => {
  it('names every -mismatch refusal the wire declares, with its status and its by', () => {
    // ANTI-VACUITY FIRST. If wave 1 is not in the tree the filter is empty and
    // every loop below passes over nothing — the exact failure mode this file's
    // header warns about. Refuse instead: this wave runs last, by construction.
    expect(MISMATCH_CODES.length,
      'no -mismatch codes in RUN_REFUSE_CODES — wave 1 has not landed, so this wave is out of order')
      .toBeGreaterThanOrEqual(2);
    const s = crossSection();
    for (const code of MISMATCH_CODES) {
      expect(s, `the cross-repo section does not name the refusal \`${code}\``).toContain(`\`${code}\``);
    }
    expect(s, 'the section names the refusals without their status').toContain('409');
    expect(s, 'the section drops `by`, which is the only field that says WHICH project')
      .toContain('"by"');
  });

  it('names the response fields the open route actually sends', () => {
    for (const field of ['homeProject', 'ledgerRepo', 'ledgerAbsPath']) {
      expect(ROUTES, `${field} is not in coord/routes.ts — this loop is over nothing`)
        .toContain(field);
      expect(crossSection(), `the cross-repo section does not name ${field}`).toContain(field);
    }
  });

  it('pins the mandatory plan read and the dependency-gated producer proof', () => {
    const s = crossSection();
    for (const coordinate of ['homeRepoRoot', 'planRepoPath', 'planSha']) {
      expect(s, `the cross-repo section does not name mandatory ${coordinate}`).toContain(coordinate);
    }
    expect(s, 'the section does not carry the exact named-plan read')
      .toContain('git -C "$homeRepoRoot" show "$planSha:$planRepoPath"');
    expect(s, 'the plan tuple is not required for every foreign-plan wave')
      .toMatch(/every foreign-plan wave[\s\S]{0,220}?homeRepoRoot[\s\S]{0,120}?planRepoPath[\s\S]{0,120}?planSha/i);

    for (const coordinate of ['producerRepoRoot', 'producerSourceRepoPath', 'producerSha']) {
      expect(s, `the dependency-gated producer contract does not name ${coordinate}`).toContain(coordinate);
    }
    expect(s, 'the producer tuple and excerpt are not conditional on an interface dependency')
      .toMatch(/only[\s\S]{0,100}?depends on a producer interface[\s\S]{0,220}?producerRepoRoot[\s\S]{0,240}?inline/i);
    expect(s, 'a no-dependency foreign wave still invents producer evidence')
      .toMatch(/no producer-interface dependency[\s\S]{0,160}?no producer tuple[\s\S]{0,100}?no invented\s+excerpt/i);
    expect(s, 'the section does not carry the exact producer-source read')
      .toContain('git -C "$producerRepoRoot" show "$producerSha:$producerSourceRepoPath"');
    expect(s, 'the section does not fail closed when a required immutable object cannot resolve')
      .toMatch(/required immutable blob[\s\S]{0,140}?report and stop/i);
    expect(s, 'the section treats ledgerAbsPath as a plan coordinate')
      .toMatch(/ledgerAbsPath[\s\S]{0,180}?programme ledger/i);
    expect(s, 'the inline excerpt is no longer the dispatched shape authority')
      .toMatch(/inline[\s\S]{0,100}?dispatched[\s\S]{0,80}?shape authority/i);
    expect(s, 'the named plan blob is no longer the requirements authority')
      .toMatch(/plan blob[\s\S]{0,100}?requirements\s+authority/i);
    expect(s, 'the dependency-bearing arm never requires independent merge proof at producerSha')
      .toMatch(/when that dependency exists[\s\S]{0,180}?independently prove[\s\S]{0,180}?producerSha/i);
    expect(s, 'the current README no longer points to the immutable historical ruling')
      .toContain('docs/superpowers/specs/2026-08-11-crossrepo-programmes-design.md');
    expect(s, 'the current README no longer says the historical rulings stand')
      .toMatch(/rulings stand/i);
    expect(s).not.toContain('show "HEAD:');
    expect(s).not.toContain('read the home plan by the absolute path');
    expect(s).not.toMatch(/state[^\n]{0,40}`done`[^\n]{0,80}(?:is enough|proves the merge)/i);
  });

  it('states the worker role AND the runId rule that keeps a worker off the refusal', () => {
    expect(ROUTES, "the send route no longer carries the 'worker' literal — this check is over nothing")
      .toContain("'worker'");
    const s = crossSection();
    expect(s, "the section does not name the worker role").toContain("toId: 'worker'");
    expect(s, "the section does not name the coordinator role beside it").toContain("toId: 'coordinator'");
    // WITHIN ONE WINDOW, not merely both present somewhere: the rule is that a
    // `worker` mail carries a runId, and a section that names the role in one
    // paragraph and `runId` four paragraphs later has not stated the rule.
    expect(s, 'the section describes the worker role without the runId rule beside it')
      .toMatch(/toId: 'worker'[\s\S]{0,700}?runId/);
    expect(s, 'the section does not say what an unresolvable role answers')
      .toContain('unknown-recipient');
  });

  it('distinguishes outstanding mail, full mail history, and the feed archive', () => {
    // THE HANDLER BODY, NOT THE GAP TO THE NEXT REGISTRATION. Each handler is
    // grounded in the query keys it actually reads before README's prose is
    // checked, so a route name alone cannot satisfy this test.
    const feed = passage('the feed handler', ROUTES, "app.get('/api/feed'", '\n  });');
    const mail = passage('the mail list handler', ROUTES, "app.get('/api/mail'", '\n  });');
    expect(feed, 'the feed handler does not read `program` — wave 1 has not landed').toContain('program');
    expect(mail, 'the mail list handler does not read `program` — wave 1 has not landed').toContain('program');
    expect(mail, 'the mail handler no longer reads `all` — full history is not selectable').toContain('all');
    const s = crossSection();
    expect(s, 'the section does not name the exact full-history URL')
      .toContain('GET /api/mail?program=<slug>&all=1');
    expect(s, 'the section does not say the default programme mail read is outstanding-only')
      .toMatch(/GET \/api\/mail\?program=<slug>`[\s\S]{0,120}?outstanding/i);
    expect(s, 'the section does not name the feed filter').toContain('GET /api/feed?program=');
    expect(s, 'the section does not state that the feed is the full archive')
      .toMatch(/feed[\s\S]{0,120}?full\s+(?:feed\s+|event\s+)?archive/i);
    expect(s, 'the section does not say what happens to an event with no run behind it')
      .toContain('programless');
  });

  it("names the board's three cues, grounded in the PWA files that render them", () => {
    const runsScreen = read('pwa/src/screens/RunsScreen.tsx');
    const card = read('pwa/src/fleet/ProjectCard.tsx');
    expect(runsScreen, 'the runs screen carries no `run-project` — wave 2 has not landed')
      .toContain('run-project');
    expect(card, 'the project card carries no `abroad` — wave 2 has not landed').toContain('abroad');
    const s = crossSection();
    expect(s, 'the section does not name the badge the runs screen renders').toContain('run-project');
    expect(s, "the section does not name the home card's abroad line").toContain('abroad');
    // The board's own two-cue rule, said where an operator reads it: a marker
    // that is only a colour is a marker half the fleet cannot see.
    expect(s, 'the section describes the crossing marker without the two-cue rule')
      .toMatch(/by colour alone/i);
  });

  it('states the measured cap predicates, not a workspace-to-slot equivalence', () => {
    const s = crossSection();
    expect(STORE, 'the running cap no longer counts dispatched non-terminal rows')
      .toContain("dispatchedAt IS NOT NULL AND state NOT IN ('done','failed')");
    expect(STORE, 'the daily cap no longer counts rows dispatched inside its rolling window')
      .toContain('dispatchedAt IS NOT NULL AND dispatchedAt > ?');
    expect(s, 'the section still equates two held workspaces with two running-worker slots')
      .not.toMatch(/two concurrency slots/i);
    expect(s, 'the section does not say concurrency counts dispatched non-terminal runs')
      .toMatch(/concurrency[\s\S]{0,180}?dispatched[\s\S]{0,100}?non-terminal runs/i);
    expect(s, 'the section does not say a planned undispatched consumer uses no running slot')
      .toMatch(/planned[\s\S]{0,80}?undispatched[\s\S]{0,100}?no running-worker slot/i);
    expect(s, 'the section does not say a terminal retained producer uses no running slot')
      .toMatch(/terminal[\s\S]{0,80}?producer[\s\S]{0,100}?no running-worker slot/i);
    expect(s, 'the section does not state that every accepted dispatch consumes daily budget')
      .toMatch(/each[\s\S]{0,60}?dispatch[\s\S]{0,80}?daily/i);
    for (const code of ['cap-concurrency', 'cap-daily']) {
      expect(RUN_REFUSE_CODES as readonly string[],
        `${code} is not a declared RunRefuseCode — this claim is over nothing`).toContain(code);
      expect(s, `the section does not keep \`${code}\` authoritative`).toContain(code);
    }
    // README's caps paragraph stays count-free; the cross-repo subsection names
    // predicates rather than preserving the now-refuted hand-kept count.
    const caps = passage('README, the caps paragraph', README, '**Caps and pause.**', 'Pause is a');
    expect(caps, 'the cross-repo accounting was moved into the count-free caps paragraph')
      .not.toMatch(/\btwo\b/i);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd server && ./node_modules/.bin/vitest run test/crossrepo-prose.test.ts`

Expected: FAIL — 7 failed, 0 passed. Every test reds on the same first assertion,
`README, the cross-repo subsection: the opening anchor is gone`
(`expected -1 to be greater than -1`), because the subsection does not exist yet. If instead a test reds on one of the anti-vacuity messages (`wave 1 has not landed`, `wave 2 has not landed`), STOP: this wave is being executed before the wave it documents, and no prose edit can fix that.

- [ ] **Step 3: Write the subsection**

In `README.md`, insert the following immediately before `### Workspace holds & programs` (`:1293`) — i.e. after the Build 4 dogfood subsection's closing line `and an audit trail that reads true.` and its blank line:

```markdown
### Cross-repo programmes: one home, waves anywhere

A programme is **initiated in one project and stays there**: its current spec,
its plan, its ledger (`docs/superpowers/programs/<slug>.md`) and its coordinator
session all live in that one repo. For cross-repo programmes, the current build
spec is `docs/superpowers/specs/2026-09-08-crossrepo-programmes-design.md`; it
points back to `docs/superpowers/specs/2026-08-11-crossrepo-programmes-design.md`,
whose historical operator rulings stand. That repo is the programme's **home
project**, and it is *declared*, never inferred — the canonical `POST /api/runs`
body takes `homeProject` on every wave and stores it on the programme row at first
insert. It is not guessed from wave 1's project and not derived from the registry
or from whoever claims the run: a fact a programme carries for its whole life
must not depend on a live read that can degrade.

**A wave, though, may run anywhere.** `runs.project` has always been per-row, so
a wave dispatches its run into whatever repo the work is in — that repo's
checkout, that repo's PRs, that repo's git for every re-measurement. A wave whose
`project` differs from its programme's `homeProject` is a **crossing**.

**Two refusals guard the seam, and they are two on purpose.**

- `project-mismatch` — **409**, body
  `{"ok":false,"refused":"project-mismatch","by":"<the project that session belongs to>"}`.
  It fires at two sites: at `POST /api/runs`, when the body reuses a `sessionId`
  whose earlier runs belong to a different project — checked *before* the row is
  opened, so a refusal leaves no `planned` orphan; and at
  `POST /api/runs/:id/dispatch`, when the resume arm finds a registry record
  whose project is not the run's — checked before the hold, the `/clear` and the
  transition, so a mismatch costs nothing. A session no run has ever named
  refuses nothing: absence permits.
- `home-mismatch` — **409**, body
  `{"ok":false,"refused":"home-mismatch","by":"<the stored home>"}`, when a later
  open of the same programme names a different `homeProject`. A stored home that
  is still null is *backfilled* from the body instead — first writer wins.

Two codes rather than one because the caller does different things with them:
the first says "you reused the wrong workspace", the second says "you are
opening someone else's programme".

**The open response says where the ledger really is.** Beside the relative
`ledgerPath` it has always returned, `POST /api/runs` answers `ledgerRepo` (the
home project) and `ledgerAbsPath` (that project's checkout plus
`docs/superpowers/programs/<slug>.md`). Both are `null` while the stored home is
null. `ledgerAbsPath` names only the programme ledger; it is neither the home
repository root nor a plan path.

**Foreign-repo waves read named Git objects, never mutable files.** Every foreign-plan wave's
brief carries `homeRepoRoot` (the absolute home-repository root), `planRepoPath` (the
tracked repository-relative plan path with no leading slash), and `planSha` (the
full 40-hex plan commit SHA), then the worker reads exactly
`git -C "$homeRepoRoot" show "$planSha:$planRepoPath"`. Only a consumer that
depends on a producer interface also carries `producerRepoRoot` (the absolute producer-
repository root), `producerSourceRepoPath` (the producer repository-relative source-file
path), `producerSha` (the exact full 40-hex merged producer SHA), and the contract excerpt
inlined verbatim. The worker then reads exactly
`git -C "$producerRepoRoot" show "$producerSha:$producerSourceRepoPath"`. A foreign-plan
wave with no producer-interface dependency carries no producer tuple and no invented
excerpt. If a required immutable blob cannot be resolved, report and stop: no `HEAD`
substitution, direct mutable-checkout read, fetch, checkout, or repository mutation. When
present, the inline contract excerpt is the dispatched interface-shape authority and the
producer blob proves its provenance; the plan blob at `planSha` is always the requirements
authority for wave scope. The current checkout's plan and source files are not authoritative
for that dispatched wave. When that dependency exists, before dispatch the coordinator
separately and independently proves the producer interface PR merged at that same
`producerSha`; a closed run in `done` proves fingerprint and close, not merge. The worker
commits only on its own workspace branch in its own repository. Paths, not payloads; the
8 KiB body cap stands.

**Mail finds a role, not a session.** `toId: 'worker'` joins `toId: 'coordinator'`
as a recipient, resolved at send time — `worker` to that run's own session. A
`worker` mail **must** carry its `runId`, because a worker is per run and there
is nothing to fall back to; one that resolves to no session is refused
`unknown-recipient`, naming the run. Carry the `runId` on coordinator mail too:
the runId-less form resolves only while exactly one programme is active, and
fails shut the moment a second is. Raw session-id addressing stays for ad-hoc
mail. When a run's session is replaced, the replacement inherits its
predecessor's undelivered mail as a **new** delivery row, freshly rendered, and
the predecessor's row is parked — an envelope that names the corpse may not be
replayed.

**Finding a programme's traffic.** `GET /api/mail?program=<slug>` answers only
outstanding mail on that programme's runs; add `&all=1` — exactly
`GET /api/mail?program=<slug>&all=1` — for full mail history. `to` becomes optional
when `program` is given. `GET /api/feed?program=<slug>` is always the full feed
archive and has no outstanding/history split. An event with no run behind it is
**programless** and appears only unfiltered. `/mail` groups the feed by programme,
with a filter chip; programless rows sit under their own header.

**The board says which repo.** Every row on `/runs` carries a project badge
(`run-project`), and a row whose project differs from its programme's home gains
a crossing marker — a glyph *and* the word, because nothing on the board is read
out by colour alone, and while a programme's `homeProject` is null the marker
never shows. On the fleet board a worker stays on its own project's card — a
card is a project's sessions, and a session's workspace lives in one repo — and
its row reads `<program> wave n/N · home <project>`. The home project's own card
gains an `abroad` line, one sentence per wave working elsewhere
("wave 2 in `<other project>`").

**What a crossing costs.** Caps stay global: one row, whole box, no per-project
and no per-programme cap. Running-worker concurrency counts dispatched,
non-terminal runs; it does not count held workspaces. A terminal producer whose
workspace remains retained uses no running-worker slot, and a planned,
undispatched consumer uses no running-worker slot. Each actual producer or
consumer dispatch still consumes the rolling daily dispatch budget. A
`cap-concurrency` or `cap-daily` refusal remains authoritative when that measured
counter is exhausted; it is not inferred from the number of live workspaces.
`$REG/coordinator-paused` is global and still stops everything; the hold reason
still names programme, wave and run id and never a project, because the run row
is what carries the project.
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd server && ./node_modules/.bin/vitest run test/crossrepo-prose.test.ts`

Expected: PASS — 7 passed. The provenance test proves the mandatory plan read, both conditional-producer arms, the producer-root read and their authority split; the caps test rejects the old workspace-to-slot equivalence.

- [ ] **Step 5: Prove the neighbouring README pins still slice what they think they slice**

```bash
cd server && ./node_modules/.bin/vitest run test/readme-holds.test.ts test/box-token-census.test.ts test/worker-skill.test.ts test/ccrc-install-graphify.test.ts test/oss-metadata.test.ts test/license.test.ts
```

Expected: all PASS. A `readme-holds` failure means the subsection was inserted AFTER `### Workspace holds & programs` instead of before it — move it up and re-run. A `box-token-census` failure naming the caps or mail-bus paragraph means prose landed inside a pinned slice.

- [ ] **Step 6: Measure the mutation (row W3-1)**

Delete the whole `### Cross-repo programmes: one home, waves anywhere` subsection from `README.md`, then run:

```bash
cd server && ./node_modules/.bin/vitest run test/crossrepo-prose.test.ts
```

Expected: FAIL — 7 failed, each on `README, the cross-repo subsection: the opening anchor is gone`. Then restore the subsection (`git checkout -- README.md` is NOT available under this plan's hard limits — restore by re-applying Step 3's text) and re-run: 7 passed. Record both numbers in the task's run log.

- [ ] **Step 7: Commit**

```bash
git add README.md server/test/crossrepo-prose.test.ts
git commit -m "docs(readme): the crossing — a home project, waves anywhere, and what it costs"
```

---

### Task 2: README — the two refusals where the lifecycle emits them, and programme mail beside the mail bus

**Files:**
- Modify: `README.md:1378-1385` (run-lifecycle step 1), `:1386-1401` (step 2), and an insertion at `:1484` between the mail-bus paragraph and `**Caps and pause.**`
- Modify: `CLAUDE.md:10` — the README size figure only
- Modify: `server/test/crossrepo-prose.test.ts` — append one describe block

**Interfaces:**
- Consumes: `RUN_REFUSE_CODES` and the `passage`/`read`/`MISMATCH_CODES` helpers Task 1 produced; wave 1's `bindSession` (named in the prose as the one writer of `runs.sessionId`), `resolveWorker`, `mailForProgram`, `feedEventsForProgram`, and the mail handler's existing `all` query; wave 2's two succession procedures and producer proof through the exact closed row plus `ccd pr-state`'s raw `headRefOid`.
- Produces: `lifecyclePassage()` and `programmeMailPassage()` in `server/test/crossrepo-prose.test.ts`; README's run-lifecycle steps 1–2 and 5 as the statement of where each refusal fires and how each project-specific succession proceeds; the `**Programme mail at scale.**` paragraph, including exact outstanding/history/archive semantics.

**Spec refs:** §3 F1 (the two sites and their ordering — "BEFORE the hold, the `/clear` and `markDispatched`"), §3 F2 (the response fields), §3 F3 (open-before-close, both succession arms, release and merge proof), §4 (role addressing, the heir, outstanding/history mail and the feed archive), §9 wave 3.

**Mutation table:** row W3-2. Measured in Step 8 by deleting the `**Programme mail at scale.**` paragraph, deleting the two refusal sentences, and weakening each succession arm separately: the first reds `README, the programme-mail paragraph: the opening anchor is gone`, the second reds the per-code containment assertion, and the latter mutations red the ordered lifecycle checks.

Anchor quotes from the original planning snapshot. Re-read the named README passages on the wave-2-merged execution base before changing them; preserve any intervening edits that do not contradict the replacement.

`README.md:1378-1385` — run-lifecycle step 1 as it stands:

```markdown
1. `POST /api/runs` opens a run row for one wave — **the ledger is NOT
   written or read here** (the route's own docstring says so verbatim); it
   only names `docs/superpowers/programs/<slug>.md` in the response, so a
   coordinator that forgot to commit it is told once, in the place it would
   notice. A second coordinator on the same program is refused. Wave 1 (no
   `sessionId` in the body) places **no hold yet** — dispatch is what claims
   the workspace. Wave N≥2 (`sessionId` names the workspace being reclaimed)
   holds it immediately (`ccd ws-hold`).
```

`README.md:1386-1390` — step 2's opening, where the resume arm is described:

```markdown
2. `POST /api/runs/:id/dispatch` checks `$REG/coordinator-paused` and both
   caps **before spawning or resuming anything**; wave 1 (`run.sessionId`
   still null) runs `ccd ws-add` and learns the new session id by diffing
   the registry before/after (never ccd's own echoed sentence, and never
   `ccd start` — no ccd verb of that name runs anywhere in this lane). Wave
```

`README.md:1479-1485` — the end of the mail-bus paragraph and the start of the caps paragraph, which is exactly where the new paragraph goes:

```markdown
bridge, not a standing policy. **Minting the token file matters as much as
having one:** `deploy/ccrc-mail.token.example`'s own placeholder value line
must actually be replaced — copying the example verbatim is refused loudly
at server boot (`MailTokenPlaceholderUnedited`), not silently accepted,
because that exact placeholder is committed to this public repo.

**Caps and pause.** The single-row `coordinator_state` table holds
```

`CLAUDE.md:10`:

```markdown
**`README.md` (~2485 lines) is the canonical system overview. This file is only the non-obvious operational rules
```

`server/test/oss-metadata.test.ts:95-100` — the claim's own tolerance:

```ts
    const claimed = /README\.md` \(~?([0-9,]+) lines\)/.exec(read('CLAUDE.md'));
    expect(claimed, 'CLAUDE.md no longer states the README size').not.toBeNull();
    const said = Number(claimed![1].replace(/,/g, ''));
    const real = read('README.md').split('\n').length - 1;
    expect(Math.abs(said - real) / real,
      `CLAUDE.md says ${said} lines, README.md is ${real}`).toBeLessThan(0.1);
```

- [ ] **Step 1: Write the failing tests**

Append to `server/test/crossrepo-prose.test.ts`, after the Task 1 describe block:

```ts
/** The run-lifecycle numbered list alone — its own bold lead-in to the mail-bus
 *  paragraph that follows it. Deliberately NOT the whole "Fleet coordination"
 *  section: a code named in the mail-bus paragraph must not satisfy a claim
 *  about the route that emits it. */
const lifecyclePassage = (): string =>
  passage('README, the run lifecycle', README, '**Run lifecycle**', '\n**The mail bus');

/** The programme-mail paragraph alone, between the mail-bus paragraph (whose
 *  own passage `box-token-census.test.ts:307-339` pins count-free) and the caps
 *  paragraph (likewise, `:341-360`). Both anchors are those files' anchors, so
 *  a paragraph inserted into either pinned slice by mistake fails HERE with a
 *  length or ordering error rather than confusing the census. */
const programmeMailPassage = (): string =>
  passage('README, the programme-mail paragraph', README,
    '**Programme mail at scale.**', '\n**Caps and pause.**');

describe('README: the run lifecycle and programme mail', () => {
  it('names each -mismatch refusal in the lifecycle step that emits it', () => {
    expect(MISMATCH_CODES.length, 'no -mismatch codes — wave 1 has not landed')
      .toBeGreaterThanOrEqual(2);
    const p = lifecyclePassage();
    for (const code of MISMATCH_CODES) {
      expect(p, `the run lifecycle does not name \`${code}\` in the step that emits it`)
        .toContain(`\`${code}\``);
    }
    // THE ORDERING CLAIM, which is the whole reason the dispatch refusal is
    // safe: spec §3 F1 requires the resume-arm check BEFORE the hold, the
    // `/clear` and the transition. A README that names the code without saying
    // when it fires has documented a refusal and hidden its one guarantee.
    expect(p, 'the lifecycle names the dispatch refusal without saying it fires before the hold')
      .toMatch(/before the hold/i);
  });

  it('states where each refusal is measured, not merely that it exists', () => {
    const p = lifecyclePassage();
    expect(p, "step 1 does not say the open refusal happens before the row is opened")
      .toMatch(/before the row is opened/i);
    expect(p, 'the lifecycle does not name the field the home refusal compares')
      .toContain('homeProject');
    for (const field of ['ledgerRepo', 'ledgerAbsPath']) {
      expect(ROUTES, `${field} is not in coord/routes.ts — this loop is over nothing`)
        .toContain(field);
      expect(p, `step 1 does not name the response field ${field}`).toContain(field);
    }

    const same = passage('README, same-project succession', p,
      'For a same-project successor', 'For a cross-project successor');
    const sameOpen = same.indexOf('same `sessionId`');
    const sameClose = same.indexOf('`final:false`');
    const sameClosed = same.indexOf('closed row');
    const sameDispatch = same.lastIndexOf('dispatch');
    for (const [marker, at] of [
      ['same `sessionId`', sameOpen], ['`final:false`', sameClose],
      ['closed row', sameClosed], ['dispatch', sameDispatch],
    ] as const) {
      expect(at, `same-project ${marker} is absent`).toBeGreaterThan(-1);
    }
    expect(sameOpen, 'same-project producer closes before successor open').toBeLessThan(sameClose);
    expect(sameClose).toBeLessThan(sameClosed);
    expect(sameClosed).toBeLessThan(sameDispatch);

    const cross = p.slice(p.indexOf('For a cross-project successor'));
    expect(cross, 'cross-project succession does not omit the producer session')
      .toMatch(/without the producer's\s+`sessionId`/);
    expect(cross, 'cross-project succession does not verify the closed producer')
      .toMatch(/closed row[\s\S]{0,100}?`done`/i);
    expect(cross, '`done` is incorrectly treated as merge proof')
      .toMatch(/`done`[\s\S]{0,180}?not[\s\S]{0,40}?merge proof/i);
    expect(cross, 'cross-project succession makes merge proof universal instead of dependency-gated')
      .toMatch(/if the consumer depends[\s\S]{0,160}?independently prove[\s\S]{0,200}?producerSha/i);
    const crossOpen = cross.indexOf("without the producer's `sessionId`");
    const crossClose = cross.indexOf('`final:true`');
    const crossRelease = cross.indexOf('`released:true`');
    const crossClosed = cross.indexOf('closed row');
    const crossDependency = cross.indexOf('If the consumer depends');
    const crossMerge = cross.indexOf('independently prove');
    const crossDispatch = cross.lastIndexOf('dispatch');
    for (const [marker, at] of [
      ["without the producer's `sessionId`", crossOpen], ['`final:true`', crossClose],
      ['`released:true`', crossRelease], ['closed row', crossClosed],
      ['If the consumer depends', crossDependency], ['independently prove', crossMerge],
      ['dispatch', crossDispatch],
    ] as const) {
      expect(at, `cross-project ${marker} is absent`).toBeGreaterThan(-1);
    }
    expect(crossOpen, 'cross-project producer closes before successor open').toBeLessThan(crossClose);
    expect(crossClose).toBeLessThan(crossRelease);
    expect(crossRelease).toBeLessThan(crossClosed);
    expect(crossClosed).toBeLessThan(crossDependency);
    expect(crossDependency).toBeLessThan(crossMerge);
    expect(crossMerge).toBeLessThan(crossDispatch);

    for (const evidence of ['handoffCommit', 'ccd pr-state --session', 'phase', 'headRefOid', 'producerSha']) {
      expect(p, `producer merge proof does not name ${evidence}`).toContain(evidence);
    }
    expect(p, 'the named producer SHA is not pinned to the closed row and raw PR row')
      .toMatch(/`headRefOid`[\s\S]{0,160}?`handoffCommit`[\s\S]{0,120}?`producerSha`/);
  });

  it('the programme-mail paragraph names both roles and the exact read semantics', () => {
    const p = programmeMailPassage();
    expect(p, 'the paragraph does not name the worker role').toContain("toId: 'worker'");
    expect(p, 'the paragraph does not name the coordinator role').toContain("toId: 'coordinator'");
    expect(p, 'the paragraph does not say what an unresolvable role answers')
      .toContain('unknown-recipient');
    expect(p, 'the paragraph does not name the exact full-history URL')
      .toContain('GET /api/mail?program=<slug>&all=1');
    expect(p, 'the paragraph does not say the default programme mail read is outstanding-only')
      .toMatch(/GET \/api\/mail\?program=<slug>`[\s\S]{0,120}?outstanding/i);
    expect(p, 'the paragraph does not name the feed filter').toContain('GET /api/feed?program=');
    expect(p, 'the paragraph does not say the feed is the full archive')
      .toMatch(/feed[\s\S]{0,120}?full\s+(?:feed\s+|event\s+)?archive/i);
    // The heir promise, and the one writer it is kept in — grounded, so a
    // rename of the funnel reds the sentence that names it.
    const store = read('server/src/coord/store.ts');
    expect(store, 'bindSession is gone from the store — wave 1 has not landed').toContain('bindSession');
    expect(p, 'the paragraph does not name the funnel the heir promise is kept in')
      .toContain('bindSession');
  });

  it('does not disturb the two count-free paragraphs it sits between', () => {
    // Locality, asserted rather than hoped: the new paragraph must be OUTSIDE
    // both pinned slices. If it landed inside either, that slice would now
    // contain this paragraph's own text — which these two checks catch here,
    // with a message that says what to do, instead of in the census with a
    // message about hand-kept door counts.
    const mailBus = passage('README, the mail-bus paragraph', README,
      '`/api/mail` (and its ack route)', 'Minting the token file matters');
    expect(mailBus, 'the programme-mail paragraph was inserted INSIDE the pinned mail-bus slice')
      .not.toContain('**Programme mail at scale.**');
    const caps = passage('README, the caps paragraph', README, '**Caps and pause.**', 'Pause is a');
    expect(caps, 'the programme-mail paragraph was inserted INSIDE the pinned caps slice')
      .not.toContain('**Programme mail at scale.**');
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd server && ./node_modules/.bin/vitest run test/crossrepo-prose.test.ts`

Expected: FAIL — 8 passed, 3 failed: `the run lifecycle does not name \`project-mismatch\` in the step that emits it` (the first new test stops at its first failing code); `step 1 does not say the open refusal happens before the row is opened` (the second new test's first assertion; after that correction it continues to red until both succession arms, each branch's post-close proof, and the conditional producer proof are present); and `README, the programme-mail paragraph: the opening anchor is gone` (the third new test). The fourth new test, `does not disturb the two count-free paragraphs it sits between`, PASSES already: it slices two anchors that already exist and asserts `.not.toContain('**Programme mail at scale.**')`, which is true before that heading is written anywhere — a locality guard with nothing yet to catch.

- [ ] **Step 3: Rewrite run-lifecycle step 1**

In `README.md`, replace step 1 (`:1378-1385`) with:

```markdown
1. `POST /api/runs` opens a run row for one wave — **the ledger is NOT
   written or read here** (the route's own docstring says so verbatim); it
   only names `docs/superpowers/programs/<slug>.md` in the response, so a
   coordinator that forgot to commit it is told once, in the place it would
   notice. A second coordinator on the same program is refused. The body also
   carries `homeProject`, the programme's home repo, stored on the programme
   row at first insert: a later open naming a *different* one is refused
   `home-mismatch` (**409**, `by:` the stored value), while a stored home that
   is still null is backfilled from the body. A `sessionId` whose earlier runs
   belong to another project is refused `project-mismatch` (**409**, `by:` that
   project) *before the row is opened*, so a refusal leaves no `planned` orphan.
   The response names `ledgerRepo` and `ledgerAbsPath` beside the relative
   `ledgerPath`, both null while the stored home is. Wave 1 (no
   `sessionId` in the body) places **no hold yet** — dispatch is what claims
   the workspace. Wave N≥2 (`sessionId` names the workspace being reclaimed)
   holds it immediately (`ccd ws-hold`).
```

- [ ] **Step 4: Rewrite run-lifecycle step 2's opening**

In `README.md`, replace step 2's first sentence block (`:1386-1390`) with:

```markdown
2. `POST /api/runs/:id/dispatch` checks `$REG/coordinator-paused` and both
   caps **before spawning or resuming anything**; wave 1 (`run.sessionId`
   still null) runs `ccd ws-add` and learns the new session id by diffing
   the registry before/after (never ccd's own echoed sentence, and never
   `ccd start` — no ccd verb of that name runs anywhere in this lane). The
   resume arm refuses `project-mismatch` (**409**, `by:` the registry record's
   project) when the record it finds belongs to a different project than the
   run — *before the hold*, before the injected `/clear` and before the
   transition, so a mismatch costs the workspace nothing. Wave
```

(The rest of step 2, from `N≥2 resumes the *same* workspace with \`ccd ensure\`` onward, is unchanged.)

- [ ] **Step 5: Replace lifecycle step 5 with the two succession procedures and producer proof**

In `README.md`, keep the opening rule that wave N+1 opens before wave N closes, then replace the generic remainder of step 5 with:

```markdown
   **For a same-project successor**, open the new `POST /api/runs` first with the
   same `sessionId`; that immediately re-holds the producer workspace for the new
   row. Then close the producer with `final:false`, verify the exact producer closed row in
   `runs list --closed 1` is `done` with a full 40-hex `handoffCommit`. If
   the consumer depends on an interface from this producer, independently prove
   the producer PR merged at `producerSha`: run `ccd pr-state --session
   <producer-session>`, select that session's merged PR row, require its `phase` to
   be `merged`, and require raw `headRefOid` to equal both that exact producer
   closed row's `handoffCommit` and `producerSha`. Only then dispatch into the
   already-held successor workspace.

   **For a cross-project successor**, open first without the producer's
   `sessionId`, leaving the new row planned for fresh dispatch in the target
   repository. Then close the producer with `final:true` and require the response
   to contain `released:true`; verify the exact producer closed row is `done` with
   a full 40-hex `handoffCommit`. If the consumer depends on an interface from
   this producer, independently prove through `ccd pr-state --session
   <producer-session>` that the producer PR's selected `phase` is `merged` and
   its raw `headRefOid` equals both that `handoffCommit` and `producerSha`. Only
   then dispatch the consumer fresh in its target project.
   A `done` run proves fingerprint and close, **not merge proof**; missing,
   ambiguous, or mismatched PR evidence means report and do not dispatch. Using
   `final:false` on a crossing would strand a synthetic next-wave hold on the
   producer workspace.
```

The two arms repeat the conditional proof deliberately: `final:false` is only the same-workspace handoff, while `final:true` plus `released:true` is the cross-project release. In either arm, when the consumer depends on the producer interface, the selected raw PR row's `headRefOid` is the SHA equality proof; a merged phase or merge commit alone does not establish that the named producer SHA was the merged head. Without that dependency, the closed-row proof still remains mandatory but no producer merge evidence is invented.

- [ ] **Step 6: Insert the programme-mail paragraph**

In `README.md`, insert between the mail-bus paragraph's last line (`:1483`, ending `because that exact placeholder is committed to this public repo.`) and `**Caps and pause.**` (`:1485`), separated by a blank line on each side:

```markdown
**Programme mail at scale.** `toId: 'coordinator'` has a sibling: `toId: 'worker'`,
resolved at send time to that run's own session. `worker` requires a `runId` —
a worker is per run, and there is nothing to fall back to — and one that
resolves to no session is refused `unknown-recipient`, naming the run.
`coordinator` keeps its fallback to the single active programme, which fails
shut the moment a second programme is active, so carry the `runId` on both.
Raw session-id addressing stays for ad-hoc mail. When a run's session is
replaced, every outstanding delivery addressed to the predecessor is re-issued
to the heir as a **new** row, freshly rendered, and the predecessor's row is
parked — the act a reclaimed coordinator's heir has always had, generalised by
role and funnelled through `bindSession`, the one writer of `runs.sessionId`.
Reading it back by programme: `GET /api/mail?program=<slug>` returns only
outstanding mail and `GET /api/mail?program=<slug>&all=1` returns full history;
`to` becomes optional when `program` is given. `GET /api/feed?program=<slug>` is
the full event archive, with no outstanding/history split. Both join through the
run row; an event with no run behind it is programless and shows only unfiltered.
```

- [ ] **Step 7: Re-measure README and update the size claim**

```bash
wc -l README.md
```

Take that number, round it to the nearest five, and in `CLAUDE.md:10` replace `` `README.md` (~2485 lines) `` with `` `README.md` (~<measured> lines) `` — the number only, nothing else on the line. README was 2507 lines at `d0064e6e` and grows ~95 lines across Tasks 1–2, so the untouched claim would still be inside `oss-metadata`'s 10% tolerance; this keeps it honest rather than merely legal.

- [ ] **Step 8: Run the tests to verify they pass, and measure the mutation (row W3-2)**

```bash
cd server && ./node_modules/.bin/vitest run test/crossrepo-prose.test.ts test/oss-metadata.test.ts test/box-token-census.test.ts test/readme-holds.test.ts
```

Expected: PASS — `crossrepo-prose` 11 passed, and every neighbour green.

Then measure, one mutation at a time, restoring by re-applying the exact Step 3–6 text after each:

1. Delete the `**Programme mail at scale.**` paragraph → re-run `crossrepo-prose`: the programme-mail assertions fail on their missing opening anchor.
2. Restore it; remove `&all=1` from the history URL → re-run: FAIL on `the paragraph does not name the exact full-history URL`.
3. Restore it; delete the `home-mismatch`/`project-mismatch` sentences from lifecycle step 1 → re-run: FAIL on the missing lifecycle refusal and response-field assertions.
4. Restore; in the same-project arm remove the phrase ``same `sessionId` ``, then separately change `final:false` to `final:true` → each re-run FAILS on the corresponding same-project assertion or ordering check.
5. Restore; in the cross-project arm add the producer `sessionId`, then separately change `final:true` to `final:false`, remove `released:true`, remove the exact closed-row `done` proof, and move dispatch before the independent merge proof → each re-run FAILS on the corresponding cross-project assertion or ordering check.
6. Restore; remove either arm's `If the consumer depends` guard, remove `headRefOid`, or change its equality target from `handoffCommit`/`producerSha` to `mergeCommit.oid` → re-run FAILS on the dependency or same-SHA evidence checks. This proves the test requires merge evidence only for an actual interface dependency and, then, a selected merged PR row at the named producer head rather than merely any merged PR.
7. Restore, re-run the whole suite green: 11 passed.

Record every mutation and its named red in the task's run log. Never use `git checkout --` to restore: re-apply the exact fenced text so no unrelated worktree change is lost.

- [ ] **Step 9: Commit**

```bash
git add README.md CLAUDE.md server/test/crossrepo-prose.test.ts
git commit -m "docs(readme): the two refusals in the lifecycle steps that emit them, and mail by role and programme"
```

---

### Task 3: Preserve the Aug 11 ruling as immutable historical evidence

**Files:**
- Read only: `docs/superpowers/specs/2026-08-11-crossrepo-programmes-design.md`
- Read only: `docs/superpowers/specs/2026-09-08-crossrepo-programmes-design.md`
- Read only: `README.md`

**Interfaces:**
- Consumes: the fetched `origin/main` blob of the historical file; the current build spec's existing `Supersedes for building purposes, inherits for rulings` block; README's pointer written in Task 1.
- Produces: no file change and no new test. The evidence is a byte comparison plus a per-file pointer check recorded in the task run log.

**Spec refs:** the current build spec's header block (`:10-14`) and §1. Its stale §9 phrase about editing the Aug 11 Status line is not an instruction: D-2680–D-2687 and D-2715–D-2720's acceptance correction preserves the historical ruling body and puts current operational corrections only in current prescriptive documents.

**Mutation table:** row W3-3. The byte comparison exits non-zero for any historical-file difference; the two per-file searches exit non-zero if either current prescriptive document loses the historical path or the statement that its rulings stand. Do not manufacture that red by editing the historical file: the comparison itself is the fail-closed guard, and this task is read-only.

Anchor quote from the planning-time current build spec. Re-read the pointer on the wave-2-merged execution base; its authority split, not its historical line number, is what this task checks:

```markdown
**Supersedes for building purposes, inherits for rulings:**
`docs/superpowers/specs/2026-08-11-crossrepo-programmes-design.md` — the Aug 11 design, whose
operator rulings stand verbatim (§1 below)
```

- [ ] **Step 1: Fetch the comparison ref and prove the historical blob exists there**

```bash
git fetch origin main
AUG=docs/superpowers/specs/2026-08-11-crossrepo-programmes-design.md
git cat-file -e "origin/main:$AUG"
```

Expected: both commands exit 0. If the blob cannot be resolved, STOP: no fallback to local `main`, remembered historical text, or an older SHA can prove equality with the named source.

- [ ] **Step 2: Prove the tracked historical file is byte-for-byte identical to `origin/main`**

```bash
git diff --exit-code --no-ext-diff origin/main -- \
  docs/superpowers/specs/2026-08-11-crossrepo-programmes-design.md
```

Expected: exit 0 and no output. Any output is a failure of this task, including a Status-only addition that accurately describes current behavior. Do not author, append, or normalize historical text; current instructions belong in README and the 2026-09-08 build spec. If the diff predates this task, use the exact `origin/main` blob as the restoration source and verify the result again — never reconstruct it by hand.

- [ ] **Step 3: Prove both current prescriptive documents point back and preserve the authority split**

```bash
AUG=docs/superpowers/specs/2026-08-11-crossrepo-programmes-design.md
BUILD=docs/superpowers/specs/2026-09-08-crossrepo-programmes-design.md
for f in README.md "$BUILD"; do
  rg -n -F "$AUG" "$f"
  rg -n -i 'rulings stand' "$f"
done
```

Expected: four successful searches — each of `README.md` and the current build spec names the historical path, and each says its rulings stand. A match in one file cannot satisfy the other file's check.

- [ ] **Step 4: Re-run the prose suite without adding a historical-file test**

Run: `cd server && ./node_modules/.bin/vitest run test/crossrepo-prose.test.ts`

Expected: PASS — 11 passed, exactly the Task 1 and Task 2 blocks. Task 3 appends no `crossrepo-prose` block: comparing a worktree file to a fetched Git ref is a repository gate, not a hermetic package test, and the historical source remains untouched.

- [ ] **Step 5: Finish with no commit**

`git diff --exit-code origin/main -- docs/superpowers/specs/2026-08-11-crossrepo-programmes-design.md` must still be clean. If Task 3 begins with a historical-file diff inherited from an earlier branch commit, restore that path to the exact `origin/main` blob without touching any other file, then repeat Steps 2–4. This task creates no content change and no commit of its own.

---

### Task 4: The programme ledger — waves 1 and 2 closed, and the corrected dogfood exit criteria

**Files:**
- Modify: `docs/superpowers/programs/crossrepo-programmes.md` — the `## Waves` table's rows 1 and 2, and a new `## Dogfood exit criteria` section
- Modify: `server/test/crossrepo-prose.test.ts` — append one describe block

**Interfaces:**
- Consumes: `passage`/`read` from Task 1; the current build spec read here as `BUILD_SPEC`; the merged PRs of waves 1 and 2 (their numbers are read from `origin/main`, not invented — Step 3 gives the command).
- Produces: `ledgerWaves()` and `LEDGER` in `server/test/crossrepo-prose.test.ts`; the ledger's closed wave table and corrected dogfood exit criteria, which the dogfood programme is then measured against.

**Spec refs:** §9 (the three waves and D-2684/D-2687/D-2715/D-2716-corrected dogfood acceptance list), §3 F3 (the mandatory plan read, conditional producer contract, producer-root read, authority split, exact closed-row proof and dependency-gated same-SHA merge proof), §6 (no replicated ledger — the exit criteria live in the home ledger and nowhere else). Template: `docs/superpowers/programs/TEMPLATE.md`.

**Mutation table:** row W3-4. Measured in Step 6 by (a) reverting wave 1's row to `| — | not opened |`, (b) restoring wave 3's old Status-line rewrite or removing wave 2's D-2680–D-2687 and D-2715–D-2720 record, (c) deleting one independently pinned exit-criteria concept, and (d) dropping this dependency-bearing dogfood consumer's `producerRepoRoot` read or weakening its producer evidence from same-SHA merge proof to closed `done` alone: each mutation reds the assertion for the exact reverted, omitted, or weakened fact.

Anchor quotes from the original planning snapshot. Re-read both files on the fetched wave-2-merged execution base before editing the ledger; the current table rows, rather than the snapshots below, decide which cells may change.

`docs/superpowers/programs/crossrepo-programmes.md`, the wave table as it stands (the rows are one long line each; the columns are what matter):

```markdown
## Waves

| # | scope | PRs | state |
|---|---|---|---|
| 1 | Server + shared: `project-mismatch` at open and at dispatch resume, … | — | not opened |
| 2 | Skills + PWA: the coordinator skill's boundary sentences, … | — | not opened |
| 3 | Docs + the legacy flip: current README sections, byte-preservation proof for the historical Aug 11 spec, this ledger's close, and `HOME_PROJECT_LEGACY_ACCEPTED → false` ONLY when `run_events` shows zero `legacy-home-project` events and `runs` shows at least one open over seven consecutive days (measured, or deferred with both measurements recorded). | — | not opened |
```

`docs/superpowers/specs/2026-09-08-crossrepo-programmes-design.md`, §9 — the current corrected acceptance list this task consumes (do not substitute the historical draft's stale template):

```markdown
**Dogfood, as its own programme after wave 2 is live:** home `custom-tools`, wave 1 there, wave 2 in
`data-internal` on real work the operator names, opened without `sessionId`. Acceptance, from the Aug
draft with D-2684/D-2687 and D-2715/D-2716's provenance corrections: the wave-2 brief
carries `homeRepoRoot`, `planRepoPath`, and `planSha` and reads that exact plan blob. Because this
consumer depends on wave 1's producer interface, the brief also carries `producerRepoRoot`,
`producerSourceRepoPath`, the exact merged `producerSha`, and the inline excerpt; the worker reads
that immutable producer source blob through the producer repository while treating the inline
excerpt as the dispatched interface-shape authority. Before dispatch, the coordinator requires the
closed producer row to be `done` and independently proves the producer PR merged at that same SHA. The board shows the crossing on the wave-2 row and the abroad line on the home card; the
ledger's wave table records both PRs across two repos; no content moved by copy-paste;
`project-mismatch` never fires in anger — its proof is a test, not an incident.
```

- [ ] **Step 1: Write the failing tests**

Append to `server/test/crossrepo-prose.test.ts`:

```ts
const LEDGER_PATH = 'docs/superpowers/programs/crossrepo-programmes.md';
const BUILD_SPEC_PATH = 'docs/superpowers/specs/2026-09-08-crossrepo-programmes-design.md';
const LEDGER = read(LEDGER_PATH);
const BUILD_SPEC = read(BUILD_SPEC_PATH);

/** The ledger's wave table alone — the `## Waves` heading to the next `## `. */
const ledgerWaves = (): string => passage('the ledger wave table', LEDGER, '## Waves', '\n## ');

describe('the programme ledger', () => {
  it('records a merged PR for every wave this programme has shipped', () => {
    const table = ledgerWaves();
    const rows = new Map(['1', '2', '3'].map((n) => [
      n, table.split('\n').find((l) => l.startsWith(`| ${n} |`)),
    ]));
    for (const n of ['1', '2']) {
      const row = rows.get(n);
      expect(row, `the ledger has no wave ${n} row`).toBeDefined();
      // A PR NUMBER, not a dash: "the ledger's wave table records both PRs" is
      // one of the dogfood's own exit criteria, and a programme that cannot
      // keep its own table is in no position to hold another one to it.
      expect(row!, `wave ${n} names no PR — the row still reads a dash`).toMatch(/#\d+/);
      expect(row!, `wave ${n} is not closed`).toMatch(/merged/i);
    }
    expect(rows.get('2'), 'wave 2 does not record the allocated acceptance corrections')
      .toMatch(/D-2680[\s\S]*D-2687[\s\S]*D-2715[\s\S]*D-2720/);
    expect(rows.get('3'), 'wave 3 still says it edits the Aug 11 status line')
      .not.toMatch(/Aug 11 spec's status line/i);
    expect(rows.get('3'), 'wave 3 does not name byte-preservation of the historical Aug 11 spec')
      .toMatch(/byte-preservation[\s\S]{0,100}?historical Aug 11 spec/i);
    // Wave 3 is THIS wave and closes in Task 7, so it is deliberately not
    // required to name its PR or read merged here.
  });

  it("carries the build spec's non-provenance dogfood acceptance concepts", () => {
    // The spec paragraph is the source, but the ledger deliberately expands its
    // corrected provenance sentence into independently mutation-pinned bullets.
    // Ground the remaining concepts in the spec before requiring them in the ledger.
    const para = passage("the spec's dogfood paragraph", BUILD_SPEC,
      '**Dogfood, as its own programme', '\n---');
    const checks: Array<[string, RegExp]> = [
      ['the runs-screen crossing cue', /board[\s\S]{0,100}?crossing[\s\S]{0,100}?wave-2 row/i],
      ['the home-card abroad cue', /abroad line[\s\S]{0,80}?home card/i],
      ['both PRs across two repositories', /wave table records both PRs across two repos/i],
      ['the no-copy rule', /no content moved by copy-paste/i],
      ['the refusal-as-test rule', /`project-mismatch`\s+never fires in anger[\s\S]{0,80}?proof is a test/i],
    ];
    const section = passage('the ledger exit criteria', LEDGER,
      '## Dogfood exit criteria', '\n## ');
    for (const [name, pattern] of checks) {
      expect(para, `the current spec no longer carries ${name}; update this derived guard`)
        .toMatch(pattern);
      expect(section, `the ledger's exit criteria drop ${name}`).toMatch(pattern);
    }
  });

  it('names the dogfood pair and the shape of its open, so the criteria have a subject', () => {
    const section = passage('the ledger exit criteria', LEDGER,
      '## Dogfood exit criteria', '\n## ');
    expect(section, 'the exit criteria do not say the wave-2 run opens without a sessionId')
      .toMatch(/opened without `sessionId`/);
    for (const coordinate of [
      'homeRepoRoot', 'planRepoPath', 'planSha', 'producerRepoRoot',
      'producerSourceRepoPath', 'producerSha',
    ]) {
      expect(section, `the dogfood contract does not carry ${coordinate}`).toContain(coordinate);
    }
    expect(section, 'the dogfood never reads the immutable plan blob')
      .toMatch(/reads that exact plan blob/);
    expect(section, 'the dogfood does not say why its conditional producer contract is present')
      .toMatch(/depends on wave 1's producer interface/);
    expect(section, 'the dogfood never reads through the producer repository root')
      .toContain('git -C "$producerRepoRoot" show "$producerSha:$producerSourceRepoPath"');
    expect(section, 'the plan blob is not identified as the requirements authority')
      .toMatch(/plan blob[\s\S]{0,80}?requirements\s+authority/);
    expect(section, 'the dogfood never reads the immutable producer source blob')
      .toMatch(/reads[\s\S]{0,60}?immutable producer source blob/);
    expect(section, 'the producer source blob is not identified as provenance')
      .toMatch(/producer source blob[\s\S]{0,80}?provenance/);
    expect(section, 'the inline excerpt is no longer the dispatched shape authority')
      .toMatch(/inline excerpt[\s\S]{0,100}?dispatched interface-shape authority/);
    expect(section, 'the dogfood does not require the exact closed producer row to be done')
      .toMatch(/closed producer row[\s\S]{0,60}?`done`/);
    expect(section, 'the dogfood treats done as the whole producer guard')
      .toMatch(/independently proves[\s\S]{0,100}?producer PR merged/);
    expect(section, 'the independent merge proof is not tied to the named producer head')
      .toMatch(/selected PR head[\s\S]{0,80}?same `producerSha`/);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd server && ./node_modules/.bin/vitest run test/crossrepo-prose.test.ts`

Expected: FAIL — 11 passed (Tasks 1–2; Task 3 adds no package test), 3 failed: `wave 1 names no PR — the row still reads a dash`; `the ledger exit criteria: the opening anchor is gone` in the non-provenance acceptance test; and that same missing-anchor error in the dogfood-subject/provenance test.

- [ ] **Step 3: Find the two PR numbers, from `main`, not from memory**

```bash
git fetch origin main
git log --oneline --grep=crossrepo origin/main | head -20
```

Expected: the merge commits of waves 1 and 2, each ending in `(#<n>)` — this repo's squash-merge convention (`79cfea2f feat(hook): … (#63)` is the shape). Those two `#<n>` values are what go in the table. If a wave's merge commit does not name a PR, read it from the branch's own merge instead (`git log --oneline origin/main | head -20`); do not invent one.

- [ ] **Step 4: Close the wave table and write the exit criteria**

In `docs/superpowers/programs/crossrepo-programmes.md`, replace the `| — | not opened |` cells of rows 1 and 2 with the measured PR and a state, keeping each row's scope text unchanged:

```markdown
| 1 | Server + shared: `project-mismatch` at open and at dispatch resume, `home-mismatch`, the one migration (`programs.homeProject`, `feed_events.runId`), `homeProject` at open with the legacy generation, `RunSummary.homeProject`, the `worker` mail role, `bindSession` and the heir re-issue, the programme filters on mail and feed, `ccrc-api` rows, both refusal codes named in the coordinator skill. AGENT-FIRST (the skill sentence ships via the install lane). | #<wave-1 PR> | merged <short sha>, deployed agent-first <YYYY-MM-DD> |
| 2 | Skills + PWA: the coordinator skill's project-specific succession and mandatory-plan/conditional-producer contract, canonical `homeProject` open body, dependency-gated closed-row plus exact producer-SHA merge proof, the worker skill's immutable plan read and conditional producer-root read, bounded ask list/answer/release with held-list semantics, safe no-default-id examples, and executable corpus parity across fenced and indented blocks, the runs-screen badge and crossing marker, the fleet card's marker and abroad line, and the mail screen's programme grouping and chip; acceptance corrections D-2680–D-2687 and D-2715–D-2720. AGENT-FIRST. | #<wave-2 PR> | merged <short sha>, deployed agent-first <YYYY-MM-DD> |
| 3 | Docs + the legacy flip: current README sections, byte-preservation proof for the historical Aug 11 spec, this ledger's close, and `HOME_PROJECT_LEGACY_ACCEPTED → false` ONLY when `run_events` shows zero `legacy-home-project` events and `runs` shows at least one open over seven consecutive days (measured, or deferred with both measurements recorded). NOT agent-first (D-2069). | — | not opened |
```

Preserve wave 1's scope cell byte-for-byte and change only its `PRs` and `state` cells. Wave 2's scope cell must retain its current D-2680–D-2687 and D-2715–D-2720 acceptance-correction wording rather than copying this plan's old pre-correction snapshot; change only its `PRs` and `state` cells unless the current row still omits those allocated corrections, in which case add the corrected scope above from the wave-2 plan itself, not from memory. In wave 3's scope cell, replace any inherited `Aug 11 spec's status line` wording with the byte-preservation wording above; this is the ledger correction Task 3's read-only historical boundary requires.

Then insert this section immediately BEFORE `## Decisions & deviations` (replacing the two-line "Dogfood follows as its own program…" paragraph that currently sits above it, whose content this section subsumes):

```markdown
## Dogfood exit criteria

The dogfood programme runs as its **own** programme once wave 2 is live: home `custom-tools`, wave 1
there, wave 2 in `data-internal` on real work the operator names, **opened without `sessionId`** — the
path that spawns fresh in the target repo, which is the only path a crossing may take. Its exit
criteria are the current build spec's §9 acceptance list with D-2684/D-2687 and D-2715/D-2716's
provenance corrections, and this ledger is where they are measured:

- the wave-2 brief carries `homeRepoRoot`, `planRepoPath`, and `planSha`, and the worker reads that exact plan blob as the requirements authority
- because this consumer depends on wave 1's producer interface, the same brief also carries `producerRepoRoot`, `producerSourceRepoPath`, the exact full merged `producerSha`, and the inline excerpt; the worker reads exactly `git -C "$producerRepoRoot" show "$producerSha:$producerSourceRepoPath"`, so that immutable producer source blob proves provenance while the inline excerpt remains the dispatched interface-shape authority
- before consumer dispatch, the coordinator verifies the exact closed producer row is `done`, independently proves the producer PR merged, and proves the selected PR head equals that same `producerSha`; `done` alone is not merge proof
- the board shows the crossing on the wave-2 row and the abroad line on the home card
- the ledger's wave table records both PRs across two repos
- no content moved by copy-paste
- `project-mismatch` never fires in anger — its proof is a test, not an incident

The last one is a claim about an ABSENCE and is therefore only as strong as the traffic behind it: it
is satisfied by a dogfood that actually dispatched both waves, and by nothing else. Record the run ids
beside it when the programme closes.
```

Before running the test, compare the new section against the current build spec paragraph concept by concept. The ledger deliberately expands the corrected provenance sentence so every requirement can fail independently; it may not drop or weaken the plan tuple, this dogfood consumer's explicit producer-interface dependency, `producerRepoRoot`, `producerSourceRepoPath`, full `producerSha`, the exact producer-root read, inline-shape authority, exact closed producer `done`, independent merge proof, same-SHA equality, either board cue, the two-repository PR record, the no-copy rule, or the refusal-as-test rule.

- [ ] **Step 5: Run the tests to verify they pass**

Run: `cd server && ./node_modules/.bin/vitest run test/crossrepo-prose.test.ts`

Expected: PASS — 14 passed.

- [ ] **Step 6: Measure the mutation (row W3-4)**

1. Set wave 1's row back to `| — | not opened |` → re-run: FAIL, 1 test, `wave 1 names no PR — the row still reads a dash`. Restore.
2. Replace wave 3's byte-preservation phrase with `the Aug 11 spec's status line`, then separately remove `D-2680–D-2687 and D-2715–D-2720` from wave 2 → each re-run FAILS on the matching wave-row assertion. Restore between mutations.
3. Delete the `no content moved by copy-paste` bullet → re-run: FAIL, 1 test, `the ledger's exit criteria drop the no-copy rule`. Restore. Repeat once for each of the other four non-provenance patterns so every concept's named red is recorded.
4. Delete `producerRepoRoot`, `producerSourceRepoPath`, or `producerSha`; replace `$producerRepoRoot` with `$PWD`; remove the dependency sentence, the exact producer-root read, or the immutable plan-read statement; or replace the independent same-SHA merge clause with `the producer row is done` → re-run after each single mutation: FAIL on the named coordinate, dependency, read, authority, or exact merge-proof assertion. Restore between mutations.
5. Re-run: 14 passed.

Record all three results in the task's run log.

- [ ] **Step 7: Commit**

```bash
git add docs/superpowers/programs/crossrepo-programmes.md server/test/crossrepo-prose.test.ts
git commit -m "docs(ledger): waves 1 and 2 closed, and the dogfood's exit criteria taken from the spec"
```

---

### Task 5: The legacy flip's precondition — MEASURED, recorded, and the fact that no route can measure it

**Files:**
- Modify: `docs/superpowers/programs/crossrepo-programmes.md` — a new `## Measurements` section
- Modify: `server/test/crossrepo-prose.test.ts` — append one describe block
- Reads only (no edit): `server/src/coord/routes.ts`, `server/src/coord/schema.ts`, `server/src/coord/store.ts`

**Interfaces:**
- Consumes: `passage`/`read`/`LEDGER` from Tasks 1 and 4; wave 1's run event `legacy-home-project`, written through `CoordStore.recordRunEvent(runId, causedBy, detail)` (`server/src/coord/store.ts:1138-1145`), whose event NAME lands in the `detail` column.
- Produces: the two numbers `legacy_7d` and `opens_7d`, and the ledger's `## Measurements` block that records them with a date; and the finding that this criterion is an operator act.

**Spec refs:** §3 F2 (the legacy generation and its criterion: "shipped as its own PR when `run_events` shows zero `legacy-home-project` events over seven consecutive days — a measurable criterion, not a judgement"), §10 (the flip is dated by evidence, not by the spec).

**Mutation table:** row W3-5. Measured in Step 7 by deleting the `## Measurements` block: the passage's opening-anchor assertion reds; by deleting either number from it: the per-number regex reds naming which one.

**LEDGER:** two findings, both about the criterion rather than the mechanism.

1. **The criterion's own data has no reader.** Spec §3 F2 says the flip ships "when `run_events` shows zero `legacy-home-project` events over seven consecutive days", which reads as though a coordinator could check it. Measured at `d0064e6e`: `run_events` is exposed by **no HTTP route at all**. `git grep -n "run_events" server/src/coord/routes.ts` finds exactly one hit and it is a COMMENT (`:1427`); `git grep -n "runEvents" server/src/coord/routes.ts` finds none; the ten `app.get('/api…')` registrations in that file serve mail, caps, runs, run items, the feed, lifecycle, peers, claims and the ledger — none of them the run-event trail. `CoordStore.runEvents` (`store.ts:1580`) has no caller outside `server/test`. So the criterion is an **operator act on the server box**, not something the programme's own machinery can answer, and this wave says so rather than implying otherwise. Adding a route is a new surface with its own gating decision and belongs to a later wave, if ever (**D-2066**).
2. **"Zero over seven days" is satisfied by seven days of nothing.** A box that opened no runs at all in the window reports zero legacy events, and so does a box where every coordinator now sends `homeProject` — the criterion cannot tell those apart, and the first is not evidence of anything. This wave therefore measures **two** numbers in the same window and requires both: zero `legacy-home-project` events AND a non-zero count of runs opened. Recorded rather than silently strengthened, because it changes what the spec's own sentence means (**D-2067**).

Anchor quotes from the original planning snapshot. Re-run Step 1 on the execution base before trusting the no-reader claim; if a reader has shipped, correct D-2066's prescribed ledger text instead of copying the stale snapshot.

`server/src/coord/store.ts:1138-1145` — the writer, and why the event name is in `detail`:

```ts
  recordRunEvent(runId: number, causedBy: string, detail: string, at: number = Date.now()): void {
    const row = this.db.prepare('SELECT state FROM runs WHERE id = ?').get(runId) as
      { state: string } | undefined;
    if (!row) return;
    this.db.prepare(
      'INSERT INTO run_events (runId, at, fromState, toState, causedBy, detail) VALUES (?, ?, ?, ?, ?, ?)',
    ).run(runId, at, row.state, row.state, causedBy, detail);
  }
```

`server/src/coord/schema.ts:99-108` — the table and its columns, with `at` in milliseconds (it is `Date.now()`):

```sql
  CREATE TABLE run_events (
    id        INTEGER PRIMARY KEY AUTOINCREMENT,
    runId     INTEGER NOT NULL REFERENCES runs(id),
    at        INTEGER NOT NULL,
    fromState TEXT NOT NULL,
    toState   TEXT NOT NULL,
    causedBy  TEXT NOT NULL,              -- 'coordinator' | 'operator' | <session id>
    detail    TEXT
  );
  CREATE INDEX run_events_by_run ON run_events(runId, at);
```

`server/src/coord/schema.ts:90` — the runs column the second number counts (`openedAt`, NOT `createdAt`; `createdAt` belongs to `programs`, `:69`):

```sql
    openedAt      INTEGER NOT NULL,
```

`server/src/coord/routes.ts:1427` — the single `run_events` mention in the whole route file, and it is a comment:

```ts
    // A `run_events` row would be WRONG here: there is no run, and
```

- [ ] **Step 1: Measure that no route exposes the trail (this is the D-2066 evidence)**

```bash
git grep -n "run_events" server/src/coord/routes.ts
```

Expected, exactly one line:

```
server/src/coord/routes.ts:1427:    // A `run_events` row would be WRONG here: there is no run, and
```

```bash
cd <repo root> && git grep -n "runEvents" server/src/coord/routes.ts; echo "exit=$?"
```

Expected: no output, `exit=1` — git grep's "no match".

```bash
cd <repo root> && git grep -n "app.get('/api" server/src/coord/routes.ts
```

Expected: ten lines — `/api/mail`, `/api/mail/:id`, `/api/coord/caps`, `/api/runs`, `/api/runs/:id/items`, `/api/feed`, `/api/lifecycle`, `/api/peers`, `/api/claims`, `/api/ledger`. Wave 1 may have widened some of their queries; it adds no route that reads `run_events`. If one of the three commands answers differently, a later wave shipped a reader and the LEDGER note above must be corrected in the same commit rather than left standing.

- [ ] **Step 2: Write the failing test**

Append to `server/test/crossrepo-prose.test.ts`:

```ts
describe('the legacy-flip measurement is recorded, whichever way it went', () => {
  it('the ledger carries both numbers and the date they were taken', () => {
    // WHY BOTH NUMBERS (D-2067): spec §3 F2's
    // criterion is "zero `legacy-home-project` events over seven consecutive
    // days", and a box that opened no runs at all in the window satisfies it
    // while proving nothing. `opens_7d` is the denominator that makes the zero
    // mean something, and the ledger must carry it beside the numerator or the
    // record is not a measurement.
    const m = passage('the ledger measurement block', LEDGER, '## Measurements', '\n## ');
    expect(m, 'the measurement does not name the event it counted')
      .toContain('legacy-home-project');
    expect(m, 'the measurement records no legacy-event count').toMatch(/legacy_7d\s*=\s*\d+/);
    expect(m, 'the measurement records no run-open count — the zero above means nothing without it')
      .toMatch(/opens_7d\s*=\s*\d+/);
    expect(m, 'the measurement is undated, so nobody can tell whether the window has moved')
      .toMatch(/20\d\d-\d\d-\d\d/);
  });

  it('and says the read was an operator act, because no route can serve it', () => {
    const m = passage('the ledger measurement block', LEDGER, '## Measurements', '\n## ');
    expect(m, 'the measurement does not say where it was taken').toContain('coord.db');
    // Grounded, so the sentence reds the day a route DOES serve the trail:
    // if `runEvents` ever appears in the route file, this claim is stale.
    expect(ROUTES, 'a route now reads runEvents — the ledger sentence calling this an ' +
      'operator act is now false and must be corrected').not.toContain('runEvents');
  });
});
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `cd server && ./node_modules/.bin/vitest run test/crossrepo-prose.test.ts`

Expected: FAIL — 14 passed (Tasks 1, 2 and 4; Task 3 adds no package test), 2 failed, both on `the ledger measurement block: the opening anchor is gone`.

- [ ] **Step 4: Take the measurement — an OPERATOR act, on the server box**

This step is **not** run by the implementing session against the live fleet. It is handed to the operator, who runs it on the server box and returns two integers. It prints counts only — never a row, never a body, never a token.

```bash
sqlite3 -readonly ~/.ccrc/coord.db "
SELECT
  (SELECT COUNT(*) FROM run_events
     WHERE detail LIKE 'legacy-home-project%'
       AND at >= (CAST(strftime('%s','now') AS INTEGER) - 7*86400) * 1000) AS legacy_7d,
  (SELECT COUNT(*) FROM runs
     WHERE openedAt >= (CAST(strftime('%s','now') AS INTEGER) - 7*86400) * 1000) AS opens_7d;
"
```

`-readonly` so this arm makes the same promise the node fallback below already does with `{ readOnly: true }`: this read never writes to a file the running server owns, and cannot create a `-wal`/`-shm` companion beside it.

If `sqlite3` is not installed on that box, the identical read through the engine the server itself uses:

```bash
node --input-type=module -e "
import { DatabaseSync } from 'node:sqlite';
import os from 'node:os';
import path from 'node:path';
const db = new DatabaseSync(path.join(os.homedir(), '.ccrc', 'coord.db'), { readOnly: true });
const since = Date.now() - 7 * 86400 * 1000;
const legacy = db.prepare(\"SELECT COUNT(*) AS n FROM run_events WHERE detail LIKE 'legacy-home-project%' AND at >= ?\").get(since).n;
const opens = db.prepare('SELECT COUNT(*) AS n FROM runs WHERE openedAt >= ?').get(since).n;
console.log('legacy_7d =', legacy, ' opens_7d =', opens);
"
```

Notes on the SQL, so nobody has to re-derive it:

- `at` and `openedAt` are **milliseconds** (`Date.now()`, `store.ts:1143`), which is why the epoch seconds are multiplied by 1000.
- `detail LIKE 'legacy-home-project%'` rather than `=`: the event NAME is the contract, and wave 1 is free to append a qualifier to the detail string. A prefix match cannot under-count; an equality match silently could.
- The window is a rolling seven days from now. "Seven CONSECUTIVE days" is what a single such read over a box that has been up throughout means; if the server was restarted mid-window that is fine (the table is durable), but if the box was DOWN for part of it, say so in the record — a window with a hole is not seven days.

- [ ] **Step 5: Record the measurement in the ledger**

In `docs/superpowers/programs/crossrepo-programmes.md`, insert a new section immediately BEFORE `## Carried constraints`:

```markdown
## Measurements

**The legacy-generation flip criterion (spec §3 F2), taken <YYYY-MM-DD> on the server box.**
`legacy_7d = <n>` — `run_events` rows whose `detail` begins `legacy-home-project`, in the rolling
seven-day window. `opens_7d = <n>` — runs opened in the same window.

The read is an **operator act**: `run_events` is exposed by no HTTP route (measured — the only mention
in `server/src/coord/routes.ts` is a comment at `:1427`, and `CoordStore.runEvents` has no caller
outside `server/test`), so the count comes from `sqlite3 ~/.ccrc/coord.db` on the server box and from
nowhere else. It prints two integers and no rows.

**The gate this wave applies:** flip only when `legacy_7d = 0` **and** `opens_7d > 0`. The second
number is not in the spec's sentence and is the reason this block exists: seven days in which nothing
was opened also reports zero legacy events, and that is an absence of traffic, not evidence that the
legacy branch went unused.
```

> D-2752: this sentence is false — the spec carries both numbers (§3 F2, citing D-2067); ship the corrected form D-2752 records.

- [ ] **Step 6: Run the test to verify it passes**

Run: `cd server && ./node_modules/.bin/vitest run test/crossrepo-prose.test.ts`

Expected: PASS — 17 passed.

- [ ] **Step 7: Measure the mutation (row W3-5)**

1. Delete the `## Measurements` block → re-run: FAIL, 2 tests, `the ledger measurement block: the opening anchor is gone`. Restore.
2. Delete the `opens_7d = <n>` sentence → re-run: FAIL, 1 test, `the measurement records no run-open count — the zero above means nothing without it`. Restore.
3. Re-run: 16 passed.

- [ ] **Step 8: Commit**

```bash
git add docs/superpowers/programs/crossrepo-programmes.md server/test/crossrepo-prose.test.ts
git commit -m "docs(ledger): the flip criterion measured, and the denominator the criterion lacked"
```

---

### Task 6: The legacy flip — `HOME_PROJECT_LEGACY_ACCEPTED → false`

**EXECUTE THIS TASK ONLY IF TASK 5'S GATE OPENED**, i.e. the operator's read answered `legacy_7d = 0` **and** `opens_7d > 0`. If either fails, this task is **DEFERRED**: skip it entirely, leave the constant `true`, and in `docs/superpowers/programs/crossrepo-programmes.md` change the wave-3 row's state to name the deferral and the numbers (`deferred — legacy_7d = <n>, opens_7d = <n> on <date>; flip carried to a later wave`). The measurement is already recorded by Task 5, so a deferral costs one table cell and nothing else. **Deferring is a legitimate outcome of this wave, not a failure of it** — the spec dates this flip by evidence, and evidence that has not arrived is not a reason to ship the change anyway.

**Files:**
- Create: `server/test/home-project-required.test.ts`
- Modify: `server/src/coord/routes.ts` — the constant `HOME_PROJECT_LEGACY_ACCEPTED` only
- Modify: `server/test/home-project.test.ts` — wave 1's pure-function suite; the one assertion on `HOME_PROJECT_LEGACY_ACCEPTED`'s shipped value (Step 3 confirms its line), plus the pure `required` case that replaces the route test Step 4 deletes from `run-routes.test.ts`
- Modify: `server/test/run-routes.test.ts` (`OPEN_BODY`, `:50`, and the two cases that change forces through `postOpen`'s default) and `server/test/coord-caps-route.test.ts` (`:355-358`) — both send a `POST /api/runs` body the flip would refuse (Step 4)

**Interfaces:**
- Consumes: wave 1's `HOME_PROJECT_LEGACY_ACCEPTED` (`server/src/coord/routes.ts`), the require branch it gates, and the run event `legacy-home-project` it stops writing; `testDeps` (`server/test/helpers.ts`), `mkTmp` (`server/test/tmpHelpers.ts`), `openCoordDb`, `CoordStore`, `buildServer`.
- Produces: `POST /api/runs` requiring `homeProject`, and `server/test/home-project-required.test.ts` as the pin on both halves of that (the shipped constant, and the behaviour through the route).

**Spec refs:** §3 F2 (the legacy generation, "the flip to required is a one-constant change … whose test flips the constant and asserts both branches, shipped as its own PR"), §7 (the `legacy-generation constant` row), §10.

**Mutation table:** row W3-6. Measured in Step 9 by setting the constant back to `true`: the value assertion reds with `expected 'true' to be 'false'` and the route test reds with `expected 200 to be 400`.

**ANCHOR, HONESTLY.** `HOME_PROJECT_LEGACY_ACCEPTED` does **not exist at this plan's base** (`d0064e6e`) — wave 1 declares it, so no line number here could be anything but invented. Locate it, and its require branch, before editing:

```bash
git grep -n "HOME_PROJECT_LEGACY_ACCEPTED" server/src server/test
```

Expected: at least one hit in `server/src/coord/routes.ts` (the `const … = true;` declaration and its use in the open route's validation), plus wave 1's own suite. The declaration is what Step 4 edits; the **use** is the require branch and is left exactly as wave 1 wrote it.

What the open route looked like BEFORE wave 1 widened it — quoted so the require branch is recognisable when you read it, `server/src/coord/routes.ts:935-945`:

```ts
    const body = (req.body ?? {}) as Record<string, unknown>;
    const { program, title, project, wave, waveOf, claimedBy, sessionId } = body;
    if (typeof program !== 'string' || program.trim() === '' ||
        typeof title !== 'string' || title.trim() === '' ||
        typeof project !== 'string' || project.trim() === '' ||
        typeof claimedBy !== 'string' || claimedBy.trim() === '' ||
        typeof wave !== 'number' || !Number.isInteger(wave) || wave < 1 ||
        !(waveOf === undefined || waveOf === null || (typeof waveOf === 'number' && Number.isInteger(waveOf))) ||
        !(sessionId === undefined || (typeof sessionId === 'string' && sessionId.trim() !== ''))) {
      return reply.code(400).send({ ok: false, error: 'bad-request' });
    }
```

`server/test/run-routes.test.ts:117-134` — the harness idiom this task's new suite copies (a fixture HOME, a coord db inside it, a no-op runner, the box-token header), quoted whole including its comment:

```ts
const openApp = async (
  home: string, run: Runner, over: Partial<Omit<Deps, 'cfg'>> & { cfg?: Partial<Deps['cfg']> } = {},
) => {
  // The registry directory always exists on a real fleet host once ccd has
  // ever run — the pause check's own fail-shut-on-unlistable rule is about a
  // LISTING that failed, not a fixture that never created the directory a
  // real box always has. Every fixture below gets this baseline for free, the
  // same way `seed()` already creates it as a side effect of writing a real
  // session's fields.
  mkdirSync(path.join(home, '.cc-sessions'), { recursive: true });
  const coord = new CoordStore(openCoordDb(path.join(home, '.ccrc', 'coord.db')));
  const base = testDeps(home, run);
  const app = await buildServer({ ...base, mailToken: TOKEN, coord, ...over, cfg: { ...base.cfg, ...(over.cfg ?? {}) } });
  return { app, coord };
};

const tokenHeaders = (token: string | null): Record<string, string> =>
  token === null ? {} : { 'x-ccrc-mail-token': token };
```

- [ ] **Step 1: Write the failing test**

Create `server/test/home-project-required.test.ts`:

```ts
// The legacy generation ends here. Spec §3 F2 accepted a missing `homeProject`
// for ONE deploy generation, recorded each acceptance as a `legacy-home-project`
// run event, and dated the flip by evidence rather than by the calendar: zero
// such events over seven consecutive days. That measurement was taken (the
// programme ledger's `## Measurements` block carries it and its date), and this
// suite is what holds the flip shut afterwards.
//
// TWO ASSERTIONS, DELIBERATELY, because they fail differently. The text pin
// catches a revert of the constant even if the route were later rewritten; the
// route test catches a require branch that stops requiring even while the
// constant still reads `false`. Either alone leaves half the guard unmeasured.
import { describe, it, expect, afterEach } from 'vitest';
import { mkdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { FastifyInstance } from 'fastify';
import { buildServer } from '../src/server.js';
import { openCoordDb } from '../src/coord/db.js';
import { CoordStore } from '../src/coord/store.js';
import type { Runner } from '../src/exec.js';
import { testDeps } from './helpers.js';
import { mkTmp } from './tmpHelpers.js';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const ROUTES = readFileSync(path.join(REPO, 'server/src/coord/routes.ts'), 'utf8');

const TOKEN = 'f'.repeat(64);
/** Nothing in this suite reaches ccd: an open with no `sessionId` places no
 *  hold, so the runner is never called. It exists because `testDeps` requires
 *  one. */
const runner: Runner = async () => ({ code: 0, stdout: '', stderr: '' });

const OPEN_BODY = {
  program: 'crossrepo-fixture', title: 'Wave one', project: 'demo',
  wave: 1, waveOf: 3, claimedBy: 'ccrc-pwa-coordinator',
};

const openApp = async () => {
  const home = mkTmp('ccrc-home-project-');
  mkdirSync(path.join(home, '.cc-sessions'), { recursive: true });
  const coord = new CoordStore(openCoordDb(path.join(home, '.ccrc', 'coord.db')));
  const app = await buildServer({ ...testDeps(home, runner), mailToken: TOKEN, coord });
  return { app, coord };
};

const postOpen = (app: FastifyInstance, body: unknown) =>
  app.inject({
    method: 'POST', url: '/api/runs',
    headers: { 'x-ccrc-mail-token': TOKEN },
    payload: body as Record<string, unknown>,
  });

describe('homeProject is required at open (the legacy generation is over)', () => {
  let app: FastifyInstance | undefined;
  afterEach(async () => { if (app) await app.close(); app = undefined; });

  it('ships with the legacy constant FALSE', () => {
    const m = /HOME_PROJECT_LEGACY_ACCEPTED\s*(?::\s*boolean\s*)?=\s*(true|false)/.exec(ROUTES);
    expect(m, 'HOME_PROJECT_LEGACY_ACCEPTED is gone from coord/routes.ts — wave 1 declared it, and ' +
      'the flip is a change to its VALUE, never a deletion of the constant').not.toBeNull();
    expect(m![1], 'the legacy generation was re-opened without a measurement').toBe('false');
  });

  it('refuses an open with no homeProject, and leaves no orphan behind', async () => {
    // NO `detail` HERE, DELIBERATELY. Wave 1's `required` branch
    // (`docs/superpowers/plans/2026-09-08-crossrepo-wave1-server.md`, the
    // `homeVerdict.kind === 'required'` arm) sends the bare
    // `{ ok: false, error: 'bad-request' }` — the same shape as the four
    // other `bad-request` sends in that route file — and the cross-wave
    // contract names no `detail` on this refusal either. Asserting one would
    // make greening this suite a route change beyond the single constant the
    // flip is supposed to be (spec §3 F2, this plan's own Architecture line:
    // "the one code change in the wave is a single constant"). What DOES
    // carry real information, and is asserted below, is that a refused open
    // leaves nothing behind — no `planned` run, no minted programme row.
    const w = await openApp(); app = w.app;
    const res = await postOpen(app, OPEN_BODY);
    expect(res.statusCode, 'an open with no homeProject was accepted').toBe(400);
    const body = JSON.parse(res.body) as { ok: boolean; error: string };
    expect(body).toEqual({ ok: false, error: 'bad-request' });
    expect(w.coord.runs().length, 'a refused open left a planned orphan behind').toBe(0);
    expect(w.coord.programs().some((p) => p.slug === 'crossrepo-fixture'),
      'a refused open still minted the programme row').toBe(false);
  });

  it('still opens when homeProject is given, and records no legacy event', async () => {
    const w = await openApp(); app = w.app;
    const res = await postOpen(app, { ...OPEN_BODY, homeProject: 'demo' });
    expect(res.statusCode, 'a well-formed open was refused').toBe(200);
    const body = JSON.parse(res.body) as { ok: boolean; id: number; ledgerRepo: string | null };
    expect(body.ok).toBe(true);
    expect(body.ledgerRepo, 'the response does not carry the home the body just declared')
      .toBe('demo');
    // The event the flip exists to stop: with the constant false there is no
    // accept branch left to write one.
    expect(w.coord.runEvents(body.id).map((e) => e.detail))
      .not.toContain('legacy-home-project');
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd server && ./node_modules/.bin/vitest run test/home-project-required.test.ts`

Expected: FAIL — 2 failed, 1 passed. `ships with the legacy constant FALSE` fails with `expected 'true' to be 'false'`; `refuses an open with no homeProject…` fails with `expected 200 to be 400` (the accept branch is still live). The third test passes already — wave 1 shipped the accept path and `ledgerRepo`; note that in the run record rather than treating it as a miss.

- [ ] **Step 3: Find wave 1's own constant test, so both move in one commit**

```bash
cd <repo root> && git grep -n "HOME_PROJECT_LEGACY_ACCEPTED" server/test
```

Wave 1's suite flips the constant in-test and asserts BOTH branches (spec §7). Its both-branches structure **stays**; only an assertion about the SHIPPED value — if it has one — changes from `true` to `false`. Read the hits before editing, and change nothing else in that file.

- [ ] **Step 4: Update the fixtures the flip breaks — BEFORE flipping the constant**

Three files need editing before the constant moves. Two of them send `POST /api/runs` bodies with no `homeProject` and would be refused 400 the moment it flips; the third is wave 1's PURE-function suite, which asserts the constant's own shipped value and drives the branch the flip makes live. `server/test/run-routes.test.ts` appears TWICE below — once for the shared body every open in it spreads, and once for the two cases that body's change forces — because both edits land in the same file and a reader who stops at the first block would ship a red suite. Fixed here, first, so Step 6's "run the tests" is a real green rather than a green that is only real because the constant has not moved yet.

**`server/test/run-routes.test.ts:50`** — the shared `OPEN_BODY` every open in that file spreads from:

```ts
const OPEN_BODY = { program: 'build4', title: 'Transcript surface', project: PROJECT,
  wave: 1, waveOf: 3, claimedBy: CLAIMED_BY };
```

becomes:

```ts
const OPEN_BODY = { program: 'build4', title: 'Transcript surface', project: PROJECT,
  wave: 1, waveOf: 3, claimedBy: CLAIMED_BY, homeProject: PROJECT };
```

Every open in that file spreads `OPEN_BODY` (`...OPEN_BODY`) or passes it as-is (`grep -n "OPEN_BODY" server/test/run-routes.test.ts` finds two dozen call sites and not one second body literal) — so no other BODY in that file needs touching. Two of those call sites do, though, and for the opposite reason: their subject was the absence this line just removed. They are the last block of this step.

**`server/test/coord-caps-route.test.ts:355-358`** — the one inline `POST /api/runs` payload in the file:

```ts
    const opening = app.inject({ method: 'POST', url: '/api/runs',
      headers: { 'x-ccrc-mail-token': TOKEN },
      payload: { program: 'p', title: 'P', project: 'demo', wave: 1, waveOf: 8,
                 claimedBy: 'the-coordinator', sessionId: 'the-worker' } });
```

becomes:

```ts
    const opening = app.inject({ method: 'POST', url: '/api/runs',
      headers: { 'x-ccrc-mail-token': TOKEN },
      payload: { program: 'p', title: 'P', project: 'demo', wave: 1, waveOf: 8,
                 claimedBy: 'the-coordinator', sessionId: 'the-worker', homeProject: 'demo' } });
```

**`server/test/home-project.test.ts`** (wave 1's PURE-function suite — it imports `{ HOME_PROJECT_LEGACY_ACCEPTED, homeProjectVerdict }` and nothing else: no `mkTmp`, no `openApp`, no `postOpen`, no route in it anywhere) — TWO edits, neither of them covered by Step 3's "change nothing else in that file" (that instruction covers only the SHIPPED-value assertion; these two are the flip's own fallout on this file):

1. The shipped-value assertion — the same line Step 3 located. **Apply this one in Step 6, beside the constant**, not here: an assertion reading `false` while the shipped constant still reads `true` would red Step 5's before-the-flip green for a reason that is not a mistake. Step 6's closing line is where it lands.

```ts
  it('is shipped in the legacy generation — and this is the line wave 3 changes', () => {
    expect(HOME_PROJECT_LEGACY_ACCEPTED).toBe(true);
  });
```

becomes:

```ts
  it('is shipped in the legacy generation — and this is the line wave 3 changed', () => {
    expect(HOME_PROJECT_LEGACY_ACCEPTED).toBe(false);
  });
```

2. The pure case that REPLACES the route-level test deleted below (next block, point 1). Add it inside `describe('homeProjectVerdict', ...)`, beside the cases wave 1 wrote there — an absent home on a programme this box has never seen, decided by the constant alone, now that the constant is the one that refuses:

```ts
  it('an absent home for a brand-new programme is refused once the constant is false', () => {
    expect(homeProjectVerdict({ body: undefined, known: false, stored: null, legacyAccepted: false }))
      .toEqual({ kind: 'required' });
  });
```

`{ kind: 'required' }` is wave 1's own verdict for an absent home that is no longer tolerated — its `homeProjectVerdict` returns `input.legacyAccepted ? { kind: 'legacy' } : { kind: 'required' }` for `body === undefined`, and the route answers that verdict with `400 { ok: false, error: 'bad-request' }`. Wave 1 already exercises this input inside its flip case (`const absent = { body: undefined, known: false, stored: null }`, both `legacyAccepted` branches asserted off that one spread), so this is not new coverage: it is the deleted route test's subject, restated as its own named case in the file that can still hold it, so the deletion below reads as a MOVE rather than as a branch quietly going dark.

**`server/test/run-routes.test.ts`** (again — the same file whose `OPEN_BODY` this step already edits) — TWO further edits. The `OPEN_BODY` change above is what forces these two, because `postOpen(app)` defaults to `OPEN_BODY` (`run-routes.test.ts:136`): every call that passed no body now sends a `homeProject`, so the two cases whose whole subject was a body WITHOUT one stop testing what they were written to test the moment that line changes — before the constant moves at all.

1. DELETE `'accepts an absent homeProject during the legacy generation, records it, and leaves the column NULL'` (wave 1 Task 4 Step 2 writes it into `describe('POST /api/runs')`, and it is the case that asserts `programHome` stays NULL, `ledgerRepo`/`ledgerAbsPath` come back null, and a `legacy-home-project` event is recorded). It drives the ROUTE's acceptance of a legacy-shaped body — a path the shipped route no longer has once the constant reads `false` — and after the `OPEN_BODY` edit its own `postOpen(app)` no longer even sends a legacy-shaped body. Deleted rather than rewritten, because there is no accept branch left to point it at; its pure content is added to `home-project.test.ts` by the previous block's point 2, in the same commit.

2. `'backfills a NULL stored home from a later open, and records the event'` is a ROUTE-level integration test — it exercises `coord.setProgramHome` and `coord.recordRunEvent`, both fired by the route's backfill branch, and it must keep doing so; only its PRECONDITION changes. Its first open was a legacy-shaped `postOpen(app)`, which the `OPEN_BODY` edit has already stopped being one, and which after the flip the route would refuse outright — so the "known programme whose home is still NULL" it needs is seeded directly on the STORE instead, bypassing the route's now-mandatory check the same way `mail-routes.test.ts:618-619` already seeds programmes for its own fixtures (`w.coord.openRun({ program: 'pA', ... })`, no HTTP involved):

```ts
  it('backfills a NULL stored home from a later open, and records the event', async () => {
    const home = mkTmp('ccrc-runs-');
    const { run } = makeRunner(home);
    const w = await openApp(home, run); app = w.app;
    // Seeded on the STORE, not through the route: after the flip a route open
    // with no `homeProject` is refused outright, so the route itself can no
    // longer produce "a known programme whose home is still NULL" — only the
    // store's own `openRun`, whose `homeProject` stays optional, still can.
    w.coord.openRun({ program: 'build4', title: 'Transcript surface', project: PROJECT,
      wave: 1, waveOf: 3, claimedBy: CLAIMED_BY });
    expect(w.coord.programHome('build4')).toBeNull();
    const second = await postOpen(app, { ...OPEN_BODY, wave: 2, homeProject: 'demo' });
    expect(second.statusCode).toBe(200);
    expect(w.coord.programHome('build4')).toBe('demo');
    const id = (second.json() as { id: number }).id;
    expect(w.coord.runEvents(id).map((e) => e.detail)).toContain('home-project-backfilled');
  });
```

- [ ] **Step 5: Run the three edited files, still against the UNFLIPPED constant**

```bash
cd server && ./node_modules/.bin/vitest run test/home-project.test.ts test/run-routes.test.ts test/coord-caps-route.test.ts
```

Expected: PASS, all three, with the constant still `true`. Step 4 edited exactly these three files and this list is all of them: `run-routes.test.ts` (the shared `OPEN_BODY`, plus the deleted legacy-acceptance case and the backfill case's store-seeded precondition), `coord-caps-route.test.ts` (its one inline open body) and `home-project.test.ts` (the added pure `required` case). Every one of those edits stands on its own: the two fixture files now send a `homeProject` they did not yet need to send, the deleted case had already stopped testing its own subject the moment `OPEN_BODY` changed, and the added pure case names its own `legacyAccepted` and so never reads the shipped constant at all. The ONE edit that does read it — Step 4's `home-project.test.ts` point 1, the shipped-value assertion — is deliberately held back to Step 6, which is why this green is a real green rather than a rewrite that happens to pass. A red at this step is a Step 4 mistake, not a flip effect, and must be fixed before Step 6.

- [ ] **Step 6: Flip the constant**

In `server/src/coord/routes.ts`, at the declaration Step 3 located, change the value and update its comment to say what the value now means and what evidence changed it:

```ts
/** The one-deploy-generation tolerance for an open that omits `homeProject`
 *  (spec §3 F2), and the switch that ends it. `true` accepted the omission and
 *  recorded a `legacy-home-project` run event, leaving the programme row's home
 *  NULL; `false` refuses the open outright with the route's bare `bad-request`
 *  (`{ ok: false, error: 'bad-request' }`, no `detail` — wave 1's deliberate shape).
 *
 *  FLIPPED TO `false` on the measurement, not on the calendar: zero
 *  `legacy-home-project` events in a rolling seven-day window in which runs were
 *  actually opened. `run_events` is served by no route, so that read is an
 *  operator act on the server box and its two numbers are recorded in
 *  `docs/superpowers/programs/crossrepo-programmes.md`'s `## Measurements`
 *  block. Both branches stay in the tree and both stay tested — this is a value
 *  change, never a deletion. */
const HOME_PROJECT_LEGACY_ACCEPTED = false;
```

Then apply Step 4's `home-project.test.ts` point 1 — the shipped-value assertion Step 3 located and Step 5 deliberately ran against — so the constant and the one pin on its shipped value move together, in this commit.

- [ ] **Step 7: Run the tests to verify they pass**

```bash
cd server && ./node_modules/.bin/vitest run test/home-project-required.test.ts test/home-project.test.ts test/run-routes.test.ts test/coord-caps-route.test.ts test/coord-store.test.ts test/mail-routes.test.ts
```

Expected: PASS — every suite in that list green, unconditionally: `home-project-required` 3 passed, `home-project.test.ts` with its shipped-value assertion now reading `false` and the pure `required` case Step 4 added, `run-routes.test.ts` with its legacy-acceptance case gone and its backfill case seeded on the store, and `coord-caps-route`/`coord-store`/`mail-routes` unaffected because Step 4 and Step 5 already made them so. There is no conditional branch left in this expectation: a red anywhere in this list is a real break, not a fixture whose body predates `homeProject` (Step 4 already fixed every such fixture) — investigate rather than patching a body here.

- [ ] **Step 8: The whole server suite, because this is a route change and not prose**

```bash
cd server && npm run test
```

Expected: PASS. Known load flakes (`ccd-ws-gc`, `pr-sweep`, `session-hook`, `typecheck-tests`, `ccd-session-state`) are re-run IN ISOLATION before being called a break. Any other failure naming a run open is a fixture Step 4 missed — find it with `git grep -n "url: '/api/runs'" server/test`, add `homeProject`, never soften the route.

- [ ] **Step 9: Measure the mutation (row W3-6)**

Set the constant back to `true`, re-run:

```bash
cd server && ./node_modules/.bin/vitest run test/home-project-required.test.ts
```

Expected: FAIL — 2 failed (`expected 'true' to be 'false'`, `expected 200 to be 400`). Restore `false` and re-run: 3 passed.

**LEDGER:** the flip is spec §3 F2's own PR, and this worker cannot open one. Spec §3 F2 and this plan's own cross-wave contract both say the flip ships "as its own PR", but a worker commits only on this workspace's own branch and opens no second one (house rule, not a choice this task makes) — so the flip commit necessarily lands on the same branch as every other commit in this wave, and therefore rides inside whatever PR that branch becomes unless a human moves it afterward. Recorded rather than silently done another way (**D-2070**); Step 10 states what this worker DOES do (name the commit as a distinct handoff item) and what only the coordinator can do about the rest.

- [ ] **Step 10: Close the wave-3 row and commit**

In `docs/superpowers/programs/crossrepo-programmes.md`, set the wave-3 row's state to the measured fact this worker can state — never "merged", which is true only once a human has done it:

```markdown
worker branch <short sha>; flipped <YYYY-MM-DD> on legacy_7d = 0, opens_7d = <n>
```

(`<short sha>` = `git rev-parse --short HEAD` taken AFTER this commit.) Task 7 Step 7 restates this once more as the wave's actual closing edit and is what the coordinator's post-merge edit builds on — this value is provisional, not a promise about `main`.

```bash
git add server/src/coord/routes.ts server/test/home-project-required.test.ts \
  server/test/home-project.test.ts server/test/run-routes.test.ts server/test/coord-caps-route.test.ts \
  docs/superpowers/programs/crossrepo-programmes.md
git commit -m "feat(runs): homeProject is required at open — the legacy generation ends on the measurement"
```

Report this commit's short sha to the coordinator as a **distinct handoff item**, named separately from the rest of the wave's work (D-2070, above) — the coordinator decides from there whether it cherry-picks onto its own branch and merges it as its own server-lane PR after the docs PR (`bash deploy/deploy.sh`, and it must not go out before the docs it depends on), or accepts it riding inside the docs PR with the operator's sign-off waiving spec §3 F2's separation for this wave. Either way, the choice and its reason belong in the ledger's `## Decisions & deviations`, written by whoever makes it — not assumed here.

---

### Task 7: Whole-branch gate, the ledger's final row, and the deploy that this wave is (and is not)

**Files:**
- Modify: `docs/superpowers/programs/crossrepo-programmes.md` — the wave-3 row and the `## Next-wave brief` section
- Everything else in this task only MEASURES.

**Interfaces:**
- Consumes: every task above; the already-issued D-2066–D-2070 entries in this plan and D-2680–D-2687 and D-2715–D-2720 entries in the wave-2 plan.
- Produces: the measured evidence this wave is mergeable, the ledger's closing state, and the deploy instruction (or the statement that there is nothing to deploy). D-2066–D-2070 and D-2680–D-2687 and D-2715–D-2720 are consumed as already-issued identifiers; this task mints none.

**Spec refs:** §7 (every guard ships with a row measured red), §8 (ordering and rollback), §9 wave 3.

**Mutation table:** row W3-7 — the whole-tree ratchets, discharged here by running `topology-clean`, `single-definition`, `dtbd` and `deviation-refs` after the last edit; and rows W3-1…W3-6 re-run together as one suite.

- [ ] **Step 1: Full package suites, in the foreground**

```bash
cd server && npm run test
```

Expected: PASS. Known load flakes (`ccd-ws-gc`, `pr-sweep`, `session-hook`, `typecheck-tests`, `ccd-session-state`) are re-run IN ISOLATION before being called a break:
`cd server && ./node_modules/.bin/vitest run test/<name>.test.ts`. CI on the quiet box is the arbiter; a flake CI passes is a flake.

```bash
cd agent && npm run test
cd pwa && npm run test
```

Expected: PASS. Neither package is edited by this wave; they run because the gate is whole-tree, not because a change is suspected in them.

- [ ] **Step 2: The corpus ratchets, after the last edit**

```bash
cd server && ./node_modules/.bin/vitest run test/topology-clean.test.ts test/single-definition.test.ts test/dtbd.test.ts
```

Expected: PASS. `topology-clean` walks every tracked file, docs included, and reds on an operator host, address, tailnet or account residue — a red naming a README, ledger or plan line means a real name was typed where a placeholder belonged. `dtbd` proves no concrete placeholder was introduced; D-2066–D-2070 and D-2680–D-2687 and D-2715–D-2720 are already issued and must not be reallocated.

- [ ] **Step 3: Re-prove the historical boundary after every later edit**

```bash
git fetch origin main
AUG=docs/superpowers/specs/2026-08-11-crossrepo-programmes-design.md
BUILD=docs/superpowers/specs/2026-09-08-crossrepo-programmes-design.md
git diff --exit-code --no-ext-diff origin/main -- "$AUG"
for f in README.md "$BUILD"; do
  rg -n -F "$AUG" "$f"
  rg -n -i 'rulings stand' "$f"
done
```

Expected: the diff exits 0 with no output, followed by four successful searches. This repeats Task 3 at the whole-branch boundary: Tasks 4–7 cannot silently alter the historical file or remove either current-document pointer after the earlier check passed.

- [ ] **Step 4: The cross-branch ledger check**

```bash
git fetch origin main
cd server && ./node_modules/.bin/vitest run test/deviation-refs.test.ts
```

Expected: PASS. It compares this branch's plan entries against `origin/main` WITHOUT merging and reds on an allocator-era number defined in two plans — the parallel-branch collision, caught before the merge that would otherwise decide it. D-2066–D-2070 are already present, so run this check after the last plan edit and again before merge; do not substitute or mint anything first.

- [ ] **Step 5: Type-check**

```bash
cd server && npm run build
cd agent && npm run build
cd pwa && npm run build
```

Expected: each exits 0. `build` IS the type-check here — no package in this tree declares a `typecheck` script (`server`/`agent` run bare `tsc`, `pwa` runs `tsc --noEmit && vite build`). The one thing it misses is `server/test/**`, which `server/tsconfig.json` deliberately excludes and which `server/test/typecheck-tests.test.ts` covers by spawning its own `tsc` inside Step 1 — so this wave's two new suites are type-checked by Step 1, not by this step. Emitted `dist/` trees are gitignored and leave no diff.

- [ ] **Step 6: The prose suites, one more time, whole**

```bash
cd server && ./node_modules/.bin/vitest run test/crossrepo-prose.test.ts test/readme-holds.test.ts test/box-token-census.test.ts test/oss-metadata.test.ts test/worker-skill.test.ts test/coordinator-skill.test.ts test/license.test.ts test/ccrc-install-graphify.test.ts test/ccrc-update.test.ts
```

Expected: PASS — every suite in the tree that reads `README.md`, `CLAUDE.md` or a skill corpus, green together. `coordinator-skill` and `worker-skill` are in this list although this wave edits neither: they read README and `CLAUDE.md` too, and a wave that added prose without touching a skill is exactly the shape that breaks them by accident.

- [ ] **Step 7: Close the ledger's wave-3 row and hand the programme forward**

In `docs/superpowers/programs/crossrepo-programmes.md`:

1. Set the wave-3 row's state to one of the two true sentences this worker CAN state at this point — the branch is about to be pushed and its PR may not even be open yet, so "merged" and a PR number are the coordinator's to write, not this worker's:
   - `worker branch <short sha>; flipped <YYYY-MM-DD> on legacy_7d = 0, opens_7d = <n>` if Task 6 ran (this restates Task 6 Step 10's provisional value with this branch's final HEAD sha — `git rev-parse --short HEAD` — once every commit in this task is in).
   - `worker branch <short sha>; flip deferred — legacy_7d = <n>, opens_7d = <n> on <YYYY-MM-DD>` if it did not.

   Leave the PR cell as `—`. The coordinator fills in the PR number once the PR exists and rewrites the state's `worker branch <sha>` prefix to `merged <merge sha>` (keeping the rest of the sentence unchanged) once this wave's PR — and, if Task 6's `D-2070` was split onto its own PR, that PR too — actually merges to `main`. That rewrite is a post-merge coordinator act, exactly like every other wave's PR cell in this table (Task 4 measured both of those from `main`, after the fact, in Step 3 there).
2. Replace the `## Next-wave brief` section with the programme's closing state, since there is no next wave:

```markdown
## Next-wave brief

None — the programme's three waves are closed. What remains is a programme of its own, not a wave of
this one: the **dogfood**, homed in `custom-tools` with its wave 2 in `data-internal`, measured against
the `## Dogfood exit criteria` above. Whoever opens it opens a NEW programme with its own ledger, its
own slug and its own coordinator; this ledger is closed and is read, not written.

If the flip was deferred, the one carried item is the flip itself: re-take the `## Measurements` read,
and when `legacy_7d = 0` with `opens_7d > 0`, change `HOME_PROJECT_LEGACY_ACCEPTED` to `false` in
`server/src/coord/routes.ts` and ship it as its own server-lane PR. The suite that holds it shut,
`server/test/home-project-required.test.ts`, is already in the tree and is red until the constant
moves — so the deferral is visible in CI rather than remembered.
```

**If Task 6 was deferred**, `server/test/home-project-required.test.ts` was never created (Task 6 was skipped whole), so amend that last sentence to name the suite as work the flip PR brings with it. Do not commit a knowingly-red suite.

- [ ] **Step 8: The deploy — what this wave actually ships**

**This wave is NOT agent-first.** It touches nothing under `ccd/`, `session-hook.sh`, `ccd/coordinator-skill/` or `ccd/worker-skill/` (measured; see the header note and D-2069). Confirm before saying so:

```bash
cd <repo root> && git diff --name-only origin/main...HEAD
```

Expected: `README.md`, `CLAUDE.md`, `docs/superpowers/**`, `server/test/**`, and — only if Task 6 ran — `server/src/coord/routes.ts`. **No path under `ccd/`.** If one appears, this wave became agent-first and the deploy order changes; stop and report rather than deploying.

Then:

- **Task 6 ran:** the server lane alone, after review and merge —
  `bash deploy/deploy.sh` (coordinates from `~/.ccrc/deploy.env`; the final gate is `/health` reporting the shipped sha).
- **Task 6 deferred:** nothing to deploy. The wave is documents and tests; no binary on either box changes.

Do not run either lane as part of executing this plan — the deploy is the operator's act.

- [ ] **Step 9: Commit**

```bash
git add docs/superpowers/programs/crossrepo-programmes.md
git commit -m "docs(ledger): wave 3 closed, and the programme handed to its dogfood"
```

---

## Deviations found

**Five plan-time findings, already allocated and defined as D-2066–D-2070.** Do not reallocate, renumber, or replace them. The later lifecycle/client/provenance/accounting corrections D-2680–D-2687 and D-2715–D-2720 are already allocated and defined in `2026-09-08-crossrepo-wave2-skills-pwa.md`; this plan consumes those rulings and does not redefine them. A deviation found during execution gets its own allocator call at the moment it is found.

- **D-2066** (Task 5) — Spec §3 F2 dates the legacy flip on "`run_events` shows zero `legacy-home-project` events over seven consecutive days", phrased as though the programme's own machinery could answer it. Measured at `d0064e6e`: `run_events` is exposed by **no HTTP route**. The only mention in `server/src/coord/routes.ts` is a comment (`:1427`); `runEvents` appears nowhere in that file; the ten `app.get('/api…')` registrations serve mail, mail bodies, caps, runs, run items, the feed, lifecycle, peers, claims and the ledger, and none of them the run-event trail; `CoordStore.runEvents` (`store.ts:1580`) has no caller outside `server/test`. So the criterion is an **operator act** on the server box (`sqlite3 ~/.ccrc/coord.db`, two integers, no rows), and Task 5 says so in the ledger and pins the sentence to the absence that makes it true — the pin reds the day a route does serve the trail. Not fixed here: a route over `run_events` is a new read surface with its own gating decision (box token? session gate? both?), and inventing one inside a docs wave would be exactly the kind of unargued surface this repo's box-token census exists to prevent.
- **D-2067** (Task 5; closing premise superseded by D-2752) — The same criterion is satisfied by seven days in which nothing happened: a box that opened no runs reports zero `legacy-home-project` events, indistinguishably from a box on which every coordinator now sends `homeProject`. An absence is only evidence in proportion to the traffic behind it. Task 5 therefore measures a second number in the same window — runs opened (`runs.openedAt`) — and this wave's gate is `legacy_7d = 0` **and** `opens_7d > 0`. Recorded rather than silently applied, because it changes what the spec's own sentence means: the spec states a numerator and this wave supplies the denominator. The ledger's `## Measurements` block carries both numbers and the date, so a later reader can judge the window rather than inherit a verdict.
- **D-2068** (Task 1; historical plan-time record, premise superseded by D-2686) — The original finding tried to place the spec's sentence "two live workspaces, two concurrency slots and two of the daily budget" outside README's count-free `**Caps and pause.**` passage. D-2686 later measured that sentence against `CoordStore` and refuted its accounting: running-worker concurrency counts dispatched non-terminal run rows, not held workspaces, and rolling daily usage counts accepted dispatches inside the window. Task 1 therefore does **not** preserve or relocate the old arithmetic. Its new cross-repo subsection states the measured predicates: a terminal retained producer and a planned undispatched consumer use no running-worker slot; each actual producer or consumer dispatch consumes daily budget; `cap-concurrency` and `cap-daily` remain authoritative when their corresponding counters are exhausted. The existing caps paragraph remains count-free. D-2068 survives here only as the record of the now-refuted premise, never as an active instruction.
- **D-2069** (Task 7, and the header's agent-first note) — Spec §9's wave-3 bullet lists "the coordinator references" in this wave's scope, which would make wave 3 an AGENT-FIRST deploy. Spec §3 F3's own bullet contradicts it and is right: the refusal-list sentence and its `wave-lifecycle.md` explanations belong to **wave 1** (because `server/test/coordinator-skill.test.ts:296-345` requires every `RunRefuseCode` to be named in the skill corpus and explained in `wave-lifecycle.md` the moment the code exists — a wave 1 that declared the codes without naming them would ship red), and the behavioural clauses belong to **wave 2**. Measured for this wave: nothing under `ccd/` is touched, so the agent lane does not run and the deploy is server-only (or nothing at all, if the flip defers). Recorded so that a reader following §9 rather than §3 F3 does not order a deploy this wave has no bytes for; Task 7 Step 8 verifies the claim with `git diff --name-only` rather than trusting it.
- **D-2070** (Task 6) — Spec §3 F2 says the flip to required is "shipped as its own PR", and this plan's own cross-wave contract repeats it verbatim ("`HOME_PROJECT_LEGACY_ACCEPTED → false`, its own PR"). Task 6 cannot make that binding: a worker commits only on its own workspace branch and opens no second one (house rule, not a per-task choice), and this ledger's own execution-shape paragraph (`docs/superpowers/programs/crossrepo-programmes.md:15-19`) has the WORKER, not the coordinator, push the branch and open the PR — so by the time a PR exists, the flip commit is already inside it, riding beside every docs commit in this wave, unless a human moves it afterward. Task 6 Step 10 states what this worker does about it: name the flip commit as a distinct handoff item, separate from the rest of the wave's report. What happens next — cherry-pick onto its own branch for its own server-lane PR after the docs PR merges, or accept the operator waiving spec §3 F2's separation for this one wave — is the coordinator's decision, made and recorded in the ledger's `## Decisions & deviations` at the time, not assumed by this plan.
- **D-2740** (Task 2, controller ruling) — Task 2's brief prescribes, in its Step 1 test code, `const crossOpen = cross.indexOf("without the producer's \`sessionId\`")` as the anchor proving cross-project succession omits the producer session, and then prescribes, in its Step 5 README prose, that identical phrase wrapped across a line break (`opens first without the producer's` / `` `sessionId` ``, the wrap landing between the apostrophe-`s` and the backtick). A wrapped phrase is two lines joined by a literal `\n`, not a space, so the literal `indexOf` reads the phrase as absent from the passage it is supposed to anchor. Measured directly against the shipped test on the wave-2-merged execution base: `-1`. The sibling assertion two lines above it, on the textually identical phrase in the SAME-project arm's own producer-session language, was already written tolerant of the wrap (`/\s+/` between the two halves) and passed — this finding is that fix's own construction, generalised to the arm it was missing from. Shipped remedy: `const crossOpen = cross.search(/without the producer's\s+\`sessionId\`/);`, matching the sibling's shape. Reflowing the README passage so the literal `indexOf` would fit — collapsing the wrap to a single line — was rejected: the brief's Step 5 prose is prescribed byte-for-byte, and a docs wave has no standing to redistribute a passage's line breaks merely to appease a test's choice of string method, when the fix belongs in the test that made that choice. Rider (a): the presence loop's tuple carried the same literal as both the search target and its own failure-message label; since a correct README legitimately does not contain the literal (it contains the wrapped form), the label was changed to the neutral `"without the producer's sessionId"` so a future failure message tells a reader what is missing rather than what to grep for and not find. Three facts recorded here, not fixed this wave (fix round 1, per coordinator ruling: record, do not fix — the assertion ships as prescribed): (1) `crossDispatch = cross.lastIndexOf('dispatch')` resolves, in the shipped passage, to the `dispatch` inside "report and do not dispatch" in the trailing caveat, never to any of the arm's own `dispatch` occurrences. Measured by the reviewer against the fix-round-1 (pre-fix-round-2) shipped passage: offsets `193` (`independently prove`) / `803` (the arm's own dispatch clause) / `997` (the caveat's `dispatch`) — `crossMerge < crossDispatch` reads `193 < 997`, skipping over `803` entirely. Re-measured directly against the fix-round-1 shipped passage (commit `2544c163`, NOT the current tip — see D-2755 below for why a "current" label on a measurement does not stay true) after fix round 1's Fix 1/2/4 rewrote this arm (added an unconditional dispatch sentence, per Fix 1) and bounded the slice at step 6 (per Fix 4, so it no longer runs into step 6/`**Caution:**`): `independently prove` sat at offset `459`; the `cross` slice carried FOUR `dispatch` occurrences — `151` ("fresh dispatch in the target repository"), `708` ("before dispatching the consumer"), `744` ("Only then dispatch the consumer"), and `941` (the caveat's "do not dispatch") — and `crossDispatch = cross.lastIndexOf('dispatch')` was `941`, the caveat, never any of the arm's own three. (These are the `2544c163` figures, not HEAD's — see D-2745's re-measurement below for HEAD's current values, `481`/`151,733,769,966`; the ordering conclusion is unchanged at both commits.) So the ordering assertion `crossMerge < crossDispatch` (`459 < 941`) is satisfied by a token whose sentence argues the opposite of what the assertion's name claims, exactly as before the rewrite — deleting every one of the arm's own dispatch-related clauses would still leave `crossDispatch` resolving to the caveat's `dispatch` and this assertion green. The practical consequence, also measured directly (not inferred): deleting the arm's own `'before dispatching the consumer'` clause from the shipped passage leaves `crossrepo-prose.test.ts` fully green (11 passed — this fact's `crossMerge < crossDispatch` check does not notice, exactly as predicted, because it cannot distinguish which `dispatch` token is which) while `server/test/readme-holds.test.ts` reds on its own, independent ordering assertion: `the crossing dispatches before proving the producer merge: expected -1 to be greater than 616` (its `dispatched = crossing.indexOf('before dispatching the consumer')` going to `-1`). So mutation row W3-2's dispatch-ordering red for this arm is, in the shipped state, delivered entirely by `readme-holds.test.ts`'s pre-existing ordering assertion, not by anything this task's own `crossrepo-prose.test.ts` suite added for it. The weakness is on record for whoever next tightens this anchor. **Fact (1) is closed, fix round 4 (C9):** `crossDispatch` is now derived from the gate sentence itself, `cross.indexOf('Only then dispatch')` (`server/test/crossrepo-prose.test.ts:343`), which the arm states exactly once — it no longer resolves to the trailing caveat's `dispatch`. Measured: deleting the gate sentence ("Only then dispatch the consumer\n   fresh in its target project.") from README and re-running `crossrepo-prose.test.ts` reds exactly one test, `cross-project dispatch is absent: expected -1 to be greater than -1`, 16 passed / 1 failed; restored byte-identically (`git checkout -- README.md`) and re-run, 17 passed / 0 failed. `readme-holds.test.ts`'s own independent ordering assertion on this same claim (named two sentences above) is unaffected and stays as the second guard — this closes only fact (1)'s weakness, not a redundant pin. (2) `server/test/coordinator-skill.test.ts:2005-2040` concatenates all 19 fenced markdown code blocks in this very plan file into one string and greps the join, so a green result there is "some block somewhere in this plan contains the pattern", never "the block this Task 2 assertion slices contains it" — its own row for this phrase is already the `/\s+/`-tolerant regex form, so it could not have detected a literal-form assertion failing even if one existed. A green run of `coordinator-skill.test.ts` is therefore not evidence for, or against, this fix; only a run of the prescribed `crossrepo-prose` suite is. (3) The Step 5 README prose did **not** ship byte-for-byte as the brief prescribed it, beyond the wrap this entry is about: `server/test/readme-holds.test.ts`'s pre-existing, un-editable `D-2680` describe block pins five further literals inside the SAME passage this task rewrites — `'A cross-project successor opens first'` (exact case), then, in order, `'close the producer with \`final:true\`'`, `'require \`released:true\`'` (contiguous — the brief's own prescribed "require the response to contain \`released:true\`" is not), `'prove its PR merged at the named producer SHA'` (contiguous), and `'before dispatching the consumer'`, plus the regex `/Using \`final:false\` on that crossing would\s+strand a synthetic/` (the brief's prescribed prose says "on **a** crossing", not "on **that** crossing"). None of these five are named anywhere in Task 2's brief or in the controller's rulings. The brief's prescribed cross-project paragraph, used verbatim, reds `readme-holds.test.ts` on at least the first and the `final:false`/`that crossing` literals. Measured and reconciled without asking: the shipped cross-project paragraph keeps all five literals from `readme-holds.test.ts` (word-for-word, including "that crossing") while also satisfying every Step 1 assertion above, verified by running both `crossrepo-prose.test.ts` and `readme-holds.test.ts` green together, not by inspection alone. No content required by either test was dropped to achieve this — same-project and cross-project proof chains both still carry the full conditional `headRefOid`/`handoffCommit`/`producerSha` evidence the brief's Step 5 introduced. Recorded so a future edit to this passage does not reintroduce the brief's literal wording and silently red `readme-holds.test.ts` again.
- **D-2742** (Task 2, ruling 2 — number minted at fix round 1) — This plan prescribes the identical false sentence twice: line 473 (Task 1's cross-repo subsection) and line 844 (Task 2's programme-mail paragraph) both read `` `to` becomes optional when `program` is given. `` Measured against the shipped guard, `server/src/coord/routes.ts:1046-1048`: `` if ((to === null) === (program === null)) return reply.code(400).send({ ok: false, error: 'bad-request' }); `` — its own comment (`:1041-1048`) states the reasoning directly: "`to` is a MAILBOX … and `program` is a THREAD … a request that named both would be asking two different questions in one call. Neither is still a bad request, exactly as it was before `program` existed." That is mutual exclusion — exactly one, never both, never neither — not `program` making `to` optional; "optional" describes a parameter a caller may freely omit, and this route 400s a caller who omits both exactly as it 400s one who supplies both. The shipped correction is **prose plus a ratchet only**; `routes.ts` was not touched by this task, and the guard's behaviour was already pinned before this task began — `server/test/run-routes.test.ts:3260-3279` carries the pair of it-blocks that prove BOTH arms: `'GET /api/mail with neither `to` nor `program` is still a bad request'` (the "neither" case) and `'GET /api/mail with BOTH `to` and `program` is also a bad request (D-2057)'` (the "both" case), whose own comment explains why both are required: "the `(to === null) === (program === null)` guard is symmetric, and the 'neither' case above cannot prove the 'both' arm — a guard degraded to `to === null && program === null` passes 'neither' and silently accepts 'both'." Task 1's describe block carries the textual pin — `server/test/crossrepo-prose.test.ts:153`, `expect(mail, …).toContain('(to === null) === (program === null)')` — grounding its prose claim in the guard's own source text; Task 2's own programme-mail test does not repeat that grounding (its two new assertions, added under this ruling, check the prose's wording only: that it says "mutually exclusive" and no longer says "becomes optional"). Task 1's pin reds on a pure refactor of the expression (e.g. extracting it to a named predicate) even when behaviour is kept identical. Accepted deliberately: a prose suite is not the place to prove behaviour, and that textual pin is acceptable *precisely because* `run-routes.test.ts`'s two it-blocks above already prove the behaviour independently of how the guard is spelled — a refactor that reds the textual pin but keeps `run-routes.test.ts` green is a false alarm caught by the cheaper test, not a behaviour regression, and the fix is to update the textual pin's literal, not the route.
- **D-2745** (Task 2, coordinator ruling — fix round 2, finding 6) — Wave 2's `readme-holds.test.ts` `D-2680` describe block pins the exact same run-lifecycle passage Task 2 Step 5 rewrites, with its own literal-driven requirements that Task 2's brief and controller rulings never named. DECISION UPHELD, EXECUTION CORRECTED: prose reconciliation (round 1) was the right call, and this entry does NOT re-anchor `readme-holds.test.ts` — relaxing a wave-2 constraint from a downstream wave is a separate deviation and a separate decision, not this one. But round 1's reconciliation introduced two defects wave 2's literals did not force, both corrected in fix round 2 (Fix 1/Fix 2): (a) the bridge sentence "the procedure differs from the arm above" made "the arm" in the sentence that followed it resolve, by nearest antecedent, to the SAME-project arm, and was itself circular (the check was described as what lets you do the check) — replaced with a colon-joined lead-in and no bridge; (b) the plan's own unconditional closing gate ("Only then dispatch the consumer fresh in its target project") was dissolved into a trailing clause inside "If the consumer depends…", so a crossing with no interface dependency had no stated dispatch gate — restored as its own standalone sentence outside the conditional.

  Three prescription deltas, enumerated rather than summarised: **(1)** plan:811-812 reads `` require the response to contain `released:true` ``; round 1 shipped `` require `released:true` ``, losing WHERE it is read (the close response, `routes.ts:185`) — restored in fix round 2 (Fix A) as `` require `released:true` in the close response ``, keeping the pinned literal `` require `released:true` `` whole and unwrapped on its own line. **(2)** plan:812, the cross-project arm (re-measured fix round 4, base `9561176a`; `:800` is the same-project arm's own copy of this phrase, not the one this delta is about — the earlier `:801` citation was off by one either way), reads "the **exact** producer closed row"; round 1 shipped "the producer's closed row", losing "exact" for no reason readme-holds.test.ts required — restored in fix round 1 (Fix 2) as "the exact producer closed row", matching the same-project arm's own wording. **(3)** plan:816-817's unconditional dispatch gate, dissolved as in (b) above — restored in fix round 1 (Fix 1). Two further additions were made to satisfy `readme-holds.test.ts`'s literals that the plan's own text does not contain at all: the plan writes "on **a** crossing" where the shipped text reads "on **that** crossing" (`readme-holds.test.ts`'s regex requires the latter, verbatim); and, transiently in round 1 only, a bridge sentence (since removed, see (a) above).

  This plan's own pin table (`plan:92`, the `readme-holds.test.ts:27-34` row) cites `holdsSection()` **only** and argues that slice stays byte-identical after Task 1's insertion — true, and irrelevant to what Task 2 rewrites. The table carries **no row** for `lifecycleSection()` (`readme-holds.test.ts:29-35` on `origin/main`) nor for the `D-2680` describe (`readme-holds.test.ts:47-76` on `origin/main`), which wave 2 added over exactly the region Task 2 Step 5 rewrites — the collision this entry exists to record. The cited range is itself stale on `origin/main`: `holdsSection()` is actually defined at `readme-holds.test.ts:40-45`, not `:27-34` — found by re-measuring on the execution base, exactly as the table's own preamble instructs and exactly the check it did not receive for this row.

  **Correcting one claim in the coordinator's own ruling document** (the coordinator's ruling, mail 1100, artifact untracked): it states that with "Only then dispatch…" restored, `crossDispatch` (`cross.lastIndexOf('dispatch')`) now lands on that sentence rather than the trailing caveat. Measured directly against the fully fix-round-2 shipped passage: it does **not**. The `dispatch` offsets in the `cross` slice are `151` ("fresh dispatch in the target repository"), `733` ("before dispatching the consumer"), `769` ("Only then dispatch the consumer"), and `966` (the caveat's "report and do not dispatch"); `crossDispatch = cross.lastIndexOf('dispatch')` is `966`, the caveat — "Only then dispatch" itself sits at `759`, well before it. `crossMerge` (`independently prove`) is at `481`, so the ordering assertion still reads `481 < 966`, skipping over both of the arm's own dispatch sentences exactly as it did before restoration. D-2740 fact (1)'s CONCLUSION — the ordering assertion is satisfied by the trailing caveat's `dispatch`, never any of the arm's own — stands and is not revised by this entry; its numeric offsets (`459`; `151,708,744,941`) were a fix-round-1 measurement at `2544c163`, not HEAD, and D-2755 relabels them as such so this file does not carry two contradictory "current" offset sets — this entry's `481`/`151,733,769,966` are the HEAD figures. Cross-reference D-2740 for the full record of that weakness.

  Also added this commit (Fix E, no assertion changed): a mutual cross-reference comment in `server/test/readme-holds.test.ts`'s `D-2680` describe and in `server/test/crossrepo-prose.test.ts`'s cross-project block, each naming the other file's slicer and what it pins, so an edit to this passage is no longer silently under-tested by whichever file the editor happens to be looking at.
- **D-2746** (Task 2, coordinator ruling — fix round 2, finding 7) — CONFIRMED AND MEASURED by the coordinator: 8 arm-local mutations to the merge-evidence prose each left BOTH the whole-passage evidence-token loop and the whole-passage `headRefOid`→`handoffCommit`→`producerSha` chain regex green, because the untouched arm's own copy of the evidence satisfied both checks — the two arms were alibiing each other. Fix round 1 (D-2740's own Fix 3) had already scoped two of the three relevant predicates (the evidence loop, the chain regex) to run over `same` and `cross` independently; the coordinator's fix-round-2 review measured a THIRD hole round 1 missed: the dependency-gate regex (`/if the consumer depends[\s\S]{0,160}?independently prove[\s\S]{0,200}?producerSha/i`) was left cross-only, exactly as the plan itself left it (plan:677-678 scopes it to the cross arm's own text only — re-measured fix round 4, base `9561176a`; `:686-687` is the marker-tuple loop a few lines below it, not this regex). Without a same-arm copy, deleting "If the consumer depends on an interface from this producer," from the SAME-project arm left every scoped assertion green — **so plan Step 8 mutation 6's "remove EITHER arm's guard → FAILS" is false as written**, because the plan's own test design left the gate unreachable from the same-project side. Fix round 2 (Fix B) closed this: all three predicates (evidence loop, chain regex, dependency-gate regex) now run over `same` and `cross` independently, replacing the two-predicate scoping rather than adding beside it.

  Measured, both directions, with scratchpad `cp`/`cmp` restore discipline (see the fix-round-2 report for the full log): same-arm `headRefOid`→`oid` reds the scoped-same loop AND the scoped-same chain; same-arm equality-target→`mergeCommit.oid` reds the scoped-same chain **only** (the loop stays green because `producerSha` survives in that arm's own lead-in, "merged at `producerSha`") — this is the direct proof that the chain needed scoping as much as the loop did; cross-arm `headRefOid`→`oid` reds the scoped-cross loop and chain; cross-arm equality-target→`mergeCommit.oid` reds the scoped-cross evidence loop (`producerSha`, which has no surviving copy elsewhere in that arm), the scoped-cross chain, and the scoped-cross dependency gate, all three; same-arm deletion of the dependency-gate clause reds the new scoped-same dependency-gate assertion — Fix B's own control, proving the gap it closes was real.

  The `'\n6. '` bound added to the `cross` slice in fix round 1 (D-2740 Fix 4) is correct and stays, but — per the coordinator's own measurement, confirmed here — it fixed **nothing** in fix round 1: step 6 and the `**Caution:**` paragraph contain no marker any cross-project assertion reads, so every one of the `cross` slice's assertions kept byte-identical offsets whether or not the slice ran past step 5. It is defensive bounding against a future edit, not a fix for anything measured to have gone wrong.

  Dependency-window slack, re-measured against the fully fix-round-2 shipped text (the coordinator's ruling document cites `177` against the pre-fix text; a still-earlier figure of `156` was cited in this task's fix-round-2 instructions, itself already stale by the time it reached this entry): the gap between `independently prove` and the following `producerSha` in the cross arm is **`159`** characters against the regex's `{0,200}` cap — `41` characters of remaining slack. One re-wrap of that sentence, or one additional descriptive clause, still breaks it. The plan's prescribed windows are kept exactly as written; this entry exists so the next editor is not surprised by how little room is left.
- **D-2747** (Task 2, coordinator ruling — fix round 2, finding 8) — Two independently false sentences, both confirmed against source. **(a)** README's mail-role paragraph said a replacement session inherits its predecessor's "undelivered" mail; `OUTSTANDING_STATES_SQL = "('queued','delivered')"` (`server/src/coord/store.ts:400`) refutes this — a `delivered`-but-unacked row IS outstanding, not undelivered. `bindSession` (`store.ts:1709-1721`) calls `requeueAbandonedMail` with role `'worker'`, whose source predicate for that arm is the exact literal `` d.state IN ${OUTSTANDING_STATES_SQL} `` (`store.ts:1353-1354`); the coordinator arm (`ABANDONED_PARK_SQL`, `store.ts:535-538`) is a different predicate and is unreachable from `bindSession`, so "every outstanding delivery" is true of the worker arm specifically and is **not** generalised to `requeueAbandonedMail` as a whole in the shipped sentence. The sibling paragraph in the same file (`**Programme mail at scale.**`, README:1841 — re-measured fix round 4, base `9561176a` plus this round's own README edits; was `:1836` at fix round 3) already said "outstanding" — the two copies of the same fact (README:1554, unmoved, and README:1841) contradicted each other 287 lines apart within this one branch (was 282 at fix round 3; the drift is this branch's own further edits, not a new defect — D-2755). Shipped (fix round 2, Fix C): "When a run's session is replaced, the replacement inherits every outstanding delivery addressed to its predecessor — queued *and* delivered-but-unacked — as a **new** delivery row, freshly rendered, and the predecessor's row is parked — an envelope that names the corpse may not be replayed." A grounded pin was added to Task 1's describe block in `crossrepo-prose.test.ts` (the paragraph was otherwise pinned by nothing in that suite): `STORE` must contain `` d.state IN ${OUTSTANDING_STATES_SQL} ``, and the cross-repo section must match `/outstanding/i` and must **not** match `/undelivered/i`.

  **(b)** README step 1 gave `home-mismatch` and `project-mismatch` each their own separate "*before the row is opened*" ordering clause (added across fix round 1); `server/src/coord/routes.ts:1192-1194`'s own comment gives `home-mismatch` the identical guarantee to `project-mismatch`'s ("decided BEFORE the row exists so a refusal leaves no `planned` orphan, exactly like the check above") — both true, but stated with unnecessary duplication. Shipped (fix round 2, Fix D): each refusal keeps its own sentence, its own trigger, and its own `by:` — the two conditions are NOT folded together — but the shared ordering guarantee is now stated once, after both: "A `sessionId` whose earlier runs belong to another project is refused `project-mismatch` (**409**, `by:` that project). Both `-mismatch` refusals are decided *before the row is opened*, so neither leaves a `planned` orphan." Deliberately "Both `-mismatch` refusals", not "Both refusals": step 1 also names the second-coordinator-on-the-same-program refusal, whose ordering is not established in this step and must not be implied by a bare "both". `crossrepo-prose.test.ts`'s `/before the row is opened/i` check (passage-wide) stays green under this rewording.
- **D-2748** (NEW, record-only, wave-2 latent defect — **not fixed this wave**, and not fully confirmed as described) — The coordinator's ruling identifies a message-ordering flaw in `server/test/readme-holds.test.ts`'s `D-2680` describe block: `crossingAt` is computed and used to slice `crossing` before the assertion that checks `crossingAt > -1`, and the ruling states that if the literal `A cross-project successor opens first` ever goes missing, the `closed > opened` assertion "fires first" with the wrong message ("the crossing does not close its producer with final:true"), leaving the accurate message ("the cross-project lifecycle instruction is missing") unreachable. The general class this names — a guard's failure message naming a cause it may not actually be the one detecting — is real and worth recording. But this entry corrects the specific mechanism as described: **verified directly**, by mutating the shipped README to remove the literal `A cross-project successor opens first` and running `readme-holds.test.ts`, the test fails at `expect(crossingAt, 'the cross-project lifecycle instruction is missing').toBeGreaterThan(-1)` — the ACCURATE message — not at the `closed > opened` assertion. This is because, in both this branch's copy and `origin/main`'s copy of the file (diffed directly), the `crossingAt > -1` assertion is written, and therefore executes, BEFORE the `closed > opened` assertion; vitest's `expect()` throws synchronously on the first failing assertion in a test body, so the later assertion is never reached once the earlier one fails. The `const crossing = section.slice(crossingAt, …)` line does run before any assertion (consts must be computed before they can be asserted on) — that half of the ruling's description is accurate — but computing a slice from a bad index is not itself a failure, and does not change which `expect()` call is first in program order. Recorded here, unresolved, for whoever next reviews this class of guard: either the mechanism described applies to some other mutation this entry's author did not try, or the finding's specific claim about which assertion fires does not hold against the code as shipped. Not fixed this wave either way — the general "assert-before-slice" hygiene point stands regardless of which assertion currently catches the missing-literal case, and any change to this file's assertion order belongs to whoever next edits `readme-holds.test.ts`, not to a docs wave.
- **D-2741** (Task 4, controller ruling) — Task 4's brief prescribes, for the ledger's `## Dogfood exit criteria` section, a producer-source bullet whose "reads … immutable producer source blob" clause is separated by the whole `git -C "$producerRepoRoot" show "$producerSha:$producerSourceRepoPath"` command — measured at 91 characters between `reads` and `immutable producer source blob` — against the shipped test's own `/reads[\s\S]{0,60}?immutable producer source blob/` assertion (unchanged and never to be widened: a wider window is a guard the ledger could satisfy without saying the worker reads the blob). Measured directly: no match, `-1`. The controller's shipped replacement instead reads "the worker reads that immutable producer source blob with exactly `git -C …`", putting `reads` six characters from `immutable producer source blob` and moving the git command after the anchor phrase rather than between `reads` and it. Two further pins in the same bullet's tail clause are satisfied only by a SECOND anchor occurrence, not the first: `/producer source blob[\s\S]{0,80}?provenance/` — first occurrence of `producer source blob` (the `immutable producer source blob` mention) sits 123 characters from `provenance`, over the 80 cap; the SECOND occurrence ("so the producer source blob proves provenance") sits 8 characters from it, under the cap — and `/inline excerpt[\s\S]{0,100}?dispatched interface-shape authority/` — first occurrence of `inline excerpt` sits 225 characters from `dispatched interface-shape authority`, over the 100 cap; the SECOND occurrence ("while the inline excerpt remains the dispatched interface-shape authority") sits 13 characters from it (the intervening text is ` remains the `), under the cap. Both regexes are non-greedy but unanchored, so the engine retries from each later literal occurrence of the same anchor text until one satisfies the window — measured directly by running the suite against the shipped bullet, both pass. Because both pins depend on the clause's exact two-occurrence shape, the clause is not to be shortened, reflowed, or split (ruling rider (b)). Re-deriving Step 6's mutation expectations against the shipped bullet rather than the brief's: deleting the `git -C …` command alone (mutation d6, this task's run log — replacing `with exactly \`git -C …\`` with nothing) reds only the exact producer-root-read `toContain` assertion, not the `{0,60}` window, because the phrase "reads that immutable producer source blob" survives that deletion untouched. The `{0,60}` pin is exercised by a different, more targeted mutation — measured directly, not inferred: replacing "reads that immutable" with "fetches it" (so the bullet reads "the worker fetches it with exactly `git -C …`, so the producer source blob proves provenance") reds exactly one assertion, `the dogfood never reads the immutable producer source blob`, 14 passed / 1 failed, restored byte-identical. Deleting any of the `producerSha`/`producerRepoRoot`/`producerSourceRepoPath` coordinates (mutations d1–d3) does NOT reach this pin either — each reds the earlier coordinate-presence `toContain` check first, and `expect()` throws synchronously on that first failure, so whether the `{0,60}` window would also fail under that same mutation is unmeasured by this task's run log; the wording of an earlier draft of this entry claimed otherwise without having measured it, and is corrected here. This was invisible until measured because `server/test/coordinator-skill.test.ts` harvests this very plan's prescribed prose by joining ALL its fenced markdown code blocks into one string and greping the join — so its guarantee is "some block somewhere in this plan contains the pattern", never "the block the real `crossrepo-prose.test.ts` assertion slices contains it". That harvest's row for this pattern is satisfied by this plan's own QUOTED spec §9 paragraph (Task 4's brief anchor quote, which is prose read verbatim from the build spec and carries a different, shorter gap), while the ledger block the real test actually slices — the shipped `## Dogfood exit criteria` section — is what the `{0,60}` window is asserted against, and that is where the brief's prescribed bullet fails and the ruling's bullet passes. One further preservation, per ruling 2: the six-line ledger paragraph this section replaces ended "a no-dependency foreign-plan wave would carry none of that producer evidence" — a concept the prescribed section drops and the build spec's own §9 paragraph never carried (a ledger-only sentence wave 2 added) — so the shipped bullet appends it as a trailing clause, "; a foreign-plan wave with no producer-interface dependency carries no producer tuple and no invented excerpt", approved by the coordinator.
- **D-2743** (RECORD-ONLY, Task 6, conditional on Task 5's gate — not implemented this task) — The Task 6 brief's prescribed suite asserts `w.coord.runs().length` directly, but wave 2's own `D-2545`/`D-2590` (commit `1d860f92`) changed `CoordStore.runs()` to return `RunsReadResult`, a discriminated union (`{ ok: true; runs: RunRow[] } | { ok: false; kind: 'run-unreadable'; detail: string }`, `server/src/coord/store.ts:254-256`), not a bare array — measured at the method's own definition, `store.ts:1961`. `.length` on that union is `undefined` at runtime (the `ok:false` arm has no `runs` property, and even the `ok:true` arm's `.runs.length` is not reachable through a bare `.length` on the wrapper) and a type error under `typecheck-tests`. The form to ship IF Task 6 runs (pre-approved by the coordinator): import `okRuns` from `./coordReadHelpers` and write `expect(okRuns(w.coord.runs({ includeClosed: true })).length, 'a refused open left a planned orphan behind').toBe(0);` — keeping `includeClosed: true`, because a refused open must leave no row of ANY state (not merely no non-terminal one), and the sibling assertion at `server/test/run-routes.test.ts:218` reads the same way (`expect(okRuns(w.coord.runs({ includeClosed: true }))).toEqual([]);`). `programs()` and `runEvents(id)` are unaffected and stay exactly as the Task 6 brief prescribes them — both still return plain arrays, not a `Result` union.
- **D-2744** (RECORD-ONLY, Task 6, conditional on Task 5's gate — not implemented this task) — The Task 6 brief's prescribed suite asserts the required-`homeProject` refusal body as a bare `{ ok: false, error: 'bad-request' }`, under a comment claiming wave 1's `required` branch sends no `detail`. Measured directly at `server/src/coord/routes.ts:1217`: it sends `detail: 'homeProject is required'`, and the surrounding comment (`:1210-1216`) names the reason and the number — **D-2349** — "two conditions whose remedies differ" (a malformed body versus a build that requires a home) "must not reach the caller as one value", the same overloaded-null principle this file's own Conventions section states as a standing rule. This exact body is independently pinned by `server/test/home-project.test.ts:50-60` (the `it` block "the route's `required` arm answers with a detail …", whose regex at `:58-59` requires exactly `detail: 'homeProject is required'`), so the prescribed bare-body assertion would red against current `main`, not merely against a stale comment. The form to ship IF Task 6 runs: `expect(body).toEqual({ ok: false, error: 'bad-request', detail: 'homeProject is required' });`, and the prescribed comment must be corrected rather than carried forward — a shipped test must not ship a false comment about the assertion sitting under it. This one matters more than an ordinary stale-comment fix: an implementer who transcribes the plan as written reds on `detail`, and the cheapest green available is deleting D-2349's `detail` field from the route to match the test — which would reintroduce the exact overloaded-null collapse D-2349 exists to prevent, silently, as a side effect of satisfying a stale test rather than as a reviewed decision.
- **D-2749** (Task 4 test, RECORD-ONLY — not fixed this wave) — The Task 4 describe block slices the ledger with `passage(..., '## Dogfood exit criteria', '\n## ')`, and `passage`'s opening-anchor `indexOf` is satisfied by a mid-line backtick MENTION of that heading as readily as by the heading itself. Measured on both trees: at `c05d2cb4` the only occurrence of the literal `## Dogfood exit criteria` was the backtick mention inside the next-wave brief's own sentence "what remains of Task 4 is the `` `## Dogfood exit criteria` `` section and its test" (then `:197`), so the slice fired `the closing anchor is gone` — the wrong cause named, since the literal was present as a mention and the opening-anchor assertion therefore could not fire; at `9fafeaba` the real heading (then `:72`) precedes the mention (then `:210`) and the slice passes at 1943 chars, so the block is protected by POSITION, not by content. The one-line fix for whoever next edits the suite: anchor on `'\n## Dogfood exit criteria\n'`, which a mid-line backtick mention cannot satisfy. **Task 7 strikes both backticked heading mentions from the brief prose it rewrites** (coordinator direction, this fix round): the mentions are struck in this wave's Task 7, starving both anchors, while `passage`'s `indexOf` weakness and the one-line fix above stand for whoever next edits the suite. Class cross-reference: **D-2748** — a guard whose failure message names a cause it may not be the one actually detecting. **Second instance, measured this task:** Task 5's own `## Measurements` block has the identical shape — a pre-existing mid-line backtick mention of `` `## Measurements` `` inside the ledger's `## Next-wave brief` sentence "Both numbers and the date go in `` `## Measurements` `` whichever way the gate goes" (measured before this task's own edit, at `:238`) — which is why the brief's predicted "the opening anchor is gone" message for Task 5's Step 3/7 RED runs is wrong and the measured message says "the closing anchor is gone" instead; one defect, two sites in this same ledger file, no separate deviation number minted for the second site.
- **D-2750** (Task 5 Step 4, the worker-taken read) — The plan's Global Constraints and this wave's own brief both make the legacy-flip measurement an OPERATOR act, and the standing worker constraint is that this session never reads `~/.ccrc` or `~/.cc-secrets` on any box; per the controller's binding Task 5 addendum, the operator answered the `AskUserQuestion` Step 4 prescribes ("Gate OPEN — 0 legacy, runs opened") and then instructed the worker directly to run the query itself, overriding the brief's constraint for that one read on the operator's own word — recorded here rather than left buried, since an overridden constraint belongs in the ledger. **The override is what caught a false answer:** the measurement the query actually returned was `legacy_7d = 1`, not zero — a legacy-shaped run inside the rolling seven-day window (run 43, programme `account-pools` wave 5/6, `causedBy=coordinator`, `2026-09-11T12:02:33.805Z`, the only such event ever recorded) — so taking the operator's verbal framing at face value, without this measurement, would have flipped `HOME_PROJECT_LEGACY_ACCEPTED` to `false` against a gate that in fact measures CLOSED; Task 6 defers this wave as a result. Two environment facts the read had to survive, both worth the next reader's time: `sqlite3` is **not installed on the server box**, so the plan's Step 4 `node` / `DatabaseSync({ readOnly: true })` fallback is what actually took the measurement, not the `sqlite3 -readonly` command the brief leads with; and `~/.ccrc/coord.db` on the **fleet box** is a 0-byte stub whose query answers `Error: no such table: run_events` — a naive read taken against that box's copy instead would have degraded to "0 rows" and closed the gate for entirely the wrong reason. This Task 5 execution took no query and read no database itself; it records only the two integers and the facts above, handed down already measured.
- **D-2751** (Task 5 Step 7, fix round 1 — controller-issued) — The plan's own mutation-table row W3-5 predicts, for the `## Measurements` block, "by deleting either number from it: the per-number regex reds naming which one" — measured against the shipped block, the `legacy_7d` half of that claim was false: `/legacy_7d\s*=\s*\d+/` matched **three** times (the recorded `legacy_7d = 1`, the gate threshold's own `legacy_7d = 0`, and a verdict echo `legacy_7d = 1`), so deleting the recorded value left the gate's own literal standing and the suite GREEN — the control mutation Task 5's addendum asked for and predicted correctly. `opens_7d` never had the hole: the gate writes `opens_7d > 0`, a `>` the `=`-only regex cannot match, so that half of the row's claim was always true. **The fix is prose, not a widened regex**: the test block ships byte-identical to the ruled fence by controller ruling, so the assertion cannot be touched; the gate sentence's threshold was reworded from the `=` form (`legacy_7d = 0`, `legacy_7d = 1`) to prose (`legacy_7d` is zero, the count above is nonzero), leaving the recorded value as the pattern's sole match in the block. Re-measured after the fix: deleting the recorded `legacy_7d = 1` sentence now REDS exactly one assertion, `the measurement records no legacy-event count`, 16 passed / 1 failed; restored byte-identically, 17 passed. Widening the regex was rejected as the wrong side of the defect — the guard was too permissive, not too narrow, and a wider pattern only hides that further. Class cross-reference: **D-2748**, **D-2749** — a guard whose message names a cause it may not be the one detecting. **This number covers the class, not just the `legacy_7d` instance** (coordinator ruling): two further guards in the same block were measured vacuous and are recorded, not fixed, because fixing them would touch the byte-identical test — deleting the entire measurement paragraph (both numbers, the date, the event name) reds exactly **one test**, not one assertion, and the block carries **six** it-level assertions rather than the five an earlier draft of this entry counted (corrected in fix round 2, measured by counting `expect(` in the shipped describe block) — measured on the shipped text AFTER this same commit's F1 reword, 16 passed / 1 failed, the failure being the `legacy_7d` pin. The `opens_7d` pin is equally unsatisfied by that same deletion and never runs, because `expect()` throws synchronously on the first failure: the same first-failure-wins effect this plan already records for D-2741's mutations d1–d3, and the reason an assertion count is never a failure count. Before the reword the identical deletion left `legacy_7d` satisfied by the gate sentence's own threshold literal, so the reword is precisely what turned that pin real — the paragraph deletion went from one genuine red to two, of which one is observable. `toContain('legacy-home-project')` and the `/20\d\d-\d\d-\d\d/` date regex remain satisfied by the run-43 provenance sentence elsewhere in the block, `toContain('coord.db')` by the operator-act paragraph, and the `ROUTES` pin reads source rather than the ledger at all; and `expect(ROUTES, …).not.toContain('runEvents')` pins the camelCase identifier rather than the capability — a route reading the trail with raw SQL (`FROM run_events`, the way `strandedClear` does at `server/src/coord/store.ts:1826-1831`) or through a differently-named store method would leave it green while the ledger's "no HTTP route" sentence went false; the assertion that would actually hold the subject is "no `app.get`/`app.post` handler body in `routes.ts` contains `run_events` outside a comment". Noted in the same pass, approved with no new number: Step 6's prescribed suite list omits `server/test/readme-roster-mirror.test.ts`, which exists on `main`, reads the real `README.md`, and is run by no step of this plan; Task 7 adds it.
- **D-2752** (Task 5, fix round 1 — controller-issued) — Task 5's shipped `## Measurements` block claimed "the second number is not in the spec's sentence and is the reason this block exists," restating D-2067's own closing premise ("the spec states a numerator and this wave supplies the denominator"); both are false. Measured at **both** commits: at `origin/main`, the build spec states both numbers at `docs/superpowers/specs/2026-09-08-crossrepo-programmes-design.md:149-150` ("zero `legacy-home-project` events AND at least one run opened over seven consecutive days") and repeats them in the §9 acceptance bullet at `:461-463` ("zero `legacy-home-project` events and at least one run opened over seven consecutive days … (§3 F2; D-2066, D-2067)"); at that spec's **first commit `644aea41`**, the same two clauses already sit at `:144` and `:422-424`, word for word. The spec has never lacked the denominator, in any commit reachable from its own history. This supersedes D-2067's closing premise and Task 5's prescribed sentence, both corrected in the same fix-round-1 commit that defines this entry (F1). The true history is the good case, not a regression: D-2067 was raised against a pre-spec draft and **folded into the spec before its first commit** — the spec's own inline `(D-2067)` citation at `:150`/`:463` is the evidence of the fold — and the plan (`plan:1875`) kept prescribing prose that argued for a fold already done, which Task 5 then transcribed into the ledger as though it were still true. Class line: a deviation whose entry names a defect its own spec had already fixed, with the remedy already shipped, while the plan kept arguing for it — cross-reference **D-2068**, the same shape (a plan-time entry whose premise a later measurement superseded). The ledger's own wave-2 text (now `:220-222`, "The legacy flip is dated by evidence … AND at least one run opened … (D-2066, D-2067)") already cited both numbers correctly throughout, so the file contradicted itself for exactly the one commit (`d5013f9b`) this fix corrects.
- **D-2753** (whole-branch review, fix round 3 — MAJOR 1/3/4, controller-issued number) — Three README claims, each false against its own cited source, two of them shipped in duplicate. **MAJOR 1** (README.md:1560-1563, then :1851-1854): `GET /api/mail?program=<slug>` was said to answer "only outstanding mail"; `mailForProgram`'s default WHERE clause is `OUTSTANDING_OR_ABANDONED_SQL` (`server/src/coord/store.ts:634-635`) = `d.state IN ('queued','delivered') OR ABANDONED_PARK_SQL`, and `ABANDONED_PARK_SQL` (`:535-538`) additionally admits a `rejected` delivery this build gave up retrying before anyone acted on it — a state `OUTSTANDING_STATES_SQL` (`:400`) does not include — and the method's own docstring (`:2768-2770`) states the predicate answers "still needs a human's attention," deliberately not the delivery lane's own question; the same README section defines "outstanding" as "queued *and* delivered-but-unacked" eight lines above the false claim, so the passage contradicted itself inside eight lines. Fixed in both copies to say the read is the outstanding mail plus any delivery this build parked after giving up retrying it, keeping the word "outstanding" inside the 120-character window `crossrepo-prose.test.ts:141-142`/`:363-364` require after the closing backtick of `` `GET /api/mail?program=<slug>` `` — neither assertion was touched. **MAJOR 3** (README.md:1554-1558, then :1845-1850): "the replacement inherits every outstanding delivery addressed to its predecessor" overstated the one writer, `bindSession` (`store.ts:1709-1721`), whose call `requeueAbandonedMail({ role: 'worker', runId }, sessionId, [predecessor])` (`:1350`+) filters `m.toId = 'worker'`, `m.runId = ?` (the worker arm's scope), and a `NOT EXISTS` dedupe against rows already outstanding for the heir — none of which the README stated; the same paragraph two sentences earlier says "Raw session-id addressing stays for ad-hoc mail," so the unqualified claim contradicted its own neighbour, since raw session-id mail is exactly what is not inherited. Fixed in both copies to "outstanding role-addressed (`toId:'worker'`) delivery on that run." **MAJOR 4** (README.md:1576-1580; symbol `orphanNote` in `pwa/src/fleet/ProjectCard.tsx`, cited by symbol rather than line because `origin/main`'s merge into this branch moved it from `:261` to `:350` — the exact shelf-life failure this entry and D-2755 both exist to record): "its row reads `<program> wave n/N · home <project>`" was stated of every worker row on the fleet board; `orphanNote` emits that text only for a rule-3 orphan (`row.kind === 'session' && row.depth === 0`, a run exists, `run.claimedBy` is non-null and differs from the row's own session, and that parent is not among the card's own live sessions) and appends `· home <project>` only when `crossingNote(...)` is non-null, exactly as the build spec states both qualifiers verbatim (`docs/superpowers/specs/2026-09-08-crossrepo-programmes-design.md:255-258`). Fixed to restore both qualifiers, following the spec's own wording. Measured: no test in `server/test/*.ts` pins the unqualified wording in any of the three cases — `crossrepo-prose.test.ts` re-run 17/17 green after all three fixes.

**Fix round 4, a fourth false README claim, same class (C1):** README.md:1592 said "`$REG/coordinator-paused` is global and still stops everything." Measured (re-ran the census): `COORDINATOR_PAUSE_MARKER` has exactly two consumers in `server/src` — `coord/dispatch.ts:264`, which refuses dispatch when the marker is present, and `watch.ts:1184`, which reports it to the wire. Nothing else reads it, so it refuses every dispatch on that box and stops nothing else: mail keeps flowing, and `$REG/mail-disabled` is the mail switch, not this marker. Fixed to say exactly that. Three further minors, same round, same class: **(C2)** README.md's two copies of the parked-mail clause said "any delivery this build parked after giving up retrying it" without its conditions; `ABANDONED_PARK_SQL` (`store.ts:535-538`) is `d.state = 'rejected' AND lastError NOT IN` the deliberate-cancel set `AND run.state NOT IN ('done','failed')` — both copies now say "any `rejected` delivery this build gave up retrying, unless it was a deliberate cancel or its run is already `done`/`failed`". **(C3)** README.md said `bindSession` is "the one writer of `runs.sessionId`"; `bindSession`'s own docstring (`store.ts:1669-1677`) names a second writer, `reconstruct`'s `INSERT INTO runs` (a fresh row off the registry, not a re-bind), and scopes its own "ONE WRITER" claim to re-binding specifically — reworded to "the one writer that re-binds it". **(C4)** README.md's abroad-line parenthetical read `("wave 2 in \`<other project>\`")`; the actual render (`ProjectCard.tsx`'s abroad list, `` `${r.program} ${waveLabel(r)} in ${r.project}` ``) leads with the programme slug, which the parenthetical dropped — reworded to `` ("`<program>` wave 2/3 in `<other project>`") ``. `crossrepo-prose.test.ts` re-run 17/17 green after all four fix-round-4 edits.

- **D-2754** (whole-branch review, fix round 3 — MAJOR 2, controller-issued number) — D-2747's remedy had added, as the "grounded pin" for the heir paragraph, `expect(s, …).toMatch(/outstanding/i)` running over the WHOLE 7472-character `crossSection()`, which the review measured to contain THREE unrelated `/outstanding/i` matches (the heir sentence, the programme-mail read, and the feed's no-split sentence) — deleting the entire heir paragraph from an in-memory copy left the assertion GREEN, so it could never fire for its stated subject; only the negative `/undelivered/i` ratchet did any work. Fixed in `server/test/crossrepo-prose.test.ts`'s "the heir inherits outstanding mail…(D-2747)" it-block: sliced the heir paragraph first with the file's own `passage()` helper (`"When a run's session is replaced"` → `"**Finding a programme's traffic.**"`), the same shape `readme-holds.test.ts`'s D-2680 describe already uses for its own sub-slices, then asserted `/outstanding/i` and `not.toMatch(/undelivered/i)` against that slice instead of the whole section. **Measured, as the fix requires**: deleting the 309-character heir paragraph from `README.md` (`"When a run's session is replaced"` through `"**Finding a programme's traffic.**"`) and re-running `crossrepo-prose.test.ts` reds exactly one test — `AssertionError: the heir paragraph: the opening anchor is gone: expected -1 to be greater than -1`, 16 passed / 1 failed — naming the paragraph's own absence as the cause, not a coincidental match elsewhere in the section; restoring from a scratch copy brought `README.md` back byte-identical (md5 `70de6ee2badb4b448f0a685e9b905105` before and after the mutation), and the re-run returned to 17 passed / 0 failed. A vacuous-guard fix that is not measured red afterwards is a claim, not a fix — this one is measured both ways.

**Fix round 4, a false assertion name of the same vacuous-pin class (C10):** the response-fields it-block (fix round 3, `crossrepo-prose.test.ts:68-85` after this round's own edit; `:68-73` before it), named `` 'names the response fields the open route actually sends' ``, looped `['homeProject', 'ledgerRepo', 'ledgerAbsPath']`. Measured at `server/src/coord/routes.ts:1299-1315`: the open response sends `ok`, `id`, `program`, `state`, `ledgerPath`, `ledgerRepo`, `ledgerAbsPath` — and no `homeProject`, which is the REQUEST body field the route destructures off `body` (`:1142`), not a response key. The loop passed anyway because `ROUTES` contains both uses of the literal and `crossSection()` names `homeProject` for its own, unrelated reason (the open call's request contract, README:1488). Fixed: the response-fields loop now runs over `['ledgerPath', 'ledgerRepo', 'ledgerAbsPath']` — adding `ledgerPath`, which README's cross-repo section also names (README:1519) — `homeProject` is asserted separately as the request-body field, and the `it()` is renamed `` "names the open response's own fields, and homeProject as the request field it actually is" ``, matching what it now pins. `crossrepo-prose.test.ts` re-run 17/17 green.

**Fix round 4, five further vacuous pins of the same class, RECORD-ONLY — not fixed this round, each with its assertion, why it cannot fail, and the one-line repair for the next editor.** **(C11)** `crossrepo-prose.test.ts:530-531`, `` expect(m, 'the measurement is undated…').toMatch(/20\d\d-\d\d-\d\d/) `` over the whole `## Measurements` block: the block carries FOUR date-shaped substrings (the block's own "taken `2026-09-14`", and three more inside the stale-projection paragraph's timestamps, `2026-09-11`/`2026-09-18`/`2026-09-14`), so deleting the measurement's own date leaves the assertion green off the others. Repair: anchor on the specific phrase, `` /taken 20\d\d-\d\d-\d\d/ ``. **(C12)** `crossrepo-prose.test.ts:265-266`, the `for (const code of MISMATCH_CODES)` loop inside `` it('names each -mismatch refusal in the lifecycle step that emits it', …) `` checks `\`${code}\`` against the WHOLE `lifecyclePassage()` (`p`, all six steps), never against just the step that emits it, so a `-mismatch` code named in the wrong step still passes despite the `it` name's own claim. Repair: slice `p` to the one step per code (as `crossSection()`'s own per-arm slicing already does elsewhere in this file) before asserting containment. **(C13)** `crossrepo-prose.test.ts:63-65`, `` toContain('409') `` and `` toContain('"by"') `` run over the whole `crossSection()` bullet list rather than per-refusal: if one `-mismatch` bullet carries `409`/`"by"` and a sibling bullet does not, the sibling's omission is invisible — one bullet alibis the other. Repair: scope both checks inside the existing `for (const code of MISMATCH_CODES)` loop two lines above, against a per-code sub-slice. **(C14)** `crossrepo-prose.test.ts:157-158`, `` toContain('programless') `` for "an event with no run behind it is programless": README.md:1569's own sentence and README.md:1570, the very next sentence ("programless rows sit under their own…"), both contain the word, so deleting line 1569's specific claim leaves the check green off its neighbour. Repair: match the specific sentence, e.g. `` /no run behind it is[\s\S]{0,20}?programless/i ``. **(C15)** `crossrepo-prose.test.ts:200-201`, `` /terminal[\s\S]{0,80}?producer[\s\S]{0,100}?no running-worker slot/i ``: README's own preceding sentence ends "…counts dispatched, non-terminal runs", and `terminal` inside `non-terminal` is itself a hyphen-bounded word, so the regex's `terminal` anchor can and does resolve there first — measured, 27 characters of slack remain before the `{0,80}` cap is exhausted from that earlier start, so the pin survives even a further short insertion between the two sentences. Repair: require the two words adjacent, `` /\bterminal producer\b[\s\S]{0,100}?no running-worker slot/i ``, which the prior sentence's `non-terminal runs` cannot supply.

- **D-2755** (whole-branch review, fix round 3 — MAJOR 5 + MINOR 8, controller-issued number) — Two unrelated stale-measurement defects, both this wave's own declared class (a claim its own source does not support). **(1) MAJOR 5**: the wave-3 plan's D-2740 entry labelled a set of offsets "the CURRENT shipped passage" — `independently prove` at `459`, `dispatch` at `151,708,744,941` — true when measured at fix round 1 (`2544c163`) and false at every commit since (`c05d2cb4` and HEAD `88262bc5` both measure `481`; `151,733,769,966`, reproduced above in D-2740's own fact (1)). D-2745 already re-measured HEAD correctly but then asserted "D-2740 fact (1) stands exactly as fix round 1 wrote it and is not revised by this entry," leaving two contradictory "current" offset sets in one file. Fixed: D-2740's own text now scopes its offsets to "the fix-round-1 shipped passage (commit `2544c163`)" and points at D-2745's HEAD figures beside it; D-2745's closing sentence now separates the CONCLUSION (unrevised — the ordering assertion is satisfied by the trailing caveat's `dispatch`, never any of the arm's own) from the now-superseded numeric offsets, and names which figures belong to HEAD. **(2) MINOR 8**: README.md's same-project succession arm (then :1746-1748, now :1749-1752) said "require its `phase` to be `merged`" of "that session's merged PR row" — `phase` is emitted once, at the TOP LEVEL of `ccd pr-state --session`'s JSON (`ccd:4192-4196`, `{…, 'rows': rows, 'phase': phase, 'number': number, …}`; re-measured on this tree at these line numbers, which have moved from the review's `ccd:4061-4066` for the same reason MAJOR 4's citation moved — an unrelated merge shifted the file), never as a per-row field (`ccd:3535`'s `PR_JSON_FIELDS` names `number,state,headRefName,headRefOid,baseRefName,isCrossRepository,mergedAt,mergeCommit,url,title,isDraft`, plus `ours` from `annotate`); the cross-project arm already states this correctly ("the selected `phase`"). Fixed to "require the answer's `phase` to be `merged`, and require that row's raw `headRefOid` to equal…", matching the cross-project arm's own wording; the `headRefOid`→`handoffCommit`→`producerSha` ordering `crossrepo-prose.test.ts` pins over the same-project arm is unaffected by the reword (re-measured: 17/17 green). **(3), same class, folded into this number's citation sweep rather than a separate entry**: five stale line-number citations in `server/test/crossrepo-prose.test.ts` comments, each verified by opening the file it names rather than applying the review's uniform "+12" blindly — `box-token-census.test.ts:227`→`:239` (`const passage`, its own slicer), `readme-holds.test.ts:27`→`:29` (`lifecycleSection` opens at `:29`, `holdsSection` at `:40`), `box-token-census.test.ts:307-339`→`:319-352` (the mail-bus paragraph's own it-block), `:341-360`→`:353-371` (the caps paragraph's it-block — the uniform +12 held for these four), and `readme-holds.test.ts:62`→`:70` (the `'\n6. '` bound on the `crossing` sub-slice — NOT +12; this branch's own 9-line insertion into that file widened the drift beyond the uniform offset, exactly as the review measured). All five corrected in place; `crossrepo-prose.test.ts` re-run 17/17 green after every edit in this entry. **Hygiene residual, recorded rather than swept (coordinator ruling, 2026-09-14):** nine branch commits before the tip cited an untracked scratch artifact by absolute path; it is removed at the tip, it is absent from the PR's own diff (measured zero), and the head branch is deleted on merge, so no ref reaches those commits afterwards — a force-push was considered and declined, because rewriting them does not remove the objects a public host has already accepted (they stay fetchable by sha until it garbage-collects, which it does not promise), so the cost would buy a reduction in discoverability only; removing the objects outright is a request to the host after merge, and it is the operator's to make. **(4), fix round 4, same class:** three further stale citations, this time inside the ledger's own prose rather than a test file. D-2747(a) cited README:1836/"282 lines apart" for the sibling "outstanding" paragraph; this branch's own further README edits (fix round 4, base `9561176a`) moved it to :1841/287 lines apart — corrected in place, stamped with the base sha it was re-measured against. D-2746 cited plan:686-687 for the dependency-gate regex left cross-only; that range is the marker-tuple loop a few lines below it, not the regex — the regex itself is at plan:677-678, corrected in place. D-2745's delta (2) cited plan:801 for the cross-project arm's "the exact producer closed row"; `:800` is the same-project arm's own copy of the same phrase, and the cross-project copy this delta is actually about sits at `:812` — corrected in place. All three are this wave's own re-editing moving the target out from under the citation, not the wave-2/wave-3 merge drift (1)-(3) above record — same defect shape, different cause. **Coordinator ruling, recorded here because it is nowhere else (fix round 4, C19):** the wave-3 ledger row names the branch (`worker branch \`ws/bright-meadow\``), never a short sha, because the commit that writes the row cannot name its own tip — Step 7 prescribes `<short sha>` = `git rev-parse --short HEAD` taken AFTER the commit that ships the row, which that same commit cannot satisfy. The row names the branch instead, and the flip wave's own boundary commit fills in both the PR number and the merged sha, the same post-merge coordinator act Step 7 already specifies for the PR cell.

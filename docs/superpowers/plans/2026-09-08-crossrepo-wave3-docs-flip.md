# Cross-repo programmes — wave 3: the operator's docs, the superseded draft, and the legacy flip by evidence — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make every operator-facing sentence about cross-repo programmes true — README's two coordination sections, the Aug 11 draft's Status block, and the programme ledger — hold each of them to the code and the spec they describe, and then flip the legacy generation shut **only against a measurement that was actually taken**, recording the number either way.

**Architecture:** This wave writes almost no mechanism. It CONSUMES everything waves 1 and 2 shipped (the two refusal codes, `homeProject` on the programme row, `ledgerRepo`/`ledgerAbsPath` on the open response, the `worker` mail role and `bindSession`'s heir re-issue, the two programme filters, the runs-screen badge and crossing marker, the fleet card's abroad line, the mail screen's grouping) and PRODUCES prose plus the ratchet that holds the prose to its source. One new suite, `server/test/crossrepo-prose.test.ts`, carries every prose pin; every assertion is grounded in the file it describes — `shared/api.ts`'s own `RUN_REFUSE_CODES`, `server/src/coord/routes.ts`'s handlers, the PWA sources, the build spec's own §9 paragraph — never in a fixed sentence a later edit could silently falsify. The one code change in the wave is a single constant, and it is gated on a measurement this plan makes an explicit, separately-reviewable task.

**Tech Stack:** Markdown (`README.md`, `CLAUDE.md`, `docs/superpowers/specs/2026-08-11-crossrepo-programmes-design.md`, `docs/superpowers/programs/crossrepo-programmes.md`), TypeScript (`server/src/coord/routes.ts` — one constant), vitest (`server/test/crossrepo-prose.test.ts`, `server/test/home-project-required.test.ts`), `sqlite3`/`node:sqlite` for the one operator-side read.

**Spec:** docs/superpowers/specs/2026-09-08-crossrepo-programmes-design.md

**Base:** origin/main d0064e6e; branch `ws/<the workspace the coordinator dispatches into>`

**NOT agent-first — measured, and it disagrees with one line of the spec.** Spec §9's wave-3 bullet lists "the coordinator references" in this wave's scope, but §3 F3's own bullet moved the refusal-list sentence and its `wave-lifecycle.md` rows into WAVE 1 (because `server/test/coordinator-skill.test.ts` requires every `RunRefuseCode` to be named in the skill corpus the moment the code exists) and the behavioural clauses into WAVE 2. Measured at `d0064e6e`: this wave touches **nothing** under `ccd/`, nothing under `session-hook.sh`, and nothing under `ccd/coordinator-skill/` or `ccd/worker-skill/`. The AGENT-FIRST rule therefore does not bind it, and there is no agent deploy step in this plan. The server lane alone ships, and it ships only if Task 6 lands (`bash deploy/deploy.sh`); a docs-only outcome ships nothing at all. This disagreement with §9 is recorded as **D-2069**.

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
- **Deviation numbers come only from the allocator.** This plan carries **five** plan-time findings as `D-TBD-<slug>` entries in `## Deviations found`; the orchestrator mints the block in ONE call and substitutes the numbers into this section, into the `LEDGER:` lines of Tasks 1, 5 and 6, into Task 7's reference to the header note, AND into the two comments inside `server/test/crossrepo-prose.test.ts` (Task 1 Step 1's caps-paragraph comment and Task 5 Step 2's both-numbers comment) — before this branch's PR is opened. `server/test/dtbd.test.ts` git-greps every tracked file, so a concrete placeholder left in a TEST COMMENT reds the build exactly as one left in prose does; the substitution is mechanical, not remembered. A deviation FOUND during execution gets its own allocator call at the moment it is found, never a number from a gap in that block.
- **README is canonical; `CLAUDE.md` is the non-obvious operational rules.** This wave adds prose to README only. Its single `CLAUDE.md` edit is the README line-count figure (Task 2, Step 6), nothing else.
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
- Wave 1, `server/src/coord/routes.ts`: `POST /api/runs` takes `homeProject`; the two 409 refusals with `by`; the run events `legacy-home-project` and `home-project-backfilled`; the constant `HOME_PROJECT_LEGACY_ACCEPTED`; the response fields `ledgerRepo` and `ledgerAbsPath`; `POST /api/mail` admits `to: 'worker'`; `GET /api/mail?program=`; `GET /api/feed?program=`. `server/src/coord/dispatch.ts`: `DispatchOutcome`'s refused member gains `by?: string`, passed through by `sendDispatchOutcome`.
- Wave 1, `ccd/ccrc-api`: `--program` on the `mail list` row and a new `feed list GET /api/feed [--program | --limit]` row.
- Wave 2, PWA: `run-project` on every runs-screen row; the crossing marker; `ProjectCard`'s additive `abroad` prop and the rule-3 orphan marker text `"<program> wave n/N · home <project>"`; `FleetScreen`'s per-card abroad list; `MailScreen`'s programme grouping and filter chip.

**Produces (for reviewers, for the dogfood programme, and for whoever flips the constant if this wave defers it):**

- `README.md` § "Cross-repo programmes: one home, waves anywhere" — the canonical operator-facing account. Any later change to a crossing behaviour edits this section and reds `crossrepo-prose.test.ts` if it does not.
- `server/test/crossrepo-prose.test.ts` — the prose ratchet, five describe blocks.
- `server/test/home-project-required.test.ts` — the flip's own suite (Task 6 only).
- `docs/superpowers/programs/crossrepo-programmes.md` — waves 1–2 closed, the dogfood exit criteria verbatim from spec §9, and the flip measurement recorded with its date whichever way it went.

---

## File Structure

| File | Change | Task | Responsibility after this wave |
|---|---|---|---|
| `server/test/crossrepo-prose.test.ts` | **Create** (Task 1, appended by Tasks 2–5) | 1–5 | Holding every cross-repo sentence to the code, the spec and the ledger it describes |
| `README.md` — new `###` subsection inserted at `:1293` | Modify | 1 | The whole crossing story: home project, the two refusals with their 409 bodies, `ledgerRepo`/`ledgerAbsPath`, the worker role and the `runId` rule, the two programme filters, the board's three cues, the two-slot cost |
| `README.md:1378-1385`, `:1386-1401`, insertion at `:1484` | Modify | 2 | The run lifecycle's two refusals in the two steps that emit them, and the programme-mail paragraph between the mail-bus paragraph and `**Caps and pause.**` |
| `CLAUDE.md:10` | Modify — one number | 2 | The README size claim, re-measured after the growth |
| `docs/superpowers/specs/2026-08-11-crossrepo-programmes-design.md:3-7` | Modify — the Status block | 3 | Pointing forward at the build spec while keeping its own rulings binding |
| `docs/superpowers/programs/crossrepo-programmes.md` | Modify | 4, 5, 7 | Waves 1–2 closed with their PRs; the dogfood exit criteria verbatim; the flip measurement; the final row |
| `server/src/coord/routes.ts` — `HOME_PROJECT_LEGACY_ACCEPTED` | Modify — one constant | 6 | The legacy generation ends; `homeProject` becomes required at open |
| `server/test/home-project-required.test.ts` | **Create** | 6 | The require branch, driven through the route, plus the shipped value of the constant |
| `server/test/home-project.test.ts` | Modify | 6 | Wave 1's pure-function suite: gains the `required` case the deleted route test covered; its shipped-value assertion flips with the constant (Step 6) |
| `server/test/run-routes.test.ts` | Modify | 6 | `OPEN_BODY` gains `homeProject`; the legacy-generation route test is deleted; the backfill case seeds its own precondition |
| `server/test/coord-caps-route.test.ts` | Modify | 6 | Its `POST /api/runs` fixture gains `homeProject`, so the caps route's own open still opens |

**Prose pins already in the tree that these edits run beside.** Each was READ at `d0064e6e` in the session that wrote this plan; none forbids anything here, and the implementer must not break any of them.

| Suite | What it asserts, and what it means for this wave |
|---|---|
| `server/test/box-token-census.test.ts:307-339` | Slices README `` '`/api/mail` (and its ack route)' `` → `'Minting the token file matters'` and requires that passage to state **no number word at all** (`numeralsIn(p)` `toEqual([])`) while naming every gated run route and every ungated door. **Task 2's new paragraph goes AFTER that passage's closing anchor**, between the end of the mail-bus paragraph (`:1483`) and `**Caps and pause.**` (`:1485`). |
| `server/test/box-token-census.test.ts:341-358` | Slices `'**Caps and pause.**'` → `'Pause is a'` and requires **no number word** there either, plus every ungated door by name. This is why the two-slot sentence lives in Task 1's subsection and not in the caps paragraph (**D-2068**). |
| `server/test/box-token-census.test.ts:277-305` | Slices `'What is gated, and what is not:'` (README `:535`) → `'Enrolling a passkey'`. Far above every edit here; untouched. |
| `server/test/readme-holds.test.ts:27-34` | `holdsSection()` slices `'### Workspace holds & programs'` (`:1293`) to the next `\n## `. **Task 1 inserts its subsection immediately BEFORE that heading**, so the holds slice is byte-identical afterwards. |
| `server/test/worker-skill.test.ts:118-134` | Every mention of `ccd/worker-skill/SKILL.md` in `README.md` and `CLAUDE.md` must state "twelve clauses" within 160 characters. **Do not name that path in any new prose** — Task 1 and Task 2 say "the worker skill" and never the path. |
| `server/test/oss-metadata.test.ts:89-101` | `CLAUDE.md`'s `` `README.md` (~N lines) `` claim must be within 10% of the real count. README grows ~95 lines in Tasks 1–2; Task 2 Step 6 re-measures. |
| `server/test/ccrc-install-graphify.test.ts:648-668` | Two NEGATIVE scans over the WHOLE README: no present-tense verb (`converges|writes|installs|plants|puts`) within 140 characters of `block`/`read rule` and `CLAUDE.md`, and none within 140 characters of `always_on/claude-md.md`. New prose here never names `CLAUDE.md` at all. |
| `server/test/license.test.ts:105-127`, `server/test/ccrc-update.test.ts:929-930` | README's `## License` section (holder, licence, `(LICENSE)` link, §13) and its `bash ≥ <floor>` claim. Untouched. |
| `server/test/topology-clean.test.ts` | Every tracked file, docs included: no operator host, address, tailnet or account residue. Fixture and placeholder names only. |
| `server/test/single-definition.test.ts` | Four TS roots (`shared`, `server/src`, `pwa/src`, `agent/src`) — no second copy of a single-source value. `server/test` is not in `ROOTS`, which is why this plan's local `passage`/`read` helpers (the same shape `box-token-census.test.ts:227` and `readme-holds.test.ts:27` each already spell locally) are not a second definition of anything the guard governs. |
| `server/test/dtbd.test.ts` | `git grep` over every tracked file: a concrete `D-TBD-<slug>` may not land. This plan's five placeholders red it until the orchestrator substitutes the minted numbers. |
| `server/test/deviation-refs.test.ts` | Compares this branch's plan entries against `origin/main`'s WITHOUT merging; run after `git fetch origin main` in Task 7. |

`ccd/coordinator-skill/SKILL.md` and `ccd/worker-skill/SKILL.md` are VERBATIM-pinned by `server/test/coordinator-skill.test.ts` and `server/test/worker-skill.test.ts`. **This wave edits neither** — see the header note and D-2069.

**Mutation table for this wave.** Spec §7's table is unnumbered and covers waves 1–2's guards; this plan numbers its own rows and each task names the one it discharges.

| Row | Guard | Red when |
|---|---|---|
| W3-1 | README's cross-repo subsection | the subsection is deleted or renamed; a `*-mismatch` code exists that it does not name; it stops naming a response field the open route sends; it stops naming the worker role, the `runId` rule, either filter route, `run-project`, `abroad`, or the two-slot cost |
| W3-2 | README's run-lifecycle steps and the programme-mail paragraph | either mismatch code goes missing from the lifecycle list; the programme-mail paragraph is deleted or stops naming a role, `unknown-recipient`, or either filter route |
| W3-3 | the Aug 11 draft's Status block | it stops naming the build spec's path, or stops saying its own rulings still bind |
| W3-4 | the programme ledger | wave 1 or wave 2's row carries no PR or is not closed; a clause of spec §9's acceptance list is missing from the exit criteria |
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

**Spec refs:** §3 F1 (both refusal sites), §3 F2 (the home project, the response fields), §3 F3 (the absolute-path rule, the two-slot consequence), §3 F4 (the board's three cues), §4 (the worker role, the heir, the two filters), §5 (caps unchanged), §9 wave 3.

**Mutation table:** row W3-1. Measured in Step 6 by deleting the whole subsection from `README.md` and re-running the suite: `crossSection()`'s opening-anchor assertion reds first and every test in the describe follows it.

**LEDGER:** the two-slot sentence cannot live where its content belongs. Spec §5 puts "a crossing costs two live workspaces, two concurrency slots and two of the daily budget" beside the caps rules, and README's caps paragraph is where an operator reads those — but `box-token-census.test.ts:352-354` pins that exact passage (`'**Caps and pause.**'` → `'Pause is a'`) to state NO number word at all, and the whole point of the sentence is the word "two". The sentence therefore lives in this subsection, and the caps paragraph is left alone (**D-2068**).

Anchor quotes, verified by reading the files in this session, so the sites are findable even if the numbers drift.

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
// subsection and its run-lifecycle/mail paragraphs, the Aug 11 draft's Status
// block, and the programme ledger. Every assertion is grounded in the SOURCE it
// describes — `RUN_REFUSE_CODES`, the route handlers, the PWA files, the build
// spec's own §9 paragraph — never in a fixed sentence a later edit could
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

  it('states the worker role AND the runId rule that keeps a worker off the refusal', () => {
    expect(ROUTES, "the send route no longer carries the 'worker' literal — this check is over nothing")
      .toContain("'worker'");
    const s = crossSection();
    expect(s, "the section does not name the worker role").toContain("to: 'worker'");
    expect(s, "the section does not name the coordinator role beside it").toContain("to: 'coordinator'");
    // WITHIN ONE WINDOW, not merely both present somewhere: the rule is that a
    // `worker` mail carries a runId, and a section that names the role in one
    // paragraph and `runId` four paragraphs later has not stated the rule.
    expect(s, 'the section describes the worker role without the runId rule beside it')
      .toMatch(/to: 'worker'[\s\S]{0,700}?runId/);
    expect(s, 'the section does not say what an unresolvable role answers')
      .toContain('unknown-recipient');
  });

  it('names both programme filters, grounded in the handlers that serve them', () => {
    // THE HANDLER BODY, NOT THE GAP TO THE NEXT REGISTRATION. Measured at
    // `d0064e6e`: `GET /api/lifecycle`'s docstring (`routes.ts:1644`) contains
    // the word "program", so a passage running from `/api/feed` to the next
    // `app.` would contain "program" whether or not wave 1 ever taught the
    // handler the query key — an anti-vacuity check that proves nothing. Both
    // handlers close on their own `\n  });` with no nested one before it
    // (`routes.ts:836-849`, `:1610-1615`), so that is the closing anchor.
    const feed = passage('the feed handler', ROUTES, "app.get('/api/feed'", '\n  });');
    const mail = passage('the mail list handler', ROUTES, "app.get('/api/mail'", '\n  });');
    expect(feed, 'the feed handler does not read `program` — wave 1 has not landed').toContain('program');
    expect(mail, 'the mail list handler does not read `program` — wave 1 has not landed').toContain('program');
    const s = crossSection();
    expect(s, 'the section does not name the mail filter').toContain('GET /api/mail?program=');
    expect(s, 'the section does not name the feed filter').toContain('GET /api/feed?program=');
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

  it('states what a crossing costs, and says so where a count is allowed to be', () => {
    const s = crossSection();
    expect(s, 'the section does not say a crossing holds two workspaces').toMatch(/two concurrency slots/);
    for (const code of ['cap-concurrency', 'cap-daily']) {
      expect(RUN_REFUSE_CODES as readonly string[],
        `${code} is not a declared RunRefuseCode — this claim is over nothing`).toContain(code);
      expect(s, `the section does not name \`${code}\` as the shape that cost takes`).toContain(code);
    }
    // AND THE REASON IT LIVES HERE (D-2068).
    // `box-token-census.test.ts:352-354` requires README's caps paragraph to
    // state no number word at all, so the sentence whose whole point is "two"
    // cannot go where its content belongs. Pinned HERE, with the reason, so an
    // editor who moves it back reds this with an explanation instead of reding
    // a census test whose message is about hand-kept door counts.
    const caps = passage('README, the caps paragraph', README, '**Caps and pause.**', 'Pause is a');
    expect(caps, 'the two-slot sentence was moved into the caps paragraph, which is pinned ' +
      'count-free by box-token-census.test.ts:352-354 — it belongs in the cross-repo section')
      .not.toMatch(/\btwo\b/i);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd server && ./node_modules/.bin/vitest run test/crossrepo-prose.test.ts`

Expected: FAIL — 6 failed, 0 passed. Every test reds on the same first assertion,
`README, the cross-repo subsection: the opening anchor is gone`
(`expected -1 to be greater than -1`), because the subsection does not exist yet. If instead a test reds on one of the anti-vacuity messages (`wave 1 has not landed`, `wave 2 has not landed`), STOP: this wave is being executed before the wave it documents, and no prose edit can fix that.

- [ ] **Step 3: Write the subsection**

In `README.md`, insert the following immediately before `### Workspace holds & programs` (`:1293`) — i.e. after the Build 4 dogfood subsection's closing line `and an audit trail that reads true.` and its blank line:

```markdown
### Cross-repo programmes: one home, waves anywhere

A programme is **initiated in one project and stays there**: its spec, its plan,
its ledger (`docs/superpowers/programs/<slug>.md`) and its coordinator session
all live in that one repo. That repo is the programme's **home project**, and it
is *declared*, never inferred — `POST /api/runs` takes `homeProject` and stores
it on the programme row at first insert. It is not guessed from wave 1's project
and not derived from the registry or from whoever claims the run: a fact a
programme carries for its whole life must not depend on a live read that can
degrade.

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
`docs/superpowers/programs/<slug>.md`) — the absolute path by which a worker in
another repo reads the home plan. Both are `null` while the stored home is null.
Nothing is guessed into either.

**Foreign-repo waves read, never write.** One box, one user: a worker in another
repo opens the home plan by the absolute path its brief gives it, and commits
only on its own workspace branch in its own repository. The brief cites that plan
at a named sha and *inlines* the contract excerpt the wave depends on, so the
worker never reads the home plan to discover what it must build — only to read
its context. Paths, not payloads; the 8 KiB body cap stands.

**Mail finds a role, not a session.** `to: 'worker'` joins `to: 'coordinator'`
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

**Finding a programme's traffic.** `GET /api/mail?program=<slug>` answers every
mail on that programme's runs, and `to` becomes optional when `program` is
given; `GET /api/feed?program=<slug>` answers its feed events. An event with no
run behind it is **programless** and appears only unfiltered. `/mail` groups the
feed by programme, with a filter chip; programless rows sit under their own
header.

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
and no per-programme cap. So a programme with a wave abroad is holding two live
workspaces, and they take two concurrency slots and two of the daily budget. A
`cap-concurrency` or `cap-daily` refusal during a cross-repo programme is that
cost showing up, not a bug. `$REG/coordinator-paused` is global and still stops
everything; the hold reason still names programme, wave and run id and never a
project, because the run row is what carries the project.
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd server && ./node_modules/.bin/vitest run test/crossrepo-prose.test.ts`

Expected: PASS — 6 passed.

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

Expected: FAIL — 6 failed, each on `README, the cross-repo subsection: the opening anchor is gone`. Then restore the subsection (`git checkout -- README.md` is NOT available under this plan's hard limits — restore by re-applying Step 3's text) and re-run: 6 passed. Record both numbers in the task's run log.

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
- Consumes: `RUN_REFUSE_CODES` and the `passage`/`read`/`MISMATCH_CODES` helpers Task 1 produced; wave 1's `bindSession` (named in the prose as the one writer of `runs.sessionId`), `resolveWorker`, `mailForProgram`, `feedEventsForProgram`.
- Produces: `lifecyclePassage()` and `programmeMailPassage()` in `server/test/crossrepo-prose.test.ts`; README's run-lifecycle steps 1–2 as the statement of where each refusal fires; the `**Programme mail at scale.**` paragraph.

**Spec refs:** §3 F1 (the two sites and their ordering — "BEFORE the hold, the `/clear` and `markDispatched`"), §3 F2 (the response fields), §4 (role addressing, the heir, the two filters), §9 wave 3.

**Mutation table:** row W3-2. Measured in Step 7 by deleting the `**Programme mail at scale.**` paragraph and, separately, by deleting the two refusal sentences from the lifecycle steps: the first reds `README, the programme-mail paragraph: the opening anchor is gone`, the second reds the per-code containment assertion naming the missing code.

Anchor quotes, verified by reading `README.md` in this session.

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
  });

  it('the programme-mail paragraph names both roles, the refusal and both filters', () => {
    const p = programmeMailPassage();
    expect(p, 'the paragraph does not name the worker role').toContain("to: 'worker'");
    expect(p, 'the paragraph does not name the coordinator role').toContain("to: 'coordinator'");
    expect(p, 'the paragraph does not say what an unresolvable role answers')
      .toContain('unknown-recipient');
    expect(p, 'the paragraph does not name the mail filter').toContain('GET /api/mail?program=');
    expect(p, 'the paragraph does not name the feed filter').toContain('GET /api/feed?program=');
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

Expected: FAIL — 7 passed, 3 failed: `the run lifecycle does not name \`project-mismatch\` in the step that emits it` (the first new test stops at its first failing code); `step 1 does not say the open refusal happens before the row is opened` (the second new test's first assertion); and `README, the programme-mail paragraph: the opening anchor is gone` (the third new test — `programmeMailPassage()`'s opening anchor does not exist yet). The fourth new test, `does not disturb the two count-free paragraphs it sits between`, PASSES already: it slices two anchors that already exist and asserts `.not.toContain('**Programme mail at scale.**')`, which is true before that heading is written anywhere — a locality guard with nothing yet to catch.

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

- [ ] **Step 5: Insert the programme-mail paragraph**

In `README.md`, insert between the mail-bus paragraph's last line (`:1483`, ending `because that exact placeholder is committed to this public repo.`) and `**Caps and pause.**` (`:1485`), separated by a blank line on each side:

```markdown
**Programme mail at scale.** `to: 'coordinator'` has a sibling: `to: 'worker'`,
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
Reading it back by programme: `GET /api/mail?program=<slug>` (`to` becomes
optional when `program` is given) and `GET /api/feed?program=<slug>`, both
joining through the run row; an event with no run behind it is programless and
shows only unfiltered.
```

- [ ] **Step 6: Re-measure README and update the size claim**

```bash
wc -l README.md
```

Take that number, round it to the nearest five, and in `CLAUDE.md:10` replace `` `README.md` (~2485 lines) `` with `` `README.md` (~<measured> lines) `` — the number only, nothing else on the line. README was 2507 lines at `d0064e6e` and grows ~95 lines across Tasks 1–2, so the untouched claim would still be inside `oss-metadata`'s 10% tolerance; this keeps it honest rather than merely legal.

- [ ] **Step 7: Run the tests to verify they pass, and measure the mutation (row W3-2)**

```bash
cd server && ./node_modules/.bin/vitest run test/crossrepo-prose.test.ts test/oss-metadata.test.ts test/box-token-census.test.ts test/readme-holds.test.ts
```

Expected: PASS — `crossrepo-prose` 10 passed, and every neighbour green.

Then measure, one mutation at a time, restoring after each:

1. Delete the `**Programme mail at scale.**` paragraph → re-run `crossrepo-prose`: FAIL, 2 tests, on `README, the programme-mail paragraph: the opening anchor is gone`.
2. Restore it; delete the `home-mismatch`/`project-mismatch` sentences from lifecycle step 1 → re-run: FAIL on `the run lifecycle does not name \`home-mismatch\` in the step that emits it` (and the `ledgerRepo`/`ledgerAbsPath`/`homeProject` assertions in the second test).
3. Restore, re-run: 10 passed.

Record all three results in the task's run log.

- [ ] **Step 8: Commit**

```bash
git add README.md CLAUDE.md server/test/crossrepo-prose.test.ts
git commit -m "docs(readme): the two refusals in the lifecycle steps that emit them, and mail by role and programme"
```

---

### Task 3: The Aug 11 draft's Status block points forward, and keeps its own rulings binding

**Files:**
- Modify: `docs/superpowers/specs/2026-08-11-crossrepo-programmes-design.md:3-7` (the Status block)
- Modify: `server/test/crossrepo-prose.test.ts` — append one describe block

**Interfaces:**
- Consumes: `passage`/`read` from Task 1; the build spec's own "Supersedes for building purposes, inherits for rulings" block (`2026-09-08-crossrepo-programmes-design.md:8-12`), which is the other half of the link.
- Produces: the two-way link between the two spec files, and `augStatus()` in `server/test/crossrepo-prose.test.ts`.

**Spec refs:** the build spec's own header block (`:8-12`), §1 (the rulings carried verbatim), §9 wave 3 ("docs"), §10.

**Mutation table:** row W3-3. Measured in Step 5 by reverting the Status block to its `d0064e6e` text: the forward-pointer assertion reds naming the missing path.

Anchor quotes, verified by reading the files in this session.

`docs/superpowers/specs/2026-08-11-crossrepo-programmes-design.md:3-8`:

```markdown
**Status:** design, 2026-08-11 — drafted against the operator ruling of the
same date, which supersedes the earlier open framing. Task #33. Scoped from
two read-only scouts against `d0c44df` (main, unmodified) while build4 run 1
was live on the fleet; every file:line below was measured, not assumed.

**Inherits:** Build 7's fleet-coordination design
```

`docs/superpowers/specs/2026-09-08-crossrepo-programmes-design.md:8-12` — the half of the link that already exists:

```markdown
**Supersedes for building purposes, inherits for rulings:**
`docs/superpowers/specs/2026-08-11-crossrepo-programmes-design.md` — the Aug 11 design, whose
operator rulings stand verbatim (§1 below) and whose seam analysis was measured against a `main` that
is a month and nine programmes behind. Where that draft and this one disagree on a line number, this
one is right; where they disagree on a rule, the ruling in the older file wins and this file says so.
```

- [ ] **Step 1: Write the failing tests**

Append to `server/test/crossrepo-prose.test.ts`:

```ts
const AUG_SPEC_PATH = 'docs/superpowers/specs/2026-08-11-crossrepo-programmes-design.md';
const BUILD_SPEC_PATH = 'docs/superpowers/specs/2026-09-08-crossrepo-programmes-design.md';
const AUG_SPEC = read(AUG_SPEC_PATH);
const BUILD_SPEC = read(BUILD_SPEC_PATH);

/** The Aug 11 draft's Status block alone — the two-way link's older half. */
const augStatus = (): string =>
  passage('the Aug 11 Status block', AUG_SPEC, '**Status:**', '\n**Inherits:**');

describe('the Aug 11 draft and the build spec are a two-way link', () => {
  it('the older draft says which file to build from', () => {
    const s = augStatus();
    expect(s, 'the Aug 11 Status block does not name the build spec — a reader who opens the ' +
      'older file first has no way to find the one that is current').toContain(BUILD_SPEC_PATH);
    expect(s, 'the Status block does not say it is superseded').toMatch(/superseded/i);
  });

  it('and says its own rulings are still binding, naming both open questions', () => {
    // The whole point of the paragraph. "Superseded" alone would tell a reader
    // to ignore the file — but §1 of the build spec exists precisely because
    // this draft's rulings still decide things, and Q1/Q2 are the two that a
    // future session is most likely to try to relitigate.
    const s = augStatus();
    expect(s, 'the Status block does not say the rulings still bind').toMatch(/still bind/i);
    for (const q of ['Q1', 'Q2']) {
      expect(s, `the Status block does not name ${q} among the rulings that survive`).toContain(q);
    }
  });

  it('the build spec points back, so neither file is a dead end', () => {
    expect(BUILD_SPEC, 'the build spec no longer names the Aug 11 draft')
      .toContain('2026-08-11-crossrepo-programmes-design.md');
    expect(BUILD_SPEC, 'the build spec no longer says the older rulings stand')
      .toMatch(/rulings stand/i);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd server && ./node_modules/.bin/vitest run test/crossrepo-prose.test.ts`

Expected: FAIL — 13 tests, 11 passed, 2 failed. The first two tests of the new block fail on `the Aug 11 Status block does not name the build spec …` and `the Status block does not say the rulings still bind`. The third test PASSES already — the build spec's own half of the link exists at `d0064e6e`; note that in the run record rather than treating it as a miss.

- [ ] **Step 3: Rewrite the Status block**

In `docs/superpowers/specs/2026-08-11-crossrepo-programmes-design.md`, replace lines 3-7 (the `**Status:**` paragraph and the blank line after it) with:

```markdown
**Status:** design, 2026-08-11 — drafted against the operator ruling of the
same date, which supersedes the earlier open framing. Task #33. Scoped from
two read-only scouts against `d0c44df` (main, unmodified) while build4 run 1
was live on the fleet; every file:line below was measured, not assumed.

**SUPERSEDED FOR BUILDING, 2026-09-08, by
`docs/superpowers/specs/2026-09-08-crossrepo-programmes-design.md`** — the build
spec, and the one to read to build. Its file:line measurements were taken
against a `main` a month and nine programmes ahead of this file's, so every
seam analysis below is provenance rather than instruction. **The rulings here
still bind**, which is why the build spec's §1 carries them verbatim rather than
restating them: the home-project model with cross-repo waves and no new
cross-repo noun, the absolute-path rule by which a foreign-repo worker reads the
home plan, **Q1** (a cross-run dependency edge is DISCIPLINE, not schema — no
`dependsOn` column until a measured incident justifies one) and **Q2**
(`homeProject` is explicit and required, accepted-and-logged as legacy for one
deploy generation first). Where the two files disagree on a line number, the
build spec is right; where they disagree on a rule, this one is.
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd server && ./node_modules/.bin/vitest run test/crossrepo-prose.test.ts`

Expected: PASS — 13 passed.

- [ ] **Step 5: Measure the mutation (row W3-3)**

Delete the new `**SUPERSEDED FOR BUILDING …**` paragraph, leaving the original four-line Status block, then re-run:

```bash
cd server && ./node_modules/.bin/vitest run test/crossrepo-prose.test.ts
```

Expected: FAIL — 2 tests, on `the Aug 11 Status block does not name the build spec …` and `the Status block does not say the rulings still bind`. Restore the paragraph and re-run: 13 passed.

- [ ] **Step 6: Commit**

```bash
git add docs/superpowers/specs/2026-08-11-crossrepo-programmes-design.md server/test/crossrepo-prose.test.ts
git commit -m "docs(spec): the Aug 11 draft points at the build spec and keeps its rulings binding"
```

---

### Task 4: The programme ledger — waves 1 and 2 closed, and the dogfood exit criteria verbatim

**Files:**
- Modify: `docs/superpowers/programs/crossrepo-programmes.md` — the `## Waves` table's rows 1 and 2, and a new `## Dogfood exit criteria` section
- Modify: `server/test/crossrepo-prose.test.ts` — append one describe block

**Interfaces:**
- Consumes: `passage`/`read` from Task 1; `BUILD_SPEC` from Task 3; the merged PRs of waves 1 and 2 (their numbers are read from `main`, not invented — Step 3 gives the command).
- Produces: `ledgerWaves()` and `LEDGER` in `server/test/crossrepo-prose.test.ts`; the ledger's closed wave table and its dogfood exit criteria, which the dogfood programme is then measured against.

**Spec refs:** §9 (the three waves and the dogfood acceptance list), §6 (no replicated ledger — the exit criteria live in the home ledger and nowhere else). Template: `docs/superpowers/programs/TEMPLATE.md`.

**Mutation table:** row W3-4. Measured in Step 6 by (a) reverting wave 1's row to `| — | not opened |` and (b) deleting one clause from the exit-criteria list: the first reds the PR/closed assertion naming wave 1, the second reds the per-clause containment naming the dropped clause.

Anchor quotes, verified by reading the files in this session.

`docs/superpowers/programs/crossrepo-programmes.md`, the wave table as it stands (the rows are one long line each; the columns are what matter):

```markdown
## Waves

| # | scope | PRs | state |
|---|---|---|---|
| 1 | Server + shared: `project-mismatch` at open and at dispatch resume, … | — | not opened |
| 2 | Skills + PWA: the coordinator skill's boundary sentences, … | — | not opened |
| 3 | Docs + the legacy flip: README sections, the Aug 11 spec's status line, this ledger's close, and `HOME_PROJECT_LEGACY_ACCEPTED → false` ONLY when `run_events` shows zero `legacy-home-project` events over seven consecutive days (measured, or deferred with the measurement recorded). | — | not opened |
```

`docs/superpowers/specs/2026-09-08-crossrepo-programmes-design.md:381-386` — the acceptance list this task copies:

```markdown
**Dogfood, as its own programme after wave 2 is live:** home `custom-tools`, wave 1 there, wave 2 in
`data-internal` on real work the operator names, opened without `sessionId`. Acceptance, from the Aug
draft and unchanged: the wave-2 brief cites the home plan by absolute path at a sha and inlines the
contract verbatim from the merged file; the board shows the crossing on the wave-2 row and the abroad
line on the home card; the ledger's wave table records both PRs across two repos; no content moved by
copy-paste; `project-mismatch` never fires in anger — its proof is a test, not an incident.
```

- [ ] **Step 1: Write the failing tests**

Append to `server/test/crossrepo-prose.test.ts`:

```ts
const LEDGER_PATH = 'docs/superpowers/programs/crossrepo-programmes.md';
const LEDGER = read(LEDGER_PATH);
const flat = (s: string): string => s.replace(/\s+/g, ' ').trim();

/** The ledger's wave table alone — the `## Waves` heading to the next `## `. */
const ledgerWaves = (): string => passage('the ledger wave table', LEDGER, '## Waves', '\n## ');

describe('the programme ledger', () => {
  it('records a merged PR for every wave this programme has shipped', () => {
    const table = ledgerWaves();
    for (const n of ['1', '2']) {
      const row = table.split('\n').find((l) => l.startsWith(`| ${n} |`));
      expect(row, `the ledger has no wave ${n} row`).toBeDefined();
      // A PR NUMBER, not a dash: "the ledger's wave table records both PRs" is
      // one of the dogfood's own exit criteria, and a programme that cannot
      // keep its own table is in no position to hold another one to it.
      expect(row!, `wave ${n} names no PR — the row still reads a dash`).toMatch(/#\d+/);
      expect(row!, `wave ${n} is not closed`).toMatch(/merged/);
    }
    // Wave 3 is THIS wave and closes in Task 7, so it is deliberately not
    // asserted here — asserting it would make this test unpassable at the
    // moment it is written, which is a different thing from red-first.
  });

  it("carries the build spec's dogfood acceptance list, clause by clause", () => {
    // DERIVED FROM THE SPEC'S OWN PARAGRAPH, not retyped: the exit criteria a
    // dogfood programme is measured against must be the ones the spec set, and
    // a copy that drifts is worse than a reference because it still reads as
    // authoritative. Split on `;` after the list's own colon.
    const para = passage("the spec's dogfood paragraph", BUILD_SPEC,
      '**Dogfood, as its own programme', '\n---');
    const listText = para.slice(para.indexOf('Acceptance,'));
    const clauses = flat(listText.slice(listText.indexOf(':') + 1))
      .split(';').map((c) => c.trim().replace(/\.$/, '')).filter((c) => c.length > 20);
    expect(clauses.length, 'the acceptance list did not split — this loop is over nothing')
      .toBeGreaterThanOrEqual(4);
    const ledger = flat(LEDGER);
    for (const c of clauses) {
      expect(ledger, `the ledger's exit criteria drop a clause of the spec's list: "${c}"`)
        .toContain(c);
    }
  });

  it('names the dogfood pair and the shape of its open, so the criteria have a subject', () => {
    const section = passage('the ledger exit criteria', LEDGER,
      '## Dogfood exit criteria', '\n## ');
    expect(section, 'the exit criteria do not say the wave-2 run opens without a sessionId')
      .toContain('sessionId');
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd server && ./node_modules/.bin/vitest run test/crossrepo-prose.test.ts`

Expected: FAIL — 13 passed (Tasks 1–3), 3 failed: `wave 1 names no PR — the row still reads a dash`; `the ledger's exit criteria drop a clause of the spec's list: "the wave-2 brief cites the home plan…"`; and `the ledger exit criteria: the opening anchor is gone`.

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
| 2 | Skills + PWA: the coordinator skill's boundary sentences, the worker skill's foreign-plan sentence, the runs-screen badge and crossing marker, the fleet card's marker and abroad line, the mail screen's programme grouping and chip. AGENT-FIRST. | #<wave-2 PR> | merged <short sha>, deployed agent-first <YYYY-MM-DD> |
```

Both scope cells are copied verbatim from `docs/superpowers/programs/crossrepo-programmes.md:30-31` (the rows this edit replaces) — only the `PRs` and `state` cells change; retyping the scope text from memory is exactly the drift this edit must not introduce.

Then insert this section immediately BEFORE `## Decisions & deviations` (replacing the two-line "Dogfood follows as its own program…" paragraph that currently sits above it, whose content this section subsumes):

```markdown
## Dogfood exit criteria

The dogfood programme runs as its **own** programme once wave 2 is live: home `custom-tools`, wave 1
there, wave 2 in `data-internal` on real work the operator names, **opened without `sessionId`** — the
path that spawns fresh in the target repo, which is the only path a crossing may take. Its exit
criteria are the build spec's §9 acceptance list, verbatim, and this ledger is where they are measured:

- the wave-2 brief cites the home plan by absolute path at a sha and inlines the contract verbatim from the merged file
- the board shows the crossing on the wave-2 row and the abroad line on the home card
- the ledger's wave table records both PRs across two repos
- no content moved by copy-paste
- `project-mismatch` never fires in anger — its proof is a test, not an incident

The last one is a claim about an ABSENCE and is therefore only as strong as the traffic behind it: it
is satisfied by a dogfood that actually dispatched both waves, and by nothing else. Record the run ids
beside it when the programme closes.
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `cd server && ./node_modules/.bin/vitest run test/crossrepo-prose.test.ts`

Expected: PASS — 16 passed.

- [ ] **Step 6: Measure the mutation (row W3-4)**

1. Set wave 1's row back to `| — | not opened |` → re-run: FAIL, 1 test, `wave 1 names no PR — the row still reads a dash`. Restore.
2. Delete the `no content moved by copy-paste` bullet → re-run: FAIL, 1 test, `the ledger's exit criteria drop a clause of the spec's list: "no content moved by copy-paste"`. Restore.
3. Re-run: 16 passed.

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

Anchor quotes, verified by reading the files in this session.

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

Expected: FAIL — 16 passed (Tasks 1–4), 2 failed, both on `the ledger measurement block: the opening anchor is gone`.

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

- [ ] **Step 6: Run the test to verify it passes**

Run: `cd server && ./node_modules/.bin/vitest run test/crossrepo-prose.test.ts`

Expected: PASS — 18 passed.

- [ ] **Step 7: Measure the mutation (row W3-5)**

1. Delete the `## Measurements` block → re-run: FAIL, 2 tests, `the ledger measurement block: the opening anchor is gone`. Restore.
2. Delete the `opens_7d = <n>` sentence → re-run: FAIL, 1 test, `the measurement records no run-open count — the zero above means nothing without it`. Restore.
3. Re-run: 18 passed.

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

(`<short sha>` = `git rev-parse --short HEAD` taken AFTER this commit.) Task 7 Step 6 restates this once more as the wave's actual closing edit and is what the coordinator's post-merge edit builds on — this value is provisional, not a promise about `main`.

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
- Consumes: every task above; the orchestrator's minted numbers for this plan's `## Deviations found` section.
- Produces: the measured evidence this wave is mergeable, the ledger's closing state, and the deploy instruction (or the statement that there is nothing to deploy).

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

Expected: PASS. `topology-clean` walks every tracked file, docs included, and reds on an operator host, address, tailnet or account residue — a red naming a README, ledger or plan line means a real name was typed where a placeholder belonged. `dtbd` reds while any concrete `D-TBD-<slug>` from this plan's `## Deviations found` is still unsubstituted; that substitution is the orchestrator's act and must happen before the PR is opened, not after.

- [ ] **Step 3: The cross-branch ledger check**

```bash
git fetch origin main
cd server && ./node_modules/.bin/vitest run test/deviation-refs.test.ts
```

Expected: PASS. It compares this branch's plan entries against `origin/main`'s WITHOUT merging and reds on an allocator-era number defined in two plans — the parallel-branch collision, caught before the merge that would otherwise decide it. Run it after the numbers are substituted, and again before the merge.

- [ ] **Step 4: Type-check**

```bash
cd server && npm run build
cd agent && npm run build
cd pwa && npm run build
```

Expected: each exits 0. `build` IS the type-check here — no package in this tree declares a `typecheck` script (`server`/`agent` run bare `tsc`, `pwa` runs `tsc --noEmit && vite build`). The one thing it misses is `server/test/**`, which `server/tsconfig.json` deliberately excludes and which `server/test/typecheck-tests.test.ts` covers by spawning its own `tsc` inside Step 1 — so this wave's two new suites are type-checked by Step 1, not by this step. Emitted `dist/` trees are gitignored and leave no diff.

- [ ] **Step 5: The prose suites, one more time, whole**

```bash
cd server && ./node_modules/.bin/vitest run test/crossrepo-prose.test.ts test/readme-holds.test.ts test/box-token-census.test.ts test/oss-metadata.test.ts test/worker-skill.test.ts test/coordinator-skill.test.ts test/license.test.ts test/ccrc-install-graphify.test.ts test/ccrc-update.test.ts
```

Expected: PASS — every suite in the tree that reads `README.md`, `CLAUDE.md` or a skill corpus, green together. `coordinator-skill` and `worker-skill` are in this list although this wave edits neither: they read README and `CLAUDE.md` too, and a wave that added prose without touching a skill is exactly the shape that breaks them by accident.

- [ ] **Step 6: Close the ledger's wave-3 row and hand the programme forward**

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

- [ ] **Step 7: The deploy — what this wave actually ships**

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

- [ ] **Step 8: Commit**

```bash
git add docs/superpowers/programs/crossrepo-programmes.md
git commit -m "docs(ledger): wave 3 closed, and the programme handed to its dogfood"
```

---

## Deviations found

**Five, all found while planning, all still `D-TBD`.** The orchestrator mints them in ONE allocator call (`POST /api/ledger/deviations`, project `ccrc-pwa`) and substitutes the numbers into this section, into the `LEDGER:` lines of Tasks 1, 5 and 6, into Task 7's reference to the header note, and into the two comments inside `server/test/crossrepo-prose.test.ts` (Task 1 Step 1's caps-paragraph comment and Task 5 Step 2's both-numbers comment) **before this branch's PR is opened** — `server/test/dtbd.test.ts` reds on any concrete placeholder that survives, including one left inside a test's own comment, so the substitution is mechanical rather than remembered. A number is allocated and DEFINED in the same act; none of these five is a reserve, and a deviation found during execution gets its own call at the moment it is found.

- **D-2066** (Task 5) — Spec §3 F2 dates the legacy flip on "`run_events` shows zero `legacy-home-project` events over seven consecutive days", phrased as though the programme's own machinery could answer it. Measured at `d0064e6e`: `run_events` is exposed by **no HTTP route**. The only mention in `server/src/coord/routes.ts` is a comment (`:1427`); `runEvents` appears nowhere in that file; the ten `app.get('/api…')` registrations serve mail, mail bodies, caps, runs, run items, the feed, lifecycle, peers, claims and the ledger, and none of them the run-event trail; `CoordStore.runEvents` (`store.ts:1580`) has no caller outside `server/test`. So the criterion is an **operator act** on the server box (`sqlite3 ~/.ccrc/coord.db`, two integers, no rows), and Task 5 says so in the ledger and pins the sentence to the absence that makes it true — the pin reds the day a route does serve the trail. Not fixed here: a route over `run_events` is a new read surface with its own gating decision (box token? session gate? both?), and inventing one inside a docs wave would be exactly the kind of unargued surface this repo's box-token census exists to prevent.
- **D-2067** (Task 5) — The same criterion is satisfied by seven days in which nothing happened: a box that opened no runs reports zero `legacy-home-project` events, indistinguishably from a box on which every coordinator now sends `homeProject`. An absence is only evidence in proportion to the traffic behind it. Task 5 therefore measures a second number in the same window — runs opened (`runs.openedAt`) — and this wave's gate is `legacy_7d = 0` **and** `opens_7d > 0`. Recorded rather than silently applied, because it changes what the spec's own sentence means: the spec states a numerator and this wave supplies the denominator. The ledger's `## Measurements` block carries both numbers and the date, so a later reader can judge the window rather than inherit a verdict.
- **D-2068** (Task 1) — Spec §5 states the crossing's cost beside the caps rules ("two live workspaces, two concurrency slots and two of the daily budget"), and README's `**Caps and pause.**` paragraph is where an operator reads those rules — but `server/test/box-token-census.test.ts:352-354` pins that exact passage (`'**Caps and pause.**'` → `'Pause is a'`) to contain **no number word at all** (`numeralsIn(p)` `toEqual([])`, D-1216's fix for hand-kept door counts), and the sentence's entire content is the word "two". The sentence therefore lives in the new cross-repo subsection, and Task 1's suite pins BOTH halves: the subsection must state the cost, and the caps paragraph must not acquire it. Without that second half the sentence would drift back into the caps paragraph on some later edit and red a census test whose message is about door counts, leaving the next editor with a failure that does not explain itself.
- **D-2069** (Task 7, and the header's agent-first note) — Spec §9's wave-3 bullet lists "the coordinator references" in this wave's scope, which would make wave 3 an AGENT-FIRST deploy. Spec §3 F3's own bullet contradicts it and is right: the refusal-list sentence and its `wave-lifecycle.md` explanations belong to **wave 1** (because `server/test/coordinator-skill.test.ts:296-345` requires every `RunRefuseCode` to be named in the skill corpus and explained in `wave-lifecycle.md` the moment the code exists — a wave 1 that declared the codes without naming them would ship red), and the behavioural clauses belong to **wave 2**. Measured for this wave: nothing under `ccd/` is touched, so the agent lane does not run and the deploy is server-only (or nothing at all, if the flip defers). Recorded so that a reader following §9 rather than §3 F3 does not order a deploy this wave has no bytes for; Step 7 verifies the claim with `git diff --name-only` rather than trusting it.
- **D-2070** (Task 6) — Spec §3 F2 says the flip to required is "shipped as its own PR", and this plan's own cross-wave contract repeats it verbatim ("`HOME_PROJECT_LEGACY_ACCEPTED → false`, its own PR"). Task 6 cannot make that binding: a worker commits only on its own workspace branch and opens no second one (house rule, not a per-task choice), and this ledger's own execution-shape paragraph (`docs/superpowers/programs/crossrepo-programmes.md:15-19`) has the WORKER, not the coordinator, push the branch and open the PR — so by the time a PR exists, the flip commit is already inside it, riding beside every docs commit in this wave, unless a human moves it afterward. Task 6 Step 10 states what this worker does about it: name the flip commit as a distinct handoff item, separate from the rest of the wave's report. What happens next — cherry-pick onto its own branch for its own server-lane PR after the docs PR merges, or accept the operator waiving spec §3 F2's separation for this one wave — is the coordinator's decision, made and recorded in the ledger's `## Decisions & deviations` at the time, not assumed by this plan.

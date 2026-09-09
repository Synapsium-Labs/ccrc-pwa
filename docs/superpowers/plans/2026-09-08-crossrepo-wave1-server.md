# Cross-repo programmes — wave 1: the server refuses a crossing it cannot prove, the programme knows its home, and mail finds its role — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the four single-project seams a cross-repo programme runs into, on the server side only: two typed refusals (`project-mismatch` at open and at dispatch resume, `home-mismatch` at open) so a wave that changes repo is caught by a mechanism instead of by a `tip-unmeasurable` one advance later; one forward-only migration that gives the programme row a `homeProject` and the feed row a `runId`; the `worker` role at `POST /api/mail`, with a single funnel (`bindSession`) that hands a replacement occupant its predecessor's undelivered mail; and the two programme filters (`GET /api/mail?program=`, `GET /api/feed?program=`) with the `ccrc-api` rows that reach them. The skill learns the two refusal codes here — not in wave 2 — because `coordinator-skill.test.ts` demands every `RunRefuseCode` be named in the corpus the moment it exists.

**Architecture:** Additive throughout, and every decision sits one ring below the route that answers it. L0 `shared/api.ts` gains two `RunRefuseCode` members (union plus `RUN_REFUSE_CODE_MAP`, so a missing member is a compile error), `RunSummary.homeProject: string | null` and `NotifyEvent.runId: number | null` with `reviveNotifyEvent` as the single tolerant reader. L3 `server/src/coord/store.ts` gains three reads (`sessionProject`, `programHome`, `resolveWorker`), two writes (`setProgramHome`, `bindSession` — the ONE writer of `runs.sessionId`, which `setSession` and `markDispatched` now delegate to) and two programme-scoped listings (`mailForProgram`, `feedEventsForProgram`); D-1425's heir act is generalised by role into `requeueAbandonedMail`. L4 `coord/routes.ts` and L1 `coord/dispatch.ts` translate those into 409s. One `MIGRATIONS` entry, two nullable columns, `COORD_SCHEMA_VERSION` 8 → 9. `FLEET_PROTO` stays 1.

**Tech Stack:** TypeScript (strict, NodeNext) in `shared/`, `server/src`; `node:sqlite` `DatabaseSync` for the coordination store; bash 5.2 for `ccd/ccrc-api`; markdown for the coordinator skill corpus; vitest for every suite; node >= 22.13.0.

**Spec:** `docs/superpowers/specs/2026-09-08-crossrepo-programmes-design.md`

**Base:** `origin/main` `d0064e6e`; branch `ws/<this workspace>` — the workspace branch the coordinator's dispatch minted for this wave. Every commit below lands on it and on no other branch: a worker commits on its workspace branch, never a separate feature branch, or every close wedges with `stale-tip`.

**AGENT-FIRST.** This wave touches `ccd/coordinator-skill/` (Tasks 1, 2 and 4 edit `SKILL.md` and `references/wave-lifecycle.md`) and `ccd/ccrc-api` (Task 8), so it ships to the fleet host BEFORE the server: `bash deploy/deploy.sh agent <fleet-host>` then `bash deploy/deploy.sh`. Task 9 names both commands. Nothing in this plan runs a deploy. Two orderings are in force and they are different scopes: WITHIN this wave the agent lane goes first, as every `ccd/` change does; ACROSS waves, this wave must be deployed and live before wave 2 ships, so the `project-mismatch` guard exists before the skill starts telling coordinators to cross repos (spec §8, §9).

---

## Global Constraints

Copied from the spec and from `CLAUDE.md`. Every task's requirements implicitly include this section.

- **Fixture HOMEs only.** No test may run against the live `$HOME`. `mkTmp` (`server/test/tmpHelpers.ts`) is how a home is made; `makeCcdHarness(prefix)` (`server/test/ccdWsHelpers.ts`) is how a `ccd`-facing one is. Never run any `ccd` verb against the live `$HOME`; never touch tmux, `~/.cc-sessions`, `~/.cc-limits`, or a `claude-session@*` unit. Never run `ws-rm`, `ws-reap`, `ws-gc --prune`, `ws-archive` or `ws-restore` against the live host.
- **No real host name, IP, tailnet name, duckdns name, account label or operator project anywhere** — source, test, or this document. Fixture projects are `demo` and `other-project`; fixture programmes are `build4` and `build5`; fixture session ids are `demo-quiet-mesa`, `demo-existing`, `demo-ghost`, `demo-nobody`, `demo-never-run`, `demo-worker`, `demo-heir`, `demo-coordinator`, `other-project-worker`, `ccrc-pwa-coordinator`, `ccrc-pwa-coordinator-two`, `other-project-coordinator`. `server/test/topology-clean.test.ts` and `server/test/single-definition.test.ts` scan the whole tracked tree, documents included, and the pre-push hook refuses on the same classes.
- **`FLEET_PROTO` stays 1; the wire is additive-only.** A new field never bumps the protocol. `RunSummary.homeProject` and `NotifyEvent.runId` are additive, each with a SINGLE tolerant reader — `reviveNotifyEvent` (`shared/api.ts`) for the event; `hydrateRun`'s literal for the run, which is a compile error until every path computes it.
- **No overloaded null at a seam.** Two conditions a caller handles differently must not collapse to one value. `homeProject` NULL means "no home was ever stored", never "the home is the run's own project". `NotifyEvent.runId` null means "this event is about no run", never "the run could not be read". `record === undefined` at the dispatch resume arm means "no registry row on a LISTABLE registry", never "the registry could not be listed" — that stays `registry-unmeasurable`.
- **Single-source-of-truth values are enumerated once and derived.** `RUN_REFUSE_CODES = Object.keys(RUN_REFUSE_CODE_MAP)`; `COORD_SCHEMA_VERSION = MIGRATIONS.length`; the deliberate-cancel SQL list is BUILT by interpolation from its named constants, never hand-typed. `server/test/single-definition.test.ts` text-scans four roots and fails the build on a second copy.
- **Mutation-table discipline.** Every guard ships WITH a test that goes RED when the guard is deleted or mutated, measured before and after — not asserted in a comment. TDD, red first. Each task below names the exact mutation and the expected red.
- **Deviation numbers come only from the allocator.** This plan MINTS NOTHING. Every deviation found while planning is recorded in `## Deviations found` as `D-TBD-<slug>` with a full entry, and the orchestrator mints the number. A deviation found during execution is written the same way and reported (worker clause 11) — never taken from a gap in someone else's block, and never guessed from a `GET /api/ledger` floor.
- **`EXEC_COMMANDS = ['tmux','ccd']` stays closed. No `gh` grant, ever.** This wave adds no exec surface at all: every coordination mutation rides an already-granted `CcdArgv`, and this wave adds none.
- **L0 imports nothing.** `shared/*.ts` imports nothing at all, not even `node:*` — the PWA bundles those files.
- **Zero new `ccd` verbs, and `coord.db` stays SYNCHRONOUS.** `CoordStore` is `DatabaseSync` throughout; `bindSession` and `requeueAbandonedMail` are plain methods with no `tx()` of their own, because `DatabaseSync` transactions do not nest and both are reached from inside `commitDispatch`'s and `reclaimProgram`'s existing transactions.
- **Node floor `>=22.13.0`,** identical across the three engines, pinned by `server/test/node-floor.test.ts`. If its absolute assertion reds while the others are green, RAISE engines — never lower them.
- **Run a suite in the FOREGROUND, timeout >= 600000 ms**, from inside its package: `cd server && ./node_modules/.bin/vitest run test/<file>.test.ts` (or `/pwa`, `/agent`). NEVER bare `npx vitest` — it resolves a global copy with no jsdom and falsely reports "no tests".
- **Known load flakes** — re-run IN ISOLATION before calling a real break: `ccd-ws-gc`, `pr-sweep`, `session-hook`, `typecheck-tests`, `ccd-session-state`. CI on the quiet box is the arbiter; a flake CI passes is a flake.
- **`test/dtbd.test.ts` is known-red BY DESIGN, not a flake.** It `git grep`s every tracked file for a concrete `D-TBD-<slug>` placeholder and fails the diff on purpose — that is the mechanism (build 9 D13) that stops an invented number landing when the allocator is unreachable. It stays red for as long as this plan's own `## Deviations found` section carries one, and goes green only once the orchestrator has minted a contiguous block and every entry below is rewritten as `D-<n>` in the same act (Task 9 Step 4). Never re-run it "in isolation" expecting green, and never delete an entry to clear it.

---

## Wave map

| Wave | Plan file | Owns |
|---|---|---|
| **1 — this plan** | `docs/superpowers/plans/2026-09-08-crossrepo-wave1-server.md` | both refusal codes and both sites; the one migration; `homeProject` on the programme row and the wire; the `worker` role at send; `bindSession` and the heir re-issue; both programme filters; the `ccrc-api` rows; the two codes named in the coordinator skill and explained in `wave-lifecycle.md` |
| 2 — skills and PWA | spec §9 wave 2 | F3's behavioural clauses in both skills; F4's runs-screen badge and crossing marker, the fleet board's abroad line, the mail screen's programme grouping |
| 3 — docs and the flip | spec §9 wave 3 | README and the coordinator references; the `HOME_PROJECT_LEGACY_ACCEPTED` → `false` PR, gated on zero `legacy-home-project` run events over seven consecutive days |

**This wave CONSUMES nothing from an earlier wave of this programme** — it is the substrate. It DOES rebase over account-pools wave 3, which touches `server/src/coord/routes.ts` and `server/src/coord/store.ts` (spec §9). Rebase before Task 1 and re-read every anchor quote in this plan against the rebased tree: a stale line number is a plan defect, and the anchors below were read on `d0064e6e`.

**This wave PRODUCES, and waves 2 and 3 must import these exact names rather than re-spell them:**

| Name | Home | First consumer |
|---|---|---|
| `RunRefuseCode` members `'project-mismatch'`, `'home-mismatch'` | `shared/api.ts` | wave 2's skill prose (already named here); the coordinator's own refusal handling |
| `RunSummary.homeProject: string | null` | `shared/api.ts` | wave 2's `RunsScreen` crossing marker and `FleetScreen`'s abroad list |
| `NotifyEvent.runId: number | null` | `shared/api.ts` | wave 2's `MailScreen` programme grouping |
| `CoordStore.sessionProject(sessionId)` | `server/src/coord/store.ts` | this wave's open route; nothing later |
| `CoordStore.programHome(slug)` / `setProgramHome(slug, home)` | `server/src/coord/store.ts` | this wave's open route |
| `CoordStore.resolveWorker(runId)` | `server/src/coord/store.ts` | this wave's send route |
| `CoordStore.bindSession(runId, sessionId): { rebound: boolean; reissued: number }` | `server/src/coord/store.ts` | `setSession`, `markDispatched` — the only writers left |
| `CoordStore.mailForProgram(program, opts)` / `feedEventsForProgram(program, limit)` | `server/src/coord/store.ts` | `GET /api/mail?program=`, `GET /api/feed?program=` |
| `HOME_PROJECT_LEGACY_ACCEPTED`, `homeProjectVerdict`, `HomeProjectVerdict` | `server/src/coord/routes.ts` | wave 3's flip PR flips the constant and nothing else |
| `MAIL_REBIND_SUPERSEDED_ERROR` | `server/src/coord/store.ts` | `bindSession`'s park; `DELIBERATE_CANCEL_ERRORS_SQL` |
| `ccrc-api` rows `mail.list --program|--all|--limit` and `feed.list` | `ccd/ccrc-api` | wave 2's skill prose |

**Three facts a later wave needs and cannot see from its own diff:**

1. **`GET /api/feed` is UNGATED by the box token today** (`coord/routes.ts:1610-1615` registers it with no `requireMailToken` call) while `GET /api/mail` is gated. This wave adds a query key to each and changes neither gate. `server/test/box-token-census.test.ts` and `coord-pause-route.test.ts` therefore need no edit — no route is added, removed or re-gated.
2. **`nestFleet.ts` and its five rules do NOT change** in this programme, at any wave. The crossing marker wave 2 renders is computed in the card from the run it already has.
3. **The account roster is runtime data.** Nothing in this wave reads or writes an account list, and no shipped source file may enumerate one.

---

## File Structure

| File | Task | Responsibility after this wave |
|---|---|---|
| `shared/api.ts` | 1, 3, 4 | Declares `project-mismatch` and `home-mismatch` on `RunRefuseCode` + `RUN_REFUSE_CODE_MAP`; `NotifyEvent.runId` with `reviveNotifyEvent` as its one tolerant reader; `RunSummary.homeProject`. |
| `server/src/coord/schema.ts` | 3 | Holds the ONE new `MIGRATIONS` entry — `programs.homeProject`, `feed_events.runId` — and `COORD_SCHEMA_VERSION` derives to 9. |
| `server/src/coord/store.ts` | 1, 3, 4, 5, 6, 7 | Owns `sessionProject`, `programHome`, `setProgramHome`, `resolveWorker`, `bindSession` (the one writer of `runs.sessionId`), `requeueAbandonedMail`, `mailForProgram`, `feedEventsForProgram`, `MAIL_REBIND_SUPERSEDED_ERROR`; `openRun` writes `homeProject` on first insert; `hydrateRun` carries `homeProject`; the feed writes and reads `runId`. |
| `server/src/coord/routes.ts` | 1, 2, 4, 5, 7 | The open route's two refusals and the home decision (`HOME_PROJECT_LEGACY_ACCEPTED`, `homeProjectVerdict`), `ledgerRepo`/`ledgerAbsPath` on the response; `sendDispatchOutcome` passes `by` through; the send route admits the `worker` role; both programme filters. |
| `server/src/coord/dispatch.ts` | 2 | `DispatchOutcome`'s refused member gains `project-mismatch` and `by?: string`; the resume arm refuses a crossing before the hold, the `/clear` and `markDispatched`. |
| `server/src/watch.ts` | 3 | `pushOne` carries a `runId` into the ring and the durable feed; the mail, run and blocked-sender lanes each pass the one they already know. |
| `ccd/coordinator-skill/SKILL.md` | 1, 4 | Its refusal-list sentence names both new codes. |
| `ccd/coordinator-skill/references/wave-lifecycle.md` | 1, 2, 4 | §1's open table explains `project-mismatch` and `home-mismatch`; §2's dispatch table explains `project-mismatch` at resume. |
| `ccd/ccrc-api` | 8 | `mail.list` declares `to,program,all,limit`; a new `feed.list` row; both prose row counts say nineteen. |
| `server/test/run-routes.test.ts` | 1, 2, 4 | Pins both refusals at both sites, the home branches, and the response's two new fields. |
| `server/test/home-project.test.ts` | 4 | Drives `homeProjectVerdict` over all six verdicts and both legacy branches; carries the shipped-value assertion wave 3's flip changes. |
| `server/test/coord-store.test.ts` | 1, 3, 4, 5, 6, 7 | Pins `sessionProject`, the feed's `runId` round trip, `programHome`/`setProgramHome`, `resolveWorker`, `bindSession`'s heir re-issue and its one-writer scan, and both programme listings. |
| `server/test/coord-db.test.ts` | 3 | Pins migration 9 — a v-8 file boots with both columns readable, both nullable and defaultless, version derives to 9. |
| `server/test/mail-routes.test.ts` | 5 | Pins the `worker` role in both directions. |
| `server/test/reconstruction-drill.test.ts` | 4 | `RUN_SUMMARY_KEYS` admits `homeProject`; the count moves 21 → 22. |
| `server/test/single-definition.test.ts` | 6 | The re-queue's derived reader walk and the deliberate-cancel pin follow the rename and the third park sentence. |
| `server/test/ccrc-api.test.ts` | 8 | `ROWS` gains `feed list`; the count moves 18 → 19; the prose pin reads "nineteen". |
| `pwa/test/feed.test.ts`, `pwa/test/mail-screen.test.tsx`, `pwa/test/notifymark.test.ts` | 3 | Their typed `NotifyEvent` builders answer the new required field. |
| `pwa/test/{abandon-sheet,fleet-screen,nestFleet,pr-sheet,project-card,resume-sheet,runs-health,runs-screen,tap-targets}` | 4 | Their typed `RunSummary` builders answer `homeProject`. |

---

## What this wave deliberately does NOT change

Spec §2 measured seven seams that already read the RUN's own project and named them unchanged; spec §5 restates caps and safety as unchanged. Both are load-bearing here, because each is something a reasonable executor might "fix" while touching the files around it.

| seam | leave it exactly as it is |
|---|---|
| fresh spawn at dispatch — `CCD_ARGV.wsAddWorker(run.project, …)` (`server/src/coord/dispatch.ts:326`) | already spawns into the run's own project; a cross-repo wave opens WITHOUT `sessionId` and takes this path unchanged |
| done-fingerprint re-measure (`server/src/coord/fingerprint.ts:209`) and close re-measure (`server/src/coord/close.ts:240`) | already read `run.project` |
| the archive-after-merge sweep (`server/src/watch.ts:3075`, list derived at `:2920`, PR state read per project at `:2924`) | already per workspace |
| fleet board grouping (`pwa/src/screens/FleetScreen.tsx:491`) | wave 2's, not this one |
| caps (`server/src/coord/store.ts:1882`; `POST /api/coord/caps`, `routes.ts:1383-1469`) | GLOBAL by design, one row, whole box. A crossing costs two live workspaces, two concurrency slots and two of the daily budget, and that is stated in the skill (wave 2), never fixed with a per-programme cap |
| the hold reason (`server/src/coord/rundefs.ts:92-93`, `server/src/ccdargv.ts:297`) | names programme, wave and run id, never a project; display-only, never parsed back |
| `$REG/coordinator-paused` | global, and still stops everything |
| `nestFleet.ts` and its five rules | unchanged in every wave of this programme |
| `EXEC_COMMANDS`, the exec whitelist, `gh` | untouched; this wave adds no exec surface at all |
| `FLEET_PROTO` / `FLEET_PROTO_MIN` | stay 1 |

**And two things that belong to wave 2, not here.** Spec §7's rows "runs-screen badge and marker" and "home-card abroad line" live in `pwa/test` and are wave 2's; so are §3 F3's BEHAVIOURAL clauses in both skills (reuse `sessionId` only within one project, a crossing opens without one, `homeProject` on every open, the brief's absolute path at a sha with the contract inlined, Q1's producer-must-be-done discipline, deviations minted against the HOME project, worker-role addressing with `runId` always, the two-slots consequence) and the whole of `ccd/worker-skill/`. This wave touches the coordinator skill for ONE reason and only that reason: `server/test/coordinator-skill.test.ts:313-345` requires every `RunRefuseCode` to be named in the corpus the moment it exists, and `:296-311` requires every code the refusal sentence names to be explained in `references/wave-lifecycle.md`. Adding a behavioural clause here would ship a skill telling coordinators to cross repos before wave 2's PWA can show them what happened.

---

### Task 1: `project-mismatch` at open — the session-reuse path learns which repo it is reusing

**Files:**
- Modify: `shared/api.ts` — the `RunRefuseCode` docstring's count (`:3766`–`:3767`), the union (`:3787`–`:3790`), `RUN_REFUSE_CODE_MAP` (`:3792`–`:3797`)
- Modify: `server/src/coord/store.ts` — new `sessionProject`, immediately after `openRun` ends (`:576`)
- Modify: `server/src/coord/routes.ts` — the open route, between `const waveOfVal = …` (`:946`) and `const opened = coord.openRun(…)` (`:953`)
- Modify: `ccd/coordinator-skill/SKILL.md` — the refusal-list sentence (`:167`–`:173`)
- Modify: `ccd/coordinator-skill/references/wave-lifecycle.md` — §1 "Open the run" (`:12`–`:38`)
- Test: `server/test/run-routes.test.ts` — the `describe('POST /api/runs')` block, after "refuses a second coordinator rather than arbitrating" (`:182`–`:192`)
- Test: `server/test/coord-store.test.ts` — a `sessionProject` case

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `RunRefuseCode` gains the member `'project-mismatch'`, and `RUN_REFUSE_CODE_MAP` the matching key — the map is what makes a missing member a compile error, so both change together.
  - `CoordStore.sessionProject(sessionId: string): string | null` — the project of the FIRST run that ever named this session; `null` = no run ever named it.
  - `POST /api/runs` answers `409 {ok:false, refused:'project-mismatch', by:'<the project the session belongs to>'}` when the body names a `sessionId` bound to a different project.

**Spec:** §3 F1 (the open site, the code, the null-permits rule), §3 F3 (the refusal-list sentence and the `wave-lifecycle.md` row — wave 1's half, because `coordinator-skill.test.ts` demands the code be named the moment it exists), §7 rows 1 and "skill pins", §9 wave 1.

**Mutation table:** row 1 — "`project-mismatch` at open" (spec §7), red when the `sessionProject` check is deleted, when the `bound !== null` guard is deleted (absence stops permitting), or when the refusal shape or status changes. Measured in Step 6, both directions.

**Why the two codes do NOT land together.** `server/test/mail-routes.test.ts:421-431` runs a FORWARD scan — `for (const code of RUN_REFUSE_CODES) expect(src, code).toContain(`'${code}'`)` over every `.ts` under `server/src/coord`. A code declared with no emitter reds that scan. `home-mismatch`'s first emitter is Task 4's open-route check, which needs the migration (Task 3) and `programHome` under it, so declaring it here would leave three tasks red in a row. This task therefore declares and emits `project-mismatch` alone, and Task 4 declares and emits `home-mismatch` in its own commit. Recorded as **D-2054**.

Anchor quotes, read on `d0064e6e`. `shared/api.ts:3765`–`:3767`:

```ts
 * tokens) — `paused`, a member of this very union, is invisible to it.
 * Thirteen codes exist below today; the next new one would be the
 * fourteenth, not the ninth.
```

`shared/api.ts:3787`–`:3798`:

```ts
export type RunRefuseCode =
  | 'claimed-by-another' | 'paused' | 'mail-disabled' | 'cap-concurrency' | 'cap-daily'
  | 'ambiguous-dispatch' | 'worker-busy' | 'hookstate-unmeasurable' | 'not-dispatched'
  | 'prhistory-unreadable' | 'bad-transition' | 'unknown-item' | 'item-terminal';

const RUN_REFUSE_CODE_MAP: Record<RunRefuseCode, true> = {
  'claimed-by-another': true, paused: true, 'mail-disabled': true, 'cap-concurrency': true,
  'cap-daily': true, 'ambiguous-dispatch': true, 'worker-busy': true,
  'hookstate-unmeasurable': true, 'not-dispatched': true,
  'prhistory-unreadable': true, 'bad-transition': true, 'unknown-item': true, 'item-terminal': true,
};
export const RUN_REFUSE_CODES: readonly RunRefuseCode[] = Object.keys(RUN_REFUSE_CODE_MAP) as RunRefuseCode[];
```

`server/src/coord/store.ts:570`–`:576` (the tail of `openRun`, which the new method follows):

```ts
      const res = this.db.prepare(
        'INSERT INTO runs (program, wave, waveOf, project, state, claimedBy, openedAt) ' +
        'VALUES (?, ?, ?, ?, ?, ?, ?)',
      ).run(input.program, input.wave, input.waveOf, input.project, 'planned', input.claimedBy, now);
      return { id: Number(res.lastInsertRowid), program: input.program, state: 'planned' as const };
    });
  }
```

`server/src/coord/routes.ts:946`–`:956`:

```ts
    const waveOfVal = (waveOf ?? null) as number | null;

    // `openRun` refuses a second coordinator (spec:291-292) rather than
    // arbitrating — the run is NOT opened, nothing else below runs. It is
    // also now IDEMPOTENT for a retry naming the same (program, wave,
    // claimedBy) against an existing `planned` row (fix, review findings
    // 19/32) — see its own docstring.
    const opened = coord.openRun({ program, title, project, wave, waveOf: waveOfVal, claimedBy });
    if ('refused' in opened) {
      return reply.code(409).send({ ok: false, refused: opened.refused, by: opened.by });
    }
```

`ccd/coordinator-skill/SKILL.md:167`–`:173`:

```markdown
response said. The refusals you will actually meet are
`paused`, `mail-disabled`, `cap-concurrency`, `cap-daily`, `ambiguous-dispatch`,
`worker-busy`, `hookstate-unmeasurable`, `claimed-by-another`,
`not-dispatched`, `prhistory-unreadable`, `bad-transition`, `stale-tip`,
`pr-regressed`, `no-handoff-commit`, `unknown-run`, `registry-unmeasurable`,
`unknown-item`, `item-terminal`. Their meanings are in
`references/wave-lifecycle.md`.
```

`ccd/coordinator-skill/references/wave-lifecycle.md:18`–`:22`:

```markdown
2. `POST /api/runs`
   `{"program":"<slug>","title":"<title>","project":"<project>","wave":1,"waveOf":<M or null>,"claimedBy":"<your session id>"}`
   → `{"ok":true,"id":<run id>,…}`, or
   `{"ok":false,"refused":"claimed-by-another","by":"<other coordinator id>"}`
   if another coordinator holds this program (clause 8 — stop).
```

- [ ] **Step 1: Write the failing store test**

In `server/test/coord-store.test.ts`, add this `describe` at the foot of the file:

```ts
describe('sessionProject — which repo a reused session belongs to', () => {
  it('answers the project of the FIRST run that ever named the session, and null for one no run has', () => {
    const s = new CoordStore(openCoordDb(path.join(mkTmp('ccrc-coord-'), '.ccrc', 'coord.db')));
    const a = s.openRun({ program: 'build4', title: 'T', project: 'demo',
      wave: 1, waveOf: 2, claimedBy: 'ccrc-pwa-coordinator' });
    if ('refused' in a) throw new Error('open refused');
    s.setSession(a.id, 'demo-existing');
    expect(s.sessionProject('demo-existing')).toBe('demo');
    // ORDER BY id LIMIT 1 and not "the newest": the question is which repo the
    // WORKSPACE was created in, and that is a fact about the session's first
    // run. A later row naming the same session cannot re-home a worktree.
    const b = s.openRun({ program: 'build5', title: 'U', project: 'other-project',
      wave: 1, waveOf: 1, claimedBy: 'ccrc-pwa-coordinator-two' });
    if ('refused' in b) throw new Error('open refused');
    s.setSession(b.id, 'demo-existing');
    expect(s.sessionProject('demo-existing')).toBe('demo');
    // ABSENCE PERMITS, and it is a real answer rather than a failure: every
    // wave-1 open that adopts an operator-made workspace lands here.
    expect(s.sessionProject('demo-never-run')).toBeNull();
  });
});
```

(`CoordStore`, `openCoordDb`, `path`, `mkTmp`, `describe`/`it`/`expect` are already imported at the head of that file.)

- [ ] **Step 2: Write the failing route tests**

In `server/test/run-routes.test.ts`, inside `describe('POST /api/runs')`, immediately after the "refuses a second coordinator rather than arbitrating" case (ends `:192`):

```ts
  it('refuses a reused sessionId bound to another project — before anything is opened', async () => {
    // F1. The coordinator's own idiom ("same sessionId, same workspace") caught
    // by the coordinator's own history: wave 1 in `demo` is the only record that
    // this workspace lives in `demo`, and until this check nothing read it.
    const home = mkTmp('ccrc-runs-');
    seed(home, 'demo-existing');
    const { run, calls } = makeRunner(home);
    const w = await openApp(home, run); app = w.app;
    const first = await postOpen(app, { ...OPEN_BODY, sessionId: 'demo-existing' });
    expect(first.statusCode).toBe(200);
    const runsBefore = w.coord.runs().length;
    const holdsBefore = calls.filter((c) => c[0] === 'ws-hold').length;

    const res = await postOpen(app, { ...OPEN_BODY, program: 'build5', title: 'Another repo',
      project: 'other-project', wave: 1, waveOf: 1, claimedBy: 'ccrc-pwa-coordinator-two',
      sessionId: 'demo-existing' });
    expect(res.statusCode).toBe(409);
    expect(res.json()).toEqual({ ok: false, refused: 'project-mismatch', by: PROJECT });
    // BEFORE `coord.openRun`, so a refusal leaves no `planned` orphan…
    expect(w.coord.runs().length, 'a refused open left a planned orphan behind').toBe(runsBefore);
    // …and no hold was placed on a workspace this run was never going to get.
    expect(calls.filter((c) => c[0] === 'ws-hold')).toHaveLength(holdsBefore);
  });

  it('permits a reused sessionId that stays in the same project', async () => {
    const home = mkTmp('ccrc-runs-');
    seed(home, 'demo-existing');
    const { run } = makeRunner(home);
    const w = await openApp(home, run); app = w.app;
    expect((await postOpen(app, { ...OPEN_BODY, sessionId: 'demo-existing' })).statusCode).toBe(200);
    const res = await postOpen(app, { ...OPEN_BODY, wave: 2, sessionId: 'demo-existing' });
    expect(res.statusCode).toBe(200);
  });

  it('refuses nothing for a session no run has ever named — absence permits', async () => {
    // The wave-1 open that adopts an operator-made workspace. `sessionProject`
    // answers null, and a null answer is not evidence of a crossing; the
    // registry backstop at dispatch (Task 2) is the other rung.
    const home = mkTmp('ccrc-runs-');
    seed(home, 'demo-existing');
    const { run } = makeRunner(home);
    const w = await openApp(home, run); app = w.app;
    const res = await postOpen(app, { ...OPEN_BODY, project: 'other-project',
      sessionId: 'demo-existing' });
    expect(res.statusCode).toBe(200);
  });
```

- [ ] **Step 3: Run both suites to verify they fail**

Run: `cd server && ./node_modules/.bin/vitest run test/coord-store.test.ts test/run-routes.test.ts`

Expected: FAIL.
- `coord-store.test.ts` fails to type-check at runtime with `TypeError: s.sessionProject is not a function`.
- `run-routes.test.ts` — "refuses a reused sessionId bound to another project" fails with `expected 200 to be 409`, and the two permissive cases PASS (they are the anti-vacuity half: a check that refused everything would red them).

- [ ] **Step 4: Declare the code**

In `shared/api.ts`, correct the count at `:3766`–`:3767` and extend the docstring, then the union and the map:

```ts
 * tokens) — `paused`, a member of this very union, is invisible to it.
 * Fourteen codes exist below today; the next new one would be the
 * fifteenth, not the ninth.
 *
 * `project-mismatch` is cross-repo programmes' first guard (design
 * 2026-09-08 §3 F1). A programme's waves may run in any project, but a
 * SESSION's workspace is a git worktree in exactly one repository, and until
 * this code existed the "same `sessionId`, same workspace" idiom crossed
 * repos with nothing to stop it — the mismatch surfaced one advance later as
 * a `tip-unmeasurable` naming a branch and a project the coordinator did not
 * expect. It is emitted at TWO sites for the same fact measured two ways:
 * `POST /api/runs` reads this store's own history (`sessionProject`), and
 * `POST /api/runs/:id/dispatch`'s resume arm reads the live registry record.
 * Its body carries `by`, the project the session actually belongs to, so the
 * coordinator's report names the repo rather than the surprise.
```

```ts
export type RunRefuseCode =
  | 'claimed-by-another' | 'paused' | 'mail-disabled' | 'cap-concurrency' | 'cap-daily'
  | 'ambiguous-dispatch' | 'worker-busy' | 'hookstate-unmeasurable' | 'not-dispatched'
  | 'prhistory-unreadable' | 'bad-transition' | 'unknown-item' | 'item-terminal'
  | 'project-mismatch';

const RUN_REFUSE_CODE_MAP: Record<RunRefuseCode, true> = {
  'claimed-by-another': true, paused: true, 'mail-disabled': true, 'cap-concurrency': true,
  'cap-daily': true, 'ambiguous-dispatch': true, 'worker-busy': true,
  'hookstate-unmeasurable': true, 'not-dispatched': true,
  'prhistory-unreadable': true, 'bad-transition': true, 'unknown-item': true, 'item-terminal': true,
  'project-mismatch': true,
};
```

- [ ] **Step 5: Add the store read and the route check**

In `server/src/coord/store.ts`, immediately after `openRun`'s closing brace (`:576`) and before `reclaimProgram`'s docstring:

```ts
  /**
   * WHICH PROJECT A REUSED SESSION BELONGS TO, measured from this store's own
   * history: the project of the FIRST run that ever named it.
   *
   * `ORDER BY id LIMIT 1` and not "the newest row", deliberately. The question
   * is which repository this session's WORKSPACE is a worktree of, and a ccd
   * workspace is created once, in one project, by the `ws-add` that minted it
   * (`dispatch.ts`'s `CCD_ARGV.wsAddWorker(run.project, …)`). No later run can
   * re-home it — the whitelisted verbs cannot re-point a workspace and will not
   * learn to (design §6) — so the earliest claim is the true one and a later
   * disagreeing row is the very defect the caller refuses.
   *
   * NULL IS AN ANSWER, NOT A FAILURE, and the caller must treat it as one: a
   * session no run has ever named is every wave-1 open that adopts an
   * operator-made workspace. Absence permits. There is no third condition here
   * to collapse — this is one indexed read of one local table
   * (`runs_by_session`, migration 2), never an I/O that can fail halfway; the
   * registry-backed rung that CAN fail lives at the dispatch resume arm and
   * answers `registry-unmeasurable` in its own words.
   */
  sessionProject(sessionId: string): string | null {
    const row = this.db.prepare(
      'SELECT project FROM runs WHERE sessionId = ? ORDER BY id LIMIT 1',
    ).get(sessionId) as { project: string } | undefined;
    return row?.project ?? null;
  }
```

In `server/src/coord/routes.ts`, between `const waveOfVal = …` (`:946`) and the `openRun` comment block (`:948`):

```ts
    // F1 (design 2026-09-08 §3 F1) — a session's workspace is a worktree in ONE
    // repository, and reusing it for a wave in another is the one crossing this
    // build refuses. Measured from this store's own history, no I/O at all.
    //
    // HERE, AND NOT INSIDE `openRun`: the refusal must leave no `planned`
    // orphan, so it runs after body validation and BEFORE the row exists. A
    // null answer refuses nothing — absence permits, and `sessionProject`'s own
    // docstring says which population that is.
    if (typeof sessionId === 'string') {
      const bound = coord.sessionProject(sessionId);
      if (bound !== null && bound !== project) {
        return reply.code(409).send({ ok: false, refused: 'project-mismatch', by: bound });
      }
    }
```

- [ ] **Step 6: Run the suites green, then measure the guard**

Run: `cd server && ./node_modules/.bin/vitest run test/coord-store.test.ts test/run-routes.test.ts`

Expected: PASS, every case in both files.

Now measure mutation row 1, both halves.

Temporarily delete the whole `if (typeof sessionId === 'string') { … }` block just added and run:

Run: `cd server && ./node_modules/.bin/vitest run test/run-routes.test.ts`
Expected: FAIL — 1 case, "refuses a reused sessionId bound to another project", `expected 200 to be 409`. Restore it.

Then change the condition to `if (bound !== project)` (dropping the `bound !== null` guard) and re-run:
Expected: FAIL — 1 case, "refuses nothing for a session no run has ever named — absence permits", `expected 409 to be 200`. This is the half that would otherwise ship silently: without its own case, the guard could refuse every wave-1 adoption on the box and no suite would say so. Restore the condition.

- [ ] **Step 7: Name the code in the skill, and explain it**

In `ccd/coordinator-skill/SKILL.md`, the refusal-list sentence (`:167`–`:173`) becomes:

```markdown
response said. The refusals you will actually meet are
`paused`, `mail-disabled`, `cap-concurrency`, `cap-daily`, `ambiguous-dispatch`,
`worker-busy`, `hookstate-unmeasurable`, `claimed-by-another`,
`project-mismatch`,
`not-dispatched`, `prhistory-unreadable`, `bad-transition`, `stale-tip`,
`pr-regressed`, `no-handoff-commit`, `unknown-run`, `registry-unmeasurable`,
`unknown-item`, `item-terminal`. Their meanings are in
`references/wave-lifecycle.md`.
```

In `ccd/coordinator-skill/references/wave-lifecycle.md`, replace step 2 of §1 (`:18`–`:22`) with the same step plus a refusal table:

```markdown
2. `POST /api/runs`
   `{"program":"<slug>","title":"<title>","project":"<project>","wave":1,"waveOf":<M or null>,"claimedBy":"<your session id>"}`
   → `{"ok":true,"id":<run id>,…}`, or one of the refusals below.

| refused | what it means | what you do |
|---|---|---|
| `claimed-by-another` | another coordinator holds this program; `by` names it | stop (clause 8) |
| `project-mismatch` | the `sessionId` you passed belongs to a workspace in ANOTHER project; `by` names that project | do not retry with the same id. A wave that changes project opens WITHOUT `sessionId` and spawns fresh in the target repo. Nothing was opened and nothing was held |
```

And add, immediately under that table:

```markdown
**Why `project-mismatch` exists.** A session's workspace is a git worktree in
exactly one repository. Reusing its id for a wave in another project queues the
brief onto a workspace bound to the wrong repo, and the mismatch used to surface
one advance later as a `tip-unmeasurable` naming a branch you did not expect.
The server measures it two ways — here, from the run history, and again at
dispatch from the live registry row (§2) — and refuses both times. A session no
run has ever named refuses nothing: absence permits, which is exactly the
wave-1 open that adopts a workspace the operator made by hand.
```

- [ ] **Step 8: Run the skill and refusal-table suites**

Run: `cd server && ./node_modules/.bin/vitest run test/coordinator-skill.test.ts test/mail-routes.test.ts test/resume-reclaim-l0.test.ts`

Expected: PASS, all three. None of them was edited and none needed to be — every assertion in them is DERIVED from `RUN_REFUSE_CODES`, so they extend themselves and this run is the proof:
- `mail-routes.test.ts:421-431` — the forward scan now finds `'project-mismatch'` in `server/src/coord/routes.ts`; the reverse kebab scan accepts it through `isRunRefuseCode`.
- `coordinator-skill.test.ts:296-311` — the harvested sentence names it and `wave-lifecycle.md` explains it; `:313-345` — the corpus census finds it.
- `resume-reclaim-l0.test.ts:95-103` — `RECLAIM_REFUSE_CODES` still shares no member with `RUN_REFUSE_CODES`.

To prove that run is not vacuous, temporarily remove `` `project-mismatch`, `` from the SKILL.md sentence and re-run `coordinator-skill.test.ts`:
Expected: FAIL — "project-mismatch is a real RunRefuseCode but is named nowhere in the skill". Restore it.

- [ ] **Step 9: Typecheck and commit**

Run: `cd server && ./node_modules/.bin/vitest run test/typecheck-tests.test.ts`
Expected: PASS. (Known load flake — if it reds on a timeout rather than a `TS` code, re-run it alone before treating it as a break.)

```bash
git add shared/api.ts server/src/coord/store.ts server/src/coord/routes.ts \
  ccd/coordinator-skill/SKILL.md ccd/coordinator-skill/references/wave-lifecycle.md \
  server/test/coord-store.test.ts server/test/run-routes.test.ts
git commit -m "feat(coord): a reused session names its own repo — project-mismatch at open"
```

---

### Task 2: `project-mismatch` at dispatch resume — the registry backstop, before the hold

**Files:**
- Modify: `server/src/coord/dispatch.ts` — `DispatchOutcome`'s refused member (`:111`–`:114`); the resume arm, between the identity refusal (`:488`–`:490`) and the workspace/branch fallback (`:491`)
- Modify: `server/src/coord/routes.ts` — `sendDispatchOutcome`'s `refused` arm (`:137`–`:144`)
- Modify: `ccd/coordinator-skill/references/wave-lifecycle.md` — §2's dispatch refusal table (after `:54`)
- Test: `server/test/run-routes.test.ts` — the `describe('POST /api/runs/:id/dispatch')` block

**Interfaces:**
- Consumes: `RunRefuseCode`'s member `'project-mismatch'` (Task 1, `shared/api.ts`).
- Produces:
  - `DispatchOutcome`'s refused member's `code` `Extract<…>` list gains `'project-mismatch'`, and the member gains `by?: string` — PRESENT exactly when the refusal names a measured project.
  - `POST /api/runs/:id/dispatch` answers `409 {ok:false, refused:'project-mismatch', by:'<record.project>'}`.

**Spec:** §3 F1 (the dispatch site, the `by` passthrough, the "an adapter may not narrow a distinction it received" argument), §3 F3's wave-1 half (the dispatch table's row for this code), §7 row 2.

**Mutation table:** row 2 — "`project-mismatch` at dispatch resume" (spec §7), red when the `record.project` comparison is deleted, and red when the check is MOVED after the hold. Both measured in Step 5.

Anchor quotes. `server/src/coord/dispatch.ts:110`–`:114`:

```ts
  | { ok: false; kind: 'oversize'; limit: number; detail: string }
  | { ok: false; kind: 'refused';
      code: Extract<RunRefuseCode, 'paused' | 'mail-disabled' | 'cap-concurrency' | 'cap-daily' |
        'ambiguous-dispatch' | 'worker-busy' | 'hookstate-unmeasurable'>;
      limit?: number; running?: number; used?: number; candidates?: number }
```

`server/src/coord/dispatch.ts:482`–`:492`:

```ts
    const registryRead = await readRegistryMeasured(deps.io, deps.cfg);
    if (!registryRead.listed) {
      return { ok: false, kind: 'registry-unmeasurable' };
    }
    const record = registryRead.records.find((r) => r.id === sessionId);
    const recordIdentity = record !== undefined ? measuredIdentity(record) : null;
    if (record !== undefined && recordIdentity === null) {
      return { ok: false, kind: 'registry-unmeasurable' };
    }
    workspace = record?.workspace ?? run.workspace;
    branch = record?.branch ?? run.branch;
```

`server/src/coord/routes.ts:137`–`:144`:

```ts
    case 'refused': {
      const extra: Record<string, number> = {};
      if (r.limit !== undefined) extra.limit = r.limit;
      if (r.running !== undefined) extra.running = r.running;
      if (r.used !== undefined) extra.used = r.used;
      if (r.candidates !== undefined) extra.candidates = r.candidates;
      return reply.code(409).send({ ok: false, refused: r.code, ...extra });
    }
```

`server/src/coord/dispatch.ts:572`–`:579` (the hold this check must precede):

```ts
  const holdArgv = CCD_ARGV.wsHold(sessionId,
    holdReason(run.program, run.wave, run.waveOf, run.id),
    dispatchDec);
  if (!verbSupported(deps.fleetState, holdArgv)) {
    return { ok: false, kind: 'unsupported' };
  }
  const holdRes = await deps.runCcd(holdArgv);
  if (!holdRes.ok) return { ok: false, kind: 'fleetFailed', stderr: holdRes.stderr };
```

- [ ] **Step 1: Write the failing tests**

In `server/test/run-routes.test.ts`, inside `describe('POST /api/runs/:id/dispatch')`, add:

```ts
  it('refuses a resume whose registry record names another project — before the hold, the /clear and markDispatched', async () => {
    // F1's second rung. The open route's `sessionProject` cannot see this case:
    // no run has ever named this session, so it answers null and permits. The
    // registry row is the other measurement, and it disagrees with the run.
    const home = mkTmp('ccrc-runs-');
    seed(home, 'demo-existing', { project: 'other-project' });
    const { run, calls } = makeRunner(home);
    const w = await openApp(home, run); app = w.app;
    const opened = await postOpen(app, { ...OPEN_BODY, wave: 2, sessionId: 'demo-existing' });
    expect(opened.statusCode).toBe(200);
    const id = (opened.json() as { id: number }).id;
    const holdsAfterOpen = calls.filter((c) => c[0] === 'ws-hold').length;

    const res = await postDispatch(app, id);
    expect(res.statusCode).toBe(409);
    expect(res.json()).toEqual({ ok: false, refused: 'project-mismatch', by: 'other-project' });
    // THE POSITION IS THE GUARD, not just the comparison: no second hold, no
    // `/clear` typed into a pane bound to the wrong repo, and the run untouched.
    expect(calls.filter((c) => c[0] === 'ws-hold'),
      'the crossing was refused only AFTER the hold was placed').toHaveLength(holdsAfterOpen);
    expect(calls.some((c) => c[0] === 'send-keys'),
      'a /clear was typed into a session this dispatch had no business clearing').toBe(false);
    expect(w.coord.run(id)?.state).toBe('planned');
    expect(w.coord.run(id)?.dispatchedAt).toBeNull();
  });

  it('leaves the honest-stale case exactly as it was — a listable registry with no row for the session', async () => {
    // `record === undefined` on a LISTABLE registry is the tolerated case
    // (`DoneRun`'s own docstring): the run falls back to its own workspace and
    // branch, as it always has. Refusing on a fact not measured would be the
    // same error in the other direction.
    const home = mkTmp('ccrc-runs-');
    const { run } = makeRunner(home);
    const w = await openApp(home, run); app = w.app;
    const opened = await postOpen(app, { ...OPEN_BODY, wave: 2, sessionId: 'demo-ghost' });
    expect(opened.statusCode).toBe(200);
    const id = (opened.json() as { id: number }).id;
    const res = await postDispatch(app, id);
    expect(res.statusCode).toBe(200);
    expect(w.coord.run(id)?.state).toBe('dispatched');
  });

  it('still answers registry-unmeasurable when the registry cannot be listed at all', async () => {
    const home = mkTmp('ccrc-runs-');
    seed(home, 'demo-existing', { project: 'other-project' });
    const { run } = makeRunner(home);
    const w = await openApp(home, run, { io: unlistableIO }); app = w.app;
    const opened = await postOpen(app, { ...OPEN_BODY, wave: 2, sessionId: 'demo-existing' });
    expect(opened.statusCode).toBe(200);
    const id = (opened.json() as { id: number }).id;
    const res = await postDispatch(app, id);
    expect(res.statusCode).toBe(502);
    expect(res.json()).toMatchObject({ ok: false, error: 'registry-unmeasurable' });
  });
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd server && ./node_modules/.bin/vitest run test/run-routes.test.ts`

Expected: FAIL — 1 case, "refuses a resume whose registry record names another project", `expected 200 to be 409`. The two neighbours PASS: they are today's behaviour, and they are here so the fix cannot buy the refusal by breaking either.

- [ ] **Step 3: Widen the outcome and pass the distinction through**

In `server/src/coord/dispatch.ts`, `DispatchOutcome`'s refused member (`:111`–`:114`):

```ts
  | { ok: false; kind: 'refused';
      code: Extract<RunRefuseCode, 'paused' | 'mail-disabled' | 'cap-concurrency' | 'cap-daily' |
        'ambiguous-dispatch' | 'worker-busy' | 'hookstate-unmeasurable' | 'project-mismatch'>;
      limit?: number; running?: number; used?: number; candidates?: number;
      /** WHICH project the measured party belongs to — `project-mismatch`'s
       *  own field, and the only refusal on this union that carries a string.
       *  PRESENT exactly when there is a measured project to name; absent
       *  otherwise, never `''`, because presence is the distinction and an
       *  empty string would collapse "no project was measured" into "the
       *  project is nothing". The open route's own refusal already carries a
       *  `by` (`routes.ts`), so the two sites of one code answer one shape. */
      by?: string }
```

In `server/src/coord/routes.ts`, `sendDispatchOutcome`'s `refused` arm (`:137`–`:144`):

```ts
    case 'refused': {
      const extra: Record<string, number> = {};
      if (r.limit !== undefined) extra.limit = r.limit;
      if (r.running !== undefined) extra.running = r.running;
      if (r.used !== undefined) extra.used = r.used;
      if (r.candidates !== undefined) extra.candidates = r.candidates;
      // The `by` spread, not `by: r.by` — the same discipline the
      // `registry-unmeasurable` arm below states for `stderr`: an L4 adapter may
      // not narrow a distinction it received, and this field distinguishes by
      // PRESENCE. Its own spread rather than a member of `extra`, whose value
      // type is `number` and must stay so: `by` is the project's NAME.
      return reply.code(409).send({ ok: false, refused: r.code, ...extra,
        ...(r.by === undefined ? {} : { by: r.by }) });
    }
```

- [ ] **Step 4: Add the check, in its one correct position**

In `server/src/coord/dispatch.ts`, between the identity refusal that ends at `:490` and `workspace = record?.workspace ?? run.workspace;` (`:491`):

```ts
    // F1's registry rung (design 2026-09-08 §3 F1). `SessionRecord.project`
    // already rides the read above; nothing had ever compared it to the run's.
    //
    // THE POSITION IS PART OF THE GUARD. Here it is: after the record is found
    // and its identity measured, and BEFORE the hold, the injected `/clear` and
    // `markDispatched`. Moved past the hold, a crossing costs a claim on a
    // workspace this run is not going to use; moved past the `/clear`, it costs
    // a live worker's context. Nothing has been spawned at this point — the
    // resume arm only ran `ensure` — so the run is untouched and still
    // `planned`.
    //
    // `record !== undefined` is load-bearing and is NOT the same condition as
    // the refusal above it: an undefined record on a LISTABLE registry is the
    // tolerated honest-stale case, which keeps falling back to `run.workspace`
    // below exactly as it always has. An unlistable registry never reaches here
    // — `readRegistryMeasured` refused it four lines up with its own code.
    // Refusing on a fact not measured would be the same error in the other
    // direction.
    if (record !== undefined && record.project !== run.project) {
      return { ok: false, kind: 'refused', code: 'project-mismatch', by: record.project };
    }
```

- [ ] **Step 5: Run green, then measure both mutation halves**

Run: `cd server && ./node_modules/.bin/vitest run test/run-routes.test.ts`
Expected: PASS, every case.

Mutation (a) — delete the whole `if (record !== undefined && record.project !== run.project) { … }` block and re-run:
Expected: FAIL — 1 case, "refuses a resume whose registry record names another project", `expected 200 to be 409`. Restore it.

Mutation (b) — POSITION. Move the same block from where it now sits to immediately AFTER `if (!holdRes.ok) return { ok: false, kind: 'fleetFailed', stderr: holdRes.stderr };` (`:579`) and re-run:
Expected: FAIL — the SAME case, on a different assertion this time:
`the crossing was refused only AFTER the hold was placed: expected length 2 to be 1`.
The status and body assertions still pass, which is the point: a comparison in the wrong place answers the right code and has already spent a claim. Restore the block to its position above.

- [ ] **Step 6: Explain the second site in the skill's dispatch table**

Task 1 named `project-mismatch` in `SKILL.md`'s refusal sentence and explained it in `references/wave-lifecycle.md` §1, where the OPEN route can send it. This task ships the second site, so §2's dispatch table gets its own row — the coordinator's remedy is not the same one, and the skill test cares only that the code is explained somewhere, which is precisely why the second explanation has to be added deliberately rather than assumed.

In `ccd/coordinator-skill/references/wave-lifecycle.md`, add to §2's `| refused | what it means | what you do |` table (after the `hookstate-unmeasurable` row, `:54`):

```markdown
| `project-mismatch` | wave ≥ 2's session has a registry row in ANOTHER project than this run's; `by` names that project | stop. Nothing was spawned, no hold was placed, no `/clear` was sent, and the run is untouched and still `planned`. Do not retry: the workspace is a worktree in the wrong repo. Open the wave again WITHOUT `sessionId` so it spawns fresh in the target repo — and expect the programme to hold two live workspaces from then on, which costs two concurrency slots and two of the daily budget |
```

**A wave-2 sentence, stated one wave early — and why it stays.** "This wave deliberately does NOT change" above lists the two-slots-and-daily-budget consequence among §3 F3's BEHAVIOURAL clauses that belong to wave 2. This row states it anyway, because the remedy right beside it — "open the wave again WITHOUT `sessionId`" — is not actionable without knowing what it costs: a coordinator that cannot see the price of the only escape this refusal offers has no way to decide whether to take it. Recorded rather than silently crossed, as a further deviation beside the other six.

Run: `cd server && ./node_modules/.bin/vitest run test/dispatch-adopt.test.ts test/dispatch-hold-order.test.ts test/dispatch-mutex-gate.test.ts test/dispatch-skillstate.test.ts test/mail-routes.test.ts test/coordinator-skill.test.ts test/typecheck-tests.test.ts`

Expected: PASS. `dispatch-hold-order.test.ts` is the one to read carefully — it pins where the hold sits relative to the `/clear`, and this check lands before both.

- [ ] **Step 8: Commit**

```bash
git add server/src/coord/dispatch.ts server/src/coord/routes.ts \
  ccd/coordinator-skill/references/wave-lifecycle.md server/test/run-routes.test.ts
git commit -m "feat(dispatch): the resume arm measures the registry's project before it holds anything"
```

---

### Task 3: the ONE migration — the programme row can hold a home, the feed row can name a run

**Files:**
- Modify: `server/src/coord/schema.ts` — a new entry at the foot of `MIGRATIONS` (after the migration-8 entry that ends `:788`); `COORD_SCHEMA_VERSION` (`:794`) derives to 9 with no edit
- Modify: `shared/api.ts` — `NotifyEvent` (`:3035`–`:3054`), `reviveNotifyEvent`'s returned literal (`:3111`–`:3118`)
- Modify: `server/src/coord/store.ts` — `recordFeedEvent` (`:2775`–`:2784`), `feedEvents` (`:2799`–`:2811`), `mailQueuedSince` (`:2843`–`:2852`), new `programHome`
- Modify: `server/src/watch.ts` — `pushOne`'s parameter and its `log.record` call (`:1200`–`:1201`, `:1234`); `pushNewMail` (`:1107`–`:1113`), `pushNewRuns` (`:1154`–`:1161`), the blocked-sender push (`:2838`–`:2845`)
- Modify: `server/src/coord/routes.ts` — the caps-changed push's `log.record` call (`:1439`–`:1445`), the ONE producer of a `NotifyEvent` literal outside `watch.ts`
- Test: `server/test/coord-db.test.ts` — a `describe('coord.db: migration 9 …')`, and the derived-version case (`:659`–`:662`)
- Test: `server/test/coord-store.test.ts` — the feed round trip (`:1099`, `:1107`, `:2290`), a `programHome` case
- Test: `server/test/fleetws.test.ts` — the feed seeding at `:915`
- Test: `pwa/test/feed.test.ts` (`:16`–`:17`), `pwa/test/mail-screen.test.tsx` (`:27`–`:28`), `pwa/test/notifymark.test.ts` (`:5`–`:6`) — the three typed `NotifyEvent` builders

**Interfaces:**
- Consumes: nothing from Tasks 1–2.
- Produces:
  - `MIGRATIONS` gains ONE entry: `ALTER TABLE programs ADD COLUMN homeProject TEXT; ALTER TABLE feed_events ADD COLUMN runId INTEGER;`. `COORD_SCHEMA_VERSION` is `MIGRATIONS.length` and becomes 9.
  - `NotifyEvent.runId: number | null` — REQUIRED on the type, `null` = about no run. `reviveNotifyEvent` is its ONE tolerant reader.
  - `CoordStore.recordFeedEvent(epoch, e)` stores `e.runId`; `CoordStore.feedEvents(limit)` returns it.
  - `CoordStore.mailQueuedSince` returns `runId: number | null` alongside its existing columns.
  - `CoordStore.programHome(slug: string): string | null`.

**Spec:** §3 F2 (the `programs.homeProject` column, nullable, forward-only, its own entry), §4 (the `feed_events.runId` half and `NotifyEvent.runId` on the wire additively with one tolerant reader), §8 (one migration, `FLEET_PROTO` not bumped, a higher `user_version` on rollback not fatal), §7 rows "migration N+1".

**Mutation table:** row "migration N+1" (spec §7) — red when a v-8 database boots without either column readable. Measured in Step 7 by deleting one `ALTER TABLE` at a time.

**`programHome`'s null, said out loud.** `programHome('a-slug-with-no-row')` and `programHome('a-programme-whose-home-is-NULL')` both answer `null`, and Task 4's caller handles those two differently — it records `home-project-backfilled` for the second and nothing for the first. The caller therefore establishes existence FIRST (`coord.programs().some(…)`) and only then asks this method, so the two conditions never reach one value at a decision. That discipline is caller-enforced rather than encoded in the return type, which is a deviation from "no overloaded null at a seam" worth a ruling: **D-2055**.

Anchor quotes. `server/src/coord/schema.ts:782`–`:794`:

```ts
  `
  UPDATE ledger_alloc
     SET state = 'allocated', landedAt = NULL, landedIn = NULL
   WHERE state = 'landed'
     AND n IN (1294, 1332)
     AND landedIn = 'docs/superpowers/plans/2026-09-02-graphify-read-side-ccrc-level.md';
  `,
];

/** The version this build writes. `MIGRATIONS.length` and nothing else: a
 *  hand-maintained constant beside a growing array is a pair that goes out of
 *  step, and the failure is silent (a migration that never runs). */
export const COORD_SCHEMA_VERSION = MIGRATIONS.length;
```

`shared/api.ts:3052`–`:3054`:

```ts
  kind: 'ask' | 'done' | 'merged' | 'mail' | 'run' | 'coord' | 'unknown';
  sessionId: string; title: string; body: string;
}
```

`shared/api.ts:3111`–`:3118`:

```ts
    return {
      seq: reqNum(o, 'seq'),
      at: reqNum(o, 'at'),
      kind,
      sessionId: reqStr(o, 'sessionId'),
      title: reqStr(o, 'title'),
      body: reqStr(o, 'body'),
    };
```

`server/src/coord/store.ts:2775`–`:2784`:

```ts
  recordFeedEvent(epoch: string, e: NotifyEvent): void {
    tx(this.db, () => {
      this.db.prepare(
        'INSERT INTO feed_events (epoch, seq, at, kind, sessionId, title, body) VALUES (?, ?, ?, ?, ?, ?, ?)',
      ).run(epoch, e.seq, e.at, e.kind, e.sessionId, e.title, e.body);
      this.db.prepare(
        'DELETE FROM feed_events WHERE id NOT IN (SELECT id FROM feed_events ORDER BY id DESC LIMIT ?)',
      ).run(CoordStore.FEED_RETENTION);
    });
  }
```

`server/src/coord/store.ts:2799`–`:2811`:

```ts
  feedEvents(limit: number): NotifyEvent[] {
    const n = Number.isFinite(limit) && limit > 0
      ? Math.min(Math.floor(limit), CoordStore.FEED_RETENTION)
      : CoordStore.FEED_RETENTION;
    const rows = this.db.prepare(
      'SELECT seq, at, kind, sessionId, title, body FROM ' +
      '(SELECT * FROM feed_events ORDER BY id DESC LIMIT ?) ORDER BY id ASC',
    ).all(n) as { seq: number; at: number; kind: string; sessionId: string; title: string; body: string }[];
    return rows.map((r) => ({
      seq: r.seq, at: r.at, kind: isNotifyKind(r.kind) ? r.kind : 'unknown', sessionId: r.sessionId,
      title: r.title, body: r.body,
    }));
  }
```

`server/src/coord/store.ts:2843`–`:2852`:

```ts
  mailQueuedSince(sinceId: number): { deliveryId: number; mailId: number; toId: string; kind: string;
                                       subject: string; project: string | null;
                                       workspace: string | null }[] {
    return this.db.prepare(
      'SELECT d.id AS deliveryId, m.id AS mailId, d.toId, m.kind, m.subject, r.project, r.workspace ' +
      'FROM mail_deliveries d JOIN mail m ON m.id = d.mailId LEFT JOIN runs r ON r.id = m.runId ' +
      'WHERE d.id > ? ORDER BY d.id',
    ).all(sinceId) as { deliveryId: number; mailId: number; toId: string; kind: string; subject: string;
                         project: string | null; workspace: string | null }[];
  }
```

`server/src/watch.ts:1234`:

```ts
    const recorded = log?.record({ kind: e.kind, sessionId: e.sessionId, title, body: e.body });
```

`server/test/coord-db.test.ts:660`–`:663`:

```ts
  it('COORD_SCHEMA_VERSION derives to 8 — never hand-edited beside a growing array', () => {
    expect(COORD_SCHEMA_VERSION).toBe(8);
    expect(MIGRATIONS.length).toBe(8);
  });
```

- [ ] **Step 1: Write the failing migration tests**

In `server/test/coord-db.test.ts`, change the derived-version case (`:659`–`:662`) to:

```ts
  it('COORD_SCHEMA_VERSION derives to 9 — never hand-edited beside a growing array', () => {
    expect(COORD_SCHEMA_VERSION).toBe(9);
    expect(MIGRATIONS.length).toBe(9);
  });
```

and add a new `describe` at the foot of the file:

```ts
describe('coord.db: migration 9 — the programme knows its home, the feed row names its run', () => {
  interface ColumnInfo { name: string; type: string; notnull: number; dflt_value: unknown }
  const columnOf = (db: DatabaseSync, table: string, name: string): ColumnInfo | undefined =>
    (db.prepare(`PRAGMA table_info(${table})`).all() as unknown as ColumnInfo[])
      .find((c) => c.name === name);

  it('reaches a database ALREADY at user_version 8 — it cannot be an amendment to any earlier migration', () => {
    // The guard migrations 2..8 each earned, for migration 9. A file left by a
    // wave-8 server is at 8; db.ts's loop runs
    // `for (v = current; v < COORD_SCHEMA_VERSION; v++)`, so anything amended
    // INTO entries 0..7 can never run against it again. The two columns must
    // therefore arrive as their own entry, and this is what proves they do.
    const p = dbPathIn(mkTmp('ccrc-coord-'));
    mkdirSync(path.dirname(p), { recursive: true });
    const raw = new DatabaseSync(p);
    tx(raw, () => {
      for (let i = 0; i <= 7; i++) raw.exec(MIGRATIONS[i]!);
      raw.exec('PRAGMA user_version = 8');
    });
    raw.close();

    const db = openCoordDb(p);
    expect((db.prepare('PRAGMA user_version').get() as { user_version: number }).user_version)
      .toBe(COORD_SCHEMA_VERSION);
    expect(columnOf(db, 'programs', 'homeProject'), 'programs.homeProject is absent').toBeDefined();
    expect(columnOf(db, 'feed_events', 'runId'), 'feed_events.runId is absent').toBeDefined();
    // READABLE, not merely present: a v-8 row written before the column existed
    // reads back NULL rather than throwing.
    db.prepare("INSERT INTO programs (slug,title,createdAt,state) VALUES ('p','P',1,'active')").run();
    expect((db.prepare('SELECT homeProject FROM programs WHERE slug = ?').get('p') as
      { homeProject: string | null }).homeProject).toBeNull();
    db.close();
  });

  it('gives both columns the nullability the design depends on', () => {
    // NULLABLE, NO DEFAULT, both — and both halves are load-bearing. A NULL
    // `homeProject` means "no home was ever stored", which a later explicit
    // home BACKFILLS; a default would guess a home nothing could then correct
    // without colliding with it. A NULL `feed_events.runId` means "this event
    // is about no run" — an ask/done/merged about a session — which is
    // programless, not unmeasured.
    const db = openCoordDb(dbPathIn(mkTmp('ccrc-coord-')));
    const home = columnOf(db, 'programs', 'homeProject');
    const rid = columnOf(db, 'feed_events', 'runId');
    expect(home!.type).toBe('TEXT');
    expect(rid!.type).toBe('INTEGER');
    for (const c of [home, rid]) {
      expect(c!.notnull, `${c!.name} must be nullable`).toBe(0);
      expect(c!.dflt_value, `${c!.name} must carry no default`).toBeNull();
    }
    db.close();
  });

  it('is ADDITIVE: every column migration 1 wrote on programs is still there', () => {
    const db = openCoordDb(dbPathIn(mkTmp('ccrc-coord-')));
    const names = (db.prepare('PRAGMA table_info(programs)').all() as unknown as ColumnInfo[])
      .map((c) => c.name);
    expect(names).toEqual(expect.arrayContaining(['slug', 'title', 'createdAt', 'state', 'homeProject']));
    db.close();
  });

  it('a database from a NEWER build still READS both columns — rollback is real', () => {
    // spec:78-81 and `db.ts:105`: an older build meeting a higher user_version
    // may refuse to MIGRATE, never to READ. This is that promise for THESE two
    // columns specifically, since a rollback across this migration is the exact
    // window the design's §8 rollback paragraph is about.
    const p = dbPathIn(mkTmp('ccrc-coord-'));
    const a = openCoordDb(p);
    a.exec(`PRAGMA user_version = ${COORD_SCHEMA_VERSION + 3}`);
    a.prepare("INSERT INTO programs (slug,title,createdAt,state,homeProject) VALUES ('p','P',1,'active','demo')").run();
    a.close();
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const b = openCoordDb(p);
    expect((b.prepare('SELECT homeProject FROM programs WHERE slug = ?').get('p') as
      { homeProject: string | null }).homeProject).toBe('demo');
    expect((b.prepare('PRAGMA user_version').get() as { user_version: number }).user_version)
      .toBe(COORD_SCHEMA_VERSION + 3);
    warnSpy.mockRestore();
    b.close();
  });
});
```

- [ ] **Step 2: Write the failing store test**

In `server/test/coord-store.test.ts`, add:

```ts
describe('the durable feed carries the run it is about', () => {
  it('stores and returns runId, and answers null for an event about no run', () => {
    const s = new CoordStore(openCoordDb(path.join(mkTmp('ccrc-coord-'), '.ccrc', 'coord.db')));
    const r = s.openRun({ program: 'build4', title: 'T', project: 'demo',
      wave: 1, waveOf: 1, claimedBy: 'ccrc-pwa-coordinator' });
    if ('refused' in r) throw new Error('open refused');
    s.recordFeedEvent('epoch-1', { seq: 1, at: 1000, kind: 'mail', sessionId: 'demo-quiet-mesa',
      title: 't', body: 'b', runId: r.id });
    // An `ask` is about a SESSION and belongs to no run. Programless, not
    // unmeasured — and it must still be in the unfiltered feed.
    s.recordFeedEvent('epoch-1', { seq: 2, at: 1001, kind: 'ask', sessionId: 'demo-quiet-mesa',
      title: 'q', body: '', runId: null });
    expect(s.feedEvents(10).map((e) => e.runId)).toEqual([r.id, null]);
  });
});

describe('programHome', () => {
  it('answers the stored home, and null for a programme that stores none', () => {
    const s = new CoordStore(openCoordDb(path.join(mkTmp('ccrc-coord-'), '.ccrc', 'coord.db')));
    const r = s.openRun({ program: 'build4', title: 'T', project: 'demo',
      wave: 1, waveOf: 1, claimedBy: 'ccrc-pwa-coordinator' });
    if ('refused' in r) throw new Error('open refused');
    expect(s.programHome('build4')).toBeNull();
  });
});
```

- [ ] **Step 3: Run both suites to verify they fail**

Run: `cd server && ./node_modules/.bin/vitest run test/coord-db.test.ts test/coord-store.test.ts`

Expected: FAIL.
- `coord-db.test.ts` — "COORD_SCHEMA_VERSION derives to 9" fails `expected 8 to be 9`; the migration-9 describe fails on `programs.homeProject is absent`.
- `coord-store.test.ts` — `TypeError: s.programHome is not a function`, and the feed case fails `expected [ undefined, undefined ] to deeply equal [ 1, null ]`.

- [ ] **Step 4: Add the migration**

In `server/src/coord/schema.ts`, append a new entry after the migration-8 entry (which ends at `:788` with `` `, ``) and before the closing `];`:

```ts
  // ── 9: user_version 8 -> 9 ────────────────────────────────────────────────
  // Cross-repo programmes: the ONE migration that build has (design 2026-09-08
  // §8). MIGRATIONS[0..7] ARE FROZEN, for the reason every entry above states:
  // db.ts's loop runs `for (v = current; v < COORD_SCHEMA_VERSION; v++)`, so an
  // amendment to an applied entry never runs again.
  //
  // `programs.homeProject` (§3 F2) — the project whose repository holds this
  // programme's ledger, spec and plan. A programme is initiated in ONE project
  // and its waves may dispatch runs into any; before this column "the
  // programme's own repo" was true by accident, whenever every wave happened to
  // share one project.
  //
  // `feed_events.runId` (§4) — which run a feed row is about, so
  // `GET /api/feed?program=` can join through `runs` to a programme. The
  // recorders that KNOW a run (the mail lane and the run-transition lane)
  // populate it; every other kind is programless.
  //
  // NULLABLE, NO DEFAULT, BOTH, and each null means one thing:
  //   `homeProject` NULL = no home was ever stored (an older row, or a
  //     coordinator that omitted it during the legacy generation). NOT "the
  //     home is the run's own project" — nothing is guessed into this column,
  //     precisely so a later explicit home can BACKFILL it rather than collide
  //     with a default nobody chose.
  //   `runId` NULL = this event is about no run. An `ask`/`done`/`merged` is
  //     about a SESSION; it is programless and appears unfiltered only. NOT
  //     "the run could not be read" — nothing here reads a run.
  // A `DEFAULT` on either would be the overloaded null the entries above each
  // argued through.
  `
  ALTER TABLE programs ADD COLUMN homeProject TEXT;
  ALTER TABLE feed_events ADD COLUMN runId INTEGER;
  `,
```

`COORD_SCHEMA_VERSION` needs no edit: it is `MIGRATIONS.length`.

- [ ] **Step 5: Put `runId` on the wire, with one tolerant reader**

In `shared/api.ts`, `NotifyEvent` (`:3053`):

```ts
  sessionId: string; title: string; body: string;
  /**
   * WHICH RUN this notification is about, or `null` when it is about none.
   *
   * ADDITIVE (design 2026-09-08 §4); `FLEET_PROTO` is deliberately not bumped.
   * The ONE tolerant reader is `reviveNotifyEvent` below — an older server's
   * frame carries no `runId` at all, and that absence becomes `null` there and
   * nowhere else.
   *
   * NULL IS "ABOUT NO RUN", NOT "UNKNOWN". An `ask`, a `done`, a `merged` and a
   * `coord` are about a SESSION or about the config; they belong to no
   * programme and appear only in the unfiltered feed. The two lanes that DO
   * know a run — the mail lane and the run-transition lane — populate it, which
   * is what makes `GET /api/feed?program=` a join rather than a guess. Nothing
   * reads a run to compute this, so there is no read that could fail and no
   * third condition to fold in here.
   */
  runId: number | null;
```

and `reviveNotifyEvent`'s literal (`:3111`–`:3118`):

```ts
    return {
      seq: reqNum(o, 'seq'),
      at: reqNum(o, 'at'),
      kind,
      sessionId: reqStr(o, 'sessionId'),
      title: reqStr(o, 'title'),
      body: reqStr(o, 'body'),
      // TOLERANT, and deliberately not `reqNum`: an older server's frame omits
      // this field entirely, and rejecting the whole event over an additive
      // field would drop a real notification for a build difference. Anything
      // that is not a number — absent, null, a string — becomes `null`, which
      // is this field's own documented "about no run". The `kind` degradation
      // eight lines up is the same policy for the same reason.
      runId: typeof (o as { runId?: unknown }).runId === 'number'
        ? (o as { runId: number }).runId : null,
    };
```

- [ ] **Step 6: Store and read it, and give the programme its home read**

In `server/src/coord/store.ts`, `recordFeedEvent` (`:2777`–`:2779`):

```ts
      this.db.prepare(
        'INSERT INTO feed_events (epoch, seq, at, kind, sessionId, title, body, runId) ' +
        'VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      ).run(epoch, e.seq, e.at, e.kind, e.sessionId, e.title, e.body, e.runId);
```

`feedEvents` (`:2803`–`:2810`):

```ts
    const rows = this.db.prepare(
      'SELECT seq, at, kind, sessionId, title, body, runId FROM ' +
      '(SELECT * FROM feed_events ORDER BY id DESC LIMIT ?) ORDER BY id ASC',
    ).all(n) as { seq: number; at: number; kind: string; sessionId: string; title: string;
                  body: string; runId: number | null }[];
    return rows.map((r) => ({
      seq: r.seq, at: r.at, kind: isNotifyKind(r.kind) ? r.kind : 'unknown', sessionId: r.sessionId,
      // Straight through, on `claimedBy`'s idiom in `hydrateRun`: an integer
      // column with no vocabulary has nothing to read it through, and NULL from
      // a row written before migration 9 means exactly what NULL means for a row
      // written after it — this event is about no run.
      title: r.title, body: r.body, runId: r.runId,
    }));
```

`mailQueuedSince` (`:2843`–`:2852`) gains the run id it already joins to:

```ts
  mailQueuedSince(sinceId: number): { deliveryId: number; mailId: number; toId: string; kind: string;
                                       subject: string; project: string | null;
                                       workspace: string | null; runId: number | null }[] {
    return this.db.prepare(
      'SELECT d.id AS deliveryId, m.id AS mailId, d.toId, m.kind, m.subject, m.runId, ' +
      'r.project, r.workspace ' +
      'FROM mail_deliveries d JOIN mail m ON m.id = d.mailId LEFT JOIN runs r ON r.id = m.runId ' +
      'WHERE d.id > ? ORDER BY d.id',
    ).all(sinceId) as { deliveryId: number; mailId: number; toId: string; kind: string; subject: string;
                         project: string | null; workspace: string | null; runId: number | null }[];
  }
```

And, immediately after `programs()` (`:1633`), the home read:

```ts
  /**
   * The project whose repository holds this programme's ledger, spec and plan —
   * or `null` when the row stores none (design §3 F2).
   *
   * TWO CONDITIONS ANSWER NULL and the caller must not fold them: a programme
   * row whose `homeProject` IS NULL, and a slug with no programme row at all.
   * The open route establishes existence first (`programs()`) and only then
   * asks this method, because it records `home-project-backfilled` for the
   * first and nothing for the second. Stated here rather than encoded in the
   * return type, which is a compromise this build wrote down rather than hid.
   */
  programHome(slug: string): string | null {
    const row = this.db.prepare('SELECT homeProject FROM programs WHERE slug = ?')
      .get(slug) as { homeProject: string | null } | undefined;
    return row?.homeProject ?? null;
  }
```

- [ ] **Step 7: Run the two suites green, then measure the migration**

Run: `cd server && ./node_modules/.bin/vitest run test/coord-db.test.ts test/coord-store.test.ts`
Expected: PASS. (`coord-store.test.ts`'s three pre-existing `recordFeedEvent` calls at `:1099`, `:1107` and `:2290` and `fleetws.test.ts:915` are still missing `runId` — they type-fail rather than run-fail, so they are green here and red in Step 9's typecheck. Fix them in Step 9.)

Mutation, one `ALTER` at a time. Delete `ALTER TABLE programs ADD COLUMN homeProject TEXT;` from the new entry and run:
Run: `cd server && ./node_modules/.bin/vitest run test/coord-db.test.ts`
Expected: FAIL — "reaches a database ALREADY at user_version 8" with `programs.homeProject is absent`, plus the nullability and additive cases. Restore it.

Delete `ALTER TABLE feed_events ADD COLUMN runId INTEGER;` and re-run:
Expected: FAIL — the same case with `feed_events.runId is absent`, and `coord-store.test.ts`'s feed case fails with a `node:sqlite` error naming the missing column. Restore it.

- [ ] **Step 8: Carry the run id through the notify lanes**

In `server/src/watch.ts`, `pushOne`'s parameter (`:1201`) gains one optional field, and the `record` call (`:1234`) passes it:

```ts
  private pushOne(e: {
    kind: NotifyEvent['kind']; sessionId: string; project: string; title: string; body: string;
    /** WHICH RUN this push is about, when the lane raising it knows one
     *  (`NotifyEvent.runId`). OPTIONAL here and REQUIRED on the wire: five of
     *  this method's seven call sites are about a session and about no run at
     *  all, and an omitted field and an explicit `null` are the SAME fact for
     *  this one field — "about no run" — which is why folding them costs
     *  nothing. The two lanes that know a run pass the one they already have. */
    runId?: number | null;
    actions?: PushPayload['actions'];
```

```ts
    const recorded = log?.record({ kind: e.kind, sessionId: e.sessionId, title, body: e.body,
      runId: e.runId ?? null });
```

`pushNewMail` (`:1107`–`:1113`):

```ts
      this.pushOne({
        kind: 'mail', sessionId: m.toId, project,
        title: `✉ ${m.kind} › ${m.workspace ?? m.toId}`,
        body: m.subject,
        runId: m.runId,
        tag: `mail-${m.toId}-${m.mailId}`,
        recordAlways: true,
      }, projects);
```

`pushNewRuns` (`:1154`–`:1161`):

```ts
        this.pushOne({
          kind: 'run', sessionId: r.sessionId, project: r.project,
          title: `▸ ${r.toState} › ${r.workspace ?? r.project}`,
          body: `program:${r.program} wave ${r.wave}/${r.waveOf ?? '?'}`,
          runId: r.runId,
          tag: `run-${r.runId}-${r.toState}`,
          recordAlways: true,
          recordOnly: r.toState === 'closing',
        }, projects);
```

the blocked-sender push (`:2838`–`:2845`) — `origin.runId` is already read four lines above it:

```ts
          this.pushOne({
            kind: 'mail', sessionId: senderId,
            project: sessionProjects.get(senderId) ?? '',
            title: `✉ blocked › ${d.toId}`,
            body: `${origin.subject}: ${why}`,
            runId: origin.runId,
            tag,
            recordAlways: true,
          }, projects);
```

The four remaining call sites (`:850` done, `:3068` and `:3181` merged, `:3258` ask) are untouched: each is about a session and about no run, and omission is that fact.

**A fifth site, outside `pushOne` and outside `watch.ts` entirely — and it is SHIPPED SOURCE, not a fixture.** `server/src/coord/routes.ts`'s caps-changed push (`:1439`–`:1445`) calls `log.record` directly, with no `runId`. Leaving it as it stands does not fail a test; it fails to COMPILE, because `NotifyLog.record`'s parameter is `Omit<NotifyEvent, 'seq' | 'at'>` and `runId` is now on that type. A caps change is about no run:

```ts
        const ev = log.record({
          kind: 'coord', sessionId: '',
          title: 'caps changed',
          body: `workers ${before.maxConcurrentWorkers} → ${view.caps.maxConcurrentWorkers}, ` +
                `per day ${before.maxSessionsPerDay} → ${view.caps.maxSessionsPerDay}`,
          runId: null,
        });
```

- [ ] **Step 9: Fix the typed fixtures the required field broke**

Run: `cd server && ./node_modules/.bin/vitest run test/typecheck-tests.test.ts`

Expected: FAIL on the first assertion (`server/test/ is clean under a tests-inclusive project` — that project's `include` covers `../src/**/*.ts` too, per `test/tsconfig.tests.json`, so the shipped-source site above is caught by this same run) with FOURTEEN `TS2345` diagnostics naming `Property 'runId' is missing`, across four files:
- `server/src/coord/routes.ts` line 1440 (the caps-changed `log.record` call, Step 8's fifth site) — 1.
- `server/test/coord-store.test.ts` lines 1099, 1107 and 2290 — 3.
- `server/test/fleetws.test.ts` lines 915 (`coord.recordFeedEvent` in the feed-route loop) and 939 (`logA.record`, the restart-survival case) — 2.
- `server/test/notifylog.test.ts` lines 14, 27, 46, 47, 55, 61, 80 and 92 — every `.record(...)` call in that file — 8.
(Shape, not a transcript: match on the file, the code and the `Property 'runId' is missing` line, not on the columns.)

Add `runId: null` to the `routes.ts` site named in Step 8, and to all fourteen literals above — every one of them raises a `done`/`ask`/`mail`/`coord` event about a session, which is exactly this field's null.

In `pwa/test/feed.test.ts` (`:16`–`:17`):

```ts
const e = (over: Partial<NotifyEvent> = {}): NotifyEvent => ({
  seq: 1, at: 1_000, kind: 'mail', sessionId: 'cc-a', title: 't', body: 'b', runId: null, ...over,
```

In `pwa/test/mail-screen.test.tsx` (`:27`–`:28`), add `runId: null` to the builder's literal in the same position (before `...over`).

In `pwa/test/notifymark.test.ts` (`:5`–`:6`):

```ts
const ev = (seq: number): NotifyEvent =>
  ({ seq, at: 1_000 + seq, kind: 'ask', sessionId: 'cc-a', title: `t${seq}`, body: '', runId: null });
```

In `server/test/notifylog.test.ts`, add `runId: null` to each of the eight `.record({...})` literals (`:14`, `:27`, `:46`, `:47`, `:55`, `:61`, `:80`, `:92`) — the same field, in the same trailing position, at every one. Line 14 becomes:

```ts
    log.record({ kind: 'ask', sessionId: 'cc-a', title: 't', body: 'b', runId: null });
```

and the other seven follow the identical shape at their own line.

In `server/test/fleetws.test.ts`, line 915's `recordFeedEvent` call:

```ts
        coord.recordFeedEvent('epoch-1', { seq: i, at: 1000 + i, kind: 'done', sessionId: 'cc-a',
          title: `t${i}`, body: '', runId: null });
```

and line 939's `logA.record` call:

```ts
      const recorded = logA.record({ kind: 'mail', sessionId: 'cc-a', title: 'm1', body: 'b1', runId: null });
```

**A fifteenth site — RUNTIME, not TYPE.** `server/test/coord-store.test.ts`'s `describe('CoordStore: the coord feed kind')`, "round-trips a coord feed event through the durable table", passes `tsc` today unmodified — the `recordFeedEvent` argument and the `toEqual` array are both untyped object literals, so the compiler has nothing to say about either. But once `feedEvents` reads a real `runId` column back, the unchanged `toEqual` fails at RUN time on an unexpected extra property, which `typecheck-tests.test.ts` cannot see and only `test/coord-store.test.ts` itself catches. Fix both halves together:

```ts
    const s = store();
    s.recordFeedEvent('epoch-1', { seq: 1, at: 10, kind: 'coord', sessionId: '',
      title: 'caps', body: 'workers 3 to 5', runId: null });
    expect(s.feedEvents(10)).toEqual([
      { seq: 1, at: 10, kind: 'coord', sessionId: '', title: 'caps', body: 'workers 3 to 5', runId: null },
    ]);
```

- [ ] **Step 10: Run every suite this touched**

Run: `cd server && ./node_modules/.bin/vitest run test/coord-db.test.ts test/coord-store.test.ts test/fleetws.test.ts test/push-copy.test.ts test/notifylog.test.ts test/coord-caps-route.test.ts test/typecheck-tests.test.ts`
Expected: PASS. `coord-caps-route.test.ts` never went red on Step 8's fifth site — its own assertions read `ev.kind`/`ev.body` only, never a full-object `toEqual` — but it is the suite that drives the caps route end to end, so it is run here as the proof that the source fix compiles and the event still records, rather than trusting the typecheck run alone for shipped source.

Run: `cd pwa && ./node_modules/.bin/vitest run test/feed.test.ts test/mail-screen.test.tsx test/notifymark.test.ts test/presence-catchup.test.ts test/fleet-screen.test.tsx`
Expected: PASS. `presence-catchup.test.ts` and `fleet-screen.test.tsx` build their catch-up events as plain object literals inside `CatchUp` payloads that go through `reviveNotifyEvent`, so the tolerant reader supplies `runId: null` and neither file needs an edit — this run is the proof of that reader rather than an assumption about it.

Run: `cd pwa && npm run build`
Expected: exit 0 (`tsc --noEmit` clean, then `vite build`).

- [ ] **Step 11: Commit**

```bash
git add server/src/coord/schema.ts server/src/coord/store.ts server/src/coord/routes.ts server/src/watch.ts shared/api.ts \
  server/test/coord-db.test.ts server/test/coord-store.test.ts server/test/fleetws.test.ts server/test/notifylog.test.ts \
  pwa/test/feed.test.ts pwa/test/mail-screen.test.tsx pwa/test/notifymark.test.ts
git commit -m "feat(coord): one migration — a programme can hold a home, a feed row can name its run"
```

---

### Task 4: `homeProject` at open — accepted, written once, backfilled, refused when it differs, and legacy for one generation

**Files:**
- Modify: `shared/api.ts` — the `RunRefuseCode` count and docstring, the union (`:3787`–`:3791` as Task 1 left it), `RUN_REFUSE_CODE_MAP`; `RunSummary` (`:3998`–`:4006`)
- Modify: `server/src/coord/store.ts` — `openRun`'s input and its `programs` INSERT (`:518`–`:520`, `:566`–`:569`); new `setProgramHome`; `RunRowDb` (`:176`–`:186`); `RUN_ROW_COLUMNS` (`:188`–`:193`); `hydrateRun`'s literal (`:1640`–`:1642`)
- Modify: `server/src/coord/routes.ts` — `HOME_PROJECT_LEGACY_ACCEPTED` + `homeProjectVerdict` above `registerCoordRoutes`; the open route's body validation (`:936`–`:945`), the home decision, and the response (`:975`–`:978`)
- Modify: `ccd/coordinator-skill/SKILL.md` — the refusal-list sentence
- Modify: `ccd/coordinator-skill/references/wave-lifecycle.md` — §1's refusal table (added in Task 1)
- Create: `server/test/home-project.test.ts` — the pure decision over every branch of `homeProjectVerdict`, plus the shipped value of `HOME_PROJECT_LEGACY_ACCEPTED`
- Test: `server/test/run-routes.test.ts`, `server/test/coord-store.test.ts`, `server/test/reconstruction-drill.test.ts` (`:287`–`:296`)
- Test: `server/test/mail-routes.test.ts` — the `NOT_CODES` allowlist (`:438`–`:525`) gains the two `run_events.detail` tokens this task's recorded facts introduce
- Test: nine PWA `RunSummary` builders — `pwa/test/abandon-sheet.test.tsx:31`, `pwa/test/fleet-screen.test.tsx:1203`, `pwa/test/nestFleet.test.ts:31`, `pwa/test/pr-sheet.test.tsx:68`, `pwa/test/project-card.test.tsx:381`, `pwa/test/resume-sheet.test.tsx:20`, `pwa/test/runs-health.test.tsx:22`, `pwa/test/runs-screen.test.tsx:29`, `pwa/test/tap-targets.test.tsx:93`

**Interfaces:**
- Consumes: `CoordStore.programHome(slug)` and the `programs.homeProject` column (Task 3); `cfg.projectsRoot` (`server/src/config.ts:20`).
- Produces:
  - `RunRefuseCode` gains `'home-mismatch'`, with its key in `RUN_REFUSE_CODE_MAP`.
  - `RunSummary.homeProject: string | null` — REQUIRED on the wire type, computed by `hydrateRun`'s literal.
  - `CoordStore.openRun` input gains `homeProject?: string`, written on the programme row's FIRST insert only.
  - `CoordStore.setProgramHome(slug: string, home: string): void` — backfills only a NULL home.
  - `HOME_PROJECT_LEGACY_ACCEPTED: boolean`, `HomeProjectVerdict`, `homeProjectVerdict(input)` — exported from `server/src/coord/routes.ts`.
  - `POST /api/runs`'s response gains `ledgerRepo: string | null` and `ledgerAbsPath: string | null`; `ledgerPath` is unchanged.
  - `POST /api/runs` answers `409 {ok:false, refused:'home-mismatch', by:'<the stored home>'}`.
  - Run events `'home-project-backfilled'` and `'legacy-home-project'` (`run_events.detail`, written through `recordRunEvent`).

**Spec:** §3 F2 (every clause: the accept, the first-insert write, the backfill and its event, the mismatch and its own code, the legacy generation and its constant, the response's two new fields and the rejected registry/claimant derivation, `RunSummary.homeProject`), §7 rows "`home-mismatch`", "legacy-generation constant", "`RunSummary.homeProject`", §9 wave 3 (the flip's measured criterion, stated here so the constant carries it).

**Mutation table:**
- row "`home-mismatch`" — red when a differing home on a later open is accepted. Measured in Step 8 by deleting the `mismatch` arm of `homeProjectVerdict`.
- row "legacy-generation constant" — the test flips `legacyAccepted` and asserts BOTH branches; either branch deleted is red. Measured in Step 8.
- row "`RunSummary.homeProject`" — the wire literal losing the field is a compile error (`hydrateRun` returns a literal); the READER folding null and non-null is red in the response test.

**How the constant is flipped without editing the file.** The decision is a PURE function, `homeProjectVerdict`, whose `legacyAccepted` is a PARAMETER; the route passes `HOME_PROJECT_LEGACY_ACCEPTED` at the one call site. So the test flips a real boolean and asserts both branches, and wave 3's flip stays a one-constant change. Splitting the decision out is not in the spec's own words ("a one-constant change … whose test flips the constant"), and a `const` cannot be flipped from a test at all — recorded as **D-2056**.

Anchor quotes. `server/src/coord/store.ts:518`–`:520`:

```ts
  openRun(input: {
    program: string; title: string; project: string;
    wave: number; waveOf: number | null; claimedBy: string;
```

`server/src/coord/store.ts:565`–`:569`:

```ts
      const now = Date.now();
      this.db.prepare(
        'INSERT INTO programs (slug, title, createdAt, state) VALUES (?, ?, ?, ?) ' +
        'ON CONFLICT(slug) DO UPDATE SET title = excluded.title',
      ).run(input.program, input.title, now, 'active');
```

`server/src/coord/store.ts:188`–`:193`:

```ts
const RUN_ROW_COLUMNS =
  'r.id, r.program, p.title AS programTitle, r.wave, r.waveOf, r.project, r.sessionId, ' +
  'r.workspace, r.branch, r.state, r.claimedBy, ' +
  'r.resumed, r.clearedAt, r.openedAt, r.dispatchStartedAt, ' +
  'r.dispatchedAt, r.closedAt, ' +
  'r.handoffCommit, r.prLineage, r.briefQueued, r.clearError';
```

`server/src/coord/store.ts:1640`–`:1642`:

```ts
    return {
      id: row.id, program: row.program, programTitle: row.programTitle,
      wave: row.wave, waveOf: row.waveOf, project: row.project,
```

`server/src/coord/routes.ts:935`–`:946`:

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
    const waveOfVal = (waveOf ?? null) as number | null;
```

`server/src/coord/routes.ts:975`–`:979`:

```ts
    return reply.code(200).send({
      ok: true, id: opened.id, program: opened.program, state: opened.state,
      ledgerPath: `docs/superpowers/programs/${program}.md`,
    });
    });
```

`server/test/reconstruction-drill.test.ts:287`–`:296`:

```ts
    const RUN_SUMMARY_KEYS: Record<keyof RunSummary, true> = {
      id: true, program: true, programTitle: true, wave: true, waveOf: true,
      project: true, sessionId: true, workspace: true, branch: true, state: true,
      claimedBy: true,
      resumed: true, clearedAt: true, openedAt: true, dispatchStartedAt: true,
      dispatchedAt: true,
      closedAt: true, handoffCommit: true, items: true, unreadMail: true,
      health: true,
    };
    expect(Object.keys(RUN_SUMMARY_KEYS).length).toBe(21);
```

- [ ] **Step 1: Write the failing decision tests**

Create `server/test/home-project.test.ts`:

```ts
// The home-project decision, as a pure function, driven over every branch —
// including the one the shipped constant does not currently take. `POST
// /api/runs`'s route test (run-routes.test.ts) proves the LIVE branch; this file
// proves the RULE, and it is the only place the legacy flip can be measured
// before it happens.
import { describe, it, expect } from 'vitest';
import { HOME_PROJECT_LEGACY_ACCEPTED, homeProjectVerdict } from '../src/coord/routes.js';

describe('homeProjectVerdict', () => {
  it('writes the body home on a programme this box has never seen', () => {
    expect(homeProjectVerdict({ body: 'demo', known: false, stored: null, legacyAccepted: true }))
      .toEqual({ kind: 'write' });
  });

  it('backfills a stored NULL home, first writer wins', () => {
    expect(homeProjectVerdict({ body: 'demo', known: true, stored: null, legacyAccepted: true }))
      .toEqual({ kind: 'backfill', home: 'demo' });
  });

  it('says nothing to do when the stored home already agrees', () => {
    expect(homeProjectVerdict({ body: 'demo', known: true, stored: 'demo', legacyAccepted: true }))
      .toEqual({ kind: 'agrees' });
  });

  it('refuses a differing home and names the STORED one', () => {
    // `by` is the stored value, not the body's: the caller already knows what it
    // sent, and what it needs told is what this programme has said since wave 1.
    expect(homeProjectVerdict({ body: 'other-project', known: true, stored: 'demo', legacyAccepted: true }))
      .toEqual({ kind: 'mismatch', by: 'demo' });
  });

  it('flips on the legacy constant, and BOTH branches are real', () => {
    // THE FLIP, measured before it ships (design §3 F2, §9 wave 3). The route
    // passes `HOME_PROJECT_LEGACY_ACCEPTED` here; wave 3's PR changes that one
    // constant and nothing else, and this case is what says the other branch
    // already works.
    const absent = { body: undefined, known: false, stored: null };
    expect(homeProjectVerdict({ ...absent, legacyAccepted: true })).toEqual({ kind: 'legacy' });
    expect(homeProjectVerdict({ ...absent, legacyAccepted: false })).toEqual({ kind: 'required' });
    // An absent home is decided by the constant ALONE — never by whether the
    // programme is known or what it stores, because the column stays NULL
    // either way and nothing is guessed into it.
    expect(homeProjectVerdict({ body: undefined, known: true, stored: 'demo', legacyAccepted: true }))
      .toEqual({ kind: 'legacy' });
  });

  it('is shipped in the legacy generation — and this is the line wave 3 changes', () => {
    expect(HOME_PROJECT_LEGACY_ACCEPTED).toBe(true);
  });
});
```

- [ ] **Step 2: Write the failing store and route tests**

In `server/test/coord-store.test.ts`:

```ts
describe('the programme row remembers its home', () => {
  const store = () => new CoordStore(openCoordDb(path.join(mkTmp('ccrc-coord-'), '.ccrc', 'coord.db')));
  const open = (s: CoordStore, over: Record<string, unknown> = {}) => {
    const r = s.openRun({ program: 'build4', title: 'T', project: 'demo',
      wave: 1, waveOf: 2, claimedBy: 'ccrc-pwa-coordinator', ...over } as Parameters<CoordStore['openRun']>[0]);
    if ('refused' in r) throw new Error('open refused');
    return r;
  };

  it('writes homeProject on the FIRST insert, and never rewrites it on a later open', () => {
    const s = store();
    open(s, { homeProject: 'demo' });
    expect(s.programHome('build4')).toBe('demo');
    // The ON CONFLICT arm updates `title` and nothing else — a second open of
    // the same programme cannot silently re-home it, which is the whole reason
    // `setProgramHome` exists as a separate, NULL-only write.
    open(s, { wave: 2, homeProject: 'other-project' });
    expect(s.programHome('build4')).toBe('demo');
  });

  it('leaves the column NULL when no home is given', () => {
    const s = store();
    open(s);
    expect(s.programHome('build4')).toBeNull();
  });

  it('setProgramHome backfills a NULL home and REFUSES to overwrite a stored one', () => {
    const s = store();
    open(s);
    s.setProgramHome('build4', 'demo');
    expect(s.programHome('build4')).toBe('demo');
    s.setProgramHome('build4', 'other-project');
    expect(s.programHome('build4'), 'setProgramHome overwrote a home that was already stored')
      .toBe('demo');
  });

  it('puts the home on the wire, null and non-null alike', () => {
    const s = store();
    const a = open(s, { homeProject: 'demo' });
    expect(toRunSummary(s.run(a.id)!).homeProject).toBe('demo');
    const t = store();
    const b = open(t);
    expect(toRunSummary(t.run(b.id)!).homeProject).toBeNull();
  });
});
```

`server/test/coord-store.test.ts` does NOT import `toRunSummary` today — its store import (`:10`–`:11`) brings only `CoordStore, MAIL_RECLAIM_CANCELLED_ERROR, MAIL_REPLAY_CEILING_ERROR, MAIL_RUN_CLOSED_ERROR`. Change line `:11` to add it:

```ts
import { CoordStore, MAIL_RECLAIM_CANCELLED_ERROR, MAIL_REPLAY_CEILING_ERROR,
         MAIL_RUN_CLOSED_ERROR, toRunSummary } from '../src/coord/store.js';
```

In `server/test/run-routes.test.ts`, inside `describe('POST /api/runs')`:

```ts
  it('accepts homeProject, stores it, and answers with the ledger repo and its absolute path', async () => {
    const home = mkTmp('ccrc-runs-');
    const { run } = makeRunner(home);
    const w = await openApp(home, run, { cfg: { projectsRoot: '/srv/projects' } }); app = w.app;
    const res = await postOpen(app, { ...OPEN_BODY, homeProject: 'demo' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({
      ok: true, program: 'build4', state: 'planned',
      // UNCHANGED, deliberately: the coordinator keeps the relative path it has
      // always had, and the two new fields sit beside it.
      ledgerPath: 'docs/superpowers/programs/build4.md',
      ledgerRepo: 'demo',
      ledgerAbsPath: '/srv/projects/demo/docs/superpowers/programs/build4.md',
    });
    expect(w.coord.programHome('build4')).toBe('demo');
  });

  it('backfills a NULL stored home from a later open, and records the event', async () => {
    const home = mkTmp('ccrc-runs-');
    const { run } = makeRunner(home);
    const w = await openApp(home, run); app = w.app;
    const first = await postOpen(app);                       // legacy: no homeProject
    expect(first.statusCode).toBe(200);
    expect(w.coord.programHome('build4')).toBeNull();
    const second = await postOpen(app, { ...OPEN_BODY, wave: 2, homeProject: 'demo' });
    expect(second.statusCode).toBe(200);
    expect(w.coord.programHome('build4')).toBe('demo');
    const id = (second.json() as { id: number }).id;
    expect(w.coord.runEvents(id).map((e) => e.detail)).toContain('home-project-backfilled');
  });

  it('refuses a home that differs from the stored one, naming the stored value', async () => {
    const home = mkTmp('ccrc-runs-');
    const { run } = makeRunner(home);
    const w = await openApp(home, run); app = w.app;
    expect((await postOpen(app, { ...OPEN_BODY, homeProject: 'demo' })).statusCode).toBe(200);
    const runsBefore = w.coord.runs().length;
    const res = await postOpen(app, { ...OPEN_BODY, wave: 2, homeProject: 'other-project' });
    expect(res.statusCode).toBe(409);
    expect(res.json()).toEqual({ ok: false, refused: 'home-mismatch', by: 'demo' });
    // A SECOND code, not `project-mismatch`: the two conditions are handled
    // differently by the caller, and a seam may not collapse them.
    expect(w.coord.runs().length, 'a refused open left a planned orphan behind').toBe(runsBefore);
  });

  it('accepts an absent homeProject during the legacy generation, records it, and leaves the column NULL', async () => {
    const home = mkTmp('ccrc-runs-');
    const { run } = makeRunner(home);
    const w = await openApp(home, run); app = w.app;
    const res = await postOpen(app);
    expect(res.statusCode).toBe(200);
    // NOTHING IS GUESSED INTO THE COLUMN — that is what makes the backfill above
    // possible instead of a collision.
    expect(w.coord.programHome('build4')).toBeNull();
    expect(res.json()).toMatchObject({ ledgerRepo: null, ledgerAbsPath: null });
    const id = (res.json() as { id: number }).id;
    expect(w.coord.runEvents(id).map((e) => e.detail)).toContain('legacy-home-project');
  });

  it('refuses a present-but-empty homeProject as a malformed body', async () => {
    const home = mkTmp('ccrc-runs-');
    const { run } = makeRunner(home);
    const w = await openApp(home, run); app = w.app;
    expect((await postOpen(app, { ...OPEN_BODY, homeProject: '   ' })).statusCode).toBe(400);
    expect((await postOpen(app, { ...OPEN_BODY, homeProject: 7 })).statusCode).toBe(400);
  });
```

`CoordStore.runEvents(runId)` is the reader those two cases use — it exists today at `server/src/coord/store.ts:1580` and returns `{ at, fromState, toState, causedBy, detail }[]`.

- [ ] **Step 3: Run all three suites to verify they fail**

Run: `cd server && ./node_modules/.bin/vitest run test/home-project.test.ts test/coord-store.test.ts test/run-routes.test.ts`

Expected: FAIL.
- `home-project.test.ts` — the whole file fails to load: `SyntaxError: The requested module '.../src/coord/routes.ts' does not provide an export named 'HOME_PROJECT_LEGACY_ACCEPTED'`.
- `coord-store.test.ts` — `TypeError: s.setProgramHome is not a function`, and the wire case fails `expected undefined to be 'demo'`.
- `run-routes.test.ts` — the five new cases fail: three on `ledgerRepo`/`refused` shape, one on the missing `legacy-home-project` event, one with `expected 200 to be 400`.

- [ ] **Step 4: Declare the second code**

In `shared/api.ts`, the count sentence becomes "Fifteen codes exist below today; the next new one would be the sixteenth, not the ninth.", the docstring gains a paragraph, and the union and map gain the member:

```ts
 * `home-mismatch` is its sibling and NOT a flavour of it (design §3 F2). A
 * programme has ONE home — the project whose repository holds its ledger,
 * spec and plan — and a later open naming a different one is refused rather
 * than allowed to move it. The two are separate codes because the caller acts
 * on them completely differently: `project-mismatch` says "open this wave
 * without a `sessionId` and spawn fresh in the target repo", while
 * `home-mismatch` says "you are addressing the wrong programme, or you typed
 * the wrong home" — the wave does not move, the programme does not move, and
 * `by` names the home this programme has carried since its first open.
```

```ts
export type RunRefuseCode =
  | 'claimed-by-another' | 'paused' | 'mail-disabled' | 'cap-concurrency' | 'cap-daily'
  | 'ambiguous-dispatch' | 'worker-busy' | 'hookstate-unmeasurable' | 'not-dispatched'
  | 'prhistory-unreadable' | 'bad-transition' | 'unknown-item' | 'item-terminal'
  | 'project-mismatch' | 'home-mismatch';

const RUN_REFUSE_CODE_MAP: Record<RunRefuseCode, true> = {
  'claimed-by-another': true, paused: true, 'mail-disabled': true, 'cap-concurrency': true,
  'cap-daily': true, 'ambiguous-dispatch': true, 'worker-busy': true,
  'hookstate-unmeasurable': true, 'not-dispatched': true,
  'prhistory-unreadable': true, 'bad-transition': true, 'unknown-item': true, 'item-terminal': true,
  'project-mismatch': true, 'home-mismatch': true,
};
```

and `RunSummary` gains, after `project: string;` (`:4004`):

```ts
  /**
   * The project whose repository holds this run's PROGRAMME — its ledger, its
   * spec and its plan — or `null` when the programme row stores none.
   *
   * `project` above is where THIS RUN works; this is where the programme
   * lives, and the two differ exactly when the run is a crossing. That is the
   * whole reason the board needs it (design §5, F4): a runs-screen row can
   * only mark a crossing by comparing them.
   *
   * ADDITIVE; `FLEET_PROTO` is deliberately not bumped. REQUIRED here because
   * `hydrateRun` returns a literal and must therefore compute it — the same
   * mechanism `health` relies on — and `null` is a first-class answer rather
   * than a missing one: it is what every programme opened before this column
   * had a writer says, and what one opened during the legacy generation says.
   * A renderer marks NOTHING while it is null; absence permits. It is never
   * derived from the registry or from the claimant — a fact the programme
   * carries forever must not depend on a live read that can degrade.
   */
  homeProject: string | null;
```

- [ ] **Step 5: Store the home, and put it on the wire**

In `server/src/coord/store.ts`, `openRun`'s input (`:518`–`:520`):

```ts
  openRun(input: {
    program: string; title: string; project: string;
    wave: number; waveOf: number | null; claimedBy: string;
    /** The project whose repository holds this programme's ledger (design §3
     *  F2). Written on the programme row's FIRST insert ONLY — the `ON
     *  CONFLICT` arm below updates `title` and nothing else — so a later open
     *  can never silently re-home a programme. Backfilling a stored NULL is
     *  `setProgramHome`'s job, deliberately a second, narrower write.
     *  OPTIONAL: during the legacy generation an open carries none, and the
     *  column then stays NULL rather than taking a guess. */
    homeProject?: string;
```

its programme INSERT (`:565`–`:568`):

```ts
      this.db.prepare(
        'INSERT INTO programs (slug, title, createdAt, state, homeProject) VALUES (?, ?, ?, ?, ?) ' +
        'ON CONFLICT(slug) DO UPDATE SET title = excluded.title',
      ).run(input.program, input.title, now, 'active', input.homeProject ?? null);
```

and, immediately after `programHome` (Task 3's addition):

```ts
  /**
   * Backfill a programme's home — and ONLY a backfill (design §3 F2, "first
   * writer wins").
   *
   * `WHERE homeProject IS NULL` is the whole method. A programme's home is a
   * fact it carries forever, and an unconditional UPDATE here would make
   * `home-mismatch` decorative: the route refuses a differing home, and a write
   * that could overwrite one would be a second, quieter path to the same move.
   * The predicate is in SQL rather than in a route branch so it holds for every
   * future caller, not just today's one.
   */
  setProgramHome(slug: string, home: string): void {
    this.db.prepare('UPDATE programs SET homeProject = ? WHERE slug = ? AND homeProject IS NULL')
      .run(home, slug);
  }
```

`RunRowDb` (`:177`):

```ts
  id: number; program: string; programTitle: string; wave: number; waveOf: number | null;
  homeProject: string | null;
```

`RUN_ROW_COLUMNS` (`:189`):

```ts
const RUN_ROW_COLUMNS =
  'r.id, r.program, p.title AS programTitle, p.homeProject AS homeProject, ' +
  'r.wave, r.waveOf, r.project, r.sessionId, ' +
  'r.workspace, r.branch, r.state, r.claimedBy, ' +
  'r.resumed, r.clearedAt, r.openedAt, r.dispatchStartedAt, ' +
  'r.dispatchedAt, r.closedAt, ' +
  'r.handoffCommit, r.prLineage, r.briefQueued, r.clearError';
```

`hydrateRun`'s literal (`:1641`–`:1642`):

```ts
      id: row.id, program: row.program, programTitle: row.programTitle,
      // Straight off the `programs` join, on `programTitle`'s idiom: a free-form
      // project name, no vocabulary to read it through. NULL means the programme
      // row stores no home — never a value this build could not read.
      homeProject: row.homeProject,
      wave: row.wave, waveOf: row.waveOf, project: row.project,
```

- [ ] **Step 6: The decision, and the route that spends it**

In `server/src/coord/routes.ts`, above `registerCoordRoutes` (beside `sendDispatchOutcome`):

```ts
/**
 * THE LEGACY GENERATION, as one constant (design §3 F2). `true` while an absent
 * `homeProject` on `POST /api/runs` is ACCEPTED and RECORDED; `false` once every
 * live coordinator has redeployed and the field is required.
 *
 * The flip is its own PR (design §9 wave 3) and its criterion is MEASURED, not
 * judged: zero `legacy-home-project` rows in `run_events` over seven consecutive
 * days. The idiom is the box token's own — accepted-and-warned as `'legacy'` for
 * one generation (`coord/token.ts`, `server.ts`), then removed.
 *
 * Read ONCE, at the single call site below, and passed as an argument to
 * `homeProjectVerdict` rather than read inside it — which is what makes the
 * OTHER branch testable before it ships. `home-project.test.ts` drives both.
 */
export const HOME_PROJECT_LEGACY_ACCEPTED = true;

/** What the open route must DO about the body's `homeProject` and the
 *  programme's stored one. SIX answers, none folded into another: `write` and
 *  `agrees` both mean "nothing extra to do" but for different reasons and at
 *  different moments (a first insert versus a later open), and collapsing them
 *  would make the backfill event impossible to place correctly. */
export type HomeProjectVerdict =
  | { kind: 'write' }
  | { kind: 'agrees' }
  | { kind: 'backfill'; home: string }
  | { kind: 'legacy' }
  | { kind: 'required' }
  | { kind: 'mismatch'; by: string };

/**
 * The home decision, pure and independently testable — no store, no reply, no
 * clock — even though it is DEFINED here, in `server/src/coord/routes.ts`,
 * which is L4 delivery and by the ring's own rule (`CLAUDE.md`) is NOT allowed
 * to decide. It lives here anyway because the cross-wave contract fixes this
 * exact file as both the constant's home and this function's, so that wave
 * 3's flip stays the one-constant change the spec promises; moving the
 * function to an L1 module would break that promise for a ring compliance
 * this file's own text cannot buy back. Recorded as a further ring
 * compromise, not argued away (a deviation beside the other six). The only
 * L4 thing anywhere near this decision is the reply at the route's two call
 * sites below, which this function never touches.
 *
 * `known` and `stored` are TWO INPUTS and not one, because `programHome`
 * answers `null` both for a programme row with a NULL home and for a slug with
 * no row, and this function's caller acts on those differently: the first is a
 * BACKFILL that records an event, the second is a first insert that records
 * nothing. Establishing existence is the caller's job (`coord.programs()`), and
 * passing the answer in is what keeps that overloaded null out of the decision.
 *
 * An ABSENT body home is decided by `legacyAccepted` alone — never by `known`
 * or `stored` — because the column stays NULL either way: nothing is guessed
 * into it, so a later explicit home can backfill it instead of colliding.
 */
export function homeProjectVerdict(input: {
  body: string | undefined; known: boolean; stored: string | null; legacyAccepted: boolean;
}): HomeProjectVerdict {
  if (input.body === undefined) {
    return input.legacyAccepted ? { kind: 'legacy' } : { kind: 'required' };
  }
  if (!input.known) return { kind: 'write' };
  if (input.stored === null) return { kind: 'backfill', home: input.body };
  return input.stored === input.body ? { kind: 'agrees' } : { kind: 'mismatch', by: input.stored };
}
```

In the open route, the destructure and validation (`:936`–`:945`) gain `homeProject`:

```ts
    const { program, title, project, wave, waveOf, claimedBy, sessionId, homeProject } = body;
    if (typeof program !== 'string' || program.trim() === '' ||
        typeof title !== 'string' || title.trim() === '' ||
        typeof project !== 'string' || project.trim() === '' ||
        typeof claimedBy !== 'string' || claimedBy.trim() === '' ||
        typeof wave !== 'number' || !Number.isInteger(wave) || wave < 1 ||
        !(waveOf === undefined || waveOf === null || (typeof waveOf === 'number' && Number.isInteger(waveOf))) ||
        !(sessionId === undefined || (typeof sessionId === 'string' && sessionId.trim() !== '')) ||
        // Present-and-empty is a malformed body, not an absent home: absence is
        // the legacy generation saying nothing, and `'   '` is an edit somebody
        // did not finish. Folding them would write a whitespace home onto a
        // programme row forever.
        !(homeProject === undefined || (typeof homeProject === 'string' && homeProject.trim() !== ''))) {
      return reply.code(400).send({ ok: false, error: 'bad-request' });
    }
```

Then, after the `project-mismatch` check Task 1 added and before `coord.openRun`:

```ts
    // F2 (design §3 F2) — the programme's home, decided BEFORE the row exists so
    // a refusal leaves no `planned` orphan, exactly like the check above.
    //
    // `known` is measured separately from `stored` on purpose: `programHome`
    // answers null for two conditions this route handles differently, and asking
    // it only about a programme this box has proven exists is what keeps them
    // apart. `programs()` is one read of a table with one row per programme.
    const known = coord.programs().some((p) => p.slug === program);
    const homeVerdict = homeProjectVerdict({
      body: typeof homeProject === 'string' ? homeProject : undefined,
      known, stored: known ? coord.programHome(program) : null,
      legacyAccepted: HOME_PROJECT_LEGACY_ACCEPTED,
    });
    if (homeVerdict.kind === 'mismatch') {
      return reply.code(409).send({ ok: false, refused: 'home-mismatch', by: homeVerdict.by });
    }
    if (homeVerdict.kind === 'required') {
      return reply.code(400).send({ ok: false, error: 'bad-request' });
    }
```

The `openRun` call (`:953`) passes it:

```ts
    const opened = coord.openRun({ program, title, project, wave, waveOf: waveOfVal, claimedBy,
      ...(typeof homeProject === 'string' ? { homeProject } : {}) });
```

Immediately after the `'refused' in opened` block (`:956`), the two recorded facts:

```ts
    // The backfill and the legacy acceptance are RECORDED, not merely done:
    // wave 3's flip is dated by `run_events` showing zero `legacy-home-project`
    // rows over seven consecutive days, and a fact nothing wrote down cannot
    // date anything. `recordRunEvent` writes `fromState === toState`, so the
    // notify lane skips it and no push impersonates a transition.
    if (homeVerdict.kind === 'backfill') {
      coord.setProgramHome(program, homeVerdict.home);
      coord.recordRunEvent(opened.id, 'coordinator', 'home-project-backfilled');
    }
    if (homeVerdict.kind === 'legacy') {
      coord.recordRunEvent(opened.id, 'coordinator', 'legacy-home-project');
    }
```

and the response (`:975`–`:978`):

```ts
    // Re-read rather than reasoned about: `openRun`'s first insert and the
    // backfill above are two different writers of this column, and the response
    // must say what the row now HOLDS, not what this request happened to send.
    const ledgerRepo = coord.programHome(program);
    return reply.code(200).send({
      ok: true, id: opened.id, program: opened.program, state: opened.state,
      // UNCHANGED. The coordinator keeps the relative path it has always had.
      ledgerPath: `docs/superpowers/programs/${program}.md`,
      // Both null while the stored home is null, and never derived from the
      // registry or the claimant (design §3 F2's rejected alternative): a fact
      // the programme carries forever must not depend on a live read that can
      // degrade.
      ledgerRepo,
      ledgerAbsPath: ledgerRepo === null ? null
        : path.join(deps.cfg.projectsRoot, ledgerRepo, 'docs', 'superpowers', 'programs', `${program}.md`),
    });
```

**Two new kebab literals, and the reverse-scan pin that watches for exactly that.** The two recorded facts above put `'home-project-backfilled'` and `'legacy-home-project'` into `server/src/coord/routes.ts` as quoted kebab tokens — neither is a `RunRefuseCode` and neither is a `MAIL_REJECT_CODES` member, so `server/test/mail-routes.test.ts`'s "every quoted kebab token in server/src/coord that looks like a code is declared" (`:431`–`:529`) reds on both unless its `NOT_CODES` allowlist (`:438`–`:525`) names them, on the `'enter-ignored'` entry's own model (`:481`–`:489`).

In `server/test/mail-routes.test.ts`, inside the `NOT_CODES` set, immediately after the `'already-acked'` entry and before the closing `]);` (`:525`):

```ts
      'home-project-backfilled', // coord/routes.ts run_events.detail (cross-repo
                                  // programmes §3 F2, Task 4) — recorded when a
                                  // stored NULL homeProject is backfilled from
                                  // the body on a later open. Not a wire code:
                                  // no `refused`/`reject.code` ever carries it,
                                  // and nothing switches on it over the wire —
                                  // it is forensic history on the run, read
                                  // back only through GET /api/runs/:id events.
      'legacy-home-project',     // coord/routes.ts run_events.detail (§3 F2, §9
                                  // wave 3) — recorded when an open omits
                                  // `homeProject` while
                                  // `HOME_PROJECT_LEGACY_ACCEPTED` is true. This
                                  // is the row wave 3's flip counts to zero over
                                  // seven consecutive days; same reasoning as
                                  // its sibling above, not a wire code.
```

- [ ] **Step 7: Run the three suites, then the compile-forced fixtures**

Run: `cd server && ./node_modules/.bin/vitest run test/home-project.test.ts test/coord-store.test.ts test/run-routes.test.ts`
Expected: PASS.

Run: `cd server && ./node_modules/.bin/vitest run test/typecheck-tests.test.ts`
Expected: FAIL — `reconstruction-drill.test.ts` with `TS2741: Property 'homeProject' is missing in type … but required in type 'Record<keyof RunSummary, true>'`.

Fix it (`:287`–`:296`):

```ts
    const RUN_SUMMARY_KEYS: Record<keyof RunSummary, true> = {
      id: true, program: true, programTitle: true, wave: true, waveOf: true,
      project: true, homeProject: true, sessionId: true, workspace: true, branch: true, state: true,
      claimedBy: true,
      resumed: true, clearedAt: true, openedAt: true, dispatchStartedAt: true,
      dispatchedAt: true,
      closedAt: true, handoffCommit: true, items: true, unreadMail: true,
      health: true,
    };
    expect(Object.keys(RUN_SUMMARY_KEYS).length).toBe(22);
```

`homeProject` is reconstructible and therefore does NOT join `UNRECOVERABLE`: `reconstruct` returns `this.run(id)!`, whose join reads the column the same INSERT left NULL, and NULL is the honest answer for a programme rebuilt from a ledger that never carried a home.

Run: `cd pwa && npm run build`
Expected: FAIL — nine `TS2739`/`TS2345` diagnostics, one per `RunSummary` builder listed in **Files** above.

Add `homeProject: null` to each of the nine builders, immediately after their `project:` field, with this comment on the FIRST one you edit (`pwa/test/nestFleet.test.ts:33`):

```ts
  // Required on `RunSummary`; `null` is the honest fixture answer — a programme
  // with no stored home, which is what every row on a box that has not yet run
  // a cross-repo programme says. Wave 2's crossing-marker tests build their own
  // non-null variants by spreading this builder; they must not re-add the field
  // here.
  project: 'ccrc-pwa', homeProject: null, sessionId: null, workspace: null, branch: null,
```

Re-run: `cd pwa && npm run build`
Expected: exit 0.

- [ ] **Step 8: Measure the three mutation rows**

(a) `home-mismatch`. In `homeProjectVerdict`, change the last line to `return { kind: 'agrees' };` (deleting the mismatch arm) and run:
Run: `cd server && ./node_modules/.bin/vitest run test/home-project.test.ts test/run-routes.test.ts`
Expected: FAIL — 2 cases: "refuses a differing home and names the STORED one" (`expected {kind:'agrees'} to deeply equal {kind:'mismatch',by:'demo'}`) and "refuses a home that differs from the stored one, naming the stored value" (`expected 200 to be 409`). Restore it.

(b) The legacy constant, both branches. Change `homeProjectVerdict`'s first branch to `return { kind: 'legacy' };` unconditionally and run `test/home-project.test.ts`:
Expected: FAIL — 1 case, "flips on the legacy constant, and BOTH branches are real", `expected {kind:'legacy'} to deeply equal {kind:'required'}`.
Then change it to `return { kind: 'required' };` unconditionally and re-run BOTH files:
Expected: FAIL — the same case on its other assertion, AND `run-routes.test.ts`'s "accepts an absent homeProject during the legacy generation" with `expected 400 to be 200`, and every pre-existing open test in that file, since `OPEN_BODY` carries no `homeProject`. That second red is the measurement that matters: it says the shipped branch is the one the whole suite exercises. Restore the function.

(c) The wire reader folding null and non-null. In `hydrateRun`, change `homeProject: row.homeProject,` to `homeProject: null,` and run:
Run: `cd server && ./node_modules/.bin/vitest run test/coord-store.test.ts`
Expected: FAIL — "puts the home on the wire, null and non-null alike", `expected null to be 'demo'`. Restore it.

(d) The `NOT_CODES` allowlist Step 6 added. Delete the `'legacy-home-project'` entry from `server/test/mail-routes.test.ts`'s `NOT_CODES` set and run:
Run: `cd server && ./node_modules/.bin/vitest run test/mail-routes.test.ts`
Expected: FAIL — "every quoted kebab token in server/src/coord that looks like a code is declared", naming `legacy-home-project` as a token that is in neither `MAIL_REJECT_CODES` nor a `RunRefuseCode` and is not in `NOT_CODES`. Restore the entry. This is the guard that says the allowlist is doing its job rather than merely existing: a token this route writes with no allowlist entry reds the reverse scan exactly the way an actual new code would, which is the whole point of the scan being over-broad.

- [ ] **Step 9: Name the second code in the skill**

In `ccd/coordinator-skill/SKILL.md`, extend the refusal-list sentence Task 1 edited:

```markdown
`project-mismatch`, `home-mismatch`,
```

In `ccd/coordinator-skill/references/wave-lifecycle.md`, extend §1's refusal table (added in Task 1) with a third row, and amend step 2's body:

```markdown
| `home-mismatch` | this programme already stores a DIFFERENT home project; `by` names the stored one | stop and report. A programme has one home — the repo holding its ledger, spec and plan — and it does not move. Either you are addressing the wrong programme or the `homeProject` you sent is wrong. Nothing was opened |
```

```markdown
2. `POST /api/runs`
   `{"program":"<slug>","title":"<title>","project":"<project>","homeProject":"<the project this programme lives in>","wave":1,"waveOf":<M or null>,"claimedBy":"<your session id>"}`
   → `{"ok":true,"id":<run id>,"ledgerPath":…,"ledgerRepo":…,"ledgerAbsPath":…}`, or one of the refusals below.

**`homeProject`, and the two paths it names.** `ledgerRepo` echoes the home the
programme now stores, and `ledgerAbsPath` is that home's ledger by ABSOLUTE
path — the file a wave running in another repository reads without guessing
where it lives. Both are `null` while the programme stores no home. The server
tolerates an absent `homeProject` for one deploy generation and records that it
did; send it on every open anyway.
```

- [ ] **Step 10: Run the refusal-table and skill suites**

Run: `cd server && ./node_modules/.bin/vitest run test/coordinator-skill.test.ts test/mail-routes.test.ts test/resume-reclaim-l0.test.ts test/typecheck-tests.test.ts test/coord-routes-single-file.test.ts`
Expected: PASS. The forward scan finds `'home-mismatch'` in `routes.ts` (Step 6's refusal), the corpus census finds it in the skill, and `coord-routes-single-file.test.ts` is unchanged because no route was added or moved.

- [ ] **Step 11: Commit**

```bash
git add shared/api.ts server/src/coord/store.ts server/src/coord/routes.ts \
  ccd/coordinator-skill/SKILL.md ccd/coordinator-skill/references/wave-lifecycle.md \
  server/test/home-project.test.ts server/test/coord-store.test.ts server/test/run-routes.test.ts \
  server/test/reconstruction-drill.test.ts server/test/mail-routes.test.ts pwa/test
git commit -m "feat(coord): a programme carries its home project, refused rather than re-homed"
```

---

### Task 5: the `worker` role at send — a second role recipient, resolved at send time

**Files:**
- Modify: `server/src/coord/store.ts` — new `resolveWorker`, immediately after `resolveCoordinator` (`:2099`–`:2112`)
- Modify: `server/src/coord/routes.ts` — check 7 (`:589`–`:601`) and the role resolution (`:612`–`:621`)
- Test: `server/test/mail-routes.test.ts` — the `describe('POST /api/mail — the rejection table')` block

**Interfaces:**
- Consumes: `CoordStore.dueDeliveries(now: number, replayMs: number): …[]` (already shipped, `server/src/coord/store.ts:2433`) — this task's own tests read the queued delivery back through it, TWO required arguments, neither optional.
- Produces:
  - `CoordStore.resolveWorker(runId: number): string | null` — that run's `sessionId`; `null` when the run has no worker yet or does not exist.
  - `POST /api/mail` admits `toId: 'worker'`; it REQUIRES `runId` and resolves through `resolveWorker`. Unresolvable answers the same `404 unknown-recipient` shape the coordinator role answers, with the detail `run <n> has no worker`.
  - `'coordinator'`'s single-active-programme fallback is UNCHANGED and pinned.

**Spec:** §4 ("`'worker'` joins `'coordinator'` as a role recipient" — the admission, the resolution, the required `runId`, the identical refusal shape, the untouched coordinator fallback, raw session ids still accepted), §7 row "`worker` role at send", §9 wave 1.

**Mutation table:** row "`worker` role at send" (spec §7) — red when the literal is refused (check 7 narrowed back), and red when an undispatched run resolves to anything but `unknown-recipient`. Both measured in Step 5.

**There is no `toId` UNION to widen, and the frozen migration's comment stays frozen.** `mail.toId` is `TEXT` and `MailSummary.toId` is `string`; the only place the vocabulary `'coordinator' | a session id` is written down as a list is a column comment INSIDE `MIGRATIONS[0]` (`server/src/coord/schema.ts:126`). That entry is FROZEN — `db.ts`'s loop never runs it again against a live file — and its bytes are history, not the live list, exactly as that file's header says of migration 1's `feed_events.kind` comment. So the widened vocabulary is stated in the SEND ROUTE's own comment (below) and in `resolveWorker`'s docstring, and migration 1 is not edited.

**`MAIL_ROLE_IDS` does NOT gain `'worker'`, and that is deliberate.** That set is derived from `SYSTEM_MAIL_SENDER_MAP` (`server/src/coord/rundefs.ts:124`–`:134`) and is about SENDERS — `watch.ts`'s `tellSender` consults it to decide whether a `mail.fromId` may be treated as a session id. A worker never sends AS the role; it sends as its own session id, which is a registry row. Adding `'worker'` there would make `tellSender` try to resolve a sender that never exists. Written here because it is exactly the kind of symmetry a reviewer would "fix".

Anchor quotes. `server/src/coord/routes.ts:589`–`:601`:

```ts
    // 7: recipient shape — the literal role 'coordinator', or an existing
    // registry row. Resolving the ROLE to a concrete session id happens below,
    // after runId (check 8) is known to be real. Same transient-vs-terminal
    // split as check 5, reusing the same `names`/`registry` reads rather than
    // a second round trip.
    if (toId !== 'coordinator' && !registry.some((r) => r.id === toId)) {
      if (names.includes(`${toId}.uuid`)) {
        return refuse(reply, 502, 'registry-unmeasurable', { fromId, fromUuid, toId, kind, subject, runId },
          `registry row for ${toId} is listed but unreadable — transient, not a fact about the recipient`);
      }
      return refuse(reply, 404, 'unknown-recipient', { fromId, fromUuid, toId, kind, subject, runId },
        `no registry row for ${toId}`);
    }
```

`server/src/coord/routes.ts:612`–`:621`:

```ts
    // Resolving 'coordinator'. It is a ROLE, not a session id: the store
    // resolves it to the claimedBy of the run named in runId; with no runId,
    // to the claimedBy of the single active program. Ambiguous or absent →
    // unknown-recipient, recorded — no guessing: an agent-to-agent message
    // delivered to the wrong session is worse than one refused with a reason.
    const resolvedToId = toId === 'coordinator' ? coord.resolveCoordinator(runId) : toId;
    if (resolvedToId === null) {
      return refuse(reply, 404, 'unknown-recipient', { fromId, fromUuid, toId, kind, subject, runId },
        "the 'coordinator' role has no single claimed active program to resolve to");
    }
```

`server/src/coord/store.ts:2099`–`:2112`:

```ts
  resolveCoordinator(runId: number | null): string | null {
    if (runId !== null) {
      const row = this.db.prepare('SELECT claimedBy FROM runs WHERE id = ?')
        .get(runId) as { claimedBy: string | null } | undefined;
      return row?.claimedBy ?? null;
    }
    const active = this.db.prepare("SELECT slug FROM programs WHERE state = 'active'")
      .all() as { slug: string }[];
    if (active.length !== 1) return null;   // no single active program: ambiguous or absent
    const row = this.db.prepare(
      'SELECT claimedBy FROM runs WHERE program = ? AND claimedBy IS NOT NULL ORDER BY id LIMIT 1',
    ).get(active[0]!.slug) as { claimedBy: string | null } | undefined;
    return row?.claimedBy ?? null;
  }
```

- [ ] **Step 1: Write the failing tests**

In `server/test/mail-routes.test.ts`, add a `describe` after the rejection-table block:

```ts
describe("POST /api/mail — the 'worker' role", () => {
  let app: FastifyInstance | undefined;
  afterEach(async () => { if (app) await app.close(); app = undefined; });

  /** One dispatched run with a bound worker, the shape a wave brief answers into. */
  const withRun = (coord: CoordStore, sessionId: string | null): number => {
    const r = coord.openRun({ program: 'build4', title: 'T', project: 'demo',
      wave: 1, waveOf: 1, claimedBy: 'demo-coordinator' });
    if ('refused' in r) throw new Error('open refused');
    if (sessionId !== null) coord.setSession(r.id, sessionId);
    return r.id;
  };

  it("resolves 'worker' to the run's own session and delivers there", async () => {
    const home = mkTmp('ccrc-mail-');
    seed(home, 'demo-quiet-mesa'); seed(home, 'demo-worker');
    const w = await withMail(home); app = w.app;
    const runId = withRun(w.coord, 'demo-worker');
    const res = await send(app, { ...GOOD, toId: 'worker', runId });
    expect(res.statusCode).toBe(202);
    const due = w.coord.dueDeliveries(Date.now() + 1, 0);
    expect(due.map((d) => d.toId)).toEqual(['demo-worker']);
    // Resolution happens at SEND time and is stored on the delivery; the
    // envelope names the resolved session, exactly as the coordinator role's
    // own envelope does.
    expect(due[0]!.envelope).toContain('to: demo-worker');
  });

  it("refuses 'worker' with no runId — a worker is per run and there is nothing to fall back to", async () => {
    const home = mkTmp('ccrc-mail-');
    seed(home, 'demo-quiet-mesa');
    const w = await withMail(home); app = w.app;
    const res = await send(app, { ...GOOD, toId: 'worker', runId: null });
    expect(res.statusCode).toBe(404);
    expect(res.json()).toMatchObject({ ok: false, error: 'unknown-recipient' });
    expect(w.coord.dueDeliveries(Date.now() + 1, 0)).toHaveLength(0);
  });

  it("refuses 'worker' on a run that has no worker yet, and says which run", async () => {
    const home = mkTmp('ccrc-mail-');
    seed(home, 'demo-quiet-mesa');
    const w = await withMail(home); app = w.app;
    const runId = withRun(w.coord, null);
    const res = await send(app, { ...GOOD, toId: 'worker', runId });
    expect(res.statusCode).toBe(404);
    expect(res.json()).toMatchObject({ ok: false, error: 'unknown-recipient' });
    expect((res.json() as { detail: string }).detail).toContain(`run ${runId} has no worker`);
    // Recorded, like every refusal on this route.
    expect(w.coord.rejections().map((r) => r.code)).toContain('unknown-recipient');
  });

  it("leaves 'coordinator''s single-active-programme fallback exactly as it was", async () => {
    // THE PIN. `worker` requires a runId; `coordinator` does not, and its
    // no-runId arm is the documented recovery for an already-retired programme.
    // A "tidy" change that required a runId for both roles would break that and
    // nothing else in this file would notice.
    const home = mkTmp('ccrc-mail-');
    seed(home, 'demo-quiet-mesa'); seed(home, 'demo-coordinator');
    const w = await withMail(home); app = w.app;
    withRun(w.coord, 'demo-worker');
    const res = await send(app, { ...GOOD, toId: 'coordinator', runId: null });
    expect(res.statusCode).toBe(202);
    expect(w.coord.dueDeliveries(Date.now() + 1, 0).map((d) => d.toId)).toEqual(['demo-coordinator']);
  });

  it('still refuses a toId that is neither role nor a registry row', async () => {
    const home = mkTmp('ccrc-mail-');
    seed(home, 'demo-quiet-mesa');
    const w = await withMail(home); app = w.app;
    const res = await send(app, { ...GOOD, toId: 'demo-nobody' });
    expect(res.statusCode).toBe(404);
    expect(res.json()).toMatchObject({ ok: false, error: 'unknown-recipient' });
  });
});
```

`CoordStore` is already imported in that file. `dueDeliveries(now: number, replayMs: number)` takes TWO required arguments (`server/src/coord/store.ts:2433`); the three calls above pass `0` for `replayMs` — the replay window is irrelevant to a row queued moments ago by this same test.

- [ ] **Step 2: Run to verify they fail**

Run: `cd server && ./node_modules/.bin/vitest run test/mail-routes.test.ts`

Expected: FAIL — 3 of the 5 new cases. The `worker` sends are refused at check 7 with `no registry row for worker` (`expected 404 to be 202` on the first; the two refusal cases pass for the WRONG reason, which Step 5's mutation measurement is what separates). The coordinator-fallback and unknown-recipient cases pass.

- [ ] **Step 3: Add the store resolution**

In `server/src/coord/store.ts`, immediately after `resolveCoordinator` (`:2112`):

```ts
  /**
   * `'worker'` is the second ROLE recipient (design 2026-09-08 §4), and it is
   * simpler than `'coordinator'` in exactly one way that matters: it is ALWAYS
   * per run. A worker is the session a run dispatched into — `runs.sessionId` —
   * so there is no single-active-programme arm here and there must not be one.
   * `resolveCoordinator(null)` can fall back because a coordinator owns a
   * PROGRAMME; nothing owns "the worker" of a fleet.
   *
   * NULL FOR TWO CONDITIONS THAT ARE ONE FACT AT THIS SEAM: the run does not
   * exist, or it has not been dispatched yet. The caller refuses both with
   * `unknown-recipient` and could not act differently on them — and the route
   * has already refused a runId naming no run at all (check 8) before it gets
   * here, so the reachable condition is the second alone.
   */
  resolveWorker(runId: number): string | null {
    const row = this.db.prepare('SELECT sessionId FROM runs WHERE id = ?')
      .get(runId) as { sessionId: string | null } | undefined;
    return row?.sessionId ?? null;
  }
```

- [ ] **Step 4: Admit the literal and resolve it**

In `server/src/coord/routes.ts`, check 7 (`:589`–`:594`):

```ts
    // 7: recipient shape — a literal ROLE ('coordinator' or 'worker'), or an
    // existing registry row. Resolving a role to a concrete session id happens
    // below, after runId (check 8) is known to be real. Same
    // transient-vs-terminal split as check 5, reusing the same
    // `names`/`registry` reads rather than a second round trip.
    //
    // Raw session-id addressing is untouched and stays the ad-hoc lane: a role
    // follows the chair, a session id names a session.
    if (toId !== 'coordinator' && toId !== 'worker' && !registry.some((r) => r.id === toId)) {
```

and the resolution (`:612`–`:621`):

```ts
    // Resolving a ROLE. Neither literal is a session id: 'coordinator' resolves
    // to the claimedBy of the run named in runId — with no runId, to the
    // claimedBy of the single active program, UNCHANGED and deliberately so,
    // because that arm is the documented recovery for an already-retired
    // programme. 'worker' resolves to that run's own `sessionId` and REQUIRES a
    // runId: a worker is per run and there is nothing to fall back to.
    // Ambiguous or absent → unknown-recipient, recorded — no guessing: an
    // agent-to-agent message delivered to the wrong session is worse than one
    // refused with a reason.
    const resolvedToId = toId === 'coordinator' ? coord.resolveCoordinator(runId)
      : toId === 'worker' ? (runId === null ? null : coord.resolveWorker(runId))
      : toId;
    if (resolvedToId === null) {
      // ONE SHAPE, TWO SENTENCES. The status and code are the coordinator
      // role's exactly — from the server's side an unresolvable role is an
      // unresolvable role — but the detail names which condition, because the
      // sender's remedy differs: send the runId, versus wait for the wave to be
      // dispatched.
      const why = toId !== 'worker'
        ? "the 'coordinator' role has no single claimed active program to resolve to"
        : runId === null
          ? "the 'worker' role needs a runId — a worker is per run, and there is nothing to fall back to"
          : `run ${runId} has no worker`;
      return refuse(reply, 404, 'unknown-recipient', { fromId, fromUuid, toId, kind, subject, runId }, why);
    }
```

- [ ] **Step 5: Run green, then measure both mutation halves**

Run: `cd server && ./node_modules/.bin/vitest run test/mail-routes.test.ts`
Expected: PASS, every case.

Mutation (a) — the literal refused. Restore check 7 to `if (toId !== 'coordinator' && !registry.some(…))` and re-run:
Expected: FAIL — "resolves 'worker' to the run's own session and delivers there", `expected 404 to be 202`. Note the two refusal cases stay GREEN under this mutation, which is precisely why the happy case has to exist: without it, a route that refuses `worker` unconditionally passes the refusal half of this table. Restore the check.

Mutation (b) — an undispatched run resolving to something. Change the worker arm to `coord.resolveWorker(runId) ?? 'demo-quiet-mesa'` and re-run:
Expected: FAIL — "refuses 'worker' on a run that has no worker yet", `expected 202 to be 404`. Restore it.

- [ ] **Step 6: Run the neighbours**

Run: `cd server && ./node_modules/.bin/vitest run test/mail-peer-quota.test.ts test/coord-envelope.test.ts test/mail-sweep.test.ts test/coord-kickoff.test.ts test/typecheck-tests.test.ts`
Expected: PASS. The peer-quota lane is `runId === null`-scoped and a `worker` mail always carries one, so its bounds are untouched.

- [ ] **Step 7: Commit**

```bash
git add server/src/coord/store.ts server/src/coord/routes.ts server/test/mail-routes.test.ts
git commit -m "feat(mail): the worker is a role too — resolved per run, refused rather than guessed"
```

---

### Task 6: `bindSession` — one writer of `runs.sessionId`, and the heir inherits the mail

**Files:**
- Modify: `server/src/coord/store.ts` — new `MAIL_REBIND_SUPERSEDED_ERROR` beside `MAIL_RECLAIM_CANCELLED_ERROR` (`:295`); `DELIBERATE_CANCEL_ERRORS_SQL` (`:305`–`:306`) and its docstring; `ABANDONED_PARK_SQL`'s docstring (`:308`–`:321`); `requeueAbandonedCoordinatorMail` renamed and generalised (`:1013`–`:1057`) and its call site (`:744`); `setSession` (`:1304`–`:1306`); `markDispatched` (`:1424`–`:1429`); new `bindSession`
- Modify: `server/test/single-definition.test.ts` — the `setDeliveryEnvelope` caller pin (`:751`), the deliberate-cancel pin (`:421`–`:449`)
- Modify: `server/test/mail-hardening.test.ts` — two comments naming the old method (`:505`, `:519`)
- Test: `server/test/coord-store.test.ts` — the re-queue reach cases (`:1988`–`:1995`, `:2139`–`:2140`) and new `bindSession` cases

**Interfaces:**
- Consumes: `toId: 'worker'` mail rows (Task 5) — the population the worker arm re-issues.
- Produces:
  - `CoordStore.bindSession(runId: number, sessionId: string): { rebound: boolean; reissued: number }` — the ONE writer of `runs.sessionId`.
  - `CoordStore.setSession` and `CoordStore.markDispatched` delegate to it; neither writes the column itself any more.
  - `CoordStore.requeueAbandonedMail(role, to, displaced): number` — D-1425's act, parameterised by role; the coordinator path calls it unchanged.
  - `MAIL_REBIND_SUPERSEDED_ERROR` — the predecessor's park sentence, a third member of `DELIBERATE_CANCEL_ERRORS_SQL`.

**Spec:** §4 ("Resolution stays at send time — the promise is kept at occupant change, through one funnel": the two existing writers, the funnel, the re-issue for the `worker` role, the honest statement that no route re-binds a live run today, and why the funnel exists anyway), §7 row "heir re-issue in `bindSession`".

**Mutation table:** row "heir re-issue in `bindSession`" (spec §7) — red when the heir gets no fresh row, when the predecessor's row is not parked, when the envelope names the corpse, or when EITHER old writer bypasses the funnel. All four measured in Step 6.

**Two honest departures from the spec's own sentence, both recorded.**

1. `MAIL_RECLAIM_CANCELLED_ERROR` is the literal string `'coordinator reclaimed'` (`store.ts:295`). Re-using it to park a WORKER's superseded delivery would write a false sentence into `lastError`, which several readers show. The predecessor's row therefore gets its own constant, `MAIL_REBIND_SUPERSEDED_ERROR`, joined to `DELIBERATE_CANCEL_ERRORS_SQL` — which is that constant's own documented extension point ("Every future 'this delivery was cancelled on purpose' park joins HERE"). The spec said "the vocabulary that already exists"; this is one word more than existed. **D-2058**.
2. The generalisation is more than one parameter. The coordinator arm sources ABANDONED parks and parks nothing; the worker arm sources OUTSTANDING deliveries and parks the predecessor's row. Both are what the spec's own two sentences require, so the role discriminates the SOURCE predicate and the park as well as the `m.toId` literal and the scope clause — and the method's name still says "Abandoned", which is true of one arm only. **D-2059**.

Anchor quotes. `server/src/coord/store.ts:295`–`:306`:

```ts
export const MAIL_RECLAIM_CANCELLED_ERROR = 'coordinator reclaimed';

/** The two parks that are DECISIONS rather than abandonment — a run closing
 *  (`closeRun`) and a chair changing hands (`reclaimProgram`) — as one SQL list,
 *  so the read-side exclusion below names a set rather than growing a second
 *  hand-written `!=` per writer. Every future "this delivery was cancelled on
 *  purpose" park joins HERE and inherits the exclusion; a park that means "we
 *  gave up" (the replay ceiling, the attempt ceiling, a purged recipient) must
 *  never be added, because those are exactly the rows that predicate exists to
 *  keep visible. */
const DELIBERATE_CANCEL_ERRORS_SQL =
  `('${MAIL_RUN_CLOSED_ERROR}','${MAIL_RECLAIM_CANCELLED_ERROR}')`;
```

`server/src/coord/store.ts:744`:

```ts
        this.requeueAbandonedCoordinatorMail(run.program, to, displaced);
```

`server/src/coord/store.ts:1013`–`:1030`:

```ts
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
```

`server/src/coord/store.ts:1304`–`:1306`:

```ts
  setSession(runId: number, sessionId: string): void {
    this.db.prepare('UPDATE runs SET sessionId = ? WHERE id = ?').run(sessionId, runId);
  }
```

`server/src/coord/store.ts:1424`–`:1429`:

```ts
  markDispatched(runId: number, sessionId: string, workspace: string | null, branch: string | null,
                 resumed: boolean, at: number = Date.now()): void {
    this.db.prepare(
      'UPDATE runs SET sessionId = ?, workspace = ?, branch = ?, resumed = ?, dispatchedAt = ? WHERE id = ?',
    ).run(sessionId, workspace, branch, resumed ? 1 : 0, at, runId);
  }
```

`server/test/single-definition.test.ts:748`–`:751`:

```ts
    expect(/\bthis\.setDeliveryEnvelope\(/.test(codeOnly(store)),
      'no in-file caller of setDeliveryEnvelope — this half has nothing to check').toBe(true);
    expect(doc, 'the docstring does not name the in-file caller')
      .toContain('requeueAbandonedCoordinatorMail');
```

- [ ] **Step 1: Write the failing tests**

In `server/test/coord-store.test.ts`, add:

```ts
describe('bindSession — the one writer of runs.sessionId, and the heir inherits the mail', () => {
  const store = () => new CoordStore(openCoordDb(path.join(mkTmp('ccrc-coord-'), '.ccrc', 'coord.db')));
  const openOne = (s: CoordStore): number => {
    const r = s.openRun({ program: 'build4', title: 'T', project: 'demo',
      wave: 1, waveOf: 1, claimedBy: 'demo-coordinator' });
    if ('refused' in r) throw new Error('open refused');
    return r.id;
  };
  /** One `to:'worker'` mail queued to the session that holds the run today —
   *  the shape `POST /api/mail` mints once the role resolves. */
  const workerMail = (s: CoordStore, runId: number, toId: string, subject: string): number =>
    tx(s.db, () => {
      const m = s.insertMail({ fromId: 'demo-coordinator', fromUuid: 'u', toId: 'worker', runId,
        kind: 'status', subject, body: 'b', artifacts: [] });
      const d = s.queueDelivery(m.id, toId, '');
      const stamped = s.setDeliveryEnvelope(d.id, `to: ${toId}\nack: ccrc-api mail ack ${d.id}\n`);
      if (!stamped.ok) throw new Error(stamped.why);
      return d.id;
    });

  it('a FIRST bind, from null, re-issues nothing', () => {
    const s = store();
    const runId = openOne(s);
    expect(s.bindSession(runId, 'demo-worker')).toEqual({ rebound: false, reissued: 0 });
    expect(s.run(runId)?.sessionId).toBe('demo-worker');
  });

  it('re-binding to the SAME session re-issues nothing', () => {
    const s = store();
    const runId = openOne(s);
    s.bindSession(runId, 'demo-worker');
    workerMail(s, runId, 'demo-worker', 'the wave brief');
    expect(s.bindSession(runId, 'demo-worker')).toEqual({ rebound: false, reissued: 0 });
    expect(s.mailForRecipient('demo-worker')).toHaveLength(1);
  });

  it('re-binding to a DIFFERENT session gives the heir a freshly rendered row and parks the predecessor', () => {
    const s = store();
    const runId = openOne(s);
    s.bindSession(runId, 'demo-worker');
    const oldDelivery = workerMail(s, runId, 'demo-worker', 'the wave brief');

    expect(s.bindSession(runId, 'demo-heir')).toEqual({ rebound: true, reissued: 1 });

    // The heir gets a NEW delivery of the SAME mail — two delivery rows for one
    // mail is what this schema has always meant by "delivered to two
    // recipients", and its counters are ZERO because they are true of it.
    const heirs = s.mailForRecipient('demo-heir');
    expect(heirs).toHaveLength(1);
    expect(heirs[0]!.subject).toBe('the wave brief');
    expect(heirs[0]!.attempts).toBe(0);
    expect(heirs[0]!.state).toBe('queued');
    expect(heirs[0]!.deliveryId).not.toBe(oldDelivery);

    // FRESHLY RENDERED — the envelope names the HEIR, not the corpse, and its
    // `ack:` line names its own delivery id. A replay may never be re-rendered;
    // this is a second delivery, so it renders its own.
    const env = s.deliveryEnvelope(heirs[0]!.deliveryId)!.envelope;
    expect(env).toContain('to: demo-heir');
    expect(env).not.toContain('to: demo-worker');
    expect(env).toContain(`ack: ccrc-api mail ack ${heirs[0]!.deliveryId}`);

    // …and the predecessor's row is PARKED, with a sentence that is true of it.
    const old = s.delivery(oldDelivery)!;
    expect(old.state).toBe('rejected');
    // A DELIBERATE cancel: it must not read as "this park still needs a human"
    // in a mailbox nobody is watching any more.
    expect(s.outstandingMailFor('demo-worker')).toHaveLength(0);
  });

  it('leaves mail addressed to a literal session id alone — it was sent to a session, not to a chair', () => {
    const s = store();
    const runId = openOne(s);
    s.bindSession(runId, 'demo-worker');
    tx(s.db, () => {
      const m = s.insertMail({ fromId: 'demo-coordinator', fromUuid: 'u', toId: 'demo-worker',
        runId, kind: 'status', subject: 'personal', body: 'b', artifacts: [] });
      const d = s.queueDelivery(m.id, 'demo-worker', '');
      s.setDeliveryEnvelope(d.id, 'to: demo-worker\n');
      return m;
    });
    expect(s.bindSession(runId, 'demo-heir')).toEqual({ rebound: true, reissued: 0 });
    expect(s.mailForRecipient('demo-heir')).toHaveLength(0);
    expect(s.outstandingMailFor('demo-worker')).toHaveLength(1);
  });

  it('runs.sessionId has exactly ONE writer in the store, and it is bindSession', () => {
    // The funnel as a MECHANISM. `setSession` and `markDispatched` both wrote
    // this column directly before this wave, and either one restored would keep
    // every behavioural case above green while silently reopening the hole the
    // funnel exists to close: a re-bind that hands nobody the mail.
    const here = path.dirname(fileURLToPath(import.meta.url));
    const src = readFileSync(path.resolve(here, '../src/coord/store.ts'), 'utf8');
    const writers = [...src.matchAll(/UPDATE runs SET sessionId\b/g)];
    expect(writers, 'runs.sessionId is written outside bindSession').toHaveLength(1);
  });
});
```

`coord-store.test.ts` imports `path`, `openCoordDb`, `CoordStore` and `mkTmp` already (`:8`–`:16`) but none of `readFileSync`, `fileURLToPath` or `tx`. Add them: `import { readFileSync } from 'node:fs';`, `import { fileURLToPath } from 'node:url';`, and `tx` onto the `../src/coord/db.js` import at `:10` (`import { openCoordDb, tx } from '../src/coord/db.js';`).

- [ ] **Step 2: Run to verify they fail**

Run: `cd server && ./node_modules/.bin/vitest run test/coord-store.test.ts`

Expected: FAIL — `TypeError: s.bindSession is not a function` on all five behavioural cases, and the one-writer scan fails `expected length 2 to be 1` (`setSession` and `markDispatched` each write the column today). That last red is the honest starting measurement of the funnel.

- [ ] **Step 3: The third park sentence**

In `server/src/coord/store.ts`, after `MAIL_RECLAIM_CANCELLED_ERROR` (`:295`):

```ts
/**
 * The occupant-change park (design 2026-09-08 §4), and it is its OWN sentence
 * rather than a reuse of the two above. `MAIL_RECLAIM_CANCELLED_ERROR` reads
 * `'coordinator reclaimed'`, which is FALSE of a worker whose run was re-bound,
 * and `lastError` reaches an operator's eye through `MailSummary.lastError`; a
 * park that lies about why it parked is worse than no park. Same shape, same
 * exclusion, different fact.
 *
 * A DELIBERATE cancel, so it joins `DELIBERATE_CANCEL_ERRORS_SQL` below: the
 * predecessor is not being abandoned, it is being SUPERSEDED — the heir already
 * holds a freshly rendered delivery of the same mail — and a row that stayed
 * visible as "this park still needs a human" would ask a human to act on a
 * message that has already been re-sent.
 */
export const MAIL_REBIND_SUPERSEDED_ERROR = 'recipient rebound';
```

and the list (`:297`–`:306`):

```ts
/** The three parks that are DECISIONS rather than abandonment — a run closing
 *  (`closeRun`), a chair changing hands (`reclaimProgram`) and an occupant
 *  changing (`bindSession`) — as one SQL list, so the read-side exclusion below
 *  names a set rather than growing a second hand-written `!=` per writer. Every
 *  future "this delivery was cancelled on purpose" park joins HERE and inherits
 *  the exclusion; a park that means "we gave up" (the replay ceiling, the
 *  attempt ceiling, a purged recipient) must never be added, because those are
 *  exactly the rows that predicate exists to keep visible. */
const DELIBERATE_CANCEL_ERRORS_SQL =
  `('${MAIL_RUN_CLOSED_ERROR}','${MAIL_RECLAIM_CANCELLED_ERROR}','${MAIL_REBIND_SUPERSEDED_ERROR}')`;
```

- [ ] **Step 4: Generalise the re-queue by role**

In `server/src/coord/store.ts`, beside the other exported types:

```ts
/** WHOSE undelivered mail a re-queue is moving, and to which scope. A
 *  CORRELATED union rather than two loose parameters: the coordinator arm is
 *  scoped to a PROGRAMME (a chair is a programme's), the worker arm to a RUN (a
 *  worker is a run's), and a `role` beside an independent scope would admit two
 *  combinations that mean nothing. */
export type RequeueRole =
  | { role: 'coordinator'; program: string }
  | { role: 'worker'; runId: number };
```

Rename `requeueAbandonedCoordinatorMail` to `requeueAbandonedMail`, keep every existing docstring paragraph (they document the coordinator arm and stay true of it), and add this paragraph plus the role branches. The multi-line-signature exemption comment above it stays exactly as written — this method is still not a delivery-row writer in `mail-hardening.test.ts`'s census sense.

```ts
  /**
   * PARAMETERISED BY ROLE (design 2026-09-08 §4), and the role varies FOUR
   * things, which is more than the spec's "one method, parameterised by role"
   * suggests and is what its own two sentences require:
   *   `m.toId` — the literal the mail was addressed to.
   *   the SCOPE clause — `rr.program = ?` for a chair, `m.runId = ?` for a
   *     worker. A chair belongs to a programme; a worker belongs to one run.
   *   the SOURCE predicate — `ABANDONED_PARK_SQL` for the coordinator (arm (e)
   *     of `reclaimProgram`'s ruling: the parks the lane had already given up
   *     on, because `repointCoordinatorMail` has already moved the outstanding
   *     ones), and `OUTSTANDING_STATES_SQL` for the worker (there is no
   *     repoint on that path, so the outstanding rows are exactly what a
   *     replacement must inherit).
   *   whether the predecessor's row is PARKED — no for the coordinator, whose
   *     source rows are already terminal and stay exactly as they are; yes for
   *     the worker, because an outstanding row left naming the predecessor
   *     would have the sweep go on injecting a superseded message.
   * The name still says "Abandoned", which is true of the coordinator arm only.
   */
  private requeueAbandonedMail(
    role: RequeueRole, to: string, displaced: readonly string[],
  ): number {
    const source = role.role === 'coordinator'
      ? ABANDONED_PARK_SQL : `d.state IN ${OUTSTANDING_STATES_SQL}`;
    const scope = role.role === 'coordinator' ? 'rr.program = ?' : 'm.runId = ?';
    const scopeArg: string | number = role.role === 'coordinator' ? role.program : role.runId;
    const rows = this.db.prepare(
      'SELECT m.id AS mailId, m.fromId AS fromId, m.kind AS kind, m.subject AS subject, ' +
      'm.body AS body, m.artifacts AS artifacts, m.runId AS runId, ' +
      'rr.program AS program, rr.wave AS wave, rr.waveOf AS waveOf ' +
      'FROM mail_deliveries d JOIN mail m ON m.id = d.mailId ' +
      'JOIN runs rr ON rr.id = m.runId ' +
      `WHERE ${source} AND d.toId IN (${placeholders(displaced.length)}) ` +
      `AND m.toId = '${role.role}' AND ${scope} ` +
      'AND NOT EXISTS (SELECT 1 FROM mail_deliveries x ' +
      `WHERE x.mailId = m.id AND x.toId = ? AND x.state IN ${OUTSTANDING_STATES_SQL}) ` +
      'GROUP BY m.id ORDER BY MIN(d.id)',
    ).all(...displaced, scopeArg, to) as {
      mailId: number; fromId: string; kind: string; subject: string; body: string;
      artifacts: string; runId: number; program: string; wave: number; waveOf: number | null;
    }[];
```

(`'${role.role}'` is interpolated rather than bound because the surrounding query already interpolates `ABANDONED_PARK_SQL` and `OUTSTANDING_STATES_SQL`, and `role.role` is a closed union of two literals declared in this file — there is no caller-supplied text anywhere in this string.)

After the existing `for (const r of rows) { … }` loop and before `return rows.length;`, add the worker arm's park:

```ts
    // THE PREDECESSOR'S ROWS, PARKED — worker only. The coordinator arm's
    // source rows are already terminal (`ABANDONED_PARK_SQL`), and arm (c) of
    // `reclaimProgram`'s ruling says a park is never moved or reopened; this
    // arm's source rows are OUTSTANDING, and one left naming the predecessor
    // would have `sweepMail` go on injecting a message the heir has already
    // been sent a fresh copy of. Scoped to the mails this call actually
    // re-issued, so a row it declined to move (the `NOT EXISTS` dedupe) is not
    // parked by a statement that did nothing for it.
    if (role.role === 'worker' && rows.length > 0) {
      this.db.prepare(
        "UPDATE mail_deliveries SET state = 'rejected', rejectCode = 'undeliverable', " +
        `lastError = '${MAIL_REBIND_SUPERSEDED_ERROR}' ` +
        `WHERE state IN ${OUTSTANDING_STATES_SQL} AND toId IN (${placeholders(displaced.length)}) ` +
        `AND mailId IN (${placeholders(rows.length)})`,
      ).run(...displaced, ...rows.map((r) => r.mailId));
    }
    return rows.length;
```

and the call site (`:744`):

```ts
        this.requeueAbandonedMail({ role: 'coordinator', program: run.program }, to, displaced);
```

- [ ] **Step 5: The funnel**

In `server/src/coord/store.ts`, replace `setSession` (`:1304`–`:1306`) — keeping its whole existing docstring, which is still true of what it does — with a delegation, and add `bindSession` above it:

```ts
  /**
   * THE ONE WRITER OF `runs.sessionId` (design 2026-09-08 §4).
   *
   * Two writers existed before this: `setSession` (the open route's wave-N>=2
   * reclaim, and the fresh-spawn arm of dispatch) and `markDispatched`. Each
   * was an unconditional UPDATE, so the day a recovery re-binds a live run — a
   * held workspace reaped, a fresh `ws-add` into the same run — the mail
   * already addressed to the outgoing occupant would sit in a mailbox nobody
   * reads, and `sweepMail` would go on injecting it there.
   *
   * SAID HONESTLY: NO ROUTE RE-BINDS A LIVE RUN TODAY. The fresh-spawn arm runs
   * only when `run.sessionId` is null (`dispatch.ts`) and the resume arm reuses
   * the id it finds, so the `rebound` branch below is reached by the store test
   * that drives it directly and by nothing else. The funnel exists so that when
   * such a recovery is written, the promise holds without anyone remembering to
   * add it — which is the same reason `bindSession` returns what it did rather
   * than `void`: a caller that cannot see a re-issue cannot report one.
   *
   * NO `tx()` OF ITS OWN. `DatabaseSync` transactions do not nest, and
   * `markDispatched` reaches this from inside `commitDispatch`'s transaction.
   * Every statement here is synchronous and nothing can interleave between
   * them, the property this whole class rests on.
   */
  bindSession(runId: number, sessionId: string): { rebound: boolean; reissued: number } {
    const row = this.db.prepare('SELECT sessionId FROM runs WHERE id = ?')
      .get(runId) as { sessionId: string | null } | undefined;
    const predecessor = row?.sessionId ?? null;
    this.db.prepare('UPDATE runs SET sessionId = ? WHERE id = ?').run(sessionId, runId);
    // NULL is a FIRST bind, not a re-bind, and it re-issues nothing: there is no
    // predecessor to inherit from, and every wave-1 dispatch on the box lands
    // here. The same-session case is a re-statement, not a change of occupant.
    if (predecessor === null || predecessor === sessionId) return { rebound: false, reissued: 0 };
    const reissued = this.requeueAbandonedMail({ role: 'worker', runId }, sessionId, [predecessor]);
    return { rebound: true, reissued };
  }

  /**
   * Deviation (found while executing Task 9; not in the plan's own Task 9
   * File Structure entry, which named only `routes.ts` — see the plan's D-45):
   * `POST /api/runs`'s body may name an existing workspace (`sessionId?`,
   * wave N>=2 reclaiming the workspace it held since wave 1) and the OPEN
   * route places the hold immediately — spec:120-123, "When sessionId names
   * an existing workspace, places the hold immediately." Task 9's dispatch
   * route then needs to read `run.sessionId` back OFF THE ROW to decide
   * `CCD_ARGV.wsAdd` vs `CCD_ARGV.ensure` (D-1: "No sessionId on the run ->
   * ws-add; otherwise -> ensure") — but `openRun`'s own signature never took
   * a `sessionId`, and no writer of the column existed for anything but
   * `markDispatched` (a DISPATCH-time write that also stamps
   * `dispatchedAt`/`resumed`, both false of an open-time claim). This is the
   * matching open-time write, on `foldPrLineage`/`setHandoffCommit`'s single-
   * column-`UPDATE` pattern, deliberately NOT touching `dispatchedAt` or
   * `resumed` — a run whose wave N>=2 open just reclaimed its workspace has
   * not been dispatched yet, and must not read as though it had.
   *
   * AMENDED (design 2026-09-08 §4): the single-column `UPDATE` moved into
   * `bindSession` above, which is now the one writer of this column. Every
   * sentence in the paragraph above is still true of what this method DOES;
   * what changed is only where the statement lives.
   */
  setSession(runId: number, sessionId: string): void {
    // Delegated, not re-implemented: `bindSession` above is the one writer of
    // this column. This method keeps its name and its `void` return because its
    // two callers act on nothing — the open route and the fresh-spawn arm both
    // bind a run that names no session yet, where `bindSession`'s answer is
    // always `{rebound:false, reissued:0}`.
    this.bindSession(runId, sessionId);
  }
```

and `markDispatched` (`:1426`–`:1428`):

```ts
    // The session goes through the funnel; the other four columns are this
    // method's own single UPDATE, exactly as before. Splitting the statement is
    // what makes `bindSession` the ONE writer of `sessionId` — a claim
    // `coord-store.test.ts` scans this file for rather than trusting.
    this.bindSession(runId, sessionId);
    this.db.prepare(
      'UPDATE runs SET workspace = ?, branch = ?, resumed = ?, dispatchedAt = ? WHERE id = ?',
    ).run(workspace, branch, resumed ? 1 : 0, at, runId);
```

- [ ] **Step 6: Run green, then measure all four mutation halves**

Run: `cd server && ./node_modules/.bin/vitest run test/coord-store.test.ts`
Expected: PASS.

(a) The heir gets no fresh row. Change `bindSession`'s re-issue line to `const reissued = 0;` and re-run:
Expected: FAIL — "re-binding to a DIFFERENT session gives the heir a freshly rendered row and parks the predecessor", `expected [] to have a length of 1`. Restore.

(b) The predecessor is not parked. Delete the `if (role.role === 'worker' && rows.length > 0) { … }` block and re-run:
Expected: FAIL — the same case, `expected 'queued' to be 'rejected'`, and the `outstandingMailFor('demo-worker')` assertion. Restore.

(c) The envelope names the corpse. In the loop's `renderEnvelope` call, change `toId: to` to `toId: r.fromId` and re-run:
Expected: FAIL — the same case, on the envelope assertion: `expected 'to: demo-coordinator\nack: ccrc-api mail ack 2\n' to contain 'to: demo-heir'`. Restore.

(d) An old writer bypasses the funnel. Restore `markDispatched`'s original combined UPDATE (`'UPDATE runs SET sessionId = ?, workspace = ?, …'`) and delete its `bindSession` call, then re-run:
Expected: FAIL — "runs.sessionId has exactly ONE writer in the store, and it is bindSession", `expected length 2 to be 1`. This is the only mutation of the four that no behavioural case catches, because no route re-binds a live run today — which is exactly why the scan exists. Restore.

- [ ] **Step 7: Follow the rename and the third park through the pins**

Run: `cd server && ./node_modules/.bin/vitest run test/single-definition.test.ts test/mail-hardening.test.ts test/coord-reclaim.test.ts test/coord-health.test.ts`

Expected: FAIL, and each red is a pin doing its job:
- `single-definition.test.ts` "setDeliveryEnvelope names every caller it has" — `the docstring does not name the in-file caller`. Fix: `:751`'s expectation becomes `.toContain('requeueAbandonedMail')`, and `setDeliveryEnvelope`'s own docstring in `store.ts` (`:2338`–`:2340`) names the renamed method.
- `single-definition.test.ts` "spells the deliberate-cancel pair ONCE" — the definition-shape regex (`:437`–`:439`) no longer matches. Fix it to the three-member form and rename the case, keeping BOTH anti-vacuity lines and adding one for the new literal:

```ts
  it('spells the deliberate-cancel SET once — the constant, never a hand-written SQL list', () => {
    const MEMBERS = '(run closed|coordinator reclaimed|recipient rebound)';
    const LIST = new RegExp(`\\(\\s*'${MEMBERS}'\\s*(?:,\\s*'${MEMBERS}'\\s*){1,2}\\)`);
    expect(LIST.test("NOT IN ('run closed','coordinator reclaimed') ")).toBe(true);
    expect(LIST.test("NOT IN ( 'coordinator reclaimed', 'run closed' )")).toBe(true);
    expect(LIST.test("NOT IN ('run closed','coordinator reclaimed','recipient rebound')")).toBe(true);
    expect(LIST.test("NOT IN ('run closed','recipient not in registry')")).toBe(false);

    const holders = ALL.filter((f) => LIST.test(readFileSync(f, 'utf8'))).map(rel).sort();
    expect(holders, 'a hand-written SQL list of the deliberate-cancel set').toEqual([]);

    const store = readFileSync(path.join(ccrcRoot, 'server/src/coord/store.ts'), 'utf8');
    expect(store).toMatch(
      /const DELIBERATE_CANCEL_ERRORS_SQL =\s*\n?\s*`\('\$\{MAIL_RUN_CLOSED_ERROR\}','\$\{MAIL_RECLAIM_CANCELLED_ERROR\}','\$\{MAIL_REBIND_SUPERSEDED_ERROR\}'\)`/);
    for (const name of ['MAIL_RUN_CLOSED_ERROR', 'MAIL_RECLAIM_CANCELLED_ERROR',
                        'MAIL_REBIND_SUPERSEDED_ERROR']) {
      const defs = ALL.filter((f) =>
        new RegExp(`^\\s*export const ${name}\\b`, 'm').test(readFileSync(f, 'utf8'))).map(rel);
      expect(defs, name).toEqual(['server/src/coord/store.ts']);
    }
    expect((store.match(/NOT IN \$\{DELIBERATE_CANCEL_ERRORS_SQL\}/g) ?? []).length)
      .toBeGreaterThanOrEqual(2);
  });
```

- `single-definition.test.ts` "the re-queue's reader walk names every holder the file actually has" — reds because the passage still spells the old name. `holdersOf` (`server/test/single-definition.test.ts:766`) is DECLARATION-scoped and deduplicates with `new Set`, so this is a RENAME, not an addition: Task 6's two new interpolations of `${OUTSTANDING_STATES_SQL}` — the `source` ternary's worker branch and the predecessor-park `UPDATE`'s `WHERE state IN` clause — both sit inside `requeueAbandonedMail`'s own body, between it and the next 2-space-indented declaration, so the scan reports exactly ONE name for all three interpolations, not three. In `server/src/coord/store.ts`, inside the reader-walk docstring (between `THE READERS OF BOTH PREDICATES WERE WALKED` and `BOUNDED by the role-addressed reports`), change:

```
   *   `requeueAbandonedCoordinatorMail` — this method's own `NOT EXISTS` dedupe,
   *     above.
```

to:

```
   *   `requeueAbandonedMail` — this method's own `NOT EXISTS` dedupe, above.
   *     Reached on BOTH role branches: the worker arm's `source` line and its
   *     own copy of this same dedupe clause are two further interpolations of
   *     the same predicate, inside this same method body, so the derived scan
   *     still reports ONE holder for it, not three.
```

- `mail-hardening.test.ts` (`:505`, `:519`) — comments only, no assertion; update both to the new name so the census's own explanation stays true.
- `coord-reclaim.test.ts` and `coord-health.test.ts` — should PASS untouched; the coordinator arm's behaviour is byte-identical. If either reds, the generalisation changed the coordinator arm and must be corrected rather than the test.

Also update `server/test/coord-store.test.ts`'s three reach sites verbatim — the cast and both calls (`:1987`–`:1995`) and the throw-patch (`:2139`–`:2140`):

```ts
    const reach = s as unknown as {
      requeueAbandonedMail: (role: { role: 'coordinator'; program: string },
                             to: string, d: readonly string[]) => number;
    };

    expect(reach.requeueAbandonedMail({ role: 'coordinator', program: 'build4' }, LIVE, [DEAD])).toBe(2);
    // Again, with nothing left to move: the `NOT EXISTS` guard sees the two rows
    // the first call minted, so the answer is 0 rather than 2 a second time —
    // which is also why the number cannot be pinned as a constant.
    expect(reach.requeueAbandonedMail({ role: 'coordinator', program: 'build4' }, LIVE, [DEAD])).toBe(0);
```

and the throw-patch (`:2139`–`:2140`):

```ts
    const patched = s as unknown as { requeueAbandonedMail: () => void };
    patched.requeueAbandonedMail = () => { throw new Error('requeue failed'); };
```

Re-run all four suites: Expected PASS.

- [ ] **Step 8: Run the whole coordination neighbourhood**

Run: `cd server && ./node_modules/.bin/vitest run test/coord-store.test.ts test/coord-reclaim.test.ts test/coord-health.test.ts test/mail-sweep.test.ts test/mail-hardening.test.ts test/mail-routes.test.ts test/run-routes.test.ts test/single-definition.test.ts test/reclaim-route.test.ts test/typecheck-tests.test.ts`
Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add server/src/coord/store.ts server/test/coord-store.test.ts \
  server/test/single-definition.test.ts server/test/mail-hardening.test.ts
git commit -m "feat(coord): one funnel writes runs.sessionId, and a replacement occupant inherits its mail"
```

---

### Task 7: the programme filters — `GET /api/mail?program=` and `GET /api/feed?program=`

**Files:**
- Modify: `server/src/coord/store.ts` — new `mailForProgram` after `outstandingMailFor` (`:2190`–`:2198`), new `feedEventsForProgram` after `feedEvents` (`:2799`–`:2811`)
- Modify: `server/src/coord/routes.ts` — `GET /api/mail` (`:836`–`:849`), `GET /api/feed` (`:1610`–`:1615`) and its docstring (`:1601`–`:1609`)
- Test: `server/test/coord-store.test.ts`, `server/test/run-routes.test.ts`

**Interfaces:**
- Consumes: `feed_events.runId` and `NotifyEvent.runId` (Task 3); `resolveWorker` is NOT used here.
- Produces:
  - `CoordStore.mailForProgram(program: string, opts: { limit?: number; all?: boolean }): MailSummary[]`.
  - `CoordStore.feedEventsForProgram(program: string, limit: number): NotifyEvent[]`.
  - `GET /api/mail?program=<slug>[&all=1][&limit=]` — `to` becomes OPTIONAL when `program` is given; exactly one of the two is required.
  - `GET /api/feed?program=<slug>[&limit=]`.

**Spec:** §4 ("The programme filter" — the join, `to` optional, `all` as today, the feed's own filter, and "Events without one are programless and appear only unfiltered"), §7 row "programme filter", §9 wave 1.

**Mutation table:** row "programme filter" (spec §7) — red when a programless mail or a programless event appears under a filter, and red when another programme's row does. Measured in Step 5.

Anchor quotes. `server/src/coord/store.ts:2190`–`:2198`:

```ts
  outstandingMailFor(toId: string, limit = 100): MailSummary[] {
    const n = clampMailLimit(limit);
    const rows = this.db.prepare(
      `SELECT ${MAIL_ROW_COLUMNS} FROM mail_deliveries d JOIN mail m ON m.id = d.mailId ` +
      'LEFT JOIN runs rr ON rr.id = m.runId ' +
      `WHERE d.toId = ? AND ${OUTSTANDING_OR_ABANDONED_SQL} ORDER BY d.id DESC LIMIT ?`,
    ).all(toId, n) as unknown as MailRowDb[];
    return this.hydrateMail(rows);
  }
```

`server/src/coord/routes.ts:841`–`:848`:

```ts
    const q = req.query as { to?: unknown; limit?: unknown; all?: unknown };
    if (typeof q.to !== 'string' || q.to.trim() === '') {
      return reply.code(400).send({ ok: false, error: 'bad-request' });
    }
    const limit = typeof q.limit === 'string' ? Number(q.limit) : undefined;
    const all = q.all === '1' || q.all === 'true';
    const mail = all ? coord.mailForRecipient(q.to, limit) : coord.outstandingMailFor(q.to, limit);
    return reply.code(200).send({ ok: true, mail });
```

`server/src/coord/routes.ts:1610`–`:1615`:

```ts
  app.get('/api/feed', async (req, reply) => {
    if (!deps.coord) return notConfigured(reply);
    const q = req.query as { limit?: string };
    const limit = Number(q.limit);
    return { events: deps.coord.feedEvents(limit) };
  });
```

- [ ] **Step 1: Write the failing store tests**

In `server/test/coord-store.test.ts`:

```ts
describe('the programme filters', () => {
  /** Two programmes, one mail each, plus one mail and one event that belong to
   *  no run at all — the population every assertion below turns on. */
  const seeded = () => {
    const s = new CoordStore(openCoordDb(path.join(mkTmp('ccrc-coord-'), '.ccrc', 'coord.db')));
    const mk = (program: string, project: string, claimedBy: string): number => {
      const r = s.openRun({ program, title: program, project, wave: 1, waveOf: 1, claimedBy });
      if ('refused' in r) throw new Error('open refused');
      s.setSession(r.id, `${project}-worker`);
      return r.id;
    };
    const mine = mk('build4', 'demo', 'demo-coordinator');
    const theirs = mk('build5', 'other-project', 'other-project-coordinator');
    const mail = (runId: number | null, subject: string): void => {
      tx(s.db, () => {
        const m = s.insertMail({ fromId: 'demo-quiet-mesa', fromUuid: 'u', toId: 'coordinator',
          runId, kind: 'status', subject, body: 'b', artifacts: [] });
        const d = s.queueDelivery(m.id, 'demo-coordinator', '');
        s.setDeliveryEnvelope(d.id, `to: demo-coordinator\nack: ccrc-api mail ack ${d.id}\n`);
        return m;
      });
    };
    mail(mine, 'ours');
    mail(theirs, 'theirs');
    mail(null, 'peer chatter');           // programless — no run at all
    s.recordFeedEvent('e', { seq: 1, at: 1, kind: 'run', sessionId: 'demo-worker',
      title: 'ours', body: '', runId: mine });
    s.recordFeedEvent('e', { seq: 2, at: 2, kind: 'run', sessionId: 'other-project-worker',
      title: 'theirs', body: '', runId: theirs });
    s.recordFeedEvent('e', { seq: 3, at: 3, kind: 'ask', sessionId: 'demo-worker',
      title: 'a question', body: '', runId: null });
    return s;
  };

  it('mailForProgram answers this programme only — a programless mail is not in it, nor another programmeial row', () => {
    const s = seeded();
    expect(s.mailForProgram('build4', {}).map((m) => m.subject)).toEqual(['ours']);
    expect(s.mailForProgram('build5', {}).map((m) => m.subject)).toEqual(['theirs']);
  });

  it('mailForProgram honours `all` exactly as the recipient read does', () => {
    const s = seeded();
    // Park the one row this programme has; the default read drops a deliberate
    // cancel, `all` returns history.
    s.cancelOutstandingDeliveries(s.runs()[0]!.id);
    expect(s.mailForProgram('build4', {})).toHaveLength(0);
    expect(s.mailForProgram('build4', { all: true }).map((m) => m.subject)).toEqual(['ours']);
  });

  it('feedEventsForProgram answers this programme only — a programless event is not in it', () => {
    const s = seeded();
    expect(s.feedEventsForProgram('build4', 100).map((e) => e.title)).toEqual(['ours']);
    expect(s.feedEventsForProgram('build5', 100).map((e) => e.title)).toEqual(['theirs']);
    // …and the unfiltered read still carries all three, which is where a
    // programless event belongs and the ONLY place it appears.
    expect(s.feedEvents(100).map((e) => e.title)).toEqual(['ours', 'theirs', 'a question']);
  });
});
```

- [ ] **Step 2: Write the failing route tests**

In `server/test/run-routes.test.ts`:

```ts
describe('the programme filters on the two GET routes', () => {
  let app: FastifyInstance | undefined;
  afterEach(async () => { if (app) await app.close(); app = undefined; });

  /** Two programmes, one mail and one event each, plus one mail and one event
   *  that belong to no run at all. Written against `w.coord` directly: this
   *  suite has no fixture for mail rows, and the four statements are the whole
   *  population every assertion below turns on. */
  const seedTwoProgrammes = (coord: CoordStore): void => {
    const mk = (program: string, project: string, claimedBy: string): number => {
      const r = coord.openRun({ program, title: program, project, wave: 1, waveOf: 1, claimedBy });
      if ('refused' in r) throw new Error('open refused');
      coord.setSession(r.id, `${project}-worker`);
      return r.id;
    };
    const mine = mk('build4', 'demo', 'demo-coordinator');
    const theirs = mk('build5', 'other-project', 'other-project-coordinator');
    const mail = (runId: number | null, subject: string): void => {
      tx(coord.db, () => {
        const m = coord.insertMail({ fromId: 'demo-quiet-mesa', fromUuid: 'u', toId: 'coordinator',
          runId, kind: 'status', subject, body: 'b', artifacts: [] });
        const d = coord.queueDelivery(m.id, 'demo-coordinator', '');
        coord.setDeliveryEnvelope(d.id, `to: demo-coordinator\nack: ccrc-api mail ack ${d.id}\n`);
        return m;
      });
    };
    mail(mine, 'ours');
    mail(theirs, 'theirs');
    mail(null, 'peer chatter');
    coord.recordFeedEvent('e', { seq: 1, at: 1, kind: 'run', sessionId: 'demo-worker',
      title: 'ours', body: '', runId: mine });
    coord.recordFeedEvent('e', { seq: 2, at: 2, kind: 'run', sessionId: 'other-project-worker',
      title: 'theirs', body: '', runId: theirs });
    coord.recordFeedEvent('e', { seq: 3, at: 3, kind: 'ask', sessionId: 'demo-worker',
      title: 'a question', body: '', runId: null });
  };

  it('GET /api/mail?program= answers that programme, and `to` is no longer required', async () => {
    const home = mkTmp('ccrc-runs-');
    const { run } = makeRunner(home);
    const w = await openApp(home, run); app = w.app;
    seedTwoProgrammes(w.coord);
    const res = await app.inject({ method: 'GET', url: '/api/mail?program=build4',
      headers: tokenHeaders(TOKEN) });
    expect(res.statusCode).toBe(200);
    expect((res.json() as { mail: { subject: string }[] }).mail.map((m) => m.subject)).toEqual(['ours']);
  });

  it('GET /api/mail?to= is unchanged, and still sees the programless mail', async () => {
    // The anti-vacuity half: a filter that answered nothing would pass the case
    // above only if this one caught it. `peer chatter` has no run and is
    // therefore in NO programme's list and in every mailbox it was sent to.
    const home = mkTmp('ccrc-runs-');
    const { run } = makeRunner(home);
    const w = await openApp(home, run); app = w.app;
    seedTwoProgrammes(w.coord);
    const res = await getMail(app, 'demo-coordinator');
    expect(res.statusCode).toBe(200);
    expect((res.json() as { mail: { subject: string }[] }).mail.map((m) => m.subject).sort())
      .toEqual(['ours', 'peer chatter', 'theirs']);
  });

  it('GET /api/mail with neither `to` nor `program` is still a bad request', async () => {
    const home = mkTmp('ccrc-runs-');
    const { run } = makeRunner(home);
    const w = await openApp(home, run); app = w.app;
    const res = await app.inject({ method: 'GET', url: '/api/mail', headers: tokenHeaders(TOKEN) });
    expect(res.statusCode).toBe(400);
  });

  it('GET /api/feed?program= answers that programme, and the unfiltered read is unchanged', async () => {
    const home = mkTmp('ccrc-runs-');
    const { run } = makeRunner(home);
    const w = await openApp(home, run); app = w.app;
    seedTwoProgrammes(w.coord);
    const filtered = await app.inject({ method: 'GET', url: '/api/feed?program=build4' });
    expect((filtered.json() as { events: { title: string }[] }).events.map((e) => e.title))
      .toEqual(['ours']);
    const all = await app.inject({ method: 'GET', url: '/api/feed' });
    expect((all.json() as { events: { title: string }[] }).events.map((e) => e.title))
      .toEqual(['ours', 'theirs', 'a question']);
  });
});
```

`CoordStore` is already imported (`:14`); `tx` is NOT — change `:13` to `import { openCoordDb, tx } from '../src/coord/db.js';`. `tokenHeaders` (`:133`) and `getMail` (`:156`–`:160`) are this suite's own helpers.

- [ ] **Step 3: Run to verify they fail**

Run: `cd server && ./node_modules/.bin/vitest run test/coord-store.test.ts test/run-routes.test.ts`
Expected: FAIL — `TypeError: s.mailForProgram is not a function` and `s.feedEventsForProgram is not a function`; `GET /api/mail?program=build4` answers 400 (`to` still required); `GET /api/feed?program=build4` answers all three events.

- [ ] **Step 4: The two store listings**

In `server/src/coord/store.ts`, after `outstandingMailFor` (`:2198`):

```ts
  /**
   * Every delivery of a mail belonging to THIS PROGRAMME (design §4), newest
   * first — the read side of `GET /api/mail?program=<slug>`.
   *
   * The join is the one `resolveCoordinator` already walks: `mail.runId` →
   * `runs.program`. An INNER join, deliberately, and it is the whole filter: a
   * mail with no `runId` cannot be PROVEN to belong to any programme — the
   * resolution that placed it is spent, and no column records which programme
   * the sender meant (D-1142's own measurement on `repointCoordinatorMail`) —
   * so it drops out here and appears only in the unfiltered reads. Guessing it
   * into a programme would be this store deciding a thing it cannot measure.
   *
   * `all` mirrors `GET /api/mail?to=`'s own flag exactly, so one word means one
   * thing on both filters: default is "still needs a human's attention"
   * (`OUTSTANDING_OR_ABANDONED_SQL`), `all` is the unfiltered history. The
   * `LEFT JOIN runs rr` the predicate needs is the SAME join the filter uses —
   * `ABANDONED_PARK_SQL` reads `COALESCE(rr.state, '')` precisely so it is
   * indifferent to the join kind its caller brings — so this query needs one
   * join, not two.
   */
  mailForProgram(program: string, opts: { limit?: number; all?: boolean }): MailSummary[] {
    const n = clampMailLimit(opts.limit ?? 100);
    const where = opts.all === true
      ? 'rr.program = ?' : `rr.program = ? AND ${OUTSTANDING_OR_ABANDONED_SQL}`;
    const rows = this.db.prepare(
      `SELECT ${MAIL_ROW_COLUMNS} FROM mail_deliveries d JOIN mail m ON m.id = d.mailId ` +
      'JOIN runs rr ON rr.id = m.runId ' +
      `WHERE ${where} ORDER BY d.id DESC LIMIT ?`,
    ).all(program, n) as unknown as MailRowDb[];
    return this.hydrateMail(rows);
  }
```

and after `feedEvents` (`:2811`):

```ts
  /**
   * `GET /api/feed?program=<slug>`'s reader — the events of one programme,
   * oldest-first and clamped exactly as `feedEvents` clamps its own, through
   * the `feed_events.runId` migration 9 added.
   *
   * The INNER join to `runs` is the filter, and it is why a programless event —
   * an `ask`, a `done`, a `merged`, a `coord`, every kind that is about a
   * SESSION rather than a run — never appears here. That is not a gap: those
   * events belong to no programme, and the unfiltered `feedEvents` above is
   * where they live. A row whose `runId` names a run that has since been
   * deleted would drop too; nothing in this tree deletes a run.
   */
  feedEventsForProgram(program: string, limit: number): NotifyEvent[] {
    const n = Number.isFinite(limit) && limit > 0
      ? Math.min(Math.floor(limit), CoordStore.FEED_RETENTION)
      : CoordStore.FEED_RETENTION;
    const rows = this.db.prepare(
      'SELECT f.seq AS seq, f.at AS at, f.kind AS kind, f.sessionId AS sessionId, ' +
      'f.title AS title, f.body AS body, f.runId AS runId FROM (' +
      'SELECT * FROM feed_events WHERE runId IN (SELECT id FROM runs WHERE program = ?) ' +
      'ORDER BY id DESC LIMIT ?) f ORDER BY f.id ASC',
    ).all(program, n) as { seq: number; at: number; kind: string; sessionId: string;
                           title: string; body: string; runId: number | null }[];
    return rows.map((r) => ({
      seq: r.seq, at: r.at, kind: isNotifyKind(r.kind) ? r.kind : 'unknown', sessionId: r.sessionId,
      title: r.title, body: r.body, runId: r.runId,
    }));
  }
```

- [ ] **Step 5: The two routes**

`GET /api/mail` (`:841`–`:848`):

```ts
    const q = req.query as { to?: unknown; program?: unknown; limit?: unknown; all?: unknown };
    const to = typeof q.to === 'string' && q.to.trim() !== '' ? q.to : null;
    const program = typeof q.program === 'string' && q.program.trim() !== '' ? q.program : null;
    // EXACTLY ONE, and neither is a default for the other: `to` is a MAILBOX
    // (what one session was actually sent) and `program` is a THREAD (what one
    // programme has said), and a request that named both would be asking two
    // different questions in one call. Neither is still a bad request, exactly
    // as it was before `program` existed.
    if ((to === null) === (program === null)) {
      return reply.code(400).send({ ok: false, error: 'bad-request' });
    }
    const limit = typeof q.limit === 'string' ? Number(q.limit) : undefined;
    const all = q.all === '1' || q.all === 'true';
    const mail = program !== null
      ? coord.mailForProgram(program, { limit, all })
      : all ? coord.mailForRecipient(to!, limit) : coord.outstandingMailFor(to!, limit);
    return reply.code(200).send({ ok: true, mail });
```

`GET /api/feed` (`:1601`–`:1615`), docstring and body:

```ts
  /**
   * `GET /api/feed?limit=<n>[&program=<slug>]` (Task 10, orchestrator-added
   * scope: PR J interface 5; the programme filter is cross-repo programmes' —
   * design §4) — the durable archive behind `NotifyLog`'s in-memory ring,
   * oldest-first. Survives both a ring eviction (the ring keeps only the
   * newest 200, `notifylog.ts`'s `RING`) and a restart (a fresh `NotifyLog`
   * mints a new epoch and an empty ring; this table is untouched by either).
   * `limit` clamping is `CoordStore.feedEvents`'s own job, not repeated here
   * — same division of labour as `GET /api/runs`'s `closed` flag above.
   *
   * `program` filters through `feed_events.runId` (migration 9). An event that
   * names no run is PROGRAMLESS and appears only in the unfiltered read, which
   * is this route without the parameter — a `done` or an `ask` is about a
   * session, not about a programme.
   */
  app.get('/api/feed', async (req, reply) => {
    if (!deps.coord) return notConfigured(reply);
    const q = req.query as { limit?: string; program?: string };
    const limit = Number(q.limit);
    const program = typeof q.program === 'string' && q.program.trim() !== '' ? q.program : null;
    return { events: program === null
      ? deps.coord.feedEvents(limit)
      : deps.coord.feedEventsForProgram(program, limit) };
  });
```

- [ ] **Step 6: Run green, then measure the filter**

Run: `cd server && ./node_modules/.bin/vitest run test/coord-store.test.ts test/run-routes.test.ts`
Expected: PASS.

Mutation (a) — the mail join widened. Change `mailForProgram`'s `'JOIN runs rr ON rr.id = m.runId '` to `'LEFT JOIN runs rr ON rr.id = m.runId '` and its `where` to `'(rr.program = ? OR rr.program IS NULL)'`, then re-run:
Expected: FAIL — "mailForProgram answers this programme only", `expected [ 'ours', 'peer chatter' ] to deeply equal [ 'ours' ]`. Restore.

Mutation (b) — the feed filter dropped. Change the route's ternary to `deps.coord.feedEvents(limit)` unconditionally and re-run `run-routes.test.ts`:
Expected: FAIL — "GET /api/feed?program= answers that programme", `expected [ 'ours', 'theirs', 'a question' ] to deeply equal [ 'ours' ]`. Restore.

Mutation (c) — `to` no longer required. Change the route's guard to `if (to === null && program === null)` and re-run:
Expected: PASS, which is why that is NOT the mutation this row measures — both-given is a shape question, not a filter one, and the `(to === null) === (program === null)` form is chosen for it deliberately. Restore the guard and note that its own coverage is the "neither" case above.

- [ ] **Step 7: Run the mail neighbours**

Run: `cd server && ./node_modules/.bin/vitest run test/mail-routes.test.ts test/mail-sweep.test.ts test/sessionws.test.ts test/coord-routes-single-file.test.ts test/box-token-census.test.ts test/coord-pause-route.test.ts test/typecheck-tests.test.ts`
Expected: PASS. No route was added, removed or re-gated, so the census suites are untouched — this run is the proof of that rather than an assumption.

- [ ] **Step 8: Commit**

```bash
git add server/src/coord/store.ts server/src/coord/routes.ts \
  server/test/coord-store.test.ts server/test/run-routes.test.ts
git commit -m "feat(coord): mail and the feed can be read by programme, and a programless row never joins one"
```

---

### Task 8: `ccrc-api` — the mail row's new keys, the feed row, and the count that is scanned

**Files:**
- Modify: `ccd/ccrc-api` — the closed-surface bullet (`:24`), the ROUTES-table header (`:76`), `[mail.list]` (`:100`), a new `[feed.list]` row
- Modify: `server/test/ccrc-api.test.ts` — `ROWS` (`:191`–`:210`), the count (`:237`), the query-key describe's comment (`:403`–`:406`)

**Interfaces:**
- Consumes: `GET /api/mail?program=` and `GET /api/feed?program=` (Task 7).
- Produces: `ccrc-api mail list [--to|--program|--all|--limit]` and `ccrc-api feed list [--program|--limit]`. Bodies still travel only via `--json`; the table still holds every route this client can reach, and it now holds nineteen.

**Spec:** §4 ("`ccrc-api`'s closed table gains `--program` on `mail list` and a `feed list GET /api/feed [--program]` row — the table is the client's own contract and grows by a row, never by a URL argument — and its prose row count moves with it"), §7 row "`ccrc-api` table", §9 wave 1.

**Mutation table:** row "`ccrc-api` table" (spec §7) — red when `--program` on `mail list` or the `feed list` row is missing, or when the row-count sentence at `ccd/ccrc-api:24` is stale. Measured in Step 5.

Anchor quotes. `ccd/ccrc-api:24`:

```sh
#   * The route comes from ROUTES below, eighteen rows, and nothing else.
```

`ccd/ccrc-api:75`–`:77`:

```sh
# METHOD|path|needs-id|comma-separated query keys this row accepts (or `-`).
# Eighteen rows, and that word is SCANNED: `server/test/ccrc-api.test.ts` derives
# the count from the table below and reds if this line or the bullet at the top
```

`ccd/ccrc-api:100`–`:101`:

```sh
  [mail.list]='GET|/api/mail|no|to'
  [mail.send]='POST|/api/mail|no|-'
```

`server/test/ccrc-api.test.ts:234`–`:237`:

```ts
    // Eighteen since `runs items-list` landed. That row is NOT a widening of
    // the surface by imitation — it is the READ half of `runs items`, which
    // was unusable without it: settling needs ids and nothing published them.
    expect(keys).toHaveLength(18);
```

`server/test/ccrc-api.test.ts:403`–`:406`:

```ts
  // The corpora ask for four of these and no more: `to`, `project`, `session`,
  // `of`. Anything else is refused rather than appended, for the same reason the
  // path is a template and not an argument — a client that forwarded arbitrary
  // query keys would be a URL builder with extra steps.
```

- [ ] **Step 1: Write the failing tests**

In `server/test/ccrc-api.test.ts`, add the new row to `ROWS` (`:208`, beside the other GETs) and raise the count:

```ts
    [['ledger', 'list'], 'GET', '/api/ledger'],
    [['ledger', 'allocate'], 'POST', '/api/ledger/deviations'],
    // The durable feed, filterable by programme (cross-repo programmes §4). A
    // NEW ROW rather than a `--program` on some existing one: the table is the
    // client's own contract and grows by a row, never by a URL argument.
    [['feed', 'list'], 'GET', '/api/feed'],
  ];
```

```ts
    // Nineteen since `feed list` landed — the programme-scoped read of the
    // durable feed, which the coordinator corpus is about to name.
    expect(keys).toHaveLength(19);
```

and, inside `describe('a query key rides only if its row declared it')`, replace the stale comment and add two cases:

```ts
  // Every key any row declares, today: `to`, `program`, `all`, `limit` (mail
  // list), `of`/`project` (peers), `session` (lifecycle), `project`/`all`
  // (claims), `project` (ledger), `program`/`limit` (feed list). Anything else
  // is refused rather than appended, for the same reason the path is a template
  // and not an argument — a client that forwarded arbitrary query keys would be
  // a URL builder with extra steps.
```

```ts
  it('appends the programme filter on mail list', async () => {
    await run(['mail', 'list', '--program', 'build4']);
    expect(seen[0]!.url).toBe('/api/mail?program=build4');
  });

  it('exercises `all` and `limit` on mail list together — neither is a bare flag', async () => {
    // The generic `--*` arm (`:269`–`:277`) always consumes a VALUE — there is
    // no bare-flag form on this client — so `--all` rides as `--all 1`, exactly
    // like `GET /api/mail?to=`'s existing `all` key.
    await run(['mail', 'list', '--program', 'build4', '--all', '1', '--limit', '20']);
    expect(seen[0]!.url).toBe('/api/mail?program=build4&all=1&limit=20');
  });

  it('reaches the feed, filtered and limited', async () => {
    await run(['feed', 'list', '--program', 'build4', '--limit', '50']);
    expect(seen[0]!.url).toBe('/api/feed?program=build4&limit=50');
  });

  it('refuses a key feed list does not declare', async () => {
    const r = await run(['feed', 'list', '--to', 'demo-quiet-mesa']);
    expect(r.status).not.toBe(0);
    expect(seen).toHaveLength(0);
  });
```

- [ ] **Step 2: Run to verify they fail**

Run: `cd server && ./node_modules/.bin/vitest run test/ccrc-api.test.ts`

Expected: FAIL — the `feed list` row case (the client refuses `feed` as an unknown group, `expect(seen).toHaveLength(1)` fails with 0), "has exactly the rows exercised above" (`expected [...18] to deeply equal [...19]` and `expected length 18 to be 19`), "states the row count in prose" (`the closed-surface bullet states a row count this table does not have: expected 'eighteen' to be 'nineteen'` — it reads the CLIENT's table, so this one only reds after Step 3), "appends the programme filter on mail list" (`unknown-query`), and "exercises `all` and `limit` on mail list together" (`unknown-query` — `[mail.list]` still declares only `to`).

- [ ] **Step 3: Grow the table by a row, and say so twice**

In `ccd/ccrc-api`, the closed-surface bullet (`:24`):

```sh
#   * The route comes from ROUTES below, nineteen rows, and nothing else.
```

the ROUTES-table header (`:76`):

```sh
# Nineteen rows, and that word is SCANNED: `server/test/ccrc-api.test.ts` derives
```

`[mail.list]` (`:100`) and the new row beside the other reads:

```sh
  # `--program` joins through `runs.program`; `to` becomes optional once it is
  # given (routes.ts's own `(to === null) === (program === null)` guard, not
  # this client's). `--all` has no bare-flag form on this client — the generic
  # `--*` arm always consumes a value — so it rides as `--all 1`, exactly as
  # `GET /api/mail?to=`'s existing `all` key always has.
  [mail.list]='GET|/api/mail|no|to,program,all,limit'
```

```sh
  [ledger.allocate]='POST|/api/ledger/deviations|no|-'
  # The durable feed. `--program` filters through `feed_events.runId` and answers
  # one programme's events; without it the read is the whole box's, oldest-first.
  # An event that names no run is programless and appears only unfiltered.
  [feed.list]='GET|/api/feed|no|program,limit'
)
```

Both `--program` and `--limit` values pass `SAFE_RE` (`^[A-Za-z0-9_-]+$`) unchanged: a programme slug and an integer are both plain values, so nothing about the validator moves.

- [ ] **Step 4: Run green**

Run: `cd server && ./node_modules/.bin/vitest run test/ccrc-api.test.ts test/ccrc-api-closed.test.ts test/ccrc-api-ship.test.ts`
Expected: PASS, all three.

- [ ] **Step 5: Measure the row**

(a) Delete `program` from `[mail.list]`'s key list and re-run `test/ccrc-api.test.ts`:
Expected: FAIL — "appends the programme filter on mail list", the client refusing `unknown-query`. Restore.

(b) Delete the `[feed.list]` row and re-run:
Expected: FAIL — three cases: the `feed list -> GET /api/feed` row, "has exactly the rows exercised above" and "states the row count in prose". Restore.

(c) Revert the bullet at `:24` to "eighteen rows" and re-run:
Expected: FAIL — "states the row count in prose as the number the table actually holds", `the closed-surface bullet states a row count this table does not have: expected 'eighteen' to be 'nineteen'`. Restore. Repeat for the header at `:76` — the pin reads BOTH anchors, and each has to be measured, because a single-anchor fix would leave the other silently stale.

- [ ] **Step 6: Commit**

```bash
git add ccd/ccrc-api server/test/ccrc-api.test.ts
git commit -m "feat(ccrc-api): the mail row takes a programme, and the feed gets a row of its own"
```

---

### Task 9: the whole-suite gate, the deviation reconcile, and the agent-first deploy

**Files:**
- Modify: `docs/superpowers/plans/2026-09-08-crossrepo-wave1-server.md` — the `## Deviations found` section, with every `D-TBD-<slug>` this wave found (planning-time entries are already written below; execution-time ones are added here)
- Test: every suite in all three packages

**Interfaces:**
- Consumes: everything Tasks 1–8 produced.
- Produces: a branch whose three suites are green, a `## Deviations found` section the orchestrator can mint numbers against, and the two deploy commands in the order this wave requires.

**Spec:** §7 (the whole table, re-run together), §8 (deploy ordering, both scopes), §9 wave 1's closing.

**Mutation table:** no new guard; this task RUNS the ones the eight tasks above shipped.

- [ ] **Step 1: The server suite, in the foreground**

Run: `cd server && npm run test` (timeout 600000)

Expected: PASS, with the single deliberate exception of `test/dtbd.test.ts`, which is RED for as long as this plan's own `## Deviations found` section below carries concrete `D-TBD-<slug>` entries — it `git grep`s every TRACKED file for the literal pattern and this document is one of them. That red is Step 4's mechanism, not a break: do not "fix" it by deleting an entry, and do not treat this run as failing on that account alone. If any of `ccd-ws-gc`, `pr-sweep`, `session-hook`, `typecheck-tests` or `ccd-session-state` reds, re-run THAT FILE ALONE before treating it as a break — all five are known load flakes, and `ccd-session-state`'s window is `the supervisor heartbeat > a swap re-stamps while it carries`. A single green isolated run of `ccd-session-state` is not proof it was the load; CI on the quiet box is the arbiter.

Nothing in this wave touches `ccd/ccd`, `session-hook.sh` or the supervisor, so a red in any of those five is a load flake or a pre-existing break, never this branch's — check `git stash`-free by running the same file on `origin/main` if it repeats.

- [ ] **Step 2: The agent suite**

Run: `cd agent && npm run test` (timeout 600000)

Expected: PASS. This wave changes no agent frame and no `shared/agent-protocol.ts` vocabulary; the run is the proof of that.

- [ ] **Step 3: The PWA suite and its build**

Run: `cd pwa && npm run test` (timeout 600000)
Expected: PASS.

Run: `cd pwa && npm run build` (timeout 600000)
Expected: exit 0 — `tsc --noEmit` over `src`, `test` and `../shared`, then `vite build`. This is the only gate that compiles the PWA against `shared/api.ts`'s two new required fields, so it must be run even when the vitest run is green.

- [ ] **Step 4: The deviation reconcile, against `origin/main` and without merging**

Run:
```bash
git fetch origin main
cd server && ./node_modules/.bin/vitest run test/deviation-refs.test.ts
```

Expected: PASS. This compares this branch's `D-N` definitions against `origin/main`'s WITHOUT merging, and reds on any allocator-era number defined in two plans — the parallel-branch collision, measured rather than remembered. It cannot see the other shape (a plan defining a number nobody was issued), which is why this plan MINTS NOTHING: every deviation below is a `D-TBD-<slug>`, and the orchestrator issues and defines the numbers in one act.

Run: `cd server && ./node_modules/.bin/vitest run test/topology-clean.test.ts test/single-definition.test.ts`
Expected: PASS. `topology-clean` scans every tracked file including this document, so a real host, IP, tailnet name or account label anywhere in the plan reds here rather than at the pre-push hook.

Run: `cd server && ./node_modules/.bin/vitest run test/dtbd.test.ts`
Expected: **RED, and correctly so, for as long as this plan's `## Deviations found` section carries concrete `D-TBD-<slug>` placeholders.** That suite `git grep`s every TRACKED file for a concrete placeholder and fails the diff — which is exactly its job (build 9 D13): a session that cannot mint writes a placeholder and STOPS, and the red is what stops an invented number landing instead. The failure names every placeholder in this file. It goes green only after the orchestrator has MINTED a contiguous block (`POST /api/ledger/deviations`) and each entry below has been rewritten as `D-<n>` in the same act — allocate and DEFINE together, never one without the other. Do not "fix" this red by deleting an entry, and do not take a number from `GET /api/ledger`'s `floor`: that is what the next POST would mint, not a number anyone may take.

- [ ] **Step 5: Complete the deviation ledger**

Every deviation this wave discovered — the five written at plan time, plus any found while executing — is in `## Deviations found` below as a `D-TBD-<kebab-slug>` with a full entry: what the spec or the contract said, what was measured, what was done instead, and what it costs. Add execution-time findings there in the same shape and report them (worker clause 11); do not take a number from the allocator for them yourself unless the coordinator's brief says to, and never guess one from `GET /api/ledger`'s floor — that number is what the next POST would MINT, not one you may take.

```bash
git add docs/superpowers/plans/2026-09-08-crossrepo-wave1-server.md
git commit -m "docs(crossrepo): wave 1's deviation ledger, as found"
```

- [ ] **Step 6: Report the wave-done fingerprint**

Measure, do not recall: `git rev-parse HEAD` on this workspace's own branch is the handoff commit, and the done-fingerprint re-measures `handoffCommit === branchTip` against the WORKSPACE BRANCH. Do not open a feature branch — a feature branch wedges every close with `stale-tip`.

- [ ] **Step 7: The deploy, agent lane FIRST**

This wave is AGENT-FIRST: Tasks 1, 2, 4 and 8 change files under `ccd/` (`coordinator-skill/SKILL.md`, `coordinator-skill/references/wave-lifecycle.md`, `ccrc-api`), and the skill reaches a coordinator's home only once its installer has run there. Once the PR is merged, the operator or the coordinator runs, in this order:

```bash
bash deploy/deploy.sh agent <fleet-host>
bash deploy/deploy.sh
```

`deploy.sh` has NO default target for the agent lane and refuses with exit 2 rather than guessing; the coordinates live in `~/.ccrc/deploy.env`, machine-local and outside every checkout. Nothing in this plan runs either command.

Two orderings, two scopes, and both matter here:
- WITHIN this wave, the agent lane goes first, as every `ccd/` change does. The server lane's final gate is `/health` reporting the shipped sha.
- ACROSS waves, this wave must be deployed and LIVE before wave 2 ships, so the `project-mismatch` guard exists before the skill starts telling coordinators to cross repos (spec §8, §9).

Rollback, stated because the migration makes it a real question: rolling the SERVER lane back leaves both columns in place and `HOME_PROJECT_LEGACY_ACCEPTED`'s behaviour intact — an older build meeting `user_version 9` refuses to MIGRATE, never to READ (`db.ts:105`), and Task 3's own test pins that for these two columns. Rolling the SKILL lane back leaves a coordinator that never crosses, which is today.

---

## Deviations found

Eight, all found while PLANNING against `origin/main` `d0064e6e` — every one is a place where the spec's or the cross-wave contract's own words could not be followed exactly against the tree as it stands. **No number is minted here.** Each carries a `D-TBD-<kebab-slug>`; the orchestrator mints a contiguous block and defines the numbers into these entries in one act. `server/test/dtbd.test.ts` is RED until it does, which is the mechanism, not a problem to work around.

**D-2054** — the cross-wave contract puts both new `RunRefuseCode` members, and both skill sentences, in Task 1. Measured: `server/test/mail-routes.test.ts:421-431` runs a FORWARD scan — `for (const code of RUN_REFUSE_CODES) expect(src, code).toContain(`'${code}'`)` over every `.ts` under `server/src/coord` — so a code declared with no emitter reds that suite. `home-mismatch`'s first emitter is the home decision, which needs migration 9 and `programHome` beneath it; declaring it in Task 1 would leave the tree red for three consecutive tasks and make every intervening red-first measurement unreadable. So Task 1 declares and emits `project-mismatch` alone, and Task 4 declares and emits `home-mismatch` in its own commit, each with its own skill sentence and `wave-lifecycle.md` row. The contract's stated purpose — "so the skill test never reds mid-wave" — is met more strictly this way than by its own instruction: `coordinator-skill.test.ts` checks that every code that EXISTS is named, so a code that does not yet exist cannot red it. Cost: the two codes ship in two commits rather than one. Nothing else changes.

**D-2055** — the contract fixes `programHome(slug: string): string | null`. Measured: that signature answers `null` for two conditions the open route handles differently — a programme row whose `homeProject` IS NULL (which must be BACKFILLED and recorded as `home-project-backfilled`) and a slug with no programme row at all (which must record nothing, because `openRun`'s first insert writes the home). That is an overloaded null at a seam, which `CLAUDE.md` calls a defect rather than a style. Rather than change a contract three plans are written against, the route MEASURES existence separately (`coord.programs().some(p => p.slug === program)`) and passes `known` and `stored` as two inputs to `homeProjectVerdict`, so the two conditions never reach one value at a decision; `programHome`'s own docstring states the discipline. A measured variant (`{ known: boolean; home: string | null }`) would encode it in the type instead, and is the shape to reach for if a second caller ever appears. Recorded for a ruling.

**D-2056** — spec §3 F2 says the flip to required is "a one-constant change (`HOME_PROJECT_LEGACY_ACCEPTED` in `routes.ts`) whose test flips the constant and asserts both branches". Measured: a TypeScript `const` export cannot be flipped from a test — `vi.spyOn` cannot rebind a const export, and `vi.mock`ing `coord/routes.ts` to change one primitive would stub the module under test. So the DECISION is a pure exported function, `homeProjectVerdict`, whose `legacyAccepted` is a parameter; the route passes the constant at its one call site, and `server/test/home-project.test.ts` drives both branches for real. The spec's own property survives — wave 3's flip is still a one-constant change — and the branch that has never shipped is measured before it does. Cost: one exported function and one new test file that the spec did not name.

**D-2057** — spec §4 and the contract say `GET /api/mail?program=<slug>` makes `to` "optional when `program` is given", which leaves a request carrying BOTH undefined. Measured: `to` selects a MAILBOX (`mail_deliveries.toId`, what one session was actually sent) and `program` selects a THREAD (`runs.program`, what one programme has said); they are different questions with different joins, and honouring both would need an intersection nothing asked for while honouring one silently would make the other argument a lie. This plan requires EXACTLY ONE (`(to === null) === (program === null)` → 400), which is stricter than the spec's wording and than a literal reading of the contract. A caller sending both today gets a 400 rather than a silent preference. Recorded so the orchestrator can rule; loosening it later is additive, tightening it later would not be.

**D-2058** — spec §4 says the predecessor's row "is parked with the vocabulary that already exists". Measured: the existing deliberate-cancel vocabulary is two literals, `MAIL_RUN_CLOSED_ERROR = 'run closed'` and `MAIL_RECLAIM_CANCELLED_ERROR = 'coordinator reclaimed'` (`server/src/coord/store.ts:277,295`), and the second is FALSE of a worker whose run was re-bound — `lastError` reaches an operator through `MailSummary.lastError`, and a park that lies about why it parked is worse than no park. So a third constant, `MAIL_REBIND_SUPERSEDED_ERROR = 'recipient rebound'`, joins `DELIBERATE_CANCEL_ERRORS_SQL` — which is that constant's own documented extension point ("Every future 'this delivery was cancelled on purpose' park joins HERE"). Consequences that must ship with it: the list becomes a three-member interpolation, and `server/test/single-definition.test.ts`'s "spells the deliberate-cancel pair ONCE" pin (`:421`–`:449`) must be widened from a PAIR to a SET, in both its anti-vacuity premises and its definition-shape regex, or it silently stops watching for a hand-written copy.

**D-2059** — spec §4 says the heir act is "one method, parameterised by role, never two", and the contract names it `requeueAbandonedMail(role, …)`. Measured: the role has to vary FOUR things, not one. The `m.toId` literal and the scope clause (`rr.program = ?` for a chair, `m.runId = ?` for a worker) are the parameterisation the spec anticipated. But the SOURCE predicate differs too — the coordinator arm sources `ABANDONED_PARK_SQL` (arm (e) of `reclaimProgram`'s ruling; `repointCoordinatorMail` has already moved the outstanding rows) while the worker arm sources `OUTSTANDING_STATES_SQL` (there is no repoint on that path, so the outstanding rows ARE what a replacement inherits) — and so does the park: the coordinator arm parks nothing, the worker arm parks the predecessor's row. Both differences are what the spec's own two sentences require; only the claim that one parameter covers them is wrong. The method's name is kept as the contract fixes it, and it therefore says "Abandoned" while being true of one arm only — stated in its docstring rather than hidden. The parameter is a CORRELATED union (`{role:'coordinator'; program} | {role:'worker'; runId}`) so the two meaningless combinations are unrepresentable.

**D-2060** — `homeProjectVerdict` (Task 4) is a PURE function — no store, no reply, no clock — and its own docstring said so by citing "L1: 'pure decisions'". Measured: the function is defined in `server/src/coord/routes.ts`, which is L4 delivery, and the ring rule (`CLAUDE.md`) says L4 "owns fastify/sockets/timers but is NOT allowed to DECIDE" — so the docstring argued a ring the function does not sit in. The placement itself is not wrong: the cross-wave contract fixes `HOME_PROJECT_LEGACY_ACCEPTED` and `homeProjectVerdict` in this exact file so that wave 3's flip stays the one-constant change the spec promises, and moving the function to an L1 module would break that promise for a ring compliance this plan cannot buy back on its own. The docstring is corrected to say so — the decision is pure and independently testable, it lives beside the constant because the contract pins that home, and the only L4 thing nearby is the reply at its two call sites — rather than to keep citing L1 while sitting in L4. Recorded for a ruling on whether a future wave should split the pure decision out into its own L1 module once the legacy flip (wave 3) no longer needs the constant and the function to travel together.

**D-2061** — "What this wave deliberately does NOT change" lists the two-slots-and-daily-budget consequence among spec §3 F3's BEHAVIOURAL clauses that belong to wave 2, and Task 2's own `wave-lifecycle.md` §2 row for `project-mismatch` states it anyway, in the same sentence as the row's remedy. Measured: the remedy — "open the wave again WITHOUT `sessionId`" — is not something a coordinator can respond to without knowing what it costs, so stating the code's meaning and remedy without the consequence would leave the row half-written. Wave 1 therefore says one wave-2 sentence a release early, in the one place a coordinator meeting the refusal for the first time will actually read it. Recorded rather than silently crossed; if wave 2 restates the same sentence elsewhere, this is the first of two copies and neither should be read as the only one.

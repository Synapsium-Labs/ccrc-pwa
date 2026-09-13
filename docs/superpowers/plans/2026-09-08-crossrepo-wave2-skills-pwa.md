# Cross-repo programmes — wave 2: the two skills learn the boundary and the board says which repo — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Teach the two skills the project boundary wave 1 made mechanical — reuse a `sessionId` and transfer a hold only inside one project, release a cross-project producer, state `homeProject` on every open, read a foreign repo's plan and producer source from their named Git objects, prove the producer closed and its exact SHA merged, address the worker by role with a `runId`, and expose the bounded ask operations those skills require — and make the console say which repo a run is in, which repo its programme is homed in, and which programme a feed record belongs to.

**Architecture:** The original nine tasks plus the post-handoff acceptance correction make no new schema decision. The skills get ADDITIVE prose beside pins that already exist: the coordinator's eleven clauses and the worker's thirteen stay verbatim, and every new paragraph ships with its own harvest assertion in the suite that already reads that corpus. The bounded client adds three closed-table ask operations and an executable-corpus parity gate without exposing arbitrary URL, identity, or body controls. The PWA gets ONE new tolerant reader (`runHomeProject`) and ONE new derived note (`crossingNote`) in `pwa/src/fleet/runWords.ts` — the file that already owns every decision `RunsScreen` and `ProjectCard` render but do not make — and three surfaces compose them: the runs row gains a project badge and a crossing marker, the project card marks the rule-3 orphan worker and lists the waves abroad from an ADDITIVE `abroad` prop `FleetScreen` computes, and the mail screen groups the feed by programme through `NotifyEvent.runId` joined against `GET /api/runs`. `nestFleet` and its five rules do not change; nothing here decides anything the server did not already record.

**Tech Stack:** Markdown skills under `ccd/` (installed by the four-homes lane), TypeScript (strict, NodeNext) in `pwa/src` and `shared/`, React 19 + `@testing-library/react` under jsdom, vitest for every suite, node >= 22.13.0.

**Spec:** `docs/superpowers/specs/2026-09-08-crossrepo-programmes-design.md`

**Base:** `origin/main` `d0064e6e` (plus the committed spec); branch `ws/<the workspace the coordinator dispatches into>`

**AGENT-FIRST.** This wave touches `ccd/coordinator-skill/` and `ccd/worker-skill/`, so it deploys to the fleet host BEFORE the server — `bash deploy/deploy.sh agent <fleet-host>` then `bash deploy/deploy.sh` (Task 9 states both, with the reason). A skill reaches a config dir only once its installer has run against that home, so the server lane can never be what makes a skill sentence true. **Across waves:** wave 1 is live on both boxes before this wave ships — its refusal codes must exist on the box before the skill starts telling coordinators to cross repos (spec §8, §9).

---

## Global Constraints

Copied from the spec and from `CLAUDE.md`. Every task's requirements implicitly include this section.

- **Fixture HOMEs only.** No test here runs `ccd` at all, and none may touch the live `$HOME`: the PWA suites are jsdom renders, and the two skill suites read tracked files out of the repo. Never touch tmux, `~/.cc-sessions`, `~/.cc-limits` or a `claude-session@*` unit.
- **No account name, host name, IP, tailnet name, duckdns name or fleet-account label anywhere** — source, test, or this document. Fixture projects are `demo`, `alpha`, `beta`, `home-repo`, `other-repo`; fixture sessions are the ones the suites already use (`demo-quiet-mesa`, `demo-still-cove`, `ccrc-pwa-clear-cove`). `server/test/topology-clean.test.ts` and `server/test/single-definition.test.ts` scan the whole tracked tree, this document included.
- **`FLEET_PROTO` stays 1; the wire is additive-only.** This wave adds NO wire field at all — `RunSummary.homeProject` and `NotifyEvent.runId` are wave 1's, and this wave is their first PWA reader. A newer peer must tolerate an older peer omitting a field. `homeProject` has ONE reader, full stop: `runHomeProject`, called at every one of its three call sites (Tasks 5–7) — there is no wire-boundary normaliser for `RunSummary` the way `reviveNotifyEvent` is one for `NotifyEvent`, so `runHomeProject` is both the wire tolerance and the render-time accessor. `runId` has TWO readers at two different boundaries, and that is deliberate, not a duplicate: `reviveNotifyEvent` (`shared/api.ts`, wave 1) is what a `NotifyEvent` crosses coming IN — the durable `GET /api/feed` read and the live catch-up tail both go through it, and it is what turns a missing key into `null` at the wire; Task 8's `eventRunId` in `pwa/src/lib/feed.ts` is the render-time accessor for a store row that a caller cannot prove was revived (an older cached build, a merge that put an unrevived object in the store), belt to that boundary's braces. Every `pwa/src` render site reads `eventRunId(ev)`, never `ev.runId` directly, which is what makes THAT the one rule that actually needs stating: not "one reader total" but "one reader per boundary, and the render side never reaches past its own."
- **No overloaded null at a seam.** Two conditions a caller handles differently must not collapse to one value. In this wave that binds three places: a feed record with NO `runId` and one whose `runId` names a run this read did not return are different facts and get different headers (Task 8); a `homeProject` that is null (legacy generation) and one that equals the run's own project are both "no crossing" but only the second is a measured sameness, and neither may render the marker (Task 5); an orphan whose coordinator is merely on another card and one whose programme is homed elsewhere are two facts and the marker states each only when it measured it (Task 6).
- **Mutation-table discipline.** Every guard ships WITH a test that goes RED when the guard is deleted or mutated, measured before and after — not asserted in a comment. TDD, red first. Each task names the exact mutation, the suite it reds, and the expected message.
- **The pinned clauses are VERBATIM and this wave does not touch them.** `server/test/coordinator-skill.test.ts:104-115` pins eleven coordinator clauses and `server/test/worker-skill.test.ts:34-71` (the array itself at `:49-64`) pins thirteen worker clauses, character for character (straight apostrophes in the worker's, curly in the coordinator's). Every addition here is a NEW paragraph or a NEW section; if a clause literal changes, the change is wrong.
- **Two scans constrain what may be written into `ccd/worker-skill/SKILL.md`** and both are easy to trip by accident: `worker-skill.test.ts:95-103` asserts `^\d+\. ` matches EXACTLY the thirteen contract lines (so no new numbered list at column zero), and `:105-117` harvests `\b([a-z]+) (?:clauses|lines)\b` and requires every hit to be the derived word `thirteen` (so no new sentence may say "two clauses" or "three lines"). The destructive-verb census (`:137-152`) requires `ws-rm`, `ws-reap`, `ws-gc`, `ws-archive`, `ws-restore` to appear ONLY inside clause 8 — new prose may name none of them.
- **The coordinator's route corpus is parity-checked in BOTH directions** (`coordinator-skill.test.ts:204-275`): every `GET`/`POST /api/…` string in `SKILL.md` + every reference except `mail-envelope.md` must be a route `server/src/coord/routes.ts` actually registers, and every registered route must be named unless it is in the EXEMPT set. New prose may name `POST /api/runs`, `POST /api/runs/:id/dispatch`, `GET /api/runs`, `POST /api/mail`, `POST /api/ledger/deviations` — all registered and already named — and must name none of the ungated operator doors.
- **L0 imports nothing.** `shared/*.ts` is bundled by the PWA. This wave adds nothing to `shared/`; `pwa/src/fleet/runWords.ts` is PWA-side and imports only types from `../../../shared/api`, exactly as it does today.
- **New CSS introduces no new colour pair, and every rule is MEASURED, by one of two routes.** Three rules (Task 5's `.run-project`, `.run-crossing`, `.run-crossing-glyph`) name `.run-row` directly in their own selector — `.run-row .run-project`, not bare — and `.run-row` is self-grounded (`fleet.css:1967`, background AND colour both set), so `design/audit.mjs`'s named-ancestor route grounds them for free, the same route `.run-row .run-dispatch` (`fleet.css:2012-2017`) already stands on. The other seven (Task 6's `.proj-crossing`/`.proj-crossing-glyph`, Task 7's `.proj-abroad-line`/`.proj-abroad-glyph`, Task 8's `.mail-chip`/`.mail-chip[data-on]`/`.mail-group-head`) are written bare — they sit visually on `.proj-card-body`'s or the mail screen's own ground, but their OWN selectors name no ancestor, and a route that only reads selectors cannot recover a ground the DOM supplies and the stylesheet does not say. Measured directly (`node design/contrast-check.mjs` against a scratch copy of `fleet.css` with these ten rules added): the three named-ancestor rules print PASS immediately: 462→468. The seven bare ones print nothing and the uncovered census grows by exactly seven, 250→257 — the suite would still stay green (the census is allowed to be non-empty, and none of the seven is "recoverable from the selector," the only shape that would fail it), but that is a colour pair shipping UNPRICED, not one the tool has priced and found safe. So each of Tasks 6–8 registers its own bare rules in `design/audit.mjs`'s `INHERITED_GROUNDS`, in the SAME commit as the rule — the `.proj-ready-why` entry's own comment states the house rule ("Added WITH the rule rather than after it: the first draft of the reason line shipped uncovered, which is precisely the defect those three entries exist to record"). Re-measured with all seven registered (`.proj-*` under `var(--bg-surface)`, `.mail-*` under `var(--bg-page)`): every one PASSES — 5.25–16.94:1 across both themes, all comfortably above the 4.5 floor — and the uncovered census returns to 250. Two cues on every state: a glyph AND a word, never colour alone.
- **Deviation numbers come only from the allocator.** This plan mints none. Deviations found while planning are recorded in `## Deviations found` in the `D-TBD` meta-form and the orchestrator mints the real numbers; a deviation found during execution is allocated in its own `POST /api/ledger/deviations` call at the moment it is found, against the HOME project, never taken from a gap in anyone's block.
- **Node floor `>=22.13.0`,** identical across the three engines; if `node-floor.test.ts`'s absolute assertion reds while the others are green, RAISE engines — never lower them.
- **Run suites in the FOREGROUND, timeout >= 600000 ms**, from inside the package: `cd server && ./node_modules/.bin/vitest run test/<file>.test.ts` (or `.../pwa && ./node_modules/.bin/vitest run test/<file>.test.tsx`). NEVER bare `npx vitest` — it resolves a global copy with no jsdom and falsely reports "no tests".
- **Known load flakes** — re-run IN ISOLATION before calling a real break: `ccd-ws-gc`, `pr-sweep`, `session-hook`, `typecheck-tests`, `ccd-session-state`. CI on the quiet box is the arbiter.

---

## Wave map

| Wave | Owns |
|---|---|
| 1 — server and shared | F1 (`project-mismatch` at open and at dispatch resume), F2 (migration, `homeProject` on the programme row, `ledgerRepo`/`ledgerAbsPath`, `RunSummary.homeProject`), §4 (the `worker` role, `bindSession`'s heir re-issue, both programme filters, `feed_events.runId`, `NotifyEvent.runId`), the `ccrc-api` rows, and the REFUSAL-LIST sentence naming both codes in the coordinator skill |
| **2 — this plan** | F3 (the behavioural sentences in both skills), F4 (runs screen, both card changes), the mail screen's grouping and chip |
| 3 — docs and the flip | README, the coordinator references' docs pass, and `HOME_PROJECT_LEGACY_ACCEPTED → false` as its own PR, gated on zero `legacy-home-project` run events over seven consecutive days |

**This wave CONSUMES, and must not re-spell (wave 1's deliverables, exact names):**

| Name | Home | What this wave does with it |
|---|---|---|
| `RunRefuseCode` members `"project-mismatch"`, `"home-mismatch"` | `shared/api.ts` (union at `:3787`, `RUN_REFUSE_CODE_MAP` at `:3792`) | Tasks 1–2 name both in prose. `coordinator-skill.test.ts:296-311` requires every code the refusal-list sentence names to be real AND explained in `wave-lifecycle.md`, and `:313-346` requires every declared `RunRefuseCode` to appear SOMEWHERE in the corpus — both are wave 1's to satisfy, and this wave must not break either |
| `RunSummary.homeProject: string \| null` | `shared/api.ts` | Tasks 5–7 read it through `runHomeProject`, never directly |
| `NotifyEvent.runId: number \| null` | `shared/api.ts`, revived by `reviveNotifyEvent` | Task 8 groups the feed on it |
| `HOME_PROJECT_LEGACY_ACCEPTED` | `server/src/coord/routes.ts` | named in Task 2's prose as the reason an absent `homeProject` is still accepted today |
| `ledgerRepo`, `ledgerAbsPath` on the open response | `server/src/coord/routes.ts` | Tasks 1–2: the coordinator treats `ledgerAbsPath` only as the ledger path and carries separate `homeRepoRoot`, `planRepoPath`, and `planSha` plan coordinates |
| the `worker` role recipient, `resolveWorker(runId)` | `server/src/coord/routes.ts`, `store.ts` | Task 3 (the coordinator's addressing rule) and Task 4 (the worker's note that a reply may name the role) |
| `GET /api/mail?program=`, `GET /api/mail?program=&all=1`, `GET /api/feed?program=` | `server/src/coord/routes.ts` | Task 3 distinguishes outstanding programme mail, full mail history, and the feed archive |

**This wave PRODUCES (nothing later in this programme consumes it; wave 3 only documents it):**

| Name | Home | Contract |
|---|---|---|
| `runHomeProject(run): string \| null` | `pwa/src/fleet/runWords.ts` | THE single tolerant reader of `RunSummary.homeProject` in `pwa/src`. `null` for absent, non-string, or empty |
| `waveLabel(run): string` | `pwa/src/fleet/runWords.ts` | `wave 2/5`, or `wave 2` when `waveOf` is null — one spelling, three callers |
| `CROSSING_GLYPH` | `pwa/src/fleet/runWords.ts` | the one glyph both surfaces draw |
| `crossingNote(run): CrossingNote \| null` | `pwa/src/fleet/runWords.ts` | `null` unless `runHomeProject(run)` is non-null AND differs from `run.project`; otherwise `{glyph, word, home, title}` |
| `abroad` prop | `pwa/src/fleet/ProjectCard.tsx` | additive, defaults `[]`; the runs whose HOME is this card's project and whose own project is not |
| `.run-project`, `.run-crossing`, `.run-crossing-glyph`, `.proj-crossing`, `.proj-abroad`, `.proj-abroad-line` | `pwa/src/fleet/fleet.css` | classes the three surfaces render |

---

## Prerequisites — wave 1 must be MERGED and LIVE before Task 1

Three of them, and none is optional:

1. **Rebase this branch onto wave 1's merged main** (or merge wave 1's branch into this workspace's branch). Task 1's very first assertion reads a skill whose refusal-list sentence wave 1 wrote; Tasks 5–8 read wire fields wave 1 declared. Without it the red is a missing FIELD, which measures nothing about the guard this wave adds.
2. **Wave 1 is DEPLOYED — the agent lane to the fleet host FIRST, then the server lane — and someone other than this worker measured it.** Spec §8's across-wave rule: the refusal codes exist on the box before the skill starts telling coordinators to cross. Two facts, one per lane:

   - **The AGENT lane.** `bash deploy/deploy.sh agent <fleet-host>` has run for wave 1's merged sha (wave 1 Task 9 Step 7 is the command, and its ordering). That lane is what puts wave 1's `references/wave-lifecycle.md` — the refusal rows Task 1's prose sends a coordinator to — into the four homes; nothing the server lane does can make a skill sentence true inside a config dir.
   - **The SERVER lane.** `/health` reports that same sha, which is `bash deploy/deploy.sh`'s own final gate.

   **Both are an operator or coordinator CONFIRMATION, reported to this worker — not a command this worker runs, and not a `curl` it issues.** A wave-2 worker runs on the fleet box; the server's HTTP port is bound to loopback on the SERVER box, so there is nothing here to curl. And a `/health` read proves the SERVER lane only — the half this prerequisite cares about least, since it is the agent lane that carries the skill corpus. Take the confirmation in writing (the brief, or a reply to an ask), quote it in the wave report, and infer neither lane from this tree.

3. **`cd pwa && npm run build` — one verification, and no fixture edits.**

   Expected: GREEN. Wave 1 Task 3 Step 9 already added `runId: null` to the three typed `NotifyEvent` builders (`pwa/test/feed.test.ts`, `pwa/test/mail-screen.test.tsx`, `pwa/test/notifymark.test.ts`), and wave 1 Task 4 Step 7 added `homeProject: null` to the nine typed `RunSummary` builders it names in its own Files block. Both fields are REQUIRED members of their wire types, and the wave that declares a required field pays the compile debt in the commit that declares it — those twelve edits are wave 1's, and this wave neither repeats them nor reviews them.

   A RED here means wave 1's PR is not merged into this branch and Prerequisite 1 was skipped — **stop and rebase rather than editing a fixture.** A fixture "fixed" here is a second copy of an edit wave 1 already owns, and it comes back as a conflict at the rebase the red was asking for. Do NOT start Task 1 until this build is green: a red PWA typecheck makes every "expected FAIL" below unreadable.

---

## File Structure

| File | Task | Responsibility after this wave |
|---|---|---|
| `ccd/coordinator-skill/SKILL.md` | 1, 3, acceptance correction | Carries the crossing section (project-specific succession, `homeProject` on every open, measured caps accounting, immutable plan and producer-source reads, closed-row plus exact-SHA merge proof, deviations against the home project) and the role-addressing sentence. |
| `ccd/coordinator-skill/references/wave-lifecycle.md` | 2, 3, acceptance correction | The long form at the call sites: §1 (open), §2 (the foreign plan and producer-source tuples with exact Git-object reads), §3 (role addressing and programme history), §5 (same-project transfer versus cross-project release and the two-part dependency gate). |
| `ccd/coordinator-skill/references/mail-envelope.md` | 3 | The role vocabulary is TWO roles; `to:` is still always the resolved session. |
| `ccd/worker-skill/SKILL.md` | 4, acceptance correction | The foreign-plan and producer-source rules (read the named Git objects, never mutate the home repo, commit only on this branch), the inline-excerpt authority split, and the note that a reply may be addressed to the role `worker`. |
| `ccd/ccrc-api` | acceptance correction | Adds the bounded `asks.list`, `asks.answer`, and `asks.release` rows; derives list identity from the current pane and keeps arbitrary URL/identity/body controls closed. |
| `server/test/ccrc-api.test.ts` | acceptance correction | Pins all twenty-two client rows and ask-list identity/body behaviour. |
| `server/test/ccrc-api-closed.test.ts` | acceptance correction | Proves every executable coordination command in the shipped corpus maps to a declared client row and preserves the closed invocation surface. |
| `server/test/coordinator-skill.test.ts` | 1, 2, 3, acceptance correction | Harvest pins for every new coordinator sentence and the corrected lifecycle/provenance/accounting contract. |
| `server/test/worker-skill.test.ts` | 4, acceptance correction | Harvest pins for the foreign plan and producer-source authority split. |
| `pwa/src/fleet/runWords.ts` | 5 | Owns `runHomeProject`, `waveLabel`, `CROSSING_GLYPH`, `crossingNote` — the decisions the three surfaces render. |
| `pwa/src/screens/RunsScreen.tsx` | 5 | Renders the project badge on every row and the crossing marker when there is one. |
| `pwa/src/fleet/ProjectCard.tsx` | 6, 7 | Marks the rule-3 orphan worker row; renders one line per wave abroad from the additive `abroad` prop. |
| `pwa/src/screens/FleetScreen.tsx` | 7 | Computes `abroad` per card beside the per-card `runs` filter it already computes. |
| `pwa/src/screens/MailScreen.tsx` | 8 | Groups the feed by programme, with a filter chip and honest headers for the two programmeless cases. |
| `pwa/src/fleet/fleet.css` | 5, 6, 7 | The six new classes, each grounded under an existing ancestor. |
| `pwa/test/runs-screen.test.tsx` | 5 | Badge, marker, both silences, and the tolerant reader's own unit cases. |
| `pwa/test/project-card.test.tsx` | 6, 7 | The orphan marker and the abroad lines. |
| `pwa/test/fleet-screen.test.tsx` | 7 | The wire: `abroad` reaches the right card, scoped. |
| `pwa/test/mail-screen.test.tsx` | 8 | Grouping, the chip, the two programmeless headers, and the stale-comment correction. |
| `pwa/test/offline.test.ts` | 8 | Pins what the snapshot actually holds, so the tolerance claim is measured rather than asserted. |
| `pwa/test/nestFleet.test.ts` | 6 | UNCHANGED — run to prove the tree did not move. |

---

## Task 1: The coordinator skill learns the project boundary — SKILL.md's crossing section

**Files:**
- Modify: `ccd/coordinator-skill/SKILL.md` — a new section between the end of the wave lifecycle (`:298`) and `## What stays discipline` (`:300`)
- Modify: `server/test/coordinator-skill.test.ts` — a new `describe` appended at the foot of the file

**Interfaces:**
- Consumes: `RunRefuseCode` members `"project-mismatch"` and `"home-mismatch"` (wave 1, `shared/api.ts`); `HOME_PROJECT_LEGACY_ACCEPTED` (wave 1, `server/src/coord/routes.ts`); `ledgerRepo` and `ledgerAbsPath` on the `POST /api/runs` response (wave 1).
- Produces: nothing importable. The artefact is the section `## When a wave crosses into another project` in `ccd/coordinator-skill/SKILL.md`, pinned sentence by sentence.

**Spec refs:** §3 F3 (coordinator design, every bullet except the refusal-list one wave 1 shipped), §5 (the caps restatement), §9 wave 2.

**One rule in every prescriptive copy.** Concurrency counts dispatched non-terminal runs, not held workspaces: a terminal producer retained on a hold and a planned undispatched consumer use no running-worker slot. Every actual dispatch still consumes daily budget, and a dispatched non-terminal consumer uses one concurrency slot. The skill, lifecycle reference, current spec, and future README plan must all state that measured accounting; a held-workspace count is not a proxy.

**Mutation table row — "the crossing sentences are pinned":** goes RED when any one of the eight sentences is deleted or paraphrased. Measured in Step 4 by deleting one sentence at a time; the `it.each` row names which sentence went.

The lifecycle step this correction produces must name both procedures rather than presenting one as universal:

```markdown
5. **Review the handoff commit** like any other commit and update the ledger.
   Open wave N+1 BEFORE closing this producer. If it stays in this project,
   open with this run's `sessionId`, close with `final:false`, and let the hold
   transfer to the already-open successor on the same workspace. If it changes
   project, open without this run's `sessionId`, close with `final:true`, and
   require `released:true`. Then verify the producer through `"$API" runs list
   --closed 1`; before a dependent dispatch, independently prove the producer
   interface PR merged at the exact `producerSha`.
```

`ccd/coordinator-skill/SKILL.md:296-302` — the insertion point is the blank line at `:299`:

```markdown
   run owns it, which is exactly the state step 5's open-before-close creates.
   The program is not done; close the other run. Do not archive the workspace
   yourself unless the operator asks.

## What stays discipline

Handoffs are commits. Briefs are prose reviewed like code. The ledger is for
```

`server/test/coordinator-skill.test.ts:53` — the corpus every whole-file assertion in that suite reads:

```ts
const allSkillText = [skill, ...REFERENCE_NAMES.map(refs)].join('\n');
```

- [ ] **Step 1: Write the failing test**

Append to `server/test/coordinator-skill.test.ts`:

```ts
// ── cross-repo wave 2: the project boundary, in the skill (spec §3 F3) ───────
//
// Wave 1 made the boundary MECHANICAL (`project-mismatch`, `home-mismatch`) and
// named both codes in the refusal list. That is the server refusing; this is the
// coordinator knowing. The two are not the same guard and the difference is
// measurable: a coordinator that meets `project-mismatch` has already queued a
// brief onto the wrong repo's workspace in its own head, and the refusal is what
// stops the fleet — not what tells it what to do instead.
//
// Sentence-literal pins, the same mechanism `CONTRACT` uses and for the same
// reason: the SENTENCE is the instruction, so a paraphrase must fail exactly as
// a deletion does. Each row carries what it is FOR, so a red names the rule that
// went missing rather than a 90-character string.
describe('the coordinator learns the project boundary (cross-repo wave 2, spec §3 F3)', () => {
  const CROSSING: readonly (readonly [string, string])[] = [
    ['the reuse rule — a sessionId is a same-project idiom',
      'Reuse `sessionId` ONLY when the next wave stays in the same project.'],
    ['what a crossing wave does instead',
      'A wave that CHANGES project opens WITHOUT `sessionId` and spawns a fresh workspace in the target repo'],
    ['the running-worker cap counts dispatched non-terminal runs',
      'concurrency counts dispatched non-terminal runs, not held workspaces'],
    ['the daily cap counts each actual dispatch',
      'each actual dispatch still consumes daily budget'],
    ['homeProject on every open',
      'Every `POST /api/runs` for this programme carries `homeProject`'],
    ['every foreign-plan brief carries the immutable-plan source tuple',
      'Every brief for a foreign-repo wave carries the three immutable-plan coordinates'],
    ['producer-source provenance is conditional',
      'Only a consumer that depends on a producer interface carries the producer contract'],
    ['the no-dependency arm invents no producer evidence',
      'A foreign-repo wave with no producer-interface dependency carries none of those producer fields and no invented excerpt.'],
    ['the producer contract names its own repository root',
      '`producerRepoRoot`, `producerSourceRepoPath`, `producerSha`'],
    ['the named plan blob is read exactly',
      'git -C "$homeRepoRoot" show "$planSha:$planRepoPath"'],
    ['the named producer blob is read in the producer repository',
      'git -C "$producerRepoRoot" show "$producerSha:$producerSourceRepoPath"'],
    ['same-project succession transfers the hold',
      'close the producer with `final:false` so its hold transfers'],
    ['cross-project succession releases the producer',
      'close the producer with `final:true` and require `released:true`'],
    ['the producer is verified after close through closed runs',
      'run `"$API" runs list --closed 1` and require that producer\'s own `state` to be `done`'],
    ['the exact producer SHA is independently proven merged',
      'independently prove its interface PR merged at the exact `producerSha`'],
    ['deviations are minted against the home project',
      'minted against the HOME project'],
  ];

  it('carries the crossing section at all', () => {
    expect(skill).toContain('## When a wave crosses into another project');
  });

  // `flat` is this file's own helper (`:654`, the `readme-holds.test.ts` idiom):
  // both corpora wrap mid-clause at 80 columns, so a raw `toContain` would pin
  // the WRAP POINT rather than the sentence and would red on a re-flow that
  // changed nothing. A paraphrase still fails exactly as a deletion does.
  it.each(CROSSING)('states %s', (_what, sentence) => {
    expect(flat(skill), `SKILL.md no longer states ${_what}`).toContain(flat(sentence));
  });

  it('names BOTH new refusal codes where the rule that provokes them is stated', () => {
    // Not the refusal-list sentence (wave 1's, pinned by its own test above):
    // this is the section that tells a coordinator what it did to earn them, and
    // a rule stated without its refusal leaves the reader to guess which one
    // they are looking at.
    const start = skill.indexOf('## When a wave crosses into another project');
    expect(start, 'the crossing section is gone').toBeGreaterThanOrEqual(0);
    const end = skill.indexOf('\n## ', start + 1);
    const section = skill.slice(start, end === -1 ? undefined : end);
    for (const code of ['project-mismatch', 'home-mismatch']) {
      expect(section, `the crossing section never names ${code}`).toContain(code);
    }
    // And the caps it warns about are the real ones, spelled as the codes the
    // dispatch actually answers with.
    for (const cap of ['cap-concurrency', 'cap-daily']) {
      expect(section, `the crossing section never names ${cap}`).toContain(cap);
    }
  });

  it('does not let the crossing section teach a second /clear writer or a reap', () => {
    // The census tests above count `ws-reap`/`ws-rm`/`ws-gc` over `allSkillText`
    // and clause 9 owns `/clear`; a new section is exactly where a well-meant
    // recovery sentence gets added. Asserted HERE too, scoped to the section, so
    // the failure names the section rather than a whole-file count.
    const start = skill.indexOf('## When a wave crosses into another project');
    const end = skill.indexOf('\n## ', start + 1);
    const section = skill.slice(start, end === -1 ? undefined : end);
    for (const forbidden of ['ws-reap', 'ws-rm', 'ws-gc', '/clear']) {
      expect(section, `the crossing section names ${forbidden}`).not.toContain(forbidden);
    }
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd server && ./node_modules/.bin/vitest run test/coordinator-skill.test.ts`
Expected: FAIL — the heading pin and every positive `CROSSING` row report the missing immutable-plan, lifecycle, or crossing sentence. The scoped negative case becomes a real assertion once the section exists. Everything else in the file stays GREEN: the eleven clauses are untouched.

- [ ] **Step 3: Write the section**

Insert into `ccd/coordinator-skill/SKILL.md` between the end of step 6 (`:298`) and `## What stays discipline` (`:300`):

```markdown
## When a wave crosses into another project

A programme has ONE home project — the repo whose `docs/superpowers/programs/<slug>.md`
ledger you write, and whose plan every wave is measured against — and its waves
may run in ANY project. The home is stated, never inferred. **Every `POST /api/runs`
for this programme carries `homeProject`**, the same value on every wave; the
response answers `ledgerRepo` and `ledgerAbsPath` for it; `ledgerAbsPath` names
only that programme ledger, never a plan coordinate. Carry the plan separately as
`homeRepoRoot`, `planRepoPath`, and `planSha`. A later open naming a different home is
refused `home-mismatch` with `by:` the stored value — the fix is your body, never
the server. (An open with no `homeProject` at all is still accepted for one
deploy generation and recorded as a `legacy-home-project` run event, with the
column left NULL rather than guessed. You never omit it.)

**Reuse `sessionId` ONLY when the next wave stays in the same project.** Step 5
above — same `sessionId`, same workspace — is a SAME-PROJECT idiom, and nothing
in it says so because until now there was nothing else. A wave that CHANGES
project opens WITHOUT `sessionId` and spawns a fresh workspace in the target repo,
which is the path wave 1 already spawns on. Naming the old session for a wave in
a different project is refused `project-mismatch` with `by:` the project that
session's workspace belongs to — at the open, and again at the dispatch resume if
the open ever let one through.

**What a crossing costs, so a cap refusal reads as arithmetic rather than a
fault.** Concurrency counts dispatched non-terminal runs, not held workspaces: a
terminal producer retained on a hold and a planned undispatched consumer consume
no running-worker slot. Each actual dispatch still consumes daily budget, and a
dispatched non-terminal consumer consumes one concurrency slot. `cap-concurrency`
or `cap-daily` remains authoritative — stop, say which cap, and wait to be woken,
exactly as you would for any other run.

**Every brief for a foreign-repo wave carries the three immutable-plan
coordinates: `homeRepoRoot`, `planRepoPath`, and `planSha`.** `homeRepoRoot` is the
absolute home-repository root; `planRepoPath` is the tracked repository-relative
plan path with no leading slash; and `planSha` is the full 40-hex plan commit SHA.
The worker reads exactly
`git -C "$homeRepoRoot" show "$planSha:$planRepoPath"`; an unresolved repository,
commit, or path means report and stop, without substituting `HEAD`, reading the
current checkout, fetching, checking out, or mutating the home repo.

**Only a consumer that depends on a producer interface carries the producer
contract:** `producerRepoRoot`, `producerSourceRepoPath`, `producerSha`, and the
contract excerpt inlined verbatim from the merged file. A foreign-repo wave with
no producer-interface dependency carries none of those producer fields and no
invented excerpt. `producerRepoRoot` is the absolute producer-repository root;
`producerSourceRepoPath` is the producer source file's repository-relative path;
and `producerSha` is the exact full merged producer SHA. The worker proves its
provenance with
`git -C "$producerRepoRoot" show "$producerSha:$producerSourceRepoPath"`. The
inline excerpt remains the dispatched authority for interface shape; the
immutable producer blob proves where that shape came from; and the plan blob
controls wave scope and requirements. `ledgerAbsPath` names only the programme
ledger.

**Open every successor before closing its producer, then follow the procedure for
that project relationship.** For a same-project successor, open with the producer's
`sessionId`, close the producer with `final:false` so its hold transfers to the
already-open successor, run `"$API" runs list --closed 1`, and require that
producer's own `state` to be `done`. For a cross-project successor, open without
the producer's `sessionId`, close the producer with `final:true` and require
`released:true`, then perform the same closed-row check. Before dispatching any
dependent consumer, independently prove its interface PR merged at the exact
`producerSha` carried in the foreign interface contract. A missing or non-`done`
row, failed release, or absent exact-SHA merge proof means report and do not
dispatch. The closed row proves the fingerprint and terminal run state; it does
not prove the interface merged.

**Deviations found during a foreign-repo wave are minted against the HOME
project** — `POST /api/ledger/deviations` with the home project's name — and
defined in the home plan, because that is where the plan lives. The allocator
takes the project from the caller and cannot cross-check it, so this one is
discipline rather than a mechanism, which is exactly why it is written down.
```

- [ ] **Step 4: Run it to verify it passes**

Run: `cd server && ./node_modules/.bin/vitest run test/coordinator-skill.test.ts`
Expected: PASS — the whole file green, including the eleven-clause pin, the route-parity pair (the section names `POST /api/runs`, `GET /api/runs` and `POST /api/ledger/deviations`, all registered and all already in the corpus), the named-Git-object pins, the post-close ordering pin, and the refusal-code census.

- [ ] **Step 5: Measure the mutation (row "the crossing sentences are pinned")**

Run each mutation, confirm the named red, then revert it before the next.

1. Delete the sentence `Reuse \`sessionId\` ONLY when the next wave stays in the same project.` from the section.
   Run: `cd server && ./node_modules/.bin/vitest run test/coordinator-skill.test.ts`
   Expected: FAIL — 1 failing: `states the reuse rule — a sessionId is a same-project idiom`, message `SKILL.md no longer states the reuse rule — a sessionId is a same-project idiom`.
2. Replace `concurrency counts dispatched non-terminal runs, not held workspaces` with a held-workspace count.
   Run: same. Expected: FAIL — `states the running-worker cap counts dispatched non-terminal runs`.
3. Delete `each actual dispatch still consumes daily budget`.
   Run: same. Expected: FAIL — `states the daily cap counts each actual dispatch`.
4. Delete `project-mismatch` from the section (leaving the rule).
   Run: same. Expected: FAIL — `the crossing section never names project-mismatch`.
5. Add the string `/clear` to the section.
   Run: same. Expected: FAIL — `the crossing section names /clear`.

- [ ] **Step 6: Commit**

```bash
git add ccd/coordinator-skill/SKILL.md server/test/coordinator-skill.test.ts
git commit -m "docs(coordinator-skill): a wave may cross projects — the reuse rule, the home, the cost and the citation"
```

---

## Task 2: The long form at the call sites — `wave-lifecycle.md` §1, §2 and §5

**Files:**
- Modify: `ccd/coordinator-skill/references/wave-lifecycle.md` — §1 (after the wave ≥ 2 `sessionId` paragraph, `:24-27`), §2 (after the brief-content paragraph, `:159-172`), §5 (after step 3, `:468-473`)
- Modify: `server/test/coordinator-skill.test.ts` — append to the describe Task 1 created

**Interfaces:**
- Consumes: `RunRefuseCode` members `"project-mismatch"`, `"home-mismatch"`; `ledgerRepo`, `ledgerAbsPath` on the `POST /api/runs` response; `HOME_PROJECT_LEGACY_ACCEPTED` (all wave 1).
- Produces: nothing importable. The artefact is three paragraphs in `references/wave-lifecycle.md`, each pinned by a sentence literal.

**Spec refs:** §3 F3 (the same rules, at the place a coordinator reads while making the call), §3 F2 (the open body and the two response fields), §1 ruling 4 (Q1 is discipline, not schema).

**Mutation table row — "the lifecycle states the boundary where the call is made":** goes RED when any of the six sentences is deleted from `wave-lifecycle.md`. Measured in Step 4. This row is NOT the same guard as Task 1's: SKILL.md is what a coordinator reads once, the reference is what it reads WHILE calling, and the wave-1 refusal tables already live in this file — a rule stated only in SKILL.md is a rule nobody re-reads at the moment it binds.

Anchor quotes, verified against the working tree. Wave 1 adds rows to this file's §1 and §2 refusal tables, so find each site by its quoted text. `ccd/coordinator-skill/references/wave-lifecycle.md:24-28`:

```markdown
   For wave ≥ 2, reclaiming the workspace wave 1 held, add
   `"sessionId":"<the held session id>"` to the same call — it tells the open
   route this run reuses an existing workspace, so the next dispatch resumes
   it instead of spawning a fresh one.

```

`ccd/coordinator-skill/references/wave-lifecycle.md:167-172`:

```markdown
(the `oversize` ceiling above). **A brief carries what only THIS wave knows:**
the plan file's path, the tasks or task range this wave owns, **the execution
skill the worker should invoke** (`superpowers:executing-plans` or
`superpowers:subagent-driven-development`), the interfaces earlier waves
settled, the deviations already ledgered, and whatever your review of the last
handoff decided.
```

The §5 boundary keeps the programme non-zero while making succession project-specific:

```markdown
3. `POST /api/runs` for wave N+1 before closing wave N. Name this producer's
   `sessionId` only for a same-project successor; omit it for a cross-project
   successor. The programme now has two open runs and cannot retire between
   them. Close and release/transfer according to the matching procedure, then
   verify the closed producer and any required exact-SHA merge proof before
   dispatching wave N+1.
```

- [ ] **Step 1: Write the failing test**

Append inside the describe added in Task 1, in `server/test/coordinator-skill.test.ts`:

```ts
  // The reference is what a coordinator reads WHILE making the call — the
  // refusal tables wave 1 extended live here, three lines from the body being
  // typed. A boundary stated only in SKILL.md is a boundary read once, at
  // install time, by a session that had no run open yet.
  const LIFECYCLE: readonly (readonly [string, string])[] = [
    ['§1 — why sessionId is a same-project field',
      '`sessionId` reclaims a workspace, and a workspace lives in ONE repo'],
    ['§1 — the crossing open sends none',
      'a wave that changes project sends no `sessionId` at all'],
    ['§1 — homeProject rides the open body',
      '`"homeProject":"<the home project>"`'],
    ['§1 — the two response fields, and their null',
      'both are null while the stored home is null'],
    ['§1 — ledgerAbsPath is not a plan coordinate',
      '`ledgerAbsPath` is ONLY that home\'s programme ledger'],
    ['§2 — every foreign-repo brief carries the plan tuple',
      '`homeRepoRoot`, the absolute path to the home repository root; `planRepoPath`'],
    ['§2 — the named plan is read mechanically',
      'git -C "$homeRepoRoot" show "$planSha:$planRepoPath"'],
    ['§2 — producer-source provenance is conditional',
      'Only a consumer with a producer-interface dependency carries the producer contract'],
    ['§2 — no dependency means no producer fields or excerpt',
      'A foreign-repo wave with no such dependency carries none of these producer fields and no invented excerpt.'],
    ['§2 — the producer repository root is named',
      '`producerRepoRoot`, the absolute producer-repository root'],
    ['§2 — producer-source provenance is named',
      '`producerSourceRepoPath`, the producer source file\'s repository-relative path'],
    ['§2 — the named producer source is read mechanically',
      'git -C "$producerRepoRoot" show "$producerSha:$producerSourceRepoPath"'],
    ['§2 — plan failure cannot fall back to a mutable checkout',
      'If that repository, commit, or path cannot be resolved, it reports and stops.'],
    ['§2 — producer failure cannot fall back to consumer cwd',
      'If that producer repository, commit, or path cannot be resolved, it reports and stops.'],
    ['§5 — same-project close transfers the hold',
      'close the producer with `final:false`'],
    ['§5 — cross-project close releases the producer',
      'close the producer with `final:true` and require `released:true`'],
    ['§5 — Q1 invokes the declared client query',
      '"$API" runs list --closed 1'],
    ['§5 — merge is proved independently at the producer SHA',
      'independently prove the producer interface PR merged at the exact `producerSha`'],
  ];

  it('orders the complete producer gate: open, applicable close, done proof, merge proof, dispatch', () => {
    const lifecycle = refs('wave-lifecycle.md');
    const boundary = lifecycle.slice(lifecycle.indexOf('## 5 — The boundary'),
      lifecycle.indexOf('## 6 — Final merge'));
    const openAt = boundary.indexOf('POST /api/runs` for wave N+1');
    const closeAt = boundary.indexOf('close the producer');
    const checkAt = boundary.indexOf('"$API" runs list --closed 1');
    const mergeAt = boundary.indexOf('independently prove the producer interface PR merged');
    const dispatchAt = boundary.indexOf('Dispatch wave N+1');
    expect(openAt).toBeGreaterThanOrEqual(0);
    expect(closeAt).toBeGreaterThan(openAt);
    expect(checkAt).toBeGreaterThan(closeAt);
    expect(mergeAt).toBeGreaterThan(checkAt);
    expect(dispatchAt).toBeGreaterThan(mergeAt);
  });

  it.each(LIFECYCLE)('wave-lifecycle.md states %s', (_what, sentence) => {
    expect(flat(refs('wave-lifecycle.md')), `wave-lifecycle.md no longer states ${_what}`)
      .toContain(flat(sentence));
  });
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd server && ./node_modules/.bin/vitest run test/coordinator-skill.test.ts`
Expected: FAIL — every new lifecycle row whose source tuple, immutable read, ledger distinction, or post-close check is absent reports the missing section and rule. The ordering test also fails until close, closed-list verification, and dispatch appear in that order. Task 1's rows stay green.

- [ ] **Step 3: Write the three paragraphs**

3a. `references/wave-lifecycle.md` §1 — insert immediately after the wave ≥ 2 `sessionId` paragraph (`:24-27`), before the `**The hold, precisely.**` paragraph:

```markdown
   **That reclaim is SAME-PROJECT.** `sessionId` reclaims a workspace, and a
   workspace lives in ONE repo — so a wave that changes project sends no
   `sessionId` at all and takes wave 1's own fresh-spawn path in the target
   project. Naming a session whose workspace belongs to another project is
   refused `project-mismatch`, `by:` that project, before any run row exists.

   **Every open carries the home**, on every wave of the programme:
   `"homeProject":"<the home project>"` in the same body. The response answers
   `ledgerRepo` (the home project) and `ledgerAbsPath` (the home repo's
   programme ledger, absolute) beside the `ledgerPath` it always carried; both
   are null while the stored home is null, which is what a legacy-generation
   programme opened before this field existed still reads. A later open naming a
   DIFFERENT home is refused `home-mismatch`, `by:` the stored value.
```

3b. `references/wave-lifecycle.md` §2 — insert immediately after the brief-content paragraph (`:167-172`), before `**The execution skill is the one list item that is not merely useful.**`:

```markdown
**Every brief for a wave in ANOTHER project carries three immutable-plan
coordinates:** `homeRepoRoot`, the absolute path to the home repository root;
`planRepoPath`, the tracked repository-relative plan path under
`docs/superpowers/plans/`, with no leading slash; and `planSha`, the full 40-hex
plan commit SHA. These are separate from `ledgerAbsPath`, which names only
`docs/superpowers/programs/<slug>.md`. The worker reads the immutable plan object
exactly with `git -C "$homeRepoRoot" show "$planSha:$planRepoPath"`. If that
repository, commit, or path cannot be resolved, it reports and stops. It must not
substitute `HEAD`, directly read a mutable checkout as authority, fetch, checkout,
or otherwise mutate the home repository.

**Only a consumer with a producer-interface dependency carries the producer
contract:** `producerRepoRoot`, the absolute producer-repository root;
`producerSourceRepoPath`, the producer source file's repository-relative path;
`producerSha`, the exact full merged producer SHA; and the contract excerpt
inlined verbatim from the merged file. A foreign-repo wave with no such dependency
carries none of these producer fields and no invented excerpt. The worker proves
producer-source provenance with
`git -C "$producerRepoRoot" show "$producerSha:$producerSourceRepoPath"`. If that
producer repository, commit, or path cannot be resolved, it reports and stops.
The inline excerpt controls dispatched interface shape; the immutable producer
blob proves its provenance; the plan blob at `planSha` controls wave scope and
requirements; and the current checkout's plan is not authoritative for this
dispatch. It commits only on its own workspace's branch in the repo it is running
in.
```

3c. `references/wave-lifecycle.md` §5 — replace the universal transfer step with two explicit procedures:

```markdown
   **Same project:** open wave N+1 first with this producer's `sessionId`, then
   close the producer with `final:false`; the hold transfers to the already-open
   successor on the same workspace. After close, run `"$API" runs list --closed 1`,
   find this producer by run id, and require its own `state` to be `done`.

   **Different project:** open wave N+1 first without this producer's `sessionId`,
   then close the producer with `final:true` and require `released:true`; there is
   no same-workspace successor to receive a synthetic hold. Perform the same
   closed-row `done` check. Before dispatching a consumer that depends on this
   producer, independently prove the producer interface PR merged at the exact
   `producerSha` carried with `producerSourceRepoPath` in the foreign interface
   contract. The closed row proves fingerprint and terminal state, not merge.

   A missing/non-`done` producer row, failed release, or absent exact-SHA merge
   proof means report and do not dispatch. The default `runs list` excludes `done`
   and `failed` rows, so it cannot perform the state check.
```

- [ ] **Step 4: Run it to verify it passes, then measure the mutation**

Run: `cd server && ./node_modules/.bin/vitest run test/coordinator-skill.test.ts`
Expected: PASS — whole file green, including `promises only real refusal codes, and explains each one in wave-lifecycle.md` (both new codes are explained here by wave 1's tables and now by these paragraphs too).

Mutations, one at a time, reverted between:

1. Delete the sentence beginning `**That reclaim is SAME-PROJECT.**` from §1.
   Run: same command. Expected: FAIL — two rows: `wave-lifecycle.md states §1 — why sessionId is a same-project field` and `… §1 — the crossing open sends none`.
2. Change `"homeProject":"<the home project>"` to `"home":"<the home project>"`.
   Run: same. Expected: FAIL — `wave-lifecycle.md states §1 — homeProject rides the open body`.
3. Delete either the same-project `final:false` transfer or cross-project `final:true`/`released:true` procedure.
   Run: same. Expected: FAIL — the matching §5 lifecycle row.
4. Delete the independent exact-`producerSha` merge proof while keeping the `done` read.
   Run: same. Expected: FAIL — the merge-proof lifecycle row and the complete ordering test.
5. Move the closed-list check before the close call, or move dependent dispatch before merge proof.
   Run: same. Expected: FAIL — `orders the complete producer gate: open, applicable close, done proof, merge proof, dispatch`.

- [ ] **Step 5: Commit**

```bash
git add ccd/coordinator-skill/references/wave-lifecycle.md server/test/coordinator-skill.test.ts
git commit -m "docs(coordinator-skill): the lifecycle states the boundary at the call sites — open, brief, boundary"
```

---

## Task 3: Two roles on the mail lane — `mail-envelope.md`, `wave-lifecycle.md` §3, and SKILL.md's addressing sentence

**Files:**
- Modify: `ccd/coordinator-skill/references/mail-envelope.md` — the `**\`to:\` is always the resolved recipient.**` paragraph (`:52-59`)
- Modify: `ccd/coordinator-skill/references/wave-lifecycle.md` — §3, where mail is sent
- Modify: `ccd/coordinator-skill/SKILL.md` — one sentence in the crossing section Task 1 created
- Modify: `server/test/coordinator-skill.test.ts`

**Interfaces:**
- Consumes: the `worker` role recipient at `POST /api/mail` and `resolveWorker(runId)` (wave 1); `resolveCoordinator`'s single-active-programme fallback (unchanged); `GET /api/mail?program=<slug>` for outstanding mail, `GET /api/mail?program=<slug>&all=1` for full mail history, and `GET /api/feed?program=<slug>` for the full feed archive (wave 1).
- Produces: nothing importable. The artefact is the role vocabulary in the corpus a coordinator reads before it sends anything.

**Spec refs:** §4 (mail at programme scale — the role, the `runId` discipline, the programme filter), §3 F3's last bullet.

**Mutation table row — "the role vocabulary is two roles, and `runId` is not optional":** goes RED when the `worker` role, the `runId`-always rule, or the asymmetry between the two roles' fallbacks is deleted. Measured in Step 4.

Anchor quote, `ccd/coordinator-skill/references/mail-envelope.md:52-59`:

```markdown
**`to:` is always the resolved recipient.** The fixture above shows
`ccrc-pwa-still-water`, a concrete session id — never the literal role name
`coordinator`, even when the mail was addressed that way (`toId:"coordinator"`
on the sending side): the ingress resolves the role to whichever session
actually holds the program's coordinator run (`resolveCoordinator`) before
this envelope is ever rendered, and stores the rendered bytes. Reading `to:`
tells you who this envelope was actually delivered to, not the role the
sender named.
```

- [ ] **Step 1: Write the failing test**

Append inside the same describe in `server/test/coordinator-skill.test.ts`:

```ts
  // §4. There are TWO roles now, and the asymmetry between them is the part a
  // coordinator gets wrong: `coordinator` has a fallback (the single active
  // programme) and `worker` cannot have one, because a worker is per RUN and
  // there is nothing to fall back to. Carry the runId always and the asymmetry
  // never bites — which is exactly why it has to be written where the send is.
  const ROLES: readonly (readonly [string, string])[] = [
    ['mail-envelope.md', 'There are two role names, `coordinator` and `worker`'],
    ['mail-envelope.md', 'a `worker` mail names the `runId` of the run whose worker it wants'],
    ['mail-envelope.md', 'a `worker` mail with no `runId` is refused `unknown-recipient`'],
    ['wave-lifecycle.md', 'carry the `runId` on every mail you send, whichever role you address'],
    ['wave-lifecycle.md', 'a `worker` mail with no `runId` is refused `unknown-recipient`'],
  ];

  it.each(ROLES)('%s carries the role rule: %s', (file, sentence) => {
    expect(flat(refs(file)), `${file} no longer states: ${sentence}`).toContain(flat(sentence));
  });

  it('SKILL.md tells the coordinator how to address a worker, in the crossing section', () => {
    expect(flat(skill)).toContain(
      flat("Address the worker as `toId: 'worker'` with this run's `runId`"));
  });

  it('keeps the resolved-recipient promise while adding the second role', () => {
    // The envelope's `to:` is still ALWAYS a session id. A second role is a
    // second thing the INGRESS resolves, never a second thing that can appear
    // on the face of a rendered envelope — and the byte-identity test above
    // (renderEnvelope's real output) is what would catch the alternative.
    const env = flat(refs('mail-envelope.md'));
    expect(env).toContain('**`to:` is always the resolved recipient.**');
    expect(env).toContain('resolveWorker');
  });
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd server && ./node_modules/.bin/vitest run test/coordinator-skill.test.ts`
Expected: FAIL — 7 failing (five `it.each` rows, the SKILL.md sentence, and the `resolveWorker` half of the last one); `**\`to:\` is always the resolved recipient.**` already passes, which is the point of asserting it beside the new material.

**Two of those five rows pin the SAME sentence in TWO files** — the rows differ in their FILE, not their text, which is what makes them two assertions rather than one written twice. That is deliberate: this is the rule a coordinator meets at 2am with a wedged wave (a `worker` mail with no `runId` cannot resolve), and one copy surviving a careless edit is not the guard. The mutation below deletes them one at a time to prove each pin is load-bearing on its own.

- [ ] **Step 3: Write the three edits**

3a. `references/mail-envelope.md` — replace the paragraph at `:52-59` with:

```markdown
**`to:` is always the resolved recipient.** The fixture above shows
`ccrc-pwa-still-water`, a concrete session id — never a literal role name, even
when the mail was addressed that way. There are two role names, `coordinator` and
`worker`, and the ingress resolves either to a session before this envelope is
ever rendered, then stores the rendered bytes: `resolveCoordinator` answers the
session holding the programme's coordinator run, and `resolveWorker` answers the
`sessionId` of the run named on the mail. Reading `to:` tells you who this
envelope was actually delivered to, not the role the sender named.

**The two roles are not symmetrical, and that is deliberate.** A coordinator is
per PROGRAMME, so `toId:"coordinator"` with no `runId` falls back to the single
active programme — and fails shut the moment two are active. A worker is per RUN,
so a `worker` mail names the `runId` of the run whose worker it wants; there is
nothing to fall back to, and a `worker` mail with no `runId` is refused
`unknown-recipient`, as is one naming a run that has no worker yet (its `detail`
says which run). Raw session-id addressing is unchanged and is still right for
ad-hoc mail to a session you have already identified.

**A replacement occupant inherits its predecessor's undelivered mail.** When a run
is re-bound to a different session, every OUTSTANDING delivery of a role-addressed
mail on that run is re-issued to the heir as a NEW row, freshly rendered — never a
replay, because the stored envelope names the session that is gone — and the
predecessor's row is parked as the true record that it was never delivered. That is
the same act a coordinator handover already performs, now parameterised by role.
```

3b. `references/wave-lifecycle.md` §3 — append a paragraph at the end of §3 (immediately before the `## 4 — Advance the run as the wave progresses` heading):

```markdown
**Addressing, and the one rule that keeps it boring.** A worker is addressed
either by its session id or as `toId:"worker"` with the run — the role resolves to
whatever session that run currently names, which is what makes a replacement
reachable without anyone re-typing an id. So carry the `runId` on every mail you
send, whichever role you address: with it, `coordinator` resolves off that run's
own claim regardless of programme state and `worker` resolves off its `sessionId`;
without it, `coordinator` falls back to the single active programme and a `worker`
mail with no `runId` is refused `unknown-recipient`. One habit, no asymmetry to
remember. Reading a programme's whole lane is `GET /api/mail?program=<slug>&all=1`
— without `&all=1` it answers only what is still outstanding, exactly as `?to=`
does above — and its records are `GET /api/feed?program=<slug>`, which is always
the full archive with no outstanding/all split of its own; together they are the
filters that make a cross-repo programme legible from one call instead of two per
repo.
```

3c. `ccd/coordinator-skill/SKILL.md` — append to the crossing section (Task 1), after the deviations paragraph:

```markdown
**Address the worker as `toId: 'worker'` with this run's `runId`**, and the
coordinator as you do today. Carry the `runId` either way: it is what makes a
crossing programme's mail unambiguous when two of its waves are live in two
repos, and it is what keeps a `worker` mail resolvable at all
(`references/mail-envelope.md`).
```

- [ ] **Step 4: Run it to verify it passes, then measure the mutation**

Run: `cd server && ./node_modules/.bin/vitest run test/coordinator-skill.test.ts`
Expected: PASS — whole file green. `GET /api/mail` and `GET /api/feed` are both routes `coord/routes.ts` registers; `GET /api/feed` is in the route-parity EXEMPT set (it is exempt from being REQUIRED, not forbidden), and the forward direction accepts it because the server registers it.

Mutations, reverted between:

1. Delete the clause `a \`worker\` mail with no \`runId\` is refused \`unknown-recipient\`` from `mail-envelope.md`'s asymmetry paragraph ONLY, leaving §3's copy.
   Run: same. Expected: FAIL — exactly one row: `mail-envelope.md carries the role rule: a \`worker\` mail with no \`runId\` is refused …`. Then revert, delete §3's copy ONLY, and re-run: FAIL — exactly one row, the `wave-lifecycle.md` one. Two files, two pins, each load-bearing alone.
2. Replace `resolveWorker` with `resolveCoordinator` throughout `mail-envelope.md`.
   Run: same. Expected: FAIL — `keeps the resolved-recipient promise while adding the second role`.
3. Delete the SKILL.md addressing sentence.
   Run: same. Expected: FAIL — `SKILL.md tells the coordinator how to address a worker, in the crossing section`.

- [ ] **Step 5: Commit**

```bash
git add ccd/coordinator-skill/SKILL.md ccd/coordinator-skill/references/mail-envelope.md ccd/coordinator-skill/references/wave-lifecycle.md server/test/coordinator-skill.test.ts
git commit -m "docs(coordinator-skill): two roles on the mail lane, and the runId that keeps them boring"
```

---

## Task 4: The worker skill — the plan may live in another repository, and a reply may name the role

**Files:**
- Modify: `ccd/worker-skill/SKILL.md` — a new section after the clause commentary (`:74-86`), before `## How to call the API` (`:88`)
- Modify: `server/test/worker-skill.test.ts` — a new `describe` appended at the foot of the file

**Interfaces:**
- Consumes: the `worker` role recipient at `POST /api/mail` (wave 1) — the worker never sends to it, it only receives through it; `WORKER_KICKOFF_PREFIX` unchanged.
- Produces: nothing importable. The artefact is the section `## The plan the brief names may live in another repository` in `ccd/worker-skill/SKILL.md`.

**Spec refs:** §3 F3 (worker design, including `homeRepoRoot`/`planRepoPath`/`planSha` and the exact Git-object read), §1 ruling 3 (named immutable object, no mutable-checkout fallback), §6 (no ledger sync — a foreign wave never writes the home repo).

**Mutation table row — "the foreign-plan rule is pinned":** goes RED when the exact named-Git-object command, fail-closed sentence, authority split, commit-here sentence, or role-reply note is deleted or paraphrased. Measured in Step 4.

**Three scans constrain this file and every one of them is easy to trip.** `worker-skill.test.ts:95-103` requires `^\d+\. ` to match EXACTLY the thirteen clause lines — the new section carries NO numbered list at column zero. `:105-117` harvests `\b([a-z]+) (?:clauses|lines)\b` and requires every hit to be `thirteen` — the new prose says "clause 2" and "clause 6", never "two clauses". `:137-152` requires the five destructive verbs to appear only in clause 8 — the new prose names none of them.

Anchor quotes, verified against the working tree. `ccd/worker-skill/SKILL.md:82-90`:

```markdown
**Clause 5 is not a style preference.** A question typed as prose into your
pane renders as a session that has gone quiet; the same question asked with
the AskUserQuestion tool becomes a structured ask the hook captures and the
PWA puts in front of the operator with its options. Free text waits forever.
The tool gets answered.

## How to call the API

Your mail surface is `POST /api/mail` to send, and `GET /api/mail` /
```

`ccd/worker-skill/SKILL.md:66` (clause 6, the one the new section leans on — UNCHANGED by this task):

```markdown
6. Your requirements are the brief plus the plan file it names, including that plan's deviation ledger, and the plan's text governs over your recollection of the spec. Invoke the execution skill the brief names rather than improvising one.
```

- [ ] **Step 1: Write the failing test**

Append to `server/test/worker-skill.test.ts`:

```ts
// ── cross-repo wave 2: the plan may be somewhere else (spec §3 F3) ───────────
//
// Clause 6 says "the plan file it names" and has always meant a file in this
// workspace, because until now there was no other kind. A programme homed in
// another repo makes that assumption load-bearing and wrong: the brief must
// identify an immutable Git object, while every write and commit stays here.
//
// Sentence literals, the CONTRACT's own mechanism: a paraphrase fails as a
// deletion does. Kept OUT of the CONTRACT array on purpose — these are
// guidance, not the thirteen, and adding one there would red the count pins for a
// change that adds no clause.
describe('the worker skill: a plan in another repository (cross-repo wave 2)', () => {
  // WHITESPACE-COLLAPSED, the `readme-holds.test.ts` idiom the sibling suite
  // already names (`coordinator-skill.test.ts:654`): this prose wraps at 80
  // columns, so a raw `toContain` would pin the wrap point rather than the
  // sentence. Kept per-file on purpose — the sibling's own comment gives the
  // reason: it touches nothing shared, so a copy costs one helper and an import
  // would cost a seam.
  const flat = (s: string): string => s.replace(/\s+/g, ' ');

  const FOREIGN: readonly (readonly [string, string])[] = [
    ['the plan may be outside this workspace',
      'the plan file your brief names can sit OUTSIDE this workspace'],
    ['homeRepoRoot is the absolute repository root',
      '`homeRepoRoot`, the absolute path to the home repository root'],
    ['planRepoPath is tracked and repository-relative',
      '`planRepoPath`, the tracked repository-relative plan path with no leading slash'],
    ['planSha is a full immutable identifier',
      '`planSha`, a full 40-hex commit SHA'],
    ['read the named plan Git object exactly',
      'git -C "$homeRepoRoot" show "$planSha:$planRepoPath"'],
    ['producer evidence is conditional on a real dependency',
      'Only a wave that depends on a producer interface carries a producer contract'],
    ['a no-dependency foreign wave carries no producer contract',
      'A foreign-plan wave with no producer-interface dependency requires none of those producer fields and no excerpt.'],
    ['the producer repository root is absolute',
      '`producerRepoRoot`, the absolute path to the producer repository root'],
    ['the producer source path is repository-relative',
      '`producerSourceRepoPath`, the producer source file\'s repository-relative path'],
    ['the producer SHA is the exact merged commit',
      '`producerSha`, the exact full merged producer SHA'],
    ['read the named producer Git object exactly',
      'git -C "$producerRepoRoot" show "$producerSha:$producerSourceRepoPath"'],
    ['an unresolved plan object fails closed',
      'If the repository, commit, or path cannot be resolved, report and stop.'],
    ['an unresolved producer object fails closed',
      'If that producer repository, commit, or path cannot be resolved, report and stop under the same immutable-read rule above.'],
    ['ledgerAbsPath does not double as a plan or producer coordinate',
      '`ledgerAbsPath` is only the absolute programme-ledger path'],
    ['commit only on this workspace branch, in this repository',
      "commit only on this workspace's own branch in THIS repository"],
    ['the contract excerpt is inlined and remains the dispatched shape authority',
      'that inline copy remains the authority for the DISPATCHED INTERFACE SHAPE'],
    ['the producer blob proves provenance without replacing the excerpt',
      'The producer blob at `producerSha` proves the excerpt\'s provenance'],
    ['the named plan blob controls wave requirements',
      'The plan blob read at `planSha` is the authority for the WAVE\'S REQUIREMENTS'],
    ['the current checkout cannot override the dispatch',
      'The current checkout\'s plan is not authoritative for this dispatched wave.'],
    ['a reply may arrive addressed to the role',
      'A reply may arrive addressed to the ROLE `worker`'],
  ];

  it('carries the section at all', () => {
    expect(skill).toContain('## The plan the brief names may live in another repository');
  });

  it.each(FOREIGN)('states %s', (_what, sentence) => {
    expect(flat(skill), `SKILL.md no longer states ${_what}`).toContain(flat(sentence));
  });

  it('adds no new clause and no second numbered list', () => {
    // The count pins above would catch a fourteenth clause; this catches the
    // near-miss that would make THEM unreadable — a numbered list in the new
    // prose, which `^\d+\. ` cannot tell from a clause.
    const numbered = [...skill.matchAll(/^(\d+)\. /gm)].map((m) => Number(m[1]));
    expect(numbered).toEqual(CONTRACT.map((_, i) => i + 1));
  });

  it('names no destructive verb and no run route in the new section', () => {
    // A worker that reads "the home repo" and then reads a run route in the same
    // breath is one prompt away from advancing someone else's run. The run
    // routes belong to the coordinator — this skill says so in its own API
    // section, and the new section must not quietly walk it back.
    const start = skill.indexOf('## The plan the brief names may live in another repository');
    expect(start).toBeGreaterThanOrEqual(0);
    const end = skill.indexOf('\n## ', start + 1);
    const section = skill.slice(start, end === -1 ? undefined : end);
    for (const forbidden of ['ws-rm', 'ws-reap', 'ws-gc', 'ws-archive', 'ws-restore',
      '/advance', '/close', '/dispatch']) {
      expect(section, `the foreign-plan section names ${forbidden}`).not.toContain(forbidden);
    }
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd server && ./node_modules/.bin/vitest run test/worker-skill.test.ts`
Expected: FAIL — the heading pin and every positive `FOREIGN` row whose immutable-plan rule is absent report the missing sentence. `adds no new clause` passes before the section exists and becomes real in Step 4. The thirteen-clause pin and the count pins stay GREEN.

- [ ] **Step 3: Write the section**

Insert into `ccd/worker-skill/SKILL.md` between the `**Clause 5 is not a style preference.**` paragraph (`:82-86`) and `## How to call the API` (`:88`):

```markdown
## The plan the brief names may live in another repository

A programme is homed in ONE repo and its waves may run in any, so the plan file
your brief names can sit OUTSIDE this workspace. Every foreign-plan brief carries
three separate values: `homeRepoRoot`, the absolute path to the home repository
root; `planRepoPath`, the tracked repository-relative plan path with no leading
slash; and `planSha`, a full 40-hex commit SHA. Read that immutable Git object:

```bash
git -C "$homeRepoRoot" show "$planSha:$planRepoPath"
```

If the repository, commit, or path cannot be resolved, report and stop. Never
substitute `HEAD`, treat a mutable checkout read as authority, fetch, checkout, or
otherwise mutate the home repository. `ledgerAbsPath` is only the absolute
programme-ledger path under `docs/superpowers/programs/`; it is not
`homeRepoRoot` and it is not `planRepoPath`. You commit only on this workspace's
own branch in THIS repository (clause 2).

Only a wave that depends on a producer interface carries a producer contract:
`producerRepoRoot`, the absolute path to the producer repository root;
`producerSourceRepoPath`, the producer source file's repository-relative path;
`producerSha`, the exact full merged producer SHA; and the contract excerpt
INLINED in the brief, verbatim from that merged file. A foreign-plan wave with no
producer-interface dependency requires none of those producer fields and no
excerpt. When the producer contract is present, read its immutable Git object:

```bash
git -C "$producerRepoRoot" show "$producerSha:$producerSourceRepoPath"
```

If that producer repository, commit, or path cannot be resolved, report and stop
under the same immutable-read rule above. The inline copy remains the authority
for the DISPATCHED INTERFACE SHAPE — the thing you build against, frozen when the
brief was cut. The producer blob at `producerSha` proves the excerpt's provenance;
it does not replace the excerpt as shape authority. The plan blob read at
`planSha` is the authority for the WAVE'S REQUIREMENTS — what to build and why
(clause 6). The current checkout's plan is not authoritative for this dispatched
wave. Those are different questions, so a disagreement is not a tie to break:
report it in your `wave-done` mail so the ledger gets it. A deviation you find is
still never a number you invent (clause 11): report it, and the coordinator mints
it against the programme's home project.

A reply may arrive addressed to the ROLE `worker` rather than to your session id.
Nothing changes on your side: the role resolves to whichever session this run names,
which is you, the envelope's `to:` is still your own id, you ack the DELIVERY id as
always (clause 3), and you answer `toId:'coordinator'` as always.
```

- [ ] **Step 4: Run it to verify it passes, then measure the mutation**

Run: `cd server && ./node_modules/.bin/vitest run test/worker-skill.test.ts`
Expected: PASS — whole file green: thirteen clauses verbatim, `1..13` with no gaps, the count word still `thirteen` in both prose statements, and the five destructive verbs still counted only inside clause 8.

Mutations, reverted between:

1. Replace `git -C "$homeRepoRoot" show "$planSha:$planRepoPath"` with a direct read of the current checkout.
   Run: same. Expected: FAIL — `states read the named plan Git object exactly` and the mutable-checkout fallback guard.
2. Replace `planSha` in the plan command with `HEAD`.
   Run: same. Expected: FAIL — `states read the named plan Git object exactly` and the explicit `show "HEAD:` negative guard.
3. Replace `git -C "$producerRepoRoot" show "$producerSha:$producerSourceRepoPath"` with a direct read of the mutable source file or with a read through `$PWD`.
   Run: same. Expected: FAIL — `states read the named producer Git object exactly`; the `$PWD` form also fails the two-repository behavioral fixture because the producer object exists only in the producer repository.
4. Delete `If either repository, commit, or path cannot be resolved, report and stop.`
   Run: same. Expected: FAIL — `states an unresolved named object fails closed`.
5. Make the producer blob, rather than the inline excerpt, authoritative for dispatched interface shape.
   Run: same. Expected: FAIL — the dispatched-shape authority and producer-provenance rows.
6. Delete the whole role-reply paragraph.
   Run: same. Expected: FAIL — `states a reply may arrive addressed to the role`.
7. Add a numbered list to the new section (`1. read the plan`).
   Run: same. Expected: FAIL — this task's `adds no new clause and no second numbered list` AND the existing `numbers exactly as many clauses as the CONTRACT pins, 1..N with no gaps`.
8. Write `two clauses` anywhere in the new section.
   Run: same. Expected: FAIL — the existing count-word pin, message `SKILL.md says two where the CONTRACT pins 13`.

- [ ] **Step 5: Commit**

```bash
git add ccd/worker-skill/SKILL.md server/test/worker-skill.test.ts
git commit -m "docs(worker-skill): the plan may live in another repo — read it there, write here"
```

---

## Task 5: The runs board says which repo — the project badge, the crossing marker, and the one tolerant reader

**Files:**
- Modify: `pwa/src/fleet/runWords.ts` — new exports after `programWave` (`:353-358`)
- Modify: `pwa/src/screens/RunsScreen.tsx` — the row body (`:172-180`), the import line (`:37`), and the group header's inline wave label (`:701`)
- Modify: `pwa/src/fleet/fleet.css` — after `.run-ws` (`:1997`)
- Modify: `pwa/test/runs-screen.test.tsx`

**Interfaces:**
- Consumes: `RunSummary.homeProject: string | null` (wave 1, `shared/api.ts`) — read ONLY through `runHomeProject`, never directly.
- Produces:
  - `export const runHomeProject: (run: { homeProject?: string | null }) => string | null` — the ONE reader of that field in `pwa/src`; `null` for absent, non-string or empty.
  - `export const waveLabel: (run: { wave: number; waveOf: number | null }) => string` — `wave 2/5`, or `wave 2` when `waveOf` is null.
  - `export const CROSSING_GLYPH: string`.
  - `export interface CrossingNote { glyph: string; word: string; home: string; title: string }` and `export function crossingNote(run): CrossingNote | null` — `null` unless the home is measured AND differs from the run's own project.
  - The classes `.run-project`, `.run-crossing`, `.run-crossing-glyph`.

**Spec refs:** §3 F4 (runs screen: the badge on every row, the marker's two cues, the null-home silence), §3 F2 (`RunSummary.homeProject` is why the board can know).

**Mutation table rows:**
- Row "the badge is on every row" — RED when the `.run-project` span is deleted.
- Row "the marker's two cues" — RED when either the glyph or the word is dropped from `.run-crossing`.
- Row "the marker is silent on a null home" — RED when `crossingNote` stops returning `null` for an absent/null `homeProject` (spec §7's own row: "the marker shows while `homeProject` is null").
- Row "the marker is silent on a same-project home" — RED when the `home === run.project` arm is deleted.
- Row "one tolerant reader" — RED when `runHomeProject` stops answering `null` for a row from an older server that omits the key entirely.

Anchor quotes, verified against the working tree. `pwa/src/fleet/runWords.ts:353-358`:

```ts
export function programWave(list: readonly RunSummary[]): { wave: number; waveOf: number | null } {
  let best = list[0];
  if (best === undefined) return { wave: 0, waveOf: null };
  for (const run of list) if (run.wave > best.wave) best = run;
  return { wave: best.wave, waveOf: best.waveOf };
}
```

`pwa/src/screens/RunsScreen.tsx:172-180`:

```tsx
  const body = (
    <>
      <span className="run-glyph" aria-hidden="true">{RUN_GLYPH[state]}</span>
      <span className="run-state">{RUN_WORD[state]}</span>
      <span className="run-ws">{run.workspace ?? run.branch ?? String(run.id)}</span>
      <span className="run-tally">{itemTallyLabel(items)}</span>
      <span className="run-when">
        {run.dispatchedAt === null ? '—' : formatAge(nowSec - Math.floor(run.dispatchedAt / 1000))}
      </span>
```

`pwa/src/screens/RunsScreen.tsx:699-702`:

```tsx
                <p className="runs-group-head">
                  <span className="runs-program">{program}</span>
                  <span className="runs-wave">wave {wave}{waveOf === null ? '' : `/${waveOf}`}</span>
                </p>
```

`pwa/src/fleet/fleet.css:1995-2000`:

```css
.run-row .run-glyph { color: var(--ink-tertiary); }
.run-row .run-state { font-size: var(--text-xs); color: var(--ink-secondary); }
.run-ws { font-size: var(--text-sm); }
.run-row .run-tally, .run-row .run-when {
  font-size: var(--text-2xs); font-variant-numeric: tabular-nums; color: var(--ink-tertiary);
}
```

`pwa/test/runs-screen.test.tsx:29-33` — the fixture every case here builds on (its `homeProject` default is wave 1's; see Prerequisites):

```ts
const r = (over: Partial<RunSummary> = {}): RunSummary => ({
  id: 3, program: 'build4-transcript-surface', programTitle: 'Build 4: transcript surface',
  wave: 3, waveOf: 4, project: 'ccrc-pwa',
  sessionId: 'ccrc-pwa-clear-cove', workspace: 'clear-cove', branch: 'ws/clear-cove',
  state: 'working', claimedBy: 'ccrc-pwa-coordinator', resumed: false, clearedAt: null,
```

- [ ] **Step 1: Write the failing tests**

Add to `pwa/test/runs-screen.test.tsx`. First extend the import at `:6` so the new names resolve:

```ts
import { CROSSING_GLYPH, RUN_ORDER, RUN_WORD, crossingNote, dispatchWindow, itemTallyLabel, programWave, programsWithOpenRun, resumeNote, runHomeProject, runItems, waveLabel } from '../src/fleet/runWords';
```

Then append:

```ts
// ── cross-repo wave 2: which repo is this run in, and whose programme is it? ──
//
// TWO facts, never one. `run.project` is where the WORK is happening and is
// true of every row; `homeProject` is where the PROGRAMME lives, and the pair
// differing is the only thing that makes a row a crossing. The badge is
// unconditional (a board that names the repo only sometimes teaches the reader
// nothing); the marker is conditional and its condition is a MEASUREMENT, which
// is why `runHomeProject` exists rather than a `??` at the call site.
describe('runHomeProject — the one tolerant reader of an additive wire field', () => {
  it('answers the home when the server sent one', () => {
    expect(runHomeProject(r({ homeProject: 'home-repo' }))).toBe('home-repo');
  });

  it('answers null for the legacy generation, where the column is genuinely NULL', () => {
    expect(runHomeProject(r({ homeProject: null }))).toBeNull();
  });

  it('answers null for a row from a server that never heard of the field', () => {
    // The case the static type cannot express and the wire produces anyway:
    // `api.runs()` is a bare cast and the `{type:'runs'}` frame is validated at
    // the ARRAY level only, so an older server's row reaches this renderer with
    // the key missing. A raw `run.homeProject !== null` reads `undefined !==
    // null` as TRUE and paints a crossing marker naming `undefined`.
    // `Partial<RunSummary>` rather than an intersection: `homeProject` is
    // REQUIRED on the wire type, and `delete` on a required property does not
    // compile — which is itself the point. The runtime shape this models is one
    // TypeScript says cannot exist and the network produces anyway.
    const older: Partial<RunSummary> = { ...r() };
    delete older.homeProject;
    expect(runHomeProject(older)).toBeNull();
  });

  it('answers null for an empty string — a home nobody can navigate to is not a home', () => {
    expect(runHomeProject(r({ homeProject: '' }))).toBeNull();
  });
});

describe('crossingNote — a crossing is a measured difference, never an absence', () => {
  it('is a note when the home differs from the run’s own project', () => {
    const note = crossingNote(r({ project: 'other-repo', homeProject: 'home-repo' }));
    expect(note).not.toBeNull();
    expect(note!.home).toBe('home-repo');
    expect(note!.glyph).toBe(CROSSING_GLYPH);
    expect(note!.word).toBe('crossing');
    expect(note!.title).toContain('other-repo');
    expect(note!.title).toContain('home-repo');
  });

  it('is null when the home is the run’s own project — measured sameness', () => {
    expect(crossingNote(r({ project: 'home-repo', homeProject: 'home-repo' }))).toBeNull();
  });

  it('is null while the home is unknown — absence permits (spec §3 F4)', () => {
    expect(crossingNote(r({ project: 'other-repo', homeProject: null }))).toBeNull();
  });
});

describe('waveLabel — one spelling of `wave N/M`', () => {
  it('spells both shapes', () => {
    expect(waveLabel({ wave: 2, waveOf: 5 })).toBe('wave 2/5');
    expect(waveLabel({ wave: 2, waveOf: null })).toBe('wave 2');
  });

  it('is what the group header renders — the header no longer spells it inline', () => {
    const store = makeStore();
    act(() => { store.setState({ runs: [r()], runsFrameSeen: true }); });
    render(<RunsScreen store={store} loadRuns={async () => ({ runs: [] })} loadCaps={NO_CAPS} />);
    expect(screen.getByText(waveLabel({ wave: 3, waveOf: 4 }))).toBeInTheDocument();
  });
});

describe('the run row names its repo', () => {
  const board = (run: RunSummary): void => {
    const store = makeStore();
    act(() => { store.setState({ runs: [run], runsFrameSeen: true }); });
    render(<RunsScreen store={store} loadRuns={async () => ({ runs: [] })} loadCaps={NO_CAPS} />);
  };

  it('badges EVERY row with the run’s own project', () => {
    board(r({ project: 'other-repo', homeProject: 'home-repo' }));
    expect(document.querySelector('.run-project')?.textContent).toBe('other-repo');
  });

  it('badges a row that is not a crossing too — the badge is not the marker', () => {
    board(r({ project: 'home-repo', homeProject: 'home-repo' }));
    expect(document.querySelector('.run-project')?.textContent).toBe('home-repo');
    expect(document.querySelector('.run-crossing')).toBeNull();
  });

  it('marks a crossing with BOTH cues and names the home in the title', () => {
    board(r({ project: 'other-repo', homeProject: 'home-repo' }));
    const marker = document.querySelector('.run-crossing');
    expect(marker).not.toBeNull();
    expect(marker!.querySelector('.run-crossing-glyph')?.textContent).toBe(CROSSING_GLYPH);
    expect(marker!.textContent).toContain('crossing');
    expect(marker!.getAttribute('title')).toContain('home-repo');
    // The glyph is decoration for the word, never the carrier of the fact.
    expect(marker!.querySelector('.run-crossing-glyph')?.getAttribute('aria-hidden')).toBe('true');
  });

  it('stays silent while homeProject is null — the legacy generation renders as it always did', () => {
    board(r({ project: 'other-repo', homeProject: null }));
    expect(document.querySelector('.run-project')?.textContent).toBe('other-repo');
    expect(document.querySelector('.run-crossing')).toBeNull();
  });
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `cd pwa && ./node_modules/.bin/vitest run test/runs-screen.test.tsx`
Expected: FAIL — the file does not even load: `SyntaxError`/`does not provide an export named 'runHomeProject'` from the import line. That is the honest first red; it becomes assertion-level red after Step 3a.

- [ ] **Step 3a: Write the decisions in `runWords.ts`**

Append to `pwa/src/fleet/runWords.ts`, after `programWave` (`:358`):

```ts
/* ── cross-repo: which repo, and whose programme (spec §3 F4) ─────────────── */

/**
 * The programme's HOME project, tolerantly — the ONE reader of
 * `RunSummary.homeProject` in `pwa/src`.
 *
 * The field is declared REQUIRED on the wire type and is still optional at
 * RUNTIME, the same measured skew `runItems`/`runClosedAt`/`graphReadCount`
 * already carry: `api.runs()` is a bare cast and the `{type:'runs'}` frame is
 * shape-checked at the array level only, so a row from a server that predates
 * this field arrives with the key missing. `undefined !== null` is true, so a
 * raw comparison at a call site paints a crossing marker naming `undefined` —
 * which is why every reader goes through here.
 *
 * THREE conditions collapse to `null` and that is deliberate, not an overloaded
 * null: absent, non-string and empty all mean "this board cannot name a home",
 * and the caller's answer to each is the same silence. What must NOT collapse
 * into it is a home that is genuinely the run's own project — that is a
 * measured sameness, and `crossingNote` decides it separately, below.
 */
export const runHomeProject = (run: { homeProject?: string | null }): string | null =>
  typeof run.homeProject === 'string' && run.homeProject !== '' ? run.homeProject : null;

/** `wave 2/5`, or `wave 2` when the programme declared no total. One spelling,
 *  three callers (the group header, the card's orphan marker, the card's abroad
 *  line) — a fragment this small is exactly the kind that drifts into four
 *  slightly different ones. */
export const waveLabel = (run: { wave: number; waveOf: number | null }): string =>
  run.waveOf === null ? `wave ${run.wave}` : `wave ${run.wave}/${run.waveOf}`;

/** The one glyph both crossing surfaces draw. A GLYPH, beside a WORD, never
 *  instead of one: the board's standing rule is that nothing is read out of
 *  colour or shape alone. */
export const CROSSING_GLYPH = '⇄';

export interface CrossingNote {
  readonly glyph: string;
  readonly word: string;
  /** The programme's home project — measured, never inferred. */
  readonly home: string;
  readonly title: string;
}

/**
 * What the board says about a wave running outside its programme's home repo,
 * or `null` when there is nothing to say. TWO ways to get `null` and they are
 * different facts kept apart on purpose:
 *   • the home is UNKNOWN (legacy generation, or an older server) — absence
 *     permits, and a marker here would be this build asserting a crossing it
 *     never measured;
 *   • the home IS this run's project — measured, and a marker would be a lie.
 * Neither renders, which is why they may share a return value: the CALLER does
 * the same thing with both, and the distinction that matters (is there a home
 * at all) is `runHomeProject`'s, one line up.
 */
export function crossingNote(
  run: { project: string; homeProject?: string | null },
): CrossingNote | null {
  const home = runHomeProject(run);
  if (home === null || home === run.project) return null;
  return {
    glyph: CROSSING_GLYPH,
    word: 'crossing',
    home,
    title: `this wave runs in ${run.project}; its programme is homed in ${home}`,
  };
}
```

- [ ] **Step 3b: Render it in `RunsScreen.tsx`**

Extend the import at `:37`. `CROSSING_GLYPH` is NOT added here — the row body below reads `crossing.glyph` off the `CrossingNote` `crossingNote` returns, never the constant directly, so an import of the bare name would sit unused, and `pwa/tsconfig.json`'s `noUnusedLocals` (true) would red `tsc --noEmit` at this step's own build check (Step 4, below) — `vitest` alone would not have caught it, since `vitest` never typechecks. (The test file at `pwa/test/runs-screen.test.tsx` DOES import `CROSSING_GLYPH` directly — that is where it is used, to assert the marker's glyph equals the constant.)

```tsx
import { DISPATCH_GLYPH, RUN_GLYPH, RUN_WORD, anyDispatchPending, crossingNote, dispatchWindow, isRunClosed, itemTallyLabel, programWave, programsWithOpenRun, resumeNote, runWarnings, runClosedAt, runItems, runState, runsByProgram, waveLabel } from '../fleet/runWords';
```

Beside the row's other derived facts (after `const resume = resumeNote(run, nowSec);`, `:167`):

```tsx
  // F4. TWO facts, and only one of them is conditional: the run's own project is
  // rendered on every row (a badge that appears only sometimes teaches nothing),
  // while the crossing marker is `crossingNote`'s single answer — silent when the
  // home is unknown, silent when the home IS this project, two cues when it is
  // neither. This component compares nothing.
  const crossing = crossingNote(run);
```

And in the row body, immediately after the `.run-ws` span (`:176`):

```tsx
      <span className="run-project">{run.project}</span>
      {crossing !== null && (
        <span className="run-crossing" data-home={crossing.home} title={crossing.title}>
          <span className="run-crossing-glyph" aria-hidden="true">{crossing.glyph}</span>
          {crossing.word}
        </span>
      )}
```

And the group header at `:701` stops spelling the label inline:

```tsx
                  <span className="runs-wave">{waveLabel({ wave, waveOf })}</span>
```

- [ ] **Step 3c: Style it**

Insert into `pwa/src/fleet/fleet.css` immediately after `.run-ws` (`:1997`):

```css
/* F4 (cross-repo): which repo this run is in, and whether that is its
   programme's home. Scoped under `.run-row` — self-grounded above, background
   and colour both set — so these inherit the same recovered ground
   `.run-row .run-state`/`.run-row .run-dispatch` do: no new token pair for
   `design/contrast-check.mjs` to price. The badge takes `--ink-tertiary` (it is
   context, present on every row, and must not compete with the workspace name);
   the marker takes `--ink-secondary`, one step up, because it is the rarer fact
   — and it is told apart by its GLYPH and its WORD, never by a hue. */
.run-row .run-project { font-size: var(--text-2xs); color: var(--ink-tertiary); }
.run-row .run-crossing {
  display: inline-flex; align-items: baseline; gap: var(--sp-1);
  min-width: 0;
  font-size: var(--text-2xs);
  color: var(--ink-secondary);
}
.run-row .run-crossing-glyph { color: var(--ink-tertiary); }
```

- [ ] **Step 4: Run them to verify they pass**

Run: `cd pwa && ./node_modules/.bin/vitest run test/runs-screen.test.tsx`
Expected: PASS — the whole file, including every case that predates this task (they carry `homeProject: null` from the fixture default, so they render exactly as before: a badge, no marker).

Then the type-check and the two neighbours this row shares a file with:

Run: `cd pwa && ./node_modules/.bin/vitest run test/runs-health.test.tsx test/tap-targets.test.tsx`
Expected: PASS — the warn row and the tap floor are unchanged; a new inline span inside `.run-row` must not push a control off the row.

Then the build — `vitest` never typechecks, and an unused import (`CROSSING_GLYPH`, if Step 3b's import line were copied verbatim instead of as corrected above) would ride silently past every `vitest` run in this task and the next unless a build is run here:

Run: `cd pwa && npm run build`
Expected: `tsc --noEmit` clean, then a vite build. This is the step that would catch `CROSSING_GLYPH` sitting in the import with no reference in the file body (`noUnusedLocals`).

- [ ] **Step 5: Measure the mutations**

Each one alone, reverted before the next.

1. Delete the `<span className="run-project">` line from `RunsScreen.tsx`.
   Run: `cd pwa && ./node_modules/.bin/vitest run test/runs-screen.test.tsx`
   Expected: FAIL — 2 failing: `badges EVERY row with the run's own project` and `badges a row that is not a crossing too`, `expected undefined to be 'other-repo'`.
2. Drop the glyph span from the marker (leave the word).
   Run: same. Expected: FAIL — `marks a crossing with BOTH cues and names the home in the title`, `expected undefined to be '⇄'`.
3. In `crossingNote`, change `if (home === null || home === run.project)` to `if (home === run.project)`.
   Run: same. Expected: FAIL — `is null while the home is unknown — absence permits` (a note is built naming `null` as the home) AND `stays silent while homeProject is null`. This is spec §7's own row.
4. In `crossingNote`, change the same line to `if (home === null)`.
   Run: same. Expected: FAIL — `is null when the home is the run's own project — measured sameness`.
5. In `runHomeProject`, change the body to `run.homeProject ?? null`.
   Run: same. Expected: FAIL — `answers null for a row from a server that never heard of the field` stays GREEN (`undefined ?? null` is `null`), and `answers null for an empty string` FAILS (`'' ?? null` is `''`). Then also change it to `(run.homeProject as string | null)` and re-run: `answers null for a row from a server that never heard of the field` fails with `expected undefined to be null`. Both halves of the reader are load-bearing and each is measured by its own case.
6. Revert `:701` to the inline label (`wave {wave}{waveOf === null ? '' : `/${waveOf}`}`).
   Run: same. Expected: PASS — and that is the honest result to record: the conversion is a de-duplication, not a guard, so its "mutation" is byte-identical output. What the pin at `is what the group header renders` buys is the DIRECTION: if `waveLabel` ever stops agreeing with the header, that case reds. Do not invent a red that does not exist.

- [ ] **Step 6: Commit**

```bash
git add pwa/src/fleet/runWords.ts pwa/src/screens/RunsScreen.tsx pwa/src/fleet/fleet.css pwa/test/runs-screen.test.tsx
git commit -m "feat(pwa): the run board names its repo, and marks a wave working outside its programme's home"
```

---

## Task 6: The fleet card explains its orphan — the rule-3 worker row says which programme and whose home

**Files:**
- Modify: `pwa/src/fleet/ProjectCard.tsx` — a new derivation beside `openRunFor` (`:198-199`) and the depth-0 branch of the row map (`:296-309`)
- Modify: `pwa/src/fleet/fleet.css` — after `.proj-pending-elapsed` (`:1661-1666`)
- Modify: `pwa/design/audit.mjs` — two new `INHERITED_GROUNDS` entries (`:519-560`), added WITH the rule (fix round 1, finding 6): `.proj-crossing`/`.proj-crossing-glyph` name no ancestor in their own selector, so no automatic route grounds them
- Modify: `pwa/test/project-card.test.tsx`
- UNCHANGED, and proven so in Step 5: `pwa/src/fleet/nestFleet.ts`, `pwa/test/nestFleet.test.ts`

**Interfaces:**
- Consumes: `runHomeProject`, `waveLabel`, `CROSSING_GLYPH` (Task 5, `pwa/src/fleet/runWords.ts`); `runForSession` (existing, same file); `nestFleet`'s `FleetRow` and its rule 3 (existing, unchanged).
- Produces: the classes `.proj-crossing`, `.proj-crossing-glyph`, and the marker text `<program> <waveLabel> · home <project>` on a rule-3 orphan worker row; the two `INHERITED_GROUNDS` entries that measure them.

**Spec refs:** §3 F4 ("Fleet board, the worker's card" — the worker stays on its own project's card, `nestFleet` stays pure, the marker is computed in the card from the run it already has).

**Mutation table rows:**
- Row "the orphan is explained" — RED when the marker is dropped from the depth-0 branch.
- Row "the marker is the ORPHAN's, not every row's" — RED when the `group.sessions.some(...)` guard goes: a bracketed child would then carry a marker too, which is a second sentence saying what the bracket already says.
- Row "the home clause is measured" — RED when the marker names a home while `homeProject` is null.
- Row "the tree did not move" — `nestFleet.test.ts` green, unchanged, and `project-card.test.tsx`'s existing bracket cases green.

Anchor quotes, verified against the working tree. `pwa/src/fleet/ProjectCard.tsx:184` and `:198-199`:

```tsx
  const rows = nestFleet(group.sessions, runs);
```

```tsx
  const openRunFor = (session: FleetSession): (() => void) | null =>
    runForSession(runs, session.id) === null ? null : () => navigate('/runs');
```

`pwa/src/fleet/ProjectCard.tsx:296-309`:

```tsx
          {rows.map((row) =>
            row.depth === 0 ? (
              // A Fragment, never a wrapper element: the top-level row's DOM
              // has to stay byte-identical to the one that shipped before this
              // task, and `.proj-card-body`'s column flex lays out its
              // children directly.
              <Fragment key={rowKey(row)}>{rowBody(row)}</Fragment>
            ) : (
              <div key={rowKey(row)} className="proj-nest" data-depth={row.depth}>
                <span className="proj-nest-bracket" aria-hidden="true">{NEST_BRACKET}</span>
                {rowBody(row)}
              </div>
            ),
          )}
```

`pwa/test/project-card.test.tsx:444` — the orphan fixture this task's cases build on, already in the file:

```tsx
    const orphaned = runFor({ id: 11, sessionId: 'demo-still-cove', claimedBy: 'other-project-coordinator' });
```

- [ ] **Step 1: Write the failing tests**

Extend `pwa/test/project-card.test.tsx`'s import of the fleet vocabulary (add beside the existing `NEST_BRACKET, ProjectCard` import):

```tsx
import { CROSSING_GLYPH, waveLabel } from '../src/fleet/runWords';
```

Append:

```tsx
// ── cross-repo wave 2: the orphan gets a sentence (spec §3 F4) ───────────────
//
// `nestFleet`'s rule 3 is right and stays: a worker whose coordinator sits on
// another project's card is NOT bracketed, because a `└─` may not cross two
// cards. What it left behind was a row at depth 0 that looks exactly like an
// ordinary session and is not one — correct, and silent. The card has the run in
// its hand; the marker is one sentence built from it, and the TREE does not move.
describe('the orphan worker says which programme it belongs to', () => {
  const orphanRun = runFor({
    id: 11, program: 'build9b', wave: 2, waveOf: 3,
    project: 'demo', sessionId: 'demo-still-cove', claimedBy: 'off-card-coordinator',
    homeProject: 'home-repo',
  });

  it('explains the row rule 3 leaves flat, naming the programme, the wave and the home', () => {
    const g = grp({ sessions: [sess(), sess({ id: 'demo-still-cove', workspace: 'still-cove' })] });
    const { container } = render(
      <ProjectCard group={g} runs={[orphanRun]} nowMs={FROZEN}
                   onOpen={() => {}} onActions={() => {}} />);
    // The tree is untouched: no bracket was drawn across cards.
    expect(container.querySelector('.proj-nest')).toBeNull();
    const marker = container.querySelector('.proj-crossing');
    expect(marker).not.toBeNull();
    expect(marker!.textContent).toContain('build9b');
    expect(marker!.textContent).toContain(waveLabel({ wave: 2, waveOf: 3 }));
    expect(marker!.textContent).toContain('home home-repo');
    expect(marker!.querySelector('.proj-crossing-glyph')?.textContent).toBe(CROSSING_GLYPH);
  });

  it('says the programme and wave WITHOUT a home clause while homeProject is null', () => {
    // The legacy generation. The orphan is still worth explaining — its
    // coordinator IS elsewhere, measured off `claimedBy` — but nothing measured
    // a home, so nothing claims one.
    const g = grp({ sessions: [sess(), sess({ id: 'demo-still-cove', workspace: 'still-cove' })] });
    const { container } = render(
      <ProjectCard group={g} runs={[{ ...orphanRun, homeProject: null }]} nowMs={FROZEN}
                   onOpen={() => {}} onActions={() => {}} />);
    const marker = container.querySelector('.proj-crossing');
    expect(marker).not.toBeNull();
    expect(marker!.textContent).toContain('build9b');
    expect(marker!.textContent).not.toContain('home');
  });

  it('marks NO row when the coordinator is on this very card — the bracket already says it', () => {
    // `pair` is the coordinator + worker fixture; `childRun` is bracketed. A
    // marker here would be a second sentence saying what the `└─` says. This
    // one passes on the DEPTH check alone, which is why the rule-4 case below
    // exists: depth 0 is not proof that a coordinator is elsewhere.
    const { container } = render(
      <ProjectCard group={pair} runs={[childRun]} nowMs={FROZEN}
                   onOpen={() => {}} onActions={() => {}} />);
    expect(container.querySelector('.proj-nest')).not.toBeNull();
    expect(container.querySelector('.proj-crossing')).toBeNull();
  });

  it('marks no row at RULE 4 either, where a worker that is also a parent stays flat', () => {
    // `nestFleet` rule 4: a session that is both a child of one run and the
    // parent of another renders at TOP level with its own children beneath it.
    // So a depth-0 row is NOT evidence that its coordinator is off this card —
    // and without the `group.sessions.some(...)` guard this row would carry
    // "this worker's coordinator is not on this card" while that coordinator is
    // rendered two lines above it. This case is the guard's only witness.
    const coord = sess();                                             // demo-quiet-mesa
    const middle = sess({ id: 'demo-still-cove', workspace: 'still-cove' });
    const leaf = sess({ id: 'demo-far-bank', workspace: 'far-bank' });
    const g = grp({ sessions: [coord, middle, leaf] });
    const { container } = render(
      <ProjectCard
        group={g}
        runs={[
          runFor({ id: 20, sessionId: 'demo-still-cove', claimedBy: 'demo-quiet-mesa' }),
          runFor({ id: 21, sessionId: 'demo-far-bank', claimedBy: 'demo-still-cove' }),
        ]}
        nowMs={FROZEN}
        onOpen={() => {}}
        onActions={() => {}}
      />);
    // The leaf is bracketed under the middle row; the middle row stays flat.
    expect(container.querySelectorAll('.proj-nest')).toHaveLength(1);
    expect(container.querySelector('.proj-crossing')).toBeNull();
  });

  it('marks no row on a card with no runs at all', () => {
    const { container } = render(
      <ProjectCard group={pair} runs={[]} nowMs={FROZEN}
                   onOpen={() => {}} onActions={() => {}} />);
    expect(container.querySelector('.proj-crossing')).toBeNull();
  });

  it('leaves the marked row itself byte-identical — the marker is a SIBLING, not a wrapper', () => {
    // The same control the bracket cases use: a row that gains an explanation
    // must not gain a wrapper, lose its tap surface or change its own DOM.
    const g = grp({ sessions: [sess(), sess({ id: 'demo-still-cove', workspace: 'still-cove' })] });
    const plain = render(
      <ProjectCard group={g} runs={[]} nowMs={FROZEN} onOpen={() => {}} onActions={() => {}} />);
    const before = plain.container.querySelectorAll('.sess-line')[1]?.outerHTML;
    cleanup();
    const { container } = render(
      <ProjectCard group={g} runs={[orphanRun]} nowMs={FROZEN} onOpen={() => {}} onActions={() => {}} />);
    const after = container.querySelectorAll('.sess-line')[1]?.outerHTML;
    expect(after).toBe(before);
  });
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `cd pwa && ./node_modules/.bin/vitest run test/project-card.test.tsx`
Expected: FAIL — 2 failing (`explains the row rule 3 leaves flat…` and `says the programme and wave WITHOUT a home clause…`), both `expected null not to be null` on `.proj-crossing`. The four negative cases pass already, which is what makes them controls rather than claims.

- [ ] **Step 3: Implement**

3a. `pwa/src/fleet/ProjectCard.tsx` — extend the `runWords` import at `:23`:

```tsx
import { CROSSING_GLYPH, DISPATCH_GLYPH, dispatchWindow, runForSession, runHomeProject, waveLabel } from './runWords';
```

3b. Add the derivation immediately after `openRunFor` (`:199`):

```tsx
  // F4. `nestFleet`'s rule 3 leaves a worker whose coordinator is NOT on this
  // card at depth 0, unbracketed — right, and until now silent. This is the
  // sentence that ends the silence, computed HERE (the level that holds the
  // runs) from the run the card already has, so the tree stays pure and its
  // five rules stay exactly as they are.
  //
  // TWO facts, stated only when measured. The programme and wave come off the
  // run itself and are always available. The HOME clause needs
  // `runHomeProject` to answer, and while it answers `null` — the legacy
  // generation, or an older server — the marker says nothing about a home
  // rather than naming `undefined` or guessing this card's own project.
  //
  // The `group.sessions.some(...)` guard is what makes this the ORPHAN's marker
  // and not every worker's: a child whose parent IS on this card is bracketed,
  // and the bracket already says what this sentence would say.
  const orphanNote = (row: FleetRow): { text: string; title: string } | null => {
    if (row.kind !== 'session' || row.depth !== 0) return null;
    const run = runForSession(runs, row.session.id);
    if (run === null) return null;
    const parent = run.claimedBy;
    if (parent === null || parent === row.session.id) return null;
    if (group.sessions.some((s) => s.id === parent)) return null;
    const home = runHomeProject(run);
    const label = `${run.program} ${waveLabel(run)}`;
    return home === null || home === run.project
      ? { text: label, title: `this worker's coordinator is not on this card` }
      : {
          text: `${label} · home ${home}`,
          title: `this worker's coordinator is not on this card; the programme is homed in ${home}`,
        };
  };
```

3c. Replace the row map (`:296-309`) with:

```tsx
          {rows.map((row) => {
            const note = orphanNote(row);
            return row.depth === 0 ? (
              // A Fragment, never a wrapper element: the top-level row's DOM
              // has to stay byte-identical to the one that shipped before the
              // tree existed, and `.proj-card-body`'s column flex lays out its
              // children directly. The marker is a SIBLING line for the same
              // reason — a wrapper would change the row it explains.
              <Fragment key={rowKey(row)}>
                {rowBody(row)}
                {note !== null && (
                  <div className="proj-crossing" title={note.title}>
                    <span className="proj-crossing-glyph" aria-hidden="true">{CROSSING_GLYPH}</span>
                    {note.text}
                  </div>
                )}
              </Fragment>
            ) : (
              <div key={rowKey(row)} className="proj-nest" data-depth={row.depth}>
                <span className="proj-nest-bracket" aria-hidden="true">{NEST_BRACKET}</span>
                {rowBody(row)}
              </div>
            );
          })}
```

3d. `pwa/src/fleet/fleet.css` — insert after `.proj-pending-elapsed` (`:1666`):

```css
/* F4 (cross-repo): the sentence under a rule-3 orphan. NOT a tap surface and
   never a --glow — it explains a row, it is not a row — and it takes
   `--ink-tertiary` on `.proj-card-body`'s own ground, the register
   `.proj-nest-bracket` and `.proj-pending-program` already use here: the
   quietest thing on the card, because the row above it carries the fact. */
.proj-crossing {
  display: flex;
  align-items: baseline;
  gap: var(--sp-1);
  min-width: 0;
  padding-left: var(--sp-3);
  font-size: var(--text-2xs);
  color: var(--ink-tertiary);
}
.proj-crossing-glyph { flex: none; color: var(--ink-tertiary); }
```

3e. `pwa/design/audit.mjs` — register both rules in `INHERITED_GROUNDS` (fix round 1, finding 6). Neither selector names an ancestor, so no route grounds them automatically and they would otherwise land in the uncovered census unpriced — measured directly: `node design/contrast-check.mjs` against a scratch copy of `fleet.css` with these two rules added shows no PASS line for either, and the uncovered count rises by two; registered, both PASS at 5.77 dark / 5.70 light. Insert as two new entries immediately before the closing `};` of the object (`pwa/design/audit.mjs:519-560`, currently closed by `"fleet.css .sess-spawn[data-spawn='expired'], .sess-spawn[data-spawn='unrecognised']"` at `:556-559`):

```js
  'fleet.css .proj-crossing': {
    under: ['var(--bg-surface)'],
    why: "the rule-3 orphan's programme note (F4, cross-repo wave 2) sits directly on .proj-card-body's own ground, same register .proj-nest-bracket and .proj-pending-program already use here. It sets no background of its own and its selector names no ancestor, so no route could ground it",
  },
  'fleet.css .proj-crossing-glyph': {
    under: ['var(--bg-surface)'],
    why: 'the same marker\'s glyph. Registered separately for the reason the .auth-block-sub entry states: grounding only the base rule would leave the glyph half of the marker unmeasured while the report looked complete',
  },
```

- [ ] **Step 4: Run them to verify they pass**

Run: `cd pwa && ./node_modules/.bin/vitest run test/project-card.test.tsx`
Expected: PASS — the whole file, the existing bracket cases included: `brackets and indents a child row`, `renders neither bracket nor indent on a top-level row`, and `leaves every affordance on a nested row exactly as it is on a top-level one` (whose flat control is the `orphaned` run at `:444` — it now renders a marker BESIDE the row, and that case compares `.sess-line` elements, which are untouched).

Then the contrast gate, which is what the two new `INHERITED_GROUNDS` entries are for:

Run: `cd pwa && ./node_modules/.bin/vitest run test/contrast.test.ts`
Expected: PASS — `.proj-crossing` and `.proj-crossing-glyph` both print `PASS 5.77 (min 4.5) DARK` / `PASS 5.70 (min 4.5) LIGHT`, the uncovered census is unchanged from before this task, and `has no stale inherited registry entry, and it is not empty` stays green with a larger count.

- [ ] **Step 5: Prove the tree did not move**

Run: `cd pwa && ./node_modules/.bin/vitest run test/nestFleet.test.ts`
Expected: PASS, unchanged — and `git status --short pwa/src/fleet/nestFleet.ts pwa/test/nestFleet.test.ts` prints NOTHING. The card explains the tree; it does not reshape it.

- [ ] **Step 6: Measure the mutations**

Each alone, reverted before the next.

1. Delete the `{note !== null && (…)}` block from the depth-0 branch.
   Run: `cd pwa && ./node_modules/.bin/vitest run test/project-card.test.tsx`
   Expected: FAIL — 2 failing, both `expected null not to be null` on `.proj-crossing`.
2. Delete the `if (group.sessions.some((s) => s.id === parent)) return null;` guard.
   Run: same. Expected: FAIL — exactly one case: `marks no row at RULE 4 either, where a worker that is also a parent stays flat`, `expected <div class="proj-crossing"> to be null`. The plain bracketed case stays GREEN, because a bracketed child is at depth 1 and the `row.depth !== 0` line already refused it — measured, and the reason this rule-4 case had to exist: the depth check and this guard refuse DIFFERENT rows, and only one of them had a witness.
3. In `orphanNote`, replace the home arm with `text: `${label} · home ${home ?? run.project}``.
   Run: same. Expected: FAIL — `says the programme and wave WITHOUT a home clause while homeProject is null`, `expected '…· home demo' not to contain 'home'`.
4. Wrap the depth-0 row in a `<div>` instead of the Fragment.
   Run: same. Expected: FAIL — `leaves the marked row itself byte-identical` stays green (it compares `.sess-line`s) but `renders neither bracket nor indent on a top-level row` and the affordance-identity case red on the changed structure. Record which: this mutation is why the marker is a sibling and not a wrapper.

- [ ] **Step 7: Commit**

```bash
git add pwa/src/fleet/ProjectCard.tsx pwa/src/fleet/fleet.css pwa/design/audit.mjs pwa/test/project-card.test.tsx
git commit -m "feat(pwa): the card explains its orphan — which programme, which wave, whose home"
```

---

## Task 7: The home card says where its waves went — the additive `abroad` list

**Files:**
- Modify: `pwa/src/screens/FleetScreen.tsx` — the `runWords` import (`:22`) and the `ProjectCard` call (`:483-498`)
- Modify: `pwa/src/fleet/ProjectCard.tsx` — a new prop beside `runs` (`:118-123`) and a block at the foot of `.proj-card-body`
- Modify: `pwa/src/fleet/fleet.css` — beside `.proj-crossing` (Task 6)
- Modify: `pwa/design/audit.mjs` — two new `INHERITED_GROUNDS` entries, added WITH the rule (fix round 1, finding 6, same shape as Task 6's): `.proj-abroad-line`/`.proj-abroad-glyph` name no ancestor in their own selector
- Modify: `pwa/test/project-card.test.tsx`, `pwa/test/fleet-screen.test.tsx`

**Interfaces:**
- Consumes: `runHomeProject`, `waveLabel`, `CROSSING_GLYPH` (Task 5).
- Produces: `abroad?: readonly RunSummary[]` on `ProjectCard` — ADDITIVE, defaults `[]`, so every existing caller and every existing test renders exactly as before; the classes `.proj-abroad`, `.proj-abroad-line` and `.proj-abroad-glyph`; and the two `INHERITED_GROUNDS` entries (`.proj-abroad-line`, `.proj-abroad-glyph`) that measure the colour-bearing pair of them.

**Spec refs:** §3 F4 ("Fleet board, the home card": one sentence per wave abroad, a SECOND additive list from `FleetScreen`, the tree unchanged).

**Mutation table rows:**
- Row "the home card lists its waves abroad" — RED when the `.proj-abroad` block is dropped.
- Row "the second list is computed, and it is the right one" — RED when `FleetScreen` stops passing `abroad`, or passes the wrong side of the comparison (spec §7's "the second list is dropped").
- Row "a card is not its own abroad" — RED when a run whose home IS its own project appears in the list.

Anchor quotes, verified against the working tree. `pwa/src/screens/FleetScreen.tsx:483-492`:

```tsx
                /* Task 4: THIS card's own runs. Scoped here rather than inside
                   the card because "which card does a run belong on" is a
                   question about the run's `project`, and a card handed one
                   session list cannot answer it — an all-archived project's
                   list is empty and still has a spawn to show. A run whose
                   coordinator lives on another project therefore reaches only
                   the worker's card, where `nestFleet`'s rule 3 leaves it
                   unbracketed: a `└─` never crosses two cards. */
                runs={activeRuns.filter((r) => r.project === g.project)}
                nowMs={nowMs}
```

`pwa/src/fleet/ProjectCard.tsx:118-123`:

```tsx
  /** THIS project's ACTIVE runs (Task 4) — the programme edges the body's tree
   *  is drawn from, scoped and filtered by `FleetScreen`, which owns the store
   *  read. Defaults to `[]` so a card rendered before any `{type:'runs'}` frame
   *  has landed — or by a test that is not about the tree — renders the flat
   *  list it always did. */
  runs?: readonly RunSummary[];
```

`pwa/test/fleet-screen.test.tsx:1235-1252` — the existing per-card scoping case this task's wire test sits beside:

```tsx
  it('scopes each card to its OWN project’s runs — a bracket never crosses cards', () => {
```

- [ ] **Step 1: Write the failing tests**

1a. In `pwa/test/project-card.test.tsx`, append:

```tsx
// ── cross-repo wave 2: the home card knows where its waves went ──────────────
//
// A crossing programme's home card would otherwise show nothing at all for the
// wave that is running: the worker's session lives in the other repo, so it is
// on the other card, and this card's own `runs` filter (by `run.project`) cannot
// see it BY CONSTRUCTION. The second list is additive and the tree never sees
// it — `nestFleet` is called with `runs`, exactly as before.
describe('the home card lists the waves running abroad', () => {
  const away = runFor({
    id: 30, program: 'build9b', wave: 2, waveOf: 3,
    project: 'other-repo', sessionId: 'other-repo-far-bank',
    claimedBy: 'demo-quiet-mesa', homeProject: 'demo',
  });

  it('renders one line per wave abroad, naming the programme, the wave and the repo', () => {
    const { container } = render(
      <ProjectCard group={grp()} runs={[]} abroad={[away]} nowMs={FROZEN}
                   onOpen={() => {}} onActions={() => {}} />);
    const lines = container.querySelectorAll('.proj-abroad-line');
    expect(lines).toHaveLength(1);
    expect(lines[0]?.textContent).toContain('build9b');
    expect(lines[0]?.textContent).toContain(waveLabel({ wave: 2, waveOf: 3 }));
    expect(lines[0]?.textContent).toContain('other-repo');
  });

  it('renders one line per wave, not one per programme', () => {
    const second = { ...away, id: 31, wave: 3, project: 'third-repo' };
    const { container } = render(
      <ProjectCard group={grp()} runs={[]} abroad={[away, second]} nowMs={FROZEN}
                   onOpen={() => {}} onActions={() => {}} />);
    expect(container.querySelectorAll('.proj-abroad-line')).toHaveLength(2);
  });

  it('renders nothing at all when nothing is abroad — the prop is additive', () => {
    const { container } = render(
      <ProjectCard group={grp()} runs={[]} nowMs={FROZEN}
                   onOpen={() => {}} onActions={() => {}} />);
    expect(container.querySelector('.proj-abroad')).toBeNull();
  });

  it('hides the list with the rest of the card when collapsed', () => {
    // A fold hides the body; the abroad lines are body, not header. The one
    // thing a fold may never hide is attention, and this is not that.
    const { container } = render(
      <ProjectCard collapsed group={grp()} runs={[]} abroad={[away]} nowMs={FROZEN}
                   onOpen={() => {}} onActions={() => {}} />);
    expect(container.querySelector('.proj-abroad')).toBeNull();
  });

  it('does not draw the abroad run into the tree — nestFleet is called with `runs` alone', () => {
    // The run names `demo-quiet-mesa` as its coordinator, which IS on this card.
    // If the abroad list ever reached `nestFleet`, a pending/settled child would
    // appear under that session for a workspace that is not in this repo.
    const { container } = render(
      <ProjectCard group={grp()} runs={[]} abroad={[away]} nowMs={FROZEN}
                   onOpen={() => {}} onActions={() => {}} />);
    expect(container.querySelector('.proj-nest')).toBeNull();
    expect(container.querySelector('.proj-pending')).toBeNull();
  });
});
```

1b. In `pwa/test/fleet-screen.test.tsx`, append to the `the programme tree on the fleet screen` describe:

```tsx
  it('gives each card the runs whose HOME is that project and whose work is elsewhere', () => {
    // The wire, and only measurable here: the card cannot compute this list (it
    // is a fact about runs on OTHER projects, which its own `runs` filter has
    // already excluded by construction) and `nestFleet` must never see it.
    const store = makeStore();
    render(<FleetScreen store={store} />);
    seed(store, {
      conn: 'open',
      sessions: [
        session({ id: 'claude:coord', project: 'alpha', workspace: 'quiet-mesa' }),
        session({ id: 'claude:worker', project: 'beta', workspace: 'still-cove' }),
      ],
      runs: [runRow({
        id: 40, program: 'build9b', wave: 2, waveOf: 3,
        project: 'beta', homeProject: 'alpha',
        sessionId: 'claude:worker', claimedBy: 'claude:coord',
      })],
      runsFrameSeen: true,
    });
    // The HOME card (alpha) says where the wave went…
    const cards = [...document.querySelectorAll('.proj-card')];
    const alpha = cards.find((c) => c.querySelector('.proj-card-name')?.textContent === 'alpha');
    expect(alpha, 'no card for alpha').toBeTruthy();
    expect(alpha!.querySelector('.proj-abroad-line')?.textContent).toContain('build9b');
    expect(alpha!.querySelector('.proj-abroad-line')?.textContent).toContain('beta');
    // …and the WORKING card (beta) does not: its own row is where that wave is.
    const beta = cards.find((c) => c.querySelector('.proj-card-name')?.textContent === 'beta');
    expect(beta!.querySelector('.proj-abroad')).toBeNull();
    // And beta's own row carries the orphan marker (Task 6), because the
    // coordinator is on alpha's card.
    expect(beta!.querySelector('.proj-crossing')?.textContent).toContain('home alpha');
  });

  it('gives a single-project programme no abroad line at all', () => {
    const store = makeStore();
    render(<FleetScreen store={store} />);
    seed(store, {
      conn: 'open',
      sessions: [
        session({ id: 'claude:coord', project: 'alpha', workspace: 'quiet-mesa' }),
        session({ id: 'claude:worker', project: 'alpha', workspace: 'still-cove' }),
      ],
      runs: [runRow({
        id: 41, project: 'alpha', homeProject: 'alpha',
        sessionId: 'claude:worker', claimedBy: 'claude:coord',
      })],
      runsFrameSeen: true,
    });
    expect(document.querySelector('.proj-abroad')).toBeNull();
    expect(document.querySelector('.proj-crossing')).toBeNull();
  });
```

- [ ] **Step 2: Run them to verify they fail**

Run: `cd pwa && ./node_modules/.bin/vitest run test/project-card.test.tsx test/fleet-screen.test.tsx`
Expected: FAIL — `project-card.test.tsx` fails to typecheck at runtime only in the sense that vitest does not typecheck: the `abroad` prop is simply ignored, so the two positive card cases fail on `expected 0 to be 1` / `expected null not to be null`, and the fleet-screen case fails on `expected undefined to contain 'build9b'`. The three negative card cases pass, as controls.

- [ ] **Step 3: Implement**

3a. `pwa/src/fleet/ProjectCard.tsx` — declare the prop beside `runs`. Two edits: the destructuring parameter list, and the type beside it.

Insert `abroad = [],` immediately after `runs = [],` in the destructuring parameter list (currently `pwa/src/fleet/ProjectCard.tsx:82`):

```tsx
  roster = [],
  runs = [],
  abroad = [],
  nowMs = Date.now(),
```

and add the type after `runs?` in the same function's type annotation:

```tsx
  /** The runs whose programme is HOMED in this project and whose work is
   *  happening somewhere else (spec §3 F4). A SECOND, additive list, and never
   *  merged into `runs`: `runs` is what the tree is drawn from and every one of
   *  its members belongs to this card's project by construction, while every
   *  member of this list belongs to another card by the same construction.
   *  Merging them would put a phantom child under a coordinator for a workspace
   *  that is not in this repo. Computed by `FleetScreen`, which owns the store
   *  read, for the same reason `runs` is: a card handed one session list cannot
   *  answer a question about other projects' runs. Defaults to `[]`, so every
   *  caller and every test that predates this renders exactly as it did. */
  abroad?: readonly RunSummary[];
```

3b. Render it at the foot of the body, inside `{!collapsed && (<div className="proj-card-body">…</div>)}`, immediately after the `rows.map(...)` block:

```tsx
          {abroad.length > 0 && (
            <div className="proj-abroad">
              {abroad.map((r) => (
                <span key={r.id} className="proj-abroad-line">
                  <span className="proj-abroad-glyph" aria-hidden="true">{CROSSING_GLYPH}</span>
                  {`${r.program} ${waveLabel(r)} in ${r.project}`}
                </span>
              ))}
            </div>
          )}
```

3c. `pwa/src/screens/FleetScreen.tsx` — extend the import at `:22`:

```tsx
import { anyDispatchPending, isRunClosed, runHomeProject } from '../fleet/runWords';
```

and pass the second list in the `ProjectCard` call, immediately after `runs={…}` (`:491`):

```tsx
                /* The SECOND list (spec §3 F4): the runs this project is the
                   HOME of, working somewhere else. It is the exact complement
                   of the filter above — that one asks where the work is, this
                   one asks whose programme it is — and the two never merge,
                   because only the first may reach `nestFleet`. `runHomeProject`
                   rather than `r.homeProject`, for the reason its own docstring
                   gives: an older server omits the key and `undefined !== g.project`
                   would put every run on every card. */
                abroad={activeRuns.filter(
                  (r) => runHomeProject(r) === g.project && r.project !== g.project)}
```

3d. `pwa/src/fleet/fleet.css` — insert immediately after the `.proj-crossing-glyph` rule from Task 6:

```css
/* F4 (cross-repo): the home card's own sentence about a wave that is running in
   another repo. Same register and same ground as `.proj-crossing` above — this
   card's body — and a top border, because it is about a row that is NOT on this
   card and must not read as one more session. */
.proj-abroad {
  display: flex;
  flex-direction: column;
  gap: var(--sp-1);
  margin-top: var(--sp-1);
  padding-top: var(--sp-1);
  border-top: 1px solid var(--edge-subtle);
}
.proj-abroad-line {
  display: flex;
  align-items: baseline;
  gap: var(--sp-1);
  min-width: 0;
  font-size: var(--text-2xs);
  color: var(--ink-tertiary);
}
.proj-abroad-glyph { flex: none; color: var(--ink-tertiary); }
```

3e. `pwa/design/audit.mjs` — register both in `INHERITED_GROUNDS`, same reasoning and same route as Task 6's pair (`.proj-abroad` itself sets no `color`, so it is not a painter and needs no entry — only the two that do). Insert immediately after Task 6's two entries, still before the object's closing `};`:

```js
  'fleet.css .proj-abroad-line': {
    under: ['var(--bg-surface)'],
    why: "the home card's own sentence about a wave running in another repo (F4, cross-repo wave 2), same ground and register as .proj-crossing above. Its selector names no ancestor, so no route could ground it",
  },
  'fleet.css .proj-abroad-glyph': {
    under: ['var(--bg-surface)'],
    why: "the abroad line's glyph, same ground and same reason as .proj-crossing-glyph above",
  },
```

- [ ] **Step 4: Run them to verify they pass**

Run: `cd pwa && ./node_modules/.bin/vitest run test/project-card.test.tsx test/fleet-screen.test.tsx`
Expected: PASS — both files whole, Task 6's cases included.

Then the contrast gate:

Run: `cd pwa && ./node_modules/.bin/vitest run test/contrast.test.ts`
Expected: PASS — `.proj-abroad-line` and `.proj-abroad-glyph` both print `PASS 5.77 (min 4.5) DARK` / `PASS 5.70 (min 4.5) LIGHT`, and the uncovered census is unchanged from Task 6's.

Run: `cd pwa && npm run build`
Expected: `tsc --noEmit` clean, vite build succeeds. This is where a prop declared and not destructured, or a `readonly RunSummary[]` handed to something expecting a mutable array, actually reds — vitest never typechecks.

- [ ] **Step 5: Measure the mutations**

Each alone, reverted before the next.

1. Delete the `abroad={…}` prop from the `ProjectCard` call in `FleetScreen.tsx`.
   Run: `cd pwa && ./node_modules/.bin/vitest run test/fleet-screen.test.tsx`
   Expected: FAIL — `gives each card the runs whose HOME is that project and whose work is elsewhere`, `expected undefined to contain 'build9b'`. This is spec §7's "the second list is dropped" row.
2. Invert the comparison to `runHomeProject(r) !== g.project && r.project === g.project`.
   Run: same. Expected: FAIL — the same case, with the line appearing on `beta` instead: `expected null not to be null` on alpha, and the `beta!.querySelector('.proj-abroad')` assertion reds too.
3. Drop the `r.project !== g.project` half.
   Run: same. Expected: FAIL — `gives a single-project programme no abroad line at all`: a card would list its own wave as abroad.
4. Delete the `.proj-abroad` block from `ProjectCard.tsx`.
   Run: `cd pwa && ./node_modules/.bin/vitest run test/project-card.test.tsx`
   Expected: FAIL — `renders one line per wave abroad…` and `renders one line per wave, not one per programme`.
5. Pass `abroad` into `nestFleet` (`nestFleet(group.sessions, [...runs, ...abroad])`).
   Run: same. Expected: FAIL — `does not draw the abroad run into the tree`, on `.proj-nest` or `.proj-pending` becoming non-null.

- [ ] **Step 6: Commit**

```bash
git add pwa/src/fleet/ProjectCard.tsx pwa/src/screens/FleetScreen.tsx pwa/src/fleet/fleet.css pwa/design/audit.mjs pwa/test/project-card.test.tsx pwa/test/fleet-screen.test.tsx
git commit -m "feat(pwa): the home card says which of its waves are running in another repo"
```

---

## Task 8: The mail screen groups by programme — and says so honestly for the records that have no programme

**Files:**
- Modify: `pwa/src/lib/feed.ts` — one new reader beside `recordKey` (`:59`)
- Modify: `pwa/src/screens/MailScreen.tsx` — a second loader, the grouping, the chip, the headers
- Modify: `pwa/src/fleet/fleet.css` — beside the existing `.mail-*` rules
- Modify: `pwa/design/audit.mjs` — three new `INHERITED_GROUNDS` entries, added WITH the rule (fix round 1, finding 6): `.mail-chip`, `.mail-chip[data-on]` and `.mail-group-head` name no ancestor in their own selector — the mail screen sets no background of its own, so their real ground is `body`'s `--bg-page` (`styles/base.css:110-111`) and no route recovers that from a bare selector
- Modify: `pwa/test/mail-screen.test.tsx` (including the stale fixture comment at `:22-26`)
- Modify: `pwa/test/offline.test.ts`

**Interfaces:**
- Consumes: `NotifyEvent.runId: number | null` and its revival in `reviveNotifyEvent` (wave 1, `shared/api.ts`); `api.runs(closed)` (`pwa/src/lib/api.ts:560-561`); `RunSummary.program`, `.programTitle` (existing).
- Produces: `export const eventRunId: (e: NotifyEvent) => number | null` in `pwa/src/lib/feed.ts` — the render-side reader of `runId` for every call site under `pwa/src` (`reviveNotifyEvent`, wave 1's `shared/api.ts`, is the OTHER reader, at the wire boundary a record crosses coming in; `eventRunId` is belt to that braces for a row that reached the renderer without proving it went through revival — see Global Constraints), beside `recordKey`, the module that already owns feed-record identity; the classes `.mail-filter`, `.mail-chip`, `.mail-group`, `.mail-group-head`; and the three `INHERITED_GROUNDS` entries that measure the colour-bearing ones.

**Spec refs:** §4 ("The mail screen groups by programme (header = programme title, from `GET /api/runs`, the read the runs screen already makes; the event's new `runId` is the key) with a filter chip; programless mail sits under its own header. `MailCard` is unchanged."), §7 row "programme filter".

**Mutation table rows:**
- Row "the feed is grouped by programme" — RED when the grouping is dropped and every record renders in one flat list.
- Row "a programless record never appears under a programme" — RED when the `runId === null` arm folds into a programme group (spec §7's own row).
- Row "an UNRESOLVED runId is not a programless record" — RED when the two collapse to one header (the no-overloaded-null rule at this seam).
- Row "the chip filters, and All restores" — RED when the chip stops filtering or cannot be cleared.
- Row "the snapshot is untouched" — `offline.test.ts` proves the snapshot carries neither runs nor feed records, so there is nothing there to tolerate; RED if a future change persists either without a reviver.

Anchor quotes, verified against the working tree. `pwa/src/lib/feed.ts:59`:

```ts
export const recordKey = (e: NotifyEvent): string => `${e.at}:${e.seq}`;
```

`pwa/src/screens/MailScreen.tsx:38` and `:108-109`:

```ts
const loadFeedDefault = (): Promise<{ events: NotifyEvent[] }> => api.feed(100);
```

```ts
  const rows = [...feed].reverse();   // newest first on screen; oldest-first in the store
  const nowSec = Math.floor(now / 1000);
```

`pwa/src/screens/MailScreen.tsx:144-162` — the list this task wraps in groups:

```tsx
      ) : (
        <ul className="mail-list">
          {rows.map((ev) => (
            <li
              key={recordKey(ev)}
              className="mail-row"
              data-unseen={isUnseenAt(FEED_ACK_KEY, ev.at, acks) ? 'true' : 'false'}
            >
```

`pwa/test/mail-screen.test.tsx:22-31` — the comment this task corrects, because wave 1 falsified it:

```ts
// NOTE: `NotifyEvent` carries no `runId` (shared/api.ts) — the plan's own
// Interfaces-assumed-from-PR-I reconciliation (item 2) records that the field
// was never shipped, so a feed row cannot link back to its run without a
// second lookup. This fixture omits it rather than asserting a field that
// does not typecheck.
const e = (over: Partial<NotifyEvent> = {}): NotifyEvent => ({
  seq: 1, at: Date.now() - 60_000, kind: 'mail', sessionId: 'ccrc-pwa-clear-cove',
  title: '✉ finding › clear-cove', body: 'The hold gate re-reads at the decision point.',
  ...over,
});
```

`pwa/src/lib/offline.ts:23-37` — what the snapshot actually holds:

```ts
export interface FleetSnapshot {
  savedAt: number; // epoch ms of the snapshot
  sessions: FleetSession[];
```

- [ ] **Step 1: Write the failing tests**

1a. `pwa/test/mail-screen.test.tsx` — extend the type import at `:13` (the file imports `NotifyEvent` only today):

```ts
import type { NotifyEvent, RunSummary } from '../../shared/api';
```

and extend the `@testing-library/react` import at `:11` to add `waitFor` (fix round 1, finding 2 — the chip and the header render the same text, so the grouping cases below query the DOM by selector rather than by text, and `waitFor` is what lets that query wait for the async `loadRuns` read the same way `findByText` already did):

```ts
import { act, cleanup, render, screen, fireEvent, waitFor } from '@testing-library/react';
```

then replace the stale comment at `:22-26` and give the fixture the field:

```ts
// `NotifyEvent.runId` SHIPPED in cross-repo wave 1 (`shared/api.ts`, revived by
// `reviveNotifyEvent`): a feed record can name the run it belongs to, which is
// what lets this screen group by programme without a second lookup per row.
// The fixture defaults it to `null` — the honest default, and the shape every
// record written before that migration still has.
const e = (over: Partial<NotifyEvent> = {}): NotifyEvent => ({
  seq: 1, at: Date.now() - 60_000, kind: 'mail', sessionId: 'ccrc-pwa-clear-cove',
  runId: null,
  title: '✉ finding › clear-cove', body: 'The hold gate re-reads at the decision point.',
  ...over,
});
```

and append:

```tsx
// ── cross-repo wave 2: the feed reads by programme (spec §4) ─────────────────
//
// One fleet, several programmes, and — since wave 1 — waves in more than one
// repo per programme. A flat feed makes "what happened on build9b" a scrolling
// exercise. The KEY is the record's own `runId`; the TITLE comes from the runs
// read this app already makes.
//
// THREE cases, not two, and that is the point of the third: a record with no
// `runId` (an ask, a merge, anything not run-scoped) and a record whose `runId`
// names a run this read did not return (a rebuilt coord.db, a run older than
// the read, a failed read) are DIFFERENT facts. Folding them would put "this is
// not part of a programme" over a record that certainly is.
const RUNS = [
  { id: 5, program: 'build9b', programTitle: 'Build 9b: peers and claims' },
  { id: 6, program: 'crossrepo', programTitle: 'Cross-repo programmes' },
] as unknown as RunSummary[];

const loadRuns = (): Promise<{ runs: RunSummary[] }> => Promise.resolve({ runs: RUNS });

describe('the feed, grouped by programme', () => {
  const mount = (events: NotifyEvent[], runs = loadRuns): void => {
    const store = makeStore();
    render(<MailScreen store={store} loadFeed={async () => ({ events })} loadRuns={runs} />);
  };

  it('puts each record under its programme’s own title', async () => {
    // Queried by SELECTOR, not by text: the chip row (`groups.size > 1`, so it
    // renders here) puts the exact same string on a `<button>` beside the
    // `<p class="mail-group-head">`, and `findByText`/`getByText` throw on
    // "Found multiple elements" the moment both are on the page. The header
    // list is what this case is actually about; the chip's own text is
    // asserted by role, in "filters to one programme on its chip" below.
    mount([e({ seq: 1, runId: 5, title: 'wave 1 dispatched' }),
           e({ seq: 2, runId: 6, title: 'wave 2 dispatched' })]);
    await waitFor(() => {
      const heads = [...document.querySelectorAll('.mail-group-head')].map((h) => h.textContent);
      expect(heads).toEqual(['Build 9b: peers and claims', 'Cross-repo programmes']);
    });
  });

  it('puts a record with NO runId under its own header, never under a programme', async () => {
    // Same reason as the case above: `groups.size` is 2 here too (one
    // programme group, one programless group), so the chip row renders and
    // both headers' text is duplicated onto a `<button>`. Querying
    // `.mail-group-head` directly is what keeps this a claim about the
    // HEADERS rather than about however many elements happen to carry the
    // string.
    mount([e({ seq: 1, runId: 5, title: 'wave 1 dispatched' }),
           e({ seq: 2, runId: null, title: 'an ask' })]);
    await waitFor(() => {
      expect([...document.querySelectorAll('.mail-group-head')].map((h) => h.textContent))
        .toEqual(['Build 9b: peers and claims', 'Not part of a programme']);
    });
    const programGroup = [...document.querySelectorAll('.mail-group')]
      .find((g) => g.querySelector('.mail-group-head')?.textContent === 'Build 9b: peers and claims');
    expect(programGroup!.textContent).not.toContain('an ask');
  });

  it('says a runId it could not resolve is UNRESOLVED, not programless', async () => {
    mount([e({ seq: 1, runId: 99, title: 'from a run this read never saw' })]);
    expect(await screen.findByText('run 99 — programme not measured')).toBeInTheDocument();
    expect(screen.queryByText('Not part of a programme')).toBeNull();
  });

  it('keeps rendering every record when the runs read fails — grouping is a nicety, the feed is not', async () => {
    mount([e({ seq: 1, runId: 5, title: 'wave 1 dispatched' })],
      () => Promise.reject(new Error('offline')));
    expect(await screen.findByText('wave 1 dispatched')).toBeInTheDocument();
    expect(screen.getByText('run 5 — programme not measured')).toBeInTheDocument();
  });

  it('filters to one programme on its chip, and restores on All', async () => {
    mount([e({ seq: 1, runId: 5, title: 'wave 1 dispatched' }),
           e({ seq: 2, runId: 6, title: 'wave 2 dispatched' })]);
    fireEvent.click(await screen.findByRole('button', { name: 'Build 9b: peers and claims' }));
    expect(screen.getByText('wave 1 dispatched')).toBeInTheDocument();
    expect(screen.queryByText('wave 2 dispatched')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'All' }));
    expect(screen.getByText('wave 2 dispatched')).toBeInTheDocument();
  });

  it('reads the runs loader exactly once per mount', async () => {
    const spy = vi.fn(loadRuns);
    const store = makeStore();
    render(<MailScreen store={store} loadFeed={async () => ({ events: [e()] })} loadRuns={spy} />);
    await screen.findByText('Not part of a programme');
    expect(spy).toHaveBeenCalledTimes(1);
  });
});
```

1b. `pwa/test/offline.test.ts` — insert as a THIRD case inside the existing `describe('fleet snapshot (lib/offline)', ...)` block (`:66-82`), immediately before its closing `});` at `:82` — not appended at file end, so the file-level `beforeEach(() => { window.localStorage.clear(); ... })` (`:57-60`) that already guards every case in this describe guards this one too, and a leftover key from a case earlier in the same describe cannot flatter it. Use `window.localStorage`, matching every other read in this file (`:77`, `:79`, `:106`, `:116`, `:298`, `:418`, `:439`, `:444`, `:463`) — `offline.ts:19-21` states why a bare `localStorage` is refused here: "Node 22+ ships an experimental bare `localStorage` global that shadows jsdom's working one under vitest", so the bare read would answer `null` and `JSON.parse(null!)` would throw for a reason that has nothing to do with what this case pins:

```ts
// ── cross-repo wave 2: what the snapshot does NOT hold ───────────────────────
//
// The wave brief asked for the snapshot revive to tolerate a missing `runId`
// and a missing `homeProject`. It holds NEITHER field, because it holds neither
// runs nor feed records — only `savedAt`, `sessions` and `roster`
// (`FleetSnapshot`, offline.ts). So the tolerance is vacuous by construction,
// and this pin is what keeps that TRUE rather than remembered: the day someone
// persists runs or the feed here, this reds and the reviver is written with it.
// The real tolerant readers for those two fields live where the data actually
// crosses a version boundary: `reviveNotifyEvent` (wave 1) for `runId`, and
// `runHomeProject` (`pwa/src/fleet/runWords.ts`) for `homeProject`.
it('persists sessions and roster only — no runs, no feed records', () => {
  saveFleetSnapshot([session('claude:demo')], TEST_ROSTER);
  const raw = JSON.parse(window.localStorage.getItem('ccrc.fleet-snapshot.v1')!) as Record<string, unknown>;
  expect(Object.keys(raw).sort()).toEqual(['roster', 'savedAt', 'sessions']);
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `cd pwa && ./node_modules/.bin/vitest run test/mail-screen.test.tsx test/offline.test.ts`
Expected: FAIL — every case in the new mail describe (`MailScreen` takes no `loadRuns` prop, renders no `.mail-group-head`, and `findByText` times out on the first header); `offline.test.ts` PASSES on the new case, which is the point — it records a fact rather than driving a change. Every existing mail case stays green.

- [ ] **Step 3: Implement**

3a. `pwa/src/lib/feed.ts` — append beside `recordKey`:

```ts
/** The run a feed record belongs to, tolerantly — the ONE reader of the
 *  additive `NotifyEvent.runId` in `pwa/src`, in the module that already owns
 *  this record's identity.
 *
 *  `reviveNotifyEvent` normalises the field on both paths a client can see it
 *  from (the durable read here, the catch-up tail in `notifymark.ts`), so this
 *  is belt to that braces — but the belt is not free: a record cached by an
 *  OLDER build of this app, or a merge that put an unrevived object in the
 *  store, reaches the renderer with the key missing, and `undefined` used as a
 *  Map key groups every such record together under one nonsense header. `null`
 *  is the honest answer and the screen has a header for exactly that. */
export const eventRunId = (e: NotifyEvent): number | null =>
  typeof e.runId === 'number' ? e.runId : null;
```

3b. `pwa/src/screens/MailScreen.tsx` — the loader, the grouping and the chip.

Imports (extend the existing lines):

```tsx
import type { NotifyEvent, RunSummary } from '../../../shared/api';
import { eventRunId, recordKey, reviveNotifyEvents } from '../lib/feed';
```

Beside `loadFeedDefault` (`:38`):

```tsx
/** The programme titles the headers are built from. `api.runs(true)` — WITH
 *  closed runs — because a feed record outlives its run: a wave that finished
 *  yesterday still has its records on this screen, and the active-only default
 *  would leave every one of them unresolved. Hoisted to module scope for
 *  `loadFeedDefault`'s own reason (a default parameter expression is re-minted
 *  on every render, and an effect keyed on that identity never stops firing). */
const loadRunsDefault = (): Promise<{ runs: RunSummary[] }> => api.runs(true);
```

Props:

```tsx
export function MailScreen({
  store = useFleetStore,
  loadFeed = loadFeedDefault,
  loadRuns = loadRunsDefault,
}: {
  store?: FleetStore;
  loadFeed?: () => Promise<{ events: NotifyEvent[] }>;
  loadRuns?: () => Promise<{ runs: RunSummary[] }>;
}): ReactNode {
```

The read, beside the feed's own (same ref idiom, same once-per-mount rule):

```tsx
  // The programme titles. A SEPARATE read from the feed's, and a failure here is
  // not a failure of this screen: the records still render, under headers that
  // say the programme was not measured. Never merged into the feed's own
  // promise — one failing read must not take the other's data with it.
  const [runsById, setRunsById] = useState<ReadonlyMap<number, RunSummary>>(new Map());
  const loadRunsRef = useRef(loadRuns);
  loadRunsRef.current = loadRuns;
  useEffect(() => {
    let live = true;
    void loadRunsRef.current()
      .then((r) => {
        if (!live) return;
        setRunsById(new Map(r.runs.map((run) => [run.id, run] as const)));
      })
      .catch(() => { /* the headers degrade; the feed does not */ });
    return () => { live = false; };
  }, [store]);
```

The grouping, immediately after `const rows = [...feed].reverse();` (`:108`):

```tsx
  // THREE kinds of key, because there are three facts (spec §4, and the
  // no-overloaded-null rule): a record that names a run this read resolved; a
  // record that names a run it did not; and a record that names no run at all.
  // The middle one is not the last one — it says "I could not measure", not
  // "there is nothing to measure" — and a reader who cannot tell them apart
  // cannot tell a rebuilt database from an ask.
  const groupOf = (ev: NotifyEvent): { key: string; head: string } => {
    const runId = eventRunId(ev);
    if (runId === null) return { key: 'none', head: 'Not part of a programme' };
    const run = runsById.get(runId);
    return run === undefined
      ? { key: `run:${runId}`, head: `run ${runId} — programme not measured` }
      : { key: `program:${run.program}`, head: run.programTitle };
  };
  // First-appearance order, so the groups read newest-first exactly as the flat
  // list did. A Map preserves insertion order; nothing is sorted here, because
  // any sort would be this screen inventing an order the feed does not have.
  const groups = new Map<string, { head: string; rows: NotifyEvent[] }>();
  for (const ev of rows) {
    const { key, head } = groupOf(ev);
    const g = groups.get(key);
    if (g) g.rows.push(ev);
    else groups.set(key, { head, rows: [ev] });
  }
  const shown = [...groups].filter(([key]) => filter === null || key === filter);
```

The filter state, beside `readState` (`:69`):

```tsx
  // `null` is All. Keyed on the GROUP KEY, never on the head text: two
  // programmes may share a title, and a title is prose that can change under a
  // filter that is already set.
  const [filter, setFilter] = useState<string | null>(null);
```

The chip row, rendered above the list (after the `mail-dropped` block, `:132`):

```tsx
      {groups.size > 1 && (
        <div className="mail-filter" role="group" aria-label="filter by programme">
          <button
            type="button"
            className="mail-chip"
            data-on={filter === null || undefined}
            aria-pressed={filter === null}
            onClick={() => setFilter(null)}
          >
            All
          </button>
          {[...groups].map(([key, g]) => (
            <button
              key={key}
              type="button"
              className="mail-chip"
              data-on={filter === key || undefined}
              aria-pressed={filter === key}
              onClick={() => setFilter(key)}
            >
              {g.head}
            </button>
          ))}
        </div>
      )}
```

And the list becomes one `<ul>` per group. The ROW is byte-identical to today's — same classes, same children, same `data-unseen` — and `MailCard` (the session screen's own renderer, which this screen does not use) is untouched, which is the whole of what §4 asks:

```tsx
        <>
          {shown.map(([key, g]) => (
            <div key={key} className="mail-group">
              <p className="mail-group-head">{g.head}</p>
              <ul className="mail-list">
                {g.rows.map((ev) => (
                  <li
                    key={recordKey(ev)}
                    className="mail-row"
                    data-unseen={isUnseenAt(FEED_ACK_KEY, ev.at, acks) ? 'true' : 'false'}
                  >
                    <span className="mail-kind">
                      <span className="mail-kind-glyph" aria-hidden="true">{KIND_GLYPH[ev.kind]}</span>
                      {KIND_WORD[ev.kind]}
                    </span>
                    <span className="mail-row-title">{ev.title}</span>
                    <span className="mail-when">{formatAge(nowSec - Math.floor(ev.at / 1000))}</span>
                    {ev.body !== '' && <p className="mail-body">{ev.body}</p>}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </>
```

3c. `pwa/src/fleet/fleet.css` — beside the existing `.mail-*` rules:

```css
/* The programme filter and its headers. Chips take the same ground and the same
   inks the rest of this screen does — `--ink-secondary` for a chip that is off,
   `--ink-primary` for the one that is on — so nothing here is read out of
   colour: the pressed chip carries `aria-pressed` and `data-on`, and the header
   above each list says in words what the chip selected. */
.mail-filter {
  display: flex;
  flex-wrap: wrap;
  gap: var(--sp-1);
  padding: 0 var(--sp-3) var(--sp-2);
}
.mail-chip {
  min-height: var(--tap-min);
  padding: 0 var(--sp-2);
  background: none;
  border: 1px solid var(--edge-subtle);
  border-radius: var(--r-full);
  color: var(--ink-secondary);
  font: inherit;
  font-size: var(--text-2xs);
}
.mail-chip[data-on] { color: var(--ink-primary); }
.mail-group-head {
  margin: 0;
  padding: var(--sp-2) var(--sp-3) var(--sp-1);
  font-size: var(--text-2xs);
  color: var(--ink-tertiary);
}
```

3d. `pwa/design/audit.mjs` — register the three colour-bearing rules (`.mail-filter` sets no `color`, so it is not a painter and needs no entry) in `INHERITED_GROUNDS`, immediately after Task 7's two entries, still before the object's closing `};`. Their ground is `--bg-page`, not `--bg-surface`: `.mail-screen` (`fleet.css:1897`) sets no background of its own, so the screen's real ground is `body`'s (`styles/base.css:110-111`, `background: var(--bg-page); color: var(--ink-primary);`) — the first entry in this registry grounded on the page rather than a card:

```js
  'fleet.css .mail-chip': {
    under: ['var(--bg-page)'],
    why: "the OFF state of the programme filter chip (F4, cross-repo wave 2). `.mail-screen` sets no background of its own, so its real ground is body's --bg-page (styles/base.css). Its selector names no ancestor, so no route could ground it",
  },
  "fleet.css .mail-chip[data-on]": {
    under: ['var(--bg-page)'],
    why: 'the ON state of the same chip, same ground. Registered separately for the reason the .auth-block-sub entry states: grounding only the base rule would leave the pressed state — the one a reader taps to confirm — unmeasured',
  },
  'fleet.css .mail-group-head': {
    under: ['var(--bg-page)'],
    why: "the programme header above each grouped list, same ground as the chip row above it — the mail screen's own body background",
  },
```

- [ ] **Step 4: Run them to verify they pass**

Run: `cd pwa && ./node_modules/.bin/vitest run test/mail-screen.test.tsx test/offline.test.ts test/feed.test.ts`
Expected: PASS — all three files, every pre-existing mail case included (the empty state, the read-failure state, the once-per-mount feed read, the door). `feed.test.ts` is in the list because `eventRunId` lands in that module.

Run: `cd pwa && npm run build`
Expected: clean. `RunSummary` must be imported as a TYPE in `MailScreen.tsx`, and the `RUNS` fixture in the test is cast because a full `RunSummary` literal is not what these cases are about.

Then the contrast gate — this is the task where all ten of this wave's new rules and all seven `INHERITED_GROUNDS` entries are in place together for the first time:

Run: `cd pwa && ./node_modules/.bin/vitest run test/contrast.test.ts`
Expected: PASS — `.mail-chip` prints `PASS 9.36 (min 4.5) DARK` / `PASS 6.81 (min 4.5) LIGHT`, `.mail-chip[data-on]` prints `PASS 16.94 (min 4.5) DARK` / `PASS 15.26 (min 4.5) LIGHT`, `.mail-group-head` prints `PASS 6.23 (min 4.5) DARK` / `PASS 5.25 (min 4.5) LIGHT`, and the uncovered census is unchanged from Task 7's. Whatever `ALL <n> PASS` reads on this branch immediately before this task's edit, it grows by exactly 20 with this task's commit: 6 from the three `.run-row`-scoped rules Task 5 added (named-ancestor route, automatic) plus 14 from the seven `INHERITED_GROUNDS` entries Tasks 6–8 registered (all ×2 themes) — measured directly against a scratch copy of `main`'s tree with all ten rules and all seven entries added: 462 PASS became 482 PASS there, and the uncovered count returned to its pre-wave value (250) rather than growing by 7.

- [ ] **Step 5: Measure the mutations**

Each alone, reverted before the next.

1. In `groupOf`, return `{ key: 'none', head: 'Not part of a programme' }` for an unresolved run id (fold the two).
   Run: `cd pwa && ./node_modules/.bin/vitest run test/mail-screen.test.tsx`
   Expected: FAIL — `says a runId it could not resolve is UNRESOLVED, not programless`, and `keeps rendering every record when the runs read fails`.
2. In `groupOf`, drop the `runId === null` arm so a null id falls through to the map lookup.
   Run: same. Expected: FAIL — `puts a record with NO runId under its own header, never under a programme` (it lands under `run null — programme not measured`, which is a header claiming a measurement nobody attempted).
3. Replace `eventRunId(ev)` with `ev.runId` and delete a record's `runId` key in the fixture.
   Run: same. Expected: FAIL — the same case, on `undefined` grouping.
4. Make the chip set `filter` to the head text instead of the key.
   Run: same. Expected: FAIL — `filters to one programme on its chip, and restores on All`, because the filter compares against keys.
5. Drop the `.catch()` on the runs read.
   Run: same. Expected: FAIL — `keeps rendering every record when the runs read fails` (an unhandled rejection tears the render down).

- [ ] **Step 6: Commit**

```bash
git add pwa/src/lib/feed.ts pwa/src/screens/MailScreen.tsx pwa/src/fleet/fleet.css pwa/design/audit.mjs pwa/test/mail-screen.test.tsx pwa/test/offline.test.ts
git commit -m "feat(pwa): the feed reads by programme, and says which records have none"
```

---

## Task 9: The whole-suite gate, and the agent-first deploy

**Files:** none modified. This task RUNS things and reports; the only artefact is the handoff.

**Interfaces:**
- Consumes: everything Tasks 1–8 produced.
- Produces: the wave-done fingerprint (`branchTip`, `prNumber`, `prPhase`, `handoffCommit`) measured once, after the last push, and the deploy the operator or coordinator runs.

**Spec refs:** §7 (every guard ships with a row measured red), §8 (ordering, two rules at two scopes), §9 wave 2 ("Deploys agent-first").

**Mutation table:** none of its own. This task is where the OTHER rows are re-measured together, on a tree nobody is editing.

- [ ] **Step 1: The three package suites, in the foreground, one at a time**

```bash
cd server && npm run test
```
Expected: PASS, with the single deliberate exception of `test/dtbd.test.ts`, which is RED until the orchestrator has MINTED the block and substituted the numbers into this plan's `## Deviations found` section — that red is the mechanism, not a break. Watch specifically for `coordinator-skill`, `worker-skill`, `single-definition`, `topology-clean`, `deviation-refs` and `typecheck-tests`. `topology-clean` and `single-definition` scan the whole tracked tree — this plan document included — so a host name, an account label or a second copy of an enumerated value written anywhere above reds here and nowhere else.

```bash
cd pwa && npm run test
```
Expected: PASS. `contrast.test.ts` runs the real gate over every stylesheet. `ALL <n> PASS` carries a larger `<n>` — up by exactly 20 over what it read before Task 5's commit (fix round 1, finding 6): 6 from the three `.run-row`-scoped rules (`.run-project`, `.run-crossing`, `.run-crossing-glyph`), grounded automatically by the named-ancestor route because their OWN selectors name `.run-row`, self-grounded; 14 from the seven bare rules (`.proj-crossing`, `.proj-crossing-glyph`, `.proj-abroad-line`, `.proj-abroad-glyph`, `.mail-chip`, `.mail-chip[data-on]`, `.mail-group-head`) that name no ancestor in their own selectors and are measured only because Tasks 6–8 registered each in `design/audit.mjs`'s `INHERITED_GROUNDS`, added WITH the rule. The uncovered census does NOT grow: without those seven registrations it would, by exactly seven (measured directly against a scratch copy of the tree: 250 → 257 unregistered, back to 250 registered) — the suite would still stay green either way (the census tolerates being non-empty, and none of the seven is "recoverable from the selector," the only shape that fails it), which is exactly why this is the row worth re-measuring here rather than trusting that a green run means every rule was priced.

```bash
cd agent && npm run test
```
Expected: PASS, untouched by this wave — run because a wave that deploys the agent lane may not hand the operator an unmeasured agent.

If any of `ccd-ws-gc`, `pr-sweep`, `session-hook`, `typecheck-tests` or `ccd-session-state` reds, re-run THAT FILE alone before calling it a break; CI on the quiet box is the arbiter.

- [ ] **Step 2: Both builds — the typecheck vitest never does**

```bash
cd server && npm run build
cd pwa && npm run build
```
Expected: both clean. The PWA build is the one that matters here: `tsc --noEmit` is what proves every `RunSummary` literal in `pwa/test` still satisfies the type, that `abroad` is declared and destructured, and that `RunSummary` is imported as a type in `MailScreen.tsx`.

- [ ] **Step 3: Re-measure the vulnerable mutation rows on the assembled tree**

The rows most likely to have been quietly repaired by a later task or acceptance edit:

1. Delete the `.run-project` span (Task 5). Run `cd pwa && ./node_modules/.bin/vitest run test/runs-screen.test.tsx`. Expected: FAIL, 3 cases — both dedicated badge cases plus the legacy-null case, which also asserts the project badge remains while the crossing marker stays absent. Revert with a distinct sentinel.
2. Delete the `abroad={…}` prop (Task 7). Run `cd pwa && ./node_modules/.bin/vitest run test/fleet-screen.test.tsx`. Expected: FAIL, 1 case. Revert with a distinct sentinel.
3. Remove one `asks.list` identity injection (`parent` or `fromUuid`). Run `cd server && ./node_modules/.bin/vitest run test/ccrc-api.test.ts`. Expected: FAIL in the matching derived-identity case. Revert with a distinct sentinel.
4. Remove one executable corpus command from the client table or add a real command whose row is absent. Run `cd server && ./node_modules/.bin/vitest run test/ccrc-api-closed.test.ts`. Expected: FAIL in corpus-to-table parity. Revert with a distinct sentinel.
5. Restore the old held-workspace concurrency sentence in either coordinator corpus. Run `cd server && ./node_modules/.bin/vitest run test/coordinator-skill.test.ts`. Expected: FAIL in the dispatched-nonterminal accounting pin. Revert with a distinct sentinel.
6. Remove the independent exact-`producerSha` merge-proof sentence while leaving the closed-row check. Run the same coordinator suite. Expected: FAIL in the merge-proof pin, demonstrating that `state:done` is not treated as merge evidence. Revert with a distinct sentinel.
7. Replace `git -C "$producerRepoRoot" show "$producerSha:$producerSourceRepoPath"` in the worker skill with `git -C "$PWD" show "$producerSha:$producerSourceRepoPath"`. Run `cd server && ./node_modules/.bin/vitest run test/worker-skill.test.ts`. Expected: FAIL in the producer-source provenance pin and the two-repository behavioral fixture. Revert with a distinct sentinel.
8. Replace the ask lane's derived 409 split sentence with a PARAPHRASED three-condition claim the negative regex does not know — `A 409 here is limited to three possible causes.` Run `cd server && ./node_modules/.bin/vitest run test/coordinator-skill.test.ts`. Expected: FAIL in the arithmetic pin (`(3 + 10) distinct codes`), which is the assertion that survives a paraphrase; the phrasing-matched negative stays green on this mutant, which is exactly why the positive pin carries the guard. Revert with a distinct sentinel.

Then re-run all four focused files clean and confirm the scratch trees used for mutation are clean before removing only those scratch trees created for this step.

- [ ] **Step 3a: Complete the bounded ask client correction (D-2683)**

Add exactly three rows to `ccd/ccrc-api`: `asks.list` (`GET /api/asks`, no positional id), `asks.answer` (`POST /api/asks/{id}/answer`), and `asks.release` (`POST /api/asks/{id}/release`). The route table has twenty-two rows afterwards and its self-description derives or states that exact count. `asks.list` derives both `parent=<current pane identity>` and `fromUuid=<that identity's UUID>` through the existing `derive_identity`; neither value is caller-selectable. If a compatibility `--parent` spelling is retained, accept it only when it equals the derived parent. Never accept `--fromUuid`, an arbitrary host/path/URL, raw request fragments, or another generic identity override. Answer and release bodies still enter only through `--json`.

Extend `server/test/ccrc-api.test.ts` to pin all twenty-two rows, the exact ask URLs, no-pane and malformed-identity refusal, matching-only parent compatibility if present, rejection of caller-selected `fromUuid`, and JSON-only answer/release bodies. Render the three ask operations as executable fenced commands in the coordinator corpus; positional ids must be quoted shell variables, not angle-bracket placeholders that Bash parses as redirection. Extend `server/test/ccrc-api-closed.test.ts` with executable corpus-command-to-route-table parity in both directions needed by the shipped examples: harvest actual `ccrc-api <group> <verb>` commands from the coordinator and worker corpora, normalise positional ids without interpreting arbitrary shell, pin the harvested set to `asks.answer`, `asks.list`, `asks.release`, `mail.send`, and `runs.open`, require every harvested pair to exist in the declared table, and reject shell-significant ask-id placeholders. Preserve `EXEC_COMMANDS = ['tmux', 'ccd']`; never add `gh`.

Run both focused client suites green, then run the two mutations in Step 3 above in isolated scratch trees. An import-time or parser crash is not evidence; each mutation must reach the named assertion. Restore by a distinct sentinel and prove each scratch tree clean before removing only the scratch tree created for that mutation.

- [ ] **Step 4: The deploy — AGENT FIRST, and it is not a preference**

This wave changes `ccd/coordinator-skill/` and `ccd/worker-skill/`. Both ship through the four-homes install lane on the FLEET box (`ccd/install-coordinator-skill.sh`, `ccd/install-worker-skill.sh`), and a skill reaches a config dir only once its installer has run against that home — so the server lane can never be what makes a skill sentence true, and shipping the server first would leave the console describing a boundary no coordinator had been told about.

```bash
bash deploy/deploy.sh agent <fleet-host>
cd <repo root> && bash deploy/deploy.sh
```

Expected: the agent lane rsyncs, installs both skills atomically and restarts the agent; then the server lane builds, ships and its final gate reports the shipped sha at `/health`. The agent lane has NO default target and refuses with exit 2 rather than guessing — pass the host explicitly, or set `CCRC_AGENT_BOX` in `~/.ccrc/deploy.env` (machine-local, outside every checkout; this fleet's real values live in `deploy/reference-fleet.md`, which is gitignored). It never falls back to `CCRC_BOX`, which is the SERVER box.

**Do not run the deploy from inside this wave's own session unless the operator asks for it.** The plan states the ordering and the commands so that whoever runs them cannot get the order wrong; the run itself is an operator/coordinator act.

- [ ] **Step 5: Report the wave, measured once**

Measure all four fields at one moment, after the last push, and send them once — `branchTip` from `git -C <this worktree> rev-parse HEAD`, `handoffCommit` the same sha, `prNumber` and `prPhase` from the PR this wave opened. Then stop pushing.

The report says, in prose: which spec sections this wave closed (§3 F3, §3 F4, §4's mail-screen bullet, §7's skill, client and PWA rows, §8's within-wave ordering); that the eleven coordinator clauses and thirteen worker clauses are byte-identical to what they were on `origin/main`; that `nestFleet.ts` and `nestFleet.test.ts` are untouched; that the client has exactly twenty-two declared rows and executable corpus parity; that same-project succession transfers a hold while cross-project succession releases it; that a closed `done` producer and exact-`producerSha` merge proof were measured as separate gates; every mutation row and the red it produced; and the `## Deviations found` entries below, each with the number the coordinator minted for it.

---

## Deviations found

Fifty-four. **Four were found while PLANNING** against `origin/main` `d0064e6e` — every one is a place where the spec's or the cross-wave contract's own words could not be followed exactly against the tree as it stands. Each carried a `D-TBD-<kebab-slug>` while this plan was drafted; the orchestrator has since minted the contiguous block D-2062–D-2065 and defined the numbers into those entries in one act, so `server/test/dtbd.test.ts` is GREEN and the four below are allocated, not pending. **The fifth, sixth and seventh, D-2560, D-2561 and D-2567, were allocated by the coordinator DURING EXECUTION.** D-2560 and D-2561 were found while measuring D-2545's read surface before its brief was written, and both were ruled OUT of this wave's work in the same act that recorded them. D-2567 was found during Task 3's first review round against the plan's own fenced text, not against a measurement of the tree, and its ruling — correct the three occurrences to `toId` — was implemented in the same commit that records it. All three are records here rather than open tasks. **The eighth, ninth and tenth, D-2574, D-2575 and D-2576, were also allocated by the coordinator DURING EXECUTION**, all three found in Task 6's fix round 1 — a review of Task 6's own committed diff, not a fresh measurement of the wider tree. D-2574 names three guards the plan's own mutation table asserted but never actually put a witness against; D-2575 names a predicate `orphanNote` re-spelled rather than consuming, byte for byte, the decision Task 5 already made; D-2576 names a comparison the card ran against the run's own project where the spec's words name the card's. All three were fixed in the same fix-round commit that records them. **The eleventh, D-2580, was allocated by the coordinator DURING EXECUTION** as well, found in the re-review of Task 6's fix round 1: a pre-existing marker string this same fix round was the first artifact to pin with a test against the exact scenario that makes it false. Fixed in the fix-round-2 commit that records it. **The twelfth and thirteenth, D-2581 and D-2582, were also allocated by the coordinator DURING EXECUTION**, both found in Task 7's fix round 1 — a review of Task 7's own committed diff, not a fresh measurement of the wider tree. D-2581 corrects the coordinator's OWN prior ruling on Task 7's report, which held that a pending-shaped fixture alone would be a complete witness for "the abroad list never reaches `nestFleet`"; the review refuted that by measurement, building a settled-shaped witness that reds under the mutation and stays green against the shipped tree, proving the settled path is independently reachable and was previously unwitnessed. D-2582 corrects a false comment claiming two run filters are exact complements when they are merely disjoint on one card. Both were fixed in the same fix-round commit that records them. **The fourteenth, D-2583, was also allocated by the coordinator DURING EXECUTION**, found in Task 8's own new test cases (`pwa/test/mail-screen.test.tsx`): two of the six new grouping cases mounted fixtures with no explicit `at`, so their expected `.mail-group-head` order (`['Build 9b: peers and claims', 'Cross-repo programmes']`) was really asserting array-CONSTRUCTION order — a tie (or near-tie) between two `e()` calls made back to back on `Date.now()` does not make that order accidentally correct; it is exactly what makes the assertion deterministically FAIL, because `lib/feed.ts`'s `mergeBySeq` (ascending `x.at - y.at || x.seq - y.seq`) puts the first-constructed event first in the store, and `MailScreen.tsx`'s own `rows = [...feed].reverse()` line — whose comment reads "newest first on screen; oldest-first in the store", pre-existing, shipped, untouched by this task — renders the SECOND-constructed event, never the first, on top. Measured against the implementation transcribed byte-for-byte from this same task's brief, both cases failed deterministically (3/3 identical runs, same failure each time). The worker correctly stopped rather than picking a side. The candidate fix of making the grouping iterate ascending `feed` instead of newest-first `rows` was REJECTED: it would have silently reversed this screen's shipped, documented display order for every user, for the sole purpose of making an untested assumption in a new test pass. RULING (coordinator): the tests' expected order was wrong, not the screen. Fixed by giving both cases explicit, well-separated (60-second) `at` values so the intended order is stated rather than inherited from the clock, asserting the newest-first order the screen has always used, and naming `MailScreen.tsx`'s own "newest first on screen" comment as the authority for that convention (cited by that text rather than a line number, per D-2586). Fixed in the same commit that records it. **The fifteenth through eighteenth, D-2584, D-2585, D-2586 and D-2587, were allocated by the coordinator DURING EXECUTION** as well, all four found in the review of Task 8's own committed diff (fix round 1), not a fresh measurement of the wider tree. D-2584 names a stale mail-filter selection that renders the screen completely blank with no message, once the runs read resolves and changes the selected group's own key out from under it. D-2585 names `eventRunId`'s own stated purpose — protecting a row that reached the renderer without going through revival — as unwitnessed anywhere in the repo, sharpening the worker's own Step-5 report that mutation 3 stayed green under the brief's stated command. D-2586 names four citations of `MailScreen.tsx:108` (two in the test file, two in this plan) that were FALSE ON ARRIVAL rather than falsified later: `59881c7b` (this task's own round-0 commit) is the SAME commit that both introduced them and moved that line to `:141`, so there was never a window in which they were true, plus an overreaching CSS comment claim not true of the All chip. D-2587 names a "keeps rendering every record when the runs read fails" claim measured over a population of one record, where a mutation dropping every record but the first would have stayed green. All four were fixed in the same fix-round commit that records them. **The nineteenth, twentieth and twenty-first — D-2589, D-2590 and D-2616 — belong to the FINAL WHOLE-BRANCH REVIEW and to the two carried items, and only D-2590 is wave-2 work.** D-2589 and D-2616 were allocated by the coordinator and are RECORDS ONLY, each naming a pre-existing defect this wave surfaced without touching; D-2590 was allocated by the worker session itself under the coordinator's standing ruling that self-allocation is fine for the rest of this programme, and defined in the same act. **The twenty-second through twenty-fourth — D-2625, D-2626 and D-2627 — are the three places D-2545's IMPLEMENTATION departed from its own brief**, each found while executing it, each argued by the implementer rather than discovered by a reviewer, and all three allocated by the worker session in one act and defined here in the same one. **The twenty-fifth through thirtieth — D-2653 and D-2656–D-2660 — were allocated by this worker during the post-handoff acceptance correction round and defined here in the same act.** They record the six coordinator findings that required a new pushed head after the original `wave-done`: the executable producer gate, immutable named-plan reads, ledger/plan path separation, complete programme-mail history semantics, the live 11/13 skill cardinalities, and stable D-2567 evidence. The non-contiguous numbers are the allocator's answer: D-2653 was issued first, then the remaining five as one block. **The thirty-first and thirty-second — D-2654 and D-2655 — were allocated to this worker for the next acceptance correction.** **The thirty-third through fortieth — D-2680–D-2687 — were allocated to the coordinator for the same correction round.** All ten are defined below before their guards land: exact generated ask IDs, canonical route IDs, the open-before-close boundary, project-specific succession, the complete open payload, bounded ask operations, producer merge proof, cross-project final release, actual cap accounting, and immutable foreign-interface provenance. **The forty-first through forty-sixth — D-2715–D-2720 — were allocated to this worker in one call during the final independent acceptance review and are defined below in the same act.** They correct the repository used for immutable producer reads, make producer evidence conditional on an actual interface dependency, independently pin cross-project close/check ordering, make copied ask mutations fail safe without a deliberately supplied id, align `asks list` with its documented held/open view, and extend executable-corpus parity to Markdown's indented code blocks. **The forty-seventh through fifty-fourth — D-2724–D-2731 — were allocated to this worker in one call during the SECOND final review (eight lenses over the whole branch diff, each finding then put to two independent refuters) and are defined below in the same act.** Three correct the bounded client's own stated properties, one widens a census that could not see its next violation, three correct the wave-3 plan against itself, and one aligns the hold route's oversize status with the five other seams that send it. Ten of the twenty-three findings survived refutation; eight of those became these numbers, one was declined with its reasoning recorded in the file (ask writes take identity from the body, as every other POST row does), and one was a duplicate of a correction already made. **The fifty-fifth — D-2733 — is a RECORD ONLY**, allocated when this wave finally measured the `test-macos` leg it had been carrying as "unresolved" for three rounds: the leg is RED ON MAIN, and this branch is not what broke it. **The fifty-sixth — D-2732 — was issued by the account-pools coordinator and TAKEN BY THIS WAVE at its offer**, because `server/test/` is this wave's census and not wave 6's; it is defined below, in one place, and nowhere in that programme's own plans.

- **D-2062** — the wave brief asks the offline snapshot revive to tolerate a missing `runId` and a missing `RunSummary.homeProject`. Measured: it can tolerate neither, because it carries neither. `FleetSnapshot` (`pwa/src/lib/offline.ts:23-37`) is `{ savedAt, sessions, roster }`, its one writer is `stores/fleet.ts:347` (`saveFleetSnapshot(msg.sessions, get().roster)`), and no run row or feed record is ever persisted — `runs`/`runsFrameSeen` and `feed` are in-memory store slots only. So the tolerance the brief asks for is vacuous at that seam and REAL at two others, where the data actually crosses a version boundary: `reviveNotifyEvent` (`shared/api.ts`, wave 1) for `runId`, and `runHomeProject` (`pwa/src/fleet/runWords.ts`, Task 5) for `homeProject`. Task 8 therefore pins the FACT instead of writing a reviver with nothing to revive: `offline.test.ts` asserts the persisted key set is exactly `roster,savedAt,sessions`, so the day anyone persists runs or the feed, the missing reviver is a red suite rather than a silent half-revival.

- **D-2063** — `wave N/M` is spelled inline in four places on `main` (`pwa/src/screens/RunsScreen.tsx:701`, `pwa/src/fleet/ArchiveConflictSheet.tsx:122`, `pwa/src/session/MailCard.tsx:48`, `pwa/src/session/PrSheet.tsx:321`), and this wave needs it in two more (the card's orphan marker, the card's abroad line). Adding two more inline copies would take it to six; converting all four is out of this wave's blast radius (two of them are session-screen surfaces this wave does not otherwise touch, each with its own pinned sentence around the fragment). Resolution taken: `waveLabel` lands in `runWords.ts` as THE spelling, this wave's two new sites use it, and `RunsScreen.tsx:701` — the same file this wave already edits, with a test that renders the exact string — is converted, leaving three. The remaining three are named here so wave 3 (or whoever next touches those files) converges them rather than rediscovering the count.

- **D-2064** — the cross-wave contract fixes the orphan marker's text as `<program> wave n/N · home <project>`, and is silent on what it says while `homeProject` is null, which is every programme opened during the legacy generation. Two facts sit in that sentence and only one of them is always measured: the programme and wave come off the run, while the home needs `runHomeProject` to answer. Resolution taken (Task 6): the marker renders for every rule-3 orphan, and the `· home <project>` clause is appended only when a home was measured AND differs from the run's own project — never `home undefined`, and never this card's own project restated. Recorded because a reviewer comparing the rendered text against the contract will find the shorter form and should find this entry first.

- **D-2065** — spec §4 describes two buckets on the mail screen ("groups by programme … programless mail sits under its own header"). The tree needs three. A record whose `runId` is null is programless; a record whose `runId` names a run the `GET /api/runs` read did not return (a rebuilt `coord.db`, a run older than the read, or a read that failed outright) is a record whose programme was NOT MEASURED — a different fact with a different remedy, and folding them would print "not part of a programme" over a record that certainly is. Resolution taken (Task 8): three group kinds, `program:<slug>` / `run:<id>` / `none`, with the middle one headed `run <n> — programme not measured`, and a case pinning that a failing runs read renders every record rather than losing one.

- **D-2560** — the persisted-integer read surface is WIDER than D-2545's item closes. Measured on `ws/bright-meadow` at `aabb2d74`: exactly TWO statements in `server/src/coord/store.ts` prove a persisted INTEGER representable before coercing it, both inside `openRun` (`:647` reading `CAST(id AS TEXT)`, and `:684-704` reading bigints from `lastInsertRowid`); every other read coerces straight into a JavaScript number. D-2545 closes the five the coordinator named plus `insertAsk` and `dispatch`'s own `coord.run` read. The ones it does NOT close are `reclaimProgram` (`:881-884`), `requeueAbandonedMail` (`:1223-1237`), `runHealth` (`:2106-2160`), `hydrateMail` with `mailForRecipient`/`outstandingMailFor`/`mailForProgram` (`MAIL_ROW_COLUMNS` `:516-527`, `hydrateMail` `:2630-2651`), `delivery` (`:2494`), `deliveryEnvelope` (`:2507`), `mailOrigin` (`:2620`), `dueDeliveries`/`deliveredUnacked` (`:2842-2887`), `rejections` (`:3148-3157`), `feedEvents`/`feedEventsForProgram` (`:3207-3263`), `mailQueuedSince`/`runEventsSince` (`:3296-3341`), `hydrateClaim` (`CLAIM_COLS` `:3732-3734`, `:3742-3756`) and `hydrateLedger` (`LEDGER_COLS` `:4104-4105`, `:4107-4113`). RULED by the coordinator, confirming the worker's own ruling: the wide reading is a WAVE, not an item — taking it inside wave 2 would swallow the eight plan tasks beside it — so this number carries the remainder to a later wave, to be done as one pass with the same shape D-2545 establishes (prove representable before `Number`, return all-or-failure, fail shut at each consumer, and put neither a bigint nor a rounded number on any wire). Cost, named: until then those reads can still throw `RangeError` on a database a newer build wrote, which no shipped build can produce.

- **D-2561** — `server/src/watch.ts:852` and `:868` dispatch the PR sweep and the rename sweep as `void this.sweepX().catch(() => { /* one bad sweep must not kill the poll */ })`, and `:860`'s `refreshCaps` does the same. The intent is right and the not-awaiting is right — `sweepPr` shells out to `gh`, which has no `--timeout`, and `sweepNames` joins a `KeyedQueue` a reap can hold for minutes, so awaiting either would stall the dialog detector and the busy→idle push. What is wrong is that the catch body is EMPTY: not a warn, not a counter, nothing. A throw anywhere inside either sweep abandons THAT TICK for every project and every workspace, and the box's only evidence is the absence of an effect nobody is watching for. A deterministic throw therefore reads exactly like a healthy quiet fleet, for as long as it lasts. This is the reason D-2545's blast radius reads as "one row degrades" and is really "the sweep stops" — and it is not about integers at all, which is why it gets its own number rather than riding D-2545's. Remedy: keep both lanes unawaited and keep the tick alive, but make the failure SAY so once per condition — a warn carrying the sweep's name and the error, and a surface a later wave can count — so an unhealthy sweep is distinguishable from a quiet one. Found while measuring D-2545's census; not fixed there.

- **D-2567** — Task 3's two new worker-addressing sentences named a wire field that does not exist. At the reviewed Task-3 commit `16bd93b1`, `ccd/coordinator-skill/references/wave-lifecycle.md` said "either by its session id or as `` `to:"worker"` `` with the run", and `ccd/coordinator-skill/SKILL.md` said "**Address the worker as `` `to: 'worker'` `` with this run's `runId`**" — both transcribed from this plan's prescriptive Task-3 blocks. The same commit's `server/src/coord/routes.ts` reads `body['toId']` in the `POST /api/mail` handler and refuses `bad-kind` when `toId` is not a string; there is no request-body `to` field, so following either sentence literally sends `{"to":"worker",...}` and is refused. Existing role-addressing prose in the coordinator skill, worker skill, mail-envelope reference and lifecycle reference already used `toId`, while the mail-envelope reference gives `to:` a different load-bearing meaning: the RENDERED envelope's resolved-recipient line ("Reading `to:` tells you who this envelope was actually delivered to"). The 2026-09-08 spec itself contained both spellings, so executable route behavior settled the collision. RULING (coordinator, Task 3 fix round 1): correct the two skill sentences and the pinned test literal to `toId`, leaving envelope `to:` prose and the historical broken quotations intact. A claim-wide pass then found the same prescriptive request-field error in this plan, wave 3's unexecuted plan, both crossrepo specs, wave 1's plan, and four shipped test comments; those live claims were corrected, while genuine rendered-envelope uses and historical quotations were deliberately retained. The census is a record of the claim, not of mutable line positions: request bodies use `toId`; rendered envelopes use `to:`. No new number was needed for completing that original ruling's short census. D-2660 separately records this acceptance round's replacement of the entry's false floating citations with this commit-anchored and content-anchored evidence.

- **D-2574** — three guards inside `orphanNote` (`pwa/src/fleet/ProjectCard.tsx`) shipped in Task 6's commit (`958b2aeb`) with the mutation table asserting rows against them that nothing in `project-card.test.tsx` actually exercised — each measured GREEN while a genuinely different control mutation reds in the same run, which is what makes these real gaps and not dead code. (a) Task 6's own report already flagged, rather than silently patched, that mutation 4 (Fragment → a bare `<div>` around the depth-0 row) measured ALL 52 `project-card.test.tsx` cases green. A reviewer reproduced it in Task 6's fix round 1 and went further: with the resulting dead `import { Fragment }` also removed, the mutation is invisible to all 81 pwa test files (2247 tests at review time) and to `npm run build` — no assertion anywhere in the suite distinguishes a `Fragment` wrapper from a class-less `<div>` wrapper, because every one reads class presence, glyph text, or a leaf element's own `outerHTML`/count. Fixed with two `parentElement`-identity assertions added to the existing byte-identical test (`project-card.test.tsx:700-703`); both measured RED under this exact mutation (one failure, `AssertionError` on the row's parent no longer being `.proj-card-body`) then reverted. `previousElementSibling` was tried first and measured NOT to red, because under a wrapper the row and the marker remain siblings of each other. (b) The measured-sameness silence — home equal to the card's own project, silencing the `· home <project>` clause — had no dedicated witness in `project-card.test.tsx`; RunsScreen's own suite pins the shape of the shared predicate, but nothing proved ProjectCard reaches the same silence. Reachable in production: `group.sessions.some(...)` inspects only `group.sessions`, never `group.archived`, so a worker whose coordinator session has moved to the archived bucket clears the parent guard exactly like a genuinely off-card coordinator — and when that programme's home is this card's own project, the marker must still say nothing about a home. Added a case with an archived coordinator and `homeProject` equal to the card's project; measured RED (exactly one failure, `expected '…· home demo' not to contain 'home'`) when `crossingNote`'s own sameness check (`runWords.ts:419`) is narrowed from `home === null || home === run.project` to `home === null`, then reverted. (c) Both clauses of `if (parent === null || parent === row.session.id) return null;` were unwitnessed. The `parent === null` clause (an unclaimed run) is a real, independent guard: measured RED under its own removal, exactly one failure (`marks no row for an UNCLAIMED run`, `expected <div class="proj-crossing"> to be null`), reverted. The `parent === row.session.id` clause (a self-claimed run) is, on measurement, NOT independently witnessable: a rendered row's own session is by construction always a member of `group.sessions` (rows are built from that exact array), so `parent === row.session.id` implies `group.sessions.some((s) => s.id === parent)` is trivially true — removing this clause alone changes nothing for any reachable row. Measured against `project-card.test.tsx` (55/55 green, the new self-claimed case included), against the full pwa suite (81 files, 2250 tests, all green) and against `npm run build` (clean) — all three stayed green under this exact mutation. Adjudicated and UPHELD by the re-review in fix round 2, which traced the same invariant independently (one `orphanNote` call site, one `rows` producer, `group.archived` disjoint from `group.sessions` by construction in `groupFleet.ts`'s own bucket split — the adjacent `members.filter((m) => m.bucket !== 'archived')` and `members.filter((m) => m.bucket === 'archived')` pair, cited by its text rather than by line number per D-2586, because the number in the original entry was off by one): a true invariant, not "usually true". The self-claimed test is kept as a behavioural pin on the compound guard and as the documentation of the intended case, but it is not, and structurally cannot be, an independent witness for this one clause; recorded here rather than restructuring the guard, since neither fix round asked for that and the two clauses read as one intentional two-reasons-for-one-silence statement even where one reason is provably redundant with the line beneath it. (Fix round 1 first recorded this pair as "first half"/"second half" by the order the operator's fix request presented them, which collided with a "first half" the surrounding code comment used for source order instead; fix round 2 names each clause directly here, in the code comment, and in the test comments, so no text depends on position.)

- **D-2575** — `orphanNote` re-spelled `crossingNote`'s predicate (`runWords.ts:419`, `home === null || home === run.project`) as an identical second copy at `ProjectCard.tsx:225`, instead of consuming Task 5's own decision. `single-definition.test.ts` could not have caught this: it scans for a second copy of a NAMED VALUE, not a re-spelled PREDICATE — exactly the class `waveLabel`'s own docstring warns a fragment this small drifts into. Fixed: `orphanNote` now calls `crossingNote({ ...run, project: group.project })` (see D-2576 for why the `project` field is overridden) and takes `home` from the returned `CrossingNote`'s own `home` field, dropping the `runHomeProject` import this component no longer calls directly. The rendered text is unchanged for every existing case: `project-card.test.tsx` was 52/52 green before this fix round and is 55/55 green after it, with none of the pre-existing 52 cases' assertions touched.

- **D-2576** — the card's crossing check compared `home` against `run.project`, where spec §3 F4 says the card's own project. The two read identically today only because `FleetScreen.tsx:491` filters the `runs` prop it hands each card down to that card's own project — an invariant enforced in a DIFFERENT file, which this component may not lean on now that Task 7 lands an `abroad` list on this same component whose entire point is a run naming a project OTHER than the card's. Fixed as part of D-2575's refactor: `crossingNote({ ...run, project: group.project })` overrides the spread run's `project` field with `group.project`, verified in scope — `group` is already a prop this component destructures and reads elsewhere (`group.sessions.some(...)`, one line above the call site). **Witnessed in fix round 2**, after the re-review measured the fix's own gap: reverting the call to bare `crossingNote(run)` left `project-card.test.tsx` 55/55 green, meaning nothing in the file could tell `run.project` from `group.project` apart. Closed with a two-line fixture — a card at `group.project: 'demo'` carrying a run at `project: 'other', homeProject: 'other'` — where the run's own project matches its home (so a `run.project` comparison reads measured sameness and stays silent) but the card's project does not (so the correct, `group.project` comparison reads a genuine crossing and names it). Measured RED under the revert-to-`run.project` mutation: exactly one failure, `expected '⇄build9b wave 1/3' to contain 'home other'`; reverted, 56/56 green again.

- **D-2580** — the orphan marker's `title` reads `` this worker's coordinator is not on this card ``, and that sentence is false in the exact scenario D-2574(b) pins: an archived coordinator IS a row on this card — `group.archived.map(...)` renders it as a full `SessionLine` under the `Archived (N)` fold, which shows unconditionally — just not among this card's LIVE rows, which is the fact the guard actually reads (`group.sessions.some(...)`, not a check over `group.archived`). The string itself predates this wave; what makes it live rather than merely imprecise is that Task 6's fix round 1 is the first artifact to assert the archived-coordinator scenario is INTENDED behaviour and pin it with a test (`says nothing about home when the measured home IS the card's own project — coordinator archived elsewhere on this card`) — before that test existed, nothing in this codebase claimed the archived case was reachable, so the string's inaccuracy there was theoretical. RULING (re-review, fix round 2): pulled into this wave's scope rather than deferred, because the same commit that makes the false case reachable-and-intended is the one that should not also ship the false sentence describing it. Fixed: both `title` literals in `orphanNote` (the label-only arm and the `· home` arm) changed from "this worker's coordinator is not on this card" to "this worker's coordinator is not among this card's live sessions", keeping the rest of each sentence (including the `; the programme is homed in ${crossing.home}` suffix on the second) unchanged. No test asserted the old string as a `title` attribute value — checked directly (`grep` over `test/project-card.test.tsx` for `.title`/`toHaveAttribute('title'`/`getAttribute('title'` found only the unrelated `+`-button aria-label case) — so no test needed updating for the string itself. **CORRECTION, final review:** this entry then called the comment in `project-card.test.tsx` that quotes the old string "pre-existing" and left it untouched on that basis. It is not pre-existing — `git log -S` names `958b2aeb`, THIS wave's own Task 6 commit, as the commit that added it, so the quote was introduced and falsified inside one wave, and "pre-existing" was the premise that licensed leaving a string the tree no longer contains. Corrected in the final fix round (`dc3aba50`) to the shipped sentence. The lesson is the one D-2586 records in its own words: a claim that something PREDATES this wave is a measurement like any other, and `git log -S` is what settles it — not the impression that a line looks older than the diff around it.

- **D-2581** — the abroad-tree guard's own test, `does not draw the abroad run into the tree — nestFleet is called with \`runs\` alone` (Task 7's report, D-2581), asserted a guarantee it could not measure. The coordinator's own first ruling on Task 7's report — that a pending-shaped fixture (`away`'s default `state: 'dispatched'`, never entering `isDispatchWindow`'s pending branch) would be a complete witness, because `nestFleet`'s SETTLED path can never admit an abroad run — was itself WRONG, and the review refuted it by measurement rather than by re-arguing the theory: it built an abroad run keeping `project: 'other-repo'`/`homeProject: 'demo'` but with `sessionId` set to a session already present on the card (`'demo-still-cove'`), and measured it RED under the `nestFleet(group.sessions, [...runs, ...abroad])` mutation and GREEN against the shipped tree — proof the settled path is independently reachable and was, until this fix round, entirely unwitnessed. The reason the earlier ruling was wrong: `nestFleet`'s settled path keys ONLY on `sessionId`/`claimedBy` being members of `group.sessions` (`nestFleet.ts`'s `onList`) — it never reads the run's own `project` field — so nothing in `pwa/` stops a run whose `project` names another repo from also naming a `sessionId` that happens to be a session on THIS card. What actually closes that gap is a SERVER-side invariant ("a run's worker session lives in the run's own project"), enforced nowhere in this tree; leaning on it inside a `pwa/` test is the identical lean D-2576 was minted for, one layer out. RULING (coordinator, Task 7 fix round 1): closed with BOTH witnesses rather than one. The pending path is closed by giving the existing case's fixture `state: 'planned'` and a `dispatchStartedAt` in the frozen-clock window, built locally as its own object rather than by mutating the shared `away` fixture the other four cases in the same `describe` block still use unchanged. The settled path is closed by a second, new case spreading `away` with only `sessionId` overridden to a session already on the card, rendered against a two-session group (`grp({ sessions: [sess(), worker] })`) so the shared session is actually present to match against. Both measured RED under the mutation (`project-card.test.tsx`: `does not draw the abroad run into the tree — nestFleet is called with \`runs\` alone` and `does not draw the abroad run into the tree via the SETTLED path either — a shared session id must not bracket it (D-2581)`, 2 of 62 failing), then GREEN after reverting it (62/62). Fixed in the same fix-round commit that records it.

- **D-2582** — `pwa/src/screens/FleetScreen.tsx`'s comment on the `abroad` filter claimed it "is the exact complement of the filter above." Measured false: the two filters are disjoint on any ONE card (a run cannot satisfy `r.project === g.project` and `r.project !== g.project` at once) but they are not a complement of each other, because there is no universe in which exhausting both would cover every run — a run homed on a third project and working on a fourth is in NEITHER of a given card's two lists, and a crossing run appears in `runs` on the WORKING card and in `abroad` on the HOME card, which are two different cards' lists, so there is no partition across cards either. The clause immediately following it in the same comment — "that one asks where the work is, this one asks whose programme it is" — is true and was kept unchanged. RULING (coordinator, Task 7 fix round 1): rewrite the false sentence only; a comment in this tree is a claim, and this one was checkable and wrong. Fixed in the same fix-round commit that records it.

- **D-2583** — Task 8's brief gave both the grouping implementation and its own tests verbatim; transcribed exactly, two of the six new `mail-screen.test.tsx` cases failed deterministically. Both mounted two `e()` fixtures with no explicit `at` override and asserted the resulting `.mail-group-head` order as `['Build 9b: peers and claims', 'Cross-repo programmes']` — the order the two events were written in the array literal. `MailScreen.tsx`'s own `const rows = [...feed].reverse();   // newest first on screen; oldest-first in the store` line (pre-existing and unmodified by this task, cited here by its own comment text rather than a line number — D-2586 found that the SAME commit which first cited this line by number, `59881c7b`, also moved it from `:108` to `:141`, so a numeric citation would have been false on arrival, never merely falsified by a later change) together with `lib/feed.ts`'s `mergeBySeq` (`x.at - y.at || x.seq - y.seq`, ascending) means that with no explicit `at`, the SECOND-constructed event's timestamp is always `>=` the first's (`Date.now()` is monotonic), so it always sorts as newest and renders first — the opposite of what the tests asserted. Confirmed by rendering the actual DOM: `['Cross-repo programmes', 'Build 9b: peers and claims']`, reproduced identically on 3 runs. Two fixes were possible: (a) make the grouping iterate ascending `feed` instead of newest-first `rows`, or (b) correct the tests. (a) was rejected — it would have silently reversed the mail screen's shipped, documented newest-first display order for every user, to make an incidental test assumption pass. RULING (coordinator): the tests were wrong. Fixed by giving both cases explicit `at` values 60 seconds apart (stating the intended order instead of leaning on `Date.now()` monotonicity or a same-millisecond `seq` tiebreak), asserting the newest-first order consistent with `MailScreen.tsx`'s own "newest first on screen" comment, and commenting each case with that same text — not a line number — as the authority. Fixed in the same commit that records it.

- **D-2584** — a stale mail-filter selection renders the screen completely blank, silently. `filter` holds a group KEY, and that key can change under the same record: before the async `GET /api/runs` read lands, a run-bearing record keys `run:5`; after, it keys `program:build9b`. Tap the `run:5` chip in that window and `shown` (`[...groups].filter(([key]) => filter === null || key === filter)`) becomes empty once the key moves, while the empty-state branch a few lines below tests `rows.length`, never `shown.length` — so the screen renders literally nothing: 0 rows, 0 headers, no chip shown as pressed (not even All), no message. "There is no mail" and "nothing matches this filter" collapse to one silent render, the same overloaded-null-shaped defect this task exists to fix, one layer out. Two fixes were possible per the brief's own framing: drop a filter whose key is no longer in `groups` (treat as All), or give `shown.length === 0 && rows.length > 0` its own honest line. Chosen: the first — a key changing out from under an already-correct selection is a race in this screen's own bookkeeping, not the reader's mail actually failing to match anything, so the fix that needs no reader action is the more honest one. Implemented as `const activeFilter = filter !== null && groups.has(filter) ? filter : null;`, read everywhere `filter` previously was (both `shown`'s own filter predicate and each chip's `data-on`/`aria-pressed`). Pinned with a new case that taps a chip before a deferred `loadRuns` resolves, then resolves it, asserting both records render again and the All chip reads `aria-pressed="true"`; measured RED (exactly one failure) reverting `activeFilter` to a bare alias of `filter`, GREEN restored after.

- **D-2585** — `eventRunId`'s own stated purpose — belt to `reviveNotifyEvent`'s braces, for "a row that reached the renderer without proving it went through revival" — had no witness anywhere in this repo, sharpening the worker's own Step-5 report (task-8-report.md) that mutation 3 (`eventRunId(ev)` → `ev.runId`, deleting the fixture's default `runId`) stayed green under the brief's own stated verification command. Root cause confirmed by the review: every case in `describe('the feed, grouped by programme', ...)` mounts through `loadFeed`, which always revives (`reviveNotifyEvents` → `reviveNotifyEvent`, `shared/api.ts`) before a record ever reaches `groupOf`, so no fixture in that block can ever carry an un-normalised `runId` by the time `eventRunId`/`ev.runId` reads it — the two readers are indistinguishable from every angle that block can test. Closed with a case that puts a row into the store DIRECTLY (`act(() => { store.setState({ feed: [...] }); })`, the idiom the older `describe('the mail feed', ...)` block already uses), bypassing revival on purpose, built with `runId` omitted from the object entirely (via object-rest destructuring, not merely set to a falsy value) and cast `as unknown as NotifyEvent` — the cast is load-bearing, since a real `NotifyEvent` literal cannot omit a required `number | null` field under `tsc`, and is commented as such. Asserts the row lands under "Not part of a programme". Measured RED under the mutation named above (exactly one failure, the head reading `run undefined — programme not measured` — confirmed by inspecting the failure's own rendered DOM), GREEN on the shipped tree.

- **D-2586** — two comments in `pwa/test/mail-screen.test.tsx` cited `` `MailScreen.tsx:108` `` as the authority for the newest-first display convention. Measured (`git show <ref>:pwa/src/screens/MailScreen.tsx | grep -n 'reverse()'`): `13de447c` (pre-task) has that line at `:108`; `59881c7b` (this task's own round-0 commit) already has it at `:141`; `9decbaa6` (round-1's commit) is unchanged from `59881c7b` at `:141` and touches nothing in `MailScreen.tsx` above line 165. So `59881c7b` is the SAME commit that both introduced the `:108` citations and moved the line to `:141` — the citations were FALSE ON ARRIVAL, not falsified by anything that came after; there was never a window in which they were true. (Fix round 1's own text here blamed "this commit's own D-2584/D-2585 additions" — round 1's own fixes — for the move; that was wrong, corrected in fix round 2, per the coordinator's own re-measurement.) What actually sits at `:108` today is `store.getState().mergeFeed(events, d);`, inside the feed read's `.then()`; the `.catch()` is at `:111` — fix round 1's claim that `:108` "now sits inside the feed read's own `.catch()`" was itself a false measurement, corrected here. The entry's broader point stands on the corrected grounds regardless: a citation naming executable code that is not the code it once named is actively misleading, not merely stale. The identical citation appeared twice more in this plan document (the D-2583 narrative and its own bullet) — FOUR live citations in total, not two as fix round 1's own intro-paragraph summary said (corrected there too). All four LIVE citations fixed: replaced the line-number form with a citation by the comment's own text ("newest first on screen"), which a future line move cannot falsify the same way. A FIFTH instance is this plan's own pre-change snapshot at `:1873` (`` `pwa/src/screens/MailScreen.tsx:38` and `:108-109` ``) — left untouched, deliberately: under this repo's "anchors in plans are snapshots" convention, that quote is a record of what the brief said at the time, not a live claim, and editing it would misrepresent the historical brief rather than fix a citation. In the same pass, trimmed `fleet.css`'s `.mail-chip` block comment, which claimed "the header above each list says in words what the chip selected" — untrue of the **All** chip, under which every header shows at once, not the one the chip names — to say so only of every chip but All.

- **D-2587** — `keeps rendering every record when the runs read fails` mounted exactly ONE record, so "every record" was a claim asserted over a population of one; a mutation dropping every record but the first on a failed read would have stayed green (measured: slicing `rows` to its first element alone reds seven pre-existing cases across the file when applied file-wide, none of them this one specifically pinned before the widening — proof the single-record fixture gave this claim no discriminating power of its own). Widened to three records — an ask (no `runId`, the newest), a run this read might otherwise have resolved (`runId` 6), and an older one (`runId` 5) — with explicit `at` values 60 seconds apart (D-2583's own lesson, applied here rather than repeated by omission), asserting all three titles render and the newest-first headers read `['Not part of a programme', 'run 6 — programme not measured', 'run 5 — programme not measured']`. Measured RED under a `rows = [...feed].reverse().slice(0, 1)` mutation (this case among seven failures), GREEN reverted.

- **D-2589** — the run surface carries NO LIVENESS. Found by the coordinator while measuring this worker session's own idle gap, and allocated by it; a RECORD ONLY, not wave-2 work. Run 44 read `dispatched` with entirely clean health for roughly three hours while the worker's process was not running at all, and nothing on any surface distinguished that from a wave being actively worked. The state is a WRITE stamped at dispatch time; nothing re-measures it, so a run row asserts "this is being worked" on the strength of an act that happened once, however long ago. The failure is silent by construction — a stalled wave and a busy wave render identically, so the only detector is a human noticing that nothing has changed, which is exactly the detector this programme exists to replace. Note the SHAPE, because it is the same one D-114 and `a-hold-is-a-state-of-the-world` already name: a value that was true when it was written is not a measurement of the world now, and a surface that presents one as the other is not merely stale, it is asserting something it never checked. Remedy NOT ruled: a heartbeat, a re-measurement at read time, and a displayed "last measured" stamp are three different designs with three different costs, and choosing between them is a wave's worth of argument, not a line in this entry.

- **D-2590** — D-2545's hardening uses `CAST(col AS TEXT)`, not the ruling's `setReadBigInts(true)`. Allocated and defined by the worker session in one act, under the coordinator's standing ruling that self-allocation is fine for the rest of this programme, and CONFIRMED by the coordinator on review (mail 792), which corrected its own wave-1 text: the parenthetical was right for `lastInsertRowid`, the one place it fits, and was generalised from there to a read path where it does not. The departure and its warrant: `setReadBigInts` is per-STATEMENT, not per-column, so enabling it on the run SELECTs converts EVERY integer column of those statements to `bigint` — `openedAt`, `resumed`, `clearedAt`, `dispatchStartedAt`, `dispatchedAt`, `closedAt`, `briefQueued` and the health subqueries with them — forcing a conversion on a dozen columns that are not in this defect's domain and widening the blast radius far past the three that are (`id`, `wave`, `waveOf`). `CAST(col AS TEXT)` is surgical, and it is not a new idiom: it is exactly what the store's ALREADY-PROTECTED sibling arm does at `store.ts:647`, which is the very sibling D-2545's own text cites as proof that the store protects one persisted-read path and not the other. Same invariant proven (`isPositiveDecimalSafeInteger` before any `Number`), narrower change, existing in-file precedent, and `CAST(NULL AS TEXT)` is `NULL` so `waveOf`'s nullability survives untouched. Cost, named: two mechanisms now exist in one file for the same guarantee — the bigint check on a freshly generated id, and the TEXT read on a persisted one — and the reason they differ is that only one of them can see a value SQLite has not yet handed back as a row.

- **D-2616** — `runForSession` returned the FIRST match where the protocol guarantees there can be two. Allocated by the coordinator for a pre-existing defect this wave exposed when Task 5 made the choice visible. `GET /api/runs` returns `ORDER BY id`, while the lifecycle requires opening wave N+1 before closing wave N; during that boundary the older outgoing and newer incoming rows can name the same session. Implemented in the acceptance correction at `30a5270f`: `runForSession` now chooses the matching row with the greatest run id, the same ordering decision the server's `survivorOf` makes, and `pwa/test/runs-screen.test.tsx` proves reverting to first-match selection names the outgoing wave.

- **D-2625** — D-2545's typed read surface is SIX result types, not the brief's five. `currentAsksFor` answers a `Map<string, AskRow>`, not a list, so `AsksReadResult` cannot carry it; `AsksByChildResult` is its keyed sibling. The alternative considered and rejected was to return the list and re-key it in `pwa`-facing `fleet.ts` — which would move a STORE concern (what the rows are keyed by) into an adapter, the direction this codebase's layering forbids, and would have made the caller reconstruct a grouping the query already knows. Recorded rather than absorbed silently because "five result types" was a countable claim in the brief and is now false; a reader checking the brief against the tree must find the sixth explained rather than unexplained. Two new codes ride the same departure: only `runs-unreadable` was ruled, and `run-unreadable`/`ask-unreadable` are the implementer's. All three are admitted to `mail-routes.test.ts`'s `NOT_CODES` — the read-failure family — rather than to `RunRefuseCode`, whose members `coordinator-skill.test.ts` requires to be DOCUMENTED IN THE COORDINATOR CORPUS, an AGENT-FIRST artifact this wave does not ship. Putting them there would have made this wave's server change depend on a skill deploy.

- **D-2626** — `takeAskForAnswer` and `reconstruct` keep THROWING rather than returning a typed result, though both are in-scope callers of the hardened reads and neither appears in D-2545's consumer table. The argument, which I accept: each is unreachable-by-construction from an already-guarded caller (the guarded read runs first and refuses before either is entered), and each already had exactly this failure mode before this wave, so neither is a regression. Widening `AskTakeResult` to carry an unreadable arm would put a word that can never reach the wire into a vocabulary TWO ROUTES SEND VERBATIM — a cost paid on every future reader of those routes, to describe a state those routes cannot observe. Cost, named honestly: the file now has two disciplines side by side — typed refusal on the read path, throw on these two — and the reason is not visible at either call site, only here and in their own comments. That is the same shape `store.ts`'s own `SetWorkItemResult` docstring complains about, and it is a real, if small, debt rather than a clean boundary.

- **D-2627** — `hydrateAsk`'s TIMESTAMP columns (`at`, `askAt`, `answeredAt`, `releasedAt`) are deliberately NOT guarded, though "ask hydration" is one of the five reads D-2545 names. They are epoch milliseconds, not run ids: they are outside `isPositiveDecimalSafeInteger`'s domain (that predicate asks `>= 1`, which is true of every real timestamp and says nothing useful about one), and `insertAsk`'s own ruling names `runId` alone. Stated in `ASK_COLS`'s comment and attributed there to D-2560, which already carries the wider persisted-integer surface. **The line to revisit if this is wrong:** if total coverage of `hydrateAsk` was intended rather than coverage of its ID columns, this is the entry that says it was not done, and the remedy is a domain predicate for timestamps rather than reusing the run-id one — reusing it would be a guard whose message names a cause it cannot detect.

- **D-2653** — the between-wave dependency rule could not execute the state proof it required. The coordinator reference placed the producer-state check before the close that makes the producer `done`, while plain `GET /api/runs` omits `done` and `failed` rows and the closed client declared no `closed` query on `runs list`. Fixed claim-wide: `ccd/ccrc-api` now declares `closed` for its existing `runs.list` row; `server/test/ccrc-api.test.ts` behaviorally proves `ccrc-api runs list --closed 1` reaches exactly `/api/runs?closed=1`; and both coordinator corpora now order OPEN successor, project-appropriate CLOSE producer, closed-row read by exact run id, independent exact-SHA merge proof when there is a dependent interface, then DISPATCH. Missing or non-`done` rows fail shut. The historical 2026-08-11 specification remains byte-for-byte identical to `origin/main`; the 2026-09-08 spec and both active plan copies carry the executable current procedure.

- **D-2656** — the foreign-plan contract named a SHA but read a mutable filesystem file, so the citation's content was not mechanically frozen. Fixed after the coordinator verified the exact tuple: `homeRepoRoot` is the absolute home repository root, `planRepoPath` is a tracked repository-relative path with no leading slash, and `planSha` is a full 40-hex commit SHA. A worker reads exactly `git -C "$homeRepoRoot" show "$planSha:$planRepoPath"`; an unresolvable repository, commit, or path means report and stop, never `HEAD`, direct current-checkout reading as authority, fetch, checkout, or writing the home repo. The inline excerpt remains authoritative for dispatched interface shape; the blob at `planSha` is authoritative for wave scope and requirements. D-2687 adds the separate producer-source provenance tuple rather than overloading this plan tuple. Both shipped skills, their tests, the live 2026-09-08 spec, and the prescriptive wave-2/wave-3 copies state the same split.

- **D-2657** — live cross-repo prose overloaded `ledgerAbsPath` as a plan location or repository root even though the API returns only the programme ledger at `docs/superpowers/programs/<slug>.md`. Fixed claim-wide by keeping `ledgerAbsPath` ledger-only and carrying the plan coordinates separately from the home checkout root under `docs/superpowers/plans/`. The correction covers the coordinator corpus and harvest test, the 2026-09-08 spec, and both wave plans; historical wave-1 D-2349 material and the superseded 2026-08-11 spec's original account remain untouched.

- **D-2658** — the live specification and wave-3 README/test brief called plain `GET /api/mail?program=<slug>` the complete programme history. The route's default is only outstanding or abandoned work needing attention; complete mail history requires exactly `GET /api/mail?program=<slug>&all=1`, while `GET /api/feed?program=<slug>` is the full event archive. Fixed in the 2026-09-08 spec and in both wave-3 proposed prose tests, so a future docs wave must pin the default lane and exact `&all=1` history URL rather than merely the base route.

- **D-2659** — live branch prose still described the coordinator and worker skills as ten and twelve clauses after their derived contracts had reached eleven and thirteen. Fixed every prescriptive instance in the active 2026-09-08 spec, programme ledger, wave-2 plan and tests, and wave-3 plan. Historical narratives that intentionally describe an earlier thirteen-to-twelve mutation remain unchanged. No contract array or count mechanism changed.

- **D-2660** — D-2567's historical defect record relied on floating line numbers that no longer located the quoted evidence after this wave edited the same corpus repeatedly. Fixed without rewriting the historical broken `to:` spellings: the entry now anchors executable facts to the commit that Task 3 reviewed and identifies prose evidence by quoted content or enclosing artifact rather than claiming today's line positions. The distinction remains explicit: request bodies use `toId`; rendered envelopes use `to:`.

- **D-2654** — `insertAsk()` returned `Number(lastInsertRowid)` without first proving that SQLite's generated primary key was exactly representable in JavaScript. `DatabaseSync` can expose an unsafe generated id as a rounded number, so the caller can be told the id of a different row. Fix the insert statement to read integer results as `bigint`, require a positive value no greater than `Number.MAX_SAFE_INTEGER`, and perform that validation inside the transaction so an unsafe generated id rolls the insert back. A regression seeds `sqlite_sequence` at the safe ceiling and proves the call throws, no row survives, and no rounded id escapes.

- **D-2655** — thirteen textual `:id` route seams accepted values by applying `Number(text)` and then testing the resulting number. That accepts non-canonical resource names such as `1.0000000000000001`, which rounds to `1` and can mutate resource 1. Add one L0 parser for canonical positive-safe decimal text and use it at mail acknowledgement/fetch, run dispatch/close/abandon/reclaim/advance, run-item settlement/read, claim release/break, and ask answer/release. Reject fractions, exponents, signs, whitespace, zero, leading zeroes, and unsafe values while preserving each route's existing refusal vocabulary; the abandon witness also proves run 1 and the fleet boundary remain untouched.

- **D-2680** — the README's programme walkthrough closed wave N before opening wave N+1. The close can reduce the open-run count to zero and permanently retire the programme, so later role-addressed coordinator mail fails even if a new run is opened. Fixed in `4c4f735d` and pinned in `694a2147`: open the successor first, close the producer second, and never let the programme reach zero open runs between waves.

- **D-2681** — the coordinator lifecycle presented same-session, same-workspace succession as universal even though a workspace belongs to one project. A same-project successor reuses `sessionId` and transfers the hold; a cross-project successor opens without it and spawns in the target repository. Split the generic lifecycle into those two procedures in both coordinator corpora and every active prescriptive copy.

- **D-2682** — the coordinator skill's canonical `runs open` body omitted `homeProject`, contradicting its own rule that every open carries the programme's immutable home. Add `homeProject` to the executable example so copying the documented call cannot create a legacy-null programme row, and derive the example's complete key set in `coordinator-skill.test.ts` so deleting that field from the call site turns red.

- **D-2683** — the bounded `ccrc-api` documented ask listing, answering, and releasing but exposed none of those routes, leaving both skill clause 11/13 and live operator ask notifications unusable without the forbidden raw-HTTP escape hatch. Add closed-table rows for `asks.list`, `asks.answer`, and `asks.release`; derive the ask-list caller identity narrowly from the current pane, inject `fromUuid`, reject a supplied parent that differs from that identity, keep arbitrary host/path/raw and general identity overrides absent, render all three skill commands as executable fenced blocks, and mechanically prove every executable corpus command maps to a declared row. Acceptance review found two executable-corpus defects: leaving the commands as prose-inline examples made the corpus harvester see only `mail.send` and `runs.open`, so deleting an ask row stayed green; then fencing a bare `<id>` made copied Bash parse it as input redirection. The fenced variable-based examples, pinned five-command harvested set, explicit shell-placeholder guard, and individual ask-row deletion mutations close both gaps.

- **D-2684** — a producer run in `state:'done'` proves that its handoff fingerprint passed and the run closed; it does not prove the producer interface PR merged. Before dispatching a dependent consumer, require both the closed producer row and independently measured proof that its PR merged at the producer SHA named in the foreign interface contract.

- **D-2685** — closing a cross-project producer with `final:false` creates a synthetic next-wave hold on the producer workspace even though the already-open successor has a different workspace. That strands the producer claim. Cross-project succession closes the producer with `final:true`, requires `released:true`, verifies the closed row, proves the named producer SHA merged, and only then dispatches the consumer; `final:false` remains the same-workspace transfer only.

- **D-2686** — the crossing corpus said two held workspaces consume two running-worker concurrency slots. The server's cap counts dispatched non-terminal runs, not held workspaces: a terminal retained producer and a planned undispatched consumer consume no running-worker slot, while each actual dispatch still consumes daily budget. Replace the false slot arithmetic with the measured accounting and keep ordinary cap refusals authoritative.

- **D-2687** — the foreign contract excerpt named an immutable plan tuple but not the source artifact whose interface the consumer uses or the exact merged producer commit providing it. Require the excerpt to name the producer repository-relative source-file path and full merged producer SHA. Read interface shape from that immutable producer blob, keep the inline excerpt as the dispatched shape authority, and gate dependent dispatch on merge proof for that same SHA.

- **D-2715** — D-2687's immutable producer read used `git -C "$PWD"`, but a cross-project worker's current repository is the CONSUMER and Git object lookup is repository-scoped. The producer commit will normally not exist there, so the documented proof fails even when every named producer coordinate is correct. Carry an independently resolved `producerRepoRoot` and read exactly `git -C "$producerRepoRoot" show "$producerSha:$producerSourceRepoPath"`. A two-repository behavioral fixture runs from the consumer repository, proves the producer blob resolves only through the producer root, and turns red if the command regresses to `$PWD`.

- **D-2716** — D-2687 made producer coordinates and an inline interface excerpt mandatory for every foreign-plan wave, but a wave may work in another repository without consuming an interface from its predecessor. The plan tuple (`homeRepoRoot`, `planRepoPath`, `planSha`) remains mandatory for every foreign-plan wave. The producer tuple (`producerRepoRoot`, `producerSourceRepoPath`, `producerSha`) and inline interface excerpt are mandatory only when dispatch depends on a producer interface; a no-dependency foreign brief must not invent them. Contract tests pin both arms independently.

- **D-2717** — the lifecycle ordering test found the first `close the producer` and first closed-row read in a combined section, constraining only the same-project procedure. Moving the cross-project closed-row check before its `final:true` close remained green even though that read cannot prove the post-close `done` state. Give each branch its own explicit open, close, and closed-list sequence, then slice and assert open → close → closed-row proof independently for same-project and cross-project succession.

- **D-2718** — the executable ask examples initialized `ask_id=123`, a canonical positive resource id that may name a real held ask. Copying either block without replacing that line can therefore answer or release live work. Require the caller to supply a canonical positive ask id through a fail-fast expansion before any client invocation, with no valid default. Execute each complete documented block against a fixture client and assert both the no-id refusal and the exact expanded argv; deleting or weakening the initializer must turn the intended test red before any request occurs.

- **D-2719** — the bounded client's `asks list` query carried only derived `parent` and `fromUuid`, while the surrounding documentation promises the caller's open asks. Server omission of `state` is deliberately an unfiltered diagnostic read and returns held, answering, answered, released, and stale rows. Keep that server capability, but hard-code `state=held` in the closed client's derived query; do not expose arbitrary state selection. The behavior test pins the exact URL so deleting the held filter turns red.

- **D-2720** — executable-corpus parity harvested fenced blocks only, but the shipped references also use Markdown's four-space indented code blocks. Five real client operations (`runs.list`, `peers.list`, `claims.take`, `claims.release`, and `ledger.allocate`) were therefore invisible: changing an indented `peers list` call to an undeclared verb left every parity test green. Harvest both fenced and indented executable blocks and pin the exact ten-operation set, so mutating or deleting any newly visible command turns red.

- **D-2724** — `refuse` writes its JSON envelope to stdout, and the header two screens above it promises "stdout stays machine-readable on every path". But `server_url` and `read_token` were called as `base=$(server_url) || exit $?`, so on the three config refusals — `no-agent-env`, `no-server-url`, `no-token` — the command substitution CAPTURED the envelope into the variable and `|| exit` discarded it. Measured in a fixture HOME with a fake curl: stdout empty, exit 2, the refusal visible only on stderr. A coordinator following `references/resume.md`'s own `body=$("$API" runs list)` therefore got `''` where a named refusal was promised, on exactly the box condition that refusal exists to name. Both functions now SET a global, as `derive_identity` already did for this same reason — its comment names the hazard and names `server_url` as having that shape. The existing cases could not see it: they assert `stdout + stderr`, a concatenation the stderr copy alone satisfies. The new cases `JSON.parse(r.stdout)`. SCOPE, corrected by the account-pools coordinator after this entry was first written and accepted: the break is SILENT only for a caller that tests the output for emptiness — a caller that parses the envelope gets a loud throw instead, and the exit status is 2 either way. The exposed population is helpers shaped like `[ -z "$out" ] && echo 'no rows'`, which is a small and findable set; saying "anyone who uses the client" would send the next reader to harden call sites that were never at risk.

- **D-2725** — `refuse` built its envelope with `printf '{"ok":false,"error":"%s","detail":"%s"}'` over raw argv, and four `detail` strings embed caller text verbatim (`no such verb: $group $verb`, `cannot read $body_src`, `unexpected argument: $1`, `$group $verb takes no --$k`). A `"`, a `\` or a newline in an argument therefore produced an envelope that does not PARSE — in the one place the file promises a caller never parses two shapes, at the moment a caller is being told it got something wrong. Measured: `runs open --json '/tmp/a"b'` emitted `..."detail":"cannot read /tmp/a"b"}`. Escaped once at the door rather than at each site, and the detail still names the offending value so the caller can act on it.

- **D-2726** — the route table spells "this row declares no query keys" as `-`, and the membership test is `[[ ",$qkeys," == *",$k,"* ]]`. `-` is therefore both the sentinel AND a string that test matches: `",-,"` contains `",-,"`. An argument of `---` makes `k` the sentinel, passes the guard, and appends `-=<value>` to the query, so `runs open --- smuggle` built `?-=smuggle` and sent it. Thirteen rows were affected. The value was still `SAFE_RE`-constrained, so nothing could be injected — but an UNDECLARED key reached the wire, which falsifies the closure property the table exists to state. The sentinel is now rejected BEFORE the membership test rather than by it, with a control case proving real declared keys still pass.

- **D-2727** — executable-corpus parity harvested the client only where it was written as `$API`/`"$API"` or as the fully quoted `"$HOME/.local/bin/ccrc-api"`. The corpora also use the bare on-PATH spelling (`mail-envelope.md`'s `ack: ccrc-api mail ack 7 --json -`, `SKILL.md`'s `ccrc-api runs items-list <run>`), and an invocation written that way entered NO census: an undeclared verb in an executable block stayed green. This is D-2720's own defect class one level in — a census assembled from the spellings that already comply cannot see its next violation — and it is the second time this round that shape has been found, after the thirteen-seam route census. Harvest is now on the binary name.

- **D-2728** — the wave-3 plan prescribes both a test and the prose that test runs against, and they disagreed: measured against the plan's own fenced sections, five of its prescribed assertions could not match its prescribed prose, every one because the phrase the regex requires WRAPS across a line (`no invented\nexcerpt`, `requirements\nauthority`, `without the producer's\n\`sessionId\``, `full feed\narchive`, `\`project-mismatch\`\nnever fires in anger`) or because a window is too narrow (`producerRepoRoot` to `inline` measures 206 characters against a 160-character window). A wave-3 worker transcribing both halves as instructed would get a red suite the plan declares "Expected: PASS", and the likeliest repair is to edit the PROSE — which is correct — rather than the regex. The assertions are now whitespace-tolerant and the window widened. Nothing executes plan documents, so this class ships green by construction; the mechanism against it is the same union check that found it.

- **D-2729** — the wave-3 plan cited the coordinator's acceptance block as `D-2681–D-2687` in fourteen places, including a ledger assertion `/D-2681[\s\S]*D-2687.../` and a repair instruction telling the wave-3 worker to "retain its current D-2681–D-2687 wording". The block is `D-2680–D-2687` (this plan's own narrative says so, and D-2680 is the open-before-close correction — the exact subject of the README lifecycle step wave 3 rewrites). Measured: the shipped ledger contains one `D-2680` and zero `D-2681`, so the assertion reds against a CORRECT ledger and its repair instruction would have deleted D-2680 from the record. A dropped first number is invisible to both ledger gates: `deviation-refs` compares numbers DEFINED across branches and wave 3 only cites these, while `dtbd` looks for `D-TBD-` tokens.

- **D-2730** — the crossing section points back at step 5 and asserted "nothing in it says so because until now there was nothing else". This same branch rewrote step 5 into explicit `**Same project:**` and `**Different project:**` arms, so the pointer was falsified by the commit that made it worth reading, and the paragraph it introduces carries the load-bearing `project-mismatch` rule. A cross-reference is a claim about another section and nothing checked it — the CROSSING table pins only the bolded lead sentence. Corrected to name the arm, and pinned by reading step 5's own arm markers, so rewriting either section without the other reds.

- **D-2731** — the hold route's `oversize` refusal answered 400 where every other `oversize` in the tree answers 413 (the kickoff seam and all four mail seams), so a client routing on `err.status` rather than on the slug — `AbandonSheet` does — read "your reason is too long" as "you sent the wrong shape", collapsing the exact distinction the route's own comment exists to keep. The PWA then narrowed it again: `apiErrorText` has no `oversize` entry and must not grow one (the kickoff translator already owns that slug with a different sentence), so the toast read `Couldn't hold — oversize` and discarded the `detail` saying the reason is written verbatim and refused rather than shortened — an adapter narrowing a distinction it received. Status aligned and pinned by a census over every `oversize` the server sends; the reader is surface-local, because the same slug means two things at two seams.

- **D-2733 — RECORD ONLY, not this wave's work and not fixed here.** `test-macos` had been carried as "unresolved" since the first handoff, on the assumption it was something this branch had to resolve. Measured 2026-09-13 against `origin/main` `ecd953b0` — the exact commit this branch is based on — that assumption is false: main's OWN `test-macos` run fails, `Test Files 1 failed | 302 passed (303)`, `Tests 10 failed | 8846 passed | 238 skipped`, the single failing file `test/ccd-account-auth.test.ts`, with `AssertionError: expected 'script: tcgetattr/ioctl: Operation not supported on socket' to contain '[token captured to …]'`. Every other leg is green on main. The subject is `script(1)` refusing a pty on the macOS runner, in pane-bound account-auth cases; this branch touches neither that test file nor `ccd/ccd`, measured. The manifestation is NONDETERMINISTIC, which is why it read as two different problems: on main `ecd953b0` it FAILED after 32 minutes, while on this branch's `e1b9ce9f` the same file went silent for 25 minutes and the job was CANCELLED at its 55-minute deadline having printed no summary at all. A cancelled leg measures nothing — it is neither a pass nor a failure, and this wave will not report it as either. Recorded rather than fixed because the defect is on main, predates this wave, and belongs to whoever owns `ccd`'s account-auth lane; `test-macos` does not gate merges on this repository. CORROBORATED by the account-pools coordinator, who had the one measurement this record lacked — a branch leg that COMPLETED rather than being cancelled. On `ws/clear-meadow` `e9dd490a`: failure after 35.8 minutes, `Test Files 1 failed | 302 passed (303)`, same file, same `tcgetattr` assertion — but NINE failing cases against main's TEN. Diffed here against main's log while it was still retrievable (it has since aged out of the Actions API, so this diff cannot be recomputed): their nine are a STRICT SUBSET of main's ten, with nothing in theirs absent from main's. The single extra case on main is `reaches waiting-code on a prompt that carries no newline, then expires`, and it is the only one of the ten from the `ccd-account-auth — login over a plain pipe` describe; the other nine are all from the `setup-token` and `openai-login` describes. That same `login over a plain pipe` block is where THIS branch's run went silent — its last output before the 25-minute stall was that block's `publishes the single clean URL, and the transcript carries no escape`. So the varying part of the failure, across three runs on three different trees, localises to one describe. A varying subset inside one file with the file count and pass count pinned is the signature of an environmental refusal racing whichever pane-bound cases lose, which is what `script(1)` refusing a pty looks like — and it is stronger evidence of nondeterminism than two identical sets would have been, since identical sets are also what a deterministic failure looks like. THE DURATIONS SPLIT THIS INTO TWO DEFECTS SHARING A FILE, which is the actionable shape and the reason "macOS is flaky" would have mis-triaged it. Measured from main's own log, per failing case: the nine `setup-token`/`openai-login` cases failed in 51, 51, 51, 51, 53, 54, 55, 57 and 72 ms — a twentieth of a second each, because `script: tcgetattr/ioctl` returns IMMEDIATELY when the runner has no pty, so the refusal is instant and the assertion misses. On the other programme's branch the same nine failed in 86–125 ms. That is not a race; it is deterministic and environmental, and it has been failing identically every run. Call it defect A. The tenth case, `reaches waiting-code on a prompt that carries no newline, then expires`, is the only one in the file whose own name says it WAITS for something to expire, and its duration is three orders of magnitude apart across the three runs: it FAILED on main after 60,046 ms — a sixty-second timeout, not an assertion miss — PASSED on `e9dd490a` in 6,245 ms, and on this branch's `e1b9ce9f` blocked past the job deadline with no verdict at all. Call it defect B, and it is the only one for which "flaky" is the right word. A is fixable without touching B and needs a runner or a shim; B needs a bounded wait and is what turns a 35-minute red into a 55-minute cancellation. Bundled under one heading, A would be triaged as a retry candidate forever and B would be hidden behind it — and a CANCELLED leg, which renders in the same column as a verdict while measuring nothing, is exactly how B hides. **B'S SIXTY SECONDS ARE ITS OWN BOUND, NOT THE HARNESS'S — and that changes the remedy rather than removing it.** The account-pools coordinator read 60,046 ms as 60,000 plus overhead and inferred it was vitest stopping a case that had no bound of its own. The first half is right and the inference is wrong, measured here: vitest's default `testTimeout` is 5,000 ms, and `server/vitest.config.ts` overrides it to 90,000 ms on darwin (20,000 on linux), so neither number is 60,000 and neither could have produced this stop. The 60,000 is in the test file: `runLogin` in `server/test/ccd-account-auth.test.ts` passes `timeout: 60_000` to `execFileSync`, and every case in the `login over a plain pipe` describe — defect B included — runs through it. So B has a bound, at the call site, on the child process. Two things are wrong with it and both are specific. FIRST, IT IS TEN TIMES WHAT THE CASE ACTUALLY WAITS FOR: the same `runLogin` sets `CCRC_AUTH_TIMEOUT: '6'`, the helper's own expiry, and 6,245 ms — the duration of this case's one PASS, on `e9dd490a` — is that six-second deadline firing normally plus overhead. A case whose healthy completion is 6.2 s is bounded at 60 s, so when the helper misses its own deadline the run burns a full minute and then reports a killed child rather than the thing that is actually broken, which is that the 6-second expiry never fired. SECOND, THE BOUND DID NOT HOLD ON THIS BRANCH'S RUN AT ALL — `e1b9ce9f` blocked past the 55-minute job deadline, which a working 60-second child timeout would have made impossible. The candidate mechanism offered here was that `execFileSync`'s timeout signals the direct child while the synchronous read runs to stdout EOF, so a surviving grandchild holding the inherited pipe keeps it open past the signal. **THAT HYPOTHESIS IS WITHDRAWN — REFUTED BY MEASUREMENT, and it was measurable after all.** It was recorded here as unmeasurable on the grounds that both macOS logs are gone; that reasoning was wrong, because the claim is a property of `execFileSync` and needs none of those bytes. The account-pools coordinator wrote a probe — a direct child that backgrounds a grandchild inheriting stdout and then sleeps 30 s, run under `timeout: 2000` — which records the grandchild's PID OUT OF BAND to a file and, at the instant `execFileSync` returns, checks elapsed ms against the bound, whether that grandchild is alive, and whether its fd 1 is still the stdio channel. On linux / node v24.14.1 the bound HELD at 2,004 ms with the grandchild alive and still holding the channel (`SIGTERM`/`ETIMEDOUT`, `gcFd1: socket:[…]`). Reproduced independently in this session, 3/3, at 2,004–2,006 ms with the same three properties each time. The out-of-band PID matters: their first attempt located the grandchild with `pgrep`, matched the wrong process, and reported a file descriptor belonging to the probe's own output — a probe that would have measured sound. **UNMEASURED ON DARWIN**, which is the platform that actually failed; neither session is extending the linux result there, and nobody should without running it. **AND THE MECHANISM IS IMPOSSIBLE BY CONSTRUCTION AT THE TWO ASYNC SITES, on any platform**, which is a stronger argument than the probe because it needs no run at all: it requires an inherited pipe, and both `spawn` sites in this file pass `stdio: 'ignore'` and `kill('SIGKILL')` in a `finally`. They hold no pipe. That leaves `runLogin` as the only site where it was ever possible — the site the probe refutes on linux. **WHAT REMAINS UNESTABLISHED IS THE ATTRIBUTION OF THE 55 MINUTES TO THIS FILE.** The `login over a plain pipe` describe holds six cases, each bounded at 60 s, so its worst case is six minutes; `vitest.config.ts` configures no retry. No arithmetic over this file's bounded sites reaches 55 minutes. **No third mechanism is proposed here, because none has been measured** — the honest statement is that the block was observed and its cause is unknown, not that a named cause explains it. One correction to the census that produced that arithmetic, made here rather than left standing: it is NOT true that every synchronous site in this file is bounded. Three carry no `timeout` at all — the `fn` helper, the `run` helper in the argv-contract describe, and an `execFileSync('grep', ['-rl', CANARY_TOKEN, h.home])` that walks the whole fixture HOME inside one of the nine defect-A cases. That is not a mechanism either, and it is not offered as one; it is the difference between "nothing here can block" and "the sites we counted cannot", and only the second is measured. **AND THOSE THREE ARE NOT MERELY MISSING A NICETY: `testTimeout` IS NOT A BACKSTOP FOR THEM, MEASURED.** Both sessions had assumed vitest's `testTimeout` bounded any test that ran long, which is what made both of our arithmetics about the 55 minutes wrong in the same way. It does not, because it is a TIMER, and a timer cannot fire while the thread is blocked inside a synchronous syscall. The account-pools coordinator measured the bare case — a timer scheduled for 500 ms fired at 3,007 ms, only after a `execFileSync('sleep 3')` carrying no `timeout` returned — and this session reproduced it (3,006 and 3,009 ms) and then measured the question that actually matters, which is what VITEST does rather than what a bare timer does. A one-case suite configured `testTimeout: 2000`, blocking 10 s inside `execFileSync` with no `timeout` option, reports: `× blocks the worker thread for 10s under a 2s testTimeout 10016ms` / `Error: Test timed out in 2000ms.` **The run cost the full ten seconds and the message names two.** So the timeout is a POST-HOC LABEL applied once the thread unblocks, not a bound — it cannot shorten the block, it misreports the duration it did not enforce, and against a block that never ends it never arrives at all, which is the only shape in this file consistent with a leg being CANCELLED BEFORE WRITING ANY SUMMARY, since a blocked worker cannot write one. **That is stated as CONSISTENCY, not causation, and it is still not a mechanism for the 55 minutes** — the 57 ms measured for the one unbounded site among the nine stands, nothing puts any of the three near the deadline, and no third mechanism is proposed here. What it changes is the WEIGHT of the census correction: the three unbounded sites are not bounded loosely, they are bounded by nothing the harness can enforce. The general fact outlives this wave — "`testTimeout` bounds our tests" is false repo-wide for synchronous spawns, and a crude screen (a sync-spawn site with no `timeout` within ±12 lines) over `origin/main`'s `server/test` returns roughly 303 sites across 337 files. **That figure is a SCREEN, not a census**, labelled so deliberately by the session that produced it after being caught by exactly that distinction one message earlier; the window is arbitrary and some sites will carry a bound further away, so it is an upper bound awaiting verification, not a finding. Remediating it is NOT wave-2 work, no number is minted for it here, and it belongs to whoever owns the suite. What survives measurement is the pair of facts above, and the remedy they point at is not "make the runner faster" and not "make B less flaky": bound that wait near the six seconds it is actually waiting on, with a message naming the expiry, and do not rely on a child-process timeout alone for a helper that spawns children of its own. A test whose reporting limit is 10x its own deadline cannot say what broke, and one whose limit can be outlived says nothing at all.

- **D-2732 — taken from account-pools wave 6 by its coordinator's explicit offer, and defined only here.** `deviation-refs.test.ts` and `topology-clean.test.ts` both resolved their comparison base from the chain `[$CCRC_*_BASE, 'origin/main', 'main']`, falling through to local `main` SILENTLY. On the fleet host local `main` is a FOSSIL: measured 356 commits behind `origin/main` (`ac72dd90` against `ecd953b0`), parked by a sibling worktree that never moves it. With roughly ten worktrees sharing one `.git`, a concurrent fetch from any of them rewrites `packed-refs`, so `git rev-parse --verify --quiet origin/main` can fail TRANSIENTLY — which is how the chain reaches its third candidate at all, and why the account-pools worker saw an unexplained red nobody could place. REPRODUCED INDEPENDENTLY in an isolated clone with `origin/main` deleted and local `main` at the fossil: the old chain takes the fossil and the only thing that stops it is `expect(plans.length).toBeGreaterThanOrEqual(50)` answering `only 49 plans read from main` — a hand-kept cardinal passing by arithmetic, one plan away from letting a 356-commit-stale comparison report GREEN. The same clone on the fixed tree refuses with the null-base refusal instead, which is the honest answer. Three changes: the `'main'` candidate is gone from both chains (an unresolvable `origin/main` now reaches the refusal that already says the right thing); the resolved base and its short SHA are carried into the assertion messages, which `deviation-refs` already computed and simply did not print; and the staleness property is asserted directly — `origin/main` must be an ancestor of the chosen base, so a base BEHIND it reds naming exactly how far behind, rather than being caught by a plan count. Note the property is not "reachable from HEAD": the fossil IS reachable, being old main, so an ancestor-of-HEAD check would have passed on it. Both files change together because `deviation-refs`'s own docstring says it copied `resolveBase` from `topology-clean`. TWO THINGS WORTH CARRYING PAST THIS INSTANCE. First, the predicate is direction-sensitive and the wrong direction is inert AND hostile: `is-ancestor <base> HEAD` — the shape this remedy was first specified as, in prose — ADMITS the fossil, because the fossil is old main and therefore an ancestor of HEAD, and it also REFUSES `origin/main` itself whenever HEAD is a long-lived coordinator ledger branch not descended from main, which is how the other programme's coordinator checkout is shaped. Shipped literally it would have red on every correct base and passed on the only incorrect one — a gate whose obvious repair is to delete it, leaving the fossil admitted. The implemented predicate deliberately does not mention `HEAD` at all, so no future simplification toward it is a simplification. Second, both refusal messages still read `origin/main or main resolved` after the candidate was removed, and are corrected here: a guard whose message names a candidate it no longer tries is the sibling of a guard whose message names a cause it cannot detect, and this wave has now found that class three times — the 409 phrasing regex, the closed-row proof named `after close` by a test that could not see ordering, and this. The message is part of the guard; it goes stale on its own.

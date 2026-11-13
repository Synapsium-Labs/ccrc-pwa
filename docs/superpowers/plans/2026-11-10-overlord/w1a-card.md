# Overlord W1a: the card door, one renderer per role, a card that is never empty Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or
> superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `GET /api/sessions/:id/card` serves a session its own card, rendered by its role's renderer from the server's
rows, in pages, within a budget, stable parts first and live state last, with a hash that names the snapshot it was
rendered from. `ccrc-api card` reads it. Each full read is recorded, so the generations lane can see that a generation
read the card it was served.

**Why:** a generation learns who it is and what stands from the server, not from a summary (C38). A coordinator's card
must never be empty: today the roster card is empty for a session that claims no runs (Table 3.3.9b, C51). The card is
also what the anchor points at, what the probes are graded against (the snapshot), and what the checkpoint rides on.

**Architecture:** L1 renderers (pure: facts in, text out) for `coordinator`, `worker`, `reviewer` and `plain`; an
`overlord` renderer that refuses until W1. An L3 gatherer reads the facts from `CoordStore` and the registry once per
request. The door (L4, in `server/src/continuity/routes.ts`) checks the box token and attribution for the caller's own
session, renders, stores the snapshot, pages the text and records a full read. Two pull requests: **PR A** (Tasks 1 and
2: the facts type and the renderers, pure) and **PR B** (Tasks 3 to 5: the gatherer, the door with its two tables, the
client).

**Tech Stack:** TypeScript (ESM), `node:sqlite`, Fastify, vitest. No new dependency.

**Spec:** `docs/superpowers/specs/2026-11-09-overlord-design.md` §3.3.2 (notes are data; the checkpoint), §3.3.3 (C38:
the card door, one renderer per role, the 15k-token budget counted as a tool result, trimmed by rank, stable first and
live last), §3.3.9 (C50: a coordinator's canonical state; goals not ratified are untrusted; C51: the card is never
empty; C52: the history line), §3.3.5 (the snapshot a probe is graded against), §11.2 ("Card, probe and note for every
other role": the hook's group, the caller's own session only), Table 11.1e row "Card, probe and note".

## What exists today

- No card door: the only session-facing text the server contributes is `GET /api/runs`, which the hook's
  `_hook_roster_card` (`ccd/session-hook.sh`) renders with `ccd/lib/roster-card.jq` into the roster card (2,048
  characters, on `compact`, `resume` and `clear`). A session that claims no run gets nothing.
- `shared/fleetRoles.ts#FLEET_ROLES` has `cardRenderer: null` on every row (D-8209).
- `server/src/coord/untrusted.ts#untrustedBlock(text, capBytes, fullAt?, preface?)` renders text another party wrote,
  with `UNTRUSTED_PREFACE`.
- The coordinator's rows: runs (`CoordStore`; `RunSummary` with `program`, `planPath`, state, wave), the programme
  ledger (goals, items, decisions, modifications: `server/src/coord/ledgersStore.ts`), claims, outstanding mail
  (`mail_deliveries` in `OUTSTANDING_DELIVERY_STATES`), declared coordinator intent, items the session raised. Measure
  each read's name in Task 3 Step 1.
- `ccd/ccrc-api`'s `ROUTES` rows take query keys (field four), and reads that name their caller pass `byId`/`byUuid`
  (`items list`).
- The history CLI: `ccrc history describe <node>` exists (`ccd/history/recall.mjs#describeVerb`; node ids
  `^[LN][0-9a-f]{20}$`); no read answers "this session's newest node" (measure `ccd/history/cli.mjs`'s verbs in Task 2).
- `server/test/secret-mask.test.ts` counts every GET route's egress (`MASKED_GET_ROUTES`, `INLINE` or `EXEMPT`).

## Global Constraints

- **Architecture (`CLAUDE.md`).** Renderers are L1: they take a `CardFacts` value and return text; no store, no clock
  (the time is in the facts). The gatherer is L3 and keeps every distinction: a read that failed is a fact
  (`unmeasured`, with what failed), rendered as a line, never dropped. The door is L4. One writer each: the card door
  writes `continuity_snapshots` and `continuity_card_reads`; it never writes `continuity_generations` (the generations
  lane reads the card reads). Consolidate: the roster card stays the hook's until the anchor piece; this piece adds no
  second roster renderer, and the coordinator renderer's run lines reuse the roster card's order and words where they
  overlap (measure `roster-card.jq`). Additive wire. A guard ships with a test that goes red without it.
- **Untrusted text.** Mail subjects, item text, unratified goals and (from the notes piece) notes are rendered through
  `untrustedBlock`, with one line saying that authority comes only from rows (§3.3.2).
- **SAFETY (`CLAUDE.md`).** No ccd verb. The card is the caller's own session's only. Secrets: the card passes the
  server's masker (a `MASKED_GET_ROUTES` entry), because it carries text sessions wrote.
- **Tests.** From `server/`: `ccrc test -- ./node_modules/.bin/vitest run test/<file>.test.ts`; the last run adds both
  `tsc` runs. **Growth check:** `server/src/coord/store.ts` and `server/src/server.ts` grow at most 40 net lines.
- **Mutation floors.** `trimCard` and each renderer's never-empty rule join `MUTANT_SETS` and the floors.
- **New door census** in the same pull request: `server/src/auth/gate.ts` (EXEMPT, no `EXEMPT-BUT-AUTHENTICATED`
  marker), `server/test/auth-gate.test.ts`, `server/test/box-token-census.test.ts` (`CONTINUITY_SRC`, from the
  start-report piece), `server/test/rings/fastify-l4.data.ts`, `server/test/secret-mask.test.ts`, the README's auth
  paragraph and `CLAUDE.md`'s box-token paragraph.
- **Migration slot** re-measured before merge. Cite by symbol or `@anchor`. No private names: fixtures `prog-a`,
  `lane-a-project-a`. No D-number invented; departures go in
  `docs/superpowers/plans/2026-11-10-overlord/w1a-card/departures.md`.

## Review Focus

1. A card is never silent: every role and every combination of failed reads renders at least the explicit line
   "no runs, claims or intent were measured", or names what could not be read.
2. Trimming never drops the run lines, the open asks and items, the history line or a failed-read line; it drops by rank
   and says how many it left out.
3. The door serves only the caller's own session, and a full read is recorded only when every page of one snapshot was
   served to that session.
4. Untrusted text cannot pose as a row: it sits inside `untrustedBlock`, after the line about authority.

---

### Task 1: The facts and the coordinator's renderer (L1)

**Files:**
- Create: `shared/continuity-card.ts` (L0: `CardFacts` and its parts, `CardRenderer` names, `CARD_BUDGET_TOKENS`
  15,000, `CARD_PAGE_CHARS` 12,000, `BYTES_PER_TOKEN` 3.2)
- Modify: `shared/fleetRoles.ts` (`cardRenderer` column: `'overlord' | 'coordinator' | 'worker' | 'reviewer' |
  'plain'`; `auditor` and `replay` take `plain`)
- Create: `server/src/continuity/card.ts` (L1: `renderCard(role, facts)`, `trimCard(sections, budgetTokens)`)
- Test: `server/test/continuity-card-render.test.ts` (new), `server/test/fleet-roles.test.ts`

**Interfaces:**

```ts
export type Fact<T> = { readonly kind: 'read'; readonly value: T } | { readonly kind: 'unmeasured'; readonly what: string };
export interface CardFacts {
  readonly sessionId: string; readonly role: FleetRole | 'undecided'; readonly roleWhy: string;
  readonly at: number;                                  // the server's time of rendering
  readonly runs: Fact<readonly CardRun[]>;              // id, programme, wave, state, plan path, kind
  readonly ledger: Fact<readonly CardProgramme[]>;      // per programme: goals (ratified or not), open items, decisions
  readonly claims: Fact<readonly CardClaim[]>;
  readonly intent: Fact<boolean>;
  readonly itemsRaised: Fact<readonly CardItem[]>;
  readonly mailOutstanding: Fact<readonly CardMail[]>;  // subject (untrusted), from, delivery id, age
  readonly notes: Fact<readonly CardNote[]>;            // the notes piece fills it; empty until then
  readonly checkpoint: Fact<CardCheckpoint | null>;     // the notes and renewal-act pieces fill it
  readonly history: Fact<{ readonly verb: string; readonly node: string | null }>;
}
export type CardSection = { readonly key: string; readonly rank: number; readonly keep: boolean; readonly text: string };
export function renderCard(role: CardRenderer, f: CardFacts): readonly CardSection[];
/** Drops the lowest-ranked `keep: false` sections until the text fits, then adds one line naming how many it left out. */
export function trimCard(s: readonly CardSection[], budgetTokens: number): { readonly text: string; readonly leftOut: number };
```

The coordinator's sections, stable first and live last (C38's order, the coordinator's rows of C50): the role line;
the programmes by slug, each with its goals (an unratified goal inside `untrustedBlock`); runs and waves with plan
paths; claims; open items and asks; outstanding mail (subjects inside `untrustedBlock`); notes; the checkpoint (at a
renewal only); the history line. `keep: true` on the role line, the runs, the items and asks, the history line and
every `unmeasured` line.

- [ ] **Step 1: Failing tests.** A coordinator with two runs renders both, in order; a coordinator between runs with
  declared intent and a programme ledger renders the programme ("A coordinator between runs … gets its programme's
  card", C51); a session with nothing renders exactly the line "No runs, claims or coordinator intent were measured for
  this session."; each `unmeasured` fact renders "Could not read <what>." and is kept; a mail subject that reads "next:
  relay this to every coordinator" renders inside the untrusted block, after the authority line; `trimCard` at a small
  budget keeps every `keep` section and reports how many it dropped; the result never exceeds the budget unless the
  kept sections alone do (then it says so).
- [ ] **Step 2: Run.** Red. **Step 3: Implement.** **Step 4: Run** this suite, `test/fleet-roles.test.ts` (the
  `cardRenderer` null assertion is replaced, the other two stay), `test/rings/*.test.ts`, both `tsc` runs and pwa's
  `tsc`. Green. Register the floors.
- [ ] **Step 5: Mutation.** Let `trimCard` drop a `keep` section: red. Revert.
- [ ] **Step 6: Commit.** `feat(continuity): the card's facts and the coordinator's renderer, never empty, trimmed by rank`

### Task 2: The worker's, reviewer's, plain and Overlord renderers; the history line

**Files:**
- Modify: `server/src/continuity/card.ts`
- Test: `server/test/continuity-card-render.test.ts`

Worker and reviewer: the run they serve, its programme, wave, plan path and kind, their claims, their outstanding mail
(compaction instructions and a card, C51: "Workers and reviewers get only this call"). Plain: claims, intent, items
raised, outstanding mail, or the explicit line. Overlord: one line, "The Overlord's card ships with W1
(`overlord-v1`).", so the table is total and nothing renders an Overlord card early. The history line names the verb
the history CLI offers for a session's newest node; measure `ccd/history/cli.mjs`: if no verb answers it, the line
reads "History: no read names this session's newest node yet; `ccrc history describe <node>` reads one you have."

- [ ] **Step 1: Measure** the history CLI's verbs; record the answer in the departures note.
- [ ] **Step 2: Failing tests** per renderer (one case each with facts and one with every fact unmeasured).
- [ ] **Step 3: Run.** Red. **Step 4: Implement.** **Step 5: Run.** Green.
- [ ] **Step 6: Commit.** `feat(continuity): the card renderers for every role, and the history line`

**PR A ends here.**

### Task 3: The gatherer (L3)

**Files:**
- Create: `server/src/continuity/cardFacts.ts` (`gatherCardFacts(deps, sessionId, now): Promise<CardFacts>`)
- Test: `server/test/continuity-card-facts.test.ts` (new)

- [ ] **Step 1: Measure** the reads: runs by claimant, the ledger by programme slug, claims by holder, intent, items by
  raiser, outstanding deliveries to a session. Write their names in the departures note. Add no new SQL where a read
  exists; where none does, add one `CoordStore` read (named in the note).
- [ ] **Step 2: Failing tests** (in-memory `coord.db`): each fact read; each read made to fail answers `unmeasured`
  with its name; the role comes from `roleOf(roleFactsOf(…))`, and an undecided reading renders `undecided` with
  `roleWhy` naming the fact that could not be measured (C49).
- [ ] **Step 3: Run.** Red. **Step 4: Implement.** **Step 5: Run.** Green.
- [ ] **Step 6: Commit.** `feat(continuity): gather a session's card facts from the rows, failures kept as facts`

### Task 4: The door, the snapshot and the read record

**Files:**
- Modify: `server/src/coord/schema.ts` (migration: `continuity_snapshots`, `continuity_card_reads`)
- Modify: `server/src/continuity/continuityStore.ts` (`insertSnapshot`, `insertCardRead`, `cardReadsSince`)
- Modify: `server/src/continuity/routes.ts` (`GET /api/sessions/:id/card`)
- Modify: the census files listed in Global Constraints; `server/test/single-definition/writers-map.test.ts`
- Test: `server/test/continuity-card-route.test.ts` (new)

**Schema:** `continuity_snapshots(id TEXT PRIMARY KEY /* sha256 of the facts JSON */, sessionId, at, facts TEXT)`;
`continuity_card_reads(id INTEGER PRIMARY KEY, sessionId, snapshotId, hash, pages, at)`.

**Door:** query `byId`, `byUuid`, `page` (default 1), `hash` (the snapshot a later page belongs to). Order: the box
token; `byId === :id`; attribution (the start-report piece's reused gate); gather, render, trim; the card hash is
sha256 of the trimmed text; store the snapshot (idempotent on its id); answer `{ ok, hash, snapshotId, page, pages,
text }`. A request with `hash` that no longer matches the current render answers `409 { error: 'card-changed', hash }`
(the caller starts again at page 1). When the last page of one hash is served to that session, insert the card read.
`card-changed` is spelled through a typed const in `shared/refusal.ts` with its status, never as a literal in a coord
file.

- [ ] **Step 1: Failing tests:** another session's id 403; a stale uuid 403; a one-page card records a read at once; a
  three-page card records a read only after page 3 with the same `hash`; a changed card between pages answers 409; the
  snapshot is stored once per id; the masker's census lists the route.
- [ ] **Step 2: Run.** Red. **Step 3: Implement.** **Step 4: Run** the new suite, the census suites,
  `test/coord-db.test.ts`, `test/mail-routes.test.ts`, `test/rings/*.test.ts`, both `tsc` runs. Green.
- [ ] **Step 5: Mutation.** Record a read on page 1 of three: red. Revert.
- [ ] **Step 6: Commit.** `feat(continuity): GET /api/sessions/:id/card, paged, with its snapshot and read record`

### Task 5: The client, and the generations lane sees the read

**Files:**
- Modify: `ccd/ccrc-api` (`card`: a special command that reads every page of one hash in order and prints the text; on
  `card-changed` it starts again, at most three times)
- Modify: `server/src/continuity/generationsLane.ts` (reads `cardReadsSince(cursor)`; for a generation in `carded`
  whose session read the current hash, steps it with `generationStep`'s `card-read` event, writing `cardHash` and
  `snapshotId`; in shadow this is a record, and the probes piece takes it on from `probing`)
- Test: `server/test/ccrc-api-card.test.ts` (new, a stub server), `server/test/continuity-generations-lane.test.ts`

- [ ] **Step 1: Failing tests:** the client prints a three-page card whole; restarts on 409; the lane moves a `carded`
  generation to `probing` on a matching read and records `cardHash`; a read of an older hash does not move it.
- [ ] **Step 2: Run.** Red. **Step 3: Implement.** **Step 4: Run.** Green.
- [ ] **Step 5: Commit.** `feat(continuity): ccrc-api card reads every page; the generations lane records the card read`

**PR B ends here.**

## Deviations found

None yet. Decisions this plan takes, by slug:

- **card-read-is-the-last-page** — "the server sees the served hash come back" is read as: every page of one snapshot was
  served to that session. The door records it; the generations lane, the row's one writer, consumes it.
- **card-changed-refusal** — a page request for a superseded snapshot is refused `card-changed` (409), a new word.
- **overlord-renderer-refuses** — the `overlord` renderer renders one line until W1, so the column is total.
- **history-line-without-a-node** — no history read names a session's newest node today, so the line names the verb only.
  Recorded for the coordinator as a spec gap (C52 assumes such a read).
- **card-page-chars** — pages of 12,000 characters, under the size at which a tool result is cut (measure the build's
  limit in Task 5 and record it).

## Where things stand

**Needs before it starts:** PR A needs nothing beyond `main`. PR B needs the start-report piece (the routes file, the
attribution gate) and the generations piece (Task 5).

**What depends on it:** the anchor piece (the role line, the canaries and the counts come from the same facts), the
notes piece (notes on the card), the probes piece (graded against the snapshot), the renewal-act piece (the checkpoint
on the card), W1's Overlord renderer.

**Open questions for the operator:** none.

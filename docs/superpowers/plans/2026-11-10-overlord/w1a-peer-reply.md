# Overlord W1a: an invited reply is never refused by the peer bound (#2726) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or
> superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** peer mail (mail with no `runId`) keeps its bounds, but a reply to a mail the recipient sent is not counted
against the pair's bound, a refusal says when the mail could go, and, once the operator arms it, mail over the pair's
bound is held and sent when a slot frees instead of being refused.

**Why:** W0b measured the failure on a real session (W0-20, the results note's Proposal 11). A busy reader blocked the
replies it had asked for: one reply was refused `429 peer-quota` twice, another was held unsent by its writer, and by
the next day both were out of date, so neither was delivered. W1 is where coordinators and the Overlord first talk by
mail, so this lands before W1. It is a change to today's mail lane, not an Overlord machine part (issue #2726).

**Architecture:** the bound's three arms move out of the route into one pure L1 decider, `peerMailVerdict`, behind a
characterization test. Two pull requests:
- **PR A** (Tasks 1 to 4): the decider; the refusal's `retry` field; the reply column and its exemption. No change of
  behaviour for a mail that names no reply.
- **PR B** (Tasks 5 to 7): the held-mail table, its admission pass, and its arming row on the Shadow lanes card. Shadow
  by default: it records what it would have held and refuses as today.

**Tech Stack:** TypeScript (ESM), `node:sqlite` (`DatabaseSync`), Fastify, vitest. No new dependency.

**Spec and sources:** issue #2726; `docs/superpowers/plans/2026-11-11-overlord-w0-spike-results.md` (W0-20, Proposal
11); `docs/superpowers/programs/overlord.md` (W0b's answers); the Overlord spec
`docs/superpowers/specs/2026-11-09-overlord-design.md` §6.4 (the Overlord's own mail runs inside its run, so these
bounds do not bind it); `CLAUDE.md`, "Mail delivery is idle-gated, reference-based, never awaited".

## What exists today

Every symbol below is real at the branch point (`cc6bcad17`). Re-read each before its task.

- **The bound is inline in the route.** Check 9 of `app.post('/api/mail', …)` in `server/src/coord/routes.ts` runs
  for `runId === null` only, last, after role resolution, so the pair is keyed on the resolved recipient. In order:
  `coord.hasOutstandingPeerDuplicate(fromId, resolvedToId, subject)` refuses `duplicate` (409);
  `coord.outstandingPeerCount(fromId, resolvedToId) >= PEER_MAIL_MAX_OUTSTANDING` refuses `peer-quota` (429);
  `coord.peerMailInLastHour(fromId, Date.now()) >= PEER_MAIL_HOURLY` refuses `peer-quota` (429).
- **The constants** `PEER_MAIL_MAX_OUTSTANDING = 3` and `PEER_MAIL_HOURLY = 12` are L0, in `shared/api.ts`.
  `server/test/peers-claims-l0.test.ts` pins the hourly value and that `peer-quota` is in `MAIL_REJECT_CODES`.
- **What counts.** `CoordStore.outstandingPeerCount` joins `mail` to `mail_deliveries` for `runId IS NULL`, the pair,
  and `d.state IN OUTSTANDING_STATES_SQL` (`queued`, `delivered`); an ack or a park frees the slot.
  `CoordStore.peerMailInLastHour` counts `mail` rows in the last hour whatever their state, so an ack does not refund it.
- **The refusal.** The route's local `refuse(reply, code, ctx, detail)` records a `mail_rejections` row and sends
  `{ ok: false, error, detail }` at `REFUSAL_STATUS[code]` (`shared/refusal.ts`). No refusal carries a retry hint. A
  refused mail writes no `mail` or `mail_deliveries` row.
- **No reply link.** `mail` has `id, at, fromId, fromUuid, toId, runId, kind, subject, body, artifacts`; nothing links a
  mail to the mail it answers. Unknown body keys on `POST /api/mail` are ignored.
- **What a session sees.** `ccrc-api mail inbox` prints the stored envelope, whose `id:` and `ack:` lines carry the
  DELIVERY id (`server/src/coord/envelope.ts`). A session never sees a mail row's own id, so a reply must name the
  delivery it received.
- **Delivery.** The route inserts the mail, queues the delivery (`CoordStore.queueDelivery`, an INSERT), renders the
  envelope against the delivery id and stamps it, in one transaction. Every later UPDATE of `mail_deliveries` goes
  through the private `writeDeliveries` (D-5997), pinned by `server/test/mail-deliveries-writer.test.ts` and
  `server/test/mail-hardening.test.ts`. `watch.ts`'s `sweepMail` delivers due rows behind the idle gate and `MAIL_PACE`.
- **Tests that pin today.** `server/test/mail-peer-quota.test.ts` (seven cases: the fourth outstanding mail of a pair is
  429 and an ack frees it; the thirteenth in an hour is 429 and the window slides; `duplicate`; run mail untouched),
  `server/test/claims-envelope.test.ts` (a claims-conflict mail over the cap is 429), `server/test/mail-routes.test.ts`
  (every `MAIL_REJECT_CODES` word reachable; the quoted-kebab scan of `server/src/coord`).
- **The Shadow lanes card** (D-8274): `shared/lane-arm.ts#LANE_ARM_LANES`, one row per switch in `lane_arm_settings`,
  seeded `shadow` by a migration, written only by `POST /api/coord/lane-arm`; a lane is live only when its stored choice
  is exactly `live`.
- **Migrations.** `server/src/coord/schema.ts#MIGRATIONS` has 63 entries at the branch point; the next is 64.

## Weighing the three changes against the mail invariants

| Change | Idle-gated | Reference-based | Delivery ids | `writeDeliveries` | Verdict |
|---|---|---|---|---|---|
| A reply naming the delivery it answers is not counted against the pair's bound | unchanged: the reply is queued and gated like any mail | unchanged | the reply names a delivery id, which is what the session holds | unchanged: the route still INSERTs | Safe. One exempt reply per cited delivery, so a citation cannot be reused to flood a pair. The hourly bound still counts it |
| Mail over the pair's bound is held, then queued when a slot frees | unchanged: admission only queues; the gate still delivers | unchanged: the body is in the mail row from the start | a held mail has no delivery id until admitted; the envelope is rendered at admission, keyed on that id, as the route does | unchanged: admission INSERTs through `queueDelivery` | Safe within bounds, with two costs stated below. The hourly bound and `duplicate` still refuse |
| A refusal says when the mail could go | n/a | n/a | n/a | n/a | Safe, additive: a `retry` field beside `detail` |

**The costs of holding, and why it ships in shadow.** A held mail may be read late, which is W0-20's own failure in a
slower form; so the envelope of an admitted mail says how long it was held. And a server rolled back to a build before
PR B ignores the held table, so a mail held at the rollback stays unsent with no refusal. PR B therefore arms by the
operator's Shadow lanes row, `peer-mail-hold`, and records what it would have held while it is `shadow`. Holding the
hourly bound is not planned: that bound is the guard against a runaway sender, and holding it would store an unbounded
backlog.

## Global Constraints

- **Architecture (`CLAUDE.md`).** Rings by imports: L0 `shared/*.ts` imports nothing; L1 decides with no I/O; L3
  adapters never narrow a distinction they received; L4 acts and does not decide. One writer per fact: each new column
  and table has one writing method on `CoordStore` (or a store module beside it), named in
  `server/test/single-definition/writers-map.test.ts`. Consolidate: the bound stays one decider; the admission pass is
  a step of the existing mail sweep's file, not a second mail lane. Characterization first: Task 1 moves code and
  changes only what the decider's call needs. A guard ships with a test that goes red when it is deleted, measured once
  before commit. Additive wire: no `FLEET_PROTO` bump; the new body field and response fields have one reader each and
  their absence keeps today's behaviour.
- **SAFETY (`CLAUDE.md`).** No new ccd verb; this piece touches no ccd, tmux, registry or unit. Fixture HOMEs only.
  Never print a secret file's contents.
- **Tests.** Written and seen red first. From `server/`, one file at a time:
  `ccrc test -- ./node_modules/.bin/vitest run test/<file>.test.ts`. Each task's last run adds
  `ccrc test -- ./node_modules/.bin/tsc --noEmit` and `ccrc test -- ./node_modules/.bin/tsc -p test/tsconfig.tests.json --noEmit`.
- **Mutation floors.** `peerMailVerdict` is a new L1 decider: it joins `MUTANT_SETS` and
  `server/test/sim/mutation-floors.json` in Task 1 (spec Table 11.7b).
- **Migration slots** are measured again before each merge:
  `git show origin/main:server/src/coord/schema.ts | grep -c '^  // ── [0-9]*: user_version'`. Tests find a slot with
  `MIGRATIONS.findIndex(...)`, never a literal.
- **No new refusal word.** A reply that names no qualifying delivery is counted as ordinary peer mail, and the 202 says
  so; it is not refused. So `MAIL_REJECT_CODES`, `REFUSAL_STATUS` and the coordinator skill's code list do not change.
- Cite code by symbol or `@anchor`, never by line. Public repository: fixtures use `lane-a-project-a`,
  `lane-b-project-a`, `project-a`; no private names.
- No D-number is invented. Decisions below carry slugs; the coordinator issues numbers. The worker writes departures in
  a new note, `docs/superpowers/plans/2026-11-10-overlord/w1a-peer-reply/departures.md`, never in this file or the
  programme ledger.

## Review Focus

1. A reply cannot become a way round the bound: one exempt reply per cited delivery, the cited delivery must be to this
   sender from this recipient, the hourly bound still counts it (Task 3, "a second reply citing the same delivery is
   counted").
2. Run mail is byte-identical: no path of this piece runs for `runId !== null` (the dark pin stays green unedited).
3. Holding never bypasses the idle gate or `writeDeliveries`, and never queues two deliveries for one mail (Task 6,
   "admission is a compare-and-set").
4. Shadow is structural: with the row at `shadow`, a mail over the pair's bound is refused exactly as today (Task 7).
5. A rollback over PR B: an older build boots by rule 3 and ignores the table; what that strands is stated in the PR.

---

### Task 1: The bound becomes one pure decider (characterization first)

**Files:**
- Create: `server/src/coord/peerMail.ts` (L1: `PeerMailFacts`, `PeerMailVerdict`, `peerMailVerdict`)
- Modify: `server/src/coord/routes.ts` (check 9 gathers facts, calls the decider, maps the verdict to today's refusals)
- Create: `server/test/peer-mail-decider.test.ts`
- Modify: `server/test/sim/mutate.ts` registry (`MUTANT_SETS`) and `server/test/sim/mutation-floors.json`

**Interfaces (produces):**

```ts
export interface PeerMailFacts {
  readonly duplicate: boolean;        // hasOutstandingPeerDuplicate
  readonly outstanding: number;       // outstandingPeerCount for the pair
  readonly sentLastHour: number;      // peerMailInLastHour for the sender
}
export type PeerMailVerdict =
  | { readonly kind: 'send' }
  | { readonly kind: 'refuse'; readonly code: 'duplicate' | 'peer-quota'; readonly bound: 'duplicate' | 'pair' | 'hourly' };
export function peerMailVerdict(f: PeerMailFacts): PeerMailVerdict;
```

- [ ] **Step 1: Characterize.** Run `test/mail-peer-quota.test.ts`, `test/claims-envelope.test.ts` and
  `test/mail-routes.test.ts` on the branch point. Expected: green. They stay green, unedited, through Step 5.
- [ ] **Step 2: Write the failing decider test.** Exhaustive over `duplicate ∈ {false,true}`, `outstanding ∈ 0..4`,
  `sentLastHour ∈ 0..13`: `duplicate` wins over everything; then the pair (`outstanding >= PEER_MAIL_MAX_OUTSTANDING`);
  then the hour; else `send`. Add the monotonicity property: raising `outstanding` or `sentLastHour`, or setting
  `duplicate`, never turns a refusal into `send`.
- [ ] **Step 3: Run it.** Expected: red (no module).
- [ ] **Step 4: Move.** Write `peerMailVerdict` (imports only `shared/api.ts`'s two constants). In check 9 the route
  reads the three facts, asks the decider, and for a refusal calls `refuse` with today's exact detail strings, chosen by
  `bound`. Nothing else in the route changes.
- [ ] **Step 5: Run** the four suites and both `tsc` runs. Expected: green.
- [ ] **Step 6: Register the floor.** Add `server/src/coord/peerMail.ts#peerMailVerdict` to `MUTANT_SETS` with its
  mutants (swap the order of the pair and the hour; `>=` to `>`; drop the duplicate arm) and its floor, measured, to
  `mutation-floors.json`. Run `test/sim/mutation-floors.test.ts`. Expected: green, every mutant killed.
- [ ] **Step 7: Mutation (measured once).** Change `>=` to `>` in the pair arm: the exhaustive test goes red. Revert.
- [ ] **Step 8: Commit.** `refactor(mail): the peer bound's three arms become one pure decider, peerMailVerdict`

### Task 2: A refusal says when the mail could go

**Files:**
- Modify: `server/src/coord/peerMail.ts` (`retryFor`)
- Modify: `server/src/coord/routes.ts` (the two `peer-quota` refusals send `retry`; `refuse` takes an optional extra)
- Modify: `server/src/coord/store.ts` (`CoordStore.oldestPeerMailInLastHour(fromId, now): number | null`, a read)
- Modify: `shared/api.ts` (the wire type `PeerQuotaRetry`, beside `PEER_MAIL_HOURLY`)
- Test: `server/test/mail-peer-quota.test.ts`, `server/test/peer-mail-decider.test.ts`

**Interfaces:**

```ts
// shared/api.ts (L0, additive)
export type PeerQuotaRetry =
  | { readonly when: 'recipient-acks'; readonly outstanding: number }   // the pair's bound
  | { readonly when: 'at'; readonly at: number };                       // the hourly bound: oldest in the hour + 1 h
```

- [ ] **Step 1: Failing tests.** In `mail-peer-quota.test.ts`: the fourth outstanding mail answers 429 with
  `retry: { when: 'recipient-acks', outstanding: 3 }` and a `detail` that ends "it can go when lane-b-project-a acks
  one of them"; the thirteenth in an hour answers `retry: { when: 'at', at: <first mail's at + 3_600_000> }`. In the
  decider test: `retryFor` for each bound.
- [ ] **Step 2: Run.** Expected: red.
- [ ] **Step 3: Implement.** `refuse` gains an optional last parameter `extra?: Readonly<Record<string, unknown>>`
  spread after `detail` into the body only (never into `mail_rejections`). The store read is
  `SELECT MIN(at) FROM mail WHERE runId IS NULL AND fromId = ? AND at > ?`, proven by the store's `persistedInt`.
  An unreadable answer sends no `retry` (absent, never a guessed time) and keeps the detail.
- [ ] **Step 4: Run** the suites above plus `test/mail-routes.test.ts`. Expected: green.
- [ ] **Step 5: Mutation.** Drop `extra` from the body spread: the `retry` assertions go red. Revert.
- [ ] **Step 6: Commit.** `feat(mail): a peer-quota refusal says when the mail could go (retry: recipient-acks | at)`

### Task 3: A reply names the delivery it answers, and is not counted against the pair

**Files:**
- Modify: `server/src/coord/schema.ts` (migration: `ALTER TABLE mail ADD COLUMN replyToDelivery INTEGER`; no
  `REFERENCES`, so an older build's inserts and every hand-written test INSERT stay valid)
- Modify: `server/src/coord/store.ts` (`insertMail` takes `replyToDelivery: number | null`; the read
  `CoordStore.replyCitation(deliveryId, fromId, toId): ReplyCitation`)
- Modify: `server/src/coord/peerMail.ts` (`PeerMailFacts.reply`, the exemption)
- Modify: `server/src/coord/routes.ts` (parse `replyTo`, read the citation, answer `reply` in the 202)
- Modify: `shared/api.ts` (`ReplyCitation`, `MailSendReply`, beside `MailKind`)
- Test: `server/test/peer-mail-reply.test.ts` (new), `server/test/peer-mail-decider.test.ts`, `server/test/coord-db.test.ts`

**Interfaces:**

```ts
// shared/api.ts (L0)
export type ReplyCitation =
  | { readonly kind: 'exempt' }            // a delivery to this sender, of a runId-less mail from this recipient,
                                           // that no earlier mail from this sender cites
  | { readonly kind: 'counted'; readonly why: 'no-such-delivery' | 'not-to-you' | 'not-from-them' | 'run-mail'
                                             | 'already-answered' | 'not-an-answer' | 'unreadable' };
// POST /api/mail body gains `replyTo?: number` (a delivery id). The 202 gains `reply?: ReplyCitation`, present
// only when the body named `replyTo`.
```

- The decider gains `reply: ReplyCitation | null`; for `exempt` the pair arm is skipped, the duplicate and hourly arms
  still apply. `kind` must be `answer` for `exempt` (`not-an-answer` otherwise), as the issue says.
- The column is stored only for `exempt`, so "one exempt reply per cited delivery" is
  `SELECT 1 FROM mail WHERE fromId = ? AND replyToDelivery = ?`.

- [ ] **Step 1: Failing tests** (`peer-mail-reply.test.ts`, fixture HOME, two attested sessions): lane-a sends three
  mails to lane-b (the pair is full); lane-b sends three to lane-a; lane-a replies `kind: 'answer'` with `replyTo` =
  the delivery id of lane-b's first mail to it: 202, `reply: { kind: 'exempt' }`, a delivery queued. Then: a second
  reply citing the same delivery is `counted` with `already-answered` and refused 429 by the full pair; a reply citing
  a delivery addressed to another session is `not-to-you`; a delivery of a run mail is `run-mail`; `kind: 'finding'`
  is `not-an-answer`; an unknown id is `no-such-delivery`; with no `replyTo`, the 202 has no `reply` key. The
  thirteenth mail in an hour is still 429 even when it is an exempt reply.
- [ ] **Step 2: Migration test** in `coord-db.test.ts`: the new slot (found by `findIndex` on the column name) adds a
  nullable column, and a row inserted without it reads `null`.
- [ ] **Step 3: Run.** Expected: red.
- [ ] **Step 4: Implement** the migration (with the "RE-MEASURE the slot" comment its neighbours carry), the read (one
  SELECT joining `mail_deliveries` to `mail`; a store failure answers `unreadable`, never `exempt`), the parse
  (`replyTo` must be a positive safe integer, else the field is ignored and `reply` answers `no-such-delivery`), and the
  decider's arm. Add the decider's new arm to its exhaustive test and its mutants.
- [ ] **Step 5: Run** this task's suites, `test/mail-peer-quota.test.ts`, `test/mail-routes.test.ts`,
  `test/single-definition/writers-map.test.ts`, `test/sim/mutation-floors.test.ts`. Expected: green.
- [ ] **Step 6: Mutations.** (a) Drop the "already answered" check: the second-citation case goes red. (b) Skip the
  hourly arm for `exempt`: the thirteenth-mail case goes red. Revert each.
- [ ] **Step 7: Commit.** `feat(mail): a reply naming the delivery it answers is not counted against the pair's bound (#2726)`

### Task 4: The client and the README say how to reply

**Files:**
- Modify: `ccd/ccrc-api` (the `mail send` usage line names `replyTo`; the body is passed through as today)
- Modify: `README.md` (the peer-mail paragraph: the bound, the exemption, `retry`)
- Test: `server/test/ccrc-api-usage.test.ts` if it pins usage text (measure first; else none), `server/test/docs-parity.test.ts`

- [ ] **Step 1:** Measure which suites pin the usage line and the README paragraph
  (`grep -rln 'peer-quota' server/test`). Update the pinned text with the change; run those suites. Expected: green.
- [ ] **Step 2: Commit.** `docs(mail): ccrc-api and the README say how a reply cites its delivery`

**PR A ends here.** Push once (worker clause 20) and open it.

### Task 5: The held-mail table and its store

**Files:**
- Modify: `server/src/coord/schema.ts` (migration: `peer_mail_held` and the lane-arm seed row `peer-mail-hold`,
  `shadow`, in the same entry)
- Create: `server/src/coord/peerMailStore.ts` (L3 functions over the store's `DatabaseSync`; `CoordStore` keeps
  one-line delegates, under the growth check)
- Modify: `server/src/coord/store.ts` (delegates; `hasOutstandingPeerDuplicate` also sees held rows)
- Modify: `shared/lane-arm.ts` (`PEER_MAIL_HOLD_LANE` in `LANE_ARM_LANES`, its card words)
- Modify: `server/test/single-definition/writers-map.test.ts` (`TABLES` gains `peer_mail_held`)
- Test: `server/test/peer-mail-held-store.test.ts` (new), `server/test/coord-db.test.ts`, `server/test/lane-arm*.test.ts`

**Schema:**

```sql
CREATE TABLE peer_mail_held (
  mailId     INTEGER PRIMARY KEY REFERENCES mail(id),
  fromId     TEXT NOT NULL,
  toId       TEXT NOT NULL,        -- the resolved recipient, as mail_deliveries.toId
  heldAt     INTEGER NOT NULL,
  admittedAt INTEGER,              -- null while held
  deliveryId INTEGER               -- set once, at admission
);
CREATE INDEX peer_mail_held_open ON peer_mail_held(fromId, toId, heldAt) WHERE admittedAt IS NULL;
```

**Interfaces:** `holdPeerMail(input): { ok: true; mailId: number } | { ok: false; kind: 'held-full' | 'write-failed' }`
(inserts the `mail` row and the held row in one transaction, refuses past `PEER_MAIL_MAX_HELD` open rows for the pair);
`openHeldPairs(): HeldPair[]`; `admitHeld(mailId, deliveryId, now): { changed: boolean }` (compare-and-set on
`admittedAt IS NULL`). `PEER_MAIL_MAX_HELD = 12` is L0, beside the other two bounds.

- [ ] **Step 1: Failing tests.** Hold writes both rows in one transaction (a forced failure of the second leaves
  neither); the thirteenth open hold for a pair answers `held-full`; `admitHeld` twice answers `changed: true` then
  `false`; a held mail with the same subject is a `duplicate`; the migration creates the table and seeds the row
  `shadow`.
- [ ] **Step 2: Run.** Expected: red.
- [ ] **Step 3: Implement** following `practiceCasesStore.ts`'s shape (explicit column lists, `persistedInt`).
- [ ] **Step 4: Run** this task's suites, `test/mail-hardening.test.ts`, `test/mail-deliveries-writer.test.ts`
  (unchanged: no new UPDATE of `mail_deliveries`). Expected: green.
- [ ] **Step 5: Mutation.** Drop the `admittedAt IS NULL` guard: the second `admitHeld` answers `true`; red. Revert.
- [ ] **Step 6: Commit.** `feat(mail): peer_mail_held, its one writer, and the peer-mail-hold row (shadow)`

### Task 6: The route holds, and the sweep admits

**Files:**
- Modify: `server/src/coord/peerMail.ts` (verdict `hold`; `admitDue(pair): boolean`, pure)
- Modify: `server/src/coord/routes.ts` (a `pair` refusal becomes `hold` when the row is `live`; 202
  `{ ok: true, id, held: true }`)
- Modify: `server/src/watch.ts` (`sweepMail` runs the admission step before it reads due rows)
- Modify: `server/src/coord/envelope.ts` (an admitted mail's envelope carries `held: <minutes>m`)
- Test: `server/test/peer-mail-held.test.ts` (new), `server/test/peer-mail-decider.test.ts`

**Admission (one transaction per admitted mail):** for each open pair, while
`outstandingPeerCount(fromId, toId) < PEER_MAIL_MAX_OUTSTANDING`, take the oldest held row, `queueDelivery` for it,
render and stamp its envelope against the new delivery id (the route's exact sequence), and `admitHeld`. If `admitHeld`
answers `changed: false`, the transaction rolls back, so one mail never gets two deliveries.

- [ ] **Step 1: Failing tests,** with the row set `live`: a fourth mail to a full pair answers 202 `held: true` and no
  delivery; acking one delivery and running one mail sweep admits it (a delivery queued, its envelope carries the
  delivery id on its `ack:` line and a `held:` line); two sweeps admit it once; admission keeps heldAt order; with the
  hourly bound reached the mail is still refused 429; with the row `shadow`, a fourth mail is refused 429 exactly as
  today and nothing is written to `peer_mail_held`.
- [ ] **Step 2: Run.** Expected: red.
- [ ] **Step 3: Implement.** The route reads the row through the lane-arm store's one read. The sweep's step lives in
  `watch.ts` beside `sweepMail`'s other steps (one function, `admitHeldPeerMail`), takes `now` from the sweep, and logs
  a failed admission with `console.warn('ccrc-server: …')`.
- [ ] **Step 4: Run** the suites above, `test/mail-peer-quota.test.ts`, `test/mail-routes.test.ts`,
  `test/watch-mail*.test.ts` (measure which exist). Expected: green.
- [ ] **Step 5: Mutations.** (a) Admit while `outstanding <= bound`: four deliveries outstanding; red. (b) Skip the
  shadow check: the shadow case goes red. Revert each.
- [ ] **Step 6: Commit.** `feat(mail): over the pair's bound, peer mail is held and sent when a slot frees (armed by peer-mail-hold)`

### Task 7: Shadow records what it would have held; rollback is measured

**Files:**
- Modify: `server/src/coord/routes.ts` (in `shadow`, a pair refusal also records `wouldHold` on its `mail_rejections`
  detail as the word `hold-shadow`, inside `detail`, so no new column or code)
- Modify: `docs/superpowers/plans/2026-11-10-overlord/w1a-peer-reply/departures.md` (new: the rollback measurement)
- Test: `server/test/peer-mail-held.test.ts`

- [ ] **Step 1:** Failing test: a shadow refusal's `mail_rejections.detail` ends `(hold-shadow)`. Implement; run.
- [ ] **Step 2: Measure the rollback.** Name the oldest build a box can roll back to (`ccrc versions`, read only). On a
  scratch copy of a fixture `coord.db` with one held row, state from that build's source what reads `mail` without a
  delivery (nothing should), and write the result in the departures note.
- [ ] **Step 3: Commit.** `feat(mail): the hold's shadow names each mail it would have held; rollback measured`

**PR B ends here.**

## Deviations found

None yet. Decisions this plan takes, by slug, for the coordinator to number:

- **reply-names-the-delivery** — a reply cites the delivery id it received, not a mail id, because the envelope shows
  only the delivery id and `CLAUDE.md` makes it the id a session uses.
- **reply-cite-never-refuses** — a `replyTo` that does not qualify is counted as ordinary peer mail and the 202 says why,
  so no refusal word is added and the coordinator skill's code list is untouched.
- **one-exempt-reply-per-delivery** — each cited delivery earns one exempt reply; the hourly bound still counts it.
- **hold-the-pair-bound-only** — only the pair's bound holds; `duplicate` and the hourly bound still refuse.
- **hold-ships-in-shadow** — holding is armed by a Shadow lanes row, `peer-mail-hold`, seeded `shadow`.
- **peer-mail-max-held** — at most 12 held mails per pair (`PEER_MAIL_MAX_HELD`), the hourly bound's figure; past it,
  `peer-quota` as today.

## Where things stand

**Needs before it starts:** nothing beyond `main`. It shares no file with the other W1a pieces except
`server/src/coord/schema.ts` (a migration slot, re-measured) and `shared/lane-arm.ts` (one row; the generations piece
adds another).

**What depends on it:** W1, where coordinators and the Overlord first talk by mail. The Overlord's own mail runs inside
its run and is not bound by this lane (spec §6.4).

**Open questions for the operator, most important first:**

1. **Arm the hold?** Recommend: leave it `shadow` for a week, read how many mails it would have held, then arm it.
2. **Should a reply also skip the hourly bound?** Recommend no: the hourly bound is the runaway-sender guard.

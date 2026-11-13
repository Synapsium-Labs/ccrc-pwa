# Overlord W1a: an invited reply is never refused by the peer bound (#2726) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans (or subagent-driven-development) to
> carry out this plan task by task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A reply that a session was asked for gets through the peer bound, and a peer-quota refusal says when the
mail can go. Unasked mail stays bounded exactly as today.

**Why:** Mail between two sessions outside a run (`runId: null`) is bounded at the door: three outstanding (unacked)
per sender and recipient, twelve accepted per sender per hour, and one outstanding per subject. Mail reaches a
session only when it is idle. So a reader that is busy, or that waits on several replies, blocks the replies it asked
for itself. The Overlord's W0 spike measured it (W0-20, proposal 11 of
`docs/superpowers/plans/2026-11-11-overlord-w0-spike-results.md`): of ten mailed tasks, t08's reply was refused
`429 peer-quota` twice, t10's reply was held back for the same reason, and both answers were dropped as out of date
the next day. W1 is where coordinators and the Overlord first talk by mail, so this lands before it.

**Architecture:** Three changes, as the issue orders them.

- **(a) An invited reply is outside the bound.** `POST /api/mail` takes one more, optional body field, `inReplyTo`:
  the DELIVERY id of the mail being answered, the number on the replier's own `delivery:` / `id:` line. The server
  admits a mail as an invited reply when it is peer mail (`runId: null`), its `kind` is `answer`, and `inReplyTo`
  names a delivery that went TO the reply's sender, of a mail FROM the reply's (resolved) recipient, which no earlier
  mail was admitted as answering. Such a mail is never refused by any of the three peer arms, and it is recorded in
  a new nullable column, `mail.answersMail` (the invitation's MAIL row id), so it occupies no slot in either count
  afterwards and a second reply to the same invitation is ordinary peer mail. A unique partial index makes "one
  invited reply per invitation" a fact of the database, not only of the route. An `inReplyTo` that does not qualify
  is not refused: the mail is ordinary peer mail, bounded as today, and if the bound refuses it the refusal says why
  the exemption did not apply.
- **(c) A refusal names when the mail can go.** A `429 peer-quota` refusal gains one additive field, `retry`
  (`PeerRetry`, L0): `{on: 'ack', toId}` for the pair arm (a slot frees when the recipient acks one of
  the outstanding mails, which it does when it next reads its mail), and `{on: 'time', at}` for the hourly
  arm (the epoch ms at which the oldest counted mail leaves the hour). The detail sentence says the same in words,
  and both arms name the invited-reply route when the refused mail did not try it.
- **(b) Holding over-bound mail queued is NOT built here.** It is written up below as a follow-up (see "Follow-up:
  (b)"), because a held mail needs a new delivery state or a held table, a second release path on the mail lane,
  and an expiry, and the delivery-state vocabulary already has an open rollback asymmetry (CLAUDE.md, "Open on
  `main`"). (a) alone removes every refusal W0-20 measured, since all of them were replies.

The decision moves to L1. Check 9 of the mail ingress (`server/src/coord/routes.ts`, the `runId === null` block)
decides inline in L4 today; it becomes one pure decider, `peerMailVerdict`, in a new
`server/src/coord/peerBound.ts` (L1, C5 by the `coord/**` row), fed facts the route reads from the store. The route
keeps the reads and the acts. A characterization of today's three refusal bodies is pinned first and stays green
through the move; the two behaviour changes ((a), then (c)) are commits of their own.

**Tech Stack:** TypeScript (ES modules, NodeNext), `node:sqlite`, vitest; `server/`, `shared/`, and the
coordinator skill's references.

**Spec and sources:** issue #2726; the W0 spike results, proposal 11 and the W0-20 section ("A busy reader blocked
the subject's replies"); the build 9 peers design, `docs/superpowers/specs/2026-08-21-build9-provenance-peers-claims-design.md`
(the bounds table row "Bound the producer, never the record"); CLAUDE.md "Coordination (Build 7) invariants".

## What exists today

- **The door.** `server/src/coord/routes.ts`, `app.post('/api/mail', ...)`. Check 2 parses the body (`fromId`,
  `fromUuid`, `toId`, `subject`, `body`, `kind`, `runId`, `artifacts`); checks 5 to 8 read the registry, prove the
  sender's uuid and resolve a role recipient to `resolvedToId`. Check 9, for `runId === null` only, runs three
  probes in order and refuses on the first that holds:
  - `coord.hasOutstandingPeerDuplicate(fromId, resolvedToId, subject)` → `409 duplicate`, detail
    `an outstanding peer mail from <from> to <to> with this subject is already queued`;
  - `coord.outstandingPeerCount(fromId, resolvedToId) >= PEER_MAIL_MAX_OUTSTANDING` → `429 peer-quota`, detail
    `3 peer mails from <from> to <to> are already outstanding`;
  - `coord.peerMailInLastHour(fromId, Date.now()) >= PEER_MAIL_HOURLY` → `429 peer-quota`, detail
    `<from> has sent 12 peer mails in the last hour`.
  Every refusal goes through the route's `refuse(reply, code, ctx, detail)`, which records a `mail_rejections` row
  and answers `{ok: false, error, detail}` at `REFUSAL_STATUS[code]`. Then one transaction inserts the mail row
  (`coord.insertMail`), queues its delivery (`coord.queueDelivery`) and stamps the envelope against the DELIVERY
  id. Nothing awaits between check 9 and that transaction, so a probe and its insert are never interleaved with
  another request.
- **The three store reads** (`server/src/coord/store.ts`): `hasOutstandingPeerDuplicate` and `outstandingPeerCount`
  join `mail` to `mail_deliveries` on `runId IS NULL AND fromId = ?` and an outstanding state
  (`OUTSTANDING_STATES_SQL`); `peerMailInLastHour` counts `mail` rows `runId IS NULL AND fromId = ? AND at > now -
  1 h`. `stall-store.test.ts` pins that the first two read through `mail_deliveries_due`.
- **The constants** `PEER_MAIL_MAX_OUTSTANDING = 3` and `PEER_MAIL_HOURLY = 12`, `shared/api.ts`, with a docstring
  that states the three arms.
- **The tests.** `server/test/mail-peer-quota.test.ts`: the three arms through the route, each recorded, an ack
  freeing a slot, the hour sliding, and the "run mail is DARK" describe (run traffic never meets a bound and never
  charges the hour). `server/test/mail-hardening.test.ts` (the one-writer census of `mail_deliveries` and the
  sender-scoped dedupe), `server/test/mail-deliveries-writer.test.ts`.
- **What a recipient sees.** The envelope's `id:` line is the delivery id (`coord/envelope.ts`; the coordinator
  skill's `references/mail-envelope.md`), and `ccrc-api mail inbox` prints it as `delivery:`. A sender learns only
  its MAIL row id (the 202 body's `id`). Mail ids and delivery ids are two separate sequences.
- **Where the bounds are described:** `README.md` (the claims paragraph's last sentence), the coordinator skill's
  `references/peer-protocol.md` (the "Peer mail is quota'd" paragraph; `coordinator-skill.test.ts` requires both
  codes to appear there), and the build 9 design's table.
- **Schema.** `server/src/coord/schema.ts`'s `MIGRATIONS` has 63 entries on `origin/main` (measured
  2026-11-13 with the `grep -c` line every entry carries); this plan adds the 64th.

## Global Constraints

- **Test first.** Every task writes its test and runs it red (Task 1 runs green: it is the characterization), then
  changes code.
- **One commit per task**, on this workspace's branch (`ws/overlord-invited-replies`), with the message the task
  gives.
- **Touch only the files a task names.**
- **Run tests from inside `server/`, one file at a time, through the fleet test slice:**
  `ccrc test -- ./node_modules/.bin/vitest run test/<file>`; the type check is
  `ccrc test -- ./node_modules/.bin/tsc --noEmit -p .`.
- **Cite code by symbol or anchor** (`file.ts#name`), never by line number (`citations.test.ts`).
- **Public repository:** neutral fixture names (`demo-quiet-mesa`, `demo-calm-ridge`), no private name, host or home
  path. Run the private-name scan before every push.
- **No D-number is invented.** Decisions and departures are written by slug below; the coordinator issues numbers.
- **Mutations are restored from a saved copy**, never with `git checkout`.
- **Unasked mail is bounded exactly as today.** Every case of `mail-peer-quota.test.ts` that exists on `main` stays
  unchanged and green to the end, except the three exact refusal bodies Task 1 pins, which Task 5 changes on purpose
  and in its own commit.
- **Run mail stays dark.** Nothing here changes a mail that carries a `runId`, beyond the shape check every body
  field already has.

## Review Focus

1. **The invitation check is exact.** All of: `runId` null, `kind === 'answer'`, the named delivery exists, its
   `toId` is the reply's `fromId`, its mail's `fromId` is the reply's RESOLVED recipient, and no mail is already
   recorded as answering that mail. Task 4's cases hold each conjunct with a case that fails only that one; Task 4
   Step 5 deletes each conjunct in turn.
2. **One invited reply per invitation, keyed on the MAIL id.** A parked delivery revived by
   `reviveParkedDeliveries` gets a new delivery id for the same mail; keying the once-rule on the delivery id would
   let each heir buy one more reply. The unique partial index `mail_answers_once` backs the route's check.
3. **An invited reply occupies no slot.** Both counts exclude `answersMail IS NOT NULL`; the duplicate probe still
   counts every outstanding row, because an unasked mail repeating a queued reply's subject is still a repeat.
4. **No unbounded lane opens.** Exempt replies are bounded by invitations: one per mail the recipient sent. A
   recipient that never mailed the sender gives it nothing, and peer invitations are themselves bounded.
5. **Absence permits.** An older client sends no `inReplyTo` and sees today's behaviour; an older server ignores the
   field (it reads named body fields only), so a newer client's reply is merely bounded as today. An older build
   opening a database at `user_version 64` reads every row with its own counts, which include invited replies:
   stricter, never looser.
6. **L1 decides, L4 acts.** `peerBound.ts` imports no I/O and reads no clock; the route reads `Date.now()` once and
   passes it.

## Tasks

### Task 0: This plan

- [ ] Commit this file alone. Message: `docs(plan): Overlord W1a, an invited reply is never refused by the peer bound
  (#2726)`, with `Ledger-Edit: plan file for run 1882 (#2726)` in the commit message's last paragraph.

### Task 1: Pin today's three refusal bodies (characterization, test only)

**Files:**
- Modify: `server/test/mail-peer-quota.test.ts`: a new describe after `'POST /api/mail — peer-mail bounds (runId ===
  null only)'`, reusing the file's `seed`, `withMail`, `send`, `PEER` and `ackAll`.

- [ ] **Step 1: Write the test.** Literal strings on purpose: Task 3 moves the decision and must not move these.

```ts
describe("today's peer refusal bodies, exactly (characterization for #2726)", () => {
  let app: FastifyInstance | undefined;
  afterEach(async () => { if (app) await app.close(); app = undefined; });
  const two = async () => {
    const home = mkTmp('ccrc-peerq-');
    seed(home, 'demo-quiet-mesa'); seed(home, 'demo-calm-ridge');
    for (const to of ['demo-b', 'demo-c', 'demo-d', 'demo-e', 'demo-f']) seed(home, to);
    return withMail(home);
  };

  it('duplicate', async () => {
    const w = await two(); app = w.app;
    await send(app, PEER);
    expect((await send(app, PEER)).json()).toEqual({ ok: false, error: 'duplicate',
      detail: 'an outstanding peer mail from demo-quiet-mesa to demo-calm-ridge with this subject is already queued' });
  });
  it('the pair arm', async () => {
    const w = await two(); app = w.app;
    for (let i = 0; i < 3; i++) await send(app, { ...PEER, subject: `q ${i}` });
    expect((await send(app, { ...PEER, subject: 'one more' })).json()).toEqual({ ok: false, error: 'peer-quota',
      detail: '3 peer mails from demo-quiet-mesa to demo-calm-ridge are already outstanding' });
  });
  it('the hourly arm', async () => {
    const w = await two(); app = w.app;
    for (const to of ['demo-b', 'demo-c', 'demo-d', 'demo-e']) {
      for (let i = 0; i < 3; i++) await send(app, { ...PEER, toId: to, subject: `q ${i}` });
    }
    expect((await send(app, { ...PEER, toId: 'demo-f', subject: 'one more' })).json()).toEqual({ ok: false,
      error: 'peer-quota', detail: 'demo-quiet-mesa has sent 12 peer mails in the last hour' });
  });
  it('a kind answer with no inReplyTo is counted like any peer mail', async () => {
    const w = await two(); app = w.app;
    for (let i = 0; i < 3; i++) await send(app, { ...PEER, subject: `q ${i}` });
    expect((await send(app, { ...PEER, kind: 'answer', subject: 'a reply' })).statusCode).toBe(429);
  });
});
```

- [ ] **Step 2: Run it on the unchanged tree:** `ccrc test -- ./node_modules/.bin/vitest run
  test/mail-peer-quota.test.ts`. Expected: every case passes, the four new ones included.
- [ ] **Step 3: Prove it bites.** Change the pair arm's detail in `routes.ts` (one word): the pair case goes red.
  Restore from the saved copy.
- [ ] **Step 4: Commit.** `test(mail): pin today's three peer refusal bodies, and that an answer is counted (#2726)`

### Task 2: The column, and the store's reads (schema 64)

**Files:**
- Modify: `server/src/coord/schema.ts`: entry 64, after entry 63, in the form of entries 61 and 62.
- Modify: `server/src/coord/store.ts`: `insertMail`, `outstandingPeerCount`, `peerMailInLastHour` (replaced), a new
  `invitation`.
- Modify: `server/src/coord/routes.ts`: check 9's hourly probe reads `peerMailAtsInLastHour(...).length` (no
  behaviour change).
- Modify: `server/test/coord-db.test.ts`: the two migration-count pins (`COORD_SCHEMA_VERSION derives to 23` and the
  migration-11 case) move from 63 to 64, each with a comment line naming `MIGRATIONS[63]`.
- Test: `server/test/peer-bound.test.ts` (new), describe `'the store: invitations and the peer counts'`.

**Interfaces:**

```ts
// schema.ts, entry 64
`
ALTER TABLE mail ADD COLUMN answersMail INTEGER REFERENCES mail(id);
CREATE UNIQUE INDEX mail_answers_once ON mail(answersMail) WHERE answersMail IS NOT NULL;
`
// store.ts
insertMail(m: { ...as today...; answersMail?: number | null }): { id: number };   // the column's one writer
/** The delivery `deliveryId` names, read as an invitation, or null when no delivery has that id. */
invitation(deliveryId: number): Invitation | null;
/** `at` of every peer mail `fromId` had accepted in the hour before `now`, invited replies excluded, ascending. */
peerMailAtsInLastHour(fromId: string, now: number): number[];
// outstandingPeerCount: same signature; its WHERE gains `AND m.answersMail IS NULL`.
```

`Invitation` is declared in `server/src/coord/peerBound.ts` (Task 3) and imported by the store as a type; in this
task it is declared there already, alone:

```ts
/** A delivery read as an invitation to reply. `mailId` is the invited MAIL row's id (the once-rule's key), never
 *  the delivery id. */
export interface Invitation {
  readonly mailId: number;
  readonly inviter: string;   // the mail's fromId
  readonly invitee: string;   // the delivery's toId: the session it was delivered to
  readonly answered: boolean; // a mail is already recorded as its invited reply
}
```

The schema entry's comment says: what the column records (the invitation's mail id, written only by `insertMail`
for a mail the route admitted as an invited reply; NULL for every other row and every row written before it), why
it is keyed on the mail id (revived heirs), that the index makes the once-rule a database fact, and the rollback
reading (an older build counts invited replies as ordinary mail: stricter, never looser; it inserts NULL).

- [ ] **Step 1: Write the failing test** (`peer-bound.test.ts`). A store on a temp database
  (`openCoordDb(path.join(mkTmp(...), 'coord.db'))`). Cases:
  - `invitation(<id of a delivery of a mail from a to b>)` is `{mailId, inviter: 'demo-a', invitee: 'demo-b',
    answered: false}`; `invitation(9999)` is `null`;
  - after `insertMail({..., answersMail: mailId})`, `invitation(...)` reads `answered: true`;
  - a second `insertMail` with the same `answersMail` throws (the unique index);
  - `outstandingPeerCount` skips a row with `answersMail` set and counts one without;
  - `peerMailAtsInLastHour` skips an invited row, skips a row with a `runId`, skips a row older than the hour, and
    answers ascending;
  - the plan of `invitation`'s statement does not `SCAN` `mail` or `mail_deliveries` (`EXPLAIN QUERY PLAN`, the
    `stall-store.test.ts` way).
- [ ] **Step 2: Run it.** Expected: the file fails (no `invitation`, no column).
- [ ] **Step 3: Implement.** Measure the slot first: `git fetch origin main` then
  `git show origin/main:server/src/coord/schema.ts | grep -c '^  // ── [0-9]*: user_version'` must print 63.
- [ ] **Step 4: Run** `peer-bound`, `mail-peer-quota`, `stall-store`, `coord-db`, `mail-hardening`,
  `mail-deliveries-writer`, and the type check. Expected: all pass.
- [ ] **Step 5: Mutations.** Drop `AND m.answersMail IS NULL` from `outstandingPeerCount`: its case goes red. Drop it
  from `peerMailAtsInLastHour`: its case goes red. Drop the unique index: the second-insert case goes red. Restore
  each from the saved copy.
- [ ] **Step 6: Commit.** `feat(coord): mail.answersMail, one invited reply per mail, and the store's invitation read
  (schema 64)`

### Task 3: Check 9's decision moves to L1, unchanged

**Files:**
- Modify: `server/src/coord/peerBound.ts` (created in Task 2 with `Invitation`): add the decider.
- Modify: `server/src/coord/routes.ts`: check 9 reads facts and acts on the verdict.
- Test: `server/test/peer-bound.test.ts`, describe `'peerMailVerdict'`.

**Interfaces:**

```ts
export interface PeerFacts {
  readonly fromId: string;
  readonly toId: string;              // the RESOLVED recipient
  readonly duplicate: boolean;        // hasOutstandingPeerDuplicate
  readonly outstanding: number;       // outstandingPeerCount
  readonly hourAts: readonly number[]; // peerMailAtsInLastHour, ascending
  readonly now: number;
}
export type PeerVerdict =
  | { readonly verdict: 'bounded' }                                       // admitted, inside the bound
  | { readonly verdict: 'duplicate'; readonly detail: string }
  | { readonly verdict: 'peer-quota'; readonly detail: string };
export function peerMailVerdict(f: PeerFacts): PeerVerdict;
```

The order is today's: duplicate, then the pair, then the hour; the details are Task 1's strings. The route builds
`PeerFacts` from the three store reads and `Date.now()` (read once), and on a refusal calls `refuse(reply,
v.verdict, ctx, v.detail)`.

- [ ] **Step 1: Write the failing test:** one case per verdict, the order (a fact set where all three hold answers
  `duplicate`; pair and hour, `peer-quota` with the pair's detail), and both edges (`outstanding` 2 is bounded, 3
  refuses; 11 ats bounded, 12 refuse).
- [ ] **Step 2: Run it.** Expected: red (no `peerMailVerdict`).
- [ ] **Step 3: Implement**, and switch the route.
- [ ] **Step 4: Run** `peer-bound`, `mail-peer-quota` (Task 1's four cases unchanged), `rings/totality`,
  `rings/outward-edges`, `citations`, the type check.
- [ ] **Step 5: Mutations.** `>=` to `>` on the pair arm: the edge case and the existing "4th outstanding" route case
  go red. Swap the duplicate and pair probes: the order case goes red. Restore each.
- [ ] **Step 6: Commit.** `refactor(coord): the peer bound's decision is one L1 decider; today's three refusals
  unchanged`

### Task 4: (a) An invited reply is outside the bound

**Files:**
- Modify: `server/src/coord/peerBound.ts`: `PeerFacts` gains `kind`, `inReplyTo` and `invitation`; the verdict
  gains `'invited'`.
- Modify: `server/src/coord/routes.ts`: check 2 parses `inReplyTo`; check 9 reads `coord.invitation(inReplyTo)` when
  it is given; the insert passes `answersMail` on an `'invited'` verdict.
- Modify: `server/src/coord/store.ts`: nothing beyond Task 2.
- Test: `server/test/peer-bound.test.ts` (decider cases) and `server/test/mail-peer-quota.test.ts` (a new describe,
  `'an invited reply (#2726 (a))'`).

**Interfaces:**

```ts
export interface PeerFacts {
  /* Task 3's fields, and: */
  readonly kind: MailKind;
  readonly inReplyTo: number | null;       // the body's field; null when absent or null
  readonly invitation: Invitation | null;  // store.invitation(inReplyTo); null when inReplyTo is null or names none
}
export type PeerVerdict =
  | { readonly verdict: 'invited'; readonly answersMail: number }
  | /* Task 3's three */;
/** Whether the mail is the one invited reply to `invitation`, and if not, why not (null when it did not ask). */
export function invitedReply(f: PeerFacts): { readonly invited: true; readonly mailId: number }
  | { readonly invited: false; readonly why: string | null };
```

`invitedReply` answers `invited` iff `inReplyTo !== null && kind === 'answer' && invitation !== null &&
invitation.invitee === fromId && invitation.inviter === toId && !invitation.answered`. Its `why` sentences, one per
failed conjunct: `inReplyTo <n> names no delivery`; `an invited reply is kind answer, not <kind>`; `delivery <n> was
not delivered to <fromId>`; `delivery <n> is not a mail from <toId>`; `the mail delivery <n> carries is already
answered`. `peerMailVerdict` answers `invited` first, before the duplicate probe; otherwise today's three in order,
and a refusal's detail gains `; not an invited reply: <why>` when `why` is not null.

Check 2's shape rule for `inReplyTo` is `runId`'s: absent or `null` is none; a positive integer is a value; anything
else refuses `400 bad-kind` with `inReplyTo must be a positive integer (a delivery id) when given`. On run mail the
field is parsed and then ignored: no invitation is read and `answersMail` stays NULL.

- [ ] **Step 1: Write the failing tests.** Decider (`peer-bound.test.ts`): the invited case with every bound spent
  (`duplicate: true`, `outstanding: 3`, twelve ats) answers `invited`; one case per failed conjunct answers the
  bounded path with its `why` in the detail; an `inReplyTo` of null adds no clause. Route (`mail-peer-quota.test.ts`),
  with a helper `deliveryIdOf(coord, mailId)` (`SELECT id FROM mail_deliveries WHERE mailId = ?`):
  - **the W0-20 case:** `demo-calm-ridge` has three unacked mails out to `demo-quiet-mesa`; `demo-quiet-mesa` asks
    `demo-calm-ridge` a question; its reply, `kind: 'answer'`, `inReplyTo` that delivery, is `202`, recorded with
    `answersMail` set, and records no rejection;
  - a second reply naming the same delivery is `429 peer-quota`, its detail containing `already answered`;
  - the hourly arm: with twelve peer mails in the hour, the invited reply is `202`, and the next unasked mail is
    still `429`;
  - no slot: three invited replies outstanding to one peer, then an unasked mail to it is `202`;
  - not invited, each `429` with its `why`: `kind: 'status'`; a delivery of a mail from a third session; a
    delivery to a third session; delivery 999999;
  - the duplicate probe does not stop an invited reply whose subject repeats an outstanding unasked one;
  - a `role` recipient: a reply addressed `toId: 'coordinator'` with a `runId` is run mail (dark), and its
    `answersMail` is NULL;
  - shape: `inReplyTo` of `'7'`, `0`, `-1` and `1.5` is `400 bad-kind`; `null` is accepted.
- [ ] **Step 2: Run.** Expected: the new cases red; Task 1's four and every older case green.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** `peer-bound`, `mail-peer-quota`, `mail-routes`, `mail-hardening`, `mail-deliveries-writer`,
  `claims-envelope`, `peers-claims-l0`, `single-definition/*`, the type check.
- [ ] **Step 5: Mutations**, each restored from the saved copy: delete each conjunct of `invitedReply` in turn (five
  mutants; each turns its own "not invited" case red); test `invited` after the duplicate probe instead of before
  (the repeated-subject case goes red); drop `answersMail` from the route's `insertMail` call (the second-reply and
  no-slot cases go red); read the invitation for run mail too (the dark case goes red).
- [ ] **Step 6: Commit.** `feat(mail): an invited reply, kind answer naming the delivery it answers, is outside the
  peer bound (#2726)`

### Task 5: (c) A peer-quota refusal names when the mail can go

**Files:**
- Modify: `shared/api.ts`: `PeerRetry`, beside `PEER_MAIL_MAX_OUTSTANDING`, and the constants' docstring names the
  invited-reply exemption.
- Modify: `server/src/coord/peerBound.ts`: the `peer-quota` verdict carries `retry: PeerRetry`; the details gain
  their "when" clause.
- Modify: `server/src/coord/routes.ts`: `refuse` takes an optional `extra` merged into the answer body (never into
  the recorded row), and check 9 passes `{retry}`.
- Modify: `server/test/mail-peer-quota.test.ts`: Task 1's three bodies are updated here, on purpose.
- Test: `peer-bound.test.ts` and `mail-peer-quota.test.ts`.

**Interfaces:**

```ts
/** When a mail refused `429 peer-quota` can go (#2726 (c)): the pair arm frees when `toId` acks one of the outstanding
 *  mails (or the lane parks one); the hourly arm frees at `at`, epoch ms, when the oldest counted mail leaves the hour. */
export type PeerRetry =
  | { readonly on: 'ack'; readonly toId: string }
  | { readonly on: 'time'; readonly at: number };
```

The hourly arm's `at` is `hourAts[hourAts.length - PEER_MAIL_HOURLY] + 3_600_000`: the mail whose leaving brings
the count under the bound. The details:
- pair: `3 peer mails from <from> to <to> are already outstanding; it can go when <to> acks one, which it does when
  it next reads its mail`;
- hour: `<from> has sent 12 peer mails in the last hour; it can go at <ISO> (in <s> s), when the oldest leaves the
  hour`;
- both, when the mail carried no `inReplyTo`: `. A reply to a mail of <to>'s is outside this bound: send it as kind
  answer with inReplyTo set to that mail's delivery id`; when it carried one that failed, Task 4's `; not an invited
  reply: <why>` instead.
`duplicate` gains no `retry` (it is not a bound to wait out: the mail is already queued).

- [ ] **Step 1: Write the failing tests:** the decider's `retry` for each arm, the hourly `at` with thirteen ats
  (the second oldest), and the hint clause present without `inReplyTo` and absent with one; through the route, each
  refusal's body `toEqual` its new exact form (Task 1's three, updated), `retry.at` equal to the oldest row's `at`
  plus one hour, and `duplicate` with no `retry` key.
- [ ] **Step 2: Run.** Expected: red.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** as Task 4 Step 4, with `coordinator-skill`.
- [ ] **Step 5: Mutations:** `hourAts[0]` for the indexed `at` (the thirteen-ats case goes red); drop `extra` from
  `refuse`'s body (the route `retry` cases go red). Restore each.
- [ ] **Step 6: Commit.** `feat(mail): a peer-quota refusal says when the mail can go (#2726)`

### Task 6: The decider's mutant set and floor (D-8217's rule)

**Files:**
- Modify: `server/test/sim/mutation-floors.test.ts`: a `PEER_SET` (`MutantSet<typeof import('../../src/coord/peerBound.js')>`)
  above `MUTANT_SETS`, and its key, `server/src/coord/peerBound.ts#peerMailVerdict`, in the record.
- Modify: `server/test/sim/mutation-floors.json`: its floor, `1`.

The set's suite is the decider's own cases over the loaded module: the bounded, duplicate, pair-edge, hour-edge,
order, each invited conjunct, and the `retry` of each arm. Its mutants: `>=` to `>` on the pair and on the hour; the
pair and duplicate probes swapped; `invited` tested after the duplicate probe; each of the five conjuncts of
`invitedReply` deleted; `hourAts[0]` for the indexed `at`. Every mutant must be killed, so the floor is 1.

- [ ] **Step 1:** Add the set and the floor. **Step 2: Run** `test/sim/mutation-floors.test.ts`. Expected: every
  mutant killed. **Step 3:** Delete one suite case that is a mutant's only killer: the run goes red, naming it.
  Restore. **Step 4: Commit.** `test(sim): peerMailVerdict's mutant set and floor`

### Task 7: The descriptions

**Files:**
- Modify: `README.md`: the claims paragraph's peer-mail sentence gains the exemption and `retry`.
- Modify: `ccd/coordinator-skill/references/peer-protocol.md`: the "Peer mail is quota'd" paragraph.
- Modify: `ccd/coordinator-skill/references/mail-envelope.md`: one paragraph after "Ack before you act": answering a
  mail with `kind: answer` and `inReplyTo: <its id>` (the delivery id on the `id:` line) is outside the peer bound,
  once per mail.

- [ ] **Step 1:** Edit. No numeric line citation.
- [ ] **Step 2: Run** `coordinator-skill`, `docs-parity` if it reads either file, `citations`, `anchors`, `dtbd`, and
  `deviation-refs` after `git fetch origin main`.
- [ ] **Step 3: Commit.** `docs(mail): the invited reply and the refusal's retry, in the README and the coordinator
  skill's references (#2726)`

## Follow-up: (b), holding over-bound mail queued

Not built here; for the coordinator to raise as its own piece if wanted after (a) has run on the fleet.

- **Where it is held:** a new table, `peer_mail_held` (mail id, pair, held-at), with the `mail` row inserted at the
  door and NO delivery row until release. A new `MailDeliveryState` (`held`) was considered and rejected: an older
  server reading an unknown state treats it as live to the negative-form guards and not-outstanding to
  `dueDeliveries` (CLAUDE.md, "Open on `main`"), so a rollback would deliver or strand held mail unpredictably.
- **Who releases it:** the mail lane's sweep, one pass per tick, queuing the oldest held mail of a pair through
  `queueDelivery` when the pair's outstanding count drops under the bound; nothing else.
- **What bounds it:** at most one held mail per pair (a second over-bound mail is refused as today), the hourly arm
  still refuses and charges the hour at the door, and a held mail older than a day is dropped to a recorded
  rejection (`peer-quota`, detail "held a day"). A sender that floods is refused exactly as now.
- **Why it waits:** a second release path on the mail lane, a table and an expiry, for a case (a) mostly removes;
  W0-20's refusals were all replies. Measure first whether unasked peer mail is refused at all once (a) is live
  (`mail_rejections` rows with `code = 'peer-quota'` and `answersMail` never set on the sender's later mail).

## Where this plan differs from the draft of run 1880

Run 1880 drafted a plan for this piece before its scope changed (`w1a-peer-reply.md` at `89a0ae2be`, on
`ws/overlord-w1a-plans`). This plan takes from it the reply naming a delivery id, the once-rule, the `retry` field
passed outside `mail_rejections`, the decider move behind a characterization, the mutation-floor entry and the
kebab-scan caution (`mail-routes.test.ts`'s scan of `server/src/coord` would flag a new two-word literal, so `PeerRetry`
uses the one-word `ack` and `time`). It differs in six places:

| Draft | This plan | Why |
|---|---|---|
| Only the pair arm is lifted; the hour and `duplicate` still apply | All three arms are lifted for an invited reply | The issue's title, "never refused by the peer bound". The hour arm guards a runaway sender, and an invited reply cannot run away: one per mail the recipient sent. A duplicate subject on two replies is not a repeat |
| The once-rule keys on the cited DELIVERY id (`replyToDelivery`) | It keys on the invited MAIL id (`answersMail`), with a unique partial index | A revived heir delivery has a new id for the same mail; the index makes the rule a database fact |
| An invited reply still counts in later counts | It holds no slot afterwards | Answering should not cost the replier its own room for unasked mail |
| A run mail cannot be an invitation (`run-mail`) | Any mail from the recipient to the sender can | A peer reply to a run mail is bounded by the same once-rule; refusing it would refuse an asked-for reply |
| The 202 carries a `reply` verdict | Only a refusal says why the exemption did not apply | Smaller wire change; a reply that was admitted needs no explanation. Listed under Later |
| (b) built in shadow, behind a Shadow lanes row | (b) written up, not built | The brief allows it; see "Follow-up: (b)" |

## Deviations found

Decisions and departures of this plan, by slug; the coordinator issues the numbers.

- **invited-reply-outside-every-arm** — the issue names "the pair's bound"; an invited reply is exempt from all three
  peer arms (pair, hour, duplicate), as the issue's title says ("never refused by the peer bound"). The exemption is
  bounded by invitations, one reply per mail the recipient sent, so no arm is needed to bound it.
- **invited-reply-holds-no-slot** — an admitted invited reply is excluded from both counts afterwards, so answering
  never costs the replier the room for its own unasked mail.
- **in-reply-to-is-a-delivery-id** — the wire field names the DELIVERY id (the only id a recipient sees); the
  once-rule and the column key on the invitation's MAIL id, so a revived heir delivery buys no second reply.
- **unqualified-in-reply-to-is-counted** — an `inReplyTo` that does not qualify is not refused on its own; the mail
  is ordinary peer mail, and a refusal says why the exemption did not apply.
- **peer-check-moves-to-l1** — check 9's decision moves from the route (L4) to `coord/peerBound.ts` (L1).
- **peer-retry-field** — `retry` is a new, additive field on the `429 peer-quota` answer body only; the recorded
  `mail_rejections` row is unchanged.
- **held-queue-deferred** — (b) is written up above, not built.
- **peer-window-one-constant** — the hourly arm's one-hour window becomes one L0 constant, `PEER_MAIL_WINDOW_MS`
  (`shared/api.ts`), read by the store's hourly read and by the decider's `retry`, instead of a literal in each.
- **peer-retry-one-word** — `PeerRetry`'s words are `ack` and `time`, one word each, so the quoted-kebab scan of
  `server/src/coord` (`mail-routes.test.ts`) needs no allowlist row.

## Where things stand

**Agreed (the brief):** (a) and (c) are built in this piece; (b) is built only if it can be made safe here, and
otherwise written up.

**Waiting on you (the coordinator):** the numbers for the slugs above; whether to raise (b) as its own piece.

**Later:** the 202 could say whether a reply was admitted as invited (the draft's `reply` field). The envelope could show which of the recipient's mails a reply answers (an `answers:` line); not needed
for the bound, and the envelope grammar is pinned, so it is left out.

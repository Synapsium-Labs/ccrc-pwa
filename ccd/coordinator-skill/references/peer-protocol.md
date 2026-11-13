# The peer protocol — discovery, claims, the allocator

The long form of coordinator clause 10 and worker clause 11 (Build 9, spec
D9–D13, D17). Both skills point here. The FIRST copy of the etiquette rides
the route response itself: `GET /api/peers` hands back `etiquette` — the five
`PEER_ETIQUETTE` rules, verbatim — in the same answer as the peer list, so a
session that can discover peers has the rules whether or not any installer
ever ran on its home. This file is the commentary, never the only copy.

Every call below goes through `ccrc-api`, invoked by explicit path exactly as
SKILL.md's "How to call the API" section sets it up — this file deliberately
carries no second copy of that setup, nor of any address or token handling,
because the client does both itself. stdout is the response body, which is all
these routes need you to read: every refusal arrives IN it.

    body=$("$API" peers list --project "$project")

## Discovery — `GET /api/peers`

`GET /api/peers?project=<slug>` or `?of=<your session id>` — exactly one of
the two. Authenticated by a live PWA cookie OR the box token (the
`GET /api/runs` dual arm), so it works cookieless from the fleet host.

What comes back, per peer: `deliverable` — `yes`, or `no:<reason>`, or
`unknown` (an unmeasurable registry is NOT `no`); `archivedAt` VERBATIM,
deciding nothing, with `archivedStale` naming the rows where the stamp
contradicts a live heartbeat — the stamp is silently false on measured live
rows, and a silently false field must never be laundered into a filter; the
peer's current `intent`; and `etiquette`, the five rules, in the answer
itself. `deliverable` reports only the STRUCTURAL rungs — a busy peer is
still `yes`; it answers its mail when it next idles.

Read `projects[]` before concluding you are alone. An empty peer list for a
typo'd project looks exactly like an empty project, and `projects[]` — every
project measured this pass — is what tells them apart. Concluding "I am
alone" off a typo and then conflicting is this feature's central failure
mode.

## Claiming — `POST /api/claims`

    body=$("$API" claims take --json - <<JSON
    {"byId":"$id","byUuid":"$uuid","project":"$project",
     "paths":["server/src/coord/store.ts"],
     "intent":"wave 3: store methods for the mirror reads",
     "runId":$runid}
    JSON
    )

`byId`/`byUuid` here, NOT the mail ingress's `fromId`/`fromUuid` — a claim
is attributed, not sent, and the route 400s the wrong spelling. All-or-
nothing: five paths, one conflict, ZERO acquired. Claims are ADVISORY
— nothing on the box enforces one; what a claim buys is a synchronous answer
at the moment of asking instead of a merge conflict at the end of the wave.
Claiming `.` is refused `bad-path` — the store's own decision: claiming the
whole repo IS the module wedge. An empty path (or an empty `paths` array)
never reaches that decision — the route's shape validation refuses it
`bad-request` first, like any malformed body. Re-POST the same paths at any moment to renew the
lease and rewrite `intent` (the intent is what the fleet screen renders, so
keep it current — a branch name is written once; an intent can be written
every ten minutes). The lease (`CLAIM_LEASE_MS`, 45 min) renews itself off
the watcher while the holding session is measured running; the hard cap
(`CLAIM_HARD_CAP_MS`, 8 h) is never renewed, so a long program re-declares
its claim rather than holding it forever.

Before the hard cap, a still-busy holder re-takes its paths (D-8395). The
200 names the cap as `hardExpiresAt`; once it is less than one lease (45 min)
away and you are still working on those paths, POST the same paths again.
Because the server measures you running, it ends the old claim
(`endedBy:"rechained"`) and opens a new one with a fresh lease and a fresh
8 h cap, whose `chainedFrom` names the old id, and the 200 says so:
`rechained: [{from, to}]`, with the new `hardExpiresAt`. Release or report
by the new id (`to`). A re-take earlier than that only renews the lease and
leaves the cap where it was. A holder the server does not measure running
is not re-chained and still lapses at the cap. That lapse is the
`lapsedSince` gap below, so re-take before the cap, not after it.

A 200 that carries `lapsedSince` (`[{id, endedAt, endedBy}]`) means one of
YOUR claims on these paths lapsed within the last lease (`CLAIM_LEASE_MS`)
and you have just taken them again: between `endedAt` (when that lease ran
out, however late it was swept) and now nothing held them, so another
session may have edited them. Before you edit, fetch and
read what landed on those paths since `endedAt` (`git log --since`, the
peers' branches, `GET /api/claims?project=<slug>&all=1` for who held them in
the gap), and fold any change in; say in your report that the claim had a
gap. The field is absent when there was no gap.

Release is `POST /api/claims/:id/release` when a claim is done early:

    body=$("$API" claims release "$claim" --json - <<JSON
    {"byId":"$id","byUuid":"$uuid"}
    JSON
    )

A run's close releases that run's claims itself, and a dead session's claims
lapse inside the lease — so a forgotten release costs minutes, never a
wedge.

## Reading a 409

The conflict response is an ADDRESS, not a rejection slip. It names
EVERY conflicting path (never just the first), and carries the holder's
identity (`heldBy`, `heldByUuid`), the holder's stated `intent`, its `runId`, the
standing `expiresAt`, the holder's `deliverable`, and a pre-addressed
`mailHint` — the envelope to send, already filled in. When `deliverable` is
`no:<reason>`, `mailHint` is `null` — escalate to the operator instead:
never a silent send at a peer measured unreachable.

## Losing a race gracefully

Losing a race is the mechanism working — you found out synchronously, awake,
mid-request, instead of at merge. In order:

1. Read the holder's `intent`. It may already answer your question.
2. Work what is uncontested — claim the paths that did NOT conflict as a
   fresh claim of their own, and get on with those.
3. Mail the holder through `mailHint` when the overlap is real. A good peer
   question is ONE mail that names the file, what you need from it, and what
   you are doing meanwhile — a question the holder can answer with a
   sentence. Peer mail is human-timescale: the idle gate holds it until the
   peer next idles, so send once and do not sit waiting on the reply.
4. Never edit the contested path anyway. An advisory claim you ignore is a
   merge conflict you scheduled.

Peer mail is quota'd so the record stays bounded, and both refusals are
recorded: a second mail with the same subject to the same peer while the
first is outstanding refuses 409 `duplicate` (change the subject only if it
is genuinely a new question); more than 3 outstanding to one peer
(`PEER_MAIL_MAX_OUTSTANDING`), or more than 12 in an hour
(`PEER_MAIL_HOURLY`), refuses 429 `peer-quota`. Bound the producer, never
the record.

A reply you were asked for is never refused by those bounds (#2726): send it
`"kind":"answer"` with `"inReplyTo"` set to the DELIVERY id of the mail you
answer (its envelope's `id:` line, `delivery:` in `mail inbox`, `deliveryId`
in `mail list`; never the 202's `id`, which is a mail id). It must answer an
unasked mail delivered to you by the peer you are replying to, and each such
mail buys one reply; it then holds no slot either. A reply to an invited
reply, or to your own mail, invites nothing, so a thanks-for-the-thanks is
ordinary peer mail. Anything else is ordinary peer mail too. A `peer-quota` refusal
says when the mail can go, in its `detail` and in a `retry` field:
`{"on":"ack","toId":…}` (when that peer acks one of your outstanding mails,
which it does when it next reads its mail) or `{"on":"time","at":<epoch ms>}`
(when your oldest mail of the hour leaves it). Wait for that, or answer
through `inReplyTo`; do not drop the mail.

## History — `GET /api/claims`, `GET /api/lifecycle`, `GET /api/ledger`

`GET /api/claims?project=<slug>` is the live set (`claims`) — the coordinator
reads it before splitting a wave (clause 10). Beside it, `recentlyLapsed`
lists the rows that lapsed within the last lease, each `state:"lapsed"` with
its `endedAt` and `endedBy` (`session-gone`, `expired`, `hard-cap`), so a
lapsed claim no longer reads like one never taken. A recently lapsed row on a
path the wave touches is treated as still held by its holder: mail the holder
and dispatch onto that path only once it confirms it is done there, or has
re-claimed it. `all=1` includes ended rows, because
"held by X until it died" is an answer, which is why a lapsed claim is kept
and never deleted. A hold that outlived one 8 h window reads there as a
chain: each `released` row with `endedBy:"rechained"` is continued by the
row whose `chainedFrom` is its id (D-8395). `GET /api/lifecycle?session=<id>` is a workspace's past
tense, and it answers for a workspace that no longer exists — read each
row's own lifecycle families (`obs`/`dec`/`meas`), never the registry's
archive stamp, which is measured false on live rows. `GET /api/ledger?project=<slug>`
(per-project, required) lists every deviation allocation with its state
(`allocated`, `landed`) and its derived `stale` flag — reported at read
time, never stored.

## The allocator — `POST /api/ledger/deviations`

    body=$("$API" ledger allocate --json - <<JSON
    {"byId":"$id","project":"$project","count":8,"title":"program $slug D-block"}
    JSON
    )

`201 {numbers, floor}` — a contiguous block, appended to the flat ledger log
BEFORE the database commits, so on any doubt a number is SKIPPED, never
reissued (gaps cost nothing; a reissue once cost 394 rewritten D-ref lines
across 30 files). `409 not-seeded` no longer means "wait for the sweep": the
first allocation on a project seeds the floor itself, measuring that project's
own docs/superpowers plans and specs inline, and then proceeds. The refusal now
means one of two things, and the `detail` says which — the documents were read
and name no `D-<n>` at all, so there is nothing to seed from; or they could not
be measured, so nothing was proven either way. Report it, do not invent. The
coordinator allocates the program's whole block at run-open (clause 10) and names it in
the brief, so a wave in flight never calls the allocator at all. A worker
that finds an unplanned deviation with no server reachable writes
`D-TBD-<slug>` and reports — the tree's own red suite refuses to let a
`D-TBD` land, which turns a server outage into a loud mechanical blocker
instead of a judgement call. Inventing a number is the root cause this
allocator exists to delete.

`byId` is who asked, and it is stored unverified — attribution, not authentication,
the claims table's stance one section up. Omit it and the row records no holder at
all: at least 101 of this project's allocations were in that state when this was
written (2026-09-02), and nothing can put a holder back on them. The client fills it
from your pane when the body leaves it out, and refuses rather than sending a blank
one; `--by <id>` is for a caller that has no pane at all.

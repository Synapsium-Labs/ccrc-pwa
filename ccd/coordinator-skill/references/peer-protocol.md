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
    body="${resp%$'\n'*}"

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

## History — `GET /api/claims`, `GET /api/lifecycle`, `GET /api/ledger`

`GET /api/claims?project=<slug>` is the live set — the coordinator reads it
before splitting a wave (clause 10); `all=1` includes ended rows, because
"held by X until it died" is an answer, which is why a lapsed claim is kept
and never deleted. `GET /api/lifecycle?session=<id>` is a workspace's past
tense, and it answers for a workspace that no longer exists — read each
row's own lifecycle families (`obs`/`dec`/`meas`), never the registry's
archive stamp, which is measured false on live rows. `GET /api/ledger?project=<slug>`
(per-project, required) lists every deviation allocation with its state
(`allocated`, `landed`) and its derived `stale` flag — reported at read
time, never stored.

## The allocator — `POST /api/ledger/deviations`

    body=$("$API" ledger allocate --json - <<JSON
    {"project":"$project","count":8,"title":"program $slug D-block"}
    JSON
    )

`201 {numbers, floor}` — a contiguous block, appended to the flat ledger log
BEFORE the database commits, so on any doubt a number is SKIPPED, never
reissued (gaps cost nothing; a reissue once cost 394 rewritten D-ref lines
across 30 files). `409 not-seeded` means the hourly floor sweep has not yet
measured this project's plans: report it, do not invent. The coordinator
allocates the program's whole block at run-open (clause 10) and names it in
the brief, so a wave in flight never calls the allocator at all. A worker
that finds an unplanned deviation with no server reachable writes
`D-TBD-<slug>` and reports — the tree's own red suite refuses to let a
`D-TBD` land, which turns a server outage into a loud mechanical blocker
instead of a judgement call. Inventing a number is the root cause this
allocator exists to delete.

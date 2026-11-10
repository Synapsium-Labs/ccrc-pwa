# The coordinator's API calls

Part of the `ccrc-coordinator` skill, whose `SKILL.md` holds the contract.

## How to call the API

Every call goes through **`ccrc-api`**, the closed client installed beside
`ccd`. It is not a wrapper for convenience: a repo may legitimately deny
`Bash(curl:*)` in its committed settings, and one did on 2026-08-26 — the worker
on that programme could not read its mail at all, while the coordinator kept
working only because `resp=$(curl …)` happens to slip past that matcher. Neither
half of that was acceptable.

`~/.local/bin` is NOT on the `claude-session@` unit PATH, so invoke it by path:

```bash
API="$HOME/.local/bin/ccrc-api"

# THE ADDRESS AND THE TOKEN ARE THE CLIENT'S JOB, and that is the whole point of
# it. It reads ~/.ccrc/agent.env's CCRC_SERVER_URL itself and REFUSES
# `no-server-url` rather than guessing a host if the derivation comes up empty —
# a stop, never a fallback literal. It extracts the token from
# ~/.cc-secrets/ccrc-mail.token's value line rather than sending the
# `#`-comment preamble wrapped around it. Neither is yours to derive any more,
# so neither can be got wrong one caller at a time.

body=$("$API" runs open --json - <<JSON
{"program":"<slug>","title":"<title>","programmeTitle":"<the programme's name, used only when this opens a new programme>","project":"<project>","homeProject":"<home project>","wave":1,"waveOf":<M or null>,"claimedBy":"$id"}
JSON
)
```

**stdout is the response body, and for almost every decision it is all you
need** — every refusal these routes send arrives IN the body, so the
`-w '\n%{http_code}'` capture and the `${resp##*$'\n'}` split that used to be
required here are simply gone. The HTTP status goes to stderr as `http <code>`
on the rare occasion you want it; redirect stderr to a file and read it there.

**The client exits 0 whenever a response arrived, whatever its status, and this
is deliberate.** It is the same invariant this section used to state as "never
use `curl -f`", and it is stated here so it does not get re-broken: `-f` made
curl print NOTHING on a 4xx and exit 22, throwing away the body — and the body
is the whole protocol. A 4xx is an ANSWER on these routes, clause 8's
`claimed-by-another` included. The one non-zero exit means NO RESPONSE HAPPENED
(DNS, refused, timeout), and even then stdout carries
`{"ok":false,"error":"transport",…}` so you never parse a second shape.

Never print the token. You no longer read it, so the way to get this wrong is
gone — but it also never appears in the client's output, on any path, including
a 401.

Every write route answers JSON, on success and on refusal alike. A `4xx`
`$code` is a normal **answer**, not a command failure — but the field the
code rides on is NOT the same on every route, and `ok:false` is the only
field always present: `POST /api/runs`/`/dispatch`/`/:id/close` put it on
`refused` (`paused`, `mail-disabled`, `cap-concurrency`,
`ambiguous-dispatch`, `worker-busy`, `hookstate-unmeasurable`,
`claimed-by-another`, `not-dispatched`, `prhistory-unreadable`,
`workspace-spent`, `spent-unmeasured`, `intent-held`); those same
three routes put `unknown-run`, `bad-transition` and the re-measurement
family (`stale-tip`, `pr-regressed`, `no-handoff-commit`) on `error` instead;
`POST /api/mail` puts every one of its own refusals on `error`; and `POST /api/runs/:id/advance` puts **every**
refusal it ever sends — including codes that ride `refused`/`error` on the
other routes — on `reject.code`. Check `$body.refused ?? $body.error ??
$body.reject?.code` (in that order costs nothing, since a body only ever
populates one) rather than assuming a fixed field, and never branch on the
client's exit status — it reports whether a response HAPPENED, never what the
response said. The refusals you will actually meet are
`paused`, `mail-disabled`, `cap-concurrency`, `ambiguous-dispatch`,
`worker-busy`, `hookstate-unmeasurable`, `status-unmeasurable`,
`worker-starting`, `claimed-by-another`,
`project-mismatch`, `home-mismatch`, `claimant-is-a-worker`, `workspace-spent`,
`spent-unmeasured`, `hold-oversize`, `hold-invalid`,
`not-dispatched`, `prhistory-unreadable`, `bad-transition`, `stale-tip`,
`pr-regressed`, `no-handoff-commit`, `unknown-run`, `registry-unmeasurable`,
`unknown-item`, `item-terminal`, `intent-held`. Their meanings are in
`references/wave-lifecycle.md`.

**That list is the RUN routes only** (`/runs`, `/dispatch`, `/:id/close`,
`/:id/advance`, `/:id/items`). `POST /api/mail` and `POST /api/mail/:id/ack` draw from a
mostly disjoint vocabulary, all on `error`: `unauthenticated`, `bad-kind`,
`oversize`, `registry-unmeasurable`, `unknown-sender`, `stale-uuid`,
`unknown-recipient`, `unknown-run`. §3 of `references/wave-lifecycle.md`
covers the ones you can actually cause by acking or sending mail wrong
(`bad-kind`, `stale-uuid`); the rest are there for completeness.

**`oversize` is not mail-exclusive.** `POST /api/runs/:id/dispatch` sends the
identical `error:'oversize'` (413) when the mail it would queue is too long —
and what it measures is the COMPOSED mail, the worker kickoff prefix plus your
brief, so a brief can be refused without itself exceeding the cap. A RUN-route
answer, checked before anything on the run is touched. Its own meaning, the
effective ceiling on a brief and the recovery rule (trim the brief and resend;
the run is untouched) are in the dispatch table, `references/wave-lifecycle.md`
§2 — not repeated here, so there is exactly one place this code's dispatch-side
meaning lives.

**`hold-oversize` is different:** `/dispatch` and `/:id/close` answer
`error:'hold-oversize'` (413) when the complete session-card reason — programme,
wave, optional denominator, and exact run id — cannot fit the hook's
127-character display window. Stop and shorten the programme slug; the refusing
boundary performs no fleet act. `POST /api/runs` is NOT in that list: its slug
cap is derived so the widest hold it can compose is 124 of 127, so an
over-long slug is refused there as `bad-request` (400) with a `detail` naming
the budget, before any row exists. The two routes that CAN emit it read
persisted or reconstructed rows that never passed that door. The route-specific tables in `references/wave-lifecycle.md`
name exactly what remains untouched. `hold-invalid` (400) is its grammar/domain
sibling: a persisted programme or an included wave, denominator, or run id cannot
be represented as the session hook's positive-decimal hold grammar. Stop and
report it; changing a title cannot repair that stored run.

**Not every non-2xx body carries a code at all.** `error:'bad-request'` (400,
a malformed request body — including the fingerprint SHAPE `POST
/api/runs/:id/advance` requires on every call, `references/wave-
lifecycle.md` §4), `error:'unsupported'` (501, this ccd build lacks a verb a
route needs) and a bare `{"ok":false,"stderr":"<text>"}` (502, an underlying
`ccd` call failed, no `refused`/`error`/`reject.code` populated at all) are
real answers the run routes can send that are NOT in the list above and are
NOT typed refusal codes (`shared/api.ts`'s own `RunRefuseCode` docstring says
so explicitly — "a caller that assumes every non-2xx response here carries a
`RunRefuseCode` is wrong"). Your documented field-check
(`$body.refused ?? $body.error ?? $body.reject?.code`) reads `undefined` for
the bare-502 shape; treat `undefined` the same as any refusal you do not have
a specific rule for — **stop and report**, never retry blindly. A retry after
`registry-unmeasurable` specifically can ORPHAN a workspace `ccd ws-add`
already spawned before the refusal landed — see the table in
`references/wave-lifecycle.md` §2.

One more untyped shape, and it is not run-route-specific: `error:'not-configured'`
(501) is what EVERY coordination route — the mail pair and all four run
routes alike — answers when this box's server has no coordination database
wired in at all. It is not a per-call failure to retry; it is a fact about
the box, the same as `unsupported`: stop and report it to the operator.

**Landing writes.** `fixesMain` is the coordinator's or the operator's to set
or clear, never a worker's. For a PR with no run, use
`POST /api/landing/entries`; to replace its order edges or `fixesMain`, use
`POST /api/landing/order` as described in `references/wave-lifecycle.md` §5.
Both writes are box-token gated and attributed, not an authorization boundary.

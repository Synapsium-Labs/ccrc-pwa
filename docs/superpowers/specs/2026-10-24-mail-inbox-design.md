# Mail inbox and clean client output

**Spec** · 2026-10-24 · Status: draft for review, rev 0 · Owner: the ccrc coordinator · Deviation: D-6772 (issued by the ledger) · Plan: `docs/superpowers/plans/2026-10-24-mail-inbox.md`

**Related:** `2026-08-26` closed client (`docs/superpowers/plans/2026-08-26-ccrc-api.md`), the robust-mail-delivery reference nudge (`server/src/coord/envelope.ts#renderMailNudge`, D-738, D-791), D-41 (delivery id against mail id), D-5242 (hibernation and the wake budget), D-5298 (coordinator-first routing: approval nudges ride mail), D-5513 (masking before text leaves the server), D-5838 (the parked state), D-5997 (one writer of `mail_deliveries`), `2026-09-29-worker-stall-watch-design.md` (the mail gate and the deaf arms).

## In short

Reading mail costs a session three client calls per message and a hand-written parser each time. The fleet's transcript audit puts that at 2.5% of all spend, and it is the cheapest of the polling costs to remove, because the server already knows everything the reader needs. This spec does four things:

1. **Clean output.** `ccrc-api` prints the response body on stdout and nothing else, always ending in a newline. The `http <code>` line it prints on stderr today becomes opt-in (`CCRC_API_STATUS=line`), and the two in-tree scripts that parse it opt in. Exit codes do not change.
2. **`ccrc-api mail inbox`.** One call prints every unread mail addressed to the calling session as plain text (from, kind, subject, run, artifacts, body), then acks each delivery it printed, one at a time, through the existing ack route. A delivery whose print or ack fails stays unacked. The server selects and renders, and the client prints and acks (§3.2 gives the reasons).
3. **The nudge and the skills point at `mail inbox`.** The nudge switches only once the fleet's client is known to have the verb (a release-tag floor, the same shape as `RUNS_ATTRIBUTION_SINCE`).
4. **A fetched delivery stops replaying.** A `mail fetch` that the client attributes to the recipient stamps `fetchedAt`, and the 10-minute replay skips a stamped row. A printed delivery is acked, and an acked row never replays.

Every safety property of today's mail path holds (§4): who the caller is, the delivery id against the mail id, the hibernated wake budget, coordinator-first routing, the terminal-state guards, the kill switches and the closed client.

## 1. The problem, measured

Code citations are to `origin/main` `10813b401`. Line numbers are hints, and each names its function or symbol.

### 1.1 What the fleet spends

An operator-run audit of fleet transcripts (2026-10-24, 7 days, 483k model turns, price-weighted) found:

| Class | Share of fleet spend |
|---|---|
| Explicit polling, all kinds | about 7.5% |
| `ccrc-api mail list` / `fetch` / `ack` | 2.5% |
| CI and PR polling (`gh pr checks` loops, `--watch` issued again) | 3.8% |
| `sleep` loops | 0.9% |

Coordinators spend 25 to 44% of their own tokens polling. The audit saw more than 20 different ad-hoc parsers of `ccrc-api mail list` output, many of them stripping a trailing `http NNN`.

This spec addresses the mail row and the parsing. CI polling and sleep loops are out of scope (§9).

### 1.2 Where `http NNN` comes from

The client already writes the status to stderr, not stdout: `ccd/ccrc-api` ≈:584-585 (`main`'s tail) is `cat "$out"` and then `printf 'http %s\n' "$code" >&2`. It has done so since the client first landed (`git log -S` finds only that commit). Two facts explain why sessions read it as part of stdout anyway:

- Fastify sends a JSON body with no trailing newline, and `cat "$out"` adds none. So the body's last byte is `}`.
- A session's shell tool shows stdout and stderr together. The reader sees `{"ok":true,"mail":[…]}http 200` on one line, as if one stream had printed it.

So every session that wants the JSON learns to cut `http 200` off the end, or to add `2>&1` and split the text. The skill text adds to the confusion: the coordinator skill tells the reader to "redirect stderr to a file and read it there" (`ccd/coordinator-skill/SKILL.md` ≈:145-146), and the worker skill says the status "goes to stderr as `http <code>` if you ever want it" (`ccd/worker-skill/SKILL.md` ≈:199).

### 1.3 Who depends on the status line

Every caller in the tree, measured with `grep -rn` over `ccd/`, `deploy/`, `server/` and the skills:

| Caller | How it reads the client | What changes |
|---|---|---|
| `ccd/session-hook.sh#_apr_call` (≈:5062-5070) | `out=$("$apr_api" "$@" 2>&1)`, then `APR_CODE="${out##*http }"`, `APR_BODY="${out%http *}"`. Branches on the exact code (`201`, then a `case` on `APR_CODE`, ≈:5156, ≈:5174). | It must keep getting the exact code: it opts in with `CCRC_API_STATUS=line`. |
| `ccd/ccrc#_inst_approval_key` (≈:15765-15775) | `out=$("$api" approvals key 2>&1)`, then `code="${out##*http }"`, and refuses to pin unless `200`. | It opts in the same way. |
| `deploy/measure-landing.py#_api` (≈:574-596) | stdout through `json.loads`; data only on exit 0 and `ok` not `false`. | Nothing. A trailing newline parses. |
| `deploy/measure-working-state.py#ccrc_api` (≈:536-546) | The same. | Nothing. |
| `server/test/ccrc-api.test.ts` (≈:349, ≈:360, ≈:372, ≈:384, ≈:954) | Asserts `stderr` matches `^http NNN$`. | These cases run with the opt-in, and new cases pin the default. |
| `server/test/session-hook-approval-wait.test.ts` (≈:87, ≈:95), `server/test/ccrc-approval-key.test.ts` (≈:35) | Stub clients that print `http <code>` on stderr. | The stubs stay as they are, and the tests also assert the callers pass the opt-in. |
| Coordinator, worker and reviewer skills | Prose about stderr and the exit code. | Rewritten (§3.5). |

No caller branches on the exit code to tell a 2xx from a 4xx. The Python measurers treat a non-zero exit as no data, and the hook treats it as no answer. The skills say "never branch on the client's exit status" (`ccd/coordinator-skill/SKILL.md` ≈:175-177). That contract is kept (§3.1, and §8 Q1).

### 1.4 What reading one mail costs today

The nudge (`server/src/coord/envelope.ts#renderMailNudge`, ≈:166-175) teaches three verbs. The reader must:

1. run `mail list --to <id>` and parse a `MailSummary[]` (`shared/api.ts` ≈:7096), choosing `deliveryId` and not `id` (D-41);
2. for each row, run `mail fetch <deliveryId>` to get the stored envelope (`server/src/coord/routes.ts`, `GET /api/mail/:id`, ≈:1250-1264);
3. for each row, write an ack body with its own `fromId` and `fromUuid` and run `mail ack <deliveryId> --json -` (`POST /api/mail/:id/ack`, ≈:1059-1131).

That is 2n+1 calls for n messages, and each call needs the uuid that `/clear` rotates. Each call is a model turn, and each turn re-reads the session's context.

Two more costs come from the replay:

- **A delivery the reader fetched but did not ack replays every 10 minutes.** `MAIL_REPLAY_MS` is 600 000 (`shared/api.ts` ≈:10072). `CoordStore.dueDeliveries` (`server/src/coord/store.ts` ≈:5488-5510) selects a `delivered` row once `MAX(ingestedAt, deliveredAt) + MAIL_REPLAY_MS` has passed, and nothing records that the body was read. The nudge comes back up to `MAIL_REPLAY_MAX_ATTEMPTS` (20) times (`server/src/watch.ts` ≈:677), about three hours, and each one starts a turn.
- **A replay to a hibernated recipient spends a wake** (D-5242). The mail lane wakes a sleeping session with a cold `ccd ensure` (`MAIL_WAKE_FLOOR_MS`, `server/src/watch.ts` ≈:579-581), bounded fleet-wide by `wakeAdmit` (`server/src/coord/wakeBudget.ts`). A replay of mail the session already read spends that budget for nothing.

### 1.5 What the server already knows

Everything the reader assembles by hand is in `coord.db`:

- the recipient's resolved session (`mail_deliveries.toId`, resolved at queue time, so coordinator mail is already routed);
- the stored envelope (`mail_deliveries.envelope`, rendered once by `renderEnvelope`, ≈:60-97), which L0 can parse back (`shared/api.ts#parseMailEnvelope`, ≈:5452, into `MailEnvelope`, ≈:5400);
- the ack door's own guard (`store.ts#writeDelivery`, ≈:5373-5376): a row is ackable when its state is not terminal, or when it is exactly the replay-ceiling park (orchestrator ruling I2(b)).

The client only needs a list it can print and a delivery id for each entry, given by the server and never parsed out of text.

## 2. Goals and non-goals

**Goals.**
- One call reads and acks all of a session's unread mail.
- The client's stdout is machine-readable with no cleanup: the body, then one newline.
- A delivery that was shown to the session is never replayed.
- A delivery the session did not see is never acked, and is never kept from replaying.

**Non-goals.**
- No change to how mail is sent, queued, gated, delivered, parked or rejected.
- No change to who may read whose mail through `mail list` or `mail fetch`. Both stay token-gated reads with no attribution check, and the PWA and the measurers keep them.
- No push channel and no long-poll. The nudge stays the wake-up.
- CI and PR polling, and sleep loops (§9).

## 3. Design

### 3.1 Clean output (`ccrc-api`, every row)

**stdout is the body, then exactly one newline.** After `cat "$out"`, the client prints a `\n` unless the body is empty or already ends in one. Callers that read through `json.loads`, `jq` or `JSON.parse` are unaffected.

**stderr is quiet on an answer unless the caller asks.** The rules:

| Situation | stdout | stderr | Exit |
|---|---|---|---|
| 2xx answer | body + `\n` | nothing | 0 |
| non-2xx answer | body + `\n` | `ccrc-api: the server answered <code>` | 0 |
| any answer, `CCRC_API_STATUS=line` | body + `\n` | `http <code>`, the last line, exactly as today | 0 |
| local refusal (`refuse`) | the JSON refusal envelope | the human sentence, as today | 2 |
| no response (transport) | `{"ok":false,"error":"transport",…}` | as today | 3 |

Why this shape:

- **The opt-in is an environment variable, not a flag.** An old client ignores the variable and still prints `http <code>`, so a caller that sets it works against both builds. A flag would be refused as `unknown-query` by every older client (`main`'s generic `--*` arm, ≈:405-423). The variable carries no URL, host or path, so the client stays closed (`server/test/ccrc-api-closed.test.ts`).
- **The non-2xx line is prefixed** (`ccrc-api: …`) so that nobody mistakes it for the machine line. It is the one case where a reader benefits from seeing the code, because a non-2xx body is not always typed (a 404 from the router, a bare `{"ok":false,"stderr":…}` 502).
- **Exit codes do not change.** "The client exits 0 whenever a response arrived" is a contract three skills teach and two measurers rely on. A non-zero exit on a 4xx would turn every refusal into a failed tool call in the reader's transcript and invite retries. Q1 asks the operator whether to change it anyway.

**Callers that need the code opt in first** (`_apr_call`, `_inst_approval_key`). They land before the default changes (plan wave 1), so an install that briefly has a new hook and an old client, or the reverse, still parses.

### 3.2 `mail inbox`: the server selects, the client prints and acks

**Decision.** A new read route, `GET /api/mail/inbox`, selects and renders the caller's unread deliveries. The client prints each entry and then acks it through the existing `POST /api/mail/:id/ack`, one delivery at a time.

Why not a route that acks on read:
- The server cannot know that a print succeeded. A closed pipe, a killed tool call or a truncated display would ack mail nobody saw. That is the one loss this lane must never cause.
- It would be a second writer of `acked` beside `markAcked`. D-5997 keeps one writer of `mail_deliveries` (`writeDeliveries`, pinned by `mail-hardening.test.ts`'s census), and the ack route's ladder (registry re-measure, `toId` check, park answers) would need a copy.

Why not a client loop over `list`, `fetch` and `ack`:
- `GET /api/mail?to=` answers "outstanding or abandoned" (`OUTSTANDING_OR_ABANDONED_SQL`), and some of those rows refuse an ack (a park-ceiling rejection, `markAcked` answers `parked`). A loop would print them on every call, forever.
- The list is unattributed. Anyone with the box token can read any session's list, so a loop could drain somebody else's mailbox by mistake.
- It costs 2n+1 round trips, and it would put rendering decisions in bash. The repo's rule is "decide in L1, act in L4": the renderer belongs beside `renderEnvelope`.

So the server decides what is shown and how. The client acts: it prints, and it acks only what it printed.

### 3.3 The inbox route

`GET /api/mail/inbox?fromId=<id>&fromUuid=<uuid>`, gated like the other mail reads:

1. `requireMailToken` (box token; 401 `unauthenticated` without it).
2. `attributionVerdict(fromId, fromUuid, 'fromUuid')` (`routes.ts` ≈:643-672), the check the ack route and `POST /api/runs` already share. A refusal is `registry-unmeasurable`, `unknown-sender` or `stale-uuid`, with the same statuses, and is recorded like any mail refusal.
3. Select the caller's ackable deliveries, **oldest first**: `toId = fromId` and the ack door's guard (§1.5). The guard is hoisted into one named SQL fragment that both `writeDelivery`'s `'ack'` arm and this select use, so the set printed is the set the ack accepts, by construction.
4. Render each one (§3.4), mask it (D-5513, the same `maskDeep` the fetch route uses), and add entries in order until the page budget is reached. The budget is `MAIL_INBOX_PAGE_MAX_BYTES`, 20 KiB of rendered text (L0), and a page always holds at least one entry, so one oversized entry still goes out.
5. Answer `200 {ok: true, deliveries: [{deliveryId, text}], remaining, abandoned}`:
   - `remaining` is the number of ackable deliveries the budget left out;
   - `abandoned` is the number of outstanding rows that are not ackable (in `outstandingMailFor` but not in the ackable set), so the reader learns they exist without being shown them on every call.

Reasons for the details:
- **Oldest first,** so that a session reads a wave's mail in the order it was sent. `mail list` is newest first because it is a status view.
- **A page budget,** because a session's shell tool truncates long output, and an acked entry the reader never saw is the same loss as an ack on read. Twenty KiB holds two bodies at `MAIL_BODY_MAX_BYTES` (8 KiB, `shared/api.ts` ≈:5072) with their headers. The limit is a Claude Code setting the operator controls (Q5).
- **Queued and parked rows are included.** A row the nudge has not reached yet, or one parked behind a draft (D-5838), is still mail for this session. Reading it early is the cheapest way to deliver it. An ack makes the lane skip it.
- **No `mail-disabled` check.** That marker stops the delivery lane. Reading and acking already work under it, as `fetch` and `ack` do today.
- **The path,** `/api/mail/inbox`, sits in the mail lane's tables (`auth/gate.ts`'s `EXEMPT`, the box-token census) beside `GET /api/mail/:id`. Fastify matches a static segment before a parameter, so `inbox` never reaches `:id`. An older server answers `400 bad-request` from `:id`, and the client reports that as "this server has no inbox" (§3.5).

### 3.4 What an entry looks like

The entry is rendered from the **stored envelope**, parsed back with `parseMailEnvelope`, so it shows what was queued (program and wave as they were at queue time) and keeps `renderEnvelope`'s "rendered once, never re-rendered" rule for every field it carries. Only the `ack:` instruction is left out, because the inbox acks for the reader. If the envelope does not parse (`malformed`), the stored text is printed verbatim, never dropped.

`````text
````ccrc-inbox
delivery: 412
from: project-a-worker
kind: status
subject: wave-done
run: 88 (program:demo wave 2/4)
artifacts:
  /abs/path/to/ledger.md
--
Wave 2 is on the branch. Handoff commit is the ledger update; the PR is green.
````
`````

- **A fence longer than any backtick run inside the entry** (`fenceFor`'s rule, `envelope.ts` ≈:21-25), so a body cannot close the block and forge another entry or an "acked" line.
- **A different info string** (`ccrc-inbox`, not `MAIL_ENVELOPE_FENCE`), so the PWA's transcript parser (`pwa/src/session/chatItems.ts` ≈:178) never reads an inbox print as a delivered envelope.
- **`delivery:` names the delivery id,** the only id on the entry. The mail row's own id is not printed, so there is nothing to confuse it with (D-41).

### 3.5 The client verb

`ccrc-api mail inbox` takes no argument and no flag.

1. **Identity from the pane.** `derive_identity` (`TMUX_PANE` gate, `SAFE_RE`, `$REG/<id>.uuid`), as `asks list` and `approvals show` already do. There is no `--to`: a session reads only its own inbox. Outside a pane it refuses `no-pane`, as `whoami` does.
2. **Read.** One `GET /api/mail/inbox` with the derived pair in the query, through the same curl call every row uses (token on curl's stdin, R16).
3. **For each entry, in order:** print its `text` and a newline to stdout. If the print fails (a write error, or SIGPIPE ends the process), stop: this entry and every later one stay unacked. Otherwise ack it: `POST /api/mail/<deliveryId>/ack` with the body `{"fromId":"<id>","fromUuid":"<uuid>"}` built from the derived pair (both `SAFE_RE`-checked, so no quote can break out). Then print one line after the closing fence:
   - `inbox: acked delivery 412`;
   - `inbox: delivery 412 was already acked` (`already: true, parked: false`, for example a second `mail inbox` running at the same time);
   - `inbox: delivery 412 was closed before this ack (<lastError>); nothing is owed` (`parked: true`);
   - `inbox: delivery 412 is NOT acked (<error or transport>); it will be shown again`.
4. **Footer:** `inbox: N printed, M acked`, then `inbox: R more unread; run mail inbox again` when `remaining > 0`, and `inbox: A abandoned deliveries are not shown; mail list --to <id> lists them` when `abandoned > 0`. An empty inbox prints `inbox: no unread mail`.
5. **A read that is not a 200** prints the body and `inbox: the server did not serve the inbox (http <code>); if it predates mail inbox, read with mail list, fetch and ack` on stdout, acks nothing, and exits 0.

**Exit codes** follow §3.1: 0 when the read answered, whatever happened to the acks (each outcome is on stdout), 2 for a local refusal, 3 when the read got no response. A transport failure on one ack does not change the exit code: the entry is reported NOT acked and replays as usual.

**stdout is plain text for this verb only.** The usage text, the README and the skills say so. Every other row keeps the JSON body.

**`jq` is required by this verb only.** The client parses the inbox answer with `jq`. Every fleet box already has it: the session hook does nothing without it (`ccd/session-hook.sh` ≈:2877), and `ccrc version` refuses to run without it (`ccd/ccrc` ≈:2950). Without it the verb refuses `no-jq` before any request. The other rows stay `jq`-free.

**`mail fetch` sends identity too.** Inside a pane, the client fills `fromId` and `fromUuid` from it on `mail fetch`, so a fetch by the recipient stamps the row (§3.6). A pane whose identity cannot be derived refuses, as `whoami` does. A caller with no pane at all fetches unattributed, as today.

### 3.6 A fetched or printed delivery stops replaying

**`mail_deliveries.fetchedAt`** (coord.db migration 30, a nullable `INTEGER`). It is written through `writeDelivery` with the `'non-terminal'` guard and `COALESCE(fetchedAt, ?)`, so the first stamp stands and a terminal row is never touched.

**`GET /api/mail/:id` stamps only an attributed fetch by the recipient.** When the query carries `fromId` and `fromUuid`, the route runs the same `attributionVerdict` and checks that `toId = fromId`, then stamps. The envelope is served either way: an attribution failure never narrows today's read. The answer gains a positive marker, `fetch`: `'stamped'`, `'unattributed'` (no pair), `'not-yours'` (another session, or a pair the registry refuses, with the refusal code in `fetchRefused`) or `'unmeasured'` (registry unreadable). An older server sends no marker, and its absence means "not stamped".

**The replay arm skips a stamped row.** `dueDeliveries`'s `delivered` arm gains `AND fetchedAt IS NULL`. The `queued` arm (first delivery, park retries) is unchanged.

**A printed delivery is acked,** and an acked row is terminal, so it never replays. A delivery printed but not acked (the ack failed) is **not** stamped. It replays, and the next `mail inbox` prints it again. That is deliberate: a repeated nudge costs one turn, while a silenced one can lose a brief.

Consequences, checked against every reader:

| Reader | Effect of a stamped, unacked row |
|---|---|
| `MAIL_REPLAY_MAX_ATTEMPTS` (`watch.ts` ≈:8070-8083) | It stops counting, so the row never parks as `undeliverable`. It stays `delivered` and outstanding until it is acked, or until `cancelOutstandingDeliveries` parks it when its run closes. Q2 asks whether one late reminder is wanted. |
| The stall watch's coord-deaf arm (`server/src/coord/stall.ts#stallDeafMail`, ≈:929-958) | `deafSince` is `deliveredAt − replayCount × MAIL_REPLAY_MS`. With no further replays, both terms stop moving, so the estimate stays at or after the first delivery, as its docstring requires. A coordinator that fetched a `wave-done` and never acked it is still reported deaf at `COORD_DEAF_MS`. |
| The `ingestedAt` edge (`sweepMail`, ≈:7503-7532) | Unchanged. It still samples every `delivered` row. |
| The hibernated wake (D-5242) | A stamped row no longer wakes a sleeping recipient. `wakeAdmit` is untouched. |
| `MailStrip`, `unreadMail`, `mail list` | Unchanged. The row is still unacked, so it is still shown. |

### 3.7 The nudge and the skills

**The nudge has two forms, chosen at send time.**
- The inbox form: `ccrc-mail: you have new mail. Read it with ~/.local/bin/ccrc-api mail inbox, by that exact path, since ~/.local/bin is not on this unit's PATH. It prints every unread mail addressed to you and acks each one it printed. Use the client, never curl or raw HTTP; it resolves the server address and reads the box token itself.`
- Today's form, unchanged, for a fleet whose client predates the verb.

`fleetCarriesMailInbox(role, own, fleet)` chooses, in the shape of `fleetCarriesRunsAttribution` (`server/src/fleetstate.ts` ≈:249-278): `true` on a `both` box, when the builds agree, or when the fleet stamp's release tag is at or past `MAIL_INBOX_SINCE` (L0, set to the release that ships the client verb). Anything else keeps today's form.

- **Why a floor and not the date of a merge:** the nudge is the only protocol text guaranteed current in the recipient's pane (`envelope.ts` ≈:132-136). A nudge naming a verb the box's client refuses is the wedge D-791 describes, again.
- **The 24-character head is byte-identical** (`ccrc-mail: you have new `), so `sendPrompt`'s echo needle does not move. The inbox form carries no `toId`, because the client derives identity from the pane.
- **The park's own-nudge check accepts both forms.** `sweepMail` resumes a parked box only when it holds exactly the lane's own nudge (`watch.ts` ≈:8052, `box !== renderMailNudge(d.toId)`). A row parked under one form and retried under the other must still match, so the check reads "either form the lane may have typed".

**The skills, references and README teach `mail inbox` first,** and keep `list`, `fetch` and `ack` as the fallback for a server without the route:
- `ccd/worker-skill/SKILL.md`: "Reading mail is three calls, not one" (≈:218-222) becomes one call. The pinned ack clause (`worker-skill.test.ts` ≈:60) still says "ack before you act", and now says that `mail inbox` does it. Its "replays `MAIL_REPLAY_MAX_ATTEMPTS` (20) times" half becomes true only of a delivery nobody fetched.
- `ccd/coordinator-skill/SKILL.md`: clause 3 "Wake on mail" (≈:291-299), and the stdout and exit-code paragraphs (≈:141-155).
- `ccd/reviewer-skill/SKILL.md`: the ack clause (`reviewer-skill.test.ts` ≈:22) and the exit-code sentence (≈:143).
- `ccd/coordinator-skill/references/wave-lifecycle.md` §3 and `references/mail-envelope.md`, which quote the old nudge and teach the three calls.
- `README.md`: the client's verb list (≈:3616) and its mail paragraphs.

The pinned clauses change in the same PR as their tests. A clause is a mechanism here, not a comment.

**Unchanged on purpose:**
- The envelope's `ack:` lines (`renderEnvelope`, ≈:84-87), because a `fetch` reader still needs them, and stored envelopes are never re-rendered.
- The hold card's `mail list --to <id>` (`ccd/session-hook.sh` ≈:917). It is a read-only pointer, and pointing it at `mail inbox` would ack a brief from a diagnostic card.

## 4. Safety: what is kept, and how

- **The caller's identity.** The inbox and the ack it drives use the pane-derived pair only: `TMUX_PANE` validated as a pane id, the session name held to `SAFE_RE`, the uuid read from `$REG/<id>.uuid`. No flag selects another session. The server re-measures the pair against the registry (`attributionVerdict`) and selects only rows whose resolved `toId` is the caller. Identity on this fleet is attribution, not authentication, and this is as strong as the ack route, no stronger (CLAUDE.md, SAFETY).
- **Delivery id, never mail id.** The server hands the client each `deliveryId` as a JSON number. The client never parses an id out of rendered text, and the entry prints only the delivery id.
- **The hibernated wake budget.** No new wake source. The inbox runs only in a session that is awake. Its acks, and a recipient's stamped fetch, can only remove automatic wakes. `wakeAdmit`, `WAKE_BURST` and `MAIL_WAKE_FLOOR_MS` are unchanged.
- **Coordinator-first routing (D-5298).** Coordinator mail is resolved to a session when it is queued, so the inbox reads it like any other. Approval nudges (`approval:<id>`) and ask nudges (`ask:<n>`) are ordinary rows. Acking one changes no approval or ask state: no approvals-lane or asks-lane code reads `ackedAt`, measured with `grep -rln ackedAt server/src` (the only readers are `watch.ts`, `stall.ts`, `store.ts` and `schema.ts`). The coordinator still rules through `approvals rule`. The 180-second late-answer window is a property of the approvals lane, which this spec does not touch.
- **Terminal states.** The ack goes through `markAcked` and its single `WHERE` (D-1410, I2(b)). The stamp goes through `writeDelivery` with the `'non-terminal'` guard. `writeDeliveries` stays the one writer (D-5997), and the census gains the new method by name. An out-of-vocabulary state token is treated exactly as `markAcked` treats it today. That question stays open (D-1406), and this spec does not decide it.
- **Kill switches.** `mail-disabled`, `mail-gate-strict` and the stall-watch markers keep their meanings. None gains a writer.
- **The closed client.** One new row (`mail.inbox`, a fixed path, no caller text in the URL beyond the `SAFE_RE`-checked pair the client derives itself). The token rides curl's stdin on every request, the read and each ack. The row count in the header and at `ROUTES` becomes thirty-two, and `ccrc-api-closed.test.ts`'s body-fill census names the synthesized ack body.
- **Masking.** Every rendered entry goes through the same masker as `GET /api/mail/:id` (D-5513) before it leaves the server.
- **Fail toward showing, never toward acking.** A failed print stops the loop with nothing acked after it. A failed ack leaves the row unacked and unstamped. An envelope that does not parse is printed verbatim. A registry that cannot be read refuses the read, and nothing is acked.

## 5. Rings and contexts

- **L0 (`shared/api.ts`):** `MAIL_INBOX_PAGE_MAX_BYTES`, `MAIL_INBOX_SINCE`, the wire types `MailInboxEntry` and `MailInboxAnswer`, and the fetch marker words. Nothing is imported.
- **L1:** `renderInboxEntry` beside `renderEnvelope` (`server/src/coord/envelope.ts`, pure). The page cut, `pageInbox(entries, budget)`, is pure too. `fleetCarriesMailInbox` sits beside `fleetCarriesRunsAttribution`.
- **L3 (`CoordStore`):** `inboxFor(toId)`, `markFetched(id, at)` and the hoisted ackable guard. All synchronous, with no repository layer (CLAUDE.md, Coordination).
- **L4 (`routes.ts`, `watch.ts`):** the inbox route, the fetch stamp, and the nudge choice at send time. Delivery code composes and decides nothing.
- **Context:** Coordination (mail). Nothing crosses into another context.
- **Consolidation:** no second mechanism. One renderer family (`envelope.ts`), one ack door, one attribution check, one writer, one replay predicate, and one fleet-capability shape. The ackable predicate is hoisted and shared, not copied.

## 6. Wire and deploy

- **New route:** `GET /api/mail/inbox`, box-token gated, in `auth/gate.ts`'s `EXEMPT` with its reason, and in the box-token census.
- **Additive fields:** `fetch` on `GET /api/mail/:id`'s answer; `fromId` and `fromUuid` accepted in its query.
- **coord.db:** migration 30 adds `mail_deliveries.fetchedAt`. An older server reads a newer database (`db.ts`'s rule for a higher `user_version`) and ignores the column, so a rollback replays fetched rows again. That is the safe direction.
- **No `FLEET_PROTO` bump.** Nothing new rides the agent link.
- **Order** (plan §Waves): the callers' opt-in (fleet), then the clean default (fleet), then the server half (route, stamp, replay predicate), then the client verb and the skills (fleet, released only once the server runs the route), then the nudge switch (server, its floor set to the client verb's release tag).

## 7. Alternatives rejected

- **Ack on read in the server.** It acks what the reader never saw (§3.2).
- **A client loop over list, fetch and ack.** It reprints rows that cannot be acked, reads an unattributed list, and moves rendering into bash (§3.2).
- **Delete the stderr status line outright.** Two in-tree parsers need the exact code, and the opt-in costs one line.
- **A `--status` flag.** Every older client refuses it as `unknown-query`, which breaks the hook during an install window. An environment variable is ignored by old clients.
- **Map 4xx and 5xx to non-zero exit codes now.** It breaks a contract three skills teach and turns refusals into failed tool calls. It is left to the operator (Q1).
- **Server-rendered `text/plain` with length-prefixed frames,** to keep the client `jq`-free. Reading byte counts in bash is fragile with multi-byte text, and every fleet box already has `jq` (§3.5).
- **Stamp `fetchedAt` when the inbox reads a row.** A print that then fails would silence the replay of mail nobody saw.
- **Stop replay at the `UserPromptSubmit` edge.** That edge proves a turn started, not that the mail was read. It already moves the replay clock, and that stays.
- **Re-render the entry from the mail row's columns.** The stored envelope is the record of what was queued, and the inbox shows it.

## 8. Questions for the operator

1. **Exit codes.** Keep "exit 0 whenever a response arrived" (recommended: three skills, two measurers and the hook depend on it, and a non-zero exit invites retries), or move a 4xx to exit 4 and a 5xx to exit 5, keeping the body on stdout?
2. **A fetched delivery that is never acked.** No replay at all (recommended: the stall watch still reports a deaf coordinator, and `MailStrip` still shows the row), or one reminder after a longer interval, for example 60 minutes?
3. **The old verbs in the skills.** Keep `list`, `fetch` and `ack` documented as the fallback for a server without the route (recommended), or drop them from the skills once every box carries the verb?
4. **The non-2xx stderr line.** Keep `ccrc-api: the server answered <code>` by default (recommended), or make stderr silent on every answer unless `CCRC_API_STATUS=line` is set?
5. **The page budget.** Twenty KiB assumes the shell tool shows at least that much before it truncates. Is any account on the fleet configured with a lower output limit? If so, the budget should be lower.
6. **The acceptance bar.** Re-run the transcript audit seven days after the nudge switch. What share for mail reading counts as done (for example, under 0.5% of fleet spend), and should coordinators' polling share be a second bar?
7. **CI and PR polling (3.8%).** Is a follow-up spec wanted, for example a server-side watch that mails the coordinator when a PR's required checks finish, so that `gh pr checks` loops end?

## 9. Out of scope and follow-ups

- CI and PR polling, and sleep loops (Q7). The same rule applies: the server already measures PR state (`.prhistory`, the PR sweep), so a mail on a state change would replace a poll.
- Showing "read, not acked" in `MailStrip`. `fetchedAt` makes it measurable, and adding it to `MailSummary` is one additive field. It is left for a PWA task.
- Retiring the envelope's `ack:` instruction. That waits until no reader uses `fetch`.

## 10. Review log

**rev 0 (2026-10-24).** Written against `origin/main` `10813b401`. The task said the client prints `http NNN` on stdout. The code shows stderr since its first commit (§1.2), and §3.1 is written for what the code does.

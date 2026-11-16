# Mail inbox and clean client output

**Spec** · 2026-10-24 · Status: draft for review, rev 3 (re-scoped to the minimum) · Owner: the ccrc coordinator · Deviation: D-6772 (issued by the ledger) · Plan: `docs/superpowers/plans/2026-10-24-mail-inbox.md`

**Related:** `2026-08-26` closed client (`docs/superpowers/plans/2026-08-26-ccrc-api.md`), the robust-mail-delivery reference nudge (`server/src/coord/envelope.ts#renderMailNudge`, D-738, D-791), D-41 (delivery id against mail id), D-5298 (coordinator-first routing: approval nudges ride mail), D-5513 (masking before text leaves the server), D-5997 (one writer of `mail_deliveries`).

## In short

Reading mail costs a session three client calls per message and a hand-written parser each time. The fleet's transcript audit puts that at 2.5% of all spend, and the server already knows everything the reader needs. This spec is the minimum that removes the calls and the parsers. It does three things:

1. **Clean output.** `ccrc-api` writes only the response body to stdout, always ending in a newline. The `http <code>` line it writes on stderr today stays available to every existing caller until a release carrying the new client is installed. Only then do the two in-tree callers that read it move to an explicit opt-in (`CCRC_API_STATUS=line`), and only once that move is installed does the line stop by default. Exit codes do not change.
2. **`ccrc-api mail inbox`.** One call prints every unacked delivery addressed to the calling session (from, to, kind, subject, run, artifacts, body), one bounded page at a time, and then acks exactly the deliveries it printed, one ack per delivery, through today's ack route with today's attribution. A delivery whose print or ack fails stays unacked. When stdout is a shell pipe or `/dev/null`, it prints and acks nothing, and says to run it bare.
3. **The nudge and the skills point at `mail inbox` first,** and say to run it bare. `mail list`, `fetch` and `ack` stay documented as the fallback. The nudge switches only once the fleet's client carries the verb (a release-tag floor).

Nothing here changes when, how often or to whom the server replays a nudge. Every change that would (a fetched-at stamp, replay suppression, the hibernated-wake skip) and the PWA's inbox cards are deferred to **Later** (§9).

## 1. The problem, measured

Code citations are to `origin/main` `7a3104abd`. Line numbers are hints, and each names its function or symbol.

### 1.1 What the fleet spends

An operator-run audit of fleet transcripts (2026-10-24, 7 days, 483k model turns, price-weighted) found:

| Class | Share of fleet spend |
|---|---|
| Explicit polling, all kinds | about 7.5% |
| `ccrc-api mail list` / `fetch` / `ack` | 2.5% |
| CI and PR polling (`gh pr checks` loops, `--watch` issued again) | 3.8% |
| `sleep` loops | 0.9% |

Coordinators spend 25 to 44% of their own tokens polling. The audit saw more than 20 different ad-hoc parsers of `ccrc-api mail list` output, many of them stripping a trailing `http NNN`.

This spec addresses the mail row and the parsing. CI polling and sleep loops are out of scope (§10).

### 1.2 Where `http NNN` comes from

The client already writes the status to stderr, not stdout: `ccd/ccrc-api` ≈:584-585 (`main`'s tail) is `cat "$out"` and then `printf 'http %s\n' "$code" >&2`. It has done so since the client first landed (`git log -S` finds only that commit). Two facts explain why sessions read it as part of stdout anyway:

- Fastify sends a JSON body with no trailing newline, and `cat "$out"` adds none. So the body's last byte is `}`.
- A session's shell tool shows stdout and stderr together. The reader sees `{"ok":true,"mail":[…]}http 200` on one line, as if one stream had printed it.

**Where the tool's output goes, measured.** Under the Claude Code Bash tool (Claude Code 2.1.308, darwin, 2026-10-24), fd 1 and fd 2 of a command are **one regular file**: `[[ -f /dev/stdout ]]` is true, `[[ -p /dev/stdout ]]` is false, and `stat -L` gives fd 1 and fd 2 the same inode. The tool captures to a file and reads it back. So a bare command's write lands in the tool's capture, and the same command run as `cmd | tail` or `$(cmd)` sees a pipe (`-p` true), because a shell pipeline is a `pipe(2)`. A child that Node spawns with piped stdio (`server/test/ccrc-api.test.ts` ≈:102, `spawn(CCRC_API, args, { env })`) sees neither: the probe reads it as a socket, not a FIFO. §3.5 builds on these three shapes, and plan MI-6 Step 0 re-measures them on the fleet's own build.

So every session that wants the JSON learns to cut `http 200` off the end, or to add `2>&1` and split the text. The skill text adds to the confusion: the coordinator skill tells the reader to "redirect stderr to a file and read it there" (`ccd/coordinator-skill/SKILL.md` ≈:146-147), and the worker skill says the status "goes to stderr as `http <code>` if you ever want it" (`ccd/worker-skill/SKILL.md` ≈:200).

### 1.3 Who depends on the status line

Every caller in the tree, measured with `grep -rn` over `ccd/`, `deploy/`, `server/` and the skills:

| Caller | How it reads the client | What changes |
|---|---|---|
| `ccd/session-hook.sh#_apr_call` (≈:5062-5070) | `out=$("$apr_api" "$@" 2>&1)`, then `APR_CODE="${out##*http }"`, `APR_BODY="${out%http *}"`. Branches on the exact code (`201`, then a `case` on `APR_CODE`, ≈:5156, ≈:5174). | Nothing at first: the new client still writes the line. Once a release carrying the new client is installed, it opts in with `CCRC_API_STATUS=line` (§3.1). |
| `ccd/ccrc#_inst_approval_key` (≈:15765-15775) | `out=$("$api" approvals key 2>&1)`, then `code="${out##*http }"`, and refuses to pin unless `200`. | The same, at the same time. |
| `deploy/measure-landing.py#_api` (≈:574-596) | stdout through `json.loads`; data only on exit 0 and `ok` not `false`. | Nothing. A trailing newline parses. |
| `deploy/measure-working-state.py#ccrc_api` (≈:536-546) | The same. | Nothing. |
| `server/test/ccrc-api.test.ts` (≈:349, ≈:360, ≈:372, ≈:384, ≈:954) | Asserts `stderr` matches `^http NNN$`. | Unchanged until the default goes quiet; then these cases run with the opt-in, and new cases pin the default. |
| `server/test/session-hook-approval-wait.test.ts` (≈:87, ≈:95), `server/test/ccrc-approval-key.test.ts` (≈:35) | Stub clients that print `http <code>` on stderr. | The stubs stay as they are, and the tests also assert the callers pass the opt-in. |
| Coordinator, worker and reviewer skills | Prose about stderr and the exit code. | Rewritten (§3.1, §3.7). |

No caller branches on the exit code to tell a 2xx from a 4xx. The Python measurers treat a non-zero exit as no data, and the hook treats it as no answer. The skills say "never branch on the client's exit status" (`ccd/coordinator-skill/SKILL.md` ≈:176-178). That contract is kept (§3.1, and §8 Q1).

### 1.4 What reading one mail costs today

The nudge (`server/src/coord/envelope.ts#renderMailNudge`, ≈:166-175) teaches three verbs. The reader must:

1. run `mail list --to <id>` and parse a `MailSummary[]` (`shared/api.ts` ≈:7096), choosing `deliveryId` and not `id` (D-41);
2. for each row, run `mail fetch <deliveryId>` to get the stored envelope (`server/src/coord/routes.ts`, `GET /api/mail/:id`, ≈:1250-1264);
3. for each row, write an ack body with its own `fromId` and `fromUuid` and run `mail ack <deliveryId> --json -` (`POST /api/mail/:id/ack`, ≈:1059-1131).

That is 2n+1 calls for n messages, and each call needs the uuid that `/clear` rotates. Each call is a model turn, and each turn re-reads the session's context.

A delivery that was fetched but not acked replays every 10 minutes (`MAIL_REPLAY_MS`, `shared/api.ts` ≈:10072), up to 20 times. One call that prints and acks removes most of those fetched-but-unacked rows at the source. Changing the replay itself is deferred (§9).

### 1.5 What the server already knows

Everything the reader assembles by hand is in `coord.db`:

- the recipient's resolved session (`mail_deliveries.toId`, resolved at queue time, so coordinator mail is already routed);
- the stored envelope (`mail_deliveries.envelope`, rendered once by `renderEnvelope`, ≈:60-97), which L0 can parse back (`shared/api.ts#parseMailEnvelope`, ≈:5452, into `MailEnvelope`, ≈:5400);
- the ack door's own guard (`store.ts#writeDeliveries`, ≈:5373-5375): a row is ackable when its state is not terminal, or when it is exactly the replay-ceiling park (orchestrator ruling I2(b)). The guard reads no run, so it admits a replay-ceiling park whatever its run's state;
- the mailbox's read predicate (`OUTSTANDING_OR_ABANDONED_SQL`, ≈:1452-1453, over `ABANDONED_PARK_SQL`, ≈:1353-1356), which hides that same park once its run is terminal (ruling I2(a): the run closing makes it moot). `outstandingMailFor` (≈:5152-5160) reaches it through `LEFT JOIN runs rr`.

The two sets differ, and the inbox needs both (§3.3 step 3). The client only needs a list it can print and a delivery id for each entry, given by the server and never parsed out of text.

## 2. Goals and non-goals

**Goals.**
- One call reads and acks all of a session's unacked mail, a bounded page at a time.
- The client's stdout is machine-readable with no cleanup: the body, then one newline.
- No install, skip or rollback order leaves a caller that reads the status line with a client that does not write it.
- **Nothing is acked whose write failed.** That is the invariant, and it is all a client can know: a write that succeeded reached fd 1, not necessarily a reader. Two measured guards narrow the gap (§3.5): nothing is acked when fd 1 is a shell pipe or `/dev/null`, and the footer names every delivery that was acked. What is left, a redirect to a file, is named in §4.

**Non-goals.**
- No change to how mail is sent, queued, gated, delivered, replayed, parked or rejected. The replay clock, its ceiling and the wake budget are untouched (§9 lists what was deferred).
- No change to who may read whose mail through `mail list` or `mail fetch`. Both stay token-gated reads with no attribution check, and the PWA and the measurers keep them.
- No new PWA rendering. The transcript's mail cards for `mail fetch` stay as they are; inbox cards are deferred (§9).
- No push channel and no long-poll. The nudge stays the wake-up.
- CI and PR polling, and sleep loops (§10).

## 3. Design

### 3.1 Clean output (`ccrc-api`, every row), in three installed steps

**The end state.**

| Situation | stdout | stderr | Exit |
|---|---|---|---|
| 2xx answer | body + `\n` | nothing (the inbox verb's notes go to stdout, §3.5) | 0 |
| non-2xx answer | body + `\n` | `ccrc-api: the server answered <code>` | 0 |
| any answer, `CCRC_API_STATUS=line` | body + `\n` | `http <code>`, the last line, exactly as today | 0 |
| local refusal (`refuse`) | the JSON refusal envelope | the human sentence, as today | 2 |
| no response (transport) | `{"ok":false,"error":"transport",…}` | as today | 3 |

**stdout is the body, then exactly one newline.** After `cat "$out"`, the client prints a `\n` unless the body is empty or already ends in one. Callers that read through `json.loads`, `jq` or `JSON.parse` are unaffected, and `_apr_call`'s `${out%http *}` cut keeps working, because the newline sits before the status line.

**The compatibility rule.** The `http <code>` line stays on stderr, by default, for every existing caller, until a release carrying the new client is installed on every box that hosts sessions. The order is three steps, each gated on the previous one being **installed**, never on it being merged:

1. **The client (plan MI-1).** The newline, and `CCRC_API_STATUS` recognized. The default is unchanged: `http <code>` on stderr, on every answer. Any hook, old or new, keeps parsing.
2. **The callers (plan MI-2), once a release carrying step 1 is installed.** `_apr_call` and `_inst_approval_key` run the client with `CCRC_API_STATUS=line`. The parse does not change.
3. **The quiet default (plan MI-3), once a release carrying step 2 is installed.** The table above.

**Why installed and not merged.** A merge order is not an install order, for two measured reasons:
- `ccrc install` puts the client in place before the hook: `_inst_bins` writes `~/.local/bin/ccrc-api`, and `_inst_files` writes `~/.cc-sessions/session-hook.sh` after it (`ccd/ccrc#_inst_files` ≈:15739). An install that stops between the two leaves a new client with the old hook.
- A box may skip releases. A box that went from a release before step 2 straight to a release carrying step 3 would run the quiet client with a hook that never opted in, from `_inst_bins` until `_inst_files`, or for good if the install stopped there.

Gating step 3 on step 2 being installed closes both: by the time a quiet client can reach a box, that box already runs a hook that opts in. Step 2's own gate is not needed for safety, because an older client ignores the variable and writes the line anyway. It is kept so that the rule has one direction: a caller is changed only against a client the fleet already runs. The installed release is read from the fleet node's row in `GET /api/updates` (`server/src/update/routes.ts` ≈:581, the PWA's Updates screen), or from `ccrc update --check` on that box.

A rollback is safe at every step: `ccrc rollback` reinstalls an older client and hook together, an older client writes the line whatever the variable says, and an opted-in hook reads it.

Why this shape:
- **The opt-in is an environment variable, not a flag.** An old client ignores the variable and still prints `http <code>`, so a caller that sets it works against both builds. A flag would be refused as `unknown-query` by every older client (`main`'s generic `--*` arm, ≈:405-423). The variable carries no URL, host or path, so the client stays closed (`server/test/ccrc-api-closed.test.ts`).
- **The non-2xx line is prefixed** (`ccrc-api: …`) so that nobody mistakes it for the machine line. It is the one case where a reader benefits from seeing the code, because a non-2xx body is not always typed (a 404 from the router, a bare `{"ok":false,"stderr":…}` 502). Q2 asks whether to keep it.
- **Exit codes do not change.** "The client exits 0 whenever a response arrived" is a contract three skills teach and two measurers rely on. A non-zero exit on a 4xx would turn every refusal into a failed tool call in the reader's transcript and invite retries. Q1 asks the operator whether to change it anyway.

### 3.2 `mail inbox`: the server selects, the client prints and acks

**Decision.** A new read route, `GET /api/mail/inbox`, selects and renders the caller's unacked deliveries. The client prints each entry and then acks it through the existing `POST /api/mail/:id/ack`, one delivery at a time.

Why not a route that acks on read:
- The server cannot know that a print succeeded. A closed pipe, a killed tool call or a truncated display would ack mail nobody saw. The client cannot know that a reader saw it either, but it does know whether its write failed and where fd 1 points (§1.2), and the server knows neither.
- It would be a second writer of `acked` beside `markAcked`. D-5997 keeps one writer of `mail_deliveries` (`writeDeliveries`, pinned by `mail-hardening.test.ts`'s census), and the ack route's ladder (registry re-measure, `toId` check, park answers, recorded refusals) would need a copy.

Why not a client loop over `list`, `fetch` and `ack`:
- `GET /api/mail?to=` answers "outstanding or abandoned" (`OUTSTANDING_OR_ABANDONED_SQL`), and some of those rows refuse an ack (a park-ceiling rejection, `markAcked` answers `parked`). A loop would print them on every call, forever.
- The list is unattributed. Anyone with the box token can read any session's list, so a loop could drain somebody else's mailbox by mistake.
- It costs 2n+1 round trips, and it would put rendering decisions in bash. The repo's rule is "decide in L1, act in L4": the renderer belongs beside `renderEnvelope`.

So the server decides what is shown and how. The client acts: it prints, and it acks only what it printed.

### 3.3 The inbox route

`GET /api/mail/inbox?fromId=<id>&fromUuid=<uuid>`, gated like the other mail reads:

1. `requireMailToken` (box token; 401 `unauthenticated` without it, `routes.ts` ≈:611-622).
2. `requireAttribution(reply, fromId, fromUuid, 'fromUuid')` (≈:677-685, over `attributionVerdict`, ≈:643-672), the check `approvals show` and `asks list` already use. A refusal is `registry-unmeasurable`, `unknown-sender` or `stale-uuid`, with the same statuses.

   **A refused read records nothing in `mail_rejections`.** Both gates answer through `refuseRoute` (`server/src/refuse.ts`), which writes no row, exactly as `GET /api/mail` and `GET /api/mail/:id` do today. `mail_rejections` is the record of mail that was refused ("a rejected message is a fact about the fleet", the docstring on the ingress's `refuse`, ≈:686-695), and a refused read refuses no mail. A stale uuid is also what a session sees for a few seconds after every `/clear`, so recording it would add a row per nudge and say nothing. The acks the client sends next go through the ack route, which records its own refusals exactly as today.
3. Select the caller's **inbox set**, **oldest first**: `toId = fromId`, the ack door's guard, AND the mailbox's read predicate (§1.5), joining `runs rr` on `m.runId` with a `LEFT JOIN` exactly as `outstandingMailFor` does. In words: the ackable rows a human still owes attention. The guard is hoisted into one named SQL fragment that both `writeDeliveries`' `'ack'` arm and this select use, and the read predicate is the existing `OUTSTANDING_OR_ABANDONED_SQL`, so neither is copied.

   **The rule, stated once.** A delivery is printed and acked only when the ack would change it AND the mailbox still shows it. Every printed row is therefore one `markAcked` accepts and one `mail list --to` lists. The intersection is the outstanding rows, plus the replay-ceiling park while its run is live or the mail has no run.

   **Why the ack guard alone is wrong.** The guard admits a replay-ceiling park whatever its run's state, while `ABANDONED_PARK_SQL` hides that park once its run is terminal (`TERMINAL_RUN_STATES`, `done` and `failed`, `shared/api.ts` ≈:4914). Selected by the guard alone, the inbox would print and ack briefs and wave mail of runs that have already closed, rows that `MailStrip` and `mail list` no longer show. `markAcked` would answer `ok`, and the client would print `inbox: acked delivery N`, which reads as a live instruction. That is the abandoned-brief hazard the ack route's `parked` answer exists to prevent, and a reused session name makes it worse: the new session would be handed its predecessor's closed briefs as fresh mail. Such a row is neither printed nor counted. The ack route keeps accepting it, as today, for a reader who acks it by hand.
4. Render each one (§3.4), mask it (D-5513, the same `maskDeep` the fetch route uses), and add entries in order until the page budget is reached. The budget is `MAIL_INBOX_PAGE_MAX_BYTES`, 20 KiB of rendered text (L0), and a page always holds at least one entry, so one oversized entry still goes out.
5. Answer `200 {ok: true, deliveries: [{deliveryId, text}], remaining, abandoned}`:
   - `remaining` is the number of ackable deliveries the budget left out;
   - `abandoned` is the number of rows `outstandingMailFor` shows that the inbox set leaves out (the abandoned parks an ack refuses: the attempt ceiling, a registry-absent recipient, the park ceiling), so the reader learns they exist without being shown them on every call. Because the inbox set is a subset of `outstandingMailFor`'s by construction, this is a plain difference. A replay-ceiling park of a closed run is in neither set, so it is not counted either.

The read writes nothing: no state, no attempt count, no stamp.

Reasons for the details:
- **Oldest first,** so that a session reads a wave's mail in the order it was sent. `mail list` is newest first because it is a status view.
- **A page budget,** because a session's shell tool truncates long output, and an acked entry the reader never saw is the same loss as an ack on read. Twenty KiB holds two bodies at `MAIL_BODY_MAX_BYTES` (8 KiB, `shared/api.ts` ≈:5072) with their headers. The limit is a Claude Code setting the operator controls (Q3).
- **Queued and parked rows are included.** A row the nudge has not reached yet, or one parked behind a draft (D-5838), is still mail for this session. Reading it early is the cheapest way to deliver it. An ack makes the lane skip it, as a hand-written ack does today.
- **No `mail-disabled` check.** That marker stops the delivery lane. Reading and acking already work under it, as `fetch` and `ack` do today.
- **The path,** `/api/mail/inbox`, sits in the mail lane's tables (`auth/gate.ts`'s `EXEMPT`, ≈:210-225, and the box-token census) beside `GET /api/mail/:id`. Fastify matches a static segment before a parameter, so `inbox` never reaches `:id`. An older server answers `400 bad-request` from `:id`, and the client reports that as "this server has no inbox" (§3.5).

### 3.4 What an entry looks like

The entry is rendered from the **stored envelope**, parsed back with `parseMailEnvelope`, so it shows what was queued (program and wave as they were at queue time) and keeps `renderEnvelope`'s "rendered once, never re-rendered" rule for every field it carries. Only the `ack:` instruction is left out, because the inbox acks for the reader. If the envelope does not parse (`malformed`), the stored text is printed verbatim, never dropped.

`````text
````ccrc-inbox
delivery: 412
from: project-a-worker
to: project-a
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
- **A different info string** (`ccrc-inbox`, not `MAIL_ENVELOPE_FENCE`), so `parseFetchedMailEnvelope` (`shared/api.ts` ≈:5601), which `buildChatItems` runs on every `tool_result` (`pwa/src/session/chatItems.ts` ≈:78-110), never mistakes an inbox print for one fetched envelope. Until the inbox cards land (§9), an inbox print shows in the transcript as an ordinary tool card.
- **`to:` is the stored envelope's recipient,** read from the envelope as queued, like every other field. It is there so that a later card parser (§9) has both ends without another read.
- **`delivery:` names the delivery id,** the only id on the entry. The mail row's own id is not printed, so there is nothing to confuse it with (D-41).

### 3.5 The client verb

`ccrc-api mail inbox` takes no argument and no flag.

1. **Identity from the pane.** `derive_identity` (`ccd/ccrc-api` ≈:282-302: the `TMUX_PANE` gate, `SAFE_RE`, `$REG/<id>.uuid`), as `asks list` and `approvals show` already do (≈:528-543). There is no `--to`: a session reads only its own inbox. Outside a pane it refuses `no-pane`, as `whoami` does.
2. **Where stdout goes.** Before the read, the client decides whether this run may ack at all. When fd 1 is `/dev/null` (`[[ /dev/stdout -ef /dev/null ]]`) or a pipe (`[[ -p /dev/stdout ]]`: `| tail -n 30`, `2>&1 | grep`, `| jq .`, `$( )`), the run is **show-only**: it prints every entry and acks none, and its first and last lines are `inbox: stdout is a pipe or /dev/null, so nothing was acked; run ~/.local/bin/ccrc-api mail inbox bare (no pipe, no redirect, no head or tail)`. The line is first so that `| head` keeps it and last so that `| tail` does. The replay goes on as today.
   - **Why the pipe test is safe for the tool itself.** The tool's own capture is a regular file (§1.2), never a FIFO, so a bare run acks. A shell pipeline is always a FIFO, so every piped form a session writes is caught. A socket (Node's piped stdio, the client's own tests) is not a shell pipeline and acks.
   - **If a Claude Code build ever captures through a FIFO,** every bare run becomes show-only. That is the safe direction: nothing is lost, the replay keeps nudging, and the first line says why. Plan MI-6 Step 0 measures it on the fleet's build (Q4).
3. **Read.** One `GET /api/mail/inbox` with the derived pair in the query, through the same request function every row uses (token on curl's stdin, R16; see "One run, many requests" below).
4. **For each entry, in order:** print its `text` and a newline to stdout. If the print fails (a write error such as `>&-`'s `EBADF` or `/dev/full`'s `ENOSPC`, or SIGPIPE ends the process), stop: this entry and every later one stay unacked. In a show-only run, print and go on. Otherwise ack it: `POST /api/mail/<deliveryId>/ack` with the body `{"fromId":"<id>","fromUuid":"<uuid>"}` built from the derived pair (both `SAFE_RE`-checked, so no quote can break out). This is today's ack, with today's attribution, ladder and recorded refusals. Then print one line after the closing fence:
   - `inbox: acked delivery 412`;
   - `inbox: delivery 412 was already acked` (`already: true, parked: false`, for example a second `mail inbox` running at the same time);
   - `inbox: delivery 412 was closed before this ack (<lastError>); nothing is owed` (`parked: true`);
   - `inbox: delivery 412 is NOT acked (<error or transport>); it will be shown again`.
5. **Footer:** `inbox: N printed, M acked`, then `inbox: acked deliveries 412 413; if any of their text did not reach you, read it again with ~/.local/bin/ccrc-api mail fetch <delivery>` naming every delivery this run acked (an acked delivery is still served by `GET /api/mail/:id`, which reads any state, `routes.ts` ≈:1250-1264), then `inbox: R more unacked; run mail inbox again` when `remaining > 0`, and `inbox: A abandoned deliveries are not shown; mail list --to <id> lists them` when `abandoned > 0`. An empty inbox prints `inbox: no unacked mail`.
6. **A read that is not a 200** prints the body and `inbox: the server did not serve the inbox (http <code>); if it predates mail inbox, read with mail list, fetch and ack` on stdout, acks nothing, and exits 0.

**One run, many requests.** Today's `main` (≈:545-589) is written for exactly one request, and three of its lines would break a loop:
- **The token is cleared after the first request** (`TOKEN=""`, ≈:574). Every later ack would send an empty token and be refused `unauthenticated`.
- **The EXIT trap is armed per temp file** (`trap "rm -f '$out'" EXIT`, ≈:558). Re-arming it for a second file replaces the first trap, so the first file is never removed.
- **A transport failure exits 3 on the spot** (≈:575-582). The first ack that got no response would end the run, leaving every later printed entry unreported.

So the request block becomes one function, `send_request`, that every row and the inbox share. It sends one request and answers with `REQ_CODE`, the body in one temp file, and a return status: 0 for an answer, 3 for no response. It never exits, never clears the token and never sets a trap. `main` creates the one temp file and arms the one EXIT trap before the first request (curl's `-o` rewrites the file on each request), reads the token once, and clears it once, when the verb's last request is done. A one-request row turns a 3 into today's transport envelope and `exit 3`, byte for byte. The inbox turns a 3 on the read into the same `exit 3`, and a 3 on an ack into that entry's `NOT acked (transport)` line, and goes on. No `refuse` moves into a `$( )` (the D-2724 comments at `server_url` and `read_token`).

**Exit codes** follow §3.1: 0 when the read answered, whatever happened to the acks (each outcome is on stdout), 2 for a local refusal, 3 when the read got no response. A transport failure on one ack does not change the exit code: the entry is reported NOT acked and replays as usual.

**stdout is plain text for this verb only.** The usage text, the README and the skills say so. Every other row keeps the JSON body.

**`jq` is required by this verb only.** The client parses the inbox answer with `jq`. Every fleet box already has it: the session hook does nothing without it (`ccd/session-hook.sh` ≈:2877), and `ccrc version` refuses to run without it (`ccd/ccrc` ≈:2950). Without it the verb refuses `no-jq` before any request. The other rows stay `jq`-free.

### 3.6 Replay is unchanged

A printed delivery is acked, and an acked row is terminal, so it is never replayed, exactly as after a hand-written ack today. A printed delivery whose ack failed is not acked, so it replays on today's schedule and the next `mail inbox` prints it again. A show-only run acks nothing, so its rows replay as today. Nothing in this spec reads or writes the replay clock, `replayCount`, the replay ceiling, the stall watch's deaf arms or `wakeAdmit`.

### 3.7 The nudge and the skills

**The nudge has two forms, chosen at send time.**
- The inbox form: `ccrc-mail: you have new mail. Read it with ~/.local/bin/ccrc-api mail inbox, by that exact path, since ~/.local/bin is not on this unit's PATH. Run it bare: no pipe, no redirect, no head or tail. It prints every unacked mail addressed to you and acks each one it printed. Use the client, never curl or raw HTTP; it resolves the server address and reads the box token itself.`
- Today's form, unchanged, for a fleet whose client predates the verb.

`fleetCarriesMailInbox(role, own, fleet)` chooses, in the shape of `fleetCarriesRunsAttribution` (`server/src/fleetstate.ts` ≈:249-278): `true` on a `both` box, when the builds agree, or when the fleet stamp's release tag is at or past `MAIL_INBOX_SINCE` (L0, set to the release that ships the client verb). Anything else keeps today's form.

- **Run it bare, said in the nudge itself.** A piped run acks nothing (§3.5 step 2), and a redirected one acks mail the session may never read (§4). The nudge is the one text every reader sees before the call, so the rule rides there and in the skills, not only in the client's own output.
- **Why a floor and not the date of a merge:** the nudge is the only protocol text guaranteed current in the recipient's pane (`envelope.ts` ≈:132-136). A nudge naming a verb the box's client refuses is the wedge D-791 describes, again.
- **The 24-character head is byte-identical** (`ccrc-mail: you have new `), so `sendPrompt`'s echo needle does not move. The inbox form carries no `toId`, because the client derives identity from the pane.
- **The park's own-nudge check accepts both forms.** `sweepMail` resumes a parked box only when it holds exactly the lane's own nudge (`watch.ts` ≈:8052, `box !== renderMailNudge(d.toId)`). A row parked under one form and retried under the other must still match, so the check reads "either form the lane may have typed". This changes which text is typed, not when.

**The skills, references and README teach `mail inbox` first,** and keep `list`, `fetch` and `ack` as the documented fallback, for a server without the route and for reading one delivery again:
- Every skill that names the verb says to run it bare: no pipe, no redirect, no `head` or `tail`, and that the footer lists the deliveries it acked, for `mail fetch <delivery>` if the text was lost.
- `ccd/worker-skill/SKILL.md`: "Reading mail is three calls, not one" (≈:219-223) becomes one call, with the three calls kept as the fallback. The pinned ack clause (`worker-skill.test.ts` ≈:60) still says "ack before you act", and now says that `mail inbox` does it.
- `ccd/coordinator-skill/SKILL.md`: clause 3 "Wake on mail" (≈:292-300), and the stdout and exit-code paragraphs (≈:142-156).
- `ccd/reviewer-skill/SKILL.md`: the ack clause (`reviewer-skill.test.ts` ≈:22) and the exit-code sentence (≈:143).
- `ccd/coordinator-skill/references/wave-lifecycle.md` §3 and `references/mail-envelope.md`, which quote the old nudge and teach the three calls.
- `README.md`: the client's verb list (≈:3616) and its mail paragraphs.

The pinned clauses change in the same PR as their tests. A clause is a mechanism here, not a comment.

**Unchanged on purpose:**
- The envelope's `ack:` lines (`renderEnvelope`, ≈:84-87), because a `fetch` reader still needs them, and stored envelopes are never re-rendered.
- The hold card's `mail list --to <id>` (`ccd/session-hook.sh` ≈:917). It is a read-only pointer, and pointing it at `mail inbox` would ack a brief from a diagnostic card.

## 4. Safety: what is kept, and how

- **The caller's identity.** The inbox and the acks it drives use the pane-derived pair only: `TMUX_PANE` validated as a pane id, the session name held to `SAFE_RE`, the uuid read from `$REG/<id>.uuid`. No flag selects another session. The server re-measures the pair against the registry (`requireAttribution` on the read, the ack route's own ladder on each ack) and selects only rows whose resolved `toId` is the caller. Identity on this fleet is attribution, not authentication, and this is as strong as the ack route, no stronger (CLAUDE.md, SAFETY).
- **Delivery id, never mail id.** The server hands the client each `deliveryId` as a JSON number. The client never parses an id out of rendered text, and the entry prints only the delivery id.
- **The status line's callers.** No order of install, skipped release, stopped install or rollback pairs a caller that reads `http <code>` with a client that does not write it (§3.1).
- **The hibernated wake budget.** No new wake source, and no change to the replay. The inbox runs only in a session that is awake. Its acks can only remove automatic wakes, as a hand-written ack does. `wakeAdmit`, `WAKE_BURST` and `MAIL_WAKE_FLOOR_MS` are unchanged.
- **Coordinator-first routing (D-5298).** Coordinator mail is resolved to a session when it is queued, so the inbox reads it like any other. Approval nudges (`approval:<id>`) and ask nudges (`ask:<n>`) are ordinary rows. Acking one changes no approval or ask state: no approvals-lane or asks-lane code reads `ackedAt`, measured with `grep -rln ackedAt server/src` (the only readers are `watch.ts`, `stall.ts`, `store.ts` and `schema.ts`). The coordinator still rules through `approvals rule`. The 180-second late-answer window is a property of the approvals lane, which this spec does not touch.
- **Terminal states.** The ack goes through `markAcked` and its single `WHERE` (D-1410, I2(b)). `writeDeliveries` stays the one writer (D-5997): the inbox read writes nothing, and the hoisted guard is the same SQL the writer already runs. An out-of-vocabulary state token is treated exactly as `markAcked` treats it today. That question stays open (D-1406), and this spec does not decide it.
- **The rejection record.** `mail_rejections` gains no writer and loses none. The read records no refusal (§3.3 step 2), and every ack refusal is recorded by the ack route as today.
- **Kill switches.** `mail-disabled`, `mail-gate-strict` and the stall-watch markers keep their meanings. None gains a writer.
- **The closed client.** One new row (`mail.inbox`, a fixed path, no caller text in the URL beyond the `SAFE_RE`-checked pair the client derives itself). The token rides curl's stdin on every request, the read and each ack. The row count in the header and at `ROUTES` becomes thirty-two, and `ccrc-api-closed.test.ts`'s body-fill census names the synthesized ack body.
- **Masking.** Every rendered entry goes through the same masker as `GET /api/mail/:id` (D-5513) before it leaves the server.
- **Fail toward showing, never toward acking, as far as the client can see.** The invariant is **nothing is acked whose write failed**: a failed print stops the loop with nothing acked after it. It is not "nothing is acked that the session did not see", because a write that succeeded proves only that the bytes reached fd 1. Under the tool, fd 1 is the tool's own capture (§1.2), so there the two coincide. Where fd 1 is something else the client knows about, it does not ack: a pipe or `/dev/null` makes the run show-only (§3.5 step 2). A failed ack leaves the row unacked. An envelope that does not parse is printed verbatim. A registry that cannot be read refuses the read, and nothing is acked. A row the mailbox no longer shows (a replay-ceiling park of a closed run) is never printed, so the inbox cannot present a closed run's brief as live (§3.3 step 3).
- **Residuals, named.** Two cases still ack mail a context may not have read. Neither is new in kind, since a session can ack by hand without reading today, and each has a recovery.
  - **A redirect to a file** (`> f`, `>> f`, `> f 2>&1`). fd 1 is a regular file, which is exactly what the tool's own capture looks like (§1.2), so the client cannot tell them apart and acks every entry it wrote. The text is in the file the session chose, so it is not lost, only unread until the session reads that file. The nudge and the skills say to run the verb bare (§3.7), and the footer names every acked delivery for `mail fetch`. Plan MI-6 pins this case as the residual, so a later change to it is a decision and not a drift.
  - **The tool's display cut.** The tool may show less than its capture holds. The page budget (§3.3 step 4, Q3) keeps a page under the limit the operator sets, and the footer names the acked deliveries.

## 5. Rings and contexts

- **L0 (`shared/api.ts`):** `MAIL_INBOX_PAGE_MAX_BYTES`, `MAIL_INBOX_SINCE`, `MAIL_INBOX_FENCE_INFO`, the wire types `MailInboxEntry` and `MailInboxAnswer`, and their reader. Nothing is imported.
- **L1:** `renderInboxEntry` beside `renderEnvelope` (`server/src/coord/envelope.ts`, pure). The page cut, `pageInbox(entries, budget)`, is pure too. `fleetCarriesMailInbox` sits beside `fleetCarriesRunsAttribution`.
- **L3 (`CoordStore`):** `inboxFor(toId)`, `abandonedCount(toId)` and the hoisted ackable guard. Reads only, all synchronous, with no repository layer (CLAUDE.md, Coordination).
- **L4 (`routes.ts`, `watch.ts`):** the inbox route, and the nudge choice at send time. Delivery code composes and decides nothing.
- **Fleet (`ccd/ccrc-api`, `ccd/session-hook.sh`, `ccd/ccrc`):** the newline, the status variable, `send_request`, the verb, and the two callers' opt-in.
- **Context:** Coordination (mail). Nothing crosses into another context.
- **Consolidation:** no second mechanism. One renderer family (`envelope.ts`), one ack door, one attribution check, one writer, one request function in the client, and one fleet-capability shape. The ackable predicate is hoisted and shared, not copied.

## 6. Wire and deploy

- **New route:** `GET /api/mail/inbox`, box-token gated, in `auth/gate.ts`'s `EXEMPT` with its reason, and in the box-token census.
- **No schema change.** No coord.db migration.
- **No `FLEET_PROTO` bump.** Nothing new rides the agent link.
- **Order** (plan §Waves): the client's newline and variable (fleet); the callers' opt-in (fleet, once the client's release is installed); the quiet default (fleet, once the opt-in's release is installed). Independently: the server half (the guard, the route); then the client verb and the skills (fleet, released only once the server runs the route); then the nudge switch (server, its floor set to the client verb's release tag).

## 7. Alternatives rejected

- **Ack on read in the server.** It acks what the reader never saw (§3.2).
- **A client loop over list, fetch and ack.** It reprints rows that cannot be acked, reads an unattributed list, and moves rendering into bash (§3.2).
- **Delete the stderr status line outright.** Two in-tree parsers need the exact code, and the opt-in costs one line.
- **The callers opt in first, gated on a merge** (rev 2). A merge order is not an install order: the install writes the client before the hook, and a box may skip a release, so a quiet client could meet a hook that never opted in (§3.1).
- **A `--status` flag.** Every older client refuses it as `unknown-query`, which breaks the hook during an install window. An environment variable is ignored by old clients.
- **Map 4xx and 5xx to non-zero exit codes now.** It breaks a contract three skills teach and turns refusals into failed tool calls. It is left to the operator (Q1).
- **Record the inbox read's refusals in `mail_rejections`.** A refused read refuses no mail, and a stale uuid after every `/clear` would add a row per nudge (§3.3 step 2).
- **Server-rendered `text/plain` with length-prefixed frames,** to keep the client `jq`-free. Reading byte counts in bash is fragile with multi-byte text, and every fleet box already has `jq` (§3.5).
- **Ack only when fd 1 is a regular file.** It would also refuse to ack under any harness that captures through a socket, and it still cannot tell `> f` from the tool's own capture. The pipe test catches every shell pipeline, which is the measured problem, and nothing more.
- **A second confirming call** (`mail inbox` prints, and a later `mail inbox --ack <ids>` acks). It doubles the calls this spec exists to remove, and the reader's confirmation is no better evidence than the tool's capture: a session that piped the print can confirm just as easily.
- **A loop over today's one-shot request block.** It clears the token after the first request, re-arms the EXIT trap per temp file and exits 3 on the first transport failure (§3.5).
- **Re-render the entry from the mail row's columns.** The stored envelope is the record of what was queued, and the inbox shows it.

## 8. Questions for the operator

1. **Exit codes.** Keep "exit 0 whenever a response arrived" (recommended: three skills, two measurers and the hook depend on it, and a non-zero exit invites retries), or move a 4xx to exit 4 and a 5xx to exit 5, keeping the body on stdout?
2. **The non-2xx stderr line.** Once the default is quiet (§3.1 step 3), keep `ccrc-api: the server answered <code>` on stderr for a non-2xx answer (recommended: an untyped 404 or 502 body is the one case where the code helps a reader), or make stderr silent on every answer unless `CCRC_API_STATUS=line` is set?
3. **The page budget.** Twenty KiB assumes the shell tool shows at least that much before it truncates. Is any account on the fleet configured with a lower output limit? If so, the budget should be lower (recommended: keep 20 KiB unless one is).
4. **The fleet's Bash tool capture.** §1.2 measured fd 1 as a regular file on one build (2.1.308, darwin). Plan MI-6 Step 0 re-measures it on the fleet's build. If a build captures through a FIFO, should the client keep refusing to ack there, which makes `mail inbox` show-only everywhere until a client change (recommended, the safe direction), or is there a build you want acks to keep working on regardless?

## 9. Later (not in this plan)

Each of these changes when or whether a nudge is replayed or how the transcript shows an inbox read. Rev 2 of this spec, in this PR's history, worked them through, including the walk of every `OUTSTANDING_STATES_SQL` holder. They need their own spec revision, review and decision numbers before any of them is built.

- **A fetched-at stamp.** `mail_deliveries.fetchedAt` and `fetchedUuid` (a migration), written by an attributed `GET /api/mail/:id` by the recipient, with `mail fetch` sending the pane's identity through a non-refusing derive.
- **Replay suppression.** The 10-minute replay skips a row stamped by the recipient's current uuid (`stampHolds`, in `sweepMail` after the registry read), a stale stamp is cleared, a repoint clears the stamp, and a stamped row still parks at the moment today's ceiling would have parked it. The compaction residual (the uuid does not rotate) is the open question that comes with it.
- **The hibernated-wake skip.** A stamped row stops spending a cold `ccd ensure` on a sleeping recipient (D-5242).
- **Inbox cards.** `parseInboxPrint` (L0) and a second `tool_result` arm in `buildChatItems`, so mail read through `mail inbox` shows as mail cards in the operator's transcript view. **Until it lands, mail read the default way shows there as an ordinary tool card,** while a `mail fetch` keeps its card. The entry's `to:` line (§3.4) is there for it.
- **"Read, not acked" in `MailStrip`,** which needs the stamp.

## 10. Out of scope and follow-ups

- CI and PR polling, and sleep loops. The same rule applies: the server already measures PR state (`.prhistory`, the PR sweep), so a mail on a state change would replace a poll. A follow-up spec is the operator's call.
- Retiring the envelope's `ack:` instruction, or `mail list`, `fetch` and `ack`. They stay as the fallback.

## 11. Review log

**rev 0 (2026-10-24).** Written against `origin/main` `10813b401`. The task said the client prints `http NNN` on stdout. The code shows stderr since its first commit (§1.2), and §3.1 is written for what the code does.

**rev 3 (2026-10-24), re-scoped to the minimum (orchestrator ruling).** Re-grounded on `origin/main` `7a3104abd` (only the skills and the README moved, by a line or two). Kept: clean output, `mail inbox`, and the nudge and the skills. Moved to §9: the fetched-at stamp, replay suppression and its bound park, `stampHolds`, the hibernated-wake skip, the attributed fetch and the inbox cards. Fixed from review:
- **Reverse order.** Rev 2 had the callers opt in first and the quiet default land after that merge. The install writes the client before the hook, and a box may skip a release, so a merge order did not keep a quiet client away from a hook that never opted in. §3.1 now ships the client first with the line still on by default, moves the callers once that release is installed, and turns the default quiet only once the callers' release is installed.
- **The read's refusals.** Decided: the inbox read records nothing in `mail_rejections` (§3.3 step 2). Rev 2 said it did.
- **One-shot request block.** The client's `main` clears the token after one request, re-arms the EXIT trap per temp file and exits 3 on the spot. §3.5 adds `send_request`, shared by every row, so the inbox's later acks carry the token, every temp file is removed, and a transport failure on one ack is reported and passed.
- Questions about the deferred parts (rev 2's Q2), the old verbs in the skills (rev 2's Q3, now ruled: kept as the fallback), the acceptance bar (Q6) and CI polling (Q8, §10) are dropped. Rev 2's Q1, Q4, Q5 and Q7 are now Q1 to Q4.

**rev 2 (2026-10-24), review round 2.** The invariant became "nothing is acked whose write failed", with the pipe and `/dev/null` guard and the acked-delivery footer. The fetch stamp gained the uuid, and the PWA gained inbox cards. Both are now in §9.

**rev 1 (2026-10-24), review round 1.** The inbox set became the ack guard AND `OUTSTANDING_OR_ABANDONED_SQL`, with the closed run's replay-ceiling park excluded. The stamp's lifetime bound and `mail fetch`'s non-refusing derive were added; both are now in §9.

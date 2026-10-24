# Mail inbox and clean client output

**Spec** · 2026-10-24 · Status: draft for review, rev 2 · Owner: the ccrc coordinator · Deviation: D-6772 (issued by the ledger) · Plan: `docs/superpowers/plans/2026-10-24-mail-inbox.md`

**Related:** `2026-08-26` closed client (`docs/superpowers/plans/2026-08-26-ccrc-api.md`), the robust-mail-delivery reference nudge (`server/src/coord/envelope.ts#renderMailNudge`, D-738, D-791), D-41 (delivery id against mail id), D-5242 (hibernation and the wake budget), D-5298 (coordinator-first routing: approval nudges ride mail), D-5513 (masking before text leaves the server), D-5838 (the parked state), D-5997 (one writer of `mail_deliveries`), `2026-09-29-worker-stall-watch-design.md` (the mail gate and the deaf arms).

## In short

Reading mail costs a session three client calls per message and a hand-written parser each time. The fleet's transcript audit puts that at 2.5% of all spend, and it is the cheapest of the polling costs to remove, because the server already knows everything the reader needs. This spec does four things:

1. **Clean output.** `ccrc-api` prints the response body on stdout and nothing else, always ending in a newline. The `http <code>` line it prints on stderr today becomes opt-in (`CCRC_API_STATUS=line`), and the two in-tree scripts that parse it opt in. Exit codes do not change.
2. **`ccrc-api mail inbox`.** One call prints every unread mail addressed to the calling session as plain text (from, to, kind, subject, run, artifacts, body), then acks each delivery it printed, one at a time, through the existing ack route. A delivery whose print or ack fails stays unacked. When stdout is a shell pipe or `/dev/null`, it prints and acks nothing, and says to run it bare. The footer names every delivery it acked, so a reader who lost the text can fetch it again. The server selects and renders, and the client prints and acks (§3.2 gives the reasons). A redirect to a file still acks: that is a named residual (§4).
3. **The nudge and the skills point at `mail inbox`,** and say to run it bare: no pipe, no redirect, no `head` or `tail`. The nudge switches only once the fleet's client is known to have the verb (a release-tag floor, the same shape as `RUNS_ATTRIBUTION_SINCE`), and once the PWA renders an inbox print as mail cards (§3.8), so the operator's transcript view keeps today's cards.
4. **A fetched delivery stops replaying.** A `mail fetch` that the client attributes to the recipient stamps `fetchedAt` and the verified uuid of the session that fetched it, and the 10-minute replay skips a stamped row while the recipient still runs under that uuid. A `/clear` or a reused name changes the uuid and re-arms the replay. A stamped row that is never acked still parks when today's replay ceiling would have parked it, without another nudge, so nothing outstanding lives longer than it does today. A printed delivery is acked, and an acked row never replays.

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

**Where the tool's output goes, measured.** Under the Claude Code Bash tool (Claude Code 2.1.308, darwin, 2026-10-24), fd 1 and fd 2 of a command are **one regular file**: `[[ -f /dev/stdout ]]` is true, `[[ -p /dev/stdout ]]` is false, and `stat -L` gives fd 1 and fd 2 the same inode. The tool captures to a file and reads it back. So a bare command's write lands in the tool's capture, and the same command run as `cmd | tail` or `$(cmd)` sees a pipe (`-p` true), because a shell pipeline is a `pipe(2)`. A child that Node spawns with piped stdio (`server/test/ccrc-api.test.ts` ≈:102, `spawn(CCRC_API, args, { env })`) sees neither: the probe reads it as a socket, not a FIFO. §3.5 builds on these three shapes, and plan MI-7 Step 0 re-measures them on the fleet's own build.

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
- the ack door's own guard (`store.ts#writeDeliveries`, ≈:5373-5375): a row is ackable when its state is not terminal, or when it is exactly the replay-ceiling park (orchestrator ruling I2(b)). The guard reads no run, so it admits a replay-ceiling park whatever its run's state;
- the mailbox's read predicate (`OUTSTANDING_OR_ABANDONED_SQL`, ≈:1452-1453, over `ABANDONED_PARK_SQL`, ≈:1353-1356), which hides that same park once its run is terminal (ruling I2(a): the run closing makes it moot). `outstandingMailFor` (≈:5152-5160) reaches it through `LEFT JOIN runs rr`.

The two sets differ, and the inbox needs both (§3.3 step 3). The client only needs a list it can print and a delivery id for each entry, given by the server and never parsed out of text.

## 2. Goals and non-goals

**Goals.**
- One call reads and acks all of a session's unread mail.
- The client's stdout is machine-readable with no cleanup: the body, then one newline.
- A delivery that was acked or fetched by the session that still holds it is not replayed.
- **Nothing is acked whose write failed.** That is the invariant, and it is all a client can know: a write that succeeded reached fd 1, not necessarily a reader. Two measured guards narrow the gap (§3.5): nothing is acked when fd 1 is a shell pipe or `/dev/null`, and the footer names every delivery that was acked. What is left, a redirect to a file, is named in §4.
- A stamp silences the replay only for the session incarnation that fetched (§3.6).
- The operator's transcript view shows mail read through `mail inbox` as mail cards, as it shows a `mail fetch` today (§3.8).

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
| 2xx answer | body + `\n` | nothing (the one exception is `mail fetch`'s local note, §3.5) | 0 |
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
- The server cannot know that a print succeeded. A closed pipe, a killed tool call or a truncated display would ack mail nobody saw. The client cannot know that a reader saw it either, but it does know whether its write failed and where fd 1 points (§1.2), and the server knows neither.
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
3. Select the caller's **inbox set**, **oldest first**: `toId = fromId`, the ack door's guard, AND the mailbox's read predicate (§1.5), joining `runs rr` on `m.runId` with a `LEFT JOIN` exactly as `outstandingMailFor` does. In words: the ackable rows a human still owes attention. The guard is hoisted into one named SQL fragment that both `writeDeliveries`' `'ack'` arm and this select use, and the read predicate is the existing `OUTSTANDING_OR_ABANDONED_SQL`, so neither is copied.

   **The rule, stated once.** A delivery is printed and acked only when the ack would change it AND the mailbox still shows it. Every printed row is therefore one `markAcked` accepts and one `mail list --to` lists. The intersection is the outstanding rows, plus the replay-ceiling park while its run is live or the mail has no run.

   **Why the ack guard alone is wrong.** The guard admits a replay-ceiling park whatever its run's state, while `ABANDONED_PARK_SQL` hides that park once its run is terminal (`TERMINAL_RUN_STATES`, `done` and `failed`, `shared/api.ts` ≈:4914). Selected by the guard alone, the inbox would print and ack briefs and wave mail of runs that have already closed, rows that `MailStrip` and `mail list` no longer show. `markAcked` would answer `ok`, and the client would print `inbox: acked delivery N`, which reads as a live instruction. That is the abandoned-brief hazard the ack route's `parked` answer exists to prevent, and a reused session name makes it worse: the new session would be handed its predecessor's closed briefs as fresh mail. Such a row is neither printed nor counted. The ack route keeps accepting it, as today, for a reader who acks it by hand.
4. Render each one (§3.4), mask it (D-5513, the same `maskDeep` the fetch route uses), and add entries in order until the page budget is reached. The budget is `MAIL_INBOX_PAGE_MAX_BYTES`, 20 KiB of rendered text (L0), and a page always holds at least one entry, so one oversized entry still goes out.
5. Answer `200 {ok: true, deliveries: [{deliveryId, text}], remaining, abandoned}`:
   - `remaining` is the number of ackable deliveries the budget left out;
   - `abandoned` is the number of rows `outstandingMailFor` shows that the inbox set leaves out (the abandoned parks an ack refuses: the attempt ceiling, a registry-absent recipient, the park ceiling), so the reader learns they exist without being shown them on every call. Because the inbox set is a subset of `outstandingMailFor`'s by construction, this is a plain difference. A replay-ceiling park of a closed run is in neither set, so it is not counted either.

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
- **A different info string** (`ccrc-inbox`, not `MAIL_ENVELOPE_FENCE`), so `parseFetchedMailEnvelope` (`shared/api.ts` ≈:5601), which `buildChatItems` runs on every `tool_result` (`pwa/src/session/chatItems.ts` ≈:78-110), never mistakes an inbox print for one fetched envelope. The PWA reads an inbox print with its own parser instead (§3.8), so the card survives the switch.
- **`to:` is the stored envelope's recipient,** because the transcript card names both ends (`ui/src/components/mail-card.tsx#MailCard`, `envelope.toId`). It is read from the envelope as queued, like every other field, so it is never re-derived.
- **`delivery:` names the delivery id,** the only id on the entry. The mail row's own id is not printed, so there is nothing to confuse it with (D-41).

### 3.5 The client verb

`ccrc-api mail inbox` takes no argument and no flag.

1. **Identity from the pane.** `derive_identity` (`TMUX_PANE` gate, `SAFE_RE`, `$REG/<id>.uuid`), as `asks list` and `approvals show` already do. There is no `--to`: a session reads only its own inbox. Outside a pane it refuses `no-pane`, as `whoami` does.
2. **Where stdout goes.** Before the read, the client decides whether this run may ack at all. When fd 1 is `/dev/null` (`[[ /dev/stdout -ef /dev/null ]]`) or a pipe (`[[ -p /dev/stdout ]]`: `| tail -n 30`, `2>&1 | grep`, `| jq .`, `$( )`), the run is **show-only**: it prints every entry and acks none, and its first and last lines are `inbox: stdout is a pipe or /dev/null, so nothing was acked; run ~/.local/bin/ccrc-api mail inbox bare (no pipe, no redirect, no head or tail)`. The line is first so that `| head` keeps it and last so that `| tail` does. The replay goes on as today.
   - **Why the pipe test is safe for the tool itself.** The tool's own capture is a regular file (§1.2), never a FIFO, so a bare run acks. A shell pipeline is always a FIFO, so every piped form a session writes is caught. A socket (Node's piped stdio, the client's own tests) is not a shell pipeline and acks.
   - **If a Claude Code build ever captures through a FIFO,** every bare run becomes show-only. That is the safe direction: nothing is lost, the replay keeps nudging, and the first line says why. Plan MI-7 Step 0 measures it on the fleet's build, and a change of build that turns the capture into a FIFO needs a client change, not a silent loss.
3. **Read.** One `GET /api/mail/inbox` with the derived pair in the query, through the same curl call every row uses (token on curl's stdin, R16).
4. **For each entry, in order:** print its `text` and a newline to stdout. If the print fails (a write error such as `>&-`'s `EBADF` or `/dev/full`'s `ENOSPC`, or SIGPIPE ends the process), stop: this entry and every later one stay unacked. In a show-only run, print and go on. Otherwise ack it: `POST /api/mail/<deliveryId>/ack` with the body `{"fromId":"<id>","fromUuid":"<uuid>"}` built from the derived pair (both `SAFE_RE`-checked, so no quote can break out). Then print one line after the closing fence:
   - `inbox: acked delivery 412`;
   - `inbox: delivery 412 was already acked` (`already: true, parked: false`, for example a second `mail inbox` running at the same time);
   - `inbox: delivery 412 was closed before this ack (<lastError>); nothing is owed` (`parked: true`);
   - `inbox: delivery 412 is NOT acked (<error or transport>); it will be shown again`.
5. **Footer:** `inbox: N printed, M acked`, then `inbox: acked deliveries 412 413; if any of their text did not reach you, read it again with ~/.local/bin/ccrc-api mail fetch <delivery>` naming every delivery this run acked (an acked delivery is still served by `GET /api/mail/:id`, which reads any state, `routes.ts` ≈:1250-1264), then `inbox: R more unread; run mail inbox again` when `remaining > 0`, and `inbox: A abandoned deliveries are not shown; mail list --to <id> lists them` when `abandoned > 0`. An empty inbox prints `inbox: no unread mail`.
6. **A read that is not a 200** prints the body and `inbox: the server did not serve the inbox (http <code>); if it predates mail inbox, read with mail list, fetch and ack` on stdout, acks nothing, and exits 0.

**Exit codes** follow §3.1: 0 when the read answered, whatever happened to the acks (each outcome is on stdout), 2 for a local refusal, 3 when the read got no response. A transport failure on one ack does not change the exit code: the entry is reported NOT acked and replays as usual.

**stdout is plain text for this verb only.** The usage text, the README and the skills say so. Every other row keeps the JSON body.

**`jq` is required by this verb only.** The client parses the inbox answer with `jq`. Every fleet box already has it: the session hook does nothing without it (`ccd/session-hook.sh` ≈:2877), and `ccrc version` refuses to run without it (`ccd/ccrc` ≈:2950). Without it the verb refuses `no-jq` before any request. The other rows stay `jq`-free.

**`mail fetch` sends identity when it can, and never refuses for lack of it.** Inside a pane, the client fills `fromId` and `fromUuid` on `mail fetch`, so a fetch by the recipient stamps the row (§3.6). It derives them with a new **non-refusing** derive, `try_derive_identity`: the same checks as `derive_identity` (`ccd/ccrc-api` ≈:282-302: the `TMUX_PANE` gate, the pane-id shape, tmux's answer, `SAFE_RE`, `$REG/<id>.uuid`), which sets `DERIVED_ID` and `DERIVED_UUID` or leaves both empty and names the failed check in `DERIVE_WHY`. It never calls `refuse`. `derive_identity` becomes `try_derive_identity || refuse "$DERIVE_WHY" …`, so there is still one derivation and every existing caller refuses exactly as today.

- **No pane at all** (`TMUX_PANE` unset): the fetch is unattributed and silent, as today.
- **A pane whose identity cannot be derived** (an operator's own tmux shell, a session name outside `SAFE_RE`, a `.uuid` that is briefly missing or empty, tmux not answering): the fetch is unattributed, exactly as today, and the client writes one line to stderr, `ccrc-api: mail fetch sent no identity (<DERIVE_WHY>); this fetch does not stop the replay`. That line is a local note, not the status line, and §3.1's "stderr is quiet on a 2xx" rule names it as its one exception.

This keeps the non-goal in §2: who may read whose mail through `mail fetch` does not change, on the client or on the server.

### 3.6 A fetched or printed delivery stops replaying

**`mail_deliveries.fetchedAt` and `fetchedUuid`** (coord.db migration 30, a nullable `INTEGER` and a nullable `TEXT`, in one migration). The stamp records when the row was fetched and **which session incarnation fetched it**: the `fromUuid` that `attributionVerdict` just matched against the registry. Both are written together through `writeDelivery` with the `'non-terminal'` guard, so a terminal row is never touched. The first stamp per uuid stands: a second fetch under the same uuid keeps the first `fetchedAt`, and a fetch under a different, verified uuid replaces both columns.

**Why the uuid is part of the stamp.** The recipient's name (`toId`) outlives the context that read the mail. Claude Code rotates the session uuid on `/clear` and on a fork, and `ccd` mirrors the new one into the registry (`ccd/ccd#_sync_uuid` ≈:17810-17816: "Claude Code rotates the active session uuid during normal operation (/clear; compaction keeps its transcript)"). A reused session name gets a new uuid under the old id. In each case the context that now answers to `toId` never saw the mail. A stamp without the uuid would silence the replay for that context until the bound parked the row, with no nudge in between. The same argument is why a repoint clears the stamp (below): a stamp is a fact about one recipient incarnation, not about a name.

**`GET /api/mail/:id` stamps only an attributed fetch by the recipient.** When the query carries `fromId` and `fromUuid`, the route runs the same `attributionVerdict` and checks that `toId = fromId`, then stamps. The envelope is served either way: an attribution failure never narrows today's read. The answer gains a positive marker, `fetch`: `'stamped'`, `'unattributed'` (no pair), `'not-yours'` (another session, or a pair the registry refuses, with the refusal code in `fetchRefused`) or `'unmeasured'` (registry unreadable). An older server sends no marker, and its absence means "not stamped".

**The replay skips a row stamped by the recipient's current uuid, and only that.** The decision needs the registry, so it sits in `sweepMail`, which already holds it: the sweep returns early unless the registry was listed (`watch.ts` ≈:7484, `if (!registryRead.listed) return`), and then builds `uuidByToId` (≈:7486). `dueDeliveries` keeps selecting `delivered` rows as today and also returns `fetchedAt` and `fetchedUuid`. For each due `delivered` row with `fetchedAt` set:
- `fetchedUuid === uuidByToId.get(toId)`: the context that fetched still holds the name. The row is not replayed.
- anything else (a `/clear` or fork rotated the uuid, a reused name, the recipient missing from the registry): the stamp is stale. The sweep clears it through `writeDelivery` (`clearFetched(id, staleUuid)`, which matches on the stale uuid so a fresh stamp written in between is never erased), and the row replays exactly as an unstamped row does today.

The `queued` arm (first delivery, park retries) is unchanged. Putting the uuid test in SQL instead would need the registry inside the store, which reads no registry today.

**A stamped row keeps today's lifetime bound.** Today a `delivered` row that is never acked leaves the outstanding states at the replay ceiling: each successful replay bumps `replayCount`, and the twentieth parks the row `rejected` / `undeliverable` with `MAIL_REPLAY_CEILING_ERROR` (`watch.ts#sweepMail` ≈:8070-8083). Skipping the replay alone would remove that park, and a stamped row would then stay `delivered` until it is acked, or until `cancelOutstandingDeliveries` parks it when its run closes (≈:2816-2820). Run-less mail (peer mail, the program kickoff, digest corrections, run-less notices) has no run to close, so a fetched-but-unacked run-less row would stay outstanding forever, and every `OUTSTANDING_STATES_SQL` holder below would carry it forever. Fetching without acking is exactly what the audit says is common.

So `sweepMail` gains one pass, beside the parked-row ceiling (≈:7545-7560), after the registry read: every `delivered`, unacked row with `fetchedAt` set whose **replay bound** has passed, **and whose `fetchedUuid` is still `uuidByToId.get(toId)`**, is parked through `rejectDelivery(id, 'undeliverable', MAIL_REPLAY_CEILING_ERROR)`, with nothing typed and no sender told (the replay ceiling tells nobody today either). The bound is

    MAX(COALESCE(ingestedAt, 0), COALESCE(deliveredAt, 0)) + (MAIL_REPLAY_MAX_ATTEMPTS − replayCount) × MAIL_REPLAY_MS <= now

which is the earliest moment today's replays could have reached the ceiling from where the row stands: one `MAIL_REPLAY_MS` per replay still owed, from the same clock `dueDeliveries` uses. For a row stamped before any replay it is `MAIL_REPLAY_MAX_ATTEMPTS × MAIL_REPLAY_MS`, about 3 h 20 min after its last delivery. Subtracting `replayCount` is what keeps the lifetime today's and not longer: a row fetched after its nineteenth replay parks ten minutes later, as it would have today. The store read is `CoordStore.fetchedPastReplayBound(now, replayMs, maxReplays)`, with the two constants passed in from `watch.ts`, where `MAIL_REPLAY_MAX_ATTEMPTS` is private. It returns `fetchedUuid` with each row. A row whose uuid no longer matches is not parked: its stamp is cleared as above, it replays, and today's replay ceiling parks it on today's schedule.

The park is the existing one, byte for byte: the same writer, the same `rejectCode`, the same `lastError`. So its I2(b) ackability, its I2(a) visibility (shown while its run is live, hidden once it closes) and `requeueAbandonedMail`'s reach over it are all exactly today's. Only the nudges between the fetch and the park are gone.

**A repoint clears the stamp.** `repointCoordinatorMail` (≈:2210-2216) is the one writer that changes a delivery's `toId` in place: a program reclaim moves outstanding coordinator mail to the heir. A stamp is a fact about the old recipient, so the repoint sets `fetchedAt = NULL, fetchedUuid = NULL` in the same statement, and the heir is nudged and replayed like any fresh recipient. Without it, a brief the outgoing coordinator fetched would reach the heir silently.

**A printed delivery is acked,** and an acked row is terminal, so it never replays. A delivery printed but not acked (the ack failed) is **not** stamped. It replays, and the next `mail inbox` prints it again. That is deliberate: a repeated nudge costs one turn, while a silenced one can lose a brief.

Consequences, checked against every reader of the row's state:

| Reader | Effect of a stamped, unacked row |
|---|---|
| The replay ceiling (`watch.ts` ≈:8070-8083) | Not reached, because a stamped row is not replayed. The bound pass above parks it at the moment the ceiling could first have, with the same `rejectDelivery` call. |
| The stall watch's coord-deaf arm (`server/src/coord/stall.ts#stallDeafMail`, ≈:925-958) | `deafSince` is `deliveredAt − replayCount × MAIL_REPLAY_MS`. With no further replays, both terms stop moving, so the estimate stays at or after the first delivery, as its docstring requires. A coordinator that fetched a `wave-done` and never acked it is still reported deaf at `COORD_DEAF_MS`, before and after the bound park (the arm reads `ackedAt`, not the state). |
| The `ingestedAt` edge (`sweepMail`, ≈:7509-7532) | Unchanged. It still samples every `delivered` row. |
| The hibernated wake (D-5242) | A stamped row no longer wakes a sleeping recipient while the uuid that fetched it is current. `wakeAdmit` is untouched. A hibernated session keeps its uuid, so a sleep does not re-arm the replay. |
| A `/clear`, a fork or a reused name after the fetch | The registry's uuid for `toId` changes, so the next sweep clears the stamp and the row replays to the new context as an unstamped row does today. A fork whose context did carry the mail costs one extra nudge, which is the safe direction. |
| A compaction after the fetch | The uuid does not rotate (`_sync_uuid`'s own comment), so the stamp stands and the replay stays silent until the bound, although the summary may have dropped the body. This is the residual Q2 asks the operator to rule on. |
| `MailStrip`, `unreadMail`, `mail list` | Unchanged. The row is still unacked, so it is still shown, and after the bound park it is shown as abandoned while its run is live, as a ceiling park is today. |

**Every `OUTSTANDING_STATES_SQL` holder, walked.** The store lists them itself (`store.ts` ≈:2311ff). Each reads the row's `state`, so each sees a stamped row as outstanding until it is acked or the bound parks it, and never longer than today's ceiling would have allowed.

| Holder (file order) | What a stamped, unacked row does to it | After the bound |
|---|---|---|
| `OUTSTANDING_OR_ABANDONED_SQL` (≈:1452) and its readers `outstandingMailFor`, `unreadMailCount`, `runHealth`'s kickoff-wedge query, `mailForProgram` | Shown as outstanding. | Shown as an abandoned park while its run is live, hidden once it closes: today's ceiling park. |
| `writeDeliveries`' `'outstanding'` guard (≈:5373) and its writers `cancelKickoffsTo`, `repointCoordinatorMail`, `parkSupersededDeliveries`, `cancelOutstandingDeliveries`, `cancelDeliveriesTo`, `parkDelivery`, `holdParked`, `wakeParked`, `markParkEscalated`, `absorbParkEscalation`, `baselineParkBox` | Each still matches it. The cancels and parks end it as today. `repointCoordinatorMail` moves it and clears the stamp (above). The `parkDelivery` family is `deliveredAt IS NULL`-scoped and never selects a delivered row. | Terminal; none matches it, as today. |
| `requeueAbandonedMail` (≈:2449, ≈:2461) | Its dedupe counts the row as the heir's outstanding copy, as today. | The coordinator arm's `ABANDONED_PARK_SQL` source selects the park and re-queues a fresh, unstamped row to the heir, as today. |
| `runHealth`'s outstanding and parked counts (≈:4405-4410) | Counted in `mailOutstanding`. | Moves to `mailParked`, as a ceiling park does. |
| `hasOutstandingMail` (≈:5271-5277) | `queueSystemMail` (`rundefsTx.ts` ≈:78) drops a repeat of the same `(fromId, runId, toId, subject)`, and `digest.ts` ≈:209 answers `duplicate` for a correction the coordinator fetched and did not ack. | The slot frees, so the system mail or correction can be queued again, as today after the ceiling. |
| `hasOutstandingPeerDuplicate` (≈:5315-5323, `routes.ts` ≈:995) | A peer mail with the same subject is refused `duplicate`. | Frees. |
| `outstandingPeerCount` (≈:5330-5336, against `PEER_MAIL_MAX_OUTSTANDING` = 3, `shared/api.ts` ≈:5386; `routes.ts` ≈:999-1001) | The row holds one of the three peer-quota slots from its sender to this recipient. | Frees the slot. Without the bound, three fetched-but-unacked peer mails from A to B would refuse every later A-to-B peer mail `peer-quota`, permanently. |
| `autoContinueHeldUntil` (≈:5737-5745) | Reads only rows whose `lastError` is the auto-continue hold. `markDelivered` does not clear `lastError`, so a row held once and then delivered can still match, with a `nextAttemptAt` already in the past. That is any delivered row today, for the same lifetime. | Terminal; no longer matches, as today. |
| `parkedDeliveries` (≈:5857-5861) | `deliveredAt IS NULL`-scoped: never selects a delivered row. | No effect. |

The bound read selects `state = 'delivered'` directly, a single state, so it is not a holder of the fragment. If the implementation spells it through `OUTSTANDING_STATES_SQL` instead, it becomes one and joins the store's own walk (≈:2311ff) in the same PR.

### 3.7 The nudge and the skills

**The nudge has two forms, chosen at send time.**
- The inbox form: `ccrc-mail: you have new mail. Read it with ~/.local/bin/ccrc-api mail inbox, by that exact path, since ~/.local/bin is not on this unit's PATH. Run it bare: no pipe, no redirect, no head or tail. It prints every unread mail addressed to you and acks each one it printed. Use the client, never curl or raw HTTP; it resolves the server address and reads the box token itself.`
- Today's form, unchanged, for a fleet whose client predates the verb.

`fleetCarriesMailInbox(role, own, fleet)` chooses, in the shape of `fleetCarriesRunsAttribution` (`server/src/fleetstate.ts` ≈:249-278): `true` on a `both` box, when the builds agree, or when the fleet stamp's release tag is at or past `MAIL_INBOX_SINCE` (L0, set to the release that ships the client verb). Anything else keeps today's form.

- **Run it bare, said in the nudge itself.** A piped run acks nothing (§3.5 step 2), and a redirected one acks mail the session may never read (§4). The nudge is the one text every reader sees before the call, so the rule rides there and in the skills, not only in the client's own output.
- **The switch also waits for the PWA's inbox cards (§3.8).** Until the server serves a PWA that renders an inbox print as mail cards, switching the nudge would move most mail reads to a form the operator's transcript view shows as plain tool output.
- **Why a floor and not the date of a merge:** the nudge is the only protocol text guaranteed current in the recipient's pane (`envelope.ts` ≈:132-136). A nudge naming a verb the box's client refuses is the wedge D-791 describes, again.
- **The 24-character head is byte-identical** (`ccrc-mail: you have new `), so `sendPrompt`'s echo needle does not move. The inbox form carries no `toId`, because the client derives identity from the pane.
- **The park's own-nudge check accepts both forms.** `sweepMail` resumes a parked box only when it holds exactly the lane's own nudge (`watch.ts` ≈:8052, `box !== renderMailNudge(d.toId)`). A row parked under one form and retried under the other must still match, so the check reads "either form the lane may have typed".

**The skills, references and README teach `mail inbox` first,** and keep `list`, `fetch` and `ack` as the fallback for a server without the route:
- Every skill that names the verb says to run it bare: no pipe, no redirect, no `head` or `tail`, and that the footer lists the deliveries it acked, for `mail fetch <delivery>` if the text was lost.
- `ccd/worker-skill/SKILL.md`: "Reading mail is three calls, not one" (≈:218-222) becomes one call. The pinned ack clause (`worker-skill.test.ts` ≈:60) still says "ack before you act", and now says that `mail inbox` does it. Its "replays `MAIL_REPLAY_MAX_ATTEMPTS` (20) times" half becomes true only of a delivery nobody fetched.
- `ccd/coordinator-skill/SKILL.md`: clause 3 "Wake on mail" (≈:291-299), and the stdout and exit-code paragraphs (≈:141-155).
- `ccd/reviewer-skill/SKILL.md`: the ack clause (`reviewer-skill.test.ts` ≈:22) and the exit-code sentence (≈:143).
- `ccd/coordinator-skill/references/wave-lifecycle.md` §3 and `references/mail-envelope.md`, which quote the old nudge and teach the three calls.
- `README.md`: the client's verb list (≈:3616) and its mail paragraphs.

The pinned clauses change in the same PR as their tests. A clause is a mechanism here, not a comment.

**Unchanged on purpose:**
- The envelope's `ack:` lines (`renderEnvelope`, ≈:84-87), because a `fetch` reader still needs them, and stored envelopes are never re-rendered.
- The hold card's `mail list --to <id>` (`ccd/session-hook.sh` ≈:917). It is a read-only pointer, and pointing it at `mail inbox` would ack a brief from a diagnostic card.

### 3.8 The PWA keeps its mail cards

**What exists.** The operator's transcript view turns a session's own `mail fetch` into a mail card. `buildChatItems` (`pwa/src/session/chatItems.ts` ≈:78-110) runs `parseFetchedMailEnvelope` (`shared/api.ts` ≈:5601) on every `tool_result` that is neither an error nor truncated, and pushes a `{kind: 'mail'}` item that `ChatList` renders as `MailCard` (`pwa/src/session/ChatList.tsx` ≈:76). The parse accepts only a result that is one whole `ccrc-mail` fence, or the fetch route's JSON with an `envelope` string. An inbox print is neither, by design (§3.4), so without a change here mail read the default way would stop showing as a card once the nudge switches.

**The change.** A pure parser in L0, `parseInboxPrint(text)`, beside `parseFetchedMailEnvelope`, and a second arm in the same `tool_result` branch of `buildChatItems`, tried only when `parseFetchedMailEnvelope` did not answer `ok`. It shares the two guards that arm already has (`isError`, `truncatedBytes > 0`). Each well-formed entry becomes one `{kind: 'mail'}` item, keyed `mail-<toolId>-<n>` by its place in the print. No new `ChatItem` kind and nothing minted into the store, so the revival rule the `mail` member's docstring states still holds.

The parser's rules, each one there to keep a forged or cut entry out of a card:
- An entry opens on a line that is a run of at least three backticks followed by exactly `ccrc-inbox`, and closes on the first later line that is the **same** run and nothing else. Because `fenceFor` makes the fence longer than any backtick run in the entry (§3.4), a body cannot hold that line, so a forged `ccrc-inbox` fence inside a body stays body text.
- The header is walked in the renderer's order (`delivery`, `from`, `to`, `kind`, `subject`, then `run` and `artifacts` when present, then `--`), and refused at the first line that does not fit. Everything after `--` is body, verbatim.
- Outside the entries, only blank lines and lines that start with `inbox: ` or `ccrc-api: ` (the client's own notes, which reach the same capture, §1.2) are allowed. Anything else, including a `| grep` or `| tail` cut that leaves a fragment, makes the whole print `not-inbox`: no card from that result. A print whose last entry has no closing fence is the same.
- An entry whose stored envelope was malformed is printed verbatim (§3.4) and is not a `ccrc-inbox` fence, so it gives no card, as a malformed fetch gives none today.
- A `kind` outside `MailKind` refuses the entry, as `parseMailEnvelope` does.

**What a card claims.** Exactly what a fetched card claims, and no more: the text in the transcript, which is rank-3 (the `parseFetchedMailEnvelope` docstring's caveat applies word for word). A forgery makes one bubble look like mail. `MailCard` takes the card fields without the mail id (`MailCardFields`, the `MailEnvelope` fields less `id`), because the inbox entry prints only the delivery id (D-41) and `MailCard` reads no id (`ui/src/components/mail-card.tsx` ≈:55-87). The card has no control, as today.

## 4. Safety: what is kept, and how

- **The caller's identity.** The inbox and the ack it drives use the pane-derived pair only, and a fetch stamp carries the uuid the server verified, so it never speaks for a later context under the same name (§3.6): `TMUX_PANE` validated as a pane id, the session name held to `SAFE_RE`, the uuid read from `$REG/<id>.uuid`. No flag selects another session. The server re-measures the pair against the registry (`attributionVerdict`) and selects only rows whose resolved `toId` is the caller. Identity on this fleet is attribution, not authentication, and this is as strong as the ack route, no stronger (CLAUDE.md, SAFETY). `mail fetch` gains attribution without gaining a refusal: `try_derive_identity` never refuses, so a pane that cannot be derived fetches unattributed as today (§3.5), and the server serves the envelope whatever the verdict (§3.6).
- **Delivery id, never mail id.** The server hands the client each `deliveryId` as a JSON number. The client never parses an id out of rendered text, and the entry prints only the delivery id.
- **The hibernated wake budget.** No new wake source. The inbox runs only in a session that is awake. Its acks, and a recipient's stamped fetch, can only remove automatic wakes. `wakeAdmit`, `WAKE_BURST` and `MAIL_WAKE_FLOOR_MS` are unchanged.
- **Coordinator-first routing (D-5298).** Coordinator mail is resolved to a session when it is queued, so the inbox reads it like any other. Approval nudges (`approval:<id>`) and ask nudges (`ask:<n>`) are ordinary rows. Acking one changes no approval or ask state: no approvals-lane or asks-lane code reads `ackedAt`, measured with `grep -rln ackedAt server/src` (the only readers are `watch.ts`, `stall.ts`, `store.ts` and `schema.ts`). The coordinator still rules through `approvals rule`. The 180-second late-answer window is a property of the approvals lane, which this spec does not touch.
- **Terminal states.** The ack goes through `markAcked` and its single `WHERE` (D-1410, I2(b)). The stamp goes through `writeDelivery` with the `'non-terminal'` guard. A stamped row's lifetime is bounded by the same park the replay ceiling writes today, through the same `rejectDelivery` call (§3.6), so no row outlives today's ceiling and every `OUTSTANDING_STATES_SQL` holder frees when it does today. A repoint clears the stamp, so a reclaim's heir is replayed like any fresh recipient. `writeDeliveries` stays the one writer (D-5997), and the census gains the new method by name. An out-of-vocabulary state token is treated exactly as `markAcked` treats it today. That question stays open (D-1406), and this spec does not decide it.
- **Kill switches.** `mail-disabled`, `mail-gate-strict` and the stall-watch markers keep their meanings. None gains a writer.
- **The closed client.** One new row (`mail.inbox`, a fixed path, no caller text in the URL beyond the `SAFE_RE`-checked pair the client derives itself). The token rides curl's stdin on every request, the read and each ack. The row count in the header and at `ROUTES` becomes thirty-two, and `ccrc-api-closed.test.ts`'s body-fill census names the synthesized ack body.
- **Masking.** Every rendered entry goes through the same masker as `GET /api/mail/:id` (D-5513) before it leaves the server.
- **Fail toward showing, never toward acking, as far as the client can see.** The invariant is **nothing is acked whose write failed**: a failed print stops the loop with nothing acked after it. It is not "nothing is acked that the session did not see", because a write that succeeded proves only that the bytes reached fd 1. Under the tool, fd 1 is the tool's own capture (§1.2), so there the two coincide. Where fd 1 is something else the client knows about, it does not ack: a pipe or `/dev/null` makes the run show-only (§3.5 step 2). A failed ack leaves the row unacked and unstamped. An envelope that does not parse is printed verbatim. A registry that cannot be read refuses the read, and nothing is acked. A row the mailbox no longer shows (a replay-ceiling park of a closed run) is never printed, so the inbox cannot present a closed run's brief as live (§3.3 step 3). A stamp counts only for the uuid that fetched (§3.6).
- **Residuals, named.** Three cases still lose the replay of mail a context may not have read. None is new in kind, since a session can ack by hand without reading today, and each has a recovery.
  - **A redirect to a file** (`> f`, `>> f`, `> f 2>&1`). fd 1 is a regular file, which is exactly what the tool's own capture looks like (§1.2), so the client cannot tell them apart and acks every entry it wrote. The text is in the file the session chose, so it is not lost, only unread until the session reads that file. The nudge and the skills say to run the verb bare (§3.7), and the footer names every acked delivery for `mail fetch`. Plan MI-7 pins this case as the residual, so a later change to it is a decision and not a drift.
  - **The tool's display cut.** The tool may show less than its capture holds. The page budget (§3.3 step 4, Q5) keeps a page under the limit the operator sets, and the footer names the acked deliveries.
  - **A compaction after a fetch** keeps the uuid, so its stamp still silences the replay until the bound (§3.6, Q2).

## 5. Rings and contexts

- **L0 (`shared/api.ts`):** `MAIL_INBOX_PAGE_MAX_BYTES`, `MAIL_INBOX_SINCE`, `MAIL_INBOX_FENCE_INFO`, the wire types `MailInboxEntry` and `MailInboxAnswer`, the fetch marker words, `MailCardFields` and `parseInboxPrint` (pure, beside `parseFetchedMailEnvelope`). Nothing is imported.
- **PWA (`pwa/src/session/chatItems.ts`) and UI (`ui/src/components/mail-card.tsx`):** the second `tool_result` arm, and `MailCard`'s prop type narrowed to `MailCardFields`. No new file, so no new ring entry.
- **L1:** `renderInboxEntry` beside `renderEnvelope` (`server/src/coord/envelope.ts`, pure). The page cut, `pageInbox(entries, budget)`, is pure too. `fleetCarriesMailInbox` sits beside `fleetCarriesRunsAttribution`.
- **L3 (`CoordStore`):** `inboxFor(toId)`, `abandonedCount(toId)`, `markFetched(id, at, uuid)`, `clearFetched(id, staleUuid)`, `fetchedPastReplayBound(now, replayMs, maxReplays)` and the hoisted ackable guard. All synchronous, with no repository layer (CLAUDE.md, Coordination).
- **L4 (`routes.ts`, `watch.ts`):** the inbox route, the fetch stamp, the uuid test against the registry the sweep already read, and the nudge choice at send time. Delivery code composes and decides nothing.
- **Context:** Coordination (mail). Nothing crosses into another context.
- **Consolidation:** no second mechanism. One renderer family (`envelope.ts`), one ack door, one attribution check, one writer, one replay predicate, and one fleet-capability shape. The ackable predicate is hoisted and shared, not copied.

## 6. Wire and deploy

- **New route:** `GET /api/mail/inbox`, box-token gated, in `auth/gate.ts`'s `EXEMPT` with its reason, and in the box-token census.
- **Additive fields:** `fetch` on `GET /api/mail/:id`'s answer; `fromId` and `fromUuid` accepted in its query.
- **coord.db:** migration 30 adds `mail_deliveries.fetchedAt` and `mail_deliveries.fetchedUuid`. An older server reads a newer database (`db.ts`'s rule for a higher `user_version`) and ignores the column, so a rollback replays fetched rows again. That is the safe direction.
- **No `FLEET_PROTO` bump.** Nothing new rides the agent link.
- **Order** (plan §Waves): the callers' opt-in (fleet), then the clean default (fleet), then the server half (route, stamp, replay predicate), then the client verb and the skills (fleet, released only once the server runs the route) and the PWA's inbox cards (server), then the nudge switch (server, its floor set to the client verb's release tag, and only once the inbox cards are served).

## 7. Alternatives rejected

- **Ack on read in the server.** It acks what the reader never saw (§3.2).
- **A client loop over list, fetch and ack.** It reprints rows that cannot be acked, reads an unattributed list, and moves rendering into bash (§3.2).
- **Delete the stderr status line outright.** Two in-tree parsers need the exact code, and the opt-in costs one line.
- **A `--status` flag.** Every older client refuses it as `unknown-query`, which breaks the hook during an install window. An environment variable is ignored by old clients.
- **Map 4xx and 5xx to non-zero exit codes now.** It breaks a contract three skills teach and turns refusals into failed tool calls. It is left to the operator (Q1).
- **Server-rendered `text/plain` with length-prefixed frames,** to keep the client `jq`-free. Reading byte counts in bash is fragile with multi-byte text, and every fleet box already has `jq` (§3.5).
- **Stamp `fetchedAt` when the inbox reads a row.** A print that then fails would silence the replay of mail nobody saw.
- **A stamp without the uuid.** A `/clear`, a fork or a reused name would inherit a silenced replay for mail the new context never saw (§3.6).
- **Ack only when fd 1 is a regular file.** It would also refuse to ack under any harness that captures through a socket, and it still cannot tell `> f` from the tool's own capture. The pipe test catches every shell pipeline, which is the measured problem, and nothing more.
- **A second confirming call** (`mail inbox` prints, and a later `mail inbox --ack <ids>` acks). It doubles the calls this spec exists to remove, and the reader's confirmation is no better evidence than the tool's capture: a session that piped the print can confirm just as easily.
- **Leave the PWA as it is and accept the lost cards.** Mail read through the default path would vanish from the operator's transcript view as cards, an existing feature, for the price of one parser (§3.8).
- **Stop replay at the `UserPromptSubmit` edge.** That edge proves a turn started, not that the mail was read. It already moves the replay clock, and that stays.
- **Re-render the entry from the mail row's columns.** The stored envelope is the record of what was queued, and the inbox shows it.

## 8. Questions for the operator

1. **Exit codes.** Keep "exit 0 whenever a response arrived" (recommended: three skills, two measurers and the hook depend on it, and a non-zero exit invites retries), or move a 4xx to exit 4 and a 5xx to exit 5, keeping the body on stdout?
2. **A fetched delivery that is never acked.** No replay while the uuid that fetched is current, and the ceiling park at the moment today's replays would first have reached it (recommended, §3.6: the stall watch still reports a deaf coordinator, `MailStrip` still shows the row, and every outstanding-state holder frees on today's schedule), or one reminder in between, for example 60 minutes after the fetch? A `/clear`, a fork and a reused name rotate the uuid and re-arm the replay either way. **The residual this question rules on is compaction:** the uuid does not rotate, so a session that fetched, then compacted with the body dropped from its summary, gets no nudge until the bound parks the row, up to about 3 h 20 min. A reminder would cover it at the cost of one turn per fetched-but-unacked row.
3. **The old verbs in the skills.** Keep `list`, `fetch` and `ack` documented as the fallback for a server without the route (recommended), or drop them from the skills once every box carries the verb?
4. **The non-2xx stderr line.** Keep `ccrc-api: the server answered <code>` by default (recommended), or make stderr silent on every answer unless `CCRC_API_STATUS=line` is set?
5. **The page budget.** Twenty KiB assumes the shell tool shows at least that much before it truncates. Is any account on the fleet configured with a lower output limit? If so, the budget should be lower.
6. **The acceptance bar.** Re-run the transcript audit seven days after the nudge switch. What share for mail reading counts as done (for example, under 0.5% of fleet spend), and should coordinators' polling share be a second bar?
7. **The fleet's Bash tool capture.** §1.2 measured fd 1 as a regular file on one build (2.1.308, darwin). Plan MI-7 Step 0 re-measures it on the fleet's build. Should the client also refuse to ack on a build where the capture is a FIFO, which makes `mail inbox` show-only everywhere until a client change (recommended, the safe direction), or is there a build you want acks to keep working on regardless?
8. **CI and PR polling (3.8%).** Is a follow-up spec wanted, for example a server-side watch that mails the coordinator when a PR's required checks finish, so that `gh pr checks` loops end?

## 9. Out of scope and follow-ups

- CI and PR polling, and sleep loops (Q8). The same rule applies: the server already measures PR state (`.prhistory`, the PR sweep), so a mail on a state change would replace a poll.
- Showing "read, not acked" in `MailStrip`. `fetchedAt` makes it measurable, and adding it to `MailSummary` is one additive field. It is left for a PWA task.
- Retiring the envelope's `ack:` instruction. That waits until no reader uses `fetch`.

## 10. Review log

**rev 0 (2026-10-24).** Written against `origin/main` `10813b401`. The task said the client prints `http NNN` on stdout. The code shows stderr since its first commit (§1.2), and §3.1 is written for what the code does.

**rev 2 (2026-10-24), review round 2.** Three findings, all taken.
- The headline invariant rested on "the write succeeded, so it was seen", which holds only when fd 1 is the tool's own capture. Under `| tail`, `| grep`, `| jq .` or `> f`, a page fits the pipe buffer or the file and every write succeeds. §2 and §4 now state the invariant as "nothing is acked whose write failed". §1.2 measures fd 1 under the tool (one regular file with fd 2). §3.5 makes a pipe or `/dev/null` show-only and lists every acked delivery in the footer, and §4 names the redirect to a file as a residual. The nudge and the skills say to run the verb bare.
- The fetch stamp did not record which incarnation fetched, so a `/clear`, a fork or a reused name inherited a silenced replay. The stamp now carries the verified uuid (`fetchedUuid`), and the replay skip and the bound park apply only while the registry's uuid for the recipient still matches. Q2 names compaction, where the uuid does not rotate, as the residual.
- Inbox entries carry a different info string, so the PWA's transcript cards, built from a session's own `mail fetch`, would have stopped for mail read the default way. §3.8 adds `parseInboxPrint` and a second `tool_result` arm, the entry gains a `to:` line for the card, and the nudge switch waits for the cards.

**rev 1 (2026-10-24), review round 1.** Four findings, all taken.
- The plan's further decisions carried placeholder numbers, which `dtbd.test.ts` refuses on any tracked file. The plan defines them from one contiguous ledger block, substituted in this PR before it merges.
- §3.6 removed the replay-ceiling park for a fetched row without walking the `OUTSTANDING_STATES_SQL` holders. Run-less mail would have stayed outstanding forever, holding peer-quota slots and system-mail dedupe keys. §3.6 now keeps the lifetime bound with a no-nudge park and walks every holder. The walk also found `repointCoordinatorMail`, which moves a row to a new recipient in place, so a repoint now clears the stamp.
- §3.3 defined the inbox as the ack guard alone, which admits a replay-ceiling park of a closed run that the mailbox hides (I2(a)). The inbox set is now the guard AND `OUTSTANDING_OR_ABANDONED_SQL`, and the rule is stated in step 3.
- §3.5 made `mail fetch` refuse in a pane whose identity cannot be derived, which narrowed today's read. It now uses a non-refusing derive and fetches unattributed, with a note on stderr.

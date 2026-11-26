# Wave 178: the paste delivery recipe, from the console's send to the model

Task note for desktop-polish wave 178 (Goals modification 90, the half still open: a long or multiline prompt sent from the
console reaches the model intact, as one prompt, once). Wave 167 measured the browser half, from the clipboard to the request
(`paste-reliability.md`). This wave builds the measurement of the rest of the path. That is the server's send, the pane,
Claude Code's own input box, and the prompt body and the count the model receives. It is a second recipe on the build
capture runner (`docs/superpowers/specs/2026-11-22-build-capture-runner-design.md`), whose owner, the Overlord coordinator,
ruled its place and its conditions. Claims are labelled **measured**, **read** (from the code) or **inferred**.

## 1. In short

- **What this PR is.** A recipe, its pure verdict, and the driver that runs the product's own send on a test box
  capture; the capture runner's wiring of the recipe, in three parts; and the lane that queues it, the result's table and
  the build list's read of it (section 8). Each capture file came to the capture owner as a packet first, and each held
  file's hunk to its holder.
- **No real fault has been reproduced, and no send code changed.** Every fault the tests show comes from a fake build
  written to show it, not from Claude Code.
- **The first real measurement starts by itself.** Once a release carrying the whole recipe reaches the test box, the lane
  queues a delivery capture for the newest build that passed trust. Nobody starts it by hand, and there is no door
  (section 7).
- **The result is information only.** It decides no build's trust, no roll and no lane verdict.
- **A leading `!` is a shell line, by design (the operator, 2026-11-25, item 667).** A console message that starts with `!`
  is typed into Claude Code's box as written and runs as a shell line in that session, as it does in the terminal. The
  operator keeps that on purpose, to run shell commands from the console. No send code changes, and no case starts with
  `/`, `!`, `#` or `@` (section 6). Nothing was run.

## 2. The send path, and where the recipe joins it (read)

The console's send is the composer's `value.trim()`, then `POST /api/sessions/:id/prompt` (`server/src/server.ts`). The
route's checks do not touch the text: a known id, the designation, a renewing session and the attachments. For a plain
prompt it calls `sendPrompt(sendDeps, id, body.text, {onDraft: 'refuse', attachments: []})`, in
`server/src/inject/send.ts`. `sendPrompt` runs `composePrompt`, which strips leading blank lines, then its box guards. It
types one `Tmux.sendLiteral` per line, with `M-Enter` between lines, checks the echo, and submits through `submitEnter`. The
`Tmux` adapter (`server/src/exec.ts`) runs `send-keys` and `capture-pane` through a Runner. On the fleet that Runner is the
agent link: the agent's exec op checks its allow list, routes the socket and calls `execFile` with the same argv.

**Finding (wave 178, step 1).** The capture runner could not reach this path. It lives in the agent package, which never
imports server code. Its launcher types with its own `send-keys -l` and Enter, which is a copy of the typing. And
`capture.submit` carried only a capture id and a build.

**The join.** `sendPrompt`'s runtime imports are small: `send.ts`, the pane readers, `sessionReading.ts`, and `exec.ts`
with its own runtime imports. That is about thirty files, node built-ins only, no npm package. They are already in
`server/dist` in every release tarball (`deploy/build-release.sh`). The installer places the whole release tree on the
test box, and the test service runs from it (`deploy/testbox/bin/tools-sync#_tbt_place_release`,
`deploy/testbox/systemd/ccrc-testbox.service`; read). So the recipe adds one server entry point,
`server/src/inject/deliveryDrive.ts`. It builds the real `Tmux` class over a Runner bound to the capture's private server,
and a real `KeyedQueue`. It calls the real `sendPrompt` with the route's plain-prompt options, for one case named by its
id, and prints the send's answer word. The capture runner runs it compiled, as a bounded child, and names it by path
without importing it. That is the recorder's precedent.

## 3. The cases

The cases are the browser wave's synthetic cases (`paste-reliability.md` section 3), rebuilt by the same rules in
`shared/deliveryCapture.ts`. A test pins each case to the sizes that note recorded: code points, lines, and bytes for c4
and c4b. The cases are a short control (c0), a long ASCII line (c1), a long first line then two lines (c1b), a typed prefix
then a paste (c2a, one string by the time it leaves the browser), a prefix line, a long line and a tail line (c2b), and
indentation, tabs, trailing spaces and blank lines (c3, c3b, c3c). They also include Unicode, with combined, wide,
right-to-left and emoji characters (c4, c4b), and CRLF (c5).

**The sent text** is the composer's output: line breaks read as LF, then `trim()`. **The expected text** is the send path's
own compose step over it, `composePrompt(sent, [])`. Those normalisations are the product's documented ones (wave 167
measured the field's CRLF and the trim). Any other difference is reported as a divergence, not explained away.

**No case starts with a mode switch.** After the trim, no case's sent or expected text begins with `/`, `!`, `#` or `@`, and
a test pins that (section 6).

## 4. The oracle and the verdict

The stand-in model answers every delivery request with a short text that ends the turn. It keeps every request body in
arrival order. A **turn** is a Messages API request that offers tools and whose last message is the user's, with text and
no tool result. Its **prompt** is that message's text blocks, less any block that is wholly a system reminder. Every other
request is a **side request**, counted apart. Each case owns a window that runs from its send to the build's Stop, or to
the settle bound if no Stop comes, plus a quiet period. A late second submit still falls inside the quiet period. The
build's own UserPromptSubmit hook gives a second witness, reported and never judged.

Each case is judged by one verdict:

| Verdict | When |
|---|---|
| `intact` | the send answered ok, and one turn arrived, equal to the expected text |
| `refused` | the send refused, and nothing reached the model: honest, not silent |
| `duplicate` (fault) | two or more turns, each equal |
| `split` (fault) | two or more turns, not all equal |
| `altered` (fault) | one turn, unequal; the first divergence is given (code point index, 40 code points of context each side) |
| `false-confirmation` (fault) | the send answered ok, and no turn arrived |
| `partial` (fault) | the send refused, yet something reached the model |

The recipe's word is `fault` if any case is a fault, else `refused` if any case was refused, else `intact`. A **fault of the
box** is no verdict, and the lane retries it under its existing back-off. That covers a step before the cases that does
not finish, a driver that does not answer or refuses its input, and a build that is gone, or whose life is unknown, during
the cases. The result (`shared/deliveryResult.ts`) carries the recipe it echoes, the recipe's version, the build, the word
and every case. It has one reader, `readDeliveryCaptureResult`. The **version** is computed: a hash of every case's sent
and expected text and of what the rule answers on a fixed probe table. It is never a number kept by hand.

## 5. What the fixtures show (measured, fake build only)

The runner's tests drive a fake build (`agent/test/fixtures/fake-delivery-build.mjs`), never Claude Code. A fake driver
types each case's text into it. The tests show:
- A build that receives every prompt reads `intact`, with all eleven cases equal and once each.
- A build that asks for every turn twice reads `duplicate`. One that sends each line as a turn of its own reads `split`
  on the multiline cases. One that cuts every prompt at 100 code points reads `altered` at index 100. A send that answers
  ok with nothing received reads `false-confirmation`. A refusal with nothing received reads `refused`.
- No verdict comes back, and both directories are removed, for a driver that fails, a driver killed at its bound, a build
  that exits during the cases, a build killed during the cases, and a build that never starts.

These faults are the fake build's, written to show the verdicts. **No real fault was reproduced.** The driver itself is
tested against a fake box over the real `sendPrompt`: a one-line case and a multiline case are each typed and submitted
once.

## 6. The first-character mode switches (read; nothing run)

Claude Code's input box reads some first characters as a mode switch. In its documented input modes, `/` starts a slash
command, `!` a shell line, `#` a memory note in some versions, and `@` a file mention. **Read:** the composer sends
`value.trim()`, the route passes `body.text` through unchanged, `composePrompt` strips leading blank lines only, and
`sendPrompt` types the first line literally. Nothing in `pwa/src`, `server/src` or `shared/` refuses, escapes or
neutralises a leading one of the four.
- `/` passes on purpose. The composer has slash completion, the dispatch types `/clear` through the same send, and the
  send's loops treat the slash palette as a menu.
- `!` passes **on purpose**: the operator confirmed it on 2026-11-25 (item 667). A console message that starts with `!` is
  typed into the box and, on the send's Enter, runs as a shell line in that session's pane, as it does in the terminal.
  The trim makes ` !x` arrive as `!x`, so it is the same choice.
- `#` is unguarded. Whether the current build reads it as a memory note is unmeasured.
- `@` opens the file-mention picker. `submitEnter` already presses a second Enter when an overlay swallows the first.

The coordinator put the choice to the operator (item 667), who ruled to keep it: no send-path change, now or later, and no
guard wave. The recipe's fixed cases stay clear of all four first characters, and `deliveryCapture`'s mode-character pin
holds that, so no case can become a shell line in the capture's pane.

## 7. How the real measurement starts and is read (the rulings, built in this PR)

There is no door (the capture owner's call 1131): every session holds the box token, so a box-token start would let any
session run a build on the test box on demand. Instead:
- The capture lane measures only the single newest build whose trust capture ended with a pass, and only while the capture
  lane itself is live (nothing in shadow, no switch of its own). There is no back-fill: an older passed build is not
  measured, and a build superseded before its delivery capture runs is never measured. So the record is "the newest
  trusted build", not "every build" (the capture owner's call 1145).
- **Parts** (the capture owner's call 1148). The eleven cases run as parts, each a capture of its own, with a fresh scratch
  directory and a fresh start of the build. The part count is derived, not chosen: it is the smallest count whose largest
  part fits the pair bound (the second of two queued captures ends inside the fleet agent's 15 min wait) in every pairing
  with a trust capture or another part. The cases are spread evenly in their order. Today that is 4, 4 and 3. A change to
  a timing or to the case list re-derives the split, and the recipe version covers it, so rows from two partitions never
  join.
- **Where the count lives** (call 1159). The derivation is the agent's (`captureDelivery.ts#deliveryPartCount`, from the
  one timing object and the case list). The server's lane needs the count and cannot read the agent's timings, so
  `shared/deliveryResult.ts#DELIVERY_PART_COUNT` writes it once, and the capture deadline test (gate G1) holds it equal to
  the derivation, in the same case as the build-trust pair. **Measured red both ways:** the shared count set one more (4)
  and one fewer (2) each fails that file alone. **Searched:** nothing else in
  `shared`, `server/src`, `agent/src` or `pwa/src` spells the count or a part's size; every other use derives from
  `deliveryParts()`. The derivation checks trust with trust and a part with a part: a pair's time is a sum, so a mixed pair
  never exceeds the larger same-kind pair, and the test still asserts all four pairings.
- Each pass sends at most one capture, trust first. The lane asks for a delivery job only on a pass that sent no trust job,
  and that is the whole of "trust first": a queued build that is not due (the retry ladder's hour, or a build whose every
  try sends nothing) does not hold delivery back (call 1145 point 2b, kept by call 1253). The lane names the first part, in
  order, of the newest trusted build that has no row at the current recipe version. A box fault spaces the next try by the
  lane's hour and never counts toward a build's trust fails.
- **The box's capability is its own reader** (call 1148). There is no recipe list on the status answer: on main, that
  reader refuses a whole answer for a key it does not name, so a list would break every capture and test run on an older
  agent. An older box, or a box without the driver wired, refuses the delivery submission at its frame reader, before
  anything runs, and closes that capture's own connection. The agent answers not-taken with the box's own sentence, and
  the lane records not-sent, with no attempt counted and one log line, its own, carrying that sentence. Not-taken never
  becomes a fault or a verdict. An older FLEET
  AGENT, one that lists the capture op but predates its `recipe` and `part` fields, refuses the delivery request as a bad
  request; the server's remote arm reads that, on a delivery job only, as not-taken too, so it also counts no attempt
  (review 3882 A1, the coordinator's ruling). The arm logs nothing: it answers not-taken with a detail saying what was
  measured (the agent answered a delivery job as a bad request) and naming an older agent as the likely cause, not as a
  fact, since a current agent refusing a malformed delivery ask would land on the same arm (the capture owner's answer to
  the round's packet). The lane's one line carries that detail. Until wave 184 a pass logged two lines here, the arm's and
  the lane's, and the lane's blamed the test box, and a box's own refusal logged twice too, once in the transport (review
  3898 F6, the coordinator's ruling; section 12). A trust job's reading is unchanged.
- **Version skew** (calls 1148 and 1159). The result carries the recipe version and the ids of the cases it ran.
  `deliveryResultCurrency` answers one of three words. `current`: the version and the part's cases are this side's; only
  these are stored. `another-recipe`: another version, ordinary skew between releases; no row, asked again at the lane's
  hour, never intact and never a build fault. `contradiction`: this side's version with cases that are not this part's,
  which needs a defect since the version covers the split; no row, and one server log line.
- **Bounds** (call 1145). The reader takes at most 16 turns a case and no count above 1,000,000. The producer writes
  nothing the reader refuses. It judges and reports only the first 16 turns: a seventeenth unequal turn then reads
  `duplicate` where the whole window would read `split`. Both are faults, and the word is the same. It also caps each
  turn's length and the side-request count at the ceiling, so a build that sends an over-long turn still reads as its
  fault verdict, not as an answer the box got wrong. A case's sent length and a divergence's index (at most the expected
  length) need no cap: every case keeps both under the ceiling, and that is pinned.
- The result rides the read that returns capture state today, written by the lane alone, into a table of its own; the
  trust table is untouched. A lost database heals by itself: with no row, the lane measures again.
- **What the record is** (review 3882 F5, the coordinator's ruling). A part's row is the newest trusted build as SENT BY
  ONE RELEASE AT ONE TIME: the result, its row and the read carry the release tag of the test box that ran the send (the
  tag that box's tree is stamped with, the one its status answer carries), or null when that box could not read it:
  unknown. The reader also takes the field absent as null, but only inside the current shape. A box built before the
  field came in also lacks the `unmeasured` list and counts side requests as one number, so its whole result is refused,
  never read as release unknown (review 3898 F2). No box shipped that shape. A row is keyed by build and part, not by release: releases arrive several times a day and a
  part is measured once an hour, so a row keyed by release would rarely complete. So a repair of the send is measured
  again when the next build passes trust. A PR that changes the send and wants it measured at once raises the recipe
  version, which makes every stored row another recipe's and asks each part again.
- **The join.** A build's delivery word is intact only when every part at the current version is intact. One faulted part
  makes the whole a fault. A part not yet measured, or one whose box fault left no verdict, leaves the whole without a
  verdict (its own word, never folded into intact or fault).
- **The busy point** is the longest part. A trust capture for a build that appears while a part runs waits for it, at
  worst 401.0 s (6 min 41 s) for a four-case part. A running capture is never cut.
- **The timings** (the capture owner's condition 5 and call 1208). The recipe's bounds are fields of the one capture
  timing contract (`CaptureTimings`): the driver's 25 s, its kill grace of 1 s, the settle's 15 s and the quiet 2 s. The
  desk's late check, the runner's settle and quiet, and the compiled driver's bound and grace are all read from the object
  the entry point composes. Per case the worst case counts the driver's bound, its grace and one drain, the settle and
  the quiet, each with one poll's overrun, and once per part the last case's trailing window (one more settle and a
  poll; review 3882 F3). Today: build trust 399.5 s; a four-case part 401.0 s; two parts with the margin 832.0 s of the
  900 s wait, a part and a trust capture 830.5 s; three parts. Gate G1 runs the composed delivery runner on a virtual clock with every
  bound taken, and its elapsed time EQUALS the worst case less the two allowances and the polls' overruns, exactly. So
  the worst case is a bound the runner is held to, not an estimate.
- **To read it:** the test box builds read (`GET /api/testbox/builds`) carries `deliveries`: for at most the newest 64
  builds with any row, its join word, each measured part's release and cases (verdict, counts, first divergence), and each
  unmeasured part with its last not-sent word. So a reader tells "no box runs the recipe" (`recipe-not-run`) from "the box was not reached"
  (`no-test-box`, `not-started`). There is no console surface yet.

## 7a. The lane, built (the capture owner's call 1253), and its known limits

The lane's packet is built as approved, with call 1253's one change: the decider no longer holds delivery back while any
build is queued. Its conditions are built with it:
- **The two writers' answers are read.** A refused attempt stamp ends the delivery pass before anything is recorded, as
  the trust loop's does. A refused record is one server log line. Each has a case.
- **Two signatures** for `FleetIO.testboxCapture`: a build alone, or `'delivery'` with its part. A delivery ask with no
  part cannot be written. An untyped caller's is never sent and answers `not-started` (no job went out), at the
  transport and at both io arms.
- **The view's reader refuses a view at odds with itself**: every part of the recipe listed exactly once, measured or
  unmeasured, and the word the join of what is listed. So it refuses a part listed both ways or not at all, and an
  `intact` or `refused` word beside an unmeasured part. Within a part (review 3882 A5) it also refuses cases repeated or
  out of order, a case verdict its counts and divergence cannot give (the view carries no send word, so any verdict the
  rule could give for some send word is accepted), and a part word that is not its cases' word. The list is bounded on
  the reader's side at 64 builds, and the lane's view cuts to the newest 64, so the reader never refuses the lane's own
  answer because the table grew. The join is written once (`deliveryResult.ts#deliveryJoinWord`);
  the lane's word and the reader's check both ask it. A row is current only with its version, word, result and time
  together, so the join, the next job and the view split a build's parts the same way.

**Known limits** (each said in the PR too):
- **No give-up and no notice** (read). A part with no current result is asked once an hour for as long as its build is the
  newest passed one. A version skew or a box fault that persists is twenty-four asks a day, one part each. Nothing raises
  an item or pushes for it. The spacing is measured by the lane's unanswered and another-recipe cases.
- **How many times, never when** (wave 184, proposal 1; the capture owner's call 1444 and the coordinator's 37528). Each
  unmeasured part carries `attempts`, the number of delivery jobs that went out for it, so a part a box faults on again
  and again is told from one never asked (0). The count is all time for the (build, part) row: a result of another recipe
  version, or a new release on the box, does not reset it, so after such a change it can stand above 0 for a part asked
  once since. It says how many times, never when; the time of the last try stays in the store. A try that sent nothing
  (a not-sent word) is not counted. A view from a server older than the field reads `attempts` as unknown, never as 0.
- **While a delivery capture is out, the whole pass waits** (read; the in-flight case measures that no second job goes
  out). Builds seen are not noted, the untrusted-build items are neither raised nor settled, and no trust retry is put
  back, for at most the request's deadline (17 min). At the part's worst case it is 401.0 s.
- **The table is never pruned** (read: the store has no delete). It holds at most one row per part of each build that was
  ever the newest passed one.
- **The signed-in read serves a build's own text** (read; wave 184, the coordinator's and the capture owner's call 1446).
  Each case's view carries its first divergence: `expected` is a slice of the fixed case's own text, but `received` is a
  slice, up to 80 code points (twice `DELIVERY_CONTEXT`), of the build's turn text, whatever the build wrote there. For an
  intact build that is the case's text; for an altering build, or a forked request read as a turn (section 9), it can be
  a placeholder of the build's own, a prompt template, or, in principle, an environment line naming the capture's working
  directory on the test box, a host path. The stored result holds it too. That is as ruled, for the operator's eyes behind
  the sign-in; the status read every session can make carries no case text (section 12).
- **A deliveries read that throws makes the whole build list read unavailable**, the trust list with it: one answer,
  never half of one (measured by a case).
- **A superseded build reads `incomplete` for good** (read; review 3882 A4). Once a newer build passes trust, an older
  build's missing parts are never asked again, and after a recipe version change every older build's stored parts (a
  past `fault` among them) are another recipe's and read as missing. The read gives no word for "superseded": it shows
  the same `incomplete` as a build still being measured.
- **A key in flight at the driver's bound** (read; review 3882 A2). At its bound the driver child's process group is
  killed, but each tmux client it starts runs in a group of its own, so a `send-keys` already in flight is not reached and
  may still type into the capture's pane during teardown. It stays on the capture's own private tmux server, which the
  runner then stops, and the test service's unit stop clears anything left.
- **What a merge starts** (read). On a server whose capture lane runs (its transport is wired at start-up, as in
  production), delivery jobs begin for the newest passed build, with no switch. A test box whose tools do not carry the
  driver closes the frame, and the lane records `recipe-not-run` once an hour until they do (measured by the not-taken
  case and the spacing).

## 7b. Before the first measurement, and what a healthy one looks like (review 3882 A9)

**What must carry the release first.** A measurement needs this PR's release on all three of these, in any order. Until
then, each missing one has its own visible answer:
- **The server box** (the capture lane, migration 130, the remote arm). Without it nothing asks.
- **The fleet agent** (the capture op's `recipe` and `part` fields). An older agent refuses the request as a bad request;
  the lane records `recipe-not-run`, counts no attempt and logs one line naming the cause (section 7).
- **The test box's installed release tree.** It needs the agent's compiled runner with the delivery branch, the server's
  compiled driver (`server/dist/.../inject/deliveryDrive.js`) and `ccd/tmux.conf`. A tree without the driver closes the
  frame (`recipe-not-run`). A tree without the configuration runs, but each part names `fleet-tmux-config` as unmeasured.

**What a healthy first result looks like**, read from `GET /api/testbox/builds` `deliveries`, for the newest build whose
trust capture passed:
- the build's `word` is `intact`, with three entries in `parts` (0, 1 and 2) and `unmeasured` empty;
- each part's `version` is the recipe version of the server's release, its `release` is the test box's release tag (not
  null), and its `word` is `intact`;
- each case (four, four and three) reads `verdict: intact`, `divergence: null`, and one entry in `receivedChars`. That entry
  equals the expected text's length, which can be shorter than `sentChars`, since the composer trims and turns CRLF into
  LF as the product declares.
- In the stored result behind the view, each case also has `send: "ok"` and `hook: "equal"`, and the result's
  `unmeasured` is empty. Its side-request counts are whatever the build asked beside the turn: they are the first
  measurement of that, not a pass condition. A case whose window held a request on a route the stand-in does not script
  carries `other` beside the two route counts (wave 184, review 3898 A3): the count only, written only when above zero, so
  a healthy result with none reads as before.

**The timeline.** The lane passes at most once a minute (`BUILD_CAPTURE_SWEEP_MS`), and a pass waits for the capture it
sent. After a build's trust capture passes, the next pass that sends no trust job sends part 0, and each later pass sends
the next part. The parts therefore run back to back: at worst one minute plus three times a part's worst case (401.0 s),
about 21 minutes. A typical part, with every turn ending at once, is far shorter; that is not measured yet. A part
whose box faults is asked again at the lane's hour.

## 8. What lands where

| Piece | Where | State |
|---|---|---|
| The cases, the rule and the version | `shared/deliveryCapture.ts` | this PR |
| The result, its vocabulary and its one reader | `shared/deliveryResult.ts` | this PR |
| The capture contract (optional recipe, `delivery` field, the capture's terminal names) | `shared/claudeBuildCapture.ts`, `shared/testbox.ts`, `shared/agent-protocol.ts` | this PR (the Overlord's yes, call 1135) |
| The driver | `server/src/inject/deliveryDrive.ts` | this PR |
| The drive's steps, reply, window and worst case | `agent/src/testbox/captureDelivery.ts` | this PR |
| The runner's delivery branch, the stand-in's reply rule, the launch geometry, the desk, the composition, the op | the capture files | this PR (packet 2, the Overlord's yes, call 1208) |
| The parts, the part index on the wire and the version over the split | the capture contract and the result file | this PR (the Overlord's yes, call 1159) |
| The lane, the store and the read | `shared/deliveryLane.ts`, `server/src/buildCaptureLane.ts`, `server/src/testboxCapture.ts`, the io arms, `server/src/coord/claudeBuildDeliveriesStore.ts`, migration 130, the builds read | this PR (the Overlord's yes, call 1253; each held file's hunk with its holder's yes) |

## 9. What this cannot prove, and what stays unmeasured

- The browser and the clipboard were wave 167's. Touch input, other engines and an operating-system clipboard remain
  unmeasured.
- Fastify's JSON body parse and the route's own checks are read, not run.
- The agent link's relay and `execFile` on the fleet carry the same argv; that is read, not run.
- A real model's handling, a signed-in account, the fleet's session hook and spawn flags, and fleet load are not covered.
  A quiet test box under-reports timing races such as wave 167's `M-Enter` split lead.
- A split whose second part arrives after the quiet period falls into the next case's window. It still reads as a fault,
  but on the wrong case. After the LAST case of a part there is no next case, so that case's window stays open for one
  more settle bound (15 s) after its quiet: a request arriving then is judged against the last case (review 3882 F3). A
  request later than that, after a part's last case, is not seen.
- **Side requests by route** (review 3882 F4). The stand-in tags each request with the route it came by. A token-count
  request (`count_tokens`) is a side request whatever its body holds, never a turn, and each case's result counts side
  requests by route, so the first real run shows what a real build asks beside a turn. NOT MEASURED BY ANYONE YET: a
  forked request (a suggestion or a summary) that carries the tools and ends on a user text block reads as a turn, and so
  as a false `split` or `duplicate`. No rule is guessed for it; the first real run's counts are where it would show.
  A request on a route the stand-in does not script (it answers 404, before anything is recorded) is counted too, since
  wave 184 (review 3898 A3): the case's `sideRequests` carries `other`, written only when above zero. Only the count is
  kept, never the body or the route, so a build that asks something new beside a turn shows a number, not what it asked.
- **A pane without the fleet's configuration says so** (review 3882 A3). When the release tree a test box runs from has
  no `ccd/tmux.conf`, the pane starts without it, and the part's result names `fleet-tmux-config` in its `unmeasured`
  list: that pane is not the product's pane.
- **What a divergence's `received` can hold** (wave 184). Up to 80 code points of the build's own turn text near the first
  difference, which need not be the case's text and can in principle hold a host path; it is served on the signed-in
  builds read only, never on the status read (section 7a).
- The transcript file, which would be a third witness, is not read.
- The recipe measures prompts that reach the model. A leading `!` is, by design, not one (section 6).
- Only the newest trusted build is measured (section 7).
- The pane: the delivery recipe uses the fleet's 220x50 and its `ccd/tmux.conf`; build trust keeps 200x50 and `/dev/null`.
  tmux gives a pane the config's `default-terminal` as `TERM`. So under the fleet config the build sees the fleet's
  `tmux-256color`, as every fleet session does, and the capture's own `xterm-256color` is replaced. Without that config
  (build trust) the capture's own is kept. Measured on CI, where the real-tmux launch case runs. The case holds `TERM`
  equal to the shipped file's own value (the capture owner's call 1311).
- The real-tmux launch case (and build trust's two real-tmux cases) skip where the temporary directory's path would make
  the capture's socket path too long for tmux, as on a fleet session's own temporary root. They run on CI.

## 9a. The driver child, stated and pinned (the capture owner's call 1208, condition 4)

The driver is the one thing in the recipe that types keys. Each statement has a case that goes red without it.
- **It addresses only the capture's own tmux server.** Every tmux call goes through the one socket lookup with the
  capture's fixed name (`-L ccrc-capture`), with `TMUX_TMPDIR` the tmux directory it is handed, in an environment built
  from empty (`PATH`, `TMUX_TMPDIR`, `LANG`), so no `TMUX` or fleet socket setting reaches it, and it runs nothing but
  tmux. Case: `delivery-drive.test.ts`, "captureTmuxRunner: the capture's own server, never the fleet's". The child
  itself starts with `PATH`, `TMPDIR` and `LANG` only (`testbox-capture-delivery-run.test.ts`, "the driver child").
- **It refuses a tmux directory that is not its own.** The directory must be exactly
  `<its own temporary directory>/ccrc-capture-<the capture's id>`, a real directory read by `lstat`, owned by its own
  user, and writable by neither group nor other (call 1145). Cases: `delivery-drive.test.ts`, "readDriveInput: refused
  before any tmux call" (a wrong parent, one level down, another capture's id, a link at either name, another owner, mode
  0770 and 0707 on the real file system).
- **The compiled driver is in the tree a test box installs, and loads there.** The release build copies the server's
  whole compiled tree (`deploy/build-release.sh`), into which the server's build emits every source file and every shared
  `.mjs`. The agent's compiled `main.js` names the driver at the place that tree puts it. Emitted by the server's own
  compiler options into a tree with no `node_modules` above it, the driver loads and answers under the three-variable
  environment. Case: `testbox-capture-driver-compiled.test.ts`, beside the recorder's compiled-file test. Measured: the
  driver's imports reach the shared `.mjs` files, which the build emits only through its `../shared/**/*.mjs` include,
  and the case pins that include.
- **A fault of the box is never a verdict** (review 3882 F2, the coordinator's ruling). Any tmux call the driver's own
  runner could not complete (its 5 s per-call bound, a spawn that failed, a tmux client ended by a signal that was not the
  bound's own kill: wave 184's F5) ends the driver with exit status 3 and a
  `fault` line, never a send word, and once one has failed no later call of the case runs, so nothing more is typed into
  a pane that may hold a half-typed draft. The runner reads any non-zero status as a fault, and reads the send word
  `not-alive` (the capture's own session is gone) as one too. The send also answers `not-alive` after it typed the case's
  text, when every later echo read failed, and after its clear keys (`server/src/inject/send.ts`), so that word does not
  mean nothing was typed: it means the pane is gone (review 3898 F4). Either ends the part with no verdict, no row is stored,
  and the lane's spacing applies. The part stops at the first such fault: no later case is typed. Cases:
  `delivery-drive.test.ts` ("a tmux call that timed out", "a tmux that could not start", "after the first call that
  could not complete", "a screen read that could not complete", "the answer line") and the runner's cases in
  `testbox-capture-delivery-run.test.ts`.
- **Its stop is bounded and counted.** At its bound the child's group gets TERM, KILL its grace later, then one drain; a
  child that ignores TERM is held the whole grace (real time, in two cases: the driver's own and the production
  wiring's), and the worst case counts the grace.
- **No silent part** (condition 1). A delivery capture that reaches the desk or the runner with no part runs nothing and
  answers no verdict with a detail; the runner's part has no default.
- **One environment per capture** (condition 2). The capture's environment is built once; the build's pane and the
  driver's search path get the same value, though a tool sync may move the tools directories between two reads.
- **The launch on a real tmux** (condition 3). With the fleet's config and pane size, tmux reports the pane started from
  exactly the two words (the fixed start program and the build's path), so no shell; the build's environment holds every
  variable of the capture's and the fixed shell; and the same holds with lines added to the config naming a default
  shell and a default command.

## 10. Departures

- **A tmux that ran and exited non-zero is the product's word** (wave 184, the coordinator's ruling F5). The driver's
  runner answers a tmux that ran and exited on its own (1: no such session, a key it refused) as run, with that status,
  and the send reads it as it reads the fleet's tmux: the product did refuse. Only a call that did not complete is a fault
  of the box: the bound, a spawn that failed, and a client a signal ended that was not the bound's own kill (an exit of
  128 or more with no kill flag; tmux's own statuses are 0 and 1). Cases: `delivery-drive.test.ts`, "a tmux that hangs
  past the bound", "a tmux a signal ended, not at the bound" and "a tmux that ran and exited 1 on its own".

- **tmux-dir-bound-by-id** (the coordinator's acceptance). The driver accepts the capture's tmux directory only as exactly
  `<its own temporary directory>/ccrc-capture-<the scratch directory's capture id>`. It is not nested under the scratch
  root, because the runner keeps it outside for the socket path limit (review 3226 F8). The runner starts the driver with
  that base as its `TMPDIR`. The directory must also be owned by the driver's own user and writable by neither group nor
  other (the capture owner's call 1145); the runner makes it 0700. Whatever directory it is given, the driver's fixed
  server name means it can never address the fleet's own tmux server.
- **driver-a-second-operator-caller-of-the-send** (legitimately different: another process, on another host). The driver
  is the seventh caller of `sendPrompt`, after the route, the clear, the two lanes and the renewal host's two prompts. It
  is legitimate because the recipe's whole point is to drive the product's own send with the route's own options: refuse
  a draft, no attachments. It does so on a test box capture's own tmux server, never a fleet session, so it adds no
  path by which text reaches a fleet pane. Both send censuses list it with the route's policy (the call-site table of
  D-5912 and the caller list), and the call spells `onDraft` by name, so the table reads the policy where the call is.
- **driver-runs-server-code-on-the-box** (legitimately different: another process, on another host). The recipe must run
  the product's send, not a copy. The driver is a server file, run compiled from the release tree, and imported by nothing.
- **driver-own-keyed-queue.** The driver constructs its own `KeyedQueue` (`core-vocab.test.ts` names it beside
  `index.ts`). It is a composition root of its own, in another process, sharing no lock with the server's sessions.
- **driver-through-the-socket-lookup.** The driver's tmux calls go through the one socket lookup (`tmuxCommand`) with the
  capture's name as the setting, and through the one bounded spawner. So the tmux socket census keeps its single capture
  exception, and the spawner census gains no row.
- **result-split-from-cases** (the Overlord's condition 3). The result and its reader travel in the capture contract's
  module graph, the front end's included; the case texts do not. **Measured:** the production PWA build at this branch
  contains no case text, generator or version code. Its JavaScript totals 8,333,992 bytes, against 8,347,026 at the base
  09c8f5d502, with 179 assets each. The difference is chunking. After the parts packet it still holds by construction:
  the contract (`claudeBuildCapture.ts`, `testbox.ts`, `agent-protocol.ts`) imports only `deliveryResult.ts`. After the
  lane, `deliveryResult.ts` imports `claudeVersion.ts` and `claudeBuildTrust.ts` (the not-sent words), and
  `claudeBuildTrust.ts` imports one type from `deliveryResult.ts`. The front end already bundles both. The decider,
  `deliveryLane.ts`, imports the case file, and nothing in `pwa/src` imports it. The bundle is measured again at the final
  tip.
- **redundant guards dropped.** A separate link test beside each directory's `lstat`, and the explicit field check on a
  delivery reply, could not be shown red, since other checks already refuse those inputs. They were removed, not kept.
  The driver still refuses a link at either directory's name: `lstat` reads a link as no directory (case: "a link at the
  scratch directory's name is refused", on the real file system; review 3882 A10 corrected this sentence).

## 11. Mutation record

52 mutants over two rounds, three more for the tmux directory's owner rule (call 1145), 27 for the parts (rounds 3 to 5), 13 for packet 2's drafts (round 6), 8 for packet 2 (round 7), 7 for call 1208 (round 8), 46 for the lane (round 9, call 1253), 29 for review 3882's fix round (round 10) and 34 for wave 184 (round 11), each run through `ccrc test` with the file restored afterwards. Every
remaining guard is killed by a named case. Round 1's eight survivors were three redundant guards, now removed, and five
weak tests, now sharpened: each of those mutations also broke the word, so the word check refused it first, or the case
had no text beside its tool result. Round 2's one survivor was redundant and was removed.

Round 10's evidence, read alone, misses one hop (review 3898 A4): the `release` column of `claude_build_deliveries`
(migration 130), the table side of F5's one-writer chain, came in with that round's merge of main into the branch, where
the migration was renumbered, not with the round's fix commit. Both were squashed into the landing commit `812b6c4e4e`.

| Area | Guard removed | Killed by |
|---|---|---|
| driver | input keys exact | a field missing; a socket field |
| driver | case id; capture id shape; the `captures/` parent; normal form | an unknown case; not named by a capture id; outside `captures/`; relative or not normal |
| driver | tmux directory equal to `<tmp>/ccrc-capture-<id>` (basename only instead) | a right-looking name under the wrong parent; one level down. Corrected in round 10 (review 3882 F6): until then these rows reached no parent rule, since every other check refused them first, and the mutant survived. Each row now passes the directory and ownership checks, so only the parent rule refuses it. |
| driver | real directory, read by `lstat` (`stat` instead) | a link at either directory's name, on the real file system |
| driver | the tmux directory is this user's own and private; the owner; the group and other write bits | a directory that is not; owned by another user or root; mode 0770 and 0707 on the real file system |
| driver | tmux only; environment from empty; the capture's socket name; the route's options | runs nothing but tmux; `-L ccrc-capture` with only `PATH`, `TMUX_TMPDIR`, `LANG`; refuse a draft, no attachments |
| op reply | a build-trust request refuses a reply naming `delivery`; no trust verdict on delivery; delivery only when answered | the three cases of each direction |
| frames | the recipe word; no trust verdict, no detail and no running result on a delivery capture; the result's reader | each refusal case |
| result | recipe; build; version shape; case order; word; possible verdict; context bound; turn bound; divergence present or absent | each refusal case |
| rule | duplicate; false confirmation; partial; tools offered; last message the user's; reminders; tool result even with text; CRLF; trim; divergence index; the four mode characters | the verdict, turn and composer cases |
| parts (round 3) | submission part range and key; reader part range and echo; strict case order; at least one case; the turn and count bounds; the reply's part; the version over the split; currency's version, length and ids; the 16-turn cut; the even split; the part+part pair; the largest part | each refusal case, the split table and the derivation cases; the trust+part check survived as redundant and was removed |
| packet 2 (round 7) | the shared count 4 and 2 (the deadline test alone); the desk on the default contract; the settle and quiet bounds from the default contract; the quiet period dropped from the worst case; a quiet period of 20 s; build trust reading a delivery bound | the deadline test's pair and equality case; the desk's delivery late case; the bounds pin; the worst-case formula; the pair bound; trust's worst case unchanged by the delivery bounds |
| call 1208 (round 8) | the kill grace dropped from the worst case; the driver's grace at 0; the runner's no-part check; the desk's part defaulted to 0; the environment built twice; the server's tree dropped from the release; the wiring's grace a constant | the composed delivery run and the figures; the stubborn-child case; the no-part runner and desk cases; the one-environment case; the compiled-driver case; the wiring's grace case (the one survivor, now killed) |
| parts (rounds 4 and 5) | the turn-length and side-request caps; each currency word; the shared count one more and one fewer | the over-long turn case; the three currency cases; the derivation's equality case |
| the lane (round 9, call 1253) | the decider: the current-row test, the spacing and its boundary, skipping ahead, the oldest passed build, a failed build, the queued hold put back; the join's order, its `refused` and its `incomplete`; the word from any row; currency's version, result and time; the view's order, not-sent word and word; the reader's coverage and word checks. The lane: trust not first, the attempt word either way, each writer's answer ignored, each currency arm, the null-result check, the recipe line. The transport: not-taken per job kind, the delivery field, the dropped detail, a part-less ask; the remote arm's part-less ask and its reply reader. The store: the whole-row version and word, an unknown not-sent word, the attempt's count, accumulation, why and clock, the record's replace, its clearing of the why and its time | the decider, lane, transport and store cases. Five first survived: the store's whole-row version and word and its unknown-word check, and the record's clearing of the why, each now killed by a new store case; the null-result check, killed once its case named its own line (the sweep's catch had logged one line too). One was cut again where its first snippet matched twice |
| review 3882 (round 10) | the driver: the first fault not recorded, later calls of the case still run, a fault answered exit 0, a fault read as sent, the tmux directory by its last name only (F6). The runner: the trailing window removed (F3), the route tag dropped (F4), the route-count check dropped, `not-alive` read as a send word (F2), the release and the unmeasured list dropped (F5, A3). The result's reader: a non-tag release, a release absent refused, an unknown or inherited unmeasured name, a side-request key added or not a count. The view's reader (A5): a part word not its cases', a verdict its counts cannot give, cases out of order or repeated, the build bound. The lane's view: the newest-64 cut, the part's release. The store: the whole-row release, the not-sent word by own property (A8). The rule: a `count_tokens` body read as a turn, the route table out of the version. The remote arm (A1): a delivery job's `bad-request` folded to unanswered, the trust job's folded too, no log line | the driver cases ("a tmux call that timed out", "a tmux that could not start", "after the first call that could not complete", "a screen read that could not complete", "the answer line", and the two wrong-parent rows); the runner's late-request cases for c2a, c3c and c5, scripted and on the fixture build (variant 985), the composed G1 run, the route cases (variant 984), the no-route case, the `not-alive` case and the two release and unmeasured cases; the reader, view, lane, store and rule cases; the three remote-arm cases. One mutant alone first survived: the unmeasured list's repeat check, since with one name in the vocabulary the length bound refuses a repeat too. It is killed only together with that bound. The stored-word half of A8 is caught by the whole-row rule first. |
| wave 184 (round 11) | the driver: a bound kill read as ran, a signal end read as ran, every non-zero status a box fault, the signal threshold at 144 (F3b, F5). The view's reader: `at` checked by a case's count bound (F1). The one log line (F6): the remote arm logging again, the transport logging a delivery not-taken, the transport or the lane dropping the measured detail. The driver's fault line read by its send word (A1). The other-route count (A3): the stand-in not counting, the drive ignoring it or counting from the part's start, the producer writing 0, the reader taking 0. The release dropped at the service's hop (F3a). Proposal 1: the view writing 0 attempts, absent attempts read as 0, attempts unchecked. Proposal 2: the cut carrying the cases or spreading an unmeasured entry, any word fitting any counts, `refused` with every case intact, the counts' sum unchecked, each level's keys opened, the coverage and join unchecked, an answer kind with extra keys, absence read as malformed, the read naming the oldest passed build, the route folding a failed read into `no-trusted-build`, failing the block, putting the error on the wire, or logging nothing | 34 mutants, 34 killed, each by its own named case (the four driver mutants on the branch; the thirty others on the packet's tree before the capture owner's yes): the driver's timeout, signal and exit-1 cases; the real-`at` view case; the lane's one-line cases; the fault-line case; the stub's, drive's and reader's other-route cases; the composition case; the attempts cases; the standing's key, text, domain, same-build and three-answer cases and its route cases |

## 12. Wave 184: review 3898's follow-up, and the two reads it adds

Wave 184 carries the follow-up items of review 3898 and two additive reads, each proposed first and built on the rulings
named beside it. **The recipe version does not move:** `DELIVERY_RECIPE_VERSION` printed `da16fe2f55551e0b` before the
first edit and after the last. Build trust's recipe and verdict are untouched: the stand-in's `requests` and `routes`, the
two lists trust reads, are as before, and the requests counted under `other` sit in a list of their own. No door, no
migration, and the driver's refusals and its one directory rule are as before.

**The items:**
- **F1.** A part view's `at` is read as a time, a non-negative safe integer, no longer under a case's count bound, which
  refused every real millisecond reading. A case reads back a view built from rows with a real `at`.
- **F2.** The note (sections 7 and 7b) and the release field's comment say what is true: an older box's result is refused
  whole, never read as "release unknown".
- **F3a.** One case drives a delivery capture through the entry point's composition, over a tree whose stamp holds a tag,
  and reads the tag in the result. **F3b.** A stand-in tmux that sleeps past a small bound is killed there and answered not
  run, reason `timeout`.
- **F4.** `DRIVER_BOX_FAULT_SENDS`'s comment says that `not-alive` also follows a send that typed the case text, so a part
  can end with no verdict after text reached the pane. What the read shows for a part a box faults on again and again is
  proposal 1, below.
- **F5.** A tmux a signal ended, not at the driver's bound (exit 128 or above, no kill flag), is a box fault: not run. A
  tmux that ran and exited non-zero on its own stays the product's word (section 10).
- **F6.** A delivery job that was not taken writes ONE server log line, with its true cause: the remote arm and the
  transport hand over what was measured and log nothing, and the lane writes `not sent: <cause>`. Cases through the lane
  count exactly one line for both causes, the fleet agent's bad request and the box's refused frame.
- **A1.** A driver fault line's detail is its reason and tmux's detail, never the send word. **A2.** A dead assertion is
  gone. **A3.** Requests on a route the stand-in does not script are counted (sections 7b and 9). **A4.** Section 11 says
  where the release column came from.

**Proposal 1: `attempts` on each unmeasured part** (the capture owner's call 1444; the coordinator's 37523 and 37528, which
withdrew the last-try time). The one view builder writes it from the row, 0 with no row; the reader takes a non-negative
safe integer and reads an absent one as unknown. Section 7a says what it counts.

**Proposal 2: the delivery standing on the test box status read** (option A; the coordinator's 37537, the capture owner's
calls 1446 and 37541). `GET /api/testbox` answers `delivery` beside `testbox`, with the same credentials (a session or the
box token) and the same masking. No route, door, client verb or write is added, and the gate's tables and the box token's
census do not move.
- **What it holds.** The newest build whose trust capture passed, the build the lane works on (both ask
  `deliveryLane.ts#newestTrustedBuild`, and a case is red if the read and the lane name different builds); its join word;
  each measured part's word, the release of the box that ran it, its time, and how many of its cases read intact and how
  many did not; each unmeasured part's last not-sent word and attempts. It is cut field by field from the one view
  (`deliveryResult.ts#deliveryStandingOf`), so a key the view grows later does not reach it unless written there.
- **What it never holds.** No case, case id, verdict or divergence, so none of a build's own turn text (section 7a): every
  value is a fixed word, a count, a build name, a release tag or a time. A case feeds a view whose divergence holds a
  marker and a host-like path, and finds neither in the serialised answer, through the decider and through the route.
- **Three answers, kept apart.** `{kind: 'standing', standing}`; `{kind: 'no-trusted-build'}`; `{kind: 'unreadable'}`
  when the store read throws, with the error in one server log line and never on the wire. The test box block is still
  answered beside it. The neighbouring block's convention (`counts: null` for an unreadable runs log) is not followed,
  because a null here would read the same as "no trusted build". With no coordination store the key is absent.
- **Its one reader** (`readDeliveryStandingAnswer`) takes each answer with exactly its own keys, and the standing with the
  view reader's own checks for what it keeps: the build's grammar, the release tag or null, the time, each part once and in
  order, every part of the recipe listed once, the join word. It adds two: a part's two counts sum to its case count in the
  recipe's split, and its word is one `deliveryWord`, the word's own function, could give over those counts. That check is
  asked of `deliveryWord` itself, so `intact` stands only with no case not intact, and `refused` and `fault` only with one
  or more; the function never gives `refused` with every case intact, so the reader refuses that. One case pins it over
  the whole domain: every word against every count pair, for each part, against every verdict list the part can hold.
- **An older server** answers no `delivery` key, which the reader takes as `unknown`.
- **Size, and the bounds of the two names.** The build name is bounded by the build grammar only (digits of any length,
  the same check the builds read applies), and the release tag by the release grammar only; neither has a length cap.
  Measured by a case: at 64-character names, the largest counts, times and tallies, the answer is under 1 KiB. The status
  read's callers that cut what they read (the admin script and the doctor's check, at 65536 bytes) keep that headroom
  unless a build name runs to tens of thousands of digits.
- **What it costs each call** (measured; the capture owner's yes to the packet, point 2). The console's test box card asks
  the status read every 30 seconds while it is open, and the doctor asks it too. Each call now reads the builds table and
  the deliveries table whole and parses every stored result, through two synchronous store reads outside the serialiser.
  On a year of rows, generously counted (369 builds, each with the largest kept capture output, 8 KiB, and three full
  delivery results for every one of them, 1,095 rows), the standing took a median of 12.6 ms, 17.1 ms at the 90th
  percentile and 18.4 ms at most over 30 runs, on the fleet box at a load of 16. The answer was 333 bytes. A read of one
  build's rows would be a store change, another wave; at this cost it is not needed.
- **A reader at another recipe version refuses a standing, never reads it as unknown** (point 3). The reader checks a
  part's two counts against its own build's split of the cases. A reader built at a recipe version that splits them
  otherwise refuses the whole answer. This assumes what is true today: every reader of the key is on the server's own
  build, or is a test.
- **Why the optional `other` count is safe for the closed result reader** (point 4). The count reaches a server only from
  a test box whose tools are at most as new as the server's, because the box's tools come from the server's release, and
  a server that knows the count reads it. An older server meeting a newer box would refuse that result whole, so the
  part would be asked again, not misread.
- **The driver's fault status is held equal on both sides** (the capture owner's advisory). The driver's
  `DRIVE_FAULT_EXIT` (3) and the agent's reader of its answer line spell the number apart, since the agent cannot import
  the driver; a text pin in the driver's test file reads the reader's fault arm and fails if its number is not the
  constant's (red when the constant is changed, measured).

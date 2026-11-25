# Wave 178: the paste delivery recipe, from the console's send to the model

Task note for desktop-polish wave 178 (Goals modification 90, the half still open: a long or multiline prompt sent from the
console reaches the model intact, as one prompt, once). Wave 167 measured the browser half, from the clipboard to the request
(`paste-reliability.md`). This wave builds the measurement of the rest of the path. That is the server's send, the pane,
Claude Code's own input box, and the prompt body and the count the model receives. It is a second recipe on the build
capture runner (`docs/superpowers/specs/2026-11-22-build-capture-runner-design.md`), whose owner, the Overlord coordinator,
ruled its place and its conditions. Claims are labelled **measured**, **read** (from the code) or **inferred**.

## 1. In short

- **What this PR is.** A recipe, its pure verdict, and the driver that runs the product's own send on a test box
  capture. The capture runner's wiring of the recipe, the lane that queues it and the result's storage come in follow-up
  packets, after the Overlord's own follow-up PR on the capture files lands (section 8).
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

## 7. How the real measurement starts and is read (the ruling; built in the follow-up packets)

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
- Each pass sends at most one capture, trust first. The lane names the first part, in order, of the newest trusted build
  that has no row at the current recipe version. A box fault spaces the next try by the lane's hour and never counts
  toward a build's trust fails.
- **The box's capability is its own reader** (call 1148). There is no recipe list on the status answer: on main, that
  reader refuses a whole answer for a key it does not name, so a list would break every capture and test run on an older
  agent. An older box, or a box without the driver wired, refuses the delivery submission at its frame reader, before
  anything runs, and closes that capture's own connection. The agent answers not-taken, and the lane records not-sent,
  with no attempt counted and a log line naming the cause. Not-taken never becomes a fault or a verdict.
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
- **The join.** A build's delivery word is intact only when every part at the current version is intact. One faulted part
  makes the whole a fault. A part not yet measured, or one whose box fault left no verdict, leaves the whole without a
  verdict (its own word, never folded into intact or fault).
- **The busy point** is the longest part. A trust capture for a build that appears while a part runs waits for it, at
  worst 385.5 s (6 min 25.5 s) for a four-case part. A running capture is never cut.
- **The timings** (the capture owner's condition 5 and call 1208). The recipe's bounds are fields of the one capture
  timing contract (`CaptureTimings`): the driver's 25 s, its kill grace of 1 s, the settle's 15 s and the quiet 2 s. The
  desk's late check, the runner's settle and quiet, and the compiled driver's bound and grace are all read from the object
  the entry point composes. Per case the worst case counts the driver's bound, its grace and one drain, the settle and
  the quiet, each with one poll's overrun. Today: build trust 399.5 s; a four-case part 385.5 s; two parts with the
  margin 801 s of the 900 s wait; three parts. Gate G1 runs the composed delivery runner on a virtual clock with every
  bound taken, and its elapsed time EQUALS the worst case less the two allowances and the polls' overruns, exactly. So
  the worst case is a bound the runner is held to, not an estimate.
- **To read it:** the test box builds read (`GET /api/testbox/builds`) shows each build's delivery word and, per case, the
  verdict, the counts and the first divergence.

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
| The lane, the store and the read | the lane's files | the lane's packets, to the Overlord and to each file's holder |

## 9. What this cannot prove, and what stays unmeasured

- The browser and the clipboard were wave 167's. Touch input, other engines and an operating-system clipboard remain
  unmeasured.
- Fastify's JSON body parse and the route's own checks are read, not run.
- The agent link's relay and `execFile` on the fleet carry the same argv; that is read, not run.
- A real model's handling, a signed-in account, the fleet's session hook and spawn flags, and fleet load are not covered.
  A quiet test box under-reports timing races such as wave 167's `M-Enter` split lead.
- A split whose second part arrives after the quiet period falls into the next case's window. It still reads as a fault,
  but on the wrong case.
- The transcript file, which would be a third witness, is not read.
- The recipe measures prompts that reach the model. A leading `!` is, by design, not one (section 6).
- Only the newest trusted build is measured (section 7).
- The pane: the delivery recipe uses the fleet's 220x50 and its `ccd/tmux.conf`; build trust keeps 200x50 and `/dev/null`.
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

- **tmux-dir-bound-by-id** (the coordinator's acceptance). The driver accepts the capture's tmux directory only as exactly
  `<its own temporary directory>/ccrc-capture-<the scratch directory's capture id>`. It is not nested under the scratch
  root, because the runner keeps it outside for the socket path limit (review 3226 F8). The runner starts the driver with
  that base as its `TMPDIR`. The directory must also be owned by the driver's own user and writable by neither group nor
  other (the capture owner's call 1145); the runner makes it 0700. Whatever directory it is given, the driver's fixed
  server name means it can never address the fleet's own tmux server.
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
  the contract (`claudeBuildCapture.ts`, `testbox.ts`, `agent-protocol.ts`) imports only `deliveryResult.ts`, which
  imports only `claudeVersion.ts`. The bundle is measured again at the final tip.
- **redundant guards dropped.** The link checks on the driver's directories and the explicit field check on a delivery
  reply could not be shown red, since other checks already refuse those inputs. They were removed, not kept.

## 11. Mutation record

52 mutants over two rounds, three more for the tmux directory's owner rule (call 1145), 27 for the parts (rounds 3 to 5), 13 for packet 2's drafts (round 6), 8 for packet 2 (round 7) and 7 for call 1208 (round 8), each run through `ccrc test` with the file restored afterwards. Every
remaining guard is killed by a named case. Round 1's eight survivors were three redundant guards, now removed, and five
weak tests, now sharpened: each of those mutations also broke the word, so the word check refused it first, or the case
had no text beside its tool result. Round 2's one survivor was redundant and was removed.

| Area | Guard removed | Killed by |
|---|---|---|
| driver | input keys exact | a field missing; a socket field |
| driver | case id; capture id shape; the `captures/` parent; normal form | an unknown case; not named by a capture id; outside `captures/`; relative or not normal |
| driver | tmux directory equal to `<tmp>/ccrc-capture-<id>` (basename only instead) | a right-looking name under the wrong parent; one level down |
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

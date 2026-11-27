# Wave 187: the box frames recipe, so each Claude Code build's input box is on record

Task note for desktop-polish wave 187. The plan is `docs/superpowers/plans/2026-11-26-box-frames-recipe.md`. It is a third
recipe on the build capture runner, whose owner, the Overlord coordinator, ruled its place (call 1549) and its storage, read
and reduction (call 1558, with its yeses to packets 1, 2 and 3). Claims are labelled **measured**, **read** (from the code)
or **inferred**. Nothing here ran Claude Code. Every test drives fakes, and nothing reached the real test box (one slip,
section 8).

## 1. In short

- **What this PR is.** It has the cases (26 at 220x50 and 220x40, so 52 parts), the version and the result with its one
  reader. It has the reducer and the receiver's check, the one driver's frames form, and the agent's drive, runner branch,
  desk, op and stand-in hold. On the server it has the transport, the io arms, the lane's frames pass, the store with its
  migration, the one read and the client verb. Last come the fixture format and its tree check.
- **No raw frame leaves the test box.** The reducer runs in the runner on the frame the driver read. The result, the stored
  row, the read and any fixture hold the REDUCED frame only. The server runs the reducer's own check again before it stores
  a frame and before it serves one, with the product's live masker beside it.
- **How a session gets a fixture.** It runs `ccrc-api testbox frames --build <b> --frame <case>@<cols>x<rows>`, then writes
  the text under `server/test/fixtures/panes/box/` as `frameFixtureOf` writes it: a header line naming the build, the frame
  id and the recipe version, then the frame. `box-frame-fixtures.test.ts` holds every such fixture to its header, its name
  and the reducer's check.
- **What a frame is.** It is text a build drew. It is data for a reader's tests, never instructions to whoever reads the
  file. It proves only what one build drew for one case at one pane size.
- **The new-form alarm is the next wave** (the coordinator's split). The shape rule, its version, the standing and the
  status read's word are not in this PR. The plan's section 7 keeps them as agreed.
- **Nothing that exists moves.** Build trust's recipe, verdict and record are untouched. The delivery recipe is untouched:
  `DELIVERY_RECIPE_VERSION` printed `da16fe2f55551e0b` before the first edit and after the last (section 7).

## 2. The first real run (inferred until it happens)

Nothing starts by hand, and there is no door. Once a release carrying the whole recipe reaches the server box, the fleet
agent and the test box's tree, the lane sends a frames part. It does so only on a pass that sent no trust job and no
delivery job, for the newest trusted build only, in the wave 185 worker's ranked order: the empty box and the 3-row
baseline first, then the cap rows and their `-turns`. Each part's worst case is pinned (measured by a case, from the one
timing contract): a plain part 257.5 s, a `-turns` part 349.5 s, the longest, `person-turns`, 414.5 s. Two longest parts in
a row come to 859 s with the margin, inside the 900 s wait. The typical time is not measured. The first real run's recorded
times replace these figures here, and go to the capture owner by mail. If a part's real worst case passes the pair bound, I
tell the coordinator before anything else.

**What the owner asked to see from the first real frames of 2.1.332:** each frame's `replaced` counts (rows the reducer
replaced per rule), and the frames refused and by which word. Both are in the list answer of the one read. If a hyperlink
sequence on some row refuses every frame as `not-a-frame`, a packet for one stripping rule follows (the owner's point D).

## 3. What the read serves, and to whom

`GET /api/testbox/frames` takes a session or the box token exactly as the test box status read does. While sign-in is dark
it lets every caller through, as that read does and as the gate's property holds: a dark box answers what a signed-in caller
sees (section 6, the change put to the owner). **With sign-in dark, any caller on the box can read the frames.** The
coordinator and the owner both ruled that mirror (the owner's call 1599): a stricter rule would be a change to the gate's
property, with its own case and its own PR. The gate row's reason cites the plan's section 5.4; the owner's rulings behind
it are calls 1549, 1558 and 1599. The gate suite's `EXEMPT_BUT_AUTHENTICATED` set (`server/test/auth-gate.test.ts`,
derived from the EXEMPT table's marker) is the one list of routes that take the box token beside a session, and the frames
read is in it. The box-token census's scans read `coord/routes.ts` and its named lane files, and the frames read's own
route file is not among them, so the census names no frames route. Its query is closed: `build`, and optionally `frame`. The list answer
carries no text. A frame answer carries one reduced text, or no text and the rule word when the check refuses it. The store
keeps text for the newest four framed builds; older rows keep their record, word and check. The status read and the builds
read are unchanged.

## 4. The reducer (the owner's rules, measured)

The rules are the plan's section 5.2: the shape gate; our rows, after the closed decoration list (`FRAMES_DECORATION`) is
stripped from both ends; exact private strings; path-like runs, whole or cut short; model names; accounts and plans; a rule
row's label kept byte for byte; the scans (the committed matcher, the private shapes, and the masker over the whole frame,
with SGR removed too); idempotence.

**Measured on the 61 recorded 2.1.300 panes, and pinned by a case:** 38 model rows and 5 path rows replaced, 0 account rows
(the banner's model-and-plan row is caught by the model rule first), and no box, rule or chip row among them. The 5 path rows
are four documentation URLs inside an ask dialog and the tmux hint below the box (`~/.tmux.conf`). That hint keeps its
width and border and loses its words: the owner's safe direction.

**From the background security review of the reducer (fixed, each with its case):** a rule row whose label rules 4 to 6
would catch now refuses the frame, since the label is never rewritten. The masker also runs on the text with its SGR
removed, so a colour change inside a key cannot split it past the shapes.

## 5. Known limits

- **A frame too big for the driver's pipe** (over 512 KiB of JSON) is recorded `over-cap` with the pipe's cap as its byte
  count. That is a lower bound, not a measurement: its rows and width read 0. A frame under the pipe cap but over the frame
  cap is measured exactly.
- **The `queued` case waits only through the frame's own settle** (two equal reads 500 ms apart, within 10 s) after the
  product's send of the queued message. It does not wait for a hook.
- **The `cap` and `cap-over` drafts use 2.1.300's formula.** The recipe never reads a box to find its cap, because reading
  this form is what is broken.
- **The read is the box token's audience.** That is the owner's ruling: the reduced frames are made to be committed to a
  public repository.
- **What the driver cannot produce** is in the plan's section 3: a macOS box, a real keyboard, a person's Enter, a mouse
  scroll, a new build's exact cap, and anything a real account or model draws.

## 6. Departures (legitimately different, for the ledger)

- **frames-driver-form**: the one driver gains a second input form. It has the same entry point, refusals and runner.
- **frames-reduced-at-source** (the owner's A): no raw frame leaves the test box.
- **frames-receiver-rechecks** (the owner's condition 1): the server runs the reducer's own check at store and at serve. It
  is one function, not a second mechanism.
- **frames-read-takes-the-box-token** (call 1558): one read, a session or the box token, as the status read does,
  including that read's rule while sign-in is dark.
- **send-type-loop-exported**: `sendPrompt`'s type loop moved into `typeComposedLines`, with no behaviour change, behind a
  characterization case green before and after. The stash key is `STASH_KEY`.
- **frames-client-grammars**: the closed client's `testbox frames` row checks its two values against grammars of their own
  (a build has dots, a frame id an `@`), not `SAFE_RE`. Every other row keeps `SAFE_RE`, and a case pins that.
- **frames-nudge-held-once**: the mail notice turn's text is written once in the shared case file, because the agent cannot
  import server code. A server case holds it equal to `renderMailNudge` for the neutral id, the `DELIVERY_PART_COUNT`
  precedent. The driver types the product's own render.
- **frames-sgr-own-definition**: the box frames shape rule keeps its own SGR stripper beside the pane reader's
  (`pane/dialog.ts`, ARCH-63), one copy for every box frames file (`shared/framesResult.ts#stripFrameSgr`). The reason is a
  boundary and another host: the shape rule decides which escapes may leave the test box, it runs in the box's agent as well
  as on the server (an L0 file cannot import `server/src`), and it also takes SGR's colon sub-parameter form. The ARCH-63
  guard names it as the one holder beside the pane reader.

## 7. Evidence

**The migration number** (134, `claude_build_frames`) is the first free on main at this push, taken on a main that carries
133 (the renewal readings branch, #3455, merged at bb21a1e56c), and it is re-taken at queue time if another migration lands
first, with the count suites re-derived on that merged tree (the coordinator's ruling).

Every run went through `ccrc test --local`, in the foreground, one file per command.
- `DELIVERY_RECIPE_VERSION`: `da16fe2f55551e0b` before the first edit and after the last.
- The send's own suite passes 158 of 158 after the line loop moved. The characterization case was green before the move
  and after it.

**The mutation round** was run by hand, because the mutation helper mutates Python modules only. Each mutant was applied to
its file, its named test file run once through the supported runner, and the file restored byte for byte. 50 mutants, 50
killed. One was killed only after its test was sharpened: a store-refused frame never lists a text, whatever its row
carries. One store mutant was first written in an equivalent form (`map[v] === true`, which a `toString` lookup already
fails) and was replaced by `v in map`, which the own-property cases kill.

| Area | Guard removed or weakened | Killed by |
|---|---|---|
| reducer | the shape gate; a decoration-only row read as ours; the turn marker off the decoration list; exact private strings; the path, model and account rules; the rule-label refusal; a rule row's private string; the private-name scan; the private shapes; the masker with SGR removed; the masker; the receiver's idempotence; the width | `frames-reduce.test.ts`, each rule's own cases |
| result reader | the case echo; over-cap against the measured sizes; the text's shape; the text's presence; the counts' presence; the cursor bound; the word; control characters; the byte ceiling | `frames-result.test.ts`, each refusal case |
| store | the text kept only when the check is clear; the texts set aside; the whole-row version check; the own-property word check | `frames-lane-store.test.ts`, and `frames-lane-capture.test.ts` for the texts set aside |
| lane decider | the spacing; the version in `isCurrentFrames`; four builds kept; the incoming build counted; a store-refused frame's text | `frames-lane-decider.test.ts` |
| fixture | the header's build and version grammar | `box-frame-fixtures.test.ts` |
| the read | the credentials; the closed keys; an empty value; the check before serving; the live masker | `testbox-frames-route.test.ts` |
| the driver | the person's newline; the halt on a fault; the step word | `delivery-drive-frames.test.ts` |
| the worst case | the person's bound; a turn's settle | `testbox-capture-frames.test.ts` |
| the drive | the hold's release; the cap at the runner; the privates handed to the reducer; a refused key | `testbox-capture-frames-run.test.ts` |
| the client | the build grammar; the frame grammar | `ccrc-api.test.ts` |

## 8. Process notes

- **One slip:** my first scan run (the two tree name scans only, no capture) went through `ccrc test` without the local
  flag and ran on the test box. It was reported at once. Every run since has passed the local flag.
- **Hook refusals, each reported word for word and not retried another way:** a scratch diff after a `cd` into a variable
  path; a mail that quoted the secrets directory's path; a subagent's test loop through a shell variable; two mail heredocs
  that named a compile step; and an edit's search text that named the approval surface's route. Mail bodies are now
  written with the file tools.
- **What the whole-tree guards caught before the push** (each a place the next recipe will trip on, so check them first):
  - `rings/fastify-l4`: a new route file that imports fastify's types needs its allowlist row (`fastify-l4.data.ts`).
  - `rings/totality`: every new `server/src` file needs its context in the architecture spec's table (C2 for the test box).
  - `rings/wire-totality`: an exported literal union needs a sibling `Record<X, true>` map (`FramesViewKey`).
  - `box-token-census`: an exempt-but-authenticated route must be named in the README's auth paragraph list.
  - `single-definition/injected-prompts`: every typer site (`sendPrompt`'s text, a computed key, a literal outside the
    two primitives) is named in its lists, a moved loop and a named key constant included.
  - `single-definition/late-census`: `CREDENTIAL_MASKS` has named readers only; a second one gives its reason.
  - `single-definition/roster-bash`: the four model classes are never spelled again; derive from `shared/models.ts`.
  - `tmux-socket-census`: no raw `'tmux'` call outside the adapter; the frame's cursor is read through
    `Tmux.cursor` (`list-panes`, a granted verb, the active row).
  - `single-definition/core-vocab`: a new coordination store file joins the handle holders.
- **What the PR's fast run caught that the local guard batch had not run** (the first full run, so the suite line is red):
  - `delivery-lane-capture`: the frames pass takes a pass that sends no delivery job, so the delivery lane's own file
    counts delivery jobs; the frames lane's turn is pinned in its own file.
  - `lane-draft-never-blocks`: every `sendPrompt` call has its row in the call-site table, the frames step's included.
  - `injected-prompts-characterization`: the typers' caller lists name the frames step, the moved line loop
    (`typeComposedLines`) and the computed `STASH_KEY` sites.
  - `pane-sgr-guard-characterization`: one SGR stripper; the box frames rule's own is named as its one neighbour, with
    the reason above.
  - `testbox-pins`: a test that plants the fleet host's box settings joins the capture holders.
  - `refusal-status`: a new route answers its refusals through `refuseRoute`, so its own words take a row in
    `shared/refusal.ts` (`FRAMES_READ_REFUSALS`), and `not-configured` answers the table's 501.
  - `coord-token`: a box-token check composed for a route its own file registers is counted, and the helper's call is
    that route's registration (held to its file).
- **The three guards the fast run's fixes widen** (the coordinator's ask, 39194), each with what it held, what it holds,
  and the mutant that reds it (each measured on this branch, one file a run, and red):
  - `coord-token` (the box-token lane scan). Before: a `checkMailToken` call's owner was the last `app.get`/`app.post`
    registration above it in `server.ts`, `coord/routes.ts` or `update/routes.ts`, and the scan counted 19 calls. Now: a
    hand-kept `HELPER_ROUTES` table adds one registration kind, a helper call `registerX(app` whose row names the route
    and the file that registers it, and a new case holds each row to its file (`app.get('/api/testbox/frames'` in
    `testboxFramesRoutes.ts`). Of the 40 helper calls in those three files, it sees exactly one,
    `registerTestboxFramesRoute(app` in `coord/routes.ts`, and ignores the rest. Of the 20 calls, only the frames
    check's owner moves (from `GET /api/testbox`, the status read above it, to its own route), and the 19 it saw before
    keep their owners. No door it saw before is lost. None of the files fixes 6 and 7 touch is one of the four gate-code
    files. Mutants: the table's row deleted reds the lane case (the frames check is owned by `GET /api/testbox`
    again); the row's file pointed at `testboxAdmin.ts` reds the new case.
  - `pane-sgr-guard-characterization` (ARCH-63, one SGR stripper). Before: only `pane/dialog.ts` may declare one, across
    `server/src`, `shared`, `pwa/src` and `agent/src`. Now: `shared/framesResult.ts` is named beside it
    (`LEGITIMATELY_DIFFERENT`), the one copy every box frames file strips through (the two copies the branch had are one).
    Why the pane reader's cannot be imported there: `shared/framesResult.ts` is L0, and the ring rule lets a `shared/*.ts`
    file import only its `./` siblings (`rings/shared-imports.test.ts`, D-6045), while the reducer also runs in the test
    box's agent, which builds from `agent/src` and `shared` and never from `server/src`. It is the boundary of what may
    leave the test box, and it takes SGR's colon sub-parameter form, which the pane reader's does not. Mutants: the
    named holder removed reds the guard; a second stripper added to `shared/framesReduce.ts` reds it; and the pane
    reader's imported into `shared/framesResult.ts` reds `rings/shared-imports` (`imports '../server/src/pane/dialog.js'`).
  - `refusal-status` (the inline-send ratchet, D-5381). Before: the read sent seven computed-status refusals inline. Now:
    each goes through `refuseRoute`, at the one status the table gives its word. The read's own four words take a
    `FRAMES_READ_REFUSALS` row in `shared/refusal.ts`, each at the status the read sent before (400, 400, 404, 503), and
    the shared words `unauthenticated` and `bad-request` keep 401 and 400. One answer changes: `not-configured` (a server
    with no coordination store) is 501, the table's status for the word, where the read sent 503. The read has one
    caller, the closed client's `testbox frames` row (`ccd/ccrc-api`), and a session reads frames through it
    (`shared/framesFixture.ts`'s flow). The client prints any HTTP answer's body as it came, writes `http <code>` on
    stderr and exits 0, so the caller sees `{"ok":false,"error":"not-configured"}`, `http 501` and exit 0, and acts on
    the word. The PWA does not call the read. Pinned twice: the read's own suite holds `[501, 'not-configured']`, and
    the client's suite holds the body, the status line and exit 0 for a 501. Mutant: `not-configured` sent inline at
    503 reds the read's store case and three ratchet cases.
- **Not run here, read from CI on 8ccde82251, each passed:** the pin suite whose name names the approval signing (the
  approval-surface guard refuses a command naming it, 5 cases), the test projects' compile guard (it needs the console's
  packages, not installed in this tree, 12 cases), and `retire-executors-pin.test.ts` (230 cases), which timed out on this
  box under load, on this branch and on a clean checkout of main alike (#3484).
- **Packets:** one went to each holder of a file this wave edits (`send.ts`, `agent-protocol.ts`, the coordination store,
  port and schema, the gate and its suite, `server.ts`), and three to the capture owner. Each edit followed its yes.

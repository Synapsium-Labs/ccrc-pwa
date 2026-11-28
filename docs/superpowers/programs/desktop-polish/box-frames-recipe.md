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
  the text under `server/test/fixtures/box-frames/` (`FRAMES_FIXTURE_DIR`) as `frameFixtureOf` writes it: a header line
  naming the build, the frame id and the recipe version, then the frame. `box-frame-fixtures.test.ts` holds every file in
  that folder, whatever its name and however deep, to its header, its name and the reducer's check. The folder holds
  frames only: the panes' `box/` folder holds the earlier box fixtures, which are not frames (review 4069's A5).
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
read is in it. The dark rule is held by the gate suite's whole-surface property loop (a dark box answers what a signed-in
caller sees), not by the read's own suite, which injects its two credentials (review 4069's A4). The box-token census
counts the frames read as a lane of its own (review 4069's F6): its check is composed in `coord/routes.ts` and handed to
its own route file, and one table of helper routes (`server/test/boxTokenHelperRoutes.ts`), which the census and the
coord-token guard both read (review 4086's F-F), makes the helper's call that route's registration, so the check is no
longer credited to the status read above it. The derived counts are 109 lanes,
106 machine lanes and 39 coordination routes. Its query is closed: `build`, and optionally `frame`. The list answer
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

**Review fix round 1 (review 4069, the coordinator's rulings 39533, 39537 and 39557), each rule red first and held by
its cases:**
- **The shape rule, by Unicode class (F1).** Once SGR is removed, a frame holds no control but LF (C0, DEL and C1, so a
  one-character CSI or OSC too), no format character (the bidi marks and isolates, the zero-width and joiner characters,
  the byte-order mark), no line or paragraph separator, no lone surrogate and no private-use character. Any one refuses
  the frame whole (`not-a-frame`). The 61 recorded 2.1.300 panes hold none of them, private use included (measured), and
  reduce exactly as before.
- **A wrap (F2).** On the box, a private string whose head ends one row and whose tail starts the next, at any split
  point, refuses the frame whole (`private-shape`). It is read on the rows as drawn and again with the decoration at the
  break stripped, with SGR removed, so a colour change or a border between the halves does not hide it. The runner
  gives the capture's working directory among its strings (a case pins it). On both hosts, so the server's check holds
  the same rule with none of the box's strings: a token with a `/` run to a full-width row's last column and going on
  below refuses; so does a replacement token cut anywhere (made exact in round 2, below); so does a path's tail at the
  start of the row after a row that ends in a token or runs to the edge. A row too narrow for its whole token refuses the
  frame rather than cut the token. The reviewer's two frames are cases by name,
  as the box now refuses them and as the server refuses what a box without the fix sent.
- **The status row (F3).** The capture's settings run the recorder as the status line, and it prints one fixed text,
  `ccrc capture`. The status position is the row directly under the frame's lowest rule row. In the recorded 2.1.291
  panes made under a status line, that is where it is drawn, with the mode row below it (measured). It fails closed:
  that row, spaces trimmed and SGR removed, must be exactly the text; the text with anything beside it, any other text,
  a second row holding the text, a blank or missing row there, and a frame with no rule row at all each refuse the frame
  whole with a word of their own, `status-row`. Once it is exactly the text, the row is ours. One function on both hosts.
  Every recorded input-box pane in the tree has a rule row: the 61 at 2.1.300 and the 29 in the panes' box folder
  (pinned). No pane per recipe case is recorded; the cases that press PageUp have never been drawn on any build here.
- **The over-replacement corpus, altered (F3).** The 2.1.300 panes were drawn with no status line, so as recorded every
  one is refused `status-row` (under its lowest rule each holds an ask's last option, its tab row, a hint such as
  `paste again to expand`, or the auto mode row; pinned). The measurement case adds the status row as a NEW row under each
  pane's lowest rule, and the counts are unchanged: 38 model rows, 5 path rows, 0 account rows, 61 panes reduced. Since
  round 2 it does so at the pane's real size, so its top row scrolls off (F-H, below).
- **Short names (F4).** A user or host name of one to three characters is no longer dropped: it is matched as a whole
  word, bounded by the row's edge or by a character that is not a letter, digit, dot, dash or underscore, and its row is
  replaced as a longer one's is.

**Review fix round 2 (review 4086, the coordinator's ruling 39742), each red first and held by its cases:**
- **A cut token is exact (F-A).** Claude Code draws a held stash as a row that begins with the single right-angle quote
  (`› stashed · …`), the character the replacement tokens end in. Round 1's check read any such quote that closed no token
  as a cut, so it refused both recorded held-stash panes whole, on both hosts. A cut is now the opening quote followed by
  a non-empty part of the start of a token's name that does not go on to the whole token, or a non-empty part of the end
  of a name followed by the closing quote and not preceded by the rest of the token. A bare quote, with no part of a name
  against it, is Claude Code's own glyph and is kept. The stash notice row is a fixed Claude Code string and is kept byte
  for byte. Nothing else about the cut rule moved: the reviewer's round-1 frames still refuse, and a row too narrow for its
  token is refused where it would be replaced, never cut short. The token names begin with three different letters and
  end with three different letters, so at most one name stands against a quote.
- **The full-width rule counts screen cells (F-B).** A wide character (the East Asian wide and fullwidth blocks, an emoji
  drawn as one) counts two cells, so a row that reaches the last column through one is at the edge. A row of wide
  characters one cell short is not. Round 2's sentence that a row is never read as narrower than it is drawn was not true:
  the wide set was a hand list, and a wide character outside it counted one cell (review 4109's R1 and F7). Wave 195
  replaced the list with the Unicode table and says where a row is still read narrower than it is drawn (section 9.1).
- **Recorded panes as the recipe meets them (F-H).** Every recorded pane of the panes' box folder, and every 2.1.300 pane,
  is reduced with the capture's status row a NEW row under its lowest rule, at the pane's real width and height (its rows
  and its widest row, as the reader measures them), so the pane's top row scrolls off and every rule runs as on a real
  frame. Measured: all 29 box-folder panes reduce on both hosts (before the fix, the two held-stash panes were refused
  `private-shape`), and the 2.1.300 counts are unchanged at the real sizes (59 panes at 220x50, two at 100x40): 38 model
  rows, 5 path rows, 0 account rows. The held-stash panes keep their notice row byte for byte; the one row replaced in each
  is the banner's model-and-plan row.
- **Three survivors killed (F-G).** A stored row whose record says `over-cap` but holds a text is refused `not-a-frame` by
  the read, which reads the whole result again; the read asks the live masker in rows mode, every call; our own mail
  notice wrapped at exactly the pane's width inside `~/.local/bin/…` reduces unchanged, because both rows are ours.
- **One table of helper routes (F-F).** The census and the coord-token guard read one table,
  `server/test/boxTokenHelperRoutes.ts`; each holds every row to its file. Emptying the table reds both.

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
- **A short user or host name.** On a box whose user or host is an ordinary short word, frames lose that word: each row
  holding it as a whole word is replaced (review 4069's F4). As built, beside a digit, a dot, a dash, an underscore or any
  letter (a non-ASCII one included) it is not the word and is not replaced, and case is not folded (`Bo` and `BO` are
  kept); the injected private-name scan carries case (review 4086's F-E). **Changed in wave 197 (10.4):** the word
  classes are fixed ASCII, so beside a non-ASCII letter, digit or mark the name is the word and its row is replaced.
- **A private name that is also part of our own text.** A row whose whole content is a private string that is also a run
  of one of our fixed texts is kept, because rule 2 runs before rule 3 and the two cannot be told apart there. Round 1's
  note said such a row is replaced; it is not (review 4086's F-E). The recipe's fixed texts are this repository's own, and
  the box's strings (its home, user, host and directories) are not runs of them at any recorded size.
- **The path rule reads ASCII components only.** `PATH_LIKE` takes `[\w.-]` components, so `/srv/проект/данные` is not
  read as a path; the box's exact home and working-directory strings still replace the capture's own paths (review 4086's
  F-E).
- **A private string split across three rows is not caught.** The wrap rule joins two adjacent rows. A three-row split needs
  a middle row that is wholly inside the private string, so the string would be longer than that row's content. A row's
  content is not always the pane's width: inside a bordered box drawn narrower than the pane, a row holds only what fits
  between the borders, so the split needs a string longer than the box's content width, not the pane's 220 columns
  (review 4109's F7). The longest of the box's strings, its working directory, is about 70 characters: inferred, not
  measured on a real box (review 4086's F-C). **Closed in wave 197 (10.7):** the wrap rule reads a private string
  through as many rows as it needs.
- **Characters the class rule lets through.** Variation selectors, combining marks, unassigned and noncharacter code
  points, the Hangul fillers, the braille blank, the no-break and wide spaces, the object replacement and replacement
  characters and regional indicators pass the shape rule, which is by class as ruled. Placed inside a private string, a
  model word or an account word, one defeats the exact matchers (a private with a U+FE0F inside survives on the box;
  `Haiku 5.5` with a U+034F inside survives rule 5). It defeats three shape rules too, which are not exact strings, because
  a combining mark splits the run each reads (review 4109's R2): the path rule (`PATH_LIKE`, components of `[\w.-]`), the
  private shapes (`PRIVATE_SHAPES`: a home or mount path, a home-relative path, an email, an IPv4 address, a host name and
  a long hex run) and the credential shapes (the product masker's `CREDENTIAL_MASKS`, which rule 9 runs on the box). No
  build draws one there. A named residual (review 4086's F-D), on the alarm wave's ticket. **Closed in wave 197 for the
  variation selectors and the combining marks (10.5):** every matcher also reads the text less its marks. The other
  characters of this list still pass, and still split a run.
- **The third stash pane's notice row is replaced.** In `stash-after-cs.ansi` the stash notice shares its row with the tmux
  hint, which carries `~/.tmux.conf`, so the path rule replaces the whole row and the notice is not in the stored frame
  (pinned). If the first real capture's stash case shows a replacement on that row, that figure goes to the capture owner
  with the rest, and the question of replacing only the path comes back then (the coordinator's ruling on F-A).
  **Wave 197 (10.6):** it stays a stated limit.
- **The status pair is held on the literals.** The agent case holds `FRAMES_STATUS_TEXT` equal to the recorder's
  `STATUSLINE_REPLY`, and the settings the capture writes name the recorder; no case reads the `settings.json` the runner
  writes. A runner that dropped the status line would have every frame refused `status-row`: it fails closed (review
  4086's F-I). On the alarm wave's ticket.
- **The status row fails closed.** A build that draws any notice on the status row itself has every frame refused
  `status-row`. In the recorded 2.1.291 model-picker pane the build draws its effort mark at that row's right end. The
  first real capture's refused-by-word counts show it if it happens, and they go to the capture owner.
- **A narrow replaced row refuses.** A row whose content is narrower than its whole token (`‹working directory›`,
  `‹model›`, `‹account›`), both measured in screen cells since wave 195, refuses the frame where it would be replaced.
  None of the 61 recorded 2.1.300 panes and none of the 29 box-folder panes has one.
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
- **frames-status-text-held-twice** (review 4069's F3, the coordinator's answer 39557): the capture's status text is held
  once in `shared/framesReduce.ts` (`FRAMES_STATUS_TEXT`), which the reducer reads on both hosts, and once in the recorder
  (`captureRecord.ts#STATUSLINE_REPLY`), which is left as it is on main. F3's "no second copy" became "one shared copy and
  one process-boundary copy, held equal": the server's check must know the text and cannot import agent code, and the
  recorder runs as its own type-stripped process and imports no local module. An agent case holds the two equal.
- **frames-status-row-refusal**: rule 8 is the plan's corrected step (the plan said the capture configures no status line,
  which was not true). Its refusal word, `status-row`, is a fifth word of the frames refusal vocabulary.
- **frames-fixture-folder**: frame fixtures go in `server/test/fixtures/box-frames/`, not the panes' `box/` folder the
  plan named, so the tree check can hold every file in the folder (review 4069's A5). The plan is corrected.
- **frames-short-names-kept**: `boxPrivates` keeps a user or host name of any length. Its pin held that a name under four
  characters was left out, and now holds that it is kept (review 4069's F4).
- **plan-statements-the-code-departs-from** (review 4086's F-I): five statements of the plan that the code does not do,
  each by the plan's line at this round's tip. Line 247 to 249: the signatures are `reduceFrame(frame, pane, ours,
  privates, scan, mask)` and `checkReducedFrame(text, pane, ours, scan, mask)`, each with the pane and the masker. Line
  264: the home's `~` form is not among the box's strings; a home-relative path is caught by rule 4 and by the private
  shapes instead. Line 296: rules 4 to 6 do read a rule row, and a label they would catch refuses the frame, never kept and
  never rewritten (the background security review). Line 320 and 328: rule 5 and rule 6 are one chain, so the banner's row
  is counted once, as a model row: 38, 0 and 5, not 38, 38 and 5. Line 572: "Waiting on you" still waits on the owner's
  yeses to packets 1 and 2 and the wave 185 worker's word, each given since (sections 3 and 8).
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

**The mutation round** is run by hand, because the mutation helper mutates Python modules only. Each mutant is applied to
its file, its named test file is run once through the supported runner, and the file is restored byte for byte. The first
round's table claimed 50 killed. Review 4069 could not reproduce the fixture row's version half (its F7): the header held
the version's grammar twice, so no single mutant of either reds. The grammar is now held once, by `FRAMES_VERSION_SHAPE`,
and a bad-version case reds without it.

**Re-run on this round's final tip** (the coordinator's ask, 39533): every row of the table below, the first round's
mutants carried to the code as it now stands (six re-anchored where the code moved, the store's four rewritten), the
reviewer's survivors (W2b, W4, the C1 class and the version grammar) and one per new guard of this round. **79 mutants,
79 killed, measured.** The first run of 80 on the tip before it left two alive, and each was a finding:
- a branch of the reduced text's check (a path's tail after a row run to the edge) could not fire apart from the
  full-width rule, which runs on both hosts, so it is removed, and its mutant with it;
- the composed frames run was held to its worst case by an upper bound, and the longest part it picked was chosen by the
  formula under test, so a worst case without the person's bound passed. It is now measured exactly, as the delivery
  part's is, and the person part is one of its parts by name.

| Area | Guard removed or weakened | Killed by |
|---|---|---|
| reducer | the shape gate; a decoration-only row read as ours; the turn marker off the decoration list; exact private strings; the path, model and account rules; the rule-label refusal; a rule row's private string; the private-name scan; the private shapes; the masker with SGR removed; the masker; the receiver's idempotence; the width | `frames-reduce.test.ts`, each rule's own cases |
| reducer, round 1 | the C1 controls; the wrap rule; the wrap rule on the rows as drawn only; the full-width rule; a cut token; a cut token's tail; a path's tail after a token; the status rule; the status text by prefix; a second status row; no rule row; an empty status position; a short name matched anywhere; a short name never matched | `frames-reduce.test.ts` |
| result reader | the case echo; over-cap against the measured sizes; the text's shape; the text's presence; the counts' presence; the cursor bound; the word; control characters; the byte ceiling; the C1 controls; the format characters; the separators; lone surrogates; private use | `frames-result.test.ts`, each refusal case |
| store | the text kept only when the check is clear; the whole-row version check; the own-property word check (`v in map` in its place) | `frames-lane-store.test.ts` |
| store, the texts set aside | a drop that sets nothing aside | `frames-lane-capture.test.ts` |
| lane decider and list | the spacing; the version in `isCurrentFrames`; four builds kept; the incoming build counted; a store-refused frame's text; its word (round 1, A1); its counts (round 1, A1) | `frames-lane-decider.test.ts` |
| fixture | the header's grammar; the version shape check (round 1, F7); the tree check by name pattern (round 1, A5) | `box-frame-fixtures.test.ts` |
| the read | the credentials; the closed keys; an empty value; the check before serving; the live masker; `no-text` at 400 (W4, round 1, L1) | `testbox-frames-route.test.ts` |
| the census | the frames read's composed check removed (W2b, round 1, F6) | `box-token-census.test.ts`, the frames read's own case by name |
| the local arm | no frames ask sent from the single-box arm (round 1, F5) | `frames-transport.test.ts` |
| the driver | the person's newline; the halt on a fault; the step word | `delivery-drive-frames.test.ts` |
| the worst case | the person's bound; a turn's settle; the person's bound in the composed run (round 1, A2) | `testbox-capture-frames.test.ts`; `testbox-capture-deadline.test.ts` |
| the drive | the hold's release; the cap at the runner; the privates handed to the reducer; a refused key; the status text moved (round 1, F3) | `testbox-capture-frames-run.test.ts` |
| the box's strings | the short-name floor back (round 1, F4) | `testbox-capture-frames.test.ts` |
| the client | the build grammar; the frame grammar | `ccrc-api.test.ts` |
| reducer, round 2 | a closing quote that ends no token a cut again (F-A, widened); an opening quote that starts no token a cut again; the cut check narrowed to nothing; its head loop deleted; its tail loop deleted; a row too narrow for its token kept as drawn; the edge counted in code points (F-B); an emoji counted one cell; a CJK ideograph counted one cell; the full-width rule without its ours-row exemption (O6) | `frames-reduce.test.ts`: the held-stash panes, the bare quotes, the reviewer's frames, the narrow row, the wide-character edge and our wrapped notice, each by name |
| the read, round 2 | the whole-result re-read skipped (O4); the masker asked without rows mode (O5) | `testbox-frames-route.test.ts` |
| the helper table, round 2 | the one table's row removed (F-F) | `coord-token.test.ts` and `box-token-census.test.ts`, each by name |

**Re-run on round 2's final tip** (the coordinator's ask, 39742): every row of the table above, at 2f312f5297, the last
commit that changes code or a test (the commit after it changes this note only). Round 1's 79, three of them re-anchored
where the cut check, the replacement and a rule row's private string moved, and 13 for round 2's guards, including the
reviewer's three survivors (O4, O5, O6). **92 mutants, 92 killed, measured.** A first run of 91 at 1532e9c2da (before the
census read the one table) killed all 91 as well. The mutation runner is a scratch script that applies each edit, runs its
named test file once through the supported runner, and restores the file byte for byte (review 4086's F-I (2): it is not
in the tree, and the table above is the record).

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
    `testboxFramesRoutes.ts`). Of the 41 helper calls in those three files (40 at the base, measured; the note said 40 until review 4069 counted 41), it sees exactly one,
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
- **Tests that read a changed file as text, outside the fast run's selection** (the coordinator's ask, 39345; issue
  #3562): for every `server/` and `shared/` TypeScript file this branch changes against `main` (25 files), every test under
  `server/test` that names its path in a string, not an import line (193 tests). The PR's selection already holds 176 of
  them. The other 17 ran here on the merge of `main` 9e5f592c24, one file at a time, and all 17 passed, 548 cases:
  `advance-gate`, `archive-admission`, `archive-door-decide`, `auth-ratelimit`, `ccd-win-size`, `claims`, `divergence`,
  `history-parser`, `mail-envelope-parse`, `overlord-board-door`, `pane-prompt-glyph`, `path-identity-w2-prose`,
  `peers-claims-l0`, `program-view`, `pwa-static-cache`, `route-decide` and `route-fields-parse`.
- **Not run here, read from CI on 8ccde82251, each passed:** the pin suite whose name names the approval signing (the
  approval-surface guard refuses a command naming it, 5 cases), the test projects' compile guard (it needs the console's
  packages, not installed in this tree, 12 cases), and `retire-executors-pin.test.ts` (230 cases), which timed out on this
  box under load, on this branch and on a clean checkout of main alike (#3484).
- **Review fix round 1** (review 4069; the coordinator's 39533, 39537 and 39557):
  - The census change went to chat A first, which held the census, the gate suite and `gate.ts`, as a packet measured on
    a scratch copy (the census 92 cases, the gate suite 434, mutant W2b red in 5 cases). Its yes (39547) came before the
    edit.
  - The tests that read a file this round changes as text, outside the fast run's selection (#3562): for the five
    `server/` and `shared/` TypeScript files this round changes, eight tests read one as text. Each ran alone on this
    branch merged with `main` (not absorbed) and passed: `auth-gate`, `box-token-census`, `coord-pause-route`,
    `notify-token`, `pane-sgr-guard-characterization`, `refusal-status`, `single-definition/advance-switches` and
    `single-definition/late-census`. (Corrected in round 2, review 4086's F-I: the round-1 list missed `notify-token`, which
    reads `server/src/auth/gate.ts` with its path in pieces, and named four that only import a file or mention it in a
    comment, `coordinator-skill`, `frames-lane-decider`, `frames-result` and `pool-accounts-route`; all four passed too.) So did the count suites
    (`ccrc-api`, `ccrc-api-closed`, `coord-db`, `limit-samples-store`, `run-close-switch`, `coord-token`, `testbox-pins`).
    The final tip was merged again with `main` at 276555102d (#3490 had landed and touches the census), and the count
    suites, `late-census` and the frames suites passed there too. The figures stand: 343 scanned, 340 HTTP, 220 gated,
    120 exempt, 34 route files, 105 client rows, migration 134 (`main`'s highest is 133).
  - One guard this round's cases tripped: `testbox-pins`, because the local-arm case plants the box settings in a fixture
    `HOME`. The transport test is named as a capture holder.
  - No hook refused a command this round.
- **Review fix round 2** (review 4086; the coordinator's 39742):
  - The census change went to chat A first, which holds the census, as a packet of three edits measured on a scratch copy
    (the census 92 cases, coord-token 44, the table's row removed red in both). Its yes (39759) came before the edit, and
    the edit is that packet byte for byte.
  - Main had moved to 8595076eca (#3566, #3567, #3569). My probe of the tip against it was clean (exit 0), so nothing was
    absorbed. On the tip merged with that main in scratch (not absorbed, not committed), each alone, all passed: the gate
    suite (434 cases, which asserts 343 scanned routes), the census (92, which derives 109 lanes, 106 machine lanes and 39
    coordination routes and holds the README and `gate.ts` to them), `coord-token`, the count suites (`ccrc-api` with its
    105 client rows, `ccrc-api-closed`, `coord-db`, `limit-samples-store`, `run-close-switch`, `testbox-pins`), `refusal-status`,
    `coord-pause-route` and `notify-token`; the three sender-reading suites (`pane-prompt-glyph` 6, the injected-prompts
    characterization 11, `send` 158) and `send-tall-box`; every frames suite on the server and the agent, `testbox-imports`
    included; and the guards that read this round's `shared/framesReduce.ts` as text or scan `shared/`
    (`single-definition/late-census`, `single-definition/advance-switches`, `pane-sgr-guard-characterization`,
    `rings/shared-imports`, `rings/wire-totality`, `rings/fastify-l4`, `single-definition/injected-prompts`,
    `single-definition/roster-bash`). The figures stand: 343 scanned, 340 HTTP, 220 gated, 120 exempt, 34 route files, 105
    client rows, migration 134 (`main`'s highest is still 133), and 109, 106 and 39. No side moved them.
  - `DELIVERY_RECIPE_VERSION` printed `da16fe2f55551e0b` on the tip and on the merge.
  - The background security review flagged two of the mutation round's mutants while each was applied (the client's frame
    grammar dropped, and a rule row's private string kept). Each was the runner's transient edit, restored after its run;
    the tree was clean after the round.
  - No hook refused a command this round.
- **Packets:** one went to each holder of a file this wave edits (`send.ts`, `agent-protocol.ts`, the coordination store,
  port and schema, the gate and its suite, `server.ts`), and three to the capture owner. Each edit followed its yes.

## 9. Wave 195: the reducer's width model

Review 4109 of #3487 found that the full-width rule measured a row with a hand list of wide characters, so a row that
truly reaches the last column could read one cell short, and a path the pane wrapped there was kept in a stored frame (its
R1). Nothing leaked: no real capture had run. The capture owner and the coordinator agreed that no real capture with this
recipe starts until this wave is on `main`. Every change below is in `shared/framesReduce.ts`, the one function the test
box's reducer and the server's check both run, and each case shows both hosts. This section describes the code at the
wave's last push; section 9.5 says what each push changed.

### 9.1 What the width model is now

- **The data file is the fixture (rulings 1 and 2; review 4133's F2).** `server/test/fixtures/unicode-east-asian-width.txt`
  is the Unicode Character Database file `EastAsianWidth-17.0.0.txt` (Unicode 17.0.0, dated 2025-07-24, from the Unicode
  Consortium's public UCD directory for 17.0.0), byte for byte: 201,595 bytes, sha256
  `ea7ce50f3444a050333448dffef1cadd9325af55cbb764b4a2280faf52170a33`, with its own header and terms lines and no line
  added. A case pins the sha256, the length, the name and date lines and its 2,678 data lines, so anyone can compare it with
  the public file. No test fetches anything. No size guard in the tree reads it (the growth guards read source files only);
  the tree scans read it and pass.
- **The one-cell table.** `FRAMES_ONE_CELL_RANGES` is every code point the file lists as N (neutral), Na (narrow), H
  (halfwidth) or A (ambiguous), merged: 747 ranges. Everything else counts two cells: what the file lists as W (wide) or
  F (fullwidth), and what it does not list at all, 758,564 code points. The file lists every assigned code point
  (measured on this engine: no code point it has assigned is missing from the file), so every unlisted code point is
  unassigned in Unicode 17.0. Not every unassigned one is unlisted (review 4161, A3): the file also lists 56,166
  unassigned code points, all as W (reserved ranges of the CJK blocks and planes 2 and 3), and they count two cells too.
  **Unknown is relative to the table, never to the engine:** the answer for a code point is the same on every
  engine version, and one assigned after 17.0 counts two cells until a newer data file says otherwise. The reviewer's
  measured case, Wide code points of the next version's public data that this file does not list (Jurchen, Khitan, Tangut
  components, a small archaic Katakana YE), counts two cells with no engine asked.
- **How it cannot drift.** The table is generated, never edited by hand. The table case parses the fixture, merges the
  one-cell lines, writes the table's source text from them (eight pairs to a line) and requires the shared file's table to
  be exactly that text and its numbers to be exactly those ranges. A new version is a new fixture, and the text the case
  then expects is what goes into the shared file. The table is numbers, not regular expression escapes, so it is ASCII
  by construction: 14,426 bytes of source, and a case reads them and requires none over 0x7f. The engine's regular
  expressions have no East Asian Width property, so no property escape could stand in. The shared file still imports
  nothing new.
- **The one stated addition (the coordinator's ruling after the first push).** U+3248 to U+324F, circled numbers on black
  squares, are A in the file, so the table lists them as one cell; `main`'s hand list counted them two (its range U+3041 to
  U+33FF took them in). A terminal that draws an ambiguous character wide draws them in two, and over-counting only
  refuses, so they stay two cells: `FRAMES_WIDE_KEPT`, one named constant beside the table, its reason in its comment.
- **The engine's one class, a widener only.** An emoji drawn as one (`Emoji_Presentation`) counts two cells. It takes in
  the 26 regional indicators, which the file gives N. It can make a code point wider than the table says, never narrower,
  so a newer engine only widens. A case walks every code point and requires that each counts at least what the table and
  the addition give it, and that every one counted wider is an emoji drawn as one; the regional indicators are among
  them. The engine's unassigned class is no longer asked anywhere, and the case on the engine's Unicode version is gone.
- **The engine's second class, a widener only (review 4161's F1).** A combining mark (`\p{M}`) at the start of a next row's
  content makes its first character count two cells (9.2). It is asked under the same exception as the emoji class and
  for the same reason: it only widens, so it only refuses. Two hosts whose engines disagree on a mark lose a frame (one
  of them refuses it) and never keep a tail. The emoji selector and the keycap mark are named beside it, so those two
  hold with no engine asked. The class is only as new as the engine: 9.4 states that limit.
- **Nothing counts narrower than on `main`.** A case holds `main`'s rule as data (its hand list's twelve ranges, from
  86b2c2d6e2) and compares every code point, with no engine asked: **none counts narrower, and exactly 768,240 count
  wider**, a figure that is the same on every engine. It also compares with the engine's emoji class on both sides, as
  `main` and this function each read it: none narrower.
- **Private use.** A private-use code point never reaches the width: rule 1 refuses the frame whole (`not-a-frame`)
  first, as it does a surrogate, a control and a format character. Were it asked, it would count one cell (the file gives
  it A). A case pins it.
- **Where a row is still read narrower than it is drawn (F7, review 4133's F1).** Only where a terminal in an East Asian
  locale draws an ambiguous-width character in two cells: the table counts the A characters one cell, as `main` did, less
  the eight of the addition. The frames driver runs under `LANG=C.UTF-8` (read in `agent/src/testbox/captureFramesRun.ts`),
  which is not one; how the terminal draws them there is inferred, not measured. A combining or zero-width mark counts one
  cell though it is drawn in none, so a base followed by the emoji selector (U+FE0F) or the keycap mark (U+20E3) counts at
  least two in a row: wider, never narrower.

### 9.2 The full-width rule

- **A straddle is at the edge (ruling 3).** A row that ends one cell short of the pane's width, whose next row's first
  character is two cells, is at the edge: the wide character did not fit in the last cell and the terminal wrapped it
  whole, leaving that cell blank. "One cell short" is measured **after the row's trailing spaces are dropped**, because a
  read of the pane may give the blank cell as a trailing space or as nothing; measured on the row as drawn, the rule kept
  the path it continued, the wrong direction. The path token at the row's end is read from the same trimmed row.
- **One reader of the next row (review 4133's F1, the coordinator's ruling).** The straddle test and the tail are read
  from the same content of the next row, after its leading decoration (`nextRowContent`, through `spans`), so the two
  cannot disagree. Before this round the straddle read the next row raw, so a next row that began with decoration before
  the wide character (a two-space indent, a bar, the prompt glyph, the turn marker, a no-break space) kept the continued
  tail on both hosts. Its first character counts two cells when the emoji selector or the keycap mark follows it, since a
  terminal may draw such a base in two cells. Cases, at a 20-column and a 220-column pane, each on both hosts: each
  decorated form the cases list refuses (a two-space indent, a bar, a bar and a space, the prompt glyph, the turn marker,
  a no-break space, each before a wide character); each selector and keycap form they list refuses (a base then the
  selector, a digit then the selector and the keycap, a digit then the keycap, an indented base then the selector);
  decoration then a narrow character is not a straddle and is kept.
- **A next row that begins with a code point that cannot begin a character (review 4161's F1, the coordinator's ruling on
  the class).** The turn marker is a decoration, so a next row of the turn marker then the emoji selector was stripped to
  a bare selector, which the table counts one cell: the straddle test did not fire and the tail was kept on both hosts.
  Not a regression (the merge base kept it too), and no recorded pane holds the selector. Now, when the content after the
  leading decoration begins with the emoji selector, the keycap mark or any combining mark, its first character counts
  two cells. Cases, at 20 and 220 columns, each on both hosts: the turn marker then the selector then a continued tail,
  bare and with a two-space indent; the bar then the selector; the turn marker then the keycap mark, bare and indented;
  the turn marker then a combining mark (U+0301) then a wide character, bare and indented; and the turn marker or the bar
  then a combining mark then a narrow character, which refuses too: **an accepted over-refusal**. Decoration then a
  narrow character with no mark (the turn marker among them) is still not a straddle, and is kept.
- **The keycap clause at the third position is dropped (review 4161's A1).** It looked for the keycap mark after a
  selector, which the selector at the second position already counts, and nothing pinned the shape only it covered (a
  base, a mark that is not the selector, then the keycap: an over-refusal). Dropped rather than given a case. So one
  shape now counts narrower than at bf24543d43 (review 4168): a first character, then a code point that is neither the
  selector nor the keycap (a mark, a letter or U+FE0E), then the keycap mark; that head refused it, this one keeps it.
  That it was an over-refusal is reasoned, not measured on a terminal.
- **A next row that begins with a Unicode space off the decoration list (review 4168's F1, the coordinator's ruling: the
  reviewer's measured fix, exactly).** `spans` strips only the two decoration spaces (the space and the no-break space),
  and both tail readers took a run of non-space characters at the start of what was left, so a content that began with
  U+3000, U+2000 to U+200A, U+202F, U+205F or U+1680 read as no tail at all: a full row then such a space then a
  continued path was kept on both hosts, a row one cell short then U+3000 then a tail was kept although the straddle test
  said the wide character wrapped (the two readers disagreed), and a token row then such a space then a path was kept.
  Older than this wave. Both tail readers (`pathTail` and the edge reader in `pathOffTheEdge`) now skip leading
  whitespace before they take the run. The spaces stay off the decoration list, because U+3000 is itself the wide
  character that wrapped and the straddle test must still see it first; so the comment that the two readers cannot
  disagree is now true. Cases, at 20 and 220 columns, each on both hosts: a full row, then each of the fifteen spaces
  (U+3000, U+2000 to U+200A, U+202F, U+205F, U+1680), then the tail, bare, indented and after the turn marker, refuses;
  a row one cell short, then U+3000, then the tail, bare and after the turn marker, refuses; a row one cell short, then a
  one-cell space of the list (U+2003), then the tail, is kept, which is the correct answer, because the row did not reach
  the edge; a token row (each token that fits the pane), then U+3000 or U+2003, then a path, refuses; a token row, then
  an ASCII indent and a word that is not a path, is kept; a full row that holds no path, then such a space and a word, is
  kept. A next row whose first character is narrow, with a mark later in it, is still not a straddle (the mark test is
  anchored to the first code point).
- **The capture owner's condition (ruling 4), red first on the old rule.** A row built with a wide character outside the
  old hand list reaching the last column, then a continued path tail, refuses the frame whole on both hosts (U+2329,
  U+FE10, U+A960, U+16FE0, U+17000, U+1B000 and U+1F200). A straddler at the last column, then a continued tail, refuses on
  both hosts, with and without the trailing space. A row one cell short whose next row begins with a narrow character is a
  short row, not a wrap, and is kept; so is a row two cells short.
- **A row ending in the decoration (review 4133's A6).** A row whose last character is a border character is not run to the
  edge, even at the full width: a case now pins it.

### 9.3 What the box sends, and the smaller items

- **What the box answers as reduced passes the server's check, by construction (review 4133's F3).** A replaced row is
  padded in screen cells (F5), while the shape gate caps a row in code points, so a row of characters that count two cells
  but take one code point could come out longer than the gate allows: the box answered `reduced` and the server refused
  the frame. `reduceFrame` now runs the server's check on its own result, with its own lists, and refuses the frame with
  the check's word when the check would refuse it. The masks differ between the hosts (review 4161, A5): the box reduces
  with the default, the masker's shapes, and the server checks with its live masker, so the server may still refuse
  (`masked`) a frame the box reduced. That loses a frame and leaks nothing. The reviewer's 40-column frame (18 unassigned code points and a path)
  now refuses on the box, `not-a-frame`. A case states the property over every recorded pane as the recipe meets it, and
  over the capture owner's frames, and pins its counts exactly (review 4161, A6): 132 panes checked, 128 reduced. While the
  self-check stands it holds by construction. Removing the self-check alone (F3a) leaves it green, because every recorded
  pane's reduced answer passes the check anyway; F3a is red through the 40-column case. The rows that make the property
  case red are PH1 (the self-check removed and every replaced row padded past its width) and PH2 (the same padding with
  the self-check kept, red through the exact count of panes reduced) in 9.6.
- **F5.** A replaced row is measured in screen cells, not code points: the content and the token, the two call sites in
  `replaced`. A content of ten wide characters and a path, 25 cells and 15 code points, is now replaced and keeps its width
  on screen, where it was refused as narrower than the 19-cell token.
- **What changed in the recorded panes (review 4133's T1; this corrects the first push's "no recorded result changed").**
  Measured over all 136 recorded panes that have a rule row, `main`'s reducer against this one, as the recipe meets each
  at its real size: no refusal and no count changed. Re-measured at fix round 2 over all 147, the eleven in the busy
  folder included (158 files): still no refusal and no count changed, the same nine panes changed against `main`, and
  nothing changed at all against fix round 1's reducer; at fix round 3, the same again over all 147, against fix round 2's
  reducer and against `main`. Nine panes' reduced text changed in one row each, a replaced row that carries four more pad
  spaces because its emoji now count two cells and the row keeps its drawn width. In eight it is the model row; in
  `cc291-model-switch-220x50-full.txt` it is a working-directory row, because rule 4 replaces that row first, on a home
  path hint that shares it (review 4168). The nine:
  `cc291-model-ack-220x50-full.txt`, `cc291-model-default-ack-120x30.txt`, `cc291-model-default-picker-120x30.txt`,
  `cc291-model-default-switch-120x30.txt`, `cc291-model-escape-to-picker-120x30.txt`,
  `cc291-model-picker-220x50-full.txt`, `cc291-model-switch-220x50-full.txt`, and in the box folder
  `cc291-model-default-switch-120x30.ansi` and `cc291-model-picker-220x50-full.ansi`. Ruling 5 holds: every box-folder
  pane reduces on both hosts, and the 2.1.300 corpus keeps 38 model rows, 0 account rows and 5 path rows in 61 panes.
- **F3.** A case puts a bare quote before a cut part of a token's name in the same row, for every name and both quotes;
  the reviewer's mutant M8 is red by that case's name.
- **F8a.** A case counts the recorded frames in which the full-width rule has a candidate row: it requires the six that had
  one before this wave (`cc300-ask-freetext-1000.txt`, `cc300-ask-review-4q-100col.txt`,
  `cc300-ask-wrapped-question-focused.txt`, `cc300-ask-wrapped-question.txt`, `box-taller-than-capture.ansi`,
  `stash-held-during-turn.ansi`) and pins the count: 6 of 90, on `main`'s rule and at every push of this wave, this round's
  one reader of the next row and fix round 2's leading-mark rule included (it did not move).
- **F8b.** The third stash pane's case requires that the one row the path rule replaces is the stash notice row, that it
  reads the whole working-directory token, and that the stored text holds no `stashed`.
- **F9 and D1, the version.** The fingerprint gains eight probes, none of which asks the engine anything: a bare quote
  (kept), a Hangul syllable row reaching the edge, a row at the probe's own width, a straddle, a row reaching the edge
  through U+3248, a table-only wide character (U+2329) reaching the edge, a straddle whose row keeps its blank last cell
  as a trailing space, (fix round 2) a straddle whose next row is the turn marker then the emoji selector, and (fix round
  3) a full row then a next row that begins with U+3000 then the tail. A case pins their nine answers. **The frames recipe's version: `03f101670690507b` on `main`, `bec098af3496f523` at the first push,
  `962a0b5e963e0b92` at the second, `5d453fb42f2d80c8` at fix round 1, `e5feb5b34aa37b57` at fix round 2, `bd7b9ac2b9896ec6` at fix round 3.** No file in
  the tree pins any of them outside this note. The delivery recipe's version still prints `da16fe2f55551e0b`.
- **Bundle cost (A5 corrected).** No file under `pwa/src` or `ui/src` imports `shared/framesReduce.ts`, or the one shared
  file that imports it, `shared/framesCapture.ts` (`shared/framesLane.ts` imports `framesCapture.ts` only, not the
  reducer), so the console's bundle carries none of the table today (read, by search of the two source trees).

### 9.4 The note corrected to the code (ruling 8), and the known limits

- **R2** (section 5, the class rule's pass-through characters): one combining mark also defeats three shape rules, and the
  limit names them: the path rule, the private shapes and the credential shapes. **D2:** so does any non-ASCII letter, a
  look-alike included (a Cyrillic `о` for an `o`, a fullwidth `ｈ`): those three read ASCII only, so `/hоme/bob` or a key
  with one Cyrillic letter is kept as drawn on both hosts. It stays open with F4 and F6, by the coordinator's ruling.
- **F7** (section 4's round 2 sentence, replaced by a pointer here; and section 5's three-row split, corrected for a
  bordered box narrower than the pane, with the figure of about 70 characters marked as inferred).
- **The "Known limits at merge" of #3487.** Closed by this wave: the wide set as a hand list, with the straddle; one
  combining mark defeating more than the exact matchers, as text (the limit itself stays a named residual on the alarm
  wave's ticket); a cut token after an earlier bare quote with no case (F3); a replaced row measured in code points (F5); the
  recorded-pane case not asserting that the full-width rule was exercised (F8a); the third stash pane's case not asserting
  the notice row (F8b); the fingerprint with no probe for a bare quote, a wide character or a full-width row (F9). Still
  open, as ruled: F4 (an ordinary word beside a quote glyph refused as a cut token) and F6 (a rule row whose label holds a
  private string replaced, so the server's check refuses the frame `status-row`), with D2 beside them; and how Claude
  Code's own wrap indents a continuation row, which the first real capture shows (F1's cases cover the decorated shapes
  without it).
- **The mark class is only as new as the engine (review 4168; a limit, not fixed here, by the coordinator's ruling).** Two
  hosts whose engines DISAGREE on a mark lose a frame. Two hosts whose engines are BOTH older than the table's Unicode
  version count a mark newer than their engine one cell, so a next row that begins with such a mark keeps its tail on
  both: the reviewer counts 42 such marks on a 16.0 engine (93 on 15.0), none on 17.0 or newer. The cure, a generated mark
  table beside the width table, is the alarm wave's. The comment beside the mark class says the same. **Closed in wave
  197 (10.3):** the rule reads a generated mark table and asks no engine.

### 9.5 The pushes

- **First push, 6f020b7229.** The wide set as the file's W and F lines (123 ranges, the fixture those 293 lines with a
  header of its own), unassigned code points two cells through the engine's unassigned class, the straddle, F3, F5, F8a,
  F8b, four probes.
- **Second push, 5dcae59cb7** (the coordinator's ruling: no code point narrower than on `main`). The stated addition, the
  case that compares every code point with `main`, a fifth probe.
- **Fix round 1, review 4133.** F1 (one reader of the next row; the selector and keycap rule), F2 (the fixture is the
  whole file byte for byte, the table is its one-cell lines, unknown relative to the table, the engine's emoji class a
  widener only), F3 (the box checks its own result), T1 (9.3), A6, D1 (two probes), D2, and A4 and A5 in the evidence.
- **Fix round 1's red guard** (the coordinator's ruling on it; one more push). The PR's own fast run on fix round 1's
  tip, not any run before that push, found a red in `single-definition/docs-l0.test.ts`: its "selector ranges" row
  allowed the pair `0xE0100, 0xE01EF` in `shared/docs.ts` only, and the generated table has a row with that range (the
  data file's ambiguous-class range for the variation selectors supplement). It is a different fact from the docs path
  rule, and data regenerated from the pinned fixture, so the guard row now lists both files, with a comment that says
  so. The fingerprint, its planted copy and near miss, and the control cases are unchanged. So that the allowance is
  one generated row and no more, a case in the reducer suite holds `shared/framesReduce.ts` to exactly one copy of the
  pair, inside the table. Before the earlier pushes, one file of the single-definition folder ran. Before this push,
  every file in the folder ran, each alone, and so did every server suite that lists `shared/` as text (9.6).
- **Fix round 2, review 4161.** F1 (a next row whose content begins with the emoji selector, the keycap mark or a
  combining mark: its first character counts two cells, the mark through the engine's mark class as a widener only),
  A1 (the keycap clause at the third position dropped), A6 (the property case's counts pinned and its red rows named),
  A3, A5 and A7 (the note and two comments corrected), A2 (an engine-dependent mutant row), and one probe.
- **Fix round 3, review 4168** (the coordinator extended the cap by one round for it). F1 (both tail readers skip leading
  whitespace, so a Unicode space off the decoration list no longer hides a path's tail), one probe, a kept case that pins
  the mark test to the first code point, and the note's corrections: the red-first record of fix round 2, the mutant
  table's case lists, the nine panes, the tests that name the file, the engine-age limit and the dropped keycap clause.

### 9.6 Evidence

Every run went through `ccrc test --local`, in the foreground, one file per command.
- **Red first.** At the first push, 11 new cases were run against `main`'s `shared/framesReduce.ts` and each was red by
  name: the six table and width cases of that push, the three capture-owner cases (the unlisted wide character, the
  straddle with no trailing space and with one), F5 and F8a. The F9 probe case was added after that run; review 4133
  measured it red on `main` (`main` gives 21 answers, 18 probes and 3 status frames, where the case asks more). Cases that
  hold on `main` and on the earlier pushes are proved by mutants instead: F3's (M8), F8b's, the "is kept" controls (a row
  one cell short with a narrow character below, a row two cells short, decoration then a narrow character), A6's, and the
  recorded-pane half of 9.3's property case. At fix round 1, the
  round's suite was run against the second push's reducer: 8 cases red by name (the two table cases, the four decorated
  and selector straddle cases at 20 and 220 columns, the reviewer's 40-column frame and the probe case). The
  table-relative unknown case and the emoji-widener case hold on this engine on the second push's code too, whose engine
  class agreed with the 17.0 table here; each is proved by its mutant (W7, W8). The reducer suite passes 101 of 101.
- **Mutants** at fix round 1's tip, in a scratch clone of this branch (never this workspace), one row at a time, with the
  first wave's runner from the coordinator's copy (not in the tree): each edit applied, its test file run once, the file
  restored. **808 mutants, 808 killed.** The scratch tree read clean by git after each batch.
  - The 38 reducer rows of the first wave's list (rules 1 to 10, rounds 1 and 2), P6, P7 and P8 re-anchored where the
    width code moved; one of them (N18) runs the agent's `testbox-capture-frames-run.test.ts`.
  - 23 rows on the width function, the straddle and this wave's other guards, listed below so that a reviewer can replay
    each by hand.
  - One per line of the generated table: each of the 747 one-cell ranges deleted, each red through the table case by name.

The rows on the width function and the straddle, as run at fix round 1's tip (P6, P7 and P8 are the first wave's rows
re-anchored):

| Row | The edit in `shared/framesReduce.ts` (old, then new; ⏎ is a line break) | Red in `server/test/frames-reduce.test.ts` (first case) |
|---|---|---|
| P6 F-B the edge counted in code points | `const cells = cellsOf(cps);⏎  return cells` → `const cells = cps.length;⏎  return cells` | the reviewer's frame: a row that reaches the last column with a wide character, a path going on below, refuses on both hosts |
| P7 F-B an emoji counted one cell | `const cp = c.codePointAt(0) ?? 0;⏎  if (FRAMES_WIDE_KEPT` → `if (/\p{Emoji_Presentation}/u.test(c)) return 1;⏎  const cp = c.codePointAt(0) ?? 0;⏎  if (FRAMES_WIDE_KEPT` | the reviewer's frame: a row that reaches the last column with a wide character, a path going on below, refuses on both hosts |
| P8 F-B a CJK ideograph counted one cell | `if (WIDE_CLASS.test(c)) return 2;⏎` → `if (WIDE_CLASS.test(c)) return 2;⏎  if (cp >= 0x4e00 && cp <= 0x9fff) return 1;⏎` | the reviewer's frame: a row that reaches the last column with a wide character, a path going on below, refuses on both hosts |
| W1 M4 the Hangul syllables counted one cell (a one-cell range added to the table) | `[0xABF0, 0xABF9],` → `[0xABF0, 0xABF9], [0xAC00, 0xD7A3],` | the shared table is the fixture's N, Na, H and A lines merged, as the generator writes them: they cannot drift |
| W2 M5 the fullwidth forms counted one cell (a one-cell range added to the table) | `[0xFEFF, 0xFEFF],` → `[0xFEFF, 0xFEFF], [0xFF01, 0xFF60],` | the shared table is the fixture's N, Na, H and A lines merged, as the generator writes them: they cannot drift |
| W3 M8 only a row's first closing quote examined | `j = plain.indexOf('›', j + 1)) {` → `j = -1) {` | a cut token after an earlier bare quote of the same kind in the same row still refuses on both hosts (review 4109, F3) |
| W4 the straddle branch removed | `\|\| (cells === pane.cols - 1 && firstCells(nextRowContent(next)) === 2)` → (nothing) | a straddler at the last column, then a continued tail: the row ends one cell short as drawn, with no trailing space, and refuses on both hosts |
| W5 the edge measured on the row as drawn | `const cps = Array.from(row.replace(/\s+$/u, ''));` → `const cps = Array.from(row);` | the same straddle with the blank last cell read as a trailing space: measured after trailing spaces are dropped, it refuses on both hosts |
| W6 the head read on the row as drawn | `/\S+$/u.exec(a.replace(/\s+$/u, ''))` → `/\S+$/u.exec(a)` | the same straddle with the blank last cell read as a trailing space: measured after trailing spaces are dropped, it refuses on both hosts |
| W7 F2 unknown asks an engine's unassigned class, stubbed empty (a newer engine) | `else return 1;⏎  }⏎  return 2;⏎}` → `else return 1;⏎  }⏎  return /[^\s\S]/u.test(c) ? 2 : 1;⏎}` | the reviewer's frame: a row that reaches the last column with a wide character, a path going on below, refuses on both hosts |
| W8 the engine's emoji class removed | `const WIDE_CLASS = /\p{Emoji_Presentation}/u;` → `const WIDE_CLASS = /[^\s\S]/u;` | every line of the fixture, first, last and one inside, counts what the file says; the code point just outside each one-cell range counts two |
| W9 the table search misses a range's first code point | `if (cp < a) hi = mid - 1;` → `if (cp <= a) hi = mid - 1;` | every line of the fixture, first, last and one inside, counts what the file says; the code point just outside each one-cell range counts two |
| W10 the table search misses a range's last code point | `else if (cp > b) lo = mid + 1;` → `else if (cp >= b) lo = mid + 1;` | every line of the fixture, first, last and one inside, counts what the file says; the code point just outside each one-cell range counts two |
| W11 F5 a replaced row measured in code points again | `const w = cellsOf(Array.from(s.content));⏎  const t = cellsOf(Array.from(token));` → `const w = Array.from(s.content).length;⏎  const t = Array.from(token).length;` | the reviewer's 40-column frame, a replaced row of one-code-point two-cell characters, refuses on the box with the server's word |
| W12 F9 the first four new probes removed | `'› stashed · Restart to update', String.fromCodePoint(0xAC00).repeat(17) + 'xy /ab\ncd rest',⏎    'x'.repeat(35) + ' /pro\nject rest', 'x'.repeat(35) + ' /pr\n' + String.fromCodePoint(0x6F22) + 'ject rest',⏎` → (nothing) | the probe table answers for a bare quote, a wide character at the edge, a row at the probe's width, a straddle, the stated addition at the edge, a table-only wide character at the edge and a trailing-space straddle (review 4109, F9; review 4133, D1) |
| W13 a straddle read under a narrow first character too | `firstCells(nextRowContent(next)) === 2)` → `firstCells(nextRowContent(next)) >= 1)` | a row of wide characters one cell short of the edge is not run to it, and reduces unchanged |
| W14 a straddle read two cells short too | `(cells === pane.cols - 1 &&` → `(cells >= pane.cols - 2 &&` | a row two cells short, even with a wide character below, is kept |
| W15 the one-cell table emptied | `FRAMES_ONE_CELL_RANGES: readonly (readonly [number, number])[] = Object.freeze([` → `FRAMES_ONE_CELL_RANGES: readonly (readonly [number, number])[] = Object.freeze([] ?? [` | a row of wide characters one cell short of the edge is not run to it, and reduces unchanged |
| W16 the stated addition dropped | `Object.freeze([[0x3248, 0x324F]])` → `Object.freeze([])` | no code point counts narrower than it did on main, with no engine asked, and on this engine too: the one stated addition keeps the eight ambiguous ones main counted wide |
| W17 the fifth probe removed | `'x'.repeat(35) + ' /p' + String.fromCodePoint(0x3248) + '\nq rest',⏎` → (nothing) | the probe table answers for a bare quote, a wide character at the edge, a row at the probe's width, a straddle, the stated addition at the edge, a table-only wide character at the edge and a trailing-space straddle (review 4109, F9; review 4133, D1) |
| F1a the straddle reads the next row raw | `firstCells(nextRowContent(next)) === 2)` → `firstCells(next) === 2)` | at 20 columns: a straddle whose next row begins with decoration before the wide character refuses on both hosts |
| F1b the selector and keycap rule removed | `if (cps[1] === EMOJI_SELECTOR \|\| cps[1] === KEYCAP_MARK \|\| cps[2] === KEYCAP_MARK) return 2;⏎` → (nothing) | at 20 columns: a straddle whose next row begins with a base character and the emoji selector or the keycap mark refuses on both hosts |
| F1c the tail read from the raw next row | `const tail = /^\S+/u.exec(nextRowContent(b))` → `const tail = /^\S+/u.exec(b)` | at 20 columns: a straddle whose next row begins with decoration before the wide character refuses on both hosts |
| F3a the box's check of its own result removed | `return c.ok ? r : { kind: 'refused', refusal: c.refusal };` → `return r;` | the reviewer's 40-column frame, a replaced row of one-code-point two-cell characters, refuses on the box with the server's word |
| A6 the decoration clause removed from the edge test | `if (last === undefined \|\| DECOR.has(last) \|\| last ===` → `if (last === undefined \|\| last ===` | a row whose last character is the decoration is not run to the edge, even at the full width (review 4133, A6) |
| D1 the two new probes removed | `'x'.repeat(35) + ' /a' + String.fromCodePoint(0x2329) + '\nb rest', 'x'.repeat(35) + ' /pr \n' + String.fromCodePoint(0x6F22) + 'ject rest',⏎` → (nothing) | the probe table answers for a bare quote, a wide character at the edge, a row at the probe's width, a straddle, the stated addition at the edge, a table-only wide character at the edge and a trailing-space straddle (review 4109, F9; review 4133, D1) |

The red guard's rows, run in the same scratch clone with the round's two test files in place, each red by name and the
clone read clean by git after them:

| Row | The edit (old, then new) | Red |
|---|---|---|
| G1 a third file spells the pair | `shared/api.ts` gains a last line `// mutant: 0xE0100, 0xE01EF` | `single-definition/docs-l0.test.ts`: the selector ranges body is spelled out only where it is declared (it receives `shared/api.ts`) |
| G2 the width table dropped from the guard row (the PR's red at fix round 1) | `['shared/docs.ts', 'shared/framesReduce.ts'],` → `['shared/docs.ts'],` in the selector ranges row | `single-definition/docs-l0.test.ts`: the selector ranges body is spelled out only where it is declared (it receives `shared/framesReduce.ts`) |
| G3 a second copy in the reducer file, outside the table | `shared/framesReduce.ts` gains a first line `// mutant: [0xE0100, 0xE01EF]` | `frames-reduce.test.ts`: the docs guard's allowance is one generated row: the shared file spells the selector ranges pair once, inside the table (the docs guard stays green under it, which is why the case is needed) |

- **Fix round 2.** Red first: the round's cases were run against fix round 1's reducer (the scratch clone's
  `shared/framesReduce.ts`, the same file as at bf24543d43), and 5 were red by name, the two new straddle cases at each of
  20 and 220 columns and the probe table (it asks 29 answers, that reducer gives 28); the other 101 passed (corrected by
  review 4168: this record first said 4 and 102). The reducer suite now passes 106 of 106. The F8a count stays 6 of 90. Over all
  147 recorded panes (9.3), nothing changed against fix round 1's reducer. Its mutant rows, one at a time in the scratch
  clone with the round's suite in place (the clone read clean by git after them):

| Row | The edit in `shared/framesReduce.ts` (old, then new; ⏎ is a line break) | Result in `server/test/frames-reduce.test.ts` |
|---|---|---|
| F2a the leading-selector arm removed | `if (cps[0] === EMOJI_SELECTOR \|\| cps[0] === KEYCAP_MARK) return 2;⏎` → (nothing) | **green on this engine, by design**: the selector and the keycap are themselves combining marks, so the engine's mark class still counts them two. The arm is the floor that holds with no engine asked; F2a+ is the row that shows it |
| F2a+ the leading-selector arm removed, the mark class stubbed empty (an engine with no marks) | F2a, and `const LEADING_MARK = /^\p{M}/u;` → `const LEADING_MARK = /[^\s\S]/u;` | red, 5 cases: the selector case (a straddle whose next row is a decoration base, then the emoji selector or the keycap mark) at 20 and at 220 columns, the combining-mark case at 20 and at 220, and the probe table |
| F2b the leading-mark arm removed | `if (LEADING_MARK.test(cps[0])) return 2;⏎` → (nothing) | red, 2 cases: the combining-mark case (a straddle whose next row is a decoration base, then a combining mark, refuses on both hosts, before a wide character and, an accepted over-refusal, before a narrow one) at 20 and at 220 columns |
| F2c the mark class stubbed empty, the selector arm kept | `const LEADING_MARK = /^\p{M}/u;` → `const LEADING_MARK = /[^\s\S]/u;` | red, 2 cases: the combining-mark case at 20 and at 220 columns; the selector cases stay green, which is the floor at work |
| F2d the leading-selector probe removed | `'x'.repeat(35) + ' /pr\n' + String.fromCodePoint(0x23FA) + String.fromCodePoint(0xFE0F) + 'ject rest',⏎` → (nothing) | red: the probe table case (29 answers) |
| PH1 the self-check removed, and every replaced row padded past its width | `return c.ok ? r : { kind: 'refused', refusal: c.refusal };` → `return r;`, and `s.lead + token + ' '.repeat(w - t) + s.tail` → `s.lead + token + ' '.repeat(w - t) + ' '.repeat(300) + s.tail` | red: over every recorded pane as the recipe meets it, and the capture owner's frames, a reduced answer passes the server's check (and the 40-column case first) |
| PH2 the same padding, the self-check kept | the second edit of PH1 only | red: the same property case, through its exact count of panes reduced (128) |
| A2 the engine's unassigned class added as a widener (**depends on the engine**) | `const WIDE_CLASS = /\p{Emoji_Presentation}/u;` → `const WIDE_CLASS = /\p{Emoji_Presentation}\|\p{Cn}/u;` | **green on this box's engine** (Unicode 17.0), and on an 18.0 one by the reviewer's emulation; red on an older engine (the reviewer emulated 16.0, which is what CI's node 22 carries). Its direction is over-refusal only (review 4161, A2) |

- **Suites at fix round 1's tip**, each alone. `main` is 8a7bcacc8b, which touches nothing under `shared/`, `server/`,
  `agent/` or `ccd/` since the branch's base, and the merge probe answered clean, so the tip is the merged head for those
  packages and nothing was absorbed. On the server: `frames-reduce` 101, `frames-result` 54, `frames-lane-decider` 9,
  `frames-lane-store` 25, `frames-lane-capture` 25, `frames-transport` 25, `frames-capture` 13, `frames-capture-frames`
  24, `box-frame-fixtures` 8, `testbox-frames-route` 19, `delivery-drive-frames` 19, `delivery-capture-frames` 36,
  `radar-fleet-frames` 15, `send-type-loop` 5, `single-definition/late-census` 83, the gate's suite 434,
  `box-token-census` 92, `coord-token` 44, the three sender-reading suites (`pane-prompt-glyph` 6,
  `injected-prompts-characterization` 11, `send` 158), `pane-sgr-guard-characterization` 128, `rings/shared-imports` 6,
  and the tree guards `topology-clean` 62, `public-text` 20, `private-names` 47, `oss-metadata` 29, `growth-check` 63
  (3 skipped) and `growth-caps` 12. On the agent: `testbox-capture-frames` 13, `testbox-capture-frames-run` 49,
  `testbox-capture-desk-frames` 4, `testbox-capture-op-frames` 11, `testbox-imports` 7 and `testbox-capture-deadline` 26.
  All pass, and the server's and the agent's own compiles pass. At the earlier pushes the same list passed, and the PR's
  own server compile job measured the test-project compile, which the box's test slice killed twice for memory (exit
  137).
- **Suites before the red guard's push**, each alone, on the round's tree. `main` is f9cb8274f2; the merge probe
  answered clean, and no file of the four roots on `main` spells the pair besides `shared/docs.ts`, so nothing was
  absorbed. The class that missed the red is a test that reads every shared file as text, so the list is:
  - every file under `server/test/single-definition/`, 49 files, all passing (`docs-l0` 159 with 1 skipped);
  - every server suite that CI's static tree-scanner detector (`scansSourceTree`, `.github/ci/fast-plan.mjs`) marks
    as listing a source tree, and whose scan can include `shared/`, 39 files, all passing: `ccd-line-citations`,
    `ccd-refusal-v1`, `ccd-route-spawn`, `ccrc-account`, `ccrc-versioned-audit`, `child-reclaim-attention-arms`,
    `child-reclaim-generation-shape`, `child-reclaim-generation`, `ci-fast-plan`, `codex-bridge-live-tools`,
    `collect-readers`, `continued-in-parity`, `delegation-wave3.integration`, `docs-parity`, `history-replay`,
    `landing-words`, `license`, `linear-key-containment`, `macos-platform`, `mail-revive`, `module-format`,
    `no-default-saving-keystroke`, `no-routing-keystroke-from-server`, `notify-push`, `pane-history-route`,
    `pane-sgr-guard-characterization`, `plain-auto-memory-route`, `prphase`, `readme-holds`, `resume-reclaim-l0`,
    `rings/mjs-node`, `rings/pwa-one-owner`, `rings/shared-imports`, `rings/wire-totality`, `routing-env-census`,
    `stall-settings`, `token-shared`, `update-move` and `whitelist-subset`;
  - the reducer suite, now 102 of 102, and the frames suites, tree guards and docs guards of the list above, with the
    same counts (`docs-grammar` 158, `anchors` 9, `citations` 4, `deviation-refs` 35, `ci-ledger-guard` 32), and the
    agent's six frames suites.
- **Fix round 3.** Red first: the round's suite was run against fix round 2's reducer (`shared/framesReduce.ts` as at
  a7bc29807e) in the scratch clone, and 7 cases were red by name: the full-row case, the one-cell-short case and the
  token-row case at each of 20 and 220 columns, and the probe table (30 answers asked, 29 given); the other 105 passed.
  The reducer suite now passes 112 of 112, with the property case's pins (132 panes checked, 128 reduced), F8a's 6 of 90
  and the probe table unchanged otherwise. Over all 147 recorded panes, nothing changed against fix round 2's reducer, and
  against `main` the same nine panes changed as before: the fix adds no refusal there. Its mutant rows, one at a time in
  the scratch clone (it read clean by git after them):

| Row | The edit in `shared/framesReduce.ts` (old, then new) | Result in `server/test/frames-reduce.test.ts` |
|---|---|---|
| S1 the path-tail reader's whitespace skip taken back | `(/^\s*(\S+)/u.exec(spans(row).content)?.[1] ?? '')` → `(/^\S+/u.exec(spans(row).content)?.[0] ?? '')` | red, 2 cases: the token-row case (a token row, then the ideographic space or the em space, then a path, refuses on both hosts) at 20 and at 220 columns |
| S2 the edge reader's whitespace skip taken back | `const tail = /^\s*(\S+)/u.exec(nextRowContent(b))?.[1] ?? '';` → `const tail = /^\S+/u.exec(nextRowContent(b))?.[0] ?? '';` | red, 5 cases: the full-row case and the one-cell-short case at 20 and at 220 columns, and the probe table |
| S3 the U+3000 probe removed | `'x'.repeat(36) + ' /pr\n' + String.fromCodePoint(0x3000) + 'ject rest',` → (nothing) | red, 1 case: the probe table |
| O-F the mark test asked of the whole content, not its first code point | `if (LEADING_MARK.test(cps[0])) return 2;` → `if (/\p{M}/u.test(content)) return 2;` | red, 2 cases: decoration then a narrow character is still not a straddle, and is kept, at 20 and at 220 columns (its list now holds a narrow first character with a mark later in the row) |

- **Suites before fix round 3's push**, each alone, on the round's tree: the same 119 files as fix round 2's list, all
  passing (the reducer suite 112, `docs-l0` 159 with 1 skipped), and the server's and the agent's compiles. `main` is
  ee9b069f30; the merge probe answered clean and `main` changes none of this wave's files, so nothing was absorbed. The
  agent's six frames suites, which review 4168 could not run, are among the 119.
- **Suites before fix round 2's push**, each alone, on the round's tree: 119 files, all passing. `main` is 9ccb5f19c2; the
  merge probe answered clean and `main` changes none of this wave's files, so nothing was absorbed. The list is the one
  for any change under `shared/`: the reducer suite (106) and the frames suites on the server, the tree and docs guards
  above, the agent's six frames suites, every file under `server/test/single-definition/` (49) and the 39 tree-scanning
  suites named above. The server's and the agent's compiles pass.
- **Tests that read a file this wave changes as text** (#3562): three read `shared/framesReduce.ts` as text,
  `frames-reduce`, `single-definition/late-census` and, since the red guard's push, `single-definition/docs-l0`, which
  names the file in its holder list (review 4161, A7). Six import it through the module path (review 4168):
  `box-frame-fixtures`, `frames-lane-capture`, `frames-transport` and `testbox-frames-route` on the server, and
  `testbox-capture-deadline` and `testbox-capture-frames-run` on the agent. All ran above and pass. This wave changes no other TypeScript file.
- **Count lines.** No file this wave touches states the gate's count lines, so none was re-derived.
- **This note** is an existing task note, edited with the coordinator's direction; the head commit carries the ledger
  guard's edit trailer for it.
- **Process.** Three hook refusals, each reported. The graph gate refused a search command until one graph query had
  answered (its own instruction), so a query ran and the search was not repeated. The test slice's hook refused two
  commands whose text named the compiler, though neither ran one: a status mail to the coordinator, sent again with that
  word left out, and a memory note, written with the file tools instead. The file tools turn a `\u` escape typed into an
  edit into the character itself, so the tables are written as numbers and spliced in by a script, and the probes spell
  their wide characters with `String.fromCodePoint`.

## 10. Wave 197: the reducer's carried limits

Seven reviews of the reducer left limits that were not must-fix for their pull requests. This wave closes them, in the
order the coordinator gave. No real capture has run, so no stored frame was read under an older rule. Every change is in
`shared/framesReduce.ts`, the one function the test box's reducer and the server's check both run, plus one new data
fixture. Each rule is red first by case at 20 and 220 columns on both entry points, except where a rule is the box's
alone (it needs the box's strings): there the case shows the box refusing, or the text the box sends passing the
server's check. No frame that `main` refused is kept now with private text in it; some frames that `main` refused whole
are now reduced with a row replaced instead, so the stored text holds neither the name nor the shape (10.4, 10.5). This
section describes the code at the push of fix round 1 (10.11).

### 10.1 A path's tail past the first run of the next row (review 4179's U8, two arms)

Both tail readers took only the FIRST run of the next row's content. So a next row whose first run held no slash and
whose later text did was kept: a directory name with a space wrapped (`…Ja`, then `ne Doe/project`), or a blank that is
not whitespace (U+2800, U+3164), a space, then `ject/rest`. The cure the review called obvious, a slash anywhere in the
next row after ANY token row, would refuse 77 of the 140 recorded panes the recipe reduces: a welcome-banner row under
the model row carries a path in about 40 of them. So each arm asks the edge first (the coordinator's ruling, which took
both arms):

- **The token-row arm.** After a reduced row that ends in a token AND runs to the edge as a token row, a slash anywhere in
  the next row's content (after its leading decoration) refuses the frame (`private-shape`). A replaced row is padded with
  spaces to its content's width, so a token row is measured as drawn, SGR removed and its trailing spaces KEPT: its last
  code point is not a decoration character other than the two spaces (a border closes the row), and its width in screen
  cells is at least the pane's, or one cell short with the next row's first character two cells (the straddle). A token
  row whose source had trailing spaces drawn out to the edge reads as at the edge too; that only refuses. A token row that
  does not reach the edge keeps the first-run reading.
- **The full-row arm (new against `main`).** After a row run to the edge that is not a token row (`runsToTheEdge`), a
  slash anywhere in the next row's content refuses too, for the same next rows (not ours, not a rule row). It lives in
  the full-width rule's reader, so on the box it reads the rows as drawn and in the server's check the reduced rows.
- **Recorded cost.** Over every recorded pane the recipe meets (158 files, 147 with a rule row under the top row, at
  their real sizes; 140 reduce), each arm newly refuses **0 of 147**. Only one reduced token row in all 147 reaches the
  edge (the link row of the remote-control hint in `ask-user-question-real.txt`, 122 of 122 cells), and the row under it
  is empty; the one raw row at the edge with a slash anywhere below (`cc280-permission-wrapped-100.txt`) is a real
  wrapped path the rule already refused. The broad cure's count, 77 of 140, is why the edge is asked.
- **One cell short.** A real read of a pane may trim the blank last column (a read without its trailing spaces drops
  them), so a row one cell short of the edge before a NARROW character cannot be told from a row that simply ended a cell
  early. That is why it is a kept side of both arms, and why only a two-cell character after it makes a straddle.
- **What this does not cover.** These arms read a path's tail, a slash after the break. A box string that holds a space
  and is wrapped at that space, with no slash after the break, is the wrap rule's, and that rule lost the space until fix
  round 1 (10.11, R1).
- **Told apart.** The rule word is the same for both arms, so a capture's refusal counts cannot tell them apart, but the
  cases and the mutant rows do: each arm's edit taken back alone is red through its own cases and the probe table, and
  green through the other arm's (U8t and U8f in 10.10). If the first real capture over-refuses, its frames can be replayed
  against each arm alone. Cases, at 20 and 220 columns, each on both hosts: the token-row arm with each token that fits,
  under the reviewer's shapes (bare and indented), and the box's own shape (a model row whose trailing spaces reach the
  edge); its straddle; its kept sides (a token row two cells short, a token row closed by a border, a narrow character
  after a token row one cell short, no slash at all); the full-row arm under the same shapes; its straddle; its kept sides
  (no slash anywhere, a next row that is ours, a narrow character after a row one cell short).

### 10.2 The pins U6 and U7

- **U6.** No fingerprint probe reached the path-tail reader's whitespace skip, so taking it back moved no version. A probe
  now does: a token row, then U+3000, then `x/y tail`. Mutant S1 is red through the probe table as well as the token-row
  case.
- **U7.** A full row with no slash, then U+3000, then a tail that holds the slash (`ject/rest`), refuses at the edge reader
  on both hosts, bare and indented: a case at 20 and 220 columns. It was refused on `main` already, so the case is a pin
  and is green on `main`. Since the full-row arm, it is refused twice over: S2 (the edge reader's skip taken back) alone
  leaves it refused by the full-row arm, and S2 is red through the existing cases whose head holds the slash.

### 10.3 The mark table (review 4168)

- **The data file is the fixture.** `server/test/fixtures/unicode-derived-general-category.txt` is the Unicode Character
  Database file `DerivedGeneralCategory-17.0.0.txt` (Unicode 17.0.0, dated 2025-07-24, from the Unicode Consortium's public
  UCD directory for 17.0.0, `extracted/`), byte for byte: 277,514 bytes, sha256
  `d62e5bab70ca74f099343f71224fa051cb1fdd61a1ab45c0488c44cfc0b6102e`, 4,144 data lines. It is the same version as the
  width table. A case pins the sha256, the length, the name and date lines and the data line count. No test fetches it.
- **The table.** `FRAMES_MARK_RANGES` is every code point the file lists as Mn, Mc or Me, merged: 327 ranges, 2,543 code
  points, 6,240 bytes of ASCII source. It is generated and checked exactly as the width table is: the case parses the
  fixture, writes the table's source text (eight pairs to a line) and requires the shared file's table to be exactly that
  text. Both tables use one search (`inTable`).
- **The rule asks no engine.** The leading-mark test reads the table, not the engine's mark class, and a case requires
  that the shared file's only property escape, in any spelling, is the emoji-presentation one (fix round 1, R5: the case
  first matched a short list of names, so a mark test in the general-category spelling slipped it). The emoji selector (Mn) and the keycap mark
  (Me) are in the table, so their own arm at the first position is gone; the arm for them at the second position stays.
  The engine's emoji class is still asked, as a widener only, as ruled in wave 195.
- **The 42.** The marks the 16.0 file does not list as marks and the 17.0 file does (U+1ACF to U+1ADD, U+1AE0 to U+1AEB,
  U+10EFA, U+10EFB, U+11B60 to U+11B67, U+1E6E3, U+1E6E6, U+1E6EE, U+1E6EF, U+1E6F5; measured against
  `DerivedGeneralCategory-16.0.0.txt`, which is not in the tree) are a case at 20 and 220 columns: each, as the first code
  point after the turn marker, bare and indented, makes a straddle that refuses on both hosts. A second case walks all
  2,543 marks of the table through the straddle. This engine knows the 42, so `main`'s reducer refuses them here as well;
  under an emulated 16.0 engine (`main`'s mark class with the 42 taken out of it, in a scratch file) `main` keeps all 84
  frames on both hosts at each width, and this reducer refuses all 84 (10.10). The 42 are a HAND-TYPED list in the case
  (`NEW_IN_17`): the tree holds no 16.0 data and the fixture has no age field, so the case checks the list's length and
  that each of its code points is in the table, not that each is new in 17.0. Review 4217 verified the list independently
  against 16.0 tables. The emulated 16.0 result is measured outside the tree and stated here only.
- **The docs guard's allowance.** The mark table has a row with the docs path's selector ranges pair (the variation
  selectors supplement is Mn), so the shared file now spells it twice, once in each generated table. The reducer case that
  holds the allowance to generated rows only now requires one per table and two in the file; the docs guard's own row was
  not touched (it already lists this file).

### 10.4 The short-name word classes (review 4161's A4): fixed ASCII

The whole-word test for a name of one to three characters asked the engine's letter and number classes, so an engine that
knew a newer letter kept a name beside it, and every non-ASCII letter kept the name beside it. The classes are now fixed
ASCII (letters, digits, dot, dash, underscore), not table-driven: ASCII asks nothing and keeps less text, where a letter
table would keep the name beside every letter of 17.0. The only new replacement is a short name beside a non-ASCII letter,
digit or mark, on the box (the server holds no box strings). No recorded result moves, because the recorded panes carry
no box strings. A case, at 20 and 220 columns: a short name beside a Latin letter with an accent, a Cyrillic letter, an
ideograph, an Arabic-Indic digit and a combining mark is replaced, and the text the box sends passes the server's check;
the ASCII neighbours still do not make it the name. Some frames that `main` refused whole are now reduced: a short name
beside a non-ASCII letter on a row that also holds a private shape (`seen ébo at 10.1.2.3`, with the box string `bo`) was
refused on `main` by the shape, and is now reduced with that row replaced, because rule 3 replaces the whole row before
rule 9 reads it. The text sent holds neither the name nor the address, and it passes the server's check.

### 10.5 A variation selector or a combining mark inside a run (review 4086's F-D)

A mark inside a private string, a model or account word, a path, a private shape or a credential shape split the run each
rule reads. The coordinator offered two cures: refuse a frame whose private-shaped or token-shaped run holds such a
character, or match on the run with those characters removed. **Built: the second, beside the first reading.** Every
matcher reads the text as drawn AND the text less every code point the mark table lists (the variation selectors, the
combining grapheme joiner and the combining marks are all in it), and either reading is a hit, with the rule's own
action: rules 3 to 6 replace the row, the rule row's label refuses, rule 9 refuses. The first cure needs to know where a
private-shaped run is, which is exactly what the mark hides, so it cannot be built without the second. The private
strings are read less their marks too. Sites: the exact strings (rule 3 and the wrap rule, with the box's strings), the
path, model and account rules (4 to 6) on a row and on a rule row's label, the private shapes, the committed matcher and
the masker (rule 9). Cases, at 20 and 220 columns, with five marks (U+FE0F, U+FE00, U+0301, U+034F, U+E0100): a private
string, a short name, a model word and an account word replaced on the box, the server refusing the unreduced model and
account rows; a path replaced on the box and refused by the server unreduced; an address, a long hex run (at 220), a
credential and the committed canary refused whole on both hosts; a private string wrapped across two rows refused on the
box; a rule row's label holding a model word, an account word or a path refused on both hosts; and (fix round 1, R6) a
mark in the private string with none in the text, and the other way, in one row and wrapped across two. Over the 147
recorded panes nothing changed. As in 10.4, some frames that `main` refused whole are now reduced with a row replaced: a
mark-split `host-a` on a row that also holds an address, and a rule row's label `ébo /a/b/c` (with the box string `bo`, at
220 columns), each of which `main` refused by its shape, now has that row replaced by rule 3 (or rule 7's private-string
replacement), so the text sent holds neither, and it passes the server's check (measured in scratch, 10.11). A name in one Unicode normalization form against a drawing in the other
(a precomposed `é` against `e` then U+0301, either way) is kept, as on `main`: removing marks does not decompose a
character, and normalising the text would ask the engine's decomposition tables, against ruling 3. The other characters the class rule lets through (unassigned and noncharacter code points, the
Hangul fillers, the braille blank, the wide spaces, the replacement characters, the regional indicators) still split a
run: they are not marks, and removing them could join two words that are not one. That stays a limit, as do the
look-alike letters of 9.4 (D2).

### 10.6 The stash notice row that shares its row with a path: a stated limit

It stays as it is: the whole row is replaced and the notice is lost from the record (5, pinned). Replacing only the path is
not small: the path rule matches a path's start, not its extent (on `~/.tmux.conf` it matches the `~/` alone), so it
would need a reader of where a path ends, a second token width rule inside a row, and the path-tail rules re-read for a
token in mid-row; and it would change that pane's pinned result. Safe, poorer, and on record.

### 10.7 A private string split across three rows or more (the check widened)

No case could prove it cannot happen: the recipe's panes are both 220 columns, but a bordered box narrower than the pane
holds only what fits between its borders, so the string needed is longer than the box's content width, not the pane's.
So the wrap rule is widened. An occurrence that starts in a row and runs past its end is read through as many rows as it
needs, each middle row wholly inside it; a middle row is read as drawn, or, with the decoration at the breaks stripped,
as its content only; each reading is read again less its marks (10.5). It stops once the middle rows are longer than the
longest string. It is the box's rule (the server holds no box strings). Cases, at 20 and 220 columns: a 24-character
string split across three rows, bare, indented and inside a bordered box narrower than the pane, across four rows, and
with a mark in the middle row, refuses on the box; the same rows with a string that does not cross them reduce unchanged,
and the server clears them. Fix round 1 (10.11) adds a reading with the whitespace squashed out (R1: a string wrapped at
its own space) and stops the read at an empty or border-only middle row (R3: the widened read had joined a string across
one).

### 10.8 The version

Seven probes, one per changed rule, none with an answer that depends on the engine: U6 (10.2); the token-row arm (a model
row whose trailing spaces reach the edge, then a slash after the first run); the full-row arm (a full row of words, then
the same); the mark table (a straddle whose next row is the turn marker then U+1ACF, a mark new in 17.0); the ASCII word
classes (a short name beside a Latin letter with an accent); the marks-removed reading (a model word with a combining
mark inside); and a private string split across three rows. Fix round 1 adds four (10.11): R1 (a box string wrapped at
its space, the probe table's box list now holding `Ann Lee`), R3 (a short box string never joined across an empty middle
row), and R4's two (a short box string with a mark inside it in the text, which reaches the private-string reader's
marks-removed half; a credential shape with a mark inside, which reaches the masker's marks-removed reading). The probe
case now pins 41 answers. The committed matcher's marks-removed reading is held by cases only: the probe table's scan
answers no, so no probe can reach it. **The frames recipe's version: `bd7b9ac2b9896ec6` on `main` (wave 195's fix round
3, as merged), `1b00197c76a46d08` at this wave's first push, `497e2fd1732fcb5d` at fix round 1's push, from 11 probes in
all.** No file in the tree pins any of them. The delivery recipe's version still prints `da16fe2f55551e0b`.

### 10.9 Two exports for the alarm wave (wave 198's packet, the coordinator's ruling)

The alarm wave's shape rule classes a row as our text by the reducer's own rule 2 and reads a row's edges by the reducer's
own spans, never a copy. So the reducer exports `oursSquashed` (the one builder of rule 2's list, which `reduceOnce` now
calls) and `spans` (unchanged). The hunk is the alarm wave's packet, applied byte for byte as its own commit, so both
branches carry the identical lines and whichever lands second keeps one copy. No answer moves: the frames recipe's
version prints `1b00197c76a46d08` before and after that commit.

### 10.10 Evidence

Every run went through `ccrc test --local`, in the foreground or as one background loop, one file per command.
- **Red first.** The wave's suite against `main`'s reducer (ee21bf76ce) in a scratch clone of the workspace: 29 cases red
  by name, the other 118 green. The green ones are the kept sides of each new rule, the U7 pin and every case older than
  this wave. The 42-mark cases are red on `main` because its file has no table (the import is missing); their behaviour
  was measured red first under the emulated 16.0 engine (10.3). The reducer suite now passes 147 of 147, with the
  property case's pins unchanged (132 panes checked, 128 reduced) and F8a's 6 of 90.
- **Recorded panes, against `main`.** All 158 files; the 147 the recipe meets, as the property case meets them at their
  real sizes: **0 differ** in kind, refusal, counts or text, and every reduced one passes the server's check (140 reduce on
  both).
- **Mutants**, in the scratch clone (never this workspace), one row at a time, each edit applied to the shared file, the
  suite run once, the file put back; the clone read clean by git after the batch. **31 rows, 31 killed**, at the first
  push's code and again at fix round 1's (the counts below are fix round 1's; seven rows are red in more cases than
  before: K2 21 to 23, K4 20 to 22, B2 2 to 5, B4 2 to 3, B5 4 to 6, B6 13 to 15, T4 7 to 12). Fix round 1's own nine
  rows are in 10.11. The rows, so that a reviewer can replay each by hand:

| Row | The edit in `shared/framesReduce.ts` | Red in `server/test/frames-reduce.test.ts` |
|---|---|---|
| U8t the token-row arm taken back | the line `if (tokenRowAtTheEdge(a, b, pane) && nextRowContent(b).includes('/')) return …` removed | 5: the token-row arm and its straddle at 20 and 220, the probe table; the full-row cases stay green |
| U8f the full-row arm taken back | `return nextRowContent(b).includes('/'); // the full-row arm` → `return false; // the full-row arm` | 5: the full-row arm and its straddle at 20 and 220, the probe table; the token-row cases stay green |
| U8e1 the token row's trailing spaces trimmed | in `tokenRowAtTheEdge`, `Array.from(a)` → `Array.from(a.replace(/\s+$/u, ''))` | 5: the token-row arm and its straddle at 20 and 220, the probe table |
| U8e2 the border clause removed | `if (last === undefined \|\| (DECOR.has(last) && !SPACES.has(last))) return false;` → `if (last === undefined) return false;` | 2: the token-row arm's kept sides at 20 and 220 |
| U8e3 the token row's straddle branch removed | its `\|\| (cells === pane.cols - 1 && firstCells(…) === 2)` removed | 2: the token-row straddle at 20 and 220 |
| U8e4 the token-row arm asks the first run only | `nextRowContent(b).includes('/')` → `pathTail(b)` in the arm | 5: as U8t |
| S1 the path-tail reader's skip taken back | `/^\s*(\S+)/u … ?.[1]` → `/^\S+/u … ?.[0]` in `pathTail` | 3: the token-row space case at 20 and 220, the probe table (U6) |
| S2 the edge reader's skip taken back | the same in `pathOffTheEdge` | 5: the full-row and one-cell-short space cases at 20 and 220, the probe table |
| K1 the leading-mark arm removed | `if (isMark(cps[0])) return 2;` removed | 8: the selector, mark and 42-mark straddles at 20 and 220, the all-marks case, the probe table |
| K2 the mark table emptied | `Object.freeze([` → `Object.freeze([] ?? [` on the mark table | 23 |
| K3 the 42 dropped from the table (two ranges) | `[0x1AB0, 0x1ADD], [0x1AE0, 0x1AEB], [0x1B00, 0x1B04]` → `[0x1AB0, 0x1ACE], [0x1B00, 0x1B04]` in the mark table | 5: the 42-mark cases at 20 and 220, the all-marks case, the table case, the probe table |
| K4 the mark search reads the wrong table | `isMark` reads the one-cell table, negated | 22 |
| A1 the word classes back to the engine's | the two ASCII classes → the engine's letter and number classes | 3: the non-ASCII neighbour case, the probe table, the no-property-escape case |
| B1 rules 4 to 9 read as drawn only | `readsAs` → `re.test(s)` | 9 |
| B2 the private strings read as drawn only | `holdsPrivate`'s marks-removed half removed | 5: the exact matchers and the mark-in-the-string case at 20 and 220, the probe table |
| B3 the committed matcher as drawn only | `scan(foreign) \|\| scan(lessMarks(foreign))` → `scan(foreign)` | 2: the shapes, credentials and matcher case at 20 and 220 |
| B4 the masker as drawn only | its `\|\| mask(lessMarks(stripFrameSgr(text)))` removed | 3: as B3, and the probe table |
| B5 the wrap rule as drawn only | `for (const bare of [false, true])` → `[false]` | 6: the two-row mark case, the mark-in-the-string case and the three-row splits at 20 and 220 |
| B6 the marks-removed text is the text | `lessMarks` returns its input | 15 |
| B7 the rule row's label as drawn only | the label's `readsAs` → `.test` | 2: the rule row's label case at 20 and 220 |
| T1 the wrap rule reads two rows only | the window bounded at `i + 2` | 3: the three-row splits at 20 and 220, the probe table |
| T2 a middle row read with its decoration | `spans(rows[j]!).content` → `lessLead(rows[j]!)` for a middle row | 2: the three-row splits at 20 and 220 (the bordered one) |
| T3 the window stops after one row | `>= longest` → `>= 0` | 3: as T1 |
| T4 the stripped reading dropped | `for (const strip of [false, true])` → `[false]` | 12: the three-row splits and the older two-row split cases, and, from fix round 1, the three-word name cases, the empty-middle-row cases (their bordered pair) and the 220-column path frame (its card) |
| P1 to P7 each new probe removed | the probe's string removed from `probes` | 1 each: the probe table |

- **Suites**, each file alone, on the wave's tree (the list is the one for a change under `shared/`): the reducer suite
  and the server's frames suites, the tree and docs guards, the agent's six frames suites, every file under
  `server/test/single-definition/`, the server tests CI's tree-scanner detector (`scansSourceTree`) marks as listing a
  source tree, picked wider than needed (94 files whose source names a `shared` root by a loose text match, the 39 of
  wave 195 among them), and the server's and the agent's compiles.
  - Pass 1, on the code before the export commit (10.9): 176 files, 171 green, and both compiles pass. Five were red, and
    every red was a test timing out on a box at load 7 to 14: `coord-store` (1 of 271), `delegation-recovery` (38 of 465,
    with its leaked-descriptor checks), `mail-sweep` (10 of 187) and `secret-mask` (2 of 99), which, read afterwards, list
    `server/src` only, so they read no file this wave changes and were not run again; and `mail-revive` (1 of 41), whose
    census case walks `shared/`. Run alone, that case timed out again (25 s and 35 s), and on `main`'s tree in the scratch
    clone, under the same load, it timed out too (27 s): it is the load, and the pull request's run is the arbiter.
  - Pass 2, after the export commit, each alone: the reducer suite (147 of 147), the server's frames suites, the tree and
    docs guards, the agent's six frames suites and all 50 files under `server/test/single-definition/` (`docs-l0` 159
    with 1 skipped, `late-census` 83): 81 files, all green.
- **Tests that read a file this wave changes as text** (#3562): the shared file is read as text by the reducer suite, by
  `single-definition/late-census` and `single-definition/docs-l0`, and by every tree scanner over `shared/`; all ran above.
  The new fixture is read by the reducer suite only.
- **This note** is the existing task note with this new section and five pointers in sections 5 and 9.4; the head commit
  carries the ledger guard's edit trailer for it.
- **Process.** The brief asks that edits to the tree go through the file tools. Several edits in this wave (the mark table,
  the matcher sites and three blocks of cases) were spliced in by a short script that refused unless its old text occurred
  exactly once, before that was noticed; every edit after it went through the file tools. The content is what the file
  tools would have written. One hook refusal: the graph gate refused a search command until one graph query had answered
  (its words: "this tree has a knowledge graph (99707 nodes, fresh) and this session has no answer from it yet. Search
  tools open after one graph query that answers"). One query ran, as the gate's text asks, and the search ran after it.

### 10.11 Fix round 1 (review 4217, the coordinator's rulings)

Review 4217 read the first push (56b7806a88) and found nothing this wave adds that must stay out of `main`. The
coordinator ruled one finding into this pull request (R1), five small ones with it (R3 to R7, R9, R10) and one stated as
a limit (R2). R8 (advisory, the intended direction) and the reviewer's three surviving mutants of its own (M3, M4 and M6)
go to the coordinator's follow-up with R2. Everything below is in `shared/framesReduce.ts` and its suite, plus the
wording above.

- **R1, a box string wrapped AT its own space (the wrap rule).** A word wrap breaks a row at a space and takes that space
  out, and a read may trim the blank it leaves, so a box string that holds a space and is wrapped there was kept in its
  second half, on `main` as on the first push: with the box strings `/home/Jane Doe Smith/project` and `/home/Jane Doe
  Smith`, a box row ending `working in /home/Jane` had its path replaced and the row below, `Doe Smith/project and more`,
  was kept whole; with `Jane Doe Smith`, the rows `hello Jane` and `Doe Smith here` were both kept. The cure is the
  reviewer's and only refuses: `privateFrom` reads each of its readings once more with the whitespace squashed out of the
  rows and the strings, the straddle measured on the squashed head. A string of three characters or fewer, squashed, is
  not read so, and keeps the whole-word rule on the readings as drawn (otherwise `nas` would be read in `(n a` then
  `s) here`). Cases, at 20 and 220 columns: the reviewer's path frame, in a box of 50 columns inside the pane and as bare
  rows (at 20 columns bare rows only, since no 20-column box holds a row wide enough for its token), refused on the box,
  and refused by the server unreduced by its shape; the name broken at each of its two spaces, bare and in a box; the
  first break with the row run to the last column, its blank last cell trimmed and kept (the kept one was refused on
  `main` already, a pin); and the kept sides: the same rows with a string not in the box list reduce unchanged and the
  server clears them; the path rows with another path string have only the path replaced; `bo` inside `robot` across the
  break, and `nas` split by a space across it, are kept. The server holds no box strings, so for the name rows it is the
  box's rule, as the wrap rule always was. **Recorded cost: 0.** Over the 147 recorded panes the recipe meets (6,108
  adjacent row pairs), reduced by `main`, the first push and this code, with no box strings and with a fixture box list
  (the suite's stand-ins and five strings that hold spaces): 140 reduce in every column, 0 differ, and the squashed
  straddle alone hits none of the 6,108 pairs. The three pins are unchanged (132 checked, 128 reduced, 6 of 90).
- **R3, an empty middle row.** The widened read (10.7) joined a string across an empty or border-only middle row, because
  such a row adds no length: with the box string `alice`, `my pal`, an empty row, `ice cream` was refused, where `main`
  kept it. A terminal wrap never leaves an empty row inside a string, so the read now stops at a middle row whose content
  is empty. Case, at 20 and 220 columns: an empty, a blank and a bordered empty middle row are kept unchanged; the two
  rows side by side, bare and bordered, still refuse.
- **R4, three marks-removed readers that moved no version.** Two probes: a short box string with a mark inside it in the
  text (`seen b`, U+0301, `o here and more`), which only the private-string reader's marks-removed half replaces; and a
  credential shape with a mark inside (`key sk-abcd`, U+0301, `efgh`), which only the masker's marks-removed reading
  refuses. The committed matcher's half is held by cases only (10.8).
- **R5, the no-engine case.** It now requires that the shared file's only property escape, in any spelling, is the
  emoji-presentation one, so a mark test written as the general-category escape is red (mutant R5).
- **R6, a mark inside a private STRING.** Case, at 20 and 220 columns, with the five marks: a mark in the string and none
  in the text, and the other way, in one row (replaced, the text sent passing the server's check) and wrapped across two
  rows (refused on the box). Each of the reviewer's two edits, the strings' side of `holdsPrivate` and of `privateFrom`, is
  now red (R6a, R6b).
- **R7, R9 and R10, wording.** The 42 are said to be a hand-typed list, verified by the review against 16.0 tables, with
  the emulated-engine result stated as measured outside the tree (10.3). The section's opening sentence no longer says
  nothing refused on `main` is reduced now: some frames `main` refused whole are now reduced with a row replaced, measured
  in scratch on both entry points (`seen ébo at 10.1.2.3` with `bo`, a mark-split `host-a` beside an address, at 20 and
  220 columns; a rule row's label `ébo /a/b/c` at 220), each sent text passing the server's check (10.4, 10.5). One
  sentence says why one cell short before a narrow character is a kept side (10.1), and one states the normalization
  limit (10.5).
- **R2, a stated limit (the coordinator's follow-up, not this pull request).** The credential, hex-id, address and
  model-word checks read one row at a time; only the paths and the box strings have a wrap rule. So one of these shapes
  wrapped across two rows is kept, on `main` as here. The review's four frames, measured again in scratch at 20 and 220
  columns on `main` and on this code (reduced unchanged on the box, and the server clears the raw frame): `key sk-ant-ap`
  then `i03-abcdefghijklmn`; 40 hex characters split 20 and 20; `host 10.1.` then `2.3 rest`; `Son` then `net 4.5`. The
  server's live masker, in its rows mode, does join a key's prefix to an INDENTED continuation row (the review measured
  it masked there), not an unindented one. The cure the review measured (the two rows joined after a row that runs to the
  edge) changes one recorded pane (`ask-user-question-real.txt`), and a model word needs a reading of its own: that is the
  coordinator's follow-up wave.
- **The version.** Four probes, one per changed rule (R1, R3 and R4's two), none asking the engine, and the probe table's
  box list now also holds `Ann Lee` (for R1's probe). The probe case pins 41 answers. **`497e2fd1732fcb5d`** at this
  round's push (from `1b00197c76a46d08`), 11 probes added by this wave in all. The delivery recipe still prints
  `da16fe2f55551e0b`. The exports commit (10.9) is unchanged.
- **Red first.** The round's cases against the first push's code: 7 red (R1's path frame and its name cases at 20 and 220,
  R3's case at 20 and 220, the probe table), the R5 and R6 cases green there (they pin what the two edits and the escape
  would break). The whole suite against `main`'s reducer in the scratch clone: 35 of 157 red (the 29 of 10.10, R1's four
  and R6's two; R3's case is green on `main`, which kept that frame). The reducer suite passes 157 of 157 here.
- **Mutants, this round's nine**, in the scratch clone, as in 10.10, all killed; and the 31 of 10.10 rerun at this code,
  all killed:

| Row | The edit in `shared/framesReduce.ts` | Red in `server/test/frames-reduce.test.ts` |
|---|---|---|
| R1a the squashed reading taken back | `for (const sq of [false, true])` → `[false]` | 5: the path frame and the name cases at 20 and 220, the probe table |
| R1b the short-name exclusion taken back | the `&& (!sq \|\| Array.from(p).length > FRAMES_SHORT_PRIVATE_MAX)` clause removed | 2: the kept sides at 20 and 220 (`nas`) |
| R3 the empty-middle-row stop taken back | the `if (spans(rows[j]!).content === '') break;` line removed | 3: the empty-middle-row case at 20 and 220, the probe table |
| R4a the private-string reader's marks-removed text taken back | `privateAt(lessMarks(text), p)` → `privateAt(text, p)` | 5: the exact matchers and the mark-in-the-string case at 20 and 220, the probe table |
| R4b the masker's marks-removed reading taken back | its `\|\| mask(lessMarks(stripFrameSgr(text)))` removed | 3: the shapes, credentials and matcher case at 20 and 220, the probe table |
| R5 the mark test asks the engine | `isMark` → the general-category escape for marks | 1: the no-engine case |
| R6a `holdsPrivate`'s strings-less-marks side taken back | `privates.map(lessMarks).some(` → `privates.some(` | 2: the mark-in-the-string case at 20 and 220 |
| R6b `privateFrom`'s strings-less-marks side taken back | `(bare ? privates.map(lessMarks) : privates)` → `privates` | 2: as R6a |
| P8 R1's probe string taken back | `Ann Lee` removed from the probe table's box list | 1: the probe table |

- **The coordinator's full run** on the first push (46132580483, every server file, no macOS), read once at the end:
  completed, success, 33 jobs passed and 7 skipped, no red job.
- **Suites**, each file alone through `ccrc test --local`, at this round's code: the reducer suite (157 of 157), the
  server's twelve frames suites, `single-definition/docs-l0` (159, 1 skipped) and `single-definition/late-census` (83), the
  two that read the shared file as text; the docs guards for this note (`docs-grammar` 158, `anchors` 9, `citations` 4,
  `deviation-refs` 35, `ci-ledger-guard` 32, `dtbd` 1, `growth-check` 63 with 3 skipped, `oss-metadata` 29), the public-repo
  guards (`topology-clean` 62 of 62, `public-text` 20, `private-names` 47, `private-names-characterization` 26) and the
  agent's six frames suites: 33 files, all green. The server's compile exits 0. The server's test-project compile was
  killed by the test slice's memory cap (exit 137), as the review measured, so it is unmeasured here; the pull request's
  typecheck job is its measure. The public-repo guard file, run again on the committed note, was cut short twice by that
  same cap (44 and 56 of 62 passed, none failed, and the log names the worker killed by SIGKILL and the slice's OOM kills);
  with one worker it passed 62 of 62. That is the likely cause of the first push's single 44 of 62 (10.10), whose log was
  not kept.

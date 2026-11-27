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
  replaced the list with the Unicode table and says where a row is still read narrower than it is drawn (section 9).
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
  kept); the injected private-name scan carries case (review 4086's F-E).
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
  measured on a real box (review 4086's F-C). It goes onto the alarm wave's ticket.
- **Characters the class rule lets through.** Variation selectors, combining marks, unassigned and noncharacter code
  points, the Hangul fillers, the braille blank, the no-break and wide spaces, the object replacement and replacement
  characters and regional indicators pass the shape rule, which is by class as ruled. Placed inside a private string, a
  model word or an account word, one defeats the exact matchers (a private with a U+FE0F inside survives on the box;
  `Haiku 5.5` with a U+034F inside survives rule 5). It defeats three shape rules too, which are not exact strings, because
  a combining mark splits the run each reads (review 4109's R2): the path rule (`PATH_LIKE`, components of `[\w.-]`), the
  private shapes (`PRIVATE_SHAPES`: a home or mount path, a home-relative path, an email, an IPv4 address, a host name and
  a long hex run) and the credential shapes (the product masker's `CREDENTIAL_MASKS`, which rule 9 runs on the box). No
  build draws one there. A named residual (review 4086's F-D), on the alarm wave's ticket.
- **The third stash pane's notice row is replaced.** In `stash-after-cs.ansi` the stash notice shares its row with the tmux
  hint, which carries `~/.tmux.conf`, so the path rule replaces the whole row and the notice is not in the stored frame
  (pinned). If the first real capture's stash case shows a replacement on that row, that figure goes to the capture owner
  with the rest, and the question of replacing only the path comes back then (the coordinator's ruling on F-A).
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
box's reducer and the server's check both run, and each case shows both hosts.

### 9.1 What changed

- **The wide set is the Unicode table (ruling 1).** `FRAMES_WIDE_RANGES` lists every code point whose East Asian Width
  is W (Wide) or F (Fullwidth) in the Unicode Character Database file `EastAsianWidth-17.0.0.txt` (Unicode 17.0.0, dated
  2025-07-24, from the Unicode Consortium's public UCD directory for 17.0.0): its 293 W and F lines, merged where adjacent,
  are 123 inclusive ranges. The fixture `server/test/fixtures/unicode-east-asian-width.txt` keeps the data file's own
  first five lines (its name, date and terms) and its 293 W and F lines verbatim. No test fetches anything.
  - **How it cannot drift.** The table is generated, never edited by hand. The table case parses the fixture's lines,
    merges them, writes the table's source text from them (eight pairs to a line) and requires the shared file's table to
    be exactly that text, and its numbers to be exactly those ranges. A new version is a new fixture, and the text the
    case then expects is what goes into the shared file. The table is written as numbers, not regular expression
    escapes, so it is ASCII by construction, and a case reads its bytes and requires none over 0x7f. The engine's
    regular expressions have no East Asian Width property, so no property escape could stand in for the table.
  - **The walk.** A case walks every range: its first and last code points and one inside must be two cells. The code
    point just outside each range that the table does not list (246 samples, 226 distinct code points) must be what the
    rest of the function gives it: two cells for the stated addition (below), an emoji drawn as one or an unassigned
    code point, one otherwise.
  - **Nothing counts narrower than on main (the coordinator's ruling on this wave, after the first push).** The first
    push counted 8 code points one cell where main's hand list counted two: U+3248 to U+324F, circled numbers on black
    squares, which the data file gives A (ambiguous) and the hand list's range U+3041 to U+33FF took in. A terminal that
    draws an ambiguous character wide draws them in two, and this wave closes under-counting, so they stay two cells:
    `FRAMES_WIDE_KEPT`, the one stated addition beside the generated table, with its reason in its comment. The table
    case still requires the generated table to be exactly the fixture's ranges, so the addition is the only thing beside
    it. A case holds main's rule as data (its hand list's twelve ranges, from 86b2c2d6e2, and an emoji drawn as one) and
    compares every code point: **none counts narrower than on main, and 767,047 count wider** (the table's ranges the
    hand list missed, and every unassigned code point). Of the 226 code points just outside a range, 73 count wider than
    on main (all unassigned) and none narrower. Wider is the safe direction: it only refuses.
  - **The engine's version.** A case requires that the engine's Unicode version is not newer than 17.0, so a character
    the engine knows and a newer terminal may draw wide is never missing from the table. Measured: this engine reports
    17.0.
  - **Bundle cost.** The table is 2374 bytes of source (2096 without white space). No file under `pwa/src` or `ui/src`
    imports `shared/framesReduce.ts`, or `shared/framesCapture.ts` or `shared/framesLane.ts`, the two shared files that
    import it, so the console's bundle carries none of it today (read, by search of the two source trees).
- **Unknown is wide on purpose (ruling 2).** Beside the table, two of the engine's own classes count two cells: an emoji
  drawn as one (`Emoji_Presentation`, which covers the regional indicators, which the table gives N), and an unassigned
  code point (`Cn`, the noncharacters included). The class rule (rule 1) lets an unassigned code point through, and
  nothing can say how a terminal draws one, so it counts two, the direction in which the full-width rule fires. A
  private-use code point never reaches the width: rule 1 refuses the frame whole (`not-a-frame`) first, as it does a
  surrogate, a control and a format character. Were it asked, a private-use code point would count one cell (the data
  file gives it A). An engine on an older Unicode version reads more code points as unassigned, and so counts them wider:
  the safe direction. One comment in the shared file says this, and one case pins it. The stated addition (above) is
  answered first.
- **A straddle is at the edge (ruling 3).** A row that ends one cell short of the pane's width, whose next row begins
  with a wide character, is at the edge: the wide character did not fit in the last cell and the terminal wrapped it
  whole, leaving that cell blank. "One cell short" is measured **after the row's trailing spaces are dropped**, because a
  read of the pane may give the blank cell as a trailing space or as nothing. Measured on the row as drawn, a row that
  keeps the blank cell as a space reads as full but ending in a space, and the rule kept the path it continued: the wrong
  direction. The path token at the row's end is read from the same trimmed row. A case for each form: the row drawn with
  no trailing space, and the row drawn with one. A row one cell short whose next row begins with a narrow character is a
  short row, not a wrap, and is kept; so is a row two cells short.
- **The capture owner's condition (ruling 4), red first on the old rule.** A row built with a wide character outside the
  old hand list reaching the last column, then a continued path tail, refuses the frame whole on both hosts (seven
  characters: U+2329, U+FE10, U+A960, U+16FE0, U+17000, U+1B000 and U+1F200). A straddler at the last column, then a
  continued tail, refuses on both hosts, in both forms.
- **F5 is in this wave (ruling 7).** A replaced row is measured in screen cells, not code points: the content and the
  token, the two call sites in `replaced`. A content of ten wide characters and a path, 25 cells and 15 code points, is now
  replaced and keeps its width on screen, where it was refused as narrower than the 19-cell token. No recorded result
  changed: every recorded pane reduces as before (below).
- **F3.** A case puts a bare quote before a cut part of a token's name in the same row, for every name and both quotes;
  the reviewer's mutant M8 (only a row's first closing quote examined) is now red by that case's name.
- **F8a.** A case counts the recorded frames in which the full-width rule has a candidate row (a row it reads as run to
  the edge, or to a straddle, with a row under it), over the 61 2.1.300 panes and the 29 box-folder panes as the recipe
  meets them at their real sizes. It requires the six frames that had one before this wave
  (`cc300-ask-freetext-1000.txt`, `cc300-ask-review-4q-100col.txt`, `cc300-ask-wrapped-question-focused.txt`,
  `cc300-ask-wrapped-question.txt`, `box-taller-than-capture.ansi`, `stash-held-during-turn.ansi`) and pins the count: 6
  of 90, before and after this wave (measured with the old rule by a scratch script, and with the new one by the case).
- **F8b.** The third stash pane's case now requires that the one row the path rule replaces is the stash notice row, that
  it reads the whole working-directory token, and that the stored text holds no `stashed`.
- **F9.** The version fingerprint gains five probes: a bare quote (kept), a Hangul syllable row reaching the edge, a row
  at the probe's own width, a straddle, and (with the ruling) a row reaching the edge through U+3248. A case pins their
  five answers. **The frames recipe's version: `03f101670690507b` on `main`, `bec098af3496f523` at this wave's first push,
  `962a0b5e963e0b92` at its final tip.** No file in the tree pins any of the three (searched: none, outside this note), so
  no pin follows. The delivery recipe's version still prints `da16fe2f55551e0b`.

### 9.2 The note corrected to the code (ruling 8)

- **R2** (section 5, the class rule's pass-through characters): one combining mark also defeats three shape rules, not
  the exact matchers only, and the limit now names them: the path rule, the private shapes and the credential shapes.
- **F7, the first half** (section 4, round 2's F-B): the sentence that a row is never read as narrower than it is drawn
  was not true with the hand list. It is replaced by a pointer here. What is true now: a character counts two cells when
  the table lists it, when it is the stated addition, when it is an emoji drawn as one, or when it is unassigned, and one
  otherwise. A row can still be read narrower than it is drawn in one place: an ambiguous-width character (A in the data
  file) other than the eight of the stated addition counts one cell, which a terminal draws in two only in an East Asian
  locale; each of them counted one cell on `main` too. The frames driver runs under `LANG=C.UTF-8` (read in
  `agent/src/testbox/captureFramesRun.ts`), and how the terminal draws an ambiguous character there is inferred, not
  measured. Every combining or zero-width mark counts one cell though it is drawn in none, so there the row reads wider
  than it is drawn, the safe direction.
- **F7, the second half** (section 5, the three-row split): a bordered box drawn narrower than the pane holds less in a
  row than the pane's width, so the split needs a string longer than the box's content width; the figure of about 70
  characters for the longest of the box's strings is marked as inferred.
- **Ruling 5, measured.** Every recorded box-folder pane still reduces on both hosts, and the 2.1.300 corpus keeps its
  results and counts: 38 model rows, 0 account rows and 5 path rows replaced in 61 panes, every width kept. No pane or
  row needed to go to the coordinator.

### 9.3 The "Known limits at merge" of #3487

- **Closed by this wave:** the wide set as a hand list, with the straddle (9.1); one combining mark defeating more than
  the exact matchers, as text (9.2: the limit itself stays a named residual on the alarm wave's ticket); a cut token after
  an earlier bare quote with no case (F3); a replaced row measured in code points (F5); the recorded-pane case not
  asserting that the full-width rule was exercised (F8a); the third stash pane's case not asserting the notice row (F8b);
  the fingerprint with no probe for a bare quote, a wide character or a full-width row (F9).
- **Still open, as ruled (ruling 9):** an ordinary word beside a quote glyph refused as a cut token (F4), and a rule row
  whose label holds a private string replaced, so the server's check refuses the frame `status-row` (F6). Both wait for
  the first capture's refusal counts. So do the alarm, the send, and anything under `server/src/inject`, which this wave
  does not touch.

### 9.4 Evidence

Every run went through `ccrc test --local`, in the foreground, one file per command.
- **Red first.** The 11 new cases that need the new rule were run against the old `shared/framesReduce.ts` and each was
  red by name: the six table and width cases, the three capture-owner cases (the unlisted wide character, the straddle
  with no trailing space and with one), F5, and F8a. The F3 and F8b cases hold on the old code too (they make the suite
  stronger; F3's is proved by M8 below). The ruling's case, the comparison with main, is new at the second push and is
  proved by its mutant below. On the final tip the reducer suite passes 91 of 91.
- **Mutants**, on the final code tip, in a scratch clone of this branch (never this workspace), one row at a time,
  with the first wave's runner (from the coordinator's copy, not in the tree): each edit applied, `frames-reduce.test.ts`
  run once (one row, N18, runs the agent's `testbox-capture-frames-run.test.ts`), the file restored. **178 mutants, 178
  killed** on the final tip (176 of 176 at the first push). The scratch tree read clean by git after each batch.
  - Every reducer row of the first wave's list, 38 rows (rules 1 to 10, round 1's and round 2's), three of them
    re-anchored where the code moved: P6 (the edge counted in code points) now on the cell count, P7 (an emoji counted
    one cell) as a one-cell answer for an emoji at the top of the width function, and P8 (a CJK ideograph counted one cell) as the unified
    ideographs carved out of their table range.
  - 15 for this wave: the reviewer's M4 (the Hangul syllables range removed) and M5 (the fullwidth forms range removed),
    each red through the table case and the walk; M8 (only a row's first closing quote examined), red through the F3
    case; the straddle branch removed; the edge measured on the row as drawn; the path token read on the row as drawn;
    an unassigned code point counted one cell; an emoji drawn as one but N in the table counted one cell; the table
    search missing a range's first, and its last, code point; F5 reverted; F9's four probes removed; a straddle read under
    a narrow first character; a straddle read two cells short; the table emptied. And two for the ruling: the stated
    addition dropped, red by the case that compares every code point with main; the fifth probe removed, red by the
    probe case.
  - One per range: each of the 123 ranges dropped from the table, each red through the table case by name (the runner
    records two names a row; for the one row whose first two were other cases, D49, a run alone showed the table case red
    too).
- **Suites on this branch** (`main` had not moved from 86b2c2d6e2, the branch's base, when they ran), each alone: on the
  server, `frames-reduce` 90, `frames-result` 54, `frames-lane-decider` 9, `frames-lane-store` 25, `frames-lane-capture` 25,
  `frames-transport` 25, `frames-capture` 13, `frames-capture-frames` 24, `box-frame-fixtures` 8, `testbox-frames-route`
  19, `delivery-drive-frames` 19, `send-type-loop` 5, the gate's suite 434, `box-token-census` 92, `coord-token` 44, the
  three sender-reading suites (`pane-prompt-glyph` 6, `injected-prompts-characterization` 11, `send` 158), `anchors` 9,
  `citations` 4, `deviation-refs` 35, `docs-grammar` 158 and `ci-ledger-guard` 32; on the agent,
  `testbox-capture-frames` 13, `testbox-capture-frames-run` 49, `testbox-capture-desk-frames` 4,
  `testbox-capture-op-frames` 11, `testbox-imports` 7 and `testbox-capture-deadline` 26; and the tree guards
  `topology-clean` 62, `public-text` 20, `private-names` 47, `oss-metadata` 29, `growth-check` 63 (3 skipped) and
  `growth-caps` 12. All pass. The server's and the agent's own compiles pass.
- **On each pushed head merged with `main` 8a7bcacc8b** (which had moved by one merge that touches none of these files;
  the merge probe answered clean each time, so nothing was absorbed), in the scratch clone, each alone: the nineteen
  server suites of the list above from `frames-reduce` to `send` (the gate's suite among them, 434) and the six agent
  suites, with the same counts (`frames-reduce` 90 at the first push, 91 at the final tip), and on the final tip also
  `public-text`, `private-names`, `growth-check` and `growth-caps`. `topology-clean` cannot run in that clone (its tree
  read overflows git's output buffer there, `spawnSync git ENOBUFS`), so it ran in the workspace at the final tip: one
  timeout under load (`nothing in the tree speaks it`, 24.6 s against its 20 s), then 62 of 62 alone. The recipe
  versions print the same on the merge as on the tip: frames `962a0b5e963e0b92` at the final tip, delivery
  `da16fe2f55551e0b`.
- **Unmeasured here: the server's test-project compile** (`test/tsconfig.tests.json`). The test slice's memory cap killed
  it twice under the fleet's load (exit 137, no type error printed); CI's `typecheck (server)` job is its arbiter.
- **Tests that read a file this wave changes as text** (#3562): the server tests that name `shared/framesReduce.ts` in a
  string are `frames-reduce`, `box-frame-fixtures`, `frames-lane-capture`, `frames-transport`, `testbox-frames-route` and
  `single-definition/late-census` (83), and on the agent `testbox-capture-deadline` and `testbox-capture-frames-run`. All
  ran above and pass. This wave changes no other TypeScript file.
- **Count lines.** No file this wave touches states the gate's count lines, so none was re-derived.
- **This note** is an existing task note, edited with the coordinator's direction; the head commit carries the ledger
  guard's edit trailer for it.
- **Process.** Three hook refusals, each reported. The graph gate refused a search command until one graph query had
  answered (its own instruction), so a query ran and the search was not repeated. The test slice's hook refused two
  commands whose text named the compiler, though neither ran one: a status mail to the coordinator, sent again with that
  word left out, and a memory note, written with the file tools instead. The file tools turn a
  `\u` escape typed into an edit into the character itself, so the table was written as numbers and spliced in by a
  script, and the four new probes spell their wide characters with `String.fromCodePoint`.

# The card follow-up: what each deferred finding became

Plans: `docs/superpowers/plans/2026-11-10-overlord/w1a-card.md` and `w1a-timers.md`. This pull request carries the findings
that card review 2027 (round 2 of card PR B) and timers PR D's review 2064 left for later. Each departure is named by a
slug; no deviation number was taken. The coordinator folds these into the ledger. This note sits beside `departures.md`
(card PR B) and the timers pieces' notes, none of which this pull request edits.

## Card review 2027

- **N1, card-blocks-escape-controls** (fixed). The raw row `ccrc-api sessions card` prints the door's JSON as it came, and
  JSON writes each C0 control as six bytes (`\u0001`), so a crafted card (forty programmes with control-character goals and
  decisions) had a first page of about 35 to 37 KB as JSON, past the measured cut of about 30,000 bytes. The card's untrusted
  blocks now escape every control character but the newline and the tab (C0 and C1, CR and ESC among them) as `\u{<hex>}`,
  as `oneLine` escapes them in a bare field (`blockText`, `server/src/continuity/card.ts`). The escape runs before the cap,
  so the cap still bounds what is shown. After it, no character of a page is more than four bytes as JSON (a four-byte
  character's), so `CARD_PAGE_CHARS` (7,000 code points) keeps both paths under the cut: `ccrc-api card` (one page and its
  footer) and the raw row (one page as JSON, the newline `print_body` adds and `http 200`). A raw ESC or CR no longer
  reaches the pane through `ccrc-api card` either. Pinned in the render suite, for thirteen width classes of character (seventeen since fix round 1) at
  every cap the card has (forty programmes, fifty items, a hundred mails, the notes, fifty timers and a checkpoint), at the
  card's budget and with no budget, with a CONTROL that the same page of raw controls passes the cut. A route case in the
  new `continuity-card-memo.test.ts` measures the real answer's body. Mutant M9 (the escape dropped) joins
  `CARD_BLOCK_SET`, killed by its new case; the floor is unchanged.
- **lone-surrogates-escaped** (fix round 1, review 2087 F1; replaces `lone-surrogates-unreachable`, which was false). A TEXT
  column and a UTF-8 file read give U+FFFD for a lone surrogate, but a JSON-parsed column gives one back: a programme's
  `doneWhen` (stored as `JSON.stringify` of the list, read with `JSON.parse`) and the handover note. JSON writes a lone
  surrogate as six bytes. Both escapers (`oneLine` and `blockText`) now escape it as `\u{d800}`, so no character of a page is
  more than four bytes as JSON, whatever the column. Pinned: the render suite's alphabet gains U+D800 and U+DC00, and the
  reviewer's worst case (40 programmes x 12 `doneWhen` goals x 2,000 lone surrogates, at the card's budget and with none) is
  under `TOOL_RESULT_CUT_BYTES` on every page; mutant O7 (the class without `\p{Cs}`) joins `CARD_ONE_LINE_SET`.
- **N2, served-comment-stays-in-the-frozen-migration** (recorded, not changed). The `served` column's comment inside
  migration 69's SQL still says "a sequence over every serve"; since review 2023 F11(a) it is each session's own. Migration
  69 is on `main`, and its entry says every earlier entry is frozen, so its text stays as it is. The reader's docstring,
  `insertSnapshot` in `continuityStore.ts`, already states the per-session sequence and why.
- **N3, card-items-read-through-the-one-hold-filter** (recorded, not changed). `itemsFor(null, HOLD_DISREGARDED)` also runs
  the Recently-cleared query, which answers nothing at that bound. `itemsFor` is the one filter of the hold (A21: "so every
  reader of this function agrees"), and a second open-items reader beside it would be a second spelling of that rule, for
  one cheap query per card read. Kept.
- **N4, a-new-start-forgets-the-memo** (fixed). The door's memo of served pages is keyed by session and conversation uuid,
  and a resumed conversation keeps its uuid, so pages read in its previous generation and the last page read after the
  resume recorded a read the new generation counted. The start door now forgets that conversation's partly served card on
  a fresh start (`fresh: true`; a resend of a recorded report forgets nothing). The memo's declaration moved above the
  start door, its first reader. Pinned by `continuity-card-memo.test.ts`, with a CONTROL that pages 1 to 3 with no start
  between record one read.
- **memo-carries-its-start** (fix round 1, review 2087 F3). The card door awaits the attribution and the gather before it
  touches the memo, so a page request of the old generation still in flight when a fresh start lands used to add its page
  to the new memo. Each memo now carries the start it belongs to: every fresh start raises that conversation's stamp
  (`starts`, bounded like the memo), the card door reads the stamp before its first await, and a page whose request began
  under an older stamp is served (`recorded: false`) but joins no memo. A stamp dropped by the bound reads as no start, which
  only ever starts a memo over. Pinned by a memo case that holds a page request at its registry read across a fresh start.
- **card-escapes-what-oneLine-escapes** (fix round 1, review 2087 F2, F4a). One class, `ESCAPED`, serves both escapers: every
  control, format and line or paragraph separator character (bidi overrides and isolates, zero-width and tag characters,
  U+2028 and U+2029 among them), every lone surrogate, and the backslash, which is doubled so a stored `\u{1b}` reads
  `\\u{1b}`, never as an escaped ESC. `blockText` keeps a block's newlines and tabs. A block whose lines `fieldLine` already
  escaped (a note's two fields, the checkpoint, the timers) is fenced by `fieldsBlock`, which does not escape again, so its
  backslashes are not doubled twice. The timer cap is unchanged after the widening: the timers block is built from escaped
  fields, the widest escape is still under `'\u{10ffff}'.length` (a tag character's `\u{e007f}` is nine characters, a
  backslash two), and the factor-4 mutation still reds review 2064's F1 case. Mutants: M10 (`blockText` back to controls
  only), M11 (a field block escaped twice), O8 (the class without the backslash).
- **review-2087-f4-text** (b and d). (b) `untrustedBlock`'s cap can cut a `\u{..}` escape in half; correcting it is a change
  to the shared `capUtf8` in `server/src/coord/untrusted.ts`, not one line, so it stays and is said here. (d) `timer set
  --run=5 2h n` now takes the position refusal too (one line); `--` first keeps the identity refusal, and `set 2h --run 5 x`
  still takes `--run` as the note, which a ruled note of review 2064 (F8) keeps as data. (c) The constant-only CONTROL case
  is dropped; the render suite names the real guards instead (its RAW_CONTROL and size assertions, M9, M10, O1, O2, O7, O8).
- **N5, card-changes-when-its-masking-changes** (recorded, not changed). The card is masked whole before it is hashed, so
  if the masker's fingerprint rows change between two pages of one read, the masked text and its hash change, and the next
  page answers `card-changed`. That is right: the hash names what the reader sees, and a reader told to start again from
  page 1 never mixes two maskings in one read. A footnote to `card-masked-whole`.

## Timers PR D review 2064

- **F1, timer-cap-pinned-at-the-widest-escape** (fixed). A render case puts the largest `timerCap` (fifty) of timers, each
  with a preview of sixty U+E0001 (escaped as `\u{e0001}`, nine bytes), on a coordinator card and asserts no cut. Measured:
  with the factor in `TIMER_LINE_CAP_BYTES` lowered from `'\u{10ffff}'.length` to 4, this case is red, and the two earlier
  cases (one-byte and four-byte previews) stay green.
- **F2, coordinator-unmeasured-pin-gains-timers** (fixed). The coordinator's every-fact-unmeasured pin lists
  `'your pending timers'`.
- **F3, nothing-line-docstring** (fixed). `CARD_NOTHING_LINE`'s docstring says it names the role's body facts
  (`BODY_FACTS`), never pending timers, so a card holding only timers carries the line and its timers section both, and the
  line stays true (slug timers-are-not-body-facts).
- **F5, run-bound-timer-cancelled-without-mail** (fixed). The coordinator's `references/api.md` gains a Timers paragraph,
  above the landing-writes block that its pin keeps last: the three verbs and their grammar, and that a timer set with
  `--run` is cancelled `run-closed` without mail when the run closes (and one set with `--programme` is cancelled
  `programme-ended`, also without mail), so a worker binds a wake to the run only when the run's close should end the wait.
  Worker clause 17 is unchanged.
- **F6, timer-shape-is-case-sensitive** (fixed). The timer member's regex in `worker-skill.test.ts` drops `/i`, and the
  fixture list gains the member in upper case, which the old regex admitted.
- **F7, binding-flag-first-says-its-position** (fixed). `ccrc-api timer set --run 5 2h n` (and `--programme` first) is
  refused `bad-args` with "timer set takes the duration and the note first, then --run: ..." and the grammar, not as a typed
  identity. Any other flag in the first place is still refused as a typed identity.
- F4 and F8 to F10 are notes that ask for no change (F4 is the recorded fail-open departure of PR D's middle commits); nothing
  here changes them.

## Measured by hand

Each mutation was applied to the file, the named suite run, and the file restored from a saved copy and compared by
sha256: the block escape dropped (render suite red, six cases); the timer line factor at 4 (render red, the F1 case); the
coordinator's timers section dropped (render red); the start door's forget dropped (memo suite red); the forget on every
start, `fresh` or not (memo suite red, the resend case); the client's position check dropped (timer suite red, the F7
case); the timer regex with `/i` again (worker-skill red, the upper-case fixture).

Fix round 1, the same way: the class without `\p{Cs}` (render red, four cases: the U+D800 and U+DC00 cards, the block case
and the reviewer's worst case); the class without the backslash (render red, the block case); `blockText` back to controls
only (render red, eight cases); a field block escaped twice (render red, five cases); the timer line factor at 4 again, after
the widening (render red, review 2064's F1 case); the memo's start check dropped (memo suite red, the in-flight case); the
client's position check without the `=` form (timer suite red).

## Claims

- **additive-lines-in-held-files.** `server/src/continuity/card.ts`, `server/src/continuity/routes.ts` and `ccd/ccrc-api`
  are under probes PR B's claim 4205. Its holder agreed by mail to these lines (the block escape and the nothing line's
  docstring; the memo and the start door; `parse_timer`), none of which are its rows, and the second to land merges `main`
  once and takes the union, as ruled. Probes PR B (#2802) landed first: this branch's conflict probe then answered a
  conflict in `routes.ts`, so it merged `main` once (worker clause 16) and kept both sides: the memo block where this pull
  request moved it, and `main`'s `stampRead` helper after the start door, where it stood.

# Item view reading (wave 186)

The Waiting-on-you item page reads badly at a desk. At about 2000 px wide it showed three columns: the list pane, the item,
and a third column holding the note, the answer marks and Mark done. A came-back item's reason was the page's last line.
Item text was drawn as plain text, so a command the operator had to run sat inside a sentence.

This wave makes four changes:
- The item page is one column, read top to bottom: the band, the title, why the item came back, why, how, the history, then
  "Your move".
- Item text is Markdown, drawn by the session transcript's renderer, so a fenced command becomes a copy block.
- Every place that summarises an item shows plain text, through one projection.
- The coordinator's guidance tells writers how to put commands in blocks.

## What changed

### The renderer

`ItemMarkdown` sits beside `ChatMarkdown` in `pwa/src/lib/markdown.tsx`. It uses the same react-markdown, the same
pre-scan and limits, the same two paths (the main thread up to 4096 bytes, the parse worker past that), the same code
block, and the same raw HTML drawn as text.

What differs is one parse profile and one component map, each a row beside chat's:
- `MARKDOWN_PROFILES` gains `item` (`pwa/src/lib/markdownParse.ts`), with GFM and `remarkItemGuard`.
- `ITEM_COMPONENTS`:
  - an anchor that never embeds an image;
  - an image drawn as its link with its alt text, never fetched;
  - a heading drawn as bold text.

The **inline form** keeps marks inside one line and unwraps every block. The title and each option use it. The **block
form** is used for why, each how step, the recommendation's reason and each history note.

### Links

Links in the prose come from `linkProseRuns` (`pwa/src/lib/hastLinkRuns.ts`). It splits the prose texts of the parsed tree
through the item's own `linkRuns`, unchanged. Text inside code, a fenced block or a link is never split.

A link the writer made (`[words](address)`, or a bare address GFM links) is judged by the same splitter. It stays a link
only when `linkRuns` reads its whole address as one link. So item text links exactly what plain item text linked before:
- an `https` page;
- a console path;
- a repository document path, opened in the Docs reader.

It never links a `javascript:` or `http:` address, or a document outside the Docs reader (D27, D28).

An outside link says where it goes (fix round 2, F1, the coordinator's rule). A link the policy accepted that leaves the
console (an absolute `https` address) and whose words are not exactly its own address draws its words as the link, then the
destination's host in round brackets as plain secondary text outside the anchor and its name: "the runbook (github.com)".
The host is the address parser's: lower case, a non-ASCII name encoded, a port only when it is not the default. An image
drawn as its link follows the same rule with its alt text as the words. A console path, a Docs reader path and an item
reference stay in the console and show none. No list of look-alike spellings is judged: words can say anything ("Approve in
the console"), so every such link shows its host. The link step marks an anchor whose words are its own address
(`TEXT_SELF_ATTR`); the item's anchor (`WithHost`, `markdown.tsx`) draws the host after any other. The transcript and the Docs
reader do not run it, and the summary projection never carries the host. The policy also refuses an address with a userinfo
part (`https://github.com@evil.example/`), which reads as one host and opens another (F9).

### Old prose (the guard)

The guard is `pwa/src/lib/remarkItemGuard.ts`, and it runs in the item profile only. These shapes are measured in
`pwa/test/item-markdown.test.tsx`:

| old prose | plain CommonMark | the item draws |
|---|---|---|
| `src/*.ts and docs/*.md` | `src/<em>.ts and docs/</em>.md` | as written |
| `Remove *.log. Keep src/* as it is.` | `Remove <em>.log. Keep src/</em> as it is.` | as written |
| `5*3*2` | `5<em>3</em>2` | as written |
| `__init__`, `_x_` | bold or italic | as written: an underscore never makes emphasis |
| `2026. was the year` | a list starting at 2026 | as written: a one-line list of one item stays a paragraph |
| `- then run it again.` | a one-item bullet list | as written (the same rule) |
| `# of retries is 3` | a heading "of retries is 3" | as written: `#` headings are off |
| `> 5 failures means…` | a block quote that loses the `>` | as written: block quotes are off |
| a line indented four spaces | a code block | prose: indented code is off, and a block is a fence |
| `<slug>`, `a > b`, `#3427`, snake_case | as written | as written |
| `Use ~old~ names` | `old` struck through | as written: a strikethrough takes two tildes (fix round 1, F7) |
| `ccrc-[0-9]+\.log`, `AT&amp;T` | the backslash and the reference decoded | as written (fix round 1, A2) |
| `see[^1]` and `[^1]: the note`, `[draft]: docs/x.md` | a footnote section; a line that vanishes | as written: footnotes and reference definitions are off (fix round 1, A4) |

An asterisk run is emphasis only when its outer side is free.
- **Before an opening run** there is no letter, digit, `/` or `.`.
- **After a closing run** there is no letter, digit or `/`.
- **Inside the runs** there is no glob: the character after the opening run is not `.` or `/`, and the character before
  the closing run is not `/`.

A full stop after a closing run is allowed, so `This is *important*.` keeps its emphasis. The ruling's literal rule ("not a
letter, a digit, a slash or a full stop" on the outer side) would have dropped every emphasis that ends a sentence. This is
a deviation from the letter of ruling Q2; it keeps the ruling's purpose, and the coordinator accepted it (delivery 38282).

The opening run's outer side catches a glob after a path (`Clear build/*. Then rebuild lib/* from scratch.`). It does not
catch a bare glob that ends a sentence with a path glob later on the line (`Remove *.log. Keep src/* as it is.`): both outer
sides are spaces. Measured red first in both the renderer and the projection, so the inner-side rule was added to both.
A full stop just inside a closing run stays allowed, so `*The run is over.*` is still emphasis. The projection
(`shared/itemText.ts`) reads the same three rules.

The transcript's output does not change. Chat's plugin list, components and paths are untouched. The golden files are green
untouched, and one case feeds the same text to both renderers.

### The copy block

The transcript's `CodeBlock` gains one word, `Copy failed`. The Docs reader's code blocks share that component
(`pwa/src/docs/DocsLeaf.tsx`), so the word shows there too (fix round 2, F5). It shows for 1.6 s when the page has no clipboard
or the browser refuses the write, beside `Copy` and `Copied`, where those words already live; before, nothing showed. Copy copies the block's text exactly. The
control is a native button, so it is reachable by keyboard and has its focus ring. The `pre` scrolls inside its own box.

### The prose class

Item text is drawn in `PROSE` (`msg-assist`), which is @ccrc/ui's shared prose hook class and is already used by the Docs
reader.

Checked: nothing keys behaviour on that class.
- No selection handling and no per-turn copy control.
- No query in `pwa/src` reads it. `ChatList.tsx` makes its own detached probe element of that class to weigh glyphs for
  virtualisation, and never queries the page for one.
- No accessibility query. Tests read it only inside their own renders.

So no split was needed.

### The item page

`pwa/src/ledgers/ItemView.tsx`.

**Order.** The band, the title, why it came back, why, how, the history, then "Your move". "Your move" stays last and
unchanged inside: the decision's options, its recommendation and the own-answer field stay there, beside Mark done.

**Why it came back.** The came-back line is `cameBackNote` (`ledgerWords.ts`), the one pure reader the list row already
uses. It is derived from the history, with no wire field, and is labelled "Why it came back". The history keeps the note
too.

**The history.** A history of more than four acts folds its earlier acts behind one native disclosure, "N earlier", and
keeps the newest three open. Each act's line reads as its word and its age. A send-back's note is drawn under its line as
Markdown. Before, the line read `sent back: <note>`.

**New words** in the words file (`ledgerWords.ts`), proposed here as the ruling asked:
- `CAME_BACK_WHY_WORD`, "Why it came back";
- `earlierActsWord`, "N earlier";
- `HISTORY_FOLD_OVER` (4) and `HISTORY_OPEN` (3).

### The projection

`itemPlainText` (`shared/itemText.ts`, imports nothing) turns item text into one line of plain text. Every summary goes
through it:
- the list row's title and why;
- the item nav's live region;
- a stored secret's "asked for by" line;
- the push body;
- the raise's operator notice;
- the continuity card's open items.

An action item's why in the list row (an end-run request, an end-programme proposal: a session's words) keeps its lines,
each projected by the line-keeping form `itemPlainLines` (fix round 1, F6). The tick mail's subject is not a summary: it is
the key the stale label and the duplicate-tick guard find the item's mail by, so it stays exactly as main builds it, the raw
title included (fix round 1, F4).

### The guidance

`ccd/coordinator-skill/references/decision-procedure.md` gains one paragraph after "raise one item". It says:
- item text is Markdown;
- every command goes alone in a fenced block;
- a path or name in a sentence takes inline code, except a document the operator is to open: its repository path stays
  bare, outside backticks, so the console links it to the Docs reader (the item's link step never links inside code);
- a How step is one act;
- a title and an option take inline marks only;
- emphasis uses asterisks, never underscores.

No clause is edited.

## The stylesheet

`pwa/src/ledgers/ledgers.css` is held by claim 7346 (#3427, console spacing). It went to its holder as a packet against main
595d9c5c0f (yes, delivery 38292), with one question: which rules its fix round changes or pins. Its round owns the side pad
of `.wl` and `.wi`, the strip's pad and the desk block's width and margins, and nothing in `.wi-detail`, `.wi-card`, the
steps, the history or the measure, so this wave's lines restate none of them. The wave adds:
- the one column (`.wi-detail` loses its 21rem track and the 900px rule that folded it);
- the measure: `.wi` and `.wi-nav` set `--wl-measure` to `--measure-chat-prose`, a width cap only (the run pages' strip,
  `.wi-nav.rd-strip`, sets its own `max-width: none` and stays full width);
- the step numbers (`list-style: decimal`, the marker in secondary ink);
- the history row as a small grid, and a send-back's note in primary ink;
- the fold's summary (`.wi-earlier > summary`, a tap's height on a coarse pointer);
- the came-back line, `.wi-came-back`: the list row's send-back edge, on the card. Its holder pointed out that `.wi-back` is
  already the strip's Back control, and an unscoped query for it (`phone-bar.browser.test.ts`) would have found two, so the
  line has a name of its own;
- `.wi .wi-inline`: an inline item text keeps its container's type while it wears the prose class.

`pwa/src/ledgers/WaitingScreen.tsx` (claim 7352) went through its holder as a packet (yes, delivery 38207) and is applied:
the row's title, its why and its send-back note, and the cleared row's title, go through `itemPlainText`.

## The merge of main

This branch took in main once, at `ee9b069f30` (#3427 on main). Two paths conflicted:
- `pwa/src/ledgers/ItemView.tsx`, the import block only. The Overlord's account hold (#3489, on main first) added two imports
  beside the `ledgerWords` import this wave writes on several lines; both are kept. Its two other lines needed no
  resolution, because they sit in `Panel`, which is "Your move", the last block of the page:
  - the hold's Clear, mounted after the ended hint with `current={current}`, exactly as main passes it;
  - the line that says the acts are off on a saved copy, which counts the hold (`|| holdLane !== null`).

  A case of this wave (`pwa/test/item-view.test.tsx`) pins that the Clear is drawn once, inside the last block, and nowhere
  in the reading part. It went red with the mount moved into the reading card, and is green as merged. #3489's own suite
  (`pwa/test/item-account-hold.test.tsx`) is green on the merged head.
- `pwa/test/markdown-purity.test.ts`, the end of `ROOTS`: the Docs print wave added `renderTree.ts` and `printAllow.ts`, and
  this wave adds `remarkItemGuard.ts`. Both are kept, main's first (the coordinator's ruling and the two workers' agreement).

The generated review-lab fixture (`pwa/generated/reviewLabFixture.ts`) did not move: its test is green on the merged head,
so it was not regenerated.

The two continuity card cases that timed out at their bound during the build were issue #3458, repaired on main before
this merge; `server/test/continuity-card-facts.test.ts` is green on the merged head.

## Fix round 1 (review 4189)

Each finding was fixed with its case red first; the cases name the finding.

| finding | the fix | the case, and what was red |
|---|---|---|
| F1 a refused link's inner autolink was drawn | a refused link's words are walked by the same splitter (`judgeAnchor`, `hastLinkRuns.ts`), and the item's anchor fails closed: only an anchor the splitter marked links (`ItemAnchor`, `markdown.tsx`) | `item-view.test.tsx` "F1: …" (the reviewer's P1 and P1b: 3 anchors, then none) and `item-markdown.test.tsx` "an anchor the splitter did not judge is its words", "a refused link's words are walked …" |
| F2 an option held links inside its radio's label | an option, the recommended one too, is drawn with no splitter: marks, and every link and image as its words; the title keeps its links | `item-view.test.tsx` "F2: …" (3 anchors in the fieldset, then none); `item-reading.browser.test.ts` "F2: …": a tap on the address, the path's words and the item reference picks the option and the page stays, in both skins |
| F3 no guard clause had a case only it catches | one case per clause, G1 to G5, each emphasis (or a list) in the transcript's own output | `item-markdown.test.tsx` "G1 …" to "G5 …"; each clause deleted alone reds its own case and no other (5 mutation runs, 1 of 51 red each) |
| F4 the tick mail subject was projected | the subject is main's, byte for byte | `item-text-surfaces.test.ts` "the tick mail subject is main's …" and "a tick mail queued with the raw-title subject is still found by both readers" (both red on the projected subject) |
| F5 no client summary surface went red without its projection | one jsdom case per surface | `item-summary-surfaces.test.tsx` S1 to S6; each projection call replaced by the raw value reds its own case |
| F6 an action item's why showed raw marks in the row | `itemPlainLines` (`shared/itemText.ts`): each line projected, joined by a newline | `item-summary-surfaces.test.tsx` "S2b …" and `item-text.test.ts` "itemPlainLines: …" |
| F7 the page and the projection had drifted | no single-tilde strikethrough in the item profile; the projection reads a paragraph as one text, takes a mail address in angle brackets, keeps an escape, and pairs the nearest closing run as the page does | `item-parity.test.tsx`: one corpus fed to both, 20 texts alike; the listed differences held, each with its reason and both sides' text pinned (a two-line list, a table, a setext heading; round 2 adds a task item, a thematic break, a line-end backslash and the A3 rewrite). The corpus found a fourth drift the review did not name: the projection skipped a bound closing run (`*b*c`) and paired a later one |
| F8 a saved copy's line left the item's edge in Refined | the item route's list wrappers (`.wl-route > .wl`) take the item's measure | `item-reading.browser.test.ts` "F8 at 1280/1440/2000" in both skins: red in Refined by 32, 100 and 128 px, green in Instrument before and after |
| A1 a step that numbers itself read "1. 1." | decided for the whole list in round 2 (F6): only when every step begins with its own sequence number from 1 and `.` or `)` is each number dropped (`stepsWithoutOwnNumbers`, `ledgerWords.ts`); otherwise every step stays as written | `item-view.test.tsx` "A1: …" and the two F6 cases |
| A2 an escape and a character reference were decoded | the guard puts such a text back to its source (`asWritten`, `remarkItemGuard.ts`); the parser still reads an escaped mark as no mark. The projection keeps both too | `item-markdown.test.tsx` old-prose rows (A2), the parity corpus, `item-text.test.ts` |
| A3 (the half that matters) a link whose words are another address | words that read as an address or a path, other than the link's own, are drawn as where it opens | `item-markdown.test.tsx` "a link whose words are an address or a path …" |
| A4 a footnote leaked chrome | footnotes off in the item profile, and reference definitions too (with footnotes off, `[^1]: x` would otherwise parse as a definition and vanish) | `item-markdown.test.tsx` "a footnote is its words …" and the old-prose row for a definition |
| A7 the fold had no cue on a touch screen | the fold draws the sheet's chevron (`.wk-card summary`'s) at every pointer | `item-reading.browser.test.ts` "A7: …" at 390 with the coarse pointer emulated, both skins |
| A8 the fold's list name was hard-coded | `EARLIER_HISTORY_WORD` in `ledgerWords.ts` | `item-view.test.tsx` "A8: …" |
| A9 no picture showed a fence or inline code | a `markdown` pair, both skins at 1440 and 390 | see Pictures |

The reviewer's P1 third address, `https://github.com/o/r/blob/main/x.md`, is an ordinary `https` page by the outside-document
rule (D28 refuses a path through a Docs section), so once walked it is judged a link like any other; the case uses a section
path, which D28 refuses.

## Fix round 2 (review 4219)

Narrow, as ruled: one rule and five small items, each with its case red first.

| finding | the fix | the case, and what was red |
|---|---|---|
| F1 round 1's A3 fell to other spellings | the coordinator's rule (see Links): every outside link whose words are not its own address shows its host after it | `item-view.test.tsx` "fix round 2: an outside link says where it goes": one case per spelling (code, bold, a trailing bold mark, an image's alt, a bare domain, an address inside a phrase, a no-break space, a full-width solidus, "Approve in the console"), an ordinary worded link, the own-address cases, the console, Docs and item links with no host, the encoded non-ASCII host and ports, a title, and one property case over a corpus of spellings. 12 were red before; the full-width solidus was already caught by A3's rewrite. With the host taken out, 13 cases go red. `item-reading.browser.test.ts` "F1 at 390", both skins: the host is one line, outside the anchor and its name, no sideways scroll (red with the host taken out) |
| F9 an address with a userinfo part | `linkOf` refuses it (`ledgerLinks.ts`) | "F9: an address with a userinfo part is refused" |
| F2 the parity case listed three differences | four more listed, each with its reason; both sides' text pinned; a line break counts as a space in the page's words; the page is read without the host | `item-parity.test.tsx`, the listed differences |
| F3 the projection's memo had no case | three glob- and bound-closer inputs in the bounded-time case | `item-text.test.ts`: with the memo removed it takes about 4 s, against 250 ms |
| F4 the stale label's reader had no case | the waiting read, over an item with a marked title whose tick mail was answered, reads it not stale | `item-text-surfaces.test.ts` "the waiting read finds the tick mail …": red when that reader projects the title |
| F6 A1 was too eager | decided for the whole list | the two F6 cases (an inline enumeration, one step numbering itself) and A1's shape |
| F5 the `Copy failed` word reaches the Docs reader | named in the note (The copy block) | none: words only |

The old case "a Markdown link or image links only what plain item text would" now reads its one outside link's host after its
words. No after picture holds an outside link, so none was re-taken.

## Follow-ups (not this wave)

- The coordinator's, from review 4219 (one ticket): F7 (the recommendation's why as a radio group's description carries a
  copy block's bar words), F8 (a table cell's escaped pipe shows its backslash), F10 (the long-text path with a splitter is
  untested), F11 (two footnote constructs are redundant), F12 (the migration note's edge is not measured). F13 is ruled not
  this PR's.
- The coordinator's, from review 4189: A5 (the bounded-time case counts wall time), A6 (tables, setext underlines and
  the like still show marks in a summary), A10 (a CRLF block copies its `\r`), the other half of A3 (a link whose words
  imitate a control), and keying the tick mail's lookup by its subject's head.
- A document path inside inline code that still links to the Docs reader. Today a writer must leave a document to open as a
  bare path, outside backticks; a later change could link a repository document path inside inline code too, and the
  guidance's exception would then go.

## Pictures

Before and after, at the same sizes and cases, are under
[`docs/design/2026-10-22-desktop-polish/item-view-reading/`](../../../design/2026-10-22-desktop-polish/item-view-reading/).
Each picture is named `<before|after>-<skin>-<width>-<case>.png`. The cases are the six kinds of item (do, decide, value,
secret, closed, saved copy) at 1440 and 390, and do and decide at 1280 and 2000, in both skins; at 390 a `-full` picture
shows the whole page. Every item text is invented. The pictures are reduced to a 256-colour palette to keep the folder small.

The same measuring script took both sets: before on main before this wave, after on this branch merged with main
`ee9b069f30`, then the after set again on fix round 1's head (the history fold's chevron, A7, and the saved copy's edge in
Refined, F8, changed). Fix round 1 adds a `markdown` case (A9), an item with inline code in its title and why and a fenced
command in a step, after only, in both skins at 1440 and 390. The measured columns did not move. Six of the full-page
pictures at 390 equal their viewport twins pixel for pixel, before and after alike: `closed`, `secret` and `value`, in both
skins (the whole page fits the phone's screen). The "do" item, in both skins:

| skin | width | columns before | columns after | Why's measure before | after | "Your move" before | after |
|---|---|---|---|---|---|---|---|
| refined | 1280 | 596px 336px | 847.047px | 570px = 56ch | 811px = 80ch | beside | under |
| refined | 1440 | 730.406px 336px | 847.047px | 704px = 70ch | 811px = 80ch | beside | under |
| refined | 2000 | 788px 336px | 831.047px | 762px = 75ch | 795px = 79ch | beside | under |
| refined | 390 | 374px | 358px | 348px = 34ch | 322px = 32ch | under | under |
| instrument | 1280 | 576px 336px | 908px | 550px = 54ch | 872px = 86ch | beside | under |
| instrument | 1440 | 736px 336px | 962.5px | 710px = 70ch | 927px = 92ch | beside | under |
| instrument | 2000 | 788px 336px | 962.5px | 762px = 75ch | 927px = 92ch | beside | under |
| instrument | 390 | 374px | 366px | 348px = 34ch | 330px = 33ch | under | under |

For example, compare [before, Refined 1440, decide](../../../design/2026-10-22-desktop-polish/item-view-reading/before-refined-1440-decide.png)
with [after](../../../design/2026-10-22-desktop-polish/item-view-reading/after-refined-1440-decide.png), and
[before, Instrument 390, do, full page](../../../design/2026-10-22-desktop-polish/item-view-reading/before-instrument-390-do-full.png)
with [after](../../../design/2026-10-22-desktop-polish/item-view-reading/after-instrument-390-do-full.png).
The fence and inline code: [Refined 1440](../../../design/2026-10-22-desktop-polish/item-view-reading/after-refined-1440-markdown.png),
[Instrument 1440](../../../design/2026-10-22-desktop-polish/item-view-reading/after-instrument-1440-markdown.png),
[Refined 390](../../../design/2026-10-22-desktop-polish/item-view-reading/after-refined-390-markdown-full.png) and
[Instrument 390](../../../design/2026-10-22-desktop-polish/item-view-reading/after-instrument-390-markdown-full.png). The
saved copy's edge (F8): [before](../../../design/2026-10-22-desktop-polish/item-view-reading/before-refined-1440-saved.png)
and [after](../../../design/2026-10-22-desktop-polish/item-view-reading/after-refined-1440-saved.png).

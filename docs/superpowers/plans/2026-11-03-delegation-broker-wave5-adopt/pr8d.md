# PR8d (the adoption card's counts line in mode unmeasured): item 131

Run 1721, delegation broker wave 5. PR8c (#2481) shipped the Settings card "Worktrees left behind". Its fifth review (run 1717,
C3) noted that in mode `unmeasured` the confirm sheet and the mode line name no would-keep figure, while the counts line a few
lines above still read "would keep 7", a figure from the same pass the sheet will not vouch for. The operator ruled on item 131:
"Hide the figure in that state, like the sheet". This PR is that change and nothing else.

**Ledger.** No new number. D-8114 is amended in place: it gains one clause, that after a pass that could not read everything it
needs, the counts line names every count but the would-keep figure and says the card cannot say how many until the next pass; and
its closing pointer to the notes now names `pr8d.md` beside `pr8c.md` (review 1727 F4).

## The change

`delegationAdoptCountsLine` (`pwa/src/fleet/delegationAdoptWords.ts`, L1) decides it; the card (L4) renders the string it is given,
unchanged. In mode `unmeasured` only, the line drops `would keep N` and ends with `DELEGATION_ADOPT_TEXT.countsUnreadPass`:

> Of what turning this on would keep, this card cannot say how many until the next pass.

Both of its phrases are the sheet's own. "what turning this on would keep" was in `confirmUntilNextPass` and "this card cannot say
how many until the next pass." was in both `confirmUntilNextPass` and `confirmUnreadPass`; each is now one private constant that
all three sentences are built from, so the words are spelled once. The sheet's two sentences are byte-for-byte what they were.

Every other count stays, in its place. Live, shadow and suspended are unchanged, so shadow still names the figure, as its sheet does.

**True in both sub-cases.** Mode `unmeasured` is the breaker unmeasured with the marker read (set or clear), or the marker
unreadable (`server/src/coord/delegation-adoption.ts#walkAdoption`). The words name neither: they say only that the card cannot give the figure
before the next pass, which holds whichever read failed. The mode line above already says that the server could not read
everything it needs. The words pass `literal-census`, `plain-words` and the card's own banned-word row.

## The rows

`pwa/test/delegation-adopt-section.test.tsx`, jsdom, the card rendered alone:

- mode unmeasured, would keep 4, once each with the marker `clear`, `set` and `unmeasurable`: the counts line carries no
  "would keep 4" (and no `4` at all), does carry the next-pass sentence, and still names kept, waiting and unchanged;
- shadow, would keep 4: the counts line still carries "would keep 4" and no next-pass words;
- live and suspended, would keep 4 (review 1727 F2): the same, so neither mode loses the figure. A pin of today's behaviour, green
  at the tip and red under `unread = h.mode !== 'shadow'` (2 red: these two rows).

A third row pins the sheet's sentences outside shadow word for word (modes unmeasured, live and suspended, each with the mail
sentence), as literals: the sheet's two "cannot say" sentences are now built from the phrases the counts line shares, and the row
proves they render exactly as on main. It passes against main's words module and against this one.

Red first at main (ec07e0bdf): the three unmeasured rows failed (`expected 'Last pass: kept 1, would keep 4, wait…' not to match
/would keep 4/`), and the shadow row passed. Green after the change, and at fix round 1's tip with the rows above: 86 of 86 in the file (review 1727 F3). FR4's F4 row (the sheet at mode
unmeasured, would keep 4) passes unchanged.

## The mutants

Each was made from a saved copy of the words module, run under `timeout -k` and a process cap of the measured count plus 1500,
and restored with its sha256 checked:

| Mutant | Result |
|---|---|
| the mode check removed: the figure shown in every mode, no next-pass words (the brief's mutant) | 3 red (the three unmeasured rows) |
| the figure shown in every mode, the next-pass words kept | 3 red (the three unmeasured rows) |
| the next-pass words dropped, the figure still hidden | 3 red (the three unmeasured rows) |
| the figure hidden in every mode | 2 red at first (the shadow row, and review 1693 F8's "would keep 0" row); 4 red at fix round 1's tip, with the live and suspended rows |
| the figure hidden outside shadow (`unread = h.mode !== 'shadow'`, review 1727 F2) | 2 red at fix round 1's tip (the live and suspended rows); 84 of 84 green before them |
| the shared "cannot say" phrase reworded | 4 red (the three unmeasured rows and the sheet's word-for-word row) |
| the shared "would keep" phrase reworded | 4 red (the three unmeasured rows and the sheet's word-for-word row) |

## Out of scope, untouched

The sheet, the mode line, the list, the confirm path, focus and refocus, the hook, `lib/api.ts`, the server side of the door, every
Rider item and PR9. No file under `server/src`, `ui/` or `agent/`; no `shared/switches.ts`.

## Residual (carried)

Review 1727 F1. In mode unmeasured with the marker unreadable and the breaker clear, the one sub-case where the hidden figure can be
above zero, the last pass still counts each would-keep worktree and puts it in the list. The card's list is unchanged by this PR,
so under the new sentence it still names those worktrees, headed "Worktrees the last pass listed", with "and N more" past 50. The
sentence above it stays true: the card does not say how many turning this on would keep. The list was out of this PR's scope, and
any change to it (its heading, "and N more", or hiding it in that state) is the operator's choice in a later change. The
coordinator carries it in the programme ledger.

## Owed to README

README.md was held by another programme's run's claim for the whole of this PR, so the README's card paragraph is not changed
here (the coordinator's ruling). The sentence owed, in "The switch's card: Settings › Automation › Worktrees left behind":
"with every count" becomes "with every count, but for the would-keep figure after a pass that could not read everything it
needs, where it says the card cannot say how many until the next pass".

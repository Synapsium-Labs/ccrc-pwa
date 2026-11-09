# PR8c (the adoption switch's Settings card): what moved in, and the two carried fixes

Run 1688, delegation broker wave 5. PR8b (#2452) gave `$REG/delegation-adopt` one writer behind the operator's door and served what
adoption would keep (D-8112..D-8114); its card was split out because `consolidation-path-guard.test.ts` (D-5855) refuses a diff that
touches `pwa/` beside `shared/switches.ts` ("The split", `pr8b.md`). This PR is that card. It changes nothing on the server's side of
the door: not the verb, not the refusal rule, not the decider, and not what adoption keeps or when. Adoption stays shadow until the
operator turns the switch on in Settings.

**Ledger.** No new number. D-8114 is amended in place: its card half shipped here, with the two fixes below. `pr8b.md`'s split
paragraph gains one sentence pointing here.

## What moved in

Three patches the coordinator held, each checked against its sha256 before use, applied to main at the PR8b merge, and committed as
they applied before any fix:

| Patch | sha256 | How it applied |
|---|---|---|
| `pr8c-shared.patch` | `7ff3aec7…6908b7c` | cleanly: `DELEGATION_ADOPT_CAPS` beside its type, and its single-definition row |
| `pr8b-card-census.patch` | `373a3f6e…0502fb1741` | cleanly: the wave-3 census's PWA allow-list (`W5_SWITCH_PWA_FILES`); both comments that name it (the list's own, and the allow-list's entry) relabelled from PR8b to PR8c, the second in fix round 1 (review 1693 F5) |
| `pr8c-card.patch` | `2299f76c…7a2631` | with `git apply --3way`; three files conflicted with #2474's Browser tools card, resolved by hand, below |

The card patch predates #2474, which added the Browser tools card to the same page. Each conflict kept both cards:

- `pwa/src/screens/settings/AutomationSection.tsx`: the header comment names Browser tools and Worktrees left behind, and its count
  says twelve cards. Both sides had raised ten to eleven, so the merge took eleven without a conflict on that line; it is twelve.
- `pwa/test/settings-frame.test.tsx`: the Automation card list names both, in render order. The heading-levels row (not a conflict:
  both sides had added one `3`) has twelve `3`s, and its title says twelve.
- `pwa/test/settings-screen.test.tsx`: the LOADING row's title and its heading list name both, in render order.

The card's three file headers are relabelled from PR8b to PR8c.

## N6: on's `sign-in-unarmed` (review 1665, carried)

The GET's `refused.on` reads `sign-in-unarmed` for a caller that is not a signed-in operator (D-8113, review 1659 F2). The patch
predates that word, so its reader read every dark server's view as malformed and the card showed "could not be read" instead of the
switch. `shared/delegation-adopt.ts` now has a runtime guard beside the type, `isDelegationAdoptOnRefusal`, and the union and the
guard are both derived from one table, `DELEGATION_ADOPT_ON_ONLY`, as the door's three words are from `DELEGATION_ADOPT_REFUSALS`. The
word's status is not in that table: it is the collect-lane door's word, 403 in `REFUSAL_STATUS` already. The card's reader takes the
guard for `on` only; `off` keeps the three words, so `sign-in-unarmed` there is no view. The card's refusal table gains the word's
sentence, which is keyed by the type, so the table stays total; a 403 `sign-in-unarmed` reply to a write shows the same sentence in a
refusal tone instead of the ccd write reader's line.

Rows, red first: a dark server's view reads whole, through the poll, with its refusal in the card's words, `on` disabled and `off`
checked; `off` refused with the word is no view, and each guard keeps its own words; the write reply's sentence; and a
single-definition row (`vocabularies.test.ts`) pinning the one table and the derived union. The refusal table's totality row was
extended to the four words; it was not red first (review 1693 F11). Since fix round 1 the same row also pins that the guard's body
reads the table and spells none of its words (review 1693 F7). Mutants: the table without the word reds four card rows; a hand-kept
union reds the vocabulary row; a hand-kept guard body (`v === 'sign-in-unarmed'`, the table unread) reds it too, where it left all
151 rows green before F7. The browser file gains
a dark server's step at every width: the view reads whole, its list is drawn, `on` is refused in the card's words, and nothing
overflows.

## N10: no `path` on an item (review 1665, carried)

Fix round 2 of PR8b dropped `path` from each would-keep item, so an item is project, worktree, parent session and what changed. The
patch's reader still required `path`, so it read every path-less view as no view. Its card keyed the list on `path` and showed it as
each item's title. Now the reader reads the four fields, the list keys on project and worktree with no title, and no fixture carried
a path, the browser file's included; since fix round 1 one row's items carry a `path` on purpose (F2, below). Row, red first: an item of exactly those four keys reads whole through the reader and the poll, and no list item carries a
title. Mutant: the reader requiring `path` again reds nine rows (9 of 57, on the card's own reader). After fix round 1 (F1) the card
reads items only through the shared reader; the same mutant there reds 9 of 70 at fix round 2's tip. That title assertion could not fail on path-less fixtures, so fix
round 1 adds a row whose two items still carry one shared `path` (the shared reader passes unknown fields through): the path is shown
nowhere, is no item's title, and is no key (two items with one path would warn of a duplicate key). Mutants: the card putting the
item's `path` into a title reds it, and so does keying on it (review 1693 F2). The second guard is the pwa typecheck:
`DelegationAdoptionKeep` has no `path`, so `k.path` in the card does not compile.

With N10 alone the pwa typecheck still failed on N6's gap: `delegationAdoptRefusedLine` could not take `sign-in-unarmed`. As the
patch applied it failed on `path` too, because the shared type no longer has the field. N6 closes both, and the typecheck is green.

## M7: the confirmation-skipped mutant, re-measured

The ruling's seventh mutant (a tap of "Keep them" writing at once, with no confirmation) reds 14 of the card file's 57 rows. Before the
split it was 13 of 53. The added red row is N6's write-reply row, which taps through the confirmation. Re-measured at fix round 2's
tip, where the file has 70 rows, it reds 21 (review 1699 R2-8): the rounds' focus, stale-sheet and sheet-wording rows tap through
the confirmation too.

## Precedent sites (D-7994's card, `ScopeSweepSection.tsx`)

Every site `git grep` finds for `ScopeSweepSection`, `useScopeSweepView`, `scopeSweepWords` and `api.scopeSweep` in `pwa/`, `ui/`,
`shared/`, `server/test/` and README, mirrored or set aside:

| Site | Here |
|---|---|
| `pwa/src/fleet/ScopeSweepSection.tsx`, `useScopeSweepView.ts`, `scopeSweepWords.ts` | mirrored as `DelegationAdoptSection.tsx`, `useDelegationAdoptView.ts`, `delegationAdoptWords.ts` (L4, L4, L1) |
| `pwa/src/lib/api.ts`'s reader and writer | mirrored (`delegationAdopt`, `setDelegationAdopt`; L3) |
| `pwa/src/fleet/settingsText.ts`'s card entry | mirrored (`SETTINGS_CARDS.automation.delegationAdopt`) |
| `pwa/src/screens/settings/SettingsDataProvider.tsx` and `AutomationSection.tsx` | mirrored: one poll in the frame, the card after Leftover processes |
| `pwa/test/scope-sweep-section.test.tsx` | mirrored as `delegation-adopt-section.test.tsx`, its older-server 404 row included |
| `pwa/test/api-timeout.test.ts`, `section-status.test.ts`, `settings-frame.test.tsx`, `settings-screen.test.tsx` | mirrored |
| `pwa/browser/scope-sweep-card.browser.test.ts` | mirrored as `delegation-adopt-card.browser.test.ts` |
| README's card prose | mirrored, under the door's section, under its own heading |
| `shared/scope-sweep.ts` (the L0 view) | already mirrored in PR8b as `shared/delegation-adopt.ts`; this PR adds `DELEGATION_ADOPT_CAPS` and the `on` guard |

The card never decides a refusal: it shows what the GET serves. `watch.ts` and `store.ts` are untouched, and no transition row,
journal kind, entry field or checkpoint member is added. No test, script or fixture raises the live marker.

The census reads the card's own words. A failed write that is not one of the door's words is said by the ccd write reader
(`verbWriteFailure`), which relays the server's detail as the precedent cards do: that detail is the server's data, not the card's
words (review 1693 F9, ruled no change).

## Fix round 1 (review 1693)

| F | What changed | Row, red then green | Mutant |
|---|---|---|---|
| F1 | `asKeep` goes: the card reads `keeps` through its one reader, `delegationAdoptionKeepsOf`, and a list it refuses is dropped, so the card says "served no list" and the switch stays drawn; `asHealth` keeps its mode and count checks | a malformed item with no earlier view: both answers, the counts and the no-list line drawn; the reader row now asserts three bad lists are dropped, not the view | the view nulled again on a refused list: 2 red |
| F2 | a row that can fail: items carrying a shared `path` | the path shown nowhere, no title, no duplicate-key warning (green before the fix too; the mutants are its proof) | `path` as the title: 1 red; `path` as the key: 1 red |
| F3 | `choose` reads the current view: a choice it refuses sends nothing and closes the sheet; the comment on refused choices corrected | sheet open, a newer view refuses `on`, confirm: no POST, the sheet closed, the refusal line shown | the re-check dropped: 1 red |
| F4 | after a tap, once the write settles or a refusal closes the sheet, the focus goes to the checked answer when it can be chosen, else to the card's status lines (a `tabIndex=-1` wrapper) | the active element after the confirm and the settle, and after a refused write (jsdom) | the focus step dropped: 2 red |
| F5 | the allow-list entry's comment relabelled PR8c | text | none |
| F6 | AutomationSection's header: this card reads the frame's view | text | none |
| F7 | the vocabulary row pins the guard's body | the reviewer's hand-kept guard left 151 green | the hand-kept guard: 1 red |
| F8 | the sheet names `adoption.wouldAdopt`, list or no list; "cannot tell" only for `adoption` null; with `more` above 0 it says how many are listed and how many are not | would keep 0 with no list; a served list; `more` above 0; `adoption` null; the card's own sheet at 0 | none ruled |
| F9 | no change; the census sentence above | text | none |
| F10 | the live mode line speaks of the last pass; the refused line and `fleet-caps-unmeasured`'s sentence drop "now"; the census regex gains `now` | the census | the old live line put back: 1 red |
| F11 | text: the totality row is not claimed as red first | text | none |

F4's precedents, by reading and not measured: `ScopeSweepSection` and `PaneScopeStopSection` open no sheet, but both disable their
fieldset while a write is in flight, so the radio just tapped is disabled under the focus. Their fix is out of this PR's scope.

## Fix round 2 (review 1699)

| R2 | What changed | Row, red at fix round 1's tip, then green | Mutant |
|---|---|---|---|
| R2-1 | the refocus waits until the card's reading is the settled reply's (in the shipped app the view arrives through the Settings frame one commit later), then focuses the radio whose value is that reading, when enabled; it never reads `:checked` early | the card's browser file, through the shipped Settings wiring: the write held, then answered, and the active element is the radio the new reading checks, for Keep them then on and for Do not keep then off (all 8 views red, then green). A jsdom row mounted through `SettingsDataProvider` could also go red, and is added | today's effect (no wait, `:checked`): the browser file 8 of 8 red; the jsdom frame row red |
| R2-2 | the refocus moves the focus only from nowhere, the page, or this card | focus moved to a control outside the card while the write is in flight stays there | the guard dropped: 1 red |
| R2-3 | the status wrapper is drawn only with content; with no enabled radio for the reading the focus goes to the result line, else the refusal line, else the unmeasured note (each `tabIndex=-1`, each with text) | a reply that reads the marker unmeasurable: the focus is on the unmeasured note, and no empty focusable element is in the card | the wrapper drawn empty again: 1 red |
| R2-4 | the sheet names the would-keep figure only after a shadow pass; after live, suspended or unmeasured it says the card cannot tell until the next pass and lists nothing | live with a list and `more` above 0, suspended, unmeasured | the mode check dropped: 1 red |
| R2-5 | `nothingCounted` and `confirmCannotCount` speak of the last pass: none has counted a worktree yet, or the last counted nothing | words row | none |
| R2-6 | the live mode line describes the mode: "Keeping was on at the last pass." | words row | none |
| R2-7 | `fleet-caps-unmeasured` says this cannot be turned on until the fleet box reports | words row | none |
| R2-8 | the section's header sentence on the sheet; the words module's header names F9's exception; this note's stale figures (above) | text | none |

The fallback line R2-3 names, in this order: the card's result line (the status wrapper, drawn only with content), else the refusal
line for the reading, else the unmeasured note. In R2-3's row it is the unmeasured note.

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
| `pr8b-card-census.patch` | `373a3f6e…0502fb1741` | cleanly: the wave-3 census's PWA allow-list (`W5_SWITCH_PWA_FILES`), its comment relabelled from PR8b to PR8c |
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
checked; `off` refused with the word is no view, and each guard keeps its own words; the write reply's sentence; the refusal table
total over the four words; and a single-definition row (`vocabularies.test.ts`) pinning the one table, the derived union and the one
guard. Mutants: the table without the word reds four card rows; a hand-kept union reds the vocabulary row. The browser file gains
a dark server's step at every width: the view reads whole, its list is drawn, `on` is refused in the card's words, and nothing
overflows.

## N10: no `path` on an item (review 1665, carried)

Fix round 2 of PR8b dropped `path` from each would-keep item, so an item is project, worktree, parent session and what changed. The
patch's reader still required `path`, so it read every path-less view as no view. Its card keyed the list on `path` and showed it as
each item's title. Now the reader reads the four fields, the list keys on project and worktree with no title, and no fixture carries
a path, the browser file's included. Row, red first: an item of exactly those four keys reads whole through the reader and the poll, and no list item carries a
title. Mutant: the reader requiring `path` again reds nine rows.

With N10 alone the pwa typecheck still failed on N6's gap: `delegationAdoptRefusedLine` could not take `sign-in-unarmed`. As the
patch applied it failed on `path` too, because the shared type no longer has the field. N6 closes both, and the typecheck is green.

## M7: the confirmation-skipped mutant, re-measured

The ruling's seventh mutant (a tap of "Keep them" writing at once, with no confirmation) reds 14 of the card file's 57 rows. Before the
split it was 13 of 53. The added red row is N6's write-reply row, which taps through the confirmation.

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

## Observation for the ledger fold

The card's reader checks each keep item itself (`asKeep`), and a malformed list nulls the whole view, while `keeps`' one reader,
`delegationAdoptionKeepsOf`, drops a malformed list and keeps the rest; the card's list then reads through that one reader. Both
read the same fields since N10. No ruling asked to fold the card's check into the one reader, so it is left as the patch made it.

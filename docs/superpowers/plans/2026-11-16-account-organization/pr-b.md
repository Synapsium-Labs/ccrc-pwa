# Account organization, PR B: the builder's notes

**Run** 2314 (programme `overlord`, #2491) · **Plan** `docs/superpowers/plans/2026-11-16-account-organization.md`
(#2909), Task B1, with five findings of PR A's review (#2920) carried here · **Spec delta** #2910

These notes are for the coordinator's ledger. They name departures by slug. No D-number is used or invented.

## In short

The Accounts screen shows and sets each account's organization label. A card reads "Organization: org-a" or
"Organization: not set". Set opens a sheet with the hint, the field, Save and, for a labelled account, Clear. A save
goes through PR A's facts door, and the line moves only on the server's ack. The five carried findings are fixed: the
account set verb refuses a bad label before any write (F2), an empty label is no label in both twins (F3), the
projection's sentence reads as English (F4), the README and the comments name the label (F5), and a refused label is
never echoed by the roster's parsers (F6).

## What was built

| Item | What | Where |
|---|---|---|
| B1 | The card's line and its sheet | `pwa/src/fleet/AccountOrgRow.tsx` (new), drawn by `pwa/src/screens/AccountsScreen.tsx` |
| B1 | The words, and the refusal words by code | `pwa/src/fleet/accountOrgWords.ts` (new, L1) |
| B1 | The `org` lane act, held like `homeAcked` until the refreshed answer lands | `pwa/src/fleet/AccountKnob.tsx` (`useLaneActs`) |
| B1 | `refusalWordOf`, the one reader of a refusal's `error` word, and `laneActRefusal` takes `'org'` | `pwa/src/fleet/accountWords.ts` |
| B1 | `accountSet`'s body takes `org`, typed from `RosterFactsChange` | `pwa/src/lib/api.ts` |
| F2 | `org-check`, the label's gate alone, read-only, silent on success; `orgRefused`, shared with `set-facts` | the account script |
| F2 | The verb asks `org-check` before the stated account, the placement or the facts are written | `ccd/ccrc` (`_acct_set`) |
| F3 | `labelOf`: `''` is no label in `orgRelation` and `orgSpread` | `shared/accountOrg.ts` |
| F4 | "The roster records lane x's billing fact, continuity record and organization label." | `ccd/ccrc` (`_acct_set`) |
| F5 | The usage line gains `[--org <label>\|none]`; the facts comments name the label | `README.md`, `shared/rosterFacts.ts`, `shared/account-argv.ts` |
| F6 | Both parsers say `account "x" has an invalid "org": it <reason>.`, never the value | `shared/roster.ts`, `shared/roster-json.mjs` |

## Departures, by slug

- `org-hint-in-the-sheet`: the plan's Step 1 puts the hint with the row. The card shows the line only, and the hint
  sits in the sheet above the field, where the name is typed. A long sentence on every card would crowd it.
- `org-line-without-connect`: the line is drawn for every account on the roster, and Set only where the screen can
  act at all (a `connect` answer). The label is information even when it cannot be changed here. "Start new sessions
  here" is drawn only with `connect`, because it is nothing but a control.
- `org-save-holds-off-shape`: Save is held back while the roster's own gate (`orgLabelVerdict`) reads the field
  `off-shape`, as the pool sheet holds Create back off `POOL_NAME_RE`. An id-shaped name is let through to the door,
  whose `org-looks-like-an-id` is the refusal the brief asks to word. No third copy of the id shapes is written.
- `org-check-op`: F2 needed the shape refused before the verb's first write, and PR A's `org-shape-owned-by-the-op`
  keeps the shapes out of bash. So the op gains `org-check`, which the verb asks first. `set-facts` keeps its own check
  for the operator's direct use, through the same `orgRefused`.
- `org-refusal-says-nothing-written`: both of the op's label refusals now end "Nothing was written.". That is true
  for `org-check` and for `set-facts`, which refuses before it reads the roster.
- `org-empty-label-is-unknown`: F3 is fixed in TypeScript, the side that differed. Bash cannot tell `_ccrc_org`
  printing nothing from printing an empty string. The roster's gate refuses `''` anyway, so only a caller that did not
  parse can reach it. `ORG_EMPTY_LABEL_CASES` drives both twins.
- `org-no-css`: no stylesheet rule was added (`fleet.css` was held by another run). The line reuses
  `acct-resume-line` and the sheet reuses `sheet-copy`, `pool-new-row`, `pool-new-label` and `acct-fold`, with a
  hook class `acct-org` of its own.
- `org-review-report-unread`: review 2305's report was not on disk when this wave started. F2 to F6 were built from
  the brief's one-line summaries. If the report asked for more than they say, this PR does not have it.

## Tests and mutation

Green, one file at a time: `account-org` (pwa, new), `account-homeable`, `account-knob`, `accounts-screen`,
`accounts-one-poll`, `accounts-trouble`, the four pwa censuses (`control`, `role`, `markup`, `literal`) and
`shape-census`, the pwa typecheck; `ccrc-account-set`, `account-op-set-facts`, `org-relation`, `roster-org`,
`account-routes-write`, `account-deny`, `session-hook-account-deny`, `readme-roster-mirror`, `readme-holds`,
`roster`, `roster-exec-parity`, `gen-accounts`, `roster-generate`, `wrapper-roster-fixture`, `ccrc-account`,
`anchors`, `citations`, `private-names`, `sim/mutation-floors`, every `single-definition/*` and `rings/*` file,
`growth-check` armed, `deviation-refs` after `git fetch origin main`, the server and agent source typechecks, and the
agent's `account-argv`. `deviation-refs` and `single-definition/advance-switches` each failed once on a timeout under
load and passed alone. The server tests' typecheck (`tsc -p test/tsconfig.tests.json`) and `topology-clean` were
killed by the test slice's memory cap on this box and are left to CI.

**The first full CI run was red** (`shellcheck-ratchet`, which was not on the local list): `ccd/ccrc` read 64
warnings against its pin of 62. Shellcheck reads one variable name across all of a file's functions, so the
projection sentence's array, first named `w`, made two other functions' string `w` read as an array reassigned
(SC2178). The array is now `facts_named`. Measured outside the slice, `ccd/ccrc` is back at 62. The ratchet's own run
was killed by the slice's memory cap twice locally, so CI decides it again.

`mutation-run.py` mutates Python modules only, so the mutants were applied by a script, one at a time, each file
restored from a saved copy. All 19 were killed:

| Mutant | Killed by |
|---|---|
| the line moves on the press, before the ack | `account-org` |
| the line shows what was typed, not what the ack read back | `account-org` |
| `org-looks-like-an-id` loses its own words | `account-org` |
| a refusal closes the sheet | `account-org` |
| Save is enabled for an off-shape name | `account-org` |
| Clear is offered for an unlabelled account | `account-org` |
| Set is not held back by another act on the account | `account-org` |
| the field is not trimmed | `account-org` |
| the verb skips the up-front `org-check` (F2) | `ccrc-account-set` |
| `org-check` admits everything (F2) | `ccrc-account-set` |
| the id refusal, or the off-shape one, stops saying nothing was written (F2, two mutants) | `account-op-set-facts` |
| the old projection sentence, or two items joined without "and" (F4, two mutants) | `ccrc-account-set` |
| the relation, or the spread, reads `''` as a label (F3, two mutants) | `org-relation` |
| `parseRoster`, or the mirror, echoes the value (F6, two mutants) | `roster-org` |
| the mirror loses the id reason (F6) | `roster-org` |

The F2 op cases and the F4 projection cases were written with their code, not before it; the mutants above are what
measures them. The B1, F3 and F6 tests were run red first.

## Peer grants

- `README.md` (claim 4651, run 1850): the one account set usage line, exactly as agreed in mail.

## Growth

Net code lines against `main`: `ccd/ccrc` +8, the account script +5 (1878 against its cap of 1879),
`pwa/src/lib/api.ts` +1. Every other changed file is unlisted. `growth-check` runs green armed.

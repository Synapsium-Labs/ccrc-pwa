# w6-plan-ref-words — the last unreachable words after reviews 3144 and 3199 (D-8185, D-8808)

Run 3202's record for the programme ledger. It lands the words, comments and pins that reviews 3144 and 3199 left on the
`unreachable` wording of the coordinator's plan reference and on D-8808's shared-key item. Words, comments and pins only: no
behaviour change.

| Item | Ruling | Done | Pin (seen red) |
|---|---|---|---|
| 1 | 3144 F1: triage's owner cause names the caller who could be that owner. | plan.md's triage section: the owner cause is reached only by a caller who could be that owner. | `coordinator-plan-reference.test.ts`, triage regex; red against the old plan.md text. |
| 2 | 3144 F2: take's home-workspace cause covers any take into an epic and any close with no handed row. | plan.md's take section says so. | The take section's own regex; red against the old text. |
| 3 | 3144 F3: the no-slot advice names the home project's Linear linking. | plan.md's take section names the linking as the remedy. | The take section's own regex; red against the old text. |
| 4 | map-propose lists `team-ambiguous` and `unreachable`. | plan.md's map-propose section names both words. | Two sentence pins on the section, sliced to the next heading; red against the old text. |
| 5 | A pin for each changed sentence, red against the old text. | Triage, take and map-propose each carry one. | Each seen red with the base plan.md restored (commit 870b5e5139). |
| 6 | 3144 F4: the w6-clause note's F1 row is current. 3144 F5: D-8808 names the epic-workspace and home-workspace arms. | `w6-clause.md`'s F1 row quotes take's current home-workspace clause (commit 870b5e5139); D-8808 in the plan gains the sentence on `destinationRefusal` and `upkeepLookupOf`. | Words only; none. |
| 7 | 3199 F1: the two docblocks. | `sharedKeyItemInput` and `sharedKeyItemVerdict` say the item settles once no waiting issue of the team depends on the workspace choice: routed, waiting on their owner, or none waiting. | Comments only; none. |
| 8 | 3199 F3: the test title runs two callers. | `plan-inbound.test.ts`: the no-project-team test now runs OWNER and OTHER, each on a fresh rig, and is retitled to say so. | None to see red: the test only widens its callers, and both answer `not-linear-owner` with nothing moved and no writes. |
| 9 | 3199 F2: the settings-path row counts occurrences. | `single-definition/plan.test.ts` counts per file (`PasskeyNotice.tsx` 1, `SignInGateCard.tsx` 2, `shared/ledgers.ts` 1). | A second literal in `shared/ledgers.ts` reds it (`shared/ledgers.ts: 2`); the old files-only row stayed green. |

The review judge flags rules-mixed when a PR changes plan.md and anything else; as ruled for #3151 and #3155, the pin test rides
with the rules file it pins, and the run lands as one PR.

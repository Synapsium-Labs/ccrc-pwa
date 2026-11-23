# Run 3476 (`w8-suggest-workspace-id`): the team-ambiguous remedy names a workspace the door accepts

Linear hierarchy wave 8, D-8808 and D-8809. No new deviation: the change is additive and decides nothing new.

## The gap, measured

`POST /api/linking/suggest` refuses `team-ambiguous` (409) when no `workspace` is named and two connected Linear workspaces hold
the key. Its remedy in the coordinator plan reference said "send it again with `workspace`", and the door takes `workspace` only
as a Linear workspace id. The refusal's detail was the fixed sentence "more than one connected Linear workspace holds the key", and
`linear workspaces` lists URL keys and names only, so nothing a coordinator could call gave it a value the door accepts.

The red test (`linking-routes.test.ts`, the suggest describe: "the team-ambiguous refusal names each holding workspace by the id
the door accepts, and either one resent is taken") seeds two connected workspaces holding one key, takes the refusal, reads only
the refusal body for Linear workspace ids and sends each back. On the old code it found none (`expected [] to equal [a1, b2]`).

## What was built (the brief's first preference)

| Piece | Change | Pins |
|---|---|---|
| The router | `routeLinear`'s `team-ambiguous` route carries `holders`, every holding slot's workspace id and URL key (null when not learned), sorted by id, beside `candidates`, which is unchanged and still feeds the proxy's detail | `linear-route.test.ts` |
| The pair verdict | `teamPairVerdict`'s `team-ambiguous` detail names the holders: "more than one connected Linear workspace holds the key; send one of these as workspace: `<id> (<URL key>)`, …", a URL key cleaned as Linear data, at most eight named, then "and N more". Word, status and decision unchanged. The confirm door shares the verdict and passes its door (fix round 1, review 3482 F1): its `team-ambiguous` comes only from a candidate stored with no workspace, which no resend can name, so its detail lists the same holders as "more than one connected Linear workspace holds the key, and the candidate names none of them: …", with no instruction to resend | `linking-policy.test.ts`; the confirm door's detail in `linking-overlord-confirm.test.ts` |
| The suggest route | No change: it already passes the verdict's detail through | the red test above, now green |
| The coordinator plan reference | The `team-ambiguous` remedy: "send it again with `workspace` set to one of the workspaces the detail names"; the `workspace` sentence says the refusal's detail names them by that id, up to eight, and counts the rest (fix round 1, F3) | `coordinator-plan-reference.test.ts`, both pinned word for word |
| The Overlord paragraph | `team-ambiguous`: "more than one workspace holds the key and the candidate names none of them, so leave it for the operator and name in your brief the workspaces its detail lists (up to eight, and a count of the rest)" (fix round 1, F1 and F6). The confirm door still takes only a current candidate, so the Overlord's remedy stays the operator's | `overlord-skill.test.ts` |

Not done, on purpose: the door accepts no second spelling of a workspace (a URL key is not taken), no refusal word, status or
decision changed, `shared/api.ts` untouched, and `linear workspaces` (the brief's second preference) is unchanged because the
first one closes the gap.

## For the ledger

- Wave 8's follow-up `w8-suggest-workspace-id` is built by this run.
- The detail is runtime text for the box-token caller; it carries workspace ids and URL keys, never a key, a team key or a name.
